/* ================================================================
   mobileTextBranch.js — 모바일 텍스트형 브랜치 전용 UI
   ─────────────────────────────────────────────────────────────────
   목적: 모바일 환경 + 텍스트형 작품에서 데스크탑 canvas 대신 노드 중심
   브랜치 화면 제공. 사용자 설계 (v95~):
   · 동그라미 숫자 노드 = 장면
   · BFS 자동 배치 (Step 2)
   · 노드 탭 → 장면 편집 화면 (Step 3+)
   · 길게 누르기 → 행동버튼 연결 (Step 4+)

   Step 1 (지금): 진입 흐름 + 빈 화면 + PC 토글
   ──────────────────────────────────────────────────────────────── */

const MTB = {
  active: false,         /* 현재 모바일 UI 활성인지 */
  pcOverride: false,     /* 사용자가 "🖥 PC" 토글했는지 */
  enabled: true,         /* 초기화됐는지 */
  placeMode: false,      /* v104: 노드 배치 이동 모드 켜진 상태 */
  placeDescendants: false, /* v106: 자손까지 묶음 이동 토글 */
  _autoOpenedOnce: false,
};

/* ── 모바일 감지 (v109 강화) ──
   사용자가 정한 원칙: "폰만 모바일 텍스트형 UI. 태블릿(iPad, Android tablet, 학교 태블릿
   가로)은 PC와 같은 maker canvas".

   v108까지: /Mobi|Android|iPhone|iPod/i — Android 태블릿(UA에 Mobi 없음, Android만 포함)이
   잘못 모바일로 잡힘. viewport < 768도 너무 넓어 일부 작은 데스크탑 창까지 잡힘.

   v109 적용 기준:
   1. iPhone/iPod = 무조건 폰
   2. Android = "Mobile"이 같이 포함돼야 폰 (태블릿은 Mobile 미포함)
   3. viewport <= 767px + pointer:coarse = 폰 (작은 데스크탑 창 차단)
   4. iPad는 무조건 PC UI — iPad는 768px 이상 (mini도 768) + UA에 iPhone/Mobi 없음 */
function _mtbIsMobile() {
  if (MTB.pcOverride) return false;
  const ua = navigator.userAgent || '';
  /* 1. 명백한 폰 — iPhone/iPod */
  if (/iPhone|iPod/i.test(ua)) return true;
  /* 2. Android 폰만 — Android + Mobile 동시 포함. 태블릿은 Android만 포함. */
  if (/Android/i.test(ua) && /Mobile/i.test(ua)) return true;
  /* 3. 작은 viewport + 터치 입력 = 폰 환경. 데스크탑 작은 창(마우스)은 제외. */
  if (window.innerWidth <= 767
      && window.matchMedia
      && window.matchMedia('(pointer: coarse)').matches) return true;
  return false;
}

