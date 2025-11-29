import initSqlJs from 'sql.js';
import { drizzle } from 'drizzle-orm/sql-js';
import * as schema from './schema.js';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { existsSync } from 'fs';

const DATABASE_PATH = resolve(process.env.DATABASE_PATH || './data/accounting.db');

// Ensure data directory exists
await mkdir(dirname(DATABASE_PATH), { recursive: true });

// Initialize SQL.js
const SQL = await initSqlJs();

// Load or create database
let sqlite: any;

if (existsSync(DATABASE_PATH)) {
	// Load existing database
	const buffer = await readFile(DATABASE_PATH);
	sqlite = new SQL.Database(buffer);
	console.log('✓ Database loaded from', DATABASE_PATH);
} else {
	// Create new database
	sqlite = new SQL.Database();
	console.log('✓ New database created');
}

// Enable foreign keys
sqlite.run('PRAGMA foreign_keys = ON');

// Create Drizzle instance
export const db = drizzle(sqlite, { schema });

// ========================================
// Database Triggers
// ========================================

// Prevent same account on debit and credit
sqlite.run(`
	CREATE TRIGGER IF NOT EXISTS prevent_same_account_debit_credit
	BEFORE INSERT ON journal_entries
	WHEN NEW.debit_account_id = NEW.credit_account_id
	BEGIN
		SELECT RAISE(ABORT, 'Debit and credit accounts must be different');
	END;
`);

// Ensure amount is positive
sqlite.run(`
	CREATE TRIGGER IF NOT EXISTS ensure_positive_amount
	BEFORE INSERT ON journal_entries
	WHEN NEW.amount <= 0
	BEGIN
		SELECT RAISE(ABORT, 'Amount must be positive');
	END;
`);

// Update timestamp triggers for currencies
sqlite.run(`
	CREATE TRIGGER IF NOT EXISTS update_currencies_timestamp
	AFTER UPDATE ON currencies
	FOR EACH ROW
	BEGIN
		UPDATE currencies SET updated_at = unixepoch() WHERE code = NEW.code;
	END;
`);

// Update timestamp triggers for gl_accounts
sqlite.run(`
	CREATE TRIGGER IF NOT EXISTS update_gl_accounts_timestamp
	AFTER UPDATE ON gl_accounts
	FOR EACH ROW
	BEGIN
		UPDATE gl_accounts SET updated_at = unixepoch() WHERE id = NEW.id;
	END;
`);

// Update timestamp triggers for subledger_accounts
sqlite.run(`
	CREATE TRIGGER IF NOT EXISTS update_subledger_accounts_timestamp
	AFTER UPDATE ON subledger_accounts
	FOR EACH ROW
	BEGIN
		UPDATE subledger_accounts SET updated_at = unixepoch() WHERE id = NEW.id;
	END;
`);

// Update timestamp triggers for journal_entries
sqlite.run(`
	CREATE TRIGGER IF NOT EXISTS update_journal_entries_timestamp
	AFTER UPDATE ON journal_entries
	FOR EACH ROW
	BEGIN
		UPDATE journal_entries SET updated_at = unixepoch() WHERE id = NEW.id;
	END;
`);

// ========================================
// Utility Functions
// ========================================

/**
 * Save database to disk
 */
export async function saveDatabase(): Promise<void> {
	const data = sqlite.export();
	console.log(`Saving database to ${DATABASE_PATH}, size: ${data.byteLength} bytes`);
	await writeFile(DATABASE_PATH, data);
	console.log('Write complete');

	// Verify the write by reading back
	const verify = await readFile(DATABASE_PATH);
	console.log(`Verified file size: ${verify.byteLength} bytes`);
}

/**
 * Run database integrity check
 */
export function checkIntegrity(): boolean {
	const result = sqlite.exec('PRAGMA integrity_check');
	if (result.length > 0 && result[0].values.length > 0) {
		return result[0].values[0][0] === 'ok';
	}
	return true;
}

/**
 * Optimize database
 */
export function optimize(): void {
	sqlite.run('PRAGMA optimize');
}

/**
 * Get database file size in bytes
 */
export function getDatabaseSize(): number {
	const data = sqlite.export();
	return data.byteLength;
}

/**
 * Close database connection and save to disk
 */
export async function closeDatabase(): Promise<void> {
	await saveDatabase();
	sqlite.close();
}

// Auto-save database every 5 seconds (in-memory changes persist)
let saveTimer: NodeJS.Timeout;
function startAutoSave() {
	saveTimer = setInterval(async () => {
		try {
			await saveDatabase();
		} catch (error) {
			console.error('Auto-save failed:', error);
		}
	}, 5000);
}

export function stopAutoSave() {
	if (saveTimer) {
		clearInterval(saveTimer);
	}
}

// Only start auto-save if not running as a script (migration, seed, etc.)
const isScript = process.argv[1]?.includes('scripts');
if (!isScript) {
	startAutoSave();

	// Save on process exit
	process.on('SIGINT', async () => {
		clearInterval(saveTimer);
		await closeDatabase();
		process.exit(0);
	});

	process.on('SIGTERM', async () => {
		clearInterval(saveTimer);
		await closeDatabase();
		process.exit(0);
	});
}

// Run integrity check on startup
if (!checkIntegrity()) {
	console.error('❌ Database integrity check failed!');
	process.exit(1);
} else {
	console.log('✓ Database integrity check passed');
}

export { sqlite };
export default db;
