<script lang="ts">
	import { onMount } from 'svelte';
	import {
		subledgerAccountsAPI,
		budgetsAPI,
		type SubledgerAccount,
		type Budget
	} from '$lib/api';

	let loading = $state(true);
	let saving = $state(false);
	let error = $state('');
	let success = $state('');

	let selectedYear = $state(new Date().getFullYear());
	let accounts = $state<SubledgerAccount[]>([]);
	let budgets = $state<Budget[]>([]);

	// Form state map: subledgerAccountId -> amount
	let budgetValues = $state<Record<number, number>>({});

	$effect(() => {
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
			const glAccountTypes = new Map(glAccounts.map(g => [g.id, g.type]));

			// Filter accounts for Profit and Loss
			accounts = accounts.filter(a => {
				const type = glAccountTypes.get(a.glAccountId);
				return type === 'Profit' || type === 'Loss';
			});

			// Sort by Account Number
			accounts.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber, undefined, { numeric: true }));

			// Fetch budgets for the selected year
			budgets = await budgetsAPI.list({ year });

			// Populate form state
			const newBudgetValues: Record<number, number> = {};
			for (const account of accounts) {
				const existingBudget = budgets.find(b => b.subledgerAccountId === account.id);
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
		<p class="page-subtitle">Annual budgets for profit and loss accounts</p>
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
			<div class="flex items-end gap-4 mb-6">
				<div class="form-control">
					<label class="label">
						<span class="label-text">Year</span>
					</label>
					<input type="number" class="input input-bordered w-32" bind:value={selectedYear} min="2000" max="2100" />
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
