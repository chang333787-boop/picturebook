/* 기존 프로젝트 선택 진입 버튼 controller 하니스. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const TC = require('../../thought-compass.js');

test('기존 picturebook 미시작 → 시작 버튼(취소 가능)', () => {
  const b = TC.describeOptionalEntryButton({ projectType: 'picturebook', compassState: null });
  assert.equal(b.show, true); assert.equal(b.action, 'start'); assert.equal(b.cancellable, true);
});
test('기존 text 미시작 → 시작 버튼', () => {
  const b = TC.describeOptionalEntryButton({ projectType: 'text', compassState: null });
  assert.equal(b.show, true); assert.equal(b.label, '생각 나침반 시작');
});
test('movie → 버튼 숨김', () => {
  assert.equal(TC.describeOptionalEntryButton({ projectType: 'movie', compassState: null }).show, false);
});
test('experience → 버튼 숨김', () => {
  assert.equal(TC.describeOptionalEntryButton({ projectType: 'experience' }).show, false);
});
test('in_progress → 이어서(취소 불가)', () => {
  const b = TC.describeOptionalEntryButton({ projectType: 'picturebook', compassState: { status: 'inProgress', startedAt: 1, completedAt: null } });
  assert.equal(b.action, 'resume'); assert.equal(b.cancellable, false);
});
test('completed → 다시 보기', () => {
  const b = TC.describeOptionalEntryButton({ projectType: 'text', compassState: { status: 'completed', completedAt: 3 } });
  assert.equal(b.action, 'review'); assert.equal(b.label, '생각 나침반 다시 보기');
});
test('not_started 취소 가능 / in_progress 취소 불가', () => {
  assert.equal(TC.describeOptionalEntryButton({ projectType: 'picturebook', compassState: null }).cancellable, true);
  assert.equal(TC.describeOptionalEntryButton({ projectType: 'picturebook', compassState: { status: 'inProgress', startedAt: 1, completedAt: null } }).cancellable, false);
});
