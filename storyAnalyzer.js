/* ================================================================
   storyAnalyzer.js — 이야기 구조 분석 + 루트 탐색
   의존: state.js (scenes)

   설계 원칙:
   - analyze* 함수: DOM 접근 없는 pure function — 데이터만 받아 결과 반환
   - render* 함수: 분석 결과를 DOM에 표시하는 역할만
   - 이 분리로 로직 변경 시 UI 코드를 건드리지 않아도 됨
   ================================================================ */

/* ================================================================
   PURE FUNCTIONS — DOM 접근 없음, 테스트 가능
   ================================================================ */

/* 모든 루트를 DFS로 탐색해 반환
   반환: [ [ {scene, choice?, choiceLabel?}, ... ], ... ]
   ※ DOM 접근 없음 — scenes 객체만 참조 */
function findAllRoutes() {
  const starts = Object.values(scenes).filter(s => s.type === 'start');
  if (!starts.length) return [];
  const startNum = starts[0].num;
  const routes   = [];

  function dfs(num, path, visited) {
    if (visited.has(num)) return;
    const s = scenes[num];
    if (!s) return;
    visited.add(num);
    const newPath = [...path, { scene: s }];
    if (s.type === 'ending') { routes.push(newPath); return; }

    const cnt  = s.choiceCount || 2;
    const hasA = s.nextA && scenes[s.nextA];
    const hasB = s.nextB && scenes[s.nextB];

    if (cnt === 1) {
      if (hasA) dfs(s.nextA, [...newPath, { choice: '→', choiceLabel: '' }], new Set(visited));
      else      routes.push(newPath);
    } else {
      if (hasA) dfs(s.nextA, [...newPath, { choice: 'A', choiceLabel: s.choiceA || '선택지 A' }], new Set(visited));
      if (hasB) dfs(s.nextB, [...newPath, { choice: 'B', choiceLabel: s.choiceB || '선택지 B' }], new Set(visited));
      if (!hasA && !hasB) routes.push(newPath);
    }
  }
  dfs(startNum, [], new Set());
  return routes;
}

/* 구조 문제를 분석해 항목 배열로 반환 — DOM 수정 없음
   반환: [ { cls: 'check-ok'|'check-warn'|'check-error'|'check-divider', msg: string, errorNums?: number[] } ] */
