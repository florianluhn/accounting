<script lang="ts">
	import {
		currenciesAPI,
		type Currency,
		backupAPI,
		type BackupStatus,
		settingsAPI,
		bookingsAPI,
		type BookingConfig,
		type BookingPlatform,
		journalEntriesAPI,
		financialYearsAPI,
		type ClosedFinancialYear,
		type YearClosePreview
	} from '$lib/api';
	import { modules, branding, financialYear, applyModuleSettings, setAppLogo } from '$lib/modules.svelte';
	import {
		MONTH_NAMES,
		financialYearEndMonth,
		formatFinancialYearLabel,
		formatFinancialYearRange,
		getFinancialYear
	} from '$lib/financial-year';

	const DELETE_ALL_JOURNAL_CONFIRM = 'DELETE ALL JOURNAL ENTRIES';

	let currencies = $state<Currency[]>([]);
	let loading = $state(true);
	let error = $state('');
	let showAddModal = $state(false);
	let editingCurrency = $state<Currency | null>(null);

	// Danger zone: delete all journal entries
	let journalEntryCount = $state<number | null>(null);
	let deleteAllConfirmText = $state('');
	let deleteAllLoading = $state(false);
	let deleteAllMessage = $state('');
	let deleteAllError = $state('');

	// App logo & organization name
	let logoUploading = $state(false);
	let logoMessage = $state('');
	let logoPreviewUrl = $derived(
		branding.hasLogo ? settingsAPI.getLogoUrl(branding.logoVersion) : ''
	);
	let organizationNameDraft = $state('');
	let organizationNameSaving = $state(false);
	let organizationNameMessage = $state('');

	// Backup state
	let backupStatus = $state<BackupStatus | null>(null);
	let backupLoading = $state(false);
	let backupMessage = $state('');

	// Form state
	let formData = $state({
		code: '',
		name: '',
		symbol: '',
		exchangeRate: 1.0,
		isDefault: false
	});

	// Booking settings state
	let bookingConfig = $state<BookingConfig>({
		cleaningFee: 0,
		salesTaxRate: 0,
		touristTaxRate: 0,
		websiteAvailabilityPath: ''
	});
	let bookingConfigSaving = $state(false);
	let bookingPlatforms = $state<BookingPlatform[]>([]);
	let newPlatformName = $state('');
	let editingPlatformId = $state<number | null>(null);
	let editingPlatformName = $state('');
	let editingPlatformFeeRate = $state(0);
	let editingPlatformWithholdsTaxes = $state(false);

	// Year-end close
	let closedYears = $state<ClosedFinancialYear[]>([]);
	let closeFyYear = $state(getFinancialYear(new Date(), 1) - 1);
	let closePreview = $state<YearClosePreview | null>(null);
	let closePreviewLoading = $state(false);
	let closeLoading = $state(false);
	let closeMessage = $state('');
	let closeError = $state('');

	$effect(() => {
		loadCurrencies();
		loadBackupStatus();
		loadModuleSettings();
		loadBookingSettings();
		loadJournalEntryCount();
		loadClosedYears();
	});

	async function loadJournalEntryCount() {
		try {
			const result = await journalEntriesAPI.count();
			journalEntryCount = result.count;
		} catch (e) {
			console.error('Failed to load journal entry count:', e);
			journalEntryCount = null;
		}
	}

	async function deleteAllJournalEntries() {
		if (deleteAllConfirmText.trim() !== DELETE_ALL_JOURNAL_CONFIRM) {
			deleteAllError = `Type exactly: ${DELETE_ALL_JOURNAL_CONFIRM}`;
			return;
		}

		const countLabel =
			journalEntryCount === null
				? 'all'
				: String(journalEntryCount);
		if (
			!confirm(
				`This will permanently delete ${countLabel} journal entr${journalEntryCount === 1 ? 'y' : 'ies'} and their journal attachments.\n\nAccounts, vendors, customers, budgets, and other master data are kept.\n\nThis cannot be undone. Continue?`
			)
		) {
			return;
		}

		try {
			deleteAllLoading = true;
			deleteAllError = '';
			deleteAllMessage = '';
			const result = await journalEntriesAPI.deleteAll(DELETE_ALL_JOURNAL_CONFIRM);
			deleteAllMessage = result.message;
			deleteAllConfirmText = '';
			await loadJournalEntryCount();
		} catch (e) {
			deleteAllError = e instanceof Error ? e.message : 'Failed to delete journal entries';
		} finally {
			deleteAllLoading = false;
		}
	}

	async function handleLogoUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			logoUploading = true;
			logoMessage = '';
			error = '';
			await settingsAPI.uploadLogo(file);
			setAppLogo(true);
			logoMessage = 'Logo updated. It now appears in the top-left of the app.';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to upload logo';
		} finally {
			logoUploading = false;
			input.value = '';
		}
	}

	async function handleLogoRemove() {
		if (!confirm('Remove the app logo? The default icon will be shown again.')) return;
		try {
			logoUploading = true;
			logoMessage = '';
			await settingsAPI.deleteLogo();
			setAppLogo(false);
			logoMessage = 'Logo removed.';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to remove logo';
		} finally {
			logoUploading = false;
		}
	}

	async function loadBookingSettings() {
		try {
			bookingConfig = await bookingsAPI.getConfig();
			bookingPlatforms = await bookingsAPI.listPlatforms();
		} catch (e) {
			console.error('Failed to load booking settings:', e);
		}
	}

	async function saveBookingConfig() {
		try {
			bookingConfigSaving = true;
			bookingConfig = await bookingsAPI.updateConfig(bookingConfig);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save booking config';
		} finally {
			bookingConfigSaving = false;
		}
	}

	async function addPlatform() {
		const name = newPlatformName.trim();
		if (!name) return;
		try {
			await bookingsAPI.createPlatform({ name, sortOrder: (bookingPlatforms[bookingPlatforms.length - 1]?.sortOrder ?? 0) + 1 });
			newPlatformName = '';
			bookingPlatforms = await bookingsAPI.listPlatforms();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to add platform';
		}
	}

	function startEditPlatform(p: BookingPlatform) {
		editingPlatformId = p.id;
		editingPlatformName = p.name;
		editingPlatformFeeRate = p.platformFeeRate ?? 0;
		editingPlatformWithholdsTaxes = p.withholdsTaxes ?? false;
	}

	async function saveEditPlatform() {
		if (editingPlatformId === null) return;
		const name = editingPlatformName.trim();
		if (!name) return;
		try {
			await bookingsAPI.updatePlatform(editingPlatformId, {
				name,
				platformFeeRate: editingPlatformFeeRate,
				withholdsTaxes: editingPlatformWithholdsTaxes
			});
			editingPlatformId = null;
			editingPlatformName = '';
			editingPlatformFeeRate = 0;
			editingPlatformWithholdsTaxes = false;
			bookingPlatforms = await bookingsAPI.listPlatforms();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to update platform';
		}
	}

	async function deletePlatform(id: number) {
		if (!confirm('Delete this booking platform?')) return;
		try {
			await bookingsAPI.deletePlatform(id);
			bookingPlatforms = await bookingsAPI.listPlatforms();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to delete platform';
		}
	}

	let modulesSaving = $state(false);
	let financialYearSaving = $state(false);
	let financialYearMessage = $state('');

	async function loadModuleSettings() {
		try {
			const s = await settingsAPI.get();
			applyModuleSettings(s);
			organizationNameDraft = branding.organizationName;
			// Default close target: previous financial year
			closeFyYear = getFinancialYear(new Date(), financialYear.startMonth) - 1;
		} catch (e) {
			console.error('Failed to load module settings:', e);
		}
	}

	async function loadClosedYears() {
		try {
			const status = await financialYearsAPI.status();
			closedYears = status.closedYears;
		} catch (e) {
			console.error('Failed to load closed years:', e);
		}
	}

	async function loadClosePreview() {
		try {
			closePreviewLoading = true;
			closeError = '';
			closePreview = await financialYearsAPI.preview(closeFyYear);
		} catch (e) {
			closePreview = null;
			closeError = e instanceof Error ? e.message : 'Failed to load close preview';
		} finally {
			closePreviewLoading = false;
		}
	}

	function formatCloseAmount(amount: number): string {
		return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	}

	async function confirmCloseYear() {
		if (!closePreview || closePreview.alreadyClosed) return;

		const label = formatFinancialYearLabel(closePreview.fyYear, closePreview.startMonth);
		const ni = formatCloseAmount(closePreview.netIncome);
		const ok = confirm(
			`Close ${label}?\n\n` +
				`Period: ${closePreview.periodStart} → ${closePreview.periodEnd}\n` +
				`Net income/(loss): ${ni}\n` +
				`Will create equity account: ${closePreview.label}\n\n` +
				`This posts year-end closing entries and permanently locks all journal activity in that period. Continue?`
		);
		if (!ok) return;

		try {
			closeLoading = true;
			closeError = '';
			closeMessage = '';
			const result = await financialYearsAPI.close(closeFyYear);
			closeMessage = `Closed ${result.label}. Net income ${formatCloseAmount(result.netIncome)} posted to equity. The period ${result.periodStart} – ${result.periodEnd} is now locked.`;
			closePreview = null;
			await loadClosedYears();
			closePreview = await financialYearsAPI.preview(closeFyYear);
		} catch (e) {
			closeError = e instanceof Error ? e.message : 'Failed to close financial year';
		} finally {
			closeLoading = false;
		}
	}

	async function saveOrganizationName() {
		try {
			organizationNameSaving = true;
			organizationNameMessage = '';
			const updated = await settingsAPI.update({
				organizationName: organizationNameDraft.trim()
			});
			applyModuleSettings(updated);
			organizationNameDraft = branding.organizationName;
			organizationNameMessage = branding.organizationName
				? `Name saved. Reports will show e.g. "Profit & Loss Statement ${branding.organizationName}".`
				: 'Name cleared. Reports will use the default title only.';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save organization name';
		} finally {
			organizationNameSaving = false;
		}
	}

	async function saveModuleSettings() {
		try {
			modulesSaving = true;
			const updated = await settingsAPI.update({
				vendors: modules.vendors,
				customers: modules.customers,
				inventory: modules.inventory,
				timeTracking: modules.timeTracking,
				bookings: modules.bookings,
				fixedAssets: modules.fixedAssets,
				budgets: modules.budgets,
				checkReferences: modules.checkReferences
			});
			applyModuleSettings(updated);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save module settings';
		} finally {
			modulesSaving = false;
		}
	}

	async function saveFinancialYearStartMonth() {
		try {
			financialYearSaving = true;
			financialYearMessage = '';
			const updated = await settingsAPI.update({
				financialYearStartMonth: financialYear.startMonth
			});
			applyModuleSettings(updated);
			const endName = MONTH_NAMES[financialYearEndMonth(financialYear.startMonth) - 1];
			const startName = MONTH_NAMES[financialYear.startMonth - 1];
			financialYearMessage = `Financial year set to ${startName}–${endName}. Budgets and P&L use this period.`;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save financial year';
		} finally {
			financialYearSaving = false;
		}
	}

	let fyPreviewRange = $derived(
		formatFinancialYearRange(getFinancialYear(new Date(), financialYear.startMonth), financialYear.startMonth)
	);
	let fyEndMonthName = $derived(MONTH_NAMES[financialYearEndMonth(financialYear.startMonth) - 1]);

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
			
			const code = formData.code.trim().toUpperCase();
			if (!code.match(/^[A-Z]{3}$/)) {
				error = 'Currency code must be exactly 3 letters (e.g. USD, EUR)';
				return;
			}
			formData.code = code;

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

	async function loadBackupStatus() {
		try {
			backupStatus = await backupAPI.getStatus();
		} catch (e) {
			console.error('Failed to load backup status:', e);
		}
	}

	async function triggerBackup() {
		if (!confirm('Are you sure you want to trigger a manual backup now?')) {
			return;
		}

		try {
			backupLoading = true;
			backupMessage = '';
			const result = await backupAPI.triggerManual();
			backupMessage = result.message;

			// Reload status after backup
			await loadBackupStatus();
		} catch (e) {
			backupMessage = e instanceof Error ? e.message : 'Failed to trigger backup';
		} finally {
			backupLoading = false;
		}
	}
