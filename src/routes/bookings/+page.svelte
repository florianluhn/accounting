<script lang="ts">
	import {
		bookingsAPI,
		customersAPI,
		attachmentsAPI,
		type Booking,
		type BookingPlatform,
		type BookingConfig,
		type Customer,
		type Attachment
	} from '$lib/api';

	let bookings = $state<Booking[]>([]);
	let platforms = $state<BookingPlatform[]>([]);
	let customers = $state<Customer[]>([]);
	let config = $state<BookingConfig>({
		cleaningFee: 0,
		salesTaxRate: 0,
		touristTaxRate: 0
	});
	let loading = $state(true);
	let error = $state('');

	let showModal = $state(false);
	let editingBooking = $state<Booking | null>(null);

	// Form state — all $state so edits survive re-renders
	let customerId = $state(0);
	let platformId = $state(0);
	let checkInDate = $state('');
	let checkOutDate = $state('');
	let totalPaid = $state('');
	let cleaningFee = $state('');
	let salesTax = $state('');
	let touristTax = $state('');
	let platformFee = $state('');
	let comment = $state('');

	// Override flags — when true, field keeps user's typed value
	let salesTaxOverride = $state(false);
	let touristTaxOverride = $state(false);
	let cleaningFeeOverride = $state(false);
	let platformFeeOverride = $state(false);

	// Attachments for the currently edited booking
	let existingAttachments = $state<Attachment[]>([]);
	let selectedFiles = $state<File[]>([]);
	let uploadingFiles = $state(false);

	$effect(() => {
		loadAll();
	});

	async function loadAll() {
		try {
			loading = true;
			error = '';
			const [b, p, c, cfg] = await Promise.all([
				bookingsAPI.list(),
				bookingsAPI.listPlatforms(),
				customersAPI.list(),
				bookingsAPI.getConfig()
			]);
			bookings = b;
			platforms = p;
			customers = c.sort((a, b) => a.lastName.localeCompare(b.lastName));
			config = cfg;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load bookings';
		} finally {
			loading = false;
		}
	}

	// Calculations — reactive derivations from inputs
	let nights = $derived.by(() => {
		if (!checkInDate || !checkOutDate) return 0;
		const inD = new Date(checkInDate);
		const outD = new Date(checkOutDate);
		const ms = outD.getTime() - inD.getTime();
		if (isNaN(ms) || ms <= 0) return 0;
		return Math.round(ms / (1000 * 60 * 60 * 24));
	});

	// Currently-selected platform (drives fee rate + whether taxes are withheld)
	let selectedPlatform = $derived(platforms.find((p) => p.id === platformId));
	let platformWithholdsTaxes = $derived(selectedPlatform?.withholdsTaxes ?? false);
	let platformFeeRate = $derived(selectedPlatform?.platformFeeRate ?? 0);

	// Base used to derive default sales/tourist tax: totalPaid / (1 + sr + tr)
	// When platform withholds taxes, no taxes are extracted — taxable amount equals totalPaid.
	let computedTaxBase = $derived.by(() => {
		const tp = parseFloat(totalPaid) || 0;
		if (platformWithholdsTaxes) return tp;
		const sr = (config.salesTaxRate || 0) / 100;
		const tr = (config.touristTaxRate || 0) / 100;
		const denom = 1 + sr + tr;
		if (denom === 0) return 0;
		return tp / denom;
	});

	let computedSalesTax = $derived(
		platformWithholdsTaxes ? 0 : computedTaxBase * ((config.salesTaxRate || 0) / 100)
	);
	let computedTouristTax = $derived(
		platformWithholdsTaxes ? 0 : computedTaxBase * ((config.touristTaxRate || 0) / 100)
	);

	// Taxable amount (read-only): totalPaid minus the actual sales+tourist tax shown
	let taxableAmount = $derived(
		(parseFloat(totalPaid) || 0) - (parseFloat(salesTax) || 0) - (parseFloat(touristTax) || 0)
	);

	// Platform fee derives from the taxable amount, using the platform's own fee rate
	let computedPlatformFee = $derived(taxableAmount * (platformFeeRate / 100));

	// Rental fee (read-only): totalPaid minus all fees
	let rentalFee = $derived(
		(parseFloat(totalPaid) || 0)
			- (parseFloat(cleaningFee) || 0)
			- (parseFloat(salesTax) || 0)
			- (parseFloat(touristTax) || 0)
			- (parseFloat(platformFee) || 0)
	);

	let pricePerNight = $derived(nights > 0 ? rentalFee / nights : 0);

	// Sync computed values into displayed inputs when not overridden.
	// When the selected platform withholds taxes, force tax fields to 0 regardless of overrides.
	$effect(() => {
		if (platformWithholdsTaxes) {
			salesTax = '0.00';
		} else if (!salesTaxOverride) {
			salesTax = computedSalesTax.toFixed(2);
		}
	});
	$effect(() => {
		if (platformWithholdsTaxes) {
			touristTax = '0.00';
		} else if (!touristTaxOverride) {
			touristTax = computedTouristTax.toFixed(2);
		}
	});
	$effect(() => {
		if (!cleaningFeeOverride) cleaningFee = (config.cleaningFee || 0).toFixed(2);
	});
	$effect(() => {
		if (!platformFeeOverride) platformFee = computedPlatformFee.toFixed(2);
	});

	function resetForm() {
		customerId = 0;
		platformId = platforms[0]?.id || 0;
		const today = new Date().toISOString().split('T')[0];
		checkInDate = today;
		checkOutDate = today;
		totalPaid = '';
		comment = '';
		salesTaxOverride = false;
		touristTaxOverride = false;
		cleaningFeeOverride = false;
		platformFeeOverride = false;
		existingAttachments = [];
		selectedFiles = [];
	}

	function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		if (input.files) {
			selectedFiles = [...selectedFiles, ...Array.from(input.files)];
			input.value = '';
		}
	}

	function removeFile(index: number) {
		selectedFiles = selectedFiles.filter((_, i) => i !== index);
	}

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return bytes + ' B';
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
		return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
	}

	async function loadAttachments(bookingId: number) {
		try {
			existingAttachments = await attachmentsAPI.list({ bookingId });
		} catch {
			existingAttachments = [];
		}
	}

	async function handleDeleteAttachment(attachmentId: number) {
		if (!confirm('Delete this attachment?')) return;
		try {
			await attachmentsAPI.delete(attachmentId);
			if (editingBooking) await loadAttachments(editingBooking.id);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to delete attachment';
		}
	}

	function openCreate() {
		if (customers.length === 0) {
			error = 'Please create at least one customer before adding a booking.';
			return;
		}
		if (platforms.length === 0) {
			error = 'Please configure at least one booking platform in Settings.';
			return;
		}
		editingBooking = null;
		resetForm();
		showModal = true;
	}

	function openEdit(b: Booking) {
		editingBooking = b;
		customerId = b.customerId;
		platformId = b.platformId;
		checkInDate = b.checkInDate;
		checkOutDate = b.checkOutDate;
		totalPaid = b.totalPaid.toFixed(2);
		cleaningFee = b.cleaningFee.toFixed(2);
		salesTax = b.salesTax.toFixed(2);
		touristTax = b.touristTax.toFixed(2);
		platformFee = b.platformFee.toFixed(2);
		comment = b.comment || '';
		// Treat stored values as overrides so editing doesn't clobber saved numbers
		salesTaxOverride = true;
		touristTaxOverride = true;
		cleaningFeeOverride = true;
		platformFeeOverride = true;
		selectedFiles = [];
		existingAttachments = [];
		loadAttachments(b.id);
		showModal = true;
	}

	function closeModal() {
		showModal = false;
		editingBooking = null;
	}

	async function handleSubmit() {
		try {
			error = '';
			if (!customerId) { error = 'Please select a customer'; return; }
			if (!platformId) { error = 'Please select a platform'; return; }
			if (!checkInDate || !checkOutDate) { error = 'Check-in and check-out dates are required'; return; }

			const payload = {
				customerId,
				platformId,
				checkInDate,
				checkOutDate,
				nights,
				totalPaid: parseFloat(totalPaid) || 0,
				netAmount: taxableAmount,
				cleaningFee: parseFloat(cleaningFee) || 0,
				salesTax: parseFloat(salesTax) || 0,
				touristTax: parseFloat(touristTax) || 0,
				platformFee: parseFloat(platformFee) || 0,
				rentalFee,
				comment: comment || null
			};

			let bookingId: number;
			if (editingBooking) {
				const updated = await bookingsAPI.update(editingBooking.id, payload);
				bookingId = updated.id;
			} else {
				const created = await bookingsAPI.create(payload);
				bookingId = created.id;
			}

			// Upload any newly selected files to this booking
			if (selectedFiles.length > 0) {
				uploadingFiles = true;
				try {
					await Promise.all(
						selectedFiles.map((file) => attachmentsAPI.uploadToBooking(bookingId, file))
					);
				} catch (uploadError) {
					error = uploadError instanceof Error ? uploadError.message : 'Failed to upload attachments';
					return;
				} finally {
					uploadingFiles = false;
				}
			}

			closeModal();
			await loadAll();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save booking';
		}
	}

	async function handleDelete(id: number) {
		if (!confirm('Delete this booking?')) return;
		try {
			await bookingsAPI.delete(id);
			await loadAll();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to delete booking';
		}
	}

	function formatMoney(v: number): string {
		return `$${v.toFixed(2)}`;
	}

	function formatDate(d: string): string {
		if (!d) return '';
		const parts = d.split('-');
		if (parts.length !== 3) return d;
		return `${parts[1]}/${parts[2]}/${parts[0]}`;
	}

	function customerLabel(b: Booking): string {
		if (b.customerLastName && b.customerFirstName) return `${b.customerLastName}, ${b.customerFirstName}`;
		return `Customer #${b.customerId}`;
	}
