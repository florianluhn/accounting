/**
 * Build a clean printable HTML document for financial reports and open the
 * browser print dialog (Save as PDF). Expansion state is mirrored exactly as
 * on screen — only expanded GL groups / subledgers are included in detail.
 */

import type {
	BalanceSheetReport,
	ProfitLossReport,
	TrialBalanceReport,
	GLAccountGroup,
	AccountBalance,
	CategoryBreakdown
} from './api';

export type ReportPdfType = 'balance-sheet' | 'profit-loss' | 'trial-balance';

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
				: 'Trial Balance';
	const name = organizationName.trim();
	return name ? `${base} ${name}` : base;
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
						<td class="label">Retained Earnings</td>
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
	.status { margin-top: 16px; font-weight: 600; text-align: center; }
	.empty { color: #777; font-size: 10pt; margin: 4px 0 8px; }
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
