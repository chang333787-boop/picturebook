/* IMAGE-S2-1 — imageS2 상태 정규화 + 표시 이미지 결정 단위 하니스.
   DOM·Firebase SDK 없이 viewer-data.js 순수 helper만 검증.
   실행: node --test tests/image-s2-data/image-s2-data.test.js

   핵심 불변(확정 PRD):
   - s2는 url 유효 + stale 아님 + (작품 selected==='s2' 또는 학생 previewMode==='s2') 일 때만 표시.
   - 그 외 전부 원본 fallback. 원본 우선순위 imageData→imageUrl(기존 렌더와 동일).
   - imageSelections.selected 임의값/'student-manual' → 'original'로 정규화.
   - 학생 previewMode는 로컬 인자일 뿐 — 이 함수는 RTDB를 건드리지 않음(순수). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const VD = require('../../viewer-data.js');
const {
  normalizeImagePolicy, normalizeImageSelection, normalizeS2Variant,
  pickS2VariantForScene, resolveSceneImageSource,
} = VD;

const goodS2 = (over) => Object.assign({
  url: 'https://example.test/ai-images/s2.png', storagePath: 'ai-images/c/t/scene_1_s2_1.png',
  sourceMode: 'draw', basedOnImageHash: 'h', model: 'm', modelVersion: 'mv', promptVersion: 'p',
  targetFrame: { w: 1536, h: 1024 }, fitPolicy: 'fit-imagecenter-landscape', finalizedAt: 1, stale: false,
}, over || {});

/* ── resolveSceneImageSource ─────────────────────────────────── */

test('1. 원본만(선택·s2 없음) → original', () => {
  const r = resolveSceneImageSource({ imageData: 'data:img' }, null, null, null);
  assert.equal(r.kind, 'original');
  assert.equal(r.src, 'data:img');
  assert.equal(r.isAiTransformed, false);
  assert.equal(r.fallbackReason, null);
});

test('2. s2 존재하지만 selected original → original', () => {
  const r = resolveSceneImageSource({ imageData: 'data:img' }, { selected: 'original' }, goodS2(), null);
  assert.equal(r.kind, 'original');
  assert.equal(r.src, 'data:img');
  assert.equal(r.fallbackReason, null);   /* 선택이 original이라 fallback이 아님 */
});

test('3. s2 존재 + selected s2 → s2', () => {
  const r = resolveSceneImageSource({ imageData: 'data:img' }, { selected: 's2' }, goodS2(), null);
  assert.equal(r.kind, 's2');
  assert.equal(r.src, goodS2().url);
  assert.equal(r.isAiTransformed, true);
});

test('4. stale s2 + selected s2 → original(stale)', () => {
  const r = resolveSceneImageSource({ imageData: 'data:img' }, { selected: 's2' }, goodS2({ stale: true }), null);
  assert.equal(r.kind, 'original');
  assert.equal(r.src, 'data:img');
  assert.equal(r.fallbackReason, 'stale');
});

test('5. 잘못된 selected 값 → original', () => {
  for (const bad of ['student-manual', 'S2', 'foo', 1, true, {}]) {
    const r = resolveSceneImageSource({ imageData: 'data:img' }, { selected: bad }, goodS2(), null);
    assert.equal(r.kind, 'original', `selected=${JSON.stringify(bad)}`);
    assert.equal(r.src, 'data:img');
  }
});

test('6. s2 URL 없음(+ selected s2) → original(invalid-url)', () => {
  const r = resolveSceneImageSource({ imageData: 'data:img' }, { selected: 's2' }, { storagePath: 'p', stale: false }, null);
  assert.equal(r.kind, 'original');
  assert.equal(r.fallbackReason, 'invalid-url');
});

test('7. 학생 개인 미리보기(selected original, previewMode s2, 유효 s2) → s2', () => {
  const r = resolveSceneImageSource({ imageData: 'data:img' }, { selected: 'original' }, goodS2(), 's2');
  assert.equal(r.kind, 's2');
  assert.equal(r.src, goodS2().url);
});

test('8. 학생 미리보기 + stale → original', () => {
  const r = resolveSceneImageSource({ imageData: 'data:img' }, { selected: 'original' }, goodS2({ stale: true }), 's2');
  assert.equal(r.kind, 'original');
  assert.equal(r.fallbackReason, 'stale');
});

