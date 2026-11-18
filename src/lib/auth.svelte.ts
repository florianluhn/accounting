export type Rights = 'add' | 'add_edit' | 'add_edit_delete';

export interface SessionUser {
	id: number;
	username: string;
	isAdmin: boolean;
	rights: Rights;
	isActive: boolean;
}

export const auth = $state({
	loaded: false,
	needsBootstrap: false,
	user: null as SessionUser | null
});

export function canEdit(): boolean {
	const user = auth.user;
	if (!user) return false;
	if (user.isAdmin) return true;
	return user.rights === 'add_edit' || user.rights === 'add_edit_delete';
}

export function canDelete(): boolean {
	const user = auth.user;
	if (!user) return false;
	if (user.isAdmin) return true;
	return user.rights === 'add_edit_delete';
}

export async function loadSession(): Promise<void> {
	try {
		const response = await fetch('/api/auth/status', { credentials: 'same-origin' });
		if (!response.ok) {
			auth.user = null;
			auth.needsBootstrap = false;
			return;
		}
		const body = await response.json();
		auth.needsBootstrap = Boolean(body.needsBootstrap);
		auth.user = body.user ?? null;
	} catch {
		auth.user = null;
	} finally {
		auth.loaded = true;
	}
}

export async function logout(): Promise<void> {
	await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
	auth.user = null;
	window.location.assign('/login');
}
