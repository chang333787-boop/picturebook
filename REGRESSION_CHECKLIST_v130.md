# 가지(branch) v130 — 회귀 점검 체크리스트

> **목적**: 새 작업이 v130 시점 안정화된 기능을 깨뜨리지 않았는지 확인하기 위한 체크리스트. 큰 명 마감 시 또는 배포 전 사용.
>
> **작성**: 2026-05-18
> **기준**: v130 시점 안정화된 동작
>
> **사용법**:
> 1. 새 기능 박는 명 작업 후 이 문서 펴기
> 2. 작업 범위와 가까운 섹션 우선 확인 (예: 다듬기 작업이면 §3, §6 우선)
> 3. 체크박스 ✅/⚠/❌ 표시하며 진행
> 4. 한 가지라도 ❌면 fix 후 재점검

---

## 0. 작업 범위별 빠른 가이드

| 작업한 영역 | 우선 확인할 섹션 |
|---|---|
| 다듬기 인스펙터 | §3, §6, §7 |
| 감상 화면 | §3, §4, §6 |
| 루트보기 | §4, §6, §7 |
| 잠금 시스템 | §3, §6, §10 |
| Firebase 저장 | §6, §10 |
| 이미지 업로드 | §3, §6, §11 |
| 모바일 텍스트형 | §8 |
| 태블릿 최적화 | §9 |
| 표지 | §3, §5 |
| 엔딩 | §3, §5 |

---

## 1. 환경 준비

### 1-1. 브라우저
- [ ] Chrome 최신 (PC/Mac/iOS)
- [ ] Safari 최신 (iOS/Mac)
- [ ] Android Chrome
- [ ] 가능하면 한 가지 더 (Edge 또는 Firefox)

### 1-2. 디바이스
- [ ] PC (1920×1080 이상 권장)
- [ ] 태블릿 (iPad 또는 Android 10인치)
- [ ] 모바일 (iPhone 또는 Android 6인치)

### 1-3. 네트워크
- [ ] 정상 Wi-Fi
- [ ] 가능하면 4G 또는 느린 네트워크에서도 1회

### 1-4. 테스트 작품
- [ ] 그림책형 작품 1개 (장면 5+ 분기 + 엔딩 2+)
- [ ] 텍스트형 작품 1개 (모바일 확인용)
- [ ] 빈 작품 1개 (신규 생성 흐름)

---

## 2. 기본 진입 / 인증

### 2-1. 학생 진입 (`index.html`)
- [ ] 클래스 코드 + 팀명 입력 → 작품 로드
- [ ] 잘못된 코드 → 안내 메시지
- [ ] 잘못된 팀명 → 안내 메시지
- [ ] 비공개 작품 → "아직 공개되지 않은 작품" 안내

### 2-2. 교사 인증 (`teacher-auth.html`)
- [ ] 이메일/비밀번호 회원가입
- [ ] Google 로그인
- [ ] 비밀번호 재설정
- [ ] 약관 동의
- [ ] 신규 가입자 admin 진입 정상

### 2-3. 관리 화면 (`adminConsole.js`)
- [ ] 헤더에 반 이름 + 코드 표시
- [ ] 코드 복사 버튼 동작
- [ ] 학생 작품 목록 표시 (빈 상태 안내 포함)

---

## 3. 그림책형 핵심 회귀

### 3-1. 표지
- [ ] **표지 상단 문구(kicker) 입력**: 인스펙터에 박은 거 viewer에 즉시 반영
- [ ] **kicker 비우면 표시 안 됨** (옛 teamName 자동 표시 폐기)
- [ ] kicker 글자 수 maxlength=30 동작
- [ ] **subtitle (한 줄 소개)** 입력/저장
- [ ] **표지 색 테마** 변경 → 양 옆 letterbox 색 동기화
- [ ] **표지 제목 높낮이** 슬라이더 동작
- [ ] **그림 있는 표지 vs 그림 없는 표지** 두 모드 다 정상
- [ ] **새로고침 후 kicker/subtitle/coverTheme 유지**

### 3-2. 본문 줄바꿈 (v127)
- [ ] 본문 앞에 엔터 두 번 박은 후 저장 → `\n\n` 그대로 유지
- [ ] 다른 장면 갔다 돌아와도 빈 줄 유지
- [ ] 새로고침 후 빈 줄 유지
- [ ] 감상 화면에 빈 줄이 시각적으로 보임 (`white-space: pre-wrap`)
- [ ] 다듬기 ↔ 감상 토글해도 빈 줄 유지
- [ ] 엔딩 본문 빈 줄도 유지

