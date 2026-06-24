# 팀 데이터 읽기 보안 Phase 설계

> read-only 설계. 앱 코드/Rules/Functions 0줄 수정. Phase 0-A PARTIAL의 차단(PIN 공개 read)을 해소하기 위한 팀 read 모델 재설계 + Emulator 테스트 기반. 구현은 후속.

## 1. 발견 배경
- Phase 0-A 구현 중 확인: `classes/{classId}/teams/.read = true` 가 하위 전체로 **cascade**. RTDB는 **상위에서 허용된 read를 하위에서 다시 거부할 수 없음** → `pin/.read:false`·`account/pin/.read:false`를 추가해도 PIN 공개 read 무효. 따라서 PIN 차단 = **teams 상위 read 해체 + 자식별 read 재부여**(대형 보안 변경, emulator 필수).
- 현재 Phase 0-A 부분 구현 3파일 미커밋 보존(patch checksum 본 문서 §17·검증부).

## 2. 현재 Rules 상속 문제
| Rules 경로 | 현재 .read | 현재 .write | 상위 허용 영향 | 실제 보호 |
|------|------|------|------|------|
| `classes/$classId` | (없음) | meta=교사 | — | 부분 |
| `classes/$classId/settings` | true | 교사 | — | 공개 read(모드 등, 비밀 아님) |
| `classes/$classId/teams` | **true** | $team=교사(생성/삭제) | — | **하위 전체 공개 read** |
| `…/teams/$team/scenes` | true(상속) | auth!=null | teams가 이미 허용 | 공개 read·write 무제한 |
| `…/teams/$team/viewer-meta` | true(상속) | auth!=null | 동 | 공개 read·write 무제한 |
| `…/teams/$team/pin` | true(상속·중복) | auth!=null&&!exists | **teams 상속으로 강제 공개** | ❌ PIN 공개 |
| `…/teams/$team/account` | true(상속) | 교사 | 동 | ❌ account.pin 공개 |
| `…/teams/$team/locks` | true | auth!=null | 동 | 공개 |
| `…/teams/$team/members`(신규) | 자기/교사 | false | **teams 상속으로 read 무력화** ⚠ | ❌ members도 공개 read됨 |
| 최상위 `teams`(v1 레거시) | **true** | … | — | v1 pin도 공개 |

**답(§4 질문)**: ① teams/.read:true = **인증 무관 전체 공개**(아래 ② 참고). ② **auth 없어도 read 가능**(`.read:true`는 auth 조건 없음). ③ PIN 외 공개되면 안 되는 것: account.pin·members uid·(향후) editSession·writingGuide 원답·onboarding. ④ account.displayName/status는 학생 입장 판정용이나 **신규 모델에선 서버(CF)가 검증하므로 client 공개 불필요**. ⑤ 장면 공개 감상에 팀 전체 공개는 **불필요**(§아래 viewer는 scenes+viewer-meta만 읽음). ⑥⑦ **admin 팀 목록이 `classes/$classId/teams` 전체를 download**(adminConsole.js:240) → 얕은 목록이 아니라 전 child 다운로드(교사 컨텍스트라 허용은 되나, 공개 read와 별개로 교사-scoped로 제한 가능).

