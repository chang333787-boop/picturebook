# 생각 나침반 데이터 생명주기 감사

> read-only 감사. 앱 코드/Rules/Functions 0줄 수정. Phase 0 설계의 선결 조건(import/export·복사·초기화·삭제가 신규 노드를 유실·오염하지 않는지) 확정.

## 1. 목적과 기준 commit
- 기준: PRD `1baabfe` · 적합성 감사 `39c0c3b` · Phase 0 설계 `ff776d2`.
- 대상 신규 노드: `writingGuide/`·`onboarding/`·`editSession/` (모두 팀 노드의 scenes 형제).
- 본 문서 **미커밋**. PB-MOOD WIP 보존(B17 검증).

## 2. 현재 팀 데이터 정본
| 데이터 | 실제 RTDB 경로 | 생성/쓰기 | 삭제 |
|------|------|------|------|
| scenes | `classes/{classId}/teams/{enc}/scenes` | `_flushPushToFirebaseNow`(firebase.js:980: 더티0→`dbRef.set` / 더티→`dbRef.update`), `dbRef=teamRef.child('scenes')`(622) | 장면별 `dbRef.child(num).remove()`(1025) |
| viewer-meta | `.../viewer-meta` | `projectType` child set(ui.js:669, viewer-data.js:124), `.update`(viewer-edit.js:2817), `isPublic` child set(adminConsole.js:1197) | 팀 삭제 시 |
| projectType | `.../viewer-meta/projectType` | ui.js:669 child set | — |
| locks(장면별) | `.../locks/{num}` | transaction(viewer-locks.js:129), heartbeat update | `lockRef.child(num).remove`(826) |
| pin/account | `.../pin`, `.../account` | child set(firebase.js:402, adminConsole.js:649) | 팀 삭제 시 |
| 팀 전체 | `classes/{classId}/teams/{enc}` | (루트 통째 set **없음**) | `db.ref(teamPath).remove()`(adminConsole.js:1524, `_deleteTeam`) |

신규 3경로(`writingGuide/preWriting`·`onboarding`·`editSession`)는 모두 scenes의 **형제** → 현재 생명주기와 **정합**(아래 전수 결과).

## 3. 쓰기 경로 전수 요약
- **팀 루트 전체 `set()` = 없음**(전수 확인). 팀 루트 `remove()` = admin `_deleteTeam`의 의도된 전체 삭제 1곳뿐(adminConsole.js:1524).
- scenes 노드 전체 `set()` = `_flushPushToFirebaseNow` 더티0 분기(firebase.js:990) — **대상은 `teamRef.child('scenes')`뿐**, 형제 비침범.
- viewer-meta 쓰기 = 모두 child set 또는 `.update`(merge) — viewer-meta **통째 덮어쓰기는 복사 초기화 1곳**(redeemCopyCode, dst 빈 슬롯).
- import/export/clearAll = 전부 **scenes 범위**(아래 §4·§7·§8).
- restore/backup 함수 = **없음**(NOT_FOUND).

## 4. 신규 프로젝트 생성
순서(실측): `_onPtypeCardClick`(ui.js:620) → `_enterMakerAfterPtypeSelected`(ui.js:649) → 신규면 `viewer-meta/projectType.set(ptype)`(669) → `savedNewProjectType=true` → text/picturebook면 기본 10장면 생성(688~).
- `savedNewProjectType` = **메모리 변수**(영속 아님). 새로고침 후 신규 여부 재판정은 **viewer-meta/projectType 존재 여부**로 함(firebase.js:637). → onboardingVersion 도입 시 영속 판정은 viewer-meta 필드가 담당.
- 실패 가능성: projectType set 실패 시 alert 후 return(잘못된 모드 진입 차단, ui.js:674). projectType 저장 ↔ 10장면 생성 사이 중단 시 **projectType만 박히고 장면 0** 상태 가능(반쯤 생성). 현재도 존재하는 조건, 가드(meta 플래그+once-recheck)로 빈 작품 제외.
- **onboardingVersion 삽입 시점**: `_enterMakerAfterPtypeSelected`의 `savedNewProjectType && (text||picturebook)` 분기 = 정확한 지점. movie/experience 제외.
- **원자성 후보**: 현재 `viewer-meta/projectType.set` 1콜 → onboardingVersion·preWriting.status=notStarted를 **한 번의 multi-location `update`**로 묶는 것 **가능**(`db.ref().update({ '.../viewer-meta/projectType':p, '.../viewer-meta/onboardingVersion':1, '.../writingGuide/preWriting/status':'notStarted' })`). 팀 루트 미접근·child 경로만. → **SMALL_CHANGE**.

