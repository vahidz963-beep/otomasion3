import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (relative) => readFileSync(join(root, relative), 'utf8');

const financeApi = read('src/lib/financeApi.js');

// 1) The payment payload must be sanitized to the real finance_payments
//    columns; view-only extras must never reach insert/update.
assert.match(financeApi, /const FINANCE_PAYMENT_COLUMNS = \[[^\]]*'direction'/);
assert.match(financeApi, /export function sanitizeFinancePaymentPayload\(payment = \{\}\)/);
assert.match(financeApi, /for \(const key of FINANCE_PAYMENT_COLUMNS\)/);
assert.match(financeApi, /if \(clean\[key\] === ''\) clean\[key\] = null/);
const whitelistMatch = financeApi.match(/const FINANCE_PAYMENT_COLUMNS = \[([^\]]*)\]/);
assert.ok(whitelistMatch, 'payment column whitelist must exist');
for (const forbidden of ['direct_settlement_id', 'revision_reason', 'idempotency_key', 'document_id', 'allocation_amount', 'allocations', 'bank_name', 'account_name', 'account_id', 'order_code', 'party_name', 'id', 'created_at', 'batch_id']) {
  assert.doesNotMatch(whitelistMatch[1], new RegExp(`'${forbidden}'`), `${forbidden} must stay out of the insert/update whitelist`);
}
assert.match(financeApi, /\{ \.\.\.sanitizeFinancePaymentPayload\(payment\), amount: Number\(row\.amount \|\| 0\)/, 'create path must sanitize the payment payload');
assert.match(financeApi, /\{ \.\.\.sanitizeFinancePaymentPayload\(payment\), status: post \? 'draft'/, 'update path must sanitize the payment payload');

// 2) Source-linked payments stay editable from the cashflow section; only the
//    void/cancelled status guard remains in the shared editable-payment check.
const editableStart = financeApi.indexOf('async function getEditableFinancePayment');
const editableEnd = financeApi.indexOf('function recalculateAffectedFinanceDocuments', editableStart);
const editableBlock = financeApi.slice(editableStart, editableEnd);
assert.match(editableBlock, /سند باطل‌شده یا لغوشده قابل ویرایش نیست/);
assert.doesNotMatch(editableBlock, /این سند از بخش دیگری ساخته شده است/, 'blanket source-record refusal must stay removed');

// 3) Direct transfers still never pass through the generic update path.
assert.match(financeApi, /existingPayment\.method === 'direct_expense_offset'[\s\S]{0,200}حواله مستقیم/);

const accounting = read('src/modules/accounting/AccountingModule.jsx');

// 4) openPaymentEdit routes protected payments and allows the rest.
const editStart = accounting.indexOf('async function openPaymentEdit');
const editEnd = accounting.indexOf('function submitOrderInvoice', editStart);
const openEditBlock = accounting.slice(editStart, editEnd);
assert.match(openEditBlock, /direct_expense_offset/);
assert.match(openEditBlock, /loan_payment/);
assert.match(openEditBlock, /payrollPayments/);
assert.match(openEditBlock, /related_payment_id === payment\.id/, 'check-linked payments must be routed to the checks section');
assert.doesNotMatch(openEditBlock, /این سند از بخش اصلی خودش قابل اصلاح است/, 'cashflow rows must open the edit form instead of refusing');

// 5) Persian method labels replace raw method keys in the cashflow ledger.
assert.match(accounting, /const PAYMENT_METHOD_LABELS = \{/);
for (const method of ['bank_transfer', 'card', 'pos', 'cash', 'check', 'offset', 'loan_payment', 'account_transfer', 'direct_expense_offset', 'opening_balance', 'other']) {
  assert.match(accounting, new RegExp(`${method}: \\{ fa: '`), `method label for ${method} must exist`);
}
assert.match(accounting, /function methodLabel\(method, lang = 'fa'\)/);
const cashflowStart = accounting.indexOf('function CashFlowSection');
const cashflowEnd = accounting.indexOf('function getJalaliMonthKey', cashflowStart);
const cashflowBlock = accounting.slice(cashflowStart, cashflowEnd);
assert.match(cashflowBlock, /\{methodLabel\(r\.method, lang\)\}/);
assert.doesNotMatch(cashflowBlock, /حواله مستقیم|تسویه مستقیم/, 'direct transfer must not return to bank/cash actions');
assert.match(accounting, /<Info label="روش" value=\{methodLabel\(payment\?\.method, 'fa'\)\} \/>/);

// 6) The payment form understands internal account transfers end to end.
const forms = read('src/modules/accounting/AccountingForms.jsx');
assert.match(forms, /<option value="account_transfer">انتقال بین حساب‌ها<\/option>/);
assert.match(forms, /transfer_to_bank_account_id: method === 'bank_transfer' \|\| method === 'account_transfer' \? current\.transfer_to_bank_account_id : ''/);
assert.match(forms, /transfer_to_bank_account_id: payment\.method === 'bank_transfer' \|\| payment\.method === 'account_transfer' \? payment\.transfer_to_bank_account_id \|\| null : null/);
assert.match(forms, /const transferMethod = payment\.method === 'bank_transfer' \|\| payment\.method === 'account_transfer';/);
assert.match(forms, /payment\.method === 'account_transfer'\s*\n\s*\? Boolean\(payment\.transfer_to_bank_account_id\) && payment\.transfer_to_bank_account_id !== payment\.bank_account_id/);
assert.match(forms, /\{!isDirectExpense && transferMethod && <Field label=\{payment\.method === 'account_transfer' \? 'حساب مقصد انتقال' : 'حساب مقصد انتقال \(اختیاری\)'\}/);

// 7) Missing database objects must be named in the friendly error so the
//    operator knows exactly which SQL files to run.
const errorMessages = read('src/lib/errorMessages.js');
assert.match(errorMessages, /جدول یا View «\$\{missing\}» در دیتابیس پیدا نشد/);
assert.match(errorMessages, /supabase\/migrations باید به‌ترتیب و کامل در Supabase اجرا شوند/);
assert.match(errorMessages, /ستون «\$\{name\}» در دیتابیس وجود ندارد/);

console.log('CASHFLOW_EDITABILITY_OK');
