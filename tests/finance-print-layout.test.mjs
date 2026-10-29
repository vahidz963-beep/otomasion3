import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calculateSinglePageScale } from '../src/lib/printLayout.js';

const root = new URL('..', import.meta.url).pathname;
const read = (relative) => readFileSync(join(root, relative), 'utf8');

assert.equal(calculateSinglePageScale(1000, 700, 900, 650), 1, 'content that already fits must not be enlarged');
assert.equal(calculateSinglePageScale(1000, 700, 1000, 1400), 0.5, 'height overflow must be fitted to one page');
assert.equal(calculateSinglePageScale(900, 700, 1200, 700), 0.75, 'width overflow must be fitted to one page');
assert.equal(calculateSinglePageScale(900, 700, 1200, 1400), 0.5, 'the stricter width/height ratio must win');
assert.equal(calculateSinglePageScale(0, 700, 1200, 1400), 1, 'invalid dimensions must fail safely');
assert.equal(calculateSinglePageScale(900, Number.NaN, 1200, 1400), 1, 'non-finite dimensions must fail safely');

const financePrint = read('src/lib/financeApi.js');
assert.match(financePrint, /import \{ calculateSinglePageScale \} from '\.\/printLayout'/);
assert.match(financePrint, /\.official-sheet\.invoice-sheet\{height:\$\{sheetHeight\};min-height:\$\{sheetHeight\};max-height:\$\{sheetHeight\};overflow:hidden/);
assert.match(financePrint, /function fitDirectCell\(element,minSize,step,keepSingleLine\)/, 'cell-aware auto-fit helper is required');
assert.match(financePrint, /function fitInvoiceCells\(\)/);
assert.match(financePrint, /querySelectorAll\('\.invoice-items-table th'\)/);
assert.match(financePrint, /querySelectorAll\('\.invoice-items-table td\.money'\)/);
assert.match(financePrint, /querySelectorAll\('\.totals-table td\.money'\)/);
assert.match(financePrint, /querySelectorAll\('\.field'\)/);
assert.match(financePrint, /data-cell-autofit','true'/);
assert.match(financePrint, /function fitInvoiceToSinglePage\(\)/);
assert.match(financePrint, /calculateSinglePageScale\(availableWidth,availableHeight,naturalWidth,naturalHeight\)/);
assert.match(financePrint, /window\.addEventListener\('beforeprint',fitAll\)/);
assert.match(financePrint, /document\.fonts&&document\.fonts\.ready/);
assert.match(financePrint, /window\.__printFinanceDocument=function\(\)/);
assert.match(financePrint, /onclick=\"window\.__printFinanceDocument\(\)\"/);
assert.match(financePrint, /data-single-page','true'/);
assert.match(financePrint, /body\.invoice-print\{width:\$\{sheetWidth\};height:\$\{sheetHeight\};max-height:\$\{sheetHeight\};overflow:hidden\}/);
assert.match(financePrint, /data-print-layout=\"\$\{isInvoice \? 'single-page-invoice' : 'report'\}\"/);
assert.match(financePrint, /class=\"\$\{innerClass\}\"[^>]*>.*<\/section><div class=\"footer-line\"/s, 'footer must be reserved outside scalable invoice content');
assert.match(financePrint, /function fitStatementMoneyCells\(\)/, 'person-statement fitting must remain available');
assert.doesNotMatch(financePrint, /\.invoice-money-value|fitInvoiceMoneyCells/, 'new split amount/unit layout must stay removed');

const details = read('src/modules/accounting/FinanceDocumentDetails.jsx');
assert.doesNotMatch(details, /function invoiceMoney\(value\)|class=\"invoice-money-value\"|class=\"invoice-money-unit\"/);
assert.match(details, /class=\"official-table invoice-items-table\"/);
assert.doesNotMatch(details, /<colgroup>/, 'percentage-based column layout must not return');
assert.match(details, /<th style=\"width:34px\">ردیف<\/th>/);
assert.match(details, /<th style=\"width:58px\">تعداد<\/th>/);
assert.match(details, /<th style=\"width:50px\">واحد<\/th>/);
assert.match(details, /<th>مبلغ واحد ریال<\/th>/);
assert.equal((details.match(/\$\{formatRial\(/g) || []).length >= 11, true, 'invoice values must use the approved single-line 136 format');
assert.match(details, /layout: 'invoice'/);
assert.match(details, /export function printFinanceDocument/);
assert.match(details, /printFinanceDocument\(bundle, 'company'\)/);
assert.match(details, /printFinanceDocument\(bundle, 'official'\)/);

console.log('FINANCE_PRINT_LAYOUT_OK');
