import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import { CONFIG } from './config.js';
import { pathToFileURL } from 'url';
import { resolve } from 'path';
import { authenticateRequest } from './auth/guard.js';
import { runWithAuthContext } from './auth/context.js';
import currenciesRoutes from './routes/currencies.js';
import glAccountsRoutes from './routes/gl-accounts.js';
import subledgerAccountsRoutes from './routes/subledger-accounts.js';
import journalEntriesRoutes from './routes/journal-entries.js';
import attachmentsRoutes from './routes/attachments.js';
import reportsRoutes from './routes/reports.js';
import vendorsRoutes from './routes/vendors.js';
import customersRoutes from './routes/customers.js';
import inventoryRoutes from './routes/inventory.js';
import timeEntriesRoutes from './routes/time-entries.js';
import auditLogsRoutes from './routes/audit-logs.js';
import backupRoutes from './routes/backup.js';
import settingsRoutes from './routes/settings.js';
import bookingsRoutes from './routes/bookings.js';
import fixedAssetsRoutes from './routes/fixed-assets.js';
import investmentsRoutes from './routes/investments.js';
import budgetsRoutes from './routes/budgets.js';
import financialYearsRoutes from './routes/financial-years.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import appConfigRoutes from './routes/app-config.js';

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
	.split(',')
	.map((origin) => origin.trim())
	.filter(Boolean);

export async function buildServer(): Promise<FastifyInstance> {
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
	origin: (origin, callback) => {
		if (!origin || allowedOrigins.includes(origin)) {
			callback(null, true);
			return;
		}
		callback(null, false);
	},
	credentials: true
});

// Multipart for file uploads
await fastify.register(multipart, {
	limits: {
		fileSize: CONFIG.MAX_FILE_SIZE_BYTES
	}
});

fastify.decorateRequest('currentUser', null);
fastify.decorateRequest('authVia', null);
fastify.addHook('onRequest', (request, reply, done) => {
	authenticateRequest(request, reply)
		.then(() => {
			if (reply.sent || !request.currentUser) {
				done();
				return;
			}
			runWithAuthContext(
				{
					actor: { id: request.currentUser.id, username: request.currentUser.username },
					source: request.authVia === 'token' ? 'API' : 'Web UI'
				},
				() => done()
			);
		})
		.catch((error) => done(error));
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

await fastify.register(currenciesRoutes, { prefix: '/api/currencies' });
await fastify.register(glAccountsRoutes, { prefix: '/api/gl-accounts' });
await fastify.register(subledgerAccountsRoutes, { prefix: '/api/subledger-accounts' });
await fastify.register(journalEntriesRoutes, { prefix: '/api/journal-entries' });
await fastify.register(attachmentsRoutes, { prefix: '/api/attachments' });
await fastify.register(reportsRoutes, { prefix: '/api/reports' });
await fastify.register(vendorsRoutes, { prefix: '/api/vendors' });
await fastify.register(customersRoutes, { prefix: '/api/customers' });
await fastify.register(inventoryRoutes, { prefix: '/api/inventory' });
await fastify.register(timeEntriesRoutes, { prefix: '/api/time-entries' });
await fastify.register(auditLogsRoutes, { prefix: '/api/audit-logs' });
await fastify.register(backupRoutes, { prefix: '/api/backup' });
await fastify.register(settingsRoutes, { prefix: '/api/settings' });
await fastify.register(bookingsRoutes, { prefix: '/api/bookings' });
await fastify.register(fixedAssetsRoutes, { prefix: '/api/fixed-assets' });
await fastify.register(investmentsRoutes, { prefix: '/api/investments' });
await fastify.register(budgetsRoutes, { prefix: '/api/budgets' });
await fastify.register(financialYearsRoutes, { prefix: '/api/financial-years' });
await fastify.register(authRoutes, { prefix: '/api/auth' });
await fastify.register(usersRoutes, { prefix: '/api/users' });
await fastify.register(appConfigRoutes, { prefix: '/api/app-config' });

// ========================================
// Error Handler
// ========================================
fastify.setErrorHandler((error, request, reply) => {
	fastify.log.error(error);

	// Type guard for error object
	const err = error as any;

	if (err.name === 'FormulaError') {
		return reply.status(400).send({
			error: 'Bad Request',
			message: err.message
		});
	}

	if (err instanceof ZodError || err.name === 'ZodError') {
		const issues = err instanceof ZodError ? err.issues : [];
		return reply.status(400).send({
			error: 'Validation Error',
			message: issues[0]?.message || err.message,
			details: issues
		});
	}

	// Fastify schema errors
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

	const statusCode = err.statusCode || 500;
	const safeMessage = statusCode < 500 ? err.message || 'An error occurred' : 'An error occurred';
	reply.status(statusCode).send({
		error: err.name || 'Internal Server Error',
		message: CONFIG.NODE_ENV === 'development' ? err.message || 'An error occurred' : safeMessage
	});
});

	return fastify;
}

// ========================================
// Start Server
// ========================================
import { initializeScheduler, shutdownScheduler } from './services/scheduler.js';

async function start() {
	const fastify = await buildServer();
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

		// Initialize backup scheduler
		initializeScheduler();
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
		shutdownScheduler();
		process.exit(0);
	});
});

const isDirectRun =
	process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
	start();
}
