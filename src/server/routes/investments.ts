import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import db, { saveDatabase } from '../db/connection.js';
import { investments, journalEntries, subledgerAccounts, glAccounts } from '../db/schema.js';
import { eq, and, desc, ne, asc } from 'drizzle-orm';
import { logAudit } from '../services/audit.js';

const ASSET_GL_TYPES = new Set(['Asset', 'Cash', 'Accounts Receivable']);

const createInvestmentSchema = z.object({
	name: z.string().min(1).max(200),
	symbol: z.string().max(50).optional().nullable(),
	category: z.string().min(1).max(100),
	unit: z.string().max(30).optional().nullable(),
	assetAccountId: z.number().int().positive(),
	currentPrice: z.number().min(0).default(0),
	description: z.string().max(1000).optional().nullable()
});

const updateInvestmentSchema = createInvestmentSchema.partial();

type QtyLot = {
	id?: number;
	entryDate: Date | string | number;
	amountInUSD: number;
	investmentQuantity: number;
};

export type InvestmentAggregates = {
	quantity: number;
	costBasis: number;
	avgCost: number;
	marketValue: number;
	unrealizedPL: number;
	unrealizedPLPercent: number | null;
};

/**
 * Weighted-average cost: buys add cost; sells reduce cost by avgCost × |qty|.
 * Returns null if any sell would drive quantity negative.
 */
export function computeWeightedAverageCost(
	lots: QtyLot[],
	currentPrice: number
): InvestmentAggregates | null {
	const sorted = [...lots].sort((a, b) => {
		const ta = new Date(a.entryDate).getTime();
		const tb = new Date(b.entryDate).getTime();
		if (ta !== tb) return ta - tb;
		return (a.id ?? 0) - (b.id ?? 0);
	});

	let qty = 0;
	let cost = 0;

	for (const lot of sorted) {
		const q = Number(lot.investmentQuantity) || 0;
		if (q === 0) continue;

		if (q > 0) {
			cost += Number(lot.amountInUSD) || 0;
			qty += q;
		} else {
			const sellQty = Math.abs(q);
			if (qty + q < -1e-9) {
				return null;
			}
			const avg = qty > 1e-12 ? cost / qty : 0;
			cost -= avg * sellQty;
			qty += q;
			if (Math.abs(qty) < 1e-9) {
				qty = 0;
				cost = 0;
			}
		}
	}

	qty = Math.round(qty * 1e8) / 1e8;
	cost = Math.round(cost * 100) / 100;
	const avgCost = qty > 1e-12 ? Math.round((cost / qty) * 1e6) / 1e6 : 0;
	const marketValue = Math.round(qty * currentPrice * 100) / 100;
	const unrealizedPL = Math.round((marketValue - cost) * 100) / 100;
	const unrealizedPLPercent = cost > 1e-9 ? Math.round((unrealizedPL / cost) * 10000) / 100 : null;

	return {
		quantity: qty,
		costBasis: cost,
		avgCost,
		marketValue,
		unrealizedPL,
		unrealizedPLPercent
	};
}

async function getAccountMeta(id: number): Promise<{ name: string; glType: string } | null> {
	const rows = await db
		.select({
			name: subledgerAccounts.name,
			glType: glAccounts.type
		})
		.from(subledgerAccounts)
		.innerJoin(glAccounts, eq(subledgerAccounts.glAccountId, glAccounts.id))
		.where(eq(subledgerAccounts.id, id))
		.limit(1);
	return rows[0] ?? null;
}

async function validateAssetAccount(
	accountId: number
): Promise<{ valid: boolean; message?: string }> {
	const meta = await getAccountMeta(accountId);
	if (!meta) {
		return { valid: false, message: `Account ${accountId} not found` };
	}
	if (!ASSET_GL_TYPES.has(meta.glType)) {
		return {
			valid: false,
			message: `Account must be under Asset, Cash, or Accounts Receivable (got '${meta.glType}')`
		};
	}
	return { valid: true };
}

async function loadLots(
	investmentId: number,
	excludeEntryId?: number
): Promise<QtyLot[]> {
	const rows = await db
		.select({
			id: journalEntries.id,
			entryDate: journalEntries.entryDate,
			amountInUSD: journalEntries.amountInUSD,
			investmentQuantity: journalEntries.investmentQuantity
		})
		.from(journalEntries)
		.where(
			excludeEntryId != null
				? and(
						eq(journalEntries.investmentId, investmentId),
						ne(journalEntries.id, excludeEntryId)
					)
				: eq(journalEntries.investmentId, investmentId)
		)
		.orderBy(asc(journalEntries.entryDate), asc(journalEntries.id));

	return rows
		.filter((r) => r.investmentQuantity != null)
		.map((r) => ({
			id: r.id,
			entryDate: r.entryDate,
			amountInUSD: r.amountInUSD,
			investmentQuantity: r.investmentQuantity as number
		}));
}

