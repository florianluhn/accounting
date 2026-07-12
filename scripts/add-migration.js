import fs from 'fs';

let content = fs.readFileSync('src/server/db/connection.ts', 'utf8');

const migrateBudgetsFn = `
function migrateBudgets(): void {
	try {
		const tableCheck = sqlite.exec(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='budgets'"
		);
		if (tableCheck.length === 0 || tableCheck[0].values.length === 0) {
			console.log('Creating budgets table...');
			sqlite.run(\`
				CREATE TABLE IF NOT EXISTS budgets (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					subledger_account_id INTEGER NOT NULL REFERENCES subledger_accounts(id),
					year INTEGER NOT NULL,
					amount REAL NOT NULL,
					created_at INTEGER NOT NULL DEFAULT (unixepoch()),
					updated_at INTEGER NOT NULL DEFAULT (unixepoch())
				)
			\`);
			sqlite.run('CREATE INDEX IF NOT EXISTS idx_budgets_account ON budgets(subledger_account_id)');
			sqlite.run('CREATE INDEX IF NOT EXISTS idx_budgets_year ON budgets(year)');
			sqlite.run(\`
				CREATE TRIGGER IF NOT EXISTS update_budgets_timestamp
				AFTER UPDATE ON budgets
				FOR EACH ROW
				BEGIN
					UPDATE budgets SET updated_at = unixepoch() WHERE id = NEW.id;
				END;
			\`);
			console.log('✓ budgets table created successfully');
		} else {
			console.log('✓ budgets table already exists');
		}
	} catch (error) {
		console.error('Failed to migrate budgets:', error);
		throw error;
	}
}

`;

if (!content.includes('function migrateBudgets()')) {
    // Insert function right before the first migration call `migrateAuditLogs();`
    content = content.replace('migrateAuditLogs();', migrateBudgetsFn + 'migrateAuditLogs();');
}

if (!content.includes('migrateBudgets();')) {
    // Insert function call at the end of the migrations list
    content = content.replace('migrateFixedAssets();\n', 'migrateFixedAssets();\nmigrateBudgets();\n');
}

fs.writeFileSync('src/server/db/connection.ts', content, 'utf8');
console.log('Added migrateBudgets to connection.ts');
