/* ====================================================================
   viewer-ai.js — Phase 0.5 mock — 가지(branch) AI 기능
   --------------------------------------------------------------------
   v138까지의 코드 + AI_MASTER_PLAN_CLAUDE_v3 + AI_PHASE_0_5_MOCK_SPEC + AI_POLICY_V140 기준.

   ⚠️ 이 파일은 mock 단계입니다 — 절대 박지 X:
   - 실 Anthropic / OpenAI / Gemini API 호출
   - 실 API key
   - 실 비용 발생 가능 작업
   - 실 학생 데이터 사용
   - Firebase Blaze 전제 작업
   - prompt 전문 작성

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
     진입 조건 (사용자 결정 #A):
     - URL ?test=1
     - localhost / 127.0.0.1 (개발 환경 자동)

     ⚠️ 실 API 호출에는 testMode 우회 절대 적용 X (Phase A 박힐 때 Functions 단에서 차단)
     이 모듈은 mock 전용이라 자유롭게 박음.
     ════════════════════════════════════════════════════════════════ */
  function _isTestMode() {
    try {
      const p = new URLSearchParams(location.search);
      /* 명시 우회: ?realApi=1 박혀있으면 localhost라도 실 API 박음 (사용자 명시 박힐 때) */
      if (p.get('realApi') === '1') return false;
      if (p.get('test') === '1') return true;
      const h = location.hostname;
      if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0') return true;
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
      throw new Error('Firebase Functions SDK 박지 X — viewer.html 박을 거');
    }
    const app = _getViewerFirebaseApp();
    if (!app) throw new Error('Firebase app 박지 X (viewer init 박지 X)');
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
    /* TEST MODE 박혀있으면 mock 박음 (단 ?realApi=1 박혀있으면 _isTestMode false 박힘) */
    if (_isTestMode()) return false;
    /* Firebase Functions SDK 박지 X 박혀있으면 mock fallback */
    if (typeof firebase === 'undefined' || !firebase.functions) return false;
    /* ?realApi=1 박혀있으면 — auth 박지 X 박혀있어도 true 박음 (호출 직전 anonymous 박음) */
    try {
      const p = new URLSearchParams(location.search);
      if (p.get('realApi') === '1') return true;
    } catch (e) { /* noop */ }
    /* 기본: auth 박혀있어야 박음 */
    try {
      if (!firebase.auth().currentUser) return false;
    } catch (e) { return false; }
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
        classId = String(ViewerState.classId || '');
        teamName = String(ViewerState.teamName || '');
      }
      const p = new URLSearchParams(location.search);
      if (!classId && p.get('classId')) classId = p.get('classId');
      if (!teamName && p.get('team')) teamName = p.get('team');
    } catch (e) { /* noop */ }
    return { classId, teamName };
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
      alert('1단계 박을 본문 박은 장면 박혀있지 X.');
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
      alert(prefix + ' 후보 생성 실패: ' + (e && e.message || e) + '\n\n콘솔 박아 stack 박음.');
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
      +     '<h3>1단계 테스트 횟수 박혀있지 X</h3>'
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
        alert('현재 팀 quota 초기화 박음 (' + ns + '). 다시 [1단계 정돈] 박음.');
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
      alert('후보 박혀있지 X.');
      return;
    }

    const remaining = _getRemaining('s1');
    const status = _getAiTextS1Status();
    const drafting = (status === 'drafting');
    const selected = (d.textS1 && d.textS1.selectedAttempt) || null;

    const tabsHtml = attempts.map(function (n) {
      const active = (n === (selected || attempts[attempts.length - 1])) ? ' is-active' : '';
      return '<button type="button" class="ai-cand-tab' + active + '" data-attempt="' + n + '">' + n + '회차</button>';
    }).join('');

    const moreBtn = (remaining > 0 && !drafting)
      ? '<button type="button" class="ai-btn ai-btn--ghost js-ai-cand-more">[더 생성하기 (남은 ' + remaining + '회)]</button>'
      : '<span class="ai-cand-quota-empty">' + (drafting ? '편집 중에는 추가 생성 X' : 'quota 박혀있지 X') + '</span>';

    const draftingNote = drafting
      ? '<div class="ai-cand-drafting-note">⚠️ AI 1단계 편집 중입니다. 먼저 저장/마감하거나 취소해주세요.</div>'
      : '';

    const inner = ''
      + '<div class="ai-cand-modal">'
      +   '<div class="ai-cand-modal__head">'
      +     '<h3>AI 1단계 후보 (mock)</h3>'
      +     '<button type="button" class="ai-modal-close js-ai-cand-close" aria-label="닫기">×</button>'
      +   '</div>'
      +   draftingNote
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
      if (!c) { body.innerHTML = '<div class="ai-cand-empty">후보 박혀있지 X</div>'; return; }
      const snapshot = _buildWorkSnapshot();
      /* fix 2026-05-21: snapshot은 {sceneId: scene} 객체. Object.values 박음. */
      const scenes = Object.values(snapshot || {});
      const rows = scenes.map(function (s) {
        const r = (c.results[s.id] || c.results["scene_" + s.id]);
        if (!r) return '<div class="ai-cand-row ai-cand-row--none"><div class="ai-cand-scene-id">장면 ' + _escapeHtml(s.id) + '</div><div class="ai-cand-skip">(결과 없음)</div></div>';
        if (r.skip) return '<div class="ai-cand-row ai-cand-row--skip"><div class="ai-cand-scene-id">장면 ' + _escapeHtml(s.id) + '</div><div class="ai-cand-skip">skip — ' + _escapeHtml(r.reason || '') + '</div></div>';
        return ''
          + '<div class="ai-cand-row">'
          +   '<div class="ai-cand-scene-id">장면 ' + _escapeHtml(s.id) + '</div>'
          +   '<div class="ai-cand-split">'
          +     '<div class="ai-cand-col"><div class="ai-cand-col-label">원본</div><div class="ai-cand-col-text">' + _escapeHtml(s.body || '') + '</div></div>'
          +     '<div class="ai-cand-col"><div class="ai-cand-col-label">후보 ' + activeAttempt + '회차</div><div class="ai-cand-col-text ai-cand-col-text--ai">' + _escapeHtml(r.revisedText || '') + '</div></div>'
          +   '</div>'
          +   (r.summary ? '<div class="ai-cand-summary">' + _escapeHtml(r.summary) + '</div>' : '')
          + '</div>';
      }).join('');
      body.innerHTML = rows || '<div class="ai-cand-empty">박혀있지 X</div>';
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

  function _isS1Finalized() {
    const v = _loadAiVariants();
    return !!(v.textS1 && v.textS1.status === 'finalized');
  }

  function _getS1FinalBody(sceneId) {
    const v = _loadAiVariants();
    if (!v.textS1 || v.textS1.status !== 'finalized') return null;
    const f = v.textS1.final && v.textS1.final[sceneId];
    return f ? f.body : null;
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
      alert('편집 중 상태 박혀있지 X');
      return;
    }
    const attemptN = d.textS1.selectedAttempt;
    const cand = d.textS1.candidates && d.textS1.candidates['attempt' + attemptN];
    if (!cand) {
      alert('선택된 후보 박혀있지 X');
      return;
    }

    const snapshot = _buildWorkSnapshot();
    const edited = d.textS1.editedDraftByScene || {};

    /* fix 2026-05-21: snapshot은 {sceneId: scene} 객체. Object.values 박음. */
    const rows = Object.values(snapshot || {}).map(function (s) {
      const r = (cand.results[s.id] || cand.results["scene_" + s.id]);
      if (!r) {
        return ''
          + '<div class="ai-draft-row ai-draft-row--none">'
          +   '<div class="ai-draft-scene-id">장면 ' + _escapeHtml(s.id) + '</div>'
          +   '<div class="ai-draft-skip">(결과 박혀있지 X — 원본 박힘)</div>'
          + '</div>';
      }
      if (r.skip) {
        return ''
          + '<div class="ai-draft-row ai-draft-row--skip">'
          +   '<div class="ai-draft-scene-id">장면 ' + _escapeHtml(s.id) + '</div>'
          +   '<div class="ai-draft-skip">skip — 원본 박힘 (' + _escapeHtml(r.reason || '') + ')</div>'
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
        +     '<textarea class="ai-draft-textarea js-ai-draft-textarea" data-scene-id="' + _escapeHtml(s.id) + '" rows="3">' + _escapeHtml(initialText) + '</textarea>'
        +   '</div>'
        + '</div>';
    }).join('');

    const inner = ''
      + '<div class="ai-draft-modal">'
      +   '<div class="ai-draft-modal__head">'
      +     '<h3>AI 1단계 편집 중 — ' + attemptN + '회차 (mock)</h3>'
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
      if (!confirm('편집 박은 거 박지 X 박힐 거. 취소 박을지?')) return;
      _cancelDrafting();
      _removeModalRoot('ai-draft-modal-root');
    });

    root.querySelector('.js-ai-draft-finalize').addEventListener('click', function () {
      _finalizeAiVariant();
      _removeModalRoot('ai-draft-modal-root');
      alert('AI 1단계 마감 박힘. viewer 상단 [원본] [AI 1단계] 토글 박힐 거 (v140-step4 박을 때 박힘).');
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
    /* v140 fix 2026-05-21: 팀별 namespace 박음 */
    try {
      const v = localStorage.getItem(_getMockViewModeKey());
      return (v === 'aiS1') ? 'aiS1' : 'original';
    } catch (e) { return 'original'; }
  }

  function _setAiViewMode(mode) {
    try {
      if (mode === 'aiS1') localStorage.setItem(_getMockViewModeKey(), 'aiS1');
      else localStorage.removeItem(_getMockViewModeKey());
    } catch (e) { /* noop */ }
    _updateAiToggleBar();
    /* viewer 본문 박은 거 박은 거 박은 거 박은 거 — v138 박은 _scheduleViewerFrameReRender 박은 거 박음 */
    if (typeof window._scheduleViewerFrameReRender === 'function') {
      window._scheduleViewerFrameReRender();
    } else if (typeof _scheduleViewerFrameReRender === 'function') {
      _scheduleViewerFrameReRender();
    }
  }

  /* viewer-render.js 박은 거 박은 거 박은 본문 박은 거 박은 거 박은 거 박은 — 토글 mode에 따라 박은 거 박음 */
  function _getDisplayBody(sceneId, originalBody) {
    if (_getAiViewMode() !== 'aiS1') return originalBody;
    const v = _loadAiVariants();
    if (!v.textS1 || v.textS1.status !== 'finalized') return originalBody;
    const f = v.textS1.final && v.textS1.final[sceneId];
    if (!f || typeof f.body !== 'string') return originalBody;
    return f.body;
  }

  function _showAiToggleBar() {
    /* finalized 박혀있을 때만 박음 */
    if (!_isS1Finalized()) {
      _hideAiToggleBar();
      return;
    }
    /* edit mode 박을 때만 박음 (감상 모드 박지 X) */
    const isEdit = (typeof ViewerState !== 'undefined') && ViewerState.editMode;
    if (!isEdit) {
      _hideAiToggleBar();
      return;
    }

    let bar = document.getElementById('ai-view-toggle-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'ai-view-toggle-bar';
      bar.className = 'ai-view-toggle-bar';
      bar.innerHTML = ''
        + '<span class="ai-view-toggle-bar__label">보기 모드:</span>'
        + '<button type="button" class="ai-view-toggle-btn js-ai-view-original" data-mode="original">원본</button>'
        + '<button type="button" class="ai-view-toggle-btn js-ai-view-ais1" data-mode="aiS1">AI 1단계</button>';
      document.body.appendChild(bar);
      bar.querySelectorAll('.ai-view-toggle-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          _setAiViewMode(btn.getAttribute('data-mode'));
        });
      });
    }
    _updateAiToggleBar();
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
      const r = (cand.results[s.id] || cand.results["scene_" + s.id]);
      if (!r || r.skip) return;  /* skip 박은 거 박은 거 박지 X — 원본 박힘 */
      const isEdited = (s.id in edited);
      const body = isEdited ? edited[s.id] : (r.revisedText || '');
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

    /* 사용자 결정 #C — 마감 후 aiDrafts 기본 정리. TEST MODE에서는 보존/초기화 선택 가능. */
    if (_isTestMode()) {
      const keep = confirm('[TEST MODE] aiDrafts 박은 거 박은 거 박을지?\n\nOK = 박음 (3 후보 + 편집 상태 확인 가능)\n취소 = 정리 (운영 박은 거)');
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
    return {
      s1: {
        enabled: bodyCount >= 1,
        reason:  bodyCount < 1 ? '본문이 있는 장면이 1개 이상 필요해요' : '',
      },
      s2: {
        enabled: false,
        reason:  'Phase B에서 박을 거 (mock 단계 외)',
      },
      s3: {
        enabled: false,
        reason:  '2단계 결과가 박혀있어야 박을 수 있어요 (Phase C)',
      },
      check: {
        enabled: bodyCount >= 2,
        reason:  bodyCount < 2 ? '본문이 있는 장면이 2개 이상 필요해요' : '',
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
          ⚠️ Phase 0.5 mock — 실제 AI는 박혀있지 X. 가짜 결과로 흐름만 확인해요.
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
        <div class="ai-modal__title">🤖 AI 작품 다듬기 <span class="ai-mock-badge ai-mock-badge--header">Phase 0.5 mock</span></div>
        <button class="ai-modal__close js-ai-modal-close" aria-label="닫기">✕</button>
      </div>
      <div class="ai-modal__body">
        <p class="ai-mode-intro">
          AI는 작품을 대신 만들지 않아요. 학생이 만든 작품을 읽고 더 자연스럽게 다듬을 후보를 보여줘요.
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
            desc: '맞춤법·표현 정돈 (안심하고 받을 수 있는 정돈)',
            enabled: a.s1.enabled && s1Remain > 0,
            disabledReason: s1Remain === 0 ? '이번 작품에서 사용할 수 있는 횟수를 모두 사용했어요' : a.s1.reason,
            remaining: realApi ? null : s1Remain,
          })}
          ${_renderModeCard({
            key: 'check',
            icon: '🔍',
            title: '작품 검사',
            desc: '맞춤법·유기성·캐릭터 일관성 진단 (수정 X)',
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
            desc: '장면 발전 + 작품 유기성',
            enabled: a.s2.enabled,
            disabledReason: a.s2.reason,
            remaining: null,
          })}
          ${_renderModeCard({
            key: 's3',
            icon: '🎯',
            title: '텍스트 3단계',
            desc: '교육적 후보 선택 (5개 시작 → 10개 확장)',
            enabled: a.s3.enabled,
            disabledReason: a.s3.reason,
            remaining: null,
          })}
        </div>
        <div class="ai-mode-footer">
          🎨 이미지 다듬기는 Phase D에서 박을 거예요.
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
      if (!confirm('현재 팀(' + _getCurrentNamespace() + ')의 mock quota·후보·결과 박은 거 박은 거 박은 박은 — 모두 박은 거 박은 거 박은 박은 박지 X 박을 거. 박을지?')) return;
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
            { type: 'mock_demo', description: 'MOCK 변경 — 실 AI 박지 X' },
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
      globalSummary: `MOCK: ${totalScenes}개 장면 중 ${revisedCount}개 다듬을 제안 박혔어요. (${skipCount}개 skip)`,
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
          30초~1분 정도 걸릴 수 있어요.<br/>
          <span class="ai-mock-badge">Phase 0.5 mock</span> 실 API 박지 X — 가짜 응답 (2~5초)
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
        note: 'MOCK 진단 — 실 AI 박지 X',
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
    _showCheckResultModal(result);
  }

  /* 검사 결과 모달 — 수정 X. 진단만. "장면 X로 이동" 버튼만 박음. */
  function _showCheckResultModal(check) {
    const cats = check.categories || {};
    const sections = [
      { key: 'spelling',             icon: '📝', title: '맞춤법',           items: cats.spelling || [] },
      { key: 'coherence',            icon: '🔗', title: '장면 간 유기성',    items: cats.coherence || [] },
      { key: 'characterConsistency', icon: '👤', title: '캐릭터 일관성',     items: cats.characterConsistency || [] },
      { key: 'branchFlow',           icon: '🌳', title: '분기 흐름',         items: cats.branchFlow || [] },
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
        <div class="ai-modal__title">🔍 작품 검사 결과 <span class="ai-mock-badge ai-mock-badge--header">Phase 0.5 mock</span></div>
        <button class="ai-modal__close js-ai-modal-close" aria-label="닫기">✕</button>
      </div>
      <div class="ai-modal__body">
        <div class="ai-check-intro">
          AI는 <b>문제만 알려드려요</b>. 수정은 안 해드려요. 학생이 직접 보고 본인이 고치는 기능이에요.
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

  function _renderCheckItem(catKey, item) {
    let text = '';
    let sceneId = '';
    if (catKey === 'spelling') {
      sceneId = item.sceneId || '';
      text = `장면 ${sceneId}: <b>${_escapeHtml(item.wrong || '')}</b> → ${_escapeHtml(item.correct || '')}`;
    } else if (catKey === 'coherence') {
      sceneId = item.sceneIdFrom || '';
      text = `장면 ${item.sceneIdFrom} → ${item.sceneIdTo}: ${_escapeHtml(item.issue || '')}`;
    } else if (catKey === 'characterConsistency') {
      sceneId = (item.scenes && item.scenes[0]) || '';
      text = `<b>${_escapeHtml(item.character || '')}</b> (장면 ${(item.scenes || []).join(', ')}): ${_escapeHtml(item.issue || '')}`;
    } else if (catKey === 'branchFlow') {
      sceneId = item.sceneId || '';
      text = sceneId ? `장면 ${sceneId}: ${_escapeHtml(item.issue || '')}` : _escapeHtml(item.issue || '');
    }
    const jumpHtml = sceneId
      ? `<button class="ai-check-item__jump js-ai-check-jump" data-scene-id="${sceneId}">장면 ${sceneId} 이동</button>`
      : '';
    return `
      <div class="ai-check-item">
        <div class="ai-check-item__text">${text}</div>
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
    msg += '\n\n⚠️ Phase 0.5 mock — 적용된 본문에 "※mock" 라벨 박힘. 다음 step에서 라벨 박지 X.';
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

  /* ════════════════════════════════════════════════════════════════
     openModal — viewer 상단 [🤖 AI 작품 다듬기] 진입점
     ════════════════════════════════════════════════════════════════ */
  function openModal() {
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
      _showAiToggleBar:   _showAiToggleBar,
      _isS1Finalized:     _isS1Finalized,
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
