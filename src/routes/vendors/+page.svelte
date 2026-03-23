<script lang="ts">
	import { vendorsAPI, type Vendor } from '$lib/api';

	let vendors = $state<Vendor[]>([]);
	let loading = $state(true);
	let error = $state('');
	let searchQuery = $state('');
	let uploadingCSV = $state(false);
	let csvUploadResult = $state<{ success: number; failed: number; errors: string[]; message?: string } | null>(null);

	// Modal state
	let showModal = $state(false);
	let editingVendor = $state<Vendor | null>(null);
	let formData = $state({
		name: '',
		address: '',
		phone: '',
		email: '',
		website: '',
		comments: ''
	});

	$effect(() => {
		loadVendors();
	});

	async function loadVendors() {
		try {
			loading = true;
			error = '';
			vendors = await vendorsAPI.list();
		} catch (e) {
			console.error('Error loading vendors:', e);
			error = e instanceof Error ? e.message : 'Failed to load vendors';
		} finally {
			loading = false;
		}
	}

	function openModal() {
		formData = {
			name: '',
			address: '',
			phone: '',
			email: '',
			website: '',
			comments: ''
		};
		editingVendor = null;
		showModal = true;
	}

	function openEditModal(vendor: Vendor) {
		formData = {
			name: vendor.name,
			address: vendor.address || '',
			phone: vendor.phone || '',
			email: vendor.email || '',
			website: vendor.website || '',
			comments: vendor.comments || ''
		};
		editingVendor = vendor;
		showModal = true;
	}

	function closeModal() {
		showModal = false;
		editingVendor = null;
	}

	async function handleSubmit() {
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

			if (editingVendor) {
				await vendorsAPI.update(editingVendor.id, data);
			} else {
				await vendorsAPI.create(data);
			}

			await loadVendors();
			closeModal();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save vendor';
		}
	}

	async function handleDelete(id: number) {
		if (!confirm('Are you sure you want to delete this vendor? Journal entries linked to this vendor will have their vendor reference removed.')) {
			return;
		}

		try {
			error = '';
			await vendorsAPI.delete(id);
			await loadVendors();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to delete vendor';
		}
	}

	async function handleDownloadCSV() {
		try {
			error = '';
			await vendorsAPI.downloadCSV();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to download CSV';
		}
	}

	function handleCSVFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		if (input.files && input.files[0]) {
			uploadCSVFile(input.files[0]);
		}
	}

	async function uploadCSVFile(file: File) {
		try {
			error = '';
			uploadingCSV = true;
			csvUploadResult = null;

			const result = await vendorsAPI.uploadCSV(file);
			csvUploadResult = result;

			if (result.success > 0) {
				await loadVendors();
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to upload CSV';
		} finally {
			uploadingCSV = false;
		}
	}

	let filteredVendors = $derived(
		searchQuery
			? vendors.filter(v =>
					v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
					v.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
					v.phone?.toLowerCase().includes(searchQuery.toLowerCase())
				)
			: vendors
	);
</script>

<div class="max-w-7xl mx-auto">
	<!-- Header -->
	<div class="mb-8">
		<h1 class="text-4xl font-bold mb-2">Vendors</h1>
		<p class="text-base-content/70">Manage your vendors and suppliers</p>
	</div>

	{#if error}
		<div class="alert alert-error mb-6">
			<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
			</svg>
			<span>{error}</span>
		</div>
	{/if}

	<!-- Search and Actions -->
	<div class="flex justify-between items-center gap-4 flex-wrap mb-6">
		<div class="form-control">
			<input
				type="text"
				placeholder="Search vendors..."
				class="input input-bordered w-64"
				bind:value={searchQuery}
			/>
		</div>
		<div class="flex gap-2 flex-wrap">
			<button
				class="btn btn-outline"
				onclick={handleDownloadCSV}
				disabled={vendors.length === 0}
				title="Download vendors as CSV"
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
				</svg>
				Download CSV
			</button>
			<label class="btn btn-outline" class:loading={uploadingCSV}>
				<input
					type="file"
					accept=".csv"
					class="hidden"
					onchange={handleCSVFileSelect}
					disabled={uploadingCSV}
				/>
				{#if uploadingCSV}
					<span class="loading loading-spinner loading-sm"></span>
					Uploading...
				{:else}
					<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
					</svg>
					Upload CSV
				{/if}
			</label>
			<button class="btn btn-primary" onclick={openModal}>
				+ New Vendor
			</button>
		</div>
	</div>

	<!-- CSV Upload Result -->
	{#if csvUploadResult}
		<div class="alert {csvUploadResult.failed === 0 ? 'alert-success' : csvUploadResult.success === 0 ? 'alert-error' : 'alert-warning'} mb-6">
			<div>
				<h3 class="font-bold">{csvUploadResult.success === 0 ? 'CSV Upload Failed' : 'CSV Upload Complete'}</h3>
				<div class="text-sm">
					{#if csvUploadResult.message}
						<p class="font-medium">{csvUploadResult.message}</p>
					{/if}
					<p>Successfully imported: {csvUploadResult.success} vendors</p>
					{#if csvUploadResult.failed > 0}
						<p>Failed: {csvUploadResult.failed} entries</p>
						<details class="mt-2">
							<summary class="cursor-pointer font-medium">Show errors</summary>
							<ul class="list-disc list-inside mt-1 space-y-1">
								{#each csvUploadResult.errors as err}
									<li class="text-xs">{err}</li>
								{/each}
							</ul>
						</details>
					{/if}
				</div>
			</div>
			<button class="btn btn-sm btn-ghost" onclick={() => csvUploadResult = null}>Dismiss</button>
		</div>
	{/if}

	<!-- Vendors List -->
	<div class="card bg-base-100 shadow-xl">
		<div class="card-body">
			{#if loading}
				<div class="flex justify-center py-8">
					<span class="loading loading-spinner loading-lg"></span>
				</div>
			{:else if filteredVendors.length === 0}
				<div class="alert alert-info">
					<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
					</svg>
					<span>
						{searchQuery
							? 'No vendors match your search.'
							: 'No vendors yet. Create your first vendor to get started.'}
					</span>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="table table-zebra">
						<thead>
							<tr>
								<th>Name</th>
								<th>Phone</th>
								<th>Email</th>
								<th>Website</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each filteredVendors as vendor}
								<tr>
									<td>
										<a href="/vendors/{vendor.id}" class="link link-primary font-medium">
											{vendor.name}
										</a>
									</td>
									<td>{vendor.phone || '-'}</td>
									<td>
										{#if vendor.email}
											<a href="mailto:{vendor.email}" class="link link-hover">{vendor.email}</a>
										{:else}
											-
										{/if}
									</td>
									<td>
										{#if vendor.website}
											<a href={vendor.website.startsWith('http') ? vendor.website : `https://${vendor.website}`} class="link link-hover" target="_blank" rel="noopener noreferrer">
												{vendor.website}
											</a>
										{:else}
											-
										{/if}
									</td>
									<td>
										<div class="flex gap-2">
											<a href="/vendors/{vendor.id}" class="btn btn-sm btn-ghost">
												View
											</a>
											<button class="btn btn-sm btn-ghost" onclick={() => openEditModal(vendor)}>
												Edit
											</button>
											<button
												class="btn btn-sm btn-ghost text-error"
												onclick={() => handleDelete(vendor.id)}
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
</div>

<!-- Vendor Modal -->
{#if showModal}
	<div class="modal modal-open" onclick={(e) => {
		if (e.target === e.currentTarget) closeModal();
	}}>
		<div class="modal-box max-w-2xl">
			<h3 class="font-bold text-lg mb-4">
				{editingVendor ? 'Edit Vendor' : 'New Vendor'}
			</h3>

			<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
				<div class="grid grid-cols-2 gap-4">
					<!-- Name -->
					<div class="form-control col-span-2">
						<label class="label">
							<span class="label-text">Vendor Name</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.name}
							required
							placeholder="Company or individual name"
						/>
					</div>

					<!-- Address -->
					<div class="form-control col-span-2">
						<label class="label">
							<span class="label-text">Address (Optional)</span>
						</label>
						<textarea
							class="textarea textarea-bordered"
							bind:value={formData.address}
							rows="2"
							placeholder="Street, City, State, ZIP"
						></textarea>
					</div>

					<!-- Phone -->
					<div class="form-control">
						<label class="label">
							<span class="label-text">Phone (Optional)</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.phone}
							placeholder="+1 (555) 123-4567"
						/>
					</div>

					<!-- Email -->
					<div class="form-control">
						<label class="label">
							<span class="label-text">Email (Optional)</span>
						</label>
						<input
							type="email"
							class="input input-bordered"
							bind:value={formData.email}
							placeholder="vendor@example.com"
						/>
					</div>

					<!-- Website -->
					<div class="form-control col-span-2">
						<label class="label">
							<span class="label-text">Website (Optional)</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.website}
							placeholder="https://example.com"
						/>
					</div>

					<!-- Comments -->
					<div class="form-control col-span-2">
						<label class="label">
							<span class="label-text">Comments (Optional)</span>
						</label>
						<textarea
							class="textarea textarea-bordered"
							bind:value={formData.comments}
							rows="3"
							placeholder="Additional notes about this vendor"
						></textarea>
					</div>
				</div>

				<div class="modal-action">
					<button type="button" class="btn" onclick={closeModal}>Cancel</button>
					<button type="submit" class="btn btn-primary">
						{editingVendor ? 'Save Changes' : 'Create Vendor'}
					</button>
				</div>
			</form>
		</div>
		<div class="modal-backdrop" onclick={closeModal}></div>
	</div>
{/if}
