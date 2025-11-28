<script lang="ts">
	// This will be expanded later with dashboard functionality
</script>

<div class="max-w-7xl mx-auto">
	<!-- Header -->
	<div class="mb-8">
		<h1 class="text-4xl font-bold mb-2">Dashboard</h1>
		<p class="text-base-content/70">Overview of your financial accounts</p>
	</div>

	<!-- Welcome Card -->
	<div class="card bg-base-100 shadow-xl mb-6">
		<div class="card-body">
			<h2 class="card-title text-2xl">Welcome to Your Accounting App!</h2>
			<p class="text-base-content/80">
				This is a personal finance accounting application using double-entry bookkeeping.
				Get started by setting up your accounts.
			</p>

			<div class="mt-6 space-y-4">
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
					<span>Start by creating your GL accounts and subledger accounts in the Accounts section.</span>
				</div>

				<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
					<a href="/accounts" class="card bg-primary text-primary-content hover:shadow-lg transition">
						<div class="card-body">
							<div class="text-4xl mb-2">🏦</div>
							<h3 class="card-title">Accounts</h3>
							<p class="text-sm opacity-90">Set up your GL and subledger accounts</p>
						</div>
					</a>

					<a href="/journals" class="card bg-secondary text-secondary-content hover:shadow-lg transition">
						<div class="card-body">
							<div class="text-4xl mb-2">📖</div>
							<h3 class="card-title">Journal Entries</h3>
							<p class="text-sm opacity-90">Record transactions with double-entry</p>
						</div>
					</a>

					<a href="/reports" class="card bg-accent text-accent-content hover:shadow-lg transition">
						<div class="card-body">
							<div class="text-4xl mb-2">📈</div>
							<h3 class="card-title">Reports</h3>
							<p class="text-sm opacity-90">View balance sheets and P&L statements</p>
						</div>
					</a>
				</div>
			</div>
		</div>
	</div>

	<!-- Quick Stats (Placeholder) -->
	<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
		<div class="stat bg-base-100 shadow rounded-lg">
			<div class="stat-title">Total Assets</div>
			<div class="stat-value text-primary">$0.00</div>
			<div class="stat-desc">No accounts yet</div>
		</div>

		<div class="stat bg-base-100 shadow rounded-lg">
			<div class="stat-title">Total Liabilities</div>
			<div class="stat-value text-secondary">$0.00</div>
			<div class="stat-desc">No accounts yet</div>
		</div>

		<div class="stat bg-base-100 shadow rounded-lg">
			<div class="stat-title">Equity</div>
			<div class="stat-value text-accent">$0.00</div>
			<div class="stat-desc">No accounts yet</div>
		</div>

		<div class="stat bg-base-100 shadow rounded-lg">
			<div class="stat-title">Journal Entries</div>
			<div class="stat-value">0</div>
			<div class="stat-desc">This month</div>
		</div>
	</div>
</div>
