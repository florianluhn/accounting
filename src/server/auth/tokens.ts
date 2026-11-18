import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import db from '../db/connection.js';
import { apiTokens, sessions, users, type UserRights } from '../db/schema.js';
import { CONFIG } from '../config.js';

export const SESSION_COOKIE = 'acct_session';
export const SESSION_SECONDS = 60 * 60 * 24 * 14;

export interface AuthUser {
	id: number;
	username: string;
	isAdmin: boolean;
	rights: UserRights;
	isActive: boolean;
}

export function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

export function hashesEqual(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	if (left.length !== right.length) return false;
	return timingSafeEqual(left, right);
}

export function newSecret(prefix: string): string {
	return prefix + randomBytes(32).toString('base64url');
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
	const parts = [
		`${SESSION_COOKIE}=${token}`,
		'HttpOnly',
		'Path=/',
		'SameSite=Lax',
		`Max-Age=${maxAgeSeconds}`
	];
	if (CONFIG.COOKIE_SECURE) parts.push('Secure');
	return parts.join('; ');
}

export function clearSessionCookie(): string {
	return sessionCookie('', 0);
}

export function readCookie(header: string | undefined, name: string): string | null {
	if (!header) return null;
	for (const part of header.split(';')) {
		const trimmed = part.trim();
		const eq = trimmed.indexOf('=');
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq);
		if (key === name) return decodeURIComponent(trimmed.slice(eq + 1));
	}
	return null;
}

export function toAuthUser(row: {
	id: number;
	username: string;
	isAdmin: boolean;
	rights: string;
	isActive: boolean;
}): AuthUser {
	const rights: UserRights =
		row.rights === 'add' || row.rights === 'add_edit' || row.rights === 'add_edit_delete'
			? row.rights
			: 'add';
	return {
		id: row.id,
		username: row.username,
		isAdmin: row.isAdmin,
		rights,
		isActive: row.isActive
	};
}

export async function createSession(userId: number): Promise<string> {
	const token = newSecret('');
	const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
	await db.insert(sessions).values({
		tokenHash: sha256(token),
		userId,
		expiresAt
	});
	return token;
}

export async function deleteSession(token: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

async function userById(id: number): Promise<AuthUser | null> {
	const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
	if (rows.length === 0) return null;
	return toAuthUser(rows[0]);
}

export async function userFromSession(token: string): Promise<AuthUser | null> {
	const now = Math.floor(Date.now() / 1000);
	const rows = await db
		.select()
		.from(sessions)
		.where(eq(sessions.tokenHash, sha256(token)))
		.limit(1);
	if (rows.length === 0) return null;
	if (rows[0].expiresAt <= now) {
		await db.delete(sessions).where(eq(sessions.tokenHash, rows[0].tokenHash));
		return null;
	}
	const user = await userById(rows[0].userId);
	if (!user || !user.isActive) return null;
	return user;
}

export async function userFromApiToken(
	token: string
): Promise<{ user: AuthUser; tokenId: number } | null> {
	const rows = await db
		.select()
		.from(apiTokens)
		.where(and(eq(apiTokens.tokenHash, sha256(token)), isNull(apiTokens.revokedAt)))
		.limit(1);
	if (rows.length === 0) return null;
	const user = await userById(rows[0].userId);
	if (!user || !user.isActive) return null;
	await db
		.update(apiTokens)
		.set({ lastUsedAt: new Date() })
		.where(eq(apiTokens.id, rows[0].id));
	return { user, tokenId: rows[0].id };
}

export function bearerToken(header: string | undefined): string | null {
	if (!header) return null;
	const match = header.match(/^Bearer\s+(.+)$/i);
	if (!match) return null;
	const token = match[1].trim();
	return token.length > 0 ? token : null;
}
