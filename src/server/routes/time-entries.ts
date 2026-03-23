import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import db, { saveDatabase } from '../db/connection.js';
import { timeEntries } from '../db/schema.js';
import { eq, and, gte, lte, desc, like } from 'drizzle-orm';
import { logAudit, generateBatchId } from '../services/audit.js';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

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

	// GET /api/time-entries/export/csv - Export time entries as CSV
	fastify.get<{
		Querystring: {
			startDate?: string;
			endDate?: string;
			who?: string;
		}
	}>('/export/csv', async (request, reply) => {
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

		if (conditions.length > 0) {
			query = query.where(and(...conditions)) as any;
		}

		const entries = await query;

		const csvData = entries.map((e) => ({
			Date: e.entryDate instanceof Date
				? e.entryDate.toISOString().split('T')[0]
				: new Date(e.entryDate).toISOString().split('T')[0],
			Hours: e.hours,
			Minutes: e.minutes,
			Activity: e.activity,
			Description: e.description || '',
			Who: e.who
		}));

		const csv = stringify(csvData, {
			header: true,
			columns: ['Date', 'Hours', 'Minutes', 'Activity', 'Description', 'Who']
		});

		reply.header('Content-Type', 'text/csv');
		reply.header('Content-Disposition', 'attachment; filename="time-entries.csv"');
		return csv;
	});

	// POST /api/time-entries/import/csv - Import time entries from CSV
	fastify.post('/import/csv', async (request, reply) => {
		const data = await request.file();

		if (!data) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'No file uploaded'
			});
		}

		const buffer = await data.toBuffer();
		const csvContent = buffer.toString('utf-8');

		let records: any[];
		try {
			records = parse(csvContent, {
				columns: true,
				skip_empty_lines: true,
				trim: true
			});
		} catch (error) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Invalid CSV format'
			});
		}

		const results = {
			success: 0,
			failed: 0,
			errors: [] as string[]
		};

		const validatedEntries: Array<{
			entryDate: Date;
			hours: number;
			minutes: number;
			activity: string;
			description: string | null;
			who: string;
		}> = [];

		for (let i = 0; i < records.length; i++) {
			const record = records[i];
			try {
				const entryDate = new Date(record.Date);
				if (isNaN(entryDate.getTime())) {
					throw new Error(`Invalid date: ${record.Date}`);
				}

				const hours = parseInt(record.Hours);
				const minutes = parseInt(record.Minutes);

				if (isNaN(hours) || hours < 0 || hours > 23) {
					throw new Error(`Invalid hours: ${record.Hours}`);
				}
				if (isNaN(minutes) || minutes < 0 || minutes > 59) {
					throw new Error(`Invalid minutes: ${record.Minutes}`);
				}
				if (hours === 0 && minutes === 0) {
					throw new Error('Total time must be greater than 0');
				}

				if (!record.Activity || record.Activity.trim() === '') {
					throw new Error('Activity is required');
				}
				if (!record.Who || record.Who.trim() === '') {
					throw new Error('Who is required');
				}

				validatedEntries.push({
					entryDate,
					hours,
					minutes,
					activity: record.Activity.trim(),
					description: record.Description?.trim() || null,
					who: record.Who.trim()
				});
			} catch (error) {
				results.failed++;
				const errorMsg = error instanceof Error ? error.message : 'Unknown error';
				results.errors.push(`Row ${i + 2}: ${errorMsg}`);
			}
		}

		if (results.failed > 0) {
			return reply.status(400).send({
				success: 0,
				failed: results.failed,
				errors: results.errors,
				message: 'Validation failed. No time entries were imported.'
			});
		}

		const batchId = generateBatchId();
		for (const entry of validatedEntries) {
			await db.insert(timeEntries).values(entry);
			results.success++;
		}

		await logAudit({
			operation: 'CREATE',
			resourceType: 'time_entry',
			resourceId: batchId,
			source: 'CSV Import',
			batchId,
			batchSummary: `Imported ${results.success} time entries from CSV`,
			newData: { count: results.success }
		});

		await saveDatabase();

		return reply.status(200).send(results);
	});
}
