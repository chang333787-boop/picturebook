# 가지 — 쓰기 후 UI 변경 미반영 원인 + 관리자 설정 정리 (WRITE-AFTER-UI-VISIBLE-FIX, 2026-06-30)

> Phase 2 변경이 사용자 실화면에 안 보인 원인 규명 + 관리자 AI 설정까지 정리. 클라 UI만·서버/Rules/DB write 0·main merge 0(승인 대기).

## 원인 판정

- **(A) 라이브=main인데 Phase 2는 feature에만 있음 — 주원인.** GitHub Pages는 `main`을 서빙. 현재 origin/main = `ae7538a`(Phase 2 없음·`main:viewer-ai.js`에 "작품 마무리" 0개). Phase 2 viewer 모달/토글 변경은 `feature/write-after-rebuild`(`ecce2b4`)에만 있어 **병합 전까지 라이브에 안 보임**. → 사용자가 본 모달 제목 "AI 작품 다듬기"·텍스트 1단계 카드·"텍스트 2단계"는 전부 구 main 화면.
- **(E) 관리자 설정은 Phase 2 범위 밖이었음 — 별도 원인.** `adminConsole.js`의 `AI_MODE_DEFS`에 `textS1`('텍스트 1단계 (문장 정돈)')이 그대로 있어, 병합 여부와 무관하게 관리자 화면에 계속 노출됐음. Phase 2(WRITE-AFTER-UI-REBUILD-1)는 viewer-ai.js/viewer.html만 건드렸음.
- (B/C/D 기각): cachebuster·렌더 경로 다중·번들 구버전 문제 아님. 모달 렌더 경로는 `_showModeModal` 단일.

## 이번 루프 수정 (feature/write-after-rebuild)

### 관리자 AI 설정 (adminConsole.js)
- `AI_MODE_DEFS`에서 **textS1 제거** + textS2 라벨 '텍스트 2단계 (장면 발전)' → **'AI 장면발전'**. 최종 = [AI 장면발전 · 작품 검사 · AI 그림책 마감(교사용)].
- **기존 imageS1 폐기 패턴과 동일**(검증된 방식): AI_MODE_DEFS에서만 제거, state 로드(`state.modes.textS1`)·저장 payload(`modes.textS1`)는 **유지** → 기존 DB s1 값 **보존·임의 변경 없음**.
- 보존 의도 주석 추가(state init·payload).
- cachebuster `writeafterui1`(maker.html adminConsole.js).

### master 토글 ↔ s1 관계
- master(`#admin-ai-master`)는 `state.enabled`만 변경, `state.modes` 미접촉(코드 405–411) → **숨긴 s1을 켜지 않음**. AI_MODE_DEFS에 없는 textS1/imageS1은 마스터로도 신규 ON 불가. (값 변경 경로 = 체크박스뿐인데 체크박스 자체가 없음.)

### viewer 모달/토글 (Phase 2, `ecce2b4` — 이미 feature에 존재)
- 모달 제목 "📔 작품 마무리", 카드 = 작품 검사 → 직접 고치기(안내) → AI 장면발전 → AI 그림책 마감. 텍스트 1단계 카드 제거.
- 글 보기 토글 = [원본 | AI 장면발전], `_normalizeTextAiViewMode`로 aiS1→원본 정규화.
- 이번 루프에서 추가 수정 불필요(이미 반영). **단 라이브 노출은 병합 필요.**

## legacy s1 보존
- 서버 `callTextAiBatch`·QUOTA·기존 `aiVariants/text/{sid}/s1`·`aiSettings.modes.textS1` 전부 **삭제/마이그레이션 0**. UI 신규 노출만 제거.

## imageS2 회귀
- 게이트·문구·패널 무변경. AI_MODE_DEFS imageS2 유지(교사용 배지).

## 테스트 / smoke
- node 테스트 28/0 · node --check(adminConsole.js·viewer-ai.js) OK · precommit 통과(maker.html 위험파일 경고=정보성) · secret 0 · tracked diff = adminConsole.js + maker.html만.
- **브라우저 격리 렌더 smoke**(maker.html 로드 후 `_drawAiSettingsPanel` 실호출): 렌더 모드 = [AI 장면발전 · 작품 검사 · AI 그림책 마감(교사용)]. **textS1 체크박스 미존재**(state.modes.textS1=true여도 미렌더=보존-숨김 확인). 스크린샷 `admin-ai-settings-no-textstage1.png`.
- viewer 모달은 closure-private+지연로드라 격리 렌더 불가 → Phase 2 코드+테스트로 검증, 라이브 시각은 병합 후 확인.

## live/main 미반영 — 다음 결정
- **사용자가 변경을 보려면 `feature/write-after-rebuild` → main 병합 + Pages 반영 필요.** main merge는 사용자 승인 전 금지라 이번 루프는 보류. 병합 시 viewer 모달·토글·관리자 설정 변경이 함께 라이브 반영됨.
- 병합 범위 = imageS2 이후 쓰기-후 재설계 문서 + Phase 2 UI + 이번 관리자 설정(전부 클라·문서, 서버/Rules deploy 불요).

## 판정
**`BLOCKED_BY_LIVE_NOT_MERGED`** — 코드 수정(viewer Phase 2 + 관리자 설정)은 feature에 완료·검증됐으나, 사용자 실화면(=main/live) 반영은 **feature→main 병합 승인 대기**.