/* ── 텍스트형 작품인지 ──
   projectMeta.projectType === 'text' (firebase.js에서 설정).
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
  _mtbRender('enter');
  /* v103: 작품 진입 시 첫 장면 편집 화면 자동 열림 — 사용자가 밝힌 의도:
     "기본은 장면 편집 중심, 브랜치는 구조 정리할 때만". 한 번만 실행 (재진입 시 X). */
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
   · 고립 노드 (BFS 못 닿음)은 별도 배치
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

  /* 고립 노드 — BFS 못 닿음. 가장 깊은 depth + 1 배정 */
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
  /* 각 depth 안에서 num 순 정렬 (안정적 순서 유지) */
  byDepth.forEach(arr => arr.sort((a, b) => Number(a) - Number(b)));

  /* 좌표 계산 — x는 0 중심 기준 (캔버스 50%에 정렬).
     v104: scenes[id].mtbX/mtbY 저장돼 있으면 그것 우선 (사용자가 지정한 위치).
     지정하지 않은 노드는 BFS 자동. */
  const layout = {};
  byDepth.forEach((ids, d) => {
    const n = ids.length;
    const startX = -((n - 1) * MTB_GAP_X) / 2;
    ids.forEach((id, i) => {
      const sc = scenes[id];
      if (sc && typeof sc.mtbX === 'number' && typeof sc.mtbY === 'number') {
        /* 사용자가 지정한 위치 우선 */
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

  const isolated = sceneIds.filter(id => !visited.has(id));

  /* v107: 노드별 상태 + 전체 통계 — 구조 화면 = 정리용 대시보드.
     · branchCount: 행동버튼 슬롯 수 (0~6)
     · incomplete : 본문 빔 OR 라벨 빔 OR 연결 안 됨 (엔딩은 본문만)
     · 미연결 노드는 incomplete 카운트엔 들어가지만 노드 ⚠ 배지 표시 X (점선과 시각 중복 회피) */
  const isolatedSet = new Set(isolated);
  const nodeStats = {};
  let endingCount = 0;
  let incompleteCount = 0;
  sceneIds.forEach(id => {
    const sc = scenes[id];
    if (!sc) { nodeStats[id] = { branchCount:0, incomplete:false }; return; }
    const isCover  = (sc.type === 'cover' || sc.isCover);
    const isEnding = (sc.type === 'ending' || sc.isEnding);
    if (isEnding) endingCount++;
    const buttons = Array.isArray(sc.buttons) ? sc.buttons : [];
    const stat = { branchCount: buttons.length, incomplete: false, reasons: [] };

    /* v111: cover scene 완성 기준은 별도 — 제목 또는 한 줄 소개 중 하나라도 채워져 있으면 완성.
       cover의 buttons[0]은 "▶️ 시작하기" 자동 생성 (nextId는 entrySceneId가 흡수). body/buttons
       검사 안 함. branchCount도 0으로 두어 노드에 분기수 배지 미표시 (cover는 분기 X). */
    if (isCover) {
      stat.branchCount = 0;
      const title = (sc.title || '').trim();
      const subtitle = (sc.subtitle || '').trim();
      if (!title && !subtitle) {
        stat.incomplete = true; stat.reasons.push('cover-empty');
      }
      if (stat.incomplete && !isolatedSet.has(id)) incompleteCount++;
      nodeStats[id] = stat;
      return;
    }

    const body = (sc.body || '').trim();
    if (!body) { stat.incomplete = true; stat.reasons.push('body'); }
    if (!isEnding) {
      if (!buttons.length) {
        /* 엔딩 아닌데 행동버튼 0개 = 막다른 골목 */
        stat.incomplete = true; stat.reasons.push('no-buttons');
      } else {
        for (const btn of buttons) {
          if (!btn) continue;
          const label = (btn.label || '').trim();
          if (!label) { stat.incomplete = true; stat.reasons.push('label'); break; }
          if (!btn.nextId || !scenes[String(btn.nextId)]) {
            stat.incomplete = true; stat.reasons.push('next'); break;
          }
        }
      }
    }
    /* 미연결 노드는 미완성 카운트에서 제외 — 점선 + 미연결 칩이 우선 신호 (시각/카운트 중복 회피) */
    if (stat.incomplete && !isolatedSet.has(id)) incompleteCount++;
    nodeStats[id] = stat;
  });

  const totals = {
    total: sceneIds.length,
    ending: endingCount,
    incomplete: incompleteCount,
    isolated: isolated.length,
  };

  return { layout, entryId, depths, sceneIds, isolated, isolatedSet, nodeStats, totals };
}

/* ────────────────────────────────────────────────────────────────
   WIN-TAB-3A — dev-only 브랜치 렌더 성능 계측 (기본 OFF).
   활성: URL ?perf=1  또는  localStorage.branchPerf === '1'.
   production 기본 접속에선 측정/로그 전혀 없음(_mtbRender 동작 동일).
   ──────────────────────────────────────────────────────────────── */
const BRANCH_PERF = (function () {
  try {
    return new URLSearchParams(location.search).get('perf') === '1'
        || localStorage.getItem('branchPerf') === '1';
  } catch (e) { return false; }
})();
const _mtbPerf = { count: 0, mStart: 0, mLayout: 0, mEdges: 0, mNodes: 0 };

/* 외부에서 동일 시그니처로 호출. BRANCH_PERF OFF면 곧장 impl 호출(오버헤드 0). */
function _mtbRender(reason) {
  if (!BRANCH_PERF) return _mtbRenderImpl(reason);
  _mtbPerf.count++;
  _mtbPerf.mStart = _mtbPerf.mLayout = _mtbPerf.mEdges = _mtbPerf.mNodes = performance.now();
  const ret = _mtbRenderImpl(reason);
  const t1 = performance.now();
  try {
    const svg     = document.getElementById('mtb-svg');
    const nodesEl = document.getElementById('mtb-nodes');
    const edges = svg ? svg.querySelectorAll('path.mtb-edge').length : 0;
    const nodes = nodesEl ? nodesEl.querySelectorAll('.mtb-node').length : 0;
    const total = (t1 - _mtbPerf.mStart);
    const dLayout = (_mtbPerf.mLayout - _mtbPerf.mStart);
    const dEdges  = (_mtbPerf.mEdges  - _mtbPerf.mLayout);
    const dNodes  = (_mtbPerf.mNodes  - _mtbPerf.mEdges);
    const dRest   = (t1 - _mtbPerf.mNodes);
    console.log(
      '[branch-perf] mtbRender ' + total.toFixed(1) + 'ms'
      + ' nodes=' + nodes + ' edges=' + edges
      + ' reason=' + (reason || 'unknown')
      + ' | layout=' + dLayout.toFixed(1)
      + ' svg=' + dEdges.toFixed(1)
      + ' nodes=' + dNodes.toFixed(1)
      + ' rest=' + dRest.toFixed(1)
      + ' (#' + _mtbPerf.count + ')'
    );
  } catch (e) { /* 계측 실패는 무시 */ }
  return ret;
}

function _mtbRenderImpl(reason) {
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

  const { layout, isolated, isolatedSet, nodeStats } = built;

  /* 캔버스 크기 — 컨테이너 width 사용. 노드는 캔버스 가로 중앙(50%) 기준 배치 */
  /* SVG viewBox — 노드 좌표 그대로 사용 (translate(-50%) 처리는 노드 div가 함) */
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

  if (BRANCH_PERF) _mtbPerf.mLayout = performance.now();

  /* 연결선 그리기 */
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

  if (BRANCH_PERF) _mtbPerf.mEdges = performance.now();

  /* 노드 그리기 */
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
    /* 숫자 (num 또는 id) — BASE10-1F: 기본 틀이면 표시명 보정(표지/1..8/결말) */
    node.textContent = _mtbSceneDisplayLabel(sc, id, { short: true });
    /* v107: 노드 배지 — 분기수 (2~6) + 미완성 ⚠ (단 미연결 노드는 점선과 시각 중복 피해 ⚠ 표시 X) */
    const stat = nodeStats && nodeStats[id];
    if (stat) {
      if (stat.branchCount >= 2 && stat.branchCount <= 6) {
        const b = document.createElement('div');
        b.className = 'mtb-node-badge mtb-node-badge--branch';
        b.textContent = stat.branchCount;
        node.appendChild(b);
      }
      if (stat.incomplete && !isolatedSet.has(id)) {
        const w = document.createElement('div');
        w.className = 'mtb-node-badge mtb-node-badge--warn';
        w.textContent = '⚠';
        const reasons = (stat.reasons || []).map(r => ({
          'body':'본문 비었음','no-buttons':'엔딩이 아닌데 행동버튼이 없음',
          'label':'행동버튼 라벨이 비었음','next':'다음 장면이 연결되지 않음',
          'cover-empty':'표지 제목과 한 줄 소개가 모두 비었음',
        }[r] || r)).join(' · ');
        w.title = '미완성: ' + reasons;
        node.appendChild(w);
      }
    }
    /* v97: 노드 탭 → 편집 화면 / v98: 연결 모드면 연결 수행 / v104: placeMode면 둘 다 차단 */
    node.addEventListener('click', e => {
      if (MTB.placeMode) { e.stopPropagation(); return; }
      if (MTB_CONNECT.active) {
        e.stopPropagation();
        _mtbConnectFinish(id);
        return;
      }
      _mtbOpenEditScene(id);
    });
    /* v98: 길게 누르기 (placeMode면 비활성) */
    if (!MTB.placeMode) _mtbAttachLongPress(node, id);
    /* v104: placeMode 켜진 상태면 드래그 활성 */
    if (MTB.placeMode) _mtbAttachPlaceDrag(node, id);
    /* v98: 연결 모드 시 source 노드 강조 */
    if (MTB_CONNECT.active && String(MTB_CONNECT.fromId) === String(id)) {
      node.classList.add('mtb-node--connect-source');
    }
    nodesEl.appendChild(node);
  });

  if (BRANCH_PERF) _mtbPerf.mNodes = performance.now();

  /* v107: 상단 요약 바 업데이트 */
  _mtbRenderSummary(built);

  /* v102: 첫 렌더 또는 노드 변경 후 자동 fit — 줌 아웃해도 노드 안 보이는 문제 해결. */
  if (firstRender) {
    setTimeout(_mtbFitAll, 50);
  }
}

/* ================================================================
   v107: 상단 요약 바 + 문제 노드 점프
   ─────────────────────────────────────────────────────────────────
   · 칩 4개 — 전체 장면 / 엔딩 / 미완성 / 미연결
   · 0인 칩은 흐리게 + 비활성
   · ⚠/🔌 칩 탭 → 다음 문제 노드로 자동 포커스 + 깜빡임 (반복 탭 시 다음 거)
   ──────────────────────────────────────────────────────────────── */
const MTB_JUMP = { incomplete: 0, isolated: 0 };

function _mtbRenderSummary(built) {
  const bar = document.getElementById('mtb-summary');
  if (!bar) return;
  const totals = (built && built.totals) || { total:0, ending:0, incomplete:0, isolated:0 };
  /* 작품이 비어있으면 바도 숨김 */
  if (!totals.total) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  /* 숫자 채우기 */
  bar.querySelectorAll('.mtb-summary-num').forEach(el => {
    const k = el.dataset.num;
    el.textContent = totals[k] != null ? totals[k] : 0;
  });
  /* is-zero 토글 (⚠/🔌만 — total/ending은 disabled, 0이어도 정보 가치 있음) */
  bar.querySelectorAll('.mtb-summary-chip').forEach(chip => {
    const k = chip.dataset.kind;
    if (k === 'incomplete' || k === 'isolated') {
      chip.classList.toggle('is-zero', !totals[k]);
    }
  });
}

/* 노드 포커스 — _mtbFitAll 패턴 차용. transform을 그 노드 중심으로 설정. */
function _mtbFocusNode(sceneId, flash) {
  const node = document.querySelector('#mtb-nodes .mtb-node[data-scene-id="' + sceneId + '"]');
  const canvas = document.getElementById('mtb-canvas');
  if (!node || !canvas) return;
  /* stage 좌표 (transform 적용 전 자연 위치) */
  const cx = node.offsetLeft;
  const cy = node.offsetTop;
  const canvasW = canvas.clientWidth;
  const canvasH = canvas.clientHeight;
  /* 현 scale 유지하되 최소 0.85 이상으로 살짝 키움 (너무 작으면 노드 안 보임) */
  if (MTB_VIEW.scale < 0.85) MTB_VIEW.scale = 0.85;
  MTB_VIEW.x = canvasW / 2 - cx * MTB_VIEW.scale;
  MTB_VIEW.y = canvasH / 2 - cy * MTB_VIEW.scale;
  _mtbApplyTransform();
  if (flash) {
    node.classList.remove('mtb-node--flash');
    /* reflow → 애니메이션 재시작 */
    void node.offsetWidth;
    node.classList.add('mtb-node--flash');
    setTimeout(() => node.classList.remove('mtb-node--flash'), 1300);
  }
}

/* 칩 탭 → 다음 문제 노드 점프. 반복 탭 시 순환. */
function _mtbJumpToProblem(kind) {
  const built = _mtbBuildLayout();
  if (!built) return;
  let pool = [];
  if (kind === 'incomplete') {
    /* 미연결 제외하고 미완성만 — 미연결은 별도 칩에서 점프 */
    pool = built.sceneIds.filter(id =>
      built.nodeStats[id] && built.nodeStats[id].incomplete && !built.isolatedSet.has(id)
    );
    /* 미연결인데 미완성인 노드도 미완성 칩 카운트엔 들어가있음 — 미연결 칩으로 가게 함 */
  } else if (kind === 'isolated') {
    pool = Array.from(built.isolated);
  }
  if (!pool.length) return;
  /* num 순 정렬 (안정적) */
  pool.sort((a, b) => Number(a) - Number(b));
  const idx = MTB_JUMP[kind] % pool.length;
  MTB_JUMP[kind] = (MTB_JUMP[kind] + 1) % pool.length;
  _mtbFocusNode(pool[idx], true);
}

/* 요약 바 칩에 점프 동작 연결 — 한 번만 (DOMContentLoaded 후 _mtbInitAll에서 호출) */
function _mtbInitSummary() {
  const bar = document.getElementById('mtb-summary');
  if (!bar || bar.dataset.bound === '1') return;
  bar.dataset.bound = '1';
  bar.querySelectorAll('.mtb-summary-chip').forEach(chip => {
    const k = chip.dataset.kind;
    if (k !== 'incomplete' && k !== 'isolated') return;
    chip.addEventListener('click', () => {
      if (chip.classList.contains('is-zero')) return;
      _mtbJumpToProblem(k);
    });
  });
}

window.mtbRender = function (reason) { return _mtbRender(reason || 'external'); }; /* 외부 호출 (저장 후 새로 그릴 때) */

/* ================================================================
   v97: 모바일 장면 편집 화면 (WYSIWYG)
   ─────────────────────────────────────────────────────────────────
   사용자 설계:
   · 노드 탭 → 슬라이드 인
   · 감상 카드 톤 + inline edit
   · 상단 이전/다음 빠른 이동 + 저장 상태
   · 저장 = scenes[num] 갱신 후 pushToFirebase (사용자가 정한 흐름)
   ──────────────────────────────────────────────────────────────── */

const MTB_EDIT = {
  currentId: null,
  saveTimers: new Map(),
};

function _mtbOpenEditScene(sceneId) {
  const sc = scenes[sceneId];
  if (!sc) return;
  const wasOpen = MTB_EDIT.currentId !== null;
  const prevId = MTB_EDIT.currentId;
  /* MTB-FLUSH-1(2026-07-27): 다른 장면으로 넘어가기 전에 직전 장면의 대기 저장을 먼저 push.
     currentId를 바꾼 뒤 닫으면 이전 장면 debounce가 유실되던 것 차단. */
  if (prevId !== null && prevId !== String(sceneId)) _mtbFlushSaves();
  MTB_EDIT.currentId = String(sceneId);
  const view = document.getElementById('mtb-edit-view');
  if (!view) return;
  /* v105: 이미 열린 상태(다른 장면 이동)면 fade transition, 첫 열림은 slide */
  if (wasOpen && prevId !== String(sceneId)) {
    view.classList.add('is-transitioning');
    setTimeout(() => view.classList.remove('is-transitioning'), 200);
  }
  view.classList.add('is-open');
  _mtbEditPopulate(sc);
  _mtbEditUpdateNav();

  /* v105: 본문 비어있으면 자동 focus — "이야기를 앞으로 이어가는" 흐름.
     animation 끝난 후 (300ms) focus. */
  const bodyIn = document.getElementById('mtb-edit-scene-body');
  if (bodyIn && !sc.body && !sc.title) {
    setTimeout(() => {
      if (MTB_EDIT.currentId === String(sceneId)) bodyIn.focus();
    }, 300);
  }
}

/* v103: 새 장면 생성 + 행동버튼 연결 + 새 장면 편집 자동 진입.
   사용자가 정한 연속 제작 흐름 (행동버튼 추가 → 새 장면 → 이어서 작성) 핵심.
   v105: setTimeout 200 → 50ms로 조정 (부드러운 이동). */
function _mtbNewSceneAndConnect(fromSceneId, btnIdx) {
  const sc = scenes[fromSceneId];
  if (!sc) return;
  if (typeof addScene !== 'function') {
    alert('장면을 추가할 수 없어요. 새로고침 후 다시 시도해 주세요.');
    return;
  }
  const beforeIds = new Set(Object.keys(scenes));
  addScene();
  setTimeout(() => {
    const newId = Object.keys(scenes).find(id => !beforeIds.has(id));
    if (!newId) return;
    /* 이 행동버튼 nextId 설정 */
    if (!Array.isArray(sc.buttons)) sc.buttons = [];
    if (btnIdx >= 0 && btnIdx < sc.buttons.length) {
      sc.buttons[btnIdx].nextId = String(newId);
    }
    _mtbSyncChoiceLabels(sc); /* v106 */
    if (typeof pushToFirebase === 'function') {
      pushToFirebase(fromSceneId);
      pushToFirebase(newId);
    }
    /* 새 장면 편집 자동 진입 — 연속 제작 흐름 */
    _mtbOpenEditScene(newId);
  }, 50);
}

/* MTB-FLUSH-1(2026-07-27): 대기 중인 모든 장면 저장을 취소가 아니라 '즉시 push'로 마무리한다.
   종전엔 saveTimers를 clearTimeout으로 버리고 currentId 하나만 push해서, 장면 A에 글을 쓰고
   500ms 안에 장면 B로 이동한 뒤 닫으면 A의 미저장 글이 유실됐다(감사 확정·데이터 손실). */
function _mtbFlushSaves() {
  if (!MTB_EDIT.saveTimers || !MTB_EDIT.saveTimers.size) return;
  MTB_EDIT.saveTimers.forEach((t, id) => {
    clearTimeout(t);
    if (typeof pushToFirebase === 'function') { try { pushToFirebase(id); } catch (e) { /* noop */ } }
  });
  MTB_EDIT.saveTimers.clear();
}

function _mtbCloseEditScene() {
  /* 저장 마무리 — 대기 중인 모든 장면을 push(취소 아님) */
  _mtbFlushSaves();
  if (MTB_EDIT.currentId !== null && typeof pushToFirebase === 'function') {
    pushToFirebase(MTB_EDIT.currentId);
  }
  MTB_EDIT.currentId = null;
  const view = document.getElementById('mtb-edit-view');
  if (view) view.classList.remove('is-open');
  /* 노드 화면 다시 그리기 — 본문/제목 변경 반영 안 됐지만 구조(연결)는 동일 */
  _mtbRender('edit-close');
}

function _mtbEditPopulate(sc) {
  const titleEl  = document.getElementById('mtb-edit-title');
  const cardType = document.getElementById('mtb-edit-card-type');
  const titleIn  = document.getElementById('mtb-edit-scene-title');
  const bodyIn   = document.getElementById('mtb-edit-scene-body');
  const subtitleIn = document.getElementById('mtb-edit-scene-subtitle');

  const isCover = (sc.type === 'cover' || sc.isCover);
  /* BASE10-1F: 표지/결말/장면 N 표시 보정 (데이터 키 불변) */
  if (titleEl) titleEl.textContent = _mtbSceneDisplayLabel(sc, sc.num || sc.id);
  if (cardType) {
    cardType.className = 'mtb-edit-card-type';
    if (isCover) {
      cardType.textContent = '표지';
      cardType.classList.add('mtb-edit-card-type--cover');
    } else if (sc.type === 'ending' || sc.isEnding) {
      cardType.textContent = sc.trueEnding ? '진엔딩 ⭐' : '엔딩';
      cardType.classList.add('mtb-edit-card-type--ending');
    } else {
      cardType.textContent = '일반';
    }
  }
  if (titleIn) {
    titleIn.value = sc.title || '';
    titleIn.placeholder = isCover ? '작품 제목을 적어보세요' : '(제목 — 비워도 돼요)';
  }
  if (bodyIn)  bodyIn.value  = sc.body || '';
  if (subtitleIn) subtitleIn.value = sc.subtitle || '';

  /* v110: 표지 / 일반 분기 — cover면 본문·행동버튼 가림, 한 줄 소개·안내 표시 */
  const card = document.getElementById('mtb-edit-card');
  if (card) card.classList.toggle('is-cover-edit', isCover);
  document.querySelectorAll('.mtb-cover-only').forEach(el => {
    el.style.display = isCover ? '' : 'none';
  });
  document.querySelectorAll('.mtb-noncover-only').forEach(el => {
    el.style.display = isCover ? 'none' : '';
  });

  _mtbEditRenderActions(sc);

  /* v100/v101: textStyle 반영 — _mtbReflectStyleToUI/Card는 아래(v100)에서 정의됨.
     아직 정의 전이면 skip (Step 5 로드 후엔 정상). */
  if (typeof _mtbReflectStyleToUI === 'function') {
    /* REFINE-IA-2: raw가 아닌 resolved(장면 override → 작품 기본값 → floor) 표시 →
       작품 기본값을 따르는 장면도 올바른 값/미리보기 노출. */
    const style = (typeof _mtbResolveStyle === 'function')
      ? _mtbResolveStyle(sc)
      : ((sc.textStyle && typeof sc.textStyle === 'object') ? sc.textStyle : { fontFamily: 'gothic', fontSize: 18, color: '', weight: 'normal' });
    _mtbReflectStyleToUI(style);
    _mtbReflectStyleToCard(style);
    if (typeof _mtbReflectResetState === 'function') _mtbReflectResetState(sc);
  }
}

function _mtbEditRenderActions(sc) {
  const list = document.getElementById('mtb-edit-actions-list');
  const count = document.getElementById('mtb-edit-actions-count');
  const addBtn = document.getElementById('mtb-edit-add-action');
  if (!list) return;
  list.innerHTML = '';

  /* v99 fix: sc.buttons가 undefined면 sc 자체에 할당. closure만 변경되면 저장 시 손실. */
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
    /* v103: 연결 없으면 "+ 새 장면" 표시, 연결 있으면 "→ 장면 N" 표시 (탭 시 그 장면 편집 진입) */
    /* BASE10-1F: 연결 대상 표시명 보정 (nextId 키는 그대로, 화면 라벨만) */
    const nextLabel = btn.nextId
      ? _mtbSceneDisplayLabel(scenes && scenes[btn.nextId], btn.nextId)
      : '';
    const nextHtml = btn.nextId
      ? `<span class="mtb-edit-action-next" data-idx="${idx}" title="${_mtbEsc(nextLabel)} 편집으로 이동">→ ${_mtbEsc(nextLabel)}</span>`
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
      _mtbSyncChoiceLabels(sc); /* v106: choiceA/B 동기화 — 감상 라벨 손실 fix */
      _mtbQueueSave();
    });
    /* 연결된 대상 탭 → 그 장면 편집으로 이동 (앞뒤 이동 단축) */
    row.querySelector('.mtb-edit-action-next')?.addEventListener('click', () => {
      if (btn.nextId && scenes[btn.nextId]) _mtbOpenEditScene(btn.nextId);
    });
    /* v103: "+ 새 장면" — 새 scene 생성 + 이 행동버튼 nextId 설정 + 새 장면 편집 자동 진입.
       연속 제작 흐름의 핵심. */
    row.querySelector('.mtb-edit-action-new')?.addEventListener('click', () => {
      _mtbNewSceneAndConnect(MTB_EDIT.currentId, idx);
    });
    /* 삭제 */
    row.querySelector('.mtb-edit-action-del').addEventListener('click', async () => {
      const ok = window.showMakerConfirm
        ? await window.showMakerConfirm({
            title: '행동을 삭제할까요?',
            message: '이 행동으로 이어진 연결이 사라져요.',
            confirmText: '삭제하기',
            danger: true,
          })
        : confirm(`행동 ${idx + 1} 삭제할까요?`);
      if (!ok) return;
      buttons.splice(idx, 1);
      _mtbSyncChoiceLabels(sc); /* v106 */
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
  /* v99 fix: status 직접 갱신하지 말고 pushToFirebase만 호출.
     setSaveStatus가 실제 저장 완료 시점에 모바일 status도 갱신 (firebase.js 수정).
     기존: setTimeout 안에 넣은 "✓ 저장됨"은 isRemote 켜져 있을 때 거짓 = 손실. */
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

/* BASE10-1F: 표시명 보정 — 데이터/키는 그대로(1~10), 화면 라벨만 자연스럽게.
   기본 틀(key1=표지 cover)인 경우 일반 장면 key N → "장면 (N-1)"로 당겨 표시.
   cover→'표지', ending→'결말'. 비숫자/예외는 기존 값 그대로 폴백.
   ⚠ nextId/Firebase 키/저장·삭제 id/정렬에는 절대 쓰지 말 것. 표시 전용. */
function _mtbSceneDisplayLabel(scene, id, opts) {
  const short = opts && opts.short;
  if (!scene) return short ? String(id) : `장면 ${id}`;
  if (scene.type === 'cover' || scene.isCover) return '표지';
  if (scene.type === 'ending' || scene.isEnding) return '결말';
  const numericId = Number(id != null ? id : scene.num);
  const hasCoverAsOne = (typeof scenes === 'object' && scenes && scenes[1]
    && (scenes[1].type === 'cover' || scenes[1].isCover));
  let display;
  if (!isNaN(numericId)) {
    display = (hasCoverAsOne && numericId > 1) ? (numericId - 1) : numericId;
  } else {
    display = scene.num || id;
  }
  return short ? String(display) : `장면 ${display}`;
}

/* v106: buttons[] ↔ choiceA/B/nextA/B 동기화.
   viewer-data.js의 adaptChoices가 choiceA/B를 우선하므로, buttons[].label만 저장하면
   감상 화면에서 라벨 손실. 사용자가 수정하는 모든 흐름에서 호출해서 동기화. */
function _mtbSyncChoiceLabels(sc) {
  if (!sc) return;
  const buttons = Array.isArray(sc.buttons) ? sc.buttons : [];
  sc.choiceA = (buttons[0] && typeof buttons[0].label === 'string') ? buttons[0].label : '';
  sc.choiceB = (buttons[1] && typeof buttons[1].label === 'string') ? buttons[1].label : '';
  sc.nextA = (buttons[0] && buttons[0].nextId) ? String(buttons[0].nextId) : '';
  sc.nextB = (buttons[1] && buttons[1].nextId) ? String(buttons[1].nextId) : '';
  sc.choiceCount = buttons.length === 1 ? 1 : (buttons.length === 0 ? 0 : 2);
}

/* 편집 화면 핸들러 연결 */
function _mtbInitEditView() {
  document.getElementById('mtb-edit-close')?.addEventListener('click', _mtbCloseEditScene);

  const titleIn = document.getElementById('mtb-edit-scene-title');
  if (titleIn) titleIn.addEventListener('input', e => {
    if (MTB_EDIT.currentId === null) return;
    const sc = scenes[MTB_EDIT.currentId];
    if (!sc) return;
    sc.title = e.target.value;
    sc._hasBody = true;   /* HASBODY-MOBILE-1: 아래 body와 동일 — legacy 장면 저장 시 삭제 방지 */
    _mtbQueueSave();
  });

  const bodyIn = document.getElementById('mtb-edit-scene-body');
  if (bodyIn) bodyIn.addEventListener('input', e => {
    if (MTB_EDIT.currentId === null) return;
    const sc = scenes[MTB_EDIT.currentId];
    if (!sc) return;
    sc.body = e.target.value;
    /* HASBODY-MOBILE-1(2026-07-27): _hasBody를 안 세우면 _sceneToDbShape가 legacy 장면(원래 body키
       없음·_hasBody=false)의 body를 저장 직전 삭제 → 새로고침 시 본문이 사라짐(감사 확정). 데스크톱
       ui.js:264와 대칭으로 입력 즉시 true. */
    sc._hasBody = true;
    _mtbQueueSave();
  });

  /* v110: 표지 한 줄 소개 (cover scene 전용) */
  const subtitleIn = document.getElementById('mtb-edit-scene-subtitle');
  if (subtitleIn) subtitleIn.addEventListener('input', e => {
    if (MTB_EDIT.currentId === null) return;
    const sc = scenes[MTB_EDIT.currentId];
    if (!sc) return;
    sc.subtitle = e.target.value;
    _mtbQueueSave();
  });

  document.getElementById('mtb-edit-add-action')?.addEventListener('click', () => {
    if (MTB_EDIT.currentId === null) return;
    const sc = scenes[MTB_EDIT.currentId];
    if (!sc || sc.type === 'ending' || sc.isEnding) return;
    if (!Array.isArray(sc.buttons)) sc.buttons = [];
    if (sc.buttons.length >= 6) return;
    sc.buttons.push({ label: '', nextId: null });
    _mtbSyncChoiceLabels(sc); /* v106 */
    _mtbQueueSave();
    _mtbEditRenderActions(sc);
    /* v105: 새로 추가된 라벨 input 자동 focus — 사용자가 바로 입력할 수 있게 */
    setTimeout(() => {
      const inputs = document.querySelectorAll('.mtb-edit-action-label-input');
      if (inputs.length) inputs[inputs.length - 1].focus();
    }, 50);
  });

  /* v105: "+ 분기 추가" — 행동버튼 추가 + 새 장면 생성 + 자동 연결 + 새 장면 진입.
     사용자가 정한 핵심 흐름 한 번에. */
  document.getElementById('mtb-edit-add-branch')?.addEventListener('click', () => {
    if (MTB_EDIT.currentId === null) return;
    const sc = scenes[MTB_EDIT.currentId];
    if (!sc || sc.type === 'ending' || sc.isEnding) return;
    if (!Array.isArray(sc.buttons)) sc.buttons = [];
    if (sc.buttons.length >= 6) return;
    sc.buttons.push({ label: '', nextId: null });
    _mtbSyncChoiceLabels(sc); /* v106 */
    const newBtnIdx = sc.buttons.length - 1;
    _mtbNewSceneAndConnect(MTB_EDIT.currentId, newBtnIdx);
  });
}

/* 기존 _mtbInit 직후에 실행 — DOM 준비됐으면 즉시 */
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
   2. 메뉴 표시 — 행동버튼 ① 연결, ②, ..., 편집, 새장면+연결, 삭제
   3. "행동버튼 N 연결" 클릭 → 연결 모드 진입 + 다른 노드 탭 안내
   4. 대상 노드 탭 → 연결 완료 → 모드 해제
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

  /* 메뉴 항목 구성 */
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

async function _mtbHandleMenuAction(sceneId, action, idx) {
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
      alert('장면을 추가할 수 없어요. 새로고침 후 다시 시도해 주세요.');
      return;
    }
    /* 새 scene 생성 — 생성 후 num 추정 */
    const beforeIds = new Set(Object.keys(scenes));
    addScene();
    setTimeout(() => {
      const newId = Object.keys(scenes).find(id => !beforeIds.has(id));
      if (!newId) { _mtbRender('scene-add'); return; }
      /* 현재 scene의 빈 행동 버튼 자리에 연결 (없으면 새로 추가) */
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
      _mtbRender('scene-add-connect');
    }, 200);
    return;
  }

  if (action === 'delete') {
    const ok = window.showMakerConfirm
      ? await window.showMakerConfirm({
          title: '장면을 삭제할까요?',
          message: '이 장면을 삭제하면 이어진 연결이 끊어져요.',
          confirmText: '삭제하기',
          danger: true,
        })
      : confirm(`${_mtbSceneDisplayLabel(sc, sc.num || sceneId)} 삭제할까요?\n다른 장면에서 이 장면으로 연결된 게 끊어져요.`);
    if (!ok) return;
    if (typeof removeScene === 'function') {
      removeScene(sceneId);
    } else if (typeof deleteScene === 'function') {
      deleteScene(sceneId);
    } else {
      /* fallback — 직접 삭제 */
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
  _mtbRender('connect-start'); /* 다시 그려서 source 노드 강조 */
}

function _mtbConnectCancel() {
  MTB_CONNECT.active = false;
  MTB_CONNECT.fromId = null;
  MTB_CONNECT.btnIdx = -1;
  document.getElementById('mobile-text-branch')?.classList.remove('is-connecting');
  document.getElementById('mtb-connect-banner')?.remove();
  _mtbRender('connect-finish');
}

async function _mtbConnectFinish(toId) {
  if (!MTB_CONNECT.active) return;
  const fromId = MTB_CONNECT.fromId;
  const idx    = MTB_CONNECT.btnIdx;
  const sc = scenes[fromId];
  if (!sc) { _mtbConnectCancel(); return; }

  /* 자기 자신 연결 차단 — 사용자가 의도일 수도 있지만 보통 실수 */
  if (String(toId) === String(fromId)) {
    const ok = window.showMakerConfirm
      ? await window.showMakerConfirm({
          title: '같은 장면으로 연결할까요?',
          message: '독자가 이 행동을 누르면 다시 같은 장면으로 돌아와요.',
          confirmText: '연결하기',
          danger: false,
        })
      : confirm('같은 장면으로 연결할까요? (자기 자신 루프)');
    if (!ok) {
      _mtbConnectCancel();
      return;
    }
  }

  if (!Array.isArray(sc.buttons)) sc.buttons = [];
  if (idx >= 0 && idx < sc.buttons.length) {
    sc.buttons[idx].nextId = String(toId);
  } else if (idx >= sc.buttons.length && sc.buttons.length < 6) {
    sc.buttons.push({ label: '', nextId: String(toId) });
  }
  _mtbSyncChoiceLabels(sc); /* v106 */

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
   v104: 배치 모드 — 노드 드래그로 위치 지정
   ─────────────────────────────────────────────────────────────────
   토글 켜진 상태에서:
   · 노드 = 드래그 이동 (메뉴/편집 진입 안 됨)
   · 지정한 위치 = scenes[id].mtbX / mtbY에 저장됨
   · 저장된 위치 있으면 _mtbBuildLayout BFS보다 우선
   · 지정하지 않은 노드는 BFS 자동
   · 캔버스 pan/zoom은 건드리지 않음 (모드 전용)
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
  _mtbRender('place-toggle');
}

function _mtbShowPlaceBanner() {
  document.getElementById('mtb-place-banner')?.remove();
  const banner = document.createElement('div');
  banner.id = 'mtb-place-banner';
  banner.className = 'mtb-place-banner';
  banner.innerHTML = `
    <span>📍 노드 드래그로 위치 이동</span>
    <div class="mtb-place-banner-options">
      <button class="mtb-place-banner-descendants ${MTB.placeDescendants ? 'is-active' : ''}"
        id="mtb-place-descendants" title="이 장면에서 이어지는 장면들도 함께 옮겨요">📦 이어진 장면도 같이</button>
      <button class="mtb-place-banner-cancel" id="mtb-place-banner-cancel">완료</button>
    </div>
  `;
  document.getElementById('mtb-canvas')?.appendChild(banner);
  document.getElementById('mtb-place-banner-cancel').addEventListener('click', _mtbTogglePlaceMode);
  document.getElementById('mtb-place-descendants').addEventListener('click', e => {
    MTB.placeDescendants = !MTB.placeDescendants;
    e.target.classList.toggle('is-active', MTB.placeDescendants);
  });
}
function _mtbHidePlaceBanner() {
  document.getElementById('mtb-place-banner')?.remove();
}

/* v104: 노드 드래그 핸들러 — placeMode 시만 활성. 이동한 위치 즉시 scenes에 저장 + push.
   v106: placeDescendants 켜진 상태면 BFS 자손도 같이 이동 (묶음 이동). */
function _mtbAttachPlaceDrag(node, sceneId) {
  let dragging = false;
  let startX = 0, startY = 0;
  let groupStart = null; /* { id → {x, y} } 이동하는 노드들 시작 위치 */
  let groupNodes = null; /* { id → DOM } */
  let moved = false;

  node.addEventListener('pointerdown', e => {
    if (!MTB.placeMode) return;
    e.stopPropagation();
    dragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;

    /* v106: 자손까지 이동 모드면 BFS 자손 다 묶음 */
    const ids = MTB.placeDescendants
      ? _mtbCollectDescendants(sceneId)
      : [sceneId];

    groupStart = {};
    groupNodes = {};
    ids.forEach(id => {
      const sc = scenes[id];
      if (!sc) return;
      const dom = document.querySelector(`.mtb-node[data-scene-id="${CSS.escape(String(id))}"]`);
      if (!dom) return;
      groupStart[id] = {
        x: (typeof sc.mtbX === 'number') ? sc.mtbX : _mtbReadNodeX(dom),
        y: (typeof sc.mtbY === 'number') ? sc.mtbY : dom.offsetTop,
      };
      groupNodes[id] = dom;
    });
    node.setPointerCapture(e.pointerId);
  });

  node.addEventListener('pointermove', e => {
    if (!dragging || !groupStart) return;
    const dx = (e.clientX - startX) / MTB_VIEW.scale;
    const dy = (e.clientY - startY) / MTB_VIEW.scale;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    Object.entries(groupStart).forEach(([id, start]) => {
      const sc = scenes[id];
      if (!sc) return;
      sc.mtbX = start.x + dx;
      sc.mtbY = start.y + dy;
      const dom = groupNodes[id];
      if (dom) {
        dom.style.left = `calc(50% + ${sc.mtbX}px)`;
        dom.style.top  = sc.mtbY + 'px';
      }
    });
    _mtbRedrawEdges();
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    if (moved && typeof pushToFirebase === 'function') {
      Object.keys(groupStart || {}).forEach(id => pushToFirebase(id));
    }
    groupStart = null;
    groupNodes = null;
  }
  node.addEventListener('pointerup', endDrag);
  node.addEventListener('pointercancel', endDrag);
}

/* v106: BFS로 자손 노드 모두 수집 (자기 + 연결된 모든 후손). 무한 루프 차단. */
function _mtbCollectDescendants(rootId) {
  const result = [String(rootId)];
  const visited = new Set([String(rootId)]);
  const queue = [String(rootId)];
  while (queue.length) {
    const id = queue.shift();
    const sc = scenes[id];
    if (!sc) continue;
    const buttons = Array.isArray(sc.buttons) ? sc.buttons : [];
    buttons.forEach(btn => {
      if (!btn || !btn.nextId) return;
      const nid = String(btn.nextId);
      if (visited.has(nid)) return;
      visited.add(nid);
      result.push(nid);
      queue.push(nid);
    });
  }
  return result;
}

function _mtbReadNodeX(node) {
  /* "calc(50% + Xpx)" 또는 "calc(50% + -Xpx)" 식에서 X 추출. 매칭 실패 시 0. */
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
  /* svg defs 유지 + path만 다시 그림 */
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
  /* anchor 지정 위치 기준 줌 — 그 위치가 동일하게 보이게 x/y 조정 */
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
  /* v102: ⊙ 클릭 시 자동 fit — 모든 노드가 캔버스 안에 들어오게 scale + 가운데. */
  _mtbFitAll();
}

/* v102: 모든 노드가 차지한 범위 보고 scale + center 계산 — 줌 아웃해도 안 접힘 */
function _mtbFitAll() {
  const stage = document.getElementById('mtb-stage');
  const canvas = document.getElementById('mtb-canvas');
  const nodes = document.querySelectorAll('#mtb-nodes .mtb-node');
  if (!stage || !canvas || !nodes.length) {
    MTB_VIEW.scale = 1; MTB_VIEW.x = 0; MTB_VIEW.y = 0;
    _mtbApplyTransform();
    return;
  }
  /* 노드 분포 범위 계산 — stage 좌표 기준 (transform 적용 전 자연 위치) */
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    /* offsetLeft/Top은 transform 적용 전 원래 자리. 단 left:calc(50%+Xpx) 형태 → offsetLeft = 캔버스 절반 + X */
    const cx = n.offsetLeft;
    const cy = n.offsetTop;
    minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
    minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
  });
  /* 노드 크기 감안 — 좌우/상하 여유 */
  const PAD = 60;
  const contentW = (maxX - minX) + PAD * 2;
  const contentH = (maxY - minY) + PAD * 2;
  const canvasW = canvas.clientWidth;
  const canvasH = canvas.clientHeight;
  /* scale — 캔버스 안에 들어오게 + 1보다 크지 않게 */
  const scaleX = canvasW / contentW;
  const scaleY = canvasH / contentH;
  const fitScale = Math.min(1, scaleX, scaleY);
  /* 노드 분포 가운데 (stage 좌표) */
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  /* transform 적용 후 노드 가운데가 캔버스 가운데에 오게 */
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

  /* wheel 줌 (데스크탑 narrow viewport일 때) */
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
    /* 노드 위면 pan/zoom 시작하지 않음 — 노드 자체 핸들러로 */
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
   사용자가 정한 textStyle 데이터 모델 (scenes[id].textStyle) 그대로.
   변경 시 _mtbQueueSave 호출 → pushToFirebase.
   ──────────────────────────────────────────────────────────────── */
/* T-THEME-1: 빈 값('')='테마 기본 글씨체'(fontFamily null). 지원 글씨체만 노출(dohyeon 등 미로드 제거). */
const MTB_FONTS = [
  { id: '',          label: '테마 기본' },
  { id: 'gothic',    label: '나눔고딕' },
  { id: 'batang',    label: '고운바탕' },
  { id: 'hahmlet',   label: 'Hahmlet (명조)' },
  { id: 'diphylleia',label: 'Diphylleia (우아)' },
  { id: 'cormorant', label: 'Cormorant' },
  { id: 'jua',       label: '주아' },
  { id: 'hanna',     label: '한나 (굵음)' },
  { id: 'pen',       label: '나눔펜' },
  { id: 'gaegu',     label: '개구' },
  { id: 'galmuri',   label: '갈무리 (픽셀)' },
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
    /* T-THEME-1: 빈 값 = 테마 기본 → fontFamily null 저장(sentinel). */
    sel.addEventListener('change', e => _mtbUpdateStyle('fontFamily', e.target.value || null));
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

  /* v115: "모든 이야기 장면에 적용" 버튼 — cover/ending 제외하고 textStyle 일괄 적용 */
  const applyAllBtn = document.getElementById('mtb-edit-apply-all');
  if (applyAllBtn) {
    applyAllBtn.addEventListener('click', _mtbApplyTextStyleToAll);
  }

  /* REFINE-IA-2: "이 장면 기본값으로 되돌리기" — 현재 장면 textTheme+textStyle override 제거. */
  const resetBtn = document.getElementById('mtb-edit-reset-scene');
  if (resetBtn) {
    resetBtn.addEventListener('click', _mtbResetSceneStyle);
  }

  /* v115: 표현 설정 초기화 — 토글 / 테마 / 등장 / 장면 전환 */
  _mtbInitVisPanel();
}

/* ================================================================
   v115: 표현 설정 패널 — 모바일 텍스트형에서 작품 단위 표현 설정
   ─────────────────────────────────────────────────────────────────
   기존 PC 텍스트형이 쓰는 필드 그대로 재사용 (사용자 명령):
   · textTheme (scene 단위) — 모바일에선 모든 scene에 같이 적용 (작품 단위 효과)
   · projectMeta.textEntrance / textEntranceSpeed
   · projectMeta.sceneTransition / sceneTransitionSpeed
   viewer-render는 이미 이 필드들 사용 → 코드 변경 X
   ──────────────────────────────────────────────────────────────── */

/* PC 텍스트형이 쓰는 것 그대로 (viewer-data.js의 VALID_TEXT_THEMES 등과 일치) */
/* T-THEME-1: 정본 6종(viewer-data.js VALID_TEXT_THEMES와 일치). novel/magazine 제외. */
const MTB_THEMES = [
  { id: 'classic',     label: '담백한 글' },
  { id: 'paperbook',   label: '고전 기록' },
  { id: 'note',        label: '이야기 노트' },
  { id: 'handwriting', label: '편지와 일기' },
  { id: 'retro',       label: '레트로 게임' },
  { id: 'dark',        label: '밤의 미스터리' },
];
/* LOW-9(2026-07-11): 괄호 영어 식별자 제거(id로 충분) */
const MTB_TEXT_ENTRANCES = [
  { id: 'none',       label: '없음' },
  { id: 'fade',       label: '서서히' },
  { id: 'slide-up',   label: '위로 올라옴' },
  { id: 'blur-in',    label: '흐릿하다 또렷이' },
  { id: 'pop',        label: '튕김' },
  { id: 'typewriter', label: '타자기' },
];
/* LOW-9: '없음' 추가(데스크톱 전환효과와 동일 옵션·저장값 none은 렌더가 이미 지원) */
const MTB_SCENE_TRANSITIONS = [
  { id: 'none',     label: '없음' },
  { id: 'fade',     label: '기본' },
  { id: 'book',     label: '책 넘김' },
  { id: 'scale',    label: '확대' },
  { id: 'slide-up', label: '위로 슬라이드' },
  { id: 'flip3d',   label: '3D 뒤집기' },
];

function _mtbInitVisPanel() {
  /* 토글 */
  const toggle = document.getElementById('mtb-edit-vis-toggle');
  const panel = document.getElementById('mtb-edit-vis-panel');
  const arrow = document.getElementById('mtb-edit-vis-arrow');
  if (toggle && panel) {
    toggle.addEventListener('click', () => {
      const open = panel.classList.toggle('is-open');
      toggle.classList.toggle('is-open', open);
      if (arrow) arrow.textContent = open ? '▲' : '▼';
    });
  }

  /* 테마 카드 */
  const themeRow = document.getElementById('mtb-edit-theme-row');
  if (themeRow) {
    themeRow.innerHTML = MTB_THEMES.map(t =>
      `<button class="mtb-edit-theme-btn" data-val="${t.id}" type="button">${t.label}</button>`
    ).join('');
    themeRow.querySelectorAll('.mtb-edit-theme-btn').forEach(btn => {
      btn.addEventListener('click', () => _mtbApplyThemeToAll(btn.dataset.val));
    });
  }

  /* 텍스트 등장 효과 */
  const teSel = document.getElementById('mtb-edit-text-entrance');
  if (teSel) {
    teSel.innerHTML = MTB_TEXT_ENTRANCES.map(e =>
      `<option value="${e.id}">${e.label}</option>`).join('');
    teSel.addEventListener('change', e => _mtbSaveProjectMeta('textEntrance', e.target.value));
  }
  const teSpeed = document.getElementById('mtb-edit-text-entrance-speed');
  const teSpeedVal = document.getElementById('mtb-edit-text-entrance-speed-val');
  if (teSpeed) {
    teSpeed.addEventListener('input', e => {
      const v = parseInt(e.target.value, 10);
      if (teSpeedVal) teSpeedVal.textContent = v;
      _mtbSaveProjectMeta('textEntranceSpeed', v);
    });
  }

  /* 장면 전환 */
  const stSel = document.getElementById('mtb-edit-scene-transition');
  if (stSel) {
    stSel.innerHTML = MTB_SCENE_TRANSITIONS.map(t =>
      `<option value="${t.id}">${t.label}</option>`).join('');
    stSel.addEventListener('change', e => _mtbSaveProjectMeta('sceneTransition', e.target.value));
  }
  const stSpeed = document.getElementById('mtb-edit-scene-transition-speed');
  const stSpeedVal = document.getElementById('mtb-edit-scene-transition-speed-val');
  if (stSpeed) {
    stSpeed.addEventListener('input', e => {
      const v = parseInt(e.target.value, 10);
      if (stSpeedVal) stSpeedVal.textContent = v;
      _mtbSaveProjectMeta('sceneTransitionSpeed', v);
    });
  }

  /* 초기 값 반영 — projectMeta 로드 후 적용 */
  _mtbReflectVisPanel();
  window.addEventListener('mtb-project-ready', _mtbReflectVisPanel);
}

/* projectMeta에 저장된 값을 패널에 반영 — 진입 시 + 다른 사람 저장 후 */
function _mtbReflectVisPanel() {
  if (typeof projectMeta !== 'object' || !projectMeta) return;
  const teSel = document.getElementById('mtb-edit-text-entrance');
  if (teSel && projectMeta.textEntrance) teSel.value = projectMeta.textEntrance;
  const teSpeed = document.getElementById('mtb-edit-text-entrance-speed');
  const teSpeedVal = document.getElementById('mtb-edit-text-entrance-speed-val');
  if (teSpeed && typeof projectMeta.textEntranceSpeed === 'number') {
    teSpeed.value = projectMeta.textEntranceSpeed;
    if (teSpeedVal) teSpeedVal.textContent = projectMeta.textEntranceSpeed;
  }
  const stSel = document.getElementById('mtb-edit-scene-transition');
  if (stSel && projectMeta.sceneTransition) stSel.value = projectMeta.sceneTransition;
  const stSpeed = document.getElementById('mtb-edit-scene-transition-speed');
  const stSpeedVal = document.getElementById('mtb-edit-scene-transition-speed-val');
  if (stSpeed && typeof projectMeta.sceneTransitionSpeed === 'number') {
    stSpeed.value = projectMeta.sceneTransitionSpeed;
    if (stSpeedVal) stSpeedVal.textContent = projectMeta.sceneTransitionSpeed;
  }
  /* 활성 테마 강조 — REFINE-IA-2: resolved 테마(장면 → 작품 기본값 → classic). */
  const id = MTB_EDIT.currentId;
  const sc = (id !== null && scenes && scenes[id]) ? scenes[id] : null;
  const curTheme = (typeof _mtbResolveTheme === 'function') ? _mtbResolveTheme(sc) : ((sc && sc.textTheme) || 'classic');
  document.querySelectorAll('.mtb-edit-theme-btn').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.val === curTheme);
  });
}

