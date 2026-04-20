// API base URL - configurable via environment variable or auto-detect
// Priority: 1) PUBLIC_API_URL env var, 2) Auto-detect based on frontend port
// In production, the frontend and backend can run on different ports
const getApiBaseUrl = () => {
	// Server-side rendering - return empty string (use relative paths)
	if (typeof window === 'undefined') return '';

	// Get public env vars (available at runtime)
	const apiUrl = (globalThis as any).APP_CONFIG?.API_URL;
	const backendPort = (globalThis as any).APP_CONFIG?.BACKEND_PORT || '3000';
	const frontendPort = (globalThis as any).APP_CONFIG?.FRONTEND_PORT || '5173';

	// If API_URL is explicitly set, use it
	if (apiUrl) {
		return apiUrl;
	}

	// Auto-detect: if frontend port matches, construct backend URL
	if (window.location.port === frontendPort) {
		return `http://${window.location.hostname}:${backendPort}`;
	}

	// Default: use relative path
	return '';
};

// Generic fetch wrapper with error handling
async function apiFetch<T>(
	endpoint: string,
	options: RequestInit = {}
): Promise<T> {
	// Call getApiBaseUrl() at request time, not module load time
	const url = `${getApiBaseUrl()}${endpoint}`;

	try {
		// Only set Content-Type header if there's a body
		const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
		if (options.body) {
			headers['Content-Type'] = 'application/json';
		}

		const response = await fetch(url, {
			...options,
			headers
		});

		if (!response.ok) {
			const error = await response.json().catch(() => ({
				error: 'Unknown Error',
				message: response.statusText
			}));
			throw new Error(error.message || `HTTP ${response.status}`);
		}

		// Handle 204 No Content
		if (response.status === 204) {
			return undefined as T;
		}

		return await response.json();
	} catch (error) {
		if (error instanceof Error) {
			throw error;
		}
		throw new Error('Network error');
	}
}

// ========================================
// Currencies API
// ========================================
export interface Currency {
	code: string;
	name: string;
	symbol: string;
	exchangeRate: number;
	isDefault: boolean;
}

export const currenciesAPI = {
	async list(): Promise<Currency[]> {
		return apiFetch('/api/currencies');
	},

	async get(code: string): Promise<Currency> {
		return apiFetch(`/api/currencies/${code}`);
	},

	async create(data: Omit<Currency, 'code'> & { code: string }): Promise<Currency> {
		return apiFetch('/api/currencies', {
			method: 'POST',
			body: JSON.stringify(data)
		});
	},

	async update(code: string, data: Partial<Currency>): Promise<Currency> {
		return apiFetch(`/api/currencies/${code}`, {
			method: 'PUT',
			body: JSON.stringify(data)
		});
	},

	async delete(code: string): Promise<void> {
		return apiFetch(`/api/currencies/${code}`, {
			method: 'DELETE'
		});
	}
};

// ========================================
// GL Accounts API
// ========================================
export type AccountType = 'Asset' | 'Cash' | 'Accounts Receivable' | 'Equity' | 'Accounts Payable' | 'Profit' | 'Loss' | 'Opening Balance';

