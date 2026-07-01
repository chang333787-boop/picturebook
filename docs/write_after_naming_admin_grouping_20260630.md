# 작품 마무리 — 명칭 통일 + 관리자 설정 그룹화

- 일자: 2026-07-01
- 브랜치: `feature/write-after-rebuild` (main 미병합 — 승인 대기)
- 성격: **사용자 노출 문구/UI만** (기능·callable·저장구조·prompt·quota 무변경 · deploy 0 · DB write 0 · 실 API 0)
- 상위 문서: [[project-branch-write-after-rebuild]]

## 왜 'AI 다듬기' → '작품 마무리'인가

예전 이름 'AI 다듬기'는 "AI가 글을 대신 다듬는" 단일 기능 인상을 준다. 현재 흐름은 단일 기능이 아니라 3단계 활동이다:
1. **고쳐쓰기 자료 만들기** — 생각 점검 질문 · 작품 검사
2. **자료 보며 직접 고치기** — 학생이 직접 scene.body 수정
3. **마지막 다듬기** — AI 장면발전 · AI 그림책 마감을 후보로 비교

따라서 전체를 아우르는 '작품 마무리'가 정확하고, "AI가 대신 고친다"는 오해도 줄인다. '마지막 다듬기'는 3단계 이름으로 유지, imageS2 카드명 'AI 그림책 마감'도 유지.

## 2부 — 명칭 통일 (변경 내역)

| 위치 | 이전 | 이후 |
|------|------|------|
| 상단 버튼 (viewer-render.js:2247) | `🤖 AI 다듬기` (+ title/aria "AI 다듬기 — 문장 정돈·작품 검사") | `📁 작품 마무리` (+ title/aria "작품 마무리 — 질문·검사·직접 고치기·마지막 다듬기") |
| 첫 안내 모달 본문 (viewer-ai.js `_showOnboardingModal`) | "AI는 작품을 대신 만들거나 고치지 않아요…" (AI 중심) | "작품 마무리는 질문과 검사로 고칠 곳을 찾고, 내가 직접 고친 뒤, 마지막에 AI 후보를 비교해 보는 활동이에요…" (흐름 중심) |
| 첫 안내 hint | "AI 결과는 후보로만 보여줘요…" | "AI 결과는 참고 자료예요. 내가 직접 읽고 판단해 골라 적용해야…" |
| 작품 마무리 모달 상단 설명 (`_showModeModal` intro) | "…마지막에 AI 도움을 받아 작품을 완성해요." | "…자료를 보며 직접 고친 뒤, 마지막에 AI 후보를 비교해 보세요." |
| 레거시 mock 비교 모달 제목 (dead code `_showComparisonModal`) | "🤖 AI 다듬기 결과 — 1단계" | "✨ 장면 발전 결과" |
| 레거시 mock 적용 안내 | "AI 다듬기 적용했어요" | "장면 발전을 적용했어요" |
| 진입점 주석 3곳 (viewer-ai/viewer-render/viewer-image-batch-ui) | "🤖 AI (작품) 다듬기" | "📁 작품 마무리" |

- 모달 제목은 이미 `📔 작품 마무리`였음(P2에서 변경) — 유지.
- 레거시 `_showComparisonModal`은 `_startTextS1`(주석 "옛 흐름 비활성·호출 박지 X")에서만 호출되는 **데드코드** — 문구 중립화는 동작 무변경, textS1 미복구.
- viewer-edit.js:4762 주석 1건만 의도적으로 미변경(EDIT_SRC 거대 캐시버스터 불필요 churn 회피). 사용자 노출 아님.
- **기능·핸들러·callable·저장구조·quota·prompt 무변경.** 노출 'AI 다듬기' 텍스트 0(서빙 viewer-ai.js grep 확인).

## 3부 — 관리자 설정 '작품 마무리 활동' 그룹화

