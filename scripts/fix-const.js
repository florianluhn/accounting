import fs from 'fs';

let content = fs.readFileSync('src/routes/reports/+page.svelte', 'utf8');

const oldConstStr1 = "{@const allAccounts = [...profitLoss.revenue.accounts, ...profitLoss.expenses.accounts].flatMap(g => g.subledgerAccounts).filter(a => a.balance > 0 || (a.budget && a.budget > 0))}";
const oldConstStr2 = "{@const maxAmount = Math.max(...allAccounts.flatMap(a => [a.balance, a.budget || 0])) || 1}";

// Remove them from where they are
content = content.replace(oldConstStr1, "");
content = content.replace(oldConstStr2, "");

// Add them after {#if modules.budgets}
const target = "{#if modules.budgets}";
const injection = `
				${oldConstStr1}
				${oldConstStr2}
`;

content = content.replace(target, target + injection);

fs.writeFileSync('src/routes/reports/+page.svelte', content, 'utf8');
console.log('Fixed @const');
