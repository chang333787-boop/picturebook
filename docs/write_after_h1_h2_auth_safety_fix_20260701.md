# H-1/H-2 수정 — AI callable 팀 membership 게이트 (soft-launch)

- 일자: 2026-07-01
- 대상: 총점검 High H-1/H-2 · 설계 = [auth safety audit](write_after_h1_h2_auth_safety_audit_20260701.md)
- 성격: functions/index.js 수정 + 순수 모듈 + 테스트 · **soft-launch(log-only 기본)** · rules 무변경 · DB write 0 · 실 AI 0
- feature commit: `ae13a17`
- 판정: **`AUTH_SAFETY_FIX_READY`** → (배포 확인 후) log-only 라이브

## 무엇을 고쳤나
`_validateRequest`(functions/index.js·AI callable 9개 단일 게이트)에 **팀 소유권 게이트**를 quota 차감 前에 추가:
- 허용: `super_admin` · 이 학급 `classes/{classId}/meta/teacher_uid === uid` · 이 팀 `classes/{classId}/teams/{enc}/members/{uid}/status === 'active'`.
- 그 외 = 차단 대상(reason `AI_AUTH_MEMBERSHIP_MISSING`).
- **soft-launch**: `aiAuthEnforce/enabled === true` 일 때만 차단(permission-denied "이 팀에서 AI 기능을 사용할 권한이 없어요. 다시 입장해 주세요."). 기본(부재/false/read실패) = **log-only**(logger.warn만·기존 동작 유지).

## 구현
- **순수 결정 모듈** `functions/team-ai-auth.js` — `decideTeamAiAccess({role,isTeacher,memberStatus})` → `{allowed, role:'super_admin'|'teacher'|'member'|'none', reason?}`. 외부 의존 0·테스트 가능.
- **RTDB 검사** `_checkTeamAiMembership({classId,teamName,uid,role})`(index.js) — super_admin→teacher_uid→members status 순으로 **최소 read**(먼저 통과 시 이후 read 생략), 결과를 순수 decider에 위임.
- **soft-launch read** `_isAiAuthEnforced()` — `aiAuthEnforce/enabled` 1회 read, 실패 시 false(안전).
- **게이트 삽입 위치**: `_validateRequest`의 aiSettings/origin/killswitch 검사 뒤, **quota 블록(`let used=0`) 直前** → membership 실패 시 quota 미차감(enforce)·log-only에서도 quota 흐름 불변.
- 로그 필드: classId·teamName·uid·mode·reason만. **PIN/body/imageData/작품내용 로그 0.** 운영 DB에 audit write 0(functions logger만).

## 적용 범위(9개 callable, 단일 지점)
callTextAiBatch(s1)·callTextAiBatchS2(s2)·callWorkCheck·callWriteAfterQuestions·saveTextVariant·callImageAiS1·callImageAiS2·callApplyImageS2Selection·callApplyTextS2Selection. apply 2종은 이후 자체 teacher-only 게이트도 유지(이중).

## 회귀 안전
- **교사/super_admin 무회귀**: teacher_uid/super_admin이 최우선 통과(팀 membership 불요).
- **정상 학생 무회귀**: 팀 진입 시 `joinTeamMembership`(PIN)이 `members/{uid}/status='active'` 기록 → 통과.
- **레거시(membership 미기록) 팀**: log-only 기본이라 즉시 차단 없음 → warn 로그로 **관측 후** enforce 전환 결정. (enforce ON은 이번 루프 미적용·운영 flag로 별도.)
- rules 변경 0(aiVariants/members는 admin SDK write라 rules로 못 막음·callable 로직에서 해결).

## 검증
- `functions/team-ai-auth.js` node --check OK · `functions/index.js` node --check OK.
- 순수 테스트 `tests/write-after/team-ai-auth.test.js` **8/8**: super_admin/teacher/member 허용, non-member/비-active(pending·removed·'ACTIVE' 대소문자 등)/비객체 입력 차단, 우선순위(super_admin>teacher>member).
- 회귀: text resolver 18/18 · image resolver 16/16 · write-after-questions 8/8.
- 게이트가 quota(`let used=0`) 前 위치 확인. secret grep 0. functions/node_modules 미트래킹.
- **배포**: `_validateRequest` 쓰는 **9개 callable만** `firebase deploy --only functions:<9개>`(전체 무차별 deploy 아님). soft-launch 기본 log-only라 배포 후에도 외부 동작 무변경(미인증 401·정상 호출 통과·비멤버 호출은 warn 로그만).

## enforce 전환 절차(후속·운영 판단)
1. log-only로 며칠 관측 → `AI_AUTH_MEMBERSHIP_MISSING` warn 로그에서 정상 학생/레거시 팀 오탐이 없는지 확인.
2. 오탐 0 확인 후 `aiAuthEnforce/enabled=true`로 전환(운영 승인) → 비멤버 차단 활성.
3. 필요 시 레거시 팀 membership 백필 후 전환.

## 남은 것
- enforce ON 전환(관측 후 운영 승인).
- (선택) 레거시 membership 백필 스크립트.
- selection 저장 E2E(실 교사세션)·인터랙티브 시각은 별개 후속.
