import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import db from '../db/connection.js';
import { journalEntries, subledgerAccounts, glAccounts, currencies } from '../db/schema.js';
import { eq, and, lte, gte, sql, desc } from 'drizzle-orm';

// Validation schemas
const dateRangeSchema = z.object({
	startDate: z.coerce.date().optional(),
	endDate: z.coerce.date().optional(),
	currencyCode: z.string().length(3).default('USD')
});

interface AccountBalance {
	accountId: number;
	accountNumber: string;
	accountName: string;
	glAccountId: number;
	glAccountNumber: string;
	glAccountName: string;
	glAccountType: string;
	balance: number;
}

export default async function reportsRoutes(fastify: FastifyInstance) {
	// Helper function to calculate account balances
	async function calculateBalances(
		startDate?: Date,
		endDate?: Date,
		currencyCode: string = 'USD'
	): Promise<AccountBalance[]> {
		// Get all subledger accounts with their GL accounts (excluding Opening Balance accounts from reports)
		const accounts = await db
			.select({
				id: subledgerAccounts.id,
				accountNumber: subledgerAccounts.accountNumber,
				accountName: subledgerAccounts.name,
				glAccountId: glAccounts.id,
				glAccountNumber: glAccounts.accountNumber,
				glAccountName: glAccounts.name,
				glAccountType: glAccounts.type
			})
			.from(subledgerAccounts)
			.innerJoin(glAccounts, eq(subledgerAccounts.glAccountId, glAccounts.id))
			.where(
				and(
					eq(subledgerAccounts.isActive, true),
					sql`${glAccounts.type} != 'Opening Balance'`
				)
			);

		// Build conditions for date range
		const conditions: any[] = [];
		if (startDate) {
			// Set start date to beginning of day in UTC (00:00:00.000)
			const startOfDay = new Date(startDate);
			startOfDay.setUTCHours(0, 0, 0, 0);
			conditions.push(gte(journalEntries.entryDate, startOfDay));
		}
		if (endDate) {
			// Set end date to end of day in UTC (23:59:59.999) to include all entries on that day
			const endOfDay = new Date(endDate);
			endOfDay.setUTCHours(23, 59, 59, 999);
			conditions.push(lte(journalEntries.entryDate, endOfDay));
		}

		// Get all journal entries in date range
		let entriesQuery = db.select().from(journalEntries);
		if (conditions.length > 0) {
			entriesQuery = entriesQuery.where(and(...conditions)) as any;
		}
		const entries = await entriesQuery;

		// Calculate balances for each account
		const balances: AccountBalance[] = accounts.map((account) => {
			let balance = 0;

			// Sum debits and credits
			for (const entry of entries) {
				const amountInUSD = entry.amountInUSD;

				if (entry.debitAccountId === account.id) {
					// Debit increases: Assets, Expenses (Loss)
					// Debit decreases: Liabilities, Equity, Revenue (Profit)
					if (['Asset', 'Cash', 'Accounts Receivable', 'Loss'].includes(account.glAccountType)) {
						balance += amountInUSD;
					} else {
						balance -= amountInUSD;
					}
				}

				if (entry.creditAccountId === account.id) {
					// Credit decreases: Assets, Expenses (Loss)
					// Credit increases: Liabilities, Equity, Revenue (Profit)
					if (['Asset', 'Cash', 'Accounts Receivable', 'Loss'].includes(account.glAccountType)) {
						balance -= amountInUSD;
					} else {
						balance += amountInUSD;
					}
				}
			}

			return {
				accountId: account.id,
				accountNumber: account.accountNumber,
				accountName: account.accountName,
				glAccountId: account.glAccountId,
				glAccountNumber: account.glAccountNumber,
				glAccountName: account.glAccountName,
				glAccountType: account.glAccountType,
				balance
			};
		});

		return balances;
	}

	// GET /api/reports/balance-sheet - Balance Sheet Report
	fastify.get<{ Querystring: z.infer<typeof dateRangeSchema> }>(
		'/balance-sheet',
		async (request, reply) => {
			const { endDate, currencyCode } = dateRangeSchema.parse(request.query);

			// Balance sheet shows balances as of a specific date
			const balances = await calculateBalances(undefined, endDate, currencyCode);

			// Group by GL account type and sort by account number
			const assets = balances
				.filter((b) =>
					['Asset', 'Cash', 'Accounts Receivable'].includes(b.glAccountType)
				)
				.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber, undefined, { numeric: true }));
			const liabilities = balances
				.filter((b) => b.glAccountType === 'Accounts Payable')
				.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber, undefined, { numeric: true }));
			const equity = balances
				.filter((b) => b.glAccountType === 'Equity')
				.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber, undefined, { numeric: true }));

			// Calculate totals
			const totalAssets = assets.reduce((sum, a) => sum + a.balance, 0);
			const totalLiabilities = liabilities.reduce((sum, a) => sum + a.balance, 0);
			const totalEquity = equity.reduce((sum, a) => sum + a.balance, 0);

			// Calculate retained earnings (from Profit and Loss accounts)
			// Retained Earnings = Revenue (Profit) - Expenses (Loss)
			const revenue = balances.filter((b) => b.glAccountType === 'Profit');
			const expenses = balances.filter((b) => b.glAccountType === 'Loss');
			const totalRevenue = revenue.reduce((sum, a) => sum + a.balance, 0);
			const totalExpenses = expenses.reduce((sum, a) => sum + a.balance, 0);
			const retainedEarnings = totalRevenue - totalExpenses;

			return {
				asOfDate: endDate || new Date(),
				currencyCode,
				assets: {
					accounts: assets,
					total: totalAssets
				},
				liabilities: {
					accounts: liabilities,
					total: totalLiabilities
				},
				equity: {
					accounts: equity,
					retainedEarnings,
					total: totalEquity + retainedEarnings
				},
				totalLiabilitiesAndEquity: totalLiabilities + totalEquity + retainedEarnings,
				balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity + retainedEarnings)) < 0.01
			};
		}
	);

	// GET /api/reports/profit-loss - Profit & Loss Report
	fastify.get<{ Querystring: z.infer<typeof dateRangeSchema> }>(
		'/profit-loss',
		async (request, reply) => {
			const { startDate, endDate, currencyCode } = dateRangeSchema.parse(request.query);

			// P&L shows performance over a period
			const balances = await calculateBalances(startDate, endDate, currencyCode);

			// Filter for Profit and Loss accounts and sort by account number
			const revenue = balances
				.filter((b) => b.glAccountType === 'Profit')
				.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber, undefined, { numeric: true }));
			const expenses = balances
				.filter((b) => b.glAccountType === 'Loss')
				.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber, undefined, { numeric: true }));

			// Calculate totals
			const totalRevenue = revenue.reduce((sum, a) => sum + a.balance, 0);
			const totalExpenses = expenses.reduce((sum, a) => sum + a.balance, 0);
			const netIncome = totalRevenue - totalExpenses;

			return {
				startDate: startDate || new Date(0),
				endDate: endDate || new Date(),
				currencyCode,
				revenue: {
					accounts: revenue,
					total: totalRevenue
				},
				expenses: {
					accounts: expenses,
					total: totalExpenses
				},
				netIncome
			};
		}
	);

	// GET /api/reports/trial-balance - Trial Balance Report
	fastify.get<{ Querystring: z.infer<typeof dateRangeSchema> }>(
		'/trial-balance',
		async (request, reply) => {
			const { endDate, currencyCode } = dateRangeSchema.parse(request.query);

			// Trial balance shows all account balances
			const balances = await calculateBalances(undefined, endDate, currencyCode);

			// Separate debits and credits based on account type
			// Debit normal balance: Assets, Cash, Accounts Receivable, Loss (Expenses)
			// Credit normal balance: Liabilities (Accounts Payable), Equity, Profit (Revenue)
			const accountsWithBalances = balances
				.filter((b) => Math.abs(b.balance) > 0.01) // Only show accounts with non-zero balances
				.map((b) => {
					const isDebitAccount = ['Asset', 'Cash', 'Accounts Receivable', 'Loss'].includes(b.glAccountType);

					// For debit-normal accounts: positive balance = debit, negative = credit
					// For credit-normal accounts: positive balance = credit, negative = debit
					if (isDebitAccount) {
						return {
							...b,
							debit: b.balance > 0 ? b.balance : 0,
							credit: b.balance < 0 ? Math.abs(b.balance) : 0
						};
					} else {
						return {
							...b,
							debit: b.balance < 0 ? Math.abs(b.balance) : 0,
							credit: b.balance > 0 ? b.balance : 0
						};
					}
				})
				.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber, undefined, { numeric: true }));

			// Calculate totals
			const totalDebits = accountsWithBalances.reduce((sum, a) => sum + a.debit, 0);
			const totalCredits = accountsWithBalances.reduce((sum, a) => sum + a.credit, 0);

			return {
				asOfDate: endDate || new Date(),
				currencyCode,
				accounts: accountsWithBalances,
				totalDebits,
				totalCredits,
				balanced: Math.abs(totalDebits - totalCredits) < 0.01
			};
		}
	);

	// GET /api/reports/account-ledger/:id - Account Ledger (transaction history)
	fastify.get<{
		Params: { id: string };
		Querystring: { startDate?: string; endDate?: string };
	}>('/account-ledger/:id', async (request, reply) => {
		const accountId = parseInt(request.params.id);

		if (isNaN(accountId)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Invalid account ID'
			});
		}

		// Get account info
		const account = await db
			.select({
				id: subledgerAccounts.id,
				accountNumber: subledgerAccounts.accountNumber,
				accountName: subledgerAccounts.name,
				glAccountNumber: glAccounts.accountNumber,
				glAccountName: glAccounts.name,
				glAccountType: glAccounts.type
			})
			.from(subledgerAccounts)
			.innerJoin(glAccounts, eq(subledgerAccounts.glAccountId, glAccounts.id))
			.where(eq(subledgerAccounts.id, accountId))
			.limit(1);

		if (account.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `Account ${accountId} not found`
			});
		}

		// Build conditions for date range
		const conditions: any[] = [
			sql`${journalEntries.debitAccountId} = ${accountId} OR ${journalEntries.creditAccountId} = ${accountId}`
		];

		if (request.query.startDate) {
			const startDate = new Date(request.query.startDate);
			if (!isNaN(startDate.getTime())) {
				// Set start date to beginning of day in UTC (00:00:00.000)
				startDate.setUTCHours(0, 0, 0, 0);
				conditions.push(gte(journalEntries.entryDate, startDate));
			}
		}

		if (request.query.endDate) {
			const endDate = new Date(request.query.endDate);
			if (!isNaN(endDate.getTime())) {
				// Set end date to end of day in UTC (23:59:59.999) to include all entries on that day
				endDate.setUTCHours(23, 59, 59, 999);
				conditions.push(lte(journalEntries.entryDate, endDate));
			}
		}

		// Get all transactions for this account
		const query = db
			.select()
			.from(journalEntries)
			.where(and(...conditions))
			.orderBy(desc(journalEntries.entryDate));

		const transactions = await query;

		// Calculate running balance
		let runningBalance = 0;
		const ledgerEntries = transactions.map((entry) => {
			let debit = 0;
			let credit = 0;

			if (entry.debitAccountId === accountId) {
				debit = entry.amountInUSD;
				if (['Asset', 'Cash', 'Accounts Receivable', 'Loss'].includes(account[0].glAccountType)) {
					runningBalance += debit;
				} else {
					runningBalance -= debit;
				}
			}

			if (entry.creditAccountId === accountId) {
				credit = entry.amountInUSD;
				if (['Asset', 'Cash', 'Accounts Receivable', 'Loss'].includes(account[0].glAccountType)) {
					runningBalance -= credit;
				} else {
					runningBalance += credit;
				}
			}

			return {
				...entry,
				debit,
				credit,
				balance: runningBalance
			};
		});

		return {
			account: account[0],
			entries: ledgerEntries.reverse(), // Reverse to show oldest first
			finalBalance: runningBalance
		};
	});
}
