# PICTUREBOOK-PUBLISH-PRINT-DESIGN-3 — 출판형 인쇄 디자인 품질 개선

- 일자: 2026-07-03 · 기준: origin/main `d78d5fe` · client-only
- 판정: **PICTUREBOOK_PUBLISH_PRINT_DESIGN_3_LIVE_PASS**

## 1. 그림 누락 재검증 — 타이밍 원인 확정·수정
- POLISH-2의 imageUrl fallback은 정상이었으나, **원격(Storage) 그림이 로드되기 전에
  window.print()가 떠서** 미리보기/PDF에 그림이 비는 경로가 남아 있었다(내 mock은 data URI=
  즉시 로드라 못 잡음). base64 표지만 나오고 Storage 장면 그림이 빠지던 사용자 PDF와 일치.
- 수정: `_waitForImages` — print 전 전 이미지 load/error를 **최대 4초 대기**. 실패 이미지는
  "(그림을 불러오지 못했어요)" 자리표시 박스로 교체(깨진 아이콘 방지). open()이 async가 됨
  (호출부는 fire-and-forget이라 무변경).
- 검증(실 viewer.html): 네트워크 로드 이미지 18장 혼합(data URI·무그림·깨진 URL 포함) —
  **print 호출 시점 로드 완료 18/18·실패분 자리표시 교체** 실측.

## 2. 표지 개선
전면 프레임 카드(2px+외곽 1px 이중 테두리·둥근 모서리) 안에:
상단 "🌿 가지 branch 그림책" 브랜드 라인 → 제목(30pt)+부제(13pt) 묶음 → **표지 그림 크게**
(폭 92%·최대 480px·contain) → 하단 구분선 위 모둠명(굵게)+날짜. 그림 없는 표지는 은은한
장식(⸙) 중앙 배치. 스크린샷 육안 확인 — 빈 종이 느낌 해소.

## 3. 장면 페이지 개선
- 페이지 전체 얇은 프레임(1.5px·둥근 모서리) = 책 페이지 카드감.
- **그림 확대**: `width:100%`(저해상도 원본도 페이지 폭까지 확대·contain=크롭 0)·최대 560px.
  실측: 프레임 폭의 **95%**(747×560px) — 이전 intrinsic 크기(194px)로 작게 나오던 문제까지 해결.
- 본문 13.5pt·선택지 하단 구분선 위 "▸ 간다. → 2번 장면으로 가세요". root 폭 auto(인쇄
  가능 폭 전체 사용). 장면당 1페이지·21쪽(20장면) 유지 — PDF 실측.

## 4. text-only 장면
본문을 얇은 프레임 카드(폭 84%·15pt·줄간 1.9·중앙)로 — 페이지 프레임+본문 카드 이중 구조라
그림이 없어도 출판 페이지처럼 보임. 선택지는 카드 아래 26px.

## 5. Chrome 머리글/바닥글 안내
작품마무리 인쇄 버튼 아래 **강조 박스**로 상시 안내(모달 요소 — 출력물 미포함):
"🖨 출판용으로 뽑을 때는 인쇄 창의 '설정 더보기'에서 **머리글과 바닥글**을 꺼 주세요.
그래야 날짜·주소 없이 깔끔한 그림책이 돼요." + 버튼 title 병기. alert 없음.
※ header/footer는 브라우저 설정이라 앱이 강제로 못 끔 — 켜진 상태에선 상하단에 날짜/URL이
남고, 끈 상태 기준으로 위 디자인이 완성됨(안내로 유도).

## 6. PDF 검증 (실 viewer.html·전체 CSS — standalone 아님)
- A4 세로 **21쪽**(표지1+장면20) 유지 · 장면당 1페이지 · page break 깨짐 0.
- 표지/1번 장면 스크린샷 육안 확인(프레임·큰 그림·선택지) · 무그림 장면 카드형 ·
  깨진 이미지 자리표시 · unclip/afterprint 정리 · 타 gate 충돌 0 · console error 0.
- 테스트 462/462(rules 제외 기존 동일) · node --check OK.

## 남은 후속
- 교사 PC 실프린터 1회(원격 그림 많은 작품은 preload 4초 내 로드 확인).
- 양면/제본형·이야기 길 지도 별도 출력(수요 시)·aiChecks rules 승인 대기(별도 트랙).

## 버스터
`publishprint3` — picturebook-print.js·pb-ai.css·viewer-ai.js(AI_SRC).
