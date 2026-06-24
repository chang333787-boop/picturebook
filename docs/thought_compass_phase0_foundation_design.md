# 생각 나침반 Phase 0 기반·보안 설계

> 기준: PRD `1baabfe`, 감사 `39c0c3b`. 본 문서는 **설계만** — 앱 코드/Rules/Functions 0줄 수정. 생각 나침반 화면은 만들지 않음(공통 기반만).

## 1. 목적과 비범위
- **목적**: 신규·기존 판정, 강제 게이트, writingGuide 경로, 프로젝트 편집 세션, 읽기전용 판정, heartbeat·3분 만료, 중복 탭, 교사 override, Rules write 방어, 전체 set 유실 방지의 **공통 기반**을 구현 가능한 수준으로 확정.
- **비범위**: 질문 화면 UI, AI 호출, 7항목 답변 스키마(게이트 판정 최소 필드만), 튜토리얼 본체, 재열람 UI.

## 2. 현재 구조의 제약 (재확인된 사실)
- 정본 경로 `classes/{classId}/teams/{teamEncoded}` (v2, firebase.js:282), `teamEncoded=encodeURIComponent(teamName)`. 팀 노드 = 프로젝트.
- 팀 자식: `scenes`·`viewer-meta`(projectType)·`locks`(장면별)·`pin`·`account`.
- scenes 저장: `pushToFirebase`(firebase.js:968)→`_flushPushToFirebaseNow`(:980). **더티 0이면 `dbRef.set(cleanScenes)` (=`teamRef.child('scenes')` 전체, line 990)**; 더티 있으면 `dbRef.update`. **set 대상은 scenes 노드뿐, 팀 root 아님.**
- 진입: `_enterTeam`(firebase.js:599)→viewer-meta once→없으면 `showPtypeScreen`(ui.js:601)→`_onPtypeCardClick`(:620)→`_enterMakerAfterPtypeSelected`(:649: projectType set + 신규 text/picturebook면 10장면 생성, `savedNewProjectType` 플래그). 재입장은 `_resumeTeamFromSession`(:525)→`_enterTeam(..., {skipPtypeScreenIfExisting:true})`로 ptype 화면 건너뜀.
- 잠금: **장면별** `locks/{num}`, `viewerTryLock` transaction(viewer-locks.js:127), heartbeat 5s(:266), editorId(device)+instanceId(tab)+lockedAt(**클라 Date.now**). **서버 timestamp·`.info/serverTimeOffset` 미사용**(`.info/connected`만, firebase.js:831).
- **role custom claim 존재**: `auth.token.role ∈ {teacher,super_admin}`, 교사 식별 `classes/{classId}/meta/teacher_uid === auth.uid` (database.rules.json:28~48). 학생=**익명 Auth**, role 없음, **members 스키마 없음**.
- 복사 `redeemCopyCode`(firebase.js:1172): scenes+viewer-meta만 멀티패스 update(isPublic=false). 삭제 `_deleteTeam`(adminConsole.js:1497): **이미 강확인(이름 재입력) 후 팀 root remove**.

## 3. 최종 데이터 경로
```
classes/{classId}/teams/{teamEncoded}/
├─ scenes/                      (기존)
├─ viewer-meta/                 (기존)
│   ├─ projectType              (기존)
│   └─ onboardingVersion        (신규 — 신규/기존 판정 플래그)
├─ writingGuide/
│   └─ preWriting/              (게이트 판정 최소 필드, 답변 본체는 Phase 1)
│       ├─ status               notStarted | inProgress | completed
│       ├─ version              (생각 나침반 데이터 스키마 버전, onboardingVersion과 별개)
│       ├─ currentScreen
│       ├─ updatedAt            (ServerValue.TIMESTAMP)
│       └─ completedAt
├─ onboarding/
│   ├─ tutorialStatus           notStarted | inProgress | completed
│   ├─ currentStep
│   └─ completedAt
└─ editSession/                 (프로젝트 레벨 단일 편집 세션, 장면별 locks와 별개)
    ├─ ownerId                  auth.uid
    ├─ ownerSessionId           탭별 UUID
    ├─ ownerLabel               비-PII 표기(역할/번호)
    ├─ acquiredAt               ServerValue.TIMESTAMP
    ├─ heartbeatAt              ServerValue.TIMESTAMP
    ├─ generation               정수
    └─ mode                     normal | thoughtCompass | tutorial
```
- **명칭 결정**: `writingGuide`(viewer-meta와 동일 camelCase 형제). `onboardingVersion`은 **viewer-meta 안에 colocate** — viewer-meta는 진입 시 이미 once 로드(firebase.js:637)되므로 projectType과 **같은 1회 읽기**로 판정 가능(추가 읽기 0). `version`(writingGuide.preWriting)은 compass 데이터 스키마 버전으로 의미가 달라 분리.
- **모든 신규 노드는 scenes의 형제** — scenes 하위 금지(set 유실 회피, §14).

