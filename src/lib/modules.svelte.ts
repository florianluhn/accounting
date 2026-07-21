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
	/** Check / reference numbers on journal entries for matching related postings */
	checkReferences: boolean;
}

export const modules = $state<ModuleSettings>({
	vendors: true,
	customers: true,
	inventory: true,
	timeTracking: true,
	bookings: true,
	fixedAssets: true,
	budgets: false,
	checkReferences: false
});

/** Shared branding state so Settings and the layout shell stay in sync. */
export const branding = $state({
	hasLogo: false,
	/** Bump to force <img> reload after upload/delete */
	logoVersion: 0
});

/** App-wide financial year (1 = January … 12 = December). Default calendar year. */
export const financialYear = $state({
	startMonth: 1
});

export function applyModuleSettings(
	settings: Partial<ModuleSettings> & {
		hasLogo?: boolean;
		financialYearStartMonth?: number;
	}
) {
	if (settings.vendors !== undefined) modules.vendors = settings.vendors;
	if (settings.customers !== undefined) modules.customers = settings.customers;
	if (settings.inventory !== undefined) modules.inventory = settings.inventory;
	if (settings.timeTracking !== undefined) modules.timeTracking = settings.timeTracking;
	if (settings.bookings !== undefined) modules.bookings = settings.bookings;
	if (settings.fixedAssets !== undefined) modules.fixedAssets = settings.fixedAssets;
	if (settings.budgets !== undefined) modules.budgets = settings.budgets;
	if (settings.checkReferences !== undefined) modules.checkReferences = settings.checkReferences;
	if (settings.hasLogo !== undefined) branding.hasLogo = settings.hasLogo;
	if (settings.financialYearStartMonth !== undefined) {
		const m = Math.round(Number(settings.financialYearStartMonth));
		financialYear.startMonth = Number.isFinite(m) && m >= 1 && m <= 12 ? m : 1;
	}
}

export function setAppLogo(hasLogo: boolean) {
	branding.hasLogo = hasLogo;
	branding.logoVersion += 1;
}
