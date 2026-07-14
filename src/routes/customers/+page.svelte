<script lang="ts">
	import { customersAPI, type Customer } from '$lib/api';

	let customers = $state<Customer[]>([]);
	let loading = $state(true);
	let error = $state('');
	let searchQuery = $state('');
	let uploadingCSV = $state(false);
	let csvUploadResult = $state<{ success: number; failed: number; errors: string[]; message?: string } | null>(null);

	// Modal state
	let showModal = $state(false);
	let editingCustomer = $state<Customer | null>(null);
	let formData = $state({
		firstName: '',
		lastName: '',
		email: '',
		phone: '',
		country: '',
		state: '',
		zipCode: '',
		city: '',
		street: '',
		streetNumber: '',
		contactMethod: '',
		comment: ''
	});

	$effect(() => {
		loadCustomers();
	});

	async function loadCustomers() {
		try {
			loading = true;
			error = '';
			customers = await customersAPI.list();
		} catch (e) {
			console.error('Error loading customers:', e);
			error = e instanceof Error ? e.message : 'Failed to load customers';
		} finally {
			loading = false;
		}
	}

	function openModal() {
		formData = {
			firstName: '',
			lastName: '',
			email: '',
			phone: '',
			country: '',
			state: '',
			zipCode: '',
			city: '',
			street: '',
			streetNumber: '',
			contactMethod: '',
			comment: ''
		};
		editingCustomer = null;
		showModal = true;
	}

	function openEditModal(customer: Customer) {
		formData = {
			firstName: customer.firstName,
			lastName: customer.lastName,
			email: customer.email || '',
			phone: customer.phone || '',
			country: customer.country || '',
			state: customer.state || '',
			zipCode: customer.zipCode || '',
			city: customer.city || '',
			street: customer.street || '',
			streetNumber: customer.streetNumber || '',
			contactMethod: customer.contactMethod || '',
			comment: customer.comment || ''
		};
		editingCustomer = customer;
		showModal = true;
	}

	function closeModal() {
		showModal = false;
		editingCustomer = null;
	}

	async function handleSubmit() {
		try {
			error = '';

			const data = {
				firstName: formData.firstName,
				lastName: formData.lastName,
				email: formData.email || undefined,
				phone: formData.phone || undefined,
				country: formData.country || undefined,
				state: formData.state || undefined,
				zipCode: formData.zipCode || undefined,
				city: formData.city || undefined,
				street: formData.street || undefined,
				streetNumber: formData.streetNumber || undefined,
				contactMethod: formData.contactMethod || undefined,
				comment: formData.comment || undefined
			};

			if (editingCustomer) {
				await customersAPI.update(editingCustomer.id, data);
			} else {
				await customersAPI.create(data);
			}

			await loadCustomers();
			closeModal();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save customer';
		}
	}

	async function handleDelete(id: number) {
		if (!confirm('Are you sure you want to delete this customer?')) {
			return;
		}

		try {
			error = '';
			await customersAPI.delete(id);
			await loadCustomers();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to delete customer';
		}
	}

	async function handleDownloadCSV() {
		try {
			error = '';
			await customersAPI.downloadCSV();
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

			const result = await customersAPI.uploadCSV(file);
			csvUploadResult = result;

			if (result.success > 0) {
				await loadCustomers();
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to upload CSV';
		} finally {
			uploadingCSV = false;
		}
	}

	let filteredCustomers = $derived(
		searchQuery
			? customers.filter(c =>
					c.firstName.toLowerCase().includes(searchQuery.toLowerCase()) ||
					c.lastName.toLowerCase().includes(searchQuery.toLowerCase()) ||
					c.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
					c.phone?.toLowerCase().includes(searchQuery.toLowerCase())
				)
			: customers
	);
</script>

<div class="page-shell">
	<!-- Header -->
	<div class="mb-8">
		<p class="section-label mb-2">Receivables</p>
		<h1 class="page-title">Customers</h1>
		<p class="page-subtitle">Customer relationships and history</p>
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
				placeholder="Search customers..."
				class="input input-bordered w-64"
				bind:value={searchQuery}
			/>
		</div>
		<div class="flex gap-2 flex-wrap">
			<button
				class="btn btn-outline"
				onclick={handleDownloadCSV}
				disabled={customers.length === 0}
				title="Download customers as CSV"
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
				+ New Customer
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
					<p>Successfully imported: {csvUploadResult.success} customers</p>
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

	<!-- Customers List -->
	<div class="card bg-base-100 shadow-xl">
		<div class="card-body">
			{#if loading}
				<div class="flex justify-center py-8">
					<span class="loading loading-spinner loading-lg"></span>
				</div>
			{:else if filteredCustomers.length === 0}
				<div class="alert alert-info">
					<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
					</svg>
					<span>
						{searchQuery
							? 'No customers match your search.'
							: 'No customers yet. Create your first customer to get started.'}
					</span>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="table table-zebra">
						<thead>
							<tr>
								<th>Name</th>
								<th>Email</th>
								<th>Phone</th>
								<th>City</th>
								<th>Country</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each filteredCustomers as customer}
								<tr>
									<td>
										<a href="/customers/{customer.id}" class="link link-primary font-medium">
											{customer.firstName} {customer.lastName}
										</a>
									</td>
									<td>
										{#if customer.email}
											<a href="mailto:{customer.email}" class="link link-hover">{customer.email}</a>
										{:else}
											-
										{/if}
									</td>
									<td>{customer.phone || '-'}</td>
									<td>{customer.city || '-'}</td>
									<td>{customer.country || '-'}</td>
									<td>
										<div class="flex gap-2">
											<a href="/customers/{customer.id}" class="btn btn-sm btn-ghost">
												View
											</a>
											<button class="btn btn-sm btn-ghost" onclick={() => openEditModal(customer)}>
												Edit
											</button>
											<button
												class="btn btn-sm btn-ghost text-error"
												onclick={() => handleDelete(customer.id)}
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

<!-- Customer Modal -->
{#if showModal}
	<div class="modal modal-open" onclick={(e) => {
		if (e.target === e.currentTarget) closeModal();
	}}>
		<div class="modal-box max-w-2xl">
			<h3 class="font-bold text-lg mb-4">
				{editingCustomer ? 'Edit Customer' : 'New Customer'}
			</h3>

			<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
				<div class="grid grid-cols-2 gap-4">
					<!-- First Name -->
					<div class="form-control">
						<label class="label">
							<span class="label-text">First Name</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.firstName}
							required
							placeholder="John"
						/>
					</div>

					<!-- Last Name -->
					<div class="form-control">
						<label class="label">
							<span class="label-text">Last Name</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.lastName}
							required
							placeholder="Doe"
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
							placeholder="john@example.com"
						/>
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

					<!-- Country -->
					<div class="form-control">
						<label class="label">
							<span class="label-text">Country (Optional)</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.country}
							placeholder="United States"
						/>
					</div>

					<!-- State -->
					<div class="form-control">
						<label class="label">
							<span class="label-text">State (Optional)</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.state}
							placeholder="California"
						/>
					</div>

					<!-- ZIP Code -->
					<div class="form-control">
						<label class="label">
							<span class="label-text">ZIP Code (Optional)</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.zipCode}
							placeholder="90210"
						/>
					</div>

					<!-- City -->
					<div class="form-control">
						<label class="label">
							<span class="label-text">City (Optional)</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.city}
							placeholder="Los Angeles"
						/>
					</div>

					<!-- Street -->
					<div class="form-control">
						<label class="label">
							<span class="label-text">Street (Optional)</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.street}
							placeholder="Main Street"
						/>
					</div>

					<!-- Street Number -->
					<div class="form-control">
						<label class="label">
							<span class="label-text">Street Number (Optional)</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.streetNumber}
							placeholder="123A"
						/>
					</div>

					<!-- Contact Method -->
					<div class="form-control col-span-2">
						<label class="label">
							<span class="label-text">Contact Method (Optional)</span>
						</label>
						<select class="select select-bordered" bind:value={formData.contactMethod}>
							<option value="">Select a contact method</option>
							<option value="Email">Email</option>
							<option value="Phone">Phone</option>
							<option value="Mail">Mail</option>
						</select>
					</div>

					<!-- Comment -->
					<div class="form-control col-span-2">
						<label class="label">
							<span class="label-text">Comment (Optional)</span>
						</label>
						<textarea
							class="textarea textarea-bordered"
							bind:value={formData.comment}
							rows="3"
							placeholder="Additional notes about this customer"
						></textarea>
					</div>
				</div>

				<div class="modal-action">
					<button type="button" class="btn" onclick={closeModal}>Cancel</button>
					<button type="submit" class="btn btn-primary">
						{editingCustomer ? 'Save Changes' : 'Create Customer'}
					</button>
				</div>
			</form>
		</div>
		<div class="modal-backdrop" onclick={closeModal}></div>
	</div>
{/if}
