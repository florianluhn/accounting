import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import db, { saveDatabase } from '../db/connection.js';
import { customers, journalEntries, inventoryItems, subledgerAccounts, bookings, bookingPlatforms } from '../db/schema.js';
import { eq, like, or, desc } from 'drizzle-orm';
import { logAudit, generateBatchId } from '../services/audit.js';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

// Validation schemas
const createCustomerSchema = z.object({
	firstName: z.string().min(1).max(100),
	lastName: z.string().min(1).max(100),
	email: z.string().max(200).optional(),
	phone: z.string().max(50).optional(),
	country: z.string().max(100).optional(),
	state: z.string().max(100).optional(),
	zipCode: z.string().max(20).optional(),
	city: z.string().max(100).optional(),
	contactMethod: z.string().max(50).optional(),
	comment: z.string().max(1000).optional()
});

const updateCustomerSchema = z.object({
	firstName: z.string().min(1).max(100).optional(),
	lastName: z.string().min(1).max(100).optional(),
	email: z.string().max(200).optional(),
	phone: z.string().max(50).optional(),
	country: z.string().max(100).optional(),
	state: z.string().max(100).optional(),
	zipCode: z.string().max(20).optional(),
	city: z.string().max(100).optional(),
	contactMethod: z.string().max(50).optional(),
	comment: z.string().max(1000).optional()
});

