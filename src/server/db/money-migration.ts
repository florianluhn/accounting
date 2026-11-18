import { copyFileSync, existsSync, readFileSync } from 'fs';
import { chmodSync, openSync, closeSync, fsyncSync, renameSync, writeFileSync, unlinkSync } from 'fs';
import { dollarsToCents } from '../money.js';

const MONEY_COLUMNS: Record<string, string[]> = {
	journal_entries: ['amount', 'amount_in_usd'],
	budgets: ['amount'],
	inventory_items: ['total_value', 'remaining_value'],
	fixed_assets: ['salvage_value'],
	investments: ['current_price'],
	closed_financial_years: ['net_income'],
	bookings: [
		'total_paid',
		'net_amount',
		'cleaning_fee',
		'sales_tax',
		'tourist_tax',
		'platform_fee',
		'rental_fee'
	]
};

type SqlJs = {
	exec: (sql: string) => Array<{ columns: string[]; values: unknown[][] }>;
	run: (sql: string, params?: unknown[]) => void;
	export: () => Uint8Array;
};

function tableExists(sqlite: SqlJs, name: string): boolean {
	const rows = sqlite.exec(
		`SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`
	);
	return rows.length > 0 && rows[0].values.length > 0;
}

function columnInfo(sqlite: SqlJs, table: string): Array<{ name: string; type: string }> {
	const rows = sqlite.exec(`PRAGMA table_info(${table})`);
	if (rows.length === 0) return [];
	return rows[0].values.map((row) => ({ name: String(row[1]), type: String(row[2] || '') }));
}

function setting(sqlite: SqlJs, key: string): string | null {
	if (!tableExists(sqlite, 'app_settings')) return null;
	const rows = sqlite.exec(`SELECT value FROM app_settings WHERE key = '${key}'`);
	if (rows.length === 0 || rows[0].values.length === 0) return null;
	return String(rows[0].values[0][0]);
}

function quoteIdent(name: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
		throw new Error(`Unexpected column name ${name}`);
	}
	return name;
}

function captureRawCents(sqlite: SqlJs, table: string, column: string): { cents: number; rows: number } {
	const rows = sqlite.exec(`SELECT ${quoteIdent(column)} FROM ${quoteIdent(table)}`);
	if (rows.length === 0) return { cents: 0, rows: 0 };
	let cents = 0;
	let count = 0;
	for (const value of rows[0].values) {
		const raw = value[0];
		if (raw == null) continue;
		const num = typeof raw === 'number' ? raw : Number(raw);
		if (!Number.isInteger(num)) {
			throw new Error(`${table}.${column} was not stored as integer cents (${String(raw)})`);
		}
		cents += num;
		count++;
	}
	return { cents, rows: count };
}

function captureColumnSum(sqlite: SqlJs, table: string, column: string): { cents: number; rows: number } {
	const rows = sqlite.exec(`SELECT ${quoteIdent(column)} FROM ${quoteIdent(table)}`);
	if (rows.length === 0) return { cents: 0, rows: 0 };
	let cents = 0;
	let count = 0;
	for (const value of rows[0].values) {
		const raw = value[0];
		if (raw == null) continue;
		const num = typeof raw === 'number' ? raw : Number(raw);
		cents += dollarsToCents(num);
		count++;
	}
	return { cents, rows: count };
}

function persist(sqlite: SqlJs, databasePath: string): void {
	const data = sqlite.export();
	const tmp = `${databasePath}.money-tmp`;
	writeFileSync(tmp, data);
	const fd = openSync(tmp, 'r+');
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
	renameSync(tmp, databasePath);
	chmodSync(databasePath, 0o600);
}

function restoreFile(backup: string | null, databasePath: string): void {
	if (!backup || !existsSync(backup)) return;
	copyFileSync(backup, databasePath);
	chmodSync(databasePath, 0o600);
}

/**
 * Convert money columns from decimal REAL units to integer cents.
 * Idempotent. Copies the database file first. On a total mismatch, restores that copy and throws.
 * Existing cent-equivalent values are preserved: each value is rounded to the nearest cent
 * and the sum of those cents must match after the rewrite.
 */
