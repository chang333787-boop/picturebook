# 학생 입장 membership 기록 흐름 조사 (AUTH-SAFETY-MEMBERSHIP-ENTRY-FLOW-AUDIT)

- 일자: 2026-07-01
- 성격: **read-only** (DB write 0 · deploy 0 · 실 AI 0 · enforce 미전환)
- 대상: H-1/H-2 enforce ON 보류 원인 규명
- 판정: **`MEMBERSHIP_ENTRY_FLOW_READY_FOR_ENFORCE`** (메커니즘 정상 · 단 일부 레거시 팀 미기록 → log-only 관측 후 enforce 권장)

## ⚠️ 앞선 판단 정정 (중요)
직전 루프의 "여러 팀 members=null → enforce 차단" 결론은 **측정 오류(false negative)** 였다. 원인: RTDB team 키가 이미 `encodeURIComponent(teamName)` 형태(예 `%ED%8E%84%ED%8E%84%EC%9D%B4`)로 저장돼 있는데, `firebase database:get`에 그 경로를 넘기면 REST가 `%ED…`를 **디코드**해 실제(리터럴 %) 키와 불일치 → null 반환. **이중 인코딩(`%25ED…`)으로 재조회하니 members가 정상 존재**했다.

## 결론 요약
- 학생 입장 흐름 `_joinTeamV2`(firebase.js)는 **익명 로그인 → joinTeamMembership callable 호출**로 PIN을 서버 검증하고 `members/{uid}/status='active'`를 기록한다. 메커니즘 정상.
- 실 데이터 확인: 펄펄이(연습·`19BkZN…` anonymous active + 교사)·2모둠(2)·4모둠(교사+2)·5모둠(교사+4)에 active member 기록 존재. membership-attempts에 20 uid.
- 단, **일부 팀은 학생 membership 미기록**: 1·3·10모둠(교사 uid만)·유은(scenes 있는데 members 0). → 레거시/엣지(멤버십 시스템 이전 생성 또는 PIN 입장 미경유 추정).

## 질문별 답
1. **학생 입장 경로**: 진입 화면(`btn-join` → `joinTeam()` → v2 `_joinTeamV2`, ui.js:924 바인딩). 코드+팀명+PIN 입력.
2. **joinTeamMembership 호출됨?** YES — `_joinTeamV2`가 `MembershipLogin.requestTeamMembership` → `joinTeamMembership` callable(firebase.js:380).
3. **언제?** 학생이 진입 화면에서 코드+팀명+PIN으로 **입장할 때**(익명 로그인 직후·서버 PIN 검증 성공 시 members write). maker/viewer `?team=` 자동입장은 joinTeam 자동호출 안 함(ui.js:1251).
4. (호출됨 — 해당 없음.)
5. **rules의 membership 요구**(database.rules.json):
   - `scenes.write`·`viewer-meta.write` = **`auth != null`** (membership 불요 — 학생이 membership 없이도 본문 저장 가능).
   - `scenes.read`(비공개)·`editSession`·`writingGuide`·`onboarding` read/write = **active member OR teacher_uid OR super_admin 요구**.
   - `members/$uid.write` = **false**(admin SDK only·joinTeamMembership만 기록).
   - `aiVariants`/`aiDrafts` write=false.
6. **members가 (일부) 비는 원인**: (a) `scenes.write:auth!=null`이라 PIN join 없이도 본문 write 가능 → join 미경유 팀 존재 가능 (b) 멤버십 시스템(SEC-4) 이전 생성 팀(legacy) (c) 교사가 maker로 직접 만든 데모/연습 팀. **rules 우회 아님**(members write는 admin SDK 전용).
7. **재입장 시 members 생성?** YES — 학생이 진입 화면 PIN 입장하면 joinTeamMembership이 active 기록.
8. **기존 팀 살리기**: (a) 학생 재입장(PIN) 유도 → 자동 기록, OR (b) 미기록 팀 **백필**(운영 write·승인 필요), OR (c) teacher_uid는 이미 통과.
9. **enforce ON 전 최소 조치**: **log-only 관측**으로 실 `AI_AUTH_MEMBERSHIP_MISSING` 로그 수집 → 실제 막히는 활성 사용자가 있는지 확인. 있으면 그 팀만 재입장 유도/백필. 없으면 enforce ON.

## 서버 게이트 경로 정합성(중요)
`_checkTeamAiMembership`(functions/index.js)는 admin SDK `admin.database().ref('classes/'+classId+'/teams/'+encodeURIComponent(teamName)+'/members/'+uid+'/status')`로 읽는다. admin SDK `.ref()`는 경로 세그먼트를 **디코드하지 않고 리터럴 키**로 취급 → joinTeamMembership이 쓴 `enc=encodeURIComponent(teamName)` 키와 **동일** → 정상 매칭. (CLI database:get만 디코드 이슈. 게이트 자체는 정상.)

## enforce 위험 재평가
- **정상 join 사용자(대부분 활성 팀)**: 게이트 통과 → 무영향. (12:56 실 AI 호출자 `19BkZN`도 펄펄이 active member → 통과.)
- **미기록 팀 사용자(유은·1/3/10모둠 학생)**: enforce 시 차단 가능. 단 비공개 작품은 `scenes.read`도 membership 요구라 이미 재열람 제약 → 실제 활성 AI 사용자인지 로그로 확인 필요.
- 별개 관찰: `scenes.write:auth!=null`이라 데이터 모델 자체가 본문 write에 membership을 강제하지 않음 → AI 게이트가 본문 write보다 엄격(불일치). 이는 enforce 정책과 무관한 기존 특성(별도 검토 후보).

## 위험 등급
- Critical/High 신규 0. (H-1/H-2는 이미 log-only로 완화 중.)
- Medium: 일부 레거시 팀 membership 미기록 → enforce 시 해당 팀 학생 차단 가능.
- Low: CLI 인코딩으로 인한 조사 측정 오류(정정됨).

## enforce ON 여부 / 다음 루프
- **이번 enforce ON 금지**(read-only 루프). 
- 권장 순서: ① **log-only 유지 + 실 트래픽 관측**(`AI_AUTH_MEMBERSHIP_MISSING` warn 수집·며칠) → ② 막히는 활성 사용자 0이면 enforce ON, 있으면 ③ 해당 팀만 재입장 유도 또는 백필(승인) 후 enforce.
- 백필: 필요 시 `joinTeamMembership` 로직 재사용해 특정 팀 members 기록(운영 write·별도 승인 루프).

## 검증 무해성
- 운영 DB write 0 · Functions/Rules deploy 0 · 실 AI 0 · enforce 미전환 · 코드 수정 0. read-only 메타 경로만(members status·teacher_uid·teamCreationMode·membership-attempts 키). 학생 이름/본문/작품 내용 미조회.
