# TEXT-S2-PUBLISH-CHOICE-REMOVAL-1 — 감상 글 정하기 제거·원본/AI 토글 구조 복구

- 일자: 2026-07-02 · 기준: origin/main `0a525a9` → 이번 commit
- 감사(배경/전수조사): docs/text_s2_publish_choice_removal_audit_20260702.md (판정 READY·B안 채택)
- 성격: **client-only**. Functions/Rules deploy 0 · DB write 0 · 실제 AI 호출 0 · migration 0

## 1. 구현 배경 (요약)
작품마무리에서 학생이 직접 고친 글을, 교사의 `감상 글 정하기`(textSelections 발행 확정)가 AI
장면발전(s2) 글로 최종 대체할 수 있었다 — AI는 확정본이 아니라 비교 후보라는 취지 위반.
기술적으로도 발행 레이어가 토글 아래에 깔려 **textSelections='s2' 장면은 토글 '원본'에서도
s2가 보이는** 모순이 있었다(감사 §1 실증). 발행 제도를 폐기하고 토글 비교로 통일했다.

## 2. 제거한 UI / 클라 호출 (viewer-ai.js)
- 토글 바의 `감상 글 정하기` 진입 버튼(+ 편집 세션 판정 `_selEditSess`) — 구 2571-2578
- `.js-ai-textsel-open` 클릭 바인딩 — 구 2591-2593
- `📖 감상에 보여줄 글` 모달 블록 전체 — `_textSelScenesWithS2`/`_textSelClip`/
  `_showTextS2SelectionModal`/`_applyTextSelection` (구 2606-2713, 약 108줄)
- 그 안의 문구 일체: "원본으로 정하기"·"AI 장면발전으로 정하기"·"현재 감상 글"·저장 실패 안내
- **`callApplyTextS2Selection` 클라 호출 0이 됨**(유일 호출부가 위 핸들러였음)
- 유지: `글 보기: 원본/AI 장면발전` 토글·AI 장면발전 생성/보기 흐름·이미지 토글/imageS2 전부 무변경

## 3. textSelections 신규 사용 중단 / legacy 처리
- `getPublishedBodyDisplay(scene, originalBody)` (viewer-data.js) → **항상 originalBody 반환**으로
  무력화. 시그니처·window 노출·module export 유지 → 렌더 8지점·picturebook-print 호출부 무수정.
- `loadTeamData`의 textSelections read·캐시(`_pubTextSelBySid`)·setter는 남아 있으나(dormant)
  표시 결정에 쓰이지 않음. **기존 DB 데이터는 삭제하지 않음.**
- `resolveSceneBodySource` 순수함수는 유지(미리보기 경로·export 계약).
- 서버 `callApplyTextS2Selection`·REFINE-STAB-A member 완화는 dormant 유지(삭제/deploy 없음).

## 4. 원본/AI 토글 기준 (복구된 의미)
| 화면 | 토글 원본 | 토글 AI 장면발전 |
|---|---|---|
| 장면 편집/다듬기 | 원본 body(editMode 고정) | s2 body(`_getDisplayBody`) |
| 감상 테스트 | **원본 body** (legacy s2 확정이 있어도) | s2 body |
| 공개 감상 | **원본 body** (〃) | s2 body |
- 토글 바는 기존대로 감상자/편집자 공통(s2 있을 때만), 저장 없음(localStorage 보기 상태만).
- s2 없는 장면은 AI 토글에서도 원본 body+원본 레이아웃(기존 fallback 유지).

## 5. 말풍선/글상자 레이아웃 (viewer-render.js `_renderScenePicturebook`)
- 원본 토글: 원본 `scene.picturebookBodyBox` 그대로(변화 0).
- AI 토글: variant layout(`aiVariants/text/{sid}/s2/layout`) 있으면 그것(기존·opacity는 원본 따름).
  **variant layout이 없어 원본 box를 fallback으로 쓰는 장면은 명시 height를 렌더에서만 생략**
  → 원본보다 긴 AI 글이 원본 고정 높이의 내부 스크롤에 갇히지 않고 분량대로 자동 확장.
  조건: `(_aiViewModePb aiS1/aiS2) && body !== _orig && bodyBox === _origBodyBox`.
- s2 body가 없으면 원본 레이아웃 그대로(위 조건의 `body !== _orig`가 차단).
- 저장값 무변경 — inline style 생성 시점만 분기. 텍스트 모드는 variant layout 개념이 없어 무영향.

## 6. 인쇄 기준
- picturebook-print.js **무수정** — `_publishedBody`가 무력화된 `getPublishedBodyDisplay`를 경유해
  legacy textSelections='s2' 데이터가 있어도 **인쇄=원본**으로 자동 통일.
- AI 장면발전으로 인쇄하는 옵션은 이번 범위 제외(후속 검토).
- imageSelections/인쇄 이미지 정책은 기존 유지.

## 7. 원본 보존 확인
- `scene.body`/`imageData`/`imageUrl`/`picturebookBodyBox`/`textBox` write 경로 신설 0 (읽기·렌더만 변경).
- 합성 스모크에서 각 케이스 렌더 후 `scene.body`·`picturebookBodyBox` byte-identical 확인.

## 8. 검증
- `node --check` viewer-ai/viewer-data/viewer-render/picturebook-print 전부 OK.
- 테스트: rules(에뮬레이터 필요·기존과 동일 제외) 제외 전 스위트 **462/462 PASS**
  (기준 467 = 구 resolver 19케이스 → 신 14케이스 재작성분 반영·회귀 0).
  재작성: tests/write-after/text-s2-select-resolver.test.js — legacy s2 확정 무시·setter dormant·
  인쇄 계약(원본)·imageSelections 기존 동작 유지 검증 포함.
- 브라우저 합성 스모크(Playwright·실 viewer-data.js+viewer-render.js·viewerAi 제어 스텁·127.0.0.1:8934 임시):
  ① legacy s2 주입 후 헬퍼=원본 ② 원본 토글=원본 body+height 40% 유지 ③ AI 토글(variant layout 무)=
  s2 body+height 생략 ④ AI 토글(variant layout 유)=s2 body+저장 height 55% ⑤ 편집=원본
  ⑥ s2 없음=원본 body+원본 layout — 전 케이스 PASS·원본 필드 불변.
- 금지 확인: functions/·rules diff 0 · secret grep 0 · DB write 0 · AI call 0.

## 9. 수정 파일 / 캐시버스터
- viewer-ai.js(버튼/모달/핸들러/호출 제거) · viewer-data.js(헬퍼 무력화) ·
  viewer-render.js(AI 토글 height 렌더 보정) · viewer.html(버스터) ·
  tests/write-after/text-s2-select-resolver.test.js(재작성)
- 캐시버스터: viewer-ai.js·viewer-data.js·viewer-render.js `?v=`에 **`texts2toggle1`** append.

## 10. 남은 후속
- AI 장면발전 인쇄 옵션(원본으로/AI로 선택) — 수요 확인 후.
- dormant callable(`callApplyTextS2Selection`)·textSelections 캐시/setter 코드 정리 — 별도 정리 트랙.
- imageSelections(그림 발행 선택) 정책 — imageS2 배치 플로우 라이브 상태라 별도 결정.
- 실기기(iPad) 감상에서 긴 s2 글 자동 확장 체감 1회 관측.