## 5. 기존 프로젝트 재입장
- `_resumeTeamFromSession`(firebase.js:525) → `_enterTeam(..., {skipPtypeScreenIfExisting:true})`(568/588) → viewer-meta 존재 시 ptype 화면 건너뜀.
- 신규 노드 영향 **없음**(읽기 위주). 게이트 판정은 §Phase0 단일 훅에서 viewer-meta(projectType+onboardingVersion) + writingGuide/preWriting.status once로 수행 → **SAFE**.

## 6. 프로젝트·템플릿 복사
- **유일 복사 경로** = `redeemCopyCode`(firebase.js:1172). 별도 "교사 템플릿 복사" 함수 **없음**(교사가 템플릿 팀 생성→복사코드 발급→학생 redeem, 동일 경로).
- 동작: src `scenes`+`viewer-meta`만 once → dst **빈 슬롯(scenes 없음)만** 허용(1193) → `db.ref().update({ dst/scenes, dst/viewer-meta })`(1221~1223, child 경로). isPublic:false 강제, copiedFrom 부착.
- 신규 노드 처리: **writingGuide/onboarding/editSession 미복사**(scenes·viewer-meta만 운반). dst는 빈 슬롯이라 이들 부재.
- **onboardingVersion 운반**: viewer-meta **통째 복사**라 src의 `onboardingVersion`이 dst로 자동 운반 → dst는 onboardingVersion 있음 + writingGuide 없음 → `resolveOnboardingState` = **COMPASS_REQUIRED**. **R26(복사 시 compass 재요구) 자연 충족**, redeemCopyCode 수정 불필요.
- → **SAFE_WITH_EXCLUSION**(writingGuide/editSession 자연 제외, onboardingVersion 자동 운반). 교사 템플릿 vs 학생 복사 정책 차이: 현재 동일 경로·둘 다 compass 재요구가 합당 → 차별 근거 없음. 단 "교사 템플릿은 compass를 건너뛰게 하고 싶다"면 PRD 외 정책 → **NEEDS_DECISION(낮음)**.

## 7. import·export·restore
- **export**(`exportJSON` ui.js:506): in-memory `scenes`만 직렬화(`{teamName, savedAt, scenes}`), 팀 노드 미읽음. writingGuide/onboarding/editSession **미포함** → **SAFE**(누설 0).
- **import**(`importJSON` ui.js:526): 파일 JSON→`scenes` 교체→`_afterMutation`→`_flushPushToFirebaseNow`(scenes 노드 set). **scenes 노드만 교체**, 형제(writingGuide/onboarding/editSession) **보존**. 기존 팀 데이터 선삭제 없음·rollback/backup 없음·관리자 전용 아님(maker 파일 로드). 알 수 없는 신규 형제 필드 보존됨(접근 안 하므로). → **SAFE_IF_SIBLING**(신규 노드가 scenes 형제인 한 안전).
- **restore/backup**: 함수 **없음** → **NOT_FOUND**. (팀 루트 통째 복원 경로 부재 = editSession 부활 위험 없음, §11.)
- 신규 프로젝트 생성과 import 구분: import는 기존 maker 세션 안 파일 로드(빈/기존 무관), 생성 흐름과 별개.

## 8. 초기화 경로
| 작업 | scenes | writingGuide | onboarding | editSession |
|------|------|------|------|------|
| 장면 전체 초기화(`clearAll` ui.js:497) | `scenes={}`→scenes 노드 비움 | **유지**(미접근) | 유지 | 유지 |
| 생각 나침반 교사 초기화(신규, 미구현) | 유지 | preWriting 초기화 | 정책 결정 | 유지 또는 mode 조정 |
| 작품 새로 만들기 | (빈 슬롯=새 팀) | 없음 | 없음 | 없음 |
| 관리자 팀 초기화 = 팀 삭제(§9) | 삭제 | 삭제 | 삭제 | 삭제 |
- `clearAll`(ui.js:497)은 `scenes={}` 후 _afterMutation → **scenes 노드만** 비움. 형제 보존 = **SAFE**. 단 **장면 초기화 시 writingGuide를 함께 비울지**는 PRD 미규정 → **NEEDS_DECISION**(권장: 유지 — compass는 장면 내용과 독립).
- 데이터 복원 기능 없음.

