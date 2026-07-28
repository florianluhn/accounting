import type { FastifyInstance } from 'fastify';
import db, { saveDatabase } from '../db/connection.js';
import { appSettings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { join, extname } from 'path';
import { mkdir, writeFile, unlink, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { CONFIG } from '../config.js';
import { hasAnyClosedYear } from '../services/year-close.js';

const SETTING_KEYS = [
	'vendors',
	'customers',
	'inventory',
	'timeTracking',
	'bookings',
	'fixedAssets',
	'budgets',
	'checkReferences'
] as const;
const FINANCIAL_YEAR_START_MONTH_KEY = 'financialYearStartMonth';
const ORGANIZATION_NAME_KEY = 'organizationName';
const LOGO_SETTING_KEY = 'app_logo_filename';
const LOGO_MIME_KEY = 'app_logo_mime';
const ALLOWED_LOGO_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/svg+xml']);
const MAX_ORGANIZATION_NAME_LENGTH = 120;

function parseFinancialYearStartMonth(value: string | null | undefined): number {
	const n = parseInt(value ?? '1', 10);
	if (!Number.isFinite(n) || n < 1 || n > 12) return 1;
	return n;
}

async function getSetting(key: string): Promise<string | null> {
	const rows = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
	return rows[0]?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
	await db
		.insert(appSettings)
		.values({ key, value })
		.onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

async function deleteSetting(key: string): Promise<void> {
	await db.delete(appSettings).where(eq(appSettings.key, key));
}

function brandingDir(): string {
	return join(process.cwd(), CONFIG.ATTACHMENTS_PATH, 'branding');
}

async function getAllSettings() {
	const rows = await db.select().from(appSettings);
	const map: Record<string, string> = {};
	for (const row of rows) {
		map[row.key] = row.value;
	}
	return {
		vendors: (map.vendors ?? 'true') === 'true',
		customers: (map.customers ?? 'true') === 'true',
		inventory: (map.inventory ?? 'true') === 'true',
		timeTracking: (map.timeTracking ?? 'true') === 'true',
		bookings: (map.bookings ?? 'true') === 'true',
		fixedAssets: (map.fixedAssets ?? 'true') === 'true',
		budgets: (map.budgets ?? 'false') === 'true',
		checkReferences: (map.checkReferences ?? 'false') === 'true',
		financialYearStartMonth: parseFinancialYearStartMonth(map[FINANCIAL_YEAR_START_MONTH_KEY]),
		organizationName: (map[ORGANIZATION_NAME_KEY] ?? '').trim(),
		hasLogo: !!(map[LOGO_SETTING_KEY] && map[LOGO_SETTING_KEY].length > 0)
	};
}

export default async function settingsRoutes(fastify: FastifyInstance) {
	// GET /api/settings
	fastify.get('/', async () => {
		return getAllSettings();
	});

	// PUT /api/settings
	fastify.put<{ Body: Record<string, boolean | number | string> }>('/', async (request, reply) => {
		const body = request.body;
		for (const key of SETTING_KEYS) {
			if (key in body && typeof body[key] === 'boolean') {
				await setSetting(key, String(body[key]));
			}
		}
		if (
			FINANCIAL_YEAR_START_MONTH_KEY in body &&
			typeof body[FINANCIAL_YEAR_START_MONTH_KEY] === 'number'
		) {
			const month = parseFinancialYearStartMonth(String(body[FINANCIAL_YEAR_START_MONTH_KEY]));
			const current = parseFinancialYearStartMonth(
				(await getSetting(FINANCIAL_YEAR_START_MONTH_KEY)) ?? '1'
			);
			if (month !== current && (await hasAnyClosedYear())) {
				return reply.status(409).send({
					error: 'Conflict',
					message:
						'Cannot change the financial year start month after one or more years have been closed. Closed-year date ranges are locked to the start month used at close time.'
				});
			}
			await setSetting(FINANCIAL_YEAR_START_MONTH_KEY, String(month));
		}
		if (ORGANIZATION_NAME_KEY in body && typeof body[ORGANIZATION_NAME_KEY] === 'string') {
			const name = body[ORGANIZATION_NAME_KEY].trim().slice(0, MAX_ORGANIZATION_NAME_LENGTH);
			await setSetting(ORGANIZATION_NAME_KEY, name);
		}
		await saveDatabase();
		return getAllSettings();
	});

	// GET /api/settings/logo — serve the app logo image
	fastify.get('/logo', async (_request, reply) => {
		const filename = await getSetting(LOGO_SETTING_KEY);
		if (!filename) {
			return reply.status(404).send({ error: 'Not Found', message: 'No app logo configured' });
		}

		const filePath = join(brandingDir(), filename);
		if (!existsSync(filePath)) {
			return reply.status(404).send({ error: 'Not Found', message: 'Logo file missing on disk' });
		}

		const mime = (await getSetting(LOGO_MIME_KEY)) || 'image/png';
		const buf = await readFile(filePath);
		reply.header('Content-Type', mime);
		reply.header('Cache-Control', 'public, max-age=3600');
		return reply.send(buf);
	});

	// POST /api/settings/logo — upload / replace app logo
	fastify.post('/logo', async (request, reply) => {
		const data = await request.file();
		if (!data) {
			return reply.status(400).send({ error: 'Bad Request', message: 'No file uploaded' });
		}

		const mime = data.mimetype || '';
		if (!ALLOWED_LOGO_MIMES.has(mime)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Logo must be an image (PNG, JPEG, WebP, GIF, or SVG)'
			});
		}

		const buffer = await data.toBuffer();
		if (buffer.length > CONFIG.MAX_FILE_SIZE_BYTES) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: `File too large (max ${CONFIG.MAX_FILE_SIZE_MB} MB)`
			});
		}

		const dir = brandingDir();
		await mkdir(dir, { recursive: true });

		// Remove previous logo if present
		const previous = await getSetting(LOGO_SETTING_KEY);
		if (previous) {
			const prevPath = join(dir, previous);
			if (existsSync(prevPath)) {
				try {
					await unlink(prevPath);
				} catch {
					/* ignore */
				}
			}
		}

		const ext = extname(data.filename || '').toLowerCase() || mimeToExt(mime);
		const storedName = `app-logo${ext}`;
		await writeFile(join(dir, storedName), buffer);
		await setSetting(LOGO_SETTING_KEY, storedName);
		await setSetting(LOGO_MIME_KEY, mime);
		await saveDatabase();

		return { success: true, hasLogo: true };
	});

	// DELETE /api/settings/logo — remove app logo
	fastify.delete('/logo', async () => {
		const filename = await getSetting(LOGO_SETTING_KEY);
		if (filename) {
			const filePath = join(brandingDir(), filename);
			if (existsSync(filePath)) {
				try {
					await unlink(filePath);
				} catch {
					/* ignore */
				}
			}
		}
		await deleteSetting(LOGO_SETTING_KEY);
		await deleteSetting(LOGO_MIME_KEY);
		await saveDatabase();
		return { success: true, hasLogo: false };
	});
}

function mimeToExt(mime: string): string {
	switch (mime) {
		case 'image/jpeg':
		case 'image/jpg':
			return '.jpg';
		case 'image/webp':
			return '.webp';
		case 'image/gif':
			return '.gif';
		case 'image/svg+xml':
			return '.svg';
		default:
			return '.png';
	}
}
