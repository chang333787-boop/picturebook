/* length-base.test.js — COMPASS-LENGTH-BASE: targetLength→이야기 장면 수 매핑(순수) 검증. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const SC = require('../../thought-compass-scenes.js');

test('LENGTH: choiceId 매핑 8/12/15', () => {
  assert.strictEqual(SC.resolveStoryCount({ targetLength: { choiceId: 'targetlen_8', answerText: '짧게 만들래요 (약 8장면)' } }), 8);
  assert.strictEqual(SC.resolveStoryCount({ targetLength: { choiceId: 'targetlen_12', answerText: '보통으로 만들래요 (약 12장면)' } }), 12);
  assert.strictEqual(SC.resolveStoryCount({ targetLength: { choiceId: 'targetlen_15', answerText: '조금 길게 만들래요 (약 15장면)' } }), 15);
});

test('LENGTH: choiceId 없으면 답 텍스트 "약 N장면" 파싱', () => {
  assert.strictEqual(SC.resolveStoryCount({ targetLength: { answerText: '보통으로 만들래요 (약 12장면)' } }), 12);
  assert.strictEqual(SC.resolveStoryCount({ targetLength: { answerText: '조금 길게 만들래요 (약 15장면)' } }), 15);
});

test('LENGTH: 유예/누락/v1/이상값 → 8 (기존 BASE10과 동일 = 안전 fallback)', () => {
  assert.strictEqual(SC.resolveStoryCount({ targetLength: { answerText: '이야기를 만들면서 정할래요', deferred: true } }), 8);
  assert.strictEqual(SC.resolveStoryCount({}), 8);                                     /* v2인데 미답(이론상) */
  assert.strictEqual(SC.resolveStoryCount(null), 8);
  assert.strictEqual(SC.resolveStoryCount({ audience: { answerText: '가족' } }), 8);   /* v1 answers */
  assert.strictEqual(SC.resolveStoryCount({ targetLength: { choiceId: 'targetlen_99', answerText: '약 99장면' } }), 8);
  assert.strictEqual(SC.resolveStoryCount({ targetLength: { answerText: '약 20장면' } }), 8);   /* 허용값 외 */
});

test('LENGTH: STORY_COUNTS 정본 = [8,12,15]', () => {
  assert.deepStrictEqual(SC.STORY_COUNTS.slice(), [8, 12, 15]);
});
