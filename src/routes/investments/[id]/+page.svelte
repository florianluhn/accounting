<script lang="ts">
	import { page } from '$app/stores';
	import {
		investmentsAPI,
		journalEntriesAPI,
		glAccountsAPI,
		subledgerAccountsAPI,
		type Investment,
		type JournalEntry,
		type GLAccount,
		type SubledgerAccount,
		type UpdateInvestmentPayload
	} from '$lib/api';

	const fmt = (n: number) =>
		new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

	const fmtQty = (n: number) =>
		n.toLocaleString('en-US', { maximumFractionDigits: 8 });

	const fmtPct = (n: number | null) =>
		n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

	function formatDate(date: Date | string): string {
		const d = new Date(date);
		const year = d.getUTCFullYear();
		const month = String(d.getUTCMonth() + 1).padStart(2, '0');
		const day = String(d.getUTCDate()).padStart(2, '0');
		return `${month}/${day}/${year}`;
	}

	let investment = $state<Investment | null>(null);
	let entries = $state<JournalEntry[]>([]);
	let categories = $state<string[]>([]);
	let glAccounts = $state<GLAccount[]>([]);
	let subledgerAccounts = $state<SubledgerAccount[]>([]);
	let loading = $state(true);
	let error = $state('');
	let successMsg = $state('');

	let showEdit = $state(false);
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

	let assetSubledgers = $derived(
		subledgerAccounts.filter((s) => {
			const gl = glAccounts.find((g) => g.id === s.glAccountId);
			return gl && ['Asset', 'Cash', 'Accounts Receivable'].includes(gl.type);
		})
	);

	/** Running qty / cost after each entry (chronological). */
	let entryRuns = $derived.by(() => {
		const sorted = [...entries].sort((a, b) => {
			const ta = new Date(a.entryDate).getTime();
			const tb = new Date(b.entryDate).getTime();
			if (ta !== tb) return ta - tb;
			return a.id - b.id;
		});
		let qty = 0;
		let cost = 0;
		return sorted.map((entry) => {
			const q = entry.investmentQuantity ?? 0;
			if (q > 0) {
				cost += entry.amountInUSD;
				qty += q;
			} else if (q < 0) {
				const avg = qty > 1e-12 ? cost / qty : 0;
				cost -= avg * Math.abs(q);
				qty += q;
				if (Math.abs(qty) < 1e-9) {
					qty = 0;
					cost = 0;
				}
			}
			qty = Math.round(qty * 1e8) / 1e8;
			cost = Math.round(cost * 100) / 100;
			return {
				entry,
				runningQty: qty,
				runningCost: cost,
				avgCost: qty > 1e-12 ? cost / qty : 0
			};
		});
	});

	$effect(() => {
		const id = parseInt($page.params.id);
		if (!isNaN(id)) load(id);
	});

	async function load(id: number) {
		loading = true;
		error = '';
		try {
			const [inv, je, cats, g, s] = await Promise.all([
				investmentsAPI.get(id),
				journalEntriesAPI.list({ investmentId: id }),
				investmentsAPI.categories(),
				glAccountsAPI.list(),
				subledgerAccountsAPI.list({ active: true })
			]);
			investment = inv;
			entries = je;
			categories = cats;
			glAccounts = g;
			subledgerAccounts = s;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load investment';
			investment = null;
		} finally {
			loading = false;
		}
	}

	function openEdit() {
		if (!investment) return;
		form = {
			name: investment.name,
			symbol: investment.symbol || '',
			category: investment.category,
			unit: investment.unit || '',
			assetAccountId: investment.assetAccountId,
			currentPrice: investment.currentPrice,
			description: investment.description || ''
		};
		formError = '';
		showEdit = true;
	}

	async function saveEdit() {
		if (!investment) return;
		if (!form.name.trim() || !form.category.trim() || !form.assetAccountId) {
			formError = 'Name, category, and account are required';
			return;
		}
		saving = true;
		formError = '';
		try {
			const payload: UpdateInvestmentPayload = {
				name: form.name.trim(),
				symbol: form.symbol.trim() || null,
				category: form.category.trim(),
				unit: form.unit.trim() || null,
				assetAccountId: form.assetAccountId,
				currentPrice: form.currentPrice || 0,
				description: form.description.trim() || null
			};
			investment = await investmentsAPI.update(investment.id, payload);
			showEdit = false;
			successMsg = 'Saved';
			setTimeout(() => (successMsg = ''), 2000);
			await load(investment.id);
		} catch (e) {
			formError = e instanceof Error ? e.message : 'Failed to save';
		} finally {
			saving = false;
		}
	}

	async function quickSavePrice() {
		if (!investment) return;
		try {
			investment = await investmentsAPI.update(investment.id, {
				currentPrice: investment.currentPrice
			});
			successMsg = 'Current price updated';
			setTimeout(() => (successMsg = ''), 2000);
			await load(investment.id);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to update price';
		}
	}
