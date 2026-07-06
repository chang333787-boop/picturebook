/* IMAGE-S2-3/4/5 — image-s2-generation.js 순수 로직 + 오케스트레이션 검증.
   firebase 없이 functions/image-s2-generation.js + image-s2-adapter.js 만 검증.
   실행: node --test tests/image-s2-generation/image-s2-generation.test.js
   원칙 검증: 원본 scene write 0(write dep 없음) · 결과는 ai-images/ + aiVariants/image · quota 성공=1·실패=환불. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const G = require('../../functions/image-s2-generation.js');
const A = require('../../functions/image-s2-adapter.js');

/* ── deps 헬퍼 (스파이) ── */
function makeDeps(over) {
  const o = over || {};
  const calls = { consume: 0, refund: 0, write: 0, upload: 0, cleanup: 0, sceneIds: [] };
  const deps = {
    readScene: async (s) => { calls.sceneIds.push(s); return (o.scene !== undefined) ? o.scene : { imageData: 'data:orig' }; },
    readPolicy: async () => (o.policy !== undefined) ? o.policy : { sourceMode: 'upload' },
    readExistingVariant: async () => (o.existing !== undefined) ? o.existing : null,
    adapter: o.adapter || A.createFakeAdapter(),
    uploadResult: o.uploadResult || (async ({ storagePath }) => { calls.upload++; deps._lastUploadPath = storagePath; return { url: 'https://dl/' + encodeURIComponent(storagePath) }; }),
    writeVariant: o.writeVariant || (async (s, v) => { calls.write++; deps._lastWrite = { s, v }; }),
    recordCleanup: o.recordCleanup || (async (r) => { calls.cleanup++; deps._lastCleanup = r; }),
    consumeQuota: async () => { calls.consume++; },
    refundQuota: async () => { calls.refund++; },
    now: () => 1000,
    uniqueId: o.uniqueId || (() => 'uuid1'),
  };
  if (o.verifyDownloadable !== undefined) deps.verifyDownloadable = o.verifyDownloadable;
  deps._calls = calls;
  return deps;
}
const baseInput = (over) => Object.assign({ classId: 'c1', enc: 'team', sceneId: '3', forceRegenerate: false, isTeacher: true }, over || {});

/* ════════ 오케스트레이션 ════════ */
test('happy path — fake adapter → succeeded, ai-images 경로, quota 1, 원본 미접촉', async () => {
  const deps = makeDeps({});
  const res = await G.runImageS2Generation(baseInput(), deps);
  assert.equal(res.ok, true);
  assert.equal(res.status, 'succeeded');
  assert.equal(res.quotaConsumed, 1);
  assert.equal(deps._calls.consume, 1);
  assert.equal(deps._calls.refund, 0);
  assert.equal(deps._calls.write, 1);
  assert.equal(deps._calls.upload, 1);
  /* 결과 경로/변형 검증 */
  assert.ok(deps._lastUploadPath.startsWith('ai-images/'), 'upload path는 ai-images/');
  assert.ok(!deps._lastUploadPath.startsWith('images/'), '원본 images/ 경로 아님');
  assert.equal(res.variant.fitPolicy, 'fit-imagecenter-landscape');
  assert.equal(res.variant.stale, false);
  assert.equal(res.variant.sourceMode, 'upload');
  assert.equal(res.variant.basedOnImageHash, G.computeImageBasedHash('data:orig', '3', 'upload'));
  assert.equal(res.variant.promptVersion, G.PROMPT_VERSION);
});

test('cached — 동일 hash + 동일 promptVersion → 재사용, 모델/quota 호출 0', async () => {
  const fp = G.computeImageBasedHash('data:orig', '3', 'upload');
  const existing = { url: 'u', storagePath: 'ai-images/old', basedOnImageHash: fp, stale: false, sourceMode: 'upload', promptVersion: G.PROMPT_VERSION };
  const adapter = A.createFakeAdapter();
  const deps = makeDeps({ existing, adapter });
  const res = await G.runImageS2Generation(baseInput(), deps);
  assert.equal(res.status, 'cached');
  assert.equal(res.reused, true);
  assert.equal(res.quotaConsumed, 0);
  assert.equal(adapter._calls(), 0, '모델 호출 0');
  assert.equal(deps._calls.consume, 0);
  assert.equal(deps._calls.write, 0);
});

test('not-configured adapter(prod 기본) → 생성 차단, 차감 0, write 0', async () => {
  const deps = makeDeps({ adapter: A.createNotConfiguredAdapter() });
  const res = await G.runImageS2Generation(baseInput(), deps);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'IMAGE_AI_NOT_CONFIGURED');
  assert.equal(deps._calls.consume, 0);
  assert.equal(deps._calls.upload, 0);
  assert.equal(deps._calls.write, 0);
});

