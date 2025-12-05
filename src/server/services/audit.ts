import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { auditLogs } from '../db/schema.js';

// Types for audit operations
export type AuditOperation = 'CREATE' | 'UPDATE' | 'DELETE';
export type ResourceType = 'currency' | 'gl_account' | 'subledger_account' | 'journal_entry' | 'attachment';
export type AuditSource = 'Web UI' | 'CSV Import' | 'API';

interface LogAuditParams {
	operation: AuditOperation;
	resourceType: ResourceType;
	resourceId: string | number;
	source?: AuditSource;
	batchId?: string;
	batchSummary?: string;
	oldData?: any;
	newData?: any;
	description?: string;
}

/**
 * Generate a unique batch ID for grouping related audit entries
 */
export function generateBatchId(): string {
	return uuidv4();
}

/**
 * Sanitize data for JSON storage
 * Handles Date objects and other non-serializable types
 */
function sanitizeData(data: any): any {
	if (data === null || data === undefined) {
		return data;
	}

	if (data instanceof Date) {
		return data.toISOString();
	}

	if (Array.isArray(data)) {
		return data.map(sanitizeData);
	}

	if (typeof data === 'object') {
		const sanitized: any = {};
		for (const key in data) {
			if (Object.prototype.hasOwnProperty.call(data, key)) {
				sanitized[key] = sanitizeData(data[key]);
			}
		}
		return sanitized;
	}

	return data;
}

/**
 * Create a human-readable description of the audit event
 */
function createAuditDescription(
	operation: AuditOperation,
	resourceType: ResourceType,
	resourceId: string | number,
	batchSummary?: string
): string {
	if (batchSummary) {
		return batchSummary;
	}

	const resourceName = resourceType.replace('_', ' ');
	const actionVerb = operation === 'CREATE' ? 'created' : operation === 'UPDATE' ? 'updated' : 'deleted';

	return `${resourceName} ${resourceId} ${actionVerb}`;
}

/**
 * Log an audit entry
 * This function never throws errors - audit failures should not block operations
 */
export async function logAudit(params: LogAuditParams): Promise<void> {
	try {
		const {
			operation,
			resourceType,
			resourceId,
			source = 'Web UI',
			batchId,
			batchSummary,
			oldData,
			newData,
			description
		} = params;

		// Sanitize and serialize data
		const sanitizedOldData = oldData ? sanitizeData(oldData) : null;
		const sanitizedNewData = newData ? sanitizeData(newData) : null;

		const oldDataJson = sanitizedOldData ? JSON.stringify(sanitizedOldData) : null;
		const newDataJson = sanitizedNewData ? JSON.stringify(sanitizedNewData) : null;

		// Create description if not provided
		const finalDescription = description || createAuditDescription(
			operation,
			resourceType,
			resourceId,
			batchSummary
		);

		// Insert audit log
		await db.insert(auditLogs).values({
			operation,
			resourceType,
			resourceId: String(resourceId),
			source,
			batchId: batchId || null,
			batchSummary: batchSummary || null,
			oldData: oldDataJson,
			newData: newDataJson,
			description: finalDescription
		});
	} catch (error) {
		// Log the error but don't throw - audit failures should not block operations
		console.error('[Audit Service] Failed to log audit entry:', error);
	}
}
