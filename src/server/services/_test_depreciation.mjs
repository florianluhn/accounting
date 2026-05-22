import { generateSchedule, calculateMonthlyDepreciation, getEligibleMonths } from './_tmp_test/depreciation.js';

// Test 1: SL, half_year, 5-year life
console.log('=== Test 1: SL / half_year ===');
const s1 = generateSchedule('SL', 'half_year', 10000, 0, 60, '2025-01-15');
console.log(`Entries: ${s1.length}`);
console.log(`First: ${s1[0].month} = $${s1[0].monthlyAmount}`);
console.log(`Last: ${s1[s1.length - 1].month} = $${s1[s1.length - 1].monthlyAmount}`);
console.log(`Total depr: $${s1[s1.length - 1].accumulatedAmount}`);
console.log(`Remaining: $${s1[s1.length - 1].remainingValue}`);
console.log();

// Test 2: 200DB, half_year
console.log('=== Test 2: 200DB / half_year ===');
const s2 = generateSchedule('200DB', 'half_year', 10000, 1000, 60, '2025-07-01');
console.log(`Entries: ${s2.length}`);
console.log(`First 3:`, s2.slice(0, 3).map(e => `${e.month}: $${e.monthlyAmount}`));
console.log(`Last: ${s2[s2.length - 1].month} = $${s2[s2.length - 1].monthlyAmount}`);
console.log(`Total depr: $${s2[s2.length - 1].accumulatedAmount}`);
console.log(`Remaining: $${s2[s2.length - 1].remainingValue}`);
console.log();

// Test 3: edge case — cost <= salvage
console.log('=== Test 3: Edge cases ===');
console.log(`cost=0: ${generateSchedule('SL', 'half_year', 0, 0, 60, '2025-01-01').length} entries`);
console.log(`cost<=salvage: ${generateSchedule('SL', 'half_year', 1000, 1000, 60, '2025-01-01').length} entries`);
console.log(`life=0: ${generateSchedule('SL', 'half_year', 10000, 0, 0, '2025-01-01').length} entries`);
console.log();

// Test 4: getEligibleMonths
console.log('=== Test 4: getEligibleMonths ===');
const eligible = getEligibleMonths('2025-01-15', 60, '2025-06', ['2025-01', '2025-02']);
console.log(`Eligible: ${eligible.join(', ')}`);
console.log();

// Test 5: calculateMonthlyDepreciation
console.log('=== Test 5: calculateMonthlyDepreciation ===');
const monthDepr = calculateMonthlyDepreciation('SL', 'half_year', 10000, 0, 60, '2025-01-15', '2025-03', 0);
console.log(`Monthly depr for 2025-03: $${monthDepr}`);

// Test 6: SL mid_month
console.log('\n=== Test 6: SL / mid_month (July activation) ===');
const s6 = generateSchedule('SL', 'mid_month', 12000, 2000, 60, '2025-07-15');
console.log(`Entries: ${s6.length}`);
console.log(`First: ${s6[0].month} = $${s6[0].monthlyAmount}`);
console.log(`Last: ${s6[s6.length - 1].month} = $${s6[s6.length - 1].remainingValue}`);
console.log(`Total depr: $${s6[s6.length - 1].accumulatedAmount}`);

// Test 7: SL mid_quarter
console.log('\n=== Test 7: SL / mid_quarter (Oct activation = Q4) ===');
const s7 = generateSchedule('SL', 'mid_quarter', 10000, 0, 60, '2025-10-01');
console.log(`Entries: ${s7.length}`);
console.log(`First: ${s7[0].month} = $${s7[0].monthlyAmount}`);
console.log(`Total depr: $${s7[s7.length - 1].accumulatedAmount}`);
console.log(`Remaining: $${s7[s7.length - 1].remainingValue}`);

// Test 8: 150DB
console.log('\n=== Test 8: 150DB / half_year ===');
const s8 = generateSchedule('150DB', 'half_year', 20000, 2000, 84, '2024-03-01');
console.log(`Entries: ${s8.length}`);
console.log(`First: ${s8[0].month} = $${s8[0].monthlyAmount}`);
console.log(`Total depr: $${s8[s8.length - 1].accumulatedAmount}`);
console.log(`Remaining: $${s8[s8.length - 1].remainingValue}`);

console.log('\n✅ All tests completed!');
