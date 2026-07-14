<script lang="ts">
	import {
		reportsAPI,
		journalEntriesAPI,
		subledgerAccountsAPI,
		currenciesAPI,
		type BalanceSheetReport,
		type ProfitLossReport,
		type JournalEntry,
		type SubledgerAccount,
		type Currency,
		type CategoryBreakdown
	} from '$lib/api';

	let balanceSheet = $state<BalanceSheetReport | null>(null);
	let profitLoss = $state<ProfitLossReport | null>(null);
	let journalEntries = $state<JournalEntry[]>([]);
	let subledgerAccounts = $state<SubledgerAccount[]>([]);
	let currencies = $state<Currency[]>([]);
	let loading = $state(true);
	let error = $state('');
	let selectedCurrency = $state('USD');

	// P&L drill-down state
	let expandedGLAccounts = $state<Set<number>>(new Set());
	let expandedSubledgers = $state<Set<number>>(new Set());
	let subledgerCategories = $state<Map<number, CategoryBreakdown[]>>(new Map());
	let loadingCategories = $state<Set<number>>(new Set());

	// Journal entries modal state
	let showEntriesModal = $state(false);
	let modalEntries = $state<JournalEntry[]>([]);
	let modalTitle = $state('');
	let loadingEntries = $state(false);

	// Date range for current month (used for P&L drill-down)
	let plStartDate = $state<Date>(new Date());
	let plEndDate = $state<Date>(new Date());

	$effect(() => {
		loadData();
	});

	async function loadData() {
		try {
			loading = true;
			error = '';

			// Load currencies first to get default
			currencies = await currenciesAPI.list();
			const defaultCurrency = currencies.find(c => c.isDefault);
			if (defaultCurrency) {
				selectedCurrency = defaultCurrency.code;
			}

			// Load balance sheet, P&L, journal entries, and subledger accounts in parallel
			await Promise.all([
				loadBalanceSheet(),
				loadProfitLoss(),
				loadJournalEntries(),
				loadSubledgerAccounts()
			]);
		} catch (e) {
			console.error('Error loading dashboard data:', e);
			error = e instanceof Error ? e.message : 'Failed to load dashboard data';
		} finally {
			loading = false;
		}
	}

	async function loadBalanceSheet() {
		try {
			const now = new Date();
			const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
			balanceSheet = await reportsAPI.balanceSheet({ endDate, currencyCode: selectedCurrency });
		} catch (e) {
			console.error('Error loading balance sheet:', e);
		}
	}

	async function loadProfitLoss() {
		try {
			const now = new Date();
			const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
			const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
			plStartDate = startOfMonth;
			plEndDate = endOfToday;
			profitLoss = await reportsAPI.profitLoss({ startDate: startOfMonth, endDate: endOfToday, currencyCode: selectedCurrency });
		} catch (e) {
			console.error('Error loading profit & loss:', e);
		}
	}

	async function loadJournalEntries() {
		try {
			const now = new Date();
			const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
			const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
			journalEntries = await journalEntriesAPI.list({ startDate: startOfMonth, endDate: endOfToday });
		} catch (e) {
			console.error('Error loading journal entries:', e);
		}
	}

	async function loadSubledgerAccounts() {
		try {
			const accounts = await subledgerAccountsAPI.list();
			subledgerAccounts = accounts.sort((a, b) =>
				a.accountNumber.localeCompare(b.accountNumber, undefined, { numeric: true })
			);
		} catch (e) {
			console.error('Error loading subledger accounts:', e);
		}
	}

	function formatCurrency(amount: number): string {
		const currency = currencies.find(c => c.code === selectedCurrency);
		return `${currency?.symbol || selectedCurrency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	async function handleCurrencyChange() {
		// Reset drill-down state
		expandedGLAccounts = new Set();
		expandedSubledgers = new Set();
		subledgerCategories = new Map();
		await Promise.all([loadBalanceSheet(), loadProfitLoss()]);
	}

	function getCurrentMonthName(): string {
		const now = new Date();
		return now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
	}

	function getAccountName(id: number): string {
		const account = subledgerAccounts.find(a => a.id === id);
		return account ? `${account.accountNumber} - ${account.name}` : 'Unknown';
	}

	function formatDate(date: Date | string): string {
		const d = new Date(date);
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
						startDate: plStartDate,
						endDate: plEndDate
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
				startDate: plStartDate,
				endDate: plEndDate,
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

	let totalAssets = $derived(balanceSheet?.assets.total || 0);
	let totalLiabilities = $derived(balanceSheet?.liabilities.total || 0);
	let totalEquity = $derived(balanceSheet?.equity.total || 0);
	let journalEntriesCount = $derived(journalEntries.length);

	// Count subledger accounts across all GL groups for stat descriptions
	function countSubledgerAccounts(groups: { subledgerAccounts: any[] }[]): number {
		return groups.reduce((sum, g) => sum + g.subledgerAccounts.length, 0);
	}
</script>

<div class="page-shell">
	<!-- Header -->
	<div class="page-header">
		<div>
			<p class="section-label mb-2">Overview</p>
			<h1 class="page-title">Dashboard</h1>
			<p class="page-subtitle">Your financial position at a glance</p>
		</div>
		<div class="flex flex-wrap items-center gap-3">
			{#if currencies.length > 1}
				<select
					class="select select-bordered select-sm min-w-[10rem]"
					bind:value={selectedCurrency}
					onchange={handleCurrencyChange}
				>
					{#each currencies as currency}
						<option value={currency.code}>
							{currency.code} — {currency.name}
						</option>
					{/each}
				</select>
			{/if}
			{#if subledgerAccounts.length >= 2}
				<a href="/journals" class="btn btn-primary btn-sm">
					<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
					</svg>
					New journal entry
				</a>
			{/if}
		</div>
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

	{#if subledgerAccounts.length < 2}
		<div class="card mb-6">
			<div class="card-body">
				<div class="alert alert-warning">
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
							d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
						/>
					</svg>
					<span>Create at least 2 subledger accounts before recording journal entries. Visit <a href="/accounts" class="link link-primary font-semibold">Accounts</a> to get started.</span>
				</div>
			</div>
		</div>
	{/if}

	<!-- P&L Statement for Current Month -->
	{#if !loading && profitLoss}
		<div class="card mb-6">
			<div class="card-body">
				<div class="flex flex-wrap items-center justify-between gap-3 mb-2">
					<div>
						<p class="section-label mb-1">This month</p>
						<h2 class="card-title text-xl">Profit &amp; Loss — {getCurrentMonthName()}</h2>
					</div>
					<a href="/reports" class="btn btn-ghost btn-sm">
						Full reports
						<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
						</svg>
					</a>
				</div>

				<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
					<!-- Revenue Section -->
					<div>
						<h3 class="font-bold text-lg mb-3 flex items-center gap-2">
							<span class="text-success">Revenue</span>
						</h3>
						{#if profitLoss.revenue.accounts.length > 0}
							<div class="space-y-1">
								{#each profitLoss.revenue.accounts as glGroup}
									<!-- GL Account Row -->
									<button
										class="flex justify-between items-center w-full py-1.5 px-2 rounded hover:bg-base-200 transition-colors cursor-pointer text-left"
										onclick={() => toggleGLAccount(glGroup.glAccountId)}
									>
										<span class="flex items-center gap-2">
											<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 transition-transform {expandedGLAccounts.has(glGroup.glAccountId) ? 'rotate-90' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
											</svg>
											<span class="font-semibold text-sm">{glGroup.glAccountNumber} - {glGroup.glAccountName}</span>
										</span>
										<span class="font-mono text-sm font-semibold">{formatCurrency(glGroup.totalBalance)}</span>
									</button>
									{#if expandedGLAccounts.has(glGroup.glAccountId)}
										<div class="ml-7 border-l-2 border-base-300 pl-3">
											{#each glGroup.subledgerAccounts as account}
												<button
													class="flex justify-between items-center w-full py-1 text-sm text-base-content/80 hover:bg-base-200 rounded px-2 cursor-pointer text-left"
													onclick={() => toggleSubledger(account.accountId)}
												>
													<span class="flex items-center gap-1.5">
														<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 transition-transform {expandedSubledgers.has(account.accountId) ? 'rotate-90' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
															<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
														</svg>
														<span>{account.accountNumber} - {account.accountName}</span>
													</span>
													<span class="font-mono text-sm">{formatCurrency(account.balance)}</span>
												</button>
												{#if expandedSubledgers.has(account.accountId)}
													<div class="ml-6 border-l-2 border-base-300/50 pl-3 mb-1">
														{#if loadingCategories.has(account.accountId)}
															<div class="py-1 text-xs text-base-content/60">
																<span class="loading loading-spinner loading-xs"></span> Loading...
															</div>
														{:else if subledgerCategories.has(account.accountId)}
															{#each subledgerCategories.get(account.accountId) || [] as cat}
																<div class="flex justify-between items-center py-0.5 text-xs text-base-content/70">
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
								<div class="flex justify-between items-center pt-2 font-bold">
									<span>Total Revenue</span>
									<span class="text-success font-mono">{formatCurrency(profitLoss.revenue.total)}</span>
								</div>
							</div>
						{:else}
							<p class="text-base-content/60 text-sm">No revenue accounts with activity this month</p>
						{/if}
					</div>

					<!-- Expenses Section -->
					<div>
						<h3 class="font-bold text-lg mb-3 flex items-center gap-2">
							<span class="text-error">Expenses</span>
						</h3>
						{#if profitLoss.expenses.accounts.length > 0}
							<div class="space-y-1">
								{#each profitLoss.expenses.accounts as glGroup}
									<button
										class="flex justify-between items-center w-full py-1.5 px-2 rounded hover:bg-base-200 transition-colors cursor-pointer text-left"
										onclick={() => toggleGLAccount(glGroup.glAccountId)}
									>
										<span class="flex items-center gap-2">
											<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 transition-transform {expandedGLAccounts.has(glGroup.glAccountId) ? 'rotate-90' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
											</svg>
											<span class="font-semibold text-sm">{glGroup.glAccountNumber} - {glGroup.glAccountName}</span>
										</span>
										<span class="font-mono text-sm font-semibold">{formatCurrency(glGroup.totalBalance)}</span>
									</button>
									{#if expandedGLAccounts.has(glGroup.glAccountId)}
										<div class="ml-7 border-l-2 border-base-300 pl-3">
											{#each glGroup.subledgerAccounts as account}
												<button
													class="flex justify-between items-center w-full py-1 text-sm text-base-content/80 hover:bg-base-200 rounded px-2 cursor-pointer text-left"
													onclick={() => toggleSubledger(account.accountId)}
												>
													<span class="flex items-center gap-1.5">
														<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 transition-transform {expandedSubledgers.has(account.accountId) ? 'rotate-90' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
															<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
														</svg>
														<span>{account.accountNumber} - {account.accountName}</span>
													</span>
													<span class="font-mono text-sm">{formatCurrency(account.balance)}</span>
												</button>
												{#if expandedSubledgers.has(account.accountId)}
													<div class="ml-6 border-l-2 border-base-300/50 pl-3 mb-1">
														{#if loadingCategories.has(account.accountId)}
															<div class="py-1 text-xs text-base-content/60">
																<span class="loading loading-spinner loading-xs"></span> Loading...
															</div>
														{:else if subledgerCategories.has(account.accountId)}
															{#each subledgerCategories.get(account.accountId) || [] as cat}
																<div class="flex justify-between items-center py-0.5 text-xs text-base-content/70">
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
								<div class="flex justify-between items-center pt-2 font-bold">
									<span>Total Expenses</span>
									<span class="text-error font-mono">{formatCurrency(profitLoss.expenses.total)}</span>
								</div>
							</div>
						{:else}
							<p class="text-base-content/60 text-sm">No expense accounts with activity this month</p>
						{/if}
					</div>
				</div>

				<!-- Net Income -->
				<div class="divider"></div>
				<div class="flex flex-wrap justify-between items-center gap-4 rounded-2xl border border-base-300/60 bg-base-200/40 px-5 py-4">
					<div>
						<p class="section-label mb-1">Result</p>
						<h3 class="font-display font-bold text-xl tracking-tight">Net Income</h3>
					</div>
					<div class="text-right">
						<div class="text-2xl sm:text-3xl font-bold font-mono tracking-tight {profitLoss.netIncome >= 0 ? 'text-success' : 'text-error'}">
							{formatCurrency(profitLoss.netIncome)}
						</div>
						<div class="text-xs font-semibold uppercase tracking-wider mt-1 {profitLoss.netIncome >= 0 ? 'text-success/80' : 'text-error/80'}">
							{profitLoss.netIncome >= 0 ? 'Profit' : 'Loss'}
						</div>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- Quick Stats -->
	{#if loading}
		<div class="flex justify-center py-16">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else}
		<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
			<div class="metric-tile">
				<div class="flex items-start justify-between gap-3">
					<div>
						<p class="stat-title mb-2">Total Assets</p>
						<p class="stat-value text-2xl text-primary font-mono">{formatCurrency(totalAssets)}</p>
						<p class="stat-desc mt-2 text-base-content/50">
							{#if balanceSheet?.assets.accounts.length}
								{countSubledgerAccounts(balanceSheet.assets.accounts)} account{countSubledgerAccounts(balanceSheet.assets.accounts) !== 1 ? 's' : ''}
							{:else}
								No asset accounts yet
							{/if}
						</p>
					</div>
					<div class="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
						<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>
					</div>
				</div>
			</div>

			<div class="metric-tile">
				<div class="flex items-start justify-between gap-3">
					<div>
						<p class="stat-title mb-2">Total Liabilities</p>
						<p class="stat-value text-2xl text-secondary font-mono">{formatCurrency(totalLiabilities)}</p>
						<p class="stat-desc mt-2 text-base-content/50">
							{#if balanceSheet?.liabilities.accounts.length}
								{countSubledgerAccounts(balanceSheet.liabilities.accounts)} account{countSubledgerAccounts(balanceSheet.liabilities.accounts) !== 1 ? 's' : ''}
							{:else}
								No liability accounts yet
							{/if}
						</p>
					</div>
					<div class="w-10 h-10 rounded-xl bg-secondary/10 text-secondary flex items-center justify-center shrink-0">
						<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z"/></svg>
					</div>
				</div>
			</div>

			<div class="metric-tile">
				<div class="flex items-start justify-between gap-3">
					<div>
						<p class="stat-title mb-2">Equity</p>
						<p class="stat-value text-2xl text-accent font-mono">{formatCurrency(totalEquity)}</p>
						<p class="stat-desc mt-2 text-base-content/50">
							{#if balanceSheet?.equity.accounts.length}
								{countSubledgerAccounts(balanceSheet.equity.accounts)} account{countSubledgerAccounts(balanceSheet.equity.accounts) !== 1 ? 's' : ''}
							{:else}
								No equity accounts yet
							{/if}
						</p>
					</div>
					<div class="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0">
						<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>
					</div>
				</div>
			</div>

			<div class="metric-tile">
				<div class="flex items-start justify-between gap-3">
					<div>
						<p class="stat-title mb-2">Journal Entries</p>
						<p class="stat-value text-2xl font-mono">{journalEntriesCount}</p>
						<p class="stat-desc mt-2 text-base-content/50">This month</p>
					</div>
					<div class="w-10 h-10 rounded-xl bg-base-200 text-base-content/60 flex items-center justify-center shrink-0">
						<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>
					</div>
				</div>
			</div>
		</div>

		<!-- Balance Sheet Status -->
		{#if balanceSheet}
			<div class="card">
				<div class="card-body">
					<div class="flex flex-wrap items-center justify-between gap-4">
						<div>
							<p class="section-label mb-1">Books</p>
							<h3 class="card-title text-lg">Balance sheet status</h3>
						</div>
						{#if balanceSheet.balanced}
							<span class="badge badge-success badge-lg gap-1.5 px-4">
								<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
								Balanced
							</span>
						{:else}
							<span class="badge badge-error badge-lg gap-1.5 px-4">Unbalanced</span>
						{/if}
					</div>
					{#if balanceSheet.balanced}
						<p class="text-sm text-base-content/60 mt-1">
							Assets <span class="font-mono font-semibold text-base-content">{formatCurrency(totalAssets)}</span>
							=
							Liabilities <span class="font-mono font-semibold text-base-content">{formatCurrency(totalLiabilities)}</span>
							+
							Equity <span class="font-mono font-semibold text-base-content">{formatCurrency(totalEquity)}</span>
						</p>
					{:else}
						<p class="text-sm text-base-content/60 mt-1">
							Your books are not balanced. Review accounts and journal entries.
						</p>
					{/if}
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
			<p class="text-sm text-base-content/60 mb-4">{getCurrentMonthName()}</p>

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
