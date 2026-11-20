import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { asc, eq, inArray } from 'drizzle-orm';
import db, { withTransaction } from '../db/connection.js';
import { journalEntries, repeatingPostingLines, repeatingPostings } from '../db/schema.js';
import { logAudit } from '../services/audit.js';
import { JournalPostError, postJournalEntry, templateLineSchema } from '../services/journal-post.js';
import { YearCloseError } from '../services/year-close.js';

const createSchema = z.object({
	name: z.string().trim().min(1).max(120),
	journalEntryIds: z.array(z.number().int().positive()).min(1).max(200).optional(),
	lines: z.array(templateLineSchema).min(1).max(200).optional()
}).refine((data) => (data.journalEntryIds?.length ?? 0) > 0 || (data.lines?.length ?? 0) > 0, {
	message: 'Choose at least one posting or line'
});

const updateSchema = z.object({
	name: z.string().trim().min(1).max(120).optional(),
	lines: z.array(templateLineSchema).min(1).max(200).optional()
});

const postSchema = z.object({
	entryDate: z.coerce.date(),
	lines: z.array(templateLineSchema).min(1).max(200)
});

function lineValues(templateId: number, line: z.infer<typeof templateLineSchema>, sortOrder: number) {
	return {
		templateId,
		sortOrder,
		amount: line.amount,
		currencyCode: line.currencyCode,
		debitAccountId: line.debitAccountId,
		creditAccountId: line.creditAccountId,
		description: line.description,
		category: line.category ?? null,
		comment: line.comment ?? null,
		checkReference: line.checkReference ?? null,
		vendorId: line.vendorId ?? null,
		customerId: line.customerId ?? null,
		inventoryItemId: line.inventoryItemId ?? null,
		inventoryLinkType: line.inventoryLinkType ?? null,
		fixedAssetId: line.fixedAssetId ?? null,
		investmentId: line.investmentId ?? null,
		investmentQuantity: line.investmentQuantity ?? null
	};
}

async function linesFor(templateId: number) {
	return db
		.select()
		.from(repeatingPostingLines)
		.where(eq(repeatingPostingLines.templateId, templateId))
		.orderBy(asc(repeatingPostingLines.sortOrder), asc(repeatingPostingLines.id));
}

function missingRelation(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /no such table|no such column/i.test(message);
}

const NOT_READY = {
	error: 'Service Unavailable',
	message:
		'Repeating postings are not in the database yet. Restart the API so startup migrations can create them.'
};

function guard<T extends (request: any, reply: any) => any>(handler: T): T {
	return (async (request, reply) => {
		try {
			return await handler(request, reply);
		} catch (error) {
			if (missingRelation(error)) {
				request.log.error(error);
				return reply.status(503).send(NOT_READY);
			}
			throw error;
		}
	}) as T;
}

