# 가지 AI — Phase A 사용자 준비 체크리스트 (2026-05-21)

> 시점: 2026-05-21
> 위치: `/Users/dobuk/Downloads/picturebook-repo/AI_PHASE_A_USER_PREP_CHECKLIST.md`
> 상태: **체크리스트 박음 — 코드 X / API key X / Anthropic 연결 X (사용자 명시)**
> 의존: `AI_COST_GUARD_PLAN.md` / `AI_APP_CHECK_ANALYSIS.md` / `AI_SAFETY_COST_RULES.md`

---

# 0. 이 문서의 역할

Phase A 실 API 박기 전 **사용자가 직접 박을 거** 5 항목 박은 거 박은 거 박은 박은 단계별 절차 + 안전 박음. Claude는 코드 박지 X — 사용자가 박을 때 박은 거 박은 거 박은 박은 박은 거 박은 거 박은 박은.

---

# ⚠️ 최상단 — 절대 박지 X (가장 중요)

| 박지 X | 박힌 이유 |
|---|---|
| ❌ API key 박은 거 박은 거 박은 박은 **채팅창 박지 X** | Claude 박은 거 박은 거 박은 박은 박은 거 박은 거 박은 박은 — 로그 박을 가능성. 박은 후 박은 거 박은 거 박은 박은 박지 X |
| ❌ API key 박은 거 박은 거 박은 박은 **GitHub repo 박지 X** | public 박지 X / private 박지 X — secret scan 박을 가능성 |
| ❌ API key 박은 거 박은 거 박은 박은 **client JS 박지 X** | 브라우저 박은 거 박은 거 박은 박은 — 누구나 박음 |
| ❌ API key 박은 거 박은 거 박은 박은 **HTML 박지 X** | 동상 |
| ❌ API key 박은 거 박은 거 박은 박은 **localStorage 박지 X** | 동상 |
| ❌ API key 박은 거 박은 거 박은 박은 **Firebase Realtime DB 박지 X** | rules 박혀있어도 — 사고 박을 가능성 |
| ❌ API key 박은 거 박은 거 박은 박은 **Firebase Storage 박지 X** | 동상 |
| ❌ API key 박은 거 박은 거 박은 박은 **이메일 / Slack / Notion 박지 X** | 박을 곳 박은 거 박은 거 박은 박은 박은 거 박은 거 박은 박은 — 1Password / 본인 PC functions/.env 박은 거 박은 거 박은 박은 |

박을 위치 (사용자 직접):
- ✅ **`functions/.env`** 로컬 박은 거 박은 거 박은 박은 (gitignore 박혀있어야)
- ✅ **`firebase functions:config:set anthropic.api_key="..."`** Firebase secrets
- ✅ **본인 비밀번호 관리자** (1Password / Bitwarden 등) 백업용

---

# 1. Anthropic 콘솔 월 한도 $20 설정 (사용자 직접)

## 1-1. 박는 절차

| 단계 | 박을 거 |
|---|---|
| 1 | https://console.anthropic.com 박음 |
| 2 | 좌측 메뉴 **Settings** → **Limits** (또는 **Billing → Spend limits**) |
| 3 | **Monthly spend limit** = **$20** 박음 |
| 4 | **Alert threshold** = **$10** (50%) 박음 — 이메일 알림 |
| 5 | 저장 |
| 6 | 박힌 화면 캡처 박음 (사용자 본인 박은 거 박은 거 박은 박은 보관) |

## 1-2. 박힌 거 박은 거 박은 박은 확인

- [ ] Monthly spend limit $20 박힘
- [ ] Alert threshold $10 박힘
- [ ] 알림 이메일 주소 박힘 (사용자 본인 박은 거 박은 거 박은 박은 박음)
- [ ] 화면 캡처 저장 박음

## 1-3. 박지 X 박혀있으면 위험

- Anthropic 측 박은 거 박은 거 박은 박은 차단 박지 X → 호출 폭주 시 무제한 청구 가능
- v113 만원 사건 박은 거 박은 거 박은 박은 같은 사고 박을 가능성

---

# 2. Anthropic API key 발급 (사용자 직접)

## 2-1. 박는 절차

| 단계 | 박을 거 |
|---|---|
| 1 | https://console.anthropic.com 박음 |
| 2 | 좌측 메뉴 **API Keys** |
| 3 | **Create Key** 박음 |
| 4 | 이름 = `branch-phase-a-test` (사용자 알아보게) |
| 5 | 권한 = **default (전체)** 또는 **scoped (text generation)** — 최소 권한 박음 |
| 6 | **Copy key** (sk-ant-api03-XXX...) — **한 번만 박힘** |
| 7 | **즉시 1Password 박은 거 박은 거 박은 박은 본인 비밀번호 관리자에 저장** |
| 8 | 화면 닫음 — key 박지 X 박을 가능성 |

