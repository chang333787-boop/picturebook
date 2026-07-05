# SCENES-WRITE-RULES-HARDEN-1 — 실행 계획 (2026-07-05)

- 기준: origin/main `f80d89b` · **계획 전용(rules 변경·배포 0)** · 별도 승인 후 단계 실행
- 목적: scenes/viewer-meta의 `.write: "auth != null"`(익명 전원 = 남의 작품 변조 가능)을
  **멤버 범위**로 조여 변조 차단. 단, legacy 저장을 깨지 않고.

## 0. 한 줄 요약
**v2 경로 조이기는 생각보다 저위험**이다 — 이유: 같은 노드의 **read가 이미 멤버 범위로
게이팅**돼 있어, 비공개 팀 scenes를 지금 편집할 수 있는 사람은 이미 그 팀 member/교사뿐이기
때문. write를 read와 동일 조건으로 미러링하면 **정당한 편집자는 그대로 통과, 외부 변조만 차단**.
진짜 주의 지점은 (a) member 노드가 아예 없는 **구(舊) v2 팀**, (b) **v1 legacy 경로**(classId 없음)
두 가지이며, 이건 **데이터 census를 go/no-go 게이트로** 삼아 분리 처리한다.

## 1. 현재 상태 (원문 확인)

### 두 개의 scenes write 위치
| 경로 | read | write(현재) | 성격 |
|---|---|---|---|
| **v2** `classes/$cid/teams/$team/scenes`·`viewer-meta` (rules 61-66) | 🔒 `isPublic ∥ (auth && (member active ∥ teacher_uid ∥ super_admin))` | ⚠️ `auth != null` | 신규 정본 경로 |
| **v1** `teams/$team/scenes`·`viewer-meta` (rules 141-157) | ✅ `true`(전면 공개) | ⚠️ `auth != null` | classId 없는 구 경로 |

핵심 비대칭: **v2는 read가 이미 멤버 범위인데 write만 열려 있다.** = 조일 대상이 명확하고,
read 게이트가 이미 같은 인구를 거르므로 미러링이 안전.

### 멤버십이 'active'가 되는 유일 경로 = 서버 콜러블
`joinTeamMembership`(functions/index.js:2761, admin SDK)이 **PIN 입장마다** members/{uid}에
`status:'active'` set(index.js:2875-2882). joinedAt 보존·재입장 시 갱신. → **PIN 재입장 = 자연 백필**
(별도 migration 스크립트 불요). 세션 복원(_resumeTeamFromSession)은 members **read만**(write 없음)
→ 세션만으로는 백필 안 됨(재입장 필요).

### 클라 write는 전부 maker UID(POLISH-AUTH)
scenes/viewer-meta write 경로(viewer-data.js:488·520, viewer-edit.js:4567, viewer-image-edit.js:536)는
모두 `getViewerDb()`=default app=**복원된 maker UID**로 실행. 학생=그 팀 member uid, 교사=teacher_uid.
→ 조인 규칙의 `member active ∥ teacher_uid` 두 갈래로 자연 커버.

## 2. 목표 규칙 (v2 — Stage 1)

```jsonc
// classes/$classId/teams/$team/scenes 와 viewer-meta 의 .write
".write": "auth != null && (
  root.child('classes/'+$classId+'/teams/'+$team+'/members/'+auth.uid+'/status').val() === 'active'
  || root.child('classes/'+$classId+'/meta/teacher_uid').val() === auth.uid
  || auth.token.role === 'super_admin'
)"
```
= **read에서 `isPublic` 절만 뺀 것.** (공개 작품이라도 write는 member/교사만 — 의도된 방향.)

## 3. 조이면 깨질 위험 지점 + 대응

| # | 위험 | 실체 | 대응 |
|---|---|---|---|
| R1 | 🔴 **member 없는 구 v2 팀** | membership 시스템(SEC-01) 이전 생성 팀은 members 노드 자체가 없음. 비공개면 read도 이미 막혀 편집 불가(=이미 그런 상태)·공개면 read는 되나 write가 끊길 수 있음 | **데이터 census가 go/no-go.** 해당 팀 수·isPublic 분포 집계 → 소수면 PIN 재입장 안내(자연 백필)·다수면 Stage 1 보류 |
| R2 | 🔴 **v1 경로(classId=null)** | `teams/$team` 서브트리는 read·write 전면 개방. Stage 1(v2)과 **무관**(다른 서브트리)이라 안 깨짐. 단 이 경로 자체는 여전히 취약 | **Stage 2로 분리.** v1 잔존 데이터 census 후 별도 |
| R3 | 🟡 교사 maker 편집 | 교사 UID는 members에 없음 | 규칙에 `teacher_uid` 갈래 포함(위 §2에 있음) → 통과 |
| R4 | 🟡 세션 2h 후 저장 | 세션 복원은 read만·members는 영구('active' 유지, 만료 decay 없음) | members는 한 번 active면 유지 → 문제 없음. **단 TTL 규칙은 추가하지 않는다**(추가하면 R4가 실위험이 됨) |
| R5 | 🟢 공개 팀 비member write | 감상용 공개 작품에 외부인이 write | 차단이 정확한 동작(원하는 결과) |

## 4. 테스트 설계 (에뮬레이터 — 배포 전 필수)

기존 `tests/rules/polish-auth-scenes.test.js` + `fixtures.js`(teamPrivate에 STUDENT_A active
member·teamPublic·teacher_uid 셋업 이미 존재)를 **그대로 재사용**해 write 매트릭스 추가:

```js
// 신규: scenes-write-harden.test.js (Stage 1 배포와 원자 커밋)
active member(STUDENT_A) → teamPrivate/scenes write   : assertSucceeds  // 정당 편집 보존
non-member(STUDENT_B)    → teamPrivate/scenes write   : assertFails     // ★변조 차단(현재 버그)
teacher(TEACHER_A)       → teamPrivate/scenes write   : assertSucceeds  // 교사 경로
anon                     → teamPrivate/scenes write   : assertFails
non-member(STUDENT_B)    → teamPublic/scenes write    : assertFails     // 공개여도 write 차단
active member            → teamPrivate/viewer-meta write: assertSucceeds
// 회귀 가드: database.rules.test.js의 MUST_PRESERVE("학생 maker write 허용")를
//   member 기준으로 갱신(현행 auth!=null 통과 테스트가 새 규칙과 충돌하므로 함께 수정).
```
실행: `cd tests/rules && npm test`(firebase emulators:exec, 이미 구성됨).

## 5. 롤아웃 순서 (단계별 승인)

1. **[승인1] 데이터 census** — Firebase에서 `classes/*/teams/*` 순회: members 노드 없는 팀 수,
   그중 isPublic true/false, scenes 존재 여부, 최근 수정일. **R1 규모 확인 = Stage 1 go/no-go.**
   (read-only 조회. 운영 write 0.)
2. **[승인2] 테스트 작성 + 에뮬레이터 green** — §4 매트릭스. 규칙 변경은 **로컬 rules 파일에서만**,
   에뮬레이터로 검증. 아직 배포 X.
3. **[승인3] 실저장 스모크** — 테스트 학급 1개(더미)로: member 학생 저장 성공 / 비member 거부 /
   교사 저장 성공 / **legacy 팀(census에서 고른 실제 팀 1개) 재입장 후 저장 성공**을 실 DB로 확인.
4. **[승인4] 배포** — v2 scenes+viewer-meta write 규칙 원자 배포. 배포 직후 운영 팀 1개 저장 관측.
5. **롤백**: 규칙을 `auth != null`로 되돌리는 1줄 revert + 재배포(즉시·무손실). 데이터 변형 없음이라
   롤백 안전.
6. **Stage 2(별도 트랙)**: v1 `teams/$team` 경로 + **storage.rules `/images` write 팀 경로 격리**를
   같은 성격(legacy·공개 제약)이라 함께. census 결과에 따라 우선순위.

## 6. 하지 않는 것 (경계)
- v1 경로 조이기(Stage 2로 분리) · members TTL 규칙 추가(R4 유발) · migration 스크립트(재입장 백필로 대체) ·
  이번 계획서 작성 중 rules/functions/배포 **변경 0**.

## 6.5 데이터 census 결과 (2026-07-05 실행 · 읽기 전용)

`scripts/harden-census/scenes-write-census.js --full` (운영 read만, write 0):

- **v2 classes 3개 · v2 teams 40개 · v1 legacy teams 5개** — 규모 매우 작음.
- **members 노드: 40팀 중 2팀만 보유, 38팀 없음.** = 멤버십 시스템이 거의 미채워짐(대부분
  teacher_uid 경로로 접근/편집되고 있었다는 뜻. joinTeamMembership 이후 PIN 재입장한 팀만 members 생김).
- member 없는 38팀 중 → **공개 1 · 비공개 37 · scenes 보유 5.**
- 팀 이름이 대부분 연습1·유은복사2·테스트2·무비123 등 **연습/복사/테스트 팀**(옛 junglim 테스트 학급).

### go/no-go 해석 — **Stage 1 = 저위험, 진행 가능**
- **조이면 write 끊길 실위험군 = "member 없음 & scenes 보유"= 5팀**(그중 공개 1='1234' scenes 4).
  나머지 33팀은 scenes=0(빈 팀)이라 조여도 잃을 게 없음.
- **교사/maker 편집은 무조건 통과**(teacher_uid 갈래) → 교사 작업 영향 0.
- 학생이 이 5팀 중 하나를 **비교사 UID로 편집**할 때만 영향 → **PIN 1회 재입장이면 즉시 백필**(app이
  다음 로그인에서 자연 처리). 5팀은 손으로 확인/안내 가능한 소수.
- ⚠️ 유일한 주의: 공개+scenes 팀 `1234`(옛 테스트 학급) — 지금도 쓰는지 스팟 확인 후 진행.
- **결론: R1 규모가 "다수 백필 캠페인 필요" 수준이 아님(실질 5팀·대부분 옛 테스트).
  Stage 1(v2 조이기)로 진행 권장.** 단 배포 전 §5의 에뮬레이터+실저장 스모크는 유지.

### 이 census가 드러낸 별개 사실(참고)
- 멤버십이 2/40만 채워진 건, 학생 접근이 실제론 **교사 공유(공개)·교사 maker 편집** 위주였고
  PIN-멤버 로그인 흐름은 최근 것이라는 정황. HARDEN-1과 별개로, 조인 후 members가 잘 쌓이는지
  실운영 관측 1회 가치 있음.

## 7. 승인 요청
가장 먼저 필요한 건 **[승인1] 데이터 census** — 이게 Stage 1을 실제로 켜도 되는지(R1 규모)를
결정한다. census는 read-only라 위험이 없다. 승인하시면 census 스크립트(운영 write 0)부터 설계한다.

## 검증 기록
- database.rules.json 61-66·141-157 원문 · joinTeamMembership 2761-2889 members write ·
  membership-login.js resolveResume(read-only) · 클라 write 경로 4곳 census · 기존 테스트 4파일 +
  fixtures 셋업 확인. 코드/rules/배포 변경 없음.
