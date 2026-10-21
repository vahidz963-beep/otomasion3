export const SHIPMENT_STATUS_LABELS = Object.freeze({
  pending_warehouse: 'آماده بررسی',
  ready: 'ثبت دستی / آماده',
  sent: 'ارسال‌شده',
  delivered: 'تحویل‌شده',
  returned: 'برگشتی',
  cancelled: 'برگشت / لغو',
});

export function normalizeShipmentStatus(status) {
  if (status === 'pending_warehouse') return 'ready';
  if (status === 'returned') return 'cancelled';
  return status || 'ready';
}

export function shipmentStatusLabel(status) {
  return SHIPMENT_STATUS_LABELS[status] || SHIPMENT_STATUS_LABELS[normalizeShipmentStatus(status)] || status || 'نامشخص';
}

export function shipmentSourceLabel(shipmentOrType) {
  const shipment = typeof shipmentOrType === 'string' ? { source_type: shipmentOrType } : (shipmentOrType || {});
  if (shipment.is_manual_record || (shipment.source_type === 'manual' && !shipment.related_order_id)) return 'ثبت دستی متنی';
  if (shipment.order_sales_path === 'production' || shipment.source_type === 'production') return 'سفارش تولیدی';
  if (shipment.order_sales_path === 'rnd' || shipment.source_type === 'rnd') return 'سفارش R&D';
  if (shipment.order_sales_path === 'trading' || shipment.source_type === 'trading') return 'سفارش بازرگانی';
  if (shipment.source_type === 'finance_invoice') return 'سابقه فاکتور';
  if (shipment.source_type === 'sales_return') return 'برگشت فروش';
  return 'سابقه ارسال';
}

export function shipmentLines(shipment) {
  const value = shipment?.line_items;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function shipmentLineText(shipment, separator = ' | ') {
  const lines = shipmentLines(shipment);
  if (lines.length > 0) {
    return lines.map((line) => `${line.item_name || 'کالا'} (${line.item_code || '—'}): ${Number(line.quantity || 0).toLocaleString('fa-IR')} ${line.unit || ''}`.trim()).join(separator);
  }
  return shipment?.item_summary || '—';
}

export function shipmentSearchText(shipment) {
  return [
    shipment?.shipment_number,
    shipment?.order_code,
    shipment?.customer_name,
    shipment?.customer_code,
    shipment?.customer_city,
    shipment?.warehouse_doc_number,
    shipment?.finance_doc_number,
    shipment?.carrier_name,
    shipment?.tracking_code,
    shipment?.receiver_name,
    shipment?.item_summary,
    shipmentLineText(shipment, ' '),
  ].filter(Boolean).join(' ').toLocaleLowerCase('fa');
}

export function shipmentStats(shipments = []) {
  return shipments.reduce((stats, shipment) => {
    stats.total += 1;
    const status = normalizeShipmentStatus(shipment?.status);
    if (status === 'sent' || shipment?.status === 'delivered') stats.sent += 1;
    if (status === 'ready') stats.ready += 1;
    if (status === 'cancelled') stats.cancelled += 1;
    if (shipment?.is_manual_record || (shipment?.source_type === 'manual' && !shipment?.related_order_id)) stats.manual += 1;
    return stats;
  }, { total: 0, sent: 0, ready: 0, cancelled: 0, manual: 0 });
}
