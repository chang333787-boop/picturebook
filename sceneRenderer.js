/* ================================================================
   sceneRenderer.js — 카드 렌더링 / 화살표 / 연결
   의존: state.js, locks.js (isLockedByOther),
         firebase.js (pushToFirebase), canvasInteraction.js (toCanvas, _startDrag 등)

   핵심 구조:
     renderCard(s)  = buildCardHTML → innerHTML → bindCardEvents → syncCardState
     ┌─────────────────────────────────────────────────────────┐
     │ buildCardHTML(s)   순수 HTML 반환, 인라인 핸들러 없음  │
     │ bindCardEvents(el,s) addEventListener만               │
     │ syncCardState(num)  잠금/비활성 상태 반영만 ← source of truth │
     └─────────────────────────────────────────────────────────┘

   잠금 UI 단일화:
     locks.js의 updateCardLockUI()는 syncCardState()의 위임 래퍼.
     DOM 잠금 표시 로직은 syncCardState만이 담당.
     firebase.js → updateCardLockUI → syncCardState 순으로 경유.
   ================================================================ */

/* ── 카드 추가 ── */
function addScene() {
  while (scenes[nextNum]) nextNum++;
  const num = nextNum++;

  const wrap = document.getElementById('canvas-wrap');
  const rect = wrap.getBoundingClientRect();
  const cx   = rect.width  / 2 + (Math.random() - 0.5) * 160;
  const cy   = rect.height / 2 + (Math.random() - 0.5) * 100;
  const cv   = toCanvas(rect.left + cx, rect.top + cy);

  scenes[num] = { num, title: '', type: 'normal',
    x: Math.max(20, cv.x), y: Math.max(20, cv.y),
    choiceA: '', choiceB: '', choiceCount: 2 };
  renderCard(scenes[num]);
  drawArrows();
  pushToFirebase();
}

/* ── 전체 렌더 ── */
function renderAll() {
  document.querySelectorAll('.scene-card').forEach(el => el.remove());
  Object.values(scenes).forEach(s => renderCard(s));
  drawArrows();
}

/* ================================================================
   buildCardHTML — 순수 HTML 문자열 반환
   ※ onclick/onchange/oninput/onfocus 인라인 핸들러 없음
      식별자는 data-* 속성으로 표현, 바인딩은 bindCardEvents에서
   ================================================================ */
