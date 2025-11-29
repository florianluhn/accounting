import initSqlJs from 'sql.js';
import { readFile } from 'fs/promises';

async function testDb() {
	const SQL = await initSqlJs();
	const buffer = await readFile('./data/accounting.db');
	const db = new SQL.Database(buffer);
	const result = db.exec('SELECT * FROM currencies');
	console.log('Raw database query result:', JSON.stringify(result, null, 2));
	process.exit(0);
}

testDb();
