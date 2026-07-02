# PICTUREBOOK-PRINT-1 — 그림책 분기 인쇄 (장면 번호 + "N번 장면으로 가세요")

2026-07-02 · 클라이언트 전용 · 기준 main `8eee5a6`(WRITE-AFTER-PRINT-1) · 설계 정본 docs/print_flow_audit_20260702.md
기준 기기 = **교사 PC Chrome A4**(버튼 title에 안내). 모바일 그림책·책자형·admin 일괄 = 범위 외.

## 1. 구현
| 파일 | 변경 |
|---|---|
| **picturebook-print.js (신규·UMD)** | 순수 `buildPrintOrder(scenes)`(BFS 번호)·`describeChoice`(이동 안내) + 브라우저 `open()`(오버레이 생성→gate→print→정리). window.PicturebookPrint |
| viewer-render.js | 다듬기 HUD 더보기 메뉴에 **[🖨 그림책 인쇄]**(그림책 작품만·'이야기 길 보기' 아래) |
| viewer-edit.js | 메뉴 클릭 바인딩(routes 바인딩 옆) |
| pb-ai.css | `.pb-print-root{display:none}` + `@media print body.print-picturebook` 레이아웃(흑백 가독) |
| viewer.html | picturebook-print.js 로드(+9KB) · 버스터 `pbprint1`(render·EDIT_SRC·pb-ai.css) |

## 2. 번호 매김 규칙 (설계 B안 그대로·전부 즉석 계산 — 저장 0)
- 표지 = 번호 없음("표지" 페이지) · 시작 = 표지 첫 버튼의 next(없으면 num 최소 non-cover) = **1번**.
- BFS·버튼 순서 방문 · 순환 = 방문 1회+"다시 N번…" 참조 · 누락 next = "(연결되지 않음)" ·
  표지로 회귀하는 버튼도 미연결 처리(표지는 무번호) · **도달 불가 = 번호 이어서 "추가 장면"**(지도에 ※안내).
- 행동버튼 표기: "▸ 문을 연다  **→ 4번 장면으로 가세요**"(밑줄) · 버튼 없음 = "— 이야기 끝 —".

## 3. 인쇄물 구성 (A4·2장면/페이지)
①표지(제목/한줄소개/표지그림/모둠) ②**🛤 이야기 길 지도**(번호·제목/본문 요약·→행선지 목록·추가 장면 구분) ③장면 카드(번호 배지+엔딩/추가 플래그+제목+그림 max-height 230px+본문+선택지 이동 안내). 17장면(도달14+표지) 실측 = **PDF 9페이지**.

## 4. 감상본=인쇄본 일치 (원칙 준수)
본문 `getPublishedBodyDisplay`·그림 `getPublishedImageDisplaySrc` 경유 — textSelections/imageSelections
선택본이 자동 반영(하니스에서 mock 선택본 교체 확인). 원본 read만·DB write 0. root DOM 전부 textContent.

## 5. 검증
- 순수 테스트 **8**(BASE10 동일성·분기 버튼순 BFS·순환·누락·도달불능 이어붙임·표지 없음·표지 회귀·빈 입력) — 전체 **237/237**.
- 하니스(16장면 분기+고아 fixture): 페이지 9·지도 14줄(추가 1)·분기 카드 "→ 4번/→ 5번" 정확·엔딩 2·
  미연결/추가 장면 표기·**선택본 반영(그림 s2·본문)**·화면 root 숨김·print 매체 표시·afterprint 정리·
  타 gate(print-write-after/tc-print) 독립·**A4 PDF 9페이지**·pageerror 0. 스크린샷 확인(번호 배지·밑줄 안내·흑백 가독).

## 6. 남은 것
교사 PC 실프린터 1회 · 실작품(대형 이미지 다수) 인쇄 시간 체감 · POLISH 후보(지도 시각화·책자형·공개 감상 인쇄) — 수업 피드백 후.

## 판정
**PICTUREBOOK_PRINT_1_LIVE_PASS**
