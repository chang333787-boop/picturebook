/* ====================================================================
   viewer-ai.js — 가지(branch) AI 기능 (클라이언트)
   --------------------------------------------------------------------
   v138 코드 + AI_MASTER_PLAN_CLAUDE_v3 + AI_POLICY_V140 기준.

   현재 상태(2026-06):
   - 텍스트 1단계(callTextAiBatch) · 작품 검사(callWorkCheck) = 실 API(Anthropic Haiku) 작동.
     운영 게이트 = _shouldUseRealApi()(인증+운영). mock은 fallback(테스트/무인증)일 뿐.
   - 텍스트 2단계 = 준비 중(카드 비활성), 텍스트 3단계/이미지 = 미노출/미구현.
   - 적용 결과는 localStorage 오버레이(aiVariants) — 원본 scene.body 절대 안 덮음.
   - 아래 MOCK_ONLY 상수는 레거시(실제 분기엔 안 쓰임). 실 분기는 _shouldUseRealApi().

   Phase 0.5 v139 진행 (옛 흐름):
   - step1~4: 진입/모드/비교/검사 — _rtSaveBody로 원본 덮어쓰기  ✓ (v140으로 폐기)

   Phase 0.5 v140 진행 (새 흐름):
   - v140-step1: 테스트 모드 + reset 함수 + localStorage 키 박음  ← (지금)
   - v140-step2: 후보 3회 흐름 + 후보 모달
   - v140-step3: 편집 중 / 마감 + aiVariants.textS1.final 저장
   - v140-step4: viewer 토글 (원본/AI 1단계) + 마감 후 본문 분기

   mock 저장 정책 (rules 9-6 "rules 변경 X" 정신):
   - v139 박힌 거: ai-suggestions / ai-history localStorage. 적용 본문만 Firebase
   - v140 박힌 거: aiDrafts / aiVariants 모두 localStorage (Firebase 박지 X)
     - 원본 body는 절대 덮어쓰지 X (_rtSaveBody 호출 박지 X)
     - Phase A 박힐 때 Firebase 노드로 박을 거
   ==================================================================== */

