CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`source` text DEFAULT 'Web UI' NOT NULL,
	`batch_id` text,
	`batch_summary` text,
	`old_data` text,
	`new_data` text,
	`timestamp` integer DEFAULT (unixepoch()) NOT NULL,
	`description` text
);
--> statement-breakpoint
CREATE INDEX `idx_audit_logs_timestamp` ON `audit_logs` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_resource` ON `audit_logs` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_operation` ON `audit_logs` (`operation`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_source` ON `audit_logs` (`source`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_batch` ON `audit_logs` (`batch_id`);--> statement-breakpoint
CREATE TABLE `booking_platforms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`platform_fee_rate` real DEFAULT 0 NOT NULL,
	`withholds_taxes` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_platforms_name_unique` ON `booking_platforms` (`name`);--> statement-breakpoint
CREATE INDEX `idx_booking_platforms_name` ON `booking_platforms` (`name`);--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`platform_id` integer NOT NULL,
	`check_in_date` text NOT NULL,
	`check_out_date` text NOT NULL,
	`nights` integer DEFAULT 0 NOT NULL,
	`total_paid` real DEFAULT 0 NOT NULL,
	`net_amount` real DEFAULT 0 NOT NULL,
	`cleaning_fee` real DEFAULT 0 NOT NULL,
	`sales_tax` real DEFAULT 0 NOT NULL,
	`tourist_tax` real DEFAULT 0 NOT NULL,
	`platform_fee` real DEFAULT 0 NOT NULL,
	`rental_fee` real DEFAULT 0 NOT NULL,
	`comment` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`platform_id`) REFERENCES `booking_platforms`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_bookings_customer` ON `bookings` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_bookings_platform` ON `bookings` (`platform_id`);--> statement-breakpoint
CREATE INDEX `idx_bookings_check_in` ON `bookings` (`check_in_date`);--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subledger_account_id` integer NOT NULL,
	`year` integer NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`subledger_account_id`) REFERENCES `subledger_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_budgets_account` ON `budgets` (`subledger_account_id`);--> statement-breakpoint
CREATE INDEX `idx_budgets_year` ON `budgets` (`year`);--> statement-breakpoint
CREATE UNIQUE INDEX `unique_budget_account_year` ON `budgets` (`subledger_account_id`,`year`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`email` text,
	`phone` text,
	`country` text,
	`state` text,
	`zip_code` text,
	`city` text,
	`street` text,
	`street_number` text,
	`contact_method` text,
	`comment` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_customers_last_name` ON `customers` (`last_name`);--> statement-breakpoint
CREATE TABLE `fixed_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`asset_account_id` integer NOT NULL,
	`expense_account_id` integer NOT NULL,
	`depreciation_method` text NOT NULL,
	`convention` text NOT NULL,
	`useful_life_months` integer NOT NULL,
	`salvage_value` real DEFAULT 0 NOT NULL,
	`activation_date` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`asset_account_id`) REFERENCES `subledger_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`expense_account_id`) REFERENCES `subledger_accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_fixed_assets_name` ON `fixed_assets` (`name`);--> statement-breakpoint
CREATE INDEX `idx_fixed_assets_asset_account` ON `fixed_assets` (`asset_account_id`);--> statement-breakpoint
CREATE INDEX `idx_fixed_assets_expense_account` ON `fixed_assets` (`expense_account_id`);--> statement-breakpoint
CREATE TABLE `inventory_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`asset_account_id` integer,
	`category_type` text DEFAULT 'other' NOT NULL,
	`quantity_field` text,
	`field_definitions` text DEFAULT '[]' NOT NULL,
	`value_formula` text DEFAULT '0' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_categories_name` ON `inventory_categories` (`name`);--> statement-breakpoint
CREATE INDEX `idx_inventory_categories_account` ON `inventory_categories` (`asset_account_id`);--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`name` text NOT NULL,
	`field_values` text DEFAULT '{}' NOT NULL,
	`total_value` real DEFAULT 0 NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`disposition_type` text,
	`remaining_quantity` real,
	`remaining_value` real,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `inventory_categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_items_category` ON `inventory_items` (`category_id`);--> statement-breakpoint
CREATE TABLE `material_allocations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`raw_material_item_id` integer NOT NULL,
	`finished_good_item_id` integer NOT NULL,
	`quantity_used` real NOT NULL,
	`notes` text,
	`allocation_date` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`raw_material_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`finished_good_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_allocations_raw_material` ON `material_allocations` (`raw_material_item_id`);--> statement-breakpoint
CREATE INDEX `idx_allocations_finished_good` ON `material_allocations` (`finished_good_item_id`);--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entry_date` integer NOT NULL,
	`hours` integer DEFAULT 0 NOT NULL,
	`minutes` integer DEFAULT 0 NOT NULL,
	`activity` text NOT NULL,
	`description` text,
	`who` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_time_entries_date` ON `time_entries` (`entry_date`);--> statement-breakpoint
CREATE INDEX `idx_time_entries_who` ON `time_entries` (`who`);--> statement-breakpoint
CREATE INDEX `idx_time_entries_activity` ON `time_entries` (`activity`);--> statement-breakpoint
CREATE TABLE `vendors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`phone` text,
	`email` text,
	`website` text,
	`comments` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_vendors_name` ON `vendors` (`name`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`journal_entry_id` integer,
	`booking_id` integer,
	`inventory_item_id` integer,
	`filename` text NOT NULL,
	`stored_filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`file_size` integer NOT NULL,
	`uploaded_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_attachments`("id", "journal_entry_id", "booking_id", "inventory_item_id", "filename", "stored_filename", "mime_type", "file_size", "uploaded_at") SELECT "id", "journal_entry_id", "booking_id", "inventory_item_id", "filename", "stored_filename", "mime_type", "file_size", "uploaded_at" FROM `attachments`;--> statement-breakpoint
DROP TABLE `attachments`;--> statement-breakpoint
ALTER TABLE `__new_attachments` RENAME TO `attachments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_attachments_journal` ON `attachments` (`journal_entry_id`);--> statement-breakpoint
CREATE INDEX `idx_attachments_booking` ON `attachments` (`booking_id`);--> statement-breakpoint
CREATE INDEX `idx_attachments_inventory_item` ON `attachments` (`inventory_item_id`);--> statement-breakpoint
ALTER TABLE `journal_entries` ADD `vendor_id` integer REFERENCES vendors(id);--> statement-breakpoint
ALTER TABLE `journal_entries` ADD `customer_id` integer REFERENCES customers(id);--> statement-breakpoint
ALTER TABLE `journal_entries` ADD `inventory_item_id` integer;--> statement-breakpoint
ALTER TABLE `journal_entries` ADD `inventory_link_type` text;--> statement-breakpoint
ALTER TABLE `journal_entries` ADD `fixed_asset_id` integer;--> statement-breakpoint
ALTER TABLE `journal_entries` ADD `is_depreciation` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_journal_entries_vendor` ON `journal_entries` (`vendor_id`);--> statement-breakpoint
CREATE INDEX `idx_journal_entries_customer` ON `journal_entries` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_journal_entries_inventory_item` ON `journal_entries` (`inventory_item_id`);--> statement-breakpoint
CREATE INDEX `idx_journal_entries_fixed_asset` ON `journal_entries` (`fixed_asset_id`);