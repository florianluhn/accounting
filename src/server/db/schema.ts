import { sqliteTable, text, integer, real, unique, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Account Types Enum
export const ACCOUNT_TYPES = [
	'Asset',
	'Cash',
	'Accounts Receivable',
	'Equity',
	'Accounts Payable',
	'Profit',
	'Loss',
	'Opening Balance' // Special account type for initializing starting balances (excluded from reports)
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

// ========================================
// Currencies Table
// ========================================
export const currencies = sqliteTable('currencies', {
	code: text('code').primaryKey(), // USD, EUR, GBP
	name: text('name').notNull(), // US Dollar
	symbol: text('symbol').notNull(), // $
	exchangeRate: real('exchange_rate').notNull().default(1.0), // Rate to USD
	isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`)
});

// ========================================
// GL Accounts Table (Parent accounts)
// ========================================
export const glAccounts = sqliteTable(
	'gl_accounts',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		accountNumber: text('account_number').notNull().unique(), // e.g., "1000"
		name: text('name').notNull(), // e.g., "Cash and Bank Accounts"
		type: text('type', { enum: ACCOUNT_TYPES }).notNull(),
		description: text('description'),
		isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(table) => ({
		typeIdx: index('idx_gl_accounts_type').on(table.type),
		activeIdx: index('idx_gl_accounts_active').on(table.isActive)
	})
);

// ========================================
// Subledger Accounts Table (Detail accounts)
// ========================================
export const subledgerAccounts = sqliteTable(
	'subledger_accounts',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		glAccountId: integer('gl_account_id')
			.notNull()
			.references(() => glAccounts.id, { onDelete: 'restrict' }),
		accountNumber: text('account_number').notNull().unique(), // e.g., "1001"
		name: text('name').notNull(), // e.g., "Chase Checking"
		currencyCode: text('currency_code')
			.notNull()
			.references(() => currencies.code, { onDelete: 'restrict' })
			.default('USD'),
		description: text('description'),
		isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(table) => ({
		glAccountIdx: index('idx_subledger_gl_account').on(table.glAccountId),
		currencyIdx: index('idx_subledger_currency').on(table.currencyCode),
		activeIdx: index('idx_subledger_active').on(table.isActive)
	})
);

// ========================================
// Journal Entries Table
// ========================================
export const journalEntries = sqliteTable(
	'journal_entries',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		entryDate: integer('entry_date', { mode: 'timestamp' }).notNull(), // Transaction date
		amount: real('amount').notNull(), // Always positive, in entry currency
		currencyCode: text('currency_code')
			.notNull()
			.references(() => currencies.code, { onDelete: 'restrict' })
			.default('USD'),
		amountInUSD: real('amount_in_usd').notNull(), // Converted amount for reporting
		debitAccountId: integer('debit_account_id')
			.notNull()
			.references(() => subledgerAccounts.id, { onDelete: 'restrict' }),
		creditAccountId: integer('credit_account_id')
			.notNull()
			.references(() => subledgerAccounts.id, { onDelete: 'restrict' }),
		description: text('description').notNull(),
		category: text('category'), // Optional categorization
		comment: text('comment'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(table) => ({
		dateIdx: index('idx_journal_entries_date').on(table.entryDate),
		debitIdx: index('idx_journal_entries_debit').on(table.debitAccountId),
		creditIdx: index('idx_journal_entries_credit').on(table.creditAccountId),
		categoryIdx: index('idx_journal_entries_category').on(table.category),
		currencyIdx: index('idx_journal_entries_currency').on(table.currencyCode)
	})
);

// ========================================
// Attachments Table
// ========================================
export const attachments = sqliteTable(
	'attachments',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		journalEntryId: integer('journal_entry_id')
			.notNull()
			.references(() => journalEntries.id, { onDelete: 'cascade' }),
		filename: text('filename').notNull(), // Original filename
		storedFilename: text('stored_filename').notNull(), // UUID-based storage name
		mimeType: text('mime_type').notNull(),
		fileSize: integer('file_size').notNull(), // Bytes
		uploadedAt: integer('uploaded_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(table) => ({
		journalEntryIdx: index('idx_attachments_journal').on(table.journalEntryId)
	})
);

// ========================================
// Account Balances Cache Table (for performance)
// ========================================
export const accountBalances = sqliteTable(
	'account_balances',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		subledgerAccountId: integer('subledger_account_id')
			.notNull()
			.references(() => subledgerAccounts.id, { onDelete: 'cascade' }),
		year: integer('year').notNull(),
		month: integer('month').notNull(), // 1-12
		debitTotal: real('debit_total').notNull().default(0),
		creditTotal: real('credit_total').notNull().default(0),
		balance: real('balance').notNull().default(0), // In USD
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(table) => ({
		uniqueAccountPeriod: unique('unique_account_period').on(
			table.subledgerAccountId,
			table.year,
			table.month
		),
		lookupIdx: index('idx_account_balances_lookup').on(
			table.subledgerAccountId,
			table.year,
			table.month
		),
		periodIdx: index('idx_account_balances_period').on(table.year, table.month)
	})
);

// ========================================
// Audit Logs Table
// ========================================
export const auditLogs = sqliteTable(
	'audit_logs',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		operation: text('operation', { enum: ['CREATE', 'UPDATE', 'DELETE'] }).notNull(),
		resourceType: text('resource_type', {
			enum: ['currency', 'gl_account', 'subledger_account', 'journal_entry', 'attachment']
		}).notNull(),
		resourceId: text('resource_id').notNull(),
		source: text('source', { enum: ['Web UI', 'CSV Import', 'API'] }).notNull().default('Web UI'),
		batchId: text('batch_id'),
		batchSummary: text('batch_summary'),
		oldData: text('old_data'),
		newData: text('new_data'),
		timestamp: integer('timestamp', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
		description: text('description')
	},
	(table) => ({
		timestampIdx: index('idx_audit_logs_timestamp').on(table.timestamp),
		resourceIdx: index('idx_audit_logs_resource').on(table.resourceType, table.resourceId),
		operationIdx: index('idx_audit_logs_operation').on(table.operation),
		sourceIdx: index('idx_audit_logs_source').on(table.source),
		batchIdx: index('idx_audit_logs_batch').on(table.batchId)
	})
);

// ========================================
// Type exports for TypeScript
// ========================================
export type Currency = typeof currencies.$inferSelect;
export type NewCurrency = typeof currencies.$inferInsert;

export type GLAccount = typeof glAccounts.$inferSelect;
export type NewGLAccount = typeof glAccounts.$inferInsert;

export type SubledgerAccount = typeof subledgerAccounts.$inferSelect;
export type NewSubledgerAccount = typeof subledgerAccounts.$inferInsert;

export type JournalEntry = typeof journalEntries.$inferSelect;
export type NewJournalEntry = typeof journalEntries.$inferInsert;

export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;

export type AccountBalance = typeof accountBalances.$inferSelect;
export type NewAccountBalance = typeof accountBalances.$inferInsert;

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
