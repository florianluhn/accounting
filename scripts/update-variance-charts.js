import fs from 'fs';

const filePath = 'src/routes/reports/+page.svelte';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Fix Variance calculation coloring in GL Group Row
// Right now it is:
// class:text-success={glGroup.totalBalance - glGroup.subledgerAccounts.reduce((sum, a) => sum + (a.budget || 0), 0) > 0} class:text-error={glGroup.totalBalance - glGroup.subledgerAccounts.reduce((sum, a) => sum + (a.budget || 0), 0) < 0}
// Replace with logic depending on glGroup.glAccountType

content = content.replace(
    /class:text-success=\{glGroup\.totalBalance - glGroup\.subledgerAccounts\.reduce\(\(sum, a\) => sum \+ \(a\.budget \|\| 0\), 0\) > 0\} class:text-error=\{glGroup\.totalBalance - glGroup\.subledgerAccounts\.reduce\(\(sum, a\) => sum \+ \(a\.budget \|\| 0\), 0\) < 0\}/g,
    `class:text-success={(glGroup.glAccountType === 'Revenue' && glGroup.totalBalance - glGroup.subledgerAccounts.reduce((sum, a) => sum + (a.budget || 0), 0) > 0) || (glGroup.glAccountType === 'Expense' && glGroup.totalBalance - glGroup.subledgerAccounts.reduce((sum, a) => sum + (a.budget || 0), 0) < 0)} class:text-error={(glGroup.glAccountType === 'Expense' && glGroup.totalBalance - glGroup.subledgerAccounts.reduce((sum, a) => sum + (a.budget || 0), 0) > 0) || (glGroup.glAccountType === 'Revenue' && glGroup.totalBalance - glGroup.subledgerAccounts.reduce((sum, a) => sum + (a.budget || 0), 0) < 0)}`
);

// 2. Fix Variance calculation coloring in Subledger Account Row
// class:text-success={account.balance - (account.budget || 0) > 0} class:text-error={account.balance - (account.budget || 0) < 0}

content = content.replace(
    /class:text-success=\{account\.balance - \(account\.budget \|\| 0\) > 0\} class:text-error=\{account\.balance - \(account\.budget \|\| 0\) < 0\}/g,
    `class:text-success={(account.glAccountType === 'Revenue' && account.balance - (account.budget || 0) > 0) || (account.glAccountType === 'Expense' && account.balance - (account.budget || 0) < 0)} class:text-error={(account.glAccountType === 'Expense' && account.balance - (account.budget || 0) > 0) || (account.glAccountType === 'Revenue' && account.balance - (account.budget || 0) < 0)}`
);

// 3. Fix Variance calculation coloring in Total Rows
// Revenue Total:
content = content.replace(
    /class:text-success=\{\$TOTAL - \$BUDGET > 0\} class:text-error=\{\$TOTAL - \$BUDGET < 0\}/g,
    `class:text-success={$TOTAL - $BUDGET > 0} class:text-error={$TOTAL - $BUDGET < 0}`
);
// Wait, the `$TOTAL` replace was done locally during generating the file. The actual content has `profitLoss.revenue.total` etc.
// Let's replace the raw revenue one:
content = content.replace(
    /class:text-success=\{profitLoss\.revenue\.total - profitLoss\.revenue\.accounts\.reduce\(\(sum, g\) => sum \+ g\.subledgerAccounts\.reduce\(\(s, a\) => s \+ \(a\.budget \|\| 0\), 0\), 0\) > 0\} class:text-error=\{profitLoss\.revenue\.total - profitLoss\.revenue\.accounts\.reduce\(\(sum, g\) => sum \+ g\.subledgerAccounts\.reduce\(\(s, a\) => s \+ \(a\.budget \|\| 0\), 0\), 0\) < 0\}/g,
    `class:text-success={profitLoss.revenue.total - profitLoss.revenue.accounts.reduce((sum, g) => sum + g.subledgerAccounts.reduce((s, a) => s + (a.budget || 0), 0), 0) > 0} class:text-error={profitLoss.revenue.total - profitLoss.revenue.accounts.reduce((sum, g) => sum + g.subledgerAccounts.reduce((s, a) => s + (a.budget || 0), 0), 0) < 0}`
);
// And expenses one:
content = content.replace(
    /class:text-success=\{profitLoss\.expenses\.total - profitLoss\.expenses\.accounts\.reduce\(\(sum, g\) => sum \+ g\.subledgerAccounts\.reduce\(\(s, a\) => s \+ \(a\.budget \|\| 0\), 0\), 0\) > 0\} class:text-error=\{profitLoss\.expenses\.total - profitLoss\.expenses\.accounts\.reduce\(\(sum, g\) => sum \+ g\.subledgerAccounts\.reduce\(\(s, a\) => s \+ \(a\.budget \|\| 0\), 0\), 0\) < 0\}/g,
    `class:text-success={profitLoss.expenses.total - profitLoss.expenses.accounts.reduce((sum, g) => sum + g.subledgerAccounts.reduce((s, a) => s + (a.budget || 0), 0), 0) < 0} class:text-error={profitLoss.expenses.total - profitLoss.expenses.accounts.reduce((sum, g) => sum + g.subledgerAccounts.reduce((s, a) => s + (a.budget || 0), 0), 0) > 0}`
);


