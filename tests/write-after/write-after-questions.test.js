'use strict';
/* WRITE-AFTER Phase 3 — write-after-questions.js 순수 로직 단위 테스트. node 단독(외부 0). */
const test = require('node:test');
const assert = require('node:assert');
const W = require('../../functions/write-after-questions.js');

test('sanitizeSnapshotForQuestions: 장면 ≤25 + body 500자 + 선택지 100자 + imageData 제거', () => {
  const snap = {};
  for (let i = 1; i <= 30; i++) snap[String(i)] = { id: i, title: 't', body: 'a'.repeat(700), imageData: 'data:image/png;base64,XXXX', imageUrl: 'http://x', choices: ['c'.repeat(200)] };
  const out = W.sanitizeSnapshotForQuestions(snap);
  assert.equal(Object.keys(out).length, 25, '장면 25개로 제한');
  const s = out['1'];
  assert.equal(s.body.length, 500, 'body 500자 클램프');
  assert.equal(s.choices[0].label.length, 100, '선택지 100자 클램프');
  assert.ok(!('imageData' in s) && !('imageUrl' in s), 'imageData/imageUrl 제거');
});

test('validateQuestionsResponse: 정상 3개 → 정규화 반환', () => {
  const parsed = { summary: '좋아요', questions: [
    { id: 'q1', sceneId: '3', type: '선택지 연결', question: '왜 숲으로 갔나요?', reason: '연결 이유 필요', studentAction: '한 문장 더' },
    { sceneId: '1', type: '이야기 흐름', question: '처음에 무슨 일이 있었나요?' },
    { sceneId: '2', question: '주인공 기분은?' },
  ] };
  const r = W.validateQuestionsResponse(parsed, { validSceneIds: ['1', '2', '3'] });
  assert.equal(r.questions.length, 3);
  assert.equal(r.questions[0].sceneLabel, '장면 3');
  assert.equal(r.questions[2].type, '이야기 흐름', '유형 없으면 기본값');
  assert.equal(r.questions[2].id, 'q3', 'id 없으면 생성');
});

test('validateQuestionsResponse: 대필 키(revisedText 등) 있으면 거부', () => {
  const parsed = { questions: [{ sceneId: '1', question: 'q', revisedText: '고친 문장' }, { sceneId: '2', question: 'q2' }, { sceneId: '3', question: 'q3' }] };
  assert.throws(() => W.validateQuestionsResponse(parsed), /거부|WAQ_REWRITE/);
});

test('validateQuestionsResponse: 질문 3개 미만이면 거부', () => {
  const parsed = { questions: [{ sceneId: '1', question: 'q1' }, { sceneId: '2', question: 'q2' }] };
  assert.throws(() => W.validateQuestionsResponse(parsed), /충분|WAQ_TOO_FEW/);
});

test('validateQuestionsResponse: 6개 초과는 6개로 클램프', () => {
  const qs = [];
  for (let i = 1; i <= 10; i++) qs.push({ sceneId: String(i), question: '질문' + i });
  const ids = qs.map(q => q.sceneId);
  const r = W.validateQuestionsResponse({ questions: qs }, { validSceneIds: ids });
  assert.equal(r.questions.length, 6);
});

test('validateQuestionsResponse: 실존하지 않는 sceneId는 점프 타겟에서 제거(sceneId="")', () => {
  const parsed = { questions: [
    { sceneId: '99', question: 'q1' }, { sceneId: '1', question: 'q2' }, { sceneId: '2', question: 'q3' },
  ] };
  const r = W.validateQuestionsResponse(parsed, { validSceneIds: ['1', '2'] });
  const q99 = r.questions.find(q => q.question === 'q1');
  assert.equal(q99.sceneId, '', '없는 장면 ID는 비움(라벨/점프 안 함)');
});

test('validateQuestionsResponse: 중복 질문 제거', () => {
  const parsed = { questions: [
    { sceneId: '1', question: '같은질문' }, { sceneId: '1', question: '같은질문' },
    { sceneId: '2', question: 'b' }, { sceneId: '3', question: 'c' },
  ] };
  const r = W.validateQuestionsResponse(parsed, { validSceneIds: ['1', '2', '3'] });
  assert.equal(r.questions.length, 3, '중복 1개 제거');
});

test('validateQuestionsResponse: 빈 question 항목은 폐기', () => {
  const parsed = { questions: [
    { sceneId: '1', question: '' }, { sceneId: '1', question: '진짜질문1' },
    { sceneId: '2', question: '진짜질문2' }, { sceneId: '3', question: '진짜질문3' },
  ] };
  const r = W.validateQuestionsResponse(parsed, { validSceneIds: ['1', '2', '3'] });
  assert.equal(r.questions.length, 3);
});
