# 가지 AI — 비용 비상 차단 설계 (Phase A 박기 전)

> 시점: 2026-05-21
> 위치: `/Users/dobuk/Downloads/picturebook-repo/AI_COST_GUARD_PLAN.md`
> 상태: **설계 박음 — 코드 X (사용자 명시 박힘)**
> 의존: `AI_SAFETY_COST_RULES.md` / `AI_POLICY_V140.md` / `AI_DECISIONS_FINAL.md` / `AI_PHASE_A_PREP_STATUS.md`
> ⚠️ Phase A 실 API 구현 X / API key X / Anthropic 연결 X / functions X / 비용 발생 X

---

# 0. 이 문서의 역할

Phase A 실 API 박기 전 **비용 폭주 박지 X 박은 거 박은 거 박은 박은 비상 차단 구조** 박음. v113 박은 만원 사건 박은 거 박은 거 박은 박은 같은 사고 박지 X 박은 거 박은 거 박은 박은. 박은 거 박은 거 박은 박은 — **다층 방어** 박음 — 한 박은 거 박은 거 박은 박은 박힌 거 박은 거 박은 박은 — 다음 박은 거 박은 거 박은 박은 막음.

핵심 원칙:
- **Functions가 박은 거 박은 거 박은 박은 — 모든 호출 진입점**. client 박은 거 박은 거 박은 박은 — 신뢰 X
- **client testMode / mock 박은 거 박은 거 박은 박은 — 실 API 단에서 무조건 거부**
- 한 박은 거 박은 거 박은 박은 박힌 거 박은 거 박은 박은 — 다음 박은 거 박은 거 박은 박은 막음 (8단 박은 거 박은 거 박은 박은)
- **fail-closed** — 의심 박은 거 박은 거 박은 박은 — 거부 (호출 X)

---

# 1. 8단 다층 방어 박은 거 박은 거 박은 박은 한눈에

```
[browser] ─ client client testMode = mock 박음 (실 API 호출 X)
   │
   │  callTextAiBatch / callWorkCheck
   ▼
[1] Firebase auth ─────────── context.auth 박지 X 박혀있으면 거부
   │
[2] 임시 허용 목록 ─────────── classId/teamName 박지 X 박혀있으면 거부 (Phase A 테스트만)
   │
[3] aiPermission ──────────── enabled X / allowedModes[mode] X 박혀있으면 거부
   │
[4] branchLineage ─────────── copyDepth > 1 박혀있으면 거부
   │
[5] testMode 우회 거부 ────── req.testMode === true 박혀있으면 거부 (운영)
   │
[6] 브랜치 quota ──────────── 남은 횟수 0 박혀있으면 거부
   │
[7] rootBranchId 묶음 quota ─ 하루 N회 박혀있으면 거부
   │
[8] Functions 일일/월간 hard cap ─ 전역 한도 박혀있으면 거부
   │
   ▼
[Anthropic API 호출]
   │
   ▼
Anthropic 콘솔 월 한도 (외부 박은 거 박은 거 박은 박은)
```

8단 박은 거 박은 거 박은 박은 박힌 후 박은 거 박은 거 박은 박은 — **Anthropic 콘솔 박은 거 박은 거 박은 박은 외부 박은 거 박은 거 박은 박은 최종 박음** (모든 박은 거 박은 거 박은 박은 박힌 후 박음).

---

# 2. 항목별 설계 (사용자 박은 11 박은 거 박은 거 박은 박은)

## 2-1. Anthropic 콘솔 월 한도 (Phase A 박기 전 박혀야)

