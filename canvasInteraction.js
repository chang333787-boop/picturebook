/* ================================================================
   canvasInteraction.js — 캔버스 인터랙션
   (드래그 헬퍼 / 팬 / 줌 / 터치 / 묶음 이동)
   의존: state.js (zoom, canvasOffX/Y, panState, pinchState, dragState)
   런타임 호출: drawArrows() → sceneRenderer.js, pushToFirebase() → firebase.js
   ================================================================ */

function getCanvas() { return document.getElementById('canvas'); }
function getWrap()   { return document.getElementById('canvas-wrap'); }

/* v118: RAF로 묶음 + translate3d 적용 — iPad/Android tablet 부드러움.
   옛엔 매 touchmove마다 style.transform 직접 갱신 → 60+ frame/초 부담.
   RAF로 묶으면 한 frame에 한 번만 갱신. translate3d를 쓰면 GPU layer가 강제됨. */
let _xfPending = false;
function applyTransform() {
  if (_xfPending) return;
  _xfPending = true;
  requestAnimationFrame(() => {
    _xfPending = false;
    const canvas = getCanvas();
    /* translate3d 적용 (translateZ(0) 효과로 GPU 가속). transform-origin: 0 0 은 CSS에 지정돼 있음. */
    canvas.style.transform = `translate3d(${canvasOffX}px, ${canvasOffY}px, 0) scale(${zoom})`;
    const label = document.getElementById('zoom-label');
    if (label) label.textContent = Math.round(zoom * 100) + '%';
  });
}

