import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import db from '../db/connection.js';
import { appSettings } from '../db/schema.js';
import { enterAuthContext } from './context.js';
import {
	bearerToken,
	readCookie,
	SESSION_COOKIE,
	userFromApiToken,
	userFromSession,
	type AuthUser
} from './tokens.js';
import type { UserRights } from '../db/schema.js';

export type AuthVia = 'session' | 'token';

declare module 'fastify' {
	interface FastifyRequest {
		currentUser: AuthUser | null;
		authVia: AuthVia | null;
	}
}

const PUBLIC_ROUTES = new Set([
	'GET /api/health',
	'POST /api/auth/login',
	'POST /api/auth/bootstrap',
	'POST /api/auth/logout',
	'GET /api/auth/status'
]);

const MODULE_PREFIXES: Array<[string, string]> = [
	['/api/vendors', 'vendors'],
	['/api/customers', 'customers'],
	['/api/inventory', 'inventory'],
	['/api/time-entries', 'timeTracking'],
	['/api/bookings', 'bookings'],
	['/api/fixed-assets', 'fixedAssets'],
	['/api/investments', 'investments'],
	['/api/budgets', 'budgets']
];

export function can(user: AuthUser, action: 'add' | 'edit' | 'delete'): boolean {
	if (!user.isActive) return false;
	if (user.isAdmin) return true;
	if (action === 'add') return true;
	if (action === 'edit') return user.rights === 'add_edit' || user.rights === 'add_edit_delete';
	return user.rights === 'add_edit_delete';
}

export function rightsIncludes(rights: UserRights, action: 'add' | 'edit' | 'delete'): boolean {
	if (action === 'add') return true;
	if (action === 'edit') return rights === 'add_edit' || rights === 'add_edit_delete';
	return rights === 'add_edit_delete';
}

function moduleForPath(path: string): string | null {
	for (const [prefix, key] of MODULE_PREFIXES) {
		if (path === prefix || path.startsWith(prefix + '/')) return key;
	}
	return null;
}

async function isModuleEnabled(key: string): Promise<boolean> {
	const rows = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
	if (rows.length === 0) return key !== 'budgets';
	return rows[0].value === 'true';
}

function pathOnly(url: string): string {
	const q = url.indexOf('?');
	return q === -1 ? url : url.slice(0, q);
}

export function isPublicRoute(method: string, url: string): boolean {
	return PUBLIC_ROUTES.has(`${method.toUpperCase()} ${pathOnly(url)}`);
}

/** Routes that change configuration or can destroy the books. Admins only. */
export function isAdminRoute(method: string, url: string): boolean {
	const path = pathOnly(url);
	const verb = method.toUpperCase();
	if (path.startsWith('/api/settings')) return true;
	if (path.startsWith('/api/audit-logs')) return true;
	if (path.startsWith('/api/backup')) return true;
	if (path.startsWith('/api/users')) return true;
	if (path === '/api/financial-years/close' || path === '/api/financial-years/open') return true;
	if (path === '/api/journal-entries/delete-all') return true;
	if (path === '/api/bookings/sync-availability') return true;
	if (path === '/api/bookings/config' && verb !== 'GET') return true;
	return false;
}

function requiredAction(method: string, url: string): 'read' | 'add' | 'edit' | 'delete' | 'admin' {
	if (isAdminRoute(method, url)) return 'admin';
	const verb = method.toUpperCase();
	const path = pathOnly(url);
	if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return 'read';
	if (verb === 'PUT' || verb === 'PATCH') return 'edit';
	if (verb === 'DELETE') return 'delete';
	if (verb === 'POST') {
		if (path === '/api/auth/change-password') return 'read';
		if (path === '/api/journal-entries/bulk-update' || path === '/api/journal-entries/bulk-set') {
			return 'edit';
		}
		if (/^\/api\/inventory\/items\/\d+\/own-use$/.test(path)) return 'edit';
		return 'add';
	}
	return 'add';
}

async function resolveRequest(
	request: FastifyRequest
): Promise<{ user: AuthUser; via: AuthVia } | null> {
	const bearer = bearerToken(request.headers.authorization);
	if (bearer) {
		const found = await userFromApiToken(bearer);
		if (found) return { user: found.user, via: 'token' };
		return null;
	}
	const cookie = readCookie(request.headers.cookie, SESSION_COOKIE);
	if (!cookie) return null;
	const user = await userFromSession(cookie);
	if (!user) return null;
	return { user, via: 'session' };
}

function bindUser(request: FastifyRequest, resolved: { user: AuthUser; via: AuthVia } | null) {
	request.currentUser = resolved?.user ?? null;
	request.authVia = resolved?.via ?? null;
	if (resolved?.user) {
		enterAuthContext({
			actor: { id: resolved.user.id, username: resolved.user.username },
			source: resolved.via === 'token' ? 'API' : 'Web UI'
		});
	}
}

const rateBuckets = new Map<string, number[]>();

function allowRequest(ip: string, limit: number): boolean {
	const now = Date.now();
	const recent = (rateBuckets.get(ip) ?? []).filter((stamp) => now - stamp < 60_000);
	if (recent.length >= limit) {
		rateBuckets.set(ip, recent);
		return false;
	}
	recent.push(now);
	rateBuckets.set(ip, recent);
	return true;
}

export async function authenticateRequest(
	request: FastifyRequest,
	reply: FastifyReply
): Promise<void> {
	const ip = request.ip || 'local';
	const limit = request.url.startsWith('/api/auth/login') ? 30 : 300;
	if (!allowRequest(ip, limit)) {
		reply.status(429).send({ error: 'Too Many Requests', message: 'Slow down and try again shortly' });
		return;
	}

	const resolved = await resolveRequest(request);
	bindUser(request, resolved);

	if (isPublicRoute(request.method, request.url)) return;

	if (!resolved || !resolved.user.isActive) {
		reply.status(401).send({
			error: 'Unauthorized',
			message: 'Authentication required'
		});
		return;
	}

	const moduleKey = moduleForPath(pathOnly(request.url));
	if (moduleKey && !(await isModuleEnabled(moduleKey))) {
		reply.status(403).send({
			error: 'Forbidden',
			message: 'That module is turned off in Settings'
		});
		return;
	}

	const action = requiredAction(request.method, request.url);
	if (action === 'admin' && !resolved.user.isAdmin) {
		reply.status(403).send({
			error: 'Forbidden',
			message: 'Admin access required'
		});
		return;
	}
	if (action === 'edit' && !can(resolved.user, 'edit')) {
		reply.status(403).send({
			error: 'Forbidden',
			message: 'Your account can add records but cannot edit them'
		});
		return;
	}
	if (action === 'delete' && !can(resolved.user, 'delete')) {
		reply.status(403).send({
			error: 'Forbidden',
			message: 'Your account cannot delete records'
		});
	}
}
