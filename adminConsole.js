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
  /* 2026-05-29 admin 2차: 모드별 필터 — 상태 필터와 함께 박힘.
     'all' = 전체 모드 / 'unset' = projectType 박지 X 박은 팀 / 그 외 = 4 화이트리스트 */
  modeFilter:  'all',   // 'all'|'unset'|'picturebook'|'text'|'movie'|'experience'
  adminClassId: null,   // v2에서 교사가 현재 보는 classId (v1에서는 null)
  /* 2026-06 admin 1차 최적화: 팀 목록 60초 단기 인메모리 캐시.
     admin 재진입(교사가 팀 maker↔admin 왕복) 시 클래스 전체 teams+scenes 재읽기를 줄임.
     localStorage/sessionStorage 미사용 — 모듈 메모리만(F5하면 자연 초기화).
     무효화 = _invalidateAdminCache(): 삭제/공개토글/새로고침/닫기 시. */
  allTeamsLoadedAt: 0,  // 마지막 성공 로드 시각(ms). 0 = 캐시 무효
  cachedClassId:    null, // 캐시된 목록이 속한 classId (다르면 캐시 무시)
};

/* 캐시 TTL (ms) — 60초. 읽기전용 요약(장면 수/연결률)이라 짧은 staleness 허용. */
const ADMIN_CACHE_TTL_MS = 60000;

/* admin 목록 캐시 무효화 — 다음 loadAdminData 진입 시 강제 재읽기. */
function _invalidateAdminCache(reason) {
  adminState.allTeamsLoadedAt = 0;
  adminState.cachedClassId    = null;
}

/* ================================================================
   이벤트 위임 — DOMContentLoaded 1회 등록
   ================================================================ */
window.addEventListener('DOMContentLoaded', () => {
  const list = document.getElementById('admin-team-list');
  if (!list) return;

  list.addEventListener('click', e => {
    if (!adminState.verified) return;

    const makerBtn    = e.target.closest('.js-admin-maker');
    const viewerBtn   = e.target.closest('.js-admin-viewer');
    const detailBtn   = e.target.closest('.js-admin-detail');
    const deleteBtn   = e.target.closest('.js-admin-delete');
    const moreBtn     = e.target.closest('.js-admin-more');
    const publicBtn   = e.target.closest('.js-admin-toggle-public');
    const issueBtn    = e.target.closest('.js-admin-issue-code');
    const pinBtn      = e.target.closest('.js-admin-pin');     // ADMIN-1D: 등록 팀 PIN 변경
    const lockBtn     = e.target.closest('.js-admin-lock');    // ADMIN-1D: 등록 팀 잠금/해제
    const regBtn      = e.target.closest('.js-admin-register'); // ADMIN-1E: 기존 팀 관리팀 등록

    if (makerBtn)  _openMaker(makerBtn.dataset.name);
    if (viewerBtn) _openViewer(viewerBtn.dataset.name);
    if (detailBtn) _toggleDetail(detailBtn.dataset.encoded);
    if (deleteBtn) _deleteTeam(deleteBtn.dataset.encoded, deleteBtn.dataset.name);
    if (moreBtn)   _toggleMoreMenu(moreBtn);
    if (publicBtn) _toggleIsPublic(publicBtn.dataset.encoded, publicBtn.dataset.name, publicBtn.dataset.public === 'true');
    if (issueBtn)  _issueCopyCodeFlow(issueBtn.dataset.encoded, issueBtn.dataset.name);
    if (pinBtn)    _changeTeamPin(pinBtn.dataset.encoded, pinBtn.dataset.name);
    if (lockBtn)   _toggleTeamLock(lockBtn.dataset.encoded, lockBtn.dataset.name, lockBtn.dataset.status);
    if (regBtn)    _registerExistingTeam(regBtn.dataset.encoded, regBtn.dataset.name);
  });

  /* 2026-06: 수동 새로고침 — 캐시 무효화 후 강제 재읽기. summary bar는 정적 요소라
     innerHTML이 바뀌어도 이 위임 리스너는 유지됨. */
  const summaryBar = document.getElementById('admin-summary-bar');
  if (summaryBar) {
    summaryBar.addEventListener('click', e => {
      if (!e.target.closest('.js-admin-refresh')) return;
      if (!adminState.verified) return;
      _invalidateAdminCache('manual-refresh');
      loadAdminData();
    });
  }
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
  _invalidateAdminCache('close-admin');   // classId 변경/로그아웃 대비 — 다음 진입 시 새로 읽음
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
      list.innerHTML = '<div class="admin-empty">등록된 팀이 없어요.</div>';
      _renderSummaryBar([]);
      _renderFilterBar([]);
      return;
    }
    adminState.allTeams = Object.entries(raw).map(([encodedName, teamData]) => {
      const scenes   = Object.values(teamData.scenes || {});
      const isPublic = teamData['viewer-meta']?.isPublic === true;
      const meta     = teamData['viewer-meta'] || {};
      return _analyzeTeam(encodedName, scenes, isPublic, meta);
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

  /* 2026-06 캐시 hit: 같은 classId를 60초 이내에 이미 성공 로드했으면
     클래스 전체 teams+scenes 재읽기를 생략하고 메모리 목록으로만 재렌더.
     class bar/team-list DOM은 closeAdmin이 display:none만 하므로 유지됨 → classBar 재읽기도 생략. */
  if (adminState.cachedClassId === resolvedClassId
      && adminState.allTeams.length > 0
      && (Date.now() - adminState.allTeamsLoadedAt) < ADMIN_CACHE_TTL_MS) {
    _renderSummaryBar(adminState.allTeams);
    _renderFilterBar(adminState.allTeams);
    _renderTeamList();
    return;
  }

  /* v94: 클래스 메타 조회 후 헤더 바 박음 (반 이름 + 코드 + 복사 버튼) */
  _renderClassBar(resolvedClassId);
  /* Phase 1: 학급 AI 설정 패널 */
  _renderAiSettingsPanel(resolvedClassId);
  /* ADMIN-1C: 학생 팀 생성 방식 설정 패널 (계정 생성 카드 위) */
  _renderTeamModePanel(resolvedClassId);
  /* ADMIN-1B: 교사 팀/학생 계정 사전 생성 패널 */
  _renderTeamCreatePanel(resolvedClassId);

  list.innerHTML = '<div class="admin-loading">팀 목록을 불러오는 중...</div>';

  db.ref(`classes/${resolvedClassId}/teams`).once('value').then(snapshot => {
    const raw = snapshot.val();
    if (!raw) {
      /* v94: 빈 상태 — 학생 안내 (코드 + 접속 URL) */
      _renderEmptyGuide();
      _renderSummaryBar([]);
      _renderFilterBar([]);
      return;
    }
    adminState.allTeams = Object.entries(raw).map(([encodedName, teamData]) => {
      const scenes   = Object.values(teamData.scenes || {});
      const isPublic = teamData['viewer-meta']?.isPublic === true;
      const meta     = teamData['viewer-meta'] || {};
      const account  = teamData.account || null;   // ADMIN-1B: 교사 사전 등록 메타
      return _analyzeTeam(encodedName, scenes, isPublic, meta, account);
    });
    /* 2026-06 캐시 기록 — 성공 로드 시각/대상 classId. 다음 60초간 재진입 시 재읽기 생략. */
    adminState.allTeamsLoadedAt = Date.now();
    adminState.cachedClassId    = resolvedClassId;
    _renderSummaryBar(adminState.allTeams);
    _renderFilterBar(adminState.allTeams);
    _renderTeamList();
  }).catch(err => {
    list.innerHTML = `<div class="admin-error">오류: ${err.message}</div>`;
  });
}

/* v94: 클래스 정보 바 — 반 이름 + 코드 + 복사 버튼 */
async function _renderClassBar(classId) {
  const bar = document.getElementById('admin-class-bar');
  if (!bar) return;
  let meta = {};
  try {
    const snap = await db.ref(`classes/${classId}/meta`).once('value');
    meta = snap.val() || {};
  } catch (e) { /* meta 없으면 빈 객체 */ }
  /* v94 meta(v92)이 새 형식. 옛 클래스(class_2026_junglim_1)는 meta 다를 수 있음. */
  const code = meta.code || meta.classCode || '';
  const name = meta.name || meta.className || '';
  if (!code && !name) {
    bar.style.display = 'none';
    return;
  }
  adminState.adminClassCode = code;
  adminState.adminClassName = name;
  bar.style.display = 'flex';
  bar.innerHTML = `
    ${name ? `<div class="admin-class-name">📚 ${_escHtml(name)}</div>` : ''}
    ${code ? `
      <div class="admin-class-code-wrap">
        <span class="admin-class-code-label">학생 입력 코드</span>
        <span class="admin-class-code">${_escHtml(code)}</span>
        <button class="admin-class-code-copy" id="btn-copy-class-code">📋 복사</button>
      </div>` : ''}
  `;
  /* 복사 버튼 */
  const copyBtn = document.getElementById('btn-copy-class-code');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code);
        copyBtn.textContent = '✓ 복사됨';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = '📋 복사';
          copyBtn.classList.remove('copied');
        }, 1800);
      } catch (e) {
        alert('복사 실패. 직접 적어주세요: ' + code);
      }
    });
  }
}

