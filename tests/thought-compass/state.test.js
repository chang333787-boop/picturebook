/* 생각 나침반 상태 foundation 하니스. 실행: node --test tests/thought-compass/state.test.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const TC = require('../../thought-compass.js');

test('신규 그림책 → required', () => {
  assert.equal(TC.resolveThoughtCompassMode({ projectType: 'picturebook', onboardingVersion: 1 }), 'required');
});
test('신규 텍스트 → required', () => {
  assert.equal(TC.resolveThoughtCompassMode({ projectType: 'text', onboardingVersion: 1 }), 'required');
});
test('신규 movie → none(미적용)', () => {
  assert.equal(TC.resolveThoughtCompassMode({ projectType: 'movie', onboardingVersion: 1 }), 'none');
});
test('신규 experience → none(미적용)', () => {
  assert.equal(TC.resolveThoughtCompassMode({ projectType: 'experience', onboardingVersion: 1 }), 'none');
});
test('기존 그림책 → optional', () => {
  assert.equal(TC.resolveThoughtCompassMode({ projectType: 'picturebook' }), 'optional');
});
test('기존 텍스트 → optional', () => {
  assert.equal(TC.resolveThoughtCompassMode({ projectType: 'text', onboardingVersion: undefined }), 'optional');
});

test('required 미완료 → maker 진입 차단', () => {
  const s = TC.getDefaultThoughtCompassState({ projectType: 'picturebook', mode: 'required' });
  assert.equal(TC.isThoughtCompassRequired(s), true);
  assert.equal(TC.canEnterMaker(s), false);
});
test('completed → maker 진입 허용', () => {
  const s = TC.normalizeThoughtCompassState({ status: 'completed', mode: 'required', projectType: 'text', completedAt: 123 });
  assert.equal(TC.isThoughtCompassCompleted(s), true);
  assert.equal(TC.canEnterMaker(s), true);
});
test('in_progress(optional이어도) → maker 진입 차단', () => {
  const s = TC.normalizeThoughtCompassState({ status: 'in_progress', mode: 'optional', projectType: 'picturebook', startedAt: 1, completedAt: null });
  assert.equal(TC.isThoughtCompassRequired(s), true);
  assert.equal(TC.canEnterMaker(s), false);
});
test('movie(none) → 항상 maker 진입 허용', () => {
  const s = TC.normalizeThoughtCompassState({ status: 'inProgress', mode: 'none', projectType: 'picturebook' });
  assert.equal(TC.canEnterMaker(s), true);
});

test('snake_case status normalize → camelCase 정본', () => {
  assert.equal(TC.normalizeThoughtCompassState({ status: 'not_started' }).status, 'notStarted');
  assert.equal(TC.normalizeThoughtCompassState({ status: 'in_progress' }).status, 'inProgress');
});
test('깨진 상태 normalize — null/배열/음수 index', () => {
  assert.equal(TC.normalizeThoughtCompassState(null).status, 'notStarted');
  assert.equal(TC.normalizeThoughtCompassState([]).status, 'notStarted');
  const s = TC.normalizeThoughtCompassState({ status: 'inProgress', currentQuestionIndex: -5, completedAt: null });
  assert.equal(s.currentQuestionIndex, 0);
});
test('completedAt 있어도 status completed 아니면 완료 아님', () => {
  const s = TC.normalizeThoughtCompassState({ status: 'inProgress', completedAt: 999 });
  assert.equal(TC.isThoughtCompassCompleted(s), false);
});
test('completed인데 completedAt 없으면 inProgress로 강등', () => {
  const s = TC.normalizeThoughtCompassState({ status: 'completed' });
  assert.equal(s.status, 'inProgress');
  assert.equal(TC.isThoughtCompassCompleted(s), false);
});
test('알 수 없는 필드 제거', () => {
  const s = TC.normalizeThoughtCompassState({ status: 'inProgress', completedAt: null, foo: 'x', __proto__hack: 1 });
  assert.equal('foo' in s, false);
});
test('개인정보/비밀 필드 제거(sanitize)', () => {
  const s = TC.sanitizeThoughtCompassState({ status: 'inProgress', pin: '1234', uid: 'abc', studentName: '홍길동', answers: { q1: { answerText: 'a', pin: '1234' } } });
  assert.equal('pin' in s, false);
  assert.equal('uid' in s, false);
  assert.equal('studentName' in s, false);
  assert.equal('pin' in s.answers.q1, false);
  assert.ok(!JSON.stringify(s).includes('1234'));
});
test('buildThoughtCompassPaths — onboarding/version 경로(viewer-meta 아님)', () => {
  const p = TC.buildThoughtCompassPaths({ classId: 'C1', teamName: '2모둠' });
  assert.equal(p.onboardingVersion, 'classes/C1/teams/2%EB%AA%A8%EB%91%A0/onboarding/version');
  assert.equal(p.preWriting, 'classes/C1/teams/2%EB%AA%A8%EB%91%A0/writingGuide/preWriting');
  assert.ok(!p.onboardingVersion.includes('viewer-meta'));
});
