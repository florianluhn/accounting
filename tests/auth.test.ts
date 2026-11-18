import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';

const dir = mkdtempSync(join(tmpdir(), 'acct-auth-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = join(dir, 'test.db');
process.env.ATTACHMENTS_PATH = join(dir, 'attachments');
process.env.BACKUP_ENABLED = 'false';

const { buildServer } = await import('../src/server/index.ts');

let app: FastifyInstance;
let adminCookie = '';

function cookieFrom(response: { headers: Record<string, string | string[] | undefined> }): string {
	const raw = response.headers['set-cookie'];
	const value = Array.isArray(raw) ? raw[0] : raw;
	assert.ok(value, 'expected a session cookie');
	return value.split(';')[0];
}

before(async () => {
	app = await buildServer();
});

after(async () => {
	await app.close();
});

test('health is public and other routes require a session', async () => {
	const health = await app.inject({ method: 'GET', url: '/api/health' });
	assert.equal(health.statusCode, 200);
	const vendors = await app.inject({ method: 'GET', url: '/api/vendors' });
	assert.equal(vendors.statusCode, 401);
	const uploads = await app.inject({ method: 'GET', url: '/uploads/secret.pdf' });
	assert.equal(uploads.statusCode, 401);
});

test('bootstrap creates an admin and records that user on audit rows', async () => {
	const boot = await app.inject({
		method: 'POST',
		url: '/api/auth/bootstrap',
		payload: { username: 'florian', password: 'correct-horse' }
	});
	assert.equal(boot.statusCode, 201);
	adminCookie = cookieFrom(boot);
	const again = await app.inject({
		method: 'POST',
		url: '/api/auth/bootstrap',
		payload: { username: 'other', password: 'correct-horse' }
	});
	assert.equal(again.statusCode, 409);

	const created = await app.inject({
		method: 'POST',
		url: '/api/vendors',
		headers: { cookie: adminCookie },
		payload: { name: 'Hardware store' }
	});
	assert.equal(created.statusCode, 201);

	const logs = await app.inject({
		method: 'GET',
		url: '/api/audit-logs',
		headers: { cookie: adminCookie }
	});
	assert.equal(logs.statusCode, 200);
	const vendorLog = logs.json().find((row: { resourceType: string }) => row.resourceType === 'vendor');
	assert.equal(vendorLog.actorUsername, 'florian');
	assert.equal(vendorLog.actorUserId > 0, true);
});

test('opening balance keeps the balance sheet balanced and the ledger runs oldest-first', async () => {
	const auth = { cookie: adminCookie };
	await app.inject({
		method: 'POST',
		url: '/api/currencies',
		headers: auth,
		payload: { code: 'USD', name: 'US Dollar', symbol: '$', exchangeRate: 1, isDefault: true }
	});
	const cashGl = await app.inject({
		method: 'POST',
		url: '/api/gl-accounts',
		headers: auth,
		payload: { accountNumber: '1000', name: 'Cash', type: 'Cash', isActive: true }
	});
	const openGl = await app.inject({
		method: 'POST',
		url: '/api/gl-accounts',
		headers: auth,
		payload: { accountNumber: '3900', name: 'Opening', type: 'Opening Balance', isActive: true }
	});
	const cash = await app.inject({
		method: 'POST',
		url: '/api/subledger-accounts',
		headers: auth,
		payload: {
			glAccountId: cashGl.json().id,
			accountNumber: '1001',
			name: 'Wallet',
			currencyCode: 'USD'
		}
	});
	const opening = await app.inject({
		method: 'POST',
		url: '/api/subledger-accounts',
		headers: auth,
		payload: {
			glAccountId: openGl.json().id,
			accountNumber: '3901',
			name: 'Start',
			currencyCode: 'USD'
		}
	});
	await app.inject({
		method: 'POST',
		url: '/api/journal-entries',
		headers: auth,
		payload: {
			entryDate: '2024-01-02T00:00:00.000Z',
			amount: 10,
			currencyCode: 'USD',
			debitAccountId: cash.json().id,
			creditAccountId: opening.json().id,
			description: 'Second'
		}
	});
	await app.inject({
		method: 'POST',
		url: '/api/journal-entries',
		headers: auth,
		payload: {
			entryDate: '2024-01-01T00:00:00.000Z',
			amount: 25,
			currencyCode: 'USD',
			debitAccountId: cash.json().id,
			creditAccountId: opening.json().id,
			description: 'First'
		}
	});

	const sheet = await app.inject({
		method: 'GET',
		url: '/api/reports/balance-sheet?currencyCode=USD',
		headers: auth
	});
	assert.equal(sheet.statusCode, 200);
	assert.equal(sheet.json().balanced, true);
	assert.equal(sheet.json().assets.total, 35);

	const ledger = await app.inject({
		method: 'GET',
		url: `/api/reports/account-ledger/${cash.json().id}`,
		headers: auth
	});
	const entries = ledger.json().entries;
	assert.equal(entries[0].description, 'First');
	assert.equal(entries[0].balance, 25);
	assert.equal(entries[1].description, 'Second');
	assert.equal(entries[1].balance, 35);

	const same = await app.inject({
		method: 'PUT',
		url: `/api/journal-entries/${entries[0].id}`,
		headers: auth,
		payload: { debitAccountId: opening.json().id }
	});
	assert.equal(same.statusCode, 400);
});

test('rights and admin routes are enforced, and a bearer token acts as that user', async () => {
	const auth = { cookie: adminCookie };
	const created = await app.inject({
		method: 'POST',
		url: '/api/users',
		headers: auth,
		payload: { username: 'clerk', password: 'clerk-pass', isAdmin: false, rights: 'add' }
	});
	assert.equal(created.statusCode, 201);
	const clerkId = created.json().id;
	const login = await app.inject({
		method: 'POST',
		url: '/api/auth/login',
		payload: { username: 'clerk', password: 'clerk-pass' }
	});
	const clerkCookie = cookieFrom(login);

	const vendor = await app.inject({
		method: 'POST',
		url: '/api/vendors',
		headers: { cookie: clerkCookie },
		payload: { name: 'Clerk vendor' }
	});
	assert.equal(vendor.statusCode, 201);
	const edited = await app.inject({
		method: 'PUT',
		url: `/api/vendors/${vendor.json().id}`,
		headers: { cookie: clerkCookie },
		payload: { name: 'Changed' }
	});
	assert.equal(edited.statusCode, 403);
	const removed = await app.inject({
		method: 'DELETE',
		url: `/api/vendors/${vendor.json().id}`,
		headers: { cookie: clerkCookie }
	});
	assert.equal(removed.statusCode, 403);
	const settings = await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie: clerkCookie } });
	assert.equal(settings.statusCode, 403);
	const audit = await app.inject({ method: 'GET', url: '/api/audit-logs', headers: { cookie: clerkCookie } });
	assert.equal(audit.statusCode, 403);
	const wiped = await app.inject({
		method: 'POST',
		url: '/api/journal-entries/delete-all',
		headers: { cookie: clerkCookie },
		payload: { confirmation: 'DELETE ALL JOURNAL ENTRIES' }
	});
	assert.equal(wiped.statusCode, 403);

	const token = await app.inject({
		method: 'POST',
		url: `/api/users/${clerkId}/tokens`,
		headers: auth,
		payload: { name: 'assistant' }
	});
	assert.equal(token.statusCode, 201);
	const secret = token.json().token as string;
	const viaToken = await app.inject({
		method: 'POST',
		url: '/api/vendors',
		headers: { authorization: `Bearer ${secret}` },
		payload: { name: 'Token vendor' }
	});
	assert.equal(viaToken.statusCode, 201);
	const logs = await app.inject({ method: 'GET', url: '/api/audit-logs', headers: auth });
	const tokenLog = logs.json().find((row: { description: string }) =>
		String(row.newData?.name || '') === 'Token vendor'
	);
	assert.equal(tokenLog.actorUsername, 'clerk');
	assert.equal(tokenLog.source, 'API');

	await app.inject({
		method: 'DELETE',
		url: `/api/users/${clerkId}/tokens/${token.json().id}`,
		headers: auth
	});
	const revoked = await app.inject({
		method: 'GET',
		url: '/api/vendors',
		headers: { authorization: `Bearer ${secret}` }
	});
	assert.equal(revoked.statusCode, 401);

	const demote = await app.inject({
		method: 'PUT',
		url: '/api/users/1',
		headers: auth,
		payload: { isAdmin: false }
	});
	assert.equal(demote.statusCode, 409);
});

