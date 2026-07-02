/* v2-questions.test.js — STORY-COMPASS-V2 10문항·version 분리·하위호환 검증.
   정본: docs/story_compass_v2_question_design_20260702.md (A안). */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Q = require('../../thought-compass-questions.js');
const TC = require('../../thought-compass.js');

/* ── 질문 세트 ── */
test('V2: getCoreQuestions(2) = 10문항, 기본/1 = 기존 7문항(하위호환)', () => {
  assert.strictEqual(Q.getCoreQuestions(2).length, 10);
  assert.strictEqual(Q.getCoreQuestions().length, 7);
  assert.strictEqual(Q.getCoreQuestions(1).length, 7);
});

test('V2: 키 집합·순서 = A안 정본(재료→한줄기→분기→앵커)', () => {
  const ids = Q.getCoreQuestions(2).map(q => q.id);
  assert.deepStrictEqual(ids, ['targetLength', 'protagonist', 'goal', 'mainlineStart', 'incitingEvent', 'risingTrouble', 'keyChoice', 'trueEnding', 'alternatePath', 'coreMessage']);
  assert.deepStrictEqual(ids, Q.CORE_QUESTION_KEYS_V2.slice());
  assert.deepStrictEqual(ids, TC.CORE_QUESTION_KEYS_V2.slice());   /* 모듈 간 교차검증 */
});

test('V2: 세트 검증 통과(validateCoreQuestionSet version 2)', () => {
  const r = Q.validateCoreQuestionSet(null, 2);
  assert.strictEqual(r.valid, true, r.errors.join(' / '));
});

test('V1: 세트 검증 여전히 통과(기존 7문항 불변)', () => {
  const r = Q.validateCoreQuestionSet();
  assert.strictEqual(r.valid, true, r.errors.join(' / '));
});

test('V2: targetLength만 보기 전용(allowCustom=false), 나머지 9개는 직접 적기 허용', () => {
  const qs = Q.getCoreQuestions(2);
  for (const q of qs) {
    if (q.id === 'targetLength') {
      assert.strictEqual(q.allowCustom, false);
      assert.strictEqual(q.allowUnsure, true);   /* "아직 모르겠어요" = 공통 유예 흐름 */
      assert.deepStrictEqual(q.choices.map(c => c.id), ['targetlen_8', 'targetlen_12', 'targetlen_15']);
    } else {
      assert.strictEqual(q.allowCustom, true, q.id);
    }
  }
});

test('V2: audience/purpose는 질문에서 제외(결과지 표지 칸으로 강등)', () => {
  const ids = Q.getCoreQuestions(2).map(q => q.id);
  assert.ok(!ids.includes('audience'));
  assert.ok(!ids.includes('purpose'));
});

test('V2: getQuestionById/ByOrder version 라우팅', () => {
  assert.strictEqual(Q.getQuestionById('targetLength', 2).order, 1);
  assert.strictEqual(Q.getQuestionById('targetLength'), null);          /* v1엔 없음 */
  assert.strictEqual(Q.getQuestionById('audience').id, 'audience');     /* v1 그대로 */
  assert.strictEqual(Q.getQuestionByOrder(8, 2).id, 'trueEnding');
});

/* ── version 판별/보존 ── */
test('V2: resolveQuestionSetVersion — fresh/notStarted→2, v1 진행·완료→1, version 2→2', () => {
  assert.strictEqual(TC.resolveQuestionSetVersion(null), 2);
  assert.strictEqual(TC.resolveQuestionSetVersion({}), 2);
  assert.strictEqual(TC.resolveQuestionSetVersion({ status: 'notStarted' }), 2);
  assert.strictEqual(TC.resolveQuestionSetVersion({ version: 2, status: 'inProgress' }), 2);
  assert.strictEqual(TC.resolveQuestionSetVersion({ version: 1, status: 'inProgress', answers: { audience: { answerText: '가족' } } }), 1);
  assert.strictEqual(TC.resolveQuestionSetVersion({ status: 'completed', completedAt: 1, answers: { audience: { answerText: '가족' } } }), 1);
});

test('V2: version 필드 유실 시 v2 전용 answer 키로 자가복구', () => {
  assert.strictEqual(TC.resolveQuestionSetVersion({ status: 'inProgress', answers: { targetLength: { answerText: '보통으로 만들래요 (약 12장면)' } } }), 2);
  assert.strictEqual(TC.resolveQuestionSetVersion({ status: 'inProgress', answers: { trueEnding: { answerText: '원하는 것을 이루어요' } } }), 2);
});

