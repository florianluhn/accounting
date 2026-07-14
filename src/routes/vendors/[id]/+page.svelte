<script lang="ts">
	import { page } from '$app/stores';
	import {
		vendorsAPI,
		subledgerAccountsAPI,
		currenciesAPI,
		type Vendor,
		type JournalEntry,
		type SubledgerAccount,
		type Currency
	} from '$lib/api';

	let vendor = $state<Vendor | null>(null);
	let journalEntries = $state<JournalEntry[]>([]);
	let subledgerAccounts = $state<SubledgerAccount[]>([]);
	let currencies = $state<Currency[]>([]);
	let loading = $state(true);
	let error = $state('');

	// Edit modal state
	let showEditModal = $state(false);
	let formData = $state({
		name: '',
		address: '',
		phone: '',
		email: '',
		website: '',
		comments: ''
	});

	$effect(() => {
		const id = parseInt($page.params.id);
		if (!isNaN(id)) {
			loadData(id);
		}
	});

	async function loadData(id: number) {
		try {
			loading = true;
			error = '';
			const [v, entries, accounts, curr] = await Promise.all([
				vendorsAPI.get(id),
				vendorsAPI.getJournalEntries(id),
				subledgerAccountsAPI.list(),
				currenciesAPI.list()
			]);
			vendor = v;
			journalEntries = entries;
			subledgerAccounts = accounts;
			currencies = curr;
		} catch (e) {
			console.error('Error loading vendor:', e);
			error = e instanceof Error ? e.message : 'Failed to load vendor';
		} finally {
			loading = false;
		}
	}

	function openEditModal() {
		if (!vendor) return;
		formData = {
			name: vendor.name,
			address: vendor.address || '',
			phone: vendor.phone || '',
			email: vendor.email || '',
			website: vendor.website || '',
			comments: vendor.comments || ''
		};
		showEditModal = true;
	}

	function closeEditModal() {
		showEditModal = false;
	}

	async function handleSubmit() {
		if (!vendor) return;
		try {
			error = '';
			const data = {
				name: formData.name,
				address: formData.address || undefined,
				phone: formData.phone || undefined,
				email: formData.email || undefined,
				website: formData.website || undefined,
				comments: formData.comments || undefined
			};
			await vendorsAPI.update(vendor.id, data);
			await loadData(vendor.id);
			closeEditModal();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to update vendor';
		}
	}

	function getAccountName(id: number): string {
		const account = subledgerAccounts.find(a => a.id === id);
		return account ? `${account.accountNumber} - ${account.name}` : 'Unknown';
	}

	function formatDate(date: Date): string {
		const d = new Date(date);
		const year = d.getUTCFullYear();
		const month = String(d.getUTCMonth() + 1).padStart(2, '0');
		const day = String(d.getUTCDate()).padStart(2, '0');
		return `${month}/${day}/${year}`;
	}

	function formatCurrency(amount: number, currencyCode: string): string {
		const currency = currencies.find(c => c.code === currencyCode);
		return `${currency?.symbol || currencyCode} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}
</script>

<div class="page-shell">
	{#if loading}
		<div class="flex justify-center py-8">
			<span class="loading loading-spinner loading-lg"></span>
		</div>
	{:else if error}
		<div class="alert alert-error mb-6">
			<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
			</svg>
			<span>{error}</span>
		</div>
		<a href="/vendors" class="btn btn-ghost">Back to Vendors</a>
	{:else if vendor}
		<!-- Header -->
		<div class="mb-8 flex justify-between items-start">
			<div>
				<div class="text-sm breadcrumbs mb-2">
					<ul>
						<li><a href="/vendors">Vendors</a></li>
						<li>{vendor.name}</li>
					</ul>
				</div>
				<h1 class="page-title">{vendor.name}</h1>
			</div>
			<button class="btn btn-primary" onclick={openEditModal}>
				Edit Vendor
			</button>
		</div>

		<!-- Vendor Details Card -->
		<div class="card bg-base-100 shadow-xl mb-8">
			<div class="card-body">
				<h2 class="card-title mb-4">Vendor Details</h2>
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					{#if vendor.address}
						<div>
							<span class="font-semibold text-base-content/70">Address</span>
							<p class="whitespace-pre-line">{vendor.address}</p>
						</div>
					{/if}
					{#if vendor.phone}
						<div>
							<span class="font-semibold text-base-content/70">Phone</span>
							<p>{vendor.phone}</p>
						</div>
					{/if}
					{#if vendor.email}
						<div>
							<span class="font-semibold text-base-content/70">Email</span>
							<p><a href="mailto:{vendor.email}" class="link link-primary">{vendor.email}</a></p>
						</div>
					{/if}
					{#if vendor.website}
						<div>
							<span class="font-semibold text-base-content/70">Website</span>
							<p>
								<a
									href={vendor.website.startsWith('http') ? vendor.website : `https://${vendor.website}`}
									class="link link-primary"
									target="_blank"
									rel="noopener noreferrer"
								>
									{vendor.website}
								</a>
							</p>
						</div>
					{/if}
					{#if vendor.comments}
						<div class="col-span-full">
							<span class="font-semibold text-base-content/70">Comments</span>
							<p class="whitespace-pre-line">{vendor.comments}</p>
						</div>
					{/if}
					{#if !vendor.address && !vendor.phone && !vendor.email && !vendor.website && !vendor.comments}
						<p class="text-base-content/50 col-span-full">No additional details provided.</p>
					{/if}
				</div>
			</div>
		</div>

		<!-- Journal Entries -->
		<div class="card bg-base-100 shadow-xl">
			<div class="card-body">
				<h2 class="card-title mb-4">
					Journal Entries
					<span class="badge badge-neutral">{journalEntries.length}</span>
				</h2>
				{#if journalEntries.length === 0}
					<div class="alert alert-info">
						<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
						</svg>
						<span>No journal entries linked to this vendor yet.</span>
					</div>
				{:else}
					<div class="overflow-x-auto">
						<table class="table table-zebra">
							<thead>
								<tr>
									<th>Date</th>
									<th>Description</th>
									<th>Debit Account</th>
									<th>Credit Account</th>
									<th>Amount</th>
									<th>Category</th>
								</tr>
							</thead>
							<tbody>
								{#each journalEntries as entry}
									<tr>
										<td>{formatDate(entry.entryDate)}</td>
										<td>
											<div class="font-medium">{entry.description}</div>
											{#if entry.comment}
												<div class="text-sm text-base-content/70">{entry.comment}</div>
											{/if}
										</td>
										<td class="text-sm">{getAccountName(entry.debitAccountId)}</td>
										<td class="text-sm">{getAccountName(entry.creditAccountId)}</td>
										<td class="font-mono font-bold">{formatCurrency(entry.amount, entry.currencyCode)}</td>
										<td>
											{#if entry.category}
												<span class="badge badge-outline">{entry.category}</span>
											{/if}
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

<!-- Edit Vendor Modal -->
{#if showEditModal}
	<div class="modal modal-open" onclick={(e) => {
		if (e.target === e.currentTarget) closeEditModal();
	}}>
		<div class="modal-box max-w-2xl">
			<h3 class="font-bold text-lg mb-4">Edit Vendor</h3>

			<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
				<div class="grid grid-cols-2 gap-4">
					<div class="form-control col-span-2">
						<label class="label">
							<span class="label-text">Vendor Name</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.name}
							required
						/>
					</div>

					<div class="form-control col-span-2">
						<label class="label">
							<span class="label-text">Address (Optional)</span>
						</label>
						<textarea
							class="textarea textarea-bordered"
							bind:value={formData.address}
							rows="2"
						></textarea>
					</div>

					<div class="form-control">
						<label class="label">
							<span class="label-text">Phone (Optional)</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.phone}
						/>
					</div>

					<div class="form-control">
						<label class="label">
							<span class="label-text">Email (Optional)</span>
						</label>
						<input
							type="email"
							class="input input-bordered"
							bind:value={formData.email}
						/>
					</div>

					<div class="form-control col-span-2">
						<label class="label">
							<span class="label-text">Website (Optional)</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.website}
						/>
					</div>

					<div class="form-control col-span-2">
						<label class="label">
							<span class="label-text">Comments (Optional)</span>
						</label>
						<textarea
							class="textarea textarea-bordered"
							bind:value={formData.comments}
							rows="3"
						></textarea>
					</div>
				</div>

				<div class="modal-action">
					<button type="button" class="btn" onclick={closeEditModal}>Cancel</button>
					<button type="submit" class="btn btn-primary">Save Changes</button>
				</div>
			</form>
		</div>
		<div class="modal-backdrop" onclick={closeEditModal}></div>
	</div>
{/if}
