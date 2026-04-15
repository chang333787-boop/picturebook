/* ================================================================
   adminConsole.js — 교사 운영 대시보드
   의존: firebase.js (db, auth, authState, DATA_PATH_VERSION), state.js

   ─────────────────────────────────────────────────────────────────
   ★ 보안 구조 현황

   【완료】
   [1] admin/pw 자동 등록 로직 → 제거됨
   [2] admin/pw fallback 모달 → 제거됨 (이번 단계)
       구형: checkAdminPw() / openAdmin() / _enterAdmin() 전부 제거
       이제 admin 진입 경로는 Firebase Auth 단일 경로만 남음

   【임시 유지】
   [3] adminState.verified — UI 게이트. 실질 보안은 Firebase Rules에 의존.

   【다음 단계에서 가능】
   - admin/pw .read: false (Rules 업데이트)
   - admin/* 완전 차단
   ─────────────────────────────────────────────────────────────────
   ================================================================ */

/* ── 관리자 세션 상태 ── */
const adminState = {
  verified:    false,
  allTeams:    [],      // 로드된 팀 데이터 배열
  filter:      'all',   // 'all'|'not-started'|'in-progress'|'ready'|'needs-attention'
  sort:        'name',  // 'name'|'scenes'|'status'
  adminClassId: null,   // v2에서 교사가 현재 보는 classId (v1에서는 null)
};

/* ================================================================
   이벤트 위임 — DOMContentLoaded 1회 등록
   ================================================================ */
window.addEventListener('DOMContentLoaded', () => {
  const list = document.getElementById('admin-team-list');
  if (!list) return;

  list.addEventListener('click', e => {
    if (!adminState.verified) return;

    const makerBtn  = e.target.closest('.js-admin-maker');
    const viewerBtn = e.target.closest('.js-admin-viewer');
    const detailBtn = e.target.closest('.js-admin-detail');
    const deleteBtn = e.target.closest('.js-admin-delete');
    const moreBtn   = e.target.closest('.js-admin-more');

    if (makerBtn)  _openMaker(makerBtn.dataset.name);
    if (viewerBtn) _openViewer(viewerBtn.dataset.name);
    if (detailBtn) _toggleDetail(detailBtn.dataset.encoded);
    if (deleteBtn) _deleteTeam(deleteBtn.dataset.encoded, deleteBtn.dataset.name);
    if (moreBtn)   _toggleMoreMenu(moreBtn);
  });
});

/* ================================================================
   인증
   ─────────────────────────────────────────────────────────────────
   admin 진입은 Firebase Auth 단일 경로만 남음:
     teacher-auth.html → 로그인 → maker.html?admin=1
     → ui.js onAuthStateChanged → role 확인 → _enterAdminDirect()

   구형 fallback 제거됨:
     openAdmin() / checkAdminPw() / _enterAdmin() — 삭제
     admin-pw-modal DOM — maker.html에서 삭제
   ================================================================ */

/* Firebase Auth 인증 완료 후 admin 패널 직접 진입
   ⚠️ adminState.verified는 UI 게이트. 실질 보안은 Firebase Rules에 의존. */
function _enterAdminDirect() {
  adminState.verified = true;
  document.getElementById('admin-panel').style.display = 'flex';
  loadAdminData();
}

function closeAdmin() {
  adminState.verified     = false;
  adminState.adminClassId = null;
  document.getElementById('admin-panel').style.display = 'none';
}

/* ================================================================
   Step 4 + 5: teacher uid → classId lookup
   ─────────────────────────────────────────────────────────────────
   【이전 구조】
     classes/ 루트 전체를 orderByChild('meta/teacherUid')로 스캔
     → Rules에서 classes/.read: true 필요 (너무 넓음)
     → .indexOn 없으면 경고

   【새 구조】
     teacherClasses/$uid = $classId  (전용 인덱스 노드)
     → teacherClasses/$uid 단일 경로만 읽음
     → Rules에서 "auth.uid === $uid" 조건으로 본인 경로만 허용 가능
     → classes/ 루트 전체 접근 불필요

   인덱스 없음(null):
     classes/ fallback 없이 명확히 실패.
     교사 계정 생성 시 teacherClasses/$uid 노드를 동시에 써야 유효.
     "교사 1명 = 1개 class" 전제로 단일 classId 반환.
   ================================================================ */
