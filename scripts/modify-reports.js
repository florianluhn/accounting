import fs from 'fs';

const filePath = 'src/routes/reports/+page.svelte';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add `modules` import
if (!content.includes(`import { modules } from '$lib/modules.svelte';`)) {
	content = content.replace(
		`import {`,
		`import { modules } from '$lib/modules.svelte';\n\timport {`
	);
}

// 2. We need a helper to format the columns
const colHeaderHTML = `
										<div class="flex gap-4 text-right items-center">
											{#if modules.budgets}
												<div class="w-24 flex flex-col">
													<span class="text-[10px] text-base-content/50 uppercase leading-none mb-1">Actual</span>
													<span class="font-mono font-semibold text-sm leading-none">{formatCurrency(glGroup.totalBalance)}</span>
												</div>
												<div class="w-24 flex flex-col">
													<span class="text-[10px] text-base-content/50 uppercase leading-none mb-1">Budget</span>
													<span class="font-mono font-semibold text-sm leading-none">{formatCurrency(glGroup.subledgerAccounts.reduce((sum, a) => sum + (a.budget || 0), 0))}</span>
												</div>
												<div class="w-24 flex flex-col">
													<span class="text-[10px] text-base-content/50 uppercase leading-none mb-1">Variance</span>
													<span class="font-mono font-semibold text-sm leading-none" class:text-success={glGroup.totalBalance - glGroup.subledgerAccounts.reduce((sum, a) => sum + (a.budget || 0), 0) > 0} class:text-error={glGroup.totalBalance - glGroup.subledgerAccounts.reduce((sum, a) => sum + (a.budget || 0), 0) < 0}>
														{formatCurrency(glGroup.totalBalance - glGroup.subledgerAccounts.reduce((sum, a) => sum + (a.budget || 0), 0))}
													</span>
												</div>
											{#else}
												<span class="font-mono font-semibold text-sm">{formatCurrency(glGroup.totalBalance)}</span>
											{/if}
										</div>
`;

// Replace glGroup row amount
content = content.replace(/<span class="font-mono font-semibold text-sm">{formatCurrency\(glGroup\.totalBalance\)}<\/span>/g, colHeaderHTML);

const subColHTML = `
													<div class="flex gap-4 text-right items-center">
														{#if modules.budgets}
															<div class="w-24 text-right">
																<span class="font-mono">{formatCurrency(account.balance)}</span>
															</div>
															<div class="w-24 text-right">
																<span class="font-mono text-base-content/70">{formatCurrency(account.budget || 0)}</span>
															</div>
															<div class="w-24 text-right">
																<span class="font-mono" class:text-success={account.balance - (account.budget || 0) > 0} class:text-error={account.balance - (account.budget || 0) < 0}>
																	{formatCurrency(account.balance - (account.budget || 0))}
																</span>
															</div>
														{#else}
															<span class="font-mono">{formatCurrency(account.balance)}</span>
														{#if}
													</div>
`;
// Fix the closing #if typo in script! I will replace {#if} with {/if}
content = content.replace(/<span class="font-mono">{formatCurrency\(account\.balance\)}<\/span>/g, subColHTML.replace('{#if}', '{/if}'));

const revExpTotalHTML = `
							<div class="flex gap-4 text-right">
								{#if modules.budgets}
									<div class="w-24 font-mono">{formatCurrency($TOTAL)}</div>
									<div class="w-24 font-mono text-base-content/70">{formatCurrency($BUDGET)}</div>
									<div class="w-24 font-mono" class:text-success={$TOTAL - $BUDGET > 0} class:text-error={$TOTAL - $BUDGET < 0}>{formatCurrency($TOTAL - $BUDGET)}</div>
								{#else}
									<span class="font-mono">{formatCurrency($TOTAL)}</span>
								{/if}
							</div>
`;

content = content.replace(/<span class="font-mono">{formatCurrency\(profitLoss\.revenue\.total\)}<\/span>/, revExpTotalHTML.replace(/\$TOTAL/g, 'profitLoss.revenue.total').replace(/\$BUDGET/g, 'profitLoss.revenue.accounts.reduce((sum, g) => sum + g.subledgerAccounts.reduce((s, a) => s + (a.budget || 0), 0), 0)'));
content = content.replace(/<span class="font-mono">{formatCurrency\(profitLoss\.expenses\.total\)}<\/span>/, revExpTotalHTML.replace(/\$TOTAL/g, 'profitLoss.expenses.total').replace(/\$BUDGET/g, 'profitLoss.expenses.accounts.reduce((sum, g) => sum + g.subledgerAccounts.reduce((s, a) => s + (a.budget || 0), 0), 0)'));


fs.writeFileSync(filePath, content, 'utf8');
console.log('Modified reports page successfully.');
