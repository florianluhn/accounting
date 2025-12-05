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
	console.log(`Loading database from ${DATABASE_PATH}, file size: ${buffer.byteLength} bytes`);
	sqlite = new SQL.Database(buffer);
	console.log('✓ Database loaded from', DATABASE_PATH);

	// Debug: check what's in the loaded database
	const tablesResult = sqlite.exec("SELECT name FROM sqlite_master WHERE type='table'");
	const tables = tablesResult.length > 0 ? tablesResult[0].values.map(v => v[0]).join(', ') : 'none';
	console.log('Tables in loaded database:', tables);
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
	// Check what's in the database before export
	const checkResult = sqlite.exec('SELECT COUNT(*) as count FROM currencies');
	const count = checkResult.length > 0 ? checkResult[0].values[0][0] : 0;
	console.log(`[${new Date().toISOString()}] Currencies count before export: ${count}`);

	// Check database page count to see if it's been modified
	const pageCountResult = sqlite.exec('PRAGMA page_count');
	const pageCount = pageCountResult.length > 0 ? pageCountResult[0].values[0][0] : 0;
	console.log(`[${new Date().toISOString()}] Database page count: ${pageCount}`);

	// Log who's calling this to debug race conditions
	const stack = new Error().stack?.split('\n')[2]?.trim() || 'unknown';
	console.log(`[${new Date().toISOString()}] saveDatabase called from:`, stack);

	const data = sqlite.export();
	console.log(`[${new Date().toISOString()}] Saving database to ${DATABASE_PATH}, size: ${data.byteLength} bytes`);

	// Try loading the exported data into a new database to check it
	const SQL = await import('sql.js').then(m => m.default());
	const testDb = new SQL.Database(data);
	const testResult = testDb.exec('SELECT COUNT(*) as count FROM currencies');
	const testCount = testResult.length > 0 ? testResult[0].values[0][0] : 0;
	console.log(`Currencies count in exported data: ${testCount}`);
	testDb.close();

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

// ========================================
// Migrations
// ========================================

/**
 * Run audit logs table migration
 */
function migrateAuditLogs(): void {
	try {
		// Check if audit_logs table exists
		const tableCheck = sqlite.exec(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='audit_logs'"
		);

		if (tableCheck.length === 0 || tableCheck[0].values.length === 0) {
			console.log('Creating audit_logs table...');

			// Create audit_logs table
			sqlite.run(`
				CREATE TABLE IF NOT EXISTS audit_logs (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					operation TEXT NOT NULL CHECK(operation IN ('CREATE', 'UPDATE', 'DELETE')),
					resource_type TEXT NOT NULL CHECK(resource_type IN ('currency', 'gl_account', 'subledger_account', 'journal_entry', 'attachment')),
					resource_id TEXT NOT NULL,
					source TEXT NOT NULL DEFAULT 'Web UI' CHECK(source IN ('Web UI', 'CSV Import', 'API')),
					batch_id TEXT,
					batch_summary TEXT,
					old_data TEXT,
					new_data TEXT,
					timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
					description TEXT
				)
			`);

			// Create indexes
			sqlite.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp)');
			sqlite.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id)');
			sqlite.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_operation ON audit_logs(operation)');
			sqlite.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_source ON audit_logs(source)');
			sqlite.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_batch ON audit_logs(batch_id)');

			console.log('✓ audit_logs table created successfully');
		} else {
			console.log('✓ audit_logs table already exists');
		}
	} catch (error) {
		console.error('Failed to create audit_logs table:', error);
		throw error;
	}
}

// Run integrity check on startup
if (!checkIntegrity()) {
	console.error('❌ Database integrity check failed!');
	process.exit(1);
} else {
	console.log('✓ Database integrity check passed');
}

// Run migrations
migrateAuditLogs();

export { sqlite };
export default db;