function getTouchDist(t) {
  const dx = t[0].clientX - t[1].clientX;
  const dy = t[0].clientY - t[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function toCanvas(clientX, clientY) {
  const wrap = getWrap();
  const rect = wrap.getBoundingClientRect();
  return {
    x: (clientX - rect.left - canvasOffX) / zoom,
    y: (clientY - rect.top  - canvasOffY) / zoom
  };
}

/* ── 줌 ── */
function setZoom(val) {
  zoom = Math.min(2.0, Math.max(0.3, Math.round(val * 10) / 10));
  applyTransform();
}

/* ── 드래그 시작 헬퍼 — 잠금 확보 후에만 호출됨
   ─────────────────────────────────────────────────────────────
   호출 시점 전제: 개별/묶음 모두 호출자(sceneRenderer pointermove)가
   `ensureEditable`로 필요한 모든 장면의 잠금을 확보한 뒤 호출함.
   즉 이 함수가 실행되는 순간 이미 잠금 ok 상태.
   ═════════════════════════════════════════════════════════════ */
let rafId = null;

function _startDrag(el, s, cv) {
  if (dragState) return;

  if (groupMoveOn) {
    const nums    = getConnectedNums(s.num);
    const offsets = {};
    nums.forEach(n => {
      const sc    = scenes[n];
      offsets[n]  = { ox: sc.x - cv.x, oy: sc.y - cv.y };
      document.getElementById('card-' + n)?.classList.add('group-selected');
    });
    dragState = { num: s.num, group: true, nums, offsets };
  } else {
    /* RENDER-DIFF-1(2026-07-10): 클로저 s 대신 전역 scenes 기준 — 부분 렌더 도입으로
       재렌더 안 된 카드의 클로저 s가 옛 에코의 분리된 객체(옛 좌표)로 남을 수 있어,
       그 좌표로 오프셋을 계산하면 재드래그 시 카드가 옛 위치로 점프백함.
       pointermove가 이미 전역 scenes[num]을 갱신하므로 기준을 통일한다(그룹 분기와 동일). */
    const sc = (typeof scenes !== 'undefined' && scenes[s.num]) ? scenes[s.num] : s;
    dragState = { num: s.num, ox: sc.x - cv.x, oy: sc.y - cv.y };
  }
  el.classList.add('dragging');
}

/* ── 묶음 이동 사전 잠금 (all-or-nothing) ──
   호출 시점: pointerdown 시. connected 장면 전체에 대해 ensureEditable 시도.
   반환: Promise<boolean> — 모두 성공하면 true, 하나라도 실패하면 false.
   ⚠ 부분 성공이 나올 수 있지만 그 경우 전체가 실패로 보고됨(drag 취소).
     이미 획득한 잠금은 TTL(~idle timeout)로 자연 해제됨. */
async function ensureEditableForGroup(nums) {
  const results = await Promise.all(nums.map(n => ensureEditable(n)));
  return results.every(ok => ok === true);
}

/* ── 묶음 이동 ── */
let groupMoveOn = false;

function toggleGroupMove() {
  groupMoveOn = !groupMoveOn;
  document.body.classList.toggle('group-mode', groupMoveOn);
  const btn = document.getElementById('btn-group-move');
  btn.textContent = '🔗 묶음 이동: ' + (groupMoveOn ? '켜짐' : '꺼짐');
}

function getConnectedNums(startNum) {
  const visited = new Set();
  /* 모든 num을 String으로 일관 처리 — visited Set이 1과 '1'을 다른 키로 보지 않도록.
     scenes 객체의 key는 어차피 string. */
  const queue   = [String(startNum)];

  /* W2-B-β: 한 장면의 모든 next 대상 num 수집.
     buttons[].nextId 우선, 없으면 nextA/nextB fallback (legacy 호환).
     W6: 체험전시형은 connectObjects[].nextId 사용 (back/home 제외 — 시스템 액션). */
  function _outgoingNums(s) {
    if (!s) return [];
    const out = [];
    /* 체험전시형 분기 — projectMeta 기반 */
    const _ptype = (typeof projectMeta !== 'undefined' && projectMeta && projectMeta.projectType) || null;
    if (_ptype === 'experience') {
      if (Array.isArray(s.connectObjects) && s.connectObjects.length > 0) {
        s.connectObjects.forEach(co => {
          if (!co || co.type === 'back' || co.type === 'home') return;
          if (co.nextId) out.push(String(co.nextId));
        });
      }
      return out;
    }
    /* 그 외 모드: 기존 buttons[] 흐름 */
    if (Array.isArray(s.buttons) && s.buttons.length > 0) {
      s.buttons.forEach(b => {
        if (b && b.nextId) out.push(String(b.nextId));
      });
    } else {
      if (s.nextA) out.push(String(s.nextA));
      if (s.nextB) out.push(String(s.nextB));
    }
    return out;
  }

  /* 한 장면이 num을 next로 가리키는지 체크 (역방향 탐색용) */
  function _pointsToNum(sc, num) {
    if (!sc) return false;
    const target = String(num);
    /* 체험전시형 분기 */
    const _ptype = (typeof projectMeta !== 'undefined' && projectMeta && projectMeta.projectType) || null;
    if (_ptype === 'experience') {
      if (Array.isArray(sc.connectObjects) && sc.connectObjects.length > 0) {
        return sc.connectObjects.some(co => {
          if (!co || co.type === 'back' || co.type === 'home') return false;
          return String(co.nextId || '') === target;
        });
      }
      return false;
    }
    /* 그 외 */
    if (Array.isArray(sc.buttons) && sc.buttons.length > 0) {
      return sc.buttons.some(b => b && String(b.nextId || '') === target);
    }
    return String(sc.nextA || '') === target || String(sc.nextB || '') === target;
  }

  while (queue.length) {
    const num = queue.shift();
    if (visited.has(num)) continue;
    visited.add(num);
    const s = scenes[num];
    if (!s) continue;

    /* 정방향: 이 장면의 next 대상들 */
    _outgoingNums(s).forEach(nextNum => {
      if (scenes[nextNum] && !visited.has(nextNum)) queue.push(nextNum);
    });

    /* 역방향: 이 장면을 가리키는 모든 장면 */
    Object.values(scenes).forEach(sc => {
      if (_pointsToNum(sc, num)) {
        const scNum = String(sc.num);
        if (!visited.has(scNum)) queue.push(scNum);
      }
    });
  }
  return [...visited];
}

/* ── 마우스: 배경 팬 ── */
window.addEventListener('DOMContentLoaded', () => {
  const wrap = getWrap();

  wrap.addEventListener('mousedown', e => {
    if (e.button !== 0) return; /* CROSS-A: 우클릭/중클릭 팬 방지 */
    if (e.target === wrap || e.target === getCanvas() || e.target.id === 'arrows')
      panState = { lastX: e.clientX, lastY: e.clientY };
  });

  document.addEventListener('mousemove', e => {
    if (!panState) return;
    canvasOffX += e.clientX - panState.lastX;
    canvasOffY += e.clientY - panState.lastY;
    panState.lastX = e.clientX;
    panState.lastY = e.clientY;
    applyTransform();
  });

  document.addEventListener('mouseup', () => { panState = null; });

  /* CROSS-B: 터치 기기에서 카드/캔버스 long-press 시 브라우저 컨텍스트 메뉴(이미지 저장 등)가
     드래그와 겹치던 문제 — 터치 기기(any-pointer:coarse)에서만, 캔버스 영역 한정 차단.
     마우스 전용 PC의 우클릭 메뉴는 그대로. */
  if (window.matchMedia && matchMedia('(any-pointer: coarse)').matches) {
    wrap.addEventListener('contextmenu', e => e.preventDefault());
  }

  /* ── 휠: Ctrl/Meta+휠 = 줌(delta 비례), 일반 휠 = 캔버스 팬 ──
     CROSS-A(2026-07-10):
     · 기존엔 Ctrl 없는 휠을 통째로 무시 → 윈도우 마우스/트랙패드로 캔버스 이동 불가
       (팬 수단이 빈 배경 드래그뿐). 이제 휠=팬(맥 트랙패드 두손가락·윈도우 휠 세로,
       shift+휠=가로 관례). Firefox deltaMode=1(줄 단위)은 ×16 px 근사 보정.
     · 줌도 고정 ±0.1 → delta 비례 + frame당 8% clamp(터치 핀치 v120-lite와 동일 정책)
       — 크롬북/정밀 터치패드 핀치(ctrlKey 합성 휠 초당 ~60회)에서 폭주하던 문제. */
  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const unit = (e.deltaMode === 1) ? 16 : 1;
    if (e.ctrlKey || e.metaKey) {
      const oldZoom = zoom;
      const factor = Math.max(0.92, Math.min(1.08, Math.exp(-e.deltaY * unit * 0.0015)));
      zoom = Math.min(2.0, Math.max(0.3, zoom * factor));
      const rect = wrap.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      canvasOffX = mx - (mx - canvasOffX) * (zoom / oldZoom);
      canvasOffY = my - (my - canvasOffY) * (zoom / oldZoom);
      applyTransform();
      return;
    }
    let dx = e.deltaX * unit, dy = e.deltaY * unit;
    if (e.shiftKey && dx === 0) { dx = dy; dy = 0; }
    canvasOffX -= dx;
    canvasOffY -= dy;
    applyTransform();
  }, { passive: false });

  /* ── 터치: 핀치줌 + 배경 팬 ── */
  wrap.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      e.preventDefault();
      panState   = null;
      const startMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const startMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      pinchState = {
        dist: getTouchDist(e.touches), zoom,
        offX: canvasOffX, offY: canvasOffY,
        midX: startMidX, midY: startMidY,
        /* v117: 매 frame mid 변화량으로 pan도 같이 적용 (두 손가락 같이 움직이면 자연 pan) */
        lastMidX: startMidX, lastMidY: startMidY
      };
    } else if (e.touches.length === 1) {
      const t  = e.touches[0];
      const el = document.elementFromPoint(t.clientX, t.clientY);
      if (!el || !el.closest('.scene-card')) {
        e.preventDefault();
        /* CROSS-B: preventDefault로 click이 안 생겨 배경 탭이 입력 포커스 해제·열린 메뉴
           닫기를 못 하던 것 보완(터치 기기에서 메뉴가 안 닫히던 문제). */
        const ae = document.activeElement;
        if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
        const _fm = document.getElementById('file-more-menu');
        if (_fm && !_fm.hidden) {
          _fm.hidden = true;
          document.getElementById('btn-file-more')?.setAttribute('aria-expanded', 'false');
        }
        panState = { lastX: t.clientX, lastY: t.clientY };
      }
    }
  }, { passive: false });

  wrap.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 2 && pinchState) {
      const newDist = getTouchDist(e.touches);
      /* v120-lite: 빠른 pinch에서 한 frame의 zoom 변화가 너무 큼 → 튐. 두 가지 보완:
         1. pinchState.zoom/dist = 시작 시점 고정이 아니라 매 frame 값으로 갱신 →
            ratio = 직전 frame 기준 (옛엔 시작 frame 기준 → 빠른 pinch에서 누적).
         2. ratio clamp 0.92~1.08 — frame당 zoom 변화 최대 8%. 빠른 pinch에서도
            점진적으로 변함 (사용자가 고른 A안). */
      const rawRatio = newDist / pinchState.dist;
      const ratio = Math.max(0.92, Math.min(1.08, rawRatio));
      const newZoom = Math.round(
        Math.min(2.0, Math.max(0.3, pinchState.zoom * ratio)) * 100) / 100;
      /* v117: 매 frame 핀치 중심을 다시 계산 — 옛엔 시작 시점 mid만 사용해 손가락이 움직이면
         mid가 옛 위치라 zoom-to-point가 어긋남. 매번 두 손가락 중간을 다시 구해 그
         지점 기준으로 zoom + pan 적용 (두 손가락 같이 움직이면 자연스럽게 pan). */
      const rect = wrap.getBoundingClientRect();
      const curMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const curMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const mx = curMidX - rect.left;
      const my = curMidY - rect.top;
      /* zoom-to-point: 현재 mid가 가리키는 world 좌표를 구한 후, 새 zoom에서도
         같은 screen point에 오도록 pan 조정 */
      const worldX = (mx - canvasOffX) / zoom;
      const worldY = (my - canvasOffY) / zoom;
      zoom = newZoom;
      canvasOffX = mx - worldX * zoom;
      canvasOffY = my - worldY * zoom;
      /* pan: 현재 mid가 직전 mid에서 이동한 만큼 pan (두 손가락이 같이 움직인 몫) */
      canvasOffX += (curMidX - pinchState.lastMidX);
      canvasOffY += (curMidY - pinchState.lastMidY);
      pinchState.lastMidX = curMidX;
      pinchState.lastMidY = curMidY;
      /* v120-lite: pinchState 기준값 갱신 — 다음 frame의 ratio는 직전 frame 기준 */
      pinchState.dist = newDist;
      pinchState.zoom = newZoom;
      applyTransform();
      return;
    }
    if (e.touches.length === 1 && panState) {
      const t = e.touches[0];
      canvasOffX += t.clientX - panState.lastX;
      canvasOffY += t.clientY - panState.lastY;
      panState.lastX = t.clientX;
      panState.lastY = t.clientY;
      applyTransform();
    }
  }, { passive: false });

  wrap.addEventListener('touchend', e => {
    if (e.touches.length < 2) pinchState = null;
    if (e.touches.length === 0) panState = null;
  }, { passive: false });
});

