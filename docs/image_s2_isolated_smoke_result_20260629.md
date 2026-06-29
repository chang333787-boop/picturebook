# imageS2 격리 실변환 smoke 결과 (2026-06-29)

> IMAGE-S2-ISOLATED-REAL-SMOKE-LOOP (A경로). feature `feature/image-s2-first-generation` (29d683d 기준).
> **실학생 데이터 미사용 · main 병합 없음 · 전체 공개 없음 · 원본 무변경.** 판정: **IMAGE_S2_ISOLATED_REAL_SMOKE_PASS**.

## 1. 방법 (A경로)
- 로컬 정적 서버로 feature 브랜치 앱 구동(`http://127.0.0.1:8765`, ALLOWED_ORIGINS 포함 포트). 실제 배포된 Functions + 운영 Firebase(picturebook-8731f) 사용.
- Playwright 새 세션 익명 로그인 → **UID `KhqcbZ…`**.
- 이 UID를 teacher_uid로 하는 **비공개 테스트 fixture**를 운영 DB에 1회 생성(admin write):
  - class `cls_smoke_20260629`(name `IMAGE_S2_SMOKE_20260629`, code SMOKE1), team `smoke_image_s2`.
  - scene 1 = imageCenter 그림책 장면, `imageData`=합성 테스트 PNG(data: URI, 캐릭터 1명·개인정보 0, raster.js drawA).
  - `viewer-meta/imagePolicy.sourceMode='upload'`, `aiSettings{enabled:true, modes.imageS2:true}`.
- 변환은 **배포된 콜러블을 페이지의 실제 인증 세션으로 호출**(UI 버튼이 호출하는 것과 동일 경로).

## 2. 결과
| 검증 | 결과 |
|---|---|
| teacher_uid 일치 | ✅ fixture meta.teacher_uid == Playwright 세션 UID(`KhqcbZ…`) |
| `callStartImageS2Batch` | ✅ ok, jobId 발급, targets=['1'], estCost $0.05 |
| `callImageAiS2` (실 변환) | ✅ status=succeeded, **~77초**, model=gpt-image-2, promptVersion `imgS2-fixed-v1`, targetFrame 1536×1024 3:2, stale=false, **quotaConsumed=1** |
| 결과 저장 | ✅ `aiVariants/image/1/s2`(url·storagePath) + Storage `ai-images/cls_smoke_20260629/…/scene_1_s2_*.png` |
| 결과 다운로드 | ✅ HTTP 200, 2,450,190 bytes, image/png |
| **원본 불변** | ✅ scene.imageData sha256 = `e9f6a762…87c86` (변환 전=중=후 **동일**) |
| `callApplyImageS2Selection` | ✅ selected='s2' ok, selected='original' ok |
| 선택 저장 경로 | ✅ `aiVariants/imageSelections/1`(서버전용, selectionSource='teacher-batch', selectedBy=`KhqcbZ…`) — 클라 직접 DB write 0 |
| 교사 UI 버튼(live) | ✅ from=maker 세션에서 `🖼 AI 그림책 마감`(`#imageS2-batch-entry`) **visible** — feature UI가 실 Firebase에서 정상 배선(기존 NOT_VERIFIED 해소) |
| 학생 미노출 | ✅ from=maker 없는 세션: isTeacherSession=false, 버튼/엔트리 **미존재** |
| Functions 로그 | ✅ `[ai/imageS2] result` status=succeeded·code=null·reused=false, refusal/timeout/error 0 |
| 비용/시간 | 실 호출 1회 ≈ **$0.05**, ~77초 |

## 3. 안전 확인
- 실학생 데이터 미사용(합성 PNG). junglim 실학급 플래그 **미접촉**(여전히 imageS2=false).
- main 병합 없음. 전체 공개 없음. 대량 변환 없음(1회). 자동 재시도 없음.
- 원본 scene.imageData 어떤 경로로도 미수정(hash 불변 입증).
- live 감상 렌더 resolver 미연결(설계대로 — 교사 선택 저장까지만 검증).

## 4. 정리 상태 — ✅ CLEANED (2026-06-29, 사용자 승인 후 IMAGE-S2-SMOKE-TESTDATA-CLEANUP-LOOP)
삭제 전 모두 smoke 전용임을 확인(teachers 노드 `smokeTest:true`, teacherClasses/classCodes는 smoke class만) 후 안전 삭제:
- ✅ RTDB `classes/cls_smoke_20260629` → null
- ✅ RTDB `classCodes/SMOKE1` → null
- ✅ RTDB `teacherClasses/KhqcbZ…` → null
- ✅ RTDB `teachers/KhqcbZ…` → null
- ✅ Storage `ai-images/cls_smoke_20260629/` prefix → 파일 1개(2.4MB PNG) DELETE 204, 잔여 0 (stray 0, prefix 한정)
- 삭제 방법: RTDB=firebase CLI `database:remove`. Storage=gcloud/ADC 부재로 firebase CLI refresh token→access token 발급 후 GCS JSON API DELETE(prefix 한정). 임시 자격/스크립트 파일은 작업 후 제거(repo·로그 미노출).
- **무영향 확인**: classes 목록 원래 3개(junglim 포함) 유지, junglim imageS2=false 불변, 전 학급 imageS2 OFF. 실학생 데이터 영향 0.
- 생성 이미지·raw 응답·DB export·secret은 repo에 commit하지 않음.

## 5. 결론
배포된 imageS2 콜러블 전체 경로(인증→게이트→quota→adapter→gpt-image-2 실호출→Storage→aiVariants→선택)와 feature 교사 UI가 **운영 환경에서 실제로 동작함**을 격리 검증 완료. 남은 것은 모델/플러밍이 아니라 **운영 정책**: 개인정보 정식 반영·라이브 감상 렌더 resolver 연결·실작품 적용 범위.
