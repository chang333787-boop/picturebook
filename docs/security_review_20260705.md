# 가지(branch) 보안 검토 — Phase별 (2026-07-05)

- 기준: origin/main `1a68493` · 목적: 마감 전 노출면 점검 · **분석 전용(수정 0)**
- 결론 요약: **당장 서비스가 뚫리는 취약점은 없음.** 다만 사용자가 "공개하고 싶지 않다"는
  의도와 **현재 GitHub 공개 상태가 정면 충돌**하고, 공개 repo에 **실제 학급 ID·수업 산출물이
  포함**돼 있음. 이 둘이 이번 검토의 최우선 사항.

---

## Phase 1 — GitHub 공개 여부 (사용자 최우선 관심)

### 판정: ⚠️ **현재 PUBLIC (공개)**
```
gh api repos/chang333787-boop/picturebook → { "private": false, "visibility": "public" }
```
- 누구나 `github.com/chang333787-boop/picturebook`에서 전체 소스·문서·커밋 700개·수업자료를 봄.
- **사용자 의도(비공개)와 불일치 → 결정 필요.**

### 비공개 전환 시 트레이드오프 (중요)
현재 운영 사이트는 **GitHub Pages**(`chang333787-boop.github.io/picturebook`)로 서빙됨.
- **GitHub Free 플랜**: repo를 private으로 바꾸면 **Pages가 중단됨**(비공개 repo Pages는 Pro/Team 필요).
  → 그냥 private 전환하면 **실서비스가 내려감.**
- 선택지:
  - **(A) repo private + Pages 유지** → GitHub Pro($4/월) 필요. 가장 단순.
  - **(B) 코드 repo는 private, 배포는 별도** → Cloudflare Pages/Netlify/Firebase Hosting 등
    private repo 연동 무료 호스팅으로 이전. 도메인·SW·경로 재점검 필요.
  - **(C) 공개 유지하되 민감물만 제거**(Phase 2) → 코드 자체 공개는 감수. 가장 저렴.
- ※ **주의**: private로 바꿔도 **이미 공개됐던 커밋은 포크/캐시/검색엔진에 남을 수 있음.**
  민감정보(아래 Phase 2)는 private 전환과 **무관하게 값을 무효화**해야 진짜 해결됨.

---

## Phase 2 — 공개 repo에 담긴 민감 데이터 (실질 위험)

### 2-1. 🔴 실제 학급 ID + 수업 산출물 노출
- `class_2026_junglim_1` 이 **17개 파일**에 하드코딩(코드·docs·lesson-materials).
  - 특히 `lesson-materials/숲속의-비밀-2026-05/` 7개 파일 = **실제 학생 작품 전문**
    (`/classes/class_2026_junglim_1/teams/0000` 원본, 21장면 스토리·캐릭터·이미지 프롬프트).
  - classId에 기관 추정 문자열("junglim")·연도 포함 → 어느 학교/학급인지 추론 가능.
- 위험: 이 classId를 알면, **공개 read가 허용된 노드**(Phase 3 참조)를 직접 조회 가능
  (팀 이름·설정 등). 학생 창작물이 동의 없이 공개돼 있는 것 자체가 개인정보/저작 이슈.
- 조치안: lesson-materials·실ID 문서를 git에서 제거(`git rm` + 히스토리 정리는 선택),
  코드 내 예시는 `class_demo` 등 더미로. **단순 삭제만으론 히스토리에 남음** → 민감도 높으면
  `git filter-repo`로 히스토리 제거 + force push(협업자 없으면 안전).

### 2-2. 🟢 Firebase apiKey 노출 — **정상 (문제 아님)**
- `firebase.js:29`·`teacher-auth.html:352`에 `AIzaSy...McmE` 평문. F12로도 보임.
- **이것은 설계상 공개값이다.** Firebase 웹 apiKey는 비밀이 아니라 "프로젝트 식별자"이며,
  실제 보호는 **Security Rules + Auth**가 담당. 구글 공식 문서도 클라 노출을 전제로 함.
- 안심해도 되는 근거: 이 키만으로는 rules를 우회 못 함. 아래 Phase 3에서 rules가 실제 방벽.
- (선택) 방어심화: Firebase Console에서 apiKey에 **HTTP 리퍼러 제한**(우리 도메인만) 걸면
  타 사이트에서의 오용을 더 줄일 수 있음.

### 2-3. 🟢 Anthropic/OpenAI API 키 — **미노출 확인 (양호)**
- 전 히스토리 스캔: `sk-ant-`·`sk-proj-`·private key 실제 값 **0건**.
- 서버 비밀은 `functions/.env` + `defineSecret().value()`로 주입, `.gitignore`가 `**/.env`·
  adminsdk json·secrets 패턴을 이중 차단. env/서비스계정 파일은 **한 번도 커밋된 적 없음**.
- 문서에 보이는 `sk-ant-api03-XXX...`는 전부 **플레이스홀더**(실값 아님).
- ✅ 이 부분은 잘 관리됨.

---

## Phase 3 — F12(브라우저 개발자도구)로 알 수 있는 것

정적 사이트라 **클라이언트 코드 전체는 원래 다 보인다**(소스 공개 여부와 무관). 관건은
"코드가 보여도 데이터가 안 뚫리느냐". 실제 rules를 대조한 결과:

