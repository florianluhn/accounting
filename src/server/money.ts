import { customType } from 'drizzle-orm/sqlite-core';

/** Integer cents at the database boundary. Callers keep using decimal currency units. */

export const money = customType<{ data: number; driverData: number }>({
	dataType() {
		return 'integer';
	},
	fromDriver(value: unknown): number {
		if (value == null) return null as unknown as number;
		return Number(value) / 100;
	},
	toDriver(value: number): number {
		return dollarsToCents(value);
	}
});

export function dollarsToCents(value: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`Amount is not a finite number: ${String(value)}`);
	}
	const sign = value < 0 ? -1 : 1;
	return sign * Math.round(Math.abs(value) * 100 + 1e-8);
}

export function centsToDollars(cents: number): number {
	return cents / 100;
}

/** Sum decimal amounts in integer cents, then convert once. */
export function sumMoney(values: Array<number | null | undefined>): number {
	let cents = 0;
	for (const value of values) {
		if (value == null) continue;
		cents += dollarsToCents(value);
	}
	return centsToDollars(cents);
}

export function roundMoney(value: number): number {
	return centsToDollars(dollarsToCents(value));
}
