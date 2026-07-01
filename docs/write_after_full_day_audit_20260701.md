# 작품 마무리 전체 기능 하루 총점검 (BRANCH-WRITE-AFTER-FULL-DAY-AUDIT)

- 일자: 2026-07-01 14:46 KST
- 감사 대상: origin/main `3d38f28`(= feature tip 코드) · live https://chang333787-boop.github.io/picturebook
- 성격: **감사 전용**(수정 0 · deploy 0 · DB write 0 · 실 AI 0 · main merge 0)
- 최종 판정: **`CRITICAL_FIX_REQUIRED`** (원본 body 오염 경로 1건 발견 — P7 회귀)

## 기준 상태
- main = origin/main = `3d38f28`, working tree clean, rules/node_modules drift 0.
- live 캐시버스터: viewer-ai `…stepgate1finishname1textsel2ui` · viewer-data `…textsel1textsel2ui` · viewer-render `…finishname1textsel1` · adminConsole `…finishgroup1` — **전부 최신 반영**.
- 로컬 서버 미사용(CDN·Playwright만). 8000 미접촉.

## 🔴 CRITICAL (1) — 즉시 수정 후보 (미적용·승인 필요)

### C-1. 교사가 s2 발행선택한 장면을 원본 보기에서 편집하면 원본 scene.body가 AI(s2) 텍스트로 덮임
- **원인(P7 회귀)**: viewer-render.js 8개 body 렌더 지점에서 `const body = _getDisplayBody(scene.id, _pubBody)`(예 [viewer-render.js:505](viewer-render.js:505)). 원본 보기 모드에선 `_getDisplayBody`가 입력을 그대로 반환 → `body = _pubBody`. `_pubBody = getPublishedBodyDisplay(scene,_orig)`는 **교사가 textSelections에 s2를 발행선택한 장면이면 s2 본문**.
- 편집 게이트 `_allowTcEdit = editMode && aiViewMode==='original'`([viewer-render.js:522](viewer-render.js:522))가 원본 보기에서 contenteditable 허용, 필드는 `escHtml(body)` + `data-pb-editable="body"` → **scene.body 저장**([viewer-render.js:539](viewer-render.js:539)).
- **결과**: 교사(편집 세션)가 특정 장면 s2 발행 → 이후 그 장면을 원본 보기에서 편집/blur 하면 화면의 s2 텍스트가 원본 scene.body를 덮어씀. P7 이전(`_getDisplayBody(scene.id, _orig)`)엔 원본 보기 편집이 항상 `_orig`(진짜 원문)라 안전했음 → **P7 `_pubBody` 주입이 만든 회귀.** 코드 주석("_orig 원문은 편집용 불변", [viewer-render.js:502](viewer-render.js:502))과 실제 동작 불일치.
- **트리거 조건**: (1)교사/편집 세션 (2)해당 장면 s2 발행선택 (3)원본 보기에서 그 장면 본문 편집. 자동 오염 아님(편집 행위 필요)·학생 도달 불가(발행선택은 교사 전용). 그러나 write-after 핵심 불변식("원본 body 절대 자동 미수정")을 깨는 데이터 무결성 결함.
- **최소 수정 후보(미적용)**: 편집 가능 필드에는 항상 `_orig`(진짜 원문)를 렌더. 예) `_allowTcEdit` 계산을 `body`보다 앞으로 올리고 `const body = _getDisplayBody(scene.id, _allowTcEdit ? _orig : _pubBody)` (8지점). 또는 `_pubBody`를 `!_isEditMode`(감상)에서만 적용. 감상 화면 발행 표시는 유지, 편집창은 진짜 원문 → 오염 차단. **다음 승인 루프에서 수정 + resolver/edit 회귀 테스트 권장.**
- 임시 완화: 교사에게 "s2 발행선택한 장면은 원본 보기에서 본문 편집 금지" 안내(코드 수정 전까지). 또는 감상 글 정하기를 편집 완료 후 마지막에만 사용.

## 🟠 HIGH (2)

### H-1. `_validateRequest`가 텍스트 AI 모드에서 team membership/PIN 미검사 (기존 이슈·재분류)
- functions/index.js `_validateRequest`(~350-486)는 auth.uid 존재 + aiSettings.enabled/modes + copyDepth + origin + killswitch + quota만 검사, `members/{uid}/status` 미확인. 대조로 `_validateSourceModeRequest`는 membership 검사.
- 결과: AI 활성 학급에 인증된(익명 포함) 사용자가 **같은 학급 임의 teamName**으로 callTextAiBatchS2/callWorkCheck/callWriteAfterQuestions 호출 + `aiVariants/text/{sid}/s2` variant write 가능 → 타 팀 AI quota 소모·variant 노드 오염. **P7 신규 아님**(기존 구조). 감상 발행 표시는 교사 selection 게이트로 보호되어 실제 노출은 안 됨.
- 이번 루프 미수정(구조 이슈·승인 필요). 완화: 학급 단위 AI ON/OFF로 노출 제한 중.

### H-2. 학생이 남의 팀 aiVariants/text s2 variant write 가능 (H-1의 파생)
- `saveTextVariant`도 동일 게이트(membership 미검사) → 같은 학급 내 타 팀 variant write. selection(발행)은 교사 게이트라 불가. 영향 = quota 소모 + variant 오염(감상 노출 안 됨).

