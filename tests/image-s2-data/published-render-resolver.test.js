/* IMAGE-S2-RENDER-1 — getPublishedImageDisplaySrc (라이브 렌더 발행 선택 resolver) 단위 테스트.
   원본 보호 + selection 기반 표시 + 모든 실패 경로 원본 fallback 검증. 네트워크 0. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const V = require(path.join(__dirname, '..', '..', 'viewer-data.js'));
const { _setPublishedImageCaches, getPublishedImageDisplaySrc } = V;

const S2_URL = 'https://firebasestorage.googleapis.com/v0/b/x/o/ai-images%2Fscene_1_s2.png?alt=media&token=t';
const ORIG = 'data:image/png;base64,ORIGINAL';

function scene(overrides) {
  return Object.assign({ id: '1', imageData: ORIG }, overrides || {});
}

test('selection 없음(빈 캐시) → 원본', () => {
  _setPublishedImageCaches(null, null);
  assert.strictEqual(getPublishedImageDisplaySrc(scene(), ORIG), ORIG);
});

test('selection original → 원본', () => {
  _setPublishedImageCaches({ '1': { s2: { url: S2_URL, stale: false } } }, { '1': { selected: 'original' } });
  assert.strictEqual(getPublishedImageDisplaySrc(scene(), ORIG), ORIG);
});

test('selection s2 + valid variant → AI url', () => {
  _setPublishedImageCaches({ '1': { s2: { url: S2_URL, stale: false } } }, { '1': { selected: 's2' } });
  assert.strictEqual(getPublishedImageDisplaySrc(scene(), ORIG), S2_URL);
});

test('selection s2 + stale true → 원본', () => {
  _setPublishedImageCaches({ '1': { s2: { url: S2_URL, stale: true } } }, { '1': { selected: 's2' } });
  assert.strictEqual(getPublishedImageDisplaySrc(scene(), ORIG), ORIG);
});

test('selection s2 + variant 없음 → 원본', () => {
  _setPublishedImageCaches({}, { '1': { selected: 's2' } });
  assert.strictEqual(getPublishedImageDisplaySrc(scene(), ORIG), ORIG);
});

test('selection s2 + url 빈 값 → 원본', () => {
  _setPublishedImageCaches({ '1': { s2: { url: '', stale: false } } }, { '1': { selected: 's2' } });
  assert.strictEqual(getPublishedImageDisplaySrc(scene(), ORIG), ORIG);
});

test('selection s2 이지만 sceneId 키 불일치 → 원본', () => {
  _setPublishedImageCaches({ '2': { s2: { url: S2_URL, stale: false } } }, { '2': { selected: 's2' } });
  assert.strictEqual(getPublishedImageDisplaySrc(scene({ id: '1' }), ORIG), ORIG);
});

test('원본 scene.imageData 불변(부작용 없음)', () => {
  _setPublishedImageCaches({ '1': { s2: { url: S2_URL, stale: false } } }, { '1': { selected: 's2' } });
  const sc = scene();
  getPublishedImageDisplaySrc(sc, ORIG);
  assert.strictEqual(sc.imageData, ORIG);   /* 원본 필드 그대로 */
});

test('imageUrl-only 작품 — selection 없으면 호출부 originalSrc 보존', () => {
  _setPublishedImageCaches(null, null);
  const sc = { id: '1', imageUrl: 'https://x/orig.png' };
  assert.strictEqual(getPublishedImageDisplaySrc(sc, sc.imageUrl), sc.imageUrl);
});

test('구작품(aiVariants 전무) → 원본', () => {
  _setPublishedImageCaches(undefined, undefined);
  assert.strictEqual(getPublishedImageDisplaySrc(scene(), ORIG), ORIG);
});

test('scene null/ sid 없음 → originalSrc 그대로', () => {
  _setPublishedImageCaches({ '1': { s2: { url: S2_URL, stale: false } } }, { '1': { selected: 's2' } });
  assert.strictEqual(getPublishedImageDisplaySrc(null, ORIG), ORIG);
  assert.strictEqual(getPublishedImageDisplaySrc({ imageData: ORIG }, ORIG), ORIG);   /* id 없음 */
});

test('scene.sceneId fallback(id 없을 때) 매칭', () => {
  _setPublishedImageCaches({ '7': { s2: { url: S2_URL, stale: false } } }, { '7': { selected: 's2' } });
  assert.strictEqual(getPublishedImageDisplaySrc({ sceneId: 7, imageData: ORIG }, ORIG), S2_URL);
});

/* IMAGE-S2-RENDER-2 — 선택 적용 직후 캐시 동기 갱신 setter */
const { setPublishedImageSelectionForScene } = V;

test('setter s2 + 변형노드 → 이후 렌더 s2 표시', () => {
  _setPublishedImageCaches(null, null);   /* 빈 캐시(team 진입엔 없던 새 s2 가정) */
  assert.strictEqual(getPublishedImageDisplaySrc(scene(), ORIG), ORIG);
  setPublishedImageSelectionForScene('1', 's2', { url: S2_URL, stale: false });
  assert.strictEqual(getPublishedImageDisplaySrc(scene(), ORIG), S2_URL);
});

test('setter original → 이후 렌더 원본', () => {
  _setPublishedImageCaches({ '1': { s2: { url: S2_URL, stale: false } } }, { '1': { selected: 's2' } });
  assert.strictEqual(getPublishedImageDisplaySrc(scene(), ORIG), S2_URL);
  setPublishedImageSelectionForScene('1', 'original', null);
  assert.strictEqual(getPublishedImageDisplaySrc(scene(), ORIG), ORIG);
});

test('setter s2 이지만 변형이 stale → 원본 fallback', () => {
  _setPublishedImageCaches(null, null);
  setPublishedImageSelectionForScene('1', 's2', { url: S2_URL, stale: true });
  assert.strictEqual(getPublishedImageDisplaySrc(scene(), ORIG), ORIG);
});

test('setter sceneId null → noop(예외 없음)', () => {
  assert.doesNotThrow(() => setPublishedImageSelectionForScene(null, 's2', { url: S2_URL }));
});
