<!-- 울트라코드 전수 검증(13에이전트·9영역·96점검) 2026-07-23. 이전 후 정상성 단일 출처. -->

# 이전 후 전 기능 검증 리포트 (https://branchstory.co.kr)

**결론: 이전 후 전 기능 정상 — 코드상 깨지는 항목 0건. 조치필요 0건. 사람 최종확인(완결성) 5건 권장.** 도메인/origin/base-path 이전으로 깨지는 잔여 의존은 9개 영역 어디에도 없음. **🤖 AI 기능(텍스트 S1/S2·작품검사·이미지 S1/S2·그림책 마감·나침반)은 정상 — 24개 콜러블 전부 신도메인 커버(ALLOWED_ORIGINS에 branchstory.co.kr+www 추가·배포 a6319fc), 클라 콜러블은 region(asia-northeast3)·projectId 파생이라 도메인 독립. 라이브 프리플라이트로 신 origin 반사·배포본 일치 확증.** 남은 것은 부작용/과금 회피로 실행하지 않은 "인증된 실호출 1건" 류의 육안 확인뿐(이전 리스크 아님).

---

## 🔴 실제 이전으로 깨진 항목

**코드상 깨지는 항목 0.** broken/조치필요 없음. 안전성의 구조적 근거는 3가지로 수렴한다.

1. **모든 내부 내비/자산이 상대경로 또는 location 파생** — `<base>` 태그 0건, 구 도메인·`/picturebook/` 절대참조 0건(매칭된 `/picturebook/`는 전부 `text/picturebook/movie` 모드명 문자열). 예: 감상링크 파생 `adminConsole.js:2165` `baseUrl=location.origin+location.pathname.replace(/maker\.html.*$/,'')` — 서브경로든 루트든 정확히 재해석.
2. **모든 콜러블이 `functions('asia-northeast3')`** — projectId+region으로 cloudfunctions URL 조립(서빙 도메인 무관). Firebase config(`firebase.js:28-37`) 전부 프로젝트 기반 불변.
3. **RTDB/Storage 저장 경로가 classId/팀명 기반**(`firebase.js:290-295`) — origin/host/base-path 문자열 미포함.

---

## 영역별 검증

### 1. 🤖 AI 콜러블 (최우선) — overall: ok
origin 게이트는 CORS(전송계층, 반사형·게이트 아님)가 아니라 **앱-레벨 `isOriginAllowed(ALLOWED_ORIGINS)`**(`functions/index.js:139-143`, exact-match 화이트리스트·fail-safe)로 판정. 신도메인 2개가 `index.js:129-130`에 명시 추가·배포됨. 라이브 무과금 probe: OPTIONS(Origin:branchstory.co.kr)→204+`access-control-allow-origin: https://branchstory.co.kr`, 무인증 POST→401 `UNAUTHENTICATED`(소스 `:458` 바이트 일치 = 배포본이 a6319fc 계열임 확증). 동일 게이트를 쓰는 `joinTeamMembership`으로 오케스트레이터가 신도메인 팀0000 진입을 실증 = AI 콜러블 게이트도 라이브로 이미 입증됨.

| 콜러블 | origin 게이트 | 근거 file:line | 신도메인 커버 |
|---|---|---|---|
| callTextAiBatch (텍스트 S1) | `_validateRequest('s1')` | index.js:1529,1536 | ✅ |
| callTextAiBatchS2 (S2 청킹) | `_validateRequest('s2')` | index.js:1754,1763 | ✅ |
| callWorkCheck (작품검사) | `_validateRequest('check')` | index.js:1844,1850 | ✅ |
| callWriteAfterQuestions | `_validateRequest('writeAfterQuestions')` | index.js:2008,2014 | ✅ |
| callApplyTextS2Selection / saveTextVariant | `_validateRequest('s2'/variant)` | index.js:2696,2117 | ✅ |
| callImageAiS1 | `_validateRequest('imageS1')` | index.js:2356,2362 | ✅ |
| callImageAiS2 | `_validateRequest('imageS2')` | index.js:2516,2522 | ✅ |
| callStartImageS2Batch / ApplyImageS2Selection | `_validateRequest('imageS2')` | index.js:2609,2647 | ✅ |
| lock/reset/clear ImageSourceMode | `_validateSourceModeRequest` | index.js:2803,2882,2930 | ✅ |
| studentStoryDraft (학생 초안) | `_validateRequest('storyDraft')` | index.js:3270,3279 | ✅ |
| generateStoryImages (그림책 마감) | `_validateRequest('imageS2')` | index.js:3500,3506 | ✅ |
| joinTeamMembership (모둠/PIN) | 인라인 isOriginAllowed | index.js:3974-3978 | ✅ |
| callThoughtCompassFollowUp (나침반) | 인라인 isOriginAllowed | index.js:4141-4142 | ✅ |
| compassValueCandidates (나침반 가치) | 인라인 isOriginAllowed | index.js:4243,4251 | ✅ |
| admin/teacher 콜러블 5종 | **origin 게이트 없음** (auth+role만) | index.js:2966,3009,3077,3745 | 이전 무관 |
| getClassShelf / postWorkComment | **origin 게이트 없음** (코드/공개설정) | index.js:3814,3863 | 이전 무관 |

