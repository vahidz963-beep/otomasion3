/* کد بیرون‌کشیده‌شده از اولین نسخه (transformer-diagram-tool-6.html) — فقط موتور رسم نقشه */

const leftPinsEl = document.getElementById('leftPins');
const viewSelectEl = document.getElementById('viewSelect');
const rightPinsEl = document.getElementById('rightPins');
const rightPinsNote = document.getElementById('rightPinsNote');
const pinError = document.getElementById('pinError');
const setupPinsBtn = document.getElementById('setupPinsBtn');

const windingFieldset = document.getElementById('windingFieldset');
const windCountEl = document.getElementById('windCount');
const buildWindingsBtn = document.getElementById('buildWindingsBtn');
const windingsBox = document.getElementById('windingsBox');
const windError = document.getElementById('windError');
const drawBtn = document.getElementById('drawBtn');
const downloadBtn = document.getElementById('downloadBtn');

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');

let TOTAL = 10, LEFT = 5, RIGHT = 5;

function updatePinNote(){
  // read-only preview; never rewrites the input fields while the user is typing
  const leftRaw = parseInt(leftPinsEl.value);
  const rightRaw = parseInt(rightPinsEl.value);
  const left = (Number.isFinite(leftRaw) && leftRaw>0) ? leftRaw : 0;
  const right = (Number.isFinite(rightRaw) && rightRaw>0) ? rightRaw : 0;
  const total = left+right;
  if(left>0 && right>0){
    rightPinsNote.textContent = `کل پایه‌ها: ${total} (چپ ۱ تا ${left} / راست ${left+1} تا ${total})`;
  } else {
    rightPinsNote.textContent = 'کل پایه‌ها: —';
  }
  pinError.style.display='none';
  return {total,left,right};
}

leftPinsEl.addEventListener('input', updatePinNote);
rightPinsEl.addEventListener('input', updatePinNote);

setupPinsBtn.addEventListener('click', ()=>{
  const left = parseInt(leftPinsEl.value);
  const right = parseInt(rightPinsEl.value);
  if(!Number.isFinite(left) || left<1 || !Number.isFinite(right) || right<1){
    pinError.textContent = 'تعداد پایه‌های سمت چپ و راست باید هر دو حداقل ۱ باشند.';
    pinError.style.display='block';
    return;
  }
  LEFT = left; RIGHT = right; TOTAL = left+right;
  updatePinNote();
  windingFieldset.style.display='block';
  buildWindingRows();
});

function pinOptionsHTML(selectedVal){
  let html='';
  for(let i=1;i<=TOTAL;i++){
    html += `<option value="${i}" ${i===selectedVal?'selected':''}>${i}</option>`;
  }
  return html;
}

