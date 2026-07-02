# TEXT-S2-PUBLISH-CHOICE-REMOVAL-AUDIT — 감상 글 정하기 폐기 및 감상 토글 구조 재설계 감사

- 일자: 2026-07-02
- 기준: origin/main `d98a799` (REFINE-STABILIZE-BUNDLE-1 종료 직후)
- 성격: read-only 감사/설계. 코드 수정 0 · DB write 0 · AI 호출 0 · Functions/Rules deploy 0
- 최종 판정: **TEXT_S2_PUBLISH_CHOICE_REMOVAL_READY** (인쇄 기준은 원본 권장안 포함, 아래 §5-8)

---

## 1. 왜 `감상 글 정하기`가 제품 취지와 맞지 않는가

### 제품 취지 위반
작품마무리 1·2단계에서 학생은 AI 질문·검사 결과를 보고 **직접** 고친다. 그런데 3단계에서
AI 장면발전(s2)을 만든 뒤 `감상 글 정하기`로 s2를 감상본으로 확정하면, **학생이 직접 고친
글을 AI 글이 최종 대체**하는 흐름이 된다. AI 장면발전은 최종본을 대신하는 기능이 아니라
원본과 **비교해 보는 참고/후보**여야 한다.

### 코드로 실증된 구조적 모순 (이번 감사에서 확인)
감상(비편집) 세션의 body 해석은 이중 레이어다:

```
scene.body(원본)
  → getPublishedBodyDisplay()   ← textSelections 발행 선택 반영 (레이어 1)
    → _pubBody
      → viewerAi._getDisplayBody(sceneId, _pubBody)  ← 글 보기 토글 (레이어 2)
        → 최종 body
```

- viewer-render.js:505 `const body = window.viewerAi._getDisplayBody(scene.id, _pubBody)`
- 결과: **textSelections='s2'로 확정된 장면은, 감상자가 토글을 '원본'에 둬도 s2가 보인다.**
  `_getDisplayBody`는 mode='original'일 때 인자로 받은 `_pubBody`(=이미 s2로 치환된 글)를
  그대로 반환하기 때문 (viewer-ai.js:2530-2532).
- 즉 확정 구조는 토글의 '원본' 라벨 의미 자체를 깨뜨린다. 두 제도는 공존할 수 없고,
  제품 취지상 남길 것은 토글이다.

### 새 원칙
1. 감상 확정 저장(발행 선택) 제도 폐기 — `감상 글 정하기` 모달/버튼 제거.
2. 모든 감상 화면(다듬기 미리보기·감상 테스트·공개 감상)은 `글 보기: 원본/AI 장면발전`
   **토글 비교**로 통일. 선택은 저장되지 않는다(localStorage 보기 상태만).
3. 원본 `scene.body`/`imageData`/`imageUrl` 절대 불변 (기존과 동일).
4. `aiVariants/textSelections` 기존 데이터는 삭제하지 않되, 신규 렌더에서 읽지 않는다.
5. 그림도 같은 철학(`그림 보기: 원본/AI 그림책 마감`) — 단 생성(callImageAiS2)은
   teacher-only 유지. 이미지 적용 시점은 별도 결정(§7 D안 참고).

---

## 2. textSelections 현재 사용처 (전수)

### 쓰기 (클라 1곳 + 서버 1곳)
| 구분 | 위치 | 내용 |
|---|---|---|
| 진입 버튼 | viewer-ai.js:2571-2578 | 토글 바 내 `감상 글 정하기` 버튼. `hasS2 && isEditViewerSession()` — **편집 세션만 노출** |
| 모달 | viewer-ai.js:2643 `_showTextS2SelectionModal()` | s2 있는 장면 목록 + 장면별 [원본/AI 장면발전] 선택. 헬퍼 `_textSelScenesWithS2`(2623)·`_textSelClip`(2638) |
| 버튼 핸들러 | viewer-ai.js:2687 `_applyTextSelection()` | `.js-textsel-orig`(2663)·`.js-textsel-s2`(2664) → 검증 후 서버 호출 |
| 클라 호출 | viewer-ai.js:2699 | `_callPhaseAFunction('callApplyTextS2Selection', {...})` — **클라 호출 이 1곳뿐** |
| 서버 write | functions/index.js:2494-2533 `callApplyTextS2Selection` | `aiVariants/textSelections/{sid}` 선택 노드만 Admin write. 원본 미접촉 |