/* projectMeta 필드 저장 — viewer-meta에 기록 */
function _mtbSaveProjectMeta(field, value) {
  if (typeof projectMeta !== 'object' || !projectMeta) return;
  projectMeta[field] = value;
  /* pushProjectMetaToFirebase는 firebase.js가 제공하는 wrapper */
  if (typeof pushProjectMetaToFirebase === 'function') {
    const patch = {}; patch[field] = value;
    pushProjectMetaToFirebase(patch);
  }
}

/* REFINE-IA-2: 테마 = 작품 전체 기본값(projectMeta.textDefaults.textTheme). 데스크탑 "이야기 전체" 탭과 동일 의미.
   ⚠️ 더 이상 모든 scene.textTheme 을 일괄로 덮어쓰지 않음(§3: 기존 장면값 강제 통일 금지).
   장면별 테마를 따로 지정한 장면은 그 값이 우선(override)되고, 지정 안 한 장면·새 장면은 이 기본값을 따름.
   작품 단위 1회 write(viewer-meta/textDefaults) — 장면 일괄 write 없음. */
function _mtbApplyThemeToAll(themeId) {
  const cur = (typeof projectMeta === 'object' && projectMeta && projectMeta.textDefaults && typeof projectMeta.textDefaults === 'object')
    ? projectMeta.textDefaults : {};
  const merged = { ...cur, textTheme: themeId };
  if (typeof _mtbSaveProjectMeta === 'function') _mtbSaveProjectMeta('textDefaults', merged);
  /* UI 즉시 반영 — active는 클릭값이 아니라 현재 장면 resolved 테마 기준(Codex Step3 #3).
     장면에 테마 override가 지정돼 있으면 작품 기본값을 바꿔도 그 장면은 안 바뀌므로 active도 그대로. */
  const _curSc = (MTB_EDIT && MTB_EDIT.currentId !== null && scenes) ? scenes[MTB_EDIT.currentId] : null;
  const active = (typeof _mtbResolveTheme === 'function') ? _mtbResolveTheme(_curSc) : themeId;
  document.querySelectorAll('.mtb-edit-theme-btn').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.val === active);
  });
  if (typeof _mtbRender === 'function') setTimeout(_mtbRender, 100);
}

