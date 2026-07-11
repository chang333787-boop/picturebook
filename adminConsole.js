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
  /* 2026-05-29 admin 2차: 모드별 필터 — 상태 필터와 함께 적용됨.
     'all' = 전체 모드 / 'unset' = projectType 미설정 팀 / 그 외 = 4 화이트리스트 */
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
    const printBtn    = e.target.closest('.js-admin-print');    /* SCENE-PUBLISH-PRINT-1 */
    const printWaBtn  = e.target.closest('.js-admin-print-wa'); /* TEACHER-PRINT-ROUTE-1: 고쳐쓰기 자료 */
    const printTcBtn  = e.target.closest('.js-admin-print-tc'); /* TEACHER-PRINT-ROUTE-1: 생각 나침반 */
    const pinBtn      = e.target.closest('.js-admin-pin');     // ADMIN-1D: 등록 팀 PIN 변경
    const lockBtn     = e.target.closest('.js-admin-lock');    // ADMIN-1D: 등록 팀 잠금/해제
    const regBtn      = e.target.closest('.js-admin-register'); // ADMIN-1E: 기존 팀 관리팀 등록
    const acctDelBtn  = e.target.closest('.js-admin-account-del'); // DELETE-SAFETY-2: 계정만 삭제

    if (makerBtn)  _openMaker(makerBtn.dataset.name);
    if (viewerBtn) _openViewer(viewerBtn.dataset.name);
    if (printBtn)  _openViewer(printBtn.dataset.name, '&print=pb');   /* viewer에서 인쇄 옵션 모달 자동 오픈 */
    /* TEACHER-PRINT-ROUTE-1: 학생 태블릿엔 프린터가 없어 교사가 대신 인쇄하는 진입.
       wa=viewer를 &print=wa로 열어 고쳐쓰기 자료 인쇄 자동 실행(그림책 &print=pb 패턴).
       tc=같은 maker 안에서 해당 팀 나침반 결과보기(fromAdmin — 인쇄 버튼 직행)를 바로 연다. */
    if (printWaBtn) _openViewer(printWaBtn.dataset.name, '&print=wa');
    if (printTcBtn) _openCompassReviewForTeam(printTcBtn.dataset.name);
    if (detailBtn) _toggleDetail(detailBtn.dataset.encoded);
    if (deleteBtn) _deleteTeam(deleteBtn.dataset.encoded, deleteBtn.dataset.name);
    if (moreBtn)   _toggleMoreMenu(moreBtn);
    if (publicBtn) _toggleIsPublic(publicBtn.dataset.encoded, publicBtn.dataset.name, publicBtn.dataset.public === 'true');
    if (issueBtn)  _issueCopyCodeFlow(issueBtn.dataset.encoded, issueBtn.dataset.name);
    if (pinBtn)    _changeTeamPin(pinBtn.dataset.encoded, pinBtn.dataset.name);
    if (lockBtn)   _toggleTeamLock(lockBtn.dataset.encoded, lockBtn.dataset.name, lockBtn.dataset.status);
    if (regBtn)    _registerExistingTeam(regBtn.dataset.encoded, regBtn.dataset.name);
    if (acctDelBtn) _deleteAccountOnly(acctDelBtn.dataset.encoded, acctDelBtn.dataset.name);
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
  /* ADMIN-REDESIGN-1(2026-07-09): 학생 입장폼(#join-screen)을 숨겨 관리 진입 시 뒤 노출/플래시 방지.
     학생 입장 흐름(firebase.js가 성공 시 hidden 토글)엔 무영향 — admin 진입 세션에서만 숨김. */
  document.getElementById('join-screen')?.classList.add('hidden');
  document.getElementById('admin-panel').style.display = 'flex';
  loadAdminData();
}