/* ════════════════════════════════════════════════════════════════
   Phase 1: 학급 AI 설정 패널 — classes/{classId}/aiSettings
   ──────────────────────────────────────────────────────────────
   · 교사가 학급 단위로 AI 전체 ON/OFF + 기능별 ON/OFF 제어.
   · aiSettings 노드가 없으면 UI는 OFF로 보이되, 저장 전에는 서버 fallback(aiPermission/기본 ON) 유지.
   · 교사가 처음 저장하면 노드 생성 → 그때부터 서버가 aiSettings 우선 적용.
   · 이미지 1/2단계는 노출만(준비 중) — 저장 구조엔 포함하되 카드 구현은 안 함.
   ════════════════════════════════════════════════════════════════ */
const AI_MODE_DEFS = [
  { key: 'textS1',   label: '텍스트 1단계 (문장 정돈)', soon: false },
  { key: 'textS2',   label: '텍스트 2단계 (장면 발전)', soon: false },
  { key: 'workCheck',label: '작품 검사',               soon: false },
  { key: 'imageS1',  label: '그림 1단계 (정돈)',        soon: true  },
  { key: 'imageS2',  label: '그림 2단계 (발전)',        soon: true  },
];

async function _renderAiSettingsPanel(classId) {
  const panel = document.getElementById('admin-ai-settings');
  if (!panel || !classId) return;

  /* 현재 저장값 로드 — 없으면 OFF 기본값 */
  let saved = null;
  try {
    const snap = await db.ref(`classes/${classId}/aiSettings`).once('value');
    saved = snap.val();
  } catch (e) { /* 읽기 실패 시 기본값 */ }

  const exists = !!saved;
  const state = {
    enabled: exists ? saved.enabled === true : false,
    modes: {
      textS1:   exists ? !!(saved.modes && saved.modes.textS1)   : false,
      textS2:   exists ? !!(saved.modes && saved.modes.textS2)   : false,
      workCheck:exists ? !!(saved.modes && saved.modes.workCheck): false,
      imageS1:  exists ? !!(saved.modes && saved.modes.imageS1)  : false,
      imageS2:  exists ? !!(saved.modes && saved.modes.imageS2)  : false,
    },
    policy: {
      requireCompletion:  (exists && saved.policy && saved.policy.requireCompletion  === false) ? false : true,
      requireSafetyCheck: (exists && saved.policy && saved.policy.requireSafetyCheck === false) ? false : true,
      allowViewerToggle:  (exists && saved.policy && saved.policy.allowViewerToggle  === false) ? false : true,
    },
  };

  panel.style.display = 'flex';
  _drawAiSettingsPanel(panel, classId, state, exists);
}

function _drawAiSettingsPanel(panel, classId, state, exists) {
  const statusCls = state.enabled ? 'on' : 'off';
  const statusTxt = state.enabled ? 'AI 켜짐' : 'AI 꺼짐';
  const notSavedNote = exists ? '' : ' · 아직 저장된 적 없음(기본 동작 유지 중)';

  const modeToggles = AI_MODE_DEFS.map(d => {
    const checked = state.modes[d.key] ? 'checked' : '';
    const dis = d.soon ? ' is-disabled' : '';
    const disAttr = d.soon ? 'disabled' : '';
    const soonTag = d.soon ? '<span class="admin-ai-soon">준비 중</span>' : '';
    return `<label class="admin-ai-toggle${dis}" data-mode-toggle="${d.key}">
      <input type="checkbox" ${checked} ${disAttr} data-ai-mode="${d.key}">
      ${_escHtml(d.label)}${soonTag}
    </label>`;
  }).join('');

  panel.innerHTML = `
    <div class="admin-ai-head">
      <div class="admin-ai-title">🤖 학급 AI 설정</div>
      <span class="admin-ai-status ${statusCls}" id="admin-ai-status">${statusTxt}${notSavedNote}</span>
      <div class="admin-ai-master">
        <label class="admin-ai-toggle" data-mode-toggle="__master">
          <input type="checkbox" id="admin-ai-master" ${state.enabled ? 'checked' : ''}>
          AI 전체 ${state.enabled ? '켜짐' : '꺼짐'}
        </label>
      </div>
    </div>
    <div class="admin-ai-modes ${state.enabled ? '' : 'is-locked'}" id="admin-ai-modes">
      ${modeToggles}
    </div>
    <div class="admin-ai-head">
      <span class="admin-ai-hint">학생에게는 선생님이 켠 기능만 보이고 사용할 수 있어요. 그림 기능은 준비 중이에요.</span>
      <button class="admin-ai-save" id="admin-ai-save" style="margin-left:auto;">저장</button>
    </div>
  `;

  const masterEl = panel.querySelector('#admin-ai-master');
  const modesEl  = panel.querySelector('#admin-ai-modes');
  const statusEl = panel.querySelector('#admin-ai-status');
  const saveBtn  = panel.querySelector('#admin-ai-save');

  masterEl.addEventListener('change', () => {
    state.enabled = masterEl.checked;
    masterEl.closest('.admin-ai-toggle').lastChild.textContent = ` AI 전체 ${state.enabled ? '켜짐' : '꺼짐'}`;
    statusEl.className = 'admin-ai-status ' + (state.enabled ? 'on' : 'off');
    statusEl.textContent = state.enabled ? 'AI 켜짐 · 저장하면 적용돼요' : 'AI 꺼짐 · 저장하면 적용돼요';
    modesEl.classList.toggle('is-locked', !state.enabled);
  });

  modesEl.querySelectorAll('input[data-ai-mode]').forEach(input => {
    input.addEventListener('change', () => {
      const key = input.dataset.aiMode;
      state.modes[key] = input.checked;
    });
  });

  saveBtn.addEventListener('click', () => _saveAiSettings(classId, state, panel, saveBtn, statusEl));
}

async function _saveAiSettings(classId, state, panel, saveBtn, statusEl) {
  if (!adminState.verified) return;
  const uid = (typeof auth !== 'undefined' && auth.currentUser) ? auth.currentUser.uid : null;

  const payload = {
    enabled: state.enabled === true,
    modes: {
      textS1:    state.modes.textS1    === true,
      textS2:    state.modes.textS2    === true,
      workCheck: state.modes.workCheck === true,
      imageS1:   state.modes.imageS1   === true,
      imageS2:   state.modes.imageS2   === true,
    },
    policy: {
      requireCompletion:  state.policy.requireCompletion  !== false,
      requireSafetyCheck: state.policy.requireSafetyCheck !== false,
      allowViewerToggle:  state.policy.allowViewerToggle  !== false,
    },
    updatedAt: Date.now(),
    updatedBy: uid,
  };

  saveBtn.disabled = true;
  saveBtn.textContent = '저장 중...';
  try {
    await db.ref(`classes/${classId}/aiSettings`).set(payload);
    _invalidateAdminCache('ai-settings-save');
    saveBtn.textContent = '✓ 저장됨';
    saveBtn.classList.add('saved');
    statusEl.className = 'admin-ai-status ' + (state.enabled ? 'on' : 'off');
    statusEl.textContent = state.enabled ? 'AI 켜짐 (저장됨)' : 'AI 꺼짐 (저장됨)';
    setTimeout(() => {
      saveBtn.textContent = '저장';
      saveBtn.classList.remove('saved');
      saveBtn.disabled = false;
    }, 1600);
  } catch (err) {
    saveBtn.disabled = false;
    saveBtn.textContent = '저장';
    alert('❌ AI 설정 저장 실패: ' + err.message);
  }
}