/* 단순 완료 알림 toast — 브라우저 alert 대신 화면 하단에 잠깐 떴다 사라짐.
   maker.html은 pb-ai.css를 로드하지 않으므로 스타일을 1회만 자체 주입. */
let _mtbToastTimer = null;
function _mtbToast(message, ms) {
  ms = typeof ms === 'number' ? ms : 2600;
  if (!document.getElementById('mtb-toast-style')) {
    const st = document.createElement('style');
    st.id = 'mtb-toast-style';
    st.textContent =
      '.mtb-toast{position:fixed;left:50%;bottom:28px;transform:translate(-50%,16px);z-index:9999;'
      + 'display:flex;align-items:center;gap:8px;max-width:min(92vw,420px);padding:12px 18px;'
      + 'border-radius:14px;background:#eef7ec;border:1px solid #cfe6c7;'
      + 'box-shadow:0 10px 30px rgba(43,31,16,0.18);font-family:\'Nanum Gothic\',sans-serif;'
      + 'font-size:14px;font-weight:700;color:#2f5132;opacity:0;pointer-events:none;'
      + 'transition:opacity .22s ease,transform .22s ease;}'
      + '.mtb-toast.is-show{opacity:1;transform:translate(-50%,0);pointer-events:auto;cursor:pointer;}'
      + '@media(max-width:480px){.mtb-toast{bottom:20px;padding:11px 16px;font-size:13.5px;}}';
    document.head.appendChild(st);
  }
  const old = document.getElementById('mtb-toast-root');
  if (old) old.remove();
  if (_mtbToastTimer) { clearTimeout(_mtbToastTimer); _mtbToastTimer = null; }
  const el = document.createElement('div');
  el.id = 'mtb-toast-root';
  el.className = 'mtb-toast';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.textContent = '✅ ' + message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-show'));
  function dismiss() {
    el.classList.remove('is-show');
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 240);
  }
  _mtbToastTimer = setTimeout(dismiss, ms);
  el.addEventListener('click', dismiss);
}

/* COPY-FIX-2C-2: maker 전용 커스텀 확인 모달 — 브라우저 기본 confirm 대체.
   Promise<boolean> 반환 (확인 = true / 취소·ESC·배경클릭 = false).
   maker.html은 pb-ai.css를 로드하지 않으므로 _mtbToast처럼 스타일 1회 자체 주입.
   ui.js·maker.html에서도 쓸 수 있게 window.showMakerConfirm으로 노출.
   기본 포커스는 취소 버튼 — Enter 실수 진행 방지. */
function showMakerConfirm(opts) {
  opts = opts || {};
  const title = opts.title || '확인할까요?';
  const message = opts.message || '';
  const confirmText = opts.confirmText || '확인';
  const cancelText = opts.cancelText || '취소';
  const danger = !!opts.danger;
  if (!document.getElementById('maker-confirm-style')) {
    const st = document.createElement('style');
    st.id = 'maker-confirm-style';
    st.textContent =
      /* CONFIRM-Z-FIX(2026-07-22): z 10000 → 100066 — 확인 대화상자는 항상 최상위여야 하는데,
         maker의 환영 튜토리얼(100005)·나침반(100001)·그리기 confirm(100060) 등 z-100000대 오버레이
         뒤에 가려지던 것 수정(1단계 주인공 선택이 환영 튜토리얼 뒤에 숨던 사용자 보고). */
      '.maker-confirm-backdrop{position:fixed;inset:0;background:rgba(43,31,16,0.42);'
      + '-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);z-index:100066;'
      + 'display:flex;align-items:center;justify-content:center;padding:20px;}'
      + '.maker-confirm-card{background:#fffaee;border-radius:18px;width:100%;max-width:400px;'
      + 'padding:24px 24px 20px;box-shadow:0 18px 50px rgba(43,31,16,0.28);'
      + 'font-family:\'Nanum Gothic\',sans-serif;color:#2b1f10;text-align:center;}'
      + '.maker-confirm-title{font-size:18px;font-weight:800;color:#c66f4a;margin-bottom:12px;'
      + 'line-height:1.35;word-break:keep-all;}'
      + '.maker-confirm-message{font-size:14.5px;line-height:1.65;color:#4a3a26;word-break:keep-all;}'
      + '.maker-confirm-actions{margin-top:22px;display:flex;gap:10px;justify-content:center;}'
      + '.maker-confirm-cancel,.maker-confirm-ok{min-width:110px;padding:11px 20px;border:none;'
      + 'border-radius:12px;font-family:inherit;font-size:15px;font-weight:700;cursor:pointer;'
      + 'transition:background .15s ease;}'
      + '.maker-confirm-cancel{background:#efe6d4;color:#6b5638;}'
      + '.maker-confirm-cancel:hover{background:#e5d9c2;}'
      + '.maker-confirm-ok{background:#c66f4a;color:#fffaee;}'
      + '.maker-confirm-ok:hover{background:#b25f3c;}'
      + '.maker-confirm-ok.is-danger{background:#d2503c;}'
      + '.maker-confirm-ok.is-danger:hover{background:#bd4231;}'
      + '@media(max-width:480px){.maker-confirm-card{max-width:340px;padding:20px 18px 16px;}'
      + '.maker-confirm-actions{flex-direction:column-reverse;gap:8px;}'
      + '.maker-confirm-cancel,.maker-confirm-ok{width:100%;}}';
    document.head.appendChild(st);
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/\n/g, '<br/>');
  }
  return new Promise((resolve) => {
    const old = document.getElementById('maker-confirm-root');
    if (old) old.remove();
    const root = document.createElement('div');
    root.id = 'maker-confirm-root';
    root.className = 'maker-confirm-backdrop';
    root.innerHTML =
      '<div class="maker-confirm-card" role="dialog" aria-modal="true">'
      +   '<div class="maker-confirm-title">' + esc(title) + '</div>'
      +   (message ? '<div class="maker-confirm-message">' + esc(message) + '</div>' : '')
      +   '<div class="maker-confirm-actions">'
      +     '<button type="button" class="maker-confirm-cancel">' + esc(cancelText) + '</button>'
      +     '<button type="button" class="maker-confirm-ok' + (danger ? ' is-danger' : '') + '">' + esc(confirmText) + '</button>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(root);
    let done = false;
    function finish(val) {
      if (done) return;
      done = true;
      if (root.parentNode) root.parentNode.removeChild(root);
      document.removeEventListener('keydown', onKey);
      resolve(val);
    }
    function onKey(e) { if (e.key === 'Escape') finish(false); }
    root.addEventListener('click', (e) => { if (e.target === root) finish(false); });
    document.addEventListener('keydown', onKey);
    const okBtn = root.querySelector('.maker-confirm-ok');
    const cancelBtn = root.querySelector('.maker-confirm-cancel');
    if (okBtn) okBtn.addEventListener('click', () => finish(true));
    if (cancelBtn) cancelBtn.addEventListener('click', () => finish(false));
    try { (cancelBtn || okBtn).focus(); } catch (_) {}
  });
}
if (typeof window !== 'undefined') {
  window.showMakerConfirm = showMakerConfirm;
}

/* "모든 이야기 장면에 적용" — 현재 장면의 textStyle을 cover/ending 제외하고 적용 */
async function _mtbApplyTextStyleToAll() {
  if (typeof scenes !== 'object' || !scenes) return;
  const curId = MTB_EDIT.currentId;
  if (curId === null) return;
  const cur = scenes[curId];
  if (!cur) return;
  /* REFINE-IA-2.1: 현재 장면의 resolved 스타일(작품 기본값 반영)을 복사 + marker 부여(의도적 예외)
     → 작품 기본값이 있어도 복사가 유지됨. defer 값은 marker 제외. */
  const style = (typeof _mtbResolveStyle === 'function') ? _mtbResolveStyle(cur) : { ...(cur.textStyle || {}) };
  const styleMark = {};
  if (style.fontFamily) styleMark.fontFamily = true;
  if (typeof style.fontSize === 'number') styleMark.fontSize = true;
  if (style.color) styleMark.color = true;
  if (style.weight) styleMark.weight = true;

  /* cover/ending 제외하고 일반 장면만 적용 (사용자 명령) */
  const targets = Object.keys(scenes).filter(id => {
    const s = scenes[id];
    if (!s) return false;
    if (id === String(curId)) return false; /* 자기 자신 스킵 */
    if (s.type === 'cover' || s.isCover) return false;
    if (s.type === 'ending' || s.isEnding) return false;
    return true;
  });

  if (!targets.length) {
    alert('적용할 다른 이야기 장면이 없어요.');
    return;
  }
  const ok = window.showMakerConfirm
    ? await window.showMakerConfirm({
        title: '글자 스타일을 적용할까요?',
        message: '현재 글자 스타일을 선택한 장면들에 적용해요.',
        confirmText: '적용하기',
        danger: false,
      })
    : confirm(`현재 글자 스타일을 ${targets.length}개의 다른 이야기 장면에 적용할까요?\n(표지·엔딩은 제외)`);
  if (!ok) return;

  targets.forEach(id => {
    scenes[id].textStyle = { ...style };
    scenes[id].textStyleOverride = { ...styleMark };
    if (typeof pushToFirebase === 'function') pushToFirebase(id);
  });
  _mtbToast(`${targets.length}개 장면에 적용했어요.`);
}