## 4. onboardingVersion 판정
- **저장 위치**: `viewer-meta/onboardingVersion = 1`. 신규 프로젝트 생성 시 `_enterMakerAfterPtypeSelected`(ui.js:649)에서 projectType과 **원자적으로 함께 set**, 단 **text/picturebook만**(movie/experience 제외, D-01). `savedNewProjectType=true` 경로에서만.
- **기존 프로젝트 backfill 금지** — 필드 없음 = 기존.
- **판정 함수** `resolveOnboardingState(meta, preWriting)`:
  - `meta.onboardingVersion >= 1 && preWriting.status !== 'completed'` → **COMPASS_REQUIRED**(강제)
  - `meta.onboardingVersion` 없음 → **LEGACY**(생각 나침반 선택 실행, 제작 차단 없음)
  - `preWriting.status === 'completed'` → compass 완료 → `onboarding.tutorialStatus`로 튜토리얼 판정
- "필드 부재=신규" 위험 회피: 부재는 **기존**으로 취급(강제 안 함).

## 5. 접근 상태 결정 흐름 (단일 진입점)
```
팀·프로젝트 데이터 로드 완료(scenes·viewer-meta·writingGuide·onboarding·editSession)
  → resolveProjectAccessState() : 순수 함수, 부수효과 0
      입력: projectType, onboardingState, editSessionState, localSessionId, serverNow
      출력: thoughtCompassRequired | tutorialRequired | editableMaker | readOnlyMaker | error
  → applyProjectAccessState(state) : UI 마운트/활성화
```
- **무플래시 보장**: maker 초기화는 `body.access-pending`(쓰기·포인터 차단) 상태로 시작 → 로드+판정 후 `applyProjectAccessState`가 pending 해제하며 게이트 오버레이 또는 편집 활성화. "잠깐 활성화 후 팝업" 금지.
- **단일 훅 위치**: ptype 분기(`_enterMakerAfterPtypeSelected`) 하나가 아니라, **모든 진입이 수렴하는 데이터 로드 완료 지점**(scenes 리스너 첫 콜백 `__branchScenesLoaded` + viewer-meta 로드 결합)에서 1회 호출. 신규 ptype·resume·viewer 복귀·직접 URL·새로고침·PWA 복귀·다듬기 직접 진입 **전부 동일 판정**.
- **게이트 실패**(데이터 로드 오류·판정 불가) → 안전하게 `readOnlyMaker` 또는 오류 화면(편집 비활성).

## 6. 프로젝트 편집 세션 스키마 (재게시)
- `editSession` 필드 = §3. `mode`로 진행 맥락 구분(normal/thoughtCompass/tutorial).
- **현재 세션 판정 위치**: `editSession` 단일 노드(팀당 1개)가 권위. 장면별 `locks`와 **독립**(브랜치 편집 lock은 그대로, compass/단일권한은 editSession이 상위 게이트).

## 7. 세션 획득 transaction
`editSession` 노드 transaction(viewerTryLock 패턴 참고, viewer-locks.js:129):
- `current == null` → **획득**: ownerId=auth.uid, ownerSessionId=local, generation=1, acquiredAt/heartbeatAt=ServerValue.TIMESTAMP, mode 지정.
- `current.ownerSessionId === localSessionId` → **갱신**(heartbeatAt 서버시각만 갱신).
- `current.ownerId === auth.uid && ownerSessionId 다름`(=같은 사용자 다른 탭) → **재획득 허용**: ownerSessionId=local, **generation+1**(이전 탭 무효화 → "마지막 활성 탭만 편집", §10).
- `current.ownerId 다름 && heartbeat 신선`(serverNow−heartbeatAt ≤ 180s) → **abort → 읽기전용**.
- `current.ownerId 다름 && heartbeat 만료`(>180s) → mode별:
  - normal → 확인형 takeover 허용, generation+1.
  - thoughtCompass → **확인형 takeover 허용(만료 후에만)**, generation+1, 저장된 currentScreen/draft부터 재개.
