/* ════════════════════════════════════════════════════════════════
   WRITE-AFTER H1/H2 FIX — 팀 AI 접근 권한 순수 결정 로직 (외부 의존 0·테스트 가능)
   ──────────────────────────────────────────────────────────────
   RTDB read는 index.js의 _checkTeamAiMembership이 담당하고, 이 모듈은
   읽어온 값(role/isTeacher/memberStatus)으로 허용 여부만 결정한다.
   정책: super_admin OR 이 학급 teacher_uid OR 이 팀 members/{uid}/status==='active'.
   그 외 = 차단 대상(reason: AI_AUTH_MEMBERSHIP_MISSING).
   ════════════════════════════════════════════════════════════════ */
'use strict';

/* 입력: { role:'super_admin'|null, isTeacher:boolean, memberStatus:string|null }
   반환: { allowed:boolean, role:'super_admin'|'teacher'|'member'|'none', reason?:string } */
function decideTeamAiAccess(input) {
  const inp = (input && typeof input === 'object') ? input : {};
  if (inp.role === 'super_admin') return { allowed: true, role: 'super_admin' };
  if (inp.isTeacher === true) return { allowed: true, role: 'teacher' };
  if (inp.memberStatus === 'active') return { allowed: true, role: 'member' };
  return { allowed: false, role: 'none', reason: 'AI_AUTH_MEMBERSHIP_MISSING' };
}

const _exported = { decideTeamAiAccess };
if (typeof module !== 'undefined' && module.exports) module.exports = _exported;
if (typeof globalThis !== 'undefined') globalThis.teamAiAuth = _exported;
