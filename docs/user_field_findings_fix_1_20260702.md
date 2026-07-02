# USER-FIELD-FINDINGS-FIX-1 — 실화면 확인 기반 미완료 항목 수정

- 일자: 2026-07-02 · 시작 기준: origin/main `2a8c0b1`
- 성격: client-only + 설계 문서. Functions/Rules deploy 0 · DB write 0 · 실제 AI 호출 0
- 판정: **USER_FIELD_FINDINGS_FIX_1_LIVE_PASS** + **PICTUREBOOK_PUBLISH_PRINT_READY**

## 사용자 발견 항목과 처리

### A. 브랜치 화면 구조점검/이야기길 버튼 (maker.html)
- 원인: 다듬기만 정리됐고 브랜치 상단 우측 '점검' 그룹에 `🔍 이야기 길 점검`(#btn-check)·
  `🛤 이야기 길 보기`(#btn-route)가 그대로 남아 있었음. adv-only는 현재 무력(beginner-mode 미사용).
- 수정: 두 버튼을 상단에서 제거하고 기존 `⋯` 메뉴(#file-more-menu)로 이동 — **id/핸들러 불변**
  (기능 유지·교사/고급 접근 가능). 메뉴 라벨 `⋯ 파일/관리`→`⋯ 더보기`, 그룹 라벨 `점검`→`도구`.
  메뉴는 항목 클릭 시 자동 닫힘(기존 바인딩). 다듬기 작품마무리 '🗺 이야기 길 확인'·인쇄 지도 무변경.

### B. 브랜치 감상해보기에서 AI 장면발전 안 보임 (viewer.html + viewer-data.js)
- 원인: **PERF-2 회귀** — viewer-ai.js가 편집 번들(ensureEditBundle)에만 묶여, 감상 세션(비편집)엔
  토글 코드 자체가 로드되지 않았음(Phase 4-A '감상자 공통 표시' 설계가 깨진 상태).
- 수정: `window.ensureAiViewBundle`(viewer-ai.js 1개만 로드) 신설 + loadTeamData가 캐시 적재 직후
  **s2 변형(글/그림)이 있는 작품 & 비편집 세션**일 때만 fire-and-forget 로드. 로드 후 토글 표시는
  viewer-ai 자체 부트스트랩(_bootstrapFirebaseTextVariants·감상자 공통)이 담당.
- PERF-2 이득 유지: s2 없는 작품(대부분)=추가 로드 0·편집 세션=기존 번들 경로(같은 key라 중복 0).
- 검증(실코드 하니스): 감상+s2→로드 1회 / 편집 세션→0 / s2 없음→0.

### C. AI 장면발전 보기에서 진하기 슬라이더 무반응 (viewer-edit.js)
- 원인: 장면꾸미기 팝오버의 진하기 바인딩(_bindPbBodyBoxOpacity)에 구 variant 잠금
  (`_isVariantViewLocked` → input 무동작·"AI 버전은 보기 전용입니다"). REFINE-STAB-B에서
  진하기=항상 원본 설정 단일 소스(AI 보기 렌더가 원본 opacity를 merge)로 정리된 뒤 과보호가 됨.
- 수정: 진하기 슬라이더에서만 잠금 제거 — AI 보기 중 조절=원본 backdropOpacity 설정 변경이며
  즉시 재렌더로 AI 보기에도 반영. variant layout(x/y/w/h)·본문 편집 잠금은 기존대로 유지.
- 검증: AI 보기(aiS2)에서 0.85→0.30 변경 → 오버레이 배경 rgba 즉시 반영·저장 필드는 원본 1곳.

### D. 버튼 문구 한 글자 낙하 줄바꿈 (viewer.css)
- 원인: `.pb-mood-seg`(분위기/장면 단계 세그)가 좁아질 때 한글 기본 줄바꿈이 글자 단위
  → "이야기가 커져 / 요".
- 수정: `.pb-mood-seg__label{word-break:keep-all; overflow-wrap:break-word}` — 어절 단위
  ("이야기가 / 커져요"·"긴장감이 / 높아져요")·극단 폭 안전판.
- 검증: 좁은 폭 하니스에서 keep-all 적용·라벨 2줄 어절 분리 확인.

### E. 그림책 인쇄 = 출판형 아님 → 설계 감사 완료
- 별도 문서: docs/picturebook_publish_print_audit_20260702.md — **READY**.
- 결론: 갈아엎기 아님(BFS 번호·선택지 안내·표지·게이트·테스트 전부 재사용, 페이지 루프+CSS만).
  A안(기존 버튼을 출판형으로 전환·지도 1p 유지) 추천. A4 세로·장면당 1페이지(그림 크게+본문
  13.5pt+하단 "→ N번 장면으로 가세요"). 20장면=22p. 구현=**PICTUREBOOK-PUBLISH-PRINT-1**로 분리.

## 검증·안전
- node --check(viewer-data/viewer-edit) OK · 테스트 462/462(rules 제외 기존 동일) ·
  Playwright 하니스(B 3케이스·C·D) PASS · console error 0.
- functions/rules diff 0 · 실제 AI 호출 0 · 운영 DB write 0 · textSelections 부활 없음 ·
  원본 body/imageData/layout 신규 write 0 (C는 기존 진하기 설정 경로 그대로).
- 캐시버스터 `fieldfix1`: viewer-data.js·viewer-edit.js(EDIT_SRC)·viewer.css. maker.html은 HTML 직접.

## 남은 후속
- PICTUREBOOK-PUBLISH-PRINT-1 구현(위 감사안).
- 실기기: 브랜치 상단 정리 체감·감상해보기 토글·진하기 슬라이더 터치.