test('게이트 거부 — scene 없음 → SCENE_NOT_FOUND, 차감 0', async () => {
  const deps = makeDeps({ scene: null });
  const res = await G.runImageS2Generation(baseInput(), deps);
  assert.equal(res.code, 'SCENE_NOT_FOUND');
  assert.equal(deps._calls.consume, 0);
});

test('게이트 거부 — 학생(비교사) → TEACHER_ONLY', async () => {
  const deps = makeDeps({});
  const res = await G.runImageS2Generation(baseInput({ isTeacher: false }), deps);
  assert.equal(res.code, 'TEACHER_ONLY');
  assert.equal(deps._calls.consume, 0);
});

test('게이트 거부 — 원본 이미지 없음 → IMAGE_SOURCE_MISSING', async () => {
  const deps = makeDeps({ scene: { title: 'x' } });
  const res = await G.runImageS2Generation(baseInput(), deps);
  assert.equal(res.code, 'IMAGE_SOURCE_MISSING');
});

test('게이트 거부 — corrupt policy → CORRUPT_IMAGE_POLICY', async () => {
  const deps = makeDeps({ policy: { sourceMode: 'paint' } });
  const res = await G.runImageS2Generation(baseInput(), deps);
  assert.equal(res.code, 'CORRUPT_IMAGE_POLICY');
});

test('legacy — policy 없는 옛 작품(imageData 있음) → upload 보정 진행·legacy 표시', async () => {
  const deps = makeDeps({ policy: null });
  const res = await G.runImageS2Generation(baseInput(), deps);
  assert.equal(res.ok, true);
  assert.equal(res.status, 'succeeded');
  assert.equal(res.legacyImagePolicy, true);
  assert.equal(res.variant.sourceMode, 'upload');
  assert.equal(res.variant.legacyImagePolicy, true);
  assert.equal(res.variant.sourceModeInferred, true);
});

test('모델 실패 → quota 예약 후 환불, write 0', async () => {
  const deps = makeDeps({ adapter: A.createFakeAdapter({ fail: 'IMAGE_AI_PROVIDER_ERROR' }) });
  const res = await G.runImageS2Generation(baseInput(), deps);
  assert.equal(res.ok, false);
  assert.equal(res.status, 'failed');
  assert.equal(res.code, 'IMAGE_AI_PROVIDER_ERROR');
  assert.equal(deps._calls.consume, 1);
  assert.equal(deps._calls.refund, 1);
  assert.equal(deps._calls.write, 0);
});

test('출력 MIME 위반 → 환불, INVALID_OUTPUT, write 0', async () => {
  const deps = makeDeps({ adapter: A.createFakeAdapter({ mimeType: 'image/gif' }) });
  const res = await G.runImageS2Generation(baseInput(), deps);
  assert.equal(res.code, 'IMAGE_AI_INVALID_OUTPUT');
  assert.equal(deps._calls.consume, 1);
  assert.equal(deps._calls.refund, 1);
  assert.equal(deps._calls.write, 0);
});

test('업로드 실패 → 환불, UPLOAD_FAILED, write 0', async () => {
  const deps = makeDeps({ uploadResult: async () => { throw new Error('boom'); } });
  const res = await G.runImageS2Generation(baseInput(), deps);
  assert.equal(res.code, 'IMAGE_AI_UPLOAD_FAILED');
  assert.equal(deps._calls.consume, 1);
  assert.equal(deps._calls.refund, 1);
  assert.equal(deps._calls.write, 0);
});

test('변형 write 실패 → 환불, WRITE_FAILED', async () => {
  const deps = makeDeps({ writeVariant: async () => { throw new Error('db'); } });
  const res = await G.runImageS2Generation(baseInput(), deps);
  assert.equal(res.code, 'IMAGE_AI_WRITE_FAILED');
  assert.equal(deps._calls.consume, 1);
  assert.equal(deps._calls.refund, 1);
});

test('consumeQuota 예약 실패(RTDB) → soft QUOTA_WRITE_FAILED + 보상 환불 시도, throw 없음, write 0', async () => {
  const deps = makeDeps({});
  deps.consumeQuota = async () => { deps._calls.consume++; throw new Error('rtdb down'); };
  const res = await G.runImageS2Generation(baseInput(), deps);
  assert.equal(res.ok, false);
  assert.equal(res.status, 'failed');
  assert.equal(res.code, 'IMAGE_AI_QUOTA_WRITE_FAILED');
  assert.equal(deps._calls.refund, 1, '부분 증가분 보상 환불 1회');
  assert.equal(deps._calls.write, 0);
});