## 3. 팀 데이터 자식별 분류
| 자식 경로 | 저장 내용 | 읽는 화면/기능(근거) | 익명 | 팀 학생 | 공개 감상자 | 교사 | 공개 read 필요 |
|------|------|------|------|------|------|------|------|
| `scenes` | 장면 본문/구조 | viewer 감상(viewer-data.js:99)·maker | △공개작품만 | ○ | ○(공개작품) | ○ | **예(공개작품)** |
| `viewer-meta` | projectType·isPublic·테마·표지 등 | viewer(viewer-data.js:100·118·146)·maker | △공개필드 | ○ | ○(공개작품) | ○ | **예(공개작품)** |
| `pin` | 평문 PIN(legacy) | 로그인 PIN 검증(firebase.js:438·532) | ✗ | ✗ | ✗ | ○ | **아니오** |
| `account` | 교사 등록 메타(displayName/status/**pin**) | teacher_managed 로그인(firebase.js:504·519)·admin(253) | ✗ | ✗ | ✗ | ○ | **아니오** |
| `locks` | 장면별 편집락 | maker 편집(firebase.js:812) | ✗ | ○ | ✗ | ○ | 아니오(팀 내부) |
| `members`(신규) | uid membership | editSession 게이트·본인 확인 | ✗ | 본인 | ✗ | ○ | 아니오 |
| `editSession`(향후) | 단일 편집세션 | 단일 편집권한 | ✗ | member | ✗ | ○ | 아니오 |
| `writingGuide`(향후) | 생각 나침반 답 | 게이트/재열람 | ✗ | member | ✗ | ○ | 아니오 |
| `onboarding`(향후) | 튜토리얼 진행 | 게이트 | ✗ | member | ✗ | ○ | 아니오 |
| `aiPermission`/`aiVariants`/`aiDrafts`/`aiChecks`/`branchLineage` | AI 메타 | viewer/AI | △ | ○ | △ | ○ | 일부(현행 유지) |

## 4. 실제 read 사용처 (사용자 흐름별)
- **공개 감상**(viewer-data.js `loadProjectFromTeam`): `${base}/scenes` + `${base}/viewer-meta` **2개만** once(:99-100). isPublic은 `viewer-meta.isPublic`(:146)으로 받아 **client에서만 차단**(:294 `if(!isPublic && !fromMaker) 차단`) — **Rules 미강제**(기존 약점). 팀 목록/browse 경로 없음(viewer는 URL의 teamName/classId 직접 진입).
- **학생 제작**(firebase.js): 학급코드→classId(`_lookupClassId`)·teamCreationMode(settings)·PIN(pin 또는 account.pin)·_enterTeam→scenes/viewer-meta. 자동복원(`_resumeTeamFromSession`)=sessionStorage `ctx.pin`로 pin 재검증.
- **교사/관리**(adminConsole.js): `classes/$classId/teams` **전체 once**(:240)→팀별 scenes/viewer-meta/account 분석(`_analyzeTeam` body 미열람). PIN 관리·account.set(:649)·teamCreationMode set(:542)·팀 삭제 remove(:1524).

## 5. 공개 감상 최소 데이터
- **공개 read 필요(공개작품 한정)**: `scenes`, `viewer-meta`(또는 그 공개 필드: projectType·isPublic·작품제목·표지·테마/폰트/viewer 설정).
- **공개 감상자가 읽으면 안 됨**: `pin`·`account.pin`·account 상태·`members` uid·`editSession`·`writingGuide` 원답·`onboarding`·교사 메타·내부 lock.
- ⚠ **viewer-meta에 공개/비공개 혼재**: projectType·isPublic·표지·테마=공개 가능 / 단 viewer-meta에 민감 필드가 더 들어오면 위험. → **공개 필드 allowlist** 권장(또는 민감 메타는 별도 비공개 노드로 분리). 현재는 민감값 없으나 향후 추가 시 allowlist 강제.

## 6. 목표 read/write 권한표 (최종)
| 경로 | 익명/공개 감상자 | 팀 학생(member) | 교사(자기 학급) | super_admin | Admin SDK(CF) |
|------|------|------|------|------|------|
| `scenes` | **R: isPublic=true만** | R/W(member) | R/W | R/W | R/W |
| `viewer-meta` | **R: isPublic=true만**(또는 공개필드) | R/W | R/W | R/W | R/W |
| `pin` | ✗ | ✗ | R/W | R/W | R/W |
| `account`(pin 제외 메타) | ✗ | ✗ | R/W | R/W | R/W |
| `account/pin` | ✗ | ✗ | R/W | R/W | R/W |
| `locks` | ✗ | R/W(member) | R/W | R/W | R/W |
| `members/{uid}` | ✗ | 본인 R | R | R | **W만(CF)** |
| `editSession`(향후) | ✗ | member R/W(owner+gen) | R/release | R/W | R/W |
| `writingGuide`/`onboarding`(향후) | ✗ | member R/W | R | R/W | R/W |
| `classes/$classId/teams`(목록) | ✗ | ✗ | R | R | R/W |
| `classes/$classId/settings/teamCreationMode` | R(비밀 아님) | R | R/W | R/W | R/W |
- **member 판정**: `root.child('classes/'+$classId+'/teams/'+$team+'/members/'+auth.uid+'/status').val()==='active'`.
- **교사 판정**: `auth.token.role==='teacher'||'super_admin'` 또는 `root.child('classes/'+$classId+'/meta/teacher_uid').val()===auth.uid`(기존 패턴).
- ⚠ **isPublic 조건부 scenes read = 보안 강화이자 동작 변경**: 현재 비공개 작품 scenes도 공개 read(client만 차단)였음 → Rules 강제 시 비공개 작품은 member/교사/제작자만 read. fromMaker(제작자 테스트)는 member 또는 교사로 처리.

## 7. 구조 후보 A/B/C 비교
| 기준 | A. 자식별 read Rules | B. 공개 projection 노드 분리 | C. 목록 index만 projection + scenes 자식별 |
|------|------|------|------|
| 기존 코드 변경량 | 작음(Rules+로그인) | 큼(공개 동기화 추가) | 중간 |
| 공개 viewer 회귀 위험 | 중(scenes read 조건화) | 낮음(공개 데이터 분리) | 중 |
| PIN 차단 확실성 | 높음(상속 해체) | 매우 높음(애초 분리) | 높음 |
| 학생 제작 보안 | 높음 | 높음 | 높음 |
| Rules 복잡성 | 중(sibling 참조) | 낮음(경계 단순) | 중 |
| migration | **불필요**(구조 유지) | 큼(공개 데이터 복제/동기화) | 중(index 동기화) |
| 원자 배포 | 가능 | 어려움(동기화 선행) | 가능 |
| 장기 유지보수 | 중(조건부 read) | 좋음(경계 명확) | 중 |

## 8. 최종 권장 구조
- **이번 Security Phase = 후보 A(자식별 read Rules)** 권장.
  - 근거: 데이터 **migration 0**(현 구조 유지), 최소 변경으로 PIN/account/members 공개 read 차단, 공개 감상은 scenes+viewer-meta 조건부 read로 유지. emulator 회귀로 viewer 회귀 위험 관리 가능.
  - 핵심 작업: ① `classes/$classId/teams/.read:true` 및 `$team` 상속 read **제거** ② scenes/viewer-meta = `isPublic===true || member || 교사` 조건부 read ③ pin/account = 교사/Admin만 ④ members = 본인/교사 read·CF write ⑤ admin 목록용 `teams/.read` = 교사 scoped ⑥ v1 `teams/.read`도 동일 차단.
- **장기 이상 = 후보 B**(공개 projection): 공개/비공개 보안 경계가 코드와 무관하게 구조로 보장. 단 동기화 인프라가 커 이번 범위 밖. A로 차단 후, 공개 데이터가 복잡해지면 B로 진화.

## 9. PIN·account 보호 목표
- **PIN**: 학생 client read 불가 · 공개 viewer read 불가 · 익명 read 불가 · 교사/super_admin 최소 R/W · Admin SDK(CF) R.
- **account 필드 분류**:
  | 필드 | 학생 본인 | 같은 팀 학생 | 공개 viewer | 교사 | 비고 |
  |------|------|------|------|------|------|
  | `account/pin` | ✗ | ✗ | ✗ | R/W | 서버(CF)만 검증에 사용 |
  | `displayName` | ✗(불필요) | ✗ | ✗ | R/W | 신규 모델선 client 불필요 |
  | `status` | ✗(불필요) | ✗ | ✗ | R/W | locked 판정은 CF가 수행 |
  | student identifier | (저장 안 함) | — | — | — | PRE-04 최소화 |
- **두 PIN(`teams/pin` vs `account/pin`) 공존 이유**: `teams/pin`=legacy_open 자가등록 PIN(첫 학생이 설정), `account/pin`=teacher_managed 사전 등록 PIN. **이번 Phase: 둘 다 유지하되 서버 검증 helper(CF)에서만 읽어 통합**. 장기 단일화는 별도 결정(이번 migration 없음).

## 10. membership과 로그인 정본화
- 로그인 PIN 검증의 **정본 = CF `joinTeamMembership`**(Phase 0-A에 3모드 서버검증 구현됨). client는 pin/account 직접 read 제거, CF 호출 결과로만 진입.
- **금지**: client PIN read 후 형식적 호출 / callable 실패인데 client 비교로 진입 / SDK 없으면 건너뛰고 진입 / fire-and-forget. **membership 성공 전 로그인 성공 처리 금지.**

## 11. sessionStorage PIN 제거
- 현재 `makerSession.pin` 저장(firebase.js:657) → resume이 pin 재검증.
- 목표: **PIN 미저장**. 저장=classId·teamName·auth.uid. 재접속 = 세션 존재 → 익명 auth 복구 → `members/{uid}/status==='active'` 확인 → active면 진입, 없으면 PIN 재입력.
- 확인 사항: legacy_open 자가등록 팀도 membership 기반 복원 가능(최초 1회 CF로 membership 생성됨) · 익명 uid 변경/삭제 시 membership 없음→PIN 재입력 안내 · 저장소 초기화 시 PIN 화면 복귀 · teacher_managed/legacy_open 동일 처리.
- 안내문(기존 사용자 호환): "안전한 접속 확인을 위해 모둠 비밀번호를 한 번만 다시 입력해 주세요."

## 12. 원자 배포 순서
**같은 배포 묶음으로 묶어야 하는 변경**: callable·Functions SDK·client 로그인 연결·자동복원 membership·PIN 직접 read 제거·PIN/account Rules 잠금·teams 상위 read 해체.
- **단계 1(호환 준비, 보안 개선 아님)**: callable 배포 + members Rules 추가 + 기존 로그인/PIN 공개 read 유지. (현 Phase 0-A 부분 구현이 여기 해당.)
- **단계 2(제한적 시험)**: callable을 실제 로그인에서 호출(테스트 학급 flag). ⚠ **client PIN 비교 fallback을 두면 PIN 공개 문제 지속** → 시험은 짧게, 본 전환 전 제거.
- **단계 3(원자 보안 전환, 한 배포)**: client callable 정본화 + Functions SDK + 자동복원 변경 + sessionStorage PIN 제거 + client PIN read 제거 + **teams 상위 read 해체 + 자식별 read Rules**. 클라이언트(maker.html/firebase.js)·Rules·Functions를 **동시 배포**.
- **실패 시 rollback**: §16 rollback. Rules만 직전으로 되돌리면 **PIN 공개 재발**(경고).

## 13. Emulator 테스트 인프라
- 현 상태: **root package.json 없음** · `@firebase/rules-unit-testing` 없음 · firebase.json에 `emulators` 블록 없음 · functions/package.json엔 emulator serve script만(글로벌 firebase CLI 가정) · Node v24(functions engines=20).
- **방법 비교**: A. 루트 `tests/rules/`에 전용 package(`@firebase/rules-unit-testing` + firebase database emulator) / B. functions package에 테스트 의존성 추가.
- **권장 A**: 배포 의존성(functions)과 테스트 의존성 분리, functions 번들 오염 0. `firebase.json`에 `emulators.database` 포트 추가 + `tests/rules/package.json`(devDep: @firebase/rules-unit-testing, 실행은 `firebase emulators:exec`). 이번 설계 단계엔 **설치하지 않음**.

## 14. Rules 테스트 매트릭스
- **공개 read**: ①anon 공개작품 scenes 허용 ②anon 비공개 scenes 거부 ③anon viewer-meta 공개필드 허용 ④anon pin 거부 ⑤anon account 거부 ⑥anon members 거부 ⑦anon editSession 거부.
- **익명 학생**: ①자기팀 scenes ②타팀 공개 scenes ③타팀 비공개 거부 ④pin 거부 ⑤account.pin 거부 ⑥자기 membership 허용 ⑦타 uid membership 거부 ⑧editSession은 membership 있을 때만.
- **교사**: ①자기학급 팀 목록 ②pin R/변경 ③account 관리 ④members R ⑤editSession 해제 ⑥타 교사 학급 거부 ⑦super_admin 예외.
- **쓰기**: ①학생 members 직접 생성 거부 ②학생 PIN 변경 거부 ③공개 viewer write 거부 ④membership 없는 editSession 획득 거부 ⑤membership 있는 획득 허용 ⑥타팀 editSession 거부.
- **회귀**: 공개 viewer 진입 · 학급 작품 목록 · maker 학생 로그인 · legacy_open · teacher_managed · locked · admin PIN 관리 · 프로젝트 복사 · 삭제.

## 15. fixture
- `classA`(teacherA): `teamPublic`(viewer-meta.isPublic=true, scenes), `teamPrivate`(isPublic=false, scenes), `teamLegacy`(pin), `teamManaged`(account{pin,status:active}), `teamLocked`(account.status=locked 또는 settings.teamCreationMode=locked).
- `classB`(teacherB): `teamOther`.
- 사용자: `anonymousStudentA/B`, `teacherA`(claim/teacher_uid), `teacherB`, `superAdmin`(claim), `unauthenticated`.
- 각 팀 최소 필드만(가상). **운영 데이터 복사 금지.**

## 16. rollback
- 피해야 할 것: **PIN 전체 공개 read 영구 복원**.
- 대안: 직전 Rules 임시 rollback(⚠ PIN 공개 재발 경고) · 로그인 callable 장애 시 점검 화면 · public projection/index만 임시 복구 · 교사 전용 긴급 접근 · feature flag로 새 로그인 UI 비활성화.
- **경고**: Rules만 직전으로 되돌리면 PIN 공개가 재발하므로, rollback은 "client 로그인 flag off + Rules 유지"를 우선.

## 17. 현재 부분 구현 처리
- 후보: A 보존 / B patch 보관 후 HEAD 복원 / C 별도 feature branch WIP commit / D 폐기 재구현.
- **권장: B(patch 보관 + 3파일 HEAD 복원)** — main working tree가 장기간 부분 구현으로 오염되지 않고, 이후 read-only 설계/다른 작업과 충돌 없으며, 불완전 보안 코드를 main에 commit하지 않음. Security 구현 시 patch 검토 후 필요한 부분(특히 CF 3모드 검증)만 재적용.
- ⚠ **단 `/tmp` patch는 비영속** → durable 보관 필요: (a) repo에 `docs/`나 `patches/`로 patch 파일 commit, 또는 (b) `security-phase0a-wip` 브랜치에 WIP commit(C). 사용자 작업방식(auto-git)·보존 안정성 고려 시 **(b) WIP 브랜치 권장**(stash 금지 제약과도 부합). 변경 3파일은 additive·비파괴라 A(그대로 보존)도 안전하나, 장기 미커밋 오염을 피하려면 B+durable. **최종 선택은 사용자**. 이번 단계에선 **복원하지 않음**.

## 18. 구현 Phase 분할
| Phase | 내용 | 수정 파일(예상) | 중단 조건 |
|------|------|------|------|
| SEC-0 | 테스트 인프라 구축 | `firebase.json`(emulators), `tests/rules/`(신규) | emulator 미기동 |
| SEC-1 | 현재 Rules 회귀 테스트 작성 | `tests/rules/*` | 기존 동작 재현 실패 |
| SEC-2 | teams 상위 read 해체 + 자식별 Rules | `database.rules.json` | 공개 viewer 회귀 |
| SEC-3 | callable 로그인 정본화 | `firebase.js`, `maker.html`(SDK+캐시) | 로그인 회귀 |
| SEC-4 | client PIN read·sessionStorage PIN 제거 | `firebase.js` | 자동복원 실패 |
| SEC-5 | membership 기반 복원 | `firebase.js` | legacy 호환 실패 |
| SEC-6 | 공개 viewer·admin·maker 통합 QA | (테스트) | 회귀 발견 |
| SEC-7 | atomic deploy + rollback 점검 | (배포 절차) | rollback 미검증 |

## 19. 완료 조건 (본 설계)
✔ 팀 자식 경로 전수 분류(§3) ✔ 공개 감상 최소 경로 확정(scenes+viewer-meta, §5) ✔ 상위 read 해체 대안 확정(후보 A, §8) ✔ PIN/account 목표 권한 확정(§6·9) ✔ 로그인 원자 전환 순서 확정(§12) ✔ Emulator 도입 방식 확정(A, §13) ✔ 테스트 매트릭스 확정(§14) ✔ rollback 확정(§16) ✔ 부분 구현 처리 권고 확정(B+durable, §17) ✔ 미해결 보안 명시(§20).

## 20. 선결정 확정 (SEC-PRE-01~06, 2026-06-24 — 전부 추천대로)
- **SEC-PRE-01 부분 구현 처리** = **patch 보관 후 3파일 HEAD 원복**(완료). 보관: `~/.claude/wip/branch-security/`(`phase0a-membership-partial.patch` checksum `51fe63a` + 파일별 `.phase0a` 백업). `git apply --check` 통과(재적용 가능). main에 미완성 보안 코드 미잔류.
- **SEC-PRE-02 isPublic Rules 강제** = **이번 Phase에서 함께 강제**. scenes·viewer-meta read 조건 = `isPublic===true || 팀 active member || 학급 교사 || super_admin`. 기존 client-only 약점 동시 해소. 실제 필드/값 타입은 SEC-1 회귀 테스트에서 확정.
- **SEC-PRE-03 PIN 구조** = **DB 구조(teams/pin·account/pin) 유지 + CF 두 모드 통합 검증**(migration 0). 장기 단일화 = 별도 Security Cleanup Phase.
- **SEC-PRE-04 viewer-meta 범위** = **공개작품이면 viewer-meta 노드 전체 read + "공개 가능 필드만 저장" allowlist 정책·테스트 명문화**. 민감(진행상태·계정·잠금)은 viewer-meta 저장 금지.
  - **onboardingVersion 위치 = `onboarding/version`으로 분리**(공개 viewer-meta 전체 read 충돌 회피). ⚠ **복사 함수(redeemCopyCode) 작은 변경 필요**: viewer-meta 통째 복사로 자동 운반되던 것을 `onboarding`도 복사/재부여해야 복사본 compass 재요구(R26) 유지. **이 결정은 데이터 생명주기 감사 §10(viewer-meta colocate 권장)을 SUPERSEDE.**
- **SEC-PRE-05 구조** = **후보 A(자식별 read Rules, migration 0)**. 장기 B는 공개 데이터 복잡해질 때 전환.
- **SEC-PRE-06 테스트 인프라** = **설치 승인**. `tests/rules/`(package+lock+`database.rules.test.js`, devDep `@firebase/rules-unit-testing`) + `firebase.json` database emulator. functions 번들 비오염·테스트 프로젝트 ID·운영 미연결.

**남은 미결정: 없음**(SEC-0 착수 가능).
