# PICTUREBOOK-PUBLISH-PRINT-1 — 그림책 출판형 인쇄 전환

- 일자: 2026-07-02 · 기준: main `15eb380` 이후 · client-only
- 설계 정본: docs/picturebook_publish_print_audit_20260702.md (A안 채택)
- 판정: **PICTUREBOOK_PUBLISH_PRINT_1_LIVE_PASS**

## 기존 인쇄와 차이
| | 구(점검형) | 신(출판형) |
|---|---|---|
| 장면 | 2개/페이지 축소 카드(테두리·min-height 44%) | **장면당 1페이지**·테두리 없음·전면 배치 |
| 그림 | max-height 230px | **max-height 480px**(페이지 폭 100%·contain·크롭 0) |
| 본문 | 11pt | **13.5pt·줄간 1.7·keep-all** (그림 없는 장면=15pt 중앙) |
| 선택지 | 카드 하단 | **페이지 하단 고정**(flex margin-top:auto·12pt) |
| 표지 | 제목/부제/그림/모둠 | + **날짜** 추가 |

유지: 표지 1p·이야기 길 지도 1p(부록)·BFS 번호·`▸ 선택지 → N번 장면으로 가세요`·
`— 이야기 끝 —`·추가 장면 배지·`(연결되지 않음)`·gate `print-picturebook`·afterprint 정리·
발행 헬퍼(read만)·`buildPrintOrder` 테스트. 진입 버튼도 그대로 `🖨 그림책 인쇄`
(title만 "장면마다 한 쪽씩 그림책처럼 인쇄해요"로 교체 — 버튼 추가/옵션 모달 없음).

## 구현
- picturebook-print.js: 장면 루프 2개/페이지 → `res.order.forEach` 1장면=1 `.pbp-page.pbp-publish`.
  그림 없으면 `.pbp-scene--noimg`(본문 중앙 확대). 선택지 라벨이 빈 값('(선택)')이면 라벨 생략하고
  이동 안내만. 표지에 인쇄 시점 날짜(저장 0). `describeChoice`/BFS 순수부 무수정.
- pb-ai.css: 기존 `@media print` 그림책 블록에 `.pbp-publish` 오버라이드 추가(구 규칙은 클래스로 격리).
- viewer-ai.js: 버튼 title 문구만.

## 검증 (실코드 하니스·mock 20장면: 순환·빈 라벨·무그림·엔딩2·도달불능·누락 next 포함)
- DOM: 총 22페이지(표지+지도+장면20)·**publish 페이지당 장면 정확히 1개**·표지 날짜·지도 유지.
- **PDF(A4 세로) 22페이지** — 장면-페이지 1:1 유지·페이지 중간 잘림 0.
- 선택지: "▸ 따라간다. → 2번 장면으로 가세요" / 빈 라벨=안내만 / 순환="→ 1번 장면으로 가세요" /
  추가 장면(20번)+"(연결되지 않음)" / 엔딩 "— 이야기 끝 —".
- CSS 실측(print 미디어): scene border 0·page min-height 1010px(90vh)·본문 18px(13.5pt)·
  **선택지 margin-top 788px=하단 고정**.
- gate: print-write-after/tc-print-* 동시 활성 0·afterprint(PDF 발화 포함)로 gate/root 정리.
- console error 0 · DB write 0 · 테스트 462/462(rules 제외 기존 동일·order.test 8 무영향).

## 페이지 수 예시
N장면 = N+2p (20장면=22p·21장면=23p). 양면 인쇄 시 절반.

## 남은 후속
- 교사 PC 실프린터 1회(대형 base64 이미지 다수 작품의 인쇄 준비 시간 체감 포함).
- AI 장면발전 인쇄 옵션·지도 별도 출력·책자 양면/제본 고급 설정 — 수요 확인 후 별도.
- 극단적으로 긴 본문(1페이지 초과)은 브라우저가 자연 분할(break-inside:avoid 무시) — 실사용 관측.

## 버스터
`publishprint1` — picturebook-print.js·pb-ai.css·viewer-ai.js(AI_SRC).
