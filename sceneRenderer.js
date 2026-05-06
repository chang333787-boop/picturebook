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
  /* 장면 타입 언어 정리 1차:
     · UI 노출 타입은 '일반 / 엔딩' 2종만
     · 기존 data의 type === 'start' 값은 라디오에서 '일반' 선택으로 보임
       (데이터는 그대로 유지 — 사용자가 라디오를 만질 때만 'normal'로 변경) */
  const types  = ['normal', 'ending'];
  const labels = ['일반', '엔딩'];
  const currentType = (s.type === 'ending') ? 'ending' : 'normal';   // 'start' → 'normal' 표시

  const radios = types.map((t, i) =>
    `<input class="type-radio js-type-radio" type="radio"
       name="type-${s.num}" id="tr-${s.num}-${t}"
       value="${t}" ${currentType === t ? 'checked' : ''} data-num="${s.num}" data-value="${t}">
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

  /* ── 역할 배지: projectMeta.entrySceneId/replaySceneId와 비교 ──
     '시작'을 장면 종류가 아니라 역할로 표시 (UI 언어 정리 1차) */
  const pm          = (typeof projectMeta === 'object' && projectMeta) ? projectMeta : {};
  const isEntry     = pm.entrySceneId  !== null && pm.entrySceneId  !== undefined
                    && String(pm.entrySceneId)  === String(s.num);
  const isReplay    = pm.replaySceneId !== null && pm.replaySceneId !== undefined
                    && String(pm.replaySceneId) === String(s.num);
  const roleBadges  = [
    isEntry  ? '<span style="display:inline-block;font-size:10px;line-height:1;padding:3px 6px;border-radius:8px;background:#e8f5e9;color:#2e7d32;border:1px solid #81c784;margin-left:4px;font-family:var(--font-h);" title="첫 감상자가 시작하는 장면">첫 감상 시작</span>' : '',
    isReplay ? '<span style="display:inline-block;font-size:10px;line-height:1;padding:3px 6px;border-radius:8px;background:#e3f2fd;color:#1565c0;border:1px solid #90caf9;margin-left:4px;font-family:var(--font-h);" title="다른 결말 찾기에서 시작하는 장면">다시 시작점</span>' : '',
  ].join('');

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
        title="번호 바꾸기">장면 ${s.num}${starBadge}</span>${roleBadges}
      <button class="card-delete js-delete-btn" data-num="${s.num}">✕</button>
    </div>
    ${imgAreaHtml}
    <div class="card-body">
      <div class="card-field-label">제목</div>
      <textarea class="card-textarea js-title-input"
        placeholder="장면 제목 또는 짧은 글"
        data-num="${s.num}">${s.title || ''}</textarea>
      ${_bodyPreviewHtml(s)}
      <div class="card-type-row">${radios}${_modeBadgeHtml(s)}</div>
    </div>
    ${portsHTML}`;
}

/* ── 본문 미리보기 (title/body 분리 1차) ──
   · body 있음: 1~2줄 회색 미리보기 + 다듬기에서 수정 힌트
   · body 없음: 표시 안 함 — 카드는 기존과 거의 동일 인상 유지
   · branch는 구조 설계기이므로 본문은 카드 안에서 편집하지 않음 (다듬기 화면에서) */
function _bodyPreviewHtml(s) {
  const body = (s && typeof s.body === 'string') ? s.body.trim() : '';
  if (!body) return '';
  /* 한 줄, 최대 60자 말줄임 — 카드 높이 1줄로 고정 */
  const oneLine = body.replace(/\s+/g, ' ').trim();
  const preview = oneLine.length > 60 ? oneLine.slice(0, 60) + '…' : oneLine;
  /* HTML escape — & / < / > / 따옴표 모두 */
  const safe = preview
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return `<div class="card-body-preview" title="본문은 다듬기 화면에서 수정해요">${safe}</div>`;
}

/* ── 모드 배지 (모드 시스템 뼈대 1차) ──
   · scene.presentationMode 값을 작은 배지로 표시 (text/picturebook/movie/document)
   · 명시 설정된 경우만 표시 — null이면 배지 없음 (branch는 구조 설계기, 깔끔함 유지)
   · 편집 UI 아님 — 모드 변경은 다듬기 화면(viewer-edit)에서만 */
