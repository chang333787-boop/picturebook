# imageS2 — 코드 정밀 대조 (READ-ONLY AUDIT)

> 단계: **BRANCH-IMAGE-S2-PHASE-0 / 조사·설계만.** 코드 0 수정 · 모델 호출 0 · deploy 0 · DB write 0.
> 정본: `가지_AI이미지_PRD_확정.md` (이 문서만 정본. `설계_p5`·`PRD_초안`·imageS1 문서는 비정본).
> 기준 커밋: `origin/main = 53e4c12` (worktree `picturebook-image-s2`, branch `feature/image-s2-phase0`).
> 모든 라인 번호는 위 커밋 기준.

---

## 0. 한눈에

| 키워드 | 매치 | 상태 |
|---|---|---|
| imageS1 | 22 | skeleton 존재(폐기 대상·s2 템플릿으로 활용) |
| imageS2 | 6 | adminConsole 배선 + `_validateRequest` MODE_KEY_MAP만 |
| callImageAi | 5 | `callImageAiS1` skeleton(functions) + 클라 호출(viewer-ai) |
| sourceMode | 17 | viewer-ai.js imagePolicy(클라 read/write) |
| aiVariants/image | 6 | skeleton 계획 문자열만(실 write 0) |
| imageSelections | **0** | **신규** |
| aiJobs | **0** | **신규** |
| fitPolicy | **0** | **신규**(PRD 필드) |
| killSwitch(리터럴) | 0 | 실제는 `ai-kill-switch/enabled` 노드로 존재(재사용) |
| imageCenter | 63 | 그림중심형 렌더/스킨(실측 비율 근거) |
| quota | 83 | `_consumeQuota` transaction + 환불 패턴 존재(재사용) |
| viewerUploadImageToStorage | 6 | **원본 업로드 경로 — s2 재사용 금지 대상** |

---

## 1. 구조표 (영역 × 현재 코드 × 처리)

| 영역 | 현재 코드 (file:line) | 사용 | PRD 충돌 | 처리 |
|---|---|---|---|---|
| imageS1 skeleton | `functions/index.js:2017` `callImageAiS1` / `:220` `_planImageS1Skeleton` / `viewer-ai.js:2619-2623` | 예(미완) | imageS1 폐기 | **s2 템플릿으로 복제** 후 imageS1 제거(후속) |
| imageS2 admin gate | `adminConsole.js:327,348,431` (`imageS2 soon:true`) | 예 | 없음 | **재사용** — 모델·QA까지 soon 유지 |
| image upload(원본) | `viewer-edit.js:305` `viewerUploadImageToStorage` → `images/...` | 예 | **재사용 금지** | s2는 별도 `ai-images/...`·Admin SDK |
| drawing canvas | `viewer-edit.js:5496+` `_openPbDrawModal` → 동일 업로드 | 예 | 없음 | s2 입력 소스(원본). 변환은 서버가 read만 |
| Storage upload(s2) | `_planImageS1Skeleton:244` 계획 문자열만 | 아니오 | 없음 | **신규**(Admin SDK 업로드) |
| AI settings 게이트 | `functions/index.js:367,406-414` `aiSettings.enabled+modes[modeKey]` / `MODE_KEY_MAP:404`에 `imageS2:'imageS2'` | 예 | 없음 | **그대로 재사용** |
| quota | `:489` `_consumeQuota`(transaction +1) / 환불 `:519-528` / `QUOTA[mode]` `:459` | 예 | 부분(한도 계산식) | 게이트·증감·환불 재사용, **작품 한도식 imageS2 전용 동적화** |
| kill switch | `:388` `ai-kill-switch/enabled` read / Rule `database.rules.json:124` `.write:false` | 예 | 없음 | **그대로 재사용** + 전역 일일 비용상한 추가 |
| Functions helper | `_validateRequest:331` · `_computeImageBasedHash:213` · `_sanitizeFbKeySegment:204` · `isOriginAllowed:113` | 예 | 없음 | **그대로 재사용** |
| safety/precheck | `_checkS2SceneCap:1464`(=텍스트 s2) · `prompts.js` preservedCheck | 텍스트만 | 이름충돌 | 이미지용 별도 precheck 신규(텍스트 것 미혼용) |
| copy work | `firebase.js:1113` `redeemCopyCode`(클라) | 예 | **있음** | viewer-meta 통째복사 → `imageSelections` strip 필요 |
| team delete | (서버 orphan 정리 없음) | 아니오 | 없음 | **신규** cleanup(§아래) |
| viewer selected image | (없음, `imageSelections` 0) | 아니오 | 없음 | **신규** 렌더 분기 |
| stale detection | `_computeImageBasedHash:213` 존재(비교 로직은 없음) | 부분 | 없음 | hash 재사용, stale 비교는 신규 |

---

## 2. imageS1 잔재 / 재사용 helper

