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
	let searchQuery = $state('');

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

	let fileInput: HTMLInputElement;
	let uploadingCsv = $state(false);
	let csvResults = $state<any>(null);

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

	function resetForm(defaultDate?: string) {
		customerId = 0;
		platformId = platforms[0]?.id || 0;
		const today = new Date().toISOString().split('T')[0];
		checkInDate = defaultDate || today;
		checkOutDate = defaultDate || today;
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

	async function handleUploadCSV(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;

		uploadingCsv = true;
		error = '';
		csvResults = null;

		try {
			csvResults = await bookingsAPI.uploadCSV(file);
			await loadAll();
		} catch (err: any) {
			try {
				csvResults = JSON.parse(err.message);
			} catch {
				error = err.message || 'Failed to import CSV';
			}
		} finally {
			uploadingCsv = false;
			if (fileInput) fileInput.value = '';
		}
	}

	function openCreate(e?: string | Event) {
		if (customers.length === 0) {
			error = 'Please create at least one customer before adding a booking.';
			return;
		}
		if (platforms.length === 0) {
			error = 'Please configure at least one booking platform in Settings.';
			return;
		}
		editingBooking = null;
		resetForm(typeof e === 'string' ? e : undefined);
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

	let syncing = $state(false);
	let syncMessage = $state('');
	let syncSuccess = $state(false);

	async function syncToWebsite() {
		if (!confirm('Overwrite the website availability file with the current bookings?')) return;
		try {
			syncing = true;
			syncMessage = '';
			const result = await bookingsAPI.syncAvailability();
			syncSuccess = true;
			syncMessage = `Synced ${result.count} booking(s) to ${result.path}`;
		} catch (e) {
			syncSuccess = false;
			syncMessage = e instanceof Error ? e.message : 'Sync failed';
		} finally {
			syncing = false;
		}
	}

	// ===== Year stats =====
	let statsYear = $state(new Date().getFullYear());

	let availableYears = $derived.by(() => {
		const years = new Set<number>();
		const cy = new Date().getFullYear();
		years.add(cy);
		for (const b of bookings) {
			const inY = parseInt(b.checkInDate.slice(0, 4));
			const outY = parseInt(b.checkOutDate.slice(0, 4));
			if (!isNaN(inY)) years.add(inY);
			if (!isNaN(outY)) years.add(outY);
		}
		return Array.from(years).sort((a, b) => b - a);
	});

	function isLeapYear(y: number): boolean {
		return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
	}

	function daysInYear(y: number): number {
		return isLeapYear(y) ? 366 : 365;
	}

	// Number of nights of a booking that fall inside the given year.
	// A "night" is keyed by its check-in date (so a booking spanning dec 31 -> jan 2 has
	// one night in the old year and one in the new year).
	function nightsInYear(checkIn: string, checkOut: string, year: number): number {
		if (!checkIn || !checkOut) return 0;
		const inMs = Date.parse(checkIn);
		const outMs = Date.parse(checkOut);
		if (isNaN(inMs) || isNaN(outMs) || outMs <= inMs) return 0;
		const yearStart = Date.parse(`${year}-01-01`);
		const yearEnd = Date.parse(`${year + 1}-01-01`);
		const start = Math.max(inMs, yearStart);
		const end = Math.min(outMs, yearEnd);
		if (end <= start) return 0;
		return Math.round((end - start) / (1000 * 60 * 60 * 24));
	}

	function dateStrUTC(ms: number): string {
		const d = new Date(ms);
		return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
	}

	function todayStr(): string {
		const t = new Date();
		return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
	}

	function isBookingActiveToday(b: Booking): boolean {
		const today = todayStr();
		return b.checkInDate <= today && b.checkOutDate > today;
	}

	let filteredBookings = $derived.by(() => {
		if (!searchQuery.trim()) return bookings;
		const query = searchQuery.toLowerCase();
		return bookings.filter(b => 
			customerLabel(b).toLowerCase().includes(query) ||
			(b.platformName || '').toLowerCase().includes(query) ||
			(b.comment || '').toLowerCase().includes(query)
		);
	});

	type DayCell =
		| { date: string; kind: 'booked'; platformId: number; bookingId: number; customer: string; platformName: string }
		| { date: string; kind: 'past' }
		| { date: string; kind: 'future' };

	let yearData = $derived.by(() => {
		const total = daysInYear(statsYear);
		const today = todayStr();
		const yearStartMs = Date.UTC(statsYear, 0, 1);
		const yearEndMs = Date.UTC(statsYear + 1, 0, 1);

		// Map every booked date in the year to its booking
		const bookedMap = new Map<string, Booking>();
		for (const b of bookings) {
			const inMs = Date.parse(b.checkInDate);
			const outMs = Date.parse(b.checkOutDate);
			if (isNaN(inMs) || isNaN(outMs) || outMs <= inMs) continue;
			const start = Math.max(inMs, yearStartMs);
			const end = Math.min(outMs, yearEndMs);
			for (let t = start; t < end; t += 86400000) {
				bookedMap.set(dateStrUTC(t), b);
			}
		}

		let booked = 0;
		let unbookedPast = 0;
		let unbookedFuture = 0;
		let rentalTotal = 0;
		const months: { month: number; firstWeekday: number; days: DayCell[] }[] = [];
		for (let m = 0; m < 12; m++) {
			const dim = new Date(Date.UTC(statsYear, m + 1, 0)).getUTCDate();
			const firstWeekday = new Date(Date.UTC(statsYear, m, 1)).getUTCDay();
			const days: DayCell[] = [];
			for (let d = 1; d <= dim; d++) {
				const dateStr = `${statsYear}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
				const b = bookedMap.get(dateStr);
				if (b) {
					booked++;
					days.push({
						date: dateStr,
						kind: 'booked',
						platformId: b.platformId,
						bookingId: b.id,
						customer: customerLabel(b),
						platformName: b.platformName || `#${b.platformId}`
					});
				} else if (dateStr < today) {
					unbookedPast++;
					days.push({ date: dateStr, kind: 'past' });
				} else {
					unbookedFuture++;
					days.push({ date: dateStr, kind: 'future' });
				}
			}
			months.push({ month: m, firstWeekday, days });
		}

		// Rental fee + per-platform aggregates — pro-rate per night-in-year
		const perPlatform = new Map<number, { nights: number; rentalTotal: number }>();
		for (const b of bookings) {
			const n = nightsInYear(b.checkInDate, b.checkOutDate, statsYear);
			if (n === 0) continue;
			const fee = b.nights > 0 ? (b.rentalFee / b.nights) * n : 0;
			rentalTotal += fee;
			const cur = perPlatform.get(b.platformId) || { nights: 0, rentalTotal: 0 };
			cur.nights += n;
			cur.rentalTotal += fee;
			perPlatform.set(b.platformId, cur);
		}
		const platformStats = Array.from(perPlatform.entries())
			.map(([platformId, agg]) => ({
				platformId,
				platformName: platforms.find((p) => p.id === platformId)?.name || `#${platformId}`,
				nights: agg.nights,
				rentalTotal: agg.rentalTotal,
				avgPricePerNight: agg.nights > 0 ? agg.rentalTotal / agg.nights : 0
			}))
			.sort((a, b) => b.nights - a.nights);

		const utilization = total > 0 ? (booked / total) * 100 : 0;
		const avgPricePerNight = booked > 0 ? rentalTotal / booked : 0;
		return {
			total,
			booked,
			unbookedPast,
			unbookedFuture,
			utilization,
			rentalTotal,
			avgPricePerNight,
			months,
			platformStats
		};
	});

	const PLATFORM_PALETTE = [
		'#e74c3c',
		'#3498db',
		'#9b59b6',
		'#f39c12',
		'#1abc9c',
		'#e67e22',
		'#34495e',
		'#d35400',
		'#16a085',
		'#8e44ad'
	];

	let platformColors = $derived.by(() => {
		const m = new Map<number, string>();
		platforms.forEach((p, idx) => {
			m.set(p.id, PLATFORM_PALETTE[idx % PLATFORM_PALETTE.length]);
		});
		return m;
	});

	const UNBOOKED_FUTURE_COLOR = '#22c55e';
	const UNBOOKED_PAST_COLOR = '#9ca3af';

	function dayColor(day: DayCell): string {
		if (day.kind === 'booked') return platformColors.get(day.platformId) || '#64748b';
		return day.kind === 'past' ? UNBOOKED_PAST_COLOR : UNBOOKED_FUTURE_COLOR;
	}

	function dayTitle(day: DayCell): string {
		if (day.kind === 'booked') return `${day.date} — ${day.customer} (${day.platformName})`;
		return `${day.date} — ${day.kind === 'past' ? 'Unbooked (past)' : 'Available'}`;
	}

	const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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

	{#if csvResults}
		<div class="alert {csvResults.failed > 0 ? 'alert-error' : 'alert-success'} mb-6 items-start">
			<div class="flex-1">
				<h3 class="font-bold">CSV Import Results</h3>
				<p>Successfully imported: {csvResults.success}</p>
				{#if csvResults.failed > 0}
					<p class="font-bold mt-2">Failed rows: {csvResults.failed}</p>
					<ul class="list-disc list-inside mt-2 text-sm max-h-40 overflow-y-auto bg-base-200 p-2 rounded text-base-content">
						{#each csvResults.errors as err}
							<li>{err}</li>
						{/each}
					</ul>
				{/if}
			</div>
			<button class="btn btn-ghost btn-sm" onclick={() => csvResults = null}>Dismiss</button>
		</div>
	{/if}

	<div class="mb-6 flex flex-wrap justify-end gap-2">
		<button class="btn btn-outline" onclick={() => bookingsAPI.downloadCSV()}>
			<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
			Download CSV
		</button>

		<input type="file" accept=".csv" class="hidden" bind:this={fileInput} onchange={handleUploadCSV} />
		<button class="btn btn-outline" onclick={() => fileInput.click()} disabled={uploadingCsv}>
			{#if uploadingCsv}
				<span class="loading loading-spinner loading-xs"></span>
			{:else}
				<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
			{/if}
			Upload CSV
		</button>

		<button class="btn btn-outline" onclick={syncToWebsite} disabled={syncing}>
			{#if syncing}
				<span class="loading loading-spinner loading-xs"></span>
				Syncing...
			{:else}
				Sync to Website
			{/if}
		</button>
		<button class="btn btn-primary" onclick={openCreate}>+ New Booking</button>
	</div>

	{#if syncMessage}
		<div class="alert {syncSuccess ? 'alert-success' : 'alert-error'} mb-6">
			<span>{syncMessage}</span>
			<button class="btn btn-ghost btn-xs" onclick={() => { syncMessage = ''; }}>Dismiss</button>
		</div>
	{/if}

	{#if !loading && bookings.length > 0}
		<div class="card bg-base-100 shadow-xl mb-6">
			<div class="card-body">
				<div class="flex flex-wrap items-center justify-between gap-3 mb-4">
					<h2 class="card-title">Year Statistics</h2>
					<div class="form-control">
						<select class="select select-bordered select-sm" bind:value={statsYear}>
							{#each availableYears as y}
								<option value={y}>{y}</option>
							{/each}
						</select>
					</div>
				</div>
				<div class="stats stats-vertical lg:stats-horizontal shadow w-full mb-6">
					<div class="stat">
						<div class="stat-title">Utilization</div>
						<div class="stat-value text-primary">{yearData.utilization.toFixed(1)}%</div>
						<div class="stat-desc">{yearData.booked} of {yearData.total} nights booked</div>
					</div>
					<div class="stat">
						<div class="stat-title">Nights Available</div>
						<div class="stat-value text-success">{yearData.unbookedFuture}</div>
						<div class="stat-desc">Unbooked future nights</div>
					</div>
					<div class="stat">
						<div class="stat-title">Unbooked Nights in the Past</div>
						<div class="stat-value text-base-content/60">{yearData.unbookedPast}</div>
						<div class="stat-desc">Unbooked nights already elapsed</div>
					</div>
					<div class="stat">
						<div class="stat-title">Total Rental Fee</div>
						<div class="stat-value text-success">{formatMoney(yearData.rentalTotal)}</div>
						<div class="stat-desc">Sum of rental fees for {statsYear}</div>
					</div>
					<div class="stat">
						<div class="stat-title">Avg Price / Night</div>
						<div class="stat-value">{formatMoney(yearData.avgPricePerNight)}</div>
						<div class="stat-desc">Rental fee per booked night</div>
					</div>
				</div>

				<!-- Per-platform breakdown -->
				{#if yearData.platformStats.length > 0}
					<div class="mb-6">
						<h3 class="font-semibold text-sm mb-2 text-base-content/70">By Platform</h3>
						<div class="overflow-x-auto">
							<table class="table table-sm">
								<thead>
									<tr>
										<th>Platform</th>
										<th class="text-right">Nights Booked</th>
										<th class="text-right">Rental Fee</th>
										<th class="text-right">Avg Price / Night</th>
									</tr>
								</thead>
								<tbody>
									{#each yearData.platformStats as ps (ps.platformId)}
										<tr>
											<td>
												<span class="inline-flex items-center gap-2">
													<span class="inline-block w-3 h-3 rounded-sm" style="background-color: {platformColors.get(ps.platformId) || '#64748b'};"></span>
													{ps.platformName}
												</span>
											</td>
											<td class="text-right font-mono">{ps.nights}</td>
											<td class="text-right font-mono">{formatMoney(ps.rentalTotal)}</td>
											<td class="text-right font-mono">{formatMoney(ps.avgPricePerNight)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				{/if}

				<!-- Calendar -->
				<div class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
					<span class="font-semibold mr-2">Legend:</span>
					{#each platforms as p}
						<span class="inline-flex items-center gap-1">
							<span class="inline-block w-3 h-3 rounded-sm" style="background-color: {platformColors.get(p.id)};"></span>
							{p.name}
						</span>
					{/each}
					<span class="inline-flex items-center gap-1">
						<span class="inline-block w-3 h-3 rounded-sm" style="background-color: {UNBOOKED_FUTURE_COLOR};"></span>
						Available
					</span>
					<span class="inline-flex items-center gap-1">
						<span class="inline-block w-3 h-3 rounded-sm" style="background-color: {UNBOOKED_PAST_COLOR};"></span>
						Unbooked (past)
					</span>
				</div>

				<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
					{#each yearData.months as { month, firstWeekday, days }}
						<div class="bg-base-200 rounded-box p-2">
							<div class="text-xs font-semibold mb-1 text-center">{MONTH_NAMES[month]}</div>
							<div class="grid grid-cols-7 gap-[2px]">
								{#each Array(firstWeekday) as _}
									<div class="w-4 h-4"></div>
								{/each}
								{#each days as day (day.date)}
									<!-- svelte-ignore a11y_click_events_have_key_events -->
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<div
										class="w-4 h-4 rounded-sm cursor-pointer hover:opacity-75"
										style="background-color: {dayColor(day)};"
										title={dayTitle(day)}
										onclick={() => {
											if (day.kind === 'booked') {
												const b = bookings.find(x => x.id === day.bookingId);
												if (b) openEdit(b);
											} else {
												openCreate(day.date);
											}
										}}
									></div>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			</div>
		</div>
	{/if}

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
				<div class="flex items-center justify-between mb-4">
					<h2 class="card-title">All Bookings</h2>
					<input type="text" placeholder="Search bookings..." class="input input-bordered w-full max-w-xs" bind:value={searchQuery} />
				</div>
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
							{#each filteredBookings as b (b.id)}
								<tr style={isBookingActiveToday(b) ? 'background-color: oklch(var(--p) / 0.15); font-weight: 600;' : ''}>
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
