<script lang="ts">
	import type { QuarterlyLineItem, QuarterlyReport } from '$lib/api';

	let {
		report,
		heading,
		formatCurrency,
		formatDate,
		onExport
	}: {
		report: QuarterlyReport;
		heading: string;
		formatCurrency: (amount: number) => string;
		formatDate: (date: Date | string) => string;
		onExport: () => void;
	} = $props();

	let maxMonth = $derived(
		Math.max(0, ...report.months.flatMap((month) => [Math.abs(month.income), Math.abs(month.expenses)]))
	);
	let incomeScale = $derived(Math.max(0, ...report.incomeItems.map((item) => Math.abs(item.amount))));
	let expenseScale = $derived(
		Math.max(0, ...report.expenseItems.map((item) => Math.abs(item.amount)))
	);
	let mixTotal = $derived(Math.max(0, report.income) + Math.max(0, report.expenses));

	function barWidth(amount: number, scale: number): number {
		if (scale <= 0) return 0;
		return Math.max(2, (Math.abs(amount) / scale) * 100);
	}

	const chartWidth = 640;
	const chartHeight = 160;
	const plotTop = 8;
	const plotHeight = 140;

	function monthHeight(amount: number): number {
		if (maxMonth <= 0 || amount === 0) return 0;
		return Math.max(4, (Math.abs(amount) / maxMonth) * plotHeight);
	}

	function shareLabel(amount: number, total: number): string {
		if (total <= 0 || amount <= 0) return '';
		return `${Math.round((amount / total) * 100)}%`;
	}
</script>

