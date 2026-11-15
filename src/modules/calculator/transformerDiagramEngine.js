const TransformerDiagram = (function () {
  'use strict';

  var G = {
    pinSpacing: 58, minInterior: 170, coreTop: 100, coreLeft: 45, coreWidth: 350, coreRadius: 18,
    labelMargin: 90, pinInset: 34, coilOffset: 55, nestStep: 27.5, loopStep: 15, bulge: 13,
    titleGap: 30, pinDotR: 4.5, pinLabelGap: 13, gridStep: 3, pad: 3
  };
  var COLOR = { ink: '#16325c', paper: '#fbfaf6', accent: '#c1440e', muted: '#7f9cd6' };
  /* پالت سیم‌پیچ: آبی و مشکی — تم رسمی. همه سیم‌پیچ‌ها آبی؛ فقط سیم‌پیچ‌های
     هم‌پوشان/درهم برای تفکیک، سایه‌های تیره‌تر/روشن‌تر آبی یا مشکی می‌گیرند. */
  /* طیف مشکی تا آبی روشن — سیم‌پیچ‌های هم‌پوشان با حداکثر تفاوت رنگ */
  var WIRE_PALETTE = ['#0b0b0f', '#2e7bf6', '#132f5c', '#7fb3f9', '#4a86e8', '#0a4a8f'];
  var LIMITS = { maxPinsPerSide: 30, maxWindings: 12 };
  var FONT = "Arial, Tahoma, sans-serif";

  function f(n) { return (Math.round(n * 100) / 100).toString(); }

  function digitLatin(s) {
    return String(s).replace(/[\u06F0-\u06F9]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); })
                    .replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); });
  }
  function parsePins(str) {
    var m = /^\s*(\d+)\s*\+\s*(\d+)\s*$/.exec(String(str || ''));
    return m ? { left: parseInt(m[1], 10), right: parseInt(m[2], 10) } : null;
  }
  function validatePins(left, right) {
    var errs = [];
    if (!Number.isInteger(left) || left < 1 || left > LIMITS.maxPinsPerSide) errs.push('تعداد پایه‌های سمت چپ باید بین ۱ و ' + LIMITS.maxPinsPerSide + ' باشد.');
    if (!Number.isInteger(right) || right < 1 || right > LIMITS.maxPinsPerSide) errs.push('تعداد پایه‌های سمت راست باید بین ۱ و ' + LIMITS.maxPinsPerSide + ' باشد.');
    return errs;
  }
  function pinSide(num, left) { return num <= left ? 'left' : 'right'; }

  function validateWindings(windings, left, right, allowCrossSide) {
    var total = left + right, valid = [], errors = [];
    if (windings.length > LIMITS.maxWindings) errors.push({ message: 'حداکثر ' + LIMITS.maxWindings + ' سیم‌پیچ مجاز است.' });
    windings.forEach(function (w, i) {
      var idx = i + 1, msgs = [];
      var s = w.start, e = w.end;
      if (!Number.isInteger(s) || !Number.isInteger(e)) msgs.push('پایه شروع و پایان را انتخاب کنید.');
      else if (s < 1 || s > total || e < 1 || e > total) msgs.push('پایه‌ها باید بین ۱ و ' + total + ' باشند.');
      else if (s === e) msgs.push('پایه شروع و پایان نباید یکی باشند.');
      else if (!allowCrossSide && pinSide(s, left) !== pinSide(e, left)) msgs.push('شروع و پایان باید در یک سمت باشند.');
      var t = Number(w.turns || 0);
      if (!Number.isInteger(t) || t < 0) msgs.push('تعداد دور باید عدد صحیح و غیرمنفی باشد.');
      if (msgs.length) errors.push({ index: idx, message: 'سیم‌پیچ ' + idx + ': ' + msgs.join(' ') });
      else valid.push({
        index: idx, name: w.name || ('Winding ' + idx), start: s, end: e, turns: t,
        wire: String(w.wire || '0.25').trim(),
        strand: Math.max(1, parseInt(w.strand, 10) || 1),
        layer: Math.max(1, parseInt(w.layer, 10) || 1),
        direction: String(w.direction || 'CW'),
        insulation: String(w.insulation || '3').trim()
      });
    });
    return { valid: valid, errors: errors };
  }

  function pathOp(d, o) { return { t: 'path', d: d, stroke: o.stroke || null, fill: o.fill || null, width: o.width || 1, cap: o.cap || 'butt', dash: o.dash || null }; }
  function circleOp(x, y, r, o) { return { t: 'circle', x: x, y: y, r: r, fill: o.fill || null, stroke: o.stroke || null, width: o.width || 1 }; }
  function textOp(x, y, s, o) { return { t: 'text', x: x, y: y, s: digitLatin(s), size: o.size || 15, weight: o.weight || 400, color: o.color || COLOR.ink, align: o.align || 'start', halo: o.halo !== false, font: o.font || FONT }; }

  function roundRectD(x, y, w, h, r) {
    return 'M ' + f(x + r) + ' ' + f(y) + ' L ' + f(x + w - r) + ' ' + f(y) +
      ' A ' + r + ' ' + r + ' 0 0 1 ' + f(x + w) + ' ' + f(y + r) + ' L ' + f(x + w) + ' ' + f(y + h - r) +
      ' A ' + r + ' ' + r + ' 0 0 1 ' + f(x + w - r) + ' ' + f(y + h) + ' L ' + f(x + r) + ' ' + f(y + h) +
      ' A ' + r + ' ' + r + ' 0 0 1 ' + f(x) + ' ' + f(y + h - r) + ' L ' + f(x) + ' ' + f(y + r) +
      ' A ' + r + ' ' + r + ' 0 0 1 ' + f(x + r) + ' ' + f(y) + ' Z';
  }

  function coilVertical(x, yTop, yBottom, dir) {
    var span = Math.max(24, yBottom - yTop), loops = Math.max(2, Math.round(span / G.loopStep)), step = span / loops, b = G.bulge * dir;
    var d = 'M ' + f(x) + ' ' + f(yTop);
    for (var i = 0; i < loops; i++) {
      var s = yTop + i * step, e = yTop + (i + 1) * step;
      d += ' C ' + f(x + b) + ' ' + f(s + step * 0.28) + ' ' + f(x + b) + ' ' + f(s + step * 0.72) + ' ' + f(x) + ' ' + f(e);
    }
    return { d: d };
  }
  function coilHorizontal(xL, xR, y, dirY) {
    var span = Math.max(24, xR - xL), loops = Math.max(2, Math.round(span / G.loopStep)), step = span / loops, b = G.bulge * dirY;
    var d = 'M ' + f(xL) + ' ' + f(y);
    for (var i = 0; i < loops; i++) {
      var s = xL + i * step, e = xL + (i + 1) * step;
      d += ' C ' + f(s + step * 0.28) + ' ' + f(y + b) + ' ' + f(s + step * 0.72) + ' ' + f(y + b) + ' ' + f(e) + ' ' + f(y);
    }
    return { d: d };
  }

  function rect(x1, y1, x2, y2) { return { x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2) }; }
  function hit(a, b, pad) { pad = pad || 0; return a.x1 - pad < b.x2 && b.x1 - pad < a.x2 && a.y1 - pad < b.y2 && b.y1 - pad < a.y2; }

  /* برچسب یک‌خطی روی/کنار کویل — عرض تقریبی برای برخورد */
  function labelVariant(cx, cy, text, color, rotate) {
    var w = text.length * 8.4 + 6;
    if (rotate) {
      /* متن عمودی: کادر برخورد محور-چرخیده؛ متن حول مرکز خودش ۹۰ درجه می‌چرخد */
      return { rect: rect(cx - 9, cy - w / 2, cx + 9, cy + w / 2), ops: [textOp(cx, cy, text, { size: 13, weight: 700, color: color, align: 'middle' }), { t: 'rotate', deg: rotate, cx: cx, cy: cy }] };
    }
    return { rect: rect(cx - w / 2, cy - 10, cx + w / 2, cy + 4), ops: [textOp(cx, cy + 4, text, { size: 13, weight: 700, color: color, align: 'middle' })] };
  }

  function buildScene(config) {
    var left = config.left, right = config.right, total = left + right;
    var pinErrs = validatePins(left, right);
    if (pinErrs.length) return { width: 0, height: 0, ops: [], errors: pinErrs.map(function (m) { return { message: m }; }), windings: [], pins: {} };

    var allowCross = !!config.allowCrossSide;
    var wRes = validateWindings(config.windings || [], left, right, allowCross);
    var windings = wRes.valid;

    var leftH = left > 1 ? G.pinSpacing * (left - 1) : G.pinSpacing * 0.6;
    var rightH = right > 1 ? G.pinSpacing * (right - 1) : G.pinSpacing * 0.6;
    var interior = Math.max(leftH, rightH, G.minInterior);
    var coreTop = G.coreTop, coreBottom = coreTop + interior + 60;
    var coreLeft = G.coreLeft + G.labelMargin, coreRight = coreLeft + G.coreWidth, midX = (coreLeft + coreRight) / 2;

    var height = coreBottom + 70;
    var width = coreRight + G.labelMargin;

    var ops = [];
    var view = config.view === 'bottom' ? 'From the bottom view' : 'From the top view';
    ops.push(textOp(midX, coreTop - G.titleGap, config.title || view, { size: 22, weight: 600, align: 'middle' }));
    ops.push(pathOp(roundRectD(coreLeft, coreTop, G.coreWidth, coreBottom - coreTop, G.coreRadius), { stroke: COLOR.ink, width: 2.5 }));
    ops.push(pathOp('M ' + f(midX - 6) + ' ' + f(coreTop + 16) + ' L ' + f(midX - 6) + ' ' + f(coreBottom - 16), { stroke: COLOR.ink, width: 2 }));
    ops.push(pathOp('M ' + f(midX + 6) + ' ' + f(coreTop + 16) + ' L ' + f(midX + 6) + ' ' + f(coreBottom - 16), { stroke: COLOR.ink, width: 2 }));

    var obstacles = [
      rect(midX - 8, coreTop + 12, midX + 8, coreBottom - 12)
    ];

    var leftStartY = coreTop + 30 + (interior - leftH) / 2, rightStartY = coreTop + 30 + (interior - rightH) / 2;
    var leftPinX = coreLeft + G.pinInset, rightPinX = coreRight - G.pinInset;
    var coilXLeft = leftPinX + G.coilOffset, coilXRight = rightPinX - G.coilOffset;

    /* رنگ هر سیم‌پیچ: سیم‌پیچ‌های هم‌پوشان روی یک سمت، رنگ‌های متفاوت می‌گیرند.
       تناوب پالت: رنگ پیش‌فرض آبی رسمی؛ هم‌پوشانی دوم رنگ دوم و ... */
    var usedBySide = { left: [], right: [] };
    function pickColor(side, yTop, yBottom) {
      var overlapping = usedBySide[side].filter(function (e) { return Math.max(e.yTop, yTop) < Math.min(e.yBottom, yBottom) - 1; });
      var slot = overlapping.length;
      usedBySide[side].push({ yTop: yTop, yBottom: yBottom, slot: slot });
      return WIRE_PALETTE[slot % WIRE_PALETTE.length];
    }

    var pins = {};
    for (var k = 0; k < left; k++) pins[k + 1] = { x: leftPinX, y: left > 1 ? leftStartY + leftH * (k / (left - 1)) : leftStartY + leftH / 2, side: 'left' };
    for (var j = 0; j < right; j++) pins[total - j] = { x: rightPinX, y: right > 1 ? rightStartY + rightH * (j / (right - 1)) : rightStartY + rightH / 2, side: 'right' };
    for (var n = 1; n <= total; n++) {
      var p = pins[n];
      ops.push(circleOp(p.x, p.y, G.pinDotR, { fill: COLOR.ink, stroke: COLOR.ink, width: 1.2 }));
      /* فاصلهٔ کامل نقطه↔عدد: عدد از لبهٔ نقطه حداقل labelGap فاصله دارد */
      var nx = p.side === 'left' ? p.x - G.pinLabelGap : p.x + G.pinLabelGap;
      ops.push(textOp(nx, p.y + 5, n, { size: 16, align: p.side === 'left' ? 'end' : 'start', halo: false }));
      obstacles.push(rect(p.x - 6, p.y - 6, p.x + 6, p.y + 6));
      obstacles.push(p.side === 'left' ? rect(p.x - 34, p.y - 10, p.x - 10, p.y + 7) : rect(p.x + 10, p.y - 10, p.x + 34, p.y + 7));
    }

    var placed = { left: [], right: [] };
    var wireOps = [], labelJobs = [], markOps = [];
    var nPlacements = [];
    var leadRows = { left: [], right: [] }; /* ردیف‌های افقی سیم در هر سمت — برچسب‌ها نباید روی‌شان بنشینند */
    var crossCoils = []; /* نوار کویل افقی دوسمتی‌ها — مانع برای برچسب‌های هر دو سمت */

    function strokeFor(color) { return { stroke: color, width: 2.4, cap: 'round' }; }
    function seg(x1, y1, x2, y2) { obstacles.push(rect(x1 - 2.5, y1 - 2.5, x2 + 2.5, y2 + 2.5)); }

    var nestCount = { left: 0, right: 0 };
    windings.forEach(function (w) {
      var sS = pinSide(w.start, left), sE = pinSide(w.end, left);
      var pS = pins[w.start], pE = pins[w.end];

      if (sS === sE) {
        var side = sS;
        var yTop = Math.min(pS.y, pE.y), yBottom = Math.max(pS.y, pE.y);
        var list = placed[side];
        var overlap = list.filter(function (e) { return Math.max(e.yTop, yTop) < Math.min(e.yBottom, yBottom) - 1; });
        var nest = overlap.length ? 1 + Math.max.apply(null, overlap.map(function (e) { return e.nest; })) : 0;
        var baseX = side === 'left' ? coilXLeft : coilXRight;
        var coilX = side === 'left' ? baseX + nest * G.nestStep : baseX - nest * G.nestStep;
        list.push({ yTop: yTop, yBottom: yBottom, nest: nest, coilX: coilX });
        var dir = side === 'left' ? 1 : -1;
        var wireColor = pickColor(side, yTop, yBottom);

        wireOps.push(pathOp('M ' + f(pS.x) + ' ' + f(pS.y) + ' L ' + f(coilX) + ' ' + f(pS.y), strokeFor(wireColor)));
        wireOps.push(pathOp('M ' + f(coilX) + ' ' + f(pE.y) + ' L ' + f(pE.x) + ' ' + f(pE.y), strokeFor(wireColor)));
        seg(Math.min(pS.x, coilX), pS.y, Math.max(pS.x, coilX), pS.y);
        seg(Math.min(pE.x, coilX), pE.y, Math.max(pE.x, coilX), pE.y);
        wireOps.push(pathOp(coilVertical(coilX, yTop, yBottom, dir).d, strokeFor(wireColor)));
        obstacles.push(dir > 0 ? rect(coilX - 3, yTop - 4, coilX + G.bulge + 3, yBottom + 4) : rect(coilX - G.bulge - 3, yTop - 4, coilX + 3, yBottom + 4));

        var startTop = pS.y <= pE.y;
        var mx = coilX - dir * 10, my = startTop ? yTop + 8 : yBottom - 8;
        markOps.push(circleOp(mx, my, 4.3, { fill: COLOR.ink, stroke: COLOR.ink, width: 1.2 }));
        obstacles.push(rect(mx - 5, my - 5, mx + 5, my + 5));

        /* برچسب‌ها قطعی و همیشه نمایش‌داده‌شده:
           N — افقی، در فاصلهٔ بین پایه و کویل همان سیم‌پیچ (وسط ارتفاع کویل)
           تعداد دور — عمودی (چرخیده ۹۰°)، وسط ارتفاع همان کویل، کنار قوس‌های کویل */
        leadRows[side].push({ y: pS.y, x2: Math.max(pS.x, coilX) }, { y: pE.y, x2: Math.max(pE.x, coilX) });
        var midC = (yTop + yBottom) / 2;
        /* N همیشه در ستون مشترک «وسط فاصلهٔ پایه تا بیرونی‌ترین کویل» — هیچ‌وقت روی خط کویل سیم‌پیچ دیگر نمی‌نشیند */
        var numX = (pS.x + baseX) / 2;
        /* تعداد دور: عمودی وسط ارتفاع کویل خودش — اندازه/فاصلهٔ نهایی در حلال پس‌پردازشی */
        nPlacements.push({ side: side, y: midC + 5, spanTop: yTop, spanBottom: yBottom, numX: numX, index: w.index,
          coilX: coilX, dir: dir, pinX: pS.x, baseX: baseX, turnsY: midC, turnsText: w.turns > 0 ? w.turns + 'T' : null });
        return;
      }

      /* سیم‌پیچ دوسمتی: کویل افقی داخل پنجره */
      var pL = sS === 'left' ? pS : pE, pR = sS === 'left' ? pE : pS;
      var startIsLeft = sS === 'left';
      var yMid = (pL.y + pR.y) / 2;
      var xL = coilXLeft, xR = coilXRight;
      var wireColor2 = pickColor('left', yMid - 1, yMid + 1);
      var ch = coilHorizontal(xL, xR, yMid, -1);
      wireOps.push(pathOp('M ' + f(pL.x) + ' ' + f(pL.y) + ' L ' + f(xL) + ' ' + f(pL.y) + ' L ' + f(xL) + ' ' + f(yMid), strokeFor(wireColor2)));
      wireOps.push(pathOp('M ' + f(xR) + ' ' + f(yMid) + ' L ' + f(xR) + ' ' + f(pR.y) + ' L ' + f(pR.x) + ' ' + f(pR.y), strokeFor(wireColor2)));
      wireOps.push(pathOp(ch.d, strokeFor(wireColor2)));
      seg(pL.x, pL.y, xL, pL.y); seg(xL, Math.min(pL.y, yMid), xL, Math.max(pL.y, yMid));
      seg(xR, Math.min(pR.y, yMid), xR, Math.max(pR.y, yMid)); seg(xR, pR.y, pR.x, pR.y);
      obstacles.push(rect(xL - 3, yMid - G.bulge - 3, xR + 3, yMid + 3));
      leadRows[sS === 'left' ? 'left' : 'right'].push({ y: pL.y, x2: Math.max(pL.x, xL) });
      leadRows[sS === 'left' ? 'right' : 'left'].push({ y: pR.y, x2: Math.max(pR.x, xR) });
      crossCoils.push({ xL: xL, xR: xR, yTop: yMid - G.bulge, yBot: yMid });
      var mxc = startIsLeft ? xL - 10 : xR + 10, myc = yMid + 10;
      markOps.push(circleOp(mxc, myc, 4.3, { fill: COLOR.ink, stroke: COLOR.ink, width: 1.2 }));
      obstacles.push(rect(mxc - 5, myc - 5, mxc + 5, myc + 5));
      /* برچسب دوسمتی: N زیر کویل، تعداد دور عمودی بالای قوس‌های کویل — هر دو از ستون میانی و کویل‌های سمت‌ها دور */
      var nY2 = yMid + G.bulge + 22;
      function stripFree(x, y, halfW, halfH, sideList, dirSign) {
        return !sideList.some(function (en) {
          var sx1 = dirSign > 0 ? en.coilX - 2 : en.coilX - G.bulge - 2;
          var sx2 = dirSign > 0 ? en.coilX + G.bulge + 2 : en.coilX + 2;
          return x + halfW > sx1 && sx2 > x - halfW && en.yTop - 4 < y + halfH && en.yBottom + 4 > y - halfH;
        });
      }
      var nX2 = [xL + 40, midX + 50, xR - 55].find(function (cx) { return stripFree(cx, nY2, 12, 9, placed.left, 1); }) || xL + 40;
      ops.push(textOp(nX2, nY2, 'N' + w.index, { size: 14, weight: 700, color: COLOR.accent, align: 'middle', halo: true }));
      if (w.turns > 0) {
        var tTxt2 = w.turns + 'T';
        var tHH2 = tTxt2.length * 13 * 0.62 / 2 + 2;
        var tY2 = yMid - G.bulge - 4 - tHH2;
        var tX2 = [xR - 40, midX - 50, xL + 55].find(function (cx) { return stripFree(cx, tY2, 7, tHH2, placed.right, -1); }) || xR - 40;
        ops.push({ t: 'rotate', deg: -90, cx: tX2, cy: tY2 });
        ops.push(textOp(tX2, tY2, tTxt2, { size: 13, weight: 700, color: COLOR.ink, align: 'middle', halo: true }));
        ops.push({ t: 'rotate', deg: 0, cx: tX2, cy: tY2 });
      }
    });

    /* جای‌گذاری قطعی برچسب‌ها (پس‌پردازش با دید کامل همهٔ سیم‌پیچ‌ها):
       N — ستون مشترک هر سمت؛ span یکسان → جابه‌جایی افقی؛ y با اجتناب از برچسب‌ها و ردیف سیم‌ها
       تعداد دور — عمودی وسط کویل خودش؛ کویل عمیق در کریدور → فونت ۱۰ و نزدیک‌تر؛ ستون میانی → کلامپ */
    ['left', 'right'].forEach(function (side) {
      var rows = leadRows[side].filter(function (v, i, a) { return a.indexOf(v) === i; });
      var fullList = placed[side];
      var items = nPlacements.filter(function (np) { return np.side === side; })
        .sort(function (a, b) { return (b.spanBottom - b.spanTop) - (a.spanBottom - a.spanTop); });

      /* span یکسان (هم‌مرکز) → اولی لبهٔ پایه، دومی لبهٔ کویل، بقیه روی ستون میانی با فاصلهٔ عمودی ۲۰px — هیچ‌کدام حذف نمی‌شوند */
      var spanGroups = {};
      items.forEach(function (np) { var k = np.spanTop + '_' + np.spanBottom; (spanGroups[k] = spanGroups[k] || []).push(np); });
      Object.keys(spanGroups).forEach(function (k) {
        var arr = spanGroups[k];
        if (arr.length < 2) return;
        var midY = (arr[0].spanTop + arr[0].spanBottom) / 2 + 5;
        arr.forEach(function (np, i) {
          var minX = np.dir > 0 ? np.pinX + 17.5 : np.baseX + 14;
          var maxX = np.dir > 0 ? np.baseX - 14 : np.pinX - 17.5;
          if (i === 0) np.numX = minX;
          else if (i === 1) np.numX = maxX;
          else {
            np.numX = (minX + maxX) / 2;
            var step = Math.ceil((i - 1) / 2);
            np.y = midY + (i % 2 ? 1 : -1) * step * 20;
          }
        });
      });

      /* ---- N: ستون‌بندی و تفکیق عمودی در هر ستون ---- */
      var nCols = {};
      items.forEach(function (np) { var k = Math.round(np.numX); (nCols[k] = nCols[k] || []).push(np); });
      Object.keys(nCols).forEach(function (k) {
        var arr = nCols[k].sort(function (a, b) { return (b.spanBottom - b.spanTop) - (a.spanBottom - a.spanTop); });
        var takenY = [];
        arr.forEach(function (np) {
          var y = np.y;
          var lo = np.spanTop + 14, hi = np.spanBottom - 14;
          if (hi < lo) { lo = np.spanTop + 10; hi = np.spanBottom - 6; }
          function clash(yy) {
            if (takenY.some(function (ty) { return Math.abs(ty - yy) < 20; })) return true;
            if (rows.some(function (r) { return Math.abs(r.y - yy) < 13; })) return true;
            return false;
          }
          if (clash(y)) {
            var best = null;
            for (var d = 6; d <= Math.max(y - lo, hi - y) + 6; d += 6) {
              if (y - d >= lo && !clash(y - d)) { best = y - d; break; }
              if (y + d <= hi && !clash(y + d)) { best = y + d; break; }
            }
            if (best === null) {
              var lo2 = np.spanTop - 10, hi2 = np.spanBottom + 10;
              for (var d2 = 6; d2 <= Math.max(y - lo2, hi2 - y) + 6; d2 += 6) {
                if (y - d2 >= lo2 && !clash(y - d2)) { best = y - d2; break; }
                if (y + d2 <= hi2 && !clash(y + d2)) { best = y + d2; break; }
              }
            }
            if (best !== null) y = best; /* پناه نهایی: همیشه نوشته می‌شود */
          }
          takenY.push(y);
          np.finalY = y;
        });
      });
      /* ---- پاس نهایی دوبعدی: هر برچسب در برابر برچسب‌های دیگر، کویل‌ها، نشانه‌ها، ردیف سیم‌ها،
         کویل افقی دوسمتی و ستون میانی سنجیده می‌شود؛ گزینه‌های قطعی به ترتیب اولویت؛ هیچ برچسبی حذف نمی‌شود ---- */
      var coreLeftF = midX - G.coreWidth / 2, coreRightF = midX + G.coreWidth / 2;
      var obs = [];
      fullList.forEach(function (en) {
        var s1 = side === 'left' ? en.coilX - 1.5 : en.coilX - G.bulge - 1.5;
        var s2 = side === 'left' ? en.coilX + G.bulge + 1.5 : en.coilX + 1.5;
        obs.push({ x1: s1, x2: s2, y1: en.yTop - 2, y2: en.yBottom + 2 });
        obs.push({ x1: en.coilX - 15.5, x2: en.coilX - 4.5, y1: en.yTop + 3, y2: en.yTop + 13 });
        obs.push({ x1: en.coilX - 15.5, x2: en.coilX - 4.5, y1: en.yBottom - 13, y2: en.yBottom - 3 });
      });
      obs.push({ x1: midX - 8, x2: midX + 8, y1: -1e6, y2: 1e6 });
      rows.forEach(function (r) { obs.push({ x1: coreLeftF + G.pinInset - 6, x2: (r.x2 || midX) + 1.5, y1: r.y - 1.5, y2: r.y + 1.5 }); });
      crossCoils.forEach(function (cc) { obs.push({ x1: cc.xL - 1.5, x2: cc.xR + 1.5, y1: cc.yTop - 1.5, y2: cc.yBot + 1.5 }); });

      function hitR(a, b) { return a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2; }
      function tRect(x, y, np) {
        var size = np.turnsSize || 13, hh = np.turnsText.length * size * 0.62 / 2 + 2;
        return { x1: x - size / 2 - 1.2, x2: x + size / 2 + 1.2, y1: y - hh, y2: y + hh };
      }
      function nRect(x, y) { return { x1: x - 10, x2: x + 10, y1: y - 9, y2: y + 9 }; }

      var lab = [];
      items.forEach(function (np) {
        lab.push({ np: np, kind: 'n', prio: 2000 + (np.spanBottom - np.spanTop) });
        if (np.turnsText) lab.push({ np: np, kind: 't', prio: (np.spanBottom - np.spanTop) });
      });
      lab.sort(function (a, b) { return b.prio - a.prio; });
      var takenR = [];
      function freeR(r) {
        var i;
        for (i = 0; i < takenR.length; i++) if (hitR(r, takenR[i])) return false;
        for (i = 0; i < obs.length; i++) if (hitR(r, obs[i])) return false;
        return true;
      }
      var DY = [0, 6, -6, 12, -12, 18, -18, 24, -24, 30, -30, 36, -36, 42, -42, 48, -48, 54, -54, 60, -60];
      lab.forEach(function (L) {
        var np = L.np, xs, ys, mk, cTop, cBot;
        if (L.kind === 'n') {
          var minX = np.dir > 0 ? np.pinX + 18 : np.baseX + 15;
          var maxX = np.dir > 0 ? np.baseX - 15 : np.pinX - 18;
          xs = [np.numX, (minX + maxX) / 2, minX, maxX].filter(function (x, i, a) { return a.indexOf(x) === i; });
          ys = DY.map(function (d) { return np.finalY + d; });
          mk = nRect; cTop = np.spanTop - 12; cBot = np.spanBottom + 12;
        } else {
          var size = np.turnsSize || 13, hw2 = size / 2 + 1.2;
          xs = [np.turnsX, np.coilX + np.dir * (G.bulge + 12), np.coilX + np.dir * 20.25, np.coilX - np.dir * (7.75 + hw2), np.coilX + np.dir * 47.75, np.coilX + np.dir * 55]
            .filter(function (x, i, a) { return a.indexOf(x) === i; })
            .filter(function (x) {
              if (x - hw2 < midX + 8 && x + hw2 > midX - 8) return false; /* ستون میانی */
              var inOwn = np.dir > 0 ? (x - hw2 < np.coilX + G.bulge + 0.8 && x + hw2 > np.coilX - 0.8)
                                     : (x - hw2 < np.coilX + 0.8 && x + hw2 > np.coilX - G.bulge - 0.8);
              return !inOwn;
            });
          ys = DY.map(function (d) { return np.turnsFinalY + d; });
          mk = function (x, y) { return tRect(x, y, np); };
          cTop = np.spanTop - 4; cBot = np.spanBottom + 4;
        }
        var ok = false;
        for (var yi = 0; yi < ys.length && !ok; yi++) {
          if (ys[yi] < cTop || ys[yi] > cBot) continue;
          for (var xi = 0; xi < xs.length && !ok; xi++) {
            var r = mk(xs[xi], ys[yi]);
            if (r.x1 < coreLeftF + 2 || r.x2 > coreRightF - 2) continue;
            if (freeR(r)) {
              takenR.push(r);
              if (L.kind === 'n') { np.numX = xs[xi]; np.finalY = ys[yi]; } else { np.turnsX = xs[xi]; np.turnsFinalY = ys[yi]; }
              ok = true;
            }
          }
        }
        if (!ok) takenR.push(L.kind === 'n' ? nRect(np.numX, np.finalY) : tRect(np.turnsX, np.turnsFinalY, np)); /* پناه نهایی: همیشه نوشته می‌شود */
      });

      items.forEach(function (np) {
        ops.push(textOp(np.numX, np.finalY, 'N' + np.index, { size: 14, weight: 700, color: COLOR.accent, align: 'middle', halo: true }));
        if (np.turnsText) {
          ops.push({ t: 'rotate', deg: -90, cx: np.turnsX, cy: np.turnsFinalY });
          ops.push(textOp(np.turnsX, np.turnsFinalY, np.turnsText, { size: np.turnsSize || 13, weight: 700, color: COLOR.ink, align: 'middle', halo: true }));
          ops.push({ t: 'rotate', deg: 0, cx: np.turnsX, cy: np.turnsFinalY });
        }
      });
    });

    /* برچسب‌ها قطعی بالا اضافه شدند — جای‌گذاری جست‌وجویی حذف شد */

    ops = ops.concat(wireOps, markOps);

    return { width: width, height: height, ops: ops, errors: wRes.errors, windings: windings, pins: pins, total: total };
  }

  function escapeXml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function toSVG(scene) {
    var out = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + scene.width + '" height="' + scene.height + '" viewBox="0 0 ' + scene.width + ' ' + scene.height + '">',
      '<rect width="100%" height="100%" fill="' + COLOR.paper + '"/>'];
    var rotStack = [];
    scene.ops.forEach(function (o) {
      if (o.t === 'rotate') { if (o.deg) rotStack.push(o); else rotStack.pop(); return; }
      if (o.t === 'path') {
        out.push('<path d="' + o.d + '" fill="' + (o.fill || 'none') + '"' +
          (o.stroke ? ' stroke="' + o.stroke + '" stroke-width="' + o.width + '" stroke-linecap="' + o.cap + '" stroke-linejoin="round"' +
            (o.dash ? ' stroke-dasharray="' + o.dash.join(' ') + '"' : '') : '') + '/>');
      } else if (o.t === 'circle') {
        out.push('<circle cx="' + f(o.x) + '" cy="' + f(o.y) + '" r="' + o.r + '"' + (o.fill ? ' fill="' + o.fill + '"' : '') +
          (o.stroke ? ' stroke="' + o.stroke + '" stroke-width="' + o.width + '"' : '') + '/>');
      } else if (o.t === 'text') {
        var anchor = o.align === 'middle' ? 'middle' : (o.align === 'end' ? 'end' : 'start');
        var rot = rotStack.length ? ' transform="rotate(' + rotStack[rotStack.length - 1].deg + ' ' + f(rotStack[rotStack.length - 1].cx) + ' ' + f(rotStack[rotStack.length - 1].cy) + ')"' : '';
        out.push('<text x="' + f(o.x) + '" y="' + f(o.y) + '" font-family="' + (o.font || FONT) + '" font-size="' + o.size + '" font-weight="' + o.weight +
          '" fill="' + o.color + '" text-anchor="' + anchor + '"' + rot + (o.halo ? ' stroke="' + COLOR.paper + '" stroke-width="4" paint-order="stroke"' : '') + '>' + escapeXml(o.s) + '</text>');
        if (rot) rotStack.pop();
      }
    });
    out.push('</svg>');
    return out.join('\n');
  }

  function drawToCanvas(ctx, scene, scale) {
    scale = scale || 1;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = COLOR.paper;
    ctx.fillRect(0, 0, scene.width, scene.height);
    var rotStack = [];
    scene.ops.forEach(function (o) {
      if (o.t === 'rotate') { if (o.deg) rotStack.push(o); else rotStack.pop(); return; }
      if (o.t === 'path') {
        var p = new Path2D(o.d);
        if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(p); }
        if (o.stroke) {
          ctx.strokeStyle = o.stroke; ctx.lineWidth = o.width; ctx.lineCap = o.cap; ctx.lineJoin = 'round';
          ctx.setLineDash(o.dash || []); ctx.stroke(p); ctx.setLineDash([]);
        }
      } else if (o.t === 'circle') {
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
        if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); }
        if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = o.width; ctx.stroke(); }
      } else if (o.t === 'text') {
        ctx.font = o.weight + ' ' + o.size + 'px ' + (o.font || FONT);
        ctx.textAlign = o.align === 'middle' ? 'center' : (o.align === 'end' ? 'right' : 'left');
        var rot = rotStack[rotStack.length - 1];
        if (rot) {
          ctx.save(); ctx.translate(rot.cx, rot.cy); ctx.rotate(rot.deg * Math.PI / 180); ctx.translate(-rot.cx, -rot.cy);
        }
        if (o.halo) { ctx.strokeStyle = COLOR.paper; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.strokeText(o.s, o.x, o.y); }
        ctx.fillStyle = o.color; ctx.fillText(o.s, o.x, o.y);
        if (rot) ctx.restore();
        if (rot) rotStack.pop();
      }
    });
  }

  return { G: G, COLOR: COLOR, LIMITS: LIMITS, parsePins: parsePins, validatePins: validatePins, validateWindings: validateWindings,
    buildScene: buildScene, toSVG: toSVG, drawToCanvas: drawToCanvas };
})();
export const { G, COLOR, LIMITS, parsePins, validatePins, validateWindings, buildScene, toSVG, drawToCanvas } = TransformerDiagram;
export default TransformerDiagram;
