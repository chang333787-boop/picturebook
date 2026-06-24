/* 생각 나침반 AI 후속질문 분기(클라 순수 로직) 하니스. 실행: node --test tests/thought-compass/followup-flow.test.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const F = require('../../thought-compass-flow.js');

test('NEXT → 다음 핵심으로', () => {
  assert.equal(F.resolveAfterAnswer('NEXT', { followUpsUsed: 0 }).action, 'next');
});
test('ASK_FOLLOW_UP(예산 있음) → 후속 화면', () => {
  assert.equal(F.resolveAfterAnswer('ASK_FOLLOW_UP', { followUpsUsed: 0 }).action, 'followUp');
});
test('ASK_EASIER(예산 있음) → 쉬운 보기', () => {
  assert.equal(F.resolveAfterAnswer('ASK_EASIER', { followUpsUsed: 0 }).action, 'easier');
});
test('null/알수없음 → 다음(안전 통과)', () => {
  assert.equal(F.resolveAfterAnswer(null, { followUpsUsed: 0 }).action, 'next');
  assert.equal(F.resolveAfterAnswer('WHATEVER', { followUpsUsed: 0 }).action, 'next');
});
test('후속 5회 도달 → 후속/쉬운 요청도 다음으로 강제', () => {
  assert.equal(F.resolveAfterAnswer('ASK_FOLLOW_UP', { followUpsUsed: 5 }).action, 'next');
  assert.equal(F.resolveAfterAnswer('ASK_EASIER', { followUpsUsed: 5 }).action, 'next');
});
test('followUpBudgetLeft — 4회까지 가능, 5회 불가', () => {
  assert.equal(F.followUpBudgetLeft({ followUpsUsed: 4 }), true);
  assert.equal(F.followUpBudgetLeft({ followUpsUsed: 5 }), false);
});
test('전체 12문항(7핵심+5후속) 상한 — followUpsUsed 5면 total 12 → 불가', () => {
  /* CORE_TOTAL(7) + followUpsUsed(5) = 12 = TOTAL_MAX → 더 못 물음 */
  assert.equal(F.followUpBudgetLeft({ followUpsUsed: 5 }), false);
  assert.equal(F.CORE_TOTAL + 5, F.TOTAL_MAX);
});
test('빈 meta(followUpsUsed 누락) → 예산 있음', () => {
  assert.equal(F.followUpBudgetLeft({}), true);
  assert.equal(F.resolveAfterAnswer('ASK_FOLLOW_UP', {}).action, 'followUp');
});
