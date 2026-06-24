/* 생각 나침반 완료 판정·story seed 하니스. 실제 7문항 UI/자동생성 없음. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const TC = require('../../thought-compass.js');

function fullAnswers() {
  const a = {};
  for (const k of TC.CORE_QUESTION_KEYS) a[k] = { answerText: k + '-답', answerStatus: 'confirmed' };
  return a;
}

test('7개 핵심 답변 충족 → valid', () => {
  const v = TC.validateThoughtCompassCompletion({ status: 'inProgress', completedAt: null, answers: fullAnswers() });
  assert.equal(v.valid, true);
  assert.equal(v.missing.length, 0);
});
test('누락 시 invalid + missing 목록', () => {
  const a = fullAnswers(); delete a.goal; delete a.obstacle;
  const v = TC.validateThoughtCompassCompletion({ status: 'inProgress', completedAt: null, answers: a });
  assert.equal(v.valid, false);
  assert.deepEqual(v.missing.sort(), ['goal', 'obstacle']);
});
test('"이야기를 만들면서 정할래요" 최소 답변 인정', () => {
  const a = fullAnswers();
  a.goal = { answerText: TC.MINIMAL_ANSWER };
  a.protagonist = { answerText: '', answerStatus: 'minimal' };
  const v = TC.validateThoughtCompassCompletion({ status: 'inProgress', completedAt: null, answers: a });
  assert.equal(v.valid, true);
});
test('follow-up 수와 무관하게 완료', () => {
  const v = TC.validateThoughtCompassCompletion({ status: 'inProgress', completedAt: null, answers: fullAnswers(), followUps: [] });
  const v2 = TC.validateThoughtCompassCompletion({ status: 'inProgress', completedAt: null, answers: fullAnswers(), followUps: [{ q: 'x' }, { q: 'y' }] });
  assert.equal(v.valid, true); assert.equal(v2.valid, true);
});
test('planCompleteIfValid — 미충족이면 plan 없음', () => {
  const r = TC.planCompleteIfValid({ classId: 'C1', teamName: 't' }, { status: 'inProgress', completedAt: null, answers: {} });
  assert.equal(r.ok, false);
  assert.ok(r.missing.length > 0);
});
test('planCompleteIfValid — 충족이면 completed plan', () => {
  const r = TC.planCompleteIfValid({ classId: 'C1', teamName: 't' }, { status: 'inProgress', completedAt: null, answers: fullAnswers() });
  assert.equal(r.ok, true);
  assert.equal(r.plan.update.status, 'completed');
});
test('buildStorySeedFromAnswers — seed 7항목 + 권장 10장면', () => {
  const seed = TC.buildStorySeedFromAnswers({ status: 'completed', completedAt: 1, projectType: 'picturebook', answers: fullAnswers() });
  assert.equal(seed.recommendedSceneCount, 10);
  assert.equal(seed.projectType, 'picturebook');
  assert.ok(seed.protagonistHint.includes('protagonist'));
});
test('canGenerateDefaultScenes — 기존 scenes 있으면 생성 금지', () => {
  assert.equal(TC.canGenerateDefaultScenes({ projectType: 'picturebook', hasExistingScenes: true }), false);
});
test('canGenerateDefaultScenes — 신규 빈 작품만 허용', () => {
  assert.equal(TC.canGenerateDefaultScenes({ projectType: 'text', hasExistingScenes: false }), true);
});
test('canGenerateDefaultScenes — movie 생성 금지', () => {
  assert.equal(TC.canGenerateDefaultScenes({ projectType: 'movie', hasExistingScenes: false }), false);
});
