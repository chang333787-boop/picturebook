# P7 — 교사 '감상에 보여줄 글' 선택 UI + callable 배포

- 일자: 2026-07-01
- 브랜치: `feature/write-after-rebuild` (UI는 main 미병합 — 승인 대기 / callable은 배포됨)
- 상위: [[project-branch-write-after-rebuild]] · 인프라 = [P7 인프라](write_after_text_selections_p7_20260701.md)

## 1부 — P7 인프라 main 병합·live ✅ `TEXT_SELECTIONS_INFRA_LIVE_PASS`
- feature `2c71681` → main `--no-ff` → **origin/main `5cd1637`** push. 순변경 6파일·functions/index.js 순수추가·rules/node_modules 무변경·imageS2 무변경.
- live 검증: 버스터 data/render `textsel1` · resolver 5함수 · `_pubBody` hook 8 · loadTeamData textSelections read · inert 스모크(선택없음→원본·s2변형없음→원본·변형있음→발전본·콘솔0, 스샷 text-selections-infra-live-inert.png).

## 2부 — 교사 선택 UI (feature) + callable 배포

### UI (feature `57ff9aa`, main 미병합)
- **글 보기 토글(임시 비교) ↔ 감상 글 선택(발행) 분리.** 토글바에 **교사/편집 세션에서만** '감상 글 정하기' 버튼(`isEditViewerSession`) — 감상자/학생엔 미노출.
- `_showTextS2SelectionModal()` — 제목 '📖 감상에 보여줄 글', 안내 "원본은 그대로 보존돼요. 선택한 글만 감상 화면에 보여요." scene별(‑s2 있는 장면만) 원본/AI 장면발전 미리보기 + 현재 상태('현재 감상 글: 원본/AI 장면발전') + [원본으로 정하기]/[AI 장면발전으로 정하기]. 현재 선택 버튼 disabled. s2 없으면 목록 안내.
- `_applyTextSelection(sceneId, selected)` — `callApplyTextS2Selection({classId,teamName,sceneId,selected})` 호출. 성공 시 `setPublishedTextSelectionForScene`(캐시 동기 갱신·원본 body 불변) + `_scheduleViewerFrameReRender` + 토스트 + 모달 새로고침. 실패/`S2_NOT_USABLE` → 안내(원본 유지). s2 없으면 클라에서도 사전 차단.
- viewer-data에 `getPublishedTextSelectionForScene(sid)`(상태 읽기·순수) 추가.
- 캐시버스터 viewer-data/AI_SRC `textsel2ui`.

### callable 배포 (단일)
- `firebase deploy --only functions:callApplyTextS2Selection --project picturebook-8731f` → **Successful create** `callApplyTextS2Selection(asia-northeast3)`. **다른 함수 무접촉**(--only).
- **도달성 확인**: 미인증 POST → **HTTP 401 UNAUTHENTICATED** "로그인이 필요해요."(404 아님) = 배포 확인 + auth 게이트 정상 + **운영 DB write 0**(인증 거부로 write 전 차단).

## 검증
- node --check(viewer-ai/viewer-data/functions/index) OK · resolver 테스트 18/18 · secret 0 · functions/node_modules 미트래킹 · rules 무변경.
- 브라우저 스모크(로컬 feature): `getPublishedTextSelectionForScene`/`setPublishedTextSelectionForScene` 노출·round-trip(original→s2→original)·새 viewer-ai 번들 콘솔 에러 0.
- ⚠️ **NOT_VERIFIED(모달 인터랙티브 시각)**: '감상 글 정하기' 모달은 `_fbTextVariants`(FB 텍스트 변형 캐시) + 편집 세션이 있어야 진입 — closure-private라 외부 주입 불가. 실 교사 로그인 + s2 결과 있는 실작품에서 시각 확인 필요(기존 viewer-ai 모달과 동일 caveat). 코드·resolver·state getter·callable 배포/게이트는 검증됨.

## 안전
- 원본 `scene.body` write 0(selection은 server-only `aiVariants/textSelections`). callable 교사 전용·s2 usable(body 존재) 아니면 write 안 함(`S2_NOT_USABLE`). 운영 작품에 임의 selection write 0(스모크는 미인증 401로 차단됨·실제 write 없음). textS1 미노출·imageS2 로직 무변경·prompt/quota 무변경.

## 상태 / 남은 것
- **live**: P7 인프라(inert) + `callApplyTextS2Selection` 배포됨. 하지만 **선택 UI는 feature만**(main 미병합) → 라이브 감상 화면엔 아직 selection UI 없음 = 여전히 전 작품 원본 표시(inert).
- **다음(승인)**: ① UI feature→main 병합(라이브 노출) ② 실 교사 세션 E2E 시각 확인 ③ 학생 선택 허용 여부 검토 ④ 이미지 축 회귀 재확인. 프린트·rewriteDone 자동초기화=후속.
