import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import db, { saveDatabase } from '../db/connection.js';
import { currencies } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { logAudit } from '../services/audit.js';

// Validation schemas
const createCurrencySchema = z.object({
	code: z.string().length(3).toUpperCase(),
	name: z.string().min(1).max(100),
	symbol: z.string().min(1).max(10),
	exchangeRate: z.number().positive().default(1.0),
	isDefault: z.boolean().default(false)
});

const updateCurrencySchema = z.object({
	name: z.string().min(1).max(100).optional(),
	symbol: z.string().min(1).max(10).optional(),
	exchangeRate: z.number().positive().optional(),
	isDefault: z.boolean().optional()
});

export default async function currenciesRoutes(fastify: FastifyInstance) {
	// GET /api/currencies - List all currencies
	fastify.get('/', async (request, reply) => {
		const allCurrencies = await db.select().from(currencies);
		return allCurrencies;
	});

	// GET /api/currencies/:code - Get single currency
	fastify.get<{ Params: { code: string } }>('/:code', async (request, reply) => {
		const { code } = request.params;

		const currency = await db
			.select()
			.from(currencies)
			.where(eq(currencies.code, code.toUpperCase()))
			.limit(1);

		if (currency.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `Currency ${code} not found`
			});
		}

		return currency[0];
	});

	// POST /api/currencies - Create new currency
	fastify.post<{ Body: z.infer<typeof createCurrencySchema> }>(
		'/',
		async (request, reply) => {
			// Validate request body
			const validatedData = createCurrencySchema.parse(request.body);

			// If setting as default, unset other defaults
			if (validatedData.isDefault) {
				await db
					.update(currencies)
					.set({ isDefault: false })
					.where(eq(currencies.isDefault, true));
			}

			// Insert new currency
			const newCurrency = await db.insert(currencies).values(validatedData).returning();

			// Log audit entry
			await logAudit({
				operation: 'CREATE',
				resourceType: 'currency',
				resourceId: newCurrency[0].code,
				source: 'Web UI',
				newData: newCurrency[0]
			});

			// Save database
			await saveDatabase();

			return reply.status(201).send(newCurrency[0]);
		}
	);

	// PUT /api/currencies/:code - Update currency
	fastify.put<{
		Params: { code: string };
		Body: z.infer<typeof updateCurrencySchema>;
	}>('/:code', async (request, reply) => {
		const { code } = request.params;
		const validatedData = updateCurrencySchema.parse(request.body);

		// Check if currency exists
		const existing = await db
			.select()
			.from(currencies)
			.where(eq(currencies.code, code.toUpperCase()))
			.limit(1);

		if (existing.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `Currency ${code} not found`
			});
		}

		// If setting as default, unset other defaults
		if (validatedData.isDefault) {
			await db
				.update(currencies)
				.set({ isDefault: false })
				.where(eq(currencies.isDefault, true));
		}

		// Update currency
		const updated = await db
			.update(currencies)
			.set(validatedData)
			.where(eq(currencies.code, code.toUpperCase()))
			.returning();

		// Log audit entry
		await logAudit({
			operation: 'UPDATE',
			resourceType: 'currency',
			resourceId: code.toUpperCase(),
			source: 'Web UI',
			oldData: existing[0],
			newData: updated[0]
		});

		// Save database
		await saveDatabase();

		return updated[0];
	});

	// DELETE /api/currencies/:code - Delete currency
	fastify.delete<{ Params: { code: string } }>('/:code', async (request, reply) => {
		const { code } = request.params;

		// Check if currency exists
		const existing = await db
			.select()
			.from(currencies)
			.where(eq(currencies.code, code.toUpperCase()))
			.limit(1);

		if (existing.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `Currency ${code} not found`
			});
		}

		// Prevent deletion of default currency
		if (existing[0].isDefault) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Cannot delete the default currency'
			});
		}

		// Delete currency
		await db.delete(currencies).where(eq(currencies.code, code.toUpperCase()));

		// Log audit entry
		await logAudit({
			operation: 'DELETE',
			resourceType: 'currency',
			resourceId: code.toUpperCase(),
			source: 'Web UI',
			oldData: existing[0]
		});

		// Save database
		await saveDatabase();

		return reply.status(204).send();
	});
}
