# imageS2 일괄 변환 "순식간 종료·결과 0" 진단 (2026-06-29)

> feature `feature/image-s2-first-generation`. 실작품: `class_2026_junglim_1` / 팀 `0000`("숲속이야기", 이미지 장면 20).
> **실작품 DB write 0(읽기만)·원본 scene.imageData 불변·OpenAI 호출 0·deploy 0·main merge 0.**

## 1. 증상
교사가 'AI 그림책 마감 시작'을 눌렀으나 장면당 50~80초 대신 **순식간에 끝나고 AI 결과 0개**.

## 2. DB 증거 (read-only)
`teams/0000/aiVariants/imageJobs/{jobId}` 2건 모두:
- `status: "failed"`, `totalScenes: 20`
- 모든 장면 `sceneStates[*] = { attemptCount: 1, errorCode: "IMAGE_POLICY_REQUIRED", status: "failed" }`
- `teams/0000/viewer-meta/imagePolicy = null`
- 각 scene: `imageData` 존재, 그러나 sourceMode/정책 정보 없음
- `aiVariants/image` 생성 0, `imageSelections` 변화 0, 원본 `scene.imageData` 불변

→ client는 `callStartImageS2Batch`(20 targets)→장면별 `callImageAiS2` 호출까지 정상 수행. **서버가 생성 직전 게이트에서 전부 거부**(OpenAI 미도달).

## 3. 근본 원인 (분류 D: imagePolicy 누락)
서버 `functions/image-s2-generation.js:116-118` `decideGenerationGate`:
- `originalSrc = scene.imageData || scene.imageUrl` → **존재**(그림 자체는 있음).
- `_classifyPolicy(policy)`: policy null → `kind:'required'` → **`reject IMAGE_POLICY_REQUIRED`**.

즉 **"숲속이야기"는 sourceMode 잠금(IMAGE-S2-2, upload/draw 기록) 이전에 만들어진 레거시 그림 작품**이라 `viewer-meta/imagePolicy`가 없음 → 서버가 전부 거부. (sourceMode는 OpenAI 호출엔 불필요하고, dedup/stale 해시·기록용으로만 쓰임 — 게이트가 과하게 엄격.)

client UX 2차 문제: `_runBatch`가 결과 성공/실패와 무관하게 `done[sid]=true`만 세어 **"완료"처럼 보이고** 실패 사유를 표시하지 않음.

## 4. 수정 (이번 루프 — 클라이언트만, deploy/migration 0)
1. **사전 차단(no-policy)**: `computeBatchGate`에 `hasPolicy` 추가. 이미지 장면이 있는데 imagePolicy(upload/draw) 없으면 시작 버튼 비활성 + "이 작품의 그림은 입력 방식(업로드·그림판) 정보가 없어 아직 변환할 수 없어요." → **헛돌이(20장면 즉시 실패) 방지**. (`_planEstimate`가 `viewer-meta/imagePolicy` read.)
2. **실패 정확 보고**: `_runBatch`가 성공/실패를 집계(`summarizeBatchResult`), **0 성공이면 "완료"가 아니라 "AI 결과가 생성되지 않았어요 (0개 성공 / N개 실패)" + 사유**(`describeBatchFailCode`: IMAGE_POLICY_REQUIRED→"그림의 입력 방식 정보가 없어요"). 원본 보존 안내.
3. not-configured(secret/배포)·기타 코드도 친화 문구로 표시. 원본 불변.

## 5. 재발 방지 테스트
- `computeBatchGate` no-policy(hasPolicy:false→차단, true→통과, 미전달→생략)
- `summarizeBatchResult`(0성공→실패보고·allFailedPolicy / 혼합 / 전부성공)
- `describeBatchFailCode` 매핑
- ui-smoke: 레거시(정책 없음)→시작 disabled+"입력 방식"; 정상(정책 upload)→enabled
- 브라우저(공개 fixture·OpenAI 0): 정책 없음→비활성+안내 / 정책 추가→활성+"변환할 장면 2개"

## 6. 실작품 데이터 / 플래그
- 실작품(junglim/0000) **읽기만**, 변경 0.
- junglim `modes.imageS2`는 안전을 위해 **OFF로 복구**(루프 시작 시 ON이었음).