- **교사 override** → mode 무관 강제 takeover, generation+1.
- 동시 경쟁: transaction 원자성으로 1명만 commit, 나머지 재시도→읽기전용.

## 8. heartbeat와 만료 (서버 시각 전략)
- **갱신**: 30초 주기 + 주요 저장·조작 시. write 시 `heartbeatAt = firebase.database.ServerValue.TIMESTAMP`(서버 시각 기록).
- **만료 판정 시각 우선순위**:
  1. **Rules `now`**(서버 ms) — 다른 사용자 takeover write 시 `data.child('heartbeatAt').val() < now - 180000` 검증 → **3분 만료를 Rules가 직접 강제 가능**(§12 Q3=가능).
  2. **클라 판정**: `.info/serverTimeOffset` 1회 구독 → `serverNow = Date.now() + offset` 으로 UI/transaction abort 판정.
  3. 순수 `Date.now()` **단독 사용 금지**(기기 시계 오차).
- **이유 문서화**: RTDB transaction(클라)은 서버 시각을 비교식에 직접 주입 불가하나, ① write는 ServerValue.TIMESTAMP로 서버 시각 저장 ② 읽는 클라는 offset 보정 ③ Rules는 `now`로 backstop. 잔여 위험: offset 자체가 약간 stale일 수 있으나 경계는 작고, 최종 권위는 Rules의 `now`.
- `onDisconnect()` 미사용(현재) → 세션 정리 보강 권장(비정상 종료 시 heartbeat stop으로 3분 후 만료가 정리).

## 9. 생각 나침반 진행 중 이전 제한
`editSession.mode === 'thoughtCompass'`일 때:
- 권한 요청 버튼 숨김/비활성, 현재 편집자의 **자발적 넘기기 금지**.
- heartbeat 유효 중 takeover **금지**(다른 사용자).
- heartbeat 만료(>3분) 후에만 **확인형 takeover** 허용 → 저장된 currentScreen/draft부터 재개, **이전 session generation 무효화**.
- **교사 세션 해제만 예외**(언제든).

## 10. 중복 탭 처리
- `ownerSessionId` = 탭별 UUID(sessionStorage). 같은 계정 다른 탭 = 다른 ownerSessionId.
- **마지막 활성 탭만 편집**(R/X7): 탭이 focus/visibility 획득 시 §7의 "같은 ownerId 재획득" transaction → generation+1 → 이전 탭은 listener로 generation 변화 감지 → **읽기전용 전환**(다음 write/heartbeat에서 차단). 적대적 takeover(다른 사용자, 신선)와 구분됨.

## 11. 읽기 전용 3계층 방어
1. **UI**: 입력 readonly/disabled, 추가·삭제·연결·업로드·드래그·AI 차단. 화면 이동·확대·축소·보기 허용. 재사용: `body.viewer-edit-readonly`(viewer-edit.js:973) + 신규 `body.maker-readonly`/`body.access-pending`.
2. **Client write guard**: 공통 `guardedWrite(path, value)` — `editSession.ownerSessionId === localSessionId && generation === localGeneration` 확인 후에만 write. Phase 0 최소 방어 범위 = ① 중앙 push(`_flushPushToFirebaseNow`/`pushToFirebase`) ② 신규 writingGuide/onboarding/editSession write ③ lock/session write. **분산 legacy write**는 점진적으로 guard로 감싸되, Phase 0은 위 중앙 경로 우선(나머지는 Rules backstop으로 1차 방어).
3. **Firebase Rules**: editSession 소유자(auth.uid)+generation+교사 override 검증(§12).

## 12. Firebase Rules 설계 초안 (수정 아님, 설계만)
보호 경로: `writingGuide`·`onboarding`·`editSession`·`scenes`·`viewer-meta`(작품 설정).