/* ════════════════════════════════════════════════════════════════
   ADMIN-1C: 학생 팀 생성 방식 설정 패널
   ──────────────────────────────────────────────────────────────
   · classes/{classId}/settings/teamCreationMode 만 set (settings 전체 set 금지)
   · 옵션: legacy_open(기존 방식) / teacher_managed(교사 등록 팀만)
   · locked는 이번 단계 UI 비노출(준비 중) — 학생 입장 코드엔 방어 존재
   · 설정 없으면 legacy_open으로 표시. 기존 학급에 기본값 일괄 쓰지 않음.
   ════════════════════════════════════════════════════════════════ */
async function _renderTeamModePanel(classId) {
  const panel = document.getElementById('admin-team-mode');
  if (!panel || !classId) return;

  /* 현재 저장값 로드 — 없으면 legacy_open 기본 */
  let mode = 'legacy_open';
  try {
    const snap = await db.ref(`classes/${classId}/settings/teamCreationMode`).once('value');
    const m = snap.val();
    if (m === 'teacher_managed' || m === 'locked' || m === 'legacy_open') mode = m;
  } catch (e) { /* 읽기 실패 시 기본값 유지 */ }

  /* locked가 저장돼 있으면 라디오는 일단 teacher_managed로 표시하되 안내 문구 노출 */
  const lockedNote = (mode === 'locked')
    ? '<div class="admin-tm-locked">현재 입장이 잠겨 있어요(준비 중 기능). 아래에서 방식을 바꾸면 잠금이 풀립니다.</div>'
    : '';
  const sel = (mode === 'locked') ? 'teacher_managed' : mode;

  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="admin-tm-head">
      <div class="admin-tm-title">🚪 학생 팀 생성 방식</div>
      <div class="admin-tm-desc">학생이 입장할 때 팀을 직접 만들 수 있게 할지, 선생님이 등록한 팀만 들어오게 할지 정해요.</div>
    </div>
    <div class="admin-tm-options">
      <label class="admin-tm-opt">
        <input type="radio" name="admin-tm" value="legacy_open" ${sel === 'legacy_open' ? 'checked' : ''}>
        <span class="admin-tm-opt-body">
          <span class="admin-tm-opt-title">기존 방식</span>
          <span class="admin-tm-opt-text">학생이 팀 이름과 PIN을 입력하면 새 팀을 만들 수 있습니다.</span>
        </span>
      </label>
      <label class="admin-tm-opt">
        <input type="radio" name="admin-tm" value="teacher_managed" ${sel === 'teacher_managed' ? 'checked' : ''}>
        <span class="admin-tm-opt-body">
          <span class="admin-tm-opt-title">교사 등록 팀만</span>
          <span class="admin-tm-opt-text">교사가 미리 만든 팀만 입장할 수 있어요. 오타나 장난 팀 생성을 막을 수 있습니다.</span>
        </span>
      </label>
    </div>
    ${lockedNote}
    <div class="admin-tm-foot">
      <span id="admin-tm-status" class="admin-tc-status"></span>
      <button id="admin-tm-save" class="admin-tc-btn" style="margin-left:auto;">저장</button>
    </div>
  `;

  const saveBtn  = panel.querySelector('#admin-tm-save');
  const statusEl = panel.querySelector('#admin-tm-status');
  if (saveBtn) saveBtn.addEventListener('click', () => {
    const picked = panel.querySelector('input[name="admin-tm"]:checked');
    const value  = picked ? picked.value : 'legacy_open';
    _saveTeamCreationMode(classId, value, saveBtn, statusEl);
  });
}

async function _saveTeamCreationMode(classId, value, btn, statusEl) {
  if (!adminState.verified || !classId) return;
  /* 화이트리스트 — UI에서 노출하는 2개만 저장 허용 */
  if (value !== 'legacy_open' && value !== 'teacher_managed') {
    _tcSetStatus(statusEl, 'err', '알 수 없는 설정이에요.');
    return;
  }

  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = '저장 중...';
  try {
    /* ⚠️ teamCreationMode child만 set — settings 전체/aiSettings 미접근 */
    await db.ref(`classes/${classId}/settings/teamCreationMode`).set(value);
    const msg = (value === 'teacher_managed')
      ? '✓ 저장됨 — 이제 선생님이 등록한 팀만 입장할 수 있어요.'
      : '✓ 저장됨 — 학생이 직접 팀을 만들 수 있어요.';
    _tcSetStatus(statusEl, 'ok', msg);
    _invalidateAdminCache('team-mode-save');
    btn.disabled = false;
    btn.textContent = prev;
  } catch (err) {
    const errMsg = (err && (err.code || err.message)) ? String(err.code || err.message) : '';
    if (/PERMISSION_DENIED|permission[_ ]?denied/i.test(errMsg)) {
      _tcSetStatus(statusEl, 'err', '저장 권한이 없어요. (보안 규칙 확인 필요)');
    } else {
      _tcSetStatus(statusEl, 'err', '저장 실패: ' + (err.message || err.code || '알 수 없는 오류'));
    }
    btn.disabled = false;
    btn.textContent = prev;
  }
}

/* ════════════════════════════════════════════════════════════════
   ADMIN-1B: 교사 팀/학생 계정 사전 생성 패널
   ──────────────────────────────────────────────────────────────
   · 교사가 팀명 + PIN을 미리 등록 → classes/{classId}/teams/{teamKey}/account
   · account child만 set. 기존 scenes/viewer-meta/pin 등은 건드리지 않음.
   · 완전히 새 teamKey(팀 노드 없음)에만 생성. 기존 팀이면 생성 중단(안전 우선).
   · teamKey는 학생 입장과 동일하게 encodeURIComponent(팀명) — 키 일치 보장.
   · 학생 입장 로직은 아직 account를 읽지 않음 — 연결은 ADMIN-1C에서.
   ⚠️ 현재 database.rules.json에는 teams/$team/account 쓰기 규칙이 없어,
      실제 write는 규칙 적용(다음 단계) 전까지 PERMISSION_DENIED일 수 있음.
      → 에러 핸들러가 이를 교사 친화 문구로 안내.
   ════════════════════════════════════════════════════════════════ */
function _renderTeamCreatePanel(classId) {
  const panel = document.getElementById('admin-team-create');
  if (!panel || !classId) return;
  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="admin-tc-head">
      <div class="admin-tc-title">👥 학생/팀 계정 미리 만들기</div>
      <div class="admin-tc-desc">팀 이름과 PIN을 정해 두면 학생들이 같은 이름으로 들어올 수 있어요. PIN은 학생이 입력할 숫자 4~6자리로 정해 주세요.</div>
    </div>
    <div class="admin-tc-form">
      <input id="admin-tc-name" class="admin-tc-input" type="text" maxlength="30"
        placeholder="팀 이름 (예: 2모둠)" autocomplete="off"/>
      <input id="admin-tc-pin" class="admin-tc-input admin-tc-input--pin" type="text"
        inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6"
        placeholder="PIN (숫자 4~6자리)" autocomplete="off"/>
      <button id="admin-tc-create" class="admin-tc-btn">팀 만들기</button>
    </div>
    <div id="admin-tc-status" class="admin-tc-status"></div>
  `;
  const nameEl   = document.getElementById('admin-tc-name');
  const pinEl    = document.getElementById('admin-tc-pin');
  const btn      = document.getElementById('admin-tc-create');
  const statusEl = document.getElementById('admin-tc-status');
  if (!btn) return;
  btn.addEventListener('click', () => _createTeamAccount(classId, nameEl, pinEl, btn, statusEl));
  [nameEl, pinEl].forEach(el => el && el.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); btn.click(); }
  }));
}

function _tcSetStatus(statusEl, kind, msg) {
  if (!statusEl) return;
  statusEl.className = 'admin-tc-status admin-tc-status--' + kind;
  statusEl.textContent = msg;
}

