/* thought-compass-ai.js — 생각 나침반 AI 후속질문 callable 클라이언트(브라우저 전용).
   callThoughtCompassFollowUp(asia-northeast3) 호출. 실패/미배포 시 null 반환(UI가 NEXT 처리).
   single-flight로 중복 호출 차단. 결정값/검증은 서버가 정본. */
;(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  let _inflight = null;

  /* payload: { classId, teamName, projectType, coreQuestionId, currentAnswer, followUpCount, totalQuestionCount, priorSummaries? }
     반환: { decision, reasonCode, acknowledgement, followUpQuestion, supportOptions } | null(실패/미배포) */
  function requestFollowUp(payload) {
    if (_inflight) return _inflight;
    _inflight = (async function () {
      try {
        const app = (typeof firebase !== 'undefined' && typeof firebase.app === 'function') ? firebase.app() : null;
        if (!app || typeof app.functions !== 'function') return null;
        const callable = app.functions('asia-northeast3').httpsCallable('callThoughtCompassFollowUp');
        const res = await callable(payload);
        return (res && res.data) || null;
      } catch (e) {
        return null;   /* 미배포/네트워크/권한 실패 → null(진행 차단 금지). UI가 다음으로 안전 진행. */
      }
    })();
    return _inflight.then(function (v) { _inflight = null; return v; }, function () { _inflight = null; return null; });
  }

  window.ThoughtCompassAI = { requestFollowUp: requestFollowUp };
})();
