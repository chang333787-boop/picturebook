# SCENE-PUBLISH-PRINT-FOLLOWUP-1 — 행동버튼 3칸 확보 + AI 그림 옵션 비활성 수정

- 일자: 2026-07-03 · 기준: origin/main `6f8b0f4` · client-only
- 판정: **SCENE_PUBLISH_PRINT_FOLLOWUP_1_LIVE_PASS**

## 1. AI 그림책 마감 옵션 비활성 — 원인과 수정
- **원인(실증)**: 데이터 문제 아님. 0000 작품(`class_2026_junglim_1`)의 `aiVariants/image`를
  실조회(read-only)하니 **s2 후보 20장면 실존**. 옵션 판정 `_hasImageVariantS2()`는 FB 캐시
  (`_fbImageVariants`) 기반인데, 캐시는 비동기 preload로 채워짐 — **모달이 캐시 로드 완료 전에
  열리면 false**가 되는 race(특히 admin `?print=pb` 자동 진입·페이지 진입 직후 클릭).
- **수정**: `_showPbPrintOptionsModal`을 async로 — 모달 구성 전에
  `await _loadFirebaseTextVariants(false)` + `await _loadFirebaseImageVariants(false)`
  (이미 로드됐으면 즉시 반환·실패해도 원본 옵션으로 진행). **감상 '그림 보기: AI 그림책 마감'
  토글과 동일한 데이터 소스/기준**(aiVariants/image/{sid}/s2.url) 보장. 장면별 후보 없으면
  기존대로 원본 fallback. AI 재호출 0·write 0.

## 2. 행동버튼 3칸 확보
- `.pbp-scenepub .pbp-choices`를 **3행 예약 그리드**(repeat(3, minmax(44px,auto))·min-height
  146px)로 — 선택지 1~3개 모두 같은 칸(카드형 행·테두리·15px)·긴 라벨 어절 줄바꿈·
  `→ N번 장면으로 가세요` 우측 고정. 엔딩도 같은 높이 146px 중앙 배치(페이지 리듬 동일).
- 페이지 수직 예산: 무대(3:2 ≈479px)+칸 146px+여유 → 실측 페이지 839px ≪ A4 콘텐츠 1027px —
  **stage 축소 없이** 3칸 확보(A+B 조합·그림 크기 유지).

## 3. 검증 (실 viewer.html·0000 실데이터)
- 인쇄 옵션 모달(버튼 실경로): **AI 그림책 마감 그림 활성** ✅ (글 AI도 활성 — 0000에 text s2 존재)
- 그림=AI 인쇄: 무대 그림 4/4 **실 Storage s2 URL** 적용·preload 후 인쇄 ✅
- 선택지 칸 실측: 1개/2개(긴 라벨)/3개/엔딩 전부 **146px 동일 칸·페이지 내 수납**(within 전부 true) ✅
- PDF(A4) N+1페이지 유지 · afterprint/unclip 정리 · 타 print gate 충돌 0 · console error 0
- 테스트 462/462(rules 제외 기존 동일) · node --check OK
- 원본 보존: 전 과정 read만 — scene.*/aiVariants write 0 · 실제 AI 호출 0

## 4. 남은 후속
- admin 실계정 ⋯ [🖨 그림책 인쇄] 클릭 1회(전 루프와 동일 NOT_VERIFIED) · 실프린터 1회 ·
  aiChecks rules 승인 대기(별도 트랙).

## 버스터
`scenepubfix1` — viewer-ai.js(AI_SRC)·pb-ai.css.
