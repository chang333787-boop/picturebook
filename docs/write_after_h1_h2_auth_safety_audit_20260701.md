# H-1/H-2 — 텍스트 AI callable 팀 권한 검증 안전모드 조사

- 일자: 2026-07-01
- 대상: 총점검 High 이관 H-1/H-2 ([full-day audit](write_after_full_day_audit_20260701.md))
- 성격: **read-only 조사 + 최소 수정 설계** (코드 수정 0 · deploy 0 · DB write 0 · 실 AI 0)
- 판정: **`AUTH_SAFETY_FIX_NEEDED`** (수정 설계 완료 · 적용은 functions deploy 필요 → 승인 게이트)

## 현재 권한 흐름 요약
- AI callable 공통 게이트 = `_validateRequest(req, mode, opts)`(functions/index.js:350-494). 검사 항목: ①auth(익명 포함) ②testMode 거부 ③classId/teamName 존재 ④aiSettings 존재 OR AI_TEST_ALLOWED ⑤copyDepth≤1 ⑥origin(가지 도메인) ⑦kill switch ⑧aiSettings.enabled + modes[modeKey](**학급 단위**) ⑨quota(global/root/branch, `ai-usage/{classId}/{teamName}/{yyyyMm}/{mode}Used`).
- **미검사**: 호출자가 `teamName` 팀의 구성원인지(=`classes/{classId}/teams/{enc}/members/{uid}/status==='active'`) 또는 교사인지. → 권한이 **학급 단위**로만 걸리고 **팀 단위 소유권 검증이 없음**.
- membership 인프라는 존재: `joinTeamMembership`(functions/index.js:2692)이 **PIN 검증 후** admin SDK로 `members/{uid}/status='active'` 기록(rules 우회). `_validateSourceModeRequest`(2475-2519)는 이미 "교사/super_admin OR active member" 검사를 함(2509-2517) — **동일 패턴을 `_validateRequest`가 안 쓸 뿐**.

## 실제 위험 경로
`_validateRequest`를 쓰는 9개 callable(단일 choke point): callTextAiBatch(s1 1370)·callTextAiBatchS2(s2 1579)·callWorkCheck(1665)·callWriteAfterQuestions(1802)·saveTextVariant(1926)·callImageAiS1(2149)·callImageAiS2(2284/2359)·callApplyImageS2Selection(2399)·callApplyTextS2Selection(2438).

- **H-1 (High)**: AI 활성 학급(aiSettings.enabled + mode on)에서 인증된(익명 포함) 사용자가 허용 origin(=가지 사이트)에서 **같은 학급 임의 teamName**으로 callTextAiBatchS2/callWorkCheck/callWriteAfterQuestions/callImageAiS2 호출 가능 → **타 팀 AI quota 소모 + Anthropic 비용 발생 + aiChecks/aiVariants 노드 오염**.
- **H-2 (High)**: `saveTextVariant`(2438 skipUsageLimits)도 동일 게이트 → 같은 학급 타 팀 `aiVariants/text/{sid}/s2` variant를 임의 body로 write 가능(admin SDK 경유·rules `.write:false` 우회). 단 **감상 화면 노출은 교사 발행선택(callApplyTextS2Selection·교사 게이트)이 있어야** 하므로, 미선택 variant는 dormant(학생에게 안 보임).
- **완화 요인**: ①origin 게이트(임의 외부 웹 불가·가지 사이트에서 실행 필요) ②aiVariants 표시 전환은 전부 교사 게이트(D/E) ③quota가 팀별 버킷이라 무한은 아님(타 팀 quota 소진까지). → 그래서 **Critical(외부 임의 쓰기)이 아니라 High(같은 학급 내부 횡적 접근)**.
- **apply/lock 계열은 안전**: callApplyTextS2Selection·callApplyImageS2Selection(교사 전용)·lockImageSourceMode(`_validateSourceModeRequest` membership) — 이미 팀/교사 게이트 있음.

## 질문별 답
1. 타 팀 teamName 호출 가능? **YES**(학급 단위 게이트만·팀 membership 미검사).
2. 학생/교사/익명 차이? **없음**(`_validateRequest`는 uid 존재만 봄·role/membership 무시). 익명 인증도 통과.
3. imageS2 더 강함? **부분적**. 이미지 **생성**(callImageAiS1/S2)은 같은 gap. 이미지 **선택/적용/lock**은 교사·membership 게이트 있음.
4. viewer/maker 팀 접근 확인 방식? 클라 진입 시 `joinTeamMembership`(PIN)→`members/{uid}`. scenes rules는 auth+(member OR teacher). **AI callable만 admin SDK로 membership 우회**.
5. 서버 최소 추가 검증? `_validateRequest`에 "super_admin OR class teacher_uid OR `members/{uid}/status==='active'`" 게이트 추가(=`_validateSourceModeRequest`와 동일).
6. 교사 흐름 회귀 위험? 교사=teacher_uid/super_admin으로 통과(팀 membership 불요). 학생=진입 시 active member 기록됨. **회귀 위험은 membership 미기록 레거시 팀/작품**(구 데모·PIN 없이 만든 팀)에서 학생 차단 가능 → soft-launch로 완화 필요.
7. PIN 서버 검증? PIN은 `joinTeamMembership`이 이미 검증→members 기록. `_validateRequest`는 PIN 재검증 말고 **members status 재사용**이 맞음(AI 페이로드에 PIN 없음).
8. 지금 막을 범위 vs 후속? **지금(수정 설계)**: `_validateRequest` membership 게이트(텍스트+이미지 생성+saveTextVariant 전부 한 곳에서 커버). **후속**: 레거시 membership 백필/soft-launch 관측, rate-limit, 익명 세션 정책.

