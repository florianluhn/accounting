<script lang="ts">
	import { inventoryAPI, type InventoryCategory, type InventorySummary, type FinishedGoodSummaryItem, type FieldDefinition } from '$lib/api';

	let categories = $state<InventoryCategory[]>([]);
	let summary = $state<InventorySummary | null>(null);
	let loading = $state(true);
	let error = $state('');

	// Clickable stat drill-down
	let activeFgFilter = $state<string | null>(null);
	let fgItems = $state<FinishedGoodSummaryItem[]>([]);
	let fgItemsLoading = $state(false);

	async function toggleFgFilter(disposition: string) {
		if (activeFgFilter === disposition) {
			activeFgFilter = null;
			fgItems = [];
			return;
		}
		activeFgFilter = disposition;
		fgItemsLoading = true;
		try {
			fgItems = await inventoryAPI.listFinishedGoods(disposition);
		} catch (_) {
			fgItems = [];
		} finally {
			fgItemsLoading = false;
		}
	}

	let showModal = $state(false);
	let editingCategory = $state<InventoryCategory | null>(null);

	const CATEGORY_TYPE_LABELS: Record<string, string> = {
		raw_material: 'Raw Material',
		finished_good: 'Finished Good',
		other: 'Other'
	};

	const emptyForm = () => ({
		name: '',
		description: '',
		categoryType: 'other' as 'raw_material' | 'finished_good' | 'other',
		quantityField: '',
		fieldDefinitions: [] as FieldDefinition[],
		valueFormula: ''
	});

	let formData = $state(emptyForm());

	// New field row being built
	let newField = $state<FieldDefinition>({ key: '', label: '', type: 'number', unit: '', formula: '' });
	let fieldError = $state('');

	$effect(() => { loadAll(); });

	async function loadAll() {
		try {
			loading = true;
			error = '';
			[categories, summary] = await Promise.all([
				inventoryAPI.listCategories(),
				inventoryAPI.getSummary()
			]);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load inventory';
		} finally {
			loading = false;
		}
	}

	// ── Modal helpers ────────────────────────────────────────────────────────

	function openCreate() {
		formData = emptyForm();
		editingCategory = null;
		newField = { key: '', label: '', type: 'number', unit: '', formula: '' };
		fieldError = '';
		showModal = true;
	}

	function openEdit(cat: InventoryCategory) {
		formData = {
			name: cat.name,
			description: cat.description || '',
			categoryType: (cat.categoryType as any) || 'other',
			quantityField: cat.quantityField || '',
			fieldDefinitions: cat.fieldDefinitions.map(f => ({ ...f })),
			valueFormula: cat.valueFormula
		};
		editingCategory = cat;
		newField = { key: '', label: '', type: 'number', unit: '', formula: '' };
		fieldError = '';
		showModal = true;
	}

	function closeModal() { showModal = false; editingCategory = null; }

	// ── Field builder ────────────────────────────────────────────────────────

	function labelToKey(label: string): string {
		return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
	}

	function onLabelInput() {
		if (!newField.key || newField.key === labelToKey(newField.label.slice(0, -1))) {
			newField.key = labelToKey(newField.label);
		}
	}

	function addField() {
		fieldError = '';
		if (!newField.label.trim()) { fieldError = 'Label is required'; return; }
		if (!newField.key.trim()) { fieldError = 'Key is required'; return; }
		if (!/^[a-z_][a-z0-9_]*$/.test(newField.key)) { fieldError = 'Key must be snake_case (letters, digits, underscores)'; return; }
		if (formData.fieldDefinitions.some(f => f.key === newField.key)) { fieldError = `Key "${newField.key}" already used`; return; }
		if (newField.type === 'computed' && !newField.formula?.trim()) { fieldError = 'Formula is required for computed fields'; return; }

		formData.fieldDefinitions = [...formData.fieldDefinitions, { ...newField }];
		newField = { key: '', label: '', type: 'number', unit: '', formula: '' };
	}

	function removeField(key: string) {
		formData.fieldDefinitions = formData.fieldDefinitions.filter(f => f.key !== key);
	}

	function moveField(index: number, dir: -1 | 1) {
		const arr = [...formData.fieldDefinitions];
		const target = index + dir;
		if (target < 0 || target >= arr.length) return;
		[arr[index], arr[target]] = [arr[target], arr[index]];
		formData.fieldDefinitions = arr;
	}

	// Available keys for formula hint
	let availableKeys = $derived(formData.fieldDefinitions.map(f => f.key));

	// ── Submit ───────────────────────────────────────────────────────────────

	async function handleSubmit() {
		try {
			error = '';
			if (formData.fieldDefinitions.length === 0) { error = 'Add at least one field'; return; }

			const payload = {
				name: formData.name,
				description: formData.description || undefined,
				categoryType: formData.categoryType,
				quantityField: formData.categoryType === 'raw_material' ? (formData.quantityField || undefined) : undefined,
				fieldDefinitions: formData.fieldDefinitions,
				valueFormula: formData.valueFormula
			};

			if (editingCategory) {
				await inventoryAPI.updateCategory(editingCategory.id, payload);
			} else {
				await inventoryAPI.createCategory(payload);
			}
			await loadAll();
			closeModal();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save category';
		}
	}

	async function handleDelete(id: number, name: string) {
		if (!confirm(`Delete category "${name}"? All inventory items in this category will also be deleted.`)) return;
		try {
			error = '';
			await inventoryAPI.deleteCategory(id);
			await loadAll();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to delete category';
		}
	}

	function formatCurrency(n: number) {
		return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
	}

	function formatQty(n: number) {
		return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
	}

	// Find the human-readable unit label for the quantityField of a raw material category
	function getRawMaterialUnit(rm: InventorySummary['rawMaterials'][number]): string {
		if (!rm.quantityField) return 'units';
		const field = rm.fieldDefinitions.find(f => f.key === rm.quantityField);
		return field?.unit || field?.label || rm.quantityField;
	}
