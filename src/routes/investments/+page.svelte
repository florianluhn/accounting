<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		investmentsAPI,
		glAccountsAPI,
		subledgerAccountsAPI,
		type Investment,
		type InvestmentSummary,
		type GLAccount,
		type SubledgerAccount,
		type CreateInvestmentPayload
	} from '$lib/api';

	const fmt = (n: number) =>
		new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

	const fmtQty = (n: number) =>
		n.toLocaleString('en-US', { maximumFractionDigits: 8 });

	const fmtPct = (n: number | null) =>
		n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

	let investments = $state<Investment[]>([]);
	let summary = $state<InvestmentSummary | null>(null);
	let categories = $state<string[]>([]);
	let glAccounts = $state<GLAccount[]>([]);
	let subledgerAccounts = $state<SubledgerAccount[]>([]);
	let loading = $state(true);
	let error = $state('');
	let successMsg = $state('');

	let showModal = $state(false);
	let editing = $state<Investment | null>(null);
	let saving = $state(false);
	let formError = $state('');

	let form = $state({
		name: '',
		symbol: '',
		category: '',
		unit: '',
		assetAccountId: 0,
		currentPrice: 0,
		description: ''
	});

	let priceEditId = $state<number | null>(null);
	let priceEditValue = $state(0);
	let priceSaving = $state(false);

	let assetSubledgers = $derived(
		subledgerAccounts.filter((s) => {
			const gl = glAccounts.find((g) => g.id === s.glAccountId);
			return gl && ['Asset', 'Cash', 'Accounts Receivable'].includes(gl.type);
		})
	);

	$effect(() => {
		load();
	});

	async function load() {
		loading = true;
		error = '';
		try {
			const [list, sum, cats, g, s] = await Promise.all([
				investmentsAPI.list(),
				investmentsAPI.summary(),
				investmentsAPI.categories(),
				glAccountsAPI.list(),
				subledgerAccountsAPI.list({ active: true })
			]);
			investments = list;
			summary = sum;
			categories = cats;
			glAccounts = g;
			subledgerAccounts = s;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load investments';
		} finally {
			loading = false;
		}
	}

	function openCreate() {
		editing = null;
		form = {
			name: '',
			symbol: '',
			category: categories[0] || 'Stock',
			unit: '',
			assetAccountId: assetSubledgers[0]?.id ?? 0,
			currentPrice: 0,
			description: ''
		};
		formError = '';
		showModal = true;
	}

	function openEdit(inv: Investment, e?: MouseEvent) {
		e?.stopPropagation();
		editing = inv;
		form = {
			name: inv.name,
			symbol: inv.symbol || '',
			category: inv.category,
			unit: inv.unit || '',
			assetAccountId: inv.assetAccountId,
			currentPrice: inv.currentPrice,
			description: inv.description || ''
		};
		formError = '';
		showModal = true;
	}

	function closeModal() {
		showModal = false;
		editing = null;
		formError = '';
	}

	async function save() {
		if (!form.name.trim()) {
			formError = 'Name is required';
			return;
		}
		if (!form.category.trim()) {
			formError = 'Category is required';
			return;
		}
		if (!form.assetAccountId) {
			formError = 'Select a balance-sheet account';
			return;
		}

		saving = true;
		formError = '';
		try {
			const payload: CreateInvestmentPayload = {
				name: form.name.trim(),
				symbol: form.symbol.trim() || null,
				category: form.category.trim(),
				unit: form.unit.trim() || null,
				assetAccountId: form.assetAccountId,
				currentPrice: form.currentPrice || 0,
				description: form.description.trim() || null
			};
			if (editing) {
				await investmentsAPI.update(editing.id, payload);
				successMsg = 'Investment updated';
			} else {
				await investmentsAPI.create(payload);
				successMsg = 'Investment created';
			}
			closeModal();
			await load();
			setTimeout(() => (successMsg = ''), 2500);
		} catch (e) {
			formError = e instanceof Error ? e.message : 'Failed to save';
		} finally {
			saving = false;
		}
	}

	async function remove(inv: Investment, e: MouseEvent) {
		e.stopPropagation();
		if (!confirm(`Delete investment "${inv.name}"?`)) return;
		try {
			await investmentsAPI.delete(inv.id);
			successMsg = 'Investment deleted';
			await load();
			setTimeout(() => (successMsg = ''), 2500);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to delete';
		}
	}

	function startPriceEdit(inv: Investment, e: MouseEvent) {
		e.stopPropagation();
		priceEditId = inv.id;
		priceEditValue = inv.currentPrice;
	}

	async function savePrice(inv: Investment) {
		priceSaving = true;
		try {
			await investmentsAPI.update(inv.id, { currentPrice: priceEditValue });
			priceEditId = null;
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to update price';
		} finally {
			priceSaving = false;
		}
	}

	// Chart geometry for cost vs market by category
	const chartW = 560;
	const chartH = 200;
	const chartPad = { top: 16, right: 16, bottom: 40, left: 56 };

	let categoryChart = $derived.by(() => {
		const cats = summary?.byCategory ?? [];
		if (cats.length === 0) return null;
		const values = cats.flatMap((c) => [c.costBasis, c.marketValue]);
		const maxV = Math.max(...values, 1);
		const plotW = chartW - chartPad.left - chartPad.right;
		const plotH = chartH - chartPad.top - chartPad.bottom;
		const groupW = plotW / cats.length;
		const barW = Math.min(28, groupW * 0.32);

		const groups = cats.map((c, i) => {
			const cx = chartPad.left + groupW * i + groupW / 2;
			const costH = (c.costBasis / maxV) * plotH;
			const mktH = (c.marketValue / maxV) * plotH;
			return {
				...c,
				cx,
				cost: {
					x: cx - barW - 2,
					y: chartPad.top + plotH - costH,
					h: costH,
					w: barW
				},
				market: {
					x: cx + 2,
					y: chartPad.top + plotH - mktH,
					h: mktH,
					w: barW
				}
			};
		});

		const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
			value: maxV * (1 - t),
			y: chartPad.top + t * plotH
		}));

		return { groups, ticks, maxV };
	});

	function compactMoney(n: number): string {
		const abs = Math.abs(n);
		const sign = n < 0 ? '-' : '';
		if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
		if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
		return `${sign}$${abs.toFixed(0)}`;
	}