function buildCardHTML(s) {
  const types  = ['start', 'normal', 'ending'];
  const labels = ['시작', '일반', '엔딩'];

  const radios = types.map((t, i) =>
    `<input class="type-radio js-type-radio" type="radio"
       name="type-${s.num}" id="tr-${s.num}-${t}"
       value="${t}" ${s.type === t ? 'checked' : ''} data-num="${s.num}" data-value="${t}">
     <label class="type-label" for="tr-${s.num}-${t}">${labels[i]}</label>`
  ).join('');

  const cnt = s.choiceCount || 2;
  let portsHTML = '';

  if (s.type !== 'ending') {
    const toggleHTML = `
      <div style="display:flex;gap:4px;margin-bottom:6px;padding:0 8px;">
        <label style="flex:1;text-align:center;padding:3px 0;border-radius:6px;font-size:11px;cursor:pointer;
          border:1.5px solid ${cnt===1?'var(--primary)':'#dde8f5'};
          background:${cnt===1?'var(--primary)':'transparent'};
          color:${cnt===1?'#fff':'var(--muted)'};">
          <input class="js-cnt-radio" type="radio" name="cnt-${s.num}"
            value="1" ${cnt===1?'checked':''} data-num="${s.num}" data-value="1"
            style="display:none;"/>
          다음 1개
        </label>
        <label style="flex:1;text-align:center;padding:3px 0;border-radius:6px;font-size:11px;cursor:pointer;
          border:1.5px solid ${cnt===2?'var(--primary)':'#dde8f5'};
          background:${cnt===2?'var(--primary)':'transparent'};
          color:${cnt===2?'#fff':'var(--muted)'};">
          <input class="js-cnt-radio" type="radio" name="cnt-${s.num}"
            value="2" ${cnt===2?'checked':''} data-num="${s.num}" data-value="2"
            style="display:none;"/>
          선택지 2개
        </label>
      </div>`;

    if (cnt === 1) {
      portsHTML = `
        <div class="card-ports">
          ${toggleHTML}
          <div class="port-row">
            <span style="flex:1;font-size:11px;color:var(--muted);padding:2px 5px;">다음 장면으로</span>
            <div class="port-dot A" data-num="${s.num}" data-port="A" title="드래그해서 연결"></div>
          </div>
        </div>`;
    } else {
      portsHTML = `
        <div class="card-ports">
          ${toggleHTML}
          <div class="port-row">
            <input class="port-label-input js-choice-label" placeholder="선택지 A"
              value="${s.choiceA || ''}" data-num="${s.num}" data-port="A"
              style="flex:1;min-width:0;border:1.5px solid #d0e0f5;border-radius:6px;
              padding:2px 5px;font-size:11px;font-family:var(--font-b);"/>
            <div class="port-dot A" data-num="${s.num}" data-port="A" title="드래그해서 연결"></div>
          </div>
          <div class="port-row">
            <input class="port-label-input js-choice-label" placeholder="선택지 B"
              value="${s.choiceB || ''}" data-num="${s.num}" data-port="B"
              style="flex:1;min-width:0;border:1.5px solid #d0e0f5;border-radius:6px;
              padding:2px 5px;font-size:11px;font-family:var(--font-b);"/>
            <div class="port-dot B" data-num="${s.num}" data-port="B" title="드래그해서 연결"></div>
          </div>
        </div>`;
    }
  } else {
    const isTrueEnding = s.trueEnding || false;
    portsHTML = `
      <div style="padding:4px 8px 10px;">
        <div style="text-align:center;font-size:12px;color:var(--ending);margin-bottom:8px;">🏁 이야기 끝</div>
        <label style="display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;
          background:${isTrueEnding?'#fff8e8':'#f8f8f8'};
          border:1.5px solid ${isTrueEnding?'#f0c000':'#e0e0e0'};
          border-radius:50px;padding:5px 12px;">
          <input class="js-true-ending" type="checkbox" ${isTrueEnding?'checked':''}
            data-num="${s.num}" style="display:none;"/>
          <span style="font-size:14px;">${isTrueEnding?'⭐':'☆'}</span>
          <span style="font-family:var(--font-h);font-size:12px;
            color:${isTrueEnding?'#b08000':'#aaa'};">
            ${isTrueEnding?'진엔딩':'진엔딩으로 설정'}
          </span>
        </label>
      </div>`;
  }

  const starBadge = (s.type === 'ending' && s.trueEnding)
    ? `<span style="font-size:13px;margin-left:2px;" title="진엔딩">⭐</span>` : '';

  const imgAreaHtml = s.imageData
    ? `<div class="card-image-area">
        <img src="${s.imageData}" class="card-thumb js-img-thumb"
          data-num="${s.num}" title="클릭하면 크게 보기"/>
        <div style="display:flex;gap:4px;margin-top:4px;">
          <label style="flex:1;padding:3px 0;border:1.5px solid #d0e0f5;border-radius:6px;
            background:#f4f8ff;color:var(--muted);font-size:10px;cursor:pointer;
            text-align:center;font-family:var(--font-b);">
            🔄 바꾸기
            <input class="js-img-upload" type="file" accept="image/*"
              data-num="${s.num}" style="display:none"/>
          </label>
          <button class="js-img-remove" data-num="${s.num}"
            style="flex:1;padding:3px 0;border:1.5px solid #ffc0c0;border-radius:6px;
            background:#fff0f0;color:#c00;font-size:10px;cursor:pointer;font-family:var(--font-b);">
            🗑 삭제
          </button>
        </div>
      </div>`
    : `<div class="card-image-area">
        <label class="card-img-btn">
          🖼 이미지 넣기
          <input class="js-img-upload" type="file" accept="image/*"
            data-num="${s.num}" style="display:none"/>
        </label>
      </div>`;

  return `
    <div class="card-header">
      <span class="card-num-badge js-rename-btn" data-num="${s.num}"
        title="번호 바꾸기">장면 ${s.num}${starBadge}</span>
      <button class="card-delete js-delete-btn" data-num="${s.num}">✕</button>
    </div>
    ${imgAreaHtml}
    <div class="card-body">
      <div class="card-field-label">장면 내용</div>
      <textarea class="card-textarea js-title-input"
        placeholder="장면 내용을 여러 줄로 써보세요"
        data-num="${s.num}">${s.title || ''}</textarea>
      <div class="card-type-row">${radios}</div>
    </div>
    ${portsHTML}`;
}

