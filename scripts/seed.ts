import db, { saveDatabase } from '../src/server/db/connection.js';
import { currencies } from '../src/server/db/schema.js';
import { eq } from 'drizzle-orm';

async function seed() {
	console.log('🌱 Seeding database...');

	try {
		// Check if USD currency already exists
		const existingUSD = await db.select().from(currencies).where(eq(currencies.code, 'USD'));

		if (existingUSD.length === 0) {
			// Insert default USD currency
			await db.insert(currencies).values({
				code: 'USD',
				name: 'US Dollar',
				symbol: '$',
				exchangeRate: 1.0,
				isDefault: true
			});

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
