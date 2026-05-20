/* ====================================================================
   viewer-ai.js — Phase 0.5 mock — 가지(branch) AI 기능 진입 인프라
   --------------------------------------------------------------------
   v138까지의 코드 + AI_MASTER_PLAN_CLAUDE_v3 + AI_PHASE_0_5_MOCK_SPEC 기준.

   ⚠️ 이 파일은 mock 단계입니다 — 절대 박지 X:
   - 실 Anthropic / OpenAI / Gemini API 호출
   - 실 API key
   - 실 비용 발생 가능 작업
   - 실 학생 데이터 사용
   - Firebase Blaze 전제 작업
   - prompt 전문 작성

   Phase 0.5 진행 단계:
   - step1: 진입 인프라 + viewer 상단 [🤖 AI 작품 다듬기] 버튼  ✓
   - step2: 모드 선택 모달 + 첫 안내 모달 + 실행 조건 검사   ← (지금)
   - step3: mock 호출 + 비교 모달 + 선택 적용 (_rtSaveBody 재사용)
   - step4: 작품 검사 mock + quota mock 표시
   - step5: 10개 시나리오 점검 + 통합 commit

   v138 기존 기능 (분할형/그림 중심형/본문 카드 톤/행동버튼/감상)는
   절대 건드리지 X. 이 파일은 추가 기능만 박음.
   ==================================================================== */