</script>

<div class="max-w-7xl mx-auto">
	<div class="mb-8">
		<h1 class="text-4xl font-bold mb-2">Bookings</h1>
		<p class="text-base-content/70">Manage overnight bookings</p>
	</div>

	{#if error}
		<div class="alert alert-error mb-6">
			<span>{error}</span>
		</div>
	{/if}

	<div class="mb-6 flex justify-end">
		<button class="btn btn-primary" onclick={openCreate}>+ New Booking</button>
	</div>

	<div class="card bg-base-100 shadow-xl">
		<div class="card-body">
			{#if loading}
				<div class="flex justify-center py-8">
					<span class="loading loading-spinner loading-lg"></span>
				</div>
			{:else if bookings.length === 0}
				<div class="alert alert-info">
					<span>No bookings yet. Create your first one to get started.</span>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="table table-zebra">
						<thead>
							<tr>
								<th>Customer</th>
								<th>Platform</th>
								<th>Check-in</th>
								<th>Check-out</th>
								<th>Nights</th>
								<th>Total Paid</th>
								<th>Taxable</th>
								<th>Rental Fee</th>
								<th>Price/Night</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each bookings as b (b.id)}
								<tr>
									<td>{customerLabel(b)}</td>
									<td>{b.platformName || `#${b.platformId}`}</td>
									<td>{formatDate(b.checkInDate)}</td>
									<td>{formatDate(b.checkOutDate)}</td>
									<td>{b.nights}</td>
									<td class="font-mono">{formatMoney(b.totalPaid)}</td>
									<td class="font-mono">{formatMoney(b.netAmount)}</td>
									<td class="font-mono">{formatMoney(b.rentalFee)}</td>
									<td class="font-mono">{b.nights > 0 ? formatMoney(b.rentalFee / b.nights) : '-'}</td>
									<td>
										<div class="flex gap-2">
											<button class="btn btn-sm btn-ghost" onclick={() => openEdit(b)}>Edit</button>
											<button class="btn btn-sm btn-ghost text-error" onclick={() => handleDelete(b.id)}>Delete</button>
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

{#if showModal}
<div class="modal modal-open">
	<div class="modal-box max-w-3xl">
		<h3 class="font-bold text-lg mb-4">{editingBooking ? 'Edit Booking' : 'New Booking'}</h3>

		<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
			<div class="grid grid-cols-2 gap-4">
				<div class="form-control col-span-2">
					<label class="label"><span class="label-text">Customer</span></label>
					<select class="select select-bordered" bind:value={customerId} required>
						<option value={0}>Select customer...</option>
						{#each customers as c}
							<option value={c.id}>{c.lastName}, {c.firstName}</option>
						{/each}
					</select>
				</div>

				<div class="form-control col-span-2">
					<label class="label"><span class="label-text">Booking Platform</span></label>
					<select class="select select-bordered" bind:value={platformId} required>
						<option value={0}>Select platform...</option>
						{#each platforms as p}
							<option value={p.id}>{p.name}</option>
						{/each}
					</select>
				</div>

				<div class="form-control">
					<label class="label"><span class="label-text">Check-in Date</span></label>
					<input type="date" class="input input-bordered" bind:value={checkInDate} required />
				</div>
				<div class="form-control">
					<label class="label"><span class="label-text">Check-out Date</span></label>
					<input type="date" class="input input-bordered" bind:value={checkOutDate} required />
				</div>

				<div class="form-control">
					<label class="label"><span class="label-text">Nights (auto)</span></label>
					<input type="number" class="input input-bordered" value={nights} disabled />
				</div>
				<div class="form-control">
					<label class="label"><span class="label-text">Total Paid by Customer</span></label>
					<input type="number" step="0.01" min="0" class="input input-bordered" bind:value={totalPaid} placeholder="0.00" />
				</div>

				<div class="form-control">
					<label class="label">
						<span class="label-text">Taxable Amount (auto)</span>
					</label>
					<input type="text" class="input input-bordered bg-base-200" value={taxableAmount.toFixed(2)} disabled readonly />
				</div>
				<div class="form-control">
					<label class="label">
						<span class="label-text">Cleaning Fee {cleaningFeeOverride ? '(overridden)' : '(default)'}</span>
						{#if cleaningFeeOverride}
							<button type="button" class="label-text-alt link" onclick={() => { cleaningFeeOverride = false; }}>Reset</button>
						{/if}
					</label>
					<input type="number" step="0.01" class="input input-bordered" bind:value={cleaningFee} oninput={() => { cleaningFeeOverride = true; }} />
				</div>

				<div class="form-control">
					<label class="label">
						<span class="label-text">
							Sales Tax
							{#if platformWithholdsTaxes}(withheld by platform){:else}{salesTaxOverride ? '(overridden)' : '(auto)'}{/if}
						</span>
						{#if salesTaxOverride && !platformWithholdsTaxes}
							<button type="button" class="label-text-alt link" onclick={() => { salesTaxOverride = false; }}>Reset</button>
						{/if}
					</label>
					<input type="number" step="0.01" class="input input-bordered {platformWithholdsTaxes ? 'bg-base-200' : ''}" bind:value={salesTax} oninput={() => { salesTaxOverride = true; }} disabled={platformWithholdsTaxes} />
				</div>
				<div class="form-control">
					<label class="label">
						<span class="label-text">
							Tourist Tax
							{#if platformWithholdsTaxes}(withheld by platform){:else}{touristTaxOverride ? '(overridden)' : '(auto)'}{/if}
						</span>
						{#if touristTaxOverride && !platformWithholdsTaxes}
							<button type="button" class="label-text-alt link" onclick={() => { touristTaxOverride = false; }}>Reset</button>
						{/if}
					</label>
					<input type="number" step="0.01" class="input input-bordered {platformWithholdsTaxes ? 'bg-base-200' : ''}" bind:value={touristTax} oninput={() => { touristTaxOverride = true; }} disabled={platformWithholdsTaxes} />
				</div>

				<div class="form-control">
					<label class="label">
						<span class="label-text">Booking Platform Fee {platformFeeOverride ? '(overridden)' : '(auto)'}</span>
						{#if platformFeeOverride}
							<button type="button" class="label-text-alt link" onclick={() => { platformFeeOverride = false; }}>Reset</button>
						{/if}
					</label>
					<input type="number" step="0.01" class="input input-bordered" bind:value={platformFee} oninput={() => { platformFeeOverride = true; }} />
				</div>
				<div class="form-control">
					<label class="label">
						<span class="label-text">Rental Fee (auto)</span>
					</label>
					<input type="text" class="input input-bordered bg-base-200" value={rentalFee.toFixed(2)} disabled readonly />
				</div>

				<div class="form-control col-span-2">
					<label class="label"><span class="label-text">Comment</span></label>
					<textarea class="textarea textarea-bordered" rows="2" bind:value={comment}></textarea>
				</div>

				<div class="form-control col-span-2">
					<label class="label">
						<span class="label-text">Attachments (rental contracts, receipts, etc.)</span>
					</label>
					<input
						type="file"
						class="file-input file-input-bordered w-full"
						multiple
						onchange={handleFileSelect}
					/>
					<label class="label">
						<span class="label-text-alt">Upload documents (max 10MB per file)</span>
					</label>

					{#if existingAttachments.length > 0}
						<div class="mt-2 space-y-2">
							<div class="text-sm font-semibold">Existing:</div>
							{#each existingAttachments as att (att.id)}
								<div class="flex items-center justify-between bg-base-200 p-2 rounded">
									<div class="flex items-center gap-2 min-w-0">
										<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
										</svg>
										<a
											href={attachmentsAPI.getDownloadUrl(att.id)}
											target="_blank"
											rel="noopener"
											class="text-sm link link-primary truncate"
										>
											{att.filename}
										</a>
										<span class="text-xs text-base-content/60 flex-shrink-0">({formatFileSize(att.fileSize)})</span>
									</div>
									<button
										type="button"
										class="btn btn-ghost btn-sm btn-circle text-error"
										onclick={() => handleDeleteAttachment(att.id)}
										aria-label="Delete attachment"
									>
										<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
										</svg>
									</button>
								</div>
							{/each}
						</div>
					{/if}

					{#if selectedFiles.length > 0}
						<div class="mt-2 space-y-2">
							<div class="text-sm font-semibold">To upload:</div>
							{#each selectedFiles as file, index}
								<div class="flex items-center justify-between bg-base-200 p-2 rounded">
									<div class="flex items-center gap-2 min-w-0">
										<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
										</svg>
										<span class="text-sm truncate">{file.name}</span>
										<span class="text-xs text-base-content/60 flex-shrink-0">({formatFileSize(file.size)})</span>
									</div>
									<button
										type="button"
										class="btn btn-ghost btn-sm btn-circle"
										onclick={() => removeFile(index)}
										aria-label="Remove file"
									>
										<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
										</svg>
									</button>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			<div class="modal-action">
				<button type="button" class="btn" onclick={closeModal}>Cancel</button>
				<button type="submit" class="btn btn-primary" disabled={uploadingFiles}>
					{#if uploadingFiles}
						<span class="loading loading-spinner loading-sm"></span>
						Uploading...
					{:else}
						{editingBooking ? 'Save Changes' : 'Create Booking'}
					{/if}
				</button>
			</div>
		</form>
	</div>
	<div class="modal-backdrop" onclick={closeModal}></div>
</div>
{/if}
