/* thought-compass-flow.js — 한 화면 한 질문 흐름의 순수 view-model(DOM/RTDB 비의존).
   thought-compass-ui.js(DOM)가 이 vm을 렌더/이벤트 바인딩. 하니스로 검증 가능(Node).
   질문 정의는 thought-compass-questions.js, 답변 정규화도 거기에 위임. */
;(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ThoughtCompassFlow = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  function _Q() {
    if (typeof module !== 'undefined' && module.exports) { try { return require('./thought-compass-questions.js'); } catch (e) {} }
    return (typeof window !== 'undefined' && window.ThoughtCompassQuestions) ? window.ThoughtCompassQuestions
      : (typeof globalThis !== 'undefined' ? globalThis.ThoughtCompassQuestions : null);
  }

  function _clone(vm) {
    return {
      questions: vm.questions,
      index: vm.index,
      answers: Object.assign({}, vm.answers),
      assistance: Object.assign({}, vm.assistance),
      total: vm.total,
    };
  }

  /* opts: { questions?, resume?:{ index, answers } } */
  function createFlow(opts) {
    opts = opts || {};
    const Q = _Q();
    const questions = opts.questions || (Q ? Q.getCoreQuestions() : []);
    const resume = opts.resume || {};
    const answers = (resume.answers && typeof resume.answers === 'object') ? Object.assign({}, resume.answers) : {};
    let index = Number.isInteger(resume.index) ? resume.index : 0;
    if (index < 0) index = 0;
    if (index > questions.length - 1) index = Math.max(0, questions.length - 1);
    return { questions: questions, index: index, answers: answers, assistance: {}, total: questions.length };
  }

  function currentQuestion(vm) { return vm.questions[vm.index] || null; }
  function currentAnswer(vm) {
    const q = currentQuestion(vm);
    return q ? (vm.answers[q.id] || null) : null;
  }
  function answerFor(vm, id) { return vm.answers[id] || null; }

  function isFirst(vm) { return vm.index <= 0; }
  function isLast(vm) { return vm.index >= vm.total - 1; }
  function progress(vm) {
    return { current: vm.index + 1, total: vm.total, label: '생각 나침반 ' + (vm.index + 1) + ' / ' + vm.total };
  }

  /* 선택지 선택 → 현재 질문 답변(직접입력 텍스트는 대체됨). */
  function setChoiceAnswer(vm, choiceId) {
    const q = currentQuestion(vm); if (!q) return vm;
    const Q = _Q();
    const choice = (q.choices || []).find(c => c.id === choiceId);
    if (!choice) return vm;
    const next = _clone(vm);
    next.answers[q.id] = Q ? Q.normalizeAnswerValue({ choiceId: choice.id, value: choice.value }, { maxLength: q.maxLength })
      : { answerText: choice.value, answerStatus: 'confirmed', choiceId: choice.id };
    return next;
  }

  /* 직접 적기 입력 → 현재 질문 답변(선택지 선택 해제). opts.draft=true면 임시(진행중). */
  function setCustomAnswer(vm, text, opts) {
    const q = currentQuestion(vm); if (!q) return vm;
    const Q = _Q();
    const next = _clone(vm);
    next.answers[q.id] = Q ? Q.normalizeAnswerValue(text, { maxLength: q.maxLength, draft: !!(opts && opts.draft) })
      : { answerText: String(text || '').trim(), answerStatus: (text ? 'confirmed' : 'empty') };
    return next;
  }

  /* 최소 유예 답변("이야기를 만들면서 정할래요") — 현재 질문 확정. */
  function setDeferredAnswer(vm) {
    const q = currentQuestion(vm); if (!q) return vm;
    const Q = _Q();
    const next = _clone(vm);
    next.answers[q.id] = Q ? Q.normalizeAnswerValue(null, { deferred: true }) : { answerText: '이야기를 만들면서 정할래요', answerStatus: 'confirmed', deferred: true };
    return next;
  }

  function clearAnswer(vm) {
    const q = currentQuestion(vm); if (!q) return vm;
    const next = _clone(vm); delete next.answers[q.id]; return next;
  }

  /* 현재 답변이 완료 판정상 유효(빈 답 아님)인가. */
  function hasValidAnswer(vm) {
    const Q = _Q();
    const a = currentAnswer(vm);
    return Q ? Q.isAnswerPresent(a) : !!(a && ((a.answerText && a.answerText.trim()) || a.deferred));
  }
  function canNext(vm) { return hasValidAnswer(vm); }
  function canPrev(vm) { return !isFirst(vm); }

  /* 저장 payload — store.saveThoughtCompassProgress(ctx, state, patch)용. 이동 후 index를 저장. */
  function buildSavePatch(vm, opts) {
    const q = currentQuestion(vm);
    const targetIndex = (opts && Number.isInteger(opts.index)) ? opts.index : vm.index;
    const patch = { currentQuestionIndex: targetIndex };
    if (q && vm.answers[q.id]) { patch.answers = {}; patch.answers[q.id] = vm.answers[q.id]; }
    return patch;
  }

  /* 이전 — index 감소(답변 보존). */
  function goPrev(vm) {
    if (isFirst(vm)) return vm;
    const next = _clone(vm); next.index = vm.index - 1; return next;
  }

  /* 다음(확정) — canNext일 때만 index 증가. 마지막이면 index 유지(done=true는 호출자가 isLast로 판단).
     ★ 저장 성공 후에만 호출해야 함(UI): 저장 실패 시 호출하지 않으면 index 이동 안 함. */
  function commitNext(vm) {
    if (!canNext(vm)) return vm;
    if (isLast(vm)) return vm;     /* 마지막 핵심질문 → 검토 화면으로(호출자) */
    const next = _clone(vm); next.index = vm.index + 1; return next;
  }

  /* 특정 질문으로 점프(최종 검토 화면 '고치기' 용, Phase I). */
  function goToIndex(vm, idx) {
    if (!Number.isInteger(idx) || idx < 0 || idx > vm.total - 1) return vm;
    const next = _clone(vm); next.index = idx; return next;
  }
  function goToQuestionId(vm, id) {
    const i = vm.questions.findIndex(q => q.id === id);
    return i >= 0 ? goToIndex(vm, i) : vm;
  }

  /* ── 모르겠어요 완화 흐름(Phase F) ──
     단계(질문별): 0=정상 · 1=쉬운 안내(같은 보기 3개+직접 적기 유지) · 2=최소 유예 답변 확정.
     첫 클릭 즉시 유예 저장 금지(0→1만). 두 번째 클릭부터 유예. assistance는 vm에 보존(이전 이동 후 복원). */
  function assistanceLevel(vm) {
    const q = currentQuestion(vm); if (!q) return 0;
    return vm.assistance[q.id] || 0;
  }
  function setAssistanceLevel(vm, n) {
    const q = currentQuestion(vm); if (!q) return vm;
    const next = _clone(vm);
    next.assistance[q.id] = Math.max(0, Math.min(2, n | 0));
    return next;
  }
  function assistancePrompt(vm) {
    const Q = _Q();
    const lvl = assistanceLevel(vm);
    if (lvl >= 1 && lvl < 2 && Q && Q.ASSISTANCE_PROMPTS) return Q.ASSISTANCE_PROMPTS[1] || '';
    if (lvl >= 2 && Q && Q.ASSISTANCE_PROMPTS) return Q.ASSISTANCE_PROMPTS[2] || '';
    return '';
  }
  /* 모르겠어요 1회 처리. 반환 { vm, deferred }. deferred=true면 최소 유예 답변이 확정됨. */
  function handleUnsure(vm) {
    const lvl = assistanceLevel(vm);
    if (lvl === 0) return { vm: setAssistanceLevel(vm, 1), deferred: false };
    /* 1단계 이상에서 다시 모르겠어요 → 최소 유예 답변 확정(빈 답 아님). */
    let next = setDeferredAnswer(vm);
    next = setAssistanceLevel(next, 2);
    return { vm: next, deferred: true };
  }

  /* 모든 핵심 질문에 유효 답변이 있는가(완료 가능 여부, Phase I). */
  function allAnswered(vm) {
    const Q = _Q();
    for (const q of vm.questions) {
      const a = vm.answers[q.id];
      if (!(Q ? Q.isAnswerPresent(a) : (a && a.answerText))) return false;
    }
    return true;
  }

  return {
    createFlow, currentQuestion, currentAnswer, answerFor,
    isFirst, isLast, progress,
    setChoiceAnswer, setCustomAnswer, setDeferredAnswer, clearAnswer,
    hasValidAnswer, canNext, canPrev, buildSavePatch,
    goPrev, commitNext, goToIndex, goToQuestionId, allAnswered,
    assistanceLevel, setAssistanceLevel, assistancePrompt, handleUnsure,
  };
});