- `_drawAiSettingsPanel`(adminConsole.js) `#admin-ai-modes` 안, 토글 위에 그룹 카드 추가:
  - 제목 `📁 작품 마무리 활동`
  - 설명 "작품 마무리 활동은 질문 만들기, 작품 검사, 직접 고치기, 마지막 다듬기를 한 흐름으로 진행해요. 아래에서 켠 기능만 학생에게 보여요."
- **저장 구조 완전 보존**: `_saveAiSettings` payload(modes: textS1/textS2/workCheck/writeAfterQuestions/imageS1/imageS2 + policy) 무변경. AI_MODE_DEFS 4키(writeAfterQuestions/workCheck/textS2/imageS2) 유지. master toggle(`AI 전체 켜짐/꺼짐`) 라벨·동작 유지.
- `id="admin-ai-modes"`·`data-ai-mode` input·이벤트 핸들러 모두 그대로 → git diff는 그룹 div 삽입 4줄뿐.
- **textS1 미노출 유지**(AI_MODE_DEFS에 없음 — state.modes.textS1=true여도 토글 렌더 0).
- **imageS2 '교사용 · 외부 AI 서비스로 전송' 안내 유지**(기존 hint 그대로).

## 유지한 저장 구조 / 안전 안내 (요약)

- aiSettings payload·mode key·policy·master toggle 동작 — 전부 그대로.
- imageS2 교사용/외부 AI 전송 경고 — 그대로 노출.
- textS1 — 설정 UI·viewer 카드 모두 미노출(저장값은 보존, 마이그레이션 안 함).

## 테스트 결과

- `node --check` — adminConsole.js / viewer-ai.js / viewer-render.js / viewer-image-batch-ui.js 전부 OK.
- forbidden 파일(functions/rules/database) diff 0. secret grep 0.
- **관리자 패널 격리 렌더 smoke**(Playwright `_drawAiSettingsPanel` 실호출, state.modes.textS1=true 주입): '작품 마무리 활동' 그룹+설명 표시 · 토글 4개(writeAfterQuestions/workCheck/textS2/imageS2) · **textS1 토글 없음** · 외부 AI 안내 유지 · AI 그림책 마감(교사용) 표시 · master 토글 유지. (스샷 write-after-admin-finishgroup-smoke.png)
- **서빙 바이트 검증**(로컬 8123): 상단 버튼 `📁 작품 마무리` · 온보딩/모달 문구 변경 · mock 중립화 · viewer-ai.js 노출 'AI 다듬기' 0 · 캐시버스터 render `finishname1`·AI_SRC `stepgate1finishname1`·admin `finishgroup1` 반영 · 콘솔 에러 favicon 404뿐.
- ⚠️ **NOT_VERIFIED(인터랙티브 시각)**: 상단 버튼·작품 마무리 모달의 실제 렌더는 실 교사 로그인+실작품+편집 세션 필요(viewer-ai 지연로드·closure-private) — 기존 phase와 동일 caveat. 코드/서빙 바이트/관리자 렌더는 검증됨.

## 캐시버스터

- viewer.html: `viewer-render.js?v=…imgs2ending2finishname1`, `AI_SRC=…stepgate1finishname1`
- maker.html: `adminConsole.js?v=…waq1finishgroup1`

## P6 조사 문서 링크

- [P6 textS2 최종화 조사](write_after_text_s2_finalize_audit_20260630.md) — 판정 `TEXT_S2_FINALIZE_AUDIT_READY`. textS2는 학생 최신 원본 body 입력·원본 불변·캐시위험 없음. P6/P7 = imageSelections 평행 `textSelections` 신규.

## 후속 (프린트/활동지 메모)

- 작품 마무리 활동 결과(질문·검사 항목)를 종이 활동지로 출력하는 기능은 미착수(후속 루프).
- rewriteDone 자동 초기화(작품 수정 시 게이트 리셋)·'확인했어요' DB 추적도 후속.

## 병합 정책

- 2·3부는 **feature push까지만**. main 병합은 **사용자 승인 후** 별도 진행(이번 루프 금지).