## 7. 후속(별도 승인 필요)
레거시 그림 작품을 **실제로 변환 가능**하게 하려면 둘 중 하나(이번 범위 아님):
- **(A·권장) 서버 게이트 완화 + deploy**: policy 없고 imageData 있으면 sourceMode 기본값(예: 'upload' 또는 'legacy')으로 진행하도록 `decideGenerationGate`/`_classifyPolicy` 보강. OpenAI 호출엔 sourceMode 불필요하므로 안전. functions 배포 필요.
- **(B) 작품별 imagePolicy 보정**: 해당 작품 `viewer-meta/imagePolicy.sourceMode='upload'` 1회 set(DB write). 일괄 마이그레이션은 금지 — 작품별 승인.
두 경로 모두 개인정보 정식 반영 후 진행 권장.

## 8. 해소 (IMAGE-S2-LEGACY-IMAGEPOLICY-COMPAT-LOOP, 2026-06-29 — 경로 A 채택·배포)
레거시 그림 작품도 **교사 명시 실행 시 변환 가능**하도록 서버 게이트를 완화했다.
- **서버**(`functions/image-s2-generation.js`): `decideGenerationGate`에서 policy 없음(`required`)이고 `originalSrc`(scene.imageData/imageUrl) 있으면 거부 대신 **`sourceMode:'upload'`로 보정(inferred)하여 proceed**. 변형에 `sourceModeInferred:true`·`legacyImagePolicy:true` 기록(감사용). hash/stale/변형 schema·클라 normalize(upload/draw allowlist)와 충돌 없음. **최신 작품(valid policy)은 기존 로직 그대로**(sourceMode 혼합 방지 유지). policy 없고 그림도 없으면 여전히 IMAGE_SOURCE_MISSING. 클라는 sourceMode를 보내지 않음(서버 결정)·SSRF 가드 유지·원본 imageData 불변.
- **클라**(`viewer-image-batch.js`/ui): no-policy 하드 차단 제거 → 그림 있으면 시작 가능 + 안내("옛 작품이라 입력 방식 정보가 없지만, 저장된 그림을 기준으로 마감합니다."). imageS2 OFF·학생 미노출은 유지.
- **배포**: `firebase deploy --only functions:callImageAiS2` → Successful update(v2·asia-northeast3·nodejs20). 미인증 401 확인.
- **테스트**: image-s2 132(서버 legacy 진행·변형 마커·IMAGE_SOURCE_MISSING 유지 / 클라 legacy 허용+안내 / ui-smoke)·회귀 224·node--check.
- **실 OpenAI 검증**: 이번 루프 actual call 0(단위테스트가 policy:null→succeeded 전 파이프라인 커버, 실 provider 경로는 isolated-smoke에서 기 증명·게이트만 변경). 1장 실변환(fixture 또는 junglim/0000 1장, ~$0.05)은 사용자 승인 시 후속.
- junglim imageS2 OFF 유지·원본 imageData 불변·main merge 0·DB migration 0.

## 9. 2차 버그 + 실변환 검증 (IMAGE-S2-LEGACY-ONE-SCENE-REAL-SMOKE, 2026-06-29)
§8 배포 후 junglim/0000 재시도 시 **다른 에러로 전부 실패**: job 전 20장 `IMAGE_AI_SOURCE_FETCH_FAILED`(정책오류는 사라짐=§8 성공). **2차 원인**: 이 작품 그림이 Storage 마이그레이션으로 `https://storage.googleapis.com/{bucket}/images/...` URL로 저장됐는데, 서버 SSRF 다운로드 가드(`_downloadImageS2Source`)가 **`firebasestorage.googleapis.com` 호스트만 허용** → `storage.googleapis.com` 거부. (다운로드 단계 실패라 **OpenAI 비용 0**.)
**수정**(functions/index.js `_downloadImageS2Source`): `storage.googleapis.com/{bucket}/{objectPath}` URL도 **우리 버킷(별칭 allowlist)** 일 때 허용 — objectPath 추출 후 동일 `images/` 접두·`..` 가드·admin.storage 다운로드. firebasestorage 경로는 그대로. `callImageAiS2` 재배포(Successful update).
**실변환 1장 검증(실 OpenAI 1회·~$0.05)**: 격리 fixture(Playwright 세션 UID를 teacher_uid로·storage.googleapis.com URL 그림·imagePolicy 없음=레거시 재현). 결과=**status succeeded(~15s)**·`aiVariants/image/1/s2` 생성(`legacyImagePolicy:true`·`sourceModeInferred:true`·`sourceMode:'upload'`·model gpt-image-2·stale:false)·결과 다운로드 **HTTP200 image/png 2.67MB**·**원본 imageData 불변**·교사 'AI 결과 사용' 선택 저장(imageSelections selected:s2)·**학생 감상 화면에 AI 결과 표시**(ai-images URL). fixture·Storage 2객체 검증 후 삭제·junglim OFF. **판정 IMAGE_S2_LEGACY_ONE_SCENE_SMOKE_PASS.**
