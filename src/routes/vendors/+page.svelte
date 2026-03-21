<script lang="ts">
	import { vendorsAPI, type Vendor } from '$lib/api';

	let vendors = $state<Vendor[]>([]);
	let loading = $state(true);
	let error = $state('');
	let searchQuery = $state('');

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
		<button class="btn btn-primary" onclick={openModal}>
			+ New Vendor
		</button>
	</div>

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
