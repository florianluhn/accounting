import db, { saveDatabase, sqlite } from '../src/server/db/connection.js';
import { currencies } from '../src/server/db/schema.js';
import { eq } from 'drizzle-orm';

async function seed() {
	console.log('🌱 Seeding database...');

	try {
		// Check if USD currency already exists
		const existingUSD = await db.select().from(currencies).where(eq(currencies.code, 'USD'));
		console.log('Existing USD check:', existingUSD);

		if (existingUSD.length === 0) {
			// Try direct SQL insert as a test
			console.log('Attempting direct SQL insert...');
			const timestamp = Math.floor(Date.now() / 1000);
			sqlite.run(
				`INSERT INTO currencies (code, name, symbol, exchange_rate, is_default, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				['USD', 'US Dollar', '$', 1.0, 1, timestamp, timestamp]
			);
			console.log('Direct SQL insert complete');

			// Verify with direct SQL
			const directCheck = sqlite.exec('SELECT * FROM currencies WHERE code = ?', ['USD']);
			console.log('Direct SQL verification:', JSON.stringify(directCheck, null, 2));

			// Verify with Drizzle
			const verify = await db.select().from(currencies).where(eq(currencies.code, 'USD'));
			console.log('Drizzle verification:', verify);

			console.log('✓ Added default currency: USD');
		} else {
			console.log('✓ Default currency USD already exists');
		}

		// Save database to disk
		await saveDatabase();
		console.log('✓ Database saved to disk');

		console.log('✓ Database seeded successfully');
		console.log('\nNote: The database starts empty. You can now:');
		console.log('  1. Add currencies via the Settings page');
		console.log('  2. Create your GL account structure');
		console.log('  3. Add subledger accounts');
		console.log('  4. Start creating journal entries');

		// Exit successfully
		process.exit(0);
	} catch (error) {
		console.error('❌ Seeding failed:', error);
		process.exit(1);
	}
}

seed();
