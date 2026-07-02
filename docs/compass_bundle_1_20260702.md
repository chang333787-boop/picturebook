# COMPASS-BUNDLE-1 — targetLength 연결 + 결과지 polish + rose/followup 조사

2026-07-02 · 기준 origin/main `dee5ddf` 이후 · 클라이언트 구현(A·B) + read-only 조사(C·D)

## A. COMPASS-LENGTH-BASE — 구현·검증 완료
**연결 방식** (완료 경로만·수동 버튼/폴백 경로는 8 유지):
review `_complete` → `afterComplete({...ctx, answers})` → `resolveStoryCount(answers)`(scenes.js 순수)
→ `createStarterTemplateForNewProject(ptype, {storyCount})` → `_writeBase10IfEmpty` → `_mtbBuildBase10Scenes({storyCount})`.

- 빌더 파라미터화: 일반 장면 2~(N+1)·엔딩 키 N+2. **허용 8/12/15만**, 그 외 전부 8.
- **8 = 기존 BASE10과 JSON 완전 동일**(byte-identical 검증) → v1·기존 호출부(인자 1개)·수동 버튼 전부 하위호환.
- fallback 결정: **유예/모르겠어요/v1/이상값 → 8**(설계문서 "12 가정" 대신 기존 기본 틀 유지 = 최소 놀람).
- 분기 자동 생성 없음(선형만) · 기존 scenes 재생성 없음(기존 멱등 가드 그대로) · DB 스키마 변경 0.
- 좌표: desktop `_base10PositionFor` fallback 공식으로 11+ 노드 단조 증가 확인. mobile 공식형 그대로.
- 검증: 브라우저 실빌더 — 기본=10노드, 8=기본과 동일, 12→14노드(엔딩14), 15→17노드(엔딩17),
  선형 링크·cover/ending 타입·엔딩 버튼 0·그림책 imageCenter 전 노드 부착. 통합 — v2 완주(15 선택)→
  `{storyCount:15}` 전달, 유예→`{storyCount:8}` 전달 확인.

## B. COMPASS-SHEET-POLISH — 구현·검증 완료
1. **긴 무공백 답변 overflow 수정**: `.tc-sheet-summary/.tc-sheet-card-value` + 기존 `.tc-review-q/.tc-review-a`에
   `overflow-wrap:anywhere`(keep-all 유지). 390px에서 v1/v2 가로 overflow 0 확인(수정 전 기존 Q&A에서 발생하던 문제).
2. **인쇄 A4 1장 컴팩트**: `body.tc-print-sheet` 게이트 **내부에서만** 제목/줄거리/카드/메모 폰트·spacing 축소.
   A4 근사(794×1123) print 에뮬레이션에서 카드 높이 1029px < 1페이지 확인. 일반 화면/일반 인쇄 영향 0(게이트 유지).
3. 모바일 1열(≤480px)·인쇄 버튼 크기·유예 표기는 기존 SHEET-1 상태 적정 판단(무변경).

## C. COMPASS-ROSE-AUDIT → **COMPASS_ROSE_NEEDS_MOCKUP**
중앙=coreMessage·4방위(주인공/목표/어려움/선택)+시간띠 권장. 모바일은 카드형 유지, 나침반형은
**인쇄/태블릿 가로 전용**. SVG 인라인(라이브러리 0)·데이터는 storyMapV2 그대로. 상세: docs/compass_rose_audit_20260702.md

## D. COMPASS-V2-FOLLOWUP-AUDIT → **COMPASS_V2_FOLLOWUP_READY_FOR_DEPLOY_APPROVAL**
prompt 재설계 불요. 수정 범위=functions/thought-compass-followup.js(allowlist 17키 합집합·QUESTION_BRIEF v2
8키·상한 12→15·fallback 3키 추가)+클라 가드 해제. deploy 대상 callable 1개(asia-northeast3).
실 AI 없이 모듈 테스트+에뮬레이터 stub QA 가능. 상세: docs/compass_v2_followup_audit_20260702.md

## E. 통합 검증
- `node --check` 전 수정 파일 OK · 테스트 **219/219**(신규 length-base 4).
- 브라우저: 빌더 8/12/15·완주 storyCount 전달·모바일 390 overflow 0·print A4 fit·게이트 화면 무영향.
- functions/rules diff **0** · 실 AI 호출 0 · DB write/migration 0 · 새 라이브러리 0 · 8000 미접촉.

## F. 변경 파일 / 캐시버스터 `compassbundle1`
mobileTextBranch.js(빌더 파라미터화) · thought-compass-scenes.js(resolveStoryCount) ·
thought-compass-review.js(answers 동봉) · thought-compass.css(polish) · maker.html(버스터 4) ·
viewer-edit.js(지연번들 V·CSS href) · viewer.html(EDIT_SRC) · tests/length-base(신규 4) · docs 3.

## 남은 위험 / NOT_VERIFIED
- 실 운영 RTDB에서 12/15 생성 왕복(스텁 검증) · 실기기(iPad) 인쇄.
- 12/15 캔버스에서 노드 15~17개의 편집 UI 밀도(데스크톱 일렬 x≤5300px — pan 가능·문제 시 좌표 후속).
- 후속 승인 필요: ①COMPASS-V2-FOLLOWUP(functions 수정+deploy) ②COMPASS-ROSE-1(SVG 목업 승인 후).

## 최종 판정
**COMPASS_BUNDLE_1_LIVE_PASS** (A·B 구현 live / C·D 조사 완료·후속 승인 대기)
