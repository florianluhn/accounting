/** Financial year helpers. Start month is 1–12 (January = 1). */

export const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
] as const;

/** Ending month of a financial year that starts in `startMonth` (1–12). */
export function financialYearEndMonth(startMonth: number): number {
	const m = clampMonth(startMonth);
	return m === 1 ? 12 : m - 1;
}

/** FY start year for a given calendar date (local). */
export function getFinancialYear(date: Date, startMonth: number): number {
	const m = clampMonth(startMonth);
	const year = date.getFullYear();
	const month = date.getMonth() + 1;
	return month >= m ? year : year - 1;
}

/** FY start year for a given calendar date using UTC components. */
export function getFinancialYearUTC(date: Date, startMonth: number): number {
	const m = clampMonth(startMonth);
	const year = date.getUTCFullYear();
	const month = date.getUTCMonth() + 1;
	return month >= m ? year : year - 1;
}

/**
 * Inclusive local date bounds for a financial year.
 * FY `fyYear` with start month March → Mar 1 fyYear … Feb 28/29 fyYear+1.
 */
export function getFinancialYearBounds(
	fyYear: number,
	startMonth: number
): { start: Date; end: Date } {
	const m = clampMonth(startMonth);
	const start = new Date(fyYear, m - 1, 1);
	// Last day of the month before start month in the following calendar year
	// (or Dec 31 of fyYear when start is January).
	const end =
		m === 1
			? new Date(fyYear, 11, 31)
			: new Date(fyYear + 1, m - 1, 0); // day 0 of start month next year
	return { start, end };
}

/** YYYY-MM-DD for local date (no timezone shift). */
export function toLocalDateString(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/**
 * First and last calendar days of `year`/`month` as UTC-midnight Dates.
 * Same construction as the reports date picker (`new Date('YYYY-MM-DD')`), so
 * backend UTC day-bound expansion includes the full month and matches P&L.
 * `month` is 1–12.
 */
export function getUtcCalendarMonthBounds(year: number, month: number): { start: Date; end: Date } {
	const m = clampMonth(month);
	const mm = String(m).padStart(2, '0');
	const start = new Date(`${year}-${mm}-01`);
	const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
	const end = new Date(`${year}-${mm}-${String(lastDay).padStart(2, '0')}`);
	return { start, end };
}

export type FinancialQuarter = 1 | 2 | 3 | 4;

/** Quarter (1–4) of the financial year that contains `date`. */
export function getFinancialQuarter(date: Date, startMonth: number): FinancialQuarter {
	const m = clampMonth(startMonth);
	const fyYear = getFinancialYear(date, m);
	const offset = (date.getFullYear() - fyYear) * 12 + (date.getMonth() + 1 - m);
	const clamped = Math.min(11, Math.max(0, offset));
	return (Math.floor(clamped / 3) + 1) as FinancialQuarter;
}

/**
 * Inclusive UTC day bounds for one financial-year quarter.
 * Q1 starts in `startMonth` of `fyYear`. Each quarter is three calendar months.
 */
export function getFinancialQuarterUTCBounds(
	fyYear: number,
	startMonth: number,
	quarter: number
): {
	start: Date;
	end: Date;
	months: Array<{ year: number; month: number; label: string }>;
} {
	const q = Math.min(4, Math.max(1, Math.round(Number(quarter)))) as FinancialQuarter;
	const m = clampMonth(startMonth);
	const months: Array<{ year: number; month: number; label: string }> = [];
	for (let i = 0; i < 3; i++) {
		const index = m - 1 + (q - 1) * 3 + i;
		const year = fyYear + Math.floor(index / 12);
		const month = (index % 12) + 1;
		const bounds = getUtcCalendarMonthBounds(year, month);
		months.push({
			year,
			month,
			label: bounds.start.toLocaleDateString('en-US', {
				month: 'short',
				year: 'numeric',
				timeZone: 'UTC'
			})
		});
	}
	const start = getUtcCalendarMonthBounds(months[0].year, months[0].month).start;
	const end = getUtcCalendarMonthBounds(months[2].year, months[2].month).end;
	return { start, end, months };
}

/** "Q1 FY 2026 · Jan–Mar 2026" */
export function formatFinancialQuarterLabel(
	fyYear: number,
	startMonth: number,
	quarter: number
): string {
	const { months } = getFinancialQuarterUTCBounds(fyYear, startMonth, quarter);
	const q = Math.min(4, Math.max(1, Math.round(Number(quarter))));
	const startName = MONTH_NAMES[months[0].month - 1].slice(0, 3);
	const endName = MONTH_NAMES[months[2].month - 1].slice(0, 3);
	const fy = formatFinancialYearLabel(fyYear, startMonth);
	const span =
		months[0].year === months[2].year
			? `${startName}–${endName} ${months[2].year}`
			: `${startName} ${months[0].year}–${endName} ${months[2].year}`;
	return `Q${q} ${fy} · ${span}`;
}

/** Human label, e.g. "FY 2025" or "FY 2025–2026" when year spans two calendars. */
export function formatFinancialYearLabel(fyYear: number, startMonth: number): string {
	const m = clampMonth(startMonth);
	if (m === 1) return `FY ${fyYear}`;
	return `FY ${fyYear}–${fyYear + 1}`;
}

/** Short range label, e.g. "Mar 2025 – Feb 2026". */
export function formatFinancialYearRange(fyYear: number, startMonth: number): string {
	const m = clampMonth(startMonth);
	const endM = financialYearEndMonth(m);
	if (m === 1) {
		return `${MONTH_NAMES[0]} ${fyYear} – ${MONTH_NAMES[11]} ${fyYear}`;
	}
	return `${MONTH_NAMES[m - 1]} ${fyYear} – ${MONTH_NAMES[endM - 1]} ${fyYear + 1}`;
}

export function clampMonth(month: number): number {
	const n = Math.round(Number(month));
	if (!Number.isFinite(n) || n < 1 || n > 12) return 1;
	return n;
}
