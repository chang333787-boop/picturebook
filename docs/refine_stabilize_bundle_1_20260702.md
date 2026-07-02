# REFINE-STABILIZE-BUNDLE-1 — 다듬기/감상 연결부 안정화 묶음

2026-07-02 · 클라이언트 전용 · 기준 main `048f6d2` · B/C/D/E 구현 + **A는 서버 정책 결정 필요(중단 조건 해당·옵션 보고)**

## Phase A — 감상 글 정하기 저장 실패: 원인 확정·정책 질문 (미수정)
**원인(확정)**: 클라 payload는 정상(classId/teamName/sceneId/selected). 운영 로그(오늘 11:06 시도)
auth VALID인데 HttpsError 반복 + 학급 설정 확인(textS2 ON·enabled ON — read-only 확인) →
남는 거부 지점 = **서버 teacher-only**(`teacher_uid === uid`). maker 세션은 `signInAnonymously`
익명 uid라 **UI 노출 정책(제작 세션이면 모달 노출)과 서버 정책(담당 교사 계정)이 불일치**.
어제 13:36 auth MISSING 1건은 편집 세션 auth 복원 전 호출(_ensureAnonymousAuth가 편집 세션에서
null 반환) — 부차 원인.
**옵션(사용자 결정)**: ①서버 완화 — 팀 active member(제작 세션)도 선택 허용(functions 수정+deploy
승인 필요·학생도 가능해짐 → P7 '교사 전용' 설계 변경) ②현행 유지 — 교사 계정(teacher-auth 로그인)
세션에서만 동작 + 클라에서 비교사 세션이면 버튼에 안내(교사 로그인 필요) ③imageS2처럼 '교사 대행'
흐름 유지하되 admin/교사 페이지 쪽에 선택 UI 제공. ※ imageS2 선택도 같은 구조(잠재 동일 이슈).

## Phase B — AI 장면발전 글상자 진하기 미적용: 수정 ✅
**원인**: aiS2 보기는 저장된 variant layout을 그대로 사용 — layout에 backdropOpacity가 저장 시점
값(기본 0.85)으로 굳어 있어, 이후 원본(장면 꾸미기)에서 진하기를 바꿔도 AI 보기에 미반영.
**수정**(viewer-ai `_getDisplayPbBodyBox`): **진하기/배경은 항상 원본 설정을 따르고, variant layout은
위치/크기만 유지**(필드 누락 시 무효 CSS 방지 겸). 데이터 무변경.
**실검증**(하니스·실 viewer-ai): aiS2+variant(x30/w45·opacity0.85 고정) → 표시 box `{x:30,width:45,
opacity:0.3(원본)}` ✅ · variant 없음→원본 그대로 ✅ · 원본 보기 passthrough ✅.

## Phase C — 다듬기→브랜치 복귀 '로그아웃처럼': 수정 ✅
**원인**: `_resumeTeamFromSession`이 **auth 복원(IndexedDB 비동기) 완료 전** currentUser=null을 보고
`signInAnonymously()` → **새 익명 uid** 생성 → `members/{기존uid}` 확인 실패 → 세션 삭제+재로그인
화면(간헐). 실제 signOut 아님 — auth 로직 본체는 무변경 원칙 준수.
**수정**(firebase.js): onAuthStateChanged **첫 발화(복원 완료) 대기**(+3s 방어 타임아웃) 후에만 필요 시
익명 로그인. ※ 2h makerSession 만료·레거시팀 membership 미기록(H-1 트랙)에 의한 재로그인은 정상
동작으로 별개(관측 계속).

## Phase D — 다듬기 상단/더보기 정리 ✅
- `⋯ 더보기` 제거(핸들러는 null 가드라 무해) · `🔍 구조 보기` 다듬기에서 삭제 · `🌿 처음으로`
  다듬기에서 제거(감상 HUD·브랜치 화면은 유지) · 브랜치 상단바 무변경.
- `⚙ 감상/작품 설정` = 상단 단독 버튼(기존 핸들러 그대로) · `🧭 나침반` = 상단 단독(기록 있을 때만 —
  기존 display 제어 클래스 동일).
- `🛤 이야기 길 보기` = 작품 마무리 안 **'🗺 이야기 길 확인'** 섹션으로 이동(2단계 뒤·3단계 앞):
  제목/설명/[🛤 이야기 길 보기] 버튼(+그림책이면 [🖨 그림책 인쇄] 동반 이동). 루트 패널 로직은
  `window._openViewerRoutePanel`로 추출·재사용(변환/닫기 로직 무변경).

## Phase E — 밤 이야기(night-story) 행동버튼 색감 ✅
기본 파스텔(data-pb-color) 버튼이 밤 무대에 떠 보이던 것 → night-story 스코프 한정 오버라이드:
깊은 남색 배경(rgba 26,34,66)+크림 글자(#f2ecd9)+달빛 금색 테두리, hover/focus/active 포함.
다른 테마 selector 미접촉.

## 원본 보존/저장 확인
scene.body/imageData/imageUrl write 0(B는 표시 계산·C는 auth 대기·D는 UI 재배치·E는 CSS).
textSelections 경로/정책 무변경(A는 미수정). DB write 0 · AI 호출 0 · functions/rules diff 0.

## 테스트
node --check 전체 OK · 테스트 237/237 · Phase B 하니스 실검증 · Phase D 정적 검증(편집 HUD에서
더보기/구조보기/처음으로 0·⚙/🧭/복귀 존재·감상 HUD 처음으로 유지) · secret 0.
NOT_VERIFIED(실기기): C 복귀 race 재현(간헐)·D 실화면 배치·E 실기기 색감 — 수업/실사용 확인 항목.

## 캐시버스터 `refinestab1`
viewer-ai(AI_SRC)·viewer-edit(EDIT_SRC)·viewer-render·v03-modes.css·firebase.js(maker.html).

## 제외(범위 외 유지)
인쇄 추가 구현·브랜치 카드 본문 빠른 수정·auth enforce ON·Functions/Rules deploy·실 AI 호출.

## 판정
**REFINE_STABILIZE_BUNDLE_1_PARTIAL_PASS** — B/C/D/E live. A는 서버 권한 정책 결정 대기(옵션 ①~③).
