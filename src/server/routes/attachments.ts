import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import db, { saveDatabase } from '../db/connection.js';
import { attachments, journalEntries, bookings, inventoryItems } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { join } from 'path';
import { mkdir, writeFile, unlink, readFile, stat } from 'fs/promises';
import { randomUUID } from 'crypto';
import { CONFIG } from '../config.js';
import { existsSync } from 'fs';
import { logAudit } from '../services/audit.js';

export default async function attachmentsRoutes(fastify: FastifyInstance) {
	// GET /api/attachments - List all attachments
	fastify.get<{ Querystring: { journalEntryId?: string; bookingId?: string; inventoryItemId?: string } }>(
		'/',
		async (request, reply) => {
			let query = db.select().from(attachments);

			// Filter by journal entry
			if (request.query.journalEntryId) {
				const journalEntryId = parseInt(request.query.journalEntryId);
				if (!isNaN(journalEntryId)) {
					query = query.where(eq(attachments.journalEntryId, journalEntryId)) as any;
				}
			} else if (request.query.bookingId) {
				const bookingId = parseInt(request.query.bookingId);
				if (!isNaN(bookingId)) {
					query = query.where(eq(attachments.bookingId, bookingId)) as any;
				}
			} else if (request.query.inventoryItemId) {
				const inventoryItemId = parseInt(request.query.inventoryItemId);
				if (!isNaN(inventoryItemId)) {
					query = query.where(eq(attachments.inventoryItemId, inventoryItemId)) as any;
				}
			}

			const files = await query;
			return files;
		}
	);

	// GET /api/attachments/:id - Get attachment metadata
	fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);

		if (isNaN(id)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Invalid attachment ID'
			});
		}

		const attachment = await db
			.select()
			.from(attachments)
			.where(eq(attachments.id, id))
			.limit(1);

		if (attachment.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `Attachment ${id} not found`
			});
		}

		return attachment[0];
	});

	// GET /api/attachments/:id/download - Download attachment file
	fastify.get<{ Params: { id: string } }>('/:id/download', async (request, reply) => {
		const id = parseInt(request.params.id);

		if (isNaN(id)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Invalid attachment ID'
			});
		}

		const attachment = await db
			.select()
			.from(attachments)
			.where(eq(attachments.id, id))
			.limit(1);

		if (attachment.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `Attachment ${id} not found`
			});
		}

		const filePath = join(process.cwd(), CONFIG.ATTACHMENTS_PATH, attachment[0].storedFilename);

		if (!existsSync(filePath)) {
			return reply.status(404).send({
				error: 'Not Found',
				message: 'File not found on disk'
			});
		}

		try {
			const fileBuffer = await readFile(filePath);

			reply
				.type(attachment[0].mimeType)
				.header('Content-Disposition', `attachment; filename="${attachment[0].filename}"`)
				.send(fileBuffer);
		} catch (error) {
			return reply.status(500).send({
				error: 'Internal Server Error',
				message: 'Failed to read file'
			});
		}
	});

	// POST /api/attachments - Upload attachment
	fastify.post<{ Querystring: { journalEntryId?: string; bookingId?: string; inventoryItemId?: string } }>(
		'/',
		async (request, reply) => {
			const journalEntryId = request.query.journalEntryId
				? parseInt(request.query.journalEntryId)
				: null;
			const bookingId = request.query.bookingId ? parseInt(request.query.bookingId) : null;
			const inventoryItemId = request.query.inventoryItemId ? parseInt(request.query.inventoryItemId) : null;

			if (!journalEntryId && !bookingId && !inventoryItemId) {
				return reply.status(400).send({
					error: 'Bad Request',
					message: 'Either journalEntryId, bookingId, or inventoryItemId must be provided'
				});
			}
			const providedCount = [journalEntryId, bookingId, inventoryItemId].filter(id => id !== null).length;
			if (providedCount > 1) {
				return reply.status(400).send({
					error: 'Bad Request',
					message: 'Provide only one of journalEntryId, bookingId, or inventoryItemId'
				});
			}

			let ownerPrefix: string;
			if (journalEntryId) {
				if (isNaN(journalEntryId)) {
					return reply.status(400).send({
						error: 'Bad Request',
						message: 'Invalid journal entry ID'
					});
				}
				const journalEntry = await db
					.select()
					.from(journalEntries)
					.where(eq(journalEntries.id, journalEntryId))
					.limit(1);
				if (journalEntry.length === 0) {
					return reply.status(404).send({
						error: 'Not Found',
						message: `Journal entry ${journalEntryId} not found`
					});
				}
				ownerPrefix = `j${journalEntryId}`;
			} else if (bookingId) {
				if (isNaN(bookingId)) {
					return reply.status(400).send({
						error: 'Bad Request',
						message: 'Invalid booking ID'
					});
				}
				const booking = await db
					.select()
					.from(bookings)
					.where(eq(bookings.id, bookingId))
					.limit(1);
				if (booking.length === 0) {
					return reply.status(404).send({
						error: 'Not Found',
						message: `Booking ${bookingId} not found`
					});
				}
				ownerPrefix = `b${bookingId}`;
			} else {
				if (isNaN(inventoryItemId!)) {
					return reply.status(400).send({
						error: 'Bad Request',
						message: 'Invalid inventory item ID'
					});
				}
				const inventoryItem = await db
					.select()
					.from(inventoryItems)
					.where(eq(inventoryItems.id, inventoryItemId!))
					.limit(1);
				if (inventoryItem.length === 0) {
					return reply.status(404).send({
						error: 'Not Found',
						message: `Inventory item ${inventoryItemId} not found`
					});
				}
				ownerPrefix = `i${inventoryItemId}`;
			}

			// Get uploaded file
			const data = await request.file();

			if (!data) {
				return reply.status(400).send({
					error: 'Bad Request',
					message: 'No file uploaded'
				});
			}

			const buffer = await data.toBuffer();
			const fileSize = buffer.length;

			if (fileSize > CONFIG.MAX_FILE_SIZE_BYTES) {
				return reply.status(413).send({
					error: 'Payload Too Large',
					message: `File size exceeds ${CONFIG.MAX_FILE_SIZE_MB}MB limit`
				});
			}

			// Generate storage path: data/attachments/{year}/{month}/{ownerPrefix}_{uuid}.{ext}
			const uploadDate = new Date();
			const year = uploadDate.getFullYear();
			const month = String(uploadDate.getMonth() + 1).padStart(2, '0');
			const uuid = randomUUID();

			// Extract file extension
			const originalFilename = data.filename;
			const ext = originalFilename.split('.').pop() || 'bin';
			const storedFilename = `${year}/${month}/${ownerPrefix}_${uuid}.${ext}`;

			// Create directory structure
			const dirPath = join(process.cwd(), CONFIG.ATTACHMENTS_PATH, year.toString(), month);
			await mkdir(dirPath, { recursive: true });

			// Write file to disk
			const filePath = join(process.cwd(), CONFIG.ATTACHMENTS_PATH, storedFilename);
			await writeFile(filePath, buffer);

			// Insert attachment record
			const newAttachment = await db
				.insert(attachments)
				.values({
					journalEntryId,
					bookingId,
					inventoryItemId,
					filename: originalFilename,
					storedFilename,
					mimeType: data.mimetype,
					fileSize
				})
				.returning();

			// Log audit entry
			await logAudit({
				operation: 'CREATE',
				resourceType: 'attachment',
				resourceId: newAttachment[0].id,
				source: 'Web UI',
				newData: newAttachment[0]
			});

			// Save database
			await saveDatabase();

			return reply.status(201).send(newAttachment[0]);
		}
	);

	// DELETE /api/attachments/:id - Delete attachment
	fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
		const id = parseInt(request.params.id);

		if (isNaN(id)) {
			return reply.status(400).send({
				error: 'Bad Request',
				message: 'Invalid attachment ID'
			});
		}

		// Check if attachment exists
		const attachment = await db
			.select()
			.from(attachments)
			.where(eq(attachments.id, id))
			.limit(1);

		if (attachment.length === 0) {
			return reply.status(404).send({
				error: 'Not Found',
				message: `Attachment ${id} not found`
			});
		}

		// Delete file from disk
		const filePath = join(process.cwd(), CONFIG.ATTACHMENTS_PATH, attachment[0].storedFilename);

		try {
			if (existsSync(filePath)) {
				await unlink(filePath);
			}
		} catch (error) {
			// Log error but continue with database deletion
			fastify.log.warn(`Failed to delete file: ${filePath}`);
		}

		// Delete attachment record
		await db.delete(attachments).where(eq(attachments.id, id));

		// Log audit entry
		await logAudit({
			operation: 'DELETE',
			resourceType: 'attachment',
			resourceId: id,
			source: 'Web UI',
			oldData: attachment[0]
		});

		// Save database
		await saveDatabase();

		return reply.status(204).send();
	});
}