export default async function repeatingPostingsRoutes(fastify: FastifyInstance) {
	fastify.get('/', guard(async () => {
		const templates = await db.select().from(repeatingPostings).orderBy(asc(repeatingPostings.name));
		const lines = await db.select().from(repeatingPostingLines);
		return templates.map((template) => ({
			...template,
			lineCount: lines.filter((line) => line.templateId === template.id).length
		}));
	}));

	fastify.get<{ Params: { id: string } }>('/:id', guard(async (request, reply) => {
		const id = parseInt(request.params.id, 10);
		const rows = await db.select().from(repeatingPostings).where(eq(repeatingPostings.id, id)).limit(1);
		if (rows.length === 0) {
			return reply.status(404).send({ error: 'Not Found', message: 'Repeating posting not found' });
		}
		return { ...rows[0], lines: await linesFor(id) };
	}));

	fastify.post('/', guard(async (request, reply) => {
		const data = createSchema.parse(request.body);
		let sourceLines: z.infer<typeof templateLineSchema>[] = data.lines ?? [];
		if (data.journalEntryIds?.length) {
			const rows = await db
				.select()
				.from(journalEntries)
				.where(inArray(journalEntries.id, data.journalEntryIds));
			const byId = new Map(rows.map((row) => [row.id, row]));
			const missing = data.journalEntryIds.filter((id) => !byId.has(id));
			if (missing.length > 0) {
				return reply.status(404).send({
					error: 'Not Found',
					message: `Journal entries not found: ${missing.join(', ')}`
				});
			}
			sourceLines = data.journalEntryIds.map((id) => {
				const row = byId.get(id)!;
				return {
					amount: row.amount,
					currencyCode: row.currencyCode,
					debitAccountId: row.debitAccountId,
					creditAccountId: row.creditAccountId,
					description: row.description,
					category: row.category,
					comment: row.comment,
					checkReference: row.checkReference,
					vendorId: row.vendorId,
					customerId: row.customerId,
					inventoryItemId: row.inventoryItemId,
					inventoryLinkType: row.inventoryLinkType as 'sale' | 'own_use' | 'gift' | null,
					fixedAssetId: row.fixedAssetId,
					investmentId: row.investmentId,
					investmentQuantity: row.investmentQuantity
				};
			});
		}

		const created = await withTransaction(async () => {
			const inserted = await db
				.insert(repeatingPostings)
				.values({ name: data.name })
				.returning();
			for (let i = 0; i < sourceLines.length; i++) {
				await db.insert(repeatingPostingLines).values(lineValues(inserted[0].id, sourceLines[i], i));
			}
			const savedLines = await linesFor(inserted[0].id);
			await logAudit({
				operation: 'CREATE',
				resourceType: 'repeating_posting',
				resourceId: inserted[0].id,
				newData: { ...inserted[0], lines: savedLines },
				description: `Repeating posting "${data.name}" created`
			});
			return { ...inserted[0], lines: savedLines };
		});
		return reply.status(201).send(created);
	}));

	fastify.put<{ Params: { id: string } }>('/:id', guard(async (request, reply) => {
		const id = parseInt(request.params.id, 10);
		const data = updateSchema.parse(request.body);
		const existing = await db.select().from(repeatingPostings).where(eq(repeatingPostings.id, id)).limit(1);
		if (existing.length === 0) {
			return reply.status(404).send({ error: 'Not Found', message: 'Repeating posting not found' });
		}
		const oldLines = await linesFor(id);
		const updated = await withTransaction(async () => {
			const row = await db
				.update(repeatingPostings)
				.set({ name: data.name ?? existing[0].name, updatedAt: new Date() })
				.where(eq(repeatingPostings.id, id))
				.returning();
			if (data.lines) {
				await db.delete(repeatingPostingLines).where(eq(repeatingPostingLines.templateId, id));
				for (let i = 0; i < data.lines.length; i++) {
					await db.insert(repeatingPostingLines).values(lineValues(id, data.lines[i], i));
				}
			}
			const savedLines = await linesFor(id);
			await logAudit({
				operation: 'UPDATE',
				resourceType: 'repeating_posting',
				resourceId: id,
				oldData: { ...existing[0], lines: oldLines },
				newData: { ...row[0], lines: savedLines },
				description: `Repeating posting "${row[0].name}" updated`
			});
			return { ...row[0], lines: savedLines };
		});
		return updated;
	}));

	fastify.delete<{ Params: { id: string } }>('/:id', guard(async (request, reply) => {
		const id = parseInt(request.params.id, 10);
		const existing = await db.select().from(repeatingPostings).where(eq(repeatingPostings.id, id)).limit(1);
		if (existing.length === 0) {
			return reply.status(404).send({ error: 'Not Found', message: 'Repeating posting not found' });
		}
		const oldLines = await linesFor(id);
		await withTransaction(async () => {
			await db.delete(repeatingPostings).where(eq(repeatingPostings.id, id));
			await logAudit({
				operation: 'DELETE',
				resourceType: 'repeating_posting',
				resourceId: id,
				oldData: { ...existing[0], lines: oldLines },
				description: `Repeating posting "${existing[0].name}" deleted`
			});
		});
		return reply.status(204).send();
	}));

	fastify.post<{ Params: { id: string } }>('/:id/post', guard(async (request, reply) => {
		const id = parseInt(request.params.id, 10);
		const data = postSchema.parse(request.body);
		const existing = await db.select().from(repeatingPostings).where(eq(repeatingPostings.id, id)).limit(1);
		if (existing.length === 0) {
			return reply.status(404).send({ error: 'Not Found', message: 'Repeating posting not found' });
		}
		try {
			const created = await withTransaction(async () => {
				const entries = [];
				for (const line of data.lines) {
					entries.push(await postJournalEntry({ ...line, entryDate: data.entryDate, isDepreciation: false }));
				}
				return entries;
			});
			return reply.status(201).send({ count: created.length, entries: created });
		} catch (error) {
			if (error instanceof YearCloseError) {
				return reply.status(error.statusCode).send({
					error: error.statusCode === 403 ? 'Forbidden' : 'Bad Request',
					message: error.message
				});
			}
			if (error instanceof JournalPostError) {
				return reply.status(error.statusCode).send({
					error: error.statusCode === 404 ? 'Not Found' : 'Bad Request',
					message: error.message
				});
			}
			throw error;
		}
	}));
}
