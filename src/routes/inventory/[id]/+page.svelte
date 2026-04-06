<script lang="ts">
	import { page } from '$app/stores';
	import {
		inventoryAPI,
		type InventoryCategory,
		type InventoryItem,
		type FieldDefinition,
		type MaterialAllocation,
		type RawMaterialItem
	} from '$lib/api';

	let category = $state<InventoryCategory | null>(null);
	let items = $state<InventoryItem[]>([]);
	let loading = $state(true);
	let error = $state('');

	// Item create/edit modal
	let showItemModal = $state(false);
	let editingItem = $state<InventoryItem | null>(null);
	let itemName = $state('');
	let itemFieldValues = $state<Record<string, string | number>>({});

	// Allocation modal (shown on a finished good item)
	let showAllocModal = $state(false);
	let allocatingForItem = $state<InventoryItem | null>(null);
	let itemAllocations = $state<MaterialAllocation[]>([]);
	let rawMaterialItems = $state<RawMaterialItem[]>([]);
	let allocForm = $state({ rawMaterialItemId: 0, quantityUsed: 0, notes: '', allocationDate: '' });
	let allocLoading = $state(false);

	// Usage modal (shown on a raw material item)
	let showUsageModal = $state(false);
	let usageForItem = $state<InventoryItem | null>(null);
	let usageAllocations = $state<MaterialAllocation[]>([]);

	$effect(() => {
		const id = parseInt($page.params.id);
		if (!isNaN(id)) loadData(id);
	});

	async function loadData(id: number) {
		try {
			loading = true;
			error = '';
			[category, items] = await Promise.all([
				inventoryAPI.getCategory(id),
				inventoryAPI.listItems(id)
			]);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load category';
		} finally {
			loading = false;
		}
	}

	// ── Formula evaluation (client-side preview) ─────────────────────────────

	function evaluateFormula(formula: string, vars: Record<string, number>): number {
		try {
			const keys = Object.keys(vars);
			const values = Object.values(vars);
			const fn = new Function(...keys, `"use strict"; return Number(${formula});`);
			const result = fn(...values);
			return isFinite(result) && !isNaN(result) ? Math.round(result * 100000) / 100000 : 0;
		} catch { return 0; }
	}

	function resolveFormValues(fieldDefs: FieldDefinition[], values: Record<string, string | number>): Record<string, string | number> {
		const numVars: Record<string, number> = {};
		const result: Record<string, string | number> = {};
		for (const f of fieldDefs) {
			if (f.type === 'number') {
				const v = Number(values[f.key] ?? 0);
				numVars[f.key] = v; result[f.key] = v;
			} else if (f.type === 'text') {
				result[f.key] = values[f.key] ?? '';
			} else if (f.type === 'computed' && f.formula) {
				const v = evaluateFormula(f.formula, numVars);
				numVars[f.key] = v; result[f.key] = v;
			}
		}
		return result;
	}

	let resolvedPreview = $derived(
		category ? resolveFormValues(category.fieldDefinitions, itemFieldValues) : {}
	);
	let previewTotalValue = $derived(
		category ? evaluateFormula(
			category.valueFormula,
			Object.fromEntries(Object.entries(resolvedPreview).filter(([, v]) => typeof v === 'number')) as Record<string, number>
		) : 0
	);

	// ── Item modal ────────────────────────────────────────────────────────────

	function initFieldValues() {
		if (!category) return {};
		const vals: Record<string, string | number> = {};
		for (const f of category.fieldDefinitions) {
			if (f.type !== 'computed') vals[f.key] = f.type === 'number' ? 0 : '';
		}
		return vals;
	}

	function openCreate() {
		editingItem = null;
		itemName = '';
		itemFieldValues = initFieldValues();
		showItemModal = true;
	}

	function openEdit(item: InventoryItem) {
		editingItem = item;
		itemName = item.name;
		const vals: Record<string, string | number> = {};
		if (category) {
			for (const f of category.fieldDefinitions) {
				if (f.type !== 'computed') vals[f.key] = item.fieldValues[f.key] ?? (f.type === 'number' ? 0 : '');
			}
		}
		itemFieldValues = vals;
		showItemModal = true;
	}

	function closeItemModal() { showItemModal = false; editingItem = null; }

	async function handleItemSubmit() {
		if (!category) return;
		try {
			error = '';
			const payload = { name: itemName, fieldValues: itemFieldValues };
			if (editingItem) {
				await inventoryAPI.updateItem(editingItem.id, payload);
			} else {
				await inventoryAPI.createItem(category.id, payload);
			}
			items = await inventoryAPI.listItems(category.id);
			category = await inventoryAPI.getCategory(category.id);
			closeItemModal();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save item';
		}
	}

	async function handleDeleteItem(id: number) {
		if (!confirm('Delete this item? Any material allocations linked to it will also be removed.')) return;
		if (!category) return;
		try {
			error = '';
			await inventoryAPI.deleteItem(id);
			items = await inventoryAPI.listItems(category.id);
			category = await inventoryAPI.getCategory(category.id);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to delete item';
		}
	}

	// ── Allocation modal (on finished good) ───────────────────────────────────

	async function openAllocModal(item: InventoryItem) {
		allocatingForItem = item;
		allocForm = { rawMaterialItemId: 0, quantityUsed: 0, notes: '', allocationDate: new Date().toISOString().slice(0, 10) };
		allocLoading = true;
		showAllocModal = true;
		try {
			const [allocData, rawItems] = await Promise.all([
				inventoryAPI.getItemAllocations(item.id),
				inventoryAPI.listRawMaterialItems()
			]);
			itemAllocations = allocData.asFinishedGood;
			rawMaterialItems = rawItems;
			// Default date to today
			const today = new Date().toISOString().slice(0, 10);
			allocForm = { rawMaterialItemId: 0, quantityUsed: 0, notes: '', allocationDate: today };
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load allocations';
		} finally {
			allocLoading = false;
		}
	}

	function closeAllocModal() { showAllocModal = false; allocatingForItem = null; }

	async function handleAddAllocation() {
		if (!allocatingForItem || allocForm.rawMaterialItemId === 0 || allocForm.quantityUsed <= 0) return;
		try {
			error = '';
			await inventoryAPI.createAllocation({
				rawMaterialItemId: allocForm.rawMaterialItemId,
				finishedGoodItemId: allocatingForItem.id,
				quantityUsed: allocForm.quantityUsed,
				notes: allocForm.notes || undefined,
				allocationDate: allocForm.allocationDate || undefined
			});
			// Refresh allocations and item list (remaining values changed)
			const [allocData, refreshedItems, refreshedCat] = await Promise.all([
				inventoryAPI.getItemAllocations(allocatingForItem.id),
				inventoryAPI.listItems(category!.id),
				inventoryAPI.getCategory(category!.id)
			]);
			itemAllocations = allocData.asFinishedGood;
			items = refreshedItems;
			category = refreshedCat;
			allocForm = { rawMaterialItemId: 0, quantityUsed: 0, notes: '', allocationDate: new Date().toISOString().slice(0, 10) };
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to add allocation';
		}
	}

	async function handleDeleteAllocation(allocId: number) {
		if (!confirm('Remove this material allocation? The raw material stock will be restored.')) return;
		try {
			error = '';
			await inventoryAPI.deleteAllocation(allocId);
			const [allocData, refreshedItems, refreshedCat] = await Promise.all([
				inventoryAPI.getItemAllocations(allocatingForItem!.id),
				inventoryAPI.listItems(category!.id),
				inventoryAPI.getCategory(category!.id)
			]);
			itemAllocations = allocData.asFinishedGood;
			items = refreshedItems;
			category = refreshedCat;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to remove allocation';
		}
	}

	// ── Usage modal (on raw material) ─────────────────────────────────────────

	async function openUsageModal(item: InventoryItem) {
		usageForItem = item;
		showUsageModal = true;
		try {
			const allocData = await inventoryAPI.getItemAllocations(item.id);
			usageAllocations = allocData.asRawMaterial;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load usage';
		}
	}

	function closeUsageModal() { showUsageModal = false; usageForItem = null; }

	// ── Derived helpers ───────────────────────────────────────────────────────

	let isRawMaterial = $derived(category?.categoryType === 'raw_material');
	let inputFields = $derived(category?.fieldDefinitions.filter(f => f.type !== 'computed') ?? []);
	let allFields = $derived(category?.fieldDefinitions ?? []);
	let totalValue = $derived(category?.totalValue ?? 0);

	// Selected raw material item info for alloc form
	let selectedRawItem = $derived(
		rawMaterialItems.find(r => r.id === allocForm.rawMaterialItemId) ?? null
	);

	function formatCurrency(n: number) {
		return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
	}

	function formatValue(field: FieldDefinition, val: string | number | undefined): string {
		if (val === undefined || val === null || val === '') return '—';
		if (field.type === 'number' || field.type === 'computed') {
			const num = Number(val);
			return isNaN(num) ? '—' : `${num.toLocaleString('en-US', { maximumFractionDigits: 4 })}${field.unit ? ' ' + field.unit : ''}`;
		}
		return String(val);
	}

	function remainingPct(item: InventoryItem): number {
		if (!category?.quantityField) return 100;
		const total = Number(item.fieldValues[category.quantityField] ?? 0);
		const remaining = item.remainingQuantity ?? total;
		return total > 0 ? (remaining / total) * 100 : 0;
	}

	// ── CSV import/export ─────────────────────────────────────────────────────

	let csvResult = $state<{ imported: number; skipped: number; errors: string[] } | null>(null);
	let csvLoading = $state(false);

	async function handleDownloadCSV() {
		if (!category) return;
		try {
			await inventoryAPI.downloadCSV(category.id, category.name);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Download failed';
		}
	}

	async function handleUploadCSV(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !category) return;
		csvLoading = true;
		csvResult = null;
		try {
			csvResult = await inventoryAPI.uploadCSV(category.id, file);
			items = await inventoryAPI.listItems(category.id);
			category = await inventoryAPI.getCategory(category.id);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Upload failed';
		} finally {
			csvLoading = false;
			input.value = '';
		}
	}