질문별 답:
1. **editSession 획득 허용 대상**(SEC-01 반영): **팀 소속 증명 보유자만**. CF가 PIN을 서버 검증해 `classes/{classId}/teams/{enc}/members/{auth.uid}=true` 발급 → editSession 획득 Rules가 `root.child('.../members/'+auth.uid).exists()` 요구. → **타 팀 세션 선점 레이스 = Phase 0에서 해소**(경로만 아는 외부 인증 사용자는 members 없어 획득 불가). scenes 전면 membership은 후속(현재 scenes는 open write 유지).
2. **유효 세션 중 타인 overwrite 차단**: 보호 경로 `.write`에 `root.child('.../editSession/ownerId').val() === auth.uid` (또는 교사) 요구. 다른 사용자 write 거부.
3. **heartbeat 만료를 Rules만으로 판정**: **가능**. Rules `now`(서버 ms)로 `data.child('editSession/heartbeatAt').val() < now - 180000`이면 takeover write 허용. 3분 만료는 Rules가 권위 판정.
4. **CF 필요성**: 만료 판정엔 불필요(Rules `now`+transaction 조합 충분). 단 계정 익명화·중앙 집계는 후속 CF 후보.
5. **teacher override 판정**: `auth.token.role === 'teacher' || 'super_admin' || root.child('classes/'+$classId+'/meta/teacher_uid').val() === auth.uid`(기존 패턴 재사용).
6. **읽기전용 사용자**: read 허용/write 차단 = 보호 경로 `.read:true`(현행 유지) + `.write`에 owner+generation 요구로 달성.

초안(개념, 실제 미적용):
```
// SEC-01: 모든 분기에 팀 소속(members) 또는 교사 요구
editSession: {
  ".write": "auth != null && (
     ( root.child('classes/'+$classId+'/teams/'+$team+'/members/'+auth.uid).val() === true && (
         !data.exists()                                        // 최초 획득(팀 소속자만)
         || data.child('ownerId').val() === auth.uid           // 본인 갱신/재획득
         || data.child('heartbeatAt').val() < now - 180000 ) ) // 3분 만료 takeover
     || auth.token.role === 'teacher' || auth.token.role === 'super_admin'
     || root.child('classes/'+$classId+'/meta/teacher_uid').val() === auth.uid )"
}
writingGuide, onboarding, scenes, viewer-meta: {
  ".write": "auth != null && (
     root.child('.../editSession/ownerId').val() === auth.uid  // 활성 세션 소유자
     || !root.child('.../editSession/ownerId').exists()        // 세션 없을 때(레거시 호환)
     || auth.token.role === 'teacher' || ... teacher_uid )"
}
```
- **솔직한 한계**: ① Rules는 **탭 단위 ownerSessionId 검증 불가**(auth엔 탭 식별 없음) → ownerSessionId/generation 일치는 client guard가 담당, Rules는 ownerId(사용자)까지만. ② members 부재로 **최초 세션 선점 레이스**는 Rules로 못 막음. ③ generation 단조 증가 강제는 `newData.generation > data.generation` 조건으로 일부 가능하나 takeover/재획득 분기와 얽혀 정밀 설계 필요.
- **중단 조건 없음**: 3분 만료·소유자 write 방어·교사 override는 Rules로 안전 달성 가능. members 레이스만 잔여(명시적 후속 SECURITY로 분리, Phase 0 차단 사유 아님).

## 13. 교사 override
- 기반: `auth.token.role`(custom claim) + `meta/teacher_uid` (firebase.js:344 `isTeacher()`, Rules 동일 패턴).
- 권한: 세션 강제 해제·긴급 강제 완료·전체 초기화. 학생 답변 원문 직접 수정은 미제공(D-20). 관리모드는 구조만 읽음(`_analyzeTeam` adminConsole.js:713) → 상태 표시 시 원문 비노출 유지.

## 14. 전체 set·복사·삭제 유실 방지
- **scenes set**(firebase.js:990)은 scenes 노드만 → writingGuide/onboarding/editSession(형제) 비침범. **신규 노드 scenes 하위 금지** 규칙 명문화.
- **팀 루트 전체 set 금지**(현재 미발견, 회귀 가드 필요).
- **import/export**(ui.js `importJSON`:502/`exportJSON`:471): scenes 범위인지 **Phase 1 전 확인 필요**(팀 root 재구성이면 위험) — 코드 포인트 기록.
- **복사**(redeemCopyCode:1172): scenes+viewer-meta만 → writingGuide/onboarding/editSession 자연 제외. 단 viewer-meta 복사 시 **onboardingVersion도 복사되면 안 됨** → 복사 경로에서 onboardingVersion은 신규 정책으로 **재부여**(text/picturebook=1), writingGuide/editSession 미승계 → compass 재요구(§15 복사).
- **삭제**(_deleteTeam:1497): 팀 root remove → 모든 형제 함께 삭제(R27 충족). 강확인(이름 재입력) 기존 패턴 재사용.