test('verifyDownloadable=false → 환불, UPLOAD_FAILED', async () => {
  const deps = makeDeps({ verifyDownloadable: async () => false });
  const res = await G.runImageS2Generation(baseInput(), deps);
  assert.equal(res.code, 'IMAGE_AI_UPLOAD_FAILED');
  assert.equal(deps._calls.refund, 1);
  assert.equal(deps._calls.write, 0);
});

test('cache 정책 — 동일 hash라도 promptVersion 다르면 재생성(P3→P4)', async () => {
  const fp = G.computeImageBasedHash('data:orig', '3', 'upload');
  const oldVariant = { url: 'u', storagePath: 'ai-images/old', basedOnImageHash: fp, stale: false, sourceMode: 'upload', promptVersion: 'imgS2-p3-OLD' };
  const adapter = A.createFakeAdapter();
  const deps = makeDeps({ existing: oldVariant, adapter, uniqueId: () => 'NEW' });
  const res = await G.runImageS2Generation(baseInput(), deps);
  assert.equal(res.status, 'succeeded', '이전 프롬프트 버전이라 재생성');
  assert.notEqual(res.reused, true);
  assert.equal(res.variant.promptVersion, G.PROMPT_VERSION, '새 변형은 최신 버전');
  /* 순수 함수 직접 — promptVersion 포함 dedup/stale */
  assert.equal(G.decideDedup({ url: 'u', basedOnImageHash: fp, stale: false, promptVersion: 'imgS2-p3-OLD' }, fp, false, G.PROMPT_VERSION).action, 'generate');
  assert.equal(G.decideDedup({ url: 'u', basedOnImageHash: fp, stale: false, promptVersion: G.PROMPT_VERSION }, fp, false, G.PROMPT_VERSION).action, 'reuse');
  assert.equal(G.decideStale({ basedOnImageHash: fp, sourceMode: 'upload', promptVersion: 'imgS2-p3-OLD' }, fp, 'upload', G.PROMPT_VERSION), true);
  assert.equal(G.decideStale({ basedOnImageHash: fp, sourceMode: 'upload', promptVersion: G.PROMPT_VERSION }, fp, 'upload', G.PROMPT_VERSION), false);
});

test('forceRegenerate — 동일 hash라도 재생성 + 이전 객체 cleanup 기록', async () => {
  const fp = G.computeImageBasedHash('data:orig', '3', 'upload');
  const existing = { url: 'u', storagePath: 'ai-images/c1/team/scene_3_s2_OLD.png', basedOnImageHash: fp, stale: false, sourceMode: 'upload' };
  const deps = makeDeps({ existing, uniqueId: () => 'NEW' });
  const res = await G.runImageS2Generation(baseInput({ forceRegenerate: true }), deps);
  assert.equal(res.status, 'succeeded');
  assert.equal(deps._calls.write, 1);
  assert.equal(deps._calls.cleanup, 1, '이전 storagePath cleanup 기록');
  assert.equal(deps._lastCleanup.storagePath, 'ai-images/c1/team/scene_3_s2_OLD.png');
  assert.ok(deps._lastUploadPath.indexOf('NEW') !== -1, '새 고유 경로');
  assert.ok(deps._lastUploadPath !== existing.storagePath, '덮어쓰기 아님');
});

test('장면 격리 — 요청 sceneId만 read/write', async () => {
  const deps = makeDeps({});
  const res = await G.runImageS2Generation(baseInput({ sceneId: '7' }), deps);
  assert.equal(res.status, 'succeeded');
  assert.deepEqual(deps._calls.sceneIds, ['7']);
  assert.equal(deps._lastWrite.s, '7');
  assert.ok(deps._lastUploadPath.indexOf('scene_7_s2_') !== -1);
});

test('idempotency — 첫 생성 결과를 store로 재공급하면 2회차는 cached', async () => {
  let stored = null;
  const adapter = A.createFakeAdapter();
  const mk = () => makeDeps({
    adapter,
    existing: stored,
    writeVariant: async (s, v) => { stored = v; },
  });
  const r1 = await G.runImageS2Generation(baseInput(), mk());
  assert.equal(r1.status, 'succeeded');
  const r2 = await G.runImageS2Generation(baseInput(), mk());
  assert.equal(r2.status, 'cached');
  assert.equal(adapter._calls(), 1, '모델은 1회만');
});