function analyzeStructure() {
  const items    = [];
  const sceneArr = Object.values(scenes);

  if (!sceneArr.length) {
    return [{ cls: 'check-warn', msg: '⚠️ 장면이 없어요.' }];
  }

  const starts  = sceneArr.filter(s => s.type === 'start');
  const endings = sceneArr.filter(s => s.type === 'ending');

  if (!starts.length)       items.push({ cls: 'check-error', msg: '❌ 시작 장면이 없어요!' });
  else if (starts.length>1) items.push({ cls: 'check-warn',  msg: `⚠️ 시작 장면이 ${starts.length}개예요.` });
  else                      items.push({ cls: 'check-ok',    msg: '✅ 시작: 장면 ' + starts[0].num });

  if (!endings.length) items.push({ cls: 'check-error', msg: '❌ 엔딩 장면이 없어요!' });
  else items.push({ cls: 'check-ok', msg: `✅ 엔딩: ${endings.length}개 (${endings.map(e => e.num).join(', ')})` });

  const noConn = sceneArr.filter(s => s.type === 'normal' && !s.nextA && !s.nextB);
  if (noConn.length) {
    items.push({
      cls: 'check-warn',
      msg: `⚠️ 연결 없는 장면: ${noConn.map(s => s.num).join(', ')}`,
      errorNums: noConn.map(s => s.num)   // ← DOM 조작은 호출부에서
    });
  } else {
    items.push({ cls: 'check-ok', msg: '✅ 모든 장면 연결됨' });
  }

  const broken = [];
  sceneArr.forEach(s => {
    if (s.nextA && !scenes[s.nextA]) broken.push(`장면 ${s.num} A → 없는 장면 ${s.nextA}`);
    if (s.nextB && !scenes[s.nextB]) broken.push(`장면 ${s.num} B → 없는 장면 ${s.nextB}`);
  });
  broken.forEach(b => items.push({ cls: 'check-error', msg: '❌ ' + b }));

  /* 루트 깊이 분석 */
  const routes = findAllRoutes();
  if (routes.length > 0) {
    const endingRoutes  = routes.filter(r => r[r.length-1].scene?.type === 'ending');
    const sceneCounts   = routes.map(r => r.filter(step => step.scene).length);
    const minLen        = Math.min(...sceneCounts), maxLen = Math.max(...sceneCounts);
    const branchPoints  = sceneArr.filter(s =>
      s.type !== 'ending' && s.nextA && s.nextB && scenes[s.nextA] && scenes[s.nextB]);
    const shortRoutes   = routes.filter(r => r.filter(s => s.scene).length <= 3);

    items.push({ cls: 'check-divider', msg: '── 작품 깊이 분석 ──' });

    if (!endingRoutes.length)        items.push({ cls: 'check-error', msg: '❌ 엔딩에 도달하는 루트가 없어요.' });
    else if (endingRoutes.length===1)items.push({ cls: 'check-warn',  msg: '⚠️ 엔딩이 1개뿐이에요. 다른 결말을 추가하면 더 재미있어요!' });
    else                             items.push({ cls: 'check-ok',    msg: `✅ 루트가 ${endingRoutes.length}개예요. 다양한 결말이 있어요!` });

    if (maxLen <= 2)       items.push({ cls: 'check-warn', msg: '⚠️ 이야기가 너무 짧아요. 장면을 더 이어 붙여보세요!' });
    else if (maxLen <= 4)  items.push({ cls: 'check-warn', msg: `⚠️ 가장 긴 루트가 ${maxLen}장면이에요. 조금 더 깊게 만들어보세요!` });
    else                   items.push({ cls: 'check-ok',   msg: `✅ 가장 긴 루트: ${maxLen}장면 / 가장 짧은 루트: ${minLen}장면` });

    if (shortRoutes.length > 0 && routes.length > 1)
      items.push({ cls: 'check-warn', msg: `⚠️ 3장면 이하로 끝나는 루트가 ${shortRoutes.length}개 있어요.` });

    if (!branchPoints.length) items.push({ cls: 'check-warn', msg: '⚠️ 진짜 갈림길이 없어요! 선택지 A/B를 모두 연결해 보세요.' });
    else                      items.push({ cls: 'check-ok',   msg: `✅ 갈림길: ${branchPoints.length}곳` });
  }

  return items;
}

/* ================================================================
   RENDER FUNCTIONS — 분석 결과를 DOM에 표시
   ================================================================ */

function checkStructure() {
  const panel  = document.getElementById('check-panel');
  const result = document.getElementById('check-result');
  panel.style.display = 'block';

  /* DOM 조작: 이전 에러 표시 초기화 */
  document.querySelectorAll('.scene-card').forEach(el => el.classList.remove('error-card'));

  const items = analyzeStructure();

  /* errorNums가 있는 항목만 DOM에 error-card 클래스 추가 */
  items.forEach(item => {
    if (item.errorNums) {
      item.errorNums.forEach(n => document.getElementById('card-' + n)?.classList.add('error-card'));
    }
  });

  result.innerHTML = items.map(i =>
    i.cls === 'check-divider'
      ? `<div style="text-align:center;color:var(--muted);font-size:11px;margin:8px 0 4px;">${i.msg}</div>`
      : `<div class="check-item ${i.cls}">${i.msg}</div>`
  ).join('');
}

/* ── 루트 보기 패널 ── */
function openRoutePanel() {
  document.getElementById('route-panel').style.display = 'flex';
  renderRouteTabs();
}

function closeRoutePanel() {
  document.getElementById('route-panel').style.display = 'none';
}

