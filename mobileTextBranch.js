/* ================================================================
   mobileTextBranch.js — 모바일 텍스트형 브랜치 전용 UI
   ─────────────────────────────────────────────────────────────────
   목적: 모바일 환경 + 텍스트형 작품에서 데스크탑 canvas 대신 노드 중심
   브랜치 화면 박음. 사용자 설계 (v95~):
   · 동그라미 숫자 노드 = 장면
   · BFS 자동 배치 (Step 2)
   · 노드 탭 → 장면 편집 화면 (Step 3+)
   · 길게 누르기 → 행동버튼 연결 (Step 4+)

   Step 1 (지금): 진입 흐름 + 빈 화면 + PC 토글
   ──────────────────────────────────────────────────────────────── */

const MTB = {
  active: false,         /* 현재 모바일 UI 활성인지 */
  pcOverride: false,     /* 사용자가 "🖥 PC" 토글했는지 */
  enabled: true,         /* 초기화 박혔는지 */
};

/* ── 모바일 감지 ──
   UA 또는 viewport width < 768px. 데스크탑 가로 모드 태블릿은 포함 X. */
function _mtbIsMobile() {
  if (MTB.pcOverride) return false;
  const ua = navigator.userAgent || '';
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return true;
  /* iPad는 ua가 데스크탑처럼 박힘 — viewport 검사 */
  if (window.innerWidth < 768) return true;
  return false;
}

/* ── 텍스트형 작품인지 ──
   projectMeta.projectType === 'text' (firebase.js에서 박음).
   작품 로드 전엔 null — 그 경우 false. */
function _mtbIsTextProject() {
  if (typeof projectMeta === 'undefined' || !projectMeta) return false;
  return projectMeta.projectType === 'text';
}

/* ── 진입 결정 ──
   모바일 + 텍스트형 + 비교사 모드(?admin 없음)일 때 모바일 UI 활성.
   교사 관리 화면(?admin=1)은 데스크탑 우선 — 모바일이어도 데스크탑. */
function _mtbShouldActivate() {
  if (!MTB.enabled) return false;
  if (!_mtbIsTextProject()) return false;
  if (!_mtbIsMobile()) return false;
  const isAdmin = new URLSearchParams(location.search).get('admin') === '1';
  if (isAdmin) return false;
  return true;
}

/* ── 진입/종료 ── */
function _mtbActivate() {
  const root = document.getElementById('mobile-text-branch');
  const canvasWrap = document.getElementById('canvas-wrap');
  if (!root) return;
  root.style.display = 'flex';
  if (canvasWrap) canvasWrap.style.display = 'none';
  /* toolbar는 모바일 텍스트형엔 어울리지 않음 — 가림 */
  const toolbar = document.getElementById('toolbar');
  if (toolbar) toolbar.style.display = 'none';
  MTB.active = true;
  /* v96: 진입 시 노드 렌더 */
  _mtbRender();
}

/* ── v96: BFS 자동 배치 + 노드/SVG 렌더 ──
   설계:
   · entrySceneId 또는 첫 scene을 root로 BFS
   · depth = y, 같은 depth 가로 균등 = x
   · 고립 노드 (BFS 못 닿음)은 별도 박음
   · 노드 = div, 연결선 = SVG path (베지어 곡선) */

const MTB_NODE_W   = 48;
const MTB_GAP_X    = 80;     /* 노드 간 가로 간격 (중심~중심) */
const MTB_GAP_Y    = 100;    /* depth 간 세로 간격 */
const MTB_TOP_PAD  = 60;     /* 상단 여백 */

