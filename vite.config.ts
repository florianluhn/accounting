import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
// import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
	resolve: {
		// Kit resolves `#app/paths` with Node's "browser" export condition.
		// Vite 6's client build does not apply that condition, so the client
		// bundle loads the server implementation, which imports hooks.server.ts,
		// and the Kit guard aborts the build. Add the condition for the client only.
		conditions: ['browser']
	},
	ssr: {
		resolve: {
			conditions: ['module', 'node']
		}
	},
	plugins: [
		sveltekit(),
		// Temporarily disabled VitePWA to fix build issues
		// VitePWA({
		// 	registerType: 'autoUpdate',
		// 	manifest: {
		// 		name: 'Accounting App',
		// 		short_name: 'Accounting',
		// 		description: 'Personal finance accounting with double-entry bookkeeping',
		// 		theme_color: '#1f2937',
		// 		background_color: '#ffffff',
		// 		display: 'standalone',
		// 		orientation: 'portrait',
		// 		scope: '/',
		// 		start_url: '/',
		// 		icons: [
		// 			{
		// 				src: '/icon-192.png',
		// 				sizes: '192x192',
		// 				type: 'image/png'
		// 			},
		// 			{
		// 				src: '/icon-512.png',
		// 				sizes: '512x512',
		// 				type: 'image/png'
		// 			},
		// 			{
		// 				src: '/icon-512.png',
		// 				sizes: '512x512',
		// 				type: 'image/png',
		// 				purpose: 'any maskable'
		// 			}
		// 		]
		// 	},
		// 	workbox: {
		// 		globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
		// 		runtimeCaching: [
		// 			{
		// 				urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
		// 				handler: 'CacheFirst',
		// 				options: {
		// 					cacheName: 'google-fonts-cache',
		// 					expiration: {
		// 						maxEntries: 10,
		// 						maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
		// 					},
		// 					cacheableResponse: {
		// 						statuses: [0, 200]
		// 					}
		// 				}
		// 			},
		// 			{
		// 				urlPattern: /^\/api\/.*/i,
		// 				handler: 'NetworkFirst',
		// 				options: {
		// 					cacheName: 'api-cache',
		// 					expiration: {
		// 						maxEntries: 50,
		// 						maxAgeSeconds: 60 * 5 // 5 minutes
		// 					},
		// 					networkTimeoutSeconds: 10
		// 				}
		// 			}
		// 		]
		// 	},
		// 	devOptions: {
		// 		enabled: false
		// 	}
		// })
	],
	server: {
		host: '0.0.0.0',
		port: 5173,
		strictPort: false,
		proxy: {
			'/api': {
				target: 'http://localhost:3000',
				changeOrigin: true,
				secure: false
			}
		}
	}
});
