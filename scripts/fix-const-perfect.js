import fs from 'fs';

let content = fs.readFileSync('src/routes/reports/+page.svelte', 'utf8');
let lines = content.split('\n');

// Find the bad consts and delete them entirely
lines = lines.filter(line => !line.includes('{@const allAccounts') && !line.includes('{@const maxAmount'));

// Find the chart {#if modules.budgets} which is followed by <!-- Budget vs Actual Graphs -->
// Wait, the comment <!-- Budget vs Actual Graphs --> is BEFORE {#if modules.budgets}
const chartHeaderIndex = lines.findIndex(l => l.includes('<!-- Budget vs Actual Graphs -->'));
if (chartHeaderIndex !== -1) {
    const ifIndex = chartHeaderIndex + 1; // {#if modules.budgets} is right after it
    if (lines[ifIndex].includes('{#if modules.budgets}')) {
        // Inject right after it
        lines.splice(ifIndex + 1, 0, 
            '\t\t\t\t{@const allAccounts = [...profitLoss.revenue.accounts, ...profitLoss.expenses.accounts].flatMap(g => g.subledgerAccounts).filter(a => a.balance > 0 || (a.budget && a.budget > 0))}',
            '\t\t\t\t{@const maxAmount = Math.max(...allAccounts.flatMap(a => [a.balance, a.budget || 0])) || 1}'
        );
    }
}

fs.writeFileSync('src/routes/reports/+page.svelte', lines.join('\n'), 'utf8');
console.log('Fixed flawlessly.');