/* ════════ 순수 함수 ════════ */
test('normalizeGenerationRequest — 최소 허용 / 주입 거부', () => {
  assert.equal(G.normalizeGenerationRequest({ classId: 'c', teamName: 't', sceneId: '1' }).ok, true);
  assert.equal(G.normalizeGenerationRequest({ classId: 'c', teamName: 't', sceneId: '1', forceRegenerate: true }).value.forceRegenerate, true);
  assert.equal(G.normalizeGenerationRequest({ classId: 'c', teamName: 't', sceneId: '1', url: 'http://x' }).code, 'INVALID_REQUEST_FIELDS');
  assert.equal(G.normalizeGenerationRequest({ classId: 'c', teamName: 't', sceneId: '1', storagePath: 'images/x' }).code, 'INVALID_REQUEST_FIELDS');
  assert.equal(G.normalizeGenerationRequest({ classId: 'c', teamName: 't', sceneId: '1', sourceMode: 'upload' }).code, 'INVALID_REQUEST_FIELDS');
  assert.equal(G.normalizeGenerationRequest({ classId: 'c', teamName: 't', sceneId: '1', imageBase64: 'AAAA' }).code, 'INVALID_REQUEST_FIELDS');
  assert.equal(G.normalizeGenerationRequest({ classId: 'c', teamName: 't' }).code, 'INVALID_ARGUMENT');
  assert.equal(G.normalizeGenerationRequest({ classId: 'c', teamName: 't', sceneId: 'a/b' }).code, 'INVALID_ARGUMENT');
  /* 빈 주입 필드는 무시(거부 아님) */
  assert.equal(G.normalizeGenerationRequest({ classId: 'c', teamName: 't', sceneId: '1', url: '' }).ok, true);
});

test('decideGenerationGate — 분기', () => {
  const ok = G.decideGenerationGate({ sceneId: '1', isTeacher: true, scene: { imageData: 'd' }, policy: { sourceMode: 'draw' } });
  assert.equal(ok.action, 'proceed');
  assert.equal(ok.sourceMode, 'draw');
  assert.equal(ok.originalSrc, 'd');
  assert.equal(G.decideGenerationGate({ sceneId: '1', isTeacher: false, scene: { imageData: 'd' }, policy: { sourceMode: 'draw' } }).code, 'TEACHER_ONLY');
  assert.equal(G.decideGenerationGate({ sceneId: 'a/b', isTeacher: true }).code, 'INVALID_ARGUMENT');
  assert.equal(G.decideGenerationGate({ sceneId: '1', isTeacher: true, scene: null }).code, 'SCENE_NOT_FOUND');
  assert.equal(G.decideGenerationGate({ sceneId: '1', isTeacher: true, scene: { title: 'x' }, policy: { sourceMode: 'upload' } }).code, 'IMAGE_SOURCE_MISSING');
  assert.equal(G.decideGenerationGate({ sceneId: '1', isTeacher: true, scene: { imageUrl: 'u' }, policy: 7 }).code, 'CORRUPT_IMAGE_POLICY');
  /* IMAGE-S2-LEGACY: policy 없고 imageData 있으면 거부가 아니라 upload 보정 진행 */
  const legacy = G.decideGenerationGate({ sceneId: '1', isTeacher: true, scene: { imageData: 'd' }, policy: null });
  assert.equal(legacy.action, 'proceed');
  assert.equal(legacy.sourceMode, 'upload');
  assert.equal(legacy.legacyImagePolicy, true);
  assert.equal(legacy.sourceModeInferred, true);
  /* 단 policy 없고 그림도 없으면 여전히 IMAGE_SOURCE_MISSING(이미지 체크가 먼저) */
  assert.equal(G.decideGenerationGate({ sceneId: '1', isTeacher: true, scene: { title: 'x' }, policy: null }).code, 'IMAGE_SOURCE_MISSING');
  /* imageUrl fallback 도 원본으로 인정 */
  assert.equal(G.decideGenerationGate({ sceneId: '1', isTeacher: true, scene: { imageUrl: 'u' }, policy: { sourceMode: 'upload' } }).originalSrc, 'u');
});

test('decideDedup — reuse/generate', () => {
  const fp = 'abc';
  assert.equal(G.decideDedup({ url: 'u', basedOnImageHash: 'abc', stale: false }, fp, false).action, 'reuse');
  assert.equal(G.decideDedup({ url: 'u', basedOnImageHash: 'abc', stale: false }, fp, true).action, 'generate');
  assert.equal(G.decideDedup({ url: 'u', basedOnImageHash: 'abc', stale: true }, fp, false).action, 'generate');
  assert.equal(G.decideDedup({ url: 'u', basedOnImageHash: 'xyz' }, fp, false).action, 'generate');
  assert.equal(G.decideDedup({ basedOnImageHash: 'abc' }, fp, false).action, 'generate');   /* url 없음 */
  assert.equal(G.decideDedup(null, fp, false).action, 'generate');
});

