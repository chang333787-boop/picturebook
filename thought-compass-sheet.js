/* thought-compass-sheet.js — 생각 나침반 v2 "내 이야기 큰줄기 설계도" 파생 helper(순수, Firebase·DOM 비의존).
   COMPASS-SHEET-1: v2 10답변 → storyMapV2(렌더 시 계산·DB 저장 없음) + 템플릿 한 문단 줄거리.
   AI 호출 없음(D-15 정신: 템플릿이 기본, AI 정돈은 후속 COMPASS-SUMMARY-AI 사안).
   브라우저(window.ThoughtCompassSheet) + Node(require) 양쪽 동작 → 하니스로 검증. */
;(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ThoughtCompassSheet = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const MINIMAL_ANSWER = '이야기를 만들면서 정할래요';   /* thought-compass.js와 동일(테스트 교차검증) */
  const DEFERRED_LABEL = '만들면서 정하기';

  /* v2 10키 — 카드 순서 = 질문 순서(재료→한줄기→분기→앵커). */
  const FIELD_DEFS = [
    { key: 'targetLength',  label: '기본 길이',      icon: '📏' },
    { key: 'protagonist',   label: '주인공',         icon: '🧒' },
    { key: 'goal',          label: '원하는 것',      icon: '⭐' },
    { key: 'mainlineStart', label: '시작',           icon: '🌅' },
    { key: 'incitingEvent', label: '생기는 일',      icon: '⚡' },
    { key: 'risingTrouble', label: '어려움',         icon: '🌊' },
    { key: 'keyChoice',     label: '중요한 선택',    icon: '🔀' },
    { key: 'trueEnding',    label: '진엔딩',         icon: '🏁' },
    { key: 'alternatePath', label: '다른 선택을 하면', icon: '🌿' },
    { key: 'coreMessage',   label: '끝까지 지킬 중심', icon: '💎' },
  ];

  /* targetLength 보기 → 짧은 표기(choiceId 우선, 텍스트 fallback). */
  const TARGETLEN_LABELS = { targetlen_8: '약 8장면', targetlen_12: '약 12장면', targetlen_15: '약 15장면' };

  function _isDeferred(a) {
    if (!a || typeof a !== 'object') return false;
    if (a.deferred === true) return true;
    return typeof a.answerText === 'string' && a.answerText.trim() === MINIMAL_ANSWER;
  }
  function _textOf(a) {
    if (!a) return '';
    if (typeof a === 'string') return a.trim();
    if (typeof a === 'object' && typeof a.answerText === 'string') return a.answerText.trim();
    return '';
  }

  /* v2 answers → storyMapV2 (렌더 시 계산 전용 — DB 미저장).
     각 필드: { key, label, icon, text, deferred } · text=''이면 미작성. */
  function buildStoryMapV2(answers) {
    answers = (answers && typeof answers === 'object' && !Array.isArray(answers)) ? answers : {};
    const fields = [];
    const deferredKeys = [];
    for (const def of FIELD_DEFS) {
      const a = answers[def.key];
      const deferred = _isDeferred(a);
      let text = deferred ? DEFERRED_LABEL : _textOf(a);
      if (def.key === 'targetLength' && !deferred) {
        const cid = a && typeof a === 'object' ? a.choiceId : null;
        if (cid && TARGETLEN_LABELS[cid]) text = TARGETLEN_LABELS[cid];
      }
      if (deferred) deferredKeys.push(def.key);
      fields.push({ key: def.key, label: def.label, icon: def.icon, text: text, deferred: deferred });
    }
    return {
      version: 2,
      fields: fields,
      deferredKeys: deferredKeys,
      summaryText: buildSummaryText(fields),
    };
  }

  function _f(fields, key) {
    for (const f of fields) if (f.key === key) return f;
    return null;
  }
  /* 문장 조각 — 답이 있으면 따옴표 인용(보기 label의 "~해요" 어미와 충돌 없는 형태),
     유예/빈 답이면 "(만들면서 정하기)". */
  function _q(fields, key) {
    const f = _f(fields, key);
    if (!f || !f.text || f.deferred) return '(' + DEFERRED_LABEL + ')';
    return '“' + f.text + '”';
  }

  /* 템플릿 한 문단 줄거리 — 시간축(시작→사건→고조→선택→진엔딩→다른 길→중심).
     AI 없이 항상 생성 가능. 인용부호로 답 원문을 감싸 문법 충돌 회피. */
  function buildSummaryText(fields) {
    const p = _f(fields, 'protagonist');
    const pName = (p && p.text && !p.deferred) ? p.text : DEFERRED_LABEL;
    const parts = [];
    parts.push('『' + pName + '』의 이야기.');
    parts.push('주인공이 가장 원하는 것은 ' + _q(fields, 'goal') + '.');
    parts.push('이야기는 ' + _q(fields, 'mainlineStart') + '에서 시작해요.');
    parts.push('그러다 ' + _q(fields, 'incitingEvent') + '.');
    parts.push('하지만 ' + _q(fields, 'risingTrouble') + ' — 일이 점점 어려워져요.');
    parts.push('가장 중요한 갈림길은 ' + _q(fields, 'keyChoice') + '.');
    parts.push('진엔딩에서는 ' + _q(fields, 'trueEnding') + '.');
    parts.push('다른 선택을 하면 ' + _q(fields, 'alternatePath') + '.');
    parts.push('끝까지 지키고 싶은 것은 ' + _q(fields, 'coreMessage') + '.');
    return parts.join(' ');
  }

  /* v2 결과인지(설계도 노출 여부) — 질문 세트에 targetLength 존재로 판별(review vm 기준).
     LEVELS-LINEAR(2026-07-19): 2단계 linear 세트도 targetLength를 가지므로 protagonistName이
     있으면 제외 — v2 설계도 템플릿(진엔딩/다른 선택 문구)이 일직선에 맞지 않음. 일직선 전용
     설계도는 후속(그때까지 결과지는 질문·답 카드 목록으로 충분). */
  function isV2Questions(questions) {
    if (!Array.isArray(questions)) return false;
    let hasTargetLength = false;
    for (const q of questions) {
      if (q && q.id === 'protagonistName') return false;
      if (q && q.id === 'targetLength') hasTargetLength = true;
    }
    return hasTargetLength;
  }

  return { FIELD_DEFS, TARGETLEN_LABELS, DEFERRED_LABEL, MINIMAL_ANSWER, buildStoryMapV2, buildSummaryText, isV2Questions };
});