### 읽기 (5계열)
| 구분 | 위치 | 내용 |
|---|---|---|
| 초기 로드 | viewer-data.js:198 | `loadTeamData()`에서 `aiVariants/textSelections` 1회 read |
| 캐시 | viewer-data.js:1805-1821 `_setPublishedTextCaches()` | `_pubTextSelBySid` 적재 |
| 발행 헬퍼 | viewer-data.js:1828-1840 `getPublishedBodyDisplay()` | selected==='s2' && s2 usable(!stale·body 있음)일 때만 s2.body, 그 외 원본. 내부 `resolveSceneBodySource()`(1784) |
| 렌더 8지점 | viewer-render.js:503, 654, 914, 1015, 1359, 1556, 1867, 2002 | `_pubBody = editMode ? _orig : getPublishedBodyDisplay(scene,_orig)` — C-1 패턴 8곳 동일 (텍스트카드/그림책/무비/체험/textBox/엔딩3종) |
| 인쇄 | picturebook-print.js:78-87 `_publishedBody()` | `getPublishedBodyDisplay` 경유 — 인쇄본에 발행 선택 반영 |
| 모달 상태표시 | viewer-ai.js:2651-2652 | `getPublishedTextSelectionForScene()` — 현재 선택 표시용 |

### 이미지 평행 구조 (참고)
- 캐시 `_pubImageSelBySid`/`_pubImageS2BySid`(viewer-data.js:158-159), 로드(195),
  헬퍼 `getPublishedImageDisplaySrc()`(1699), 렌더 3지점(viewer-render.js:412, 590, 1584),
  인쇄 `_publishedImage()`(picturebook-print.js:88-96), 서버 `callApplyImageS2Selection`(functions/index.js:2445).
- 이미지 쪽은 **선택 모달 UI가 없다**(교사 배치 플로우가 서버 적용). 텍스트 모달만 제거 대상.

---

## 3. 글 보기 토글 현황 (재설계의 기반)

- 토글 바: viewer-ai.js:2548 `_showAiToggleBar()` — **감상자/편집자 공통 표시**(Phase 4-A 주석
  명시, 코드 확인). s2 finalized 없으면 바 자체 미표시(2554), AI 버튼도 미렌더(2570).
  → "감상 화면에 토글이 없다"는 전제는 틀림. **토글은 이미 공개 감상에 라이브다.**
- 상태 저장: localStorage `pb_ai_view_mode_v140__{classId}__{teamName}` — DB 아님,
  기기·팀별 보기 상태. `_getAiViewMode()`(2337) fallback 'original'.
- body 반영: `_getDisplayBody()`(viewer-ai.js:2530) — mode='aiS2'면 Firebase 캐시
  variant body(→`_brToNewline` 정규화), 없으면 localStorage fallback, 그 외 원본.
- 이미지 토글: `_showAiImageToggleBar()`(2755) + `_getDisplayImageSrc()`(1466) — 동일 패턴,
  키 `pb_ai_image_view_mode_v140__...`.
- movie/experience 작품엔 토글 바 미표시(`_aiToggleProjectTypeAllowed`).

## 4. 화면별 원본/AI body·layout 기준표

지금(AS-IS) → 폐기 후(TO-BE). 레이아웃 저장 필드: 그림책 `scene.picturebookBodyBox`
{x,y,width,height,backdropOpacity}(%·height null=자동), 텍스트 `scene.textBox`{x,y,width,height}(%·중앙 기준).
AI variant 전용 레이아웃: `aiVariants/text/{sid}/s1|s2/layout/picturebookBodyBox`(원본과 분리 저장).

| 화면 | AS-IS body | TO-BE body | layout |
|---|---|---|---|
| 1. 장면 편집 | 원본 고정(editMode→`_orig`) | 변화 없음 | 원본 textBox/pbBodyBox. 저장=scene.* |
| 2. 다듬기 · 토글 원본 | 원본(editMode) | 변화 없음 | 원본 layout |
| 3. 다듬기 · 토글 AI | s2 (`_getDisplayBody`) | 변화 없음 | variant layout 있으면 그것(`_getDisplayPbBodyBox` viewer-ai.js:1321·opacity는 원본 따름=REFINE-STAB-B), 없으면 원본. 원본 저장값 불변 |
| 4. 감상 테스트 · 원본 | ⚠️ textSelections='s2'면 **s2가 보임** | **항상 원본** | 원본 layout |
| 5. 감상 테스트 · AI | s2 | s2 (동일) | variant layout → 없으면 §6 렌더 보정 |
| 6. 공개 감상 · 원본 | ⚠️ 4와 동일 모순 | **항상 원본** | 원본 layout |
| 7. 공개 감상 · AI | s2 | s2 (동일) | 5와 동일 |
| 8. 그림책 인쇄 | textSelections 반영(`_publishedBody`) | **원본 (권장 A안)** | 인쇄 자체 레이아웃 (§5-8) |

