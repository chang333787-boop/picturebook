/* 생각 나침반 AI 후속질문 순수 검증 하니스(실 API 미호출). 실행: node --test tests/thought-compass/followup.test.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const TC = require('../../functions/thought-compass-followup.js');

function baseInput(over) {
  return Object.assign({
    classId: 'C1', teamName: '2모둠', projectType: 'picturebook',
    coreQuestionId: 'protagonist', currentAnswer: '고양이',
    followUpCount: 0, totalQuestionCount: 7,
  }, over || {});
}

/* ── 입력 검증 ── */
test('정상 입력 통과', () => {
  const r = TC.validateFollowUpInput(baseInput());
  assert.equal(r.ok, true);
  assert.equal(r.value.coreQuestionId, 'protagonist');
});

test('movie 거부', () => {
  assert.equal(TC.validateFollowUpInput(baseInput({ projectType: 'movie' })).ok, false);
  assert.equal(TC.validateFollowUpInput(baseInput({ projectType: 'experience' })).ok, false);
});

test('알 수 없는 coreQuestionId 거부', () => {
  assert.equal(TC.validateFollowUpInput(baseInput({ coreQuestionId: 'nope' })).ok, false);
});

test('PIN/uid 등 금지 필드 거부', () => {
  assert.equal(TC.validateFollowUpInput(baseInput({ pin: '1234' })).ok, false);
  assert.equal(TC.validateFollowUpInput(baseInput({ uid: 'abc' })).ok, false);
  assert.equal(TC.validateFollowUpInput(baseInput({ studentName: '홍길동' })).ok, false);
});

test('followUpCount 범위(0~5) 밖 거부', () => {
  assert.equal(TC.validateFollowUpInput(baseInput({ followUpCount: -1 })).ok, false);
  assert.equal(TC.validateFollowUpInput(baseInput({ followUpCount: 6 })).ok, false);
  assert.equal(TC.validateFollowUpInput(baseInput({ followUpCount: 1.5 })).ok, false);
});

test('totalQuestionCount 범위(7~12) 밖 거부', () => {
  assert.equal(TC.validateFollowUpInput(baseInput({ totalQuestionCount: 6 })).ok, false);
  assert.equal(TC.validateFollowUpInput(baseInput({ totalQuestionCount: 13 })).ok, false);
});

test('currentAnswer 200자 초과 거부', () => {
  assert.equal(TC.validateFollowUpInput(baseInput({ currentAnswer: '가'.repeat(201) })).ok, false);
});

test('classId 안전하지 않은 세그먼트 거부', () => {
  assert.equal(TC.validateFollowUpInput(baseInput({ classId: 'a/b' })).ok, false);
  assert.equal(TC.validateFollowUpInput(baseInput({ classId: '' })).ok, false);
});

test('priorSummaries 잘못된 키/형태 거부, 정상은 통과', () => {
  assert.equal(TC.validateFollowUpInput(baseInput({ priorSummaries: [{ key: 'nope', text: 'x' }] })).ok, false);
  assert.equal(TC.validateFollowUpInput(baseInput({ priorSummaries: 'x' })).ok, false);
  const ok = TC.validateFollowUpInput(baseInput({ priorSummaries: [{ key: 'audience', text: '가족' }] }));
  assert.equal(ok.ok, true);
  assert.equal(ok.value.priorSummaries[0].text, '가족');
});

/* ── 상한 강제 ── */
test('follow-up 5회 도달 → NEXT 강제', () => {
  assert.equal(TC.shouldForceNext(baseInput({ followUpCount: 5 })), true);
});
test('전체 12문항 도달 → NEXT 강제', () => {
  assert.equal(TC.shouldForceNext(baseInput({ totalQuestionCount: 12 })), true);
});
test('상한 미만 → 강제 아님', () => {
  assert.equal(TC.shouldForceNext(baseInput({ followUpCount: 4, totalQuestionCount: 11 })), false);
});

/* ── 출력 검증 ── */
test('정상 NEXT', () => {
  const r = TC.validateFollowUpResponse({ decision: 'NEXT', reasonCode: 'SUFFICIENT', acknowledgement: '좋아요. 고양이가 주인공이군요.', followUpQuestion: '', supportOptions: [] });
  assert.equal(r.ok, true);
  assert.equal(r.value.decision, 'NEXT');
  assert.equal(r.value.followUpQuestion, '');
});

