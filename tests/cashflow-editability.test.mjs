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

// ---------- Loan payment flow (migration 153 + connected voucher UI) ----------
const loanMigration = read('supabase/migrations/153_finance_loan_payment_flow.sql');
assert.match(loanMigration, /function public\.fn_finance_void_loan_installment_allocation/, 'no-document loan allocations must be voidable server-side');
assert.match(loanMigration, /این قسط به سند پرداخت مشترک متصل است/, 'shared-payment installments must route through the payment void path');
assert.match(loanMigration, /p\.status as payment_status/, 'installment view exposes the linked payment status');
assert.match(loanMigration, /e\.entry_number as journal_entry_number/, 'cashflow ledger carries the posted journal entry number');
assert.match(loanMigration, /e\.related_payment_id = p\.id and e\.status = 'posted'/, 'ledger joins only posted entries via a 1:1 lateral');
assert.match(loanMigration, /grant select on public\.v_finance_payment_ledger to authenticated/);

assert.match(financeApi, /export async function registerFinanceLoanPayment\(/, 'loan payments register through the standard payment flow');
assert.match(financeApi, /method: 'loan_payment'/);
assert.match(financeApi, /loan_start_installment_id: installmentId \|\| null/, 'allocation starts at the chosen installment');
assert.match(financeApi, /p_start_installment_id: payment\.loan_start_installment_id \|\| null/, 'create path passes the start installment to the allocation RPC');
assert.match(financeApi, /if \(row\.data\?\.payment_id\) \{\n    return voidFinancePayment\(row\.data\.payment_id/, 'with-document installment payments void through the shared payment path');
assert.match(financeApi, /fn_finance_void_loan_installment_allocation/, 'without-document installment payments use the dedicated reversal RPC');
assert.match(financeApi, /export async function fetchFinancePaymentJournal\(/);
assert.match(financeApi, /export async function fetchFinanceEntryHead\(/);
assert.match(financeApi, /export async function fetchFinanceEntryLines\(/);

assert.match(accounting, /function LoanPaymentModal\(\{ installment, payments = \[\], bankAccounts = \[\], cashboxes = \[\]/, 'loan payment modal receives bank/cash accounts');
assert.match(accounting, /پرداخت با سند بانک\/صندوق/);
assert.match(accounting, /اتصال به پرداخت موجود/);
assert.match(accounting, /بدون سند/);
assert.match(accounting, /mode === 'document' \? \{ mode, loanId: installment\.loan_id/);
assert.match(accounting, /function JournalEntryModal\(/, 'journal entry viewer exists');
assert.match(accounting, /جریانات سند حسابداری/);
assert.match(accounting, /loan-voucher-btn/, 'installment voucher cell is clickable');
assert.match(accounting, /ledger-voucher-btn/, 'cashflow rows expose their voucher under the description');
assert.match(accounting, /onDeleteInstallmentPayment/, 'installments expose a safe delete for with/without-document payments');