/* ================================================================
   bindCardEvents — addEventListener만 담당, 인라인 핸들러 없음
   ================================================================ */
function bindCardEvents(el, s) {
  const num = s.num;

  /* 번호 바꾸기 */
  el.querySelector('.js-rename-btn')
    ?.addEventListener('click', () => renameScene(num));

  /* 삭제 */
  el.querySelector('.js-delete-btn')
    ?.addEventListener('click', () => deleteScene(num));

  /* 텍스트 입력 */
  const textarea = el.querySelector('.js-title-input');
  if (textarea) {
    textarea.addEventListener('focus', () => ensureEditable(num));
    textarea.addEventListener('input', e => updateTitle(num, e.target.value));
  }

  /* 종류 라디오 */
  el.querySelectorAll('.js-type-radio').forEach(radio => {
    radio.addEventListener('change', () => updateType(num, radio.dataset.value));
  });

  /* 선택지 개수 토글 */
  el.querySelectorAll('.js-cnt-radio').forEach(radio => {
    radio.addEventListener('change', () => updateChoiceCount(num, Number(radio.dataset.value)));
  });

  /* 선택지 라벨 */
  el.querySelectorAll('.js-choice-label').forEach(input => {
    input.addEventListener('change', () => updateChoiceLabel(num, input.dataset.port, input.value));
  });

  /* 진엔딩 체크박스 */
  el.querySelector('.js-true-ending')
    ?.addEventListener('change', e => updateTrueEnding(num, e.target.checked));

  /* 이미지 썸네일 — 크게 보기 */
  el.querySelector('.js-img-thumb')
    ?.addEventListener('click', e => {
      e.stopPropagation();
      openImageFull(num);
    });

  /* 이미지 업로드 */
  el.querySelectorAll('.js-img-upload').forEach(input => {
    input.addEventListener('change', () => uploadImage(num, input));
  });

  /* 이미지 삭제 */
  el.querySelector('.js-img-remove')
    ?.addEventListener('click', () => removeImage(num));

  /* 카드 드래그 */
  el.addEventListener('pointerdown', e => {
    if (['INPUT','BUTTON','LABEL','TEXTAREA','IMG'].includes(e.target.tagName)) return;
    if (e.target.classList.contains('port-dot')) return;
    if (isLockedByOther(num)) return;
    const cv    = toCanvas(e.clientX, e.clientY);
    const lockP = ensureEditable(num);
    el._pendingDrag = {
      pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      cv, num, lockP, lockOk: null
    };
    lockP.then(ok => { if (el._pendingDrag) el._pendingDrag.lockOk = ok; });
  });

  el.addEventListener('pointermove', e => {
    if (el._pendingDrag && el._pendingDrag.pointerId === e.pointerId && !dragState) {
      const dx = e.clientX - el._pendingDrag.startX;
      const dy = e.clientY - el._pendingDrag.startY;
      if (Math.sqrt(dx * dx + dy * dy) > 8) {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        const pDrag = el._pendingDrag;
        el._pendingDrag = null;
        if (pDrag.lockOk === true) {
          _startDrag(el, s, pDrag.cv);
        } else if (pDrag.lockOk === false) {
          el.releasePointerCapture(e.pointerId);
          syncCardState(num);
        } else {
          el._deferredDrag = pDrag;
          pDrag.lockP.then(ok => {
            el._deferredDrag = null;
            if (!ok) { syncCardState(num); return; }
            if (dragState || pDrag.cancelled) return;
            _startDrag(el, s, pDrag.cv);
          });
        }
      }
      return;
    }
    if (!dragState || dragState.num !== num) return;
    e.preventDefault();
    const cv = toCanvas(e.clientX, e.clientY);
    if (dragState.group) {
      dragState.nums.forEach(n => {
        const sc  = scenes[n];
        const off = dragState.offsets[n];
        sc.x = Math.max(0, cv.x + off.ox);
        sc.y = Math.max(0, cv.y + off.oy);
        const cel = document.getElementById('card-' + n);
        if (cel) { cel.style.left = sc.x + 'px'; cel.style.top = sc.y + 'px'; }
      });
    } else {
      const sc = scenes[num];
      sc.x = Math.max(0, cv.x + dragState.ox);
      sc.y = Math.max(0, cv.y + dragState.oy);
      el.style.left = sc.x + 'px';
      el.style.top  = sc.y + 'px';
    }
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => { drawArrows(); rafId = null; });
  });

  el.addEventListener('pointerup', e => {
    if (el._deferredDrag) { el._deferredDrag.cancelled = true; el._deferredDrag = null; }
    el._pendingDrag = null;
    if (!dragState || dragState.num !== num) return;
    if (dragState.group)
      dragState.nums.forEach(n => document.getElementById('card-'+n)?.classList.remove('group-selected'));
    el.classList.remove('dragging');
    touchEdit(num);
    const _n = num;
    dragState = null;
    pushToFirebase(_n);
  });

  el.addEventListener('pointercancel', () => {
    if (el._deferredDrag) { el._deferredDrag.cancelled = true; el._deferredDrag = null; }
    el._pendingDrag = null;
    if (dragState && dragState.num === num) {
      if (dragState.group)
        dragState.nums.forEach(n => document.getElementById('card-'+n)?.classList.remove('group-selected'));
      el.classList.remove('dragging');
      dragState = null;
    }
  });

  /* 포트 드래그 (연결선) */
  el.querySelectorAll('.port-dot').forEach(dot => {
    dot.style.touchAction = 'none';

    dot.addEventListener('pointerdown', async e => {
      e.stopPropagation();
      if (isLockedByOther(num)) return;
      e.preventDefault();
      dot.setPointerCapture(e.pointerId);
      const ok = await ensureEditable(num);
      if (!ok) { dot.releasePointerCapture(e.pointerId); syncCardState(num); return; }

      const port   = dot.dataset.port;
      const sc     = scenes[num];
      const startX = sc.x + 200;
      const startY = sc.y + (port === 'A' ? 120 : 140);
      connState    = { fromNum: num, port };
      const tl     = document.getElementById('temp-line');
      tl.setAttribute('display', '');
      tl.setAttribute('stroke', port === 'A' ? '#4a90d9' : '#ef476f');
      tl.setAttribute('x1', startX); tl.setAttribute('y1', startY);
      tl.setAttribute('x2', startX); tl.setAttribute('y2', startY);
    });

    dot.addEventListener('pointermove', e => {
      if (!connState) return;
      e.preventDefault();
      const cv = toCanvas(e.clientX, e.clientY);
      const tl = document.getElementById('temp-line');
      tl.setAttribute('x2', cv.x); tl.setAttribute('y2', cv.y);
      document.querySelectorAll('.scene-card').forEach(c => c.classList.remove('highlight'));
      const target = getCardAt(e.clientX, e.clientY);
      if (target && target !== connState.fromNum)
        document.getElementById('card-' + target)?.classList.add('highlight');
    });

    dot.addEventListener('pointerup', e => {
      if (!connState) return;
      document.querySelectorAll('.scene-card').forEach(c => c.classList.remove('highlight'));
      document.getElementById('temp-line').setAttribute('display', 'none');
      const target = getCardAt(e.clientX, e.clientY);
      if (target && target !== connState.fromNum)
        connect(connState.fromNum, connState.port, target);
      connState = null;
    });
  });
}

