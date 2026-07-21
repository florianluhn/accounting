<script lang="ts">
	import {
		subledgerAccountsAPI,
		budgetsAPI,
		settingsAPI,
		type SubledgerAccount,
		type Budget
	} from '$lib/api';
	import { financialYear, applyModuleSettings } from '$lib/modules.svelte';
	import {
		formatFinancialYearLabel,
		formatFinancialYearRange,
		getFinancialYear
	} from '$lib/financial-year';

	let loading = $state(true);
	let saving = $state(false);
	let error = $state('');
	let success = $state('');

	let selectedYear = $state(getFinancialYear(new Date(), 1));
	let accounts = $state<SubledgerAccount[]>([]);
	let budgets = $state<Budget[]>([]);
	let fyReady = $state(false);
	/** subledgerAccountId → 'Profit' | 'Loss' */
	let accountTypes = $state<Record<number, 'Profit' | 'Loss'>>({});

	// Form state map: subledgerAccountId -> amount
	let budgetValues = $state<Record<number, number>>({});

	let fyLabel = $derived(formatFinancialYearLabel(selectedYear, financialYear.startMonth));
	let fyRange = $derived(formatFinancialYearRange(selectedYear, financialYear.startMonth));

	let totalProfitBudget = $derived(
		accounts
			.filter((a) => accountTypes[a.id] === 'Profit')
			.reduce((sum, a) => sum + (Number(budgetValues[a.id]) || 0), 0)
	);
	let totalLossBudget = $derived(
		accounts
			.filter((a) => accountTypes[a.id] === 'Loss')
			.reduce((sum, a) => sum + (Number(budgetValues[a.id]) || 0), 0)
	);
	/** Net = all profit budgets − all loss budgets (0 ≈ balanced). */
	let netBudget = $derived(totalProfitBudget - totalLossBudget);
	let budgetBalanced = $derived(Math.abs(netBudget) < 0.005);

	function formatAmount(amount: number): string {
		return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	}

	$effect(() => {
		settingsAPI
			.get()
			.then((s) => {
				applyModuleSettings(s);
				selectedYear = getFinancialYear(new Date(), financialYear.startMonth);
				fyReady = true;
			})
			.catch(() => {
				fyReady = true;
			});
	});

	$effect(() => {
		if (!fyReady) return;
		loadData(selectedYear);
	});

	async function loadData(year: number) {
		loading = true;
		error = '';
		success = '';
		try {
			// Fetch all active accounts
			const allAccounts = await subledgerAccountsAPI.list({ active: true });
			// Filter for Profit and Loss only
			accounts = allAccounts.filter(a => {
				// We don't have glAccountType directly on SubledgerAccount from list() endpoint by default
				// But we can fetch it, wait. Let's see if the API returns glAccountType.
				// Wait, list() doesn't return glAccountType. I will have to fetch GL accounts too.
				return true; // We will filter it below
			});

			const { glAccountsAPI } = await import('$lib/api');
			const glAccounts = await glAccountsAPI.list({ active: true });
			const glAccountTypes = new Map(glAccounts.map((g) => [g.id, g.type]));

			// Filter accounts for Profit and Loss
			accounts = accounts.filter((a) => {
				const type = glAccountTypes.get(a.glAccountId);
				return type === 'Profit' || type === 'Loss';
			});

			// Sort by Account Number
			accounts.sort((a, b) =>
				a.accountNumber.localeCompare(b.accountNumber, undefined, { numeric: true })
			);

			const types: Record<number, 'Profit' | 'Loss'> = {};
			for (const account of accounts) {
				const type = glAccountTypes.get(account.glAccountId);
				if (type === 'Profit' || type === 'Loss') {
					types[account.id] = type;
				}
			}
			accountTypes = types;

			// Fetch budgets for the selected year
			budgets = await budgetsAPI.list({ year });

			// Populate form state
			const newBudgetValues: Record<number, number> = {};
			for (const account of accounts) {
				const existingBudget = budgets.find((b) => b.subledgerAccountId === account.id);
				newBudgetValues[account.id] = existingBudget ? existingBudget.amount : 0;
			}
			budgetValues = newBudgetValues;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load data';
		} finally {
			loading = false;
		}
	}

	async function saveBudgets() {
		saving = true;
		error = '';
		success = '';
		try {
			// Find which budgets need creating or updating
			const promises = [];
			for (const account of accounts) {
				const amount = budgetValues[account.id] || 0;
				const existing = budgets.find(b => b.subledgerAccountId === account.id);

				if (existing) {
					if (existing.amount !== amount) {
						// Update
						promises.push(budgetsAPI.update(existing.id, { amount }));
					}
				} else if (amount !== 0) {
					// Create new only if amount is not zero (to save space)
					promises.push(
						budgetsAPI.create({
							subledgerAccountId: account.id,
							year: selectedYear,
							amount
						})
					);
				}
			}

			await Promise.all(promises);
			success = 'Budgets saved successfully';
			await loadData(selectedYear); // Reload to get fresh IDs and updated states
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save budgets';
		} finally {
			saving = false;
		}
	}
