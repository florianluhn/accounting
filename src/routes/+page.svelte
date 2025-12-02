<script lang="ts">
	import {
		reportsAPI,
		journalEntriesAPI,
		subledgerAccountsAPI,
		currenciesAPI,
		attachmentsAPI,
		type BalanceSheetReport,
		type JournalEntry,
		type SubledgerAccount,
		type Currency
	} from '$lib/api';

	let balanceSheet = $state<BalanceSheetReport | null>(null);
	let journalEntries = $state<JournalEntry[]>([]);
	let subledgerAccounts = $state<SubledgerAccount[]>([]);
	let currencies = $state<Currency[]>([]);
	let loading = $state(true);
	let error = $state('');
	let selectedCurrency = $state('USD');

	// Modal state for new journal entry
	let showModal = $state(false);
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

	// Search state for account dropdowns
	let debitAccountSearch = $state('');
	let creditAccountSearch = $state('');
	let showDebitDropdown = $state(false);
	let showCreditDropdown = $state(false);

	$effect(() => {
		loadData();
	});

	async function loadData() {
		try {
			loading = true;
			error = '';

			// Load currencies first to get default
			currencies = await currenciesAPI.list();
			const defaultCurrency = currencies.find(c => c.isDefault);
			if (defaultCurrency) {
				selectedCurrency = defaultCurrency.code;
			}

			// Load balance sheet, journal entries, and subledger accounts in parallel
			await Promise.all([
				loadBalanceSheet(),
				loadJournalEntries(),
				loadSubledgerAccounts()
			]);
		} catch (e) {
			console.error('Error loading dashboard data:', e);
			error = e instanceof Error ? e.message : 'Failed to load dashboard data';
		} finally {
			loading = false;
		}
	}

	async function loadBalanceSheet() {
		try {
			balanceSheet = await reportsAPI.balanceSheet({
				endDate: new Date(),
				currencyCode: selectedCurrency
			});
		} catch (e) {
			console.error('Error loading balance sheet:', e);
		}
	}

	async function loadJournalEntries() {
		try {
			// Get entries from the start of this month
			const now = new Date();
			const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

			journalEntries = await journalEntriesAPI.list({
				startDate: startOfMonth,
				endDate: now
			});
		} catch (e) {
			console.error('Error loading journal entries:', e);
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

	function formatCurrency(amount: number): string {
		const currency = currencies.find(c => c.code === selectedCurrency);
		return `${currency?.symbol || selectedCurrency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	async function handleCurrencyChange() {
		await loadBalanceSheet();
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
		selectedFiles = [];
		debitAccountSearch = getAccountDisplay(defaultDebitId);
		creditAccountSearch = getAccountDisplay(defaultCreditId);
		showDebitDropdown = false;
		showCreditDropdown = false;
		showModal = true;
	}

	function closeModal() {
		showModal = false;
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

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return bytes + ' B';
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
		return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
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

			const createdEntry = await journalEntriesAPI.create(data);

			// Upload attachments if any
			if (selectedFiles.length > 0) {
				uploadingFiles = true;
				try {
					await Promise.all(
						selectedFiles.map(file => attachmentsAPI.upload(createdEntry.id, file))
					);
				} catch (uploadError) {
					console.error('Error uploading attachments:', uploadError);
					error = uploadError instanceof Error ? uploadError.message : 'Failed to upload attachments';
				} finally {
					uploadingFiles = false;
				}
			}

			await loadJournalEntries();
			closeModal();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save journal entry';
		}
	}

	function getAccountName(id: number): string {
		const account = subledgerAccounts.find(a => a.id === id);
		return account ? `${account.accountNumber} - ${account.name}` : 'Unknown';
	}

	let totalAssets = $derived(balanceSheet?.assets.total || 0);
	let totalLiabilities = $derived(balanceSheet?.liabilities.total || 0);
	let totalEquity = $derived(balanceSheet?.equity.total || 0);
	let journalEntriesCount = $derived(journalEntries.length);
</script>

<div class="max-w-7xl mx-auto">
	<!-- Header -->
	<div class="mb-8">
		<div class="flex justify-between items-center">
			<div>
				<h1 class="text-4xl font-bold mb-2">Dashboard</h1>
				<p class="text-base-content/70">Overview of your financial accounts</p>
			</div>
			{#if currencies.length > 1}
				<div class="form-control">
					<label class="label">
						<span class="label-text">Currency</span>
					</label>
					<select
						class="select select-bordered"
						bind:value={selectedCurrency}
						onchange={handleCurrencyChange}
					>
						{#each currencies as currency}
							<option value={currency.code}>
								{currency.code} - {currency.name}
							</option>
						{/each}
					</select>
				</div>
			{/if}
		</div>
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

	<!-- New Journal Entry Button -->
	<div class="card bg-base-100 shadow-xl mb-6">
		<div class="card-body">
			<h2 class="card-title text-2xl">Quick Actions</h2>
			<p class="text-base-content/80 mb-4">
				Create a new journal entry to record your transactions.
			</p>

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
					<span>You must create at least 2 subledger accounts before recording journal entries. Visit the <a href="/accounts" class="link">Accounts</a> page to get started.</span>
				</div>
			{:else}
				<button
					class="btn btn-primary btn-lg"
					onclick={() => openModal()}
				>
					+ New Journal Entry
				</button>
			{/if}
		</div>
	</div>

	<!-- Quick Stats -->
	{#if loading}
		<div class="flex justify-center py-8">
			<span class="loading loading-spinner loading-lg"></span>
		</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
			<div class="stat bg-base-100 shadow rounded-lg">
				<div class="stat-title">Total Assets</div>
				<div class="stat-value text-primary">{formatCurrency(totalAssets)}</div>
				<div class="stat-desc">
					{#if balanceSheet?.assets.accounts.length}
						{balanceSheet.assets.accounts.length} account{balanceSheet.assets.accounts.length !== 1 ? 's' : ''}
					{:else}
						No asset accounts yet
					{/if}
				</div>
			</div>

			<div class="stat bg-base-100 shadow rounded-lg">
				<div class="stat-title">Total Liabilities</div>
				<div class="stat-value text-secondary">{formatCurrency(totalLiabilities)}</div>
				<div class="stat-desc">
					{#if balanceSheet?.liabilities.accounts.length}
						{balanceSheet.liabilities.accounts.length} account{balanceSheet.liabilities.accounts.length !== 1 ? 's' : ''}
					{:else}
						No liability accounts yet
					{/if}
				</div>
			</div>

			<div class="stat bg-base-100 shadow rounded-lg">
				<div class="stat-title">Equity</div>
				<div class="stat-value text-accent">{formatCurrency(totalEquity)}</div>
				<div class="stat-desc">
					{#if balanceSheet?.equity.accounts.length}
						{balanceSheet.equity.accounts.length} account{balanceSheet.equity.accounts.length !== 1 ? 's' : ''}
					{:else}
						No equity accounts yet
					{/if}
				</div>
			</div>

			<div class="stat bg-base-100 shadow rounded-lg">
				<div class="stat-title">Journal Entries</div>
				<div class="stat-value">{journalEntriesCount}</div>
				<div class="stat-desc">This month</div>
			</div>
		</div>

		<!-- Balance Sheet Status -->
		{#if balanceSheet}
			<div class="mt-6">
				<div class="card bg-base-100 shadow-xl">
					<div class="card-body">
						<h3 class="card-title">Balance Sheet Status</h3>
						<div class="flex items-center gap-4">
							{#if balanceSheet.balanced}
								<div class="badge badge-success badge-lg">Balanced</div>
								<p class="text-base-content/70">
									Assets ({formatCurrency(totalAssets)}) = Liabilities ({formatCurrency(totalLiabilities)}) + Equity ({formatCurrency(totalEquity)})
								</p>
							{:else}
								<div class="badge badge-error badge-lg">Unbalanced</div>
								<p class="text-base-content/70">
									Your books are not balanced. Please review your accounts and journal entries.
								</p>
							{/if}
						</div>
					</div>
				</div>
			</div>
		{/if}
	{/if}
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
			<h3 class="font-bold text-lg mb-4">New Journal Entry</h3>

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
					<button type="button" class="btn" onclick={() => closeModal()}>Cancel</button>
					<button type="submit" class="btn btn-primary" disabled={uploadingFiles}>
						{#if uploadingFiles}
							<span class="loading loading-spinner loading-sm"></span>
							Uploading...
						{:else}
							Create Entry
						{/if}
					</button>
				</div>
			</form>
		</div>
		<div class="modal-backdrop" onclick={() => closeModal()}></div>
	</div>
{/if}
