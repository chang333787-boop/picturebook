# P6 — AI 장면발전(textS2) 최종화 read-only 조사

- 일자: 2026-07-01
- 브랜치: `feature/write-after-rebuild`
- 성격: **read-only 조사/설계 문서** (코드 0 · deploy 0 · DB 0 · 실 API 0)
- 판정: **`TEXT_S2_FINALIZE_AUDIT_READY`**
- 상위 문서: [[project-branch-write-after-rebuild]] · imageS2 = [[project-branch-image-s2-phase0]]

## 결론 (한 줄)

AI 장면발전(textS2)은 **학생이 직접 고친 최신 원본 body를 입력으로 쓰고**, 결과는 `aiVariants` 오버레이에만 저장하며 **원본 `scene.body`를 절대 덮지 않는다**. 캐시 재사용 위험 없음(S2는 매번 새 호출), rewriteDone 게이트 정상. 🔴CRITICAL 아님. P6/P7은 이미지 `imageSelections` 모델을 평행 복제한 `textSelections` + `getPublishedTextDisplayBody` 신규 구축으로 안전하게 진행 가능.

## 현재 textS2 흐름 (클라 → 서버 → 저장)

1. **입력 수집** — `_startTextS2()`(viewer-ai.js:614)가 `_buildWorkSnapshot()`(viewer-ai.js:3320) 호출. 스냅샷은 `ViewerState.scenes`를 순회하며 각 scene의 `body`·`title`·`isEnding`·`submode`(imageCenter|split)·`choices`를 담는다. cover 제외·빈 body 제외.
2. **클라 → 서버** — `_phaseACallTextS2(snapshot)`(viewer-ai.js:581)가 `callTextAiBatchS2` 호출. payload = `{classId, teamName, workId, rootBranchId, copyDepth, snapshot}`. body의 유일한 소스가 이 snapshot.
3. **서버** — `callTextAiBatchS2`(functions/index.js:1570)는 `req.data.snapshot`을 그대로 사용(functions/index.js:1581). `buildUserMessageS2Chunk(snapshot, targetIds)`(prompts.js:653)가 `s.body`(prompts.js:677)로 프롬프트를 만든다. **DB에서 `scene.body`를 다시 읽지 않는다.** (대조: `callWorkCheck`는 캐시 해시용으로 DB scenes를 읽음. S2는 그 로직 없음.) — ★본 감사에서 직접 재확인함.
4. **결과 적용** — `_applyS2Results(results)`(viewer-ai.js:811): `aiVariants.textS2 = {status:'finalized', final:{[sid]:{body:revisedText}}}` 를 localStorage에 저장. 실 API 모드면 `_saveTextVariantToFirebase('s2', final)`(fire-and-forget)로 서버 경유 DB 저장. **원본 `scene.body`는 어느 경로에서도 미접촉.**
5. **DB 저장 경로** — `saveTextVariant`(functions/index.js:1904)가 `aiVariants/text/{sceneId}/s2`에 write. 원본 `scenes/{id}/body`는 미접촉.

## 핵심 질문 답변 (근거 파일:라인)

| # | 질문 | 답 | 근거 |
|---|------|-----|------|
| 1 | payload body = 최신 저장값 vs 임시 편집값? | **최신 in-memory 값** (저장 여부 무관, 화면에서 마지막으로 타이핑된 값). P6 목적상 바람직 | contenteditable input 핸들러 viewer-edit.js:1686이 `scene[field]=text`로 `ViewerState.scenes` 즉시 갱신 → `_buildWorkSnapshot`이 읽는 동일 객체 |
| 2 | 2단계에서 고친 뒤 미저장 상태로 호출 시 반영? | **반영됨** (input 시점에 이미 `scene.body` 갱신) | viewer-edit.js:1686 |
| 3 | 서버는 snapshot 그대로 vs DB 재독? | **snapshot 그대로** | functions/index.js:1581 + prompts.js:677 (★직접 확인) |
| 4 | textS2 결과 저장 경로 | `classes/{classId}/teams/{enc}/aiVariants/text/{sceneId}/s2` + localStorage 미러 `aiVariants.textS2.final[sid].body` | functions/index.js:2017·2048·2108 / viewer-ai.js:830 |
| 5 | 동일 hash/cached 재사용? | **텍스트 S2에는 없음** (`cached` 캐시는 workCheck 전용, `forceRegenerate`는 이미지 전용). S2는 매번 새 호출 → 고친 뒤 재생성 막힐 위험 없음 | functions/index.js:1690~1774(workCheck) |
| 6 | rewriteDone ↔ textS2 게이트 | **rewriteDone이어야 3단계 s2 활성** (`enabled: rewriteDone && a.s2.enabled`). '다시 고칠래요'로 해제 | viewer-ai.js:3201 / `_isRewriteDone` 3795 |
| 7 | 그림책 장면 + 엔딩 모두 대상? | **둘 다.** cover만 제외, `isEnding` 스냅샷·프롬프트에 실림 | viewer-ai.js:3331 / prompts.js:674 |
| 8 | 원본 body 자동 덮어쓰기 있는가? | **없음(안전).** aiVariants 경로에만 기록. `_isVariantViewLocked`일 때 원본 flush 차단 | viewer-ai.js:820·830·835 / viewer-edit.js:792·968 / variant 편집 분리 1588·1607 |
| 9 | P7 textSelections에 필요한 신규 구조 | 이미지쪽 6개 순수함수 + callable 1:1 복제 (아래) | viewer-data.js:1570~1706 / functions/index.js:2396 |

