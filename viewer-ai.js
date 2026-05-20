/* ====================================================================
   viewer-ai.js — Phase 0.5 mock — 가지(branch) AI 기능
   --------------------------------------------------------------------
   v138까지의 코드 + AI_MASTER_PLAN_CLAUDE_v3 + AI_PHASE_0_5_MOCK_SPEC 기준.

   ⚠️ 이 파일은 mock 단계입니다 — 절대 박지 X:
   - 실 Anthropic / OpenAI / Gemini API 호출
   - 실 API key
   - 실 비용 발생 가능 작업
   - 실 학생 데이터 사용
   - Firebase Blaze 전제 작업
   - prompt 전문 작성

   Phase 0.5 진행:
   - step1: 진입 인프라 + 버튼  ✓
   - step2: 모드 선택 + 첫 안내 + 실행 조건  ✓
   - step3: mock 호출 + 비교 모달 + 선택 적용 (_rtSaveBody 재사용)  ← (지금)
   - step4: 작품 검사 mock + quota mock 표시
   - step5: 10개 시나리오 점검 + 통합 commit

   mock 저장 정책 (rules 9-6 "rules 변경 X" 정신):
   - ai-suggestions / ai-history는 Firebase rules에 박지 X 박혀있음
   - 따라서 mock은 localStorage에 박음 (또는 window 메모리)
   - 적용된 scene 본문만 Firebase scenes/{id}에 박음 (rules 허용)
   - 새로고침 후 mock suggestion은 사라지지만 적용 본문은 유지
     (mock 단계의 의도된 동작 — 실 단계엔 Firebase로)
   ==================================================================== */

(function () {
  'use strict';

  /* ────────────────────────────────────────────────────────────────
     Phase 정보 + 정책 상수
     ──────────────────────────────────────────────────────────────── */
  const PHASE = 'phase-0.5-step3';
  const MOCK_ONLY = true;
  const LS_ONBOARDING_KEY = 'pb_ai_onboarding_shown_v1';
  const LS_MOCK_STORE_KEY = 'pb_ai_mock_store_v1';

  /* mock 응답 지연 (사용자에게 호출 중 UI lock 보여주려고) */
  const MOCK_DELAY_MIN = 2000;
  const MOCK_DELAY_MAX = 5000;

  /* AbortController 대용 — 사용자가 호출 중 취소 박을 수 있게 */
  let _currentAbort = null;

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
            enabled: a.s1.enabled,
            disabledReason: a.s1.reason,
            remaining: 3,
          })}
          ${_renderModeCard({
            key: 'check',
            icon: '🔍',
            title: '작품 검사',
            desc: '맞춤법·유기성·캐릭터 일관성 진단 (수정 X) — step4 박을 거',
            enabled: false,
            disabledReason: 'step4에서 박을 거',
            remaining: null,
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

    /* AbortController 박음 */
    _currentAbort = { aborted: false };

    /* 호출 중 UI lock */
    _showCallingModal(sceneCount);

    let suggestion = null;
    try {
      suggestion = await _mockCallTextAiBatch(snapshot, 1);
    } catch (e) {
      _hideCallingModal();
      if (e && e.message === 'cancelled') {
        /* 사용자 취소 — 안내만 */
        return;
      }
      alert('AI 호출 실패: ' + (e && e.message ? e.message : '알 수 없는 오류'));
      return;
    }

    _hideCallingModal();
    _saveMockSuggestion(suggestion);
    _showComparisonModal(suggestion);
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
    };
  }
})();
