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
  const PHASE = 'phase-0.5-v140-step1';
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
     v140-step1: reset 함수 4가지 (사용자 결정 #B)
     ──────────────────────────────────────────────────────────────
     기본 reset = quota만. drafts / variants는 별도 함수.
     window 노출 — 콘솔에서 박음.
     ⚠️ MOCK 전용 — 실 API에는 무효 (Phase A Functions 단에서 무시)
     ════════════════════════════════════════════════════════════════ */
  function _resetMockUsage(mode) {
    try {
      if (!mode) {
        localStorage.removeItem(LS_MOCK_USAGE_KEY);
      } else {
        const u = _safeParseJson(localStorage.getItem(LS_MOCK_USAGE_KEY)) || {};
        const key = mode + 'Used';
        if (key in u) u[key] = 0;
        localStorage.setItem(LS_MOCK_USAGE_KEY, JSON.stringify(u));
      }
      console.log('[ai-mock] usage reset', mode || '(all)');
    } catch (e) { console.warn('[ai-mock] usage reset failed', e); }
  }

  function _resetMockDrafts() {
    try {
      localStorage.removeItem(LS_AI_DRAFTS_KEY);
      console.log('[ai-mock] drafts reset');
    } catch (e) { console.warn('[ai-mock] drafts reset failed', e); }
  }

  function _resetMockVariants() {
    try {
      localStorage.removeItem(LS_AI_VARIANTS_KEY);
      localStorage.removeItem(LS_AI_VIEW_MODE_KEY);
      console.log('[ai-mock] variants reset');
    } catch (e) { console.warn('[ai-mock] variants reset failed', e); }
  }

  function _resetMockAll() {
    _resetMockUsage();
    _resetMockDrafts();
    _resetMockVariants();
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
          ${_renderModeCard({
            key: 's1',
            icon: '📝',
            title: '텍스트 1단계',
            desc: '맞춤법·표현 정돈 (안심하고 받을 수 있는 정돈)',
            enabled: a.s1.enabled && _getRemaining('s1') > 0,
            disabledReason: _getRemaining('s1') === 0 ? '이번 작품에서 사용할 수 있는 횟수를 모두 사용했어요' : a.s1.reason,
            remaining: _getRemaining('s1'),
          })}
          ${_renderModeCard({
            key: 'check',
            icon: '🔍',
            title: '작품 검사',
            desc: '맞춤법·유기성·캐릭터 일관성 진단 (수정 X)',
            enabled: a.check.enabled && _getRemaining('check') > 0,
            disabledReason: _getRemaining('check') === 0 ? '이번 작품에서 사용할 수 있는 횟수를 모두 사용했어요' : a.check.reason,
            remaining: _getRemaining('check'),
          })}
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
          _startTextS1();
        } else if (mode === 'check') {
          _startWorkCheck();
        }
      });
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
  function _loadMockUsage() {
    try {
      const raw = localStorage.getItem(LS_MOCK_USAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { s1Used: 0, s2Used: 0, s3Used: 0, checkUsed: 0, lastUsedAt: 0 };
  }
  function _saveMockUsage(usage) {
    try { localStorage.setItem(LS_MOCK_USAGE_KEY, JSON.stringify(usage)); } catch (e) {}
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
    try {
      result = await _mockCallWorkCheck(snapshot);
    } catch (e) {
      _hideCallingModal();
      if (e && e.message === 'cancelled') return;
      _refundQuota('check');
      alert('AI 검사 실패: ' + (e && e.message ? e.message : '알 수 없는 오류'));
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
    };

    /* ────────────────────────────────────────────────────────────
       reset 4가지 — 콘솔 박는 거 박은 함수 (사용자 결정 #B)
       window.__resetAiMockUsage()     — quota만 (기본)
       window.__resetAiMockDrafts()    — drafts만
       window.__resetAiMockVariants()  — variants만
       window.__resetAiMockAll()       — 위 셋 + store + 우회 토글
       ⚠️ MOCK 전용 — 실 API에는 무효
       ──────────────────────────────────────────────────────────── */
    window.__resetAiMockUsage    = _resetMockUsage;
    window.__resetAiMockDrafts   = _resetMockDrafts;
    window.__resetAiMockVariants = _resetMockVariants;
    window.__resetAiMockAll      = _resetMockAll;
  }
})();
