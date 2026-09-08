/* SHELF-COVER-1 — 책장 표지 그림 규칙(순수) + index.js 배선 정적 가드.
   실행: node --test tests/shelf-cover/cover.test.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const C = require('../../functions/shelf-cover.js');
const INDEX = fs.readFileSync(path.join(__dirname, '../../functions/index.js'), 'utf8');
const SHELF_JS = fs.readFileSync(path.join(__dirname, '../../viewer-shelf.js'), 'utf8');

const O = 'https://storage.googleapis.com/b/o/scene_1.jpg';
const A = 'https://firebasestorage.googleapis.com/v0/b/x/o/ai%2F1.png?alt=media&token=t';

test('장면 순서 — cover 제외·start 우선·num 오름차순·그림 없는 장면 건너뜀', () => {
  const scenes = { 1: { type: 'cover' }, 2: { type: 'normal' }, 3: { type: 'start', imageUrl: O }, 4: { type: 'normal', imageUrl: O + '4' } };
  const ord = C.orderedScenes(scenes).map((e) => e.num);
  assert.deepEqual(ord, ['3', '2', '4']);
  const r = C.pickShelfCover({ scenes, aiImage: null, imageSelections: null, viewerMeta: {} });
  assert.equal(r.num, '3'); assert.equal(r.kind, 'original'); assert.equal(r.url, O);
});

test('배열형 노드(CLI/RTDB 숫자키)도 같은 결과', () => {
  const scenes = [null, { type: 'cover' }, { type: 'normal' }, { type: 'normal', imageData: O }];
  const ai = [null, null, null, { s2: { url: A } }];
  const r = C.pickShelfCover({ scenes, aiImage: ai, imageSelections: null, viewerMeta: {} });
  assert.equal(r.num, '3'); assert.equal(r.kind, 's2'); assert.equal(r.url, A);   /* 3단계 기본 = AI */
});

test('base64 data: 원화는 후보에서 제외(다음 장면으로)', () => {
  const scenes = { 1: { type: 'normal', imageData: 'data:image/png;base64,AAAA' }, 2: { type: 'normal', imageUrl: O } };
  const r = C.pickShelfCover({ scenes, aiImage: null, imageSelections: null, viewerMeta: {} });
  assert.equal(r.num, '2');
});

test('1단계 — AI 있으면 AI, AI 아직 안 돌렸으면 null(원화 슬롯 없음)', () => {
  const scenes = { 1: { type: 'cover' }, 2: { type: 'normal' }, 3: { type: 'normal' } };
  assert.equal(C.pickShelfCover({ scenes, aiImage: null, imageSelections: null, viewerMeta: { picturebookLevel: 1 } }), null);
  const r = C.pickShelfCover({ scenes, aiImage: { 2: { s2: { url: A } } }, imageSelections: null, viewerMeta: { picturebookLevel: 1 } });
  assert.equal(r.kind, 's2'); assert.equal(r.num, '2');
  /* stale s2는 없는 것 */
  assert.equal(C.pickShelfCover({ scenes, aiImage: { 2: { s2: { url: A, stale: true } } }, imageSelections: null, viewerMeta: { picturebookLevel: 1 } }), null);
});

test('2단계 — 원화는 구도 스케치라 제외: AI 없으면 null, 1·2단계는 viewerShowImage 잠금 무시', () => {
  const scenes = { 1: { type: 'normal', imageUrl: O } };
  const r = C.pickShelfCover({ scenes, aiImage: null, imageSelections: null, viewerMeta: { picturebookLevel: 2, viewerShowImage: 'aiS2' } });
  assert.equal(r, null);
  /* AI가 2번 장면에만 있으면 1번(원화만) 건너뛰고 2번 AI */
  const r1 = C.pickShelfCover({ scenes: { 1: { type: 'normal', imageUrl: O }, 2: { type: 'normal', imageUrl: O } }, aiImage: { 2: { s2: { url: A } } }, imageSelections: null, viewerMeta: { picturebookLevel: 2 } });
  assert.equal(r1.num, '2'); assert.equal(r1.kind, 's2');
  const r2 = C.pickShelfCover({ scenes, aiImage: { 1: { s2: { url: A } } }, imageSelections: null, viewerMeta: { picturebookLevel: 2, viewerShowImage: 'original' } });
  assert.equal(r2.kind, 's2');   /* 1·2단계는 잠금 무시 → AI */
});

test('3단계 — 잠금 original/aiS2, 교사 선택, 선택 없음=AI 기본', () => {
  const scenes = { 1: { type: 'normal', imageUrl: O } };
  const ai = { 1: { s2: { url: A } } };
  const meta = (extra) => Object.assign({ picturebookLevel: 3 }, extra || {});
  assert.equal(C.pickShelfCover({ scenes, aiImage: ai, imageSelections: null, viewerMeta: meta({ viewerShowImage: 'original' }) }).kind, 'original');
  assert.equal(C.pickShelfCover({ scenes, aiImage: ai, imageSelections: null, viewerMeta: meta({ viewerShowImage: 'aiS2' }) }).kind, 's2');
  assert.equal(C.pickShelfCover({ scenes, aiImage: null, imageSelections: null, viewerMeta: meta({ viewerShowImage: 'aiS2' }) }).kind, 'original'); /* AI 없으면 원화 */
  assert.equal(C.pickShelfCover({ scenes, aiImage: ai, imageSelections: { 1: { selected: 'original' } }, viewerMeta: meta() }).kind, 'original');
  assert.equal(C.pickShelfCover({ scenes, aiImage: ai, imageSelections: { 1: { selected: 's2' } }, viewerMeta: meta() }).kind, 's2');
  assert.equal(C.pickShelfCover({ scenes, aiImage: ai, imageSelections: null, viewerMeta: meta() }).kind, 's2');
  assert.equal(C.pickShelfCover({ scenes, aiImage: ai, imageSelections: null, viewerMeta: {} }).kind, 's2');   /* 레거시 null 레벨 = 3단계 취급 */
});

test('텍스트형·그림 전혀 없음 → null', () => {
  assert.equal(C.pickShelfCover({ scenes: { 1: { type: 'normal', title: '글' } }, aiImage: null, imageSelections: null, viewerMeta: { projectType: 'text' } }), null);
  assert.equal(C.pickShelfCover({ scenes: null, aiImage: null, imageSelections: null, viewerMeta: null }), null);
});

test('index.js 배선 — getClassShelf가 shelf-cover를 쓰고 img/imgV를 캐시·반환', () => {
  assert.match(INDEX, /require\('\.\/shelf-cover'\)/);
  const seg = INDEX.slice(INDEX.indexOf('exports.getClassShelf'), INDEX.indexOf('exports.postWorkComment'));
  assert.match(seg, /pickShelfCover\(/);
  assert.match(seg, /imgV/);
  assert.match(seg, /img:/);
});

test('viewer-shelf.js — 가로 카드(C-1)·img 폴백 onerror', () => {
  assert.match(SHELF_JS, /shelf-cover-img/);
  assert.match(SHELF_JS, /onerror/);
});