## 수정 후보
- **후보 A (권장·최소)**: `_validateRequest` origin 검사 직후(또는 aiSettings 게이트 뒤)에 membership 게이트 삽입:
  ```js
  // 팀 소유권: super_admin OR 이 학급 teacher_uid OR 이 팀 active member
  const role = (req.auth.token && req.auth.token.role) || null;
  let teamAllowed = (role === 'super_admin');
  if (!teamAllowed) {
    const t = await admin.database().ref(`classes/${classId}/meta/teacher_uid`).once('value');
    if (t.val() === req.auth.uid) teamAllowed = true;
  }
  if (!teamAllowed) {
    const enc = encodeURIComponent(teamName);
    const m = await admin.database().ref(`classes/${classId}/teams/${enc}/members/${req.auth.uid}/status`).once('value');
    if (m.val() === 'active') teamAllowed = true;
  }
  if (!teamAllowed) throw new HttpsError('permission-denied', '이 모둠에서만 AI를 사용할 수 있어요.');
  ```
  → 9개 callable 전부 한 곳에서 보호. `_validateSourceModeRequest`와 동일 로직·검증된 패턴. RTDB read 1~2회 추가(경미).
- **후보 B (soft-launch)**: 후보 A를 **관측 모드 플래그**로 감싸기 — `ai-auth-enforce/enabled`(Firebase flag) false면 위반 시 `logger.warn`만(차단 X), true면 차단. 며칠 로그 관측(레거시 팀 차단 없나) 후 enforce. **회귀 위험 최소화·권장 롤아웃**.
- **후보 C (rules 병행)**: aiVariants는 이미 `.write:false`(서버 전용)라 rules로는 못 막음(admin SDK write). members write도 admin SDK. → **rules 변경으로는 해결 불가**(callable 로직에서 막아야 함). rules deploy 불요.

## 가장 안전한 최소 수정안
**후보 A + B 결합**: `_validateRequest`에 membership 게이트(A) 추가하되 `ai-auth-enforce/enabled` 플래그로 감싸(B) 초기엔 log-only → 레거시 영향 관측 후 enforce. 교사/super_admin bypass 유지. rules 변경 0. 단일 함수 수정으로 텍스트·이미지 생성·variant 저장 전부 커버.

## 필요한 테스트
1. 교사(teacher_uid) → 자기 학급 임의 팀 통과(기존 흐름 무회귀).
2. super_admin → 통과.
3. active member(PIN 검증한 학생) → 자기 팀 통과.
4. 같은 학급 타 팀 non-member → **차단**(enforce 모드).
5. 익명/무member → 차단.
6. saveTextVariant·callTextAiBatchS2·callWorkCheck·callWriteAfterQuestions·callImageAiS2 전부 게이트 적용 확인.
7. apply/lock 계열 회귀 없음(이미 교사 게이트).
8. soft-launch 플래그 off=log-only·on=차단 동작.
9. 레거시 membership 미기록 팀 시나리오(관측).

## deploy / rules / 회귀
- **functions deploy 필요**(수정 시 `_validateRequest` 변경 → 이를 쓰는 9개 함수 재배포). **이번 루프 미수행**(승인 게이트).
- **rules 변경 불요**(후보 C 참조).
- **회귀 위험**: 레거시 membership 미기록 팀에서 학생 차단 → soft-launch로 관측·완화. 교사 흐름 무회귀.
- DB write 0 · 실 AI 0 (이번 조사).

## 결론
H-1/H-2는 **High** 확정(같은 학급 횡적 AI 호출·quota·variant write). Critical 아님(origin 게이트 + 교사 발행선택 게이트가 감상 노출 차단). 최소 수정 = `_validateRequest` 단일 지점에 membership 게이트(`_validateSourceModeRequest`와 동일) + soft-launch 플래그. rules 무변경·functions deploy 필요(승인 후 별도 루프). 판정 **`AUTH_SAFETY_FIX_NEEDED`**.
