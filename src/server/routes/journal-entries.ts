import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import db, { saveDatabase } from '../db/connection.js';
import { journalEntries, subledgerAccounts, currencies, glAccounts, vendors, inventoryItems, customers } from '../db/schema.js';
import { eq, and, gte, lte, desc, or, isNull, ne, inArray } from 'drizzle-orm';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { logAudit, generateBatchId } from '../services/audit.js';

/**
 * Recompute an inventory item's dispositionType and quantity based on remaining
 * journal entries that reference it with a disposition link type.
 * Called after an entry is deleted or its item link changes.
 */
async function recomputeItemDisposition(itemId: number) {
	// Find all journal entries still linked to this item
	const remaining = await db
		.select({ inventoryLinkType: journalEntries.inventoryLinkType })
		.from(journalEntries)
		.where(eq(journalEntries.inventoryItemId, itemId))
		.orderBy(desc(journalEntries.createdAt));

	// Find the most recent one that sets a disposition
	const dispositionEntry = remaining.find(r =>
		r.inventoryLinkType && ['sale', 'own_use', 'gift'].includes(r.inventoryLinkType)
	);

	if (dispositionEntry) {
		// Another disposition entry still exists — keep its type
		await db.update(inventoryItems)
			.set({ dispositionType: dispositionEntry.inventoryLinkType, quantity: 0 })
			.where(eq(inventoryItems.id, itemId));
	} else {
		// No disposition entries left — clear the flag, restore stock
		await db.update(inventoryItems)
			.set({ dispositionType: null, quantity: 1 })
			.where(eq(inventoryItems.id, itemId));
	}
}

// Validation schemas
const createJournalEntrySchema = z.object({
	entryDate: z.coerce.date(),
	amount: z.number().min(0),
	currencyCode: z.string().length(3).default('USD'),
	debitAccountId: z.number().int().positive(),
	creditAccountId: z.number().int().positive(),
	description: z.string().min(1).max(500),
	category: z.string().max(100).optional(),
	comment: z.string().max(1000).optional(),
	vendorId: z.number().int().positive().nullable().optional(),
	customerId: z.number().int().positive().nullable().optional(),
	inventoryItemId: z.number().int().positive().nullable().optional(),
	inventoryLinkType: z.enum(['sale', 'own_use', 'gift']).nullable().optional(),
	fixedAssetId: z.number().int().positive().nullable().optional(),
	isDepreciation: z.boolean().optional()
}).refine((data) => data.debitAccountId !== data.creditAccountId, {
	message: 'Debit and credit accounts must be different',
	path: ['creditAccountId']
}).refine((data) => data.amount > 0 || !!data.inventoryItemId, {
	message: 'Amount can only be 0 when linked to an inventory item disposition',
	path: ['amount']
});

const updateJournalEntrySchema = z.object({
	entryDate: z.coerce.date().optional(),
	amount: z.number().min(0).optional(),
	currencyCode: z.string().length(3).optional(),
	debitAccountId: z.number().int().positive().optional(),
	creditAccountId: z.number().int().positive().optional(),
	description: z.string().min(1).max(500).optional(),
	category: z.string().max(100).optional(),
	comment: z.string().max(1000).optional(),
	vendorId: z.number().int().positive().nullable().optional(),
	customerId: z.number().int().positive().nullable().optional(),
	inventoryItemId: z.number().int().positive().nullable().optional(),
	inventoryLinkType: z.enum(['sale', 'own_use', 'gift']).nullable().optional(),
	fixedAssetId: z.number().int().positive().nullable().optional(),
	isDepreciation: z.boolean().optional()
});

/** Mass-change: find all entries matching a field value and replace it. */
const bulkUpdateSchema = z.object({
	field: z.enum(['category', 'description', 'copy_description_to_category']),
	/**
	 * Exact value to find.
	 * - category: empty string matches blank/null categories
	 * - description / copy_description_to_category: exact description text
	 */
	matchValue: z.string().max(500).optional().default(''),
	/**
	 * Replacement value.
	 * - category: empty string clears category
	 * - description: new description (required non-empty)
	 * - copy_description_to_category: new description after copying old one to category
	 */
	newValue: z.string().max(500).optional().default(''),
	/** Optional date range (same semantics as list filters). */
	startDate: z.coerce.date().optional(),
	endDate: z.coerce.date().optional(),
	/** If true, only return match count/sample — no writes. */
	preview: z.boolean().optional().default(false)
}).superRefine((data, ctx) => {
	if (data.field === 'description' || data.field === 'copy_description_to_category') {
		if (data.matchValue.trim() === '') {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'Description to find cannot be empty',
				path: ['matchValue']
			});
		}
		if (data.newValue.trim() === '') {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'New description cannot be empty',
				path: ['newValue']
			});
		}
	}
});

