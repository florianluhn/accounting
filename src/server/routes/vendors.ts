import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import db, { saveDatabase } from '../db/connection.js';
import { vendors, journalEntries } from '../db/schema.js';
import { eq, like, desc } from 'drizzle-orm';
import { logAudit, generateBatchId } from '../services/audit.js';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

// Validation schemas
const createVendorSchema = z.object({
	name: z.string().min(1).max(200),
	address: z.string().max(500).optional(),
	phone: z.string().max(50).optional(),
	email: z.string().max(200).optional(),
	website: z.string().max(200).optional(),
	comments: z.string().max(1000).optional()
});

const updateVendorSchema = z.object({
	name: z.string().min(1).max(200).optional(),
	address: z.string().max(500).optional(),
	phone: z.string().max(50).optional(),
	email: z.string().max(200).optional(),
	website: z.string().max(200).optional(),
	comments: z.string().max(1000).optional()
});

export default async function vendorsRoutes(fastify: FastifyInstance) {
	// GET /api/vendors - List all vendors
	fastify.get<{ Querystring: { search?: string } }>(
		'/',
		async (request, reply) => {
			let query = db.select().from(vendors);

			if (request.query.search) {
				query = query.where(like(vendors.name, `%${request.query.search}%`)) as any;
			}

			const result = await query;
			return result;
		}
	);

	// GET /api/vendors/:id - Get single vendor
	fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);

		if (isNaN(id)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Invalid vendor ID'
			});
		}

		const vendor = await db.select().from(vendors).where(eq(vendors.id, id)).limit(1);

		if (vendor.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `Vendor ${id} not found`
			});
		}

		return vendor[0];
	});

	// GET /api/vendors/:id/journal-entries - Get journal entries for a vendor
	fastify.get<{ Params: { id: string } }>('/:id/journal-entries', async (request, reply) => {
		const id = parseInt(request.params.id);

		if (isNaN(id)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Invalid vendor ID'
			});
		}

		// Verify vendor exists
		const vendor = await db.select().from(vendors).where(eq(vendors.id, id)).limit(1);

		if (vendor.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `Vendor ${id} not found`
			});
		}

		const entries = await db
			.select()
			.from(journalEntries)
			.where(eq(journalEntries.vendorId, id))
			.orderBy(desc(journalEntries.entryDate));

		return entries;
	});

	// POST /api/vendors - Create new vendor
	fastify.post<{ Body: z.infer<typeof createVendorSchema> }>(
		'/',
		async (request, reply) => {
			const validatedData = createVendorSchema.parse(request.body);

			const newVendor = await db.insert(vendors).values(validatedData).returning();

			await logAudit({
				operation: 'CREATE',
				resourceType: 'vendor',
				resourceId: newVendor[0].id,
				source: 'Web UI',
				newData: newVendor[0]
			});

			await saveDatabase();

			return reply.status(201).send(newVendor[0]);
		}
	);

	// PUT /api/vendors/:id - Update vendor
	fastify.put<{
		Params: { id: string };
		Body: z.infer<typeof updateVendorSchema>;
	}>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);

		if (isNaN(id)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Invalid vendor ID'
			});
		}

		const validatedData = updateVendorSchema.parse(request.body);

		const existing = await db.select().from(vendors).where(eq(vendors.id, id)).limit(1);

		if (existing.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `Vendor ${id} not found`
			});
		}

		const updated = await db
			.update(vendors)
			.set(validatedData)
			.where(eq(vendors.id, id))
			.returning();

		await logAudit({
			operation: 'UPDATE',
			resourceType: 'vendor',
			resourceId: id,
			source: 'Web UI',
			oldData: existing[0],
			newData: updated[0]
		});

		await saveDatabase();

		return updated[0];
	});

	// DELETE /api/vendors/:id - Delete vendor
	fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);

		if (isNaN(id)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Invalid vendor ID'
			});
		}

		const existing = await db.select().from(vendors).where(eq(vendors.id, id)).limit(1);

		if (existing.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `Vendor ${id} not found`
			});
		}

		await db.delete(vendors).where(eq(vendors.id, id));

		await logAudit({
			operation: 'DELETE',
			resourceType: 'vendor',
			resourceId: id,
			source: 'Web UI',
			oldData: existing[0]
		});

		await saveDatabase();

		return reply.status(204).send();
	});

	// GET /api/vendors/export/csv - Export vendors as CSV
	fastify.get('/export/csv', async (request, reply) => {
		const allVendors = await db.select().from(vendors);

		const csvData = allVendors.map((v) => ({
			Name: v.name,
			Address: v.address || '',
			Phone: v.phone || '',
			Email: v.email || '',
			Website: v.website || '',
			Comments: v.comments || ''
		}));

		const csv = stringify(csvData, {
			header: true,
			columns: ['Name', 'Address', 'Phone', 'Email', 'Website', 'Comments']
		});

		reply.header('Content-Type', 'text/csv');
		reply.header('Content-Disposition', 'attachment; filename="vendors.csv"');
		return csv;
	});

	// POST /api/vendors/import/csv - Import vendors from CSV
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

		const validatedEntries: Array<{
			name: string;
			address: string | null;
			phone: string | null;
			email: string | null;
			website: string | null;
			comments: string | null;
		}> = [];

		for (let i = 0; i < records.length; i++) {
			const record = records[i];
			try {
				if (!record.Name || record.Name.trim() === '') {
					throw new Error('Name is required');
				}

				validatedEntries.push({
					name: record.Name.trim(),
					address: record.Address?.trim() || null,
					phone: record.Phone?.trim() || null,
					email: record.Email?.trim() || null,
					website: record.Website?.trim() || null,
					comments: record.Comments?.trim() || null
				});
			} catch (error) {
				results.failed++;
				const errorMsg = error instanceof Error ? error.message : 'Unknown error';
				results.errors.push(`Row ${i + 2}: ${errorMsg}`);
			}
		}

		if (results.failed > 0) {
			return reply.status(400).send({
				success: 0,
				failed: results.failed,
				errors: results.errors,
				message: 'Validation failed. No vendors were imported.'
			});
		}

		const batchId = generateBatchId();
		for (const entry of validatedEntries) {
			await db.insert(vendors).values(entry);
			results.success++;
		}

		await logAudit({
			operation: 'CREATE',
			resourceType: 'vendor',
			resourceId: batchId,
			source: 'CSV Import',
			batchId,
			batchSummary: `Imported ${results.success} vendors from CSV`,
			newData: { count: results.success }
		});

		await saveDatabase();

		return reply.status(200).send(results);
	});
}
