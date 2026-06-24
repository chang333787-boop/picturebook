/* 생각 나침반 핵심 질문 정의 하니스. 실행: node --test tests/thought-compass/questions.test.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Q = require('../../thought-compass-questions.js');
const TC = require('../../thought-compass.js');

test('핵심 질문은 정확히 7개', () => {
  assert.equal(Q.getCoreQuestions().length, 7);
});

test('id 중복 없음 + CORE_QUESTION_KEYS와 정확히 일치', () => {
  const ids = Q.getCoreQuestions().map(q => q.id);
  assert.equal(new Set(ids).size, 7);
  assert.deepEqual([...ids].sort(), [...Q.CORE_QUESTION_KEYS].sort());
});

test('질문 키가 thought-compass.js CORE_QUESTION_KEYS와 교차 일치', () => {
  assert.deepEqual([...Q.CORE_QUESTION_KEYS].sort(), [...TC.CORE_QUESTION_KEYS].sort());
});

test('MINIMAL_ANSWER가 thought-compass.js와 일치', () => {
  assert.equal(Q.MINIMAL_ANSWER, TC.MINIMAL_ANSWER);
});

test('order 1~7 (중복/누락 없음)', () => {
  const orders = Q.getCoreQuestions().map(q => q.order).sort((a, b) => a - b);
  assert.deepEqual(orders, [1, 2, 3, 4, 5, 6, 7]);
});

test('각 질문 대표 선택지 정확히 3개', () => {
  for (const q of Q.getCoreQuestions()) assert.equal(q.choices.length, 3, q.id + ' 선택지 수');
});

test('각 질문 직접 적기(custom) 허용 + customLabel 존재', () => {
  for (const q of Q.getCoreQuestions()) {
    assert.equal(q.allowCustom, true, q.id);
    assert.ok(q.customLabel && q.customLabel.trim().length > 0, q.id);
  }
});

test('각 질문 모르겠어요(unsure) 허용', () => {
  for (const q of Q.getCoreQuestions()) assert.equal(q.allowUnsure, true, q.id);
});

test('movie/experience 전용 질문 없음', () => {
  for (const q of Q.getCoreQuestions()) {
    assert.ok(!q.projectType || q.projectType === 'picturebook' || q.projectType === 'text', q.id);
  }
  assert.equal(Q.validateCoreQuestionSet().valid, true);
});

test('validateCoreQuestionSet — 정본 통과', () => {
  const r = Q.validateCoreQuestionSet();
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('validateCoreQuestionSet — 6개면 거부', () => {
  const six = Q.getCoreQuestions().slice(0, 6);
  assert.equal(Q.validateCoreQuestionSet(six).valid, false);
});

test('validateQuestionDefinition — 선택지 2개면 거부', () => {
  const bad = { id: 'x', order: 1, title: 't', help: 'h', choices: [{ id: 'a', label: 'A', value: 'A' }, { id: 'b', label: 'B', value: 'B' }], allowCustom: true, customLabel: 'c', allowUnsure: true, maxLength: 200 };
  assert.equal(Q.validateQuestionDefinition(bad).valid, false);
});

test('validateQuestionDefinition — custom 미허용이면 거부', () => {
  const q0 = Q.getQuestionById('audience');
  const bad = Object.assign({}, q0, { allowCustom: false });
  assert.equal(Q.validateQuestionDefinition(bad).valid, false);
});

test('getQuestionById / getQuestionByOrder', () => {
  assert.equal(Q.getQuestionById('goal').order, 4);
  assert.equal(Q.getQuestionByOrder(4).id, 'goal');
  assert.equal(Q.getQuestionById('nope'), null);
});

test('직접 적기 빈 문자열/공백 거부 (answerStatus empty, 미인정)', () => {
  const a1 = Q.normalizeAnswerValue('');
  const a2 = Q.normalizeAnswerValue('    ');
  assert.equal(a1.answerStatus, 'empty');
  assert.equal(a2.answerStatus, 'empty');
  assert.equal(Q.isAnswerPresent(a1), false);
  assert.equal(Q.isAnswerPresent(a2), false);
});

test('직접 적기 정상 입력 → confirmed + 인정', () => {
  const a = Q.normalizeAnswerValue('말하는 고양이');
  assert.equal(a.answerText, '말하는 고양이');
  assert.equal(a.answerStatus, 'confirmed');
  assert.equal(Q.isAnswerPresent(a), true);
});

test('선택지 객체 입력 → value를 answerText로, choiceId 보존', () => {
  const a = Q.normalizeAnswerValue({ choiceId: 'goal_find', value: '중요한 사람이나 물건을 찾고 싶어요' });
  assert.equal(a.answerText, '중요한 사람이나 물건을 찾고 싶어요');
  assert.equal(a.choiceId, 'goal_find');
  assert.equal(a.answerStatus, 'confirmed');
});

test('draft 입력 → answerStatus draft', () => {
  const a = Q.normalizeAnswerValue('적는 중', { draft: true });
  assert.equal(a.answerStatus, 'draft');
});

test('최대 길이(200) 초과 시 잘림', () => {
  const a = Q.normalizeAnswerValue('가'.repeat(250), { maxLength: 200 });
  assert.equal(a.answerText.length, 200);
});

test('최종 유예 답변 인정 (deferred)', () => {
  const a = Q.normalizeAnswerValue(null, { deferred: true });
  assert.equal(a.answerText, Q.MINIMAL_ANSWER);
  assert.equal(a.deferred, true);
  assert.equal(Q.isMinimumDeferredAnswer(a), true);
  assert.equal(Q.isAnswerPresent(a), true);
  /* foundation 완료 판정에서도 유효 답변으로 인정 */
  const s = TC.normalizeThoughtCompassState({ status: 'inProgress', completedAt: null, answers: { audience: a } });
  assert.ok(TC.validateThoughtCompassCompletion(s).missing.indexOf('audience') < 0);
});

test('MINIMAL_ANSWER 문자열도 유예로 인식', () => {
  assert.equal(Q.isMinimumDeferredAnswer(Q.MINIMAL_ANSWER), true);
  const a = Q.normalizeAnswerValue(Q.MINIMAL_ANSWER);
  assert.equal(a.deferred, true);
});

test('정의 객체 불변성 (deep frozen)', () => {
  const qs = Q.getCoreQuestions();
  assert.equal(Object.isFrozen(qs), true);
  assert.equal(Object.isFrozen(qs[0]), true);
  assert.equal(Object.isFrozen(qs[0].choices), true);
  assert.equal(Object.isFrozen(qs[0].choices[0]), true);
  assert.throws(() => { qs[0].title = '변조'; }, TypeError);
});

test('ASSISTANCE_PROMPTS 1·2단계 존재', () => {
  assert.ok(typeof Q.ASSISTANCE_PROMPTS[1] === 'string' && Q.ASSISTANCE_PROMPTS[1].length > 0);
  assert.ok(typeof Q.ASSISTANCE_PROMPTS[2] === 'string' && Q.ASSISTANCE_PROMPTS[2].length > 0);
});
