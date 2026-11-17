export interface FieldDefinition {
	key: string;
	label: string;
	type: 'text' | 'number' | 'computed';
	unit?: string;
	formula?: string;
}

class FormulaError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FormulaError';
	}
}

/**
 * Arithmetic only: numbers, field names, + - * / and parentheses.
 * Rejects anything that could execute as JavaScript.
 */
export function evaluateFormula(formula: string, variables: Record<string, number>): number {
	const parser = new Parser(formula, variables);
	const result = parser.parseExpression();
	parser.skip();
	if (!parser.done()) {
		throw new FormulaError('Unexpected input in formula');
	}
	if (!Number.isFinite(result)) {
		throw new FormulaError('Formula result is not a finite number');
	}
	return result;
}

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

/** Stored inventory value, rounded to cents. Throws if the formula is invalid. */
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
	const raw = valueFormula.trim() === '' ? 0 : evaluateFormula(valueFormula, numericVars);
	return Math.round(raw * 100) / 100;
}

class Parser {
	private index = 0;

	constructor(
		private readonly input: string,
		private readonly variables: Record<string, number>
	) {}

	done(): boolean {
		return this.index >= this.input.length;
	}

	skip(): void {
		while (this.index < this.input.length && /\s/.test(this.input[this.index])) this.index++;
	}

	parseExpression(): number {
		let value = this.parseTerm();
		for (;;) {
			this.skip();
			if (this.peek() === '+') {
				this.index++;
				value += this.parseTerm();
			} else if (this.peek() === '-') {
				this.index++;
				value -= this.parseTerm();
			} else {
				return value;
			}
		}
	}

	private parseTerm(): number {
		let value = this.parseUnary();
		for (;;) {
			this.skip();
			if (this.peek() === '*') {
				this.index++;
				value *= this.parseUnary();
			} else if (this.peek() === '/') {
				this.index++;
				const divisor = this.parseUnary();
				value = divisor === 0 ? Number.NaN : value / divisor;
			} else {
				return value;
			}
		}
	}

	private parseUnary(): number {
		this.skip();
		if (this.peek() === '+') {
			this.index++;
			return this.parseUnary();
		}
		if (this.peek() === '-') {
			this.index++;
			return -this.parseUnary();
		}
		return this.parsePrimary();
	}

	private parsePrimary(): number {
		this.skip();
		const ch = this.peek();
		if (ch === '(') {
			this.index++;
			const value = this.parseExpression();
			this.skip();
			if (this.peek() !== ')') throw new FormulaError('Missing closing parenthesis');
			this.index++;
			return value;
		}
		if (ch >= '0' && ch <= '9' || ch === '.') return this.parseNumber();
		if (/[A-Za-z_]/.test(ch)) return this.parseIdent();
		throw new FormulaError('Invalid formula');
	}

	private parseNumber(): number {
		const start = this.index;
		while (this.index < this.input.length && /[0-9.]/.test(this.input[this.index])) this.index++;
		const text = this.input.slice(start, this.index);
		if (!/^\d+(\.\d+)?$|^\.\d+$/.test(text)) throw new FormulaError('Invalid number');
		return Number(text);
	}

	private parseIdent(): number {
		const start = this.index;
		while (this.index < this.input.length && /[A-Za-z0-9_]/.test(this.input[this.index])) this.index++;
		const name = this.input.slice(start, this.index);
		if (!Object.prototype.hasOwnProperty.call(this.variables, name)) {
			throw new FormulaError(`Unknown field ${name}`);
		}
		const value = Number(this.variables[name]);
		if (!Number.isFinite(value)) throw new FormulaError(`Field ${name} is not a number`);
		return value;
	}

	private peek(): string {
		return this.index < this.input.length ? this.input[this.index] : '';
	}
}
