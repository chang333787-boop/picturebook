/* 생각 나침반 모르겠어요 완화 흐름 하니스. 실행: node --test tests/thought-compass/assistance.test.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const F = require('../../thought-compass-flow.js');
const Q = require('../../thought-compass-questions.js');

test('초기 보조단계 0', () => {
  const vm = F.createFlow();
  assert.equal(F.assistanceLevel(vm), 0);
  assert.equal(F.assistancePrompt(vm), '');
});

test('첫 모르겠어요 → 쉬운 단계(1), 유예 아님', () => {
  let vm = F.createFlow();
  const r = F.handleUnsure(vm);
  assert.equal(r.deferred, false);                 /* 첫 클릭 즉시 유예 저장 금지 */
  assert.equal(F.assistanceLevel(r.vm), 1);
  assert.equal(F.assistancePrompt(r.vm), Q.ASSISTANCE_PROMPTS[1]);
  /* 답변은 아직 없음(임의 저장 안 함) */
  assert.equal(F.currentAnswer(r.vm), null);
});

test('쉬운 단계에서도 같은 선택지 3개 + 직접 적기 유지', () => {
  let vm = F.createFlow();
  vm = F.handleUnsure(vm).vm;
  const q = F.currentQuestion(vm);
  assert.equal(q.choices.length, 3);               /* 보기 그대로 3개 */
  assert.equal(q.allowCustom, true);               /* 직접 적기 유지 */
  /* 쉬운 단계에서 보기 선택 가능 */
  vm = F.setChoiceAnswer(vm, q.choices[0].id);
  assert.equal(F.canNext(vm), true);
});

test('두 번째 모르겠어요 → 최종 유예 답변 확정', () => {
  let vm = F.createFlow();
  vm = F.handleUnsure(vm).vm;                       /* 1단계 */
  const r = F.handleUnsure(vm);                     /* 2번째 → 유예 */
  assert.equal(r.deferred, true);
  assert.equal(F.assistanceLevel(r.vm), 2);
  assert.equal(Q.isMinimumDeferredAnswer(F.currentAnswer(r.vm)), true);
});

test('유예 답변 완료 검증 통과', () => {
  const TC = require('../../thought-compass.js');
  let vm = F.createFlow();
  /* 7문항 모두 두 번씩 모르겠어요 → 전부 유예 */
  for (const q of Q.getCoreQuestions()) {
    vm = F.goToQuestionId(vm, q.id);
    vm = F.handleUnsure(vm).vm;
    vm = F.handleUnsure(vm).vm;
  }
  assert.equal(F.allAnswered(vm), true);
  const s = TC.normalizeThoughtCompassState({ status: 'inProgress', completedAt: null, answers: vm.answers });
  assert.equal(TC.validateThoughtCompassCompletion(s).valid, true);
});

test('이전 이동 후 완화 상태 복원', () => {
  let vm = F.createFlow();
  vm = F.handleUnsure(vm).vm;                       /* q1 보조단계 1 */
  vm = F.setChoiceAnswer(vm, F.currentQuestion(vm).choices[0].id);
  vm = F.commitNext(vm);                            /* q2 */
  assert.equal(F.assistanceLevel(vm), 0);          /* 새 질문은 0 */
  vm = F.goPrev(vm);                                /* q1로 복귀 */
  assert.equal(F.assistanceLevel(vm), 1);          /* q1의 보조단계 복원 */
});

test('모르겠어요로 유예 후 직접 적기로 덮어쓰기 가능(되돌리기)', () => {
  let vm = F.createFlow();
  vm = F.handleUnsure(vm).vm;
  vm = F.handleUnsure(vm).vm;                       /* 유예 */
  assert.equal(Q.isMinimumDeferredAnswer(F.currentAnswer(vm)), true);
  vm = F.setCustomAnswer(vm, '직접 적은 답');        /* 마음 바뀌면 덮어쓰기 */
  assert.equal(F.currentAnswer(vm).answerText, '직접 적은 답');
  assert.equal(!!F.currentAnswer(vm).deferred, false);
});