## 2-2. 박을 위치 (정확히)

### 박은 위치 (✅)
- **1Password / Bitwarden / Apple Keychain** — 본인만 박음 (백업)
- **`/Users/dobuk/Downloads/picturebook-repo/functions/.env`** 로컬 (Phase A 코드 박을 때 — 단 .gitignore 박혀있어야)
- **Firebase Functions secrets** — `firebase functions:secrets:set ANTHROPIC_API_KEY` (Phase A 코드 박을 때)

### 박지 X 위치 (❌)
- ❌ 채팅창 (Claude / GPT / ChatGPT / 어디든)
- ❌ GitHub repo (commit / push 박지 X)
- ❌ Notion / Slack / 이메일
- ❌ client JS / HTML
- ❌ Firebase Realtime DB / Storage
- ❌ 동료 박은 거 박은 거 박은 박은 박지 X (사용자 본인만)

## 2-3. 박힌 거 박은 거 박은 박은 확인

- [ ] API key 박힘 (sk-ant-api03-XXX...)
- [ ] 1Password 박은 거 박은 거 박은 박은 본인 비밀번호 관리자에 저장 박힘
- [ ] 채팅 / GitHub / 이메일 / Slack 박지 X 박은 거 박은 거 박은 박은 박지 X (확인)
- [ ] 사용자 본인만 박음

## 2-4. API key 박은 거 박은 거 박은 박은 박힌 거 박은 거 박은 박은 사고 박을 때

- 즉시 Anthropic 콘솔 → **API Keys → Revoke** 박음 (5분 박지 X)
- 새 key 발급
- Anthropic 콘솔 박은 거 박은 거 박은 박은 월 한도 $20 박혀있어 — 최대 $20 박지 X

---

# 3. Firebase Blaze plan 확인 (사용자 직접)

## 3-1. 박힌 거 박은 거 박은 박은 확인

사용자 박은 거 박은 거 박은 박은 **이미 박힘** 박은 거 박은 거 박은 박은 (2026-05-20 명시 박힘). 단 박을 때 확인.

| 단계 | 박을 거 |
|---|---|
| 1 | https://console.firebase.google.com 박음 |
| 2 | 가지 프로젝트 박음 |
| 3 | 좌측 하단 **Plan: Blaze (Pay as you go)** 박힘 확인 |
| 4 | 박지 X 박혀있으면 **Upgrade** 박음 |

## 3-2. Spark (무료) plan 박혀있으면 박지 X

- Spark = outbound HTTP 박지 X → Anthropic API 호출 박지 X
- Blaze 박혀야 박음

## 3-3. Blaze 박은 거 박은 거 박은 박은 비용 박을 가능성

- Firebase Functions invocation: $0.40 / 100만 (Phase A 박은 거 박은 거 박은 박은 미미)
- Firebase Realtime DB: 무료 1GB / 10GB transfer (Phase A 박지 X 초과)
- 박은 거 박은 거 박은 박은 — Anthropic API 박은 거 박은 거 박은 박은 — 월 $20 박은 거 박은 거 박은 박은 박힘

## 3-4. 박힌 거 박은 거 박은 박은 확인

- [ ] Blaze plan 박힘 (Firebase 콘솔 박은 거 박은 거 박은 박은 확인)
- [ ] 결제 카드 등록 박힘
- [ ] Firebase 박은 거 박은 거 박은 박은 alert 박음 (Budget alert — 옵션, $10 박은 거 박은 거 박은 박은)

---

# 4. API key를 functions 환경변수로만 박음 (절차 — 사용자가 박을 거)

## 4-1. 박을 방식 박은 거 박은 거 박은 박은 2가지

### 방식 A. Firebase Functions secrets (권장 — Phase A 박을 때)

```bash
# Claude 박지 X — 사용자가 박은 거 박은 거 박은 박은 박음
firebase functions:secrets:set ANTHROPIC_API_KEY
# → 박은 후 sk-ant-api03-... 박음 (한 번)
```

**박은 위치**: Google Cloud Secret Manager 박은 거 박은 거 박은 박은 암호화 박음.
**박은 거 박은 거 박은 박은**: Functions 박은 거 박은 거 박은 박은 — `defineSecret('ANTHROPIC_API_KEY')` 박은 거 박은 거 박은 박은 박음 (Phase A 코드 박을 때).

