# WRITE-AFTER-PRINT-1 — 고쳐쓰기 자료(생각 점검+작품 검사) 인쇄

2026-07-02 · 클라이언트 전용 · 기준 main `3e56046`(PRINT-1-AUDIT) · 설계 정본 docs/print_flow_audit_20260702.md
기준 기기 = **교사 PC Chrome A4**(태블릿은 보조·버튼 title에 안내 문구). 그림책 분기 인쇄/BFS 번호/PDF 서버/모바일 그림책은 **범위 외**.

## 1. 구현
| 파일 | 변경 |
|---|---|
| viewer-ai.js | ①작품 마무리 **2단계 카드 아래 [🖨 고쳐쓰기 자료 인쇄]** 버튼(노출=`_writeAfterLatest.waq||wc` — 결과 없으면 미노출) ②`_buildWriteAfterPrintModel(scenes, waq, wc)` 순수 builder ③`_openWriteAfterPrint()`(latest 2노드 read→root DOM→gate→print→정리) ④window.viewerAi에 노출(하니스 검증용) |
| pb-ai.css | `.write-after-print-root{display:none}`(화면 상시 숨김) + `@media print body.print-write-after` gate(흑백 가독·break-inside:avoid·10~12pt) |
| viewer.html | AI_SRC·pb-ai.css 버스터 `writeafterprint1` |

## 2. 데이터/장면 매핑 (감사와 일치 확인)
- 읽기: `aiChecks/writeAfterQuestions/latest`·`aiChecks/workCheck/latest` **once 2회 read만** — AI 0·DB write 0·원본 무변경·rewriteDone 등 단계 게이트 무변경.
- 질문: `result.questions[]`(sceneId·question·studentAction/reason). 검사: `result.categories` 4종(화면과 동일 라벨) — real(sceneId/message/where)+구 mock fallback(issue·wrong→correct).
- 장면 라벨: `장면 N · 제목`(ViewerState.scenes에서 제목 병기) / sceneId 없음=`작품 전체` / 미존재=`장면 N (장면 정보 없음)`.
- BFS 번호 미사용(설계대로 — 쓰기후 자료는 장면 id 그대로).

## 3. 인쇄물 구성 (A4 1장~·항목 많으면 자동 2장)
제목 "✍ 고쳐쓰기 자료"+모둠/날짜+안내문("아래 내용을 보며 장면을 고친 뒤, 고친 항목에 체크해요.")
→ 💭 생각 점검 질문 / 🔍 작품 검사(있는 섹션만) — 항목마다 **☐ 고쳤어요**+장면 라벨+내용+보조설명+메모줄
→ 📝 오늘 내가 고친 것(빈 줄 3). 전부 textContent(이스케이프 안전)·색 의존 없음(흑백 가독).

## 4. gate/정리
버튼 클릭에만 `body.print-write-after`+root 생성 → window.print → **afterprint(+2s 방어)에서 클래스·root 모두 제거**(취소 포함). root 중복 생성 방지(기존 제거 후 재생성). 기존 `tc-print-sheet/rose` gate와 셀렉터 완전 분리 — 상호/일반 인쇄 영향 0.

## 5. 검증 (Playwright·mock DB·실 viewer-ai.js 로드)
- builder: 합본 2섹션·질문만/검사만 단독·없음=0·장면 라벨 3형태 전부 ✅
- 결과 없음: alert("아직 인쇄할 자료가 없어요…")·root 미생성·print 미호출 ✅
- 인쇄 흐름: root 생성·print 1회·gate on·섹션 3(질문+검사+마무리 메모)·체크칸·메모줄·**화면에서 root display:none+기존 화면 정상**·afterprint 후 클래스/root 완전 정리 ✅
- print 매체: root만 표시·나머지 숨김·**A4 PDF 1페이지** ✅ · pageerror 0 · 테스트 229/229 · functions/rules diff 0

## 6. 남은 것
실기기(교사 PC 실제 프린터) 출력 1회 확인 · 항목 20+ 대량 결과의 2장 분할 실측(스모크는 소량) · 다음 루프 = PICTUREBOOK-PRINT-1(BFS 번호·설계 완료 상태).

## 판정
**WRITE_AFTER_PRINT_1_LIVE_PASS**