function buildWindingRows(){
  const n = Math.max(1, parseInt(windCountEl.value)||1);
  windingsBox.innerHTML='';
  for(let i=1;i<=n;i++){
    const defStart = Math.min(TOTAL, i);
    const defEnd = Math.min(TOTAL, i+1);
    const row = document.createElement('div');
    row.className='winding-row';
    row.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; width:100%;">
        <span class="wlabel">سیم‌پیچ ${i}</span>
        <select id="wStart_${i}">${pinOptionsHTML(defStart)}</select>
        <span style="color:#7f9cd6;font-size:12px;">تا</span>
        <select id="wEnd_${i}">${pinOptionsHTML(defEnd)}</select>
      </div>
      <div style="display:flex; align-items:center; gap:8px; width:100%;">
        <span class="wlabel">تعداد دور</span>
        <input type="number" id="wTurns_${i}" min="0" value="10" style="width:90px;">
      </div>
    `;
    windingsBox.appendChild(row);
  }
}

buildWindingsBtn.addEventListener('click', buildWindingRows);

// ---------- drawing ----------
const CM = 55; // one internal unit standing in for ~1cm on the canvas (with extra room for labels)
const MM = CM/10; // ~1mm on the same scale, for precise dot-position tweaks

function dot(x,y,r,fill){
  ctx.beginPath();
  ctx.arc(x,y,r,0,Math.PI*2);
  if(fill){ ctx.fillStyle=fill; ctx.fill(); }
  ctx.strokeStyle='#16325c';
  ctx.lineWidth=1.2;
  ctx.stroke();
}

function drawCoreRect(x,y,w,h){
  ctx.save();
  ctx.strokeStyle = '#16325c';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  const r = 18; // rounded corners, no sharp edges
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);
  ctx.arcTo(x+w, y, x+w, y+r, r);
  ctx.lineTo(x+w, y+h-r);
  ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
  ctx.lineTo(x+r, y+h);
  ctx.arcTo(x, y+h, x, y+h-r, r);
  ctx.lineTo(x, y+r);
  ctx.arcTo(x, y, x+r, y, r);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  // two vertical lines in the middle: the insulation barrier symbol
  const midX = x + w/2;
  ctx.save();
  ctx.strokeStyle = '#16325c';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(midX-6, y+16); ctx.lineTo(midX-6, y+h-16); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(midX+6, y+16); ctx.lineTo(midX+6, y+h-16); ctx.stroke();
  ctx.restore();
}

function drawCoilVertical(x, yTop, yBottom, direction){
  const span = Math.max(24, yBottom - yTop);
  const step = 15;
  const loops = Math.max(2, Math.round(span/step));
  const actualStep = span/loops;
  const bulge = 13*direction;

  ctx.save();
  ctx.strokeStyle = '#16325c';
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x, yTop);
  for(let i=1;i<=loops;i++){
    const segStart = yTop + (i-1)*actualStep;
    const segEnd = yTop + i*actualStep;
    const c1y = segStart + actualStep*0.28;
    const c2y = segStart + actualStep*0.72;
    ctx.bezierCurveTo(x+bulge, c1y, x+bulge, c2y, x, segEnd);
  }
  ctx.stroke();
  ctx.restore();

  // peak (outermost bulge point) of the first loop, and of the last loop —
  // used to mark the winding's start pin right on its first curve, not at the raw corner
  return {
    topPeak: {x: x+direction*(11 - MM*3.8), y: yTop+15 - MM*1.3},
    bottomPeak: {x: x+direction*(11 - MM*3.8), y: yBottom-15 - MM*1.3}
  };
}

function layoutColumn(count, pinSpacing){
  return count>1 ? pinSpacing*(count-1) : pinSpacing*0.6;
}

function collectWindings(){
  const n = Math.max(1, parseInt(windCountEl.value)||1);
  const list=[];
  for(let i=1;i<=n;i++){
    const s = parseInt(document.getElementById('wStart_'+i).value);
    const e = parseInt(document.getElementById('wEnd_'+i).value);
    const turnsEl = document.getElementById('wTurns_'+i);
    const t = turnsEl ? (parseInt(turnsEl.value)||0) : 0;
    list.push({start:s, end:e, turns:t, idx:i});
  }
  return list;
}

function pinSide(pinNum){
  return pinNum <= LEFT ? 'left' : 'right';
}

function drawTransformer(){
  windError.style.display='none';
  const pinSpacing = 58;

  const leftHeight = layoutColumn(LEFT, pinSpacing);
  const rightHeight = layoutColumn(RIGHT, pinSpacing);
  const coreInteriorHeight = Math.max(leftHeight, rightHeight, 160);

  const coreTop = 100;
  const coreBottomY = coreTop + coreInteriorHeight + 60;
  const canvasHeight = coreBottomY + 60;
  const coreWidthPx = 350;
  const coreLeft = 45;
  const coreRight = coreLeft + coreWidthPx;
  const canvasWidth = coreRight + 45;

  const dpr = 2; // render at 2x for a crisper exported PNG
  cv.width = canvasWidth*dpr;
  cv.height = canvasHeight*dpr;
  cv.style.width = canvasWidth+'px';
  cv.style.height = canvasHeight+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);

  ctx.fillStyle = '#fbfaf6';
  ctx.fillRect(0,0,canvasWidth,canvasHeight);

  // ---- view-angle sentence, above the whole transformer ----
  const viewSentence = viewSelectEl.value === 'bottom' ? 'From the bottom view' : 'From the top view';
  ctx.save();
  ctx.font = '600 22px Arial, Helvetica, sans-serif';
  ctx.fillStyle = '#16325c';
  ctx.textAlign = 'center';
  ctx.fillText(viewSentence, (coreLeft+coreRight)/2, coreTop - 30);
  ctx.restore();

  // ---- plain rounded core rectangle with the two insulation lines in the middle ----
  drawCoreRect(coreLeft, coreTop, coreRight-coreLeft, coreBottomY-coreTop);

  // ---- pin positions (near the edge, this is what gets numbered) ----
  const leftStartY = coreTop + 30 + (coreInteriorHeight - leftHeight)/2;
  const rightStartY = coreTop + 30 + (coreInteriorHeight - rightHeight)/2;

  const leftPinX = coreLeft + 34;
  const rightPinX = coreRight - 34;
  // coils sit about 1cm further toward the inside of the core, away from the pin dots
  const coilXLeft = leftPinX + CM;
  const coilXRight = rightPinX - CM;

  const pins = {}; // number -> {x,y,side}
  for(let k=0;k<LEFT;k++){
    const y = LEFT>1 ? leftStartY + leftHeight*(k/(LEFT-1)) : leftStartY+leftHeight/2;
    pins[k+1] = {x:leftPinX, y, side:'left'};
  }
  // right side numbering runs bottom-to-top (standard IC/DIP pin convention)
  for(let k=0;k<RIGHT;k++){
    const y = RIGHT>1 ? rightStartY + rightHeight*(k/(RIGHT-1)) : rightStartY+rightHeight/2;
    pins[LEFT+RIGHT-k] = {x:rightPinX, y, side:'right'};
  }

  // ---- dots + numbers for ALL pins ----
  ctx.font = '15px Tahoma, sans-serif';
  for(let num=1; num<=TOTAL; num++){
    const p = pins[num];
    dot(p.x, p.y, 3.6, '#16325c');
    ctx.fillStyle='#16325c';
    if(p.side==='left'){
      ctx.textAlign='right';
      ctx.fillText(num, p.x-14, p.y+5);
    } else {
      ctx.textAlign='left';
      ctx.fillText(num, p.x+14, p.y+5);
    }
  }

  // ---- windings: pin -> 1cm straight stub -> coil -> straight stub -> pin ----
  const windings = collectWindings();
  let hasError = false;
  const placedBySide = { left: [], right: [] }; // {yTop, yBottom, nestLevel} already drawn on this side

  windings.forEach(w=>{
    if(w.start===w.end){ hasError=true; return; }
    const sideStart = pinSide(w.start);
    const sideEnd = pinSide(w.end);
    if(sideStart !== sideEnd){ hasError=true; return; }

    const pStart = pins[w.start];
    const pEnd = pins[w.end];
    const side = sideStart;
    const baseCoilX = side==='left' ? coilXLeft : coilXRight;

    const yTop = Math.min(pStart.y, pEnd.y);
    const yBottom = Math.max(pStart.y, pEnd.y);

    // nest this winding further inside the core if its vertical span overlaps
    // any previously drawn winding on the same side — this covers shared pins
    // AND cases like 2→3 sitting inside a wider 1→5 winding
    const sideList = placedBySide[side];
    const overlapping = sideList.filter(e => Math.max(e.yTop,yTop) < Math.min(e.yBottom,yBottom) - 1);
    const nestLevel = overlapping.length ? 1 + Math.max(...overlapping.map(e=>e.nestLevel)) : 0;
    sideList.push({yTop, yBottom, nestLevel});

    const nestOffset = nestLevel * (CM/2);
    const coilX = side==='left' ? baseCoilX + nestOffset : baseCoilX - nestOffset;

    // 1cm straight connector from each pin to the coil
    ctx.save();
    ctx.strokeStyle = '#1e3a8a';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(pStart.x, pStart.y); ctx.lineTo(coilX, pStart.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(coilX, pEnd.y); ctx.lineTo(pEnd.x, pEnd.y); ctx.stroke();
    ctx.restore();

    const direction = side==='left' ? +1 : -1;

    const peaks = drawCoilVertical(coilX, yTop, yBottom, direction);

    // start-pin marker: a dot on the outer point of the winding's first curve,
    // on whichever end (top or bottom) is the actual start pin
    const startPeak = (pStart.y <= pEnd.y) ? peaks.topPeak : peaks.bottomPeak;
    dot(startPeak.x, startPeak.y, 4.3, '#16325c');

    const pinX = pStart.x; // same column x for start & end

    // winding number (N1, N2, ...), centered in the gap between the pin column and the coil —
    // its own coilX (shifted by nestLevel) keeps it clear of any overlapping winding's label
    const midY = (yTop+yBottom)/2;
    const numMidX = (pinX + coilX)/2;

    ctx.save();
    ctx.font = '700 17px Tahoma, sans-serif';
    ctx.fillStyle = '#c1440e';
    ctx.textAlign = 'center';
    ctx.fillText(`N${w.idx}`, numMidX, midY+6);
    ctx.restore();

    // turns count (10T), on the bulge side of the coil, clear of the loops
    if(w.turns > 0){
      const turnsX = coilX + direction*18;
      ctx.save();
      ctx.font = '600 15px Tahoma, sans-serif';
      ctx.fillStyle = '#16325c';
      ctx.textAlign = direction>0 ? 'left' : 'right';
      ctx.fillText(`${w.turns}T`, turnsX, midY+6);
      ctx.restore();
    }
  });

  if(hasError){
    windError.textContent = 'توجه: پایهٔ شروع و پایان هر سیم‌پیچ باید متفاوت و هر دو در یک سمت (چپ یا راست) باشند. سیم‌پیچ‌های نامعتبر رسم نشدند.';
    windError.style.display='block';
  }

  downloadBtn.style.display='block';
}

drawBtn.addEventListener('click', drawTransformer);

downloadBtn.addEventListener('click', ()=>{
  const now = new Date();
  const pad = n => String(n).padStart(2,'0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const link = document.createElement('a');
  link.download = `transformer-diagram-${stamp}.png`;
  link.href = cv.toDataURL('image/png');
  link.click();
});

// initial state
updatePinNote();
ctx.fillStyle = '#fbfaf6';
ctx.fillRect(0,0,cv.width,cv.height);
ctx.fillStyle='#5c6d95';
ctx.font='16px Tahoma, sans-serif';
ctx.textAlign='center';
ctx.fillText('برای شروع، مشخصات را در پنل سمت راست وارد کن', cv.width/2, cv.height/2);
