import { CONFIG } from '../config.js';
import { performBackup } from './backup.js';

interface CronJob {
	pattern: string;
	nextRun: Date | null;
	running: boolean;
	intervalId?: NodeJS.Timeout;
}

const jobs: Map<string, CronJob> = new Map();

/**
 * Parse cron pattern and calculate next run time
 * Supports: minute hour day month weekday
 * Example: "0 2 * * *" = Daily at 2:00 AM
 */
function parseNextRun(cronPattern: string): Date | null {
	const parts = cronPattern.split(' ');
	if (parts.length !== 5) {
		console.error(`Invalid cron pattern: ${cronPattern}`);
		return null;
	}

	const [minute, hour, day, month, weekday] = parts;
	const now = new Date();
	const next = new Date(now);

	// Set the time for today
	const targetHour = hour === '*' ? now.getHours() : parseInt(hour);
	const targetMinute = minute === '*' ? now.getMinutes() : parseInt(minute);

	next.setHours(targetHour, targetMinute, 0, 0);

	// If the time has already passed today, schedule for tomorrow
	if (next <= now) {
		next.setDate(next.getDate() + 1);
	}

	return next;
}

/**
 * Calculate milliseconds until next run
 */
function msUntilNextRun(nextRun: Date): number {
	return nextRun.getTime() - Date.now();
}

/**
 * Schedule a job to run based on cron pattern
 */
function scheduleJob(name: string, cronPattern: string, handler: () => Promise<void>): void {
	const nextRun = parseNextRun(cronPattern);

	if (!nextRun) {
		console.error(`Failed to schedule job: ${name}`);
		return;
	}

	const job: CronJob = {
		pattern: cronPattern,
		nextRun,
		running: false
	};

	const scheduleNext = () => {
		const nextRun = parseNextRun(cronPattern);
		if (!nextRun) return;

		job.nextRun = nextRun;
		const delay = msUntilNextRun(nextRun);

		console.log(`📅 Next ${name} scheduled for: ${nextRun.toLocaleString()}`);

		job.intervalId = setTimeout(async () => {
			if (job.running) {
				console.log(`⚠ ${name} is already running, skipping...`);
				scheduleNext();
				return;
			}

			try {
				job.running = true;
				console.log(`\n⏰ Running scheduled ${name}...`);
				await handler();
			} catch (error) {
				console.error(`Failed to run ${name}:`, error);
			} finally {
				job.running = false;
				scheduleNext(); // Schedule the next run
			}
		}, delay);
	};

	scheduleNext();
	jobs.set(name, job);
}

/**
 * Stop a scheduled job
 */
function stopJob(name: string): void {
	const job = jobs.get(name);
	if (job && job.intervalId) {
		clearTimeout(job.intervalId);
		jobs.delete(name);
		console.log(`✓ Stopped scheduled job: ${name}`);
	}
}

/**
 * Stop all scheduled jobs
 */
function stopAllJobs(): void {
	for (const [name] of jobs) {
		stopJob(name);
	}
}

/**
 * Get status of all scheduled jobs
 */
function getJobStatus(): Array<{ name: string; pattern: string; nextRun: Date | null; running: boolean }> {
	return Array.from(jobs.entries()).map(([name, job]) => ({
		name,
		pattern: job.pattern,
		nextRun: job.nextRun,
		running: job.running
	}));
}

/**
 * Initialize backup scheduler
 */
export function initializeScheduler(): void {
	if (!CONFIG.BACKUP_ENABLED) {
		console.log('ℹ Automatic backups disabled (BACKUP_ENABLED=false)');
		return;
	}

	console.log('');
	console.log('🕐 Initializing backup scheduler...');
	console.log(`   Schedule: ${CONFIG.BACKUP_CRON}`);
	console.log(`   Retention: ${CONFIG.BACKUP_RETENTION_DAYS} days`);

	if (!CONFIG.BACKUP_NAS_USERNAME || !CONFIG.BACKUP_NAS_PASSWORD) {
		console.log('   ⚠ NAS credentials not configured - backups will be local only');
	} else {
		console.log(`   NAS: //${CONFIG.BACKUP_NAS_HOST}/${CONFIG.BACKUP_NAS_SHARE}/${CONFIG.BACKUP_NAS_FOLDER}`);
	}

	scheduleJob('backup', CONFIG.BACKUP_CRON, async () => {
		await performBackup();
	});

	console.log('✓ Backup scheduler initialized');
	console.log('');
}

/**
 * Shutdown scheduler gracefully
 */
export function shutdownScheduler(): void {
	console.log('Stopping scheduled jobs...');
	stopAllJobs();
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus() {
	return {
		enabled: CONFIG.BACKUP_ENABLED,
		jobs: getJobStatus()
	};
}