export interface GLAccount {
	id: number;
	accountNumber: string;
	name: string;
	type: AccountType;
	description?: string | null;
	isActive: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export const glAccountsAPI = {
	async list(params?: { active?: boolean; type?: AccountType }): Promise<GLAccount[]> {
		const query = new URLSearchParams();
		if (params?.active !== undefined) query.set('active', String(params.active));
		if (params?.type) query.set('type', params.type);

		const queryString = query.toString();
		return apiFetch(`/api/gl-accounts${queryString ? `?${queryString}` : ''}`);
	},

	async get(id: number): Promise<GLAccount> {
		return apiFetch(`/api/gl-accounts/${id}`);
	},

	async create(data: Omit<GLAccount, 'id' | 'createdAt' | 'updatedAt'>): Promise<GLAccount> {
		return apiFetch('/api/gl-accounts', {
			method: 'POST',
			body: JSON.stringify(data)
		});
	},

	async update(id: number, data: Partial<Omit<GLAccount, 'id' | 'createdAt' | 'updatedAt'>>): Promise<GLAccount> {
		return apiFetch(`/api/gl-accounts/${id}`, {
			method: 'PUT',
			body: JSON.stringify(data)
		});
	},

	async delete(id: number): Promise<void> {
		return apiFetch(`/api/gl-accounts/${id}`, {
			method: 'DELETE'
		});
	}
};

// ========================================
// Subledger Accounts API
// ========================================
export interface SubledgerAccount {
	id: number;
	glAccountId: number;
	accountNumber: string;
	name: string;
	currencyCode: string;
	description?: string | null;
	isActive: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export const subledgerAccountsAPI = {
	async list(params?: { active?: boolean; glAccountId?: number; currencyCode?: string }): Promise<SubledgerAccount[]> {
		const query = new URLSearchParams();
		if (params?.active !== undefined) query.set('active', String(params.active));
		if (params?.glAccountId) query.set('glAccountId', String(params.glAccountId));
		if (params?.currencyCode) query.set('currencyCode', params.currencyCode);

		const queryString = query.toString();
		return apiFetch(`/api/subledger-accounts${queryString ? `?${queryString}` : ''}`);
	},

	async get(id: number): Promise<SubledgerAccount> {
		return apiFetch(`/api/subledger-accounts/${id}`);
	},

	async create(data: Omit<SubledgerAccount, 'id' | 'createdAt' | 'updatedAt'>): Promise<SubledgerAccount> {
		return apiFetch('/api/subledger-accounts', {
			method: 'POST',
			body: JSON.stringify(data)
		});
	},

	async update(id: number, data: Partial<Omit<SubledgerAccount, 'id' | 'createdAt' | 'updatedAt'>>): Promise<SubledgerAccount> {
		return apiFetch(`/api/subledger-accounts/${id}`, {
			method: 'PUT',
			body: JSON.stringify(data)
		});
	},

	async delete(id: number): Promise<void> {
		return apiFetch(`/api/subledger-accounts/${id}`, {
			method: 'DELETE'
		});
	}
};

// ========================================
// Vendors API
// ========================================
export interface Vendor {
	id: number;
	name: string;
	address?: string | null;
	phone?: string | null;
	email?: string | null;
	website?: string | null;
	comments?: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export const vendorsAPI = {
	async list(params?: { search?: string }): Promise<Vendor[]> {
		const query = new URLSearchParams();
		if (params?.search) query.set('search', params.search);

		const queryString = query.toString();
		return apiFetch(`/api/vendors${queryString ? `?${queryString}` : ''}`);
	},

	async get(id: number): Promise<Vendor> {
		return apiFetch(`/api/vendors/${id}`);
	},

	async create(data: Omit<Vendor, 'id' | 'createdAt' | 'updatedAt'>): Promise<Vendor> {
		return apiFetch('/api/vendors', {
			method: 'POST',
			body: JSON.stringify(data)
		});
	},

	async update(id: number, data: Partial<Omit<Vendor, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Vendor> {
		return apiFetch(`/api/vendors/${id}`, {
			method: 'PUT',
			body: JSON.stringify(data)
		});
	},

	async delete(id: number): Promise<void> {
		return apiFetch(`/api/vendors/${id}`, {
			method: 'DELETE'
		});
	},

	async getJournalEntries(id: number): Promise<JournalEntry[]> {
		return apiFetch(`/api/vendors/${id}/journal-entries`);
	},

	async downloadCSV(): Promise<void> {
		const url = `${getApiBaseUrl()}/api/vendors/export/csv`;
		const response = await fetch(url);
		if (!response.ok) throw new Error('Failed to download CSV');

		const blob = await response.blob();
		const downloadUrl = window.URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = downloadUrl;
		a.download = 'vendors.csv';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		window.URL.revokeObjectURL(downloadUrl);
	},

	async uploadCSV(file: File): Promise<{
		success: number;
		failed: number;
		errors: string[];
		message?: string;
	}> {
		const formData = new FormData();
		formData.append('file', file);

		const response = await fetch(
			`${getApiBaseUrl()}/api/vendors/import/csv`,
			{ method: 'POST', body: formData }
		);

		if (response.status === 400) return response.json();
		if (!response.ok) {
			const error = await response.json().catch(() => ({ message: response.statusText }));
			throw new Error(error.message || `HTTP ${response.status}`);
		}
		return response.json();
	}
};

// ========================================
// Customers API
// ========================================
export interface Customer {
	id: number;
	firstName: string;
	lastName: string;
	email?: string | null;
	phone?: string | null;
	country?: string | null;
	state?: string | null;
	zipCode?: string | null;
	city?: string | null;
	contactMethod?: string | null;
	comment?: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export const customersAPI = {
	async list(params?: { search?: string }): Promise<Customer[]> {
		const query = new URLSearchParams();
		if (params?.search) query.set('search', params.search);

		const queryString = query.toString();
		return apiFetch(`/api/customers${queryString ? `?${queryString}` : ''}`);
	},

	async get(id: number): Promise<Customer> {
		return apiFetch(`/api/customers/${id}`);
	},

	async create(data: Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>): Promise<Customer> {
		return apiFetch('/api/customers', {
			method: 'POST',
			body: JSON.stringify(data)
		});
	},

	async update(id: number, data: Partial<Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Customer> {
		return apiFetch(`/api/customers/${id}`, {
			method: 'PUT',
			body: JSON.stringify(data)
		});
	},

	async delete(id: number): Promise<void> {
		return apiFetch(`/api/customers/${id}`, {
			method: 'DELETE'
		});
	},

	async getPurchases(id: number): Promise<CustomerPurchase[]> {
		return apiFetch(`/api/customers/${id}/purchases`);
	},

	async getBookings(id: number): Promise<CustomerBooking[]> {
		return apiFetch(`/api/customers/${id}/bookings`);
	},

	async downloadCSV(): Promise<void> {
		const url = `${getApiBaseUrl()}/api/customers/export/csv`;
		const response = await fetch(url);
		if (!response.ok) throw new Error('Failed to download CSV');

		const blob = await response.blob();
		const downloadUrl = window.URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = downloadUrl;
		a.download = 'customers.csv';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		window.URL.revokeObjectURL(downloadUrl);
	},

	async uploadCSV(file: File): Promise<{
		success: number;
		failed: number;
		errors: string[];
		message?: string;
	}> {
		const formData = new FormData();
		formData.append('file', file);

		const response = await fetch(
			`${getApiBaseUrl()}/api/customers/import/csv`,
			{ method: 'POST', body: formData }
		);

		if (response.status === 400) return response.json();
		if (!response.ok) {
			const error = await response.json().catch(() => ({ message: response.statusText }));
			throw new Error(error.message || `HTTP ${response.status}`);
		}
		return response.json();
	}
};

// ========================================
// Journal Entries API
// ========================================
export interface JournalEntry {
	id: number;
	entryDate: Date;
	amount: number;
	currencyCode: string;
	amountInUSD: number;
	debitAccountId: number;
	creditAccountId: number;
	description: string;
	category?: string | null;
	comment?: string | null;
	vendorId?: number | null;
	customerId?: number | null;
	customerName?: string | null;
	customerLastName?: string | null;
	inventoryItemId?: number | null;
	inventoryLinkType?: 'sale' | 'own_use' | 'gift' | null;
	inventoryItemName?: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export const journalEntriesAPI = {
	async list(params?: {
		startDate?: Date;
		endDate?: Date;
		debitAccountId?: number;
		creditAccountId?: number;
		category?: string;
		currencyCode?: string;
		customerId?: number;
		inventoryItemId?: number;
	}): Promise<JournalEntry[]> {
		const query = new URLSearchParams();
		if (params?.startDate) query.set('startDate', params.startDate.toISOString());
		if (params?.endDate) query.set('endDate', params.endDate.toISOString());
		if (params?.debitAccountId) query.set('debitAccountId', String(params.debitAccountId));
		if (params?.creditAccountId) query.set('creditAccountId', String(params.creditAccountId));
		if (params?.category) query.set('category', params.category);
		if (params?.currencyCode) query.set('currencyCode', params.currencyCode);
		if (params?.customerId) query.set('customerId', String(params.customerId));
		if (params?.inventoryItemId) query.set('inventoryItemId', String(params.inventoryItemId));

		const queryString = query.toString();
		return apiFetch(`/api/journal-entries${queryString ? `?${queryString}` : ''}`);
	},

	async get(id: number): Promise<JournalEntry> {
		return apiFetch(`/api/journal-entries/${id}`);
	},

	async create(data: Omit<JournalEntry, 'id' | 'amountInUSD' | 'createdAt' | 'updatedAt'>): Promise<JournalEntry> {
		return apiFetch('/api/journal-entries', {
			method: 'POST',
			body: JSON.stringify(data)
		});
	},

	async update(id: number, data: Partial<Omit<JournalEntry, 'id' | 'amountInUSD' | 'createdAt' | 'updatedAt'>>): Promise<JournalEntry> {
		return apiFetch(`/api/journal-entries/${id}`, {
			method: 'PUT',
			body: JSON.stringify(data)
		});
	},

	async delete(id: number): Promise<void> {
		return apiFetch(`/api/journal-entries/${id}`, {
			method: 'DELETE'
		});
	},

	async downloadCSV(params?: {
		startDate?: Date;
		endDate?: Date;
		debitAccountId?: number;
		creditAccountId?: number;
		category?: string;
		currencyCode?: string;
	}): Promise<void> {
		const query = new URLSearchParams();
		if (params?.startDate) query.set('startDate', params.startDate.toISOString());
		if (params?.endDate) query.set('endDate', params.endDate.toISOString());
		if (params?.debitAccountId) query.set('debitAccountId', String(params.debitAccountId));
		if (params?.creditAccountId) query.set('creditAccountId', String(params.creditAccountId));
		if (params?.category) query.set('category', params.category);
		if (params?.currencyCode) query.set('currencyCode', params.currencyCode);

		const queryString = query.toString();
		const url = `${getApiBaseUrl()}/api/journal-entries/export/csv${queryString ? `?${queryString}` : ''}`;

		// Download the CSV file
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error('Failed to download CSV');
		}

		const blob = await response.blob();
		const downloadUrl = window.URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = downloadUrl;
		a.download = 'journal-entries.csv';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		window.URL.revokeObjectURL(downloadUrl);
	},

	async uploadCSV(file: File): Promise<{
		success: number;
		failed: number;
		errors: string[];
		message?: string;
	}> {
		const formData = new FormData();
		formData.append('file', file);

		const response = await fetch(
			`${getApiBaseUrl()}/api/journal-entries/import/csv`,
			{
				method: 'POST',
				body: formData
			}
		);

		// For validation errors (400), return the error details instead of throwing
		if (response.status === 400) {
			return response.json();
		}

		// For other errors, throw
		if (!response.ok) {
			const error = await response.json().catch(() => ({
				error: 'Unknown Error',
				message: response.statusText
			}));
			throw new Error(error.message || `HTTP ${response.status}`);
		}

		return response.json();
	}
};

// ========================================
// Attachments API
// ========================================
export interface Attachment {
	id: number;
	journalEntryId: number;
	filename: string;
	storedFilename: string;
	mimeType: string;
	fileSize: number;
	uploadedAt: Date;
}

export const attachmentsAPI = {
	async list(params?: { journalEntryId?: number }): Promise<Attachment[]> {
		const query = new URLSearchParams();
		if (params?.journalEntryId) query.set('journalEntryId', String(params.journalEntryId));

		const queryString = query.toString();
		return apiFetch(`/api/attachments${queryString ? `?${queryString}` : ''}`);
	},

	async get(id: number): Promise<Attachment> {
		return apiFetch(`/api/attachments/${id}`);
	},

	async upload(journalEntryId: number, file: File): Promise<Attachment> {
		const formData = new FormData();
		formData.append('file', file);

		const response = await fetch(
			`${getApiBaseUrl()}/api/attachments?journalEntryId=${journalEntryId}`,
			{
				method: 'POST',
				body: formData
			}
		);

		if (!response.ok) {
			const error = await response.json().catch(() => ({
				error: 'Unknown Error',
				message: response.statusText
			}));
			throw new Error(error.message || `HTTP ${response.status}`);
		}

		return response.json();
	},

	getDownloadUrl(id: number): string {
		return `${getApiBaseUrl()}/api/attachments/${id}/download`;
	},

	async delete(id: number): Promise<void> {
		return apiFetch(`/api/attachments/${id}`, {
			method: 'DELETE'
		});
	}
};

// ========================================
// Reports API
// ========================================
export interface AccountBalance {
	accountId: number;
	accountNumber: string;
	accountName: string;
	glAccountId: number;
	glAccountNumber: string;
	glAccountName: string;
	glAccountType: string;
	balance: number;
}

export interface BalanceSheetReport {
	asOfDate: Date;
	currencyCode: string;
	assets: {
		accounts: AccountBalance[];
		total: number;
	};
	liabilities: {
		accounts: AccountBalance[];
		total: number;
	};
	equity: {
		accounts: AccountBalance[];
		retainedEarnings: number;
		total: number;
	};
	totalLiabilitiesAndEquity: number;
	balanced: boolean;
}

export interface ProfitLossReport {
	startDate: Date;
	endDate: Date;
	currencyCode: string;
	revenue: {
		accounts: AccountBalance[];
		total: number;
	};
	expenses: {
		accounts: AccountBalance[];
		total: number;
	};
	netIncome: number;
}

export interface TrialBalanceReport {
	asOfDate: Date;
	currencyCode: string;
	accounts: (AccountBalance & { debit: number; credit: number })[];
	totalDebits: number;
	totalCredits: number;
	balanced: boolean;
}

export interface LedgerEntry extends JournalEntry {
	debit: number;
	credit: number;
	balance: number;
}

export interface AccountLedger {
	account: {
		id: number;
		accountNumber: string;
		accountName: string;
		glAccountNumber: string;
		glAccountName: string;
		glAccountType: string;
	};
	entries: LedgerEntry[];
	finalBalance: number;
}

export const reportsAPI = {
	async balanceSheet(params?: { endDate?: Date; currencyCode?: string }): Promise<BalanceSheetReport> {
		const query = new URLSearchParams();
		if (params?.endDate) query.set('endDate', params.endDate.toISOString());
		if (params?.currencyCode) query.set('currencyCode', params.currencyCode);

		const queryString = query.toString();
		return apiFetch(`/api/reports/balance-sheet${queryString ? `?${queryString}` : ''}`);
	},

	async profitLoss(params?: { startDate?: Date; endDate?: Date; currencyCode?: string }): Promise<ProfitLossReport> {
		const query = new URLSearchParams();
		if (params?.startDate) query.set('startDate', params.startDate.toISOString());
		if (params?.endDate) query.set('endDate', params.endDate.toISOString());
		if (params?.currencyCode) query.set('currencyCode', params.currencyCode);

		const queryString = query.toString();
		return apiFetch(`/api/reports/profit-loss${queryString ? `?${queryString}` : ''}`);
	},

	async trialBalance(params?: { endDate?: Date; currencyCode?: string }): Promise<TrialBalanceReport> {
		const query = new URLSearchParams();
		if (params?.endDate) query.set('endDate', params.endDate.toISOString());
		if (params?.currencyCode) query.set('currencyCode', params.currencyCode);

		const queryString = query.toString();
		return apiFetch(`/api/reports/trial-balance${queryString ? `?${queryString}` : ''}`);
	},

	async accountLedger(
		accountId: number,
		params?: { startDate?: Date; endDate?: Date }
	): Promise<AccountLedger> {
		const query = new URLSearchParams();
		if (params?.startDate) query.set('startDate', params.startDate.toISOString());
		if (params?.endDate) query.set('endDate', params.endDate.toISOString());

		const queryString = query.toString();
		return apiFetch(`/api/reports/account-ledger/${accountId}${queryString ? `?${queryString}` : ''}`);
	}
};

// ========================================
// Time Entries API
// ========================================
export interface TimeEntry {
	id: number;
	entryDate: Date;
	hours: number;
	minutes: number;
	activity: string;
	description?: string | null;
	who: string;
	createdAt: Date;
	updatedAt: Date;
}

export const timeEntriesAPI = {
	async list(params?: {
		startDate?: Date;
		endDate?: Date;
		who?: string;
		activity?: string;
	}): Promise<TimeEntry[]> {
		const query = new URLSearchParams();
		if (params?.startDate) query.set('startDate', params.startDate.toISOString());
		if (params?.endDate) query.set('endDate', params.endDate.toISOString());
		if (params?.who) query.set('who', params.who);
		if (params?.activity) query.set('activity', params.activity);

		const queryString = query.toString();
		return apiFetch(`/api/time-entries${queryString ? `?${queryString}` : ''}`);
	},

	async get(id: number): Promise<TimeEntry> {
		return apiFetch(`/api/time-entries/${id}`);
	},

	async create(data: Omit<TimeEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<TimeEntry> {
		return apiFetch('/api/time-entries', {
			method: 'POST',
			body: JSON.stringify(data)
		});
	},

	async update(id: number, data: Partial<Omit<TimeEntry, 'id' | 'createdAt' | 'updatedAt'>>): Promise<TimeEntry> {
		return apiFetch(`/api/time-entries/${id}`, {
			method: 'PUT',
			body: JSON.stringify(data)
		});
	},

	async delete(id: number): Promise<void> {
		return apiFetch(`/api/time-entries/${id}`, {
			method: 'DELETE'
		});
	},

	async downloadCSV(params?: {
		startDate?: Date;
		endDate?: Date;
		who?: string;
	}): Promise<void> {
		const query = new URLSearchParams();
		if (params?.startDate) query.set('startDate', params.startDate.toISOString());
		if (params?.endDate) query.set('endDate', params.endDate.toISOString());
		if (params?.who) query.set('who', params.who);

		const queryString = query.toString();
		const url = `${getApiBaseUrl()}/api/time-entries/export/csv${queryString ? `?${queryString}` : ''}`;

		const response = await fetch(url);
		if (!response.ok) throw new Error('Failed to download CSV');

		const blob = await response.blob();
		const downloadUrl = window.URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = downloadUrl;
		a.download = 'time-entries.csv';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		window.URL.revokeObjectURL(downloadUrl);
	},

	async uploadCSV(file: File): Promise<{
		success: number;
		failed: number;
		errors: string[];
		message?: string;
	}> {
		const formData = new FormData();
		formData.append('file', file);

		const response = await fetch(
			`${getApiBaseUrl()}/api/time-entries/import/csv`,
			{ method: 'POST', body: formData }
		);

		if (response.status === 400) return response.json();
		if (!response.ok) {
			const error = await response.json().catch(() => ({ message: response.statusText }));
			throw new Error(error.message || `HTTP ${response.status}`);
		}
		return response.json();
	}
};

// ========================================
// Audit Logs API
// ========================================
export interface AuditLog {
	id: number;
	operation: 'CREATE' | 'UPDATE' | 'DELETE';
	resourceType: 'currency' | 'gl_account' | 'subledger_account' | 'journal_entry' | 'attachment' | 'vendor' | 'time_entry';
	resourceId: string;
	source: 'Web UI' | 'CSV Import' | 'API';
	batchId: string | null;
	batchSummary: string | null;
	oldData: any | null;
	newData: any | null;
	timestamp: Date;
	description: string | null;
}

export interface AuditLogFilters {
	startDate?: Date;
	endDate?: Date;
	resourceType?: string;
	operation?: string;
	source?: string;
	resourceId?: string;
	batchId?: string;
}

export const auditLogsAPI = {
	async list(filters?: AuditLogFilters): Promise<AuditLog[]> {
		const query = new URLSearchParams();
		if (filters?.startDate) query.set('startDate', filters.startDate.toISOString());
		if (filters?.endDate) query.set('endDate', filters.endDate.toISOString());
		if (filters?.resourceType) query.set('resourceType', filters.resourceType);
		if (filters?.operation) query.set('operation', filters.operation);
		if (filters?.source) query.set('source', filters.source);
		if (filters?.resourceId) query.set('resourceId', filters.resourceId);
		if (filters?.batchId) query.set('batchId', filters.batchId);

		const queryString = query.toString();
		return apiFetch(`/api/audit-logs${queryString ? `?${queryString}` : ''}`);
	},

	async get(id: number): Promise<AuditLog> {
		return apiFetch(`/api/audit-logs/${id}`);
	},

	async downloadCSV(filters?: AuditLogFilters): Promise<void> {
		const query = new URLSearchParams();
		if (filters?.startDate) query.set('startDate', filters.startDate.toISOString());
		if (filters?.endDate) query.set('endDate', filters.endDate.toISOString());
		if (filters?.resourceType) query.set('resourceType', filters.resourceType);
		if (filters?.operation) query.set('operation', filters.operation);
		if (filters?.source) query.set('source', filters.source);
		if (filters?.resourceId) query.set('resourceId', filters.resourceId);
		if (filters?.batchId) query.set('batchId', filters.batchId);

		const queryString = query.toString();
		const url = `${getApiBaseUrl()}/api/audit-logs/export/csv${queryString ? `?${queryString}` : ''}`;

		// Trigger download
		window.open(url, '_blank');
	},

	async downloadJSON(filters?: AuditLogFilters): Promise<void> {
		const query = new URLSearchParams();
		if (filters?.startDate) query.set('startDate', filters.startDate.toISOString());
		if (filters?.endDate) query.set('endDate', filters.endDate.toISOString());
		if (filters?.resourceType) query.set('resourceType', filters.resourceType);
		if (filters?.operation) query.set('operation', filters.operation);
		if (filters?.source) query.set('source', filters.source);
		if (filters?.resourceId) query.set('resourceId', filters.resourceId);
		if (filters?.batchId) query.set('batchId', filters.batchId);

		const queryString = query.toString();
		const url = `${getApiBaseUrl()}/api/audit-logs/export/json${queryString ? `?${queryString}` : ''}`;

		// Trigger download
		window.open(url, '_blank');
	}
};

// Backup API
export interface BackupStatus {
	enabled: boolean;
	schedule: string;
	nasConfigured: boolean;
	lastBackup?: Date;
	config: {
		nasHost: string;
		nasShare: string;
		nasFolder: string;
		retentionDays: number;
		localDir: string;
	};
}

export interface BackupResult {
	success: boolean;
	message: string;
	timestamp: Date;
	localPath?: string;
	nasPath?: string;
	size?: number;
}

export const backupAPI = {
	async getStatus(): Promise<BackupStatus> {
		return apiFetch('/api/backup/status');
	},

	async triggerManual(): Promise<BackupResult> {
		return apiFetch('/api/backup/manual', {
			method: 'POST'
		});
	}
};

// ========================================
// Settings API
// ========================================

export interface AppSettings {
	vendors: boolean;
	customers: boolean;
	inventory: boolean;
	timeTracking: boolean;
	bookings: boolean;
}

export const settingsAPI = {
	async get(): Promise<AppSettings> {
		return apiFetch('/api/settings');
	},
	async update(data: Partial<AppSettings>): Promise<AppSettings> {
		return apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify(data) });
	}
};

// ========================================
// Inventory API
// ========================================

export interface FieldDefinition {
	key: string;
	label: string;
	type: 'text' | 'number' | 'computed';
	unit?: string;
	formula?: string;
}

export interface InventoryCategory {
	id: number;
	name: string;
	description?: string | null;
	categoryType: 'raw_material' | 'finished_good' | 'other';
	quantityField?: string | null;
	fieldDefinitions: FieldDefinition[];
	valueFormula: string;
	itemCount?: number;
	totalValue?: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface InventoryItem {
	id: number;
	categoryId: number;
	name: string;
	fieldValues: Record<string, string | number>;
	totalValue: number;
	quantity: number;
	dispositionType?: 'sale' | 'own_use' | 'gift' | null;
	remainingQuantity?: number | null;
	remainingValue?: number | null;
	saleEntryId?: number | null;
	customerId?: number | null;
	customerName?: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface CustomerPurchase {
	journalEntryId: number;
	entryDate: Date;
	amount: number;
	currencyCode: string;
	description: string;
	inventoryLinkType?: 'sale' | 'own_use' | 'gift' | null;
	inventoryItemId?: number | null;
	inventoryItemName?: string | null;
	inventoryItemValue?: number | null;
}

export interface CustomerBooking {
	id: number;
	platformId: number;
	platformName?: string | null;
	checkInDate: string;
	checkOutDate: string;
	nights: number;
	totalPaid: number;
	netAmount: number;
	cleaningFee: number;
	salesTax: number;
	touristTax: number;
	platformFee: number;
	rentalFee: number;
	comment?: string | null;
}

export interface MaterialAllocation {
	id: number;
	rawMaterialItemId: number;
	finishedGoodItemId: number;
	quantityUsed: number;
	notes?: string | null;
	allocationDate?: string | null;
	createdAt: Date;
	// Joined fields
	finishedGoodName?: string;
	rawMaterialName?: string;
}

export interface RawMaterialItem extends InventoryItem {
	categoryName: string;
	quantityField: string | null;
}

export interface InventorySummary {
	finishedGoods: {
		availableCount: number;
		availableValue: number;
		soldCount: number;
		soldValue: number;
		ownUseCount: number;
		ownUseValue: number;
		giftCount: number;
		giftValue: number;
		totalCount: number;
	};
	rawMaterials: {
		categoryId: number;
		categoryName: string;
		quantityField: string | null;
		fieldDefinitions: FieldDefinition[];
		totalRemainingQuantity: number;
		totalRemainingValue: number;
		itemCount: number;
	}[];
}

export interface FinishedGoodSummaryItem {
	id: number;
	name: string;
	categoryId: number;
	categoryName: string;
	totalValue: number;
	quantity: number;
	dispositionType: string | null;
	createdAt: Date;
}

export const inventoryAPI = {
	async getSummary(): Promise<InventorySummary> {
		return apiFetch('/api/inventory/summary');
	},

	async listFinishedGoods(disposition?: string): Promise<FinishedGoodSummaryItem[]> {
		const q = disposition ? `?disposition=${disposition}` : '';
		return apiFetch(`/api/inventory/finished-goods${q}`);
	},

	async listCategories(): Promise<InventoryCategory[]> {
		return apiFetch('/api/inventory/categories');
	},

	async getCategory(id: number): Promise<InventoryCategory> {
		return apiFetch(`/api/inventory/categories/${id}`);
	},

	async createCategory(data: Omit<InventoryCategory, 'id' | 'itemCount' | 'totalValue' | 'createdAt' | 'updatedAt'>): Promise<InventoryCategory> {
		return apiFetch('/api/inventory/categories', { method: 'POST', body: JSON.stringify(data) });
	},

	async updateCategory(id: number, data: Partial<Omit<InventoryCategory, 'id' | 'itemCount' | 'totalValue' | 'createdAt' | 'updatedAt'>>): Promise<InventoryCategory> {
		return apiFetch(`/api/inventory/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) });
	},

	async deleteCategory(id: number): Promise<void> {
		return apiFetch(`/api/inventory/categories/${id}`, { method: 'DELETE' });
	},

	async listItems(categoryId: number): Promise<InventoryItem[]> {
		return apiFetch(`/api/inventory/categories/${categoryId}/items`);
	},

	async createItem(categoryId: number, data: { name: string; fieldValues: Record<string, string | number> }): Promise<InventoryItem> {
		return apiFetch(`/api/inventory/categories/${categoryId}/items`, { method: 'POST', body: JSON.stringify(data) });
	},

	async updateItem(id: number, data: { name?: string; fieldValues?: Record<string, string | number>; quantity?: number }): Promise<InventoryItem> {
		return apiFetch(`/api/inventory/items/${id}`, { method: 'PUT', body: JSON.stringify(data) });
	},

	async deleteItem(id: number): Promise<void> {
		return apiFetch(`/api/inventory/items/${id}`, { method: 'DELETE' });
	},

	async markOwnUse(id: number): Promise<void> {
		return apiFetch(`/api/inventory/items/${id}/own-use`, { method: 'POST' });
	},

	async getItemAllocations(itemId: number): Promise<{ asRawMaterial: MaterialAllocation[]; asFinishedGood: MaterialAllocation[] }> {
		return apiFetch(`/api/inventory/items/${itemId}/allocations`);
	},

	async listRawMaterialItems(): Promise<RawMaterialItem[]> {
		return apiFetch('/api/inventory/raw-material-items');
	},

	async createAllocation(data: { rawMaterialItemId: number; finishedGoodItemId: number; quantityUsed: number; notes?: string; allocationDate?: string }): Promise<MaterialAllocation> {
		return apiFetch('/api/inventory/allocations', { method: 'POST', body: JSON.stringify(data) });
	},

	async deleteAllocation(id: number): Promise<void> {
		return apiFetch(`/api/inventory/allocations/${id}`, { method: 'DELETE' });
	},

	async downloadCSV(categoryId: number, categoryName: string): Promise<void> {
		const url = `${getApiBaseUrl()}/api/inventory/categories/${categoryId}/export/csv`;
		const response = await fetch(url);
		if (!response.ok) throw new Error('Failed to download CSV');
		const blob = await response.blob();
		const link = document.createElement('a');
		link.href = URL.createObjectURL(blob);
		link.download = `${categoryName.replace(/[^a-z0-9]/gi, '_')}-inventory.csv`;
		link.click();
		URL.revokeObjectURL(link.href);
	},

	async uploadCSV(categoryId: number, file: File): Promise<{ imported: number; skipped: number; errors: string[] }> {
		const formData = new FormData();
		formData.append('file', file);
		const url = `${getApiBaseUrl()}/api/inventory/categories/${categoryId}/import/csv`;
		const response = await fetch(url, { method: 'POST', body: formData });
		if (!response.ok) {
			const err = await response.json().catch(() => ({ message: response.statusText }));
			throw new Error(err.message || 'Upload failed');
		}
		return response.json();
	}
};

// ========================================
// Bookings API
// ========================================

export interface BookingPlatform {
	id: number;
	name: string;
	sortOrder: number;
	createdAt?: Date;
}

export interface BookingConfig {
	cleaningFee: number;
	salesTaxRate: number;
	touristTaxRate: number;
	platformFeeRate: number;
}

export interface Booking {
	id: number;
	customerId: number;
	customerFirstName?: string | null;
	customerLastName?: string | null;
	platformId: number;
	platformName?: string | null;
	checkInDate: string;
	checkOutDate: string;
	nights: number;
	totalPaid: number;
	netAmount: number;
	cleaningFee: number;
	salesTax: number;
	touristTax: number;
	platformFee: number;
	rentalFee: number;
	comment?: string | null;
	createdAt?: Date;
	updatedAt?: Date;
}

export type NewBooking = Omit<Booking, 'id' | 'customerFirstName' | 'customerLastName' | 'platformName' | 'createdAt' | 'updatedAt'>;

export const bookingsAPI = {
	async list(): Promise<Booking[]> {
		return apiFetch('/api/bookings');
	},
	async get(id: number): Promise<Booking> {
		return apiFetch(`/api/bookings/${id}`);
	},
	async create(data: NewBooking): Promise<Booking> {
		return apiFetch('/api/bookings', { method: 'POST', body: JSON.stringify(data) });
	},
	async update(id: number, data: Partial<NewBooking>): Promise<Booking> {
		return apiFetch(`/api/bookings/${id}`, { method: 'PUT', body: JSON.stringify(data) });
	},
	async delete(id: number): Promise<void> {
		return apiFetch(`/api/bookings/${id}`, { method: 'DELETE' });
	},

	// Config
	async getConfig(): Promise<BookingConfig> {
		return apiFetch('/api/bookings/config');
	},
	async updateConfig(data: Partial<BookingConfig>): Promise<BookingConfig> {
		return apiFetch('/api/bookings/config', { method: 'PUT', body: JSON.stringify(data) });
	},

	// Platforms
	async listPlatforms(): Promise<BookingPlatform[]> {
		return apiFetch('/api/bookings/platforms');
	},
	async createPlatform(data: { name: string; sortOrder?: number }): Promise<BookingPlatform> {
		return apiFetch('/api/bookings/platforms', { method: 'POST', body: JSON.stringify(data) });
	},
	async updatePlatform(id: number, data: { name: string; sortOrder?: number }): Promise<BookingPlatform> {
		return apiFetch(`/api/bookings/platforms/${id}`, { method: 'PUT', body: JSON.stringify(data) });
	},
	async deletePlatform(id: number): Promise<void> {
		return apiFetch(`/api/bookings/platforms/${id}`, { method: 'DELETE' });
	}
};
