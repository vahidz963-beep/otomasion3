import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  formatInvoiceRialNumber,
  formatStatementNumber,
  statementCurrencyUnit,
  statementDisplayValue,
} from '../src/lib/currencyOutput.js';

const root = new URL('..', import.meta.url).pathname;
const read = (relative) => readFileSync(join(root, relative), 'utf8');

// Invoice/proforma output is always based on stored rials and never scales by
// the user's statement preference.
assert.equal(formatInvoiceRialNumber(12345, false, 'en'), '12,345');
assert.equal(formatInvoiceRialNumber(12345, true, 'en'), '12,345 ریال');
assert.equal(formatInvoiceRialNumber(Number.NaN, false, 'en'), '0');

// Statement conversion is presentation-only: persisted rial values are passed
// in unchanged and divided by ten only for the selected toman display.
assert.equal(statementDisplayValue(12345, 'rial'), 12345);
assert.equal(statementDisplayValue(12345, 'toman'), 1235);
assert.equal(statementDisplayValue(-12345, 'toman'), -1234);
assert.equal(statementDisplayValue(Number.NaN, 'rial'), 0);
assert.equal(formatStatementNumber(12345, 'rial', 'en'), '12,345');
assert.equal(formatStatementNumber(12345, 'toman', 'en'), '1,235');
assert.equal(statementCurrencyUnit('rial'), 'ریال');
assert.equal(statementCurrencyUnit('toman'), 'تومان');

const details = read('src/modules/accounting/FinanceDocumentDetails.jsx');
const printStart = details.indexOf('export function printFinanceDocument');
const printEnd = details.indexOf('export default function FinanceDocumentDetails', printStart);
const invoicePrint = details.slice(printStart, printEnd);
assert.equal((invoicePrint.match(/formatInvoiceRialNumber\([^)]*?, true\)/g) || []).length, 2);
assert.doesNotMatch(invoicePrint, /تومان|مبلغ واحد ریال/);
assert.match(invoicePrint, /<tr><td>جمع فاکتور<\/td><td class="money">\$\{formatInvoiceRialNumber\(d\.subtotal_amount, true\)\}/);
assert.match(invoicePrint, /<tr><td>قابل پرداخت<\/td><td class="money">\$\{formatInvoiceRialNumber\(d\.total_amount, true\)\}/);

const accounting = read('src/modules/accounting/AccountingModule.jsx');
const moneyStart = accounting.indexOf('function statementMoneyHtml');
const moneyEnd = accounting.indexOf('function exportStatement', moneyStart);
const statementMoney = accounting.slice(moneyStart, moneyEnd);
assert.doesNotMatch(statementMoney, /ریال|تومان|statement-money-unit|formatRial|formatMoney/);
assert.match(accounting, /body\.push\(\['', '', '', '', '', '', 'واحد تمام مبالغ', statementCurrencyUnit\(currencyDisplay\)\]\)/);
assert.match(accounting, /<div class="statement-unit-final">واحد تمام مبالغ این صورت‌حساب: <b>\$\{unit\}<\/b><\/div>/);
assert.match(accounting, /printStatement\(selectedParty, statement\.rows, lang, currencyDisplay\)/);
assert.match(accounting, /exportStatement\(selectedParty, statement\.rows, lang, currencyDisplay\)/);

console.log('CURRENCY_OUTPUT_POLICY_OK');
