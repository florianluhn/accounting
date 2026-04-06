export interface FieldDefinition {
	key: string;
	label: string;
	type: 'text' | 'number' | 'computed';
	unit?: string;
	formula?: string; // only for type === 'computed'
}

/**
 * Safely evaluate a math formula string with named variables.
 * Uses Function constructor — acceptable for a single-user self-hosted app
 * where the user themselves defines the formulas.
 */
export function evaluateFormula(formula: string, variables: Record<string, number>): number {
	try {
		const keys = Object.keys(variables);
		const values = Object.values(variables);
		// "use strict" prevents access to global scope
		const fn = new Function(...keys, `"use strict"; return Number(${formula});`);
		const result = fn(...values);
		if (!isFinite(result) || isNaN(result)) return 0;
		return Math.round(result * 100000) / 100000;
	} catch {
		return 0;
	}
}

/**
 * Given field definitions and raw user-input values, resolve all fields
 * (including computed ones in definition order, so they can chain).
 * Returns a flat map of key → resolved value.
 */
export function resolveFields(
	fieldDefs: FieldDefinition[],
	fieldValues: Record<string, string | number>
): Record<string, string | number> {
	const numericVars: Record<string, number> = {};
	const result: Record<string, string | number> = {};

	for (const field of fieldDefs) {
		if (field.type === 'number') {
			const v = Number(fieldValues[field.key] ?? 0);
			numericVars[field.key] = v;
			result[field.key] = v;
		} else if (field.type === 'text') {
			result[field.key] = fieldValues[field.key] ?? '';
		} else if (field.type === 'computed' && field.formula) {
			const v = evaluateFormula(field.formula, numericVars);
			numericVars[field.key] = v;
			result[field.key] = v;
		}
	}

	return result;
}

/**
 * Compute the stored total_value for one inventory item.
 */
export function computeTotalValue(
	valueFormula: string,
	fieldDefs: FieldDefinition[],
	fieldValues: Record<string, string | number>
): number {
	const numericVars: Record<string, number> = {};

	for (const field of fieldDefs) {
		if (field.type === 'number') {
			numericVars[field.key] = Number(fieldValues[field.key] ?? 0);
		} else if (field.type === 'computed' && field.formula) {
			numericVars[field.key] = evaluateFormula(field.formula, numericVars);
		}
	}

	return evaluateFormula(valueFormula, numericVars);
}