(function () {
  'use strict';

  /* ────────────────────────────────────────────────────────────────
     Phase 정보 + 정책 상수
     ──────────────────────────────────────────────────────────────── */
  const PHASE = 'phase-a-step4';
  const MOCK_ONLY = true;
  const LS_ONBOARDING_KEY = 'pb_ai_onboarding_shown_v1';
  const LS_MOCK_STORE_KEY = 'pb_ai_mock_store_v1';
  const LS_MOCK_USAGE_KEY = 'pb_ai_mock_usage_v1';

  /* ────────────────────────────────────────────────────────────────
     v140 mock 전용 localStorage 키 (Phase A 박힐 때 Firebase로)
     ⚠️ MOCK 전용 — Phase A 실 API에서는 Firebase 노드로 전환
     ──────────────────────────────────────────────────────────────── */
  const LS_AI_DRAFTS_KEY = 'pb_ai_drafts_v140';          /* aiDrafts.textS1 (mock) */
  const LS_AI_VARIANTS_KEY = 'pb_ai_variants_v140';      /* aiVariants.textS1.final (mock) */
  const LS_AI_VIEW_MODE_KEY = 'pb_ai_view_mode_v140';    /* 'original' | 'aiS1' (mock) */
  const LS_TEST_MODE_BYPASS_KEY = 'pb_ai_test_bypass_v140'; /* TEST MODE 우회 토글 (mock) */

  /* mock quota 초기값 (사용자 결정 박힌 AI_DECISIONS_FINAL.md #5 추천값) */
  const MOCK_QUOTA = {
    s1: 3,        /* 텍스트 1단계 — v140 박힌 후보 3회와 정확히 매치 */
    s2: 1,        /* 텍스트 2단계 — Phase B */
    s3: 1,        /* 텍스트 3단계 — Phase C */
    check: 5,     /* 작품 검사 */
  };

  /* mock 응답 지연 (사용자에게 호출 중 UI lock 보여주려고) */
  const MOCK_DELAY_MIN = 2000;
  const MOCK_DELAY_MAX = 5000;

  /* AbortController 대용 — 사용자가 호출 중 취소 박을 수 있게 */
  let _currentAbort = null;

  /* ════════════════════════════════════════════════════════════════
     v140-step1: 테스트 모드 (TEST MODE)
     ──────────────────────────────────────────────────────────────
     진입 조건 (2026-06-08 정책 변경):
     - URL ?test=1 일 때만 TEST MODE/mock 진입
     - ?realApi=1 = 강제 실 API (TEST MODE 끔, 기존 호환용)
     - 일반 maker/viewer 접속(localhost/preview 포함) = 실 API
       (localhost 자동 TEST MODE 제거 — 평소 화면에서 실 결과로 품질 판단)

     ⚠️ 실 API 호출에는 testMode 우회 절대 적용 X (Functions 단에서 차단)
     이 모듈은 mock 전용이라 자유롭게 박음.
     ════════════════════════════════════════════════════════════════ */
  function _isTestMode() {
    try {
      const p = new URLSearchParams(location.search);
      /* 명시 우회: ?realApi=1이면 실 API (TEST MODE 끔) */
      if (p.get('realApi') === '1') return false;
      /* ?test=1일 때만 TEST MODE/mock. localhost 자동 진입은 제거됨. */
      if (p.get('test') === '1') return true;
    } catch (e) { /* noop */ }
    return false;
  }

  function _isFinalizationBypassEnabled() {
    /* TEST MODE에서만 박힘. 운영 모드에선 false (그래서 이 함수 박혀도 안전) */
    if (!_isTestMode()) return false;
    try {
      const v = localStorage.getItem(LS_TEST_MODE_BYPASS_KEY);
      return v === '1';
    } catch (e) { return false; }
  }

  function _setFinalizationBypass(on) {
    try {
      if (on) localStorage.setItem(LS_TEST_MODE_BYPASS_KEY, '1');
      else localStorage.removeItem(LS_TEST_MODE_BYPASS_KEY);
    } catch (e) { /* noop */ }
    _updateTestModeBadge();
  }

  function _showTestModeBadge() {
    if (!_isTestMode()) return;
    if (document.getElementById('ai-testmode-badge')) return;
    const el = document.createElement('div');
    el.id = 'ai-testmode-badge';
    el.className = 'ai-testmode-badge';
    el.innerHTML = ''
      + '<span class="ai-testmode-badge__label">TEST MODE</span>'
      + '<span class="ai-testmode-badge__hint">개발 테스트 모드 — 실 AI 호출 없음 · 학생 데이터 미사용</span>'
      + '<button type="button" class="ai-testmode-badge__bypass js-ai-testmode-bypass" title="원본 마감 우회 토글">'
      +   '마감 우회: <span class="js-bypass-state">OFF</span>'
      + '</button>';
    document.body.appendChild(el);
    el.querySelector('.js-ai-testmode-bypass').addEventListener('click', function () {
      _setFinalizationBypass(!_isFinalizationBypassEnabled());
    });
    _updateTestModeBadge();
  }

  function _updateTestModeBadge() {
    const el = document.getElementById('ai-testmode-badge');
    if (!el) return;
    const state = el.querySelector('.js-bypass-state');
    if (state) state.textContent = _isFinalizationBypassEnabled() ? 'ON' : 'OFF';
    el.classList.toggle('ai-testmode-badge--bypass-on', _isFinalizationBypassEnabled());
  }

  function _hideTestModeBadge() {
    const el = document.getElementById('ai-testmode-badge');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  /* ════════════════════════════════════════════════════════════════
     v140 fix: mock usage namespace 분리 (팀별 quota — 2026-05-21 박힘)
     ──────────────────────────────────────────────────────────────
     사용자 버그 보고 박힘 — 같은 브라우저에서 0000 팀 사용하면 은규 / 예지유은인우
     quota도 함께 차감 박혔음 (LS_MOCK_USAGE_KEY 공통 박혀서).

     namespace key 박은 거:
       pb_ai_mock_usage_v140__{classId}__{teamName}

     fallback:
       classId 박지 X → '_'
       teamName 박지 X → '_'

     ⚠️ usage만 namespace 박음 (사용자 명). aiDrafts / aiVariants 박은 거 박은 거 박은 — 별도 보고 박힐 거.
     ════════════════════════════════════════════════════════════════ */
  function _getCurrentNamespace() {
    let classId = '_', teamName = '_';
    try {
      if (typeof ViewerState !== 'undefined' && ViewerState) {
        if (ViewerState.classId)  classId  = String(ViewerState.classId);
        if (ViewerState.teamName) teamName = String(ViewerState.teamName);
      }
      /* URL 박은 거 박은 거 박은 fallback */
      const p = new URLSearchParams(location.search);
      if (classId === '_' && p.get('classId')) classId = p.get('classId');
      if (teamName === '_' && p.get('team'))   teamName = p.get('team');
    } catch (e) { /* noop */ }
    return classId + '__' + teamName;
  }

  function _getMockUsageKey() {
    return LS_MOCK_USAGE_KEY + '__' + _getCurrentNamespace();
  }

  /* v140 fix 2026-05-21: drafts / variants / viewMode 박은 거 박은 거 박은 박은 — 팀별 분리 (사용자 명) */
  function _getMockDraftsKey() {
    return LS_AI_DRAFTS_KEY + '__' + _getCurrentNamespace();
  }
  function _getMockVariantsKey() {
    return LS_AI_VARIANTS_KEY + '__' + _getCurrentNamespace();
  }
  function _getMockViewModeKey() {
    return LS_AI_VIEW_MODE_KEY + '__' + _getCurrentNamespace();
  }

  /* ════════════════════════════════════════════════════════════════
     v140-step1: reset 함수 (사용자 결정 #B + v140 namespace fix)
     ──────────────────────────────────────────────────────────────
     기본 reset = 현재 팀 quota만. drafts / variants는 별도 함수.
     전체 reset 박을 거 박은 거 박은 박은 — `__resetAiMockUsageAll` 박음.
     window 노출 — 콘솔에서 박음.
     ⚠️ MOCK 전용 — 실 API에는 무효 (Phase A Functions 단에서 무시)
     ════════════════════════════════════════════════════════════════ */
  function _resetMockUsage(mode) {
    /* 현재 팀(namespace) quota만 reset */
    const key = _getMockUsageKey();
    try {
      if (!mode) {
        localStorage.removeItem(key);
      } else {
        const u = _safeParseJson(localStorage.getItem(key)) || {};
        const usedKey = mode + 'Used';
        if (usedKey in u) u[usedKey] = 0;
        localStorage.setItem(key, JSON.stringify(u));
      }
      console.log('[ai-mock] usage reset (' + _getCurrentNamespace() + ')', mode || '(all)');
    } catch (e) { console.warn('[ai-mock] usage reset failed', e); }
  }

  function _resetMockUsageAll() {
    /* 모든 namespace usage 박은 거 박은 거 박은 — pb_ai_mock_usage_v140 prefix 박은 거 박은 거 박은 */
    const removed = [];
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k === LS_MOCK_USAGE_KEY || k.indexOf(LS_MOCK_USAGE_KEY + '__') === 0)) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(function (k) { localStorage.removeItem(k); removed.push(k); });
      console.log('[ai-mock] usage reset ALL — ' + removed.length + ' keys', removed);
    } catch (e) { console.warn('[ai-mock] usage reset all failed', e); }
  }

  /* v140 fix 2026-05-21: drafts / variants reset 박은 거 박은 거 박은 박은 — 현재 팀만 (사용자 명) */
  function _resetMockDrafts() {
    try {
      localStorage.removeItem(_getMockDraftsKey());
      /* 옛 공통 키 박은 거 박은 거 박은 박은 — 박은 거 박은 거 박은 박은 박지 X 박은 거 박은 거 박은 박은 (마이그 없음). 단 한 번 정리 박음. */
      localStorage.removeItem(LS_AI_DRAFTS_KEY);
      console.log('[ai-mock] drafts reset (' + _getCurrentNamespace() + ')');
    } catch (e) { console.warn('[ai-mock] drafts reset failed', e); }
  }

  function _resetMockVariants() {
    try {
      localStorage.removeItem(_getMockVariantsKey());
      localStorage.removeItem(_getMockViewModeKey());
      /* 옛 공통 키 박지 X */
      localStorage.removeItem(LS_AI_VARIANTS_KEY);
      localStorage.removeItem(LS_AI_VIEW_MODE_KEY);
      console.log('[ai-mock] variants reset (' + _getCurrentNamespace() + ')');
    } catch (e) { console.warn('[ai-mock] variants reset failed', e); }
  }

  /* 전체 박은 거 박은 거 박은 박은 — 모든 팀 namespace drafts/variants 박음 */
  function _resetMockDraftsAll() {
    const removed = [];
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k === LS_AI_DRAFTS_KEY || k.indexOf(LS_AI_DRAFTS_KEY + '__') === 0)) keys.push(k);
      }
      keys.forEach(function (k) { localStorage.removeItem(k); removed.push(k); });
      console.log('[ai-mock] drafts reset ALL — ' + removed.length + ' keys', removed);
    } catch (e) { console.warn('[ai-mock] drafts reset all failed', e); }
  }

  function _resetMockVariantsAll() {
    const removed = [];
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k === LS_AI_VARIANTS_KEY || k.indexOf(LS_AI_VARIANTS_KEY + '__') === 0) keys.push(k);
        else if (k === LS_AI_VIEW_MODE_KEY || k.indexOf(LS_AI_VIEW_MODE_KEY + '__') === 0) keys.push(k);
      }
      keys.forEach(function (k) { localStorage.removeItem(k); removed.push(k); });
      console.log('[ai-mock] variants reset ALL — ' + removed.length + ' keys', removed);
    } catch (e) { console.warn('[ai-mock] variants reset all failed', e); }
  }

  function _resetMockAll() {
    /* 전체 reset = 모든 팀 namespace usage + drafts + variants + store + 우회 토글 */
    _resetMockUsageAll();
    _resetMockDraftsAll();
    _resetMockVariantsAll();
    try {
      localStorage.removeItem(LS_MOCK_STORE_KEY);
      localStorage.removeItem(LS_TEST_MODE_BYPASS_KEY);
    } catch (e) { /* noop */ }
    _updateTestModeBadge();
    console.log('[ai-mock] all reset');
  }

  function _safeParseJson(s) {
    if (!s) return null;
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  /* ════════════════════════════════════════════════════════════════
     v140-step2: aiDrafts helper (1단계 후보 3회 저장)
     ──────────────────────────────────────────────────────────────
     구조 (mock — Phase A 박힐 때 Firebase 노드로):
     {
       textS1: {
         status: 'none' | 'generating' | 'candidate_ready' | 'drafting' | 'finalized',
         candidates: {
           attempt1: { suggestionId, results: { sceneId: {...} }, generatedAt },
           attempt2: { ... },
           attempt3: { ... }
         },
         selectedAttempt: 1 | 2 | 3 | null,
         editedDraftByScene: { sceneId: editedBody }
       }
     }
     ⚠️ MOCK 전용 — Phase A 박힐 때 Firebase로 전환
     ════════════════════════════════════════════════════════════════ */
  function _loadAiDrafts() {
    /* v140 fix 2026-05-21: 팀별 namespace 박음. 옛 공통 키 박지 X. */
    return _safeParseJson(localStorage.getItem(_getMockDraftsKey())) || { textS1: null };
  }

  function _saveAiDrafts(drafts) {
    try { localStorage.setItem(_getMockDraftsKey(), JSON.stringify(drafts)); }
    catch (e) { console.warn('[ai-mock] aiDrafts save failed', e); }
  }

  function _getAiTextS1Status() {
    const d = _loadAiDrafts();
    return (d.textS1 && d.textS1.status) || 'none';
  }

  function _setAiTextS1Status(status) {
    const d = _loadAiDrafts();
    if (!d.textS1) d.textS1 = { status: 'none', candidates: {}, selectedAttempt: null, editedDraftByScene: {} };
    d.textS1.status = status;
    _saveAiDrafts(d);
  }

  function _getCandidateCount() {
    const d = _loadAiDrafts();
    if (!d.textS1 || !d.textS1.candidates) return 0;
    return Object.keys(d.textS1.candidates).length;
  }

  function _getNextAttemptNumber() {
    return _getCandidateCount() + 1; /* 1·2·3 */
  }

  function _saveAiDraftCandidate(attemptN, candidate) {
    const d = _loadAiDrafts();
    if (!d.textS1) d.textS1 = { status: 'none', candidates: {}, selectedAttempt: null, editedDraftByScene: {} };
    if (!d.textS1.candidates) d.textS1.candidates = {};
    d.textS1.candidates['attempt' + attemptN] = candidate;
    d.textS1.status = 'candidate_ready';
    _saveAiDrafts(d);
  }

  function _setSelectedAttempt(attemptN) {
    const d = _loadAiDrafts();
    if (!d.textS1) return;
    d.textS1.selectedAttempt = attemptN;
    d.textS1.status = 'drafting';
    _saveAiDrafts(d);
  }

  function _isS1Drafting() {
    return _getAiTextS1Status() === 'drafting';
  }

  /* ════════════════════════════════════════════════════════════════
     Phase A — Firebase Functions 호출 (실 Anthropic API)
     ──────────────────────────────────────────────────────────────
     ⚠️ TEST MODE 박혀있으면 mock 박음 (실 호출 X).
        운영 박을 때 박은 거 박은 거 박은 박은 — _callPhaseAFunction 박음.
     ════════════════════════════════════════════════════════════════ */
  /* viewer 박은 거 박은 거 박은 박은 named app 'viewer' 박음 (viewer-data.js 박힘). default app 박지 X. */
  function _getViewerFirebaseApp() {
    if (typeof firebase === 'undefined') return null;
    try { return firebase.app('viewer'); } catch (e) { /* noop */ }
    try { return firebase.app(); } catch (e) { /* noop */ }
    if (firebase.apps && firebase.apps.length) return firebase.apps[0];
    return null;
  }

  async function _callPhaseAFunction(fnName, payload) {
    if (typeof firebase === 'undefined' || !firebase.functions) {
      throw new Error('Firebase Functions SDK가 없어요 — viewer.html을 확인해 주세요');
    }
    const app = _getViewerFirebaseApp();
    if (!app) throw new Error('Firebase app이 없어요 (viewer 초기화가 안 됐어요)');
    /* auth 박지 X 박혀있으면 anonymous 박음 (Functions context.auth 박혀있어야) */
    await _ensureAnonymousAuth(app);
    /* 서울 region 박은 거 박은 거 박은 박은 — functions/index.js setGlobalOptions 박힘 */
    const fns = app.functions('asia-northeast3');
    const callable = fns.httpsCallable(fnName);
    const result = await callable(payload);
    return result.data;
  }

  /* Phase A 박은 거 박은 거 박은 박은 진입 — 운영 모드만. TEST MODE 박혀있으면 mock 박음. */
  function _shouldUseRealApi() {
    /* TEST MODE면 mock (단 ?realApi=1이면 _isTestMode가 false라 통과) */
    if (_isTestMode()) return false;
    /* Firebase Functions SDK 없으면 mock fallback */
    if (typeof firebase === 'undefined' || !firebase.functions) return false;
    /* default app auth 확인 제거 (2026-06-08): viewer.html엔 default app이 없어
       firebase.auth().currentUser가 항상 throw→false로 떨어져 일반 접속이 mock이 됐음.
       실제 익명 인증은 호출 직전 _callPhaseAFunction()의 _ensureAnonymousAuth(viewer app)가 담당. */
    return true;
  }

  /* anonymous 박은 거 박은 거 박은 박은 박지 X 박혀있으면 박음 (named app 'viewer' 박음) */
  async function _ensureAnonymousAuth(app) {
    try {
      const authObj = app ? app.auth() : firebase.auth();
      const cur = authObj.currentUser;
      if (cur) return cur;
      const cred = await authObj.signInAnonymously();
      return cred && cred.user;
    } catch (e) {
      console.warn('[Phase A] anonymous 박지 X', e);
      return null;
    }
  }

  function _getCurrentClassIdTeamName() {
    let classId = '', teamName = '';
    try {
      if (typeof ViewerState !== 'undefined' && ViewerState) {
        /* 진실은 ViewerState.project.* (loadTeamData가 채움). scenes/aiVariants 경로와 정합. */
        const proj = ViewerState.project || {};
        classId = String(proj.classId || ViewerState.classId || '');
        teamName = String(proj.teamName || ViewerState.teamName || '');
      }
      const p = new URLSearchParams(location.search);
      if (!classId && p.get('classId')) classId = p.get('classId');
      if (!teamName && p.get('team')) teamName = p.get('team');
    } catch (e) { /* noop */ }
    return { classId, teamName };
  }

  /* ════════════════════════════════════════════════════════════════
     Phase 1: 학급 AI 설정 (classes/{classId}/aiSettings) 클라 캐시
     ──────────────────────────────────────────────────────────────
     상태 3종:
       undefined = 아직 안 읽음   → 안전 fallback(허용). 서버가 최종 차단하므로 안전.
       null      = 읽었으나 노드 없음 → 기본 ON (기존 동작 보존).
       object    = 교사 설정 존재 → enabled + modes[modeKey] 게이트.
     클라 게이트는 UX용. 실제 차단은 서버 _validateRequest가 보장. ════════════════════════════════════════════════════════════════ */
  const AI_MODE_KEY_MAP = { s1: 'textS1', s2: 'textS2', check: 'workCheck', imageS1: 'imageS1', imageS2: 'imageS2' };
  let _classAiSettings = undefined;        // undefined|null|object
  let _classAiSettingsClassId = null;
  let _classAiSettingsLoading = false;

  function getClassAiSettings() { return _classAiSettings; }

  /* 확실히 학급 AI가 꺼진 상태(노드 있고 enabled !== true)일 때만 true. 미로드/노드없음/켜짐 → false. */
  function isClassAiHardOff() {
    const s = _classAiSettings;
    if (s === undefined || s === null) return false;
    return s.enabled !== true;
  }

  /* 교사 권한상 mode 허용 여부. 미로드/노드없음 → true(fallback). object → enabled && modes[key]. */
  function _isModeAllowedByTeacher(mode) {
    const s = _classAiSettings;
    if (s === undefined || s === null) return true;
    if (s.enabled !== true) return false;
    const key = AI_MODE_KEY_MAP[mode] || mode;
    return !!(s.modes && s.modes[key] === true);
  }

  async function _loadClassAiSettings() {
    const { classId } = _getCurrentClassIdTeamName();
    if (!classId) { _classAiSettings = null; _classAiSettingsClassId = null; return null; }   // v1/무클래스 → 기본 ON
    if (_classAiSettingsClassId === classId && _classAiSettings !== undefined) return _classAiSettings;
    if (_classAiSettingsLoading) return _classAiSettings;
    _classAiSettingsLoading = true;
    try {
      const app = _getViewerFirebaseApp();
      // app/database 아직 준비 안 됨(부트스트랩이 viewer-data init보다 먼저 실행) →
      // 캐시·classId 잠그지 말고 미로드(undefined) 유지. 이후 renderHUD preload가 재시도.
      // (null로 잠그면 idempotent 가드에 막혀 영구히 재읽기 못 함 → 교사 OFF가 클라에 안 반영됨)
      if (!app || !app.database) { return _classAiSettings; }
      const snap = await app.database().ref('classes/' + classId + '/aiSettings').once('value');
      _classAiSettings = snap.val();       // object | null
      _classAiSettingsClassId = classId;
    } catch (e) {
      // 읽기 실패 → 미로드 유지(undefined=기본 ON, 서버가 최종 차단). classId 잠그지 않아 재시도 가능.
    } finally {
      _classAiSettingsLoading = false;
    }
    return _classAiSettings;
  }

  /* HUD에서 fire-and-forget로 호출. 멱등 — 현재 classId가 이미 로드됐으면 캐시 즉시 반환(Firebase 읽기 X).
     로드 결과 hard-off 상태가 직전과 달라졌을 때만 HUD 1회 재렌더 → 무한 루프 방지.
     (ViewerState.classId가 init 시점엔 비어있을 수 있어, classId 준비 후 renderHUD가 다시 호출되면 자가 보정됨.) */
  async function _preloadClassAiSettings() {
    const before = isClassAiHardOff();
    await _loadClassAiSettings();
    const after = isClassAiHardOff();
    if (after !== before && typeof renderHUD === 'function') {
      try { renderHUD(); } catch (e) { /* noop */ }
    }
    /* Phase 3 — 텍스트 aiVariant Firebase 캐시 로딩(fire-and-forget). 로딩되면 프레임 재렌더. */
    if (typeof _preloadFirebaseTextVariants === 'function') {
      _preloadFirebaseTextVariants();
    }
    return _classAiSettings;
  }

  async function _phaseACallTextS1(snapshot) {
    const { classId, teamName } = _getCurrentClassIdTeamName();
    const branchLineage = (typeof ViewerState !== 'undefined' && ViewerState.branchLineage) || {};
    return _callPhaseAFunction('callTextAiBatch', {
      classId, teamName,
      workId: teamName,                                /* 가지 데이터 모델 — workId = teamName */
      rootBranchId: branchLineage.rootBranchId || null,
      copyDepth: branchLineage.copyDepth || 0,
      snapshot,
      /* testMode 박지 X — 실 API라 박은 거 박은 거 박은 박은 Functions 박은 거 박은 거 박은 박은 거부 박음 */
    });
  }

  async function _phaseACallWorkCheck(snapshot) {
    const { classId, teamName } = _getCurrentClassIdTeamName();
    const branchLineage = (typeof ViewerState !== 'undefined' && ViewerState.branchLineage) || {};
    return _callPhaseAFunction('callWorkCheck', {
      classId, teamName,
      workId: teamName,
      rootBranchId: branchLineage.rootBranchId || null,
      copyDepth: branchLineage.copyDepth || 0,
      snapshot,
    });
  }

  /* ════════════════════════════════════════════════════════════════
     텍스트 2단계 (장면 발전) — 클라이언트 연결 (2026-06)
     서버 callTextAiBatchS2 호출 → 후보 결과 표시 → 사용자가 적용 → localStorage(aiVariants.textS2)
     오버레이. 원본 scene.body 절대 안 덮음. s1 흐름/작품검사 불변(독립 함수).
     ════════════════════════════════════════════════════════════════ */
  async function _phaseACallTextS2(snapshot) {
    const { classId, teamName } = _getCurrentClassIdTeamName();
    const branchLineage = (typeof ViewerState !== 'undefined' && ViewerState.branchLineage) || {};
    return _callPhaseAFunction('callTextAiBatchS2', {
      classId, teamName,
      workId: teamName,
      rootBranchId: branchLineage.rootBranchId || null,
      copyDepth: branchLineage.copyDepth || 0,
      snapshot,
    });
  }

  /* TEST MODE / 무인증 fallback — 가벼운 mock 발전(흐름 테스트용). 실 API에는 안 씀. */
  async function _mockGenerateS2(snapshot) {
    await new Promise(function (r) { setTimeout(r, 800); });
    const results = {};
    Object.values(snapshot || {}).forEach(function (s) {
      if (!s || !s.body) return;
      results[String(s.id)] = {
        revisedText: String(s.body) + ' 그러고는 주변을 천천히 둘러보았다.',
        summary: 'mock 발전 — 행동 묘사 추가',
        addedElements: { background: false, action: true, emotion: false, sensory: false, dialogue: false },
        preservedCheck: {
          charactersUnchanged: true, plotPointsUnchanged: true, choiceMeaningsUnchanged: true,
          endingDirectionUnchanged: true, branchStructureUnchanged: true, sceneRoleUnchanged: true,
          studentToneUnchanged: true,
        },
        riskLevel: 'low', appliable: true,
      };
    });
    return { ok: true, strength: 2, scope: 'work', globalSummary: 'MOCK 2단계 (가짜)', results: results, isMock: true };
  }

  async function _startTextS2() {
    const snapshot = _buildWorkSnapshot();
    const sceneCount = Object.keys(snapshot || {}).length;
    if (sceneCount === 0) {
      alert('2단계로 발전시킬 본문이 있는 장면이 없어요.');
      return;
    }
    const useRealApi = _shouldUseRealApi();
    if (!useRealApi && _getRemaining('s2') <= 0) {
      alert('이번 작품에서 텍스트 2단계를 사용할 수 있는 횟수를 모두 사용했어요. (테스트 모드)');
      return;
    }
    _showCallingModal(sceneCount);
    _currentAbort = { cancelled: false };
    let apiResult;
    try {
      if (useRealApi) {
        apiResult = await _phaseACallTextS2(snapshot);
      } else {
        _consumeQuota('s2');
        apiResult = await _mockGenerateS2(snapshot);
      }
    } catch (e) {
      _hideCallingModal();
      console.error('[Phase A] 텍스트 2단계 실패', e);
      alert('AI 장면 발전에 실패했어요. 잠시 후 다시 시도해주세요.\n' + (e && e.message ? e.message : ''));
      return;
    }
    _hideCallingModal();
    if (_currentAbort && _currentAbort.cancelled) return;
    /* Phase 2 — 서버 사전 검사 차단 응답이면 모달 안내 후 종료 (AI 발전 없음) */
    if (apiResult && apiResult.blocked) {
      _showAiPrecheckBlockedModal(apiResult, 's2');
      return;
    }
    _showS2ResultModal(snapshot, (apiResult && apiResult.results) || {});
  }

  /* 차단된 s2 후보의 strongWarnings를 학생용 부드러운 문구로 변환(최대 2개). 코드 없는 경고는 일반 문구로 fallback. */
  function _s2BlockedReasons(r) {
    const ws = (r && Array.isArray(r.strongWarnings)) ? r.strongWarnings : [];
    const out = [];
    ws.forEach(function (w) {
      const code = (w && w.code) || '';
      let m = '';
      if (code === 'BIG_SETTING_ADDED') m = '원작에 없던 큰 설정이 들어갔어요.';
      else if (code === 'PRESERVED_CHECK_FALSE') m = '선택지나 다음 장면 흐름이 바뀔 수 있어요.';
      else if (code === 'PRESERVED_CHECK_MISSING') m = '보존 검사 결과가 부족해 원본을 보호했어요.';
      else if (code === 'BANNED_FIELD') m = '바꾸면 안 되는 부분이 함께 바뀌려 했어요.';
      else if (code === 'LEN_RATIO') m = '내용이 원작보다 너무 많이 늘어났어요.';
      else if (code === 'INAPPROPRIATE' || code === 'SAFETY') m = '다듬기에 적합하지 않은 표현이 있어요. 표현을 직접 바꾼 뒤 다시 시도해 주세요.';
      if (m && out.indexOf(m) < 0) out.push(m);
    });
    return out.slice(0, 2);
  }

  /* ════════════════════════════════════════════════════════════════
     Phase 2 — 사전 검사 차단 안내 모달 (safety / completion / structure / cooldown)
     ──────────────────────────────────────────────────────────────
     서버가 {ok:false, blocked:true, reasonCode, categories, sceneIds, message} 반환 시 표시.
     원칙: 문제 표현 원문 노출 X (장면 번호 + 부드러운 카테고리 라벨만). native alert 아님.
     ════════════════════════════════════════════════════════════════ */
  var _PRECHECK_CAT_LABEL = {
    profanity: '거친 말',
    sexual: '어른용 표현',
    harassment: '친구를 괴롭히는 표현',
    personal_info: '개인정보(전화·주소 등)',
    self_harm: '위험한 표현',
    hate: '차별·혐오 표현',
    gore: '너무 잔인한 표현',
    injection: 'AI를 속이려는 표현',
  };
  var _PRECHECK_TITLE = {
    SAFETY_BLOCKED: '✋ 잠깐, 표현을 확인해 주세요',
    INCOMPLETE_WORK: '📝 아직 준비가 덜 됐어요',
    STRUCTURE_INCOMPLETE: '🧩 이야기 흐름을 연결해 주세요',
    SAFETY_COOLDOWN: '⏳ 잠깐 쉬어가요',
  };

  function _showAiPrecheckBlockedModal(res, mode) {
    res = res || {};
    var reason = res.reasonCode || 'SAFETY_BLOCKED';
    var title = _PRECHECK_TITLE[reason] || '안내';
    var msg = res.message || '지금은 AI를 사용할 수 없어요.';

    var sceneIds = Array.isArray(res.sceneIds) ? res.sceneIds.filter(Boolean) : [];
    var sceneHtml = '';
    if (sceneIds.length) {
      sceneHtml = '<div style="margin-top:10px;font-size:13px;color:#444;">확인할 장면: '
        + sceneIds.map(function (s) { return '<span style="display:inline-block;background:#f3eaff;color:#7b3fc0;border-radius:10px;padding:2px 9px;margin:2px;font-weight:600;">장면 ' + _escapeHtml(String(s)) + '</span>'; }).join('')
        + '</div>';
    }

    var cats = Array.isArray(res.categories) ? res.categories : [];
    var catHtml = '';
    if (reason === 'SAFETY_BLOCKED' && cats.length) {
      var labels = [];
      cats.forEach(function (c) { var l = _PRECHECK_CAT_LABEL[c]; if (l && labels.indexOf(l) < 0) labels.push(l); });
      if (labels.length) {
        catHtml = '<div style="margin-top:8px;font-size:13px;color:#666;">살펴볼 점: '
          + labels.map(function (l) { return _escapeHtml(l); }).join(', ') + '</div>';
      }
    }

    /* safety 계열에는 "AI가 대신 고치지 않는다 + 원본 보호" 안내를 명시 */
    var footNote = (reason === 'SAFETY_BLOCKED' || reason === 'SAFETY_COOLDOWN')
      ? '<p style="margin-top:12px;font-size:13px;color:#3a7d3a;">AI가 대신 고치지 않아요. 표현을 직접 바꾼 뒤 다시 시도해 주세요. 원본은 그대로 보호돼요.</p>'
      : '<p style="margin-top:12px;font-size:13px;color:#3a7d3a;">원본은 그대로 보호돼요.</p>';

    var html = ''
      + '<div class="ai-modal__header"><div class="ai-modal__title">' + _escapeHtml(title) + '</div>'
      +   '<button class="ai-modal__close js-ai-precheck-close" aria-label="닫기">✕</button></div>'
      + '<div class="ai-modal__body">'
      +   '<p style="font-size:15px;color:#333;line-height:1.6;">' + _escapeHtml(msg) + '</p>'
      +   sceneHtml
      +   catHtml
      +   footNote
      + '</div>'
      + '<div class="ai-modal__footer">'
      +   '<button type="button" class="ai-btn ai-btn--primary js-ai-precheck-ok">알겠어요</button>'
      + '</div>';

    var root = _createModalRoot('ai-precheck-blocked-modal', html, {});
    var close = function () { _removeModalRoot('ai-precheck-blocked-modal'); };
    var x = root.querySelector('.js-ai-precheck-close');
    var ok = root.querySelector('.js-ai-precheck-ok');
    if (x) x.addEventListener('click', close);
    if (ok) ok.addEventListener('click', close);
  }

  function _showS2ResultModal(snapshot, results) {
    const rows = Object.keys(snapshot || {}).map(function (sid) {
      const orig = snapshot[sid] || {};
      const r = results[sid];
      if (!r) return '';
      if (r.skip === true) {
        return '<div class="ai-scene-row"><div class="ai-col-label">장면 ' + _escapeHtml(sid)
          + ' — 발전 안 함</div><div style="color:#888;font-size:13px;">'
          + _escapeHtml(r.reason || '이미 충분히 발전되어 있어요') + '</div></div>';
      }
      const blocked = (r.appliable === false) || (Array.isArray(r.strongWarnings) && r.strongWarnings.length > 0);
      const added = r.addedElements || {};
      const addedLabels = [];
      if (added.background) addedLabels.push('배경');
      if (added.action) addedLabels.push('행동');
      if (added.emotion) addedLabels.push('감정');
      if (added.sensory) addedLabels.push('감각');
      if (added.dialogue) addedLabels.push('대사');
      let note;
      if (blocked) {
        const reasons = _s2BlockedReasons(r);
        const reasonHtml = reasons.length
          ? '<ul style="margin:4px 0 0 18px;padding:0;font-weight:400;">' + reasons.map(function (m) { return '<li>' + _escapeHtml(m) + '</li>'; }).join('') + '</ul>'
          : '';
        note = '<div style="margin-top:6px;color:#c0392b;font-size:13px;font-weight:600;">⚠ 이 장면은 원본 보호를 위해 적용할 수 없어요.'
          + reasonHtml
          + '<div style="font-weight:400;margin-top:3px;">표현을 직접 바꾼 뒤 다시 시도해 보세요. (원본은 그대로 보호돼요)</div></div>';
      } else if (Array.isArray(r.weakWarnings) && r.weakWarnings.length > 0) {
        const ws = r.weakWarnings.map(function (w) { return (w && w.reason) ? w.reason : String(w); }).join(', ');
        note = '<div style="margin-top:6px;color:#b9770e;font-size:13px;">주의: ' + _escapeHtml(ws) + '</div>';
      } else {
        note = '<div style="margin-top:6px;color:#3a7d3a;font-size:13px;">선택지와 다음 장면 흐름을 확인했어요.</div>';
      }
      return ''
        + '<div class="ai-scene-row" data-scene-id="' + _escapeHtml(sid) + '"' + (blocked ? ' style="opacity:0.85;"' : '') + '>'
        +   '<div class="ai-col-label">장면 ' + _escapeHtml(sid)
        +     (addedLabels.length ? ' · 추가된 점: ' + _escapeHtml(addedLabels.join(', ')) : '') + '</div>'
        +   '<div class="ai-scene-row__split">'
        +     '<div class="ai-scene-row__col"><div class="ai-col-label">원본</div><div class="ai-col-body">' + _escapeHtml(orig.body || '') + '</div></div>'
        +     '<div class="ai-scene-row__col"><div class="ai-col-label">AI 장면 발전</div><div class="ai-col-body ai-col-body--suggested">' + _escapeHtml(r.revisedText || '') + '</div></div>'
        +   '</div>'
        +   note
        + '</div>';
    }).join('');

    const html = ''
      + '<div class="ai-modal__header"><div class="ai-modal__title">✨ AI 장면 발전 결과 — 2단계</div>'
      +   '<button class="ai-modal__close js-ai-modal-close" aria-label="닫기">✕</button></div>'
      + '<div class="ai-modal__body">'
      +   '<p class="ai-mode-intro">원작의 핵심 사건과 선택지는 지키면서 장면을 더 생생하게 발전시킨 후보예요. 마음에 드는 장면만 적용할 수 있고, 원본은 그대로 남아요. <b>AI가 원문에 없던 내용이나 어색한 표현을 만들 수 있으니, 반드시 다시 읽고 적용할지 선택하세요.</b></p>'
      +   '<div class="ai-s2-list">' + (rows || '<div class="ai-empty">발전할 장면이 없어요.</div>') + '</div>'
      + '</div>'
      + '<div class="ai-modal__footer">'
      +   '<button type="button" class="ai-btn ai-btn--ghost js-ai-s2-cancel">취소</button>'
      +   '<button type="button" class="ai-btn ai-btn--primary js-ai-s2-apply">적용 가능한 장면 적용하기</button>'
      + '</div>';

    const root = _createModalRoot('ai-s2-result-modal', html, { size: 'large' });
    root.querySelector('.js-ai-modal-close').addEventListener('click', function () { _removeModalRoot('ai-s2-result-modal'); });
    root.querySelector('.js-ai-s2-cancel').addEventListener('click', function () { _removeModalRoot('ai-s2-result-modal'); });
    root.querySelector('.js-ai-s2-apply').addEventListener('click', function () {
      _applyS2Results(results);
      _removeModalRoot('ai-s2-result-modal');
    });
  }

  /* 적용 — strongWarnings/appliable=false 장면은 제외. aiVariants.textS2.final에 저장(원본 불변). */
  function _applyS2Results(results) {
    const final = {};
    let appliedCount = 0;
    Object.keys(results || {}).forEach(function (sid) {
      const r = results[sid];
      if (!r || r.skip === true) return;
      const blocked = (r.appliable === false) || (Array.isArray(r.strongWarnings) && r.strongWarnings.length > 0);
      if (blocked) return;
      if (typeof r.revisedText !== 'string' || !r.revisedText.trim()) return;
      final[sid] = { body: r.revisedText, finalizedAt: Date.now() };
      if (r.addedElements && typeof r.addedElements === 'object') final[sid].addedElements = r.addedElements;
      if (typeof r.riskLevel === 'string') final[sid].riskLevel = r.riskLevel;
      appliedCount++;
    });
    if (appliedCount === 0) {
      alert('적용 가능한 장면이 없어요. (모든 후보가 주의/차단 상태이거나 발전 없음)');
      return;
    }
    const v = _loadAiVariants();
    v.textS2 = { status: 'finalized', final: final, finalizedAt: Date.now() };
    _saveAiVariants(v);

    /* Phase 3 — 실 API 모드에서 Firebase 정식 저장(원본 scene.body 불변, 서버 경유). */
    if (_shouldUseRealApi()) {
      _saveTextVariantToFirebase('s2', final);   /* fire-and-forget */
    }

    _setAiViewMode('aiS2');
    _showAiToggleBar();
    alert('✅ ' + appliedCount + '개 장면에 AI 장면 발전을 적용했어요. 원본은 그대로 보호돼요. 위쪽 보기 모드에서 원본/문장 정돈/장면 발전을 전환할 수 있어요.');
  }

  /* ════════════════════════════════════════════════════════════════
     v140-step2: mock 후보 생성 (1 후보 세트 = 작품 전체)
     ──────────────────────────────────────────────────────────────
     v139의 _mockReviseS1 박은 거 박은 거 박은. 한 회차 = 1 후보.
     ════════════════════════════════════════════════════════════════ */
  async function _mockGenerateCandidate(snapshot, attemptN) {
    /* mock 응답 지연 박음 (사용자에게 호출 중 UI lock 박힘) */
    const delayMs = Math.floor(Math.random() * (MOCK_DELAY_MAX - MOCK_DELAY_MIN)) + MOCK_DELAY_MIN;
    await _delay(delayMs);

    const results = {};
    /* fix 2026-05-21: _buildWorkSnapshot은 {sceneId: scene} 객체 박음 (배열 X). Object.values 박음. */
    const sceneList = Object.values(snapshot || {});
    sceneList.forEach(s => {
      if (!s || !s.body || !s.body.trim()) return;
      /* 30% skip (이미 자연스러움) — v139 박힌 거 그대로 */
      if (Math.random() < 0.3) {
        results[s.id] = { skip: true, reason: '이미 자연스러워요 (mock 후보 ' + attemptN + ')' };
      } else {
        results[s.id] = {
          revisedText: _mockReviseS1(s.body) + ' (mock 후보 ' + attemptN + ')',
          summary: '띄어쓰기·문장부호 정리 (mock 후보 ' + attemptN + ')',
          changes: ['띄어쓰기', '문장부호'],
          preservedCheck: { charactersUnchanged: true },
          warnings: []
        };
      }
    });

    return {
      suggestionId: 'mock_v140_a' + attemptN + '_' + Date.now(),
      attemptN: attemptN,
      strength: 1,
      scope: 'work',
      globalSummary: 'MOCK 후보 ' + attemptN + ' — 장면별 다듬기 제안',
      results: results,
      generatedAt: Date.now(),
      isMock: true
    };
  }

  /* ════════════════════════════════════════════════════════════════
     v140-step2: _startTextS1V140 — 1단계 진입 (drafting 차단 + 후보 누적)
     ──────────────────────────────────────────────────────────────
     v139의 _startTextS1 박은 거 박지 X — 옛 흐름 비활성. 호출 박지 X.
     사용자 결정 #F: drafting 중에는 다른 AI 호출 차단.
     ════════════════════════════════════════════════════════════════ */
  async function _startTextS1V140() {
    /* 사용자 결정 #F — drafting 중에는 다른 AI 호출 차단 */
    if (_isS1Drafting()) {
      alert('AI 1단계 편집 중입니다. 먼저 저장/마감하거나 취소해주세요.');
      _showCandidatesModal();   /* 편집 중 후보 박은 거 박음 — drafting 상태 박힌 모달 */
      return;
    }

    /* v140 fix 2026-05-21: 4가지 분기 (사용자 명) */
    const count = _getCandidateCount();
    /* Phase A fix 2026-05-21: 실 API 박은 거 박은 거 박은 박은 — Functions 박은 거 박은 거 박은 박은 자체 quota 박음. client mock quota 박지 X. */
    const useRealApiCheck = _shouldUseRealApi();
    const remaining = useRealApiCheck ? Infinity : _getRemaining('s1');

    /* (1) 후보 X / quota X → reset 안내 모달 */
    if (count === 0 && remaining <= 0) {
      _showQuotaEmptyModal();
      return;
    }

    /* (2) 후보 O / quota X → 후보 모달 (단 [더 생성하기] 비활성 — _showCandidatesModal 박은 거 박은 거 박은 박음) */
    if (count > 0 && remaining <= 0) {
      _showCandidatesModal();
      return;
    }

    /* (3) 후보 3회 누적 (모든 회차 박힘) → 후보 모달 박음 (실 API는 Functions에서 별도 quota 박음 — 일단 client 박지 X) */
    if (!useRealApiCheck && count >= MOCK_QUOTA.s1) {
      _showCandidatesModal();
      return;
    }

    /* quota 차감 + 호출 lock */
    /* Phase A fix 2026-05-21: 실 API 박은 거 박은 거 박은 박은 — Functions 박음 quota 박음. client mockUsage 박지 X. */
    if (!useRealApiCheck) {
      _consumeQuota('s1');
    }
    _setAiTextS1Status('generating');

    const snapshot = _buildWorkSnapshot();
    /* fix 2026-05-21: snapshot은 {sceneId: scene} 객체. 길이는 Object.keys 박음. */
    const sceneCount = Object.keys(snapshot || {}).length;
    if (sceneCount === 0) {
      if (!useRealApiCheck) _refundQuota('s1');
      _setAiTextS1Status(count > 0 ? 'candidate_ready' : 'none');
      alert('1단계로 다듬을 본문이 있는 장면이 없어요.');
      return;
    }
    _showCallingModal(sceneCount);
    _currentAbort = { cancelled: false };

    let candidate;
    const useRealApi = _shouldUseRealApi();
    try {
      const attemptN = _getNextAttemptNumber();

      if (useRealApi) {
        /* Phase A — Firebase Functions 호출 (Anthropic Haiku) */
        console.log('[Phase A] callTextAiBatch 호출 박음', { attemptN, snapshot });
        const apiResult = await _phaseACallTextS1(snapshot);
        console.log('[Phase A] callTextAiBatch 응답 박힘', apiResult);
        /* Phase 2 — 서버 사전 검사 차단 응답이면 모달 안내 후 종료 (후보 생성 없음, quota 차감 없음) */
        if (apiResult && apiResult.blocked) {
          _hideCallingModal();
          _setAiTextS1Status(count > 0 ? 'candidate_ready' : 'none');
          _showAiPrecheckBlockedModal(apiResult, 's1');
          return;
        }
        if (_currentAbort && _currentAbort.cancelled) {
          /* 호출 도중 취소 — Functions quota는 차감 그대로 (환불 X) */
          _hideCallingModal();
          _setAiTextS1Status(count > 0 ? 'candidate_ready' : 'none');
          return;
        }
        /* Functions 응답 박음 → candidate 박음 */
        candidate = {
          suggestionId: apiResult.suggestionId || ('api_a' + attemptN + '_' + Date.now()),
          attemptN,
          strength: 1,
          scope: 'work',
          globalSummary: apiResult.globalSummary || '',
          results: apiResult.results || {},
          meta: apiResult.meta,
          generatedAt: Date.now(),
          isMock: false,
        };
      } else {
        /* TEST MODE 또는 fallback — mock 박음 */
        candidate = await _mockGenerateCandidate(snapshot, attemptN);
        if (_currentAbort && _currentAbort.cancelled) {
          _hideCallingModal();
          _setAiTextS1Status(count > 0 ? 'candidate_ready' : 'none');
          return;
        }
      }
      _saveAiDraftCandidate(attemptN, candidate);
    } catch (e) {
      /* mock 또는 실 API 실패 — 7가지 환불 정책 #3·#4·#5
         - mock 박은 거: _refundQuota('s1') (localStorage)
         - 실 API 박은 거: Functions 박은 거 박은 거 박은 박은 _refundQuota 자동 박음 (Firebase 트랜잭션). client _refundQuota는 박지 X — client mockUsage만 reset (실 API 박을 때 mockUsage 박지 X) */
      console.error('[v140 / Phase A] 후보 생성 실패', e);
      if (!useRealApi) {
        _refundQuota('s1');
      }
      _hideCallingModal();
      _setAiTextS1Status(count > 0 ? 'candidate_ready' : 'none');
      const prefix = useRealApi ? '[Phase A]' : '[mock]';
      alert(prefix + ' 후보 생성 실패: ' + (e && e.message || e) + '\n\n잠시 후 다시 시도해 주세요.');
      return;
    }

    _hideCallingModal();
    _showCandidatesModal();
  }

  /* ════════════════════════════════════════════════════════════════
     v140 fix 2026-05-21: quota 0 안내 모달 (사용자 명)
     ──────────────────────────────────────────────────────────────
     후보 X / quota X 박은 거 박은 거 박은 박은 — 박은 거 박은 거 박은 박은 박지 X 박은 거 박은 거 박은 박은 박음.
     TEST MODE에서는 reset 버튼 박음 — 즉시 다시 박음.
     ════════════════════════════════════════════════════════════════ */
  function _showQuotaEmptyModal() {
    const ns = _getCurrentNamespace();
    const testBtn = _isTestMode()
      ? '<button type="button" class="ai-btn ai-btn--primary js-ai-quota-reset">[현재 팀 quota 초기화]</button>'
      : '';
    const inner = ''
      + '<div class="ai-quota-empty-modal">'
      +   '<div class="ai-quota-empty-modal__head">'
      +     '<h3>1단계 테스트 횟수가 없어요</h3>'
      +     '<button type="button" class="ai-modal-close js-ai-qe-close" aria-label="닫기">×</button>'
      +   '</div>'
      +   '<div class="ai-quota-empty-modal__body">'
      +     '<p>테스트 횟수를 모두 사용했어요. TEST MODE에서는 quota를 초기화하고 다시 확인할 수 있습니다.</p>'
      +     '<p class="ai-quota-empty-team">현재 팀: <code>' + _escapeHtml(ns) + '</code></p>'
      +   '</div>'
      +   '<div class="ai-quota-empty-modal__foot">'
      +     '<button type="button" class="ai-btn ai-btn--ghost js-ai-qe-close2">[닫기]</button>'
      +     testBtn
      +   '</div>'
      + '</div>';

    const root = _createModalRoot('ai-quota-empty-root', inner, { lock: true });
    function close() { _removeModalRoot('ai-quota-empty-root'); }
    root.querySelector('.js-ai-qe-close').addEventListener('click', close);
    root.querySelector('.js-ai-qe-close2').addEventListener('click', close);
    const resetEl = root.querySelector('.js-ai-quota-reset');
    if (resetEl) {
      resetEl.addEventListener('click', function () {
        _resetMockUsage();
        close();
        alert('현재 팀 quota를 초기화했어요 (' + ns + '). 다시 [1단계 정돈]을 눌러 주세요.');
      });
    }
  }

  /* ════════════════════════════════════════════════════════════════
     v140-step2: 후보 모달 (회차 탭 — 사용자 결정 #E)
     ════════════════════════════════════════════════════════════════ */
  function _showCandidatesModal() {
    const d = _loadAiDrafts();
    const cands = (d.textS1 && d.textS1.candidates) || {};
    const attempts = Object.keys(cands)
      .filter(k => /^attempt\d+$/.test(k))
      .map(k => parseInt(k.replace('attempt', ''), 10))
      .sort(function (a, b) { return a - b; });

    if (attempts.length === 0) {
      alert('후보가 없어요.');
      return;
    }

    const remaining = _getRemaining('s1');
    const status = _getAiTextS1Status();
    const drafting = (status === 'drafting');
    const selected = (d.textS1 && d.textS1.selectedAttempt) || null;
    /* T1-FINAL-FIX-2: 후보가 실제 mock인지 판정 — 하나라도 mock이면 (mock) 표기, 전부 실 API면 표기 없음 */
    const s1IsMock = attempts.some(function (n) { return ((cands['attempt' + n] || {}).isMock === true); });

    const tabsHtml = attempts.map(function (n) {
      const active = (n === (selected || attempts[attempts.length - 1])) ? ' is-active' : '';
      return '<button type="button" class="ai-cand-tab' + active + '" data-attempt="' + n + '">' + n + '회차</button>';
    }).join('');

    const moreBtn = (remaining > 0 && !drafting)
      ? '<button type="button" class="ai-btn ai-btn--ghost js-ai-cand-more">[더 생성하기 (남은 ' + remaining + '회)]</button>'
      : '<span class="ai-cand-quota-empty">' + (drafting ? '편집 중에는 추가 생성할 수 없어요' : '남은 횟수가 없어요') + '</span>';

    const draftingNote = drafting
      ? '<div class="ai-cand-drafting-note">⚠️ AI 1단계 편집 중입니다. 먼저 저장/마감하거나 취소해주세요.</div>'
      : '';

    const inner = ''
      + '<div class="ai-cand-modal">'
      +   '<div class="ai-cand-modal__head">'
      +     '<h3>AI 1단계 후보' + (s1IsMock ? ' (mock)' : '') + '</h3>'
      +     '<button type="button" class="ai-modal-close js-ai-cand-close" aria-label="닫기">×</button>'
      +   '</div>'
      +   draftingNote
      +   '<div class="ai-cand-intro" style="margin:8px 0;padding:8px 10px;background:#f3f7ff;border-radius:8px;color:#3a5b8c;font-size:13px;line-height:1.5;">AI가 맞춤법·문장을 정돈한 제안이에요. 내용이 바뀌지 않았는지 확인하고 골라 주세요.</div>'
      +   '<div class="ai-cand-tabs">' + tabsHtml + '</div>'
      +   '<div class="ai-cand-tab-body js-ai-cand-body"></div>'
      +   '<div class="ai-cand-modal__foot">'
      +     moreBtn
      +     '<button type="button" class="ai-btn ai-btn--primary js-ai-cand-select"' + (drafting ? ' disabled' : '') + '>[이 후보 선택하기]</button>'
      +   '</div>'
      + '</div>';

    /* v140 fix 2026-05-21: lock: true 박음 — overlay 클릭/ESC 박지 X (사용자 명) */
    const root = _createModalRoot('ai-cand-modal-root', inner, { lock: true, size: 'large' });

    let activeAttempt = selected || attempts[attempts.length - 1];

    function renderBody() {
      const body = root.querySelector('.js-ai-cand-body');
      if (!body) return;
      const c = cands['attempt' + activeAttempt];
      if (!c) { body.innerHTML = '<div class="ai-cand-empty">후보가 없어요</div>'; return; }
      const snapshot = _buildWorkSnapshot();
      /* fix 2026-05-21: snapshot은 {sceneId: scene} 객체. Object.values 박음. */
      const scenes = Object.values(snapshot || {});
      const rows = scenes.map(function (s) {
        const r = c.results[s.id];   /* Functions가 sceneId 정규화 박음 — fallback 박지 X */
        if (!r) return '<div class="ai-cand-row ai-cand-row--none"><div class="ai-cand-scene-id">장면 ' + _escapeHtml(s.id) + '</div><div class="ai-cand-skip">(결과 없음)</div></div>';
        if (r.skip) return ''
          + '<div class="ai-cand-row ai-cand-row--skip">'
          +   '<div class="ai-cand-scene-id">장면 ' + _escapeHtml(s.id) + '</div>'
          +   '<div class="ai-cand-skip">✅ 수정 없음 — 원본을 그대로 유지해도 좋아요.'
          +     (r.reason ? '<span style="display:block;margin-top:2px;color:#8a8f98;font-size:12px;">이유: ' + _escapeHtml(r.reason) + '</span>' : '')
          +   '</div>'
          +   '<div style="margin-top:4px;color:#9aa0a6;font-size:12px;line-height:1.5;white-space:pre-wrap;">' + _escapeHtml(s.body || '') + '</div>'
          + '</div>';
        /* 강한 경고 박혀있으면 — UI 표시. 적용 자체 박은 거 박은 거 박은 박은 박은 — _finalizeAiVariant 박을 때 차단 박음 */
        const strongWarn = (r.appliable === false || (Array.isArray(r.strongWarnings) && r.strongWarnings.length > 0));
        const strongLabel = strongWarn
          ? '<div class="ai-cand-strong-warn">⚠️ 강한 경고 — 적용할 수 없어요 (1단계 위반 가능: ' + _escapeHtml((r.strongWarnings || []).map(w => w.reason || w).join(', ')) + ')</div>'
          : '';
        return ''
          + '<div class="ai-cand-row' + (strongWarn ? ' ai-cand-row--warn' : '') + '">'
          +   '<div class="ai-cand-scene-id">장면 ' + _escapeHtml(s.id) + '</div>'
          +   '<div class="ai-cand-split">'
          +     '<div class="ai-cand-col"><div class="ai-cand-col-label">원본</div><div class="ai-cand-col-text">' + _escapeHtml(s.body || '') + '</div></div>'
          +     '<div class="ai-cand-col"><div class="ai-cand-col-label">후보 ' + activeAttempt + '회차' + (strongWarn ? ' (적용 불가)' : '') + '</div><div class="ai-cand-col-text ai-cand-col-text--ai">' + _escapeHtml(r.revisedText || '') + '</div></div>'
          +   '</div>'
          +   strongLabel
          +   (r.summary ? '<div class="ai-cand-summary">' + _escapeHtml(r.summary) + '</div>' : '')
          + '</div>';
      }).join('');
      body.innerHTML = rows || '<div class="ai-cand-empty">결과가 없어요</div>';
    }

    renderBody();

    /* 탭 박은 거 박음 */
    root.querySelectorAll('.ai-cand-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        activeAttempt = parseInt(tab.getAttribute('data-attempt'), 10);
        root.querySelectorAll('.ai-cand-tab').forEach(function (t) { t.classList.remove('is-active'); });
        tab.classList.add('is-active');
        renderBody();
      });
    });

    /* 닫기 */
    root.querySelector('.js-ai-cand-close').addEventListener('click', function () {
      _removeModalRoot('ai-cand-modal-root');
    });

    /* [더 생성하기] */
    const moreEl = root.querySelector('.js-ai-cand-more');
    if (moreEl) {
      moreEl.addEventListener('click', function () {
        _removeModalRoot('ai-cand-modal-root');
        _startTextS1V140();   /* 다시 호출 — 누적 박힘 */
      });
    }

    /* [이 후보 선택하기] — step3 박힌 편집 중 모달 박음 */
    root.querySelector('.js-ai-cand-select').addEventListener('click', function () {
      if (drafting) return;
      _setSelectedAttempt(activeAttempt);
      _removeModalRoot('ai-cand-modal-root');
      _enterDraftingMode(activeAttempt);
    });
  }

  /* ════════════════════════════════════════════════════════════════
     v140-step3: aiVariants helper (마감된 1개만 저장)
     ──────────────────────────────────────────────────────────────
     구조 (mock — Phase A 박힐 때 Firebase 노드로):
     {
       textS1: {
         status: 'finalized',
         final: {
           sceneId: { body, source: 'attemptN', editedByUser: bool, finalizedAt }
         },
         finalizedAt: timestamp,
         sourceSuggestionId: 'mock_v140_aN_...'
       }
     }
     ⚠️ MOCK 전용 — Phase A 박힐 때 Firebase로 전환
     ════════════════════════════════════════════════════════════════ */
  function _loadAiVariants() {
    /* v140 fix 2026-05-21: 팀별 namespace 박음 */
    return _safeParseJson(localStorage.getItem(_getMockVariantsKey())) || { textS1: null };
  }

  function _saveAiVariants(variants) {
    try { localStorage.setItem(_getMockVariantsKey(), JSON.stringify(variants)); }
    catch (e) { console.warn('[ai-mock] aiVariants save failed', e); }
  }

  /* Phase 4-A: Firebase 캐시에 해당 variant 후보가 1개라도 있으면 true.
     감상자는 localStorage가 없고 FB만 있으므로 토글 노출 판단에 FB도 봐야 함.
     (_fbTextVariants는 아래에서 let 선언 — 런타임 호출 시점엔 이미 초기화됨) */
  function _fbHasVariant(variantKey) {
    if (!_fbTextVariants) return false;
    const m = _fbTextVariants[variantKey];
    return !!(m && Object.keys(m).length > 0);
  }

  function _isS1Finalized() {
    const v = _loadAiVariants();
    if (v.textS1 && v.textS1.status === 'finalized') return true;
    return _fbHasVariant('s1');
  }

  function _isS2Finalized() {
    const v = _loadAiVariants();
    if (v.textS2 && v.textS2.status === 'finalized') return true;
    return _fbHasVariant('s2');
  }

  function _getS1FinalBody(sceneId) {
    const v = _loadAiVariants();
    if (!v.textS1 || v.textS1.status !== 'finalized') return null;
    const f = v.textS1.final && v.textS1.final[sceneId];
    return f ? f.body : null;
  }

  /* ════════════════════════════════════════════════════════════════
     Phase 3: 텍스트 aiVariant Firebase 정식 저장/읽기
     ──────────────────────────────────────────────────────────────
     · 저장: saveTextVariant callable(서버 admin SDK). 원본 scene.body 불변.
     · 읽기: classes/{cid}/teams/{enc}/aiVariants/text/{sid}/{s1|s2}.body — 메모리 캐시.
     · _getDisplayBody: Firebase 우선 → localStorage fallback → 원본.
     · localStorage는 임시 캐시/백업. Firebase가 정식(canonical).
     · 실 API 사용 시에만 저장(mock 데이터 오염 방지).
     ════════════════════════════════════════════════════════════════ */
  let _fbTextVariants = null;     /* { s1:{sid:body}, s2:{sid:body} } | null(미로딩) */
  let _fbTextVariantsKey = null;  /* 'classId__teamName' — 팀 바뀌면 캐시 무효화 */
  /* Phase 4-D-1: variant layout(picturebookBodyBox) 메모리 캐시. body 캐시와 같은 로더로 채움. */
  let _fbTextVariantLayouts = null; /* { s1:{sid:{picturebookBodyBox}}, s2:{sid:{picturebookBodyBox}} } | null */

  function _fbVariantCacheKey() {
    const c = _getCurrentClassIdTeamName();
    return c.classId + '__' + c.teamName;
  }

  async function _loadFirebaseTextVariants(force) {
    const key = _fbVariantCacheKey();
    if (!force && _fbTextVariants && _fbTextVariantsKey === key) return _fbTextVariants;
    const { classId, teamName } = _getCurrentClassIdTeamName();
    if (!classId || !teamName) return null;
    const app = _getViewerFirebaseApp();
    if (!app || !app.database) return null;
    const enc = encodeURIComponent(teamName);
    try {
      const snap = await app.database().ref('classes/' + classId + '/teams/' + enc + '/aiVariants/text').once('value');
      const raw = snap.val() || {};
      const out = { s1: {}, s2: {} };
      const layoutOut = { s1: {}, s2: {} };
      Object.keys(raw).forEach(function (sid) {
        const node = raw[sid] || {};
        if (node.s1 && typeof node.s1.body === 'string') out.s1[sid] = node.s1.body;
        if (node.s2 && typeof node.s2.body === 'string') out.s2[sid] = node.s2.body;
        if (node.s1 && node.s1.layout && node.s1.layout.picturebookBodyBox) layoutOut.s1[sid] = { picturebookBodyBox: node.s1.layout.picturebookBodyBox };
        if (node.s2 && node.s2.layout && node.s2.layout.picturebookBodyBox) layoutOut.s2[sid] = { picturebookBodyBox: node.s2.layout.picturebookBodyBox };
      });
      _fbTextVariants = out;
      _fbTextVariantLayouts = layoutOut;
      _fbTextVariantsKey = key;
      return out;
    } catch (e) {
      console.warn('[Phase 3] aiVariants 읽기 실패(원본 fallback)', e);
      return null;
    }
  }

  /* 동기 — 캐시에서만 읽음. 캐시 미로딩이면 null(호출부가 localStorage/원본 fallback). */
  function _getFbVariantBody(variantKey, sceneId) {
    if (!_fbTextVariants) return null;
    const m = _fbTextVariants[variantKey];
    if (!m) return null;
    const b = m[String(sceneId)];
    return (typeof b === 'string') ? b : null;
  }

  /* Phase 4-D-1: variant layout(picturebookBodyBox) 동기 조회. FB 캐시 우선 → localStorage final → null. */
  function _getFbVariantLayout(variantKey, sceneId) {
    if (!_fbTextVariantLayouts) return null;
    const m = _fbTextVariantLayouts[variantKey];
    if (!m) return null;
    const v = m[String(sceneId)];
    return (v && v.picturebookBodyBox) ? v.picturebookBodyBox : null;
  }

  function _getLocalVariantLayout(variantKey, sceneId) {
    try {
      const v = _loadAiVariants();
      const variant = (variantKey === 's2') ? v.textS2 : v.textS1;
      const f = variant && variant.final && variant.final[String(sceneId)];
      if (f && f.layout && f.layout.picturebookBodyBox) return f.layout.picturebookBodyBox;
    } catch (e) { /* noop */ }
    return null;
  }

  /* 현재 보기 모드 기준 표시할 picturebookBodyBox 반환.
     원본 보기 → originalBox 그대로. aiS1/aiS2 보기 → variant layout(FB→local) 있으면 그것, 없으면 originalBox fallback. */
  function _getDisplayPbBodyBox(sceneId, originalBox) {
    const mode = _getAiViewMode();
    if (mode !== 'aiS1' && mode !== 'aiS2') return originalBox;
    const variantKey = (mode === 'aiS2') ? 's2' : 's1';
    const box = _getFbVariantLayout(variantKey, sceneId) || _getLocalVariantLayout(variantKey, sceneId);
    return box || originalBox;
  }

  /* 렌더 통합 진입점 — { picturebookBodyBox } 반환. originalBox는 호출부(render)가 getPicturebookBodyBox(scene)로 전달. */
  function _getDisplayLayout(sceneId, originalBox) {
    return { picturebookBodyBox: _getDisplayPbBodyBox(sceneId, originalBox) };
  }

  /* HUD preload에서 fire-and-forget. 로딩 후 프레임 재렌더 → _getDisplayBody가 Firebase 반영. */
  async function _preloadFirebaseTextVariants() {
    const out = await _loadFirebaseTextVariants(false);
    if (out && (Object.keys(out.s1).length || Object.keys(out.s2).length)) {
      /* Phase 4-A: FB 후보가 캐시에 들어왔으니 토글 바를 갱신(감상자도 노출되도록). */
      if (typeof _showAiToggleBar === 'function') {
        try { _showAiToggleBar(); } catch (e) { /* noop */ }
      }
      if (typeof window._scheduleViewerFrameReRender === 'function') {
        window._scheduleViewerFrameReRender();
      } else if (typeof _scheduleViewerFrameReRender === 'function') {
        _scheduleViewerFrameReRender();
      }
    }
    return out;
  }

  /* finalMap: {sceneId:{body,...}} (localStorage final 형태). 실 API 모드에서만 호출. */
  async function _saveTextVariantToFirebase(variantKey, finalMap) {
    if (variantKey !== 's1' && variantKey !== 's2') return { ok: false, reason: 'bad-variant' };
    const { classId, teamName } = _getCurrentClassIdTeamName();
    if (!classId || !teamName) { console.warn('[Phase 3] classId/teamName 없음 — Firebase 저장 생략'); return { ok: false, reason: 'no-context' }; }
    const scenes = {};
    Object.keys(finalMap || {}).forEach(function (sid) {
      const f = finalMap[sid];
      if (!f || typeof f.body !== 'string' || f.body.trim() === '') return;
      const e = { body: f.body };
      if (typeof f.source === 'string') e.source = f.source;
      if (typeof f.editedByUser === 'boolean') e.editedByUser = f.editedByUser;
      if (f.addedElements && typeof f.addedElements === 'object') e.addedElements = f.addedElements;
      if (typeof f.riskLevel === 'string') e.riskLevel = f.riskLevel;
      scenes[sid] = e;
    });
    if (Object.keys(scenes).length === 0) return { ok: false, reason: 'empty' };
    const branchLineage = (typeof ViewerState !== 'undefined' && ViewerState.branchLineage) || {};
    const payload = {
      classId, teamName,
      workId: teamName,
      rootBranchId: branchLineage.rootBranchId || null,
      copyDepth: branchLineage.copyDepth || 0,
      variant: variantKey,
      scenes: scenes,
    };
    try {
      const data = await _callPhaseAFunction('saveTextVariant', payload);
      if (data && data.blocked) {
        console.warn('[Phase 3] Firebase 저장 차단(safety)', data.reasonCode, data.categories);
        return { ok: false, blocked: true, data: data };
      }
      await _loadFirebaseTextVariants(true);   /* 캐시 갱신 */
      console.info('[Phase 3] Firebase 저장 완료', variantKey, (data && data.savedSceneIds) || []);
      return { ok: true, data: data };
    } catch (e) {
      console.warn('[Phase 3] Firebase 저장 실패(로컬은 유지)', e);
      return { ok: false, error: e && e.message };
    }
  }

  /* ════════════════════════════════════════════════════════════════
     Phase 4-C: variant body 편집 저장 (s1/s2 보기 중 본문만 수정)
     ──────────────────────────────────────────────────────────────
     · 편집 대상 = variant body 1종만. 원본 scene.body는 절대 건드리지 않음.
     · 낙관적 버퍼: 입력 즉시 FB 메모리 캐시 + localStorage 백업 갱신 → 재렌더해도 유지.
     · 저장 = saveTextVariant(mode:'patchBody') — 기존 variant 메타 보존, body만 갱신.
     · 성공 시 FB 캐시를 서버 정본으로 재동기화. 실패 시 버퍼 유지 + 재시도 큐.
     · ViewerState.scenes[id].body는 어떤 경로에서도 수정 X.
     ════════════════════════════════════════════════════════════════ */

  /* 해당 장면에 그 variant 후보가 있는지(FB 캐시 또는 localStorage final). */
  function _variantHasCandidate(variantKey, sceneId) {
    const sid = String(sceneId);
    if (_getFbVariantBody(variantKey, sid) != null) return true;
    const v = _loadAiVariants();
    const variant = (variantKey === 's2') ? v.textS2 : v.textS1;
    if (variant && variant.status === 'finalized' && variant.final
        && variant.final[sid] && typeof variant.final[sid].body === 'string') return true;
    return false;
  }

  /* 현재 이 장면 body를 variant 편집할 수 있으면 variantKey('s1'|'s2') 반환, 아니면 null.
     조건: editMode(감상자 X) + text/picturebook + aiS1/aiS2 보기 + 그 variant 후보 존재. */
  function _aiVariantBodyEditAllowed(sceneId) {
    if (!(typeof ViewerState !== 'undefined' && ViewerState.editMode)) return null;
    if (!_aiToggleProjectTypeAllowed()) return null;
    const mode = _getAiViewMode();
    if (mode !== 'aiS1' && mode !== 'aiS2') return null;
    const variantKey = (mode === 'aiS2') ? 's2' : 's1';
    if (!_variantHasCandidate(variantKey, sceneId)) return null;
    return variantKey;
  }

  /* Phase 4-D-1: 현재 이 장면 글상자(picturebookBodyBox)를 variant 편집할 수 있으면 variantKey 반환, 아니면 null.
     조건은 body 편집과 동일(editMode + text/picturebook + aiS1/aiS2 보기 + 그 variant 후보 존재). */
  function _aiVariantLayoutEditAllowed(sceneId) {
    return _aiVariantBodyEditAllowed(sceneId);
  }

  /* 낙관적 버퍼 — FB 메모리 캐시 + localStorage 백업만 갱신. scene.body 절대 미수정. */
  function _setVariantBodyBuffer(variantKey, sceneId, value) {
    const sid = String(sceneId);
    if (!_fbTextVariants) { _fbTextVariants = { s1: {}, s2: {} }; _fbTextVariantsKey = _fbVariantCacheKey(); }
    if (!_fbTextVariants[variantKey]) _fbTextVariants[variantKey] = {};
    _fbTextVariants[variantKey][sid] = value;
    try {
      const v = _loadAiVariants();
      const tk = (variantKey === 's2') ? 'textS2' : 'textS1';
      if (!v[tk]) v[tk] = { status: 'finalized', final: {} };
      if (v[tk].status !== 'finalized') v[tk].status = 'finalized';
      if (!v[tk].final) v[tk].final = {};
      const prev = v[tk].final[sid] || {};
      v[tk].final[sid] = Object.assign({}, prev, { body: value, editedByUser: true });
      _saveAiVariants(v);
    } catch (e) { /* noop */ }
  }

  /* 작은 인라인 상태 표시 — 토글 바 위쪽 고정(인스펙터가 잠겨도 보임). */
  let _variantStatusTimer = null;
  function _ensureVariantStatusEl() {
    let el = document.getElementById('ai-variant-save-status');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'ai-variant-save-status';
    el.className = 'ai-variant-save-status';
    el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:54px;z-index:60;'
      + "font-family:'Jua',sans-serif;font-size:12px;color:#6b5638;background:rgba(251,246,234,0.96);"
      + 'border:1px solid #e6d9bf;border-radius:14px;padding:5px 14px;box-shadow:0 2px 8px rgba(0,0,0,0.08);'
      + 'pointer-events:none;opacity:0;transition:opacity .15s;max-width:80vw;text-align:center;';
    document.body.appendChild(el);
    return el;
  }
  function _showVariantSaveStatus(text, autoClearMs) {
    try {
      const el = _ensureVariantStatusEl();
      el.textContent = text || '';
      el.style.opacity = text ? '1' : '0';
      if (_variantStatusTimer) { clearTimeout(_variantStatusTimer); _variantStatusTimer = null; }
      if (autoClearMs && autoClearMs > 0) {
        _variantStatusTimer = setTimeout(function () {
          const c = document.getElementById('ai-variant-save-status');
          if (c) c.style.opacity = '0';
        }, autoClearMs);
      }
    } catch (e) { /* noop */ }
  }

  /* patchBody 저장 — 별도 경로. 원본 _flushPendingSave/saveSceneText 절대 재사용 X. */
  async function _saveVariantBodyPatch(variantKey, scenesBodyMap) {
    if (variantKey !== 's1' && variantKey !== 's2') return { ok: false, reason: 'bad-variant' };
    const { classId, teamName } = _getCurrentClassIdTeamName();
    if (!classId || !teamName) return { ok: false, reason: 'no-context' };
    const scenes = {};
    Object.keys(scenesBodyMap || {}).forEach(function (sid) {
      const b = scenesBodyMap[sid] && scenesBodyMap[sid].body;
      if (typeof b === 'string' && b.trim() !== '') scenes[sid] = { body: b };
    });
    if (Object.keys(scenes).length === 0) return { ok: false, reason: 'empty' };
    const branchLineage = (typeof ViewerState !== 'undefined' && ViewerState.branchLineage) || {};
    const payload = {
      classId, teamName, workId: teamName,
      rootBranchId: branchLineage.rootBranchId || null,
      copyDepth: branchLineage.copyDepth || 0,
      variant: variantKey,
      mode: 'patchBody',
      scenes: scenes,
    };
    try {
      const data = await _callPhaseAFunction('saveTextVariant', payload);
      if (data && data.blocked) return { ok: false, blocked: true, data: data };
      return { ok: true, data: data };
    } catch (e) {
      return { ok: false, error: e && e.message };
    }
  }

  /* 저장 큐 — pending[variantKey:sceneId] = {variantKey,sceneId,value}. */
  const _variantSave = { pending: {}, timer: null, saving: false };

  function _queueVariantBodySave(variantKey, sceneId, value) {
    if (variantKey !== 's1' && variantKey !== 's2') return;
    const sid = String(sceneId);
    _setVariantBodyBuffer(variantKey, sid, value);
    _variantSave.pending[variantKey + ':' + sid] = { variantKey: variantKey, sceneId: sid, value: value };
    _showVariantSaveStatus('AI 버전을 수정 중입니다. 원본은 바뀌지 않습니다.', 0);
    if (_variantSave.timer) clearTimeout(_variantSave.timer);
    _variantSave.timer = setTimeout(function () { _flushVariantBodySave(); }, 600);
  }

  async function _flushVariantBodySave() {
    if (_variantSave.timer) { clearTimeout(_variantSave.timer); _variantSave.timer = null; }
    if (_variantSave.saving) return;             /* 진행 중이면 끝나고 자체 재호출됨 */
    const keys = Object.keys(_variantSave.pending);
    if (keys.length === 0) return;

    const byVariant = { s1: {}, s2: {} };
    keys.forEach(function (k) {
      const p = _variantSave.pending[k];
      byVariant[p.variantKey][p.sceneId] = { body: p.value };
    });
    const snapshot = _variantSave.pending;
    _variantSave.pending = {};
    _variantSave.saving = true;
    _showVariantSaveStatus('저장 중…', 0);

    let anyFail = false, blocked = false;
    for (const vk of ['s1', 's2']) {
      if (Object.keys(byVariant[vk]).length === 0) continue;
      const res = await _saveVariantBodyPatch(vk, byVariant[vk]);   /* eslint-disable-line no-await-in-loop */
      if (res && res.blocked) { blocked = true; anyFail = true; }
      else if (!res || !res.ok) { anyFail = true; }
    }
    _variantSave.saving = false;

    if (blocked) {
      /* 차단 — 서버 미저장. 버퍼(낙관적 본문)는 유지해 사용자가 표현을 고칠 수 있게 함. */
      _showVariantSaveStatus('AI 버전에 저장하기 어려운 표현이 있어요. 표현을 직접 바꾼 뒤 다시 시도해 주세요.', 5000);
    } else if (anyFail) {
      /* 실패 — 재시도 가능하도록 pending 복원(그 사이 새 입력이 우선). */
      Object.keys(snapshot).forEach(function (k) {
        if (!_variantSave.pending[k]) _variantSave.pending[k] = snapshot[k];
      });
      _showVariantSaveStatus('저장 실패 — 다시 시도해 주세요.', 4000);
    } else {
      /* 성공 — FB 캐시를 서버 정본으로 재동기화(제출값과 동일). 재렌더는 커서 보호 위해 생략. */
      try { await _loadFirebaseTextVariants(true); } catch (e) { /* noop */ }
      _showVariantSaveStatus('저장됨', 1500);
    }
    /* 저장 도중 들어온 새 입력 처리. */
    if (Object.keys(_variantSave.pending).length > 0) _flushVariantBodySave();
  }

  /* ════════════════════════════════════════════════════════════════
     Phase 4-D-1: variant layout(picturebookBodyBox) 편집 저장
     ──────────────────────────────────────────────────────────────
     · 편집 대상 = variant 글상자 위치/크기 1종. 원본 scene.picturebookBodyBox는 절대 미변경.
     · 낙관적 버퍼: 드래그 즉시 FB 메모리 캐시 + localStorage 백업 갱신 → 재렌더해도 유지.
     · 저장 = saveTextVariant(mode:'patchLayout') — body/메타 보존, layout.picturebookBodyBox만 갱신.
     · body 저장 큐(_variantSave)와 완전히 분리된 별도 큐.
     ════════════════════════════════════════════════════════════════ */

  /* 낙관적 버퍼 — FB layout 캐시 + localStorage final.layout 백업만 갱신. scene.picturebookBodyBox 미수정. */
  function _setVariantLayoutBuffer(variantKey, sceneId, pbBodyBox) {
    const sid = String(sceneId);
    if (!_fbTextVariantLayouts) _fbTextVariantLayouts = { s1: {}, s2: {} };
    if (!_fbTextVariantLayouts[variantKey]) _fbTextVariantLayouts[variantKey] = {};
    _fbTextVariantLayouts[variantKey][sid] = { picturebookBodyBox: Object.assign({}, pbBodyBox) };
    try {
      const v = _loadAiVariants();
      const tk = (variantKey === 's2') ? 'textS2' : 'textS1';
      if (!v[tk]) v[tk] = { status: 'finalized', final: {} };
      if (!v[tk].final) v[tk].final = {};
      const prev = v[tk].final[sid] || {};
      const prevLayout = prev.layout || {};
      v[tk].final[sid] = Object.assign({}, prev, { layout: Object.assign({}, prevLayout, { picturebookBodyBox: Object.assign({}, pbBodyBox) }) });
      _saveAiVariants(v);
    } catch (e) { /* noop */ }
  }

  /* patchLayout 저장 — 별도 경로. 원본 layout 저장(saveSceneText/_queueSave) 절대 재사용 X. */
  async function _saveVariantLayoutPatch(variantKey, scenesLayoutMap) {
    if (variantKey !== 's1' && variantKey !== 's2') return { ok: false, reason: 'bad-variant' };
    const { classId, teamName } = _getCurrentClassIdTeamName();
    if (!classId || !teamName) return { ok: false, reason: 'no-context' };
    const scenes = {};
    Object.keys(scenesLayoutMap || {}).forEach(function (sid) {
      const box = scenesLayoutMap[sid] && scenesLayoutMap[sid].picturebookBodyBox;
      if (box && typeof box === 'object') scenes[sid] = { layout: { picturebookBodyBox: box } };
    });
    if (Object.keys(scenes).length === 0) return { ok: false, reason: 'empty' };
    const branchLineage = (typeof ViewerState !== 'undefined' && ViewerState.branchLineage) || {};
    const payload = {
      classId, teamName, workId: teamName,
      rootBranchId: branchLineage.rootBranchId || null,
      copyDepth: branchLineage.copyDepth || 0,
      variant: variantKey,
      mode: 'patchLayout',
      scenes: scenes,
    };
    try {
      const data = await _callPhaseAFunction('saveTextVariant', payload);
      if (data && data.blocked) return { ok: false, blocked: true, data: data };
      return { ok: true, data: data };
    } catch (e) {
      return { ok: false, error: e && e.message };
    }
  }

  /* layout 저장 큐 — body 큐와 분리. pending[variantKey:sceneId] = {variantKey,sceneId,box}. */
  const _variantLayoutSave = { pending: {}, timer: null, saving: false };

  function _queueVariantLayoutSave(variantKey, sceneId, pbBodyBox) {
    if (variantKey !== 's1' && variantKey !== 's2') return;
    const sid = String(sceneId);
    _setVariantLayoutBuffer(variantKey, sid, pbBodyBox);
    _variantLayoutSave.pending[variantKey + ':' + sid] = { variantKey: variantKey, sceneId: sid, box: Object.assign({}, pbBodyBox) };
    _showVariantSaveStatus('AI 버전의 글상자 위치를 조정 중입니다. 원본 위치는 바뀌지 않습니다.', 0);
    if (_variantLayoutSave.timer) clearTimeout(_variantLayoutSave.timer);
    _variantLayoutSave.timer = setTimeout(function () { _flushVariantLayoutSave(); }, 700);
  }

  async function _flushVariantLayoutSave() {
    if (_variantLayoutSave.timer) { clearTimeout(_variantLayoutSave.timer); _variantLayoutSave.timer = null; }
    if (_variantLayoutSave.saving) return;
    const keys = Object.keys(_variantLayoutSave.pending);
    if (keys.length === 0) return;

    const byVariant = { s1: {}, s2: {} };
    keys.forEach(function (k) {
      const p = _variantLayoutSave.pending[k];
      byVariant[p.variantKey][p.sceneId] = { picturebookBodyBox: p.box };
    });
    const snapshot = _variantLayoutSave.pending;
    _variantLayoutSave.pending = {};
    _variantLayoutSave.saving = true;
    _showVariantSaveStatus('저장 중…', 0);

    let anyFail = false;
    for (const vk of ['s1', 's2']) {
      if (Object.keys(byVariant[vk]).length === 0) continue;
      const res = await _saveVariantLayoutPatch(vk, byVariant[vk]);   /* eslint-disable-line no-await-in-loop */
      if (!res || !res.ok) anyFail = true;
    }
    _variantLayoutSave.saving = false;

    if (anyFail) {
      Object.keys(snapshot).forEach(function (k) {
        if (!_variantLayoutSave.pending[k]) _variantLayoutSave.pending[k] = snapshot[k];
      });
      _showVariantSaveStatus('글상자 위치 저장 실패 — 다시 시도해 주세요.', 4000);
    } else {
      try { await _loadFirebaseTextVariants(true); } catch (e) { /* noop */ }
      _showVariantSaveStatus('저장됨', 1500);
    }
    if (Object.keys(_variantLayoutSave.pending).length > 0) _flushVariantLayoutSave();
  }

  /* ════════════════════════════════════════════════════════════════
     v140-step3: 편집 중 모달 (drafting)
     ──────────────────────────────────────────────────────────────
     사용자 결정 #C — 마감 후 aiDrafts.textS1 기본 정리. TEST MODE에서 보존/초기화 선택 가능.
     ════════════════════════════════════════════════════════════════ */
  function _enterDraftingMode(attemptN) {
    /* status 박은 거 박은 거 박음 (selectedAttempt 박은 거 박은 거 박음) */
    const d = _loadAiDrafts();
    if (!d.textS1) return;
    d.textS1.selectedAttempt = attemptN;
    d.textS1.status = 'drafting';
    if (!d.textS1.editedDraftByScene) d.textS1.editedDraftByScene = {};
    _saveAiDrafts(d);
    _showDraftingPanel();
  }

  function _showDraftingPanel() {
    const d = _loadAiDrafts();
    if (!d.textS1 || d.textS1.status !== 'drafting' || !d.textS1.selectedAttempt) {
      alert('편집 중인 상태가 없어요.');
      return;
    }
    const attemptN = d.textS1.selectedAttempt;
    const cand = d.textS1.candidates && d.textS1.candidates['attempt' + attemptN];
    if (!cand) {
      alert('선택된 후보가 없어요.');
      return;
    }

    const snapshot = _buildWorkSnapshot();
    const edited = d.textS1.editedDraftByScene || {};

    /* fix 2026-05-21: snapshot은 {sceneId: scene} 객체. Object.values 박음. */
    const rows = Object.values(snapshot || {}).map(function (s) {
      const r = cand.results[s.id];   /* Functions가 sceneId 정규화 박음 */
      if (!r) {
        return ''
          + '<div class="ai-draft-row ai-draft-row--none">'
          +   '<div class="ai-draft-scene-id">장면 ' + _escapeHtml(s.id) + '</div>'
          +   '<div class="ai-draft-skip">(결과 없음 — 원본 유지)</div>'
          + '</div>';
      }
      if (r.skip) {
        return ''
          + '<div class="ai-draft-row ai-draft-row--skip">'
          +   '<div class="ai-draft-scene-id">장면 ' + _escapeHtml(s.id) + '</div>'
          +   '<div class="ai-draft-skip">✅ 수정 없음 — 원본을 그대로 유지해도 좋아요.'
          +     (r.reason ? '<span style="display:block;margin-top:2px;color:#8a8f98;font-size:12px;">이유: ' + _escapeHtml(r.reason) + '</span>' : '')
          +   '</div>'
          +   '<div style="margin-top:4px;color:#9aa0a6;font-size:12px;line-height:1.5;white-space:pre-wrap;">' + _escapeHtml(s.body || '') + '</div>'
          + '</div>';
      }
      const initialText = (s.id in edited) ? edited[s.id] : (r.revisedText || '');
      return ''
        + '<div class="ai-draft-row">'
        +   '<div class="ai-draft-scene-id">장면 ' + _escapeHtml(s.id) + '</div>'
        +   '<div class="ai-draft-original">'
        +     '<div class="ai-draft-label">원본</div>'
        +     '<div class="ai-draft-original-text">' + _escapeHtml(s.body || '') + '</div>'
        +   '</div>'
        +   '<div class="ai-draft-edit">'
        +     '<div class="ai-draft-label">AI ' + attemptN + '회차 (수정 가능 — 맞춤법·띄어쓰기·조사·문장 연결)</div>'
        +     '<textarea class="ai-draft-textarea js-ai-draft-textarea" data-scene-id="' + _escapeHtml(s.id) + '" rows="3">' + _escapeHtmlText(_brToNewline(initialText)) + '</textarea>'
        +   '</div>'
        + '</div>';
    }).join('');

    const inner = ''
      + '<div class="ai-draft-modal">'
      +   '<div class="ai-draft-modal__head">'
      +     '<h3>AI 1단계 편집 중 — ' + attemptN + '회차' + (cand && cand.isMock ? ' (mock)' : '') + '</h3>'
      +     '<button type="button" class="ai-modal-close js-ai-draft-close" aria-label="닫기">×</button>'
      +   '</div>'
      +   '<div class="ai-draft-note">'
      +     '맞춤법·띄어쓰기·조사·문장 연결만 수정해주세요. <br>'
      +     '새 사건·인물·대사·배경·감정 추가는 1단계 취지와 안 맞아요 (그건 2단계).'
      +   '</div>'
      +   '<div class="ai-draft-body js-ai-draft-body">' + rows + '</div>'
      +   '<div class="ai-draft-modal__foot">'
      +     '<button type="button" class="ai-btn ai-btn--ghost js-ai-draft-cancel">[취소]</button>'
      +     '<button type="button" class="ai-btn ai-btn--primary js-ai-draft-finalize">[AI 1단계 저장/마감]</button>'
      +   '</div>'
      + '</div>';

    /* v140 fix 2026-05-21: lock: true 박음 — 편집 중 textarea 박은 거 박은 거 박은 박은 — overlay/ESC 박지 X (사용자 명) */
    const root = _createModalRoot('ai-draft-modal-root', inner, { lock: true, size: 'large' });

    /* textarea 박힌 거 박은 거 박음 (debounce 박지 X — 단순 onblur·oninput 박음) */
    root.querySelectorAll('.js-ai-draft-textarea').forEach(function (ta) {
      ta.addEventListener('input', function () {
        const sid = ta.getAttribute('data-scene-id');
        _saveDraftEdit(sid, ta.value);
      });
    });

    root.querySelector('.js-ai-draft-close').addEventListener('click', function () {
      _removeModalRoot('ai-draft-modal-root');
    });

    root.querySelector('.js-ai-draft-cancel').addEventListener('click', function () {
      if (!confirm('편집한 내용이 저장되지 않아요. 취소할까요?')) return;
      _cancelDrafting();
      _removeModalRoot('ai-draft-modal-root');
    });

    root.querySelector('.js-ai-draft-finalize').addEventListener('click', function () {
      _finalizeAiVariant();
      _removeModalRoot('ai-draft-modal-root');
      alert('AI 1단계를 저장했어요. viewer 상단 [원본] [AI 1단계] 토글로 전환할 수 있어요.');
    });
  }

  function _saveDraftEdit(sceneId, newBody) {
    const d = _loadAiDrafts();
    if (!d.textS1) return;
    if (!d.textS1.editedDraftByScene) d.textS1.editedDraftByScene = {};
    d.textS1.editedDraftByScene[sceneId] = newBody;
    _saveAiDrafts(d);
  }

  function _cancelDrafting() {
    const d = _loadAiDrafts();
    if (!d.textS1) return;
    /* selectedAttempt 박지 X 박음, edited 박지 X 박음, status candidate_ready로 */
    d.textS1.selectedAttempt = null;
    d.textS1.editedDraftByScene = {};
    d.textS1.status = (_getCandidateCount() > 0) ? 'candidate_ready' : 'none';
    _saveAiDrafts(d);
  }

  /* ════════════════════════════════════════════════════════════════
     v140-step4: AI 보기 토글 (사용자 결정 #D)
     ──────────────────────────────────────────────────────────────
     별도 토글 바 박음. maker-return-bar 박지 X.
     viewer-render.js 박은 6 곳 박은 거 박은 _getDisplayBody 박은 거 박을 거.
     ════════════════════════════════════════════════════════════════ */
  function _getAiViewMode() {
    /* v140 fix 2026-05-21: 팀별 namespace 박음. 2026-06: aiS2 추가(3-way). */
    try {
      const v = localStorage.getItem(_getMockViewModeKey());
      return (v === 'aiS1' || v === 'aiS2') ? v : 'original';
    } catch (e) { return 'original'; }
  }

  /* Phase 4-A: 현재 보기가 AI 변형(s1/s2)인지. viewer-edit.js가 편집/저장 잠금 판단에 사용. */
  function _isAiVariantViewMode() {
    const m = _getAiViewMode();
    return m === 'aiS1' || m === 'aiS2';
  }

  /* Phase 4-A: AI 토글은 text/picturebook 작품에서만. movie/experience 절대 표시 X.
     renderHUD의 AI 버튼 게이트(_aiPtypeAllowed)와 동일 기준. */
  function _aiToggleProjectTypeAllowed() {
    return !!(typeof ViewerState !== 'undefined' && ViewerState.project &&
      (ViewerState.project.projectType === 'text' || ViewerState.project.projectType === 'picturebook'));
  }

  /* Phase 4-A: 변형(s1/s2) 보기 중엔 인스펙터(원본 편집 컨트롤) 비활성 — 원본 in-memory 변경까지 차단.
     저장 자체는 viewer-edit.js의 잠금이 막지만, 패널 슬라이더가 scene 객체를 메모리에서 건드리는 것까지
     원천 차단해 원본 layout이 세션 중 흔들리지 않게 함. 감상자는 패널이 없어 무관. */
  function _applyVariantEditPanelLock() {
    try {
      const panel = document.getElementById('edit-panel');
      if (!panel) return;
      const locked = _isAiVariantViewMode();
      panel.style.pointerEvents = locked ? 'none' : '';
      panel.style.opacity = locked ? '0.5' : '';
    } catch (e) { /* noop */ }
  }

  /* Phase 4-B 보강: 토글 전환 시 현재 장면을 즉시 직접 재렌더.
     _scheduleViewerFrameReRender는 requestAnimationFrame 기반이라 백그라운드/숨김 탭에선
     rAF가 정지(throttle)돼 변형 잠금 화면(contenteditable/핸들 제거)이 늦게 떠
     그 사이 살아있는 contenteditable로 in-memory scene.body가 일시 변조될 수 있다.
     hidden 상황에서만 보조 렌더를 돌려, 정상 탭에선 rAF 경로 그대로(중복 렌더 없음). */
  function _forceCurrentSceneReRender() {
    try {
      const VS = (typeof ViewerState !== 'undefined')
        ? ViewerState
        : (typeof window !== 'undefined' ? window.ViewerState : null);
      if (!VS || !VS.scenes) return;
      const scene = VS.scenes[VS.currentSceneId];
      const fn = (typeof renderScene === 'function')
        ? renderScene
        : (typeof window !== 'undefined' ? window.renderScene : null);
      if (scene && typeof fn === 'function') fn(scene);
    } catch (e) { /* noop */ }
  }

  function _setAiViewMode(mode) {
    /* Phase 4-A: 모드 전환 전, 원본 보기에서 편집 중이던 pending save를 먼저 flush.
       전환 후엔 잠금 상태라 _flushPendingSave가 막히므로 반드시 변경 전에. */
    try {
      if (typeof window !== 'undefined' && typeof window._flushPendingSave === 'function') {
        window._flushPendingSave();
      } else if (typeof _flushPendingSave === 'function') {
        _flushPendingSave();
      }
    } catch (e) { /* noop */ }
    /* Phase 4-C: variant body 편집 pending도 전환 전에 flush(변형 전환 시 유실 방지). */
    try { _flushVariantBodySave(); } catch (e) { /* noop */ }
    /* Phase 4-D-1: variant layout(글상자) 편집 pending도 전환 전에 flush. */
    try { _flushVariantLayoutSave(); } catch (e) { /* noop */ }
    try {
      if (mode === 'aiS1' || mode === 'aiS2') localStorage.setItem(_getMockViewModeKey(), mode);
      else localStorage.removeItem(_getMockViewModeKey());
    } catch (e) { /* noop */ }
    _updateAiToggleBar();
    _applyVariantEditPanelLock();
    /* viewer 본문 박은 거 박은 거 박은 거 박은 거 — v138 박은 _scheduleViewerFrameReRender 박은 거 박음 */
    if (typeof window._scheduleViewerFrameReRender === 'function') {
      window._scheduleViewerFrameReRender();
    } else if (typeof _scheduleViewerFrameReRender === 'function') {
      _scheduleViewerFrameReRender();
    }
    /* Phase 4-B 보강: rAF가 정지되는 숨김 탭에서만 보조 재렌더(비동기 → 재진입 안전).
       정상 탭은 위 rAF 경로가 ~16ms 내 처리하므로 이 보조는 건너뛴다(중복 렌더 방지). */
    try {
      if (typeof document !== 'undefined' && document.hidden) {
        setTimeout(_forceCurrentSceneReRender, 0);
      }
    } catch (e) { /* noop */ }
  }

  /* viewer-render.js 박은 거 박은 거 박은 본문 박은 거 박은 거 박은 거 박은 — 토글 mode에 따라 박은 거 박음 */
  function _getDisplayBody(sceneId, originalBody) {
    const mode = _getAiViewMode();
    if (mode !== 'aiS1' && mode !== 'aiS2') return originalBody;
    const variantKey = (mode === 'aiS2') ? 's2' : 's1';
    /* Firebase 우선 (정식 저장 — 캐시). 있으면 그대로.
       BR-FIX-1: 옛 변형 데이터에 섞인 리터럴 <br/>를 실제 \n으로 정규화해 반환
       (render escHtml + CSS white-space:pre-wrap에서 줄바꿈으로 보임). 원본은 미정규화 유지. */
    const fb = _getFbVariantBody(variantKey, sceneId);
    if (typeof fb === 'string') return _brToNewline(fb);
    /* localStorage fallback (임시 캐시/백업) */
    const v = _loadAiVariants();
    const variant = (mode === 'aiS2') ? v.textS2 : v.textS1;
    if (!variant || variant.status !== 'finalized') return originalBody;
    const f = variant.final && variant.final[sceneId];
    if (!f || typeof f.body !== 'string') return originalBody;
    return _brToNewline(f.body);
  }

  function _showAiToggleBar() {
    /* Phase 4-A: text/picturebook 작품에서만. movie/experience엔 절대 표시 X. */
    if (!_aiToggleProjectTypeAllowed()) { _hideAiToggleBar(); return; }
    /* 2026-06: 3-way. s1 또는 s2가 finalized(localStorage) 또는 Firebase 후보 존재면 표시. */
    const hasS1 = _isS1Finalized();
    const hasS2 = _isS2Finalized();
    if (!hasS1 && !hasS2) { _hideAiToggleBar(); return; }
    /* Phase 4-A: 감상자/편집자 공통 표시. (이전엔 editMode에서만 표시 → 감상자 토글 불가였음.)
       감상자는 editMode=false라 편집 핸들/contenteditable이 원천적으로 없어 보기 전용으로 안전. */

    /* 현재 보기 mode가 더 이상 유효하지 않으면 원본으로 정리 (setMode가 재렌더+업데이트) */
    const cur = _getAiViewMode();
    if ((cur === 'aiS1' && !hasS1) || (cur === 'aiS2' && !hasS2)) {
      _setAiViewMode('original');
    }

    _hideAiToggleBar();
    const bar = document.createElement('div');
    bar.id = 'ai-view-toggle-bar';
    bar.className = 'ai-view-toggle-bar';
    let html = '<span class="ai-view-toggle-bar__label">보기 모드:</span>'
      + '<button type="button" class="ai-view-toggle-btn js-ai-view-original" data-mode="original">원본</button>';
    if (hasS1) html += '<button type="button" class="ai-view-toggle-btn js-ai-view-ais1" data-mode="aiS1">AI 문장 정돈</button>';
    if (hasS2) html += '<button type="button" class="ai-view-toggle-btn js-ai-view-ais2" data-mode="aiS2">AI 장면 발전</button>';
    bar.innerHTML = html;
    document.body.appendChild(bar);
    bar.querySelectorAll('.ai-view-toggle-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _setAiViewMode(btn.getAttribute('data-mode'));
      });
    });
    _updateAiToggleBar();
    _applyVariantEditPanelLock();
  }

  function _updateAiToggleBar() {
    const bar = document.getElementById('ai-view-toggle-bar');
    if (!bar) return;
    const mode = _getAiViewMode();
    bar.querySelectorAll('.ai-view-toggle-btn').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-mode') === mode);
    });
  }

  function _hideAiToggleBar() {
    const bar = document.getElementById('ai-view-toggle-bar');
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
  }

  /* DOMContentLoaded 박은 거 박은 거 박은 — finalized 박혀있고 edit 박혀있을 때만 박음 */
  function _bootstrapAiToggleBar() {
    const run = function () {
      _showAiToggleBar();
      /* ViewerState 박은 거 박은 거 박은 거 박은 거 박은 — editMode 박은 거 박은 거 박은 거 박은 거 박은 거 박은 거.
         박은 거 박은 거 박은 거 박은 — viewer entry 박은 거 박은 거 박은 거 박은 거 박은 거. 박은 거 박은 거 — 박은 거 박은 거 박은 거 박은 거 박은 거 박은 거 박은 거 박은 거 박은 거 박은 거 박은 거 박은 거 박은 거 박은 거 박은 거 박은 거 박은 거 박은 거. */
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run);
    } else {
      run();
    }
  }

  function _finalizeAiVariant() {
    const d = _loadAiDrafts();
    if (!d.textS1 || d.textS1.status !== 'drafting' || !d.textS1.selectedAttempt) return;
    const attemptN = d.textS1.selectedAttempt;
    const cand = d.textS1.candidates && d.textS1.candidates['attempt' + attemptN];
    if (!cand) return;
    const edited = d.textS1.editedDraftByScene || {};
    const snapshot = _buildWorkSnapshot();

    const final = {};
    /* fix 2026-05-21: snapshot은 {sceneId: scene} 객체. Object.values 박음. */
    Object.values(snapshot || {}).forEach(function (s) {
      if (!s) return;
      const r = cand.results[s.id];   /* Functions가 sceneId 정규화 박음 */
      if (!r || r.skip) return;  /* skip 박은 거 박은 거 박지 X — 원본 박힘 */
      /* GPT 피드백 #3: 강한 경고 박힌 결과는 적용 박지 X (원본 박힘) */
      if (r.appliable === false || (Array.isArray(r.strongWarnings) && r.strongWarnings.length > 0)) {
        console.warn('[Phase A] 장면', s.id, '— 강한 경고 박혀 적용 X', r.strongWarnings);
        return;
      }
      const isEdited = (s.id in edited);
      /* BR-FIX-1: 옛 세션의 버그(textarea에 <br/> 주입)로 edited 버퍼에 리터럴 <br/>가
         남아있을 수 있어 저장 직전 \n으로 정규화. 새 편집은 이미 깨끗. */
      const body = _brToNewline(isEdited ? edited[s.id] : (r.revisedText || ''));
      final[s.id] = {
        body: body,
        source: 'attempt' + attemptN,
        editedByUser: isEdited,
        finalizedAt: Date.now()
      };
    });

    const v = _loadAiVariants();
    v.textS1 = {
      status: 'finalized',
      final: final,
      finalizedAt: Date.now(),
      sourceSuggestionId: cand.suggestionId
    };
    _saveAiVariants(v);

    /* Phase 3 — 실 API 모드에서 Firebase 정식 저장(원본 scene.body 불변, 서버 경유).
       localStorage는 백업으로 유지. mock/테스트 모드는 Firebase 저장 생략(오염 방지). */
    if (_shouldUseRealApi()) {
      _saveTextVariantToFirebase('s1', final);   /* fire-and-forget */
    }

    /* 사용자 결정 #C — 마감 후 aiDrafts 기본 정리. TEST MODE에서는 보존/초기화 선택 가능. */
    if (_isTestMode()) {
      const keep = confirm('[TEST MODE] aiDrafts를 보존할까요?\n\nOK = 보존 (3 후보 + 편집 상태 확인 가능)\n취소 = 정리 (운영과 동일)');
      if (!keep) {
        try { localStorage.removeItem(LS_AI_DRAFTS_KEY); } catch (e) { /* noop */ }
      } else {
        /* status는 finalized로 박음 (selectedAttempt 박은 거 박은 거 박힘) */
        d.textS1.status = 'finalized';
        _saveAiDrafts(d);
      }
    } else {
      try { localStorage.removeItem(LS_AI_DRAFTS_KEY); } catch (e) { /* noop */ }
    }

    /* step4: 마감 박은 후 토글 바 박음 + viewer 박은 거 박은 거 박은 거 박은 다시 렌더 */
    _showAiToggleBar();
    if (typeof window._scheduleViewerFrameReRender === 'function') {
      window._scheduleViewerFrameReRender();
    } else if (typeof _scheduleViewerFrameReRender === 'function') {
      _scheduleViewerFrameReRender();
    }
  }

  /* ════════════════════════════════════════════════════════════════
     실행 조건 검사 (step2 그대로)
     ════════════════════════════════════════════════════════════════ */
  function _countScenesWithBody() {
    if (typeof ViewerState === 'undefined' || !ViewerState.scenes) return 0;
    let count = 0;
    Object.values(ViewerState.scenes).forEach(s => {
      if (!s || s.type === 'cover') return;
      const body = String(s.body || '').trim();
      if (body.length > 0) count++;
    });
    return count;
  }

  function _countConnections() {
    if (typeof ViewerState === 'undefined' || !ViewerState.scenes) return 0;
    let count = 0;
    Object.values(ViewerState.scenes).forEach(s => {
      if (!s || !Array.isArray(s.choices)) return;
      s.choices.forEach(c => {
        if (c && c.nextId) count++;
      });
    });
    return count;
  }

  function _getModeAvailability() {
    const bodyCount = _countScenesWithBody();
    const connCount = _countConnections();
    /* Phase 1: 교사 권한 게이트 — 꺼진 mode는 카드 비활성 + "아직 열어주지 않았어요". */
    const NOT_OPENED = '선생님이 아직 열어주지 않았어요';
    const s1Teacher    = _isModeAllowedByTeacher('s1');
    const s2Teacher    = _isModeAllowedByTeacher('s2');
    const checkTeacher = _isModeAllowedByTeacher('check');
    return {
      s1: {
        enabled: s1Teacher && bodyCount >= 1,
        reason:  !s1Teacher ? NOT_OPENED : (bodyCount < 1 ? '본문이 있는 장면이 1개 이상 필요해요' : ''),
      },
      s2: {
        enabled: s2Teacher && bodyCount >= 1,
        reason:  !s2Teacher ? NOT_OPENED : (bodyCount < 1 ? '본문이 있는 장면이 1개 이상 필요해요' : ''),
      },
      s3: {
        enabled: false,
        reason:  '준비 중이에요',
      },
      check: {
        enabled: checkTeacher && bodyCount >= 2,
        reason:  !checkTeacher ? NOT_OPENED : (bodyCount < 2 ? '본문이 있는 장면이 2개 이상 필요해요' : ''),
      },
    };
  }

  /* ════════════════════════════════════════════════════════════════
     모달 인프라 — overlay + 박스 + 닫기
     ════════════════════════════════════════════════════════════════ */
  function _createModalRoot(id, contentHtml, opts) {
    _removeModalRoot(id);

    const root = document.createElement('div');
    root.id = id;
    root.className = 'ai-modal-overlay';
    if (opts && opts.size === 'large') root.classList.add('ai-modal-overlay--large');
    if (opts && opts.lock) root.classList.add('ai-modal-overlay--lock');
    root.innerHTML = `
      <div class="ai-modal${opts && opts.size === 'large' ? ' ai-modal--large' : ''}" role="dialog" aria-modal="true">
        ${contentHtml}
      </div>
    `;
    document.body.appendChild(root);

    /* lock 모달은 ESC / overlay 클릭 X */
    if (!(opts && opts.lock)) {
      root.addEventListener('click', (e) => {
        if (e.target === root) _removeModalRoot(id);
      });
      const onKey = (e) => {
        if (e.key === 'Escape') {
          _removeModalRoot(id);
          document.removeEventListener('keydown', onKey);
        }
      };
      document.addEventListener('keydown', onKey);
    }

    return root;
  }

  function _removeModalRoot(id) {
    const old = document.getElementById(id);
    if (old) old.remove();
  }

  /* ════════════════════════════════════════════════════════════════
     첫 안내 모달
     ════════════════════════════════════════════════════════════════ */
  function _showOnboardingModal(onConfirm) {
    const html = `
      <div class="ai-modal__header">
        <div class="ai-modal__title">🤖 AI 작품 다듬기</div>
      </div>
      <div class="ai-modal__body">
        <p class="ai-onboarding-text">
          AI는 작품을 대신 만드는 기능이 아니에요.<br/>
          여러분이 만든 작품을 읽고,<br/>
          더 자연스럽게 다듬을 수 있는 후보를 보여줘요.<br/>
          마음에 드는 장면만 골라 적용할 수 있어요.
        </p>
        <div class="ai-onboarding-hint">
          AI 결과는 후보로만 보여줘요. 내가 직접 골라 적용해야 반영되고, 원본은 그대로 남아요.
        </div>
      </div>
      <div class="ai-modal__footer">
        <label class="ai-onboarding-skip">
          <input type="checkbox" id="ai-onboarding-dont-show" /> 다시는 보지 않기
        </label>
        <button class="ai-btn ai-btn--primary js-ai-onboarding-ok">이해했어요</button>
      </div>
    `;
    const root = _createModalRoot('ai-onboarding-modal', html);
    root.querySelector('.js-ai-onboarding-ok').addEventListener('click', () => {
      const dontShow = root.querySelector('#ai-onboarding-dont-show').checked;
      if (dontShow) {
        try { localStorage.setItem(LS_ONBOARDING_KEY, '1'); } catch (e) {}
      }
      _removeModalRoot('ai-onboarding-modal');
      if (typeof onConfirm === 'function') onConfirm();
    });
  }

  function _hasSeenOnboarding() {
    try { return localStorage.getItem(LS_ONBOARDING_KEY) === '1'; }
    catch (e) { return false; }
  }

  /* ════════════════════════════════════════════════════════════════
     모드 선택 모달
     ════════════════════════════════════════════════════════════════ */
  function _renderModeCard(opts) {
    const disabledCls = opts.enabled ? '' : ' ai-mode-card--disabled';
    const remainingHtml = opts.remaining != null
      ? `<div class="ai-mode-card__remaining">남은: ${opts.remaining}회 <span class="ai-mock-badge">mock</span></div>`
      : '';
    const reasonHtml = (!opts.enabled && opts.disabledReason)
      ? `<div class="ai-mode-card__reason">${opts.disabledReason}</div>`
      : '';
    return `
      <button type="button"
        class="ai-mode-card${disabledCls}"
        data-ai-mode="${opts.key}"
        ${opts.enabled ? '' : 'disabled aria-disabled="true"'}>
        <div class="ai-mode-card__icon">${opts.icon}</div>
        <div class="ai-mode-card__title">${opts.title}</div>
        <div class="ai-mode-card__desc">${opts.desc}</div>
        ${remainingHtml}
        ${reasonHtml}
      </button>
    `;
  }

  function _showModeModal() {
    const a = _getModeAvailability();

    const html = `
      <div class="ai-modal__header">
        <div class="ai-modal__title">🤖 AI 작품 다듬기</div>
        <button class="ai-modal__close js-ai-modal-close" aria-label="닫기">✕</button>
      </div>
      <div class="ai-modal__body">
        <p class="ai-mode-intro">
          AI는 작품을 대신 만들지 않아요. 내가 만든 작품을 읽고 더 자연스럽게 다듬거나 확인할 점을 알려줘요.
        </p>
        <div class="ai-mode-grid">
          ${(() => {
            /* Phase A fix 2026-05-21: 실 API 박을 때 client mock quota 박지 X (Functions가 quota 박음) */
            const realApi = _shouldUseRealApi();
            const s1Remain = realApi ? Infinity : _getRemaining('s1');
            const checkRemain = realApi ? Infinity : _getRemaining('check');
            return `
          ${_renderModeCard({
            key: 's1',
            icon: '📝',
            title: '텍스트 1단계',
            desc: '문장을 읽기 좋게 다듬어요. 새로운 내용은 만들지 않아요.',
            enabled: a.s1.enabled && s1Remain > 0,
            disabledReason: s1Remain === 0 ? '이번 작품에서 사용할 수 있는 횟수를 모두 사용했어요' : a.s1.reason,
            remaining: realApi ? null : s1Remain,
          })}
          ${_renderModeCard({
            key: 'check',
            icon: '🔍',
            title: '작품 검사',
            desc: '작품 전체의 흐름, 선택지 연결, 캐릭터 일관성을 점검해요. AI가 직접 고치지는 않아요.',
            enabled: a.check.enabled && checkRemain > 0,
            disabledReason: checkRemain === 0 ? '이번 작품에서 사용할 수 있는 횟수를 모두 사용했어요' : a.check.reason,
            remaining: realApi ? null : checkRemain,
          })}
            `;
          })()}
          ${_renderModeCard({
            key: 's2',
            icon: '✨',
            title: '텍스트 2단계',
            desc: '장면을 더 생생하게 발전시켜요. 원작의 핵심 사건과 선택지는 지켜요.',
            enabled: a.s2.enabled,
            disabledReason: a.s2.reason,
            remaining: null,
          })}
        </div>
        <div class="ai-mode-footer">
          🎨 그림 다듬기 기능은 준비 중이에요.
        </div>
        ${_isTestMode() ? `
        <div class="ai-mode-testmode-panel">
          <div class="ai-mode-testmode-panel__head">
            🧪 TEST MODE — 테스트 편의 reset (현재 팀: <code>${_escapeHtml(_getCurrentNamespace())}</code>)
          </div>
          <div class="ai-mode-testmode-panel__buttons">
            <button type="button" class="ai-btn ai-btn--ghost js-ai-tm-reset-usage">[현재 팀 quota 초기화]</button>
            <button type="button" class="ai-btn ai-btn--ghost js-ai-tm-reset-drafts">[현재 팀 후보 초기화]</button>
            <button type="button" class="ai-btn ai-btn--ghost js-ai-tm-reset-variants">[현재 팀 AI 1단계 결과 초기화]</button>
            <button type="button" class="ai-btn ai-btn--ghost ai-btn--danger js-ai-tm-reset-team-all">[현재 팀 AI 테스트 전체 초기화]</button>
          </div>
          <div class="ai-mode-testmode-panel__hint">
            ⚠️ MOCK 전용 — 실 API에는 무효. reset 후 남은 횟수가 갱신됩니다.
          </div>
        </div>` : ''}
      </div>
    `;

    const root = _createModalRoot('ai-mode-modal', html);

    root.querySelector('.js-ai-modal-close').addEventListener('click', () => {
      _removeModalRoot('ai-mode-modal');
    });

    root.querySelectorAll('.ai-mode-card:not(.ai-mode-card--disabled)').forEach(card => {
      card.addEventListener('click', () => {
        const mode = card.getAttribute('data-ai-mode');
        _removeModalRoot('ai-mode-modal');
        if (mode === 's1') {
          /* v140-step2: 후보 3회 흐름. 옛 _startTextS1 (비교 모달 + _rtSaveBody 적용)은 호출 박지 X */
          _startTextS1V140();
        } else if (mode === 's2') {
          _startTextS2();
        } else if (mode === 'check') {
          _startWorkCheck();
        }
      });
    });

    /* v140 fix 2026-05-21: TEST MODE reset 박은 거 박은 거 박은 박은 — 4 버튼. reset 후 모달 다시 렌더 박음 (남은 횟수 갱신) */
    function _afterReset(label) {
      _removeModalRoot('ai-mode-modal');
      _showModeModal();
      console.log('[ai-mock] reset 후 모드 모달 다시 박음 — ' + label);
    }
    const u = root.querySelector('.js-ai-tm-reset-usage');
    if (u) u.addEventListener('click', function () { _resetMockUsage(); _afterReset('quota'); });
    const d = root.querySelector('.js-ai-tm-reset-drafts');
    if (d) d.addEventListener('click', function () { _resetMockDrafts(); _afterReset('drafts'); });
    const v = root.querySelector('.js-ai-tm-reset-variants');
    if (v) v.addEventListener('click', function () {
      _resetMockVariants();
      /* 토글 바도 박은 거 박은 거 박은 박은 — finalized 박지 X 박혀있으면 박지 X */
      _showAiToggleBar();
      _afterReset('variants');
    });
    const all = root.querySelector('.js-ai-tm-reset-team-all');
    if (all) all.addEventListener('click', function () {
      if (!confirm('현재 팀(' + _getCurrentNamespace() + ')의 mock quota·후보·결과를 모두 초기화할까요?')) return;
      _resetMockUsage();
      _resetMockDrafts();
      _resetMockVariants();
      _showAiToggleBar();
      _afterReset('team-all');
    });
  }

  /* ════════════════════════════════════════════════════════════════
     step3 — mock 호출 흐름
     ════════════════════════════════════════════════════════════════ */

  /* 작품 snapshot 박음 — AI에 박을 입력. 표지/본문빈장면 제외. */
  function _buildWorkSnapshot() {
    const scenes = {};
    if (typeof ViewerState === 'undefined' || !ViewerState.scenes) return scenes;
    Object.values(ViewerState.scenes).forEach(s => {
      if (!s || s.type === 'cover') return;
      const body = String(s.body || '').trim();
      if (body.length === 0) return;
      scenes[String(s.id)] = {
        id: String(s.id),
        title: s.title || '',
        body: s.body,
        isEnding: !!s.isEnding,
        submode: s.picturebookSubmode === 'imageCenter' ? 'imageCenter' : 'split',
        choices: (s.choices || []).map(c => ({
          label: c && c.label ? c.label : '',
          nextId: c && c.nextId ? c.nextId : null,
        })),
      };
    });
    return scenes;
  }

  /* mock revise — 간단 변형. 실 AI X. 사용자가 mock인 거 인지하려고 살짝 표 박음. */
  function _mockReviseS1(body) {
    /* 1단계 mock — 다중 공백·문장 부호 정리. 의미 변경 X. */
    let r = String(body)
      .replace(/[ \t]+/g, ' ')                              /* 다중 공백 1개 */
      .replace(/\s*,\s*/g, ', ')                            /* 쉼표 뒤 공백 */
      .replace(/([가-힣])\.([가-힣])/g, '$1. $2')            /* 마침표 뒤 공백 */
      .replace(/\.\s*\n/g, '.\n')                           /* 마침표 + 줄바꿈 정돈 */
      .trim();
    /* 사용자가 mock인 거 인지하게 라벨 박음 — 실 단계엔 박지 X */
    return r + '  ※mock';
  }

  /* AbortController 대용 delay */
  function _delay(ms) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = setInterval(() => {
        if (_currentAbort && _currentAbort.aborted) {
          clearInterval(tick);
          reject(new Error('cancelled'));
          return;
        }
        if (Date.now() - start >= ms) {
          clearInterval(tick);
          resolve();
        }
      }, 100);
    });
  }

  /* mock 호출 — 실 API 박지 X. 가짜 응답 박음. */
  async function _mockCallTextAiBatch(snapshot, strength) {
    const delayMs = MOCK_DELAY_MIN + Math.random() * (MOCK_DELAY_MAX - MOCK_DELAY_MIN);
    await _delay(delayMs);  /* 박는 도중 cancel 가능 */

    const results = {};
    Object.values(snapshot).forEach(s => {
      /* 약 30% 장면은 skip — "이미 자연스러워요" */
      if (Math.random() < 0.3) {
        results[s.id] = { skip: true, reason: '이미 자연스러워요 (mock)' };
      } else {
        const revised = _mockReviseS1(s.body);
        results[s.id] = {
          revisedText: revised,
          summary: 'MOCK: 띄어쓰기·문장 부호 정리',
          changes: [
            { type: 'mock_demo', description: 'MOCK 변경 — 실 AI 아님' },
          ],
          safeAddition: [],
          creativeAddition: [],
          preservedCheck: {
            charactersUnchanged: true,
            plotPointsUnchanged: true,
            choiceMeaningsUnchanged: true,
            endingDirectionUnchanged: true,
            branchStructureUnchanged: true,
            sceneRoleUnchanged: true,
          },
          warnings: [],
        };
      }
    });

    const totalScenes = Object.keys(snapshot).length;
    const skipCount = Object.values(results).filter(r => r.skip).length;
    const revisedCount = totalScenes - skipCount;

    return {
      ok: true,
      suggestionId: 'mock_sug_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      strength: strength,
      scope: 'work',
      isMock: true,
      globalSummary: `MOCK: ${totalScenes}개 장면 중 ${revisedCount}개에 다듬기 제안이 있어요. (${skipCount}개 skip)`,
      results: results,
      originalSnapshot: snapshot,    /* 적용 직전 race 검증용 */
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };
  }

  /* mock store — localStorage (rules에 ai-suggestions 박지 X 박혀있어 Firebase 안 박음) */
  function _saveMockSuggestion(suggestion) {
    try {
      const store = _loadMockStore();
      store.suggestions[suggestion.suggestionId] = suggestion;
      localStorage.setItem(LS_MOCK_STORE_KEY, JSON.stringify(store));
    } catch (e) { /* noop — mock 단계 */ }
  }

  function _saveMockHistory(sceneId, before, after, sourceSuggestionId) {
    try {
      const store = _loadMockStore();
      if (!store.history[sceneId]) store.history[sceneId] = [];
      store.history[sceneId].push({
        historyId: 'mock_hist_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        sourceSuggestionId: sourceSuggestionId,
        before: { body: before },
        after: { body: after },
        appliedAt: Date.now(),
        canUndo: true,
        isMock: true,
      });
      localStorage.setItem(LS_MOCK_STORE_KEY, JSON.stringify(store));
    } catch (e) { /* noop */ }
  }

  function _updateMockSuggestionStatus(suggestionId, status) {
    try {
      const store = _loadMockStore();
      if (store.suggestions[suggestionId]) {
        store.suggestions[suggestionId].status = status;
        store.suggestions[suggestionId].updatedAt = Date.now();
        localStorage.setItem(LS_MOCK_STORE_KEY, JSON.stringify(store));
      }
    } catch (e) {}
  }

  function _loadMockStore() {
    try {
      const raw = localStorage.getItem(LS_MOCK_STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { suggestions: {}, history: {} };
  }

  /* ════════════════════════════════════════════════════════════════
     mock quota — localStorage (rules 변경 X 정책)
     ════════════════════════════════════════════════════════════════ */
  /* v140 fix: 팀별 namespace key (classId__teamName) 박음 — 같은 브라우저 박은 거 박은 거 박은 팀 간 quota 격리 */
  function _loadMockUsage() {
    try {
      const key = _getMockUsageKey();
      let raw = localStorage.getItem(key);
      /* 마이그 박은 거 박은 거 박은 — 옛 공통 키 박힌 거 박은 거 박은 박혀있고 박은 namespace 박지 X 박혀있으면 박지 X 박음 (각 팀 0부터 시작). */
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { s1Used: 0, s2Used: 0, s3Used: 0, checkUsed: 0, lastUsedAt: 0 };
  }
  function _saveMockUsage(usage) {
    try { localStorage.setItem(_getMockUsageKey(), JSON.stringify(usage)); } catch (e) {}
  }
  function _getRemaining(mode) {
    const u = _loadMockUsage();
    if (mode === 's1')    return Math.max(0, MOCK_QUOTA.s1 - (u.s1Used || 0));
    if (mode === 's2')    return Math.max(0, MOCK_QUOTA.s2 - (u.s2Used || 0));
    if (mode === 's3')    return Math.max(0, MOCK_QUOTA.s3 - (u.s3Used || 0));
    if (mode === 'check') return Math.max(0, MOCK_QUOTA.check - (u.checkUsed || 0));
    return 0;
  }
  function _consumeQuota(mode) {
    const u = _loadMockUsage();
    if (mode === 's1')    u.s1Used = (u.s1Used || 0) + 1;
    if (mode === 's2')    u.s2Used = (u.s2Used || 0) + 1;
    if (mode === 's3')    u.s3Used = (u.s3Used || 0) + 1;
    if (mode === 'check') u.checkUsed = (u.checkUsed || 0) + 1;
    u.lastUsedAt = Date.now();
    _saveMockUsage(u);
  }
  function _refundQuota(mode) {
    /* 7가지 환불 정책 (AI_SAFETY_COST_RULES.md 5-1):
       - 모델 실패 / 정책 위반 거부 / 네트워크 오류 → 환불 */
    const u = _loadMockUsage();
    if (mode === 's1' && u.s1Used > 0)       u.s1Used--;
    if (mode === 's2' && u.s2Used > 0)       u.s2Used--;
    if (mode === 's3' && u.s3Used > 0)       u.s3Used--;
    if (mode === 'check' && u.checkUsed > 0) u.checkUsed--;
    _saveMockUsage(u);
  }

  /* ════════════════════════════════════════════════════════════════
     호출 중 UI lock — 점 3개 + 경과 시간 + 분석 장면 수 + 취소
     ════════════════════════════════════════════════════════════════ */
  let _callingTimer = null;
  function _showCallingModal(sceneCount) {
    const startedAt = Date.now();
    const html = `
      <div class="ai-modal__body ai-calling-body">
        <div class="ai-calling-dots">
          <span></span><span></span><span></span>
        </div>
        <div class="ai-calling-title">🤖 AI가 작품을 읽고 있어요</div>
        <div class="ai-calling-detail">
          작품 <b>${sceneCount}개 장면</b>을 분석하는 중이에요.<br/>
          <span class="ai-calling-time" id="ai-calling-time">0초 경과</span>
        </div>
        <div class="ai-calling-hint">
          30초~1분 정도 걸릴 수 있어요.
        </div>
        <button class="ai-btn ai-btn--ghost js-ai-call-cancel">취소</button>
      </div>
    `;
    const root = _createModalRoot('ai-calling-modal', html, { lock: true });

    /* 경과 시간 갱신 — 1초마다 */
    if (_callingTimer) clearInterval(_callingTimer);
    _callingTimer = setInterval(() => {
      const el = document.getElementById('ai-calling-time');
      if (!el) {
        clearInterval(_callingTimer);
        return;
      }
      const secs = Math.floor((Date.now() - startedAt) / 1000);
      el.textContent = secs + '초 경과';
    }, 1000);

    root.querySelector('.js-ai-call-cancel').addEventListener('click', () => {
      if (_currentAbort) _currentAbort.aborted = true;
      if (_callingTimer) { clearInterval(_callingTimer); _callingTimer = null; }
      _removeModalRoot('ai-calling-modal');
    });
  }

  function _hideCallingModal() {
    if (_callingTimer) { clearInterval(_callingTimer); _callingTimer = null; }
    _removeModalRoot('ai-calling-modal');
  }

  /* ════════════════════════════════════════════════════════════════
     1단계 호출 시작
     ════════════════════════════════════════════════════════════════ */
  async function _startTextS1() {
    /* quota 검사 */
    if (_getRemaining('s1') <= 0) {
      alert('이번 작품에서 사용할 수 있는 텍스트 1단계 횟수를 모두 사용했어요.');
      return;
    }
    /* 잠금 검사 */
    if (typeof _editText !== 'undefined' && _editText.editable === false) {
      alert('다른 사용자가 잠금을 잡고 있어서 AI를 사용할 수 없어요.');
      return;
    }
    /* 입력 큐 비우기 (v138 함수 재사용) */
    if (typeof _flushPendingSave === 'function') {
      await _flushPendingSave();
    }

    const snapshot = _buildWorkSnapshot();
    const sceneCount = Object.keys(snapshot).length;
    if (sceneCount === 0) {
      alert('본문이 박힌 장면이 없어요. 먼저 작품을 작성해주세요.');
      return;
    }

    /* quota 차감 — 호출 시작 시점 (7가지 환불 정책 따라 실패 시 환불) */
    _consumeQuota('s1');

    /* AbortController 박음 */
    _currentAbort = { aborted: false };
    _showCallingModal(sceneCount);

    let suggestion = null;
    try {
      suggestion = await _mockCallTextAiBatch(snapshot, 1);
    } catch (e) {
      _hideCallingModal();
      if (e && e.message === 'cancelled') {
        /* 사용자가 호출 도중 취소 — quota 차감 그대로 (AI_SAFETY_COST_RULES 5-1 #2) */
        return;
      }
      /* 모델/네트워크 실패 — quota 환불 */
      _refundQuota('s1');
      alert('AI 호출 실패: ' + (e && e.message ? e.message : '알 수 없는 오류'));
      return;
    }

    _hideCallingModal();
    _saveMockSuggestion(suggestion);
    _showComparisonModal(suggestion);
  }

  /* ════════════════════════════════════════════════════════════════
     step4 — 작품 검사 mock (수정 X 진단만)
     ════════════════════════════════════════════════════════════════ */

  /* mock 검사 — 실 AI X. 가짜 진단 4 카테고리. */
  async function _mockCallWorkCheck(snapshot) {
    const delayMs = MOCK_DELAY_MIN + Math.random() * (MOCK_DELAY_MAX - MOCK_DELAY_MIN);
    await _delay(delayMs);

    const sceneIds = Object.keys(snapshot);
    if (sceneIds.length === 0) {
      return { ok: true, type: 'check', isMock: true, categories: { spelling: [], coherence: [], characterConsistency: [], branchFlow: [] } };
    }

    /* mock 진단 — sceneId 기반 가짜 박음. 실 AI 박지 X. */
    const spelling = [];
    const coherence = [];
    const characterConsistency = [];
    const branchFlow = [];

    /* 첫 1~2개 장면에 mock 맞춤법 박음 */
    sceneIds.slice(0, Math.min(2, sceneIds.length)).forEach((id, idx) => {
      spelling.push({
        sceneId: id,
        wrong: idx === 0 ? '쫓긴다' : '도망갓다',
        correct: idx === 0 ? '쫓긴다' : '도망갔다',
        note: 'MOCK 진단 — 실 AI 아님',
      });
    });

    /* 장면 2개 이상이면 mock 유기성 박음 */
    if (sceneIds.length >= 2) {
      coherence.push({
        sceneIdFrom: sceneIds[0],
        sceneIdTo: sceneIds[1],
        issue: 'MOCK: 두 장면 사이 흐름이 자연스러운지 한번 더 확인해주세요',
      });
    }

    /* storyAnalyzer로 도달 불가능 장면 박음 (실제 분석) */
    if (typeof analyzeStructure === 'function') {
      try {
        const analysis = analyzeStructure();
        if (analysis && analysis.unreachableScenes && analysis.unreachableScenes.length) {
          analysis.unreachableScenes.forEach(num => {
            branchFlow.push({
              sceneId: String(num),
              issue: '이 장면은 어디서도 도달할 수 없어요',
            });
          });
        }
      } catch (e) { /* noop */ }
    }

    return {
      ok: true,
      checkId: 'mock_chk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      type: 'check',
      isMock: true,
      createdAt: Date.now(),
      categories: { spelling, coherence, characterConsistency, branchFlow },
    };
  }

  async function _startWorkCheck() {
    /* quota 검사 */
    if (_getRemaining('check') <= 0) {
      alert('이번 작품에서 사용할 수 있는 작품 검사 횟수를 모두 사용했어요.');
      return;
    }
    /* 잠금 검사 (검사도 박힌 데이터 기반이라 잠금 확인) */
    if (typeof _editText !== 'undefined' && _editText.editable === false) {
      alert('다른 사용자가 잠금을 잡고 있어서 AI를 사용할 수 없어요.');
      return;
    }
    if (typeof _flushPendingSave === 'function') {
      await _flushPendingSave();
    }

    const snapshot = _buildWorkSnapshot();
    const sceneCount = Object.keys(snapshot).length;
    if (sceneCount < 2) {
      alert('본문이 박힌 장면이 2개 이상 필요해요.');
      return;
    }

    _consumeQuota('check');
    _currentAbort = { aborted: false };
    _showCallingModal(sceneCount);

    let result = null;
    const useRealApi = _shouldUseRealApi();
    try {
      if (useRealApi) {
        console.log('[Phase A] callWorkCheck 호출 박음');
        result = await _phaseACallWorkCheck(snapshot);
      } else {
        result = await _mockCallWorkCheck(snapshot);
      }
    } catch (e) {
      _hideCallingModal();
      if (e && e.message === 'cancelled') return;
      if (!useRealApi) {
        _refundQuota('check');
      }
      console.error('[v140 / Phase A] 작품 검사 실패', e);
      const prefix = useRealApi ? '[Phase A]' : '[mock]';
      alert(prefix + ' 작품 검사 실패: ' + (e && e.message ? e.message : '알 수 없는 오류'));
      return;
    }

    _hideCallingModal();
    /* Phase 2 — 서버 사전 검사 차단 응답이면 모달 안내 후 종료 (진단 없음) */
    if (result && result.blocked) {
      _showAiPrecheckBlockedModal(result, 'check');
      return;
    }
    _showCheckResultModal(result);
  }

  /* 검사 결과 모달 — 수정 X. 진단만. "장면 X로 이동" 버튼만 박음. */
  function _showCheckResultModal(check) {
    const cats = check.categories || {};
    /* CHECK-UI-1: real 응답 카테고리 키는 character, 구버전 mock은 characterConsistency.
       존재하는 쪽을 읽어 누락·카운트 0 방지. (빈 배열도 truthy라 real character:[]가 우선) */
    const sections = [
      { key: 'spelling',   icon: '📝', title: '맞춤법',        items: cats.spelling || [] },
      { key: 'coherence',  icon: '🔗', title: '장면 간 유기성', items: cats.coherence || [] },
      { key: 'character',  icon: '👤', title: '캐릭터 일관성',  items: cats.character || cats.characterConsistency || [] },
      { key: 'branchFlow', icon: '🌳', title: '분기 흐름',      items: cats.branchFlow || [] },
    ];

    const sectionsHtml = sections.map(sec => {
      const countCls = sec.items.length === 0 ? ' ai-check-category__count--zero' : '';
      let itemsHtml = '';
      if (sec.items.length === 0) {
        itemsHtml = '<div class="ai-check-empty">문제 없음 ✓</div>';
      } else {
        itemsHtml = sec.items.map(item => _renderCheckItem(sec.key, item)).join('');
      }
      return `
        <div class="ai-check-category">
          <div class="ai-check-category__head">
            <span>${sec.icon} ${sec.title}</span>
            <span class="ai-check-category__count${countCls}">${sec.items.length}곳</span>
          </div>
          ${itemsHtml}
        </div>
      `;
    }).join('');

    const html = `
      <div class="ai-modal__header">
        <div class="ai-modal__title">🔍 작품 검사 결과</div>
        <button class="ai-modal__close js-ai-modal-close" aria-label="닫기">✕</button>
      </div>
      <div class="ai-modal__body">
        <div class="ai-check-intro">
          AI는 <b>문제만 알려드려요</b>. 수정은 안 해드려요. 학생이 직접 보고 본인이 고치는 기능이에요.
          <span style="display:block;margin-top:2px;color:#8a8f98;font-size:12px;">검사 결과는 참고용이며, 실제로 고칠지는 사람이 판단해요.</span>
        </div>
        ${sectionsHtml}
      </div>
      <div class="ai-modal__footer">
        <button class="ai-btn ai-btn--primary js-ai-check-close">닫기</button>
      </div>
    `;
    const root = _createModalRoot('ai-check-modal', html, { size: 'large' });

    root.querySelector('.js-ai-modal-close').addEventListener('click', () => {
      _removeModalRoot('ai-check-modal');
    });
    root.querySelector('.js-ai-check-close').addEventListener('click', () => {
      _removeModalRoot('ai-check-modal');
    });

    /* 장면 X로 이동 — viewer의 editNavigateTo 재사용 (v138) */
    root.querySelectorAll('.js-ai-check-jump').forEach(btn => {
      btn.addEventListener('click', () => {
        const sceneId = btn.getAttribute('data-scene-id');
        if (!sceneId) return;
        if (typeof editNavigateTo === 'function') {
          editNavigateTo(sceneId);
          _removeModalRoot('ai-check-modal');
        } else {
          alert('해당 장면으로 이동할 수 없어요. 새로고침 후 다시 시도해주세요.');
        }
      });
    });
  }

  /* CHECK-UI-1: real(sceneId·message·where) + 구버전 mock(wrong/correct·sceneIdFrom/To·issue·scenes·character)
     항목을 필드 존재 여부로 렌더. 누락 필드의 undefined·빈 "→" 노출을 막는다. catKey는 호환용으로만 받음. */
  function _renderCheckItem(catKey, item) {
    item = item || {};

    /* ── 장면 라벨 + 점프 타겟 ── (real: sceneId / 구 mock coherence: from→to / 구 mock character: scenes[]) */
    const fromId = (item.sceneIdFrom != null && item.sceneIdFrom !== '') ? String(item.sceneIdFrom) : '';
    const toId   = (item.sceneIdTo   != null && item.sceneIdTo   !== '') ? String(item.sceneIdTo)   : '';
    let   oneId  = (item.sceneId     != null && item.sceneId     !== '') ? String(item.sceneId)     : '';
    if (!oneId && Array.isArray(item.scenes) && item.scenes.length) {
      oneId = String(item.scenes[0]);
    }
    let sceneLabel = '';
    let jumpId = '';
    if (fromId && toId) {
      sceneLabel = `장면 ${_escapeHtml(fromId)} → ${_escapeHtml(toId)}`;
      jumpId = fromId;
    } else if (oneId) {
      sceneLabel = `장면 ${_escapeHtml(oneId)}`;
      jumpId = oneId;
    }

    /* ── 본문: message > issue > wrong/correct > 안전 fallback ── */
    let body = '';
    const msg = item.message || item.issue || '';
    if (msg) {
      body = _escapeHtml(msg);
    } else if (item.wrong || item.correct) {
      /* wrong/correct 둘 중 하나라도 있을 때만 "→" 표시 (빈 → 방지) */
      body = `<b>${_escapeHtml(item.wrong || '')}</b> → ${_escapeHtml(item.correct || '')}`;
    }
    /* 구 mock characterConsistency: 인물명 prefix */
    if (item.character) {
      const charPrefix = `<b>${_escapeHtml(item.character)}</b>`;
      body = body ? `${charPrefix}: ${body}` : charPrefix;
    }
    if (!body) {
      body = '확인해 보세요.';
    }

    /* ── where 위치 설명 (있을 때만, 작게) ── */
    const whereHtml = item.where
      ? `<div class="ai-check-item__where" style="margin-top:2px;color:#8a8f98;font-size:12px;">${_escapeHtml(item.where)}</div>`
      : '';

    const textHtml = sceneLabel ? `${sceneLabel}: ${body}` : body;
    const jumpHtml = jumpId
      ? `<button class="ai-check-item__jump js-ai-check-jump" data-scene-id="${_escapeHtml(jumpId)}">장면 ${_escapeHtml(jumpId)} 이동</button>`
      : '';
    return `
      <div class="ai-check-item">
        <div class="ai-check-item__text">${textHtml}${whereHtml}</div>
        ${jumpHtml}
      </div>
    `;
  }

  /* ════════════════════════════════════════════════════════════════
     비교 모달 — 작품 단위 (장면 목록 + skip + 체크박스 + 좌우 split)
     ════════════════════════════════════════════════════════════════ */
  function _renderComparisonRow(sceneId, original, result) {
    const sceneTitle = (typeof ViewerState !== 'undefined' && ViewerState.scenes && ViewerState.scenes[sceneId])
      ? (ViewerState.scenes[sceneId].title || '').trim() : '';
    const titleHtml = sceneTitle ? `<span class="ai-row-title">— ${_escapeHtml(sceneTitle)}</span>` : '';

    if (result.skip) {
      return `
        <div class="ai-scene-row ai-scene-row--skip" data-scene-id="${sceneId}">
          <div class="ai-scene-row__head">
            <span class="ai-scene-row__num">장면 ${sceneId}</span>${titleHtml}
            <span class="ai-scene-row__skip-label">이미 자연스러워요</span>
          </div>
        </div>
      `;
    }

    return `
      <div class="ai-scene-row" data-scene-id="${sceneId}">
        <div class="ai-scene-row__head">
          <label class="ai-scene-row__check">
            <input type="checkbox" class="js-ai-scene-check" data-scene-id="${sceneId}" checked />
            <span class="ai-scene-row__num">장면 ${sceneId}</span>${titleHtml}
          </label>
          <span class="ai-scene-row__summary">${_escapeHtml(result.summary || '')}</span>
        </div>
        <div class="ai-scene-row__split">
          <div class="ai-scene-row__col">
            <div class="ai-col-label">원문</div>
            <div class="ai-col-body">${_escapeHtml(original.body || '')}</div>
          </div>
          <div class="ai-scene-row__col">
            <div class="ai-col-label">AI 제안 <span class="ai-mock-badge">mock</span></div>
            <div class="ai-col-body ai-col-body--suggested">${_escapeHtml(result.revisedText || '')}</div>
          </div>
        </div>
      </div>
    `;
  }

  function _showComparisonModal(suggestion) {
    const sceneIds = Object.keys(suggestion.results);
    const rowsHtml = sceneIds.map(id => {
      return _renderComparisonRow(id, suggestion.originalSnapshot[id], suggestion.results[id]);
    }).join('');

    const html = `
      <div class="ai-modal__header">
        <div class="ai-modal__title">🤖 AI 다듬기 결과 — 1단계 <span class="ai-mock-badge ai-mock-badge--header">Phase 0.5 mock</span></div>
        <button class="ai-modal__close js-ai-modal-close" aria-label="닫기">✕</button>
      </div>
      <div class="ai-modal__body">
        <div class="ai-result-summary">${_escapeHtml(suggestion.globalSummary || '')}</div>
        <div class="ai-result-hint">
          체크된 장면만 적용돼요. ✅ 모두 / ☐ 체크 풀기로 일괄 박을 수 있어요.
        </div>
        <div class="ai-result-actions-top">
          <button class="ai-btn ai-btn--ghost js-ai-check-all">✅ 모두 선택</button>
          <button class="ai-btn ai-btn--ghost js-ai-uncheck-all">☐ 모두 해제</button>
        </div>
        <div class="ai-result-rows">${rowsHtml}</div>
      </div>
      <div class="ai-modal__footer">
        <button class="ai-btn ai-btn--ghost js-ai-cancel-all">전체 취소</button>
        <button class="ai-btn ai-btn--primary js-ai-apply-selected" data-suggestion-id="${suggestion.suggestionId}">선택 적용</button>
      </div>
    `;
    const root = _createModalRoot('ai-comparison-modal', html, { size: 'large' });

    root.querySelector('.js-ai-modal-close').addEventListener('click', () => {
      _updateMockSuggestionStatus(suggestion.suggestionId, 'dismissed');
      _removeModalRoot('ai-comparison-modal');
    });
    root.querySelector('.js-ai-cancel-all').addEventListener('click', () => {
      _updateMockSuggestionStatus(suggestion.suggestionId, 'dismissed');
      _removeModalRoot('ai-comparison-modal');
    });

    root.querySelector('.js-ai-check-all').addEventListener('click', () => {
      root.querySelectorAll('.js-ai-scene-check').forEach(cb => { cb.checked = true; });
    });
    root.querySelector('.js-ai-uncheck-all').addEventListener('click', () => {
      root.querySelectorAll('.js-ai-scene-check').forEach(cb => { cb.checked = false; });
    });

    root.querySelector('.js-ai-apply-selected').addEventListener('click', async () => {
      const checks = Array.from(root.querySelectorAll('.js-ai-scene-check:checked'));
      const selectedIds = checks.map(cb => cb.getAttribute('data-scene-id'));
      if (selectedIds.length === 0) {
        alert('적용할 장면을 1개 이상 체크해주세요.');
        return;
      }
      await _applySelected(suggestion, selectedIds);
    });
  }

  /* ════════════════════════════════════════════════════════════════
     선택 적용 — _rtSaveBody 재사용 (v138 함수)
     ════════════════════════════════════════════════════════════════ */
  async function _applySelected(suggestion, selectedIds) {
    /* 잠금 재검사 */
    if (typeof _editText !== 'undefined' && _editText.editable === false) {
      alert('다른 사용자가 잠금을 잡고 있어서 적용할 수 없어요.');
      return;
    }

    let appliedCount = 0;
    let raceCount = 0;
    const failedIds = [];

    for (const sceneId of selectedIds) {
      const result = suggestion.results[sceneId];
      if (!result || result.skip) continue;

      /* originalSnapshot vs 현재 body 비교 (race 검증) */
      const originalBody = suggestion.originalSnapshot[sceneId]
        ? suggestion.originalSnapshot[sceneId].body : null;
      const currentBody = (typeof ViewerState !== 'undefined' && ViewerState.scenes && ViewerState.scenes[sceneId])
        ? ViewerState.scenes[sceneId].body : null;

      if (originalBody != null && currentBody != null && originalBody !== currentBody) {
        /* 사용자가 그 사이 본문 박은 경우 — 안내 + 건너뛰기 */
        raceCount++;
        continue;
      }

      const newBody = result.revisedText || '';

      /* mock history 저장 (localStorage) */
      _saveMockHistory(sceneId, originalBody || '', newBody, suggestion.suggestionId);

      /* v138 _rtSaveBody 재사용 — 메모리 + Firebase + 화면 + 롤백 모두 박힘 */
      try {
        if (typeof _rtSaveBody === 'function') {
          await _rtSaveBody(sceneId, newBody);
          appliedCount++;
        } else {
          /* storyAnalyzer.js 박지 X 박힌 환경 — fallback (mock 단계) */
          console.warn('[AI mock] _rtSaveBody 박지 X — fallback');
          failedIds.push(sceneId);
        }
      } catch (e) {
        console.error('[AI mock apply] 장면', sceneId, '저장 실패:', e);
        failedIds.push(sceneId);
      }
    }

    /* suggestion status 갱신 */
    const totalRevised = Object.values(suggestion.results).filter(r => !r.skip).length;
    if (appliedCount === totalRevised) {
      _updateMockSuggestionStatus(suggestion.suggestionId, 'applied');
    } else if (appliedCount > 0) {
      _updateMockSuggestionStatus(suggestion.suggestionId, 'partially_applied');
    }

    _removeModalRoot('ai-comparison-modal');

    /* 현재 장면 미리보기 갱신 (v138 함수) */
    if (typeof _scheduleViewerFrameReRender === 'function') {
      _scheduleViewerFrameReRender();
    }

    /* 안내 */
    let msg = `✅ ${appliedCount}개 장면에 AI 다듬기 적용했어요.`;
    if (raceCount > 0) msg += `\n⚠ ${raceCount}개 장면은 본문이 바뀌어서 건너뛰었어요. 다시 생성해주세요.`;
    if (failedIds.length > 0) msg += `\n❌ ${failedIds.length}개 장면 저장 실패`;
    msg += '\n\n⚠️ Phase 0.5 mock — 적용된 본문에 "※mock" 라벨이 붙어요. 다음 step에서 라벨이 빠져요.';
    alert(msg);
  }

  /* ════════════════════════════════════════════════════════════════
     유틸
     ════════════════════════════════════════════════════════════════ */
  function _escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\n/g, '<br/>');
  }

  /* BR-FIX-1: <br> 계열 → 실제 줄바꿈(\n). 옛 데이터/편집 버퍼에 섞인 리터럴 <br/> 정규화 (null-safe).
     원본 scene.body엔 <br/>가 없어 사실상 no-op. */
  function _brToNewline(s) {
    return String(s == null ? '' : s).replace(/<br\s*\/?>/gi, '\n');
  }
  /* BR-FIX-1: textarea/value 등 '텍스트' 컨텍스트 전용 이스케이프 — \n→<br/> 안 함.
     (innerHTML 컨텍스트는 기존 _escapeHtml 유지: 거기선 \n→<br/>가 올바름.) */
  function _escapeHtmlText(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ════════════════════════════════════════════════════════════════
     openModal — viewer 상단 [🤖 AI 작품 다듬기] 진입점
     ════════════════════════════════════════════════════════════════ */
  async function openModal() {
    /* Phase 1: 카드가 교사 권한을 반영하도록 모달 전에 aiSettings 로드 보장. */
    try { await _loadClassAiSettings(); } catch (e) { /* fallback 허용 */ }
    if (!_hasSeenOnboarding()) {
      _showOnboardingModal(_showModeModal);
    } else {
      _showModeModal();
    }
  }

  /* ════════════════════════════════════════════════════════════════
     v140-step1: TEST MODE 배지 자동 표시
     ──────────────────────────────────────────────────────────────
     DOMContentLoaded 박힌 후 TEST MODE 박혀있으면 화면 상단에 배지 박음.
     ════════════════════════════════════════════════════════════════ */
  function _bootstrapTestMode() {
    if (!_isTestMode()) return;
    const run = function () { _showTestModeBadge(); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run);
    } else {
      run();
    }
  }
  _bootstrapTestMode();
  _bootstrapAiToggleBar();
  /* Phase 1: 학급 AI 설정 preload — 버튼/카드 게이트용. 실패해도 fallback 허용(서버가 최종 차단). */
  (function _bootstrapClassAiSettings() {
    const run = function () { _preloadClassAiSettings().catch(function () {}); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run);
    } else {
      run();
    }
  })();

  /* Phase 3: 텍스트 aiVariant Firebase preload — 감상자/제작자 공통.
     renderHUD의 preload는 maker-edit 경로(fromMaker && isEdit)에서만 도므로
     감상자 화면에서도 후보가 read되도록 별도 보장.
     ViewerState.project(classId+teamName)는 auto-enter 후 늦게 채워지므로
     준비될 때까지만 짧게 폴링 → 준비되면 1회 preload(내부에서 캐시+프레임 재렌더). */
  (function _bootstrapFirebaseTextVariants() {
    let tries = 0;
    const MAX = 60;                 /* 최대 ~24초 (400ms × 60) — 로드 성공 시 즉시 종료 */
    /* classId/teamName은 URL 파라미터 fallback으로 즉시 잡혀도 Firebase app 초기화는 늦으므로,
       context만 보고 1회 발사하면 app 미준비로 null 반환 후 멈춘다.
       → 실제 로드 성공(out !== null: classId+teamName+app 모두 준비)까지 재시도. */
    const tick = function () {
      tries++;
      Promise.resolve()
        .then(function () { return _preloadFirebaseTextVariants(); })
        .then(function (out) {
          if (out) return;          /* 로드 완료(데이터 유무 무관) → 종료 */
          if (tries < MAX) setTimeout(tick, 400);
        })
        .catch(function () {
          if (tries < MAX) setTimeout(tick, 400);
        });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tick);
    } else {
      tick();
    }
  })();

  /* ════════════════════════════════════════════════════════════════
     window 노출
     ════════════════════════════════════════════════════════════════ */
  if (typeof window !== 'undefined') {
    window.viewerAi = {
      PHASE:      PHASE,
      MOCK_ONLY:  MOCK_ONLY,
      openModal:  openModal,
      _resetOnboarding: function () {
        try { localStorage.removeItem(LS_ONBOARDING_KEY); } catch (e) {}
      },
      _resetMockStore: function () {
        try { localStorage.removeItem(LS_MOCK_STORE_KEY); } catch (e) {}
      },
      _getMockStore: _loadMockStore,
      _getMockUsage: _loadMockUsage,

      /* v140-step1 박은 거 — TEST MODE 박힌 정보 박음 */
      _isTestMode: _isTestMode,
      _isFinalizationBypassEnabled: _isFinalizationBypassEnabled,
      _setFinalizationBypass: _setFinalizationBypass,

      /* v140-step4 박은 거 — viewer-render.js에서 박을 거 (한 줄씩) */
      _getDisplayBody:    _getDisplayBody,
      _getAiViewMode:     _getAiViewMode,
      _setAiViewMode:     _setAiViewMode,
      _isAiVariantViewMode: _isAiVariantViewMode,   /* Phase 4-A: viewer-edit 편집 잠금 판단 */
      _showAiToggleBar:   _showAiToggleBar,
      _isS1Finalized:     _isS1Finalized,

      /* Phase 1: 학급 AI 권한 게이트 — viewer-render.js renderHUD에서 버튼 노출 판단 */
      getClassAiSettings:     getClassAiSettings,
      isClassAiHardOff:       isClassAiHardOff,
      preloadClassAiSettings: _preloadClassAiSettings,

      /* Phase 3: 텍스트 aiVariant Firebase 저장/읽기 */
      _loadFirebaseTextVariants:    _loadFirebaseTextVariants,
      _preloadFirebaseTextVariants: _preloadFirebaseTextVariants,
      _saveTextVariantToFirebase:   _saveTextVariantToFirebase,

      /* Phase 4-C: variant body 편집 저장 — render 게이트 + edit 입력 라우팅 */
      _aiVariantBodyEditAllowed:    _aiVariantBodyEditAllowed,
      _queueVariantBodySave:        _queueVariantBodySave,
      _flushVariantBodySave:        _flushVariantBodySave,

      /* Phase 4-D-1: variant layout(글상자) 편집 저장 — render 변형 박스 + edit 드래그 라우팅 */
      _getDisplayLayout:            _getDisplayLayout,
      _aiVariantLayoutEditAllowed:  _aiVariantLayoutEditAllowed,
      _queueVariantLayoutSave:      _queueVariantLayoutSave,
      _flushVariantLayoutSave:      _flushVariantLayoutSave,
    };

    /* ────────────────────────────────────────────────────────────
       reset 4가지 — 콘솔 박는 거 박은 함수 (사용자 결정 #B)
       window.__resetAiMockUsage()      — 현재 팀 quota만 (기본)
       window.__resetAiMockUsageAll()   — v140 fix: 모든 팀 quota (전체 namespace)
       window.__resetAiMockDrafts()     — drafts만
       window.__resetAiMockVariants()   — variants만
       window.__resetAiMockAll()        — 전체 (usage 모든 팀 + drafts + variants + store + 우회)
       ⚠️ MOCK 전용 — 실 API에는 무효
       ──────────────────────────────────────────────────────────── */
    window.__resetAiMockUsage         = _resetMockUsage;
    window.__resetAiMockUsageAll      = _resetMockUsageAll;
    window.__resetAiMockDrafts        = _resetMockDrafts;
    window.__resetAiMockDraftsAll     = _resetMockDraftsAll;     /* v140 fix 2026-05-21 */
    window.__resetAiMockVariants      = _resetMockVariants;
    window.__resetAiMockVariantsAll   = _resetMockVariantsAll;   /* v140 fix 2026-05-21 */
    window.__resetAiMockAll           = _resetMockAll;
  }
})();