function closeAdmin() {
  /* ADMIN-REDESIGN-1(2026-07-09): 닫기 = 교사 홈(index)으로 이동. 기존엔 admin-panel만 display:none 해서
     밑에 깔려 있던 학생 입장폼(#join-screen)이 드러나 사용자가 혼란 → index로 명시 이동해 근본 해소.
     상태/캐시 리셋은 유지(호출 안전). 페이지 이동이라 재진입은 fresh reload. */
  adminState.verified     = false;
  adminState.adminClassId = null;
  _invalidateAdminCache('close-admin');
  window.location.replace('index.html');
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

/* ════════════════════════════════════════════════════════════════
   MASTER-M1(2026-07-11): 총괄(super_admin) — 전체 학급 선택 바.
   ─────────────────────────────────────────────────────────────
   · 개별 학급 권한(rules의 super_admin 동급 허용)은 이미 있으나 "나열 수단"이 없어
     자기 학급만 보이던 문제 해소. 목록 소스 = classes-index(read: super_admin만,
     신규 학급 생성 시 teacher-auth가 기록·기존 학급은 07-11 백필 완료).
   · 일반 교사에겐 아무 UI/추가 read 없음(role 확인 후에만 동작) — 기존 흐름 무영향.
   ════════════════════════════════════════════════════════════════ */
let _authRoleCache = null;
async function _getAuthRole() {
  if (_authRoleCache !== null) return _authRoleCache;
  try {
    const user = getCurrentUser();
    if (!user) return (_authRoleCache = '');
    const t = await user.getIdTokenResult();
    _authRoleCache = (t && t.claims && t.claims.role) || '';
  } catch (e) { _authRoleCache = ''; }
  return _authRoleCache;
}

async function _renderMasterClassPicker() {
  let host = document.getElementById('admin-master-class-picker');
  if (host && host.dataset.loaded === '1') return true;   /* 이미 렌더됨(선택 상태 보존) */
  if (!host) {
    const bar = document.getElementById('admin-class-bar');
    if (!bar || !bar.parentNode) return false;
    host = document.createElement('div');
    host.id = 'admin-master-class-picker';
    host.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;'
      + 'margin:0 0 10px;padding:10px 14px;background:#fdf3e0;border:1.5px solid #c9a96a;'
      + 'border-radius:10px;font-size:13px;';
    bar.parentNode.insertBefore(host, bar);
  }
  let idx = null;
  try {
    idx = (await db.ref('classes-index').once('value')).val();
  } catch (e) { host.remove(); return false; }   /* read 거부 = super_admin 아님 */
  if (!idx || typeof idx !== 'object') { host.remove(); return false; }
  const items = Object.entries(idx).map(([id, m]) => ({
    id,
    name:  (m && m.name) || '',
    code:  (m && m.code) || '',
    email: (m && m.teacher_email) || '',
    at:    (m && m.createdAt) || 0,
  })).sort((a, b) => b.at - a.at);
  host.dataset.loaded = '1';
  host.innerHTML = `
    <span style="font-weight:700;color:#8a5a2a;">👑 총괄 관리 — 학급 선택</span>
    <select id="admin-master-class-select" style="min-height:34px;font-size:13px;max-width:100%;">
      ${items.map(c => `<option value="${_escHtml(c.id)}">${_escHtml((c.name || '(이름 없음)') + (c.code ? ' · 코드 ' + c.code : '') + (c.email ? ' — ' + c.email : ''))}</option>`).join('')}
    </select>
    <button type="button" id="admin-master-reset-ai"
      style="min-height:34px;padding:4px 12px;border:1.5px solid #c66f4a;background:#fffaee;color:#c66f4a;border-radius:8px;font-size:12.5px;font-weight:700;cursor:pointer;">
      🔄 이 학급 AI 횟수 리셋</button>
    <button type="button" id="admin-master-send-notice"
      style="min-height:34px;padding:4px 12px;border:1.5px solid #8a5a2a;background:#fffaee;color:#8a5a2a;border-radius:8px;font-size:12.5px;font-weight:700;cursor:pointer;">
      📢 주의 보내기</button>`;
  /* MASTER-M3: 주의 보내기 — 팀 또는 담당 교사에게(notices/{classId}/{대상}) */
  host.querySelector('#admin-master-send-notice')?.addEventListener('click', () => {
    const selEl = host.querySelector('#admin-master-class-select');
    if (selEl && selEl.value) _openMasterNoticeModal(selEl.value);
  });
  /* MASTER-M2: 학급 전체 AI 횟수 리셋 — super_admin 전용 callable(수업 중 무오류 삭제 방식) */
  host.querySelector('#admin-master-reset-ai')?.addEventListener('click', async () => {
    const selEl = host.querySelector('#admin-master-class-select');
    const cid = selEl ? selEl.value : '';
    const label = selEl ? selEl.options[selEl.selectedIndex].textContent : cid;
    if (!cid) return;
    if (!confirm(`[${label}]\n이 학급 모든 팀의 AI 사용 횟수를 리셋할까요?\n(작품 데이터는 건드리지 않아요)`)) return;
    const btn = host.querySelector('#admin-master-reset-ai');
    btn.disabled = true; btn.textContent = '리셋 중...';
    try {
      await firebase.app().functions('asia-northeast3').httpsCallable('adminResetAiUsage')({ classId: cid });
      btn.textContent = '✅ 리셋 완료';
    } catch (e) {
      alert('리셋하지 못했어요: ' + ((e && e.message) || '알 수 없는 오류'));
      btn.textContent = '🔄 이 학급 AI 횟수 리셋';
    } finally {
      btn.disabled = false;
      setTimeout(() => { btn.textContent = '🔄 이 학급 AI 횟수 리셋'; }, 2500);
    }
  });
  const sel = host.querySelector('#admin-master-class-select');
  if (adminState.masterClassId && idx[adminState.masterClassId]) {
    sel.value = adminState.masterClassId;
  } else {
    const own = await _resolveTeacherClassId();
    if (own && idx[own]) sel.value = own;
    adminState.masterClassId = sel.value;
  }
  sel.addEventListener('change', () => {
    adminState.masterClassId = sel.value;
    _invalidateAdminCache('master-class-switch');
    _loadAdminDataV2();
  });
  return true;
}

/* MASTER-M3(2026-07-11): 주의 보내기 모달 — write는 rules상 super_admin만 통과.
   대상 팀 목록 = 현재 로드된 학급의 adminState.allTeams(encodedName=DB 팀 키).
   받는 쪽 표시는 notices.js(수신 배너)가 처리. */
function _openMasterNoticeModal(classId) {
  document.getElementById('admin-master-notice-modal')?.remove();
  const teams = (adminState.allTeams || []).map(t => ({ key: t.encodedName, label: t.name }));
  const wrap = document.createElement('div');
  wrap.id = 'admin-master-notice-modal';
  wrap.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.35);'
    + 'display:flex;align-items:center;justify-content:center;padding:20px;';
  wrap.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:460px;width:100%;padding:18px 20px;box-shadow:0 12px 40px rgba(0,0,0,.25);">
      <div style="font-weight:700;font-size:15px;color:#a4592f;margin-bottom:10px;">📢 주의 보내기</div>
      <label style="font-size:13px;font-weight:700;">받는 대상</label>
      <select id="mn-target" style="display:block;width:100%;min-height:36px;margin:4px 0 10px;font-size:13px;">
        <option value="_teacher">👩‍🏫 담당 교사에게</option>
        ${teams.map(t => `<option value="${_escHtml(t.key)}">${_escHtml(t.label)} 팀에게</option>`).join('')}
      </select>
      <label style="font-size:13px;font-weight:700;">내용 (300자까지)</label>
      <textarea id="mn-text" maxlength="300" rows="4"
        placeholder="예) 친구가 상처받을 수 있는 표현이 보여요. 서로 기분 좋게 읽을 수 있는 글로 고쳐 주세요 🙂"
        style="display:block;width:100%;margin:4px 0 4px;font-size:14px;padding:8px;box-sizing:border-box;border:1px solid #d8c49a;border-radius:8px;"></textarea>
      <div style="font-size:12px;color:#8a6a30;margin-bottom:12px;">받는 쪽이 다음에 화면을 열면 위에 알림 띠로 떠요. [확인했어요]를 누르면 사라져요.</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button type="button" id="mn-cancel" style="min-height:36px;padding:6px 14px;border:1px solid #ccc;border-radius:8px;background:#fff;cursor:pointer;">취소</button>
        <button type="button" id="mn-send" style="min-height:36px;padding:6px 16px;border:none;border-radius:8px;background:#c96f4a;color:#fff;font-weight:700;cursor:pointer;">보내기</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelector('#mn-cancel').addEventListener('click', () => wrap.remove());
  wrap.addEventListener('click', e => { if (e.target === wrap) wrap.remove(); });
  wrap.querySelector('#mn-send').addEventListener('click', async () => {
    const target = wrap.querySelector('#mn-target').value;
    const text = wrap.querySelector('#mn-text').value.trim();
    if (!text) { alert('내용을 적어주세요.'); return; }
    const btn = wrap.querySelector('#mn-send');
    btn.disabled = true; btn.textContent = '보내는 중...';
    try {
      await db.ref(`notices/${classId}/${target}`).push({
        text,
        from: 'master',
        createdAt: firebase.database.ServerValue.TIMESTAMP,
      });
      wrap.remove();
      alert('보냈어요. 받는 쪽이 다음에 화면을 열면 알림 띠가 떠요.');
    } catch (e) {
      btn.disabled = false; btn.textContent = '보내기';
      alert('보내지 못했어요: ' + ((e && e.message) || '알 수 없는 오류'));
    }
  });
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
/* ERR-KO-1(2026-07-10): 목록/상세 로드 실패 → 쉬운 한글 안내.
   err.message의 영어 기술 문구(permission_denied 등)가 innerHTML로 그대로 뜨던 문제.
   우리가 던진 한글 메시지는 그대로 존중. */
function _adminErrText(err) {
  const m = err && err.message;
  if (m && /[가-힣]/.test(m)) return m;
  const raw = String((err && (err.code || err.message)) || '').toLowerCase();
  if (raw.includes('permission') || raw.includes('denied')) return '보기 권한이 없어요. 담당 교사 계정으로 로그인했는지 확인해 주세요.';
  if (/(network|unavailable|timeout|fetch|offline)/.test(raw)) return '인터넷 연결이 불안정해요. 연결을 확인하고 새로고침해 주세요.';
  return '불러오지 못했어요. 잠시 후 새로고침해 주세요.';
}

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
    list.innerHTML = `<div class="admin-error">⚠️ ${_escHtml(_adminErrText(err))}</div>`;
  });
}

