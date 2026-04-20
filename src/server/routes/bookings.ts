import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import db, { saveDatabase } from '../db/connection.js';
import { bookings, bookingPlatforms, customers, appSettings } from '../db/schema.js';
import { eq, desc, asc } from 'drizzle-orm';

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
	comment: z.string().max(2000).optional().nullable()
});

const updateBookingSchema = createBookingSchema.partial();

const createPlatformSchema = z.object({
	name: z.string().min(1).max(100),
	sortOrder: z.number().int().optional()
});

const BOOKING_CONFIG_KEYS = [
	'booking_cleaning_fee',
	'booking_sales_tax_rate',
	'booking_tourist_tax_rate',
	'booking_platform_fee_rate'
] as const;

async function getBookingConfig() {
	const rows = await db.select().from(appSettings);
	const map: Record<string, string> = {};
	for (const row of rows) map[row.key] = row.value;
	return {
		cleaningFee: parseFloat(map.booking_cleaning_fee || '0') || 0,
		salesTaxRate: parseFloat(map.booking_sales_tax_rate || '0') || 0,
		touristTaxRate: parseFloat(map.booking_tourist_tax_rate || '0') || 0,
		platformFeeRate: parseFloat(map.booking_platform_fee_rate || '0') || 0
	};
}

export default async function bookingsRoutes(fastify: FastifyInstance) {
	// ==========================
	// Booking config (defaults)
	// ==========================
	fastify.get('/config', async () => {
		return getBookingConfig();
	});

	fastify.put<{ Body: Partial<{ cleaningFee: number; salesTaxRate: number; touristTaxRate: number; platformFeeRate: number }> }>(
		'/config',
		async (request) => {
			const body = request.body || {};
			const pairs: Record<string, number | undefined> = {
				booking_cleaning_fee: body.cleaningFee,
				booking_sales_tax_rate: body.salesTaxRate,
				booking_tourist_tax_rate: body.touristTaxRate,
				booking_platform_fee_rate: body.platformFeeRate
			};
			for (const [key, value] of Object.entries(pairs)) {
				if (typeof value === 'number' && !isNaN(value)) {
					await db.insert(appSettings)
						.values({ key, value: String(value) })
						.onConflictDoUpdate({ target: appSettings.key, set: { value: String(value) } });
				}
			}
			await saveDatabase();
			return getBookingConfig();
		}
	);

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

		const inserted = await db.insert(bookings).values({
			...data,
			comment: data.comment ?? null
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
}
