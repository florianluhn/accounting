import fs from 'fs';

let content = fs.readFileSync('src/routes/reports/+page.svelte', 'utf8');

const constStr = `
				{@const allAccounts = [...profitLoss.revenue.accounts, ...profitLoss.expenses.accounts].flatMap(g => g.subledgerAccounts).filter(a => a.balance > 0 || (a.budget && a.budget > 0))}
				{@const maxAmount = Math.max(...allAccounts.flatMap(a => [a.balance, a.budget || 0])) || 1}
`;

const target = `{#if modules.budgets}
				<div class="card bg-base-100 shadow-xl mb-6 mt-6 overflow-hidden">
					<div class="card-body">
						<h3 class="text-xl font-bold mb-6 text-center">Budget vs Actuals</h3>`;

const replacement = `{#if modules.budgets}${constStr}
				<div class="card bg-base-100 shadow-xl mb-6 mt-6 overflow-hidden">
					<div class="card-body">
						<h3 class="text-xl font-bold mb-6 text-center">Budget vs Actuals</h3>`;

content = content.replace(target, replacement);
fs.writeFileSync('src/routes/reports/+page.svelte', content, 'utf8');
console.log('Re-injected successfully.');
