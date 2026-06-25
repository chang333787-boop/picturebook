# imageS2 — 구현 계획 (설계만 · 코드 0)

> 단계: BRANCH-IMAGE-S2-PHASE-0. 정본: `가지_AI이미지_PRD_확정.md`. 기준: `origin/main 53e4c12`.
> 이 문서는 **설계 제안**이다. 실제 구현·deploy·DB write는 이후 Phase에서 별도 승인 후.

---

## 1. 저장 구조 상세

### RTDB (`classes/{classId}/teams/{enc}/...`, enc = encodeURIComponent(teamName))

#### `viewer-meta/imagePolicy`
| 필드 | 타입 | 필수 | 작성 | 수정 | 삭제 | stale | copy |
|---|---|---|---|---|---|---|---|
| sourceMode | `"upload"\|"draw"` | ✓ | 서버 callable(lock) | 서버만 | 교사 초기화(원본 전삭제 후 null) | 무관 | **복사 O** |
| lockedAtSceneId | string | - | 서버(lock 시) | - | sourceMode와 함께 | 무관 | 복사 O |
| lockedAt | number(ms) | - | 서버 | - | - | 무관 | 복사 O |
| lockedBy | uid | - | 서버 | - | - | 무관 | 복사 O |

#### `viewer-meta/imageSelections/{sceneId}` — **교사·시스템만 write** (PRD 정합, 아래 ★ 정정)
| 필드 | 타입 | 필수 | 작성 | 수정 | 삭제 | stale | copy |
|---|---|---|---|---|---|---|---|
| selected | `"original"\|"s2"` | ✓ | 교사 apply=서버 / stale복귀=서버 | **서버만(학생·클라 write 금지)** | s2 삭제 시 original | **stale 시 자동 `original`** | **복사 X(원본 시작)** |
| selectedBy | uid | - | 서버(교사 uid / system) | - | - | 자동복귀 시 system | 복사 X |
| selectedAt | number | - | 서버 | - | - | 갱신 | 복사 X |
| selectionSource | `"teacher-batch"\|"system-stale"` | - | 서버 | - | - | `"system-stale"` | 복사 X |

> ★ **학생 미리보기 정책 정정 (확정 PRD 정합 — "s2 존재 ≠ 작품 감상 선택")**
> - 학생의 **original↔s2 토글 = 개인 미리보기**. **로컬 UI 상태만** 변경(메모리 또는 작품·장면별 `sessionStorage`/`localStorage`). **RTDB `imageSelections` write 금지 · quota 0 · 타 학생·감상자 무영향.**
> - 기본값은 항상 작품의 `selected`를 따르고, 토글 시 **해당 브라우저 미리보기만** 바뀐다.
> - `imageSelections`는 **교사(`teacher-batch`)·시스템(`system-stale`)만 write.** `selectionSource:"student-manual"`은 **이번 구현에서 미사용**(향후 학생에게 작품 선택권을 별도 결정하기 전까지).
> - 새로고침 후 개인 미리보기 보존 여부는 S2-7에서 결정하되 **작품 데이터에는 저장하지 않는다.**

#### `aiVariants/image/{sceneId}/s2` — **Admin SDK only** (`database.rules.json:103 .write:false`)
| 필드 | 타입 | 필수 | 작성 | 수정 | 삭제 | stale | copy |
|---|---|---|---|---|---|---|---|
| url | string(다운로드 URL) | ✓ | 서버 | 재변환 교체 | s2 삭제·팀삭제 | 보존 | **복사 X** |
| storagePath | string(`ai-images/...`) | ✓ | 서버 | 재변환 교체 | cleanup queue 경유 | 보존 | 복사 X |
| sourceMode | `"upload"\|"draw"` | ✓ | 서버 | - | - | 보존 | 복사 X |
| basedOnImageHash | string | ✓ | 서버(`_computeImageBasedHash`) | 재변환 갱신 | - | **비교 기준** | 복사 X |
| model / modelVersion / promptVersion | string | ✓ | 서버 | 재변환 갱신 | - | 보존 | 복사 X |
| targetFrame | `{w,h,aspect}` | ✓ | 서버 | - | - | 보존 | 복사 X |
| fitPolicy | `"fit-imagecenter-landscape"` | ✓ | 서버 | - | - | 보존 | 복사 X |
| finalizedAt | number | ✓ | 서버 | 재변환 갱신 | - | 보존 | 복사 X |
| stale | bool | - | 서버(원본변경 감지) | true/false | - | **true=원본변경됨** | 복사 X |
| modifiedByUser/modifiedAt/modifiedBy | - | - | 서버 | - | - | - | 복사 X |

