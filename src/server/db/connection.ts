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

/**
 * Run vendors table migration
 */
function migrateVendors(): void {
	try {
		// Check if vendors table exists
		const tableCheck = sqlite.exec(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='vendors'"
		);

		if (tableCheck.length === 0 || tableCheck[0].values.length === 0) {
			console.log('Creating vendors table...');

			sqlite.run(`
				CREATE TABLE IF NOT EXISTS vendors (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					name TEXT NOT NULL,
					address TEXT,
					phone TEXT,
					email TEXT,
					website TEXT,
					comments TEXT,
					created_at INTEGER NOT NULL DEFAULT (unixepoch()),
					updated_at INTEGER NOT NULL DEFAULT (unixepoch())
				)
			`);

			sqlite.run('CREATE INDEX IF NOT EXISTS idx_vendors_name ON vendors(name)');

			// Create timestamp trigger for vendors
			sqlite.run(`
				CREATE TRIGGER IF NOT EXISTS update_vendors_timestamp
				AFTER UPDATE ON vendors
				FOR EACH ROW
				BEGIN
					UPDATE vendors SET updated_at = unixepoch() WHERE id = NEW.id;
				END;
			`);

			console.log('✓ vendors table created successfully');
		} else {
			console.log('✓ vendors table already exists');
		}

		// Add vendor_id column to journal_entries if it doesn't exist
		const columns = sqlite.exec('PRAGMA table_info(journal_entries)');
		const hasVendorId = columns.length > 0 &&
			columns[0].values.some((col: any) => col[1] === 'vendor_id');

		if (!hasVendorId) {
			console.log('Adding vendor_id column to journal_entries...');
			sqlite.run('ALTER TABLE journal_entries ADD COLUMN vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL');
			sqlite.run('CREATE INDEX IF NOT EXISTS idx_journal_entries_vendor ON journal_entries(vendor_id)');
			console.log('✓ vendor_id column added to journal_entries');
		}

		// Update audit_logs CHECK constraint to include 'vendor'
		const auditCheck = sqlite.exec(
			"SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_logs'"
		);
		if (auditCheck.length > 0 && auditCheck[0].values.length > 0) {
			const createSql = auditCheck[0].values[0][0] as string;
			if (!createSql.includes("'vendor'")) {
				console.log('Updating audit_logs to support vendor resource type...');
				sqlite.run(`
					CREATE TABLE IF NOT EXISTS audit_logs_new (
						id INTEGER PRIMARY KEY AUTOINCREMENT,
						operation TEXT NOT NULL CHECK(operation IN ('CREATE', 'UPDATE', 'DELETE')),
						resource_type TEXT NOT NULL CHECK(resource_type IN ('currency', 'gl_account', 'subledger_account', 'journal_entry', 'attachment', 'vendor')),
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
				sqlite.run('INSERT INTO audit_logs_new SELECT * FROM audit_logs');
				sqlite.run('DROP TABLE audit_logs');
				sqlite.run('ALTER TABLE audit_logs_new RENAME TO audit_logs');
				sqlite.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp)');
				sqlite.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id)');
				sqlite.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_operation ON audit_logs(operation)');
				sqlite.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_source ON audit_logs(source)');
				sqlite.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_batch ON audit_logs(batch_id)');
				console.log('✓ audit_logs updated to support vendor resource type');
			}
		}
	} catch (error) {
		console.error('Failed to migrate vendors:', error);
		throw error;
	}
}

/**
 * Run time_entries table migration
 */
function migrateTimeEntries(): void {
	try {
		const tableCheck = sqlite.exec(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='time_entries'"
		);

		if (tableCheck.length === 0 || tableCheck[0].values.length === 0) {
			console.log('Creating time_entries table...');

			sqlite.run(`
				CREATE TABLE IF NOT EXISTS time_entries (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					entry_date INTEGER NOT NULL,
					hours INTEGER NOT NULL DEFAULT 0,
					minutes INTEGER NOT NULL DEFAULT 0,
					activity TEXT NOT NULL,
					description TEXT,
					who TEXT NOT NULL,
					created_at INTEGER NOT NULL DEFAULT (unixepoch()),
					updated_at INTEGER NOT NULL DEFAULT (unixepoch())
				)
			`);

			sqlite.run('CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(entry_date)');
			sqlite.run('CREATE INDEX IF NOT EXISTS idx_time_entries_who ON time_entries(who)');
			sqlite.run('CREATE INDEX IF NOT EXISTS idx_time_entries_activity ON time_entries(activity)');

			sqlite.run(`
				CREATE TRIGGER IF NOT EXISTS update_time_entries_timestamp
				AFTER UPDATE ON time_entries
				FOR EACH ROW
				BEGIN
					UPDATE time_entries SET updated_at = unixepoch() WHERE id = NEW.id;
				END;
			`);

			console.log('✓ time_entries table created successfully');
		} else {
			console.log('✓ time_entries table already exists');
		}

		// Update audit_logs CHECK constraint to include 'time_entry'
		const auditCheck = sqlite.exec(
			"SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_logs'"
		);
		if (auditCheck.length > 0 && auditCheck[0].values.length > 0) {
			const createSql = auditCheck[0].values[0][0] as string;
			if (!createSql.includes("'time_entry'")) {
				console.log('Updating audit_logs to support time_entry resource type...');
				sqlite.run(`
					CREATE TABLE IF NOT EXISTS audit_logs_new (
						id INTEGER PRIMARY KEY AUTOINCREMENT,
						operation TEXT NOT NULL CHECK(operation IN ('CREATE', 'UPDATE', 'DELETE')),
						resource_type TEXT NOT NULL CHECK(resource_type IN ('currency', 'gl_account', 'subledger_account', 'journal_entry', 'attachment', 'vendor', 'time_entry')),
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
				sqlite.run('INSERT INTO audit_logs_new SELECT * FROM audit_logs');
				sqlite.run('DROP TABLE audit_logs');
				sqlite.run('ALTER TABLE audit_logs_new RENAME TO audit_logs');
				sqlite.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp)');
				sqlite.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id)');
				sqlite.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_operation ON audit_logs(operation)');
				sqlite.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_source ON audit_logs(source)');
				sqlite.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_batch ON audit_logs(batch_id)');
				console.log('✓ audit_logs updated to support time_entry resource type');
			}
		}
	} catch (error) {
		console.error('Failed to migrate time_entries:', error);
		throw error;
	}
}

