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
		vendorId: integer('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
		customerId: integer('customer_id').references(() => customers.id, { onDelete: 'set null' }),
		inventoryItemId: integer('inventory_item_id'), // optional link to a finished good item
		inventoryLinkType: text('inventory_link_type'), // 'sale' | 'own_use'
		fixedAssetId: integer('fixed_asset_id'), // optional link to a fixed asset
		isDepreciation: integer('is_depreciation', { mode: 'boolean' }).notNull().default(false), // true if this is an auto-posted depreciation entry
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
		currencyIdx: index('idx_journal_entries_currency').on(table.currencyCode),
		vendorIdx: index('idx_journal_entries_vendor').on(table.vendorId),
		customerIdx: index('idx_journal_entries_customer').on(table.customerId),
		inventoryItemIdx: index('idx_journal_entries_inventory_item').on(table.inventoryItemId),
		fixedAssetIdx: index('idx_journal_entries_fixed_asset').on(table.fixedAssetId)
	})
);

// ========================================
// Vendors Table
// ========================================
export const vendors = sqliteTable(
	'vendors',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		name: text('name').notNull(),
		address: text('address'),
		phone: text('phone'),
		email: text('email'),
		website: text('website'),
		comments: text('comments'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(table) => ({
		nameIdx: index('idx_vendors_name').on(table.name)
	})
);

// ========================================
// Customers Table
// ========================================
export const customers = sqliteTable(
	'customers',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		firstName: text('first_name').notNull(),
		lastName: text('last_name').notNull(),
		email: text('email'),
		phone: text('phone'),
		country: text('country'),
		state: text('state'),
		zipCode: text('zip_code'),
		city: text('city'),
		street: text('street'),
		streetNumber: text('street_number'),
		contactMethod: text('contact_method'),
		comment: text('comment'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(table) => ({
		lastNameIdx: index('idx_customers_last_name').on(table.lastName)
	})
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;

// ========================================
// Attachments Table
// ========================================
export const attachments = sqliteTable(
	'attachments',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		journalEntryId: integer('journal_entry_id').references(() => journalEntries.id, {
			onDelete: 'cascade'
		}),
		bookingId: integer('booking_id').references(() => bookings.id, { onDelete: 'cascade' }),
		inventoryItemId: integer('inventory_item_id').references(() => inventoryItems.id, { onDelete: 'cascade' }),
		filename: text('filename').notNull(), // Original filename
		storedFilename: text('stored_filename').notNull(), // UUID-based storage name
		mimeType: text('mime_type').notNull(),
		fileSize: integer('file_size').notNull(), // Bytes
		uploadedAt: integer('uploaded_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(table) => ({
		journalEntryIdx: index('idx_attachments_journal').on(table.journalEntryId),
		bookingIdx: index('idx_attachments_booking').on(table.bookingId),
		inventoryItemIdx: index('idx_attachments_inventory_item').on(table.inventoryItemId)
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
// Time Entries Table
// ========================================
export const timeEntries = sqliteTable(
	'time_entries',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		entryDate: integer('entry_date', { mode: 'timestamp' }).notNull(),
		hours: integer('hours').notNull().default(0),
		minutes: integer('minutes').notNull().default(0),
		activity: text('activity').notNull(),
		description: text('description'),
		who: text('who').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(table) => ({
		dateIdx: index('idx_time_entries_date').on(table.entryDate),
		whoIdx: index('idx_time_entries_who').on(table.who),
		activityIdx: index('idx_time_entries_activity').on(table.activity)
	})
);

// ========================================
// Budgets Table
// ========================================
export const budgets = sqliteTable(
	'budgets',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		subledgerAccountId: integer('subledger_account_id')
			.notNull()
			.references(() => subledgerAccounts.id, { onDelete: 'cascade' }),
		year: integer('year').notNull(),
		amount: real('amount').notNull().default(0), // Budget amount in USD
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(table) => ({
		uniqueBudget: unique('unique_budget_account_year').on(table.subledgerAccountId, table.year),
		accountIdx: index('idx_budgets_account').on(table.subledgerAccountId),
		yearIdx: index('idx_budgets_year').on(table.year)
	})
);

// ========================================
// Inventory Categories Table
// ========================================
export const inventoryCategories = sqliteTable(
	'inventory_categories',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		name: text('name').notNull(),
		description: text('description'),
		assetAccountId: integer('asset_account_id'), // retained for data compatibility, no longer used
		// 'raw_material' | 'finished_good' | 'other'
		categoryType: text('category_type').notNull().default('other'),
		// For raw_material categories: which field key holds the quantity unit (e.g. 'board_feet')
		// Used to compute remainingQuantity after consumption allocations
		quantityField: text('quantity_field'),
		// JSON array of FieldDefinition objects
		fieldDefinitions: text('field_definitions').notNull().default('[]'),
		// Formula using field keys to compute monetary value per item (e.g. "board_feet * price_per_bf")
		valueFormula: text('value_formula').notNull().default('0'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(table) => ({
		nameIdx: index('idx_inventory_categories_name').on(table.name),
		accountIdx: index('idx_inventory_categories_account').on(table.assetAccountId)
	})
);

// ========================================
// Inventory Items Table
// ========================================
export const inventoryItems = sqliteTable(
	'inventory_items',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		categoryId: integer('category_id')
			.notNull()
			.references(() => inventoryCategories.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		// JSON object: { fieldKey: value }
		fieldValues: text('field_values').notNull().default('{}'),
		// Stored monetary value computed from category's valueFormula — used for balance sheet SUM()
		totalValue: real('total_value').notNull().default(0),
		// For finished goods: 1 = in stock, 0 = sold/consumed. User-managed.
		quantity: integer('quantity').notNull().default(1),
		// For finished goods: how the item was disposed of ('sale' | 'own_use'), set directly or via journal entry
		dispositionType: text('disposition_type'),
		// Raw material only: how much quantity remains after consumption allocations
		remainingQuantity: real('remaining_quantity'),
		// Raw material only: monetary value of remaining quantity (used for balance sheet)
		remainingValue: real('remaining_value'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(table) => ({
		categoryIdx: index('idx_inventory_items_category').on(table.categoryId)
	})
);

// ========================================
// Material Allocations Table
// ========================================
export const materialAllocations = sqliteTable(
	'material_allocations',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		// The raw material item being consumed (e.g. a walnut board)
		rawMaterialItemId: integer('raw_material_item_id')
			.notNull()
			.references(() => inventoryItems.id, { onDelete: 'cascade' }),
		// The finished good item this material went into (e.g. a cutting board)
		finishedGoodItemId: integer('finished_good_item_id')
			.notNull()
			.references(() => inventoryItems.id, { onDelete: 'cascade' }),
		// How much of the raw material was used (in the raw material category's quantityField unit)
		quantityUsed: real('quantity_used').notNull(),
		notes: text('notes'),
		allocationDate: text('allocation_date'), // ISO date string e.g. '2026-04-05'
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(table) => ({
		rawMaterialIdx: index('idx_allocations_raw_material').on(table.rawMaterialItemId),
		finishedGoodIdx: index('idx_allocations_finished_good').on(table.finishedGoodItemId)
	})
);

export type InventoryCategory = typeof inventoryCategories.$inferSelect;
export type NewInventoryCategory = typeof inventoryCategories.$inferInsert;
export type InventoryItem = typeof inventoryItems.$inferSelect;
export type NewInventoryItem = typeof inventoryItems.$inferInsert;
export type MaterialAllocation = typeof materialAllocations.$inferSelect;
export type NewMaterialAllocation = typeof materialAllocations.$inferInsert;

// ========================================
// Fixed Assets Table
// ========================================
export const fixedAssets = sqliteTable(
	'fixed_assets',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		name: text('name').notNull(),
		description: text('description'),
		// Subledger account to credit when posting depreciation (accumulated depreciation / asset contra)
		assetAccountId: integer('asset_account_id')
			.notNull()
			.references(() => subledgerAccounts.id, { onDelete: 'restrict' }),
		// Subledger account to debit when posting depreciation (depreciation expense)
		expenseAccountId: integer('expense_account_id')
			.notNull()
			.references(() => subledgerAccounts.id, { onDelete: 'restrict' }),
		// Depreciation settings
		depreciationMethod: text('depreciation_method').notNull(), // 'SL' | '200DB' | '150DB' | 'Immediate'
		convention: text('convention').notNull(), // 'half_year' | 'mid_month' | 'mid_quarter'
		usefulLifeMonths: integer('useful_life_months').notNull(), // e.g. 60 = 5 years
		salvageValue: real('salvage_value').notNull().default(0),
		// Date the asset was placed in service (ISO date string, null = not yet activated)
		activationDate: text('activation_date'),
		// Timestamps
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(table) => ({
		nameIdx: index('idx_fixed_assets_name').on(table.name),
		assetAccIdx: index('idx_fixed_assets_asset_account').on(table.assetAccountId),
		expenseAccIdx: index('idx_fixed_assets_expense_account').on(table.expenseAccountId)
	})
);

export type FixedAsset = typeof fixedAssets.$inferSelect;
export type NewFixedAsset = typeof fixedAssets.$inferInsert;

// ========================================
// App Settings Table (key-value)
// ========================================
export const appSettings = sqliteTable('app_settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

// ========================================
// Booking Platforms Table
// ========================================
export const bookingPlatforms = sqliteTable(
	'booking_platforms',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		name: text('name').notNull().unique(),
		sortOrder: integer('sort_order').notNull().default(0),
		platformFeeRate: real('platform_fee_rate').notNull().default(0),
		withholdsTaxes: integer('withholds_taxes', { mode: 'boolean' }).notNull().default(false),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(table) => ({
		nameIdx: index('idx_booking_platforms_name').on(table.name)
	})
);

// ========================================
// Bookings Table
// ========================================
export const bookings = sqliteTable(
	'bookings',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		customerId: integer('customer_id')
			.notNull()
			.references(() => customers.id, { onDelete: 'restrict' }),
		platformId: integer('platform_id')
			.notNull()
			.references(() => bookingPlatforms.id, { onDelete: 'restrict' }),
		checkInDate: text('check_in_date').notNull(), // ISO date yyyy-mm-dd
		checkOutDate: text('check_out_date').notNull(),
		nights: integer('nights').notNull().default(0),
		totalPaid: real('total_paid').notNull().default(0),
		netAmount: real('net_amount').notNull().default(0),
		cleaningFee: real('cleaning_fee').notNull().default(0),
		salesTax: real('sales_tax').notNull().default(0),
		touristTax: real('tourist_tax').notNull().default(0),
		platformFee: real('platform_fee').notNull().default(0),
		rentalFee: real('rental_fee').notNull().default(0),
		comment: text('comment'),
		// When the booking was recorded in the system (editable calendar date, yyyy-mm-dd)
		addedDate: text('added_date').notNull().default(sql`(date('now'))`),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(table) => ({
		customerIdx: index('idx_bookings_customer').on(table.customerId),
		platformIdx: index('idx_bookings_platform').on(table.platformId),
		checkInIdx: index('idx_bookings_check_in').on(table.checkInDate)
	})
);

export type BookingPlatform = typeof bookingPlatforms.$inferSelect;
export type NewBookingPlatform = typeof bookingPlatforms.$inferInsert;
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;

// ========================================
// Audit Logs Table
// ========================================
export const auditLogs = sqliteTable(
	'audit_logs',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		operation: text('operation', { enum: ['CREATE', 'UPDATE', 'DELETE'] }).notNull(),
		resourceType: text('resource_type', {
			enum: ['currency', 'gl_account', 'subledger_account', 'journal_entry', 'attachment', 'vendor', 'customer', 'time_entry', 'inventory_category', 'inventory_item']
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

export type Vendor = typeof vendors.$inferSelect;
export type NewVendor = typeof vendors.$inferInsert;

export type TimeEntry = typeof timeEntries.$inferSelect;
export type NewTimeEntry = typeof timeEntries.$inferInsert;

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;