#### `aiJobs/imageS2/{jobId}` — **신규 노드 + 신규 Rule(교사 read·서버 write only)**
PRD §7 스키마 그대로. `status / requestedBy / createdAt / totalScenes / completedScenes / failedScenes / skippedScenes / sceneStates{sceneId:{status,attemptCount,errorCode}}`.

### Storage
```
ai-images/{classId}/{enc}/scene_{sceneId}_s2_{timestamp}.png
```
- teamName encoding: **enc = encodeURIComponent(teamName) 필요** (skeleton `_planImageS1Skeleton:244`가 이미 enc 사용).
- classId/enc/sceneId: `_sanitizeFbKeySegment`로 검증(`.#$/[]`·제어문자 차단).
- 확장자 **`.png` 고정**, contentType `image/png`, cacheControl `public,max-age=31536000,immutable`(timestamp로 캐시 무효화).
- 다운로드 URL: **Firebase download token 방식**(Admin SDK 업로드 시 `firebaseStorageDownloadTokens` 메타데이터) → `url`에 저장. signed URL(만료)보다 영속 표시에 적합.
- Storage Rule 신규: `match /ai-images/{p=**} { allow read: if true; allow write: if false; }` (Admin SDK write는 Rules 우회).
- **원본 경로(`images/...`·`viewerUploadImageToStorage`)와 완전 분리.**

---

## 2. 보안 설계 (함수 단위 SSRF 방지)

`callImageAiS2(req)` / `callStartImageS2Batch(req)` 가 **받는 값만**:
```
{ classId, teamName, sceneId, jobId?, forceRegenerate? }
```
절대 안 받음: 외부 URL · 임의 Storage path · base64 전체 이미지 · client 지정 출력 경로.

처리 순서(함수 단계):
1. `_validateRequest(req,'imageS2',{...})` — auth·testMode거부·origin allowlist·**kill switch**·aiSettings(`modes.imageS2`)·copyDepth. (재사용)
2. teacher/super_admin 확인 — `classes/{cid}/meta/teacher_uid === auth.uid || token.role==='super_admin'` (학생 차단).
3. 정본 조회 — 서버가 `scenes/{sceneId}`(imageData/imageUrl) + `viewer-meta/imagePolicy` read. **client 전달 이미지/URL 무시.**
4. 허용 경로 검증 — 입력 이미지가 `scene.imageData`(base64) 또는 우리 `images/...`/storage 버킷 path인지 확인. **외부 호스트 fetch 금지**(allowlist host = 우리 Storage 버킷만).
5. 입력 검증 — MIME(`image/*`)·바이트 크기 상한·해상도 상한·실제 decode 성공 확인.
6. **EXIF 제거**(재인코딩).
7. `basedOnImageHash = _computeImageBasedHash(src, sceneId, sourceMode)`.
8. quota/cache 판단(§3).
9. 모델 호출(고정 프롬프트, IMAGE-S2-3에선 stub).
10. 출력 검증 — MIME/해상도/decode, 안전필터.
11. `ai-images/...` Admin SDK 업로드(서버 생성 경로만).
12. 다운로드 가능 확인.
13. `aiVariants/image/{sceneId}/s2` atomic 교체(검토 G 순서).
14. 이전 storagePath → cleanup queue.
- 로그: reasonCode/sourceMode/sceneId/hash만. 원문/URL 최소화(`_logUsageStats` 패턴).

---

## 3. quota / batch / cleanup 설계

