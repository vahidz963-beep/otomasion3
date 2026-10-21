import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  Calculator,
  CheckCircle2,
  CircuitBoard,
  ClipboardList,
  Database,
  FileText,
  Layers3,
  Link2,
  PackagePlus,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
  Warehouse,
  X,
  Zap,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import { formatJalaliDateTime, formatNumber, formatToman } from '../../lib/formatters';
import { ARYAMAN_FONT_FAMILY_CSS, buildAryamanFontFaceCss } from '../../lib/typography';
import {
  calculateBoard,
  calculateTransformer,
  confirmTransformer,
  consumeCalculatorQuote,
  getCalculatorAdminSettings,
  getCalculatorCatalog,
  getCalculatorQuote,
  listCalculatorQuotes,
  promoteCalculatorQuote,
  publishTransformerFormula,
  previewTransformerFill,
  releaseCalculatorQuote,
  reserveCalculatorQuote,
  saveCalculatorComponent,
  setCalculatorPublicFlag,
} from '../../lib/calculatorApi';
import { buildPinDiagramSvg, buildWindowFillSvg } from './calculatorVisuals';
import { openTransformerPdfReport } from './calculatorReports';
import './CalculatorModule.css';

const DEFAULT_WINDINGS = [
  { id: 1, name: 'اولیه', start_pin: 1, end_pin: 2, turns: 100, wire_id: '', strands: 1, arrangement: 'side', layer_mode: 'auto', requested_layers: 1, direction: 'cw' },
  { id: 2, name: 'ثانویه', start_pin: 3, end_pin: 4, turns: 20, wire_id: '', strands: 1, arrangement: 'side', layer_mode: 'auto', requested_layers: 1, direction: 'ccw' },
];

const STATUS_LABELS = {
  draft: 'پیش‌نویس', calculated: 'محاسبه‌شده', submitted: 'ارسال‌شده', approved: 'تأییدشده', paid: 'پرداخت‌شده',
  reserved: 'مواد رزرو شد', in_production: 'در تولید', produced: 'تولید پایان یافت', cancelled: 'لغوشده', expired: 'منقضی',
};

const KIND_LABELS = { core: 'هسته', bobbin: 'بوبین', wire: 'سیم مسی لاکی' };

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function formatWireLabel(diameterMm, awg) {
  return `${formatNumber(diameterMm)} mm${awg ? ` (AWG ${formatNumber(awg)})` : ''}`;
}

function normalizedUnit(value) {
  return String(value || '').trim().toLowerCase();
}

function isCompatibleWarehouseUnit(kind, value) {
  const unit = normalizedUnit(value);
  if (kind === 'wire') return ['گرم', 'g', 'gr', 'gram', 'grams'].includes(unit);
  return ['عدد', 'piece', 'pieces', 'pcs', 'pc'].includes(unit);
}

function ErrorNotice({ message, onClose }) {
  if (!message) return null;
  return <div className="calc-notice error" role="alert"><AlertTriangle size={18}/><span>{message}</span>{onClose && <button type="button" onClick={onClose}><X size={16}/></button>}</div>;
}

function SuccessNotice({ message, onClose }) {
  if (!message) return null;
  return <div className="calc-notice success" role="status"><CheckCircle2 size={18}/><span>{message}</span>{onClose && <button type="button" onClick={onClose}><X size={16}/></button>}</div>;
}

function LoadingBlock({ text = 'در حال دریافت اطلاعات...' }) {
  return <div className="calc-loading"><RefreshCw className="spin" size={22}/><span>{text}</span></div>;
}

