# P7 — textSelections (원본 ↔ AI 장면발전 발행 선택) 설계 + 인프라 구현

- 일자: 2026-07-01
- 브랜치: `feature/write-after-rebuild` (main 미병합 · 배포 없음 · 승인 대기)
- 성격: **feature 인프라 구현** — 클라 resolver(순수·DB write 0) + loadTeamData read + 서버 callable **코드만(dormant·미배포)** + 렌더 hook(inert) + 단위 테스트. 실 AI 0 · 운영 DB write 0 · deploy 0 · rules 변경 0.
- 상위 문서: [[project-branch-write-after-rebuild]] · 조사 근거 = [P6 textS2 조사](write_after_text_s2_finalize_audit_20260630.md)

## P6 최종 확인 (재검증)

textS2(AI 장면발전)는 학생이 직접 고친 **최신 원본 body**를 입력으로 쓴다 — `callTextAiBatchS2`가 클라가 보낸 `req.data.snapshot`의 `s.body`를 그대로 사용([functions/index.js:1581](functions/index.js:1581)·[prompts.js:677](functions/prompts.js:677)), 서버는 scenes DB를 재독하지 않음. snapshot의 body는 `ViewerState.scenes[].body`(contenteditable input이 즉시 갱신). 결과는 `aiVariants/text/{sid}/s2`에만 저장, 원본 `scene.body` 불변. → **P6 단독 신규 로직 불필요**, P7 발행 선택 구조가 핵심.

## P7 철학 (변경 없음)

- 원본 body는 **절대 자동 덮어쓰지 않는다**. AI 장면발전은 후보일 뿐.
- 장면별로 원본/ s2 후보를 선택 → 별도 selection 경로에 저장.
- 선택 전 기본값 = 원본. s2 결과 없으면 원본 fallback. 구작품 호환.
- 이미지 `imageSelections` 축을 **1:1 평행 복제** (검증된 완성 모델).

## 이번 루프에 구현한 것 (feature)

### 1. 클라 resolver — `viewer-data.js` (순수·DB write 0)
이미지 축(1570~1732)을 텍스트로 미러:
- `normalizeTextSelection(raw)` — schema `{selected:'s2'|'original', selectedBy, selectedAt, selectionSource:'teacher-batch'|'system-stale'|null}` (이미지와 동일).
- `normalizeTextS2Variant(raw)` — `body` 없거나 공백이면 null(사용 불가). 이미지의 url 검증에 대응.
- `_originalSceneBody(scene)` — `String(scene.body)`.
- `_isTextS2Usable(s2)` — `body` 비어있지 않고 `stale!==true`.
- `resolveSceneBodySource(scene, sel, s2, previewMode)` — `{kind:'original'|'s2', body, isAiTransformed, fallbackReason}`. previewMode(토글) OR selection(발행)이 s2이고 usable일 때만 s2, 그 외 원본.
- `_setPublishedTextCaches(textNode, selNode)` — team 1회 캐시(`_pubTextS2BySid`/`_pubTextSelBySid`).
- `getPublishedBodyDisplay(scene, originalBody)` — **동기 렌더 helper**. 발행 선택 s2 + usable이면 s2 body, 그 외 originalBody 그대로. 원본 body 불변.
- `setPublishedTextSelectionForScene(sceneId, selected, s2Node)` — 서버 저장 성공 후 캐시 동기 갱신(클라 직접 DB write 아님).
- window 노출 + module.exports(테스트).

### 2. loadTeamData read 추가 — `viewer-data.js`
기존 이미지 read와 같은 `Promise.all`에 `aiVariants/text` + `aiVariants/textSelections` 추가(비치명적 `.catch→null`). team 진입 시 `_setPublishedTextCaches`로 적재. 없거나 실패해도 원본 body 표시(무영향).

### 3. 렌더 hook — `viewer-render.js` (8개 body 렌더 지점, inert)
각 지점에서 `_orig`(원문) **바로 뒤**에 `_pubBody = getPublishedBodyDisplay(scene, _orig)`를 삽입하고, 표시 토글 `_getDisplayBody`의 입력만 `_orig`→`_pubBody`로 교체. **`_orig`(진짜 원문)는 불변** — 편집 게이트(예: 무비 엔딩 `_allowMovieEndBodyEdit ? _orig : userBody`, viewer-render.js:2044)가 계속 진짜 원문을 씀. 선택 없으면 `_pubBody===_orig`이라 **기존 동작 100% 동일**.
지점: 텍스트 장면·그림책 분할·imageCenter 계열 3종·엔딩 텍스트·엔딩 그림책 2종(총 8).