## 15. 계정 삭제 익명화 방향
- writingGuide 내용 = **팀 공동 데이터로 유지**.
- `ownerId`·`lastEditorId` 등 **사용자 식별값만 익명화**(uid→null/'anonymized'). `ownerLabel`은 **비-PII(역할/번호)로 제한**, 이름·계정 미저장.
- **계정 삭제 함수 현재 미발견(UNKNOWN)** → 실제 익명화는 **후속 관리 Phase로 분리**. Phase 0는 "식별 필드를 최소·고립 배치해 향후 국소 필드 wipe로 익명화 가능"까지만 보장.

## 16. 오류·fallback
- 데이터 로드 실패/판정 불가 → `readOnlyMaker`/오류 화면(편집 비활성, §5).
- editSession 획득 실패(네트워크) → 읽기전용 + 재시도(makerSession 패턴).
- ServerValue.TIMESTAMP write 실패 → 저장 상태 'error'(기존 setSaveStatus, firebase.js:1051) + sessionStorage 보관.
- offset 미수신 → 보수적으로 만료 판정 보류(takeover 금지) → 안전측(현 편집자 유지).

## 17. 구현 파일 후보 표
| 역할 | 현재 파일/함수 | 향후 변경 유형 | 위험 |
|------|------|------|------|
| 프로젝트 진입 게이트 | ui.js `_enterMakerAfterPtypeSelected`(:649)·firebase.js `_enterTeam`(:599)/`_resumeTeamFromSession`(:525) | `resolveProjectAccessState`/`applyProjectAccessState` 신규 + 데이터로드 완료 단일 훅 | 우회 경로 누락 시 게이트 무력 |
| session manager | (신규 모듈) | `project-session.js` 신규(획득/갱신/해제/listener) | 장면 lock과 책임 혼선 |
| Firebase session transaction | viewer-locks.js `viewerTryLock`(:127) 패턴 | editSession transaction 신규 | 원자성·경쟁 |
| heartbeat | viewer-locks.js `startViewerEditSession`(:266) | 30s + ServerValue.TIMESTAMP + serverTimeOffset 신규 | 클라 시각 오차 |
| common write guard | firebase.js `pushToFirebase`(:968)/`_flushPushToFirebaseNow`(:980) | `guardedWrite` 래퍼, 중앙 push 우선 | 분산 legacy write 누락 |
| Rules | database.rules.json | writingGuide/onboarding/editSession/scenes/viewer-meta 규칙 추가 | members 부재·탭 검증 불가 |
| admin override | adminConsole.js `_deleteTeam`(:1497 강확인)·`_teamCardHtml`(:1062)·`_analyzeTeam`(:713) | 세션 해제·강제 완료·상태 표시 | 원문 노출 0 유지 |
| project create | ui.js `_enterMakerAfterPtypeSelected`(:649) | onboardingVersion set(text/picturebook만) | movie 제외 누락 |
| project copy | firebase.js `redeemCopyCode`(:1172) | onboardingVersion 재부여·writingGuide 미승계 | 형제 누락/오승계 |
| project delete | adminConsole.js `_deleteTeam`(:1497) | 팀 root remove가 커버(변경 최소) | — |
| sessionStorage tab ID | firebase.js `makerSession`(:612) 패턴 | `ownerSessionId=crypto.randomUUID()` 탭별 | 탭 구분 실패 |
| access state UI class | viewer-edit.js `body.viewer-edit-readonly`(:973) | `body.maker-readonly`/`body.access-pending` 신규 | 잔존 활성 요소 |