export default async function customersRoutes(fastify: FastifyInstance) {
	// GET /api/customers - List all customers
	fastify.get<{ Querystring: { search?: string } }>(
		'/',
		async (request, reply) => {
			let query = db.select().from(customers);

			if (request.query.search) {
				const search = `%${request.query.search}%`;
				query = query.where(
					or(
						like(customers.firstName, search),
						like(customers.lastName, search),
						like(customers.email, search)
					)
				) as any;
			}

			const result = await query;
			return result;
		}
	);

	// GET /api/customers/export/csv - Export customers as CSV
	fastify.get('/export/csv', async (request, reply) => {
		const allCustomers = await db.select().from(customers);

		const csvData = allCustomers.map((c) => ({
			'First Name': c.firstName,
			'Last Name': c.lastName,
			Email: c.email || '',
			Phone: c.phone || '',
			Country: c.country || '',
			State: c.state || '',
			'ZIP Code': c.zipCode || '',
			City: c.city || '',
			'Contact Method': c.contactMethod || '',
			Comment: c.comment || ''
		}));

		const csv = stringify(csvData, {
			header: true,
			columns: ['First Name', 'Last Name', 'Email', 'Phone', 'Country', 'State', 'ZIP Code', 'City', 'Contact Method', 'Comment']
		});

		reply.header('Content-Type', 'text/csv');
		reply.header('Content-Disposition', 'attachment; filename="customers.csv"');
		return csv;
	});

	// POST /api/customers/import/csv - Import customers from CSV
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
			firstName: string;
			lastName: string;
			email: string | null;
			phone: string | null;
			country: string | null;
			state: string | null;
			zipCode: string | null;
			city: string | null;
			contactMethod: string | null;
			comment: string | null;
		}> = [];

		for (let i = 0; i < records.length; i++) {
			const record = records[i];
			try {
				if (!record['First Name'] || record['First Name'].trim() === '') {
					throw new Error('First Name is required');
				}
				if (!record['Last Name'] || record['Last Name'].trim() === '') {
					throw new Error('Last Name is required');
				}

				validatedEntries.push({
					firstName: record['First Name'].trim(),
					lastName: record['Last Name'].trim(),
					email: record.Email?.trim() || null,
					phone: record.Phone?.trim() || null,
					country: record.Country?.trim() || null,
					state: record.State?.trim() || null,
					zipCode: record['ZIP Code']?.trim() || null,
					city: record.City?.trim() || null,
					contactMethod: record['Contact Method']?.trim() || null,
					comment: record.Comment?.trim() || null
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
				message: 'Validation failed. No customers were imported.'
			});
		}

		const batchId = generateBatchId();
		for (const entry of validatedEntries) {
			await db.insert(customers).values(entry);
			results.success++;
		}

		await logAudit({
			operation: 'CREATE',
			resourceType: 'customer',
			resourceId: batchId,
			source: 'CSV Import',
			batchId,
			batchSummary: `Imported ${results.success} customers from CSV`,
			newData: { count: results.success }
		});

		await saveDatabase();

		return reply.status(200).send(results);
	});

	// GET /api/customers/:id/purchases - Get journal entries linked to inventory items for a customer
	fastify.get<{ Params: { id: string } }>('/:id/purchases', async (request, reply) => {
		const id = parseInt(request.params.id);
		if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid customer ID' });

		const purchases = await db
			.select({
				journalEntryId: journalEntries.id,
				entryDate: journalEntries.entryDate,
				amount: journalEntries.amount,
				currencyCode: journalEntries.currencyCode,
				description: journalEntries.description,
				inventoryLinkType: journalEntries.inventoryLinkType,
				inventoryItemId: inventoryItems.id,
				inventoryItemName: inventoryItems.name,
				inventoryItemValue: inventoryItems.totalValue
			})
			.from(journalEntries)
			.leftJoin(inventoryItems, eq(journalEntries.inventoryItemId, inventoryItems.id))
			.where(eq(journalEntries.customerId, id))
			.orderBy(desc(journalEntries.entryDate));

		return purchases;
	});

	// GET /api/customers/:id/bookings - Get bookings linked to customer
	fastify.get<{ Params: { id: string } }>('/:id/bookings', async (request, reply) => {
		const id = parseInt(request.params.id);
		if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid customer ID' });

		const result = await db
			.select({
				id: bookings.id,
				platformId: bookings.platformId,
				platformName: bookingPlatforms.name,
				checkInDate: bookings.checkInDate,
				checkOutDate: bookings.checkOutDate,
				nights: bookings.nights,
				totalPaid: bookings.totalPaid,
				netAmount: bookings.netAmount,
				cleaningFee: bookings.cleaningFee,
				salesTax: bookings.salesTax,
				touristTax: bookings.touristTax,
				platformFee: bookings.platformFee,
				rentalFee: bookings.rentalFee,
				comment: bookings.comment
			})
			.from(bookings)
			.leftJoin(bookingPlatforms, eq(bookings.platformId, bookingPlatforms.id))
			.where(eq(bookings.customerId, id))
			.orderBy(desc(bookings.checkInDate));

		return result;
	});

	// GET /api/customers/:id - Get single customer
	fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);

		if (isNaN(id)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Invalid customer ID'
			});
		}

		const customer = await db.select().from(customers).where(eq(customers.id, id)).limit(1);

		if (customer.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `Customer ${id} not found`
			});
		}

		return customer[0];
	});

	// POST /api/customers - Create new customer
	fastify.post<{ Body: z.infer<typeof createCustomerSchema> }>(
		'/',
		async (request, reply) => {
			const validatedData = createCustomerSchema.parse(request.body);

			const newCustomer = await db.insert(customers).values(validatedData).returning();

			await logAudit({
				operation: 'CREATE',
				resourceType: 'customer',
				resourceId: newCustomer[0].id,
				source: 'Web UI',
				newData: newCustomer[0]
			});

			await saveDatabase();

			return reply.status(201).send(newCustomer[0]);
		}
	);

	// PUT /api/customers/:id - Update customer
	fastify.put<{
		Params: { id: string };
		Body: z.infer<typeof updateCustomerSchema>;
	}>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);

		if (isNaN(id)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Invalid customer ID'
			});
		}

		const validatedData = updateCustomerSchema.parse(request.body);

		const existing = await db.select().from(customers).where(eq(customers.id, id)).limit(1);

		if (existing.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `Customer ${id} not found`
			});
		}

		const updated = await db
			.update(customers)
			.set(validatedData)
			.where(eq(customers.id, id))
			.returning();

		await logAudit({
			operation: 'UPDATE',
			resourceType: 'customer',
			resourceId: id,
			source: 'Web UI',
			oldData: existing[0],
			newData: updated[0]
		});

		await saveDatabase();

		return updated[0];
	});

	// DELETE /api/customers/:id - Delete customer
	fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);

		if (isNaN(id)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Invalid customer ID'
			});
		}

		const existing = await db.select().from(customers).where(eq(customers.id, id)).limit(1);

		if (existing.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `Customer ${id} not found`
			});
		}

		await db.delete(customers).where(eq(customers.id, id));

		await logAudit({
			operation: 'DELETE',
			resourceType: 'customer',
			resourceId: id,
			source: 'Web UI',
			oldData: existing[0]
		});

		await saveDatabase();

		return reply.status(204).send();
	});
}
