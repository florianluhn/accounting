import type { Handle } from '@sveltejs/kit';

// Load configuration from environment variables
const APP_CONFIG = {
	APP_NAME: process.env.APP_NAME || 'Accounting App',
	APP_SHORT_NAME: process.env.APP_SHORT_NAME || 'Accounting',
	APP_DESCRIPTION: process.env.APP_DESCRIPTION || 'Personal finance accounting with double-entry bookkeeping',
	API_URL: process.env.API_URL || '',
	BACKEND_PORT: process.env.BACKEND_PORT || '3000',
	FRONTEND_PORT: process.env.FRONTEND_PORT || '5173'
};

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event, {
		transformPageChunk: ({ html }) => {
			// Inject configuration into the HTML
			return html.replace(
				'%sveltekit.head%',
				`<script>window.APP_CONFIG = ${JSON.stringify(APP_CONFIG)};</script>%sveltekit.head%`
			);
		}
	});

	return response;
};