/* ================================================================
   syncCardState — 잠금/타입/비활성 상태만 기존 카드 DOM에 반영
   전체 재렌더 없이 상태 변화만 적용할 때 호출
   ================================================================ */
function syncCardState(num) {
  const el = document.getElementById('card-' + num);
  if (!el) return;
  const s      = scenes[num];
  const locked = isLockedByOther(num);

  /* 잠금 opacity */
  el.style.opacity = locked ? '0.65' : '1';

  /* 타입 클래스 */
  el.className = el.className.replace(/\btype-\S+/g, '').trim();
  if (s) el.classList.add(`type-${s.type}`);

  /* 잠금 배지 */
  let badge = el.querySelector('.lock-badge');
  if (locked) {
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'lock-badge';
      badge.style.cssText =
        'position:absolute;top:6px;right:32px;background:#6060c0;' +
        'color:#fff;font-family:var(--font-h);font-size:10px;padding:2px 8px;' +
        'border-radius:50px;z-index:11;pointer-events:none;';
      el.appendChild(badge);
    }
    badge.textContent = '🔒 편집 중';
  } else {
    badge?.remove();
  }

  /* 입력 요소 disabled */
  el.querySelectorAll('textarea, input, button:not(.card-delete)')
    .forEach(inp => locked ? inp.setAttribute('disabled','') : inp.removeAttribute('disabled'));
}

