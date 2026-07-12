import fs from 'fs';

let content = fs.readFileSync('src/routes/reports/+page.svelte', 'utf8');
const lines = content.split('\n');

const cleanedLines = lines.filter(line => !line.includes('{@const allAccounts') && !line.includes('{@const maxAmount'));

const targetIndex = cleanedLines.findIndex(line => line.includes('<h3 class="text-xl font-bold mb-6 text-center">Budget vs Actuals</h3>'));

if (targetIndex !== -1) {
    // Inject right before this div
    // But wait, they need to be inside the {#if} block.
    // The h3 is inside the div which is inside the card which is inside the {#if modules.budgets}.
    // So anywhere inside the block is fine. Let's put it right after the flex gap-4 div (the legend)
    const legendEndIndex = targetIndex + 5; // The flex gap-4 has 4 lines.
    
    const consts = [
        '\t\t\t\t\t\t\t{@const allAccounts = [...profitLoss.revenue.accounts, ...profitLoss.expenses.accounts].flatMap(g => g.subledgerAccounts).filter(a => a.balance > 0 || (a.budget && a.budget > 0))}',
        '\t\t\t\t\t\t\t{@const maxAmount = Math.max(...allAccounts.flatMap(a => [a.balance, a.budget || 0])) || 1}'
    ];
    
    cleanedLines.splice(legendEndIndex, 0, ...consts);
}

fs.writeFileSync('src/routes/reports/+page.svelte', cleanedLines.join('\n'), 'utf8');
console.log('Fixed globally via array filtering');
