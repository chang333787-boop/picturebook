# BRANCH-FINAL-POLISH-LOOP-1 — 회귀 확인 + 인쇄 closeout + 카드 빠른 수정 + 잔여 정리

- 일자: 2026-07-02 · 시작 기준: origin/main `e82551b`
- 커밋: `2a20c17`(카드 빠른 수정) · `b017b0e`(주석 정리) · 본 문서 커밋
- 성격: client-only. Functions/Rules deploy 0 · DB write 0 · 실제 AI 호출 0 · migration 0
- 판정: **BRANCH_FINAL_POLISH_LOOP_1_LIVE_PASS** (실기기 항목만 NOT_VERIFIED 명시)

## Phase A — 회귀 확인 (실코드 하니스·Playwright)
viewer-data.js+viewer-ai.js+picturebook-print.js를 실로드(firebase mock read-only·edit 세션 URL)한
하니스에서 확인:
1. **감상 글 정하기 제거** ✅ — `_showAiToggleBar()` 실렌더 버튼 = [원본, AI 장면발전] 뿐.
   `.js-ai-textsel-open` 부재. 작품마무리 모달 텍스트에 폐기 문구 일체 없음.
2. **원본/AI 토글 의미** ✅ — legacy textSelections='s2' 주입 상태에서 `getPublishedBodyDisplay`=원본.
   (TEXT-S2 루프의 렌더 스모크 6케이스와 동일 코드 경로 — 원본 토글=원본·AI 토글=s2 재확인)
3. **긴 AI 글 말풍선 확장** ✅ — TEXT-S2 루프 스모크로 검증된 코드 그대로(diff 0): variant layout
   없으면 height 렌더 생략(자동 확장)·있으면 저장값·원본 보기는 원본 layout. 저장값 불변.
4. **AI 그림책 마감 카드** ✅ — 그림책+edit 세션: 3단계에 'AI 장면발전'+'AI 그림책 마감' 둘 다.
   텍스트 작품: 'AI 그림책 마감' 미표시(그림책 인쇄 버튼도 미표시). 조건=isEditViewerSession+picturebook.
5. **그림책 인쇄 기본 원본** ✅ — legacy s2 확정 주입 후 `PicturebookPrint.open()` 실행:
   인쇄 DOM 본문=원문, AI 문장 0, gate `print-picturebook` 정상.
6. **안정화 유지** — 이야기 길/그림책 인쇄 버튼 작품마무리 내 존재 ✅·하니스 console error 0 ✅.
   다듬기→브랜치 복귀·밤테마 버튼 색은 이번 diff 무접촉(REFINE-STAB 검증 기록 유지)·실기기 NOT_VERIFIED.

핫픽스 필요 없음 → Phase A 코드 수정 0.

## Phase B — WRITE-AFTER-PRINT-1 closeout
별도 문서: docs/write_after_print_1_closeout_20260702.md — **CLOSEOUT_PASS**.
질문만7/검사만30/합본37/없음(버튼 숨김+안내) 전부 정상. 대량 37항목=A4 5페이지·
break-inside:avoid로 항목 잘림 0·afterprint 정리 정상·타 print gate 충돌 0. CSS 보정 불필요.
남은 것=교사 PC 실프린터 물리 출력 1회(사용자).

## Phase C — 브랜치 카드 본문 빠른 수정 (CARD-QUICK-EDIT-1)
- **동작**: 브랜치 카드 본문 미리보기(`.pb-body-preview`) 클릭 → 미니모달 "✏️ 장면 N 글 고치기"
  (textarea=원본 scene.body·저장/취소·안내 "AI 장면발전 글이 아니라, 학생이 직접 쓰는 원본 글을 고칩니다.").
- **카드 크기 고정**: 인라인 확장 없음 — 모달 방식. 미리보기 3줄 클램프 그대로.
- **드래그 충돌 0**: pointerdown 좌표 기억→8px 이하 이동일 때만 오픈(카드 드래그 임계값과 동일 규칙).
  pointerdown 전파 유지라 미리보기를 잡고 카드 드래그 가능. 모달 pointerdown은 캔버스 팬/줌 차단.
- **저장 흐름 재사용**: `updateBody`+`flushBodySaves`(잠금·debounce·_hasBody 정책 동일) +
  카드 숨은 textarea·접힌 미리보기 즉시 동기(`_pbSyncPreviewFromTextarea`·전체 재렌더 0).
- **잠금**: `isLockedByOther` 즉시 차단 + `ensureEditable` 백그라운드 확보(실패 시 닫고 안내).
- **범위 가드**: 표지 카드 제외(`type==='cover'` return)·AI variants/textSelections 접근 0.
- 수정 파일: ui.js(`showBodyQuickEditModal`)·sceneRenderer.js(클릭 바인딩)·maker.html(CSS+버스터).
- **검증**(실 ui.js+sceneRenderer.js 하니스·Playwright): 열림/원본 표시/저장→body·push·미리보기·
  숨은 textarea 동기/취소·ESC 무변경/카드 크기 byte-identical/드래그 시 카드 이동+모달 미오픈/
  드래그 직후 클릭 정상/잠금 시 미오픈+안내 — 전부 PASS. textarea 16px(iOS 줌 방지)·
  짧은 화면 overflow:auto 안전판.
- 버스터: maker.html의 sceneRenderer.js·ui.js `?v=` += `cardquickedit1`.

## Phase D — 잔여 정리
- 사용자 노출 문구 grep 0(감상 글 정하기·감상에 보여줄 글·원본으로 정하기·AI 장면발전으로 정하기·현재 감상 글).
- 클라 `callApplyTextS2Selection` 호출 0 유지(주석 언급만).
- stale 주석 정리: viewer-render.js `_pubBody` 8지점(구 C1FIX 설명→폐기 후 실동작 설명),
  viewer-data.js TEXT-S2-SELECT 섹션 헤더(폐기·dormant 명시)+setter 주석.
- dormant 유지: 서버 callable·textSelections DB·캐시/setter 코드 무접촉.

## 보존·안전 확인
- scene.body/imageData/imageUrl/picturebookBodyBox/textBox: 신규 write 경로 0
  (Phase C 저장은 기존 updateBody 경로 그대로 — 원본 body를 학생이 의도적으로 고치는 정규 흐름).
- functions/·rules diff 0 · 실제 AI 호출 0 · 운영 DB write 0(하니스는 전부 mock).
- 테스트: rules(에뮬레이터) 제외 전 스위트 462/462 PASS.

## 남은 후속
- 실기기: 다듬기→복귀·밤테마 버튼·카드 빠른 수정 터치 체감(iPad)·실프린터 1회.
- 인쇄 polish(실사용 피드백 후)·AI 장면발전 인쇄 옵션·imageSelections 정책(별도 결정).
