import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import db, { saveDatabase } from '../db/connection.js';
import { apiTokens, users, USER_RIGHTS, type UserRights } from '../db/schema.js';
import { hashPassword, validatePassword, validateUsername } from '../auth/password.js';
import { newSecret, sha256, toAuthUser } from '../auth/tokens.js';
import { logAudit } from '../services/audit.js';

function parseRights(value: unknown): UserRights | null {
	if (value === 'add' || value === 'add_edit' || value === 'add_edit_delete') return value;
	return null;
}

async function activeAdminCount(): Promise<number> {
	const rows = await db
		.select({ id: users.id })
		.from(users)
		.where(and(eq(users.isAdmin, true), eq(users.isActive, true)));
	return rows.length;
}

export default async function usersRoutes(fastify: FastifyInstance) {
	fastify.get('/', async () => {
		const rows = await db.select().from(users);
		return rows
			.map((row) => toAuthUser(row))
			.sort((a, b) => a.username.localeCompare(b.username));
	});

	fastify.post<{
		Body: { username?: string; password?: string; isAdmin?: boolean; rights?: string };
	}>('/', async (request, reply) => {
		const username = (request.body?.username ?? '').trim();
		const password = request.body?.password ?? '';
		const usernameError = validateUsername(username);
		if (usernameError) return reply.status(400).send({ error: 'Bad Request', message: usernameError });
		const passwordError = validatePassword(password);
		if (passwordError) return reply.status(400).send({ error: 'Bad Request', message: passwordError });

		const isAdmin = request.body?.isAdmin === true;
		const rights = parseRights(request.body?.rights) ?? 'add_edit_delete';
		if (request.body?.rights !== undefined && !parseRights(request.body.rights)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: `rights must be one of: ${USER_RIGHTS.join(', ')}`
			});
		}

		try {
			const created = await db
				.insert(users)
				.values({
					username,
					passwordHash: await hashPassword(password),
					isAdmin,
					rights,
					isActive: true
				})
				.returning();
			const user = toAuthUser(created[0]);
			await logAudit({
				operation: 'CREATE',
				resourceType: 'user',
				resourceId: user.id,
				newData: user,
				description: `User ${user.username} created`
			});
			await saveDatabase();
			return reply.status(201).send(user);
		} catch (error) {
			const message = error instanceof Error ? error.message : '';
			if (message.includes('UNIQUE')) {
				return reply.status(409).send({ error: 'Conflict', message: 'That username is already taken' });
			}
			throw error;
		}
	});

	fastify.put<{
		Params: { id: string };
		Body: {
			username?: string;
			password?: string;
			isAdmin?: boolean;
			rights?: string;
			isActive?: boolean;
		};
	}>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id, 10);
		if (!Number.isInteger(id)) {
			return reply.status(400).send({ error: 'Bad Request', message: 'Invalid user id' });
		}
		const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
		if (rows.length === 0) {
			return reply.status(404).send({ error: 'Not Found', message: 'User not found' });
		}
		const current = rows[0];
		const body = request.body ?? {};

		let username = current.username;
		if (body.username !== undefined) {
			username = body.username.trim();
			const usernameError = validateUsername(username);
			if (usernameError) return reply.status(400).send({ error: 'Bad Request', message: usernameError });
		}

		let passwordHash = current.passwordHash;
		if (body.password !== undefined && body.password !== '') {
			const passwordError = validatePassword(body.password);
			if (passwordError) return reply.status(400).send({ error: 'Bad Request', message: passwordError });
			passwordHash = await hashPassword(body.password);
		}

		let rights = current.rights as UserRights;
		if (body.rights !== undefined) {
			const parsed = parseRights(body.rights);
			if (!parsed) {
				return reply.status(400).send({
					error: 'Bad Request',
					message: `rights must be one of: ${USER_RIGHTS.join(', ')}`
				});
			}
			rights = parsed;
		}

		const isAdmin = body.isAdmin !== undefined ? body.isAdmin === true : current.isAdmin;
		const isActive = body.isActive !== undefined ? body.isActive === true : current.isActive;

		const wasActiveAdmin = current.isAdmin && current.isActive;
		const staysActiveAdmin = isAdmin && isActive;
		if (wasActiveAdmin && !staysActiveAdmin) {
			const admins = await activeAdminCount();
			if (admins <= 1) {
				return reply.status(409).send({
					error: 'Conflict',
					message: 'Cannot remove or deactivate the last administrator'
				});
			}
		}

		try {
			const updated = await db
				.update(users)
				.set({
					username,
					passwordHash,
					isAdmin,
					rights,
					isActive,
					updatedAt: new Date()
				})
				.where(eq(users.id, id))
				.returning();
			const before = toAuthUser(current);
			const after = toAuthUser(updated[0]);
			await logAudit({
				operation: 'UPDATE',
				resourceType: 'user',
				resourceId: id,
				oldData: before,
				newData: { ...after, passwordChanged: passwordHash !== current.passwordHash },
				description: `User ${before.username} updated`
			});
			await saveDatabase();
			return after;
		} catch (error) {
			const message = error instanceof Error ? error.message : '';
			if (message.includes('UNIQUE')) {
				return reply.status(409).send({ error: 'Conflict', message: 'That username is already taken' });
			}
			throw error;
		}
	});

	fastify.get<{ Params: { id: string } }>('/:id/tokens', async (request, reply) => {
		const id = parseInt(request.params.id, 10);
		if (!Number.isInteger(id)) {
			return reply.status(400).send({ error: 'Bad Request', message: 'Invalid user id' });
		}
		const owner = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
		if (owner.length === 0) {
			return reply.status(404).send({ error: 'Not Found', message: 'User not found' });
		}
		const rows = await db.select().from(apiTokens).where(eq(apiTokens.userId, id));
		return rows
			.map((row) => ({
				id: row.id,
				name: row.name,
				tokenPrefix: row.tokenPrefix,
				createdAt: row.createdAt,
				lastUsedAt: row.lastUsedAt,
				revokedAt: row.revokedAt
			}))
			.sort((a, b) => b.id - a.id);
	});

	fastify.post<{ Params: { id: string }; Body: { name?: string } }>(
		'/:id/tokens',
		async (request, reply) => {
			const id = parseInt(request.params.id, 10);
			if (!Number.isInteger(id)) {
				return reply.status(400).send({ error: 'Bad Request', message: 'Invalid user id' });
			}
			const owner = await db.select().from(users).where(eq(users.id, id)).limit(1);
			if (owner.length === 0) {
				return reply.status(404).send({ error: 'Not Found', message: 'User not found' });
			}
			const name = (request.body?.name ?? '').trim();
			if (name.length < 1 || name.length > 80) {
				return reply.status(400).send({
					error: 'Bad Request',
					message: 'Token name is required (max 80 characters)'
				});
			}
			const token = newSecret('acct_');
			const inserted = await db
				.insert(apiTokens)
				.values({
					userId: id,
					name,
					tokenHash: sha256(token),
					tokenPrefix: token.slice(0, 12)
				})
				.returning();
			await logAudit({
				operation: 'CREATE',
				resourceType: 'api_token',
				resourceId: inserted[0].id,
				newData: { id: inserted[0].id, name, userId: id, username: owner[0].username },
				description: `API token "${name}" created for ${owner[0].username}`
			});
			await saveDatabase();
			return reply.status(201).send({
				id: inserted[0].id,
				name,
				tokenPrefix: inserted[0].tokenPrefix,
				token,
				createdAt: inserted[0].createdAt
			});
		}
	);

	fastify.delete<{ Params: { id: string; tokenId: string } }>(
		'/:id/tokens/:tokenId',
		async (request, reply) => {
			const id = parseInt(request.params.id, 10);
			const tokenId = parseInt(request.params.tokenId, 10);
			if (!Number.isInteger(id) || !Number.isInteger(tokenId)) {
				return reply.status(400).send({ error: 'Bad Request', message: 'Invalid id' });
			}
			const rows = await db
				.select()
				.from(apiTokens)
				.where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, id)))
				.limit(1);
			if (rows.length === 0) {
				return reply.status(404).send({ error: 'Not Found', message: 'Token not found' });
			}
			if (rows[0].revokedAt) {
				return { id: tokenId, revoked: true };
			}
			await db
				.update(apiTokens)
				.set({ revokedAt: new Date() })
				.where(and(eq(apiTokens.id, tokenId), isNull(apiTokens.revokedAt)));
			await logAudit({
				operation: 'DELETE',
				resourceType: 'api_token',
				resourceId: tokenId,
				oldData: { id: tokenId, name: rows[0].name, userId: id },
				description: `API token "${rows[0].name}" revoked`
			});
			await saveDatabase();
			return { id: tokenId, revoked: true };
		}
	);
}
