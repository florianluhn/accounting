import { config } from 'dotenv';

// Load environment variables
config();

export const CONFIG = {
	// Application
	APP_NAME: process.env.APP_NAME || 'Accounting App',
	APP_SHORT_NAME: process.env.APP_SHORT_NAME || 'Accounting',
	APP_DESCRIPTION: process.env.APP_DESCRIPTION || 'Personal finance accounting with double-entry bookkeeping',

	// Server
	PORT: parseInt(process.env.BACKEND_PORT || process.env.PORT || '3000', 10),
	HOST: process.env.BACKEND_HOST || process.env.HOST || '0.0.0.0',
	NODE_ENV: process.env.NODE_ENV || 'development',

	// Database
	DATABASE_PATH: process.env.DATABASE_PATH || './data/accounting.db',

	// File Storage
	ATTACHMENTS_PATH: process.env.ATTACHMENTS_PATH || './data/attachments',
	MAX_FILE_SIZE_MB: parseInt(process.env.MAX_FILE_SIZE_MB || '10', 10),
	MAX_STORAGE_GB: parseInt(process.env.MAX_STORAGE_GB || '40', 10),

	// Backup Configuration
	BACKUP_ENABLED: process.env.BACKUP_ENABLED === 'true',
	BACKUP_CRON: process.env.BACKUP_CRON || '0 2 * * *',
	BACKUP_NAS_HOST: process.env.BACKUP_NAS_HOST || '192.168.1.30',
	BACKUP_NAS_SHARE: process.env.BACKUP_NAS_SHARE || 'backup',
	BACKUP_NAS_FOLDER: process.env.BACKUP_NAS_FOLDER || 'accounting-backups',
	BACKUP_NAS_USERNAME: process.env.BACKUP_NAS_USERNAME || '',
	BACKUP_NAS_PASSWORD: process.env.BACKUP_NAS_PASSWORD || '',
	BACKUP_RETENTION_DAYS: parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10),
	BACKUP_LOCAL_DIR: process.env.BACKUP_LOCAL_DIR || './backups',

	// Derived values
	get MAX_FILE_SIZE_BYTES() {
		return this.MAX_FILE_SIZE_MB * 1024 * 1024;
	},
	get MAX_STORAGE_BYTES() {
		return this.MAX_STORAGE_GB * 1024 * 1024 * 1024;
	}
} as const;
