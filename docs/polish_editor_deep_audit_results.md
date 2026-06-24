# 다듬기 화면 전수조사 결과 (Polish Editor Deep Audit)

> AI 이미지 구현 전 다듬기 안정화. branch `feature/polish-editor-deep-audit`, base `origin/main` (b71d5fc).
> 운영 무접촉(배포·병합·운영 DB·실 학생 데이터 없음). 7영역 read-only 구조 survey(에이전트 fan-out) + 정적/브라우저 확정.
> ⚠ 본 문서는 **조사·확정 + 승인 항목 분류**까지다. 제품 정책 변경·재현 미완 수정은 **승인/재현 후** 별도 진행(프롬프트 규칙).

## 0. 조사 범위
viewer-edit.js · viewer-render.js · viewer-ai.js · viewer-data.js · ui.js · mobileTextBranch.js · firebase.js · v03-modes.css · viewer.css · maker.html · viewer.html.

## 1. 다듬기 상태 구조 (정본 데이터 → 저장 → 로드/정규화 → 렌더)
| 영역 | 정본 데이터 | 저장 | 로드/정규화(공유?) | maker↔viewer |
|---|---|---|---|---|
| 원본 본문 | `scenes/{num}.body` | firebase.js `_flushPushToFirebaseNow`(.update child) | `adaptScenes`(id=String(num)) | 동일 `_getDisplayBody` |
| AI 1/2단계 | `aiVariants/text/{sceneId}/{s1\|s2}` (+localStorage 백업) | viewer-ai `_saveVariant{Body,Layout,Style}Patch`→`saveTextVariant` callable(600ms debounce·낙관버퍼) | `_loadFirebaseTextVariants`(메모리캐시) | viewMode별 `_getDisplay{Body,Layout,Style}` |
| 말풍선/글상자 | scene `picturebookSubmode`,`pbCardTone`; choice `viewer-meta.presentation.{sid_cid}` | `saveSceneText`(.update allowlist)·`saveViewerMeta`(deep-path) | `loadTeamData`+`applyPresentationData` | `_renderScenePicturebook` 인라인 위치 |
| 글씨체/크기/색 | scene `textStyle`(+override marker)·작품 `viewer-meta.textDefaults` | `saveSceneText`/`saveProjectTextDefaults`(.update) | `getTextStyle`(작품기본+sparse override, 공유) | `_patchTextStyle`/`_patchPbStyle` post-render |
| 테마 | scene `textTheme`·작품 default | 동일 saveSceneText/Defaults | `getTextTheme`(공유) | `data-text-theme` + CSS 변수 |
| 새 브랜치/복사/BASE10 | scenes child(num key) | addScene·copyScene·redeemCopyCode·`_writeBase10IfEmpty` | adaptScenes | 동일 |

핵심: maker/viewer는 **같은 정규화(getTextStyle/getTextTheme/_getDisplay*)**를 공유 — 구조적으로는 일치 설계.

## 2. 확정된 버그/이슈 (정적·코드 레벨)
### F-1 [P1·확정] 그림책 폰트 피커가 미로드 폰트 8종을 제공
- 로드 폰트(maker/viewer 동일 Google Fonts URL + galmuri) = **10종**: gothic, batang, pen, gaegu, hanna, jua, galmuri, cormorant, hahmlet, diphylleia → `VALID_TEXT_FONTS`(viewer-data.js:1109)와 정확히 일치.
- **그림책 피커**(viewer-edit.js:3339 `FONTS`)는 **18종** 제공: 위 10 + 미로드 8종(**notosans, dodum, notoserif, stylish, dohyeon, himelody, yeonsung, dokdo**).
- 텍스트모드 피커는 10종(정상). 그림책 피커만 구버전(T-THEME-1 이전) 잔존.
- 결과: 그림책에서 8종 중 하나 선택 → 미로드 → 시스템 fallback(기기마다 다름) → **"글씨체가 라벨과 안 맞음"**(사용자 보고와 일치).
- 코드 의도(viewer-data.js:1106 주석): "피커 선택 가능 = TEXT_FONT_FAMILIES 매핑 + viewer/maker 로드 + VALID_TEXT_FONTS 등록 3조건" → 8종은 조건 미충족(레거시 보존용, 신규 선택 대상 아님).
- ⚠ **승인 항목**: "글씨체 목록 삭제"는 사용자 판단 사항. → 3. 승인 항목 A.

