import { config } from 'dotenv';

// Load environment variables
config();

export const CONFIG = {
	// Server
	PORT: parseInt(process.env.PORT || '3000', 10),
	HOST: process.env.HOST || '0.0.0.0',
	NODE_ENV: process.env.NODE_ENV || 'development',

	// Database
	DATABASE_PATH: process.env.DATABASE_PATH || './data/accounting.db',

	// File Storage
	ATTACHMENTS_PATH: process.env.ATTACHMENTS_PATH || './data/attachments',
	MAX_FILE_SIZE_MB: parseInt(process.env.MAX_FILE_SIZE_MB || '10', 10),
	MAX_STORAGE_GB: parseInt(process.env.MAX_STORAGE_GB || '40', 10),

	// Derived values
	get MAX_FILE_SIZE_BYTES() {
		return this.MAX_FILE_SIZE_MB * 1024 * 1024;
	},
	get MAX_STORAGE_BYTES() {
		return this.MAX_STORAGE_GB * 1024 * 1024 * 1024;
	}
} as const;