function Field({ label, children, hint, className = '' }) {
  return <label className={`calc-field ${className}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function Modal({ title, children, onClose, wide = false }) {
  return <div className="calc-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`calc-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header><h3>{title}</h3><button type="button" onClick={onClose} aria-label="بستن"><X/></button></header>
      {children}
    </section>
  </div>;
}

function Hero({ designer, setDesigner, section, setSection }) {
  return <>
    <section className="calc-hero">
      <div className="calc-hero-copy">
        <span className="calc-eyebrow"><Calculator size={17}/> مرکز محاسبه</span>
        <h1>طراحی، قیمت‌گذاری و اتصال تولید</h1>
      </div>
      <div className="calc-designer-switch" aria-label="انتخاب طراح">
        <button type="button" className={designer === 'transformer' ? 'active' : ''} onClick={() => { setDesigner('transformer'); setSection('design'); }}><Layers3/>طراح ترانس</button>
        <button type="button" className={designer === 'board' ? 'active' : ''} onClick={() => { setDesigner('board'); setSection('design'); }}><CircuitBoard/>طراح برد</button>
      </div>
    </section>
    <nav className="calc-tabs" aria-label="بخش‌های مرکز محاسبه">
      <button type="button" className={section === 'design' ? 'active' : ''} onClick={() => setSection('design')}><Calculator/>محاسبه</button>
      <button type="button" className={section === 'orders' ? 'active' : ''} onClick={() => setSection('orders')}><ClipboardList/>سفارش‌های سایت و تولید</button>
      <button type="button" className={section === 'catalog' ? 'active' : ''} onClick={() => setSection('catalog')}><Database/>مدل‌ها و اتصال انبار</button>
    </nav>
  </>;
}

function InventoryStatus({ row, compact = false }) {
  if (!row) return <span className="calc-stock-state neutral">ثبت نشده</span>;
  const sufficient = Boolean(row.sufficient);
  return <span className={`calc-stock-state ${sufficient ? 'ok' : 'bad'}`}>{sufficient ? 'موجود و کافی' : 'ناموجود / ناکافی'}{!compact && <> · نیاز {formatNumber(row.quantity_total)} {row.unit} · قابل رزرو {formatNumber(row.available_qty)} {row.unit}</>}</span>;
}

function InternalPricingBreakdown({ pricing }) {
  if (!pricing) return null;
  const operations = pricing.operation_breakdown || [];
  const wireLines = pricing.wire_cost_lines || [];
  return <section className="calc-confidential-pricing">
    <div className="calc-section-heading"><ShieldCheck/><span><b>ریز محرمانه محاسبات و قیمت‌گذاری</b><small>نمایش این بخش تحت کنترل تنظیمات مدیر است و برای مشتری ارسال نمی‌شود.</small></span></div>
    <div className="calc-table-scroll"><table className="calc-pricing-table"><thead><tr><th>عنوان</th><th>مبنای محاسبه</th><th>مبلغ</th></tr></thead><tbody>
      <tr><td>بهای هسته</td><td>۱ عدد برای هر ترانس</td><td>{formatToman(pricing.core_cost_rial)}</td></tr>
      <tr><td>بهای بوبین</td><td>۱ عدد برای هر ترانس</td><td>{formatToman(pricing.bobbin_cost_rial)}</td></tr>
      {wireLines.map((line) => <tr key={line.wire_id}><td>سیم {line.label}</td><td>{formatNumber(line.quantity_per_unit_g)} گرم × {formatToman(line.unit_cost_rial_per_g)}</td><td>{formatToman(line.amount_rial)}</td></tr>)}
      <tr><td>دستمزد</td><td>{formatNumber(pricing.labor_minutes)} دقیقه · نرخ ساعتی {formatToman(pricing.labor_hour_rial)}</td><td>{formatToman(pricing.labor_cost_rial)}</td></tr>
      {operations.map((line) => <tr key={line.key}><td>{line.label}</td><td>عملیات هر عدد</td><td>{formatToman(line.amount_rial)}</td></tr>)}
      <tr className="subtotal"><td>بهای مستقیم</td><td>قطعات + کار + عملیات</td><td>{formatToman(pricing.direct_cost_rial)}</td></tr>
      <tr><td>سربار</td><td>{formatNumber(pricing.overhead_percent)}٪</td><td>{formatToman(pricing.overhead_cost_rial)}</td></tr>
      <tr className="subtotal"><td>بهای تمام‌شده</td><td>مبنای قیمت‌گذاری</td><td>{formatToman(pricing.total_cost_rial)}</td></tr>
      <tr><td>سود افزایشی</td><td>{formatNumber(pricing.profit_percent)}٪</td><td>{formatToman(pricing.profit_amount_rial)}</td></tr>
      <tr><td>افزایش سفارش نمونه</td><td>ضریب {formatNumber(pricing.sample_multiplier)}</td><td>{formatToman(pricing.sample_surcharge_rial)}</td></tr>
      <tr><td>هزینه ستاپ</td><td>یک‌بار برای سفارش</td><td>{formatToman(pricing.setup_fee_rial)}</td></tr>
      <tr className="grand"><td>مبلغ نهایی</td><td>{formatNumber(pricing.quantity)} عدد</td><td>{formatToman(pricing.total_sale_rial)}</td></tr>
    </tbody></table></div>
  </section>;
}

function TransformerDesigner({ catalog, onQuoteSaved }) {
  const cores = catalog?.cores || [];
  const wires = catalog?.wires || [];
  const [coreId, setCoreId] = useState('');
  const [bobbinId, setBobbinId] = useState('');
  const [orderType, setOrderType] = useState('sample');
  const [quantity, setQuantity] = useState(1);
  const [customer, setCustomer] = useState({ customer_name: '', customer_phone: '', customer_email: '', project_title: '' });
  const [hasGap, setHasGap] = useState(false);
  const [windings, setWindings] = useState(DEFAULT_WINDINGS);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [liveFill, setLiveFill] = useState({ loading: false, percent: null, status: 'idle', error: '' });
  const previewSequence = useRef(0);
  const calculationSequence = useRef(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const allBobbins = catalog?.bobbins || [];
  const bobbins = useMemo(() => allBobbins.filter((bobbin) => bobbin.core_id === coreId), [allBobbins, coreId]);
  const selectedCore = cores.find((core) => core.id === coreId) || null;
  const selectedBobbin = allBobbins.find((bobbin) => bobbin.id === bobbinId) || null;
  const readyCoreIds = useMemo(() => new Set(allBobbins.filter((bobbin) => bobbin.calculable).map((bobbin) => bobbin.core_id)), [allBobbins]);
  const mappedWires = wires.filter((wire) => wire.calculable);
  const wireById = useMemo(() => new Map(wires.map((wire) => [wire.id, wire])), [wires]);
  const maxPin = selectedBobbin ? Number(selectedBobbin.pins_left) + Number(selectedBobbin.pins_right) : 10;
  const selectedCoreReady = selectedCore?.calculable;
  const selectedBobbinReady = selectedBobbin?.calculable;
  const selectionReady = Boolean(selectedCoreReady && selectedBobbinReady && windings.length && windings.every((row) => {
    const wire = wires.find((item) => item.id === row.wire_id);
    return row.wire_id && wire?.calculable;
  }));
  const technicalPayload = useMemo(() => ({
    core_id: coreId,
    bobbin_id: bobbinId,
    order_type: orderType,
    quantity: Number(quantity),
    has_gap: hasGap,
    windings: windings.map(({ id, ...row }) => row),
  }), [coreId, bobbinId, orderType, quantity, hasGap, windings]);
  const calculationPayload = useMemo(() => ({ ...technicalPayload, ...customer }), [technicalPayload, customer]);
  const previewKey = useMemo(() => JSON.stringify(technicalPayload), [technicalPayload]);
  const calculationKey = useMemo(() => JSON.stringify(calculationPayload), [calculationPayload]);

  useEffect(() => {
    const sequence = ++previewSequence.current;
    if (!selectionReady) {
      setLiveFill({ loading: false, percent: null, status: 'idle', error: '' });
      return undefined;
    }
    setLiveFill((current) => ({ ...current, loading: true, error: '' }));
    const timer = window.setTimeout(async () => {
      try {
        const data = await previewTransformerFill(technicalPayload);
        if (sequence !== previewSequence.current) return;
        const percent = Number(data.occupancy_percent);
        setLiveFill({
          loading: false,
          percent: Number.isFinite(percent) ? percent : null,
          status: percent > 100 ? 'danger' : percent >= 90 ? 'warning' : 'ok',
          error: '',
        });
      } catch (previewError) {
        if (sequence !== previewSequence.current) return;
        setLiveFill((current) => ({ ...current, loading: false, error: previewError.message || 'پیش‌نمایش زنده در دسترس نیست' }));
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [selectionReady, previewKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    calculationSequence.current += 1;
    setResult(null);
    setSuccess('');
  }, [calculationKey]);

  useEffect(() => {
    if (!windings.some((row) => row.wire_id) && mappedWires[0]) {
      setWindings((current) => current.map((row, index) => ({ ...row, wire_id: mappedWires[Math.min(index, mappedWires.length - 1)]?.id || mappedWires[0].id })));
    }
  }, [mappedWires.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setBobbinId('');
    setResult(null);
  }, [coreId]);

  useEffect(() => {
    setWindings((current) => current.map((row, index) => ({ ...row, start_pin: Math.min(Math.max(1, Number(row.start_pin) || index * 2 + 1), maxPin), end_pin: Math.min(Math.max(1, Number(row.end_pin) || index * 2 + 2), maxPin) })));
    setResult(null);
  }, [bobbinId, maxPin]);

  function updateCustomer(key, value) {
    setCustomer((current) => ({ ...current, [key]: value }));
    setResult(null);
  }

  function updateWinding(id, key, value) {
    setWindings((current) => current.map((row) => row.id === id ? { ...row, [key]: ['turns', 'strands', 'requested_layers', 'start_pin', 'end_pin'].includes(key) ? Number(value) : value } : row));
    setResult(null);
  }

  function addWinding() {
    if (windings.length >= 12) return;
    const id = Math.max(0, ...windings.map((row) => row.id)) + 1;
    const index = windings.length;
    setWindings([...windings, { id, name: `سیم‌پیچ ${index + 1}`, start_pin: Math.min(maxPin, index * 2 + 1), end_pin: Math.min(maxPin, index * 2 + 2), turns: 10, wire_id: mappedWires[0]?.id || '', strands: 1, arrangement: 'side', layer_mode: 'auto', requested_layers: 1, direction: 'cw' }]);
    setResult(null);
  }

  async function runCalculation() {
    setError(''); setSuccess('');
    if (!selectionReady) { setError('ابتدا هسته، بوبین و سیم‌های متصل به انبار را کامل انتخاب کنید.'); return; }
    const sequence = ++calculationSequence.current;
    setBusy(true);
    try {
      const data = await calculateTransformer(calculationPayload);
      if (sequence !== calculationSequence.current) return;
      setResult(data);
      if (!data.valid) setError((data.errors || []).map((item) => item.message).join(' '));
    } catch (calculationError) {
      if (sequence === calculationSequence.current) setError(calculationError.message);
    } finally { setBusy(false); }
  }

  async function confirmCalculation() {
    setError(''); setSuccess('');
    if (!result?.valid) { setError('ابتدا محاسبه معتبر را انجام دهید.'); return; }
    if (!customer.customer_name.trim() || !customer.customer_phone.trim() || !customer.project_title.trim()) {
      setError('برای تأیید نهایی، نام مشتری، شماره تماس و عنوان پروژه را کامل کنید.');
      return;
    }
    const sequence = ++calculationSequence.current;
    setConfirmBusy(true);
    try {
      const data = await confirmTransformer(calculationPayload);
      if (sequence !== calculationSequence.current) return;
      setResult(data);
      if (data.valid && data.quote) {
        setSuccess(`تأیید نهایی انجام شد؛ سفارش با کد ${data.quote.public_code} در بخش «سفارش‌های سایت و تولید» ثبت شد.`);
        onQuoteSaved?.();
      } else {
        setError((data.errors || []).map((item) => item.message).join(' ') || 'ثبت نهایی سفارش ناموفق بود.');
      }
    } catch (confirmationError) {
      if (sequence === calculationSequence.current) setError(confirmationError.message);
    } finally { setConfirmBusy(false); }
  }

  const fillSvg = useMemo(() => result?.engineering ? buildWindowFillSvg(selectedBobbin, result.engineering) : '', [result, selectedBobbin]);
  const pinSvg = useMemo(() => result?.engineering ? buildPinDiagramSvg(selectedBobbin, result.engineering) : '', [result, selectedBobbin]);

  function printReport(kind) {
    if (!result?.engineering || !fillSvg || !pinSvg) return;
    openTransformerPdfReport({
      kind,
      code: result.quote?.public_code || 'PREVIEW',
      quote: result.quote,
      confirmed: Boolean(result.quote),
      customerName: customer.customer_name,
      customerPhone: customer.customer_phone,
      projectTitle: customer.project_title,
      orderType,
      quantity: Number(quantity),
      hasGap,
      core: selectedCore || result.components?.core || {},
      bobbin: selectedBobbin || result.components?.bobbin || {},
      engineering: result.engineering,
      publicResult: result.public_result || {},
      inventory: result.inventory || [],
      pricing: result.pricing || null,
      formulaVersion: result.formula_version || '',
      fillSvg,
      pinSvg,
    });
  }

  return <div className={`calc-design-layout ${confirmBusy ? 'is-confirming' : ''}`}>
    <section className="calc-card calc-input-panel">
      <div className="calc-card-title"><div><Zap/><h2>مشخصات ترانس</h2></div><span className={`calc-sync-badge ${selectionReady ? 'ok' : ''}`}><Link2/>اتصال زنده انبار</span></div>
      <div className="calc-order-type">
        <button type="button" className={orderType === 'sample' ? 'active' : ''} onClick={() => { setOrderType('sample'); setQuantity(Math.min(99, Math.max(1, Number(quantity)))); setResult(null); }}><strong>سفارش نمونه ترانس</strong><small>۱ – ۹۹ عدد</small></button>
        <button type="button" className={orderType === 'production' ? 'active' : ''} onClick={() => { setOrderType('production'); setQuantity(Math.max(100, Number(quantity))); setResult(null); }}><strong>سفارش تعداد</strong><small>+۱۰۰ عدد</small></button>
      </div>
      <div className="calc-form-grid">
        <Field label="مدل هسته" hint={selectedCore ? `موجودی قابل رزرو: ${formatNumber(selectedCore.available_qty)} عدد${selectedCore.warehouse_code ? ` · کد ${selectedCore.warehouse_code}` : ''}` : 'پس از انتخاب، موجودی واقعی انبار نمایش داده می‌شود.'}>
          <select value={coreId} onChange={(event) => setCoreId(event.target.value)}><option value="">انتخاب هسته</option>{cores.map((core) => {
            const ready = (core.calculable) && readyCoreIds.has(core.id);
            return <option key={core.id} value={core.id} disabled={!ready}>{core.model_code}{ready ? '' : ' · نیازمند تکمیل/اتصال انبار'}</option>;
          })}</select>
        </Field>
        <Field label="مدل بوبین" hint={selectedBobbin ? `موجودی قابل رزرو: ${formatNumber(selectedBobbin.available_qty)} عدد${selectedBobbin.warehouse_code ? ` · کد ${selectedBobbin.warehouse_code}` : ''}` : 'در گزینه فقط تعداد پین و جهت نصب نمایش داده می‌شود.'}>
          <select value={bobbinId} onChange={(event) => setBobbinId(event.target.value)} disabled={!coreId}><option value="">انتخاب بوبین</option>{bobbins.map((bobbin) => { const ready = bobbin.calculable; return <option key={bobbin.id} value={bobbin.id} disabled={!ready}>{bobbin.pins_left}+{bobbin.pins_right} پین · {bobbin.mount_orientation}{ready ? '' : ' · بدون اتصال معتبر انبار'}</option>; })}</select>
        </Field>
        <Field label="تعداد">
          <input type="number" min={orderType === 'production' ? 100 : 1} max={orderType === 'sample' ? 99 : undefined} value={quantity} onChange={(event) => { setQuantity(event.target.value); setResult(null); }}/>
        </Field>
        <Field label="عنوان پروژه"><input value={customer.project_title} maxLength={200} onChange={(event) => updateCustomer('project_title', event.target.value)}/></Field>
        <Field label="نام مشتری"><input value={customer.customer_name} maxLength={160} onChange={(event) => updateCustomer('customer_name', event.target.value)}/></Field>
        <Field label="شماره تماس"><input value={customer.customer_phone} maxLength={40} onChange={(event) => updateCustomer('customer_phone', event.target.value)}/></Field>
      </div>
      <label className="calc-check"><input type="checkbox" checked={hasGap} onChange={(event) => { setHasGap(event.target.checked); setResult(null); }}/><span>هسته دارای گپ است</span></label>
      {!selectionReady && <div className="calc-inline-warning"><AlertTriangle/>مدل ناقص یا بدون اتصال انبار دیده می‌شود، اما محاسبه آن غیرفعال است. اتصال را از بخش «مدل‌ها و اتصال انبار» کامل کنید.</div>}
    </section>

    <section className="calc-card calc-winding-panel">
      <div className="calc-card-title"><div><Layers3/><h2>سیم‌پیچ‌ها</h2></div></div>
      <div className="calc-table-scroll">
        <table className="calc-winding-table has-row-numbers"><thead><tr><th>ردیف</th><th>نام</th><th>شروع</th><th>پایان</th><th>دور</th><th>سیم</th><th>رشته</th><th>لایه</th><th>جهت</th><th></th></tr></thead><tbody>{windings.map((row, index) => <tr key={row.id}>
          <td>{formatNumber(index + 1)}</td>
          <td><input value={row.name} onChange={(event) => updateWinding(row.id, 'name', event.target.value)}/></td>
          <td><select value={row.start_pin} onChange={(event) => updateWinding(row.id, 'start_pin', event.target.value)}>{Array.from({ length: maxPin }, (_, pin) => <option key={pin + 1} value={pin + 1}>{formatNumber(pin + 1)}</option>)}</select></td>
          <td><select value={row.end_pin} onChange={(event) => updateWinding(row.id, 'end_pin', event.target.value)}>{Array.from({ length: maxPin }, (_, pin) => <option key={pin + 1} value={pin + 1}>{formatNumber(pin + 1)}</option>)}</select></td>
          <td><input type="number" min="1" value={row.turns} onChange={(event) => updateWinding(row.id, 'turns', event.target.value)}/></td>
          <td><div className="calc-wire-select"><select value={row.wire_id} onChange={(event) => updateWinding(row.id, 'wire_id', event.target.value)}><option value="">انتخاب</option>{wires.map((wire) => { const ready = wire.calculable; return <option key={wire.id} value={wire.id} disabled={!ready}>{formatWireLabel(wire.diameter_mm, wire.awg)}{ready ? '' : ' · بدون اتصال معتبر انبار'}</option>; })}</select>{row.wire_id && <small className={Number(wireById.get(row.wire_id)?.available_qty) > 0 ? 'ok' : 'bad'}>موجودی: {formatNumber(wireById.get(row.wire_id)?.available_qty)} گرم</small>}</div></td>
          <td><input type="number" min="1" max="20" value={row.strands} onChange={(event) => updateWinding(row.id, 'strands', event.target.value)}/></td>
          <td><div className="calc-layer-cell"><select value={row.layer_mode} onChange={(event) => updateWinding(row.id, 'layer_mode', event.target.value)}><option value="auto">خودکار</option><option value="manual">دستی</option></select>{row.layer_mode === 'manual' && <input type="number" min="1" value={row.requested_layers} onChange={(event) => updateWinding(row.id, 'requested_layers', event.target.value)}/>}</div></td>
          <td><select value={row.direction} onChange={(event) => updateWinding(row.id, 'direction', event.target.value)}><option value="cw">ساعتگرد</option><option value="ccw">پادساعتگرد</option></select></td>
          <td><button type="button" className="calc-icon danger" aria-label="حذف سیم‌پیچ" disabled={windings.length === 1} onClick={() => { setWindings(windings.filter((item) => item.id !== row.id)); setResult(null); }}><Trash2/></button></td>
        </tr>)}</tbody></table>
      </div>
      <div className="calc-winding-footer"><button type="button" className="calc-secondary" onClick={addWinding} disabled={windings.length >= 12}><Plus/>افزودن سیم‌پیچ</button></div>
      <div className={`calc-live-fill ${liveFill.status}`}>
        <div className="calc-live-fill-head"><span><Layers3/>پرشدگی زنده پنجره</span><b>{liveFill.loading ? 'در حال به‌روزرسانی…' : liveFill.percent === null ? '—' : `${formatNumber(liveFill.percent)}٪`}</b></div>
        <div className="calc-live-fill-track" role="progressbar" aria-label="درصد پرشدگی پنجره" aria-valuemin="1" aria-valuemax="100" aria-valuenow={liveFill.percent === null ? 1 : Math.min(100, Math.max(1, liveFill.percent))}><span style={{ width: `${liveFill.percent === null ? 0 : Math.min(100, Math.max(1, liveFill.percent))}%` }}/></div>
        <div className="calc-live-fill-scale"><span>۱٪</span><span>۲۵٪</span><span>۵۰٪</span><span>۷۵٪</span><span>۱۰۰٪</span></div>
        <small>{liveFill.error || (selectionReady ? 'با هر تغییر در دور، سیم، رشته یا لایه به‌صورت خودکار محاسبه می‌شود.' : 'برای نمایش نوار، هسته، بوبین و سیم‌ها را کامل انتخاب کنید.')}</small>
      </div>
      <ErrorNotice message={error} onClose={() => setError('')}/><SuccessNotice message={success} onClose={() => setSuccess('')}/>
      <button type="button" className="calc-primary calc-run" disabled={busy || !selectionReady} onClick={runCalculation}>{busy ? <RefreshCw className="spin"/> : <Calculator/>}{busy ? 'در حال محاسبه امن...' : 'محاسبه و نمایش نتیجه'}</button>
    </section>

    {result?.engineering && <section className="calc-card calc-result-panel">
      <div className="calc-result-head">
        <div><span className={`calc-result-state ${result.valid ? 'ok' : 'bad'}`}>{result.valid ? <CheckCircle2/> : <AlertTriangle/>}{result.valid ? (result.quote ? 'تأیید نهایی و ثبت‌شده' : 'محاسبه معتبر؛ منتظر تأیید نهایی') : 'نیازمند اصلاح'}</span><h2>{selectedCore?.model_code} · {selectedBobbin?.pins_left}+{selectedBobbin?.pins_right} پین · {selectedBobbin?.mount_orientation}</h2><small>{result.quote?.public_code || 'پیش‌نمایش بدون ثبت؛ هنگام تأیید دوباره در سرور محاسبه می‌شود'}</small></div>
      </div>

      <section className="calc-result-category summary">
        <div className="calc-category-title"><span>۱</span><div><h3>خلاصه امکان ساخت، موجودی و قیمت نهایی</h3><small>اطلاعات سریع و قابل ارائه پیش از تأیید سفارش</small></div></div>
        <div className="calc-customer-summary">
          <div><small>اشغال پنجره</small><b>{formatNumber(result.engineering.occupancy_percent)}٪</b></div>
          <div><small>وضعیت ساخت</small><b className={result.valid ? 'ok' : 'bad'}>{result.valid ? 'مجاز' : 'نیازمند اصلاح'}</b></div>
          <div><small>موجودی هسته</small><InventoryStatus compact row={(result.inventory || []).find((item) => item.component_role === 'core')}/></div>
          <div><small>موجودی بوبین</small><InventoryStatus compact row={(result.inventory || []).find((item) => item.component_role === 'bobbin')}/></div>
          <div><small>قیمت هر عدد</small><b>{formatToman(result.public_result?.unit_sale_rial)}</b></div>
          <div><small>هزینه ستاپ</small><b>{formatToman(result.public_result?.setup_fee_rial)}</b></div>
          <div><small>تعداد سفارش</small><b>{formatNumber(quantity)} عدد</b></div>
          <div className="total"><small>مبلغ نهایی</small><strong>{formatToman(result.public_result?.total_sale_rial)}</strong></div>
        </div>
        <div className="calc-table-scroll calc-inventory-result"><table><thead><tr><th>قلم مصرفی</th><th>مصرف هر عدد</th><th>نیاز کل</th><th>موجودی قابل رزرو</th><th>وضعیت</th></tr></thead><tbody>{(result.inventory || []).map((item, index) => <tr key={`${item.warehouse_item_id || item.component_role}-${index}`}><td><b>{item.label || (item.component_role === 'core' ? selectedCore?.model_code : item.component_role === 'bobbin' ? `${selectedBobbin?.pins_left}+${selectedBobbin?.pins_right} پین` : 'سیم مسی لاکی')}</b><small>{item.component_role === 'core' ? 'هسته' : item.component_role === 'bobbin' ? 'بوبین' : 'سیم'}</small></td><td>{formatNumber(item.quantity_per_unit)} {item.unit}</td><td>{formatNumber(item.quantity_total)} {item.unit}</td><td>{formatNumber(item.available_qty)} {item.unit}</td><td><InventoryStatus compact row={item}/></td></tr>)}</tbody></table></div>
        {!result.quote && result.valid && <div className="calc-confirm-box"><ShieldCheck/><div><b>تأیید و ثبت نهایی</b><p>پس از تأیید، قیمت و موجودی دوباره در Edge بررسی، Snapshot ثابت و سفارش ثبت می‌شود.</p></div><button type="button" className="calc-primary" disabled={confirmBusy} onClick={confirmCalculation}>{confirmBusy ? <RefreshCw className="spin"/> : <CheckCircle2/>}{confirmBusy ? 'در حال ثبت نهایی…' : 'تأیید نهایی و ثبت سفارش'}</button></div>}
        {result.quote && <div className="calc-confirmed-box"><CheckCircle2/><span><b>سفارش ثبت شد</b><small>کد پیگیری: {result.quote.public_code}</small></span></div>}
      </section>

      <section className="calc-result-category technical">
        <div className="calc-category-title"><span>۲</span><div><h3>پرونده فنی، جدول‌ها و نقشه‌های پیش از تأیید</h3><small>اطلاعات دسته‌بندی‌شده هسته، بوبین، سیم‌پیچی و هندسه</small></div></div>
        <div className="calc-component-summary">
          <article><h4>مشخصات هسته</h4><dl><div><dt>مدل</dt><dd>{selectedCore?.model_code || '—'}</dd></div><div><dt>خانواده</dt><dd>{selectedCore?.family || '—'}</dd></div><div><dt>جنس</dt><dd>{selectedCore?.material || '—'}</dd></div><div><dt>Ae</dt><dd>{selectedCore?.effective_area_mm2 ? `${formatNumber(selectedCore.effective_area_mm2)} mm²` : '—'}</dd></div><div><dt>پایه مرکزی</dt><dd>{selectedCore?.center_leg_mm ? `${formatNumber(selectedCore.center_leg_mm)} mm` : '—'}</dd></div></dl></article>
          <article><h4>مشخصات بوبین</h4><dl><div><dt>پایه‌ها</dt><dd>{selectedBobbin?.pins_left}+{selectedBobbin?.pins_right}</dd></div><div><dt>جهت نصب</dt><dd>{selectedBobbin?.mount_orientation || '—'}</dd></div><div><dt>BW</dt><dd>{formatNumber(selectedBobbin?.window_width_mm)} mm</dd></div><div><dt>HW</dt><dd>{formatNumber(selectedBobbin?.window_height_mm)} mm</dd></div><div><dt>MLT</dt><dd>{formatNumber(selectedBobbin?.mean_turn_length_mm)} mm</dd></div></dl></article>
        </div>
        <div className="calc-metrics">
          <div><small>کنترل سطح مقطع</small><b>{formatNumber(result.engineering.area_percent)}٪</b></div>
          <div><small>کنترل شعاعی</small><b>{formatNumber(result.engineering.radial_percent)}٪</b></div>
          <div><small>طول سیم هر عدد</small><b>{formatNumber(result.engineering.total_length_m)} متر</b></div>
          <div><small>وزن مس هر عدد</small><b>{formatNumber(result.engineering.copper_weight_per_unit_g)} گرم</b></div>
          <div><small>ارتفاع مصرف‌شده</small><b>{formatNumber(result.engineering.total_build_mm)} mm</b></div>
          <div><small>عایق ثابت</small><b>{formatNumber(result.engineering.insulation_mm)} mm</b></div>
        </div>
        {(result.warnings || []).map((item) => <div className="calc-inline-warning" key={item.code}><AlertTriangle/>{item.message}</div>)}
        <div className="calc-table-scroll calc-technical-result"><table><thead><tr><th>ردیف</th><th>نام</th><th>پین</th><th>دور</th><th>سیم</th><th>رشته</th><th>لایه</th><th>جهت</th><th>طول</th><th>سهم پنجره</th></tr></thead><tbody>{result.engineering.rows.map((row) => <tr key={row.line_no}><td>{formatNumber(row.line_no)}</td><td><b>N{formatNumber(row.line_no)} · {row.name}</b></td><td>{formatNumber(row.start_pin)} ← {formatNumber(row.end_pin)}</td><td>{formatNumber(row.turns)}</td><td>{formatWireLabel(row.wire_diameter_mm, row.awg)}</td><td>{formatNumber(row.strands)}</td><td>{formatNumber(row.calculated_layers)}</td><td>{row.direction === 'ccw' ? 'پادساعتگرد' : 'ساعتگرد'}</td><td>{formatNumber(row.length_m)} متر</td><td>{formatNumber(row.window_share_percent)}٪</td></tr>)}</tbody></table></div>
        <div className="calc-diagram-grid">
          <article className="calc-diagram-card"><header><span>تصویر ۱</span><h3>نقشه پرشدگی سیم‌پیچ‌ها</h3></header><div className="calc-svg-host" dangerouslySetInnerHTML={{ __html: fillSvg }}/><div className="calc-winding-legend">{result.engineering.rows.map((row) => <div key={row.line_no}><i style={{ background: row.color }}/><span><b>N{formatNumber(row.line_no)} · {row.name}</b><small><em>پین {formatNumber(row.start_pin)} تا {formatNumber(row.end_pin)}</em><em>{formatNumber(row.turns)} دور</em><em>{formatWireLabel(row.wire_diameter_mm, row.awg)}</em><em>سهم {formatNumber(row.window_share_percent)}٪</em></small></span></div>)}</div></article>
          <article className="calc-diagram-card pin"><header><span>تصویر ۲</span><h3>نمای بالای پایه و سیم‌پیچی</h3></header><div className="calc-svg-host pin" dangerouslySetInnerHTML={{ __html: pinSvg }}/></article>
        </div>
      </section>

      {result.pricing_breakdown_visible && result.pricing && <InternalPricingBreakdown pricing={result.pricing}/>} 
      {result.valid && <div className="calc-report-actions"><button type="button" onClick={() => printReport('customer')}><FileText/>خروجی PDF مشتری</button><button type="button" onClick={() => printReport('internal')}><Printer/>PDF داخلی کارکنان{result.pricing ? ' + ریز محرمانه' : ''}</button></div>}
    </section>}

  </div>;
}

function BoardDesigner() {
  const [form, setForm] = useState({ project_title: '', width_mm: 100, height_mm: 80, power_w: 150, complexity: 'medium', layers: 2, features: ['isolation', 'protection'] });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const features = [['isolation', 'ایزولاسیون ایمن'], ['pfc', 'PFC فعال'], ['digital', 'کنترل دیجیتال'], ['communication', 'ارتباط و مانیتورینگ'], ['protection', 'حفاظت کامل'], ['emi', 'EMI/EMC'], ['thermal', 'تحلیل حرارتی']];
  async function submit() {
    setBusy(true); setError('');
    try { setResult(await calculateBoard(form)); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }
  return <section className="calc-card calc-board">
    <div className="calc-card-title"><div><CircuitBoard/><h2>برآورد طراحی برد</h2></div><span className="calc-sync-badge"><ShieldCheck/>محاسبه سمت سرور</span></div>
    <div className="calc-form-grid board">
      <Field label="عنوان پروژه" className="span-2"><input value={form.project_title} onChange={(event) => setForm({ ...form, project_title: event.target.value })}/></Field>
      <Field label="عرض برد (mm)"><input type="number" min="1" value={form.width_mm} onChange={(event) => setForm({ ...form, width_mm: Number(event.target.value) })}/></Field>
      <Field label="ارتفاع برد (mm)"><input type="number" min="1" value={form.height_mm} onChange={(event) => setForm({ ...form, height_mm: Number(event.target.value) })}/></Field>
      <Field label="توان (W)"><input type="number" min="1" value={form.power_w} onChange={(event) => setForm({ ...form, power_w: Number(event.target.value) })}/></Field>
      <Field label="پیچیدگی"><select value={form.complexity} onChange={(event) => setForm({ ...form, complexity: event.target.value })}><option value="basic">پایه</option><option value="medium">متوسط</option><option value="advanced">پیشرفته</option></select></Field>
      <Field label="لایه PCB"><select value={form.layers} onChange={(event) => setForm({ ...form, layers: Number(event.target.value) })}>{[2, 4, 6, 8].map((item) => <option key={item}>{item}</option>)}</select></Field>
    </div>
    <div className="calc-feature-grid">{features.map(([key, label]) => <label key={key}><input type="checkbox" checked={form.features.includes(key)} onChange={(event) => setForm({ ...form, features: event.target.checked ? [...form.features, key] : form.features.filter((item) => item !== key) })}/><span>{label}</span></label>)}</div>
    <ErrorNotice message={error}/><button type="button" className="calc-primary" onClick={submit} disabled={busy}>{busy ? <RefreshCw className="spin"/> : <Calculator/>}محاسبه و ثبت برآورد</button>
    {result?.result && <div className="calc-board-result"><div><small>کد برآورد</small><b>{result.quote?.public_code}</b></div><div><small>مساحت برد</small><b>{formatNumber(result.result.area_cm2)} cm²</b></div><div className="total"><small>جمع برآورد</small><strong>{formatToman(result.result.total_rial)}</strong></div>{result.result.lines.map((line) => <p key={line.key}><span>{line.label}</span><b>{formatToman(line.amount_rial)}</b></p>)}</div>}
  </section>;
}

function SavedQuoteReportModal({ quote, onClose }) {
  const engineering = quote.engineering_snapshot || {};
  const input = quote.input_snapshot || {};
  const publicResult = quote.public_result_snapshot || {};
  if (quote.calculator_type === 'board') {
    const openBoardReport = () => {
      const lines = (engineering.lines || []).map((line) => `<tr><td>${htmlEscape(line.label)}</td><td>${formatToman(line.amount_rial)}</td></tr>`).join('');
      const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>${htmlEscape(quote.public_code)}</title><style>${buildAryamanFontFaceCss()}@page{size:A4;margin:15mm}body{font-family:${ARYAMAN_FONT_FAMILY_CSS};font-synthesis:none;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased;color:#142b45}.head{border-bottom:3px solid #d6a31b;padding-bottom:12px}.head h1{margin:0}.code{color:#a8672e;font-weight:900}table{width:100%;border-collapse:collapse;margin-top:20px}td{border:1px solid #dfe4e7;padding:9px}.total{margin-top:20px;background:#10243d;color:#fff;padding:15px;border-radius:10px}.total b{color:#f8d348;font-size:20px}</style></head><body><header class="head"><h1>گزارش برآورد طراحی برد</h1><p>${htmlEscape(quote.project_title || '—')} · <span class="code">${htmlEscape(quote.public_code)}</span></p></header><table><tbody>${lines}</tbody></table><div class="total">جمع برآورد: <b>${formatToman(publicResult.total_sale_rial)}</b></div><script>window.onload=()=>window.print()</script></body></html>`;
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' }); const url = URL.createObjectURL(blob); const win = window.open(url, '_blank'); if (!win) { const link = document.createElement('a'); link.href = url; link.download = `board-${quote.public_code}.html`; link.click(); } window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    };
    return <Modal title={`گزارش ${quote.public_code}`} onClose={onClose}><div className="calc-saved-report"><div className="calc-board-result"><div><small>پروژه</small><b>{quote.project_title || '—'}</b></div><div><small>مساحت</small><b>{formatNumber(engineering.area_cm2)} cm²</b></div><div className="total"><small>جمع برآورد</small><strong>{formatToman(publicResult.total_sale_rial)}</strong></div>{(engineering.lines || []).map((line) => <p key={line.key}><span>{line.label}</span><b>{formatToman(line.amount_rial)}</b></p>)}</div><div className="calc-report-actions"><button onClick={openBoardReport}><Printer/>چاپ گزارش برآورد</button></div></div></Modal>;
  }
  const fallbackPins = String(input.bobbin_label || '').match(/(\d+)\+(\d+)/);
  const bobbin = input.bobbin || (fallbackPins ? { pins_left: Number(fallbackPins[1]), pins_right: Number(fallbackPins[2]), mount_orientation: input.bobbin_label } : null);
  const fillSvg = buildWindowFillSvg(bobbin || {}, engineering);
  const pinSvg = bobbin ? buildPinDiagramSvg(bobbin, engineering) : '';
  const rows = engineering.rows || [];
  function openReport(kind) {
    openTransformerPdfReport({
      kind,
      code: quote.public_code,
      quote,
      confirmed: true,
      createdAt: quote.created_at,
      customerName: quote.customer_name,
      customerPhone: quote.customer_phone,
      projectTitle: quote.project_title,
      orderType: quote.order_type,
      quantity: quote.quantity,
      hasGap: Boolean(input.has_gap),
      core: input.core || { model_code: input.core_model },
      bobbin: input.bobbin || bobbin || {},
      engineering,
      publicResult,
      inventory: quote.inventory_snapshot || [],
      pricing: quote.pricing_snapshot && Object.keys(quote.pricing_snapshot).length ? quote.pricing_snapshot : null,
      formulaVersion: input.formula_version_code || '',
      fillSvg,
      pinSvg,
    });
  }

  return <Modal title={`گزارش‌های ${quote.public_code}`} onClose={onClose} wide>
    <div className="calc-saved-report"><div className="calc-result-head"><div><span className={`calc-status ${quote.status}`}>{STATUS_LABELS[quote.status] || quote.status}</span><h2>{input.core_model || '—'} · {input.bobbin_label || '—'}</h2><small>{quote.customer_name || '—'} · {quote.project_title || '—'}</small></div><div className="calc-price"><small>جمع Snapshot</small><strong>{formatToman(publicResult.total_sale_rial)}</strong></div></div><div className="calc-diagram-grid"><article className="calc-diagram-card"><header><span>تصویر ۱</span><h3>پرشدگی سیم‌پیچ‌ها</h3></header><div className="calc-svg-host" dangerouslySetInnerHTML={{ __html: fillSvg }}/><div className="calc-winding-legend">{rows.map((row) => <div key={row.line_no}><i style={{ background: row.color }}/><span><b>N{formatNumber(row.line_no)} · {row.name}</b><small>پین {formatNumber(row.start_pin)} تا {formatNumber(row.end_pin)} · {formatNumber(row.turns)} دور</small></span></div>)}</div></article><article className="calc-diagram-card"><header><span>تصویر ۲</span><h3>نمای بالای پایه و سیم‌پیچی</h3></header>{pinSvg ? <div className="calc-svg-host pin" dangerouslySetInnerHTML={{ __html: pinSvg }}/> : <div className="calc-empty">نقشه پایه برای سند قدیمی موجود نیست.</div>}</article></div><div className="calc-report-actions"><button onClick={() => openReport('customer')}><FileText/>خروجی PDF مشتری</button><button onClick={() => openReport('internal')}><Printer/>PDF داخلی کارکنان{quote.pricing_snapshot && Object.keys(quote.pricing_snapshot).length ? ' + ریز محرمانه' : ''}</button></div></div>
  </Modal>;
}

function OrdersView({ refreshToken, hasRole }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [reportQuote, setReportQuote] = useState(null);
  const canReserve = hasRole(['admin', 'sales', 'sales_manager', 'warehouse']);
  const canConsume = hasRole(['admin', 'production', 'warehouse']);
  const canPromote = hasRole(['admin', 'sales', 'sales_manager']);
  async function load() { setLoading(true); try { setRows(await listCalculatorQuotes(200) || []); setError(''); } catch (requestError) { setError(requestError.message); } finally { setLoading(false); } }
  useEffect(() => { load(); }, [refreshToken]); // eslint-disable-line react-hooks/exhaustive-deps
  async function act(id, operation) {
    setBusyId(id); setError('');
    try {
      if (operation === 'reserve') await reserveCalculatorQuote(id);
      if (operation === 'release') await releaseCalculatorQuote(id, 'لغو از مرکز محاسبه');
      if (operation === 'consume') await consumeCalculatorQuote(id);
      if (operation === 'promote') await promoteCalculatorQuote(id);
      await load();
    } catch (requestError) { setError(requestError.message); } finally { setBusyId(''); }
  }
  async function showReports(id) {
    setBusyId(id); setError('');
    try { setReportQuote(await getCalculatorQuote(id, true)); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusyId(''); }
  }
  const visible = filter === 'all' ? rows : rows.filter((row) => row.status === filter || (filter === 'active' && ['reserved', 'in_production'].includes(row.status)));
  if (loading) return <LoadingBlock text="در حال دریافت سفارش‌های مرکز محاسبه..."/>;
  return <><section className="calc-card calc-orders">
    <div className="calc-card-title"><div><ClipboardList/><h2>سفارش‌های سایت و تولید</h2></div><div className="calc-toolbar"><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">همه وضعیت‌ها</option><option value="calculated">محاسبه‌شده</option><option value="reserved">رزروشده</option><option value="active">فعال در تولید</option><option value="produced">تکمیل‌شده</option><option value="cancelled">لغوشده</option></select><button type="button" className="calc-secondary" onClick={load}><RefreshCw/>به‌روزرسانی</button></div></div>
    <ErrorNotice message={error}/>
    <div className="calc-table-scroll"><table className="calc-orders-table"><thead><tr><th>کد</th><th>مشتری / پروژه</th><th>منبع</th><th>نوع / تعداد</th><th>قیمت Snapshot</th><th>وضعیت</th><th>اتصال</th><th>عملیات</th></tr></thead><tbody>{visible.map((row) => <tr key={row.id}><td><b>{row.public_code}</b><small>{formatJalaliDateTime(row.created_at)}</small></td><td><b>{row.customer_name || '—'}</b><small>{row.project_title || '—'}</small></td><td>{row.source === 'wordpress' ? 'WordPress' : 'داخلی'}{row.site_order_id && <small>{row.site_order_id}</small>}</td><td>{row.order_type === 'sample' ? 'نمونه' : row.order_type === 'production' ? 'تولید' : 'طراحی'}<small>{formatNumber(row.quantity)} عدد</small></td><td>{formatToman(row.public_result_snapshot?.total_sale_rial)}</td><td><span className={`calc-status ${row.status}`}>{STATUS_LABELS[row.status] || row.status}</span></td><td><small>{row.order_id ? 'سفارش مرکزی متصل' : 'بدون سفارش مرکزی'}</small><small>{row.production_order_id ? 'تولید متصل' : ''}</small></td><td><div className="calc-row-actions"><button disabled={busyId === row.id} onClick={() => showReports(row.id)}>گزارش‌ها</button>{canPromote && !row.order_id && !['cancelled', 'produced'].includes(row.status) && <button disabled={busyId === row.id} onClick={() => act(row.id, 'promote')}>انتقال به سفارش</button>}{canReserve && ['calculated', 'approved', 'paid', 'submitted'].includes(row.status) && <button className="primary" disabled={busyId === row.id} onClick={() => act(row.id, 'reserve')}>رزرو مواد</button>}{canConsume && ['reserved', 'in_production'].includes(row.status) && <button className="success" disabled={busyId === row.id} onClick={() => act(row.id, 'consume')}>پایان تولید و کسر قطعی</button>}{canReserve && !['cancelled', 'produced'].includes(row.status) && <button className="danger" disabled={busyId === row.id} onClick={() => act(row.id, 'release')}>لغو / آزادسازی</button>}</div></td></tr>)}{!visible.length && <tr><td colSpan="8" className="calc-empty">سندی با این وضعیت وجود ندارد.</td></tr>}</tbody></table></div>
  </section>{reportQuote && <SavedQuoteReportModal quote={reportQuote} onClose={() => setReportQuote(null)}/>}</>;
}

function ComponentModal({ kind, existing, prefill, catalog, canCreateWarehouse, onClose, onSaved }) {
  const initial = existing || prefill || {};
  const [data, setData] = useState({
    id: initial.id || '', warehouse_item_id: initial.warehouse_item_id || '',
    model_code: initial.model_code || '', family: initial.family || '', material: initial.material || 'PC40', effective_area_mm2: initial.effective_area_mm2 || '', center_leg_mm: initial.center_leg_mm || '', weight_g: initial.weight_g || '', assembly_time_seconds: initial.assembly_time_seconds || 0, assembly_method: initial.assembly_method || 'دستی',
    core_id: initial.core_id || catalog.cores?.[0]?.id || '', mount_orientation: initial.mount_orientation || 'عمودی', pins_left: initial.pins_left || 5, pins_right: initial.pins_right || 5, window_width_mm: initial.window_width_mm || '', window_height_mm: initial.window_height_mm || '', mean_turn_length_mm: initial.mean_turn_length_mm || '', flange_length_mm: initial.flange_length_mm || '', flange_width_mm: initial.flange_width_mm || '',
    diameter_mm: initial.diameter_mm || '', awg: initial.awg || '', wire_type: initial.wire_type || 'مسی لاکی',
  });
  const [warehouseMode, setWarehouseMode] = useState(initial.warehouse_item_id ? 'existing' : 'none');
  const [warehouse, setWarehouse] = useState({ item_code: '', item_name_fa: '', item_name_en: '', unit: kind === 'wire' ? 'گرم' : 'عدد', category: KIND_LABELS[kind], initial_quantity: 0, min_stock_threshold: 0, price_currency: 'CNY', base_cost_price: '', base_sale_price: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const compatibleWarehouseItems = (catalog.warehouse_items || []).filter((item) => isCompatibleWarehouseUnit(kind, item.unit));
  const selectedWarehouseIsIncompatible = Boolean(data.warehouse_item_id && !(catalog.warehouse_items || []).some((item) => item.id === data.warehouse_item_id && isCompatibleWarehouseUnit(kind, item.unit)));
  function patch(key, value) { setData((current) => ({ ...current, [key]: value })); }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await saveCalculatorComponent(kind, { ...data, warehouse_item_id: warehouseMode === 'existing' ? data.warehouse_item_id : '' }, warehouseMode === 'new' ? warehouse : null);
      await onSaved();
    } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }
  return <Modal title={`${existing ? 'ویرایش و اتصال' : 'افزودن'} ${KIND_LABELS[kind]}`} onClose={onClose} wide>
    <form className="calc-component-form" onSubmit={submit}>
      <div className="calc-form-section"><h4>مشخصات دقیق قطعه</h4><div className="calc-form-grid">
        {kind === 'core' && <><Field label="مدل هسته"><input required value={data.model_code} onChange={(event) => patch('model_code', event.target.value)}/></Field><Field label="خانواده"><input required value={data.family} onChange={(event) => patch('family', event.target.value)}/></Field><Field label="جنس / گرید"><input value={data.material} onChange={(event) => patch('material', event.target.value)}/></Field><Field label="سطح مؤثر Ae (mm²)"><input required type="number" step="0.001" min="0.001" value={data.effective_area_mm2} onChange={(event) => patch('effective_area_mm2', event.target.value)}/></Field><Field label="عرض پایه مرکزی (mm)"><input required type="number" step="0.001" min="0.001" value={data.center_leg_mm} onChange={(event) => patch('center_leg_mm', event.target.value)}/></Field><Field label="وزن (g)"><input type="number" step="0.001" min="0" value={data.weight_g} onChange={(event) => patch('weight_g', event.target.value)}/></Field><Field label="زمان مونتاژ (ثانیه)"><input type="number" min="0" value={data.assembly_time_seconds} onChange={(event) => patch('assembly_time_seconds', event.target.value)}/></Field><Field label="روش مونتاژ"><select value={data.assembly_method} onChange={(event) => patch('assembly_method', event.target.value)}><option>دستی</option><option>ماشینی</option></select></Field></>}
        {kind === 'bobbin' && <><Field label="هسته متناظر"><select required value={data.core_id} onChange={(event) => patch('core_id', event.target.value)}>{catalog.cores.map((core) => <option key={core.id} value={core.id}>{core.model_code}</option>)}</select></Field><Field label="جهت نصب"><select value={data.mount_orientation} onChange={(event) => patch('mount_orientation', event.target.value)}><option>افقی</option><option>عمودی</option></select></Field><Field label="پایه سمت چپ"><input required type="number" min="1" max="30" value={data.pins_left} onChange={(event) => patch('pins_left', event.target.value)}/></Field><Field label="پایه سمت راست"><input required type="number" min="1" max="30" value={data.pins_right} onChange={(event) => patch('pins_right', event.target.value)}/></Field><Field label="BW عرض پنجره (mm)"><input required type="number" min="0.001" step="0.001" value={data.window_width_mm} onChange={(event) => patch('window_width_mm', event.target.value)}/></Field><Field label="HW ارتفاع پنجره (mm)"><input required type="number" min="0.001" step="0.001" value={data.window_height_mm} onChange={(event) => patch('window_height_mm', event.target.value)}/></Field><Field label="MLT واقعی (mm)"><input required type="number" min="0.001" step="0.001" value={data.mean_turn_length_mm} onChange={(event) => patch('mean_turn_length_mm', event.target.value)}/></Field><Field label="طول فلنج (mm)"><input type="number" min="0" step="0.001" value={data.flange_length_mm} onChange={(event) => patch('flange_length_mm', event.target.value)}/></Field><Field label="عرض فلنج (mm)"><input type="number" min="0" step="0.001" value={data.flange_width_mm} onChange={(event) => patch('flange_width_mm', event.target.value)}/></Field><Field label="وزن (g)"><input type="number" min="0" step="0.001" value={data.weight_g} onChange={(event) => patch('weight_g', event.target.value)}/></Field></>}
        {kind === 'wire' && <><Field label="قطر با احتساب لاک (mm)"><input required type="number" min="0.001" step="0.001" value={data.diameter_mm} onChange={(event) => patch('diameter_mm', event.target.value)}/></Field><Field label="AWG"><input type="number" min="1" value={data.awg} onChange={(event) => patch('awg', event.target.value)}/></Field><Field label="نوع سیم"><input required value={data.wire_type} onChange={(event) => patch('wire_type', event.target.value)}/></Field></>}
      </div></div>
      <div className="calc-form-section warehouse"><h4><Warehouse/> اتصال و همگام‌سازی انبار</h4><div className="calc-mode-switch"><button type="button" className={warehouseMode === 'existing' ? 'active' : ''} onClick={() => setWarehouseMode('existing')}>اتصال به قلم موجود</button>{canCreateWarehouse && <button type="button" className={warehouseMode === 'new' ? 'active' : ''} onClick={() => setWarehouseMode('new')}>ایجاد قلم جدید انبار</button>}<button type="button" className={warehouseMode === 'none' ? 'active' : ''} onClick={() => setWarehouseMode('none')}>ثبت مدل بدون اتصال</button></div>
        {warehouseMode === 'existing' && <><Field label={`قلم انبار نسخه ۱۳۰ · واحد ${kind === 'wire' ? 'گرم' : 'عدد'}`}><select required value={selectedWarehouseIsIncompatible ? '' : data.warehouse_item_id} onChange={(event) => patch('warehouse_item_id', event.target.value)}><option value="">انتخاب قلم سازگار</option>{compatibleWarehouseItems.map((item) => <option key={item.id} value={item.id}>{item.item_code} · {item.item_name_fa} · موجودی {formatNumber(item.available_qty)} {item.unit}</option>)}</select></Field>{selectedWarehouseIsIncompatible && <div className="calc-inline-warning"><AlertTriangle/>واحد اتصال فعلی سازگار نیست؛ {kind === 'wire' ? 'برای سیم فقط قلم با واحد گرم' : 'برای این قطعه فقط قلم با واحد عدد'} انتخاب کنید.</div>}</>}
        {warehouseMode === 'new' && <div className="calc-form-grid"><Field label="کد یکتای انبار"><input required value={warehouse.item_code} onChange={(event) => setWarehouse({ ...warehouse, item_code: event.target.value })}/></Field><Field label="نام فارسی"><input required value={warehouse.item_name_fa} onChange={(event) => setWarehouse({ ...warehouse, item_name_fa: event.target.value })}/></Field><Field label="واحد ثابت انبار"><input value={kind === 'wire' ? 'گرم' : 'عدد'} readOnly aria-readonly="true"/></Field><Field label="گروه"><input value={warehouse.category} onChange={(event) => setWarehouse({ ...warehouse, category: event.target.value })}/></Field><Field label="موجودی اولیه"><input type="number" min="0" step="0.001" value={warehouse.initial_quantity} onChange={(event) => setWarehouse({ ...warehouse, initial_quantity: event.target.value })}/></Field><Field label="حد سفارش"><input type="number" min="0" step="0.001" value={warehouse.min_stock_threshold} onChange={(event) => setWarehouse({ ...warehouse, min_stock_threshold: event.target.value })}/></Field><Field label="ارز قیمت"><select value={warehouse.price_currency} onChange={(event) => setWarehouse({ ...warehouse, price_currency: event.target.value })}><option value="CNY">یوان چین</option><option value="USD">دلار آمریکا</option><option value="IRR">بدون قیمت؛ ثبت بعدی در انبار</option></select></Field>{warehouse.price_currency !== 'IRR' && <><Field label="بهای پایه خرید"><input required type="number" min="0" step="0.000001" value={warehouse.base_cost_price} onChange={(event) => setWarehouse({ ...warehouse, base_cost_price: event.target.value })}/></Field><Field label="بهای پایه فروش"><input required type="number" min="0" step="0.000001" value={warehouse.base_sale_price} onChange={(event) => setWarehouse({ ...warehouse, base_sale_price: event.target.value })}/></Field></>}</div>}
        {warehouseMode === 'none' && <div className="calc-inline-warning"><AlertTriangle/>مدل در فهرست دیده می‌شود، اما تا اتصال به قلم واقعی انبار برای محاسبه غیرفعال خواهد بود.</div>}
      </div>
      <ErrorNotice message={error}/><footer><button type="button" className="calc-secondary" onClick={onClose}>انصراف</button><button type="submit" className="calc-primary" disabled={busy}>{busy ? <RefreshCw className="spin"/> : <Save/>}ثبت و همگام‌سازی</button></footer>
    </form>
  </Modal>;
}

function FormulaModal({ onClose, onSaved }) {
  const [settings, setSettings] = useState(null);
  const [versionCode, setVersionCode] = useState('');
  const [notes, setNotes] = useState('');
  const [config, setConfig] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    getCalculatorAdminSettings().then((data) => {
      setSettings(data);
      setConfig(data.transformer_formula?.config || {});
      const current = data.transformer_formula?.version_code || 'TR-0.1.0';
      setVersionCode(`${current}-R${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`);
      setNotes(data.transformer_formula?.calibration_notes || '');
    }).catch((requestError) => setError(requestError.message));
  }, []);
  function patch(key, value) { setConfig((current) => ({ ...current, [key]: Number(value) })); }
  function patchBoolean(key, value) { setConfig((current) => ({ ...current, [key]: Boolean(value) })); }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await publishTransformerFormula(versionCode, config, notes); await onSaved(); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  }
  return <Modal title="نسخه فرمول و هزینه‌های محرمانه" onClose={onClose} wide>
    {!settings && !error && <LoadingBlock/>}{settings && <form className="calc-component-form" onSubmit={submit}>
      <div className="calc-secret-banner"><ShieldCheck/><span><b>فقط مدیر</b><small>با ثبت، نسخه جدید ساخته می‌شود؛ Snapshot اسناد قبلی تغییر نمی‌کند.</small></span></div>
      <div className="calc-form-section"><h4>هندسه و تولید</h4><div className="calc-form-grid"><Field label="کد نسخه جدید"><input required value={versionCode} onChange={(event) => setVersionCode(event.target.value)}/></Field><Field label="ضریب پرشدگی"><input required type="number" min="0.05" max="1" step="0.01" value={config.packing_factor ?? ''} onChange={(event) => patch('packing_factor', event.target.value)}/></Field><Field label="عایق ثابت بین لایه‌ها (mm)"><input required type="number" min="0" step="0.001" value={config.inter_winding_insulation_mm ?? ''} onChange={(event) => patch('inter_winding_insulation_mm', event.target.value)}/></Field><Field label="سرعت سیم‌پیچی (دور/دقیقه)"><input required type="number" min="1" value={config.winding_speed_turns_per_minute ?? ''} onChange={(event) => patch('winding_speed_turns_per_minute', event.target.value)}/></Field><Field label="ستاپ هر سیم‌پیچ (دقیقه)"><input type="number" min="0" step="0.1" value={config.setup_minutes_per_winding ?? ''} onChange={(event) => patch('setup_minutes_per_winding', event.target.value)}/></Field><Field label="چگالی مس (g/cm³)"><input required type="number" min="0.01" step="0.01" value={config.copper_density_g_cm3 ?? ''} onChange={(event) => patch('copper_density_g_cm3', event.target.value)}/></Field></div></div>
      <div className="calc-form-section"><h4>هزینه و قیمت محرمانه</h4><div className="calc-form-grid"><Field label="سود افزایشی (%)"><input required type="number" min="0" step="0.1" value={config.profit_percent ?? ''} onChange={(event) => patch('profit_percent', event.target.value)}/></Field><Field label="ضریب قیمت نمونه"><input required type="number" min="1" step="0.1" value={config.sample_multiplier ?? ''} onChange={(event) => patch('sample_multiplier', event.target.value)}/></Field><Field label="ستاپ نمونه (ریال)"><input type="number" min="0" step="10000" value={config.sample_setup_rial ?? ''} onChange={(event) => patch('sample_setup_rial', event.target.value)}/></Field><Field label="دستمزد ساعتی (ریال)"><input type="number" min="0" step="10000" value={config.labor_hour_rial ?? ''} onChange={(event) => patch('labor_hour_rial', event.target.value)}/></Field><Field label="سربار (%)"><input type="number" min="0" step="0.1" value={config.overhead_percent ?? ''} onChange={(event) => patch('overhead_percent', event.target.value)}/></Field><Field label="گرد کردن قیمت (ریال)"><input type="number" min="1" step="1000" value={config.price_rounding_rial ?? ''} onChange={(event) => patch('price_rounding_rial', event.target.value)}/></Field><Field label="حوض قلع (ریال)"><input type="number" min="0" step="1000" value={config.solder_cost_rial ?? ''} onChange={(event) => patch('solder_cost_rial', event.target.value)}/></Field><Field label="شارلاک (ریال)"><input type="number" min="0" step="1000" value={config.varnish_cost_rial ?? ''} onChange={(event) => patch('varnish_cost_rial', event.target.value)}/></Field><Field label="تست (ریال)"><input type="number" min="0" step="1000" value={config.test_cost_rial ?? ''} onChange={(event) => patch('test_cost_rial', event.target.value)}/></Field><Field label="بسته‌بندی (ریال)"><input type="number" min="0" step="1000" value={config.packaging_cost_rial ?? ''} onChange={(event) => patch('packaging_cost_rial', event.target.value)}/></Field><Field label="عملیات گپ (ریال)"><input type="number" min="0" step="1000" value={config.gap_cost_rial ?? ''} onChange={(event) => patch('gap_cost_rial', event.target.value)}/></Field><Field label="یادداشت کالیبراسیون"><input value={notes} onChange={(event) => setNotes(event.target.value)}/></Field></div></div>
      <div className="calc-form-section visibility"><h4>نمایش ریز قیمت‌گذاری در محاسبه‌گر</h4><label className="calc-setting-toggle"><input type="checkbox" checked={Boolean(config.show_internal_pricing_breakdown)} onChange={(event) => patchBoolean('show_internal_pricing_breakdown', event.target.checked)}/><span><b>نمایش تمام هزینه‌ها و محاسبات برای کارکنان مجاز</b><small>در صورت فعال‌بودن، بهای هسته، بوبین، سیم، دستمزد، عملیات، سربار و سود پایین همه محاسبات ترانس نمایش داده می‌شود. این اطلاعات هرگز در خروجی مشتری یا WordPress قرار نمی‌گیرد.</small></span></label></div>
      <ErrorNotice message={error}/><footer><button type="button" className="calc-secondary" onClick={onClose}>انصراف</button><button type="submit" className="calc-primary" disabled={busy}>{busy ? <RefreshCw className="spin"/> : <Save/>}انتشار نسخه داخلی جدید</button></footer>
    </form>}
  </Modal>;
}

function CatalogView({ catalog, reload, hasRole }) {
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');
  const [publicConfirm, setPublicConfirm] = useState(false);
  const [flagBusy, setFlagBusy] = useState(false);
  const canManage = hasRole(['admin', 'warehouse', 'production']);
  const canCreateWarehouse = hasRole(['admin', 'warehouse']);
  const isAdmin = hasRole('admin');
  const missingCores = catalog.cores.filter((core) => !(core.calculable) || !catalog.bobbins.some((bobbin) => bobbin.core_id === core.id && (bobbin.calculable)));
  async function saved() { setModal(null); await reload(); }
  async function updateFlag(enabled) { setFlagBusy(true); setError(''); try { await setCalculatorPublicFlag(enabled, enabled ? publicConfirm : false); await reload(); setPublicConfirm(false); } catch (requestError) { setError(requestError.message); } finally { setFlagBusy(false); } }
  return <div className="calc-catalog-layout">
    <section className="calc-health-grid"><div><b>{formatNumber(catalog.cores.length)}</b><span>هسته ثبت‌شده</span></div><div><b>{formatNumber(catalog.bobbins.length)}</b><span>بوبین دقیق</span></div><div><b>{formatNumber(catalog.wires.length)}</b><span>قطر سیم</span></div><div className={missingCores.length ? 'warning' : 'ok'}><b>{formatNumber(missingCores.length)}</b><span>هسته نیازمند تکمیل/اتصال</span></div></section>
    <ErrorNotice message={error}/>
    <section className="calc-card">
      <div className="calc-card-title"><div><Boxes/><h2>هسته‌ها و بوبین‌های متناظر</h2></div>{canManage && <div className="calc-toolbar"><button className="calc-secondary" onClick={() => setModal({ kind: 'core' })}><PackagePlus/>هسته جدید</button><button className="calc-secondary" onClick={() => setModal({ kind: 'bobbin' })}><PackagePlus/>بوبین جدید</button><button className="calc-secondary" onClick={() => setModal({ kind: 'wire' })}><PackagePlus/>سیم جدید</button></div>}</div>
      <div className="calc-component-grid">{catalog.cores.map((core) => {
        const coreBobbins = catalog.bobbins.filter((bobbin) => bobbin.core_id === core.id);
        const coreReady = core.calculable;
        const ready = coreReady && coreBobbins.some((bobbin) => bobbin.calculable);
        return <article className={`calc-component-card ${ready ? 'ready' : 'incomplete'}`} key={core.id}><header><div><h3>{core.model_code}</h3><span>{core.family} · {core.material || '—'}</span></div><span className="state">{ready ? 'آماده محاسبه' : 'غیرفعال تا تکمیل'}</span></header><div className={`calc-stock-line ${coreReady ? 'connected' : ''}`}><Warehouse/><span>{core.warehouse_code ? `${core.warehouse_code} · موجودی قابل رزرو ${formatNumber(core.available_qty)} عدد` : 'هسته به انبار متصل نیست'}</span>{canManage && <button type="button" className="calc-connect-action" onClick={() => setModal({ kind: 'core', existing: core })}><Link2/>{core.mapped ? 'تغییر اتصال هسته' : 'اتصال هسته به انبار'}</button>}</div><div className="calc-bobbin-list">{coreBobbins.map((bobbin) => { const bobbinReady = bobbin.calculable; return <div key={bobbin.id}><span><b>{bobbin.pins_left}+{bobbin.pins_right} پین · {bobbin.mount_orientation}</b><small>BW {formatNumber(bobbin.window_width_mm)} · HW {formatNumber(bobbin.window_height_mm)} · MLT {formatNumber(bobbin.mean_turn_length_mm)} mm</small></span><em className={bobbinReady ? 'ok' : ''}>{bobbinReady ? `انبار ${formatNumber(bobbin.available_qty)} عدد` : 'بدون اتصال معتبر'}</em>{canManage && <button className="calc-icon" onClick={() => setModal({ kind: 'bobbin', existing: bobbin })}><Settings2/></button>}</div>; })}{!coreBobbins.length && <div className="missing"><AlertTriangle/>بوبین واقعی ثبت نشده است؛ هیچ بُعدی حدس زده نمی‌شود.</div>}</div>{canManage && <footer><button onClick={() => setModal({ kind: 'core', existing: core })}><Settings2/>ویرایش مشخصات هسته</button><button onClick={() => setModal({ kind: 'bobbin', prefill: { core_id: core.id } })}><Plus/>افزودن بوبین متناظر</button></footer>}</article>;
      })}</div>
    </section>
    <section className="calc-card">
      <div className="calc-card-title"><div><Zap/><h2>سیم‌های مسی لاکی</h2></div><span className="calc-sync-badge"><Link2/>قطر شامل لاک</span></div>
      <div className="calc-wire-grid">{catalog.wires.map((wire) => { const ready = wire.calculable; const issue = !wire.mapped ? 'بدون اتصال انبار' : !wire.unit_valid ? 'واحد اتصال باید گرم باشد' : !wire.priced ? 'قیمت روز انبار ثبت نشده است' : 'نیازمند تکمیل'; return <article key={wire.id} className={ready ? 'ready' : 'incomplete'}><b>{formatWireLabel(wire.diameter_mm, wire.awg)}</b><span className={`wire-state ${ready ? 'ok' : ''}`}>{ready ? 'آماده محاسبه' : 'غیرفعال تا تکمیل'}</span><small>{ready ? `${wire.warehouse_code} · ${formatNumber(wire.available_qty)} گرم` : issue}</small>{canManage && <button onClick={() => setModal({ kind: 'wire', existing: wire })}><Settings2/>ویرایش / اتصال</button>}</article>; })}</div>
    </section>
    {isAdmin && <section className="calc-card calc-public-flag"><div><ShieldCheck/><span><b>فرمول محرمانه و API عمومی</b><small>{catalog.public_quote_enabled ? 'قیمت عمومی فعال است' : 'قیمت عمومی تا تأیید کالیبراسیون خاموش است'}</small></span></div><div className="calc-admin-actions"><button className="formula" onClick={() => setModal({ kind: 'formula' })}><Settings2/>نسخه فرمول و هزینه‌ها</button>{catalog.public_quote_enabled ? <button disabled={flagBusy} onClick={() => updateFlag(false)}>خاموش‌کردن انتشار</button> : <div className="calc-flag-action"><label><input type="checkbox" checked={publicConfirm} onChange={(event) => setPublicConfirm(event.target.checked)}/>کالیبراسیون نهایی را تأیید می‌کنم</label><button disabled={!publicConfirm || flagBusy} onClick={() => updateFlag(true)}>فعال‌سازی عمومی</button></div>}</div></section>}
    {modal?.kind === 'formula' && <FormulaModal onClose={() => setModal(null)} onSaved={saved}/>} 
    {modal && modal.kind !== 'formula' && <ComponentModal key={`${modal.kind}-${modal.existing?.id || modal.prefill?.core_id || 'new'}`} kind={modal.kind} existing={modal.existing || null} prefill={modal.prefill || null} catalog={catalog} canCreateWarehouse={canCreateWarehouse} onClose={() => setModal(null)} onSaved={saved}/>} 
  </div>;
}

export default function CalculatorModule() {
  const { hasRole } = useAuth();
  const [designer, setDesigner] = useState('transformer');
  const [section, setSection] = useState('design');
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [quoteRefresh, setQuoteRefresh] = useState(0);
  async function loadCatalog() { setLoading(true); try { setCatalog(await getCalculatorCatalog()); setError(''); } catch (requestError) { setError(requestError.message); } finally { setLoading(false); } }
  useEffect(() => { loadCatalog(); }, []);
  return <main className="calculator-module" dir="rtl">
    <Hero designer={designer} setDesigner={setDesigner} section={section} setSection={setSection}/>
    <div className="calc-page-body"><ErrorNotice message={error} onClose={() => setError('')}/>{loading && <LoadingBlock/>}{!loading && catalog && <>
      {section === 'design' && designer === 'transformer' && <TransformerDesigner catalog={catalog} onQuoteSaved={() => setQuoteRefresh((value) => value + 1)}/>} 
      {section === 'design' && designer === 'board' && <BoardDesigner/>}
      {section === 'orders' && <OrdersView refreshToken={quoteRefresh} hasRole={hasRole}/>} 
      {section === 'catalog' && <CatalogView catalog={catalog} reload={loadCatalog} hasRole={hasRole}/>} 
    </>}</div>
  </main>;
}
