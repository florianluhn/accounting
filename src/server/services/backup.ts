import { CONFIG } from '../config.js';
import { mkdir, readdir, stat, rm, copyFile } from 'fs/promises';
import { join, basename } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';

const execAsync = promisify(exec);

interface BackupResult {
	success: boolean;
	timestamp: Date;
	localPath?: string;
	nasPath?: string;
	error?: string;
	size?: number;
}

/**
 * Format date as YYYY-MM-DD_HH-mm-ss for backup filenames
 */
function formatBackupTimestamp(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	const seconds = String(date.getSeconds()).padStart(2, '0');
	return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

/**
 * Get the size of a file or directory in bytes
 */
async function getSize(path: string): Promise<number> {
	const stats = await stat(path);
	if (stats.isFile()) {
		return stats.size;
	}

	// For directories, sum all files recursively
	let totalSize = 0;
	const files = await readdir(path, { withFileTypes: true });

	for (const file of files) {
		const filePath = join(path, file.name);
		if (file.isDirectory()) {
			totalSize += await getSize(filePath);
		} else {
			const fileStats = await stat(filePath);
			totalSize += fileStats.size;
		}
	}

	return totalSize;
}

/**
 * Copy directory recursively
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
	await mkdir(dest, { recursive: true });
	const files = await readdir(src, { withFileTypes: true });

	for (const file of files) {
		const srcPath = join(src, file.name);
		const destPath = join(dest, file.name);

		if (file.isDirectory()) {
			await copyDirectory(srcPath, destPath);
		} else {
			await copyFile(srcPath, destPath);
		}
	}
}

/**
 * Create local backup of database and attachments
 */
async function createLocalBackup(): Promise<{ path: string; size: number }> {
	const timestamp = formatBackupTimestamp(new Date());
	const backupDir = join(process.cwd(), CONFIG.BACKUP_LOCAL_DIR, timestamp);

	// Create backup directory
	await mkdir(backupDir, { recursive: true });

	// Copy database file
	const dbSource = join(process.cwd(), CONFIG.DATABASE_PATH);
	const dbDest = join(backupDir, basename(CONFIG.DATABASE_PATH));

	if (existsSync(dbSource)) {
		await copyFile(dbSource, dbDest);
		console.log(`✓ Database backed up: ${dbDest}`);
	} else {
		console.warn(`⚠ Database not found at: ${dbSource}`);
	}

	// Copy attachments directory
	const attachmentsSource = join(process.cwd(), CONFIG.ATTACHMENTS_PATH);
	const attachmentsDest = join(backupDir, 'attachments');

	if (existsSync(attachmentsSource)) {
		await copyDirectory(attachmentsSource, attachmentsDest);
		console.log(`✓ Attachments backed up: ${attachmentsDest}`);
	} else {
		console.log(`ℹ No attachments directory found at: ${attachmentsSource}`);
	}

	// Calculate total backup size
	const size = await getSize(backupDir);

	return { path: backupDir, size };
}

/**
 * Transfer backup to Synology NAS using SMB/CIFS
 */
async function transferToNAS(localPath: string): Promise<string> {
	if (!CONFIG.BACKUP_NAS_USERNAME || !CONFIG.BACKUP_NAS_PASSWORD) {
		throw new Error('NAS credentials not configured. Set BACKUP_NAS_USERNAME and BACKUP_NAS_PASSWORD in .env file.');
	}

	const backupName = basename(localPath);
	const nasPath = `//${CONFIG.BACKUP_NAS_HOST}/${CONFIG.BACKUP_NAS_SHARE}/${CONFIG.BACKUP_NAS_FOLDER}/${backupName}`;

	// Detect platform and use appropriate commands
	const platform = process.platform;

	if (platform === 'win32') {
		// Windows: Use net use and xcopy
		const driveLetter = 'Z:';
		const uncPath = `\\\\${CONFIG.BACKUP_NAS_HOST}\\${CONFIG.BACKUP_NAS_SHARE}`;

		try {
			// Map network drive
			await execAsync(`net use ${driveLetter} "${uncPath}" /user:${CONFIG.BACKUP_NAS_USERNAME} "${CONFIG.BACKUP_NAS_PASSWORD}"`);

			// Create destination folder
			const destFolder = `${driveLetter}\\${CONFIG.BACKUP_NAS_FOLDER}`;
			await execAsync(`if not exist "${destFolder}" mkdir "${destFolder}"`);

			// Copy backup
			const destPath = `${destFolder}\\${backupName}`;
			await execAsync(`xcopy "${localPath}" "${destPath}" /E /I /Y`);

			// Disconnect network drive
			await execAsync(`net use ${driveLetter} /delete`);

			console.log(`✓ Backup transferred to NAS: ${nasPath}`);
			return nasPath;
		} catch (error) {
			// Try to cleanup drive mapping
			try {
				await execAsync(`net use ${driveLetter} /delete`);
			} catch {}
			throw error;
		}
	} else {
		// Linux/macOS: Use mount and cp
		const mountPoint = '/mnt/nas_backup';

		try {
			// Create mount point
			await execAsync(`sudo mkdir -p ${mountPoint}`);

			// Mount NAS share
			const mountCmd = `sudo mount -t cifs "//${CONFIG.BACKUP_NAS_HOST}/${CONFIG.BACKUP_NAS_SHARE}" ${mountPoint} -o username=${CONFIG.BACKUP_NAS_USERNAME},password="${CONFIG.BACKUP_NAS_PASSWORD}"`;
			await execAsync(mountCmd);

			// Create destination folder
			const destFolder = `${mountPoint}/${CONFIG.BACKUP_NAS_FOLDER}`;
			await execAsync(`sudo mkdir -p "${destFolder}"`);

			// Copy backup
			const destPath = `${destFolder}/${backupName}`;
			await execAsync(`sudo cp -r "${localPath}" "${destPath}"`);

			// Unmount
			await execAsync(`sudo umount ${mountPoint}`);

			console.log(`✓ Backup transferred to NAS: ${nasPath}`);
			return nasPath;
		} catch (error) {
			// Try to cleanup mount
			try {
				await execAsync(`sudo umount ${mountPoint}`);
			} catch {}
			throw error;
		}
	}
}

/**
 * Clean up old local backups based on retention policy
 */
async function cleanupOldBackups(): Promise<number> {
	const backupBaseDir = join(process.cwd(), CONFIG.BACKUP_LOCAL_DIR);

	if (!existsSync(backupBaseDir)) {
		return 0;
	}

	const now = new Date();
	const retentionMs = CONFIG.BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
	const cutoffDate = new Date(now.getTime() - retentionMs);

	const backups = await readdir(backupBaseDir);
	let deletedCount = 0;

	for (const backup of backups) {
		const backupPath = join(backupBaseDir, backup);
		const stats = await stat(backupPath);

		if (stats.isDirectory() && stats.mtime < cutoffDate) {
			await rm(backupPath, { recursive: true, force: true });
			console.log(`✓ Deleted old backup: ${backup}`);
			deletedCount++;
		}
	}

	if (deletedCount > 0) {
		console.log(`✓ Cleaned up ${deletedCount} old backup(s)`);
	}

	return deletedCount;
}

/**
 * Perform a complete backup operation
 */
export async function performBackup(): Promise<BackupResult> {
	const startTime = new Date();

	console.log('========================================');
	console.log(`Starting backup at ${startTime.toISOString()}`);
	console.log('========================================');

	try {
		// Step 1: Create local backup
		console.log('\n[1/3] Creating local backup...');
		const { path: localPath, size } = await createLocalBackup();
		console.log(`✓ Local backup created: ${localPath} (${(size / 1024 / 1024).toFixed(2)} MB)`);

		// Step 2: Transfer to NAS (if credentials configured)
		let nasPath: string | undefined;
		if (CONFIG.BACKUP_NAS_USERNAME && CONFIG.BACKUP_NAS_PASSWORD) {
			console.log('\n[2/3] Transferring to NAS...');
			nasPath = await transferToNAS(localPath);
		} else {
			console.log('\n[2/3] Skipping NAS transfer (credentials not configured)');
		}

		// Step 3: Clean up old backups
		console.log('\n[3/3] Cleaning up old backups...');
		await cleanupOldBackups();

		const endTime = new Date();
		const duration = (endTime.getTime() - startTime.getTime()) / 1000;

		console.log('\n========================================');
		console.log(`✓ Backup completed successfully in ${duration.toFixed(2)}s`);
		console.log('========================================\n');

		return {
			success: true,
			timestamp: startTime,
			localPath,
			nasPath,
			size
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';

		console.error('\n========================================');
		console.error(`✗ Backup failed: ${errorMessage}`);
		console.error('========================================\n');

		return {
			success: false,
			timestamp: startTime,
			error: errorMessage
		};
	}
}

/**
 * Get status of backup configuration
 */
export function getBackupStatus(): {
	enabled: boolean;
	schedule: string;
	nasConfigured: boolean;
	lastBackup?: Date;
} {
	return {
		enabled: CONFIG.BACKUP_ENABLED,
		schedule: CONFIG.BACKUP_CRON,
		nasConfigured: !!(CONFIG.BACKUP_NAS_USERNAME && CONFIG.BACKUP_NAS_PASSWORD)
	};
}
