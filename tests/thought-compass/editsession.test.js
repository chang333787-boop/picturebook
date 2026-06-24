/* 생각 나침반 편집권한(editSession) 순수 판정 하니스. 실행: node --test tests/thought-compass/editsession.test.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ES = require('../../thought-compass-editsession.js');

const NOW = 1_000_000_000_000;
const ME = 'uidA', OTHER = 'uidB';

test('세션 없음 → 획득 가능(acquire)', () => {
  assert.equal(ES.resolveEditAccess(null, ME, NOW).role, 'acquire');
  assert.equal(ES.resolveEditAccess({}, ME, NOW).role, 'acquire');
});

test('내 세션 → editor(자기 재진입)', () => {
  const s = { editorUid: ME, heartbeatAt: NOW };
  assert.equal(ES.resolveEditAccess(s, ME, NOW).role, 'editor');
});

test('다른 사람 활성 → read-only', () => {
  const s = { editorUid: OTHER, heartbeatAt: NOW };
  assert.equal(ES.resolveEditAccess(s, ME, NOW).role, 'readonly');
});

test('179초 무활동 → 이어받기 금지(read-only 유지)', () => {
  const s = { editorUid: OTHER, heartbeatAt: NOW - 179000 };
  assert.equal(ES.resolveEditAccess(s, ME, NOW).role, 'readonly');
});

test('180초 무활동 → 이어받기 제안(takeoverOffer)', () => {
  const s = { editorUid: OTHER, heartbeatAt: NOW - 180000 };
  assert.equal(ES.resolveEditAccess(s, ME, NOW).role, 'takeoverOffer');
});

test('heartbeatAt 없으면 startedAt 기준', () => {
  const fresh = { editorUid: OTHER, startedAt: NOW };
  assert.equal(ES.resolveEditAccess(fresh, ME, NOW).role, 'readonly');
  const old = { editorUid: OTHER, startedAt: NOW - 200000 };
  assert.equal(ES.resolveEditAccess(old, ME, NOW).role, 'takeoverOffer');
});

test('isStale — 비어있음/만료=true, 활성=false', () => {
  assert.equal(ES.isStale(null, NOW), true);
  assert.equal(ES.isStale({ editorUid: OTHER, heartbeatAt: NOW }, NOW), false);
  assert.equal(ES.isStale({ editorUid: OTHER, heartbeatAt: NOW - 180000 }, NOW), true);
  assert.equal(ES.isStale({ editorUid: OTHER, heartbeatAt: NOW - 179999 }, NOW), false);
});

test('내 세션은 무활동이어도 stale(획득 transaction이 갱신) — resolveEditAccess는 editor', () => {
  /* 내 세션이면 idle 여부와 무관하게 editor(내가 이어서). */
  const s = { editorUid: ME, heartbeatAt: NOW - 999999 };
  assert.equal(ES.resolveEditAccess(s, ME, NOW).role, 'editor');
});

test('상수 — 30초/3분', () => {
  assert.equal(ES.HEARTBEAT_MS, 30000);
  assert.equal(ES.INACTIVITY_MS, 180000);
});
