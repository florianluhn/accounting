import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import db, { saveDatabase } from '../db/connection.js';
import {
	inventoryCategories,
	inventoryItems,
	materialAllocations,
	subledgerAccounts
} from '../db/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import { logAudit } from '../services/audit.js';
import { computeTotalValue, resolveFields, type FieldDefinition } from '../services/formula.js';

// ─── Validation schemas ────────────────────────────────────────────────────

const fieldDefinitionSchema = z.object({
	key: z.string().min(1).max(50).regex(/^[a-z_][a-z0-9_]*$/, 'Key must be snake_case'),
	label: z.string().min(1).max(100),
	type: z.enum(['text', 'number', 'computed']),
	unit: z.string().max(20).optional(),
	formula: z.string().max(500).optional()
});

const createCategorySchema = z.object({
	name: z.string().min(1).max(200),
	description: z.string().max(1000).optional(),
	assetAccountId: z.number().int().positive(),
	categoryType: z.enum(['raw_material', 'finished_good', 'other']).default('other'),
	quantityField: z.string().max(50).optional(),
	fieldDefinitions: z.array(fieldDefinitionSchema),
	valueFormula: z.string().max(500)
});

const updateCategorySchema = createCategorySchema.partial();

const createItemSchema = z.object({
	name: z.string().min(1).max(200),
	fieldValues: z.record(z.union([z.string(), z.number()]))
});

const updateItemSchema = createItemSchema.partial();

const createAllocationSchema = z.object({
	rawMaterialItemId: z.number().int().positive(),
	finishedGoodItemId: z.number().int().positive(),
	quantityUsed: z.number().positive(),
	notes: z.string().max(500).optional()
});

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Recompute and store remaining_quantity + remaining_value for a raw material item.
 * Called after any allocation change.
 */
async function recalculateRemaining(rawMaterialItemId: number): Promise<void> {
	const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, rawMaterialItemId)).limit(1);
	if (!item) return;

	const [category] = await db.select().from(inventoryCategories).where(eq(inventoryCategories.id, item.categoryId)).limit(1);
	if (!category || !category.quantityField) return;

	const fieldValues = JSON.parse(item.fieldValues as string) as Record<string, string | number>;
	const totalQuantity = Number(fieldValues[category.quantityField as string] ?? 0);

	const allocs = await db.select().from(materialAllocations).where(eq(materialAllocations.rawMaterialItemId, rawMaterialItemId));
	const consumedQuantity = allocs.reduce((sum, a) => sum + a.quantityUsed, 0);

	const remainingQuantity = Math.max(0, totalQuantity - consumedQuantity);
	const remainingValue = totalQuantity > 0 ? item.totalValue * (remainingQuantity / totalQuantity) : 0;

	await db.update(inventoryItems)
		.set({ remainingQuantity, remainingValue })
		.where(eq(inventoryItems.id, rawMaterialItemId));
}

// ─── Routes ────────────────────────────────────────────────────────────────

