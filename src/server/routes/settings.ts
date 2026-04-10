import type { FastifyInstance } from 'fastify';
import db, { saveDatabase } from '../db/connection.js';
import { appSettings } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const SETTING_KEYS = ['vendors', 'customers', 'inventory', 'timeTracking'] as const;

async function getAllSettings() {
	const rows = await db.select().from(appSettings);
	const map: Record<string, boolean> = {};
	for (const row of rows) {
		map[row.key] = row.value === 'true';
	}
	return {
		vendors: map.vendors ?? true,
		customers: map.customers ?? true,
		inventory: map.inventory ?? true,
		timeTracking: map.timeTracking ?? true
	};
}

export default async function settingsRoutes(fastify: FastifyInstance) {
	// GET /api/settings
	fastify.get('/', async () => {
		return getAllSettings();
	});

	// PUT /api/settings
	fastify.put<{ Body: Record<string, boolean> }>('/', async (request, reply) => {
		const body = request.body;
		for (const key of SETTING_KEYS) {
			if (key in body && typeof body[key] === 'boolean') {
				await db.insert(appSettings)
					.values({ key, value: String(body[key]) })
					.onConflictDoUpdate({ target: appSettings.key, set: { value: String(body[key]) } });
			}
		}
		await saveDatabase();
		return getAllSettings();
	});
}