function _mtbBuildLayout() {
  if (typeof scenes !== 'object' || !scenes) return null;
  const sceneIds = Object.keys(scenes);
  if (!sceneIds.length) return null;

  /* entry scene 결정 — projectMeta 우선, fallback = type==='cover' 또는 type==='start' 또는 첫 num */
  let entryId = null;
  if (typeof projectMeta !== 'undefined' && projectMeta && projectMeta.entrySceneId) {
    entryId = String(projectMeta.entrySceneId);
  }
  if (!entryId || !scenes[entryId]) {
    /* cover scene이 있으면 그것부터 */
    entryId = sceneIds.find(id => scenes[id] && scenes[id].type === 'cover');
  }
  if (!entryId) {
    entryId = sceneIds.find(id => scenes[id] && scenes[id].type === 'start');
  }
  if (!entryId) entryId = sceneIds.sort((a, b) => Number(a) - Number(b))[0];

  /* BFS — depth 계산 */
  const depths = new Map();
  const queue = [{ id: entryId, depth: 0 }];
  const visited = new Set();
  while (queue.length) {
    const { id, depth } = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    depths.set(id, depth);
    const sc = scenes[id];
    if (!sc) continue;
    const buttons = Array.isArray(sc.buttons) ? sc.buttons : [];
    buttons.forEach(btn => {
      if (btn && btn.nextId) {
        const nid = String(btn.nextId);
        if (!visited.has(nid) && scenes[nid]) {
          queue.push({ id: nid, depth: depth + 1 });
        }
      }
    });
  }

  /* 고립 노드 — BFS 못 닿음. 가장 깊은 depth + 1 박음 */
  let maxDepth = 0;
  depths.forEach(d => { if (d > maxDepth) maxDepth = d; });
  sceneIds.forEach(id => {
    if (!depths.has(id)) depths.set(id, maxDepth + 1);
  });

  /* depth별 묶기 */
  const byDepth = new Map();
  depths.forEach((d, id) => {
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d).push(id);
  });
  /* 각 depth 안에서 num 순 정렬 (안정적 박치기) */
  byDepth.forEach(arr => arr.sort((a, b) => Number(a) - Number(b)));

  /* 좌표 계산 — x는 0 중심 기준 (캔버스 50%에 박힘) */
  const layout = {};
  byDepth.forEach((ids, d) => {
    const n = ids.length;
    const startX = -((n - 1) * MTB_GAP_X) / 2;
    ids.forEach((id, i) => {
      layout[id] = {
        x: startX + i * MTB_GAP_X,
        y: MTB_TOP_PAD + d * MTB_GAP_Y,
        depth: d,
      };
    });
  });

  return { layout, entryId, depths, sceneIds, isolated: sceneIds.filter(id => !visited.has(id)) };
}

