<script lang="ts">
	import { page } from '$app/stores';
	import { customersAPI, type Customer } from '$lib/api';

	let customer = $state<Customer | null>(null);
	let loading = $state(true);
	let error = $state('');

	// Edit modal state
	let showEditModal = $state(false);
	let formData = $state({
		firstName: '',
		lastName: '',
		email: '',
		phone: '',
		country: '',
		state: '',
		zipCode: '',
		city: '',
		contactMethod: '',
		comment: ''
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
			customer = await customersAPI.get(id);
		} catch (e) {
			console.error('Error loading customer:', e);
			error = e instanceof Error ? e.message : 'Failed to load customer';
		} finally {
			loading = false;
		}
	}

	function openEditModal() {
		if (!customer) return;
		formData = {
			firstName: customer.firstName,
			lastName: customer.lastName,
			email: customer.email || '',
			phone: customer.phone || '',
			country: customer.country || '',
			state: customer.state || '',
			zipCode: customer.zipCode || '',
			city: customer.city || '',
			contactMethod: customer.contactMethod || '',
			comment: customer.comment || ''
		};
		showEditModal = true;
	}

	function closeEditModal() {
		showEditModal = false;
	}

	async function handleSubmit() {
		if (!customer) return;
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
				contactMethod: formData.contactMethod || undefined,
				comment: formData.comment || undefined
			};
			await customersAPI.update(customer.id, data);
			await loadData(customer.id);
			closeEditModal();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to update customer';
		}
	}
</script>

<div class="max-w-7xl mx-auto">
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
		<a href="/customers" class="btn btn-ghost">Back to Customers</a>
	{:else if customer}
		<!-- Header -->
		<div class="mb-8 flex justify-between items-start">
			<div>
				<div class="text-sm breadcrumbs mb-2">
					<ul>
						<li><a href="/customers">Customers</a></li>
						<li>{customer.firstName} {customer.lastName}</li>
					</ul>
				</div>
				<h1 class="text-4xl font-bold mb-2">{customer.firstName} {customer.lastName}</h1>
			</div>
			<button class="btn btn-primary" onclick={openEditModal}>
				Edit Customer
			</button>
		</div>

		<!-- Customer Details Card -->
		<div class="card bg-base-100 shadow-xl mb-8">
			<div class="card-body">
				<h2 class="card-title mb-4">Customer Details</h2>
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					{#if customer.email}
						<div>
							<span class="font-semibold text-base-content/70">Email</span>
							<p><a href="mailto:{customer.email}" class="link link-primary">{customer.email}</a></p>
						</div>
					{/if}
					{#if customer.phone}
						<div>
							<span class="font-semibold text-base-content/70">Phone</span>
							<p>{customer.phone}</p>
						</div>
					{/if}
					{#if customer.country}
						<div>
							<span class="font-semibold text-base-content/70">Country</span>
							<p>{customer.country}</p>
						</div>
					{/if}
					{#if customer.state}
						<div>
							<span class="font-semibold text-base-content/70">State</span>
							<p>{customer.state}</p>
						</div>
					{/if}
					{#if customer.zipCode}
						<div>
							<span class="font-semibold text-base-content/70">ZIP Code</span>
							<p>{customer.zipCode}</p>
						</div>
					{/if}
					{#if customer.city}
						<div>
							<span class="font-semibold text-base-content/70">City</span>
							<p>{customer.city}</p>
						</div>
					{/if}
					{#if customer.contactMethod}
						<div>
							<span class="font-semibold text-base-content/70">Contact Method</span>
							<p><span class="badge badge-outline">{customer.contactMethod}</span></p>
						</div>
					{/if}
					{#if customer.comment}
						<div class="col-span-full">
							<span class="font-semibold text-base-content/70">Comment</span>
							<p class="whitespace-pre-line">{customer.comment}</p>
						</div>
					{/if}
					{#if !customer.email && !customer.phone && !customer.country && !customer.state && !customer.zipCode && !customer.city && !customer.contactMethod && !customer.comment}
						<p class="text-base-content/50 col-span-full">No additional details provided.</p>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>

<!-- Edit Customer Modal -->
{#if showEditModal}
	<div class="modal modal-open" onclick={(e) => {
		if (e.target === e.currentTarget) closeEditModal();
	}}>
		<div class="modal-box max-w-2xl">
			<h3 class="font-bold text-lg mb-4">Edit Customer</h3>

			<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
				<div class="grid grid-cols-2 gap-4">
					<div class="form-control">
						<label class="label">
							<span class="label-text">First Name</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.firstName}
							required
						/>
					</div>

					<div class="form-control">
						<label class="label">
							<span class="label-text">Last Name</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.lastName}
							required
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
							<span class="label-text">Country (Optional)</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.country}
						/>
					</div>

					<div class="form-control">
						<label class="label">
							<span class="label-text">State (Optional)</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.state}
						/>
					</div>

					<div class="form-control">
						<label class="label">
							<span class="label-text">ZIP Code (Optional)</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.zipCode}
						/>
					</div>

					<div class="form-control">
						<label class="label">
							<span class="label-text">City (Optional)</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.city}
						/>
					</div>

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

					<div class="form-control col-span-2">
						<label class="label">
							<span class="label-text">Comment (Optional)</span>
						</label>
						<textarea
							class="textarea textarea-bordered"
							bind:value={formData.comment}
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
