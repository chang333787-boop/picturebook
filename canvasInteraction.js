/* ================================================================
   canvasInteraction.js — 캔버스 인터랙션
   (드래그 헬퍼 / 팬 / 줌 / 터치 / 묶음 이동)
   의존: state.js (zoom, canvasOffX/Y, panState, pinchState, dragState)
   런타임 호출: drawArrows() → sceneRenderer.js, pushToFirebase() → firebase.js
   ================================================================ */

function getCanvas() { return document.getElementById('canvas'); }
function getWrap()   { return document.getElementById('canvas-wrap'); }

function applyTransform() {
  const canvas = getCanvas();
  canvas.style.zoom      = zoom;
  canvas.style.transform = `translate(${canvasOffX}px,${canvasOffY}px)`;
  document.getElementById('zoom-label').textContent = Math.round(zoom * 100) + '%';
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

/* ── 드래그 시작 헬퍼 — 잠금 확보 후에만 호출됨 ── */
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
    dragState = { num: s.num, ox: s.x - cv.x, oy: s.y - cv.y };
  }
  el.classList.add('dragging');
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
  const queue   = [startNum];
  while (queue.length) {
    const num = queue.shift();
    if (visited.has(num)) continue;
    visited.add(num);
    const s = scenes[num];
    if (!s) continue;
    if (s.nextA && scenes[s.nextA]) queue.push(s.nextA);
    if (s.nextB && scenes[s.nextB]) queue.push(s.nextB);
    Object.values(scenes).forEach(sc => {
      if (sc.nextA === num || sc.nextB === num) queue.push(sc.num);
    });
  }
  return [...visited];
}

/* ── 마우스: 배경 팬 ── */
window.addEventListener('DOMContentLoaded', () => {
  const wrap = getWrap();

  wrap.addEventListener('mousedown', e => {
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

  /* ── Ctrl+휠 줌 ── */
  wrap.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const oldZoom = zoom;
    zoom = Math.min(2.0, Math.max(0.3,
      Math.round((zoom + (e.deltaY < 0 ? 0.1 : -0.1)) * 10) / 10));
    const rect = wrap.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    canvasOffX = mx - (mx - canvasOffX) * (zoom / oldZoom);
    canvasOffY = my - (my - canvasOffY) * (zoom / oldZoom);
    applyTransform();
  }, { passive: false });

  /* ── 터치: 핀치줌 + 배경 팬 ── */
  wrap.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      e.preventDefault();
      panState   = null;
      pinchState = {
        dist: getTouchDist(e.touches), zoom,
        offX: canvasOffX, offY: canvasOffY,
        midX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        midY: (e.touches[0].clientY + e.touches[1].clientY) / 2
      };
    } else if (e.touches.length === 1) {
      const t  = e.touches[0];
      const el = document.elementFromPoint(t.clientX, t.clientY);
      if (!el || !el.closest('.scene-card')) {
        e.preventDefault();
        panState = { lastX: t.clientX, lastY: t.clientY };
      }
    }
  }, { passive: false });

  wrap.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 2 && pinchState) {
      const newDist = getTouchDist(e.touches);
      zoom = Math.round(
        Math.min(2.0, Math.max(0.3, pinchState.zoom * newDist / pinchState.dist)) * 100) / 100;
      const rect = wrap.getBoundingClientRect();
      const mx = pinchState.midX - rect.left, my = pinchState.midY - rect.top;
      canvasOffX = mx - (mx - pinchState.offX) * (zoom / pinchState.zoom);
      canvasOffY = my - (my - pinchState.offY) * (zoom / pinchState.zoom);
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
