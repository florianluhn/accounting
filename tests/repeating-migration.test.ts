import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'acct-repeat-mig-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = join(dir, 'test.db');
process.env.ATTACHMENTS_PATH = join(dir, 'attachments');
process.env.BACKUP_ENABLED = 'false';

// Production shape after the auth migration and before repeating postings:
// audit_logs already has actor columns and the previous resource types, and
// journal_entries already exists so the base Drizzle migrator does not run.
const initSqlJs = (await import('sql.js')).default;
const SQL = await initSqlJs();
const fixture = new SQL.Database();
fixture.run('PRAGMA foreign_keys = OFF');
fixture.run(`
	CREATE TABLE currencies (
		code TEXT PRIMARY KEY NOT NULL,
		name TEXT NOT NULL,
		symbol TEXT NOT NULL,
		exchange_rate REAL NOT NULL DEFAULT 1,
		is_default INTEGER NOT NULL DEFAULT 0
	)
`);
fixture.run(`INSERT INTO currencies (code, name, symbol, exchange_rate, is_default) VALUES ('USD', 'US Dollar', '$', 1, 1)`);
fixture.run(`
	CREATE TABLE gl_accounts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_number TEXT NOT NULL,
		name TEXT NOT NULL,
		type TEXT NOT NULL,
		updated_at INTEGER
	)
`);
fixture.run(`
	CREATE TABLE subledger_accounts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_number TEXT NOT NULL,
		name TEXT NOT NULL,
		currency_code TEXT NOT NULL
	)
`);
fixture.run(`
	CREATE TABLE journal_entries (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		entry_date INTEGER NOT NULL,
		amount INTEGER NOT NULL,
		currency_code TEXT NOT NULL,
		amount_in_usd INTEGER NOT NULL,
		debit_account_id INTEGER NOT NULL,
		credit_account_id INTEGER NOT NULL,
		description TEXT NOT NULL
	)
`);
fixture.run(`
	CREATE TABLE app_settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	)
`);
fixture.run(`INSERT INTO app_settings (key, value) VALUES ('money_unit', 'cents')`);
const resourceTypes = [
	'currency', 'gl_account', 'subledger_account', 'journal_entry', 'attachment', 'vendor',
	'customer', 'time_entry', 'inventory_category', 'inventory_item', 'fixed_asset',
	'investment', 'booking', 'booking_platform', 'budget', 'app_settings', 'financial_year',
	'material_allocation', 'user', 'api_token', 'legacy_note'
];
fixture.run(`
	CREATE TABLE audit_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		operation TEXT NOT NULL CHECK(operation IN ('CREATE', 'UPDATE', 'DELETE')),
		resource_type TEXT NOT NULL CHECK(resource_type IN (${resourceTypes.map((type) => `'${type}'`).join(', ')})),
		resource_id TEXT NOT NULL,
		source TEXT NOT NULL DEFAULT 'Web UI' CHECK(source IN ('Web UI', 'CSV Import', 'API')),
		batch_id TEXT,
		batch_summary TEXT,
		old_data TEXT,
		new_data TEXT,
		timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
		description TEXT,
		actor_user_id INTEGER,
		actor_username TEXT
	)
`);
fixture.run(`
	INSERT INTO audit_logs (operation, resource_type, resource_id, source, actor_username, description)
	VALUES ('CREATE', 'journal_entry', '1', 'Web UI', 'florian', 'existing'),
	       ('CREATE', 'legacy_note', '9', 'API', 'florian', 'kept')
`);
writeFileSync(process.env.DATABASE_PATH, Buffer.from(fixture.export()));
fixture.close();

const { buildServer } = await import('../src/server/index.ts');
const { sqlite } = await import('../src/server/db/connection.ts');

function cookieFrom(response: { headers: Record<string, string | string[] | undefined> }): string {
	const raw = response.headers['set-cookie'];
	const value = Array.isArray(raw) ? raw[0] : raw;
	assert.ok(value, 'expected a session cookie');
	return value.split(';')[0];
}

test('startup migration creates repeating postings on an already-upgraded database', async () => {
	const app = await buildServer();
	try {
		const schema = sqlite.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_logs'");
		const createSql = String(schema[0].values[0][0]);
		assert.match(createSql, /'repeating_posting'/);
		assert.match(createSql, /'legacy_note'/);
		const tables = sqlite.exec(
			"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('repeating_postings', 'repeating_posting_lines')"
		);
		assert.equal(tables[0].values.length, 2);

		const boot = await app.inject({
			method: 'POST',
			url: '/api/auth/bootstrap',
			payload: { username: 'florian', password: 'correct-horse' }
		});
		assert.equal(boot.statusCode, 201, boot.body);
		const auth = { cookie: cookieFrom(boot) };

		const list = await app.inject({
			method: 'GET',
			url: '/api/repeating-postings',
			headers: auth
		});
		assert.equal(list.statusCode, 200, list.body);
		assert.deepEqual(list.json(), []);

		const logs = await app.inject({
			method: 'GET',
			url: '/api/audit-logs',
			headers: auth
		});
		assert.equal(logs.statusCode, 200, logs.body);
		const types = logs.json().map((row: { resourceType: string }) => row.resourceType);
		assert.ok(types.includes('legacy_note'));
		assert.ok(types.includes('journal_entry'));

		sqlite.run('PRAGMA foreign_keys = OFF');
		sqlite.run('DROP TABLE repeating_posting_lines');
		sqlite.run('DROP TABLE repeating_postings');
		sqlite.run('PRAGMA foreign_keys = ON');
		const missing = await app.inject({
			method: 'GET',
			url: '/api/repeating-postings',
			headers: auth
		});
		assert.equal(missing.statusCode, 503, missing.body);
		assert.match(missing.json().message, /Restart the API/);
	} finally {
		await app.close();
	}
});
