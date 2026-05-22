<script lang="ts">
	import { page } from '$app/stores';
	import {
		fixedAssetsAPI,
		journalEntriesAPI,
		type FixedAsset,
		type DepreciationScheduleEntry,
		type JournalEntry
	} from '$lib/api';

	const fmt = (n: number) =>
		new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

	const fmtLife = (months: number) => {
		const y = Math.floor(months / 12);
		const m = months % 12;
		if (m === 0) return `${y} year${y !== 1 ? 's' : ''}`;
		if (y === 0) return `${m} month${m !== 1 ? 's' : ''}`;
		return `${y} yr${y !== 1 ? 's' : ''} ${m} mo`;
	};

	const conventionLabel: Record<string, string> = {
		half_year: 'Half-Year',
		mid_month: 'Mid-Month',
		mid_quarter: 'Mid-Quarter'
	};

	function todayMonth() {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
	}

	// ── state ──────────────────────────────────────────────────────────────────
	let asset = $state<FixedAsset | null>(null);
	let schedule = $state<DepreciationScheduleEntry[]>([]);
	let entries = $state<JournalEntry[]>([]);
	let loading = $state(true);
	let error = $state('');
	let successMsg = $state('');

	// single-month depreciation modal
	let showDeprModal = $state(false);
	let deprMonth = $state(todayMonth());
	let deprPosting = $state(false);

	// past depreciation modal
	let showPastModal = $state(false);
	let pastThrough = $state(todayMonth());
	let pastPosting = $state(false);
	let pastResult = $state<{ posted: number } | null>(null);

	// ── derived ────────────────────────────────────────────────────────────────
	let assetId = $derived(parseInt($page.params.id, 10));

	let currentMonth = $derived(todayMonth());

	let hasUnpostedPast = $derived(
		!!asset?.activationDate &&
		asset.activationDate.substring(0, 7) < currentMonth &&
		schedule.some(e => !e.posted && e.month < currentMonth)
	);

	let statusBadge = $derived(
		!asset
			? { label: '', cls: '' }
			: !asset.activationDate
				? { label: 'Not Activated', cls: 'badge-ghost' }
				: asset.isFullyDepreciated
					? { label: 'Fully Depreciated', cls: 'badge-warning' }
					: { label: 'Active', cls: 'badge-success' }
	);

	// ── load ───────────────────────────────────────────────────────────────────
	$effect(() => {
		if (!isNaN(assetId)) loadAll();
	});

	async function loadAll() {
		loading = true;
		error = '';
		try {
			const [a, e] = await Promise.all([
				fixedAssetsAPI.get(assetId),
				journalEntriesAPI.list({ fixedAssetId: assetId })
			]);
			asset = a;
			entries = e;
			// Schedule only if activated
			if (a.activationDate) {
				try {
					schedule = await fixedAssetsAPI.getSchedule(assetId);
				} catch {
					schedule = [];
				}
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load asset';
		} finally {
			loading = false;
		}
	}

	// ── single depreciation ───────────────────────────────────────────────────
	function openDeprModal() {
		deprMonth = todayMonth();
		showDeprModal = true;
	}

	async function handleDepreciate() {
		if (!asset) return;
		deprPosting = true;
		try {
			await fixedAssetsAPI.depreciate(assetId, deprMonth);
			showDeprModal = false;
			successMsg = `✓ Depreciation posted for ${deprMonth}`;
			await loadAll();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to post depreciation';
			showDeprModal = false;
		} finally {
			deprPosting = false;
		}
	}

	// ── past depreciation ─────────────────────────────────────────────────────
	function openPastModal() {
		pastThrough = todayMonth();
		pastResult = null;
		showPastModal = true;
	}

	async function handleDepreciatePast() {
		if (!asset) return;
		pastPosting = true;
		try {
			const res = await fixedAssetsAPI.depreciatePast(assetId, pastThrough);
			pastResult = { posted: res.posted };
			await loadAll();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to post past depreciation';
			showPastModal = false;
		} finally {
			pastPosting = false;
		}
	}
</script>

<svelte:head>
	<title>{asset?.name ?? 'Fixed Asset'} – Fixed Assets</title>
</svelte:head>

<div class="max-w-7xl mx-auto">
	<!-- Breadcrumb -->
	<div class="text-sm breadcrumbs mb-4">
		<ul>
			<li><a href="/assets" class="link link-hover text-base-content/60">Fixed Assets</a></li>
			<li>{asset?.name ?? '…'}</li>
		</ul>
	</div>

	{#if error}
		<div class="alert alert-error mb-4">
			<span>{error}</span>
			<button class="btn btn-xs btn-ghost ml-auto" onclick={() => error = ''}>✕</button>
		</div>
	{/if}

	{#if successMsg}
		<div class="alert alert-success mb-4">
			<span>{successMsg}</span>
			<button class="btn btn-xs btn-ghost ml-auto" onclick={() => successMsg = ''}>✕</button>
		</div>
	{/if}

	{#if loading}
		<div class="flex justify-center py-20">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if asset}
		<!-- Header -->
		<div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
			<div>
				<div class="flex items-center gap-3 flex-wrap">
					<h1 class="text-3xl font-bold">{asset.name}</h1>
					<span class="badge {statusBadge.cls}">{statusBadge.label}</span>
				</div>
				{#if asset.description}
					<p class="text-base-content/60 mt-1">{asset.description}</p>
				{/if}
			</div>
			<div class="flex gap-2 flex-shrink-0 flex-wrap">
				{#if asset.activationDate && !asset.isFullyDepreciated}
					<button class="btn btn-outline btn-sm" onclick={openDeprModal}>
						📅 Post Depreciation
					</button>
				{/if}
				{#if hasUnpostedPast}
					<button class="btn btn-warning btn-outline btn-sm" onclick={openPastModal}>
						⏪ Post All Past
					</button>
				{/if}
				<a href="/assets" class="btn btn-ghost btn-sm">← Back</a>
			</div>
		</div>

		<!-- Info Cards -->
		<div class="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
			<div class="stat bg-base-100 shadow rounded-xl p-4">
				<div class="stat-title text-xs">Initial Value</div>
				<div class="stat-value text-xl text-primary">{fmt(asset.initialValue)}</div>
				<div class="stat-desc">from linked journal entries</div>
			</div>
			<div class="stat bg-base-100 shadow rounded-xl p-4">
				<div class="stat-title text-xs">Accumulated Depreciation</div>
				<div class="stat-value text-xl text-warning">{fmt(asset.accumulatedDepreciation)}</div>
				{#if asset.lastDepreciationDate}
					<div class="stat-desc">last: {new Date(asset.lastDepreciationDate).toLocaleDateString()}</div>
				{/if}
			</div>
			<div class="stat bg-base-100 shadow rounded-xl p-4">
				<div class="stat-title text-xs">Net Book Value</div>
				<div class="stat-value text-xl text-success">{fmt(asset.remainingValue)}</div>
				<div class="stat-desc">Salvage: {fmt(asset.salvageValue)}</div>
			</div>
			<div class="stat bg-base-100 shadow rounded-xl p-4">
				<div class="stat-title text-xs">Method</div>
				<div class="stat-value text-lg">{asset.depreciationMethod}</div>
				<div class="stat-desc">{conventionLabel[asset.convention]} convention</div>
			</div>
			<div class="stat bg-base-100 shadow rounded-xl p-4">
				<div class="stat-title text-xs">Useful Life</div>
				<div class="stat-value text-lg">{fmtLife(asset.usefulLifeMonths)}</div>
			</div>
			<div class="stat bg-base-100 shadow rounded-xl p-4">
				<div class="stat-title text-xs">Activation Date</div>
				<div class="stat-value text-lg">{asset.activationDate ?? '—'}</div>
				{#if !asset.activationDate}
					<div class="stat-desc text-warning">Not yet activated</div>
				{/if}
			</div>
			<div class="stat bg-base-100 shadow rounded-xl p-4">
				<div class="stat-title text-xs">Asset Account</div>
				<div class="stat-value text-sm font-semibold truncate">{asset.assetAccountName}</div>
			</div>
			<div class="stat bg-base-100 shadow rounded-xl p-4">
				<div class="stat-title text-xs">Expense Account</div>
				<div class="stat-value text-sm font-semibold truncate">{asset.expenseAccountName}</div>
			</div>
		</div>

		<!-- Depreciation Schedule -->
		{#if schedule.length > 0}
			<div class="card bg-base-100 shadow-xl mb-6">
				<div class="card-body">
					<div class="flex items-center gap-3 mb-4">
						<h2 class="card-title">Depreciation Schedule</h2>
						<span class="badge badge-outline">{schedule.length} months</span>
						<span class="badge badge-success badge-outline">{schedule.filter(e => e.posted).length} posted</span>
					</div>
					<div class="overflow-x-auto max-h-96">
						<table class="table table-sm table-zebra w-full">
							<thead class="sticky top-0 bg-base-200">
								<tr>
									<th>Month</th>
									<th class="text-right">Monthly Amount</th>
									<th class="text-right">Accumulated</th>
									<th class="text-right">Remaining Value</th>
									<th class="text-center">Status</th>
								</tr>
							</thead>
							<tbody>
								{#each schedule as entry}
									<tr class={entry.month === currentMonth ? 'bg-primary/5 font-semibold' : ''}>
										<td class="font-mono text-sm">
											{entry.month}
											{#if entry.month === currentMonth}
												<span class="badge badge-xs badge-primary ml-1">current</span>
											{/if}
										</td>
										<td class="text-right font-mono text-sm">{fmt(entry.monthlyAmount)}</td>
										<td class="text-right font-mono text-sm text-warning">{fmt(entry.accumulatedAmount)}</td>
										<td class="text-right font-mono text-sm text-success">{fmt(entry.remainingValue)}</td>
										<td class="text-center">
											{#if entry.posted}
												<span class="text-success text-sm font-semibold">✓ Posted</span>
											{:else}
												<span class="text-base-content/30 text-sm">Pending</span>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		{:else if asset.activationDate}
			<div class="alert alert-info mb-6">
				<span>No depreciation schedule available. The asset may have $0 initial value (no linked journal entries yet).</span>
			</div>
		{:else}
			<div class="alert alert-warning mb-6">
				<span>Set an activation date to generate the depreciation schedule.</span>
			</div>
		{/if}

		<!-- Linked Journal Entries -->
		<div class="card bg-base-100 shadow-xl">
			<div class="card-body">
				<div class="flex items-center gap-3 mb-4">
					<h2 class="card-title">Journal Entries</h2>
					<span class="badge badge-outline">{entries.length}</span>
				</div>
				{#if entries.length === 0}
					<div class="text-base-content/40 text-sm py-4 text-center">
						No journal entries linked to this asset yet. When creating a journal entry, link it to this asset to track its cost basis.
					</div>
				{:else}
					<div class="overflow-x-auto">
						<table class="table table-sm table-zebra w-full">
							<thead>
								<tr>
									<th>Date</th>
									<th>Description</th>
									<th>Debit Acct</th>
									<th>Credit Acct</th>
									<th class="text-right">Amount</th>
									<th>Type</th>
								</tr>
							</thead>
							<tbody>
								{#each entries as entry}
									<tr>
										<td class="text-sm">{new Date(entry.entryDate).toLocaleDateString()}</td>
										<td class="text-sm max-w-xs truncate">{entry.description}</td>
										<td class="text-xs text-base-content/60">{entry.debitAccountId}</td>
										<td class="text-xs text-base-content/60">{entry.creditAccountId}</td>
										<td class="text-right font-mono text-sm">{fmt(entry.amountInUSD)}</td>
										<td>
											{#if entry.isDepreciation}
												<span class="badge badge-warning badge-xs">Depreciation</span>
											{:else}
												<span class="badge badge-info badge-xs">Capitalization</span>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
		</div>
	{:else}
		<div class="alert alert-error">Asset not found.</div>
	{/if}
</div>

<!-- Single-Month Depreciation Modal -->
{#if showDeprModal}
	<div class="modal modal-open">
		<div class="modal-box max-w-sm">
			<h3 class="font-bold text-lg mb-4">Post Depreciation</h3>
			<p class="text-sm text-base-content/60 mb-4">Asset: <span class="font-semibold">{asset?.name}</span></p>
			<div class="form-control mb-4">
				<label class="label" for="depr-month"><span class="label-text">Month</span></label>
				<input id="depr-month" type="month" class="input input-bordered" bind:value={deprMonth} />
			</div>
			<div class="modal-action">
				<button class="btn btn-ghost" onclick={() => showDeprModal = false} disabled={deprPosting}>Cancel</button>
				<button class="btn btn-primary" onclick={handleDepreciate} disabled={deprPosting}>
					{#if deprPosting}<span class="loading loading-spinner loading-xs"></span>{/if}
					Post
				</button>
			</div>
		</div>
		<div class="modal-backdrop" role="presentation" onclick={() => { if (!deprPosting) showDeprModal = false; }}></div>
	</div>
{/if}

<!-- Past Depreciation Modal -->
{#if showPastModal}
	<div class="modal modal-open">
		<div class="modal-box max-w-sm">
			<h3 class="font-bold text-lg mb-4">⏪ Post All Past Depreciation</h3>
			{#if pastResult}
				<div class="alert alert-success mb-4">
					<span>✓ Posted {pastResult.posted} depreciation entr{pastResult.posted === 1 ? 'y' : 'ies'}</span>
				</div>
				<div class="modal-action">
					<button class="btn btn-primary" onclick={() => { showPastModal = false; pastResult = null; }}>Done</button>
				</div>
			{:else}
				<p class="text-sm text-base-content/60 mb-4">
					This will post one journal entry per unposted month from the activation date through the selected month.
				</p>
				<div class="form-control mb-4">
					<label class="label" for="past-through"><span class="label-text">Through Month</span></label>
					<input id="past-through" type="month" class="input input-bordered" bind:value={pastThrough} />
				</div>
				<div class="modal-action">
					<button class="btn btn-ghost" onclick={() => showPastModal = false} disabled={pastPosting}>Cancel</button>
					<button class="btn btn-warning" onclick={handleDepreciatePast} disabled={pastPosting}>
						{#if pastPosting}<span class="loading loading-spinner loading-xs"></span>{/if}
						Post All Past
					</button>
				</div>
			{/if}
		</div>
		<div class="modal-backdrop" role="presentation" onclick={() => { if (!pastPosting) { showPastModal = false; pastResult = null; } }}></div>
	</div>
{/if}
