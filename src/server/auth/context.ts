import { AsyncLocalStorage } from 'node:async_hooks';

export interface AuditActor {
	id: number;
	username: string;
}

export interface AuthContext {
	actor: AuditActor;
	source: 'Web UI' | 'API';
}

const storage = new AsyncLocalStorage<AuthContext>();

/** Bind the acting user for the rest of this request. */
export function enterAuthContext(ctx: AuthContext): void {
	storage.enterWith(ctx);
}

export function runWithAuthContext<T>(ctx: AuthContext, fn: () => T): T {
	return storage.run(ctx, fn);
}

export function currentAuthContext(): AuthContext | undefined {
	return storage.getStore();
}
