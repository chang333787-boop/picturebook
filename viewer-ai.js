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
   - v140-step1: 테스트 모드 + reset 함수 + localStorage 키 추가  ← (지금)
   - v140-step2: 후보 3회 흐름 + 후보 모달
   - v140-step3: 편집 중 / 마감 + aiVariants.textS1.final 저장
   - v140-step4: viewer 토글 (원본/AI 1단계) + 마감 후 본문 분기

   mock 저장 정책 (rules 9-6 "rules 변경 X" 정신):
   - v139 저장 방식: ai-suggestions / ai-history localStorage. 적용 본문만 Firebase
   - v140 저장 방식: aiDrafts / aiVariants 모두 localStorage (Firebase 저장 안 함)
     - 원본 body는 절대 덮어쓰지 X (_rtSaveBody 호출 안 함)
     - Phase A 전환 시 Firebase 노드로 이전 예정
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
     v140 mock 전용 localStorage 키 (Phase A 전환 시 Firebase로)
     ⚠️ MOCK 전용 — Phase A 실 API에서는 Firebase 노드로 전환
     ──────────────────────────────────────────────────────────────── */
  const LS_AI_DRAFTS_KEY = 'pb_ai_drafts_v140';          /* aiDrafts.textS1 (mock) */
  const LS_AI_VARIANTS_KEY = 'pb_ai_variants_v140';      /* aiVariants.textS1.final (mock) */
  const LS_AI_VIEW_MODE_KEY = 'pb_ai_view_mode_v140';    /* 'original' | 'aiS1' (mock) */
  /* P5-IMAGE-VARIANT-1: 이미지 보기 모드는 텍스트와 완전 분리(독립 토글). */
  const LS_AI_IMAGE_VIEW_MODE_KEY = 'pb_ai_image_view_mode_v140'; /* 'original' | 'aiS1' | 'aiS2' (이미지 전용) */
  const LS_TEST_MODE_BYPASS_KEY = 'pb_ai_test_bypass_v140'; /* TEST MODE 우회 토글 (mock) */

  /* mock quota 초기값 (사용자 결정 기록 AI_DECISIONS_FINAL.md #5 추천값) */
  const MOCK_QUOTA = {
    s1: 3,        /* 텍스트 1단계 — v140 후보 3회 흐름과 정확히 매치 */
    s2: 1,        /* 텍스트 2단계 — Phase B */
    s3: 1,        /* 텍스트 3단계 — Phase C */
    check: 5,     /* 작품 검사 */
    writeAfterQuestions: 5,  /* WRITE-AFTER Phase 3: 생각 점검 질문 (서버 QUOTA.writeAfterQuestions와 동일). */
  };

  /* mock 응답 지연 (사용자에게 호출 중 UI lock 보여주려고) */
  const MOCK_DELAY_MIN = 2000;
  const MOCK_DELAY_MAX = 5000;

  /* AbortController 대용 — 사용자가 호출 중 취소할 수 있게 */
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
     이 모듈은 mock 전용이라 자유롭게 사용함.
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
    /* TEST MODE에서만 동작. 운영 모드에선 false (그래서 이 함수가 호출돼도 안전) */
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
     v140 fix: mock usage namespace 분리 (팀별 quota — 2026-05-21 적용)
     ──────────────────────────────────────────────────────────────
     사용자 버그 보고 반영 — 같은 브라우저에서 0000 팀 사용하면 은규 / 예지유은인우
     quota도 함께 차감됐음 (LS_MOCK_USAGE_KEY가 공통이어서).

     namespace key 형식:
       pb_ai_mock_usage_v140__{classId}__{teamName}

     fallback:
       classId 없으면 → '_'
       teamName 없으면 → '_'

     ⚠️ usage만 namespace 적용 (사용자 명령). aiDrafts / aiVariants는 공통 키 유지 — 별도 보고 예정.
     ════════════════════════════════════════════════════════════════ */
  function _getCurrentNamespace() {
    let classId = '_', teamName = '_';
    try {
      if (typeof ViewerState !== 'undefined' && ViewerState) {
        /* SHELF-STALE-FIX(2026-07-16): 진실은 ViewerState.project.*(loadTeamData가 책마다 채움).
           기존엔 ViewerState.classId/teamName만 봤는데 그 필드는 코드 어디서도 설정되지 않아 항상 URL로
           폴백 → 책장 SPA 전환(URL 무변경)에서 namespace가 이전 책으로 고정 → AI그림 보기 토글 등
           namespace 캐시가 이전 책 것으로 새던 버그(다른 애 그림 표시). project.* 우선으로 팀별 정확 분리.
           _getCurrentClassIdTeamName(변형 캐시 키)과 동일 소스로 정렬. */
        const proj = ViewerState.project || {};
        if (proj.classId)  classId  = String(proj.classId);
        if (proj.teamName) teamName = String(proj.teamName);
        if (classId === '_' && ViewerState.classId)  classId  = String(ViewerState.classId);
        if (teamName === '_' && ViewerState.teamName) teamName = String(ViewerState.teamName);
      }
      /* URL 파라미터에서 읽는 fallback */
      const p = new URLSearchParams(location.search);
      if (classId === '_' && p.get('classId')) classId = p.get('classId');
      if (teamName === '_' && p.get('team'))   teamName = p.get('team');
    } catch (e) { /* noop */ }
    return classId + '__' + teamName;
  }

  function _getMockUsageKey() {
    return LS_MOCK_USAGE_KEY + '__' + _getCurrentNamespace();
  }

  /* v140 fix 2026-05-21: drafts / variants / viewMode 키도 namespace 적용 — 팀별 분리 (사용자 명령) */
  function _getMockDraftsKey() {
    return LS_AI_DRAFTS_KEY + '__' + _getCurrentNamespace();
  }
  function _getMockVariantsKey() {
    return LS_AI_VARIANTS_KEY + '__' + _getCurrentNamespace();
  }
  function _getMockViewModeKey() {
    return LS_AI_VIEW_MODE_KEY + '__' + _getCurrentNamespace();
  }
  /* P5-IMAGE-VARIANT-1: 이미지 보기 모드 키 — 텍스트 viewMode 키와 분리(팀별 namespace). */
  function _getMockImageViewModeKey() {
    return LS_AI_IMAGE_VIEW_MODE_KEY + '__' + _getCurrentNamespace();
  }

  /* ════════════════════════════════════════════════════════════════
     v140-step1: reset 함수 (사용자 결정 #B + v140 namespace fix)
     ──────────────────────────────────────────────────────────────
     기본 reset = 현재 팀 quota만. drafts / variants는 별도 함수.
     전체 reset이 필요하면 — `__resetAiMockUsageAll` 사용.
     window 노출 — 콘솔에서 호출 가능.
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
    /* 모든 namespace usage 키 삭제 — pb_ai_mock_usage_v140 prefix 기준으로 순회 */
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

  /* v140 fix 2026-05-21: drafts / variants reset도 namespace 적용 — 현재 팀만 (사용자 명령) */
  function _resetMockDrafts() {
    try {
      localStorage.removeItem(_getMockDraftsKey());
      /* 옛 공통 키도 함께 삭제 — 옛 데이터는 namespace 키로 옮기지 않음 (마이그 없음). 단 한 번 정리 목적. */
      localStorage.removeItem(LS_AI_DRAFTS_KEY);
      console.log('[ai-mock] drafts reset (' + _getCurrentNamespace() + ')');
    } catch (e) { console.warn('[ai-mock] drafts reset failed', e); }
  }

  function _resetMockVariants() {
    try {
      localStorage.removeItem(_getMockVariantsKey());
      localStorage.removeItem(_getMockViewModeKey());
      /* P5-IMAGE-VARIANT-1: 이미지 보기 모드도 함께 초기화 */
      localStorage.removeItem(_getMockImageViewModeKey());
      /* 옛 공통 키도 남기지 않음 */
      localStorage.removeItem(LS_AI_VARIANTS_KEY);
      localStorage.removeItem(LS_AI_VIEW_MODE_KEY);
      localStorage.removeItem(LS_AI_IMAGE_VIEW_MODE_KEY);
      console.log('[ai-mock] variants reset (' + _getCurrentNamespace() + ')');
    } catch (e) { console.warn('[ai-mock] variants reset failed', e); }
  }

  /* 전체 reset 버전 — 모든 팀 namespace drafts/variants 삭제 */
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
        else if (k === LS_AI_IMAGE_VIEW_MODE_KEY || k.indexOf(LS_AI_IMAGE_VIEW_MODE_KEY + '__') === 0) keys.push(k);
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
     구조 (mock — Phase A 전환 시 Firebase 노드로):
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
     ⚠️ MOCK 전용 — Phase A 진입 시 Firebase로 전환
     ════════════════════════════════════════════════════════════════ */
  function _loadAiDrafts() {
    /* v140 fix 2026-05-21: 팀별 namespace 키 사용. 옛 공통 키는 읽지 않음. */
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
     ⚠️ TEST MODE가 켜져 있으면 mock 사용 (실 호출 X).
        운영 모드에서 실 호출할 때는 — _callPhaseAFunction 사용.
     ════════════════════════════════════════════════════════════════ */
  /* viewer 화면에서는 named app 'viewer' 사용 (viewer-data.js에서 초기화). default app 아님. */
  function _getViewerFirebaseApp() {
    if (typeof firebase === 'undefined') return null;
    /* POLISH-AUTH-FIX: 편집 세션은 default app(maker UID) — getViewerApp로 통일(Functions context.auth=maker UID). */
    if (typeof getViewerApp === 'function') { try { return getViewerApp(); } catch (e) { /* noop */ } }
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
    /* auth가 없으면 anonymous 로그인 (Functions context.auth가 있어야 함) */
    await _ensureAnonymousAuth(app);
    /* 서울 region 고정 — functions/index.js setGlobalOptions와 일치 */
    const fns = app.functions('asia-northeast3');
    const callable = fns.httpsCallable(fnName);
    const result = await callable(payload);
    return result.data;
  }

  /* Phase A 실 API 진입 판단 — 운영 모드만. TEST MODE면 mock 사용. */
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

  /* anonymous 인증 보장 — 로그인이 안 돼 있으면 로그인 (named app 'viewer' 기준) */
  async function _ensureAnonymousAuth(app) {
    try {
      const authObj = app ? app.auth() : firebase.auth();
      const cur = authObj.currentUser;
      if (cur) return cur;
      /* POLISH-AUTH-FIX: 편집 세션은 maker UID(복원됨)만 사용 — 새 익명 로그인 금지
         (default app maker UID를 덮어쓰면 권한이 깨진다).
         REFINE-STAB-A 보강: 복원이 아직이면 viewerAuthReady(_awaitMakerAuth)를 잠시 대기 후 재확인
         — 진입 직후 호출이 auth 없이 나가 unauthenticated로 실패하던 케이스(로그 실증) 방지. */
      if (typeof isEditViewerSession === 'function' && isEditViewerSession()) {
        try {
          if (typeof window !== 'undefined' && window.viewerAuthReady) {
            await Promise.race([window.viewerAuthReady, new Promise(r => setTimeout(r, 3000))]);
          }
        } catch (e) { /* noop */ }
        return authObj.currentUser || null;   /* 복원 실패면 null — 새 익명 금지 유지 */
      }
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
  const AI_MODE_KEY_MAP = { s1: 'textS1', s2: 'textS2', check: 'workCheck', writeAfterQuestions: 'writeAfterQuestions', imageS1: 'imageS1', imageS2: 'imageS2' };
  let _classAiSettings = undefined;        // undefined|null|object
  let _classAiSettingsClassId = null;
  let _classAiSettingsLoading = false;
  /* WRITE-AFTER Phase 5C: 1단계 최근 결과 존재 여부(모달 열 때 aiChecks latest read로 채움·best-effort). */
  let _writeAfterLatest = { waq: false, wc: false };

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

  /* P5-IMAGE-CLIENT-1B: 그림 AI(imageS1)는 준비 중 기능이므로 fallback 없이
     반드시 class aiSettings가 존재 + enabled===true + modes.imageS1===true 인 경우에만 허용.
     (미로드 undefined / 노드없음 null / enabled 미설정 → 모두 false) */
  function _isImageS1ExplicitlyEnabledByTeacher() {
    const s = _classAiSettings;
    return !!(s && s.enabled === true && s.modes && s.modes.imageS1 === true);
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
    /* P5-IMAGE-VARIANT-1 — 이미지 aiVariant 캐시 로딩(fire-and-forget·읽기 전용). */
    if (typeof _preloadFirebaseImageVariants === 'function') {
      _preloadFirebaseImageVariants();
    }
    /* P5-IMAGE-CLIENT-1 — 이미지 AI 진입 버튼 노출 재평가(aiSettings 로드 후 imageS1 게이트 반영). */
    if (typeof _showImageAiEntryButton === 'function') {
      try { _showImageAiEntryButton(); } catch (e) { /* noop */ }
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
      /* testMode 전달 안 함 — 실 API라 불필요. testMode 요청은 Functions 단에서 거부함 */
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

  /* WRITE-AFTER Phase 3: 생각 점검 질문 — callWorkCheck와 동일 호출 형태(payload 동일). */
  async function _phaseACallWriteAfterQuestions(snapshot) {
    const { classId, teamName } = _getCurrentClassIdTeamName();
    const branchLineage = (typeof ViewerState !== 'undefined' && ViewerState.branchLineage) || {};
    return _callPhaseAFunction('callWriteAfterQuestions', {
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
      showAiNotice('이 작품에서 사용할 수 있는 ‘장면 발전’ 횟수를 모두 사용했어요.\n다른 장면은 직접 이어서 써 보거나, 나중에 다시 사용해 주세요.');
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
      showAiNotice('AI 장면 발전을 하지 못했어요.\n' + _friendlyAiError(e));
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
      + '<div class="ai-modal__header"><div class="ai-modal__title">✨ AI 장면발전 결과</div>'
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
    showAiToast(appliedCount + '개 장면에 장면 발전을 적용했어요. 원본은 그대로예요.');
  }

  /* ════════════════════════════════════════════════════════════════
     v140-step2: mock 후보 생성 (1 후보 세트 = 작품 전체)
     ──────────────────────────────────────────────────────────────
     v139의 _mockReviseS1을 재사용. 한 회차 = 1 후보.
     ════════════════════════════════════════════════════════════════ */
  async function _mockGenerateCandidate(snapshot, attemptN) {
    /* mock 응답 지연 적용 (사용자에게 호출 중 UI lock 보여주려고) */
    const delayMs = Math.floor(Math.random() * (MOCK_DELAY_MAX - MOCK_DELAY_MIN)) + MOCK_DELAY_MIN;
    await _delay(delayMs);

    const results = {};
    /* fix 2026-05-21: _buildWorkSnapshot은 {sceneId: scene} 객체 반환 (배열 X). Object.values 사용. */
    const sceneList = Object.values(snapshot || {});
    sceneList.forEach(s => {
      if (!s || !s.body || !s.body.trim()) return;
      /* 30% skip (이미 자연스러움) — v139 동작 그대로 */
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
     ⚠️ 폐기 흐름(v140 AI 1단계 후보 모달) — 현재 UI 진입점 0(비노출). 삭제 예정·심사 무관(LOW-18).
   v140-step2: _startTextS1V140 — 1단계 진입 (drafting 차단 + 후보 누적)
     ──────────────────────────────────────────────────────────────
     v139의 _startTextS1은 사용하지 않음 — 옛 흐름 비활성. 호출되지 않음.
     사용자 결정 #F: drafting 중에는 다른 AI 호출 차단.
     ════════════════════════════════════════════════════════════════ */
  async function _startTextS1V140() {
    /* 사용자 결정 #F — drafting 중에는 다른 AI 호출 차단 */
    if (_isS1Drafting()) {
      alert('AI 1단계 편집 중입니다. 편집 화면에서 저장/마감하거나 취소해주세요.');
      _showDraftingPanel();   /* AI-STAB-2: 편집 패널로 복귀 — [취소]/[저장·마감]로 빠져나갈 수 있음 */
      return;
    }

    /* v140 fix 2026-05-21: 4가지 분기 (사용자 명) */
    const count = _getCandidateCount();
    /* Phase A fix 2026-05-21: 실 API 모드에서는 — Functions가 자체 quota 관리. client mock quota 사용 안 함. */
    const useRealApiCheck = _shouldUseRealApi();
    const remaining = useRealApiCheck ? Infinity : _getRemaining('s1');

    /* (1) 후보 X / quota X → reset 안내 모달 */
    if (count === 0 && remaining <= 0) {
      _showQuotaEmptyModal();
      return;
    }

    /* (2) 후보 O / quota X → 후보 모달 (단 [더 생성하기] 비활성 — _showCandidatesModal 내부에서 처리) */
    if (count > 0 && remaining <= 0) {
      _showCandidatesModal();
      return;
    }

    /* (3) 후보 3회 누적 (모든 회차 생성됨) → 후보 모달 표시 (실 API는 Functions에서 별도 quota 관리 — 일단 client 제한 없음) */
    if (!useRealApiCheck && count >= MOCK_QUOTA.s1) {
      _showCandidatesModal();
      return;
    }

    /* quota 차감 + 호출 lock */
    /* Phase A fix 2026-05-21: 실 API 모드 — Functions가 quota 차감. client mockUsage 차감 안 함. */
    if (!useRealApiCheck) {
      _consumeQuota('s1');
    }
    _setAiTextS1Status('generating');

    const snapshot = _buildWorkSnapshot();
    /* fix 2026-05-21: snapshot은 {sceneId: scene} 객체. 길이는 Object.keys로 계산. */
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
        /* Functions 응답 수신 → candidate로 변환 */
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
        /* TEST MODE 또는 fallback — mock 사용 */
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
         - mock인 경우: _refundQuota('s1') (localStorage)
         - 실 API인 경우: Functions에서 _refundQuota 자동 처리 (Firebase 트랜잭션). client _refundQuota는 호출 안 함 — client mockUsage만 reset하게 됨 (실 API에서는 mockUsage 차감 안 함) */
      console.error('[v140 / Phase A] 후보 생성 실패', e);
      if (!useRealApi) {
        _refundQuota('s1');
      }
      _hideCallingModal();
      _setAiTextS1Status(count > 0 ? 'candidate_ready' : 'none');
      showAiNotice('AI 문장 정돈을 하지 못했어요.\n' + _friendlyAiError(e));
      return;
    }

    _hideCallingModal();
    _showCandidatesModal();
  }

  /* ════════════════════════════════════════════════════════════════
     v140 fix 2026-05-21: quota 0 안내 모달 (사용자 명)
     ──────────────────────────────────────────────────────────────
     후보 X / quota X일 때 표시 — AI 호출 없이 안내만 보여줌.
     TEST MODE에서는 reset 버튼 제공 — 즉시 다시 시도 가능.
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
        showAiToast('AI 사용 횟수를 초기화했어요.');
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

    /* v140 fix 2026-05-21: lock: true 적용 — overlay 클릭/ESC로 닫히지 않음 (사용자 명령) */
    const root = _createModalRoot('ai-cand-modal-root', inner, { lock: true, size: 'large' });

    let activeAttempt = selected || attempts[attempts.length - 1];

    function renderBody() {
      const body = root.querySelector('.js-ai-cand-body');
      if (!body) return;
      const c = cands['attempt' + activeAttempt];
      if (!c) { body.innerHTML = '<div class="ai-cand-empty">후보가 없어요</div>'; return; }
      const snapshot = _buildWorkSnapshot();
      /* fix 2026-05-21: snapshot은 {sceneId: scene} 객체. Object.values 사용. */
      const scenes = Object.values(snapshot || {});
      const rows = scenes.map(function (s) {
        const r = c.results[s.id];   /* Functions가 sceneId 정규화 처리 — fallback 불필요 */
        if (!r) return '<div class="ai-cand-row ai-cand-row--none"><div class="ai-cand-scene-id">장면 ' + _escapeHtml(s.id) + '</div><div class="ai-cand-skip">(결과 없음)</div></div>';
        if (r.skip) return ''
          + '<div class="ai-cand-row ai-cand-row--skip">'
          +   '<div class="ai-cand-scene-id">장면 ' + _escapeHtml(s.id) + '</div>'
          +   '<div class="ai-cand-skip">✅ 수정 없음 — 원본을 그대로 유지해도 좋아요.'
          +     (r.reason ? '<span style="display:block;margin-top:2px;color:#8a8f98;font-size:12px;">이유: ' + _escapeHtml(r.reason) + '</span>' : '')
          +   '</div>'
          +   '<div style="margin-top:4px;color:#9aa0a6;font-size:12px;line-height:1.5;white-space:pre-wrap;">' + _escapeHtml(s.body || '') + '</div>'
          + '</div>';
        /* 강한 경고가 있으면 — UI 표시. 적용 자체는 여기서 막지 않음 — _finalizeAiVariant 저장 시 차단함 */
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

    /* 탭 전환 처리 */
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
        _startTextS1V140();   /* 다시 호출 — 후보 누적됨 */
      });
    }

    /* [이 후보 선택하기] — step3의 편집 중 모달로 진입 */
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
     구조 (mock — Phase A 전환 시 Firebase 노드로):
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
     ⚠️ MOCK 전용 — Phase A 진입 시 Firebase로 전환
     ════════════════════════════════════════════════════════════════ */
  function _loadAiVariants() {
    /* v140 fix 2026-05-21: 팀별 namespace 키 사용 */
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
  /* Phase 4-D-2A: variant style(textStyle) 메모리 캐시. body/layout 캐시와 같은 로더로 채움. */
  let _fbTextVariantStyles = null; /* { s1:{sid:{textStyle}}, s2:{sid:{textStyle}} } | null */

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
      const styleOut = { s1: {}, s2: {} };
      Object.keys(raw).forEach(function (sid) {
        const node = raw[sid] || {};
        if (node.s1 && typeof node.s1.body === 'string') out.s1[sid] = node.s1.body;
        if (node.s2 && typeof node.s2.body === 'string') out.s2[sid] = node.s2.body;
        if (node.s1 && node.s1.layout && node.s1.layout.picturebookBodyBox) layoutOut.s1[sid] = { picturebookBodyBox: node.s1.layout.picturebookBodyBox };
        if (node.s2 && node.s2.layout && node.s2.layout.picturebookBodyBox) layoutOut.s2[sid] = { picturebookBodyBox: node.s2.layout.picturebookBodyBox };
        if (node.s1 && node.s1.style && node.s1.style.textStyle) styleOut.s1[sid] = { textStyle: node.s1.style.textStyle };
        if (node.s2 && node.s2.style && node.s2.style.textStyle) styleOut.s2[sid] = { textStyle: node.s2.style.textStyle };
      });
      _fbTextVariants = out;
      _fbTextVariantLayouts = layoutOut;
      _fbTextVariantStyles = styleOut;
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
    if (!box) return originalBox;
    /* REFINE-STAB-B: 글상자 진하기/배경(backdropOpacity)은 항상 원본(장면 꾸미기) 설정을 따른다.
       variant layout은 위치/크기(x/y/width/height)만 variant 고유 — 저장 시점 opacity가 굳어
       원본에서 진하기를 바꿔도 AI 보기에 반영되지 않던 문제 수정(필드 누락 시 무효 CSS 방지 겸). */
    const opacity = (originalBox && typeof originalBox.backdropOpacity === 'number')
      ? originalBox.backdropOpacity
      : (typeof box.backdropOpacity === 'number' ? box.backdropOpacity : 0.85);
    return Object.assign({}, box, { backdropOpacity: opacity });
  }

  /* 렌더 통합 진입점 — { picturebookBodyBox } 반환. originalBox는 호출부(render)가 getPicturebookBodyBox(scene)로 전달. */
  function _getDisplayLayout(sceneId, originalBox) {
    return { picturebookBodyBox: _getDisplayPbBodyBox(sceneId, originalBox) };
  }

  /* Phase 4-D-2A: variant style(textStyle) 동기 조회. FB 캐시 우선 → localStorage final.style → null. */
  function _getFbVariantStyle(variantKey, sceneId) {
    if (!_fbTextVariantStyles) return null;
    const m = _fbTextVariantStyles[variantKey];
    if (!m) return null;
    const v = m[String(sceneId)];
    return (v && v.textStyle) ? v.textStyle : null;
  }

  function _getLocalVariantStyle(variantKey, sceneId) {
    try {
      const v = _loadAiVariants();
      const variant = (variantKey === 's2') ? v.textS2 : v.textS1;
      const f = variant && variant.final && variant.final[String(sceneId)];
      if (f && f.style && f.style.textStyle) return f.style.textStyle;
    } catch (e) { /* noop */ }
    return null;
  }

  /* 현재 보기 모드 기준 표시할 textStyle 반환.
     원본 보기 → originalStyle 그대로(null 가능 — 렌더가 기본값 처리).
     aiS1/aiS2 보기 → variant style(FB→local) 있으면 그것, 없으면 originalStyle fallback.
     body/layout fallback 원칙과 동일. style variant는 해당 variant 노드에서만 읽어 s1/s2 혼선 없음. */
  function _getDisplayStyle(sceneId, originalStyle) {
    const mode = _getAiViewMode();
    if (mode !== 'aiS1' && mode !== 'aiS2') return originalStyle;
    const variantKey = (mode === 'aiS2') ? 's2' : 's1';
    const st = _getFbVariantStyle(variantKey, sceneId) || _getLocalVariantStyle(variantKey, sceneId);
    return st || originalStyle;
  }

  /* HUD preload에서 fire-and-forget. 로딩 후 프레임 재렌더 → _getDisplayBody가 Firebase 반영. */
  async function _preloadFirebaseTextVariants() {
    const out = await _loadFirebaseTextVariants(false);
    if (out && (Object.keys(out.s1).length || Object.keys(out.s2).length)) {
      /* Phase 4-A: FB 후보가 캐시에 들어왔으니 토글 바를 갱신(감상자도 노출되도록). */
      if (typeof _showAiToggleBar === 'function') {
        try { _showAiToggleBar(); } catch (e) { /* noop */ }
      }
      /* VIEW-RENDER-DEDUP-1(2026-07-05): 원본 보기 중엔 variant 캐시 도착이 화면 내용을 하나도
         바꾸지 않는다(토글 바 노출은 위에서 별도 처리). 그런데 재렌더 fallback=통째
         renderCurrentScene이라 감상 진입 직후 같은 장면이 페이드로 다시 나타나던 원인.
         복원된 보기 모드가 s1/s2일 때만(FB 캐시 도착으로 실제 표시가 바뀜) 재렌더. */
      if (_isAiVariantViewMode()) {
        _requestViewerFrameRerender();   /* VIEWER-TOGGLE-LIVE-REFRESH-FIX: 감상 fallback 포함 */
      }
    }
    return out;
  }

  /* ════════════════════════════════════════════════════════════════
     P5-IMAGE-VARIANT-1: 이미지 aiVariant Firebase 읽기 + 표시 hook
     ──────────────────────────────────────────────────────────────
     · 텍스트 variant와 완전 분리(별도 캐시·별도 보기 모드·별도 토글 바).
     · 읽기 전용: classes/{cid}/teams/{enc}/aiVariants/image/{sid}/{s1|s2}.
       (aiVariants.write:false — 클라 write 불가. 생성/저장은 서버 단계에서.)
     · 원본 보호: scene.imageData / scene.imageUrl은 절대 읽기만 하고 건드리지 않음.
       이 단계는 "이미지 생성/모델 호출 없음" — 후보가 이미 있다고 가정한 표시 구조만.
     ════════════════════════════════════════════════════════════════ */
  let _fbImageVariants = null;     /* { s1:{sid:{url,storagePath,stale}}, s2:{...} } | null(미로딩) */
  let _fbImageVariantsKey = null;  /* 'classId__teamName' — 팀 바뀌면 캐시 무효화 */

  async function _loadFirebaseImageVariants(force) {
    const key = _fbVariantCacheKey();
    if (!force && _fbImageVariants && _fbImageVariantsKey === key) return _fbImageVariants;
    const { classId, teamName } = _getCurrentClassIdTeamName();
    if (!classId || !teamName) return null;
    const app = _getViewerFirebaseApp();
    if (!app || !app.database) return null;
    const enc = encodeURIComponent(teamName);
    try {
      const snap = await app.database().ref('classes/' + classId + '/teams/' + enc + '/aiVariants/image').once('value');
      const raw = snap.val() || {};
      const out = { s1: {}, s2: {} };
      Object.keys(raw).forEach(function (sid) {
        const node = raw[sid] || {};
        if (node.s1 && typeof node.s1.url === 'string' && node.s1.url) {
          out.s1[sid] = { url: node.s1.url, storagePath: node.s1.storagePath || null, stale: !!node.s1.stale };
        }
        if (node.s2 && typeof node.s2.url === 'string' && node.s2.url) {
          out.s2[sid] = { url: node.s2.url, storagePath: node.s2.storagePath || null, stale: !!node.s2.stale };
        }
      });
      _fbImageVariants = out;
      _fbImageVariantsKey = key;
      return out;
    } catch (e) {
      console.warn('[P5] aiVariants/image 읽기 실패(원본 fallback)', e);
      return null;
    }
  }

  /* 동기 — 캐시에서만. 미로딩/없음이면 null(호출부가 원본 fallback). */
  function _getFbImageVariantUrl(variantKey, sceneId) {
    if (!_fbImageVariants) return null;
    /* SHELF-STALE-FIX(2026-07-16): 캐시가 '현재 팀' 것일 때만 사용. 책장 SPA 전환 직후 재로딩(async) 전엔
       _fbImageVariants가 아직 이전 책 것이라, 키 검증 없이 읽으면 이전 애 변형을 새 책 장면에 씌운다
       → 키 불일치면 null(원본 fallback). _loadFirebaseImageVariants의 키 가드와 동일 기준. */
    if (_fbImageVariantsKey !== _fbVariantCacheKey()) return null;
    const m = _fbImageVariants[variantKey];
    if (!m) return null;
    const v = m[String(sceneId)];
    return (v && typeof v.url === 'string' && v.url) ? v.url : null;
  }

  function _hasImageVariantS1() {
    if (_fbImageVariantsKey !== _fbVariantCacheKey()) return false;   /* SHELF-STALE-FIX: 다른 팀 캐시 무시 */
    return !!(_fbImageVariants && _fbImageVariants.s1 && Object.keys(_fbImageVariants.s1).length);
  }
  function _hasImageVariantS2() {
    if (_fbImageVariantsKey !== _fbVariantCacheKey()) return false;   /* SHELF-STALE-FIX: 다른 팀 캐시 무시 */
    return !!(_fbImageVariants && _fbImageVariants.s2 && Object.keys(_fbImageVariants.s2).length);
  }

  /* 이미지 보기 모드 — 텍스트(_getAiViewMode)와 독립. 별도 localStorage 키. */
  function _getAiImageViewMode() {
    try {
      const v = localStorage.getItem(_getMockImageViewModeKey());
      return (v === 'aiS1' || v === 'aiS2') ? v : 'original';
    } catch (e) { return 'original'; }
  }

  /* 렌더 통합 진입점 — 호출부가 이미 해석한 originalSrc(scene.imageData||scene.imageUrl 등)를 그대로 전달.
     원본 보기 → originalSrc 그대로 반환(각 렌더 사이트의 fallback 체인을 그대로 보존 → 동작 변화 0).
     aiS1/aiS2 보기 → 해당 variant url 있으면 그것, 없으면 originalSrc fallback.
     원본 scene.imageData/imageUrl은 절대 변경하지 않음(read-only). */
  function _trueOriginalSrc(scene, fallback) {
    if (scene && typeof scene.imageData === 'string' && scene.imageData) return scene.imageData;
    if (scene && typeof scene.imageUrl === 'string' && scene.imageUrl) return scene.imageUrl;
    return fallback;
  }
  function _getDisplayImageSrc(scene, originalSrc) {
    try {
      if (!scene) return originalSrc;
      var raw = null;
      try { raw = localStorage.getItem(_getMockImageViewModeKey()); } catch (e) { raw = null; }   /* null|'original'|'aiS1'|'aiS2' */
      const sid = (scene.id != null) ? scene.id : scene.sceneId;
      if (raw === 'aiS1' || raw === 'aiS2') {
        if (sid == null) return originalSrc;
        const variantKey = (raw === 'aiS2') ? 's2' : 's1';
        const url = _getFbImageVariantUrl(variantKey, sid);
        return (typeof url === 'string' && url) ? url : _trueOriginalSrc(scene, originalSrc);
      }
      /* ★ 명시적 '원본' 보기(교사가 원본 버튼 클릭) → 발행 선택(s2) 무시하고 진짜 원본 표시(원본 버튼이 원본을 보장). */
      if (raw === 'original') return _trueOriginalSrc(scene, originalSrc);
      /* 토글 안 함(기본·학생) → 전달된 src 그대로(= getPublishedImageDisplaySrc 발행 선택 결과). */
      return originalSrc;
    } catch (e) { return originalSrc; }
  }

  /* HUD/부트스트랩 preload에서 fire-and-forget. 후보 있으면 토글 바 노출 + 프레임 재렌더. */
  async function _preloadFirebaseImageVariants() {
    const out = await _loadFirebaseImageVariants(false);
    if (out && (Object.keys(out.s1).length || Object.keys(out.s2).length)) {
      if (typeof _showAiImageToggleBar === 'function') {
        try { _showAiImageToggleBar(); } catch (e) { /* noop */ }
      }
      /* VIEW-RENDER-DEDUP-1: 텍스트 preload와 동일 — 원본 보기 중 재렌더 skip(불필요한 전체
         페이드 재시작 방지). 이미지 보기 모드가 s1/s2로 복원된 경우에만 재렌더. */
      if (_getAiImageViewMode() !== 'original') {
        _requestViewerFrameRerender();   /* VIEWER-TOGGLE-LIVE-REFRESH-FIX: 감상 fallback 포함 */
      }
    }
    return out;
  }

  /* SHELF-STALE-FIX(2026-07-16): 책장 SPA로 다른 책 진입 시 팀별 재초기화.
     viewer-ai는 지연 로드라 첫 책에서 1회만 부트스트랩됨 → 둘째 책부턴 변형/토글 바가 첫 책 것으로 고정
     ("AI 토글이 첫 작품 말고는 안 먹힘"). loadTeamData가 (viewer-ai 이미 로드된 경우) 매 책마다 호출:
     이미지·텍스트 변형을 새 팀 기준으로 force 재로딩 + 토글 바 재구성(_show*가 현재 팀 변형으로 재평가)
     + 프레임 재렌더. 토글 모드는 team-scoped(namespace 수정)라 새 책은 기본 '원본'으로 시작. */
  async function _reinitForCurrentTeam() {
    try { await _loadFirebaseImageVariants(true); } catch (e) { /* noop */ }
    try { await _loadFirebaseTextVariants(true); } catch (e) { /* noop */ }
    try { if (typeof _showAiImageToggleBar === 'function') _showAiImageToggleBar(); } catch (e) { /* noop */ }
    try { if (typeof _showAiToggleBar === 'function') _showAiToggleBar(); } catch (e) { /* noop */ }
    try { if (typeof _requestViewerFrameRerender === 'function') _requestViewerFrameRerender(); } catch (e) { /* noop */ }
  }

  /* ════════════════════════════════════════════════════════════════
     P5-IMAGE-POLICY-1: 작품 단위 이미지 입력 방식(imagePolicy) 선택/저장
     ──────────────────────────────────────────────────────────────
     · 경로: classes/{cid}/teams/{enc}/viewer-meta/imagePolicy (v1 legacy: teams/{enc}/...).
       imagePolicy child만 set — viewer-meta 다른 필드는 절대 건드리지 않음(통째 덮어쓰기 X).
     · sourceMode는 'upload' | 'draw'만 허용. 그 외/없음 → null(미설정)로 취급. 자동 추정 금지.
     · 최초 이미지 AI 사용 전 선택 모달로 결정. 한 번 정하면 작품 단위 lock.
     · 이번 단계는 helper + 모달 준비까지. 실제 이미지 생성/모델 호출과 연결하지 않음.
     · viewer-meta는 rules상 auth!=null이면 클라 write 가능 → 기존 write 구조 사용.
       TODO(향후): lock 무결성 강화가 필요하면 서버 callable lock으로 격상 가능.
     ════════════════════════════════════════════════════════════════ */
  const IMAGE_SOURCE_MODES = ['upload', 'draw'];
  let _imagePolicy = null;            /* { sourceMode, lockedAtSceneId, lockedAt, lockedBy } | null */
  let _imagePolicyLoadedKey = null;   /* namespace 캐시 무효화 (null 결과도 '로드됨'으로 표기) */

  /* upload/draw가 아니면 null. 그 외 필드는 안전 기본값으로 정규화. */
  function _sanitizeImagePolicy(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (IMAGE_SOURCE_MODES.indexOf(raw.sourceMode) === -1) return null;
    return {
      sourceMode: raw.sourceMode,
      lockedAtSceneId: (raw.lockedAtSceneId != null) ? raw.lockedAtSceneId : null,
      lockedAt: (typeof raw.lockedAt === 'number' || typeof raw.lockedAt === 'string') ? raw.lockedAt : null,
      lockedBy: (raw.lockedBy != null) ? raw.lockedBy : null,
    };
  }

  /* viewer-data.js의 basePath 규칙과 동일(v2 classId / v1 legacy). teamName 없으면 null. */
  function _imagePolicyBasePath() {
    const { classId, teamName } = _getCurrentClassIdTeamName();
    if (!teamName) return null;
    const enc = encodeURIComponent(teamName);
    return classId ? ('classes/' + classId + '/teams/' + enc) : ('teams/' + enc);
  }

  function _getImagePolicyLockedBy() {
    try {
      const app = _getViewerFirebaseApp();
      if (app && typeof app.auth === 'function') {
        const u = app.auth().currentUser;
        if (u) return u.uid || u.email || null;
      }
    } catch (e) { /* noop */ }
    try {
      const c = _getCurrentClassIdTeamName();
      return c.teamName ? ('team:' + c.teamName) : null;
    } catch (e) { return null; }
  }

  /* 읽기 전용. 실패/미준비/없음 → 기존 캐시 유지(보통 null). */
  async function _loadImagePolicy(force) {
    const key = _fbVariantCacheKey();
    if (!force && _imagePolicyLoadedKey === key) return _imagePolicy;
    const base = _imagePolicyBasePath();
    const app = _getViewerFirebaseApp();
    if (!base || !app || !app.database) return _imagePolicy;  /* 미준비 — 로드 표기 안 함(재시도 가능) */
    try {
      const snap = await app.database().ref(base + '/viewer-meta/imagePolicy').once('value');
      _imagePolicy = _sanitizeImagePolicy(snap.val());
      _imagePolicyLoadedKey = key;
      return _imagePolicy;
    } catch (e) {
      console.warn('[P5] imagePolicy 읽기 실패(미설정 취급)', e);
      return _imagePolicy;
    }
  }

  /* 동기 — 캐시에서만. 미로딩이면 null. */
  function _getImagePolicy() {
    return _imagePolicy;
  }

  /* IMAGE-S2-2: 직접 RTDB write 제거 → 서버 lockImageSourceMode callable(원자 transaction)로 격상.
     서버가 auth/정본 기준으로 lockedAt/lockedBy 기록(클라는 sourceMode·sceneId만 전달).
     성공 시 서버 기록값 재로드. 반대 모드면 conflict(현재 모드 반환) — 호출부가 안내. */
  async function _saveImagePolicy(policy) {
    const clean = _sanitizeImagePolicy(policy);
    if (!clean) return { ok: false, reason: 'bad-sourceMode' };
    const { classId, teamName } = _getCurrentClassIdTeamName();
    if (!classId || !teamName) return { ok: false, reason: 'no-context' };
    let data;
    try {
      data = await _callPhaseAFunction('lockImageSourceMode', {
        classId: classId,
        teamName: teamName,
        sceneId: (clean.lockedAtSceneId != null) ? clean.lockedAtSceneId : null,
        sourceMode: clean.sourceMode,
      });
    } catch (e) {
      console.warn('[P5] imagePolicy lock 호출 실패', e && (e.code || e.message));
      return { ok: false, reason: 'lock-failed', error: e && e.message };
    }
    if (data && data.ok) {
      await _loadImagePolicy(true);                 /* 서버 기록값으로 캐시 갱신 */
      return { ok: true, policy: _getImagePolicy() || clean };
    }
    if (data && data.code === 'SOURCE_MODE_CONFLICT') {
      await _loadImagePolicy(true);
      return { ok: false, reason: 'conflict', currentSourceMode: data.currentSourceMode, policy: _getImagePolicy() };
    }
    return { ok: false, reason: (data && data.code) || 'lock-failed' };
  }

  /* 최초 설정 선택 모달 — Promise<'upload'|'draw'|null('취소')>. 저장은 호출부(ensure)가 담당. */
  function _openImageSourceModal() {
    return new Promise(function (resolve) {
      try {
        const prev = document.getElementById('ai-image-source-modal');
        if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
        const ov = document.createElement('div');
        ov.id = 'ai-image-source-modal';
        ov.style.cssText = 'position:fixed;inset:0;z-index:10010;display:flex;align-items:center;'
          + 'justify-content:center;background:rgba(0,0,0,0.45);';
        const btnCss = 'appearance:none;border:1px solid #e8dcc4;border-radius:12px;padding:12px 14px;'
          + 'font-family:\'Jua\',sans-serif;font-size:14px;cursor:pointer;text-align:left;';
        ov.innerHTML = '<div style="background:#fffaee;border-radius:18px;max-width:420px;width:90%;'
          + 'padding:24px 22px;box-shadow:0 12px 40px rgba(0,0,0,0.25);font-family:\'Jua\',sans-serif;color:#5b4a30;">'
          + '<div style="font-size:18px;margin-bottom:8px;">이 작품의 그림은 어떻게 만들었나요?</div>'
          + '<div style="font-size:13px;line-height:1.6;color:#8a7a5e;margin-bottom:18px;">'
          + '한 번 선택하면 이 작품의 이미지 AI 기준으로 사용됩니다.<br/>원본 그림은 그대로 유지됩니다.</div>'
          + '<div style="display:flex;flex-direction:column;gap:10px;">'
          + '<button type="button" class="js-ai-imgsrc-upload" style="' + btnCss + 'background:#f3e7cc;color:#6b5638;">'
          + '📷 업로드한 이미지/사진 기준으로 정돈</button>'
          + '<button type="button" class="js-ai-imgsrc-draw" style="' + btnCss + 'background:#f3e7cc;color:#6b5638;">'
          + '✏️ 그림판에서 그린 그림 기준으로 정돈</button>'
          + '<button type="button" class="js-ai-imgsrc-cancel" style="' + btnCss + 'background:transparent;color:#8a7a5e;border-color:transparent;text-align:center;">'
          + '취소</button>'
          + '</div></div>';
        document.body.appendChild(ov);
        let settled = false;
        function done(val) {
          if (settled) return;
          settled = true;
          if (ov.parentNode) ov.parentNode.removeChild(ov);
          resolve(val);
        }
        ov.querySelector('.js-ai-imgsrc-upload').addEventListener('click', function () { done('upload'); });
        ov.querySelector('.js-ai-imgsrc-draw').addEventListener('click', function () { done('draw'); });
        ov.querySelector('.js-ai-imgsrc-cancel').addEventListener('click', function () { done(null); });
        ov.addEventListener('click', function (e) { if (e.target === ov) done(null); });
      } catch (e) { resolve(null); }
    });
  }

  /* 이미지 AI 호출 전 게이트. 이미 lock돼 있으면 모달 없이 그 정책 반환.
     IMAGE-S2-2A 역할 축소: 신규 정상 작품은 첫 원본 저장 때 _commitImageSourceMode로
     이미 sourceMode가 잠긴다 → 이 함수는 더 이상 최초 결정자가 아니다. 남은 역할은
     (1) 기존 sourceMode 읽기, (2) sourceMode 없는 "기존 작품"만 명시 선택 보조(모달, 자동 추정 금지).
     이미 upload/draw가 섞인 기존 작품을 단일 방식으로 거짓 표기하지 않음(혼합은 코드로 판별 불가 →
     모달로 사용자 명시 선택에 위임). 취소/실패면 null. */
  async function _ensureImagePolicyBeforeImageAi(scene) {
    let cur = _getImagePolicy();
    if (!cur || IMAGE_SOURCE_MODES.indexOf(cur.sourceMode) === -1) {
      cur = await _loadImagePolicy(true);
    }
    if (cur && IMAGE_SOURCE_MODES.indexOf(cur.sourceMode) !== -1) return cur;
    const choice = await _openImageSourceModal();
    if (choice !== 'upload' && choice !== 'draw') return null;  /* 취소 → 저장 안 함 */
    const sid = scene ? ((scene.id != null) ? scene.id : (scene.num != null ? scene.num : null)) : null;
    const res = await _saveImagePolicy({
      sourceMode: choice,
      lockedAtSceneId: sid,
    });
    if (res.ok) return res.policy;
    /* 경쟁에서 다른 방식이 먼저 원자적으로 잠긴 경우: 잠긴 방식 안내 후 그 정책으로 진행(섞기 방지). */
    if (res.reason === 'conflict' && res.policy) {
      try {
        if (typeof showAiToast === 'function') {
          showAiToast('이 작품은 이미 ' + (res.currentSourceMode === 'upload' ? '‘파일 올리기’' : '‘직접 그리기’')
            + ' 방식으로 시작했어요. 같은 작품에서는 두 방식을 섞을 수 없어요.');
        }
      } catch (e) { /* noop */ }
      return res.policy;
    }
    return null;
  }

  /* S2-2A-FIX1 — 패배 시 *이번에 만든 고유 객체만* 삭제(prefix 검증). scene DB는 절대 건드리지 않음
     (gate-first라 패자는 scene을 애초에 안 씀 → CAS rollback 폐기). */
  async function _deleteImageStorage(path) {
    /* prefix 검증: 우리 이미지 버킷(`images/`)만, traversal 금지. downloadURL 역추정 안 함. */
    if (typeof path !== 'string' || !path || path.indexOf('..') !== -1 || !/^images\//.test(path)) {
      if (path) console.warn('[S2-2A] 허용되지 않은 삭제 경로 무시', path);
      return false;
    }
    const app = _getViewerFirebaseApp();
    if (!app || typeof app.storage !== 'function') return false;
    try { await app.storage().ref(path).delete(); return true; }
    catch (e) { console.warn('[S2-2A] 패배 storage 삭제 실패(orphan)', e && e.message); return false; }
  }

  /* ★ 저장 *전* sourceMode 사전 게이트(클라 read). 반대 모드/corrupt면 업로드 전 차단.
     read 실패 → hold(fail-open 금지, 원본 보호). 사전 게이트는 최종 결정자 아님 — 서버 lock이 권위.
     반환 { allow:bool, code?, currentSourceMode? }. (corrupt는 클라 sanitize로 absent처럼 보일 수 있어 서버에서 최종 차단) */
  async function _preCheckSourceMode(mode, sceneId) {
    if (mode !== 'upload' && mode !== 'draw') return { allow: false, code: 'INVALID_SOURCE_MODE' };
    const app = _getViewerFirebaseApp();
    const base = _imagePolicyBasePath();
    if (!app || !app.database || !base) return { allow: false, code: 'POLICY_READ_FAILED', retryable: true };
    let raw;
    try { raw = (await app.database().ref(base + '/viewer-meta/imagePolicy').once('value')).val(); }
    catch (e) { return { allow: false, code: 'POLICY_READ_FAILED', retryable: true }; }   /* hold — 원본 보호 */
    const sm = raw && raw.sourceMode;
    if (sm === 'upload' || sm === 'draw') {
      if (sm !== mode) {
        /* SOURCE-MODE-RELOCK(2026-07-14): 반대 모드지만 작품에 원본 이미지가 0장이면 허용 —
           '모두 삭제 후 방식 바꾸기'. 서버 lock이 낡은 잠금을 새 모드로 재잠금. 이미지가 남아
           있으면 종전대로 conflict(진짜 섞기 차단). 로컬 scenes 기준(사전 게이트=advisory). */
        var _scenes = (typeof ViewerState !== 'undefined' && ViewerState && ViewerState.scenes)
          ? ViewerState.scenes : null;
        var _hasImage = !!_scenes && Object.keys(_scenes).some(function (k) {
          var s = _scenes[k];
          return s && ((typeof s.imageData === 'string' && s.imageData) ||
                       (typeof s.imageUrl === 'string' && s.imageUrl));
        });
        if (!_hasImage) return { allow: true };
        return { allow: false, code: 'SOURCE_MODE_CONFLICT', currentSourceMode: sm };
      }
      return { allow: true, currentSourceMode: sm };
    }
    return { allow: true };   /* absent / (corrupt → 서버 lock에서 차단) */
  }

  /* SOURCE-MODE-SWITCH(2026-07-16): 학생 자가 "그림 다 지우고 방식 바꾸기" — 서버 콜러블 호출.
     모든 장면(표지·전 갈래) 원본 이미지 + AI 이미지 변형 + 잠금 정책을 서버가 원자적으로 비움.
     성공 시 로컬 imagePolicy 캐시 무효화(다음 precheck가 absent를 새로 읽게). scenes 로컬 정리는 호출부(viewer-edit). */
  async function _clearImagesAndSwitchSourceMode() {
    const { classId, teamName } = _getCurrentClassIdTeamName();
    if (!classId || !teamName) return { ok: false, reason: 'no-context' };
    let data;
    try {
      data = await _callPhaseAFunction('clearImagesAndSwitchSourceMode', { classId: classId, teamName: teamName });
    } catch (e) {
      return { ok: false, reason: 'call-failed', error: e && (e.code || e.message) };
    }
    if (data && data.ok) {
      try { await _loadImagePolicy(true); } catch (e) { /* 캐시 갱신 실패 무해 */ }
      return { ok: true, cleared: data.cleared || 0 };
    }
    return { ok: false, reason: (data && data.code) || 'unknown' };
  }

  /* ★ 업로드된 고유 객체에 대해 서버 lock 확정. ok면 호출부가 scene.imageData 기록.
     실패/충돌/corrupt/lock호출실패 → *이번 고유 객체만* 삭제(scene 무변경 → 승자/기존 무손상).
     반환 { ok, sourceMode?, idempotent? } | { ok:false, code, currentSourceMode?, retryable?, storageDeleted? }. */
  async function _commitImageSourceMode(mode, sceneId, storagePath) {
    const { classId, teamName } = _getCurrentClassIdTeamName();
    if (!classId || !teamName) { const d = await _deleteImageStorage(storagePath); return { ok: false, code: 'no-context', retryable: true, storageDeleted: d }; }
    if (mode !== 'upload' && mode !== 'draw') { const d = await _deleteImageStorage(storagePath); return { ok: false, code: 'INVALID_SOURCE_MODE', storageDeleted: d }; }
    let data;
    try {
      data = await _callPhaseAFunction('lockImageSourceMode', {
        classId: classId, teamName: teamName, sceneId: (sceneId != null ? sceneId : null), sourceMode: mode,
      });
    } catch (e) {
      console.warn('[S2-2A] lock 호출 실패(고유 객체 정리, scene 무변경)', e && (e.code || e.message));
      const d = await _deleteImageStorage(storagePath);
      return { ok: false, code: 'LOCK_CALL_FAILED', retryable: true, storageDeleted: d };
    }
    if (data && data.ok) { await _loadImagePolicy(true); return { ok: true, sourceMode: mode, idempotent: !!data.idempotent }; }
    /* 실패: scene 미기록 → 이번 고유 객체만 삭제. */
    const d = await _deleteImageStorage(storagePath);
    await _loadImagePolicy(true);
    return { ok: false, code: (data && data.code) || 'lock-failed', currentSourceMode: data && data.currentSourceMode, storageDeleted: d };
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
     Phase 4-D-2A: variant style(textStyle) 편집 저장 기반
     ──────────────────────────────────────────────────────────────
     · 편집 대상 = variant textStyle(fontFamily/fontSize/color/weight). 원본 scene.textStyle 절대 미변경.
     · 낙관적 버퍼: FB 메모리 캐시 + localStorage 백업 갱신 → 재렌더해도 유지.
     · 저장 = saveTextVariant(mode:'patchStyle') — body/layout/메타 보존, style.textStyle만 갱신.
     · body 큐(_variantSave)·layout 큐(_variantLayoutSave)와 완전히 분리된 별도 큐.
     · ⚠️ 이번 단계(P4-D-2A)는 저장/표시 기반만 — 스타일 패널 UI unlock은 P4-D-2B로 분리.
       _aiVariantStyleEditAllowed/_queueVariantStyleSave는 노출만 하고 viewer-edit에서 아직 호출하지 않음.
     ════════════════════════════════════════════════════════════════ */

  /* 낙관적 버퍼 — FB style 캐시 + localStorage final.style 백업만 갱신. scene.textStyle 미수정. */
  function _setVariantStyleBuffer(variantKey, sceneId, textStyle) {
    const sid = String(sceneId);
    if (!_fbTextVariantStyles) _fbTextVariantStyles = { s1: {}, s2: {} };
    if (!_fbTextVariantStyles[variantKey]) _fbTextVariantStyles[variantKey] = {};
    _fbTextVariantStyles[variantKey][sid] = { textStyle: Object.assign({}, textStyle) };
    try {
      const v = _loadAiVariants();
      const tk = (variantKey === 's2') ? 'textS2' : 'textS1';
      if (!v[tk]) v[tk] = { status: 'finalized', final: {} };
      if (!v[tk].final) v[tk].final = {};
      const prev = v[tk].final[sid] || {};
      const prevStyle = prev.style || {};
      v[tk].final[sid] = Object.assign({}, prev, { style: Object.assign({}, prevStyle, { textStyle: Object.assign({}, textStyle) }) });
      _saveAiVariants(v);
    } catch (e) { /* noop */ }
  }

  /* patchStyle 저장 — 별도 경로. 원본 textStyle 저장(saveSceneText/_queueSave) 절대 재사용 X. */
  async function _saveVariantStylePatch(variantKey, scenesStyleMap) {
    if (variantKey !== 's1' && variantKey !== 's2') return { ok: false, reason: 'bad-variant' };
    const { classId, teamName } = _getCurrentClassIdTeamName();
    if (!classId || !teamName) return { ok: false, reason: 'no-context' };
    const scenes = {};
    Object.keys(scenesStyleMap || {}).forEach(function (sid) {
      const ts = scenesStyleMap[sid] && scenesStyleMap[sid].textStyle;
      if (ts && typeof ts === 'object') scenes[sid] = { style: { textStyle: ts } };
    });
    if (Object.keys(scenes).length === 0) return { ok: false, reason: 'empty' };
    const branchLineage = (typeof ViewerState !== 'undefined' && ViewerState.branchLineage) || {};
    const payload = {
      classId, teamName, workId: teamName,
      rootBranchId: branchLineage.rootBranchId || null,
      copyDepth: branchLineage.copyDepth || 0,
      variant: variantKey,
      mode: 'patchStyle',
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

  /* style 저장 큐 — body/layout 큐와 분리. pending[variantKey:sceneId] = {variantKey,sceneId,textStyle}. */
  const _variantStyleSave = { pending: {}, timer: null, saving: false };

  function _queueVariantStyleSave(variantKey, sceneId, textStyle) {
    if (variantKey !== 's1' && variantKey !== 's2') return;
    if (!textStyle || typeof textStyle !== 'object') return;
    const sid = String(sceneId);
    _setVariantStyleBuffer(variantKey, sid, textStyle);
    _variantStyleSave.pending[variantKey + ':' + sid] = { variantKey: variantKey, sceneId: sid, textStyle: Object.assign({}, textStyle) };
    _showVariantSaveStatus('AI 버전의 글자 스타일을 조정 중입니다. 원본 스타일은 바뀌지 않습니다.', 0);
    if (_variantStyleSave.timer) clearTimeout(_variantStyleSave.timer);
    _variantStyleSave.timer = setTimeout(function () { _flushVariantStyleSave(); }, 700);
  }

  async function _flushVariantStyleSave() {
    if (_variantStyleSave.timer) { clearTimeout(_variantStyleSave.timer); _variantStyleSave.timer = null; }
    if (_variantStyleSave.saving) return;
    const keys = Object.keys(_variantStyleSave.pending);
    if (keys.length === 0) return;

    const byVariant = { s1: {}, s2: {} };
    keys.forEach(function (k) {
      const p = _variantStyleSave.pending[k];
      byVariant[p.variantKey][p.sceneId] = { textStyle: p.textStyle };
    });
    const snapshot = _variantStyleSave.pending;
    _variantStyleSave.pending = {};
    _variantStyleSave.saving = true;
    _showVariantSaveStatus('저장 중…', 0);

    let anyFail = false;
    for (const vk of ['s1', 's2']) {
      if (Object.keys(byVariant[vk]).length === 0) continue;
      const res = await _saveVariantStylePatch(vk, byVariant[vk]);   /* eslint-disable-line no-await-in-loop */
      if (!res || !res.ok) anyFail = true;
    }
    _variantStyleSave.saving = false;

    if (anyFail) {
      Object.keys(snapshot).forEach(function (k) {
        if (!_variantStyleSave.pending[k]) _variantStyleSave.pending[k] = snapshot[k];
      });
      _showVariantSaveStatus('글자 스타일 저장 실패 — 다시 시도해 주세요.', 4000);
    } else {
      try { await _loadFirebaseTextVariants(true); } catch (e) { /* noop */ }
      _showVariantSaveStatus('저장됨', 1500);
    }
    if (Object.keys(_variantStyleSave.pending).length > 0) _flushVariantStyleSave();
  }

  /* Phase 4-D-2A: 현재 이 장면 textStyle을 variant 편집할 수 있으면 variantKey 반환, 아니면 null.
     조건은 body/layout 편집과 동일(editMode + text/picturebook + aiS1/aiS2 보기 + 그 variant 후보 존재). */
  function _aiVariantStyleEditAllowed(sceneId) {
    return _aiVariantBodyEditAllowed(sceneId);
  }

  /* P4-D-2B-FIX: 글자 크기(fontSize)만 variant 편집 허용 — 후보 유무와 무관.
     조건: editMode + text/picturebook + aiS1/aiS2 보기. _variantHasCandidate 요구 안 함.
     → 후보 없는 장면도 fontSize stub 저장(style-only, body 미생성) 가능.
     fontFamily/color/weight는 이 게이트와 무관하게 _applyVariantStyleOrBlock에서 차단됨. */
  function _aiVariantFontSizeEditAllowed(sceneId) {
    if (!(typeof ViewerState !== 'undefined' && ViewerState.editMode)) return null;
    if (!_aiToggleProjectTypeAllowed()) return null;
    const mode = _getAiViewMode();
    if (mode !== 'aiS1' && mode !== 'aiS2') return null;
    return (mode === 'aiS2') ? 's2' : 's1';
  }

  /* ════════════════════════════════════════════════════════════════
     v140-step3: 편집 중 모달 (drafting)
     ──────────────────────────────────────────────────────────────
     사용자 결정 #C — 마감 후 aiDrafts.textS1 기본 정리. TEST MODE에서 보존/초기화 선택 가능.
     ════════════════════════════════════════════════════════════════ */
  function _enterDraftingMode(attemptN) {
    /* status를 drafting으로 변경 (selectedAttempt도 함께 저장) */
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
      /* AI-STAB-2: 편집 상태가 깨졌으면 drafting을 풀어 후보 화면으로 복귀(트랩 방지). */
      if (d.textS1 && d.textS1.status === 'drafting') _cancelDrafting();
      alert('편집 중인 상태가 없어요. 후보 화면으로 돌아갈게요.');
      return;
    }
    const attemptN = d.textS1.selectedAttempt;
    const cand = d.textS1.candidates && d.textS1.candidates['attempt' + attemptN];
    if (!cand) {
      /* AI-STAB-2: 선택 후보가 사라졌으면 drafting을 풀어 갇히지 않게 함. */
      _cancelDrafting();
      alert('선택된 후보가 없어요. 후보 화면으로 돌아갈게요.');
      return;
    }

    const snapshot = _buildWorkSnapshot();
    const edited = d.textS1.editedDraftByScene || {};

    /* fix 2026-05-21: snapshot은 {sceneId: scene} 객체. Object.values 사용. */
    const rows = Object.values(snapshot || {}).map(function (s) {
      const r = cand.results[s.id];   /* Functions가 sceneId 정규화 처리 */
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

    /* v140 fix 2026-05-21: lock: true 적용 — 편집 중 textarea 내용 보호 — overlay/ESC로 닫히지 않음 (사용자 명령) */
    const root = _createModalRoot('ai-draft-modal-root', inner, { lock: true, size: 'large' });

    /* textarea 입력을 그때그때 저장 (debounce 없음 — 단순 onblur·oninput 사용) */
    root.querySelectorAll('.js-ai-draft-textarea').forEach(function (ta) {
      ta.addEventListener('input', function () {
        const sid = ta.getAttribute('data-scene-id');
        _saveDraftEdit(sid, ta.value);
      });
    });

    root.querySelector('.js-ai-draft-close').addEventListener('click', function () {
      _removeModalRoot('ai-draft-modal-root');
    });

    root.querySelector('.js-ai-draft-cancel').addEventListener('click', async function () {
      if (typeof window !== 'undefined' && typeof window.showViewerConfirm === 'function') {
        const ok = await window.showViewerConfirm({
          title: 'AI 제안 편집을 취소할까요?',
          message: '저장하지 않은 편집 내용은 사라져요.',
          confirmText: '취소하기',
          cancelText: '계속 편집',
          danger: true,
        });
        if (!ok) return;
      } else if (!confirm('편집한 내용이 저장되지 않아요. 취소할까요?')) {
        return;
      }
      _cancelDrafting();
      _removeModalRoot('ai-draft-modal-root');
    });

    root.querySelector('.js-ai-draft-finalize').addEventListener('click', function () {
      _finalizeAiVariant();
      _removeModalRoot('ai-draft-modal-root');
      showAiToast('AI 1단계를 저장했어요. 상단 토글로 전환할 수 있어요.');
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
    /* selectedAttempt 비움, edited 버퍼 비움, status candidate_ready로 */
    d.textS1.selectedAttempt = null;
    d.textS1.editedDraftByScene = {};
    d.textS1.status = (_getCandidateCount() > 0) ? 'candidate_ready' : 'none';
    _saveAiDrafts(d);
  }

  /* ════════════════════════════════════════════════════════════════
     v140-step4: AI 보기 토글 (사용자 결정 #D)
     ──────────────────────────────────────────────────────────────
     별도 토글 바 사용. maker-return-bar는 건드리지 않음.
     viewer-render.js의 본문 렌더 6곳은 _getDisplayBody를 거치게 할 것.
     ════════════════════════════════════════════════════════════════ */
  /* WRITE-AFTER-UI-REBUILD-1: 텍스트 1단계(aiS1) 보기 폐기 — 신규 쓰기 후 흐름에서 숨김.
     저장된 view mode가 'aiS1'이어도 원본으로 정규화(보기만 차단·서버/데이터/구작품 s1은 보존).
     남은 글 보기 = 원본 | AI 장면발전(aiS2). */
  function _normalizeTextAiViewMode(mode) {
    return (mode === 'aiS2') ? 'aiS2' : 'original';
  }

  function _getAiViewMode() {
    /* v140 fix 2026-05-21: 팀별 namespace 키 사용. 2026-06: aiS2 추가. UI-REBUILD-1: aiS1 정규화. */
    try {
      const v = localStorage.getItem(_getMockViewModeKey());
      return _normalizeTextAiViewMode(v);
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

      /* P4-D-2B-FIX: 패널 전체를 opacity로 흐리지 않는다.
         opacity는 조상→자손으로 곱해져, 부모(panel)가 0.5면 자식 슬라이더를 1로 올려도
         실효 0.5라 "글자 크기만 밝게" 표현이 불가능했음(P4-D-2B UX 문제의 근본 원인).
         대신: panel은 pointerEvents:none으로만 잠그고(원본 변형 차단 유지),
         흐림은 잠긴 컨트롤마다 개별 적용. 글자 크기 슬라이더·상단 장면 이동은 밝게+활성. */

      /* ── 0) 매 호출 리셋 (모드 토글 시 같은 DOM 재사용 → stale inline style 제거) ── */
      panel.style.pointerEvents = '';
      panel.style.opacity = '';
      Array.prototype.forEach.call(panel.children, function (c) {
        c.style.opacity = ''; c.style.pointerEvents = '';
      });
      const RESET_SEL = '.edit-nav, .edit-text-style-section, .edit-pb-inline-style,'
        + ' .edit-text-theme-section, .edit-text-effect-section, .js-apply-style-all,'
        + ' .edit-row, .js-text-style-toggle, .js-pb-inline-style-toggle';
      panel.querySelectorAll(RESET_SEL).forEach(function (el) {
        el.style.opacity = ''; el.style.pointerEvents = '';
      });

      const locked = _isAiVariantViewMode();
      if (!locked) return;   /* 원본 보기 → 전부 활성(리셋만으로 끝) */

      /* ── 1) 기본: 컨트롤 영역(.edit-panel-inner)만 pointerEvents 차단(원본 컨트롤 변형 원천 차단).
         ⚠ #edit-panel(=overflow-y:auto 스크롤 컨테이너)에는 걸지 않는다. 컨테이너에 걸면
         AI 문장점검/장면발전 보기에서 패널이 길어질 때 휠/터치가 컨테이너에 닿지 못해
         세로 스크롤이 통째로 막힌다(URGENT-UI-FIX-AI-SIDEPANEL). 모든 컨트롤은 inner 안에
         있으므로 잠금 효과는 동일(자식 재활성도 inner의 none 상속/auto 오버라이드로 그대로 동작).
         실 저장 차단 안전망은 핸들러 가드(_isVariantViewLocked 등)라 보안에도 영향 없음. */
      const lockTarget = panel.querySelector('.edit-panel-inner') || panel;
      lockTarget.style.pointerEvents = 'none';

      /* 조상 체인의 opacity를 1로 되돌림(panel 직전까지). 슬라이더/네비를 밝게 보이려면
         그 조상이 흐려져 있으면 안 됨(opacity 곱셈 회피). */
      function brightenChain(el) {
        let n = el;
        while (n && n !== panel) { n.style.opacity = '1'; n = n.parentElement; }
      }

      /* ── 2) 모든 직계 자식을 흐림(제목/선택지/구조/테마/효과 등 잠긴 영역) ── */
      Array.prototype.forEach.call(panel.children, function (c) { c.style.opacity = '0.5'; });

      /* ── 3) 상단 장면 이동(.edit-nav)은 밝게+활성 (탐색이며 원본 textStyle write 없음) ── */
      panel.querySelectorAll('.edit-nav').forEach(function (nav) {
        brightenChain(nav);
        nav.style.pointerEvents = 'auto';
        nav.style.opacity = '1';
      });

      /* ── 4) 글자 크기 슬라이더만 밝게+활성. 폰트/색/굵기 행은 흐림+잠금 유지 ── */
      let allowFontSize = false;
      try {
        const VS = (typeof ViewerState !== 'undefined')
          ? ViewerState
          : (typeof window !== 'undefined' ? window.ViewerState : null);
        const sid = VS ? VS.currentSceneId : null;
        if (sid != null && _aiVariantFontSizeEditAllowed(sid)) allowFontSize = true;
      } catch (e) { allowFontSize = false; }

      [['.edit-text-style-section', '.js-text-style-toggle', '.js-edit-text-size'],
       ['.edit-pb-inline-style', '.js-pb-inline-style-toggle', '.js-edit-pb-size']]
        .forEach(function (trio) {
          const sec = panel.querySelector(trio[0]);
          if (!sec) return;
          if (allowFontSize) {
            /* 접기/펼치기 헤더는 항상 활성 — 섹션이 접혀 슬라이더가 없을 때도
               펼쳐서 슬라이더에 닿을 수 있어야 함. (헤더 자체는 원본 textStyle write 없음) */
            const toggle = sec.querySelector(trio[1]);
            if (toggle) { brightenChain(toggle); toggle.style.pointerEvents = 'auto'; toggle.style.opacity = '1'; }
            /* 슬라이더가 렌더돼 있으면(펼침) 그 행을 밝게+활성 */
            const slider = sec.querySelector(trio[2]);
            if (slider) {
              const row = slider.closest('.edit-row') || slider;
              brightenChain(row);
              row.style.pointerEvents = 'auto';
              row.style.opacity = '1';
            }
          }
          /* 같은 섹션 안 폰트/색/굵기 행 흐림(체인 밝히기로 1이 됐을 수 있어 다시 0.5).
             pointerEvents는 명시하지 않음 → inner의 none 상속으로 잠김 유지. */
          sec.querySelectorAll('.edit-font-select, .edit-color-row, .edit-color-picker,'
            + ' .js-edit-text-font, .js-edit-pb-font, .js-edit-text-color-pick, .js-edit-pb-color-pick,'
            + ' .js-edit-text-weight, .js-edit-pb-weight').forEach(function (ctrl) {
            const r = ctrl.closest('.edit-row');
            if (r) r.style.opacity = '0.5';
          });
          /* 섹션 안 '전체 적용'(그림책)도 흐림+명시 잠금 */
          sec.querySelectorAll('.js-apply-style-all').forEach(function (btn) {
            btn.style.opacity = '0.5'; btn.style.pointerEvents = 'none';
          });
        });

      /* ── 5) 테마/효과 섹션·전체적용은 계속 흐림+잠금(체인으로 밝아졌을 수 있어 재차 0.5) ── */
      panel.querySelectorAll('.edit-text-theme-section, .edit-text-effect-section,'
        + ' .js-apply-style-all').forEach(function (el) {
        el.style.opacity = '0.5'; el.style.pointerEvents = 'none';
      });
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

  /* VIEWER-TOGGLE-LIVE-REFRESH-FIX(2026-07-02): 현재 장면 재렌더 요청.
     편집 세션 = viewer-edit의 _scheduleViewerFrameReRender(디바운스·편집 상태 보존) 그대로.
     감상 세션(viewer-ai 단독 로드·FIELD-FIX-B) = 그 함수가 없어 토글이 상태만 바꾸고
     현재 장면엔 다음 이동 때에야 반영되던 문제 → viewer-render 전역 renderCurrentScene 직접 호출.
     같은 currentSceneId를 다시 그릴 뿐 — 장면 이동/기록/선택 진행 상태 변화 0·데이터 write 0. */
  function _requestViewerFrameRerender() {
    try {
      if (typeof window !== 'undefined' && typeof window._scheduleViewerFrameReRender === 'function') {
        window._scheduleViewerFrameReRender();
        return;
      }
    } catch (e) { /* noop */ }
    try {
      if (typeof _scheduleViewerFrameReRender === 'function') { _scheduleViewerFrameReRender(); return; }
    } catch (e) { /* noop */ }
    try {
      if (typeof renderCurrentScene === 'function') renderCurrentScene();
      else if (typeof window !== 'undefined' && typeof window.renderCurrentScene === 'function') window.renderCurrentScene();
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
    /* Phase 4-D-2A: variant style(글자 스타일) 편집 pending도 전환 전에 flush. */
    try { _flushVariantStyleSave(); } catch (e) { /* noop */ }
    try {
      if (mode === 'aiS1' || mode === 'aiS2') localStorage.setItem(_getMockViewModeKey(), mode);
      else localStorage.removeItem(_getMockViewModeKey());
    } catch (e) { /* noop */ }
    _updateAiToggleBar();
    _applyVariantEditPanelLock();
    /* VIEWER-TOGGLE-LIVE-REFRESH-FIX: 편집=스케줄러/감상=renderCurrentScene fallback — 즉시 반영 */
    _requestViewerFrameRerender();
    /* P4-D-2B-FIX4: 패널은 재렌더되지 않으므로(슬라이더 DOM 값이 직전 모드에 머묾) 글자 크기
       슬라이더 value/라벨 + 본문 CSS 변수를 새 보기 모드의 표시 style로 다시 동기화한다.
       원본 scene.textStyle은 건드리지 않는다(viewer-edit.js 전역 함수). */
    try {
      if (typeof window !== 'undefined' && typeof window._resyncFontSizeUiToViewMode === 'function') {
        window._resyncFontSizeUiToViewMode();
      }
    } catch (e) { /* noop */ }
    /* Phase 4-B 보강: rAF가 정지되는 숨김 탭에서만 보조 재렌더(비동기 → 재진입 안전).
       정상 탭은 위 rAF 경로가 ~16ms 내 처리하므로 이 보조는 건너뛴다(중복 렌더 방지). */
    try {
      if (typeof document !== 'undefined' && document.hidden) {
        setTimeout(_forceCurrentSceneReRender, 0);
      }
    } catch (e) { /* noop */ }
  }

  /* viewer-render.js가 호출하는 표시 본문 결정 함수 — 토글 mode에 따라 원본/AI 변형을 반환 */
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
    /* UI-REBUILD-1: 글 보기 = 원본 | AI 장면발전(s2)만. 텍스트 1단계(s1) 토글 폐기.
       s2 후보 없으면 바 미표시(s1만 있는 구작품도 바 숨김 → 본문은 원본 표시). */
    const hasS2 = _isS2Finalized();
    /* CONTEST-FIX-1(2026-07-10): 학급 AI가 원천 꺼졌거나 교사가 s2를 안 켠 반에서 만들어둔 s2도
       없으면 — 영영 켤 수 없는 disabled 토글('먼저 만들면 켜져요')을 노출하지 않음.
       기존 s2가 있으면 보기 전용으로 유지(AI 호출 없음·안전). */
    if (!hasS2 && (isClassAiHardOff() || !_isModeAllowedByTeacher('s2'))) { _hideAiToggleBar(); return; }
    /* AI-TOGGLE-ALWAYS-1(2026-07-08): variant 유무와 무관하게 토글을 항상 배치(레이아웃 일관·
       '생겼다 없어졌다' 방지, 사용자 요구). s2 없으면 아래 'AI 장면발전' 버튼을 disabled로 →
       원본만 활성, AI를 돌린 뒤 켜짐. */
    /* Phase 4-A: 감상자/편집자 공통 표시. 감상자는 editMode=false라 보기 전용으로 안전. */

    /* 현재 보기 mode가 더 이상 유효하지 않으면 원본으로 정리 (setMode가 재렌더+업데이트).
       _getAiViewMode가 aiS1을 이미 original로 정규화하므로 s2 유효성만 확인. */
    const cur = _getAiViewMode();
    if (cur === 'aiS2' && !hasS2) {
      _setAiViewMode('original');
    }

    _hideAiToggleBar();
    const bar = document.createElement('div');
    bar.id = 'ai-view-toggle-bar';
    bar.className = 'ai-view-toggle-bar';
    let html = '<span class="ai-view-toggle-bar__label">글 보기:</span>'
      + '<button type="button" class="ai-view-toggle-btn js-ai-view-original" data-mode="original">원본</button>'
      + '<button type="button" class="ai-view-toggle-btn js-ai-view-ais2" data-mode="aiS2"'
      + (hasS2 ? '' : ' disabled aria-disabled="true" title="‘AI 장면발전’을 먼저 만들면 켜져요"')
      + '>AI 장면발전</button>';
    /* TEXT-S2-PUBLISH-CHOICE-REMOVAL-1: '감상 글 정하기'(발행 선택) 진입 버튼 제거 —
       AI 장면발전은 확정본이 아니라 비교 후보. 감상/다듬기 모두 이 토글로만 원본/AI를 오가며 본다. */
    bar.innerHTML = html;
    /* AI-TOGGLE-FLOW-1: 과거 position:fixed 부유(top center)라 해상도에 따라 maker-return-bar
       버튼/✕ 위로 겹쳤음 → 문서 흐름의 #ai-view-toggle-slot에 넣어 오버랩 원천 차단 +
       그림 토글과 한 줄로 병합. 슬롯 없으면 body 폴백(방어). has-ai-view-toggle 예약(40px)은
       흐름 배치라 더 이상 불필요 → 미부여. */
    (document.getElementById('ai-view-toggle-slot') || document.body).appendChild(bar);
    bar.querySelectorAll('.ai-view-toggle-btn[data-mode]').forEach(function (btn) {
      if (btn.disabled) return;   /* AI-TOGGLE-ALWAYS-1: s2 없는 AI 버튼은 클릭 무시 */
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
    /* TOP-HUD-AI-LAYOUT-1B: 바 제거 시 상태 class도 해제 → HUD 상단 예약 공간 회수.
       _hideAiToggleBar는 모든 숨김/early-return 경로의 단일 정리 지점이라 누락 없음. */
    document.body.classList.remove('has-ai-view-toggle');
  }

  /* TEXT-S2-PUBLISH-CHOICE-REMOVAL-1: '감상에 보여줄 글' 발행 선택 모달(_showTextS2SelectionModal/
     _applyTextSelection)과 callApplyTextS2Selection 클라 호출 제거 — 감상본 확정 저장 제도 폐기.
     원본/AI 비교는 위 '글 보기' 토글(_getDisplayBody)만 사용. 서버 callable·레거시 textSelections
     데이터는 dormant로 유지(삭제/deploy 없음). 배경: docs/text_s2_publish_choice_removal_audit_20260702.md */

  /* ════════════════════════════════════════════════════════════════
     P5-IMAGE-VARIANT-1: 이미지 보기 토글 바 (텍스트 토글과 독립)
     ──────────────────────────────────────────────────────────────
     · 별도 바(#ai-image-view-toggle-bar). 텍스트 바 아래로 inline top 오프셋.
     · text/picturebook 작품에서만. 이미지 후보가 1개 이상 있을 때만 노출.
       (생성이 아직 없으므로 현재 환경에선 후보 0 → 바가 뜨지 않음 = 기존 화면 변화 없음.)
     · 후보 없는 variant 버튼은 "후보 없음"으로 disabled. 생성 버튼 없음.
     ════════════════════════════════════════════════════════════════ */
  function _setAiImageViewMode(mode) {
    try {
      /* ★ '원본'도 명시값으로 저장(키 제거 X) — _getDisplayImageSrc가 null(기본=발행선택)과 'original'(명시 원본)을
         구분해, 교사가 원본 버튼을 누르면 발행 s2를 무시하고 진짜 원본을 보여준다(원본 버튼이 원본을 보장). */
      if (mode === 'aiS1' || mode === 'aiS2') localStorage.setItem(_getMockImageViewModeKey(), mode);
      else localStorage.setItem(_getMockImageViewModeKey(), 'original');
    } catch (e) { /* noop */ }
    _updateAiImageToggleBar();
    /* 본문 프레임 재렌더 → _getDisplayImageSrc가 새 모드 반영. 원본 필드는 불변.
       VIEWER-TOGGLE-LIVE-REFRESH-FIX: 감상 세션도 즉시 반영(fallback=renderCurrentScene). */
    _requestViewerFrameRerender();
    /* P5-IMAGE-LOCK-1: 이미지 보기 모드 전환 시 편집 패널의 원본 이미지 편집 잠금 즉시 동기화
       (편집 패널은 재렌더되지 않으므로 명시 호출). viewer-edit.js 전역 함수. */
    try {
      if (typeof window !== 'undefined' && typeof window._applyAiImageVariantEditLock === 'function') {
        window._applyAiImageVariantEditLock();
      }
    } catch (e) { /* noop */ }
  }

  function _showAiImageToggleBar() {
    if (!_aiToggleProjectTypeAllowed()) { _hideAiImageToggleBar(); return; }
    /* imageS1(AI 그림 정돈)은 폐기 — 'AI 그림책 마감'(s2)만. */
    const hasS2 = _hasImageVariantS2();
    /* CONTEST-FIX-1: 텍스트 토글과 동일 — 영영 켤 수 없는 disabled 토글 비노출. */
    if (!hasS2 && (isClassAiHardOff() || !_isModeAllowedByTeacher('imageS2'))) { _hideAiImageToggleBar(); return; }
    /* AI-TOGGLE-ALWAYS-1(2026-07-08): 그림책 작품이면 그림 토글 항상 배치(레이아웃 일관) — s2 없으면
       아래 'AI 그림책 마감' 버튼 disabled. 그림 없는 작품(텍스트 등)엔 그림 토글 미표시.
       단 레거시라도 이미지 s2 후보가 있으면(=사실상 그림책) 표시. */
    const isPb = !!(ViewerState && ViewerState.project && ViewerState.project.projectType === 'picturebook');
    if (!isPb && !hasS2) { _hideAiImageToggleBar(); return; }

    /* 현재 이미지 보기 모드가 더 이상 유효하지 않으면(aiS1 폐기/ s2 없음) 원본으로 정리 */
    const cur = _getAiImageViewMode();
    if (cur === 'aiS1' || (cur === 'aiS2' && !hasS2)) {
      _setAiImageViewMode('original');
    }

    _hideAiImageToggleBar();
    const bar = document.createElement('div');
    bar.id = 'ai-image-view-toggle-bar';
    /* 텍스트 토글 바와 동일 스타일 재사용 + 아래로 stack(inline top — CSS 미수정). */
    bar.className = 'ai-view-toggle-bar ai-view-toggle-bar--image';
    let html = '<span class="ai-view-toggle-bar__label">그림 보기:</span>'
      + '<button type="button" class="ai-view-toggle-btn js-ai-image-view-original" data-mode="original">원본</button>'
      + '<button type="button" class="ai-view-toggle-btn js-ai-image-view-ais2" data-mode="aiS2"'
      + (hasS2 ? '' : ' disabled aria-disabled="true" title="‘AI 그림책 마감’을 먼저 만들면 켜져요"')
      + '>AI 그림책 마감</button>';
    bar.innerHTML = html;
    /* AI-TOGGLE-FLOW-1: 텍스트 토글과 같은 흐름 슬롯에 배치(CSS order로 우측). inline top:48px 부유 제거. */
    (document.getElementById('ai-view-toggle-slot') || document.body).appendChild(bar);
    bar.querySelectorAll('.ai-view-toggle-btn').forEach(function (btn) {
      if (btn.disabled) return;
      btn.addEventListener('click', function () {
        _setAiImageViewMode(btn.getAttribute('data-mode'));
      });
    });
    _updateAiImageToggleBar();
  }

  function _updateAiImageToggleBar() {
    const bar = document.getElementById('ai-image-view-toggle-bar');
    if (!bar) return;
    const mode = _getAiImageViewMode();
    bar.querySelectorAll('.ai-view-toggle-btn').forEach(function (btn) {
      btn.classList.toggle('is-active', !btn.disabled && btn.getAttribute('data-mode') === mode);
    });
  }

  function _hideAiImageToggleBar() {
    const bar = document.getElementById('ai-image-view-toggle-bar');
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
  }

  /* ════════════════════════════════════════════════════════════════
     P5-IMAGE-CLIENT-1: 이미지 AI 진입(AI 그림 정돈) — server skeleton 연결
     ──────────────────────────────────────────────────────────────
     · 후보 보기 토글(#ai-image-view-toggle-bar)과 역할 분리된 "요청" 버튼.
     · 실제 이미지 생성/Storage 업로드/variant 저장 없음. callImageAiS1 skeleton만 호출.
     · 응답이 notImplemented여도 성공 아님 — 안내만. variant cache·토글 상태 절대 안 바꿈.
     · 노출 게이트: projectType(text/picturebook) + 교사 imageS1 권한 true.
       (adminConsole에서 imageS1=soon이면 교사가 못 켜므로 운영에선 버튼이 안 보이는 게 정상.)
     ════════════════════════════════════════════════════════════════ */
  const IMAGE_AI_NOTICE = {
    IMAGE_POLICY_REQUIRED: '그림 기준을 먼저 선택해 주세요.',
    IMAGE_SOURCE_MISSING: '먼저 이 장면에 그림을 넣어 주세요.',
    SCENE_NOT_FOUND: '장면 정보를 찾지 못했어요. 새로고침 후 다시 시도해 주세요.',
    IMAGE_AI_NOT_IMPLEMENTED: '이미지 AI 서버 연결은 준비되었습니다.\n실제 그림 정돈 기능은 아직 열지 않았어요.\n원본 그림은 그대로 유지됩니다.',
    /* IMAGE-S2-PEOPLE(2026-07-09): 사람(얼굴) 사진은 AI가 변환하기 어려워 거부됨. 사물·배경 사진이나 그림은 됨. 원본은 유지. */
    IMAGE_AI_UNSAFE_OUTPUT: '사람(얼굴)이 담긴 사진은 변환이 어려워요.\n사물·배경 사진이나 직접 그린 그림은 괜찮아요.\n원본 그림은 그대로 유지됩니다.',
    IMAGE_AI_PROVIDER_ERROR: 'AI 서버가 잠시 응답하지 않았어요. 잠시 후 다시 시도해 주세요.\n원본 그림은 그대로 유지됩니다.',
    IMAGE_AI_TIMEOUT: '변환 시간이 초과됐어요. 다시 시도해 주세요.\n원본 그림은 그대로 유지됩니다.',
  };
  let _imageAiS1Busy = false;

  /* ERR-KO-1(2026-07-10): 실패 원인 → 쉬운 한글 안내.
     e.code/e.message의 영어 기술 문구(permission-denied, internal, functions/... 등)가
     학생 화면 alert/모달에 그대로 뜨던 문제. 우리 서버가 보낸 한글 메시지는 그대로 존중. */
  function _friendlyAiError(e) {
    const koMsg = (e && e.message && /[가-힣]/.test(e.message)) ? e.message : null;
    if (koMsg) return koMsg;
    const raw = String((e && (e.code || e.message)) || '').toLowerCase();
    if (raw.indexOf('permission') !== -1 || raw.indexOf('denied') !== -1)
      return '선생님이 아직 이 AI 기능을 허락하지 않았어요.\n선생님께 물어봐 주세요.';
    if (raw.indexOf('unauthenticated') !== -1)
      return '연결이 잠시 풀렸어요. 화면을 새로고침한 뒤 다시 해 주세요.';
    if (/(network|unavailable|deadline|timeout|fetch|offline)/.test(raw))
      return '인터넷 연결이 불안정해요. 연결을 확인하고 다시 해 주세요.';
    if (/(resource-exhausted|quota|too many)/.test(raw))
      return '지금은 AI를 쓰는 친구들이 많아요. 잠시 후 다시 해 주세요.';
    return '잠시 문제가 생겼어요. 조금 뒤에 다시 해 주세요.';
  }

  /* 응답 reasonCode → 사용자 안내(순수). 매핑 없으면 서버의 "한글" message만 통과,
     영어/기술 문구면 기본 문구(ERR-KO-1). */
  function _imageAiNoticeForResponse(res) {
    const rc = res && res.reasonCode;
    if (rc && IMAGE_AI_NOTICE[rc]) return IMAGE_AI_NOTICE[rc];
    const m = res && res.message;
    if (m && /[가-힣]/.test(m)) return m;
    return '이미지 AI 기능은 준비 중입니다. 원본 그림은 그대로 유지됩니다.';
  }

  /* HttpsError code → 사용자 안내(순수). 매핑 없으면 null(일반 실패 문구로). */
  function _imageAiNoticeForError(code) {
    const c = String(code || '');
    if (/unauthenticated/i.test(c)) return '다시 로그인해 주세요.';
    if (/permission-denied/i.test(c)) return '선생님이 이미지 AI를 열어야 사용할 수 있어요.';
    if (/invalid-argument/i.test(c)) return '요청 정보가 올바르지 않아요. 새로고침 후 다시 시도해 주세요.';
    return null;
  }

  function _getCurrentSceneForImageAi() {
    try {
      if (typeof ViewerState === 'undefined' || !ViewerState || !ViewerState.scenes) return null;
      const sid = ViewerState.currentSceneId;
      if (sid == null) return null;
      const scene = ViewerState.scenes[sid];
      if (!scene) return null;
      return { sid: sid, scene: scene };
    } catch (e) { return null; }
  }

  async function _runImageAiS1Entry() {
    if (_imageAiS1Busy) return;                       /* 중복 클릭 방지 */
    if (!_aiToggleProjectTypeAllowed()) return;        /* 1. projectType gate */
    if (!_isImageS1ExplicitlyEnabledByTeacher()) {     /* 2. teacher permission gate (명시적 imageS1=true 필요) */
      alert('선생님이 이미지 AI를 열어야 사용할 수 있어요.');
      return;
    }
    /* 3. scene + 원본 이미지 존재 확인 (read만) */
    const cur = _getCurrentSceneForImageAi();
    if (!cur) { alert('장면 정보를 찾지 못했어요. 새로고침 후 다시 시도해 주세요.'); return; }
    if (!(cur.scene.imageData || cur.scene.imageUrl)) {
      alert('먼저 이 장면에 그림을 넣어 주세요.');
      return;
    }

    const btn = document.getElementById('ai-image-entry-btn');
    let prevLabel = null;
    _imageAiS1Busy = true;
    if (btn) { prevLabel = btn.textContent; btn.disabled = true; btn.textContent = '연결 중…'; }
    try {
      /* 4. imagePolicy ensure — P5-IMAGE-POLICY-1 모달 재사용. 취소/저장 실패 → 호출 안 함. */
      const policy = await _ensureImagePolicyBeforeImageAi(cur.scene);
      if (!policy) return;

      /* 5. callImageAiS1 호출 — 원문 이미지(imageData/imageUrl)는 보내지 않음. 서버가 scene을 직접 read. */
      const ctx = _getCurrentClassIdTeamName();
      let res;
      try {
        res = await _callPhaseAFunction('callImageAiS1', {
          classId: ctx.classId,
          teamName: ctx.teamName,
          sceneId: cur.sid,
        });
      } catch (e) {
        const mapped = _imageAiNoticeForError(e && (e.code || e.message));
        alert(mapped || ('이미지 AI를 쓰지 못했어요.\n' + _friendlyAiError(e)));
        return;
      }

      /* 6. skeleton 응답 — notImplemented는 성공 아님. 안내만. fake 후보/토글 전환/캐시 write 절대 없음. */
      alert(_imageAiNoticeForResponse(res));
    } finally {
      _imageAiS1Busy = false;
      if (btn) { btn.disabled = false; if (prevLabel != null) btn.textContent = prevLabel; }
    }
  }

  /* 진입 버튼 노출 — 게이트(projectType + 교사 명시적 imageS1=true)만 통과하면 표시. 이미지 존재는 클릭 시 확인. */
  function _showImageAiEntryButton() {
    /* LOW-13(2026-07-11): imageS1(AI 그림 정돈)은 폐기·imageS2로 대체 — 진입 버튼 영구 비노출.
       (레거시 학급의 modes.imageS1=true 저장값이 남아 있어도 dead-end 버튼을 띄우지 않는다) */
    _hideImageAiEntryButton(); return;
    /* eslint-disable no-unreachable */
    if (!_aiToggleProjectTypeAllowed()) { _hideImageAiEntryButton(); return; }
    if (!_isImageS1ExplicitlyEnabledByTeacher()) { _hideImageAiEntryButton(); return; }
    _hideImageAiEntryButton();
    const bar = document.createElement('div');
    bar.id = 'ai-image-entry-btn-bar';
    bar.className = 'ai-view-toggle-bar ai-view-toggle-bar--image-entry';
    bar.style.top = '88px';  /* 텍스트(8px)·이미지 보기(48px) 토글 바 아래로 stack */
    bar.innerHTML = '<span class="ai-view-toggle-bar__label">그림 AI:</span>'
      + '<button type="button" class="ai-view-toggle-btn js-ai-image-entry" id="ai-image-entry-btn">AI 그림 정돈 준비</button>';
    document.body.appendChild(bar);
    const btn = bar.querySelector('.js-ai-image-entry');
    if (btn) btn.addEventListener('click', _runImageAiS1Entry);
  }

  function _hideImageAiEntryButton() {
    const bar = document.getElementById('ai-image-entry-btn-bar');
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
  }

  /* DOMContentLoaded 시 토글 바 부트스트랩 — finalized 상태이고 edit 세션일 때만 표시 */
  function _bootstrapAiToggleBar() {
    const run = function () {
      _showAiToggleBar();
      /* P5-IMAGE-CLIENT-1 — 이미지 AI 진입 버튼도 부트스트랩 시 노출 재평가(게이트 통과 시만). */
      if (typeof _showImageAiEntryButton === 'function') {
        try { _showImageAiEntryButton(); } catch (e) { /* noop */ }
      }
      /* ViewerState 초기화가 이 시점보다 늦을 수 있음 — editMode 판정이 아직 안 끝났을 수 있다.
         그 경우 여기서는 노출되지 않고 — viewer entry 이후 _showAiToggleBar 재호출 시점에 조건을 다시 평가해 표시된다. */
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
    /* fix 2026-05-21: snapshot은 {sceneId: scene} 객체. Object.values 사용. */
    Object.values(snapshot || {}).forEach(function (s) {
      if (!s) return;
      const r = cand.results[s.id];   /* Functions가 sceneId 정규화 처리 */
      if (!r || r.skip) return;  /* skip 결과는 저장하지 않음 — 원본 유지 */
      /* GPT 피드백 #3: 강한 경고가 있는 결과는 적용하지 않음 (원본 유지) */
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
    if (_shouldUseRealApi() && !cand.isMock) {   /* AI-STAB-2: mock 후보는 실 Firebase 저장 금지(오염 방지) */
      _saveTextVariantToFirebase('s1', final);   /* fire-and-forget */
    }

    /* 사용자 결정 #C — 마감 후 aiDrafts 기본 정리. TEST MODE에서는 보존/초기화 선택 가능. */
    if (_isTestMode()) {
      const keep = confirm('[TEST MODE] aiDrafts를 보존할까요?\n\nOK = 보존 (3 후보 + 편집 상태 확인 가능)\n취소 = 정리 (운영과 동일)');
      if (!keep) {
        /* AI-STAB-2: namespaced 키로 정리(bare 키는 다른 팀 draft를 안 지움). */
        try { localStorage.removeItem(_getMockDraftsKey()); } catch (e) { /* noop */ }
      } else {
        /* status는 finalized로 저장 (selectedAttempt는 그대로 남음) */
        d.textS1.status = 'finalized';
        _saveAiDrafts(d);
      }
    } else {
      /* AI-STAB-2: namespaced 키로 정리(bare 키 제거 버그 → drafting 잔존 해소). */
      try { localStorage.removeItem(_getMockDraftsKey()); } catch (e) { /* noop */ }
    }

    /* step4: 마감 후 토글 바 표시 + viewer 현재 장면 다시 렌더 */
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
    const waqTeacher   = _isModeAllowedByTeacher('writeAfterQuestions');
    return {
      writeAfterQuestions: {
        /* WRITE-AFTER Phase 3: 생각 점검 질문. 기본 OFF(교사가 켜야 함) + 본문 2개 이상. */
        enabled: waqTeacher && bodyCount >= 2,
        reason:  !waqTeacher ? NOT_OPENED : (bodyCount < 2 ? '본문이 있는 장면이 2개 이상 필요해요' : ''),
      },
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
     AI 안내 카드 — 브라우저 기본 alert 대체 (사용 횟수/실패/사용 불가 안내)
     · 비차단(non-blocking). 호출부는 보여준 뒤 그대로 return.
     · 제목은 message 내용으로 자동 판별(또는 options.title로 지정).
     ════════════════════════════════════════════════════════════════ */
  function _aiNoticeTitleFor(message) {
    const m = String(message || '');
    let mode = '';
    if (/장면 발전|텍스트 2단계/.test(m)) mode = '장면 발전';
    else if (/문장 정돈|텍스트 1단계/.test(m)) mode = '문장 정돈';
    else if (/작품 검사/.test(m)) mode = '작품 검사';
    if (/횟수를 모두 사용/.test(m)) return (mode ? mode + ' ' : '') + '사용 횟수를 모두 사용했어요';
    if (mode) return mode + ' 안내';
    return 'AI 안내';
  }
  function showAiNotice(message, options) {
    options = options || {};
    const title = options.title || _aiNoticeTitleFor(message);
    const okLabel = options.okLabel || '확인';
    const ID = 'ai-notice-root';
    const old = document.getElementById(ID);
    if (old) old.remove();

    const root = document.createElement('div');
    root.id = ID;
    root.className = 'ai-notice-backdrop';
    root.innerHTML =
      '<div class="ai-notice-card" role="dialog" aria-modal="true">'
      +   '<div class="ai-notice-title">' + _escapeHtml(title) + '</div>'
      +   '<div class="ai-notice-message">' + _escapeHtml(message) + '</div>'
      +   '<div class="ai-notice-actions">'
      +     '<button type="button" class="ai-notice-ok">' + _escapeHtml(okLabel) + '</button>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(root);

    function close() {
      root.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    root.addEventListener('click', function (e) { if (e.target === root) close(); });
    document.addEventListener('keydown', onKey);
    const okBtn = root.querySelector('.ai-notice-ok');
    if (okBtn) { okBtn.addEventListener('click', close); try { okBtn.focus(); } catch (_) {} }
    return root;
  }

  /* ────────────────────────────────────────────────────────────────
     showAiToast — 단순 완료/성공 알림. 브라우저 alert 대신 화면 하단에
     잠깐 떴다가 자동으로 사라짐(확인 버튼 불필요). 위험/실패는 쓰지 X.
     ──────────────────────────────────────────────────────────────── */
  let _aiToastTimer = null;
  function showAiToast(message, options) {
    options = options || {};
    const ms = typeof options.duration === 'number' ? options.duration : 2600;
    const ID = 'ai-toast-root';
    const old = document.getElementById(ID);
    if (old) old.remove();
    if (_aiToastTimer) { clearTimeout(_aiToastTimer); _aiToastTimer = null; }
    const el = document.createElement('div');
    el.id = ID;
    el.className = 'ai-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<span class="ai-toast-icon">✅</span>'
      + '<span class="ai-toast-text">' + _escapeHtml(message) + '</span>';
    document.body.appendChild(el);
    /* 진입 애니메이션 트리거 */
    requestAnimationFrame(function () { el.classList.add('is-show'); });
    function dismiss() {
      el.classList.remove('is-show');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 240);
    }
    _aiToastTimer = setTimeout(dismiss, ms);
    el.addEventListener('click', dismiss);
    return el;
  }

  /* ════════════════════════════════════════════════════════════════
     첫 안내 모달
     ════════════════════════════════════════════════════════════════ */
  function _showOnboardingModal(onConfirm) {
    const html = `
      <div class="ai-modal__header">
        <div class="ai-modal__title">📔 작품 마무리</div>
      </div>
      <div class="ai-modal__body">
        <p class="ai-onboarding-text">
          작품 마무리는 질문과 검사로 고칠 곳을 찾고,<br/>
          내가 직접 고친 뒤, 마지막에 AI 후보를 비교해 보는 활동이에요.<br/>
          AI는 작품을 대신 만들거나 고치지 않아요.<br/>
          질문과 확인할 점을 보여주고 마지막 다듬기 후보를 보여줘요. 고치고 고르는 건 내가 직접 해요.
        </p>
        <div class="ai-onboarding-hint">
          AI 결과는 참고 자료예요. 내가 직접 읽고 판단해 골라 적용해야 반영되고, 원본은 그대로 남아요.
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
     FINISH-READY-GATE(2026-07-11): "끝까지 만들고 쓰는 기능" 확인 게이트.
     온보딩(다시 안 보기 가능)과 달리 세션당 1회는 반드시 묻는다 —
     횟수 제한 기능을 만들다 만 작품에 소모하는 실사용 사고 방지.
     sessionStorage라 탭/수업이 바뀌면 다시 묻고, 마무리 흐름 중 재진입은 안 막음.
     ════════════════════════════════════════════════════════════════ */
  const SS_READY_GATE_KEY = 'branchAiReadyGate1';
  function _hasPassedReadyGate() {
    try { return sessionStorage.getItem(SS_READY_GATE_KEY) === '1'; }
    catch (e) { return false; }
  }
  function _showReadyGateModal(onConfirm) {
    const html = `
      <div class="ai-modal__header">
        <div class="ai-modal__title">🏁 잠깐! 작품을 끝까지 만들었나요?</div>
      </div>
      <div class="ai-modal__body">
        <p class="ai-onboarding-text">
          <b>작품 마무리는 이야기를 끝까지 다 만든 뒤에 쓰는 기능이에요.</b><br/>
          사용할 수 있는 횟수가 정해져 있어서, 만드는 중에 써 버리면<br/>
          정말 마무리할 때 못 쓸 수 있어요.
        </p>
        <div class="ai-onboarding-hint">
          장면들과 엔딩까지 다 만들었는지 먼저 확인해 보세요.
        </div>
      </div>
      <div class="ai-modal__footer">
        <button class="ai-btn js-ai-ready-later">아직 만드는 중이에요</button>
        <button class="ai-btn ai-btn--primary js-ai-ready-go">네! 끝까지 만들었어요</button>
      </div>
    `;
    const root = _createModalRoot('ai-ready-gate-modal', html);
    root.querySelector('.js-ai-ready-later').addEventListener('click', () => {
      _removeModalRoot('ai-ready-gate-modal');
    });
    root.querySelector('.js-ai-ready-go').addEventListener('click', () => {
      try { sessionStorage.setItem(SS_READY_GATE_KEY, '1'); } catch (e) {}
      _removeModalRoot('ai-ready-gate-modal');
      if (typeof onConfirm === 'function') onConfirm();
    });
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

  /* ════════════════════════════════════════════════════════════════
     PRINT-VIEW-MODE-OPTIONS-1 — 그림책 인쇄 기준 선택 모달
     ──────────────────────────────────────────────────────────────
     · 인쇄 전 글/그림 기준을 각각 선택: 원본 / AI 후보(s2). 기본 = 원본/원본.
     · 일회성 옵션 — DB 저장 0·감상 토글 상태와 분리(안전 기본 우선·textSelections 무관).
     · AI 후보가 없으면 해당 옵션 비활성 + 안내. s2 선택이어도 후보 없는 장면은
       print 모듈이 장면 단위 원본 fallback.
     · 데이터 소스 = 감상 토글과 동일(_getFbVariantBody/_getFbImageVariantUrl) — 화면에서
       보던 AI 후보가 그대로 인쇄됨. 원본 scene.body/imageData/imageUrl 무변경(read만).
     ════════════════════════════════════════════════════════════════ */
  /* SCENE-PUBLISH-PRINT-1: 그림책 인쇄 = 교사/관리용 — 노출 게이트.
     admin 대시보드 경유(branchReturnContext.source='admin'·adminConsole이 저장) 또는
     ?print=pb(관리 카드의 인쇄 진입) 일 때만 인쇄 버튼/자동 진입을 연다.
     localStorage 마커라 보안 게이트가 아니라 '학생 태블릿 화면 단순화' 목적(인쇄는 위험 동작 아님). */
  function _hasAdminEntryMarker() {
    try {
      const p = new URLSearchParams((typeof location !== 'undefined') ? location.search : '');
      if (p.get('print') === 'pb') return true;
      const ctx = JSON.parse(localStorage.getItem('branchReturnContext') || 'null');
      return !!(ctx && ctx.source === 'admin');
    } catch (e) { return false; }
  }

  async function _showPbPrintOptionsModal() {
    /* FOLLOWUP-1: AI 후보 존재 판정은 FB 캐시 기반(_isS2Finalized/_hasImageVariantS2)인데,
       모달이 비동기 캐시 로드보다 먼저 열리면 실제 결과가 있어도 '아직 없음'으로 비활성되던
       race 수정 — 모달 구성 전에 두 캐시 로드를 await(이미 로드됐으면 즉시 반환·실패해도
       원본 옵션으로 진행). 감상 토글과 동일 데이터 기준 보장. */
    try { await _loadFirebaseTextVariants(false); } catch (e) { /* noop */ }
    try { await _loadFirebaseImageVariants(false); } catch (e) { /* noop */ }
    const hasTextS2 = _isS2Finalized();
    const hasImageS2 = _hasImageVariantS2();
    const T = 'font-family:\'Jua\',sans-serif;font-size:13.5px;color:#5b4a2e;margin:0 0 6px;';
    const row = (group, val, label, checked, disabled, note) => ''
      + '<label style="display:flex;align-items:center;gap:8px;padding:9px 12px;border:1.5px solid ' + (disabled ? '#e5ddca' : '#d8c7a6') + ';border-radius:10px;'
      +   (disabled ? 'color:#b6a887;background:#fbf8ef;cursor:not-allowed;' : 'cursor:pointer;background:#fff;') + 'font-size:13.5px;">'
      +   '<input type="radio" name="' + group + '" value="' + val + '"' + (checked ? ' checked' : '') + (disabled ? ' disabled' : '') + ' style="accent-color:#c66f4a;">'
      +   '<span>' + label + (note ? ' <span style="font-size:11.5px;color:#a4977c;">' + note + '</span>' : '') + '</span>'
      + '</label>';
    const html = ''
      + '<div class="ai-modal__header"><div class="ai-modal__title">🖨 그림책 인쇄</div>'
      +   '<button class="ai-modal__close js-ai-modal-close" aria-label="닫기">✕</button></div>'
      + '<div class="ai-modal__body">'
      +   '<p class="ai-mode-intro" style="margin-top:0;">어떤 글과 그림으로 그림책을 인쇄할까요? 원본은 그대로 보존돼요.</p>'
      +   '<div style="' + T + '">📖 글</div>'
      +   '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">'
      +     row('pbprint-text', 'original', '원본 글', true, false, '')
      +     row('pbprint-text', 's2', 'AI 장면발전 글', false, !hasTextS2, hasTextS2 ? '' : '(아직 만든 결과가 없어요)')
      +   '</div>'
      +   '<div style="' + T + '">🎨 그림</div>'
      +   '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">'
      +     row('pbprint-image', 'original', '원본 그림', true, false, '')
      +     row('pbprint-image', 's2', 'AI 그림책 마감 그림', false, !hasImageS2, hasImageS2 ? '' : '(아직 만든 결과가 없어요)')
      +   '</div>'
      +   '<div style="padding:8px 11px;background:#fff7e8;border:1px solid #e8d3a0;border-radius:8px;font-size:12px;color:#6b5a3a;">'
      +     '⚠️ <b>중요:</b> 인쇄 창에서 <b>설정 더보기 → 머리글과 바닥글</b>을 꼭 꺼 주세요. 켜져 있으면 날짜와 주소가 그림책에 함께 찍혀요.'
      +   '</div>'
      +   '<div style="margin-top:8px;padding:8px 11px;background:#f4f6f2;border:1px solid #dfe6d8;border-radius:8px;font-size:12px;color:#5f6b57;">'
      +     '💬 말풍선은 <b>기기 해상도에 따라 위치·크기가 조금 달라 보일 수 있어요.</b> 인쇄 미리보기에서 말풍선이 작거나 그림에 가려 잘 안 보이면, 다듬기에서 <b>말풍선을 옮기거나 키운 뒤</b> 다시 인쇄해 주세요.'
      +   '</div>'
      + '</div>'
      + '<div class="ai-modal__footer">'
      +   '<button type="button" class="ai-btn ai-btn--ghost js-pbprint-cancel">취소</button>'
      +   '<button type="button" class="ai-btn ai-btn--primary js-pbprint-go">🖨 그림책 인쇄하기</button>'
      + '</div>';
    const root = _createModalRoot('ai-pbprint-modal', html);
    const closeAll = function () { _removeModalRoot('ai-pbprint-modal'); };
    const closeBtn = root.querySelector('.js-ai-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeAll);
    const cancelBtn = root.querySelector('.js-pbprint-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', closeAll);
    const goBtn = root.querySelector('.js-pbprint-go');
    if (goBtn) goBtn.addEventListener('click', function () {
      const pick = (name) => { const el = root.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : 'original'; };
      const textMode = pick('pbprint-text');
      const imageMode = pick('pbprint-image');
      closeAll();
      window.PicturebookPrint.open({
        textMode: textMode,
        imageMode: imageMode,
        /* 감상 토글과 동일한 s2 소스 — 후보 없으면 null 반환 → print가 장면 단위 원본 fallback */
        getS2Body: function (sid) {
          /* _getDisplayBody와 동일 순서: FB 캐시 → localStorage finalized fallback */
          const b = _getFbVariantBody('s2', String(sid));
          if (typeof b === 'string') return _brToNewline(b);
          try {
            const v = _loadAiVariants();
            const f = v.textS2 && v.textS2.status === 'finalized' && v.textS2.final && v.textS2.final[String(sid)];
            if (f && typeof f.body === 'string') return _brToNewline(f.body);
          } catch (e) { /* noop */ }
          return null;
        },
        getS2Image: function (sid) { return _getFbImageVariantUrl('s2', String(sid)); },
        /* SCENE-PUBLISH-PRINT-1: 글=AI일 때 말풍선 variant layout(감상 AI 보기와 동일 소스) */
        getS2Layout: function (sid) {
          return _getFbVariantLayout('s2', String(sid)) || _getLocalVariantLayout('s2', String(sid)) || null;
        },
      });
    });
  }

  function _showModeModal() {
    const a = _getModeAvailability();

    /* IMAGE-S2-ENTRY: 'AI 그림책 마감' 카드 — 다듬기(edit=1&from=maker) 세션 + 그림책 작품일 때만 노출.
       감상 모드·학생·텍스트 작품엔 미노출. enabled=imageS2 ON(설정). 클릭은 batch 패널만 열고 변환은 패널 gate가 막음. */
    const _searchStr = (typeof location !== 'undefined') ? location.search : '';
    const _isEditSess = !!(window.isEditViewerSession && window.isEditViewerSession(_searchStr));
    const _isPicturebook = !!(typeof ViewerState !== 'undefined' && ViewerState.project && ViewerState.project.projectType === 'picturebook');
    const _showImageS2Card = _isEditSess && _isPicturebook;
    const _imageS2Allowed = _isModeAllowedByTeacher('imageS2');

    const html = `
      <div class="ai-modal__header">
        <div class="ai-modal__title">📔 작품 마무리</div>
        <button class="ai-modal__close js-ai-modal-close" aria-label="닫기">✕</button>
      </div>
      <div class="ai-modal__body">
        <p class="ai-mode-intro">
          질문과 검사로 고칠 곳을 찾고, 자료를 보며 직접 고친 뒤, 마지막에 AI 후보를 비교해 보세요.
          AI는 작품을 대신 만들거나 고치지 않아요.
        </p>
        ${(() => {
          /* WRITE-AFTER-FLOW-GROUPING-UX: 작품 마무리 흐름을 목적별 3구역으로 묶는다.
             1구역(고쳐쓰기 자료: 생각 점검 질문·작품 검사=동등)·2구역(직접 고치기)·3구역(마지막 다듬기).
             생각 점검 질문↔작품 검사는 순서/합침이 아니라 둘 다 고쳐쓰기 전 참고 자료. 기능/핸들러 무변경.
             Phase A fix: 실 API면 client mock quota 안 씀(Functions가 quota). */
          const realApi = _shouldUseRealApi();
          const checkRemain = realApi ? Infinity : _getRemaining('check');
          const waqRemain = realApi ? Infinity : _getRemaining('writeAfterQuestions');
          const T = 'font-size:14px;font-weight:700;color:#5b4a2e;margin:0 0 2px;';
          const D = 'font-size:12px;color:#8a7a5e;margin:0 0 8px;line-height:1.4;';
          /* WRITE-AFTER Phase 5C: 단계 완료 게이트. rewriteDone(2단계 완료·localStorage) 전엔 3단계 잠금. */
          const rewriteDone = _isRewriteDone();
          const waqBadge = _writeAfterLatest.waq ? ' ✅' : '';
          const wcBadge = _writeAfterLatest.wc ? ' ✅' : '';
          const sec1 = `
        <div class="ai-finish-section" style="margin-top:4px;">
          <div class="ai-finish-section-title" style="${T}">1. 고쳐쓰기 자료 만들기</div>
          <div class="ai-finish-section-desc" style="${D}">AI가 질문과 점검 결과를 만들어 줘요. 글은 내가 직접 고쳐요.</div>
          <div class="ai-mode-grid">
          ${_renderModeCard({
            key: 'writeAfterQuestions', icon: '💭', title: '생각 점검 질문' + waqBadge,
            desc: _writeAfterLatest.waq ? '이미 질문을 받았어요. 2단계에서 다시 볼 수 있어요. (다시 받을 수도 있어요.)' : '내 이야기를 더 깊게 돌아볼 질문을 받아요. AI가 대신 고치지 않고 질문만 해요.',
            enabled: a.writeAfterQuestions.enabled && waqRemain > 0,
            disabledReason: waqRemain === 0 ? '이번 작품에서 사용할 수 있는 횟수를 모두 사용했어요' : a.writeAfterQuestions.reason,
            remaining: realApi ? null : waqRemain,
          })}
          ${_renderModeCard({
            key: 'check', icon: '🔍', title: '작품 검사' + wcBadge,
            desc: _writeAfterLatest.wc ? '이미 검사했어요. 2단계에서 확인할 점을 다시 볼 수 있어요. (다시 검사할 수도 있어요.)' : '맞춤법, 장면 연결, 인물 이름처럼 확인할 점을 찾아요. AI가 대신 고치지 않고 알려줘요.',
            enabled: a.check.enabled && checkRemain > 0,
            disabledReason: checkRemain === 0 ? '이번 작품에서 사용할 수 있는 횟수를 모두 사용했어요' : a.check.reason,
            remaining: realApi ? null : checkRemain,
          })}
          </div>
        </div>`;
          /* Phase 5B/5C: 2구역 = 최근 결과 다시 보며 고치기 + '모두 고쳤어요'(rewriteDone) 잠금. */
          const rewriteBox = rewriteDone
            ? `<div class="ai-waq-rewrite-box" style="margin-top:8px;padding:8px 12px;background:#eef7ea;border:1px solid #cfe6c2;border-radius:10px;color:#4a6b3a;font-size:13px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><span>✅ <b>고쳐쓰기 완료</b> — 이제 마지막 다듬기를 할 수 있어요.</span><button type="button" class="js-waq-rewrite-undo" style="flex:none;padding:5px 11px;border:1px solid #c9b78e;border-radius:8px;background:#fff;color:#8a6d2f;font-size:12px;font-weight:700;cursor:pointer;">다시 고칠래요</button></div>`
            : `<div class="ai-waq-rewrite-box" style="margin-top:8px;padding:8px 12px;background:#fff7e8;border:1px solid #e8d3a0;border-radius:10px;color:#6b5a3a;font-size:13px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><span>자료를 보고 필요한 장면을 고쳤나요?</span><button type="button" class="js-waq-rewrite-done" style="flex:none;padding:5px 11px;border:none;border-radius:8px;background:#5b8a3a;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">□ 모두 고쳤어요</button></div>`;
          const doneReason = '이미 고쳐쓰기 완료로 표시했어요. 다시 보거나 고치려면 ‘다시 고칠래요’를 눌러 주세요.';
          const sec2 = `
        <div class="ai-finish-section" style="margin-top:16px;">
          <div class="ai-finish-section-title" style="${T}">2. 자료 보며 직접 고치기</div>
          <div class="ai-finish-section-desc" style="${D}">${rewriteDone ? '필요한 장면을 고쳤어요. 다시 고치려면 아래 버튼을 눌러요.' : '생각 점검 질문과 작품 검사 결과를 보며 장면을 직접 고쳐요.'}</div>
          <div class="ai-mode-grid">
          ${_renderModeCard({
            key: 'latestQuestions', icon: '💭', title: '생각 점검 질문 결과 보기',
            desc: 'AI가 준 질문을 다시 보며 고칠 장면을 골라요.',
            enabled: !rewriteDone, disabledReason: doneReason, remaining: null,
          })}
          ${_renderModeCard({
            key: 'latestWorkCheck', icon: '🔍', title: '작품 검사 결과 보기',
            desc: '확인할 점을 다시 보며 고칠 장면을 골라요.',
            enabled: !rewriteDone, disabledReason: doneReason, remaining: null,
          })}
          </div>
          ${(_writeAfterLatest.waq || _writeAfterLatest.wc) ? `
          <div style="margin-top:8px;text-align:right;">
            <button type="button" class="ai-btn ai-btn--ghost js-ai-print-writeafter"
              title="이 자료는 선생님 컴퓨터에서 종이로 뽑아요">🖨 선생님께 인쇄 부탁하기</button>
          </div>` : ''}
          ${rewriteBox}
        </div>`;
          const lockReason = '먼저 2단계에서 자료를 보고 고친 뒤 ‘모두 고쳤어요’를 눌러 주세요.';
          /* REFINE-STAB-D: 이야기 길 확인 — HUD 더보기에서 이동. 2단계 완료 뒤·3단계 앞 위치. */
          const _isPbProject = (typeof ViewerState !== 'undefined' && ViewerState.project && ViewerState.project.projectType === 'picturebook');
          const secRoute = `
        <div class="ai-finish-section" style="margin-top:16px;">
          <div class="ai-finish-section-title" style="${T}">🗺 이야기 길 확인</div>
          <div class="ai-finish-section-desc" style="${D}">엔딩까지 가는 길을 읽어보며 이야기가 자연스럽게 이어지는지 확인해요.</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" class="ai-btn js-ai-open-routes">🛤 이야기 길 보기</button>
            ${(_isPbProject && _hasAdminEntryMarker()) ? '<button type="button" class="ai-btn ai-btn--ghost js-ai-print-pb" title="장면 무대(그림+말풍선) 그대로 그림책처럼 인쇄해요. (선생님 컴퓨터 인쇄용)">🖨 그림책 인쇄</button>' : ''}
          </div>
          ${(_isPbProject && _hasAdminEntryMarker()) ? '<div style="margin-top:6px;padding:7px 10px;background:#fff7e8;border:1px solid #e8d3a0;border-radius:8px;font-size:12px;color:#6b5a3a;">⚠️ <b>중요:</b> 인쇄 창에서 <b>설정 더보기 → 머리글과 바닥글</b>을 꼭 꺼 주세요. 켜져 있으면 날짜와 주소가 그림책에 함께 찍혀요.</div>' : ''}
        </div>`;
          const sec3 = `
        <div class="ai-finish-section" style="margin-top:16px;${!rewriteDone ? 'opacity:0.62;' : ''}">
          <div class="ai-finish-section-title" style="${T}">3. 마지막 다듬기${!rewriteDone ? ' 🔒' : ''}</div>
          <div class="ai-finish-section-desc" style="${D}">${rewriteDone ? '고친 글을 바탕으로 AI가 만든 후보를 비교해 볼 수 있어요.' : '2단계에서 자료를 보고 고친 뒤 마지막 다듬기를 할 수 있어요.'}</div>
          <div class="ai-mode-grid">
          ${_renderModeCard({
            key: 's2', icon: '✨', title: 'AI 장면발전',
            desc: '고친 글을 바탕으로 더 자연스러운 표현 후보를 받아요. 사건·선택지·엔딩은 그대로 두고 표현만 발전시켜요.',
            enabled: rewriteDone && a.s2.enabled, disabledReason: !rewriteDone ? lockReason : a.s2.reason, remaining: null,
          })}
          ${_showImageS2Card ? _renderModeCard({
            key: 'imageS2', icon: '🖼️', title: 'AI 그림책 마감',
            desc: '그림책 그림을 더 완성된 느낌으로 다듬어요. AI가 만든 그림은 후보로만 저장돼요. 학생이 그린 원본 그림은 그대로 남아요. (교사용 · 외부 AI 전송 가능)',
            enabled: rewriteDone && _imageS2Allowed, disabledReason: !rewriteDone ? lockReason : '선생님이 아직 열어주지 않았어요', remaining: null,
          }) : ''}
          </div>
        </div>`;
          return sec1 + sec2 + secRoute + sec3;
        })()}
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

    /* UI-REBUILD-1: data-ai-mode 있는 실제 카드만 핸들러(직접 고치기 안내 카드는 data-ai-mode 없음 → 제외). */
    root.querySelectorAll('.ai-mode-card[data-ai-mode]:not(.ai-mode-card--disabled)').forEach(card => {
      card.addEventListener('click', () => {
        const mode = card.getAttribute('data-ai-mode');
        _removeModalRoot('ai-mode-modal');
        if (mode === 'latestQuestions') {
          /* Phase 5B: 최근 생각 점검 질문 결과 다시 보기(AI 재호출 없음). 없으면 안내. */
          _showLatestWriteAfterQuestions();
        } else if (mode === 'latestWorkCheck') {
          /* Phase 5B: 최근 작품 검사 결과 다시 보기(AI 재호출 없음). 없으면 안내. */
          _showLatestWorkCheck();
        } else if (mode === 'writeAfterQuestions') {
          _startWriteAfterQuestions();
        } else if (mode === 's2') {
          _startTextS2();
        } else if (mode === 'check') {
          _startWorkCheck();
        } else if (mode === 'imageS2') {
          /* IMAGE-S2-ENTRY: 기존 floating 버튼과 동일 패널 재사용(중복 구현 0). 패널이 자체 gate로 변환을 막음. */
          if (window.imageS2BatchUi && typeof window.imageS2BatchUi.open === 'function') {
            window.imageS2BatchUi.open();
          }
        }
      });
    });

    /* REFINE-STAB-D: 이야기 길 보기(다듬기 HUD에서 이동) + 그림책 인쇄 — 모달 닫고 실행. */
    const openRoutesBtn = root.querySelector('.js-ai-open-routes');
    if (openRoutesBtn) openRoutesBtn.addEventListener('click', function () {
      _removeModalRoot('ai-mode-modal');
      if (typeof window._openViewerRoutePanel === 'function') window._openViewerRoutePanel();
      else alert('이야기 길 보기를 불러오지 못했어요. 페이지를 새로고침해 주세요.');
    });
    const pbPrintBtn = root.querySelector('.js-ai-print-pb');
    if (pbPrintBtn) pbPrintBtn.addEventListener('click', function () {
      /* PRINT-VIEW-MODE-OPTIONS-1: 바로 인쇄하지 않고 글/그림 기준 선택 모달 경유 */
      if (window.PicturebookPrint && typeof window.PicturebookPrint.open === 'function') _showPbPrintOptionsModal();
      else alert('인쇄 기능을 불러오지 못했어요. 페이지를 새로고침해 주세요.');
    });

    /* WRITE-AFTER-PRINT-1: 고쳐쓰기 자료 인쇄 — latest read만(AI 0·DB write 0·단계 게이트 무변경).
       TEACHER-PRINT-ROUTE-1: 학생 태블릿엔 프린터가 없어 기본 동작을 "선생님께 부탁" 안내로 전환.
       교사 인쇄는 관리모드 ⋯메뉴(&print=wa 자동 실행)가 정식 경로. 안내 모달의 보조 버튼으로
       기기 인쇄(AirPrint 등)는 계속 가능(기능 삭제 0). */
    const waPrintBtn = root.querySelector('.js-ai-print-writeafter');
    if (waPrintBtn) waPrintBtn.addEventListener('click', function () {
      _showTeacherPrintNotice('고쳐쓰기 자료', function () { _openWriteAfterPrint(); });
    });

    /* Phase 5C: '모두 고쳤어요' / '다시 고칠래요' — rewriteDone 토글(localStorage·DB 0·AI 0) 후 모달 재렌더. */
    const rwDoneBtn = root.querySelector('.js-waq-rewrite-done');
    if (rwDoneBtn) rwDoneBtn.addEventListener('click', function () {
      _setRewriteDone(true);
      _removeModalRoot('ai-mode-modal');
      _showModeModal();
    });
    const rwUndoBtn = root.querySelector('.js-waq-rewrite-undo');
    if (rwUndoBtn) rwUndoBtn.addEventListener('click', function () {
      _setRewriteDone(false);
      _removeModalRoot('ai-mode-modal');
      _showModeModal();
    });

    /* WORKCHECK-HISTORY-BOTTOM 제거(2026-07-09): 하단 '최근 검사 결과 보기'는 위 2구역 '🔍 작품 검사 결과 보기'와
       중복이라 삭제(사용자 요청). _showLatestWorkCheck 자체는 그 카드·복귀 흐름에서 계속 사용. */

    /* v140 fix 2026-05-21: TEST MODE reset 버튼 연결 — 4 버튼. reset 후 모달 다시 렌더 (남은 횟수 갱신) */
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
      /* 토글 바도 다시 평가 — finalized가 아니면 표시되지 않음 */
      _showAiToggleBar();
      _afterReset('variants');
    });
    const all = root.querySelector('.js-ai-tm-reset-team-all');
    if (all) all.addEventListener('click', function () {
      if (!confirm('현재 팀(' + _getCurrentNamespace() + ')의 AI 사용 기록·후보·결과를 모두 초기화할까요?')) return;
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

  /* 작품 snapshot 생성 — AI에 보낼 입력. 표지/본문빈장면 제외. */
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

  /* mock revise — 간단 변형. 실 AI X. 사용자가 mock인 거 인지하도록 표시를 살짝 넣음. */
  function _mockReviseS1(body) {
    /* 1단계 mock — 다중 공백·문장 부호 정리. 의미 변경 X. */
    let r = String(body)
      .replace(/[ \t]+/g, ' ')                              /* 다중 공백 1개 */
      .replace(/\s*,\s*/g, ', ')                            /* 쉼표 뒤 공백 */
      .replace(/([가-힣])\.([가-힣])/g, '$1. $2')            /* 마침표 뒤 공백 */
      .replace(/\.\s*\n/g, '.\n')                           /* 마침표 + 줄바꿈 정돈 */
      .trim();
    /* 사용자가 mock인 거 인지하게 라벨 추가 — 실 단계엔 없음 */
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

  /* mock 호출 — 실 API 사용 안 함. 가짜 응답 생성. */
  async function _mockCallTextAiBatch(snapshot, strength) {
    const delayMs = MOCK_DELAY_MIN + Math.random() * (MOCK_DELAY_MAX - MOCK_DELAY_MIN);
    await _delay(delayMs);  /* 지연 도중 cancel 가능 */

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

  /* mock store — localStorage (rules에 ai-suggestions 경로가 없어 Firebase에 저장 안 함) */
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
  /* v140 fix: 팀별 namespace key (classId__teamName) 사용 — 같은 브라우저를 쓰는 팀 간 quota 격리 */
  function _loadMockUsage() {
    try {
      const key = _getMockUsageKey();
      let raw = localStorage.getItem(key);
      /* 마이그레이션 없음 — 옛 공통 키에 데이터가 남아 있어도 namespace 키로 옮기지 않음 (각 팀 0부터 시작). */
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { s1Used: 0, s2Used: 0, s3Used: 0, checkUsed: 0, lastUsedAt: 0 };
  }
  function _saveMockUsage(usage) {
    try { localStorage.setItem(_getMockUsageKey(), JSON.stringify(usage)); } catch (e) {}
  }
  /* WRITE-AFTER-QUOTA-FIX: mode별 mock quota를 제네릭으로 처리(사용키 = mode+'Used' = 기존 규약과 동일:
     s1Used/s2Used/checkUsed…). 이전엔 s1/s2/s3/check만 하드코딩돼 신규 mode(writeAfterQuestions)가
     _getRemaining에서 무조건 0 → '횟수 부족'으로 즉시 차단되는 버그가 있었다. 이제 MOCK_QUOTA에 mode를
     추가하기만 하면 세 함수가 자동 지원(재발 방지). MOCK_QUOTA에 없는 mode는 0(기존 호환). */
  function _getRemaining(mode) {
    const cap = MOCK_QUOTA[mode];
    if (cap == null) return 0;
    const u = _loadMockUsage();
    return Math.max(0, cap - (u[mode + 'Used'] || 0));
  }
  function _consumeQuota(mode) {
    if (MOCK_QUOTA[mode] == null) return;
    const u = _loadMockUsage();
    u[mode + 'Used'] = (u[mode + 'Used'] || 0) + 1;
    u.lastUsedAt = Date.now();
    _saveMockUsage(u);
  }
  function _refundQuota(mode) {
    /* 7가지 환불 정책 (AI_SAFETY_COST_RULES.md 5-1):
       - 모델 실패 / 정책 위반 거부 / 네트워크 오류 → 환불 */
    if (MOCK_QUOTA[mode] == null) return;
    const u = _loadMockUsage();
    const k = mode + 'Used';
    if ((u[k] || 0) > 0) u[k]--;
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
      showAiNotice('이 작품에서 사용할 수 있는 ‘문장 정돈’ 횟수를 모두 사용했어요.\n직접 문장을 고치거나, 나중에 다시 사용해 주세요.');
      return;
    }
    /* 잠금 검사 */
    if (typeof _editText !== 'undefined' && _editText.editable === false) {
      showAiNotice('다른 사용자가 편집 중이라 지금은 AI를 사용할 수 없어요.\n잠시 후 다시 시도해 주세요.', { title: '지금은 AI를 사용할 수 없어요' });
      return;
    }
    /* 입력 큐 비우기 (v138 함수 재사용) */
    if (typeof _flushPendingSave === 'function') {
      await _flushPendingSave();
    }

    const snapshot = _buildWorkSnapshot();
    const sceneCount = Object.keys(snapshot).length;
    if (sceneCount === 0) {
      alert('본문이 있는 장면이 없어요. 먼저 작품을 작성해 주세요.');
      return;
    }

    /* quota 차감 — 호출 시작 시점 (7가지 환불 정책 따라 실패 시 환불) */
    _consumeQuota('s1');

    /* AbortController 준비 */
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
      showAiNotice('문장 정돈을 하지 못했어요.\n' + _friendlyAiError(e), { title: '문장 정돈 안내' });
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

    /* mock 진단 — sceneId 기반 가짜 결과 생성. 실 AI 아님. */
    const spelling = [];
    const coherence = [];
    const characterConsistency = [];
    const branchFlow = [];

    /* 첫 1~2개 장면에 mock 맞춤법 항목 추가 */
    sceneIds.slice(0, Math.min(2, sceneIds.length)).forEach((id, idx) => {
      spelling.push({
        sceneId: id,
        wrong: idx === 0 ? '쫓긴다' : '도망갓다',
        correct: idx === 0 ? '쫓긴다' : '도망갔다',
        note: 'MOCK 진단 — 실 AI 아님',
      });
    });

    /* 장면 2개 이상이면 mock 유기성 항목 추가 */
    if (sceneIds.length >= 2) {
      coherence.push({
        sceneIdFrom: sceneIds[0],
        sceneIdTo: sceneIds[1],
        issue: 'MOCK: 두 장면 사이 흐름이 자연스러운지 한번 더 확인해주세요',
      });
    }

    /* storyAnalyzer로 도달 불가능 장면 표시 (실제 분석) */
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

  /* WORKCHECK-HISTORY-1: 검사 시각 사람이 읽기 좋은 한국어 포맷. */
  function _formatCheckedAt(ts) {
    const n = Number(ts);
    if (!n || isNaN(n)) return '';
    try {
      return new Date(n).toLocaleString('ko-KR', {
        year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
    } catch (e) { return ''; }
  }

  /* WORKCHECK-HISTORY-1: DB에 저장된 마지막 작품검사 결과를 다시 표시.
     AI 함수 호출 없음, quota 사용 없음, DB write 없음 — aiChecks/workCheck/latest read만. */
  async function _showLatestWorkCheck() {
    const { classId, teamName } = _getCurrentClassIdTeamName();
    if (!classId || !teamName) { alert('현재 작품 정보를 확인하지 못했어요.'); return; }
    const app = _getViewerFirebaseApp();
    if (!app || !app.database) { alert('연결 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.'); return; }
    const enc = encodeURIComponent(teamName);
    let latest = null;
    try {
      const snap = await app.database()
        .ref('classes/' + classId + '/teams/' + enc + '/aiChecks/workCheck/latest')
        .once('value');
      latest = snap.val();
    } catch (e) {
      console.warn('[WORKCHECK-HISTORY] latest 읽기 실패', e);
      alert('저장된 검사 결과를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
      return;
    }
    if (!latest || !latest.result) {
      alert('아직 작품 검사 결과가 없어요. ‘작품 검사’를 눌러 확인할 점을 받아 보세요.');
      return;
    }
    const modalResult = Object.assign({}, latest.result, {
      latestLoaded: true,
      checkedAt: latest.checkedAt || null,
      sceneCount: latest.sceneCount || null,
      model: latest.model || null,
    });
    _showCheckResultModal(modalResult);
  }

  /* TEACHER-PRINT-ROUTE-1: "선생님께 인쇄 부탁하기" 안내 모달 — 학생 태블릿엔 프린터가 없어
     인쇄물은 교사 컴퓨터(관리모드 ⋯메뉴)에서 뽑는 게 정식 경로임을 안내한다.
     보조 버튼으로 이 기기 인쇄(AirPrint 교실)도 유지. DOM만·저장 0. */
  function _showTeacherPrintNotice(label, onDevicePrint) {
    _removeModalRoot('teacher-print-notice');
    const root = document.createElement('div');
    root.id = 'teacher-print-notice';
    root.style.cssText = 'position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;background:rgba(20,14,8,0.45);';
    const card = document.createElement('div');
    card.style.cssText = 'background:#fffdf7;border-radius:14px;max-width:340px;width:calc(100% - 48px);padding:22px 20px 16px;box-shadow:0 12px 36px rgba(0,0,0,0.25);text-align:center;font-family:inherit;';
    card.innerHTML = ''
      + '<div style="font-size:30px;line-height:1;">🖨</div>'
      + '<div style="font-weight:700;font-size:16px;margin-top:8px;">선생님께 인쇄를 부탁해요</div>'
      + '<div style="font-size:13.5px;color:#5b4a33;margin-top:8px;line-height:1.55;">'
      +   (label || '이 자료') + '는 선생님 컴퓨터에서 종이로 뽑아요.<br>'
      +   '선생님께 <b>“인쇄해 주세요”</b>라고 말씀드려요!'
      + '</div>'
      + '<button type="button" class="ai-btn js-tpn-ok" style="margin-top:14px;width:100%;">알겠어요</button>'
      + '<button type="button" class="ai-btn ai-btn--ghost js-tpn-device" style="margin-top:8px;width:100%;font-size:12px;opacity:0.75;">그래도 이 기기에서 인쇄해 보기</button>';
    root.appendChild(card);
    document.body.appendChild(root);
    const close = function () { _removeModalRoot('teacher-print-notice'); };
    card.querySelector('.js-tpn-ok').addEventListener('click', close);
    card.querySelector('.js-tpn-device').addEventListener('click', function () {
      close();
      if (typeof onDevicePrint === 'function') { try { onDevicePrint(); } catch (e) { /* noop */ } }
    });
    root.addEventListener('click', function (e) { if (e.target === root) close(); });
  }

  /* ══ WRITE-AFTER-PRINT-1: 고쳐쓰기 자료 인쇄 (교사 PC A4 기준·태블릿은 보조) ══
     · aiChecks latest(질문·검사) read만 — AI 호출 0·DB write 0·원본 무변경·단계 게이트 무변경.
     · gate: body.print-write-after + #write-after-print-root — 기존 tc-print-*와 독립(충돌 0).
     · 항목: real 필드(sceneId/message/where)+구 mock fallback. 전부 textContent(이스케이프 안전). */
  function _buildWriteAfterPrintModel(scenes, waqLatest, wcLatest) {
    const sc = (scenes && typeof scenes === 'object') ? scenes : {};
    const sceneLabel = (sid, fallbackLabel) => {
      if (fallbackLabel) return fallbackLabel;
      if (sid == null || sid === '') return '작품 전체';
      const s = sc[String(sid)];
      const t = s && typeof s.title === 'string' && s.title.trim() ? ' · ' + s.title.trim() : '';
      return '장면 ' + sid + t + (s ? '' : ' (장면 정보 없음)');
    };
    const sections = [];
    /* 섹션 1 — 생각 점검 질문 */
    const qs = waqLatest && waqLatest.result && Array.isArray(waqLatest.result.questions) ? waqLatest.result.questions : [];
    if (qs.length) {
      sections.push({
        title: '💭 생각 점검 질문',
        items: qs.map(q => ({
          scene: sceneLabel(q && q.sceneId, q && q.sceneLabel),
          text: (q && q.question) || '',
          sub: (q && (q.studentAction || q.reason)) || '',
        })).filter(it => it.text),
      });
    }
    /* 섹션 2 — 작품 검사(4카테고리·화면 라벨과 동일) */
    const cats = wcLatest && wcLatest.result && wcLatest.result.categories ? wcLatest.result.categories : {};
    const CAT_DEFS = [
      ['spelling', '📝 글자와 문장 확인'], ['coherence', '🔗 장면 연결 확인'],
      ['character', '👤 인물과 이름 확인'], ['branchFlow', '🌳 선택지·마무리 확인'],
    ];
    const wcItems = [];
    for (const [key, label] of CAT_DEFS) {
      const arr = Array.isArray(cats[key]) ? cats[key]
        : (key === 'character' && Array.isArray(cats.characterConsistency)) ? cats.characterConsistency : [];
      for (const it of arr) {
        if (!it || typeof it !== 'object') continue;
        const sid = (it.sceneId != null && it.sceneId !== '') ? it.sceneId
          : (it.sceneIdFrom != null && it.sceneIdFrom !== '') ? it.sceneIdFrom : null;
        const msg = it.message || it.issue || (it.wrong && it.correct ? ('‘' + it.wrong + '’ → ‘' + it.correct + '’') : '') || '';
        if (!msg) continue;
        wcItems.push({ scene: sceneLabel(sid, null), text: msg, sub: [label.replace(/^\S+\s/, ''), it.where || ''].filter(Boolean).join(' · ') });
      }
    }
    if (wcItems.length) sections.push({ title: '🔍 작품 검사', items: wcItems });
    return sections;
  }

  async function _openWriteAfterPrint() {
    const { classId, teamName } = _getCurrentClassIdTeamName();
    if (!classId || !teamName) { alert('현재 작품 정보를 확인하지 못했어요.'); return; }
    const app = _getViewerFirebaseApp();
    if (!app || !app.database) { alert('연결 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.'); return; }
    const enc = encodeURIComponent(teamName);
    const _read = async (p) => { try { return (await app.database().ref(p).once('value')).val(); } catch (e) { return null; } };
    const base = 'classes/' + classId + '/teams/' + enc + '/aiChecks/';
    const [waq, wc] = await Promise.all([_read(base + 'writeAfterQuestions/latest'), _read(base + 'workCheck/latest')]);
    const scenes = (typeof window !== 'undefined' && window.ViewerState && window.ViewerState.scenes) ? window.ViewerState.scenes : {};
    const sections = _buildWriteAfterPrintModel(scenes, waq, wc);
    if (!sections.length) { alert('아직 인쇄할 자료가 없어요. 1단계에서 질문이나 작품 검사를 먼저 받아 보세요.'); return; }

    /* 인쇄 root — 중복 생성 방지(기존 제거 후 재생성). 전부 textContent. */
    const old = document.getElementById('write-after-print-root');
    if (old) old.remove();
    const root = document.createElement('div');
    root.id = 'write-after-print-root';
    root.className = 'write-after-print-root';
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const head = el('div', 'wa-print-head');
    head.appendChild(el('h1', 'wa-print-title', '✍ 고쳐쓰기 자료'));
    const today = new Date();
    head.appendChild(el('div', 'wa-print-meta', '모둠: ' + teamName + '   ·   ' + today.getFullYear() + '년 ' + (today.getMonth() + 1) + '월 ' + today.getDate() + '일'));
    head.appendChild(el('div', 'wa-print-guide', 'AI가 도와준 참고 자료예요. 꼭 정답은 아니니, 읽고 스스로 생각해 본 뒤 필요하면 고쳐요. 고친 항목엔 체크해요.'));
    root.appendChild(head);
    sections.forEach((sec, idx) => {
      const s = el('div', 'wa-print-section');
      /* WA-PRINT-PAGEBREAK: 작품 검사(2번째 섹션)는 생각 점검 질문과 안 겹치게 다음 페이지에서 시작(사용자 요청).
         단독 섹션이면(생각 점검 질문 없음) idx=0이라 미적용 → 빈 첫 페이지 방지. */
      if (idx > 0) s.classList.add('wa-print-section--newpage');
      s.appendChild(el('h2', 'wa-print-section-title', sec.title));
      sec.items.forEach(it => {
        const item = el('div', 'wa-print-item');
        const row = el('div', 'wa-print-item-row');
        row.appendChild(el('span', 'wa-print-check', '☐ 고쳤어요'));
        row.appendChild(el('span', 'wa-print-scene', it.scene));
        item.appendChild(row);
        item.appendChild(el('div', 'wa-print-text', it.text));
        if (it.sub) item.appendChild(el('div', 'wa-print-sub', it.sub));
        item.appendChild(el('div', 'wa-print-memoline'));
        s.appendChild(item);
      });
      root.appendChild(s);
    });
    const foot = el('div', 'wa-print-section');
    foot.appendChild(el('h2', 'wa-print-section-title', '📝 오늘 내가 고친 것'));
    for (let i = 0; i < 3; i++) foot.appendChild(el('div', 'wa-print-memoline'));
    root.appendChild(foot);
    document.body.appendChild(root);

    /* gate 클래스 — 인쇄 동안만(취소 포함 afterprint+2s 정리). tc-print-*와 독립.
       FIELD-REGRESSION-FIX-2: <html> print-doc-unclip — viewer.css의 html,body 고정
       (height:100%·overflow:hidden)이 다중 페이지 인쇄를 1페이지로 자르던 문제 해제. */
    try {
      document.body.classList.add('print-write-after');
      document.documentElement.classList.add('print-doc-unclip');
      const cleanup = function () {
        document.body.classList.remove('print-write-after');
        document.documentElement.classList.remove('print-doc-unclip');
        const r = document.getElementById('write-after-print-root');
        if (r) r.remove();
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);
      window.print();
      setTimeout(cleanup, 2000);
    } catch (e) {
      document.body.classList.remove('print-write-after');
      document.documentElement.classList.remove('print-doc-unclip');
      const r = document.getElementById('write-after-print-root');
      if (r) r.remove();
    }
  }

  /* WRITE-AFTER Phase 5B: 최근 생각 점검 질문 결과 다시 보기 — AI 재호출 없음, aiChecks/writeAfterQuestions/latest read만. */
  async function _showLatestWriteAfterQuestions() {
    const { classId, teamName } = _getCurrentClassIdTeamName();
    if (!classId || !teamName) { alert('현재 작품 정보를 확인하지 못했어요.'); return; }
    const app = _getViewerFirebaseApp();
    if (!app || !app.database) { alert('연결 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.'); return; }
    const enc = encodeURIComponent(teamName);
    let latest = null;
    try {
      const snap = await app.database()
        .ref('classes/' + classId + '/teams/' + enc + '/aiChecks/writeAfterQuestions/latest')
        .once('value');
      latest = snap.val();
    } catch (e) {
      console.warn('[WAQ-HISTORY] latest 읽기 실패', e);
      alert('저장된 질문을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
      return;
    }
    if (!latest || !latest.result) {
      alert('아직 생각 점검 질문 결과가 없어요. 1단계에서 질문을 먼저 받아 보세요.');
      return;
    }
    const modalResult = Object.assign({}, latest.result, { latestLoaded: true });
    _showWriteAfterQuestionsResultModal(modalResult);
  }

  /* WRITE-AFTER Phase 5B: '확인했어요' 체크 — session/local만(DB write 0). key=classId:teamName:type:itemKey.
     본문/개인정보 저장 안 함(체크 상태만). item id 없으면 index fallback. */
  function _waqSeenKey(type, itemKey) {
    const { classId, teamName } = _getCurrentClassIdTeamName();
    return 'writeAfterSeen:' + (classId || '') + ':' + (teamName || '') + ':' + type + ':' + itemKey;
  }
  function _isWaqSeen(type, itemKey) {
    try { return localStorage.getItem(_waqSeenKey(type, itemKey)) === '1'; } catch (e) { return false; }
  }
  function _setWaqSeen(type, itemKey, on) {
    try { if (on) localStorage.setItem(_waqSeenKey(type, itemKey), '1'); else localStorage.removeItem(_waqSeenKey(type, itemKey)); } catch (e) {}
  }
  /* 확인했어요 토글 버튼 HTML(결과 항목 우측). data-seen-type/data-seen-key로 위임 처리. */
  function _seenToggleHtml(type, itemKey) {
    const on = _isWaqSeen(type, itemKey);
    return `<button type="button" class="ai-waq-seen js-ai-waq-seen${on ? ' is-seen' : ''}" data-seen-type="${_escapeHtml(type)}" data-seen-key="${_escapeHtml(itemKey)}" aria-pressed="${on}" `
      + `style="flex:none;margin-left:6px;padding:4px 9px;border:1px solid ${on ? '#8bbf6a' : '#d9cba8'};border-radius:8px;background:${on ? '#e9f5e0' : '#fff'};color:${on ? '#4a6b3a' : '#8a7a5e'};font-size:12px;cursor:pointer;">${on ? '✅ 확인했어요' : '□ 확인했어요'}</button>`;
  }
  /* 결과 모달 공통: 확인했어요 토글 위임 바인딩. */
  function _bindSeenToggles(root) {
    if (!root) return;
    root.querySelectorAll('.js-ai-waq-seen').forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = btn.getAttribute('data-seen-type');
        const key = btn.getAttribute('data-seen-key');
        const next = !_isWaqSeen(type, key);
        _setWaqSeen(type, key, next);
        btn.classList.toggle('is-seen', next);
        btn.setAttribute('aria-pressed', String(next));
        btn.textContent = next ? '✅ 확인했어요' : '□ 확인했어요';
        btn.style.border = '1px solid ' + (next ? '#8bbf6a' : '#d9cba8');
        btn.style.background = next ? '#e9f5e0' : '#fff';
        btn.style.color = next ? '#4a6b3a' : '#8a7a5e';
        const item = btn.closest('.ai-check-item');
        if (item) item.style.opacity = next ? '0.6' : '';
      });
    });
  }

  /* ════════════════════════════════════════════════════════════════
     WRITE-AFTER Phase 5C — 단계 완료 게이트 (localStorage만·DB write 0·AI 0)
     · 1단계 완료 = 최근 결과 존재(aiChecks latest) / · 2단계 완료 = rewriteDone(localStorage)
     · 3단계(마지막 다듬기)는 rewriteDone일 때만 활성. '다시 고칠래요'로 해제.
     ════════════════════════════════════════════════════════════════ */
  function _rewriteDoneKey() {
    const { classId, teamName } = _getCurrentClassIdTeamName();
    return 'writeAfterStepDone:' + (classId || '') + ':' + (teamName || '') + ':rewrite';
  }
  function _isRewriteDone() {
    try { return localStorage.getItem(_rewriteDoneKey()) === '1'; } catch (e) { return false; }
  }
  function _setRewriteDone(on) {
    try { if (on) localStorage.setItem(_rewriteDoneKey(), '1'); else localStorage.removeItem(_rewriteDoneKey()); } catch (e) {}
  }
  /* 최근 결과(생각 점검 질문·작품 검사) 존재 여부 로드 — aiChecks latest read만(AI 0). best-effort. */
  async function _preloadWriteAfterLatestFlags() {
    _writeAfterLatest = { waq: false, wc: false };
    const { classId, teamName } = _getCurrentClassIdTeamName();
    if (!classId || !teamName) return;
    const app = _getViewerFirebaseApp();
    if (!app || !app.database) return;
    const enc = encodeURIComponent(teamName);
    const base = 'classes/' + classId + '/teams/' + enc + '/aiChecks/';
    try {
      const [waqSnap, wcSnap] = await Promise.all([
        app.database().ref(base + 'writeAfterQuestions/latest/result').once('value'),
        app.database().ref(base + 'workCheck/latest/result').once('value'),
      ]);
      _writeAfterLatest = { waq: !!(waqSnap && waqSnap.val()), wc: !!(wcSnap && wcSnap.val()) };
    } catch (e) { /* 실패 시 false 유지(표시만 생략) */ }
  }

  async function _startWorkCheck() {
    /* quota 검사 */
    if (_getRemaining('check') <= 0) {
      showAiNotice('이 작품에서 사용할 수 있는 ‘작품 검사’ 횟수를 모두 사용했어요.\n최근 검사 결과가 있다면 먼저 확인해 보세요.');
      return;
    }
    /* 잠금 검사 (검사도 저장된 데이터 기반이라 잠금 확인) */
    if (typeof _editText !== 'undefined' && _editText.editable === false) {
      showAiNotice('다른 사용자가 편집 중이라 지금은 AI를 사용할 수 없어요.\n잠시 후 다시 시도해 주세요.', { title: '지금은 AI를 사용할 수 없어요' });
      return;
    }
    if (typeof _flushPendingSave === 'function') {
      await _flushPendingSave();
    }

    const snapshot = _buildWorkSnapshot();
    const sceneCount = Object.keys(snapshot).length;
    if (sceneCount < 2) {
      alert('본문이 있는 장면이 2개 이상 필요해요.');
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
      showAiNotice('작품 검사를 하지 못했어요.\n' + _friendlyAiError(e));
      return;
    }

    _hideCallingModal();
    /* AI-STAB-3: 서버가 캐시된 결과를 돌려줬으면(cached) 실 AI 호출·서버 quota 차감이 없었으므로
       방금 낙관적으로 차감한 로컬 quota를 되돌려 viewer 카운트를 서버와 일치시킨다. (mock 경로는 cached 없음) */
    if (result && result.cached) {
      _refundQuota('check');
    }
    /* Phase 2 — 서버 사전 검사 차단 응답이면 모달 안내 후 종료 (진단 없음) */
    if (result && result.blocked) {
      _showAiPrecheckBlockedModal(result, 'check');
      return;
    }
    _showCheckResultModal(result);
  }

  /* ════════════════════════════════════════════════════════════════
     WRITE-AFTER Phase 5 — 고쳐쓰기 자료(질문/검사) → 직접 고치기 → 작품 마무리 복귀
     editNavigateTo(편집 모드=본문 contenteditable) 재사용. AI 호출/DB write 0
     (원본 body는 학생이 저장할 때만 바뀜). 복귀 안내는 작은 하단 바(닫기 가능).
     ════════════════════════════════════════════════════════════════ */
  function _hideWriteAfterReturnHint() {
    const el = document.getElementById('write-after-return-hint');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }
  function _returnToWriteAfterModal() {
    _hideWriteAfterReturnHint();
    try { if (typeof openModal === 'function') { openModal(); return; } } catch (e) { /* fallthrough */ }
    try { _showModeModal(); } catch (e2) { /* noop */ }
  }
  function _showWriteAfterReturnHint(source) {
    _hideWriteAfterReturnHint();
    const src = String(source || 'directEdit');
    try { sessionStorage.setItem('pb_write_after_source', src); } catch (e) {}
    /* WRITE-AFTER Phase 5B: 온 곳(source)에 따라 복귀 문구/버튼/동작을 바꾼다. 결과 재오픈은 latest read만(AI 0). */
    let msg, btnLabel, onReturn;
    if (src === 'questions') {
      msg = '고친 뒤 <b>생각 점검 질문</b>으로 돌아와 남은 질문을 확인하세요.';
      btnLabel = '생각 점검 질문으로 돌아가기';
      onReturn = function () { _hideWriteAfterReturnHint(); Promise.resolve().then(_showLatestWriteAfterQuestions).catch(_returnToWriteAfterModal); };
    } else if (src === 'workCheck') {
      msg = '고친 뒤 <b>작품 검사 결과</b>로 돌아와 남은 확인할 점을 보세요.';
      btnLabel = '작품 검사 결과로 돌아가기';
      onReturn = function () { _hideWriteAfterReturnHint(); Promise.resolve().then(_showLatestWorkCheck).catch(_returnToWriteAfterModal); };
    } else {
      msg = '고친 뒤 <b>작품 마무리</b>로 돌아와 다음 단계를 이어가세요.';
      btnLabel = '작품 마무리로 돌아가기';
      onReturn = _returnToWriteAfterModal;
    }
    const bar = document.createElement('div');
    bar.id = 'write-after-return-hint';
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9000;'
      + 'display:flex;align-items:center;gap:10px;max-width:92vw;padding:8px 12px;'
      + 'background:#fff7e8;border:1px solid #e8d3a0;border-radius:12px;box-shadow:0 4px 16px rgba(80,60,20,.18);'
      + 'font-family:inherit;font-size:13px;color:#6b5a3a;';
    bar.innerHTML =
      '<span>✏️ ' + msg + '</span>'
      + '<button type="button" class="js-waq-return" style="flex:none;padding:6px 12px;border:none;border-radius:8px;background:#5b8a3a;color:#fff;font-size:13px;font-weight:700;cursor:pointer;">' + btnLabel + '</button>'
      + '<button type="button" class="js-waq-return-close" aria-label="닫기" style="flex:none;padding:4px 8px;border:none;background:transparent;color:#a8895a;font-size:15px;cursor:pointer;line-height:1;">✕</button>';
    document.body.appendChild(bar);
    bar.querySelector('.js-waq-return').addEventListener('click', onReturn);
    bar.querySelector('.js-waq-return-close').addEventListener('click', _hideWriteAfterReturnHint);
  }
  /* 결과 카드/직접 고치기 카드 공통 진입: 해당 장면 편집 상태로 이동 + 복귀 안내. source=questions|workCheck|directEdit */
  function _enterDirectEditFromWriteAfter(sceneId, source) {
    const sid = (sceneId == null) ? '' : String(sceneId);
    if (!sid || typeof editNavigateTo !== 'function') {
      alert('해당 장면으로 이동할 수 없어요. 새로고침 후 다시 시도해주세요.');
      return false;
    }
    if (typeof ViewerState !== 'undefined' && ViewerState.scenes && !ViewerState.scenes[sid]) {
      alert('그 장면을 찾지 못했어요.');
      return false;
    }
    editNavigateTo(sid);
    _showWriteAfterReturnHint(source || 'directEdit');
    return true;
  }

  /* 검사 결과 모달 — 수정 X. 진단만. "이 장면 고치기" 버튼(직접 편집 진입) 제공. */
  function _showCheckResultModal(check) {
    const cats = check.categories || {};
    /* CHECK-UI-1: real 응답 카테고리 키는 character, 구버전 mock은 characterConsistency.
       존재하는 쪽을 읽어 누락·카운트 0 방지. (빈 배열도 truthy라 real character:[]가 우선) */
    /* WRITE-AFTER Phase 4: 학생용 라벨(고쳐쓰기 점검표). schema key(spelling/coherence/character/branchFlow)는
       무변경 — 화면 표시 title만 학생 친화 문구로. 기존 저장 결과와 호환. */
    const sections = [
      { key: 'spelling',   icon: '📝', title: '글자와 문장 확인',   items: cats.spelling || [] },
      { key: 'coherence',  icon: '🔗', title: '장면 연결 확인',     items: cats.coherence || [] },
      { key: 'character',  icon: '👤', title: '인물과 이름 확인',   items: cats.character || cats.characterConsistency || [] },
      { key: 'branchFlow', icon: '🌳', title: '선택지·마무리 확인', items: cats.branchFlow || [] },
    ];
    const _totalFindings = sections.reduce((n, s) => n + s.items.length, 0);

    const sectionsHtml = sections.map(sec => {
      const countCls = sec.items.length === 0 ? ' ai-check-category__count--zero' : '';
      let itemsHtml = '';
      if (sec.items.length === 0) {
        itemsHtml = '<div class="ai-check-empty">확인할 점 없어요 ✓</div>';
      } else {
        itemsHtml = sec.items.map((item, idx) => _renderCheckItem(sec.key, item, idx)).join('');
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

    /* AI-STAB-3: 서버가 같은 작품 상태의 저장된 검사 결과를 그대로 돌려준 경우(cached) 작게 안내. */
    const cachedNote = (check && check.cached)
      ? '<div class="ai-check-cached" style="margin-bottom:8px;padding:6px 10px;background:#eef6ff;border:1px solid #cfe3fb;border-radius:8px;color:#3a6ea5;font-size:12px;">💾 저장된 검사 결과예요 — 작품이 바뀌지 않아 새로 검사하지 않았어요.</div>'
      : '';
    /* WORKCHECK-HISTORY-1: DB에 저장된 마지막 검사 결과를 그대로 다시 본 경우(AI 재호출 없음). */
    const latestNote = (check && check.latestLoaded)
      ? ('<div class="ai-check-latest" style="margin-bottom:8px;padding:6px 10px;background:#fff6e6;border:1px solid #f0dcae;border-radius:8px;color:#8a6d2f;font-size:12px;">💾 저장된 검사 결과입니다. 작품을 수정했다면 다시 검사해 주세요.'
          + (check.checkedAt ? ('<span style="display:block;margin-top:2px;color:#a8895a;">마지막 검사: ' + _formatCheckedAt(check.checkedAt) + '</span>') : '')
          + '</div>')
      : '';
    /* 문제가 거의 없을 때(전 카테고리 0) — 부담 없는 안내. */
    const fewNote = (_totalFindings === 0)
      ? '<div class="ai-check-few" style="margin:2px 0 10px;padding:8px 12px;background:#eef7ea;border:1px solid #cfe6c2;border-radius:10px;color:#4a6b3a;font-size:13px;">크게 고칠 부분이 많지 않아요. 그래도 한 번 더 읽으며 선택지와 마무리를 확인해 보세요.</div>'
      : '';
    const html = `
      <div class="ai-modal__header">
        <div class="ai-modal__title">🔍 작품 검사 — 고쳐 볼 점</div>
        <button class="ai-modal__close js-ai-modal-close" aria-label="닫기">✕</button>
      </div>
      <div class="ai-modal__body">
        ${cachedNote}
        ${latestNote}
        <div class="ai-check-intro ai-check-intro--student">
          AI가 작품에서 <b>확인할 점</b>을 찾아줬어요. 글은 <b>내가 직접</b> 고쳐요.
          아래에서 고쳐 볼 장면을 골라 <b>‘이 장면 고치기’</b>를 눌러요.
          <span style="display:block;margin-top:3px;color:#8a8f98;font-size:12px;">생각 점검 질문은 더 생각할 질문을, 작품 검사는 고쳐 볼 부분을 찾아줘요. 고친 뒤 작품 마무리로 돌아와 마지막 다듬기를 해요.</span>
        </div>
        ${fewNote}
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

    /* Phase 5: '이 장면 고치기' — 모달 닫고 해당 장면 편집 진입 + 작품 검사 결과 복귀 안내. */
    root.querySelectorAll('.js-ai-check-jump').forEach(btn => {
      btn.addEventListener('click', () => {
        const sceneId = btn.getAttribute('data-scene-id');
        if (!sceneId) return;
        _removeModalRoot('ai-check-modal');
        _enterDirectEditFromWriteAfter(sceneId, 'workCheck');
      });
    });
    _bindSeenToggles(root);   /* Phase 5B: 확인했어요 토글 */
  }

  /* CHECK-UI-1: real(sceneId·message·where) + 구버전 mock(wrong/correct·sceneIdFrom/To·issue·scenes·character)
     항목을 필드 존재 여부로 렌더. 누락 필드의 undefined·빈 "→" 노출을 막는다. catKey는 호환용으로만 받음. */
  function _renderCheckItem(catKey, item, idx) {
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

    /* WRITE-AFTER Phase 4: 장면 라벨 강조 + '확인할 점:' 라벨(고쳐쓰기 점검표). 완성문 제시 아님 — 확인 대상만. */
    const sceneBadge = sceneLabel
      ? `<span class="ai-check-item__scene" style="font-weight:700;color:#5b4a2e;">${sceneLabel}</span> `
      : '';
    const textHtml = `${sceneBadge}<span class="ai-check-item__point">확인할 점: ${body}</span>`;
    const jumpHtml = jumpId
      ? `<button class="ai-check-item__jump js-ai-check-jump" data-scene-id="${_escapeHtml(jumpId)}">✏️ 이 장면 고치기</button>`
      : '';
    /* Phase 5B: '확인했어요' 체크(session/local). itemKey = 카테고리:index:장면. */
    const seenKey = String(catKey || 'x') + ':' + (idx != null ? idx : 0) + ':' + (jumpId || oneId || '');
    const seenHtml = _seenToggleHtml('workCheck', seenKey);
    const seenOn = _isWaqSeen('workCheck', seenKey);
    return `
      <div class="ai-check-item"${seenOn ? ' style="opacity:0.6;"' : ''}>
        <div class="ai-check-item__text">${textHtml}${whereHtml}</div>
        <div class="ai-check-item__actions" style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:4px;">${jumpHtml}${seenHtml}</div>
      </div>
    `;
  }

  /* ════════════════════════════════════════════════════════════════
     WRITE-AFTER Phase 3 — 생각 점검 질문 (mock·시작·결과 모달)
     AI는 질문만 한다. 글/사건/대사/결말 대필 금지. 학생이 직접 고친다.
     ════════════════════════════════════════════════════════════════ */
  async function _mockCallWriteAfterQuestions(snapshot) {
    const delayMs = MOCK_DELAY_MIN + Math.random() * (MOCK_DELAY_MAX - MOCK_DELAY_MIN);
    await _delay(delayMs);
    const ids = Object.keys(snapshot || {});
    const pick = (i) => ids[Math.min(i, ids.length - 1)] || '1';
    const types = ['선택지 연결', '이야기 흐름', '인물/물건 이어짐', '엔딩 이해'];
    const tmpl = [
      '이 장면에서 주인공은 왜 그렇게 했을까요? 이유를 한 가지 더 떠올려 볼까요?',
      '앞 장면과 이 장면이 자연스럽게 이어지나요? 빠진 이야기가 있을까요?',
      '여기 나온 인물이나 물건이 다음 장면에도 잘 이어지나요?',
      '읽는 친구가 이 부분을 이해할 수 있을까요?',
    ];
    const n = Math.min(4, Math.max(3, ids.length));
    const questions = [];
    for (let i = 0; i < n; i++) {
      const sid = pick(i);
      questions.push({
        id: 'q' + (i + 1), sceneId: String(sid), sceneLabel: '장면 ' + sid,
        type: types[i % types.length], question: tmpl[i % tmpl.length],
        reason: '스스로 더 생각해 볼 부분이에요.', studentAction: '장면 ' + sid + '에 한 문장을 더 써 볼까요?',
      });
    }
    return { ok: true, type: 'writeAfterQuestions', isMock: true, createdAt: Date.now(),
      summary: '내 이야기를 다시 읽으며 아래 질문을 생각해 봐요. (연습용 예시 질문)', questions };
  }

  async function _startWriteAfterQuestions() {
    if (_getRemaining('writeAfterQuestions') <= 0) {
      showAiNotice('이 작품에서 사용할 수 있는 ‘생각 점검 질문’ 횟수를 모두 사용했어요.\n최근 질문이 있다면 먼저 확인해 보세요.');
      return;
    }
    if (typeof _editText !== 'undefined' && _editText.editable === false) {
      showAiNotice('다른 사용자가 편집 중이라 지금은 AI를 사용할 수 없어요.\n잠시 후 다시 시도해 주세요.', { title: '지금은 AI를 사용할 수 없어요' });
      return;
    }
    if (typeof _flushPendingSave === 'function') await _flushPendingSave();

    const snapshot = _buildWorkSnapshot();
    const sceneCount = Object.keys(snapshot).length;
    if (sceneCount < 2) { alert('본문이 있는 장면이 2개 이상 필요해요.'); return; }

    _consumeQuota('writeAfterQuestions');
    _currentAbort = { aborted: false };
    _showCallingModal(sceneCount);

    let result = null;
    const useRealApi = _shouldUseRealApi();
    try {
      result = useRealApi ? await _phaseACallWriteAfterQuestions(snapshot) : await _mockCallWriteAfterQuestions(snapshot);
    } catch (e) {
      _hideCallingModal();
      if (e && e.message === 'cancelled') return;
      if (!useRealApi) _refundQuota('writeAfterQuestions');
      console.error('[Phase A] 생각 점검 질문 실패', e);
      showAiNotice('생각 점검 질문을 만들지 못했어요.\n' + _friendlyAiError(e));
      return;
    }
    _hideCallingModal();
    if (result && result.cached) _refundQuota('writeAfterQuestions');
    if (result && result.blocked) { _showAiPrecheckBlockedModal(result, 'writeAfterQuestions'); return; }
    _showWriteAfterQuestionsResultModal(result);
  }

  /* 생각 점검 질문 결과 모달 — 질문 카드 목록 + "장면 X로 이동"(editNavigateTo 재사용). 수정/대필 없음. */
  function _showWriteAfterQuestionsResultModal(res) {
    res = res || {};
    const questions = Array.isArray(res.questions) ? res.questions : [];
    const summaryHtml = res.summary
      ? `<div class="ai-check-intro">${_escapeHtml(res.summary)}</div>`
      : '';
    const latestNote = (res && res.latestLoaded)
      ? '<div class="ai-check-latest" style="margin-bottom:8px;padding:6px 10px;background:#fff6e6;border:1px solid #f0dcae;border-radius:8px;color:#8a6d2f;font-size:12px;">💾 저장된 질문이에요. 작품을 수정했다면 다시 받아 보세요.</div>'
      : '';
    const cardsHtml = questions.length === 0
      ? '<div class="ai-check-empty">표시할 질문이 없어요.</div>'
      : questions.map((q, idx) => {
          const sid = (q && q.sceneId != null && q.sceneId !== '') ? String(q.sceneId) : '';
          const label = _escapeHtml(q.sceneLabel || (sid ? ('장면 ' + sid) : ''));
          const typeTag = q.type ? `<span class="ai-check-category__count">${_escapeHtml(q.type)}</span>` : '';
          const reason = q.reason ? `<div class="ai-check-item__where" style="margin-top:2px;color:#8a8f98;font-size:12px;">${_escapeHtml(q.reason)}</div>` : '';
          const action = q.studentAction ? `<div class="ai-waq-action" style="margin-top:4px;color:#3a6ea5;font-size:13px;">✏️ ${_escapeHtml(q.studentAction)}</div>` : '';
          const jump = sid
            ? `<button class="ai-check-item__jump js-ai-waq-jump" data-scene-id="${_escapeHtml(sid)}">✏️ 이 장면 고치기</button>`
            : '';
          /* Phase 5B: '확인했어요' 체크(session/local). itemKey = 질문id(없으면 index):장면. */
          const seenKey = String((q && q.id) || ('q' + idx)) + ':' + sid;
          const seenHtml = _seenToggleHtml('questions', seenKey);
          const seenOn = _isWaqSeen('questions', seenKey);
          return `
            <div class="ai-check-category">
              <div class="ai-check-category__head"><span>💭 ${label}</span>${typeTag}</div>
              <div class="ai-check-item"${seenOn ? ' style="opacity:0.6;"' : ''}>
                <div class="ai-check-item__text">${_escapeHtml(q.question || '')}${reason}${action}</div>
                <div class="ai-check-item__actions" style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:4px;">${jump}${seenHtml}</div>
              </div>
            </div>`;
        }).join('');

    const html = `
      <div class="ai-modal__header">
        <div class="ai-modal__title">💭 생각 점검 질문</div>
        <button class="ai-modal__close js-ai-modal-close" aria-label="닫기">✕</button>
      </div>
      <div class="ai-modal__body">
        ${latestNote}
        <div class="ai-check-intro">
          AI는 <b>질문만 해요</b>. 글을 대신 고쳐 주지 않아요. 질문을 읽고 <b>내가 직접</b> 생각해서 고쳐요.
        </div>
        ${summaryHtml}
        ${cardsHtml}
      </div>
      <div class="ai-modal__footer">
        <button class="ai-btn ai-btn--primary js-ai-waq-close">닫기</button>
      </div>
    `;
    const root = _createModalRoot('ai-waq-modal', html, { size: 'large' });
    root.querySelector('.js-ai-modal-close').addEventListener('click', () => _removeModalRoot('ai-waq-modal'));
    root.querySelector('.js-ai-waq-close').addEventListener('click', () => _removeModalRoot('ai-waq-modal'));
    root.querySelectorAll('.js-ai-waq-jump').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sceneId = btn.getAttribute('data-scene-id');
        if (!sceneId) return;
        _removeModalRoot('ai-waq-modal');
        _enterDirectEditFromWriteAfter(sceneId, 'questions');
      });
    });
    _bindSeenToggles(root);   /* Phase 5B: 확인했어요 토글 */
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
        <div class="ai-modal__title">✨ 장면 발전 결과 <span class="ai-mock-badge ai-mock-badge--header">Phase 0.5 mock</span></div>
        <button class="ai-modal__close js-ai-modal-close" aria-label="닫기">✕</button>
      </div>
      <div class="ai-modal__body">
        <div class="ai-result-summary">${_escapeHtml(suggestion.globalSummary || '')}</div>
        <div class="ai-result-hint">
          체크된 장면만 적용돼요. ✅ 모두 / ☐ 체크 풀기로 일괄 선택할 수 있어요.
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
        /* 사용자가 그 사이 본문을 고친 경우 — 안내 + 건너뛰기 */
        raceCount++;
        continue;
      }

      const newBody = result.revisedText || '';

      /* mock history 저장 (localStorage) */
      _saveMockHistory(sceneId, originalBody || '', newBody, suggestion.suggestionId);

      /* v138 _rtSaveBody 재사용 — 메모리 + Firebase + 화면 + 롤백 모두 처리됨 */
      try {
        if (typeof _rtSaveBody === 'function') {
          await _rtSaveBody(sceneId, newBody);
          appliedCount++;
        } else {
          /* storyAnalyzer.js가 로드되지 않은 환경 — fallback (mock 단계) */
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
    let msg = `✅ ${appliedCount}개 장면에 장면 발전을 적용했어요.`;
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
     openModal — viewer 상단 [📔 작품 마무리] 진입점
     ════════════════════════════════════════════════════════════════ */
  async function openModal() {
    /* Phase 1: 카드가 교사 권한을 반영하도록 모달 전에 aiSettings 로드 보장. */
    try { await _loadClassAiSettings(); } catch (e) { /* fallback 허용 */ }
    /* Phase 5C: 1단계 완료 표시용 최근 결과 존재 여부 로드(best-effort·DB read만·AI 0). */
    try { await _preloadWriteAfterLatestFlags(); } catch (e) { /* 무시 */ }
    /* FINISH-READY-GATE: 온보딩 뒤(스킵 시 바로) "끝까지 만들었나요?" 확인 — 세션당 1회. */
    const _enter = _hasPassedReadyGate()
      ? _showModeModal
      : () => _showReadyGateModal(_showModeModal);
    if (!_hasSeenOnboarding()) {
      _showOnboardingModal(_enter);
    } else {
      _enter();
    }
  }

  /* ════════════════════════════════════════════════════════════════
     v140-step1: TEST MODE 배지 자동 표시
     ──────────────────────────────────────────────────────────────
     DOMContentLoaded 후 TEST MODE가 켜져 있으면 화면 상단에 배지 표시.
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
          /* P5-IMAGE-VARIANT-1: 같은 컨텍스트 준비 시점에 이미지 variant도 1회 preload(읽기 전용). */
          try { _preloadFirebaseImageVariants(); } catch (e) { /* noop */ }
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

  /* SCENE-PUBLISH-PRINT-1: ?print=pb — admin 카드 [🖨 그림책 인쇄] 진입.
     팀 로드(ViewerState.scenes)와 인쇄 모듈이 준비되면 인쇄 옵션 모달을 1회 자동 오픈.
     자동 print는 하지 않음(옵션 확인 후 교사가 인쇄하기 클릭). 최대 ~20초 폴링 후 포기. */
  (function _bootstrapPrintEntry() {
    let p = null;
    try { p = new URLSearchParams(location.search); } catch (e) { return; }
    if (!p || p.get('print') !== 'pb') return;
    let tries = 0;
    const MAX = 50;
    const tick = function () {
      tries++;
      const ready = (typeof window !== 'undefined')
        && window.PicturebookPrint && typeof window.PicturebookPrint.open === 'function'
        && (typeof ViewerState !== 'undefined') && ViewerState && ViewerState.scenes
        && Object.keys(ViewerState.scenes).length > 0;
      if (ready) { try { _showPbPrintOptionsModal(); } catch (e) { /* noop */ } return; }
      if (tries < MAX) setTimeout(tick, 400);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick);
    else tick();
  })();

  /* TEACHER-PRINT-ROUTE-1: ?print=wa — admin 카드 [🖨 고쳐쓰기 자료 인쇄] 진입.
     학생 태블릿엔 프린터가 없어 교사가 대신 인쇄하는 경로. 팀 컨텍스트가 준비되면
     _openWriteAfterPrint()를 1회 자동 실행(_bootstrapPrintEntry의 pb 패턴과 동일·최대 ~20초 폴링).
     aiChecks read는 담당 교사에게 rules로 허용됨(AICHECKS-RULES-READ-1). 자료 없으면 '없음' 카드. */
  (function _bootstrapWaPrintEntry() {
    let p = null;
    try { p = new URLSearchParams(location.search); } catch (e) { return; }
    if (!p || p.get('print') !== 'wa') return;
    let tries = 0;
    const MAX = 50;
    const tick = function () {
      tries++;
      const ready = (typeof ViewerState !== 'undefined') && ViewerState
        && ViewerState.project && ViewerState.project.teamName;
      if (ready) { try { _openWriteAfterPrint(); } catch (e) { /* noop */ } return; }
      if (tries < MAX) setTimeout(tick, 400);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick);
    else tick();
  })();

  /* ════════════════════════════════════════════════════════════════
     window 노출
     ════════════════════════════════════════════════════════════════ */
  if (typeof window !== 'undefined') {
    window.viewerAi = {
      /* WRITE-AFTER-PRINT-1: 인쇄 builder/실행 노출(하니스 검증·외부 진입용) */
      _buildWriteAfterPrintModel,
      _openWriteAfterPrint,
      PHASE:      PHASE,
      MOCK_ONLY:  MOCK_ONLY,
      openModal:  openModal,
      /* IMAGE-S2-10 — 교사 UI 모듈(viewer-image-batch-ui.js)이 콜러블/앱에 접근하도록 노출(내부 함수 그대로). */
      _callPhaseAFunction: _callPhaseAFunction,
      _getViewerFirebaseApp: _getViewerFirebaseApp,
      _resetOnboarding: function () {
        try { localStorage.removeItem(LS_ONBOARDING_KEY); } catch (e) {}
      },
      _resetMockStore: function () {
        try { localStorage.removeItem(LS_MOCK_STORE_KEY); } catch (e) {}
      },
      _getMockStore: _loadMockStore,
      _getMockUsage: _loadMockUsage,

      /* v140-step1 추가분 — TEST MODE 관련 정보 노출 */
      _isTestMode: _isTestMode,
      _isFinalizationBypassEnabled: _isFinalizationBypassEnabled,
      _setFinalizationBypass: _setFinalizationBypass,

      /* v140-step4 추가분 — viewer-render.js에서 사용할 것 (한 줄씩) */
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

      /* P5-IMAGE-VARIANT-1: 이미지 aiVariant 읽기/표시(생성 없음·원본 불변) — viewer-render.js 이미지 사이트에서 사용 */
      _loadFirebaseImageVariants:    _loadFirebaseImageVariants,
      _preloadFirebaseImageVariants: _preloadFirebaseImageVariants,
      reinitForCurrentTeam:          _reinitForCurrentTeam,     /* SHELF-STALE-FIX: 책장 책 전환 시 팀별 토글/변형 재초기화 */
      _getDisplayImageSrc:           _getDisplayImageSrc,
      _getAiImageViewMode:           _getAiImageViewMode,
      _setAiImageViewMode:           _setAiImageViewMode,
      _showAiImageToggleBar:         _showAiImageToggleBar,
      _hasImageVariantS1:            _hasImageVariantS1,
      _hasImageVariantS2:            _hasImageVariantS2,

      /* P5-IMAGE-POLICY-1: 작품 단위 이미지 입력 방식(upload/draw) 선택·저장 helper.
         생성 단계(imageS1)에서 호출 예정 — 이번 단계는 어떤 UI와도 연결 안 함(준비만). */
      getImagePolicy:                _getImagePolicy,
      loadImagePolicy:               _loadImagePolicy,
      saveImagePolicy:               _saveImagePolicy,
      ensureImagePolicyBeforeImageAi: _ensureImagePolicyBeforeImageAi,
      _preCheckSourceMode:           _preCheckSourceMode,      /* S2-2A-FIX1: 저장 전 사전 게이트 */
      clearImagesAndSwitchSourceMode: _clearImagesAndSwitchSourceMode,  /* SOURCE-MODE-SWITCH: 학생 자가 방식 바꾸기 */
      _commitImageSourceMode:        _commitImageSourceMode,   /* S2-2A-FIX1: 업로드 후 lock 확정(성공 시에만 scene 기록) */
      _deleteImageStorage:           _deleteImageStorage,      /* S2-2A-FIX2: flush 실패 시 신규 객체 cleanup(prefix 검증) */
      _openImageSourceModal:         _openImageSourceModal,

      /* P5-IMAGE-CLIENT-1: 이미지 AI 진입(AI 그림 정돈) — server skeleton 연결. 생성 없음. */
      _showImageAiEntryButton:       _showImageAiEntryButton,
      _hideImageAiEntryButton:       _hideImageAiEntryButton,
      _runImageAiS1Entry:            _runImageAiS1Entry,
      _imageAiNoticeForResponse:     _imageAiNoticeForResponse,
      _imageAiNoticeForError:        _imageAiNoticeForError,

      /* Phase 4-C: variant body 편집 저장 — render 게이트 + edit 입력 라우팅 */
      _aiVariantBodyEditAllowed:    _aiVariantBodyEditAllowed,
      _queueVariantBodySave:        _queueVariantBodySave,
      _flushVariantBodySave:        _flushVariantBodySave,

      /* Phase 4-D-1: variant layout(글상자) 편집 저장 — render 변형 박스 + edit 드래그 라우팅 */
      _getDisplayLayout:            _getDisplayLayout,
      _aiVariantLayoutEditAllowed:  _aiVariantLayoutEditAllowed,
      _queueVariantLayoutSave:      _queueVariantLayoutSave,
      _flushVariantLayoutSave:      _flushVariantLayoutSave,

      /* Phase 4-D-2A: variant style(글자 스타일) 저장/표시 기반 — render 표시 fallback + 저장 큐(UI는 P4-D-2B) */
      _getDisplayStyle:             _getDisplayStyle,
      _aiVariantStyleEditAllowed:   _aiVariantStyleEditAllowed,
      _queueVariantStyleSave:       _queueVariantStyleSave,
      _flushVariantStyleSave:       _flushVariantStyleSave,

      /* Phase 4-D-2B: variant 보기에서 글자 스타일 섹션만 선택적 잠금/해제 — viewer-edit renderEditPanel에서 재적용 */
      _applyVariantEditPanelLock:   _applyVariantEditPanelLock,

      /* P4-D-2B-FIX: 글자 크기만 variant 편집 허용 게이트(후보 무관) + 안내 토스트 노출 */
      _aiVariantFontSizeEditAllowed: _aiVariantFontSizeEditAllowed,
      _showVariantSaveStatus:        _showVariantSaveStatus,
    };

    /* ────────────────────────────────────────────────────────────
       reset 4가지 — 콘솔에서 호출하는 함수 (사용자 결정 #B)
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