### quota (원자성)
- 단위 = **새 이미지 결과 1개 생성 성공 = 1.** 캐시 재사용 0 · 모델 실패 0 · 자동재시도 후 성공 총 1 · 명시 재변환 성공 1.
- 작품 한도 = **`max(30, sceneCount×2)`, 상한 60.** sceneCount = batch 시작 시점 본문/이미지 장면 수(서버 1회 계산, job에 고정 저장 → concurrent 변동 방지).
- 원자성: 기존 `_consumeQuota:489` transaction 패턴 확장 — **성공 직후** 작품 카운터 `.transaction(n => (n>=cap)? undefined : (n||0)+1)` (abort=cap 초과). 동시 task도 transaction 직렬화로 초과 0. 실패/캐시는 미증가(증가 자체를 성공 후에만). force regenerate 성공은 +1(이전 결과는 교체).
- 동일 `basedOnImageHash` 존재 → 재사용(차감 0). 명시 재변환은 hash 같아도 교체(차감 1).
- 전역 일일 비용 상한 + kill switch: `ai-kill-switch/enabled`(재사용) + 일일 비용 누적(`ai-stats`/신규 `ai-cost-global/{ymd}`) 초과 시 신규 생성 차단·**기존 변환본은 표시 유지**.

### batch job — 추천안 비교
| 안 | 설명 | 적합도 |
|---|---|---|
| A. Cloud Tasks(직접) | 장면별 task 직접 enqueue | 가능하나 인프라 수동 |
| B. RTDB queue + onSchedule worker | 큐 노드 + 주기 worker | 지연(분 단위)·진행률 늦음 |
| C. Pub/Sub | 토픽 발행 | 단건 retry/동시성 제어 약함 |
| **D. Functions task queue (`onTaskDispatched`)** | callable이 장면별 task enqueue, v2 task queue(=관리형 Cloud Tasks) | **추천** |
- **추천 = D.** 이유: 기존이 전부 onCall(v2)·Blaze 확정 → 추가 인프라 없이 `onTaskDispatched`로 **장면별 1 task**(timeout 회피 §3-4)·자동 retry(자동 1회 재시도 PRD §10)·`rateLimits/retryConfig`로 동시성 제어. 오케스트레이터 `callStartImageS2Batch`가 job 노드 생성 + 장면 task enqueue, 각 task가 `callImageAiS2` 로직 수행 후 `aiJobs/.../sceneStates` 갱신. UI는 job 노드 구독.
- 배포 안 함(이번 단계).

### cleanup 설계 (`onSchedule` 신규)
- **재변환 7일 유예**: 교체 시 이전 storagePath를 `cleanup-queue/imageS2/{id}={storagePath, deleteAfter:now+7d}` 기록 → 일 1회 onSchedule이 `deleteAfter` 지난 것 best-effort 삭제.
- **삭제 실패 재시도 큐**: 삭제 실패분 queue 잔류 → 다음 주기 재시도.
- **팀/작품 삭제 orphan**: 삭제 시 storagePath 수집 → RTDB 삭제 → Storage best-effort → 실패분 cleanup queue → 주기 orphan 정리.
- stale s2: 자동 만료 없음(무기한 보존, PRD §11).

---

## 4. stale · selected 상태 전이표

| 사건 | s2 | selected | 감상 표시 | 트리거 위치 |
|---|---|---|---|---|
| 최초 변환 성공 | 존재 | original(유지) | **원본** | 서버 변환 성공(생성≠공개) |
| 교사 적용 | 존재 | **s2** | **s2** | 교사 review→apply(서버) |
| 원본 변경 | **stale=true** | **original 자동복귀** | 원본 | **원본 이미지 저장 성공 지점에서만** |
| 원본 복귀(원복) | 보존 | original | 원본 | (selected 이미 original) |
| 재변환 성공 | 최신 교체 | **기존 정책 유지**(s2면 s2, original이면 original) | 정책대로 | 서버 재변환 |
| s2 삭제 | 없음 | original | 원본 | s2 삭제(서버) |

**원본 변경 감지 = 실제 이미지 "저장 성공" 지점에서만** (`viewerUploadImageToStorage` 성공 후 hash≠basedOnImageHash 비교).
다음에는 stale 처리 **안 함**: 업로드 선택만 함 / 그림판 편집 중(미저장) / 저장 실패.

