import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import initSqlJs from 'sql.js';
import { migrateMoneyUnits } from '../src/server/db/money-migration.ts';

test('money migration preserves cent totals and does not run twice', async () => {
	const SQL = await initSqlJs();
	const dir = mkdtempSync(join(tmpdir(), 'acct-money-'));
	const databasePath = join(dir, 'old.db');
	const sqlite = new SQL.Database();
	sqlite.run(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
	sqlite.run(`CREATE TABLE journal_entries (
		id INTEGER PRIMARY KEY,
		amount REAL NOT NULL,
		amount_in_usd REAL NOT NULL
	)`);
	sqlite.run(`INSERT INTO journal_entries (id, amount, amount_in_usd) VALUES (1, 10.10, 10.10)`);
	sqlite.run(`INSERT INTO journal_entries (id, amount, amount_in_usd) VALUES (2, 0.2, 0.2)`);
	sqlite.run(`CREATE TABLE budgets (
		id INTEGER PRIMARY KEY,
		subledger_account_id INTEGER NOT NULL,
		year INTEGER NOT NULL,
		amount REAL NOT NULL,
		created_at INTEGER NOT NULL DEFAULT 0,
		updated_at INTEGER NOT NULL DEFAULT 0
	)`);
	sqlite.run(`INSERT INTO budgets (id, subledger_account_id, year, amount) VALUES (1, 1, 2024, 100.005)`);
	const { writeFileSync } = await import('node:fs');
	writeFileSync(databasePath, sqlite.export());

	migrateMoneyUnits(sqlite, databasePath);
	const amounts = sqlite.exec('SELECT amount, amount_in_usd FROM journal_entries ORDER BY id');
	assert.deepEqual(amounts[0].values, [
		[1010, 1010],
		[20, 20]
	]);
	const budget = sqlite.exec('SELECT amount FROM budgets');
	assert.equal(budget[0].values[0][0], 10001);
	const flag = sqlite.exec(`SELECT value FROM app_settings WHERE key = 'money_unit'`);
	assert.equal(flag[0].values[0][0], 'cents');
	assert.equal(existsSync(databasePath), true);

	const before = readFileSync(databasePath);
	migrateMoneyUnits(sqlite, databasePath);
	const after = sqlite.exec('SELECT amount FROM journal_entries WHERE id = 1');
	assert.equal(after[0].values[0][0], 1010);
	assert.ok(readFileSync(databasePath).byteLength >= before.byteLength - 1);
});

test('money migration restores the file when a total would change', async () => {
	const SQL = await initSqlJs();
	const dir = mkdtempSync(join(tmpdir(), 'acct-money-bad-'));
	const databasePath = join(dir, 'bad.db');
	const sqlite = new SQL.Database();
	sqlite.run(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
	sqlite.run(`CREATE TABLE journal_entries (id INTEGER PRIMARY KEY, amount REAL, amount_in_usd REAL)`);
	sqlite.run(`INSERT INTO journal_entries VALUES (1, 1.0, 1.0)`);
	const original = sqlite.export();
	const { writeFileSync } = await import('node:fs');
	writeFileSync(databasePath, original);

	const realExec = sqlite.exec.bind(sqlite);
	let sums = 0;
	sqlite.exec = (sql: string) => {
		if (sql.includes('SELECT amount FROM journal_entries') && sums++ > 0) {
			return [{ columns: ['amount'], values: [[999]] }];
		}
		return realExec(sql);
	};

	assert.throws(() => migrateMoneyUnits(sqlite, databasePath));
	const restored = readFileSync(databasePath);
	assert.equal(restored.byteLength, original.byteLength);
});