/* ── v2: classes/$classId/teams/ 기준 ── */
async function _loadAdminDataV2() {
  const list = document.getElementById('admin-team-list');
  list.innerHTML = '<div class="admin-loading">클래스 정보를 확인하는 중...</div>';

  /* classId 확보 — MASTER-M1: super_admin은 학급 선택 바에서 고른 학급 우선 */
  let resolvedClassId = null;
  const _role = await _getAuthRole();
  if (_role === 'super_admin') {
    const ok = await _renderMasterClassPicker();
    if (ok && adminState.masterClassId) resolvedClassId = adminState.masterClassId;
  }
  if (!resolvedClassId) resolvedClassId = await _resolveTeacherClassId();
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

  /* v94: 클래스 메타 조회 후 헤더 바 표시 (반 이름 + 코드 + 복사 버튼) */
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
      const members  = teamData.members || null;    // ACCOUNT-MEMBER-LIST-1: 입장 기기(멤버) 목록
      return _analyzeTeam(encodedName, scenes, isPublic, meta, account, members);
    });
    /* 2026-06 캐시 기록 — 성공 로드 시각/대상 classId. 다음 60초간 재진입 시 재읽기 생략. */
    adminState.allTeamsLoadedAt = Date.now();
    adminState.cachedClassId    = resolvedClassId;
    _renderSummaryBar(adminState.allTeams);
    _renderFilterBar(adminState.allTeams);
    _renderTeamList();
  }).catch(err => {
    list.innerHTML = `<div class="admin-error">⚠️ ${_escHtml(_adminErrText(err))}</div>`;
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
   · imageS2 = 'AI 그림책 마감'(교사용·활성). imageS1은 폐기(UI 미노출·저장값 보존·마이그레이션 안 함).
   ════════════════════════════════════════════════════════════════ */
/* imageS1(그림 1단계)·textS1(텍스트 1단계 문장 정돈)은 폐기 — 설정 UI 미노출.
   기존 저장값은 보존(state/payload에 유지·마이그레이션 안 함·서버 callable/QUOTA 보존).
   WRITE-AFTER-UI-VISIBLE-FIX: textS1은 작품검사와 역할 중복 → 쓰기 후 활동에서 제거. UI만 숨김.
   imageS2 = 'AI 그림책 마감'(교사용). 마스터 토글은 enabled만 켜고 modes는 개별이라 우발 ON 없음
   (AI_MODE_DEFS에 없는 textS1/imageS1은 마스터로도 신규 ON 안 됨 — 기존 DB값만 보존 재기록). */
const AI_MODE_DEFS = [
  { key: 'writeAfterQuestions', label: '생각 점검 질문', soon: false, badge: '새 기능' },
  { key: 'workCheck',label: '작품 검사',      soon: false },
  { key: 'textS2',   label: 'AI 장면발전',    soon: false },
  { key: 'imageS2',  label: 'AI 그림책 마감', soon: false, badge: '교사용' },
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
      /* textS1·imageS1 = 폐기(UI 미노출). 기존 저장값을 그대로 로드해 보존만 — 저장 시 변경 없이 재기록. */
      textS1:   exists ? !!(saved.modes && saved.modes.textS1)   : false,
      textS2:   exists ? !!(saved.modes && saved.modes.textS2)   : false,
      workCheck:exists ? !!(saved.modes && saved.modes.workCheck): false,
      /* WRITE-AFTER Phase 3: 생각 점검 질문 — 기본 OFF(미저장 시 false). 교사가 명시적으로 켜야 노출. */
      writeAfterQuestions: exists ? !!(saved.modes && saved.modes.writeAfterQuestions) : false,
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
    const badgeTag = d.badge ? `<span class="admin-ai-soon" style="color:#3a5a2a;">${_escHtml(d.badge)}</span>` : '';
    return `<label class="admin-ai-toggle${dis}" data-mode-toggle="${d.key}">
      <input type="checkbox" ${checked} ${disAttr} data-ai-mode="${d.key}">
      ${_escHtml(d.label)}${badgeTag}${soonTag}
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
      <div class="admin-ai-group" style="flex:0 0 100%;margin-bottom:2px;padding:9px 12px;background:#f4f6f2;border:1px solid #dfe6d8;border-radius:10px;">
        <div class="admin-ai-group-title" style="font-weight:700;color:#3a5a2a;font-size:13px;">📁 작품 마무리 활동</div>
        <div class="admin-ai-group-desc" style="margin-top:3px;color:#5f6b57;font-size:12px;line-height:1.5;">작품 마무리 활동은 질문 만들기, 작품 검사, 직접 고치기, 마지막 다듬기를 한 흐름으로 진행해요. 아래에서 켠 기능만 학생에게 보여요.</div>
      </div>
      ${modeToggles}
    </div>
    <div class="admin-ai-head">
      <span class="admin-ai-hint">학생에게는 선생님이 켠 기능만 보이고 사용할 수 있어요. ‘AI 그림책 마감’은 교사용이에요 — 학생 그림이 외부 AI 서비스로 전송될 수 있어 학교 안내·설정 후 사용하세요. 학생에게는 생성 버튼이 보이지 않습니다.</span>
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
      /* textS1·imageS1 = 폐기. UI 없지만 state에서 로드한 기존값을 그대로 재기록(보존·임의 false 금지). */
      textS1:    state.modes.textS1    === true,
      textS2:    state.modes.textS2    === true,
      workCheck: state.modes.workCheck === true,
      writeAfterQuestions: state.modes.writeAfterQuestions === true,
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

  /* AI-PERM-WARN(2026-07-09): '설정이 풀린다'의 실제 원인 방지 — 서버는 enabled AND modes[기능] 둘 다 요구.
     마스터('AI 전체')만 켜고 개별 기능(예: AI 그림책 마감)을 하나도 안 켜면 학생·교사가 권한없음이 됨.
     이 상태로 저장하려 하면 경고(막지는 않음). aiSettings는 이 저장 외엔 어떤 코드도 안 건드림(리셋 없음). */
  const _anyMode = payload.modes && Object.keys(payload.modes).some(k => payload.modes[k] === true);
  if (payload.enabled && !_anyMode) {
    const _go = confirm('‘AI 전체’는 켜졌지만 사용할 기능(예: AI 그림책 마감)이 하나도 안 켜졌어요.\n이대로 저장하면 AI를 쓸 수 없어요(권한 없음으로 표시돼요).\n그래도 저장할까요?');
    if (!_go) return;
  }

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
    console.error('[admin] AI 설정 저장 실패:', err);
    saveBtn.disabled = false;
    saveBtn.textContent = '저장';
    alert('❌ AI 설정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
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

  /* ACCOUNT-MODE-DEFAULT-1: 현재 입장 방식 상태 배지.
     · teacher_managed(신규 학급 기본) → 교사 등록 모둠만 입장.
     · legacy_open(기존 학급 fallback) → 자유 입장 + 전환 가능 안내. 자동 전환하지 않음(교사 선택). */
  const modeBadge = (mode === 'teacher_managed')
    ? '<div class="admin-tm-badge admin-tm-badge--managed">🔒 <b>교사 등록 모둠만 입장</b> — 선생님이 만든 모둠만 들어올 수 있어요.</div>'
    : '<div class="admin-tm-badge admin-tm-badge--open">🚪 <b>자유 입장 상태</b> — 지금은 학생이 새 모둠을 직접 만들 수 있어요. 아래에서 <b>교사 등록 모둠만 입장</b>으로 바꾸면 오타·장난 모둠 생성을 막을 수 있어요.</div>';

  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="admin-tm-head">
      <div class="admin-tm-title">🚪 학생 팀 생성 방식</div>
      <div class="admin-tm-desc">학생이 입장할 때 팀을 직접 만들 수 있게 할지, 선생님이 등록한 팀만 들어오게 할지 정해요.</div>
    </div>
    ${modeBadge}
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
    console.error('[admin] 계정 저장 실패:', err);
    const errMsg = (err && (err.code || err.message)) ? String(err.code || err.message) : '';
    if (/PERMISSION_DENIED|permission[_ ]?denied/i.test(errMsg)) {
      _tcSetStatus(statusEl, 'err', '저장 권한이 없어요. 관리자에게 문의해 주세요.');
    } else {
      _tcSetStatus(statusEl, 'err', '저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
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
      <button id="admin-tc-pin-auto" class="admin-tc-btn admin-tc-btn--ghost" type="button" title="숫자 4자리 PIN을 자동으로 만들어요">🎲 자동</button>
      <button id="admin-tc-create" class="admin-tc-btn">팀 만들기</button>
      <button id="admin-tc-csv" class="admin-tc-btn admin-tc-btn--ghost" type="button" title="CSV 파일(팀이름,PIN) 또는 엑셀 붙여넣기로 여러 모둠을 한 번에 만들어요">📄 CSV로 한꺼번에</button>
    </div>
    <div class="admin-tc-cardrow">
      <button id="admin-tc-manual" class="admin-tc-btn" type="button" title="교사·학생 사용법을 화면에서 자세히 봐요 — 계정 만들기·권한부여부터(처음 하는 분용)">📖 자세한 설명서</button>
      <button id="admin-tc-print-cards" class="admin-tc-btn admin-tc-btn--ghost" type="button" title="등록된 모둠의 클래스 코드·이름·PIN을 카드로 인쇄해요 (학생 배부용)">🖨 입장 카드 인쇄</button>
      <button id="admin-tc-print-manual-student" class="admin-tc-btn admin-tc-btn--ghost" type="button" title="학생이 책상에 두고 보는 작품 만들기 사용법 1장 (배부용)">🖨 사용설명서(학생)</button>
      <button id="admin-tc-print-manual-teacher" class="admin-tc-btn admin-tc-btn--ghost" type="button" title="교사 수업 준비 가이드 1장 (로그인·계정·인쇄·점검)">🖨 준비 가이드(교사)</button>
    </div>
    <div id="admin-tc-status" class="admin-tc-status"></div>
  `;
  const nameEl   = document.getElementById('admin-tc-name');
  const pinEl    = document.getElementById('admin-tc-pin');
  const btn      = document.getElementById('admin-tc-create');
  const autoBtn  = document.getElementById('admin-tc-pin-auto');
  const printBtn = document.getElementById('admin-tc-print-cards');
  const statusEl = document.getElementById('admin-tc-status');
  if (!btn) return;
  btn.addEventListener('click', () => _createTeamAccount(classId, nameEl, pinEl, btn, statusEl));
  /* TEAM-ACCOUNT-CARD-1: PIN 자동 채우기 — 입력란에 값만 넣음(저장은 '팀 만들기'에서). */
  if (autoBtn) autoBtn.addEventListener('click', () => {
    if (pinEl) { pinEl.value = _genPin(_knownAccountPins()); pinEl.focus(); }
  });
  if (printBtn) printBtn.addEventListener('click', () => _printEntryCards(classId));
  /* CSV-BULK-1: CSV/붙여넣기 일괄 생성 오버레이. */
  const csvBtn = document.getElementById('admin-tc-csv');
  if (csvBtn) csvBtn.addEventListener('click', () => _openCsvBulkOverlay(classId));
  /* TUTORIAL-PRD Phase C/D: 정적 사용설명서 인쇄(학생 1장·교사 1장). 모듈 미로드 시 안내. */
  const manualS = document.getElementById('admin-tc-print-manual-student');
  const manualT = document.getElementById('admin-tc-print-manual-teacher');
  const _tp = (fn) => {
    if (window.TutorialPrint && typeof window.TutorialPrint[fn] === 'function') window.TutorialPrint[fn]();
    else alert('사용설명서 인쇄 기능을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.');
  };
  if (manualS) manualS.addEventListener('click', () => _tp('printStudent'));
  if (manualT) manualT.addEventListener('click', () => _tp('printTeacher'));
  /* ADMIN-REDESIGN Phase 3: 화면형 상세 설명서(교사 계정 만들기·권한부여부터). */
  const manualDetail = document.getElementById('admin-tc-manual');
  if (manualDetail) manualDetail.addEventListener('click', () => {
    if (window.AdminManual && typeof window.AdminManual.open === 'function') window.AdminManual.open('teacher');
    else alert('설명서를 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.');
  });
  [nameEl, pinEl].forEach(el => el && el.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return; /* CROSS-A: 한글 IME 조합 중 Enter 가드 */
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
    console.error('[admin] 팀 만들기 실패:', err);
    const errMsg = (err && (err.code || err.message)) ? String(err.code || err.message) : '';
    if (/PERMISSION_DENIED|permission[_ ]?denied/i.test(errMsg)) {
      _tcSetStatus(statusEl, 'err', '아직 팀을 만들 수 없어요. 관리자에게 문의해 주세요.');
    } else {
      _tcSetStatus(statusEl, 'err', '팀을 만들지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
    btn.disabled = false; btn.textContent = prevLabel;
  }
}

/* ════════════════════════════════════════════════════════════════
   CSV-BULK-1: CSV 업로드/붙여넣기로 학생(모둠) 계정 일괄 생성
   ──────────────────────────────────────────────────────────────
   · 단일 생성(_createTeamAccount)과 완전히 같은 정책: 검증(이름 1~30자,
     PIN 숫자 4~6자리), teamKey=encodeURIComponent(이름), 팀 노드 존재 시 건너뜀,
     account child만 set(scenes/viewer-meta/pin 등 미접근). Rules 변경 불필요.
   · 형식: "팀이름,PIN" 한 줄에 하나. PIN 비우면 자동 생성(🎲). 머리글 행 자동 감지.
   · 한국 Excel CSV는 CP949(EUC-KR)가 흔함 → UTF-8 해석 실패 시 euc-kr로 재해석.
   · Excel이 "0123" 같은 PIN의 앞 0을 지워 3자리가 되는 사고 → 자동 보정하지 않고
     행 오류로 알림(교사 의도 확인이 안전).
   · 흐름: 파일/붙여넣기 → 미리보기 표(행별 상태) → 만들기(행별 순차 쓰기+진행 표시)
     → 결과 요약 + 입장 카드 인쇄 연결. 만들기 전에는 DB 접근 0.
   ════════════════════════════════════════════════════════════════ */
const _CSV_BULK_MAX_ROWS = 60;

/* UTF-8(fatal) → 실패 시 EUC-KR. BOM 제거. */
function _csvDecodeBuffer(buf) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (e) {
    try { text = new TextDecoder('euc-kr').decode(buf); }
    catch (e2) { text = new TextDecoder('utf-8').decode(buf); }
  }
  return text.replace(/^﻿/, '');
}

/* 한 줄을 delimiter 기준으로 분할 — 큰따옴표 필드("a,b" / "" 이스케이프) 지원. */
function _csvSplitLine(line, delim) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === delim) {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

/* 텍스트 → 행 목록. 각 행 {name, pin, autoPin, status:'ready'|'exists'|'error', reason}.
   status는 미리보기용 사전 판정 — 실제 쓰기 때 존재 여부를 서버에서 다시 확인한다. */
function _parseTeamsCsv(text) {
  const rawLines = String(text || '').split(/\r\n|\r|\n/);
  const rows = [];
  const seenNames = new Set();
  const existingNames = new Set((adminState.allTeams || []).map(t => t && t.name).filter(Boolean));
  const usedPins = _knownAccountPins().slice();
  let headerSkipped = false;

  for (const raw of rawLines) {
    if (!raw || !raw.trim()) continue;
    /* delimiter: 탭 우선(엑셀 복사-붙여넣기) → 쉼표 → 세미콜론 → 한 칸 이름만 */
    const delim = raw.includes('\t') ? '\t' : (raw.includes(',') ? ',' : (raw.includes(';') ? ';' : null));
    const fields = delim ? _csvSplitLine(raw, delim) : [raw.trim()];
    const name = (fields[0] || '').trim();
    const pinRaw = (fields[1] || '').trim();

    /* 머리글 행 감지(첫 데이터 행에서 1회): 이름 칸이 팀/이름/모둠/name 이고
       PIN 칸이 비었거나 숫자가 아니면 머리글로 보고 건너뜀. */
    if (!headerSkipped && rows.length === 0) {
      headerSkipped = true;
      if (/^(팀|모둠|이름|팀\s*이름|모둠\s*이름|name)/i.test(name) && (!pinRaw || !/^[0-9]+$/.test(pinRaw))) continue;
    }

    if (rows.length >= _CSV_BULK_MAX_ROWS) {
      rows.push({ name, pin: '', autoPin: false, status: 'error', reason: `한 번에 ${_CSV_BULK_MAX_ROWS}개까지만 만들 수 있어요.` });
      break;
    }

    const row = { name, pin: pinRaw, autoPin: false, status: 'ready', reason: '' };

    if (!name) { row.status = 'error'; row.reason = '팀 이름이 비어 있어요.'; rows.push(row); continue; }
    if (name.length > 30) { row.status = 'error'; row.reason = '팀 이름은 30자 이내여야 해요.'; rows.push(row); continue; }
    /* RTDB 키 안전: encodeURIComponent가 '.'은 남겨서 키 오류가 남 → 사전 차단. */
    if (name.includes('.')) { row.status = 'error'; row.reason = "팀 이름에 '.'(마침표)는 쓸 수 없어요."; rows.push(row); continue; }
    if (seenNames.has(name)) { row.status = 'error'; row.reason = '파일 안에 같은 이름이 또 있어요.'; rows.push(row); continue; }
    seenNames.add(name);

    if (!pinRaw) {
      row.pin = _genPin(usedPins);
      row.autoPin = true;
    } else if (/^[0-9]{1,3}$/.test(pinRaw)) {
      row.status = 'error';
      row.reason = `PIN이 ${pinRaw.length}자리예요 — 엑셀이 앞의 0을 지웠을 수 있어요. 4자리로 다시 적어주세요.`;
      rows.push(row); continue;
    } else if (!/^[0-9]{4,6}$/.test(pinRaw)) {
      row.status = 'error'; row.reason = 'PIN은 숫자 4~6자리여야 해요.';
      rows.push(row); continue;
    }
    usedPins.push(row.pin);

    if (existingNames.has(name)) { row.status = 'exists'; row.reason = '이미 있는 팀 — 건너뛰어요.'; }
    rows.push(row);
  }
  return rows;
}

/* 서식 CSV 내려받기 — BOM 포함 UTF-8(한국 엑셀에서 바로 열림). */
function _csvTemplateDownload() {
  const csv = '﻿팀이름,PIN\n1모둠,1234\n2모둠,\n3모둠,5678\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '가지_모둠_계정_서식.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function _csvBulkStyleTag() {
  if (document.getElementById('admin-csv-style')) return;
  const st = document.createElement('style');
  st.id = 'admin-csv-style';
  st.textContent = `
    #admin-csv-overlay{position:fixed;inset:0;z-index:100050;background:rgba(40,30,15,0.45);display:flex;align-items:center;justify-content:center;padding:18px;}
    #admin-csv-overlay .acsv-card{background:#fffdf7;border:1px solid #e6d8bb;border-radius:16px;max-width:640px;width:100%;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 18px 50px rgba(60,40,15,0.3);font-family:inherit;color:#4a3a22;}
    #admin-csv-overlay .acsv-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid #eee0c8;}
    #admin-csv-overlay .acsv-title{font-size:16px;font-weight:800;color:#3a2c14;flex:1;}
    #admin-csv-overlay .acsv-body{padding:14px 18px;overflow:auto;display:flex;flex-direction:column;gap:12px;}
    #admin-csv-overlay .acsv-hint{font-size:12.5px;color:#8a7350;line-height:1.55;}
    #admin-csv-overlay .acsv-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
    #admin-csv-overlay .acsv-paste{width:100%;min-height:88px;border:1px solid #d9c39a;border-radius:10px;padding:8px 10px;font-size:13px;font-family:inherit;color:#4a3a22;background:#fff;resize:vertical;}
    #admin-csv-overlay .acsv-table{width:100%;border-collapse:collapse;font-size:13px;}
    #admin-csv-overlay .acsv-table th,#admin-csv-overlay .acsv-table td{border-bottom:1px solid #eee0c8;padding:6px 8px;text-align:left;}
    #admin-csv-overlay .acsv-table th{color:#8a6a30;font-size:12px;}
    #admin-csv-overlay .acsv-st--ready{color:#3f7d3a;font-weight:700;}
    #admin-csv-overlay .acsv-st--exists{color:#a07a20;}
    #admin-csv-overlay .acsv-st--error{color:#b3452e;}
    #admin-csv-overlay .acsv-st--done{color:#3f7d3a;font-weight:700;}
    #admin-csv-overlay .acsv-st--fail{color:#b3452e;font-weight:700;}
    #admin-csv-overlay .acsv-pin--auto{color:#8a6a30;}
    #admin-csv-overlay .acsv-foot{display:flex;gap:8px;justify-content:flex-end;align-items:center;padding:12px 18px;border-top:1px solid #eee0c8;flex-wrap:wrap;}
    #admin-csv-overlay .acsv-summary{margin-right:auto;font-size:13px;color:#4a3a22;font-weight:700;}
  `;
  document.head.appendChild(st);
}

function _openCsvBulkOverlay(classId) {
  if (!adminState.verified || !classId) return;
  _csvBulkStyleTag();
  const prev = document.getElementById('admin-csv-overlay');
  if (prev) prev.remove();

  const ov = document.createElement('div');
  ov.id = 'admin-csv-overlay';
  ov.innerHTML = `
    <div class="acsv-card" role="dialog" aria-modal="true" aria-label="CSV로 모둠 한꺼번에 만들기">
      <div class="acsv-head">
        <div class="acsv-title">📄 CSV로 모둠 한꺼번에 만들기</div>
        <button type="button" class="admin-tc-btn admin-tc-btn--ghost" data-act="close">닫기</button>
      </div>
      <div class="acsv-body">
        <div class="acsv-hint">
          한 줄에 <b>팀이름,PIN</b> 순서로 적어주세요. PIN을 비우면 자동으로 만들어 드려요.<br>
          엑셀에서 두 열(이름·PIN)을 복사해 아래 칸에 붙여넣어도 돼요. 한 번에 ${_CSV_BULK_MAX_ROWS}개까지.
        </div>
        <div class="acsv-row">
          <button type="button" class="admin-tc-btn admin-tc-btn--ghost" data-act="template">📄 서식(CSV) 내려받기</button>
          <button type="button" class="admin-tc-btn" data-act="file">📂 CSV 파일 선택</button>
        </div>
        <textarea class="acsv-paste" data-el="paste" placeholder="또는 여기에 붙여넣기:&#10;1모둠,1234&#10;2모둠,&#10;3모둠,5678"></textarea>
        <div class="acsv-row">
          <button type="button" class="admin-tc-btn admin-tc-btn--ghost" data-act="parse">👀 미리보기</button>
        </div>
        <div data-el="preview"></div>
      </div>
      <div class="acsv-foot">
        <div class="acsv-summary" data-el="summary"></div>
        <button type="button" class="admin-tc-btn admin-tc-btn--ghost" data-act="print" style="display:none;">🖨 입장 카드 인쇄</button>
        <button type="button" class="admin-tc-btn" data-act="run" style="display:none;">만들기</button>
      </div>
    </div>`;
  document.body.appendChild(ov);

  const $ = (sel) => ov.querySelector(sel);
  const previewEl = $('[data-el="preview"]');
  const summaryEl = $('[data-el="summary"]');
  const runBtn    = $('[data-act="run"]');
  const printBtn  = $('[data-act="print"]');
  let rows = [];
  let running = false;

  function close() { if (running) { if (!confirm('만들기가 진행 중이에요. 정말 닫을까요?')) return; } ov.remove(); }
  $('[data-act="close"]').addEventListener('click', close);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  document.addEventListener('keydown', function onEsc(ev) {
    if (ev.key === 'Escape') { const o = document.getElementById('admin-csv-overlay'); if (o && !running) o.remove(); if (!o) document.removeEventListener('keydown', onEsc); }
  });

  $('[data-act="template"]').addEventListener('click', _csvTemplateDownload);

  $('[data-act="file"]').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv,.txt,text/plain';
    input.style.display = 'none';
    input.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const buf = await file.arrayBuffer();
        $('[data-el="paste"]').value = _csvDecodeBuffer(buf);
        renderPreview();
      } catch (err) {
        summaryEl.textContent = '파일을 읽지 못했어요. CSV(텍스트) 파일인지 확인해 주세요.';
      }
    });
    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 1000);
  });

  $('[data-act="parse"]').addEventListener('click', renderPreview);

  function renderPreview() {
    rows = _parseTeamsCsv($('[data-el="paste"]').value);
    if (!rows.length) {
      previewEl.innerHTML = '';
      summaryEl.textContent = '읽을 내용이 없어요. 파일을 선택하거나 붙여넣어 주세요.';
      runBtn.style.display = 'none';
      return;
    }
    const stLabel = { ready: '✓ 만들 준비', exists: '⚠ 이미 있음', error: '✗ 오류' };
    previewEl.innerHTML = `
      <table class="acsv-table">
        <thead><tr><th>#</th><th>팀 이름</th><th>PIN</th><th>상태</th></tr></thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr data-row="${i}">
              <td>${i + 1}</td>
              <td>${_escHtml(r.name)}</td>
              <td>${_escHtml(r.pin)}${r.autoPin ? ' <span class="acsv-pin--auto">🎲자동</span>' : ''}</td>
              <td class="acsv-st acsv-st--${r.status}">${stLabel[r.status]}${r.reason ? ' — ' + _escHtml(r.reason) : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    const readyN = rows.filter(r => r.status === 'ready').length;
    const existsN = rows.filter(r => r.status === 'exists').length;
    const errN = rows.filter(r => r.status === 'error').length;
    summaryEl.textContent = `만들 팀 ${readyN}개` + (existsN ? ` · 건너뜀 ${existsN}` : '') + (errN ? ` · 오류 ${errN}` : '');
    runBtn.style.display = readyN ? '' : 'none';
    runBtn.textContent = `${readyN}개 팀 만들기`;
    printBtn.style.display = 'none';
  }

  runBtn.addEventListener('click', async () => {
    if (running) return;
    const targets = rows.map((r, i) => ({ ...r, idx: i })).filter(r => r.status === 'ready');
    if (!targets.length) return;
    running = true;
    runBtn.disabled = true;
    runBtn.textContent = '만드는 중...';
    const uid = (typeof auth !== 'undefined' && auth.currentUser) ? auth.currentUser.uid : null;
    let created = 0, skipped = 0, failed = 0;

    for (const t of targets) {
      const cell = previewEl.querySelector(`tr[data-row="${t.idx}"] .acsv-st`);
      try {
        const teamKey = encodeURIComponent(t.name);
        const teamRef = db.ref(`classes/${classId}/teams/${teamKey}`);
        /* 단일 생성과 동일: 팀 노드가 이미 있으면 건드리지 않고 건너뜀(안전 우선). */
        const snap = await teamRef.once('value');
        if (snap.exists()) {
          skipped++;
          if (cell) { cell.className = 'acsv-st acsv-st--exists'; cell.textContent = '⚠ 이미 있음 — 건너뜀'; }
          continue;
        }
        const now = Date.now();
        await teamRef.child('account').set({
          displayName: t.name,
          pin: t.pin,
          status: 'active',
          createdBy: uid,
          createdAt: now,
          updatedAt: now,
        });
        created++;
        if (cell) { cell.className = 'acsv-st acsv-st--done'; cell.textContent = '✓ 만들었어요'; }
        /* 입장 카드 인쇄 브릿지: 목록 새로고침 전에도 인쇄에 잡히도록 최소 필드만 반영.
           (_printEntryCards는 registered/accountName/accountPin/name만 사용.
            목록 렌더는 loadAdminData가 서버 데이터로 전체 교체하므로 화면 영향 없음.) */
        if (Array.isArray(adminState.allTeams) && !adminState.allTeams.some(x => x && x.name === t.name)) {
          adminState.allTeams.push({ name: t.name, registered: true, accountName: t.name, accountPin: t.pin, accountStatus: 'active' });
        }
      } catch (err) {
        console.error('[admin] CSV 팀 생성 실패:', t.name, err);
        failed++;
        const msg = /PERMISSION_DENIED|permission[_ ]?denied/i.test(String((err && (err.code || err.message)) || ''))
          ? '권한 없음' : '실패';
        if (cell) { cell.className = 'acsv-st acsv-st--fail'; cell.textContent = `✗ ${msg}`; }
      }
    }

    running = false;
    runBtn.textContent = '완료';
    summaryEl.textContent = `✓ ${created}개 만듦` + (skipped ? ` · 건너뜀 ${skipped}` : '') + (failed ? ` · 실패 ${failed}` : '');
    if (created) printBtn.style.display = '';
    _invalidateAdminCache('csv-bulk-create');
    loadAdminData();
  });

  printBtn.addEventListener('click', () => _printEntryCards(classId));
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
function _analyzeTeam(encodedName, scenes, isPublic = false, meta = {}, account = null, members = null) {
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
     · legacy fallback — choiceCount가 명시된 경우에만 사용
     · 저장 구조 변경 없음 — 읽기 전용
     2026-05-29 admin 3차 fix: choiceCount default 2 가정 폐기 —
     buttons도 없고 choiceCount도 없는 빈/옛 장면이 미연결 2개로
     과표시되는 위험 차단. choiceCount가 명시된 경우에만 fallback 적용. */
  function _unconnectedButtonsCount(s) {
    if (!s) return 0;
    if (s.type === 'ending' || s.type === 'cover' || s.isCover) return 0;
    if (Array.isArray(s.buttons) && s.buttons.length > 0) {
      return s.buttons.filter(b => !b || !b.nextId).length;
    }
    /* legacy fallback — choiceCount가 명시된 경우에만 적용. 없으면 0. */
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
     · 장면별 _unconnectedButtonsCount 결과를 합산 (표지/엔딩은 함수 내부에서 0 처리) */
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
    /* 2026-05-29 admin 3차: 미연결 버튼 수를 ctx에 포함 — _listProblems에서 사용 */
    unconnectedButtons,
  };
  const status         = _classifyStatus(ctx);
  const interpretation = _makeInterpretation(status, ctx);
  const problems       = _listProblems(ctx);

  /* 2026-05-29 admin 1차: 작품 모드(projectType) 판별.
     · viewer-meta/projectType 값을 읽음 — 4종 화이트리스트 외 값은 미선택/알 수 없음
     · 읽기 전용 — Firebase 쓰기 없음 */
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
    /* 2026-05-29 admin 3차: 미연결 버튼 수 — 카드 배지 + problems 표시에 사용 */
    unconnectedButtons,
    /* ADMIN-1B: 교사 사전 등록(account) 여부/상태 — 카드 배지 표시용 */
    registered:    !!account,
    accountStatus: (account && account.status) ? account.status : null,
    /* TEAM-ACCOUNT-CARD-1: 입장 카드 인쇄·PIN 자동생성 중복회피용. 담당 교사만 read되는 값
       (rules)이라 admin 세션 메모리에만 보관 — 카드/배지 등 일반 렌더엔 노출 안 함. */
    accountName:   (account && account.displayName) ? account.displayName : null,
    accountPin:    (account && account.pin != null) ? String(account.pin) : null,
    /* ACCOUNT-MEMBER-LIST-1: 입장한 기기(멤버) 목록. members/{uid}={joinedAt,lastVerifiedAt,
       authType,status,...}·개인정보(이름/PIN/기기ID) 없음. teams .read(교사)로 이미 로드됨(rules 무변경).
       count=active 기기 수, list=상세 표시용(최근 입장순·uid는 노출 안 하고 순번만). */
    ..._summarizeMembers(members),
  };
}

/* ACCOUNT-MEMBER-LIST-1: members 노드 → { memberCount, memberList } 요약(pure). */
function _summarizeMembers(members) {
  if (!members || typeof members !== 'object') return { memberCount: 0, memberList: [] };
  const list = Object.keys(members).map(uid => {
    const m = members[uid] || {};
    return {
      status: m.status || null,
      authType: m.authType || null,
      joinedAt: (typeof m.joinedAt === 'number') ? m.joinedAt : null,
      lastVerifiedAt: (typeof m.lastVerifiedAt === 'number') ? m.lastVerifiedAt : null,
    };
  });
  const active = list.filter(m => m.status === 'active');
  active.sort((a, b) => (b.lastVerifiedAt || 0) - (a.lastVerifiedAt || 0));
  return { memberCount: active.length, memberList: active };
}

/* TEAM-ACCOUNT-CARD-1: PIN 자동 생성 — 4자리 숫자(앞자리 0 허용, 문자열). 같은 학급에 이미
   쓰이는 PIN은 best-effort 회피(팀별 PIN이라 중복이 치명적이진 않지만 교사 혼동 방지).
   PIN은 팀명과 함께여야 입장하므로 유일성은 필수 아님. */
function _genPin(existingPins) {
  const used = new Set(Array.isArray(existingPins) ? existingPins.filter(Boolean).map(String) : []);
  for (let i = 0; i < 40; i++) {
    let p = '';
    for (let d = 0; d < 4; d++) p += String(Math.floor(Math.random() * 10));
    if (!used.has(p)) return p;
  }
  /* 40회 내 미충돌 실패(사실상 없음) — 그냥 마지막 값 반환 */
  let p = '';
  for (let d = 0; d < 4; d++) p += String(Math.floor(Math.random() * 10));
  return p;
}

/* 현재 학급의 이미 등록된 PIN 목록(있으면) — 자동생성 중복회피·카드 인쇄에 재사용. */
function _knownAccountPins() {
  return (adminState.allTeams || []).map(t => t && t.accountPin).filter(Boolean);
}

/* TEAM-ACCOUNT-CARD-1: 입장 카드 인쇄 — 등록 팀(account 있는 팀)의 클래스 코드·모둠 이름·PIN을
   카드로 인쇄한다. DB write 0(admin 메모리 값만 사용)·기존 인쇄 게이트 패턴 재사용(body 클래스 +
   전용 root + @media print 주입 스타일, afterprint 정리). PIN은 담당 교사만 read되는 값이라
   화면 카드엔 안 나오고 이 인쇄물에만 나온다. */
function _printEntryCards(classId) {
  const code = adminState.adminClassCode || '';
  const className = adminState.adminClassName || '';
  const teams = (adminState.allTeams || []).filter(t => t && t.registered && t.accountPin);
  if (!teams.length) {
    alert('인쇄할 등록 팀이 없어요. 먼저 "학생/팀 계정 미리 만들기"로 모둠을 등록해 주세요.');
    return;
  }
  /* 정렬 — 화면 목록과 무관하게 이름 오름차순(교사 배부 편의). */
  teams.sort((a, b) => String(a.accountName || a.name || '').localeCompare(String(b.accountName || b.name || ''), 'ko'));

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const cardsHtml = teams.map(t => `
    <div class="aec-card">
      <div class="aec-brand">🌿 가지 — 작품 만들기 입장 카드</div>
      <div class="aec-team">${esc(t.accountName || t.name)}</div>
      <div class="aec-row"><span class="aec-k">클래스 코드</span><span class="aec-v">${esc(code)}</span></div>
      <div class="aec-row"><span class="aec-k">모둠 이름</span><span class="aec-v">${esc(t.accountName || t.name)}</span></div>
      <div class="aec-row"><span class="aec-k">비밀번호(PIN)</span><span class="aec-v aec-pin">${esc(t.accountPin)}</span></div>
      <div class="aec-hint">작품 만들기 화면에서 클래스 코드·모둠 이름·비밀번호(PIN)를 입력해요.</div>
    </div>`).join('');

  /* 명단(한눈에 확인용) — 카드 뒤 페이지에 표 */
  const rosterRows = teams.map(t =>
    `<tr><td>${esc(t.accountName || t.name)}</td><td>${esc(code)}</td><td class="aec-pin">${esc(t.accountPin)}</td></tr>`).join('');

  const prev = document.getElementById('admin-entry-cards-root');
  if (prev) prev.remove();
  const root = document.createElement('div');
  root.id = 'admin-entry-cards-root';
  root.className = 'admin-entry-cards-root';
  root.innerHTML = `
    <div class="aec-page">
      <div class="aec-doc-title">입장 카드 — ${esc(className || code)}</div>
      <div class="aec-grid">${cardsHtml}</div>
    </div>
    <div class="aec-page aec-roster-page">
      <div class="aec-doc-title">모둠 명단 (${teams.length})</div>
      <table class="aec-roster"><thead><tr><th>모둠 이름</th><th>클래스 코드</th><th>PIN</th></tr></thead><tbody>${rosterRows}</tbody></table>
    </div>`;
  document.body.appendChild(root);

  /* 인쇄 게이트 스타일 — 주입식(다른 화면 무영향), afterprint에 root와 함께 제거. */
  const style = document.createElement('style');
  style.id = 'admin-entry-cards-style';
  style.textContent = `
    #admin-entry-cards-root { display: none; }
    @media print {
      body.admin-print-cards > *:not(#admin-entry-cards-root) { display: none !important; }
      body.admin-print-cards #admin-entry-cards-root { display: block; }
      #admin-entry-cards-root { color: #1a1208; font-family: 'Jua', sans-serif; }
      .aec-page { page-break-after: always; padding: 6mm; }
      .aec-page:last-child { page-break-after: auto; }
      .aec-doc-title { font-size: 15pt; font-weight: 700; margin-bottom: 6mm; }
      .aec-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
      .aec-card { border: 1.5px dashed #b08d57; border-radius: 8px; padding: 6mm 5mm; break-inside: avoid; }
      .aec-brand { font-size: 10pt; color: #6b5638; }
      .aec-team { font-size: 17pt; font-weight: 700; margin: 2mm 0 4mm; }
      .aec-row { display: flex; justify-content: space-between; font-size: 12pt; padding: 1.5mm 0; border-bottom: 1px solid #eadfce; }
      .aec-k { color: #6b5638; }
      .aec-v { font-weight: 700; }
      .aec-pin { letter-spacing: 2px; font-size: 15pt; }
      .aec-hint { font-size: 9.5pt; color: #7a6a50; margin-top: 4mm; line-height: 1.5; }
      .aec-roster { width: 100%; border-collapse: collapse; font-size: 12pt; }
      .aec-roster th, .aec-roster td { border: 1px solid #cbb994; padding: 2.5mm 3mm; text-align: left; }
      .aec-roster th { background: #f6efe0; }
    }`;
  document.head.appendChild(style);

  const cleanup = () => {
    document.body.classList.remove('admin-print-cards');
    const r = document.getElementById('admin-entry-cards-root');
    const s = document.getElementById('admin-entry-cards-style');
    if (r) r.remove();
    if (s) s.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  try {
    document.body.classList.add('admin-print-cards');
    window.addEventListener('afterprint', cleanup);
    window.print();
    setTimeout(cleanup, 2000);   /* afterprint 미발화 브라우저 방어 */
  } catch (e) { cleanup(); }
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
     1 이상일 때만 표시 — 0이면 생략 (불필요 경고 차단). */
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
  /* 2026-05-29 admin 2차: 모드 필터 — 상태 필터와 AND 결합. 미선택 상태면 모든 모드. */
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
     · 'all'    → 모든 모드 통과 (필터 미적용)
     · 'unset'  → projectType이 없는 팀만 (빈 문자열 포함)
     · 그 외   → projectType이 정확히 일치하는 팀만 */
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
    /* 2026-05-29 admin 4차: 문제 우선 정렬 — status 비교 후 추가 우선순위 적용.
       · 같은 status끼리는 문제가 많은 팀이 먼저 오도록 정렬
       · 우선순위: status → 미연결 버튼 수 → problems.length → isolated → connectivity(낮은 게 먼저) → 이름순
       · undefined 값이 비교를 깨지 않게 안전망 유지 (`|| 0`)
       · name/scenes 정렬은 기존 그대로 — status 정렬에만 한정 */
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
  /* 2026-05-29 admin 1차: 작품 모드 배지 — 카드 첫 자리에 표시 (가장 자주 확인하는 정보).
     모드가 설정돼 있을 때만 표시 — 미선택은 생략 (시각 잡음 차단). */
  if (t.projectType) badges.push(`<span class="admin-badge admin-badge--mode">📚 ${_escHtml(t.modeLabel)}</span>`);
  /* ADMIN-1B: 교사 사전 등록 팀 배지 (account 존재 시). 상태 locked면 잠김 표시. */
  if (t.registered) badges.push(t.accountStatus === 'locked'
    ? '<span class="admin-badge admin-badge--locked">🔒 잠김</span>'
    : '<span class="admin-badge admin-badge--registered">✅ 등록됨</span>');
  /* LEGACY-MEMBERSHIP-UX-1: 작업 흔적(장면)은 있는데 입장 기록(members)이 없는 팀 = 오래된 팀.
     학생이 결과 보기/저장에서 막힐 수 있음 → 모둠 비밀번호로 다시 입장하면 최신화(자연 백필). */
  if (t.total > 0 && t.memberCount === 0)
    badges.push('<span class="admin-badge admin-badge--legacy" title="이 모둠은 입장 기록이 오래됐어요. 학생이 모둠 이름·비밀번호(PIN)로 다시 들어오면 최신 상태가 되고, 결과 보기·저장도 정상 동작해요.">⏳ 입장 기록 오래됨</span>');
  if (t.trueEnds > 0) badges.push('<span class="admin-badge admin-badge--true">⭐ 진엔딩</span>');
  if (t.hasImage)     badges.push('<span class="admin-badge admin-badge--img">🖼 이미지</span>');
  if (t.status === 'in-progress' && t.total > 0)
    badges.push(`<span class="admin-badge admin-badge--conn">연결 ${t.connectivity}%</span>`);
  /* 2026-05-29 admin 3차: 미연결 버튼 배지 — 1 이상일 때만 표시.
     status와 무관하게 표시 — ready 상태여도 미연결 버튼이 남아 있을 수 있음. */
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
  /* DELETE-SAFETY-2: 삭제 위험도 3단 — ①🔒잠금(일상·되돌리기 쉬움) ②🧹계정만 삭제(작품 보존·
     입장만 차단·되돌리기 = 같은 이름 재등록) ③🗑모둠 전체 삭제(작품까지 소멸·위험 톤·재입력 강확인). */
  const accountMenuItems = t.registered
    ? `<button class="admin-more-item js-admin-pin" data-encoded="${t.encodedName}" data-name="${t.name}">🔑 PIN 변경</button>
      ${t.accountStatus === 'locked'
        ? `<button class="admin-more-item js-admin-lock" data-encoded="${t.encodedName}" data-name="${t.name}" data-status="locked">🔓 잠금 해제</button>`
        : `<button class="admin-more-item js-admin-lock" data-encoded="${t.encodedName}" data-name="${t.name}" data-status="active">🔒 잠금</button>`}
      <button class="admin-more-item js-admin-account-del" data-encoded="${t.encodedName}" data-name="${t.name}" title="입장 계정(이름·PIN)만 지워요. 작품(장면·그림)은 그대로 남아요.">🧹 계정만 삭제 (작품 보존)</button>`
    : `<button class="admin-more-item js-admin-register" data-encoded="${t.encodedName}" data-name="${t.name}">🧩 관리팀으로 등록</button>`;

  const moreBtn   = `<button class="admin-action-btn admin-action-btn--more js-admin-more" title="더 보기">⋯</button>
    <div class="admin-more-menu" style="display:none;">
      ${accountMenuItems}
      ${t.total > 0
        ? `<button class="admin-more-item js-admin-print" data-name="${t.name}" title="장면 무대 그대로 그림책처럼 인쇄해요 (그림책 작품용)">🖨 그림책 인쇄</button>`
        : `<button class="admin-more-item" disabled style="opacity:0.45;cursor:default;" title="아직 장면이 없어서 인쇄할 수 없어요">🖨 그림책 인쇄</button>`}
      <button class="admin-more-item js-admin-print-wa" data-name="${t.name}" title="이 모둠의 생각 점검 질문·작품 검사 결과를 인쇄해요 (학생 태블릿엔 프린터가 없어 교사가 대신 인쇄)">🖨 고쳐쓰기 자료 인쇄</button>
      <button class="admin-more-item js-admin-print-tc" data-name="${t.name}" title="이 모둠의 생각 나침반 설계도를 열어 인쇄해요 (카드형/나침반형)">🖨 생각 나침반 인쇄</button>
      <button class="admin-more-item js-admin-issue-code" data-encoded="${t.encodedName}" data-name="${t.name}">📤 복사 코드 발급</button>
      <button class="admin-more-item admin-more-item--danger js-admin-delete" data-encoded="${t.encodedName}" data-name="${t.name}" title="작품(장면·그림)까지 영구 삭제해요. 되돌릴 수 없어요.">🗑 모둠 전체 삭제 (작품까지)</button>
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
  /* ADMIN-TEACHER-JOIN(2026-07-09): tauth=1 — 로그인 교사는 maker에서 PIN 없이 자동 입장(편집).
     classId가 있어야 서버 교사 판별(meta/teacher_uid)이 가능 → classId 있을 때만 마커. 없으면 기존 PIN 폼. */
  const _tauth = adminState.adminClassId ? '&tauth=1' : '';
  /* maker 열기 — return context 저장 불필요 (maker가 viewer 열 때 자기가 저장) */
  const _murl = `maker.html?team=${encodeURIComponent(teamName)}${cid}${_tauth}`;
  /* 항상 같은 창 이동 (ui.js _openInternalUrl). */
  if (typeof _openInternalUrl === 'function') _openInternalUrl(_murl);
  else window.location.href = _murl;
}

function _openViewer(teamName, extraQuery) {
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
  const _vurl = `viewer.html?team=${encodeURIComponent(teamName)}${cid}&from=maker${extraQuery || ''}`;
  /* 항상 같은 창 이동 (opener 없어도 source='admin' ctx로 정확 복귀). */
  if (typeof _openInternalUrl === 'function') _openInternalUrl(_vurl);
  else window.location.href = _vurl;
}

/* TEACHER-PRINT-ROUTE-1: 해당 팀의 생각 나침반 결과보기를 관리모드에서 바로 연다.
   maker.html 안이라 thought-compass 모듈이 이미 로드돼 있고, writingGuide read는 담당 교사에게
   rules로 허용됨. fromAdmin=true → review/rose 인쇄 버튼이 안내 모달 없이 바로 인쇄 실행. */
function _openCompassReviewForTeam(teamName) {
  const classId = adminState.adminClassId;
  if (!classId || !teamName) return;
  if (!(window.ThoughtCompassReview && typeof window.ThoughtCompassReview.openReadOnly === 'function')) {
    alert('생각 나침반 모듈을 불러오지 못했어요. 페이지를 새로고침해 주세요.');
    return;
  }
  window.ThoughtCompassReview.openReadOnly({ classId: classId, teamName: teamName, fromAdmin: true });
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
    console.error('[admin] ' + label + ' 전환 실패:', err);
    alert(`❌ ${label} 전환을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.`);
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
  console.error('[admin] ' + fallbackLabel + ' 실패:', err);
  const errMsg = (err && (err.code || err.message)) ? String(err.code || err.message) : '';
  if (/PERMISSION_DENIED|permission[_ ]?denied/i.test(errMsg)) {
    alert('권한이 없어 ' + fallbackLabel + '을(를) 처리하지 못했어요. 관리자에게 문의해 주세요.');
  } else {
    alert('❌ ' + fallbackLabel + '을(를) 처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
}

async function _changeTeamPin(encodedName, displayName) {
  if (!adminState.verified) return;
  const ref = _accountRef(encodedName);
  if (!ref) { alert('이 팀의 계정 정보를 찾을 수 없어요.'); return; }

  /* TEAM-ACCOUNT-CARD-1: 비우고 확인하면 4자리 자동 생성(모달 없이 최소 변경). */
  const input = prompt(`"${displayName}" 팀의 새 PIN을 숫자 4~6자리로 입력해 주세요.\n(비우고 확인하면 자동으로 만들어요)`);
  if (input === null) return;                 /* 취소 → 아무것도 안 함 */
  let newPin = input.trim();
  if (newPin === '') newPin = _genPin(_knownAccountPins());   /* 자동 생성 */
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

/* DELETE-SAFETY-2: ② 계정만 삭제 — account 노드만 remove. 작품(scenes/viewer-meta) 보존.
   위험도 중간(입장 차단)이지만 되돌리기 가능(같은 이름 재등록) → 재입력 강확인 없이 confirm 1회.
   ⚠️ 이미 입장한 기기(members) 무효화는 members write:false라 client 불가 = 서버(Functions) 필요·후속.
      여기선 "새 입장 차단"만. Storage 이미지 고아 정리도 별개(전체 삭제에도 동일 한계). */
async function _deleteAccountOnly(encodedName, displayName) {
  if (!adminState.verified) return;
  const ref = _accountRef(encodedName);
  if (!ref) { alert('이 팀의 계정 정보를 찾을 수 없어요.'); return; }
  const ok = confirm(
    `"${displayName}" 모둠의 입장 계정만 지울까요?\n\n` +
    `• 작품(장면·그림)은 그대로 남아요.\n` +
    `• 학생은 더 이상 이 이름·비밀번호(PIN)로 새로 입장할 수 없어요.\n` +
    `• 다시 열려면 "학생/팀 계정 미리 만들기"에서 같은 이름을 등록하면 돼요.\n\n` +
    `작품까지 지우려면 '모둠 전체 삭제'를 쓰세요.`
  );
  if (!ok) return;
  try {
    /* ⚠️ account 노드만 remove — scenes/viewer-meta/members 미접근 */
    await ref.remove();
    alert(`🧹 "${displayName}" 모둠의 입장 계정을 지웠어요. 작품은 그대로 남아 있어요.`);
    /* allTeams 상태 반영: 미등록으로 전환 */
    const team = adminState.allTeams.find(t => t.encodedName === encodedName);
    if (team) { team.registered = false; team.accountStatus = null; team.accountName = null; team.accountPin = null; }
    _invalidateAdminCache('delete-account-only');
    _renderTeamList();
  } catch (err) {
    _adminAccountErr(err, '계정만 삭제');
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
    console.error('[admin] 코드 발급 실패:', err);
    alert(`❌ 코드 발급에 실패했어요. 잠시 후 다시 시도해 주세요.`);
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

    /* ACCOUNT-MEMBER-LIST-1: 입장한 기기(멤버) 목록 — team 객체에 이미 있음(추가 read 0).
       개인정보 없음(순번·마지막 입장 날짜·익명여부만). 등록/멤버 없으면 안내. */
    const memberHtml = _memberSectionHtml(team);

    detail.innerHTML = `<div class="admin-detail-inner">${problemsHtml}${sceneChips}${memberHtml}</div>`;
  }).catch(err => {
    detail.innerHTML = `<div class="admin-error" style="padding:8px 0;">⚠️ ${_escHtml(_adminErrText(err))}</div>`;
  });
}

/* ACCOUNT-MEMBER-LIST-1: 입장 기기(멤버) 목록 HTML — 상세 패널용. 순번·마지막 입장 날짜·
   익명여부만(개인정보 0). team.memberList는 _summarizeMembers가 active만 최근순 정렬해 채움. */
function _memberDate(ms) {
  if (!ms) return '기록 없음';
  try { const d = new Date(ms); return `${d.getMonth() + 1}월 ${d.getDate()}일`; } catch (e) { return '기록 없음'; }
}
function _memberSectionHtml(team) {
  const list = (team && Array.isArray(team.memberList)) ? team.memberList : [];
  const count = (team && typeof team.memberCount === 'number') ? team.memberCount : list.length;
  if (!count) {
    /* 등록 팀인데 아직 입장 없음 / 미등록 팀 — 구분 안내 */
    const msg = (team && team.registered)
      ? '아직 이 모둠으로 입장한 기기가 없어요. 학생이 클래스 코드·모둠 이름·PIN으로 들어오면 표시돼요.'
      : '입장 기록이 없어요. (오래된 팀은 학생이 다시 입장하면 기록이 생겨요.)';
    return `<div class="admin-detail-section">
      <div class="admin-detail-label">👥 입장한 기기</div>
      <div style="font-size:12px;color:#8a7350;">${msg}</div>
    </div>`;
  }
  const rows = list.map((m, i) => {
    const anon = (m.authType === 'anonymous') ? '' : ' · 로그인';
    return `<span class="admin-member-chip" style="display:inline-flex;gap:6px;align-items:center;border:1px solid #d9c39a;border-radius:8px;padding:2px 8px;margin:2px;font-size:11px;color:#6b5638;">
      <b>기기 ${i + 1}</b><span>마지막 입장 ${_memberDate(m.lastVerifiedAt || m.joinedAt)}${anon}</span></span>`;
  }).join('');
  return `<div class="admin-detail-section">
    <div class="admin-detail-label">👥 입장한 기기 (${count}개)</div>
    <div class="admin-member-chips">${rows}</div>
    <div style="font-size:11px;color:#a8946e;margin-top:4px;">기기 수는 학생이 입장한 브라우저/기기 수예요. 이름·비밀번호 같은 개인정보는 저장하지 않아요.</div>
  </div>`;
}

/* ================================================================
   팀 삭제 — 경로도 v1/v2 분기
   ================================================================ */
function _deleteTeam(encodedName, displayName) {
  if (!adminState.verified) return;
  if (!confirm(`"${displayName}" 팀의 모든 데이터를 삭제할까요?\n이 작업은 되돌릴 수 없어요!`)) return;

  /* 2026-05-29 admin 1차: 강한 확인 — 팀 이름을 정확히 다시 입력해야 remove() 실행.
     · 옛엔 confirm() 한 번뿐 — 실수 클릭 시 학생 작품 복구 X
     · prompt 입력값이 teamName과 정확히 일치해야 진행
     · 취소 / 빈 값 / 불일치 → remove() 호출 경로 진입 안 함 (안전 우선) */
  const typed = prompt(
    `⚠️ 마지막 확인 — 이 작업은 복구할 수 없어요.\n\n` +
    `삭제하려면 팀 이름을 정확히 입력해주세요:\n"${displayName}"\n\n` +
    `(취소하거나 다르게 입력하면 삭제되지 않아요)`
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
      /* 2026-05-29 admin 2차: PERMISSION_DENIED는 별도 안내.
         · Firebase RTDB 규칙상 admin 화면에서 직접 삭제가 막혀 있을 수 있음
         · 원문 에러는 그대로 노출하지 않음 — 교사 친화 문구로 안내
         · 권한 정책은 변경하지 않음 (database.rules.json 무수정) */
      console.error('[admin] 팀 삭제 실패:', err);
      const errMsg  = (err && (err.code || err.message)) ? String(err.code || err.message) : '';
      const isPermDenied = /PERMISSION_DENIED|permission[_ ]?denied/i.test(errMsg);
      if (isPermDenied) {
        alert(
          '⚠️ 삭제 권한이 없어 삭제되지 않았어요.\n\n' +
          '현재 관리자 화면에서는 팀 데이터를 직접 삭제할 수 없어요.\n' +
          '관리자에게 별도 처리 부탁드려요.'
        );
      } else {
        alert('❌ 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.');
      }
    });
}