## 18. Phase 0 테스트 계획
**세션**: A 획득 / B 읽기전용 / A heartbeat 유지 / A 3분 이탈 / B 확인 후 takeover / A 복귀→읽기전용 / 두 학생 동시 transaction(1명만) / 동일 계정 두 탭(마지막 탭 편집) / 오래 열린 탭 stale generation write 차단.
**게이트**: 신규 그림책·텍스트 → 생각 나침반 / 신규 무비 → 기존 흐름 / 기존 그림책·텍스트 → 선택 실행(제작 차단 없음) / 직접 URL·새로고침·viewer 복귀·PWA 복귀·다듬기 직접 진입 → 동일 판정(무플래시).
**Rules**: 편집자 write 허용 / 읽기전용 write 거부 / 다른 팀 write 거부 / 교사 override / stale generation write 거부 / editSession 획득 경쟁 / 3분 만료 takeover 허용·신선 takeover 거부.
**데이터 유실**: scenes 전체 set 후 writingGuide 유지 / 복사 시 writingGuide 제외·onboardingVersion 재부여 / 삭제 시 형제 포함 삭제 / 기존 프로젝트에 onboardingVersion 자동 추가 안 됨.

## 19. 아직 확인할 위험
- import/export(`importJSON`/`exportJSON`)가 팀 root를 재구성하는지 — Phase 1 전 정밀 확인.
- members 스키마 부재로 최초 세션 선점 레이스(SECURITY 후속).
- 계정 삭제 함수 부재(UNKNOWN) — 익명화 후속 Phase.
- 학생 익명 Auth에 generation 단조성 Rules 강제의 정밀 조건(takeover/재획득 분기).
- 모든 진입이 수렴하는 "데이터 로드 완료" 단일 지점 실측(PWA/뒤로가기 포함).

## 20. Phase 0 완료 조건
✔ 데이터 경로 확정(§3) ✔ session 스키마 확정(§6) ✔ server-time 전략 확정(§8) ✔ transaction 획득 규칙 확정(§7) ✔ generation/stale-write 방어 확정(§7·11) ✔ 신규·기존 판정 확정(§4) ✔ 단일 게이트 흐름 확정(§5) ✔ Rules 가능/불가 범위 확정(§12) ✔ 교사 override 기반 확정(§13) ✔ 복사·삭제·전체 set 안전성 확정(§14) ✔ 구현 파일 후보 확정(§17) ✔ 테스트 계획 확정(§18). **SEC-01 결정으로 editSession 선점 레이스도 Phase 0 범위(membership 기반)로 해소** → Phase 0 구현 준비 완료. §19 import/export 확인은 생명주기 감사에서 **RESOLVED**(scenes 범위 확정).

## 21. 선결정 반영 (구현 기준, 2026-06-24)
- **PRE-01**: `clearAll`(ui.js:497)은 현행 그대로 — scenes만 비우고 **writingGuide/onboarding/editSession 유지**. 추가 코드 불필요(형제 비침범).
- **PRE-02**: 복사(redeemCopyCode)는 현행 그대로 — viewer-meta 통째 복사로 onboardingVersion 운반 → 복사본 compass **항상 강제**. 추가 코드 불필요.
- **PRE-03**: 교사 "생각 나침반 초기화" 액션은 **`writingGuide/preWriting`만 초기화(status=notStarted)** 기본, **튜토리얼 동시 초기화는 교사 선택 옵션**(`onboarding.tutorialStatus`는 기본 보존). editSession은 mode='normal'로 조정 또는 유지.
- **PRE-04**: 완료 시 `writingGuide/preWriting`에 **개인 ID 미보존**(작성자는 비-PII ownerLabel만). `editSession`은 임시 운영 데이터(만료·삭제). 잔존 식별값(있다면)은 계정 삭제 시 자동 익명화 — 계정 삭제 함수는 후속 관리 Phase.
- **SEC-01 (Phase 0 신규 범위)**: **membership 기반** 구축 —
  - CF 신규 `joinTeamMembership(classId, team, pin)`: PIN **서버 검증** 후 `classes/{classId}/teams/{enc}/members/{auth.uid}=true`(+timestamp) write. 학생 입장(PIN 통과) 흐름에 연결.
  - Rules: `editSession` 획득은 members 보유자만(§12). writingGuide/onboarding write도 members 또는 editSession owner 요구.
  - **scenes 전면 membership 강화는 제외**(기존 학생 쓰기 흐름 회귀 위험) → 별도 횡단 Security Phase.
  - 신뢰 경계: members 발급은 **CF만**(PIN을 client가 우회 못 함), Rules는 members 존재만 확인. 구현 파일 후보(§17)에 `joinTeamMembership` CF + members Rules 추가.
