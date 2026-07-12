// Shared reactive module settings — loaded once at layout level
// Components import { modules } from '$lib/modules.svelte' to read settings

export interface ModuleSettings {
	vendors: boolean;
	customers: boolean;
	inventory: boolean;
	timeTracking: boolean;
	bookings: boolean;
	fixedAssets: boolean;
	budgets: boolean;
}

export const modules = $state<ModuleSettings>({
	vendors: true,
	customers: true,
	inventory: true,
	timeTracking: true,
	bookings: true,
	fixedAssets: true,
	budgets: false
});

export function applyModuleSettings(settings: Partial<ModuleSettings>) {
	if (settings.vendors !== undefined) modules.vendors = settings.vendors;
	if (settings.customers !== undefined) modules.customers = settings.customers;
	if (settings.inventory !== undefined) modules.inventory = settings.inventory;
	if (settings.timeTracking !== undefined) modules.timeTracking = settings.timeTracking;
	if (settings.bookings !== undefined) modules.bookings = settings.bookings;
	if (settings.fixedAssets !== undefined) modules.fixedAssets = settings.fixedAssets;
	if (settings.budgets !== undefined) modules.budgets = settings.budgets;
}