async function _resolveTeacherClassId() {
  const user = getCurrentUser();
  if (!user) return null;

  const snap = await db.ref(`teacherClasses/${user.uid}`).once('value');
  if (!snap.exists()) return null;
  return snap.val();   // teacherClasses/$uid = classId (문자열)
}

/* ================================================================
   팀 데이터 로드
   ─────────────────────────────────────────────────────────────────
   v1: teams/ 전역 기준 (기존 동작 유지)
   v2 + teacher Auth:
     1. _resolveTeacherClassId()로 classId 확보
     2. classes/$classId/teams/ 기준으로만 로드
     3. classId 확보 실패 시 에러 표시 (전체 teams/ 열지 않음)
   ================================================================ */
function loadAdminData() {
  if (!adminState.verified) return;

  if (DATA_PATH_VERSION === 'v2') {
    _loadAdminDataV2();
  } else {
    _loadAdminDataV1();
  }
}

/* ── v1: 기존 teams/ 전역 기준 ── */
function _loadAdminDataV1() {
  const list = document.getElementById('admin-team-list');
  list.innerHTML = '<div class="admin-loading">불러오는 중...</div>';

  db.ref('teams').once('value').then(snapshot => {
    const raw = snapshot.val();
    if (!raw) {
      list.innerHTML = '<div class="admin-empty">등록된 모둠이 없어요.</div>';
      _renderSummaryBar([]);
      _renderFilterBar([]);
      return;
    }
    adminState.allTeams = Object.entries(raw).map(([encodedName, teamData]) => {
      const scenes = Object.values(teamData.scenes || {});
      return _analyzeTeam(encodedName, scenes);
    });
    _renderSummaryBar(adminState.allTeams);
    _renderFilterBar(adminState.allTeams);
    _renderTeamList();
  }).catch(err => {
    list.innerHTML = `<div class="admin-error">오류: ${err.message}</div>`;
  });
}

/* ── v2: classes/$classId/teams/ 기준 ── */
async function _loadAdminDataV2() {
  const list = document.getElementById('admin-team-list');
  list.innerHTML = '<div class="admin-loading">클래스 정보를 확인하는 중...</div>';

  /* classId 확보 */
  const resolvedClassId = await _resolveTeacherClassId();
  if (!resolvedClassId) {
    list.innerHTML = `<div class="admin-error">
      ⚠️ 이 계정에 연결된 클래스를 찾을 수 없어요.<br>
      Firebase Console에서 classes/$classId/meta/teacherUid 를 설정해주세요.
    </div>`;
    _renderSummaryBar([]);
    _renderFilterBar([]);
    return;
  }

  /* adminState에 보관 — _openMaker/_openViewer에서 재사용 */
  adminState.adminClassId = resolvedClassId;

  list.innerHTML = '<div class="admin-loading">팀 목록을 불러오는 중...</div>';

  db.ref(`classes/${resolvedClassId}/teams`).once('value').then(snapshot => {
    const raw = snapshot.val();
    if (!raw) {
      list.innerHTML = '<div class="admin-empty">이 클래스에 등록된 모둠이 없어요.</div>';
      _renderSummaryBar([]);
      _renderFilterBar([]);
      return;
    }
    adminState.allTeams = Object.entries(raw).map(([encodedName, teamData]) => {
      const scenes = Object.values(teamData.scenes || {});
      return _analyzeTeam(encodedName, scenes);
    });
    _renderSummaryBar(adminState.allTeams);
    _renderFilterBar(adminState.allTeams);
    _renderTeamList();
  }).catch(err => {
    list.innerHTML = `<div class="admin-error">오류: ${err.message}</div>`;
  });
}

/* ================================================================
   팀 상태 분석 — pure function (변경 없음)
   ================================================================ */