### 3-3. 행동버튼
- [ ] 버튼 라벨 입력 → 즉시 반영
- [ ] 버튼 추가 / 삭제 (max 6개)
- [ ] 빈 라벨 허용 (편집 중 상태)
- [ ] 라벨 60자 제한
- [ ] **행동버튼 등장 전 클릭 차단** (v127): 페이드 끝나기 전엔 안 눌림
- [ ] 다듬기 모드에선 즉시 클릭 가능
- [ ] **버튼 라벨 + choiceA/B 동시 저장** (호환)

### 3-4. 장면 전환 효과 (v128, v129)
- [ ] **빠름 (0%) → 느림 (100%)** 슬라이더 차이 체감
  - 0%: 약 300ms
  - 50%: 약 1200ms
  - 100%: 약 3500ms
- [ ] 5가지 효과 (fade / book / scale / slide-up / flip3d) 모두 정상
- [ ] **감상 테스트에서도 속도 반영** (v128 fix) — readonly 룰이 감상 테스트에 적용되지 X
- [ ] **본문 시작 delay 2초 이내** (v127 clamp) — 전환 100%여도 본문은 2초 후 등장
- [ ] 표지 → 첫 장면 / 일반 → 다음 / 일반 → 엔딩 모두 정상

### 3-5. 텍스트 등장 효과
- [ ] 6가지 효과 (none/fade/slide-up/blur-in/pop/typewriter) 정상
- [ ] 속도 슬라이더 차이 체감
- [ ] typewriter 긴 본문(400자+) fade fallback 동작 (v121)
- [ ] 표지 인스펙터 미리보기 1회 재생

