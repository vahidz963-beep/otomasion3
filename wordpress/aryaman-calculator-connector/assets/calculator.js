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

  function windingRow(index, wires, maxPin) {
    const pinOptions = (selected) => Array.from({ length: maxPin }, (_, pin) => `<option value="${pin + 1}" ${pin + 1 === selected ? 'selected' : ''}>${numberFa(pin + 1)}</option>`).join('');
    const wireOptions = wires.map((wire) => `<option value="${esc(wire.id)}">${numberFa(wire.diameter_mm, 2)} mm${wire.awg ? ` (AWG ${esc(wire.awg)})` : ''}</option>`).join('');
    const startPin = Math.min(maxPin, index * 2 + 1);
    const endPin = Math.min(maxPin, index * 2 + 2);
    return `<div class="ary-winding" data-winding><div class="ary-winding__head"><b>سیم‌پیچ ${numberFa(index + 1)}</b><button type="button" data-remove-winding aria-label="حذف">×</button></div><label>نام<input data-key="name" value="${index === 0 ? 'اولیه' : index === 1 ? 'ثانویه' : `سیم‌پیچ ${index + 1}`}"></label><label>پایه شروع<select data-key="start_pin">${pinOptions(startPin)}</select></label><label>پایه پایان<select data-key="end_pin">${pinOptions(endPin)}</select></label><label>تعداد دور<input data-key="turns" type="number" min="1" value="${index === 0 ? 100 : 20}"></label><label>سیم<select data-key="wire_id">${wireOptions}</select></label><label>رشته<input data-key="strands" type="number" min="1" max="20" value="1"></label><label>جهت<select data-key="direction"><option value="cw">ساعتگرد</option><option value="ccw" ${index === 1 ? 'selected' : ''}>پادساعتگرد</option></select></label></div>`;
  }

  function renderApp(root, catalog) {
    const cores = catalog.cores || [];
    const bobbins = catalog.bobbins || [];
    const wires = catalog.wires || [];
    root.innerHTML = `<div class="ary-head"><span>مرکز محاسبه آریامن</span><h2>محاسبه ترانس سفارشی</h2></div><div class="ary-body"><div class="ary-grid"><label>نوع سفارش<select data-order-type><option value="sample">نمونه ۱ تا ۹۹ عدد</option><option value="production">تولید حداقل ۱۰۰ عدد</option></select></label><label>تعداد<input data-quantity type="number" min="1" max="99" value="1"></label><label>مدل هسته<select data-core><option value="">انتخاب هسته</option>${cores.map((core) => `<option value="${esc(core.id)}" ${core.calculable ? '' : 'disabled'}>${esc(core.model_code)}${core.calculable ? '' : ' · نیازمند تکمیل'}</option>`).join('')}</select></label><label>مدل بوبین<select data-bobbin disabled><option value="">ابتدا هسته را انتخاب کنید</option></select></label><label>نام مشتری<input data-customer-name autocomplete="name"></label><label>شماره تماس<input data-customer-phone inputmode="tel" autocomplete="tel"></label><label class="ary-span-2">عنوان پروژه<input data-project></label><label class="ary-check"><input data-gap type="checkbox"><span>هسته دارای گپ است</span></label></div><section class="ary-windings"><div class="ary-section-head"><h3>سیم‌پیچ‌ها</h3><button type="button" data-add-winding>+ افزودن</button></div><div data-windings></div></section><div data-message></div><button type="button" class="ary-submit" data-submit>محاسبه قیمت</button><div data-result></div></div>`;
    const coreSelect = root.querySelector('[data-core]');
    const bobbinSelect = root.querySelector('[data-bobbin]');
    const windingsHost = root.querySelector('[data-windings]');
    const message = root.querySelector('[data-message]');
    const quantity = root.querySelector('[data-quantity]');
    const orderType = root.querySelector('[data-order-type]');
    let windingCount = 0;
    let maxPin = 10;

    function addWinding() {
      if (windingCount >= 12) return;
      const wrap = document.createElement('div');
      wrap.innerHTML = windingRow(windingCount, wires, maxPin);
      windingsHost.appendChild(wrap.firstElementChild);
      windingCount += 1;
    }
    addWinding(); addWinding();

    coreSelect.addEventListener('change', () => {
      const list = bobbins.filter((item) => item.core_id === coreSelect.value);
      bobbinSelect.disabled = !list.length;
      // Product rule: bobbin options display only pin count and orientation.
      bobbinSelect.innerHTML = list.length ? `<option value="">انتخاب بوبین</option>${list.map((item) => `<option value="${esc(item.id)}">${esc(item.pins)} پین · ${esc(item.mount_orientation)}</option>`).join('')}` : '<option value="">بوبین کامل ثبت نشده است</option>';
    });
    bobbinSelect.addEventListener('change', () => {
      const selected = bobbins.find((item) => item.id === bobbinSelect.value);
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
    root.querySelector('[data-add-winding]').addEventListener('click', addWinding);
    windingsHost.addEventListener('click', (event) => {
      if (!event.target.matches('[data-remove-winding]') || windingCount <= 1) return;
      event.target.closest('[data-winding]').remove(); windingCount -= 1;
    });

    root.querySelector('[data-submit]').addEventListener('click', async () => {
      message.innerHTML = '';
      const button = root.querySelector('[data-submit]');
      const rows = [...windingsHost.querySelectorAll('[data-winding]')].map((row) => Object.fromEntries([...row.querySelectorAll('[data-key]')].map((input) => [input.dataset.key, ['start_pin', 'end_pin', 'turns', 'strands'].includes(input.dataset.key) ? Number(input.value) : input.value])));
      const payload = {
        core_id: coreSelect.value,
        bobbin_id: bobbinSelect.value,
        order_type: orderType.value,
        quantity: Number(quantity.value),
        customer_name: root.querySelector('[data-customer-name]').value,
        customer_phone: root.querySelector('[data-customer-phone]').value,
        project_title: root.querySelector('[data-project]').value,
        has_gap: root.querySelector('[data-gap]').checked,
        windings: rows.map((row) => ({ ...row, layer_mode: 'auto', requested_layers: 1 })),
      };
      button.disabled = true; button.textContent = 'در حال محاسبه امن…';
      try {
        const data = await request(config.quoteUrl, { method: 'POST', body: JSON.stringify({ payload }) });
        root.querySelector('[data-result]').innerHTML = `<div class="ary-result"><div><small>کد محاسبه</small><b>${esc(data.quote_code)}</b></div><div><small>قیمت هر عدد</small><b>${toman(data.result.unit_sale_rial)}</b></div><div><small>اشغال پنجره</small><b>${numberFa(data.result.window_occupancy_percent, 1)}٪</b></div><div class="ary-result__total"><small>مبلغ کل</small><strong>${toman(data.result.total_sale_rial)}</strong></div>${config.woocommerce ? '<button type="button" data-add-cart>افزودن سفارش به سبد خرید</button>' : ''}</div>`;
        const cartButton = root.querySelector('[data-add-cart]');
        if (cartButton) cartButton.addEventListener('click', async () => {
          cartButton.disabled = true;
          try {
            const cart = await request(config.cartUrl, { method: 'POST', headers: { 'X-WP-Nonce': config.nonce }, body: JSON.stringify({ quote_id: data.quote_id }) });
            window.location.href = cart.cart_url;
          } catch (error) { message.innerHTML = `<p class="ary-error">${esc(error.message)}</p>`; cartButton.disabled = false; }
        });
      } catch (error) { message.innerHTML = `<p class="ary-error">${esc(error.message)}</p>`; root.querySelector('[data-result]').innerHTML = ''; }
      finally { button.disabled = false; button.textContent = 'محاسبه قیمت'; }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-aryaman-calculator]').forEach(async (root) => {
      try { const data = await request(config.catalogUrl); renderApp(root, data.catalog || {}); }
      catch (error) { root.innerHTML = `<div class="ary-disabled"><b>محاسبه‌گر عمومی در دسترس نیست</b><span>${esc(error.message)}</span></div>`; }
    });
  });
})();
