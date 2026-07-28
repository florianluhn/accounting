/**
 * Financial year close: transfer period net income into a dedicated
 * Retained Earnings equity account and lock the year against further postings.
 */

import db from '../db/connection.js';
import {
	closedFinancialYears,
	journalEntries,
	subledgerAccounts,
	glAccounts,
	currencies,
	appSettings
} from '../db/schema.js';
import { eq, and, gte, lte, gt, sql, desc, or } from 'drizzle-orm';
import {
	formatFinancialYearLabel,
	getFinancialYearBounds,
	toLocalDateString
} from '../../lib/financial-year.js';

/** Journal category used for year-end closing entries (excluded from P&L reports). */
export const YEAR_END_CLOSE_CATEGORY = 'Year-end close';

export class YearCloseError extends Error {
	statusCode: number;

	constructor(message: string, statusCode = 400) {
		super(message);
		this.name = 'YearCloseError';
		this.statusCode = statusCode;
	}
}

export interface ClosedYearInfo {
	id: number;
	fyYear: number;
	startMonth: number;
	netIncome: number;
	retainedEarningsAccountId: number;
	label: string;
	closedAt: Date | null;
	periodStart: string;
	periodEnd: string;
}

export interface ClosePreview {
	fyYear: number;
	startMonth: number;
	label: string;
	periodStart: string;
	periodEnd: string;
	totalRevenue: number;
	totalExpenses: number;
	netIncome: number;
	profitAccountCount: number;
	lossAccountCount: number;
	alreadyClosed: boolean;
	/** Non-zero P&L lines that will be closed. */
	lines: Array<{
		accountId: number;
		accountNumber: string;
		accountName: string;
		glAccountType: string;
		balance: number;
	}>;
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

/**
 * Day bounds matching the P&L report (UTC start/end of calendar day).
 * FY bounds are converted via local YYYY-MM-DD so they match date pickers.
 */
export function utcDayStartFromLocalDate(d: Date): Date {
	const iso = toLocalDateString(d); // YYYY-MM-DD in local calendar
	const bound = new Date(iso); // parses as UTC midnight
	bound.setUTCHours(0, 0, 0, 0);
	return bound;
}

export function utcDayEndFromLocalDate(d: Date): Date {
	const iso = toLocalDateString(d);
	const bound = new Date(iso);
	bound.setUTCHours(23, 59, 59, 999);
	return bound;
}

/**
 * Posting date for year-end close entries: noon UTC on the last calendar day of the FY.
 * Using 23:59 local shifts into the next day in UTC for many timezones (shows as 01/01
 * and pollutes the next year's P&L when reports use UTC day bounds).
 */
export function yearEndCloseEntryDate(fyEndLocal: Date): Date {
	const iso = toLocalDateString(fyEndLocal);
	const [y, m, day] = iso.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, day, 12, 0, 0, 0));
}

/** Inclusive check that `date` falls within a closed financial year range. */
export function isDateInRange(date: Date, start: Date, end: Date): boolean {
	const t = date.getTime();
	return t >= utcDayStartFromLocalDate(start).getTime() && t <= utcDayEndFromLocalDate(end).getTime();
}

export async function getFinancialYearStartMonth(): Promise<number> {
	const rows = await db
		.select()
		.from(appSettings)
		.where(eq(appSettings.key, 'financialYearStartMonth'))
		.limit(1);
	const n = parseInt(rows[0]?.value ?? '1', 10);
	if (!Number.isFinite(n) || n < 1 || n > 12) return 1;
	return n;
}

export async function listClosedYears(): Promise<ClosedYearInfo[]> {
	const rows = await db
		.select()
		.from(closedFinancialYears)
		.orderBy(desc(closedFinancialYears.fyYear));
	return rows.map((r) => {
		const { start, end } = getFinancialYearBounds(r.fyYear, r.startMonth);
		return {
			id: r.id,
			fyYear: r.fyYear,
			startMonth: r.startMonth,
			netIncome: r.netIncome,
			retainedEarningsAccountId: r.retainedEarningsAccountId,
			label: r.label,
			closedAt: r.closedAt,
			periodStart: toLocalDateString(start),
			periodEnd: toLocalDateString(end)
		};
	});
}

/**
 * If the given entry date falls in a closed financial year, returns lock info.
 * Otherwise returns null.
 */
