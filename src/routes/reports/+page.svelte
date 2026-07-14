<script lang="ts">
	import { modules } from '$lib/modules.svelte';
	import {
		reportsAPI,
		currenciesAPI,
		subledgerAccountsAPI,
		type BalanceSheetReport,
		type ProfitLossReport,
		type TrialBalanceReport,
		type GLAccountGroup,
		type AccountBalance,
		type CategoryBreakdown,
		type JournalEntry,
		type Currency,
		type SubledgerAccount
	} from '$lib/api';

	type ReportType = 'balance-sheet' | 'profit-loss' | 'trial-balance';

	let activeReport = $state<ReportType>('balance-sheet');
	let currencies = $state<Currency[]>([]);
	let selectedCurrency = $state('USD');
	let loading = $state(false);
	let error = $state('');

	// Get local date in YYYY-MM-DD format (without timezone conversion)
	function getLocalDateString(date?: Date): string {
		const d = date || new Date();
		const year = d.getFullYear();
		const month = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	// Convert YYYY-MM-DD string to Date (backend will handle time boundaries in UTC)
	function parseLocalDateStart(dateString: string): Date {
		// Just parse the date string - backend will set to 00:00:00 UTC
		return new Date(dateString);
	}

	// Convert YYYY-MM-DD string to Date (backend will handle time boundaries in UTC)
	function parseLocalDateEnd(dateString: string): Date {
		// Just parse the date string - backend will set to 23:59:59.999 UTC
		return new Date(dateString);
	}

	// Date filters
	let startDate = $state(getLocalDateString(new Date(new Date().getFullYear(), 0, 1)));
	let endDate = $state(getLocalDateString());

	// Report data
	let balanceSheet = $state<BalanceSheetReport | null>(null);
	let profitLoss = $state<ProfitLossReport | null>(null);
	let trialBalance = $state<TrialBalanceReport | null>(null);

	// Drill-down state
	let expandedGLAccounts = $state<Set<number>>(new Set());
	let expandedSubledgers = $state<Set<number>>(new Set());
	let subledgerCategories = $state<Map<number, CategoryBreakdown[]>>(new Map());
	let loadingCategories = $state<Set<number>>(new Set());

	// Journal entries modal state
	let showEntriesModal = $state(false);
	let modalEntries = $state<JournalEntry[]>([]);
	let modalTitle = $state('');
	let loadingEntries = $state(false);
	let subledgerAccounts = $state<SubledgerAccount[]>([]);

	$effect(() => {
		loadCurrencies();
		loadSubledgerAccounts();
	});

	async function loadCurrencies() {
		try {
			currencies = await currenciesAPI.list();
			const defaultCurrency = currencies.find(c => c.isDefault);
			if (defaultCurrency) {
				selectedCurrency = defaultCurrency.code;
			}
		} catch (e) {
			console.error('Error loading currencies:', e);
		}
	}

	async function loadSubledgerAccounts() {
		try {
			subledgerAccounts = await subledgerAccountsAPI.list();
		} catch (e) {
			console.error('Error loading subledger accounts:', e);
		}
	}

	async function generateReport() {
		try {
			loading = true;
			error = '';
			// Reset drill-down state
			expandedGLAccounts = new Set();
			expandedSubledgers = new Set();
			subledgerCategories = new Map();

			if (activeReport === 'balance-sheet') {
				balanceSheet = await reportsAPI.balanceSheet({
					endDate: parseLocalDateEnd(endDate),
					currencyCode: selectedCurrency
				});
			} else if (activeReport === 'profit-loss') {
				profitLoss = await reportsAPI.profitLoss({
					startDate: parseLocalDateStart(startDate),
					endDate: parseLocalDateEnd(endDate),
					currencyCode: selectedCurrency
				});
			} else if (activeReport === 'trial-balance') {
				trialBalance = await reportsAPI.trialBalance({
					endDate: parseLocalDateEnd(endDate),
					currencyCode: selectedCurrency
				});
			}
		} catch (e) {
			console.error('Error generating report:', e);
			error = e instanceof Error ? e.message : 'Failed to generate report';
		} finally {
			loading = false;
		}
	}

	function formatCurrency(amount: number): string {
		const currency = currencies.find(c => c.code === selectedCurrency);
		return `${currency?.symbol || selectedCurrency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	function formatDate(date: Date | string): string {
		const d = new Date(date);
		// Format using UTC to avoid timezone conversion issues
		const year = d.getUTCFullYear();
		const month = String(d.getUTCMonth() + 1).padStart(2, '0');
		const day = String(d.getUTCDate()).padStart(2, '0');
		return `${month}/${day}/${year}`;
	}

	function toggleGLAccount(glAccountId: number) {
		const next = new Set(expandedGLAccounts);
		if (next.has(glAccountId)) {
			next.delete(glAccountId);
		} else {
			next.add(glAccountId);
		}
		expandedGLAccounts = next;
	}

	async function toggleSubledger(accountId: number) {
		const next = new Set(expandedSubledgers);
		if (next.has(accountId)) {
			next.delete(accountId);
			expandedSubledgers = next;
		} else {
			next.add(accountId);
			expandedSubledgers = next;

			// Load categories if not yet loaded
			if (!subledgerCategories.has(accountId)) {
				const loadingNext = new Set(loadingCategories);
				loadingNext.add(accountId);
				loadingCategories = loadingNext;

				try {
					const result = await reportsAPI.subledgerCategories(accountId, {
						startDate: parseLocalDateStart(startDate),
						endDate: parseLocalDateEnd(endDate)
					});
					const catMap = new Map(subledgerCategories);
					catMap.set(accountId, result.categories);
					subledgerCategories = catMap;
				} catch (e) {
					console.error('Error loading categories:', e);
				} finally {
					const loadingDone = new Set(loadingCategories);
					loadingDone.delete(accountId);
					loadingCategories = loadingDone;
				}
			}
		}
	}

	async function showCategoryEntries(accountId: number, accountName: string, category: string) {
		loadingEntries = true;
		showEntriesModal = true;
		modalTitle = `${accountName} — ${category}`;
		modalEntries = [];

		try {
			const result = await reportsAPI.categoryEntries(accountId, {
				startDate: parseLocalDateStart(startDate),
				endDate: parseLocalDateEnd(endDate),
				category
			});
			modalEntries = result.entries;
		} catch (e) {
			console.error('Error loading category entries:', e);
		} finally {
			loadingEntries = false;
		}
	}

	function closeModal() {
		showEntriesModal = false;
		modalEntries = [];
		modalTitle = '';
	}

	function getAccountName(id: number): string {
		const account = subledgerAccounts.find(a => a.id === id);
		return account ? `${account.accountNumber} - ${account.name}` : `Account #${id}`;
	}

	/** Account has an explicit budget amount (budgetless accounts are ignored for variance / graphs). */
	function hasBudget(account: AccountBalance): boolean {
		return (account.budget ?? 0) > 0;
	}

	function budgetedSubledgers(group: GLAccountGroup): AccountBalance[] {
		return group.subledgerAccounts.filter(hasBudget);
	}

	function sumBudget(accounts: AccountBalance[]): number {
		return accounts.reduce((sum, a) => sum + (a.budget || 0), 0);
	}

	function sumActual(accounts: AccountBalance[]): number {
		return accounts.reduce((sum, a) => sum + a.balance, 0);
	}

	/** Variance for budgeted accounts only: actual − budget. */
	function budgetedVariance(accounts: AccountBalance[]): number {
		const budgeted = accounts.filter(hasBudget);
		return sumActual(budgeted) - sumBudget(budgeted);
	}

	function groupBudgetedVariance(group: GLAccountGroup): number {
		return budgetedVariance(group.subledgerAccounts);
	}

	function groupBudgetTotal(group: GLAccountGroup): number {
		return sumBudget(budgetedSubledgers(group));
	}

	function sectionBudgetTotal(groups: GLAccountGroup[]): number {
		return groups.reduce((sum, g) => sum + groupBudgetTotal(g), 0);
	}

	function sectionBudgetedVariance(groups: GLAccountGroup[]): number {
		return groups.reduce((sum, g) => sum + groupBudgetedVariance(g), 0);
	}

	/** App uses Profit/Loss; accept Revenue/Expense aliases too. */
	function isExpenseType(accountType: string): boolean {
		return accountType === 'Loss' || accountType === 'Expense';
	}

	/**
	 * Variance = actual − budget.
	 * Expenses (Loss): under budget is good (negative variance).
	 * Revenue (Profit): over budget is good (positive variance).
	 */
	function isFavorableVariance(variance: number, accountType: string): boolean {
		if (variance === 0) return false;
		if (isExpenseType(accountType)) return variance < 0;
		return variance > 0;
	}

	function isUnfavorableVariance(variance: number, accountType: string): boolean {
		if (variance === 0) return false;
		if (isExpenseType(accountType)) return variance > 0;
		return variance < 0;
	}
</script>

<div class="max-w-7xl mx-auto">
	<!-- Header -->
	<div class="mb-8">
		<h1 class="text-4xl font-bold mb-2">Financial Reports</h1>
		<p class="text-base-content/70">Balance Sheet, P&L, and other financial statements</p>
	</div>

	{#if error}
		<div class="alert alert-error mb-6">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="stroke-current shrink-0 h-6 w-6"
				fill="none"
				viewBox="0 0 24 24"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
				/>
			</svg>
			<span>{error}</span>
		</div>
	{/if}

	<!-- Report Type Selector -->
	<div role="tablist" class="tabs tabs-boxed mb-6">
		<button
			role="tab"
			class="tab"
			class:tab-active={activeReport === 'balance-sheet'}
			onclick={() => { activeReport = 'balance-sheet'; balanceSheet = null; }}
		>
			Balance Sheet
		</button>
		<button
			role="tab"
			class="tab"
			class:tab-active={activeReport === 'profit-loss'}
			onclick={() => { activeReport = 'profit-loss'; profitLoss = null; }}
		>
			Profit & Loss
		</button>
		<button
			role="tab"
			class="tab"
			class:tab-active={activeReport === 'trial-balance'}
			onclick={() => { activeReport = 'trial-balance'; trialBalance = null; }}
		>
			Trial Balance
		</button>
	</div>

	<!-- Date Range & Currency Selector -->
	<div class="card bg-base-100 shadow-xl mb-6">
		<div class="card-body">
			<div class="flex gap-4 items-end flex-wrap">
				{#if activeReport !== 'balance-sheet'}
					<div class="form-control">
						<label class="label">
							<span class="label-text">From Date</span>
						</label>
						<input type="date" class="input input-bordered" bind:value={startDate} />
					</div>
				{/if}
				<div class="form-control">
					<label class="label">
						<span class="label-text">
							{activeReport === 'balance-sheet' ? 'As of Date' : 'To Date'}
						</span>
					</label>
					<input type="date" class="input input-bordered" bind:value={endDate} />
				</div>
				<div class="form-control">
					<label class="label">
						<span class="label-text">Currency</span>
					</label>
					<select class="select select-bordered" bind:value={selectedCurrency}>
						{#each currencies as currency}
							<option value={currency.code}>
								{currency.code} - {currency.name}
							</option>
						{/each}
					</select>
				</div>
				<button class="btn btn-primary" onclick={generateReport} disabled={loading}>
					{#if loading}
						<span class="loading loading-spinner"></span>
						Generating...
					{:else}
						Generate Report
					{/if}
				</button>
			</div>
		</div>
	</div>

	<!-- Balance Sheet Report -->
	{#if activeReport === 'balance-sheet'}
		{#if balanceSheet}
			<div class="card bg-base-100 shadow-xl mb-6">
				<div class="card-body">
					<div class="text-center mb-6">
						<h2 class="text-2xl font-bold">Balance Sheet</h2>
						<p class="text-base-content/70">As of {formatDate(balanceSheet.asOfDate)}</p>
						<p class="text-base-content/70">Currency: {balanceSheet.currencyCode}</p>
					</div>

					<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
						<!-- Assets -->
						<div>
							<h3 class="text-xl font-bold mb-4">Assets</h3>
							{#if balanceSheet.assets.accounts.length === 0}
								<p class="text-base-content/70 mb-4">No asset accounts</p>
							{:else}
								<div class="space-y-1">
									{#each balanceSheet.assets.accounts as glGroup}
										<!-- GL Account Row (clickable) -->
										<button
											class="flex justify-between items-center w-full py-2 px-3 rounded-lg hover:bg-base-200 transition-colors cursor-pointer text-left"
											onclick={() => toggleGLAccount(glGroup.glAccountId)}
										>
											<span class="flex items-center gap-2">
												<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 transition-transform {expandedGLAccounts.has(glGroup.glAccountId) ? 'rotate-90' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
												</svg>
												<span class="font-semibold text-sm">{glGroup.glAccountNumber} - {glGroup.glAccountName}</span>
											</span>
											<span class="font-mono font-semibold text-sm">{formatCurrency(glGroup.totalBalance)}</span>
										</button>
										<!-- Expanded Subledger Accounts -->
										{#if expandedGLAccounts.has(glGroup.glAccountId)}
											<div class="ml-8 border-l-2 border-base-300 pl-3">
												{#each glGroup.subledgerAccounts as account}
													<div class="flex justify-between items-center py-1.5 text-sm text-base-content/80">
														<span>{account.accountNumber} - {account.accountName}</span>
														<span class="font-mono">{formatCurrency(account.balance)}</span>
													</div>
												{/each}
											</div>
										{/if}
									{/each}
								</div>
							{/if}

							<div class="divider"></div>
							<div class="flex justify-between font-bold text-lg">
								<span>Total Assets</span>
								<span class="font-mono">{formatCurrency(balanceSheet.assets.total)}</span>
							</div>
						</div>

						<!-- Liabilities & Equity -->
						<div>
							<h3 class="text-xl font-bold mb-4">Liabilities & Equity</h3>

							<h4 class="font-semibold mb-2">Liabilities</h4>
							{#if balanceSheet.liabilities.accounts.length === 0}
								<p class="text-base-content/70 text-sm mb-4">No liability accounts</p>
							{:else}
								<div class="space-y-1">
									{#each balanceSheet.liabilities.accounts as glGroup}
										<button
											class="flex justify-between items-center w-full py-2 px-3 rounded-lg hover:bg-base-200 transition-colors cursor-pointer text-left"
											onclick={() => toggleGLAccount(glGroup.glAccountId)}
										>
											<span class="flex items-center gap-2">
												<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 transition-transform {expandedGLAccounts.has(glGroup.glAccountId) ? 'rotate-90' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
												</svg>
												<span class="font-semibold text-sm">{glGroup.glAccountNumber} - {glGroup.glAccountName}</span>
											</span>
											<span class="font-mono font-semibold text-sm">{formatCurrency(glGroup.totalBalance)}</span>
										</button>
										{#if expandedGLAccounts.has(glGroup.glAccountId)}
											<div class="ml-8 border-l-2 border-base-300 pl-3">
												{#each glGroup.subledgerAccounts as account}
													<div class="flex justify-between items-center py-1.5 text-sm text-base-content/80">
														<span>{account.accountNumber} - {account.accountName}</span>
														<span class="font-mono">{formatCurrency(account.balance)}</span>
													</div>
												{/each}
											</div>
										{/if}
									{/each}
								</div>
							{/if}
							<div class="flex justify-between font-semibold mt-2">
								<span>Total Liabilities</span>
								<span class="font-mono">{formatCurrency(balanceSheet.liabilities.total)}</span>
							</div>

							<div class="divider"></div>

							<h4 class="font-semibold mb-2">Equity</h4>
							{#if balanceSheet.equity.accounts.length === 0}
								<p class="text-base-content/70 text-sm mb-4">No equity accounts</p>
							{:else}
								<div class="space-y-1">
									{#each balanceSheet.equity.accounts as glGroup}
										<button
											class="flex justify-between items-center w-full py-2 px-3 rounded-lg hover:bg-base-200 transition-colors cursor-pointer text-left"
											onclick={() => toggleGLAccount(glGroup.glAccountId)}
										>
											<span class="flex items-center gap-2">
												<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 transition-transform {expandedGLAccounts.has(glGroup.glAccountId) ? 'rotate-90' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
												</svg>
												<span class="font-semibold text-sm">{glGroup.glAccountNumber} - {glGroup.glAccountName}</span>
											</span>
											<span class="font-mono font-semibold text-sm">{formatCurrency(glGroup.totalBalance)}</span>
										</button>
										{#if expandedGLAccounts.has(glGroup.glAccountId)}
											<div class="ml-8 border-l-2 border-base-300 pl-3">
												{#each glGroup.subledgerAccounts as account}
													<div class="flex justify-between items-center py-1.5 text-sm text-base-content/80">
														<span>{account.accountNumber} - {account.accountName}</span>
														<span class="font-mono">{formatCurrency(account.balance)}</span>
													</div>
												{/each}
											</div>
										{/if}
									{/each}
								</div>
							{/if}
							<table class="table table-sm">
								<tbody>
									<tr>
										<td class="text-sm">Retained Earnings</td>
										<td class="text-right font-mono">
											{formatCurrency(balanceSheet.equity.retainedEarnings)}
										</td>
									</tr>
								</tbody>
							</table>
							<div class="flex justify-between font-semibold mt-2">
								<span>Total Equity</span>
								<span class="font-mono">{formatCurrency(balanceSheet.equity.total)}</span>
							</div>

							<div class="divider"></div>

							<div class="flex justify-between font-bold text-lg">
								<span>Total Liabilities & Equity</span>
								<span class="font-mono">{formatCurrency(balanceSheet.totalLiabilitiesAndEquity)}</span>
							</div>

							{#if balanceSheet.balanced}
								<div class="alert alert-success mt-4">
									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="stroke-current shrink-0 h-6 w-6"
										fill="none"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
										/>
									</svg>
									<span>Balance Sheet is balanced ✓</span>
								</div>
							{:else}
								<div class="alert alert-error mt-4">
									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="stroke-current shrink-0 h-6 w-6"
										fill="none"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
										/>
									</svg>
									<span>Warning: Balance Sheet is not balanced!</span>
								</div>
							{/if}
						</div>
					</div>

				</div>
			</div>{:else}
			<div class="card bg-base-100 shadow-xl">
				<div class="card-body">
					<div class="alert alert-info">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 24 24"
							class="stroke-current shrink-0 w-6 h-6"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
							></path>
						</svg>
						<span>Click "Generate Report" to view the Balance Sheet</span>
					</div>
				</div>
			</div>
		{/if}
	{/if}

	<!-- Profit & Loss Report -->
	{#if activeReport === 'profit-loss'}
		{#if profitLoss}
			<div class="card bg-base-100 shadow-xl mb-6">
				<div class="card-body">
					<div class="text-center mb-6">
						<h2 class="text-2xl font-bold">Profit & Loss Statement</h2>
						<p class="text-base-content/70">
							{formatDate(profitLoss.startDate)} to {formatDate(profitLoss.endDate)}
						</p>
						<p class="text-base-content/70">Currency: {profitLoss.currencyCode}</p>
					</div>

					<!-- Revenue -->
					<div class="mb-6">
						<h3 class="text-xl font-bold mb-4">Revenue</h3>
						{#if profitLoss.revenue.accounts.length === 0}
							<p class="text-base-content/70 mb-4">No revenue accounts</p>
						{:else}
							<div class="space-y-1">
								{#each profitLoss.revenue.accounts as glGroup}
									<!-- GL Account Row -->
									<button
										class="flex justify-between items-center w-full py-2 px-3 rounded-lg hover:bg-base-200 transition-colors cursor-pointer text-left"
										onclick={() => toggleGLAccount(glGroup.glAccountId)}
									>
										<span class="flex items-center gap-2">
											<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 transition-transform {expandedGLAccounts.has(glGroup.glAccountId) ? 'rotate-90' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
											</svg>
											<span class="font-semibold text-sm">{glGroup.glAccountNumber} - {glGroup.glAccountName}</span>
										</span>
										
										<div class="flex gap-4 text-right items-center">
											{#if modules.budgets}
												{@const gVar = groupBudgetedVariance(glGroup)}
												{@const gBud = groupBudgetTotal(glGroup)}
												<div class="w-24 flex flex-col">
													<span class="text-[10px] text-base-content/50 uppercase leading-none mb-1">Actual</span>
													<span class="font-mono font-semibold text-sm leading-none">{formatCurrency(glGroup.totalBalance)}</span>
												</div>
												<div class="w-24 flex flex-col">
													<span class="text-[10px] text-base-content/50 uppercase leading-none mb-1">Budget</span>
													<span class="font-mono font-semibold text-sm leading-none">{formatCurrency(gBud)}</span>
												</div>
												<div class="w-24 flex flex-col">
													<span class="text-[10px] text-base-content/50 uppercase leading-none mb-1">Variance</span>
													{#if gBud > 0}
														<span class="font-mono font-semibold text-sm leading-none" class:text-success={isFavorableVariance(gVar, glGroup.glAccountType)} class:text-error={isUnfavorableVariance(gVar, glGroup.glAccountType)}>
															{formatCurrency(gVar)}
														</span>
													{:else}
														<span class="font-mono font-semibold text-sm leading-none text-base-content/40">—</span>
													{/if}
												</div>
											{:else}
												<span class="font-mono font-semibold text-sm">{formatCurrency(glGroup.totalBalance)}</span>
											{/if}
										</div>

									</button>
									<!-- Expanded: Subledger accounts with category drill-down -->
									{#if expandedGLAccounts.has(glGroup.glAccountId)}
										<div class="ml-8 border-l-2 border-base-300 pl-3">
											{#each glGroup.subledgerAccounts as account}
												<!-- Subledger row (clickable for category drill-down) -->
												<button
													class="flex justify-between items-center w-full py-1.5 text-sm text-base-content/80 hover:bg-base-200 rounded px-2 cursor-pointer text-left"
													onclick={() => toggleSubledger(account.accountId)}
												>
													<span class="flex items-center gap-2">
														<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 transition-transform {expandedSubledgers.has(account.accountId) ? 'rotate-90' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
															<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
														</svg>
														<span>{account.accountNumber} - {account.accountName}</span>
													</span>
													
													<div class="flex gap-4 text-right items-center">
														{#if modules.budgets}
															{@const aVar = account.balance - (account.budget || 0)}
															<div class="w-24 text-right">
																<span class="font-mono">{formatCurrency(account.balance)}</span>
															</div>
															<div class="w-24 text-right">
																<span class="font-mono text-base-content/70">{hasBudget(account) ? formatCurrency(account.budget || 0) : '—'}</span>
															</div>
															<div class="w-24 text-right">
																{#if hasBudget(account)}
																	<span class="font-mono" class:text-success={isFavorableVariance(aVar, account.glAccountType)} class:text-error={isUnfavorableVariance(aVar, account.glAccountType)}>
																		{formatCurrency(aVar)}
																	</span>
																{:else}
																	<span class="font-mono text-base-content/40">—</span>
																{/if}
															</div>
														{:else}
															<span class="font-mono">{formatCurrency(account.balance)}</span>
														{/if}
													</div>

												</button>
												<!-- Expanded: Categories -->
												{#if expandedSubledgers.has(account.accountId)}
													<div class="ml-7 border-l-2 border-base-300/50 pl-3 mb-1">
														{#if loadingCategories.has(account.accountId)}
															<div class="py-2 text-xs text-base-content/60">
																<span class="loading loading-spinner loading-xs"></span> Loading categories...
															</div>
														{:else if subledgerCategories.has(account.accountId)}
															{#each subledgerCategories.get(account.accountId) || [] as cat}
																<div class="flex justify-between items-center py-1 text-xs text-base-content/70">
																	<span class="italic">{cat.category}</span>
																	<button
																		class="font-mono hover:text-primary hover:underline cursor-pointer"
																		onclick={() => showCategoryEntries(account.accountId, `${account.accountNumber} - ${account.accountName}`, cat.category)}
																	>
																		{formatCurrency(cat.balance)}
																	</button>
																</div>
															{/each}
															{#if (subledgerCategories.get(account.accountId) || []).length === 0}
																<p class="text-xs text-base-content/50 py-1">No entries</p>
															{/if}
														{/if}
													</div>
												{/if}
											{/each}
										</div>
									{/if}
								{/each}
							</div>
						{/if}
						<div class="divider"></div>
						<div class="flex justify-between font-bold">
							<span>Total Revenue</span>
							
							<div class="flex gap-4 text-right">
								{#if modules.budgets}
									{@const revBudget = sectionBudgetTotal(profitLoss.revenue.accounts)}
									{@const revVar = sectionBudgetedVariance(profitLoss.revenue.accounts)}
									<div class="w-24 font-mono">{formatCurrency(profitLoss.revenue.total)}</div>
									<div class="w-24 font-mono text-base-content/70">{formatCurrency(revBudget)}</div>
									<div class="w-24 font-mono" class:text-success={isFavorableVariance(revVar, 'Profit')} class:text-error={isUnfavorableVariance(revVar, 'Profit')}>{formatCurrency(revVar)}</div>
								{:else}
									<span class="font-mono">{formatCurrency(profitLoss.revenue.total)}</span>
								{/if}
							</div>

						</div>
					</div>

					<!-- Expenses -->
					<div class="mb-6">
						<h3 class="text-xl font-bold mb-4">Expenses</h3>
						{#if profitLoss.expenses.accounts.length === 0}
							<p class="text-base-content/70 mb-4">No expense accounts</p>
						{:else}
							<div class="space-y-1">
								{#each profitLoss.expenses.accounts as glGroup}
									<button
										class="flex justify-between items-center w-full py-2 px-3 rounded-lg hover:bg-base-200 transition-colors cursor-pointer text-left"
										onclick={() => toggleGLAccount(glGroup.glAccountId)}
									>
										<span class="flex items-center gap-2">
											<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 transition-transform {expandedGLAccounts.has(glGroup.glAccountId) ? 'rotate-90' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
											</svg>
											<span class="font-semibold text-sm">{glGroup.glAccountNumber} - {glGroup.glAccountName}</span>
										</span>
										
										<div class="flex gap-4 text-right items-center">
											{#if modules.budgets}
												{@const gVar = groupBudgetedVariance(glGroup)}
												{@const gBud = groupBudgetTotal(glGroup)}
												<div class="w-24 flex flex-col">
													<span class="text-[10px] text-base-content/50 uppercase leading-none mb-1">Actual</span>
													<span class="font-mono font-semibold text-sm leading-none">{formatCurrency(glGroup.totalBalance)}</span>
												</div>
												<div class="w-24 flex flex-col">
													<span class="text-[10px] text-base-content/50 uppercase leading-none mb-1">Budget</span>
													<span class="font-mono font-semibold text-sm leading-none">{formatCurrency(gBud)}</span>
												</div>
												<div class="w-24 flex flex-col">
													<span class="text-[10px] text-base-content/50 uppercase leading-none mb-1">Variance</span>
													{#if gBud > 0}
														<span class="font-mono font-semibold text-sm leading-none" class:text-success={isFavorableVariance(gVar, glGroup.glAccountType)} class:text-error={isUnfavorableVariance(gVar, glGroup.glAccountType)}>
															{formatCurrency(gVar)}
														</span>
													{:else}
														<span class="font-mono font-semibold text-sm leading-none text-base-content/40">—</span>
													{/if}
												</div>
											{:else}
												<span class="font-mono font-semibold text-sm">{formatCurrency(glGroup.totalBalance)}</span>
											{/if}
										</div>

									</button>
									{#if expandedGLAccounts.has(glGroup.glAccountId)}
										<div class="ml-8 border-l-2 border-base-300 pl-3">
											{#each glGroup.subledgerAccounts as account}
												<button
													class="flex justify-between items-center w-full py-1.5 text-sm text-base-content/80 hover:bg-base-200 rounded px-2 cursor-pointer text-left"
													onclick={() => toggleSubledger(account.accountId)}
												>
													<span class="flex items-center gap-2">
														<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 transition-transform {expandedSubledgers.has(account.accountId) ? 'rotate-90' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
															<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
														</svg>
														<span>{account.accountNumber} - {account.accountName}</span>
													</span>
													
													<div class="flex gap-4 text-right items-center">
														{#if modules.budgets}
															{@const aVar = account.balance - (account.budget || 0)}
															<div class="w-24 text-right">
																<span class="font-mono">{formatCurrency(account.balance)}</span>
															</div>
															<div class="w-24 text-right">
																<span class="font-mono text-base-content/70">{hasBudget(account) ? formatCurrency(account.budget || 0) : '—'}</span>
															</div>
															<div class="w-24 text-right">
																{#if hasBudget(account)}
																	<span class="font-mono" class:text-success={isFavorableVariance(aVar, account.glAccountType)} class:text-error={isUnfavorableVariance(aVar, account.glAccountType)}>
																		{formatCurrency(aVar)}
																	</span>
																{:else}
																	<span class="font-mono text-base-content/40">—</span>
																{/if}
															</div>
														{:else}
															<span class="font-mono">{formatCurrency(account.balance)}</span>
														{/if}
													</div>

												</button>
												{#if expandedSubledgers.has(account.accountId)}
													<div class="ml-7 border-l-2 border-base-300/50 pl-3 mb-1">
														{#if loadingCategories.has(account.accountId)}
															<div class="py-2 text-xs text-base-content/60">
																<span class="loading loading-spinner loading-xs"></span> Loading categories...
															</div>
														{:else if subledgerCategories.has(account.accountId)}
															{#each subledgerCategories.get(account.accountId) || [] as cat}
																<div class="flex justify-between items-center py-1 text-xs text-base-content/70">
																	<span class="italic">{cat.category}</span>
																	<button
																		class="font-mono hover:text-primary hover:underline cursor-pointer"
																		onclick={() => showCategoryEntries(account.accountId, `${account.accountNumber} - ${account.accountName}`, cat.category)}
																	>
																		{formatCurrency(cat.balance)}
																	</button>
																</div>
															{/each}
															{#if (subledgerCategories.get(account.accountId) || []).length === 0}
																<p class="text-xs text-base-content/50 py-1">No entries</p>
															{/if}
														{/if}
													</div>
												{/if}
											{/each}
										</div>
									{/if}
								{/each}
							</div>
						{/if}
						<div class="divider"></div>
						<div class="flex justify-between font-bold">
							<span>Total Expenses</span>
							
							<div class="flex gap-4 text-right">
								{#if modules.budgets}
									{@const expBudget = sectionBudgetTotal(profitLoss.expenses.accounts)}
									{@const expVar = sectionBudgetedVariance(profitLoss.expenses.accounts)}
									<div class="w-24 font-mono">{formatCurrency(profitLoss.expenses.total)}</div>
									<div class="w-24 font-mono text-base-content/70">{formatCurrency(expBudget)}</div>
									<div class="w-24 font-mono" class:text-success={isFavorableVariance(expVar, 'Loss')} class:text-error={isUnfavorableVariance(expVar, 'Loss')}>{formatCurrency(expVar)}</div>
								{:else}
									<span class="font-mono">{formatCurrency(profitLoss.expenses.total)}</span>
								{/if}
							</div>

						</div>
					</div>

					<!-- Net Income -->
					<div class="divider my-6"></div>
					<div class="flex justify-between text-2xl font-bold" class:text-success={profitLoss.netIncome > 0} class:text-error={profitLoss.netIncome < 0}>
						<span>Net Income</span>
						<span class="font-mono">{formatCurrency(profitLoss.netIncome)}</span>
					</div>
				</div>
			</div>


			<!-- Budget vs Actual Graphs (only accounts with a budget) -->
			{#if modules.budgets}
				{@const budgetedAccounts = [...profitLoss.revenue.accounts, ...profitLoss.expenses.accounts]
					.flatMap(g => g.subledgerAccounts)
					.filter(hasBudget)}
				{@const maxAmount = budgetedAccounts.length > 0
					? Math.max(...budgetedAccounts.flatMap(a => [a.balance, a.budget || 0]), 1)
					: 1}

				{#if budgetedAccounts.length > 0}
				<div class="card bg-base-100 shadow-xl mb-6 mt-6 overflow-hidden">
					<div class="card-body">
						<h3 class="text-xl font-bold mb-6 text-center">Budget vs Actuals</h3>
						<p class="text-center text-xs text-base-content/50 -mt-4 mb-4">Only accounts with a budget are shown</p>
						<div class="flex gap-4 justify-center mb-6 text-sm">
							<div class="flex items-center gap-2"><div class="w-3 h-3 bg-primary/30 rounded-sm"></div> Budget</div>
							<div class="flex items-center gap-2"><div class="w-3 h-3 bg-primary rounded-sm"></div> Actual (Good)</div>
							<div class="flex items-center gap-2"><div class="w-3 h-3 bg-error rounded-sm"></div> Actual (Bad Variance)</div>
						</div>
						<div class="w-full overflow-x-auto pb-4">
							<div class="flex items-end gap-6 h-64 min-w-max px-4">
								{#each budgetedAccounts as account}
									{@const budget = account.budget || 0}
									{@const actual = account.balance}
									{@const budgetHeight = (budget / maxAmount) * 100}
									{@const actualHeight = (actual / maxAmount) * 100}
									{@const variance = actual - budget}
									{@const isBadVariance = isUnfavorableVariance(variance, account.glAccountType)}
									
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
			{/if}
		{:else}
			<div class="card bg-base-100 shadow-xl">
				<div class="card-body">
					<div class="alert alert-info">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 24 24"
							class="stroke-current shrink-0 w-6 h-6"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
							></path>
						</svg>
						<span>Click "Generate Report" to view the Profit & Loss Statement</span>
					</div>
				</div>
			</div>
		{/if}
	{/if}

	<!-- Trial Balance Report -->
	{#if activeReport === 'trial-balance'}
		{#if trialBalance}
			<div class="card bg-base-100 shadow-xl mb-6">
				<div class="card-body">
					<div class="text-center mb-6">
						<h2 class="text-2xl font-bold">Trial Balance</h2>
						<p class="text-base-content/70">As of {formatDate(trialBalance.asOfDate)}</p>
						<p class="text-base-content/70">Currency: {trialBalance.currencyCode}</p>
					</div>

					{#if trialBalance.accounts.length === 0}
						<div class="alert alert-info">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								fill="none"
								viewBox="0 0 24 24"
								class="stroke-current shrink-0 w-6 h-6"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
								></path>
							</svg>
							<span>No accounts with balances</span>
						</div>
					{:else}
						<div class="overflow-x-auto">
							<table class="table">
								<thead>
									<tr>
										<th>Account Number</th>
										<th>Account Name</th>
										<th class="text-right">Debit</th>
										<th class="text-right">Credit</th>
									</tr>
								</thead>
								<tbody>
									{#each trialBalance.accounts as account}
										<tr>
											<td class="font-mono">{account.accountNumber}</td>
											<td>{account.accountName}</td>
											<td class="text-right font-mono">
												{account.debit > 0 ? formatCurrency(account.debit) : ''}
											</td>
											<td class="text-right font-mono">
												{account.credit > 0 ? formatCurrency(account.credit) : ''}
											</td>
										</tr>
									{/each}
								</tbody>
								<tfoot>
									<tr class="font-bold">
										<td colspan="2">Total</td>
										<td class="text-right font-mono">{formatCurrency(trialBalance.totalDebits)}</td>
										<td class="text-right font-mono">{formatCurrency(trialBalance.totalCredits)}</td>
									</tr>
								</tfoot>
							</table>
						</div>

						{#if trialBalance.balanced}
							<div class="alert alert-success mt-6">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="stroke-current shrink-0 h-6 w-6"
									fill="none"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
									/>
								</svg>
								<span>Trial Balance is balanced ✓</span>
							</div>
						{:else}
							<div class="alert alert-error mt-6">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="stroke-current shrink-0 h-6 w-6"
									fill="none"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
									/>
								</svg>
								<span>Warning: Trial Balance is not balanced!</span>
							</div>
						{/if}
					{/if}
				</div>
			</div>
		{:else}
			<div class="card bg-base-100 shadow-xl">
				<div class="card-body">
					<div class="alert alert-info">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 24 24"
							class="stroke-current shrink-0 w-6 h-6"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
							></path>
						</svg>
						<span>Click "Generate Report" to view the Trial Balance</span>
					</div>
				</div>
			</div>
		{/if}
	{/if}
</div>

<!-- Journal Entries Modal -->
{#if showEntriesModal}
	<div class="modal modal-open">
		<div class="modal-box max-w-4xl">
			<h3 class="font-bold text-lg mb-4">{modalTitle}</h3>
			<p class="text-sm text-base-content/60 mb-4">
				{formatDate(parseLocalDateStart(startDate))} to {formatDate(parseLocalDateEnd(endDate))}
			</p>

			{#if loadingEntries}
				<div class="flex justify-center py-8">
					<span class="loading loading-spinner loading-lg"></span>
				</div>
			{:else if modalEntries.length === 0}
				<p class="text-base-content/60 text-center py-4">No journal entries found</p>
			{:else}
				<div class="overflow-x-auto max-h-96">
					<table class="table table-sm">
						<thead>
							<tr>
								<th>Date</th>
								<th>Description</th>
								<th>Debit Account</th>
								<th>Credit Account</th>
								<th class="text-right">Amount</th>
							</tr>
						</thead>
						<tbody>
							{#each modalEntries as entry}
								<tr>
									<td class="text-xs">{formatDate(entry.entryDate)}</td>
									<td class="text-xs max-w-48 truncate">{entry.description}</td>
									<td class="text-xs">{getAccountName(entry.debitAccountId)}</td>
									<td class="text-xs">{getAccountName(entry.creditAccountId)}</td>
									<td class="text-right font-mono text-xs">{formatCurrency(entry.amountInUSD)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			<div class="modal-action">
				<button class="btn" onclick={closeModal}>Close</button>
			</div>
		</div>
		<div class="modal-backdrop" onclick={closeModal}></div>
	</div>
{/if}
