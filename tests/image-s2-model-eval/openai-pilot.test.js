/* IMAGE-S2 OpenAI 파일럿 — 실 결선 검증 (fake fetch, 네트워크/secret 0).
   실행: node --test tests/image-s2-model-eval/openai-pilot.test.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const oa = require('../../scripts/image-s2-model-eval/openai-eval-adapter.js');
const lib = require('../../scripts/image-s2-model-eval/eval-lib.js');
const pilot = require('../../scripts/image-s2-model-eval/run-openai-pilot.js');
const draft = require('../../scripts/image-s2-model-eval/production-adapter-draft.js');
const pilotManifest = require('../../scripts/image-s2-model-eval/pilot-samples.json');
const { createCanvas } = require('../../scripts/image-s2-model-eval/raster.js');

const PNG = createCanvas(4, 4).toPNG();
const PNG_B64 = PNG.toString('base64');

/* fake fetch/FormData/Blob */
function fakeForm() { const f = []; f.append = (k, v) => f.push([k, v]); return f; }
function FakeBlob() {}
function fetchReturning({ status = 200, contentType = 'application/json', json = null, throwErr = null }) {
  return async () => {
    if (throwErr) throw throwErr;
    return { status, headers: { get: () => contentType }, json: async () => json };
  };
}

/* ── classifyOpenAiResult 전 분기 ── */
test('classify — 성공(valid png b64) → ok + image/png + usage', () => {
  const r = oa.classifyOpenAiResult({ status: 200, contentType: 'application/json', json: { data: [{ b64_json: PNG_B64 }], usage: { output_tokens: 100 } } });
  assert.equal(r.ok, true); assert.equal(r.mimeType, 'image/png'); assert.ok(r.usage);
});
test('classify — HTML 응답 → INVALID', () => {
  assert.equal(oa.classifyOpenAiResult({ status: 200, contentType: 'text/html', json: null }).code, 'IMAGE_AI_INVALID_OUTPUT');
});
test('classify — content_policy refusal → UNSAFE_OUTPUT', () => {
  const r = oa.classifyOpenAiResult({ status: 400, contentType: 'application/json', json: { error: { code: 'content_policy_violation', message: 'rejected' } } });
  assert.equal(r.code, 'IMAGE_AI_UNSAFE_OUTPUT'); assert.equal(r.refusal, true);
});
test('classify — 일반 4xx → PROVIDER_ERROR / 504 → TIMEOUT', () => {
  assert.equal(oa.classifyOpenAiResult({ status: 400, contentType: 'application/json', json: { error: { code: 'bad_request' } } }).code, 'IMAGE_AI_PROVIDER_ERROR');
  assert.equal(oa.classifyOpenAiResult({ status: 504, contentType: 'application/json', json: { error: {} } }).code, 'IMAGE_AI_TIMEOUT');
});
test('classify — b64 없음/빈출력/비이미지/초과 → INVALID', () => {
  assert.equal(oa.classifyOpenAiResult({ status: 200, contentType: 'application/json', json: { data: [{}] } }).code, 'IMAGE_AI_INVALID_OUTPUT');
  assert.equal(oa.classifyOpenAiResult({ status: 200, contentType: 'application/json', json: { data: [{ b64_json: '' }] } }).code, 'IMAGE_AI_INVALID_OUTPUT');
  assert.equal(oa.classifyOpenAiResult({ status: 200, contentType: 'application/json', json: { data: [{ b64_json: Buffer.from('not an image').toString('base64') }] } }).code, 'IMAGE_AI_INVALID_OUTPUT');
  assert.equal(oa.classifyOpenAiResult({ status: 200, contentType: 'application/json', json: { data: [{ b64_json: PNG_B64 }] }, maxBytes: 4 }).code, 'IMAGE_AI_INVALID_OUTPUT');
});

/* ── 순수 헬퍼 ── */
test('sniffMime / buildEditRequest / estimateCost / isSafetyRefusal', () => {
  assert.equal(oa.sniffMime(PNG), 'image/png');
  assert.equal(oa.sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0x00])), 'image/jpeg');
  assert.equal(oa.sniffMime(Buffer.from('xx')), null);
  const req = oa.buildEditRequest({ prompt: 'p' });
  assert.equal(req.fields.model, 'gpt-image-2'); assert.equal(req.fields.size, '1536x1024'); assert.equal(req.fields.quality, 'medium'); assert.equal(req.fields.n, 1);
  assert.ok(oa.estimateCostFromUsage({ output_tokens: 1000000 }, 0.05) >= 30); /* 1M out 토큰 ~= $30 */
  assert.equal(oa.estimateCostFromUsage(null, 0.05), 0.05);
  assert.equal(oa.isSafetyRefusal({ error: { code: 'moderation_blocked' } }), true);
  assert.equal(oa.isSafetyRefusal({ error: { code: 'bad' } }), false);
});