외부 AI 엔드포인트(OpenAI `api.openai.com`, Anthropic `api.anthropic.com`)·SSRF allowlist(Firebase Storage 호스트 고정)는 앱 도메인과 완전 무관(`image-s2-adapter-openai.js:18,31`).

### 2. 💾 데이터 보존·삭제 안 됨 — overall: ok
origin/도메인/uid 조건부 remove·set(null)·clear = **전체 grep 0건**. 유일한 운영데이터 remove(관리자 팀삭제 `adminConsole.js:2596-2615`)는 교사가 팀명 정확 타이핑+확인해야만 발화(origin/domain 조건 없음). 신도메인 라이브 config가 동일 `picturebook-8731f` RTDB 지시 확인(curl). SW의 `url.origin!==self.location.origin`(service-worker.js:32)은 캐시범위 가드로 데이터 무접촉·self.location 상대값이라 신도메인 자동 적응.

### 3. 전 모드(텍스트/그림책 1·2·3단계/무비/경험) — overall: ok
내비는 상대 파일명(`mobileTextBranch.js:2861`, `sceneRenderer.js:862`), 이미지·비디오는 data-URI 또는 Storage 절대 downloadURL(버킷 `picturebook-8731f` 고정), 콜러블은 SDK region 파생. `<base>` 태그·구 base-path 하드코딩 0. 라이브: sceneRenderer/viewer-render/viewer-ai/v03-modes.css 전부 200·바이트 일치.

### 4. 교사 관리 콘솔 — overall: ok
관리 액션 URL 전부 상대/location 파생. 관리 직접 콜러블 3종(adminResetAiUsage·adminResetPicturebookWork·teacherScriptDraft)은 **origin 게이트 없음**(auth+role/teacher_uid만)이라 이전 무관 — 라이브 OPTIONS 4종 204+신 origin 반사 확인. 공개토글·삭제·PIN·복사코드는 직접 RTDB write(도메인 무관). 감상링크 파생(`:2165`)이 이전 안전성의 핵심 패턴. **교사 Google 팝업 로그인**: `authDomain='picturebook-8731f.firebaseapp.com'` 불변, 라이브 identitytoolkit getProjectConfig→authorizedDomains에 `branchstory.co.kr`+`www` 둘 다 존재 확인(승인도메인 반영 라이브 확증).

### 5. 튜토리얼·온보딩 — overall: ok
환영/코치 dismiss는 per-origin localStorage라 신도메인서 1회 재노출되나 **에디터를 절대 막지 않는 fail-safe**(`tutorial-welcome.js:31` 예외→통과). 진짜 하드게이트인 **Level2 주인공 게이트**(`viewer-edit.js:6083-6089`)와 **나침반 게이트**(`thought-compass-gate.js:20-25`)는 localStorage가 아니라 **RTDB(viewer-meta/protagonistRef, compassState)를 정본**으로 삼아 이전 영향 0. 온보딩 삽화는 인라인 SVG(외부 fetch 없음). 라이브: 루트 200, 구 서브경로 404(정상).

### 6. 인증·세션 — overall: ok
setPersistence 없음(기본 LOCAL·per-origin) → 교사/학생 1회 재인증 필요(예상된 정상 UX, 데이터 손실 아님). Google/이메일 uid는 계정 고정 → teachers/{uid}·meta/teacher_uid 소유권 보존. 익명 학생은 신 uid 발급되나 PIN 재가입 시 members/{새uid} 재생성(scenes 무접촉). SINGLE-SESSION(`session.js:20-31`)은 same-origin localStorage 공유라 오탐 없음. FORCE-RELOAD(`notices.js:153-164`)는 RTDB 리스너 기반 도메인 무관.

### 7. 뷰어 진입·링크·복귀 — overall: ok
`_processQueryParam`(`viewer-entry.js:67-96`)는 location.search 상대 파싱, 복귀 내비는 상대 HTML(`:259,262,356`), branchReturnContext는 origin 스코프 localStorage라 교차 오염 불가. manifest start_url `./index.html`·scope `./`·SW register `./service-worker.js` 전부 상대. 라이브 6종+보조·`viewer.html?code=JL26A&team=0000` 전부 200.

