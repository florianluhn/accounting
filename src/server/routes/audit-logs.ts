import type { FastifyInstance } from 'fastify';
import db from '../db/connection.js';
import { auditLogs } from '../db/schema.js';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { stringify } from 'csv-stringify/sync';

export default async function auditLogsRoutes(fastify: FastifyInstance) {
	// GET /api/audit-logs - List audit logs with filters
	fastify.get<{
		Querystring: {
			startDate?: string;
			endDate?: string;
			resourceType?: string;
			operation?: string;
			source?: string;
			resourceId?: string;
			batchId?: string;
		};
	}>('/', async (request, reply) => {
		let query = db.select().from(auditLogs).orderBy(desc(auditLogs.timestamp));

		// Apply filters
		const conditions: any[] = [];

		if (request.query.startDate) {
			const startDate = new Date(request.query.startDate);
			if (!isNaN(startDate.getTime())) {
				conditions.push(gte(auditLogs.timestamp, startDate));
			}
		}

		if (request.query.endDate) {
			const endDate = new Date(request.query.endDate);
			if (!isNaN(endDate.getTime())) {
				// Set to end of day
				endDate.setUTCHours(23, 59, 59, 999);
				conditions.push(lte(auditLogs.timestamp, endDate));
			}
		}

		if (request.query.resourceType) {
			conditions.push(eq(auditLogs.resourceType, request.query.resourceType as any));
		}

		if (request.query.operation) {
			conditions.push(eq(auditLogs.operation, request.query.operation as any));
		}

		if (request.query.source) {
			conditions.push(eq(auditLogs.source, request.query.source as any));
		}

		if (request.query.resourceId) {
			conditions.push(eq(auditLogs.resourceId, request.query.resourceId));
		}

		if (request.query.batchId) {
			conditions.push(eq(auditLogs.batchId, request.query.batchId));
		}

		if (conditions.length > 0) {
			query = query.where(and(...conditions)) as any;
		}

		const logs = await query;

		// Parse JSON strings back to objects
		const parsedLogs = logs.map((log) => ({
			...log,
			oldData: log.oldData ? JSON.parse(log.oldData) : null,
			newData: log.newData ? JSON.parse(log.newData) : null
		}));

		return parsedLogs;
	});

	// GET /api/audit-logs/:id - Get single audit log
	fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);

		if (isNaN(id)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Invalid audit log ID'
			});
		}

		const log = await db.select().from(auditLogs).where(eq(auditLogs.id, id)).limit(1);

		if (log.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `Audit log ${id} not found`
			});
		}

		// Parse JSON strings back to objects
		const parsedLog = {
			...log[0],
			oldData: log[0].oldData ? JSON.parse(log[0].oldData) : null,
			newData: log[0].newData ? JSON.parse(log[0].newData) : null
		};

		return parsedLog;
	});

	// GET /api/audit-logs/export/csv - Export audit logs as CSV
	fastify.get<{
		Querystring: {
			startDate?: string;
			endDate?: string;
			resourceType?: string;
			operation?: string;
			source?: string;
			resourceId?: string;
			batchId?: string;
		};
	}>('/export/csv', async (request, reply) => {
		let query = db.select().from(auditLogs).orderBy(desc(auditLogs.timestamp));

		// Apply same filters as list endpoint
		const conditions: any[] = [];

		if (request.query.startDate) {
			const startDate = new Date(request.query.startDate);
			if (!isNaN(startDate.getTime())) {
				conditions.push(gte(auditLogs.timestamp, startDate));
			}
		}

		if (request.query.endDate) {
			const endDate = new Date(request.query.endDate);
			if (!isNaN(endDate.getTime())) {
				endDate.setUTCHours(23, 59, 59, 999);
				conditions.push(lte(auditLogs.timestamp, endDate));
			}
		}

		if (request.query.resourceType) {
			conditions.push(eq(auditLogs.resourceType, request.query.resourceType as any));
		}

		if (request.query.operation) {
			conditions.push(eq(auditLogs.operation, request.query.operation as any));
		}

		if (request.query.source) {
			conditions.push(eq(auditLogs.source, request.query.source as any));
		}

		if (request.query.resourceId) {
			conditions.push(eq(auditLogs.resourceId, request.query.resourceId));
		}

		if (request.query.batchId) {
			conditions.push(eq(auditLogs.batchId, request.query.batchId));
		}

		if (conditions.length > 0) {
			query = query.where(and(...conditions)) as any;
		}

		const logs = await query;

		// Convert to CSV format
		const records = logs.map((log) => ({
			id: log.id,
			timestamp: log.timestamp instanceof Date ? log.timestamp.toISOString() : new Date(log.timestamp as any).toISOString(),
			operation: log.operation,
			resourceType: log.resourceType,
			resourceId: log.resourceId,
			source: log.source,
			batchId: log.batchId || '',
			batchSummary: log.batchSummary || '',
			description: log.description || '',
			oldData: log.oldData || '',
			newData: log.newData || ''
		}));

		const csv = stringify(records, {
			header: true,
			columns: [
				'id',
				'timestamp',
				'operation',
				'resourceType',
				'resourceId',
				'source',
				'batchId',
				'batchSummary',
				'description',
				'oldData',
				'newData'
			]
		});

		reply
			.type('text/csv')
			.header('Content-Disposition', 'attachment; filename="audit-logs.csv"')
			.send(csv);
	});

	// GET /api/audit-logs/export/json - Export audit logs as JSON
	fastify.get<{
		Querystring: {
			startDate?: string;
			endDate?: string;
			resourceType?: string;
			operation?: string;
			source?: string;
			resourceId?: string;
			batchId?: string;
		};
	}>('/export/json', async (request, reply) => {
		let query = db.select().from(auditLogs).orderBy(desc(auditLogs.timestamp));

		// Apply same filters as list endpoint
		const conditions: any[] = [];

		if (request.query.startDate) {
			const startDate = new Date(request.query.startDate);
			if (!isNaN(startDate.getTime())) {
				conditions.push(gte(auditLogs.timestamp, startDate));
			}
		}

		if (request.query.endDate) {
			const endDate = new Date(request.query.endDate);
			if (!isNaN(endDate.getTime())) {
				endDate.setUTCHours(23, 59, 59, 999);
				conditions.push(lte(auditLogs.timestamp, endDate));
			}
		}

		if (request.query.resourceType) {
			conditions.push(eq(auditLogs.resourceType, request.query.resourceType as any));
		}

		if (request.query.operation) {
			conditions.push(eq(auditLogs.operation, request.query.operation as any));
		}

		if (request.query.source) {
			conditions.push(eq(auditLogs.source, request.query.source as any));
		}

		if (request.query.resourceId) {
			conditions.push(eq(auditLogs.resourceId, request.query.resourceId));
		}

		if (request.query.batchId) {
			conditions.push(eq(auditLogs.batchId, request.query.batchId));
		}

		if (conditions.length > 0) {
			query = query.where(and(...conditions)) as any;
		}

		const logs = await query;

		// Parse JSON strings back to objects
		const parsedLogs = logs.map((log) => ({
			...log,
			oldData: log.oldData ? JSON.parse(log.oldData) : null,
			newData: log.newData ? JSON.parse(log.newData) : null
		}));

		reply
			.type('application/json')
			.header('Content-Disposition', 'attachment; filename="audit-logs.json"')
			.send(JSON.stringify(parsedLogs, null, 2));
	});
}
