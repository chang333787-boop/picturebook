/* IMAGE-S2-10 교사 UI 순수 로직 검증 (DOM/firebase 0).
   실행: node --test tests/image-s2-ui/viewer-image-batch.test.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const B = require('../../viewer-image-batch.js');

test('computeBatchGate — 교사+imageS2 ON이면 시작 가능(provider/privacy 미구현 플래그가 막지 않음)', () => {
  assert.equal(B.computeBatchGate({ isTeacher: false }).state, 'not-teacher');
  assert.equal(B.computeBatchGate({ isTeacher: true, imageS2Enabled: false }).state, 'disabled');
  /* ★ 핵심 회귀 방지: imageS2 ON이면 providerReady/privacyAcknowledged 없이도 시작 가능(과거 'provider' 버그). */
  const onlyEnabled = B.computeBatchGate({ isTeacher: true, imageS2Enabled: true });
  assert.equal(onlyEnabled.canStart, true); assert.equal(onlyEnabled.state, 'ready');
  /* privacyAcknowledged 없으면 안내 플래그만 true(차단 아님). */
  assert.equal(onlyEnabled.privacyNotice, true);
  assert.equal(B.computeBatchGate({ isTeacher: true, imageS2Enabled: true, privacyAcknowledged: true }).privacyNotice, false);
  /* 장면 수 게이트(선택적) */
  assert.equal(B.computeBatchGate({ isTeacher: true, imageS2Enabled: true, imageSceneCount: 0 }).state, 'no-images');
  assert.equal(B.computeBatchGate({ isTeacher: true, imageS2Enabled: true, imageSceneCount: 3, pendingCount: 0 }).state, 'all-done');
  assert.equal(B.computeBatchGate({ isTeacher: true, imageS2Enabled: true, imageSceneCount: 3, pendingCount: 2 }).canStart, true);
  /* 미전달이면 검사 생략(순수 게이트 호환) */
  assert.equal(B.computeBatchGate({ isTeacher: true, imageS2Enabled: true }).canStart, true);
  assert.ok(B.computeBatchGate({ isTeacher: true }).reason);
});

test('format 헬퍼', () => {
  assert.equal(B.formatCostUsd(0.05), '$0.05');
  assert.equal(B.formatCostUsd(1.349), '$1.35');
  assert.equal(B.formatCostUsd(null), '$0.00');
  assert.equal(B.formatDuration(40), '약 40초');
  assert.equal(B.formatDuration(120), '약 2분');
  assert.equal(B.formatDuration(135), '약 2분 15초');
});

test('summarizeBatchPlan — 서버 plan 요약', () => {
  const s = B.summarizeBatchPlan({ totalScenes: 19, cachedCount: 1, skippedCount: 2, estCostUsd: 0.95, estSeconds: 1330 });
  assert.equal(s.needCount, 19); assert.equal(s.cachedCount, 1);
  assert.ok(s.needLabel.indexOf('19') !== -1);
  assert.ok(s.costLabel.indexOf('$0.95') !== -1);
  assert.ok(s.timeLabel.indexOf('분') !== -1);
  /* counts만 줘도 추정 */
  const s2 = B.summarizeBatchPlan({ totalScenes: 2 });
  assert.equal(s2.estCostUsd, Math.round(2 * B.PER_IMAGE_USD * 1e6) / 1e6);
  assert.equal(s2.cachedLabel, '');
});

test('sanitizeBatchRequest — 허용 키만, 주입 제거', () => {
  const r = B.sanitizeBatchRequest({ classId: 'c', teamName: 't', forceRegenerate: true, sceneIds: ['1', 2, ''], url: 'http://x', prompt: 'p', provider: 'openai', sourceMode: 'upload', storagePath: 'images/x', cost: 999 });
  assert.deepEqual(Object.keys(r).sort(), ['classId', 'forceRegenerate', 'sceneIds', 'teamName']);
  assert.equal(r.url, undefined); assert.equal(r.prompt, undefined); assert.equal(r.provider, undefined);
  assert.deepEqual(r.sceneIds, ['1', '2']);
  assert.equal(B.sanitizeBatchRequest({ classId: 'c', teamName: 't' }).forceRegenerate, false);
  assert.equal(B.sanitizeBatchRequest({ classId: 'c', teamName: 't', sceneIds: [] }).sceneIds, undefined);
});

test('sceneStatusLabel / progressSummary / nextTarget', () => {
  assert.equal(B.sceneStatusLabel('processing'), '변환 중…');
  assert.equal(B.sceneStatusLabel('cached'), '최신 결과 있음');
  const job = { sceneStates: { 1: { status: 'succeeded' }, 2: { status: 'failed' }, 3: { status: 'pending' }, 4: { status: 'cached' } } };
  const p = B.progressSummary(job);
  assert.equal(p.total, 4); assert.equal(p.succeeded, 1); assert.equal(p.failed, 1); assert.equal(p.cached, 1); assert.equal(p.pending, 1);
  assert.equal(p.percent, 50);                 /* (succeeded1 + cached1)/4 */
  assert.equal(p.label, '2 / 4');
  assert.equal(p.remainingCount, 2);           /* failed + pending */
  assert.equal(B.nextTarget(['1', '2', '3'], { 1: true }), '2');
  assert.equal(B.nextTarget(['1'], { 1: true }), null);
});

test('resolveCompareImages — 선택/usable/stale 결정 (원본 미수정)', () => {
  const scene = { imageData: 'orig.png' };
  /* 선택 없음 → 원본 */
  let r = B.resolveCompareImages(scene, null, { url: 's2.png' });
  assert.equal(r.shown, 'original'); assert.equal(r.shownSrc, 'orig.png'); assert.equal(r.s2Usable, true);
  /* s2 선택 + usable → s2 */
  r = B.resolveCompareImages(scene, { selected: 's2' }, { url: 's2.png' });
  assert.equal(r.shown, 's2'); assert.equal(r.shownSrc, 's2.png');
  /* s2 선택인데 stale → 원본 + 경고 */
  r = B.resolveCompareImages(scene, { selected: 's2' }, { url: 's2.png', stale: true });
  assert.equal(r.shown, 'original'); assert.equal(r.staleWarning, true); assert.equal(r.s2Usable, false);
  /* s2 없음 → 원본 */
  r = B.resolveCompareImages(scene, { selected: 's2' }, null);
  assert.equal(r.shown, 'original'); assert.equal(r.s2, null);
  /* 원본은 imageUrl fallback */
  assert.equal(B.resolveCompareImages({ imageUrl: 'u.png' }, null, null).original, 'u.png');
});