function _analyzeTeam(encodedName, scenes) {
  const name     = decodeURIComponent(encodedName);
  const total    = scenes.length;
  const starts   = scenes.filter(s => s.type === 'start').length;
  const endings  = scenes.filter(s => s.type === 'ending').length;
  const normals  = scenes.filter(s => s.type === 'normal').length;
  const trueEnds = scenes.filter(s => s.type === 'ending' && s.trueEnding).length;
  const hasImage = scenes.some(s => s.imageData);

  const nonEndingScenes = scenes.filter(s => s.type !== 'ending');
  const connected       = nonEndingScenes.filter(s => s.nextA || s.nextB).length;
  const connectivity    = nonEndingScenes.length
    ? Math.round(connected / nonEndingScenes.length * 100) : 0;

  const noTitle = scenes.filter(s => !s.title?.trim()).length;

  const allNextIds = new Set(scenes.flatMap(s => [s.nextA, s.nextB].filter(Boolean).map(String)));
  const isolated   = scenes.filter(s =>
    s.type !== 'start' && !allNextIds.has(String(s.num))
  ).length;

  const status         = _classifyStatus({ total, starts, endings, connectivity, isolated });
  const interpretation = _makeInterpretation(status, { total, starts, endings, connectivity, noTitle, isolated });
  const problems       = _listProblems({ starts, endings, connectivity, noTitle, isolated, total });

  return {
    encodedName, name, total, starts, endings, normals, trueEnds,
    hasImage, connectivity, noTitle, isolated, status, interpretation, problems,
  };
}

function _classifyStatus({ total, starts, endings, connectivity, isolated }) {
  if (total === 0) return 'not-started';
  if (starts === 0 || endings === 0 || connectivity < 50 || isolated > 3)
    return 'needs-attention';
  if (starts >= 1 && endings >= 1 && connectivity >= 70)
    return 'ready';
  return 'in-progress';
}

const STATUS_META = {
  'not-started':     { label: '미시작',    color: '#8394ad', bg: '#f0f4ff', icon: '⬜' },
  'in-progress':     { label: '작업 중',   color: '#f0a000', bg: '#fff8e6', icon: '🟡' },
  'ready':           { label: '감상 가능', color: '#1a6b4a', bg: '#e8faf2', icon: '🟢' },
  'needs-attention': { label: '확인 필요', color: '#c00',    bg: '#fff0f0', icon: '🔴' },
};

function _makeInterpretation(status, { total, starts, endings, connectivity, noTitle, isolated }) {
  if (status === 'not-started') return '아직 작품 제작을 시작하지 않았어요.';
  if (status === 'needs-attention') {
    if (starts === 0) return '시작 장면이 없어 작품을 열기 어려워요.';
    if (endings === 0) return '엔딩 장면이 없어 이야기가 완성되지 않았어요.';
    if (isolated > 3) return '연결이 끊긴 장면이 많아요. 흐름 점검이 필요해요.';
    return '구조에 문제가 있어 교사 확인이 필요해요.';
  }
  if (status === 'ready') {
    if (endings >= 2) return `기본 구조가 완성됐고 결말이 ${endings}개예요. 감상 테스트가 가능해요.`;
    return '기본 구조가 완성되어 감상 테스트가 가능해요.';
  }
  if (connectivity < 70) return `장면 ${total}개 중 일부가 아직 연결되지 않았어요.`;
  if (noTitle > 2) return `내용 없는 장면이 ${noTitle}개 있어요. 내용을 채워보세요.`;
  return '이야기를 만들고 있는 중이에요.';
}

function _listProblems({ starts, endings, connectivity, noTitle, isolated, total }) {
  const problems = [];
  if (total === 0) return problems;
  if (starts === 0)       problems.push({ icon: '⚠️', text: '시작 장면이 없어요' });
  if (endings === 0)      problems.push({ icon: '⚠️', text: '엔딩 장면이 없어요' });
  if (connectivity < 70 && total > 1) problems.push({ icon: '🔗', text: `연결 완성도 ${connectivity}%` });
  if (isolated > 0)       problems.push({ icon: '🔴', text: `고립 장면 ${isolated}개` });
  if (noTitle > 0)        problems.push({ icon: '📝', text: `내용 없는 장면 ${noTitle}개` });
  return problems;
}