**박을 거**:
- Anthropic Console (https://console.anthropic.com) 박은 거 박은 거 박은 박은 → Settings → Limits
- **월 비용 한도** (Monthly spend limit) 박음 — 추천 **$20** (사용자 결정 #13 박힘)
- **알람 임계치** (Soft / Hard) 박음:
  - Soft: $10 (50%) → 이메일 알림
  - Hard: $20 (100%) → 호출 자동 거부 (Anthropic 측)

**박을 위치**: Anthropic 콘솔 (외부)
**누가**: 사용자
**Phase A 박기 전 박혀야**: ✅ 필수

**박지 X 박혀있으면 위험**:
- 호출 폭주 시 Anthropic 측 박은 거 박은 거 박은 박은 차단 박지 X → 무제한 청구 가능

## 2-2. Functions 단 호출 제한

**박을 거** (Phase A 박을 때 코드 박음):

### 2-2-1. 호출당 hard cap (단일 요청 비용 상한)
- 1회 호출 박은 거 박은 거 박은 박은 input + output 토큰 박음 — 추천 **8000 tokens 박음**
- 한 작품 박은 거 박은 거 박은 박은 너무 큰 박은 거 박은 거 박은 박은 — 분할 또는 거부

### 2-2-2. 동시 호출 제한
- 같은 (classId, teamName) 박은 거 박은 거 박은 박은 동시 호출 1개만 박음
- Firebase Realtime Database 박은 거 박은 거 박은 박은 lock 박은 거 박은 거 박은 박은 ai-call-lock/{classId}/{teamName} 박음
- timeout 60s — lock 박은 거 박은 거 박은 박은 60초 후 자동 해제

### 2-2-3. 호출 빈도 제한 (rate limit)
- 동일 (classId, teamName) 박은 거 박은 거 박은 박은 — 60초당 최대 1회
- 동일 classId 박은 거 박은 거 박은 박은 — 60초당 최대 10회

**박을 위치**: `functions/index.js` (Phase A 박을 거)
**누가**: Claude (사용자 명시 박힐 때)
**박지 X 박혀있으면 위험**:
- 동일 사용자 박은 거 박은 거 박은 박은 동시 다중 호출 → 비용 폭주
- 무한 루프 박은 거 박은 거 박은 박은 → 분당 수십 호출

## 2-3. 브랜치별 quota

**박을 거**:
- 텍스트 1단계: **브랜치당 최대 3회** (사용자 결정 #5)
- 작품 검사: 브랜치당 5회 (#20)
- (Phase B) 텍스트 2단계: 1회
- (Phase C) 텍스트 3단계: 1회

**저장 위치**:
- mock: localStorage `pb_ai_mock_usage_v1__{classId}__{teamName}` (현재 박힘)
- 실 API: Firebase `ai-usage/{classId}/{teamName}/{YYYY-MM}/{mode}Used`
- Functions 트랜잭션 박음 — race condition 박지 X

**검증**:
- Functions 호출 단 첫 번째 박은 거 박은 거 박은 박은 — quota 박은 거 박은 거 박은 박은 박지 X 박혀있으면 거부
- client UI 박지 X — Functions만 신뢰

**박지 X 박혀있으면 위험**:
- 학생 1명이 무한 호출 → 한 작품에서만 수십 회

## 2-4. rootBranchId 묶음 quota

**박을 거**:
- 모 브랜치 + 모든 자식 브랜치 박은 거 박은 거 박은 박은 한 묶음으로 quota 박음
- 추천: **rootBranchId 기준 하루 50회 박음** (사용자 결정 #38 박힐 거 — 베타에서 확정)

**왜 필요?**
- 교사 1명이 모 브랜치 박은 후 학생 10명에게 자식 박음 박은 거 박은 거 박은 박은
- 각 학생 = 3회씩 = 30회. 100명 = 300회. **묶음 박지 X 박혀있으면 박을 위험 큼**

**저장**:
- Firebase `ai-usage-by-root/{rootBranchId}/{YYYY-MM-DD}/calls`
- Functions 트랜잭션

**박지 X 박혀있으면 위험**:
- 한 클래스 박은 거 박은 거 박은 박은 동시 호출 → 하루 수백 회

## 2-5. Phase A 테스트용 임시 허용 목록 (이미 박힘)

**박은 거**:
- `AI_SAFETY_COST_RULES.md` 최상단 박힘
- 변수명: `AI_TEST_ALLOWED`
- 값:
  ```js
  [
    { classId: 'JL26A', teamName: '0000' },
    { classId: 'JL26A', teamName: '은규' },
    { classId: 'JL26A', teamName: '예지유은인우' },
  ]
  ```
- 박힌 거 외 모든 호출 거부

**박을 위치**: `functions/index.js` (Phase A 박을 거)
**상태**: ✅ 설계 박힘 (Phase A 코드 박을 때 박을 거)
**운영 박힐 때**: `teacherId`/account 기반 권한으로 교체

## 2-6. testMode 우회 박지 X 박은 거 박은 거 박은 박은 검증 (v140 핵심)

**박을 거**:
- client 박은 거 박은 거 박은 박은 `?test=1` 박혀있어도 — Functions 박은 거 박은 거 박은 박은 박지 X
- 요청에 `req.testMode === true` 박혀있어도 — **실 API 호출 단에서 무조건 거부**
- Functions 환경변수 `IS_PRODUCTION === true` 박혀있으면 — testMode 박은 거 박은 거 박은 박은 자동 무시

**코드 박은 거 박은 거 박은 박은 (Phase A 박을 때)**:
```js
// functions/index.js
exports.callTextAiBatch = onCall(async (req) => {
  // testMode 우회 박지 X — 실 API에는 적용 X
  if (req.data.testMode === true) {
    throw new HttpsError('permission-denied', 'testMode 박은 거 박은 거 박은 박은 실 API 박지 X');
  }
  // ... 박은 거 박은 거 박은 박은 박을 거
});
```

**박지 X 박혀있으면 위험**:
- client 박은 거 박은 거 박은 박은 testMode 박은 거 박은 거 박은 박은 우회 박을 가능성

## 2-7. 실패/환불 정책 (7가지 — SAFETY 5-1 박힘)

**박은 거**:

| # | 박힌 거 | 차감 |
|---|---|---|
| 1 | 호출 전 취소 (모드 모달 닫기) | 차감 X |
| 2 | 호출 도중 [취소] | 차감 그대로 (환불 X) |
| 3 | 모델 실패 (timeout / 5xx) | 환불 |
| 4 | 네트워크 실패 | 환불 |
| 5 | JSON schema 위반 (서버 검증 실패) | 환불 |
| 6 | partially_applied (일부만 적용) | 차감 그대로 (24h 내 재호출 가능 UI 박힐 거) |
| 7 | client crash / 새로고침 | 차감 그대로 — suggestion localStorage 박은 거 박은 거 박은 박은 박지 X |

**박을 위치**: `functions/index.js` (Phase A 박을 때 — quota 트랜잭션)
**검증**: mock 박은 거 박은 거 박은 박은 — 박혔음 (v140 mock 7가지 정책 박음)

## 2-8. 일일 호출 제한

**박을 거**:

### 2-8-1. 전역 일일 hard cap (Functions 단)
- **하루 전체 호출 박은 거 박은 거 박은 박은 — 최대 500회** (베타 박은 거 박은 거 박은 박은 — 사용자 결정 #38)
- Firebase `ai-usage-global/{YYYY-MM-DD}/calls` 박음
- 초과 시 거부 + 사용자에게 "오늘 호출 한도 박혔어요. 내일 박음." 안내

### 2-8-2. 동일 사용자 일일 제한
- `(classId, teamName)` 박은 거 박은 거 박은 박은 — 하루 10회 최대 (1단계 3 + 검사 5 + 여유 2)
- mock 박은 거 박은 거 박은 박은 박힌 거 박은 거 박은 박은 (#5 / #20) 박은 거 박은 거 박은 박은 — quota 박은 거 박은 거 박은 박은 충분

**박을 위치**: `functions/index.js`
**박지 X 박혀있으면 위험**:
- 한 사람이 자동화 박은 거 박은 거 박은 박은 무한 호출 (script 박음)

## 2-9. 비상 kill switch

**박을 거**:

### 2-9-1. 즉시 차단 (사용자 박을 거)
- Firebase Realtime Database 박은 거 박은 거 박은 박은 `ai-kill-switch/enabled = true` 박음
- Functions 박은 거 박은 거 박은 박은 모든 호출 박은 거 박은 거 박은 박은 진입 첫 줄 박은 거 박은 거 박은 박은:
  ```js
  const ks = await db.ref('ai-kill-switch/enabled').once('value');
  if (ks.val() === true) {
    throw new HttpsError('unavailable', 'AI 박은 거 박은 거 박은 박은 잠시 박지 X. 운영자에게 박음.');
  }
  ```

### 2-9-2. API key 회수 (사용자 박을 거)
- Anthropic Console 박은 거 박은 거 박은 박은 → API Keys → 박은 거 박은 거 박은 박은 즉시 Revoke
- 사고 박을 때 박은 거 박은 거 박은 박은 — 5분 박은 거 박은 거 박은 박은 박지 X

### 2-9-3. Functions 박지 X 박음 (사용자 박을 거)
- `firebase deploy --only functions:callTextAiBatch=undefined` 박지 X — 단 Firebase 콘솔 박은 거 박은 거 박은 박은 함수 박은 거 박은 거 박은 박은 박지 X
- 또는 Functions hard cap 박은 거 박은 거 박은 박은 1로 박음

**박지 X 박혀있으면 위험**:
- 사고 박을 때 박은 거 박은 거 박은 박은 즉시 차단 박지 X → 추가 청구

## 2-10. 로그 / 모니터링 항목

**박을 거** (Functions 박을 때):

| 박힌 거 | 박는 위치 |
|---|---|
| 모든 호출 시작·끝 | Cloud Logging (Functions 자동) |
| 토큰 사용량 (input/output) | Firebase `ai-stats/{YYYY-MM-DD}/tokens/{mode}` (atomic 박음) |
| 비용 추정 (Haiku 단가 박은 거 박은 거 박은 박은 곱셈) | Firebase `ai-stats/.../cost` |
| 거부 사유 박은 거 박은 거 박은 박은 카운트 | Firebase `ai-stats/.../rejects/{reason}` |
| 사용자별 호출 수 | Firebase `ai-stats/.../by-team/{classId}__{teamName}` |
| 비용 임계치 80% 박은 거 박은 거 박은 박은 알람 | Cloud Functions onWrite 박음 |

**알람 (사용자에게 박을 거)**:
- 80% 박은 거 박은 거 박은 박은 — 이메일 (Firebase Functions + Sendgrid 또는 Anthropic 콘솔)
- 100% 박은 거 박은 거 박은 박은 — 자동 kill switch ON + 이메일

**박을 위치**: `functions/` 박은 거 박은 거 박은 박은 (Phase A)
**박지 X 박혀있으면 위험**:
- 사고 박을 거 박은 거 박은 박은 박은 거 박은 거 박은 박은 사후 박은 거 박은 거 박은 박은 추적 박지 X

## 2-11. 비용 초과 위험 상황별 대응

### Case A. 학생 1명 박은 거 박은 거 박은 박은 무한 호출 (script)
- 차단: 2-2 동시 호출 lock + 2-8-2 동일 사용자 일일 제한
- 추가: rate limit 60s 박은 거 박은 거 박은 박은 박음
- 결과: 박지 X (lock + rate limit 박은 거 박은 거 박은 박은 막음)

### Case B. 클래스 전체 박은 거 박은 거 박은 박은 동시 호출 (수업 박을 때)
- 차단: 2-4 rootBranchId 묶음 quota
- 결과: 하루 50회 박은 거 박은 거 박은 박은 막음

### Case C. 무한 루프 박은 거 박은 거 박은 박은 client 박은 거 박은 거 박은 박은 호출 (버그)
- 차단: 2-2-2 lock (60s 후 자동 해제 후에도 quota 박은 거 박은 거 박은 박은 막음)
- 추가: 2-8-1 전역 일일 hard cap
- 결과: 박지 X

### Case D. API key 박은 거 박은 거 박은 박은 유출 (사고)
- 즉시: 2-9-2 API key 회수
- 추가: 2-1 Anthropic 콘솔 월 한도 박은 거 박은 거 박은 박은 자동 차단
- 결과: 최대 $20 박지 X (월 한도 박힘)

### Case E. testMode 우회 박은 거 박은 거 박은 박은 시도 (악의)
- 차단: 2-6 testMode 박은 거 박은 거 박은 박은 실 API 단에서 거부
- 결과: 박지 X

### Case F. Anthropic API 박은 거 박은 거 박은 박은 폭주 (예: 응답 30000 토큰)
- 차단: 2-2-1 호출당 hard cap (8000 토큰)
- Anthropic Messages API `max_tokens` 박은 거 박은 거 박은 박은 박음
- 결과: 박지 X

### Case G. Functions 박은 거 박은 거 박은 박은 cold start 박은 거 박은 거 박은 박은 무한 retry
- 차단: 2-2-3 rate limit (60s)
- 결과: 박지 X

---

# 3. v140 구조 유지 (사용자 명시)

| 박힐 거 | mock에서 박힘 | Phase A에서 박음 |
|---|---|---|
| 원본 body 박지 X | viewer-render.js 6곳 `_getDisplayBody` | 동일 유지. functions 박지 X scenes/{id}/body |
| aiVariants 저장 | localStorage `__{namespace}` | Firebase `aiVariants/{classId}/{teamName}/{workId}` + rules |
| 1단계 후보 3회 | localStorage `aiDrafts.candidates.attempt{1,2,3}` | Firebase `aiDrafts/{...}` + TTL |
| 실 API에서 TEST MODE quota reset 박지 X | mock 박은 거 박은 거 박은 박은 `window.__resetAiMock*` 박힘 | 운영 박은 거 박은 거 박은 박은 노출 X — `IS_PRODUCTION === true` 박혀있으면 박지 X |
| 실 API에서 mock 우회 박지 X | client 박은 거 박은 거 박은 박은 testMode | Functions 박은 거 박은 거 박은 박은 거부 (2-6) |
| Functions에서 모든 검증 | mock 박지 X (client만) | 8단 박음 (1장 박힘) |

---

# 4. Phase A 코드 시작 전 체크리스트

박혀야 박을 수 있음 (사용자 OK 박힐 때):

## 4-1. 사용자 박을 거 (외부 박은 거 박은 거 박은 박은)
- [ ] **Anthropic Console 박은 거 박은 거 박은 박은 월 한도 $20 박음** (2-1)
- [ ] Anthropic Console 박은 거 박은 거 박은 박은 Soft 알람 $10 박음 (이메일)
- [ ] Anthropic API key 박은 거 박은 거 박은 박은 박음 + 보관 박은 거 박은 거 박은 박은 박을 거 박음 (사용자 박지 X repo 박지 X)
- [ ] Firebase Blaze plan 박혀있음 (✅ 박힘)
- [ ] Firebase 박은 거 박은 거 박은 박은 `functions/.env` 박을 위치 박은 거 박은 거 박은 박은 박음 — `.gitignore` 박혀있음 확인

## 4-2. Claude 박을 거 (코드 박을 거 — 사용자 명시 박힐 때)
- [ ] `functions/` 생성 + `package.json` 박음
- [ ] `functions/index.js` — `callTextAiBatch` / `callWorkCheck` 박음
- [ ] 8단 검증 박음 (1장 박힘):
  - [ ] Firebase auth
  - [ ] 임시 허용 목록 (`AI_TEST_ALLOWED`)
  - [ ] `aiPermission.enabled` + `allowedModes[mode]`
  - [ ] `copyDepth <= 1`
  - [ ] testMode 박지 X (운영)
  - [ ] 브랜치 quota
  - [ ] rootBranchId 묶음 quota
  - [ ] 전역 일일 / 월간 hard cap
- [ ] 동시 호출 lock (2-2-2)
- [ ] rate limit (2-2-3)
- [ ] kill switch 박음 (2-9-1)
- [ ] 로그 / stats 박음 (2-10)
- [ ] 7가지 환불 정책 트랜잭션 박음 (2-7)
- [ ] Anthropic Messages API `max_tokens: 8000` 박음

## 4-3. Firebase rules 박을 거 (`database.rules.json` 박을 거)
- [ ] `aiDrafts/{classId}/{teamName}/{workId}` — read·write 사용자 본인만
- [ ] `aiVariants/...` — 동상
- [ ] `ai-usage/...` — Functions만 write (client write X)
- [ ] `ai-usage-by-root/...` — 동상
- [ ] `ai-kill-switch/enabled` — Functions·관리자만 write
- [ ] `ai-stats/...` — Functions만 write

## 4-4. client 박을 거 (viewer-ai.js)
- [ ] mock 박은 거 박은 거 박은 박은 함수 박지 X 박을지 (옛 `_applySelected` / `_showComparisonModal` / `_startTextS1` dead code) — 사용자 결정 박힐 거
- [ ] `callTextAiBatch` / `callWorkCheck` Firebase Functions 호출 박음
- [ ] mock 박은 거 박은 거 박은 박은 일부 박은 거 박은 거 박은 박은 박지 X (TEST MODE 박은 거 박은 거 박은 박은 박지 X — 운영 박은 거 박은 거 박은 박은)
- [ ] AI 공개 라벨 박음 — "Claude AI 박음" (mock의 ※mock 박지 X)

## 4-5. 모니터링 박을 거
- [ ] Anthropic 콘솔 박은 거 박은 거 박은 박은 매일 박음 (사용자)
- [ ] Firebase Functions 박은 거 박은 거 박은 박은 invocations 박은 거 박은 거 박은 박은 매일 박음
- [ ] 첫 1주 박은 거 박은 거 박은 박은 매일 — 비용 / 호출 수 / 거부 사유

---

# 5. 박지 X 박은 거 박은 거 박은 박은 (사용자 명시 — 2026-05-21)

- ❌ Phase A 실 API 구현 박음
- ❌ API key 추가 박음
- ❌ Anthropic 연결 박음
- ❌ `functions/` 생성·수정 박음
- ❌ 비용 발생 작업 박음
- ❌ `database.rules.json` 박음 (Phase A 코드 박을 때 박을 거)
- ❌ viewer 박은 거 박은 거 박은 박은 박음 (mock 박지 X 박은 거 박은 거 박은 박은 박힐 때까지)

박을 수 있는 거:
- ✅ 이 문서 박음
- ✅ `AI_SAFETY_COST_RULES.md` 박은 거 박은 거 박은 박은 참조 박음 (별도 박지 X)
- ✅ `AI_PHASE_A_PREP_STATUS.md` 박은 거 박은 거 박은 박은 박은 거 박은 거 박은 박은 박음

---

# 6. 한 줄

> 가지 AI Phase A 박을 때 비용 비상 차단 박은 거 박은 거 박은 박은 — **8단 다층 방어** (auth → 화이트리스트 → aiPermission → copyDepth → testMode 거부 → 브랜치 quota → rootBranchId quota → 전역 hard cap) + Anthropic 콘솔 월 한도 $20 + kill switch + 7가지 환불 + 로그/알람. **client 박은 거 박은 거 박은 박은 신뢰 X — Functions만 신뢰**. 박힌 거 박은 거 박은 거 박은 박은 박지 X 박혔으면 코드 한 줄도 박지 X.