## 9. 삭제·계정 익명화
- `_deleteTeam`(adminConsole.js:1497): confirm + **팀 이름 정확히 재입력 prompt**(1505) → `db.ref(teamPath).remove()`(1524) = **팀 루트 통째 삭제**. → writingGuide/onboarding/editSession **함께 삭제**(R27 자연 충족). **SAFE**.
- 강확인 = 이름 재입력(이미 존재, 재사용 가능). 장면 삭제(`dbRef.child(num).remove`)와 프로젝트 삭제는 경로상 명확히 구분. Storage 이미지 삭제는 별도(이 감사 범위 밖, 변화 없음).
- 삭제 실패 시 부분 잔존: `remove()`는 단일 경로 원자 — 팀 루트 remove는 일괄. 부분 잔존 위험 낮음.
- **계정 삭제 익명화**: 익명 계정 삭제 함수 **미발견(NOT_FOUND)**. 팀 삭제와 계정 삭제는 별개 개념(현재 계정 삭제 흐름 없음). → writingGuide 내용은 팀 공동 유지·식별값(ownerId/lastEditorId)만 익명화하는 **후속 관리 Phase 기반 작업으로 분리**. Phase 0은 식별 필드를 최소·고립 배치까지만.

## 10. viewer-meta와 onboarding 위치 비교
| 기준 | A. viewer-meta/onboardingVersion | B. onboarding/version | C. 팀 root/onboardingVersion |
|------|------|------|------|
| 기존 read 재사용 | ✅ viewer-meta once(firebase.js:637)와 동일 1회 | ❌ 별도 read | ❌ 별도 read |
| 의미 명확성 | △ viewer-meta가 이미 projectType 보유(선례 있음) | ✅ 전용 노드 | △ |
| **복사 운반(R26)** | ✅ **viewer-meta 통째 복사로 자동 운반→compass 재요구** | ❌ onboarding 미복사→복사본이 LEGACY로 오판(compass 미강제) | ❌ 미복사 동일 문제 |
| import/export 안전 | ✅ scenes만 export/import라 비침범 | ✅ | ✅ |
| Rules 단순성 | ✅ viewer-meta 노드 기존 | △ 신규 노드 규칙 | △ |
| 기존 코드 침범 | ✅ 최소(projectType 옆) | △ | △ |
- **결론**: **A(viewer-meta/onboardingVersion) 유지 권장** — 특히 **복사 시 자동 운반**으로 R26을 redeemCopyCode 수정 없이 충족하는 유일안. B/C는 복사본이 onboardingVersion을 못 받아 compass 미강제(R26 위반) → 복사 함수 수정 필요. **Phase 0 제안이 실측으로 검증됨.** (단 `version` 의미 분리: viewer-meta.onboardingVersion=프로젝트 출생 표식 / writingGuide.preWriting.version=compass 데이터 스키마.)

## 11. editSession 생명주기
- export 제외: ✅(export=scenes만). 복사 제외: ✅(copy=scenes+viewer-meta만). import 시 제거: 해당 없음(import=scenes만, editSession 형제 보존 — 신규 import엔 애초 없음). restore 시 제거: 해당 없음(restore 부재). 팀 삭제 시 삭제: ✅(팀 루트 remove). 앱 재시작+유효 heartbeat→유지: ✅(RTDB 노드 영속, 같은 ownerId 재획득). 만료 세션→takeover/교사 해제 교체: ✅(§Phase0 transaction). 내용 초기화와 독립: ✅(clearAll는 scenes만).
- **팀 루트 통째 복원 경로 없음** → editSession 부활 위험 **없음**(restore/backup NOT_FOUND). → **SAFE**.

## 12. scenes set 유실 위험
- `_flushPushToFirebaseNow` 더티0 `dbRef.set(cleanScenes)`(firebase.js:990)는 `teamRef.child('scenes')` 대상 → writingGuide/onboarding/editSession(형제) **비침범**. clearAll·import도 이 경로 → 형제 보존.
- **규칙 명문화**: 신규 노드는 scenes 하위 금지(형제 고정), 팀 루트 통째 set 영구 금지(현재 없음, 회귀 가드). → 위험 **회피됨**.

