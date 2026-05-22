export interface DepreciationScheduleEntry {
	month: string; // 'YYYY-MM' format, e.g. '2025-07'
	monthlyAmount: number; // rounded to 2 decimal places
	accumulatedAmount: number;
	remainingValue: number;
}

type Method = 'SL' | '200DB' | '150DB';
type Convention = 'half_year' | 'mid_month' | 'mid_quarter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

/**
 * Parse 'YYYY-MM-DD' → { year, month (1-indexed) }
 */
function parseISODate(iso: string): { year: number; month: number } {
	const [y, m] = iso.split('-').map(Number);
	return { year: y, month: m };
}

/**
 * Parse 'YYYY-MM' → { year, month (1-indexed) }
 */
function parseYearMonth(ym: string): { year: number; month: number } {
	const [y, m] = ym.split('-').map(Number);
	return { year: y, month: m };
}

function formatYearMonth(year: number, month: number): string {
	return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Add `n` months to a year/month pair.
 */
function addMonths(year: number, month: number, n: number): { year: number; month: number } {
	const total = (year * 12 + (month - 1)) + n;
	return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

/**
 * Difference in months between two year/month pairs (b - a).
 */
function diffMonths(
	aYear: number,
	aMonth: number,
	bYear: number,
	bMonth: number
): number {
	return (bYear - aYear) * 12 + (bMonth - aMonth);
}

/**
 * Generate an inclusive list of 'YYYY-MM' strings from start to end.
 */
function monthRange(
	startYear: number,
	startMonth: number,
	endYear: number,
	endMonth: number
): string[] {
	const result: string[] = [];
	let y = startYear;
	let m = startMonth;
	while (y < endYear || (y === endYear && m <= endMonth)) {
		result.push(formatYearMonth(y, m));
		const next = addMonths(y, m, 1);
		y = next.year;
		m = next.month;
	}
	return result;
}

// ---------------------------------------------------------------------------
// Convention helpers — compute first-year factor
// ---------------------------------------------------------------------------

/**
 * Returns the fraction of the first year's annual depreciation that applies,
 * and the number of months in the first (partial) year for spreading.
 */
function firstYearConvention(
	convention: Convention,
	placedInServiceMonth: number // 1-indexed
): { factor: number; monthsInFirstYear: number } {
	switch (convention) {
		case 'half_year':
			// 50% of annual depreciation, spread over remaining months of the year
			// Under half-year convention the asset is treated as placed mid-year
			return { factor: 0.5, monthsInFirstYear: 12 - placedInServiceMonth + 1 };

		case 'mid_month': {
			// placedInServiceMonth is 1-indexed (Jan=1)
			const factor = (12 - placedInServiceMonth + 0.5) / 12;
			return { factor, monthsInFirstYear: 12 - placedInServiceMonth + 1 };
		}

		case 'mid_quarter': {
			// Quarter of placement: Q1(Jan-Mar), Q2(Apr-Jun), Q3(Jul-Sep), Q4(Oct-Dec)
			const quarter = Math.ceil(placedInServiceMonth / 3);
			const factorMap: Record<number, number> = {
				1: 0.875,
				2: 0.625,
				3: 0.375,
				4: 0.125,
			};
			const factor = factorMap[quarter];
			return { factor, monthsInFirstYear: 12 - placedInServiceMonth + 1 };
		}
	}
}

// ---------------------------------------------------------------------------
// Core: compute annual depreciation by year index
// ---------------------------------------------------------------------------

/**
 * Compute annual depreciation amounts for each "depreciation year" (based on
 * activation-date anniversaries). Returns an array where index 0 = first year.
 *
 * For DB methods we compute on a yearly basis, switching to SL when
 * the SL deduction on remaining book value / remaining life ≥ DB deduction.
 */
function computeAnnualDepreciations(
	method: Method,
	cost: number,
	salvageValue: number,
	usefulLifeYears: number,
	firstYearFactor: number
): number[] {
	const depreciableBase = cost - salvageValue;
	if (depreciableBase <= 0 || usefulLifeYears <= 0) return [];

	if (method === 'SL') {
		const annual = depreciableBase / usefulLifeYears;
		return Array(usefulLifeYears).fill(annual);
	}

	// DB methods
	const dbFactor = method === '200DB' ? 2 : 1.5;
	const rate = dbFactor / usefulLifeYears;
	const annuals: number[] = [];
	let bookValue = cost;

	// Year 1 (tax year 1)
	let depr = bookValue * rate * firstYearFactor;
	let actual = Math.min(depr, bookValue - salvageValue);
	annuals.push(actual);
	bookValue -= actual;

	// Year 2 to usefulLifeYears
	for (let year = 1; year < usefulLifeYears; year++) {
		const remainingLife = usefulLifeYears - year + (1 - firstYearFactor);
		const dbDepr = bookValue * rate;
		const slDepr = (bookValue - salvageValue) / remainingLife;

		if (slDepr >= dbDepr) {
			actual = Math.min(slDepr, bookValue - salvageValue);
			annuals.push(actual);
			bookValue -= actual;
		} else {
			actual = Math.min(dbDepr, bookValue - salvageValue);
			annuals.push(actual);
			bookValue -= actual;
		}
	}

	// Final partial year
	if (bookValue - salvageValue > 0.001) {
		annuals.push(bookValue - salvageValue);
	}

	return annuals;
}

// ---------------------------------------------------------------------------
// Schedule generation
// ---------------------------------------------------------------------------

/**
 * Generate the full monthly depreciation schedule from activation date
 * through end of useful life.
 */
export function generateSchedule(
	method: Method,
	convention: Convention,
	cost: number,
	salvageValue: number,
	usefulLifeMonths: number,
	activationDate: string // ISO date 'YYYY-MM-DD'
): DepreciationScheduleEntry[] {
	const depreciableBase = cost - salvageValue;

	// Edge cases
	if (depreciableBase <= 0 || usefulLifeMonths <= 0 || cost <= 0) return [];

	const { year: startYear, month: startMonth } = parseISODate(activationDate);

	if (method === 'SL') {
		const monthlyAmount = depreciableBase / usefulLifeMonths;
		const entries: DepreciationScheduleEntry[] = [];
		let accumulated = 0;
		let monthOffset = 0;
		
		let firstMonthFactor = 1.0;
		if (convention === 'mid_month') firstMonthFactor = 0.5;
		// For half-year SL, it's typically just start in mid-year or take 0.5 in month 1.
		// We'll keep it simple: if half_year, we can use 0.5 for the first active month.
		else if (convention === 'half_year') firstMonthFactor = 0.5;
		
		let totalMonthsDepreciated = 0;
		
		while (accumulated < depreciableBase && totalMonthsDepreciated < usefulLifeMonths) {
			const { year: my, month: mm } = addMonths(startYear, startMonth, monthOffset);
			
			let fractionToTake = 1.0;
			if (monthOffset === 0) {
				fractionToTake = firstMonthFactor;
			} else {
				const monthsLeft = usefulLifeMonths - totalMonthsDepreciated;
				if (monthsLeft < 1.0) {
					fractionToTake = monthsLeft;
				}
			}
			
			let amount = round2(monthlyAmount * fractionToTake);
			if (accumulated + amount > depreciableBase) {
				amount = round2(depreciableBase - accumulated);
			}
			
			if (amount > 0) {
				accumulated = round2(accumulated + amount);
				entries.push({
					month: formatYearMonth(my, mm),
					monthlyAmount: amount,
					accumulatedAmount: accumulated,
					remainingValue: round2(cost - accumulated),
				});
			}
			
			totalMonthsDepreciated += fractionToTake;
			monthOffset++;
		}
		
		// Final adjustment: ensure total exactly equals depreciableBase
		if (entries.length > 0) {
			const diff = round2(depreciableBase - accumulated);
			if (diff > 0) {
				const last = entries[entries.length - 1];
				last.monthlyAmount = round2(last.monthlyAmount + diff);
				accumulated = round2(accumulated + diff);
				last.accumulatedAmount = round2(depreciableBase);
				last.remainingValue = round2(salvageValue);
			}
		}
		
		return entries;
	}

	// DB methods
	const { factor: firstYearFactor, monthsInFirstYear } = firstYearConvention(convention, startMonth);
	
	const usefulLifeYears = Math.ceil(usefulLifeMonths / 12);
	const rawAnnuals = computeAnnualDepreciations(method, cost, salvageValue, usefulLifeYears, firstYearFactor);

	const entries: DepreciationScheduleEntry[] = [];
	let accumulated = 0;
	let monthOffset = 0;

	for (let i = 0; i < rawAnnuals.length; i++) {
		const taxYearAmount = rawAnnuals[i];
		let monthsInTaxYear = 12;
		
		if (i === 0) {
			monthsInTaxYear = monthsInFirstYear;
		} else if (i === rawAnnuals.length - 1) {
			// The last tax year takes whatever months are left to reach usefulLifeMonths
			monthsInTaxYear = usefulLifeMonths - monthOffset;
		}

		if (monthsInTaxYear <= 0) break;

		const monthlyAmount = taxYearAmount / monthsInTaxYear;

		for (let m = 0; m < monthsInTaxYear; m++) {
			const { year: my, month: mm } = addMonths(startYear, startMonth, monthOffset);
			let amount = round2(monthlyAmount);

			if (accumulated + amount > depreciableBase) {
				amount = round2(depreciableBase - accumulated);
			}

			if (amount > 0) {
				accumulated = round2(accumulated + amount);
				entries.push({
					month: formatYearMonth(my, mm),
					monthlyAmount: amount,
					accumulatedAmount: accumulated,
					remainingValue: round2(cost - accumulated),
				});
			}

			monthOffset++;
		}
	}
	
	// Final adjustment: ensure total exactly equals depreciableBase
	if (entries.length > 0) {
		const diff = round2(depreciableBase - accumulated);
		if (diff > 0) {
			const last = entries[entries.length - 1];
			last.monthlyAmount = round2(last.monthlyAmount + diff);
			accumulated = round2(accumulated + diff);
			last.accumulatedAmount = round2(depreciableBase);
			last.remainingValue = round2(salvageValue);
		}
	}

	return entries;
}

// ---------------------------------------------------------------------------
// Single-month calculation
// ---------------------------------------------------------------------------

/**
 * Calculate the depreciation amount for a specific month.
 * Returns 0 if the month is before activation or after fully depreciated.
 */
export function calculateMonthlyDepreciation(
	method: Method,
	convention: Convention,
	cost: number,
	salvageValue: number,
	usefulLifeMonths: number,
	activationDate: string,
	targetMonth: string, // 'YYYY-MM'
	accumulatedSoFar: number
): number {
	const depreciableBase = cost - salvageValue;
	if (depreciableBase <= 0 || usefulLifeMonths <= 0 || cost <= 0) return 0;
	if (accumulatedSoFar >= depreciableBase) return 0;

	const { year: startYear, month: startMonth } = parseISODate(activationDate);
	const { year: targetYear, month: targetMo } = parseYearMonth(targetMonth);

	// Check if target is before activation
	const monthOffset = diffMonths(startYear, startMonth, targetYear, targetMo);
	if (monthOffset < 0) return 0;

	// Generate the schedule and find the target month
	const schedule = generateSchedule(method, convention, cost, salvageValue, usefulLifeMonths, activationDate);

	const entry = schedule.find((e) => e.month === targetMonth);
	if (!entry) return 0;

	// If accumulatedSoFar differs from what the schedule expects, cap to not
	// exceed depreciable base
	const remaining = round2(depreciableBase - accumulatedSoFar);
	if (remaining <= 0) return 0;

	return round2(Math.min(entry.monthlyAmount, remaining));
}

// ---------------------------------------------------------------------------
// Eligible months
// ---------------------------------------------------------------------------

/**
 * Get list of months that need depreciation postings.
 * Returns months from activation through `throughMonth` that are NOT in
 * `alreadyPostedMonths`.
 */
export function getEligibleMonths(
	activationDate: string,
	usefulLifeMonths: number,
	throughMonth: string,
	alreadyPostedMonths: string[]
): string[] {
	if (usefulLifeMonths <= 0) return [];

	const { year: startYear, month: startMonth } = parseISODate(activationDate);
	const { year: throughYear, month: throughMo } = parseYearMonth(throughMonth);

	// End of useful life month
	const end = addMonths(startYear, startMonth, usefulLifeMonths - 1);

	// Clamp end to the earlier of useful life end or throughMonth
	let endYear = end.year;
	let endMonth = end.month;
	if (
		throughYear < endYear ||
		(throughYear === endYear && throughMo < endMonth)
	) {
		endYear = throughYear;
		endMonth = throughMo;
	}

	// Check that start <= end
	if (
		startYear > endYear ||
		(startYear === endYear && startMonth > endMonth)
	) {
		return [];
	}

	const allMonths = monthRange(startYear, startMonth, endYear, endMonth);
	const posted = new Set(alreadyPostedMonths);

	return allMonths.filter((m) => !posted.has(m));
}
