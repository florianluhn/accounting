<script lang="ts">
	import {
		reportsAPI,
		journalEntriesAPI,
		subledgerAccountsAPI,
		currenciesAPI,
		type BalanceSheetReport,
		type ProfitLossReport,
		type MonthlyOverviewReport,
		type JournalEntry,
		type SubledgerAccount,
		type Currency,
		type CategoryBreakdown
	} from '$lib/api';

	let balanceSheet = $state<BalanceSheetReport | null>(null);
	let profitLoss = $state<ProfitLossReport | null>(null);
	let monthlyOverview = $state<MonthlyOverviewReport | null>(null);
	let journalEntries = $state<JournalEntry[]>([]);
	let subledgerAccounts = $state<SubledgerAccount[]>([]);
	let currencies = $state<Currency[]>([]);
	let loading = $state(true);
	let error = $state('');
	let selectedCurrency = $state('USD');
	let hoveredMonthIndex = $state<number | null>(null);

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

			// Load balance sheet, P&L, monthly trend, journal entries, and subledger accounts in parallel
			await Promise.all([
				loadBalanceSheet(),
				loadProfitLoss(),
				loadMonthlyOverview(),
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

	async function loadMonthlyOverview() {
		try {
			monthlyOverview = await reportsAPI.monthlyOverview({
				months: 11,
				currencyCode: selectedCurrency
			});
		} catch (e) {
			console.error('Error loading monthly overview:', e);
			monthlyOverview = null;
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
		await Promise.all([loadBalanceSheet(), loadProfitLoss(), loadMonthlyOverview()]);
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

	// Equity chart geometry (viewBox coordinates)
	const chartW = 640;
	const chartH = 220;
	const chartPad = { top: 18, right: 16, bottom: 36, left: 58 };

	let equityChart = $derived.by(() => {
		const points = monthlyOverview?.months ?? [];
		if (points.length === 0) return null;

		const values = points.map((p) => p.totalEquity);
		const minV = Math.min(...values);
		const maxV = Math.max(...values);
		const span = maxV - minV;
		// Pad the range so a flat line still has room
		const pad = span === 0 ? Math.max(Math.abs(maxV) * 0.1, 1) : span * 0.12;
		const yMin = minV - pad;
		const yMax = maxV + pad;
		const yRange = yMax - yMin || 1;

		const plotW = chartW - chartPad.left - chartPad.right;
		const plotH = chartH - chartPad.top - chartPad.bottom;
		const n = points.length;

		const coords = points.map((p, i) => {
			const x = chartPad.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
			const y = chartPad.top + plotH - ((p.totalEquity - yMin) / yRange) * plotH;
			return { x, y, ...p };
		});

		const linePath = coords
			.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
			.join(' ');

		const areaPath =
			coords.length > 0
				? `${linePath} L ${coords[coords.length - 1].x.toFixed(2)} ${(chartPad.top + plotH).toFixed(2)} L ${coords[0].x.toFixed(2)} ${(chartPad.top + plotH).toFixed(2)} Z`
				: '';

		// Nice y-axis ticks
		const tickCount = 4;
		const ticks = Array.from({ length: tickCount }, (_, i) => {
			const t = i / (tickCount - 1);
			const value = yMax - t * yRange;
			const y = chartPad.top + t * plotH;
			return { value, y };
		});

		return { coords, linePath, areaPath, ticks, yMin, yMax };
	});

	function compactCurrency(amount: number): string {
		const currency = currencies.find((c) => c.code === selectedCurrency);
		const symbol = currency?.symbol || selectedCurrency;
		const abs = Math.abs(amount);
		const sign = amount < 0 ? '-' : '';
		if (abs >= 1_000_000) {
			return `${sign}${symbol}${(abs / 1_000_000).toFixed(1)}M`;
		}
		if (abs >= 10_000) {
			return `${sign}${symbol}${(abs / 1_000).toFixed(1)}k`;
		}
		if (abs >= 1_000) {
			return `${sign}${symbol}${(abs / 1_000).toFixed(2)}k`;
		}
		return `${sign}${symbol}${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
	}

	/** "Jan 2025" → "Jan '25" for tight chart axis labels */
	function shortMonthLabel(label: string): string {
		return label.replace(/ (\d{4})$/, (_m, y: string) => ` '${y.slice(2)}`);
	}

	let activeMonthIndex = $derived(
		hoveredMonthIndex ?? (monthlyOverview?.months.length ? monthlyOverview.months.length - 1 : null)
	);

	let activeMonth = $derived(
		activeMonthIndex != null && monthlyOverview
			? monthlyOverview.months[activeMonthIndex]
			: null
	);
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

	<!-- Past 11 months: net income list + equity trend (line chart) -->
	{#if !loading && monthlyOverview && monthlyOverview.months.length > 0}
		<div class="card mb-6 overflow-hidden">
			<div class="card-body">
				<div class="flex flex-wrap items-start justify-between gap-3 mb-1">
					<div>
						<p class="section-label mb-1">History</p>
						<h2 class="card-title text-xl">Past 11 months</h2>
						<p class="text-sm text-base-content/55 mt-1">
							Monthly net income with total equity at each month-end
						</p>
					</div>
					{#if activeMonth}
						<div class="rounded-2xl border border-base-300/60 bg-base-200/40 px-4 py-3 min-w-[10.5rem] text-right">
							<p class="text-2xs font-bold uppercase tracking-wider text-base-content/45 mb-0.5">
								{activeMonth.label}
							</p>
							<p class="text-xs font-semibold text-base-content/55 mb-1">Equity</p>
							<p class="font-mono font-bold text-lg tracking-tight text-accent">
								{formatCurrency(activeMonth.totalEquity)}
							</p>
							<p class="text-xs font-semibold text-base-content/55 mt-2 mb-0.5">Net income</p>
							<p class="font-mono font-bold text-sm tracking-tight {activeMonth.netIncome >= 0 ? 'text-success' : 'text-error'}">
								{formatCurrency(activeMonth.netIncome)}
							</p>
						</div>
					{/if}
				</div>

				<div class="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-2">
					<!-- Month list -->
					<div class="lg:col-span-4 xl:col-span-3">
						<div class="rounded-2xl border border-base-300/50 overflow-hidden max-h-[22rem] overflow-y-auto">
							{#each monthlyOverview.months as point, i}
								<button
									type="button"
									class="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors border-b border-base-300/40 last:border-b-0
										{activeMonthIndex === i
										? 'bg-primary/10 ring-1 ring-inset ring-primary/20'
										: 'hover:bg-base-200/70'}"
									onmouseenter={() => (hoveredMonthIndex = i)}
									onfocus={() => (hoveredMonthIndex = i)}
									onmouseleave={() => (hoveredMonthIndex = null)}
									onblur={() => (hoveredMonthIndex = null)}
								>
									<div class="min-w-0">
										<p class="text-sm font-semibold tracking-tight truncate">{point.label}</p>
										<p class="text-2xs font-medium uppercase tracking-wider mt-0.5 {point.netIncome >= 0 ? 'text-success/75' : 'text-error/75'}">
											{point.netIncome >= 0 ? 'Profit' : 'Loss'}
										</p>
									</div>
									<span class="font-mono text-sm font-bold tabular-nums shrink-0 {point.netIncome >= 0 ? 'text-success' : 'text-error'}">
										{formatCurrency(point.netIncome)}
									</span>
								</button>
							{/each}
						</div>
					</div>

					<!-- Equity line / area chart -->
					<div class="lg:col-span-8 xl:col-span-9 min-w-0">
						<div class="rounded-2xl border border-base-300/50 bg-gradient-to-b from-base-200/30 to-transparent px-2 sm:px-3 py-3">
							<div class="flex items-center justify-between gap-2 px-2 mb-1">
								<p class="text-2xs font-bold uppercase tracking-wider text-base-content/45">
									Total equity
								</p>
								<div class="flex items-center gap-1.5 text-2xs font-medium text-base-content/45">
									<span class="inline-block w-3 h-0.5 rounded-full bg-accent"></span>
									Month-end position
								</div>
							</div>

							{#if equityChart}
								<div class="relative w-full" style="aspect-ratio: {chartW} / {chartH};">
									<svg
										viewBox="0 0 {chartW} {chartH}"
										class="w-full h-full block"
										role="img"
										aria-label="Total equity over the past 11 months"
									>
										<defs>
											<linearGradient id="equityAreaFill" x1="0" y1="0" x2="0" y2="1">
												<stop offset="0%" stop-color="oklch(var(--a))" stop-opacity="0.28" />
												<stop offset="100%" stop-color="oklch(var(--a))" stop-opacity="0.02" />
											</linearGradient>
											<linearGradient id="equityLineStroke" x1="0" y1="0" x2="1" y2="0">
												<stop offset="0%" stop-color="oklch(var(--a))" stop-opacity="0.75" />
												<stop offset="100%" stop-color="oklch(var(--p))" stop-opacity="0.95" />
											</linearGradient>
										</defs>

										<!-- Grid + y ticks -->
										{#each equityChart.ticks as tick}
											<line
												x1={chartPad.left}
												y1={tick.y}
												x2={chartW - chartPad.right}
												y2={tick.y}
												stroke="oklch(var(--b3))"
												stroke-opacity="0.55"
												stroke-width="1"
												stroke-dasharray="3 4"
											/>
											<text
												x={chartPad.left - 8}
												y={tick.y + 3.5}
												text-anchor="end"
												class="fill-base-content"
												fill-opacity="0.45"
												font-size="10"
												font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
											>
												{compactCurrency(tick.value)}
											</text>
										{/each}

										<!-- Area fill -->
										<path d={equityChart.areaPath} fill="url(#equityAreaFill)" />

										<!-- Line -->
										<path
											d={equityChart.linePath}
											fill="none"
											stroke="url(#equityLineStroke)"
											stroke-width="2.5"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>

										<!-- Points + x labels -->
										{#each equityChart.coords as c, i}
											{@const isActive = activeMonthIndex === i}
											<!-- Hit target -->
											<rect
												x={c.x - (equityChart.coords.length > 1 ? (chartW - chartPad.left - chartPad.right) / (equityChart.coords.length - 1) / 2 : 24)}
												y={chartPad.top}
												width={equityChart.coords.length > 1 ? (chartW - chartPad.left - chartPad.right) / (equityChart.coords.length - 1) : 48}
												height={chartH - chartPad.top - chartPad.bottom}
												fill="transparent"
												class="cursor-pointer"
												onmouseenter={() => (hoveredMonthIndex = i)}
												onmouseleave={() => (hoveredMonthIndex = null)}
												role="presentation"
											/>
											{#if isActive}
												<line
													x1={c.x}
													y1={chartPad.top}
													x2={c.x}
													y2={chartH - chartPad.bottom}
													stroke="oklch(var(--a))"
													stroke-opacity="0.35"
													stroke-width="1.5"
													stroke-dasharray="2 3"
												/>
											{/if}
											<circle
												cx={c.x}
												cy={c.y}
												r={isActive ? 5.5 : 3.5}
												fill="oklch(var(--b1))"
												stroke="oklch(var(--a))"
												stroke-width={isActive ? 2.5 : 1.75}
												class="transition-all"
											/>
											<text
												x={c.x}
												y={chartH - 12}
												text-anchor="middle"
												class="fill-base-content"
												fill-opacity={isActive ? 0.85 : 0.45}
												font-size="10"
												font-weight={isActive ? '700' : '500'}
											>
												{shortMonthLabel(c.label)}
											</text>
										{/each}
									</svg>
								</div>
							{/if}
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