</script>

<div class="max-w-7xl mx-auto">
	{#if loading}
		<div class="flex justify-center py-8"><span class="loading loading-spinner loading-lg"></span></div>
	{:else if error && !category}
		<div class="alert alert-error mb-6"><span>{error}</span></div>
		<a href="/inventory" class="btn btn-ghost">Back to Inventory</a>
	{:else if category}

		<!-- Header -->
		<div class="mb-8 flex justify-between items-start flex-wrap gap-4">
			<div>
				<div class="text-sm breadcrumbs mb-2">
					<ul>
						<li><a href="/inventory">Inventory</a></li>
						<li>{category.name}</li>
					</ul>
				</div>
				<div class="flex items-center gap-3 mb-1">
					<h1 class="text-4xl font-bold">{category.name}</h1>
					<span class="badge badge-lg {isRawMaterial ? 'badge-warning' : category.categoryType === 'finished_good' ? 'badge-success' : 'badge-ghost'}">
						{isRawMaterial ? 'Raw Material' : category.categoryType === 'finished_good' ? 'Finished Good' : 'Other'}
					</span>
				</div>
				{#if category.description}
					<p class="text-base-content/60">{category.description}</p>
				{/if}
			</div>
			<div class="flex gap-2 flex-wrap">
				<button class="btn btn-ghost btn-sm" onclick={handleDownloadCSV}>↓ Export CSV</button>
				<label class="btn btn-ghost btn-sm {csvLoading ? 'loading' : ''}">
					↑ Import CSV
					<input type="file" accept=".csv" class="hidden" onchange={handleUploadCSV} disabled={csvLoading} />
				</label>
				<button class="btn btn-primary" onclick={openCreate}>+ Add Item</button>
			</div>
		</div>

		{#if error}
			<div class="alert alert-error mb-6"><span>{error}</span></div>
		{/if}

		{#if csvResult}
			<div class="alert {csvResult.errors.length > 0 ? 'alert-warning' : 'alert-success'} mb-6">
				<span>Imported {csvResult.imported} item{csvResult.imported !== 1 ? 's' : ''}{csvResult.skipped > 0 ? `, skipped ${csvResult.skipped}` : ''}.{csvResult.errors.length > 0 ? ' Errors: ' + csvResult.errors.join('; ') : ''}</span>
				<button class="btn btn-xs btn-ghost ml-auto" onclick={() => csvResult = null}>✕</button>
			</div>
		{/if}

		<!-- Stats row -->
		<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
			<div class="stat bg-base-100 shadow rounded-box">
				<div class="stat-title">Asset Account</div>
				<div class="stat-value text-lg">{category.accountNumber}</div>
				<div class="stat-desc">{category.accountName}</div>
			</div>
			<div class="stat bg-base-100 shadow rounded-box">
				<div class="stat-title">Items</div>
				<div class="stat-value">{items.length}</div>
			</div>
			<div class="stat bg-base-100 shadow rounded-box">
				<div class="stat-title">{isRawMaterial ? 'Remaining Value' : 'Total Value'}</div>
				<div class="stat-value text-primary text-2xl">{formatCurrency(totalValue)}</div>
				<div class="stat-desc">On balance sheet</div>
			</div>
		</div>

		<!-- Field reference -->
		<div class="card bg-base-100 shadow-xl mb-6">
			<div class="card-body py-4">
				<h2 class="font-semibold text-sm text-base-content/60 mb-2">FIELDS</h2>
				<div class="flex flex-wrap gap-2">
					{#each category.fieldDefinitions as f}
						<div class="badge badge-lg gap-1 {f.type === 'computed' ? 'badge-secondary' : 'badge-outline'}">
							{f.label}
							{#if f.unit}<span class="opacity-60 text-xs">({f.unit})</span>{/if}
							{#if f.type === 'computed'}<span class="opacity-60 text-xs">= {f.formula}</span>{/if}
							{#if isRawMaterial && f.key === category.quantityField}
								<span class="badge badge-xs badge-warning ml-1">qty</span>
							{/if}
						</div>
					{/each}
				</div>
				<p class="text-xs text-base-content/50 mt-1">Value formula: <code class="font-mono">{category.valueFormula}</code></p>
			</div>
		</div>

		<!-- Items table -->
		<div class="card bg-base-100 shadow-xl">
			<div class="card-body">
				<h2 class="card-title mb-4">
					Items <span class="badge badge-neutral">{items.length}</span>
				</h2>

				{#if items.length === 0}
					<div class="alert alert-info">
						<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
						</svg>
						<span>No items yet. Add your first item to this category.</span>
					</div>
				{:else}
					<div class="overflow-x-auto">
						<table class="table table-zebra">
							<thead>
								<tr>
									<th>ID</th>
									{#each allFields as f}
										<th>{f.label}{#if f.unit} <span class="text-xs font-normal opacity-60">({f.unit})</span>{/if}</th>
									{/each}
									{#if isRawMaterial}
										<th>Remaining</th>
									{/if}
									<th class="text-right">{isRawMaterial ? 'Remaining Value' : 'Value'}</th>
									<th>Actions</th>
								</tr>
							</thead>
							<tbody>
								{#each items as item}
									<tr class="{isRawMaterial && (item.remainingQuantity ?? 0) <= 0 ? 'opacity-50' : ''}">
										<td class="font-medium">
								{item.name}
								{#if !isRawMaterial && item.saleEntryId}
									<span class="badge {item.saleEntryType === 'own_use' ? 'badge-warning' : 'badge-success'} badge-xs ml-1">
										{item.saleEntryType === 'own_use' ? 'Own Use' : 'Sold'}
									</span>
								{/if}
							</td>
										{#each allFields as f}
											<td class="{f.type === 'computed' ? 'text-secondary font-mono text-sm' : 'font-mono text-sm'}">
												{formatValue(f, item.fieldValues[f.key])}
											</td>
										{/each}
										{#if isRawMaterial}
											<td class="min-w-32">
												{#if category.quantityField}
													<div class="flex items-center gap-2">
														<progress
															class="progress {remainingPct(item) > 50 ? 'progress-success' : remainingPct(item) > 20 ? 'progress-warning' : 'progress-error'} w-16"
															value={remainingPct(item)}
															max="100"
														></progress>
														<span class="text-xs font-mono">
															{(item.remainingQuantity ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} / {Number(item.fieldValues[category.quantityField] ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
														</span>
													</div>
												{:else}
													<span class="text-xs text-base-content/40">no qty field</span>
												{/if}
											</td>
										{/if}
										<td class="text-right font-mono font-bold">
											{formatCurrency(isRawMaterial ? (item.remainingValue ?? item.totalValue) : item.totalValue)}
										</td>
										<td>
											<div class="flex gap-1 flex-wrap">
												<button class="btn btn-xs btn-ghost" onclick={() => openEdit(item)}>Edit</button>
												{#if isRawMaterial}
													<button class="btn btn-xs btn-ghost" onclick={() => openUsageModal(item)}>Usage</button>
												{:else}
													<button class="btn btn-xs btn-ghost btn-info" onclick={() => openAllocModal(item)}>Materials</button>
												{/if}
												<button class="btn btn-xs btn-ghost text-error" onclick={() => handleDeleteItem(item.id)}>Delete</button>
											</div>
										</td>
									</tr>
								{/each}
							</tbody>
							<tfoot>
								<tr>
									<td colspan={1 + allFields.length + (isRawMaterial ? 1 : 0)} class="font-bold">Total</td>
									<td class="text-right font-mono font-bold text-primary">{formatCurrency(totalValue)}</td>
									<td></td>
								</tr>
							</tfoot>
						</table>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<!-- Item Create/Edit Modal -->
{#if showItemModal && category}
	<div class="modal modal-open">
		<div class="modal-box max-w-xl">
			<h3 class="font-bold text-lg mb-4">{editingItem ? 'Edit Item' : 'Add Item'} — {category.name}</h3>
			<form onsubmit={(e) => { e.preventDefault(); handleItemSubmit(); }}>
				<div class="grid grid-cols-2 gap-4">
					<div class="form-control col-span-2">
						<label class="label"><span class="label-text">ID / Description</span></label>
						<input type="text" class="input input-bordered" bind:value={itemName} required placeholder="e.g. Walnut Board #1 – 4/4 × 8 × 96" />
					</div>
					{#each inputFields as f}
						<div class="form-control">
							<label class="label">
								<span class="label-text">{f.label}{#if f.unit} <span class="text-xs opacity-60">({f.unit})</span>{/if}</span>
							</label>
							{#if f.type === 'number'}
								<input type="number" step="any" class="input input-bordered font-mono" bind:value={itemFieldValues[f.key]} />
							{:else}
								<input type="text" class="input input-bordered" bind:value={itemFieldValues[f.key]} />
							{/if}
						</div>
					{/each}
					{#if category.fieldDefinitions.some(f => f.type === 'computed')}
						<div class="col-span-2">
							<div class="divider my-1 text-xs">Computed</div>
							<div class="grid grid-cols-2 gap-2">
								{#each category.fieldDefinitions.filter(f => f.type === 'computed') as f}
									<div class="bg-base-200 rounded-lg px-3 py-2">
										<div class="text-xs text-base-content/60">{f.label}{#if f.unit} ({f.unit}){/if}</div>
										<div class="font-mono font-bold text-secondary">
											{resolvedPreview[f.key] !== undefined ? Number(resolvedPreview[f.key]).toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—'}
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}
					<div class="col-span-2 bg-primary/10 rounded-lg px-4 py-3 flex justify-between items-center">
						<span class="text-sm font-medium">Item Value</span>
						<span class="font-mono font-bold text-primary text-lg">{formatCurrency(previewTotalValue)}</span>
					</div>
				</div>
				<div class="modal-action">
					<button type="button" class="btn" onclick={closeItemModal}>Cancel</button>
					<button type="submit" class="btn btn-primary">{editingItem ? 'Save Changes' : 'Add Item'}</button>
				</div>
			</form>
		</div>
		<div class="modal-backdrop" onclick={closeItemModal}></div>
	</div>
{/if}

<!-- Materials Modal (finished good → which raw materials went in) -->
{#if showAllocModal && allocatingForItem}
	<div class="modal modal-open">
		<div class="modal-box max-w-2xl">
			<h3 class="font-bold text-lg mb-1">Materials Used</h3>
			<p class="text-sm text-base-content/60 mb-4">{allocatingForItem.name}</p>

			{#if allocLoading}
				<div class="flex justify-center py-4"><span class="loading loading-spinner loading-md"></span></div>
			{:else}
				<!-- Existing allocations -->
				{#if itemAllocations.length > 0}
					<table class="table table-sm mb-4">
						<thead>
							<tr>
								<th>Raw Material</th>
								<th>Date</th>
								<th class="text-right">Qty Used</th>
								<th>Notes</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							{#each itemAllocations as alloc}
								<tr>
									<td class="font-medium">{alloc.rawMaterialName}</td>
									<td class="text-sm text-base-content/60">{alloc.allocationDate || '—'}</td>
									<td class="text-right font-mono">{alloc.quantityUsed}</td>
									<td class="text-sm text-base-content/60">{alloc.notes || '—'}</td>
									<td>
										<button class="btn btn-xs btn-ghost text-error" onclick={() => handleDeleteAllocation(alloc.id)}>Remove</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{:else}
					<p class="text-sm text-base-content/50 mb-4">No materials linked yet.</p>
				{/if}

				<!-- Add allocation form -->
				<div class="divider text-xs">Add Material</div>
				<div class="grid grid-cols-2 gap-3">
					<div class="form-control col-span-2">
						<label class="label py-0"><span class="label-text text-sm">Raw Material Item</span></label>
						<select class="select select-bordered select-sm" bind:value={allocForm.rawMaterialItemId}>
							<option value={0} disabled>Select a raw material…</option>
							{#each rawMaterialItems as rm}
								<option value={rm.id}>
									{rm.categoryName} — {rm.name}
									{rm.remainingQuantity != null ? ` (${rm.remainingQuantity.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${rm.quantityField ?? ''} remaining)` : ''}
								</option>
							{/each}
						</select>
						{#if selectedRawItem && selectedRawItem.remainingQuantity != null}
							<label class="label py-0">
								<span class="label-text-alt text-xs text-base-content/50">
									Available: {selectedRawItem.remainingQuantity.toLocaleString('en-US', { maximumFractionDigits: 4 })} {selectedRawItem.quantityField ?? 'units'} — {formatCurrency(selectedRawItem.remainingValue ?? 0)}
								</span>
							</label>
						{/if}
					</div>
					<div class="form-control">
						<label class="label py-0">
							<span class="label-text text-sm">Quantity Used{selectedRawItem?.quantityField ? ` (${selectedRawItem.quantityField})` : ''}</span>
						</label>
						<input type="number" step="any" min="0.0001" class="input input-bordered input-sm font-mono" bind:value={allocForm.quantityUsed} />
					</div>
					<div class="form-control">
						<label class="label py-0"><span class="label-text text-sm">Date</span></label>
						<input type="date" class="input input-bordered input-sm" bind:value={allocForm.allocationDate} />
					</div>
					<div class="form-control col-span-2">
						<label class="label py-0"><span class="label-text text-sm">Notes (Optional)</span></label>
						<input type="text" class="input input-bordered input-sm" bind:value={allocForm.notes} placeholder="e.g. cut from middle section" />
					</div>
				</div>
				<div class="flex justify-end gap-2 mt-4">
					<button class="btn btn-sm btn-outline" onclick={handleAddAllocation} disabled={allocForm.rawMaterialItemId === 0 || allocForm.quantityUsed <= 0}>
						Add Allocation
					</button>
				</div>
			{/if}

			<div class="modal-action">
				<button class="btn" onclick={closeAllocModal}>Done</button>
			</div>
		</div>
		<div class="modal-backdrop" onclick={closeAllocModal}></div>
	</div>
{/if}

<!-- Usage Modal (raw material → where it was used) -->
{#if showUsageModal && usageForItem}
	<div class="modal modal-open">
		<div class="modal-box max-w-xl">
			<h3 class="font-bold text-lg mb-1">Material Usage</h3>
			<p class="text-sm text-base-content/60 mb-4">{usageForItem.name}</p>

			{#if category?.quantityField}
				<div class="flex gap-4 mb-4">
					<div class="stat bg-base-200 rounded-box p-3 flex-1">
						<div class="stat-title text-xs">Total</div>
						<div class="stat-value text-base font-mono">
							{Number(usageForItem.fieldValues[category.quantityField] ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} {category.quantityField}
						</div>
					</div>
					<div class="stat bg-base-200 rounded-box p-3 flex-1">
						<div class="stat-title text-xs">Consumed</div>
						<div class="stat-value text-base font-mono text-warning">
							{usageAllocations.reduce((s, a) => s + a.quantityUsed, 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} {category.quantityField}
						</div>
					</div>
					<div class="stat bg-base-200 rounded-box p-3 flex-1">
						<div class="stat-title text-xs">Remaining</div>
						<div class="stat-value text-base font-mono text-success">
							{(usageForItem.remainingQuantity ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} {category.quantityField}
						</div>
					</div>
				</div>
			{/if}

			{#if usageAllocations.length === 0}
				<p class="text-sm text-base-content/50">This item has not been allocated to any finished goods yet.</p>
			{:else}
				<table class="table table-sm">
					<thead>
						<tr>
							<th>Used In</th>
							<th class="text-right">Qty Used</th>
							<th>Notes</th>
						</tr>
					</thead>
					<tbody>
						{#each usageAllocations as alloc}
							<tr>
								<td class="font-medium">{alloc.finishedGoodName}</td>
								<td class="text-right font-mono">{alloc.quantityUsed}</td>
								<td class="text-sm text-base-content/60">{alloc.notes || '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}

			<div class="modal-action">
				<button class="btn" onclick={closeUsageModal}>Close</button>
			</div>
		</div>
		<div class="modal-backdrop" onclick={closeUsageModal}></div>
	</div>
{/if}
