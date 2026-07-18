/* LEVELS-EASY/LINEAR(2026-07-19) — 그림책 1단계(easy=3)·2단계(linear=4) 질문 세트 계약.
   정본: thought-compass-questions.js(세트)·thought-compass.js(버전 배선). */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Q = require('../../thought-compass-questions.js');
const TC = require('../../thought-compass.js');

/* ── 세트 형태 ── */
test('EASY: 정확히 8문항·키 일치·형태 검증 통과', () => {
  const r = Q.validateCoreQuestionSet(null, 3);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.valid, true);
  assert.strictEqual(Q.getCoreQuestions(3).length, 8);
  assert.deepStrictEqual(Q.getCoreQuestions(3).map(q => q.id), Q.CORE_QUESTION_KEYS_EASY.slice());
});

test('LINEAR: 정확히 10문항·키 일치·형태 검증 통과(targetLength 보기전용 허용)', () => {
  const r = Q.validateCoreQuestionSet(null, 4);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.valid, true);
  assert.deepStrictEqual(Q.getCoreQuestions(4).map(q => q.id), Q.CORE_QUESTION_KEYS_LINEAR.slice());
});

test('LINEAR: 진엔딩/다른선택 배제 + 이름 질문 포함 + 문구에 "진엔딩" 없음', () => {
  const ids = Q.getCoreQuestions(4).map(q => q.id);
  assert.ok(!ids.includes('alternatePath'), 'alternatePath는 일직선에서 제외');
  assert.ok(ids.includes('protagonistName'));
  for (const q of Q.getCoreQuestions(4)) {
    assert.ok(q.title.indexOf('진엔딩') === -1, q.id + ' title에 진엔딩 잔존');
    assert.ok((q.help || '').indexOf('진엔딩') === -1, q.id + ' help에 진엔딩 잔존');
  }
});

test('EASY: v1/v2와 키 충돌 없음(자가복구 판별 안전)', () => {
  for (const k of Q.CORE_QUESTION_KEYS_EASY) {
    assert.ok(!Q.CORE_QUESTION_KEYS.includes(k), 'v1 충돌: ' + k);
    assert.ok(!Q.CORE_QUESTION_KEYS_V2.includes(k), 'v2 충돌: ' + k);
  }
});

/* ── 버전 해석/보존 ── */
test('resolve: version 3/4 저장값 → 그대로. 전용 답 존재 → 자가복구', () => {
  assert.strictEqual(TC.resolveQuestionSetVersion({ version: 3, status: 'inProgress' }), 3);
  assert.strictEqual(TC.resolveQuestionSetVersion({ version: 4, status: 'inProgress' }), 4);
  assert.strictEqual(TC.resolveQuestionSetVersion({ status: 'inProgress', answers: { heroWho: { answerText: '동물 친구' } } }), 3);
  assert.strictEqual(TC.resolveQuestionSetVersion({ status: 'inProgress', answers: { protagonistName: { answerText: '보미' } } }), 4);
  /* 기존 계약 불변: fresh→2, v2 답→2, v1 진행→1 */
  assert.strictEqual(TC.resolveQuestionSetVersion(null), 2);
  assert.strictEqual(TC.resolveQuestionSetVersion({ status: 'inProgress', answers: { targetLength: { choiceId: 'targetlen_8' } } }), 2);
  assert.strictEqual(TC.resolveQuestionSetVersion({ status: 'inProgress', answers: { audience: { answerText: '가족' } } }), 1);
});

test('normalize: version 3/4 보존·이상값은 1', () => {
  assert.strictEqual(TC.normalizeThoughtCompassState({ version: 3 }).version, 3);
  assert.strictEqual(TC.normalizeThoughtCompassState({ version: 4 }).version, 4);
  assert.strictEqual(TC.normalizeThoughtCompassState({ version: 9 }).version, 1);
});

/* ── 완주 판정 ── */
function _fill(keys) {
  const a = {};
  for (const k of keys) a[k] = { answerText: '답: ' + k, answerStatus: 'confirmed' };
  return a;
}
test('completion: easy=8키 완주·linear=10키 완주(부족 시 missing)', () => {
  const okEasy = TC.validateThoughtCompassCompletion({ version: 3, status: 'inProgress', answers: _fill(Q.CORE_QUESTION_KEYS_EASY) });
  assert.strictEqual(okEasy.valid, true);
  const missEasy = TC.validateThoughtCompassCompletion({ version: 3, status: 'inProgress', answers: _fill(Q.CORE_QUESTION_KEYS_EASY.slice(0, 5)) });
  assert.strictEqual(missEasy.valid, false);
  const okLin = TC.validateThoughtCompassCompletion({ version: 4, status: 'inProgress', answers: _fill(Q.CORE_QUESTION_KEYS_LINEAR) });
  assert.strictEqual(okLin.valid, true);
  const missLin = TC.validateThoughtCompassCompletion({ version: 4, status: 'inProgress', answers: _fill(['targetLength']) });
  assert.strictEqual(missLin.valid, false);
});

/* ── 시작/저장 스탬프 ── */
const CTX = { classId: 'C1', teamName: 'T1', projectType: 'picturebook' };
test('planMarkStarted: qVersion 3/4 명시 → 신규 스탬프. 미지정 → 2(기존). 재개는 저장 버전 재스탬프', () => {
  assert.strictEqual(TC.planMarkStarted(CTX, null, 3).update.version, 3);
  assert.strictEqual(TC.planMarkStarted(CTX, null, 4).update.version, 4);
  assert.strictEqual(TC.planMarkStarted(CTX, null).update.version, 2);
  assert.strictEqual(TC.planMarkStarted(CTX, { version: 3, status: 'inProgress', startedAt: 1 }, undefined).update.version, 3);
  assert.strictEqual(TC.planMarkStarted(CTX, { version: 4, status: 'inProgress', startedAt: 1 }, undefined).update.version, 4);
});

test('planSaveProgress: easy/linear 세션 매 저장 재스탬프(멱등)', () => {
  const p3 = TC.planSaveProgress(CTX, { version: 3, status: 'inProgress' }, { currentQuestionIndex: 2 });
  assert.strictEqual(p3.update.version, 3);
  const p4 = TC.planSaveProgress(CTX, { version: 4, status: 'inProgress' }, { currentQuestionIndex: 2 });
  assert.strictEqual(p4.update.version, 4);
});

/* ── 장면 수(초안 길이) 정합 ── */
test('scenes: easy(targetLength 없음)=8 고정·linear targetLength 반영', () => {
  const SC = require('../../thought-compass-scenes.js');
  assert.strictEqual(SC.resolveStoryCount(_fill(Q.CORE_QUESTION_KEYS_EASY)), 8);
  const linAns = _fill(Q.CORE_QUESTION_KEYS_LINEAR);
  linAns.targetLength = { choiceId: 'targetlen_12' };
  assert.strictEqual(SC.resolveStoryCount(linAns), 12);
});
