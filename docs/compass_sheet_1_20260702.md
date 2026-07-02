# COMPASS-SHEET-1 — 생각 나침반 v2 "내 이야기 큰줄기 설계도" + 인쇄 결과지

2026-07-02 · 클라이언트 전용 · 기준 origin/main `3c48c3a`(V2-CLIENT-1) 이후
설계 근거: docs/story_compass_v2_question_design_20260702.md §5(출력층)·선행 감사 P-A/P-B

## 1. 구현
| 파일 | 변경 |
|---|---|
| **thought-compass-sheet.js (신규)** | 순수 helper(브라우저+Node): `buildStoryMapV2(answers)`→필드 10(라벨·아이콘·유예)+`summaryText`(템플릿 한 문단 줄거리·AI 0)+`deferredKeys`. targetLength choiceId→"약 8/12/15장면" 매핑. `isV2Questions()` 판별. **렌더 시 계산 — DB 저장 없음** |
| thought-compass-review.js | v2일 때 Q&A 목록 **위**에 설계도 섹션(검토+결과보기 양쪽): 줄거리+카드 10+[🖨 인쇄하기]. v1은 미노출(하위호환). `_printSheet()`=인쇄 동안만 `body.tc-print-sheet` 부여(afterprint+2s 방어 제거) |
| thought-compass.css | `.tc-sheet*` 스타일(2열 그리드·480px↓ 1열·유예 이탤릭) + `@media print` **body.tc-print-sheet 게이트**: 설계도+제목+자유메모만 1장, Q&A/버튼/배경 숨김, overlay static·card max-height 해제 |
| maker.html | sheet.js 로드 추가 + review/css 버스터 `tcsheet1` |
| viewer-edit.js | 🧭 결과보기 지연 번들에 sheet.js 추가 + V=`tcsheet1` |
| viewer.html | EDIT_SRC `...tcv2q1tcsheet1` |
| tests/thought-compass/sheet.test.js | 신규 7 테스트 |

## 2. 줄거리 템플릿(AI 0 · D-15 정신)
답 원문을 따옴표 인용해 문법 충돌 회피, 유예/빈 답은 "(만들면서 정하기)":
> 『{주인공}』의 이야기. 주인공이 가장 원하는 것은 "{goal}". 이야기는 "{start}"에서 시작해요.
> 그러다 "{event}". 하지만 "{trouble}" — 일이 점점 어려워져요. 가장 중요한 갈림길은 "{choice}".
> 진엔딩에서는 "{ending}". 다른 선택을 하면 "{alt}". 끝까지 지키고 싶은 것은 "{core}".

## 3. 인쇄 정책 (일반 화면 파손 0 보장)
- print CSS 전체가 `body.tc-print-sheet` 조건부 → **인쇄 버튼 경유가 아니면(일반 Cmd+P 포함) 완전 무효**.
- 클래스는 인쇄 동안만: click→add→`window.print()`→afterprint(+2s 사파리 방어)→remove.
- 1장 구성: 제목("내 생각 나침반") + 설계도(줄거리·카드) + 자유 메모. Q&A 목록·버튼·안내문 제외.
- PDF = 브라우저 인쇄 대화상자의 "PDF로 저장"(새 라이브러리 0).

## 4. 검증
- `node --check` OK · 테스트 **215/215**(기존 208 + sheet 7).
- Playwright(실 스크립트+스텁 Store):
  - v2 결과보기: 설계도 표시·카드 10·유예 카드 이탤릭+힌트·줄거리 『콩이』 시작·**Q&A 10 유지**·인쇄 버튼 ✅ (스크린샷 확인)
  - v1 결과보기: **설계도 미노출·7항목 그대로**(하위호환) ✅
  - v2 검토(완료 전): 설계도+고치기 10 공존 ✅
  - **print 에뮬레이션**(emulateMedia print + 클래스): 배경/QA/nav/버튼 `none`·overlay `static`·card max-height `none`·설계도/메모 표시 ✅
  - 클래스 부여 상태에서도 **화면 매체 무영향** ✅ · 콘솔 오류 0
- functions/rules/mobileTextBranch diff 0 · AI 호출 0 · DB write 0(파생 계산만) · 새 라이브러리 0.

## 5. 남은 것 / NOT_VERIFIED
- 실기기 인쇄(iPad Safari 인쇄 대화상자) 실측 — afterprint 방어는 코드로 처리.
- 나침반형(D-18 방사형) 시각 요약은 COMPASS-ROSE 후속(현 1차는 카드 그리드).
- AI 최소 정돈(D-14) summaryText 업그레이드 = COMPASS-SUMMARY-AI(callable·별도 승인).

## 판정
**COMPASS_SHEET_LIVE_PASS** — v2 답변이 Q&A 나열을 넘어 "진엔딩까지 한 줄기 설계도+1장 인쇄물"로 정리됨. v1 무영향.