/* ================================================================
   운영 요약 바 (변경 없음)
   ================================================================ */
function _renderSummaryBar(teams) {
  const bar = document.getElementById('admin-summary-bar');
  if (!bar) return;

  const counts = {
    total:             teams.length,
    'not-started':     teams.filter(t => t.status === 'not-started').length,
    'in-progress':     teams.filter(t => t.status === 'in-progress').length,
    'ready':           teams.filter(t => t.status === 'ready').length,
    'needs-attention': teams.filter(t => t.status === 'needs-attention').length,
  };

  bar.innerHTML = `
    <div class="admin-summary-item admin-summary-total">
      <span class="admin-summary-num">${counts.total}</span>
      <span class="admin-summary-label">전체 팀</span>
    </div>
    ${['not-started','in-progress','ready','needs-attention'].map(s => `
      <div class="admin-summary-item" style="--sc:${STATUS_META[s].color}">
        <span class="admin-summary-dot">${STATUS_META[s].icon}</span>
        <span class="admin-summary-num" style="color:${STATUS_META[s].color}">${counts[s]}</span>
        <span class="admin-summary-label">${STATUS_META[s].label}</span>
      </div>`).join('')}`;
}

/* ================================================================
   필터 + 정렬 바 (변경 없음)
   ================================================================ */
function _renderFilterBar(teams) {
  const bar = document.getElementById('admin-filter-bar');
  if (!bar) return;

  const filters = [
    { key: 'all',             label: '전체' },
    { key: 'needs-attention', label: '확인 필요' },
    { key: 'in-progress',     label: '작업 중' },
    { key: 'ready',           label: '감상 가능' },
    { key: 'not-started',     label: '미시작' },
  ];
  const sorts = [
    { key: 'name',   label: '이름순' },
    { key: 'scenes', label: '장면 수' },
    { key: 'status', label: '문제 우선' },
  ];

  bar.innerHTML = `
    <div class="admin-filters">
      ${filters.map(f => `
        <button class="admin-filter-btn ${adminState.filter === f.key ? 'active' : ''}"
          data-filter="${f.key}">${f.label}</button>`).join('')}
    </div>
    <div class="admin-sorts">
      <span class="admin-sort-label">정렬:</span>
      ${sorts.map(s => `
        <button class="admin-sort-btn ${adminState.sort === s.key ? 'active' : ''}"
          data-sort="${s.key}">${s.label}</button>`).join('')}
    </div>`;

  bar.querySelectorAll('.admin-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      adminState.filter = btn.dataset.filter;
      _renderFilterBar(adminState.allTeams);
      _renderTeamList();
    });
  });

  bar.querySelectorAll('.admin-sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      adminState.sort = btn.dataset.sort;
      _renderFilterBar(adminState.allTeams);
      _renderTeamList();
    });
  });
}

/* ================================================================
   팀 카드 리스트 렌더 (변경 없음)
   ================================================================ */
function _renderTeamList() {
  const list = document.getElementById('admin-team-list');
  if (!list) return;

  let teams = adminState.filter === 'all'
    ? [...adminState.allTeams]
    : adminState.allTeams.filter(t => t.status === adminState.filter);

  const ORDER = { 'needs-attention': 0, 'in-progress': 1, 'not-started': 2, 'ready': 3 };
  if (adminState.sort === 'name')
    teams.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  else if (adminState.sort === 'scenes')
    teams.sort((a, b) => b.total - a.total);
  else if (adminState.sort === 'status')
    teams.sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9));

  if (!teams.length) {
    list.innerHTML = '<div class="admin-empty">해당 상태의 모둠이 없어요.</div>';
    return;
  }

  list.innerHTML = '';
  teams.forEach(team => {
    const card = document.createElement('div');
    card.className = 'admin-team-card';
    card.dataset.status = team.status;
    card.innerHTML = _teamCardHtml(team);
    list.appendChild(card);
  });
}