**폐기해야 할 imageS1 잔재**
- `functions/index.js:2017` `exports.callImageAiS1` (skeleton) → `callImageAiS2`로 대체.
- `functions/index.js:220` `_planImageS1Skeleton`(`s1` 경로 문자열) → s2 버전으로 복제.
- `viewer-ai.js:2555,2619,2623` 클라 `callImageAiS1` 호출 블록.
- `adminConsole.js:326,348,431` `imageS1` 모드 항목(`soon:true`) → 제거(또는 비표시).
- ⚠️ imageS1 전용 가정 잔재: **없음** — skeleton은 `s1` 문자열·경로 suffix만 박혀 있어 `s2`로 치환 가능(구조 종속 없음).
- ⚠️ 기존 `images/...` 경로 재사용 시도: skeleton은 `ai-images/...`만 계획(주석 `functions/index.js:243`에서 명시적으로 `images/.../scene_{N}` 미사용) → **원본 경로 오염 위험 코드 없음.**

**그대로 재사용 가능한 helper (검증됨)**
- `_validateRequest(req, mode, opts)` `:331` — auth/testMode거부/classId·teamName/copyDepth≤1/origin allowlist/**kill switch**/aiSettings(enabled+modes)·aiPermission fallback. `MODE_KEY_MAP`에 `imageS2` 이미 존재(`:404`).
- `_consumeQuota(ctx)` `:489` — 작품/root/전역 카운터 `.transaction(+1)` 원자 증가, 실패 환불 `:519-528`.
- `_computeImageBasedHash(src, sceneId, sourceMode)` `:213` — 원본 image hash(원문 비노출). stale/cache 키로 재사용.
- `_sanitizeFbKeySegment` `:204` — path injection 차단.
- `isOriginAllowed` `:113` · `_todayYmd` `:123` · `_logUsageStats` `:2084`(ai-stats).
- 입력 sanitizer 패턴 `_sanitizeVariantTextStyle:305`/`_sanitizePbBodyBox:264` — 이미지 입력 검증 템플릿.

---

## 3. PRD 미결 8건 — 코드 대조 결과

### 3-1. 그림중심형 실측 비율·px
- 그림중심형 = `.scene-screen--pb.pb--imagecenter`.
- 페이지 비율(`.scene-screen--pb .pb-page`):
  - **편집/다듬기 = A4 가로 `297/210`(=1.414)** `v03-modes.css:243`.
  - **감상(가로 화면) = `3/2`(=1.5) 완화** `v03-modes.css:281-284` (VIEWER-PLAY-ASPECT-1A, `body:not(.edit-mode-active):not([data-page-orientation=portrait])` + `@media min-width:601 and min-aspect-ratio:1/1`).
  - 세로 작품 = `210/297` `:302,:310`.
- 이미지 fit: **`object-fit: contain` · cover 금지 · 자르기 없음 · 여백=테마 무대색** `v03-modes.css:5050`. (학생 그림 안 자름 원칙)
- **제안 targetFrame/fitPolicy**:
  - `fitPolicy:"fit-imagecenter-landscape"` (PRD 그대로).
  - `targetFrame.aspect = 3:2`(감상 최대폭 기준). A4(1.414)에서도 contain이면 미세 letterbox만 → 배경 가로 연장으로 3:2를 채우면 양쪽 무대색 여백 최소화.
  - 저장 목표 px 제안: **1536×1024(3:2)**. 입력 압축 장변 1600px(PRD §6)과 정합, contain이라 PC/태블릿 공통 사용. 세로작품은 imageS2 1차 범위에서 제외 권고(가로 프레임 전제).

### 3-2. sourceMode 동시 경쟁 lock
- 현재: **클라 `.set()`** — `viewer-ai.js:1538` `app.database().ref(base+'/viewer-meta/imagePolicy').set(clean)`. 트랜잭션/콜러블 아님.
- Rule `viewer-meta .write:"auth != null"` `database.rules.json:66` → 누구나 덮어쓰기 가능(원자성 없음).
- **결론: 비원자 클라 write → 최초 성공 lock 보장 불가.** PRD §5·§16대로 **서버 callable 트랜잭션으로 격상 권고** (`if(!exists) set` 형태의 RTDB transaction, 뒤 요청 차단). IMAGE-S2-2에서 구현.

### 3-3. 제출/완성/공개 상태
- 검색 결과: 작품 단위 `submitted`/`finalized`/`isPublic publish`/`locked` **없음**.
  - `finalized`는 **텍스트 AI 변형 전용**(`viewer-ai.js:814,1165` `textS1/textS2.status:'finalized'`).
  - `isPublic`은 감상 공개 플래그(제출 아님).
  - `finish()`는 모달 confirm 헬퍼(`viewer-edit.js:69`).
- **결론: 제출 상태 없음 → PRD §8 "제출 후 재변환 잠금"은 억지 구현 금지. "현재 제출 상태 없음 → 별도 후속 기능"으로 확정.**