</script>

<div class="page-shell">
	<div class="mb-8">
		<p class="section-label mb-2">Stock</p>
		<h1 class="page-title">Inventory</h1>
		<p class="page-subtitle">Categories, materials, and finished goods</p>
	</div>

	{#if error}
		<div class="alert alert-error mb-6">
			<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
			</svg>
			<span>{error}</span>
		</div>
	{/if}

	<div class="flex justify-end mb-6">
		<button class="btn btn-primary" onclick={openCreate}>+ New Category</button>
	</div>

	{#if summary && !loading}
		<!-- Finished Goods Summary -->
		<div class="card bg-base-100 shadow-xl mb-6">
			<div class="card-body pb-3">
				<h2 class="card-title text-base mb-3">
					<span class="badge badge-success badge-sm">Finished Goods</span>
					Overview
					<span class="text-sm font-normal text-base-content/50 ml-auto">{summary.finishedGoods.totalCount} total</span>
				</h2>
				<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
					<button
						class="stat bg-base-200 rounded-box px-4 py-3 cursor-pointer hover:bg-success/10 transition-colors text-left {activeFgFilter === 'available' ? 'ring-2 ring-success' : ''}"
						onclick={() => toggleFgFilter('available')}
					>
						<div class="stat-title text-xs">Available</div>
						<div class="stat-value text-2xl text-success">{summary.finishedGoods.availableCount}</div>
						<div class="stat-desc font-mono">{formatCurrency(summary.finishedGoods.availableValue)}</div>
					</button>
					<button
						class="stat bg-base-200 rounded-box px-4 py-3 cursor-pointer hover:bg-primary/10 transition-colors text-left {activeFgFilter === 'sale' ? 'ring-2 ring-primary' : ''}"
						onclick={() => toggleFgFilter('sale')}
					>
						<div class="stat-title text-xs">Sold</div>
						<div class="stat-value text-2xl text-primary">{summary.finishedGoods.soldCount}</div>
						<div class="stat-desc font-mono">{formatCurrency(summary.finishedGoods.soldValue)}</div>
					</button>
					<button
						class="stat bg-base-200 rounded-box px-4 py-3 cursor-pointer hover:bg-warning/10 transition-colors text-left {activeFgFilter === 'own_use' ? 'ring-2 ring-warning' : ''}"
						onclick={() => toggleFgFilter('own_use')}
					>
						<div class="stat-title text-xs">Own Use</div>
						<div class="stat-value text-2xl text-warning">{summary.finishedGoods.ownUseCount}</div>
						<div class="stat-desc font-mono">{formatCurrency(summary.finishedGoods.ownUseValue)}</div>
					</button>
					<button
						class="stat bg-base-200 rounded-box px-4 py-3 cursor-pointer hover:bg-secondary/10 transition-colors text-left {activeFgFilter === 'gift' ? 'ring-2 ring-secondary' : ''}"
						onclick={() => toggleFgFilter('gift')}
					>
						<div class="stat-title text-xs">Gifted</div>
						<div class="stat-value text-2xl text-secondary">{summary.finishedGoods.giftCount}</div>
						<div class="stat-desc font-mono">{formatCurrency(summary.finishedGoods.giftValue)}</div>
					</button>
				</div>

				<!-- Drill-down item list -->
				{#if activeFgFilter}
					<div class="mt-3 border-t border-base-300 pt-3">
						{#if fgItemsLoading}
							<div class="flex justify-center py-4"><span class="loading loading-spinner loading-sm"></span></div>
						{:else if fgItems.length === 0}
							<p class="text-sm text-base-content/50">No items.</p>
						{:else}
							<div class="overflow-x-auto">
								<table class="table table-sm table-zebra">
									<thead>
										<tr>
											<th>Item</th>
											<th>Category</th>
											<th class="text-right">Value</th>
										</tr>
									</thead>
									<tbody>
										{#each fgItems as item}
											<tr>
												<td><a href="/inventory/{item.categoryId}" class="link link-hover">{item.name}</a></td>
												<td class="text-sm text-base-content/70">{item.categoryName}</td>
												<td class="text-right font-mono">{formatCurrency(item.totalValue)}</td>
											</tr>
										{/each}
									</tbody>
									<tfoot>
										<tr>
											<td colspan="2" class="font-bold">Total</td>
											<td class="text-right font-mono font-bold">{formatCurrency(fgItems.reduce((s, i) => s + i.totalValue, 0))}</td>
										</tr>
									</tfoot>
								</table>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		<!-- Raw Materials Summary -->
		{#if summary.rawMaterials.length > 0}
			<div class="card bg-base-100 shadow-xl mb-6">
				<div class="card-body">
					<h2 class="card-title text-base">
						<span class="badge badge-warning badge-sm">Raw Materials</span>
						Remaining Stock
					</h2>
					<div class="mt-2 space-y-3">
						{#each summary.rawMaterials as rm}
							<div>
								<div class="flex justify-between items-baseline">
									<a href="/inventory/{rm.categoryId}" class="link link-hover text-sm font-medium">{rm.categoryName}</a>
									<span class="text-xs text-base-content/60">{rm.itemCount} item{rm.itemCount === 1 ? '' : 's'}</span>
								</div>
								<div class="flex justify-between items-baseline mt-0.5">
									<span class="text-lg font-bold font-mono">
										{formatQty(rm.totalRemainingQuantity)}
										<span class="text-xs font-normal text-base-content/60 ml-1">{getRawMaterialUnit(rm)}</span>
									</span>
									<span class="text-sm text-base-content/70">{formatCurrency(rm.totalRemainingValue)}</span>
								</div>
								<div class="divider my-1"></div>
							</div>
						{/each}
					</div>
				</div>
			</div>
		{/if}
	{/if}

	<div class="card bg-base-100 shadow-xl">
		<div class="card-body">
			{#if loading}
				<div class="flex justify-center py-8"><span class="loading loading-spinner loading-lg"></span></div>
			{:else if categories.length === 0}
				<div class="alert alert-info">
					<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
					</svg>
					<span>No inventory categories yet. Create a category first to start tracking inventory.</span>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="table table-zebra">
						<thead>
							<tr>
								<th>Category</th>
								<th>Fields</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each categories as cat}
								<tr>
									<td>
										<a href="/inventory/{cat.id}" class="link link-primary font-medium">{cat.name}</a>
										<div class="flex items-center gap-2 mt-0.5">
											<span class="badge badge-xs {cat.categoryType === 'raw_material' ? 'badge-warning' : cat.categoryType === 'finished_good' ? 'badge-success' : 'badge-ghost'}">
												{CATEGORY_TYPE_LABELS[cat.categoryType] ?? cat.categoryType}
											</span>
											{#if cat.description}
												<span class="text-xs text-base-content/60">{cat.description}</span>
											{/if}
										</div>
									</td>
									<td>
										<div class="flex flex-wrap gap-1">
											{#each cat.fieldDefinitions as f}
												<span class="badge badge-sm {f.type === 'computed' ? 'badge-secondary' : 'badge-ghost'}">{f.label}</span>
											{/each}
										</div>
									</td>
									<td>
										<div class="flex gap-2">
											<a href="/inventory/{cat.id}" class="btn btn-sm btn-ghost">View</a>
											<button class="btn btn-sm btn-ghost" onclick={() => openEdit(cat)}>Edit</button>
											<button class="btn btn-sm btn-ghost text-error" onclick={() => handleDelete(cat.id, cat.name)}>Delete</button>
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

<!-- Category Modal -->
{#if showModal}
	<div class="modal modal-open">
		<div class="modal-box max-w-3xl max-h-[90vh] overflow-y-auto">
			<h3 class="font-bold text-lg mb-6">{editingCategory ? 'Edit Category' : 'New Inventory Category'}</h3>

			<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>

				<!-- Basic info -->
				<div class="grid grid-cols-2 gap-4 mb-6">
					<div class="form-control col-span-2">
						<label class="label"><span class="label-text">Category Name</span></label>
						<input type="text" class="input input-bordered" bind:value={formData.name} required placeholder="e.g. Lumber" />
					</div>
					<div class="form-control col-span-2">
						<label class="label"><span class="label-text">Description (Optional)</span></label>
						<input type="text" class="input input-bordered" bind:value={formData.description} placeholder="Short description" />
					</div>
					<div class="form-control col-span-2">
						<label class="label"><span class="label-text">Category Type</span></label>
						<select class="select select-bordered" bind:value={formData.categoryType}>
							<option value="raw_material">Raw Material</option>
							<option value="finished_good">Finished Good</option>
							<option value="other">Other</option>
						</select>
					</div>
					{#if formData.categoryType === 'raw_material'}
						<div class="form-control col-span-2">
							<label class="label">
								<span class="label-text">Quantity Field</span>
								<span class="label-text-alt text-xs text-base-content/50">Which field key tracks the consumable quantity (e.g. board_feet). Used to calculate remaining stock after consumption.</span>
							</label>
							<select class="select select-bordered" bind:value={formData.quantityField}>
								<option value="">Select after adding fields…</option>
								{#each formData.fieldDefinitions as f}
									<option value={f.key}>{f.label} ({f.key})</option>
								{/each}
							</select>
						</div>
					{/if}
				</div>

				<div class="divider">Field Definitions</div>

				<!-- Existing fields -->
				{#if formData.fieldDefinitions.length > 0}
					<div class="overflow-x-auto mb-4">
						<table class="table table-sm">
							<thead>
								<tr>
									<th>Label</th>
									<th>Key</th>
									<th>Type</th>
									<th>Unit</th>
									<th>Formula</th>
									<th></th>
								</tr>
							</thead>
							<tbody>
								{#each formData.fieldDefinitions as field, i}
									<tr>
										<td class="font-medium">{field.label}</td>
										<td class="font-mono text-xs text-base-content/60">{field.key}</td>
										<td>
											<span class="badge badge-sm {field.type === 'computed' ? 'badge-secondary' : field.type === 'text' ? 'badge-ghost' : 'badge-outline'}">
												{field.type}
											</span>
										</td>
										<td>{field.unit || '—'}</td>
										<td class="font-mono text-xs">{field.formula || '—'}</td>
										<td>
											<div class="flex gap-1">
												<button type="button" class="btn btn-xs btn-ghost" onclick={() => moveField(i, -1)} disabled={i === 0}>↑</button>
												<button type="button" class="btn btn-xs btn-ghost" onclick={() => moveField(i, 1)} disabled={i === formData.fieldDefinitions.length - 1}>↓</button>
												<button type="button" class="btn btn-xs btn-ghost text-error" onclick={() => removeField(field.key)}>✕</button>
											</div>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}

				<!-- Add new field row -->
				<div class="card bg-base-200 p-4 mb-2">
					<p class="text-sm font-semibold mb-3">Add Field</p>
					<div class="grid grid-cols-2 gap-3">
						<div class="form-control">
							<label class="label py-0"><span class="label-text text-xs">Label</span></label>
							<input type="text" class="input input-bordered input-sm" bind:value={newField.label} oninput={onLabelInput} placeholder="e.g. Board Feet" />
						</div>
						<div class="form-control">
							<label class="label py-0"><span class="label-text text-xs">Key <span class="text-base-content/40">(used in formulas)</span></span></label>
							<input type="text" class="input input-bordered input-sm font-mono" bind:value={newField.key} placeholder="e.g. board_feet" />
						</div>
						<div class="form-control">
							<label class="label py-0"><span class="label-text text-xs">Type</span></label>
							<select class="select select-bordered select-sm" bind:value={newField.type}>
								<option value="number">Number</option>
								<option value="text">Text</option>
								<option value="computed">Computed</option>
							</select>
						</div>
						<div class="form-control">
							<label class="label py-0"><span class="label-text text-xs">Unit (Optional)</span></label>
							<input type="text" class="input input-bordered input-sm" bind:value={newField.unit} placeholder="e.g. in, ft, bf" />
						</div>
						{#if newField.type === 'computed'}
							<div class="form-control col-span-2">
								<label class="label py-0">
									<span class="label-text text-xs">Formula</span>
									{#if availableKeys.length > 0}
										<span class="label-text-alt text-xs text-base-content/50">Available keys: {availableKeys.join(', ')}</span>
									{/if}
								</label>
								<input type="text" class="input input-bordered input-sm font-mono" bind:value={newField.formula} placeholder="e.g. thickness * width * length / 12" />
							</div>
						{/if}
					</div>
					{#if fieldError}
						<p class="text-error text-xs mt-2">{fieldError}</p>
					{/if}
					<button type="button" class="btn btn-sm btn-outline mt-3" onclick={addField}>+ Add Field</button>
				</div>

				<div class="divider">Value Formula</div>

				{#if formData.categoryType === 'finished_good'}
					<div class="alert alert-info text-sm mb-6">
						<span>
							For finished goods, <strong>Value</strong> is the cost of raw materials assigned to each item (Materials),
							not this formula. Use a field such as Price for the selling price. The formula below is unused for finished goods.
						</span>
					</div>
				{/if}

				<div class="form-control mb-6">
					<label class="label">
						<span class="label-text">Value Formula <span class="text-base-content/50 text-xs">(optional — computes $ value per item for balance sheet)</span></span>
						{#if availableKeys.length > 0}
							<span class="label-text-alt text-xs text-base-content/50">Keys: {availableKeys.join(', ')}</span>
						{/if}
					</label>
					<input
						type="text"
						class="input input-bordered font-mono"
						bind:value={formData.valueFormula}
						placeholder="e.g. board_feet * price_per_bf"
						disabled={formData.categoryType === 'finished_good'}
					/>
					<label class="label">
						<span class="label-text-alt text-xs text-base-content/50">
							{formData.categoryType === 'finished_good'
								? 'Finished-good value is calculated from material allocations.'
								: 'This value is stored per item and used for tracking purposes.'}
						</span>
					</label>
				</div>

				<div class="modal-action">
					<button type="button" class="btn" onclick={closeModal}>Cancel</button>
					<button type="submit" class="btn btn-primary">{editingCategory ? 'Save Changes' : 'Create Category'}</button>
				</div>
			</form>
		</div>
		<div class="modal-backdrop" onclick={closeModal}></div>
	</div>
{/if}