<div class="card bg-base-100 shadow-xl mb-6">
	<div class="card-body">
		<div class="flex justify-end mb-2 print:hidden">
			<button type="button" class="btn btn-sm btn-outline" onclick={onExport}>Export PDF</button>
		</div>

		<div class="text-center mb-6">
			<p class="section-label mb-2">Executive summary</p>
			<h2 class="text-2xl font-bold">{heading}</h2>
			<p class="text-base-content/70 mt-1">{report.label}</p>
			<p class="text-base-content/70">
				{formatDate(report.startDate)} to {formatDate(report.endDate)} · {report.currencyCode}
			</p>
		</div>

		<p class="text-center text-base-content/80 mb-6 max-w-2xl mx-auto">
			{#if report.income === 0 && report.expenses === 0}
				No income or expenses were recorded in this quarter.
			{:else if report.netIncome >= 0}
				Income of {formatCurrency(report.income)} and expenses of {formatCurrency(report.expenses)}
				left a net surplus of {formatCurrency(report.netIncome)}.
			{:else}
				Income of {formatCurrency(report.income)} and expenses of {formatCurrency(report.expenses)}
				left a net shortfall of {formatCurrency(Math.abs(report.netIncome))}.
			{/if}
		</p>

		<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
			<div class="metric-tile">
				<p class="text-xs font-bold uppercase tracking-wider text-base-content/50">Income</p>
				<p class="font-mono font-bold text-2xl mt-1 text-success">{formatCurrency(report.income)}</p>
			</div>
			<div class="metric-tile">
				<p class="text-xs font-bold uppercase tracking-wider text-base-content/50">Expenses</p>
				<p class="font-mono font-bold text-2xl mt-1">{formatCurrency(report.expenses)}</p>
			</div>
			<div class="metric-tile">
				<p class="text-xs font-bold uppercase tracking-wider text-base-content/50">Net income</p>
				<p class="font-mono font-bold text-2xl mt-1 {report.netIncome >= 0 ? 'text-success' : 'text-error'}">
					{formatCurrency(report.netIncome)}
				</p>
			</div>
		</div>

		{#if mixTotal > 0}
			<div class="mb-8">
				<div class="flex h-3 rounded-full overflow-hidden bg-base-200">
					{#if report.income > 0}
						<div
							class="h-full bg-success"
							style="width: {(Math.max(0, report.income) / mixTotal) * 100}%"
						></div>
					{/if}
					{#if report.expenses > 0}
						<div
							class="h-full bg-warning"
							style="width: {(Math.max(0, report.expenses) / mixTotal) * 100}%"
						></div>
					{/if}
				</div>
				<div class="flex justify-center gap-4 text-xs text-base-content/60 mt-2">
					{#if report.income > 0}
						<span class="inline-flex items-center gap-1.5">
							<span class="w-2.5 h-2.5 rounded-sm bg-success"></span>
							Income {shareLabel(report.income, mixTotal)}
						</span>
					{/if}
					{#if report.expenses > 0}
						<span class="inline-flex items-center gap-1.5">
							<span class="w-2.5 h-2.5 rounded-sm bg-warning"></span>
							Expenses {shareLabel(report.expenses, mixTotal)}
						</span>
					{/if}
				</div>
			</div>
		{/if}

		{#if report.months.length > 0}
			<div class="mb-8">
				<h3 class="font-semibold mb-1">Through the quarter</h3>
				<p class="text-sm text-base-content/60 mb-4">Months with no income and no expenses are omitted.</p>
				<div class="rounded-2xl border border-base-300/50 bg-base-200/30 px-4 py-4">
					<svg
						viewBox="0 0 {chartWidth} {chartHeight}"
						class="w-full h-44"
						role="img"
						aria-label="Income and expenses by month"
					>
						{#each report.months as month, index (month.label)}
							{@const slot = chartWidth / report.months.length}
							{@const barW = Math.min(22, slot * 0.22)}
							{@const center = slot * index + slot / 2}
							{@const incomeH = monthHeight(month.income)}
							{@const expenseH = monthHeight(month.expenses)}
							{#if month.income !== 0}
								<rect
									x={center - barW - 3}
									y={plotTop + plotHeight - incomeH}
									width={barW}
									height={incomeH}
									rx="4"
									class="text-success"
									fill="currentColor"
								>
									<title>Income {formatCurrency(month.income)}</title>
								</rect>
							{/if}
							{#if month.expenses !== 0}
								<rect
									x={center + 3}
									y={plotTop + plotHeight - expenseH}
									width={barW}
									height={expenseH}
									rx="4"
									class="text-warning"
									fill="currentColor"
								>
									<title>Expenses {formatCurrency(month.expenses)}</title>
								</rect>
							{/if}
						{/each}
					</svg>
					<div class="flex gap-2">
						{#each report.months as month (month.label)}
							<div class="flex-1 min-w-0 text-center">
								<p class="text-xs text-base-content/70 leading-tight">{month.label}</p>
								<p class="text-2xs font-mono {month.netIncome >= 0 ? 'text-success' : 'text-error'}">
									{formatCurrency(month.netIncome)}
								</p>
							</div>
						{/each}
					</div>
					<div class="flex justify-center gap-4 mt-3 text-xs text-base-content/60">
						<span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-success"></span> Income</span>
						<span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-warning"></span> Expenses</span>
					</div>
				</div>
			</div>
		{/if}

		<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
			<section>
				<h3 class="font-semibold mb-1">Biggest income</h3>
				<p class="text-sm text-base-content/60 mb-4">Accounts with a zero balance are omitted.</p>
				{#if report.incomeItems.length === 0}
					<p class="text-base-content/60">No income this quarter.</p>
				{:else}
					{#each report.incomeItems as item (item.accountId)}
						{@render rankRow(item, incomeScale, 'bg-success', report.income)}
					{/each}
				{/if}
			</section>
			<section>
				<h3 class="font-semibold mb-1">Biggest expenses</h3>
				<p class="text-sm text-base-content/60 mb-4">Accounts with a zero balance are omitted.</p>
				{#if report.expenseItems.length === 0}
					<p class="text-base-content/60">No expenses this quarter.</p>
				{:else}
					{#each report.expenseItems as item (item.accountId)}
						{@render rankRow(item, expenseScale, 'bg-warning', report.expenses)}
					{/each}
				{/if}
			</section>
		</div>
	</div>
</div>

{#snippet rankRow(item: QuarterlyLineItem, scale: number, barClass: string, sectionTotal: number)}
	<div class="mb-3">
		<div class="flex items-baseline justify-between gap-3 mb-1">
			<div class="min-w-0">
				<p class="font-medium truncate">{item.name}</p>
				<p class="text-xs text-base-content/50 font-mono">{item.accountNumber}</p>
			</div>
			<div class="text-right shrink-0">
				<p class="font-mono font-semibold">{formatCurrency(item.amount)}</p>
				{#if shareLabel(item.amount, sectionTotal)}
					<p class="text-xs text-base-content/50">{shareLabel(item.amount, sectionTotal)} of total</p>
				{/if}
			</div>
		</div>
		<div class="h-2.5 rounded-full bg-base-200 overflow-hidden">
			<div class="h-full rounded-full {barClass}" style="width: {barWidth(item.amount, scale)}%"></div>
		</div>
	</div>
{/snippet}
