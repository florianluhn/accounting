// Shared reactive module settings — loaded once at layout level
// Components import { modules } from '$lib/modules.svelte' to read settings

export interface ModuleSettings {
	vendors: boolean;
	customers: boolean;
	inventory: boolean;
	timeTracking: boolean;
}

export const modules = $state<ModuleSettings>({
	vendors: true,
	customers: true,
	inventory: true,
	timeTracking: true
});

export function applyModuleSettings(settings: Partial<ModuleSettings>) {
	if (settings.vendors !== undefined) modules.vendors = settings.vendors;
	if (settings.customers !== undefined) modules.customers = settings.customers;
	if (settings.inventory !== undefined) modules.inventory = settings.inventory;
	if (settings.timeTracking !== undefined) modules.timeTracking = settings.timeTracking;
}