test('buildS2StoragePath + 가드', () => {
  assert.equal(G.buildS2StoragePath('c1', 'team', '3', 'uuid'), 'ai-images/c1/team/scene_3_s2_uuid.png');
  /* IMAGE-S2-DIET-1: mimeType 따라 확장자(webp/jpg), 생략 시 png 하위호환 */
  assert.equal(G.buildS2StoragePath('c1', 'team', '3', 'uuid', 'image/webp'), 'ai-images/c1/team/scene_3_s2_uuid.webp');
  assert.equal(G.buildS2StoragePath('c1', 'team', '3', 'uuid', 'image/jpeg'), 'ai-images/c1/team/scene_3_s2_uuid.jpg');
  assert.equal(G.buildS2StoragePath('c1', 'team', 'a/b', 'uuid'), null);
  assert.equal(G.isAllowedS2StoragePath('ai-images/c1/team/x.png'), true);
  assert.equal(G.isAllowedS2StoragePath('images/c1/team/x.png'), false);
  assert.equal(G.isAllowedS2StoragePath('ai-images/../images/x.png'), false);
  assert.equal(G.isOriginalImageStoragePath('images/c1/x.png'), true);
  assert.equal(G.isOriginalImageStoragePath('ai-images/c1/x.png'), false);
});

test('buildS2Variant — 스키마/기본값/필수', () => {
  const v = G.buildS2Variant({ url: 'u', storagePath: 'ai-images/p', sourceMode: 'upload', basedOnImageHash: 'h', model: 'm', finalizedAt: 5 });
  assert.equal(v.fitPolicy, 'fit-imagecenter-landscape');
  assert.equal(v.promptVersion, G.PROMPT_VERSION);
  assert.equal(v.stale, false);
  assert.equal(v.finalizedAt, 5);
  assert.deepEqual(v.targetFrame, G.TARGET_FRAME);
  assert.equal(G.buildS2Variant({ url: 'u', storagePath: 'p' }), null);   /* sourceMode/hash 없음 */
});

test('decideStale — hash/sourceMode 불일치', () => {
  assert.equal(G.decideStale({ basedOnImageHash: 'h', sourceMode: 'upload' }, 'h', 'upload'), false);
  assert.equal(G.decideStale({ basedOnImageHash: 'h', sourceMode: 'upload' }, 'h2', 'upload'), true);
  assert.equal(G.decideStale({ basedOnImageHash: 'h', sourceMode: 'upload' }, 'h', 'draw'), true);
  assert.equal(G.decideStale(null, 'h', 'upload'), true);
});

test('validateModelOutput — MIME/크기', () => {
  assert.equal(G.validateModelOutput({ bytes: 10, mimeType: 'image/png' }).ok, true);
  assert.equal(G.validateModelOutput({ bytes: 0, mimeType: 'image/png' }).code, 'IMAGE_AI_INVALID_OUTPUT');
  assert.equal(G.validateModelOutput({ bytes: 10, mimeType: 'image/webp' }).ok, true);   /* IMAGE-S2-DIET-1 */
  assert.equal(G.validateModelOutput({ bytes: 10, mimeType: 'image/gif' }).code, 'IMAGE_AI_INVALID_OUTPUT');
  assert.equal(G.validateModelOutput({ bytes: G.MAX_OUTPUT_BYTES + 1, mimeType: 'image/png' }).code, 'IMAGE_AI_INVALID_OUTPUT');
  assert.equal(G.validateModelOutput(null).code, 'IMAGE_AI_INVALID_OUTPUT');
});

test('computeImageBasedHash — 결정적 + 입력 따라 변화', () => {
  const a = G.computeImageBasedHash('x', '1', 'upload');
  assert.equal(a, G.computeImageBasedHash('x', '1', 'upload'));
  assert.notEqual(a, G.computeImageBasedHash('x', '1', 'draw'));
  assert.notEqual(a, G.computeImageBasedHash('y', '1', 'upload'));
  assert.match(a, /^[0-9a-f]{8}$/);
});

test('buildCleanupQueueRecord — deleteAfter = now + grace', () => {
  const r = G.buildCleanupQueueRecord('ai-images/p', 1000, 7 * 24 * 3600 * 1000);
  assert.equal(r.storagePath, 'ai-images/p');
  assert.equal(r.recordedAt, 1000);
  assert.equal(r.deleteAfter, 1000 + 7 * 24 * 3600 * 1000);
});
