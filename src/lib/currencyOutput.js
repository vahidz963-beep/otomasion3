function normalizedInteger(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

/**
 * Invoice and proforma amounts are stored and rendered in rials regardless of
 * the user's statement display preference. The suffix is opt-in so callers
 * can restrict it to the final invoice rows.
 */
export function formatInvoiceRialNumber(value, withUnit = false, lang = 'fa') {
  const locale = lang === 'en' ? 'en-US' : 'fa-IR';
  const amount = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(normalizedInteger(value));
  return withUnit ? `${amount} ریال` : amount;
}

/** Convert a stored rial amount for statement presentation only. */
export function statementDisplayValue(value, currencyDisplay = 'toman') {
  const rialValue = Number(value || 0);
  const finiteRialValue = Number.isFinite(rialValue) ? rialValue : 0;
  return Math.round(currencyDisplay === 'rial' ? finiteRialValue : finiteRialValue / 10);
}

export function statementCurrencyUnit(currencyDisplay = 'toman') {
  return currencyDisplay === 'rial' ? 'ریال' : 'تومان';
}

export function formatStatementNumber(value, currencyDisplay = 'toman', lang = 'fa') {
  const locale = lang === 'en' ? 'en-US' : 'fa-IR';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(statementDisplayValue(value, currencyDisplay));
}
