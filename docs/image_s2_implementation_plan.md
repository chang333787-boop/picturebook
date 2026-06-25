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
