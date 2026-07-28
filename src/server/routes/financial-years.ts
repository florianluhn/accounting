import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { saveDatabase } from '../db/connection.js';
import {
	closeFinancialYear,
	listClosedYears,
	previewYearClose,
	previewOpenYear,
	openFinancialYear,
	repairYearEndCloseEntryDates,
	YearCloseError,
	getFinancialYearStartMonth
} from '../services/year-close.js';
import { logAudit } from '../services/audit.js';
import { getFinancialYear, formatFinancialYearLabel } from '../../lib/financial-year.js';

const fyYearSchema = z.object({
	fyYear: z.coerce.number().int().min(1900).max(2100)
});

function handleYearCloseError(error: unknown, reply: any) {
	if (error instanceof YearCloseError) {
		const name =
			error.statusCode === 403
				? 'Forbidden'
				: error.statusCode === 409
					? 'Conflict'
					: error.statusCode === 404
						? 'Not Found'
						: 'Bad Request';
		return reply.status(error.statusCode).send({
			error: name,
			message: error.message
		});
	}
	throw error;
}

export default async function financialYearsRoutes(fastify: FastifyInstance) {
	// GET /api/financial-years/closed
	fastify.get('/closed', async () => {
		const repaired = await repairYearEndCloseEntryDates();
		if (repaired > 0) await saveDatabase();
		return { years: await listClosedYears(), repairedEntryDates: repaired };
	});

	// GET /api/financial-years/preview?fyYear=2025
	fastify.get<{ Querystring: { fyYear?: string } }>('/preview', async (request, reply) => {
		try {
			const parsed = fyYearSchema.parse({
				fyYear: request.query.fyYear
			});
			return await previewYearClose(parsed.fyYear);
		} catch (error) {
			return handleYearCloseError(error, reply);
		}
	});

	// GET /api/financial-years/open-preview?fyYear=2025 — reconcile + reverse preview
	fastify.get<{ Querystring: { fyYear?: string } }>('/open-preview', async (request, reply) => {
		try {
			const parsed = fyYearSchema.parse({
				fyYear: request.query.fyYear
			});
			return await previewOpenYear(parsed.fyYear);
		} catch (error) {
			return handleYearCloseError(error, reply);
		}
	});

	// GET /api/financial-years/status — current FY + closed list (for UI)
	fastify.get('/status', async () => {
		// One-time style repair: shift any close entries that landed on 01/01 next year
		const repaired = await repairYearEndCloseEntryDates();
		if (repaired > 0) await saveDatabase();

		const startMonth = await getFinancialYearStartMonth();
		const currentFyYear = getFinancialYear(new Date(), startMonth);
		const years = await listClosedYears();
		return {
			startMonth,
			currentFyYear,
			currentLabel: formatFinancialYearLabel(currentFyYear, startMonth),
			closedYears: years,
			repairedEntryDates: repaired
		};
	});

	// POST /api/financial-years/close  { fyYear: 2025 }
	fastify.post<{ Body: { fyYear: number } }>('/close', async (request, reply) => {
		try {
			const { fyYear } = fyYearSchema.parse(request.body);
			const result = await closeFinancialYear(fyYear);
			await logAudit({
				operation: 'CREATE',
				resourceType: 'journal_entry',
				resourceId: result.id,
				source: 'Web UI',
				batchSummary: `Year-end close: ${result.label} (net income ${result.netIncome})`,
				description: `Closed financial year ${result.fyYear}: posted net income ${result.netIncome} to ${result.label}`,
				newData: result
			});
			await saveDatabase();
			return reply.status(201).send(result);
		} catch (error) {
			return handleYearCloseError(error, reply);
		}
	});

	// POST /api/financial-years/open  { fyYear: 2025 } — full reverse of year-end close
	fastify.post<{ Body: { fyYear: number } }>('/open', async (request, reply) => {
		try {
			const { fyYear } = fyYearSchema.parse(request.body);
			const result = await openFinancialYear(fyYear);
			await logAudit({
				operation: 'DELETE',
				resourceType: 'journal_entry',
				resourceId: result.fyYear,
				source: 'Web UI',
				batchSummary: `Reopened FY ${result.fyYear}: deleted ${result.deletedJournalEntries} year-end close entries`,
				description: `Opened financial year ${result.fyYear}: removed ${result.deletedJournalEntries} closing postings and unlocked the period`,
				oldData: result
			});
			await saveDatabase();
			return result;
		} catch (error) {
			return handleYearCloseError(error, reply);
		}
	});
}
