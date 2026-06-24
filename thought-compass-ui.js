/* thought-compass-ui.js — 한 화면 한 질문 DOM 렌더/이벤트(브라우저 전용).
   순수 흐름은 thought-compass-flow.js(ThoughtCompassFlow), 저장은 thought-compass-store.js.
   · 한 화면 한 질문 · 선택지 3 + 직접 적기 + 모르겠어요 · 이전/다음 · 진행률 · 답변 복원
   · 입력 매 키 저장 금지(700ms debounce draft), '다음'에서 flush+확정(DATA-02/03).
   · 저장 실패 시 index 이동 금지(commitNext는 저장 성공 후에만). 중복 제출 차단. */
;(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const OVERLAY_ID = 'thought-compass-flow';
  const DRAFT_DEBOUNCE_MS = 700;

  function _Flow() { return window.ThoughtCompassFlow; }
  function _Store() { return window.ThoughtCompassStore; }
  function _Q() { return window.ThoughtCompassQuestions; }
  function _TC() { return window.ThoughtCompass; }
  function _Gate() { return window.ThoughtCompassGate; }

  let S = null;   /* { ctx, vm, busy, draftTimer, error } — 보조단계(assistance)는 vm에 저장 */

  function _el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function _remove() {
    const o = document.getElementById(OVERLAY_ID);
    if (o && o.parentNode) o.parentNode.removeChild(o);
  }

  async function open(ctx) {
    const Flow = _Flow(), Store = _Store(), TC = _TC();
    if (!Flow || !TC) return;
    let state = null;
    if (Store && typeof Store.loadThoughtCompassStateResult === 'function') {
      try { const r = await Store.loadThoughtCompassStateResult(ctx); state = r && r.raw; } catch (e) { state = null; }
    }
    const rp = TC.resolveResumePoint(state);
    const vm = Flow.createFlow({ resume: { index: rp.questionIndex, answers: rp.answers } });
    S = { ctx: ctx, vm: vm, busy: false, draftTimer: null, error: null };
    _render();
  }

  function _render() {
    if (!S) return;
    const Flow = _Flow();
    const q = Flow.currentQuestion(S.vm);
    if (!q) return;
    const prog = Flow.progress(S.vm);
    const ans = Flow.currentAnswer(S.vm);
    const selectedChoiceId = ans && ans.choiceId ? ans.choiceId : null;
    const isCustom = !!(ans && ans.answerText && !selectedChoiceId && !(ans.deferred));
    const customText = isCustom ? ans.answerText : '';
    const isDeferred = !!(ans && ans.deferred);
    const assistPrompt = Flow.assistancePrompt(S.vm);

    _remove();
    const overlay = _el('div', 'tc-flow-overlay');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '생각 나침반');

    const card = _el('div', 'tc-flow-card');

    /* 진행률 — 얇은 막대 + 숫자(WIRE-03) */
    const progWrap = _el('div', 'tc-flow-progress');
    const bar = _el('div', 'tc-flow-progress-bar');
    const fill = _el('div', 'tc-flow-progress-fill');
    fill.style.width = Math.round((prog.current / prog.total) * 100) + '%';
    bar.appendChild(fill);
    progWrap.appendChild(_el('div', 'tc-flow-progress-label', prog.label));
    progWrap.appendChild(bar);
    card.appendChild(progWrap);

    /* 질문 */
    const qTitle = _el('h2', 'tc-flow-title', q.title);
    qTitle.id = 'tc-flow-title';
    card.appendChild(qTitle);
    if (q.help) card.appendChild(_el('p', 'tc-flow-help', q.help));
    overlay.setAttribute('aria-labelledby', 'tc-flow-title');

    /* 모르겠어요 안내(Phase F) — 부드러운 안내(오류처럼 표시하지 않음, 재촉 없음) */
    if (assistPrompt) card.appendChild(_el('p', 'tc-flow-assist', assistPrompt));
    if (isDeferred) {
      card.appendChild(_el('p', 'tc-flow-defer', '“' + ans.answerText + '”로 정했어요. 이야기를 만들면서 더 떠올려도 좋아요.'));
    }

    /* 선택지 3개 + 직접 적기(동등 카드, WIRE-02) */
    const opts = _el('div', 'tc-flow-options');
    (q.choices || []).forEach(c => {
      const b = _el('button', 'tc-flow-choice' + (selectedChoiceId === c.id ? ' is-selected' : ''), c.label);
      b.type = 'button';
      b.setAttribute('aria-pressed', selectedChoiceId === c.id ? 'true' : 'false');
      b.addEventListener('click', function () { _onChoice(c.id); });
      opts.appendChild(b);
    });
    /* 직접 적기 카드 */
    const customWrap = _el('div', 'tc-flow-custom' + (isCustom ? ' is-active' : ''));
    const customBtn = _el('button', 'tc-flow-choice tc-flow-choice--custom' + (isCustom ? ' is-selected' : ''), '✏️ ' + (q.customLabel || '직접 적을래요'));
    customBtn.type = 'button';
    customBtn.setAttribute('aria-pressed', isCustom ? 'true' : 'false');
    customBtn.addEventListener('click', function () { _onCustomActivate(); });
    customWrap.appendChild(customBtn);
    if (isCustom) {
      const ta = _el('textarea', 'tc-flow-custom-input');
      ta.value = customText;
      ta.maxLength = q.maxLength || 200;
      ta.setAttribute('aria-label', q.customLabel || '직접 적기');
      ta.placeholder = '여기에 적어 보세요';
      ta.addEventListener('input', function () { _onCustomInput(ta.value); });
      customWrap.appendChild(ta);
      const counter = _el('div', 'tc-flow-counter', customText.length + ' / ' + (q.maxLength || 200));
      ta.addEventListener('input', function () { counter.textContent = ta.value.length + ' / ' + (q.maxLength || 200); });
      customWrap.appendChild(counter);
    }
    opts.appendChild(customWrap);
    card.appendChild(opts);

    /* 모르겠어요 */
    const unsure = _el('button', 'tc-flow-unsure', '모르겠어요');
    unsure.type = 'button';
    unsure.addEventListener('click', function () { _onUnsure(); });
    card.appendChild(unsure);

    /* 저장 오류(있으면) */
    if (S.error) {
      const err = _el('p', 'tc-flow-error', S.error);
      err.setAttribute('role', 'alert');
      card.appendChild(err);
    }

    /* 하단 네비 — 이전(두번째부터, WIRE-05) / 다음 */
    const nav = _el('div', 'tc-flow-nav');
    if (Flow.canPrev(S.vm)) {
      const prev = _el('button', 'tc-flow-prev', '이전');
      prev.type = 'button';
      prev.addEventListener('click', function () { _onPrev(); });
      nav.appendChild(prev);
    } else {
      nav.appendChild(_el('span', 'tc-flow-nav-spacer'));
    }
    const next = _el('button', 'tc-flow-next', Flow.isLast(S.vm) ? '다 정했어요' : '다음');
    next.type = 'button';
    next.disabled = !Flow.canNext(S.vm) || S.busy;
    next.addEventListener('click', function () { _onNext(); });
    nav.appendChild(next);
    card.appendChild(nav);

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    /* 접근성 — 카드/제목 포커스 */
    try { qTitle.setAttribute('tabindex', '-1'); qTitle.focus(); } catch (e) {}
  }

  function _onChoice(choiceId) {
    S.error = null;
    S.vm = _Flow().setChoiceAnswer(S.vm, choiceId);
    _render();
  }
  function _onCustomActivate() {
    S.error = null;
    /* 직접 적기 카드 활성화 — 빈 draft로 전환(선택지 해제). */
    S.vm = _Flow().setCustomAnswer(S.vm, '', { draft: true });
    _render();
    const ta = document.querySelector('.tc-flow-custom-input');
    if (ta) { try { ta.focus(); } catch (e) {} }
  }
  function _onCustomInput(text) {
    S.vm = _Flow().setCustomAnswer(S.vm, text, { draft: true });
    /* next 활성/비활성만 즉시 갱신(전체 재렌더 회피 — 포커스 유지) */
    const next = document.querySelector('.tc-flow-next');
    if (next) next.disabled = !_Flow().canNext(S.vm) || S.busy;
    /* 700ms debounce draft 저장(매 키 저장 금지) */
    if (S.draftTimer) clearTimeout(S.draftTimer);
    S.draftTimer = setTimeout(function () { _saveDraft(); }, DRAFT_DEBOUNCE_MS);
  }
  async function _saveDraft() {
    const Store = _Store(), Flow = _Flow();
    if (!Store) return;
    try {
      const patch = Flow.buildSavePatch(S.vm, { index: S.vm.index });
      await Store.saveThoughtCompassProgress(S.ctx, { status: 'inProgress' }, patch);
    } catch (e) { /* draft 실패는 조용히(다음에서 flush 재시도) */ }
  }
  function _onUnsure() {
    /* Phase F: 첫 클릭 → 쉬운 안내(같은 보기 유지), 그 다음 클릭 → 최소 유예 답변(빈 답 아님). */
    S.error = null;
    const r = _Flow().handleUnsure(S.vm);
    S.vm = r.vm;
    _render();
  }
  function _onPrev() {
    if (S.busy) return;
    if (S.draftTimer) { clearTimeout(S.draftTimer); S.draftTimer = null; }
    S.error = null;
    S.vm = _Flow().goPrev(S.vm);
    _render();
  }
  async function _onNext() {
    if (S.busy) return;                 /* 중복 제출 차단 */
    const Flow = _Flow(), Store = _Store();
    if (!Flow.canNext(S.vm)) return;
    S.busy = true; S.error = null;
    const next = document.querySelector('.tc-flow-next');
    if (next) next.disabled = true;
    if (S.draftTimer) { clearTimeout(S.draftTimer); S.draftTimer = null; }

    const last = Flow.isLast(S.vm);
    const targetIndex = last ? S.vm.index : S.vm.index + 1;
    let ok = true;
    if (Store) {
      try {
        const patch = Flow.buildSavePatch(S.vm, { index: targetIndex });
        await Store.saveThoughtCompassProgress(S.ctx, { status: 'inProgress' }, patch);
      } catch (e) { ok = false; }
    }
    if (!ok) {
      S.busy = false; S.error = '저장하지 못했어요. 다시 시도해 주세요.';
      _render();
      return;                            /* 저장 실패 → index 이동 금지 */
    }
    S.busy = false;
    if (last) { _finishCore(); return; }
    S.vm = Flow.commitNext(S.vm);
    _render();
  }

  /* 마지막 핵심질문 통과 → 최종 검토(Phase I). 미구현 시 자리표시 안내. */
  function _finishCore() {
    if (typeof window.ThoughtCompassReview !== 'undefined' && window.ThoughtCompassReview && typeof window.ThoughtCompassReview.open === 'function') {
      _remove();
      window.ThoughtCompassReview.open(S.ctx, S.vm);
      return;
    }
    /* Phase I 이전 — 검토 화면 자리표시(스켈레톤) */
    _remove();
    const overlay = _el('div', 'tc-flow-overlay');
    overlay.id = OVERLAY_ID;
    const card = _el('div', 'tc-flow-card');
    card.appendChild(_el('h2', 'tc-flow-title', '생각 나침반을 만들 준비가 되었어요'));
    card.appendChild(_el('p', 'tc-flow-help', '핵심 질문을 모두 마쳤어요. (최종 검토 화면은 다음 단계에서 연결됩니다.)'));
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  function close() { if (S && S.draftTimer) clearTimeout(S.draftTimer); _remove(); S = null; }

  window.ThoughtCompassUI = { open: open, close: close, _render: _render };
})();
