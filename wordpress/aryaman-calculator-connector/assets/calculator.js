(() => {
  'use strict';
  const config = window.AriamanCalculatorConfig || {};
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const numberFa = (value, digits = 0) => Number(value || 0).toLocaleString('fa-IR', { maximumFractionDigits: digits });
  const toman = (rial) => `${numberFa(Math.round(Number(rial || 0) / 10))} تومان`;

  async function request(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || body.error || 'ارتباط با مرکز محاسبه ناموفق بود.');
    return body;
  }

  function printCustomerReport(resultHost, code, payload) {
    const copy = resultHost.cloneNode(true);
    copy.querySelectorAll('button,.ary-confirm-zone p').forEach((node) => node.remove());
    const styles = [...document.styleSheets].filter((sheet) => sheet.href).map((sheet) => `<link rel="stylesheet" href="${esc(sheet.href)}">`).join('');
    const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>گزارش مشتری ${esc(code)}</title>${styles}<style>@page{size:A4;margin:10mm}body{background:#fff!important;margin:0;font-family:"Aryaman Vazirmatn","Vazirmatn Variable",Vazirmatn,"Segoe UI",Tahoma,Arial,sans-serif;font-synthesis:none;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}.aryaman-calculator{box-shadow:none;border:0;max-width:none;margin:0}.print-head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #173c62;padding:0 0 12px;margin-bottom:14px}.print-head h1{margin:0;color:#173c62;font-size:22px}.print-head p{margin:5px 0 0;color:#6e7c87}.print-code{direction:ltr;color:#a8672e;font-weight:900}.ary-result-category{break-inside:avoid}.ary-confirm-zone{display:none}@media print{.ary-result-groups{display:block}.ary-result-category{margin-bottom:12px}}</style></head><body><header class="print-head"><div><h1>گزارش فنی و تجاری ترانس آریامن</h1><p>${esc(payload.customer_name)} · ${esc(payload.project_title)} · ${esc(payload.quantity)} عدد</p></div><div class="print-code">${esc(code)}</div></header><main class="aryaman-calculator">${copy.innerHTML}</main><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),300));</script></body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) { const link = document.createElement('a'); link.href = url; link.download = `customer-${code}.html`; link.click(); }
    window.setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  function windingRow(index, wires, maxPin) {
    const pinOptions = (selected) => Array.from({ length: maxPin }, (_, pin) => `<option value="${pin + 1}" ${pin + 1 === selected ? 'selected' : ''}>${numberFa(pin + 1)}</option>`).join('');
    const wireOptions = wires.map((wire) => `<option value="${esc(wire.id)}">${numberFa(wire.diameter_mm, 2)} mm${wire.awg ? ` (AWG ${esc(wire.awg)})` : ''}</option>`).join('');
    const initialWire = wires[0];
    const startPin = Math.min(maxPin, index * 2 + 1);
    const endPin = Math.min(maxPin, index * 2 + 2);
    return `<div class="ary-winding" data-winding><div class="ary-winding__head"><b>سیم‌پیچ ${numberFa(index + 1)}</b><button type="button" data-remove-winding aria-label="حذف">×</button></div><label>نام<input data-key="name" value="${index === 0 ? 'اولیه' : index === 1 ? 'ثانویه' : `سیم‌پیچ ${index + 1}`}"></label><label>پایه شروع<select data-key="start_pin">${pinOptions(startPin)}</select></label><label>پایه پایان<select data-key="end_pin">${pinOptions(endPin)}</select></label><label>تعداد دور<input data-key="turns" type="number" min="1" value="${index === 0 ? 100 : 20}"></label><label>سیم<select data-key="wire_id">${wireOptions}</select><small data-wire-stock class="ary-stock-hint ${initialWire?.available ? 'ok' : 'bad'}">${initialWire ? (initialWire.available ? 'موجود و قابل سفارش' : 'ناموجود') : 'سیم انتخاب نشده'}</small></label><label>رشته<input data-key="strands" type="number" min="1" max="20" value="1"></label><label>جهت<select data-key="direction"><option value="cw">ساعتگرد</option><option value="ccw" ${index === 1 ? 'selected' : ''}>پادساعتگرد</option></select></label></div>`;
  }

  function renderApp(root, catalog) {
    const cores = catalog.cores || [];
    const bobbins = catalog.bobbins || [];
    const wires = catalog.wires || [];
    root.innerHTML = `<div class="ary-head"><span>مرکز محاسبه آریامن</span><h2>محاسبه ترانس سفارشی</h2></div><div class="ary-body"><div class="ary-grid"><label>نوع سفارش<select data-order-type><option value="sample">سفارش نمونه ترانس · ۱–۹۹ عدد</option><option value="production">سفارش تعداد · +۱۰۰ عدد</option></select></label><label>تعداد<input data-quantity type="number" min="1" max="99" value="1"></label><label>مدل هسته<select data-core><option value="">انتخاب هسته</option>${cores.map((core) => `<option value="${esc(core.id)}" ${core.calculable ? '' : 'disabled'}>${esc(core.model_code)}${core.calculable ? '' : ' · نیازمند تکمیل'}</option>`).join('')}</select><small data-core-stock class="ary-stock-hint">پس از انتخاب، وضعیت موجودی نمایش داده می‌شود.</small></label><label>مدل بوبین<select data-bobbin disabled><option value="">ابتدا هسته را انتخاب کنید</option></select><small data-bobbin-stock class="ary-stock-hint">پس از انتخاب، وضعیت موجودی نمایش داده می‌شود.</small></label><label>نام مشتری<input data-customer-name autocomplete="name"></label><label>شماره تماس<input data-customer-phone inputmode="tel" autocomplete="tel"></label><label class="ary-span-2">عنوان پروژه<input data-project></label><label class="ary-check"><input data-gap type="checkbox"><span>هسته دارای گپ است</span></label></div><section class="ary-windings"><div class="ary-section-head"><h3>سیم‌پیچ‌ها</h3></div><div data-windings></div><div class="ary-winding-footer"><button type="button" data-add-winding>+ افزودن سیم‌پیچ</button></div><div class="ary-live-fill" data-live-fill><div><span>پرشدگی زنده پنجره</span><b>—</b></div><div class="ary-live-fill__track"><i></i></div><small>پس از انتخاب هسته، بوبین و سیم به‌صورت خودکار نمایش داده می‌شود.</small></div></section><div data-message></div><button type="button" class="ary-submit" data-submit>محاسبه و نمایش نتیجه</button><div data-result></div></div>`;
    const coreSelect = root.querySelector('[data-core]');
    const bobbinSelect = root.querySelector('[data-bobbin]');
    const windingsHost = root.querySelector('[data-windings]');
    const message = root.querySelector('[data-message]');
    const resultHost = root.querySelector('[data-result]');
    const liveHost = root.querySelector('[data-live-fill]');
    const quantity = root.querySelector('[data-quantity]');
    const orderType = root.querySelector('[data-order-type]');
    let windingCount = 0;
    let maxPin = 10;
    let pendingPayload = null;
    let liveTimer = null;
    let liveSequence = 0;

    function buildPayload() {
      const rows = [...windingsHost.querySelectorAll('[data-winding]')].map((row) => Object.fromEntries([...row.querySelectorAll('[data-key]')].map((input) => [input.dataset.key, ['start_pin', 'end_pin', 'turns', 'strands'].includes(input.dataset.key) ? Number(input.value) : input.value])));
      return {
        core_id: coreSelect.value,
        bobbin_id: bobbinSelect.value,
        order_type: orderType.value,
        quantity: Number(quantity.value),
        customer_name: root.querySelector('[data-customer-name]').value,
        customer_phone: root.querySelector('[data-customer-phone]').value,
        project_title: root.querySelector('[data-project]').value,
        has_gap: root.querySelector('[data-gap]').checked,
        windings: rows.map((row) => ({ ...row, arrangement: 'side', layer_mode: 'auto', requested_layers: 1 })),
      };
    }

    function invalidateResult() {
      pendingPayload = null;
      resultHost.innerHTML = '';
      message.innerHTML = '';
    }

    async function updateLiveFill() {
      const sequence = ++liveSequence;
      const payload = buildPayload();
      if (!payload.core_id || !payload.bobbin_id || !payload.windings.length || payload.windings.some((row) => !row.wire_id || !row.turns)) {
        liveHost.className = 'ary-live-fill';
        liveHost.querySelector('b').textContent = '—';
        liveHost.querySelector('i').style.width = '0%';
        return;
      }
      liveHost.classList.add('loading');
      try {
        const data = await request(config.quoteUrl, { method: 'POST', body: JSON.stringify({ payload }) });
        if (sequence !== liveSequence) return;
        const percent = Number(data.engineering?.occupancy_percent || 0);
        liveHost.className = `ary-live-fill ${percent > 100 ? 'danger' : percent >= 90 ? 'warning' : 'ok'}`;
        liveHost.querySelector('b').textContent = `${numberFa(percent, 1)}٪`;
        liveHost.querySelector('i').style.width = `${Math.min(100, Math.max(0, percent))}%`;
        liveHost.querySelector('small').textContent = 'با تغییر مشخصات سیم‌پیچ به‌صورت خودکار به‌روزرسانی می‌شود.';
      } catch (error) {
        if (sequence !== liveSequence) return;
        liveHost.className = 'ary-live-fill';
        liveHost.querySelector('small').textContent = error.message;
      }
    }

    function scheduleLiveFill() {
      window.clearTimeout(liveTimer);
      liveTimer = window.setTimeout(updateLiveFill, 1100);
    }

    function addWinding() {
      if (windingCount >= 12) return;
      const wrap = document.createElement('div');
      wrap.innerHTML = windingRow(windingCount, wires, maxPin);
      windingsHost.appendChild(wrap.firstElementChild);
      windingCount += 1;
      invalidateResult();
      scheduleLiveFill();
    }
    addWinding(); addWinding();

    coreSelect.addEventListener('change', () => {
      const selectedCore = cores.find((item) => item.id === coreSelect.value);
      const coreStock = root.querySelector('[data-core-stock]');
      coreStock.className = `ary-stock-hint ${selectedCore ? (selectedCore.available ? 'ok' : 'bad') : ''}`;
      coreStock.textContent = selectedCore ? (selectedCore.available ? 'موجود و قابل سفارش' : 'ناموجود') : 'پس از انتخاب، وضعیت موجودی نمایش داده می‌شود.';
      const list = bobbins.filter((item) => item.core_id === coreSelect.value);
      bobbinSelect.disabled = !list.length;
      bobbinSelect.innerHTML = list.length ? `<option value="">انتخاب بوبین</option>${list.map((item) => `<option value="${esc(item.id)}">${esc(item.pins)} پین · ${esc(item.mount_orientation)}</option>`).join('')}` : '<option value="">بوبین کامل ثبت نشده است</option>';
      const bobbinStock = root.querySelector('[data-bobbin-stock]');
      bobbinStock.className = 'ary-stock-hint';
      bobbinStock.textContent = 'پس از انتخاب، وضعیت موجودی نمایش داده می‌شود.';
    });
    bobbinSelect.addEventListener('change', () => {
      const selected = bobbins.find((item) => item.id === bobbinSelect.value);
      const bobbinStock = root.querySelector('[data-bobbin-stock]');
      bobbinStock.className = `ary-stock-hint ${selected ? (selected.available ? 'ok' : 'bad') : ''}`;
      bobbinStock.textContent = selected ? (selected.available ? 'موجود و قابل سفارش' : 'ناموجود') : 'پس از انتخاب، وضعیت موجودی نمایش داده می‌شود.';
      if (!selected) return;
      maxPin = String(selected.pins).split('+').reduce((sum, part) => sum + Number(part || 0), 0) || 10;
      windingsHost.querySelectorAll('[data-winding]').forEach((row, index) => {
        ['start_pin', 'end_pin'].forEach((key, keyIndex) => {
          const select = row.querySelector(`[data-key="${key}"]`);
          const preferred = Math.min(maxPin, Number(select.value) || index * 2 + keyIndex + 1);
          select.innerHTML = Array.from({ length: maxPin }, (_, pin) => `<option value="${pin + 1}" ${pin + 1 === preferred ? 'selected' : ''}>${numberFa(pin + 1)}</option>`).join('');
        });
      });
    });
    orderType.addEventListener('change', () => {
      if (orderType.value === 'production') { quantity.min = '100'; quantity.removeAttribute('max'); if (Number(quantity.value) < 100) quantity.value = '100'; }
      else { quantity.min = '1'; quantity.max = '99'; if (Number(quantity.value) > 99) quantity.value = '1'; }
    });
    root.addEventListener('input', (event) => {
      if (!event.target.closest('[data-result]')) invalidateResult();
      if (event.target.matches('[data-quantity],[data-gap],[data-key]')) scheduleLiveFill();
    });
    root.addEventListener('change', (event) => {
      if (!event.target.closest('[data-result]')) invalidateResult();
      if (event.target.matches('[data-key="wire_id"]')) {
        const wire = wires.find((item) => item.id === event.target.value);
        const hint = event.target.closest('label')?.querySelector('[data-wire-stock]');
        if (hint) {
          hint.className = `ary-stock-hint ${wire ? (wire.available ? 'ok' : 'bad') : ''}`;
          hint.textContent = wire ? (wire.available ? 'موجود و قابل سفارش' : 'ناموجود') : 'سیم انتخاب نشده';
        }
      }
      if (event.target.matches('[data-core],[data-bobbin],[data-order-type],[data-quantity],[data-gap],[data-key]')) scheduleLiveFill();
    });
    root.querySelector('[data-add-winding]').addEventListener('click', addWinding);
    windingsHost.addEventListener('click', (event) => {
      if (!event.target.matches('[data-remove-winding]') || windingCount <= 1) return;
      event.target.closest('[data-winding]').remove(); windingCount -= 1; invalidateResult(); scheduleLiveFill();
    });

    root.querySelector('[data-submit]').addEventListener('click', async () => {
      message.innerHTML = '';
      const button = root.querySelector('[data-submit]');
      const payload = buildPayload();
      button.disabled = true; button.textContent = 'در حال محاسبه امن…';
      try {
        const data = await request(config.quoteUrl, { method: 'POST', body: JSON.stringify({ payload }) });
        pendingPayload = payload;
        const engineering = data.engineering || {};
        const technicalRows = (engineering.rows || []).map((row) => `<tr><td>${numberFa(row.line_no)}</td><td><b>${esc(row.name)}</b></td><td>${numberFa(row.start_pin)} ← ${numberFa(row.end_pin)}</td><td>${numberFa(row.turns)}</td><td>${numberFa(row.wire_diameter_mm, 3)} mm${row.awg ? ` (AWG ${esc(row.awg)})` : ''}</td><td>${numberFa(row.strands)}</td><td>${numberFa(row.calculated_layers)}</td><td>${row.direction === 'ccw' ? 'پادساعتگرد' : 'ساعتگرد'}</td></tr>`).join('');
        const inventory = data.inventory || [];
        const stockState = (role) => { const rows = inventory.filter((row) => row.component_role === role); return rows.length > 0 && rows.every((row) => row.status === 'available'); };
        resultHost.innerHTML = `<div class="ary-result-groups"><section class="ary-result-category"><div class="ary-category-title"><i>۱</i><div><h3>خلاصه امکان ساخت، موجودی و قیمت نهایی</h3><small>نتیجه سریع و قابل ارائه پیش از تأیید</small></div></div><div class="ary-summary-grid"><div><small>پرشدگی پنجره</small><b>${numberFa(engineering.occupancy_percent, 1)}٪</b></div><div><small>وضعیت ساخت</small><b class="ok">مجاز</b></div><div><small>موجودی هسته</small><b class="${stockState('core') ? 'ok' : 'bad'}">${stockState('core') ? 'موجود' : 'ناموجود'}</b></div><div><small>موجودی بوبین</small><b class="${stockState('bobbin') ? 'ok' : 'bad'}">${stockState('bobbin') ? 'موجود' : 'ناموجود'}</b></div><div><small>قیمت هر عدد</small><b>${toman(data.result.unit_sale_rial)}</b></div><div><small>تعداد</small><b>${numberFa(payload.quantity)} عدد</b></div><div><small>ستاپ</small><b>${toman(data.result.setup_fee_rial)}</b></div><div class="total"><small>مبلغ نهایی</small><strong>${toman(data.result.total_sale_rial)}</strong></div></div><div class="ary-confirm-zone"><p>پس از تأیید، قیمت و موجودی دوباره در سرور بررسی و درخواست در سامانه آریامن ثبت می‌شود.</p><button type="button" class="ary-confirm" data-confirm>تأیید نهایی و ثبت درخواست</button></div></section><section class="ary-result-category"><div class="ary-category-title"><i>۲</i><div><h3>پرونده فنی و جدول سیم‌پیچی</h3><small>اطلاعات مهندسی پیش از تأیید نهایی</small></div></div><div class="ary-tech-metrics"><div><small>کنترل سطح</small><b>${numberFa(engineering.area_percent, 1)}٪</b></div><div><small>کنترل شعاعی</small><b>${numberFa(engineering.radial_percent, 1)}٪</b></div><div><small>طول سیم هر عدد</small><b>${numberFa(engineering.total_length_m, 2)} متر</b></div><div><small>وزن مس هر عدد</small><b>${numberFa(engineering.copper_weight_per_unit_g, 2)} گرم</b></div></div><div class="ary-table-wrap"><table class="ary-technical-table"><thead><tr><th>ردیف</th><th>نام</th><th>پین</th><th>دور</th><th>سیم</th><th>رشته</th><th>لایه</th><th>جهت</th></tr></thead><tbody>${technicalRows}</tbody></table></div></section></div>`;
        resultHost.querySelector('[data-confirm]').addEventListener('click', async (event) => {
          const confirmButton = event.currentTarget;
          if (!pendingPayload?.customer_name || !pendingPayload?.customer_phone || !pendingPayload?.project_title) {
            message.innerHTML = '<p class="ary-error">نام مشتری، شماره تماس و عنوان پروژه را کامل کنید.</p>';
            return;
          }
          confirmButton.disabled = true; confirmButton.textContent = 'در حال ثبت نهایی…';
          try {
            const confirmed = await request(config.confirmUrl, { method: 'POST', body: JSON.stringify({ payload: pendingPayload }) });
            const zone = resultHost.querySelector('.ary-confirm-zone');
            zone.innerHTML = `<div class="ary-confirmed"><b>درخواست با موفقیت ثبت شد</b><span>کد پیگیری: ${esc(confirmed.quote_code)}</span></div><button type="button" class="ary-pdf" data-print-report>دریافت خروجی PDF مشتری</button>${config.woocommerce ? '<button type="button" data-add-cart>افزودن سفارش به سبد خرید</button>' : ''}`;
            zone.querySelector('[data-print-report]').addEventListener('click', () => printCustomerReport(resultHost, confirmed.quote_code, pendingPayload));
            const cartButton = zone.querySelector('[data-add-cart]');
            if (cartButton) cartButton.addEventListener('click', async () => {
              cartButton.disabled = true;
              try {
                const cart = await request(config.cartUrl, { method: 'POST', headers: { 'X-WP-Nonce': config.nonce }, body: JSON.stringify({ quote_id: confirmed.quote_id }) });
                window.location.href = cart.cart_url;
              } catch (error) { message.innerHTML = `<p class="ary-error">${esc(error.message)}</p>`; cartButton.disabled = false; }
            });
          } catch (error) { message.innerHTML = `<p class="ary-error">${esc(error.message)}</p>`; confirmButton.disabled = false; confirmButton.textContent = 'تأیید نهایی و ثبت درخواست'; }
        });
      } catch (error) { message.innerHTML = `<p class="ary-error">${esc(error.message)}</p>`; resultHost.innerHTML = ''; pendingPayload = null; }
      finally { button.disabled = false; button.textContent = 'محاسبه و نمایش نتیجه'; }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-aryaman-calculator]').forEach(async (root) => {
      try { const data = await request(config.catalogUrl); renderApp(root, data.catalog || {}); }
      catch (error) { root.innerHTML = `<div class="ary-disabled"><b>محاسبه‌گر عمومی در دسترس نیست</b><span>${esc(error.message)}</span></div>`; }
    });
  });
})();
