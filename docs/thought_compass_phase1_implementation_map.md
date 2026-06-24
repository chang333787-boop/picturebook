# 생각 나침반 Phase 1 — 구현 연결점 지도 (Implementation Map)

> Phase 0 foundation을 라이브 maker 흐름에 연결하기 전 read-only 조사 결과.
> 모든 개발은 worktree `../picturebook-thought-compass-phase1` / branch `feature/thought-compass-phase1` 에서만.
> main 병합·Firebase 배포·Pages 활성화 금지. 기준 HEAD `db06e60`.

## 0. 핵심 결론
- **PRD 7질문 키 확정**: `audience(G1) · purpose(G2) · protagonist(G3) · goal(G4) · obstacle(G5) · branchChoice(G6) · protectedCore(G7)`.
  - `thought-compass.js` `CORE_QUESTION_KEYS` + PRD DATA-10 summary 필드와 정확히 일치. 사용자 일반 범주(장소/시작)와 다르지만 PRD가 정본 → 모호함 없음.
- **Rules 변경 불필요**(핵심 흐름): 기존 rule이 active member의 `onboarding`/`writingGuide`/`editSession` read+write 허용.
- **신규 작품 장면 자동생성 충돌 발견**: 신규 pb/text는 ptype 선택 직후 BASE10 10장면 즉시 생성됨 → 나침반 필수 작품은 **장면 생성을 완료 시점으로 미룸**(PRD 1.1 흐름 정합).

## 1. ptype 선택 → maker 진입 흐름 (게이트 삽입점)
- `showPtypeScreen(existingType)` — `ui.js:601`. ptype 화면 노출.
- `_onPtypeCardClick(clickedType)` — `ui.js:620`. 기존유형 다르면 강제 잠금(alert) 후 기존유형 진입; 신규/동일이면 즉시 진입.
- **`_enterMakerAfterPtypeSelected(ptype)` — `ui.js:649`** (신규/기존/복사 공통 진입점):
  1. 신규(`!_ptypeExistingType`)면 `classes/{classId}/teams/{enc}/viewer-meta/projectType` set → `savedNewProjectType=true` (`ui.js:660-679`).
  2. `hidePtypeScreen()` (`ui.js:680`).
  3. `savedNewProjectType && (text|picturebook)` → `window.createStarterTemplateForNewProject(ptype)` (`ui.js:688-692`).
- 기존 작품 재진입: `firebase.js:571-589` — projectType 있으면 ptype 화면 스킵, maker 직진입(`_enterMakerAfterPtypeSelected` 미경유 가능).

### 게이트 단일 실행 위치 (Phase D)
- **신규 작품**: `_enterMakerAfterPtypeSelected` 안, projectType set 직후·starter 생성 **이전**(`ui.js:680` 부근). 여기서 `onboarding/version=1` write + `ThoughtCompassGate.maybeBlock` 호출.
- **기존 작품 재진입(resume)**: `firebase.js`의 scenes 첫 스냅샷 도착 직후(classId/teamName 확정)에 compass state 로드 → required(in_progress)면 게이트. optional 미시작이면 상단 버튼만.
- admin(`?admin=1`)·viewer(viewer.html)·movie/experience는 게이트 비대상: maker가 아닌 진입점이거나 `describeGate`가 `show:false`(movie/experience=mode none).

## 2. onboardingVersion (required 트리거)
- 현재 신규 작품에 `onboarding/version`을 write하는 코드 **없음**(grep 미발견). foundation `resolveThoughtCompassMode`는 `onboardingVersion>=1 || copiedFrom` → required.
- **Phase D 추가**: `_enterMakerAfterPtypeSelected` 신규 pb/text 분기에서 `classes/{classId}/teams/{enc}/onboarding/version = 1` write (STATE-02). member 권한으로 write 허용(rules 86-88).
- 기존 작품(필드 없음)은 optional 유지(STATE-02 사고방지).

