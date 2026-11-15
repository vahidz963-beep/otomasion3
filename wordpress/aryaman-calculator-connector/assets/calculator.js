(() => {
  'use strict';
  const config = Object.assign({
    catalogUrl: '/wp-json/aryaman-calculator/v1/catalog',
    quoteUrl: '/wp-json/aryaman-calculator/v1/quote',
    confirmUrl: '/wp-json/aryaman-calculator/v1/confirm',
    cartUrl: '/wp-json/aryaman-calculator/v1/cart',
    boardQuoteUrl: '/wp-json/aryaman-calculator/v1/board-quote',
    boardConfirmUrl: '/wp-json/aryaman-calculator/v1/board-confirm',
    nonce: '',
    woocommerce: false,
  }, window.AriamanCalculatorConfig || {});
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const numberFa = (value, digits = 0) => Number(value || 0).toLocaleString('fa-IR', { maximumFractionDigits: digits });
  const toman = (rial) => `${numberFa(Math.round(Number(rial || 0) / 10))} تومان`;

  async function request(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || body.error || 'ارتباط با مرکز محاسبه ناموفق بود.');
    return body;
  }

  let lastQuoteData = null;

  function openReportInPage(html, label) {
    const existing = document.getElementById('ary-report-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'ary-report-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(13,31,53,.55);display:flex;align-items:stretch;justify-content:center;padding:14px';
    const frameWrap = document.createElement('div');
    frameWrap.style.cssText = 'position:relative;width:min(100%,900px);background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.4);display:flex;flex-direction:column';
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;background:#10243d;color:#fff;padding:10px 14px;font:700 14px/1 sans-serif;direction:rtl';
    bar.innerHTML = `<span>${label}</span><span style="display:flex;gap:8px"><button type="button" data-ary-print style="background:#f2b705;color:#233246;border:0;border-radius:8px;padding:8px 14px;font:900 13px sans-serif;cursor:pointer">دانلود PDF (ذخیره فایل)</button><button type="button" data-ary-close style="background:rgba(255,255,255,.14);color:#fff;border:0;border-radius:8px;padding:8px 12px;font:800 13px sans-serif;cursor:pointer">بستن</button></span>`;
    const frame = document.createElement('iframe');
    frame.style.cssText = 'flex:1;border:0;width:100%;background:#fff';
    frameWrap.appendChild(bar); frameWrap.appendChild(frame);
    overlay.appendChild(frameWrap);
    document.body.appendChild(overlay);
    frame.srcdoc = html;
    const printFrame = () => frame.contentWindow.focus();
    bar.querySelector('[data-ary-print]').addEventListener('click', () => { printFrame(); frame.contentWindow.print(); });
    bar.querySelector('[data-ary-close]').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
  }

  function printCustomerReport(quoteData, code, payload) {
    const engineering = quoteData.engineering || {};
    const components = quoteData.components || {};
    const bobbin = components.bobbin || {};
    const options = { lang: 'en' };
    const fillSvg = window.AryDiagramFill(bobbin, engineering, options);
    const pinSvg = window.AryDiagramPin(bobbin, engineering, options);
    window.AryReportLogo = `${(window.AriamanCalculatorConfig || {}).pluginUrl || ''}assets/aryaman-report-logo.png`;
    const html = window.AryReportBuildTransformer({
      code,
      createdAt: quoteData.createdAt || new Date().toISOString(),
      customerName: payload.customer_name,
      customerPhone: payload.customer_phone,
      projectTitle: payload.project_title,
      orderType: payload.order_type,
      quantity: payload.quantity,
      hasGap: payload.has_gap,
      core: components.core || {},
      bobbin,
      engineering,
      publicResult: quoteData.result || {},
      inventory: quoteData.inventory || [],
      fillSvg,
      pinSvg,
    });
    openReportInPage(html, `گزارش مشتری — ${code}`);
  }


  function windingRow(index, wires, maxPin) {
    const pinOptions = (selected) => Array.from({ length: maxPin }, (_, pin) => `<option value="${pin + 1}" ${pin + 1 === selected ? 'selected' : ''}>${numberFa(pin + 1)}</option>`).join('');
    const wireOptions = wires.map((wire) => `<option value="${esc(wire.id)}">${numberFa(wire.diameter_mm, 2)}mm${wire.awg ? ` (AWG ${esc(wire.awg)})` : ''}</option>`).join('');
    const startPin = Math.min(maxPin, index * 2 + 1);
    const endPin = Math.min(maxPin, index * 2 + 2);
    const name = index === 0 ? 'اولیه' : index === 1 ? 'ثانویه' : `نمونه ${numberFa(index + 1)}`;
    return `<tr data-winding><td class="ary-row-no">N${index + 1}</td><td><input data-key="name" value="${esc(name)}"></td><td><select data-key="start_pin">${pinOptions(startPin)}</select></td><td><select data-key="end_pin">${pinOptions(endPin)}</select></td><td><input data-key="turns" type="number" min="1" value="${index === 0 ? 100 : 20}"></td><td><select data-key="wire_id">${wireOptions}</select></td><td><input data-key="strands" type="number" min="1" max="20" value="1"></td><td title="دور چسب مایلار بعد از هر لایه این سیم‌پیچ"><input data-key="insulation_wraps" type="number" min="0" max="20" value="3"></td><td><select data-key="direction"><option value="cw">ساعتگرد</option><option value="ccw">پادساعتگرد</option></select></td><td><button type="button" class="ary-row-del" data-remove-winding aria-label="حذف سیم‌پیچ">×</button></td></tr>`;
  }
  function windingTableShell(wires, maxPin) {
    return `<div class="ary-table-wrap ary-wind-table-wrap"><table class="ary-technical-table ary-wind-table"><thead><tr><th>ردیف</th><th>نام</th><th>شروع</th><th>پایان</th><th>دور</th><th>سیم</th><th>رشته</th><th>چسب هر لایه (دور)</th><th>جهت</th><th></th></tr></thead><tbody data-windings></tbody></table></div>`;
  }

  function renderApp(root, catalog) {
    const cores = catalog.cores || [];
    const bobbins = catalog.bobbins || [];
    const wires = catalog.wires || [];
    root.innerHTML = `<div class="ary-head"><span>مرکز محاسبه آریامن</span><h2>محاسبه ترانس سفارشی</h2>${config.cartPageUrl ? `<a class="ary-cart-link" href="${config.cartPageUrl}">سبد خرید${config.cartCount > 0 ? ` (${config.cartCount})` : ``}</a>` : ``}</div><div class="ary-body">
<section class="ary-fieldset"><div class="ary-legend"><i>۱</i><div><h3>اطلاعات مشتری و سفارش</h3><small>نوع سفارش، تعداد و مشخصات تماس</small></div></div><div class="ary-grid"><label>نوع سفارش<select data-order-type><option value="sample">سفارش نمونه ترانس · ۱–۹۹ عدد</option><option value="production">سفارش تعداد · +۱۰۰ عدد</option></select></label><label>تعداد<input data-quantity type="number" min="1" max="99" value="1"></label><label>نام مشتری<input data-customer-name autocomplete="name"></label><label>شماره تماس<input data-customer-phone inputmode="tel" autocomplete="tel"></label><label class="ary-span-2">عنوان پروژه<input data-project></label></div></section>
<section class="ary-fieldset"><div class="ary-legend"><i>۲</i><div><h3>انتخاب هسته و بوبین</h3><small>مدل فریت، بوبین متناظر و وضعیت گپ</small></div></div><div class="ary-grid"><label>مدل هسته<select data-core><option value="">انتخاب هسته</option>${cores.map((core) => `<option value="${esc(core.id)}" ${core.calculable ? '' : 'disabled'}>${esc(core.model_code)}${core.calculable ? '' : ' · نیازمند تکمیل'}</option>`).join('')}</select><small data-core-stock class="ary-stock-hint">پس از انتخاب، وضعیت موجودی نمایش داده می‌شود.</small></label><label>مدل بوبین<select data-bobbin disabled><option value="">ابتدا هسته را انتخاب کنید</option></select><small data-bobbin-stock class="ary-stock-hint">پس از انتخاب، وضعیت موجودی نمایش داده می‌شود.</small></label><label class="ary-check ary-span-2"><input data-gap type="checkbox"><span>هسته دارای گپ است</span></label></div></section>
<section class="ary-fieldset"><div class="ary-legend"><i>۳</i><div><h3>اطلاعات سیم‌پیچ‌ها</h3><small>دور، سیم، رشته، چسب هر لایه و جهت هر سیم‌پیچ</small></div></div><div data-windings-shell></div><div class="ary-winding-footer"><button type="button" data-add-winding>+ افزودن سیم‌پیچ</button></div><div class="ary-live-fill" data-live-fill><div><span>پرشدگی زنده پنجره</span><b>—</b></div><div class="ary-live-fill__track"><i></i></div><small>پس از انتخاب هسته، بوبین و سیم به‌صورت خودکار نمایش داده می‌شود.</small></div></section>
<div data-message></div><button type="button" class="ary-submit" data-submit>محاسبه و نمایش نتیجه</button><div data-result></div></div>`;
    const coreSelect = root.querySelector('[data-core]');
    const bobbinSelect = root.querySelector('[data-bobbin]');
    const message = root.querySelector('[data-message]');
    const resultHost = root.querySelector('[data-result]');
    const liveHost = root.querySelector('[data-live-fill]');
    const quantity = root.querySelector('[data-quantity]');
    const orderType = root.querySelector('[data-order-type]');
    const windingsShell = root.querySelector('[data-windings-shell]');
    let windingCount = 0;
    let maxPin = 10;
    let pendingPayload = null;
    let liveTimer = null;
    let liveSequence = 0;
    windingsShell.innerHTML = windingTableShell(wires, maxPin);
    const windingsHost = root.querySelector('[data-windings]');

    function buildPayload() {
      const rows = [...windingsHost.querySelectorAll('[data-winding]')].map((row) => Object.fromEntries([...row.querySelectorAll('[data-key]')].map((input) => [input.dataset.key, ['start_pin', 'end_pin', 'turns', 'strands', 'insulation_wraps'].includes(input.dataset.key) ? Number(input.value) : input.value])));
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
        const response = await fetch(config.quoteUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload }) });
        const data = await response.json().catch(() => ({}));
        if (sequence !== liveSequence) return;
        const percent = Number(data.engineering?.occupancy_percent || 0);
        if (!response.ok && !percent) {
          liveHost.className = 'ary-live-fill';
          liveHost.querySelector('b').textContent = '—';
          liveHost.querySelector('i').style.width = '0%';
          liveHost.querySelector('small').textContent = data.error || 'محاسبه زنده ناموفق بود.';
          return;
        }
        liveHost.className = `ary-live-fill ${percent > 100 ? 'danger' : percent >= 90 ? 'warning' : 'ok'}`;
        liveHost.querySelector('b').textContent = `${numberFa(percent, 1)}٪${percent > 100 ? ' — بیش از ظرفیت' : ''}`;
        liveHost.querySelector('i').style.width = percent > 100 ? '100%' : `${Math.min(100, Math.max(0, percent))}%`;
        liveHost.querySelector('small').textContent = percent > 100
          ? `پنجره بوبین ${numberFa(percent, 1)}٪ پر شده است؛ ${numberFa(percent - 100, 1)}٪ بیش از ظرفیت مجاز — قابل سفارش نیست.`
          : percent >= 90 ? `پنجره ${numberFa(percent, 1)}٪ پر است — نیازمند بازبینی کارگاهی.` : 'پرشدگی مجاز؛ با تغییر مشخصات به‌صورت خودکار به‌روزرسانی می‌شود.';
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
      windingsHost.insertAdjacentHTML('beforeend', windingRow(windingCount, wires, maxPin));
      windingCount += 1;
      invalidateResult();
      scheduleLiveFill();
    }
    addWinding(); addWinding();

    coreSelect.addEventListener('change', () => {
      const selectedCore = cores.find((item) => item.id === coreSelect.value);
      const coreStock = root.querySelector('[data-core-stock]');
      coreStock.className = `ary-stock-hint ${selectedCore ? (selectedCore.available ? 'ok' : 'bad') : ''}`;
      coreStock.textContent = selectedCore ? (selectedCore.available ? `موجودی قابل سفارش: ${numberFa(selectedCore.available_qty ?? 0)} عدد` : 'ناموجود') : 'پس از انتخاب، وضعیت موجودی نمایش داده می‌شود.';
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
      bobbinStock.textContent = selected ? (selected.available ? `موجودی قابل سفارش: ${numberFa(selected.available_qty ?? 0)} عدد` : 'ناموجود') : 'پس از انتخاب، وضعیت موجودی نمایش داده می‌شود.';
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
      if (event.target.matches('[data-core],[data-bobbin],[data-order-type],[data-quantity],[data-gap],[data-key]')) scheduleLiveFill();
    });
    root.querySelector('[data-add-winding]').addEventListener('click', addWinding);
    windingsHost.addEventListener('click', (event) => {
      if (!event.target.matches('[data-remove-winding]') || windingCount <= 1) return;
      event.target.closest('[data-winding]').remove(); windingCount -= 1;
      windingsHost.querySelectorAll('[data-winding]').forEach((row, index) => { row.querySelector('.ary-row-no').textContent = numberFa(index + 1); });
      invalidateResult(); scheduleLiveFill();
    });

    root.querySelector('[data-submit]').addEventListener('click', async () => {
      message.innerHTML = '';
      const button = root.querySelector('[data-submit]');
      const payload = buildPayload();
      button.disabled = true; button.textContent = 'در حال محاسبه امن…';
      try {
        const data = await request(config.quoteUrl, { method: 'POST', body: JSON.stringify({ payload }) });
        pendingPayload = payload;
        lastQuoteData = { ...data, createdAt: new Date().toISOString() };
        const engineering = data.engineering || {};
        const bobbin = (data.components || {}).bobbin && data.components.bobbin.pins_left ? data.components.bobbin : (bobbins.find((item) => item.id === payload.bobbin_id) || (data.components || {}).bobbin || {});
        const technicalRows = (engineering.rows || []).map((row) => `<tr><td>${numberFa(row.line_no)}</td><td><b>${esc(row.name)}</b></td><td>${numberFa(row.start_pin)} ← ${numberFa(row.end_pin)}</td><td>${numberFa(row.turns)}</td><td>${numberFa(row.wire_diameter_mm, 3)} mm${row.awg ? ` (AWG ${esc(row.awg)})` : ''}</td><td>${numberFa(row.strands)}</td><td>${numberFa(row.calculated_layers)}</td><td>${row.direction === 'ccw' ? 'پادساعتگرد' : 'ساعتگرد'}</td></tr>`).join('');
        const inventory = data.inventory || [];
        const stockState = (role) => { const rows = inventory.filter((row) => row.component_role === role); return rows.length > 0 && rows.every((row) => row.status === 'available'); };
        resultHost.innerHTML = `<div class="ary-result-groups"><section class="ary-result-category"><div class="ary-category-title"><i>۱</i><div><h3>خلاصه امکان ساخت، موجودی و قیمت نهایی</h3><small>نتیجه سریع و قابل ارائه پیش از تأیید</small></div></div><div class="ary-summary-grid"><div><small>پرشدگی پنجره</small><b>${numberFa(engineering.occupancy_percent, 1)}٪</b></div><div><small>وضعیت ساخت</small><b class="ok">مجاز</b></div><div><small>موجودی هسته</small><b class="${stockState('core') ? 'ok' : 'bad'}">${stockState('core') ? 'موجود' : 'ناموجود'}</b></div><div><small>موجودی بوبین</small><b class="${stockState('bobbin') ? 'ok' : 'bad'}">${stockState('bobbin') ? 'موجود' : 'ناموجود'}</b></div><div><small>قیمت هر عدد</small><b>${toman(data.result.unit_sale_rial)}</b></div><div><small>تعداد</small><b>${numberFa(payload.quantity)} عدد</b></div><div><small>ستاپ</small><b>${toman(data.result.setup_fee_rial)}</b></div><div class="total"><small>مبلغ نهایی</small><strong>${toman(data.result.total_sale_rial)}</strong></div></div></section><section class="ary-result-category"><div class="ary-category-title"><i>۲</i><div><h3>پرونده فنی و جدول سیم‌پیچی</h3><small>اطلاعات مهندسی پیش از تأیید نهایی</small></div></div><div class="ary-tech-metrics"><div><small>کنترل سطح</small><b>${numberFa(engineering.area_percent, 1)}٪</b></div><div><small>کنترل شعاعی</small><b>${numberFa(engineering.radial_percent, 1)}٪</b></div><div><small>طول سیم هر عدد</small><b>${numberFa(engineering.total_length_m, 2)} متر</b></div><div><small>وزن مس هر عدد</small><b>${numberFa(engineering.copper_weight_per_unit_g, 2)} گرم</b></div></div><div class="ary-table-wrap"><table class="ary-technical-table"><thead><tr><th>ردیف</th><th>نام</th><th>پین</th><th>دور</th><th>سیم</th><th>رشته</th><th>لایه</th><th>جهت</th></tr></thead><tbody>${technicalRows}</tbody></table></div><div class="ary-diagram-grid"><figure class="ary-diagram-card"><figcaption>نقشه ۱ — پرشدگی سیم‌پیچ‌ها</figcaption><div class="ary-diagram-svg">${window.AryDiagramFill(bobbin, engineering, { lang: 'fa' })}</div><div class="ary-diagram-legend">${(engineering.rows || []).map((row) => `<span><i style="background:${esc(row.color)}"></i>N${numberFa(row.line_no)} · ${esc(row.name)}</span>`).join('')}</div></figure><figure class="ary-diagram-card"><figcaption>نقشه ۲ — نمای بالای پایه و سیم‌پیچی</figcaption><div class="ary-diagram-svg">${window.AryDiagramPin(bobbin, engineering, { lang: 'fa' })}</div></figure></div></section><div class="ary-final-zone"><div class="ary-confirm-zone"><p>پس از تأیید، قیمت و موجودی دوباره در سرور بررسی و درخواست در سامانه آریامن ثبت می‌شود.</p><div class="ary-confirm-totals"><div><small>تعداد سفارش</small><b>${numberFa(payload.quantity)} عدد</b></div><div><small>قیمت هر واحد</small><b>${toman(data.result.unit_sale_rial)}</b></div><div><small>قیمت کل</small><strong>${toman(data.result.total_sale_rial)}</strong></div></div><p class="ary-error" data-confirm-error hidden></p><button type="button" class="ary-confirm" data-confirm>تأیید نهایی و ثبت درخواست</button></div></div></div>`;
        resultHost.querySelector('[data-confirm]').addEventListener('click', async (event) => {
          const confirmButton = event.currentTarget;
          const confirmError = resultHost.querySelector('[data-confirm-error]');
          const showConfirmError = (text) => { if (confirmError) { confirmError.textContent = text; confirmError.hidden = false; } message.innerHTML = `<p class="ary-error">${esc(text)}</p>`; };
          if (!pendingPayload?.customer_name || !pendingPayload?.customer_phone || !pendingPayload?.project_title) {
            showConfirmError('نام مشتری، شماره تماس و عنوان پروژه را کامل کنید.');
            return;
          }
          confirmButton.disabled = true; confirmButton.textContent = 'در حال ثبت نهایی…';
          try {
            const confirmed = await request(config.confirmUrl, { method: 'POST', body: JSON.stringify({ payload: pendingPayload }) });
            const zone = resultHost.querySelector('.ary-confirm-zone');
            zone.innerHTML = `<div class="ary-confirmed"><b>درخواست با موفقیت ثبت شد</b><span>کد پیگیری: ${esc(confirmed.quote_code)}</span></div><button type="button" class="ary-pdf" data-print-report>دریافت خروجی PDF مشتری</button><button type="button" class="ary-cart-btn" data-add-cart>افزودن سفارش به سبد خرید</button>`;
            zone.querySelector('[data-print-report]').addEventListener('click', () => printCustomerReport(lastQuoteData || {}, confirmed.quote_code, pendingPayload));
            const cartButton = zone.querySelector('[data-add-cart]');
            if (cartButton) cartButton.addEventListener('click', async () => {
              if (!config.woocommerce) { message.innerHTML = '<p class="ary-error">برای پرداخت آنلاین، افزونه WooCommerce باید روی سایت فعال باشد. پس از فعال‌سازی، در تنظیمات افزونه «شناسه محصول» را وارد و ارز فروشگاه را ریال یا تومان بگذارید.</p>'; return; }
              cartButton.disabled = true;
              try {
                const cart = await request(config.cartUrl, { method: 'POST', headers: { 'X-WP-Nonce': config.nonce }, body: JSON.stringify({ quote_id: confirmed.quote_id }) });
                window.location.href = cart.cart_url;
              } catch (error) { message.innerHTML = `<p class="ary-error">${esc(error.message)}</p>`; cartButton.disabled = false; }
            });
          } catch (error) { showConfirmError(error.message); confirmButton.disabled = false; confirmButton.textContent = 'تأیید نهایی و ثبت درخواست'; }
        });
      } catch (error) { message.innerHTML = `<p class="ary-error">${esc(error.message)}</p>`; resultHost.innerHTML = ''; pendingPayload = null; }
      finally { button.disabled = false; button.textContent = 'محاسبه و نمایش نتیجه'; }
    });
  }

  /* ---------- board designer (محاسبه برد) ---------- */
  const BOARD_FEATURES = [
    ['isolation', 'عایق ایمنی'], ['pfc', 'اصلاح ضریب توان (PFC)'], ['digital', 'کنترل دیجیتال'],
    ['communication', 'ارتباطات و پایش'], ['protection', 'زنجیره حفاظت'], ['emi', 'سازگاری الکترومغناطیسی (EMI)'], ['thermal', 'مدیریت حرارتی'],
  ];
  function renderBoardApp(root) {
    root.innerHTML = `<div class="ary-head"><span>مرکز محاسبه آریامن</span><h2>محاسبه و برآورد طراحی برد</h2>${config.cartPageUrl ? `<a class="ary-cart-link" href="${config.cartPageUrl}">سبد خرید${config.cartCount > 0 ? ` (${config.cartCount})` : ``}</a>` : ``}</div><div class="ary-body"><div class="ary-grid">
      <label>عرض برد (mm)<input data-board-width type="number" min="1" step="0.1" value="100"></label>
      <label>ارتفاع برد (mm)<input data-board-height type="number" min="1" step="0.1" value="80"></label>
      <label>توان (وات)<input data-board-power type="number" min="1" step="1" value="100"></label>
      <label>تعداد لایه<select data-board-layers><option value="2">۲ لایه</option><option value="4">۴ لایه</option><option value="6">۶ لایه</option><option value="8">۸ لایه</option></select></label>
      <label>پیچیدگی طراحی<select data-board-complexity><option value="basic">ساده</option><option value="medium" selected>متوسط</option><option value="advanced">پیشرفته</option></select></label>
      <label>تعداد (عدد)<input data-board-quantity type="number" min="1" max="999" value="1"></label>
      <label>نام مشتری<input data-board-customer autocomplete="name"></label>
      <label>شماره تماس<input data-board-phone inputmode="tel" autocomplete="tel"></label>
      <label class="ary-span-2">عنوان پروژه<input data-board-project></label>
      <div class="ary-span-2 ary-board-features">${BOARD_FEATURES.map(([key, label]) => `<label class="ary-check"><input type="checkbox" data-board-feature value="${key}"><span>${label}</span></label>`).join('')}</div>
    </div><div data-board-message></div><button type="button" class="ary-submit" data-board-quote>محاسبه برآورد</button><div data-board-result></div></div>`;
    const message = root.querySelector('[data-board-message]');
    const resultHost = root.querySelector('[data-board-result]');
    const submit = root.querySelector('[data-board-quote]');
    let pendingBoard = null;
    let lastBoard = null;

    function buildBoardPayload() {
      return {
        width_mm: Number(root.querySelector('[data-board-width]').value || 0),
        height_mm: Number(root.querySelector('[data-board-height]').value || 0),
        power_w: Number(root.querySelector('[data-board-power]').value || 0),
        layers: Number(root.querySelector('[data-board-layers]').value),
        complexity: root.querySelector('[data-board-complexity]').value,
        features: [...root.querySelectorAll('[data-board-feature]:checked')].map((item) => item.value),
        quantity: Number(root.querySelector('[data-board-quantity]').value || 1),
        customer_name: root.querySelector('[data-board-customer]').value,
        customer_phone: root.querySelector('[data-board-phone]').value,
        project_title: root.querySelector('[data-board-project]').value,
      };
    }

    function boardLinesHtml(result) {
      return `<div class="ary-table-wrap"><table class="ary-technical-table"><thead><tr><th>شرح</th><th>مبلغ برآورد</th></tr></thead><tbody>${(result.lines || []).map((line) => `<tr><td>${esc(line.label)}</td><td>${toman(line.amount_rial)}</td></tr>`).join('')}<tr><td><b>جمع بهای برآورد</b></td><td><b>${toman(result.total_rial)}</b></td></tr></tbody></table></div>`;
    }

    submit.addEventListener('click', async () => {
      message.innerHTML = '';
      const payload = buildBoardPayload();
      if (!payload.width_mm || !payload.height_mm || !payload.customer_name || !payload.customer_phone || !payload.project_title) {
        message.innerHTML = '<p class="ary-error">ابعاد برد، نام مشتری، شماره تماس و عنوان پروژه را کامل کنید.</p>';
        return;
      }
      submit.disabled = true; submit.textContent = 'در حال محاسبه امن…';
      try {
        const data = await request(config.boardQuoteUrl, { method: 'POST', body: JSON.stringify({ payload }) });
        pendingBoard = payload;
        lastBoard = { ...data, createdAt: new Date().toISOString() };
        const result = data.result || {};
        const sale = result.sale || { quantity: payload.quantity, profit_percent: null, unit_sale_rial: result.total_rial, total_sale_rial: (result.total_rial || 0) * Math.max(1, payload.quantity) };
        resultHost.innerHTML = `<div class="ary-result-groups"><section class="ary-result-category"><div class="ary-category-title"><i>۱</i><div><h3>برآورد طراحی برد</h3><small>${numberFa(result.area_cm2, 1)} cm² · ${esc({ basic: 'ساده', medium: 'متوسط', advanced: 'پیشرفته' }[payload.complexity] || '')}</small></div></div><div class="ary-summary-grid"><div><small>قیمت هر عدد</small><b>${toman(sale.unit_sale_rial)}</b></div><div><small>تعداد</small><b>${numberFa(sale.quantity, 0)} عدد</b></div><div class="total"><small>مبلغ کل</small><strong>${toman(sale.total_sale_rial)}</strong></div></div>${boardLinesHtml(result)}<p class="ary-board-note">این قیمت یک برآورد تقریبی برای طراحی شماست؛ سفارش شما پس از ثبت و بررسی به قیمت دقیق و زمان دقیق اطلاع داده می‌شود.</p></section><div class="ary-final-zone"><div class="ary-confirm-zone"><p>پس از تأیید، قیمت دوباره در سرور بررسی و درخواست در سامانه آریامن ثبت می‌شود.</p><div class="ary-confirm-totals"><div><small>تعداد سفارش</small><b>${numberFa(sale.quantity, 0)} عدد</b></div><div><small>قیمت هر واحد</small><b>${toman(sale.unit_sale_rial)}</b></div><div><small>قیمت کل</small><strong>${toman(sale.total_sale_rial)}</strong></div></div><p class="ary-error" data-board-confirm-error hidden></p><button type="button" class="ary-confirm" data-board-confirm>تأیید نهایی و ثبت درخواست</button></div></div></div>`;
        resultHost.querySelector('[data-board-confirm]').addEventListener('click', async (event) => {
          const confirmButton = event.currentTarget;
          const confirmError = resultHost.querySelector('[data-board-confirm-error]');
          const showError = (text) => { if (confirmError) { confirmError.textContent = text; confirmError.hidden = false; } message.innerHTML = `<p class="ary-error">${esc(text)}</p>`; };
          confirmButton.disabled = true; confirmButton.textContent = 'در حال ثبت نهایی…';
          try {
            const confirmed = await request(config.boardConfirmUrl, { method: 'POST', body: JSON.stringify({ payload: pendingBoard }) });
            const zone = resultHost.querySelector('.ary-confirm-zone');
            zone.innerHTML = `<div class="ary-confirmed"><b>درخواست با موفقیت ثبت شد</b><span>کد پیگیری: ${esc(confirmed.quote_code)}</span></div><button type="button" class="ary-pdf" data-board-print>دریافت خروجی PDF برآورد برد</button><button type="button" class="ary-cart-btn" data-board-add-cart>افزودن به سبد و پرداخت</button>`;
            const boardCartButton = zone.querySelector('[data-board-add-cart]');
            if (boardCartButton) boardCartButton.addEventListener('click', async () => {
              if (!config.woocommerce) { showError('برای پرداخت آنلاین، افزونه WooCommerce باید روی سایت فعال باشد. پس از فعال‌سازی، در تنظیمات افزونه «شناسه محصول» را وارد و ارز فروشگاه را ریال یا تومان بگذارید.'); return; }
              boardCartButton.disabled = true;
              try {
                const cart = await request(config.cartUrl, { method: 'POST', headers: { 'X-WP-Nonce': config.nonce }, body: JSON.stringify({ quote_id: confirmed.quote_id }) });
                window.location.href = cart.cart_url;
              } catch (error) { showError(error.message); boardCartButton.disabled = false; }
            });
            zone.querySelector('[data-board-print]').addEventListener('click', () => {
              window.AryReportLogo = `${(window.AriamanCalculatorConfig || {}).pluginUrl || ''}assets/aryaman-report-logo.png`;
              const html = window.AryReportBuildBoard({ code: confirmed.quote_code, projectTitle: pendingBoard.project_title, customerName: pendingBoard.customer_name, model: pendingBoard, result: (lastBoard || {}).result || {} });
              openReportInPage(html, `برآورد برد — ${confirmed.quote_code}`);
            });
          } catch (error) { showError(error.message); confirmButton.disabled = false; confirmButton.textContent = 'تأیید نهایی و ثبت درخواست'; }
        });
      } catch (error) { message.innerHTML = `<p class="ary-error">${esc(error.message)}</p>`; resultHost.innerHTML = ''; pendingBoard = null; }
      finally { submit.disabled = false; submit.textContent = 'محاسبه برآورد'; }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-aryaman-calculator]').forEach(async (root) => {
      try { const data = await request(config.catalogUrl); renderApp(root, data.catalog || {}); }
      catch (error) { root.innerHTML = `<div class="ary-disabled"><b>محاسبه‌گر عمومی در دسترس نیست</b><span>${esc(error.message)}</span></div>`; }
    });
    document.querySelectorAll('[data-aryaman-board]').forEach((root) => renderBoardApp(root));
  });
})();
