import type { FastifyInstance } from 'fastify';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import db from '../db/connection.js';
import { appSettings } from '../db/schema.js';
import { CONFIG } from '../config.js';

const LOGO_SETTING_KEY = 'app_logo_filename';
const LOGO_MIME_KEY = 'app_logo_mime';

/**
 * Read-only configuration for every signed-in user (module flags, branding).
 * Mutations stay on /api/settings, which is admin-only.
 */
export default async function appConfigRoutes(fastify: FastifyInstance) {
	fastify.get('/', async () => {
		const rows = await db.select().from(appSettings);
		const map: Record<string, string> = {};
		for (const row of rows) map[row.key] = row.value;
		const bool = (key: string, fallback: boolean) =>
			map[key] === undefined ? fallback : map[key] === 'true';
		const month = parseInt(map.financialYearStartMonth ?? '1', 10);
		const clearing = parseInt(map.checkClearingAccountId ?? '', 10);
		return {
			vendors: bool('vendors', true),
			customers: bool('customers', true),
			inventory: bool('inventory', true),
			timeTracking: bool('timeTracking', true),
			bookings: bool('bookings', true),
			fixedAssets: bool('fixedAssets', true),
			investments: bool('investments', true),
			budgets: bool('budgets', false),
			checkReferences: bool('checkReferences', false),
			checkClearingAccountId: Number.isInteger(clearing) && clearing > 0 ? clearing : null,
			financialYearStartMonth: Number.isFinite(month) && month >= 1 && month <= 12 ? month : 1,
			organizationName: (map.organizationName ?? '').trim(),
			hasLogo: !!(map[LOGO_SETTING_KEY] && map[LOGO_SETTING_KEY].length > 0)
		};
	});

	fastify.get('/logo', async (_request, reply) => {
		const rows = await db.select().from(appSettings);
		const map: Record<string, string> = {};
		for (const row of rows) map[row.key] = row.value;
		const filename = map[LOGO_SETTING_KEY];
		if (!filename) {
			return reply.status(404).send({ error: 'Not Found', message: 'No app logo configured' });
		}
		const filePath = join(process.cwd(), CONFIG.ATTACHMENTS_PATH, 'branding', filename);
		if (!existsSync(filePath)) {
			return reply.status(404).send({ error: 'Not Found', message: 'Logo file missing on disk' });
		}
		const mime = map[LOGO_MIME_KEY] || 'image/png';
		const buf = await readFile(filePath);
		reply.header('Content-Type', mime);
		reply.header('Cache-Control', 'private, max-age=3600');
		reply.header('X-Content-Type-Options', 'nosniff');
		return reply.send(buf);
	});
}
