# 텍스트/전환 효과 전역 설정 통일 + 전환 '없음'

- 일자: 2026-07-02
- 성격: 클라 UI/렌더 정리(viewer-data/viewer-edit/viewer-render) · deploy 0 · 실 AI 0 · DB write 0 · migration 0 · rules/functions 무관
- 판정: **`GLOBAL_EFFECT_SETTINGS_LIVE_PASS`**

## 1. 조사 결과 — 왜 중복이었나 (효과 두 축)
- **축 A(전역·stage-level)**: `ViewerState.project.textEntrance/sceneTransition` → `#viewer-frame[data-*]` → viewer.css. **그림책(pb)·표지·typewriter JS**를 구동.
- **축 B(장면별·scene-level)**: `scene.textEffect{entrance,body}` → `getTextEffect(scene)` → `.scene-screen--text[data-text-entrance/-body]` → v03-modes.css. **텍스트 모드만** 구동.
→ 텍스트 모드는 장면별(축 B), 그림책·표지는 전역(축 A)을 써서 감상 설정과 꾸미기 효과가 겹쳐 보였다.

## 2. 1번/2번 중 실제 작동
- **텍스트 모드**: 장면 꾸미기의 "이 장면의 텍스트 효과"(장면별)가 실제 작동했고, 감상 설정의 전역 텍스트 효과는 텍스트 모드엔 안 걸렸다(전역 CSS 셀렉터가 `.scene-screen--pb`만).
- **그림책·표지**: 감상 설정(전역)만 작동.

## 3. 삭제/숨김한 UI
- viewer-edit.js `_renderSceneStylePopoverBody`에서 **"✨ 이 장면의 텍스트 효과" 섹션(subtitle+hint+`_textEffectSectionHtml(scene)`) 제거**. 테마/글자 스타일/장면 분위기/폰트/크기/굵기·"작품 기본값으로 되돌리기"(테마·글자만 리셋·효과 무관)는 **유지**.
- `_textEffectSectionHtml`(3061)·핸들러 `js-edit-text-entrance`/`js-edit-text-body-effect`는 미렌더로 dead(바인딩 0·에러 없음·함수는 삭제 안 함).

## 4. 전역 효과 적용 정책 (핵심 1곳)
`getTextEffect(scene)`(viewer-data.js:1403)를 **전역 `project.textEntrance` 파생, `scene.textEffect` 무시**로 변경(삭제 X·레거시 보존). 매핑:
- typewriter→{entrance:none, body:typewriter} / slide-up→{slide,none} / fade→{fade,none} / blur-in·pop→{fade,none}(텍스트 모드 대응 키프레임 없어 안전 폴백) / none·미설정→{none,none}.
→ 텍스트 일반/엔딩 렌더(444/1883)·편집 미리보기(598)가 이 한 곳 경유 → 전부 전역화. 그림책·표지는 원래 전역이라 자동 일관.
- **브라우저 E2E**: 장면별 `{slide,typewriter}` 주입해도 전역값만 반환(none/fade/slide/typewriter/blur-in폴백/전역없음=none) — 장면별 완전 무시 확인.

## 5. 화면 전환 '없음' 추가
- `TRANS`(viewer-edit.js:2639)에 `{id:'none', label:'⛔ 없음'}` + `VALID_TRANS`(viewer-data.js:296)에 `'none'` 추가.
- `_stageReplaceScene`(viewer-render.js)에 `stage.dataset.transition==='none'`이면 **즉시 교체 분기**(애니메이션·is-leaving 없이 이전 장면 즉시 제거·잔상 0). 검증된 `__pbEditPreviewRerender` 즉시-교체 로직 재사용. 텍스트 등장 효과는 별개 축이라 유지(`_applyTextEntranceTypewriter` 호출).

## 6. 기존 scene별 effect 호환
- `scene.textEffect` DB 값 **삭제/마이그레이션 없음**. `getTextEffect`가 전역 우선으로 무시할 뿐. 저장 시 개별 effect 필드를 새로 쓰지 않음(장면별 UI 제거로 write 경로 미노출). "되돌리기" 버튼은 effect 미접촉이라 렌더 문제 없음.

## 7. 텍스트/그림책 확인
- 텍스트 모드: 전역 효과로 통일(E2E). 그림책/표지: 원래 전역 → 무영향(getTextEffect 미사용). 장면 분위기(pbStoryStage/pbEndingMood)·textSelections는 효과와 별개 축·무충돌.

## 8. 테스트
- node --check(viewer-data/viewer-edit/viewer-render) OK. 서빙 확인: 장면별 "이 장면의 텍스트 효과" UI 제거(주석만 잔존)·전환 '없음' 추가·전역 hint 갱신. resolver 전역우선 브라우저 E2E PASS. 콘솔 0.
- ⚠️ NOT_VERIFIED(인터랙티브 시각): 실 작품에서 장면 넘김 전환 '없음' 즉시교체·전역 효과 실렌더는 실작품/세션 필요(코드경로·resolver 단위 검증 완료).

## 9. cachebuster / commit·main·live
`globaleffects1`(viewer-data.js·viewer-render.js·EDIT_SRC 3종). functions/rules/DB/AI 무관·8000 미접촉.

## 남은 것
- 실기기: 감상 설정에서 텍스트 효과 변경→모든 장면 동일 적용·전환 '없음' 즉시전환·기존 작품 무회귀 확인.
- (선택) dead 함수 `_textEffectSectionHtml`·effect 핸들러 정리(별도 청소 루프).
- (선택) 텍스트 모드에 blur-in/pop 대응 키프레임 추가(현재 fade 폴백).
