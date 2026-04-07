<script lang="ts">
	import { inventoryAPI, type InventoryCategory, type FieldDefinition } from '$lib/api';

	let categories = $state<InventoryCategory[]>([]);
	let loading = $state(true);
	let error = $state('');

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
			categories = await inventoryAPI.listCategories();
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
</script>

<div class="max-w-7xl mx-auto">
	<div class="mb-8">
		<h1 class="text-4xl font-bold mb-2">Inventory</h1>
		<p class="text-base-content/70">Manage inventory categories and items</p>
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
								<th class="text-right">Items</th>
								<th class="text-right">Total Value</th>
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
									<td class="text-right font-mono">{cat.itemCount ?? 0}</td>
									<td class="text-right font-mono font-bold">{formatCurrency(cat.totalValue ?? 0)}</td>
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
						<tfoot>
							<tr>
								<td colspan="3" class="font-bold">Total Inventory Value</td>
								<td class="text-right font-mono font-bold text-primary">
									{formatCurrency(categories.reduce((s, c) => s + (c.totalValue ?? 0), 0))}
								</td>
								<td></td>
							</tr>
						</tfoot>
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
					/>
					<label class="label">
						<span class="label-text-alt text-xs text-base-content/50">This value is stored per item and used for tracking purposes.</span>
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