/* ── callOpenAiImageEdit (fake fetch) ── */
test('callOpenAiImageEdit — secret 없음 → SECRET_MISSING, fetch 미호출', async () => {
  let called = false;
  const r = await oa.callOpenAiImageEdit({ apiKey: '', imagePng: PNG, prompt: 'p', fetchImpl: async () => { called = true; }, FormDataImpl: fakeForm, BlobImpl: FakeBlob });
  assert.equal(r.code, 'EVAL_SECRET_MISSING'); assert.equal(called, false);
});
test('callOpenAiImageEdit — bad input(png 없음) → BAD_INPUT', async () => {
  const r = await oa.callOpenAiImageEdit({ apiKey: 'k', imagePng: null, prompt: 'p', fetchImpl: async () => ({}), FormDataImpl: fakeForm, BlobImpl: FakeBlob });
  assert.equal(r.code, 'EVAL_BAD_INPUT');
});
test('callOpenAiImageEdit — 성공(fake) → ok png', async () => {
  const r = await oa.callOpenAiImageEdit({
    apiKey: 'k', imagePng: PNG, prompt: 'p', nowFn: () => 1000,
    fetchImpl: fetchReturning({ json: { data: [{ b64_json: PNG_B64 }], usage: { output_tokens: 10 } } }),
    FormDataImpl: fakeForm, BlobImpl: FakeBlob,
  });
  assert.equal(r.ok, true); assert.equal(r.mimeType, 'image/png'); assert.ok(Buffer.isBuffer(r.imageBytes));
});
test('callOpenAiImageEdit — abort 던짐 → TIMEOUT', async () => {
  const err = new Error('The operation was aborted'); err.name = 'AbortError';
  const r = await oa.callOpenAiImageEdit({ apiKey: 'k', imagePng: PNG, prompt: 'p', fetchImpl: fetchReturning({ throwErr: err }), FormDataImpl: fakeForm, BlobImpl: FakeBlob });
  assert.equal(r.code, 'IMAGE_AI_TIMEOUT');
});

/* ── 합성 샘플 가드 ── */
test('isSyntheticSampleAllowed — 합성만 허용', () => {
  assert.equal(lib.isSyntheticSampleAllowed({ id: 'A_x', synthetic: true }), true);
  assert.equal(lib.isSyntheticSampleAllowed({ id: 'A_x', synthetic: false }), false);
  assert.equal(lib.isSyntheticSampleAllowed({ id: 'A_x', synthetic: true, source: 'student' }), false);
  assert.equal(lib.isSyntheticSampleAllowed({ id: 'realphoto', synthetic: true }), false);
});

/* ── pilot manifest / 모듈 상수 ── */
test('pilot — 합성 PNG 2종·sha256·상수', () => {
  assert.equal(pilotManifest.synthetic, true);
  assert.equal(pilotManifest.samples.length, 2);
  for (const s of pilotManifest.samples) { assert.equal(s.format, 'png'); assert.match(s.sha256, /^[0-9a-f]{64}$/); assert.equal(s.synthetic, true); }
  assert.equal(pilot.MAX_CALLS, 2);
  assert.equal(pilot.HARD_COST_CAP, 0.5);
  assert.ok(pilot.loadPilotSamples().every(lib.isSyntheticSampleAllowed));
});

/* ── production adapter 초안 ── */
test('production-adapter-draft — 미설정/소스없음 분기(네트워크 0)', async () => {
  const a0 = draft.createOpenAiImageAdapter({});
  assert.equal(a0.configured, false);
  assert.equal((await a0.generate({})).code, 'IMAGE_AI_NOT_CONFIGURED');
  const a1 = draft.createOpenAiImageAdapter({ apiKey: 'k', fetchSourceImage: async () => null });
  assert.equal(a1.configured, true);
  assert.equal((await a1.generate({ promptText: 'p' })).code, 'IMAGE_AI_INVALID_OUTPUT'); /* source 없음 → 네트워크 전 차단 */
});
