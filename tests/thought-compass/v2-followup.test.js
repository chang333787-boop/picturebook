/* v2-followup.test.js — COMPASS-V2-FOLLOWUP: 서버 모듈 v1+v2 allowlist·fallback·상한 검증(실 API 0). */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const TC = require('../../functions/thought-compass-followup.js');
const Flow = require('../../thought-compass-flow.js');
const Q = require('../../thought-compass-questions.js');

function baseInput(over) {
  return Object.assign({
    classId: 'C1', teamName: '2모둠', projectType: 'picturebook',
    coreQuestionId: 'protagonist', currentAnswer: '고양이',
    followUpCount: 0, totalQuestionCount: 7,
  }, over || {});
}

/* ── allowlist: v1+v2 합집합 15키 + LEVELS(easy 8키·linear 신규 1키) = 24키 ── */
test('V2FU: allowlist = v1 7키 + v2 10키 합집합 15키 + easy 8 + linear 신규 1 = 24키', () => {
  assert.strictEqual(TC.CORE_QUESTION_KEYS.length, 24);
  for (const k of TC.CORE_QUESTION_KEYS_V1) assert.ok(TC.CORE_QUESTION_KEYS.includes(k), 'v1 누락: ' + k);
  for (const k of TC.CORE_QUESTION_KEYS_V2) assert.ok(TC.CORE_QUESTION_KEYS.includes(k), 'v2 누락: ' + k);
  for (const k of TC.CORE_QUESTION_KEYS_EASY) assert.ok(TC.CORE_QUESTION_KEYS.includes(k), 'easy 누락: ' + k);
  assert.ok(TC.CORE_QUESTION_KEYS.includes('protagonistName'), 'linear 신규 누락: protagonistName');
  /* 클라 정본과 교차검증 */
  assert.deepStrictEqual(TC.CORE_QUESTION_KEYS_V1.slice(), Q.CORE_QUESTION_KEYS.slice());
  assert.deepStrictEqual(TC.CORE_QUESTION_KEYS_V2.slice(), Q.CORE_QUESTION_KEYS_V2.slice());
  assert.deepStrictEqual(TC.CORE_QUESTION_KEYS_EASY.slice(), Q.CORE_QUESTION_KEYS_EASY.slice());
});

test('V2FU: v1 키 전부 입력 통과(회귀 0)', () => {
  for (const k of TC.CORE_QUESTION_KEYS_V1) {
    assert.strictEqual(TC.validateFollowUpInput(baseInput({ coreQuestionId: k })).ok, true, k);
  }
});

test('V2FU: v2 키 전부 입력 통과(totalQuestionCount 10)', () => {
  for (const k of TC.CORE_QUESTION_KEYS_V2) {
    assert.strictEqual(TC.validateFollowUpInput(baseInput({ coreQuestionId: k, totalQuestionCount: 10 })).ok, true, k);
  }
});

test('V2FU: invalid 키 여전히 거부', () => {
  assert.strictEqual(TC.validateFollowUpInput(baseInput({ coreQuestionId: 'nope' })).ok, false);
  assert.strictEqual(TC.validateFollowUpInput(baseInput({ coreQuestionId: 'body' })).ok, false);
});

