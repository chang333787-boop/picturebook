/* IMAGE-S2-9 production OpenAI adapter 검증 (mock fetch·네트워크/secret 0).
   실행: node --test tests/image-s2-prod/openai-adapter.test.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const A = require('../../functions/image-s2-adapter-openai.js');

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const PNG = Buffer.from(PNG_B64, 'base64');
function fakeForm() { const f = []; f.append = (k, v) => f.push([k, v]); return f; }
function FakeBlob() {}
function okFetch() { return async () => ({ status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [{ b64_json: PNG_B64 }], usage: { output_tokens: 10 } }) }); }

test('정본 프롬프트(P5) — 보존 가드 + 완성형 마감 + 선 녹임/조화', () => {
  const p = A.OPENAI_S2_PROMPT.toLowerCase();
  /* 보존 가드 */
  assert.ok(p.indexOf('korean text') !== -1, '한글 보존');
  assert.ok(p.indexOf('do not add, remove, merge, split, or move') !== -1, '수/위치 보존(추가·삭제·병합·이동 금지)');
  assert.ok(p.indexOf('do not redesign faces, hands, or bodies') !== -1, '얼굴/손/몸 재설계 금지');
  assert.ok(p.indexOf('same count') !== -1, '수 보존');
  assert.ok(p.indexOf('3:2') !== -1, '가로 3:2');
  assert.ok(p.indexOf('photorealistic') !== -1 && p.indexOf('do not make it photorealistic') !== -1, '사실화/3D/상업풍 금지');
  /* P4 완성형 마감 의도(P3 대비 강화) */
  assert.ok(p.indexOf('fully finished picture-book') !== -1, '완성형 그림책 마감');
  assert.ok(p.indexOf('leave no unfinished white paper') !== -1, '빈 흰 종이 없이 배경 채움');
  assert.ok(p.indexOf('watercolor') !== -1 && p.indexOf('colored pencil') !== -1, '수채+색연필 손그림');
  /* P5(2026-07-08) 강한 펜선 녹임 + 어설픔 조화 — 모양/비율/위치 보존 가드 유지 */
  assert.ok(p.indexOf('gently soften and blend those lines') !== -1, 'P5 강한 펜선 녹임');
  assert.ok(p.indexOf('harmonize their color, shading, and texture') !== -1, 'P5 어설픈 부분 조화');
  assert.ok(p.indexOf('keep every line in its original place and shape') !== -1, 'P5 선 위치/모양 보존');
  assert.ok(p.indexOf('do not tidy, correct, beautify, or redesign') !== -1, 'P5 재설계/미화 금지');
  assert.equal(A.PROMPT_VERSION, 'imgS2-openai-gpt-image-2-P5-v1');
});

test('configured — apiKey 없으면 false + NOT_CONFIGURED', async () => {
  const ad = A.createOpenAiImageS2Adapter({});
  assert.equal(ad.configured, false);
  assert.equal((await ad.generate({ originalSrc: 'data:image/png;base64,' + PNG_B64 })).code, 'IMAGE_AI_NOT_CONFIGURED');
});

test('SSRF — 허용 호스트만', () => {
  assert.equal(A.isAllowedSourceUrl('https://firebasestorage.googleapis.com/v0/b/x/o/y?alt=media&token=t'), true);
  assert.equal(A.isAllowedSourceUrl('https://evil.com/x.png'), false);
  assert.equal(A.isAllowedSourceUrl('data:image/png;base64,AAAA'), true);
  assert.equal(A.isAllowedSourceUrl('http://169.254.169.254/'), false);
});

test('generate — 외부 src 차단(SOURCE_NOT_ALLOWED, fetch 미호출)', async () => {
  let called = false;
  const ad = A.createOpenAiImageS2Adapter({ apiKey: 'k', fetchImpl: async () => { called = true; }, FormDataImpl: fakeForm, BlobImpl: FakeBlob });
  const r = await ad.generate({ originalSrc: 'https://evil.com/x.png' });
  assert.equal(r.code, 'IMAGE_AI_SOURCE_NOT_ALLOWED');
  assert.equal(called, false);
});

test('generate — 성공(data: 원본 + fake OpenAI)', async () => {
  const ad = A.createOpenAiImageS2Adapter({ apiKey: 'k', fetchImpl: okFetch(), FormDataImpl: fakeForm, BlobImpl: FakeBlob });
  const r = await ad.generate({ originalSrc: 'data:image/png;base64,' + PNG_B64, sourceMode: 'upload' });
  assert.equal(r.ok, true);
  assert.equal(r.mimeType, 'image/png');
  assert.ok(Buffer.isBuffer(r.bytes));
  assert.equal(r.model, 'gpt-image-2');
});