test('8b. 학생 previewMode original 이지만 작품 selected s2 → s2(작품 선택 우선)', () => {
  const r = resolveSceneImageSource({ imageData: 'data:img' }, { selected: 's2' }, goodS2(), 'original');
  assert.equal(r.kind, 's2');   /* previewMode가 's2'가 아니면 작품 selected를 따름 */
});

test('9. 기존 작품(정책/선택/s2 전부 없음) → 기존 렌더와 동일(imageData||imageUrl)', () => {
  assert.equal(resolveSceneImageSource({ imageData: 'D', imageUrl: 'U' }, undefined, undefined, undefined).src, 'D');
  assert.equal(resolveSceneImageSource({ imageUrl: 'U' }, undefined, undefined, undefined).src, 'U');
  const r = resolveSceneImageSource({ imageUrl: 'U' }, undefined, undefined, undefined);
  assert.equal(r.kind, 'original');
  assert.equal(r.isAiTransformed, false);
  assert.equal(r.fallbackReason, null);
});

test('10. 원본 없음 → src null + no-original(placeholder는 호출부)', () => {
  const r = resolveSceneImageSource({}, { selected: 's2' }, null, null);
  assert.equal(r.kind, 'original');
  assert.equal(r.src, null);
  assert.equal(r.fallbackReason, 'no-original');
});

test('10b. s2 없는데 selected s2 + 원본 있음 → original(missing-s2)', () => {
  const r = resolveSceneImageSource({ imageData: 'D' }, { selected: 's2' }, null, null);
  assert.equal(r.kind, 'original');
  assert.equal(r.fallbackReason, 'missing-s2');
});

/* ── normalize* ──────────────────────────────────────────────── */

test('normalizeImagePolicy: sourceMode upload|draw만, 그 외 null', () => {
  assert.equal(normalizeImagePolicy({ sourceMode: 'upload' }).sourceMode, 'upload');
  assert.equal(normalizeImagePolicy({ sourceMode: 'draw' }).sourceMode, 'draw');
  assert.equal(normalizeImagePolicy({ sourceMode: 'paint' }).sourceMode, null);
  assert.equal(normalizeImagePolicy(null).sourceMode, null);
  assert.equal(normalizeImagePolicy({ lockedAt: 'x' }).lockedAt, null);
});

test('normalizeImageSelection: student-manual·임의값 거부', () => {
  assert.equal(normalizeImageSelection({ selected: 'student-manual' }).selected, 'original');
  assert.equal(normalizeImageSelection({ selected: 's2', selectionSource: 'student-manual' }).selectionSource, null);
  assert.equal(normalizeImageSelection({ selected: 's2', selectionSource: 'teacher-batch' }).selectionSource, 'teacher-batch');
  assert.equal(normalizeImageSelection({ selectionSource: 'system-stale' }).selectionSource, 'system-stale');
  assert.equal(normalizeImageSelection(undefined).selected, 'original');
});

test('normalizeS2Variant: url 없으면 null', () => {
  assert.equal(normalizeS2Variant(null), null);
  assert.equal(normalizeS2Variant({ storagePath: 'p' }), null);
  assert.equal(normalizeS2Variant({ url: '   ' }), null);
  assert.equal(normalizeS2Variant({ url: 'https://x/y.png' }).url, 'https://x/y.png');
  assert.equal(normalizeS2Variant(goodS2({ stale: true })).stale, true);
});

test('pickS2VariantForScene: 키 불일치 → null (sceneId 불일치 안전)', () => {
  const map = { s1: {}, s2: { sceneA: goodS2() } };
  assert.deepEqual(pickS2VariantForScene(map, 'sceneA'), goodS2());
  assert.equal(pickS2VariantForScene(map, 'sceneB'), null);   /* 불일치 → null → 원본 */
  assert.equal(pickS2VariantForScene(null, 'sceneA'), null);
  assert.equal(pickS2VariantForScene({}, 'sceneA'), null);
});

test('통합: pick + resolve — 키 불일치 장면은 원본', () => {
  const variants = { s1: {}, s2: { '1': goodS2() } };
  const scene2 = { id: '2', imageData: 'D2' };
  const r = resolveSceneImageSource(scene2, { selected: 's2' }, pickS2VariantForScene(variants, scene2.id), null);
  assert.equal(r.kind, 'original');
  assert.equal(r.src, 'D2');
});
