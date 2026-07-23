# branchstory.co.kr 커스텀 도메인 이전 계획 (준비용)

작성 2026-07-23. 현재 운영 = GitHub Pages `https://chang333787-boop.github.io/picturebook/`.
목표 = 커스텀 도메인 `https://branchstory.co.kr` (루트).

---

## 0. 한 줄 요약
**코드는 이미 도메인/서브경로 독립적**이라 옮겨도 대부분 그대로 동작한다. 실제 이전 작업은
**① 코드 1곳(functions `ALLOWED_ORIGINS`) + ② Firebase/GitHub 콘솔 설정 + ③ DNS** 뿐이다.
가장 위험한 건 **AI 오리진 차단**(아래 A) — 이것만 놓치면 새 도메인에서 AI가 전부 막힌다.

---

## 1. 이미 안전한 부분 (수정 불필요 — 확인만)
- **모든 링크 빌더**가 `location.origin + location.pathname` 상대 방식 → 루트/서브경로 무관하게 동작.
  (감상 링크·책장 링크·복귀 URL·maker/viewer 이동 전부. VIEW-LINK 친화 코드 링크 포함.)
- **PWA manifest**(`manifest.json`): `start_url:"./index.html"`, `scope:"./"`, 아이콘 상대경로 → 그대로.
- **서비스워커**: `navigator.serviceWorker.register('./service-worker.js', {scope:'./'})` + **network-only**
  (절대경로 precache 없음, `service-worker.js`) → 그대로.
- **OG/canonical 절대 URL 없음**, 클라이언트에 하드코딩된 앱 도메인 URL 없음.
- **authDomain**(`picturebook-8731f.firebaseapp.com`)은 Firebase 인증 핸들러 도메인 → **바꾸지 않는다**(앱 도메인과 무관).

---

## 2. 반드시 바꿀 것 (이전 시)

### A. functions `ALLOWED_ORIGINS` + 재배포  ⚠️ 최우선
- 파일: `functions/index.js` (`const ALLOWED_ORIGINS`, 현재 `'https://chang333787-boop.github.io'` 포함).
- 모든 AI 콜러블의 `_validateRequest`가 `isOriginAllowed(origin)`로 막음 → **목록에 없으면 "허용되지 않은 origin" permission-denied**로 AI(글·이미지·나침반·sourceMode·storyDraft) 전부 차단.
- 할 일: `'https://branchstory.co.kr'` (+ www 쓰면 `'https://www.branchstory.co.kr'`) 추가 → `firebase deploy --only functions`.
- **순서 팁**: DNS 바꾸기 **전에** 미리 추가·배포해도 안전(추가는 additive·github.io도 유지). 그럼 도메인 켜지는 순간 AI가 바로 됨.
- (이 파일에 주석으로 미리 넣어둠 — 이전 때 주석 해제 + 배포만.)

### B. Firebase Auth 승인 도메인 (콘솔)
- Firebase Console → Authentication → Settings → **Authorized domains** → `branchstory.co.kr` (+ www) 추가.
- 없으면 교사 구글 로그인이 `auth/unauthorized-domain`으로 실패. (코드 아님·콘솔 설정.) 참고=구글 승인도메인 이력.

### C. GitHub Pages 커스텀 도메인 + DNS
1. 저장소 Settings → Pages → **Custom domain**에 `branchstory.co.kr` 입력 → 루트에 `CNAME` 파일 생성됨(현재 없음).
2. **DNS**(.co.kr 등록기관):
   - Apex `branchstory.co.kr` → GitHub Pages **A 레코드 4개**: `185.199.108.153` / `.109.153` / `.110.153` / `.111.153` (AAAA/IPv6 선택). ⚠️ 최신 값은 docs.github.com "apex domain"에서 확인.
   - `www` → **CNAME** `chang333787-boop.github.io`.
3. Pages 설정에서 **Enforce HTTPS** 켜기(인증서 발급까지 최대 24h 대기 가능).

---

## 3. 확인 필요 (중간 위험 — 이전 후 실테스트)
- **Storage CORS**: 현재 `cors.json` 없음. `<img src>`는 CORS 불필요라 그림 표시는 OK. 단 **그리기(canvas)·인쇄가 Storage 이미지를 `fetch()`/`toDataURL`로 읽으면** 새 도메인에 대해 CORS 필요 → 필요 시 `gsutil cors set` 으로 `https://branchstory.co.kr` 허용. → 이전 후 **그리기·AI 이미지 마감·인쇄를 실제로 한 번** 돌려 확인.
- **설치된 PWA**: github.io에서 설치한 PWA는 그 origin에 묶임(리다이렉트로 열리긴 함) → 학생/교사에게 **새 도메인에서 재설치** 안내 권장.
- **이미 뿌린 링크**: 커스텀 도메인 설정 시 GitHub Pages가 옛 `github.io/picturebook/*`를 새 도메인으로 **자동 리다이렉트** → 학부모/학생이 받은 기존 링크는 계속 열림. 새로 만드는 `?code=` 링크는 교사가 접속한 도메인 기준으로 생성.

---

## 4. 권장 순서 (다운타임 최소)
1. 도메인 구입(branchstory.co.kr).
2. **A**(ALLOWED_ORIGINS 추가 + functions 배포) — 미리. github.io 유지되어 무해.
3. **B**(Auth 승인 도메인 추가) — 미리.
4. **C**(Pages 커스텀 도메인 + DNS) — DNS 전파 대기(수십 분~수 시간).
5. HTTPS 강제 켜기(인증서 대기).
6. **검증**: 새 도메인에서 ①교사 구글 로그인 ②학생 팀 입장 ③AI 글/이미지 ④그리기·인쇄 ⑤링크 감상(`?code=`)·책장 링크 전수.

## 5. 롤백
- DNS를 되돌리면(또는 Pages 커스텀 도메인 해제) 즉시 github.io로 복귀.
- `ALLOWED_ORIGINS`는 additive(github.io 유지)라 롤백해도 AI 안 깨짐 — 안전.

---
_상세 근거: 링크 기능=`project_branch_link_viewer.md`. 이 문서는 도메인 이전 단일 출처._
