# 가지(branch) v130 — 프로젝트 상태 문서

> **목적**: v130 시점의 안정화된 기능, 핵심 코드 위치, 데이터 구조, 미구현 항목을 정리한 마감 점검 문서. 앞으로 작업할 때 기준점으로 사용.
>
> **작성**: 2026-05-18
> **기준 커밋**: `8eca045` (v130 루트보기 인라인 수정)
> **현재 main**: `c43fa19` (AI 설계 문서 v2 — 코드 변경 없음)

---

## 0. 한 줄 요약

가지(branch)는 **초등학생용 분기형 인터랙티브 스토리 제작·감상 플랫폼**. v130 시점에 그림책형은 거의 완성 단계이고, 모바일 텍스트형도 안정화됐다. AI 기능은 설계만 완료(`ai-feature-integration-plan.md` v2), 코드는 아직 구현하지 않았다.

---

## 1. 프로젝트 기본 정보

| 항목 | 값 |
|---|---|
| 작업 폴더 | `/Users/dobuk/Downloads/picturebook-repo/` |
| GitHub | `chang333787-boop/picturebook` |
| 배포 URL | https://chang333787-boop.github.io/picturebook |
| 배포 방식 | GitHub Pages 자동 (push 후 1~2분) |
| Firebase 프로젝트 | `picturebook-8731f` |
| Firebase 룰 배포 | `firebase deploy --only database` |
| 결제 플랜 | Blaze (사용량 기반) |
| 운영자 | chang333787@gmail.com |

### 1-1. 작품 유형 (projectType)

| 유형 | 상태 |
|---|---|
| `picturebook` (그림책형) | ✅ 거의 완성 (v130 시점) |
| `text` (텍스트형) | ✅ 모바일 1차 마감 (v112) — PC도 동작 |
| `movie` (무비형) | ✅ 영상 업로드(Storage, 50MB) + 포스터 + 자막 모드 + 본문 ON/OFF 동작 — 학생 작품 검증은 부족 |
| `experience` (체험전시형) | ⚠ connectObjects 모델 동작 / 루트보기 분기 인식 X (의도) / 학생 작품 검증 부족 |

---

## 2. v130 시점 안정화된 기능 목록

### 2-1. 그림책형 핵심 기능

| 기능 | 도입 버전 | 상태 |
|---|---|---|
| 표지 + 일반 장면 + 엔딩 분기 구조 | ~v70 | ✅ |
| 분할형(split) / 그림 중심형(imageCenter) 하위 모드 | ~v100 | ✅ |
| 진엔딩(trueEnding) | ~v70 | ✅ |
| 표지 한 줄 소개(subtitle) | v37 | ✅ |
| 표지 색 테마 / 제목 높낮이 | v37, v85 | ✅ |
| 표지 상단 문구(kicker) | **v129** | ✅ — teamName 자동 표시 폐기 |
| 본문 줄바꿈 보존 (`\n\n`) | **v127** | ✅ |
| 본문 시작 delay 2초 clamp | **v127** | ✅ |
| 행동버튼 등장 전 클릭 차단 | **v127** | ✅ |
| 페이지 방향 (portrait / landscape) | v37 | ✅ |
| 텍스트 등장 효과 6종 + 속도 슬라이더 | v71~v73 | ✅ |
| 장면 전환 효과 5종 + 속도 슬라이더 | v64, v73 | ✅ |
| 장면 전환 속도 piecewise 300~3500ms | **v129** | ✅ |
| 감상 테스트 전환속도 반영 fix | **v128** | ✅ |
| 글자 스타일 (폰트/크기/색/굵기) — 장면별 + 전체 적용 | v75~v76 | ✅ |
| 엔딩 분할형 고정 | **v125** | ✅ |
| 엔딩 글자 스타일 default | v77 | ✅ |
| 행동버튼 + 엔딩 버튼 밸런스 | v85~v89 | ✅ |
| 다듬기 양방향 동기 (왼쪽 ↔ 오른쪽) | **v122c** | ✅ |
| 다듬기 화면 루트보기 | **v123** | ✅ |
| 루트보기 fade/scale 변화량 키움 | v124 | ✅ |
| 루트보기 인라인 수정 (본문 + 행동버튼 라벨) | **v130** | ✅ |