function _teamCardHtml(t) {
  const meta    = STATUS_META[t.status];
  const canView = t.status === 'ready';

  const badges = [];
  if (t.trueEnds > 0) badges.push('<span class="admin-badge admin-badge--true">⭐ 진엔딩</span>');
  if (t.hasImage)     badges.push('<span class="admin-badge admin-badge--img">🖼 이미지</span>');
  if (t.status === 'in-progress' && t.total > 0)
    badges.push(`<span class="admin-badge admin-badge--conn">연결 ${t.connectivity}%</span>`);

  const problemsHtml = t.problems.length
    ? `<div class="admin-problems">${t.problems.map(p =>
        `<span class="admin-problem">${p.icon} ${p.text}</span>`).join('')}</div>`
    : '';

  const makerBtn  = `<button class="admin-action-btn admin-action-btn--maker js-admin-maker" data-name="${t.name}" title="Maker로 열기">🛠 수정</button>`;
  const viewerBtn = canView
    ? `<button class="admin-action-btn admin-action-btn--viewer js-admin-viewer" data-name="${t.name}" title="Viewer로 보기">▶ 감상</button>`
    : `<button class="admin-action-btn admin-action-btn--viewer admin-action-btn--disabled" disabled title="감상 가능 상태가 아니에요">▶ 감상</button>`;
  const detailBtn = `<button class="admin-action-btn admin-action-btn--detail js-admin-detail" data-encoded="${t.encodedName}" title="상세 보기">상세</button>`;
  const moreBtn   = `<button class="admin-action-btn admin-action-btn--more js-admin-more" title="더 보기">⋯</button>
    <div class="admin-more-menu" style="display:none;">
      <button class="admin-more-item js-admin-delete" data-encoded="${t.encodedName}" data-name="${t.name}">🗑 팀 삭제</button>
    </div>`;

  return `
    <div class="admin-card-head">
      <div class="admin-card-identity">
        <span class="admin-card-name">👥 ${t.name}</span>
        <span class="admin-status-badge" style="background:${meta.bg};color:${meta.color};">
          ${meta.icon} ${meta.label}
        </span>
        ${badges.join('')}
      </div>
      <div class="admin-card-actions">
        ${makerBtn}${viewerBtn}${detailBtn}
        <div class="admin-more-wrap">${moreBtn}</div>
      </div>
    </div>

    <div class="admin-card-body">
      <div class="admin-card-stats">
        ${t.total > 0
          ? `장면 ${t.total}개 · 시작 ${t.starts} · 일반 ${t.normals} · 엔딩 ${t.endings}`
          : '장면 없음'}
      </div>
      <p class="admin-card-interp">${t.interpretation}</p>
      ${problemsHtml}
    </div>

    <div class="admin-team-detail" id="detail-${t.encodedName}" style="display:none;"></div>`;
}

/* ================================================================
   액션 함수
   ─────────────────────────────────────────────────────────────────
   v1: classId 없이 팀명만 전달 (기존 동작)
   v2: adminState.adminClassId를 함께 전달
       — maker: ?team=...&classId=...
       — viewer: ?team=...&classId=...&from=maker
   ================================================================ */
function _openMaker(teamName) {
  const cid = adminState.adminClassId
    ? `&classId=${encodeURIComponent(adminState.adminClassId)}` : '';
  window.open(`maker.html?team=${encodeURIComponent(teamName)}${cid}`, '_blank');
}

function _openViewer(teamName) {
  const cid = adminState.adminClassId
    ? `&classId=${encodeURIComponent(adminState.adminClassId)}` : '';
  window.open(`viewer.html?team=${encodeURIComponent(teamName)}${cid}&from=maker`, '_blank');
}

function _toggleMoreMenu(btn) {
  const wrap = btn.closest('.admin-more-wrap');
  const menu = wrap?.querySelector('.admin-more-menu');
  if (!menu) return;
  const isOpen = menu.style.display !== 'none';
  document.querySelectorAll('.admin-more-menu').forEach(m => { m.style.display = 'none'; });
  menu.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    const close = () => { menu.style.display = 'none'; document.removeEventListener('click', close); };
    setTimeout(() => document.addEventListener('click', close), 0);
  }
}

