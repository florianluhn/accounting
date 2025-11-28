CREATE TABLE `account_balances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subledger_account_id` integer NOT NULL,
	`year` integer NOT NULL,
	`month` integer NOT NULL,
	`debit_total` real DEFAULT 0 NOT NULL,
	`credit_total` real DEFAULT 0 NOT NULL,
	`balance` real DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`subledger_account_id`) REFERENCES `subledger_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_account_balances_lookup` ON `account_balances` (`subledger_account_id`,`year`,`month`);--> statement-breakpoint
CREATE INDEX `idx_account_balances_period` ON `account_balances` (`year`,`month`);--> statement-breakpoint
CREATE UNIQUE INDEX `unique_account_period` ON `account_balances` (`subledger_account_id`,`year`,`month`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`journal_entry_id` integer NOT NULL,
	`filename` text NOT NULL,
	`stored_filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`file_size` integer NOT NULL,
	`uploaded_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_attachments_journal` ON `attachments` (`journal_entry_id`);--> statement-breakpoint
CREATE TABLE `currencies` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`symbol` text NOT NULL,
	`exchange_rate` real DEFAULT 1 NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gl_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_number` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gl_accounts_account_number_unique` ON `gl_accounts` (`account_number`);--> statement-breakpoint
CREATE INDEX `idx_gl_accounts_type` ON `gl_accounts` (`type`);--> statement-breakpoint
CREATE INDEX `idx_gl_accounts_active` ON `gl_accounts` (`is_active`);--> statement-breakpoint
CREATE TABLE `journal_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entry_date` integer NOT NULL,
	`amount` real NOT NULL,
	`currency_code` text DEFAULT 'USD' NOT NULL,
	`amount_in_usd` real NOT NULL,
	`debit_account_id` integer NOT NULL,
	`credit_account_id` integer NOT NULL,
	`description` text NOT NULL,
	`category` text,
	`comment` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`debit_account_id`) REFERENCES `subledger_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`credit_account_id`) REFERENCES `subledger_accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_journal_entries_date` ON `journal_entries` (`entry_date`);--> statement-breakpoint
CREATE INDEX `idx_journal_entries_debit` ON `journal_entries` (`debit_account_id`);--> statement-breakpoint
CREATE INDEX `idx_journal_entries_credit` ON `journal_entries` (`credit_account_id`);--> statement-breakpoint
CREATE INDEX `idx_journal_entries_category` ON `journal_entries` (`category`);--> statement-breakpoint
CREATE INDEX `idx_journal_entries_currency` ON `journal_entries` (`currency_code`);--> statement-breakpoint
CREATE TABLE `subledger_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gl_account_id` integer NOT NULL,
	`account_number` text NOT NULL,
	`name` text NOT NULL,
	`currency_code` text DEFAULT 'USD' NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`gl_account_id`) REFERENCES `gl_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subledger_accounts_account_number_unique` ON `subledger_accounts` (`account_number`);--> statement-breakpoint
CREATE INDEX `idx_subledger_gl_account` ON `subledger_accounts` (`gl_account_id`);--> statement-breakpoint
CREATE INDEX `idx_subledger_currency` ON `subledger_accounts` (`currency_code`);--> statement-breakpoint
CREATE INDEX `idx_subledger_active` ON `subledger_accounts` (`is_active`);