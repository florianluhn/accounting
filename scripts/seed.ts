import initSqlJs from 'sql.js';
import { drizzle } from 'drizzle-orm/sql-js';
import * as schema from '../src/server/db/schema.js';
import { currencies } from '../src/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';

const DATABASE_PATH = resolve(process.env.DATABASE_PATH || './data/accounting.db');

async function seed() {
	console.log('🌱 Seeding database...');

	try {
		// Initialize SQL.js with a fresh instance
		const SQL = await initSqlJs();

		// Load the database file
		if (!existsSync(DATABASE_PATH)) {
			console.error('❌ Database file not found. Run npm run migrate first.');
			process.exit(1);
		}

		const buffer = await readFile(DATABASE_PATH);
		console.log(`Loading database from ${DATABASE_PATH}, file size: ${buffer.byteLength} bytes`);

		const sqlite = new SQL.Database(buffer);
		const db = drizzle(sqlite, { schema });

		// Check if USD currency already exists
		const existingUSD = await db.select().from(currencies).where(eq(currencies.code, 'USD'));
		console.log('Existing USD check:', existingUSD);

		if (existingUSD.length === 0) {
			// Use Drizzle ORM to insert
			console.log('Inserting USD currency...');
			await db.insert(currencies).values({
				code: 'USD',
				name: 'US Dollar',
				symbol: '$',
				exchangeRate: 1.0,
				isDefault: true
			});
			console.log('Insert complete');

			// Verify
			const verify = await db.select().from(currencies).where(eq(currencies.code, 'USD'));
			console.log('Verification:', verify);

			console.log('✓ Added default currency: USD');
		} else {
			console.log('✓ Default currency USD already exists');
		}

		// Export and save
		console.log('Exporting database...');
		const data = sqlite.export();
		console.log(`Database export size: ${data.byteLength} bytes`);

		// Verify the export contains data
		const testDb = new SQL.Database(data);
		const testResult = testDb.exec('SELECT * FROM currencies');
		console.log('Data in export:', JSON.stringify(testResult, null, 2));
		testDb.close();

		// Write to file
		await writeFile(DATABASE_PATH, data);
		console.log(`✓ Database saved to ${DATABASE_PATH}`);

		// Force file system sync
		const fs = await import('fs');
		const fd = fs.openSync(DATABASE_PATH, 'r+');
		fs.fsyncSync(fd);
		fs.closeSync(fd);
		console.log('✓ File system synced');

		// Wait a moment for FS to settle
		await new Promise(resolve => setTimeout(resolve, 500));

		// Verify by reading back
		const verifyBuffer = await readFile(DATABASE_PATH);
		console.log(`Verify buffer size: ${verifyBuffer.byteLength} bytes`);
		const verifyDb = new SQL.Database(verifyBuffer);
		const verifyResult = verifyDb.exec('SELECT * FROM currencies');
		console.log('Data after write and read:', JSON.stringify(verifyResult, null, 2));
		verifyDb.close();

		sqlite.close();
		console.log('✓ Database closed');

		// Wait before exit to ensure everything completes
		await new Promise(resolve => setTimeout(resolve, 500));
		console.log('✓ Exit delay complete');

		console.log('✓ Database seeded successfully');
		console.log('\nNote: The database starts empty. You can now:');
		console.log('  1. Add currencies via the Settings page');
		console.log('  2. Create your GL account structure');
		console.log('  3. Add subledger accounts');
		console.log('  4. Start creating journal entries');

		process.exit(0);
	} catch (error) {
		console.error('❌ Seeding failed:', error);
		process.exit(1);
	}
}

seed();