function _modeBadgeHtml(s) {
  const m = s && s.presentationMode;
  if (m !== 'text' && m !== 'picturebook' && m !== 'movie' && m !== 'document') return '';
  const meta = {
    text:        { icon: '📝', label: '텍스트' },
    picturebook: { icon: '🎨', label: '그림책' },
    movie:       { icon: '🎬', label: '무비' },
    document:    { icon: '📜', label: '기록물' },
  }[m];
  return `<span class="card-mode-badge card-mode-badge--${m}" title="장면 모드: ${meta.label} (다듬기 화면에서 변경)">${meta.icon} ${meta.label}</span>`;
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
    /* blur 시 debounced save 즉시 flush — 포커스 떠날 때 유실 방지 */
    textarea.addEventListener('blur',  () => flushTitleSaves(num));
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

  /* ── 카드 드래그 (개별 / 묶음) ──
     핵심 정책: 이동도 편집. 잠금 확보 전 드래그 시작 금지.
     · 개별: 해당 장면 ensureEditable, 실패 시 드래그 안 함
     · 묶음(groupMoveOn): connected 장면 전체 잠금 확보, 하나라도 실패하면 취소 */
  el.addEventListener('pointerdown', e => {
    if (['INPUT','BUTTON','LABEL','TEXTAREA','IMG'].includes(e.target.tagName)) return;
    if (e.target.classList.contains('port-dot')) return;

    const cv = toCanvas(e.clientX, e.clientY);

    if (groupMoveOn) {
      const nums = getConnectedNums(num);

      /* 1차 사전 체크: 다른 사람이 편집 중인 장면이 하나라도 있으면 즉시 거부.
         드래그 시작조차 하지 않음 — 사용자가 움직였는데 갑자기 취소되는 일 없음 */
      const blockedByOther = nums.filter(n => isLockedByOther(n));
      if (blockedByOther.length > 0) {
        alert(`묶음 이동을 할 수 없어요.\n다른 사람이 편집 중: 장면 ${blockedByOther.join(', ')}`);
        return;
      }

      /* 2차 All-or-nothing 잠금 — 내 세션으로 전부 확보 시도 */
      const lockAllP = ensureEditableForGroup(nums);
      el._pendingDrag = {
        pointerId: e.pointerId,
        startX: e.clientX, startY: e.clientY,
        cv, num, group: true, nums,
        lockAllP, lockAllOk: null
      };
      lockAllP.then(ok => { if (el._pendingDrag) el._pendingDrag.lockAllOk = ok; });
    } else {
      /* 개별 이동 — 내가 대상 장면 잠글 수 있어야 함 */
      if (isLockedByOther(num)) return;
      const lockP = ensureEditable(num);
      el._pendingDrag = {
        pointerId: e.pointerId,
        startX: e.clientX, startY: e.clientY,
        cv, num, lockP, lockOk: null
      };
      lockP.then(ok => { if (el._pendingDrag) el._pendingDrag.lockOk = ok; });
    }
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

        if (pDrag.group) {
          /* 묶음 이동 — all-or-nothing 검증 */
          if (pDrag.lockAllOk === true) {
            _startDrag(el, s, pDrag.cv);
          } else if (pDrag.lockAllOk === false) {
            el.releasePointerCapture(e.pointerId);
            alert('일부 장면을 잠글 수 없어서 묶음 이동을 취소했어요.');
          } else {
            /* 잠금 아직 대기 중 — 완료될 때까지 기다림 */
            el._deferredDrag = pDrag;
            pDrag.lockAllP.then(ok => {
              el._deferredDrag = null;
              if (!ok) {
                alert('일부 장면을 잠글 수 없어서 묶음 이동을 취소했어요.');
                return;
              }
              if (dragState || pDrag.cancelled) return;
              _startDrag(el, s, pDrag.cv);
            });
          }
        } else {
          /* 개별 이동 */
          if (pDrag.lockOk === true) {
            _startDrag(el, s, pDrag.cv);
          } else if (pDrag.lockOk === false) {
            el.releasePointerCapture(e.pointerId);
            syncCardState(num);
            alert('다른 사람이 편집 중인 장면은 이동할 수 없어요.');
          } else {
            el._deferredDrag = pDrag;
            pDrag.lockP.then(ok => {
              el._deferredDrag = null;
              if (!ok) {
                syncCardState(num);
                alert('다른 사람이 편집 중인 장면은 이동할 수 없어요.');
                return;
              }
              if (dragState || pDrag.cancelled) return;
              _startDrag(el, s, pDrag.cv);
            });
          }
        }
      }
      return;
    }
    if (!dragState || dragState.num !== num) return;
    e.preventDefault();
    const cv = toCanvas(e.clientX, e.clientY);
    if (dragState.group) {
      /* ★ 그룹 단위 clamp — 각 장면을 따로 Math.max(0,...)하면
         왼쪽/위 경계에 닿은 장면만 멈추고 다른 장면은 계속 이동해서 상대 위치가 깨짐.
         그룹 전체의 proposed 좌표 중 가장 작은 값을 찾아 전체에 offset을 더함. */
      /* 1차: 각 장면의 예상 좌표 계산 */
      const proposed = {};
      let minX = Infinity, minY = Infinity;
      dragState.nums.forEach(n => {
        const off = dragState.offsets[n];
        const px  = cv.x + off.ox;
        const py  = cv.y + off.oy;
        proposed[n] = { x: px, y: py };
        if (px < minX) minX = px;
        if (py < minY) minY = py;
      });
      /* 2차: 그룹 전체가 경계 안으로 들어오도록 offset 보정 */
      const shiftX = minX < 0 ? -minX : 0;
      const shiftY = minY < 0 ? -minY : 0;
      /* 3차: 실제 반영 — 상대 위치 완벽 유지 */
      dragState.nums.forEach(n => {
        const sc  = scenes[n];
        sc.x = proposed[n].x + shiftX;
        sc.y = proposed[n].y + shiftY;
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
    const wasGroup = !!dragState.group;
    const groupNums = wasGroup ? dragState.nums.slice() : [num];
    if (wasGroup)
      dragState.nums.forEach(n => document.getElementById('card-'+n)?.classList.remove('group-selected'));
    el.classList.remove('dragging');
    touchEdit(num);
    dragState = null;
    /* ★ 그룹 이동 시 모든 장면 저장 (기존엔 시작 장면만 저장해서 좌표 반영 안 됨) */
    groupNums.forEach(n => pushToFirebase(n));
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
