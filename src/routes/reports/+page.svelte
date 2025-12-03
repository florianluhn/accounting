<script lang="ts">
	import {
		reportsAPI,
		currenciesAPI,
		type BalanceSheetReport,
		type ProfitLossReport,
		type TrialBalanceReport,
		type Currency
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

	$effect(() => {
		loadCurrencies();
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

	async function generateReport() {
		try {
			loading = true;
			error = '';

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
		return `${currency?.symbol || selectedCurrency} ${amount.toFixed(2)}`;
	}

	function formatDate(date: Date | string): string {
		const d = new Date(date);
		// Format using UTC to avoid timezone conversion issues
		const year = d.getUTCFullYear();
		const month = String(d.getUTCMonth() + 1).padStart(2, '0');
		const day = String(d.getUTCDate()).padStart(2, '0');
		return `${month}/${day}/${year}`;
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
								<table class="table">
									<tbody>
										{#each balanceSheet.assets.accounts as account}
											<tr>
												<td class="text-sm">
													{account.accountNumber} - {account.accountName}
												</td>
												<td class="text-right font-mono">
													{formatCurrency(account.balance)}
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
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
								<table class="table table-sm">
									<tbody>
										{#each balanceSheet.liabilities.accounts as account}
											<tr>
												<td class="text-sm">
													{account.accountNumber} - {account.accountName}
												</td>
												<td class="text-right font-mono">
													{formatCurrency(account.balance)}
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
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
								<table class="table table-sm">
									<tbody>
										{#each balanceSheet.equity.accounts as account}
											<tr>
												<td class="text-sm">
													{account.accountNumber} - {account.accountName}
												</td>
												<td class="text-right font-mono">
													{formatCurrency(account.balance)}
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
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
							<table class="table">
								<tbody>
									{#each profitLoss.revenue.accounts as account}
										<tr>
											<td class="text-sm">
												{account.accountNumber} - {account.accountName}
											</td>
											<td class="text-right font-mono">
												{formatCurrency(account.balance)}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
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
							<table class="table">
								<tbody>
									{#each profitLoss.expenses.accounts as account}
										<tr>
											<td class="text-sm">
												{account.accountNumber} - {account.accountName}
											</td>
											<td class="text-right font-mono">
												{formatCurrency(account.balance)}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
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