/* REFINE-IA-2: 현재 장면의 테마+글자 override 제거 → 작품 기본값 따름.
   본문/선택지/연결/효과 데이터는 건드리지 않음(textTheme/textStyle leaf만 제거). */
async function _mtbResetSceneStyle() {
  const id = MTB_EDIT.currentId;
  if (id === null) return;
  const sc = scenes[id];
  if (!sc) return;
  if (typeof _mtbSceneHasOverride === 'function' && !_mtbSceneHasOverride(sc)) return;
  const ok = window.showMakerConfirm
    ? await window.showMakerConfirm({
        title: '이 장면을 작품 기본값으로 되돌릴까요?',
        message: '글 내용과 선택지는 그대로예요. 테마·글꼴·크기·색만 작품 기본값을 따라요.',
        confirmText: '되돌리기',
        danger: false,
      })
    : confirm('이 장면의 꾸미기만 작품 기본값으로 되돌릴까요?\n글 내용과 선택지는 그대로예요.');
  if (!ok) return;
  delete sc.textTheme;
  delete sc.textStyle;
  delete sc.textStyleOverride;   /* REFINE-IA-2.1: marker 제거 */
  delete sc.textThemeOverride;
  if (typeof pushToFirebase === 'function') pushToFirebase(id);
  /* UI 갱신 — resolved 표시 + 되돌리기 버튼 비활성 */
  const resolved = _mtbResolveStyle(sc);
  if (typeof _mtbReflectStyleToUI === 'function') _mtbReflectStyleToUI(resolved);
  if (typeof _mtbReflectStyleToCard === 'function') _mtbReflectStyleToCard(resolved);
  if (typeof _mtbReflectResetState === 'function') _mtbReflectResetState(sc);
  document.querySelectorAll('.mtb-edit-theme-btn').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.val === _mtbResolveTheme(sc));
  });
  if (typeof _mtbRender === 'function') setTimeout(_mtbRender, 100);
  if (typeof _mtbToast === 'function') _mtbToast('작품 기본값으로 되돌렸어요.');
}

/* 되돌리기 버튼 활성/비활성 — 장면에 override 있을 때만 활성. */
function _mtbReflectResetState(sc) {
  const btn = document.getElementById('mtb-edit-reset-scene');
  if (!btn) return;
  const has = (typeof _mtbSceneHasOverride === 'function') ? _mtbSceneHasOverride(sc) : false;
  btn.disabled = !has;
}

/* ================================================================
   REFINE-IA-2 (모바일) — "작품 기본값 + 장면별 예외" resolution (maker 로컬).
   maker.html은 viewer-data.js를 로드하지 않으므로 viewer 측 getTextStyle/getProjectTextDefaults를
   쓸 수 없다 → 같은 의미의 최소 resolver를 projectMeta.textDefaults + scene 기준으로 복제.
   defer(폰트 null/''/auto, 색 '', 숫자 아닌 크기)는 다음 레이어로 위임. 엔딩 floor=jua/20/bold.
   ================================================================ */
const MTB_TEXT_FLOOR   = { fontFamily: null,  fontSize: 18, color: '', weight: 'normal' };
const MTB_ENDING_FLOOR = { fontFamily: 'jua', fontSize: 20, color: '', weight: 'bold'   };
/* viewer-data.js와 정합(Codex Step3 #5): 정본 6종 + 레거시 별칭. fontSize clamp 10~36. */
const MTB_VALID_THEMES = ['classic', 'paperbook', 'note', 'handwriting', 'retro', 'dark'];
const MTB_THEME_ALIASES = { novel: 'paperbook', magazine: 'classic' };
function _mtbCanonTheme(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  if (MTB_VALID_THEMES.indexOf(raw) !== -1) return raw;
  if (Object.prototype.hasOwnProperty.call(MTB_THEME_ALIASES, raw)) return MTB_THEME_ALIASES[raw];
  return null;
}
function _mtbClampSize(n) {
  if (typeof n !== 'number' || !isFinite(n)) return null;
  return Math.max(10, Math.min(36, Math.round(n)));
}
function _mtbProjectDefaults() {
  const d = (typeof projectMeta === 'object' && projectMeta && projectMeta.textDefaults && typeof projectMeta.textDefaults === 'object')
    ? projectMeta.textDefaults : null;
  if (!d) return null;
  const s = (d.textStyle && typeof d.textStyle === 'object') ? d.textStyle : {};
  const style = {};
  if (typeof s.fontFamily === 'string' && s.fontFamily && s.fontFamily !== 'auto') style.fontFamily = s.fontFamily;
  const sz = _mtbClampSize(s.fontSize); if (sz !== null) style.fontSize = sz;
  if (typeof s.color === 'string' && s.color) style.color = s.color;
  const theme = _mtbCanonTheme(d.textTheme);
  return { textTheme: theme, textStyle: style };
}
function _mtbSceneStyleOverride(sc) {
  const raw = sc && sc.textStyle;
  if (!raw || typeof raw !== 'object') return {};
  const o = {};
  if (typeof raw.fontFamily === 'string' && raw.fontFamily && raw.fontFamily !== 'auto') o.fontFamily = raw.fontFamily;
  const sz = _mtbClampSize(raw.fontSize); if (sz !== null) o.fontSize = sz;
  if (typeof raw.color === 'string' && raw.color) o.color = raw.color;
  if (raw.weight === 'bold' || raw.weight === 'normal') o.weight = raw.weight;
  return o;
}
/* REFINE-IA-2.1: "일부러 다르게 한" marker(viewer와 동일 의미). marker 없는 레거시 값은 작품 기본값 따름. */
function _mtbSceneStyleMarks(sc) {
  const m = sc && sc.textStyleOverride;
  return (m && typeof m === 'object') ? m : {};
}
function _mtbSceneThemeMarked(sc) { return !!(sc && sc.textThemeOverride); }
function _mtbResolveStyle(sc) {
  const isEnding = !!(sc && (sc.type === 'ending' || sc.isEnding));
  const floor = isEnding ? MTB_ENDING_FLOOR : MTB_TEXT_FLOOR;
  const o     = _mtbSceneStyleOverride(sc);
  const marks = _mtbSceneStyleMarks(sc);
  const pj  = _mtbProjectDefaults();
  const pjS = (pj && pj.textStyle) ? pj.textStyle : {};
  const isNull  = (x) => (x === null || x === undefined);
  const isEmpty = (x) => (x === '' || x === null || x === undefined);
  /* ① 의도적 예외(marker) → ② 작품 기본값 → ③ 레거시 값 → ④ floor. */
  const pick = (k, deferFn) => {
    const has = (o[k] !== undefined && !deferFn(o[k]));
    if (has && marks[k])  return o[k];
    if (pjS[k] !== undefined && !deferFn(pjS[k])) return pjS[k];
    if (has)              return o[k];
    return floor[k];
  };
  return {
    fontFamily: pick('fontFamily', isNull),
    fontSize:   pick('fontSize',   isNull),
    color:      pick('color',      isEmpty),
    weight:     (o.weight !== undefined) ? o.weight : floor.weight,
  };
}
function _mtbResolveTheme(sc) {
  const canon = _mtbCanonTheme(sc && sc.textTheme);
  if (canon && _mtbSceneThemeMarked(sc)) return canon;
  const pj = _mtbProjectDefaults();
  if (pj && pj.textTheme) return pj.textTheme;
  if (canon) return canon;
  return 'classic';
}
/* 장면이 "일부러 다르게 한"(marker 있는) 항목이 있는지 — 되돌리기 버튼 활성 판정. */
function _mtbSceneHasOverride(sc) {
  const m = _mtbSceneStyleMarks(sc);
  return _mtbSceneThemeMarked(sc) || Object.keys(m).some(k => m[k]);
}

/* REFINE-IA-2: 장면별 sparse override 저장. defer 값('' / null)이면 키 삭제(작품 기본값 위임).
   표시는 resolved(작품 기본값 반영) — Codex Step1 #2/모바일 정렬. */
function _mtbUpdateStyle(field, value) {
  const id = MTB_EDIT.currentId;
  if (id === null) return;
  const sc = scenes[id];
  if (!sc) return;
  if (!sc.textStyle || typeof sc.textStyle !== 'object') sc.textStyle = {};
  if (!sc.textStyleOverride || typeof sc.textStyleOverride !== 'object') sc.textStyleOverride = {};
  if (value === undefined || value === null || value === '') { delete sc.textStyle[field]; delete sc.textStyleOverride[field]; }
  else { sc.textStyle[field] = value; sc.textStyleOverride[field] = true; }  /* REFINE-IA-2.1: 의도적 예외 marker */
  const resolved = _mtbResolveStyle(sc);
  _mtbReflectStyleToUI(resolved);
  _mtbReflectStyleToCard(resolved);
  if (typeof _mtbReflectResetState === 'function') _mtbReflectResetState(sc);
  _mtbQueueSave();
}

function _mtbReflectStyleToUI(style) {
  const sel = document.getElementById('mtb-edit-font');
  /* T-THEME-1: null/없음 → '테마 기본'(value '') 선택 표시. */
  if (sel) sel.value = style.fontFamily || '';
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
  gothic:     "'Nanum Gothic', sans-serif",
  batang:     "'Gowun Batang', serif",
  hahmlet:    "'Hahmlet', 'Gowun Batang', serif",
  diphylleia: "'Diphylleia', 'Cormorant Garamond', serif",
  cormorant:  "'Cormorant Garamond', 'Gowun Batang', serif",
  jua:        "'Jua', sans-serif",
  hanna:      "'Black Han Sans', sans-serif",
  pen:        "'Nanum Pen Script', cursive",
  gaegu:      "'Gaegu', cursive",
  galmuri:    "'Galmuri11', 'Galmuri', monospace",
};

function _mtbReflectStyleToCard(style) {
  /* 편집 카드에 WYSIWYG 적용 (제목/본문).
     REFINE-IA-2(Codex Step3): 빈 값이면 이전 장면 inline 잔상이 남지 않도록 항상 clear('').
     style 은 resolved(작품 기본값 반영) — fontFamily null/color '' = 카드 기본으로. */
  const titleIn = document.getElementById('mtb-edit-scene-title');
  const bodyIn  = document.getElementById('mtb-edit-scene-body');
  const ff = MTB_FONT_FAMILIES[style.fontFamily] || '';
  const color = style.color || '';
  const weight = style.weight === 'bold' ? '700' : '400';
  if (titleIn) {
    titleIn.style.fontFamily = ff;
    titleIn.style.color = color;
  }
  if (bodyIn) {
    bodyIn.style.fontFamily = ff;
    if (typeof style.fontSize === 'number') bodyIn.style.fontSize = style.fontSize + 'px';
    bodyIn.style.color = color;
    bodyIn.style.fontWeight = weight;
  }
}

/* v101: _mtbEditPopulate reassignment 패턴 폐기. _mtbEditPopulate 내부에서
   직접 _mtbReflectStyleToUI/Card 호출하는 식으로 변경됨 (위 함수 정의 참고). */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _mtbInitSettings);
} else {
  _mtbInitSettings();
}

