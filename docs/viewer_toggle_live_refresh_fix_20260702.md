# VIEWER-TOGGLE-LIVE-REFRESH-FIX — 감상 화면 원본/AI 토글 즉시 반영

- 일자: 2026-07-02 · 기준: origin/main `259e01e` · client-only(viewer-ai.js 1개)
- 판정: **VIEWER_TOGGLE_LIVE_REFRESH_FIX_LIVE_PASS**

## 원인
토글 setter(`_setAiViewMode`/`_setAiImageViewMode`)와 variant preload가 재렌더를
`_scheduleViewerFrameReRender`로 요청하는데, 이 함수는 **viewer-edit.js에만 정의**되어 있다.
FIELD-FIX-B로 감상 세션에서 viewer-ai.js를 단독 로드하게 되면서, 감상에서는 이 호출이
조용히 no-op → 토글 상태(localStorage·버튼 active)만 바뀌고 현재 장면은 다음 장면 이동 때
(`renderCurrentScene` 경유) 비로소 반영되던 것.

## 수정 (viewer-ai.js)
`_requestViewerFrameRerender()` 헬퍼 신설 후 4개 호출 지점 교체
(_setAiViewMode·_setAiImageViewMode·텍스트/이미지 variant preload):
1. 편집 세션: 기존 `window._scheduleViewerFrameReRender`(디바운스·편집 상태 보존) 그대로 — 동작 무변경.
2. 감상 세션: viewer-render 전역 **`renderCurrentScene()` 직접 호출** — 같은 currentSceneId를
   다시 그릴 뿐. 장면 이동/기록(historyStack)/선택 진행 상태 변화 0 · 데이터 write 0.

## 검증 (실코드 하니스 — viewer-data+render+ai 실로드·mock firebase·비편집)
- 전제 재현: `window._scheduleViewerFrameReRender === undefined` 확인.
- 글 보기 [AI 장면발전] 클릭 → **현재 장면 본문 즉시** s2("AI 장면발전 문장 1") ·
  sceneId 유지 · historyStack 0 · `scene.body` 원본 그대로.
- 글 보기 [원본] 클릭 → 즉시 원문 복귀.
- 그림 보기 [AI 그림책 마감] → img src 즉시 s2 url / [원본] → 즉시 원본 data URI ·
  `imageData` 필드 불변.
- console error 0 · DB write 0(mock write 가드 발화 0). 테스트 스위트 462/462.
- 다듬기(편집) 감상: 코드 경로 무변경(window 스케줄러 우선) — 기존 검증 유지.

## 버스터
viewer.html AI_SRC `?v=` += `togglelive1`.