function _mtbRender() {
  if (!MTB.active) return;
  const empty   = document.getElementById('mtb-empty');
  const nodesEl = document.getElementById('mtb-nodes');
  const svg     = document.getElementById('mtb-svg');
  if (!nodesEl || !svg) return;

  const built = _mtbBuildLayout();
  if (!built || !built.sceneIds.length) {
    /* 빈 상태 */
    if (empty) empty.style.display = 'flex';
    nodesEl.innerHTML = '';
    svg.innerHTML = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  const { layout, isolated } = built;
  const isolatedSet = new Set(isolated);

  /* 캔버스 크기 — 컨테이너 width 박힘. 노드는 캔버스 가로 중앙(50%) 기준 박음 */
  /* SVG viewBox — 노드 좌표 그대로 박음 (translate(-50%) 처리는 노드 div가 함) */
  const canvasW = nodesEl.clientWidth || 360;
  const halfW   = canvasW / 2;

  /* 캔버스 height — 가장 깊은 depth + 여유 */
  let maxY = MTB_TOP_PAD;
  Object.values(layout).forEach(p => { if (p.y > maxY) maxY = p.y; });
  const canvasH = maxY + MTB_TOP_PAD + 40;

  /* SVG 설정 — 가로는 100%, 세로는 동적. 화살표 marker 정의 */
  svg.setAttribute('viewBox', `0 0 ${canvasW} ${canvasH}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', canvasH);
  svg.style.height = canvasH + 'px';
  svg.innerHTML = `
    <defs>
      <marker id="mtb-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 8 4 L 0 8 z" fill="rgba(80,50,20,0.45)"/>
      </marker>
    </defs>
  `;

  /* 연결선 박기 */
  Object.entries(layout).forEach(([fromId, fromPos]) => {
    const sc = scenes[fromId];
    if (!sc) return;
    const buttons = Array.isArray(sc.buttons) ? sc.buttons : [];
    buttons.forEach((btn, idx) => {
      if (!btn || !btn.nextId) return;
      const toPos = layout[String(btn.nextId)];
      if (!toPos) return;
      /* 좌표 — fromPos.x는 0 기준 → 화면 좌표 = halfW + x */
      const x1 = halfW + fromPos.x;
      const y1 = fromPos.y + MTB_NODE_W / 2;       /* 노드 하단 */
      const x2 = halfW + toPos.x;
      const y2 = toPos.y - MTB_NODE_W / 2 - 4;     /* 노드 상단 (화살표 여유) */
      /* 베지어 컨트롤 포인트 — y 사이 중간 */
      const midY = (y1 + y2) / 2;
      const d = `M ${x1},${y1} C ${x1},${midY} ${x2},${midY} ${x2},${y2}`;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'mtb-edge');
      path.setAttribute('marker-end', 'url(#mtb-arrow)');
      svg.appendChild(path);

      /* 행동버튼 번호 라벨 — 베지어 곡선 중간점 */
      const labelX = (x1 + x2) / 2;
      const labelY = midY;
      const labelBg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      labelBg.setAttribute('cx', labelX);
      labelBg.setAttribute('cy', labelY);
      labelBg.setAttribute('r', 9);
      labelBg.setAttribute('class', 'mtb-edge-label-bg');
      svg.appendChild(labelBg);
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', labelX);
      label.setAttribute('y', labelY);
      label.setAttribute('class', 'mtb-edge-label');
      label.textContent = (idx + 1);
      svg.appendChild(label);
    });
  });

  /* 노드 박기 */
  nodesEl.innerHTML = '';
  nodesEl.style.height = canvasH + 'px';
  Object.entries(layout).forEach(([id, pos]) => {
    const sc = scenes[id];
    if (!sc) return;
    const node = document.createElement('div');
    node.className = 'mtb-node';
    node.dataset.sceneId = id;
    /* 화면 위치 — left: calc(50% + Xpx); top: Ypx */
    node.style.left = `calc(50% + ${pos.x}px)`;
    node.style.top  = pos.y + 'px';
    /* 상태별 클래스 */
    if (id === built.entryId || sc.type === 'cover' || sc.type === 'start' || sc.isStart) {
      node.classList.add('mtb-node--entry');
    }
    if (sc.type === 'ending' || sc.isEnding) {
      node.classList.add('mtb-node--ending');
      if (sc.trueEnding || sc.isTrueEnd) node.classList.add('mtb-node--true-ending');
    }
    if (isolatedSet.has(id)) node.classList.add('mtb-node--isolated');
    /* 숫자 (num 또는 id) */
    node.textContent = sc.num || id;
    /* v97: 노드 탭 → 편집 화면 / v98: 연결 모드면 연결 박음 */
    node.addEventListener('click', e => {
      if (MTB_CONNECT.active) {
        e.stopPropagation();
        _mtbConnectFinish(id);
        return;
      }
      _mtbOpenEditScene(id);
    });
    /* v98: 길게 누르기 — pointer/touch 둘 다 지원 */
    _mtbAttachLongPress(node, id);
    /* v98: 연결 모드 시 source 노드 강조 */
    if (MTB_CONNECT.active && String(MTB_CONNECT.fromId) === String(id)) {
      node.classList.add('mtb-node--connect-source');
    }
    nodesEl.appendChild(node);
  });
}

window.mtbRender = _mtbRender; /* 외부 호출 (저장 후 새로 그릴 때) */

/* ================================================================
   v97: 모바일 장면 편집 화면 (WYSIWYG)
   ─────────────────────────────────────────────────────────────────
   사용자 설계:
   · 노드 탭 → 슬라이드 인
   · 감상 카드 톤 + inline edit
   · 상단 이전/다음 빠른 이동 + 저장 상태
   · 저장 = scenes[num] 박은 후 pushToFirebase (사용자 박은 흐름)
   ──────────────────────────────────────────────────────────────── */

const MTB_EDIT = {
  currentId: null,
  saveTimers: new Map(),
};

function _mtbOpenEditScene(sceneId) {
  const sc = scenes[sceneId];
  if (!sc) return;
  MTB_EDIT.currentId = String(sceneId);
  const view = document.getElementById('mtb-edit-view');
  if (!view) return;
  view.classList.add('is-open');
  _mtbEditPopulate(sc);
  _mtbEditUpdateNav();
}

function _mtbCloseEditScene() {
  /* 저장 마무리 — 진행 중인 debounce flush */
  MTB_EDIT.saveTimers.forEach(t => clearTimeout(t));
  MTB_EDIT.saveTimers.clear();
  if (MTB_EDIT.currentId !== null && typeof pushToFirebase === 'function') {
    pushToFirebase(MTB_EDIT.currentId);
  }
  MTB_EDIT.currentId = null;
  const view = document.getElementById('mtb-edit-view');
  if (view) view.classList.remove('is-open');
  /* 노드 화면 다시 그리기 — 본문/제목 변경 반영 안 됐지만 구조(연결)는 동일 */
  _mtbRender();
}

function _mtbEditPopulate(sc) {
  const titleEl  = document.getElementById('mtb-edit-title');
  const cardType = document.getElementById('mtb-edit-card-type');
  const titleIn  = document.getElementById('mtb-edit-scene-title');
  const bodyIn   = document.getElementById('mtb-edit-scene-body');

  if (titleEl) titleEl.textContent = `장면 ${sc.num || sc.id}`;
  if (cardType) {
    cardType.className = 'mtb-edit-card-type';
    if (sc.type === 'cover' || sc.isCover) {
      cardType.textContent = '표지';
      cardType.classList.add('mtb-edit-card-type--cover');
    } else if (sc.type === 'ending' || sc.isEnding) {
      cardType.textContent = sc.trueEnding ? '진엔딩 ⭐' : '엔딩';
      cardType.classList.add('mtb-edit-card-type--ending');
    } else {
      cardType.textContent = '일반';
    }
  }
  if (titleIn) titleIn.value = sc.title || '';
  if (bodyIn)  bodyIn.value  = sc.body || '';

  _mtbEditRenderActions(sc);
  _mtbSetStatus('');
}

function _mtbEditRenderActions(sc) {
  const list = document.getElementById('mtb-edit-actions-list');
  const count = document.getElementById('mtb-edit-actions-count');
  const addBtn = document.getElementById('mtb-edit-add-action');
  if (!list) return;
  list.innerHTML = '';

  const buttons = Array.isArray(sc.buttons) ? sc.buttons : [];
  const isEnding = (sc.type === 'ending' || sc.isEnding);

  if (count) count.textContent = isEnding ? '(엔딩 — 행동 없음)' : `(${buttons.length}/6)`;
  if (addBtn) addBtn.disabled = isEnding || buttons.length >= 6;

  if (isEnding) {
    list.innerHTML = '<div style="font-size:13px;color:#9a8868;text-align:center;padding:10px;">엔딩에는 행동 버튼이 없어요.</div>';
    return;
  }

  buttons.forEach((btn, idx) => {
    const row = document.createElement('div');
    row.className = 'mtb-edit-action';
    const nextLabel = btn.nextId ? `→ 장면 ${btn.nextId}` : '연결 없음';
    const nextClass = btn.nextId ? '' : 'mtb-edit-action-next--empty';
    row.innerHTML = `
      <div class="mtb-edit-action-num">${idx + 1}</div>
      <input class="mtb-edit-action-label-input" type="text"
        value="${_mtbEsc(btn.label || '')}"
        placeholder="(행동 라벨)" data-idx="${idx}"/>
      <span class="mtb-edit-action-next ${nextClass}" data-idx="${idx}">${nextLabel}</span>
      <button class="mtb-edit-action-del" data-idx="${idx}" title="삭제">✕</button>
    `;
    list.appendChild(row);

    /* 라벨 입력 */
    const labelIn = row.querySelector('.mtb-edit-action-label-input');
    labelIn.addEventListener('input', e => {
      buttons[idx].label = e.target.value;
      _mtbQueueSave();
    });
    /* 연결 — Step 4에서 박을 거. 지금은 안내 */
    row.querySelector('.mtb-edit-action-next').addEventListener('click', () => {
      alert('연결 변경은 다음 단계에서 박을 거예요.\n(브랜치 화면에서 노드 길게 누르기로 박을 수 있어요)');
    });
    /* 삭제 */
    row.querySelector('.mtb-edit-action-del').addEventListener('click', () => {
      if (!confirm(`행동 ${idx + 1} 삭제할까요?`)) return;
      buttons.splice(idx, 1);
      sc.choiceCount = buttons.length === 1 ? 1 : 2;
      _mtbQueueSave();
      _mtbEditRenderActions(sc);
    });
  });
}

function _mtbEditUpdateNav() {
  const prev = document.getElementById('mtb-edit-prev');
  const next = document.getElementById('mtb-edit-next');
  if (!prev || !next) return;
  const ids = Object.keys(scenes).sort((a, b) => Number(a) - Number(b));
  const idx = ids.indexOf(String(MTB_EDIT.currentId));
  prev.disabled = (idx <= 0);
  next.disabled = (idx < 0 || idx >= ids.length - 1);
  prev.onclick = () => idx > 0 && _mtbOpenEditScene(ids[idx - 1]);
  next.onclick = () => idx < ids.length - 1 && _mtbOpenEditScene(ids[idx + 1]);
}

function _mtbQueueSave() {
  const id = MTB_EDIT.currentId;
  if (id === null) return;
  _mtbSetStatus('저장 중...');
  if (MTB_EDIT.saveTimers.has(id)) clearTimeout(MTB_EDIT.saveTimers.get(id));
  const t = setTimeout(() => {
    if (typeof pushToFirebase === 'function') pushToFirebase(id);
    _mtbSetStatus('✓ 저장됨');
    MTB_EDIT.saveTimers.delete(id);
    setTimeout(() => _mtbSetStatus(''), 1200);
  }, 500);
  MTB_EDIT.saveTimers.set(id, t);
}

function _mtbSetStatus(msg) {
  const el = document.getElementById('mtb-edit-status');
  if (el) el.textContent = msg;
}

function _mtbEsc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

/* 편집 화면 핸들러 박기 */
function _mtbInitEditView() {
  document.getElementById('mtb-edit-close')?.addEventListener('click', _mtbCloseEditScene);

  const titleIn = document.getElementById('mtb-edit-scene-title');
  if (titleIn) titleIn.addEventListener('input', e => {
    if (MTB_EDIT.currentId === null) return;
    const sc = scenes[MTB_EDIT.currentId];
    if (!sc) return;
    sc.title = e.target.value;
    _mtbQueueSave();
  });

  const bodyIn = document.getElementById('mtb-edit-scene-body');
  if (bodyIn) bodyIn.addEventListener('input', e => {
    if (MTB_EDIT.currentId === null) return;
    const sc = scenes[MTB_EDIT.currentId];
    if (!sc) return;
    sc.body = e.target.value;
    _mtbQueueSave();
  });

  document.getElementById('mtb-edit-add-action')?.addEventListener('click', () => {
    if (MTB_EDIT.currentId === null) return;
    const sc = scenes[MTB_EDIT.currentId];
    if (!sc || sc.type === 'ending' || sc.isEnding) return;
    if (!Array.isArray(sc.buttons)) sc.buttons = [];
    if (sc.buttons.length >= 6) return;
    sc.buttons.push({ label: '', nextId: null });
    sc.choiceCount = sc.buttons.length === 1 ? 1 : 2;
    _mtbQueueSave();
    _mtbEditRenderActions(sc);
  });
}

/* 기존 _mtbInit 직후에 박음 — DOM 박혔으면 즉시 */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _mtbInitEditView);
} else {
  _mtbInitEditView();
}

/* ================================================================
   v98: 노드 길게 누르기 → 컨텍스트 메뉴 + 연결 흐름
   ─────────────────────────────────────────────────────────────────
   사용자 설계:
   1. 노드 길게 누름 (0.5초)
   2. 메뉴 박힘 — 행동버튼 ① 연결, ②, ..., 편집, 새장면+연결, 삭제
   3. "행동버튼 N 연결" 클릭 → 연결 모드 박힘 + 다른 노드 탭 안내
   4. 대상 노드 탭 → 연결 박힘 → 모드 해제
   ──────────────────────────────────────────────────────────────── */

const MTB_LP = { timer: null, startX: 0, startY: 0, fired: false };
const MTB_CONNECT = { active: false, fromId: null, btnIdx: -1 };

function _mtbAttachLongPress(node, sceneId) {
  function start(x, y) {
    MTB_LP.fired = false;
    MTB_LP.startX = x;
    MTB_LP.startY = y;
    clearTimeout(MTB_LP.timer);
    MTB_LP.timer = setTimeout(() => {
      MTB_LP.fired = true;
      _mtbShowContextMenu(sceneId, x, y);
      if (navigator.vibrate) navigator.vibrate(20);
    }, 500);
  }
  function move(x, y) {
    /* 8px 이상 움직이면 long press 취소 */
    const dx = Math.abs(x - MTB_LP.startX);
    const dy = Math.abs(y - MTB_LP.startY);
    if (dx > 8 || dy > 8) {
      clearTimeout(MTB_LP.timer);
      MTB_LP.timer = null;
    }
  }
  function end() {
    clearTimeout(MTB_LP.timer);
    MTB_LP.timer = null;
  }

  node.addEventListener('pointerdown', e => start(e.clientX, e.clientY));
  node.addEventListener('pointermove', e => move(e.clientX, e.clientY));
  node.addEventListener('pointerup',   end);
  node.addEventListener('pointercancel', end);
  /* 길게 눌렀으면 click 차단 (편집 화면 안 열리게) */
  node.addEventListener('click', e => {
    if (MTB_LP.fired) {
      e.preventDefault();
      e.stopPropagation();
      MTB_LP.fired = false;
    }
  }, true);
}

function _mtbShowContextMenu(sceneId, x, y) {
  _mtbHideContextMenu();
  const sc = scenes[sceneId];
  if (!sc) return;

  const isEnding = (sc.type === 'ending' || sc.isEnding);
  const buttons = Array.isArray(sc.buttons) ? sc.buttons : [];

  const menu = document.createElement('div');
  menu.className = 'mtb-context-menu';
  menu.id = 'mtb-context-menu';

  /* 메뉴 항목 박기 */
  let html = '';
  if (!isEnding) {
    if (buttons.length === 0) {
      html += `<div class="mtb-context-menu-item mtb-context-menu-item--disabled">
        🔗 연결할 행동 버튼이 없어요
      </div>`;
    } else {
      buttons.forEach((btn, idx) => {
        const label = btn.label?.trim() || '(라벨 없음)';
        const cur = btn.nextId ? `→ ${btn.nextId}` : '';
        html += `
          <div class="mtb-context-menu-item" data-action="connect" data-idx="${idx}">
            <span class="mtb-context-menu-num">${idx + 1}</span>
            <span>"${_mtbEsc(label).slice(0, 14)}" 연결 ${cur}</span>
          </div>`;
      });
    }
    html += '<div class="mtb-context-menu-divider"></div>';
  }
  html += `
    <div class="mtb-context-menu-item" data-action="edit">
      ✏️ 장면 편집 열기
    </div>`;
  if (!isEnding) {
    html += `
      <div class="mtb-context-menu-item" data-action="new-and-connect">
        ✨ 새 장면 + 연결
      </div>`;
  }
  html += `
    <div class="mtb-context-menu-divider"></div>
    <div class="mtb-context-menu-item mtb-context-menu-item--danger" data-action="delete">
      🗑 장면 삭제
    </div>`;

  menu.innerHTML = html;
  document.body.appendChild(menu);

  /* 위치 — 화면 경계 내 */
  const rect = menu.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = x;
  let top = y + 10;
  if (left + rect.width > vw - 8)  left = vw - rect.width - 8;
  if (top + rect.height > vh - 8)  top = y - rect.height - 10;
  if (left < 8) left = 8;
  if (top < 8)  top = 8;
  menu.style.left = left + 'px';
  menu.style.top  = top + 'px';

  /* 항목 클릭 */
  menu.querySelectorAll('.mtb-context-menu-item').forEach(el => {
    el.addEventListener('click', () => {
      const action = el.dataset.action;
      const idx = parseInt(el.dataset.idx, 10);
      _mtbHideContextMenu();
      _mtbHandleMenuAction(sceneId, action, idx);
    });
  });

  /* 빈 영역 탭 → 메뉴 닫힘 */
  setTimeout(() => {
    document.addEventListener('click', _mtbHideContextMenuOnce, { once: true });
  }, 0);
}

function _mtbHideContextMenu() {
  document.getElementById('mtb-context-menu')?.remove();
}
function _mtbHideContextMenuOnce(e) {
  if (!e.target.closest('#mtb-context-menu')) _mtbHideContextMenu();
}

function _mtbHandleMenuAction(sceneId, action, idx) {
  const sc = scenes[sceneId];
  if (!sc) return;

  if (action === 'edit') {
    _mtbOpenEditScene(sceneId);
    return;
  }

  if (action === 'connect') {
    _mtbConnectStart(sceneId, idx);
    return;
  }

  if (action === 'new-and-connect') {
    if (typeof addScene !== 'function') {
      alert('장면 추가 함수가 박혀있지 않아요.');
      return;
    }
    /* 새 scene 박음 — 박힌 후 num 추정 */
    const beforeIds = new Set(Object.keys(scenes));
    addScene();
    setTimeout(() => {
      const newId = Object.keys(scenes).find(id => !beforeIds.has(id));
      if (!newId) { _mtbRender(); return; }
      /* 현재 scene의 빈 행동 버튼 자리에 박음 (없으면 새로 추가) */
      if (!Array.isArray(sc.buttons)) sc.buttons = [];
      let slot = sc.buttons.findIndex(b => !b.nextId);
      if (slot < 0 && sc.buttons.length < 6) {
        sc.buttons.push({ label: '', nextId: null });
        slot = sc.buttons.length - 1;
      }
      if (slot >= 0) {
        sc.buttons[slot].nextId = String(newId);
        sc.choiceCount = sc.buttons.length === 1 ? 1 : 2;
        if (typeof pushToFirebase === 'function') {
          pushToFirebase(sceneId);
          pushToFirebase(newId);
        }
      }
      _mtbRender();
    }, 200);
    return;
  }

  if (action === 'delete') {
    if (!confirm(`장면 ${sc.num || sceneId} 삭제할까요?\n다른 장면에서 이 장면으로 연결된 게 끊어져요.`)) return;
    if (typeof removeScene === 'function') {
      removeScene(sceneId);
    } else if (typeof deleteScene === 'function') {
      deleteScene(sceneId);
    } else {
      /* fallback — 직접 박음 */
      delete scenes[sceneId];
      /* 다른 scene의 nextId가 이 scene 가리키면 null로 */
      Object.values(scenes).forEach(other => {
        if (Array.isArray(other.buttons)) {
          other.buttons.forEach(b => {
            if (b && String(b.nextId) === String(sceneId)) b.nextId = null;
          });
        }
      });
      if (typeof pushToFirebase === 'function') pushToFirebase();
    }
    setTimeout(_mtbRender, 200);
    return;
  }
}

function _mtbConnectStart(fromId, btnIdx) {
  MTB_CONNECT.active = true;
  MTB_CONNECT.fromId = fromId;
  MTB_CONNECT.btnIdx = btnIdx;

  document.getElementById('mobile-text-branch')?.classList.add('is-connecting');
  _mtbShowConnectBanner(fromId, btnIdx);
  _mtbRender(); /* 다시 그려서 source 노드 강조 */
}

function _mtbConnectCancel() {
  MTB_CONNECT.active = false;
  MTB_CONNECT.fromId = null;
  MTB_CONNECT.btnIdx = -1;
  document.getElementById('mobile-text-branch')?.classList.remove('is-connecting');
  document.getElementById('mtb-connect-banner')?.remove();
  _mtbRender();
}

function _mtbConnectFinish(toId) {
  if (!MTB_CONNECT.active) return;
  const fromId = MTB_CONNECT.fromId;
  const idx    = MTB_CONNECT.btnIdx;
  const sc = scenes[fromId];
  if (!sc) { _mtbConnectCancel(); return; }

  /* 자기 자신 연결 차단 — 사용자가 의도일 수도 있지만 보통 실수 */
  if (String(toId) === String(fromId)) {
    if (!confirm('같은 장면으로 연결할까요? (자기 자신 루프)')) {
      _mtbConnectCancel();
      return;
    }
  }

  if (!Array.isArray(sc.buttons)) sc.buttons = [];
  if (idx >= 0 && idx < sc.buttons.length) {
    sc.buttons[idx].nextId = String(toId);
  } else if (idx >= sc.buttons.length && sc.buttons.length < 6) {
    sc.buttons.push({ label: '', nextId: String(toId) });
    sc.choiceCount = sc.buttons.length === 1 ? 1 : 2;
  }

  if (typeof pushToFirebase === 'function') pushToFirebase(fromId);
  _mtbConnectCancel();
}

function _mtbShowConnectBanner(fromId, btnIdx) {
  document.getElementById('mtb-connect-banner')?.remove();
  const banner = document.createElement('div');
  banner.id = 'mtb-connect-banner';
  banner.className = 'mtb-connect-banner';
  banner.innerHTML = `
    <div class="mtb-connect-banner-text">
      <span style="font-weight:600;">장면 ${fromId} 행동 ${btnIdx + 1}</span>
      <span>→ 연결할 장면을 탭하세요</span>
    </div>
    <button class="mtb-connect-banner-cancel" id="mtb-connect-cancel">취소</button>
  `;
  document.body.appendChild(banner);
  document.getElementById('mtb-connect-cancel').addEventListener('click', _mtbConnectCancel);
}

/* 빈 캔버스 탭 → 메뉴/연결 모드 닫힘 */
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('mtb-canvas')?.addEventListener('click', e => {
    if (e.target.closest('.mtb-node')) return; /* 노드 클릭은 별도 처리 */
    if (MTB_CONNECT.active) _mtbConnectCancel();
    _mtbHideContextMenu();
  });
});

function _mtbDeactivate() {
  const root = document.getElementById('mobile-text-branch');
  const canvasWrap = document.getElementById('canvas-wrap');
  if (!root) return;
  root.style.display = 'none';
  if (canvasWrap) canvasWrap.style.display = '';
  const toolbar = document.getElementById('toolbar');
  if (toolbar) toolbar.style.display = '';
  MTB.active = false;
}

/* ── 분기 검사 + 적용 ──
   project type 결정, 작품 로드, 또는 사용자 토글 후 호출. */
function mtbRefresh() {
  if (_mtbShouldActivate()) {
    _mtbActivate();
  } else {
    _mtbDeactivate();
  }
}

/* ── 초기화 ── */
function _mtbInit() {
  /* PC 토글 — 모바일로 돌아가려면 새로고침 안내 */
  const pcBtn = document.getElementById('mtb-pc-toggle');
  if (pcBtn) {
    pcBtn.addEventListener('click', () => {
      const ok = confirm('PC 버전으로 전환할까요?\n\n모바일로 다시 돌아가려면 페이지를 새로고침해주세요 (Cmd+R 또는 Ctrl+R).');
      if (!ok) return;
      MTB.pcOverride = true;
      mtbRefresh();
    });
  }
  /* 나가기 — branch.html 또는 메인으로 */
  const backBtn = document.getElementById('mtb-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = 'index.html';
    });
  }
  /* + 추가 — 사용자 박은 신규 scene 추가 함수 (sceneRenderer.js) 호출.
     Step 3에서 정식 흐름 박을 거. */
  const addBtn = document.getElementById('mtb-add-scene');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (typeof addScene === 'function') {
        addScene();
        setTimeout(_mtbRender, 200);
      } else {
        alert('장면 추가 함수 못 찾았어요. Step 3에서 박을 거예요.');
      }
    });
  }

  /* 작품 로드 완료 이벤트 listen — state.projectType 박힌 후 mtbRefresh */
  window.addEventListener('mtb-project-ready', mtbRefresh);

  /* viewport resize 시 재평가 (회전 등) */
  window.addEventListener('resize', () => {
    if (!MTB.pcOverride) mtbRefresh();
  });

  /* DOM 로드 직후 한 번 시도 (state 박혀있으면 활성) */
  setTimeout(mtbRefresh, 100);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _mtbInit);
} else {
  _mtbInit();
}

/* 외부에서 호출 가능 (작품 로드 흐름에서) */
window.mtbRefresh = mtbRefresh;
