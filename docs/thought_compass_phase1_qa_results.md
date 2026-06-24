# 생각 나침반 Phase 1 — QA 실행 결과 (Emulator E2E)

> branch `feature/thought-compass-phase1` HEAD `f86a8f3`. Firebase Emulator(Auth/Functions/Database, JRE 21) + 로컬 HTTP + 실제 compass 모듈 + 가상 fixture(classQa)로 E2E 수행. main 미병합·운영 미배포·운영 DB 미사용.

## 1. 환경
- JRE: Temurin **21.0.11**(`~/.local/jdk/jdk-21.0.11+10-jre/Contents/Home`).
- Emulator: functions 5001 / database 9000 / auth 9099, project `demo-branch`, `TC_FOLLOWUP_STUB=1`(AI stub·실 Anthropic 미호출). firebase.json에 emulators 블록은 QA 중 임시 추가 후 **되돌림**(feature clean).
- 인증: 익명 sign-in. membership/팀 fixture는 emulator REST(admin bearer)로 시드(ns `demo-branch`, functions admin과 정합).

## 2. 발견·수정한 버그 (P1×4 · P2×1)
| # | 심각도 | 증상 | 원인 | 수정 | 커밋 |
|---|--------|------|------|------|------|
| 1 | P1 | 신규 그림책/텍스트에서 **게이트가 안 뜸**(controller는 requiredNotStarted인데 오버레이 미표시) | `describeGate`가 mode를 ctx로 재계산하는데 `onboardingVersion`이 ctx에 없어 optional로 오판 | `_enterGateFlow`가 load한 onboardingVersion을 ectx에 실어 전달 | b067454 |
| 2 | P1 | "직접 적을래요" 클릭 시 **입력창(textarea) 미노출** → 직접 입력 불가 | `isCustom`이 `answerText`(빈값)에만 의존 | 질문별 `customMode=q.id` 추가 | b067454 |
| 3 | P1 | **답변 데이터 손실** — 7문항 답해도 RTDB에 1개만 저장(새로고침 시 유실) | `update.answers={qid:..}` + RTDB `.update()`가 answers 노드 통째 교체 | deep-path 키 `answers/<qid>`로 child 병합 | b067454 |
| 4 | P1 | **복사본 required 미작동** — copiedFrom 복사본이 optional로 판정 | controller가 `viewer-meta/copiedFrom`을 안 읽음 | store가 copiedFrom 로드 + mode/requiredHint/ectx 반영 | 0d17535 |
| 5 | P2 | **완료 후 editSession 미정리**(3분 만료까지 잔존) | release transaction이 첫 실행 로컬캐시 null에서 undefined 반환→abort | once(server read) 후 내 세션이면 set(null) | f86a8f3 |

각 수정은 재현→수정→재검증(아래 §3)으로 확인. 회귀 테스트 갱신(persistence/state) 포함.

## 3. E2E 통과 항목 (실제 emulator)
- **Rules Emulator 3회 38/38·0 fail**(member/teacher/비member/비로그인 × writingGuide/onboarding/editSession read·write, members 직접 write 거부, 학급 격리). editSession **write 허용**(member, Phase K) 등 4테스트 보강.
- **신규 그림책 E2E**: 게이트 노출(required·닫기 없음)·완료 전 BASE10 미생성·onboardingVersion=1·시작 시 editSession 트랜잭션·7문항 진행(실 callable 경유)·검토 7항목·완료(status=completed·completedAt)·**answerCount=7**(deep-path 병합 검증)·BASE10 10장면(표지→2…9→10·엔딩 버튼0)·idempotent.
- **신규 텍스트 E2E**: 동일 흐름 통과(text required·완료·BASE10).
- **작품 유형 매트릭스**: 기존 optional(진입 버튼)·copy required(게이트)·완료 복사본 완료 우선(다시 보기)·movie 제외(게이트/버튼 없음).
- **AI 4분기**(callable+stub): NEXT·ASK_FOLLOW_UP·ASK_EASIER·상한(followUpCount 5→NEXT capped). 입력 거부(movie/projectType, 금지필드), 비member permission-denied. **callable 실패 시 클라 null→NEXT 안전 진행** 확인. origin 미허용(QA 포트)→permission-denied(운영은 github.io 허용).
- **후속질문 UI**: 실 ASK_FOLLOW_UP → 후속 화면 렌더·답변 후 다음 핵심 질문 복귀.
- **모르겠어요**: 1회 안내 배너, 2회 유예 답변("이야기를 만들면서 정할래요") 저장·완료 인정.
- **editSession**: acquire(empty→editor)·타인 fresh→readonly·타인 stale→이어받기·release 내 세션만 제거·타인 세션 보존.
- **수명주기**: clearAll(scenes만 비움)→나침반 보존(PRE-01)·작품 삭제→나침반 제거(RETENTION-01).
- **반응형(390px)**: 선택지 54px·모르겠어요 44px·카드 358px(뷰포트 내)·한국어 keep-all 줄바꿈.

## 4. 자동 회귀(최종, 모든 수정 후)
- node --test compass: **189 pass / 0 fail**(16파일). membership: **20 pass**.
- node --check: compass 11 + functions 3 통과. JSON 유효. precommit 통과.
- Rules Emulator 3회 38/38.
- 원본 PB-MOOD 5파일 `cmp` 동일(shasum `e95ac358…`) 보존.