## 위험 지점 (전부 경미 · 블로커 아님)

- **미저장 로컬 편집 vs DB**: input이 메모리 `scene.body`를 갱신하므로 AI 입력엔 반영되나, 그 순간 DB `scenes/{id}/body`는 아직 flush 전일 수 있음. 서버가 aiVariants만 다루므로 AI 입력에는 지장 없음. P6에서 "학생이 고친 원본"을 DB 기준으로 확정하려면 textS2 호출 직전 pending save flush 보장 권장.
- **`_isVariantViewLocked` 상태 의존**: S2 결과 보기(aiS2 view) 중엔 원본 편집·flush가 막힘(viewer-edit.js:792·968). P6 마감 시 "원본 vs 발전" 정본 선택 UI가 이 잠금과 충돌하지 않도록 view mode 전환 순서 주의.
- **fire-and-forget 저장**(viewer-ai.js:835): `_saveTextVariantToFirebase` 실패해도 localStorage final은 남음. P7에서 "발행 선택"을 DB `textSelections`에 기록하려면 s2 variant가 **DB에 실제 존재**해야 하므로 선택 전 FB 저장 성공 확인 필요(이미지쪽 `S2_NOT_USABLE` 가드와 동일).

## P6 구현 제안 (범위 최소화)

1. textS2는 입력·저장·게이트가 모두 안전 → **P6에서 신규 AI 로직·prompt·quota·callable 불필요**. 재사용만.
2. P6 "장면발전 최종화" = 이미지 IMAGE-S2 마감과 평행하게, **장면별 원본↔AI발전 발행 선택 확정** 단계로 정의. 실제 구현은 P7 textSelections와 사실상 동일 → **P6·P7을 `textSelections` 단일 작업으로 합치는 것을 권장.**
3. 원본 body 보존 불변식(Q8)은 이미 만족 — P6에서 새로 지킬 코드 없음. 정본 선택은 `aiVariants/textSelections`에만 기록, `scenes/{id}/body` 절대 미변경.
4. rewriteDone 게이트(Q6)를 P6 진입 조건으로 그대로 재사용.

## P7 textSelections 설계 메모 (이미지 평행 복제안)

**현재 상태**: `textSelections` / `getPublishedTextDisplayBody` 존재 0 (전부 greenfield). 이미지쪽 완성 모델을 1:1 복제.

이미지쪽 참고(완성):
- 서버 write-only 선택 노드 `aiVariants/imageSelections/{sceneId}` + `callApplyImageS2Selection`(교사/서버만 write, functions/index.js:2396). ★rules상 `aiVariants` 부모는 `write:false`라 학생 우회 불가.
- 클라 순수함수: `normalizeImageSelection`(viewer-data.js:1570)·`resolveSceneImageSource`(1632)·발행 캐시 `_setPublishedImageCaches`(1658)·동기 helper `getPublishedImageDisplaySrc`(1681)·즉시 갱신 `setPublishedImageSelectionForScene`(1698). 로드는 loadTeamData가 `aiVariants/imageSelections`+`aiVariants/image` 1회 캐시(viewer-data.js:192). 렌더 참조 viewer-render.js:410.

**P7 텍스트 신규 항목**:
1. 서버 callable `callApplyTextS2Selection({classId,teamName,sceneId,selected:'s2'|'original'})` → `aiVariants/textSelections/{sceneId}` write (`callApplyImageS2Selection` 복제). s2 usable = `aiVariants/text/{sid}/s2.body` 존재·비어있지 않음.
2. 클라 `normalizeTextSelection`·`resolveSceneTextBody(scene, sel, s2Variant, previewMode)`·발행 캐시 `_setPublishedTextCaches`·동기 helper **`getPublishedTextDisplayBody(scene, originalBody)`**·`setPublishedTextSelectionForScene`.
3. loadTeamData에 `aiVariants/textSelections`+`aiVariants/text` 캐시 적재(`aiVariants/text` 읽기 경로는 viewer-ai.js:1259에 이미 존재 — 재활용).
4. 렌더 body 계산 지점(sceneRenderer.js body trim 지점 등)에서 `getPublishedTextDisplayBody(scene, scene.body)` 경유.
5. rules: `aiVariants/textSelections`도 이미지처럼 `read:true / write:false` 확인.

## 구현 금지 / 다음 루프 명령 후보

- 이 문서는 조사·설계까지만. **P6 구현 착수 금지**(이번 루프 규칙).
- 다음 루프 후보: `WRITE-AFTER-P6P7-TEXT-SELECTIONS` — `callApplyTextS2Selection` 신규 callable + 클라 6함수 + rules 확인. **새 callable 추가·rules 변경이 필요하므로 안전 모드**(조사·구현 분리, 배포 전 승인).