/* ================================================================
   renderCard — 오케스트레이터
   buildCardHTML → innerHTML → bindCardEvents → syncCardState
   ================================================================ */
function renderCard(s) {
  document.getElementById('card-' + s.num)?.remove();

  const el       = document.createElement('div');
  el.className   = `scene-card type-${s.type}`;
  el.id          = `card-${s.num}`;
  el.style.cssText = `position:absolute;left:${s.x}px;top:${s.y}px;`;

  el.innerHTML = buildCardHTML(s);
  bindCardEvents(el, s);

  document.getElementById('canvas').appendChild(el);
  syncCardState(s.num);   // 잠금 상태 반영
}

/* ================================================================
   연결 / 카드 위치 판별 / 화살표
   ================================================================ */
function connect(fromNum, port, toNum) {
  const s = scenes[fromNum];
  if (!s) return;
  if (port === 'A') s.nextA = toNum;
  else              s.nextB = toNum;
  renderCard(s);
  drawArrows();
  pushToFirebase();
}

function getCardAt(clientX, clientY) {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    if (el.classList.contains('scene-card'))
      return parseInt(el.id.replace('card-', ''));
  }
  return null;
}

function drawArrows() {
  const svg = document.getElementById('arrows');
  svg.querySelectorAll('path.arrow, text.arrow-label, rect.arrow-label').forEach(el => el.remove());
  Object.values(scenes).forEach(s => { drawArrow(svg, s, 'A'); drawArrow(svg, s, 'B'); });
}

function drawArrow(svg, s, port) {
  if (port === 'B' && (s.choiceCount || 2) === 1) return;
  const next = port === 'A' ? s.nextA : s.nextB;
  if (!next || !scenes[next]) return;
  const t = scenes[next];

  const x1 = s.x + 200, y1 = s.y + (port === 'A' ? 120 : 140);
  const x2 = t.x,        y2 = t.y + 50;
  const cx = (x1 + x2) / 2;
  const color    = port === 'A' ? '#4a90d9' : '#ef476f';
  const markerId = port === 'A' ? 'ahA' : 'ahB';
  const label    = port === 'A' ? (s.choiceA || 'A') : (s.choiceB || 'B');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('class', 'arrow');
  path.setAttribute('d', `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', '2');
  path.setAttribute('marker-end', `url(#${markerId})`);
  path.setAttribute('opacity', '0.85');
  svg.appendChild(path);

  if (label && label !== 'A' && label !== 'B') {
    const lx = x1 + 6, ly = y1 - 16;
    const lw = Math.min(label.length * 8 + 8, 80), lh = 16;

    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('class', 'arrow-label');
    bg.setAttribute('x', lx);  bg.setAttribute('y', ly);
    bg.setAttribute('width', lw); bg.setAttribute('height', lh);
    bg.setAttribute('rx', '8'); bg.setAttribute('fill', color);
    bg.setAttribute('opacity', '0.18');
    svg.appendChild(bg);

    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('class', 'arrow-label');
    txt.setAttribute('x', lx + lw / 2); txt.setAttribute('y', ly + 11);
    txt.setAttribute('font-size', '10'); txt.setAttribute('fill', color);
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('font-family', 'Nanum Gothic,sans-serif');
    txt.setAttribute('font-weight', 'bold');
    txt.textContent = label.length > 9 ? label.slice(0,9) + '…' : label;
    svg.appendChild(txt);
  }
}
