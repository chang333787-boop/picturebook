# PICTUREBOOK-PRINT-VIEW-MODE-OPTIONS-1 — 인쇄 전 글/그림 원본·AI 선택 옵션

- 일자: 2026-07-03 · 기준: origin/main `4ada6ee` · client-only
- 판정: **PICTUREBOOK_PRINT_VIEW_MODE_OPTIONS_1_LIVE_PASS**

## 동작
작품마무리의 `🖨 그림책 인쇄` 클릭 → 바로 인쇄하지 않고 **인쇄 기준 선택 모달**:
- 📖 글: [원본 글] / [AI 장면발전 글] · 🎨 그림: [원본 그림] / [AI 그림책 마감 그림] — **독립 선택(4조합)**
- 기본값 = **원본/원본** (감상 토글 상태와 분리 — 안전 기본. 일회성·DB 저장 0)
- AI 후보가 작품에 없으면 해당 옵션 **비활성 + "(아직 만든 결과가 없어요)"**
- 모달 안에 ⚠️ 머리글/바닥글 끄기 안내 포함 → [🖨 그림책 인쇄하기]로 출판형 인쇄

## 구현
- **picturebook-print.js**: `open(opts)`에 `textMode/imageMode('original'|'s2')` +
  `getS2Body/getS2Image(sceneId)` 콜백 옵션. print 모듈은 aiVariants 구조를 모름(콜백 주입).
  s2 선택이어도 **후보 없는 장면은 장면 단위 원본 fallback**. 옵션 경유 시 '원본 그림'=진짜
  원본(imageData||imageUrl — 감상 '그림 보기: 원본' 토글과 동일 의미). opts 미지정(구 호출/테스트)=기존 경로.
- **viewer-ai.js**: `_showPbPrintOptionsModal` — 가용성 판정 `_isS2Finalized`(글)/`_hasImageVariantS2`(그림),
  s2 소스는 **감상 토글과 동일**(`_getFbVariantBody`(FB 캐시→localStorage fallback·_brToNewline 정규화)/
  `_getFbImageVariantUrl`). 기존 ai-modal 스타일 재사용(신규 CSS 0).
- textSelections 미사용·원본 필드 무변경(read만)·저장 없음.

## 검증 (실 viewer.html·edit 세션 URL·전체 CSS)
1. 버튼 → 모달: 기본 체크 원본/원본 · 이미지 s2 비활성+안내(후보 없음) · 머리글 경고 표시 ✅
2. 글=AI 선택 인쇄: s2 있는 장면 전부 AI 글·**후보 없는 3번 장면=원본 fallback**·그림은 원본 유지·
   페이지 N+1 유지 ✅
3. 기본(원본/원본) 인쇄 = 원본 글 ✅
4. 그림=AI 인쇄: 후보 있는 2번 장면만 AI 그림(로드 완료 후 인쇄)·나머지 원본·자리표시 0 ✅
5. 부수 확인: DESIGN-3 preload가 **깨진 이미지 data를 정확히 자리표시로 교체**함도 재확인
   (검증 중 잘린 mock GIF가 교체된 것 — 유효 이미지는 무영향).
- 테스트 462/462(rules 제외 기존 동일) · node --check OK · afterprint 정리 정상.

## 남은 후속
- 실프린터 1회 · AI 조합 인쇄 실작품 확인(사용자) · aiChecks rules 승인 대기(별도 트랙).

## 버스터
`pbprintopts1` — picturebook-print.js·viewer-ai.js(AI_SRC).
