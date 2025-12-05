import type { FastifyInstance } from 'fastify';
import { performBackup, getBackupStatus } from '../services/backup.js';
import { CONFIG } from '../config.js';

export default async function backupRoutes(fastify: FastifyInstance) {
	// GET /api/backup/status - Get backup configuration status
	fastify.get('/status', async (request, reply) => {
		const status = getBackupStatus();

		return {
			...status,
			config: {
				nasHost: CONFIG.BACKUP_NAS_HOST,
				nasShare: CONFIG.BACKUP_NAS_SHARE,
				nasFolder: CONFIG.BACKUP_NAS_FOLDER,
				retentionDays: CONFIG.BACKUP_RETENTION_DAYS,
				localDir: CONFIG.BACKUP_LOCAL_DIR
			}
		};
	});

	// POST /api/backup/manual - Trigger manual backup
	fastify.post('/manual', async (request, reply) => {
		if (!CONFIG.BACKUP_ENABLED) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Backups are disabled. Set BACKUP_ENABLED=true in .env file.'
			});
		}

		try {
			const result = await performBackup();

			if (result.success) {
				return {
					success: true,
					message: 'Backup completed successfully',
					timestamp: result.timestamp,
					localPath: result.localPath,
					nasPath: result.nasPath,
					size: result.size
				};
			} else {
				return reply.status(500).send({
					error: 'Backup Failed',
					message: result.error || 'Unknown error occurred during backup'
				});
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(500).send({
				error: 'Backup Failed',
				message: errorMessage
			});
		}
	});
}
