# 쓰기 후 활동 — 결과 기반 직접 고치기 (WRITE-AFTER Phase 5B, 2026-06-30)

> 정본 철학: **쓰기 후 활동은 AI가 대신 고쳐주는 기능이 아니라, AI가 질문하고 검사해서 학생이 직접 고친 뒤, 마지막에 AI 장면발전과 AI 그림책 마감을 후보로 비교하는 마무리 활동이다.**
> feature `feature/write-after-rebuild`. 클라 UX만·새 callable 0·deploy 0·DB write 0·실 AI 0·main merge 0.

## 왜 '현재 장면 고치기' → '결과 보며 고치기'로 바꿨나
- 수업 흐름: 1단계에서 생각 점검 질문/작품 검사로 **자료를 만들고**, 2단계에서 그 **결과를 다시 보며** 고칠 장면을 고른다.
- 기존 2구역 `현재 장면 고치기`는 "지금 이 장면"만 편집 — 최근 질문/검사 결과를 보며 고르는 흐름이 약했다.
- 그래서 2구역을 **최근 결과 다시 보기** 중심으로 재구성. 고친 뒤엔 **온 곳(결과 화면)으로** 돌아가 남은 항목을 이어서 본다.

## 2구역 재구성 (viewer-ai.js `_showModeModal`)
- 제목 `2. 직접 고치기` → **`2. 자료 보며 직접 고치기`** / 설명 "생각 점검 질문과 작품 검사 결과를 보며 장면을 직접 고쳐요."
- `현재 장면 고치기`(directEdit) 카드 **제거**. 대신:
  - **생각 점검 질문 결과 보기**(latestQuestions) — "AI가 준 질문을 다시 보며 고칠 장면을 골라요."
  - **작품 검사 결과 보기**(latestWorkCheck) — "확인할 점을 다시 보며 고칠 장면을 골라요."
- 클릭 → 최근 결과 모달(AI 재호출 없음). 결과 없으면 안내("1단계에서 먼저 …").

## 최근 결과 열기 (AI 0 · latest read만)
- 작품 검사: 기존 `_showLatestWorkCheck`(`aiChecks/workCheck/latest`) 재사용.
- 생각 점검 질문: **신규 `_showLatestWriteAfterQuestions`**(`aiChecks/writeAfterQuestions/latest` read → `_showWriteAfterQuestionsResultModal`). 없으면 "아직 생각 점검 질문 결과가 없어요. 1단계에서 질문을 먼저 받아 보세요."

## source별 복귀 (`_showWriteAfterReturnHint`)
- `_enterDirectEditFromWriteAfter(sceneId, source)`의 source에 따라 하단 복귀 바가 달라진다:
  - `questions` → "고친 뒤 생각 점검 질문으로 돌아와…" / **`생각 점검 질문으로 돌아가기`** → `_showLatestWriteAfterQuestions()`
  - `workCheck` → "고친 뒤 작품 검사 결과로 돌아와…" / **`작품 검사 결과로 돌아가기`** → `_showLatestWorkCheck()`
  - `directEdit`/기본 → "고친 뒤 작품 마무리로 돌아와…" / `작품 마무리로 돌아가기` → `openModal()`
- 결과 재오픈은 latest read만. latest 없으면 각 함수의 안내 alert(작품 마무리 fallback은 후속).

## 확인했어요 체크 (session/local · DB 0)
- 생각 점검 질문·작품 검사 결과 항목마다 **`□ 확인했어요` → `✅ 확인했어요`** 토글. 체크 항목은 살짝 흐리게.
- 저장 = localStorage만. key `writeAfterSeen:{classId}:{teamName}:{type}:{itemKey}` (workCheck=카테고리:index:장면 / questions=질문id(없으면 index):장면). **본문/개인정보 저장 안 함(체크 상태만)**. item id 없으면 index fallback.
- 교사 추적/프린트용 DB 저장은 별도 Phase(후속).

## 기능 보존
- 서버 workCheck/writeAfterQuestions prompt/schema/quota/저장 경로 무변경. `이 장면 고치기`(Phase 5) 유지. AI 장면발전/imageS2/textS1 미노출 무변경.

## 테스트 / smoke
- node 29/0 · node --check · precommit · secret 0 · 변경 = viewer-ai.js + viewer.html.
- **브라우저 end-to-end 검증**(firebase stub로 latest 주입): 2구역 = "자료 보며 직접 고치기" + [생각 점검 질문 결과 보기·작품 검사 결과 보기] → `작품 검사 결과 보기` 클릭 → 결과 모달(학생 라벨·`확인할 점:`) → `확인했어요` 토글(✅ + localStorage 저장) → `이 장면 고치기` → editNavigateTo + 복귀 버튼 **`작품 검사 결과로 돌아가기`** → 클릭 시 결과 모달 재오픈 + 확인했어요 상태 유지. 스크린샷 `write-after-p5b-result-based-edit.png`.

## 후속
- 확인했어요 DB 저장(교사 추적)·프린트/활동지 = 쓰기 후 구조 안정 후.

**판정: `WRITE_AFTER_RESULT_BASED_EDIT_FLOW_READY`** — 2구역 결과 기반 재구성 + source별 복귀 + 확인했어요(session/local) 완료. 서버/기능 무변경. main 병합은 승인 후.