### 3-1. 코드/구조는 다 보임 (불가피·정상)
- JS 전체 로직, DB 경로 구조(`classes/{id}/teams/{team}/...`), 콜러블 8종 이름
  (callTextAiBatch·joinTeamMembership 등), Firebase 프로젝트 ID. → **이것만으론 무해.**

### 3-2. 인증 없이 읽히는 노드 (`.read: true`) — 검토 결과
| 노드 | 공개 read | 평가 |
|---|---|---|
| `classCodes` | ✅ 전체 | ⚠️ **클래스 코드 열거 가능**. 코드→classId 매핑이 통째 공개. 낮음~중간(코드만으론 입장 못 함, 팀+PIN 필요하나 정찰 정보 제공) |
| `classes/{id}/settings`·`aiSettings` | ✅ | 입장 폼이 모드 판별에 필요 → 의도적. 민감도 낮음 |
| `aiVariants`·`aiDrafts`·`branchLineage`·`aiPermission` | ✅ | AI 생성 이미지/텍스트 결과. **classId+team 알면 남의 작품 AI본 열람 가능**. 중간 |
| `teams/{team}/onboarding`·`aiChecks` | 🔒 멤버/교사만 | 양호(최근 aiChecks 강화 배포됨) |
| `admin`·`ai-usage*`·`ai-kill-switch` | ❌ false | 양호 |

### 3-3. 🟢 PIN은 F12로 안 보임 — **양호**
- `account.pin` read는 **교사/super_admin만**(rules 46-58). 학생 권한으론 조회 불가.
- PIN 검증은 클라가 아니라 **서버 콜러블**(`joinTeamMembership`)에서 수행 → 평문 비교지만
  클라에 노출 안 됨. 세션에도 PIN 미저장(SEC-5). ✅

### 3-4. 🟡 Storage 이미지 = 전면 공개 read
- `storage.rules`: `/images/**` `read: if true` → **URL만 알면 누구나 학생 그림 다운로드.**
- 감상 공유 위해 의도된 설계지만, URL이 추측 어려운 무작위여도 aiVariants/scenes(공개 read)에
  URL이 들어있어 **classId+team으로 이미지 URL 수집 가능.** 중간(작품 공개 정책과 연동해 판단).

---

## Phase 4 — 데이터 쓰기(변조) 통제

- 🔴 **기지의 Critical(의도적 보류)**: `scenes`·`viewer-meta` write=`auth != null`
  → 익명 로그인한 누구나 **임의 학급/팀 작품을 수정**할 수 있음. 남의 작품 변조·isPublic 조작 가능.
  - 왜 안 고쳤나: legacy 팀 저장이 member-scoped로 조이는 순간 깨져서. `SCENES-WRITE-RULES-HARDEN-1`로
    membership 백필 후 원자 배포 예정(마지막·별도 승인). **이번에도 유지.**
  - ⚠️ 공개 상태에서는 이 구멍의 악용 난이도가 더 낮아짐(코드·경로가 다 보임) → private 전환 또는
    HARDEN-1 우선순위 상향의 근거가 됨.
- 🟢 나머지 write는 대체로 견고: account/pin/settings=교사만, members=`false`(서버만),
  aiVariants/aiChecks=`false`(서버만), classCodes/teacherClasses=소유 교사+생성 시 1회.
- 🟢 콜러블: origin allowlist + 11단 권한/quota/safety 게이트. (단 `isOriginAllowed` 빈배열
  fail-open 1줄은 다음 deploy 때 제거 예정=기보고 C2.)

---

## 우선순위 정리

| 순위 | 항목 | 성격 | 조치 난이도 |
|---|---|---|---|
| 1 | GitHub 공개 상태 결정(Phase 1) | 사용자 의도 | 정책 결정 필요 |
| 2 | 실 classId·학생 작품 노출(2-1) | 개인정보 | 중(파일 제거 + 히스토리 판단) |
| 3 | scenes/viewer-meta write 개방(Phase 4) | 변조 | 높(HARDEN-1·별도 승인) |
| 4 | Storage/aiVariants 공개 read(3-2,3-4) | 열람 | 중(작품 공개 정책과 함께) |
| 5 | classCode 열거(3-2) | 정찰 | 낮(수용 가능·모니터링) |
| — | apiKey·서버키(2-2,2-3) | — | ✅ 조치 불요 |

### 안심해도 되는 것 (사용자 질문 직답)
- **"F12로 정보 다 보이는 거 아닌지?"** → 코드·구조는 보이지만, **PIN·서버키·교사 전용 데이터는
  rules가 막아 안 보임.** 보이는 데이터는 대부분 "감상 공유용 공개 작품" 범위.
- **"apiKey 깃허브 노출 아닌지?"** → Firebase apiKey는 노출돼도 되는 공개값(비밀 아님).
  진짜 비밀인 Anthropic/OpenAI 키·서비스계정은 **한 번도 커밋 안 됨(확인 완료).**
- **"공개/비공개?"** → **현재 공개.** 비공개로 바꾸려면 Pages 호스팅 대안이 필요(Phase 1 A/B/C).

## 검증 기록
- `gh api repos/.../` 가시성 · 전 히스토리(700커밋) 비밀 패턴 grep · `.gitignore` 전문 ·
  database.rules.json 전 노드 read/write 대조 · storage.rules 전문 · lesson-materials 원본 확인.
- 분석 전용 — 코드·rules·repo 설정 **변경 0**.
