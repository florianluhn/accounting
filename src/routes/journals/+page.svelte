<script lang="ts">
	import {
		journalEntriesAPI,
		subledgerAccountsAPI,
		currenciesAPI,
		attachmentsAPI,
		type JournalEntry,
		type SubledgerAccount,
		type Currency,
		type Attachment
	} from '$lib/api';

	let entries = $state<JournalEntry[]>([]);
	let subledgerAccounts = $state<SubledgerAccount[]>([]);
	let currencies = $state<Currency[]>([]);
	let entryAttachments = $state<Map<number, Attachment[]>>(new Map());
	let loading = $state(true);
	let error = $state('');
	let searchQuery = $state('');
	let startDate = $state('');
	let endDate = $state('');

	// Modal state
	let showModal = $state(false);
	let editingEntry = $state<JournalEntry | null>(null);
	let formData = $state({
		entryDate: new Date().toISOString().split('T')[0],
		amount: '',
		currencyCode: 'USD',
		debitAccountId: 0,
		creditAccountId: 0,
		description: '',
		category: '',
		comment: ''
	});
	let selectedFiles = $state<File[]>([]);
	let uploadingFiles = $state(false);
	let uploadingCSV = $state(false);
	let csvUploadResult = $state<{ success: number; failed: number; errors: string[] } | null>(null);

	// Search state for account dropdowns
	let debitAccountSearch = $state('');
	let creditAccountSearch = $state('');
	let showDebitDropdown = $state(false);
	let showCreditDropdown = $state(false);

	$effect(() => {
		loadData();
	});

	// Reload entries when date filters change
	$effect(() => {
		// Track dependencies
		startDate;
		endDate;

		// Only reload if we've already loaded data initially
		if (subledgerAccounts.length > 0) {
			loadEntries();
		}
	});

	async function loadData() {
		await Promise.all([
			loadEntries(),
			loadSubledgerAccounts(),
			loadCurrencies()
		]);
	}

	async function loadEntries() {
		try {
			loading = true;
			error = '';

			const params: any = {};
			if (startDate) params.startDate = new Date(startDate);
			if (endDate) params.endDate = new Date(endDate);

			entries = await journalEntriesAPI.list(params);

			// Load attachments for all entries
			await loadAttachments();
		} catch (e) {
			console.error('Error loading journal entries:', e);
			error = e instanceof Error ? e.message : 'Failed to load journal entries';
		} finally {
			loading = false;
		}
	}

	async function loadAttachments() {
		try {
			const attachmentsMap = new Map<number, Attachment[]>();

			// Load attachments for each entry
			await Promise.all(
				entries.map(async (entry) => {
					const attachments = await attachmentsAPI.list({ journalEntryId: entry.id });
					if (attachments.length > 0) {
						attachmentsMap.set(entry.id, attachments);
					}
				})
			);

			entryAttachments = attachmentsMap;
		} catch (e) {
			console.error('Error loading attachments:', e);
		}
	}

	async function loadSubledgerAccounts() {
		try {
			const accounts = await subledgerAccountsAPI.list();
			// Sort by account number (numeric sort: 1001, 1002, 1010 not 1001, 1010, 1002)
			subledgerAccounts = accounts.sort((a, b) =>
				a.accountNumber.localeCompare(b.accountNumber, undefined, { numeric: true })
			);
		} catch (e) {
			console.error('Error loading subledger accounts:', e);
		}
	}

	async function loadCurrencies() {
		try {
			currencies = await currenciesAPI.list();
		} catch (e) {
			console.error('Error loading currencies:', e);
		}
	}

	// Filter accounts based on search query (searches both account number and name)
	function filterAccounts(search: string): SubledgerAccount[] {
		if (!search.trim()) return subledgerAccounts;

		const searchLower = search.toLowerCase();
		return subledgerAccounts.filter(account =>
			account.accountNumber.toLowerCase().includes(searchLower) ||
			account.name.toLowerCase().includes(searchLower)
		);
	}

	// Get account display text
	function getAccountDisplay(accountId: number): string {
		const account = subledgerAccounts.find(a => a.id === accountId);
		return account ? `${account.accountNumber} - ${account.name}` : '';
	}

	// Select debit account
	function selectDebitAccount(account: SubledgerAccount) {
		formData.debitAccountId = account.id;
		debitAccountSearch = getAccountDisplay(account.id);
		showDebitDropdown = false;
	}

	// Select credit account
	function selectCreditAccount(account: SubledgerAccount) {
		formData.creditAccountId = account.id;
		creditAccountSearch = getAccountDisplay(account.id);
		showCreditDropdown = false;
	}

	// Get local date in YYYY-MM-DD format (without timezone conversion)
	function getLocalDateString(): string {
		const now = new Date();
		const year = now.getFullYear();
		const month = String(now.getMonth() + 1).padStart(2, '0');
		const day = String(now.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	function openModal() {
		const defaultDebitId = subledgerAccounts.length > 0 ? subledgerAccounts[0].id : 0;
		const defaultCreditId = subledgerAccounts.length > 1 ? subledgerAccounts[1].id : 0;

		formData = {
			entryDate: getLocalDateString(),
			amount: '',
			currencyCode: currencies.find(c => c.isDefault)?.code || 'USD',
			debitAccountId: defaultDebitId,
			creditAccountId: defaultCreditId,
			description: '',
			category: '',
			comment: ''
		};
		editingEntry = null;
		selectedFiles = [];
		debitAccountSearch = getAccountDisplay(defaultDebitId);
		creditAccountSearch = getAccountDisplay(defaultCreditId);
		showDebitDropdown = false;
		showCreditDropdown = false;
		showModal = true;
	}

	function openEditModal(entry: JournalEntry) {
		formData = {
			entryDate: new Date(entry.entryDate).toISOString().split('T')[0],
			amount: entry.amount.toString(),
			currencyCode: entry.currencyCode,
			debitAccountId: entry.debitAccountId,
			creditAccountId: entry.creditAccountId,
			description: entry.description,
			category: entry.category || '',
			comment: entry.comment || ''
		};
		editingEntry = entry;
		debitAccountSearch = getAccountDisplay(entry.debitAccountId);
		creditAccountSearch = getAccountDisplay(entry.creditAccountId);
		showDebitDropdown = false;
		showCreditDropdown = false;
		showModal = true;
	}

	function closeModal() {
		showModal = false;
		editingEntry = null;
		selectedFiles = [];
	}

	function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		if (input.files) {
			selectedFiles = Array.from(input.files);
		}
	}

	function removeFile(index: number) {
		selectedFiles = selectedFiles.filter((_, i) => i !== index);
	}

	async function handleSubmit() {
		try {
			error = '';

			// Validate that valid accounts are selected
			if (!formData.debitAccountId || formData.debitAccountId === 0) {
				error = 'Please select a valid debit account';
				return;
			}
			if (!formData.creditAccountId || formData.creditAccountId === 0) {
				error = 'Please select a valid credit account';
				return;
			}

			const data = {
				entryDate: new Date(formData.entryDate),
				amount: parseFloat(formData.amount),
				currencyCode: formData.currencyCode,
				debitAccountId: formData.debitAccountId,
				creditAccountId: formData.creditAccountId,
				description: formData.description,
				category: formData.category || undefined,
				comment: formData.comment || undefined
			};

			let entryId: number;

			if (editingEntry) {
				await journalEntriesAPI.update(editingEntry.id, data);
				entryId = editingEntry.id;
			} else {
				const createdEntry = await journalEntriesAPI.create(data);
				entryId = createdEntry.id;
			}

			// Upload attachments if any
			if (selectedFiles.length > 0) {
				uploadingFiles = true;
				try {
					await Promise.all(
						selectedFiles.map(file => attachmentsAPI.upload(entryId, file))
					);
				} catch (uploadError) {
					console.error('Error uploading attachments:', uploadError);
					error = uploadError instanceof Error ? uploadError.message : 'Failed to upload attachments';
				} finally {
					uploadingFiles = false;
				}
			}

			await loadEntries();
			closeModal();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save journal entry';
		}
	}

	async function handleDelete(id: number) {
		if (!confirm('Are you sure you want to delete this journal entry?')) {
			return;
		}

		try {
			error = '';
			await journalEntriesAPI.delete(id);
			await loadEntries();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to delete journal entry';
		}
	}

	async function handleDeleteAttachment(attachmentId: number, entryId: number) {
		if (!confirm('Are you sure you want to delete this attachment?')) {
			return;
		}

		try {
			error = '';
			await attachmentsAPI.delete(attachmentId);

			// Reload attachments for this entry
			const attachments = await attachmentsAPI.list({ journalEntryId: entryId });
			const newMap = new Map(entryAttachments);
			if (attachments.length > 0) {
				newMap.set(entryId, attachments);
			} else {
				newMap.delete(entryId);
			}
			entryAttachments = newMap;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to delete attachment';
		}
	}

	function clearFilters() {
		startDate = '';
		endDate = '';
	}

	async function handleDownloadCSV() {
		try {
			error = '';
			const params: any = {};
			if (startDate) params.startDate = new Date(startDate);
			if (endDate) params.endDate = new Date(endDate);

			await journalEntriesAPI.downloadCSV(params);
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

			const result = await journalEntriesAPI.uploadCSV(file);
			csvUploadResult = result;

			// Reload entries if any were successfully imported
			if (result.success > 0) {
				await loadEntries();
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to upload CSV';
		} finally {
			uploadingCSV = false;
		}
	}

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return bytes + ' B';
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
		return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
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
		return `${currency?.symbol || currencyCode} ${amount.toFixed(2)}`;
	}

	// Filter entries based on search query
	let filteredEntries = $derived(
		searchQuery
			? entries.filter(entry =>
					entry.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
					entry.category?.toLowerCase().includes(searchQuery.toLowerCase()) ||
					getAccountName(entry.debitAccountId).toLowerCase().includes(searchQuery.toLowerCase()) ||
					getAccountName(entry.creditAccountId).toLowerCase().includes(searchQuery.toLowerCase())
				)
			: entries
	);
</script>

<div class="max-w-7xl mx-auto">
	<!-- Header -->
	<div class="mb-8">
		<h1 class="text-4xl font-bold mb-2">Journal Entries</h1>
		<p class="text-base-content/70">Record double-entry transactions</p>
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
			{#if startDate || endDate}
				<button class="btn btn-ghost" onclick={clearFilters}>
					Clear Filters
				</button>
			{/if}
		</div>

		<!-- Search and Actions -->
		<div class="flex justify-between items-center gap-4 flex-wrap">
			<div class="form-control">
				<input
					type="text"
					placeholder="Search entries..."
					class="input input-bordered w-64"
					bind:value={searchQuery}
				/>
			</div>
			<div class="flex gap-2 flex-wrap">
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
				<button
					class="btn btn-primary"
					onclick={() => openModal()}
					disabled={subledgerAccounts.length < 2}
				>
					+ New Journal Entry
				</button>
			</div>
		</div>

		<!-- CSV Upload Result -->
		{#if csvUploadResult}
			<div class="alert {csvUploadResult.failed === 0 ? 'alert-success' : 'alert-warning'}">
				<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				<div>
					<h3 class="font-bold">CSV Upload Complete</h3>
					<div class="text-sm">
						<p>Successfully imported: {csvUploadResult.success} entries</p>
						{#if csvUploadResult.failed > 0}
							<p>Failed: {csvUploadResult.failed} entries</p>
							<details class="mt-2">
								<summary class="cursor-pointer font-medium">Show errors</summary>
								<ul class="list-disc list-inside mt-1 space-y-1">
									{#each csvUploadResult.errors as error}
										<li class="text-xs">{error}</li>
									{/each}
								</ul>
							</details>
						{/if}
					</div>
				</div>
				<button class="btn btn-sm btn-ghost" onclick={() => csvUploadResult = null}>
					Dismiss
				</button>
			</div>
		{/if}
	</div>

	<!-- Journal Entries List -->
	<div class="card bg-base-100 shadow-xl">
		<div class="card-body">
			{#if subledgerAccounts.length < 2}
				<div class="alert alert-warning">
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
							d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
						/>
					</svg>
					<span>You must create at least 2 subledger accounts before recording journal entries.</span>
				</div>
			{:else if loading}
				<div class="flex justify-center py-8">
					<span class="loading loading-spinner loading-lg"></span>
				</div>
			{:else if filteredEntries.length === 0}
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
					<span>
						{searchQuery
							? 'No journal entries match your search.'
							: 'No journal entries yet. Create your first transaction to get started.'}
					</span>
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
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each filteredEntries as entry}
								<tr>
									<td>{formatDate(entry.entryDate)}</td>
									<td>
										<div class="font-medium">{entry.description}</div>
										{#if entry.comment}
											<div class="text-sm text-base-content/70">{entry.comment}</div>
										{/if}
										{#if entryAttachments.get(entry.id)?.length}
											<div class="mt-2 flex flex-wrap gap-2">
												{#each entryAttachments.get(entry.id) || [] as attachment}
													<div class="flex items-center gap-1 bg-base-200 px-2 py-1 rounded text-xs">
														<svg
															xmlns="http://www.w3.org/2000/svg"
															class="h-3 w-3"
															fill="none"
															viewBox="0 0 24 24"
															stroke="currentColor"
														>
															<path
																stroke-linecap="round"
																stroke-linejoin="round"
																stroke-width="2"
																d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
															/>
														</svg>
														<a
															href={attachmentsAPI.getDownloadUrl(attachment.id)}
															class="link link-hover"
															target="_blank"
														>
															{attachment.filename}
														</a>
														<button
															class="btn btn-ghost btn-xs btn-circle"
															onclick={() => handleDeleteAttachment(attachment.id, entry.id)}
														>
															<svg
																xmlns="http://www.w3.org/2000/svg"
																class="h-3 w-3"
																fill="none"
																viewBox="0 0 24 24"
																stroke="currentColor"
															>
																<path
																	stroke-linecap="round"
																	stroke-linejoin="round"
																	stroke-width="2"
																	d="M6 18L18 6M6 6l12 12"
																/>
															</svg>
														</button>
													</div>
												{/each}
											</div>
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

<!-- Journal Entry Modal -->
{#if showModal}
	<div class="modal modal-open" onclick={(e) => {
		if (e.target === e.currentTarget) closeModal();
	}}>
		<div class="modal-box max-w-2xl" onclick={(e) => {
			// Close dropdowns when clicking anywhere in the modal box
			const target = e.target as HTMLElement;
			if (!target.closest('.relative')) {
				showDebitDropdown = false;
				showCreditDropdown = false;
			}
		}}>
			<h3 class="font-bold text-lg mb-4">
				{editingEntry ? 'Edit Journal Entry' : 'New Journal Entry'}
			</h3>

			<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
				<div class="grid grid-cols-2 gap-4">
					<!-- Entry Date -->
					<div class="form-control">
						<label class="label">
							<span class="label-text">Entry Date</span>
						</label>
						<input
							type="date"
							class="input input-bordered"
							bind:value={formData.entryDate}
							required
						/>
					</div>

					<!-- Currency -->
					<div class="form-control">
						<label class="label">
							<span class="label-text">Currency</span>
						</label>
						<select class="select select-bordered" bind:value={formData.currencyCode} required>
							{#each currencies as currency}
								<option value={currency.code}>
									{currency.code} - {currency.name} ({currency.symbol})
								</option>
							{/each}
						</select>
					</div>

					<!-- Debit Account -->
					<div class="form-control col-span-2 relative">
						<label class="label">
							<span class="label-text">Debit Account</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={debitAccountSearch}
							onfocus={() => {
								debitAccountSearch = '';
								showDebitDropdown = true;
							}}
							oninput={() => showDebitDropdown = true}
							placeholder="Search by account number or name..."
							required
						/>
						{#if showDebitDropdown && filterAccounts(debitAccountSearch).length > 0}
							<div class="absolute z-10 w-full bg-base-100 shadow-lg rounded-box mt-1 max-h-60 overflow-y-auto border border-base-300" style="top: 100%">
								{#each filterAccounts(debitAccountSearch) as account}
									<button
										type="button"
										class="w-full text-left px-4 py-2 hover:bg-base-200 cursor-pointer"
										onclick={() => selectDebitAccount(account)}
									>
										{account.accountNumber} - {account.name} ({account.currencyCode})
									</button>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Credit Account -->
					<div class="form-control col-span-2 relative">
						<label class="label">
							<span class="label-text">Credit Account</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={creditAccountSearch}
							onfocus={() => {
								creditAccountSearch = '';
								showCreditDropdown = true;
							}}
							oninput={() => showCreditDropdown = true}
							placeholder="Search by account number or name..."
							required
						/>
						{#if showCreditDropdown && filterAccounts(creditAccountSearch).length > 0}
							<div class="absolute z-10 w-full bg-base-100 shadow-lg rounded-box mt-1 max-h-60 overflow-y-auto border border-base-300" style="top: 100%">
								{#each filterAccounts(creditAccountSearch) as account}
									<button
										type="button"
										class="w-full text-left px-4 py-2 hover:bg-base-200 cursor-pointer"
										onclick={() => selectCreditAccount(account)}
									>
										{account.accountNumber} - {account.name} ({account.currencyCode})
									</button>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Amount -->
					<div class="form-control col-span-2">
						<label class="label">
							<span class="label-text">Amount</span>
						</label>
						<input
							type="number"
							step="0.01"
							min="0.01"
							class="input input-bordered"
							bind:value={formData.amount}
							required
							placeholder="0.00"
						/>
					</div>

					<!-- Description -->
					<div class="form-control col-span-2">
						<label class="label">
							<span class="label-text">Description</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.description}
							required
							placeholder="Transaction description"
						/>
					</div>

					<!-- Category -->
					<div class="form-control col-span-2">
						<label class="label">
							<span class="label-text">Category (Optional)</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							bind:value={formData.category}
							placeholder="e.g., Utilities, Salary, Sales"
						/>
					</div>

					<!-- Comment -->
					<div class="form-control col-span-2">
						<label class="label">
							<span class="label-text">Comment (Optional)</span>
						</label>
						<textarea
							class="textarea textarea-bordered"
							bind:value={formData.comment}
							rows="2"
							placeholder="Additional notes"
						></textarea>
					</div>

					<!-- File Attachments -->
					<div class="form-control col-span-2">
						<label class="label">
							<span class="label-text">Attachments (Optional)</span>
						</label>
						<input
							type="file"
							class="file-input file-input-bordered w-full"
							multiple
							onchange={handleFileSelect}
						/>
						<label class="label">
							<span class="label-text-alt">Upload receipts, invoices, or other documents (max 10MB per file)</span>
						</label>

						{#if selectedFiles.length > 0}
							<div class="mt-2 space-y-2">
								{#each selectedFiles as file, index}
									<div class="flex items-center justify-between bg-base-200 p-2 rounded">
										<div class="flex items-center gap-2">
											<svg
												xmlns="http://www.w3.org/2000/svg"
												class="h-5 w-5"
												fill="none"
												viewBox="0 0 24 24"
												stroke="currentColor"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
												/>
											</svg>
											<span class="text-sm">{file.name} ({formatFileSize(file.size)})</span>
										</div>
										<button
											type="button"
											class="btn btn-ghost btn-sm btn-circle"
											onclick={() => removeFile(index)}
										>
											<svg
												xmlns="http://www.w3.org/2000/svg"
												class="h-4 w-4"
												fill="none"
												viewBox="0 0 24 24"
												stroke="currentColor"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M6 18L18 6M6 6l12 12"
												/>
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
							{editingEntry ? 'Save Changes' : 'Create Entry'}
						{/if}
					</button>
				</div>
			</form>
		</div>
		<div class="modal-backdrop" onclick={closeModal}></div>
	</div>
{/if}
