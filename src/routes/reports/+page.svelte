<script lang="ts">
	import {
		reportsAPI,
		currenciesAPI,
		subledgerAccountsAPI,
		type BalanceSheetReport,
		type ProfitLossReport,
		type TrialBalanceReport,
		type GLAccountGroup,
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
										<span class="font-mono font-semibold text-sm">{formatCurrency(glGroup.totalBalance)}</span>
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
													<span class="font-mono">{formatCurrency(account.balance)}</span>
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
							<span class="font-mono">{formatCurrency(profitLoss.revenue.total)}</span>
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
										<span class="font-mono font-semibold text-sm">{formatCurrency(glGroup.totalBalance)}</span>
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
													<span class="font-mono">{formatCurrency(account.balance)}</span>
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
							<span class="font-mono">{formatCurrency(profitLoss.expenses.total)}</span>
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
