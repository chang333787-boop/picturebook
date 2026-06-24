/* membership-login.js Node 하니스 — DOM·Firebase SDK 없이 로그인 핵심 로직 검증.
   실행: node --test tests/membership-login/membership-login.test.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ML = require('../../membership-login.js');

const PIN = '1234';
const okResp = { ok: true, membershipVersion: 1 };

/* 호출 인자/횟수 기록 spy */
function spy(returnVal, throwErr) {
  const calls = [];
  const fn = async (args) => { calls.push(args); if (throwErr) throw throwErr; return returnVal; };
  fn.calls = calls;
  return fn;
}

test('1. 성공 응답 → ok + membershipVersion', async () => {
  const call = spy(okResp);
  const r = await ML.requestTeamMembership({ classId: 'C1', teamName: '2모둠', pin: PIN, callMembership: call });
  assert.equal(r.ok, true);
  assert.equal(r.membershipVersion, 1);
});

test('2. callable permission-denied → 통합 실패 메시지(PIN 비노출)', async () => {
  const e = new Error('x'); e.code = 'functions/permission-denied';
  const call = spy(null, e);
  const r = await ML.requestTeamMembership({ classId: 'C1', teamName: 't', pin: PIN, callMembership: call });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'permission-denied');
  assert.equal(r.message, ML.GENERIC_ERROR);
});

test('3. malformed 성공 응답 → 실패', async () => {
  const call = spy({ ok: true });   /* membershipVersion 없음 */
  const r = await ML.requestTeamMembership({ classId: 'C1', teamName: 't', pin: PIN, callMembership: call });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'malformed-response');
});

test('4. callMembership(SDK adapter) 없음 → 실패(미호출)', async () => {
  const r = await ML.requestTeamMembership({ classId: 'C1', teamName: 't', pin: PIN });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'sdk-missing');
  assert.equal(r.called, false);
});

test('5. 빈 classId → callable 미호출', async () => {
  const call = spy(okResp);
  const r = await ML.requestTeamMembership({ classId: '', teamName: 't', pin: PIN, callMembership: call });
  assert.equal(r.ok, false); assert.equal(r.called, false); assert.equal(call.calls.length, 0);
});
test('6. 빈 teamName → callable 미호출', async () => {
  const call = spy(okResp);
  const r = await ML.requestTeamMembership({ classId: 'C1', teamName: '  ', pin: PIN, callMembership: call });
  assert.equal(r.ok, false); assert.equal(r.called, false); assert.equal(call.calls.length, 0);
});
test('7. 빈/형식오류 pin → callable 미호출', async () => {
  const call = spy(okResp);
  const r1 = await ML.requestTeamMembership({ classId: 'C1', teamName: 't', pin: '', callMembership: call });
  const r2 = await ML.requestTeamMembership({ classId: 'C1', teamName: 't', pin: 'abc', callMembership: call });
  assert.equal(r1.ok, false); assert.equal(r2.ok, false); assert.equal(call.calls.length, 0);
});

test('8/14. 반환 객체에 PIN 문자열이 남지 않음', async () => {
  const e = new Error('x'); e.code = 'functions/permission-denied';
  const failCall = spy(null, e);
  const rFail = await ML.requestTeamMembership({ classId: 'C1', teamName: 't', pin: PIN, callMembership: failCall });
  const okCall = spy(okResp);
  const rOk = await ML.requestTeamMembership({ classId: 'C1', teamName: 't', pin: PIN, callMembership: okCall });
  assert.ok(!JSON.stringify(rFail).includes(PIN));
  assert.ok(!JSON.stringify(rOk).includes(PIN));
});

test('13. callable에 정확히 3개 필드만 전달', async () => {
  const call = spy(okResp);
  await ML.requestTeamMembership({ classId: 'C1', teamName: 't', pin: PIN, callMembership: call });
  assert.equal(call.calls.length, 1);
  assert.deepEqual(Object.keys(call.calls[0]).sort(), ['classId', 'pin', 'teamName']);
});

test('9/10. single-flight: 중복 시 callable 1회, 종료 후 재시도 가능', async () => {
  const lock = ML.createSingleFlight();
  const call = spy(okResp);
  const job = () => ML.requestTeamMembership({ classId: 'C1', teamName: 't', pin: PIN, callMembership: call });
  const [a, b] = await Promise.all([lock.run(job), lock.run(job)]);
  /* 동시 2회 중 하나는 skip */
  assert.ok(a.skipped === true || b.skipped === true);
  assert.equal(call.calls.length, 1);
  /* 종료 후 재시도 */
  const c = await lock.run(job);
  assert.equal(c.skipped, false);
  assert.equal(call.calls.length, 2);
});

test('11/12. 성공 진입은 1회, 실패는 진입 0회로 모델링', async () => {
  let entered = 0;
  const enterIfOk = async (resp) => {
    const r = await ML.requestTeamMembership({ classId: 'C1', teamName: 't', pin: PIN, callMembership: spy(resp) });
    if (r.ok) entered++;
    return r;
  };
  await enterIfOk(okResp);            /* 성공 → 진입 1 */
  await enterIfOk({ ok: false });     /* 실패 → 진입 변화 없음 */
  assert.equal(entered, 1);
});

test('2b. unavailable → 재시도 안내', async () => {
  const e = new Error('x'); e.code = 'functions/unavailable';
  const r = await ML.requestTeamMembership({ classId: 'C1', teamName: 't', pin: PIN, callMembership: spy(null, e) });
  assert.equal(r.ok, false);
  assert.equal(r.message, '잠시 후 다시 시도해 주세요.');
});
