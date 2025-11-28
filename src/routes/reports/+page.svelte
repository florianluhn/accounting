<script lang="ts">
	// This will be expanded with actual reporting functionality
</script>

<div class="max-w-7xl mx-auto">
	<!-- Header -->
	<div class="mb-8">
		<h1 class="text-4xl font-bold mb-2">Financial Reports</h1>
		<p class="text-base-content/70">Balance Sheet, P&L, and other financial statements</p>
	</div>

	<!-- Report Type Selector -->
	<div class="tabs tabs-boxed mb-6">
		<a class="tab tab-active">Balance Sheet</a>
		<a class="tab">Profit & Loss</a>
		<a class="tab">Trial Balance</a>
	</div>

	<!-- Date Range Selector -->
	<div class="card bg-base-100 shadow-xl mb-6">
		<div class="card-body">
			<div class="flex gap-4 items-end">
				<div class="form-control">
					<label class="label">
						<span class="label-text">From Date</span>
					</label>
					<input type="date" class="input input-bordered" />
				</div>
				<div class="form-control">
					<label class="label">
						<span class="label-text">To Date</span>
					</label>
					<input type="date" class="input input-bordered" />
				</div>
				<button class="btn btn-primary">Generate Report</button>
				<button class="btn btn-ghost">Export PDF</button>
			</div>
		</div>
	</div>

	<!-- Balance Sheet Report -->
	<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
		<!-- Assets -->
		<div class="card bg-base-100 shadow-xl">
			<div class="card-body">
				<h2 class="card-title text-2xl mb-4">Assets</h2>

				<div class="alert alert-info">
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
					<span>No data available. Create accounts and journal entries to generate reports.</span>
				</div>

				<div class="divider"></div>
				<div class="flex justify-between font-bold text-lg">
					<span>Total Assets</span>
					<span>$0.00</span>
				</div>
			</div>
		</div>

		<!-- Liabilities & Equity -->
		<div class="card bg-base-100 shadow-xl">
			<div class="card-body">
				<h2 class="card-title text-2xl mb-4">Liabilities & Equity</h2>

				<h3 class="font-semibold text-lg mb-2">Liabilities</h3>
				<div class="ml-4 mb-4 text-base-content/70">No liabilities recorded</div>

				<h3 class="font-semibold text-lg mb-2">Equity</h3>
				<div class="ml-4 mb-4 text-base-content/70">No equity recorded</div>

				<div class="divider"></div>
				<div class="flex justify-between font-bold text-lg">
					<span>Total Liabilities & Equity</span>
					<span>$0.00</span>
				</div>
			</div>
		</div>
	</div>
</div>
