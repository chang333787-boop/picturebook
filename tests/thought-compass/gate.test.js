/* 생각 나침반 진입 게이트 controller 하니스(DOM 없음). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const TC = require('../../thought-compass.js');

const newPic = { projectType: 'picturebook', onboardingVersion: 1, compassState: null };
const newText = { projectType: 'text', onboardingVersion: 1, compassState: null };
const newMovie = { projectType: 'movie', onboardingVersion: 1, compassState: null };
const existingPic = { projectType: 'picturebook', compassState: null };
const completed = { projectType: 'picturebook', onboardingVersion: 1, compassState: { status: 'completed', completedAt: 5 } };
const inProg = { projectType: 'picturebook', onboardingVersion: 1, compassState: { status: 'inProgress', startedAt: 1, completedAt: null } };
const optStarted = { projectType: 'text', compassState: { status: 'inProgress', startedAt: 1, completedAt: null } };

test('신규 그림책 → COMPASS_REQUIRED(차단)', () => {
  assert.equal(TC.resolveProjectAccessState(newPic), TC.ACCESS.COMPASS_REQUIRED);
});
test('신규 텍스트 → COMPASS_REQUIRED(차단)', () => {
  assert.equal(TC.resolveProjectAccessState(newText), TC.ACCESS.COMPASS_REQUIRED);
});
test('신규 movie → EDITABLE_MAKER(미차단)', () => {
  assert.equal(TC.resolveProjectAccessState(newMovie), TC.ACCESS.EDITABLE_MAKER);
});
test('기존 작품(미시작) → EDITABLE_MAKER(미차단)', () => {
  assert.equal(TC.resolveProjectAccessState(existingPic), TC.ACCESS.EDITABLE_MAKER);
});
test('completed → EDITABLE_MAKER(통과)', () => {
  assert.equal(TC.resolveProjectAccessState(completed), TC.ACCESS.EDITABLE_MAKER);
});
test('in_progress 재진입 → COMPASS_REQUIRED', () => {
  assert.equal(TC.resolveProjectAccessState(inProg), TC.ACCESS.COMPASS_REQUIRED);
});
test('optional이어도 시작했으면 → COMPASS_REQUIRED(완료 전 maker 차단)', () => {
  assert.equal(TC.resolveProjectAccessState(optStarted), TC.ACCESS.COMPASS_REQUIRED);
});

test('describeGate — 신규: 시작 버튼·닫기 불가·건너뛰기 없음', () => {
  const g = TC.describeGate(newPic);
  assert.equal(g.show, true);
  assert.equal(g.primaryAction, 'start');
  assert.equal(g.dismissible, false);
  assert.equal(g.allowSkip, false);
  assert.equal(g.blockMakerClick, true);
  assert.equal(g.title, '이야기를 시작하기 전에');
});
test('describeGate — in_progress: 이어서 버튼 + 진행 라벨', () => {
  const g = TC.describeGate({ projectType: 'text', onboardingVersion: 1, compassState: { status: 'inProgress', startedAt: 1, completedAt: null, currentQuestionIndex: 2 } });
  assert.equal(g.primaryAction, 'resume');
  assert.equal(g.primaryLabel, '이어서 하기');
  assert.equal(g.progressLabel, '현재 진행: 3번째 질문');
});
test('describeGate — optional 시작자는 닫기 가능(나중에)', () => {
  const g = TC.describeGate(optStarted);
  assert.equal(g.show, true);
  assert.equal(g.dismissible, true);   /* optional은 나중에 가능 */
});
test('describeGate — completed/movie는 show false', () => {
  assert.equal(TC.describeGate(completed).show, false);
  assert.equal(TC.describeGate(newMovie).show, false);
});

test('시작 액션 plan — not_started → inProgress + startedAt + index 0', () => {
  const p = TC.planMarkStarted({ classId: 'C1', teamName: 't' }, null);
  assert.equal(p.update.status, 'inProgress');
  assert.equal(p.update.currentQuestionIndex, 0);
  assert.equal(p.update.startedAt, TC.SERVER_TS);
});