## 🟡 MEDIUM (0 신규)
- (B.1/B.2는 C-1로 승격 통합.)

## 🟢 LOW (1)
- L-1. 진입 HTML `cache-control: max-age=600` (GitHub Pages 기본) → SW(navigate no-store·Cache Storage 미사용) 활성 전 최초 1회 ≤10분 stale 창 가능. 기존 문서화된 한계·기능 영향 없음.

## NOT_VERIFIED (인터랙티브/대상 부재 — 중단 아님)
- N-1. **§2/3/4 흐름 실동작**(1·2·3단계 게이트·생각점검질문·작품검사 모달·확인했어요·이 장면 고치기·모두 고쳤어요/다시 고칠래요): 코드 배선 PASS(에이전트 섹션 A). 실 교사 세션 + latest/aiChecks 데이터 필요 → 인터랙티브 시각 NOT_VERIFIED.
- N-2. **§5 AI 장면발전 실행**: 코드경로 PASS(입력=최신 body·원본 미접촉·rewriteDone 게이트·엔딩 포함·textS1 0). 실 AI 호출 금지 → 실행 NOT_VERIFIED.
- N-3. **§6 감상 글 정하기 selection 저장 E2E**: 게이트/도달성 PASS(학생 미노출·교사 게이트·401·s2없으면 disabled). s2 있는 테스트 작품 부재 + 운영 write 금지 → 저장 E2E NOT_VERIFIED(승인 필요).
- N-4. **§7 imageS2 결과보기/적용 실동작**: 코드 무변경 PASS. 실 이미지 결과 필요 → NOT_VERIFIED.
- N-5. **§8 그림책 글보기 토글 + 장면 분위기 실동작**: 실 그림책 작품 필요 → NOT_VERIFIED.
- N-6. **§10 브랜치 캔버스/노드/연결선**: 실 작품 필요 → NOT_VERIFIED(회귀 무관 영역).
- N-7. **§15 작품 마무리 모달 반응형**(390/iPad/저높이): 모달은 실작품+세션 필요(closure-private) → NOT_VERIFIED. (관리자 패널 390px는 PASS.)
- N-8. **§16 텍스트 6테마 실렌더**: 텍스트 테마(T-THEME)는 별도 기능·live 미반영(deploy X)로 추정. write-after UI는 인라인/pb-ai.css라 테마와 독립 → 충돌 위험 낮음이나 실렌더 NOT_VERIFIED.
- N-9. **aiChecks/{writeAfterQuestions,workCheck}/latest rules**: database.rules.json에 명시 규칙 없음(기본 거부 추정, admin SDK write는 rules 우회). 학생 직접 read 가능 여부 미확정.

## PASS 목록 (요약)
- §0 기준·§1 캐시/PWA(버스터 최신·SW no-store·network-only)·§11 버튼 전수 배선(죽은 버튼 0)·§12 관리자 그룹화(토글4·textS1 미노출·외부AI 안내·master)·§13 학생 게이트(plain=버튼 미노출·교사 세션 게이트·callable 401)·§14 저장 경로 정합성(aiVariants .write:false·admin SDK 전용·selection 없으면 원본)·§15 관리자 패널 390px overflow 0·§18 콘솔(viewer/maker 에러 0·favicon만)·§19 용어(노출 'AI 다듬기' 0·📁 작품 마무리·감상에 보여줄 글↔글 보기 구분·대필 오해 방지 문구)·§C.5/§D/§E/§F 코드경로.
- **핵심 안심**: AI가 원본 scene.body를 *자동* 덮는 경로 없음(변형은 aiVariants 전용·admin SDK). 발행 표시 전환은 전부 교사 게이트. imageS2 회귀 0. textS1 재노출 0. 단 **C-1(교사 편집 순서 의존 오염)** 은 수정 필요.

## 증거
- CDN grep(캐시버스터·UI 문구·resolver·textS1 0·imageS2 안내), Playwright(학생 게이트·교사 세션 게이트·관리자 390px·콘솔0), 스샷 `text-selection-ui-live.png`·`write-after-admin-finishgroup-LIVE.png`. 코드경로 근거는 위 파일:라인.
- 실 AI 호출 0 · 운영 DB write 0 · Functions/Rules deploy 0 · 코드 수정 0.

## 다음 패치 루프 추천 순서
1. **C-1 수정**(최우선): 편집 필드는 항상 `_orig` 렌더(감상만 `_pubBody`). 8지점 + edit 회귀 테스트 + s2 발행 후 편집 시 원본 불변 E2E.
2. **H-1/H-2 검토**: `_validateRequest`에 team membership 검사 추가 여부(안전 모드·rules/functions 배포 승인 게이트).
3. N-3 selection 저장 E2E(실 교사 세션·s2 작품) → 감상 표시 전환·원본 불변 실측.
4. §2/3/4/8 인터랙티브 시각(실 교사 세션).
5. Follow-up: 학생 선택 허용 검토·프린트/활동지·rewriteDone 자동 초기화·aiChecks rules 명시.