/* ================================================================
   팀 상세 — 경로도 v1/v2 분기
   ================================================================ */
function _toggleDetail(encodedName) {
  if (!adminState.verified) return;
  const detail = document.getElementById('detail-' + encodedName);
  if (!detail) return;
  if (detail.style.display !== 'none') { detail.style.display = 'none'; return; }

  detail.innerHTML = '<div class="admin-loading" style="padding:8px 0;">장면 불러오는 중...</div>';
  detail.style.display = 'block';

  /* 상세 조회 경로: v1 = teams/$name/scenes, v2 = classes/$cid/teams/$name/scenes */
  const scenesPath = (DATA_PATH_VERSION === 'v2' && adminState.adminClassId)
    ? `classes/${adminState.adminClassId}/teams/${encodedName}/scenes`
    : `teams/${encodedName}/scenes`;

  db.ref(scenesPath).once('value').then(snap => {
    const raw  = snap.val() || {};
    const arr  = Object.values(raw).sort((a, b) => a.num - b.num);
    const team = adminState.allTeams.find(t => t.encodedName === encodedName);

    const problemsHtml = (team?.problems.length)
      ? `<div class="admin-detail-section">
           <div class="admin-detail-label">⚠️ 확인이 필요한 점</div>
           <div class="admin-detail-problems">
             ${team.problems.map(p => `<span class="admin-problem">${p.icon} ${p.text}</span>`).join('')}
           </div>
         </div>`
      : `<div class="admin-detail-section">
           <div class="admin-detail-label" style="color:#1a6b4a;">✅ 구조 이상 없음</div>
         </div>`;

    const sceneChips = arr.length
      ? `<div class="admin-detail-section">
           <div class="admin-detail-label">장면 목록 (${arr.length}개)</div>
           <div class="admin-scene-chips">
             ${arr.map(s => {
               const color = s.type==='start'?'#06d6a0':s.type==='ending'?'#ef476f':'#4a90d9';
               const nexts = [s.nextA && `A→${s.nextA}`, s.nextB && `B→${s.nextB}`].filter(Boolean);
               return `<div class="admin-scene-chip" style="border-color:${color};">
                 <span class="chip-type" style="color:${color};">${
                   s.type==='start'?'시작':s.type==='ending'?'엔딩':'일반'} ${s.num}</span>
                 <span class="chip-title">${s.title ? s.title.slice(0,18) : '(내용 없음)'}</span>
                 ${nexts.length ? `<span class="chip-next">${nexts.join(' ')}</span>` : ''}
               </div>`;
             }).join('')}
           </div>
         </div>`
      : `<div class="admin-detail-section"><span style="color:var(--muted);font-size:12px;">장면 없음</span></div>`;

    detail.innerHTML = `<div class="admin-detail-inner">${problemsHtml}${sceneChips}</div>`;
  }).catch(err => {
    detail.innerHTML = `<div class="admin-error" style="padding:8px 0;">오류: ${err.message}</div>`;
  });
}

/* ================================================================
   팀 삭제 — 경로도 v1/v2 분기
   ================================================================ */
function _deleteTeam(encodedName, displayName) {
  if (!adminState.verified) return;
  if (!confirm(`"${displayName}" 모둠의 모든 데이터를 삭제할까요?\n이 작업은 되돌릴 수 없어요!`)) return;

  const teamPath = (DATA_PATH_VERSION === 'v2' && adminState.adminClassId)
    ? `classes/${adminState.adminClassId}/teams/${encodedName}`
    : `teams/${encodedName}`;

  db.ref(teamPath).remove()
    .then(() => {
      alert(`✅ "${displayName}" 모둠 데이터가 삭제됐어요.`);
      adminState.allTeams = adminState.allTeams.filter(t => t.encodedName !== encodedName);
      _renderSummaryBar(adminState.allTeams);
      _renderFilterBar(adminState.allTeams);
      _renderTeamList();
    })
    .catch(err => alert('❌ 삭제 실패: ' + err.message));
}
