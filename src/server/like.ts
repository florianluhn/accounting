import { sql, type SQL } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';

/** LIKE pattern that treats % and _ in the user's text as literals. */
export function likeContains(column: AnyColumn, raw: string): SQL {
	const escaped = raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
	return sql`${column} LIKE ${'%' + escaped + '%'} ESCAPE '\\'`;
}