### 3-6. 글자 스타일
- [ ] 폰트 (Jua/Nanum/Gowun 등) 변경 즉시 반영
- [ ] 크기 슬라이더
- [ ] 색 선택
- [ ] 굵게/보통 토글
- [ ] **"모든 장면에 적용"** 버튼 (장면 1 인스펙터)
- [ ] 엔딩 글자 스타일 default (Jua 20px / #2b1f10 / 굵게)

### 3-7. 엔딩 (v125)
- [ ] **엔딩 = 항상 분할형(split) 고정** (그림 중심형 박지 X)
- [ ] 진엔딩(trueEnding) 표시 (⭐)
- [ ] 엔딩 본문 + 배지 + 행동 버튼 정상
- [ ] "다시 시작" 박은 거 entrySceneId/replaySceneId로 이동
- [ ] 엔딩 본문 줄바꿈 유지

### 3-8. 그림책 하위 모드
- [ ] **첫 장면에서만 split / imageCenter 변경 가능**
- [ ] 첫 장면 변경 시 모든 장면 일괄 적용 (v122a)
- [ ] 엔딩은 강제 split (v125)
- [ ] imageCenter 본문 글상자 위치/폭 박은 거 정상 (picturebookBodyBox)

### 3-9. 페이지 방향
- [ ] portrait / landscape 작품 전체 통일
- [ ] `body[data-page-orientation]` 박혀있음
- [ ] portrait 작품: 모든 모드에서 210:297 비율
- [ ] landscape 작품: 16:9 또는 viewer-frame 가득

---

## 4. 루트보기 (v130)

### 4-1. 기본 표시
- [ ] 다듬기 화면 HUD "🛤 루트보기" 박은 거 동작
- [ ] 시작 기준 토글 (🟢 첫 감상 / 🔁 다시 시작)
- [ ] 엔딩별 그룹화 (해피 / 진엔딩 / 비극 / 이슈)
- [ ] 경로 카드 색깔 (보라/노랑/주황)
- [ ] 반복 경로 감지 (🔁)
- [ ] 깨진 연결 표시 (🔌)
- [ ] 경로 개수 표시
- [ ] **500개 경로 상한** 작품에서도 부분 표시
- [ ] X 버튼 + 배경 클릭 닫기 (v124b)

### 4-2. 인라인 본문 수정 (v130)
- [ ] **viewer-edit + editable=true일 때만 ✎ 버튼 표시**
- [ ] maker 환경에선 ✎ 박지 X
- [ ] 잠금 readonly 상태에선 ✎ 박지 X
- [ ] ✎ 클릭 → textarea 열림 (원본 그대로)
- [ ] **줄바꿈 유지** (v127 정책)
- [ ] Ctrl+Enter 저장 / Esc 취소 / [저장]/[취소] 버튼
- [ ] 저장 후 **같은 sceneId의 모든 rt 라인** 갱신
- [ ] **viewer-frame 즉시 patch** (현재 보이는 장면이면)
- [ ] **다듬기 패널 본문 textarea도 갱신** (focus 보호)
- [ ] 새로고침 후 유지
- [ ] 다른 장면일 때 = `saveSceneText` 직접 호출 (debounce 우회)

### 4-3. 인라인 선택지 라벨 수정 (v130)
- [ ] 선택지 pill ✎ 버튼
- [ ] input 열림 (max 60자)
- [ ] Enter 저장 / Esc 취소
- [ ] **buttons[idx].label + choiceA/B 동시 저장**
- [ ] 감상 선택지 즉시 반영
- [ ] 브랜치 화면 행동버튼 라벨 반영

### 4-4. 카드 점프
- [ ] `.rt-scene-text` 클릭 시에만 카드 점프 (✎ 영역과 분리)
- [ ] maker 환경에서 점프 정상 (viewer는 무용)

---

## 5. 엔딩 / 표지 특수 케이스

- [ ] 진엔딩(trueEnding=true) 박힌 경우 ⭐ 표시
- [ ] 엔딩이 여러 경로의 종점일 때 그룹화 정상
- [ ] 표지(scene.type='cover') 인스펙터 = title + subtitle + kicker만 (본문/행동버튼 X)
- [ ] 표지 시작 버튼 → entrySceneId로 이동
- [ ] cover_shown 플래그 동작 (restartStory 후 cover 박지 X)

---

## 6. 다듬기 / 잠금 / 저장

### 6-1. 잠금 확보 흐름
- [ ] 진입 시 낙관적 시작 (배너 없이 editable=true)
- [ ] Firebase snapshot 도착 후 실제 상태 반영
- [ ] 다른 친구 잠금 박혀있으면 → 읽기전용 + 배너
- [ ] 같은 기기 다른 탭 잠금 (v125) → 부드러운 문구 + "여기에서 이어서 수정" 버튼
- [ ] "내가 수정하기" 버튼 → confirm 후 강제 인수
- [ ] 인수 실패 시 (v125) 원인별 alert:
  - 오프라인: "인터넷이 끊겨있어요"
  - auth 없음: "로그인/권한 확인이 늦어지고 있어요"
  - 기타: "편집 권한을 가져오지 못했어요"

### 6-2. readonly 상태 차단 (v129)
- [ ] body class `viewer-edit-readonly` 박힘
- [ ] **인스펙터 input/textarea/select/button 차단** (pointer-events:none + 흐림)
- [ ] **표지/본문 contenteditable 차단** (caret 숨김)
- [ ] **이미지 wrapper drag/resize 차단**
- [ ] **HUD 저장 버튼 차단**
- [ ] **예외 살림**: 잠금 배너 액션, nav, 탭, HUD 액션(감상 테스트/루트/구조/브랜치로)
- [ ] **루트보기 ✎ 박지 X** (v130 정합)
- [ ] `_doSave` 스크립트 우회 차단 가드 동작

### 6-3. 양방향 동기 (v122c)
- [ ] 왼쪽 contenteditable 수정 → 오른쪽 input 갱신
- [ ] 오른쪽 input 수정 → 왼쪽 갱신
- [ ] focus 보호 (사용자 입력 중이면 덮어쓰기 X)
- [ ] 슬라이더 change에 preview 박은 거 1회 더

### 6-4. 저장 흐름
- [ ] `_queueSave` debounce 정상 (사용자 박은 ms)
- [ ] blur 시 `_flushPendingSave` 호출
- [ ] 저장 상태 표시 (저장 중 / 저장됨 / 저장 실패)
- [ ] 저장 실패 시 화면 가운데 빨간 banner (v122b)
- [ ] 페이지 이탈 시 확인 (v122b)
- [ ] visibilitychange / pagehide flush 동작
- [ ] buttons 60자 초과 / 0개 검증 동작

### 6-5. 부분 patch (W7)
- [ ] `_patchSceneBody` 동작 (본문만 갱신, 통째 재렌더 X)
- [ ] `_patchSceneTitle` 동작
- [ ] patch 실패 시 `_scheduleViewerFrameReRender` fallback
- [ ] 영상/이미지 매번 재마운트 박지 X (깜빡임 차단)

---

## 7. 감상 테스트 / 브랜치 복귀

### 7-1. 감상 테스트 (v128)
- [ ] 다듬기 HUD "▶ 감상 테스트" 박은 거 동작
- [ ] `_testingEdit = true` 박힘
- [ ] body class `viewer-test-active` 박힘
- [ ] **edit-mode-on / edit-mode-active 둘 다 제거됨**
- [ ] **CSS animation:none 룰이 적용되지 X** (전환 효과 정상 재생)
- [ ] 행동버튼 페이드인 정상 (다듬기 모드와 다름)
- [ ] 표지 → 첫 장면 / 일반 → 다음 / 일반 → 엔딩 모두 정상
- [ ] "✏️ 마감 편집으로 돌아가기" 버튼 (HUD ✕) 동작
- [ ] 돌아가면 editMode=true + 같은 장면 유지

### 7-2. 브랜치 화면 복귀
- [ ] HUD "← 브랜치 화면으로" 박은 거 동작
- [ ] 저장 마무리 + 잠금 릴리스 후 이동
- [ ] window.opener 살아있으면 close() 시도
- [ ] close 실패 시 localStorage context로 maker.html 이동
- [ ] context 만료(1시간 이상) 박은 경우 fallback 정상

### 7-3. 구조 보기
- [ ] HUD "🗺 구조 보기" 박은 거 동작
- [ ] 미니맵 노드 + 연결선
- [ ] 현재 장면 강조
- [ ] 시작점 ▶ / 엔딩 🏁 / 진엔딩 ⭐
- [ ] 노드 탭 → editNavigateTo

---

## 8. 모바일 텍스트형 (mobileTextBranch.js)

### 8-1. 진입 / 기본
- [ ] 모바일 + 텍스트형 자동 활성 (`_mtbIsMobile + _mtbIsTextProject`)
- [ ] PC에서 안 박힘
- [ ] PC 토글 박은 거 동작
- [ ] 동그라미 숫자 노드 + 연결선 정상
- [ ] BFS 자동 배치 / 사용자 mtbX/mtbY 우선

### 8-2. 장면 편집
- [ ] 노드 탭 → 편집 화면 열림 (WYSIWYG)
- [ ] 첫 장면 자동 열림 (v103)
- [ ] 본문 자동 focus (v105)
- [ ] 본문 입력 즉시 저장
- [ ] 행동버튼 라벨 입력
- [ ] **buttons ↔ choiceA/B 동기** (`_mtbSyncChoiceLabels`, v106)

### 8-3. 연결 / 배치
- [ ] 길게 누르기 → 행동버튼 연결 메뉴
- [ ] 대상 노드 탭 → 연결 완료
- [ ] 📍 배치 토글 + 드래그
- [ ] 묶음 이동 (자손 박은 거 같이 드래그, v106)
- [ ] mtbX/mtbY Firebase 저장

### 8-4. 핀치 줌 / pan (v117, v119, v120)
- [ ] 두 손가락 핀치 줌 부드럽게
- [ ] 한 손가락 pan
- [ ] 자동 fit (감상 테스트 후 박은 거)
- [ ] 연결선 렌더 throttle 동작 (drawArrows)

### 8-5. 표현 패널 (v115)
- [ ] 폰트 / 크기 / 색 / 굵기 / 테마 / 효과
- [ ] 토글로 열기/접기

### 8-6. 구조 화면 = 정리용 대시보드 (v107)
- [ ] 노드 배지 (분기 수 / ⚠)
- [ ] 상단 요약 바
- [ ] 칩 탭 점프

---

## 9. 태블릿 (v117~v120-lite)

- [ ] iPad / Android 10인치 진입 정상
- [ ] 카드 드래그 (캔버스) 부드럽게
- [ ] 연결선 렌더 throttle 동작
- [ ] pinch zoom 안정
- [ ] 잠금 박은 거 정상
- [ ] 다듬기 진입 시 input/textarea 16px 보장 (자동 확대 차단)
- [ ] 잠금 배너 버튼 터치 영역 min-height 40px
- [ ] 도구 패널 주요 버튼 최소 터치 영역

---

## 10. Firebase / Storage / 비용

### 10-1. 룰
- [ ] `auth != null` 외부 미인증 차단
- [ ] `teachers/{uid}` 노드 검증
- [ ] `classCodes/{code}` 학생 진입 동작
- [ ] `teacherClasses/{uid}` 교사 조회

### 10-2. 저장 경로
- [ ] v2 경로 (`classes/{classId}/teams/{name}/`) 정상
- [ ] v1 호환 (`teams/{name}/`) 옛 작품 로드 가능
- [ ] `viewer-data.js basePath` 분기 정상

### 10-3. saveSceneText ALLOWED (v129 시점)
- [ ] title, body, presentationMode, presentationSubmode
- [ ] movieData, textBox, buttons
- [ ] choiceA, choiceB, choiceCount, nextA, nextB
- [ ] bodyEnabled, picturebookSubmode, picturebookBodyBox
- [ ] connectObjects, textStyle, textTheme, textEffect
- [ ] imageData
- [ ] subtitle, coverTheme, titleVerticalPosition, **kicker** (v129)
- [ ] 그 외 필드 무시

### 10-4. Storage (v113 이후)
- [ ] base64 RTDB 저장 X
- [ ] 큰 이미지 Storage 업로드 → URL만 저장
- [ ] `_saveFlattenedImage` Storage 경유 (v122-fix)
- [ ] 옛 base64 작품 마이그 동작 (v113~v115)

### 10-5. 비용 알림
- [ ] Firebase 결제 알람 박혀있는지 확인
- [ ] 비정상 사용량 패턴 없는지 (한 번 확인)
- [ ] AI 기능 미구현 — 별도 API 비용 박지 X

---

## 11. 이미지 편집 (viewer-image-edit.js)

- [ ] 이미지 업로드 (jpg/png/webp)
- [ ] drag로 이동 (safe-area 안쪽 clamp)
- [ ] resize 핸들
- [ ] 자르기 (crop)
- [ ] 그림 그리기 (있다면)
- [ ] 이미지 삭제
- [ ] Storage 자동 업로드
- [ ] 평탄화 저장 (`_saveFlattenedImage`, v122-fix)
- [ ] readonly 상태에서 drag/resize 박지 X (v129)

---

## 12. 작품 자동 commit/push/zip

- [ ] 큰 명 마감 시 자동 commit
- [ ] commit 메시지 형식 정상
- [ ] 자동 push
- [ ] zip 생성 (`/Users/dobuk/Downloads/picturebook-v{n}.zip`)
- [ ] 이전 zip 자동 삭제

---

## 13. 다음 단계 안전망

### 13-1. AI 기능 구현 시 (Phase A 진행 전 확인)
- [ ] `ai-feature-integration-plan.md` v2 읽음
- [ ] Phase 0 결정문 14개 항목 모두 사용자 확정
- [ ] 학부모/학교 동의 박혀있음
- [ ] Anthropic console 월 한도 설정
- [ ] Replicate (이미지) 월 한도 설정
- [ ] 1개 베타 클래스 지정
- [ ] 비상 차단 스위치 위치 정함
- [ ] Firebase 결제 알람 활성
- [ ] **v113 만원 사건 교훈 인지** — 비용 모니터링 우선

### 13-2. 새 기능 박을 때 정합성
- [ ] 본문 줄바꿈 정책 (v127) 유지
- [ ] buttons + choiceA/B 호환 유지
- [ ] 잠금 readonly 정합 (v129)
- [ ] 감상 테스트 정합 (v128)
- [ ] 루트보기 인라인 패턴 (v130)
- [ ] Storage 경유 정책 (v113)
- [ ] 기존 함수 재사용 (saveSceneText, _queueSave 등)

### 13-3. 회귀 확인 시 우선순위

대규모 변경 후엔 다음 순서로 빠르게 확인:

1. **§2 진입** — 학생/교사 모두 진입되는지
2. **§3-2 본문 줄바꿈** — v127 정책 안 깨졌는지
3. **§4-2 루트보기 인라인** — v130 동작
4. **§6-2 잠금 readonly** — v129 차단
5. **§7-1 감상 테스트** — v128 속도 반영
6. **§10-3 saveSceneText** — 저장 필드 ALLOWED

이 6개가 깨지지 않으면 큰 회귀는 없음.

---

## 14. 알려진 한계 (회귀 아님)

다음은 **의도된 동작** — 회귀로 박지 X.

- 표지에 그림(이미지) 박지 X (사용자 결정, v37)
- 엔딩 그림 중심형 박지 X (v125 — 항상 분할형)
- 학생 회원가입 박지 X (익명 정책)
- 다른 학생 작품 직접 수정 박지 X (잠금이 차단)
- maker 환경에서 v130 루트보기 ✎ 박지 X (`_rtIsViewerEditable()=false`)
- AI 기능 자체 박지 X (설계만, 구현 X)
- 학생 측 admin UI 박지 X (교사 전용)

---

## 15. 회귀 발견 시 처리

1. **재현 가능한지 확인** — 1회만 박힌 거면 환경 박을 가능성
2. **언제부터 박힌 건지** — git log 박은 거로 확인
3. **`git bisect`로 원인 커밋 찾기** (큰 회귀)
4. **fix 후 이 체크리스트 재실행** — 같은 영역
5. **회귀 메모리 기록** (`feedback_branch_*.md`)

---

**문서 버전**: v131 작업 — 2026-05-18 작성
**다음 갱신**: 새 큰 명에서 안정화된 기능 추가/변경 시
