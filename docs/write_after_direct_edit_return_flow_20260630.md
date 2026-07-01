# 쓰기 후 활동 — 직접 고치기 + 복귀 흐름 (WRITE-AFTER Phase 5, 2026-06-30)

> 정본 철학: **쓰기 후 활동은 AI가 대신 고쳐주는 기능이 아니라, AI가 질문하고 검사해서 학생이 직접 고친 뒤, 마지막에 AI 장면발전과 AI 그림책 마감을 후보로 비교하는 마무리 활동이다.**
> feature `feature/write-after-rebuild`. 클라 흐름만·새 callable 0·deploy 0·DB write 0·실 AI 0·main merge 0. 원본 body는 학생이 저장할 때만 바뀜.

## 목적
고쳐쓰기 자료(생각 점검 질문·작품 검사)를 본 뒤, 학생이 **그 장면을 직접 고치고 → 작품 마무리로 돌아와** 다음 단계(AI 장면발전 등)를 이어가도록 흐름을 연결한다. AI가 고쳐주는 게 아니라 학생이 직접 고친다.

## 흐름: 고쳐쓰기 자료 → 직접 고치기 → 복귀
1. **결과 카드의 '이 장면 고치기'**: 생각 점검 질문 결과·작품 검사 결과의 장면 버튼 문구를 `장면 N 이동` → **`✏️ 이 장면 고치기`**. 클릭 = 결과 모달 닫고 해당 장면 편집 진입(`editNavigateTo` = 편집 모드 본문 contenteditable).
2. **직접 고치기 카드**(2구역): 안내 카드 → **실행 카드 `현재 장면 고치기`**(`data-ai-mode="directEdit"`). 클릭 = 현재 선택 장면 편집 진입(장면 없으면 안내). 설명 "질문과 검사 결과를 보고 지금 장면을 직접 고쳐요. 내가 고친 글이 최종 작품이 돼요."
3. **복귀 안내 바**: 편집 진입 시 하단에 작은 바 — "✏️ 고친 뒤 **작품 마무리**로 돌아와 다음 단계를 이어가세요." + **`작품 마무리로 돌아가기`** 버튼 + 닫기(✕). 버튼 = `openModal`(작품 마무리 모달 재오픈).

## 구현 (viewer-ai.js)
- 공통 helper: `_enterDirectEditFromWriteAfter(sceneId, source)`(editNavigateTo + 복귀 안내·존재 검증)·`_showWriteAfterReturnHint(source)`(하단 바·sessionStorage `pb_write_after_source` 최소 기록)·`_returnToWriteAfterModal()`(안내 제거 + openModal)·`_hideWriteAfterReturnHint()`. source = `questions|workCheck|directEdit`.
- 검사 결과 핸들러(`.js-ai-check-jump`)·질문 결과 핸들러(`.js-ai-waq-jump`) → `_enterDirectEditFromWriteAfter(sceneId, ...)`.
- 직접 고치기 카드 = `_renderModeCard({key:'directEdit',...})` + 모달 클릭 핸들러에 `directEdit` 분기(현재 `ViewerState.currentSceneId`).
- 캐시버스터 `writeafterui2waq1waq2group1editreturn1`.

## 기능 보존
- 생각 점검 질문/작품 검사 결과 내용·`editNavigateTo` 로직·AI 장면발전/AI 그림책 마감 호출·imageS2 교사용 조건·textS1 미노출 모두 무변경. 새 callable/quota/서버 0. 원본 body 자동 수정 0.

## 테스트 / smoke
- node 29/0 · node --check · precommit · secret 0 · 변경 = viewer-ai.js + viewer.html.
- **브라우저 실 흐름 검증**(window.viewerAi.openModal + ViewerState 주입): `현재 장면 고치기` 카드 클릭 → 모달 닫힘 + `editNavigateTo('2')` 호출 + 복귀 안내 바(정확한 문구·버튼) 표시 → `작품 마무리로 돌아가기` 클릭 → 작품 마무리 모달 재오픈 + 안내 정리. 스크린샷 `write-after-p5-direct-edit-card.png`.
- 검사/질문 **결과 모달의 '이 장면 고치기' 버튼**은 코드 검증(버튼 문구 + 핸들러가 동일 helper `_enterDirectEditFromWriteAfter` 호출) — helper 자체는 위 직접 고치기 흐름으로 런타임 검증됨. (결과 모달 mock 자동 트리거는 harness의 ViewerState 주입이 `_buildWorkSnapshot`과 안 맞아 미실행 = 검증 도구 한계, 코드 이슈 아님. 실 세션에서 시각 확인 권장.)

## 남은 과제
- 검사/질문 결과 모달의 '이 장면 고치기' 실 세션 시각 확인.
- 편집 후 "다시 검사하기"(같은 세션 재진단) 버튼은 후속 후보.
- **프린트 기능**: 쓰기 후 활동 전체 구조 안정 후 진행(후속).

**판정: `WRITE_AFTER_DIRECT_EDIT_RETURN_READY`** — 직접 고치기 카드·결과 버튼·복귀 흐름 연결 완료. 기능/서버 무변경. main 병합은 승인 후.