### 2-2. 잠금 (locks)

| 기능 | 도입 버전 | 상태 |
|---|---|---|
| Firebase 잠금 (locks/{num}) | ~v50 | ✅ |
| 다른 친구 잠금 시 읽기전용 | ~v60 | ✅ |
| 같은 기기 다른 탭 잠금 — 부드러운 문구 | **v125** | ✅ |
| "내가 수정하기" 실패 시 원인별 alert (오프라인/auth/일반) | **v125** | ✅ |
| 잠금 편집 전환 안정화 | v116 | ✅ |
| 잠금 긴급 fix (TTL 박은 거 박지 X) | v117 | ✅ |
| 잠금 readonly 상태에서 모든 수정 컨트롤 차단 | **v129** | ✅ |
| AI 적용도 잠금 상태에서만 가능 | (설계만, 미구현) | 📋 |

### 2-3. Firebase 운영

| 기능 | 도입 버전 | 상태 |
|---|---|---|
| Firebase 1단계 룰 (`auth != null`) | v89 | ✅ |
| 교사 자율 회원가입 + Google + 비밀번호 재설정 | v90 | ✅ |
| 교사 클래스 코드 자율 생성 (중복 검증) | v92 | ✅ |
| teachers/classCodes/teacherClasses 노드 | v90~v92 | ✅ |
| classId 기반 격리 (`classes/{classId}/teams/...`) | v89~v92 | ✅ |
| 표지 classId 노출 폐기 | v91 | ✅ |
| 신규 가입자 admin 진입 fix | v93 | ✅ |
| 관리 화면 UX (반 이름 + 코드 + 빈 상태 안내) | v94 | ✅ |
| isPublic 정책 (`fromMaker` 박은 거 박지 X 박은 거 차단) | ~v40 | ✅ |
| Storage 마이그 (만원 사건 후 base64 → Storage URL) | **v113, v115** | ✅ |
| _saveFlattenedImage Storage 경유 | **v122-fix** | ✅ |

### 2-4. 모바일 텍스트형

| 기능 | 도입 버전 | 상태 |
|---|---|---|
| 진입 흐름 + 빈 화면 + PC 토글 | v95 | ✅ |
| BFS 자동 배치 + 동그라미 노드 + SVG 연결선 | v96 | ✅ |
| 노드 탭 → 장면 편집 화면 (WYSIWYG) | v97 | ✅ |
| 길게 누르기 → 행동버튼 연결 흐름 | v98 | ✅ |
| 행동버튼 저장 (closure 박지 X 박은 거 fix) | v99 | ✅ |
| 핀치 줌 + pan + 글자 설정 토글 | v100 | ✅ |
| 감상 테스트 + 자동 fit | v102 | ✅ |
| 연속 제작 (첫 장면 자동 열림 + 새 장면 + 구조 라벨) | v103 | ✅ |
| 노드 배치 이동 (📍 + 드래그 + mtbX/mtbY) | v104 | ✅ |
| 본문 자동 focus / "+ 분기 추가" / fade transition | v105 | ✅ |
| 묶음 이동 (자손까지 BFS 드래그) | v106 | ✅ |
| 구조 화면 = 정리용 대시보드 (노드 배지 + 요약 바) | v107 | ✅ |
| 복귀·표지·조작감 마감 | v108~v112 | ✅ |
| Storage 마이그 적용 | v115 | ✅ |
| 모바일 표현 패널 | v115 | ✅ |

### 2-5. 태블릿 최적화

| 기능 | 도입 버전 | 상태 |
|---|---|---|
| 태블릿 zoom 성능 fix | v117 | ✅ |
| 태블릿 카드 드래그 / 연결선 렌더 최적화 | v119 | ✅ |
| pinch zoom 안정화 | v120-lite | ✅ |
| 태블릿 조작감 + 루트보기 본문 | v118 | ✅ |

### 2-6. 감상/다듬기 경량화

| 기능 | 도입 버전 | 상태 |
|---|---|---|
| preview throttle + typewriter fallback + img async | v121 | ✅ |
| 장면 본문 / 행동버튼 라벨 인라인 수정 (루트보기 안에서) | **v130** | ✅ |

### 2-7. AI 기능

