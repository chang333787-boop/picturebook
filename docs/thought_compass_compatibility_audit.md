# 생각 나침반 구현 적합성 감사

> read-only 감사. 앱 코드·Rules·Functions 미수정. PRD( [docs/thought_compass_prd.md](thought_compass_prd.md) ) 기준선과 현재 repo 구조의 수용 가능성 판정.

## 1. 기준 PRD와 commit
- 기준 PRD: `docs/thought_compass_prd.md` — commit **`1baabfe`** ("Document thought compass product requirements") push 완료.
- 본 감사 문서는 **commit하지 않음**(검토용). 감사 중 앱 코드/Rules/Functions 0줄 수정.
- PB-MOOD viewer WIP 5파일은 손대지 않음(B7에서 checksum 검증).

## 2. 현재 시스템 구조 요약
- **정본 경로(v2)**: `classes/{classId}/teams/{teamEncoded}/...`, `DATA_PATH_VERSION='v2'` (firebase.js:282). `teamEncoded = encodeURIComponent(teamName)`. v1 레거시 `teams/{teamEncoded}/...`도 코드상 공존.
- **팀 노드 자식**: `scenes`, `viewer-meta`(projectType 등), `locks`(장면별), `pin`, `account`. 즉 "프로젝트" = **팀 노드**.
- **projectType**: `viewer-meta/projectType` ∈ {text, picturebook, movie, experience} (state.js:21, 기본 picturebook). 신규/기존 구분 **전용 필드 없음** — viewer-meta.projectType 존재 여부로 암묵 판별.
- **진입/생성**: `_enterTeam()` (firebase.js:599) → viewer-meta once → 없으면 `showPtypeScreen` (ui.js:601~650) → 선택 후 maker 활성. 복사 `redeemCopyCode()` (firebase.js:1172, scenes+viewer-meta 멀티패스 update). **팀 단위 삭제 함수 없음**(장면별 `deleteScene` / admin `_deleteTeam`이 팀 root remove).
- **세션/식별**: 익명 Auth uid + `branch_device_id`(localStorage, editorId) + `instanceId`(탭별 random). 같은 계정 2탭 구분 가능(`classifyLockOwner`, viewer-locks.js:88).
- **저장**: scene push 600ms debounce (firebase.js:973), title/body 400ms (ui.js). beforeunload/pagehide flush (firebase.js:1008). 저장상태 표시 `setSaveStatus` (firebase.js:1051). `.info/connected` 사용(firebase.js:831). `onDisconnect()` **미사용**.
- **AI**: Firebase onCall 함수 `callTextAiBatch`/`callTextAiBatchS2`/`callWorkCheck` (functions/index.js, Haiku 4.5). 11겹 검증 게이트 `_validateRequest`(:329), 출력 JSON allowlist/BANNED_KEYS(:911), 쿼터/킬스위치/origin검증, timeout 50s/refund.
- **Rules**: `database.rules.json` 존재. teams/scenes/locks/viewer-meta `.write: "auth != null"` — **소유권·잠금·읽기전용 미검증**.

## 3. 재사용 가능한 기반 (그대로 또는 소폭)
- **debounce/flush**: scene push 600ms·title/body 400ms·`_queueDebounceSave`(viewer-edit.js:1578, 300ms)·beforeunload/pagehide flush — 700ms draft·다음 flush·메모 저장에 그대로 응용.
- **sessionStorage 복구**: `makerSession`(firebase.js:612, 2h TTL, ?resume=1, PIN 재검증) — 네트워크 fallback·draft 복원 패턴 재사용.
- **잠금 원자성·heartbeat·탭 구분**: `viewerTryLock` transaction(viewer-locks.js:129), heartbeat 5s(:266), `classifyLockOwner`(self-tab/same-device/other) — 프로젝트 레벨 세션으로 확장 가능.
- **읽기 전용 표현**: `body.viewer-edit-readonly`(viewer-edit.js:973)·`ViewerState.editMode`·lock 변경 listener(`_installLockChangeHandlerOnce` viewer-edit.js:1144) — 읽기전용 전환에 재사용.
- **모달/팝오버**: ptype-screen·copy-code-modal(배경클릭 닫기 ui.js:742)·edit-*-popover(ESC 닫기) — 전체화면 게이트·요약 서랍 패턴.
- **툴바**: `#btn-check`(.tb-check-group, maker.html:2892) 옆에 🧭 버튼. 반응형 2240/1024 breakpoint.
- **AI 검증/쿼터 인프라**: `_validateRequest`·JSON 검증·refund — 신규 compass 엔드포인트가 동일 게이트 재사용.
- **관리모드**: `_analyzeTeam`(adminConsole.js:713, **body 미열람=구조만**)·`_teamCardHtml`(:1062) 확장. admin v2 로드 `_loadAdminDataV2`(:198).

