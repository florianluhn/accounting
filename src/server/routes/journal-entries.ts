import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import db, { saveDatabase } from '../db/connection.js';
import { journalEntries, subledgerAccounts, currencies, glAccounts } from '../db/schema.js';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

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

			// Calculate amount in USD (round to 2 decimal places)
			const amountInUSD = Math.round(validatedData.amount * currency[0].exchangeRate * 100) / 100;

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

			updateData.amountInUSD = Math.round(amount * currency[0].exchangeRate * 100) / 100;
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

	// GET /api/journal-entries/export/csv - Export journal entries as CSV
	fastify.get<{
		Querystring: {
			startDate?: string;
			endDate?: string;
			debitAccountId?: string;
			creditAccountId?: string;
			category?: string;
			currencyCode?: string;
		}
	}>('/export/csv', async (request, reply) => {
		// Build query with same filters as list endpoint
		let query = db
			.select({
				id: journalEntries.id,
				entryDate: journalEntries.entryDate,
				debitAccountId: journalEntries.debitAccountId,
				debitAccountNumber: subledgerAccounts.accountNumber,
				debitAccountName: subledgerAccounts.name,
				creditAccountId: journalEntries.creditAccountId,
				creditAccountNumber: subledgerAccounts.accountNumber,
				creditAccountName: subledgerAccounts.name,
				amount: journalEntries.amount,
				currencyCode: journalEntries.currencyCode,
				description: journalEntries.description,
				category: journalEntries.category,
				comment: journalEntries.comment
			})
			.from(journalEntries)
			.leftJoin(
				subledgerAccounts,
				eq(journalEntries.debitAccountId, subledgerAccounts.id)
			)
			.orderBy(desc(journalEntries.entryDate));

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

		// Get credit account details for each entry
		const entriesWithAccounts = await Promise.all(
			entries.map(async (entry) => {
				const creditAccount = await db
					.select({
						accountNumber: subledgerAccounts.accountNumber,
						name: subledgerAccounts.name
					})
					.from(subledgerAccounts)
					.where(eq(subledgerAccounts.id, entry.creditAccountId))
					.limit(1);

				return {
					...entry,
					creditAccountNumber: creditAccount[0]?.accountNumber || '',
					creditAccountName: creditAccount[0]?.name || ''
				};
			})
		);

		// Convert to CSV format
		const csvData = entriesWithAccounts.map((entry) => ({
			Date: entry.entryDate instanceof Date
				? entry.entryDate.toISOString().split('T')[0]
				: new Date(entry.entryDate).toISOString().split('T')[0],
			'Debit Account': entry.debitAccountNumber,
			'Debit Account Name': entry.debitAccountName,
			'Credit Account': entry.creditAccountNumber,
			'Credit Account Name': entry.creditAccountName,
			Amount: entry.amount,
			Currency: entry.currencyCode,
			Description: entry.description,
			Category: entry.category || '',
			Comment: entry.comment || ''
		}));

		const csv = stringify(csvData, {
			header: true,
			columns: [
				'Date',
				'Debit Account',
				'Debit Account Name',
				'Credit Account',
				'Credit Account Name',
				'Amount',
				'Currency',
				'Description',
				'Category',
				'Comment'
			]
		});

		reply.header('Content-Type', 'text/csv');
		reply.header('Content-Disposition', 'attachment; filename="journal-entries.csv"');
		return csv;
	});

	// POST /api/journal-entries/import/csv - Import journal entries from CSV
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

		// Parse CSV
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

		// Phase 1: Validate all records and prepare data
		const validatedEntries: Array<{
			entryDate: Date;
			amount: number;
			currencyCode: string;
			amountInUSD: number;
			debitAccountId: number;
			creditAccountId: number;
			description: string;
			category: string | null;
			comment: string | null;
		}> = [];

		for (let i = 0; i < records.length; i++) {
			const record = records[i];
			try {
				// Parse date
				const entryDate = new Date(record.Date);
				if (isNaN(entryDate.getTime())) {
					throw new Error(`Invalid date: ${record.Date}`);
				}

				// Find debit account by account number
				const debitAccount = await db
					.select()
					.from(subledgerAccounts)
					.where(eq(subledgerAccounts.accountNumber, record['Debit Account']))
					.limit(1);

				if (debitAccount.length === 0) {
					throw new Error(`Debit account not found: ${record['Debit Account']}`);
				}

				// Find credit account by account number
				const creditAccount = await db
					.select()
					.from(subledgerAccounts)
					.where(eq(subledgerAccounts.accountNumber, record['Credit Account']))
					.limit(1);

				if (creditAccount.length === 0) {
					throw new Error(`Credit account not found: ${record['Credit Account']}`);
				}

				// Validate debit and credit accounts are different
				if (debitAccount[0].id === creditAccount[0].id) {
					throw new Error('Debit and credit accounts must be different');
				}

				// Parse amount
				const amount = parseFloat(record.Amount);
				if (isNaN(amount) || amount <= 0) {
					throw new Error(`Invalid amount: ${record.Amount}`);
				}

				// Get currency code (default to USD)
				const currencyCode = record.Currency || 'USD';

				// Check if currency exists and get exchange rate
				const currency = await db
					.select()
					.from(currencies)
					.where(eq(currencies.code, currencyCode))
					.limit(1);

				if (currency.length === 0) {
					throw new Error(`Currency not found: ${currencyCode}`);
				}

				// Calculate amount in USD (round to 2 decimal places)
				const amountInUSD = Math.round(amount * currency[0].exchangeRate * 100) / 100;

				// Add to validated entries
				validatedEntries.push({
					entryDate,
					amount,
					currencyCode,
					amountInUSD,
					debitAccountId: debitAccount[0].id,
					creditAccountId: creditAccount[0].id,
					description: record.Description || 'Imported from CSV',
					category: record.Category || null,
					comment: record.Comment || null
				});
			} catch (error) {
				results.failed++;
				const errorMsg = error instanceof Error ? error.message : 'Unknown error';
				results.errors.push(`Row ${i + 2}: ${errorMsg}`);
			}
		}

		// If any errors occurred during validation, return errors without inserting anything
		if (results.failed > 0) {
			return reply.status(400).send({
				success: 0,
				failed: results.failed,
				errors: results.errors,
				message: 'Validation failed. No entries were imported.'
			});
		}

		// Phase 2: Insert all validated entries
		for (const entry of validatedEntries) {
			await db.insert(journalEntries).values(entry);
			results.success++;
		}

		// Save database
		await saveDatabase();

		return reply.status(200).send(results);
	});
}
