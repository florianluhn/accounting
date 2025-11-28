<script lang="ts">
	// This will be expanded with actual journal entry functionality
</script>

<div class="max-w-7xl mx-auto">
	<!-- Header -->
	<div class="mb-8">
		<h1 class="text-4xl font-bold mb-2">Journal Entries</h1>
		<p class="text-base-content/70">Record double-entry transactions</p>
	</div>

	<!-- Actions -->
	<div class="flex justify-between items-center mb-6">
		<div class="form-control">
			<input type="text" placeholder="Search entries..." class="input input-bordered w-64" />
		</div>
		<button class="btn btn-primary">+ New Journal Entry</button>
	</div>

	<!-- Journal Entries List -->
	<div class="card bg-base-100 shadow-xl">
		<div class="card-body">
			<!-- Placeholder message -->
			<div class="alert alert-info mb-4">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
					class="stroke-current shrink-0 w-6 h-6"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
					></path>
				</svg>
				<span
					>No journal entries yet. Create accounts first, then record your first transaction.</span
				>
			</div>

			<!-- Table (empty for now) -->
			<div class="overflow-x-auto">
				<table class="table table-zebra">
					<thead>
						<tr>
							<th>Date</th>
							<th>Description</th>
							<th>Debit Account</th>
							<th>Credit Account</th>
							<th>Amount</th>
							<th>Category</th>
							<th>Actions</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td colspan="7" class="text-center text-base-content/50">No entries to display</td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	</div>
</div>