/* v107: 요약 바 칩 동작 연결 — DOM 준비될 때 한 번 */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _mtbInitSummary);
} else {
  _mtbInitSummary();
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

/* ── v110: 표지 cover scene 열기 / 만들기 ──
   사용자가 고른 "옵션 2": 모바일 텍스트형 제작에선 표지(cover scene) 만드는 길만 제공.
   이미 표지 있으면 그 편집 화면으로, 없으면 addScene('cover') 호출 후 편집.
   sceneRenderer.js의 addScene('cover')는 중복 차단이 들어 있음. */
function _mtbOpenCoverScene() {
  if (typeof scenes !== 'object' || !scenes) return;
  const findCover = () => {
    for (const id of Object.keys(scenes)) {
      const s = scenes[id];
      if (s && (s.type === 'cover' || s.isCover)) return id;
    }
    return null;
  };
  const existing = findCover();
  if (existing) {
    _mtbOpenEditScene(existing);
    return;
  }
  if (typeof addScene !== 'function') {
    alert('표지 만들기 기능을 사용할 수 없어요.');
    return;
  }
  addScene('cover');
  /* addScene이 비동기일 수 있어 잠깐 기다린 후 새 cover scene 찾음 */
  setTimeout(() => {
    const newId = findCover();
    if (newId) {
      /* v111: PC에서 만든 옛 작품이 p.coverTitle만 있고 cover scene은 없는 경우,
         모바일에서 새 cover scene 만들면 sc.title이 빈 채라 옛 제목이 시각적으로 사라짐.
         일회 마이그: 새 cover scene의 title/subtitle이 비어있을 때만 p.coverTitle을 sc.title로
         복사. p.coverTitle 자체는 안 건드림 (PC 흐름 손대지 X). 사용자가 정한 "PC 설정 안 깨기" 충족. */
      try {
        const sc = scenes[newId];
        const p = (typeof projectMeta === 'object' && projectMeta) ? projectMeta : null;
        if (sc && p && p.coverTitle && !sc.title && !sc.subtitle) {
          sc.title = String(p.coverTitle);
          if (typeof pushToFirebase === 'function') pushToFirebase(newId);
        }
      } catch (e) { /* 마이그 실패해도 진입은 계속 */ }
      _mtbRender('first-scene-create');
      _mtbOpenEditScene(newId);
    } else {
      alert('표지 만들기에 실패했어요.');
    }
  }, 120);
}

/* ── BASE10-1: 완전히 빈 텍스트 작품 → 기본 10장면 틀 생성 ──
   적용 범위: 모바일 텍스트형 + 빈 작품 + 사용자가 #mtb-start-template 직접 클릭.
   자동 생성 절대 없음. 그림책/무비/PC 빈 캔버스/ptype-screen 미적용.
   구조: 표지(key 1) → 이야기 장면(key 2~9, normal) → 엔딩(key 10). 총 10.
   연결: 1→2→3→…→10. 본문/제목은 빈 채(학생이 직접 작성).
   장면 shape은 sceneRenderer.js addScene과 동일하게 맞춤
   (presentationMode:'picturebook' — 작품 단위 projectType='text' lock이 우선이라 표시엔 영향 없음). */
let _mtbBase10Creating = false;

/* BASE10-2F: 기본 10장면의 x/y만 source별로 결정.
   · mobile = 기존 세로 계단식(절대 불변).
   · desktop = 표지가 적당히 아래에서 시작해 오른쪽으로 6개, 7~10은 둘째 줄.
   구조/키/연결/type엔 일절 관여하지 않음(좌표만). */
function _base10PositionFor(num, source) {
  if (source === 'desktop') {
    /* BASE10-2F(2차): 1→10 전부 같은 줄로 오른쪽 일렬(7번부터 내려가지 않음).
       표지(180)에서 시작해 320px 간격으로 우측 진행, y는 모두 320. */
    const D = {
      1: { x: 180, y: 320 }, 2: { x: 500, y: 320 }, 3: { x: 820, y: 320 },
      4: { x: 1140, y: 320 }, 5: { x: 1460, y: 320 }, 6: { x: 1780, y: 320 },
      7: { x: 2100, y: 320 }, 8: { x: 2420, y: 320 }, 9: { x: 2740, y: 320 },
      10: { x: 3060, y: 320 },
    };
    return D[num] || { x: 180 + (num - 1) * 320, y: 320 };
  }
  /* mobile (기존 좌표 그대로 — 변경 금지) */
  return { x: 120, y: 120 + (num - 1) * 120 };
}

function _mtbBuildBase10Scenes(opts) {
  const source = (opts && opts.source) || 'mobile';
  /* COMPASS-LENGTH-BASE: 이야기 장면 수(표지·엔딩 제외) — 나침반 v2 targetLength 연결.
     허용 8/12/15만, 그 외/미지정=8(기존 BASE10과 byte-identical: 2~9 + 엔딩 10).
     선형 구조만 늘어남(1→2→…→끝) — 분기 자동 생성 없음(학생이 직접 붙임). */
  const _sc = (opts && (opts.storyCount === 12 || opts.storyCount === 15)) ? opts.storyCount : 8;
  const endingKey = _sc + 2;   /* 8→10(현행), 12→14, 15→17 */
  const out = {};
  /* 표지 = key 1 */
  const p1 = _base10PositionFor(1, source);
  out['1'] = {
    num: 1, title: '', body: '', type: 'cover',
    subtitle: '', coverTheme: 'default', titleVerticalPosition: 50,
    buttons: [{ label: '▶️ 시작하기', nextId: '2' }],
    choiceA: '', choiceB: '', choiceCount: 1,
    _hasBody: true, presentationMode: 'picturebook',
    x: p1.x, y: p1.y,
  };
  /* 이야기 장면 — key 2~(storyCount+1) normal (다음 장면으로 연결) */
  for (let n = 2; n <= endingKey - 1; n++) {
    const p = _base10PositionFor(n, source);
    out[String(n)] = {
      num: n, title: '', body: '', type: 'normal',
      buttons: [{ label: '다음으로 가기', nextId: String(n + 1) }],
      choiceA: '', choiceB: '', choiceCount: 1,
      _hasBody: true, presentationMode: 'picturebook',
      x: p.x, y: p.y,
    };
  }
  /* 마지막 = 엔딩 (감상 흐름이 자연스럽게 끝남) */
  const p10 = _base10PositionFor(endingKey, source);
  out[String(endingKey)] = {
    num: endingKey, title: '', body: '', type: 'ending', trueEnding: false,
    buttons: [],
    choiceA: '', choiceB: '', choiceCount: 1,
    _hasBody: true, presentationMode: 'picturebook',
    x: p10.x, y: p10.y,
  };
  /* HOTFIX(신규 그림책 기본 레이아웃): 신규 그림책 BASE10의 표지·장면·엔딩을 모두
     '가로 그림중심형'(picturebookSubmode:'imageCenter')으로 명시 저장 — 신규 생성만.
     · text 등 비-그림책은 미부착(텍스트/무비/체험 영향 0).
     · 폴백(renderer)은 무변경 → 필드 없는 기존 작품은 split 그대로(기존 저장값 보존).
     · 분할형은 사용자가 이후 다듬기에서 직접 선택(picturebookSubmode:'split' 명시 저장).
     · ptype: 호출자(createStarterTemplateForNewProject)가 넘긴 명시값 우선, 없으면 projectMeta. */
  const _pbPtype = (opts && opts.ptype)
    || ((typeof projectMeta !== 'undefined' && projectMeta && projectMeta.projectType) || null);
  if (_pbPtype === 'picturebook') {
    Object.keys(out).forEach(k => { out[k].picturebookSubmode = 'imageCenter'; });
  }
  return out;
}

/* BASE10-3A: 실제 쓰기 코어 — 확인 모달/버튼 UI와 분리.
   수동 버튼 경로(_runBase10Creation)와 자동 생성 경로(createStarterTemplateForNewProject)가
   같은 안전 로직(loaded/empty/once-recheck/lock)을 공유한다.
   · build 함수(_mtbBuildBase10Scenes)는 그대로 재사용 → 구조/좌표 일치 보장.
   · dbRef.update만 사용(set 전체 덮어쓰기 금지).
   · markInitialized=true면 성공 후 viewer-meta/starterTemplateInitialized=true 기록(merge).
   반환: { ok:boolean, reason?:string }. */
async function _writeBase10IfEmpty(opts) {
  opts = opts || {};
  const source = opts.source || 'desktop';

  /* 가드: 중복(동시) 생성 방지 — 모듈 전역 락 공유 */
  if (_mtbBase10Creating) return { ok: false, reason: 'busy' };

  /* 가드: scenes 첫 스냅샷 도착 전이면 중단 — "로드 전 빈 객체" 오판 차단 */
  const loaded = (typeof window.isBranchScenesLoaded === 'function')
    ? window.isBranchScenesLoaded() : !!window.__branchScenesLoaded;
  if (!loaded) return { ok: false, reason: 'not-loaded' };

  /* 가드: 메모리상 이미 장면이 하나라도 있으면 중단 */
  if (typeof scenes === 'object' && scenes && Object.keys(scenes).length > 0) {
    return { ok: false, reason: 'not-empty' };
  }

  /* 가드: dbRef 없으면 중단 */
  if (typeof dbRef === 'undefined' || !dbRef) return { ok: false, reason: 'no-dbref' };

  _mtbBase10Creating = true;
  try {
    /* 저장 직전 Firebase 재확인 — 다른 기기가 먼저 만들었으면 중복 생성 차단 */
    const snap = await dbRef.once('value');
    const latest = snap.val() || {};
    if (Object.keys(latest).length > 0) return { ok: false, reason: 'remote-exists' };

    /* 기본 장면 1회 기록 (set 전체 덮어쓰기 X — update 사용) */
    /* HOTFIX: ptype 전달 → 그림책이면 빌더가 imageCenter 명시.
       COMPASS-LENGTH-BASE: storyCount(8/12/15) 전달 — 미지정=8(기존 BASE10 동일).
       SCRIPT-DRAFT-2: customScenes(사전 구성 장면맵)가 오면 빌더 대신 그대로 사용 —
       가드(로드/빈 작품/원격 재확인/락)와 _sceneToDbShape 경유는 동일. */
    const raw = opts.customScenes
      || _mtbBuildBase10Scenes({ source, ptype: opts.ptype, storyCount: opts.storyCount });
    const payload = {};
    Object.keys(raw).forEach(k => {
      payload[k] = (typeof _sceneToDbShape === 'function') ? _sceneToDbShape(raw[k]) : raw[k];
    });
    await dbRef.update(payload);

    /* 자동 생성: 재생성 차단용 meta 플래그 기록 (update=merge — projectType 등 보존).
       플래그 기록 실패해도 장면 생성은 유효 — 다음 진입에서 once-recheck가 중복 차단. */
    if (opts.markInitialized && window._metaRef && typeof window._metaRef.update === 'function') {
      try { await window._metaRef.update({ starterTemplateInitialized: true }); }
      catch (_) { /* noop — 장면 생성 성공이 우선 */ }
    }

    /* local scenes / 노드 렌더는 dbRef.on('value') 리스너가 갱신 (firebase.js) */
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'error' };
  } finally {
    _mtbBase10Creating = false;
  }
}

/* BASE10-2: 모바일·PC 공통 "수동 버튼" 생성 경로 — 확인 모달 유지.
   source별 활성 조건만 호출자가 gateOk로 넘긴다(모바일=_mtbShouldActivate,
   PC=텍스트/그림책형+비admin). 실제 쓰기는 _writeBase10IfEmpty가 담당. */
async function _runBase10Creation(opts) {
  opts = opts || {};
  const btn = opts.btn || null;
  const idleText = opts.idleText || '기본 틀로 시작하기';
  const busyText = opts.busyText || '만드는 중…';

  /* 가드 1: 중복 클릭(동시 생성) 방지 */
  if (_mtbBase10Creating) return false;

  /* 가드 2: scenes 첫 스냅샷 도착 전이면 중단 */
  const loaded = (typeof window.isBranchScenesLoaded === 'function')
    ? window.isBranchScenesLoaded() : !!window.__branchScenesLoaded;
  if (!loaded) {
    _mtbToast('아직 작품을 불러오는 중이에요. 잠시 후 다시 시도해 주세요.');
    return false;
  }

  /* 가드 3: source별 활성 조건 불충족이면 조용히 중단 (무비/체험형/admin 차단) */
  if (opts.gateOk === false) return false;

  /* 가드 4: 메모리상 이미 장면이 하나라도 있으면 중단 */
  if (typeof scenes === 'object' && scenes && Object.keys(scenes).length > 0) {
    _mtbToast('이미 장면이 있는 작품에는 기본 틀을 만들 수 없어요.');
    return false;
  }

  /* 가드 5: dbRef 없으면 중단 */
  if (typeof dbRef === 'undefined' || !dbRef) {
    _mtbToast('작품 정보가 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.');
    return false;
  }

  /* 사용자 확인 — 수동 경로는 명시적 의도 모달 유지 */
  const ok = window.showMakerConfirm
    ? await window.showMakerConfirm({
        title: '기본 이야기 틀을 만들까요?',
        message: '표지와 장면 1~9가 한 번에 준비돼요. 내용은 나중에 자유롭게 바꿀 수 있어요.',
        confirmText: '만들기',
        cancelText: '취소',
        danger: false,
      })
    : confirm('표지와 이야기 장면 9개를 한 번에 만들까요?');
  if (!ok) return false;

  if (btn) { btn.disabled = true; btn.textContent = busyText; }
  try {
    /* 수동 경로는 meta 플래그 기록 안 함(markInitialized:false) — 정책상 플래그는 자동 생성 전용 */
    const res = await _writeBase10IfEmpty({ source: opts.source || 'mobile', markInitialized: false });
    if (res.ok) {
      _mtbToast('기본 이야기 틀을 만들었어요.');
      return true;
    }
    if (res.reason === 'remote-exists') {
      _mtbToast('다른 곳에서 이미 장면이 만들어졌어요. 새로고침 후 확인해 주세요.');
    } else if (res.reason === 'not-empty') {
      _mtbToast('이미 장면이 있는 작품에는 기본 틀을 만들 수 없어요.');
    } else if (res.reason === 'error') {
      _mtbToast('기본 틀을 만들지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
    return false;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = idleText; }
  }
}

/* BASE10-3A: scenes 첫 스냅샷 로드를 최대 timeoutMs 동안 대기.
   ptype 선택 직후 첫 on('value')가 아직 안 왔을 수 있어 짧게 기다렸다 자동 생성 실행. */
function _waitBranchScenesLoaded(timeoutMs) {
  timeoutMs = typeof timeoutMs === 'number' ? timeoutMs : 4000;
  const isLoaded = () => (typeof window.isBranchScenesLoaded === 'function')
    ? window.isBranchScenesLoaded() : !!window.__branchScenesLoaded;
  if (isLoaded()) return Promise.resolve(true);
  return new Promise(resolve => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (isLoaded()) { clearInterval(timer); resolve(true); }
      else if (Date.now() - start > timeoutMs) { clearInterval(timer); resolve(false); }
    }, 80);
  });
}

/* BASE10-3A: viewer-meta/starterTemplateInitialized === true 인지 서버에서 직접 확인.
   projectMeta 캐시는 이 필드를 담지 않으므로 _metaRef로 once 조회(fallback 오판 회피). */
async function _isStarterTemplateInitialized() {
  try {
    if (!window._metaRef || typeof window._metaRef.child !== 'function') return false;
    const snap = await window._metaRef.child('starterTemplateInitialized').once('value');
    return snap.val() === true;
  } catch (_) { return false; }
}

/* BASE10-3A: 신규 text/그림책 작품 첫 projectType 선택 직후 자동 생성(모달 없음).
   ui.js _enterMakerAfterPtypeSelected의 신규(!_ptypeExistingType) 분기에서만 호출.
   ★ projectMeta fallback(DEFAULT='picturebook')에 의존하지 않고 호출자가 넘긴
     명시 ptype만 신뢰한다 → 유형 미설정/로딩중 작품 오판 차단.
   movie/experience·기존작품·전체삭제후(meta 플래그)·비어있지 않음은 내부 가드로 제외. */
async function createStarterTemplateForNewProject(explicitPtype, starterOpts) {
  /* 1. 명시 유형이 text/picturebook일 때만 (movie/experience/기타 차단) */
  if (explicitPtype !== 'text' && explicitPtype !== 'picturebook') return false;
  /* COMPASS-LENGTH-BASE: 나침반 완료 경로가 넘기는 storyCount(8/12/15)만 인정 — 그 외 8.
     기존 호출부(ui.js 폴백 등, 인자 1개)는 undefined → 8 = 기존 BASE10 그대로(하위호환). */
  const _storyCount = (starterOpts && (starterOpts.storyCount === 12 || starterOpts.storyCount === 15))
    ? starterOpts.storyCount : 8;

  /* 2. admin 미리보기는 자동 생성 안 함 (수동 버튼과 동일 정책) */
  const isAdmin = new URLSearchParams(location.search).get('admin') === '1';
  if (isAdmin) return false;

  /* 3. scenes 로드 대기 — 선택 직후 첫 스냅샷이 아직이면 잠깐 기다림 */
  const ready = await _waitBranchScenesLoaded(4000);
  if (!ready) return false;

  /* 4. 이미 초기화된 작품이면 자동 생성 안 함 — 전체삭제 후 재생성 차단 */
  const already = await _isStarterTemplateInitialized();
  if (already) return false;

  /* 5. 쓰기 코어 — empty 재확인 + once-recheck + 생성 + 플래그 기록(모달 없음) */
  /* HOTFIX: 명시 ptype 전달 → 그림책이면 imageCenter 기본 레이아웃 명시 저장 */
  const res = await _writeBase10IfEmpty({ source: 'desktop', markInitialized: true, ptype: explicitPtype, storyCount: _storyCount });
  if (res.ok) {
    _mtbToast('기본 이야기 틀이 준비됐어요.');
    return true;
  }
  return false;
}
window.createStarterTemplateForNewProject = createStarterTemplateForNewProject;

/* ════════════════════════════════════════════════════════════════
   PICTUREBOOK-LEVELS ③(2026-07-18): AI 이야기 초안 스타터 — 그림책 1·2단계.
   나침반 완료 훅(thought-compass-scenes afterComplete)이 호출.
   · 콜러블 studentStoryDraft(서버가 단계/빈작품/총량 재검증) → 성공 시
     BASE10 골격(_mtbBuildBase10Scenes)에 제목/본문만 얹어 customScenes로 기록
     — 가드(로드/빈작품/원격재확인/락)·_sceneToDbShape 경유는 기본 틀과 100% 동일.
   · 어떤 실패든 false 반환 → 호출자가 기본 틀 폴백(기존 동작·회귀 0).
   정본: docs/picturebook_levels_design_20260718.md §7.4 ════════ */

/* 나침반 답 {key:{answerText,deferred,...}} → "key: 답" 디지스트(맥락 전용·1500자 상한)
   FOLLOWUP-DIGEST-1: followUps[](후속 상세답)도 동봉 — 아이가 구체화한 핵심 정보
   (예: goal 후속 "도현이가 잃어버린 물건을 찾아줘야 해요")가 여기 있는데 종전엔 통째로
   버려져, AI가 문제를 스스로 지어내던(잃어버린 물건→과학 프로젝트) 원인이었다. */