export async function computeInvestmentAggregates(
	investmentId: number,
	currentPrice: number
): Promise<InvestmentAggregates> {
	const lots = await loadLots(investmentId);
	return (
		computeWeightedAverageCost(lots, currentPrice) ?? {
			quantity: 0,
			costBasis: 0,
			avgCost: 0,
			marketValue: 0,
			unrealizedPL: 0,
			unrealizedPLPercent: null
		}
	);
}

/**
 * Validate that adding/updating a lot keeps quantity ≥ 0.
 */
export async function assertInvestmentQuantityOk(params: {
	investmentId: number;
	quantity: number;
	amountInUSD: number;
	entryDate: Date;
	excludeEntryId?: number;
}): Promise<{ ok: true } | { ok: false; message: string }> {
	const lots = await loadLots(params.investmentId, params.excludeEntryId);
	lots.push({
		id: params.excludeEntryId ?? Number.MAX_SAFE_INTEGER,
		entryDate: params.entryDate,
		amountInUSD: params.amountInUSD,
		investmentQuantity: params.quantity
	});
	const result = computeWeightedAverageCost(lots, 0);
	if (!result) {
		return {
			ok: false,
			message:
				'This quantity would make the investment holding negative. Reduce the sell quantity or post a buy first.'
		};
	}
	return { ok: true };
}

async function enrichInvestment(row: typeof investments.$inferSelect) {
	const meta = await getAccountMeta(row.assetAccountId);
	const agg = await computeInvestmentAggregates(row.id, row.currentPrice);
	return {
		...row,
		assetAccountName: meta?.name ?? '',
		assetAccountGlType: meta?.glType ?? '',
		...agg
	};
}

