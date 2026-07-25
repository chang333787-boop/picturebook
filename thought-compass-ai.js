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

  /* ADAPTIVE-CHOICES(2026-07-24): 맥락 맞춤 보기 요청. 실패/미배포 → null(UI가 고정 보기 폴백).
     payload: { classId, teamName, projectType?, questionId?, questionTitle, priorAnswersText, staticChoices? }
     반환: { ok, choices:[{label,value}×3] } | null
     감사 #17: single-flight를 질문키별로 — 다른 질문 요청에 진행 중 프라미스를 돌려주면
     A질문 보기가 B질문에 저장되는 교차 오염. 같은 질문 중복만 합치고, 다른 질문은 새 호출. */
  let _acInflight = null;
  let _acInflightKey = null;
  function requestAdaptiveChoices(payload) {
    const _key = String((payload && (payload.questionId || payload.questionTitle)) || '');
    if (_acInflight && _acInflightKey === _key) return _acInflight;
    const _p = (async function () {
      try {
        const app = (typeof firebase !== 'undefined' && typeof firebase.app === 'function') ? firebase.app() : null;
        if (!app || typeof app.functions !== 'function') return null;
        const callable = app.functions('asia-northeast3').httpsCallable('compassAdaptiveChoices', { timeout: 15000 });
        const res = await callable(payload);
        return (res && res.data) || null;
      } catch (e) {
        return null;   /* 미배포/네트워크/권한/한도 실패 → null(고정 보기로 진행) */
      }
    })();
    _acInflight = _p; _acInflightKey = _key;
    const _clear = function () { if (_acInflight === _p) { _acInflight = null; _acInflightKey = null; } };
    return _p.then(function (v) { _clear(); return v; }, function () { _clear(); return null; });
  }

  window.ThoughtCompassAI = { requestFollowUp: requestFollowUp, requestAdaptiveChoices: requestAdaptiveChoices };
})();