export async function findClosedYearForDate(
	entryDate: Date
): Promise<ClosedYearInfo | null> {
	const closed = await listClosedYears();
	for (const cy of closed) {
		const { start, end } = getFinancialYearBounds(cy.fyYear, cy.startMonth);
		if (isDateInRange(entryDate, start, end)) {
			return cy;
		}
	}
	return null;
}

/**
 * Throws YearCloseError if postings/edits are not allowed for this date.
 */
export async function assertDateNotInClosedYear(entryDate: Date): Promise<void> {
	const closed = await findClosedYearForDate(entryDate);
	if (closed) {
		throw new YearCloseError(
			`Financial year ${formatFinancialYearLabel(closed.fyYear, closed.startMonth)} is closed. ` +
				`No journal postings, edits, or deletions are allowed between ${closed.periodStart} and ${closed.periodEnd}.`,
			403
		);
	}
}

async function periodBalances(
	startDate: Date,
	endDate: Date
): Promise<
	Array<{
		accountId: number;
		accountNumber: string;
		accountName: string;
		glAccountType: string;
		balance: number;
	}>
> {
	// Same UTC day bounds as GET /api/reports/profit-loss
	const start = utcDayStartFromLocalDate(startDate);
	const end = utcDayEndFromLocalDate(endDate);

	const accounts = await db
		.select({
			id: subledgerAccounts.id,
			accountNumber: subledgerAccounts.accountNumber,
			accountName: subledgerAccounts.name,
			glAccountType: glAccounts.type
		})
		.from(subledgerAccounts)
		.innerJoin(glAccounts, eq(subledgerAccounts.glAccountId, glAccounts.id))
		.where(
			and(
				eq(subledgerAccounts.isActive, true),
				sql`${glAccounts.type} IN ('Profit', 'Loss')`
			)
		);

	const entries = await db
		.select()
		.from(journalEntries)
		.where(and(gte(journalEntries.entryDate, start), lte(journalEntries.entryDate, end)));

	// Ignore year-end close postings when computing operating P&L / what to close
	const operatingEntries = entries.filter((e) => e.category !== YEAR_END_CLOSE_CATEGORY);

	return accounts.map((account) => {
		let balance = 0;
		for (const entry of operatingEntries) {
			const amount = entry.amountInUSD;
			if (entry.debitAccountId === account.id) {
				// Debit increases Loss; decreases Profit
				if (account.glAccountType === 'Loss') balance += amount;
				else balance -= amount;
			}
			if (entry.creditAccountId === account.id) {
				// Credit decreases Loss; increases Profit
				if (account.glAccountType === 'Loss') balance -= amount;
				else balance += amount;
			}
		}
		return {
			accountId: account.id,
			accountNumber: account.accountNumber,
			accountName: account.accountName,
			glAccountType: account.glAccountType,
			balance: round2(balance)
		};
	});
}

/** Net effect of a closing entry on the retained-earnings equity account (credit − debit). */
function reEffectOnEntry(
	entry: { debitAccountId: number; creditAccountId: number; amountInUSD: number },
	reAccountId: number
): number {
	let effect = 0;
	if (entry.creditAccountId === reAccountId) effect += entry.amountInUSD;
	if (entry.debitAccountId === reAccountId) effect -= entry.amountInUSD;
	return round2(effect);
}

