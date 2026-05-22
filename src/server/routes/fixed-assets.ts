import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import db, { saveDatabase } from '../db/connection.js';
import { fixedAssets, journalEntries, subledgerAccounts, glAccounts } from '../db/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { logAudit } from '../services/audit.js';
import { generateSchedule, getEligibleMonths } from '../services/depreciation.js';

// ─── Validation schemas ────────────────────────────────────────────────────

const createAssetSchema = z.object({
	name: z.string().min(1).max(200),
	description: z.string().max(1000).optional().nullable(),
	assetAccountId: z.number().int().positive(),
	expenseAccountId: z.number().int().positive(),
	depreciationMethod: z.enum(['SL', '200DB', '150DB']),
	convention: z.enum(['half_year', 'mid_month', 'mid_quarter']),
	usefulLifeMonths: z.number().int().positive(),
	salvageValue: z.number().min(0).default(0),
	activationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

const updateAssetSchema = createAssetSchema.partial();

const monthSchema = z.object({
	month: z.string().regex(/^\d{4}-\d{2}$/, 'Must be YYYY-MM format'),
});

const throughMonthSchema = z.object({
	throughMonth: z.string().regex(/^\d{4}-\d{2}$/, 'Must be YYYY-MM format'),
});

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Build a subledger account alias for the asset account and the expense account
 * so we can join them in the same query without conflicts.
 */
const assetAccount = subledgerAccounts;

/**
 * Compute aggregate values for a single fixed asset from linked journal entries.
 */
async function computeAssetAggregates(assetId: number) {
	const rows = await db
		.select({
			initialValue: sql<number>`COALESCE(SUM(CASE WHEN ${journalEntries.isDepreciation} = 0 THEN ${journalEntries.amountInUSD} ELSE 0 END), 0)`,
			accumulatedDepreciation: sql<number>`COALESCE(SUM(CASE WHEN ${journalEntries.isDepreciation} = 1 THEN ${journalEntries.amountInUSD} ELSE 0 END), 0)`,
			lastDepreciationDate: sql<string | null>`MAX(CASE WHEN ${journalEntries.isDepreciation} = 1 THEN ${journalEntries.entryDate} ELSE NULL END)`,
		})
		.from(journalEntries)
		.where(eq(journalEntries.fixedAssetId, assetId));

	const row = rows[0];
	const initialValue = row?.initialValue ?? 0;
	const accumulatedDepreciation = row?.accumulatedDepreciation ?? 0;
	const remainingValue = Math.round((initialValue - accumulatedDepreciation) * 100) / 100;
	const lastDepreciationDate = row?.lastDepreciationDate ?? null;

	return { initialValue, accumulatedDepreciation, remainingValue, lastDepreciationDate };
}

/**
 * Get account name for a subledger account id.
 */
async function getAccountName(id: number): Promise<string> {
	const rows = await db.select({ name: subledgerAccounts.name }).from(subledgerAccounts).where(eq(subledgerAccounts.id, id)).limit(1);
	return rows[0]?.name ?? '';
}

/**
 * Validate that a subledger account exists and belongs to a GL account of the given type.
 */
async function validateAccountType(accountId: number, requiredType: string): Promise<{ valid: boolean; message?: string }> {
	const rows = await db
		.select({
			subId: subledgerAccounts.id,
			glType: glAccounts.type,
		})
		.from(subledgerAccounts)
		.innerJoin(glAccounts, eq(subledgerAccounts.glAccountId, glAccounts.id))
		.where(eq(subledgerAccounts.id, accountId))
		.limit(1);

	if (rows.length === 0) {
		return { valid: false, message: `Account ${accountId} not found` };
	}
	if (rows[0].glType !== requiredType) {
		return { valid: false, message: `Account ${accountId} must be under a GL account of type '${requiredType}', but is '${rows[0].glType}'` };
	}
	return { valid: true };
}

/**
 * Get already-posted depreciation months for an asset.
 */
async function getPostedMonths(assetId: number): Promise<string[]> {
	const rows = await db
		.select({ entryDate: journalEntries.entryDate })
		.from(journalEntries)
		.where(and(
			eq(journalEntries.fixedAssetId, assetId),
			eq(journalEntries.isDepreciation, true)
		));

	// entryDate is stored as a unix timestamp (integer mode: 'timestamp')
	// Convert each to 'YYYY-MM'
	return rows.map(r => {
		const d = r.entryDate instanceof Date ? r.entryDate : new Date(r.entryDate);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
	});
}

// ─── Routes ────────────────────────────────────────────────────────────────

export default async function fixedAssetsRoutes(fastify: FastifyInstance) {

	// ========================================================================
	// GET / — List all fixed assets with computed values
	// ========================================================================
	fastify.get('/', async () => {
		const assets = await db.select().from(fixedAssets).orderBy(desc(fixedAssets.createdAt));

		const result = await Promise.all(assets.map(async (asset) => {
			const agg = await computeAssetAggregates(asset.id);
			const assetAccountName = await getAccountName(asset.assetAccountId);
			const expenseAccountName = await getAccountName(asset.expenseAccountId);
			const isFullyDepreciated = agg.remainingValue <= asset.salvageValue;

			return {
				...asset,
				assetAccountName,
				expenseAccountName,
				initialValue: agg.initialValue,
				accumulatedDepreciation: agg.accumulatedDepreciation,
				remainingValue: agg.remainingValue,
				lastDepreciationDate: agg.lastDepreciationDate,
				isFullyDepreciated,
			};
		}));

		return result;
	});

	// ========================================================================
	// GET /:id — Single asset with computed values
	// ========================================================================
	fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);
		if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid asset ID' });

		const rows = await db.select().from(fixedAssets).where(eq(fixedAssets.id, id)).limit(1);
		if (rows.length === 0) return reply.status(404).send({ error: 'Not Found', message: `Asset ${id} not found` });

		const asset = rows[0];
		const agg = await computeAssetAggregates(asset.id);
		const assetAccountName = await getAccountName(asset.assetAccountId);
		const expenseAccountName = await getAccountName(asset.expenseAccountId);
		const isFullyDepreciated = agg.remainingValue <= asset.salvageValue;

		return {
			...asset,
			assetAccountName,
			expenseAccountName,
			initialValue: agg.initialValue,
			accumulatedDepreciation: agg.accumulatedDepreciation,
			remainingValue: agg.remainingValue,
			lastDepreciationDate: agg.lastDepreciationDate,
			isFullyDepreciated,
		};
	});

	// ========================================================================
	// POST / — Create a new fixed asset
	// ========================================================================
	fastify.post<{ Body: z.infer<typeof createAssetSchema> }>('/', async (request, reply) => {
		const data = createAssetSchema.parse(request.body);

		// Validate assetAccountId is under a GL account of type 'Asset'
		const assetAccCheck = await validateAccountType(data.assetAccountId, 'Asset');
		if (!assetAccCheck.valid) {
			return reply.status(400).send({ error: 'Bad Request', message: assetAccCheck.message! });
		}

		// Validate expenseAccountId is under a GL account of type 'Loss'
		const expenseAccCheck = await validateAccountType(data.expenseAccountId, 'Loss');
		if (!expenseAccCheck.valid) {
			return reply.status(400).send({ error: 'Bad Request', message: expenseAccCheck.message! });
		}

		// Validate activationDate if provided
		if (data.activationDate) {
			const d = new Date(data.activationDate);
			if (isNaN(d.getTime())) {
				return reply.status(400).send({ error: 'Bad Request', message: 'Invalid activation date' });
			}
		}

		const inserted = await db.insert(fixedAssets).values({
			name: data.name,
			description: data.description ?? null,
			assetAccountId: data.assetAccountId,
			expenseAccountId: data.expenseAccountId,
			depreciationMethod: data.depreciationMethod,
			convention: data.convention,
			usefulLifeMonths: data.usefulLifeMonths,
			salvageValue: data.salvageValue,
			activationDate: data.activationDate ?? null,
		}).returning();

		await logAudit({
			operation: 'CREATE',
			resourceType: 'fixed_asset' as any,
			resourceId: inserted[0].id,
			source: 'Web UI',
			newData: inserted[0],
		});
		await saveDatabase();

		return reply.status(201).send(inserted[0]);
	});

	// ========================================================================
	// PUT /:id — Update a fixed asset
	// ========================================================================
	fastify.put<{ Params: { id: string }; Body: z.infer<typeof updateAssetSchema> }>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);
		if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid asset ID' });

		const data = updateAssetSchema.parse(request.body);

		const existing = await db.select().from(fixedAssets).where(eq(fixedAssets.id, id)).limit(1);
		if (existing.length === 0) return reply.status(404).send({ error: 'Not Found', message: `Asset ${id} not found` });

		// Validate assetAccountId if provided
		if (data.assetAccountId !== undefined) {
			const check = await validateAccountType(data.assetAccountId, 'Asset');
			if (!check.valid) {
				return reply.status(400).send({ error: 'Bad Request', message: check.message! });
			}
		}

		// Validate expenseAccountId if provided
		if (data.expenseAccountId !== undefined) {
			const check = await validateAccountType(data.expenseAccountId, 'Loss');
			if (!check.valid) {
				return reply.status(400).send({ error: 'Bad Request', message: check.message! });
			}
		}

		// Validate activationDate if provided
		if (data.activationDate) {
			const d = new Date(data.activationDate);
			if (isNaN(d.getTime())) {
				return reply.status(400).send({ error: 'Bad Request', message: 'Invalid activation date' });
			}
		}

		const updated = await db.update(fixedAssets).set(data).where(eq(fixedAssets.id, id)).returning();

		await logAudit({
			operation: 'UPDATE',
			resourceType: 'fixed_asset' as any,
			resourceId: id,
			source: 'Web UI',
			oldData: existing[0],
			newData: updated[0],
		});
		await saveDatabase();

		return updated[0];
	});

	// ========================================================================
	// DELETE /:id — Delete a fixed asset
	// ========================================================================
	fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);
		if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid asset ID' });

		const existing = await db.select().from(fixedAssets).where(eq(fixedAssets.id, id)).limit(1);
		if (existing.length === 0) return reply.status(404).send({ error: 'Not Found', message: `Asset ${id} not found` });

		// Check if any journal entries are linked
		const linked = await db.select({ id: journalEntries.id }).from(journalEntries)
			.where(eq(journalEntries.fixedAssetId, id))
			.limit(1);

		if (linked.length > 0) {
			return reply.status(409).send({
				error: 'Conflict',
				message: 'Cannot delete asset with linked journal entries. Remove the journal entries first.',
			});
		}

		await db.delete(fixedAssets).where(eq(fixedAssets.id, id));

		await logAudit({
			operation: 'DELETE',
			resourceType: 'fixed_asset' as any,
			resourceId: id,
			source: 'Web UI',
			oldData: existing[0],
		});
		await saveDatabase();

		return reply.status(204).send();
	});

	// ========================================================================
	// GET /:id/schedule — Full depreciation schedule with posted status
	// ========================================================================
	fastify.get<{ Params: { id: string } }>('/:id/schedule', async (request, reply) => {
		const id = parseInt(request.params.id);
		if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid asset ID' });

		const rows = await db.select().from(fixedAssets).where(eq(fixedAssets.id, id)).limit(1);
		if (rows.length === 0) return reply.status(404).send({ error: 'Not Found', message: `Asset ${id} not found` });

		const asset = rows[0];
		if (!asset.activationDate) {
			return reply.status(400).send({ error: 'Bad Request', message: 'Asset has no activation date' });
		}

		// Compute initial value from journal entries
		const agg = await computeAssetAggregates(asset.id);

		const schedule = generateSchedule(
			asset.depreciationMethod as 'SL' | '200DB' | '150DB',
			asset.convention as 'half_year' | 'mid_month' | 'mid_quarter',
			agg.initialValue,
			asset.salvageValue,
			asset.usefulLifeMonths,
			asset.activationDate,
		);

		// Get posted months
		const postedMonths = new Set(await getPostedMonths(id));

		return schedule.map(entry => ({
			...entry,
			posted: postedMonths.has(entry.month),
		}));
	});

	// ========================================================================
	// POST /:id/depreciate — Post depreciation for a single month
	// ========================================================================
	fastify.post<{ Params: { id: string }; Body: z.infer<typeof monthSchema> }>('/:id/depreciate', async (request, reply) => {
		const id = parseInt(request.params.id);
		if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid asset ID' });

		const { month } = monthSchema.parse(request.body);

		// Validate asset exists
		const rows = await db.select().from(fixedAssets).where(eq(fixedAssets.id, id)).limit(1);
		if (rows.length === 0) return reply.status(404).send({ error: 'Not Found', message: `Asset ${id} not found` });

		const asset = rows[0];
		if (!asset.activationDate) {
			return reply.status(400).send({ error: 'Bad Request', message: 'Asset has no activation date' });
		}

		// Validate month is not before activation
		const activationMonth = asset.activationDate.substring(0, 7); // 'YYYY-MM'
		if (month < activationMonth) {
			return reply.status(400).send({ error: 'Bad Request', message: 'Month is before asset activation date' });
		}

		// Check if depreciation already posted for this month
		const postedMonths = await getPostedMonths(id);
		if (postedMonths.includes(month)) {
			return reply.status(409).send({ error: 'Conflict', message: `Depreciation already posted for ${month}` });
		}

		// Compute initial value and generate schedule
		const agg = await computeAssetAggregates(asset.id);

		const schedule = generateSchedule(
			asset.depreciationMethod as 'SL' | '200DB' | '150DB',
			asset.convention as 'half_year' | 'mid_month' | 'mid_quarter',
			agg.initialValue,
			asset.salvageValue,
			asset.usefulLifeMonths,
			asset.activationDate,
		);

		const scheduleEntry = schedule.find(e => e.month === month);
		if (!scheduleEntry) {
			return reply.status(400).send({ error: 'Bad Request', message: `No depreciation scheduled for ${month}` });
		}

		const amount = scheduleEntry.monthlyAmount;

		// Create the entry date as the first of the month
		const [yearStr, monthStr] = month.split('-');
		const entryDate = new Date(Date.UTC(parseInt(yearStr), parseInt(monthStr) - 1, 1));

		const newEntry = await db.insert(journalEntries).values({
			entryDate,
			amount,
			currencyCode: 'USD',
			amountInUSD: amount,
			debitAccountId: asset.expenseAccountId,
			creditAccountId: asset.assetAccountId,
			description: `Depreciation - ${asset.name} - ${month}`,
			fixedAssetId: id,
			isDepreciation: true,
		}).returning();

		await saveDatabase();

		return reply.status(201).send(newEntry[0]);
	});

	// ========================================================================
	// POST /depreciate-all — Batch depreciation for all eligible assets
	// ========================================================================
	fastify.post<{ Body: z.infer<typeof monthSchema> }>('/depreciate-all', async (request, reply) => {
		const { month } = monthSchema.parse(request.body);

		// Get all assets with an activation date
		const assets = await db.select().from(fixedAssets);
		const activeAssets = assets.filter(a => a.activationDate);

		let posted = 0;
		let skipped = 0;
		const errors: string[] = [];

		for (const asset of activeAssets) {
			try {
				// Skip if activation date is after the target month
				const activationMonth = asset.activationDate!.substring(0, 7);
				if (month < activationMonth) {
					skipped++;
					continue;
				}

				// Check if already posted for this month
				const postedMonths = await getPostedMonths(asset.id);
				if (postedMonths.includes(month)) {
					skipped++;
					continue;
				}

				// Compute initial value and check if fully depreciated
				const agg = await computeAssetAggregates(asset.id);
				if (agg.remainingValue <= asset.salvageValue) {
					skipped++;
					continue;
				}

				// Generate schedule and find the month
				const schedule = generateSchedule(
					asset.depreciationMethod as 'SL' | '200DB' | '150DB',
					asset.convention as 'half_year' | 'mid_month' | 'mid_quarter',
					agg.initialValue,
					asset.salvageValue,
					asset.usefulLifeMonths,
					asset.activationDate!,
				);

				const scheduleEntry = schedule.find(e => e.month === month);
				if (!scheduleEntry) {
					skipped++;
					continue;
				}

				const amount = scheduleEntry.monthlyAmount;
				const [yearStr, monthStr] = month.split('-');
				const entryDate = new Date(Date.UTC(parseInt(yearStr), parseInt(monthStr) - 1, 1));

				await db.insert(journalEntries).values({
					entryDate,
					amount,
					currencyCode: 'USD',
					amountInUSD: amount,
					debitAccountId: asset.expenseAccountId,
					creditAccountId: asset.assetAccountId,
					description: `Depreciation - ${asset.name} - ${month}`,
					fixedAssetId: asset.id,
					isDepreciation: true,
				});

				posted++;
			} catch (err) {
				errors.push(`Asset ${asset.id} (${asset.name}): ${err instanceof Error ? err.message : 'Unknown error'}`);
			}
		}

		await saveDatabase();

		return { posted, skipped, errors };
	});

	// ========================================================================
	// POST /:id/depreciate-past — Post all missing depreciation through target month
	// ========================================================================
	fastify.post<{ Params: { id: string }; Body: z.infer<typeof throughMonthSchema> }>('/:id/depreciate-past', async (request, reply) => {
		const id = parseInt(request.params.id);
		if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid asset ID' });

		const { throughMonth } = throughMonthSchema.parse(request.body);

		// Validate asset exists
		const rows = await db.select().from(fixedAssets).where(eq(fixedAssets.id, id)).limit(1);
		if (rows.length === 0) return reply.status(404).send({ error: 'Not Found', message: `Asset ${id} not found` });

		const asset = rows[0];
		if (!asset.activationDate) {
			return reply.status(400).send({ error: 'Bad Request', message: 'Asset has no activation date' });
		}

		// Get already posted months
		const postedMonths = await getPostedMonths(id);

		// Get eligible months that need posting
		const eligible = getEligibleMonths(
			asset.activationDate,
			asset.usefulLifeMonths,
			throughMonth,
			postedMonths,
		);

		// Compute initial value and generate schedule
		const agg = await computeAssetAggregates(asset.id);

		const schedule = generateSchedule(
			asset.depreciationMethod as 'SL' | '200DB' | '150DB',
			asset.convention as 'half_year' | 'mid_month' | 'mid_quarter',
			agg.initialValue,
			asset.salvageValue,
			asset.usefulLifeMonths,
			asset.activationDate,
		);

		const scheduleMap = new Map(schedule.map(e => [e.month, e]));

		let postedCount = 0;
		const entries: any[] = [];

		for (const month of eligible) {
			const scheduleEntry = scheduleMap.get(month);
			if (!scheduleEntry) continue;

			const amount = scheduleEntry.monthlyAmount;
			const [yearStr, monthStr] = month.split('-');
			const entryDate = new Date(Date.UTC(parseInt(yearStr), parseInt(monthStr) - 1, 1));

			const newEntry = await db.insert(journalEntries).values({
				entryDate,
				amount,
				currencyCode: 'USD',
				amountInUSD: amount,
				debitAccountId: asset.expenseAccountId,
				creditAccountId: asset.assetAccountId,
				description: `Depreciation - ${asset.name} - ${month}`,
				fixedAssetId: id,
				isDepreciation: true,
			}).returning();

			entries.push(newEntry[0]);
			postedCount++;
		}

		await saveDatabase();

		return { posted: postedCount, entries };
	});
}