## 3. 장면 자동 생성 & Phase J 정합
- `createStarterTemplateForNewProject(explicitPtype)` — `mobileTextBranch.js:2488`. 멱등 가드: ptype 필터(2490)·admin 제외(2493)·scenes 로드대기(2497)·`_isStarterTemplateInitialized`(2501)·`_writeBase10IfEmpty`(2505, empty 재확인).
- 빌더 `_mtbBuildBase10Scenes` (window.buildBase10StarterScenes, `mobileTextBranch.js:2534`). 초기화 플래그 = `viewer-meta/starterTemplateInitialized` (`mobileTextBranch.js:2478`).
- **결정**: 나침반 필수 신규 작품은 ptype 선택 시 starter 생성을 **건너뛰고**(게이트가 가로챔), **완료(Phase J) 시점에 `createStarterTemplateForNewProject(ptype)` 호출**(멱등·동일 schema 재사용). 기존 scenes 있으면 자체 가드로 no-op. movie/experience는 본래 미생성.

## 4. membership/auth 준비 시점
- `_joinTeamV2` (`firebase.js:439~`): `signInAnonymously()`(439) → `MembershipLogin.requestTeamMembership()`(446, 서버 callable `joinTeamMembership`) → members/{uid}/status='active'.
- 이후 `_enterTeam` → scenes 리스너(`firebase.js:556`), locks(`firebase.js:746`). classId(`firebase.js:455`)·teamName(`firebase.js:536`) 확정.
- → `_enterMakerAfterPtypeSelected` 시점엔 uid+active membership+classId+teamName 모두 준비됨 → preWriting/onboarding read/write 가능.

## 5. RTDB 경로 & Rules (database.rules.json)
경로(모두 `classes/{classId}/teams/{teamEncoded}` 하위, `buildThoughtCompassPaths`):
- `writingGuide/preWriting` (compass state) — rules `82-84` active member RW ✅
- `onboarding` / `onboarding/version` — rules `86-88` active member RW ✅
- `editSession` (Phase K) — rules `78-80` active member RW ✅
- `members/{uid}` — rules `72-75` read self/teacher, **write:false**(서버 callable 전용).
→ **핵심 흐름 Rules 무변경**. Phase K editSession도 기존 rule로 충분(emulator 재확인 예정).

## 6. fail-closed 처리 (Phase D)
- `ThoughtCompassStore.loadThoughtCompassState` (`thought-compass-store.js:32`)는 catch 시 기본값 반환(=현재 **fail-open**: 에러→optional→비차단).
- required 대상에서 load 실패를 completed로 오인하면 안 됨(사용자 지시). → Phase D controller는 **에러를 구분**해야 함: store에 에러 전파 load(또는 controller에서 try/catch 분리) 추가 → required면 `error` 상태(재시도 화면), optional이면 비차단.

## 7. 상단 메뉴 / 버튼 배치
- maker 상단 toolbar: `.tb-section--left/center/right` (maker.html ~426-751). optional "🧭 생각 나침반" 진입 버튼 후보 = 좌측 identity 그룹 또는 우측 도구 그룹.
- 브랜치(canvas): 좌측 장면목록 헤더 `.ss-head`/`.ss-add` 근처 또는 구조 점검 그룹(WIRE-13: 구조 점검 근처).
- `describeOptionalEntryButton(ctx)` (`thought-compass.js:233`)가 show/action/label/cancellable 제공 → UI는 렌더만.

## 8. completed 후 maker 재진입
- 게이트 통과/완료 후 maker 노출 = `ThoughtCompassGate.closeGate()`(`thought-compass-gate.js:67`) + 기존 maker 캔버스(scenes 스냅샷이 자동 renderAll). 별도 재진입 함수 불필요(오버레이 제거 = maker 노출).

## 9. scene schema (Phase J 참고, viewer-data adapter 정규화)
- 필드(요약): `id/num, type('cover'|'start'|'normal'|'ending'), title, body, buttons[{label,nextId}](신규)/choices(legacy), imageData, displayType, picturebookSubmode, isStart/isEnding/isCover`.
- 신규 빈 장면 최소: `{num, type:'normal', title:'', body:'', buttons:[]}`.
- **Phase J는 새 schema를 만들지 말고 `buildBase10StarterScenes`/`createStarterTemplateForNewProject` 재사용**(구조 일치 보장).

