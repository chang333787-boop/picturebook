# 쓰기 후 활동 — 단계 완료 게이트 (WRITE-AFTER Phase 5C, 2026-07-01)

> 정본 철학: **쓰기 후 활동은 AI가 대신 고쳐주는 기능이 아니라, AI가 질문하고 검사해서 학생이 직접 고친 뒤, 마지막에 AI 장면발전과 AI 그림책 마감을 후보로 비교하는 마무리 활동이다.**
> feature `feature/write-after-rebuild`. 클라 UX만·새 callable 0·deploy 0·DB write 0·실 AI 0·main merge 0.

## 목적 (단계 잠금)
학생이 **고치기 전에** 3단계(AI 장면발전/그림책 마감)를 눌러버리지 않게, 흐름을 **① 자료 만들기 → ② 자료 보며 직접 고치기 → ③ 마지막 다듬기**로 자연스럽게 잠근다. 3단계는 2단계 `모두 고쳤어요`(rewriteDone) 전까지 비활성.

## 1단계 완료 표시 (latest 존재 기반)
- 모달 열 때 `_preloadWriteAfterLatestFlags()`가 `aiChecks/writeAfterQuestions/latest`·`aiChecks/workCheck/latest` **존재만** DB read(2건·AI 0·best-effort).
- 결과가 있으면 카드 제목에 **`✅`** + 설명 "이미 …했어요. 2단계에서 다시 볼 수 있어요."(재실행은 여전히 가능). 제목 `1. 고쳐쓰기 자료 만들기`.

## 2단계 `모두 고쳤어요` (rewriteDone · localStorage)
- 2구역 하단 박스: rewriteDone=false → "자료를 보고 필요한 장면을 고쳤나요?" + **`□ 모두 고쳤어요`**.
- 누르면 rewriteDone=true → 2구역 결과 보기 카드 2개 **비활성(dimmed)**(클릭 시 "이미 고쳐쓰기 완료로 표시했어요…") + **`✅ 고쳐쓰기 완료`** + **`다시 고칠래요`**. 설명 "필요한 장면을 고쳤어요. 다시 고치려면 아래 버튼을 눌러요."
- `다시 고칠래요` → rewriteDone=false → 2구역 재활성 + 3구역 재잠금.
- 저장 = localStorage key `writeAfterStepDone:{classId}:{teamName}:rewrite`. **본문/개인정보 저장 0·DB 0**. 확인했어요(항목별)와 **별개**(확인 다 안 해도 모두 고쳤어요 가능).

## 3단계 잠금/활성
- rewriteDone=false: 3구역 제목 `3. 마지막 다듬기 🔒`, 흐리게, 설명 "2단계에서 자료를 보고 고친 뒤 마지막 다듬기를 할 수 있어요." AI 장면발전·AI 그림책 마감 **disabled**(사유 "먼저 2단계에서 … ‘모두 고쳤어요’를 눌러 주세요.").
- rewriteDone=true: 활성 = **`rewriteDone && mode allowed`**. 즉 teacher setting OFF면 rewriteDone 후에도 해당 카드 disabled(기존 사유 표시). imageS2 교사용 조건 유지. 잠금 사유가 우선, 완료 후 기존 OFF 사유.

## 구현 (viewer-ai.js)
- 헬퍼: `_rewriteDoneKey/_isRewriteDone/_setRewriteDone`(localStorage), `_preloadWriteAfterLatestFlags`(latest read·`_writeAfterLatest` 캐시). openModal에서 preload.
- 모달 IIFE에 rewriteDone 반영(sec1 배지·sec2 박스+잠금·sec3 잠금). `모두 고쳤어요`/`다시 고칠래요` 버튼 → 토글 후 `_showModeModal` 재렌더.
- 캐시버스터 `stepgate1`.

## 기능 보존
- 생각 점검 질문/작품 검사 실행·최근 결과 보기·확인했어요·source별 복귀·AI 장면발전/그림책 마감 호출·textS1 미노출·서버/prompt/schema/quota 무변경.

## 테스트 / smoke
- node 29/0 · node --check · precommit · secret 0 · 변경 = viewer-ai.js + viewer.html.
- **브라우저 end-to-end 검증**(firebase stub): rewriteDone=false → 3단계 🔒·s2 disabled·2단계 결과 enabled·1단계 ✅배지·모두고쳤어요 버튼 → 클릭 → 3단계 잠금해제·2단계 결과 disabled·고쳐쓰기 완료·다시고칠래요·localStorage 저장 → 다시고칠래요 → 원복+localStorage 해제. 스크린샷 `write-after-p5c-step-gate.png`.

## 후속
- 작품 대폭 수정 시 rewriteDone 자동 초기화(현재는 학생이 다시 고칠래요로 수동)·프린트/활동지·확인했어요 DB 추적 = 후속.

**판정: `WRITE_AFTER_STEP_COMPLETION_GATE_READY`** — 1단계 완료 표시 + 2단계 모두 고쳤어요 잠금 + 3단계 게이트(localStorage·DB 0·AI 0). 서버/기능 무변경. main 병합은 승인 후.
