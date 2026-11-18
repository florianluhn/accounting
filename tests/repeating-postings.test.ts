import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';

const dir = mkdtempSync(join(tmpdir(), 'acct-repeat-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = join(dir, 'test.db');
process.env.ATTACHMENTS_PATH = join(dir, 'attachments');
process.env.BACKUP_ENABLED = 'false';

const { buildServer } = await import('../src/server/index.ts');

let app: FastifyInstance;
let adminCookie = '';
let clerkCookie = '';
let cashId = 0;
let equityId = 0;
let expenseId = 0;

function cookieFrom(response: { headers: Record<string, string | string[] | undefined> }): string {
	const raw = response.headers['set-cookie'];
	const value = Array.isArray(raw) ? raw[0] : raw;
	assert.ok(value, 'expected a session cookie');
	return value.split(';')[0];
}

async function journalCount(): Promise<number> {
	const res = await app.inject({
		method: 'GET',
		url: '/api/journal-entries/count',
		headers: { cookie: adminCookie }
	});
	assert.equal(res.statusCode, 200);
	return res.json().count;
}

before(async () => {
	app = await buildServer();
	const boot = await app.inject({
		method: 'POST',
		url: '/api/auth/bootstrap',
		payload: { username: 'florian', password: 'correct-horse' }
	});
	assert.equal(boot.statusCode, 201);
	adminCookie = cookieFrom(boot);
	const auth = { cookie: adminCookie };

	await app.inject({
		method: 'POST',
		url: '/api/currencies',
		headers: auth,
		payload: { code: 'USD', name: 'US Dollar', symbol: '$', exchangeRate: 1, isDefault: true }
	});

	async function sub(glNumber: string, glName: string, type: string, subNumber: string, subName: string) {
		const gl = await app.inject({
			method: 'POST',
			url: '/api/gl-accounts',
			headers: auth,
			payload: { accountNumber: glNumber, name: glName, type, isActive: true }
		});
		assert.equal(gl.statusCode, 201, gl.body);
		const account = await app.inject({
			method: 'POST',
			url: '/api/subledger-accounts',
			headers: auth,
			payload: {
				glAccountId: gl.json().id,
				accountNumber: subNumber,
				name: subName,
				currencyCode: 'USD'
			}
		});
		assert.equal(account.statusCode, 201, account.body);
		return account.json().id as number;
	}

	cashId = await sub('1000', 'Cash', 'Cash', '1001', 'Wallet');
	equityId = await sub('3000', 'Equity', 'Equity', '3001', 'Opening');
	expenseId = await sub('5000', 'Expenses', 'Profit', '5001', 'Groceries');

	const clerk = await app.inject({
		method: 'POST',
		url: '/api/users',
		headers: auth,
		payload: { username: 'clerk', password: 'correct-horse', isAdmin: false, rights: 'add' }
	});
	assert.equal(clerk.statusCode, 201, clerk.body);
	const login = await app.inject({
		method: 'POST',
		url: '/api/auth/login',
		payload: { username: 'clerk', password: 'correct-horse' }
	});
	assert.equal(login.statusCode, 200, login.body);
	clerkCookie = cookieFrom(login);
});

after(async () => {
	await app.close();
});

test('templates copy selected journal lines and can be renamed', async () => {
	const auth = { cookie: adminCookie };
	const rent = await app.inject({
		method: 'POST',
		url: '/api/journal-entries',
		headers: auth,
		payload: {
			entryDate: '2024-03-01T00:00:00.000Z',
			amount: 12.34,
			currencyCode: 'USD',
			debitAccountId: expenseId,
			creditAccountId: cashId,
			description: 'March rent',
			category: 'Housing',
			comment: 'landlord'
		}
	});
	assert.equal(rent.statusCode, 201, rent.body);
	const power = await app.inject({
		method: 'POST',
		url: '/api/journal-entries',
		headers: auth,
		payload: {
			entryDate: '2024-03-02T00:00:00.000Z',
			amount: 40,
			currencyCode: 'USD',
			debitAccountId: expenseId,
			creditAccountId: equityId,
			description: 'Power bill'
		}
	});
	assert.equal(power.statusCode, 201, power.body);

	const created = await app.inject({
		method: 'POST',
		url: '/api/repeating-postings',
		headers: auth,
		payload: { name: 'Monthly bills', journalEntryIds: [rent.json().id, power.json().id] }
	});
	assert.equal(created.statusCode, 201, created.body);
	const template = created.json();
	assert.equal(template.lines.length, 2);
	assert.equal(template.lines[0].description, 'March rent');
	assert.equal(template.lines[0].amount, 12.34);
	assert.equal(template.lines[0].category, 'Housing');
	assert.equal(template.lines[0].comment, 'landlord');
	assert.equal(template.lines[0].debitAccountId, expenseId);
	assert.equal(template.lines[0].creditAccountId, cashId);
	assert.equal(template.lines[1].debitAccountId, expenseId);
	assert.equal(template.lines[1].creditAccountId, equityId);
	assert.equal(template.lines[0].entryDate, undefined);

	const renamed = await app.inject({
		method: 'PUT',
		url: `/api/repeating-postings/${template.id}`,
		headers: auth,
		payload: {
			name: 'Household',
			lines: [
				{ ...template.lines[0], amount: 13 },
				{
					...template.lines[1],
					description: 'Power',
					debitAccountId: cashId,
					creditAccountId: expenseId,
					amount: 41.5
				}
			]
		}
	});
	assert.equal(renamed.statusCode, 200, renamed.body);
	assert.equal(renamed.json().name, 'Household');
	assert.equal(renamed.json().lines[0].amount, 13);
	assert.equal(renamed.json().lines[1].debitAccountId, cashId);
	assert.equal(renamed.json().lines[1].creditAccountId, expenseId);

	const list = await app.inject({
		method: 'GET',
		url: '/api/repeating-postings',
		headers: auth
	});
	assert.equal(list.statusCode, 200);
	assert.equal(list.json().find((row: { id: number }) => row.id === template.id).lineCount, 2);

	const logs = await app.inject({
		method: 'GET',
		url: '/api/audit-logs',
		headers: auth
	});
	const templateLogs = logs.json().filter((row: { resourceType: string; resourceId: string }) =>
		row.resourceType === 'repeating_posting' && String(row.resourceId) === String(template.id)
	);
	assert.equal(templateLogs.some((row: { operation: string; actorUsername: string }) =>
		row.operation === 'CREATE' && row.actorUsername === 'florian'
	), true);
	assert.equal(templateLogs.some((row: { operation: string; actorUsername: string }) =>
		row.operation === 'UPDATE' && row.actorUsername === 'florian'
	), true);
});

test('posting a template writes one entry per line in one transaction', async () => {
	const auth = { cookie: adminCookie };
	const before = await journalCount();
	const created = await app.inject({
		method: 'POST',
		url: '/api/repeating-postings',
		headers: auth,
		payload: {
			name: 'Split',
			lines: [
				{
					amount: 10,
					currencyCode: 'USD',
					debitAccountId: expenseId,
					creditAccountId: cashId,
					description: 'Line A'
				},
				{
					amount: 20,
					currencyCode: 'USD',
					debitAccountId: cashId,
					creditAccountId: equityId,
					description: 'Line B'
				}
			]
		}
	});
	assert.equal(created.statusCode, 201, created.body);
	const id = created.json().id;

	const failed = await app.inject({
		method: 'POST',
		url: `/api/repeating-postings/${id}/post`,
		headers: auth,
		payload: {
			entryDate: '2024-04-01T00:00:00.000Z',
			lines: [
				{
					amount: 10,
					currencyCode: 'USD',
					debitAccountId: expenseId,
					creditAccountId: cashId,
					description: 'Should roll back'
				},
				{
					amount: 20,
					currencyCode: 'USD',
					debitAccountId: 999999,
					creditAccountId: equityId,
					description: 'Missing account'
				}
			]
		}
	});
	assert.equal(failed.statusCode, 404, failed.body);
	assert.equal(await journalCount(), before);

	const posted = await app.inject({
		method: 'POST',
		url: `/api/repeating-postings/${id}/post`,
		headers: auth,
		payload: {
			entryDate: '2024-04-02T00:00:00.000Z',
			lines: created.json().lines
		}
	});
	assert.equal(posted.statusCode, 201, posted.body);
	assert.equal(posted.json().count, 2);
	assert.equal(await journalCount(), before + 2);
	const entries = posted.json().entries;
	assert.equal(entries[0].description, 'Line A');
	assert.equal(entries[0].debitAccountId, expenseId);
	assert.equal(entries[0].creditAccountId, cashId);
	assert.equal(entries[0].amount, 10);
	assert.equal(entries[1].description, 'Line B');
	assert.equal(entries[1].debitAccountId, cashId);
	assert.equal(entries[1].creditAccountId, equityId);
	assert.equal(entries[1].amount, 20);
	assert.notEqual(entries[0].debitAccountId, entries[1].debitAccountId);

	const logs = await app.inject({
		method: 'GET',
		url: '/api/audit-logs',
		headers: auth
	});
	for (const entry of entries) {
		const row = logs.json().find((log: { resourceType: string; resourceId: string; operation: string }) =>
			log.resourceType === 'journal_entry' &&
			log.operation === 'CREATE' &&
			String(log.resourceId) === String(entry.id)
		);
		assert.ok(row, `missing audit row for journal ${entry.id}`);
		assert.equal(row.actorUsername, 'florian');
	}
});

test('add-only users can create and post templates but not edit or delete them', async () => {
	const auth = { cookie: adminCookie };
	const clerk = { cookie: clerkCookie };
	const created = await app.inject({
		method: 'POST',
		url: '/api/repeating-postings',
		headers: clerk,
		payload: {
			name: 'Clerk template',
			lines: [
				{
					amount: 5,
					currencyCode: 'USD',
					debitAccountId: expenseId,
					creditAccountId: cashId,
					description: 'Clerk line'
				}
			]
		}
	});
	assert.equal(created.statusCode, 201, created.body);
	const id = created.json().id;

	const edit = await app.inject({
		method: 'PUT',
		url: `/api/repeating-postings/${id}`,
		headers: clerk,
		payload: { name: 'Renamed by clerk' }
	});
	assert.equal(edit.statusCode, 403, edit.body);

	const remove = await app.inject({
		method: 'DELETE',
		url: `/api/repeating-postings/${id}`,
		headers: clerk
	});
	assert.equal(remove.statusCode, 403, remove.body);

	const posted = await app.inject({
		method: 'POST',
		url: `/api/repeating-postings/${id}/post`,
		headers: clerk,
		payload: {
			entryDate: '2024-05-01T00:00:00.000Z',
			lines: created.json().lines
		}
	});
	assert.equal(posted.statusCode, 201, posted.body);

	const logs = await app.inject({
		method: 'GET',
		url: '/api/audit-logs',
		headers: auth
	});
	const createdLog = logs.json().find((row: { resourceType: string; resourceId: string; operation: string }) =>
		row.resourceType === 'repeating_posting' &&
		row.operation === 'CREATE' &&
		String(row.resourceId) === String(id)
	);
	assert.equal(createdLog.actorUsername, 'clerk');
	const postedLog = logs.json().find((row: { resourceType: string; resourceId: string; operation: string }) =>
		row.resourceType === 'journal_entry' &&
		row.operation === 'CREATE' &&
		String(row.resourceId) === String(posted.json().entries[0].id)
	);
	assert.equal(postedLog.actorUsername, 'clerk');

	const deleted = await app.inject({
		method: 'DELETE',
		url: `/api/repeating-postings/${id}`,
		headers: auth
	});
	assert.equal(deleted.statusCode, 204, deleted.body);
	const gone = await app.inject({
		method: 'GET',
		url: `/api/repeating-postings/${id}`,
		headers: auth
	});
	assert.equal(gone.statusCode, 404);
	const deleteLog = (await app.inject({
		method: 'GET',
		url: '/api/audit-logs',
		headers: auth
	})).json().find((row: { resourceType: string; resourceId: string; operation: string }) =>
		row.resourceType === 'repeating_posting' &&
		row.operation === 'DELETE' &&
		String(row.resourceId) === String(id)
	);
	assert.equal(deleteLog.actorUsername, 'florian');
});
