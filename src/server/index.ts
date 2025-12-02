import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { CONFIG } from './config.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create Fastify instance
const fastify = Fastify({
	logger: {
		level: CONFIG.NODE_ENV === 'development' ? 'info' : 'warn'
	},
	bodyLimit: CONFIG.MAX_FILE_SIZE_BYTES
});

// ========================================
// Plugins
// ========================================

// CORS - Allow requests from SvelteKit dev server and production deployment
await fastify.register(cors, {
	origin: CONFIG.NODE_ENV === 'development'
		? 'http://localhost:5173'
		: (origin, callback) => {
			// In production, allow requests from any origin (frontend can be accessed via different IPs)
			callback(null, true);
		},
	credentials: true
});

// Multipart for file uploads
await fastify.register(multipart, {
	limits: {
		fileSize: CONFIG.MAX_FILE_SIZE_BYTES
	}
});

// Static file serving for attachments
await fastify.register(fastifyStatic, {
	root: join(process.cwd(), CONFIG.ATTACHMENTS_PATH),
	prefix: '/uploads/',
	decorateReply: false
});

// ========================================
// Routes
// ========================================

// Health check
fastify.get('/api/health', async () => {
	return {
		status: 'ok',
		timestamp: new Date().toISOString(),
		version: '0.1.0'
	};
});

// Register route handlers
import currenciesRoutes from './routes/currencies.js';
import glAccountsRoutes from './routes/gl-accounts.js';
import subledgerAccountsRoutes from './routes/subledger-accounts.js';
import journalEntriesRoutes from './routes/journal-entries.js';
import attachmentsRoutes from './routes/attachments.js';
import reportsRoutes from './routes/reports.js';

await fastify.register(currenciesRoutes, { prefix: '/api/currencies' });
await fastify.register(glAccountsRoutes, { prefix: '/api/gl-accounts' });
await fastify.register(subledgerAccountsRoutes, { prefix: '/api/subledger-accounts' });
await fastify.register(journalEntriesRoutes, { prefix: '/api/journal-entries' });
await fastify.register(attachmentsRoutes, { prefix: '/api/attachments' });
await fastify.register(reportsRoutes, { prefix: '/api/reports' });

// ========================================
// Error Handler
// ========================================
fastify.setErrorHandler((error, request, reply) => {
	fastify.log.error(error);

	// Type guard for error object
	const err = error as any;

	// Zod validation errors
	if (err.validation) {
		return reply.status(400).send({
			error: 'Validation Error',
			message: err.message,
			details: err.validation
		});
	}

	// Database errors
	if (err.message && err.message.includes('UNIQUE constraint failed')) {
		return reply.status(409).send({
			error: 'Conflict',
			message: 'A record with this value already exists'
		});
	}

	if (err.message && err.message.includes('FOREIGN KEY constraint failed')) {
		return reply.status(400).send({
			error: 'Bad Request',
			message: 'Referenced record does not exist'
		});
	}

	// File size errors
	if (err.message && err.message.includes('File too large')) {
		return reply.status(413).send({
			error: 'Payload Too Large',
			message: `File size exceeds ${CONFIG.MAX_FILE_SIZE_MB}MB limit`
		});
	}

	// Default error
	const statusCode = err.statusCode || 500;
	reply.status(statusCode).send({
		error: err.name || 'Internal Server Error',
		message: CONFIG.NODE_ENV === 'development' ? (err.message || 'An error occurred') : 'An error occurred'
	});
});

// ========================================
// Start Server
// ========================================
async function start() {
	try {
		await fastify.listen({
			port: CONFIG.PORT,
			host: CONFIG.HOST
		});

		console.log('');
		console.log(`🚀 ${CONFIG.APP_NAME} - API Server`);
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log(`📡 Server running at: http://${CONFIG.HOST}:${CONFIG.PORT}`);
		console.log(`🏠 Local access: http://localhost:${CONFIG.PORT}`);
		console.log(`🌍 Environment: ${CONFIG.NODE_ENV}`);
		console.log(`💾 Database: ${CONFIG.DATABASE_PATH}`);
		console.log(`📁 Attachments: ${CONFIG.ATTACHMENTS_PATH}`);
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('');
	} catch (err) {
		fastify.log.error(err);
		process.exit(1);
	}
}

// Handle graceful shutdown
const signals = ['SIGINT', 'SIGTERM'];
signals.forEach((signal) => {
	process.on(signal, async () => {
		console.log(`\n${signal} received, shutting down gracefully...`);
		await fastify.close();
		process.exit(0);
	});
});

start();
