import type { Handle } from '@sveltejs/kit';

/**
 * SvelteKit server hook to proxy API requests to the backend
 * This allows the frontend to make API calls to /api/* which get forwarded to the backend server
 */
export const handle: Handle = async ({ event, resolve }) => {
	const { request } = event;
	const url = new URL(request.url);

	// Proxy API requests to backend
	if (url.pathname.startsWith('/api/')) {
		// Get backend URL from environment or default to localhost:3000
		const backendPort = process.env.BACKEND_PORT || '3000';
		const backendHost = process.env.BACKEND_HOST || 'localhost';
		const backendUrl = `http://${backendHost}:${backendPort}${url.pathname}${url.search}`;

		// Forward the request to the backend
		const proxiedRequest = new Request(backendUrl, {
			method: request.method,
			headers: request.headers,
			body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.arrayBuffer() : undefined
		});

		try {
			const response = await fetch(proxiedRequest);

			// Return the backend response
			return new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers
			});
		} catch (error) {
			console.error('Proxy error:', error);
			return new Response(JSON.stringify({
				error: 'Backend Unavailable',
				message: 'Failed to connect to backend API server'
			}), {
				status: 503,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}

	// For non-API requests, use the default SvelteKit handler
	return resolve(event);
};
