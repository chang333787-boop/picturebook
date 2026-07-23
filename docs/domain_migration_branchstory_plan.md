<!-- 울트라코드 전수 감사(13차원·37에이전트·106건 검증) 기반. 이전 단일 출처. -->

# branchstory.co.kr 이전 런북 (전수 감사판)

> 대상 전환: `https://chang333787-boop.github.io/picturebook/` (프로젝트 서브경로) → `https://branchstory.co.kr` (커스텀 도메인 루트)
> Firebase 프로젝트(`picturebook-8731f`)·RTDB·Storage·Functions region(`asia-northeast3`)은 **모두 그대로 유지**. 데이터 손실 없음.
> 핵심 결론: **코드에서 실제로 손댈 곳은 `functions/index.js`의 origin 허용목록 2줄뿐**이다. 나머지 앱 경로는 전부 상대경로/동적 origin이라 자동 적응한다. 진짜 위험은 (1) 서버 origin 허용목록, (2) Firebase Auth 승인 도메인, (3) DNS/커스텀 도메인 바인딩 세 곳에 집중된다.

---

## 0. 한눈에 보는 위험 지도

| # | 조치 | severity | 분류 | 근거 |
|---|------|----------|------|------|
| 1 | `functions/index.js:129-130` 주석 해제 + functions 재배포 | 🔴 **BLOCKER** | [A] 코드 | 5개 origin 게이트 = AI 전체 + 팀입장 마비 |
| 2 | Firebase Auth 승인 도메인에 신도메인 추가 | 🟠 high | [B] 콘솔 | 교사 Google 로그인 차단 |
| 3 | DNS 레코드(apex A 4개 + www CNAME) 설정 | 🟠 high | [C] DNS | 신도메인 미해석 = 이전 불성립 |
| 4 | GitHub Pages 커스텀 도메인 지정(CNAME 자동 생성) | 🟠 high | [B] 콘솔 | 신도메인 미서빙 = 이전 불성립 |
| 5 | 재로그인/재입장 사전 공지 | 🟡 low | [E] 공지 | per-origin 세션 단절(자가치유) |

---

## [A] 코드 변경 (배포 필요)

### 🔴 A-1 [BLOCKER] 서버 origin 허용목록 — `functions/index.js:119-137`

**증상:** `ALLOWED_ORIGINS` 배열에서 신도메인 2줄(`:129-130`)이 주석 처리되어 있고, 활성 운영 origin은 `'https://chang333787-boop.github.io'`(`:125`) 하나뿐이다. `isOriginAllowed()`(`:139-144`)는 fail-safe(목록에 없으면 무조건 거부, 와일드카드 없음, FINAL-REVIEW-C2로 fail-open 제거됨). 신도메인에서 브라우저가 보내는 `Origin: https://branchstory.co.kr` 헤더가 목록에 없어 **모든 origin-검사 콜러블이 `permission-denied`**.

**이 한 곳이 게이트하는 5개 지점(단일 수정으로 전부 해소):**
- `_validateRequest`(`:450`, 검사 `:506`) 경유 **AI 콜러블 12개** — callTextAiBatch(`:1536`)·callTextAiBatchS2(`:1763`)·callWorkCheck(`:1850`)·callWriteAfterQuestions(`:2014`)·saveTextVariant(`:2139`)·callImageAiS1(`:2362`)·callImageAiS2(`:2522`)·callStartImageS2Batch(`:2612`)·callApplyImageS2Selection(`:2650`)·callApplyTextS2Selection(`:2699`)·studentStoryDraft(`:3279`)·generateStoryImages(`:3506`)
- `_validateSourceModeRequest`(`:2762`) — sourceMode 잠금/해제 3종(lock `:2803`·reset `:2882`·clear `:2930`), **AI OFF 학급에서도 동작해야 하는 기능**
- `joinTeamMembership`(`:3974`) — **학생 PIN 모둠 가입(비-AI 핵심 동선)**
- `callThoughtCompassFollowUp`(`:4141`) — 나침반 후속질문
- `compassValueCandidates`(`:4251`) — 나침반 가치 3택1

**정확한 diff:**
```
// functions/index.js 라인 129-130 — 주석(/* */) 제거
'https://branchstory.co.kr',
'https://www.branchstory.co.kr',
```
- `:125`의 `'https://chang333787-boop.github.io'`는 **삭제하지 말 것**(롤백·github.io 301 리다이렉트 병행 접속 안전).
- apex/www 어느 쪽으로 서빙되든 Origin 헤더가 달라질 수 있으므로 **둘 다** 넣는다(문자열 정확일치라 별개 항목).
- ⚠️ 이것은 HTTP Origin 헤더(scheme+host) 검사다. BASE PATH 변경(`/picturebook/`→`/`)과 **무관**하며, "상대경로라 안전" 예외에 해당하지 않는다.