function _storyDraftAnswersDigest(answers, storyValue, followUps) {
  if (!answers || typeof answers !== 'object') return '';
  const lines = [];
  /* COMPASS-VALUE-1(2026-07-21): 1단계 마지막 질문에서 고른 가치 — 맨 앞에 강조(1500자
     컷에 잘리지 않게·mustInclude 강조와 동일하게 answersText 안 지시라 초안 서버 무변경). */
  const _sv = String(storyValue == null ? '' : storyValue).replace(/\s+/g, ' ').trim().slice(0, 12);
  if (_sv) lines.push('(중요: 이 이야기가 전하고 싶은 가치는 "' + _sv + '"예요 — 인물의 행동과 마음, 결말의 느낌으로 은근히 드러내되, 교훈처럼 설명하지 마세요)');
  let mustIncludeText = '';
  Object.keys(answers).forEach((k) => {
    const a = answers[k];
    if (!a || typeof a !== 'object') return;
    if (a.deferred === true) return;
    const t = String(a.answerText == null ? '' : a.answerText).replace(/\s+/g, ' ').trim();
    if (!t) return;
    lines.push(k + ': ' + t.slice(0, 200));
    /* EASY-MUSTINC: '꼭 넣고 싶은 것'(easy2 9번) — 유예/최소답("이야기를 만들면서…")이 아니면 강조 대상 */
    if (k === 'mustInclude' && t.indexOf('만들면서 정할래요') < 0) mustIncludeText = t.slice(0, 200);
  });
  /* EASY-MUSTINC: 아이의 '꼭 넣고 싶은 것'은 반드시 등장하도록 디지스트 끝에 명시 지시
     (서버 프롬프트 무변경 — answersText 안 지시라 배포 불요·1500자 상한 내). */
  if (mustIncludeText) lines.push('(중요: mustInclude에 적힌 "' + mustIncludeText + '"은(는) 이야기에 꼭 등장시켜 주세요)');
  /* FOLLOWUP-DIGEST-1: 후속 상세답 동봉 — 아이가 콕 집어 구체화한 정보라 반드시 반영.
     parentQuestionId로 어느 질문의 상세인지 표시(예: "goal(상세): 잃어버린 물건을 찾아줘야"). */
  if (Array.isArray(followUps) && followUps.length) {
    const fuLines = [];
    followUps.forEach((f) => {
      if (!f || typeof f !== 'object') return;
      const a = String(f.answer == null ? '' : f.answer).replace(/\s+/g, ' ').trim();
      if (!a) return;
      const p = String(f.parentQuestionId == null ? '' : f.parentQuestionId).replace(/\s+/g, ' ').trim();
      fuLines.push((p ? p + '(상세): ' : '상세: ') + a.slice(0, 160));
    });
    if (fuLines.length) {
      lines.push('', '[아이가 더 구체적으로 정한 것 — 반드시 반영]');
      fuLines.forEach((l) => lines.push('- ' + l));
      lines.push('(중요: 위 상세 설정은 아이가 직접 콕 집은 핵심이에요. 다른 문제/사건으로 바꾸지 말고 그대로 이야기에 담아 주세요.)');
    }
  }
  return lines.join('\n').slice(0, 1500);
}

/* ════ LEVELS-CONT-B: 위치 기반 씨앗 힌트 — 나침반 답으로 클라가 결정적 생성 ════
   AI가 "다음 전개"를 예언하던 서버 hint를 폐기(아이가 다르게 쓰면 남은 힌트가 어긋나는
   꼬임 원인) → 이야기 위치(어려움↑·마음·선택·그다음·마무리길·엔딩)별 고정 문구에
   아이 자신의 나침반 답을 «»로 되비추기만 한다. 내용을 예언하지 않으니 어떻게 써도
   안 꼬이고, '시키는 말'이 아니라 '네 계획 되짚기'가 된다(사용자 결정 2026-07-18).
   · 대상 키: BASE10 5~9(빈 이야기 장면)+10(엔딩). AI 시작 3장면=키 2~4.
   · 답이 유예/없음이면 인용 없이 위치 문구만(항상 안전). 순수 함수 — 하니스 검증용. */
function _buildLinearSeedHints(answers, followUps) {
  const at = (k) => {
    const a = answers && typeof answers === 'object' ? answers[k] : null;
    if (!a || typeof a !== 'object' || a.deferred === true) return '';
    const t = String(a.answerText == null ? '' : a.answerText).replace(/\s+/g, ' ').trim();
    return t;
  };
  const q = (k) => {
    const t = at(k);
    if (!t) return '';
    return ' «' + (t.length > 36 ? t.slice(0, 36) + '…' : t) + '»';
  };
  /* FOLLOWUP-HINT-1: 후속 상세답(parentQuestionId→답) 맵. 아이가 콕 집은 구체 정보를
     해당 위치 힌트에 함께 되비춘다(예: goal 후속 "잃어버린 물건을 찾아줘야"). */
  const fuMap = {};
  if (Array.isArray(followUps)) {
    followUps.forEach((f) => {
      if (!f || typeof f !== 'object') return;
      const p = String(f.parentQuestionId == null ? '' : f.parentQuestionId).replace(/\s+/g, ' ').trim();
      const a = String(f.answer == null ? '' : f.answer).replace(/\s+/g, ' ').trim();
      if (p && a && !fuMap[p]) fuMap[p] = a;
    });
  }
  const fq = (k) => {
    const t = fuMap[k];
    if (!t) return '';
    return ' «' + (t.length > 30 ? t.slice(0, 30) + '…' : t) + '»';
  };
  /* 힌트엔 goal 슬롯이 없어 아이가 정한 '핵심 문제/할 일'이 안 보이던 빈틈 →
     구체 후속답(있으면)·없으면 목표답을 첫 이어쓰기 장면(5) 앞에 앵커. */
  const goalCore = fuMap['goal'] || at('goal');
  const goalLead = goalCore
    ? ('네가 도와줄/풀 일: «' + (goalCore.length > 28 ? goalCore.slice(0, 28) + '…' : goalCore) + '» ')
    : '';
  const hints = {
    /* SEAM-TONE-HINT(2026-07-20): 2단계 4팀 실주행 소견② — AI 시작 3장면(해요체)과 아이 글의
       말투가 갈리면 점검에서 시제 지적이 다발. 첫 이어쓰기 장면(5) 힌트에 말투 맞추기 한 줄. */
    '5': goalLead + '이제 일이 점점 어려워질 차례야.' + (q('risingTrouble') ? ' 네가 정한 어려움:' + q('risingTrouble') + fq('risingTrouble') : '') + ' 앞 장면과 말투를 맞춰서 써 보자.',
    '6': '어려움이 커질 때 주인공의 마음은 어떨까?' + (q('protagonist') ? ' 네 주인공:' + q('protagonist') + fq('protagonist') : '') + ' 마음이 보이게 써 보자.',
    '7': '중요한 선택의 순간이야!' + (q('keyChoice') ? ' 네가 정한 고민:' + q('keyChoice') + fq('keyChoice') : '') + ' 주인공은 어떻게 할까?',
    '8': '선택한 다음, 무슨 일이 벌어질까? 일이 풀려도 좋고, 뜻밖의 일이 생겨도 좋아.',
    '9': '마무리로 가는 길이야.' + (q('trueEnding') ? ' 네가 그린 끝:' + q('trueEnding') + fq('trueEnding') : '') + ' 그대로 가도, 다른 길로 가도 좋아.',
    '10': '마지막 장면이야!' + (q('coreMessage') ? ' 네가 지키고 싶은 마음:' + q('coreMessage') : '') + ' 그 마음이 담기게 끝내 보자.',
  };
  Object.keys(hints).forEach((k) => { hints[k] = hints[k].slice(0, k === '5' ? 180 : 150); });
  return hints;
}
window._buildLinearSeedHints = _buildLinearSeedHints;   /* 하니스 검증용 노출 */

/* 초안(JSON)을 BASE10 골격에 얹어 저장. 성공 시 true. */
async function _applyStoryDraftStarter(draft, opts) {
  opts = opts || {};
  const sc = (opts.storyCount === 12 || opts.storyCount === 15) ? opts.storyCount : 8;
  const skeleton = _mtbBuildBase10Scenes({ source: 'desktop', ptype: 'picturebook', storyCount: sc });
  const endingKey = String(sc + 2);
  /* 표지(1) = 책 제목 · 장면(2..sc+1) = 초안 순서대로 · 엔딩(sc+2).
     LEVELS-FEEDBACK(2026-07-19): 장면 제목은 폐기된 기능 — 표지 책 제목만 쓰고
     일반/엔딩 장면 title은 비워 둔다(AI가 만든 제목이 다듬기 UI에 노출되던 것 제거). */
  if (skeleton['1']) skeleton['1'].title = String(draft.title || '').slice(0, 40);
  /* LEVELS-CONT-B: level 2 초안은 시작 3장면만 옴(구서버가 hint를 보내와도 무시 —
     힌트는 아래에서 나침반 답으로 클라 생성). level 1은 전 장면 완성문 그대로. */
  for (let i = 0; i < sc; i++) {
    const key = String(i + 2);
    const s = draft.scenes && draft.scenes[i];
    if (!skeleton[key] || !s) continue;
    skeleton[key].body = String(s.body || '').slice(0, 600);
  }
  if (skeleton[endingKey] && draft.ending) {
    skeleton[endingKey].body = String(draft.ending.body || '').slice(0, 600);
  }
  if (opts.level === 2) {
    const hints = _buildLinearSeedHints(opts.answers, opts.followUps);
    Object.keys(hints).forEach((key) => {
      const sk = skeleton[key];
      if (sk && !(sk.body && sk.body.trim())) sk.writingHint = hints[key];
    });
  }
  const res = await _writeBase10IfEmpty({
    source: 'desktop', markInitialized: true, ptype: 'picturebook',
    storyCount: sc, customScenes: skeleton,
  });
  if (res.ok) {
    _mtbToast(opts.level === 1
      ? '동화책 이야기가 준비됐어요!'
      : 'AI가 이야기를 시작해 줬어요. 힌트를 보며 이어서 완성해 보세요!');
  }
  return !!res.ok;
}

/* ════ DRAFT-UX(2026-07-20 사용자 피드백): 초안 생성 진행 표시 + 실패 사유 안내 ════
   1·2단계는 경험 전체가 초안에 달려 있는데, 종전엔 ①생성 중(15~30초) 아무 표시가 없고
   ②실패 시 사유 없이 조용히 기본 틀 폴백이라 "고장난 것 같다"로 보였음(교사 실보고 —
   실제 원인은 학급 'AI 이야기 초안' 토글 OFF). 폴백 자체는 유지(수업 계속). */
function _showStoryDraftOverlay(level) {
  _hideStoryDraftOverlay();
  const ov = document.createElement('div');
  ov.id = 'story-draft-progress-overlay';
  ov.setAttribute('role', 'status');
  ov.style.cssText = 'position:fixed;inset:0;z-index:100002;display:flex;align-items:center;justify-content:center;background:rgba(40,32,20,.55);';
  ov.innerHTML = '<div style="max-width:420px;width:calc(100% - 48px);background:#fffdf8;border-radius:16px;padding:30px 24px;text-align:center;box-shadow:0 12px 40px rgba(60,40,10,.25);font-family:inherit;">'
    + '<div style="font-size:34px;margin-bottom:10px;" aria-hidden="true">🌱</div>'
    + '<div style="font-size:19px;font-weight:800;color:#3a2c14;margin-bottom:8px;">AI가 이야기를 만들고 있어요…</div>'
    + '<div style="font-size:14px;color:#6b5638;line-height:1.6;">' + (level === 1
      ? '나침반에 답한 내용으로 동화책 글을 쓰고 있어요.<br/>글이 먼저 오고, 그림은 뒤이어 만들어져요. (30초 정도)'
      : '나침반에 답한 내용으로 이야기의 시작을 쓰고 있어요.<br/>조금만 기다려 주세요. (30초 정도)')
    + '</div></div>';
  document.body.appendChild(ov);
}
function _hideStoryDraftOverlay() {
  const ov = document.getElementById('story-draft-progress-overlay');
  if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
}
/* 실패 사유 → 아이/교사가 알아들을 안내(alert 1회). 폴백(기본 틀)은 호출자가 계속 진행. */
function _notifyStoryDraftFail(kind, detail) {
  let msg;
  if (kind === 'mode-off') {
    msg = 'AI 이야기 만들기가 아직 열려 있지 않아요.\n선생님께 "AI 이야기 초안 켜 주세요"라고 말씀드려 주세요.\n\n(선생님: 관리 화면 → 학급 AI 설정 → [AI 이야기 초안] 켜기.\n켠 뒤에는 모둠 카드의 [🔄 처음부터 다시]로 다시 시작할 수 있어요.)';
  } else if (kind === 'quota') {
    msg = (detail || '이 모둠의 이야기 만들기 횟수를 다 썼어요.') + '\n\n(선생님: 모둠 카드의 [🔄 처음부터 다시]로 초기화할 수 있어요.)';
  } else if (kind === 'refused') {
    msg = 'AI가 이 이야기 소재로는 동화책을 만들기 어렵다고 해요.\n' + (detail ? '이유: ' + detail + '\n' : '') + '\n선생님과 함께 나침반 내용을 바꿔서 다시 해 보세요.';
  } else {
    msg = 'AI 이야기를 만들지 못했어요. 잠시 후 다시 시도해 주세요.\n\n(선생님: 다시 시도는 모둠 카드의 [🔄 처음부터 다시]를 사용해요.)';
  }
  try { alert('🌱 ' + msg + '\n\n지금은 빈 이야기 틀로 시작해요.'); } catch (e) { /* noop */ }
}

/* ════ DRAFT-UX-2(2026-07-20): 1단계 그림 생성 진행 배지 ════
   그림은 장당 50~70초 백그라운드(9장≈3~5분) — 토스트 한 줄로는 "안 만들어진다"로
   보임(교사 실보고 2회). aiVariants/image 도착 수를 8초 폴링해 좌하단 배지로 표시,
   완료 시 ✅ 안내 후 제거. read-only·팀 전환 시 자동 종료. viewer 쪽은 viewer-data가 담당. */
let _storyImgBadgeTimer = null;
function _stopStoryImageBadge() {
  if (_storyImgBadgeTimer) { clearInterval(_storyImgBadgeTimer); _storyImgBadgeTimer = null; }
}
function _startStoryImageBadge(classId, tName, expected) {
  try { _stopStoryImageBadge(); document.getElementById('story-image-progress-badge')?.remove(); } catch (e) {}
  if (!classId || !tName || !expected) return;
  const enc = encodeURIComponent(tName);
  const el = document.createElement('div');
  el.id = 'story-image-progress-badge';
  el.setAttribute('role', 'status');
  el.style.cssText = 'position:fixed;left:14px;bottom:14px;z-index:99990;padding:10px 16px;background:#fffdf8;border:1.5px solid #d8c7a6;border-radius:12px;box-shadow:0 4px 16px rgba(80,60,20,.18);font-size:13.5px;color:#5b4a2e;font-weight:700;max-width:80vw;';
  el.textContent = '🎨 AI 그림 만드는 중 0/' + expected + '… (장당 1분 정도)';
  document.body.appendChild(el);
  let ticks = 0;
  const poll = async () => {
    ticks++;
    const badge = document.getElementById('story-image-progress-badge');
    if (!badge) { _stopStoryImageBadge(); return; }
    /* 팀을 바꿨으면 이 배지는 남의 것 — 종료 */
    try { if (typeof teamName === 'string' && teamName && teamName !== tName) { badge.remove(); _stopStoryImageBadge(); return; } } catch (e) {}
    let n = 0;
    try {
      const snap = await firebase.database().ref('classes/' + classId + '/teams/' + enc + '/aiVariants/image').once('value');
      n = Object.keys(snap.val() || {}).length;
    } catch (e) { /* 읽기 실패 = 표시만 유지 */ }
    if (n >= expected) {
      badge.textContent = '✅ AI 그림 ' + n + '장 완성! [▶️ 감상해 보기]에서 확인해 보세요.';
      _stopStoryImageBadge();
      setTimeout(() => { try { badge.remove(); } catch (e) {} }, 10000);
      return;
    }
    badge.textContent = '🎨 AI 그림 만드는 중 ' + n + '/' + expected + '… (장당 1분 정도)';
    if (ticks > 90) { badge.remove(); _stopStoryImageBadge(); }   /* 12분 상한 — 조용히 종료 */
  };
  _storyImgBadgeTimer = setInterval(poll, 8000);
  poll();
}
window._startStoryImageBadge = _startStoryImageBadge;   /* 하니스 검증용 */

