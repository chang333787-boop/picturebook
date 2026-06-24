/* 생각 나침반 질문 흐름 view-model 하니스. 실행: node --test tests/thought-compass/flow.test.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const F = require('../../thought-compass-flow.js');
const Q = require('../../thought-compass-questions.js');

test('초기 렌더 — 1번 질문(audience)', () => {
  const vm = F.createFlow();
  assert.equal(F.currentQuestion(vm).id, 'audience');
  assert.equal(F.progress(vm).label, '생각 나침반 1 / 7');
  assert.equal(F.isFirst(vm), true);
  assert.equal(F.canPrev(vm), false);
});

test('선택지 선택 → 답변 확정', () => {
  let vm = F.createFlow();
  vm = F.setChoiceAnswer(vm, 'audience_family');
  const a = F.currentAnswer(vm);
  assert.equal(a.answerText, '가족');
  assert.equal(a.choiceId, 'audience_family');
  assert.equal(F.canNext(vm), true);
});

test('직접 적기 → 답변 확정', () => {
  let vm = F.createFlow();
  vm = F.setCustomAnswer(vm, '옆 반 친구들');
  assert.equal(F.currentAnswer(vm).answerText, '옆 반 친구들');
  assert.equal(F.canNext(vm), true);
});

test('선택지 → 직접 적기 전환(선택지 해제)', () => {
  let vm = F.createFlow();
  vm = F.setChoiceAnswer(vm, 'audience_family');
  vm = F.setCustomAnswer(vm, '할머니');
  const a = F.currentAnswer(vm);
  assert.equal(a.answerText, '할머니');
  assert.equal(a.choiceId, undefined);
});

test('직접 적기 → 선택지 전환', () => {
  let vm = F.createFlow();
  vm = F.setCustomAnswer(vm, '할머니');
  vm = F.setChoiceAnswer(vm, 'audience_class');
  const a = F.currentAnswer(vm);
  assert.equal(a.answerText, '우리 반 친구들');
  assert.equal(a.choiceId, 'audience_class');
});

test('답변 없음 → next 차단', () => {
  const vm = F.createFlow();
  assert.equal(F.canNext(vm), false);
});

test('빈/공백 직접 적기 → next 차단', () => {
  let vm = F.createFlow();
  vm = F.setCustomAnswer(vm, '   ');
  assert.equal(F.canNext(vm), false);
});

test('진행률 — 다음 이동 시 N/7 증가', () => {
  let vm = F.createFlow();
  vm = F.setChoiceAnswer(vm, 'audience_family');
  vm = F.commitNext(vm);
  assert.equal(F.progress(vm).current, 2);
  assert.equal(F.currentQuestion(vm).id, 'purpose');
});

test('이전 버튼 — index 감소 + 답변 보존', () => {
  let vm = F.createFlow();
  vm = F.setChoiceAnswer(vm, 'audience_family');
  vm = F.commitNext(vm);
  vm = F.setChoiceAnswer(vm, 'purpose_warm');
  vm = F.goPrev(vm);
  assert.equal(F.currentQuestion(vm).id, 'audience');
  assert.equal(F.currentAnswer(vm).answerText, '가족');     /* 이전 답변 복원 */
  /* 앞으로 가도 두번째 답 보존 */
  vm = F.commitNext(vm);
  assert.equal(F.answerFor(vm, 'purpose').answerText, '따뜻하거나 감동적이었으면 좋겠어요');
});

test('이전 답변 복원 — resume', () => {
  const vm = F.createFlow({ resume: { index: 2, answers: { audience: { answerText: '가족', answerStatus: 'confirmed' } } } });
  assert.equal(vm.index, 2);
  assert.equal(F.answerFor(vm, 'audience').answerText, '가족');
});

test('마지막 질문 — isLast, commitNext는 index 유지', () => {
  let vm = F.createFlow({ resume: { index: 6 } });
  assert.equal(F.isLast(vm), true);
  vm = F.setChoiceAnswer(vm, 'anchor_ending');
  const after = F.commitNext(vm);
  assert.equal(after.index, 6);   /* 마지막에서 더 안 넘어감(검토 화면으로) */
});

test('저장 실패 시 index 이동 금지 — commitNext를 호출 안 하면 index 불변', () => {
  let vm = F.createFlow();
  vm = F.setChoiceAnswer(vm, 'audience_family');
  /* 저장 실패 시뮬: commitNext 미호출 */
  assert.equal(vm.index, 0);
  /* buildSavePatch는 다음 index를 담되, 실제 이동은 commitNext가 결정 */
  const patch = F.buildSavePatch(vm, { index: 1 });
  assert.equal(patch.currentQuestionIndex, 1);
  assert.ok(patch.answers.audience);
});

test('중복 next 방지 — 동일 vm 재호출 결정성', () => {
  let vm = F.createFlow();
  vm = F.setChoiceAnswer(vm, 'audience_family');
  const a = F.commitNext(vm);
  const b = F.commitNext(vm);   /* 같은 vm으로 두 번 → 같은 결과(index 2 아님) */
  assert.equal(a.index, b.index);
  assert.equal(a.index, 1);
});

test('유예 답변 → next 가능', () => {
  let vm = F.createFlow();
  vm = F.setDeferredAnswer(vm);
  assert.equal(F.canNext(vm), true);
  assert.equal(Q.isMinimumDeferredAnswer(F.currentAnswer(vm)), true);
});

test('goToQuestionId — 특정 질문 점프(고치기)', () => {
  let vm = F.createFlow();
  vm = F.goToQuestionId(vm, 'goal');
  assert.equal(F.currentQuestion(vm).id, 'goal');
  assert.equal(vm.index, 3);
});

test('allAnswered — 7개 모두 채워야 true', () => {
  let vm = F.createFlow();
  assert.equal(F.allAnswered(vm), false);
  for (const q of Q.getCoreQuestions()) {
    vm = F.goToQuestionId(vm, q.id);
    vm = F.setDeferredAnswer(vm);
  }
  assert.equal(F.allAnswered(vm), true);
});

test('maxLength 클램프 — 직접 적기 200자', () => {
  let vm = F.createFlow();
  vm = F.setCustomAnswer(vm, '가'.repeat(300));
  assert.equal(F.currentAnswer(vm).answerText.length, 200);
});