test('generate — IMAGE-S2-DIET-1: output_format/compression 폼 필드 전송', async () => {
  let captured = null;
  const base = okFetch();
  const fetchImpl = async (url, opts) => { captured = opts && opts.body; return base(url, opts); };
  const ad = A.createOpenAiImageS2Adapter({ apiKey: 'k', fetchImpl, FormDataImpl: fakeForm, BlobImpl: FakeBlob });
  const r = await ad.generate({ originalSrc: 'data:image/png;base64,' + PNG_B64, sourceMode: 'upload' });
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(captured), 'fakeForm 배열 캡처');
  const get = (k) => { const e = captured.find((p) => p[0] === k); return e ? e[1] : undefined; };
  assert.equal(get('output_format'), 'webp');
  assert.equal(get('output_compression'), '80');
  /* 기존 필드 회귀 가드 */
  assert.equal(get('size'), '1536x1024');
  assert.equal(get('quality'), 'medium');
  assert.equal(get('n'), '1');
});

test('generate — 허용 호스트 + downloadImpl 주입 성공', async () => {
  const ad = A.createOpenAiImageS2Adapter({ apiKey: 'k', fetchImpl: okFetch(), FormDataImpl: fakeForm, BlobImpl: FakeBlob, downloadImpl: async () => ({ bytes: PNG, mime: 'image/png' }) });
  const r = await ad.generate({ originalSrc: 'https://firebasestorage.googleapis.com/v0/b/x/o/img?alt=media&token=t' });
  assert.equal(r.ok, true);
});

test('generate — 원본 다운로드 실패 → SOURCE_FETCH_FAILED', async () => {
  const ad = A.createOpenAiImageS2Adapter({ apiKey: 'k', fetchImpl: okFetch(), FormDataImpl: fakeForm, BlobImpl: FakeBlob, downloadImpl: async () => { throw new Error('404'); } });
  assert.equal((await ad.generate({ originalSrc: 'data:image/png;base64,' + PNG_B64 })).code, 'IMAGE_AI_SOURCE_FETCH_FAILED');
});

test('generate — abort → TIMEOUT', async () => {
  const err = new Error('aborted'); err.name = 'AbortError';
  const ad = A.createOpenAiImageS2Adapter({ apiKey: 'k', fetchImpl: async () => { throw err; }, FormDataImpl: fakeForm, BlobImpl: FakeBlob });
  assert.equal((await ad.generate({ originalSrc: 'data:image/png;base64,' + PNG_B64 })).code, 'IMAGE_AI_TIMEOUT');
});

test('classifyResult — 분기', () => {
  assert.equal(A.classifyResult({ status: 200, contentType: 'application/json', json: { data: [{ b64_json: PNG_B64 }] } }).ok, true);
  assert.equal(A.classifyResult({ status: 200, contentType: 'text/html', json: null }).code, 'IMAGE_AI_INVALID_OUTPUT');
  assert.equal(A.classifyResult({ status: 400, contentType: 'application/json', json: { error: { code: 'content_policy_violation' } } }).code, 'IMAGE_AI_UNSAFE_OUTPUT');
  assert.equal(A.classifyResult({ status: 500, contentType: 'application/json', json: { error: { code: 'x' } } }).code, 'IMAGE_AI_PROVIDER_ERROR');
  assert.equal(A.classifyResult({ status: 504, contentType: 'application/json', json: { error: {} } }).code, 'IMAGE_AI_TIMEOUT');
  assert.equal(A.classifyResult({ status: 200, contentType: 'application/json', json: { data: [{}] } }).code, 'IMAGE_AI_INVALID_OUTPUT');
  assert.equal(A.classifyResult({ status: 200, contentType: 'application/json', json: { data: [{ b64_json: Buffer.from('xx').toString('base64') }] } }).code, 'IMAGE_AI_INVALID_OUTPUT');
});

test('sniffMime / estimateCost', () => {
  assert.equal(A.sniffMime(PNG), 'image/png');
  assert.equal(A.sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0])), 'image/jpeg');
  assert.equal(A.sniffMime(Buffer.from('zz')), null);
  assert.ok(A.estimateCost({ output_tokens: 1000000 }) >= 30);
  assert.equal(A.estimateCost(null), null);
});