---

## 5. UI 구현 위치 (이번 단계 미구현 — 위치만 확정)

| 대상 | 화면/기능 | 파일·함수 |
|---|---|---|
| 교사 | 전 장면 변환 트리거 | `viewer-render.js` HUD(더보기) + `viewer-ai.js` AI 모달 |
| 교사 | 진행률/취소/부분실패 요약/성공분 적용/재시도/보류 | `viewer-ai.js`(job 노드 구독), 신규 review 패널 |
| 학생 | original/s2 개인 미리보기(quota 0, 생성버튼 없음) | `viewer-render.js`/`viewer-data.js` 렌더 분기 + 토글 = **로컬 상태(sessionStorage/메모리), RTDB write 0** |
| 감상자 | selected 이미지만 + s2 배지(토글 없음) | `viewer-data.js`(이미지 src 결정) + `viewer-render.js`(배지) |
| 관리자 | imageS2 gate / 일일 사용량 / kill switch / 모델 설정 / soon 유지 | `adminConsole.js:327`(이미 배선, soon:true 유지) |

selected 이미지 결정 헬퍼(신규): `imageSelections[sceneId].selected==='s2' && aiVariants.image[sceneId].s2 && !stale ? s2.url : 원본`.

---

## 6. 구현 Phase 로드맵

> 순서 원칙: **stub → 저장/상태/UI 검증 → 모델 평가 → provider 연결.** 모델 먼저 연결 금지.

| Phase | 범위 | 수정 파일 | 데이터 변경 | 테스트 | rollback | deploy |
|---|---|---|---|---|---|---|
| **S2-1** | 데이터 구조·정규화·selected/stale 헬퍼 | viewer-data.js, viewer-render.js | imageSelections 읽기(write 없음) | fixture 렌더(original 폴백) | 코드 revert | 없음 |
| **S2-2** | sourceMode 서버 lock(트랜잭션) | functions/index.js, viewer-ai.js | imagePolicy 서버 write | 에뮬 트랜잭션 동시성 | 함수 미배포 시 클라 유지 | functions(승인 후) |
| **S2-3** | 단일 장면 Functions skeleton(모델=stub) | functions/index.js | aiVariants write(stub url) | 에뮬 호출→stub | callImageAiS1 보존 | functions |
| **S2-4** | Storage 안전 교체 + cleanup queue | functions/index.js | ai-images 업로드, cleanup-queue | 에뮬 교체순서·유예 | gate off | functions + Storage Rule |
| **S2-5** | 교사 batch job(onTaskDispatched) | functions/index.js | aiJobs 노드 | 에뮬 다장면 job | job 미생성 | functions + aiJobs Rule |
| **S2-6** | 교사 review/apply UI | viewer-ai.js, viewer-render.js | imageSelections 교사 적용 | preview 시나리오 | UI gate | 없음(클라) |
| **S2-7** | 학생 preview + 감상 selected 렌더 + 배지 | viewer-data.js, viewer-render.js, viewer.css | **로컬 미리보기 상태(sessionStorage/메모리), RTDB write 0** | 5뷰포트 렌더 | gate off=원본 | 없음(클라) |
| **S2-8** | 모델 평가·provider 결정 | (문서/하니스) | 없음 | 평가표 | - | 없음 |
| **S2-9** | 실 provider 연결(stub→real) | functions/index.js, secret | 실 변환 | 운영 smoke(소량) | provider flag | functions + secret |
| **S2-10** | quota·kill switch·운영 QA | functions/index.js, adminConsole.js | 카운터 | 한도/킬스위치 | soon 복귀 | functions |

총 **10 Phase**. 각 Phase는 단독 rollback 가능(기능 게이트 off=원본 무영향, PRD §15).

---

## 7. IMAGE-S2-2 구현 결론 (sourceMode 서버 원자 잠금 · 2026-06-25)

> branch `feature/image-s2-2`. deploy 0 · main 병합 0 · 모델/Storage/aiVariants write 0.

