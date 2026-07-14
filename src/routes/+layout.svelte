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

	type NavItem = {
		href: string;
		label: string;
		module: string | null;
		icon: string;
	};

	const allNavItems: NavItem[] = [
		{ href: '/', label: 'Dashboard', icon: 'dashboard', module: null },
		{ href: '/accounts', label: 'Accounts', icon: 'accounts', module: null },
		{ href: '/journals', label: 'Journals', icon: 'journals', module: null },
		{ href: '/vendors', label: 'Vendors', icon: 'vendors', module: 'vendors' },
		{ href: '/customers', label: 'Customers', icon: 'customers', module: 'customers' },
		{ href: '/inventory', label: 'Inventory', icon: 'inventory', module: 'inventory' },
		{ href: '/assets', label: 'Fixed Assets', icon: 'assets', module: 'fixedAssets' },
		{ href: '/timetracking', label: 'Time Tracking', icon: 'time', module: 'timeTracking' },
		{ href: '/bookings', label: 'Bookings', icon: 'bookings', module: 'bookings' },
		{ href: '/budgets', label: 'Budgets', icon: 'budgets', module: 'budgets' },
		{ href: '/reports', label: 'Reports', icon: 'reports', module: null },
		{ href: '/audit', label: 'Audit Trail', icon: 'audit', module: null },
		{ href: '/settings', label: 'Settings', icon: 'settings', module: null }
	];

	let navItems = $derived(
		allNavItems.filter(
			(item) => item.module === null || modules[item.module as keyof typeof modules]
		)
	);

	function isActive(href: string, pathname: string): boolean {
		if (href === '/') return pathname === '/';
		return pathname === href || pathname.startsWith(href + '/');
	}

	let theme = $state<'ledger' | 'ledgerdark'>('ledger');

	$effect(() => {
		if (!browser) return;
		const stored = localStorage.getItem('theme');
		if (stored === 'ledger' || stored === 'ledgerdark') {
			theme = stored;
			document.documentElement.setAttribute('data-theme', stored);
		} else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
			theme = 'ledgerdark';
			document.documentElement.setAttribute('data-theme', 'ledgerdark');
		}
	});

	function toggleTheme() {
		theme = theme === 'ledger' ? 'ledgerdark' : 'ledger';
		document.documentElement.setAttribute('data-theme', theme);
		if (browser) localStorage.setItem('theme', theme);
	}
</script>

<svelte:head>
	<title>{appFullName}</title>
</svelte:head>

