import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const SCRYPT_KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16).toString('hex');
	const derived = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
	return `scrypt$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const parts = stored.split('$');
	if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
	const salt = parts[1];
	const expectedHex = parts[2];
	const expected = Buffer.from(expectedHex, 'hex');
	if (expected.length !== SCRYPT_KEYLEN) return false;
	const derived = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
	if (derived.length !== expected.length) return false;
	return timingSafeEqual(derived, expected);
}

export function validatePassword(password: string): string | null {
	if (typeof password !== 'string' || password.length < 8) {
		return 'Password must be at least 8 characters';
	}
	if (password.length > 200) {
		return 'Password is too long';
	}
	return null;
}

export function validateUsername(username: string): string | null {
	if (typeof username !== 'string') return 'Username is required';
	const name = username.trim();
	if (!/^[A-Za-z0-9._-]{3,32}$/.test(name)) {
		return 'Username must be 3–32 characters: letters, numbers, dot, underscore, or hyphen';
	}
	return null;
}