## 4. PRD 요구사항별 적합성 표

| ID | PRD 요구사항 | 현재 기반 | 판정 | 근거 파일/함수 | 선행 작업 |
|----|------|------|------|------|------|
| R1 | 신규 프로젝트 강제 게이트 | ptype-screen 진입 흐름 | SMALL_EXTENSION | ui.js:601~650, firebase.js:637 | ptype 선택 직후 게이트 삽입 |
| R2 | 기존 프로젝트 선택 시작 | 기존=viewer-meta 존재로 판별 | SMALL_EXTENSION | firebase.js:646, ui.js:602 | 선택 시작 진입점·미강제 |
| R3 | onboardingVersion | 전용 필드 없음 | SMALL_EXTENSION | (없음) | writingGuide에 신규 필드 write |
| R4 | 질문 7개 상태 복구(화면단계) | resume infra 존재, 상태 스키마 없음 | FOUNDATION_REQUIRED | firebase.js:612, ui.js:1203 | writingGuide 상태 스키마 신설 |
| R5 | draft 700ms 저장 | 400/600ms debounce 존재 | SMALL_EXTENSION | firebase.js:973, viewer-edit.js:1578 | 700ms 변형 추가 |
| R6 | 다음 버튼 flush 확정 | flush 패턴 존재 | READY | firebase.js:1008, `_flushPendingSave` | — |
| R7 | sessionStorage fallback | makerSession 패턴 | READY | firebase.js:612 | 질문별 키 추가 |
| R8 | AI 후속 질문 | onCall+검증 인프라 | SMALL_EXTENSION | functions/index.js:329,1342 | `callCompassJudgment` 신설 |
| R9 | AI JSON 검증 | allowlist/BANNED_KEYS 검증 | SMALL_EXTENSION | functions/index.js:911,997 | compass 스키마 검증 추가 |
| R10 | 최종 요약 8초 timeout | 함수 timeout 60s | SMALL_EXTENSION | functions/index.js:50,755 | 클라 8초 타임아웃 신규 |
| R11 | 원답 fallback | 클라 fallback 필요 | SMALL_EXTENSION | functions/index.js:812 | 클라 파싱실패→원답 |
| R12 | 완료 전 제작 우회 차단 | 진입점 다수 | FOUNDATION_REQUIRED | firebase.js:525,588; ui.js:1203 | 전 진입점 게이트 |
| R13 | 튜토리얼 연결 | 버튼→튜토리얼 | SMALL_EXTENSION | (완료화면 버튼) | 튜토리얼 자체는 별도 |
| R14 | 브랜치 재열람 | 툴바+드로어 | SMALL_EXTENSION | maker.html:2892 | 🧭 버튼+우측 서랍 신규 |
| R15 | 다듬기 재열람 | 팝오버 패턴, 드로어 없음 | SMALL_EXTENSION | viewer-edit.js:4702~ | 우측 overlay 서랍 신규 |
| R16 | 새 생각 메모(300자) | `_queueDebounceSave` | READY | viewer-edit.js:1578 | 필드명만 추가 |
| R17 | 단일 편집권한(프로젝트 레벨) | 잠금이 **장면별** | FOUNDATION_REQUIRED | viewer-locks.js:59,129 | 프로젝트 레벨 세션 신설 |
| R18 | 읽기 전용 전환(실시간) | flag+lock listener | SMALL_EXTENSION | viewer-edit.js:973,1144 | 프로젝트 세션 listener |
| R19 | heartbeat | 5s heartbeat 존재 | SMALL_EXTENSION | viewer-locks.js:266 | 30s 재튜닝·프로젝트 레벨 |
| R20 | 3분 이탈 이어받기 | TTL 20s·**클라 Date.now** | SECURITY_REQUIRED | viewer-locks.js:91,825 | 서버 시각(.info/serverTimeOffset) |
| R21 | 중복 탭(마지막 탭만) | instanceId 탭 구분 | SMALL_EXTENSION | viewer-locks.js:42,96 | 프로젝트 세션에 적용 |
| R22 | 교사 상태 확인 | 구조만 읽음·카드 확장 | SMALL_EXTENSION | adminConsole.js:713,1062 | 상태 필드 표시 |
| R23 | 전체 초기화 | admin 리셋·confirm | SMALL_EXTENSION | adminConsole.js:593 | compass 초기화+강확인 |
| R24 | 긴급 강제 완료 | (없음) | SMALL_EXTENSION | adminConsole.js:1062 | 신규 admin 액션 |
| R25 | 세션 해제 | lock release 패턴 | SMALL_EXTENSION | viewer-locks.js:294 | 프로젝트 세션 해제 |
| R26 | 복사 시 초기화 | 복사=scenes+viewer-meta만 | SMALL_EXTENSION | firebase.js:1172 | writingGuide 미승계 확인 |
| R27 | 삭제 시 함께 삭제 | 팀단위 삭제=admin만 | FOUNDATION_REQUIRED | adminConsole.js:`_deleteTeam`(593) | 팀 root remove가 커버 |
| R28 | 계정 삭제 시 익명화 | 계정삭제 흐름 불명 | UNKNOWN | (미발견) | 식별 데이터 설계 필요 |
| R29 | Rules write 방어 | auth!=null만 검증 | SECURITY_REQUIRED | database.rules.json | 소유권·읽기전용·writingGuide 스코프 |