test('V2FU: priorSummaries — v2 키 10개 동봉 허용(MAX_SUMMARIES 10)', () => {
  const summaries = TC.CORE_QUESTION_KEYS_V2.map(k => ({ key: k, text: '답 ' + k }));
  const r = TC.validateFollowUpInput(baseInput({ coreQuestionId: 'trueEnding', totalQuestionCount: 10, priorSummaries: summaries }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.priorSummaries.length, 10);
  /* 11개(중복 추가)는 거부 */
  const over = summaries.concat([{ key: 'protagonist', text: 'x' }]);
  assert.strictEqual(TC.validateFollowUpInput(baseInput({ priorSummaries: over })).ok, false);
});

/* ── 상한: MAX_TOTAL 15 ── */
test('V2FU: totalQuestionCount 15까지 유효·16 거부·shouldForceNext', () => {
  assert.strictEqual(TC.MAX_TOTAL, 15);
  assert.strictEqual(TC.validateFollowUpInput(baseInput({ totalQuestionCount: 15 })).ok, true);
  assert.strictEqual(TC.validateFollowUpInput(baseInput({ totalQuestionCount: 16 })).ok, false);
  assert.strictEqual(TC.shouldForceNext({ followUpCount: 0, totalQuestionCount: 15 }), true);   /* 15 도달 → NEXT 강제 */
  assert.strictEqual(TC.shouldForceNext({ followUpCount: 5, totalQuestionCount: 12 }), true);   /* 후속 5 소진 */
  assert.strictEqual(TC.shouldForceNext({ followUpCount: 4, totalQuestionCount: 14 }), false);
});

/* ── fallback: v1 유지 + v2 3키 ── */
test('V2FU: fallback — v1 protagonist/goal 유지(회귀 0)', () => {
  assert.strictEqual(TC.followUpFallback('protagonist').decision, 'ASK_FOLLOW_UP');
  assert.strictEqual(TC.followUpFallback('goal').decision, 'ASK_FOLLOW_UP');
  assert.strictEqual(TC.followUpFallback('audience').decision, 'NEXT');
});

test('V2FU: fallback — v2 trueEnding/keyChoice/incitingEvent 고정 후속·나머지 NEXT', () => {
  for (const k of ['trueEnding', 'keyChoice', 'incitingEvent']) {
    const f = TC.followUpFallback(k);
    assert.strictEqual(f.decision, 'ASK_FOLLOW_UP', k);
    assert.ok(f.followUpQuestion.length > 0 && f.followUpQuestion.length <= TC.MAX_FOLLOWUP_Q_LEN, k);
    assert.strictEqual(f.fallback, true);
    /* 평가어 금지 준수 */
    for (const w of TC.BANNED_ACK_WORDS) assert.ok(!f.followUpQuestion.includes(w), k + ' 평가어: ' + w);
    /* validator 자체 통과(출력 스키마 정합) */
    assert.strictEqual(TC.validateFollowUpResponse(Object.assign({}, f)).ok, true, k);
  }
  for (const k of ['mainlineStart', 'risingTrouble', 'alternatePath', 'coreMessage', 'targetLength']) {
    assert.strictEqual(TC.followUpFallback(k).decision, 'NEXT', k);
  }
});

/* ── user message: v2 brief 라벨 사용 ── */
test('V2FU: buildFollowUpUserMessage — v2 키 라벨 포함·PII 없음', () => {
  const msg = TC.buildFollowUpUserMessage({
    projectType: 'picturebook', coreQuestionId: 'trueEnding', currentAnswer: '주인공이 웃으며 끝나요',
    followUpCount: 1, totalQuestionCount: 11,
    priorSummaries: [{ key: 'mainlineStart', text: '평범한 하루' }],
  });
  assert.ok(msg.includes('진엔딩'));
  assert.ok(msg.includes('이야기의 시작 장면'));
  assert.ok(msg.includes('1 / 5'));
  assert.ok(msg.includes('11 / 15'));
});

/* ── 클라 flow 상한(세트별) ── */
test('V2FU: flow.followUpBudgetLeft — v1(7)=12 상한·v2(10)=15 상한', () => {
  /* v1: 7+5=12 도달 시 중단 */
  assert.strictEqual(Flow.followUpBudgetLeft({ followUpsUsed: 4, coreTotal: 7 }), true);
  assert.strictEqual(Flow.followUpBudgetLeft({ followUpsUsed: 5, coreTotal: 7 }), false);
  /* v2: 10+5=15 도달 시 중단 */
  assert.strictEqual(Flow.followUpBudgetLeft({ followUpsUsed: 4, coreTotal: 10 }), true);
  assert.strictEqual(Flow.followUpBudgetLeft({ followUpsUsed: 5, coreTotal: 10 }), false);
  /* coreTotal 미지정 = 기존 v1 동작(하위호환) */
  assert.strictEqual(Flow.followUpBudgetLeft({ followUpsUsed: 4 }), true);
  assert.strictEqual(Flow.followUpBudgetLeft({ followUpsUsed: 5 }), false);
  assert.strictEqual(Flow.TOTAL_MAX, 12);
  assert.strictEqual(Flow.TOTAL_MAX_V2, 15);
});
