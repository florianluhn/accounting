import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import db, { saveDatabase } from '../db/connection.js';
import {
	inventoryCategories,
	inventoryItems,
	materialAllocations,
	journalEntries
} from '../db/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import { logAudit } from '../services/audit.js';
import { computeTotalValue, resolveFields, type FieldDefinition } from '../services/formula.js';
import { parse as csvParse } from 'csv-parse/sync';
import { stringify as csvStringify } from 'csv-stringify/sync';

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
	categoryType: z.enum(['raw_material', 'finished_good', 'other']).default('other'),
	quantityField: z.string().max(50).optional(),
	fieldDefinitions: z.array(fieldDefinitionSchema),
	valueFormula: z.string().max(500).optional().default('')
});

const updateCategorySchema = createCategorySchema.partial();

const createItemSchema = z.object({
	name: z.string().min(1).max(200),
	fieldValues: z.record(z.union([z.string(), z.number()])),
	quantity: z.number().int().min(0).max(1).optional().default(1)
});

const updateItemSchema = z.object({
	name: z.string().min(1).max(200).optional(),
	fieldValues: z.record(z.union([z.string(), z.number()])).optional(),
	quantity: z.number().int().min(0).max(1).optional()
});

const createAllocationSchema = z.object({
	rawMaterialItemId: z.number().int().positive(),
	finishedGoodItemId: z.number().int().positive(),
	quantityUsed: z.number().positive(),
	notes: z.string().max(500).optional(),
	allocationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
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
				categoryType: inventoryCategories.categoryType,
				quantityField: inventoryCategories.quantityField,
				fieldDefinitions: inventoryCategories.fieldDefinitions,
				valueFormula: inventoryCategories.valueFormula,
				createdAt: inventoryCategories.createdAt,
				updatedAt: inventoryCategories.updatedAt,
				itemCount: sql<number>`COALESCE(COUNT(${inventoryItems.id}), 0)`,
				totalValue: sql<number>`COALESCE(SUM(CASE WHEN ${inventoryCategories.categoryType} = 'raw_material' THEN COALESCE(${inventoryItems.remainingValue}, ${inventoryItems.totalValue}) ELSE ${inventoryItems.totalValue} END), 0)`
			})
			.from(inventoryCategories)
			.leftJoin(inventoryItems, eq(inventoryItems.categoryId, inventoryCategories.id))
			.groupBy(inventoryCategories.id)
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
				categoryType: inventoryCategories.categoryType,
				quantityField: inventoryCategories.quantityField,
				fieldDefinitions: inventoryCategories.fieldDefinitions,
				valueFormula: inventoryCategories.valueFormula,
				createdAt: inventoryCategories.createdAt,
				updatedAt: inventoryCategories.updatedAt,
				itemCount: sql<number>`COALESCE(COUNT(${inventoryItems.id}), 0)`,
				totalValue: sql<number>`COALESCE(SUM(CASE WHEN ${inventoryCategories.categoryType} = 'raw_material' THEN COALESCE(${inventoryItems.remainingValue}, ${inventoryItems.totalValue}) ELSE ${inventoryItems.totalValue} END), 0)`
			})
			.from(inventoryCategories)
			.leftJoin(inventoryItems, eq(inventoryItems.categoryId, inventoryCategories.id))
			.groupBy(inventoryCategories.id)
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
			categoryType: data.categoryType,
			quantityField: data.quantityField,
			fieldDefinitions: JSON.stringify(data.fieldDefinitions),
			valueFormula: data.valueFormula,
			assetAccountId: 0 // legacy NOT NULL constraint in DB; column no longer used
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

	// GET /api/inventory/categories/:id/export/csv
	fastify.get<{ Params: { id: string } }>('/categories/:id/export/csv', async (request, reply) => {
		const id = parseInt(request.params.id);
		if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid category ID' });

		const [category] = await db.select().from(inventoryCategories).where(eq(inventoryCategories.id, id)).limit(1);
		if (!category) return reply.status(404).send({ error: 'Not Found', message: `Category ${id} not found` });

		const fieldDefs: FieldDefinition[] = JSON.parse(category.fieldDefinitions as string);
		const items = await db.select().from(inventoryItems)
			.where(eq(inventoryItems.categoryId, id))
			.orderBy(inventoryItems.name);

		const rows = items.map(item => {
			const resolved = resolveFields(fieldDefs, JSON.parse(item.fieldValues as string));
			const row: Record<string, string | number> = { ID: item.name };
			for (const f of fieldDefs) row[f.label] = resolved[f.key] ?? '';
			row['Total Value'] = item.totalValue;
			return row;
		});

		const csv = csvStringify(rows, {
			header: true,
			columns: ['ID', ...fieldDefs.map(f => f.label), 'Total Value']
		});

		reply.header('Content-Type', 'text/csv');
		reply.header('Content-Disposition', `attachment; filename="${category.name.replace(/[^a-z0-9]/gi, '_')}-inventory.csv"`);
		return reply.send(csv);
	});

	// POST /api/inventory/categories/:id/import/csv
	fastify.post<{ Params: { id: string } }>('/categories/:id/import/csv', async (request, reply) => {
		const id = parseInt(request.params.id);
		if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid category ID' });

		const [category] = await db.select().from(inventoryCategories).where(eq(inventoryCategories.id, id)).limit(1);
		if (!category) return reply.status(404).send({ error: 'Not Found', message: `Category ${id} not found` });

		const data = await request.file();
		if (!data) return reply.status(400).send({ error: 'Bad Request', message: 'No file uploaded' });

		const buffer = await data.toBuffer();
		const csvContent = buffer.toString('utf-8');

		let records: Record<string, string>[];
		try {
			records = csvParse(csvContent, { columns: true, skip_empty_lines: true, trim: true });
		} catch {
			return reply.status(400).send({ error: 'Bad Request', message: 'Invalid CSV format' });
		}

		const fieldDefs: FieldDefinition[] = JSON.parse(category.fieldDefinitions as string);
		const valueFormula = category.valueFormula as string;
		const isRawMaterial = category.categoryType === 'raw_material';
		// Only non-computed fields can be imported (computed are derived from formula)
		const importableFields = fieldDefs.filter(f => f.type !== 'computed');

		let imported = 0;
		let skipped = 0;
		const errors: string[] = [];

		for (let i = 0; i < records.length; i++) {
			const rec = records[i];
			const name = (rec['ID'] || rec['Name'])?.trim(); // accept both 'ID' and legacy 'Name'
			if (!name) { skipped++; continue; }

			const fieldValues: Record<string, string | number> = {};
			for (const f of importableFields) {
				const raw = rec[f.label]?.trim() ?? '';
				if (f.type === 'number') {
					const num = parseFloat(raw);
					fieldValues[f.key] = isNaN(num) ? 0 : num;
				} else {
					fieldValues[f.key] = raw;
				}
			}

			try {
				const resolved = resolveFields(fieldDefs, fieldValues);
				const totalValue = computeTotalValue(valueFormula, fieldDefs, fieldValues);
				const totalQuantity = isRawMaterial && category.quantityField
					? Number(resolved[category.quantityField as string] ?? 0)
					: null;

				await db.insert(inventoryItems).values({
					categoryId: id,
					name,
					fieldValues: JSON.stringify(resolved),
					totalValue,
					remainingQuantity: totalQuantity,
					remainingValue: isRawMaterial ? totalValue : null
				});
				imported++;
			} catch (e) {
				errors.push(`Row ${i + 2}: ${e instanceof Error ? e.message : 'Unknown error'}`);
				skipped++;
			}
		}

		await saveDatabase();
		return { imported, skipped, errors };
	});

	// GET /api/inventory/categories/:id/items
	fastify.get<{ Params: { id: string } }>('/categories/:id/items', async (request, reply) => {
		const categoryId = parseInt(request.params.id);
		if (isNaN(categoryId)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid category ID' });

		const items = await db
			.select({
				id: inventoryItems.id,
				categoryId: inventoryItems.categoryId,
				name: inventoryItems.name,
				fieldValues: inventoryItems.fieldValues,
				totalValue: inventoryItems.totalValue,
				quantity: inventoryItems.quantity,
				dispositionType: inventoryItems.dispositionType,
				remainingQuantity: inventoryItems.remainingQuantity,
				remainingValue: inventoryItems.remainingValue,
				createdAt: inventoryItems.createdAt,
				updatedAt: inventoryItems.updatedAt,
				saleEntryId: sql<number | null>`(SELECT je.id FROM journal_entries je WHERE je.inventory_item_id = inventory_items.id ORDER BY je.created_at DESC LIMIT 1)`,
				customerId: sql<number | null>`(SELECT je.customer_id FROM journal_entries je WHERE je.inventory_item_id = inventory_items.id ORDER BY je.created_at DESC LIMIT 1)`,
				customerName: sql<string | null>`(SELECT c.first_name || ' ' || c.last_name FROM journal_entries je LEFT JOIN customers c ON je.customer_id = c.id WHERE je.inventory_item_id = inventory_items.id ORDER BY je.created_at DESC LIMIT 1)`
			})
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
				quantity: data.quantity ?? 1,
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
				totalValue,
				...(data.quantity !== undefined ? { quantity: data.quantity } : {})
			}).where(eq(inventoryItems.id, id));

			// Recompute remaining for raw materials (totalValue changed)
			if (category.categoryType === 'raw_material') await recalculateRemaining(id);

			const [updated] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id)).limit(1);
			await logAudit({ operation: 'UPDATE', resourceType: 'inventory_item', resourceId: id, source: 'Web UI', oldData: existing, newData: updated });
			await saveDatabase();
			return { ...updated, fieldValues: resolved };
		}
	);

	// POST /api/inventory/items/:id/own-use — mark item as own consumption (no journal entry needed)
	fastify.post<{ Params: { id: string } }>('/items/:id/own-use', async (request, reply) => {
		const id = parseInt(request.params.id);
		if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid item ID' });

		const [existing] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id)).limit(1);
		if (!existing) return reply.status(404).send({ error: 'Not Found', message: `Item ${id} not found` });

		await db.update(inventoryItems)
			.set({ quantity: 0, dispositionType: 'own_use' })
			.where(eq(inventoryItems.id, id));

		await saveDatabase();
		return { success: true };
	});

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
				allocationDate: materialAllocations.allocationDate,
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
				allocationDate: materialAllocations.allocationDate,
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
			notes: data.notes,
			allocationDate: data.allocationDate
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

}
