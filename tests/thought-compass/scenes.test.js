/* 생각 나침반 완료 후 기본 장면 생성 게이트 하니스. 실행: node --test tests/thought-compass/scenes.test.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SC = require('../../thought-compass-scenes.js');
const TC = require('../../thought-compass.js');

test('신규 picturebook → 생성 대상', () => {
  assert.equal(SC.shouldGenerateStarter({ projectType: 'picturebook' }), true);
});
test('신규 text → 생성 대상', () => {
  assert.equal(SC.shouldGenerateStarter({ projectType: 'text' }), true);
});
test('movie → no-op', () => {
  assert.equal(SC.shouldGenerateStarter({ projectType: 'movie' }), false);
});
test('experience → no-op', () => {
  assert.equal(SC.shouldGenerateStarter({ projectType: 'experience' }), false);
});
test('기존 scenes 있으면 no-op', () => {
  assert.equal(SC.shouldGenerateStarter({ projectType: 'picturebook', hasExistingScenes: true }), false);
});
test('projectType 누락 → no-op', () => {
  assert.equal(SC.shouldGenerateStarter({}), false);
});
test('foundation canGenerateDefaultScenes와 동일 의미', () => {
  /* 두 게이트가 같은 결정(중복 안전망) */
  for (const c of [
    { projectType: 'picturebook' }, { projectType: 'text' },
    { projectType: 'movie' }, { projectType: 'picturebook', hasExistingScenes: true },
  ]) {
    assert.equal(SC.shouldGenerateStarter(c), TC.canGenerateDefaultScenes(c), JSON.stringify(c));
  }
});
test('afterComplete — 생성기 미로드(Node)면 false(안전)', async () => {
  assert.equal(await SC.afterComplete({ projectType: 'picturebook' }), false);
  assert.equal(await SC.afterComplete({ projectType: 'movie' }), false);
});
