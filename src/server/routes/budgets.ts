import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import db from '../db/connection.js';
import { budgets, subledgerAccounts } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

const budgetSchema = z.object({
	subledgerAccountId: z.number().int().positive(),
	year: z.number().int().positive(),
	amount: z.number()
});

const updateBudgetSchema = z.object({
	amount: z.number()
});

export default async function budgetsRoutes(fastify: FastifyInstance) {
	// GET /api/budgets
	fastify.get<{ Querystring: { year?: string; subledgerAccountId?: string } }>(
		'/',
		async (request, reply) => {
			const { year, subledgerAccountId } = request.query;
			const conditions = [];

			if (year) {
				conditions.push(eq(budgets.year, parseInt(year)));
			}
			if (subledgerAccountId) {
				conditions.push(eq(budgets.subledgerAccountId, parseInt(subledgerAccountId)));
			}

			let query = db.select().from(budgets);
			if (conditions.length > 0) {
				query = query.where(and(...conditions)) as any;
			}

			return await query;
		}
	);

	// POST /api/budgets
	fastify.post<{ Body: z.infer<typeof budgetSchema> }>('/', async (request, reply) => {
		const data = budgetSchema.parse(request.body);

		// Check if account exists
		const account = await db.select().from(subledgerAccounts).where(eq(subledgerAccounts.id, data.subledgerAccountId)).limit(1);
		if (account.length === 0) {
			return reply.status(404).send({ error: 'Not Found', message: 'Subledger account not found' });
		}

		try {
			const result = await db.insert(budgets).values(data).returning();
			return reply.status(201).send(result[0]);
		} catch (error: any) {
			// Handle unique constraint violation
			if (error.message?.includes('UNIQUE constraint failed') || error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
				return reply.status(409).send({ error: 'Conflict', message: 'Budget for this account and year already exists' });
			}
			throw error;
		}
	});

	// PUT /api/budgets/:id
	fastify.put<{ Params: { id: string }; Body: z.infer<typeof updateBudgetSchema> }>(
		'/:id',
		async (request, reply) => {
			const id = parseInt(request.params.id);
			if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid ID' });

			const data = updateBudgetSchema.parse(request.body);

			const result = await db
				.update(budgets)
				.set({ amount: data.amount, updatedAt: new Date() })
				.where(eq(budgets.id, id))
				.returning();

			if (result.length === 0) {
				return reply.status(404).send({ error: 'Not Found', message: 'Budget not found' });
			}

			return result[0];
		}
	);

	// DELETE /api/budgets/:id
	fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);
		if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid ID' });

		const result = await db.delete(budgets).where(eq(budgets.id, id)).returning();

		if (result.length === 0) {
			return reply.status(404).send({ error: 'Not Found', message: 'Budget not found' });
		}

		return reply.status(204).send();
	});
}
