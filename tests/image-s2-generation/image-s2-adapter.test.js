/* IMAGE-S2-5 — image-s2-adapter.js (provider-neutral) 검증.
   실행: node --test tests/image-s2-generation/image-s2-adapter.test.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const A = require('../../functions/image-s2-adapter.js');

test('not-configured adapter — configured false, generate NOT_CONFIGURED', async () => {
  const a = A.createNotConfiguredAdapter();
  assert.equal(a.configured, false);
  const r = await a.generate({});
  assert.equal(r.ok, false);
  assert.equal(r.code, 'IMAGE_AI_NOT_CONFIGURED');
});

test('fake adapter — configured true, png buffer 반환', async () => {
  const a = A.createFakeAdapter();
  assert.equal(a.configured, true);
  const r = await a.generate({});
  assert.equal(r.ok, true);
  assert.equal(r.mimeType, 'image/png');
  assert.ok(Buffer.isBuffer(r.bytes) && r.bytes.length > 0);
  assert.equal(r.model, 'fake-imageS2');
});

test('fake adapter — fail 코드 주입', async () => {
  const a = A.createFakeAdapter({ fail: 'IMAGE_AI_UNSAFE_OUTPUT' });
  const r = await a.generate({});
  assert.equal(r.ok, false);
  assert.equal(r.code, 'IMAGE_AI_UNSAFE_OUTPUT');
});

test('runAdapterWithPolicy — 재시도 가능: 1회 실패 후 성공(attempts 2)', async () => {
  const a = A.createFakeAdapter({ failTimes: 1, failCode: 'IMAGE_AI_PROVIDER_ERROR' });
  const r = await A.runAdapterWithPolicy(a, {}, { maxAttempts: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
});

test('runAdapterWithPolicy — 항상 실패(재시도 가능) → attempts == maxAttempts', async () => {
  const a = A.createFakeAdapter({ fail: 'IMAGE_AI_PROVIDER_ERROR' });
  const r = await A.runAdapterWithPolicy(a, {}, { maxAttempts: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 2);
});

test('runAdapterWithPolicy — 비-재시도 코드(UNSAFE) → 재시도 안 함(attempts 1)', async () => {
  const a = A.createFakeAdapter({ fail: 'IMAGE_AI_UNSAFE_OUTPUT' });
  const r = await A.runAdapterWithPolicy(a, {}, { maxAttempts: 3 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'IMAGE_AI_UNSAFE_OUTPUT');
  assert.equal(r.attempts, 1);
});

test('runAdapterWithPolicy — 취소면 시도 0, CANCELLED', async () => {
  const a = A.createFakeAdapter();
  const r = await A.runAdapterWithPolicy(a, {}, { isCancelled: () => true });
  assert.equal(r.code, 'IMAGE_AI_CANCELLED');
  assert.equal(r.attempts, 0);
});

test('callWithTimeout — 미해결 → TIMEOUT', async () => {
  const r = await A.callWithTimeout(() => new Promise(() => {}), 10);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'IMAGE_AI_TIMEOUT');
});

test('callWithTimeout — 빠른 성공 통과', async () => {
  const r = await A.callWithTimeout(() => Promise.resolve({ ok: true, x: 1 }), 50);
  assert.equal(r.ok, true);
  assert.equal(r.x, 1);
});

test('runAdapterWithPolicy — 느린 adapter + 짧은 timeout → TIMEOUT(재시도 후 종료)', async () => {
  const a = A.createFakeAdapter({ delayMs: 40 });
  const r = await A.runAdapterWithPolicy(a, {}, { timeoutMs: 5, maxAttempts: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'IMAGE_AI_TIMEOUT');
  assert.equal(r.attempts, 2);
});

test('mapProviderError — timeout류 → TIMEOUT, 그 외 → PROVIDER_ERROR', () => {
  assert.equal(A.mapProviderError(new Error('Request timeout')), 'IMAGE_AI_TIMEOUT');
  assert.equal(A.mapProviderError({ code: 'ETIMEDOUT' }), 'IMAGE_AI_TIMEOUT');
  assert.equal(A.mapProviderError(new Error('abort')), 'IMAGE_AI_TIMEOUT');
  assert.equal(A.mapProviderError(new Error('500 server')), 'IMAGE_AI_PROVIDER_ERROR');
});

test('callWithTimeout — factory throw → PROVIDER_ERROR 정규화', async () => {
  const r = await A.callWithTimeout(() => { throw new Error('boom 500'); }, 50);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'IMAGE_AI_PROVIDER_ERROR');
});