/* 콜러블 호출 + 적용. 모든 실패 = false(호출자 폴백). */
async function requestStoryDraftStarter(opts) {
  opts = opts || {};
  let _overlayShown = false;
  try {
    if (typeof firebase === 'undefined' || !firebase.app) return false;
    const classId = String(opts.classId || '').trim();
    const teamName = String(opts.teamName || '').trim();
    if (!classId || !teamName) return false;
    const answersText = _storyDraftAnswersDigest(opts.answers, opts.storyValue, opts.followUps);
    if (!answersText) return false;   /* 답이 하나도 없으면 초안 불가 → 기본 틀 */
    const sc = (opts.storyCount === 12 || opts.storyCount === 15) ? opts.storyCount : 8;

    /* DRAFT-UX: 생성 중 표시(레벨은 호출 전제상 1|2 — 표시 문구용) */
    const _lvl = (typeof window.getPicturebookLevel === 'function') ? window.getPicturebookLevel() : null;
    _showStoryDraftOverlay(_lvl);
    _overlayShown = true;

    const res = await firebase.app().functions('asia-northeast3')
      .httpsCallable('studentStoryDraft')({ classId, teamName, storyCount: sc, answersText });
    const data = res && res.data;
    if (!data || data.ok !== true || !data.draft) {
      /* DRAFT-UX: refused = 사유 안내 후 기본 틀 폴백(종전 조용한 로그 → 명시 안내) */
      _hideStoryDraftOverlay(); _overlayShown = false;
      if (data && data.refused) {
        console.warn('[storyDraft] refused:', data.reason);
        _notifyStoryDraftFail('refused', data.reason);
      } else {
        _notifyStoryDraftFail('etc');
      }
      return false;
    }
    _hideStoryDraftOverlay(); _overlayShown = false;
    /* LEVELS-CONT-B: answers 동봉 — level 2 위치 기반 씨앗 힌트를 나침반 답으로 생성 */
    const applied = await _applyStoryDraftStarter(data.draft, { storyCount: data.storyCount || sc, level: data.level, answers: opts.answers, followUps: opts.followUps });
    /* PICTUREBOOK-LEVELS ④: 1단계 = 그림도 자동 — fire-and-forget(대기 없음·실패해도 글은 유효).
       서버(generateStoryImages)가 단계/토글/팀당 총량/이중 실행 lock을 재검증. 결과는
       aiVariants s2 슬롯에 쌓여 감상 진입 시 AI-DEFAULT-VIEW-1이 자동 표시. */
    if (applied && data.level === 1) {
      /* LV1-PROTAG-VISION(2026-07-22 부활): 그림 생성 전 "내 주인공 그릴래요?" 선택.
         그리면 서버가 비전으로 설명→순수 생성에 반영(edits 아님·화풍 안정). 아니면 즉시 자동 생성.
         ⚠️선택창(showMakerConfirm z10000)은 나침반 완료 오버레이(z100000) 뒤에 가려지므로,
         여기선 pending 플래그만 남기고 오버레이 닫힌 뒤 브랜치 화면에서 띄운다(멈춤 버그 방지). */
      try {
        sessionStorage.setItem('pbLv1NeedsProtagChoice', JSON.stringify({ classId, teamName, sc, at: Date.now() }));
      } catch (e) {
        /* sessionStorage 불가 → 선택 못 띄우므로 즉시 자동 생성(그림은 나옴) */
        _fireLv1StoryImageBatch(classId, teamName, sc);
      }
    }
    return applied;
  } catch (e) {
    /* 미배포(NOT_FOUND)·권한(MODE_NOT_ENABLED)·총량 초과 등 전부 폴백 — fail-open.
       DRAFT-UX: 조용한 폴백 → 사유 안내 후 폴백(1·2단계는 경험 전체가 초안이라 침묵=고장으로 보임). */
    if (_overlayShown) _hideStoryDraftOverlay();
    const code = String((e && e.code) || '');
    const emsg = String((e && e.message) || '');
    console.warn('[storyDraft] fallback to base10:', code || emsg || e);
    if (/MODE_NOT_ENABLED|AI_NOT_ENABLED/.test(emsg)) {
      _notifyStoryDraftFail('mode-off');
    } else if (/resource-exhausted/.test(code) || /횟수/.test(emsg)) {
      _notifyStoryDraftFail('quota', /[가-힣]/.test(emsg) ? emsg : '');
    } else {
      _notifyStoryDraftFail('etc');
    }
    return false;
  }
}
window.requestStoryDraftStarter = requestStoryDraftStarter;

/* ════ 1단계 그림 배치 시작 헬퍼 — 초안 직후 즉시 fire-and-forget(배지 포함) ════ */
function _fireLv1StoryImageBatch(classId, teamName, sc) {
  try {
    /* timeout: 서버 540s 배치 — 클라 기본 70s로는 완주 전에 deadline-exceeded가 찍힘(무해하지만
       로그 오해 소지·1단계 e2e에서 실측). 서버값+여유(#56 _FN_TIMEOUT_MS와 동일 원칙). */
    firebase.app().functions('asia-northeast3')
      .httpsCallable('generateStoryImages', { timeout: 570000 })({ classId, teamName })
      .then((r) => {
        const g = r && r.data;
        console.info('[storyImages] done:', g && g.generated, 'skipped:', g && g.skipped);
      })
      .catch((e) => console.warn('[storyImages] fail:', (e && (e.code || e.message)) || e));
    _mtbToast('그림도 만들고 있어요! 조금 뒤 [감상해 보기]에서 볼 수 있어요. 🎨');
    /* DRAFT-UX-2: 진행 배지 — 이야기 장면 sc개 + 엔딩 1 = 그림 대상 수 */
    _startStoryImageBadge(classId, teamName, sc + 1);
  } catch (e) { /* 그림 실패는 비치명 */ }
}
window._fireLv1StoryImageBatch = _fireLv1StoryImageBatch;

/* LV1-PROTAG-VISION: 나침반 오버레이가 닫힌 뒤 브랜치 화면에서 호출 — pending 플래그가 있으면
   주인공 선택을 띄운다. 없으면 no-op. thought-compass-review _complete가 오버레이 close 직후 호출. */
async function _runPendingLv1ProtagChoice() {
  let info = null;
  try { const raw = sessionStorage.getItem('pbLv1NeedsProtagChoice'); if (raw) info = JSON.parse(raw); } catch (e) { info = null; }
  if (!info || !info.classId || !info.teamName) return;
  try { sessionStorage.removeItem('pbLv1NeedsProtagChoice'); } catch (e) { /* noop */ }
  try { await _promptLv1ProtagonistChoice(info.classId, info.teamName, info.sc || 12); }
  catch (e) { /* 실패해도 배치는 _promptLv1... 내부 폴백이 담당 */ }
}
window.__runPendingLv1ProtagChoice = _runPendingLv1ProtagChoice;

/* 감사 #27: pending 플래그 부팅 소비처 — 환영 튜토리얼 중 새로고침/탭 이탈로 review._complete의
   소비를 놓치면 1단계 그림 배치가 영영 안 돌던 것. 부팅 몇 초 뒤, 같은 팀 세션이 복원됐고
   나침반/환영 오버레이가 없을 때만 재소비(정상 흐름의 review 소비 우선·다른 팀 재로그인=무시).
   플래그 제거·주인공 선택창·폴백 배치는 _runPendingLv1ProtagChoice 기존 로직 그대로. */
if (typeof window !== 'undefined' && typeof sessionStorage !== 'undefined') {
  setTimeout(function () {
    try {
      const raw = sessionStorage.getItem('pbLv1NeedsProtagChoice');
      if (!raw) return;
      if (document.getElementById('thought-compass-flow')
          || document.getElementById('thought-compass-review')
          || document.getElementById('tutorial-welcome-overlay')) return;
      const info = JSON.parse(raw);
      /* PENDING-FRESH-1(2026-07-27·감사 #14): 형제 소비처(viewer-edit _lv1PendingDrawInfo)와 대칭으로
         2시간 지난 stale 플래그는 버린다 — 옛 세션 잔재로 이야기 없이 주인공 선택창만 뜨는 것 방지. */
      if (!info || (typeof info.at === 'number' && (Date.now() - info.at) > 2 * 60 * 60 * 1000)) {
        try { sessionStorage.removeItem('pbLv1NeedsProtagChoice'); } catch (e) { /* noop */ }
        return;
      }
      const ms = JSON.parse(sessionStorage.getItem('makerSession') || 'null');
      if (!ms || ms.classId !== info.classId || ms.teamName !== info.teamName) return;
      _runPendingLv1ProtagChoice();
    } catch (e) { /* noop — 다음 정상 소비처가 처리 */ }
  }, 6000);
}

async function _promptLv1ProtagonistChoice(classId, teamName, sc) {
  let draw = false;
  try {
    if (typeof window.showMakerConfirm === 'function') {
      draw = await window.showMakerConfirm({
        title: '🎨 그림을 만들기 전에 — 주인공을 직접 그릴래요?',
        message: '주인공을 한 번 그려 두면, AI가 그 모습(모자·색·소품)을 살려서 모든 장면을 그려 줘요.\n그리지 않아도 AI가 알아서 예쁘게 그려 줘요.',
        confirmText: '✏️ 내 주인공 그리기',
        cancelText: '아니요, AI가 그려주세요',
      });
    }
  } catch (e) { draw = false; }
  if (!draw) { _fireLv1StoryImageBatch(classId, teamName, sc); return; }
  /* 그리기 선택 → 다듬기(그리기 스튜디오)로 이동. 도착하면 주인공 게이트가 열리고
     저장/건너뛰기 시 그쪽에서 배치 시작(pending 플래그·2h 신선도). */
  try {
    sessionStorage.setItem('pbLv1ProtagDraw', JSON.stringify({ classId, teamName, sc, at: Date.now() }));
  } catch (e) { _fireLv1StoryImageBatch(classId, teamName, sc); return; }
  try { if (typeof flushTitleSaves === 'function') flushTitleSaves(); } catch (e) {}
  try { if (typeof flushBodySaves === 'function') flushBodySaves(); } catch (e) {}
  try { if (typeof _saveReturnContext === 'function') _saveReturnContext('maker'); } catch (e) {}
  const params = ['team=' + encodeURIComponent(teamName), 'edit=1', 'from=maker', 'scene=1', 'classId=' + encodeURIComponent(classId)];
  const _vurl = 'viewer.html?' + params.join('&');
  if (typeof _openInternalUrl === 'function') _openInternalUrl(_vurl);
  else window.location.href = _vurl;
}

/* 모바일 텍스트 브랜치 빈 화면(#mtb-start-template) 핸들러 */
async function _mtbCreateBase10Template() {
  const btn = document.getElementById('mtb-start-template');
  const gateOk = (typeof _mtbShouldActivate === 'function') ? _mtbShouldActivate() : false;
  return _runBase10Creation({ btn, gateOk, source: 'mobile' });
}

/* BASE10-2 / BASE10-3A: PC maker 빈 캔버스(좌측 장면 목록 #ss-start-template) 수동 핸들러.
   모바일 활성과 무관 — 텍스트/그림책형 + 비admin일 때만 동작(빈 작품 여부는 코어가 재확인).
   BASE10-3A: 그림책형도 수동 버튼 허용(전체 삭제 후 재생성용). */
async function _createBase10FromDesktop() {
  const btn = document.getElementById('ss-start-template');
  const isAdmin = new URLSearchParams(location.search).get('admin') === '1';
  const pt = (typeof projectMeta !== 'undefined' && projectMeta) ? projectMeta.projectType : null;
  const isStarter = (pt === 'text' || pt === 'picturebook');
  return _runBase10Creation({ btn, gateOk: (isStarter && !isAdmin), source: 'desktop' });
}

/* PC 쪽(ui.js)에서 위임 호출 — build 함수도 함께 노출(구조 일치 보장용) */
window.createBase10StarterScenes = _createBase10FromDesktop;
window.buildBase10StarterScenes = _mtbBuildBase10Scenes;
/* SCRIPT-DRAFT-2: 대본 도우미 구조 가져오기 — BASE10과 같은 가드·락·쓰기 경로 공유 */
window.writeCustomScenesIfEmpty = (sceneMap) =>
  _writeBase10IfEmpty({ source: 'scriptDraft', customScenes: sceneMap, markInitialized: false });

/* ── 초기화 ── */
function _mtbInit() {
  /* PC 토글 — 모바일로 돌아가려면 새로고침 안내 */
  const pcBtn = document.getElementById('mtb-pc-toggle');
  if (pcBtn) {
    pcBtn.addEventListener('click', async () => {
      const ok = window.showMakerConfirm
        ? await window.showMakerConfirm({
            title: 'PC 버전으로 전환할까요?',
            message: '현재 화면을 PC 편집 화면으로 바꿔요.',
            confirmText: '전환하기',
            danger: false,
          })
        : confirm('PC 버전으로 전환할까요?\n\n모바일로 다시 돌아가려면 페이지를 새로고침해주세요 (Cmd+R 또는 Ctrl+R).');
      if (!ok) return;
      MTB.pcOverride = true;
      mtbRefresh();
    });
  }
  /* v110: 📖 표지 버튼 */
  const coverBtn = document.getElementById('mtb-cover-toggle');
  if (coverBtn) {
    coverBtn.addEventListener('click', _mtbOpenCoverScene);
  }
  /* 나가기 — branch.html 또는 메인으로 */
  const backBtn = document.getElementById('mtb-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = 'index.html';
    });
  }
  /* v104: 배치 모드 토글 — 켜진 상태에서 노드 드래그로 위치 지정 */
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
      /* v111: 표지만 있고 일반 장면이 하나도 없으면 감상 진입 차단.
         시작하기 누를 거리가 없어 감상이 멎음. 사용자가 고른 안 = 안내만, 자동 장면 생성 X. */
      try {
        const ids = (typeof scenes === 'object' && scenes) ? Object.keys(scenes) : [];
        if (ids.length) {
          const hasNonCover = ids.some(id => {
            const s = scenes[id];
            return s && s.type !== 'cover' && !s.isCover;
          });
          if (!hasNonCover) {
            alert('이야기 첫 장면도 만들어주세요.\n\n표지만 있으면 감상이 시작 장면으로 넘어갈 수 없어요.\n+ 버튼으로 첫 이야기 장면을 만들어보세요.');
            return;
          }
        }
      } catch (e) { /* 검사 실패해도 진입은 계속 */ }
      /* 쌓인 변경 강제 push (debounce 흐름 우회) */
      if (typeof _flushPushToFirebaseNow === 'function') _flushPushToFirebaseNow();
      const params = new URLSearchParams();
      params.set('team', tn);
      params.set('from', 'maker');
      if (cid) params.set('classId', cid);
      params.set('ptype', 'text');
      /* v108: 감상에서 돌아올 때 입장 화면 떨어지는 문제 fix.
         viewer-render의 _resolveFallbackUrl(ctx)이 ctx 없으면 resume=1 안 붙은 URL 반환했음.
         여기서 모바일 텍스트형 복귀 URL을 ctx에 명시 지정 (team/classId/ptype/resume=1 다 포함).
         ui.js _saveReturnContext는 location.href 그대로 저장해서 모바일 정보 손실 가능 — 직접 지정. */
      try {
        const backParams = new URLSearchParams();
        backParams.set('team', tn);
        backParams.set('from', 'maker');
        backParams.set('resume', '1');
        if (cid) backParams.set('classId', cid);
        backParams.set('ptype', 'text');
        localStorage.setItem('branchReturnContext', JSON.stringify({
          source: 'maker',
          url: 'maker.html?' + backParams.toString(),
          savedAt: Date.now(),
        }));
      } catch (e) { /* localStorage 막혀도 진입은 계속 */ }
      window.location.href = `viewer.html?${params.toString()}`;
    });
  }
  /* + 추가 — 사용자가 정한 신규 scene 추가 함수 (sceneRenderer.js) 호출.
     Step 3에서 정식 흐름 갖출 예정. */
  const addBtn = document.getElementById('mtb-add-scene');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (typeof addScene === 'function') {
        addScene();
        setTimeout(_mtbRender, 200);
      } else {
        alert('아직 사용할 수 없는 기능이에요.');
      }
    });
  }

  /* BASE10-1: 빈 상태 카드의 "기본 틀로 시작하기" 버튼 (없으면 조용히 통과) */
  const tplBtn = document.getElementById('mtb-start-template');
  if (tplBtn) {
    tplBtn.addEventListener('click', _mtbCreateBase10Template);
  }

  /* 작품 로드 완료 이벤트 listen — state.projectType 설정된 후 mtbRefresh */
  window.addEventListener('mtb-project-ready', mtbRefresh);

  /* viewport resize 시 재평가 (회전 등) */
  window.addEventListener('resize', () => {
    if (!MTB.pcOverride) mtbRefresh();
  });

  /* DOM 로드 직후 한 번 시도 (state 준비돼 있으면 활성) */
  setTimeout(mtbRefresh, 100);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _mtbInit);
} else {
  _mtbInit();
}

/* 외부에서 호출 가능 (작품 로드 흐름에서) */
window.mtbRefresh = mtbRefresh;
