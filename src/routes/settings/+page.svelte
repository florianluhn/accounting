<script lang="ts">
	import { currenciesAPI, type Currency } from '$lib/api';

	let currencies = $state<Currency[]>([]);
	let loading = $state(true);
	let error = $state('');
	let showAddModal = $state(false);
	let editingCurrency = $state<Currency | null>(null);

	// Form state
	let formData = $state({
		code: '',
		name: '',
		symbol: '',
		exchangeRate: 1.0,
		isDefault: false
	});

	$effect(() => {
		loadCurrencies();
	});

	async function loadCurrencies() {
		try {
			loading = true;
			error = '';
			currencies = await currenciesAPI.list();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load currencies';
		} finally {
			loading = false;
		}
	}

	function openAddModal() {
		formData = {
			code: '',
			name: '',
			symbol: '',
			exchangeRate: 1.0,
			isDefault: false
		};
		editingCurrency = null;
		showAddModal = true;
	}

	function openEditModal(currency: Currency) {
		formData = { ...currency };
		editingCurrency = currency;
		showAddModal = true;
	}

	function closeModal() {
		showAddModal = false;
		editingCurrency = null;
	}

	async function handleSubmit() {
		try {
			error = '';
			if (editingCurrency) {
				await currenciesAPI.update(editingCurrency.code, formData);
			} else {
				await currenciesAPI.create(formData);
			}
			await loadCurrencies();
			closeModal();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save currency';
		}
	}

	async function handleDelete(code: string) {
		if (!confirm(`Are you sure you want to delete currency ${code}?`)) {
			return;
		}

		try {
			error = '';
			await currenciesAPI.delete(code);
			await loadCurrencies();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to delete currency';
		}
	}
</script>

<div class="max-w-7xl mx-auto">
	<!-- Header -->
	<div class="mb-8">
		<h1 class="text-4xl font-bold mb-2">Settings</h1>
		<p class="text-base-content/70">Manage currencies and application preferences</p>
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

	<!-- Currencies Section -->
	<div class="card bg-base-100 shadow-xl mb-6">
		<div class="card-body">
			<div class="flex justify-between items-center mb-4">
				<h2 class="card-title text-2xl">Currencies</h2>
				<button class="btn btn-primary" onclick={openAddModal}>+ Add Currency</button>
			</div>

			{#if loading}
				<div class="flex justify-center py-8">
					<span class="loading loading-spinner loading-lg"></span>
				</div>
			{:else if currencies.length === 0}
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
					<span>No currencies configured. Add your first currency to get started.</span>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="table table-zebra">
						<thead>
							<tr>
								<th>Code</th>
								<th>Name</th>
								<th>Symbol</th>
								<th>Exchange Rate (to USD)</th>
								<th>Default</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each currencies as currency}
								<tr>
									<td class="font-mono font-bold">{currency.code}</td>
									<td>{currency.name}</td>
									<td class="font-bold">{currency.symbol}</td>
									<td>{currency.exchangeRate.toFixed(4)}</td>
									<td>
										{#if currency.isDefault}
											<span class="badge badge-primary">Default</span>
										{/if}
									</td>
									<td>
										<div class="flex gap-2">
											<button
												class="btn btn-sm btn-ghost"
												onclick={() => openEditModal(currency)}
											>
												Edit
											</button>
											<button
												class="btn btn-sm btn-ghost text-error"
												onclick={() => handleDelete(currency.code)}
												disabled={currency.isDefault}
											>
												Delete
											</button>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	</div>

	<!-- Database Info -->
	<div class="card bg-base-100 shadow-xl">
		<div class="card-body">
			<h2 class="card-title text-2xl mb-4">Database Information</h2>
			<div class="stats shadow">
				<div class="stat">
					<div class="stat-title">Database Path</div>
					<div class="stat-value text-lg">./data/accounting.db</div>
				</div>
				<div class="stat">
					<div class="stat-title">Attachments Path</div>
					<div class="stat-value text-lg">./data/attachments</div>
				</div>
			</div>
		</div>
	</div>
</div>

<!-- Add/Edit Currency Modal -->
{#if showAddModal}
	<div class="modal modal-open">
		<div class="modal-box">
			<h3 class="font-bold text-lg mb-4">
				{editingCurrency ? 'Edit Currency' : 'Add New Currency'}
			</h3>

			<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
				<div class="form-control mb-4">
					<label class="label">
						<span class="label-text">Currency Code (3 letters)</span>
					</label>
					<input
						type="text"
						class="input input-bordered"
						bind:value={formData.code}
						maxlength="3"
						pattern="[A-Z]{3}"
						required
						disabled={!!editingCurrency}
					/>
				</div>

				<div class="form-control mb-4">
					<label class="label">
						<span class="label-text">Currency Name</span>
					</label>
					<input
						type="text"
						class="input input-bordered"
						bind:value={formData.name}
						required
					/>
				</div>

				<div class="form-control mb-4">
					<label class="label">
						<span class="label-text">Symbol</span>
					</label>
					<input
						type="text"
						class="input input-bordered"
						bind:value={formData.symbol}
						required
					/>
				</div>

				<div class="form-control mb-4">
					<label class="label">
						<span class="label-text">Exchange Rate (to USD)</span>
					</label>
					<input
						type="number"
						class="input input-bordered"
						bind:value={formData.exchangeRate}
						step="0.0001"
						min="0.0001"
						required
					/>
					<label class="label">
						<span class="label-text-alt">1 {formData.code || 'XXX'} = {formData.exchangeRate} USD</span>
					</label>
				</div>

				<div class="form-control mb-4">
					<label class="label cursor-pointer justify-start gap-4">
						<input
							type="checkbox"
							class="checkbox"
							bind:checked={formData.isDefault}
						/>
						<span class="label-text">Set as default currency</span>
					</label>
				</div>

				<div class="modal-action">
					<button type="button" class="btn" onclick={closeModal}>Cancel</button>
					<button type="submit" class="btn btn-primary">
						{editingCurrency ? 'Save Changes' : 'Add Currency'}
					</button>
				</div>
			</form>
		</div>
		<div class="modal-backdrop" onclick={closeModal}></div>
	</div>
{/if}