export async function previewYearClose(fyYear: number): Promise<ClosePreview> {
	if (!Number.isInteger(fyYear) || fyYear < 1900 || fyYear > 2100) {
		throw new YearCloseError('Invalid financial year');
	}

	const startMonth = await getFinancialYearStartMonth();
	const { start, end } = getFinancialYearBounds(fyYear, startMonth);
	const label = `Retained Earnings ${formatFinancialYearLabel(fyYear, startMonth).replace(/^FY\s+/, '')}`;

	const existing = await db
		.select()
		.from(closedFinancialYears)
		.where(eq(closedFinancialYears.fyYear, fyYear))
		.limit(1);

	const balances = await periodBalances(start, end);
	const lines = balances.filter((b) => Math.abs(b.balance) >= 0.005);
	const profitLines = lines.filter((b) => b.glAccountType === 'Profit');
	const lossLines = lines.filter((b) => b.glAccountType === 'Loss');
	const totalRevenue = round2(profitLines.reduce((s, b) => s + b.balance, 0));
	const totalExpenses = round2(lossLines.reduce((s, b) => s + b.balance, 0));
	// Include zero-balance accounts that still had activity? No — only non-zero.
	// But revenue/expenses totals should include all Profit/Loss balances in period:
	const allProfit = balances.filter((b) => b.glAccountType === 'Profit');
	const allLoss = balances.filter((b) => b.glAccountType === 'Loss');
	const fullRevenue = round2(allProfit.reduce((s, b) => s + b.balance, 0));
	const fullExpenses = round2(allLoss.reduce((s, b) => s + b.balance, 0));

	return {
		fyYear,
		startMonth,
		label,
		periodStart: toLocalDateString(start),
		periodEnd: toLocalDateString(end),
		totalRevenue: fullRevenue,
		totalExpenses: fullExpenses,
		netIncome: round2(fullRevenue - fullExpenses),
		profitAccountCount: allProfit.filter((b) => Math.abs(b.balance) >= 0.005).length,
		lossAccountCount: allLoss.filter((b) => Math.abs(b.balance) >= 0.005).length,
		alreadyClosed: existing.length > 0,
		lines: lines.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber, undefined, { numeric: true }))
	};
}

async function ensureEquityGlAccount(): Promise<{ id: number; currencyCode: string }> {
	const equity = await db
		.select()
		.from(glAccounts)
		.where(and(eq(glAccounts.type, 'Equity'), eq(glAccounts.isActive, true)))
		.limit(1);

	if (equity.length > 0) {
		return { id: equity[0].id, currencyCode: await getDefaultCurrencyCode() };
	}

	// Create a parent Equity GL if none exists — pick a free account number
	let accountNumber = '3000';
	for (let n = 3000; n < 4000; n++) {
		const candidate = String(n);
		const exists = await db
			.select({ id: glAccounts.id })
			.from(glAccounts)
			.where(eq(glAccounts.accountNumber, candidate))
			.limit(1);
		if (exists.length === 0) {
			accountNumber = candidate;
			break;
		}
	}

	const created = await db
		.insert(glAccounts)
		.values({
			accountNumber,
			name: 'Equity',
			type: 'Equity',
			description: 'Owner equity and retained earnings',
			isActive: true
		})
		.returning();

	return { id: created[0].id, currencyCode: await getDefaultCurrencyCode() };
}

async function getDefaultCurrencyCode(): Promise<string> {
	const def = await db.select().from(currencies).where(eq(currencies.isDefault, true)).limit(1);
	if (def.length > 0) return def[0].code;
	const any = await db.select().from(currencies).limit(1);
	if (any.length === 0) {
		throw new YearCloseError('No currency configured. Add a currency before closing a year.', 400);
	}
	return any[0].code;
}

async function nextRetainedEarningsAccountNumber(fyYear: number): Promise<string> {
	const preferred = `RE${fyYear}`;
	const clash = await db
		.select({ id: subledgerAccounts.id })
		.from(subledgerAccounts)
		.where(eq(subledgerAccounts.accountNumber, preferred))
		.limit(1);
	if (clash.length === 0) return preferred;

	// Fallback: RE{year}-{n}
	for (let i = 2; i < 100; i++) {
		const candidate = `RE${fyYear}-${i}`;
		const exists = await db
			.select({ id: subledgerAccounts.id })
			.from(subledgerAccounts)
			.where(eq(subledgerAccounts.accountNumber, candidate))
			.limit(1);
		if (exists.length === 0) return candidate;
	}
	throw new YearCloseError('Could not allocate a unique account number for retained earnings');
}

/**
 * Close a financial year: zero P&L accounts for the period into a new
 * Retained Earnings equity subledger, then lock the year.
 */