export function migrateMoneyUnits(sqlite: SqlJs, databasePath: string): void {
	if (setting(sqlite, 'money_unit') === 'cents') return;

	const present = Object.keys(MONEY_COLUMNS).filter((table) => tableExists(sqlite, table));
	if (present.length === 0 && !tableExists(sqlite, 'journal_entries')) {
		if (tableExists(sqlite, 'app_settings')) {
			sqlite.run(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('money_unit', 'cents')`);
		}
		return;
	}

	let backup: string | null = null;
	if (existsSync(databasePath)) {
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		backup = `${databasePath}.premigration-${stamp}.bak`;
		copyFileSync(databasePath, backup);
		chmodSync(backup, 0o600);
		console.log(`✓ Pre-migration database copy: ${backup}`);
	}

	const before = new Map<string, { cents: number; rows: number }>();
	try {
		sqlite.run('PRAGMA foreign_keys = OFF');
		if (tableExists(sqlite, 'account_balances')) {
			sqlite.run('DROP TABLE account_balances');
			console.log('✓ Removed unused account_balances cache');
		}

		if (tableExists(sqlite, 'journal_entries')) {
			const names = columnInfo(sqlite, 'journal_entries').map((col) => col.name);
			if (!names.includes('exchange_rate_to_usd')) {
				sqlite.run('ALTER TABLE journal_entries ADD COLUMN exchange_rate_to_usd REAL');
			}
			sqlite.run(`
				UPDATE journal_entries
				SET exchange_rate_to_usd = CASE
					WHEN amount IS NOT NULL AND amount != 0 THEN amount_in_usd * 1.0 / amount
					ELSE 1
				END
				WHERE exchange_rate_to_usd IS NULL
			`);
		}

		for (const table of present) {
			const info = columnInfo(sqlite, table);
			const moneyCols = MONEY_COLUMNS[table].filter((col) => info.some((row) => row.name === col));
			const realCols = moneyCols.filter((col) =>
				/real/i.test(info.find((row) => row.name === col)?.type || '')
			);
			for (const col of realCols) {
				before.set(`${table}.${col}`, captureColumnSum(sqlite, table, col));
			}
			rewriteTable(sqlite, table, realCols);
		}

		for (const [key, expected] of before) {
			const [table, col] = key.split('.');
			const actual = captureRawCents(sqlite, table, col);
			if (actual.cents !== expected.cents || actual.rows !== expected.rows) {
				throw new Error(
					`Money total mismatch for ${key}: before ${expected.cents} cents (${expected.rows} values), after ${actual.cents} cents (${actual.rows} values)`
				);
			}
		}

		if (tableExists(sqlite, 'app_settings')) {
			sqlite.run(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('money_unit', 'cents')`);
		}

		if (existsSync(databasePath)) persist(sqlite, databasePath);
		console.log('✓ Money columns stored as integer cents (totals unchanged)');
	} catch (error) {
		restoreFile(backup, databasePath);
		if (existsSync(databasePath)) {
			// Reload is the caller's job; the file on disk matches the backup.
			void readFileSync;
		}
		try {
			if (existsSync(databasePath + '.money-tmp')) unlinkSync(databasePath + '.money-tmp');
		} catch {
			/* ignore */
		}
		throw error;
	} finally {
		try {
			sqlite.run('PRAGMA foreign_keys = ON');
		} catch {
			/* database may be mid-failure */
		}
	}
}

function rewriteTable(sqlite: SqlJs, table: string, moneyCols: string[]): void {
	const info = columnInfo(sqlite, table);
	const money = new Set(moneyCols);
	const declaredReal = info.filter((col) => money.has(col.name) && /real/i.test(col.type));
	if (declaredReal.length === 0) return;

	const createRows = sqlite.exec(
		`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '${table}'`
	);
	const createSql = String(createRows[0].values[0][0]);
	const extras = sqlite.exec(
		`SELECT sql FROM sqlite_master WHERE tbl_name = '${table}' AND sql IS NOT NULL AND type IN ('index', 'trigger')`
	);
	const extraSql = extras.length ? extras[0].values.map((row) => String(row[0])) : [];

	let newSql = createSql.replace(
		/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["'`]?[A-Za-z0-9_]+["'`]?/i,
		`CREATE TABLE ${table}_money_new`
	);
	const ordered = [...declaredReal].sort((a, b) => b.name.length - a.name.length);
	for (const col of ordered) {
		const re = new RegExp(`(["'\`]?${col.name}["'\`]?)\\s+REAL\\b`, 'i');
		if (!re.test(newSql)) {
			throw new Error(`Could not rewrite ${table}.${col.name} to INTEGER`);
		}
		newSql = newSql.replace(re, '$1 INTEGER');
	}

	sqlite.run(`DROP TABLE IF EXISTS ${table}_money_new`);
	sqlite.run(newSql);

	const select = sqlite.exec(`SELECT * FROM ${quoteIdent(table)}`);
	if (select.length > 0) {
		const columns = select[0].columns;
		const placeholders = columns.map(() => '?').join(', ');
		const insert = `INSERT INTO ${table}_money_new (${columns.map(quoteIdent).join(', ')}) VALUES (${placeholders})`;
		for (const row of select[0].values) {
			const params = row.map((value, index) => {
				const name = columns[index];
				if (!money.has(name) || value == null) return value;
				const num = typeof value === 'number' ? value : Number(value);
				return dollarsToCents(num);
			});
			sqlite.run(insert, params);
		}
	}

	sqlite.run(`DROP TABLE ${quoteIdent(table)}`);
	sqlite.run(`ALTER TABLE ${table}_money_new RENAME TO ${quoteIdent(table)}`);
	for (const sql of extraSql) {
		sqlite.run(sql);
	}
}
