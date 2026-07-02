/* TEXT-S2-PUBLISH-CHOICE-REMOVAL-1 — getPublishedBodyDisplay 무력화(발행 선택 제도 폐기) 검증.
   구 스펙("textSelections='s2'면 s2 body 발행")은 폐기 — 새 스펙: 항상 originalBody 반환.
   레거시 textSelections/캐시/setter가 어떤 상태여도 표시 결정에 영향을 주지 않아야 한다.
   원본/AI 비교는 viewer-ai '글 보기' 토글(_getDisplayBody)만 담당(브라우저 IIFE — 합성 스모크에서 확인).
   배경: docs/text_s2_publish_choice_removal_audit_20260702.md. 네트워크 0. */
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

/* ── 핵심: 어떤 selection 상태여도 원본 반환 ── */

test('selection 없음(빈 캐시) → 원본 body', () => {
  _setPublishedTextCaches(null, null);
  assert.strictEqual(getPublishedBodyDisplay(scene(), ORIG), ORIG);
});

test('legacy selection original → 원본 body', () => {
  _setPublishedTextCaches({ '1': { s2: { body: S2_BODY } } }, { '1': { selected: 'original' } });
  assert.strictEqual(getPublishedBodyDisplay(scene(), ORIG), ORIG);
});

test('★ legacy selection s2 + usable variant여도 → 원본 body (발행 제도 폐기)', () => {
  _setPublishedTextCaches({ '1': { s2: { body: S2_BODY } } }, { '1': { selected: 's2' } });
  assert.strictEqual(getPublishedBodyDisplay(scene(), ORIG), ORIG);
});

test('legacy selection s2 + stale variant → 원본 body', () => {
  _setPublishedTextCaches({ '1': { s2: { body: S2_BODY, stale: true } } }, { '1': { selected: 's2' } });
  assert.strictEqual(getPublishedBodyDisplay(scene(), ORIG), ORIG);
});

test('sceneId/scene 형태와 무관하게 originalBody 그대로', () => {
  _setPublishedTextCaches({ '1': { s2: { body: S2_BODY } } }, { '1': { selected: 's2' } });
  assert.strictEqual(getPublishedBodyDisplay(null, ORIG), ORIG);
  assert.strictEqual(getPublishedBodyDisplay({ body: ORIG }, ORIG), ORIG);
  assert.strictEqual(getPublishedBodyDisplay({ sceneId: 1, body: ORIG }, ORIG), ORIG);
});

test('엔딩 등 원본 body 빈 문자열도 그대로', () => {
  _setPublishedTextCaches(null, null);
  assert.strictEqual(getPublishedBodyDisplay({ id: '1', body: '' }, ''), '');
});

test('원본 scene.body 불변(부작용 없음)', () => {
  _setPublishedTextCaches({ '1': { s2: { body: S2_BODY } } }, { '1': { selected: 's2' } });
  const sc = scene();
  getPublishedBodyDisplay(sc, ORIG);
  assert.strictEqual(sc.body, ORIG);
});

/* ── setter는 남아 있어도 표시에 영향 없음(dormant) ── */

test('setter s2 적용해도 표시엔 영향 없음 → 원본', () => {
  _setPublishedTextCaches(null, null);
  setPublishedTextSelectionForScene('1', 's2', { body: S2_BODY });
  assert.strictEqual(getPublishedBodyDisplay(scene(), ORIG), ORIG);
});

test('setter sceneId null → noop(예외 없음)', () => {
  assert.doesNotThrow(() => setPublishedTextSelectionForScene(null, 's2', { body: S2_BODY }));
});

/* ── resolveSceneBodySource 순수함수는 유지(미리보기 경로·export 계약) ── */

const { resolveSceneBodySource } = V;

test('previewMode s2 → s2(로컬 미리보기 경로 — 발행과 무관)', () => {
  const r = resolveSceneBodySource(scene(), { selected: 'original' }, { body: S2_BODY }, 's2');
  assert.strictEqual(r.kind, 's2');
  assert.strictEqual(r.body, S2_BODY);
});

test('previewMode 없음 + selection original → 원본', () => {
  const r = resolveSceneBodySource(scene(), { selected: 'original' }, { body: S2_BODY }, null);
  assert.strictEqual(r.kind, 'original');
  assert.strictEqual(r.body, ORIG);
});

/* ── 인쇄 경로 계약: picturebook-print._publishedBody는 window.getPublishedBodyDisplay를
   그대로 호출 — 무력화로 legacy s2 확정 데이터가 있어도 인쇄=원본 ── */

test('인쇄 계약: legacy s2 확정 상태에서도 getPublishedBodyDisplay는 원본', () => {
  _setPublishedTextCaches({ '3': { s2: { body: S2_BODY } } }, { '3': { selected: 's2' } });
  assert.strictEqual(getPublishedBodyDisplay({ id: '3', body: ORIG }, ORIG), ORIG);
});

/* ── 이미지 축 회귀 없음: getPublishedImageDisplaySrc는 기존 정책 유지(변경 금지 확인) ── */

const { _setPublishedImageCaches, getPublishedImageDisplaySrc } = V;

test('이미지 발행 선택(imageSelections)은 기존 동작 유지 — s2 url 반영/원본 fallback', () => {
  _setPublishedImageCaches({ '1': { s2: { url: 'https://example.com/s2.png', stale: false } } }, { '1': { selected: 's2' } });
  assert.strictEqual(getPublishedImageDisplaySrc({ id: '1', imageData: 'orig.png' }, 'orig.png'), 'https://example.com/s2.png');
  _setPublishedImageCaches(null, null);
  assert.strictEqual(getPublishedImageDisplaySrc({ id: '1', imageData: 'orig.png' }, 'orig.png'), 'orig.png');
});
