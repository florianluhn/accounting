<script lang="ts">
	import {
		journalEntriesAPI,
		subledgerAccountsAPI,
		currenciesAPI,
		attachmentsAPI,
		vendorsAPI,
		customersAPI,
		inventoryAPI,
		fixedAssetsAPI,
		investmentsAPI,
		type JournalEntry,
		type SubledgerAccount,
		type Currency,
		type Attachment,
		type Vendor,
		type Customer,
		type InventoryItem,
		type FixedAsset,
		type Investment
	} from '$lib/api';
	import { modules } from '$lib/modules.svelte';

	let entries = $state<JournalEntry[]>([]);
	let subledgerAccounts = $state<SubledgerAccount[]>([]);
	let currencies = $state<Currency[]>([]);
	let vendors = $state<Vendor[]>([]);
	let customers = $state<Customer[]>([]);
	let finishedGoodItems = $state<(InventoryItem & { categoryName: string })[]>([]);
	let fixedAssets = $state<FixedAsset[]>([]);
	let investments = $state<Investment[]>([]);
	let entryAttachments = $state<Map<number, Attachment[]>>(new Map());
	let loading = $state(true);
	let error = $state('');
	let searchQuery = $state('');
	let startDate = $state('');
	let endDate = $state('');
	/** When true, only journal entries without a category are shown */
	let uncategorizedOnly = $state(false);

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
		comment: '',
		checkReference: '',
		vendorId: 0,
		customerId: 0,
		inventoryItemId: 0,
		inventoryLinkType: '' as '' | 'sale' | 'own_use' | 'gift',
		fixedAssetId: 0,
		investmentId: 0,
		investmentQuantity: ''
	});
	let selectedFiles = $state<File[]>([]);
	let extraAmounts = $state<string[]>([]);
	let uploadingFiles = $state(false);
	let uploadingCSV = $state(false);
	let csvUploadResult = $state<{ success: number; failed: number; errors: string[]; message?: string } | null>(null);

	// Mass change (bulk update) modal
	let showBulkModal = $state(false);
	let bulkField = $state<'category' | 'description' | 'copy_description_to_category'>('category');
	let bulkMatchValue = $state('');
	let bulkNewValue = $state('');
	let bulkUseDateFilters = $state(true);
	let bulkPreviewing = $state(false);
	let bulkApplying = $state(false);
	let bulkError = $state('');
	let bulkResult = $state<{
		preview: boolean;
		count: number;
		updated?: number;
		sample?: Array<{
			id: number;
			entryDate: Date;
			description: string;
			category?: string | null;
			categoryAfter?: string;
			descriptionAfter?: string;
			amount: number;
			currencyCode: string;
		}>;
	} | null>(null);
	let bulkMeta = $state<{ categories: string[]; descriptions: string[] }>({ categories: [], descriptions: [] });
	let isCopyMode = $derived(bulkField === 'copy_description_to_category');

	// Row selection for selection-based mass change
	let selectedIds = $state<Set<number>>(new Set());
	let showSelectionModal = $state(false);
	let selectionApplying = $state(false);
	let selectionError = $state('');
	let selectionSuccess = $state('');
	// Which fields to apply to selected rows
	let selApply = $state({
		description: false,
		category: false,
		comment: false,
		debitAccountId: false,
		creditAccountId: false,
		vendorId: false,
		customerId: false,
		currencyCode: false,
		entryDate: false
	});
	let selValues = $state({
		description: '',
		category: '',
		comment: '',
		debitAccountId: 0,
		creditAccountId: 0,
		vendorId: 0 as number | null,
		customerId: 0 as number | null,
		currencyCode: 'USD',
		entryDate: new Date().toISOString().split('T')[0]
	});

	// Search state for account dropdowns
	let debitAccountSearch = $state('');
	let creditAccountSearch = $state('');
	let showDebitDropdown = $state(false);
	let showCreditDropdown = $state(false);

	$effect(() => {
		loadData();
	});

	// Reload entries when date / category filters change
	$effect(() => {
		// Track dependencies
		startDate;
		endDate;
		uncategorizedOnly;

		// Only reload if we've already loaded data initially
		if (subledgerAccounts.length > 0) {
			loadEntries();
		}
	});

	async function loadData() {
		await Promise.all([
			loadEntries(),
			loadSubledgerAccounts(),
			loadCurrencies(),
			loadVendors(),
			loadCustomers(),
			loadFinishedGoodItems(),
			loadFixedAssets(),
			loadInvestments()
		]);
	}

	async function loadCustomers() {
		try {
			customers = await customersAPI.list();
			customers.sort((a, b) => a.lastName.localeCompare(b.lastName));
		} catch (e) {
			// non-critical
		}
	}

	async function loadFixedAssets() {
		try {
			if (modules.fixedAssets) {
				fixedAssets = await fixedAssetsAPI.list();
			}
		} catch (e) {
			// non-critical
		}
	}

	async function loadInvestments() {
		try {
			if (modules.investments) {
				investments = await investmentsAPI.list();
			}
		} catch (e) {
			// non-critical
		}
	}

	async function loadFinishedGoodItems() {
		try {
			const categories = await inventoryAPI.listCategories();
			const fgCategories = categories.filter(c => c.categoryType === 'finished_good');
			const itemsPerCat = await Promise.all(
				fgCategories.map(async c => {
					const items = await inventoryAPI.listItems(c.id);
					return items.map(i => ({ ...i, categoryName: c.name }));
				})
			);
			finishedGoodItems = itemsPerCat.flat();
		} catch (e) {
			// non-critical — don't block the page
		}
	}

	async function loadEntries() {
		try {
			loading = true;
			error = '';

			const params: Parameters<typeof journalEntriesAPI.list>[0] = {};
			if (startDate) params.startDate = new Date(startDate);
			if (endDate) params.endDate = new Date(endDate);
			if (uncategorizedOnly) params.uncategorized = true;

			entries = await journalEntriesAPI.list(params);
			// Drop selections that no longer exist in the loaded set
			const valid = new Set(entries.map((e) => e.id));
			selectedIds = new Set([...selectedIds].filter((id) => valid.has(id)));

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

	async function loadVendors() {
		try {
			vendors = await vendorsAPI.list();
		} catch (e) {
			console.error('Error loading vendors:', e);
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
		// Auto-set currency to match the selected account's currency
		if (account.currencyCode) {
			formData.currencyCode = account.currencyCode;
		}
	}

	// Select credit account
	function selectCreditAccount(account: SubledgerAccount) {
		formData.creditAccountId = account.id;
		creditAccountSearch = getAccountDisplay(account.id);
		showCreditDropdown = false;
		// Auto-set currency to match the selected account's currency (if debit not already set)
		if (account.currencyCode && !formData.debitAccountId) {
			formData.currencyCode = account.currencyCode;
		}
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
			comment: '',
			checkReference: '',
			vendorId: 0,
			customerId: 0,
			inventoryItemId: 0,
			inventoryLinkType: '' as '' | 'sale' | 'own_use' | 'gift',
			fixedAssetId: 0,
			investmentId: 0,
			investmentQuantity: ''
		};
		editingEntry = null;
		selectedFiles = [];
		extraAmounts = [];
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
			comment: entry.comment || '',
			checkReference: entry.checkReference || '',
			vendorId: entry.vendorId || 0,
			customerId: entry.customerId || 0,
			inventoryItemId: entry.inventoryItemId || 0,
			inventoryLinkType: (entry.inventoryLinkType as '' | 'sale' | 'own_use' | 'gift') || '',
			fixedAssetId: entry.fixedAssetId || 0,
			investmentId: entry.investmentId || 0,
			investmentQuantity:
				entry.investmentQuantity != null ? String(entry.investmentQuantity) : ''
		};
		editingEntry = entry;
		extraAmounts = [];
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

	function addAmount() {
		extraAmounts = [...extraAmounts, ''];
	}

	function removeAmount(index: number) {
		extraAmounts = extraAmounts.filter((_, i) => i !== index);
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

			const baseData = {
				entryDate: new Date(formData.entryDate),
				currencyCode: formData.currencyCode,
				debitAccountId: formData.debitAccountId,
				creditAccountId: formData.creditAccountId,
				description: formData.description,
				category: formData.category || undefined,
				comment: formData.comment || undefined,
				...(modules.checkReferences
					? { checkReference: formData.checkReference.trim() || null }
					: {}),
				vendorId: formData.vendorId || null,
				customerId: formData.customerId || null,
				inventoryItemId: formData.inventoryItemId || null,
				inventoryLinkType: formData.inventoryItemId && formData.inventoryLinkType ? formData.inventoryLinkType : null,
				fixedAssetId: formData.fixedAssetId || null,
				isDepreciation: false, // Always false here, depreciation is posted via fixed assets directly
				investmentId: formData.investmentId || null,
				investmentQuantity: formData.investmentId
					? parseFloat(String(formData.investmentQuantity).trim())
					: null
			};

			if (formData.investmentId) {
				const qty = baseData.investmentQuantity;
				if (qty == null || isNaN(qty) || qty === 0) {
					error = 'Enter a non-zero quantity for the selected investment (buy = positive, sell = negative)';
					return;
				}
			}

			let firstEntryId: number;

			if (editingEntry) {
				await journalEntriesAPI.update(editingEntry.id, { ...baseData, amount: parseFloat(formData.amount) });
				firstEntryId = editingEntry.id;
			} else {
				const allAmounts = [formData.amount, ...extraAmounts]
					.map(a => String(a ?? '').trim())
					.filter(a => a !== '')
					.map(a => parseFloat(a));

				if (allAmounts.length === 0 || allAmounts.some(a => isNaN(a))) {
					error = 'All amounts must be valid numbers';
					return;
				}

				const created = await journalEntriesAPI.create({ ...baseData, amount: allAmounts[0] });
				firstEntryId = created.id;

				// Extra split amounts share accounts/description but not investment quantity
				// (quantity applies once to the primary buy/sell posting).
				const extraBase = {
					...baseData,
					investmentId: null as number | null,
					investmentQuantity: null as number | null
				};
				for (let i = 1; i < allAmounts.length; i++) {
					await journalEntriesAPI.create({ ...extraBase, amount: allAmounts[i] });
				}
			}

			// Upload attachments to the first entry only
			if (selectedFiles.length > 0) {
				uploadingFiles = true;
				try {
					await Promise.all(
						selectedFiles.map(file => attachmentsAPI.upload(firstEntryId, file))
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
		uncategorizedOnly = false;
	}

	async function handleDownloadCSV() {
		try {
			error = '';
			const params: Parameters<typeof journalEntriesAPI.downloadCSV>[0] = {};
			if (startDate) params.startDate = new Date(startDate);
			if (endDate) params.endDate = new Date(endDate);
			if (uncategorizedOnly) params.uncategorized = true;

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

	async function openBulkModal() {
		bulkError = '';
		bulkResult = null;
		bulkField = 'category';
		bulkMatchValue = '';
		bulkNewValue = '';
		bulkUseDateFilters = !!(startDate || endDate);
		showBulkModal = true;
		try {
			bulkMeta = await journalEntriesAPI.metaValues();
		} catch (e) {
			// non-critical — free text still works
			bulkMeta = { categories: [], descriptions: [] };
		}
	}

	function closeBulkModal() {
		showBulkModal = false;
		bulkResult = null;
		bulkError = '';
	}

	function bulkPayload(preview: boolean) {
		const payload: {
			field: 'category' | 'description' | 'copy_description_to_category';
			matchValue: string;
			newValue: string;
			startDate?: Date;
			endDate?: Date;
			preview: boolean;
		} = {
			field: bulkField,
			matchValue: bulkMatchValue,
			newValue: bulkNewValue,
			preview
		};
		if (bulkUseDateFilters) {
			if (startDate) payload.startDate = new Date(startDate);
			if (endDate) payload.endDate = new Date(endDate);
		}
		return payload;
	}

	async function handleBulkPreview() {
		try {
			bulkError = '';
			bulkPreviewing = true;
			bulkResult = null;
			if ((bulkField === 'description' || bulkField === 'copy_description_to_category') && !bulkMatchValue.trim()) {
				bulkError = 'Enter the description to find.';
				return;
			}
			if ((bulkField === 'description' || bulkField === 'copy_description_to_category') && !bulkNewValue.trim()) {
				bulkError = 'New description cannot be empty.';
				return;
			}
			bulkResult = await journalEntriesAPI.bulkUpdate(bulkPayload(true));
		} catch (e) {
			bulkError = e instanceof Error ? e.message : 'Preview failed';
		} finally {
			bulkPreviewing = false;
		}
	}

	async function handleBulkApply() {
		const n = bulkResult?.count ?? '?';
		let msg: string;
		if (bulkField === 'copy_description_to_category') {
			msg =
				`For ${n} entr${n === 1 ? 'y' : 'ies'} with description "${bulkMatchValue}":\n` +
				`• Set category to that description\n` +
				`• Change description to "${bulkNewValue}"\n\n` +
				`This cannot be undone in one click.`;
		} else {
			const label = bulkField === 'category' ? 'category' : 'description';
			const from = bulkMatchValue === '' && bulkField === 'category' ? '(blank)' : `"${bulkMatchValue}"`;
			const to = bulkNewValue === '' && bulkField === 'category' ? '(blank)' : `"${bulkNewValue}"`;
			msg = `Change ${label} from ${from} to ${to} on ${n} journal entr${n === 1 ? 'y' : 'ies'}?\n\nThis cannot be undone in one click.`;
		}
		if (!confirm(msg)) return;
		try {
			bulkError = '';
			bulkApplying = true;
			const result = await journalEntriesAPI.bulkUpdate(bulkPayload(false));
			bulkResult = result;
			await loadEntries();
			try {
				bulkMeta = await journalEntriesAPI.metaValues();
			} catch {
				/* ignore */
			}
		} catch (e) {
			bulkError = e instanceof Error ? e.message : 'Mass change failed';
		} finally {
			bulkApplying = false;
		}
	}

	function getAccountName(id: number): string {
		const account = subledgerAccounts.find(a => a.id === id);
		return account ? `${account.accountNumber} - ${account.name}` : 'Unknown';
	}

	function getVendorName(vendorId: number | null | undefined): string {
		if (!vendorId) return '';
		const vendor = vendors.find(v => v.id === vendorId);
		return vendor ? vendor.name : '';
	}

	function formatDate(date: Date): string {
		const d = new Date(date);
		const year = d.getUTCFullYear();
		const month = String(d.getUTCMonth() + 1).padStart(2, '0');
		const day = String(d.getUTCDate()).padStart(2, '0');
		return `${month}/${day}/${year}`;
	}

	// Helper to check if an account is an Asset account
	function isAssetAccount(accountId: number): boolean {
		if (!accountId) return false;
		const subledger = subledgerAccounts.find(s => s.id === accountId);
		if (!subledger) return false;
		// Check if it starts with '1' (common asset convention) or we could fetch GL account type.
		// Since we don't have the GL account types directly in this component state easily,
		// we can assume '1xxx' accounts are assets, or better yet, just show the dropdown
		// whenever any account is selected but make it optional.
		// Actually, let's just make it available if the module is enabled.
		return true; 
	}

	function formatCurrency(amount: number, currencyCode: string): string {
		const currency = currencies.find(c => c.code === currencyCode);
		return `${currency?.symbol || currencyCode} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	// Detect when debit and credit accounts use different currencies
	let currencyMismatch = $derived.by(() => {
		if (!formData.debitAccountId || !formData.creditAccountId) return null;
		const debit = subledgerAccounts.find(a => a.id === formData.debitAccountId);
		const credit = subledgerAccounts.find(a => a.id === formData.creditAccountId);
		if (!debit || !credit || debit.currencyCode === credit.currencyCode) return null;
		return { debit: debit.currencyCode, credit: credit.currencyCode };
	});

	// Filter entries based on search query
	let filteredEntries = $derived(
		searchQuery
			? entries.filter((entry) => {
					const q = searchQuery.toLowerCase();
					return (
						entry.description.toLowerCase().includes(q) ||
						entry.category?.toLowerCase().includes(q) ||
						entry.checkReference?.toLowerCase().includes(q) ||
						entry.comment?.toLowerCase().includes(q) ||
						getAccountName(entry.debitAccountId).toLowerCase().includes(q) ||
						getAccountName(entry.creditAccountId).toLowerCase().includes(q)
					);
				})
			: entries
	);

	/** Count of loaded entries per check/reference (for linked badges). */
	let checkReferenceCounts = $derived.by(() => {
		const map = new Map<string, number>();
		if (!modules.checkReferences) return map;
		for (const e of entries) {
			const ref = e.checkReference?.trim();
			if (!ref) continue;
			map.set(ref, (map.get(ref) || 0) + 1);
		}
		return map;
	});

	/** Other loaded entries sharing the same check/reference as the form value. */
	let matchingCheckEntries = $derived.by(() => {
		if (!modules.checkReferences) return [] as JournalEntry[];
		const ref = formData.checkReference.trim();
		if (!ref) return [] as JournalEntry[];
		return entries.filter(
			(e) =>
				e.checkReference?.trim() === ref &&
				(!editingEntry || e.id !== editingEntry.id)
		);
	});

	let selectedCount = $derived(selectedIds.size);
	let allFilteredSelected = $derived(
		filteredEntries.length > 0 && filteredEntries.every((e) => selectedIds.has(e.id))
	);

	function toggleSelect(id: number) {
		const next = new Set(selectedIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedIds = next;
	}

	function toggleSelectAllFiltered() {
		const next = new Set(selectedIds);
		if (allFilteredSelected) {
			for (const e of filteredEntries) next.delete(e.id);
		} else {
			for (const e of filteredEntries) next.add(e.id);
		}
		selectedIds = next;
	}

	function clearSelection() {
		selectedIds = new Set();
	}

	function openSelectionModal() {
		if (selectedIds.size === 0) return;
		selectionError = '';
		selectionSuccess = '';
		selApply = {
			description: false,
			category: false,
			comment: false,
			debitAccountId: false,
			creditAccountId: false,
			vendorId: false,
			customerId: false,
			currencyCode: false,
			entryDate: false
		};
		const first = entries.find((e) => selectedIds.has(e.id));
		selValues = {
			description: first?.description ?? '',
			category: first?.category ?? '',
			comment: first?.comment ?? '',
			debitAccountId: first?.debitAccountId ?? 0,
			creditAccountId: first?.creditAccountId ?? 0,
			vendorId: first?.vendorId ?? 0,
			customerId: first?.customerId ?? 0,
			currencyCode: first?.currencyCode ?? currencies.find((c) => c.isDefault)?.code ?? 'USD',
			entryDate: first
				? new Date(first.entryDate).toISOString().split('T')[0]
				: new Date().toISOString().split('T')[0]
		};
		showSelectionModal = true;
	}

	function closeSelectionModal() {
		showSelectionModal = false;
		selectionError = '';
	}

	async function handleSelectionApply() {
		const set: Record<string, unknown> = {};
		if (selApply.description) {
			if (!selValues.description.trim()) {
				selectionError = 'Description cannot be empty.';
				return;
			}
			set.description = selValues.description.trim();
		}
		if (selApply.category) set.category = selValues.category.trim() === '' ? null : selValues.category.trim();
		if (selApply.comment) set.comment = selValues.comment.trim() === '' ? null : selValues.comment.trim();
		if (selApply.debitAccountId) {
			if (!selValues.debitAccountId) {
				selectionError = 'Select a debit account.';
				return;
			}
			set.debitAccountId = selValues.debitAccountId;
		}
		if (selApply.creditAccountId) {
			if (!selValues.creditAccountId) {
				selectionError = 'Select a credit account.';
				return;
			}
			set.creditAccountId = selValues.creditAccountId;
		}
		if (selApply.vendorId) set.vendorId = selValues.vendorId || null;
		if (selApply.customerId) set.customerId = selValues.customerId || null;
		if (selApply.currencyCode) set.currencyCode = selValues.currencyCode;
		if (selApply.entryDate) set.entryDate = new Date(selValues.entryDate);

		if (Object.keys(set).length === 0) {
			selectionError = 'Enable at least one field to change.';
			return;
		}

		const n = selectedIds.size;
		const fields = Object.keys(set).join(', ');
		if (!confirm(`Apply [${fields}] to ${n} selected entr${n === 1 ? 'y' : 'ies'}?\n\nThis cannot be undone in one click.`)) {
			return;
		}

		try {
			selectionError = '';
			selectionApplying = true;
			const result = await journalEntriesAPI.bulkSet({
				ids: [...selectedIds],
				set: set as Parameters<typeof journalEntriesAPI.bulkSet>[0]['set']
			});
			selectionSuccess = `Updated ${result.updated} entr${result.updated === 1 ? 'y' : 'ies'}.`;
			await loadEntries();
			// Keep selection for further edits; clear success after a moment is optional
		} catch (e) {
			selectionError = e instanceof Error ? e.message : 'Failed to update selected entries';
		} finally {
			selectionApplying = false;
		}
	}
</script>

<div class="page-shell">
	<!-- Header -->
	<div class="mb-8">
		<p class="section-label mb-2">Transactions</p>
		<h1 class="page-title">Journal Entries</h1>
		<p class="page-subtitle">Record double-entry transactions</p>
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
			<label class="label cursor-pointer gap-2 items-center pb-3">
				<input
					type="checkbox"
					class="checkbox checkbox-sm checkbox-primary"
					bind:checked={uncategorizedOnly}
				/>
				<span class="label-text font-medium">Without category only</span>
			</label>
			{#if startDate || endDate || uncategorizedOnly}
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
					placeholder={modules.checkReferences
						? 'Search description, category, check/ref, accounts…'
						: 'Search entries...'}
					class="input input-bordered w-64"
					bind:value={searchQuery}
				/>
			</div>
			<div class="flex gap-2 flex-wrap">
				<button
					class="btn btn-outline"
					onclick={openBulkModal}
					title="Change category or description on many entries at once"
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h10m-10 6h16M15 10l4 4m0 0l-4 4m4-4H9" />
					</svg>
					Mass change
				</button>
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
			<div class="alert {csvUploadResult.failed === 0 ? 'alert-success' : csvUploadResult.success === 0 ? 'alert-error' : 'alert-warning'}">
				<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				<div>
					<h3 class="font-bold">{csvUploadResult.success === 0 ? 'CSV Upload Failed' : 'CSV Upload Complete'}</h3>
					<div class="text-sm">
						{#if csvUploadResult.message}
							<p class="font-medium">{csvUploadResult.message}</p>
						{/if}
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

		{#if selectedCount > 0}
			<div class="flex flex-wrap items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3">
				<span class="font-semibold text-sm">
					{selectedCount} selected
				</span>
				<button type="button" class="btn btn-primary btn-sm" onclick={openSelectionModal}>
					Edit selected…
				</button>
				<button type="button" class="btn btn-ghost btn-sm" onclick={clearSelection}>
					Clear selection
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
							: uncategorizedOnly
								? 'No uncategorized journal entries for the current filters.'
								: 'No journal entries yet. Create your first transaction to get started.'}
					</span>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="table table-zebra table-fixed w-full min-w-[1040px]">
						<thead>
							<tr>
								<th class="w-10">
									<label class="flex items-center justify-center cursor-pointer" title={allFilteredSelected ? 'Deselect all visible' : 'Select all visible'}>
										<input
											type="checkbox"
											class="checkbox checkbox-sm"
											checked={allFilteredSelected}
											onchange={toggleSelectAllFiltered}
										/>
									</label>
								</th>
								<th class="w-[10%]">Date</th>
								<th class="w-[20%]">Description</th>
								<th class="w-[15%]">Debit Account</th>
								<th class="w-[15%]">Credit Account</th>
								<th class="w-[10%]">Amount</th>
								<th class="w-[8%]">Category</th>
								<th class="w-[10%]">Vendor / Customer</th>
								<th class="w-[8%]">Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each filteredEntries as entry (entry.id)}
								<tr class={selectedIds.has(entry.id) ? 'bg-primary/5' : ''}>
									<td class="align-top">
										<label class="flex items-center justify-center cursor-pointer py-1">
											<input
												type="checkbox"
												class="checkbox checkbox-sm"
												checked={selectedIds.has(entry.id)}
												onchange={() => toggleSelect(entry.id)}
											/>
										</label>
									</td>
									<td class="align-top">{formatDate(entry.entryDate)}</td>
									<td class="whitespace-normal align-top break-words">
										<div class="font-medium">{entry.description}</div>
										{#if modules.checkReferences && entry.checkReference}
											<div class="mt-1">
												<span class="badge badge-ghost badge-sm font-mono" title="Check / Reference">
													Ref: {entry.checkReference}
												</span>
												{#if (checkReferenceCounts.get(entry.checkReference.trim()) || 0) > 1}
													<span class="text-2xs text-base-content/50 ml-1">
														({checkReferenceCounts.get(entry.checkReference.trim())} linked)
													</span>
												{/if}
											</div>
										{/if}
										{#if entry.comment}
											<div class="text-sm text-base-content/70 mt-1">{entry.comment}</div>
										{/if}
										{#if entryAttachments.get(entry.id)?.length}
											<div class="mt-2 flex flex-wrap gap-2">
												{#each entryAttachments.get(entry.id) || [] as attachment}
													<div class="flex items-center gap-1 bg-base-200 px-2 py-1 rounded text-xs truncate max-w-full">
														<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
															<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
														</svg>
														<a href={attachmentsAPI.getDownloadUrl(attachment.id)} class="link link-hover truncate" target="_blank" title={attachment.filename}>
															{attachment.filename}
														</a>
														<button class="btn btn-ghost btn-xs btn-circle shrink-0" onclick={() => handleDeleteAttachment(attachment.id, entry.id)}>
															<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
																<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
															</svg>
														</button>
													</div>
												{/each}
											</div>
										{/if}
									</td>
									<td class="text-sm align-top whitespace-normal break-words">
										{getAccountName(entry.debitAccountId)}
									</td>
									<td class="text-sm align-top whitespace-normal break-words">
										{getAccountName(entry.creditAccountId)}
									</td>
									<td class="font-mono font-bold align-top break-words">{formatCurrency(entry.amount, entry.currencyCode)}</td>
									<td class="align-top whitespace-normal break-words">
										{#if entry.category}
											<span class="badge badge-outline">{entry.category}</span>
										{/if}
									</td>
									<td class="align-top whitespace-normal break-words">
										{#if entry.vendorId}
											<a href="/vendors/{entry.vendorId}" class="link link-hover text-sm block">
												{getVendorName(entry.vendorId)}
											</a>
										{/if}
										{#if entry.customerId}
											<a href="/customers/{entry.customerId}" class="link link-hover text-sm block mt-1">
												{entry.customerName} {entry.customerLastName}
											</a>
										{/if}
										{#if entry.inventoryItemId}
											<span class="badge {entry.inventoryLinkType === 'own_use' ? 'badge-warning' : entry.inventoryLinkType === 'gift' ? 'badge-secondary' : entry.inventoryLinkType === 'sale' ? 'badge-success' : 'badge-ghost'} badge-sm mt-1 block w-fit max-w-full truncate" title="{entry.inventoryLinkType === 'own_use' ? 'Own Use' : entry.inventoryLinkType === 'gift' ? 'Gift' : entry.inventoryLinkType === 'sale' ? 'Sold' : 'Linked'}: {entry.inventoryItemName || '#' + entry.inventoryItemId}">
												{entry.inventoryLinkType === 'own_use' ? 'Own Use' : entry.inventoryLinkType === 'gift' ? 'Gift' : entry.inventoryLinkType === 'sale' ? 'Sold' : 'Linked'}: {entry.inventoryItemName || '#' + entry.inventoryItemId}
											</span>
										{/if}
										{#if entry.fixedAssetId}
											<span class="badge badge-info badge-sm mt-1 block w-fit">
												Asset: #{entry.fixedAssetId}
											</span>
										{/if}
										{#if entry.investmentId}
											{@const inv = investments.find((i) => i.id === entry.investmentId)}
											<span class="badge badge-accent badge-sm mt-1 block w-fit max-w-full truncate" title={inv?.name || `Investment #${entry.investmentId}`}>
												{inv?.name || `Investment #${entry.investmentId}`}
												{#if entry.investmentQuantity != null}
													· qty {(entry.investmentQuantity > 0 ? '+' : '') + entry.investmentQuantity}
												{/if}
											</span>
										{/if}
									</td>
									<td class="align-top">
										<div class="flex flex-col gap-1">
											<button class="btn btn-xs btn-ghost justify-start" onclick={() => openEditModal(entry)}>
												Edit
											</button>
											<button class="btn btn-xs btn-ghost text-error justify-start" onclick={() => handleDelete(entry.id)}>
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

					<!-- Currency mismatch warning -->
					{#if currencyMismatch}
						<div class="col-span-2 alert alert-warning py-2 px-4">
							<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-5 w-5" fill="none" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
							</svg>
							<span class="text-sm">The debit account uses <strong>{currencyMismatch.debit}</strong> but the credit account uses <strong>{currencyMismatch.credit}</strong>. The entry will be recorded in <strong>{formData.currencyCode}</strong>. Verify the amount is correct.</span>
						</div>
					{/if}

					<!-- Amount -->
					<div class="form-control col-span-2">
						<label class="label">
							<span class="label-text">Amount</span>
							{#if formData.inventoryItemId && (formData.inventoryLinkType === 'gift' || formData.inventoryLinkType === 'own_use')}
								<span class="label-text-alt text-xs text-base-content/50">$0 allowed for non-cash dispositions</span>
							{:else if !editingEntry}
								<span class="label-text-alt text-xs text-base-content/50">Add more amounts to create multiple entries with the same details</span>
							{/if}
						</label>
						<div class="flex gap-2 items-center">
							<input
								type="number"
								step="0.01"
								min="0"
								class="input input-bordered flex-1"
								bind:value={formData.amount}
								required
								placeholder="0.00"
							/>
							{#if !editingEntry}
								<button
									type="button"
									class="btn btn-square btn-outline"
									onclick={addAmount}
									title="Add another amount"
								>
									+
								</button>
							{/if}
						</div>
						{#if !editingEntry && extraAmounts.length > 0}
							<div class="mt-2 space-y-2">
								{#each extraAmounts as _, index}
									<div class="flex gap-2 items-center">
										<input
											type="number"
											step="0.01"
											min="0"
											class="input input-bordered flex-1"
											bind:value={extraAmounts[index]}
											placeholder="0.00"
										/>
										<button
											type="button"
											class="btn btn-square btn-ghost text-error"
											onclick={() => removeAmount(index)}
											title="Remove this amount"
										>
											<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
											</svg>
										</button>
									</div>
								{/each}
								<p class="text-xs text-base-content/60">
									Will create {extraAmounts.length + 1} separate journal entries.
								</p>
							</div>
						{/if}
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

					<!-- Check / Reference -->
					{#if modules.checkReferences}
					<div class="form-control col-span-2">
						<label class="label">
							<span class="label-text">Check / Reference (Optional)</span>
							<span class="label-text-alt text-xs text-base-content/50">
								e.g. check number to match clearing and bank postings
							</span>
						</label>
						<input
							type="text"
							class="input input-bordered font-mono"
							bind:value={formData.checkReference}
							placeholder="e.g., 1042 or CHK-1042"
							maxlength="100"
						/>
						{#if matchingCheckEntries.length > 0}
							<div class="mt-2 p-3 rounded-box bg-base-200 text-sm">
								<div class="font-medium mb-1">
									{matchingCheckEntries.length} other entr{matchingCheckEntries.length === 1 ? 'y' : 'ies'} with this reference
								</div>
								<ul class="space-y-1 max-h-32 overflow-y-auto">
									{#each matchingCheckEntries as match (match.id)}
										<li class="text-xs text-base-content/70 flex flex-wrap gap-x-2">
											<span class="font-mono">{formatDate(match.entryDate)}</span>
											<span class="truncate">{match.description}</span>
											<span class="font-mono">{formatCurrency(match.amount, match.currencyCode)}</span>
										</li>
									{/each}
								</ul>
							</div>
						{/if}
					</div>
					{/if}

					<!-- Vendor -->
					{#if modules.vendors}
					<div class="form-control">
						<label class="label">
							<span class="label-text">Vendor (Optional)</span>
						</label>
						<select class="select select-bordered" bind:value={formData.vendorId}>
							<option value={0}>No Vendor</option>
							{#each vendors as vendor}
								<option value={vendor.id}>{vendor.name}</option>
							{/each}
						</select>
					</div>
					{/if}

					<!-- Customer -->
					{#if modules.customers}
					<div class="form-control">
						<label class="label">
							<span class="label-text">Customer (Optional)</span>
						</label>
						<select class="select select-bordered" bind:value={formData.customerId}>
							<option value={0}>No Customer</option>
							{#each customers as customer}
								<option value={customer.id}>{customer.lastName}, {customer.firstName}</option>
							{/each}
						</select>
					</div>
					{/if}

					<!-- Fixed Asset link -->
					{#if modules.fixedAssets && fixedAssets.length > 0}
						<div class="form-control col-span-2">
							<label class="label">
								<span class="label-text">Fixed Asset (Optional)</span>
								<span class="label-text-alt text-xs text-base-content/50">Cost basis changes only if the asset account is used</span>
							</label>
							<select class="select select-bordered" bind:value={formData.fixedAssetId}>
								<option value={0}>No asset linked</option>
								{#each fixedAssets as asset}
									<option value={asset.id}>{asset.name}</option>
								{/each}
							</select>
						</div>
					{/if}

					<!-- Investment link -->
					{#if modules.investments && investments.length > 0}
						<div class="form-control col-span-2">
							<label class="label">
								<span class="label-text">Investment (Optional)</span>
								<span class="label-text-alt text-xs text-base-content/50">Stocks, crypto, bullion…</span>
							</label>
							<select class="select select-bordered" bind:value={formData.investmentId}>
								<option value={0}>No investment linked</option>
								{#each investments as inv}
									<option value={inv.id}>
										{inv.name}{inv.symbol ? ` (${inv.symbol})` : ''} — {inv.category}
									</option>
								{/each}
							</select>
						</div>
						{#if formData.investmentId}
							<div class="form-control col-span-2">
								<label class="label">
									<span class="label-text">Quantity</span>
									<span class="label-text-alt text-xs text-base-content/50">Buy = positive · Sell = negative</span>
								</label>
								<input
									type="number"
									class="input input-bordered font-mono"
									step="any"
									bind:value={formData.investmentQuantity}
									placeholder="e.g. 10 or -4"
								/>
							</div>
						{/if}
					{/if}

					<!-- Finished Good Item link -->
					{#if modules.inventory && finishedGoodItems.length > 0}
						<div class="form-control col-span-2">
							<label class="label">
								<span class="label-text">Finished Good Item (Optional)</span>
								<span class="label-text-alt text-xs text-base-content/50">Link this entry to an item</span>
							</label>
							<select class="select select-bordered" bind:value={formData.inventoryItemId}>
								<option value={0}>No item linked</option>
								{#each finishedGoodItems as item}
									<option value={item.id}>{item.categoryName} — {item.name}{item.saleEntryId ? ' ✓ Sold' : ''}</option>
								{/each}
							</select>
						</div>
						{#if formData.inventoryItemId}
							<div class="form-control col-span-2">
								<label class="label"><span class="label-text">Link Type</span></label>
								<div class="flex gap-6 flex-wrap">
									<label class="flex items-center gap-2 cursor-pointer">
										<input type="radio" class="radio radio-sm" bind:group={formData.inventoryLinkType} value="" />
										<span class="text-sm">Related cost <span class="text-base-content/50">(shipping, supplies…)</span></span>
									</label>
									<label class="flex items-center gap-2 cursor-pointer">
										<input type="radio" class="radio radio-sm" bind:group={formData.inventoryLinkType} value="sale" />
										<span class="text-sm">Sale <span class="text-base-content/50">(marks item sold)</span></span>
									</label>
									<label class="flex items-center gap-2 cursor-pointer">
										<input type="radio" class="radio radio-sm" bind:group={formData.inventoryLinkType} value="own_use" />
										<span class="text-sm">Own Use <span class="text-base-content/50">(personal, $0 ok)</span></span>
									</label>
									<label class="flex items-center gap-2 cursor-pointer">
										<input type="radio" class="radio radio-sm" bind:group={formData.inventoryLinkType} value="gift" />
										<span class="text-sm">Gift <span class="text-base-content/50">(given away, $0 ok)</span></span>
									</label>
								</div>
							</div>
						{/if}
					{/if}

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

<!-- Mass change modal -->
{#if showBulkModal}
	<div class="modal modal-open">
		<div class="modal-box max-w-xl">
			<h3 class="font-bold text-lg mb-1">Mass change journal entries</h3>
			<p class="text-sm text-base-content/60 mb-4">
				Replace a category or description across many entries, or copy a description into category and rename the description.
			</p>

			{#if bulkError}
				<div class="alert alert-error mb-4 text-sm">
					<span>{bulkError}</span>
				</div>
			{/if}

			{#if bulkResult && !bulkResult.preview && (bulkResult.updated ?? 0) > 0}
				<div class="alert alert-success mb-4 text-sm">
					<span>Updated <strong>{bulkResult.updated}</strong> entr{(bulkResult.updated ?? 0) === 1 ? 'y' : 'ies'}.</span>
				</div>
			{/if}

			<div class="space-y-4">
				<div class="form-control">
					<label class="label"><span class="label-text">Action</span></label>
					<select
						class="select select-bordered"
						bind:value={bulkField}
						onchange={() => { bulkMatchValue = ''; bulkNewValue = ''; bulkResult = null; }}
					>
						<option value="category">Replace category</option>
						<option value="description">Replace description</option>
						<option value="copy_description_to_category">Copy description → category, then rename description</option>
					</select>
				</div>

				{#if isCopyMode}
					<div class="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm space-y-1">
						<p class="font-medium">Copy description → category, then rename</p>
						<ol class="list-decimal list-inside text-base-content/70 space-y-0.5">
							<li>Find all entries with the chosen description</li>
							<li>Copy that description into <strong>category</strong></li>
							<li>Change their <strong>description</strong> to the new text</li>
						</ol>
					</div>

					<div class="form-control">
						<label class="label">
							<span class="label-text">Find description</span>
							<span class="label-text-alt">Exact match</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							list="bulk-description-list"
							bind:value={bulkMatchValue}
							placeholder="Description to find"
							oninput={() => { bulkResult = null; }}
						/>
						<datalist id="bulk-description-list">
							{#each bulkMeta.descriptions as d}
								<option value={d}></option>
							{/each}
						</datalist>
						<label class="label">
							<span class="label-text-alt text-base-content/50">This text is copied into category (max 100 characters)</span>
						</label>
					</div>

					<div class="form-control">
						<label class="label">
							<span class="label-text">New description</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							list="bulk-description-list"
							bind:value={bulkNewValue}
							placeholder="Description after the copy"
							oninput={() => { bulkResult = null; }}
						/>
					</div>
				{:else}
					<div class="form-control">
						<label class="label">
							<span class="label-text">Find</span>
							<span class="label-text-alt">Exact match</span>
						</label>
						{#if bulkField === 'category'}
							<input
								type="text"
								class="input input-bordered"
								list="bulk-category-list"
								bind:value={bulkMatchValue}
								placeholder="Category to find (leave blank for empty category)"
								oninput={() => { bulkResult = null; }}
							/>
							<datalist id="bulk-category-list">
								{#each bulkMeta.categories as cat}
									<option value={cat}></option>
								{/each}
							</datalist>
							<label class="label">
								<span class="label-text-alt text-base-content/50">Leave empty to match entries with no category</span>
							</label>
						{:else}
							<input
								type="text"
								class="input input-bordered"
								list="bulk-description-list"
								bind:value={bulkMatchValue}
								placeholder="Exact description to find"
								oninput={() => { bulkResult = null; }}
							/>
							<datalist id="bulk-description-list">
								{#each bulkMeta.descriptions as d}
									<option value={d}></option>
								{/each}
							</datalist>
						{/if}
					</div>

					<div class="form-control">
						<label class="label">
							<span class="label-text">Replace with</span>
						</label>
						<input
							type="text"
							class="input input-bordered"
							list={bulkField === 'category' ? 'bulk-category-list' : undefined}
							bind:value={bulkNewValue}
							placeholder={bulkField === 'category' ? 'New category (blank clears category)' : 'New description'}
							oninput={() => { bulkResult = null; }}
						/>
					</div>
				{/if}

				<label class="label cursor-pointer justify-start gap-3">
					<input type="checkbox" class="checkbox checkbox-sm" bind:checked={bulkUseDateFilters} onchange={() => { bulkResult = null; }} />
					<span class="label-text">
						Limit to current date filters
						{#if startDate || endDate}
							<span class="text-base-content/50">
								({startDate || '…'} → {endDate || '…'})
							</span>
						{:else}
							<span class="text-base-content/50">(no date filter set — all dates)</span>
						{/if}
					</span>
				</label>

				{#if bulkResult?.preview}
					<div class="rounded-xl border border-base-300 bg-base-200/50 p-4">
						<p class="font-semibold text-sm mb-2">
							{bulkResult.count === 0
								? 'No matching entries found.'
								: `${bulkResult.count} entr${bulkResult.count === 1 ? 'y' : 'ies'} will be updated.`}
						</p>
						{#if bulkResult.sample && bulkResult.sample.length > 0}
							<p class="text-2xs uppercase tracking-wider text-base-content/50 mb-2">Sample</p>
							<ul class="space-y-1.5 max-h-40 overflow-y-auto text-sm">
								{#each bulkResult.sample as s}
									<li class="flex justify-between gap-2 border-b border-base-300/50 pb-1">
										<span class="truncate min-w-0">
											<span class="text-base-content/50 font-mono text-xs">{formatDate(s.entryDate)}</span>
											{#if isCopyMode}
												<span class="block truncate">
													Desc: <span class="line-through opacity-60">{s.description}</span>
													→ <strong>{s.descriptionAfter ?? bulkNewValue}</strong>
												</span>
												<span class="block truncate text-xs">
													Category → <span class="badge badge-primary badge-xs">{s.categoryAfter ?? bulkMatchValue.slice(0, 100)}</span>
												</span>
											{:else}
												— {s.description}
												{#if s.category}
													<span class="badge badge-ghost badge-xs ml-1">{s.category}</span>
												{/if}
											{/if}
										</span>
										<span class="font-mono text-xs shrink-0">{formatCurrency(s.amount, s.currencyCode)}</span>
									</li>
								{/each}
							</ul>
							{#if bulkResult.count > bulkResult.sample.length}
								<p class="text-xs text-base-content/50 mt-2">…and {bulkResult.count - bulkResult.sample.length} more</p>
							{/if}
						{/if}
					</div>
				{/if}
			</div>

			<div class="modal-action flex-wrap">
				<button type="button" class="btn btn-ghost" onclick={closeBulkModal}>Close</button>
				<button
					type="button"
					class="btn btn-outline"
					onclick={handleBulkPreview}
					disabled={bulkPreviewing || bulkApplying}
				>
					{#if bulkPreviewing}
						<span class="loading loading-spinner loading-sm"></span>
					{/if}
					Preview matches
				</button>
				<button
					type="button"
					class="btn btn-primary"
					onclick={handleBulkApply}
					disabled={bulkApplying || bulkPreviewing || !bulkResult?.preview || (bulkResult?.count ?? 0) === 0}
				>
					{#if bulkApplying}
						<span class="loading loading-spinner loading-sm"></span>
					{/if}
					Apply change
				</button>
			</div>
		</div>
		<div class="modal-backdrop" onclick={closeBulkModal}></div>
	</div>
{/if}

<!-- Selection-based bulk edit modal -->
{#if showSelectionModal}
	<div class="modal modal-open">
		<div class="modal-box max-w-2xl">
			<h3 class="font-bold text-lg mb-1">Edit selected entries</h3>
			<p class="text-sm text-base-content/60 mb-4">
				Apply the same values to <strong>{selectedCount}</strong> selected entr{selectedCount === 1 ? 'y' : 'ies'}.
				Enable only the fields you want to change.
			</p>

			{#if selectionError}
				<div class="alert alert-error mb-4 text-sm"><span>{selectionError}</span></div>
			{/if}
			{#if selectionSuccess}
				<div class="alert alert-success mb-4 text-sm"><span>{selectionSuccess}</span></div>
			{/if}

			<div class="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
				<!-- Description -->
				<div class="rounded-xl border border-base-300 p-3">
					<label class="label cursor-pointer justify-start gap-3 py-0 mb-2">
						<input type="checkbox" class="checkbox checkbox-sm" bind:checked={selApply.description} />
						<span class="label-text font-semibold">Description</span>
					</label>
					<input
						type="text"
						class="input input-bordered input-sm w-full"
						bind:value={selValues.description}
						disabled={!selApply.description}
						placeholder="New description"
					/>
				</div>

				<!-- Category -->
				<div class="rounded-xl border border-base-300 p-3">
					<label class="label cursor-pointer justify-start gap-3 py-0 mb-2">
						<input type="checkbox" class="checkbox checkbox-sm" bind:checked={selApply.category} />
						<span class="label-text font-semibold">Category</span>
					</label>
					<input
						type="text"
						class="input input-bordered input-sm w-full"
						bind:value={selValues.category}
						disabled={!selApply.category}
						placeholder="New category (blank clears)"
					/>
				</div>

				<!-- Comment -->
				<div class="rounded-xl border border-base-300 p-3">
					<label class="label cursor-pointer justify-start gap-3 py-0 mb-2">
						<input type="checkbox" class="checkbox checkbox-sm" bind:checked={selApply.comment} />
						<span class="label-text font-semibold">Comment</span>
					</label>
					<textarea
						class="textarea textarea-bordered textarea-sm w-full"
						rows="2"
						bind:value={selValues.comment}
						disabled={!selApply.comment}
						placeholder="New comment (blank clears)"
					></textarea>
				</div>

				<!-- Entry date -->
				<div class="rounded-xl border border-base-300 p-3">
					<label class="label cursor-pointer justify-start gap-3 py-0 mb-2">
						<input type="checkbox" class="checkbox checkbox-sm" bind:checked={selApply.entryDate} />
						<span class="label-text font-semibold">Entry date</span>
					</label>
					<input
						type="date"
						class="input input-bordered input-sm w-full"
						bind:value={selValues.entryDate}
						disabled={!selApply.entryDate}
					/>
				</div>

				<!-- Debit account -->
				<div class="rounded-xl border border-base-300 p-3">
					<label class="label cursor-pointer justify-start gap-3 py-0 mb-2">
						<input type="checkbox" class="checkbox checkbox-sm" bind:checked={selApply.debitAccountId} />
						<span class="label-text font-semibold">Debit account</span>
					</label>
					<select
						class="select select-bordered select-sm w-full"
						bind:value={selValues.debitAccountId}
						disabled={!selApply.debitAccountId}
					>
						<option value={0}>Select debit account…</option>
						{#each subledgerAccounts as a}
							<option value={a.id}>{a.accountNumber} — {a.name}</option>
						{/each}
					</select>
				</div>

				<!-- Credit account -->
				<div class="rounded-xl border border-base-300 p-3">
					<label class="label cursor-pointer justify-start gap-3 py-0 mb-2">
						<input type="checkbox" class="checkbox checkbox-sm" bind:checked={selApply.creditAccountId} />
						<span class="label-text font-semibold">Credit account</span>
					</label>
					<select
						class="select select-bordered select-sm w-full"
						bind:value={selValues.creditAccountId}
						disabled={!selApply.creditAccountId}
					>
						<option value={0}>Select credit account…</option>
						{#each subledgerAccounts as a}
							<option value={a.id}>{a.accountNumber} — {a.name}</option>
						{/each}
					</select>
				</div>

				<!-- Currency -->
				<div class="rounded-xl border border-base-300 p-3">
					<label class="label cursor-pointer justify-start gap-3 py-0 mb-2">
						<input type="checkbox" class="checkbox checkbox-sm" bind:checked={selApply.currencyCode} />
						<span class="label-text font-semibold">Currency</span>
					</label>
					<select
						class="select select-bordered select-sm w-full"
						bind:value={selValues.currencyCode}
						disabled={!selApply.currencyCode}
					>
						{#each currencies as c}
							<option value={c.code}>{c.code} — {c.name}</option>
						{/each}
					</select>
				</div>

				<!-- Vendor -->
				<div class="rounded-xl border border-base-300 p-3">
					<label class="label cursor-pointer justify-start gap-3 py-0 mb-2">
						<input type="checkbox" class="checkbox checkbox-sm" bind:checked={selApply.vendorId} />
						<span class="label-text font-semibold">Vendor</span>
					</label>
					<select
						class="select select-bordered select-sm w-full"
						bind:value={selValues.vendorId}
						disabled={!selApply.vendorId}
					>
						<option value={0}>None (clear vendor)</option>
						{#each vendors as v}
							<option value={v.id}>{v.name}</option>
						{/each}
					</select>
				</div>

				<!-- Customer -->
				<div class="rounded-xl border border-base-300 p-3">
					<label class="label cursor-pointer justify-start gap-3 py-0 mb-2">
						<input type="checkbox" class="checkbox checkbox-sm" bind:checked={selApply.customerId} />
						<span class="label-text font-semibold">Customer</span>
					</label>
					<select
						class="select select-bordered select-sm w-full"
						bind:value={selValues.customerId}
						disabled={!selApply.customerId}
					>
						<option value={0}>None (clear customer)</option>
						{#each customers as c}
							<option value={c.id}>{c.lastName}, {c.firstName}</option>
						{/each}
					</select>
				</div>
			</div>

			<div class="modal-action flex-wrap">
				<button type="button" class="btn btn-ghost" onclick={closeSelectionModal}>Close</button>
				<button
					type="button"
					class="btn btn-primary"
					onclick={handleSelectionApply}
					disabled={selectionApplying}
				>
					{#if selectionApplying}
						<span class="loading loading-spinner loading-sm"></span>
					{/if}
					Apply to {selectedCount} selected
				</button>
			</div>
		</div>
		<div class="modal-backdrop" onclick={closeSelectionModal}></div>
	</div>
{/if}
