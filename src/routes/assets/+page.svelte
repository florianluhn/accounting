<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		fixedAssetsAPI,
		glAccountsAPI,
		subledgerAccountsAPI,
		type FixedAsset,
		type GLAccount,
		type SubledgerAccount,
		type CreateFixedAssetPayload
	} from '$lib/api';

	const fmt = (n: number) =>
		new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

	const fmtLife = (months: number) => {
		const y = Math.floor(months / 12);
		const m = months % 12;
		if (m === 0) return `${y} yr${y !== 1 ? 's' : ''}`;
		if (y === 0) return `${m} mo`;
		return `${y} yr${y !== 1 ? 's' : ''} ${m} mo`;
	};

	const conventionLabel: Record<string, string> = {
		half_year: 'Half-Year',
		mid_month: 'Mid-Month',
		mid_quarter: 'Mid-Quarter'
	};

	// ── state ──────────────────────────────────────────────────────────────────
	let assets = $state<FixedAsset[]>([]);
	let glAccounts = $state<GLAccount[]>([]);
	let subledgerAccounts = $state<SubledgerAccount[]>([]);
	let loading = $state(true);
	let error = $state('');
	let successMsg = $state('');

	// modal
	let showModal = $state(false);
	let editing = $state<FixedAsset | null>(null);
	let saving = $state(false);
	let formError = $state('');

	let form = $state({
		name: '',
		description: '',
		assetAccountId: 0,
		expenseAccountId: 0,
		depreciationMethod: 'SL' as 'SL' | '200DB' | '150DB' | 'Immediate',
		convention: 'half_year' as 'half_year' | 'mid_month' | 'mid_quarter',
		usefulLifeMonths: 60,
		salvageValue: 0,
		activationDate: ''
	});

	// depreciate-all modal
	let showDeprModal = $state(false);
	let deprMonth = $state(todayMonth());
	let deprPosting = $state(false);
	let deprResult = $state<{ posted: number; skipped: number; errors: string[] } | null>(null);

	function todayMonth() {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
	}

	// ── derived ────────────────────────────────────────────────────────────────
	let assetSubledgers = $derived(
		subledgerAccounts.filter(s => {
			const gl = glAccounts.find(g => g.id === s.glAccountId);
			return gl?.type === 'Asset';
		})
	);

	let expenseSubledgers = $derived(
		subledgerAccounts.filter(s => {
			const gl = glAccounts.find(g => g.id === s.glAccountId);
			return gl?.type === 'Loss';
		})
	);

	let totalInitial = $derived(assets.reduce((s, a) => s + a.initialValue, 0));
	let totalAccum = $derived(assets.reduce((s, a) => s + a.accumulatedDepreciation, 0));
	let totalRemaining = $derived(assets.reduce((s, a) => s + a.remainingValue, 0));

	let usefulLifeYears = $derived(
		form.usefulLifeMonths > 0 ? `= ${(form.usefulLifeMonths / 12).toFixed(2)} yrs` : ''
	);

	// ── load ───────────────────────────────────────────────────────────────────
	$effect(() => {
		load();
	});

	async function load() {
		loading = true;
		error = '';
		try {
			const [a, g, s] = await Promise.all([
				fixedAssetsAPI.list(),
				glAccountsAPI.list(),
				subledgerAccountsAPI.list({ active: true })
			]);
			assets = a;
			glAccounts = g;
			subledgerAccounts = s;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load data';
		} finally {
			loading = false;
		}
	}

	// ── modal helpers ──────────────────────────────────────────────────────────
	function openCreate() {
		editing = null;
		form = {
			name: '',
			description: '',
			assetAccountId: assetSubledgers[0]?.id ?? 0,
			expenseAccountId: expenseSubledgers[0]?.id ?? 0,
			depreciationMethod: 'SL',
			convention: 'half_year',
			usefulLifeMonths: 60,
			salvageValue: 0,
			activationDate: ''
		};
		formError = '';
		showModal = true;
	}

	function openEdit(a: FixedAsset) {
		editing = a;
		form = {
			name: a.name,
			description: a.description ?? '',
			assetAccountId: a.assetAccountId,
			expenseAccountId: a.expenseAccountId,
			depreciationMethod: a.depreciationMethod,
			convention: a.convention,
			usefulLifeMonths: a.usefulLifeMonths,
			salvageValue: a.salvageValue,
			activationDate: a.activationDate ?? ''
		};
		formError = '';
		showModal = true;
	}

	function closeModal() {
		showModal = false;
		editing = null;
		formError = '';
	}

	async function handleSubmit() {
		if (!form.name.trim()) { formError = 'Name is required.'; return; }
		if (!form.assetAccountId) { formError = 'Asset account is required.'; return; }
		if (!form.expenseAccountId) { formError = 'Expense account is required.'; return; }
		if (form.usefulLifeMonths <= 0) { formError = 'Useful life must be > 0.'; return; }

		saving = true;
		formError = '';
		try {
			const payload: CreateFixedAssetPayload = {
				name: form.name.trim(),
				description: form.description || null,
				assetAccountId: Number(form.assetAccountId),
				expenseAccountId: Number(form.expenseAccountId),
				depreciationMethod: form.depreciationMethod,
				convention: form.convention,
				usefulLifeMonths: Number(form.usefulLifeMonths),
				salvageValue: Number(form.salvageValue) || 0,
				activationDate: form.activationDate || null
			};

			if (editing) {
				await fixedAssetsAPI.update(editing.id, payload);
			} else {
				await fixedAssetsAPI.create(payload);
			}
			closeModal();
			await load();
		} catch (e) {
			formError = e instanceof Error ? e.message : 'Failed to save asset';
		} finally {
			saving = false;
		}
	}

	async function handleDelete(a: FixedAsset) {
		if (!confirm(`Delete "${a.name}"? This cannot be undone.`)) return;
		try {
			await fixedAssetsAPI.delete(a.id);
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to delete asset';
		}
	}

	// ── post-all depreciation ──────────────────────────────────────────────────
	function openDeprModal() {
		deprMonth = todayMonth();
		deprResult = null;
		showDeprModal = true;
	}

	async function handleDeprAll() {
		deprPosting = true;
		try {
			const res = await fixedAssetsAPI.depreciateAll(deprMonth);
			deprResult = res;
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to post depreciation';
			showDeprModal = false;
		} finally {
			deprPosting = false;
		}
	}

	function statusBadge(a: FixedAsset) {
		if (!a.activationDate) return { label: 'Not Activated', cls: 'badge-ghost' };
		if (a.isFullyDepreciated) return { label: 'Fully Depreciated', cls: 'badge-warning' };
		return { label: 'Active', cls: 'badge-success' };
	}