/* v69: 사이드 리스트 클릭 시 캔버스를 카드 위치로 이동.
   사용자: "장면들 누르면 그 장면 브랜치로 화면 이동". sceneRenderer의
   _focusSceneInCanvas가 호출하는 함수 — 정의돼 있지 않아 화면 이동이 안 됐음. */
function panToCard(num) {
  const wrap   = getWrap();
  const canvas = getCanvas();
  const card   = document.getElementById(`card-${num}`);
  if (!wrap || !canvas || !card) return;

  const wrapRect = wrap.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();

  /* 카드 가운데와 wrap 가운데의 차이만큼 canvas 이동 */
  const cardCenterX = cardRect.left + cardRect.width  / 2;
  const cardCenterY = cardRect.top  + cardRect.height / 2;
  const wrapCenterX = wrapRect.left + wrapRect.width  / 2;
  const wrapCenterY = wrapRect.top  + wrapRect.height / 2;

  canvasOffX += (wrapCenterX - cardCenterX);
  canvasOffY += (wrapCenterY - cardCenterY);

  /* 부드러운 이동 — transition 일시 적용 후 0.4s 뒤 해제 */
  canvas.style.transition = 'transform 0.4s ease-out';
  applyTransform();
  setTimeout(() => { canvas.style.transition = ''; }, 450);
}
/* centerOnCard alias (sceneRenderer.js가 둘 다 시도) */
function centerOnCard(num) { panToCard(num); }