</script>

<div class="page-shell">
	<div class="page-header">
		<div>
			<p class="section-label mb-2">Holdings</p>
			<h1 class="page-title">Investments</h1>
			<p class="page-subtitle">
				Stocks, crypto, bullion and similar assets — market value is memo-only (not on the balance sheet)
			</p>
		</div>
		<button class="btn btn-primary btn-sm" onclick={openCreate}>
			<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
			</svg>
			New investment
		</button>
	</div>

	{#if error}
		<div class="alert alert-error mb-4"><span>{error}</span></div>
	{/if}
	{#if successMsg}
		<div class="alert alert-success mb-4"><span>{successMsg}</span></div>
	{/if}

	{#if loading}
		<div class="flex justify-center py-16">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else}
		<!-- Summary cards -->
		{#if summary}
			<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
				<div class="metric-tile">
					<p class="stat-title mb-2">Holdings</p>
					<p class="stat-value text-2xl font-mono">{summary.overall.investmentCount}</p>
					<p class="stat-desc mt-2 text-base-content/50">Investments tracked</p>
				</div>
				<div class="metric-tile">
					<p class="stat-title mb-2">Cost basis</p>
					<p class="stat-value text-2xl font-mono">{fmt(summary.overall.costBasis)}</p>
					<p class="stat-desc mt-2 text-base-content/50">Average-cost invested</p>
				</div>
				<div class="metric-tile">
					<p class="stat-title mb-2">Market value</p>
					<p class="stat-value text-2xl font-mono text-accent">{fmt(summary.overall.marketValue)}</p>
					<p class="stat-desc mt-2 text-base-content/50">Qty × current price (memo)</p>
				</div>
				<div class="metric-tile">
					<p class="stat-title mb-2">Unrealized P/L</p>
					<p class="stat-value text-2xl font-mono {summary.overall.unrealizedPL >= 0 ? 'text-success' : 'text-error'}">
						{fmt(summary.overall.unrealizedPL)}
					</p>
					<p class="stat-desc mt-2 {summary.overall.unrealizedPL >= 0 ? 'text-success/70' : 'text-error/70'}">
						{fmtPct(summary.overall.unrealizedPLPercent)} vs cost
					</p>
				</div>
			</div>
		{/if}

		<!-- Category chart + table -->
		{#if summary && summary.byCategory.length > 0}
			<div class="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
				<div class="card">
					<div class="card-body">
						<p class="section-label mb-1">By category</p>
						<h2 class="card-title text-lg">Cost vs market value</h2>
						{#if categoryChart}
							<div class="mt-2" style="aspect-ratio: {chartW} / {chartH};">
								<svg viewBox="0 0 {chartW} {chartH}" class="w-full h-full" role="img" aria-label="Cost versus market value by category">
									{#each categoryChart.ticks as tick}
										<line
											x1={chartPad.left}
											y1={tick.y}
											x2={chartW - chartPad.right}
											y2={tick.y}
											stroke="oklch(var(--b3))"
											stroke-opacity="0.55"
											stroke-dasharray="3 4"
										/>
										<text
											x={chartPad.left - 8}
											y={tick.y + 3}
											text-anchor="end"
											fill-opacity="0.45"
											font-size="10"
											font-family="ui-monospace, monospace"
											class="fill-base-content"
										>
											{compactMoney(tick.value)}
										</text>
									{/each}
									{#each categoryChart.groups as g}
										<rect x={g.cost.x} y={g.cost.y} width={g.cost.w} height={Math.max(g.cost.h, 0)} rx="3" fill="oklch(var(--p))" fill-opacity="0.75" />
										<rect x={g.market.x} y={g.market.y} width={g.market.w} height={Math.max(g.market.h, 0)} rx="3" fill="oklch(var(--a))" fill-opacity="0.85" />
										<text x={g.cx} y={chartH - 14} text-anchor="middle" font-size="11" font-weight="600" class="fill-base-content" fill-opacity="0.7">
											{g.category}
										</text>
									{/each}
								</svg>
							</div>
							<div class="flex gap-4 text-2xs font-semibold uppercase tracking-wider text-base-content/50 mt-1 px-1">
								<span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-primary/80"></span> Cost</span>
								<span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-accent/90"></span> Market</span>
							</div>
						{/if}
					</div>
				</div>

				<div class="card">
					<div class="card-body">
						<p class="section-label mb-1">Unrealized</p>
						<h2 class="card-title text-lg">Gain / loss by category</h2>
						<div class="overflow-x-auto mt-2">
							<table class="table table-sm">
								<thead>
									<tr>
										<th>Category</th>
										<th class="text-right">Cost</th>
										<th class="text-right">Market</th>
										<th class="text-right">P/L</th>
									</tr>
								</thead>
								<tbody>
									{#each summary.byCategory as cat}
										<tr>
											<td>
												<span class="font-semibold">{cat.category}</span>
												<span class="text-xs text-base-content/50 ml-1">({cat.investmentCount})</span>
											</td>
											<td class="text-right font-mono text-sm">{fmt(cat.costBasis)}</td>
											<td class="text-right font-mono text-sm">{fmt(cat.marketValue)}</td>
											<td class="text-right font-mono text-sm font-semibold {cat.unrealizedPL >= 0 ? 'text-success' : 'text-error'}">
												{fmt(cat.unrealizedPL)}
												<span class="text-2xs font-medium opacity-70 ml-1">{fmtPct(cat.unrealizedPLPercent)}</span>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- Holdings table -->
		<div class="card">
			<div class="card-body">
				<div class="flex items-center justify-between gap-3 mb-2">
					<div>
						<p class="section-label mb-1">Register</p>
						<h2 class="card-title text-lg">All investments</h2>
					</div>
				</div>

				{#if investments.length === 0}
					<div class="alert alert-info">
						<span>No investments yet. Create one, then link buys/sells from Journal entries with a quantity.</span>
					</div>
				{:else}
					<div class="overflow-x-auto">
						<table class="table">
							<thead>
								<tr>
									<th>Name</th>
									<th>Category</th>
									<th class="text-right">Qty</th>
									<th class="text-right">Avg cost</th>
									<th class="text-right">Current price</th>
									<th class="text-right">Cost basis</th>
									<th class="text-right">Market</th>
									<th class="text-right">Unrealized</th>
									<th></th>
								</tr>
							</thead>
							<tbody>
								{#each investments as inv}
									<tr class="hover cursor-pointer" onclick={() => goto(`/investments/${inv.id}`)}>
										<td>
											<div class="font-semibold">{inv.name}</div>
											{#if inv.symbol}
												<div class="text-xs text-base-content/50 font-mono">{inv.symbol}</div>
											{/if}
											<div class="text-2xs text-base-content/40">{inv.assetAccountName}</div>
										</td>
										<td><span class="badge badge-ghost badge-sm">{inv.category}</span></td>
										<td class="text-right font-mono text-sm">
											{fmtQty(inv.quantity)}
											{#if inv.unit}<span class="text-2xs text-base-content/45 ml-0.5">{inv.unit}</span>{/if}
										</td>
										<td class="text-right font-mono text-sm">{fmt(inv.avgCost)}</td>
										<td class="text-right" onclick={(e) => e.stopPropagation()}>
											{#if priceEditId === inv.id}
												<div class="flex items-center justify-end gap-1">
													<input
														type="number"
														class="input input-bordered input-xs w-24 font-mono text-right"
														step="any"
														min="0"
														bind:value={priceEditValue}
													/>
													<button class="btn btn-xs btn-primary" disabled={priceSaving} onclick={() => savePrice(inv)}>Save</button>
													<button class="btn btn-xs btn-ghost" onclick={() => (priceEditId = null)}>✕</button>
												</div>
											{:else}
												<button
													type="button"
													class="font-mono text-sm hover:text-primary hover:underline"
													onclick={(e) => startPriceEdit(inv, e)}
													title="Edit current price"
												>
													{fmt(inv.currentPrice)}
												</button>
											{/if}
										</td>
										<td class="text-right font-mono text-sm">{fmt(inv.costBasis)}</td>
										<td class="text-right font-mono text-sm text-accent">{fmt(inv.marketValue)}</td>
										<td class="text-right font-mono text-sm font-semibold {inv.unrealizedPL >= 0 ? 'text-success' : 'text-error'}">
											{fmt(inv.unrealizedPL)}
										</td>
										<td class="text-right whitespace-nowrap" onclick={(e) => e.stopPropagation()}>
											<button class="btn btn-ghost btn-xs" onclick={(e) => openEdit(inv, e)}>Edit</button>
											<button class="btn btn-ghost btn-xs text-error" onclick={(e) => remove(inv, e)}>Delete</button>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

{#if showModal}
	<div class="modal modal-open">
		<div class="modal-box max-w-lg">
			<h3 class="font-bold text-lg mb-4">{editing ? 'Edit investment' : 'New investment'}</h3>
			{#if formError}
				<div class="alert alert-error mb-3 text-sm"><span>{formError}</span></div>
			{/if}
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
				<div class="form-control sm:col-span-2">
					<label class="label"><span class="label-text">Name</span></label>
					<input class="input input-bordered" bind:value={form.name} placeholder="e.g. Apple Inc." />
				</div>
				<div class="form-control">
					<label class="label"><span class="label-text">Symbol / ticker</span></label>
					<input class="input input-bordered" bind:value={form.symbol} placeholder="AAPL" />
				</div>
				<div class="form-control">
					<label class="label"><span class="label-text">Unit</span></label>
					<input class="input input-bordered" bind:value={form.unit} placeholder="shares, oz, g…" list="unit-suggestions" />
					<datalist id="unit-suggestions">
						<option value="shares"></option>
						<option value="oz"></option>
						<option value="g"></option>
						<option value="coins"></option>
					</datalist>
				</div>
				<div class="form-control sm:col-span-2">
					<label class="label"><span class="label-text">Category</span></label>
					<input
						class="input input-bordered"
						bind:value={form.category}
						placeholder="Stock, Crypto, Bullion…"
						list="category-suggestions"
					/>
					<datalist id="category-suggestions">
						{#each categories as cat}
							<option value={cat}></option>
						{/each}
						{#if !categories.includes('Stock')}<option value="Stock"></option>{/if}
						{#if !categories.includes('Crypto')}<option value="Crypto"></option>{/if}
						{#if !categories.includes('Bullion')}<option value="Bullion"></option>{/if}
						{#if !categories.includes('ETF')}<option value="ETF"></option>{/if}
						{#if !categories.includes('Bond')}<option value="Bond"></option>{/if}
					</datalist>
				</div>
				<div class="form-control sm:col-span-2">
					<label class="label"><span class="label-text">Balance sheet account</span></label>
					<select class="select select-bordered" bind:value={form.assetAccountId}>
						<option value={0} disabled>Select account…</option>
						{#each assetSubledgers as acc}
							<option value={acc.id}>{acc.accountNumber} — {acc.name}</option>
						{/each}
					</select>
					<label class="label">
						<span class="label-text-alt">Must be Asset, Cash, or Accounts Receivable. BS value comes from journal postings.</span>
					</label>
				</div>
				<div class="form-control">
					<label class="label"><span class="label-text">Current price / unit</span></label>
					<input type="number" class="input input-bordered font-mono" step="any" min="0" bind:value={form.currentPrice} />
					<label class="label"><span class="label-text-alt">Memo only — not booked to the ledger</span></label>
				</div>
				<div class="form-control sm:col-span-2">
					<label class="label"><span class="label-text">Description</span></label>
					<textarea class="textarea textarea-bordered" rows="2" bind:value={form.description}></textarea>
				</div>
			</div>
			<div class="modal-action">
				<button class="btn btn-ghost" onclick={closeModal} disabled={saving}>Cancel</button>
				<button class="btn btn-primary" onclick={save} disabled={saving}>
					{#if saving}<span class="loading loading-spinner loading-sm"></span>{/if}
					{editing ? 'Save' : 'Create'}
				</button>
			</div>
		</div>
		<button type="button" class="modal-backdrop" onclick={closeModal} aria-label="Close"></button>
	</div>
{/if}
