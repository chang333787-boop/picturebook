/* thought-compass-controller.js — 게이트 활성화 상태머신 + 브라우저 오케스트레이션.
   · resolveControllerState(input) = 순수 함수(DOM/RTDB 비의존) → 하니스로 검증.
   · activateForNewProject / activateForExistingEntry = 브라우저 전용(Store·Gate·DOM 사용).
   정본 결정/문구는 thought-compass.js(ThoughtCompass). 질문 UI는 Phase E(ThoughtCompassUI). */
;(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ThoughtCompassController = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const STATES = {
    LOADING: 'loading',
    REQUIRED_NOT_STARTED: 'requiredNotStarted',
    REQUIRED_IN_PROGRESS: 'requiredInProgress',
    OPTIONAL_NOT_STARTED: 'optionalNotStarted',
    COMPLETED: 'completed',
    ERROR: 'error',
    NOT_APPLICABLE: 'notApplicable',   /* movie/experience */
  };

  /* ── 순수 상태머신 ──
     입력(모두 primitive, TC/DB 비의존):
       loading        : 로드 진행 중
       loadError      : state 로드 실패
       mode           : 'required' | 'optional' | 'none'  (TC.resolveThoughtCompassMode 결과)
       status         : 'notStarted' | 'inProgress' | 'completed'  (정규화된 compass status)
       hasCompletedAt : completedAt 존재(완료 진위)
       requiredHint   : 호출자가 아는 required 컨텍스트(신규작품/복사본) — loadError 시 fail-closed 판정
     반환: { state, blocked, showGate, gateAction, showOptionalButton, optionalAction, retry } */
  function resolveControllerState(input) {
    input = input || {};
    if (input.loading === true) {
      return { state: STATES.LOADING, blocked: true, showGate: false, showOptionalButton: false };
    }
    if (input.loadError === true) {
      const failClosed = (input.mode === 'required') || input.requiredHint === true;
      /* fail-closed: required면 차단+재시도. completed로 간주 금지. optional이면 비차단(이번 세션 진입 버튼만 생략). */
      return { state: STATES.ERROR, blocked: failClosed, retry: true, showGate: false, showOptionalButton: false };
    }
    if (input.mode === 'none') {
      return { state: STATES.NOT_APPLICABLE, blocked: false, showGate: false, showOptionalButton: false };
    }
    if (input.status === 'completed' && input.hasCompletedAt === true) {
      return { state: STATES.COMPLETED, blocked: false, showGate: false, showOptionalButton: true, optionalAction: 'review' };
    }
    if (input.status === 'inProgress') {
      /* 시작했으면 mode 무관 완료까지 차단(STATE-03). */
      return { state: STATES.REQUIRED_IN_PROGRESS, blocked: true, showGate: true, gateAction: 'resume', showOptionalButton: false };
    }
    /* notStarted */
    if (input.mode === 'required') {
      return { state: STATES.REQUIRED_NOT_STARTED, blocked: true, showGate: true, gateAction: 'start', showOptionalButton: false };
    }
    return { state: STATES.OPTIONAL_NOT_STARTED, blocked: false, showGate: false, showOptionalButton: true, optionalAction: 'start' };
  }

  /* ── 브라우저 오케스트레이션 (Node에서는 미사용) ── */
  function _hasBrowser() { return typeof window !== 'undefined' && typeof document !== 'undefined'; }
  function _TC() { return _hasBrowser() ? window.ThoughtCompass : null; }
  function _Store() { return _hasBrowser() ? window.ThoughtCompassStore : null; }
  function _Gate() { return _hasBrowser() ? window.ThoughtCompassGate : null; }
  function _UI() { return _hasBrowser() ? window.ThoughtCompassUI : null; }

  let _retryOverlay = null;
  function _removeRetry() { if (_retryOverlay && _retryOverlay.parentNode) _retryOverlay.parentNode.removeChild(_retryOverlay); _retryOverlay = null; }

  /* fail-closed 재시도 화면(required state 로드 실패). */
  function _showRetry(onRetry) {
    _removeRetry();
    const ov = document.createElement('div');
    ov.id = 'thought-compass-retry';
    ov.setAttribute('role', 'alertdialog');
    ov.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(40,32,20,.55);';
    const card = document.createElement('div');
    card.style.cssText = 'max-width:380px;width:calc(100% - 32px);background:#fffdf8;border-radius:16px;padding:26px 22px;text-align:center;box-shadow:0 12px 40px rgba(60,40,10,.25);';
    const t = document.createElement('div'); t.textContent = '잠깐 불러오지 못했어요'; t.style.cssText = 'font-size:18px;font-weight:800;color:#3a2c14;margin-bottom:8px;';
    const p = document.createElement('p'); p.textContent = '생각 나침반 정보를 불러오는 중 문제가 생겼어요. 다시 시도해 주세요.'; p.style.cssText = 'font-size:14px;color:#6b5638;margin:0 0 18px;';
    const btn = document.createElement('button'); btn.textContent = '다시 시도'; btn.style.cssText = 'padding:11px 26px;border:none;border-radius:50px;background:#7aa06a;color:#fff;font-size:15px;font-weight:700;cursor:pointer;';
    btn.addEventListener('click', function () { _removeRetry(); if (onRetry) onRetry(); });
    card.appendChild(t); card.appendChild(p); card.appendChild(btn); ov.appendChild(card);
    document.body.appendChild(ov);
    _retryOverlay = ov;
  }

  /* 로딩 락(신규 작품 전용) — activateForNewProject가 onboardingVersion write + state load(RTDB 왕복)하는
     동안 maker가 노출/조작되는 창을 동기 오버레이로 차단(HIGH-2). _applyControllerState가 결정 시 제거. */
  let _loadingOverlay = null;
  function _showLoadingLock() {
    if (!_hasBrowser() || _loadingOverlay) return;
    const ov = document.createElement('div');
    ov.id = 'thought-compass-loading';
    ov.setAttribute('role', 'status'); ov.setAttribute('aria-label', '생각 나침반을 준비하고 있어요');
    ov.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(40,32,20,.55);';
    const p = document.createElement('div');
    p.textContent = '잠깐만요…';
    p.style.cssText = 'background:#fffdf8;border-radius:14px;padding:16px 22px;font-size:15px;color:#6b5638;box-shadow:0 10px 30px rgba(60,40,10,.25);';
    ov.appendChild(p); document.body.appendChild(ov); _loadingOverlay = ov;
  }
  function _removeLoadingLock() { if (_loadingOverlay && _loadingOverlay.parentNode) _loadingOverlay.parentNode.removeChild(_loadingOverlay); _loadingOverlay = null; }

  /* 게이트 시작/이어서 콜백 — markStarted 후 질문 UI(Phase E) 오픈. UI 미로드면 게이트 스켈레톤 유지. */
  function _defaultGateCallbacks(ctx, normalizedState) {
    const Store = _Store(), Gate = _Gate(), UI = _UI();
    async function _begin(action) {
      /* LEVELS(2026-07-19): 그림책 1단계 신규=easy·2단계 신규=linear(4)로 시작.
         EASY-MUSTINC(2026-07-20): 1단계 신규는 easy2(5 = easy 8문항 + '꼭 넣고 싶은 것').
         진행/완료 데이터는 planMarkStarted가 저장 버전을 유지(구 v3 진행 세션은 v3 그대로). */
      let _qv;
      if (ctx && ctx.projectType === 'picturebook'
          && typeof window !== 'undefined' && typeof window.getPicturebookLevel === 'function') {
        const _lv = window.getPicturebookLevel();
        if (_lv === 1) _qv = 5;
        else if (_lv === 2) _qv = 4;
      }
      try { if (Store) await Store.markThoughtCompassStarted(ctx, normalizedState, _qv); } catch (e) { /* 진행은 UI에서 재시도 */ }
      if (UI && typeof UI.open === 'function') {
        if (Gate) Gate.closeGate();
        UI.open(ctx, { action: action });
      }
      /* UI 미로드(Phase E 이전): 게이트 shell이 스켈레톤으로 남아있음 = 다음 단계 자리표시. */
    }
    return {
      onStart: function () { _begin('start'); },
      onResume: function () { _begin('resume'); },
      onDismiss: function () { /* optional '나중에' — 게이트 닫힘(maybeBlock이 처리) */ },
    };
  }

  function _applyControllerState(cs, ctx, normalizedState) {
    const Gate = _Gate();
    _removeLoadingLock();   /* 결정됨 → 로딩 락 제거(게이트/재시도/통과가 대체) */
    if (cs.state === STATES.ERROR && cs.blocked) {
      _showRetry(function () { _enterGateFlow(ctx, { requiredHint: true }); });
      return cs;
    }
    if (cs.showGate && Gate && typeof Gate.maybeBlock === 'function') {
      Gate.maybeBlock(Object.assign({}, ctx, { compassState: normalizedState }), _defaultGateCallbacks(ctx, normalizedState));
      return cs;
    }
    if (cs.showOptionalButton) {
      _renderOptionalEntry(ctx, normalizedState, cs.optionalAction);
      return cs;
    }
    /* NOT_APPLICABLE / COMPLETED(버튼 없이) → maker 그대로 진행 */
    return cs;
  }

  /* optional 진입 버튼(기존 작품) — 상단 메뉴 placeholder 컨테이너에 부착(있으면). 실제 배치는 Phase E/L. */
  function _renderOptionalEntry(ctx, normalizedState, action) {
    if (!_hasBrowser()) return;
    const TC = _TC();
    const desc = TC && typeof TC.describeOptionalEntryButton === 'function'
      ? TC.describeOptionalEntryButton(Object.assign({}, ctx, { compassState: normalizedState }))
      : { show: false };
    if (!desc.show) return;
    const host = document.getElementById('tc-optional-entry-host');
    if (!host) return;   /* Phase E/L에서 호스트 제공 전까지 no-op(안전) */
    host.innerHTML = '';
    const btn = document.createElement('button');
    btn.className = 'tc-optional-entry-btn';
    btn.textContent = '🧭 ' + desc.label;
    btn.addEventListener('click', function () {
      const Gate = _Gate();
      /* 완료본 다시 보기(read-only) — Phase L */
      if (desc.action === 'review' && window.ThoughtCompassReview && typeof window.ThoughtCompassReview.openReadOnly === 'function') {
        window.ThoughtCompassReview.openReadOnly(ctx); return;
      }
      /* 시작/이어서 — 게이트 흐름 */
      if (Gate) Gate.maybeBlock(Object.assign({}, ctx, { compassState: normalizedState }), _defaultGateCallbacks(ctx, normalizedState));
    });
    host.appendChild(btn);
  }

  /* 공통 진입 흐름 — load(에러인지) → mode/status 계산 → 상태머신 → 적용. */
  async function _enterGateFlow(ctx, opts) {
    opts = opts || {};
    const TC = _TC(), Store = _Store();
    if (!TC || !Store) return { state: STATES.NOT_APPLICABLE, blocked: false };   /* foundation 미로드 → 안전 비차단 */
    let load;
    try { load = await Store.loadThoughtCompassStateResult(ctx); }
    catch (e) { load = { ok: false, raw: null, onboardingVersion: null }; }
    /* copiedFrom은 RTDB(viewer-meta)에서 로드 — 복사본 required 판정(PRE-02). ctx 우선. */
    const copiedFrom = ctx.copiedFrom || load.copiedFrom || null;
    const mode = TC.resolveThoughtCompassMode({ projectType: ctx.projectType, onboardingVersion: load.onboardingVersion, copiedFrom: copiedFrom });
    const st = TC.normalizeThoughtCompassState(load.raw);
    st.mode = mode;
    /* ★ describeGate/describeOptionalEntryButton가 mode를 재계산하므로, 로드한 onboardingVersion·copiedFrom을
       ctx에 실어 넘긴다(없으면 maybeBlock이 optional로 오판해 게이트가 안 뜨는 버그). */
    const ectx = Object.assign({}, ctx, { onboardingVersion: load.onboardingVersion, copiedFrom: copiedFrom });
    const cs = resolveControllerState({
      loadError: !load.ok,
      mode: mode,
      status: st.status,
      hasCompletedAt: typeof st.completedAt === 'number',
      requiredHint: opts.requiredHint === true || !!copiedFrom,
    });
    return _applyControllerState(cs, ectx, st);
  }

  /* 신규 작품(pb/text) — onboardingVersion:1 부여(required 트리거) 후 게이트. starter 장면 생성은 완료(Phase J)로 미룸. */
  async function activateForNewProject(ctx) {
    const Store = _Store();
    if (!Store) return { activated: false };
    _showLoadingLock();   /* HIGH-2: write+load(RTDB 왕복) 동안 maker 노출/조작 차단(동기). 결정 시 _applyControllerState가 제거. */
    try { await Store.markOnboardingRequired(ctx); } catch (e) { /* write 실패해도 requiredHint로 fail-closed */ }
    const cs = await _enterGateFlow(ctx, { requiredHint: true });
    _removeLoadingLock();   /* 방어: foundation 미로드 early-return 등 _applyControllerState 미경유 경로 대비(멱등) */
    return { activated: !!(cs && cs.blocked), state: cs && cs.state };
  }

  /* 기존 작품 재진입 — in_progress면 게이트(이어서), 미시작 optional이면 진입 버튼, 완료/none이면 통과. */
  async function activateForExistingEntry(ctx) {
    const cs = await _enterGateFlow(ctx, { requiredHint: false });
    return { activated: !!(cs && cs.blocked), state: cs && cs.state };
  }

  return {
    STATES,
    resolveControllerState,
    activateForNewProject,
    activateForExistingEntry,
    _enterGateFlow,   /* 재시도/내부용 */
  };
});
