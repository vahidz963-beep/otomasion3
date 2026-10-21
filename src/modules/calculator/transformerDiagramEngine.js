/*
 * Exact Aryaman transformer pin-diagram geometry, modularized for React.
 * Product rule in v131: top view only; the legacy Winding Specification
 * table is excluded from image 2 and rendered separately when needed.
 */
const TransformerDiagram = (() => {
  'use strict';
  var G = {
    pinSpacing: 58, minInterior: 160, coreTop: 100, coreLeft: 45, coreWidth: 350, coreRadius: 18,
    labelMargin: 100, pinInset: 34, coilOffset: 55, nestStep: 27.5, loopStep: 15, bulge: 13,
    titleGap: 30, legendRow: 22, outsideOffset: 40, gridStep: 3, pad: 3
  };
  var COLOR = { ink: '#16325c', paper: '#fbfaf6', wire: '#1e3a8a', accent: '#c1440e', muted: '#7f9cd6' };
  var LIMITS = { maxPinsPerSide: 30, maxWindings: 12 };
  var FONT = "'Aryaman Vazirmatn', Vazirmatn, Tahoma, Arial, sans-serif";

  function f(n) { return (Math.round(n * 100) / 100).toString(); }

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
      else if (!allowCrossSide && pinSide(s, left) !== pinSide(e, left)) msgs.push('شروع و پایان باید در یک سمت باشند (سیم‌پیچ دوسمتی غیرفعال است).');
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
  function textOp(x, y, s, o) { return { t: 'text', x: x, y: y, s: String(s), size: o.size || 15, weight: o.weight || 400, color: o.color || COLOR.ink, align: o.align || 'start', halo: o.halo !== false }; }

  function roundRectD(x, y, w, h, r) {
    return 'M ' + f(x + r) + ' ' + f(y) + ' L ' + f(x + w - r) + ' ' + f(y) +
      ' A ' + r + ' ' + r + ' 0 0 1 ' + f(x + w) + ' ' + f(y + r) + ' L ' + f(x + w) + ' ' + f(y + h - r) +
      ' A ' + r + ' ' + r + ' 0 0 1 ' + f(x + w - r) + ' ' + f(y + h) + ' L ' + f(x + r) + ' ' + f(y + h) +
      ' A ' + r + ' ' + r + ' 0 0 1 ' + f(x) + ' ' + f(y + h - r) + ' L ' + f(x) + ' ' + f(y + r) +
      ' A ' + r + ' ' + r + ' 0 0 1 ' + f(x + r) + ' ' + f(y) + ' Z';
  }

  // کویل عمودی کنار ستون پایه‌ها
  function coilVertical(x, yTop, yBottom, dir) {
    var span = Math.max(24, yBottom - yTop), loops = Math.max(2, Math.round(span / G.loopStep)), step = span / loops, b = G.bulge * dir;
    var d = 'M ' + f(x) + ' ' + f(yTop);
    for (var i = 0; i < loops; i++) {
      var s = yTop + i * step, e = yTop + (i + 1) * step;
      d += ' C ' + f(x + b) + ' ' + f(s + step * 0.28) + ' ' + f(x + b) + ' ' + f(s + step * 0.72) + ' ' + f(x) + ' ' + f(e);
    }
    return { d: d };
  }
  // کویل افقی داخل پنجره (مدل A)
  function coilHorizontal(xL, xR, y, dirY) {
    var span = Math.max(24, xR - xL), loops = Math.max(2, Math.round(span / G.loopStep)), step = span / loops, b = G.bulge * dirY;
    var d = 'M ' + f(xL) + ' ' + f(y);
    for (var i = 0; i < loops; i++) {
      var s = xL + i * step, e = xL + (i + 1) * step;
      d += ' C ' + f(s + step * 0.28) + ' ' + f(y + b) + ' ' + f(s + step * 0.72) + ' ' + f(y + b) + ' ' + f(e) + ' ' + f(y);
    }
    return { d: d };
  }

  // ---- مستطیل‌های برخورد (موانع) ----
  function rect(x1, y1, x2, y2) { return { x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2) }; }
  function hit(a, b, pad) { pad = pad || 0; return a.x1 - pad < b.x2 && b.x1 - pad < a.x2 && a.y1 - pad < b.y2 && b.y1 - pad < a.y2; }

  // برچسب یک‌خطی با رنگ مشخص (N قرمز، تعداد دور مشکی)
  function labelVariant(cx, cy, text, color) {
    var w = text.length * 8.4 + 6;
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

    var legendBase = coreBottom + 66;
    var height = coreBottom + 70;
    var width = coreRight + G.labelMargin;

    var ops = [];
    var view = 'نمای بالا';
    ops.push(textOp(midX, coreTop - G.titleGap, view, { size: 22, weight: 600, align: 'middle' }));
    ops.push(pathOp(roundRectD(coreLeft, coreTop, G.coreWidth, coreBottom - coreTop, G.coreRadius), { stroke: COLOR.ink, width: 2.5 }));
    ops.push(pathOp('M ' + f(midX - 6) + ' ' + f(coreTop + 16) + ' L ' + f(midX - 6) + ' ' + f(coreBottom - 16), { stroke: COLOR.ink, width: 2 }));
    ops.push(pathOp('M ' + f(midX + 6) + ' ' + f(coreTop + 16) + ' L ' + f(midX + 6) + ' ' + f(coreBottom - 16), { stroke: COLOR.ink, width: 2 }));

    var obstacles = [
      rect(midX - 8, coreTop + 12, midX + 8, coreBottom - 12) // میله‌های عایق
    ];

    var leftStartY = coreTop + 30 + (interior - leftH) / 2, rightStartY = coreTop + 30 + (interior - rightH) / 2;
    var leftPinX = coreLeft + G.pinInset, rightPinX = coreRight - G.pinInset;
    var coilXLeft = leftPinX + G.coilOffset, coilXRight = rightPinX - G.coilOffset;

    var pins = {};
    for (var k = 0; k < left; k++) pins[k + 1] = { x: leftPinX, y: left > 1 ? leftStartY + leftH * (k / (left - 1)) : leftStartY + leftH / 2, side: 'left' };
    for (var j = 0; j < right; j++) pins[total - j] = { x: rightPinX, y: right > 1 ? rightStartY + rightH * (j / (right - 1)) : rightStartY + rightH / 2, side: 'right' };
    for (var n = 1; n <= total; n++) {
      var p = pins[n];
      ops.push(circleOp(p.x, p.y, 3.6, { fill: COLOR.ink, stroke: COLOR.ink, width: 1.2 }));
      var nx = p.side === 'left' ? p.x - 14 : p.x + 14;
      ops.push(textOp(nx, p.y + 5, n, { size: 15, align: p.side === 'left' ? 'end' : 'start' }));
      obstacles.push(rect(p.x - 6, p.y - 6, p.x + 6, p.y + 6));
      obstacles.push(p.side === 'left' ? rect(p.x - 30, p.y - 10, p.x - 10, p.y + 7) : rect(p.x + 10, p.y - 10, p.x + 30, p.y + 7));
    }

    var placed = { left: [], right: [] };
    var wireOps = [], labelJobs = [], markOps = [];
    var stroke = { stroke: COLOR.wire, width: 2.4, cap: 'round' };
    function seg(x1, y1, x2, y2) { // مانع برای خط افقی/عمودی
      obstacles.push(rect(x1 - 2.5, y1 - 2.5, x2 + 2.5, y2 + 2.5));
    }

    windings.forEach(function (w) {
      var sS = pinSide(w.start, left), sE = pinSide(w.end, left);
      var pS = pins[w.start], pE = pins[w.end];

      if (sS === sE) {
        var side = sS;
        var yTop = Math.min(pS.y, pE.y), yBottom = Math.max(pS.y, pE.y);
        var list = placed[side];
        var overlap = list.filter(function (e) { return Math.max(e.yTop, yTop) < Math.min(e.yBottom, yBottom) - 1; });
        var nest = overlap.length ? 1 + Math.max.apply(null, overlap.map(function (e) { return e.nest; })) : 0;
        list.push({ yTop: yTop, yBottom: yBottom, nest: nest });
        var baseX = side === 'left' ? coilXLeft : coilXRight;
        var coilX = side === 'left' ? baseX + nest * G.nestStep : baseX - nest * G.nestStep;
        var dir = side === 'left' ? 1 : -1;

        wireOps.push(pathOp('M ' + f(pS.x) + ' ' + f(pS.y) + ' L ' + f(coilX) + ' ' + f(pS.y), stroke));
        wireOps.push(pathOp('M ' + f(coilX) + ' ' + f(pE.y) + ' L ' + f(pE.x) + ' ' + f(pE.y), stroke));
        seg(Math.min(pS.x, coilX), pS.y, Math.max(pS.x, coilX), pS.y);
        seg(Math.min(pE.x, coilX), pE.y, Math.max(pE.x, coilX), pE.y);
        wireOps.push(pathOp(coilVertical(coilX, yTop, yBottom, dir).d, stroke));
        obstacles.push(dir > 0 ? rect(coilX - 3, yTop - 4, coilX + G.bulge + 3, yBottom + 4) : rect(coilX - G.bulge - 3, yTop - 4, coilX + 3, yBottom + 4));

        // نقطه شروع: گوشهٔ فضای خالی کنار کویل، سمت پایه (نه روی سیم)
        var startTop = pS.y <= pE.y;
        var mx = coilX - dir * 10, my = startTop ? yTop + 8 : yBottom - 8;
        markOps.push(circleOp(mx, my, 4.3, { fill: COLOR.ink, stroke: COLOR.ink, width: 1.2 }));
        obstacles.push(rect(mx - 5, my - 5, mx + 5, my + 5));

        // مطابق نمونه کاربر: N بیرون کویل (سمت پایه‌ها) و تعداد دور کنار کویل (سمت هسته)، هر دو در وسط ارتفاع کویل
        var midC = (yTop + yBottom) / 2;
        labelJobs.push({ group: w.index, text: 'N' + w.index, color: COLOR.accent, tx: coilX - dir * 30, ty: midC, spanY: [yTop + 4, yBottom - 4], outsideSide: side, leadX: coilX + dir * G.bulge * 0.5, leadY: midC });
        labelJobs.push({ group: w.index, text: w.turns + 'T', color: COLOR.ink, tx: coilX + dir * (G.bulge + 24), ty: midC, spanY: [yTop + 4, yBottom - 4], outsideSide: side, leadX: coilX + dir * G.bulge * 0.5, leadY: midC });
        return;
      }

      // سیم‌پیچ دوسمتی (مدل A): کویل افقی در پنجره
      var pL = sS === 'left' ? pS : pE, pR = sS === 'left' ? pE : pS;
      var startIsLeft = sS === 'left';
      var yMid = (pL.y + pR.y) / 2;
      var xL = coilXLeft, xR = coilXRight;
      var ch = coilHorizontal(xL, xR, yMid, -1);
      wireOps.push(pathOp('M ' + f(pL.x) + ' ' + f(pL.y) + ' L ' + f(xL) + ' ' + f(pL.y) + ' L ' + f(xL) + ' ' + f(yMid), stroke));
      wireOps.push(pathOp('M ' + f(xR) + ' ' + f(yMid) + ' L ' + f(xR) + ' ' + f(pR.y) + ' L ' + f(pR.x) + ' ' + f(pR.y), stroke));
      wireOps.push(pathOp(ch.d, stroke));
      seg(pL.x, pL.y, xL, pL.y); seg(xL, Math.min(pL.y, yMid), xL, Math.max(pL.y, yMid));
      seg(xR, Math.min(pR.y, yMid), xR, Math.max(pR.y, yMid)); seg(xR, pR.y, pR.x, pR.y);
      obstacles.push(rect(xL - 3, yMid - G.bulge - 3, xR + 3, yMid + 3));
      var mxc = startIsLeft ? xL - 10 : xR + 10, myc = yMid + 10; // گوشه پایین کویل، فضای خالی
      markOps.push(circleOp(mxc, myc, 4.3, { fill: COLOR.ink, stroke: COLOR.ink, width: 1.2 }));
      obstacles.push(rect(mxc - 5, myc - 5, mxc + 5, myc + 5));
      labelJobs.push({ group: w.index, text: 'N' + w.index, color: COLOR.accent, tx: midX, ty: yMid + 16, spanY: [yMid - 10, yMid + 60], outsideSide: 'left', leadX: midX, leadY: yMid });
      labelJobs.push({ group: w.index, text: w.turns + 'T', color: COLOR.ink, tx: midX, ty: yMid - G.bulge - 14, spanY: [yMid - G.bulge - 60, yMid - 6], outsideSide: 'left', leadX: midX, leadY: yMid });
    });

    // ---- جای‌گذاری برچسب‌ها: نزدیک‌ترین جای خالی به هدف، بدون برخورد با هیچ خطی ----
    function segClear(x1, y1, x2, y2) {
      var len = Math.hypot(x2 - x1, y2 - y1), steps = Math.ceil(len / 2);
      for (var k = 0; k <= steps; k++) {
        var t = k / steps, px = x1 + (x2 - x1) * t, py = y1 + (y2 - y1) * t;
        if (Math.hypot(px - x1, py - y1) < 10 || Math.hypot(px - x2, py - y2) < 2) continue;
        for (var o = 0; o < obstacles.length; o++) {
          var ob = obstacles[o];
          if (px > ob.x1 - 1.5 && px < ob.x2 + 1.5 && py > ob.y1 - 1.5 && py < ob.y2 + 1.5) return false;
        }
      }
      return true;
    }
    function outsideSpot(job, taken) {
      var w = job.text.length * 8.4 + 6, best = null, cands = [], y, x;
      for (y = coreTop + 10; y <= coreBottom - 10; y += 4) {
        cands.push({ px: coreLeft - 22, py: y, side: 'left' });
        cands.push({ px: coreRight + 22, py: y, side: 'right' });
      }
      for (x = coreLeft + 10; x <= coreRight - 10; x += 10) {
        cands.push({ px: x, py: coreTop - 16, side: 'top' });
        cands.push({ px: x, py: coreBottom + 16, side: 'bottom' });
      }
      cands.forEach(function (c) {
        var r, tx, ty, align;
        if (c.side === 'left') { tx = c.px - 6; ty = c.py + 4; align = 'end'; r = rect(tx - w, c.py - 10, tx, c.py + 4); }
        else if (c.side === 'right') { tx = c.px + 6; ty = c.py + 4; align = 'start'; r = rect(tx, c.py - 10, tx + w, c.py + 4); }
        else { tx = c.px; ty = c.py + 4; align = 'middle'; r = rect(tx - w / 2, c.py - 10, tx + w / 2, c.py + 4); }
        if (taken.some(function (o) { return hit(r, o, 2); })) return;
        if (obstacles.some(function (o) { return hit(r, o, 2); })) return;
        if (!segClear(c.px, c.py, job.leadX, job.leadY)) return;
        var len = Math.hypot(c.px - job.leadX, c.py - job.leadY);
        if (!best || len < best.len) best = { px: c.px, py: c.py, tx: tx, ty: ty, align: align, rect: r, len: len };
      });
      return best;
    }

    function fallbackSpot(job, taken) {
      var w = job.text.length * 8.4 + 6, cands = [], x;
      for (x = coreLeft + 10; x <= coreRight - 10; x += 6) {
        cands.push({ px: x, py: coreTop - 16 }); cands.push({ px: x, py: coreBottom + 16 });
      }
      cands.sort(function (a1, a2) { return Math.abs(a1.px - job.leadX) - Math.abs(a2.px - job.leadX); });
      for (var c = 0; c < cands.length; c++) {
        var r = rect(cands[c].px - w / 2, cands[c].py - 10, cands[c].px + w / 2, cands[c].py + 4);
        if (!taken.some(function (o) { return hit(r, o, 2); })) return { px: cands[c].px, py: cands[c].py, tx: cands[c].px, ty: cands[c].py + 4, align: 'middle', rect: r };
      }
      return null;
    }
    var placedRects = [];
    // هر سیم‌پیچ (N و تعداد دور) یک گروه است: یا هر دو داخل کادر جا می‌شوند، یا هر دو بیرون با خط‌چین
    var groups = {}, groupOrder = [];
    labelJobs.forEach(function (job) {
      if (!groups[job.group]) { groups[job.group] = []; groupOrder.push(job.group); }
      groups[job.group].push(job);
    });
    function findSpot(job, taken) {
      var cands = [];
      var sy1 = job.spanY ? job.spanY[0] : coreTop + 14, sy2 = job.spanY ? job.spanY[1] : coreBottom - 14;
      var xOffsets = job.spanY ? [0, -4, 4, -8, 8, -12, 12] : [0, -12, 12, -24, 24];
      xOffsets.forEach(function (dx) {
        var x = job.tx + dx;
        if (x < coreLeft + 6 || x > coreRight - 6) return;
        for (var y = sy1; y <= sy2; y += G.gridStep / 2) {
          cands.push({ x: x, y: y, d: Math.abs(dx) * 3 + Math.abs(y - job.ty) });
        }
      });
      cands.sort(function (p1, p2) { return p1.d - p2.d; });
      for (var c = 0; c < cands.length; c++) {
        var v = labelVariant(cands[c].x, cands[c].y, job.text, job.color);
        var r = v.rect;
        if (r.x1 < coreLeft + 4 || r.x2 > coreRight - 4 || r.y1 < coreTop + 4 || r.y2 > coreBottom - 4) continue;
        var bad = obstacles.some(function (o) { return hit(r, o, G.pad); }) || taken.some(function (o) { return hit(r, o, 2); });
        if (!bad) return v;
      }
      return null;
    }
    groupOrder.forEach(function (gk) {
      var jobs = groups[gk], taken = placedRects.slice(), found = [];
      for (var j = 0; j < jobs.length && found.length === j; j++) {
        var v = findSpot(jobs[j], taken);
        if (v) { found.push(v); taken.push(v.rect); }
      }
      if (found.length === jobs.length) {
        found.forEach(function (v) { placedRects.push(v.rect); v.ops.forEach(function (o) { ops.push(o); }); });
        return;
      }
      // جا نشد: هر دو برچسب بیرون کادر، با خط‌چین که از روی هیچ سیم یا کویل یا متنی عبور نکند
      jobs.forEach(function (job) {
        var best = outsideSpot(job, placedRects);
        if (best) {
          placedRects.push(best.rect);
          wireOps.push(pathOp('M ' + f(best.px) + ' ' + f(best.py) + ' L ' + f(job.leadX) + ' ' + f(job.leadY), { stroke: COLOR.muted, width: 1, dash: [3, 3] }));
        } else {
          // هیچ مسیر بدون برخورد پیدا نشد: برچسب بیرون و بدون خط راهنما نوشته می‌شود تا گم نشود
          best = fallbackSpot(job, placedRects);
          if (!best) return;
          placedRects.push(best.rect);
        }
        ops.push(textOp(best.tx, best.ty, job.text, { size: 13, weight: 700, color: job.color, align: best.align }));
      });
    });

    ops = ops.concat(wireOps, markOps);

    // The specification table is intentionally rendered by React below the diagrams,
    // not inside image 2. This keeps the top-view drawing large and clean.

    return { width: width, height: height, ops: ops, errors: wRes.errors, windings: windings, pins: pins, total: total };
  }

  function escapeXml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function toSVG(scene) {
    var out = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + scene.width + '" height="' + scene.height + '" viewBox="0 0 ' + scene.width + ' ' + scene.height + '">',
      '<rect width="100%" height="100%" fill="' + COLOR.paper + '"/>'];
    scene.ops.forEach(function (o) {
      if (o.t === 'path') {
        out.push('<path d="' + o.d + '" fill="' + (o.fill || 'none') + '"' +
          (o.stroke ? ' stroke="' + o.stroke + '" stroke-width="' + o.width + '" stroke-linecap="' + o.cap + '" stroke-linejoin="round"' +
            (o.dash ? ' stroke-dasharray="' + o.dash.join(' ') + '"' : '') : '') + '/>');
      } else if (o.t === 'circle') {
        out.push('<circle cx="' + f(o.x) + '" cy="' + f(o.y) + '" r="' + o.r + '"' + (o.fill ? ' fill="' + o.fill + '"' : '') +
          (o.stroke ? ' stroke="' + o.stroke + '" stroke-width="' + o.width + '"' : '') + '/>');
      } else if (o.t === 'text') {
        var anchor = o.align === 'middle' ? 'middle' : (o.align === 'end' ? 'end' : 'start');
        out.push('<text x="' + f(o.x) + '" y="' + f(o.y) + '" font-family="' + FONT + '" font-size="' + o.size + '" font-weight="' + o.weight +
          '" fill="' + o.color + '" text-anchor="' + anchor + '"' + (o.halo ? ' stroke="' + COLOR.paper + '" stroke-width="4" paint-order="stroke"' : '') + '>' + escapeXml(o.s) + '</text>');
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
    scene.ops.forEach(function (o) {
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
        ctx.font = o.weight + ' ' + o.size + 'px ' + FONT;
        ctx.textAlign = o.align === 'middle' ? 'center' : (o.align === 'end' ? 'right' : 'left');
        if (o.halo) { ctx.strokeStyle = COLOR.paper; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.strokeText(o.s, o.x, o.y); }
        ctx.fillStyle = o.color; ctx.fillText(o.s, o.x, o.y);
      }
    });
  }

  return { G: G, COLOR: COLOR, LIMITS: LIMITS, parsePins: parsePins, validatePins: validatePins, validateWindings: validateWindings,
    buildScene: buildScene, toSVG: toSVG, drawToCanvas: drawToCanvas };
})();

export const { G, COLOR, LIMITS, parsePins, validatePins, validateWindings, buildScene, toSVG, drawToCanvas } = TransformerDiagram;
export default TransformerDiagram;
