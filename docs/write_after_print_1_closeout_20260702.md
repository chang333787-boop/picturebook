# WRITE-AFTER-PRINT-1 CLOSEOUT — 고쳐쓰기 자료 인쇄 실측 마감

- 일자: 2026-07-02 · 기준: main `e82551b` 이후 (BRANCH-FINAL-POLISH-LOOP-1 Phase B)
- 방법: 실코드 하니스(viewer-data.js+viewer-ai.js 실로드·firebase mock read-only·Playwright)
- 판정: **WRITE_AFTER_PRINT_1_CLOSEOUT_PASS** (CSS 보정 불필요·코드 수정 0)

## 확인 결과

| # | 항목 | 결과 |
|---|---|---|
| 1 | 작품마무리 2단계 `🖨 고쳐쓰기 자료 인쇄` 버튼 | ✅ waq/wc latest 있을 때 노출 |
| 2 | 질문만 있을 때 | ✅ 섹션 2(질문+오늘 메모)·항목 7 |
| 3 | 검사만 있을 때 | ✅ 섹션 2·항목 30(4카테고리 라벨 병기) |
| 4 | 둘 다 있을 때 합본 | ✅ 섹션 3·항목 37 |
| 5 | 결과 없을 때 | ✅ 버튼 숨김 + "아직 인쇄할 자료가 없어요" 안내·root 미생성 |
| 6 | `☐ 고쳤어요` 체크칸 | ✅ 37/37 항목 |
| 7 | 메모 줄 | ✅ 40(항목 37+마무리 3) |
| 8 | 장면 표시 | ✅ "장면 1 · 숲 입구"(제목 병기)·"작품 전체"(sceneId 없음) |
| 9 | A4 출력 | ✅ 소량=1p(기존 검증)·이번 실측 대량 기준 |
| 10 | **대량 항목 page break** | ✅ 37항목 → **A4 5페이지**. `.wa-print-item{break-inside:avoid}` + 항목 최대 높이 109px(페이지의 ~1/10) → 항목이 페이지 경계에서 잘리지 않음 |
| 11 | print 후 정리 | ✅ afterprint(PDF 생성 시에도 발화 확인) → `print-write-after` gate·root 제거 |
| 12 | 타 print gate 충돌 | ✅ 인쇄 중 tc-print-sheet/tc-print-rose/print-picturebook 부재 |
| 13 | console error | ✅ 0 (하니스 전 시나리오) |

## NOT_VERIFIED (사용자 실측 대기)
- 교사 PC 실프린터 물리 출력 1회 (드라이버/여백 실물 확인)

## 비고
- PDF page-count는 Playwright headless `page.pdf(A4)` 기준. Chromium print 엔진과 동일 계열이라
  교사 PC Chrome 인쇄와 분할 동작 동일 예상.
- 기능/CSS 수정 없음 — closeout은 검증 기록만.