## 10. clearAll
- `clearAll()` (`ui.js:497`): scenes={}, nextNum=1, `_afterMutation()`(renderAll+pushToFirebase). writingGuide/onboarding 미접근 → **PRE-01(장면 전체삭제해도 나침반 유지) 자동 충족**.

## 11. maker.html script 로드 (Phase D)
- 현재 thought-compass*.js **미로드**. 추가 순서(의존): `thought-compass.js`(ThoughtCompass 정의) → `thought-compass-questions.js`(Phase C) → `thought-compass-store.js` → `thought-compass-ui.js`(Phase E) → `thought-compass-gate.js`. ui.js/mobileTextBranch.js 뒤(런타임 호출이라 순서 무관하나 ThoughtCompass 선행 안전).
- 캐시버스터 `?v=` 누적 토큰 규칙(소문자 연결). 신규 파일은 `?v=tcphase1...` 형태.

## 12. Functions callable 패턴 (Phase G — `callThoughtCompassFollowUp`)
- 전역: `setGlobalOptions({region:'asia-northeast3', maxInstances:5, timeoutSeconds:60})` (functions/index.js:47-51). secret `ANTHROPIC_API_KEY`=defineSecret(54).
- 대표 패턴 `callTextAiBatch` (1342): `onCall({secrets:[ANTHROPIC_API_KEY], enforceAppCheck:false}, async req=>{})`. auth uid 필수(329), 입력 allowlist+`_isSafeIdSegment`(2119), aiSettings/aiPermission membership 검증(365-428), quota(432-464), `testMode===true`면 차단(341).
- AI: `@anthropic-ai/sdk`, model `claude-haiku-4-5`(750), `_callAnthropic`(772). 파싱 `_parseJsonStrict`(808), 검증 `_validate*`(997~), 실패시 quota 환불+HttpsError.
- 테스트: `exports._internal`(2258)에 순수함수 노출 → `node --test`. precommit `scripts/precommit-check.js`가 functions/ 변경 경고(148).
- 기존 callable 6종: callTextAiBatch, callTextAiBatchS2, callWorkCheck, saveTextVariant, callImageAiS1, joinTeamMembership. → 회귀 점검 대상.
- **Phase G 추가**: `callThoughtCompassFollowUp` onCall, 입력 allowlist(projectType·coreQuestionId·currentAnswer·prior summaries·followUpCount·totalQuestionCount), 출력 schema(decision NEXT/ASK_FOLLOW_UP/ASK_EASIER, reasonCode allowlist SUFFICIENT/TOO_VAGUE/MISSING_DETAIL/CONTRADICTION/STUDENT_STUCK/OFF_TOPIC, followUpQuestion ≤40자, supportOptions), fallback=재시도1→NEXT(G3/G4는 고정 후속). `exports._internal`에 validator 노출. **배포 금지**.

## 13. PRD 핵심 제약 (전 Phase 공통)
- 후속질문 ≤2/질문, 세션 ≤5, 전체 ≤12 (D-05, 후속전역규칙).
- 직접입력 ≤200자(핵심)/≤150자(후속) (D-24). debounce 700ms(DATA-03), '다음'에서 flush(DATA-02).
- answerStatus: empty/draft/confirmed (DATA-04) + minimal(foundation 인정). 최신답+직전답1(DATA-05).
- AI ack 저장안함(DATA-07), offTopicCount만(DATA-08), summary 7필드+원답 모두 저장(DATA-09/10).
- 진행 중 권한이전 금지(D-04), 3분 무응답만 이어받기 예외(LOCK-01), heartbeat 30초(LOCK-02).
- 최종요약 8초 타임아웃→원답 fallback(WIRE-11), AI 실패→NEXT(RECOVERY-03/04, G3/G4 고정후속).

## 다음 단계
Phase C(질문 정의) → D(게이트 활성화) → E(질문 UI) → F(모르겠어요) → G(AI callable) → H(AI UI) → I(검토) → J(장면생성) → K(editSession) → L(다시보기) → M(자동 QA) → N(수동 QA) → O(롤아웃 문서).