**배포:** `firebase deploy --only functions` (스크립트: `functions/package.json:14`. region `asia-northeast3` 유지)

**성공 판정:** 신도메인에서 텍스트1·이미지S2 등 AI 1건 + 학생 PIN 입장 1건이 `permission-denied` 없이 성공 반환.

**참고 — origin 게이트가 없어 안 깨지는 콜러블(무조치):** adminResetAiUsage·adminResetPicturebookWork·teacherScriptDraft·teacherCloneTeamFull·getClassShelf·postWorkComment (auth/role만 검사).

---

## [B] 콘솔 설정 (Firebase / GitHub)

### 🟠 B-1 [high] Firebase Auth 승인 도메인 — 교사 Google 로그인
- **증상:** `teacher-auth.html:514` `signInWithPopup(googleProvider)`. `authDomain`(`picturebook-8731f.firebaseapp.com`, `firebase.js:30`·`viewer-data.js:14`·`teacher-auth.html:359`)은 프로젝트 고정값이라 **불변**이지만, 승인 도메인 검사는 앱의 **서빙 origin**을 대조한다. 신도메인 미등록 시 `auth/unauthorized-domain`으로 교사 Google 로그인 실패(앱이 이미 `teacher-auth.html:749`에 이 에러 한글 안내 보유 = 위험 코드로 확인됨).
- **조치:** Firebase Console → Authentication → Settings → **승인된 도메인**에 `branchstory.co.kr`(및 `www.branchstory.co.kr`) 추가. 기존 `chang333787-boop.github.io`는 유지(롤백/과도기).
- **코드 수정 금지:** `authDomain` 문자열은 그대로 둔다(바꾸면 OAuth가 깨짐).
- **완화:** 이메일/비번 로그인(`signInWithEmailAndPassword`)·학생 익명 로그인은 승인 도메인 무관 → 전체 잠금은 아님.
- **성공 판정:** 신도메인에서 교사 Google 로그인 팝업이 `unauthorized-domain` 없이 완료.

### 🟠 B-2 [high] GitHub Pages 커스텀 도메인 지정
- **증상:** 리포·git 히스토리 어디에도 `CNAME` 파일 없음(미설정). 설정 없이는 `branchstory.co.kr` 자체가 서빙되지 않는다. `.github/workflows` 없음 → "Deploy from a branch(main)" 모드.
- **조치:** 리포(`chang333787-boop/picturebook`) Settings → Pages → Custom domain에 `branchstory.co.kr` 입력·저장(GitHub가 main 루트에 `CNAME` 자동 커밋). DNS 검증 통과 후 **Enforce HTTPS** 체크.
- **성공 판정:** `https://branchstory.co.kr/` 루트가 앱을 서빙하고 HTTPS 인증서 발급 완료.

### 🟡 B-3 [low·선택] Auth 이메일 템플릿 확인
- `teacher-auth.html:534` `sendPasswordResetEmail`은 `actionCodeSettings/continueUrl` 미지정 → authDomain 핸들러에서 처리되어 이전 무관. Console → Authentication → Templates에 구 도메인이 하드코딩돼 있지 않은지 1회 확인만.

---

## [C] DNS

### 🟠 C-1 [high] 레코드 설정 (등록기관 작업 — 이 감사에서 수행 불가)
- **apex** `branchstory.co.kr` → GitHub Pages A 레코드 4개: `185.199.108.153` / `185.199.109.153` / `185.199.110.153` / `185.199.111.153` (또는 ALIAS/ANAME)
- **www** `www.branchstory.co.kr` → CNAME `chang333787-boop.github.io`
- **성공 판정:** 전파 후 GitHub Pages 도메인 검증 통과.

---

## [D] 이전 후 실테스트 확인 (신도메인에서 1회씩)

