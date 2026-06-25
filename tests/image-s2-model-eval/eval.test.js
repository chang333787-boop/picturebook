/* IMAGE-S2-8 모델 평가 프레임워크 검증 (외부 호출 0).
   실행: node --test tests/image-s2-model-eval/eval.test.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const lib = require('../../scripts/image-s2-model-eval/eval-lib.js');
const promptPack = require('../../scripts/image-s2-model-eval/prompt-pack.js');
const { CANDIDATES, EXCLUDED } = require('../../scripts/image-s2-model-eval/candidates.js');
const adapters = require('../../scripts/image-s2-model-eval/eval-adapters.js');
const runner = require('../../scripts/image-s2-model-eval/run-evaluation.js');
const sampleManifest = require('../../scripts/image-s2-model-eval/sample-manifest.json');

/* ── candidates ── */
test('CANDIDATES — 전부 검증 통과(GA·편집지원·placeholder 아님·비용/출처/날짜 있음)', () => {
  assert.ok(CANDIDATES.length >= 2 && CANDIDATES.length <= 3, '후보 ≤3');
  for (const c of CANDIDATES) {
    const v = lib.validateCandidate(c);
    assert.ok(v.ok, `${c.id}: ${v.errors.join(', ')}`);
    assert.equal(c.supportsImageEdit, true);
    assert.ok(/^(ga|stable)$/.test(c.status), `${c.id} production status`);
    assert.ok(c.modelId && !/preview/.test(c.modelId), `${c.id} preview alias 아님`);
    assert.ok(c.officialUrl.indexOf('http') === 0);
  }
});

test('EXCLUDED — deprecated/편집미지원 후보는 이유와 함께 제외 기록', () => {
  assert.ok(EXCLUDED.length >= 3);
  for (const e of EXCLUDED) { assert.ok(e.modelId && e.reason && e.asOf); }
  /* deprecated id가 CANDIDATES에 새지 않았는지 */
  const candIds = CANDIDATES.map((c) => c.modelId);
  ['gpt-image-1', 'gpt-image-1.5', 'gpt-image-1-mini'].forEach((d) => assert.ok(candIds.indexOf(d) === -1, `${d} 후보 제외`));
});

/* ── validateCandidate 음성 케이스 ── */
test('validateCandidate — 빈/placeholder modelId·deprecated·편집미지원·무비용 거부', () => {
  assert.equal(lib.validateCandidate({ provider: 'x', modelId: '', status: 'ga', supportsImageEdit: true, pricing: { estPerImageUsd: 1 }, officialUrl: 'http://x', asOf: 'd' }).ok, false);
  assert.equal(lib.validateCandidate({ provider: 'x', modelId: '평가 시 확인', status: 'ga', supportsImageEdit: true, pricing: { estPerImageUsd: 1 }, officialUrl: 'http://x', asOf: 'd' }).ok, false);
  assert.equal(lib.validateCandidate({ provider: 'x', modelId: 'm', status: 'deprecated', supportsImageEdit: true, pricing: { estPerImageUsd: 1 }, officialUrl: 'http://x', asOf: 'd' }).ok, false);
  assert.equal(lib.validateCandidate({ provider: 'x', modelId: 'm', status: 'ga', supportsImageEdit: false, pricing: { estPerImageUsd: 1 }, officialUrl: 'http://x', asOf: 'd' }).ok, false);
  assert.equal(lib.validateCandidate({ provider: 'x', modelId: 'm', status: 'ga', supportsImageEdit: true, pricing: {}, officialUrl: 'http://x', asOf: 'd' }).ok, false);
});

/* ── prompt pack ── */
test('prompt-pack — 팩 검증 통과 + 금지어 가드 동작', () => {
  const v = promptPack.validatePromptPack();
  assert.ok(v.ok, v.errors.join(', '));
  assert.equal(promptPack.DEFAULT_LEVEL_CANDIDATE, 'P2');
  for (const id of promptPack.listLevels()) {
    const p = promptPack.buildPrompt(id);
    assert.equal(promptPack.findBannedPhrase(p.text), null, `${id} 정본 프롬프트엔 금지어 없음`);
    assert.ok(p.text.indexOf('3:2') !== -1);
  }
  /* override/편집 프롬프트의 금지어는 잡아야 */
  assert.equal(promptPack.findBannedPhrase('make it look like Ghibli'), 'ghibli');
  assert.equal(promptPack.findBannedPhrase('completely redraw from scratch'), 'redraw');
  assert.equal(promptPack.findBannedPhrase('완전히 다시 그려줘'), '완전히 다시');
  assert.equal(promptPack.findBannedPhrase('add a new character to the scene'), 'add a new character');
  assert.equal(promptPack.buildPrompt('NOPE'), null);
});

/* ── eval-lib 안전장치 ── */
test('isSafeOutputPath — traversal/외부 차단', () => {
  assert.equal(lib.isSafeOutputPath('/base/out', '/base/out/r.json'), true);
  assert.equal(lib.isSafeOutputPath('/base/out', '/base/out/../../etc/passwd'), false);
  assert.equal(lib.isSafeOutputPath('/base/out', '/elsewhere/r.json'), false);
  assert.equal(lib.isSafeOutputPath('/base/out', ''), false);
});