## 13. Rules session 검증의 실제 가능 범위
- 형제 editSession 참조: **가능**(`root.child('classes/'+$classId+'/teams/'+$team+'/editSession/...')`, 기존 teacher_uid 참조와 동일 문법).
- auth.uid === editSession.ownerId: **가능**.
- generation: payload 또는 비교로 **부분 가능** — Rules가 `root...editSession.generation`과 write의 generation을 비교 가능. 단 **accidental-stale(옛 탭 캐시) 방어 한정**, 악의적 owner는 현재 generation 재조회 후 주장 가능 → 적대적 완전 방어는 아님.
- 탭 단위 ownerSessionId: **불가** — ownerSessionId는 **client 주장값(서버 미검증)**. 게다가 익명 auth.uid는 **같은 브라우저 모든 탭에서 동일**(localStorage 지속) → Rules는 같은 사용자 두 탭을 구분 불가.
- 중복 탭 활성 상태 Rules 판정: **불가**(client 전담: ownerSessionId+generation 조정).
- CF 필요: Phase 0엔 **불필요**(client+Rules 조합 충분). 강한 탭 검증 원하면 후속 CF(per-tab 토큰).
- **신뢰 경계 요약**: 서버 검증값 = `auth.uid`뿐. → Rules는 **사용자(ownerId) 경계 + generation accidental-stale**까지. **탭 경계는 client**. Phase 0 §12 결론 타당(generation은 "부분 가능"으로 소폭 정밀화 권장).

## 14. members 부재와 최초 선점 위험
1. 익명 사용자가 classId/teamEncoded를 알면 타 팀 editSession 선점: **가능**(현 Rules `.write:"auth != null"`).
2. 현재 팀 접근 자격 검증: **없음**(auth!=null만). 팀 PIN은 **client 검증만**.
3. auth.uid ↔ 팀 서버 연결: **없음**(membership 레코드 없음).
4. 최초 획득 전 membership Rules 증명: **불가**.
5. scenes 동일 취약성: **YES** — 현재 scenes도 `.write:"auth != null"`로 **동일하게 개방**.
- **판정**: **현재도 심각한 공통 위험**(scenes·writingGuide 공통). 생각 나침반 도입으로 **위험 확대 없음** — 오히려 editSession 소유권(획득 후 ownerId 잠금)은 현 scenes의 완전 개방보다 **강한 방어**. **members/membership token이 완전 해결책**이나 이는 scenes에도 필요한 **횡단 SECURITY 과제** → **후속 Security Phase로 분리, Phase 0 차단 사유 아님**(기존 결론 타당).

## 15. 요구사항별 판정표
| ID | 경로/기능 | 현재 동작 | 신규 노드 영향 | 판정 | 구현 전 조치 |
|----|------|------|------|------|------|
| LIFE-01 | 신규 프로젝트 생성 | projectType child set + 10장면(ui.js:649) | onboardingVersion·preWriting 추가 | SMALL_CHANGE | 생성 multi-update 원자화 |
| LIFE-02 | 기존 프로젝트 재입장 | viewer-meta once로 ptype skip | 게이트 판정만 | SAFE | — |
| LIFE-03 | 학생 작품 복사 | redeemCopyCode scenes+viewer-meta | writingGuide 미복사·onboardingVersion 운반 | SAFE_WITH_EXCLUSION | — |
| LIFE-04 | 교사 템플릿 복사 | redeemCopyCode 동일 경로 | 동일 | SAFE_WITH_EXCLUSION | (템플릿 compass skip 원하면 NEEDS_DECISION) |
| LIFE-05 | import | scenes 노드만 교체(ui.js:526) | 형제 보존 | SAFE_IF_SIBLING | 신규 노드 scenes 형제 유지 |
| LIFE-06 | export | in-memory scenes만 직렬화 | 미포함 | SAFE | — |
| LIFE-07 | restore | 함수 없음 | 없음 | NOT_FOUND | — |
| LIFE-08 | 장면 초기화 | clearAll scenes={}(ui.js:497) | 형제 보존 | SAFE | writingGuide 유지 여부 결정 |
| LIFE-09 | 생각 나침반 초기화 | (미구현) | preWriting 초기화 대상 | SMALL_CHANGE | 교사 초기화 시 onboarding 처리 결정 |
| LIFE-10 | 팀 삭제 | _deleteTeam 팀 root remove(강확인) | 형제 함께 삭제 | SAFE | — |
| LIFE-11 | 학생 계정 삭제 | 함수 없음 | 식별값 익명화 필요 | NEEDS_DECISION | 후속 관리 Phase |
| LIFE-12 | scenes root set | child('scenes') 한정(firebase.js:990) | 형제 비침범 | SAFE | 팀 루트 set 금지 가드 |
| LIFE-13 | viewer-meta | child set/update | onboardingVersion colocate | SAFE | A안 유지 |
| LIFE-14 | onboarding | (신규) | 전용 노드 | SMALL_CHANGE | 튜토리얼 진행 필드 |
| LIFE-15 | editSession | (신규) | export/copy 제외·삭제 포함 | SAFE | — |
| LIFE-16 | 중복 탭 session 증명 | 익명 uid 동일·ownerSessionId client | Rules 탭 검증 불가 | SECURITY_REQUIRED | client generation+ownerSessionId(Phase0 설계대로) |
| LIFE-17 | team membership | auth!=null만(공통) | 최초 선점 레이스 | SECURITY_REQUIRED | 횡단 members 후속 Phase |