## 5. 데이터 경로 적합성
- **권장 경로 확정**: `classes/{classId}/teams/{teamEncoded}/writingGuide/preWriting` — **적합**. `scenes`의 형제 신규 노드로 안전(viewer-meta 다자식 선례). 신규 노드라 기존 작품엔 null→스키마 파괴 없음.
- ⚠️ `firebase.js:990`의 `dbRef.set()`은 **scenes 루트** 전체 덮어쓰기(더티 0일 때 edge). writingGuide는 scenes의 **형제**이므로 비침범. 단 향후 **팀 루트** 전체 set은 절대 금지(가드 필요).
- 복사(`redeemCopyCode`)는 scenes+viewer-meta만 멀티패스 update → writingGuide 자연 제외(R26 충족).

## 6. 온보딩 게이트 삽입 지점
- **삽입 후보**: ptype 카드 선택 핸들러 `_onPtypeCardClick`/`_enterMakerAfterPtypeSelected`(ui.js:620~671) 직후, maker 활성화 **전**. 신규 전체화면 오버레이(z-index ~1300, `#preview-overlay` 패턴) 진입.
- **신규 판정**: `writingGuide/preWriting/completed` once 조회로 게이트(미완료+미resume → 게이트). onboardingVersion 부여 위치도 동일.
- ⚠️ **우회 경로 다수**(R12, FOUNDATION): maker URL 직접·새로고침(?resume=1)·viewer-edit 직접(`?edit=1&from=maker`)·viewer→maker 복귀(branchReturnContext)·PWA 복귀·뒤로가기. 게이트는 **단일 ptype 분기가 아니라 "편집 활성화 직전" 공통 지점**에서 강제해야 전 경로 커버.

