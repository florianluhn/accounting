/**
 * Build a clean printable HTML document for financial reports and open the
 * browser print dialog (Save as PDF). Expansion state is mirrored exactly as
 * on screen — only expanded GL groups / subledgers are included in detail.
 */

import type {
	BalanceSheetReport,
	ProfitLossReport,
	TrialBalanceReport,
	CheckReferenceReport,
	QuarterlyReport,
	GLAccountGroup,
	AccountBalance,
	CategoryBreakdown
} from './api';

export type ReportPdfType =
	| 'balance-sheet'
	| 'profit-loss'
	| 'trial-balance'
	| 'check-references'
	| 'quarterly';
export type CheckReferencePdfFilter = 'all' | 'open' | 'paid';

export interface ReportPdfOptions {
	type: ReportPdfType;
	organizationName: string;
	currencySymbol: string;
	currencyCode: string;
	includeBudgets: boolean;
	expandedGLAccounts: Set<number>;
	expandedSubledgers: Set<number>;
	subledgerCategories: Map<number, CategoryBreakdown[]>;
	balanceSheet?: BalanceSheetReport | null;
	profitLoss?: ProfitLossReport | null;
	trialBalance?: TrialBalanceReport | null;
	checkReferenceReport?: CheckReferenceReport | null;
	quarterlyReport?: QuarterlyReport | null;
	checkReferenceFilter?: CheckReferencePdfFilter;
	expandedCheckReferences?: Set<string>;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function formatAmount(amount: number, symbol: string): string {
	return `${symbol} ${amount.toLocaleString('en-US', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	})}`;
}

function formatDateUtc(date: Date | string): string {
	const d = new Date(date);
	const year = d.getUTCFullYear();
	const month = String(d.getUTCMonth() + 1).padStart(2, '0');
	const day = String(d.getUTCDate()).padStart(2, '0');
	return `${month}/${day}/${year}`;
}

function reportTitle(type: ReportPdfType, organizationName: string): string {
	const base =
		type === 'balance-sheet'
			? 'Balance Sheet'
			: type === 'profit-loss'
				? 'Profit & Loss Statement'
				: type === 'check-references'
					? 'Check / Reference Balances'
					: type === 'quarterly'
						? 'Quarterly Executive Summary'
						: 'Trial Balance';
	const name = organizationName.trim();
	return name ? `${base} ${name}` : base;
}

function checkReferenceStatusLabel(status: string): string {
	if (status === 'paid') return 'Paid';
	if (status === 'overpaid') return 'Overpaid';
	return 'Open';
}

function moneyCell(amount: number, symbol: string, className = ''): string {
	return `<td class="num ${className}">${escapeHtml(formatAmount(amount, symbol))}</td>`;
}

function dashCell(): string {
	return `<td class="num muted">—</td>`;
}

function isExpenseType(accountType: string): boolean {
	return accountType === 'Loss' || accountType === 'Expense';
}

function isFavorableVariance(variance: number, accountType: string): boolean {
	if (variance === 0) return false;
	if (isExpenseType(accountType)) return variance < 0;
	return variance > 0;
}

function varianceClass(variance: number, accountType: string): string {
	if (isFavorableVariance(variance, accountType)) return 'good';
	if (variance !== 0) return 'bad';
	return '';
}

function hasBudget(account: AccountBalance): boolean {
	return (account.budget ?? 0) > 0;
}

function budgetedSubledgers(group: GLAccountGroup): AccountBalance[] {
	return group.subledgerAccounts.filter(hasBudget);
}

function sumBudget(accounts: AccountBalance[]): number {
	return accounts.reduce((sum, a) => sum + (a.budget || 0), 0);
}

function sumActual(accounts: AccountBalance[]): number {
	return accounts.reduce((sum, a) => sum + a.balance, 0);
}

function budgetedVariance(accounts: AccountBalance[]): number {
	const budgeted = accounts.filter(hasBudget);
	return sumActual(budgeted) - sumBudget(budgeted);
}

function groupBudgetTotal(group: GLAccountGroup): number {
	return sumBudget(budgetedSubledgers(group));
}

function groupBudgetedVariance(group: GLAccountGroup): number {
	return budgetedVariance(group.subledgerAccounts);
}

function sectionBudgetTotal(groups: GLAccountGroup[]): number {
	return groups.reduce((sum, g) => sum + groupBudgetTotal(g), 0);
}

function sectionBudgetedVariance(groups: GLAccountGroup[]): number {
	return groups.reduce((sum, g) => sum + groupBudgetedVariance(g), 0);
}

function renderGlGroups(
	groups: GLAccountGroup[],
	opts: ReportPdfOptions,
	withBudgets: boolean
): string {
	const { currencySymbol: symbol, expandedGLAccounts, expandedSubledgers, subledgerCategories } =
		opts;

	if (groups.length === 0) {
		return `<p class="empty">No accounts</p>`;
	}

	const colCount = withBudgets ? 4 : 2;
	let html = `<table class="lines"><tbody>`;

	for (const gl of groups) {
		const gBud = groupBudgetTotal(gl);
		const gVar = groupBudgetedVariance(gl);
		html += `<tr class="gl-row">`;
		html += `<td class="label">${escapeHtml(`${gl.glAccountNumber} - ${gl.glAccountName}`)}</td>`;
		if (withBudgets) {
			html += moneyCell(gl.totalBalance, symbol);
			html += moneyCell(gBud, symbol);
			if (gBud > 0) {
				html += moneyCell(gVar, symbol, varianceClass(gVar, gl.glAccountType));
			} else {
				html += dashCell();
			}
		} else {
			html += moneyCell(gl.totalBalance, symbol);
		}
		html += `</tr>`;

		if (expandedGLAccounts.has(gl.glAccountId)) {
			for (const account of gl.subledgerAccounts) {
				const aVar = account.balance - (account.budget || 0);
				html += `<tr class="sub-row">`;
				html += `<td class="label indent-1">${escapeHtml(`${account.accountNumber} - ${account.accountName}`)}</td>`;
				if (withBudgets) {
					html += moneyCell(account.balance, symbol);
					if (hasBudget(account)) {
						html += moneyCell(account.budget || 0, symbol);
						html += moneyCell(aVar, symbol, varianceClass(aVar, account.glAccountType));
					} else {
						html += dashCell();
						html += dashCell();
					}
				} else {
					html += moneyCell(account.balance, symbol);
				}
				html += `</tr>`;

				if (expandedSubledgers.has(account.accountId)) {
					const cats = subledgerCategories.get(account.accountId) || [];
					if (cats.length === 0) {
						html += `<tr class="cat-row"><td class="label indent-2 muted" colspan="${colCount}">No entries</td></tr>`;
					} else {
						for (const cat of cats) {
							html += `<tr class="cat-row">`;
							html += `<td class="label indent-2 italic">${escapeHtml(cat.category)}</td>`;
							if (withBudgets) {
								html += moneyCell(cat.balance, symbol);
								html += dashCell();
								html += dashCell();
							} else {
								html += moneyCell(cat.balance, symbol);
							}
							html += `</tr>`;
						}
					}
				}
			}
		}
	}

	html += `</tbody></table>`;
	return html;
}

function sectionTotalRow(
	label: string,
	actual: number,
	groups: GLAccountGroup[] | null,
	opts: ReportPdfOptions,
	withBudgets: boolean,
	accountTypeForVariance?: string
): string {
	const symbol = opts.currencySymbol;
	let html = `<table class="totals"><tbody><tr class="total-row">`;
	html += `<td class="label">${escapeHtml(label)}</td>`;
	if (withBudgets && groups) {
		const bud = sectionBudgetTotal(groups);
		const v = sectionBudgetedVariance(groups);
		html += moneyCell(actual, symbol);
		html += moneyCell(bud, symbol);
		const cls = accountTypeForVariance ? varianceClass(v, accountTypeForVariance) : '';
		html += moneyCell(v, symbol, cls);
	} else {
		html += moneyCell(actual, symbol);
	}
	html += `</tr></tbody></table>`;
	return html;
}

function budgetHeader(withBudgets: boolean): string {
	if (!withBudgets) return '';
	return `<table class="lines header-cols"><thead><tr>
		<th class="label"></th>
		<th class="num">Actual</th>
		<th class="num">Budget</th>
		<th class="num">Variance</th>
	</tr></thead></table>`;
}

function buildBalanceSheetHtml(report: BalanceSheetReport, opts: ReportPdfOptions): string {
	const symbol = opts.currencySymbol;
	const title = reportTitle('balance-sheet', opts.organizationName);
	let body = `
		<header class="report-header">
			<h1>${escapeHtml(title)}</h1>
			<p>As of ${escapeHtml(formatDateUtc(report.asOfDate))}</p>
			<p>Currency: ${escapeHtml(report.currencyCode)}</p>
		</header>
		<div class="two-col">
			<section>
				<h2>Assets</h2>
				${renderGlGroups(report.assets.accounts, opts, false)}
				${sectionTotalRow('Total Assets', report.assets.total, null, opts, false)}
			</section>
			<section>
				<h2>Liabilities &amp; Equity</h2>
				<h3>Liabilities</h3>
				${renderGlGroups(report.liabilities.accounts, opts, false)}
				${sectionTotalRow('Total Liabilities', report.liabilities.total, null, opts, false)}
				<h3>Equity</h3>
				${renderGlGroups(report.equity.accounts, opts, false)}
				<table class="lines"><tbody>
					<tr class="sub-row">
						<td class="label">${escapeHtml(report.equity.retainedEarningsLabel || 'Net Income (unclosed)')}</td>
						${moneyCell(report.equity.retainedEarnings, symbol)}
					</tr>
				</tbody></table>
				${sectionTotalRow('Total Equity', report.equity.total, null, opts, false)}
				${sectionTotalRow('Total Liabilities & Equity', report.totalLiabilitiesAndEquity, null, opts, false)}
			</section>
		</div>
		<p class="status ${report.balanced ? 'good' : 'bad'}">
			${report.balanced ? 'Balance Sheet is balanced' : 'Warning: Balance Sheet is not balanced'}
		</p>
	`;
	return body;
}

function buildProfitLossHtml(report: ProfitLossReport, opts: ReportPdfOptions): string {
	const withBudgets = opts.includeBudgets;
	const title = reportTitle('profit-loss', opts.organizationName);
	const symbol = opts.currencySymbol;
	return `
		<header class="report-header">
			<h1>${escapeHtml(title)}</h1>
			<p>${escapeHtml(formatDateUtc(report.startDate))} to ${escapeHtml(formatDateUtc(report.endDate))}</p>
			<p>Currency: ${escapeHtml(report.currencyCode)}</p>
		</header>
		<section>
			<h2>Revenue</h2>
			${budgetHeader(withBudgets)}
			${renderGlGroups(report.revenue.accounts, opts, withBudgets)}
			${sectionTotalRow('Total Revenue', report.revenue.total, report.revenue.accounts, opts, withBudgets, 'Profit')}
		</section>
		<section>
			<h2>Expenses</h2>
			${budgetHeader(withBudgets)}
			${renderGlGroups(report.expenses.accounts, opts, withBudgets)}
			${sectionTotalRow('Total Expenses', report.expenses.total, report.expenses.accounts, opts, withBudgets, 'Loss')}
		</section>
		<table class="totals net"><tbody>
			<tr class="net-row ${report.netIncome >= 0 ? 'good' : 'bad'}">
				<td class="label">Net Income</td>
				${moneyCell(report.netIncome, symbol)}
			</tr>
		</tbody></table>
	`;
}

function buildTrialBalanceHtml(report: TrialBalanceReport, opts: ReportPdfOptions): string {
	const symbol = opts.currencySymbol;
	const title = reportTitle('trial-balance', opts.organizationName);
	let rows = '';
	for (const account of report.accounts) {
		rows += `<tr>
			<td class="mono">${escapeHtml(account.accountNumber)}</td>
			<td>${escapeHtml(account.accountName)}</td>
			<td class="num">${account.debit > 0 ? escapeHtml(formatAmount(account.debit, symbol)) : ''}</td>
			<td class="num">${account.credit > 0 ? escapeHtml(formatAmount(account.credit, symbol)) : ''}</td>
		</tr>`;
	}
	return `
		<header class="report-header">
			<h1>${escapeHtml(title)}</h1>
			<p>As of ${escapeHtml(formatDateUtc(report.asOfDate))}</p>
			<p>Currency: ${escapeHtml(report.currencyCode)}</p>
		</header>
		<table class="tb">
			<thead>
				<tr>
					<th>Account Number</th>
					<th>Account Name</th>
					<th class="num">Debit</th>
					<th class="num">Credit</th>
				</tr>
			</thead>
			<tbody>${rows}</tbody>
			<tfoot>
				<tr class="total-row">
					<td colspan="2">Total</td>
					<td class="num">${escapeHtml(formatAmount(report.totalDebits, symbol))}</td>
					<td class="num">${escapeHtml(formatAmount(report.totalCredits, symbol))}</td>
				</tr>
			</tfoot>
		</table>
		<p class="status ${report.balanced ? 'good' : 'bad'}">
			${report.balanced ? 'Trial Balance is balanced' : 'Warning: Trial Balance is not balanced'}
		</p>
	`;
}

function buildCheckReferenceHtml(report: CheckReferenceReport, opts: ReportPdfOptions): string {
	const symbol = opts.currencySymbol;
	const title = reportTitle('check-references', opts.organizationName);
	const filter = opts.checkReferenceFilter ?? 'all';
	const expanded = opts.expandedCheckReferences ?? new Set<string>();
	const rows = report.references.filter((row) => {
		if (filter === 'paid') return row.status === 'paid';
		if (filter === 'open') return row.status !== 'paid';
		return true;
	});

	const filterLabel =
		filter === 'paid' ? 'Paid only' : filter === 'open' ? 'Open only' : 'All references';
	const period = report.startDate
		? `${formatDateUtc(report.startDate)} to ${formatDateUtc(report.endDate)}`
		: `As of ${formatDateUtc(report.endDate)}`;

	let body = '';
	if (rows.length === 0) {
		body = `<p class="empty">No check or reference balances to show.</p>`;
	} else {
		body = `<table class="tb">
			<thead>
				<tr>
					<th>Reference</th>
					<th>Date</th>
					<th>Description</th>
					<th class="num">Issued</th>
					<th class="num">Cleared</th>
					<th class="num">Balance</th>
					<th>Status</th>
				</tr>
			</thead>
			<tbody>`;
		for (const row of rows) {
			const statusClass = row.status === 'paid' ? 'good' : row.status === 'overpaid' ? 'bad' : 'open';
			body += `<tr>
				<td class="mono">${escapeHtml(row.reference)}</td>
				<td>${escapeHtml(formatDateUtc(row.date))}</td>
				<td>${escapeHtml(row.description)}</td>
				${moneyCell(row.amount, symbol)}
				${moneyCell(row.applied, symbol)}
				${moneyCell(row.balance, symbol, statusClass)}
				<td class="${statusClass}">${escapeHtml(checkReferenceStatusLabel(row.status))}</td>
			</tr>`;
			if (expanded.has(row.reference) && row.entries.length > 0) {
				for (const entry of row.entries) {
					body += `<tr class="cat-row">
						<td class="indent-1">${escapeHtml(entry.role === 'issued' ? 'Issued' : 'Cleared')}</td>
						<td>${escapeHtml(formatDateUtc(entry.entryDate))}</td>
						<td>${escapeHtml(entry.description)}<br><span class="muted">${escapeHtml(entry.debitAccountName)} / ${escapeHtml(entry.creditAccountName)}</span></td>
						${moneyCell(entry.amount, symbol)}
						<td colspan="3"></td>
					</tr>`;
				}
			}
		}
		body += `</tbody></table>`;
	}

	return `
		<header class="report-header">
			<h1>${escapeHtml(title)}</h1>
			<p>${escapeHtml(period)}</p>
			<p>Currency: ${escapeHtml(report.currencyCode)} · ${escapeHtml(filterLabel)}</p>
			<p>${escapeHtml(report.clearingAccountName ? `Check clearing account: ${report.clearingAccountName}` : 'No check clearing account selected')}</p>
			<p>Open balance ${escapeHtml(formatAmount(report.totalOpenBalance, symbol))}
				· ${report.openCount} open
				· ${report.paidCount} paid${report.overpaidCount > 0 ? ` · ${report.overpaidCount} overpaid` : ''}</p>
		</header>
		${body}
	`;
}

function buildQuarterlyHtml(report: QuarterlyReport, opts: ReportPdfOptions): string {
	const symbol = opts.currencySymbol;
	const title = reportTitle('quarterly', opts.organizationName);
	function scaleOf(groups: QuarterlyReport['incomeGroups']): number {
		return Math.max(
			0,
			...groups.flatMap((group) => [
				Math.abs(group.amount),
				...group.subaccounts.map((item) => Math.abs(item.amount))
			])
		);
	}

	const maxIncome = scaleOf(report.incomeGroups);
	const maxExpense = scaleOf(report.expenseGroups);
	const maxCash = scaleOf(report.cashGroups);
	const monthMax = Math.max(
		0,
		...report.months.flatMap((month) => [Math.abs(month.income), Math.abs(month.expenses)])
	);

	function groupedRows(
		groups: QuarterlyReport['incomeGroups'],
		max: number,
		fillClass: string
	): string {
		if (groups.length === 0) return `<p class="empty">None.</p>`;
		return groups
			.map((group) => {
				const width = max > 0 ? Math.max(2, (Math.abs(group.amount) / max) * 100) : 0;
				const subs = group.subaccounts
					.map((item) => {
						const subWidth = max > 0 ? Math.max(2, (Math.abs(item.amount) / max) * 100) : 0;
						return `<div class="rank-row sub">
							<div class="rank-label">
								<span>${escapeHtml(item.name)}</span>
								<span class="muted mono">${escapeHtml(item.accountNumber)}</span>
							</div>
							<div class="bar-track"><div class="bar-fill ${fillClass}" style="width:${subWidth.toFixed(1)}%"></div></div>
							<div class="num">${escapeHtml(formatAmount(item.amount, symbol))}</div>
						</div>`;
					})
					.join('');
				return `<div class="rank-row">
					<div class="rank-label">
						<span>${escapeHtml(group.name)}</span>
						<span class="muted mono">${escapeHtml(group.accountNumber)}</span>
					</div>
					<div class="bar-track"><div class="bar-fill ${fillClass}" style="width:${width.toFixed(1)}%"></div></div>
					<div class="num">${escapeHtml(formatAmount(group.amount, symbol))}</div>
				</div>${subs}`;
			})
			.join('');
	}

	const monthBars =
		report.months.length === 0
			? `<p class="empty">No income or expenses in this quarter.</p>`
			: `<div class="month-chart">${report.months
					.map((month) => {
						const incomeH = monthMax > 0 && month.income !== 0 ? (Math.abs(month.income) / monthMax) * 100 : 0;
						const expenseH = monthMax > 0 && month.expenses !== 0 ? (Math.abs(month.expenses) / monthMax) * 100 : 0;
						const incomeBar = incomeH > 0 ? `<div class="vbar income" style="height:${incomeH.toFixed(1)}%"></div>` : '';
						const expenseBar = expenseH > 0 ? `<div class="vbar expense" style="height:${expenseH.toFixed(1)}%"></div>` : '';
						return `<div class="month-col">
							<div class="month-bars">
								${incomeBar}
								${expenseBar}
							</div>
							<div class="month-name">${escapeHtml(month.label)}</div>
						</div>`;
					})
					.join('')}</div>
				<p class="legend"><span class="swatch income"></span> Income <span class="swatch expense"></span> Expenses</p>`;

	return `
		<header class="report-header">
			<h1>${escapeHtml(title)}</h1>
			<p>${escapeHtml(report.label)}</p>
			<p>${escapeHtml(formatDateUtc(report.startDate))} to ${escapeHtml(formatDateUtc(report.endDate))}</p>
			<p>Currency: ${escapeHtml(report.currencyCode)}</p>
		</header>
		<table class="totals">
			<tbody>
				<tr>
					<td>Income</td>
					${moneyCell(report.income, symbol, 'good')}
				</tr>
				<tr>
					<td>Expenses</td>
					${moneyCell(report.expenses, symbol)}
				</tr>
				<tr class="net-row ${report.netIncome >= 0 ? 'good' : 'bad'}">
					<td>Net income</td>
					${moneyCell(report.netIncome, symbol)}
				</tr>
				<tr>
					<td>Cash on hand as of ${escapeHtml(formatDateUtc(report.endDate))}</td>
					${moneyCell(report.cashTotal, symbol)}
				</tr>
			</tbody>
		</table>
		<h2>Month by month</h2>
		${monthBars}
		<h2>Biggest income</h2>
		${groupedRows(report.incomeGroups, maxIncome, 'income')}
		<h2>Biggest expenses</h2>
		${groupedRows(report.expenseGroups, maxExpense, 'expense')}
		<h2>Cash accounts</h2>
		<p class="empty">Balances as of ${escapeHtml(formatDateUtc(report.endDate))}. Zero balances are omitted.</p>
		${groupedRows(report.cashGroups, maxCash, 'cash')}
	`;
}

const PRINT_STYLES = `
	* { box-sizing: border-box; }
	body {
		font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
		font-size: 11pt;
		color: #111;
		margin: 0;
		padding: 24px 32px;
		line-height: 1.35;
	}
	.report-header { text-align: center; margin-bottom: 24px; }
	.report-header h1 { font-size: 18pt; margin: 0 0 6px; font-weight: 700; }
	.report-header p { margin: 2px 0; color: #444; font-size: 10pt; }
	h2 { font-size: 13pt; margin: 18px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
	h3 { font-size: 11pt; margin: 12px 0 6px; }
	section { margin-bottom: 12px; }
	.two-col {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 28px;
	}
	table { width: 100%; border-collapse: collapse; }
	td, th { padding: 3px 6px; vertical-align: top; }
	th { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.04em; color: #666; font-weight: 600; }
	.num { text-align: right; font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace; white-space: nowrap; width: 7.5rem; }
	.label { text-align: left; }
	.mono { font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace; }
	.gl-row td { font-weight: 600; padding-top: 6px; }
	.sub-row td { font-weight: 400; color: #222; }
	.cat-row td { font-size: 9.5pt; color: #444; }
	.indent-1 { padding-left: 1.25rem !important; }
	.indent-2 { padding-left: 2.25rem !important; }
	.italic { font-style: italic; }
	.muted { color: #999; }
	.total-row td { font-weight: 700; border-top: 1px solid #222; padding-top: 8px; margin-top: 4px; }
	.totals { margin-top: 6px; margin-bottom: 10px; }
	.net { margin-top: 20px; }
	.net-row td { font-size: 14pt; font-weight: 700; border-top: 2px solid #111; padding-top: 10px; }
	.header-cols { margin-bottom: 2px; }
	.header-cols th { border-bottom: 1px solid #ddd; }
	.tb th, .tb td { border-bottom: 1px solid #eee; padding: 5px 6px; }
	.tb tfoot td { border-top: 2px solid #111; border-bottom: none; font-weight: 700; }
	.good { color: #0a7a3e; }
	.bad { color: #b42318; }
	.open { color: #b45309; font-weight: 600; }
	.status { margin-top: 16px; font-weight: 600; text-align: center; }
	.empty { color: #777; font-size: 10pt; margin: 4px 0 8px; }
	.rank-row { display: grid; grid-template-columns: minmax(8rem, 14rem) 1fr 7.5rem; gap: 8px; align-items: center; margin: 4px 0 8px; }
	.rank-label { display: flex; flex-direction: column; font-size: 9.5pt; }
	.bar-track { background: #eee; border-radius: 999px; height: 8px; overflow: hidden; }
	.bar-fill { height: 8px; border-radius: 999px; }
	.bar-fill.income, .vbar.income, .swatch.income { background: #0a7a3e; }
	.bar-fill.expense, .vbar.expense, .swatch.expense { background: #b45309; }
	.bar-fill.cash { background: #1d4ed8; }
	.rank-row.sub { margin-left: 16px; }
	.rank-row.sub .rank-label { font-size: 9pt; font-weight: 400; }
	.month-chart { display: flex; gap: 18px; align-items: flex-end; height: 140px; margin: 8px 0 4px; }
	.month-col { flex: 1; max-width: 120px; display: flex; flex-direction: column; align-items: center; height: 100%; }
	.month-bars { flex: 1; width: 100%; display: flex; align-items: flex-end; justify-content: center; gap: 6px; }
	.vbar { width: 16px; border-radius: 4px 4px 0 0; min-height: 2px; }
	.month-name { margin-top: 6px; font-size: 9pt; color: #444; text-align: center; }
	.legend { font-size: 9pt; color: #444; }
	.swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin: 0 4px 0 10px; vertical-align: middle; }
	.swatch:first-child { margin-left: 0; }
	@media print {
		body { padding: 12px 16px; }
		.two-col { gap: 16px; }
		@page { margin: 12mm; }
	}
`;

/**
 * Open a clean report document and trigger the browser print dialog
 * so the user can save as PDF. Expanded accounts match the on-screen state.
 */
export function exportReportPdf(opts: ReportPdfOptions): void {
	let bodyHtml = '';
	const title = reportTitle(opts.type, opts.organizationName);

	if (opts.type === 'balance-sheet' && opts.balanceSheet) {
		bodyHtml = buildBalanceSheetHtml(opts.balanceSheet, opts);
	} else if (opts.type === 'profit-loss' && opts.profitLoss) {
		bodyHtml = buildProfitLossHtml(opts.profitLoss, opts);
	} else if (opts.type === 'trial-balance' && opts.trialBalance) {
		bodyHtml = buildTrialBalanceHtml(opts.trialBalance, opts);
	} else if (opts.type === 'check-references' && opts.checkReferenceReport) {
		bodyHtml = buildCheckReferenceHtml(opts.checkReferenceReport, opts);
	} else if (opts.type === 'quarterly' && opts.quarterlyReport) {
		bodyHtml = buildQuarterlyHtml(opts.quarterlyReport, opts);
	} else {
		throw new Error('No report data available to export');
	}

	const html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<title>${escapeHtml(title)}</title>
	<style>${PRINT_STYLES}</style>
</head>
<body>
	${bodyHtml}
	<script>
		window.onload = function () {
			setTimeout(function () {
				window.focus();
				window.print();
			}, 150);
		};
	<\/script>
</body>
</html>`;

	const printWindow = window.open('', '_blank');
	if (!printWindow) {
		throw new Error('Pop-up blocked. Allow pop-ups for this site to export PDF.');
	}
	printWindow.document.open();
	printWindow.document.write(html);
	printWindow.document.close();
}