function buildBulkDateConditions(data: z.infer<typeof bulkUpdateSchema>) {
	const conditions: any[] = [];
	if (data.startDate && !isNaN(data.startDate.getTime())) {
		conditions.push(gte(journalEntries.entryDate, data.startDate));
	}
	if (data.endDate && !isNaN(data.endDate.getTime())) {
		conditions.push(lte(journalEntries.entryDate, data.endDate));
	}
	return conditions;
}

function buildBulkMatchConditions(data: z.infer<typeof bulkUpdateSchema>) {
	const conditions: any[] = [...buildBulkDateConditions(data)];

	if (data.field === 'copy_description_to_category') {
		// Only entries with this exact description
		conditions.push(eq(journalEntries.description, data.matchValue));
		return conditions;
	}

	if (data.field === 'category') {
		const match = data.matchValue.trim();
		if (match === '') {
			// Blank / missing category
			conditions.push(or(isNull(journalEntries.category), eq(journalEntries.category, '')));
		} else {
			conditions.push(eq(journalEntries.category, match));
		}
	} else {
		conditions.push(eq(journalEntries.description, data.matchValue));
	}

	return conditions;
}

/**
 * Apply field values to a specific list of journal entry IDs (selection-based mass change).
 * Only provided keys in `set` are updated.
 */
