import initSqlJs from 'sql.js';
import { readFile, stat } from 'fs/promises';

async function testDb() {
	const dbPath = './data/accounting.db';

	// Check file stats
	const stats = await stat(dbPath);
	console.log('File modification time:', stats.mtime.toISOString());
	console.log('File size:', stats.size, 'bytes');
	console.log('Current time:', new Date().toISOString());
	console.log('');

	const SQL = await initSqlJs();
	const buffer = await readFile(dbPath);
	const db = new SQL.Database(buffer);

	// Check what tables exist
	const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
	console.log('Tables in database:', JSON.stringify(tables, null, 2));

	// Try to query currencies
	const result = db.exec('SELECT * FROM currencies');
	console.log('\nCurrencies query result:', JSON.stringify(result, null, 2));

	db.close();
	process.exit(0);
}

testDb();
