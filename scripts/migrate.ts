import { migrate } from 'drizzle-orm/sql-js/migrator';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { drizzle } from 'drizzle-orm/sql-js';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { existsSync } from 'fs';

const DATABASE_PATH = resolve(process.env.DATABASE_PATH || './data/accounting.db');

async function runMigration() {
	console.log('🔄 Running database migrations...');

	// Ensure data directory exists
	await mkdir(dirname(DATABASE_PATH), { recursive: true });

	// Initialize SQL.js
	const SQL = await initSqlJs();

	// Load or create database
	let sqlite: SqlJsDatabase;

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

	const db = drizzle(sqlite);

	try {
		// Run migrations
		migrate(db, { migrationsFolder: './src/server/db/migrations' });
		console.log('✓ Migrations completed successfully');

		// Save database to disk
		const data = sqlite.export();
		await writeFile(DATABASE_PATH, data);
		console.log('✓ Database saved to', DATABASE_PATH);
	} catch (error) {
		console.error('❌ Migration failed:', error);
		process.exit(1);
	} finally {
		sqlite.close();
	}
}

runMigration();