</script>

<div class="max-w-4xl mx-auto">
	<div class="mb-8">
		<p class="section-label mb-2">Planning</p>
		<h1 class="page-title">Budgets</h1>
		<p class="page-subtitle">Financial-year budgets for profit and loss accounts</p>
	</div>

	{#if error}
		<div class="alert alert-error mb-6">
			<span>{error}</span>
		</div>
	{/if}
	{#if success}
		<div class="alert alert-success mb-6">
			<span>{success}</span>
		</div>
	{/if}

	<div class="card bg-base-100 shadow-xl mb-6">
		<div class="card-body">
			<div class="flex flex-wrap items-end gap-4 mb-6">
				<div class="form-control">
					<label class="label">
						<span class="label-text">Financial year</span>
					</label>
					<input
						type="number"
						class="input input-bordered w-32"
						bind:value={selectedYear}
						min="2000"
						max="2100"
					/>
				</div>
				<div class="pb-2 text-sm text-base-content/70">
					<span class="font-semibold">{fyLabel}</span>
					<span class="mx-1">·</span>
					<span>{fyRange}</span>
				</div>
			</div>

			{#if loading}
				<div class="flex justify-center py-8">
					<span class="loading loading-spinner loading-lg"></span>
				</div>
			{:else if accounts.length === 0}
				<div class="alert alert-info">
					<span>No Profit or Loss subledger accounts found.</span>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="table table-zebra w-full">
						<thead>
							<tr>
								<th>Account</th>
								<th class="w-48 text-right">Budget Amount</th>
							</tr>
						</thead>
						<tbody>
							{#each accounts as account (account.id)}
								<tr>
									<td>
										<div class="font-medium">{account.accountNumber} - {account.name}</div>
										<div class="text-xs text-base-content/60">Currency: {account.currencyCode}</div>
									</td>
									<td class="text-right">
										<div class="form-control">
											<input
												type="number"
												step="0.01"
												class="input input-bordered input-sm w-full text-right font-mono"
												bind:value={budgetValues[account.id]}
											/>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<!-- Budget balance summary: total Profit − total Loss -->
				<div class="mt-6 p-4 rounded-box bg-base-200 border border-base-300">
					<h3 class="font-semibold mb-3">Budget summary</h3>
					<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm mb-3">
						<div class="flex justify-between sm:flex-col sm:gap-1">
							<span class="text-base-content/60">Total profit (revenue)</span>
							<span class="font-mono font-medium">{formatAmount(totalProfitBudget)}</span>
						</div>
						<div class="flex justify-between sm:flex-col sm:gap-1">
							<span class="text-base-content/60">Total loss (expenses)</span>
							<span class="font-mono font-medium">{formatAmount(totalLossBudget)}</span>
						</div>
						<div class="flex justify-between sm:flex-col sm:gap-1">
							<span class="text-base-content/60">Net (profit − loss)</span>
							<span
								class="font-mono font-semibold"
								class:text-success={budgetBalanced || netBudget > 0}
								class:text-error={netBudget < 0 && !budgetBalanced}
							>
								{formatAmount(netBudget)}
							</span>
						</div>
					</div>
					{#if budgetBalanced}
						<div class="alert alert-success py-2 text-sm">
							<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-5 w-5" fill="none" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
							</svg>
							<span>Budget is balanced — total profit equals total loss.</span>
						</div>
					{:else if netBudget > 0}
						<div class="alert alert-info py-2 text-sm">
							<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-5 h-5">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
							</svg>
							<span>
								Not balanced — surplus of <span class="font-mono font-semibold">{formatAmount(netBudget)}</span>
								(profit exceeds loss).
							</span>
						</div>
					{:else}
						<div class="alert alert-warning py-2 text-sm">
							<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-5 w-5" fill="none" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
							</svg>
							<span>
								Not balanced — deficit of <span class="font-mono font-semibold">{formatAmount(Math.abs(netBudget))}</span>
								(loss exceeds profit).
							</span>
						</div>
					{/if}
				</div>

				<div class="card-actions justify-end mt-6">
					<button class="btn btn-primary" onclick={saveBudgets} disabled={saving}>
						{#if saving}
							<span class="loading loading-spinner"></span>
							Saving...
						{:else}
							Save Budgets
						{/if}
					</button>
				</div>
			{/if}
		</div>
	</div>
</div>
