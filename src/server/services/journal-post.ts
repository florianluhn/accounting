import { z } from 'zod';
import db from '../db/connection.js';
import {
	journalEntries,
	subledgerAccounts,
	currencies,
	inventoryItems,
	investments
} from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { logAudit } from './audit.js';
import { assertDateNotInClosedYear, YearCloseError } from './year-close.js';
import { assertInvestmentQuantityOk } from '../routes/investments.js';

export class JournalPostError extends Error {
	statusCode: number;
	constructor(message: string, statusCode = 400) {
		super(message);
		this.name = 'JournalPostError';
		this.statusCode = statusCode;
	}
}

const journalLineFields = {
	entryDate: z.coerce.date(),
	amount: z.number().min(0),
	currencyCode: z.string().length(3).default('USD'),
	debitAccountId: z.number().int().positive(),
	creditAccountId: z.number().int().positive(),
	description: z.string().min(1).max(500),
	category: z.string().max(100).optional().nullable(),
	comment: z.string().max(1000).optional().nullable(),
	checkReference: z.string().max(100).nullable().optional(),
	vendorId: z.number().int().positive().nullable().optional(),
	customerId: z.number().int().positive().nullable().optional(),
	inventoryItemId: z.number().int().positive().nullable().optional(),
	inventoryLinkType: z.enum(['sale', 'own_use', 'gift']).nullable().optional(),
	fixedAssetId: z.number().int().positive().nullable().optional(),
	isDepreciation: z.boolean().optional(),
	investmentId: z.number().int().positive().nullable().optional(),
	investmentQuantity: z.number().nullable().optional()
};

export const templateLineSchema = z
	.object(journalLineFields)
	.omit({ entryDate: true, isDepreciation: true })
	.refine((data) => data.debitAccountId !== data.creditAccountId, {
		message: 'Debit and credit accounts must be different',
		path: ['creditAccountId']
	})
	.refine((data) => data.amount > 0 || !!data.inventoryItemId, {
		message: 'Amount can only be 0 when linked to an inventory item disposition',
		path: ['amount']
	});

export const journalLineSchema = z
	.object(journalLineFields)
	.refine((data) => data.debitAccountId !== data.creditAccountId, {
		message: 'Debit and credit accounts must be different',
		path: ['creditAccountId']
	})
	.refine((data) => data.amount > 0 || !!data.inventoryItemId, {
		message: 'Amount can only be 0 when linked to an inventory item disposition',
		path: ['amount']
	})
	.refine(
		(data) => !data.investmentId || (data.investmentQuantity != null && data.investmentQuantity !== 0),
		{
			message: 'Quantity is required (and cannot be zero) when an investment is selected',
			path: ['investmentQuantity']
		}
	);

/** Insert one journal entry with the same checks and audit row as POST /api/journal-entries. */
export async function postJournalEntry(input: unknown) {
	const validatedData = journalLineSchema.parse(input);
	await assertDateNotInClosedYear(validatedData.entryDate);

	const debitAccount = await db
		.select()
		.from(subledgerAccounts)
		.where(eq(subledgerAccounts.id, validatedData.debitAccountId))
		.limit(1);
	if (debitAccount.length === 0) {
		throw new JournalPostError(`Debit account ${validatedData.debitAccountId} not found`, 404);
	}
	const creditAccount = await db
		.select()
		.from(subledgerAccounts)
		.where(eq(subledgerAccounts.id, validatedData.creditAccountId))
		.limit(1);
	if (creditAccount.length === 0) {
		throw new JournalPostError(`Credit account ${validatedData.creditAccountId} not found`, 404);
	}

	const currency = await db
		.select()
		.from(currencies)
		.where(eq(currencies.code, validatedData.currencyCode))
		.limit(1);
	if (currency.length === 0) {
		throw new JournalPostError(`Currency ${validatedData.currencyCode} not found`, 404);
	}

	const amountInUSD = Math.round(validatedData.amount * currency[0].exchangeRate * 100) / 100;
	const exchangeRateToUsd = currency[0].exchangeRate;
	const linkType = validatedData.inventoryItemId ? (validatedData.inventoryLinkType ?? null) : null;
	const checkRef =
		validatedData.checkReference != null && String(validatedData.checkReference).trim() !== ''
			? String(validatedData.checkReference).trim()
			: null;
	const investmentId = validatedData.investmentId ?? null;
	const investmentQuantity = investmentId != null ? (validatedData.investmentQuantity ?? null) : null;

	if (investmentId != null) {
		const inv = await db
			.select({ id: investments.id })
			.from(investments)
			.where(eq(investments.id, investmentId))
			.limit(1);
		if (inv.length === 0) {
			throw new JournalPostError(`Investment ${investmentId} not found`, 404);
		}
		const qtyCheck = await assertInvestmentQuantityOk({
			investmentId,
			quantity: investmentQuantity as number,
			amountInUSD,
			entryDate: validatedData.entryDate
		});
		if (!qtyCheck.ok) throw new JournalPostError(qtyCheck.message, 400);
	}

	const newEntry = await db
		.insert(journalEntries)
		.values({
			...validatedData,
			category: validatedData.category ?? null,
			comment: validatedData.comment ?? null,
			amountInUSD,
			exchangeRateToUsd,
			checkReference: checkRef,
			customerId: validatedData.customerId ?? null,
			inventoryItemId: validatedData.inventoryItemId ?? null,
			inventoryLinkType: linkType,
			fixedAssetId: validatedData.fixedAssetId ?? null,
			isDepreciation: validatedData.isDepreciation ?? false,
			investmentId,
			investmentQuantity,
			vendorId: validatedData.vendorId ?? null
		})
		.returning();

	if (validatedData.inventoryItemId && linkType && ['sale', 'own_use', 'gift'].includes(linkType)) {
		await db
			.update(inventoryItems)
			.set({ dispositionType: linkType, quantity: 0 })
			.where(eq(inventoryItems.id, validatedData.inventoryItemId));
	}

	await logAudit({
		operation: 'CREATE',
		resourceType: 'journal_entry',
		resourceId: newEntry[0].id,
		newData: newEntry[0]
	});

	return newEntry[0];
}

export function isYearCloseError(error: unknown): error is YearCloseError {
	return error instanceof YearCloseError;
}