export default async function inventoryRoutes(fastify: FastifyInstance) {

	// ── Categories ──────────────────────────────────────────────────────────

	// GET /api/inventory/categories
	fastify.get('/categories', async (request, reply) => {
		const categories = await db
			.select({
				id: inventoryCategories.id,
				name: inventoryCategories.name,
				description: inventoryCategories.description,
				assetAccountId: inventoryCategories.assetAccountId,
				categoryType: inventoryCategories.categoryType,
				quantityField: inventoryCategories.quantityField,
				fieldDefinitions: inventoryCategories.fieldDefinitions,
				valueFormula: inventoryCategories.valueFormula,
				createdAt: inventoryCategories.createdAt,
				updatedAt: inventoryCategories.updatedAt,
				itemCount: sql<number>`(SELECT COUNT(*) FROM inventory_items WHERE category_id = ${inventoryCategories.id})`,
				totalValue: sql<number>`(SELECT COALESCE(SUM(CASE WHEN ${inventoryCategories.categoryType} = 'raw_material' THEN COALESCE(remaining_value, total_value) ELSE total_value END), 0) FROM inventory_items WHERE category_id = ${inventoryCategories.id})`,
				accountNumber: subledgerAccounts.accountNumber,
				accountName: subledgerAccounts.name
			})
			.from(inventoryCategories)
			.innerJoin(subledgerAccounts, eq(inventoryCategories.assetAccountId, subledgerAccounts.id))
			.orderBy(inventoryCategories.name);

		return categories.map(c => ({
			...c,
			fieldDefinitions: JSON.parse(c.fieldDefinitions as string)
		}));
	});

	// GET /api/inventory/categories/:id
	fastify.get<{ Params: { id: string } }>('/categories/:id', async (request, reply) => {
		const id = parseInt(request.params.id);
		if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid category ID' });

		const rows = await db
			.select({
				id: inventoryCategories.id,
				name: inventoryCategories.name,
				description: inventoryCategories.description,
				assetAccountId: inventoryCategories.assetAccountId,
				categoryType: inventoryCategories.categoryType,
				quantityField: inventoryCategories.quantityField,
				fieldDefinitions: inventoryCategories.fieldDefinitions,
				valueFormula: inventoryCategories.valueFormula,
				createdAt: inventoryCategories.createdAt,
				updatedAt: inventoryCategories.updatedAt,
				itemCount: sql<number>`(SELECT COUNT(*) FROM inventory_items WHERE category_id = ${inventoryCategories.id})`,
				totalValue: sql<number>`(SELECT COALESCE(SUM(CASE WHEN ${inventoryCategories.categoryType} = 'raw_material' THEN COALESCE(remaining_value, total_value) ELSE total_value END), 0) FROM inventory_items WHERE category_id = ${inventoryCategories.id})`,
				accountNumber: subledgerAccounts.accountNumber,
				accountName: subledgerAccounts.name
			})
			.from(inventoryCategories)
			.innerJoin(subledgerAccounts, eq(inventoryCategories.assetAccountId, subledgerAccounts.id))
			.where(eq(inventoryCategories.id, id))
			.limit(1);

		if (rows.length === 0) return reply.status(404).send({ error: 'Not Found', message: `Category ${id} not found` });
		const row = rows[0];
		return { ...row, fieldDefinitions: JSON.parse(row.fieldDefinitions as string) };
	});

	// POST /api/inventory/categories
	fastify.post<{ Body: z.infer<typeof createCategorySchema> }>('/categories', async (request, reply) => {
		const data = createCategorySchema.parse(request.body);

		const inserted = await db.insert(inventoryCategories).values({
			name: data.name,
			description: data.description,
			assetAccountId: data.assetAccountId,
			categoryType: data.categoryType,
			quantityField: data.quantityField,
			fieldDefinitions: JSON.stringify(data.fieldDefinitions),
			valueFormula: data.valueFormula
		}).returning();

		await logAudit({ operation: 'CREATE', resourceType: 'inventory_category', resourceId: inserted[0].id, source: 'Web UI', newData: inserted[0] });
		await saveDatabase();
		return reply.status(201).send({ ...inserted[0], fieldDefinitions: data.fieldDefinitions });
	});

	// PUT /api/inventory/categories/:id
	fastify.put<{ Params: { id: string }; Body: z.infer<typeof updateCategorySchema> }>(
		'/categories/:id',
		async (request, reply) => {
			const id = parseInt(request.params.id);
			if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid category ID' });

			const data = updateCategorySchema.parse(request.body);
			const existing = await db.select().from(inventoryCategories).where(eq(inventoryCategories.id, id)).limit(1);
			if (existing.length === 0) return reply.status(404).send({ error: 'Not Found', message: `Category ${id} not found` });

			const updateData: any = { ...data };
			if (data.fieldDefinitions !== undefined) updateData.fieldDefinitions = JSON.stringify(data.fieldDefinitions);

			const updated = await db.update(inventoryCategories).set(updateData).where(eq(inventoryCategories.id, id)).returning();

			// Recompute total_value for all items if formula/fields changed
			if (data.valueFormula !== undefined || data.fieldDefinitions !== undefined) {
				const items = await db.select().from(inventoryItems).where(eq(inventoryItems.categoryId, id));
				const fieldDefs: FieldDefinition[] = JSON.parse(updated[0].fieldDefinitions as string);
				const valueFormula = updated[0].valueFormula as string;

				for (const item of items) {
					const fieldValues = JSON.parse(item.fieldValues as string);
					const totalValue = computeTotalValue(valueFormula, fieldDefs, fieldValues);
					await db.update(inventoryItems).set({ totalValue }).where(eq(inventoryItems.id, item.id));
				}
			}

			// Recompute remaining for all raw material items if quantityField changed
			if (data.quantityField !== undefined || data.valueFormula !== undefined || data.fieldDefinitions !== undefined) {
				if (updated[0].categoryType === 'raw_material') {
					const items = await db.select().from(inventoryItems).where(eq(inventoryItems.categoryId, id));
					for (const item of items) await recalculateRemaining(item.id);
				}
			}

			await logAudit({ operation: 'UPDATE', resourceType: 'inventory_category', resourceId: id, source: 'Web UI', oldData: existing[0], newData: updated[0] });
			await saveDatabase();
			return { ...updated[0], fieldDefinitions: JSON.parse(updated[0].fieldDefinitions as string) };
		}
	);

	// DELETE /api/inventory/categories/:id
	fastify.delete<{ Params: { id: string } }>('/categories/:id', async (request, reply) => {
		const id = parseInt(request.params.id);
		if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid category ID' });

		const existing = await db.select().from(inventoryCategories).where(eq(inventoryCategories.id, id)).limit(1);
		if (existing.length === 0) return reply.status(404).send({ error: 'Not Found', message: `Category ${id} not found` });

		await db.delete(inventoryCategories).where(eq(inventoryCategories.id, id));
		await logAudit({ operation: 'DELETE', resourceType: 'inventory_category', resourceId: id, source: 'Web UI', oldData: existing[0] });
		await saveDatabase();
		return reply.status(204).send();
	});

	// ── Items ────────────────────────────────────────────────────────────────

	// GET /api/inventory/categories/:id/items
	fastify.get<{ Params: { id: string } }>('/categories/:id/items', async (request, reply) => {
		const categoryId = parseInt(request.params.id);
		if (isNaN(categoryId)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid category ID' });

		const items = await db
			.select()
			.from(inventoryItems)
			.where(eq(inventoryItems.categoryId, categoryId))
			.orderBy(desc(inventoryItems.createdAt));

		return items.map(item => ({ ...item, fieldValues: JSON.parse(item.fieldValues as string) }));
	});

	// GET /api/inventory/items/:id  — single item with allocations
	fastify.get<{ Params: { id: string } }>('/items/:id', async (request, reply) => {
		const id = parseInt(request.params.id);
		if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid item ID' });

		const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id)).limit(1);
		if (!item) return reply.status(404).send({ error: 'Not Found', message: `Item ${id} not found` });

		return { ...item, fieldValues: JSON.parse(item.fieldValues as string) };
	});

	// POST /api/inventory/categories/:id/items
	fastify.post<{ Params: { id: string }; Body: z.infer<typeof createItemSchema> }>(
		'/categories/:id/items',
		async (request, reply) => {
			const categoryId = parseInt(request.params.id);
			if (isNaN(categoryId)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid category ID' });

			const [category] = await db.select().from(inventoryCategories).where(eq(inventoryCategories.id, categoryId)).limit(1);
			if (!category) return reply.status(404).send({ error: 'Not Found', message: `Category ${categoryId} not found` });

			const data = createItemSchema.parse(request.body);
			const fieldDefs: FieldDefinition[] = JSON.parse(category.fieldDefinitions as string);
			const valueFormula = category.valueFormula as string;

			const resolved = resolveFields(fieldDefs, data.fieldValues);
			const totalValue = computeTotalValue(valueFormula, fieldDefs, data.fieldValues);

			// For raw materials, initialise remaining to full quantity/value
			const isRawMaterial = category.categoryType === 'raw_material';
			const totalQuantity = isRawMaterial && category.quantityField
				? Number(resolved[category.quantityField as string] ?? 0)
				: null;

			const inserted = await db.insert(inventoryItems).values({
				categoryId,
				name: data.name,
				fieldValues: JSON.stringify(resolved),
				totalValue,
				remainingQuantity: totalQuantity,
				remainingValue: isRawMaterial ? totalValue : null
			}).returning();

			await logAudit({ operation: 'CREATE', resourceType: 'inventory_item', resourceId: inserted[0].id, source: 'Web UI', newData: inserted[0] });
			await saveDatabase();
			return reply.status(201).send({ ...inserted[0], fieldValues: resolved });
		}
	);

	// PUT /api/inventory/items/:id
	fastify.put<{ Params: { id: string }; Body: z.infer<typeof updateItemSchema> }>(
		'/items/:id',
		async (request, reply) => {
			const id = parseInt(request.params.id);
			if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid item ID' });

			const [existing] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id)).limit(1);
			if (!existing) return reply.status(404).send({ error: 'Not Found', message: `Item ${id} not found` });

			const [category] = await db.select().from(inventoryCategories).where(eq(inventoryCategories.id, existing.categoryId)).limit(1);
			const data = updateItemSchema.parse(request.body);

			const fieldDefs: FieldDefinition[] = JSON.parse(category.fieldDefinitions as string);
			const valueFormula = category.valueFormula as string;
			const newFieldValues = data.fieldValues ?? JSON.parse(existing.fieldValues as string);
			const resolved = resolveFields(fieldDefs, newFieldValues);
			const totalValue = computeTotalValue(valueFormula, fieldDefs, newFieldValues);

			await db.update(inventoryItems).set({
				name: data.name ?? existing.name,
				fieldValues: JSON.stringify(resolved),
				totalValue
			}).where(eq(inventoryItems.id, id));

			// Recompute remaining for raw materials (totalValue changed)
			if (category.categoryType === 'raw_material') await recalculateRemaining(id);

			const [updated] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id)).limit(1);
			await logAudit({ operation: 'UPDATE', resourceType: 'inventory_item', resourceId: id, source: 'Web UI', oldData: existing, newData: updated });
			await saveDatabase();
			return { ...updated, fieldValues: resolved };
		}
	);

	// DELETE /api/inventory/items/:id
	fastify.delete<{ Params: { id: string } }>('/items/:id', async (request, reply) => {
		const id = parseInt(request.params.id);
		if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid item ID' });

		const [existing] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id)).limit(1);
		if (!existing) return reply.status(404).send({ error: 'Not Found', message: `Item ${id} not found` });

		await db.delete(inventoryItems).where(eq(inventoryItems.id, id));
		await logAudit({ operation: 'DELETE', resourceType: 'inventory_item', resourceId: id, source: 'Web UI', oldData: existing });
		await saveDatabase();
		return reply.status(204).send();
	});

	// ── Material Allocations ─────────────────────────────────────────────────

	// GET /api/inventory/items/:id/allocations
	// Returns allocations from both perspectives (as raw material or as finished good)
	fastify.get<{ Params: { id: string } }>('/items/:id/allocations', async (request, reply) => {
		const id = parseInt(request.params.id);
		if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid item ID' });

		// As raw material: which finished goods consumed from this item
		const asRawMaterial = await db
			.select({
				id: materialAllocations.id,
				quantityUsed: materialAllocations.quantityUsed,
				notes: materialAllocations.notes,
				createdAt: materialAllocations.createdAt,
				finishedGoodItemId: materialAllocations.finishedGoodItemId,
				finishedGoodName: inventoryItems.name
			})
			.from(materialAllocations)
			.innerJoin(inventoryItems, eq(materialAllocations.finishedGoodItemId, inventoryItems.id))
			.where(eq(materialAllocations.rawMaterialItemId, id));

		// As finished good: which raw materials went into this item
		const asFinishedGood = await db
			.select({
				id: materialAllocations.id,
				quantityUsed: materialAllocations.quantityUsed,
				notes: materialAllocations.notes,
				createdAt: materialAllocations.createdAt,
				rawMaterialItemId: materialAllocations.rawMaterialItemId,
				rawMaterialName: inventoryItems.name
			})
			.from(materialAllocations)
			.innerJoin(inventoryItems, eq(materialAllocations.rawMaterialItemId, inventoryItems.id))
			.where(eq(materialAllocations.finishedGoodItemId, id));

		return { asRawMaterial, asFinishedGood };
	});

	// GET /api/inventory/raw-material-items  — all raw material items across all categories
	// Used by the allocation picker on a finished good item
	fastify.get('/raw-material-items', async (request, reply) => {
		const items = await db
			.select({
				id: inventoryItems.id,
				name: inventoryItems.name,
				categoryId: inventoryItems.categoryId,
				categoryName: inventoryCategories.name,
				quantityField: inventoryCategories.quantityField,
				fieldValues: inventoryItems.fieldValues,
				totalValue: inventoryItems.totalValue,
				remainingQuantity: inventoryItems.remainingQuantity,
				remainingValue: inventoryItems.remainingValue
			})
			.from(inventoryItems)
			.innerJoin(inventoryCategories, eq(inventoryItems.categoryId, inventoryCategories.id))
			.where(eq(inventoryCategories.categoryType, 'raw_material'))
			.orderBy(inventoryCategories.name, inventoryItems.name);

		return items.map(i => ({ ...i, fieldValues: JSON.parse(i.fieldValues as string) }));
	});

	// POST /api/inventory/allocations
	fastify.post<{ Body: z.infer<typeof createAllocationSchema> }>('/allocations', async (request, reply) => {
		const data = createAllocationSchema.parse(request.body);

		// Validate raw material item exists and has enough remaining
		const [rawItem] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, data.rawMaterialItemId)).limit(1);
		if (!rawItem) return reply.status(404).send({ error: 'Not Found', message: 'Raw material item not found' });

		const [rawCategory] = await db.select().from(inventoryCategories).where(eq(inventoryCategories.id, rawItem.categoryId)).limit(1);
		if (rawCategory.categoryType !== 'raw_material') {
			return reply.status(400).send({ error: 'Bad Request', message: 'Source item must be from a raw_material category' });
		}

		const remaining = rawItem.remainingQuantity ?? 0;
		if (data.quantityUsed > remaining + 0.0001) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: `Only ${remaining} ${rawCategory.quantityField ?? 'units'} remaining on this item`
			});
		}

		// Validate finished good item exists
		const [fgItem] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, data.finishedGoodItemId)).limit(1);
		if (!fgItem) return reply.status(404).send({ error: 'Not Found', message: 'Finished good item not found' });

		const inserted = await db.insert(materialAllocations).values({
			rawMaterialItemId: data.rawMaterialItemId,
			finishedGoodItemId: data.finishedGoodItemId,
			quantityUsed: data.quantityUsed,
			notes: data.notes
		}).returning();

		await recalculateRemaining(data.rawMaterialItemId);
		await saveDatabase();
		return reply.status(201).send(inserted[0]);
	});

	// DELETE /api/inventory/allocations/:id
	fastify.delete<{ Params: { id: string } }>('/allocations/:id', async (request, reply) => {
		const id = parseInt(request.params.id);
		if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid allocation ID' });

		const [existing] = await db.select().from(materialAllocations).where(eq(materialAllocations.id, id)).limit(1);
		if (!existing) return reply.status(404).send({ error: 'Not Found', message: `Allocation ${id} not found` });

		const rawMaterialItemId = existing.rawMaterialItemId;
		await db.delete(materialAllocations).where(eq(materialAllocations.id, id));
		await recalculateRemaining(rawMaterialItemId);
		await saveDatabase();
		return reply.status(204).send();
	});

	// GET /api/inventory/totals-by-account — used by balance sheet
	fastify.get('/totals-by-account', async (request, reply) => {
		const rows = await db
			.select({
				assetAccountId: inventoryCategories.assetAccountId,
				categoryId: inventoryCategories.id,
				categoryName: inventoryCategories.name,
				categoryType: inventoryCategories.categoryType,
				// Raw materials: sum remaining_value; finished goods & other: sum total_value
				totalValue: sql<number>`COALESCE(SUM(CASE WHEN ${inventoryCategories.categoryType} = 'raw_material' THEN COALESCE(${inventoryItems.remainingValue}, ${inventoryItems.totalValue}) ELSE ${inventoryItems.totalValue} END), 0)`
			})
			.from(inventoryCategories)
			.leftJoin(inventoryItems, eq(inventoryItems.categoryId, inventoryCategories.id))
			.groupBy(inventoryCategories.id);

		return rows;
	});
}