## 7. 편집권한·heartbeat 적합성
- **현 잠금 = 장면별**(`locks/{num}`), PRD는 **프로젝트 레벨 단일 편집자**(생각 나침반 진행 중). → 기존 패턴(editorId/instanceId/transaction/heartbeat/`classifyLockOwner`) **재사용**하되 **신규 프로젝트 레벨 세션 노드**(예: `writingGuide/editSession`) 필요. FOUNDATION.
- **heartbeat**: 5s 존재(R19) → 30s 재튜닝·프로젝트 레벨 적용은 소폭.
- ⚠️ **클라 시각 위험**(R20, 위험3): 만료 판정이 `Date.now()`(viewer-locks.js:91,825), `.info/serverTimeOffset` 미사용. PRD 3분 이탈 판정은 **서버 시각 보정** 필요 = SECURITY/FOUNDATION. `onDisconnect()` 미사용 → 세션 정리 보강 권장.
- **읽기전용 전환**: lock listener(viewer-edit.js:1144) + `body.viewer-edit-readonly` 재사용 가능(R18).

## 8. 질문 화면·재열람 UI 적합성
- **전체화면 질문 오버레이**: 전역 modal manager·focus trap **없음**. 개별 ESC/배경클릭 닫기만 존재. 신규 오버레이는 자체 focus trap 필요(소폭). 마운트는 maker/viewer 모두 z~1300 신규 div.
- **한 화면 한 질문 렌더**: 캔버스 좌표/드래그 바인딩에 의존 → `renderCard`/`_choiceButtonHtml`을 **경량 래퍼**로 감싸 캔버스 밖 렌더(부분 재사용).
- **재열람 서랍**: 우측 드로어 패턴 **없음** → 신규(브랜치=요약 읽기전용, 다듬기=전체). 둘 다 z~110~1300 신규.
- **메모**: `_queueDebounceSave` 그대로(R16, READY).

## 9. AI 함수 적합성
- 신규 `callCompassJudgment`(질문 판정)·`callCompassSummary`(최종 요약)를 기존 3함수 옆에 **독립 onCall**로 추가 가능. `_validateRequest`·쿼터·refund·origin·killswitch 재사용.
- ✅ **작품 본문 미전송 가능**: 기존 `buildUserMessage`(prompts.js:547)는 작품 body 전송이지만, compass 페이로드는 **생각 나침반 답만**(자기완결) 전송하도록 신규 작성 → 본문 노출 0.
- **JSON 검증/허용필드**: 기존 allowlist 패턴(`_validateS1Response` 등)으로 compass 스키마(decision/reasonCode/...) 검증 추가.
- **fallback**: 함수 timeout 60s, 클라 측 8초 타임아웃+파싱 실패→NEXT/원답 fallback은 **클라 구현**(R10·R11). 기존엔 실패→refund 경로라 클라 fallback 신규.

## 10. 관리모드 적합성
- `_analyzeTeam`(adminConsole.js:713)이 **구조만 읽고 body 미열람** → 교사 상태 표시(현재 질문·완료 수·마지막 저장·오류)를 **답변 원문 노출 없이** 구현 가능(TEACHER-01 충족, R22).
- `_teamCardHtml`(:1062) 카드에 compass 상태 섹션 확장. 전체 초기화/세션 해제/긴급 강제 완료는 신규 액션(R23~25).
- ⚠️ **강확인(강한 확인) 패턴 없음** — 현재 `confirm()`만. PRD Y3 강확인 문구는 신규 모달 또는 confirm 활용.

## 11. Rules·보안 위험
- **위험 1 (UI만 읽기전용) 확정**: `database.rules.json`의 teams/scenes/locks/viewer-meta `.write:"auth != null"` — 비편집자 DB write **차단 안 됨**, 잠금 소유권·읽기전용 **미검증**. writingGuide도 부모 규칙 상속(개방). → **R29 SECURITY_REQUIRED**.
- 편집 세션 소유권 검증은 **클라이언트 전용**. 우회 직접 write 가능.
- 교사 override는 meta에 `auth.token.role` 검증 존재하나 팀 scenes엔 없음.
- **필요 보강**(판정만, 수정 안 함): ① writingGuide write를 팀 멤버+편집세션 소유자로 스코프 ② 읽기전용 사용자 write 차단 ③ 교사 override 분기 ④ lock/session과 writingGuide 동시 검증. 멤버십 검증은 `members` 스키마 신설 필요(중간 난도).