## 16. 구현 전 필수 수정
- (선결, Phase 1 착수 전) **신규 노드 3개는 scenes 형제로 고정**·팀 루트 통째 set 금지 가드 명문화.
- 생성 경로(ui.js:649)를 **multi-location update**로 원자화(projectType+onboardingVersion+preWriting.status).
- import/export는 **추가 보호 불필요**(scenes 범위 확인됨). 단 향후 import 포맷에 형제 필드를 넣지 않도록 주의.

## 17. 사용자 결정이 필요한 항목 (NEEDS_DECISION) — **전부 해소(2026-06-24 선결정 인터뷰)**
1. clearAll 시 writingGuide → **유지**(PRE-01). 장면만 비움, 형제 보존.
2. 교사 템플릿 복사 compass 강제 → **항상 강제**(PRE-02). 현 복사 동작과 일치(코드 수정 불필요).
3. 교사 "생각 나침반 초기화" 시 튜토리얼 → **초기화 시 교사 선택, 기본=나침반만 초기화**(PRE-03).
4. 학생 계정 삭제/익명화 → **최소 저장 + 잔존 ID 계정삭제 시 자동 익명화**(PRE-04). 완료 본문에 개인 ID 미보존·editSession 임시·잔존 ID는 자동 익명화. 계정 삭제 함수 자체는 후속 관리 Phase.
5. (신규) **팀 소속 서버 증명** → **SEC-01: membership 기반(CF PIN검증→members 노드)을 Phase 0에 구축하되 editSession 획득에만 적용**, scenes 전면 강화는 별도 횡단 Security Phase. → §14의 "최초 선점 레이스"는 editSession 한정 **Phase 0에서 해소**(membership Rules), scenes는 후속.

## 18. Phase 0 설계 문서 수정 필요 여부
- **정책 변경 없음.** 다음 **선택적 정밀화**만(구현 착수 시 반영 권장, 지금 미수정):
  - §19 "import/export 팀root 재구성 확인" → **RESOLVED**(scenes 범위 확정).
  - §14 복사 "onboardingVersion 재부여" 표현 → 실제는 "**viewer-meta 통째 복사로 자동 운반**"(redeemCopyCode 수정 불필요)로 정밀화.
  - §12 generation Rules 검증 → "ownerId까지만"에서 "**generation은 accidental-stale 방어까지 Rules 가능(payload 포함 시)**"로 소폭 정밀화.
- 위는 결론을 **강화**(A안·차단 아님 검증)하며 변경이 아님.

## 19. 구현 착수 가능 여부
**판정(선결정 후 갱신): GO_WITH_SECURITY_PRECONDITION** — 데이터 유실 차단 사유 없음(아래 GO 근거 유지). 단 **SEC-01 결정으로 editSession 선점 차단용 membership 기반(CF PIN검증→members 노드)이 Phase 0 필수 범위에 편입**됨. 이를 포함하면 editSession 선점 위험은 Phase 0에서 해소. scenes 전면 membership은 후속 Security Phase.

(이하 원 판정 근거 — 데이터 생명주기 관점 GO_WITH_PRECONDITIONS)
- 근거(GO 측): 데이터 유실 경로 **없음**(import/export/copy/clearAll/delete 전부 scenes 또는 팀-삭제 범위, 형제 비침범) · 파괴적 import/restore **없음**(restore 부재, import=scenes만) · 팀 루트 통째 set **없음** · 복사는 writingGuide 자연 제외 + onboardingVersion 자동 운반으로 R26 충족 · 삭제는 형제 포함 · editSession 부활 경로 없음 · 신규/기존 판정 가능(onboardingVersion+viewer-meta once).
- 전제(PRECONDITIONS): ① 생성 경로 원자화(SMALL) ② clearAll/교사 초기화의 writingGuide·onboarding 정책 결정(NEEDS_DECISION) ③ 신규 노드 scenes-형제 고정 가드 ④ members/membership = **횡단 SECURITY 후속 Phase**(scenes에도 동일하므로 compass 비차단) ⑤ 계정 삭제 익명화 = 후속 관리 Phase.
- **BLOCKED 조건 해당 없음**: 파괴적 import/restore 없음 · editSession 선점은 기존 scenes와 동일한 사전 위험(확대 아님) · Rules 방어 성립(ownerId+3분 만료 `now`+교사) · 신규·기존 판정 가능 · 복사·삭제가 신규 노드를 오염·유실하지 않음.