(function () {
  'use strict';

  /* ────────────────────────────────────────────────────────────────
     Phase 정보 (사용자/디버깅 식별용)
     ──────────────────────────────────────────────────────────────── */
  const PHASE = 'phase-0.5-step2';
  const MOCK_ONLY = true;   /* 실 API 박지 X — 절대 변경 금지 (다음 step에서 사용자 명시 박힐 때 변경) */

  /* localStorage 키 — 첫 안내 모달 다시 안 박을 거 */
  const LS_ONBOARDING_KEY = 'pb_ai_onboarding_shown_v1';

  /* ────────────────────────────────────────────────────────────────
     실행 조건 검사 — v138 ViewerState.scenes 기반
     (AI_MASTER_PLAN_CLAUDE_v3 6-3 명시)
     ──────────────────────────────────────────────────────────────── */
  function _countScenesWithBody() {
    if (typeof ViewerState === 'undefined' || !ViewerState.scenes) return 0;
    let count = 0;
    Object.values(ViewerState.scenes).forEach(s => {
      if (!s) return;
      /* 본문 비어있지 X 박힌 장면만 카운트. 표지(cover) 제외 */
      if (s.type === 'cover') return;
      const body = String(s.body || '').trim();
      if (body.length > 0) count++;
    });
    return count;
  }

  function _countConnections() {
    /* 연결 = 다른 장면으로 가는 선택지 박힌 거. 2단계 실행 조건. */
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

  /* 모드별 실행 가능 여부 + 비활성 사유 박음 */
  function _getModeAvailability() {
    const bodyCount = _countScenesWithBody();
    const connCount = _countConnections();
    return {
      s1: {
        enabled: bodyCount >= 1,
        reason:  bodyCount < 1 ? '본문이 있는 장면이 1개 이상 필요해요' : '',
      },
      s2: {
        enabled: false,    /* Phase B에서 박을 거 — step2에선 disabled */
        reason:  'Phase B에서 박을 거 (mock 단계 외)',
      },
      s3: {
        enabled: false,    /* Phase C에서 박을 거 — 2단계 결과 필요 */
        reason:  '2단계 결과가 박혀있어야 박을 수 있어요 (Phase C)',
      },
      check: {
        enabled: bodyCount >= 2,
        reason:  bodyCount < 2 ? '본문이 있는 장면이 2개 이상 필요해요' : '',
      },
    };
  }

  /* ────────────────────────────────────────────────────────────────
     모달 인프라 — overlay + 박스 + 닫기 (ESC / overlay 클릭 / [닫기] 버튼)
     ──────────────────────────────────────────────────────────────── */
  function _createModalRoot(id, contentHtml) {
    /* 기존 모달 박혀있으면 먼저 제거 */
    _removeModalRoot(id);

    const root = document.createElement('div');
    root.id = id;
    root.className = 'ai-modal-overlay';
    root.innerHTML = `
      <div class="ai-modal" role="dialog" aria-modal="true">
        ${contentHtml}
      </div>
    `;
    document.body.appendChild(root);

    /* overlay 클릭 (단 모달 박스 내부 클릭은 X) */
    root.addEventListener('click', (e) => {
      if (e.target === root) _removeModalRoot(id);
    });

    /* ESC 키 */
    const onKey = (e) => {
      if (e.key === 'Escape') {
        _removeModalRoot(id);
        document.removeEventListener('keydown', onKey);
      }
    };
    document.addEventListener('keydown', onKey);

    return root;
  }

  function _removeModalRoot(id) {
    const old = document.getElementById(id);
    if (old) old.remove();
  }

  /* ────────────────────────────────────────────────────────────────
     첫 안내 모달 — 처음 박을 때 한 번
     (AI_MASTER_PLAN_CLAUDE_v3 6-4 명시 문구)
     ──────────────────────────────────────────────────────────────── */
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
        try { localStorage.setItem(LS_ONBOARDING_KEY, '1'); } catch (e) { /* noop */ }
      }
      _removeModalRoot('ai-onboarding-modal');
      if (typeof onConfirm === 'function') onConfirm();
    });
  }

  function _hasSeenOnboarding() {
    try {
      return localStorage.getItem(LS_ONBOARDING_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  /* ────────────────────────────────────────────────────────────────
     모드 선택 모달
     (AI_MASTER_PLAN_CLAUDE_v3 6-5)
     ──────────────────────────────────────────────────────────────── */
  function _renderModeCard(opts) {
    /* opts: { key, icon, title, desc, enabled, disabledReason, remaining } */
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
            desc: '맞춤법·유기성·캐릭터 일관성 진단 (수정 X)',
            enabled: a.check.enabled,
            disabledReason: a.check.reason,
            remaining: 5,
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

    /* 닫기 버튼 */
    root.querySelector('.js-ai-modal-close').addEventListener('click', () => {
      _removeModalRoot('ai-mode-modal');
    });

    /* 모드 카드 클릭 — step2엔 다음 step 안내만 */
    root.querySelectorAll('.ai-mode-card:not(.ai-mode-card--disabled)').forEach(card => {
      card.addEventListener('click', () => {
        const mode = card.getAttribute('data-ai-mode');
        const modeName = card.querySelector('.ai-mode-card__title').textContent;
        alert(
          `[${modeName}] 박혔어요.\n\n` +
          'step2: 모드 선택 모달까지 박음.\n\n' +
          '다음 step3에서 박을 거:\n' +
          '· 작품 전체 snapshot 생성\n' +
          '· mock 호출 (외부 API X)\n' +
          '· 비교 모달 (장면 목록 + skip + 체크박스)\n' +
          '· _rtSaveBody 재사용해 선택 적용\n' +
          '· ai-suggestions / ai-history mock 저장'
        );
      });
    });
  }

  /* ────────────────────────────────────────────────────────────────
     openModal — viewer 상단 [🤖 AI 작품 다듬기] 진입점
     - 첫 사용자: onboarding → 모드 모달
     - 그 외: 바로 모드 모달
     ──────────────────────────────────────────────────────────────── */
  function openModal() {
    if (!_hasSeenOnboarding()) {
      _showOnboardingModal(_showModeModal);
    } else {
      _showModeModal();
    }
  }

  /* ────────────────────────────────────────────────────────────────
     window 노출 — viewer-edit.js의 _bindHudEditActions에서 호출
     ──────────────────────────────────────────────────────────────── */
  if (typeof window !== 'undefined') {
    window.viewerAi = {
      PHASE:      PHASE,
      MOCK_ONLY:  MOCK_ONLY,
      openModal:  openModal,
      /* 디버깅 / 테스트용 (사용자가 onboarding 다시 보고 싶을 때) */
      _resetOnboarding: function () {
        try { localStorage.removeItem(LS_ONBOARDING_KEY); } catch (e) { /* noop */ }
      },
    };
  }
})();