| 기능 | 상태 |
|---|---|
| 설계 문서 v2 (`ai-feature-integration-plan.md`) | ✅ 작성 완료 |
| 텍스트 강도 1·2 정책 (체크리스트 방식) | ✅ 설계 |
| 이미지 강도 1·2 정책 (모델/파라미터) | ✅ 설계 |
| Phase 0 결정문 (14개 항목) | ⚠ 사용자 결정 대기 |
| 실제 API 호출 / Cloud Functions | ❌ 미구현 |
| Firebase 새 노드 (ai-suggestions/history/context) | ❌ 미구현 |
| UI 버튼 / Phase A 인프라 | ❌ 미구현 |

---

## 3. 핵심 코드 위치 (v130 시점)

### 3-1. 감상 / 다듬기

| 파일 | 역할 |
|---|---|
| `viewer.html` | 감상/다듬기 진입 — entry → player 화면 |
| `viewer-state.js` | ViewerState 전역 상태 |
| `viewer-entry.js` | URL 파라미터 처리 (team, edit, from, classId) → `_enterViewer` |
| `viewer-data.js` | Firebase 로드 / `adaptScenes` / `saveSceneText` / `saveViewerMeta` |
| `viewer-controls.js` | `navigateTo` / `chooseOption` / `restartStory` / 오디오 |
| `viewer-render.js` | `renderCurrentScene` / `renderCover` / `renderScene` / `renderTerminal` / `renderHUD` |
| `viewer-edit.js` | 다듬기 인스펙터 + `_applyEditLockUI` + `_queueSave` + `_patchSceneBody` |
| `viewer-image-edit.js` | 이미지 편집 (drag/resize/이미지 변경) |
| `viewer-locks.js` | `viewerEnsureEditable` / `viewerForceTakeoverLock` / `viewerReleaseLock` |
| `viewer.css` | 감상/다듬기 스타일 (`#viewer-frame.edit-mode-on`, `body.edit-mode-active`, `body.viewer-edit-readonly`, `body.viewer-test-active`) |
| `v03-modes.css` | 그림책형 본문 / 표지 / 텍스트형 / 무비형 / 체험전시형 CSS |
| `storyAnalyzer.js` | `findAllRoutes` / 루트보기 렌더 / v130 인라인 수정 |

### 3-2. 브랜치 화면 (maker)

| 파일 | 역할 |
|---|---|
| `maker.html` | 브랜치 캔버스 + 인스펙터 |
| `state.js` | maker 전역 상태 |
| `ui.js` | maker UI 핸들러 |
| `canvasInteraction.js` | 카드 드래그/연결선 |
| `sceneRenderer.js` | 카드 렌더 |
| `mediaManager.js` | 이미지 업로드 / Storage |
| `projectSettings.js` | 작품 단위 설정 (모드/페이지 방향/효과/표지) |
| `mobileTextBranch.js` | 모바일 텍스트형 전용 UI |
| `preview.js` | 카드 미리보기 |
| `locks.js` | maker 측 잠금 |

### 3-3. 운영 / 인프라

| 파일 | 역할 |
|---|---|
| `index.html` | 학생 진입 (클래스 코드 + 팀명) |
| `branch.html` | 작품 분기 정리 화면 (구) |
| `teacher-auth.html` | 교사 회원가입/로그인 |
| `adminConsole.js` | 관리 화면 (반 이름 / 코드 / 학생 작품 목록) |
| `firebase.js` | Firebase 초기화 + 인증 + `_resolveRole` |
| `database.rules.json` | RTDB 룰 |
| `firebase.json` | Firebase CLI 배포 설정 |
| `manifest.json` | PWA 매니페스트 |

### 3-4. 모형 / 토큰

| 파일 | 역할 |
|---|---|
| `tokens-warm.css` | 디자인 토큰 |
| `home.css` / `warm-branch.css` / `warm-screens.css` | 따뜻한 톤 베이스 스타일 |
| `mockup-*.html` | 디자인 시안 (실제 사용 X) |

---

## 4. Firebase 데이터 구조 (v130 시점)

### 4-1. 운영 노드

