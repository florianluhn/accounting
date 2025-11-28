<script lang="ts">
	import {
		glAccountsAPI,
		subledgerAccountsAPI,
		currenciesAPI,
		type GLAccount,
		type SubledgerAccount,
		type Currency,
		type AccountType
	} from '$lib/api';

	let activeTab = $state<'gl' | 'subledger'>('gl');
	let glLoading = $state(true);
	let subledgerLoading = $state(true);
	let currenciesLoading = $state(true);
	let error = $state('');

	// GL Accounts
	let glAccounts = $state<GLAccount[]>([]);
	let showGLModal = $state(false);
	let editingGL = $state<GLAccount | null>(null);
	let glFormData = $state({
		accountNumber: '',
		name: '',
		type: 'Asset' as AccountType,
		description: '',
		isActive: true
	});

	// Subledger Accounts
	let subledgerAccounts = $state<SubledgerAccount[]>([]);
	let currencies = $state<Currency[]>([]);
	let showSubledgerModal = $state(false);
	let editingSubledger = $state<SubledgerAccount | null>(null);
	let subledgerFormData = $state({
		glAccountId: 0,
		accountNumber: '',
		name: '',
		currencyCode: 'USD',
		description: '',
		isActive: true
	});

	const accountTypes: AccountType[] = [
		'Asset',
		'Cash',
		'Accounts Receivable',
		'Equity',
		'Accounts Payable',
		'Profit',
		'Loss',
		'Opening Balance'
	];

	$effect(() => {
		loadGLAccounts();
		loadSubledgerAccounts();
		loadCurrencies();
	});

	async function loadGLAccounts() {
		try {
			glLoading = true;
			error = '';
			glAccounts = await glAccountsAPI.list();
		} catch (e) {
			console.error('Error loading GL accounts:', e);
			error = e instanceof Error ? e.message : 'Failed to load GL accounts';
		} finally {
			glLoading = false;
		}
	}

	async function loadSubledgerAccounts() {
		try {
			subledgerLoading = true;
			error = '';
			subledgerAccounts = await subledgerAccountsAPI.list();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load subledger accounts';
		} finally {
			subledgerLoading = false;
		}
	}

	async function loadCurrencies() {
		try {
			currenciesLoading = true;
			currencies = await currenciesAPI.list();
		} catch (e) {
			console.error('Failed to load currencies:', e);
		} finally {
			currenciesLoading = false;
		}
	}

	// GL Account Functions
	function openGLModal() {
		glFormData = {
			accountNumber: '',
			name: '',
			type: 'Asset',
			description: '',
			isActive: true
		};
		editingGL = null;
		showGLModal = true;
	}

	function openEditGLModal(account: GLAccount) {
		glFormData = {
			accountNumber: account.accountNumber,
			name: account.name,
			type: account.type,
			description: account.description || '',
			isActive: account.isActive
		};
		editingGL = account;
		showGLModal = true;
	}

	function closeGLModal() {
		showGLModal = false;
		editingGL = null;
	}

	async function handleGLSubmit() {
		try {
			error = '';
			if (editingGL) {
				await glAccountsAPI.update(editingGL.id, glFormData);
			} else {
				await glAccountsAPI.create(glFormData);
			}
			await loadGLAccounts();
			closeGLModal();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save GL account';
		}
	}

	async function handleGLDelete(id: number) {
		if (!confirm('Are you sure you want to delete this GL account?')) {
			return;
		}

		try {
			error = '';
			await glAccountsAPI.delete(id);
			await loadGLAccounts();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to delete GL account';
		}
	}

	// Subledger Account Functions
	function openSubledgerModal() {
		subledgerFormData = {
			glAccountId: glAccounts.length > 0 ? glAccounts[0].id : 0,
			accountNumber: '',
			name: '',
			currencyCode: currencies.find((c) => c.isDefault)?.code || 'USD',
			description: '',
			isActive: true
		};
		editingSubledger = null;
		showSubledgerModal = true;
	}

	function openEditSubledgerModal(account: SubledgerAccount) {
		subledgerFormData = {
			glAccountId: account.glAccountId,
			accountNumber: account.accountNumber,
			name: account.name,
			currencyCode: account.currencyCode,
			description: account.description || '',
			isActive: account.isActive
		};
		editingSubledger = account;
		showSubledgerModal = true;
	}

	function closeSubledgerModal() {
		showSubledgerModal = false;
		editingSubledger = null;
	}

	async function handleSubledgerSubmit() {
		try {
			error = '';
			if (editingSubledger) {
				await subledgerAccountsAPI.update(editingSubledger.id, subledgerFormData);
			} else {
				await subledgerAccountsAPI.create(subledgerFormData);
			}
			await loadSubledgerAccounts();
			closeSubledgerModal();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save subledger account';
		}
	}

	async function handleSubledgerDelete(id: number) {
		if (!confirm('Are you sure you want to delete this subledger account?')) {
			return;
		}

		try {
			error = '';
			await subledgerAccountsAPI.delete(id);
			await loadSubledgerAccounts();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to delete subledger account';
		}
	}

	function getGLAccountName(id: number): string {
		const account = glAccounts.find((a) => a.id === id);
		return account ? `${account.accountNumber} - ${account.name}` : 'Unknown';
	}