### transaction 경로
`classes/{classId}/teams/{enc}/viewer-meta/imagePolicy` (enc = encodeURIComponent(teamName)).
서버 callable `lockImageSourceMode`가 RTDB `.transaction()`(CAS + 자동 재시도)으로만 기록.
순수 결정 로직은 `functions/image-s2-policy.js` `decideSourceModeLock` (firebase 비의존 → 단위·동시성 시뮬 테스트).

### 잠금 결정 (idempotent / conflict)
- 현재 미설정 → 요청 모드로 lock. 서버가 `{sourceMode, lockedAtSceneId, lockedAt(서버시각), lockedBy(auth.uid)}` 기록.
- 동일 모드 후속 → **idempotent 성공**(콜백이 abort → 기존 lockedAt/lockedBy 보존, 미기록).
- 반대 모드 → `{ok:false, code:'SOURCE_MODE_CONFLICT', currentSourceMode}` (정상 반환, throw 아님 → 클라가 안내).
- 원자성: 각 transaction 재시도마다 `decideSourceModeLock(현재값, req)` 재평가 → 늦은 반대 요청은 자동 conflict. 동시성 시뮬(10회 양방향) + 동일모드(idempotent) + 기존모드충돌 테스트로 win-once 실증.

### 선택한 저장/lock 순서 — **B안 (저장 성공 후 lock)**
- 현재 코드 구조: 원본 이미지 저장(`viewerUploadImageToStorage`/그림판)과 sourceMode lock이 분리돼 있고, lock은 AI 이미지 흐름 진입 시점(`_ensureImagePolicyBeforeImageAi`)에 호출됨 → **이미 원본이 존재하는 상태에서 lock**(=B안 성격).
- A안(예약 후 rollback)은 업로드 orchestration을 크게 재구성해야 하므로 회귀 위험이 큼. 기존 저장 구조가 "저장→lock"이라 **B안이 더 안전**.
- conflict 처리: 클라(`_saveImagePolicy`)가 conflict 응답을 받으면 `_loadImagePolicy(force)`로 잠긴 모드를 재로드하고, AI 흐름은 잠긴 방식으로 진행 + 안내 토스트. 직접 RTDB write는 제거됨.
- ⚠️ **미완(후속/리뷰)**: "원본 raw 저장 지점(viewer-edit.js)마다 lock 호출 + 패배한 반대 모드 원본 정리(loser cleanup) + 두 브라우저 functions-emulator E2E"는 이번 단계에 **미연결**(lock은 AI 흐름 시점). 콜러블 계약은 이를 지원하며, 라이브 wiring은 회귀 위험 분리를 위해 리뷰 후 진행.
- rollback 실패 시: `LOCK_ROLLBACK_FAILED`(클라 측 패배 원본 제거 실패) — 원본은 남기고 사용자에게 안내(서버 lock 무결성은 유지). (loser cleanup 구현 시 적용)

### 권한 (AI 게이트와 분리)
신규 `_validateSourceModeRequest` — `_validateRequest`(aiSettings/quota/kill switch) **미사용**. auth + testMode거부 + origin allowlist + class/team 소속만. lock = active member ∥ teacher(teacher_uid 일치) ∥ super_admin. reset = teacher ∥ super_admin만(학생 거부). → **AI가 꺼져 있어도 원본 upload/draw 선택 정상 작동.**

### 교사 초기화 `resetImageSourceMode`
교사/super_admin만. 서버가 `scenes` 전체를 읽어 `imageData`/`imageUrl`이 하나라도 있으면 `{ok:false, code:'SOURCE_IMAGES_REMAIN'}`. 전무할 때만 `imagePolicy` transaction clear(null). 학생 호출 거부.

### 오류 코드
`UNAUTHENTICATED`(throw) · `PERMISSION_DENIED`(throw) · `INVALID_SOURCE_MODE`(throw) · `SOURCE_MODE_CONFLICT`(return) · `SOURCE_IMAGES_REMAIN`(return) · `LOCK_ROLLBACK_FAILED`(loser cleanup 단계) · `INTERNAL`(throw). 내부 경로/UID/Storage URL 미노출.

