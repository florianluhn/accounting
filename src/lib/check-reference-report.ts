/**
 * Check / reference balances.
 *
 * The earliest journal entry for a reference is the check (what it was for).
 * Later entries that reuse the same reference are payments against it.
 * Balance = issued amount − payments. Zero means the check has been paid.
 *
 * Entries dated on or before the report end date are included by the caller.
 * A reference still appears when it was issued before the period, as long as
 * it is unpaid as of the end date or it had activity inside the period.
 */

export type CheckReferenceStatus = 'open' | 'paid' | 'overpaid';
export type CheckReferenceEntryRole = 'issued' | 'payment';

export interface CheckReferenceEntry {
	id: number;
	entryDate: Date | string;
	description: string;
	amount: number;
	debitAccountName: string;
	creditAccountName: string;
	role: CheckReferenceEntryRole;
}

export interface CheckReferenceBalance {
	reference: string;
	date: Date | string;
	description: string;
	/** Amount of the earliest entry (the check). */
	amount: number;
	/** Sum of later entries with the same reference. */
	applied: number;
	/** Remaining amount. Zero means paid. */
	balance: number;
	status: CheckReferenceStatus;
	entryCount: number;
	entries: CheckReferenceEntry[];
}

export interface CheckReferenceReport {
	startDate: Date | string | null;
	endDate: Date | string;
	currencyCode: string;
	references: CheckReferenceBalance[];
	openCount: number;
	paidCount: number;
	overpaidCount: number;
	/** Sum of balances that are not paid (open plus overpaid). */
	totalOpenBalance: number;
}

export interface CheckReferenceSourceEntry {
	id: number;
	entryDate: Date | string | number;
	/** Amount already converted into the reporting currency. */
	amount: number;
	description: string;
	reference: string;
	debitAccountName: string;
	creditAccountName: string;
}

export interface CheckReferenceRollup {
	references: CheckReferenceBalance[];
	openCount: number;
	paidCount: number;
	overpaidCount: number;
	totalOpenBalance: number;
}

function roundMoney(amount: number): number {
	return Math.round(amount * 100) / 100;
}

function entryTime(value: Date | string | number): number {
	const time = new Date(value).getTime();
	return Number.isFinite(time) ? time : 0;
}

export function buildCheckReferenceReport(
	entries: CheckReferenceSourceEntry[],
	periodStart?: Date
): CheckReferenceRollup {
	const groups = new Map<string, CheckReferenceSourceEntry[]>();

	for (const entry of entries) {
		const reference = entry.reference.trim();
		if (!reference) continue;
		const group = groups.get(reference);
		if (group) group.push(entry);
		else groups.set(reference, [entry]);
	}

	const periodStartMs = periodStart ? entryTime(periodStart) : null;
	const rows: CheckReferenceBalance[] = [];

	for (const [reference, group] of groups) {
		group.sort((a, b) => entryTime(a.entryDate) - entryTime(b.entryDate) || a.id - b.id);

		const issued = group[0];
		const amount = roundMoney(issued.amount);
		const applied = roundMoney(
			group.slice(1).reduce((sum, entry) => sum + roundMoney(entry.amount), 0)
		);
		let balance = roundMoney(amount - applied);
		let status: CheckReferenceStatus;
		if (Math.abs(balance) < 0.005) {
			balance = 0;
			status = 'paid';
		} else if (balance < 0) {
			status = 'overpaid';
		} else {
			status = 'open';
		}

		const activityInPeriod =
			periodStartMs == null || group.some((entry) => entryTime(entry.entryDate) >= periodStartMs);
		// Drop checks that were already paid before this period. Keep anything
		// still open, and anything that moved during the period.
		if (!activityInPeriod && status === 'paid') continue;

		rows.push({
			reference,
			date: issued.entryDate as Date | string,
			description: issued.description,
			amount,
			applied,
			balance,
			status,
			entryCount: group.length,
			entries: group.map((entry, index) => ({
				id: entry.id,
				entryDate: entry.entryDate as Date | string,
				description: entry.description,
				amount: roundMoney(entry.amount),
				debitAccountName: entry.debitAccountName,
				creditAccountName: entry.creditAccountName,
				role: index === 0 ? 'issued' : 'payment'
			}))
		});
	}

	rows.sort((a, b) => {
		const aUnsettled = a.status === 'paid' ? 0 : 1;
		const bUnsettled = b.status === 'paid' ? 0 : 1;
		if (aUnsettled !== bUnsettled) return bUnsettled - aUnsettled;
		const dateDiff = entryTime(b.date) - entryTime(a.date);
		if (dateDiff !== 0) return dateDiff;
		return a.reference.localeCompare(b.reference, undefined, { numeric: true });
	});

	const openRows = rows.filter((row) => row.status === 'open');
	const paidRows = rows.filter((row) => row.status === 'paid');
	const overpaidRows = rows.filter((row) => row.status === 'overpaid');

	return {
		references: rows,
		openCount: openRows.length,
		paidCount: paidRows.length,
		overpaidCount: overpaidRows.length,
		totalOpenBalance: roundMoney(
			rows.filter((row) => row.status !== 'paid').reduce((sum, row) => sum + row.balance, 0)
		)
	};
}
