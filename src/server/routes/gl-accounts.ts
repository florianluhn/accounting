import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import db, { saveDatabase } from '../db/connection.js';
import { glAccounts, ACCOUNT_TYPES } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { logAudit } from '../services/audit.js';

// Validation schemas
const createGLAccountSchema = z.object({
	accountNumber: z.string().min(1).max(50),
	name: z.string().min(1).max(200),
	type: z.enum(ACCOUNT_TYPES),
	description: z.string().max(500).optional(),
	isActive: z.boolean().default(true)
});

const updateGLAccountSchema = z.object({
	accountNumber: z.string().min(1).max(50).optional(),
	name: z.string().min(1).max(200).optional(),
	type: z.enum(ACCOUNT_TYPES).optional(),
	description: z.string().max(500).optional(),
	isActive: z.boolean().optional()
});

export default async function glAccountsRoutes(fastify: FastifyInstance) {
	// GET /api/gl-accounts - List all GL accounts
	fastify.get<{ Querystring: { active?: string; type?: string } }>(
		'/',
		async (request, reply) => {
			let query = db.select().from(glAccounts);

			// Filter by active status
			if (request.query.active !== undefined) {
				const isActive = request.query.active === 'true';
				query = query.where(eq(glAccounts.isActive, isActive)) as any;
			}

			// Filter by type
			if (request.query.type) {
				query = query.where(eq(glAccounts.type, request.query.type as any)) as any;
			}

			const accounts = await query;
			return accounts;
		}
	);

	// GET /api/gl-accounts/:id - Get single GL account
	fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);

		if (isNaN(id)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Invalid account ID'
			});
		}

		const account = await db.select().from(glAccounts).where(eq(glAccounts.id, id)).limit(1);

		if (account.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `GL account ${id} not found`
			});
		}

		return account[0];
	});

	// POST /api/gl-accounts - Create new GL account
	fastify.post<{ Body: z.infer<typeof createGLAccountSchema> }>(
		'/',
		async (request, reply) => {
			const validatedData = createGLAccountSchema.parse(request.body);

			// Check if account number already exists
			const existing = await db
				.select()
				.from(glAccounts)
				.where(eq(glAccounts.accountNumber, validatedData.accountNumber))
				.limit(1);

			if (existing.length > 0) {
				return reply.status(409).send({
					error: 'Conflict',
					message: `GL account with number ${validatedData.accountNumber} already exists`
				});
			}

			// Insert new GL account
			const newAccount = await db.insert(glAccounts).values(validatedData).returning();

			// Log audit entry
			await logAudit({
				operation: 'CREATE',
				resourceType: 'gl_account',
				resourceId: newAccount[0].id,
				source: 'Web UI',
				newData: newAccount[0]
			});

			// Save database
			await saveDatabase();

			return reply.status(201).send(newAccount[0]);
		}
	);

	// PUT /api/gl-accounts/:id - Update GL account
	fastify.put<{
		Params: { id: string };
		Body: z.infer<typeof updateGLAccountSchema>;
	}>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);

		if (isNaN(id)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Invalid account ID'
			});
		}

		const validatedData = updateGLAccountSchema.parse(request.body);

		// Check if account exists
		const existing = await db.select().from(glAccounts).where(eq(glAccounts.id, id)).limit(1);

		if (existing.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `GL account ${id} not found`
			});
		}

		// If updating account number, check for duplicates
		if (validatedData.accountNumber) {
			const duplicate = await db
				.select()
				.from(glAccounts)
				.where(eq(glAccounts.accountNumber, validatedData.accountNumber))
				.limit(1);

			if (duplicate.length > 0 && duplicate[0].id !== id) {
				return reply.status(409).send({
					error: 'Conflict',
					message: `GL account with number ${validatedData.accountNumber} already exists`
				});
			}
		}

		// Update GL account
		const updated = await db
			.update(glAccounts)
			.set(validatedData)
			.where(eq(glAccounts.id, id))
			.returning();

		// Log audit entry
		await logAudit({
			operation: 'UPDATE',
			resourceType: 'gl_account',
			resourceId: id,
			source: 'Web UI',
			oldData: existing[0],
			newData: updated[0]
		});

		// Save database
		await saveDatabase();

		return updated[0];
	});

	// DELETE /api/gl-accounts/:id - Delete GL account
	fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);

		if (isNaN(id)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Invalid account ID'
			});
		}

		// Check if account exists
		const existing = await db.select().from(glAccounts).where(eq(glAccounts.id, id)).limit(1);

		if (existing.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `GL account ${id} not found`
			});
		}

		// Note: Deletion will be restricted by foreign key constraint if subledgers exist
		await db.delete(glAccounts).where(eq(glAccounts.id, id));

		// Log audit entry
		await logAudit({
			operation: 'DELETE',
			resourceType: 'gl_account',
			resourceId: id,
			source: 'Web UI',
			oldData: existing[0]
		});

		// Save database
		await saveDatabase();

		return reply.status(204).send();
	});
}