### Rules 변경 여부 — **없음 (emulator 실증)**
`viewer-meta`는 `.write:"auth != null"`. 그 아래 `imagePolicy{.write:false}` child rule을 넣어 emulator로 테스트한 결과 **멤버·교사 write가 그대로 성공**(RTDB는 상위 .write grant가 하위로 상속 → 자식이 취소 불가). 따라서 ineffective한 규칙은 **넣지 않음(원복)**.
- **정확한 표현(S2-2A §9 정정)**: 공식 앱 코드의 imagePolicy 직접 write 경로 **제거 완료**. **Rules 레벨 직접 write 차단은 미완료**(인증 사용자는 규칙상 여전히 imagePolicy write 가능 = 잔여 위험). "Admin SDK 단독 작성/차단 완료"로 표현하지 않는다.
- **완전한 Rules 차단**: `viewer-meta` 블랭킷 `.write` 제거 + 자식별 grant 재구조화(모든 클라 작성 child 열거 필요) → 회귀 위험으로 **후속 Security Phase**. `tests/rules/image-s2-policy-rules.test.js`가 현 cascade 동작을 잠가 둠(재구조화 시 깨져 알림).

### client 직접 write 경로 제거
`viewer-ai.js` `_saveImagePolicy`의 `app.database()...imagePolicy.set()` 제거 → `lockImageSourceMode` 콜러블 호출로 교체. 공식 앱 코드엔 직접 imagePolicy write 경로 0(grep 확인). 기존 작품 읽기·정규화는 S2-1 helper 사용. (Rules 레벨 차단은 위 잔여 위험 참고.)

### 동시성 결과
`tests/image-s2-policy` 11/11(순수 결정 + CAS 시뮬: upload vs draw ×10 한쪽만 lock·반대 conflict·최종 단일 모드 / upload×2 idempotent·최초 메타 유지 / 기존 upload→draw 차단 / 교사 초기화 가부).

---

## 8. IMAGE-S2-2A 완성 — 실제 저장 흐름 연결 + B안 (2026-06-25)

> branch `feature/image-s2-2`. deploy 0 · main 병합 0.

### 실제 저장 연결 위치 (전수)
| 입력 방식 | 위치(viewer-edit.js) | 저장 후 lock 호출 |
|---|---|---|
| 파일 업로드 | `_bindPbImageActions` `.js-pb-image-upload-input` change | `_lockSourceModeAfterImageSave('upload', ...)` |
| 그림판 저장 | `_openPbDrawModal` `.js-pb-draw-save` click | `_lockSourceModeAfterImageSave('draw', ...)` |
| 이미지 교체/변형/크롭 | 기존 이미지 수정(모드 불변) | lock 불필요(이미 잠김 → idempotent) |
| 삭제 | imageData=null | lock 무관 |
- AI 메뉴 `_ensureImagePolicyBeforeImageAi`는 **최초 결정자 아님**으로 축소(주석): 기존 sourceMode 읽기 + sourceMode 없는 기존 작품만 모달 보조(자동 추정 금지). 신규 정상 작품은 첫 원본 저장 때 이미 잠김.

### 선택한 rollback 방식 (B안)
순서: ①원본 저장(Storage 업로드 + scene.imageData + queueSave/flush) → ②`lockImageSourceMode` 콜러블 → ③ok/idempotent면 통과 / conflict면 rollback.
- rollback(viewer-ai `_lockSavedImageSourceMode` + `_casRestoreSceneImage` + `_deleteImageStorage`):
  - **DB scene 이미지 CAS 복원**: `scene.imageData` transaction에서 `cur===after면 before로, 아니면 cur 반환`(abort 아님). non-match를 cur로 반환해야 mismatch 시 RTDB가 서버값으로 자동 재실행 → **영속연결 없는/optimistic 환경에서도 안전**(emulator 실증). 타인의 이후 저장(값 다름)은 **보존**.
  - **신규 storage 파일만 삭제**(이번에 만든 `after.storagePath`). 기존 정상 이미지 미삭제.
  - 메모리/화면도 `before`로 되돌리고 안내 alert.