## 5. 한계 / NOT_VERIFIED
- **2-user editSession 동시경쟁**: 단일 익명 세션으로 같은 uid takeover만 검증(멱등). 서로 다른 uid 경쟁은 RTDB transaction 원자성에 의존(이론 보장).
- **클라이언트 rules 적용**: E2E의 기본 ns에서 클라 write가 rules 미적용(에뮬레이터 ns/rules 바인딩 아티팩트). 클라 경로 rules는 **Rules Emulator(default ns) 38테스트가 권위 검증** — 제품 버그 아님.
- **실 Anthropic 응답**: stub만 검증(운영은 ANTHROPIC_API_KEY 실호출). 실 maker.html 전체 join 흐름은 미구동(compass 모듈+store+callable를 emulator에 직접 연결해 검증).
- **iPad/Android 실기기 터치**·실운영 데이터 흐름.
- 의도적 미완료(롤아웃 §7): AI 최종요약·다듬기 메모·서랍·read-only 실시간 미러·튜토리얼·교사 UI·복사 onboarding 초기화 호출.

## 6. 적대적 검증(6 에이전트 fan-out) 결과
5개 수정 모두 **sound(low regression risk)** 판정. 추가 지적과 조치:
- (적용) **게이트 z-index** 1300→100000: maker 모달(≤10006) 위로 — 모달 스택 우회 방지(HIGH-1).
- (적용) **로딩 락**: `activateForNewProject`가 onboardingVersion write+load 동안 동기 오버레이로 화면 차단 — `hidePtypeScreen` 후 비동기 게이트 노출 전 창 제거(HIGH-2).
- (적용) **editSession release 원자화**: once-prime + transaction(return cur) — TOCTOU 제거(emulator 재검증: 내 세션 삭제·타인 보존).
- (문서·미적용) 아래 §6.1 = **운영 병합 전 필수 수동 점검**(실 maker.html/2-브라우저 필요, 하니스로는 입증 불가).

### 6.1 운영 병합 전 필수 수동 점검 (실 maker.html)
1. **게이트 집행(HIGH)**: 신규 pb/text 게이트 노출 중 ① Tab 포커스가 캔버스로 새지 않는지(focus trap/`inert` 필요할 수 있음) ② 이미지·기타 maker 모달을 키보드/단축키로 띄워 게이트 위로 못 오는지(z-index 100000로 완화했으나 실측 필요) ③ `hidePtypeScreen`~게이트 사이 조작 불가(로딩 락으로 완화, 실측).
2. **2-브라우저 온보딩 동시성(HIGH-3)**: 같은 신규 팀에 두 학생 동시 진입 → 답변 클로버/중복·부분 starter 장면 없는지. (editSession은 질문 UI 시작 시 획득 → 그 전 게이트 구간은 미보유.)
3. **all-deferred 완료(MEDIUM)**: 7문항 전부 "이야기를 만들면서 정할래요"로 완료 가능 — 제품 정책상 허용 여부 PO 확인(현재 PRD UX-05 허용).
4. **Rules 필드 검증(LOW)**: preWriting/onboarding/editSession에 `.validate` 없음(기존 앱 포스처와 동일) — 과대/이상 필드 write 허용. 강화 시 rules 변경+회귀 필요.
5. 실 Anthropic 응답(stub 외)·iPad/Android 터치.

## 7. 2-UID 동시진입 검증 (독립 auth 2개 · 실 RTDB 동시 트랜잭션)
서로 다른 익명 UID 2개(appA=실 모듈, appB=동일 로직) + `Promise.all` 동시 트랜잭션, emulator(db+auth) 실측. **11/12 통과 + 1 발견**:
- 독립 UID 2개 ✅ · 둘 다 required 게이트 판정(requiredNotStarted) ✅
- 동시 acquire → **편집자 정확히 1명**(editorCount 1), 패자 read-only ✅
- 179초 takeover 불가 / 180초+ takeover 가능 ✅
- 동시 takeover 경쟁 → **승자 1명**([editor, blocked]) ✅
- takeover 후 이전 편집자 heartbeat **차단**(committed=false), 세션 승자 유지 ✅
- 완료·중복완료 경쟁 → status completed·**answerCount 7**·**BASE10 10**·editSession 제거 ✅
- ⚠️ **발견(advisory lock)**: 패자 UI는 read-only로 차단되나, **store/rules 직접 write는 차단되지 않음**(`loserStoreWriteSucceeded=true`). editSession은 **클라/UI 조정 락**이며 rules 하드 락이 아님 — 기존 앱(viewer-locks)·PRD SEC-01(editSession "획득"만 멤버 게이트)과 일관. **rules 강화(write를 editSession 편집자로 제한)는 별도 횡단 Security Phase 사안**(Phase 1 범위 외). Phase 1의 단일편집 보장은 UI 집행으로 충족.

## 8. 최종 판정: READY_FOR_DEPLOY_APPROVAL_WITH_AI_SMOKE_PENDING
emulator E2E·2-UID 동시성·자동 회귀·rules·PB-MOOD 전부 통과. **남은 단 하나의 실검증 = 실 Anthropic 응답 1~3회**, 이는 `callThoughtCompassFollowUp` **선배포 후**에만 가능(이번 루프 배포 금지) → AI smoke는 배포 단계로 보류(stub로 결정/검증/제한/fallback 로직은 확인 완료). 배포 순서: rollout_plan §3 (functions 선배포 → AI smoke → main 병합=Pages). advisory-lock rules 강화 여부는 PO/Security Phase 결정.