/**
 * Run customers table migration
 */
function migrateCustomers(): void {
	try {
		const tableCheck = sqlite.exec(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='customers'"
		);

		if (tableCheck.length === 0 || tableCheck[0].values.length === 0) {
			console.log('Creating customers table...');

			sqlite.run(`
				CREATE TABLE IF NOT EXISTS customers (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					first_name TEXT NOT NULL,
					last_name TEXT NOT NULL,
					email TEXT,
					phone TEXT,
					country TEXT,
					state TEXT,
					zip_code TEXT,
					city TEXT,
					contact_method TEXT,
					comment TEXT,
					created_at INTEGER NOT NULL DEFAULT (unixepoch()),
					updated_at INTEGER NOT NULL DEFAULT (unixepoch())
				)
			`);

			sqlite.run('CREATE INDEX IF NOT EXISTS idx_customers_last_name ON customers(last_name)');

			sqlite.run(`
				CREATE TRIGGER IF NOT EXISTS update_customers_timestamp
				AFTER UPDATE ON customers
				FOR EACH ROW
				BEGIN
					UPDATE customers SET updated_at = unixepoch() WHERE id = NEW.id;
				END;
			`);

			console.log('✓ customers table created successfully');
		} else {
			console.log('✓ customers table already exists');
		}

		// Update audit_logs CHECK constraint to include 'customer'
		const auditCheck = sqlite.exec(
			"SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_logs'"
		);
		if (auditCheck.length > 0 && auditCheck[0].values.length > 0) {
			const createSql = auditCheck[0].values[0][0] as string;
			if (!createSql.includes("'customer'")) {
				console.log('Updating audit_logs to support customer resource type...');
				sqlite.run(`
					CREATE TABLE IF NOT EXISTS audit_logs_new (
						id INTEGER PRIMARY KEY AUTOINCREMENT,
						operation TEXT NOT NULL CHECK(operation IN ('CREATE', 'UPDATE', 'DELETE')),
						resource_type TEXT NOT NULL CHECK(resource_type IN ('currency', 'gl_account', 'subledger_account', 'journal_entry', 'attachment', 'vendor', 'customer', 'time_entry')),
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
				sqlite.run('INSERT INTO audit_logs_new SELECT * FROM audit_logs');
				sqlite.run('DROP TABLE audit_logs');
				sqlite.run('ALTER TABLE audit_logs_new RENAME TO audit_logs');
				sqlite.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp)');
				sqlite.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id)');
				sqlite.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_operation ON audit_logs(operation)');
				sqlite.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_source ON audit_logs(source)');
				sqlite.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_batch ON audit_logs(batch_id)');
				console.log('✓ audit_logs updated to support customer resource type');
			}
		}
	} catch (error) {
		console.error('Failed to migrate customers:', error);
		throw error;
	}
}

/**
 * Run inventory tables migration
 */
function migrateInventory(): void {
	try {
		// inventory_categories
		const catCheck = sqlite.exec(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_categories'"
		);
		if (catCheck.length === 0 || catCheck[0].values.length === 0) {
			console.log('Creating inventory_categories table...');
			sqlite.run(`
				CREATE TABLE IF NOT EXISTS inventory_categories (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					name TEXT NOT NULL,
					description TEXT,
					asset_account_id INTEGER NOT NULL REFERENCES subledger_accounts(id) ON DELETE RESTRICT,
					field_definitions TEXT NOT NULL DEFAULT '[]',
					value_formula TEXT NOT NULL DEFAULT '0',
					created_at INTEGER NOT NULL DEFAULT (unixepoch()),
					updated_at INTEGER NOT NULL DEFAULT (unixepoch())
				)
			`);
			sqlite.run('CREATE INDEX IF NOT EXISTS idx_inventory_categories_name ON inventory_categories(name)');
			sqlite.run('CREATE INDEX IF NOT EXISTS idx_inventory_categories_account ON inventory_categories(asset_account_id)');
			sqlite.run(`
				CREATE TRIGGER IF NOT EXISTS update_inventory_categories_timestamp
				AFTER UPDATE ON inventory_categories
				FOR EACH ROW
				BEGIN
					UPDATE inventory_categories SET updated_at = unixepoch() WHERE id = NEW.id;
				END;
			`);
			console.log('✓ inventory_categories table created');
		} else {
			console.log('✓ inventory_categories table already exists');
		}

		// inventory_items
		const itemCheck = sqlite.exec(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_items'"
		);
		if (itemCheck.length === 0 || itemCheck[0].values.length === 0) {
			console.log('Creating inventory_items table...');
			sqlite.run(`
				CREATE TABLE IF NOT EXISTS inventory_items (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					category_id INTEGER NOT NULL REFERENCES inventory_categories(id) ON DELETE CASCADE,
					name TEXT NOT NULL,
					field_values TEXT NOT NULL DEFAULT '{}',
					total_value REAL NOT NULL DEFAULT 0,
					created_at INTEGER NOT NULL DEFAULT (unixepoch()),
					updated_at INTEGER NOT NULL DEFAULT (unixepoch())
				)
			`);
			sqlite.run('CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items(category_id)');
			sqlite.run(`
				CREATE TRIGGER IF NOT EXISTS update_inventory_items_timestamp
				AFTER UPDATE ON inventory_items
				FOR EACH ROW
				BEGIN
					UPDATE inventory_items SET updated_at = unixepoch() WHERE id = NEW.id;
				END;
			`);
			console.log('✓ inventory_items table created');
		} else {
			console.log('✓ inventory_items table already exists');
		}

		// Update audit_logs CHECK constraint to include inventory types
		const auditCheck = sqlite.exec(
			"SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_logs'"
		);
		if (auditCheck.length > 0 && auditCheck[0].values.length > 0) {
			const createSql = auditCheck[0].values[0][0] as string;
			if (!createSql.includes("'inventory_category'")) {
				console.log('Updating audit_logs to support inventory resource types...');
				sqlite.run(`
					CREATE TABLE IF NOT EXISTS audit_logs_new (
						id INTEGER PRIMARY KEY AUTOINCREMENT,
						operation TEXT NOT NULL CHECK(operation IN ('CREATE', 'UPDATE', 'DELETE')),
						resource_type TEXT NOT NULL CHECK(resource_type IN ('currency', 'gl_account', 'subledger_account', 'journal_entry', 'attachment', 'vendor', 'customer', 'time_entry', 'inventory_category', 'inventory_item')),
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
				sqlite.run('INSERT INTO audit_logs_new SELECT * FROM audit_logs');
				sqlite.run('DROP TABLE audit_logs');
				sqlite.run('ALTER TABLE audit_logs_new RENAME TO audit_logs');
				sqlite.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp)');
				sqlite.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id)');
				sqlite.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_operation ON audit_logs(operation)');
				sqlite.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_source ON audit_logs(source)');
				sqlite.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_batch ON audit_logs(batch_id)');
				console.log('✓ audit_logs updated to support inventory resource types');
			}
		}
	} catch (error) {
		console.error('Failed to migrate inventory:', error);
		throw error;
	}
}