export async function closeFinancialYear(fyYear: number): Promise<ClosedYearInfo> {
	const preview = await previewYearClose(fyYear);

	if (preview.alreadyClosed) {
		throw new YearCloseError(
			`${formatFinancialYearLabel(fyYear, preview.startMonth)} is already closed`,
			409
		);
	}

	const { start, end } = getFinancialYearBounds(fyYear, preview.startMonth);
	// Last day of closed FY at noon UTC — must NOT land on day 1 of the next year
	const closeDate = yearEndCloseEntryDate(end);

	const { id: equityGlId } = await ensureEquityGlAccount();
	const currencyCode = await getDefaultCurrencyCode();
	const currency = await db
		.select()
		.from(currencies)
		.where(eq(currencies.code, currencyCode))
		.limit(1);
	const exchangeRate = currency[0]?.exchangeRate ?? 1;

	const accountNumber = await nextRetainedEarningsAccountNumber(fyYear);
	const reAccount = await db
		.insert(subledgerAccounts)
		.values({
			glAccountId: equityGlId,
			accountNumber,
			name: preview.label,
			currencyCode,
			description: `Year-end close for ${formatFinancialYearLabel(fyYear, preview.startMonth)}`,
			isActive: true
		})
		.returning();

	const reAccountId = reAccount[0].id;
	const lines = preview.lines;

	// Close each non-zero Profit/Loss account against retained earnings
	for (const line of lines) {
		const amount = Math.abs(line.balance);
		if (amount < 0.005) continue;

		const amountInUSD = round2(amount); // balances are already USD
		// Entry amount in account currency: convert from USD if default currency ≠ USD
		const entryAmount = round2(amountInUSD / (exchangeRate || 1));

		let debitAccountId: number;
		let creditAccountId: number;

		if (line.glAccountType === 'Profit') {
			// Positive Profit balance: Debit Profit, Credit RE
			// Negative Profit: reverse
			if (line.balance >= 0) {
				debitAccountId = line.accountId;
				creditAccountId = reAccountId;
			} else {
				debitAccountId = reAccountId;
				creditAccountId = line.accountId;
			}
		} else {
			// Loss: positive balance means expense — Debit RE, Credit Loss
			if (line.balance >= 0) {
				debitAccountId = reAccountId;
				creditAccountId = line.accountId;
			} else {
				debitAccountId = line.accountId;
				creditAccountId = reAccountId;
			}
		}

		await db.insert(journalEntries).values({
			entryDate: closeDate,
			amount: entryAmount > 0 ? entryAmount : amountInUSD,
			currencyCode,
			amountInUSD: amountInUSD,
			debitAccountId,
			creditAccountId,
			description: `Year-end close ${formatFinancialYearLabel(fyYear, preview.startMonth)} — ${line.accountNumber} ${line.accountName}`,
			category: YEAR_END_CLOSE_CATEGORY,
			comment: `Close ${line.glAccountType} account to ${preview.label}`
		});
	}

	// If net income is zero and no lines, still record the closed year with a zero RE account
	// (no journal entries needed).

	const closed = await db
		.insert(closedFinancialYears)
		.values({
			fyYear,
			startMonth: preview.startMonth,
			netIncome: preview.netIncome,
			retainedEarningsAccountId: reAccountId,
			label: preview.label
		})
		.returning();

	const row = closed[0];
	return {
		id: row.id,
		fyYear: row.fyYear,
		startMonth: row.startMonth,
		netIncome: row.netIncome,
		retainedEarningsAccountId: row.retainedEarningsAccountId,
		label: row.label,
		closedAt: row.closedAt,
		periodStart: toLocalDateString(start),
		periodEnd: toLocalDateString(end)
	};
}

/** True if any financial year has been closed (used to warn on FY start month change). */
export async function hasAnyClosedYear(): Promise<boolean> {
	const rows = await db.select({ id: closedFinancialYears.id }).from(closedFinancialYears).limit(1);
	return rows.length > 0;
}

export interface YearCloseEntryDetail {
	id: number;
	entryDate: Date | string;
	amountInUSD: number;
	description: string;
	debitAccountId: number;
	creditAccountId: number;
	/** Effect on retained earnings equity (credit increases). */
	reEffect: number;
}

export interface OpenYearPreview {
	fyYear: number;
	startMonth: number;
	label: string;
	periodStart: string;
	periodEnd: string;
	/** Net income stored when the year was closed. */
	storedNetIncome: number;
	/** Sum of closing journal effects on the RE equity account. */
	postedToRetainedEarnings: number;
	/** Current recalculated operating P&L for the same period (excl. year-end close). */
	recalculatedNetIncome: number;
	/** storedNetIncome − recalculatedNetIncome */
	storedVsRecalcDiff: number;
	/** postedToRetainedEarnings − recalculatedNetIncome */
	postedVsRecalcDiff: number;
	closingEntryCount: number;
	closingEntries: YearCloseEntryDetail[];
	/** Must reverse later years before this one. */
	blockedByLaterYears: number[];
	canOpen: boolean;
	retainedEarningsAccountId: number;
	retainedEarningsAccountNumber: string | null;
	retainedEarningsAccountName: string | null;
}

