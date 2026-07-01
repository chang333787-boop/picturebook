# C-1 수정 — textSelections 발행 선택 시 편집 원문 오염 방지

- 일자: 2026-07-01
- 대상 결함: 총점검 C-1 (CRITICAL) — [full-day audit](write_after_full_day_audit_20260701.md)
- 성격: 버그 수정(클라 렌더만) · deploy 0 · DB 0 · 실 AI 0 · Rules/Functions 무변경
- 판정: **`ORIGINAL_BODY_POLLUTION_FIX_READY`** → (병합·live 후) `ORIGINAL_BODY_POLLUTION_FIX_LIVE_PASS`

## C-1 원인
P7 textSelections 렌더 hook에서 viewer-render.js 8개 body 지점이 `const body = _getDisplayBody(scene.id, _pubBody)`를 썼다. 원본 보기 모드에선 `_getDisplayBody`가 입력을 그대로 반환하므로 `body === _pubBody`. `_pubBody = getPublishedBodyDisplay(scene, _orig)`는 교사가 textSelections에 s2를 발행선택한 장면이면 **s2 본문**. 편집 게이트 `_allowTcEdit = editMode && aiViewMode==='original'`가 원본 보기에서 contenteditable(`data-pb-editable="body"` → scene.body 저장)을 허용하므로, 교사가 s2 발행선택한 장면을 원본 보기에서 편집/blur하면 **s2 텍스트가 원본 scene.body를 덮었다.**

## 수정 (8지점)
viewer-render.js 8개 `_pubBody` 정의를 **편집 세션이면 `_orig` 고정**으로 변경:
```js
const _pubBody = (typeof ViewerState !== 'undefined' && ViewerState.editMode)
  ? _orig                                              // 편집 세션: 편집 필드 오염 방지
  : ((window.getPublishedBodyDisplay) ? window.getPublishedBodyDisplay(scene, _orig) : _orig);  // 감상: 발행 선택 반영
```
- `_orig`(진짜 원문) 변수는 **절대 미변경**(8개 `const _orig` 그대로).
- 편집 가능한 contenteditable(원본 보기·편집 세션)에는 항상 `_orig` 렌더 → scene.body 저장 경로 오염 0.
- 감상/비편집(학생·감상 테스트)에서만 `getPublishedBodyDisplay`로 발행 선택(s2) 표시.
- **editMode 게이트 = `_allowTcEdit` 게이트와 출력 동일**: aiS2 보기에선 `_getDisplayBody`가 입력과 무관하게 variant를 반환하므로, 두 게이트의 렌더 결과가 모든 경우 동일(원본보기: 편집=_orig / 감상=발행, aiS2보기: variant). 재정렬 불필요·최소 변경.
- 8개 hook: 텍스트 장면 · 그림책 분할 · imageCenter 계열 3 · 엔딩 텍스트 · 엔딩 그림책 2.

## 검증
- **8지점 게이트 적용 확인**(grep 8) · `const _orig` 9개 전부 보존.
- node --check(viewer-render/viewer-data) OK · resolver 테스트 18/18 · 이미지 회귀 16/16.
- **브라우저 E2E**(실 `window.getPublishedBodyDisplay` + 실제 `_pubBody` 표현식 재현): scene에 s2 발행선택 후 —
  - editMode=true → `_pubBody='학생_원본'`(편집 필드 = 원본, 오염 차단)
  - editMode=false → `_pubBody='S2_발전본'`(감상 = 발행 s2)
  - 감상 resolver = 'S2_발전본', `scene.body` = '학생_원본' 불변. 콘솔 에러 0.
- textS1 미노출·imageS2 영향 0(viewer-render body 지점만 수정, 이미지 경로 무관).
- 캐시버스터: viewer-render `…textsel1textsel2uifixorig1`.

## 검증 매핑(요청 10항목)
1. selection 없음 → 원본 ✓(resolver 기본 original) 2. selected original → 원본 ✓ 3. selected s2 + 비편집 감상 → s2 ✓(E2E) 4. selected s2 + 편집 원본 보기 → 편집 필드 원본 ✓(E2E editMode=true) 5. blur/save해도 scene.body 불변 ✓(편집 필드가 _orig라 저장돼도 원본 동일) 6. `_orig`/`_pubBody` 분리 유지 ✓ 7. 8지점 모두 ✓ 8. text 모드 회귀 ✓(node/test) 9. textS1 미노출 ✓ 10. imageS2 회귀 0 ✓.

## 남은 것
- H-1/H-2(`_validateRequest` team membership 미검사)는 별도 안전모드 루프(rules/functions 승인 게이트).
- 실 교사 세션 인터랙티브 시각(모달·selection 저장 E2E)은 실작품 필요 = NOT_VERIFIED 유지.