test('정상 ASK_FOLLOW_UP', () => {
  const r = TC.validateFollowUpResponse({ decision: 'ASK_FOLLOW_UP', reasonCode: 'TOO_VAGUE', acknowledgement: '고양이군요.', followUpQuestion: '그 고양이만의 특별한 점은 무엇인가요?', supportOptions: ['능력', '성격', '약점'] });
  assert.equal(r.ok, true);
  assert.equal(r.value.supportOptions.length, 3);
});

test('정상 ASK_EASIER', () => {
  const r = TC.validateFollowUpResponse({ decision: 'ASK_EASIER', reasonCode: 'STUDENT_STUCK', acknowledgement: '', followUpQuestion: '둘 중 무엇이 더 가까운가요?', supportOptions: ['사람', '동물'] });
  assert.equal(r.ok, true);
});

test('알 수 없는 decision 거부', () => {
  assert.equal(TC.validateFollowUpResponse({ decision: 'MAYBE', reasonCode: 'SUFFICIENT' }).ok, false);
});

test('알 수 없는 reasonCode 거부', () => {
  assert.equal(TC.validateFollowUpResponse({ decision: 'NEXT', reasonCode: 'WHATEVER' }).ok, false);
});

test('후속질문 40자 초과 거부', () => {
  const r = TC.validateFollowUpResponse({ decision: 'ASK_FOLLOW_UP', reasonCode: 'TOO_VAGUE', followUpQuestion: '가'.repeat(41), supportOptions: [] });
  assert.equal(r.ok, false);
});

test('ASK_FOLLOW_UP인데 후속질문 비면 거부', () => {
  assert.equal(TC.validateFollowUpResponse({ decision: 'ASK_FOLLOW_UP', reasonCode: 'TOO_VAGUE', followUpQuestion: '', supportOptions: [] }).ok, false);
});

test('평가어(완벽/최고/정답) ack 거부', () => {
  assert.equal(TC.validateFollowUpResponse({ decision: 'NEXT', reasonCode: 'SUFFICIENT', acknowledgement: '완벽해요!', followUpQuestion: '', supportOptions: [] }).ok, false);
  assert.equal(TC.validateFollowUpResponse({ decision: 'NEXT', reasonCode: 'SUFFICIENT', acknowledgement: '정답이에요', followUpQuestion: '', supportOptions: [] }).ok, false);
});

test('창작/대필 키(body/scene/nextId/ending) 포함 시 거부', () => {
  assert.equal(TC.validateFollowUpResponse({ decision: 'NEXT', reasonCode: 'SUFFICIENT', body: '옛날 옛적에' }).ok, false);
  assert.equal(TC.validateFollowUpResponse({ decision: 'NEXT', reasonCode: 'SUFFICIENT', ending: '행복하게' }).ok, false);
  assert.equal(TC.validateFollowUpResponse({ decision: 'NEXT', reasonCode: 'SUFFICIENT', nextId: '3' }).ok, false);
});

test('NEXT는 followUpQuestion/supportOptions 강제 비움', () => {
  const r = TC.validateFollowUpResponse({ decision: 'NEXT', reasonCode: 'SUFFICIENT', followUpQuestion: '왜?', supportOptions: ['a'] });
  assert.equal(r.ok, true);
  assert.equal(r.value.followUpQuestion, '');
  assert.equal(r.value.supportOptions.length, 0);
});

/* ── fallback ── */
test('fallback — 주인공(G3)/목표(G4)는 고정 후속질문', () => {
  const p = TC.followUpFallback('protagonist');
  assert.equal(p.decision, 'ASK_FOLLOW_UP');
  assert.ok(p.followUpQuestion.length > 0);
  const g = TC.followUpFallback('goal');
  assert.equal(g.decision, 'ASK_FOLLOW_UP');
});

test('fallback — 그 외 질문은 NEXT 안전 통과', () => {
  const r = TC.followUpFallback('audience');
  assert.equal(r.decision, 'NEXT');
  assert.equal(r.reasonCode, 'SUFFICIENT');
});

/* ── user message ── */
test('user message — PII 없음 + 핵심 맥락 포함', () => {
  const msg = TC.buildFollowUpUserMessage(TC.validateFollowUpInput(baseInput({ currentAnswer: '말하는 고양이', priorSummaries: [{ key: 'audience', text: '가족' }] })).value);
  assert.ok(msg.includes('말하는 고양이'));
  assert.ok(msg.includes('주인공'));
  assert.ok(!/uid|pin|password/i.test(msg));
});
