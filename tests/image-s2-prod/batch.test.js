/* IMAGE-S2-9 batch 상태 머신 검증 (순수·firebase 0).
   실행: node --test tests/image-s2-prod/batch.test.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const B = require('../../functions/image-s2-batch.js');

const SS = B.SCENE_STATUS, JS = B.JOB_STATUS;

test('planImageS2Batch — 이미지 없는 장면 skip, 최신 결과 cached, 나머지 target', () => {
  const scenes = { 0: { title: 'x' }, 1: { imageData: 'a' }, 2: { imageData: 'b' }, 3: { imageUrl: 'c' } };
  const existingVariants = { 1: { url: 'u', stale: false, basedOnImageHash: 'h1' } };
  const p = B.planImageS2Batch({ scenes, existingVariants, fingerprints: { 1: 'h1' } });
  assert.deepEqual(p.targets, ['2', '3']);
  assert.deepEqual(p.cached, ['1']);
  assert.equal(p.skipped.length, 1);            /* scene 0 NO_IMAGE */
  assert.equal(p.skipped[0].reason, 'NO_IMAGE');
  assert.equal(p.totalScenes, 2);
  assert.equal(p.estCostUsd, Math.round(2 * B.PER_IMAGE_USD * 1e6) / 1e6);
  assert.equal(p.estSeconds, 2 * B.PER_IMAGE_SECONDS);
});

test('planImageS2Batch — forceRegenerate면 cached도 target / hash 불일치면 재생성', () => {
  const scenes = { 1: { imageData: 'a' } };
  const ev = { 1: { url: 'u', stale: false, basedOnImageHash: 'h1' } };
  assert.deepEqual(B.planImageS2Batch({ scenes, existingVariants: ev, fingerprints: { 1: 'h1' }, forceRegenerate: true }).targets, ['1']);
  assert.deepEqual(B.planImageS2Batch({ scenes, existingVariants: ev, fingerprints: { 1: 'DIFF' } }).targets, ['1']);   /* hash 다름 */
  assert.deepEqual(B.planImageS2Batch({ scenes, existingVariants: { 1: { url: 'u', stale: true, basedOnImageHash: 'h1' } }, fingerprints: { 1: 'h1' } }).targets, ['1']);   /* stale */
});

test('planImageS2Batch — sceneIds 필터(only)', () => {
  const scenes = { 1: { imageData: 'a' }, 2: { imageData: 'b' }, 3: { imageData: 'c' } };
  assert.deepEqual(B.planImageS2Batch({ scenes, sceneIds: ['2'] }).targets, ['2']);
});

test('initBatchState — targets pending, cached cached, status', () => {
  const s = B.initBatchState({ jobId: 'j', requestedBy: 'u', now: 1000, targets: ['1', '2'], cached: ['3'], model: 'm', promptVersion: 'v' });
  assert.equal(s.status, JS.QUEUED);
  assert.equal(s.totalScenes, 3);
  assert.equal(s.sceneStates['1'].status, SS.PENDING);
  assert.equal(s.sceneStates['3'].status, SS.CACHED);
  assert.equal(s.createdAt, 1000);
  /* target 없으면 succeeded */
  assert.equal(B.initBatchState({ targets: [], cached: ['1'] }).status, JS.SUCCEEDED);
});

test('computeJobStatus — 분기', () => {
  assert.equal(B.computeJobStatus({ a: { status: SS.SUCCEEDED }, b: { status: SS.CACHED } }), JS.SUCCEEDED);
  assert.equal(B.computeJobStatus({ a: { status: SS.SUCCEEDED }, b: { status: SS.FAILED } }), JS.PARTIALLY_FAILED);
  assert.equal(B.computeJobStatus({ a: { status: SS.FAILED }, b: { status: SS.FAILED } }), JS.FAILED);
  assert.equal(B.computeJobStatus({ a: { status: SS.PENDING }, b: { status: SS.SUCCEEDED } }), JS.RUNNING);
  assert.equal(B.computeJobStatus({ a: { status: SS.PROCESSING } }), JS.RUNNING);
  assert.equal(B.computeJobStatus({}), JS.SUCCEEDED);
});

test('applySceneResult — 성공/캐시/실패/stale + attemptCount + 상태재계산 + 불변성', () => {
  const s0 = B.initBatchState({ targets: ['1', '2'] });
  const s1 = B.applySceneResult(s0, '1', { ok: true });
  assert.equal(s1.sceneStates['1'].status, SS.SUCCEEDED);
  assert.equal(s1.sceneStates['1'].attemptCount, 1);
  assert.equal(s1.status, JS.RUNNING);                  /* 2 아직 pending */
  assert.equal(s0.sceneStates['1'].status, SS.PENDING); /* 원본 불변(clone) */
  const s2 = B.applySceneResult(s1, '2', { ok: false, code: 'IMAGE_AI_TIMEOUT' });
  assert.equal(s2.sceneStates['2'].status, SS.FAILED);
  assert.equal(s2.sceneStates['2'].errorCode, 'IMAGE_AI_TIMEOUT');
  assert.equal(s2.status, JS.PARTIALLY_FAILED);
  /* 실패 재시도 → 성공 */
  const s3 = B.applySceneResult(s2, '2', { ok: true });
  assert.equal(s3.sceneStates['2'].status, SS.SUCCEEDED);
  assert.equal(s3.sceneStates['2'].attemptCount, 2);
  assert.equal(s3.status, JS.SUCCEEDED);
  /* cached / stale */
  assert.equal(B.applySceneResult(s0, '1', { ok: true, cached: true }).sceneStates['1'].status, SS.CACHED);
  assert.equal(B.applySceneResult(s0, '1', { ok: false, stale: true }).sceneStates['1'].status, SS.STALE);
});

test('markProcessing + resumableScenes + summarize', () => {
  let s = B.initBatchState({ targets: ['1', '2', '3'] });
  s = B.markProcessing(s, '1');
  assert.equal(s.sceneStates['1'].status, SS.PROCESSING);
  assert.equal(s.status, JS.RUNNING);
  s = B.applySceneResult(s, '1', { ok: true });
  s = B.applySceneResult(s, '2', { ok: false, code: 'X' });
  assert.deepEqual(B.resumableScenes(s).sort(), ['2', '3']);   /* failed + pending */
  const sum = B.summarize(s);
  assert.equal(sum.total, 3); assert.equal(sum.succeeded, 1); assert.equal(sum.failed, 1); assert.equal(sum.pending, 1);
  assert.equal(sum.estSecondsRemaining, 2 * B.PER_IMAGE_SECONDS);
  assert.equal(sum.jobStatus, JS.RUNNING);
});