※ 감상 테스트 = 편집 세션 URL이지만 미리보기 중 `ViewerState.editMode=false`
(viewer-render.js:2321/2424 토글) — 발행 선택이 적용되던 모드. TO-BE에서 4·6번의 모순이 해소된다.

### 인쇄(8번) 정책 3안
- **A안(권장): 원본 기준만 출력.** 인쇄물=학생 작품의 정본. AI 글은 참고/후보라는 새 원칙과
  일치하고, 구현도 `_publishedBody`→원본 fallback으로 자동 해결(추가 작업 0).
- B안: 현재 토글 상태 따라 출력 — 인쇄 시점의 localStorage 보기 상태가 결과물을 바꿔
  재현성이 없고, 교사 PC에서 인쇄한다는 운영 기준과 어긋남. 비권장.
- C안: 인쇄 전 [원본으로/AI로] 선택 — 유효하나 지금 결정할 필요 없음. 수요 확인 후 후속.

## 5. 말풍선/글상자 레이아웃 원칙

조사 결과(모두 렌더 전용 보정 가능한 구조):
1. 저장: 위 §4 필드. 편집 드래그/리사이즈 → `_queueSave`(viewer-edit.js:1884-1886).
   variant 보기 중 편집은 **별도 큐** `_queueVariantLayoutSave`(viewer-ai.js:2007) → variant layout에만 저장. 원본 불변 구조 이미 확립.
2. 긴 글 동작: 그림책 오버레이 `overflow:auto`(v03-modes.css:416-429) — height=null이면
   콘텐츠 자동 높이, 명시 height면 내부 스크롤. **잘림은 없음.**
   텍스트 모드 카드는 `flex:1+overflow-y:auto`(183-205) — variant layout 개념 자체가 없어 토글 안전.
3. AI 토글 시 원칙(TO-BE):
   - variant layout 저장돼 있으면 그것(현행 유지·opacity만 원본 따름).
   - variant layout 없고 원본 height가 **명시 숫자**인 경우: AI 글이 길면 내부 스크롤이 생김.
     → **렌더 전용 보정**: variant 보기일 때 height inline style 생략(자동 확장)
     — viewer-render.js:733-740 `heightStyle` 생성부 한 곳. 저장값 무변경.
   - 내부 스크롤보다 말풍선 확장 우선(감상용). 부모 `.pb-stage`가 overflow:hidden이라
     화면 밖 넘침은 자연 제약됨.

## 6. Functions / Rules 영향

- **client-only로 구현 가능. Functions/Rules deploy 불필요.**
- `callApplyTextS2Selection`: 신규 UI에서 호출하지 않으면 dormant. 삭제/롤백하지 않는다
  (배포 이력 유지·후일 정리 가능). REFINE-STAB-A의 active member 완화도 남겨도 안전 —
  이 함수의 write는 `aiVariants/textSelections/{sid}` 선택 노드뿐이고, 신규 렌더가 그 노드를
  읽지 않으면 실효가 없다.
- `callApplyImageS2Selection`·`callImageAiS2`(teacher-only): 영향 없음. 이미지 발행 선택은
  imageS2 배치 플로우가 실사용 중이므로 이번 트랙에서 건드리지 않는다(§7 D안).
- Rules: `aiVariants`는 `.read:true / .write:false`(database.rules.json:103-106) — 변경 불필요.
- 기존 textSelections 데이터: DB에 그대로 둔다(삭제 금지 원칙). 렌더가 읽지 않으므로 무해.

## 7. 구현안 A/B/C/D 비교

### A안 — 감상 글 정하기만 제거, 토글 유지 (최소)
- 수정: viewer-ai.js(버튼 2571-2578·모달/핸들러 2623-2722 제거), 캐시버스터.
- 한계: `getPublishedBodyDisplay` 읽기 레이어가 남아 **기존에 확정된 팀은 §1 모순이 계속**됨
  (토글 '원본'인데 s2 표시). 신규 확정만 막고 기존 확정은 방치 → 불충분.
- 위험 낮음 / 비추천(단독으로는 취지 미달).

