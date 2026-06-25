/* IMAGE-S2-2A — 실제 RTDB transaction 동시성(emulator). 순수 CAS 시뮬이 아니라
   Database Emulator에 두 transaction을 Promise.all로 동시 실행해 win-once를 실증.
   lock은 Admin SDK(rules 우회)라 withSecurityRulesDisabled 컨텍스트로 수행.
   결정 로직은 functions/image-s2-policy.js decideSourceModeLock 그대로 사용. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ref, get, set, runTransaction } from 'firebase/database';
import { getEnv, cleanup, clearData } from './helpers.js';

const require = createRequire(import.meta.url);
const { decideSourceModeLock } = require('../../functions/image-s2-policy.js');

const POLICY = 'classes/c/teams/t/viewer-meta/imagePolicy';
const SCENE_IMG = 'classes/c/teams/t/scenes/s1/imageData';

let env;
before(async () => { env = await getEnv(); });
after(async () => { await cleanup(); });

/* lock을 실제 RTDB transaction으로(콜백이 abort=undefined로 반환 시 미기록). 자동 재시도 내장. */
async function lockTxn(db, mode) {
  let decision = null;
  const res = await runTransaction(ref(db, POLICY), (cur) => {
    decision = decideSourceModeLock(cur, { sourceMode: mode, sceneId: 's1', uid: 'u-' + mode, now: 1 });
    if (decision.action === 'lock') return decision.policy;
    return;   /* idempotent/conflict/corrupt → abort */
  });
  return { mode, action: decision && decision.action, currentSourceMode: decision && decision.currentSourceMode, committed: res.committed };
}

test('동시 upload vs draw ×10 (실 RTDB transaction) — 한쪽만 lock, 최종 단일 모드, 반대 conflict', async () => {
  for (let i = 0; i < 10; i++) {
    await clearData();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.database();
      const order = (i % 2 === 0) ? ['upload', 'draw'] : ['draw', 'upload'];
      const results = await Promise.all([lockTxn(db, order[0]), lockTxn(db, order[1])]);
      const locked = results.filter(r => r.action === 'lock');
      const conflicts = results.filter(r => r.action === 'conflict');
      assert.equal(locked.length, 1, `iter ${i}: lock 정확히 1`);
      assert.equal(conflicts.length, 1, `iter ${i}: conflict 정확히 1`);
      const finalVal = (await get(ref(db, POLICY))).val();
      assert.equal(finalVal.sourceMode, locked[0].mode, `iter ${i}: 최종 모드=승자`);
      assert.equal(conflicts[0].currentSourceMode, locked[0].mode);
    });
  }
});

test('동일 모드 동시(upload×2, 실 transaction) — 한 번만 기록, 둘 다 비충돌', async () => {
  await clearData();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database();
    const results = await Promise.all([lockTxn(db, 'upload'), lockTxn(db, 'upload')]);
    assert.equal(results.filter(r => r.action === 'conflict').length, 0);
    assert.ok(results.some(r => r.action === 'lock'));
    assert.equal((await get(ref(db, POLICY))).val().sourceMode, 'upload');
  });
});

test('scene 이미지 CAS 복원 — 현재값===after일 때만 복원, 타인 이후 저장은 보존', async () => {
  await clearData();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database();
    /* CAS 복원 패턴(실 클라 동일): non-match는 abort(undefined)가 아니라 cur 반환 →
       commit 시도가 mismatch면 RTDB가 서버값으로 자동 재실행(lock과 동일 메커니즘). 이래야
       영속 연결 없는 환경에서도 optimistic-null 후 실제 서버값으로 결정된다. */
    const casRestore = (after, restoreTo) =>
      runTransaction(ref(db, SCENE_IMG), (cur) => (cur === after ? restoreTo : cur));
    await set(ref(db, SCENE_IMG), 'NEWURL');
    const r1 = await casRestore('NEWURL', 'OLD');     /* 현재값===NEWURL → OLD 복원 */
    assert.equal(r1.committed, true);
    assert.equal((await get(ref(db, SCENE_IMG))).val(), 'OLD');
    await set(ref(db, SCENE_IMG), 'OTHER');           /* 타인이 이후 새로 저장 */
    await casRestore('NEWURL', 'OLD');                /* expect NEWURL → no-op → OTHER 보존 */
    assert.equal((await get(ref(db, SCENE_IMG))).val(), 'OTHER');
  });
});
