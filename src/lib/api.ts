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
		const headers: Record<string, string> = { ...options.headers };
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
	}): Promise<JournalEntry[]> {
		const query = new URLSearchParams();
		if (params?.startDate) query.set('startDate', params.startDate.toISOString());
		if (params?.endDate) query.set('endDate', params.endDate.toISOString());
		if (params?.debitAccountId) query.set('debitAccountId', String(params.debitAccountId));
		if (params?.creditAccountId) query.set('creditAccountId', String(params.creditAccountId));
		if (params?.category) query.set('category', params.category);
		if (params?.currencyCode) query.set('currencyCode', params.currencyCode);

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