- **안전 기본값**: lock 호출 실패/권한/네트워크 → 원본 **유지**(rollback 안 함, 작업 보호). conflict일 때만 rollback.
- rollback 실패(restore throw 또는 storage delete 실패) → `LOCK_ROLLBACK_FAILED` + orphan 기록(콜러블 layer는 console.warn; 정식 cleanup-queue는 Storage 단계에서 §11와 통합 예정).

### 경쟁 결과 (emulator 실증)
`tests/rules/image-s2-lock-emulator.test.js`: 실제 RTDB transaction 2개를 Promise.all 동시 실행 ×10(양방향) → **한쪽만 lock·최종 단일 모드·반대 conflict**. 동일 모드 동시 → 한 번만 기록. scene CAS 복원 → 현재값===after면 복원, 타인 이후 저장이면 보존. `tests/image-s2-policy`: orchestration 전 분기(lock/idempotent/conflict-rollback/CAS-preserve/rollback-fail/kept-on-error/corrupt-kept) stub 검증.

### 패자 DB 정리 / Storage 정리
- DB: 패자 scene.imageData를 CAS로 before 복원(타인 저장 보존). 단순 `=null` 금지 — `cur===after`일 때만.
- Storage: 패자가 방금 만든 파일만 `storage().ref(after.storagePath).delete()`. 실패 시 LOCK_ROLLBACK_FAILED.

### reset 경쟁 결과
`resetImageSourceMode`: scenes empty 확인 → 현재 imagePolicy 캡처(prev) → CAS transaction(`현재===prev`일 때만 null) → clear 후 scenes 재확인. 그 사이 lock 변경 또는 새 저장 → `RESET_RACE_RETRY`(교사 재시도). 이미지 존재+policy 없음 상태를 reporting하지 않음(racing 저장의 lock이 policy를 다시 박아 수렴).

### 비정상 policy 처리
`classifyPolicy`: null/sourceMode 필드 없음 → `absent`(lock 허용) / upload|draw → `valid` / 객체에 비정상 sourceMode(예 'paint')·객체 아님 → `corrupt`. corrupt면 `decideSourceModeLock`이 자동 덮어쓰지 않고 `CORRUPT_IMAGE_POLICY` 반환 → 콜러블 `{ok:false, code}`, 클라는 원본 유지 + 교사 안내. **자동 복구 폐기**(기존 'paint'→lock 동작 변경). ⚠️ 운영 DB에 실제 비정상 값이 있는지 read-only 스캔은 **미수행**(운영 접근 회피) — 마이그레이션 필요 시 교사용 1회 점검으로 분리 권장.

### 오류 코드(추가)
기존 + `CORRUPT_IMAGE_POLICY` · `LOCK_ROLLBACK_FAILED` · `RESET_RACE_RETRY` · `LOCK_CALL_FAILED`(클라, 원본 유지).

### Rules 잔여 위험
§7 정정 그대로: 공식 앱 직접 write 경로 제거 완료, **Rules 레벨 차단 미완료**(인증 사용자 imagePolicy write 가능). 후속 Security Phase에서 viewer-meta write 재구조화.

### 미검증(리뷰 게이트)
- 실제 **두 브라우저/iPad + 실 Firebase** 동시 저장 E2E는 미수행(여기선 DB emulator + stub로 transaction/CAS/orchestration 검증). 정상(비충돌) 저장 경로는 기존 동작 + lock 호출 추가뿐(원본 무영향). 라이브 conflict-rollback 실사용 확인은 사용자 QA 권장.

---

## 9. IMAGE-S2-2A-FIX1 — gate-first 재설계 (원본 유실 차단 · 2026-06-25)

> branch `feature/image-s2-2`. deploy 0 · main 병합 0. **§8의 "저장 후 rollback(B안)"은 본 절로 대체됨.**
> 리뷰 CHANGES_REQUIRED(C1/C2/H1) 해소.