### 8. Storage·이미지·인쇄 — overall: ok
`<img src>`는 Storage 절대 URL(CORS 불필요), 인쇄는 순수 `<img>` 렌더(toDataURL/getImageData 0건). 앱이 crossOrigin 속성을 **어디에도 안 씀** → cors.json 애초 불필요·이전으로 새로 요구되는 CORS 경로 없음. 기존 이미지 재편집 canvas taint는 pre-existing(양쪽 origin 모두 Storage가 cross-origin)이며 이미 try-catch 방어(`viewer-edit.js:8099`). Storage 규칙은 request.auth 기반(origin 무검사).

### 9. 라이브 자산 서빙 — overall: ok
루트 핵심 18종 전부 200. 리다이렉트: http→https·www→apex·구 `github.io/picturebook/`→신도메인 301 정상. `/picturebook/` 하드코딩 잔존 0(전부 모드명). 구 github.io는 롤백 안전용으로 ALLOWED_ORIGINS·리다이렉트 유지(`index.js:125-127`).

---

## 🧪 사람이 실제로 눌러 확인할 것 (needs-human-test)
코드·라이브 probe로는 부작용/과금 회피 때문에 "유효 인증 최종 호출"만 미실행. 아래는 **완결성 확인**이지 이전 리스크 아님(연습반 권장).

1. **AI 글·이미지 각 1건 실호출** — 무인증 probe는 auth(:456)가 origin(:504)보다 앞서 401로 끊겨 게이트 반응을 직접 못 봄. 신도메인 익명인증으로 텍스트 S1 1회·이미지 S2 1회 생성해 permission-denied(origin)이 아닌 정상/quota 응답 확인. (동일 게이트 joinTeamMembership이 라이브 입증되어 낮은 리스크)
2. **교사 Google 팝업 로그인 성공** — authorizedDomains는 라이브 확인됨. 실 OAuth 동의 라운드트립은 실계정 필요(이메일/비번 대체경로 있어 로그인 자체는 차단 불가).
3. **학생 재입장→작품 보존** — 신 익명 uid 발급 후 학급코드+팀명+PIN 재입력→members/{새uid} 재생성되고 기존 scenes/viewer-meta가 그대로 보이는지. (코드상 팀명 경로라 보존이나 members write 발생=미실행)
4. **그리기 저장** — 실기기 캔버스에서 그림 그려 Storage 업로드·재로드 확인(빈 캔버스 toDataURL은 taint 없음, 기존이미지 재편집은 pre-existing 동작).
5. **인쇄 1건** — 실 프린터로 그림책/입장카드 출력(코드는 `<img>` 렌더·@media print, 실제 용지 레이아웃은 프린터 의존).

---

## 💾 저장물 보존 결론
**데이터 손실 위험 없음.** 작품 정본(scenes/viewer-meta/aiVariants)·멤버십·학급 소유권은 전부 `picturebook-8731f` RTDB의 classId/팀명 경로(origin 무관·프로젝트 불변)에 보존됨. per-origin으로 초기화되는 것은 **임시 상태뿐** — makerSession(재로그인으로 재생성), branchReturnContext(내비), branch_device_id, 튜토리얼 dismiss 플래그, branchScriptDraftLast(로컬 편의캐시·정본 아님), 테스트 목스토어(LS_MOCK_*). 손실되는 건 "자동복귀 편의"와 UI 플래그이며 운영 데이터 0. 조건부 삭제 트리거(origin/domain/uid) 부재.

## 📋 튜토리얼·모드·교사관리 정상성 요약
- **튜토리얼**: 재노출 무해(fail-safe 통과), 하드게이트 2종은 RTDB 정본이라 정상 강제. ✅
- **전 모드**: 텍스트·그림책 1/2/3단계·무비·경험 렌더/저장/AI 전부 호스트 독립. ✅
- **교사관리**: 로그인·팀목록·공개토글·삭제·PIN·복사코드·레벨리셋·인쇄·책장/댓글 전부 상대경로/RTDB/불변 region. ✅

## 라이브 서빙 결과
- 신도메인 루트 핵심 18종 + 보조/자산 전부 **HTTP 200**(정상 content-type).
- 리다이렉트: `http→https` 301, `www→apex` 301, 구 `github.io/picturebook/`→신도메인 301 정상.
- 콜러블 OPTIONS 프리플라이트: `Origin:branchstory.co.kr`→**204 + `access-control-allow-origin: https://branchstory.co.kr`**. 무인증 POST→401 UNAUTHENTICATED(배포본 a6319fc 계열 확증).
- 신도메인 `/picturebook/index.html`→404(base 루트 이전으로 기대된 결과), 구 서브경로는 롤백용 301 유지.