### 4. 서버 callable — `functions/index.js` (dormant·미배포)
`callApplyTextS2Selection` — `callApplyImageS2Selection`의 텍스트 평행:
- 입력 `{classId, teamName, sceneId, selected:'s2'|'original'}`.
- `_validateRequest(req, 's2', {skipUsageLimits:true})` + **교사 전용**(super_admin OR `meta/teacher_uid`).
- write `aiVariants/textSelections/{sid}` = `{selected, selectedBy, selectedAt, selectionSource:'teacher-batch'}`.
- s2 usable = `aiVariants/text/{sid}/s2.body` 비어있지 않음. 불충족 → `{ok:false, code:'S2_NOT_USABLE'}`.
- ⚠️ **아직 클라 UI 미연결·미배포**. 호출하는 곳 없음(dormant).

### 5. 단위 테스트 — `tests/write-after/text-s2-select-resolver.test.js`
이미지 published-render-resolver 테스트의 텍스트 복제. 18/18 pass. 원본 보호·selection 표시·모든 실패 경로 원본 fallback·previewMode 독립 검증.

## Rules — 변경 불필요 (중요)

`database.rules.json`의 `aiVariants` 노드는 `.read:true / .write:false`(부모 grant 없음). `textSelections`는 이 부모 규칙을 상속 → **클라 직접 write 불가, Admin SDK(callable) 단독 write**. read:true라 학생 감상 표시엔 지장 없음. **`textSelections`에 별도 rules 추가 불필요 → rules 파일 무변경.** (대조: `scenes/{id}/body`는 `.write:auth!=null`이라 학생이 쓸 수 있음 → selection을 절대 scenes 아래 두면 안 됨. 그래서 aiVariants.)

## 안전 불변식 (지킴)

1. `scenes/{sid}/body` write 0 — selection은 server-only `aiVariants/textSelections`에만.
2. `getPublishedBodyDisplay`는 표시용 문자열만 반환 — `scene.body` in-memory 불변(테스트로 검증).
3. `_getDisplayBody` 토글 로직 무변경 — 발행 helper는 그 **앞단**(`_pubBody`)에 얹힘. `_orig`(진짜 원문)는 그대로.
4. 선택 없음/캐시 미적재/구작품 → 원본(브라우저 스모크: inert=원본, s2 선택 시만 발전본).

## 검증 결과

- 텍스트 resolver 18/18 · 이미지 resolver 회귀 16/16 · node --check(viewer-data/viewer-render/functions/index) OK.
- functions/rules **파일** 중: `functions/index.js`만 callable 코드 추가(미배포), rules 파일 무변경.
- secret 0.
- **브라우저 스모크**(로컬 viewer.html): `getPublishedBodyDisplay` 등 4함수 window 노출 · 캐시 없으면 원본 반환(회귀 0) · `setPublishedTextSelectionForScene('1','s2',{body})` 후 발전본 반환 · 미선택 장면 원본 · 콘솔 에러 0.
- 캐시버스터: viewer.html `viewer-data.js …textsel1` · `viewer-render.js …finishname1textsel1`.

## 남은 것 = 다음 루프(배포 승인 후)

1. **교사 발행 선택 UI** — 원본↔AI 장면발전 장면별 비교 + '원본 유지'/'AI 사용' 버튼(이미지 `viewer-image-batch-ui` 텍스트 평행). 성공 시 `setPublishedTextSelectionForScene` + 재렌더.
2. **`callApplyTextS2Selection` 배포** — 기존 ANTHROPIC 무관(quota 없음)·새 secret 0. 배포 후 UI 연결.
3. **rules 재확인 후 배포**(변경 없지만 aiVariants write:false 재확인).
4. E2E smoke(실 작품·교사 세션) + 이미지 대칭 회귀.

⚠️ **이번 인프라는 selection이 존재해야 눈에 보임 — UI+callable 배포 전까지는 완전 inert**(모든 작품 원본 표시 유지). main 병합/배포는 최종 승인 후.

## 다음 루프 명령 후보

`WRITE-AFTER-P7-TEACHER-UI-AND-DEPLOY` — 교사 선택 UI(viewer 텍스트 배치 비교) + `callApplyTextS2Selection` 배포 + E2E. **안전 모드**(배포·운영 반영이므로 승인 게이트).