async function _createTeamAccount(classId, nameEl, pinEl, btn, statusEl) {
  if (!adminState.verified || !classId) return;
  const name = ((nameEl && nameEl.value) || '').trim();
  const pin  = ((pinEl && pinEl.value) || '').trim();

  /* 최소 검증 — 팀 이름 1~30자, PIN 숫자 4~6자리(학생 입력 조건과 정합) */
  if (!name) { _tcSetStatus(statusEl, 'err', '팀 이름을 입력해주세요.'); if (nameEl) nameEl.focus(); return; }
  if (name.length > 30) { _tcSetStatus(statusEl, 'err', '팀 이름은 30자 이내로 입력해주세요.'); return; }
  if (!pin)  { _tcSetStatus(statusEl, 'err', 'PIN을 입력해주세요.'); if (pinEl) pinEl.focus(); return; }
  if (!/^[0-9]{4,6}$/.test(pin)) { _tcSetStatus(statusEl, 'err', 'PIN은 숫자 4~6자리로 입력해 주세요.'); if (pinEl) pinEl.focus(); return; }

  /* 학생 입장과 동일 인코딩 재사용 — teamKey 일치 보장 */
  const teamKey = encodeURIComponent(name);
  const uid = (typeof auth !== 'undefined' && auth.currentUser) ? auth.currentUser.uid : null;

  btn.disabled = true;
  const prevLabel = btn.textContent;
  btn.textContent = '만드는 중...';
  _tcSetStatus(statusEl, 'info', '');

  try {
    const teamRef = db.ref(`classes/${classId}/teams/${teamKey}`);
    const snap = await teamRef.once('value');

    /* 안전 정책: 완전히 새 teamKey에만 account 생성. 기존 팀이면 중단. */
    if (snap.exists()) {
      const v = snap.val() || {};
      if (v.account) {
        _tcSetStatus(statusEl, 'err', `"${name}" 은(는) 이미 등록된 팀이에요.`);
      } else {
        _tcSetStatus(statusEl, 'err', `"${name}" 은(는) 이미 작품 데이터가 있는 팀이에요. 기존 팀 등록은 다음 단계에서 처리해요.`);
      }
      btn.disabled = false; btn.textContent = prevLabel;
      return;
    }

    const now = Date.now();
    /* ⚠️ account child만 set — 기존 scenes/viewer-meta/pin 등 미접근 */
    await teamRef.child('account').set({
      displayName: name,
      pin,
      status:    'active',
      createdBy: uid,
      createdAt: now,
      updatedAt: now,
    });

    _tcSetStatus(statusEl, 'ok', `✓ "${name}" 팀을 만들었어요. (PIN: ${pin})`);
    if (nameEl) nameEl.value = '';
    if (pinEl)  pinEl.value = '';
    btn.disabled = false; btn.textContent = prevLabel;
    _invalidateAdminCache('create-team-account');
    /* 1.5초 후 목록 새로고침 — 성공 문구를 잠시 보여주고 재렌더 */
    setTimeout(() => loadAdminData(), 1500);
  } catch (err) {
    const errMsg = (err && (err.code || err.message)) ? String(err.code || err.message) : '';
    if (/PERMISSION_DENIED|permission[_ ]?denied/i.test(errMsg)) {
      _tcSetStatus(statusEl, 'err', '아직 보안 규칙이 적용되지 않아 팀을 만들 수 없어요. (다음 단계에서 규칙 적용 후 사용 가능)');
    } else {
      _tcSetStatus(statusEl, 'err', '팀 만들기 실패: ' + (err.message || err.code || '알 수 없는 오류'));
    }
    btn.disabled = false; btn.textContent = prevLabel;
  }
}

/* v94: 빈 상태 — 작품 없을 때 학생 안내 */
function _renderEmptyGuide() {
  const list = document.getElementById('admin-team-list');
  if (!list) return;
  const code = adminState.adminClassCode || '';
  const baseUrl = location.origin + location.pathname.replace(/maker\.html.*$/, '');
  list.innerHTML = `
    <div class="admin-empty-guide">
      <div class="admin-empty-guide-icon">🎒</div>
      <div class="admin-empty-guide-title">아직 작품이 없어요</div>
      <div class="admin-empty-guide-text">
        학생들에게 아래 정보를 알려주세요.<br>
        학생이 모둠을 만들고 작품을 시작하면 여기에 나타나요.
      </div>
      ${code ? `<div class="admin-empty-guide-code">${_escHtml(code)}</div>` : ''}
      <div style="margin-top:6px;font-size:12px;color:#9a8868;">↑ 클래스 코드</div>
      <div class="admin-empty-guide-url">${_escHtml(baseUrl)}</div>
      <div style="margin-top:4px;font-size:12px;color:#9a8868;">↑ 접속 주소</div>
    </div>
  `;
}

function _escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

/* ================================================================
   팀 상태 분석 — pure function
   ─────────────────────────────────────────────────────────────
   admin/분석 문구 정리 1차:
   · '시작 장면' 개수 개념 제거 (entry는 single)
   · entry/replay는 명시 설정(meta) 우선 → 없으면 start scene fallback
   · entryValid/replayValid = 실제 scenes에 존재하는 장면을 가리키는지
   ================================================================ */
