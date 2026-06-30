# 그림책 장면 분위기 — AI 장면발전 글 보기 미반영 수정 (2026-06-30)

> 증상: 그림책에서 `글 보기: 원본`이면 `장면 꾸미기 > 장면 분위기`(기본/이야기가 커져요/긴장감이 높아져요)가 작동하는데, `글 보기: AI 장면발전`에선 같은 버튼이 무반응. 클라만·deploy0·DB write0·AI 호출0·main merge0.

## 원인 판정: **C (mood 클릭이 variant-view 잠금에 막혀 저장+재렌더가 통째 차단)**

- `_saveSceneMoodField`(viewer-edit.js:5959) 맨 앞에 `_isVariantViewLocked()` 가드가 있어, AI 장면발전(aiS2) 보기 중엔 "AI 버전은 보기 전용입니다"로 **early return** → `scene.pbStoryStage` 미저장 + `_scheduleViewerFrameReRender` 미호출 → 분위기 미반영.
- 이 가드는 원본 **body/레이아웃** 보호용인데, mood는 본문이 아니라 페이지 프레임/배경 스타일이라 잘못 묶여 있었음.

## 원본 글 보기 렌더 경로
- `renderScene` → picturebook imageCenter 분기(viewer-render.js:763) → 무대 wrapper에 `data-story-stage="${scene.pbStoryStage}"` 부착(761-769). CSS(v03-modes.css)가 이 attribute로 `.scene-ornaments`/배경/box-shadow만 변경. **본문 텍스트와 독립.**

## AI 장면발전 글 보기 렌더 경로
- **동일한 `renderScene` 경로**를 탄다. 본문만 `_getDisplayBody`가 view mode에 따라 원본↔s2로 바꿔 넣고, 무대 wrapper의 `data-story-stage`는 `scene.pbStoryStage` 기준으로 **view-mode와 무관하게** 동일하게 부착된다. → 렌더 측은 원래부터 정상. 문제는 **저장이 막혀 pbStoryStage가 갱신 안 되고 재렌더도 안 된 것**.

## mood 저장 필드
- 일반 장면 = `scene.pbStoryStage`(`rising`|`turning`, 없으면 기본). 엔딩 = `scene.pbEndingMood`(`happy`|`sad`). 둘 다 `saveSceneText` ALLOWED(viewer-data.js:452-453)이며 saveSceneText에 variant 가드 없음.

## mood class/style 적용 방식
- 저장값 → `data-story-stage`/(엔딩)mood attribute → CSS. 본문/그림/말풍선 정본은 byte-identical(주변 무대만 변경).

## 구현
- `_saveSceneMoodField`에서 **`_isVariantViewLocked` early-return 가드 제거**(mood는 잠금 면제). 저장(`saveSceneText`) + `_scheduleViewerFrameReRender`는 그대로 → 현재 글 보기 모드(s2) 유지한 채 `data-story-stage`만 갱신. 원본 body/imageData/aiVariants/text 무접촉. AI 재생성 없음.
- 캐시버스터 `pbmoodaiview1`(viewer.html EDIT_SRC).

## 테스트 / 검증
- node 28/0 · node --check viewer-edit.js · precommit · secret 0 · tracked diff = viewer-edit.js + viewer.html만.
- 코드 검증: `_saveSceneMoodField` 내 `_isVariantViewLocked` 호출 **0**(가드 제거). saveSceneText pbStoryStage ALLOWED·variant 가드 없음. viewer-render data-story-stage 부착 = view-mode 독립. 서빙 코드(localhost:8000)에 반영 확인.
- ⚠️ **NOT_VERIFIED(라이브 인터랙티브 비주얼)**: 실 그림책 작품 + 교사 세션 + AI 장면발전 결과 상태에서 mood 클릭 시각 확인은 미수행(렌더 하니스가 fabricated scene을 imageCenter 경로로 라우팅하지 못함=closure 컨텍스트 한계, DB write 금지로 실 fixture 생성 불가). 원인→수정 로직은 결정적(가드 제거 = aiS2에서도 저장+재렌더 → data-story-stage 부착).

## 회귀
- 원본 글 보기 mood: 무영향(가드는 aiS2에서만 작동했음). 그림 보기 AI 그림책 마감: 무관(imageS2 경로 무접촉). 엔딩 mood(pbEndingMood)도 동일 가드 면제로 함께 해결.

**판정: `PICTUREBOOK_MOOD_AI_TEXT_VIEW_FIXED`** (코드·렌더 경로·테스트 검증 완료. 라이브 인터랙티브 시각만 실세션 권장).