```
classes/{classId}/
├─ meta/
│   ├─ classId, teacher_uid, teacher_email
│   ├─ code, name
│   ├─ isPublic (v40)
│   ├─ createdAt
│   └─ pageOrientation, pbTheme
├─ teams/{encodedTeamName}/
│   ├─ pin
│   ├─ scenes/{num}/
│   │   ├─ title, body, type
│   │   ├─ buttons[], choiceA/B, choiceCount, nextA/B
│   │   ├─ isStart, isEnding, trueEnding
│   │   ├─ subtitle, kicker (cover only, v129)
│   │   ├─ coverTheme, titleVerticalPosition
│   │   ├─ imageData (Storage URL — v113 이후)
│   │   ├─ textStyle, textTheme, textEffect (text 모드)
│   │   ├─ presentationMode, presentationSubmode, picturebookSubmode
│   │   ├─ picturebookBodyBox (그림 중심형)
│   │   ├─ connectObjects (체험전시형)
│   │   ├─ movieData, bodyEnabled (무비형)
│   │   ├─ x, y (canvas 좌표)
│   │   ├─ mtbX, mtbY (v104 — 모바일 텍스트형 배치)
│   │   └─ layoutTemplate
│   ├─ viewer-meta/
│   │   ├─ entrySceneId, replaySceneId
│   │   ├─ coverTitle, coverImageData (legacy)
│   │   ├─ sceneTransition, sceneTransitionSpeed
│   │   ├─ textEntrance, textEntranceSpeed
│   │   ├─ pageOrientation, pbTheme
│   │   ├─ projectType, mode, template, theme
│   │   ├─ isPublic
│   │   └─ presentation/{scene_choice}/{stylePreset, placement, opacity, ...}
│   └─ locks/{num}/
│       ├─ uid, ts, deviceId
│       └─ (TTL 박힌 거 — viewer-locks.js)
└─ (기타)

teachers/{uid} = { email, createdAt } (v90)
classCodes/{code} = classId (v92, 학생 진입용)
teacherClasses/{uid} = classId (v92, 교사 조회용)
copyCodes/{code} (v41, 작품 복사)
```

### 4-2. Storage 경로 (v113 이후)

```
images/classes/{classId}/teams/{teamName}/scene_{num}.{jpg,png}
```

base64 RTDB 저장 금지 — 큰 데이터는 모두 Storage URL.

### 4-3. AI 관련 노드 — 설계 후보 (미구현)

```
classes/{classId}/teams/{teamName}/
├─ ai-suggestions/{suggestionId}/  ← 설계만, 만들지 않음
├─ ai-history/{sceneId}/{historyId}/  ← 설계만
└─ ai-context/  ← 설계만
```

---

## 5. 정책 / 정합성 기준 (코드 작업 시 반드시 따라야 할 것)

### 5-1. 본문 줄바꿈 (v127)

- `scene.body` 저장 시 절대 trim 하지 않음
- `\n\n` 학생 의도된 호흡으로 유지
- CSS: `white-space: pre-wrap`
- `viewer-render.js` 6곳 `body || ''` (trim 박지 X)
- `viewer-edit.js _extractEditableText` `.replace(/^\n/, '')` 박지 X

### 5-2. buttons + choiceA/B 호환

- viewer-data.js `saveSceneText` ALLOWED에 두 필드 모두 박혀있음
- 라벨 수정 시 buttons[idx].label + choiceA(idx=0) + choiceB(idx=1) 동시 갱신
- maker UI 호환 (choiceA/B만 박는 옛 코드와 호환)

### 5-3. 잠금 (v129)

- `_editText.editable=false`면 모든 수정 컨트롤 차단
- body class `viewer-edit-readonly` 박힌 거 CSS로 인스펙터/contenteditable/이미지 핸들/HUD 저장 일괄 차단
- 예외: 잠금 배너 액션, nav, 탭, HUD 액션(감상 테스트/루트/구조/브랜치로)

### 5-4. 감상 테스트 (v128)

- `ViewerState._testingEdit = true` 박히면 body에 `viewer-test-active`
- CSS animation:none 룰에 `:not(.viewer-test-active)` 박혀 감상 테스트에서 효과 정상 재생
- `_sceneTransMs` piecewise: 0~50 = 300~1200ms / 50~100 = 1200~3500ms (v129)
- `--text-ent-start-delay = min(sceneMs, 2000)` 본문 시작 2초 clamp (v127)

### 5-5. 표지 (v129)