| 항목 | 확인 내용 | 근거 |
|------|-----------|------|
| AI 콜러블 | 텍스트1·2·작품검사·이어쓰기질문·변형저장·이미지S1/S2·배치·학생초안·그림책마감 각 성공 | A-1 |
| 팀 입장 | 학생 익명 계정 PIN 모둠 가입 → membership active 재생성 | `joinTeamMembership :3974` |
| 나침반 | 후속질문·가치후보 각 1건 (실패 시 silent 저하) | `:4141`, `:4251` |
| sourceMode | 이미지 입력방식 잠금/해제 (AI OFF 학급 포함) | `:2762` |
| 교사 로그인 | Google 팝업 + 이메일/비번 각 성공, 동일 UID로 기존 학급 진입 | B-1 |
| 학생 재입장 | 기존 팀명으로 재입장 시 이전 scenes 그대로 표시 + 저장/편집 정상 | `firebase.js:290-295`(팀명 경로라 작품 보존) |
| 그리기 재저장 ⚠️ | 기존 그림 위 그리고 저장 1회 — canvas taint로 깨지지 않는지 육안 | `viewer-edit.js:7949/8585` (pre-existing, 아래 참조) |
| 공유 링크 | 관리모드 "접속 주소"·책장/감상 링크가 `https://branchstory.co.kr/...`로 표시 | `adminConsole.js:1267/1987/2165` (동적 파생) |
| PWA | 신도메인 첫 로드 시 SW 재등록 + scope=`/` + 설치 프롬프트 정상 | `manifest.json:5-6`, `service-worker.js:32` |
| 세션 왕복 | 같은 기기에서 브랜치↔다듬기 왕복 시 세션 인수 confirm 불필요하게 안 뜸 | `branch_device_id` per-origin 재생성 |

**⚠️ 그리기 canvas taint 주의(`viewer-edit.js:7949`):** Storage 이미지를 `crossOrigin` 없이 배경으로 깔고 `getImageData`/`toDataURL`한다. 이 taint는 **origin 변경으로 새로 생기지 않는 pre-existing 상태**(github.io에서도 동일, Storage는 양쪽 다 cross-origin)라 이전이 원인이 아니다. 만약 저장이 깨진다면 처방은 버킷 `cors.json`만으로 **불충분** — `Image`에 `crossOrigin='anonymous'` + 버킷 CORS 둘 다 필요(별도 이슈). 선제적 CORS 설정은 불필요.

---

## [E] 사용자 커뮤니케이션 (사전 공지)

핵심: **데이터 손실 0**. Firebase Auth 세션·localStorage·익명 UID는 브라우저 origin별 격리라 신도메인에서 초기화되지만 모두 자가치유된다.

- **교사:** "새 주소 `branchstory.co.kr`에서 최초 1회 다시 로그인." 같은 이메일/Google 계정이면 UID 동일 → **기존 학급·작품 그대로 유지**(소유권 상실 아님). `firebase.js:37`(setPersistence 없음 = 기본 LOCAL, 어떤 코드로도 origin 넘는 세션 보존 불가).
- **학생:** "같은 코드·모둠 이름·PIN으로 재입장." 새 익명 UID 발급되나 membership 재생성 + scenes 보존.
- **전환 타이밍:** 수업 진행 중 전환 금지 — 활동 중 학생이 재로그인 화면으로 떨어질 수 있음. **쉬는 시간/수업 사이**에 전환.
- **WRITE-AFTER 3단계(선택 공지):** 쓰기후활동 진행 중이던 반은 신도메인에서 3단계가 잠겨 보이면 [모두 고쳤어요] 한 번 더. 기기별 마커(`viewer-ai.js:4420`), 화면 안내문이 이미 자가안내.
- **경미 재노출(무해):** 튜토리얼/코치마크 1회 재노출(`tutorial-welcome.js:34`), 대본 초안 자동복원 카드 미표시(`ui.js:1930`) — 작품 데이터 무관.
- **기존 PWA:** 구 origin에 설치된 앱은 별개 신원. "새 주소에서 다시 홈화면에 추가" 안내(github.io는 커스텀 도메인으로 리다이렉트되나 신원/scope는 구 origin 유지).
- **선택:** 브랜드 통일 시 지원 이메일(`privacy.html:315` `branch.story.support@gmail.com`) 교체 여부 판단.

---

## [F] 확인됨 — 무조치 (안전 근거)

이전으로 **깨지지 않음**이 코드로 확인된 지점. 놓치지 말고 명시:

- **모든 내부 경로·네비·자산 = 상대경로** → 서브경로/루트 양쪽에서 동일 해석. HTML `<script src>`·`<link>`·favicon·manifest(`index.html:14-16` 등), 페이지 네비(`ui.js:1559/1591/1775`·`branch.html`·`viewer-entry.js` 등 leading-slash 0건), 인라인 이미지(`viewer-edit.js:6061` `assets/...`), `branch.html:8` meta refresh(`url=index.html`).
- **하드코딩 base path `/picturebook/` 라이브 코드 0건** — grep 히트는 전부 작품 '모드' 이름(text/picturebook/movie) 주석.
- **Service Worker = network-only + `self.location.origin` 동적 비교**(`service-worker.js:32`). CacheStorage 미사용(precache/버전 bump 불필요). 신 origin에서 새 scope(`/`)로 자동 재등록. 이전에 가장 유리한 구조.
- **PWA manifest 전 필드 상대**(`manifest.json:5-6`, `start_url './index.html'`·`scope './'`·icons). scope 자동 재계산. `id` 미지정이라 origin 바뀌면 어차피 별개 설치.
- **공유/책장/감상 링크 = `location.origin + location.pathname` 동적**(`adminConsole.js:1267/1987/2165`) → 신도메인 자동 반영. 입장 카드(`:1489`)엔 URL 없음. QR 생성 로직·robots/sitemap 없음.
- **Firebase config = 프로젝트 종속 불변**(`firebase.js:28-35`·`viewer-data.js`·`teacher-auth.html:357-363`): authDomain·databaseURL·storageBucket·projectId·appId. `.firebaserc` `picturebook-8731f`. region `asia-northeast3`(서버·클라 일치). **손대지 말 것.**
- **Storage/서드파티 URL = 앱 도메인 아님**: `api.openai.com`(`image-s2-adapter-openai.js:18`), SSRF 가드 `ALLOWED_SOURCE_HOSTS`(firebasestorage/storage.googleapis.com), fonts/jsdelivr preconnect. 이전 무관.
- **인쇄 = 순수 `<img src>`**(`picturebook-print.js:247/332`), canvas 판독 없음 → CORS 불필요. mediaManager 압축(`:59`)은 로컬 data: URL(same-origin).
- **CSP/OG/canonical/`<base>` 전부 부재**(프로덕션 grep 0건) → connect-src/img-src 차단 없음, 갱신할 절대 URL head 태그 없음. `firebase.json`에 hosting 키 없음(GitHub Pages).
- **App Check `enforceAppCheck:false`**(`:1532` 등) — reCAPTCHA/도메인 바운드 키 재등록 불필요.
- **sessionStorage 전 키 = 탭 스코프 휘발**(`firebase.js:658` makerSession 등) → 이전으로 잃는 영구 상태 없음.
- **AI 텍스트 오버레이 localStorage = 임시 캐시**(`viewer-ai.js:1281` "Firebase 정본") → 손실 무해.
- **`_isTestMode()` = URL 쿼리 전용**(`viewer-ai.js:80`, `?test=1`/`?realApi=1`), host 판정 없음 → mock/실API 오분류 없음.
- **RTDB 노드 경로**(`db.ref('.../scenes')` 등) = URL 아님. postMessage/opener origin 핸드셰이크 코드 없음(RETURN-NOCLOSE로 제거).

---

## 권장 실행 순서 (다운타임 최소·AI 무중단)

> 원리: **구 origin(github.io)을 끝까지 살려둔 채** 신 origin 사전 허용 → 전환 → 검증 → 필요 시 즉시 롤백. Functions 재배포와 콘솔 설정을 **DNS 컷오버 전에** 끝내면 신도메인 라이브 순간부터 AI가 즉시 통과한다.

**1단계 — 서버 origin 사전 허용 (무중단)**
- 무엇: `functions/index.js:129-130` 주석 해제(A-1). `:125` github.io 유지.
- 명령: `firebase deploy --only functions`
- 판정: 배포 성공 로그. **github.io가 목록에 남아 구도메인 영향 0** → 지금 서비스 무중단.
- 롤백: `:129-130` 재주석 후 재배포(구도메인은 계속 정상).

**2단계 — Firebase 승인 도메인 사전 추가 (무중단)**
- 무엇: Console → Auth → Settings → 승인 도메인에 `branchstory.co.kr` + `www` 추가(B-1). github.io 유지.
- 판정: 목록에 신도메인 표시. 구도메인 로그인 계속 정상.
- 롤백: 신도메인 항목 제거(무영향).

**3단계 — DNS 레코드 설정 (등록기관)**
- 무엇: apex A 4개 + www CNAME(C-1). 아직 GitHub Pages 커스텀 도메인 미지정이라 신도메인은 아직 앱을 서빙하지 않음(구도메인 무중단).
- 판정: `dig branchstory.co.kr` A 레코드 반환.