### 3-4. timeout / memory / retry
- 현재 Functions는 전부 `onCall({enforceAppCheck:false})` 기본값(명시 timeout/memory 미설정). 텍스트 대형작품은 출력 chunking으로 처리(T2-INFRA-1).
- **모델 미정 → 최종 수치 미확정.** 단일 장면 이미지 변환은 별도 함수+장면별 작업으로 쪼개 timeout 회피(§batch).

### 3-5. 배경 연장 자연스러움
- 코드 항목 아님 → 모델 평가 항목으로 유지. 기준 = 실프레임 3:2/1.414에서 **원본 콘텐츠 영역 밖(좌우)** 만 연장, PRD §6 허용/금지선 적용. eval 문서에 반영.

### 3-6. 일괄 UX (job 상태)
- 재사용 가능: adminConsole job/progress 패턴은 없음(이미지 batch는 신규). 텍스트 AI 모달 진행 패턴(viewer-ai) 참고.
- 상태별 UI 초안(§구현계획): `queued`(대기)·`running`(N/총 진행바)·`partial`(성공X/실패Y 요약+선택)·`completed`(성공 적용 버튼)·`failed`(전체 실패 안내+재시도)·`cancelled`(진행분 보존 안내).

### 3-7. 감상 배지 위치
- imageCenter는 이미지가 페이지 거의 전체(8.9:1.1 grid). 본문/말풍선은 하단 밴드.
- **제안: 페이지 좌상단(또는 우상단) 코너 작은 pill "AI로 그림책풍 변환"**, `object-fit:contain` 여백(무대색) 위가 아니라 `.pb-page` 모서리 inset. 그림·말풍선·선택지 버튼 비침범. 구현은 IMAGE-S2-7(이번 단계 미구현).

### 3-8. copy 충돌
- `firebase.js:1113 redeemCopyCode`(클라 multi-path update):
  - `:1162` `scenes` 통째 복사 → **원본 이미지(imageData/imageUrl) 복사 O** ✓(PRD §12).
  - `:1150,1163` `viewer-meta = Object.assign({}, srcMeta, {isPublic:false, copiedFrom})` 통째 복사 → `imagePolicy`(sourceMode) **복사 O** ✓ / **`imageSelections`도 통째 복사 ✗**(PRD: 복사본은 original 시작).
  - `aiVariants`는 viewer-meta·scenes 형제 노드라 **미복사** ✓(s2 복사 안 함, PRD §12). + Rule `.write:false`라 클라가 복사 불가(이중 안전).
- **수정 경로(후속 구현)**: `redeemCopyCode`의 `dstMeta` 생성 직후 `delete dstMeta.imageSelections;` (또는 명시 `imageSelections:null`). imagePolicy는 유지. → 복사본 = sourceMode 보존 + 전부 original 선택 + s2 없음.

---

## 4. 인프라 결론

- **batch 인프라 없음**: `functions/index.js`는 전부 `onCall` 동기. `onSchedule`/`pubsub`/`onTaskDispatched`/scheduler **0건**. → batch·cleanup·orphan 정리용 스케줄/큐 **신규 필요**.
- **Blaze 확정**: `@anthropic-ai/sdk`(`functions/index.js:38`) 아웃바운드 사용 → Cloud Tasks / Cloud Scheduler / Pub-Sub 모두 사용 가능.
- **Rules 현황**(재사용/신규):
  - `aiVariants .read:true/.write:false` `:103-106` → **이미 Admin SDK 전용**(PRD §11 그대로). `aiVariants/image/{sceneId}/s2` 그대로 상속.
  - `viewer-meta .write:"auth != null"` `:66` → `imagePolicy`/`imageSelections` 클라 쓰기 가능(현 sourceMode·학생 선택). teacher-batch 선택·lock은 서버 격상.
  - `ai-kill-switch .read:true/.write:false` `:124` · `ai-usage*/ai-stats .read:false/.write:false` `:112-131` → Admin 전용 재사용.
  - **신규 Rule 필요**: `aiJobs/imageS2/{jobId}`(교사 read·서버 write only), Storage `ai-images/**`(클라 read·write:false). (이번 단계 미배포)
- **Storage 현황**: `images/** read:true,write:authed`(원본) `storage.rules:6`; `videos/**`; **catch-all `/{allPaths=**} read,write:false`** `:25` → `ai-images/`는 현재 클라 read 불가 → s2 표시용 read Rule 신규.

---

## 5. ⚠️ 이름 충돌 경보 (구현 시 필수 주의)
- **"s2"는 두 가지**: ① 텍스트 AI 2단계(`textS2`, `_checkS2SceneCap`, `S2_MAX_SCENES`, `callTextAiBatchS2`) ② 이미지 feature(`imageS2`). **혼용 금지.** 이미지는 항상 `imageS2`/`image/.../s2` full path로 명명.
- `aiVariants`: 텍스트는 **localStorage mock**(`viewer-ai.js:46` `pb_ai_variants_v140`), 이미지는 **RTDB**(`aiVariants/image/{sceneId}/s2`, Admin write). 저장 위치가 다름.
