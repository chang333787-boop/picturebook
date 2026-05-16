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
  placeMode: false,      /* v104: 노드 배치 이동 모드 박힌 상태 */
  _autoOpenedOnce: false,
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
  /* v103: 작품 진입 시 첫 장면 편집 화면 자동 열림 — 사용자 박은 의도:
     "기본은 장면 편집 중심, 브랜치는 구조 정리할 때만". 한 번만 박음 (재진입 시 X). */
  if (!MTB._autoOpenedOnce) {
    MTB._autoOpenedOnce = true;
    setTimeout(() => {
      if (!MTB.active) return;
      const ids = (typeof scenes === 'object' && scenes) ? Object.keys(scenes) : [];
      if (!ids.length) return;
      const entryId = (typeof projectMeta !== 'undefined' && projectMeta && projectMeta.entrySceneId)
        ? String(projectMeta.entrySceneId)
        : ids.sort((a, b) => Number(a) - Number(b))[0];
      if (entryId && scenes[entryId]) _mtbOpenEditScene(entryId);
    }, 200);
  }
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

  /* 좌표 계산 — x는 0 중심 기준 (캔버스 50%에 박힘).
     v104: scenes[id].mtbX/mtbY 박혀있으면 그것 우선 (사용자 박은 위치).
     박지 않은 노드는 BFS 자동. */
  const layout = {};
  byDepth.forEach((ids, d) => {
    const n = ids.length;
    const startX = -((n - 1) * MTB_GAP_X) / 2;
    ids.forEach((id, i) => {
      const sc = scenes[id];
      if (sc && typeof sc.mtbX === 'number' && typeof sc.mtbY === 'number') {
        /* 사용자 박은 위치 우선 */
        layout[id] = { x: sc.mtbX, y: sc.mtbY, depth: d };
      } else {
        layout[id] = {
          x: startX + i * MTB_GAP_X,
          y: MTB_TOP_PAD + d * MTB_GAP_Y,
          depth: d,
        };
      }
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
  const firstRender = !nodesEl.querySelector('.mtb-node');
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
    /* v97: 노드 탭 → 편집 화면 / v98: 연결 모드면 연결 박음 / v104: placeMode면 둘 다 차단 */
    node.addEventListener('click', e => {
      if (MTB.placeMode) { e.stopPropagation(); return; }
      if (MTB_CONNECT.active) {
        e.stopPropagation();
        _mtbConnectFinish(id);
        return;
      }
      _mtbOpenEditScene(id);
    });
    /* v98: 길게 누르기 (placeMode면 안 박음) */
    if (!MTB.placeMode) _mtbAttachLongPress(node, id);
    /* v104: placeMode 박힌 상태면 드래그 박음 */
    if (MTB.placeMode) _mtbAttachPlaceDrag(node, id);
    /* v98: 연결 모드 시 source 노드 강조 */
    if (MTB_CONNECT.active && String(MTB_CONNECT.fromId) === String(id)) {
      node.classList.add('mtb-node--connect-source');
    }
    nodesEl.appendChild(node);
  });

  /* v102: 첫 렌더 또는 노드 변경 후 자동 fit — 줌 아웃해도 노드 안 보이는 문제 해결. */
  if (firstRender) {
    setTimeout(_mtbFitAll, 50);
  }
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

/* v103: 새 장면 박음 + 행동버튼 연결 + 새 장면 편집 자동 진입.
   사용자 박은 연속 제작 흐름 (행동버튼 추가 → 새 장면 → 이어서 작성) 핵심. */
function _mtbNewSceneAndConnect(fromSceneId, btnIdx) {
  const sc = scenes[fromSceneId];
  if (!sc) return;
  if (typeof addScene !== 'function') {
    alert('장면 추가 함수가 박혀있지 않아요.');
    return;
  }
  const beforeIds = new Set(Object.keys(scenes));
  addScene();
  setTimeout(() => {
    const newId = Object.keys(scenes).find(id => !beforeIds.has(id));
    if (!newId) return;
    /* 이 행동버튼 nextId 박음 */
    if (!Array.isArray(sc.buttons)) sc.buttons = [];
    if (btnIdx >= 0 && btnIdx < sc.buttons.length) {
      sc.buttons[btnIdx].nextId = String(newId);
    }
    sc.choiceCount = sc.buttons.length === 1 ? 1 : 2;
    if (typeof pushToFirebase === 'function') {
      pushToFirebase(fromSceneId);
      pushToFirebase(newId);
    }
    /* 새 장면 편집 자동 진입 — 연속 제작 흐름 */
    _mtbOpenEditScene(newId);
  }, 200);
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

  /* v100/v101: textStyle 반영 — _mtbReflectStyleToUI/Card는 아래(v100)에서 박힘.
     아직 박지 않았으면 skip (Step 5 박힌 후엔 정상). */
  if (typeof _mtbReflectStyleToUI === 'function') {
    const style = (sc.textStyle && typeof sc.textStyle === 'object')
      ? sc.textStyle
      : { fontFamily: 'gothic', fontSize: 18, color: '', weight: 'normal' };
    _mtbReflectStyleToUI(style);
    _mtbReflectStyleToCard(style);
  }
}

function _mtbEditRenderActions(sc) {
  const list = document.getElementById('mtb-edit-actions-list');
  const count = document.getElementById('mtb-edit-actions-count');
  const addBtn = document.getElementById('mtb-edit-add-action');
  if (!list) return;
  list.innerHTML = '';

  /* v99 fix: sc.buttons가 undefined면 sc 자체에 박음. closure만 변경되면 저장 시 손실. */
  if (!Array.isArray(sc.buttons)) sc.buttons = [];
  const buttons = sc.buttons;
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
    /* v103: 연결 없으면 "+ 새 장면" 박음, 연결 있으면 "→ 장면 N" 박음 (탭 시 그 장면 편집 진입) */
    const nextHtml = btn.nextId
      ? `<span class="mtb-edit-action-next" data-idx="${idx}" title="장면 ${btn.nextId} 편집으로 이동">→ 장면 ${btn.nextId}</span>`
      : `<button class="mtb-edit-action-new" data-idx="${idx}" title="새 장면 만들고 이어서 작성">+ 새 장면</button>`;
    row.innerHTML = `
      <div class="mtb-edit-action-num">${idx + 1}</div>
      <input class="mtb-edit-action-label-input" type="text"
        value="${_mtbEsc(btn.label || '')}"
        placeholder="(행동 라벨)" data-idx="${idx}"/>
      ${nextHtml}
      <button class="mtb-edit-action-del" data-idx="${idx}" title="삭제">✕</button>
    `;
    list.appendChild(row);

    /* 라벨 입력 */
    const labelIn = row.querySelector('.mtb-edit-action-label-input');
    labelIn.addEventListener('input', e => {
      buttons[idx].label = e.target.value;
      _mtbQueueSave();
    });
    /* 박힌 연결 탭 → 그 장면 편집으로 이동 (앞뒤 이동 단축) */
    row.querySelector('.mtb-edit-action-next')?.addEventListener('click', () => {
      if (btn.nextId && scenes[btn.nextId]) _mtbOpenEditScene(btn.nextId);
    });
    /* v103: "+ 새 장면" — 새 scene 박음 + 이 행동버튼 nextId 박음 + 새 장면 편집 자동 진입.
       연속 제작 흐름의 핵심. */
    row.querySelector('.mtb-edit-action-new')?.addEventListener('click', () => {
      _mtbNewSceneAndConnect(MTB_EDIT.currentId, idx);
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
  /* v99 fix: status 직접 박지 말고 pushToFirebase만 호출.
     setSaveStatus가 실제 저장 완료 시점에 모바일 status도 박음 (firebase.js 수정).
     기존: setTimeout 안 박은 "✓ 저장됨"은 isRemote 박혀있을 때 거짓 = 손실. */
  const id = MTB_EDIT.currentId;
  if (id === null) return;
  if (MTB_EDIT.saveTimers.has(id)) clearTimeout(MTB_EDIT.saveTimers.get(id));
  const t = setTimeout(() => {
    if (typeof pushToFirebase === 'function') pushToFirebase(id);
    MTB_EDIT.saveTimers.delete(id);
  }, 500);
  MTB_EDIT.saveTimers.set(id, t);
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

/* ================================================================
   v104: 배치 모드 — 노드 드래그로 위치 박음
   ─────────────────────────────────────────────────────────────────
   토글 박힌 상태에서:
   · 노드 = 드래그 박음 (메뉴/편집 진입 안 박힘)
   · 박은 위치 = scenes[id].mtbX / mtbY 박힘
   · 박힌 위치 있으면 _mtbBuildLayout BFS보다 우선
   · 박지 않은 노드는 BFS 자동
   · 캔버스 pan/zoom은 박지 않음 (모드 전용)
   ──────────────────────────────────────────────────────────────── */

function _mtbTogglePlaceMode() {
  MTB.placeMode = !MTB.placeMode;
  const root = document.getElementById('mobile-text-branch');
  const btn = document.getElementById('mtb-place-toggle');
  if (!root) return;
  root.classList.toggle('is-place-mode', MTB.placeMode);
  if (btn) btn.classList.toggle('is-active', MTB.placeMode);
  if (MTB.placeMode) _mtbShowPlaceBanner();
  else _mtbHidePlaceBanner();
  _mtbRender();
}

function _mtbShowPlaceBanner() {
  document.getElementById('mtb-place-banner')?.remove();
  const banner = document.createElement('div');
  banner.id = 'mtb-place-banner';
  banner.className = 'mtb-place-banner';
  banner.innerHTML = `
    <span>📍 노드를 드래그해서 위치를 박아요. 박은 즉시 저장돼요.</span>
    <button class="mtb-place-banner-cancel" id="mtb-place-banner-cancel">완료</button>
  `;
  document.getElementById('mtb-canvas')?.appendChild(banner);
  document.getElementById('mtb-place-banner-cancel').addEventListener('click', _mtbTogglePlaceMode);
}
function _mtbHidePlaceBanner() {
  document.getElementById('mtb-place-banner')?.remove();
}

/* v104: 노드 드래그 핸들러 — placeMode 시만 활성. 박은 위치 즉시 scenes에 박음 + push. */
function _mtbAttachPlaceDrag(node, sceneId) {
  let dragging = false;
  let startX = 0, startY = 0;
  let nodeStartX = 0, nodeStartY = 0;
  let moved = false;

  node.addEventListener('pointerdown', e => {
    if (!MTB.placeMode) return;
    e.stopPropagation();
    dragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    /* 현재 박힌 위치 (스타일에서 추출) — left: calc(50% + Xpx) 형식 */
    const sc = scenes[sceneId];
    nodeStartX = (sc && typeof sc.mtbX === 'number') ? sc.mtbX : _mtbReadNodeX(node);
    nodeStartY = (sc && typeof sc.mtbY === 'number') ? sc.mtbY : node.offsetTop;
    node.setPointerCapture(e.pointerId);
  });

  node.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = (e.clientX - startX) / MTB_VIEW.scale;
    const dy = (e.clientY - startY) / MTB_VIEW.scale;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    const sc = scenes[sceneId];
    if (!sc) return;
    sc.mtbX = nodeStartX + dx;
    sc.mtbY = nodeStartY + dy;
    /* 노드 위치 즉시 박음 (실시간) */
    node.style.left = `calc(50% + ${sc.mtbX}px)`;
    node.style.top  = sc.mtbY + 'px';
    /* 연결선 다시 그림 */
    _mtbRedrawEdges();
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    if (moved && typeof pushToFirebase === 'function') {
      pushToFirebase(sceneId);
    }
  }
  node.addEventListener('pointerup', endDrag);
  node.addEventListener('pointercancel', endDrag);
}

function _mtbReadNodeX(node) {
  /* "calc(50% + Xpx)" 또는 "calc(50% + -Xpx)" 식 박힌 거에서 X 추출. 박지 못하면 0. */
  const m = node.style.left.match(/calc\(50%\s*\+\s*(-?\d+(?:\.\d+)?)px\)/);
  return m ? parseFloat(m[1]) : 0;
}

/* v104: 연결선만 다시 그리기 (노드는 그대로) — 드래그 중 빠른 갱신 */
function _mtbRedrawEdges() {
  const svg = document.getElementById('mtb-svg');
  const nodesEl = document.getElementById('mtb-nodes');
  if (!svg || !nodesEl) return;
  const built = _mtbBuildLayout();
  if (!built) return;
  const { layout } = built;
  const canvasW = nodesEl.clientWidth || 360;
  const halfW = canvasW / 2;
  /* svg defs 유지 + path만 다시 박음 */
  const defs = svg.querySelector('defs');
  svg.innerHTML = '';
  if (defs) svg.appendChild(defs);
  else svg.innerHTML = `
    <defs>
      <marker id="mtb-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 8 4 L 0 8 z" fill="rgba(80,50,20,0.45)"/>
      </marker>
    </defs>
  `;
  Object.entries(layout).forEach(([fromId, fromPos]) => {
    const sc = scenes[fromId];
    if (!sc) return;
    const buttons = Array.isArray(sc.buttons) ? sc.buttons : [];
    buttons.forEach((btn, idx) => {
      if (!btn || !btn.nextId) return;
      const toPos = layout[String(btn.nextId)];
      if (!toPos) return;
      const x1 = halfW + fromPos.x;
      const y1 = fromPos.y + MTB_NODE_W / 2;
      const x2 = halfW + toPos.x;
      const y2 = toPos.y - MTB_NODE_W / 2 - 4;
      const midY = (y1 + y2) / 2;
      const d = `M ${x1},${y1} C ${x1},${midY} ${x2},${midY} ${x2},${y2}`;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'mtb-edge');
      path.setAttribute('marker-end', 'url(#mtb-arrow)');
      svg.appendChild(path);
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
}

/* ================================================================
   v100: 핀치 줌 + pan — 캔버스 안 #mtb-stage에 transform
   ─────────────────────────────────────────────────────────────────
   · 두 손가락 핀치 → scale
   · 한 손가락 드래그 (노드 X) → pan
   · 줌 버튼 + / − / ⊙
   · 노드 클릭 vs pan 구분: 5px 이상 움직이면 pan
   ──────────────────────────────────────────────────────────────── */
const MTB_VIEW = {
  scale: 1, x: 0, y: 0,
  minScale: 0.4, maxScale: 2.5,
};

function _mtbApplyTransform() {
  const stage = document.getElementById('mtb-stage');
  if (!stage) return;
  stage.style.transform = `translate(${MTB_VIEW.x}px, ${MTB_VIEW.y}px) scale(${MTB_VIEW.scale})`;
}

function _mtbZoom(delta, anchorX, anchorY) {
  const oldScale = MTB_VIEW.scale;
  const newScale = Math.max(MTB_VIEW.minScale, Math.min(MTB_VIEW.maxScale, oldScale + delta));
  if (newScale === oldScale) return;
  /* anchor 박은 위치 기준 줌 — 그 위치가 동일하게 보이게 x/y 조정 */
  if (typeof anchorX === 'number' && typeof anchorY === 'number') {
    const canvas = document.getElementById('mtb-canvas');
    const rect = canvas.getBoundingClientRect();
    const cx = anchorX - rect.left;
    const cy = anchorY - rect.top;
    MTB_VIEW.x = cx - (cx - MTB_VIEW.x) * (newScale / oldScale);
    MTB_VIEW.y = cy - (cy - MTB_VIEW.y) * (newScale / oldScale);
  }
  MTB_VIEW.scale = newScale;
  _mtbApplyTransform();
}

function _mtbResetView() {
  /* v102: ⊙ 클릭 시 자동 fit — 모든 노드가 캔버스 안에 박히게 scale + 가운데. */
  _mtbFitAll();
}

/* v102: 모든 노드 박힌 범위 보고 scale + center 박음 — 줌 아웃해도 안 접힘 */
function _mtbFitAll() {
  const stage = document.getElementById('mtb-stage');
  const canvas = document.getElementById('mtb-canvas');
  const nodes = document.querySelectorAll('#mtb-nodes .mtb-node');
  if (!stage || !canvas || !nodes.length) {
    MTB_VIEW.scale = 1; MTB_VIEW.x = 0; MTB_VIEW.y = 0;
    _mtbApplyTransform();
    return;
  }
  /* 노드 박힌 범위 계산 — stage 좌표 기준 (transform 박지 않은 자연 위치) */
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    /* offsetLeft/Top은 transform 박지 않은 박힌 자리. 단 left:calc(50%+Xpx) 박힘 → offsetLeft = 캔버스 절반 + X */
    const cx = n.offsetLeft;
    const cy = n.offsetTop;
    minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
    minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
  });
  /* 노드 크기 박힘 — 박힌 좌우/상하 여유 */
  const PAD = 60;
  const contentW = (maxX - minX) + PAD * 2;
  const contentH = (maxY - minY) + PAD * 2;
  const canvasW = canvas.clientWidth;
  const canvasH = canvas.clientHeight;
  /* scale — 캔버스 안에 박히게 + 1보다 크지 않게 */
  const scaleX = canvasW / contentW;
  const scaleY = canvasH / contentH;
  const fitScale = Math.min(1, scaleX, scaleY);
  /* 노드 박힌 가운데 (stage 좌표) */
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  /* transform 박힌 후 노드 가운데가 캔버스 가운데에 박히게 */
  MTB_VIEW.scale = Math.max(MTB_VIEW.minScale, fitScale);
  MTB_VIEW.x = canvasW / 2 - centerX * MTB_VIEW.scale;
  MTB_VIEW.y = canvasH / 2 - centerY * MTB_VIEW.scale;
  _mtbApplyTransform();
}

function _mtbInitZoomPan() {
  /* 줌 버튼 */
  document.getElementById('mtb-zoom-in')?.addEventListener('click', () => {
    const canvas = document.getElementById('mtb-canvas');
    const r = canvas.getBoundingClientRect();
    _mtbZoom(0.2, r.left + r.width / 2, r.top + r.height / 2);
  });
  document.getElementById('mtb-zoom-out')?.addEventListener('click', () => {
    const canvas = document.getElementById('mtb-canvas');
    const r = canvas.getBoundingClientRect();
    _mtbZoom(-0.2, r.left + r.width / 2, r.top + r.height / 2);
  });
  document.getElementById('mtb-zoom-reset')?.addEventListener('click', _mtbResetView);

  const canvas = document.getElementById('mtb-canvas');
  if (!canvas) return;

  /* wheel 줌 (데스크탑 narrow viewport 박을 때) */
  canvas.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return; /* cmd/ctrl + wheel만 — 일반 스크롤 X */
    e.preventDefault();
    _mtbZoom(-e.deltaY * 0.005, e.clientX, e.clientY);
  }, { passive: false });

  /* pointer 기반 pan + pinch */
  const pointers = new Map();
  let pinchDist = 0;
  let panMoved = false;

  canvas.addEventListener('pointerdown', e => {
    /* 노드 위면 pan/zoom 박지 않음 — 노드 자체 핸들러로 */
    if (e.target.closest('.mtb-node')) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    panMoved = false;
    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      /* 핀치 — 두 손가락 거리 변화로 scale */
      const pts = [...pointers.values()];
      const newDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      const delta = (newDist - pinchDist) * 0.005;
      _mtbZoom(delta, midX, midY);
      pinchDist = newDist;
    } else if (pointers.size === 1) {
      /* 한 손가락 — pan */
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) panMoved = true;
      MTB_VIEW.x += dx;
      MTB_VIEW.y += dy;
      _mtbApplyTransform();
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _mtbInitZoomPan);
} else {
  _mtbInitZoomPan();
}

/* ================================================================
   v100: 장면 편집 화면 — 글자 설정 토글 (폰트/크기/색/굵기)
   ─────────────────────────────────────────────────────────────────
   사용자 박은 textStyle 데이터 모델 (scenes[id].textStyle) 그대로.
   변경 시 _mtbQueueSave 호출 → pushToFirebase.
   ──────────────────────────────────────────────────────────────── */
const MTB_FONTS = [
  { id: 'gothic', label: '나눔고딕' },
  { id: 'batang', label: '고운바탕' },
  { id: 'jua',    label: '주아' },
  { id: 'hanna',  label: '한나 (굵음)' },
  { id: 'pen',    label: '나눔펜' },
  { id: 'gaegu',  label: '개구' },
  { id: 'dohyeon',label: '도현' },
  { id: 'galmuri',label: '갈무리 (픽셀)' },
];
const MTB_COLORS = [
  '', '#1a1a1a', '#d4453d', '#e87a2a', '#f2b417',
  '#4a7d3a', '#2c6cb4', '#6a3eb0', '#c94785', '#6a3814',
];

function _mtbInitSettings() {
  /* 폰트 select 채움 */
  const sel = document.getElementById('mtb-edit-font');
  if (sel) {
    sel.innerHTML = MTB_FONTS.map(f => `<option value="${f.id}">${f.label}</option>`).join('');
    sel.addEventListener('change', e => _mtbUpdateStyle('fontFamily', e.target.value));
  }
  /* 크기 슬라이더 */
  const sizeIn = document.getElementById('mtb-edit-size');
  const sizeVal = document.getElementById('mtb-edit-size-val');
  if (sizeIn) {
    sizeIn.addEventListener('input', e => {
      const v = parseInt(e.target.value, 10) || 18;
      if (sizeVal) sizeVal.textContent = v + 'px';
      _mtbUpdateStyle('fontSize', v);
    });
  }
  /* 색 박스 */
  const colorRow = document.getElementById('mtb-edit-color-row');
  if (colorRow) {
    colorRow.innerHTML = MTB_COLORS.map(c => {
      const bg = c
        ? `background:${c};`
        : 'background:repeating-conic-gradient(#eee 0 25%,#fff 0 50%) 50%/6px 6px;';
      return `<button class="mtb-edit-color-btn" data-val="${c}" style="${bg}" title="${c || '기본'}"></button>`;
    }).join('');
    colorRow.querySelectorAll('.mtb-edit-color-btn').forEach(btn => {
      btn.addEventListener('click', () => _mtbUpdateStyle('color', btn.dataset.val));
    });
  }
  /* 굵기 */
  document.querySelectorAll('.mtb-edit-weight-btn').forEach(btn => {
    btn.addEventListener('click', () => _mtbUpdateStyle('weight', btn.dataset.val));
  });
  /* 토글 */
  const toggle = document.getElementById('mtb-edit-settings-toggle');
  const panel = document.getElementById('mtb-edit-settings-panel');
  const arrow = document.getElementById('mtb-edit-settings-arrow');
  if (toggle && panel) {
    toggle.addEventListener('click', () => {
      const open = panel.classList.toggle('is-open');
      toggle.classList.toggle('is-open', open);
      if (arrow) arrow.textContent = open ? '▲' : '▼';
    });
  }
}

function _mtbUpdateStyle(field, value) {
  const id = MTB_EDIT.currentId;
  if (id === null) return;
  const sc = scenes[id];
  if (!sc) return;
  if (!sc.textStyle || typeof sc.textStyle !== 'object') sc.textStyle = {};
  sc.textStyle[field] = value;
  _mtbReflectStyleToUI(sc.textStyle);
  _mtbReflectStyleToCard(sc.textStyle);
  _mtbQueueSave();
}

function _mtbReflectStyleToUI(style) {
  const sel = document.getElementById('mtb-edit-font');
  if (sel && style.fontFamily) sel.value = style.fontFamily;
  const sizeIn = document.getElementById('mtb-edit-size');
  const sizeVal = document.getElementById('mtb-edit-size-val');
  if (sizeIn && typeof style.fontSize === 'number') {
    sizeIn.value = style.fontSize;
    if (sizeVal) sizeVal.textContent = style.fontSize + 'px';
  }
  document.querySelectorAll('.mtb-edit-color-btn').forEach(btn => {
    btn.classList.toggle('is-active', (style.color || '') === btn.dataset.val);
  });
  document.querySelectorAll('.mtb-edit-weight-btn').forEach(btn => {
    btn.classList.toggle('is-active', (style.weight || 'normal') === btn.dataset.val);
  });
}

const MTB_FONT_FAMILIES = {
  gothic:  "'Nanum Gothic', sans-serif",
  batang:  "'Gowun Batang', serif",
  jua:     "'Jua', sans-serif",
  hanna:   "'Black Han Sans', sans-serif",
  pen:     "'Nanum Pen Script', cursive",
  gaegu:   "'Gaegu', cursive",
  dohyeon: "'Do Hyeon', sans-serif",
  galmuri: "'Galmuri11', monospace",
};

function _mtbReflectStyleToCard(style) {
  /* 편집 카드에 WYSIWYG 적용 (제목/본문) */
  const titleIn = document.getElementById('mtb-edit-scene-title');
  const bodyIn  = document.getElementById('mtb-edit-scene-body');
  const ff = MTB_FONT_FAMILIES[style.fontFamily] || '';
  const color = style.color || '';
  const weight = style.weight === 'bold' ? '700' : '400';
  if (titleIn) {
    if (ff) titleIn.style.fontFamily = ff;
    if (color) titleIn.style.color = color;
  }
  if (bodyIn) {
    if (ff) bodyIn.style.fontFamily = ff;
    if (typeof style.fontSize === 'number') bodyIn.style.fontSize = style.fontSize + 'px';
    if (color) bodyIn.style.color = color;
    bodyIn.style.fontWeight = weight;
  }
}

/* v101: _mtbEditPopulate reassignment 패턴 폐기. _mtbEditPopulate 내부에서
   직접 _mtbReflectStyleToUI/Card 호출하는 식으로 박힘 (위 함수 정의 참고). */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _mtbInitSettings);
} else {
  _mtbInitSettings();
}

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
  /* v104: 배치 모드 토글 — 박힌 상태에서 노드 드래그로 위치 박음 */
  const placeBtn = document.getElementById('mtb-place-toggle');
  if (placeBtn) {
    placeBtn.addEventListener('click', () => _mtbTogglePlaceMode());
  }

  /* v102: 감상 테스트 → viewer.html?team=...&from=maker 진입.
     teamName/classId는 state.js의 전역 변수. */
  const playBtn = document.getElementById('mtb-play-test');
  if (playBtn) {
    playBtn.addEventListener('click', () => {
      const tn = (typeof teamName === 'string') ? teamName : '';
      const cid = (typeof classId === 'string') ? classId : '';
      if (!tn) {
        alert('팀 정보가 없어요. 작품 진입 후 다시 시도해주세요.');
        return;
      }
      /* 박힌 변경 강제 push (debounce 흐름 우회) */
      if (typeof _flushPushToFirebaseNow === 'function') _flushPushToFirebaseNow();
      const params = new URLSearchParams();
      params.set('team', tn);
      params.set('from', 'maker');
      if (cid) params.set('classId', cid);
      params.set('ptype', 'text');
      window.location.href = `viewer.html?${params.toString()}`;
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