function renderRouteTabs() {
  const routes  = findAllRoutes();
  const tabs    = document.getElementById('route-tabs');
  const content = document.getElementById('route-content');

  if (!routes.length) {
    tabs.innerHTML = '';
    content.innerHTML = '<div style="color:var(--muted);text-align:center;padding:24px;">시작 장면이 없거나 연결된 경로가 없어요.</div>';
    return;
  }

  tabs.innerHTML = routes.map((route, i) => {
    const lastScene = route[route.length-1].scene;
    const isEnding  = lastScene.type === 'ending';
    const isTrueEnd = isEnding && lastScene.trueEnding;
    const label     = isEnding ? `${i+1}번 루트${isTrueEnd ? ' ⭐' : ''}` : `루트 ${i+1} (미완성)`;
    return `<button class="js-route-tab" data-route-idx="${i}" id="route-tab-${i}"
      style="padding:6px 14px;border-radius:50px;font-family:var(--font-h);font-size:13px;cursor:pointer;
        border:2px solid ${isTrueEnd ? '#f0c000' : isEnding ? '#9b4dca' : '#f0a000'};
        background:#fff;color:${isTrueEnd ? '#b08000' : isEnding ? '#9b4dca' : '#f0a000'};">
      ${isTrueEnd ? '⭐' : isEnding ? '🏁' : '⚠️'} ${label}
    </button>`;
  }).join('');
  /* ★ tabs.addEventListener는 여기서 호출하지 않음 — DOMContentLoaded에서 1회 등록 */

  showRoute(0, routes);
}

