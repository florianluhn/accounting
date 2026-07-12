<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import type { LayoutData } from './$types';
	import { settingsAPI } from '$lib/api';
	import { modules, applyModuleSettings } from '$lib/modules.svelte';

	let { data }: { data: LayoutData } = $props();

	// Inject app config into window for API client to use
	if (browser) {
		(globalThis as any).APP_CONFIG = data.appConfig;
	}

	// Get app name from server-loaded config
	const appName = data.appConfig.APP_SHORT_NAME || 'Accounting';
	const appFullName = data.appConfig.APP_NAME || 'Accounting App';
	const appDescription = data.appConfig.APP_DESCRIPTION || 'Personal Finance';

	// Load module settings once on app start
	$effect(() => {
		if (browser) {
			settingsAPI.get().then(applyModuleSettings).catch(() => {});
		}
	});

	const allNavItems = [
		{ href: '/', label: 'Dashboard', icon: '📊', module: null },
		{ href: '/accounts', label: 'Accounts', icon: '🏦', module: null },
		{ href: '/journals', label: 'Journals', icon: '📖', module: null },
		{ href: '/vendors', label: 'Vendors', icon: '🏢', module: 'vendors' },
		{ href: '/customers', label: 'Customers', icon: '👥', module: 'customers' },
		{ href: '/inventory', label: 'Inventory', icon: '📦', module: 'inventory' },
		{ href: '/assets', label: 'Fixed Assets', icon: '🏗️', module: 'fixedAssets' },
		{ href: '/timetracking', label: 'Time Tracking', icon: '🕐', module: 'timeTracking' },
		{ href: '/bookings', label: 'Bookings', icon: '🏨', module: 'bookings' },
		{ href: '/budgets', label: 'Budgets', icon: '🎯', module: 'budgets' },
		{ href: '/reports', label: 'Reports', icon: '📈', module: null },
		{ href: '/audit', label: 'Audit Trail', icon: '🔍', module: null },
		{ href: '/settings', label: 'Settings', icon: '⚙️', module: null }
	];

	let navItems = $derived(
		allNavItems.filter(item =>
			item.module === null || modules[item.module as keyof typeof modules]
		)
	);
</script>

<svelte:head>
	<title>{appFullName}</title>
</svelte:head>

<div class="drawer lg:drawer-open">
	<input id="drawer" type="checkbox" class="drawer-toggle" />

	<div class="drawer-content flex flex-col">
		<!-- Top navbar for mobile -->
		<div class="navbar bg-base-100 shadow-md lg:hidden sticky top-0 z-50">
			<div class="flex-none">
				<label for="drawer" class="btn btn-square btn-ghost touch-target">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
						class="inline-block w-6 h-6 stroke-current"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 6h16M4 12h16M4 18h16"
						></path>
					</svg>
				</label>
			</div>
			<div class="flex-1">
				<span class="text-xl font-bold">{appName}</span>
			</div>
		</div>

		<!-- Page content -->
		<main class="flex-1 p-4 lg:p-6">
			<slot />
		</main>
	</div>

	<!-- Sidebar -->
	<div class="drawer-side z-40">
		<label for="drawer" class="drawer-overlay"></label>
		<aside class="bg-base-100 w-64 h-full flex flex-col">
			<!-- Logo/Title -->
			<div class="p-4 border-b border-base-300">
				<h1 class="text-2xl font-bold">💰 {appName}</h1>
				<p class="text-sm text-base-content/70">{appDescription}</p>
			</div>

			<!-- Navigation -->
			<nav class="flex-1 p-4">
				<ul class="menu menu-compact">
					{#each navItems as item}
						<li>
							<a
								href={item.href}
								class="touch-target"
								class:active={$page.url.pathname === item.href}
							>
								<span class="text-xl">{item.icon}</span>
								<span>{item.label}</span>
							</a>
						</li>
					{/each}
				</ul>
			</nav>

			<!-- Footer -->
			<div class="p-4 border-t border-base-300 text-xs text-base-content/50">
				<p>v0.1.0</p>
				<p>Double-Entry Bookkeeping</p>
			</div>
		</aside>
	</div>
</div>

<style>
	/* Mobile bottom nav alternative (hidden by default, can be enabled) */
	@media (max-width: 1023px) {
		main {
			padding-bottom: env(safe-area-inset-bottom);
		}
	}
</style>