### 방식 B. `.env` 파일 (로컬 emulator 박을 때만)

```bash
# Claude 박지 X — 사용자가 박음
echo 'ANTHROPIC_API_KEY=sk-ant-api03-...' > /Users/dobuk/Downloads/picturebook-repo/functions/.env
```

**박은 위치**: 로컬 박은 거 박은 거 박은 박은. **절대 git 박지 X** (`.gitignore` 박혀있어야 — 5장 박음).
**박은 거 박은 거 박은 박은**: Firebase emulator 박을 때만. 배포 박지 X (`firebase deploy` 박을 때 secrets 박음).

## 4-2. 박지 X 박은 거 박은 거 박은 박은 (절대)

| 박지 X | 박힌 이유 |
|---|---|
| ❌ `functions/index.js` 박은 거 박은 거 박은 박은 `const KEY = 'sk-ant-api03-...'` | git 박을 때 commit 박힘 |
| ❌ `const KEY = process.env.ANTHROPIC_API_KEY \|\| 'sk-ant-...'` (fallback 박지 X) | fallback 박혀있으면 박힘 |
| ❌ Firebase Realtime DB `secrets/anthropic_key` | rules 박혀있어도 사고 박을 가능성 |
| ❌ `firebase functions:config:set` (옛 방식 — deprecated 박음) | 박은 거 박은 거 박은 박은 박지 X — secrets 박음 |

## 4-3. Phase A 코드 박을 때 박을 거 (Claude 박을 거)

```js
// functions/index.js — Phase A 박을 때 박을 거 (지금 X)
const { onCall } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

exports.callTextAiBatch = onCall(
  {
    secrets: [ANTHROPIC_API_KEY],
    maxInstances: 5,
    enforceAppCheck: false,  // Phase A 박지 X (AI_APP_CHECK_ANALYSIS.md 결론 B)
  },
  async (req) => {
    const key = ANTHROPIC_API_KEY.value();
    // ... Anthropic SDK 박은 거 박은 거 박은 박은 박을 거
  }
);
```

⚠️ 이 코드 박은 거 박은 거 박은 박은 — **Phase A 박을 때 박을 거**. 지금 박지 X.

## 4-4. 박힌 거 박은 거 박은 박은 확인

- [ ] `firebase functions:secrets:set ANTHROPIC_API_KEY` 박혀있음 (Phase A 박을 때)
- [ ] `.env` 박혀있어도 — `.gitignore` 박혀있어 commit 박지 X (5장 박음)
- [ ] `functions/index.js` 박은 거 박은 거 박은 박은 hardcoded key 박지 X (Phase A 박을 때 grep 박을 거)

---

# 5. .gitignore 확인 (사용자 직접)

## 5-1. 박혀있어야 할 .gitignore 항목

```gitignore
# Firebase Functions
functions/node_modules/
functions/.env
functions/.env.local
functions/.env.*.local
functions/.runtimeconfig.json
functions/lib/
functions/.firebase/

# Secrets (이중 안전망)
**/.env
**/.env.local
**/*-secret.json
**/serviceAccount*.json
**/firebase-adminsdk-*.json

# OS
.DS_Store
```

## 5-2. 박을 절차 (사용자가 박을 거)

| 단계 | 박을 거 |
|---|---|
| 1 | `cd /Users/dobuk/Downloads/picturebook-repo` |
| 2 | `cat .gitignore` 박음 — 박혀있는지 확인 |
| 3 | 박지 X 박혀있으면 — Claude에게 박음 (사용자 명시 박힐 때) |
| 4 | `git check-ignore -v functions/.env` 박음 — `.gitignore:N` 박혀있으면 OK |
| 5 | `git status` 박음 — `functions/.env` 박혀있지 X 확인 |
| 6 | (Phase A 박을 때) `functions/.env` 박은 후 `git status` 박음 — 박지 X 박혀있어야 |

## 5-3. 박지 X 박혀있으면 박을 위험

- `git commit` 박을 때 — API key 박은 거 박은 거 박은 박은 git history 박힘
- `git push` 박을 때 — GitHub 박은 거 박은 거 박은 박은 박힘 → secret scan 박을 가능성
- 박힌 후 박은 거 박은 거 박은 박은 — **즉시 API key revoke** + git history 박은 거 박은 거 박은 박은 박지 X (BFG / git filter-branch)