function _analyzeTeam(encodedName, scenes, isPublic = false, meta = {}, account = null) {
  const name     = decodeURIComponent(encodedName);
  const total    = scenes.length;
  const endings  = scenes.filter(s => s.type === 'ending').length;
  const trueEnds = scenes.filter(s => s.type === 'ending' && s.trueEnding).length;
  const hasImage = scenes.some(s => s.imageData);

  /* 일반 = 엔딩이 아닌 모든 장면 (기존 type === 'start' 데이터도 일반으로 묶음) */
  const normals  = scenes.filter(s => s.type !== 'ending').length;

  /* entry/replay 해석 — viewer의 _migrateCoverAndEntryDefaults와 같은 논리 */
  const sceneByNum = Object.fromEntries(scenes.map(s => [String(s.num), s]));
  const startScene = scenes.find(s => s.type === 'start')
                   || scenes.slice().sort((a, b) => Number(a.num) - Number(b.num))[0]
                   || null;

  const entryMetaSet  = meta.entrySceneId  !== null && meta.entrySceneId  !== undefined && meta.entrySceneId  !== '';
  const replayMetaSet = meta.replaySceneId !== null && meta.replaySceneId !== undefined && meta.replaySceneId !== '';
  const entryExplicit = entryMetaSet  && !!sceneByNum[String(meta.entrySceneId)];
  const replayExplicit= replayMetaSet && !!sceneByNum[String(meta.replaySceneId)];

  const entryNum  = entryExplicit  ? Number(meta.entrySceneId)
                    : (startScene ? Number(startScene.num) : null);
  const replayNum = replayExplicit ? Number(meta.replaySceneId) : entryNum;

  const entryValid  = entryNum  != null;
  const replayValid = replayNum != null;
  /* 명시 설정됐지만 유효하지 않은 경우 (존재하지 않는 장면을 가리킴) */
  const entryBroken  = entryMetaSet  && !entryExplicit;
  const replayBroken = replayMetaSet && !replayExplicit;

  /* 한 장면의 모든 next num 수집 (B-단계 N개 분기 인식).
     · buttons[] 우선 (W2-A 이후 기본 구조)
     · 없으면 legacy nextA/nextB fallback
     · falsy 값은 제외 */
  function _outgoingNumsAll(s) {
    if (!s) return [];
    const out = [];
    if (Array.isArray(s.buttons) && s.buttons.length > 0) {
      s.buttons.forEach(b => { if (b && b.nextId) out.push(String(b.nextId)); });
    } else {
      if (s.nextA) out.push(String(s.nextA));
      if (s.nextB) out.push(String(s.nextB));
    }
    return out;
  }

  /* 2026-05-29 admin 3차: 한 장면의 미연결 버튼 수 계산.
     · 표지/엔딩 제외 — 행동 버튼 자체 X
     · buttons[] 우선 — nextId 없는 항목 카운트 (Phase 4-C 정책과 정합)
     · legacy fallback — choiceCount 박은 시점 박은 거 박을 때만 박음
     · 저장 구조 박지 X — 읽기 전용
     2026-05-29 admin 3차 fix: choiceCount default 2 박은 거 폐기 —
     buttons 박지 X 박고 choiceCount 박지 X 박은 빈/옛 장면 박은 거 미연결 2개로
     과표시 박은 위험 차단. choiceCount 명시 박은 시점만 fallback 박음. */
  function _unconnectedButtonsCount(s) {
    if (!s) return 0;
    if (s.type === 'ending' || s.type === 'cover' || s.isCover) return 0;
    if (Array.isArray(s.buttons) && s.buttons.length > 0) {
      return s.buttons.filter(b => !b || !b.nextId).length;
    }
    /* legacy fallback — choiceCount 명시 박은 시점만 박음. 박지 X 박으면 0. */
    if (typeof s.choiceCount !== 'number' || s.choiceCount < 1) return 0;
    const cnt = s.choiceCount;
    let unset = 0;
    if (!s.nextA) unset++;
    if (cnt >= 2 && !s.nextB) unset++;
    return unset;
  }

  const nonEndingScenes = scenes.filter(s => s.type !== 'ending');
  /* 연결됨 = next 대상 1개 이상 (buttons[] 또는 nextA/B 어디든) */
  const connected       = nonEndingScenes.filter(s => _outgoingNumsAll(s).length > 0).length;
  const connectivity    = nonEndingScenes.length
    ? Math.round(connected / nonEndingScenes.length * 100) : 0;

  /* 2026-05-29 admin 3차: 작품 전체 미연결 버튼 수 집계.
     · 일반 장면 박은 거 박은 후 _unconnectedButtonsCount 박은 거 박은 합 */
  const unconnectedButtons = scenes.reduce((acc, s) => acc + _unconnectedButtonsCount(s), 0);

  const noTitle = scenes.filter(s => !s.title?.trim()).length;

  /* 고립 = 진입 장면(entryNum) 아니면서 아무도 가리키지 않는 장면 */
  const allNextIds = new Set(scenes.flatMap(s => _outgoingNumsAll(s)));
  const isolated   = scenes.filter(s =>
    String(s.num) !== String(entryNum) && !allNextIds.has(String(s.num))
  ).length;

  const ctx = {
    total, endings, entryValid, replayValid, entryBroken, replayBroken,
    connectivity, isolated, noTitle,
    /* 2026-05-29 admin 3차: 미연결 버튼 수 박은 ctx — _listProblems 박은 거 박음 */
    unconnectedButtons,
  };
  const status         = _classifyStatus(ctx);
  const interpretation = _makeInterpretation(status, ctx);
  const problems       = _listProblems(ctx);

  /* 2026-05-29 admin 1차: 작품 모드(projectType) 박음.
     · viewer-meta/projectType 박힌 거 박음 — 4종 화이트리스트 외 값은 미선택/알 수 없음
     · 읽기 전용 — Firebase 쓰기 박지 X */
  const MODE_LABEL = {
    picturebook: '그림책',
    text:        '텍스트',
    movie:       '무비',
    experience:  '체험전시',
  };
  const rawProjectType = (typeof meta.projectType === 'string') ? meta.projectType : '';
  const projectType    = MODE_LABEL[rawProjectType] ? rawProjectType : '';
  const modeLabel      = projectType
    ? MODE_LABEL[projectType]
    : (rawProjectType ? '알 수 없음' : '미선택');

  return {
    encodedName, name, total,
    endings, normals, trueEnds,
    entryNum, replayNum, entryValid, replayValid, entryBroken, replayBroken,
    hasImage, connectivity, noTitle, isolated, status, interpretation, problems,
    isPublic,
    projectType, modeLabel,
    /* 2026-05-29 admin 3차: 미연결 버튼 수 박은 거 — 카드 배지 + problems 박힘 */
    unconnectedButtons,
    /* ADMIN-1B: 교사 사전 등록(account) 여부/상태 — 카드 배지 표시용 */
    registered:    !!account,
    accountStatus: (account && account.status) ? account.status : null,
  };
}

function _classifyStatus({ total, endings, entryValid, entryBroken, replayBroken, connectivity, isolated }) {
  if (total === 0) return 'not-started';
  if (!entryValid || entryBroken || replayBroken || endings === 0 || connectivity < 50 || isolated > 3)
    return 'needs-attention';
  if (entryValid && endings >= 1 && connectivity >= 70)
    return 'ready';
  return 'in-progress';
}

const STATUS_META = {
  'not-started':     { label: '미시작',    color: '#6b5638', bg: '#f4ecd8', icon: '⬜' },
  'in-progress':     { label: '작업 중',   color: '#a07020', bg: '#fdf3df', icon: '🟡' },
  'ready':           { label: '감상 가능', color: '#5a8a4a', bg: '#eaf3df', icon: '🟢' },
  'needs-attention': { label: '확인 필요', color: '#c8503c', bg: '#fbf0ec', icon: '🔴' },
};

