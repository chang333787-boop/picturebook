# COMPASS-ROSE-1 — 나침반형 이야기 설계도 정식 구현 (v2 결과보기 선택 보기)

2026-07-02 · 클라이언트 전용 · 기준 origin/main `2426a3c`(목업) 이후
시안 정본: mockups/compass-rose-v1.html · docs/compass_rose_mockup_1_20260702.md

## 1. 범위 (사용자 제한 그대로)
- **카드형(SHEET-1) = 기본·모바일 정본 유지** — 나침반형은 대체가 아니라 선택 보기.
- 진입: v2 **결과보기(read-only)** 설계도 헤더의 [🧭 나침반형] 버튼 → 전체화면 오버레이(보기)
  → 오버레이 안 [🖨 A4로 인쇄하기]. **v1·검토(완료 전) 미노출**, **모바일(≤600px) 버튼 CSS 숨김**.
- 데이터 = `buildStoryMapV2` 파생값 그대로(DB 저장 구조 무변경) + 자유메모(있으면 표시·없으면 손글씨 빈 줄 3).
- 인쇄 = 기존 gate 패턴 재사용(별도 클래스 `tc-print-rose`·버튼 경유에만 활성·afterprint+2s 제거)
  → 일반 화면/일반 인쇄/카드형 인쇄(tc-print-sheet) 영향 0.
- 새 라이브러리 0(선/원만 인라인 SVG·텍스트는 HTML 카드) · Functions/Rules/AI/DB 변경 0.

## 2. 구현
| 파일 | 변경 |
|---|---|
| **thought-compass-rose.js (신규)** | `ThoughtCompassRose.open({map, memo})` — 오버레이(sticky 툴바+종이 690px): 헤더(모둠/이름 칸+기본길이 배지)·나침반(중앙 coreMessage·4방위·N/E/S/W)·시간띠 5정거장+다른선택 점선 옆가지·메모·푸터. 전부 textContent(이스케이프 안전) |
| thought-compass-review.js | 설계도 헤더에 나침반형 버튼(조건: `R.readOnly && Rose 로드`) |
| thought-compass.css | `.tc-rose-*` 스타일 + `@media print` `body.tc-print-rose` 게이트 + 모바일 버튼 숨김 |
| maker.html / viewer-edit.js / viewer.html | rose.js 로드(정적+지연 번들) + 버스터 `compassrose1` + EDIT_SRC |

종이 폭 **690px** = A4 기본 인쇄 여백 안에 무스케일 수납 → zoom/@page 불필요(전역 인쇄 영향 0).

## 3. 검증 (Playwright·실 스크립트+스텁 Store)
| 항목 | 결과 |
|---|---|
| v2 결과보기 → 버튼 → 오버레이 | 방위 카드 4·정거장 5·중앙-카드 겹침 0·배지 "약 12장면"·유예 이탤릭·메모 표시 ✅ |
| **A4 인쇄(중단 조건)** | print 게이트(배경/결과보기/툴바 숨김·나침반만) + **PDF 정확히 1페이지** ✅ |
| 화면 무영향 | tc-print-rose 클래스 부여 상태에서도 screen 매체 정상 ✅ |
| 모바일 390 | 나침반 버튼 숨김·카드형 결과보기 유지 ✅ |
| 가드 | v1 결과보기 버튼 없음·v2 검토(완료 전) 버튼 없음 ✅ |
| 회귀 | 테스트 219/219 · node --check OK · pageerror 0 · functions/rules/mobileTextBranch diff 0 |

## 4. 남은 것 / NOT_VERIFIED
- 실기기 인쇄(iPad Safari) — afterprint+2s 방어는 코드 처리.
- 후속 대기: COMPASS-V2-FOLLOWUP(functions·deploy 승인) — 유일한 잔여 나침반 루프.

## 판정
**COMPASS_ROSE_1_LIVE_PASS** — 카드형 기본 유지 + 나침반형 선택 보기/A4 1장 인쇄 라이브.
