import { eq } from 'drizzle-orm';
import db, { saveDatabase } from '../src/server/db/connection.js';
import { users } from '../src/server/db/schema.js';
import { hashPassword } from '../src/server/auth/password.js';

const username = (process.env.ADMIN_USERNAME || '').trim();
const password = process.env.ADMIN_PASSWORD || '';
const reset = process.argv.includes('--reset');

if (!username || password.length < 8) {
	console.error('Set ADMIN_USERNAME and ADMIN_PASSWORD (8 or more characters).');
	process.exit(1);
}

const existing = await db.select().from(users).where(eq(users.username, username)).limit(1);
if (existing.length === 0) {
	await db.insert(users).values({
		username,
		passwordHash: await hashPassword(password),
		isAdmin: true,
		rights: 'add_edit_delete',
		isActive: true
	});
	console.log(`Created administrator ${username}`);
} else if (reset) {
	await db
		.update(users)
		.set({
			passwordHash: await hashPassword(password),
			isAdmin: true,
			isActive: true,
			rights: 'add_edit_delete',
			updatedAt: new Date()
		})
		.where(eq(users.id, existing[0].id));
	console.log(`Reset administrator ${username}`);
} else {
	console.error(`${username} already exists. Re-run with --reset to set a new password and keep admin access.`);
	process.exit(1);
}

await saveDatabase();
process.exit(0);