test('V2: normalize가 version 2 보존(1로 강제 덮어쓰지 않음)', () => {
  const s = TC.normalizeThoughtCompassState({ version: 2, status: 'inProgress', answers: {} });
  assert.strictEqual(s.version, 2);
  const s1 = TC.normalizeThoughtCompassState({ version: 1, status: 'inProgress' });
  assert.strictEqual(s1.version, 1);
  const sX = TC.normalizeThoughtCompassState({ version: 99, status: 'inProgress' });
  assert.strictEqual(sX.version, 1);   /* 이상값 → 1 */
});

/* ── 완료 판정 ── */
function _answers(keys) {
  const out = {};
  for (const k of keys) out[k] = { answerText: '답 ' + k, answerStatus: 'confirmed' };
  return out;
}
test('V2: 완료 판정 — version 2는 10키 전부 필요, 7키만으로는 미완료', () => {
  const ten = _answers(TC.CORE_QUESTION_KEYS_V2);
  assert.strictEqual(TC.validateThoughtCompassCompletion({ version: 2, status: 'inProgress', answers: ten }).valid, true);
  const seven = _answers(TC.CORE_QUESTION_KEYS_V2.slice(0, 7));
  const r = TC.validateThoughtCompassCompletion({ version: 2, status: 'inProgress', answers: seven });
  assert.strictEqual(r.valid, false);
  assert.deepStrictEqual(r.missing, ['trueEnding', 'alternatePath', 'coreMessage']);
});

test('V1: 완료 판정 — 기존 7키 그대로(v2 키 불요·하위호환)', () => {
  const seven = _answers(TC.CORE_QUESTION_KEYS);
  assert.strictEqual(TC.validateThoughtCompassCompletion({ version: 1, status: 'inProgress', answers: seven }).valid, true);
});

/* ── plan version 스탬프 ── */
const CTX = { classId: 'c1', teamName: '모둠1' };
test('V2: planMarkStarted — fresh 시작은 version 2 스탬프', () => {
  const p = TC.planMarkStarted(CTX, null);
  assert.strictEqual(p.update.version, 2);
  assert.strictEqual(p.update.status, 'inProgress');
});
test('V2: planMarkStarted — v1 진행 중 세션은 version 미변경(v1 완주 보장)', () => {
  const p = TC.planMarkStarted(CTX, { version: 1, status: 'inProgress' });
  assert.ok(!('version' in p.update));
});
test('V2: planSaveProgress — v2 세션 저장 시 version 2 재스탬프(자가복구)', () => {
  const p = TC.planSaveProgress(CTX, { version: 2, status: 'inProgress' }, { currentQuestionIndex: 3 });
  assert.strictEqual(p.update.version, 2);
});
test('V2: planSaveProgress — v1 세션 저장은 version 미기록(불변)', () => {
  const p = TC.planSaveProgress(CTX, { version: 1, status: 'inProgress' }, { currentQuestionIndex: 3 });
  assert.ok(!('version' in p.update));
});
test('V2: planMarkCompleted — 세션 version 보존(2는 2로, 1은 1로)', () => {
  assert.strictEqual(TC.planMarkCompleted(CTX, { version: 2, status: 'inProgress' }).update.version, 2);
  assert.strictEqual(TC.planMarkCompleted(CTX, { version: 1, status: 'inProgress' }).update.version, 1);
});

/* ── flow 통합 ── */
test('V2: createFlow({version:2}) = 10문항 vm, 기본 = 7문항(기존 호출 하위호환)', () => {
  const Flow = require('../../thought-compass-flow.js');
  const vm2 = Flow.createFlow({ version: 2 });
  assert.strictEqual(vm2.total, 10);
  assert.strictEqual(Flow.currentQuestion(vm2).id, 'targetLength');
  const vm1 = Flow.createFlow({});
  assert.strictEqual(vm1.total, 7);
});

test('V2: flow — targetLength 보기 선택→진행, 10번째가 마지막', () => {
  const Flow = require('../../thought-compass-flow.js');
  let vm = Flow.createFlow({ version: 2 });
  vm = Flow.setChoiceAnswer(vm, 'targetlen_12');
  assert.strictEqual(Flow.canNext(vm), true);
  assert.strictEqual(vm.answers.targetLength.choiceId, 'targetlen_12');
  for (let i = 0; i < 9; i++) {
    vm = Flow.commitNext(vm);
    vm = Flow.setChoiceAnswer(vm, Flow.currentQuestion(vm).choices[0].id);
  }
  assert.strictEqual(Flow.isLast(vm), true);
  assert.strictEqual(Flow.currentQuestion(vm).id, 'coreMessage');
  assert.strictEqual(Flow.allAnswered(vm), true);
});
