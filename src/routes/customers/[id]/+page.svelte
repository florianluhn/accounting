<script lang="ts">
	import { page } from '$app/stores';
	import { customersAPI, type Customer, type CustomerPurchase, type CustomerBooking } from '$lib/api';
	import { modules } from '$lib/modules.svelte';

	let customer = $state<Customer | null>(null);
	let purchases = $state<CustomerPurchase[]>([]);
	let bookings = $state<CustomerBooking[]>([]);
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
		street: '',
		streetNumber: '',
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
			const [cust, purch, books] = await Promise.all([
				customersAPI.get(id),
				customersAPI.getPurchases(id),
				customersAPI.getBookings(id).catch(() => [])
			]);
			customer = cust;
			purchases = purch;
			bookings = books;
		} catch (e) {
			console.error('Error loading customer:', e);
			error = e instanceof Error ? e.message : 'Failed to load customer';
		} finally {
			loading = false;
		}
	}

	function formatDateString(d: string): string {
		if (!d) return '';
		const parts = d.split('-');
		if (parts.length !== 3) return d;
		return `${parts[1]}/${parts[2]}/${parts[0]}`;
	}

	function isPL(type?: string | null): boolean {
		return type === 'Profit' || type === 'Loss';
	}

	let totalRevenue = $derived(
		purchases.reduce((sum, p) => {
			let delta = 0;
			if (isPL(p.creditAccountType)) delta += p.amount;
			if (isPL(p.debitAccountType)) delta -= p.amount;
			return sum + delta;
		}, 0)
	);

	function formatDate(d: Date | string): string {
		const date = new Date(d);
		return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
	}

	function formatCurrency(amount: number, code: string = 'USD'): string {
		return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(amount);
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
			street: customer.street || '',
			streetNumber: customer.streetNumber || '',
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
				street: formData.street || undefined,
				streetNumber: formData.streetNumber || undefined,
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
				<h1 class="page-title">{customer.firstName} {customer.lastName}</h1>
			</div>
			<button class="btn btn-primary" onclick={openEditModal}>
				Edit Customer
			</button>
		</div>

		<!-- Stats row -->
		{#if purchases.length > 0}
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
				<div class="stat bg-base-100 shadow rounded-box">
					<div class="stat-title">Transactions</div>
					<div class="stat-value">{purchases.length}</div>
				</div>
				<div class="stat bg-base-100 shadow rounded-box">
					<div class="stat-title">Total Revenue</div>
					<div class="stat-value text-primary text-2xl">{formatCurrency(totalRevenue)}</div>
					<div class="stat-desc">Net P/L postings</div>
				</div>
			</div>
		{/if}

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
					{#if customer.street}
						<div>
							<span class="font-semibold text-base-content/70">Street</span>
							<p>{customer.street}</p>
						</div>
					{/if}
					{#if customer.streetNumber}
						<div>
							<span class="font-semibold text-base-content/70">Street Number</span>
							<p>{customer.streetNumber}</p>
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
					{#if !customer.email && !customer.phone && !customer.country && !customer.state && !customer.zipCode && !customer.city && !customer.street && !customer.streetNumber && !customer.contactMethod && !customer.comment}
						<p class="text-base-content/50 col-span-full">No additional details provided.</p>
					{/if}
				</div>
			</div>
		</div>

		<!-- Bookings -->
		{#if modules.bookings && bookings.length > 0}
			<div class="card bg-base-100 shadow-xl mb-8">
				<div class="card-body">
					<div class="flex items-center justify-between mb-4">
						<h2 class="card-title">Bookings <span class="badge badge-neutral">{bookings.length}</span></h2>
						<a href="/bookings" class="link link-hover text-sm">All bookings →</a>
					</div>
					<div class="overflow-x-auto">
						<table class="table table-zebra">
							<thead>
								<tr>
									<th>Check-in</th>
									<th>Check-out</th>
									<th>Nights</th>
									<th>Platform</th>
									<th class="text-right">Total Paid</th>
									<th class="text-right">Net</th>
									<th class="text-right">Rental Fee</th>
								</tr>
							</thead>
							<tbody>
								{#each bookings as b (b.id)}
									<tr>
										<td>{formatDateString(b.checkInDate)}</td>
										<td>{formatDateString(b.checkOutDate)}</td>
										<td>{b.nights}</td>
										<td>{b.platformName || `#${b.platformId}`}</td>
										<td class="text-right font-mono">{formatCurrency(b.totalPaid)}</td>
										<td class="text-right font-mono">{formatCurrency(b.netAmount)}</td>
										<td class="text-right font-mono">{formatCurrency(b.rentalFee)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		{/if}

		<!-- Purchases -->
		{#if purchases.length > 0}
			<div class="card bg-base-100 shadow-xl mb-8">
				<div class="card-body">
					<h2 class="card-title mb-4">Purchases <span class="badge badge-neutral">{purchases.length}</span></h2>
					<div class="overflow-x-auto">
						<table class="table table-zebra">
							<thead>
								<tr>
									<th>Date</th>
									<th>Description</th>
									<th>Item</th>
									<th>Type</th>
									<th class="text-right">Amount</th>
									<th>Journal</th>
								</tr>
							</thead>
							<tbody>
								{#each purchases as p}
									<tr>
										<td>{formatDate(p.entryDate)}</td>
										<td>{p.description}</td>
										<td>
											{#if p.inventoryItemId && p.inventoryItemName}
												<span class="font-medium">{p.inventoryItemName}</span>
											{:else}
												<span class="text-base-content/40">—</span>
											{/if}
										</td>
										<td>
											{#if p.inventoryLinkType}
												<span class="badge badge-sm {p.inventoryLinkType === 'sale' ? 'badge-success' : 'badge-warning'}">
													{p.inventoryLinkType === 'sale' ? 'Sale' : 'Own Use'}
												</span>
											{/if}
										</td>
										<td class="text-right font-mono font-bold">{formatCurrency(p.amount, p.currencyCode)}</td>
										<td>
											<a href="/journals" class="link link-hover text-xs">#{p.journalEntryId}</a>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		{/if}
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

					<div class="form-control">
						<label class="label">
							<span class="label-text">Street (Optional)</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.street}
						/>
					</div>

					<div class="form-control">
						<label class="label">
							<span class="label-text">Street Number (Optional)</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.streetNumber}
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