function showRoute(idx, routesArg) {
  const routes = routesArg || findAllRoutes();
  const route  = routes[idx];

  document.querySelectorAll('[id^="route-tab-"]').forEach((btn, i) => {
    const isActive = i === idx;
    btn.style.background = isActive ? '#9b4dca' : '#fff';
    btn.style.color      = isActive ? '#fff'
      : (btn.style.borderColor === '#f0c000' ? '#b08000'
        : btn.style.borderColor === '#f0a000' ? '#f0a000' : '#9b4dca');
  });

  if (!route) return;
  const content    = document.getElementById('route-content');
  const sceneCount = route.filter(s => s.scene).length;
  const choiceCnt  = route.filter(s => s.choice !== undefined).length;

  let html = `<div style="background:#f8f0ff;border-radius:12px;padding:10px 14px;margin-bottom:14px;
    display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
    <div style="font-family:var(--font-h);font-size:15px;color:#9b4dca;">🧭 ${idx+1}번 루트</div>
    <div style="font-size:12px;color:#7a6090;background:#fff;padding:3px 10px;border-radius:50px;border:1px solid #d4b0f0;">📄 ${sceneCount}장면</div>
    <div style="font-size:12px;color:#7a6090;background:#fff;padding:3px 10px;border-radius:50px;border:1px solid #d4b0f0;">🔀 ${choiceCnt}번 선택</div>
  </div>`;

  route.forEach(step => {
    if (step.choice !== undefined) {
      const isB   = step.choice === 'B';
      const color = isB ? 'var(--ending)' : 'var(--primary)';
      const lbl   = step.choiceLabel || (step.choice === '→' ? '다음으로' : `선택지 ${step.choice}`);
      html += `<div style="display:flex;align-items:center;gap:8px;margin:6px 0 6px 20px;">
        <div style="width:2px;height:20px;background:${color};border-radius:2px;"></div>
        <div style="font-size:12px;color:${color};font-weight:700;background:${isB?'#ffe8ee':'#e8f0ff'};padding:3px 10px;border-radius:50px;">${lbl}</div>
      </div>`;
    } else {
      const s        = step.scene;
      const isEnding = s.type === 'ending', isStart = s.type === 'start';
      const color    = isStart ? 'var(--start)' : isEnding ? (s.trueEnding ? '#d4a000' : 'var(--ending)') : 'var(--primary)';
      const bgColor  = isStart ? '#f0fff8' : isEnding ? (s.trueEnding ? '#fffbee' : '#fff0f4') : '#f8fbff';
      const badge    = isStart ? '🟢 시작' : isEnding ? (s.trueEnding ? '⭐ 진엔딩' : '🏁 엔딩') : `장면 ${s.num}`;
      html += `<div style="background:${bgColor};border:1.5px solid ${color};border-radius:12px;padding:12px 14px;margin-bottom:2px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="font-family:var(--font-h);font-size:12px;color:${color};background:#fff;padding:2px 8px;border-radius:50px;border:1px solid ${color};">${badge}</span>
          ${isEnding ? `<span style="font-size:11px;color:var(--muted);">장면 ${s.num}</span>` : ''}
        </div>
        <div style="font-size:14px;color:#2a3a4a;line-height:1.7;white-space:pre-wrap;">${s.title || '<span style="color:#bbb;font-style:italic;">내용 없음</span>'}</div>
      </div>`;
    }
  });

  const last = route[route.length-1].scene;
  if (last.type !== 'ending') {
    html += `<div style="margin-top:10px;padding:8px 12px;background:#fff8e8;border-radius:8px;font-size:12px;color:#8a5000;">
      ⚠️ 이 경로는 엔딩에 도달하지 못했어요.
    </div>`;
  } else {
    const endingCount  = routes.filter(r => r[r.length-1].scene?.type === 'ending').length;
    const trueEndIdx   = routes.findIndex(r => r[r.length-1].scene?.trueEnding);
    const isThisTrueEnd = last.trueEnding;
    const otherCount   = endingCount - 1;

    if (isThisTrueEnd) {
      html += `<div style="margin-top:14px;padding:14px 16px;background:linear-gradient(135deg,#fffbe6,#fff3b0);border:2px solid #f0c000;border-radius:14px;text-align:center;">
        <div style="font-size:22px;margin-bottom:6px;">🏆</div>
        <div style="font-family:var(--font-h);font-size:16px;color:#8a6000;margin-bottom:4px;">진엔딩 달성!</div>
        <div style="font-size:12px;color:#a07020;">이야기의 진짜 결말을 찾았어요!</div>
      </div>`;
    } else {
      html += `<div style="margin-top:14px;padding:12px 16px;background:#f3eeff;border:1.5px solid #c090f0;border-radius:14px;text-align:center;">
        <div style="font-size:18px;margin-bottom:6px;">🏁</div>
        <div style="font-family:var(--font-h);font-size:14px;color:#7030b0;margin-bottom:6px;">엔딩 도달!</div>
        ${otherCount > 0 ? `<div style="font-size:12px;color:#9050c0;">다른 루트가 <b>${otherCount}개</b> 더 있어요.</div>` : ''}
        ${trueEndIdx !== -1 && !isThisTrueEnd ? `<div style="margin-top:8px;font-size:11px;color:#a060d0;background:#ede0ff;padding:5px 10px;border-radius:8px;">💡 아직 진엔딩을 못 찾았어요!</div>` : ''}
      </div>`;
    }

    if (endingCount > 1) {
      html += `<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">`;
      routes.forEach((r, i) => {
        if (i === idx) return;
        const rLast = r[r.length-1].scene;
        if (rLast?.type !== 'ending') return;
        html += `<button class="js-route-tab" data-route-idx="${i}"
          style="padding:6px 14px;border-radius:50px;font-family:var(--font-h);font-size:12px;cursor:pointer;
          border:2px solid ${rLast.trueEnding?'#f0c000':'#9b4dca'};background:#fff;color:${rLast.trueEnding?'#8a6000':'#7030b0'};">
          ${rLast.trueEnding ? '⭐' : '🔀'} ${i+1}번 루트 탐색
        </button>`;
      });
      html += `</div>`;
      /* ★ 이벤트 바인딩은 DOMContentLoaded의 route-content 위임으로 처리 — setTimeout 없음 */
    }
  }

  /* content.innerHTML 설정을 이벤트 바인딩보다 먼저 — 동기적으로 DOM 확정 */
  content.innerHTML = html;
}

/* ── 탭 이벤트 위임 — 모듈 로드 시 단 1회만 등록
   renderRouteTabs()는 tabs.innerHTML을 교체하므로 내부에 등록하면 호출마다 누적됨.
   tabs / route-content 요소 자체는 DOM에서 교체되지 않으므로 여기서 1회 등록이 안전.
   showRoute(idx) — routesArg 없이 호출 시 내부에서 findAllRoutes() 재실행. ── */
window.addEventListener('DOMContentLoaded', () => {
  /* route-tabs: 상단 루트 선택 탭 */
  const tabs = document.getElementById('route-tabs');
  if (tabs) {
    tabs.addEventListener('click', e => {
      const btn = e.target.closest('.js-route-tab');
      if (btn) showRoute(Number(btn.dataset.routeIdx));
    });
  }

  /* route-content: 엔딩 도달 후 "다른 루트 탐색" 버튼
     innerHTML이 showRoute() 호출마다 교체되지만 container는 유지되므로 위임 안전 */
  const content = document.getElementById('route-content');
  if (content) {
    content.addEventListener('click', e => {
      const btn = e.target.closest('.js-route-tab');
      if (btn) showRoute(Number(btn.dataset.routeIdx));
    });
  }
});
