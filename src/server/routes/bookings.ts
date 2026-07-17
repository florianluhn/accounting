import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import db, { saveDatabase } from '../db/connection.js';
import { bookings, bookingPlatforms, customers, appSettings } from '../db/schema.js';
import { eq, desc, asc, and, lt, gt, ne } from 'drizzle-orm';
import { logAudit, generateBatchId } from '../services/audit.js';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

const DEFAULT_AVAILABILITY_PATH = '~/villaluhna/VillaLuhna_Website_Claude/availability.json';

function expandPath(p: string): string {
	if (!p) return p;
	if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
		return path.join(os.homedir(), p.slice(2));
	}
	return p;
}

const createBookingSchema = z.object({
	customerId: z.number().int().positive(),
	platformId: z.number().int().positive(),
	checkInDate: z.string().min(1),
	checkOutDate: z.string().min(1),
	nights: z.number().int().min(0).default(0),
	totalPaid: z.number().min(0).default(0),
	netAmount: z.number().min(0).default(0),
	cleaningFee: z.number().min(0).default(0),
	salesTax: z.number().min(0).default(0),
	touristTax: z.number().min(0).default(0),
	platformFee: z.number().min(0).default(0),
	rentalFee: z.number().min(0).default(0),
	comment: z.string().max(2000).optional().nullable(),
	// When the booking was added/recorded (yyyy-mm-dd); defaults to today if omitted
	addedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

const updateBookingSchema = createBookingSchema.partial();

const createPlatformSchema = z.object({
	name: z.string().min(1).max(100),
	sortOrder: z.number().int().optional(),
	platformFeeRate: z.number().min(0).max(100).optional(),
	withholdsTaxes: z.boolean().optional()
});

async function getBookingConfig() {
	const rows = await db.select().from(appSettings);
	const map: Record<string, string> = {};
	for (const row of rows) map[row.key] = row.value;
	return {
		cleaningFee: parseFloat(map.booking_cleaning_fee || '0') || 0,
		salesTaxRate: parseFloat(map.booking_sales_tax_rate || '0') || 0,
		touristTaxRate: parseFloat(map.booking_tourist_tax_rate || '0') || 0,
		websiteAvailabilityPath: map.website_availability_path || DEFAULT_AVAILABILITY_PATH
	};
}

export default async function bookingsRoutes(fastify: FastifyInstance) {
	// ==========================
	// Booking config (defaults)
	// ==========================
	fastify.get('/config', async () => {
		return getBookingConfig();
	});

	fastify.put<{ Body: Partial<{ cleaningFee: number; salesTaxRate: number; touristTaxRate: number; websiteAvailabilityPath: string }> }>(
		'/config',
		async (request) => {
			const body = request.body || {};
			const numPairs: Record<string, number | undefined> = {
				booking_cleaning_fee: body.cleaningFee,
				booking_sales_tax_rate: body.salesTaxRate,
				booking_tourist_tax_rate: body.touristTaxRate
			};
			for (const [key, value] of Object.entries(numPairs)) {
				if (typeof value === 'number' && !isNaN(value)) {
					await db.insert(appSettings)
						.values({ key, value: String(value) })
						.onConflictDoUpdate({ target: appSettings.key, set: { value: String(value) } });
				}
			}
			if (typeof body.websiteAvailabilityPath === 'string') {
				const v = body.websiteAvailabilityPath.trim();
				await db.insert(appSettings)
					.values({ key: 'website_availability_path', value: v })
					.onConflictDoUpdate({ target: appSettings.key, set: { value: v } });
			}
			await saveDatabase();
			return getBookingConfig();
		}
	);

	// ==========================
	// Sync availability to website
	// ==========================
	fastify.post('/sync-availability', async (_request, reply) => {
		const cfg = await getBookingConfig();
		const rawPath = cfg.websiteAvailabilityPath;
		if (!rawPath) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Website availability path is not configured'
			});
		}
		const targetPath = expandPath(rawPath);

		// Verify the parent directory exists — refuse to silently create a tree
		try {
			const parent = path.dirname(targetPath);
			await fs.access(parent);
		} catch {
			return reply.status(400).send({
				error: 'Bad Request',
				message: `Target directory does not exist: ${path.dirname(targetPath)}`
			});
		}

		const all = await db.select().from(bookings).orderBy(asc(bookings.checkInDate));
		const entries = all.map((b) => ({ start: b.checkInDate, end: b.checkOutDate }));

		try {
			await fs.writeFile(targetPath, JSON.stringify(entries, null, 2) + '\n', 'utf8');
		} catch (err) {
			return reply.status(500).send({
				error: 'Internal Server Error',
				message: `Failed to write availability file: ${(err as Error).message}`
			});
		}

		return { count: entries.length, path: targetPath };
	});

	// ==========================
	// Booking platforms CRUD
	// ==========================
	fastify.get('/platforms', async () => {
		return db.select().from(bookingPlatforms).orderBy(asc(bookingPlatforms.sortOrder), asc(bookingPlatforms.name));
	});

	fastify.post<{ Body: z.infer<typeof createPlatformSchema> }>('/platforms', async (request, reply) => {
		const data = createPlatformSchema.parse(request.body);
		const inserted = await db.insert(bookingPlatforms).values(data).returning();
		await saveDatabase();
		return reply.status(201).send(inserted[0]);
	});

	fastify.put<{ Params: { id: string }; Body: z.infer<typeof createPlatformSchema> }>('/platforms/:id', async (request, reply) => {
		const id = parseInt(request.params.id);
		if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid platform ID' });
		const data = createPlatformSchema.parse(request.body);
		const updated = await db.update(bookingPlatforms).set(data).where(eq(bookingPlatforms.id, id)).returning();
		if (updated.length === 0) return reply.status(404).send({ error: 'Not Found', message: 'Platform not found' });
		await saveDatabase();
		return updated[0];
	});

	fastify.delete<{ Params: { id: string } }>('/platforms/:id', async (request, reply) => {
		const id = parseInt(request.params.id);
		if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid platform ID' });
		// Check if any bookings use this platform
		const inUse = await db.select().from(bookings).where(eq(bookings.platformId, id)).limit(1);
		if (inUse.length > 0) {
			return reply.status(409).send({
				error: 'Conflict',
				message: 'Cannot delete platform — it is used by one or more bookings'
			});
		}
		await db.delete(bookingPlatforms).where(eq(bookingPlatforms.id, id));
		await saveDatabase();
		return reply.status(204).send();
	});

	// ==========================
	// Bookings CRUD
	// ==========================
	fastify.get('/', async () => {
		const result = await db
			.select({
				id: bookings.id,
				customerId: bookings.customerId,
				customerFirstName: customers.firstName,
				customerLastName: customers.lastName,
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
				comment: bookings.comment,
				addedDate: bookings.addedDate,
				createdAt: bookings.createdAt,
				updatedAt: bookings.updatedAt
			})
			.from(bookings)
			.leftJoin(customers, eq(bookings.customerId, customers.id))
			.leftJoin(bookingPlatforms, eq(bookings.platformId, bookingPlatforms.id))
			.orderBy(desc(bookings.checkInDate));
		return result;
	});

	fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);
		if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid booking ID' });
		const result = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
		if (result.length === 0) return reply.status(404).send({ error: 'Not Found', message: 'Booking not found' });
		return result[0];
	});

	fastify.post<{ Body: z.infer<typeof createBookingSchema> }>('/', async (request, reply) => {
		const data = createBookingSchema.parse(request.body);
		// Validate customer exists
		const cust = await db.select().from(customers).where(eq(customers.id, data.customerId)).limit(1);
		if (cust.length === 0) return reply.status(400).send({ error: 'Bad Request', message: 'Customer not found' });
		// Validate platform exists
		const plat = await db.select().from(bookingPlatforms).where(eq(bookingPlatforms.id, data.platformId)).limit(1);
		if (plat.length === 0) return reply.status(400).send({ error: 'Bad Request', message: 'Platform not found' });

		// Check for overlapping dates
		const overlaps = await db.select().from(bookings).where(
			and(
				lt(bookings.checkInDate, data.checkOutDate),
				gt(bookings.checkOutDate, data.checkInDate)
			)
		).limit(1);
		if (overlaps.length > 0) {
			return reply.status(409).send({ error: 'Conflict', message: 'Booking dates overlap with an existing booking' });
		}

		const today = new Date().toISOString().slice(0, 10);
		const inserted = await db.insert(bookings).values({
			...data,
			comment: data.comment ?? null,
			addedDate: data.addedDate || today
		}).returning();
		await saveDatabase();
		return reply.status(201).send(inserted[0]);
	});

	fastify.put<{ Params: { id: string }; Body: z.infer<typeof updateBookingSchema> }>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);
		if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid booking ID' });
		const data = updateBookingSchema.parse(request.body);
		const existing = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
		if (existing.length === 0) return reply.status(404).send({ error: 'Not Found', message: 'Booking not found' });

		// Check for overlapping dates
		const checkIn = data.checkInDate || existing[0].checkInDate;
		const checkOut = data.checkOutDate || existing[0].checkOutDate;
		const overlaps = await db.select().from(bookings).where(
			and(
				ne(bookings.id, id),
				lt(bookings.checkInDate, checkOut),
				gt(bookings.checkOutDate, checkIn)
			)
		).limit(1);
		if (overlaps.length > 0) {
			return reply.status(409).send({ error: 'Conflict', message: 'Booking dates overlap with an existing booking' });
		}
		const updated = await db.update(bookings).set(data).where(eq(bookings.id, id)).returning();
		await saveDatabase();
		return updated[0];
	});

	fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);
		if (isNaN(id)) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid booking ID' });
		const existing = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
		if (existing.length === 0) return reply.status(404).send({ error: 'Not Found', message: 'Booking not found' });
		await db.delete(bookings).where(eq(bookings.id, id));
		await saveDatabase();
		return reply.status(204).send();
	});

	// GET /api/bookings/export/csv - Export bookings as CSV
	fastify.get('/export/csv', async (request, reply) => {
		const allBookings = await db
			.select({
				id: bookings.id,
				customerFirstName: customers.firstName,
				customerLastName: customers.lastName,
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
			.leftJoin(customers, eq(bookings.customerId, customers.id))
			.leftJoin(bookingPlatforms, eq(bookings.platformId, bookingPlatforms.id))
			.orderBy(desc(bookings.checkInDate));

		const formatDateExport = (isoDate: string) => {
			if (!isoDate) return '';
			const [y, m, d] = isoDate.split('-');
			return `${m}/${d}/${y}`;
		};

		const csvData = allBookings.map((b) => ({
			'Platform': b.platformName || '',
			'Customer First Name': b.customerFirstName || '',
			'Customer Last Name': b.customerLastName || '',
			'Check-In': formatDateExport(b.checkInDate),
			'Check-Out': formatDateExport(b.checkOutDate),
			'Nights': b.nights,
			'Total Paid': b.totalPaid,
			'Net Amount': b.netAmount,
			'Cleaning Fee': b.cleaningFee,
			'Sales Tax': b.salesTax,
			'Tourist Tax': b.touristTax,
			'Platform Fee': b.platformFee,
			'Rental Fee': b.rentalFee,
			'Comment': b.comment || ''
		}));

		const csv = stringify(csvData, {
			header: true,
			columns: [
				'Platform', 'Customer First Name', 'Customer Last Name', 
				'Check-In', 'Check-Out', 'Nights', 'Total Paid', 'Net Amount', 
				'Cleaning Fee', 'Sales Tax', 'Tourist Tax', 'Platform Fee', 
				'Rental Fee', 'Comment'
			]
		});

		reply.header('Content-Type', 'text/csv');
		reply.header('Content-Disposition', 'attachment; filename="bookings.csv"');
		return csv;
	});

	// POST /api/bookings/import/csv - Import bookings from CSV
	fastify.post('/import/csv', async (request, reply) => {
		const data = await request.file();
		if (!data) return reply.status(400).send({ error: 'Bad Request', message: 'No file uploaded' });

		const buffer = await data.toBuffer();
		const csvContent = buffer.toString('utf-8');

		let records: any[];
		try {
			records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });
		} catch (error) {
			return reply.status(400).send({ error: 'Bad Request', message: 'Invalid CSV format' });
		}

		const results = { success: 0, failed: 0, errors: [] as string[] };
		const validatedEntries: Array<any> = [];
		const allCustomers = await db.select().from(customers);
		const allPlatforms = await db.select().from(bookingPlatforms);
		const allBookings = await db.select().from(bookings);
		
		const parseDateImport = (dateStr: string) => {
			if (!dateStr) return '';
			if (dateStr.includes('-')) return dateStr; // fallback if already iso
			const parts = dateStr.split('/');
			if (parts.length !== 3) return dateStr;
			const [m, d, y] = parts;
			return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
		};

		// Keep track of bookings we're adding to check self-overlaps within CSV
		const pendingBookings: Array<{ checkIn: string, checkOut: string }> = [];

		for (let i = 0; i < records.length; i++) {
			const record = records[i];
			try {
				const pName = record['Platform']?.trim();
				if (!pName) throw new Error('Platform is required');
				let platId = allPlatforms.find(p => p.name.toLowerCase() === pName.toLowerCase())?.id;
				if (!platId) {
					// auto-create platform
					const newPlat = await db.insert(bookingPlatforms).values({ name: pName }).returning();
					platId = newPlat[0].id;
					allPlatforms.push(newPlat[0]);
				}

				const cFirst = record['Customer First Name']?.trim();
				const cLast = record['Customer Last Name']?.trim();
				if (!cFirst) throw new Error('Customer First Name is required');
				if (!cLast) throw new Error('Customer Last Name is required');
				
				let custId = allCustomers.find(c => 
					c.firstName.toLowerCase() === cFirst.toLowerCase() && 
					c.lastName.toLowerCase() === cLast.toLowerCase()
				)?.id;
				
				if (!custId) {
					// auto-create customer
					const newCust = await db.insert(customers).values({ firstName: cFirst, lastName: cLast }).returning();
					custId = newCust[0].id;
					allCustomers.push(newCust[0]);
				}

				const checkIn = parseDateImport(record['Check-In']);
				const checkOut = parseDateImport(record['Check-Out']);
				if (!checkIn || !checkOut) throw new Error('Check-In and Check-Out are required');
				if (checkIn >= checkOut) throw new Error('Check-Out must be after Check-In');

				// Check overlap with existing DB
				const overlapsDb = allBookings.some(b => checkIn < b.checkOutDate && checkOut > b.checkInDate);
				if (overlapsDb) throw new Error('Overlaps with existing booking in database');

				// Check overlap with pending from same CSV
				const overlapsPending = pendingBookings.some(b => checkIn < b.checkOut && checkOut > b.checkIn);
				if (overlapsPending) throw new Error('Overlaps with another booking in this CSV');

				const entry = {
					platformId: platId,
					customerId: custId,
					checkInDate: checkIn,
					checkOutDate: checkOut,
					nights: parseInt(record['Nights']) || 0,
					totalPaid: parseFloat(record['Total Paid']) || 0,
					netAmount: parseFloat(record['Net Amount']) || 0,
					cleaningFee: parseFloat(record['Cleaning Fee']) || 0,
					salesTax: parseFloat(record['Sales Tax']) || 0,
					touristTax: parseFloat(record['Tourist Tax']) || 0,
					platformFee: parseFloat(record['Platform Fee']) || 0,
					rentalFee: parseFloat(record['Rental Fee']) || 0,
					comment: record['Comment']?.trim() || null
				};
				validatedEntries.push(entry);
				pendingBookings.push({ checkIn, checkOut });
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
				message: 'Validation failed. No bookings were imported.'
			});
		}

		const batchId = generateBatchId();
		for (const entry of validatedEntries) {
			await db.insert(bookings).values(entry);
			results.success++;
		}

		await logAudit({
			operation: 'CREATE',
			resourceType: 'booking',
			resourceId: batchId,
			source: 'CSV Import',
			batchId,
			batchSummary: `Imported ${results.success} bookings from CSV`,
			newData: { count: results.success }
		});

		await saveDatabase();
		return reply.status(200).send(results);
	});
}