### F-2 [P2·정보] '주아(Jua)' 특정 글자 fallback
- maker/viewer **동일 로드**(불일치 아님). `family=Jua`(weight 미지정 → 400만). 브라우저 canvas glyph 검출은 이 환경에서 부정확(CJK·웹폰트 지연·시스템폰트 혼입)이라 자동 확정 실패.
- 가설: Jua(Google Fonts) glyph 커버리지에서 '쫒'(U+CBD2)/'쫓'(U+CBD3) 등 일부 음절 누락 → fallback. **실기기/공식 coverage 데이터로 확정 필요**. 폰트 파일 교체·추가 금지(프롬프트) → 해결은 일관 fallback stack 또는 안내(승인 항목 A 동반).

### T-1 [P1·코드확정] 그림책 폰트 매핑 vs allowlist 불일치
- `TEXT_FONT_FAMILIES`(viewer-edit.js:457, 18 매핑) ⊃ `VALID_TEXT_FONTS`(viewer-data.js, 10). F-1과 동일 근원. (functions/index.js `VARIANT_TEXT_FONTS`도 교차 점검 대상.)

## 3. 승인 필요(제품 정책) — 코드 수정 전 사용자 결정
- **A. 그림책 폰트 피커 정렬**: 권장 = 텍스트모드처럼 **10종(VALID_TEXT_FONTS)으로 정렬**(레거시 8종은 기존 저장값 렌더 호환 유지, 신규 선택만 제거). 대안 = 8종을 실제 로드(Google Fonts 공식 URL 추가·family명 검증 필요). → F-1/F-2 동시 해소.
- **B. 말풍선/글상자·글자 스타일의 variant(original/s1/s2)별 독립 정책**: 현재 `_getDisplayLayout/Style`는 **variant별 독립**(없으면 원본 fallback). AI 단계 전환 시 말풍선/스타일이 "달라 보이는" 체감의 주원인. 작품/장면 공통으로 통일할지 = 정책 결정.
- **C. 테마 변경 시 글자 크기 처리**: 테마 reset(viewer-edit.js:6003)이 `textTheme`만 지우고 `fontSize` 유지 → 테마 바꿔도 크기 유지. 의도(크기 보존)인지 테마 기본 복귀인지 = 크기 정책 결정.

## 4. 재현 필요(풀앱 E2E·blind 수정 금지) — 후속 보정 대상
프롬프트 규칙상 재현 전 코드 변경 안 함. 다음은 maker+viewer+emulator+fixture(scenes/variants)로 재현 후 최소 수정 권장:
- **N-1 [P1] 삭제 장면의 aiVariants orphan**: `removeSceneFromFirebase`(firebase.js:964)가 `scenes/{num}`만 제거, `aiVariants/text/{sceneId}` 미제거 → 같은 num 새 장면 생성 시 stale variant 오염 가능. (데이터 정합 버그·정책 아님 → 재현 후 수정 적합)
- **N-2 [P2] copyScene key 정규화**: `redeemCopyCode`(firebase.js:1160) src→dst 복사 시 key(string/numeric) 정규화 없음·aiVariants 별도 노드 → sceneId 불일치 가능.
- **AI-1 [P1] viewMode 전환 시 contenteditable/drag 핸들 DOM 재생성**: 편집 중 전환 시 포커스/리스너 stale(데이터는 버퍼 보존, UX 거슬림).
- **AI-2 [P2] FB variant 메모리 캐시 stale**: 타 탭/기기 저장 반영 안 됨(1회 preload).

## 5. 안전 원칙 준수
- 원본 repo 무수정: local main `db06e60`·origin/main `b71d5fc`·PB-MOOD 5파일 cmp `e95ac358…` 보존.
- 배포·main 병합·운영 DB write·실 Anthropic·AI 이미지 호출 없음.
- 본 루프 산출물 = 이 문서(조사 결과) + (안전·재현 확정 시) 최소 수정. blind 수정·제품 정책 변경 없음.

## 6. 다음 단계 제안
1. 사용자 승인: 3-A(폰트 피커 10종 정렬) → 즉시 적용 가능한 최우선 사용자 체감 버그.
2. 3-B/3-C 정책 결정.
3. 4의 N-1/AI-1 등 풀앱 emulator E2E 재현 → 최소 수정 → 회귀.
