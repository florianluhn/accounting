<script lang="ts">
	import { auditLogsAPI, type AuditLog, type AuditLogFilters } from '$lib/api';
	import { onMount } from 'svelte';

	let logs = $state<AuditLog[]>([]);
	let loading = $state(true);
	let error = $state('');

	// Filter state
	let filters = $state<AuditLogFilters>({});
	let startDate = $state('');
	let endDate = $state('');
	let resourceType = $state('');
	let operation = $state('');
	let source = $state('');

	// Detail modal state
	let showDetailModal = $state(false);
	let selectedLog = $state<AuditLog | null>(null);

	// Export format
	let exportFormat = $state<'csv' | 'json'>('csv');

	async function loadLogs() {
		try {
			loading = true;
			error = '';

			const appliedFilters: AuditLogFilters = {};
			if (startDate) appliedFilters.startDate = new Date(startDate);
			if (endDate) appliedFilters.endDate = new Date(endDate);
			if (resourceType) appliedFilters.resourceType = resourceType;
			if (operation) appliedFilters.operation = operation;
			if (source) appliedFilters.source = source;

			logs = await auditLogsAPI.list(appliedFilters);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load audit logs';
		} finally {
			loading = false;
		}
	}

	function viewDetails(log: AuditLog) {
		selectedLog = log;
		showDetailModal = true;
	}

	function closeDetailModal() {
		showDetailModal = false;
		selectedLog = null;
	}

	function clearFilters() {
		startDate = '';
		endDate = '';
		resourceType = '';
		operation = '';
		source = '';
		loadLogs();
	}

	async function exportLogs() {
		const appliedFilters: AuditLogFilters = {};
		if (startDate) appliedFilters.startDate = new Date(startDate);
		if (endDate) appliedFilters.endDate = new Date(endDate);
		if (resourceType) appliedFilters.resourceType = resourceType;
		if (operation) appliedFilters.operation = operation;
		if (source) appliedFilters.source = source;

		if (exportFormat === 'csv') {
			await auditLogsAPI.downloadCSV(appliedFilters);
		} else {
			await auditLogsAPI.downloadJSON(appliedFilters);
		}
	}

	function formatTimestamp(timestamp: Date): string {
		const d = new Date(timestamp);
		return d.toLocaleString();
	}

	function getOperationBadgeClass(operation: string): string {
		switch (operation) {
			case 'CREATE':
				return 'badge-success';
			case 'UPDATE':
				return 'badge-warning';
			case 'DELETE':
				return 'badge-error';
			default:
				return 'badge-ghost';
		}
	}

	function getSourceBadgeClass(source: string): string {
		switch (source) {
			case 'Web UI':
				return 'badge-primary';
			case 'CSV Import':
				return 'badge-secondary';
			case 'API':
				return 'badge-accent';
			default:
				return 'badge-ghost';
		}
	}

	function formatResourceType(type: string): string {
		return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
	}

	onMount(() => {
		loadLogs();
	});
</script>

<svelte:head>
	<title>Audit Trail</title>
</svelte:head>