- `scene.kicker` — 사용자 박는 표지 상단 문구
- 비우면 `cover-kicker--empty` 박혀 visibility:hidden (layout 유지)
- 옛 `teamName` 자동 표시 폐기

### 5-6. 루트보기 인라인 수정 (v130)

- viewer-edit 환경 + `_editText.editable=true`일 때만 ✎ 버튼 표시
- maker에선 ✎ 박지 X (`_rtIsViewerEditable()=false`)
- 저장 라우터:
  - 현재 다듬기 장면 = `_queueSave` (debounce)
  - 다른 장면 = `saveSceneText` 직접 (blur/Enter 후만)
- 메모리 동기: `window.scenes` + `ViewerState.scenes` 둘 다
- 같은 sceneId 여러 등장 = `renderRoutePanel()` 통째 재렌더로 자동 동기

### 5-7. Storage 비용 보호 (v113)

- base64 절대 RTDB 박지 X
- 큰 이미지는 Storage 업로드 → URL만 RTDB
- AI 결과 이미지도 동일 (설계 단계 명시)

---

## 6. 미구현 / 박지 X 박은 항목 (의도적)

### 6-1. 의식적으로 박지 X 박은 것

| 항목 | 이유 |
|---|---|
| 엔딩 그림 중심형(`imageCenter`) | 칸 밀림 + 엔딩 표시 가려질 위험 (v125 결정) |
| 표지에 그림(이미지) | 표지 = 텍스트 중심 정책 (사용자 결정, v37) |
| 표지에 teamName 자동 표시 | v129에서 kicker로 대체 |
| 학생용 admin UI | 교사만 admin 접근 |
| 학생 회원가입 | 익명 — 클래스 코드 + 팀명만 |
| 다른 학생 작품 수정 | 잠금 시스템이 차단 |

### 6-2. 아직 구현 안 한 것 (다음 작업 후보)

| 항목 | 우선순위 | 비고 |
|---|---|---|
| **AI 기능 Phase A 인프라** | 1 | 설계 완료 (`ai-feature-integration-plan.md` v2), Phase 0 결정문 채우면 시작 |
| **엔딩 순차 등장 연출** | 2 | v127·v128·v129·v130에서 계속 미룬 거. terminal-body → badge → stats → hint → actions sequential CSS delay |
| **루트보기 제목 수정** (v130 확장) | 3 | `_rtScenePrefix` 옆 ✎ — 기존 v130 패턴 그대로 확장. 작은 작업 |
| **maker 루트보기 인라인** | 4 | window.scenes만 박힌 환경 — 저장 함수 다름. 별도 흐름 필요 |
| **루트보기 잠금 안내 배너** | 5 | "🔒 읽기전용" 표시 — v130에서 안내만 박지 X |
| **잠금 reason 객체화** | 6 | `viewerForceTakeoverLock` boolean → `{ok, reason}` |
| **importJSON base64 변환** | 7 | v122-fix에서 남은 거 — 옛 작품 import 시 base64 → Storage 변환 |
| **viewer-edit 부분 렌더** | 8 | v121 분석에서 박은 큰 작업 — 인스펙터 부분 갱신 |
| **루트보기 nextId 수정** | (위험) | 분기 연결 변경 = 매우 큰 위험. v130 정책상 박지 X |
| **모바일 텍스트형 readonly 룰** | 9 | v129 readonly 룰 = PC 그림책 한정. 모바일도 동일 필요 |
| **2단계 Firebase PIN 룰 강화** | 10 | 운영 보안 박을 거 |
| **다른 모드 검증** (무비형/체험전시형) | 11 | 골격만 박혀있고 검증 미흡 |

---

## 7. 다음 작업 후보 — 우선순위별 정리

### 7-1. 가장 큰 가치 (운영 임팩트 큼)

**A. AI 기능 Phase A — MVP 구현**
- 텍스트 강도 1만 + 비교 화면 + 자동 적용 X
- Cloud Functions + Anthropic API 인프라
- 1개 베타 클래스
- 조건: Phase 0 결정문 14개 항목 사용자 결정 완료
- 예상: 1~2주 작업
- 위험: 비용 모니터링 필수 (v113 만원 사건 재발 방지)

**B. 다른 모드 검증 (무비형 / 체험전시형)**
- 골격은 박혀있지만 실제 학생 작품으로 검증 미흡
- 무비형: bodyEnabled, movieData
- 체험전시형: connectObjects
- 예상: 각 모드 2~3일