</script>

<svelte:head>
	<title>Fixed Assets</title>
	<meta name="description" content="Manage fixed assets, track depreciation, and post monthly depreciation entries." />
</svelte:head>

<div class="max-w-7xl mx-auto">
	<!-- Header -->
	<div class="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
		<div>
			<h1 class="text-3xl font-bold">🏗️ Fixed Assets</h1>
			<p class="text-base-content/60 mt-1">Track assets, depreciation methods, and posting history</p>
		</div>
		<div class="flex gap-2">
			<button class="btn btn-outline btn-sm" onclick={openDeprModal}>
				📅 Post All Depreciation
			</button>
			<button class="btn btn-primary btn-sm" onclick={openCreate}>
				+ New Asset
			</button>
		</div>
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

	<!-- Summary Stats -->
	{#if !loading}
		<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
			<div class="stat bg-base-100 shadow rounded-xl p-4">
				<div class="stat-title text-xs">Total Assets</div>
				<div class="stat-value text-2xl">{assets.length}</div>
			</div>
			<div class="stat bg-base-100 shadow rounded-xl p-4">
				<div class="stat-title text-xs">Initial Value</div>
				<div class="stat-value text-xl text-primary">{fmt(totalInitial)}</div>
			</div>
			<div class="stat bg-base-100 shadow rounded-xl p-4">
				<div class="stat-title text-xs">Accumulated Depr.</div>
				<div class="stat-value text-xl text-warning">{fmt(totalAccum)}</div>
			</div>
			<div class="stat bg-base-100 shadow rounded-xl p-4">
				<div class="stat-title text-xs">Net Book Value</div>
				<div class="stat-value text-xl text-success">{fmt(totalRemaining)}</div>
			</div>
		</div>
	{/if}

	<!-- Table -->
	<div class="card bg-base-100 shadow-xl">
		<div class="card-body p-0">
			{#if loading}
				<div class="flex justify-center py-16">
					<span class="loading loading-spinner loading-lg text-primary"></span>
				</div>
			{:else if assets.length === 0}
				<div class="flex flex-col items-center justify-center py-16 text-base-content/40">
					<div class="text-5xl mb-3">🏗️</div>
					<p class="text-lg font-medium">No fixed assets yet</p>
					<p class="text-sm mt-1">Create your first asset to start tracking depreciation</p>
					<button class="btn btn-primary btn-sm mt-4" onclick={openCreate}>+ New Asset</button>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="table table-zebra table-sm w-full">
						<thead>
							<tr>
								<th>Name</th>
								<th>Asset Account</th>
								<th>Exp. Account</th>
								<th>Method</th>
								<th>Convention</th>
								<th>Useful Life</th>
								<th>Activation</th>
								<th class="text-right">Initial Value</th>
								<th class="text-right">Accum. Depr.</th>
								<th class="text-right">Book Value</th>
								<th>Status</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							{#each assets as a}
								{@const badge = statusBadge(a)}
								<tr class="hover cursor-pointer" onclick={() => goto(`/assets/${a.id}`)}>
									<td class="font-semibold">{a.name}</td>
									<td class="text-sm text-base-content/70">{a.assetAccountName}</td>
									<td class="text-sm text-base-content/70">{a.expenseAccountName}</td>
									<td><span class="badge badge-outline badge-xs">{a.depreciationMethod}</span></td>
									<td class="text-xs">{conventionLabel[a.convention]}</td>
									<td class="text-sm">{fmtLife(a.usefulLifeMonths)}</td>
									<td class="text-sm">{a.activationDate ?? '—'}</td>
									<td class="text-right font-mono text-sm">{fmt(a.initialValue)}</td>
									<td class="text-right font-mono text-sm text-warning">{fmt(a.accumulatedDepreciation)}</td>
									<td class="text-right font-mono text-sm text-success font-semibold">{fmt(a.remainingValue)}</td>
									<td><span class="badge badge-xs {badge.cls}">{badge.label}</span></td>
									<td onclick={(e) => e.stopPropagation()}>
										<div class="flex gap-1">
											<button class="btn btn-ghost btn-xs" onclick={() => openEdit(a)}>Edit</button>
											<button class="btn btn-ghost btn-xs text-error" onclick={() => handleDelete(a)}>Del</button>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	</div>
</div>

<!-- Create / Edit Modal -->
{#if showModal}
	<div class="modal modal-open">
		<div class="modal-box max-w-2xl">
			<h3 class="font-bold text-lg mb-4">{editing ? 'Edit Asset' : 'New Fixed Asset'}</h3>

			{#if formError}
				<div class="alert alert-error mb-4 py-2 text-sm">{formError}</div>
			{/if}

			<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<!-- Name -->
					<div class="form-control sm:col-span-2">
						<label class="label" for="fa-name"><span class="label-text">Name *</span></label>
						<input id="fa-name" type="text" class="input input-bordered" bind:value={form.name} placeholder="CNC Router" required />
					</div>

					<!-- Description -->
					<div class="form-control sm:col-span-2">
						<label class="label" for="fa-desc"><span class="label-text">Description</span></label>
						<textarea id="fa-desc" class="textarea textarea-bordered" bind:value={form.description} rows="2" placeholder="Optional description"></textarea>
					</div>

					<!-- Asset Account -->
					<div class="form-control">
						<label class="label" for="fa-asset-acc"><span class="label-text">Asset Account *</span></label>
						<select id="fa-asset-acc" class="select select-bordered" bind:value={form.assetAccountId}>
							<option value={0} disabled>Select account…</option>
							{#each assetSubledgers as s}
								<option value={s.id}>{s.accountNumber} – {s.name}</option>
							{/each}
						</select>
						<span class="label-text-alt text-base-content/50 mt-1">Must be an Asset-type account</span>
					</div>

					<!-- Expense Account -->
					<div class="form-control">
						<label class="label" for="fa-exp-acc"><span class="label-text">Depreciation Expense Account *</span></label>
						<select id="fa-exp-acc" class="select select-bordered" bind:value={form.expenseAccountId}>
							<option value={0} disabled>Select account…</option>
							{#each expenseSubledgers as s}
								<option value={s.id}>{s.accountNumber} – {s.name}</option>
							{/each}
						</select>
						<span class="label-text-alt text-base-content/50 mt-1">Must be a Loss/Expense-type account</span>
					</div>

					<!-- Method -->
					<div class="form-control">
						<label class="label" for="fa-method"><span class="label-text">Depreciation Method *</span></label>
						<select id="fa-method" class="select select-bordered" bind:value={form.depreciationMethod}>
							<option value="SL">Straight-Line (SL)</option>
							<option value="200DB">200% Declining Balance (200DB)</option>
							<option value="150DB">150% Declining Balance (150DB)</option>
							<option value="Immediate">Immediate / 100% Bonus (Section 179)</option>
						</select>
					</div>

					<!-- Convention -->
					<div class="form-control">
						<label class="label" for="fa-convention"><span class="label-text">Convention *</span></label>
						<select id="fa-convention" class="select select-bordered" bind:value={form.convention}>
							<option value="half_year">Half-Year</option>
							<option value="mid_month">Mid-Month</option>
							<option value="mid_quarter">Mid-Quarter</option>
						</select>
					</div>

					<!-- Useful Life -->
					<div class="form-control">
						<label class="label" for="fa-life"><span class="label-text">Useful Life (months) *</span></label>
						<input id="fa-life" type="number" class="input input-bordered" bind:value={form.usefulLifeMonths} min="1" step="1" />
						{#if form.usefulLifeMonths > 0}
							<span class="label-text-alt text-base-content/50 mt-1">{usefulLifeYears}</span>
						{/if}
					</div>

					<!-- Salvage Value -->
					<div class="form-control">
						<label class="label" for="fa-salvage"><span class="label-text">Salvage Value</span></label>
						<input id="fa-salvage" type="number" class="input input-bordered" bind:value={form.salvageValue} min="0" step="0.01" />
					</div>

					<!-- Activation Date -->
					<div class="form-control sm:col-span-2">
						<label class="label" for="fa-activation"><span class="label-text">Activation Date (Date Placed in Service)</span></label>
						<input id="fa-activation" type="date" class="input input-bordered" bind:value={form.activationDate} />
						<span class="label-text-alt text-base-content/50 mt-1">Leave blank if not yet activated. Depreciation cannot be posted before this date.</span>
					</div>
				</div>

				<div class="modal-action">
					<button type="button" class="btn btn-ghost" onclick={closeModal} disabled={saving}>Cancel</button>
					<button type="submit" class="btn btn-primary" disabled={saving}>
						{#if saving}<span class="loading loading-spinner loading-xs"></span>{/if}
						{editing ? 'Save Changes' : 'Create Asset'}
					</button>
				</div>
			</form>
		</div>
		<div class="modal-backdrop" role="presentation" onclick={closeModal}></div>
	</div>
{/if}

<!-- Post All Depreciation Modal -->
{#if showDeprModal}
	<div class="modal modal-open">
		<div class="modal-box max-w-sm">
			<h3 class="font-bold text-lg mb-4">📅 Post All Depreciation</h3>

			{#if deprResult}
				<div class="space-y-3">
					<div class="alert alert-success py-2">
						<span>✓ Posted {deprResult.posted} depreciation entr{deprResult.posted === 1 ? 'y' : 'ies'}</span>
					</div>
					{#if deprResult.skipped > 0}
						<div class="text-sm text-base-content/60">{deprResult.skipped} asset(s) skipped (already posted or not eligible)</div>
					{/if}
					{#if deprResult.errors.length > 0}
						<div class="alert alert-error py-2 text-sm">
							<ul class="list-disc list-inside">
								{#each deprResult.errors as err}<li>{err}</li>{/each}
							</ul>
						</div>
					{/if}
					<div class="modal-action">
						<button class="btn btn-primary" onclick={() => { showDeprModal = false; deprResult = null; }}>Done</button>
					</div>
				</div>
			{:else}
				<div class="form-control mb-4">
					<label class="label" for="depr-all-month"><span class="label-text">Month</span></label>
					<input id="depr-all-month" type="month" class="input input-bordered" bind:value={deprMonth} />
					<span class="label-text-alt text-base-content/50 mt-1">Will post for all eligible active assets</span>
				</div>
				<div class="modal-action">
					<button class="btn btn-ghost" onclick={() => showDeprModal = false} disabled={deprPosting}>Cancel</button>
					<button class="btn btn-primary" onclick={handleDeprAll} disabled={deprPosting}>
						{#if deprPosting}<span class="loading loading-spinner loading-xs"></span>{/if}
						Post Depreciation
					</button>
				</div>
			{/if}
		</div>
		<div class="modal-backdrop" role="presentation" onclick={() => { if (!deprPosting) { showDeprModal = false; deprResult = null; } }}></div>
	</div>
{/if}
