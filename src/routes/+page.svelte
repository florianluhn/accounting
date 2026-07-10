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

<div class="max-w-7xl mx-auto">
	<!-- Header -->
	<div class="mb-8">
		<div class="flex justify-between items-center">
			<div>
				<h1 class="text-4xl font-bold mb-2">Dashboard</h1>
				<p class="text-base-content/70">Overview of your financial accounts</p>
			</div>
			{#if currencies.length > 1}
				<div class="form-control">
					<label class="label">
						<span class="label-text">Currency</span>
					</label>
					<select
						class="select select-bordered"
						bind:value={selectedCurrency}
						onchange={handleCurrencyChange}
					>
						{#each currencies as currency}
							<option value={currency.code}>
								{currency.code} - {currency.name}
							</option>
						{/each}
					</select>
				</div>
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

	<!-- New Journal Entry Button -->
	<div class="card bg-base-100 shadow-xl mb-6">
		<div class="card-body">
			<h2 class="card-title text-2xl">Quick Actions</h2>
			<p class="text-base-content/80 mb-4">
				Create a new journal entry to record your transactions.
			</p>

			{#if subledgerAccounts.length < 2}
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
					<span>You must create at least 2 subledger accounts before recording journal entries. Visit the <a href="/accounts" class="link">Accounts</a> page to get started.</span>
				</div>
			{:else}
				<a href="/journals" class="btn btn-primary btn-lg">
					+ New Journal Entry
				</a>
			{/if}
		</div>
	</div>

	<!-- P&L Statement for Current Month -->
	{#if !loading && profitLoss}
		<div class="card bg-base-100 shadow-xl mb-6">
			<div class="card-body">
				<h2 class="card-title text-2xl mb-4">Profit & Loss Statement - {getCurrentMonthName()}</h2>

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
				<div class="flex justify-between items-center">
					<h3 class="font-bold text-xl">Net Income</h3>
					<div class="text-right">
						<div class="text-2xl font-bold font-mono {profitLoss.netIncome >= 0 ? 'text-success' : 'text-error'}">
							{formatCurrency(profitLoss.netIncome)}
						</div>
						<div class="text-sm text-base-content/60">
							{profitLoss.netIncome >= 0 ? 'Profit' : 'Loss'}
						</div>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- Quick Stats -->
	{#if loading}
		<div class="flex justify-center py-8">
			<span class="loading loading-spinner loading-lg"></span>
		</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
			<div class="stat bg-base-100 shadow rounded-lg">
				<div class="stat-title">Total Assets</div>
				<div class="stat-value text-primary">{formatCurrency(totalAssets)}</div>
				<div class="stat-desc">
					{#if balanceSheet?.assets.accounts.length}
						{countSubledgerAccounts(balanceSheet.assets.accounts)} account{countSubledgerAccounts(balanceSheet.assets.accounts) !== 1 ? 's' : ''}
					{:else}
						No asset accounts yet
					{/if}
				</div>
			</div>

			<div class="stat bg-base-100 shadow rounded-lg">
				<div class="stat-title">Total Liabilities</div>
				<div class="stat-value text-secondary">{formatCurrency(totalLiabilities)}</div>
				<div class="stat-desc">
					{#if balanceSheet?.liabilities.accounts.length}
						{countSubledgerAccounts(balanceSheet.liabilities.accounts)} account{countSubledgerAccounts(balanceSheet.liabilities.accounts) !== 1 ? 's' : ''}
					{:else}
						No liability accounts yet
					{/if}
				</div>
			</div>

			<div class="stat bg-base-100 shadow rounded-lg">
				<div class="stat-title">Equity</div>
				<div class="stat-value text-accent">{formatCurrency(totalEquity)}</div>
				<div class="stat-desc">
					{#if balanceSheet?.equity.accounts.length}
						{countSubledgerAccounts(balanceSheet.equity.accounts)} account{countSubledgerAccounts(balanceSheet.equity.accounts) !== 1 ? 's' : ''}
					{:else}
						No equity accounts yet
					{/if}
				</div>
			</div>

			<div class="stat bg-base-100 shadow rounded-lg">
				<div class="stat-title">Journal Entries</div>
				<div class="stat-value">{journalEntriesCount}</div>
				<div class="stat-desc">This month</div>
			</div>
		</div>

		<!-- Balance Sheet Status -->
		{#if balanceSheet}
			<div class="mt-6">
				<div class="card bg-base-100 shadow-xl">
					<div class="card-body">
						<h3 class="card-title">Balance Sheet Status</h3>
						<div class="flex items-center gap-4">
							{#if balanceSheet.balanced}
								<div class="badge badge-success badge-lg">Balanced</div>
								<p class="text-base-content/70">
									Assets ({formatCurrency(totalAssets)}) = Liabilities ({formatCurrency(totalLiabilities)}) + Equity ({formatCurrency(totalEquity)})
								</p>
							{:else}
								<div class="badge badge-error badge-lg">Unbalanced</div>
								<p class="text-base-content/70">
									Your books are not balanced. Please review your accounts and journal entries.
								</p>
							{/if}
						</div>
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
