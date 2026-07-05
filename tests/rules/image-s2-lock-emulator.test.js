/* IMAGE-S2-2A(-FIX1) — 실제 RTDB transaction 동시성/경쟁(emulator). 순수 시뮬 아님.
   - lock: 두 transaction을 Promise.all 동시 실행 → win-once.
   - reset: M1 fix(optimistic-null 안전: non-match면 cur 반환 → mismatch 시 server값 재실행) +
     clear 재확인. 서버 resetImageSourceMode 로직을 그대로 재현해 emulator에서 검증.
   Admin SDK(rules 우회) 흐름이라 withSecurityRulesDisabled로 수행. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ref, get, set, runTransaction } from 'firebase/database';
import { getEnv, cleanup, clearData } from './helpers.js';

const require = createRequire(import.meta.url);
const { decideSourceModeLock, normalizePolicy, classifyPolicy } = require('../../functions/image-s2-policy.js');

const POLICY = 'classes/c/teams/t/viewer-meta/imagePolicy';

let env;
before(async () => { env = await getEnv(); });
after(async () => { await cleanup(); });

async function lockTxn(db, mode) {
  let decision = null;
  const res = await runTransaction(ref(db, POLICY), (cur) => {
    decision = decideSourceModeLock(cur, { sourceMode: mode, sceneId: 's1', uid: 'u-' + mode, now: 1 });
    if (decision.action === 'lock') return decision.policy;
    return;   /* idempotent/conflict/corrupt → abort */
  });
  return { mode, action: decision && decision.action, currentSourceMode: decision && decision.currentSourceMode, committed: res.committed };
}

/* 서버 resetImageSourceMode 핵심 재현: prev 캡처 → (eq?null:cur) transaction → clear 재확인. */
function _eq(a, b) {
  const na = normalizePolicy(a), nb = normalizePolicy(b);
  if (na === null && nb === null) return true;
  if (!na || !nb) return false;
  return na.sourceMode === nb.sourceMode && na.lockedAt === nb.lockedAt && na.lockedBy === nb.lockedBy;
}
async function resetClear(db, prevRaw) {
  await runTransaction(ref(db, POLICY), (cur) => (_eq(cur, prevRaw) ? null : cur));
  const afterPolicy = (await get(ref(db, POLICY))).val();
  const cleared = !(afterPolicy != null && classifyPolicy(afterPolicy) !== 'absent');
  return { cleared, afterPolicy };
}

test('lock: 동시 upload vs draw ×10(실 RTDB) — 한쪽만 lock, 최종 단일, 반대 conflict', async () => {
  for (let i = 0; i < 10; i++) {
    await clearData();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.database();
      const order = (i % 2 === 0) ? ['upload', 'draw'] : ['draw', 'upload'];
      const results = await Promise.all([lockTxn(db, order[0]), lockTxn(db, order[1])]);
      const locked = results.filter(r => r.action === 'lock');
      const conflicts = results.filter(r => r.action === 'conflict');
      assert.equal(locked.length, 1, `iter ${i}`);
      assert.equal(conflicts.length, 1, `iter ${i}`);
      assert.equal((await get(ref(db, POLICY))).val().sourceMode, locked[0].mode);
      assert.equal(conflicts[0].currentSourceMode, locked[0].mode);
    });
  }
});

test('lock: 동일 모드 동시(upload×2) — 충돌 없음, 단일 기록', async () => {
  await clearData();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database();
    const r = await Promise.all([lockTxn(db, 'upload'), lockTxn(db, 'upload')]);
    assert.equal(r.filter(x => x.action === 'conflict').length, 0);
    assert.equal((await get(ref(db, POLICY))).val().sourceMode, 'upload');
  });
});

test('reset: 경쟁 없는 정상 reset → clear (optimistic-null 안전)', async () => {
  await clearData();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database();
    const prev = { sourceMode: 'upload', lockedAt: 1, lockedBy: 'x' };
    await set(ref(db, POLICY), prev);
    const r = await resetClear(db, prev);
    assert.equal(r.cleared, true);
    assert.equal(r.afterPolicy, null);
  });
});

test('reset: 그 사이 racing lock으로 정책 변경 → clear 안 함(RESET_RACE_RETRY 등가)', async () => {
  await clearData();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database();
    const prev = { sourceMode: 'upload', lockedAt: 1, lockedBy: 'x' };
    /* prev 캡처 후, reset 직전에 다른 lock이 새 정책을 기록한 상태로 시뮬 */
    await set(ref(db, POLICY), { sourceMode: 'draw', lockedAt: 2, lockedBy: 'y' });
    const r = await resetClear(db, prev);   /* prev는 stale upload */
    assert.equal(r.cleared, false);          /* 비우지 않음 — 교사 재시도 */
    assert.equal(r.afterPolicy.sourceMode, 'draw');   /* racing 정책 보존 */
  });
});

test('reset: absent 정책 → idempotent clear 성공', async () => {
  await clearData();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database();
    const r = await resetClear(db, null);
    assert.equal(r.cleared, true);
    assert.equal(r.afterPolicy, null);
  });
});

test('reset: corrupt 정책(prev=corrupt) → clear(eq가 corrupt를 null로 정규화)', async () => {
  await clearData();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database();
    const prev = { sourceMode: 'paint' };
    await set(ref(db, POLICY), prev);
    const r = await resetClear(db, prev);
    assert.equal(r.cleared, true);
    assert.equal(r.afterPolicy, null);
  });
});

/* C2 핵심 불변식(실 RTDB + fake storage): gate-first에서 패자는 scene.imageData를 *안 쓴다* →
   같은 빈 장면 동시 저장이어도 승자 이미지 유지, 패자는 자기 고유 객체만 삭제(승자 객체 보존). */
test('store: 같은 빈 장면 upload/draw 동시 — 승자 scene 유지, 패자 미기록·자기 객체만 삭제', async () => {
  await clearData();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database();
    const SCENE = 'classes/c/teams/t/scenes/s1/imageData';
    const storage = new Set();   /* fake Storage: 존재하는 객체 경로 */
    let uniq = 0;
    async function userSave(mode) {
      const path = `images/c/t/s1/${mode}-${++uniq}`;   /* 고유 경로(overwrite 0) */
      storage.add(path);                                 /* "업로드" */
      const url = `https://x/${path}`;
      const lr = await lockTxn(db, mode);                /* 실 RTDB lock transaction */
      if (lr.action === 'lock' || lr.action === 'idempotent') {
        await set(ref(db, SCENE), url);                  /* 승자만 scene 기록 */
        return { ok: true, mode, url };
      }
      storage.delete(path);                              /* 패자: 자기 객체만 삭제(scene 미기록) */
      return { ok: false, mode };
    }
    const results = await Promise.all([userSave('upload'), userSave('draw')]);
    const winners = results.filter(r => r.ok);
    assert.equal(winners.length, 1, '승자 1명');
    assert.equal(results.filter(r => !r.ok).length, 1, '패자 1명');
    assert.equal((await get(ref(db, SCENE))).val(), winners[0].url, '최종 scene = 승자 URL(패자가 안 씀 → 유실 0)');
    assert.equal(storage.size, 1, '패자 고유 객체만 삭제, 승자 객체 보존');
    assert.ok([...storage][0].startsWith('images/c/t/s1/' + winners[0].mode), '남은 객체 = 승자 것');
  });
});