## 5-4. 박힌 거 박은 거 박은 박은 확인

- [ ] `.gitignore` 박은 거 박은 거 박은 박은 `functions/.env` 박혀있음
- [ ] `**/.env` 박은 거 박은 거 박은 박은 이중 안전망 박혀있음
- [ ] `git check-ignore -v functions/.env` 박은 거 박은 거 박은 박은 OK
- [ ] GitHub repo 박은 거 박은 거 박은 박은 secret scanning 박혀있음 (Settings → Security → Secret scanning)
- [ ] (옵션) GitHub Push Protection 박혀있음

---

# 6. Phase A 실 API 구현 시작 전 최종 확인 체크리스트

박혀있어야 박을 수 있음 — **모든 항목 ✅ 박혀야** Phase A 코드 박을 거.

## 6-1. 외부 박은 거 박은 거 박은 박은 (사용자 박을 거)

### 6-1-1. Anthropic
- [ ] Anthropic 콘솔 박은 거 박은 거 박은 박은 월 한도 **$20** 박힘 (1장)
- [ ] Soft alert $10 박힘 + 이메일 박음
- [ ] API key 박힘 + 1Password 박은 거 박은 거 박은 박은 저장 (2장)
- [ ] API key 박은 거 박은 거 박은 박은 채팅 / GitHub / Slack / 이메일 박지 X 박음
- [ ] (이름 박음) `branch-phase-a-test`

### 6-1-2. Firebase
- [ ] Blaze plan 박힘 (3장)
- [ ] 결제 카드 박힘
- [ ] (옵션) Budget alert $10 박힘
- [ ] Firebase Functions secrets 박을 박은 거 박은 거 박은 박은 `firebase` CLI 박혀있음 (`npm install -g firebase-tools`)

### 6-1-3. 보안
- [ ] `.gitignore` 박혀있음 — `functions/.env` 박힘 (5장)
- [ ] `git check-ignore -v functions/.env` 박은 거 박은 거 박은 박은 OK
- [ ] GitHub Secret Scanning 박힘
- [ ] (옵션) GitHub Push Protection 박힘

## 6-2. 설계 박은 거 박은 거 박은 박은 (이미 박힘)

- [x] `AI_POLICY_V140.md` 박힘
- [x] `AI_DECISIONS_FINAL.md` 박힘
- [x] `AI_PHASE_0_5_MOCK_SPEC.md` 박힘 + 사용자 점검 통과
- [x] `AI_PROMPT_POLICY.md` 박힘
- [x] `AI_SAFETY_COST_RULES.md` 박힘
- [x] `prompts/text-strength-1.md` v3 박힘
- [x] `prompts/work-check.md` v3 박힘
- [x] `AI_PHASE_A_PREP_STATUS.md` 박힘
- [x] `AI_COST_GUARD_PLAN.md` 박힘 (11단 방어)
- [x] `AI_APP_CHECK_ANALYSIS.md` 박힘 (결론 B)
- [x] `AI_PHASE_A_USER_PREP_CHECKLIST.md` 박힘 (이 문서)

## 6-3. mock 검증 박은 거 박은 거 박은 박은 (이미 박힘)

- [x] v140 mock 4 step 박힘
- [x] 5 fix 박힘 (배지 위치 / quota namespace / snapshot 객체-배열 / 테스트 편의 보정)
- [x] **사용자 점검 15 체크리스트 모두 합격** (2026-05-21)
- [x] 원본 body 박지 X 확인
- [x] _rtSaveBody 호출 X 확인
- [x] aiVariants.textS1.final 저장 확인
- [x] 토글 박힘 확인

## 6-4. 사용자 명시 박혀야 Claude 박을 거

- [ ] **사용자가 "Phase A 코드 박을 거" 명시 박힘**
- [ ] (위 6-1·6-2·6-3 모두 ✅ 박힌 후)

## 6-5. Claude 박을 거 (Phase A 코드 — 사용자 명시 박힐 때)

박을 거 박은 거 박은 박은 박혀있음 (`AI_COST_GUARD_PLAN.md` 4장 박힘):