<div class="container mx-auto px-4 py-8 max-w-7xl">
	<h1 class="text-3xl font-bold mb-6">Audit Trail</h1>

	<!-- Filters Card -->
	<div class="card bg-base-100 shadow-xl mb-6">
		<div class="card-body">
			<h2 class="card-title">Filters</h2>

			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
				<!-- Date Range -->
				<div class="form-control">
					<label class="label">
						<span class="label-text">Start Date</span>
					</label>
					<input
						type="date"
						class="input input-bordered"
						bind:value={startDate}
					/>
				</div>

				<div class="form-control">
					<label class="label">
						<span class="label-text">End Date</span>
					</label>
					<input
						type="date"
						class="input input-bordered"
						bind:value={endDate}
					/>
				</div>

				<!-- Resource Type -->
				<div class="form-control">
					<label class="label">
						<span class="label-text">Resource Type</span>
					</label>
					<select class="select select-bordered" bind:value={resourceType}>
						<option value="">All</option>
						<option value="journal_entry">Journal Entry</option>
						<option value="gl_account">GL Account</option>
						<option value="subledger_account">Subledger Account</option>
						<option value="currency">Currency</option>
						<option value="attachment">Attachment</option>
					</select>
				</div>

				<!-- Operation -->
				<div class="form-control">
					<label class="label">
						<span class="label-text">Operation</span>
					</label>
					<select class="select select-bordered" bind:value={operation}>
						<option value="">All</option>
						<option value="CREATE">Create</option>
						<option value="UPDATE">Update</option>
						<option value="DELETE">Delete</option>
					</select>
				</div>

				<!-- Source -->
				<div class="form-control">
					<label class="label">
						<span class="label-text">Source</span>
					</label>
					<select class="select select-bordered" bind:value={source}>
						<option value="">All</option>
						<option value="Web UI">Web UI</option>
						<option value="CSV Import">CSV Import</option>
						<option value="API">API</option>
					</select>
				</div>
			</div>

			<div class="card-actions justify-end mt-4">
				<button class="btn btn-ghost" onclick={clearFilters}>Clear</button>
				<button class="btn btn-primary" onclick={loadLogs}>Apply Filters</button>
			</div>
		</div>
	</div>

	<!-- Export Controls -->
	<div class="card bg-base-100 shadow-xl mb-6">
		<div class="card-body">
			<div class="flex items-center gap-4">
				<h2 class="card-title flex-grow">Export</h2>

				<div class="form-control">
					<select class="select select-bordered select-sm" bind:value={exportFormat}>
						<option value="csv">CSV</option>
						<option value="json">JSON</option>
					</select>
				</div>

				<button class="btn btn-sm btn-accent" onclick={exportLogs}>
					Download {exportFormat.toUpperCase()}
				</button>
			</div>
		</div>
	</div>

	<!-- Loading State -->
	{#if loading}
		<div class="flex justify-center py-12">
			<span class="loading loading-spinner loading-lg"></span>
		</div>
	{/if}

	<!-- Error State -->
	{#if error}
		<div class="alert alert-error">
			<span>{error}</span>
		</div>
	{/if}

	<!-- Audit Logs Table -->
	{#if !loading && !error}
		{#if logs.length === 0}
			<div class="alert alert-info">
				<span>No audit logs found matching your filters.</span>
			</div>
		{:else}
			<div class="card bg-base-100 shadow-xl">
				<div class="card-body p-0">
					<div class="overflow-x-auto">
						<table class="table table-zebra">
							<thead>
								<tr>
									<th>Timestamp</th>
									<th>Operation</th>
									<th>Resource</th>
									<th>Resource ID</th>
									<th>Source</th>
									<th>Description</th>
									<th>Actions</th>
								</tr>
							</thead>
							<tbody>
								{#each logs as log}
									<tr>
										<td class="whitespace-nowrap">{formatTimestamp(log.timestamp)}</td>
										<td>
											<span class="badge {getOperationBadgeClass(log.operation)}">
												{log.operation}
											</span>
										</td>
										<td>{formatResourceType(log.resourceType)}</td>
										<td class="font-mono text-sm">{log.resourceId}</td>
										<td>
											<span class="badge {getSourceBadgeClass(log.source)}">
												{log.source}
											</span>
										</td>
										<td class="max-w-md truncate">{log.description || '-'}</td>
										<td>
											<button
												class="btn btn-xs btn-ghost"
												onclick={() => viewDetails(log)}
											>
												View Details
											</button>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			</div>

			<div class="text-sm text-base-content/70 mt-4">
				Showing {logs.length} audit log{logs.length !== 1 ? 's' : ''}
			</div>
		{/if}
	{/if}
</div>

<!-- Detail Modal -->
{#if showDetailModal && selectedLog}
	<div class="modal modal-open">
		<div class="modal-box max-w-4xl">
			<h3 class="font-bold text-lg mb-4">Audit Log Details</h3>

			<div class="space-y-4">
				<!-- Basic Info -->
				<div class="grid grid-cols-2 gap-4">
					<div>
						<span class="font-semibold">ID:</span>
						<span class="ml-2">{selectedLog.id}</span>
					</div>
					<div>
						<span class="font-semibold">Timestamp:</span>
						<span class="ml-2">{formatTimestamp(selectedLog.timestamp)}</span>
					</div>
					<div>
						<span class="font-semibold">Operation:</span>
						<span class="ml-2 badge {getOperationBadgeClass(selectedLog.operation)}">
							{selectedLog.operation}
						</span>
					</div>
					<div>
						<span class="font-semibold">Source:</span>
						<span class="ml-2 badge {getSourceBadgeClass(selectedLog.source)}">
							{selectedLog.source}
						</span>
					</div>
					<div>
						<span class="font-semibold">Resource Type:</span>
						<span class="ml-2">{formatResourceType(selectedLog.resourceType)}</span>
					</div>
					<div>
						<span class="font-semibold">Resource ID:</span>
						<span class="ml-2 font-mono text-sm">{selectedLog.resourceId}</span>
					</div>
				</div>

				{#if selectedLog.batchId}
					<div>
						<span class="font-semibold">Batch ID:</span>
						<span class="ml-2 font-mono text-sm">{selectedLog.batchId}</span>
					</div>
				{/if}

				{#if selectedLog.batchSummary}
					<div>
						<span class="font-semibold">Batch Summary:</span>
						<span class="ml-2">{selectedLog.batchSummary}</span>
					</div>
				{/if}

				{#if selectedLog.description}
					<div>
						<span class="font-semibold">Description:</span>
						<span class="ml-2">{selectedLog.description}</span>
					</div>
				{/if}

				<!-- Old Data -->
				{#if selectedLog.oldData}
					<div>
						<span class="font-semibold">Old Data:</span>
						<pre class="bg-base-200 p-4 rounded mt-2 overflow-x-auto text-xs">{JSON.stringify(selectedLog.oldData, null, 2)}</pre>
					</div>
				{/if}

				<!-- New Data -->
				{#if selectedLog.newData}
					<div>
						<span class="font-semibold">New Data:</span>
						<pre class="bg-base-200 p-4 rounded mt-2 overflow-x-auto text-xs">{JSON.stringify(selectedLog.newData, null, 2)}</pre>
					</div>
				{/if}
			</div>

			<div class="modal-action">
				<button class="btn" onclick={closeDetailModal}>Close</button>
			</div>
		</div>
		<div class="modal-backdrop" onclick={closeDetailModal}></div>
	</div>
{/if}