test('a malicious inventory formula is rejected', async () => {
	const response = await app.inject({
		method: 'POST',
		url: '/api/inventory/categories',
		headers: { cookie: adminCookie },
		payload: {
			name: 'Boards',
			categoryType: 'other',
			fieldDefinitions: [{ key: 'width', label: 'Width', type: 'number' }],
			valueFormula: 'process.exit(1)'
		}
	});
	assert.equal(response.statusCode, 400);
});

test('bookings are accepted by the audit log', async () => {
	const auth = { cookie: adminCookie };
	const customer = await app.inject({
		method: 'POST',
		url: '/api/customers',
		headers: auth,
		payload: { firstName: 'Ada', lastName: 'Lovelace' }
	});
	const platform = await app.inject({
		method: 'POST',
		url: '/api/bookings/platforms',
		headers: auth,
		payload: { name: 'Direct' }
	});
	const booking = await app.inject({
		method: 'POST',
		url: '/api/bookings',
		headers: auth,
		payload: {
			customerId: customer.json().id,
			platformId: platform.json().id,
			checkInDate: '2024-06-01',
			checkOutDate: '2024-06-04',
			nights: 0,
			totalPaid: 300
		}
	});
	assert.equal(booking.statusCode, 201, booking.body);
	assert.equal(booking.json().nights, 3);
	const logs = await app.inject({ method: 'GET', url: '/api/audit-logs?resourceType=booking', headers: auth });
	assert.equal(logs.json().some((row: { actorUsername: string }) => row.actorUsername === 'florian'), true);
});