const bulkSetSchema = z.object({
	ids: z.array(z.number().int().positive()).min(1).max(5000),
	set: z
		.object({
			description: z.string().min(1).max(500).optional(),
			category: z.string().max(100).nullable().optional(),
			comment: z.string().max(1000).nullable().optional(),
			debitAccountId: z.number().int().positive().optional(),
			creditAccountId: z.number().int().positive().optional(),
			vendorId: z.number().int().positive().nullable().optional(),
			customerId: z.number().int().positive().nullable().optional(),
			currencyCode: z.string().length(3).optional(),
			entryDate: z.coerce.date().optional()
		})
		.refine((s) => Object.keys(s).length > 0, { message: 'At least one field to set is required' })
		.refine(
			(s) =>
				s.debitAccountId === undefined ||
				s.creditAccountId === undefined ||
				s.debitAccountId !== s.creditAccountId,
			{ message: 'Debit and credit accounts must be different' }
		)
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
			vendorId?: string;
			customerId?: string;
			inventoryItemId?: string;
			fixedAssetId?: string;
		}
	}>('/', async (request, reply) => {
		let query = db.select({
			id: journalEntries.id,
			entryDate: journalEntries.entryDate,
			amount: journalEntries.amount,
			currencyCode: journalEntries.currencyCode,
			amountInUSD: journalEntries.amountInUSD,
			debitAccountId: journalEntries.debitAccountId,
			creditAccountId: journalEntries.creditAccountId,
			description: journalEntries.description,
			category: journalEntries.category,
			comment: journalEntries.comment,
			vendorId: journalEntries.vendorId,
			customerId: journalEntries.customerId,
			customerName: customers.firstName,
			customerLastName: customers.lastName,
			inventoryItemId: journalEntries.inventoryItemId,
			inventoryLinkType: journalEntries.inventoryLinkType,
			inventoryItemName: inventoryItems.name,
			fixedAssetId: journalEntries.fixedAssetId,
			isDepreciation: journalEntries.isDepreciation,
			createdAt: journalEntries.createdAt,
			updatedAt: journalEntries.updatedAt
		}).from(journalEntries)
		 .leftJoin(inventoryItems, eq(journalEntries.inventoryItemId, inventoryItems.id))
		 .leftJoin(customers, eq(journalEntries.customerId, customers.id))
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

		if (request.query.vendorId) {
			const vendorId = parseInt(request.query.vendorId);
			if (!isNaN(vendorId)) {
				conditions.push(eq(journalEntries.vendorId, vendorId));
			}
		}

		if (request.query.customerId) {
			const customerId = parseInt(request.query.customerId);
			if (!isNaN(customerId)) {
				conditions.push(eq(journalEntries.customerId, customerId));
			}
		}

		if (request.query.inventoryItemId) {
			const inventoryItemId = parseInt(request.query.inventoryItemId);
			if (!isNaN(inventoryItemId)) {
				conditions.push(eq(journalEntries.inventoryItemId, inventoryItemId));
			}
		}

		if (request.query.fixedAssetId) {
			const fixedAssetId = parseInt(request.query.fixedAssetId);
			if (!isNaN(fixedAssetId)) {
				conditions.push(eq(journalEntries.fixedAssetId, fixedAssetId));
			}
		}

		if (conditions.length > 0) {
			query = query.where(and(...conditions)) as any;
		}

		const entries = await query;
		return entries;
	});

	// GET /api/journal-entries/meta/values - Distinct categories & descriptions for mass change UI
	fastify.get('/meta/values', async () => {
		const categoryRows = await db
			.select({ category: journalEntries.category })
			.from(journalEntries)
			.groupBy(journalEntries.category);

		const descriptionRows = await db
			.select({ description: journalEntries.description })
			.from(journalEntries)
			.groupBy(journalEntries.description);

		const categories = categoryRows
			.map((r) => r.category)
			.filter((c): c is string => c != null && c !== '')
			.sort((a, b) => a.localeCompare(b));

		const descriptions = descriptionRows
			.map((r) => r.description)
			.filter((d): d is string => !!d)
			.sort((a, b) => a.localeCompare(b))
			.slice(0, 500);

		return { categories, descriptions };
	});

	// POST /api/journal-entries/bulk-update - Mass change category or description
	fastify.post<{ Body: z.infer<typeof bulkUpdateSchema> }>('/bulk-update', async (request, reply) => {
		const data = bulkUpdateSchema.parse(request.body);
		const conditions = buildBulkMatchConditions(data);

		// Skip no-ops where value already equals new value (replace modes only)
		if (data.field === 'category') {
			const newCat = data.newValue.trim() === '' ? null : data.newValue.trim();
			if (newCat !== null) {
				conditions.push(or(isNull(journalEntries.category), ne(journalEntries.category, newCat))!);
			}
		} else if (data.field === 'description') {
			conditions.push(ne(journalEntries.description, data.newValue));
		}
		// copy mode always rewrites category + description for matched rows

		const whereClause = and(...conditions);

		const matched = await db
			.select({
				id: journalEntries.id,
				entryDate: journalEntries.entryDate,
				description: journalEntries.description,
				category: journalEntries.category,
				amount: journalEntries.amount,
				currencyCode: journalEntries.currencyCode
			})
			.from(journalEntries)
			.where(whereClause)
			.orderBy(desc(journalEntries.entryDate));

		const count = matched.length;
		const categoryAfter =
			data.field === 'copy_description_to_category' ? data.matchValue.slice(0, 100) : undefined;
		const sample = matched.slice(0, 10).map((row) => ({
			...row,
			...(data.field === 'copy_description_to_category'
				? {
						categoryAfter,
						descriptionAfter: data.newValue
					}
				: {})
		}));

		const responseBase = {
			field: data.field,
			matchValue: data.matchValue,
			newValue: data.newValue
		};

		if (data.preview) {
			return { preview: true, count, sample, ...responseBase };
		}

		if (count === 0) {
			return { preview: false, count: 0, updated: 0, ...responseBase };
		}

		let updated: { id: number }[];

		if (data.field === 'copy_description_to_category') {
			// 1) category ← current description (max 100 chars)
			// 2) description ← new description
			// Use the matched description text for category so the value is exact.
			const categoryValue = data.matchValue.slice(0, 100);
			updated = await db
				.update(journalEntries)
				.set({
					category: categoryValue,
					description: data.newValue
				})
				.where(whereClause)
				.returning({ id: journalEntries.id });
		} else {
			const updatePayload =
				data.field === 'category'
					? { category: data.newValue.trim() === '' ? null : data.newValue.trim() }
					: { description: data.newValue };

			updated = await db
				.update(journalEntries)
				.set(updatePayload)
				.where(whereClause)
				.returning({ id: journalEntries.id });
		}

		const batchId = generateBatchId();
		const auditDesc =
			data.field === 'copy_description_to_category'
				? `Mass copy description "${data.matchValue}" → category, then set description to "${data.newValue}" (${updated.length} entries)`
				: `Mass change ${data.field}: "${data.matchValue}" → "${data.newValue}" (${updated.length} entries)`;

		await logAudit({
			operation: 'UPDATE',
			resourceType: 'journal_entry',
			resourceId: batchId,
			source: 'Web UI',
			batchId,
			description: auditDesc,
			newData: {
				field: data.field,
				matchValue: data.matchValue,
				newValue: data.newValue,
				updatedCount: updated.length,
				ids: updated.map((r) => r.id)
			}
		});

		await saveDatabase();

		return {
			preview: false,
			count: updated.length,
			updated: updated.length,
			...responseBase
		};
	});

	// POST /api/journal-entries/bulk-set - Set fields on selected journal entries by ID
	fastify.post<{ Body: z.infer<typeof bulkSetSchema> }>('/bulk-set', async (request, reply) => {
		const data = bulkSetSchema.parse(request.body);
		const ids = [...new Set(data.ids)];

		const existing = await db
			.select({
				id: journalEntries.id,
				amount: journalEntries.amount,
				currencyCode: journalEntries.currencyCode,
				debitAccountId: journalEntries.debitAccountId,
				creditAccountId: journalEntries.creditAccountId
			})
			.from(journalEntries)
			.where(inArray(journalEntries.id, ids));

		if (existing.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: 'No matching journal entries found for the selected IDs'
			});
		}

		// Validate accounts if provided
		if (data.set.debitAccountId !== undefined) {
			const [acc] = await db
				.select({ id: subledgerAccounts.id })
				.from(subledgerAccounts)
				.where(eq(subledgerAccounts.id, data.set.debitAccountId))
				.limit(1);
			if (!acc) {
				return reply.status(400).send({ error: 'Bad Request', message: 'Debit account not found' });
			}
		}
		if (data.set.creditAccountId !== undefined) {
			const [acc] = await db
				.select({ id: subledgerAccounts.id })
				.from(subledgerAccounts)
				.where(eq(subledgerAccounts.id, data.set.creditAccountId))
				.limit(1);
			if (!acc) {
				return reply.status(400).send({ error: 'Bad Request', message: 'Credit account not found' });
			}
		}

		// Debit/credit must differ per entry when only one side is being set
		if (data.set.debitAccountId !== undefined || data.set.creditAccountId !== undefined) {
			for (const row of existing) {
				const debit = data.set.debitAccountId ?? row.debitAccountId;
				const credit = data.set.creditAccountId ?? row.creditAccountId;
				if (debit === credit) {
					return reply.status(400).send({
						error: 'Bad Request',
						message: `Debit and credit accounts would be the same on entry #${row.id}`
					});
				}
			}
		}

		if (data.set.currencyCode !== undefined) {
			const [cur] = await db
				.select()
				.from(currencies)
				.where(eq(currencies.code, data.set.currencyCode))
				.limit(1);
			if (!cur) {
				return reply.status(400).send({ error: 'Bad Request', message: `Currency ${data.set.currencyCode} not found` });
			}
		}

		const updatePayload: Record<string, unknown> = {};
		if (data.set.description !== undefined) updatePayload.description = data.set.description;
		if (data.set.category !== undefined) {
			updatePayload.category = data.set.category === '' ? null : data.set.category;
		}
		if (data.set.comment !== undefined) {
			updatePayload.comment = data.set.comment === '' ? null : data.set.comment;
		}
		if (data.set.debitAccountId !== undefined) updatePayload.debitAccountId = data.set.debitAccountId;
		if (data.set.creditAccountId !== undefined) updatePayload.creditAccountId = data.set.creditAccountId;
		if (data.set.vendorId !== undefined) updatePayload.vendorId = data.set.vendorId;
		if (data.set.customerId !== undefined) updatePayload.customerId = data.set.customerId;
		if (data.set.entryDate !== undefined) updatePayload.entryDate = data.set.entryDate;

		const targetIds = existing.map((r) => r.id);

		// Currency change: recompute amountInUSD per entry (amounts may differ)
		if (data.set.currencyCode !== undefined) {
			const [cur] = await db
				.select()
				.from(currencies)
				.where(eq(currencies.code, data.set.currencyCode))
				.limit(1);
			const rate = cur!.exchangeRate;
			for (const row of existing) {
				const amountInUSD = Math.round(row.amount * rate * 100) / 100;
				await db
					.update(journalEntries)
					.set({ ...updatePayload, currencyCode: data.set.currencyCode, amountInUSD })
					.where(eq(journalEntries.id, row.id));
			}
		} else {
			await db
				.update(journalEntries)
				.set(updatePayload)
				.where(inArray(journalEntries.id, targetIds));
		}

		const batchId = generateBatchId();
		const fields = Object.keys(data.set).join(', ');
		await logAudit({
			operation: 'UPDATE',
			resourceType: 'journal_entry',
			resourceId: batchId,
			source: 'Web UI',
			batchId,
			description: `Bulk set [${fields}] on ${targetIds.length} selected journal entries`,
			newData: {
				ids: targetIds,
				set: data.set,
				updatedCount: targetIds.length
			}
		});

		await saveDatabase();

		return {
			updated: targetIds.length,
			ids: targetIds,
			set: data.set
		};
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

			const linkType = validatedData.inventoryItemId ? (validatedData.inventoryLinkType ?? null) : null;

			// Insert new journal entry
			const newEntry = await db
				.insert(journalEntries)
				.values({
					...validatedData,
					amountInUSD,
					customerId: validatedData.customerId ?? null,
					inventoryItemId: validatedData.inventoryItemId ?? null,
					inventoryLinkType: linkType,
					fixedAssetId: validatedData.fixedAssetId ?? null,
					isDepreciation: validatedData.isDepreciation ?? false
				})
				.returning();

			// Sync dispositionType on linked inventory item (only for disposition types, not related costs)
			if (validatedData.inventoryItemId && linkType && ['sale', 'own_use', 'gift'].includes(linkType)) {
				await db.update(inventoryItems)
					.set({ dispositionType: linkType, quantity: 0 })
					.where(eq(inventoryItems.id, validatedData.inventoryItemId));
			}

			// Log audit entry
			await logAudit({
				operation: 'CREATE',
				resourceType: 'journal_entry',
				resourceId: newEntry[0].id,
				source: 'Web UI',
				newData: newEntry[0]
			});

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

		const oldEntry = existing[0];

		// Update journal entry
		const updated = await db
			.update(journalEntries)
			.set(updateData)
			.where(eq(journalEntries.id, id))
			.returning();

		const newEntry = updated[0];

		// Sync inventory item disposition on update
		const oldItemId = oldEntry.inventoryItemId;
		const newItemId = newEntry.inventoryItemId;
		const newLinkType = newEntry.inventoryLinkType;

		// If the linked item changed or was removed, clear the old item's disposition
		// (only if no other disposition entry still references it)
		if (oldItemId && oldItemId !== newItemId) {
			await recomputeItemDisposition(oldItemId);
		}

		// Set disposition on the (possibly new) linked item
		if (newItemId && newLinkType && ['sale', 'own_use', 'gift'].includes(newLinkType)) {
			await db.update(inventoryItems)
				.set({ dispositionType: newLinkType, quantity: 0 })
				.where(eq(inventoryItems.id, newItemId));
		}
		// If the item stayed the same but link type was cleared, recompute
		if (newItemId && oldItemId === newItemId && !newLinkType && oldEntry.inventoryLinkType) {
			await recomputeItemDisposition(newItemId);
		}

		// Log audit entry
		await logAudit({
			operation: 'UPDATE',
			resourceType: 'journal_entry',
			resourceId: id,
			source: 'Web UI',
			oldData: oldEntry,
			newData: newEntry
		});

		// Save database
		await saveDatabase();

		return newEntry;
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

		const oldEntry = existing[0];

		// Delete journal entry
		await db.delete(journalEntries).where(eq(journalEntries.id, id));

		// Clear disposition on linked inventory item if no other disposition entries remain
		if (oldEntry.inventoryItemId) {
			await recomputeItemDisposition(oldEntry.inventoryItemId);
		}

		// Log audit entry
		await logAudit({
			operation: 'DELETE',
			resourceType: 'journal_entry',
			resourceId: id,
			source: 'Web UI',
			oldData: oldEntry
		});

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
		const batchId = generateBatchId();
		for (const entry of validatedEntries) {
			await db.insert(journalEntries).values(entry);
			results.success++;
		}

		// Log audit entry for batch import
		await logAudit({
			operation: 'CREATE',
			resourceType: 'journal_entry',
			resourceId: batchId,
			source: 'CSV Import',
			batchId,
			batchSummary: `Imported ${results.success} journal entries from CSV`,
			newData: { count: results.success, entries: validatedEntries.length }
		});

		// Save database
		await saveDatabase();

		return reply.status(200).send(results);
	});
}