### B안 — A + 발행 레이어 무력화 (추천 ★)
- A안 + `getPublishedBodyDisplay()`가 **항상 originalBody를 반환**하도록 무력화
  (viewer-data.js 1828-1840, 함수 시그니처 유지).
- 효과: 렌더 8지점·picturebook-print `_publishedBody`·모달 전부 한 곳 수정으로 원본 기준 통일.
  8지점 diff 0 → 회귀 면적 최소. 토글 의미 복원. 인쇄=원본(§4 A안) 자동 충족.
- 토글 바는 이미 감상 공통 노출이라 신규 UI 작업 거의 없음. 라벨/도움말 문구 정리만.
- 부수 작업: `loadTeamData`의 textSelections read·캐시는 남겨도 무해하나 정리 가능(선택).
  tests/write-after/text-s2-select-resolver.test.js(~20케이스) — 무력화 스펙으로 재작성 필요.
- 수정 파일: viewer-ai.js·viewer-data.js·(테스트)·viewer.html 버스터. **viewer-render.js 0·print 0.**
- 위험: 낮음. Functions/Rules/DB 무변경.

### C안 — 인쇄 토글 연동 (후속 후보)
- 인쇄 전 [원본으로 인쇄/AI 장면발전으로 인쇄] 선택 or 토글 추종.
- 지금은 B안의 "인쇄=원본"으로 충분. 수업에서 AI본 인쇄 수요가 실제로 나오면 그때
  선택 다이얼로그 방식(재현성 있음)으로 후속. 범위 크지 않으나 지금 불요.

### D안 — 기존 textSelections legacy 읽기 유지
- 기존 확정 데이터는 계속 감상에 반영하고 신규 UI만 숨김.
- §1의 토글 모순이 영구 잔존 + 이중 레이어 유지로 구조 복잡. **비권장.**
- 단, **이미지 쪽은 당분간 사실상 D안 상태로 둔다**(imageSelections 읽기 유지) —
  imageS2 교사 배치 플로우가 라이브 검증된 상태라, 텍스트 안착 후 같은 철학으로
  전환할지 별도 결정(그때 `getPublishedImageDisplaySrc` 동일 무력화 패턴 적용 가능).

### 추천 및 구현 순서
**B안.** 순서:
1. `getPublishedBodyDisplay` 무력화(원본 고정) + 관련 테스트 재작성
2. `감상 글 정하기` 버튼/모달/핸들러/클라 호출 제거 (viewer-ai.js)
3. AI 토글 레이아웃 렌더 보정 — variant 보기 시 명시 height 생략(viewer-render.js:733-740) *(선택·같은 PR 가능)*
4. 문구 정리(토글 title 등) + 캐시버스터 + node --check + 기존 테스트 스위트(237) 통과
5. 합성 스모크: 감상 세션에서 textSelections='s2' mock 주입 → 토글 '원본'=원본 표시 확인

## 8. 위험도

| 항목 | 평가 |
|---|---|
| 원본 데이터 | 위험 0 — 읽기 경로만 변경, scene.* write 없음 |
| 기존 확정 팀 | 감상 표시가 s2→원본으로 바뀜. **이것이 의도된 제품 변경**(토글로 AI본 열람 가능) |
| 인쇄 | 발행 반영→원본 고정. PICTUREBOOK-PRINT-1 테스트 일부 기대값 확인 필요 |
| 이미지 파이프라인 | 무변경 (별도 트랙) |
| Functions/Rules | 무변경·dormant 유지 |
| 테스트 | text-s2-select-resolver.test.js 재작성 필요(폐기 스펙으로) |

## 9. 다음 구현 명령 제안

`TEXT-S2-PUBLISH-CHOICE-REMOVAL-1` — B안 구현 (client-only):
- viewer-data.js `getPublishedBodyDisplay` 원본 고정 무력화(주석에 본 문서 참조)
- viewer-ai.js 감상 글 정하기 버튼/모달/핸들러/`_applyTextSelection` 제거
- (선택) variant 보기 height 렌더 보정
- 테스트 재작성 + 전체 스위트 + 합성 스모크 → 보고 → commit/push → 배포 승인 별도

금지 유지: textSelections 데이터 삭제 금지·Functions/Rules deploy 금지·이미지 쪽 무변경.

---

## 판정: TEXT_S2_PUBLISH_CHOICE_REMOVAL_READY

정책 결정 1건(인쇄 기준)은 A안(원본만)을 권장안으로 제시 — B안 구현 시 자동 충족되므로
별도 블로커 아님. 구현은 client-only·저위험으로 즉시 착수 가능.