// 4. Update the chart HTML
// We will replace the entire chart block between `<!-- Budget vs Actual Graphs -->` and `{:else}` for profit-loss.
// Let's use string manipulation to find it.

const startIdx = content.indexOf('<!-- Budget vs Actual Graphs -->');
const endIdx = content.indexOf('{:else}', startIdx);

if (startIdx !== -1 && endIdx !== -1) {
    const newChartHTML = `<!-- Budget vs Actual Graphs -->
			{#if modules.budgets}
				<div class="card bg-base-100 shadow-xl mb-6 mt-6 overflow-hidden">
					<div class="card-body">
						<h3 class="text-xl font-bold mb-6 text-center">Budget vs Actuals</h3>
						<div class="flex gap-4 justify-center mb-6 text-sm">
							<div class="flex items-center gap-2"><div class="w-3 h-3 bg-primary/30 rounded-sm"></div> Budget</div>
							<div class="flex items-center gap-2"><div class="w-3 h-3 bg-primary rounded-sm"></div> Actual (Good)</div>
							<div class="flex items-center gap-2"><div class="w-3 h-3 bg-error rounded-sm"></div> Actual (Bad Variance)</div>
						</div>
						<div class="w-full overflow-x-auto pb-4">
							<div class="flex items-end gap-6 h-64 min-w-max px-4">
								{@const allAccounts = [...profitLoss.revenue.accounts, ...profitLoss.expenses.accounts].flatMap(g => g.subledgerAccounts).filter(a => a.balance > 0 || (a.budget && a.budget > 0))}
								{@const maxAmount = Math.max(...allAccounts.flatMap(a => [a.balance, a.budget || 0])) || 1}
								{#each allAccounts as account}
									{@const budget = account.budget || 0}
									{@const actual = account.balance}
									{@const budgetHeight = (budget / maxAmount) * 100}
									{@const actualHeight = (actual / maxAmount) * 100}
									{@const isExpense = account.glAccountType === 'Expense'}
									{@const isBadVariance = (isExpense && actual > budget && budget > 0) || (!isExpense && actual < budget && budget > 0)}
									
									<div class="flex flex-col items-center gap-2 group w-24">
										<div class="flex items-end gap-1 h-48 w-full justify-center">
											<div class="w-8 bg-primary/30 rounded-t-sm transition-all duration-300 relative" style="height: {budgetHeight}%">
												<div class="opacity-0 group-hover:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 bg-base-300 text-xs py-1 px-2 rounded whitespace-nowrap pointer-events-none z-10">
													B: {formatCurrency(budget)}
												</div>
											</div>
											<div class="w-8 {isBadVariance ? 'bg-error' : 'bg-primary'} rounded-t-sm transition-all duration-300 relative" style="height: {actualHeight}%">
												<div class="opacity-0 group-hover:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 bg-base-300 text-xs py-1 px-2 rounded whitespace-nowrap pointer-events-none z-10">
													A: {formatCurrency(actual)}
												</div>
											</div>
										</div>
										<div class="text-[10px] text-center leading-tight h-8 flex items-start text-base-content/70">
											{account.accountName}
										</div>
									</div>
								{/each}
							</div>
						</div>
					</div>
				</div>
			{/if}
\t\t`;
    
    content = content.slice(0, startIdx) + newChartHTML + content.slice(endIdx);
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Variance coloring and vertical charts updated.');
