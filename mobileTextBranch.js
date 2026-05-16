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
    /* 탭 핸들러 — Step 3에서 편집 화면 열기. 지금은 임시 */
    node.addEventListener('click', () => {
      alert(`장면 ${sc.num || id} 탭됨\n(Step 3에서 편집 화면 박을 거예요)`);
    });
    nodesEl.appendChild(node);
  });
}

window.mtbRender = _mtbRender; /* 외부 호출 (저장 후 새로 그릴 때) */

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
