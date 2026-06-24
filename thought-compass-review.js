/* thought-compass-review.js — 최종 검토·완료 화면(브라우저 전용, Phase I).
   7개 핵심 답변(+후속) 세로 목록 → 고치기/완료. 완료 = 검증 후 markCompleted + 기본 장면 생성(Phase J 훅).
   순수 완료 판정은 thought-compass.js(validateThoughtCompassCompletion). */
;(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const OVERLAY_ID = 'thought-compass-review';

  function _Q() { return window.ThoughtCompassQuestions; }
  function _Flow() { return window.ThoughtCompassFlow; }
  function _TC() { return window.ThoughtCompass; }
  function _Store() { return window.ThoughtCompassStore; }
  function _UI() { return window.ThoughtCompassUI; }

  let R = null;   /* { ctx, vm, followUps, busy, error } */

  function _el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function _remove() { const o = document.getElementById(OVERLAY_ID); if (o && o.parentNode) o.parentNode.removeChild(o); }

  function open(ctx, vm, followUps) {
    R = { ctx: ctx, vm: vm, followUps: Array.isArray(followUps) ? followUps : [], busy: false, error: null, readOnly: false };
    _render();
  }

  /* 완료된 생각 나침반 '다시 보기'(Phase L, D-17) — read-only. 원본 보존(D-16): 고치기/완료 없음.
     메모(다듬기 전용 300자, UX-15) + 브랜치/다듬기 서랍(WIRE-13/14)은 후속 단계로 보류. */
  async function openReadOnly(ctx) {
    const Store = _Store(), Q = _Q();
    let state = null;
    if (Store && typeof Store.loadThoughtCompassStateResult === 'function') {
      try { const r = await Store.loadThoughtCompassStateResult(ctx); state = r && r.raw; } catch (e) { state = null; }
    }
    state = state || {};
    const vm = { questions: Q ? Q.getCoreQuestions() : [], answers: (state.answers && typeof state.answers === 'object') ? state.answers : {} };
    R = { ctx: ctx, vm: vm, followUps: Array.isArray(state.followUps) ? state.followUps : [], busy: false, error: null, readOnly: true };
    _render();
  }

  function _render() {
    if (!R) return;
    const Q = _Q(), Flow = _Flow();
    _remove();
    const overlay = _el('div', 'tc-flow-overlay');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '생각 나침반 최종 확인');
    const card = _el('div', 'tc-flow-card tc-review-card');

    const t = _el('h2', 'tc-flow-title', R.readOnly ? '내 생각 나침반' : '생각 나침반을 만들 준비가 되었어요'); t.id = 'tc-review-title';
    card.appendChild(t);
    overlay.setAttribute('aria-labelledby', 'tc-review-title');
    card.appendChild(_el('p', 'tc-flow-help', R.readOnly ? '우리가 정한 이야기 방향이에요.' : '정한 내용을 살펴보고, 고치고 싶은 게 있으면 “고치기”를 눌러요.'));

    const list = _el('div', 'tc-review-list');
    const questions = Q ? Q.getCoreQuestions() : R.vm.questions;
    questions.forEach((q, idx) => {
      const item = _el('div', 'tc-review-item');
      const head = _el('div', 'tc-review-q', q.title);
      item.appendChild(head);
      const a = R.vm.answers[q.id];
      const answerText = (a && a.answerText) ? a.answerText : '(아직 안 정함)';
      const ans = _el('div', 'tc-review-a' + ((a && a.answerText) ? '' : ' is-empty'), answerText);
      item.appendChild(ans);
      /* 이 질문의 후속답변 */
      const fus = R.followUps.filter(f => f && f.parentQuestionId === q.id);
      fus.forEach(f => {
        const sub = _el('div', 'tc-review-followup');
        sub.appendChild(_el('div', 'tc-review-fq', '↳ ' + (f.prompt || '')));
        sub.appendChild(_el('div', 'tc-review-fa', (f.answer || '')));
        item.appendChild(sub);
      });
      if (!R.readOnly) {
        const edit = _el('button', 'tc-review-edit', '고치기');
        edit.type = 'button';
        edit.addEventListener('click', function () { _editQuestion(idx); });
        item.appendChild(edit);
      }
      list.appendChild(item);
    });
    card.appendChild(list);

    if (R.error) {
      const err = _el('p', 'tc-flow-error', R.error);
      err.setAttribute('role', 'alert');
      card.appendChild(err);
    }
    if (R.busy) card.appendChild(_el('p', 'tc-flow-aistatus', '생각 나침반을 만들고 있어요…'));

    const nav = _el('div', 'tc-flow-nav');
    nav.appendChild(_el('span', 'tc-flow-nav-spacer'));
    if (R.readOnly) {
      const closeBtn = _el('button', 'tc-flow-next', '닫기');
      closeBtn.type = 'button';
      closeBtn.addEventListener('click', function () { close(); });
      nav.appendChild(closeBtn);
    } else {
      const done = _el('button', 'tc-flow-next', '이 생각으로 시작하기');
      done.type = 'button';
      done.disabled = R.busy;
      done.addEventListener('click', function () { _complete(); });
      nav.appendChild(done);
    }
    card.appendChild(nav);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    try { t.setAttribute('tabindex', '-1'); t.focus(); } catch (e) {}
  }

  /* 고치기 — 해당 질문으로 이동해 단일 수정 후 검토로 복귀(D-09). 다른 답변 보존. */
  function _editQuestion(idx) {
    const UI = _UI();
    if (!UI || typeof UI.openForEdit !== 'function') return;
    _remove();
    UI.openForEdit(R.ctx, R.vm, idx, function (updatedVm) {
      if (updatedVm) R.vm = updatedVm;   /* 수정 반영(취소면 null → 기존 답 유지) */
      R.error = null;
      _render();                          /* 검토 화면 복귀 */
    });
  }

  async function _complete() {
    if (R.busy) return;
    const TC = _TC(), Store = _Store(), Flow = _Flow();
    /* 완료 조건 — 7핵심 모두 유효(유예 답변 포함). */
    const state = { status: 'inProgress', answers: R.vm.answers, followUps: R.followUps, completedAt: null };
    const v = TC ? TC.validateThoughtCompassCompletion(state) : { valid: Flow.allAnswered(R.vm) };
    if (!v.valid) {
      R.error = '아직 정하지 않은 질문이 있어요. “고치기”로 채워 주세요.';
      _render();
      return;
    }
    R.busy = true; R.error = null; _render();

    let ok = true;
    try {
      if (Store && typeof Store.markThoughtCompassCompleted === 'function') {
        await Store.markThoughtCompassCompleted(R.ctx, state);
      }
    } catch (e) { ok = false; }
    if (!ok) {
      R.busy = false; R.error = '완료하지 못했어요. 다시 시도해 주세요.';
      _render();
      return;                 /* 저장 실패 → 완료 차단(maker 미진입) */
    }

    /* Phase J — 완료 후 기본 장면 생성(훅). 실패해도 완료/진입은 막지 않음. */
    try {
      if (typeof window.ThoughtCompassComplete !== 'undefined' && window.ThoughtCompassComplete
          && typeof window.ThoughtCompassComplete.afterComplete === 'function') {
        await window.ThoughtCompassComplete.afterComplete(R.ctx);
      }
    } catch (e) { /* noop — 장면 생성 실패는 maker에서 수동 생성 가능 */ }

    /* 게이트/검토 닫기 → maker 노출 */
    _remove();
    if (window.ThoughtCompassGate && typeof window.ThoughtCompassGate.closeGate === 'function') window.ThoughtCompassGate.closeGate();
    if (_UI() && typeof _UI().close === 'function') _UI().close();
    R = null;
  }

  function close() { _remove(); R = null; }

  window.ThoughtCompassReview = { open: open, openReadOnly: openReadOnly, close: close, _render: _render };
})();