## 12. 전체 덮어쓰기·데이터 유실 위험
- **팀 루트 set 전수**: 팀/프로젝트 루트 전체 `set()` **미발견**(양호). 복사는 멀티패스 update(firebase.js:1220).
- ⚠️ **scenes 루트 set**: firebase.js:990 더티 0 edge에서 scenes 전체 set — writingGuide는 형제라 비침범이나, **scenes 하위에 compass 데이터를 두면 유실**되므로 반드시 `writingGuide`(형제)에 둘 것.
- `onDisconnect()` 미사용 → 비정상 종료 시 세션 잔류, TTL로만 정리.

## 13. PRD와 현재 구조의 충돌
- **명시적 CONFLICT 없음.** 단 두 FOUNDATION 격차:
  - **단일 편집권한**: PRD=프로젝트 레벨 ↔ 현재=장면별 잠금. 신규 세션 노드 필요(충돌 아닌 격차).
  - **3분 만료 서버 시각**: PRD=서버 기준 ↔ 현재=클라 Date.now. 보정 필요.
- R28(계정 삭제 익명화)는 현재 흐름 미발견 = UNKNOWN(설계 필요).

## 14. 구현 전 필수 기반 공사
1. **Rules 보강**(R29, R20): writingGuide 스코프 + 읽기전용 write 차단 + 편집세션 소유권 + 교사 override. (UI 차단만으로 불가.)
2. **서버 시각 기반**: `.info/serverTimeOffset` 도입(3분 만료·heartbeat 판정).
3. **프로젝트 레벨 편집 세션** 노드 설계(장면별 잠금과 분리).
4. **writingGuide 상태 스키마** 확정(answerStatus/currentScreen 등 PRD STATE/DATA).
5. **우회 차단 공통 게이트 지점**(편집 활성화 직전) 확정.
6. **팀 루트 set 금지 가드**(회귀 방지) + compass는 scenes 형제 고정.

## 15. 추천 구현 Phase 순서 (큰 범주만)
- **Phase 0 — 기반·보안**: Rules 보강, .info/serverTimeOffset, 팀루트 set 가드, writingGuide 경로/스키마 확정.
- **Phase 1 — 상태·저장**: writingGuide 상태(answerStatus/currentScreen), 700ms draft, 다음 flush, sessionStorage fallback, onboardingVersion.
- **Phase 2 — 강제 온보딩 질문 화면**: 전 진입점 공통 게이트, 전체화면 오버레이(focus trap), 한 질문 카드.
- **Phase 3 — AI 후속 질문·요약**: callCompassJudgment/Summary(본문 미전송), JSON 검증, 8초 timeout, 원답 fallback.
- **Phase 4 — 재열람**: 브랜치 🧭 버튼+요약 서랍, 다듬기 전체 서랍, 새 생각 메모.
- **Phase 5 — 단일 편집권한**: 프로젝트 레벨 세션, heartbeat 30s, 3분 이어받기(서버시각), 읽기전용 전환, 중복 탭.
- **Phase 6 — 교사 관리**: 상태 확인(원문 비노출), 전체 초기화, 긴급 강제 완료, 세션 해제, 강확인.
- **Phase 7 — 튜토리얼 연결**: 완료 화면 버튼 → 제작 튜토리얼.
- **Phase 8 — 통합 QA**: 복사/삭제/계정삭제·우회 회귀·Rules 침투 테스트.
- 의존성: Phase 5는 Phase 0(서버시각·Rules) 선행. Phase 2는 Phase 1 선행.

## 16. 아직 확인이 필요한 사항
- 계정 삭제/탈퇴 흐름(R28) — 코드 미발견. 식별 데이터(uid/device id) 익명화 설계 필요.
- 멤버십(`members`) 스키마 부재 — Rules의 "팀 멤버만 write" 강제에 필요. 신설 범위 결정 필요.
- 학생/교사 **role 토큰** 발급 방식(`auth.token.role`)이 학생에도 적용되는지(현재 teacher/super_admin만 확인).
- PWA 복귀·뒤로가기에서 편집 활성화 정확한 단일 지점(게이트 삽입 1점 보장) 실측 필요.
- 프로젝트 레벨 세션과 기존 장면별 lock 동시 운용 시 UX 충돌(브랜치 편집 lock vs compass 진행) 정합성.
