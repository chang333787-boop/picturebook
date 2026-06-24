/* 생각 나침반 수명주기(PRE-01~04) 하니스. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const TC = require('../../thought-compass.js');

const CTX = { classId: 'C1', teamName: 't' };

/* PRE-02: 복사본(copiedFrom)은 onboarding/version 없이도 required */
test('복사본 그림책 → required(copiedFrom 마커)', () => {
  const ctx = { projectType: 'picturebook', copiedFrom: { srcTeamEncoded: 'x' }, compassState: null };
  assert.equal(TC.resolveThoughtCompassMode(ctx), 'required');
  assert.equal(TC.resolveProjectAccessState(ctx), TC.ACCESS.COMPASS_REQUIRED);
});
test('복사본 텍스트 → required', () => {
  assert.equal(TC.resolveThoughtCompassMode({ projectType: 'text', copiedFrom: { x: 1 } }), 'required');
});
test('복사본 movie → none(미적용)', () => {
  assert.equal(TC.resolveThoughtCompassMode({ projectType: 'movie', copiedFrom: { x: 1 } }), 'none');
});
test('복사본이 compass 완료하면 editable', () => {
  const ctx = { projectType: 'picturebook', copiedFrom: { x: 1 }, compassState: { status: 'completed', completedAt: 9 } };
  assert.equal(TC.resolveProjectAccessState(ctx), TC.ACCESS.EDITABLE_MAKER);
});
test('일반 기존 작품(copiedFrom 없음) → optional', () => {
  assert.equal(TC.resolveThoughtCompassMode({ projectType: 'picturebook' }), 'optional');
});

/* PRE-01: clearAll은 scenes만 — compass plan은 scenes 경로를 절대 만들지 않음(이미 검증) */
test('PRE-03 reset compass-only — preWriting만', () => {
  const p = TC.planResetCompassOnly(CTX);
  assert.ok(p.path.includes('/writingGuide/preWriting'));
  assert.equal(p.update.status, 'notStarted');
});
test('PRE-03 reset full — preWriting + onboarding(2 plan), scenes 미접근', () => {
  const ps = TC.planResetFullOnboarding(CTX);
  assert.equal(ps.length, 2);
  assert.ok(ps[0].path.includes('/writingGuide/preWriting'));
  assert.ok(ps[1].path.endsWith('/onboarding'));
  for (const p of ps) assert.ok(!p.path.includes('/scenes'));
});
test('PRE-02 copy plan — writingGuide null + onboarding/version 재부여', () => {
  const p = TC.planCopyResetOnboarding(CTX, 'picturebook');
  assert.equal(p.clearWritingGuide.value, null);
  assert.equal(p.onboardingVersion.value, 1);
});
test('PRE-04 sanitize — compass 데이터에 개인 식별자 미보존(익명화 불요/no-op 가능)', () => {
  const s = TC.sanitizeThoughtCompassState({ status: 'completed', completedAt: 1, uid: 'studentA', ownerId: 'studentA', answers: {} });
  assert.equal('uid' in s, false);
  assert.equal('ownerId' in s, false);   /* allowlist 밖 → 제거 */
});
