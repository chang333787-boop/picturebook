# AICHECKS-RULES-READ-1 — 작품마무리 결과 보기 aiChecks read rules 추가

- 일자: 2026-07-03 · Rules deploy 1회(사용자 승인 명령) · Functions deploy 0 · DB write 0 · AI 호출 0
- 판정: **AICHECKS_RULES_READ_1_DEPLOY_PASS**

## 1. 문제와 원인
작품마무리 2단계의 `생각 점검 질문/작품 검사 결과 보기`·`🖨 고쳐쓰기 자료 인쇄`·✅완료 배지가
실환경에서 permission_denied로 실패. 원인 = **RTDB rules에 `aiChecks` 노드 규칙이 없어 기본
거부**(FIELD-REGRESSION-FIX-2에서 배포 rules 실조회로 확정 — 교사 포함 전원 거부, mock 하니스만 통과).

## 2. 추가한 규칙 (database.rules.json — aiChecks 4줄만, 다른 노드 무변경)
```
classes/$classId/teams/$team/aiChecks:
  .read  = auth != null && ( 해당 팀 members/{uid}/status == 'active'
                             || 담당 교사(meta/teacher_uid == uid)
                             || auth.token.role == 'super_admin' )
  .write = false   (client 전면 금지 — 서버 Functions Admin SDK만 저장)
```
- editSession/writingGuide/onboarding과 동일 패턴 — scenes read보다 **좁음**(isPublic 감상자 제외:
  AI 점검 결과는 팀 내부 자료).

## 3. Rules 에뮬레이터 테스트 — 70/70 PASS (기존 58 + 신규 12)
신규 tests/rules/aichecks-read.test.js:
- read 허용: 해당 팀 active member(waq/wc)·담당 교사·super_admin ✅
- read 거부: 미인증·다른 학급 교사·같은 학급 비멤버 학생 ✅
- write 거부: active member·교사·**super_admin 포함 전원** ✅
- 회귀 가드: private scenes read 매트릭스 유지·aiVariants read:true 유지 ✅
- 기존 58개(공개 감상/POLISH-AUTH/compass/imageS2 등) 전부 그대로 통과 = unrelated 회귀 0.

## 4. Deploy·실환경 확인
- `firebase deploy --only database` 성공 → **배포 rules 재조회로 aiChecks 반영 byte 확인**.
- 실 DB 매트릭스: unauth REST read = Permission denied(거부 유지) · 인접 aiVariants read 정상.
- 0000 팀 실데이터 존재 확인(read-only): `aiChecks/{workCheck, writeAfterQuestions}` 둘 다 있음
  → membership 있는 세션에서 결과 보기/인쇄 버튼이 이제 정상 작동 조건 충족.
- member/teacher 허용 케이스는 에뮬레이터 12케이스가 보증 — **실계정 화면 확인은 사용자**
  (membership 있는 팀으로: 결과 보기 2종 + 고쳐쓰기 인쇄 버튼/미리보기 + ✅배지).

## 5. 남은 후속
- **legacy membership 미기록 팀은 여전히 거부**(이번 범위 밖·기존 H-1 백필 트랙과 동일 축).
- 실계정 화면 확인(위 4) · 실프린터 1회(그림책 인쇄 트랙).