export interface OpenYearResult {
	fyYear: number;
	label: string;
	deletedJournalEntries: number;
	deletedEntryIds: number[];
	deletedRetainedEarningsAccount: boolean;
	retainedEarningsAccountId: number;
	periodStart: string;
	periodEnd: string;
	storedNetIncome: number;
	postedToRetainedEarnings: number;
	recalculatedNetIncome: number;
}

async function getClosingEntriesForYear(cy: {
	retainedEarningsAccountId: number;
	fyYear: number;
	startMonth: number;
	label: string;
}): Promise<YearCloseEntryDetail[]> {
	// Prefer entries tagged as year-end close that touch the RE account.
	// Also catch same-period entries with matching description prefix if category was edited.
	const entries = await db
		.select()
		.from(journalEntries)
		.where(
			and(
				eq(journalEntries.category, YEAR_END_CLOSE_CATEGORY),
				or(
					eq(journalEntries.debitAccountId, cy.retainedEarningsAccountId),
					eq(journalEntries.creditAccountId, cy.retainedEarningsAccountId)
				)
			)
		);

	return entries
		.map((e) => ({
			id: e.id,
			entryDate: e.entryDate,
			amountInUSD: e.amountInUSD,
			description: e.description,
			debitAccountId: e.debitAccountId,
			creditAccountId: e.creditAccountId,
			reEffect: reEffectOnEntry(e, cy.retainedEarningsAccountId)
		}))
		.sort((a, b) => a.id - b.id);
}

/**
 * Preview reverse of a year-end close: what would be deleted and how numbers compare.
 */
export async function previewOpenYear(fyYear: number): Promise<OpenYearPreview> {
	if (!Number.isInteger(fyYear) || fyYear < 1900 || fyYear > 2100) {
		throw new YearCloseError('Invalid financial year');
	}

	const rows = await db
		.select()
		.from(closedFinancialYears)
		.where(eq(closedFinancialYears.fyYear, fyYear))
		.limit(1);

	if (rows.length === 0) {
		throw new YearCloseError(
			`${formatFinancialYearLabel(fyYear, await getFinancialYearStartMonth())} is not closed`,
			404
		);
	}

	const cy = rows[0];
	const { start, end } = getFinancialYearBounds(cy.fyYear, cy.startMonth);
	const closingEntries = await getClosingEntriesForYear(cy);
	const postedToRetainedEarnings = round2(
		closingEntries.reduce((s, e) => s + e.reEffect, 0)
	);

	const balances = await periodBalances(start, end);
	const fullRevenue = round2(
		balances.filter((b) => b.glAccountType === 'Profit').reduce((s, b) => s + b.balance, 0)
	);
	const fullExpenses = round2(
		balances.filter((b) => b.glAccountType === 'Loss').reduce((s, b) => s + b.balance, 0)
	);
	const recalculatedNetIncome = round2(fullRevenue - fullExpenses);

	const later = await db
		.select({ fyYear: closedFinancialYears.fyYear })
		.from(closedFinancialYears)
		.where(gt(closedFinancialYears.fyYear, fyYear));
	const blockedByLaterYears = later.map((r) => r.fyYear).sort((a, b) => a - b);

	const [reAcc] = await db
		.select({
			accountNumber: subledgerAccounts.accountNumber,
			name: subledgerAccounts.name
		})
		.from(subledgerAccounts)
		.where(eq(subledgerAccounts.id, cy.retainedEarningsAccountId))
		.limit(1);

	return {
		fyYear: cy.fyYear,
		startMonth: cy.startMonth,
		label: cy.label,
		periodStart: toLocalDateString(start),
		periodEnd: toLocalDateString(end),
		storedNetIncome: cy.netIncome,
		postedToRetainedEarnings,
		recalculatedNetIncome,
		storedVsRecalcDiff: round2(cy.netIncome - recalculatedNetIncome),
		postedVsRecalcDiff: round2(postedToRetainedEarnings - recalculatedNetIncome),
		closingEntryCount: closingEntries.length,
		closingEntries,
		blockedByLaterYears,
		canOpen: blockedByLaterYears.length === 0,
		retainedEarningsAccountId: cy.retainedEarningsAccountId,
		retainedEarningsAccountNumber: reAcc?.accountNumber ?? null,
		retainedEarningsAccountName: reAcc?.name ?? null
	};
}

