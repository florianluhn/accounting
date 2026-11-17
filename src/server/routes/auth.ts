import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import db, { saveDatabase } from '../db/connection.js';
import { users } from '../db/schema.js';
import { hashPassword, validatePassword, validateUsername, verifyPassword } from '../auth/password.js';
import {
	clearSessionCookie,
	createSession,
	deleteSession,
	readCookie,
	sessionCookie,
	SESSION_COOKIE,
	SESSION_SECONDS,
	toAuthUser
} from '../auth/tokens.js';

async function userCount(): Promise<number> {
	const rows = await db.select({ id: users.id }).from(users);
	return rows.length;
}

export default async function authRoutes(fastify: FastifyInstance) {
	fastify.get('/status', async (request) => {
		return {
			needsBootstrap: (await userCount()) === 0,
			user: request.currentUser
		};
	});

	fastify.post<{ Body: { username?: string; password?: string } }>('/bootstrap', async (request, reply) => {
		if ((await userCount()) > 0) {
			return reply.status(409).send({
				error: 'Conflict',
				message: 'An administrator account already exists. Sign in instead.'
			});
		}

		const username = (request.body?.username ?? '').trim();
		const password = request.body?.password ?? '';
		const usernameError = validateUsername(username);
		if (usernameError) {
			return reply.status(400).send({ error: 'Bad Request', message: usernameError });
		}
		const passwordError = validatePassword(password);
		if (passwordError) {
			return reply.status(400).send({ error: 'Bad Request', message: passwordError });
		}

		const created = await db
			.insert(users)
			.values({
				username,
				passwordHash: await hashPassword(password),
				isAdmin: true,
				rights: 'add_edit_delete',
				isActive: true
			})
			.returning();

		const token = await createSession(created[0].id);
		await saveDatabase();
		reply.header('Set-Cookie', sessionCookie(token, SESSION_SECONDS));
		return reply.status(201).send({ user: toAuthUser(created[0]) });
	});

	fastify.post<{ Body: { username?: string; password?: string } }>('/login', async (request, reply) => {
		const username = (request.body?.username ?? '').trim();
		const password = request.body?.password ?? '';
		const rows = await db.select().from(users).where(eq(users.username, username)).limit(1);

		if (rows.length === 0) {
			await verifyPassword(password, 'scrypt$00$00');
			return reply.status(401).send({
				error: 'Unauthorized',
				message: 'Invalid username or password'
			});
		}

		const row = rows[0];
		const ok = await verifyPassword(password, row.passwordHash);
		if (!ok) {
			return reply.status(401).send({
				error: 'Unauthorized',
				message: 'Invalid username or password'
			});
		}
		if (!row.isActive) {
			return reply.status(403).send({
				error: 'Forbidden',
				message: 'This account is deactivated'
			});
		}

		const token = await createSession(row.id);
		await saveDatabase();
		reply.header('Set-Cookie', sessionCookie(token, SESSION_SECONDS));
		return { user: toAuthUser(row) };
	});

	fastify.post('/logout', async (request, reply) => {
		const token = readCookie(request.headers.cookie, SESSION_COOKIE);
		if (token) await deleteSession(token);
		await saveDatabase();
		reply.header('Set-Cookie', clearSessionCookie());
		return { success: true };
	});

	fastify.post<{ Body: { currentPassword?: string; newPassword?: string } }>(
		'/change-password',
		async (request, reply) => {
			if (!request.currentUser) {
				return reply.status(401).send({
					error: 'Unauthorized',
					message: 'Authentication required'
				});
			}
			const currentPassword = request.body?.currentPassword ?? '';
			const newPassword = request.body?.newPassword ?? '';
			const passwordError = validatePassword(newPassword);
			if (passwordError) {
				return reply.status(400).send({ error: 'Bad Request', message: passwordError });
			}
			const rows = await db.select().from(users).where(eq(users.id, request.currentUser.id)).limit(1);
			if (rows.length === 0) {
				return reply.status(401).send({ error: 'Unauthorized', message: 'Authentication required' });
			}
			const ok = await verifyPassword(currentPassword, rows[0].passwordHash);
			if (!ok) {
				return reply.status(400).send({ error: 'Bad Request', message: 'Current password is incorrect' });
			}
			await db
				.update(users)
				.set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
				.where(eq(users.id, rows[0].id));
			await saveDatabase();
			return { success: true };
		}
	);
}