- [ ] `functions/` 폴더 생성 + `package.json`
- [ ] `functions/index.js` — `callTextAiBatch` / `callWorkCheck`
- [ ] 11단 검증 박음 (auth → 화이트리스트 → aiPermission → copyDepth → testMode 거부 → 브랜치 quota → rootBranchId quota → 전역 hard cap → maxInstances → Origin → 일일 알람)
- [ ] 동시 호출 lock (60s)
- [ ] rate limit (60s)
- [ ] kill switch
- [ ] 7가지 환불 정책 트랜잭션
- [ ] Anthropic Messages API `max_tokens: 8000`
- [ ] AI 공개 라벨 (mock의 "※mock" → "Claude AI 박음")
- [ ] `database.rules.json` 박음 (aiDrafts / aiVariants / ai-usage / ai-usage-by-root / ai-kill-switch / ai-stats)
- [ ] viewer-ai.js — `callTextAiBatch` / `callWorkCheck` Firebase Functions 호출 박음

---

# 7. 사용자 박을 때 박은 거 박은 거 박은 박은 안전 절차 (Quick Reference)

## 7-1. API key 박을 때 (사용자 본인 PC에서만)

```bash
# Anthropic 콘솔에서 발급 박은 후 — 즉시 1Password 박음

# Firebase secrets 박음 (Phase A 박을 때만)
cd /Users/dobuk/Downloads/picturebook-repo/functions
firebase functions:secrets:set ANTHROPIC_API_KEY
# → 박은 후 sk-ant-api03-... 박음 (붙여넣기). 박은 후 화면 닫음.

# 확인 (key 박지 X — exists 박은 거 박은 거 박은 박은 박을 거)
firebase functions:secrets:access ANTHROPIC_API_KEY  # 박지 X — 박지 X
firebase functions:secrets:get ANTHROPIC_API_KEY  # 박은 거 박은 거 박은 박은 박을 거 — 메타데이터만
```

## 7-2. .env 박을 때 (로컬 emulator만)

```bash
# 사용자 본인 PC에서만
cd /Users/dobuk/Downloads/picturebook-repo
# .gitignore 먼저 확인
git check-ignore -v functions/.env
# → '.gitignore:N:functions/.env' 박혀있어야

# 박은 후 박음 (Phase A 박을 때만)
echo 'ANTHROPIC_API_KEY=sk-ant-api03-...' > functions/.env

# 박지 X 박혀있는지 확인
git status  # functions/.env 박혀있지 X 박을 거
```

## 7-3. 사고 박을 때 (API key 박힘)

| 단계 | 박을 거 |
|---|---|
| 1 | **즉시** Anthropic 콘솔 → API Keys → 해당 key **Revoke** |
| 2 | 새 key 발급 |
| 3 | Firebase secrets 박은 거 박은 거 박은 박은 박음 — `firebase functions:secrets:set ANTHROPIC_API_KEY` |
| 4 | git history 박은 거 박은 거 박은 박은 박혀있으면 — BFG 박음 (`bfg --delete-files .env`) 또는 git filter-branch |
| 5 | `git push --force` (사용자 명시 박힐 때만) |
| 6 | Anthropic 콘솔 박은 거 박은 거 박은 박은 박은 거 박은 거 박은 박은 — 의심 호출 박혀있는지 확인 |
| 7 | 박은 거 박은 거 박은 박은 박혀있으면 — 사용량 박은 거 박은 거 박은 박은 / 비용 박은 거 박은 거 박은 박은 박음 |

---

# 8. 박지 X 박은 거 박은 거 박은 박은 (사용자 명시 — 2026-05-21)

이 문서 박은 시점에 Claude 박지 X:
- ❌ 코드 구현 박지 X
- ❌ `functions/` 생성 / 수정 박지 X
- ❌ API key 박지 X (채팅 / Read / 어디든)
- ❌ Anthropic 연결 박지 X
- ❌ 비용 발생 작업 박지 X
- ❌ `database.rules.json` 박지 X
- ❌ viewer / pb-ai.css 박지 X

Claude 박을 수 있는 거:
- ✅ 이 문서 박음
- ✅ 사용자 박을 때 절차 안내 박음 (코드 X)
- ✅ `.gitignore` 박은 거 박은 거 박은 박은 박지 X 박혀있으면 — Claude 박을 거 박은 거 박은 박은 박은 (사용자 명시 박힐 때)

---

# 9. 한 줄

> 사용자가 박을 거 = **Anthropic 월 한도 $20** + **API key 박음 (1Password 박은 거 박은 거 박은 박은)** + **Blaze 박힘 확인** + **.gitignore 확인**.
> **API key 박은 거 박은 거 박은 박은 채팅 / GitHub / 이메일 박지 X**.
> Claude 박을 거 = **사용자 명시 박힐 때 Phase A 코드 박음** (Firebase secrets 박은 거 박은 거 박은 박은 — `defineSecret('ANTHROPIC_API_KEY')`).