</script>

<div class="page-shell">
	<div class="mb-4">
		<a href="/investments" class="btn btn-ghost btn-sm gap-1">
			<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
			</svg>
			Investments
		</a>
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
	{:else if !investment}
		<div class="alert alert-warning"><span>Investment not found</span></div>
	{:else}
		<div class="page-header">
			<div>
				<p class="section-label mb-2">{investment.category}</p>
				<h1 class="page-title">
					{investment.name}
					{#if investment.symbol}
						<span class="text-base-content/40 font-mono text-2xl ml-2">{investment.symbol}</span>
					{/if}
				</h1>
				<p class="page-subtitle">
					Account: {investment.assetAccountName}
					{#if investment.unit}· Unit: {investment.unit}{/if}
				</p>
			</div>
			<div class="flex flex-wrap gap-2">
				<a href="/journals" class="btn btn-outline btn-sm">New journal entry</a>
				<button class="btn btn-primary btn-sm" onclick={openEdit}>Edit</button>
			</div>
		</div>

		<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
			<div class="metric-tile">
				<p class="stat-title mb-2">Quantity</p>
				<p class="stat-value text-2xl font-mono">
					{fmtQty(investment.quantity)}
					{#if investment.unit}<span class="text-sm font-sans font-medium text-base-content/50 ml-1">{investment.unit}</span>{/if}
				</p>
			</div>
			<div class="metric-tile">
				<p class="stat-title mb-2">Avg cost / unit</p>
				<p class="stat-value text-2xl font-mono">{fmt(investment.avgCost)}</p>
			</div>
			<div class="metric-tile">
				<p class="stat-title mb-2">Cost basis</p>
				<p class="stat-value text-2xl font-mono">{fmt(investment.costBasis)}</p>
			</div>
			<div class="metric-tile">
				<p class="stat-title mb-2">Current price</p>
				<div class="flex items-end gap-2">
					<input
						type="number"
						class="input input-bordered input-sm font-mono w-36"
						step="any"
						min="0"
						bind:value={investment.currentPrice}
					/>
					<button class="btn btn-sm btn-outline" onclick={quickSavePrice}>Update</button>
				</div>
				<p class="stat-desc mt-2 text-base-content/50">Memo only — not on balance sheet</p>
			</div>
			<div class="metric-tile">
				<p class="stat-title mb-2">Market value</p>
				<p class="stat-value text-2xl font-mono text-accent">{fmt(investment.marketValue)}</p>
			</div>
			<div class="metric-tile">
				<p class="stat-title mb-2">Unrealized P/L</p>
				<p class="stat-value text-2xl font-mono {investment.unrealizedPL >= 0 ? 'text-success' : 'text-error'}">
					{fmt(investment.unrealizedPL)}
				</p>
				<p class="stat-desc mt-2 {investment.unrealizedPL >= 0 ? 'text-success/70' : 'text-error/70'}">
					{fmtPct(investment.unrealizedPLPercent)}
				</p>
			</div>
		</div>

		{#if investment.description}
			<div class="card mb-6">
				<div class="card-body py-4">
					<p class="text-sm text-base-content/70">{investment.description}</p>
				</div>
			</div>
		{/if}

		<div class="card">
			<div class="card-body">
				<p class="section-label mb-1">Activity</p>
				<h2 class="card-title text-lg mb-3">Linked journal entries</h2>

				{#if entryRuns.length === 0}
					<div class="alert alert-info">
						<span>
							No postings yet. Create a journal entry and select this investment with a signed quantity
							(buy = positive, sell = negative).
						</span>
					</div>
				{:else}
					<div class="overflow-x-auto">
						<table class="table table-sm">
							<thead>
								<tr>
									<th>Date</th>
									<th>Description</th>
									<th class="text-right">Amount</th>
									<th class="text-right">Qty</th>
									<th class="text-right">Running qty</th>
									<th class="text-right">Running cost</th>
								</tr>
							</thead>
							<tbody>
								{#each [...entryRuns].reverse() as row}
									<tr>
										<td class="text-xs whitespace-nowrap">{formatDate(row.entry.entryDate)}</td>
										<td class="text-sm max-w-xs truncate">{row.entry.description}</td>
										<td class="text-right font-mono text-sm">{fmt(row.entry.amountInUSD)}</td>
										<td class="text-right font-mono text-sm font-semibold {(row.entry.investmentQuantity ?? 0) >= 0 ? 'text-success' : 'text-error'}">
											{(row.entry.investmentQuantity ?? 0) > 0 ? '+' : ''}{fmtQty(row.entry.investmentQuantity ?? 0)}
										</td>
										<td class="text-right font-mono text-sm">{fmtQty(row.runningQty)}</td>
										<td class="text-right font-mono text-sm">{fmt(row.runningCost)}</td>
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

{#if showEdit && investment}
	<div class="modal modal-open">
		<div class="modal-box max-w-lg">
			<h3 class="font-bold text-lg mb-4">Edit investment</h3>
			{#if formError}
				<div class="alert alert-error mb-3 text-sm"><span>{formError}</span></div>
			{/if}
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
				<div class="form-control sm:col-span-2">
					<label class="label"><span class="label-text">Name</span></label>
					<input class="input input-bordered" bind:value={form.name} />
				</div>
				<div class="form-control">
					<label class="label"><span class="label-text">Symbol</span></label>
					<input class="input input-bordered" bind:value={form.symbol} />
				</div>
				<div class="form-control">
					<label class="label"><span class="label-text">Unit</span></label>
					<input class="input input-bordered" bind:value={form.unit} />
				</div>
				<div class="form-control sm:col-span-2">
					<label class="label"><span class="label-text">Category</span></label>
					<input class="input input-bordered" bind:value={form.category} list="inv-cat-detail" />
					<datalist id="inv-cat-detail">
						{#each categories as cat}<option value={cat}></option>{/each}
					</datalist>
				</div>
				<div class="form-control sm:col-span-2">
					<label class="label"><span class="label-text">Balance sheet account</span></label>
					<select class="select select-bordered" bind:value={form.assetAccountId}>
						{#each assetSubledgers as acc}
							<option value={acc.id}>{acc.accountNumber} — {acc.name}</option>
						{/each}
					</select>
				</div>
				<div class="form-control">
					<label class="label"><span class="label-text">Current price</span></label>
					<input type="number" class="input input-bordered font-mono" step="any" min="0" bind:value={form.currentPrice} />
				</div>
				<div class="form-control sm:col-span-2">
					<label class="label"><span class="label-text">Description</span></label>
					<textarea class="textarea textarea-bordered" rows="2" bind:value={form.description}></textarea>
				</div>
			</div>
			<div class="modal-action">
				<button class="btn btn-ghost" onclick={() => (showEdit = false)} disabled={saving}>Cancel</button>
				<button class="btn btn-primary" onclick={saveEdit} disabled={saving}>
					{#if saving}<span class="loading loading-spinner loading-sm"></span>{/if}
					Save
				</button>
			</div>
		</div>
		<button type="button" class="modal-backdrop" onclick={() => (showEdit = false)} aria-label="Close"></button>
	</div>
{/if}
