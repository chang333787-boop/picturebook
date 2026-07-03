# PICTUREBOOK-SCENE-PUBLISH-PRINT-1 — 교사용 장면 그대로 그림책 인쇄

- 일자: 2026-07-03 · 기준: origin/main `d6e04ae` · client-only
- 설계 정본: docs/picturebook_print_strategy_rethink_audit_20260703.md (C안 혼합형)
- 판정: **PICTUREBOOK_SCENE_PUBLISH_PRINT_1_LIVE_PASS**

## 1. 왜 바꿨나
재배치형은 학생이 그림 위에 배치한 말풍선(위치·크기·진하기)과 장면 구성을 지웠다.
새 방식: **화면의 그림중심 무대를 그대로 인쇄**(그림+말풍선), 선택지 버튼만 하단 인쇄용 안내로.

## 2. 교사용 인쇄 진입 (Phase A)
- 작품마무리의 `🖨 그림책 인쇄` 버튼+머리글 안내는 **admin 진입 마커가 있을 때만 노출**
  (`branchReturnContext.source==='admin'` — adminConsole이 감상/인쇄 진입 시 저장 — 또는 `?print=pb`).
  학생 다듬기 세션에서는 완전 숨김. ※ localStorage 마커 = 화면 단순화 목적(보안 게이트 아님).
- **admin 팀 카드 ⋯ 메뉴에 [🖨 그림책 인쇄] 추가** — `_openViewer(team, '&print=pb')`로 viewer 진입.
- `?print=pb`: viewer-data가 s2 유무와 무관하게 viewer-ai를 로드하고, viewer-ai 부트스트랩이
  팀 로드 완료(scenes 준비)를 폴링해 **인쇄 옵션 모달을 1회 자동 오픈**(자동 print는 안 함).

## 3. 장면 그대로 무대 재현 (Phase B) — 캡처 아님·DOM 재구성·화질 손실 0
- 그림 있는 장면 = `.pbp-scenepub` 페이지: `.pbp-stagewrap`(폭 100%·**aspect-ratio 3:2**·얇은 프레임)
  안 `.pbp-stage2`에 ①그림(absolute inset 0·**contain·크롭 0**) ②장면번호 좌상단 오버레이
  ③제목 오버레이(상단 중앙 필) ④**말풍선**: `scene.picturebookBodyBox`의 **% 좌표 그대로**
  (left/top/width%) + 진하기 rgba + 그림자. 명시 height는 **min-height**로 — 인쇄는 스크롤이
  없으므로 긴 글 자동 확장·잘림 0. 폰트 px 고정(19px).
- **해상도 독립**: 인쇄 페이지 폭은 A4에서 일정 → % 좌표+px 폰트 = 태블릿/PC/창 크기와 무관.
  화면의 cqw/cqh 가변 폰트 문제가 인쇄에는 존재하지 않음.
- split형 장면(말풍선 좌표 없음): 그림 무대 + 본문을 무대 아래 인쇄용 박스로.
- 무그림 장면: 기존 text-only 출판 페이지(LAYOUT-4) 유지. 표지: DESIGN-3 유지.
- 선택지: 무대 밖 하단 `▸ 따라간다. → 2번 장면으로 가세요` / 엔딩 `— 이야기 끝 —`(기존 재사용).
- 재배치형(그림+본문 재배치 페이지)은 이 방식으로 대체 — 코드는 git 이력에 보존(`4ada6ee`).

## 4. 원본/AI 옵션 연결 (Phase C)
OPTIONS-1 모달 그대로 + `getS2Layout` 콜백 추가: 글=AI면 variant layout
(`aiVariants/text/{sid}/s2/layout`·FB→localStorage) 우선, **진하기는 원본을 따름**(REFINE-STAB-B).
후보 없는 장면은 장면 단위 원본 fallback. 이미지 preload 대기(DESIGN-3)·머리글 안내 유지.

## 5. 검증 (실 viewer.html·전체 CSS)
- 게이트: 마커 없음=버튼/안내 숨김 · 마커=표시 · `?print=pb` 자동 모달 오픈 ✅
- 무대: 말풍선 inline style이 저장 좌표/진하기와 **정확히 일치**
  (`left:20%;top:30%;width:50%;min-height:35%;rgba(…,0.6)`) · 제목/배지 오버레이 · 그림 contain ·
  선택지 2개 하단 · split 본문 아래 · 무그림 text-only · 엔딩 ✅
- s2: AI 글+variant layout(10/55/70/30) 적용 + **opacity 원본 0.6 유지** · 그림=AI 무대 적용(로드 후 인쇄) ✅
- **결정성**: 뷰포트 1024→1680 재생성 시 말풍선 inline style **byte 동일** ✅
- PDF(A4) 페이지 N+1 · afterprint/unclip 정리 · 타 print gate 충돌 0 · console error 0 ·
  테스트 462/462 · node --check OK.
- NOT_VERIFIED(실계정): admin 대시보드 실화면에서 ⋯ 메뉴 [🖨 그림책 인쇄] 클릭 1회(코드/정적 확인만).

## 6. 남은 후속
- 관리모드 인쇄 UX 추가 개선(그림책 아닌 팀에서 메뉴 숨김 등) · 양면/제본형 · 이야기 길 지도
  별도 출력 · 교사 PC 실프린터 1회 · aiChecks rules 승인 대기(별도 트랙).

## 버스터
`scenepubprint1` — picturebook-print.js·viewer-ai.js·viewer-data.js·pb-ai.css(viewer.html)
+ adminConsole.js(maker.html).
