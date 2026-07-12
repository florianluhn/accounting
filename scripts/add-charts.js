import fs from 'fs';

const filePath = 'src/routes/reports/+page.svelte';
let content = fs.readFileSync(filePath, 'utf8');

const chartsHTML = `
				</div>
			</div>

			<!-- Budget vs Actual Graphs -->
			{#if modules.budgets}
				<div class="card bg-base-100 shadow-xl mb-6 mt-6">
					<div class="card-body">
						<h3 class="text-xl font-bold mb-4">Budget vs Actual Graphs</h3>
						<div class="space-y-6">
							{#each [...profitLoss.revenue.accounts, ...profitLoss.expenses.accounts] as glGroup}
								{#each glGroup.subledgerAccounts as account}
									{#if account.balance > 0 || (account.budget && account.budget > 0)}
										{@const budget = account.budget || 0}
										{@const actual = account.balance}
										{@const maxVal = Math.max(budget, actual) || 1}
										{@const budgetPct = (budget / maxVal) * 100}
										{@const actualPct = (actual / maxVal) * 100}
										<div>
											<div class="flex justify-between text-sm mb-1">
												<span class="font-semibold">{account.accountNumber} - {account.accountName}</span>
												<span class="text-base-content/70">
													Actual: <span class="font-mono font-medium text-base-content">{formatCurrency(actual)}</span> / 
													Budget: <span class="font-mono">{formatCurrency(budget)}</span>
												</span>
											</div>
											<div class="w-full bg-base-200 rounded-full h-2.5 mb-1 relative overflow-hidden">
												<!-- Budget background bar -->
												<div class="bg-primary/20 h-2.5 rounded-full absolute top-0 left-0" style="width: {budgetPct}%"></div>
												<!-- Actual foreground bar -->
												<div class="h-2.5 rounded-full absolute top-0 left-0 {actual > budget && budget > 0 ? 'bg-error' : 'bg-primary'}" style="width: {actualPct}%"></div>
											</div>
										</div>
									{/if}
								{/each}
							{/each}
						</div>
					</div>
				</div>
			{/if}
`;

content = content.replace(/\t\t\t\t<\/div>\n\t\t\t<\/div>\n\t\t\{:else\}/, chartsHTML + '\t\t{:else}');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Added charts section successfully.');
