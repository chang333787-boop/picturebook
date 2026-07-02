/* sheet.test.js — COMPASS-SHEET-1 storyMapV2 파생/템플릿 줄거리 검증(순수·AI 0·DB 0). */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Sheet = require('../../thought-compass-sheet.js');
const TC = require('../../thought-compass.js');
const Q = require('../../thought-compass-questions.js');

function ans(text, extra) { return Object.assign({ answerText: text, answerStatus: 'confirmed' }, extra || {}); }
const FULL = {
  targetLength: ans('보통으로 만들래요 (약 12장면)', { choiceId: 'targetlen_12' }),
  protagonist: ans('겁 많은 강아지 콩이'),
  goal: ans('잃어버린 주인을 찾는 것'),
  mainlineStart: ans('평범한 하루에서 시작해요'),
  incitingEvent: ans('갑자기 문제가 생겨요'),
  risingTrouble: ans('마음이 흔들리거나 겁이 나요'),
  keyChoice: ans('위험을 감수할지 안전한 길을 갈지 선택해요'),
  trueEnding: ans('주인공이 원하는 것을 이루어요'),
  alternatePath: ans('다른 엔딩으로 이어져요'),
  coreMessage: ans('콩이가 용기를 내는 마지막 장면'),
};

test('SHEET: 필드 10개·질문 순서·키 = CORE_QUESTION_KEYS_V2', () => {
  const m = Sheet.buildStoryMapV2(FULL);
  assert.strictEqual(m.fields.length, 10);
  assert.deepStrictEqual(m.fields.map(f => f.key), TC.CORE_QUESTION_KEYS_V2.slice());
  assert.deepStrictEqual(Sheet.FIELD_DEFS.map(f => f.key), TC.CORE_QUESTION_KEYS_V2.slice());
});

test('SHEET: targetLength choiceId → 짧은 표기(약 12장면)', () => {
  const m = Sheet.buildStoryMapV2(FULL);
  assert.strictEqual(m.fields[0].text, '약 12장면');
});

test('SHEET: summaryText — 진엔딩까지 시간축 전 요소 포함·주인공 『』 표기', () => {
  const m = Sheet.buildStoryMapV2(FULL);
  assert.ok(m.summaryText.startsWith('『겁 많은 강아지 콩이』의 이야기.'));
  for (const t of ['잃어버린 주인을 찾는 것', '평범한 하루에서 시작해요', '갑자기 문제가 생겨요',
    '마음이 흔들리거나 겁이 나요', '위험을 감수할지', '원하는 것을 이루어요', '다른 엔딩으로 이어져요', '용기를 내는 마지막 장면']) {
    assert.ok(m.summaryText.includes(t), '누락: ' + t);
  }
});

test('SHEET: 유예("이야기를 만들면서 정할래요")→ "만들면서 정하기" + deferredKeys', () => {
  const a = Object.assign({}, FULL, { trueEnding: { answerText: Sheet.MINIMAL_ANSWER, answerStatus: 'confirmed', deferred: true } });
  const m = Sheet.buildStoryMapV2(a);
  const f = m.fields.find(x => x.key === 'trueEnding');
  assert.strictEqual(f.deferred, true);
  assert.strictEqual(f.text, Sheet.DEFERRED_LABEL);
  assert.deepStrictEqual(m.deferredKeys, ['trueEnding']);
  assert.ok(m.summaryText.includes('(' + Sheet.DEFERRED_LABEL + ')'));
  assert.ok(!m.summaryText.includes(Sheet.MINIMAL_ANSWER));   /* 원문 유예 문구는 줄거리에 안 나옴 */
});

test('SHEET: 빈/부분 answers에도 안전(전 필드 존재·summaryText 생성)', () => {
  const m0 = Sheet.buildStoryMapV2(null);
  assert.strictEqual(m0.fields.length, 10);
  assert.ok(typeof m0.summaryText === 'string' && m0.summaryText.length > 0);
  const m1 = Sheet.buildStoryMapV2({ protagonist: ans('용') });
  assert.ok(m1.summaryText.startsWith('『용』'));
});

test('SHEET: MINIMAL_ANSWER 상수 = foundation과 일치(교차검증)', () => {
  assert.strictEqual(Sheet.MINIMAL_ANSWER, TC.MINIMAL_ANSWER);
});

test('SHEET: isV2Questions — v2 세트 true / v1 세트 false', () => {
  assert.strictEqual(Sheet.isV2Questions(Q.getCoreQuestions(2)), true);
  assert.strictEqual(Sheet.isV2Questions(Q.getCoreQuestions()), false);
  assert.strictEqual(Sheet.isV2Questions(null), false);
});
