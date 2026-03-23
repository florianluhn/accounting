<script lang="ts">
	import { timeEntriesAPI, type TimeEntry } from '$lib/api';

	let entries = $state<TimeEntry[]>([]);
	let loading = $state(true);
	let error = $state('');
	let searchQuery = $state('');
	let startDate = $state('');
	let endDate = $state('');
	let filterWho = $state('');
	let uploadingCSV = $state(false);
	let csvUploadResult = $state<{ success: number; failed: number; errors: string[]; message?: string } | null>(null);

	// Modal state
	let showModal = $state(false);
	let editingEntry = $state<TimeEntry | null>(null);
	let formData = $state({
		entryDate: '',
		hours: 0,
		minutes: 0,
		activity: '',
		description: '',
		who: ''
	});

	let initialized = $state(false);

	$effect(() => {
		loadEntries().then(() => { initialized = true; });
	});

	// Reload when date filters change
	$effect(() => {
		// Track dependencies
		startDate;
		endDate;
		filterWho;

		if (initialized) {
			loadEntries();
		}
	});

	async function loadEntries() {
		try {
			loading = true;
			error = '';

			const params: any = {};
			if (startDate) params.startDate = new Date(startDate);
			if (endDate) params.endDate = new Date(endDate);
			if (filterWho) params.who = filterWho;

			entries = await timeEntriesAPI.list(params);
		} catch (e) {
			console.error('Error loading time entries:', e);
			error = e instanceof Error ? e.message : 'Failed to load time entries';
		} finally {
			loading = false;
		}
	}

	function getLocalDateString(): string {
		const now = new Date();
		const year = now.getFullYear();
		const month = String(now.getMonth() + 1).padStart(2, '0');
		const day = String(now.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	function openModal() {
		formData = {
			entryDate: getLocalDateString(),
			hours: 0,
			minutes: 0,
			activity: '',
			description: '',
			who: ''
		};
		editingEntry = null;
		showModal = true;
	}

	function openEditModal(entry: TimeEntry) {
		formData = {
			entryDate: new Date(entry.entryDate).toISOString().split('T')[0],
			hours: entry.hours,
			minutes: entry.minutes,
			activity: entry.activity,
			description: entry.description || '',
			who: entry.who
		};
		editingEntry = entry;
		showModal = true;
	}

	function closeModal() {
		showModal = false;
		editingEntry = null;
	}

	async function handleSubmit() {
		try {
			error = '';

			const data = {
				entryDate: new Date(formData.entryDate),
				hours: formData.hours,
				minutes: formData.minutes,
				activity: formData.activity,
				description: formData.description || undefined,
				who: formData.who
			};

			if (editingEntry) {
				await timeEntriesAPI.update(editingEntry.id, data);
			} else {
				await timeEntriesAPI.create(data);
			}

			await loadEntries();
			closeModal();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save time entry';
		}
	}

	async function handleDelete(id: number) {
		if (!confirm('Are you sure you want to delete this time entry?')) {
			return;
		}

		try {
			error = '';
			await timeEntriesAPI.delete(id);
			await loadEntries();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to delete time entry';
		}
	}

	function formatDate(date: Date): string {
		const d = new Date(date);
		const year = d.getUTCFullYear();
		const month = String(d.getUTCMonth() + 1).padStart(2, '0');
		const day = String(d.getUTCDate()).padStart(2, '0');
		return `${month}/${day}/${year}`;
	}

	function formatTime(hours: number, minutes: number): string {
		const parts = [];
		if (hours > 0) parts.push(`${hours}h`);
		if (minutes > 0) parts.push(`${minutes}m`);
		return parts.join(' ') || '0m';
	}

	function clearFilters() {
		startDate = '';
		endDate = '';
		filterWho = '';
	}

	async function handleDownloadCSV() {
		try {
			error = '';
			const params: any = {};
			if (startDate) params.startDate = new Date(startDate);
			if (endDate) params.endDate = new Date(endDate);
			if (filterWho) params.who = filterWho;

			await timeEntriesAPI.downloadCSV(params);
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

			const result = await timeEntriesAPI.uploadCSV(file);
			csvUploadResult = result;

			if (result.success > 0) {
				await loadEntries();
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to upload CSV';
		} finally {
			uploadingCSV = false;
		}
	}

	// Get unique "who" values for filter dropdown
	let uniqueWho = $derived(
		[...new Set(entries.map(e => e.who))].sort()
	);

	// Calculate total time from filtered entries
	let totalMinutes = $derived(
		filteredEntries.reduce((sum, e) => sum + e.hours * 60 + e.minutes, 0)
	);

	let totalTimeDisplay = $derived(
		`${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`
	);

	let filteredEntries = $derived(
		searchQuery
			? entries.filter(entry =>
					entry.activity.toLowerCase().includes(searchQuery.toLowerCase()) ||
					entry.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
					entry.who.toLowerCase().includes(searchQuery.toLowerCase())
				)
			: entries
	);
</script>

<div class="max-w-7xl mx-auto">
	<!-- Header -->
	<div class="mb-8">
		<h1 class="text-4xl font-bold mb-2">Time Tracking</h1>
		<p class="text-base-content/70">Track hours and minutes spent on activities</p>
	</div>

	{#if error}
		<div class="alert alert-error mb-6">
			<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
			</svg>
			<span>{error}</span>
		</div>
	{/if}

	<!-- Filters and Actions -->
	<div class="mb-6 space-y-4">
		<!-- Date Range Filters -->
		<div class="flex flex-wrap gap-4 items-end">
			<div class="form-control">
				<label class="label">
					<span class="label-text">Start Date</span>
				</label>
				<input
					type="date"
					class="input input-bordered"
					bind:value={startDate}
				/>
			</div>
			<div class="form-control">
				<label class="label">
					<span class="label-text">End Date</span>
				</label>
				<input
					type="date"
					class="input input-bordered"
					bind:value={endDate}
				/>
			</div>
			{#if startDate || endDate || filterWho}
				<button class="btn btn-ghost" onclick={clearFilters}>
					Clear Filters
				</button>
			{/if}
		</div>

		<!-- Search and Actions -->
		<div class="flex justify-between items-center gap-4 flex-wrap">
			<div class="flex gap-4 items-center">
				<div class="form-control">
					<input
						type="text"
						placeholder="Search entries..."
						class="input input-bordered w-64"
						bind:value={searchQuery}
					/>
				</div>
			</div>
			<div class="flex gap-2 items-center flex-wrap">
				{#if filteredEntries.length > 0}
					<div class="badge badge-lg badge-neutral">
						Total: {totalTimeDisplay}
					</div>
				{/if}
				<button
					class="btn btn-outline"
					onclick={handleDownloadCSV}
					disabled={entries.length === 0}
					title="Download filtered entries as CSV"
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
					+ New Time Entry
				</button>
			</div>
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
					<p>Successfully imported: {csvUploadResult.success} time entries</p>
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

	<!-- Time Entries List -->
	<div class="card bg-base-100 shadow-xl">
		<div class="card-body">
			{#if loading}
				<div class="flex justify-center py-8">
					<span class="loading loading-spinner loading-lg"></span>
				</div>
			{:else if filteredEntries.length === 0}
				<div class="alert alert-info">
					<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
					</svg>
					<span>
						{searchQuery
							? 'No time entries match your search.'
							: 'No time entries yet. Create your first entry to get started.'}
					</span>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="table table-zebra">
						<thead>
							<tr>
								<th>Date</th>
								<th>Who</th>
								<th>Activity</th>
								<th>Description</th>
								<th>Time</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each filteredEntries as entry}
								<tr>
									<td>{formatDate(entry.entryDate)}</td>
									<td><span class="badge badge-outline">{entry.who}</span></td>
									<td class="font-medium">{entry.activity}</td>
									<td class="text-sm text-base-content/70">{entry.description || '-'}</td>
									<td class="font-mono font-bold">{formatTime(entry.hours, entry.minutes)}</td>
									<td>
										<div class="flex gap-2">
											<button class="btn btn-sm btn-ghost" onclick={() => openEditModal(entry)}>
												Edit
											</button>
											<button
												class="btn btn-sm btn-ghost text-error"
												onclick={() => handleDelete(entry.id)}
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

<!-- Time Entry Modal -->
{#if showModal}
	<div class="modal modal-open" onclick={(e) => {
		if (e.target === e.currentTarget) closeModal();
	}}>
		<div class="modal-box max-w-2xl">
			<h3 class="font-bold text-lg mb-4">
				{editingEntry ? 'Edit Time Entry' : 'New Time Entry'}
			</h3>

			<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
				<div class="grid grid-cols-2 gap-4">
					<!-- Date -->
					<div class="form-control">
						<label class="label">
							<span class="label-text">Date</span>
						</label>
						<input
							type="date"
							class="input input-bordered"
							bind:value={formData.entryDate}
							required
						/>
					</div>

					<!-- Who -->
					<div class="form-control">
						<label class="label">
							<span class="label-text">Who</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.who}
							required
							placeholder="Person name"
						/>
					</div>

					<!-- Hours -->
					<div class="form-control">
						<label class="label">
							<span class="label-text">Hours</span>
						</label>
						<input
							type="number"
							min="0"
							max="23"
							class="input input-bordered"
							bind:value={formData.hours}
						/>
					</div>

					<!-- Minutes -->
					<div class="form-control">
						<label class="label">
							<span class="label-text">Minutes</span>
						</label>
						<input
							type="number"
							min="0"
							max="59"
							class="input input-bordered"
							bind:value={formData.minutes}
						/>
					</div>

					<!-- Activity -->
					<div class="form-control col-span-2">
						<label class="label">
							<span class="label-text">Activity</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.activity}
							required
							placeholder="e.g., Cleaning, Maintenance, Gardening"
						/>
					</div>

					<!-- Description -->
					<div class="form-control col-span-2">
						<label class="label">
							<span class="label-text">Description (Optional)</span>
						</label>
						<textarea
							class="textarea textarea-bordered"
							bind:value={formData.description}
							rows="3"
							placeholder="Additional details about the work done"
						></textarea>
					</div>
				</div>

				<div class="modal-action">
					<button type="button" class="btn" onclick={closeModal}>Cancel</button>
					<button type="submit" class="btn btn-primary">
						{editingEntry ? 'Save Changes' : 'Create Entry'}
					</button>
				</div>
			</form>
		</div>
		<div class="modal-backdrop" onclick={closeModal}></div>
	</div>
{/if}
