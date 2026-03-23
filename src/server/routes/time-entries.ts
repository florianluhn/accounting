import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import db, { saveDatabase } from '../db/connection.js';
import { timeEntries } from '../db/schema.js';
import { eq, and, gte, lte, desc, like } from 'drizzle-orm';
import { logAudit } from '../services/audit.js';

// Validation schemas
const createTimeEntrySchema = z.object({
	entryDate: z.coerce.date(),
	hours: z.number().int().min(0).max(23),
	minutes: z.number().int().min(0).max(59),
	activity: z.string().min(1).max(200),
	description: z.string().max(1000).optional(),
	who: z.string().min(1).max(200)
}).refine((data) => data.hours > 0 || data.minutes > 0, {
	message: 'Total time must be greater than 0',
	path: ['hours']
});

const updateTimeEntrySchema = z.object({
	entryDate: z.coerce.date().optional(),
	hours: z.number().int().min(0).max(23).optional(),
	minutes: z.number().int().min(0).max(59).optional(),
	activity: z.string().min(1).max(200).optional(),
	description: z.string().max(1000).optional(),
	who: z.string().min(1).max(200).optional()
});

export default async function timeEntriesRoutes(fastify: FastifyInstance) {
	// GET /api/time-entries - List all time entries
	fastify.get<{
		Querystring: {
			startDate?: string;
			endDate?: string;
			who?: string;
			activity?: string;
		}
	}>('/', async (request, reply) => {
		let query = db.select().from(timeEntries).orderBy(desc(timeEntries.entryDate));

		const conditions: any[] = [];

		if (request.query.startDate) {
			const startDate = new Date(request.query.startDate);
			if (!isNaN(startDate.getTime())) {
				conditions.push(gte(timeEntries.entryDate, startDate));
			}
		}

		if (request.query.endDate) {
			const endDate = new Date(request.query.endDate);
			if (!isNaN(endDate.getTime())) {
				conditions.push(lte(timeEntries.entryDate, endDate));
			}
		}

		if (request.query.who) {
			conditions.push(eq(timeEntries.who, request.query.who));
		}

		if (request.query.activity) {
			conditions.push(like(timeEntries.activity, `%${request.query.activity}%`));
		}

		if (conditions.length > 0) {
			query = query.where(and(...conditions)) as any;
		}

		const entries = await query;
		return entries;
	});

	// GET /api/time-entries/:id - Get single time entry
	fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);

		if (isNaN(id)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Invalid time entry ID'
			});
		}

		const entry = await db.select().from(timeEntries).where(eq(timeEntries.id, id)).limit(1);

		if (entry.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `Time entry ${id} not found`
			});
		}

		return entry[0];
	});

	// POST /api/time-entries - Create new time entry
	fastify.post<{ Body: z.infer<typeof createTimeEntrySchema> }>(
		'/',
		async (request, reply) => {
			const validatedData = createTimeEntrySchema.parse(request.body);

			const newEntry = await db.insert(timeEntries).values(validatedData).returning();

			await logAudit({
				operation: 'CREATE',
				resourceType: 'time_entry',
				resourceId: newEntry[0].id,
				source: 'Web UI',
				newData: newEntry[0]
			});

			await saveDatabase();

			return reply.status(201).send(newEntry[0]);
		}
	);

	// PUT /api/time-entries/:id - Update time entry
	fastify.put<{
		Params: { id: string };
		Body: z.infer<typeof updateTimeEntrySchema>;
	}>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);

		if (isNaN(id)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Invalid time entry ID'
			});
		}

		const validatedData = updateTimeEntrySchema.parse(request.body);

		const existing = await db.select().from(timeEntries).where(eq(timeEntries.id, id)).limit(1);

		if (existing.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `Time entry ${id} not found`
			});
		}

		const updated = await db
			.update(timeEntries)
			.set(validatedData)
			.where(eq(timeEntries.id, id))
			.returning();

		await logAudit({
			operation: 'UPDATE',
			resourceType: 'time_entry',
			resourceId: id,
			source: 'Web UI',
			oldData: existing[0],
			newData: updated[0]
		});

		await saveDatabase();

		return updated[0];
	});

	// DELETE /api/time-entries/:id - Delete time entry
	fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);

		if (isNaN(id)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Invalid time entry ID'
			});
		}

		const existing = await db.select().from(timeEntries).where(eq(timeEntries.id, id)).limit(1);

		if (existing.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `Time entry ${id} not found`
			});
		}

		await db.delete(timeEntries).where(eq(timeEntries.id, id));

		await logAudit({
			operation: 'DELETE',
			resourceType: 'time_entry',
			resourceId: id,
			source: 'Web UI',
			oldData: existing[0]
		});

		await saveDatabase();

		return reply.status(204).send();
	});
}
