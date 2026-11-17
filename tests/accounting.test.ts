import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateFormula, computeTotalValue } from '../src/server/services/formula.ts';
import { generateSchedule } from '../src/server/services/depreciation.ts';
import { dollarsToCents, sumMoney } from '../src/server/money.ts';

test('formulas evaluate arithmetic and reject code', () => {
	assert.equal(evaluateFormula('width * 2 + 1', { width: 3 }), 7);
	assert.throws(() => evaluateFormula('process.exit(1)', { width: 1 }));
	assert.throws(() => evaluateFormula('width +', { width: 1 }));
	assert.equal(
		computeTotalValue('board_feet * price', [
			{ key: 'board_feet', label: 'BF', type: 'number' },
			{ key: 'price', label: 'Price', type: 'number' }
		], { board_feet: 2, price: 1.255 }),
		2.51
	);
});

test('straight-line half-year is half of a year, not half of a month', () => {
	const schedule = generateSchedule('SL', 'half_year', 1200, 0, 24, '2024-01-15');
	const year1 = schedule.filter((row) => row.month.startsWith('2024')).reduce((sum, row) => sum + row.monthlyAmount, 0);
	assert.ok(Math.abs(year1 - 300) < 0.02, `expected about 300 in the first year, got ${year1}`);
	const total = schedule.reduce((sum, row) => sum + row.monthlyAmount, 0);
	assert.ok(Math.abs(total - 1200) < 0.02);
});

test('money sums in cents', () => {
	assert.equal(dollarsToCents(10.1), 1010);
	assert.equal(dollarsToCents(-1.005), -101);
	assert.equal(sumMoney([0.1, 0.2]), 0.3);
});