### 핵심 설계 전환 — "패자는 scene.imageData를 애초에 안 쓴다"
순서 변경: **사전 게이트 → 고유경로 업로드 → 서버 lock → ok일 때만 scene.imageData 기록.**
- 패자는 conflict 시 scene을 *기록하지 않으므로* 승자/기존 이미지 유실이 **구조적으로 불가**(C2 제거). DB CAS/token rollback **폐기**(`_casRestoreSceneImage` 삭제).
- 고유경로라 업로드가 기존 Storage 객체를 **덮지 않음**(C1 제거).
- lock이 scene 기록보다 *먼저*라 flush·lock 경쟁이 사라짐. 성공 시 `await _flushPendingSave()`(H1 제거).

### C1 — 저장 전 게이트 + 고유 경로
- `_preCheckSourceMode`(viewer-ai, `decidePreGate` 정합): 업로드 *전* 현재 정책 읽고 반대 모드면 `SOURCE_MODE_CONFLICT`로 **업로드도 scene 변경도 안 함**. corrupt는 클라 sanitize로 못 잡으면 서버 lock이 차단. **read 실패=hold(fail-open 금지)**.
- 신규 경로 `images/{cid}/{enc}/{sceneId}/{uniqueId}.{ext}`(`_viewerImageStoragePath`/`buildImageStoragePath`). uniqueId=crypto.randomUUID()(+fallback). 세그먼트 안전화·traversal 차단·ext MIME allowlist. **불변식: 신규 원본 저장은 항상 새 객체 생성, 기존 객체 overwrite 0.** 기존 deterministic URL은 scene.imageData에 저장돼 그대로 읽힘(마이그레이션 0).

### C2 — rollback ownership: 채택 = "scene write를 lock 성공 뒤로" (token 불필요)
- token/transient 메타 없이 **순서 교정**만으로 해결(더 작고 안전). `_commitImageSourceMode`: lock ok→`{ok:true}`(호출부가 scene 기록) / 실패→**이번 고유 객체만 삭제**(prefix `images/` 검증, downloadURL 역추정 안 함)·scene 무변경.
- 실 RTDB 통합 테스트(`store: 같은 빈 장면 …`): 같은 빈 장면 동시 upload/draw → 승자 scene 유지·패자 미기록·패자 고유객체만 삭제·유실 0.

### H1 — 순서 보장
업로드/그림판 모두: ①게이트 ②고유 업로드 ③`_commitImageSourceMode`(lock) ④ok면 scene.imageData=url + `await _flushPendingSave()`. lock은 scene 기록 *이전*이라 flush 경쟁 없음.

### M1 — reset 경쟁(optimistic-null) 보강
`resetImageSourceMode` transaction을 `cur => _imagePolicyEq(cur, prev) ? null : cur`(non-match면 abort 대신 cur 반환 → mismatch 시 server값 재실행) + **clear 재확인**(`classifyPolicy(after)!=='absent'면 RESET_RACE_RETRY`). emulator로 정상/racing/absent/corrupt 검증.

### 동일/다른 장면 경쟁 결과
- 다른 장면(의도된 충돌): 각 장면 독립 → 승자 정책 1개, 패자 장면 미기록(유실 0).
- 같은 장면(advisory lock 우회·동시): 승자 scene 유지, 패자 미기록(유실 0). gate-first라 CAS 무관.

### orphan 처리
패자 객체 삭제 실패 → `runImageSourceCommit`이 `recordOrphan` 어댑터 호출(클라는 현재 console.warn + `storageDeleted:false`). scene/기존 데이터는 무손상. **persistent orphan 기록(서버 cleanup-queue)은 M2 후속**.

### 표현 정정
- "교체는 항상 idempotent" 삭제 — 교체도 같은 upload 핸들러라 반대 모드면 게이트에서 차단(idempotent 아님).
- Rules 레벨 직접 write 차단 **미완료** 유지(§7) — 공식 앱 코드 경로만 제거.

### 잔여 위험
- 실 두 기기 Firebase E2E·실 Storage emulator 미사용(여기선 DB emulator + fake storage). 정상 경로는 기존+lock 호출이며 scene write가 lock 뒤라 안전.
- M2 persistent orphan 후속. Rules 레벨 차단 후속(Security Phase).
