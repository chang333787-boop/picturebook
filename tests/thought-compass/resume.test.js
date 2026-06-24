/* 생각 나침반 중단·이어하기 하니스 — RTDB 정본 상태에서 복원 지점 계산. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const TC = require('../../thought-compass.js');

test('미시작 → fresh, index 0', () => {
  const r = TC.resolveResumePoint(null);
  assert.equal(r.action, 'fresh');
  assert.equal(r.questionIndex, 0);
});
test('진행 중 index 0 복원', () => {
  const r = TC.resolveResumePoint({ status: 'inProgress', currentQuestionIndex: 0, completedAt: null });
  assert.equal(r.action, 'resume');
  assert.equal(r.questionIndex, 0);
});
test('진행 중 중간 index 복원', () => {
  const r = TC.resolveResumePoint({ status: 'inProgress', currentQuestionIndex: 4, completedAt: null });
  assert.equal(r.action, 'resume');
  assert.equal(r.questionIndex, 4);
});
test('answers 유지(그룹 공유)', () => {
  const r = TC.resolveResumePoint({ status: 'inProgress', completedAt: null, answers: { audience: { answerText: '우리 반' } } });
  assert.equal(r.answers.audience.answerText, '우리 반');
});
test('부분 followUps 유지', () => {
  const r = TC.resolveResumePoint({ status: 'inProgress', completedAt: null, followUps: [{ q: 'why' }] });
  assert.equal(r.followUps.length, 1);
});
test('깨진 index 보정(음수 → 0)', () => {
  const r = TC.resolveResumePoint({ status: 'inProgress', currentQuestionIndex: -3, completedAt: null });
  assert.equal(r.questionIndex, 0);
});
test('completed → 이어서(resume) 아님', () => {
  const r = TC.resolveResumePoint({ status: 'completed', completedAt: 7, currentQuestionIndex: 6 });
  assert.equal(r.action, 'completed');
  assert.notEqual(r.action, 'resume');
});
test('optional 시작자 → 완료 전 maker 차단(resolveProjectAccessState)', () => {
  const ctx = { projectType: 'text', compassState: { status: 'inProgress', startedAt: 1, completedAt: null } };
  assert.equal(TC.resolveProjectAccessState(ctx), TC.ACCESS.COMPASS_REQUIRED);
});
test('describeGate가 진행 중이면 이어서 액션', () => {
  const g = TC.describeGate({ projectType: 'picturebook', onboardingVersion: 1, compassState: { status: 'inProgress', startedAt: 1, completedAt: null, currentQuestionIndex: 1 } });
  assert.equal(g.primaryAction, 'resume');
  assert.equal(g.progressLabel, '현재 진행: 2번째 질문');
});
