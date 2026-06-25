/* IMAGE-S2-2 — sourceMode 잠금/초기화 순수 결정 로직 + 동시성 시뮬.
   firebase 없이 functions/image-s2-policy.js 만 검증.
   실행: node --test tests/image-s2-policy/image-s2-policy.test.js

   동시성: RTDB transaction의 CAS(compare-and-set)+자동 재시도를 모델링.
   - atomicRef.cas(expected,next): 현재값이 expected(참조 동일)일 때만 교체(성공 true).
   - lockWithRetry: read→decide→ (lock이면 CAS, 실패 시 재시도 / idempotent·conflict는 종료).
   실제 RTDB도 "먼저 commit한 transaction이 이기고, 늦은 쪽은 새 값으로 재실행"이라 동일. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../functions/image-s2-policy.js');
const { decideSourceModeLock, normalizePolicy, decideSourceModeReset, scenesHaveOriginalImage, isValidSourceMode } = P;

/* ── 모의 atomic ref (CAS) ── */
function atomicRef(initial) {
  let v = initial;
  return { read: () => v, cas: (expected, next) => { if (v === expected) { v = next; return true; } return false; } };
}
function lockWithRetry(ref, req, maxRetry = 20) {
  for (let i = 0; i < maxRetry; i++) {
    const cur = ref.read();
    const d = decideSourceModeLock(cur, req);
    if (d.action !== 'lock') return d;                 /* idempotent / conflict = 종료 */
    if (ref.cas(cur, d.policy)) return { action: 'lock', committed: true, policy: d.policy };
    /* CAS 실패(다른 transaction이 먼저 commit) → 재시도(새 값으로 재결정) */
  }
  throw new Error('max retry exceeded');
}
const upReq = (over) => Object.assign({ sourceMode: 'upload', sceneId: 's1', uid: 'uidU', now: 100 }, over || {});
const drReq = (over) => Object.assign({ sourceMode: 'draw', sceneId: 's2', uid: 'uidD', now: 200 }, over || {});

/* ── 순수 결정 ── */

test('미설정 → 요청 모드로 lock(메타 기록)', () => {
  const d = decideSourceModeLock(null, upReq());
  assert.equal(d.action, 'lock');
  assert.deepEqual(d.policy, { sourceMode: 'upload', lockedAtSceneId: 's1', lockedAt: 100, lockedBy: 'uidU' });
});

test('동일 모드 후속 → idempotent(기존 lock 메타 보존·미기록)', () => {
  const existing = { sourceMode: 'upload', lockedAtSceneId: 'orig', lockedAt: 1, lockedBy: 'first' };
  const d = decideSourceModeLock(existing, upReq({ sceneId: 'sX', uid: 'second', now: 999 }));
  assert.equal(d.action, 'idempotent');
  assert.deepEqual(d.policy, existing);   /* lockedAt/lockedBy 안 덮음 */
});

test('반대 모드 → conflict(현재 모드 반환)', () => {
  const d = decideSourceModeLock({ sourceMode: 'upload', lockedAt: 1, lockedBy: 'x' }, drReq());
  assert.equal(d.action, 'conflict');
  assert.equal(d.currentSourceMode, 'upload');
});

test('잘못된 저장값(sourceMode 비정상) → 미설정 취급 → lock', () => {
  const d = decideSourceModeLock({ sourceMode: 'paint' }, upReq());
  assert.equal(d.action, 'lock');
});

test('isValidSourceMode / normalizePolicy', () => {
  assert.equal(isValidSourceMode('upload'), true);
  assert.equal(isValidSourceMode('x'), false);
  assert.equal(normalizePolicy({ sourceMode: 'draw', lockedBy: 'u', lockedAt: 5 }).sourceMode, 'draw');
  assert.equal(normalizePolicy({ sourceMode: 'nope' }), null);
  assert.equal(normalizePolicy(null), null);
});

/* ── 동시성: upload vs draw 10회 — 항상 한 값만 ── */

test('동시 upload vs draw ×10 — 한 쪽만 lock, 반대는 conflict, 최종 단일 모드', () => {
  for (let i = 0; i < 10; i++) {
    const ref = atomicRef(null);
    /* 커밋 순서를 매 반복 번갈아(둘 다 null에서 출발한 경쟁을 양방향으로 검증) */
    const order = (i % 2 === 0) ? [upReq(), drReq()] : [drReq(), upReq()];
    const r0 = lockWithRetry(ref, order[0]);
    const r1 = lockWithRetry(ref, order[1]);
    const locked = [r0, r1].filter(r => r.action === 'lock');
    const conflicts = [r0, r1].filter(r => r.action === 'conflict');
    assert.equal(locked.length, 1, `iter ${i}: lock 정확히 1개`);
    assert.equal(conflicts.length, 1, `iter ${i}: conflict 정확히 1개`);
    /* 최종 저장값은 먼저 commit한 쪽의 모드(=order[0]) */
    assert.equal(ref.read().sourceMode, order[0].sourceMode, `iter ${i}: 최종 모드 = 먼저 commit한 쪽`);
    assert.equal(conflicts[0].currentSourceMode, order[0].sourceMode);
  }
});

test('동일 모드 동시(upload×2) — 둘 다 성공, 최초 lock 메타 유지', () => {
  const ref = atomicRef(null);
  const a = lockWithRetry(ref, upReq({ uid: 'A', now: 10, sceneId: 'sa' }));
  const b = lockWithRetry(ref, upReq({ uid: 'B', now: 20, sceneId: 'sb' }));
  assert.equal(a.action, 'lock');
  assert.equal(b.action, 'idempotent');                 /* 두 번째는 idempotent 성공 */
  assert.equal(ref.read().lockedBy, 'A');               /* 최초 값 유지 */
  assert.equal(ref.read().lockedAt, 10);
  assert.equal(ref.read().sourceMode, 'upload');
});

test('기존 upload 작품에서 draw 요청 → 차단', () => {
  const ref = atomicRef({ sourceMode: 'upload', lockedAt: 1, lockedBy: 'x' });
  const r = lockWithRetry(ref, drReq());
  assert.equal(r.action, 'conflict');
  assert.equal(r.currentSourceMode, 'upload');
  assert.equal(ref.read().sourceMode, 'upload');        /* 변경 없음 */
});

/* ── 교사 초기화 ── */

test('초기화: 원본 이미지 남아 있으면 SOURCE_IMAGES_REMAIN', () => {
  assert.equal(scenesHaveOriginalImage({ a: { imageData: 'd' } }), true);
  assert.equal(scenesHaveOriginalImage({ a: { imageUrl: 'http://x' } }), true);
  assert.equal(decideSourceModeReset({ a: { imageData: 'd' }, b: {} }).code, 'SOURCE_IMAGES_REMAIN');
});

test('초기화: 원본 이미지 전무 → 허용', () => {
  assert.equal(scenesHaveOriginalImage({ a: { body: 't' }, b: { title: 'x' } }), false);
  assert.equal(scenesHaveOriginalImage({}), false);
  assert.equal(scenesHaveOriginalImage(null), false);
  assert.equal(decideSourceModeReset({ a: { body: 't' } }).ok, true);
  assert.equal(decideSourceModeReset({}).ok, true);
});

test('초기화: imageData 빈 문자열은 "이미지 없음"으로 간주', () => {
  assert.equal(scenesHaveOriginalImage({ a: { imageData: '', imageUrl: '' } }), false);
  assert.equal(decideSourceModeReset({ a: { imageData: '' } }).ok, true);
});