export default async function investmentsRoutes(fastify: FastifyInstance) {
	// GET / — list with aggregates
	fastify.get<{ Querystring: { category?: string } }>('/', async (request) => {
		let rows = await db.select().from(investments).orderBy(desc(investments.createdAt));
		if (request.query.category) {
			rows = rows.filter((r) => r.category === request.query.category);
		}
		return Promise.all(rows.map(enrichInvestment));
	});

	// GET /summary — overall + by category
	fastify.get('/summary', async () => {
		const rows = await db.select().from(investments);
		const enriched = await Promise.all(rows.map(enrichInvestment));

		const byCategoryMap = new Map<
			string,
			{
				category: string;
				investmentCount: number;
				quantity: number;
				costBasis: number;
				marketValue: number;
				unrealizedPL: number;
			}
		>();

		let costBasis = 0;
		let marketValue = 0;
		let unrealizedPL = 0;

		for (const inv of enriched) {
			costBasis += inv.costBasis;
			marketValue += inv.marketValue;
			unrealizedPL += inv.unrealizedPL;

			const existing = byCategoryMap.get(inv.category) ?? {
				category: inv.category,
				investmentCount: 0,
				quantity: 0,
				costBasis: 0,
				marketValue: 0,
				unrealizedPL: 0
			};
			existing.investmentCount += 1;
			existing.quantity += inv.quantity;
			existing.costBasis += inv.costBasis;
			existing.marketValue += inv.marketValue;
			existing.unrealizedPL += inv.unrealizedPL;
			byCategoryMap.set(inv.category, existing);
		}

		const round2 = (n: number) => Math.round(n * 100) / 100;
		const byCategory = Array.from(byCategoryMap.values())
			.map((c) => ({
				...c,
				quantity: Math.round(c.quantity * 1e8) / 1e8,
				costBasis: round2(c.costBasis),
				marketValue: round2(c.marketValue),
				unrealizedPL: round2(c.unrealizedPL),
				unrealizedPLPercent:
					c.costBasis > 1e-9
						? Math.round((c.unrealizedPL / c.costBasis) * 10000) / 100
						: null
			}))
			.sort((a, b) => a.category.localeCompare(b.category));

		return {
			overall: {
				investmentCount: enriched.length,
				costBasis: round2(costBasis),
				marketValue: round2(marketValue),
				unrealizedPL: round2(unrealizedPL),
				unrealizedPLPercent:
					costBasis > 1e-9 ? Math.round((unrealizedPL / costBasis) * 10000) / 100 : null
			},
			byCategory,
			categories: byCategory.map((c) => c.category)
		};
	});

	// GET /categories — distinct category names for type-ahead
	fastify.get('/categories', async () => {
		const rows = await db.select({ category: investments.category }).from(investments);
		const set = new Set(rows.map((r) => r.category).filter(Boolean));
		return Array.from(set).sort((a, b) => a.localeCompare(b));
	});

	// GET /:id
	fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);
		if (isNaN(id)) {
			return reply.status(400).send({ error: 'Bad Request', message: 'Invalid investment ID' });
		}
		const rows = await db.select().from(investments).where(eq(investments.id, id)).limit(1);
		if (rows.length === 0) {
			return reply.status(404).send({ error: 'Not Found', message: `Investment ${id} not found` });
		}
		return enrichInvestment(rows[0]);
	});

	// POST /
	fastify.post<{ Body: z.infer<typeof createInvestmentSchema> }>('/', async (request, reply) => {
		const data = createInvestmentSchema.parse(request.body);
		const check = await validateAssetAccount(data.assetAccountId);
		if (!check.valid) {
			return reply.status(400).send({ error: 'Bad Request', message: check.message });
		}

		const inserted = await db
			.insert(investments)
			.values({
				name: data.name.trim(),
				symbol: data.symbol?.trim() || null,
				category: data.category.trim(),
				unit: data.unit?.trim() || null,
				assetAccountId: data.assetAccountId,
				currentPrice: data.currentPrice ?? 0,
				description: data.description?.trim() || null
			})
			.returning();

		await logAudit({
			operation: 'CREATE',
			resourceType: 'investment',
			resourceId: inserted[0].id,
			source: 'Web UI',
			newData: inserted[0]
		});
		await saveDatabase();

		return reply.status(201).send(await enrichInvestment(inserted[0]));
	});

	// PUT /:id
	fastify.put<{ Params: { id: string }; Body: z.infer<typeof updateInvestmentSchema> }>(
		'/:id',
		async (request, reply) => {
			const id = parseInt(request.params.id);
			if (isNaN(id)) {
				return reply.status(400).send({ error: 'Bad Request', message: 'Invalid investment ID' });
			}

			const data = updateInvestmentSchema.parse(request.body);
			const existing = await db.select().from(investments).where(eq(investments.id, id)).limit(1);
			if (existing.length === 0) {
				return reply.status(404).send({ error: 'Not Found', message: `Investment ${id} not found` });
			}

			if (data.assetAccountId !== undefined) {
				const check = await validateAssetAccount(data.assetAccountId);
				if (!check.valid) {
					return reply.status(400).send({ error: 'Bad Request', message: check.message });
				}
			}

			const patch: Record<string, unknown> = {};
			if (data.name !== undefined) patch.name = data.name.trim();
			if (data.symbol !== undefined) patch.symbol = data.symbol?.trim() || null;
			if (data.category !== undefined) patch.category = data.category.trim();
			if (data.unit !== undefined) patch.unit = data.unit?.trim() || null;
			if (data.assetAccountId !== undefined) patch.assetAccountId = data.assetAccountId;
			if (data.currentPrice !== undefined) patch.currentPrice = data.currentPrice;
			if (data.description !== undefined) patch.description = data.description?.trim() || null;

			const updated = await db
				.update(investments)
				.set(patch)
				.where(eq(investments.id, id))
				.returning();

			await logAudit({
				operation: 'UPDATE',
				resourceType: 'investment',
				resourceId: id,
				source: 'Web UI',
				oldData: existing[0],
				newData: updated[0]
			});
			await saveDatabase();

			return enrichInvestment(updated[0]);
		}
	);

	// DELETE /:id
	fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);
		if (isNaN(id)) {
			return reply.status(400).send({ error: 'Bad Request', message: 'Invalid investment ID' });
		}

		const existing = await db.select().from(investments).where(eq(investments.id, id)).limit(1);
		if (existing.length === 0) {
			return reply.status(404).send({ error: 'Not Found', message: `Investment ${id} not found` });
		}

		const linked = await db
			.select({ id: journalEntries.id })
			.from(journalEntries)
			.where(eq(journalEntries.investmentId, id))
			.limit(1);

		if (linked.length > 0) {
			return reply.status(409).send({
				error: 'Conflict',
				message: 'Cannot delete an investment that has linked journal entries'
			});
		}

		await db.delete(investments).where(eq(investments.id, id));
		await logAudit({
			operation: 'DELETE',
			resourceType: 'investment',
			resourceId: id,
			source: 'Web UI',
			oldData: existing[0]
		});
		await saveDatabase();

		return reply.status(204).send();
	});
}