test('computePlannedCalls / estimateMaxCostUsd', () => {
  assert.equal(lib.computePlannedCalls({ modelCount: 3, sampleCount: 2, levelCount: 3 }), 18);
  const cs = [{ pricing: { estPerImageUsd: 0.05 } }, { pricing: { estPerImageUsd: 0.04 } }];
  assert.equal(lib.estimateMaxCostUsd(cs, { sampleCount: 2, levelCount: 3 }), Math.round((0.05 + 0.04) * 6 * 1e6) / 1e6);
});

test('decideExecuteGate — dry-run 기본·secret/max-cost/예산/production 차단', () => {
  assert.equal(lib.decideExecuteGate({ execute: false }).dryRun, true);
  assert.equal(lib.decideExecuteGate({ execute: true, secretPresent: false, maxCostUsd: 1 }).allowed, false);
  assert.equal(lib.decideExecuteGate({ execute: true, secretPresent: true }).allowed, false); /* max-cost 없음 */
  assert.equal(lib.decideExecuteGate({ execute: true, secretPresent: true, maxCostUsd: 1, estMaxCostUsd: 2 }).allowed, false); /* 예산 초과 */
  assert.equal(lib.decideExecuteGate({ execute: true, secretPresent: true, maxCostUsd: 5, estMaxCostUsd: 2, production: true }).allowed, false); /* production */
  assert.equal(lib.decideExecuteGate({ execute: true, secretPresent: true, maxCostUsd: 5, estMaxCostUsd: 2 }).allowed, true);
});

test('makeCostGuard — 한도 초과 직전 중단', () => {
  const g = lib.makeCostGuard(0.1);
  assert.equal(g.canAfford(0.05), true); g.add(0.05);
  assert.equal(g.canAfford(0.05), true); g.add(0.05);
  assert.equal(g.canAfford(0.05), false); /* 0.15 > 0.1 */
  assert.equal(g.remaining(), 0);
  const ng = lib.makeCostGuard(NaN);
  assert.equal(ng.canAfford(999), true); /* 한도 없으면 항상 true */
});

test('parseArgs / buildDryRunPlan / buildResultRecord', () => {
  const a = lib.parseArgs(['--provider', 'openai', '--execute', '--max-cost', '1.5', 'pos']);
  assert.equal(a.provider, 'openai'); assert.equal(a.execute, true); assert.equal(a['max-cost'], '1.5'); assert.deepEqual(a._, ['pos']);
  const plan = lib.buildDryRunPlan({ candidates: [{ provider: 'p', modelId: 'm', status: 'ga', pricing: { estPerImageUsd: 0.05 } }], samples: [{ id: 's', sha256: 'h' }], levels: ['P2'], promptVersion: 'v' });
  assert.equal(plan.externalCall, false); assert.equal(plan.plannedCalls, 1);
  const rec = lib.buildResultRecord({ provider: 'p', modelId: 'm', sampleId: 's', promptLevel: 'P2', ok: true });
  assert.equal(rec.ok, true); assert.equal(rec.outputRef, null); /* 원본 미복사 */
});

/* ── sample manifest ── */
test('sample-manifest — 합성·개인정보 0·하니스 한정 플래그·sha256', () => {
  assert.ok(sampleManifest.harnessOnly === true);
  assert.ok(sampleManifest.insufficientForFinalQualityDecision === true);
  assert.ok(sampleManifest.samples.length >= 6);
  for (const s of sampleManifest.samples) { assert.match(s.sha256, /^[0-9a-f]{64}$/); assert.ok(s.bytes > 0); }
});

/* ── eval-adapters ── */
test('eval-adapter — dryRun 외부호출 0, execute는 secret 없으면 SECRET_MISSING', async () => {
  const ad = adapters.createEvalAdapter(CANDIDATES[0], { env: {} });
  const plan = ad.dryRun({ sampleId: 's', promptLevel: 'P2' });
  assert.equal(plan.externalCall, false);
  assert.equal(plan.secretPresent, false);
  const ex = await ad.execute({ sampleId: 's' });
  assert.equal(ex.ok, false);
  assert.equal(ex.code, 'EVAL_SECRET_MISSING');
  /* secret 있어도 SDK 미설치면 실제 호출 안 함 */
  const ad2 = adapters.createEvalAdapter(CANDIDATES[0], { env: { OPENAI_API_KEY: 'x' } });
  const ex2 = await ad2.execute({ sampleId: 's' });
  assert.ok(ex2.code === 'EVAL_SDK_NOT_INSTALLED' || ex2.code === 'EVAL_NOT_WIRED');
});

/* ── runner 선택 로직 ── */
test('runner — selectCandidates/Levels', () => {
  assert.ok(runner.selectCandidates({ provider: 'openai' }).every((c) => c.provider === 'openai'));
  assert.deepEqual(runner.selectLevels({ 'prompt-level': 'P2' }), ['P2']);
  assert.ok(runner.selectLevels({}).length === 3);
});
