import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import db, { saveDatabase } from '../db/connection.js';
import { subledgerAccounts, glAccounts, currencies } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

// Validation schemas
const createSubledgerAccountSchema = z.object({
	glAccountId: z.number().int().positive(),
	accountNumber: z.string().min(1).max(50),
	name: z.string().min(1).max(200),
	currencyCode: z.string().length(3).default('USD'),
	description: z.string().max(500).optional(),
	isActive: z.boolean().default(true)
});

const updateSubledgerAccountSchema = z.object({
	glAccountId: z.number().int().positive().optional(),
	accountNumber: z.string().min(1).max(50).optional(),
	name: z.string().min(1).max(200).optional(),
	currencyCode: z.string().length(3).optional(),
	description: z.string().max(500).optional(),
	isActive: z.boolean().optional()
});

export default async function subledgerAccountsRoutes(fastify: FastifyInstance) {
	// GET /api/subledger-accounts - List all subledger accounts
	fastify.get<{ Querystring: { active?: string; glAccountId?: string; currencyCode?: string } }>(
		'/',
		async (request, reply) => {
			let query = db.select().from(subledgerAccounts);

			// Filter by active status
			if (request.query.active !== undefined) {
				const isActive = request.query.active === 'true';
				query = query.where(eq(subledgerAccounts.isActive, isActive)) as any;
			}

			// Filter by GL account
			if (request.query.glAccountId) {
				const glAccountId = parseInt(request.query.glAccountId);
				if (!isNaN(glAccountId)) {
					query = query.where(eq(subledgerAccounts.glAccountId, glAccountId)) as any;
				}
			}

			// Filter by currency
			if (request.query.currencyCode) {
				query = query.where(eq(subledgerAccounts.currencyCode, request.query.currencyCode)) as any;
			}

			const accounts = await query;
			return accounts;
		}
	);

	// GET /api/subledger-accounts/:id - Get single subledger account
	fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);

		if (isNaN(id)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Invalid account ID'
			});
		}

		const account = await db
			.select()
			.from(subledgerAccounts)
			.where(eq(subledgerAccounts.id, id))
			.limit(1);

		if (account.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `Subledger account ${id} not found`
			});
		}

		return account[0];
	});

	// POST /api/subledger-accounts - Create new subledger account
	fastify.post<{ Body: z.infer<typeof createSubledgerAccountSchema> }>(
		'/',
		async (request, reply) => {
			const validatedData = createSubledgerAccountSchema.parse(request.body);

			// Check if GL account exists
			const glAccount = await db
				.select()
				.from(glAccounts)
				.where(eq(glAccounts.id, validatedData.glAccountId))
				.limit(1);

			if (glAccount.length === 0) {
				return reply.status(404).send({
					error: 'Not Found',
					message: `GL account ${validatedData.glAccountId} not found`
				});
			}

			// Check if currency exists
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

			// Check if account number already exists
			const existing = await db
				.select()
				.from(subledgerAccounts)
				.where(eq(subledgerAccounts.accountNumber, validatedData.accountNumber))
				.limit(1);

			if (existing.length > 0) {
				return reply.status(409).send({
					error: 'Conflict',
					message: `Subledger account with number ${validatedData.accountNumber} already exists`
				});
			}

			// Insert new subledger account
			const newAccount = await db.insert(subledgerAccounts).values(validatedData).returning();

			// Save database
			await saveDatabase();

			return reply.status(201).send(newAccount[0]);
		}
	);

	// PUT /api/subledger-accounts/:id - Update subledger account
	fastify.put<{
		Params: { id: string };
		Body: z.infer<typeof updateSubledgerAccountSchema>;
	}>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);

		if (isNaN(id)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Invalid account ID'
			});
		}

		const validatedData = updateSubledgerAccountSchema.parse(request.body);

		// Check if account exists
		const existing = await db
			.select()
			.from(subledgerAccounts)
			.where(eq(subledgerAccounts.id, id))
			.limit(1);

		if (existing.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `Subledger account ${id} not found`
			});
		}

		// If updating GL account, check it exists
		if (validatedData.glAccountId) {
			const glAccount = await db
				.select()
				.from(glAccounts)
				.where(eq(glAccounts.id, validatedData.glAccountId))
				.limit(1);

			if (glAccount.length === 0) {
				return reply.status(404).send({
					error: 'Not Found',
					message: `GL account ${validatedData.glAccountId} not found`
				});
			}
		}

		// If updating currency, check it exists
		if (validatedData.currencyCode) {
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
		}

		// If updating account number, check for duplicates
		if (validatedData.accountNumber) {
			const duplicate = await db
				.select()
				.from(subledgerAccounts)
				.where(eq(subledgerAccounts.accountNumber, validatedData.accountNumber))
				.limit(1);

			if (duplicate.length > 0 && duplicate[0].id !== id) {
				return reply.status(409).send({
					error: 'Conflict',
					message: `Subledger account with number ${validatedData.accountNumber} already exists`
				});
			}
		}

		// Update subledger account
		const updated = await db
			.update(subledgerAccounts)
			.set(validatedData)
			.where(eq(subledgerAccounts.id, id))
			.returning();

		// Save database
		await saveDatabase();

		return updated[0];
	});

	// DELETE /api/subledger-accounts/:id - Delete subledger account
	fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);

		if (isNaN(id)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Invalid account ID'
			});
		}

		// Check if account exists
		const existing = await db
			.select()
			.from(subledgerAccounts)
			.where(eq(subledgerAccounts.id, id))
			.limit(1);

		if (existing.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `Subledger account ${id} not found`
			});
		}

		// Note: Deletion will be restricted by foreign key constraint if journal entries exist
		await db.delete(subledgerAccounts).where(eq(subledgerAccounts.id, id));

		// Save database
		await saveDatabase();

		return reply.status(204).send();
	});
}