/**
 * Fully reverse a year-end close:
 * - delete all year-end close journal entries for that year
 * - remove the closed-year lock
 * - delete the Retained Earnings equity subledger if unused
 *
 * Later closed years must be opened first (newest → oldest).
 */
export async function openFinancialYear(fyYear: number): Promise<OpenYearResult> {
	const preview = await previewOpenYear(fyYear);

	if (!preview.canOpen) {
		throw new YearCloseError(
			`Open later closed year(s) first: ${preview.blockedByLaterYears.join(', ')}`,
			409
		);
	}

	const entryIds = preview.closingEntries.map((e) => e.id);

	// Delete closing journal entries (year is still "closed" so normal journal API would block —
	// we delete here directly as the reopen operation).
	for (const id of entryIds) {
		await db.delete(journalEntries).where(eq(journalEntries.id, id));
	}

	// Remove lock
	await db.delete(closedFinancialYears).where(eq(closedFinancialYears.fyYear, fyYear));

	// Delete RE subledger only if no remaining journal lines reference it
	let deletedReAccount = false;
	const remaining = await db
		.select({ id: journalEntries.id })
		.from(journalEntries)
		.where(
			or(
				eq(journalEntries.debitAccountId, preview.retainedEarningsAccountId),
				eq(journalEntries.creditAccountId, preview.retainedEarningsAccountId)
			)
		)
		.limit(1);

	if (remaining.length === 0) {
		await db
			.delete(subledgerAccounts)
			.where(eq(subledgerAccounts.id, preview.retainedEarningsAccountId));
		deletedReAccount = true;
	} else {
		// Deactivate orphaned RE account that still has unexpected links
		await db
			.update(subledgerAccounts)
			.set({ isActive: false, name: `${preview.label} (reopened)` })
			.where(eq(subledgerAccounts.id, preview.retainedEarningsAccountId));
	}

	return {
		fyYear: preview.fyYear,
		label: preview.label,
		deletedJournalEntries: entryIds.length,
		deletedEntryIds: entryIds,
		deletedRetainedEarningsAccount: deletedReAccount,
		retainedEarningsAccountId: preview.retainedEarningsAccountId,
		periodStart: preview.periodStart,
		periodEnd: preview.periodEnd,
		storedNetIncome: preview.storedNetIncome,
		postedToRetainedEarnings: preview.postedToRetainedEarnings,
		recalculatedNetIncome: preview.recalculatedNetIncome
	};
}

/**
 * Move existing year-end close journal entries onto noon UTC of the closed year's
 * last day (repairs entries that shifted to 01/01 of the next year via timezone).
 * Returns number of entries updated.
 */
export async function repairYearEndCloseEntryDates(): Promise<number> {
	const rows = await db.select().from(closedFinancialYears);
	let fixed = 0;

	for (const cy of rows) {
		const { end } = getFinancialYearBounds(cy.fyYear, cy.startMonth);
		const correctDate = yearEndCloseEntryDate(end);
		const correctMs = correctDate.getTime();

		const entries = await db
			.select()
			.from(journalEntries)
			.where(
				and(
					eq(journalEntries.category, YEAR_END_CLOSE_CATEGORY),
					or(
						eq(journalEntries.debitAccountId, cy.retainedEarningsAccountId),
						eq(journalEntries.creditAccountId, cy.retainedEarningsAccountId)
					)
				)
			);

		for (const entry of entries) {
			const current = entry.entryDate instanceof Date ? entry.entryDate : new Date(entry.entryDate);
			if (current.getTime() !== correctMs) {
				await db
					.update(journalEntries)
					.set({ entryDate: correctDate })
					.where(eq(journalEntries.id, entry.id));
				fixed++;
			}
		}
	}

	return fixed;
}
