import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import db, { saveDatabase } from '../db/connection.js';
import { journalEntries, subledgerAccounts, currencies } from '../db/schema.js';
import { eq, and, gte, lte, desc } from 'drizzle-orm';

// Validation schemas
const createJournalEntrySchema = z.object({
	entryDate: z.coerce.date(),
	amount: z.number().positive(),
	currencyCode: z.string().length(3).default('USD'),
	debitAccountId: z.number().int().positive(),
	creditAccountId: z.number().int().positive(),
	description: z.string().min(1).max(500),
	category: z.string().max(100).optional(),
	comment: z.string().max(1000).optional()
}).refine((data) => data.debitAccountId !== data.creditAccountId, {
	message: 'Debit and credit accounts must be different',
	path: ['creditAccountId']
});

const updateJournalEntrySchema = z.object({
	entryDate: z.coerce.date().optional(),
	amount: z.number().positive().optional(),
	currencyCode: z.string().length(3).optional(),
	debitAccountId: z.number().int().positive().optional(),
	creditAccountId: z.number().int().positive().optional(),
	description: z.string().min(1).max(500).optional(),
	category: z.string().max(100).optional(),
	comment: z.string().max(1000).optional()
});

export default async function journalEntriesRoutes(fastify: FastifyInstance) {
	// GET /api/journal-entries - List all journal entries
	fastify.get<{
		Querystring: {
			startDate?: string;
			endDate?: string;
			debitAccountId?: string;
			creditAccountId?: string;
			category?: string;
			currencyCode?: string;
		}
	}>('/', async (request, reply) => {
		let query = db.select().from(journalEntries).orderBy(desc(journalEntries.entryDate));

		// Apply filters
		const conditions: any[] = [];

		if (request.query.startDate) {
			const startDate = new Date(request.query.startDate);
			if (!isNaN(startDate.getTime())) {
				conditions.push(gte(journalEntries.entryDate, startDate));
			}
		}

		if (request.query.endDate) {
			const endDate = new Date(request.query.endDate);
			if (!isNaN(endDate.getTime())) {
				conditions.push(lte(journalEntries.entryDate, endDate));
			}
		}

		if (request.query.debitAccountId) {
			const debitAccountId = parseInt(request.query.debitAccountId);
			if (!isNaN(debitAccountId)) {
				conditions.push(eq(journalEntries.debitAccountId, debitAccountId));
			}
		}

		if (request.query.creditAccountId) {
			const creditAccountId = parseInt(request.query.creditAccountId);
			if (!isNaN(creditAccountId)) {
				conditions.push(eq(journalEntries.creditAccountId, creditAccountId));
			}
		}

		if (request.query.category) {
			conditions.push(eq(journalEntries.category, request.query.category));
		}

		if (request.query.currencyCode) {
			conditions.push(eq(journalEntries.currencyCode, request.query.currencyCode));
		}

		if (conditions.length > 0) {
			query = query.where(and(...conditions)) as any;
		}

		const entries = await query;
		return entries;
	});

	// GET /api/journal-entries/:id - Get single journal entry
	fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);

		if (isNaN(id)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Invalid journal entry ID'
			});
		}

		const entry = await db
			.select()
			.from(journalEntries)
			.where(eq(journalEntries.id, id))
			.limit(1);

		if (entry.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `Journal entry ${id} not found`
			});
		}

		return entry[0];
	});

	// POST /api/journal-entries - Create new journal entry
	fastify.post<{ Body: z.infer<typeof createJournalEntrySchema> }>(
		'/',
		async (request, reply) => {
			const validatedData = createJournalEntrySchema.parse(request.body);

			// Check if debit account exists
			const debitAccount = await db
				.select()
				.from(subledgerAccounts)
				.where(eq(subledgerAccounts.id, validatedData.debitAccountId))
				.limit(1);

			if (debitAccount.length === 0) {
				return reply.status(404).send({
					error: 'Not Found',
					message: `Debit account ${validatedData.debitAccountId} not found`
				});
			}

			// Check if credit account exists
			const creditAccount = await db
				.select()
				.from(subledgerAccounts)
				.where(eq(subledgerAccounts.id, validatedData.creditAccountId))
				.limit(1);

			if (creditAccount.length === 0) {
				return reply.status(404).send({
					error: 'Not Found',
					message: `Credit account ${validatedData.creditAccountId} not found`
				});
			}

			// Check if currency exists and get exchange rate
			const currency = await db
				.select()
				.from(currencies)
				.where(eq(currencies.code, validatedData.currencyCode))
				.limit(1);

			if (currency.length === 0) {
				return reply.status(404).send({
					error: 'Not Found',
					message: `Currency ${validatedData.currencyCode} not found`
				});
			}

			// Calculate amount in USD
			const amountInUSD = validatedData.amount * currency[0].exchangeRate;

			// Insert new journal entry
			const newEntry = await db
				.insert(journalEntries)
				.values({
					...validatedData,
					amountInUSD
				})
				.returning();

			// Save database
			await saveDatabase();

			return reply.status(201).send(newEntry[0]);
		}
	);

	// PUT /api/journal-entries/:id - Update journal entry
	fastify.put<{
		Params: { id: string };
		Body: z.infer<typeof updateJournalEntrySchema>;
	}>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);

		if (isNaN(id)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Invalid journal entry ID'
			});
		}

		const validatedData = updateJournalEntrySchema.parse(request.body);

		// Check if entry exists
		const existing = await db
			.select()
			.from(journalEntries)
			.where(eq(journalEntries.id, id))
			.limit(1);

		if (existing.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `Journal entry ${id} not found`
			});
		}

		// Validate debit and credit accounts are different if both provided
		if (validatedData.debitAccountId && validatedData.creditAccountId) {
			if (validatedData.debitAccountId === validatedData.creditAccountId) {
				return reply.status(400).send({
					error: 'Bad Request',
					message: 'Debit and credit accounts must be different'
				});
			}
		}

		// If updating debit account, check it exists
		if (validatedData.debitAccountId) {
			const debitAccount = await db
				.select()
				.from(subledgerAccounts)
				.where(eq(subledgerAccounts.id, validatedData.debitAccountId))
				.limit(1);

			if (debitAccount.length === 0) {
				return reply.status(404).send({
					error: 'Not Found',
					message: `Debit account ${validatedData.debitAccountId} not found`
				});
			}
		}

		// If updating credit account, check it exists
		if (validatedData.creditAccountId) {
			const creditAccount = await db
				.select()
				.from(subledgerAccounts)
				.where(eq(subledgerAccounts.id, validatedData.creditAccountId))
				.limit(1);

			if (creditAccount.length === 0) {
				return reply.status(404).send({
					error: 'Not Found',
					message: `Credit account ${validatedData.creditAccountId} not found`
				});
			}
		}

		// Prepare update data
		const updateData: any = { ...validatedData };

		// If amount or currency changed, recalculate amountInUSD
		if (validatedData.amount || validatedData.currencyCode) {
			const currencyCode = validatedData.currencyCode || existing[0].currencyCode;
			const amount = validatedData.amount ?? existing[0].amount;

			// Get exchange rate
			const currency = await db
				.select()
				.from(currencies)
				.where(eq(currencies.code, currencyCode))
				.limit(1);

			if (currency.length === 0) {
				return reply.status(404).send({
					error: 'Not Found',
					message: `Currency ${currencyCode} not found`
				});
			}

			updateData.amountInUSD = amount * currency[0].exchangeRate;
		}

		// Update journal entry
		const updated = await db
			.update(journalEntries)
			.set(updateData)
			.where(eq(journalEntries.id, id))
			.returning();

		// Save database
		await saveDatabase();

		return updated[0];
	});

	// DELETE /api/journal-entries/:id - Delete journal entry
	fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);

		if (isNaN(id)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Invalid journal entry ID'
			});
		}

		// Check if entry exists
		const existing = await db
			.select()
			.from(journalEntries)
			.where(eq(journalEntries.id, id))
			.limit(1);

		if (existing.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `Journal entry ${id} not found`
			});
		}

		// Delete journal entry
		await db.delete(journalEntries).where(eq(journalEntries.id, id));

		// Save database
		await saveDatabase();

		return reply.status(204).send();
	});
}