function _makeInterpretation(status, { total, endings, entryValid, entryBroken, replayBroken, connectivity, noTitle, isolated }) {
  if (status === 'not-started') return '아직 작품 제작을 시작하지 않았어요.';
  if (status === 'needs-attention') {
    if (entryBroken)    return '첫 감상 시작점이 존재하지 않는 장면을 가리켜요.';
    if (!entryValid)    return '첫 감상 시작점이 없어 작품을 열기 어려워요.';
    if (replayBroken)   return '다시 시작점이 존재하지 않는 장면을 가리켜요.';
    if (endings === 0)  return '엔딩 장면이 없어 이야기가 완성되지 않았어요.';
    if (isolated > 3)   return '연결이 끊긴 장면이 많아요. 흐름 점검이 필요해요.';
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

function _listProblems({ total, endings, entryValid, entryBroken, replayBroken, connectivity, noTitle, isolated, unconnectedButtons }) {
  const problems = [];
  if (total === 0) return problems;
  if (entryBroken)      problems.push({ icon: '❌', text: '첫 감상 시작점이 존재하지 않는 장면을 가리켜요' });
  else if (!entryValid) problems.push({ icon: '⚠️', text: '첫 감상 시작점이 지정되지 않았어요' });
  if (replayBroken)     problems.push({ icon: '❌', text: '다시 시작점이 존재하지 않는 장면을 가리켜요' });
  if (endings === 0)    problems.push({ icon: '⚠️', text: '엔딩 장면이 없어요' });
  if (connectivity < 70 && total > 1) problems.push({ icon: '🔗', text: `연결 완성도 ${connectivity}%` });
  /* 2026-05-29 admin 3차: 미연결 버튼 개별 카운트 — connectivity %(scene 단위)와 보완.
     1 이상일 때만 박음 — 0이면 박지 X (불필요 경고 차단). */
  if (unconnectedButtons > 0) problems.push({ icon: '🔗', text: `미연결 버튼 ${unconnectedButtons}개` });
  if (isolated > 0)     problems.push({ icon: '🔴', text: `고립 장면 ${isolated}개` });
  if (noTitle > 0)      problems.push({ icon: '📝', text: `내용 없는 장면 ${noTitle}개` });
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
      </div>`).join('')}
    <button type="button" class="js-admin-refresh" title="팀 목록 새로고침"
      style="margin-left:auto;background:none;border:1px solid rgba(107,86,56,0.28);border-radius:7px;padding:4px 9px;cursor:pointer;font-size:13px;color:#6b5638;line-height:1;">🔄 새로고침</button>`;
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
  /* 2026-05-29 admin 2차: 모드 필터 — 상태 필터와 AND 결합. 박지 X 박힌 채면 모든 모드. */
  const modeFilters = [
    { key: 'all',         label: '전체 모드' },
    { key: 'picturebook', label: '그림책' },
    { key: 'text',        label: '텍스트' },
    { key: 'movie',       label: '무비' },
    { key: 'experience',  label: '체험전시' },
    { key: 'unset',       label: '미선택' },
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
    <div class="admin-filters admin-filters--mode">
      <span class="admin-filter-label">모드:</span>
      ${modeFilters.map(f => `
        <button class="admin-filter-btn admin-filter-btn--mode ${adminState.modeFilter === f.key ? 'active' : ''}"
          data-mode-filter="${f.key}">${f.label}</button>`).join('')}
    </div>
    <div class="admin-sorts">
      <span class="admin-sort-label">정렬:</span>
      ${sorts.map(s => `
        <button class="admin-sort-btn ${adminState.sort === s.key ? 'active' : ''}"
          data-sort="${s.key}">${s.label}</button>`).join('')}
    </div>`;

  bar.querySelectorAll('.admin-filter-btn[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      adminState.filter = btn.dataset.filter;
      _renderFilterBar(adminState.allTeams);
      _renderTeamList();
    });
  });

  bar.querySelectorAll('.admin-filter-btn[data-mode-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      adminState.modeFilter = btn.dataset.modeFilter;
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

  /* 2026-05-29 admin 2차: 모드 필터 — 상태 필터 다음에 AND 적용.
     · 'all'    → 모든 모드 박힘 (필터 박지 X)
     · 'unset'  → projectType 박지 X 박은 팀만 (빈 문자열 박은 거)
     · 그 외   → 정확히 박힌 projectType 박은 팀만 */
  if (adminState.modeFilter && adminState.modeFilter !== 'all') {
    teams = (adminState.modeFilter === 'unset')
      ? teams.filter(t => !t.projectType)
      : teams.filter(t => t.projectType === adminState.modeFilter);
  }

  const ORDER = { 'needs-attention': 0, 'in-progress': 1, 'not-started': 2, 'ready': 3 };
  if (adminState.sort === 'name')
    teams.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  else if (adminState.sort === 'scenes')
    teams.sort((a, b) => b.total - a.total);
  else if (adminState.sort === 'status') {
    /* 2026-05-29 admin 4차: 문제 우선 정렬 — status 박은 거 박은 후 추가 우선순위 박음.
       · 같은 status 박은 거 박힐 때 박은 문제 박은 거 박은 거 박은 팀 박은 거 박은 거 박음
       · 우선순위: status → 미연결 버튼 수 → problems.length → isolated → connectivity(낮은 게 먼저) → 이름순
       · undefined 박은 거 박은 거 박은 거 박지 X 박은 안전망 박음 (`|| 0`)
       · name/scenes 정렬 박은 거 박지 X 박은 채 — 박은 영역 한정 */
    teams.sort((a, b) => {
      const statusDiff = (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9);
      if (statusDiff) return statusDiff;

      const unconnectedDiff = (b.unconnectedButtons || 0) - (a.unconnectedButtons || 0);
      if (unconnectedDiff) return unconnectedDiff;

      const problemsDiff = ((b.problems && b.problems.length) || 0) - ((a.problems && a.problems.length) || 0);
      if (problemsDiff) return problemsDiff;

      const isolatedDiff = (b.isolated || 0) - (a.isolated || 0);
      if (isolatedDiff) return isolatedDiff;

      const connectivityDiff = (a.connectivity || 0) - (b.connectivity || 0);
      if (connectivityDiff) return connectivityDiff;

      return a.name.localeCompare(b.name, 'ko');
    });
  }

  if (!teams.length) {
    list.innerHTML = '<div class="admin-empty">해당 상태의 팀이 없어요.</div>';
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
  /* 2026-05-29 admin 1차: 작품 모드 배지 — 카드 첫 자리에 박음 (가장 자주 박는 정보).
     모드 박혀있을 때만 박음 — 미선택은 박지 X (시각 잡음 차단). */
  if (t.projectType) badges.push(`<span class="admin-badge admin-badge--mode">📚 ${_escHtml(t.modeLabel)}</span>`);
  /* ADMIN-1B: 교사 사전 등록 팀 배지 (account 존재 시). 상태 locked면 잠김 표시. */
  if (t.registered) badges.push(t.accountStatus === 'locked'
    ? '<span class="admin-badge admin-badge--locked">🔒 잠김</span>'
    : '<span class="admin-badge admin-badge--registered">✅ 등록됨</span>');
  if (t.trueEnds > 0) badges.push('<span class="admin-badge admin-badge--true">⭐ 진엔딩</span>');
  if (t.hasImage)     badges.push('<span class="admin-badge admin-badge--img">🖼 이미지</span>');
  if (t.status === 'in-progress' && t.total > 0)
    badges.push(`<span class="admin-badge admin-badge--conn">연결 ${t.connectivity}%</span>`);
  /* 2026-05-29 admin 3차: 미연결 버튼 배지 — 1 이상일 때만 박음.
     status 무관 박음 — ready 박은 거 박을 때도 미연결 박힌 거 박을 수 있음. */
  if (t.unconnectedButtons > 0)
    badges.push(`<span class="admin-badge admin-badge--warn">🔗 미연결 버튼 ${t.unconnectedButtons}개</span>`);

  const problemsHtml = t.problems.length
    ? `<div class="admin-problems">${t.problems.map(p =>
        `<span class="admin-problem">${p.icon} ${p.text}</span>`).join('')}</div>`
    : '';

  const makerBtn  = `<button class="admin-action-btn admin-action-btn--maker js-admin-maker" data-name="${t.name}" title="Maker로 열기">🛠 수정</button>`;
  const viewerBtn = canView
    ? `<button class="admin-action-btn admin-action-btn--viewer js-admin-viewer" data-name="${t.name}" title="Viewer로 보기">▶ 감상</button>`
    : `<button class="admin-action-btn admin-action-btn--viewer admin-action-btn--disabled" disabled title="감상 가능 상태가 아니에요">▶ 감상</button>`;
  const publicBtn = `<button class="admin-action-btn js-admin-toggle-public ${t.isPublic ? 'admin-action-btn--public-on' : 'admin-action-btn--public-off'}"
    data-encoded="${t.encodedName}" data-name="${t.name}" data-public="${t.isPublic}"
    title="${t.isPublic ? '비공개로 전환' : '공개로 전환'}">
    ${t.isPublic ? '🌐 공개 중' : '🔒 비공개'}
  </button>`;
  const detailBtn = `<button class="admin-action-btn admin-action-btn--detail js-admin-detail" data-encoded="${t.encodedName}" title="상세 보기">상세</button>`;
  /* ADMIN-1D: account가 있는 등록 팀에만 PIN 변경 / 잠금·해제 메뉴 노출.
     ADMIN-1E: account 없는 기존 팀에는 '관리팀으로 등록'만 노출.
     (교사 등록 팀만 입장 모드에서는 account 있는 팀만 입장 가능하므로,
      기존 자율 생성 팀을 삭제 없이 관리팀으로 편입할 수 있게 함.) */
  const accountMenuItems = t.registered
    ? `<button class="admin-more-item js-admin-pin" data-encoded="${t.encodedName}" data-name="${t.name}">🔑 PIN 변경</button>
      ${t.accountStatus === 'locked'
        ? `<button class="admin-more-item js-admin-lock" data-encoded="${t.encodedName}" data-name="${t.name}" data-status="locked">🔓 잠금 해제</button>`
        : `<button class="admin-more-item js-admin-lock" data-encoded="${t.encodedName}" data-name="${t.name}" data-status="active">🔒 잠금</button>`}`
    : `<button class="admin-more-item js-admin-register" data-encoded="${t.encodedName}" data-name="${t.name}">🧩 관리팀으로 등록</button>`;

  const moreBtn   = `<button class="admin-action-btn admin-action-btn--more js-admin-more" title="더 보기">⋯</button>
    <div class="admin-more-menu" style="display:none;">
      ${accountMenuItems}
      <button class="admin-more-item js-admin-issue-code" data-encoded="${t.encodedName}" data-name="${t.name}">📤 복사 코드 발급</button>
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
        ${makerBtn}${viewerBtn}${publicBtn}${detailBtn}
        <div class="admin-more-wrap">${moreBtn}</div>
      </div>
    </div>

    <div class="admin-card-body">
      <div class="admin-card-stats">
        ${t.total > 0
          ? `장면 ${t.total}개 · 일반 ${t.normals} · 엔딩 ${t.endings}${
              t.entryNum != null ? ` · 첫 감상 장면 ${t.entryNum}` : ''
            }`
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
  /* maker 열기 — return context 저장 불필요 (maker가 viewer 열 때 자기가 저장) */
  window.open(`maker.html?team=${encodeURIComponent(teamName)}${cid}`, '_blank');
}

function _openViewer(teamName) {
  const cid = adminState.adminClassId
    ? `&classId=${encodeURIComponent(adminState.adminClassId)}` : '';
  /* ★ admin → viewer 직접 진입: 복귀 대상은 admin 화면
     source='admin' 명시 → viewer의 _returnToMaker가 admin 경로로 정확히 fallback */
  try {
    localStorage.setItem('branchReturnContext', JSON.stringify({
      source:  'admin',
      url:     location.href,
      savedAt: Date.now(),
    }));
  } catch (e) { /* storage 실패해도 진입은 계속 */ }
  window.open(`viewer.html?team=${encodeURIComponent(teamName)}${cid}&from=maker`, '_blank');
}

/* ================================================================
   공개/비공개 토글
   viewer-meta/isPublic을 반전 저장 후 카드 즉시 갱신
   ================================================================ */
async function _toggleIsPublic(encodedName, teamName, currentIsPublic) {
  if (!adminState.verified) return;

  const newIsPublic = !currentIsPublic;
  const label       = newIsPublic ? '공개' : '비공개';

  const metaPath = (DATA_PATH_VERSION === 'v2' && adminState.adminClassId)
    ? `classes/${adminState.adminClassId}/teams/${encodedName}/viewer-meta/isPublic`
    : `teams/${encodedName}/viewer-meta/isPublic`;

  try {
    await db.ref(metaPath).set(newIsPublic);

    /* allTeams 상태 즉시 업데이트 후 카드 리렌더 */
    const team = adminState.allTeams.find(t => t.encodedName === encodedName);
    if (team) team.isPublic = newIsPublic;
    _invalidateAdminCache('toggle-public');   // 상태 변경 — 다음 재진입 때 fresh 읽기
    _renderTeamList();
  } catch (err) {
    alert(`❌ ${label} 전환 실패: ${err.message}`);
  }
}

/* ════════════════════════════════════════════════════════════════
   ADMIN-1D: 등록 팀 account 관리 — PIN 변경 / 잠금·해제
   ──────────────────────────────────────────────────────────────
   · account child(pin/status/updatedAt)만 update. account 전체 set 금지.
   · 기존 teams/{teamKey}/pin · scenes · viewer-meta 등 절대 미접근.
   · 잠금은 팀 삭제가 아님 — 작품 데이터 유지, 학생 입장만 차단(teacher_managed
     입장 로직이 account.status === 'locked'를 이미 막음).
   ════════════════════════════════════════════════════════════════ */
function _accountRef(encodedName) {
  /* v2 + classId일 때만 account 경로가 유효. (등록 팀은 v2 전제) */
  if (DATA_PATH_VERSION === 'v2' && adminState.adminClassId) {
    return db.ref(`classes/${adminState.adminClassId}/teams/${encodedName}/account`);
  }
  return null;
}

function _adminAccountErr(err, fallbackLabel) {
  const errMsg = (err && (err.code || err.message)) ? String(err.code || err.message) : '';
  if (/PERMISSION_DENIED|permission[_ ]?denied/i.test(errMsg)) {
    alert('권한이 없어 ' + fallbackLabel + '을(를) 못 했어요. (보안 규칙 확인이 필요해요)');
  } else {
    alert('❌ ' + fallbackLabel + ' 실패: ' + (err.message || err.code || '알 수 없는 오류'));
  }
}

async function _changeTeamPin(encodedName, displayName) {
  if (!adminState.verified) return;
  const ref = _accountRef(encodedName);
  if (!ref) { alert('이 팀의 계정 정보를 찾을 수 없어요.'); return; }

  const input = prompt(`"${displayName}" 팀의 새 PIN을 숫자 4~6자리로 입력해 주세요.`);
  if (input === null) return;                 /* 취소 → 아무것도 안 함 */
  const newPin = input.trim();
  if (!/^[0-9]{4,6}$/.test(newPin)) {
    alert('PIN은 숫자 4~6자리로 입력해 주세요. 변경을 취소했어요.');
    return;
  }

  try {
    /* ⚠️ pin·updatedAt child만 update */
    await ref.update({ pin: newPin, updatedAt: Date.now() });
    alert(`✅ "${displayName}" 팀의 PIN을 바꿨어요. (새 PIN: ${newPin})`);
    _invalidateAdminCache('change-team-pin');
  } catch (err) {
    _adminAccountErr(err, 'PIN 변경');
  }
}

async function _toggleTeamLock(encodedName, displayName, currentStatus) {
  if (!adminState.verified) return;
  const ref = _accountRef(encodedName);
  if (!ref) { alert('이 팀의 계정 정보를 찾을 수 없어요.'); return; }

  const newStatus = (currentStatus === 'locked') ? 'active' : 'locked';
  const confirmMsg = (newStatus === 'locked')
    ? `"${displayName}" 팀을 잠글까요?\n잠금 상태에서는 학생이 이 팀으로 입장할 수 없어요. (작품 데이터는 그대로 유지돼요.)`
    : `"${displayName}" 팀의 잠금을 해제할까요?\n해제하면 학생이 다시 입장할 수 있어요.`;
  if (!confirm(confirmMsg)) return;

  try {
    /* ⚠️ status·updatedAt child만 update */
    await ref.update({ status: newStatus, updatedAt: Date.now() });
    /* 카드 즉시 갱신 — allTeams 상태 반영 후 리렌더 */
    const team = adminState.allTeams.find(t => t.encodedName === encodedName);
    if (team) team.accountStatus = newStatus;
    _invalidateAdminCache('toggle-team-lock');
    _renderTeamList();
    alert(newStatus === 'locked'
      ? `🔒 "${displayName}" 팀을 잠갔어요.`
      : `🔓 "${displayName}" 팀의 잠금을 풀었어요.`);
  } catch (err) {
    _adminAccountErr(err, (newStatus === 'locked') ? '잠금' : '잠금 해제');
  }
}

/* ════════════════════════════════════════════════════════════════
   ADMIN-1E: account 없는 기존 팀을 관리팀으로 등록
   ──────────────────────────────────────────────────────────────
   · 학생이 기존 방식으로 만든 팀(account 없음)을 teacher_managed에서도
     쓸 수 있게, 기존 작품을 그대로 둔 채 account child만 새로 생성.
   · 기존 teams/{teamKey}/pin · scenes · viewer-meta 는 절대 미접근.
   · account가 이미 있으면 중단(set은 account 없을 때만).
   ════════════════════════════════════════════════════════════════ */
async function _registerExistingTeam(encodedName, displayName) {
  if (!adminState.verified) return;
  const ref = _accountRef(encodedName);
  if (!ref) { alert('이 팀의 계정 정보를 찾을 수 없어요.'); return; }

  if (!confirm(`"${displayName}" 팀을 관리팀으로 등록할까요?\n기존 작품은 그대로 두고, 이 팀에 새 PIN을 부여해 교사 관리팀으로 등록합니다.`)) return;

  const input = prompt(`"${displayName}" 팀에 부여할 새 PIN을 숫자 4~6자리로 입력해 주세요.`);
  if (input === null) return;                 /* 취소 → 아무것도 안 함 */
  const newPin = input.trim();
  if (!/^[0-9]{4,6}$/.test(newPin)) {
    alert('PIN은 숫자 4~6자리로 입력해 주세요. 등록을 취소했어요.');
    return;
  }

  try {
    /* account 재확인 — 이미 있으면 중단(중복 set 방지) */
    const snap = await ref.once('value');
    if (snap.exists()) {
      alert('이미 등록된 팀이에요. 목록을 새로고침할게요.');
      _invalidateAdminCache('register-existing-exists');
      loadAdminData();
      return;
    }

    const uid = (typeof auth !== 'undefined' && auth.currentUser) ? auth.currentUser.uid : null;
    const now = Date.now();
    /* ⚠️ account child만 set — 기존 pin/scenes/viewer-meta 미접근.
       account가 없을 때만 도달하므로 전체 set 허용. */
    await ref.set({
      displayName,
      pin: newPin,
      status: 'active',
      createdBy: uid,
      createdAt: now,
      updatedAt: now,
      migratedFromLegacy: true,
    });

    /* 카드 즉시 갱신 — 등록됨 배지/관리 버튼 반영 */
    const team = adminState.allTeams.find(t => t.encodedName === encodedName);
    if (team) { team.registered = true; team.accountStatus = 'active'; }
    _invalidateAdminCache('register-existing-team');
    _renderTeamList();
    alert(`✅ "${displayName}" 팀을 관리팀으로 등록했어요. (PIN: ${newPin})`);
  } catch (err) {
    _adminAccountErr(err, '관리팀 등록');
  }
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
   v40: 복사 코드 발급 흐름 — admin 카드 더보기 메뉴
   ─────────────────────────────────────────────────────────────
   · v2(classId 있음)에서만 동작
   · 발급 성공 시 모달로 코드 표시 + 클립보드 복사 버튼
   ================================================================ */
async function _issueCopyCodeFlow(encodedName, teamName) {
  if (!adminState.verified) return;
  if (!adminState.adminClassId) {
    alert('복사 코드는 v2 클래스에서만 발급할 수 있어요.');
    return;
  }
  document.querySelectorAll('.admin-more-menu').forEach(m => { m.style.display = 'none'; });

  try {
    const { code, expiresAt } = await issueCopyCode(adminState.adminClassId, encodedName);
    _showCopyCodeModal(teamName, code, expiresAt);
  } catch (err) {
    alert(`❌ 코드 발급 실패: ${err.message}`);
  }
}

function _showCopyCodeModal(teamName, code, expiresAt) {
  document.querySelector('.copy-code-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'copy-code-modal';
  const expiresStr = new Date(expiresAt).toLocaleString('ko-KR', {
    month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  overlay.innerHTML = `
    <div class="copy-code-panel">
      <h3 class="copy-code-title">📤 복사 코드 발급됨</h3>
      <p class="copy-code-team">👥 ${teamName}</p>
      <div class="copy-code-box">
        <div class="copy-code-digits">${code}</div>
        <button class="copy-code-copy js-copy-code-clip" title="클립보드에 복사">📋 복사</button>
      </div>
      <p class="copy-code-hint">
        다른 모둠은 빈 모둠으로 로그인 → "어떤 작품을 만들까요?" 화면에서<br>
        <strong>📥 다른 모둠 작품 받기</strong>를 누르고 이 코드를 입력하면 받아요.
      </p>
      <p class="copy-code-expire">만료: ${expiresStr}까지 (24시간) · 다회 사용 가능</p>
      <div class="copy-code-actions">
        <button class="copy-code-close js-copy-code-close">닫기</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('.js-copy-code-close')?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('.js-copy-code-clip')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code);
      const btn = overlay.querySelector('.js-copy-code-clip');
      if (btn) { btn.textContent = '✓ 복사됨'; setTimeout(() => { btn.textContent = '📋 복사'; }, 1500); }
    } catch (e) { /* clipboard 권한 없으면 silent */ }
  });
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
           <div class="admin-detail-label" style="color:#5a8a4a;">✅ 구조 이상 없음</div>
         </div>`;

    const sceneChips = arr.length
      ? `<div class="admin-detail-section">
           <div class="admin-detail-label">장면 목록 (${arr.length}개)</div>
           <div class="admin-scene-chips">
             ${arr.map(s => {
               /* 언어 정리: '시작' 타입 표현 제거. 엔딩/일반만 색으로 구분하고
                  entry/replay는 역할 배지로 별도 표시. */
               const isEnding = s.type === 'ending';
               const isEntry  = team && String(team.entryNum)  === String(s.num);
               const isReplay = team && String(team.replayNum) === String(s.num);
               const color = isEnding ? '#c8503c' : '#5a92c2';
               /* nexts 표시 — buttons[] 우선, 없으면 nextA/B fallback (B-단계 N개 인식).
                  최대 6개까지 chip에 표시. 라벨 길면 약자 (A→1, B→2, ...) */
               let nexts;
               if (Array.isArray(s.buttons) && s.buttons.length > 0) {
                 nexts = s.buttons.slice(0, 6).map((b, i) => {
                   if (!b || !b.nextId) return null;
                   const portChar = String.fromCharCode(65 + i);
                   return `${portChar}→${b.nextId}`;
                 }).filter(Boolean);
               } else {
                 nexts = [s.nextA && `A→${s.nextA}`, s.nextB && `B→${s.nextB}`].filter(Boolean);
               }
               const roleBadgeHtml = [
                 isEntry  ? '<span class="chip-role" style="background:#eaf3df;color:#5a8a4a;border:1px solid #b8d1a8;padding:1px 6px;border-radius:8px;font-size:10px;margin-left:3px;">첫 감상</span>' : '',
                 isReplay ? '<span class="chip-role" style="background:#eef3f9;color:#3a6ab0;border:1px solid #b8cde0;padding:1px 6px;border-radius:8px;font-size:10px;margin-left:3px;">다시</span>' : '',
               ].join('');
               return `<div class="admin-scene-chip" style="border-color:${color};">
                 <span class="chip-type" style="color:${color};">${isEnding ? '엔딩' : '일반'} ${s.num}</span>${roleBadgeHtml}
                 <span class="chip-title">${s.title ? s.title.slice(0,18) : '(내용 없음)'}</span>
                 ${nexts.length ? `<span class="chip-next">${nexts.join(' ')}</span>` : ''}
               </div>`;
             }).join('')}
           </div>
         </div>`
      : `<div class="admin-detail-section"><span style="color:#6b5638;font-size:12px;">장면 없음</span></div>`;

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
  if (!confirm(`"${displayName}" 팀의 모든 데이터를 삭제할까요?\n이 작업은 되돌릴 수 없어요!`)) return;

  /* 2026-05-29 admin 1차: 강한 확인 — 팀 이름 정확히 다시 입력 박혀야 remove() 박음.
     · 옛엔 confirm() 한 번만 박힘 — 실수 클릭 시 학생 작품 복구 X
     · prompt 박은 입력값이 teamName과 정확히 일치 박혀야 박힘
     · 취소 / 빈 값 / 불일치 → remove() 호출 경로 박지 X (안전 우선) */
  const typed = prompt(
    `⚠️ 마지막 확인 — 이 작업은 복구할 수 없어요.\n\n` +
    `삭제하려면 팀 이름을 정확히 입력해주세요:\n"${displayName}"\n\n` +
    `(취소하거나 다르게 박으면 삭제 박지 X)`
  );
  if (typed === null) return;                           /* 취소 */
  if (typed.trim() === '') {                            /* 빈 값 */
    alert('빈 입력이라 삭제를 취소했어요.');
    return;
  }
  if (typed !== displayName) {                          /* 불일치 */
    alert(`팀 이름이 일치하지 않아 삭제를 취소했어요.\n입력: "${typed}"\n팀명: "${displayName}"`);
    return;
  }

  const teamPath = (DATA_PATH_VERSION === 'v2' && adminState.adminClassId)
    ? `classes/${adminState.adminClassId}/teams/${encodedName}`
    : `teams/${encodedName}`;

  db.ref(teamPath).remove()
    .then(() => {
      alert(`✅ "${displayName}" 팀 데이터가 삭제됐어요.`);
      adminState.allTeams = adminState.allTeams.filter(t => t.encodedName !== encodedName);
      _invalidateAdminCache('delete-team');   // 다음 재진입 때 삭제된 팀이 캐시로 살아나지 않게
      _renderSummaryBar(adminState.allTeams);
      _renderFilterBar(adminState.allTeams);
      _renderTeamList();
    })
    .catch(err => {
      /* 2026-05-29 admin 2차: PERMISSION_DENIED 박은 별도 안내.
         · Firebase RTDB 규칙상 admin 화면에서 직접 박지 X 박을 수 있음
         · 원문 에러 박지 X — 교사 친화 문구 박음
         · 권한 박는 거 박지 X (database.rules.json 박지 X) */
      const errMsg  = (err && (err.code || err.message)) ? String(err.code || err.message) : '';
      const isPermDenied = /PERMISSION_DENIED|permission[_ ]?denied/i.test(errMsg);
      if (isPermDenied) {
        alert(
          '⚠️ 삭제 권한이 없어 삭제되지 않았어요.\n\n' +
          '현재 보안 규칙상 관리자 화면에서 팀 데이터를 직접 삭제할 수 없어요.\n' +
          '관리자에게 별도 처리 부탁드려요.'
        );
      } else {
        alert('❌ 삭제 실패: ' + (err.message || err.code || '알 수 없는 오류'));
      }
    });
}