<div class="drawer lg:drawer-open">
	<input id="drawer" type="checkbox" class="drawer-toggle" />

	<div class="drawer-content flex flex-col min-h-screen">
		<!-- Top navbar for mobile -->
		<header
			class="navbar sticky top-0 z-50 border-b border-base-300/70 bg-base-100/85 backdrop-blur-xl lg:hidden px-2"
		>
			<div class="flex-none">
				<label for="drawer" class="btn btn-square btn-ghost touch-target" aria-label="Open menu">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
						class="w-5 h-5 stroke-current"
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
			<div class="flex-1 flex items-center gap-2.5">
				<div
					class="w-8 h-8 rounded-xl surface-primary flex items-center justify-center shadow-sm"
				>
					<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 3v18M3 9h18M3 15h18" />
					</svg>
				</div>
				<span class="text-lg font-bold tracking-tight">{appName}</span>
			</div>
			<button class="btn btn-ghost btn-square btn-sm" onclick={toggleTheme} aria-label="Toggle theme">
				{#if theme === 'ledger'}
					<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
						<path stroke-linecap="round" stroke-linejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
					</svg>
				{:else}
					<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364 6.364l-1.414-1.414M7.05 7.05L5.636 5.636m12.728 0l-1.414 1.414M7.05 16.95l-1.414 1.414M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
					</svg>
				{/if}
			</button>
		</header>

		<!-- Page content -->
		<main class="flex-1 p-4 sm:p-6 lg:p-8">
			<slot />
		</main>
	</div>

	<!-- Sidebar -->
	<div class="drawer-side z-40">
		<label for="drawer" class="drawer-overlay"></label>
		<aside class="app-sidebar w-[17rem] min-h-full flex flex-col border-r border-base-300/60">
			<!-- Brand -->
			<div class="px-5 pt-6 pb-5">
				<div class="flex items-center gap-3">
					<div
						class="w-10 h-10 rounded-2xl surface-primary flex items-center justify-center shadow-md shrink-0"
					>
						<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 3v18M3 9h18M3 15h18" />
						</svg>
					</div>
					<div class="min-w-0">
						<h1 class="text-lg font-bold tracking-tight truncate leading-tight">{appName}</h1>
						<p class="text-2xs font-medium text-base-content/45 truncate mt-0.5">{appDescription}</p>
					</div>
				</div>
			</div>

			<div class="px-4 mb-2">
				<div class="h-px bg-gradient-to-r from-transparent via-base-300 to-transparent"></div>
			</div>

			<!-- Navigation -->
			<nav class="flex-1 overflow-y-auto px-3 pb-4 pt-1">
				<p class="section-label px-3 mb-2">Menu</p>
				<ul class="flex flex-col gap-0.5">
					{#each navItems as item}
						{@const active = isActive(item.href, $page.url.pathname)}
						<li>
							<a
								href={item.href}
								class="nav-link touch-target"
								class:nav-link-active={active}
							>
								<span class="nav-icon" class:nav-icon-active={active}>
									{#if item.icon === 'dashboard'}
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10-3a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1v-7z"/></svg>
									{:else if item.icon === 'accounts'}
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>
									{:else if item.icon === 'journals'}
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>
									{:else if item.icon === 'vendors'}
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
									{:else if item.icon === 'customers'}
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
									{:else if item.icon === 'inventory'}
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
									{:else if item.icon === 'assets'}
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2M5 21H3m4-10h.01M9 11h.01M13 11h.01M17 11h.01M7 15h.01M11 15h.01M15 15h.01"/></svg>
									{:else if item.icon === 'time'}
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
									{:else if item.icon === 'bookings'}
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
									{:else if item.icon === 'budgets'}
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
									{:else if item.icon === 'reports'}
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"/></svg>
									{:else if item.icon === 'audit'}
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
									{:else}
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
									{/if}
								</span>
								<span class="truncate">{item.label}</span>
								{#if active}
									<span class="nav-active-dot"></span>
								{/if}
							</a>
						</li>
					{/each}
				</ul>
			</nav>

			<!-- Footer -->
			<div class="p-4 border-t border-base-300/50">
				<div class="flex items-center justify-between gap-2">
					<div class="min-w-0">
						<p class="text-2xs font-semibold text-base-content/55">Double-entry ledger</p>
						<p class="text-2xs text-base-content/35 mt-0.5">v0.1.0</p>
					</div>
					<button
						class="btn btn-ghost btn-sm btn-square hidden lg:inline-flex"
						onclick={toggleTheme}
						aria-label="Toggle theme"
						title="Toggle light / dark"
					>
						{#if theme === 'ledger'}
							<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
								<path stroke-linecap="round" stroke-linejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
							</svg>
						{:else}
							<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364 6.364l-1.414-1.414M7.05 7.05L5.636 5.636m12.728 0l-1.414 1.414M7.05 16.95l-1.414 1.414M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
							</svg>
						{/if}
					</button>
				</div>
			</div>
		</aside>
	</div>
</div>

<style>
	.app-sidebar {
		background: color-mix(in oklab, oklch(var(--b1)) 92%, oklch(var(--b2)));
		backdrop-filter: blur(12px);
	}

	.nav-link {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		border-radius: 0.75rem;
		font-size: 0.875rem;
		font-weight: 500;
		color: color-mix(in oklab, oklch(var(--bc)) 72%, transparent);
		transition:
			background-color 0.15s ease,
			color 0.15s ease,
			box-shadow 0.15s ease;
	}

	.nav-link:hover {
		background: color-mix(in oklab, oklch(var(--b2)) 80%, transparent);
		color: oklch(var(--bc));
	}

	.nav-link-active {
		background: color-mix(in oklab, oklch(var(--p)) 12%, transparent);
		color: oklch(var(--p));
		font-weight: 600;
		box-shadow: inset 0 0 0 1px color-mix(in oklab, oklch(var(--p)) 18%, transparent);
	}

	.nav-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 0.5rem;
		background: color-mix(in oklab, oklch(var(--b2)) 90%, transparent);
		color: color-mix(in oklab, oklch(var(--bc)) 55%, transparent);
		flex-shrink: 0;
		transition:
			background-color 0.15s ease,
			color 0.15s ease;
	}

	.nav-icon :global(svg) {
		width: 1rem;
		height: 1rem;
	}

	.nav-icon-active {
		background: color-mix(in oklab, oklch(var(--p)) 18%, transparent);
		color: oklch(var(--p));
	}

	.nav-active-dot {
		margin-left: auto;
		width: 0.375rem;
		height: 0.375rem;
		border-radius: 9999px;
		background: oklch(var(--p));
		box-shadow: 0 0 0 3px color-mix(in oklab, oklch(var(--p)) 20%, transparent);
		flex-shrink: 0;
	}

	@media (max-width: 1023px) {
		main {
			padding-bottom: env(safe-area-inset-bottom);
		}
	}
</style>
