import db from '../src/server/db/connection.js';
import { currencies } from '../src/server/db/schema.js';

async function checkDatabase() {
	console.log('🔍 Checking database...\n');

	try {
		// Check currencies
		const allCurrencies = await db.select().from(currencies);

		console.log('📊 Currencies in database:');
		if (allCurrencies.length === 0) {
			console.log('  ❌ No currencies found!');
			console.log('\n💡 Run: npm run seed');
		} else {
			allCurrencies.forEach(c => {
				console.log(`  ${c.isDefault ? '⭐' : '  '} ${c.code} - ${c.name} (${c.symbol}) - Rate: ${c.exchangeRate}`);
			});
		}

		console.log('\n✓ Check complete');
		process.exit(0);
	} catch (error) {
		console.error('❌ Check failed:', error);
		process.exit(1);
	}
}

checkDatabase();