/**
 * Add consumption tracking: categoryType, quantityField, remaining columns, material_allocations table
 */
function migrateConsumption(): void {
	try {
		// Add category_type to inventory_categories
		const catCols = sqlite.exec('PRAGMA table_info(inventory_categories)');
		if (catCols.length > 0) {
			const cols = catCols[0].values.map((c: any) => c[1]);
			if (!cols.includes('category_type')) {
				sqlite.run("ALTER TABLE inventory_categories ADD COLUMN category_type TEXT NOT NULL DEFAULT 'other'");
				console.log('✓ Added category_type to inventory_categories');
			}
			if (!cols.includes('quantity_field')) {
				sqlite.run('ALTER TABLE inventory_categories ADD COLUMN quantity_field TEXT');
				console.log('✓ Added quantity_field to inventory_categories');
			}
		}

		// Add remaining columns to inventory_items
		const itemCols = sqlite.exec('PRAGMA table_info(inventory_items)');
		if (itemCols.length > 0) {
			const cols = itemCols[0].values.map((c: any) => c[1]);
			if (!cols.includes('remaining_quantity')) {
				sqlite.run('ALTER TABLE inventory_items ADD COLUMN remaining_quantity REAL');
				console.log('✓ Added remaining_quantity to inventory_items');
			}
			if (!cols.includes('remaining_value')) {
				sqlite.run('ALTER TABLE inventory_items ADD COLUMN remaining_value REAL');
				console.log('✓ Added remaining_value to inventory_items');
			}
		}

		// Create material_allocations table
		const allocCheck = sqlite.exec(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='material_allocations'"
		);
		if (allocCheck.length === 0 || allocCheck[0].values.length === 0) {
			console.log('Creating material_allocations table...');
			sqlite.run(`
				CREATE TABLE IF NOT EXISTS material_allocations (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					raw_material_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
					finished_good_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
					quantity_used REAL NOT NULL,
					notes TEXT,
					created_at INTEGER NOT NULL DEFAULT (unixepoch())
				)
			`);
			sqlite.run('CREATE INDEX IF NOT EXISTS idx_allocations_raw_material ON material_allocations(raw_material_item_id)');
			sqlite.run('CREATE INDEX IF NOT EXISTS idx_allocations_finished_good ON material_allocations(finished_good_item_id)');
			console.log('✓ material_allocations table created');
		} else {
			console.log('✓ material_allocations table already exists');
		}
	} catch (error) {
		console.error('Failed to migrate consumption tracking:', error);
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
migrateVendors();
migrateTimeEntries();
migrateCustomers();
migrateInventory();
migrateConsumption();

export { sqlite };
export default db;
