/* WRITE-AFTER H1/H2 — team-ai-auth.js 순수 결정 로직 단위 테스트. node 단독(외부 0). */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const A = require('../../functions/team-ai-auth.js');

test('super_admin → allowed(role super_admin)', () => {
  const r = A.decideTeamAiAccess({ role: 'super_admin', isTeacher: false, memberStatus: null });
  assert.equal(r.allowed, true); assert.equal(r.role, 'super_admin');
});

test('class teacher(isTeacher) → allowed(role teacher)', () => {
  const r = A.decideTeamAiAccess({ role: null, isTeacher: true, memberStatus: null });
  assert.equal(r.allowed, true); assert.equal(r.role, 'teacher');
});

test('active member → allowed(role member)', () => {
  const r = A.decideTeamAiAccess({ role: null, isTeacher: false, memberStatus: 'active' });
  assert.equal(r.allowed, true); assert.equal(r.role, 'member');
});

test('non-member(status null) → 차단', () => {
  const r = A.decideTeamAiAccess({ role: null, isTeacher: false, memberStatus: null });
  assert.equal(r.allowed, false); assert.equal(r.role, 'none'); assert.equal(r.reason, 'AI_AUTH_MEMBERSHIP_MISSING');
});

test('member status가 active 아님(pending/removed 등) → 차단', () => {
  for (const s of ['pending', 'removed', 'inactive', '', 'ACTIVE']) {
    const r = A.decideTeamAiAccess({ role: null, isTeacher: false, memberStatus: s });
    assert.equal(r.allowed, false, 'status=' + s + ' 차단');
  }
});

test('우선순위: super_admin이 isTeacher/member보다 우선', () => {
  const r = A.decideTeamAiAccess({ role: 'super_admin', isTeacher: false, memberStatus: null });
  assert.equal(r.role, 'super_admin');
});

test('teacher가 member보다 우선(role 라벨)', () => {
  const r = A.decideTeamAiAccess({ role: null, isTeacher: true, memberStatus: 'active' });
  assert.equal(r.role, 'teacher');
});

test('입력 없음/비객체 → 차단(안전 기본값)', () => {
  assert.equal(A.decideTeamAiAccess(undefined).allowed, false);
  assert.equal(A.decideTeamAiAccess(null).allowed, false);
  assert.equal(A.decideTeamAiAccess('x').allowed, false);
});
