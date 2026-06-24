/* thought-compass-questions.js — 생각 나침반 핵심 7질문 정의 데이터(순수, Firebase·DOM 비의존).
   브라우저(window.ThoughtCompassQuestions) + Node(require) 양쪽 동작 → 하니스로 검증 가능.
   정본 문구: docs/thought_compass_prd.md (Q-01~Q-21, AI-05 충분 판정표, 모르겠어요 흐름).
   질문 id는 thought-compass.js CORE_QUESTION_KEYS와 1:1(완료 판정·summary 필드와 동일 키). */
;(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ThoughtCompassQuestions = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  /* thought-compass.js의 정본 키/문구(로드 순서 독립 위해 복제, 테스트로 교차검증). */
  const CORE_QUESTION_KEYS = ['audience', 'purpose', 'protagonist', 'goal', 'obstacle', 'branchChoice', 'protectedCore'];
  const MINIMAL_ANSWER = '이야기를 만들면서 정할래요';   /* PRD UX-05 / TC.MINIMAL_ANSWER */
  const MAX_CORE_LEN = 200;        /* D-24 핵심 질문 직접입력 최대 */
  const ANSWER_STATUS = { EMPTY: 'empty', DRAFT: 'draft', CONFIRMED: 'confirmed' };   /* DATA-04 */

  /* 모르겠어요 단계별 안내(PRD "모르겠어요 흐름 Phase I"). 같은 선택지를 부드럽게 재노출. */
  const ASSISTANCE_PROMPTS = {
    1: '괜찮아요. 보기 중에서 가장 가까운 것을 골라도 돼요.',
    2: '완벽하게 정하지 않아도 괜찮아요. 지금 떠오르는 것을 하나만 골라볼까요?',
  };

  function _choice(id, label) { return { id: id, label: label, value: label }; }

  /* 핵심 7질문 — PRD G1~G7. choices=대표 3개(방향 예시), allowCustom=직접 적기(동등),
     allowUnsure=모르겠어요. sufficientWhen/followUpTrigger = AI-05 표(Phase G/H 참고용). */
  const CORE_QUESTIONS = [
    {
      id: 'audience', order: 1, g: 'G1',
      title: '이 이야기를 가장 먼저 보여주고 싶은 사람은 누구인가요?',           /* Q-01 */
      help: '이 이야기를 보여 주고 싶은 사람을 떠올려 보세요.',
      choices: [_choice('audience_class', '우리 반 친구들'), _choice('audience_family', '가족'), _choice('audience_younger', '어린 동생이나 저학년')], /* Q-02 */
      allowCustom: true, customLabel: '다른 사람을 직접 적을래요', allowUnsure: true, maxLength: MAX_CORE_LEN,
      sufficientWhen: '특정 사람 또는 비교적 분명한 집단',
      followUpTrigger: "'모두·사람들·친구'처럼 너무 넓을 때",
    },
    {
      id: 'purpose', order: 2, g: 'G2',
      title: '이 이야기를 본 사람이 어떤 느낌이나 생각을 가졌으면 좋겠나요?',     /* Q-04 */
      help: '이야기를 본 사람의 마음에 무엇이 남았으면 좋을지 생각해 보세요.',
      choices: [_choice('purpose_fun', '재미있고 긴장됐으면 좋겠어요'), _choice('purpose_warm', '따뜻하거나 감동적이었으면 좋겠어요'), _choice('purpose_think', '어떤 문제를 한 번 더 생각했으면 좋겠어요')], /* Q-05 */
      allowCustom: true, customLabel: '내가 바라는 느낌을 직접 적을래요', allowUnsure: true, maxLength: MAX_CORE_LEN,
      sufficientWhen: '전하려는 느낌/생각 방향 있음',
      followUpTrigger: '너무 넓을 때',
    },
    {
      id: 'protagonist', order: 3, g: 'G3',
      title: '누구의 이야기를 만들고 싶나요?',                                  /* Q-07 */
      help: '사람이 아니어도 괜찮아요. 동물이나 상상 속 존재도 주인공이 될 수 있어요.',
      choices: [_choice('protagonist_person', '사람'), _choice('protagonist_animal', '동물이나 생물'), _choice('protagonist_thing', '사물·로봇·상상 속 존재')], /* Q-08 */
      allowCustom: true, customLabel: '직접 적을래요', allowUnsure: true, maxLength: MAX_CORE_LEN,
      sufficientWhen: '대상 분명 + 특징 1가지',
      followUpTrigger: '이름만(특징 없음)',
    },
    {
      id: 'goal', order: 4, g: 'G4',
      title: '주인공이 가장 이루고 싶은 것은 무엇인가요?',                       /* Q-10 */
      help: '주인공이 가장 바라는 것을 떠올려 보세요.',
      choices: [_choice('goal_find', '중요한 사람이나 물건을 찾고 싶어요'), _choice('goal_help', '누군가를 돕거나 지키고 싶어요'), _choice('goal_challenge', '새로운 곳에 가거나 도전하고 싶어요')], /* Q-11 */
      allowCustom: true, customLabel: '직접 적을래요', allowUnsure: true, maxLength: MAX_CORE_LEN,
      sufficientWhen: '원하는 행동·결과 대상이 분명',
      followUpTrigger: '보기만 고르고 대상 빔',
    },
    {
      id: 'obstacle', order: 5, g: 'G5',
      title: '주인공이 원하는 것을 이루기 어렵게 만드는 것은 무엇인가요?',        /* Q-13 */
      help: '주인공이 목표를 이루기 어렵게 만드는 것을 생각해 보세요.',
      choices: [_choice('obstacle_way', '길이나 방법을 찾기 어려워요'), _choice('obstacle_someone', '누군가가 주인공을 방해해요'), _choice('obstacle_inner', '주인공의 두려움이나 약점이 방해해요')], /* Q-14 */
      allowCustom: true, customLabel: '직접 적을래요', allowUnsure: true, maxLength: MAX_CORE_LEN,
      sufficientWhen: '방해 요소 1개 분명',
      followUpTrigger: '너무 넓을 때',
    },
    {
      id: 'branchChoice', order: 6, g: 'G6',
      title: '이야기에서 길이 갈라지는 중요한 선택은 무엇인가요?',               /* Q-16 */
      help: '이야기에서 고민하게 되는 중요한 순간 하나를 떠올려 보세요.',
      choices: [_choice('branch_self', '혼자 해결할지 도움을 요청할지'), _choice('branch_road', '안전한 길과 위험한 길 중 어디로 갈지'), _choice('branch_truth', '진실을 말할지 숨길지')], /* Q-17 */
      allowCustom: true, customLabel: '직접 적을래요', allowUnsure: true, maxLength: MAX_CORE_LEN,
      sufficientWhen: '고민하는 선택 순간 1개 분명',
      followUpTrigger: '너무 넓을 때',
    },
    {
      id: 'protectedCore', order: 7, g: 'G7',
      title: '나중에 이야기를 고칠 때도 바꾸고 싶지 않은 것은 무엇인가요?',        /* Q-19 */
      help: '이야기를 고치더라도 끝까지 지키고 싶은 것을 골라 보세요.',
      choices: [_choice('anchor_character', '주인공의 성격이나 마음'), _choice('anchor_scene', '꼭 넣고 싶은 장면이나 대사'), _choice('anchor_ending', '결말의 의미나 이야기 분위기')], /* Q-20 */
      allowCustom: true, customLabel: '직접 적을래요', allowUnsure: true, maxLength: MAX_CORE_LEN,
      sufficientWhen: '지키고 싶은 중심 1개 분명',
      followUpTrigger: '너무 넓을 때',
    },
  ];

  /* 깊은 freeze(정의 불변성 — 런타임 변조 방지). */
  function _deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const k of Object.keys(o)) _deepFreeze(o[k]);
    }
    return o;
  }
  _deepFreeze(CORE_QUESTIONS);

  function getCoreQuestions() { return CORE_QUESTIONS; }
  function getQuestionById(id) {
    for (const q of CORE_QUESTIONS) if (q.id === id) return q;
    return null;
  }
  function getQuestionByOrder(order) {
    for (const q of CORE_QUESTIONS) if (q.order === order) return q;
    return null;
  }

  /* 단일 질문 정의 검증 — 구조·동등 보기 3개·직접 적기·모르겠어요 원칙. */
  function validateQuestionDefinition(q) {
    const errors = [];
    if (!q || typeof q !== 'object') return { valid: false, errors: ['질문 객체 아님'] };
    if (typeof q.id !== 'string' || !q.id) errors.push('id 누락');
    if (!Number.isInteger(q.order)) errors.push('order 정수 아님');
    if (typeof q.title !== 'string' || q.title.trim().length === 0) errors.push('title 누락');
    if (typeof q.help !== 'string') errors.push('help 누락');
    if (!Array.isArray(q.choices) || q.choices.length !== 3) errors.push('대표 선택지 정확히 3개여야 함');
    else {
      const seen = {};
      q.choices.forEach((c, i) => {
        if (!c || typeof c !== 'object') { errors.push('choice[' + i + '] 객체 아님'); return; }
        if (typeof c.id !== 'string' || !c.id) errors.push('choice[' + i + '] id 누락');
        if (typeof c.label !== 'string' || !c.label.trim()) errors.push('choice[' + i + '] label 누락');
        if (typeof c.value !== 'string' || !c.value.trim()) errors.push('choice[' + i + '] value 누락');
        if (c.id && seen[c.id]) errors.push('choice id 중복: ' + c.id);
        if (c.id) seen[c.id] = true;
      });
    }
    if (q.allowCustom !== true) errors.push('직접 적기(allowCustom) 허용 필수');
    if (typeof q.customLabel !== 'string' || !q.customLabel.trim()) errors.push('customLabel 누락');
    if (q.allowUnsure !== true) errors.push('모르겠어요(allowUnsure) 허용 필수');
    if (!Number.isInteger(q.maxLength) || q.maxLength <= 0) errors.push('maxLength 양의 정수 아님');
    /* movie 전용 질문 금지(생각 나침반=그림책·텍스트만) */
    if (q.projectType && q.projectType !== 'picturebook' && q.projectType !== 'text') errors.push('movie/experience 전용 질문 금지');
    return { valid: errors.length === 0, errors: errors };
  }

  /* 핵심 7질문 집합 검증 — 정확히 7개·id 유일·CORE_QUESTION_KEYS 일치·order 1~7. */
  function validateCoreQuestionSet(arr) {
    const list = arr || CORE_QUESTIONS;
    const errors = [];
    if (!Array.isArray(list)) return { valid: false, errors: ['배열 아님'] };
    if (list.length !== 7) errors.push('핵심 질문은 정확히 7개여야 함 (현재 ' + list.length + ')');
    const ids = {}, orders = {};
    for (const q of list) {
      const r = validateQuestionDefinition(q);
      if (!r.valid) errors.push((q && q.id ? q.id : '?') + ': ' + r.errors.join(', '));
      if (q && q.id) { if (ids[q.id]) errors.push('id 중복: ' + q.id); ids[q.id] = true; }
      if (q && Number.isInteger(q.order)) { if (orders[q.order]) errors.push('order 중복: ' + q.order); orders[q.order] = true; }
    }
    /* id 집합이 CORE_QUESTION_KEYS와 정확히 일치 */
    for (const k of CORE_QUESTION_KEYS) if (!ids[k]) errors.push('CORE_QUESTION_KEYS 누락: ' + k);
    for (const id of Object.keys(ids)) if (CORE_QUESTION_KEYS.indexOf(id) < 0) errors.push('정의되지 않은 키: ' + id);
    /* order는 1~7 연속 */
    for (let i = 1; i <= 7; i++) if (!orders[i]) errors.push('order 누락: ' + i);
    return { valid: errors.length === 0, errors: errors };
  }

  /* 최소 유예 답변("이야기를 만들면서 정할래요") 여부. */
  function isMinimumDeferredAnswer(answer) {
    if (!answer) return false;
    if (typeof answer === 'string') return answer.trim() === MINIMAL_ANSWER;
    if (typeof answer === 'object') {
      if (answer.deferred === true) return true;
      if (answer.answerStatus === 'minimal') return true;
      if (typeof answer.answerText === 'string' && answer.answerText.trim() === MINIMAL_ANSWER) return true;
    }
    return false;
  }

  /* 입력(문자열/선택지/객체/유예) → 정본 답변 객체 { answerText, answerStatus, [choiceId], [deferred] }.
     · 빈 문자열/공백만 → answerStatus 'empty'(빈 답 = 거부 대상, 완료 판정서 미인정).
     · 유예(opts.deferred 또는 MINIMAL_ANSWER 텍스트) → confirmed + deferred:true(빈 답 아님).
     · opts.draft=true → 진행 중 임시 저장(700ms debounce, DATA-02). */
  function normalizeAnswerValue(input, opts) {
    opts = opts || {};
    const maxLen = Number.isInteger(opts.maxLength) && opts.maxLength > 0 ? opts.maxLength : MAX_CORE_LEN;

    if (opts.deferred === true || (typeof input === 'string' && input.trim() === MINIMAL_ANSWER)) {
      return { answerText: MINIMAL_ANSWER, answerStatus: ANSWER_STATUS.CONFIRMED, deferred: true };
    }

    let text = '';
    let choiceId = null;
    if (typeof input === 'string') {
      text = input;
    } else if (input && typeof input === 'object') {
      if (typeof input.answerText === 'string') text = input.answerText;
      else if (typeof input.value === 'string') text = input.value;
      else if (typeof input.label === 'string') text = input.label;
      if (typeof input.choiceId === 'string') choiceId = input.choiceId;
      else if (typeof input.id === 'string') choiceId = input.id;
    }
    text = (text == null ? '' : String(text)).trim();
    if (text.length > maxLen) text = text.slice(0, maxLen);

    const out = {
      answerText: text,
      answerStatus: text.length === 0
        ? ANSWER_STATUS.EMPTY
        : (opts.draft === true ? ANSWER_STATUS.DRAFT : ANSWER_STATUS.CONFIRMED),
    };
    if (choiceId) out.choiceId = choiceId;
    return out;
  }

  /* 답변이 완료 판정상 유효(빈 답 아님)인지 — foundation _answerPresent와 동일 의미. */
  function isAnswerPresent(answer) {
    if (!answer) return false;
    if (typeof answer === 'string') return answer.trim().length > 0;
    if (typeof answer === 'object') {
      if (typeof answer.answerText === 'string' && answer.answerText.trim().length > 0) return true;
      if (answer.answerStatus === ANSWER_STATUS.CONFIRMED || answer.answerStatus === 'minimal' || answer.deferred === true) return true;
    }
    return false;
  }

  return {
    CORE_QUESTION_KEYS, MINIMAL_ANSWER, MAX_CORE_LEN, ANSWER_STATUS, ASSISTANCE_PROMPTS,
    getCoreQuestions, getQuestionById, getQuestionByOrder,
    validateQuestionDefinition, validateCoreQuestionSet,
    normalizeAnswerValue, isMinimumDeferredAnswer, isAnswerPresent,
  };
});