### 7-2. 작은 보강 (안정화)

**C. 엔딩 순차 등장 연출 (v131 후보 1순위 — 사용자 명시 미룬 거)**
- terminal-body → badge → stats → hint → actions sequential CSS class delays
- viewer.css `.scene-screen--terminal` 클래스에 stagger
- 예상: 반나절

**D. 루트보기 제목 수정 (v130 패턴 확장)**
- `_rtScenePrefix` 옆 ✎ 버튼 — 이미 박힌 패턴 그대로
- 예상: 2~3시간

**E. maker 루트보기 인라인**
- maker 환경에서도 v130 인라인 수정 가능하게
- maker 저장 함수와 호환
- 예상: 1일

### 7-3. 운영 / 보안

**F. 2단계 Firebase PIN 룰 강화**
- 학생 진입 시 PIN 검증 강화
- 운영 노출 데이터 보호
- 예상: 1~2일

**G. importJSON base64 변환**
- v122-fix 잔여
- 옛 작품 import 시 자동 Storage 변환
- 예상: 반나절

### 7-4. 큰 작업 (점진적 진행)

**H. viewer-edit 부분 렌더 (v121 분석)**
- 인스펙터 통째 재렌더 → 부분 갱신
- 큰 리팩토링
- 예상: 1주+
- 위험: 회귀 가능성 큼 (다듬기 화면 전체 영향)

**I. 잠금 reason 객체화**
- `viewerForceTakeoverLock` 반환을 `{ok, reason}`으로
- 호출자 다 박아야
- 예상: 반나절

---

## 8. 권장 다음 단계 (Claude 판단)

### 8-1. 안정화 우선 시나리오

1. 엔딩 순차 등장 연출 (C) — 반나절
2. 루트보기 제목 수정 (D) — 2~3시간
3. 다른 모드 검증 (B) — 1주
4. 모바일 텍스트형 readonly 룰 (목록의 9번) — 반나절

→ 그림책형 마감 완성 + 다른 모드 안정화. AI는 아직 안 들어감.

### 8-2. AI 진출 시나리오

1. Phase 0 결정문 14개 항목 사용자 결정 — 사용자 시간
2. AI Phase A 인프라 (A) — 1~2주
3. 베타 클래스 테스트 + 안정화 — 2주
4. 텍스트 강도 2 (D Phase) — 1주

→ 가장 큰 가치. 비용 위험 동반.

### 8-3. Claude 권장

**안정화 우선**. 이유:
- 그림책형이 거의 마감 단계 — 작은 보강 마저 끝내는 게 운영 안정성 ↑
- AI 기능은 Phase 0 결정 + 베타 + 모니터링 등 따져야 할 게 많음
- 엔딩 순차 등장은 v127부터 4번 미룬 거 — 더 미루면 잊힘

순서: **C → D → 모바일 readonly → B 일부 (무비형 또는 체험전시형 중 하나) → AI Phase 0 결정문**.

---

## 9. 운영 흐름 (변경 없음)

| 흐름 | 방식 |
|---|---|
| 자동 commit/push | 큰 명 끝날 때마다 (사용자 정책) |
| 자동 zip | `/Users/dobuk/Downloads/picturebook-v{n}.zip` (이전 자동 삭제) |
| GitHub Pages 자동 배포 | push 후 1~2분 |
| Firebase CLI 배포 | `firebase deploy --only database` |
| 메모리 갱신 | 큰 명 단위 묶음 |

---

## 10. 메모리 색인 (참고)

이 프로젝트의 메모리는 `/Users/dobuk/.claude/projects/-Users-dobuk/memory/`에 있음.

핵심 메모리:
- `user_branch_project.md` — 사용자/프로젝트 기본
- `project_branch_v130.md` — v130 시점 (이 문서와 함께 봐야)
- `project_branch_ai_design.md` — AI 기능 설계 원본 + v2 정리
- `feedback_branch_*.md` — 작업 방식 / 자동 git / 박다 동사 금지 등
- v129/v128/v127/v125/... — 버전별 진행 상황

---

**문서 버전**: v131 작업 — 2026-05-18 작성
**다음 갱신**: 새 큰 명 마감 후