</script>

<div class="page-shell">
	<!-- Header -->
	<div class="mb-8">
		<p class="section-label mb-2">Preferences</p>
		<h1 class="page-title">Settings</h1>
		<p class="page-subtitle">Currencies, modules, and application options</p>
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

	<!-- App branding (name + logo) -->
	<div class="card bg-base-100 shadow-xl mb-6">
		<div class="card-body">
			<h2 class="card-title text-2xl">Branding</h2>
			<p class="text-sm text-base-content/60 mb-4">
				Set the organization name used on financial reports, and the logo shown in the app header.
			</p>

			<div class="form-control w-full max-w-md mb-6">
				<label class="label" for="organization-name">
					<span class="label-text font-medium">Organization name</span>
				</label>
				<div class="flex flex-col sm:flex-row gap-2">
					<input
						id="organization-name"
						type="text"
						class="input input-bordered w-full"
						placeholder="e.g. Acme Co"
						maxlength="120"
						bind:value={organizationNameDraft}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								saveOrganizationName();
							}
						}}
					/>
					<button
						type="button"
						class="btn btn-primary shrink-0"
						onclick={saveOrganizationName}
						disabled={organizationNameSaving}
					>
						{#if organizationNameSaving}
							<span class="loading loading-spinner loading-sm"></span>
						{/if}
						Save
					</button>
				</div>
				<span class="label-text-alt text-base-content/50 mt-1">
					Appears next to report titles (e.g. “Profit &amp; Loss Statement Acme Co”).
				</span>
				{#if organizationNameMessage}
					<div class="alert alert-success text-sm py-2 mt-2">
						<span>{organizationNameMessage}</span>
					</div>
				{/if}
			</div>

			<div class="divider my-2"></div>

			<h3 class="font-semibold text-lg mb-2">App logo</h3>
			<p class="text-sm text-base-content/60 mb-4">
				Upload a picture that appears in the top-left of the app (sidebar and mobile header).
			</p>

			<div class="flex flex-col sm:flex-row gap-6 items-start">
				<div class="flex flex-col items-center gap-2">
					{#if logoPreviewUrl}
						<img
							src={logoPreviewUrl}
							alt="App logo"
							class="w-24 h-24 rounded-2xl object-cover border border-base-300 shadow-soft bg-base-200"
						/>
					{:else}
						<div
							class="w-24 h-24 rounded-2xl surface-primary flex items-center justify-center shadow-md text-primary-content"
						>
							<svg class="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 3v18M3 9h18M3 15h18" />
							</svg>
						</div>
					{/if}
					<span class="text-2xs text-base-content/50 font-medium">
						{logoPreviewUrl ? 'Current logo' : 'Default icon'}
					</span>
				</div>

				<div class="flex-1 space-y-3 w-full max-w-md">
					<label class="form-control w-full">
						<span class="label-text mb-1">Upload image</span>
						<input
							type="file"
							class="file-input file-input-bordered w-full"
							accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
							onchange={handleLogoUpload}
							disabled={logoUploading}
						/>
						<span class="label-text-alt text-base-content/50 mt-1">
							PNG, JPEG, WebP, GIF, or SVG
						</span>
					</label>

					<div class="flex flex-wrap gap-2">
						{#if branding.hasLogo}
							<button
								type="button"
								class="btn btn-outline btn-sm text-error"
								onclick={handleLogoRemove}
								disabled={logoUploading}
							>
								Remove logo
							</button>
						{/if}
						{#if logoUploading}
							<span class="loading loading-spinner loading-sm text-primary"></span>
						{/if}
					</div>

					{#if logoMessage}
						<div class="alert alert-success text-sm py-2">
							<span>{logoMessage}</span>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>

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
									<td>{currency.exchangeRate.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</td>
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

	<!-- Financial Year -->
	<div class="card bg-base-100 shadow-xl mb-6">
		<div class="card-body">
			<h2 class="card-title mb-1">Financial Year</h2>
			<p class="text-sm text-base-content/60 mb-4">
				Choose the month your financial year starts. The ending month is calculated automatically.
				Budgets are stored per financial year, and Profit &amp; Loss defaults to this period.
			</p>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
				<div class="form-control">
					<label class="label" for="fy-start-month">
						<span class="label-text">Starting month</span>
					</label>
					<select
						id="fy-start-month"
						class="select select-bordered"
						value={String(financialYear.startMonth)}
						disabled={closedYears.length > 0}
						onchange={(e) => {
							const v = parseInt((e.currentTarget as HTMLSelectElement).value, 10);
							financialYear.startMonth = Number.isFinite(v) && v >= 1 && v <= 12 ? v : 1;
							saveFinancialYearStartMonth();
						}}
					>
						{#each MONTH_NAMES as name, i}
							<option value={String(i + 1)}>{name}</option>
						{/each}
					</select>
					{#if closedYears.length > 0}
						<label class="label">
							<span class="label-text-alt text-warning">
								Locked after a year has been closed
							</span>
						</label>
					{/if}
				</div>
				<div class="form-control">
					<label class="label">
						<span class="label-text">Ending month</span>
					</label>
					<input
						type="text"
						class="input input-bordered"
						value={fyEndMonthName}
						readonly
						disabled
					/>
					<label class="label">
						<span class="label-text-alt text-base-content/50">Calculated from starting month</span>
					</label>
				</div>
			</div>

			<div class="mt-3 text-sm text-base-content/70">
				Current period: <span class="font-medium">{fyPreviewRange}</span>
			</div>

			{#if financialYearSaving}
				<div class="text-sm text-base-content/50 mt-2">Saving...</div>
			{/if}
			{#if financialYearMessage}
				<div class="alert alert-success text-sm py-2 mt-3">
					<span>{financialYearMessage}</span>
				</div>
			{/if}

			<div class="divider"></div>

			<h3 class="font-semibold text-lg mb-1">Close financial year</h3>
			<p class="text-sm text-base-content/60 mb-4">
				Transfer the year’s net income or loss into a dedicated equity account
				(e.g. <span class="font-medium">Retained Earnings 2025</span>) on the balance sheet.
				After closing, no journal postings, edits, or deletions are allowed in that period.
			</p>

			<div class="flex flex-wrap gap-3 items-end mb-4">
				<div class="form-control">
					<label class="label" for="close-fy-year">
						<span class="label-text">Financial year to close</span>
					</label>
					<input
						id="close-fy-year"
						type="number"
						class="input input-bordered w-36"
						min="1900"
						max="2100"
						bind:value={closeFyYear}
					/>
					<label class="label">
						<span class="label-text-alt text-base-content/50">
							Start year of the FY (e.g. 2025)
						</span>
					</label>
				</div>
				<button
					type="button"
					class="btn btn-outline"
					onclick={loadClosePreview}
					disabled={closePreviewLoading || closeLoading}
				>
					{#if closePreviewLoading}
						<span class="loading loading-spinner loading-sm"></span>
					{/if}
					Preview close
				</button>
			</div>

			{#if closeError}
				<div class="alert alert-error text-sm py-2 mb-3">
					<span>{closeError}</span>
				</div>
			{/if}
			{#if closeMessage}
				<div class="alert alert-success text-sm py-2 mb-3">
					<span>{closeMessage}</span>
				</div>
			{/if}

			{#if closePreview}
				<div class="rounded-box border border-base-300 bg-base-200/50 p-4 space-y-2 max-w-2xl">
					<div class="font-medium">
						{formatFinancialYearLabel(closePreview.fyYear, closePreview.startMonth)}
						{#if closePreview.alreadyClosed}
							<span class="badge badge-success badge-sm ml-2">Already closed</span>
						{/if}
					</div>
					<p class="text-sm text-base-content/70">
						{closePreview.periodStart} → {closePreview.periodEnd}
					</p>
					<div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
						<div>
							<span class="text-base-content/50">Revenue</span>
							<div class="font-mono font-medium">{formatCloseAmount(closePreview.totalRevenue)}</div>
						</div>
						<div>
							<span class="text-base-content/50">Expenses</span>
							<div class="font-mono font-medium">{formatCloseAmount(closePreview.totalExpenses)}</div>
						</div>
						<div>
							<span class="text-base-content/50">Net income/(loss)</span>
							<div
								class="font-mono font-bold"
								class:text-success={closePreview.netIncome > 0}
								class:text-error={closePreview.netIncome < 0}
							>
								{formatCloseAmount(closePreview.netIncome)}
							</div>
						</div>
					</div>
					<p class="text-sm">
						Equity account to create:
						<span class="font-semibold">{closePreview.label}</span>
						· {closePreview.profitAccountCount + closePreview.lossAccountCount} P&amp;L account(s) to close
					</p>
					{#if closePreview.lines.length > 0}
						<details class="text-sm">
							<summary class="cursor-pointer text-base-content/70">View closing lines</summary>
							<ul class="mt-2 space-y-1 max-h-48 overflow-y-auto">
								{#each closePreview.lines as line}
									<li class="flex justify-between gap-4 font-mono text-xs">
										<span>{line.accountNumber} — {line.accountName}</span>
										<span>{formatCloseAmount(line.balance)}</span>
									</li>
								{/each}
							</ul>
						</details>
					{/if}
					{#if !closePreview.alreadyClosed}
						<button
							type="button"
							class="btn btn-primary mt-2"
							onclick={confirmCloseYear}
							disabled={closeLoading}
						>
							{#if closeLoading}
								<span class="loading loading-spinner loading-sm"></span>
								Closing...
							{:else}
								Close financial year
							{/if}
						</button>
					{/if}
				</div>
			{/if}

			{#if closedYears.length > 0}
				<div class="mt-6">
					<h4 class="font-medium mb-2">Closed years</h4>
					<div class="overflow-x-auto">
						<table class="table table-sm">
							<thead>
								<tr>
									<th>Year</th>
									<th>Period</th>
									<th>Equity account</th>
									<th class="text-right">Net income</th>
								</tr>
							</thead>
							<tbody>
								{#each closedYears as cy}
									<tr>
										<td class="font-medium">
											{formatFinancialYearLabel(cy.fyYear, cy.startMonth)}
										</td>
										<td class="text-sm text-base-content/70">
											{cy.periodStart} – {cy.periodEnd}
										</td>
										<td>{cy.label}</td>
										<td
											class="text-right font-mono"
											class:text-success={cy.netIncome > 0}
											class:text-error={cy.netIncome < 0}
										>
											{formatCloseAmount(cy.netIncome)}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- Modules Section -->
	<div class="card bg-base-100 shadow-xl mb-6">
		<div class="card-body">
			<h2 class="card-title mb-1">Modules</h2>
			<p class="text-sm text-base-content/60 mb-4">Enable or disable features. Disabled modules are hidden from the navigation and journal entry forms.</p>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<label class="flex items-center justify-between p-3 bg-base-200 rounded-box cursor-pointer">
					<div>
						<div class="font-medium">Vendors</div>
						<div class="text-xs text-base-content/50">Vendor management and journal entry links</div>
					</div>
					<input type="checkbox" class="toggle toggle-primary" bind:checked={modules.vendors} onchange={saveModuleSettings} />
				</label>
				<label class="flex items-center justify-between p-3 bg-base-200 rounded-box cursor-pointer">
					<div>
						<div class="font-medium">Customers</div>
						<div class="text-xs text-base-content/50">Customer management and journal entry links</div>
					</div>
					<input type="checkbox" class="toggle toggle-primary" bind:checked={modules.customers} onchange={saveModuleSettings} />
				</label>
				<label class="flex items-center justify-between p-3 bg-base-200 rounded-box cursor-pointer">
					<div>
						<div class="font-medium">Inventory</div>
						<div class="text-xs text-base-content/50">Raw materials, finished goods, and allocations</div>
					</div>
					<input type="checkbox" class="toggle toggle-primary" bind:checked={modules.inventory} onchange={saveModuleSettings} />
				</label>
				<label class="flex items-center justify-between p-3 bg-base-200 rounded-box cursor-pointer">
					<div>
						<div class="font-medium">Time Tracking</div>
						<div class="text-xs text-base-content/50">Log hours and activities</div>
					</div>
					<input type="checkbox" class="toggle toggle-primary" bind:checked={modules.timeTracking} onchange={saveModuleSettings} />
				</label>
				<label class="flex items-center justify-between p-3 bg-base-200 rounded-box cursor-pointer">
					<div>
						<div class="font-medium">Bookings</div>
						<div class="text-xs text-base-content/50">Overnight booking management</div>
					</div>
					<input type="checkbox" class="toggle toggle-primary" bind:checked={modules.bookings} onchange={saveModuleSettings} />
				</label>
				<label class="flex items-center justify-between p-3 bg-base-200 rounded-box cursor-pointer">
					<div>
						<div class="font-medium">Assets</div>
						<div class="text-xs text-base-content/50">Fixed assets management</div>
					</div>
					<input type="checkbox" class="toggle toggle-primary" bind:checked={modules.fixedAssets} onchange={saveModuleSettings} />
				</label>
				<label class="flex items-center justify-between p-3 bg-base-200 rounded-box cursor-pointer">
					<div>
						<div class="font-medium">Budgets</div>
						<div class="text-xs text-base-content/50">Annual budgeting per account</div>
					</div>
					<input type="checkbox" class="toggle toggle-primary" bind:checked={modules.budgets} onchange={saveModuleSettings} />
				</label>
				<label class="flex items-center justify-between p-3 bg-base-200 rounded-box cursor-pointer">
					<div>
						<div class="font-medium">Check / References</div>
						<div class="text-xs text-base-content/50">
							Match related journal entries (e.g. check number on clearing vs bank)
						</div>
					</div>
					<input
						type="checkbox"
						class="toggle toggle-primary"
						bind:checked={modules.checkReferences}
						onchange={saveModuleSettings}
					/>
				</label>
			</div>
			{#if modulesSaving}
				<div class="text-sm text-base-content/50 mt-2">Saving...</div>
			{/if}
		</div>
	</div>

	<!-- Booking Settings Section -->
	{#if modules.bookings}
	<div class="card bg-base-100 shadow-xl mb-6">
		<div class="card-body">
			<h2 class="card-title mb-1">Booking Settings</h2>
			<p class="text-sm text-base-content/60 mb-4">Default values and tax rates used when calculating bookings. Individual bookings can override any value.</p>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
				<div class="form-control">
					<label class="label"><span class="label-text">Default Cleaning Fee ($)</span></label>
					<input type="number" step="0.01" min="0" class="input input-bordered" bind:value={bookingConfig.cleaningFee} />
				</div>
				<div class="form-control">
					<label class="label">
						<span class="label-text">Sales Tax Rate (%)</span>
						<span class="label-text-alt text-xs text-base-content/50">e.g. 7 for 7%</span>
					</label>
					<input type="number" step="0.001" min="0" class="input input-bordered" bind:value={bookingConfig.salesTaxRate} />
				</div>
				<div class="form-control">
					<label class="label">
						<span class="label-text">Tourist Tax Rate (%)</span>
						<span class="label-text-alt text-xs text-base-content/50">e.g. 5 for 5%</span>
					</label>
					<input type="number" step="0.001" min="0" class="input input-bordered" bind:value={bookingConfig.touristTaxRate} />
				</div>
				<div class="form-control sm:col-span-2">
					<label class="label">
						<span class="label-text">Website Availability File Path</span>
						<span class="label-text-alt text-xs text-base-content/50">Where "Sync to Website" writes; ~ is expanded to home</span>
					</label>
					<input type="text" class="input input-bordered font-mono text-sm" placeholder="~/villaluhna/VillaLuhna_Website_Claude/availability.json" bind:value={bookingConfig.websiteAvailabilityPath} />
				</div>
			</div>

			<div class="flex justify-end">
				<button class="btn btn-primary" onclick={saveBookingConfig} disabled={bookingConfigSaving}>
					{bookingConfigSaving ? 'Saving...' : 'Save Booking Defaults'}
				</button>
			</div>

			<div class="divider"></div>

			<h3 class="font-semibold mb-2">Booking Platforms</h3>
			<p class="text-sm text-base-content/60 mb-4">Configure the platforms that appear in the dropdown when creating a booking.</p>

			<div class="space-y-2 mb-4">
				{#each bookingPlatforms as platform (platform.id)}
					<div class="bg-base-200 p-3 rounded-box">
						{#if editingPlatformId === platform.id}
							<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
								<div class="form-control">
									<label class="label py-1"><span class="label-text text-xs">Name</span></label>
									<input type="text" class="input input-bordered input-sm" bind:value={editingPlatformName} />
								</div>
								<div class="form-control">
									<label class="label py-1"><span class="label-text text-xs">Platform Fee Rate (%)</span></label>
									<input type="number" step="0.001" min="0" class="input input-bordered input-sm" bind:value={editingPlatformFeeRate} />
								</div>
								<div class="form-control">
									<label class="label py-1"><span class="label-text text-xs">Withholds Taxes</span></label>
									<label class="flex items-center gap-2 h-[2rem]">
										<input type="checkbox" class="toggle toggle-primary toggle-sm" bind:checked={editingPlatformWithholdsTaxes} />
										<span class="text-xs text-base-content/60">If on, no taxes are added; customer paid = net</span>
									</label>
								</div>
							</div>
							<div class="flex gap-2 justify-end">
								<button class="btn btn-sm btn-primary" onclick={saveEditPlatform}>Save</button>
								<button class="btn btn-sm btn-ghost" onclick={() => { editingPlatformId = null; }}>Cancel</button>
							</div>
						{:else}
							<div class="flex items-center justify-between">
								<div class="flex-1">
									<div class="font-medium">{platform.name}</div>
									<div class="text-xs text-base-content/60 mt-1">
										Fee: {(platform.platformFeeRate ?? 0).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}%
										{#if platform.withholdsTaxes}
											· <span class="badge badge-sm badge-info">Withholds Taxes</span>
										{/if}
									</div>
								</div>
								<div class="flex gap-2">
									<button class="btn btn-sm btn-ghost" onclick={() => startEditPlatform(platform)}>Edit</button>
									<button class="btn btn-sm btn-ghost text-error" onclick={() => deletePlatform(platform.id)}>Delete</button>
								</div>
							</div>
						{/if}
					</div>
				{:else}
					<p class="text-sm text-base-content/50">No platforms configured.</p>
				{/each}
			</div>

			<div class="flex gap-2">
				<input type="text" class="input input-bordered flex-1" placeholder="New platform name..." bind:value={newPlatformName} onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPlatform(); } }} />
				<button class="btn btn-primary" onclick={addPlatform} disabled={!newPlatformName.trim()}>+ Add Platform</button>
			</div>
		</div>
	</div>
	{/if}

	<!-- Backup Section -->
	<div class="card bg-base-100 shadow-xl mb-6">
		<div class="card-body">
			<h2 class="card-title text-2xl mb-4">Backup Management</h2>

			{#if backupMessage}
				<div class="alert {backupMessage.includes('success') ? 'alert-success' : 'alert-error'} mb-4">
					<span>{backupMessage}</span>
				</div>
			{/if}

			{#if backupStatus}
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
					<div class="stat bg-base-200 rounded-lg">
						<div class="stat-title">Status</div>
						<div class="stat-value text-lg">
							{#if backupStatus.enabled}
								<span class="badge badge-success badge-lg">Enabled</span>
							{:else}
								<span class="badge badge-error badge-lg">Disabled</span>
							{/if}
						</div>
						<div class="stat-desc">Automatic backups {backupStatus.enabled ? 'active' : 'inactive'}</div>
					</div>

					<div class="stat bg-base-200 rounded-lg">
						<div class="stat-title">Schedule</div>
						<div class="stat-value text-lg font-mono">{backupStatus.schedule}</div>
						<div class="stat-desc">Cron format (minute hour day month weekday)</div>
					</div>

					<div class="stat bg-base-200 rounded-lg">
						<div class="stat-title">NAS Configuration</div>
						<div class="stat-value text-lg">
							{#if backupStatus.nasConfigured}
								<span class="badge badge-success badge-lg">Configured</span>
							{:else}
								<span class="badge badge-warning badge-lg">Not Configured</span>
							{/if}
						</div>
						<div class="stat-desc">
							{#if backupStatus.nasConfigured}
								Backups will transfer to NAS
							{:else}
								Set credentials in .env file
							{/if}
						</div>
					</div>

					<div class="stat bg-base-200 rounded-lg">
						<div class="stat-title">Retention</div>
						<div class="stat-value text-lg">{backupStatus.config.retentionDays} days</div>
						<div class="stat-desc">Old backups automatically deleted</div>
					</div>
				</div>

				<div class="divider"></div>

				<div class="space-y-2">
					<h3 class="font-semibold mb-2">Backup Configuration</h3>
					<div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
						<div><span class="font-semibold">NAS Host:</span> {backupStatus.config.nasHost}</div>
						<div><span class="font-semibold">NAS Share:</span> {backupStatus.config.nasShare}</div>
						<div><span class="font-semibold">NAS Folder:</span> {backupStatus.config.nasFolder}</div>
						<div><span class="font-semibold">Local Dir:</span> {backupStatus.config.localDir}</div>
					</div>
				</div>

				<div class="card-actions justify-end mt-4">
					<button
						class="btn btn-primary"
						onclick={triggerBackup}
						disabled={!backupStatus.enabled || backupLoading}
					>
						{#if backupLoading}
							<span class="loading loading-spinner"></span>
							Running Backup...
						{:else}
							Trigger Manual Backup
						{/if}
					</button>
				</div>

				{#if !backupStatus.enabled}
					<div class="alert alert-info mt-4">
						<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
						</svg>
						<span>To enable backups, set <code>BACKUP_ENABLED=true</code> in your .env file and restart the server.</span>
					</div>
				{/if}

				{#if backupStatus.enabled && !backupStatus.nasConfigured}
					<div class="alert alert-warning mt-4">
						<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
						</svg>
						<div>
							<div class="font-bold">NAS credentials not configured</div>
							<div class="text-sm">Backups will be stored locally only. Set <code>BACKUP_NAS_USERNAME</code> and <code>BACKUP_NAS_PASSWORD</code> in your .env file to enable NAS transfers.</div>
						</div>
					</div>
				{/if}
			{:else}
				<div class="flex justify-center py-8">
					<span class="loading loading-spinner loading-lg"></span>
				</div>
			{/if}
		</div>
	</div>

	<!-- Database Info -->
	<div class="card bg-base-100 shadow-xl mb-6">
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
				<div class="stat">
					<div class="stat-title">Journal entries</div>
					<div class="stat-value text-lg">
						{journalEntryCount === null ? '—' : journalEntryCount.toLocaleString()}
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Danger zone: delete all journal entries -->
	<div class="card bg-base-100 shadow-xl border border-error/30 mb-6">
		<div class="card-body">
			<h2 class="card-title text-2xl text-error">Danger zone</h2>
			<p class="text-sm text-base-content/70 mb-4">
				Permanently delete <strong>all journal entries</strong>. Use this to wipe transaction history
				while keeping accounts, currencies, vendors, customers, budgets, and other settings.
				Journal-linked attachment files are removed as well. This cannot be undone — export a CSV or
				run a backup first if you need a copy.
			</p>

			<div class="alert alert-warning mb-4">
				<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
					/>
				</svg>
				<span>
					Currently
					<strong>
						{journalEntryCount === null ? '…' : journalEntryCount.toLocaleString()}
					</strong>
					journal entr{journalEntryCount === 1 ? 'y' : 'ies'} in the database.
				</span>
			</div>

			{#if deleteAllError}
				<div class="alert alert-error mb-4">
					<span>{deleteAllError}</span>
				</div>
			{/if}
			{#if deleteAllMessage}
				<div class="alert alert-success mb-4">
					<span>{deleteAllMessage}</span>
				</div>
			{/if}

			<div class="form-control max-w-xl mb-4">
				<label class="label" for="delete-all-confirm">
					<span class="label-text">
						Type <code class="text-error font-semibold">{DELETE_ALL_JOURNAL_CONFIRM}</code> to enable
						deletion
					</span>
				</label>
				<input
					id="delete-all-confirm"
					type="text"
					class="input input-bordered input-error font-mono text-sm"
					bind:value={deleteAllConfirmText}
					placeholder={DELETE_ALL_JOURNAL_CONFIRM}
					autocomplete="off"
					disabled={deleteAllLoading || journalEntryCount === 0}
				/>
			</div>

			<button
				type="button"
				class="btn btn-error w-fit"
				onclick={deleteAllJournalEntries}
				disabled={
					deleteAllLoading ||
					journalEntryCount === 0 ||
					deleteAllConfirmText.trim() !== DELETE_ALL_JOURNAL_CONFIRM
				}
			>
				{#if deleteAllLoading}
					<span class="loading loading-spinner"></span>
					Deleting…
				{:else}
					Delete all journal entries
				{/if}
			</button>
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

			<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} novalidate>
				<div class="form-control mb-4">
					<label class="label">
						<span class="label-text">Currency Code (3 letters)</span>
					</label>
					<input
						type="text"
						class="input input-bordered uppercase"
						bind:value={formData.code}
						maxlength="5"
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