**4단계 — GitHub Pages 커스텀 도메인 바인딩**
- 무엇: Settings → Pages → Custom domain = `branchstory.co.kr` 저장(B-2, CNAME 자동 커밋).
- 판정: GitHub 도메인 검증 ✓. HTTPS 인증서 발급 대기(수 분~최대 24h 가능).
- ⚠️ 인증서 발급 완료 전 **Enforce HTTPS 체크 금지**(발급 후 체크).
- 롤백: Custom domain 필드 비우기 → `github.io/picturebook/`로 즉시 복귀(1·2단계가 github.io 유지했으므로 완전 정상).

**5단계 — HTTPS 확정**
- 무엇: 인증서 발급 확인 후 **Enforce HTTPS** 체크.
- 판정: `https://branchstory.co.kr/` 자물쇠 정상.

**6단계 — 신도메인 스모크 테스트**
- [D] 표 전 항목 각 1회. 특히 순서: (a) 학생 PIN 입장 → (b) 교사 Google/이메일 로그인 → (c) AI 텍스트+이미지 → (d) 나침반·sourceMode → (e) 그리기 재저장 → (f) 공유 링크 도메인 → (g) PWA 설치 scope.
- 실패 시 롤백: 4단계 커스텀 도메인 해제(구도메인 즉시 복귀).

**7단계 — 사용자 공지 배포**
- [E] 문구. 수업 사이 시간대에 전환 완료 후 발송.

**8단계 — 안정화 후(선택)**
- github.io 리다이렉트·구 세션 이월이 없음을 며칠 관찰 후, 원하면 `service-worker.js:3-5`·`index.html:211`의 "GitHub Pages 서브패스" stale 주석 정리. **allowlist·승인도메인의 github.io 항목은 당분간 유지**(구 링크 301 리다이렉트 안전).

---

## 완전성 점검 (정석 체크리스트 대조 — 감사가 놓쳤을 수 있는 항목)

- ✅ **apex + www 둘 다** origin 허용목록·승인 도메인에 등록 — 어느 쪽으로 서빙될지 확정 전이면 방어적으로 둘 다(정확일치라 별개 문자열).
- ⚠️ **HTTPS 인증서 발급 대기** — GitHub Pages 커스텀 도메인 첫 바인딩 후 인증서 프로비저닝에 시간이 걸린다. 이 사이 Enforce HTTPS 체크하면 접속 불가 구간 발생 가능 → 발급 확인 후 체크.
- ✅ **Functions 재배포 = DNS 컷오버 전 선행** — github.io가 목록에 남아 선배포해도 구도메인 무영향. 신도메인 라이브 즉시 AI 통과.
- ✅ **구 github.io 링크 301 리다이렉트** — 커스텀 도메인 설정 시 자동 리다이렉트. 이미 배부된 공유/책장/감상 링크·PWA는 계속 열림(단 PWA 신원은 구 origin 유지 → 재설치 권장).
- ✅ **RTDB/Storage 보안 규칙은 도메인 무관** — 규칙은 auth/경로 기반이라 이전 조치 불필요. `firebase.json`에 hosting 키 없음(Storage CORS `cors.json`도 없음, 선제 설정 불필요).
- ✅ **Google Cloud OAuth 클라이언트 redirect URI 수정 불필요** — `authDomain`(firebaseapp.com)이 불변이라 redirect URI도 불변. 승인 도메인 추가만으로 충분.
- ✅ **PWA 재설치 안내** — 구 origin 설치 앱은 별개. 공지에 포함(E).
- ✅ **DNS 전파 지연** — 전파 전까지 신도메인 미해석. 구도메인 유지로 무중단 커버.
- ✅ **App Check/reCAPTCHA 도메인 키 재등록 불필요** — 비활성(`enforceAppCheck:false`).
- ⚠️ **그리기 canvas taint** — cors.json만으로는 안 열림. pre-existing이나 이전 직후 육안 확인 대상(D).

---

## 검증에서 제외된 오탐

- **`adminConsole.js:2165` (dimension `url-builders`, what/evidence/action="test")** — 실데이터가 아닌 **테스트 스텁 항목**. 유효 근거 없음(같은 `:2165` 공유링크 로직은 [F]에서 안전 확인 완료).
- (별도 confirmed=false로 기각된 항목은 원본 JSON에 없음 — 전 항목 confirmed=true. 단 다수가 `medium→low`로 severity 하향 교정되었고, 본문에는 교정 severity를 반영함: viewer-data.js:28 세션 이월(medium→low), firebase.js:37 persistence(high→low), firebase.js:566 학생 membership(high→low), host-branching per-origin(medium→low), WRITE-AFTER 게이트(medium→low).)
