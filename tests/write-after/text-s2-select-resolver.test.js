/* TEXT-S2-SELECT (P7) — getPublishedBodyDisplay (라이브 렌더 발행 선택 resolver) 단위 테스트.
   원본 body 보호 + selection 기반 표시 + 모든 실패 경로 원본 fallback 검증. 네트워크 0.
   이미지 published-render-resolver.test.js의 텍스트 평행 복제. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const V = require(path.join(__dirname, '..', '..', 'viewer-data.js'));
const { _setPublishedTextCaches, getPublishedBodyDisplay, setPublishedTextSelectionForScene } = V;

const S2_BODY = '고친 글을 바탕으로 더 자연스럽게 다듬은 문장이에요.';
const ORIG = '학생이 직접 쓴 원본 문장.';

function scene(overrides) {
  return Object.assign({ id: '1', body: ORIG }, overrides || {});
}

test('selection 없음(빈 캐시) → 원본 body', () => {
  _setPublishedTextCaches(null, null);
  assert.strictEqual(getPublishedBodyDisplay(scene(), ORIG), ORIG);
});

test('selection original → 원본 body', () => {
  _setPublishedTextCaches({ '1': { s2: { body: S2_BODY } } }, { '1': { selected: 'original' } });
  assert.strictEqual(getPublishedBodyDisplay(scene(), ORIG), ORIG);
});

test('selection s2 + valid variant → AI body', () => {
  _setPublishedTextCaches({ '1': { s2: { body: S2_BODY } } }, { '1': { selected: 's2' } });
  assert.strictEqual(getPublishedBodyDisplay(scene(), ORIG), S2_BODY);
});

test('selection s2 + stale true → 원본 body', () => {
  _setPublishedTextCaches({ '1': { s2: { body: S2_BODY, stale: true } } }, { '1': { selected: 's2' } });
  assert.strictEqual(getPublishedBodyDisplay(scene(), ORIG), ORIG);
});

test('selection s2 + variant 없음 → 원본 body', () => {
  _setPublishedTextCaches({}, { '1': { selected: 's2' } });
  assert.strictEqual(getPublishedBodyDisplay(scene(), ORIG), ORIG);
});

test('selection s2 + body 빈 값/공백 → 원본 body', () => {
  _setPublishedTextCaches({ '1': { s2: { body: '   ' } } }, { '1': { selected: 's2' } });
  assert.strictEqual(getPublishedBodyDisplay(scene(), ORIG), ORIG);
});

test('selection s2 이지만 sceneId 키 불일치 → 원본 body', () => {
  _setPublishedTextCaches({ '2': { s2: { body: S2_BODY } } }, { '2': { selected: 's2' } });
  assert.strictEqual(getPublishedBodyDisplay(scene({ id: '1' }), ORIG), ORIG);
});

test('원본 scene.body 불변(부작용 없음)', () => {
  _setPublishedTextCaches({ '1': { s2: { body: S2_BODY } } }, { '1': { selected: 's2' } });
  const sc = scene();
  getPublishedBodyDisplay(sc, ORIG);
  assert.strictEqual(sc.body, ORIG);   /* 원본 필드 그대로 */
});

test('구작품(aiVariants 전무) → 원본 body', () => {
  _setPublishedTextCaches(undefined, undefined);
  assert.strictEqual(getPublishedBodyDisplay(scene(), ORIG), ORIG);
});

test('scene null / sid 없음 → originalBody 그대로', () => {
  _setPublishedTextCaches({ '1': { s2: { body: S2_BODY } } }, { '1': { selected: 's2' } });
  assert.strictEqual(getPublishedBodyDisplay(null, ORIG), ORIG);
  assert.strictEqual(getPublishedBodyDisplay({ body: ORIG }, ORIG), ORIG);   /* id 없음 */
});

test('scene.sceneId fallback(id 없을 때) 매칭', () => {
  _setPublishedTextCaches({ '7': { s2: { body: S2_BODY } } }, { '7': { selected: 's2' } });
  assert.strictEqual(getPublishedBodyDisplay({ sceneId: 7, body: ORIG }, ORIG), S2_BODY);
});

test('엔딩 등 원본 body 빈 문자열이어도 selection 없으면 그대로', () => {
  _setPublishedTextCaches(null, null);
  assert.strictEqual(getPublishedBodyDisplay({ id: '1', body: '' }, ''), '');
});

/* TEXT-S2-SELECT — 선택 적용 직후 캐시 동기 갱신 setter */

test('setter s2 + 변형노드 → 이후 렌더 s2 표시', () => {
  _setPublishedTextCaches(null, null);   /* 빈 캐시(team 진입엔 없던 새 s2 가정) */
  assert.strictEqual(getPublishedBodyDisplay(scene(), ORIG), ORIG);
  setPublishedTextSelectionForScene('1', 's2', { body: S2_BODY });
  assert.strictEqual(getPublishedBodyDisplay(scene(), ORIG), S2_BODY);
});

test('setter original → 이후 렌더 원본', () => {
  _setPublishedTextCaches({ '1': { s2: { body: S2_BODY } } }, { '1': { selected: 's2' } });
  assert.strictEqual(getPublishedBodyDisplay(scene(), ORIG), S2_BODY);
  setPublishedTextSelectionForScene('1', 'original', null);
  assert.strictEqual(getPublishedBodyDisplay(scene(), ORIG), ORIG);
});

test('setter s2 이지만 변형이 stale → 원본 fallback', () => {
  _setPublishedTextCaches(null, null);
  setPublishedTextSelectionForScene('1', 's2', { body: S2_BODY, stale: true });
  assert.strictEqual(getPublishedBodyDisplay(scene(), ORIG), ORIG);
});

test('setter sceneId null → noop(예외 없음)', () => {
  assert.doesNotThrow(() => setPublishedTextSelectionForScene(null, 's2', { body: S2_BODY }));
});

/* resolveSceneBodySource previewMode(토글) 경로 — 발행 selection과 독립 */
const { resolveSceneBodySource } = V;

test('previewMode s2 → selection original 이어도 s2(로컬 미리보기)', () => {
  const r = resolveSceneBodySource(scene(), { selected: 'original' }, { body: S2_BODY }, 's2');
  assert.strictEqual(r.kind, 's2');
  assert.strictEqual(r.body, S2_BODY);
});

test('previewMode 없음 + selection original → 원본', () => {
  const r = resolveSceneBodySource(scene(), { selected: 'original' }, { body: S2_BODY }, null);
  assert.strictEqual(r.kind, 'original');
  assert.strictEqual(r.body, ORIG);
});
