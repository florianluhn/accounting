import initSqlJs from 'sql.js';
import { readFile } from 'fs/promises';

async function testDb() {
	const SQL = await initSqlJs();
	const buffer = await readFile('./data/accounting.db');
	const db = new SQL.Database(buffer);

	// Check what tables exist
	const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
	console.log('Tables in database:', JSON.stringify(tables, null, 2));

	// Try to query currencies
	const result = db.exec('SELECT * FROM currencies');
	console.log('\nCurrencies query result:', JSON.stringify(result, null, 2));

	process.exit(0);
}

testDb();
