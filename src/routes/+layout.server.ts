import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => {
	return {
		appConfig: {
			APP_NAME: process.env.APP_NAME || 'Accounting App',
			APP_SHORT_NAME: process.env.APP_SHORT_NAME || 'Accounting',
			APP_DESCRIPTION: process.env.APP_DESCRIPTION || 'Personal finance accounting with double-entry bookkeeping',
			API_URL: process.env.API_URL || '',
			BACKEND_PORT: process.env.BACKEND_PORT || '3000',
			FRONTEND_PORT: process.env.FRONTEND_PORT || '5173'
		}
	};
};