</script>

<div class="max-w-7xl mx-auto">
	<!-- Header -->
	<div class="mb-8">
		<h1 class="text-4xl font-bold mb-2">Chart of Accounts</h1>
		<p class="text-base-content/70">Manage your GL accounts and subledger accounts</p>
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

	<!-- Tabs -->
	<div role="tablist" class="tabs tabs-boxed mb-6">
		<button
			role="tab"
			class="tab"
			class:tab-active={activeTab === 'gl'}
			onclick={() => (activeTab = 'gl')}
		>
			GL Accounts
		</button>
		<button
			role="tab"
			class="tab"
			class:tab-active={activeTab === 'subledger'}
			onclick={() => (activeTab = 'subledger')}
		>
			Subledger Accounts
		</button>
	</div>

	<!-- GL Accounts Tab -->
	{#if activeTab === 'gl'}
		<div class="card bg-base-100 shadow-xl">
			<div class="card-body">
				<div class="flex justify-between items-center mb-4">
					<h2 class="card-title">GL Accounts</h2>
					<button class="btn btn-primary" onclick={openGLModal}>+ New GL Account</button>
				</div>

				{#if glLoading}
					<div class="flex justify-center py-8">
						<span class="loading loading-spinner loading-lg"></span>
					</div>
				{:else if glAccounts.length === 0}
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
						<span>No GL accounts yet. Create your first account to get started.</span>
					</div>
				{:else}
					<div class="overflow-x-auto">
						<table class="table table-zebra">
							<thead>
								<tr>
									<th>Account Number</th>
									<th>Name</th>
									<th>Type</th>
									<th>Status</th>
									<th>Actions</th>
								</tr>
							</thead>
							<tbody>
								{#each glAccounts as account}
									<tr>
										<td class="font-mono font-bold">{account.accountNumber}</td>
										<td>{account.name}</td>
										<td>
											<span class="badge badge-outline">{account.type}</span>
										</td>
										<td>
											{#if account.isActive}
												<span class="badge badge-success">Active</span>
											{:else}
												<span class="badge badge-ghost">Inactive</span>
											{/if}
										</td>
										<td>
											<div class="flex gap-2">
												<button
													class="btn btn-sm btn-ghost"
													onclick={() => openEditGLModal(account)}
												>
													Edit
												</button>
												<button
													class="btn btn-sm btn-ghost text-error"
													onclick={() => handleGLDelete(account.id)}
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
	{/if}

	<!-- Subledger Accounts Tab -->
	{#if activeTab === 'subledger'}
		<div class="card bg-base-100 shadow-xl">
			<div class="card-body">
				<div class="flex justify-between items-center mb-4">
					<h2 class="card-title">Subledger Accounts</h2>
					<button
						class="btn btn-primary"
						onclick={openSubledgerModal}
						disabled={glAccounts.length === 0}
					>
						+ New Subledger Account
					</button>
				</div>

				{#if glAccounts.length === 0}
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
						<span>You must create GL accounts first before creating subledger accounts.</span>
					</div>
				{:else if subledgerLoading}
					<div class="flex justify-center py-8">
						<span class="loading loading-spinner loading-lg"></span>
					</div>
				{:else if subledgerAccounts.length === 0}
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
						<span>No subledger accounts yet. Create your first subledger account to get started.</span>
					</div>
				{:else}
					<div class="overflow-x-auto">
						<table class="table table-zebra">
							<thead>
								<tr>
									<th>Account Number</th>
									<th>Name</th>
									<th>GL Account</th>
									<th>Currency</th>
									<th>Status</th>
									<th>Actions</th>
								</tr>
							</thead>
							<tbody>
								{#each subledgerAccounts as account}
									<tr>
										<td class="font-mono font-bold">{account.accountNumber}</td>
										<td>{account.name}</td>
										<td class="text-sm">{getGLAccountName(account.glAccountId)}</td>
										<td>
											<span class="badge badge-outline">{account.currencyCode}</span>
										</td>
										<td>
											{#if account.isActive}
												<span class="badge badge-success">Active</span>
											{:else}
												<span class="badge badge-ghost">Inactive</span>
											{/if}
										</td>
										<td>
											<div class="flex gap-2">
												<button
													class="btn btn-sm btn-ghost"
													onclick={() => openEditSubledgerModal(account)}
												>
													Edit
												</button>
												<button
													class="btn btn-sm btn-ghost text-error"
													onclick={() => handleSubledgerDelete(account.id)}
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
	{/if}
</div>

<!-- GL Account Modal -->
{#if showGLModal}
	<div class="modal modal-open">
		<div class="modal-box">
			<h3 class="font-bold text-lg mb-4">
				{editingGL ? 'Edit GL Account' : 'Add New GL Account'}
			</h3>

			<form onsubmit={(e) => { e.preventDefault(); handleGLSubmit(); }}>
				<div class="form-control mb-4">
					<label class="label">
						<span class="label-text">Account Number</span>
					</label>
					<input
						type="text"
						class="input input-bordered"
						bind:value={glFormData.accountNumber}
						required
					/>
				</div>

				<div class="form-control mb-4">
					<label class="label">
						<span class="label-text">Account Name</span>
					</label>
					<input
						type="text"
						class="input input-bordered"
						bind:value={glFormData.name}
						required
					/>
				</div>

				<div class="form-control mb-4">
					<label class="label">
						<span class="label-text">Account Type</span>
					</label>
					<select class="select select-bordered" bind:value={glFormData.type} required>
						{#each accountTypes as type}
							<option value={type}>{type}</option>
						{/each}
					</select>
				</div>

				<div class="form-control mb-4">
					<label class="label">
						<span class="label-text">Description (Optional)</span>
					</label>
					<textarea
						class="textarea textarea-bordered"
						bind:value={glFormData.description}
						rows="2"
					></textarea>
				</div>

				<div class="form-control mb-4">
					<label class="label cursor-pointer justify-start gap-4">
						<input type="checkbox" class="checkbox" bind:checked={glFormData.isActive} />
						<span class="label-text">Active</span>
					</label>
				</div>

				<div class="modal-action">
					<button type="button" class="btn" onclick={closeGLModal}>Cancel</button>
					<button type="submit" class="btn btn-primary">
						{editingGL ? 'Save Changes' : 'Add GL Account'}
					</button>
				</div>
			</form>
		</div>
		<div class="modal-backdrop" onclick={closeGLModal}></div>
	</div>
{/if}

<!-- Subledger Account Modal -->
{#if showSubledgerModal}
	<div class="modal modal-open">
		<div class="modal-box">
			<h3 class="font-bold text-lg mb-4">
				{editingSubledger ? 'Edit Subledger Account' : 'Add New Subledger Account'}
			</h3>

			<form onsubmit={(e) => { e.preventDefault(); handleSubledgerSubmit(); }}>
				<div class="form-control mb-4">
					<label class="label">
						<span class="label-text">GL Account</span>
					</label>
					<select
						class="select select-bordered"
						bind:value={subledgerFormData.glAccountId}
						required
					>
						{#each glAccounts as glAccount}
							<option value={glAccount.id}>
								{glAccount.accountNumber} - {glAccount.name} ({glAccount.type})
							</option>
						{/each}
					</select>
				</div>

				<div class="form-control mb-4">
					<label class="label">
						<span class="label-text">Account Number</span>
					</label>
					<input
						type="text"
						class="input input-bordered"
						bind:value={subledgerFormData.accountNumber}
						required
					/>
				</div>

				<div class="form-control mb-4">
					<label class="label">
						<span class="label-text">Account Name</span>
					</label>
					<input
						type="text"
						class="input input-bordered"
						bind:value={subledgerFormData.name}
						required
					/>
				</div>

				<div class="form-control mb-4">
					<label class="label">
						<span class="label-text">Currency</span>
					</label>
					<select
						class="select select-bordered"
						bind:value={subledgerFormData.currencyCode}
						required
					>
						{#each currencies as currency}
							<option value={currency.code}>
								{currency.code} - {currency.name} ({currency.symbol})
							</option>
						{/each}
					</select>
				</div>

				<div class="form-control mb-4">
					<label class="label">
						<span class="label-text">Description (Optional)</span>
					</label>
					<textarea
						class="textarea textarea-bordered"
						bind:value={subledgerFormData.description}
						rows="2"
					></textarea>
				</div>

				<div class="form-control mb-4">
					<label class="label cursor-pointer justify-start gap-4">
						<input type="checkbox" class="checkbox" bind:checked={subledgerFormData.isActive} />
						<span class="label-text">Active</span>
					</label>
				</div>

				<div class="modal-action">
					<button type="button" class="btn" onclick={closeSubledgerModal}>Cancel</button>
					<button type="submit" class="btn btn-primary">
						{editingSubledger ? 'Save Changes' : 'Add Subledger Account'}
					</button>
				</div>
			</form>
		</div>
		<div class="modal-backdrop" onclick={closeSubledgerModal}></div>
	</div>
{/if}
