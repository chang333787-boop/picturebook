/* 생각 나침반 저장 plan 하니스 — write 경로 안전성(team root·scenes 미접근) + 완료 보호 + 멱등. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const TC = require('../../thought-compass.js');

const CTX = { classId: 'C1', teamName: '2모둠' };
const ENC = 'classes/C1/teams/2%EB%AA%A8%EB%91%A0';

function assertChildPathOnly(path) {
  /* writingGuide/preWriting 또는 onboarding 하위만 — scenes·viewer-meta·account·members·locks·team root 금지 */
  assert.ok(path.startsWith(ENC + '/writingGuide/preWriting') || path.startsWith(ENC + '/onboarding'),
    'unexpected path: ' + path);
  for (const forbidden of ['/scenes', '/viewer-meta', '/account', '/members', '/locks']) {
    assert.ok(!path.includes(forbidden), 'forbidden segment in path: ' + path);
  }
  assert.notEqual(path, ENC, 'team root write 금지');
}

test('planMarkStarted — preWriting child만, status=inProgress', () => {
  const p = TC.planMarkStarted(CTX, null);
  assertChildPathOnly(p.path);
  assert.equal(p.update.status, 'inProgress');
  assert.equal(p.update.startedAt, TC.SERVER_TS);
});
test('planMarkStarted 멱등 — 이미 진행 중이면 status 재설정 안 함', () => {
  const p = TC.planMarkStarted(CTX, { status: 'inProgress', startedAt: 1, completedAt: null });
  assert.equal('status' in p.update, false);   /* startedAt 보존(덮어쓰지 않음) */
});
test('planSaveProgress — index/answers child update만', () => {
  const p = TC.planSaveProgress(CTX, { status: 'inProgress', completedAt: null }, { currentQuestionIndex: 3, answers: { q1: { answerText: 'a' } } });
  assertChildPathOnly(p.path);
  assert.equal(p.update.currentQuestionIndex, 3);
  assert.equal(p.update.answers.q1.answerText, 'a');
});
test('planSaveProgress — 완료 상태를 진행으로 되돌리지 않음', () => {
  const p = TC.planSaveProgress(CTX, { status: 'completed', completedAt: 9 }, { currentQuestionIndex: 1 });
  assert.notEqual(p.update.status, 'inProgress');
});
test('planSaveProgress — answers 내 비밀필드 제거', () => {
  const p = TC.planSaveProgress(CTX, { status: 'inProgress', completedAt: null }, { answers: { q1: { answerText: 'a', pin: '1234' } } });
  assert.equal('pin' in p.update.answers.q1, false);
  assert.ok(!JSON.stringify(p.update).includes('1234'));
});
test('planMarkCompleted — status=completed + completedAt', () => {
  const p = TC.planMarkCompleted(CTX, { status: 'inProgress', completedAt: null });
  assert.equal(p.update.status, 'completed');
  assert.equal(p.update.completedAt, TC.SERVER_TS);
});
test('planMarkCompleted 멱등 — 이미 완료면 completedAt 재설정 안 함', () => {
  const p = TC.planMarkCompleted(CTX, { status: 'completed', completedAt: 9 });
  assert.equal('completedAt' in p.update, false);
});
test('planResetCompassOnly — preWriting만 notStarted, onboarding/scenes 미접근', () => {
  const p = TC.planResetCompassOnly(CTX);
  assertChildPathOnly(p.path);
  assert.ok(p.path.includes('/writingGuide/preWriting'));
  assert.equal(p.update.status, 'notStarted');
});
test('planCopyResetOnboarding — onboarding/version 재부여 + writingGuide null', () => {
  const p = TC.planCopyResetOnboarding(CTX, 'picturebook');
  assert.equal(p.onboardingVersion.path, ENC + '/onboarding/version');
  assert.equal(p.onboardingVersion.value, 1);
  assert.equal(p.clearWritingGuide.value, null);
  assert.ok(!p.onboardingVersion.path.includes('viewer-meta'));
});
test('planCopyResetOnboarding — movie엔 onboardingVersion 미부여', () => {
  const p = TC.planCopyResetOnboarding(CTX, 'movie');
  assert.equal(p.onboardingVersion.value, null);
});
test('모든 plan은 team root/scenes를 절대 쓰지 않음', () => {
  const plans = [
    TC.planMarkStarted(CTX, null),
    TC.planSaveProgress(CTX, {}, { currentQuestionIndex: 1 }),
    TC.planMarkCompleted(CTX, {}),
    TC.planResetCompassOnly(CTX),
  ];
  for (const p of plans) assertChildPathOnly(p.path);
});
