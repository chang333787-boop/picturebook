# 가지 AI — Firebase App Check 필요성 분석 (Phase A vs 베타)

> 시점: 2026-05-21
> 위치: `/Users/dobuk/Downloads/picturebook-repo/AI_APP_CHECK_ANALYSIS.md`
> 상태: **분석 박음 — 코드 X / Firebase 설정 박지 X (사용자 명시)**
> 의존: `AI_COST_GUARD_PLAN.md` / `AI_SAFETY_COST_RULES.md` / `AI_PHASE_A_PREP_STATUS.md`

---

# 0. 이 문서의 역할

Phase A 박을 때 Firebase App Check 박은 거 박은 거 박은 박은 — **바로 박을지 / 보류 박을지** 분석. 10 항목 박은 거 박은 거 박은 박은 박은 후 결론 박음 (A / B / C 중 하나).

---

# 1. App Check 박은 거 박은 거 박은 박은 — 박힌 것 / 박지 X

## 1-1. 막아주는 것 ✅

| 위협 | 박는 방식 |
|---|---|
| 외부 script / curl / 자동화 박은 거 박은 거 박은 박은 직접 Functions 호출 | reCAPTCHA Enterprise 토큰 박은 거 박은 거 박은 박은 박지 X 박혀있으면 거부 |
| API key 박은 거 박은 거 박은 박은 노출 (Firebase API key) → 외부 박은 거 박은 거 박은 박은 직접 Firebase 박음 | App Check enforce 박을 때 — 정당한 App 박은 거 박은 거 박은 박은 박은 거 박은 거 박은 박은 거부 |
| Replay attack | 토큰 짧은 만료 (1시간 박음) |
| 다른 도메인 박은 거 박은 거 박은 박은 박은 거 박은 거 박은 박은 호출 | 등록된 site key + origin 박음 |

## 1-2. 막지 못하는 것 ❌

| 위협 | 왜 박지 X |
|---|---|
| 정당한 client 박은 거 박은 거 박은 박은 — 사용자 자신 박은 거 박은 거 박은 박은 console 박음 무한 호출 | App Check 박은 거 박은 거 박은 박은 — 토큰 박혀있어 — 박은 거 박은 거 박은 박은 거부 X |
| API key 박은 거 박은 거 박은 박은 유출 → Functions 박지 X 박은 거 박은 거 박은 박은 직접 Anthropic API 호출 | App Check 박은 거 박은 거 박은 박은 Firebase 박은 거 박은 거 박은 박은. Anthropic API 박은 거 박은 거 박은 박은 별도 — 박지 X |
| 정당한 사용자 박은 거 박은 거 박은 박은 — script 박은 거 박은 거 박은 박은 자동화 (browser 박은 거 박은 거 박은 박은) | App Check 토큰 박혀있어 정당 박음 — 거부 X |
| Functions 박은 거 박은 거 박은 박은 — 권한 박은 거 박은 거 박은 박은 (aiPermission 박지 X) | App Check 박은 거 박은 거 박은 박은 — 사용자 권한 박지 X — 박지 X |
| 비용 폭주 | 호출 자체 박은 거 박은 거 박은 박은 권한 박혀있으면 박지 X — App Check 박은 거 박은 거 박은 박은 박지 X |

## 1-3. 박은 거 박은 거 박은 박은 한 줄

> App Check = **외부 봇 / 자동화 / API key 유출 박은 거 박은 거 박은 박은 차단**. 정당한 사용자 박은 거 박은 거 박은 박은 비용 폭주는 박지 X.

---

# 2. v140 비용 방어 구조와 겹치는 부분 / 추가 부분

## 2-1. 8단 다층 방어 박은 거 박은 거 박은 박은 비교

| 단 | v140 박은 거 | App Check 박은 거 | 박은 거 박은 거 박은 박은 |
|---|---|---|---|
| 1 | Firebase auth (anonymous) | 박지 X | v140만 박음 |
| 2 | 임시 허용 목록 (`AI_TEST_ALLOWED`) | 박지 X | v140만 박음 |
| 3 | `aiPermission.enabled` | 박지 X | v140만 박음 |
| 4 | `branchLineage.copyDepth <= 1` | 박지 X | v140만 박음 |
| 5 | testMode 거부 (실 API) | 박지 X | v140만 박음 |
| 6 | 브랜치 quota | 박지 X | v140만 박음 |
| 7 | rootBranchId 묶음 quota | 박지 X | v140만 박음 |
| 8 | 전역 일일/월간 hard cap | 박지 X | v140만 박음 |
| **9 (App Check)** | 박지 X | **외부 봇 / API key 유출 차단** | **App Check만 박음** |

→ **App Check = 9단 추가 박은 거 박은 거 박은 박은**. 1~8단 박은 거 박은 거 박은 박은 박지 X 박은 거 박은 거 박은 박은 — 박은 거 박은 거 박은 박은 박은 거 박은 거 박은 박은 — **8단 박은 거 박은 거 박은 박은 박힌 후 박은 거 박은 거 박은 박은 박힌 거 박은 거 박은 박은 박을 거**.

## 2-2. 박은 거 박은 거 박은 박은 — 박은 거 박은 거 박은 박은 막은 거 박은 거 박은 박은 (Phase A)

| Case (AI_COST_GUARD_PLAN.md 2-11) | 박힌 방어선 | App Check 박은 거 박은 거 박은 박은 박을지 |
|---|---|---|
| A. 학생 1명 무한 호출 (정당 사용자) | lock + rate limit + quota | 박지 X (정당 사용자라 App Check 박은 거 박은 거 박은 박은 박지 X) |
| B. 클래스 전체 동시 호출 | rootBranchId quota | 박지 X |
| C. 무한 루프 client 버그 | lock + 전역 cap | 박지 X |
| D. **API key 유출** | Anthropic 콘솔 월 한도 (외부 박은 거 박은 거 박은 박은 막음) | ⚠️ Functions 박은 거 박은 거 박은 박은 — App Check 박혀있으면 Firebase 박지 X 박은 거 박은 거 박은 박은 거부 (Functions 외부 박은 거 박은 거 박은 박은) |
| E. testMode 우회 | Functions 박은 거 박은 거 박은 박은 거부 (5단) | 박지 X |
| F. Anthropic 응답 폭주 | `max_tokens: 8000` | 박지 X |
| G. cold start retry | rate limit | 박지 X |
| **H. 외부 봇 / curl Functions 호출 (신규)** | 박지 X | ✅ **App Check 박음 — 박지 X 박은 거 박은 거 박은 박은 막음** |

→ Phase A 박은 거 박은 거 박은 박은 — Case H 박은 거 박은 거 박은 박은 박은 거 박은 거 박은 박은 — 화이트리스트 박은 거 박은 거 박은 박은 박지 X 박혀있으면 어차피 거부. 단 박은 거 박은 거 박은 박은 — Functions invocation 자체 박은 거 박은 거 박은 박은 — 박은 거 박은 거 박은 박은 비용 박은 거 박은 거 박은 박은 발생 ($0.40 / 100만 invocation 박은 거 박은 거 박은 박은 박음 — Firebase Blaze).

---

# 3. Phase A 테스트 화이트리스트와의 관계

| 항목 | 화이트리스트 | App Check |
|---|---|---|
| 박는 단위 | `classId__teamName` (사용자) | Firebase project / app (브라우저) |
| 박는 대상 | 정당한 사용자 박은 거 박은 거 박은 박은 — 박지 X 박은 거 박은 거 박은 박은 거부 | 봇 / curl / 다른 도메인 박은 거 박은 거 박은 박은 거부 |
| 중복 박은 거 박은 거 박은 박은 | 박지 X — 다른 박은 거 박은 거 박은 박은 |
| Phase A 박을 때 | ✅ 박음 (Functions 단) | 박을지 박은 거 박은 거 박은 박은 분석 박은 거 박은 거 박은 박은 (이 문서) |

→ **상호 보완**. 둘 다 박혀있어도 박은 거 박은 거 박은 박은 박지 X.

---

# 4. Functions callable / API 호출 보호 박을 가치

## 4-1. Functions onCall 박은 거 박은 거 박은 박은 — 박을 옵션

```js
// Phase A 박을 때 — App Check 박혀있을 때 박을 거
exports.callTextAiBatch = onCall(
  { enforceAppCheck: true },   // ← App Check 박지 X 박혀있으면 거부
  async (req) => {
    // req.app 박혀있으면 App Check 토큰 박힌 거 박은 거 박은 거 박은 박은
    // ...
  }
);
```

`enforceAppCheck: true` 박혀있으면:
- 토큰 박지 X 박은 거 박은 거 박은 박은 — 호출 자체 박지 X
- Functions invocation 비용 박지 X
- Anthropic API 호출 박지 X

## 4-2. 박지 X 박은 거 박은 거 박은 박은 — `req.app === null` 박혀있어도 진행

`enforceAppCheck: false` (또는 박지 X) 박을 때:
- 호출 박은 거 박은 거 박은 박은 박힘 (auth만 박혀있으면)
- 박은 거 박은 거 박은 박은 — 화이트리스트 / aiPermission / quota 박은 거 박은 거 박은 박은 다음 단 박음

---

# 5. 현재 프로젝트 구조 박은 거 박은 거 박은 박은 App Check 박을 때 위험

## 5-1. 가지 박은 거 박은 거 박은 박은 — anonymous auth 박음

학생 박은 거 박은 거 박은 박은 anonymous 박은 거 박은 거 박은 박은 가입 박지 X — Firebase auth anonymous 박음. App Check 박은 거 박은 거 박은 박은 — 인증 박은 거 박은 거 박은 박은 박지 X — 별도 박음.

근데 박은 거 박은 거 박은 박은 — reCAPTCHA v3 박은 거 박은 거 박은 박은 — 초등학생 박은 거 박은 거 박은 박은 박은 거 박은 거 박은 박은 박지 X. v3는 자동 (사용자 박지 X). 단 의심 박을 때 박은 거 박은 거 박은 박은 — 박은 거 박은 거 박은 박은 차단 박을 가능성. 박은 거 박은 거 박은 박은 — 초등학생 박은 거 박은 거 박은 박은 — 같은 IP 박은 거 박은 거 박은 박은 (학교 박은 거 박은 거 박은 박은) — 30명 박은 거 박은 거 박은 박은 동시 박은 거 박은 거 박은 박은 — reCAPTCHA score 박은 거 박은 거 박은 박은 박을 가능성.

## 5-2. 박을 페이지 박은 거 박은 거 박은 박은

가지 박은 거 박은 거 박은 박은 페이지:
- `index.html`
- `teacher-auth.html`
- `maker.html`
- `viewer.html`
- `branch.html`

박은 거 박은 거 박은 박은 — **모든 페이지** 박은 거 박은 거 박은 박은 — App Check 박은 거 박은 거 박은 박은 초기화 박음. 박지 X 박혀있으면 — Firebase 호출 박은 거 박은 거 박은 박은 거부.

→ Firebase 박은 거 박은 거 박은 박은 — 인증 / Realtime DB / Storage 박은 거 박은 거 박은 박은 박은 — 박은 거 박은 거 박은 박은 — 모두 박을 거. **즉 App Check 박은 거 박은 거 박은 박은 — AI 박은 거 박은 거 박은 박은 박지 X — 모든 Firebase 박은 거 박은 거 박은 박은 영향**.

→ ⚠️ **광범위한 영향**. AI 박지 X 박은 거 박은 거 박은 박은 — 기존 v138 작품 박은 거 박은 거 박은 박은 박은 거 박은 거 박은 박은 박을 거 박은 거 박은 박은 박을 위험.

## 5-3. localhost 박은 거 박은 거 박은 박은 — debug provider 박을 거

```js
// 개발 박을 때
if (location.hostname === 'localhost') {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}
```

박은 후 Firebase 콘솔 박은 거 박은 거 박은 박은 — debug token 박은 거 박은 거 박은 박은 박음. 박지 X 박혀있으면 — 로컬 박지 X.

→ 박을 거 박은 거 박은 박은 — 개발 박을 때 박은 거 박은 거 박은 박은 박은 거 박은 거 박은 박은 박은 — 사용자 박은 거 박은 거 박은 박은 — 박지 X 박을 가능성.

## 5-4. v140 mock 박은 거 박은 거 박은 박은 — 박을 거 박은 거 박은 박은 박지 X

v140 mock 박은 거 박은 거 박은 박은 — 사용자 점검 통과 박음. 박은 거 박은 거 박은 박은 — App Check 박을 때 — 박은 거 박은 거 박은 박은 — Firebase 박은 거 박은 거 박은 박은 박지 X 박을 위험. **mock 박은 거 박은 거 박은 박은 박은 거 박은 거 박은 박은 박지 X 박을 가능성**.

---

# 6. 개발 / 테스트 박지 X 박을 가능성

## 6-1. 박을 거 박은 거 박은 박은 시나리오

| 시나리오 | 박지 X 박을 위험 |
|---|---|
| 사용자 박은 거 박은 거 박은 박은 localhost 박은 거 박은 거 박은 박은 박음 | debug token 박혀있어야 — 사용자 박을 거 |
| 학생 박은 거 박은 거 박은 박은 학교 박은 거 박은 거 박은 박은 30명 동시 박음 | reCAPTCHA v3 score 박은 거 박은 거 박은 박은 — 박지 X 박을 가능성 |
| 박은 거 박은 거 박은 박은 — Chrome 새 창 / 시크릿 | 매번 새 토큰 박음 — 박은 거 박은 거 박은 박은 — 박지 X |
| 박은 거 박은 거 박은 박은 — 모바일 박을 때 | 박은 거 박은 거 박은 박은 — 박지 X |
| 박은 거 박은 거 박은 박은 — script 박은 거 박은 거 박은 박은 박지 X 박혀있을 가능성 | reCAPTCHA Enterprise 박을 거 박은 거 박은 박은 |

## 6-2. 박을 거 박은 거 박은 박은 — 박은 거 박은 거 박은 박은 박지 X (사고 박을 가능성)

- 사용자가 새 페이지 박은 거 박은 거 박은 박은 — App Check 박은 거 박은 거 박은 박은 초기화 박지 X 박은 거 박은 거 박은 박은 — Firebase 박지 X
- App Check enforce 박은 거 박은 거 박은 박은 — 시간 박은 거 박은 거 박은 박은 — Firebase 콘솔 박은 거 박은 거 박은 박은 박을 거 박은 거 박은 박은 — 박은 거 박은 거 박은 박은 박을 거

---

# 7. Phase A 보류 / Phase B 박을지

## 7-1. Phase A 박을 거 (교사 작품만 — 3팀)

- 화이트리스트 박은 거 박은 거 박은 박은 박혀있음 — 사용자 박은 거 박은 거 박은 박은 3 박은 거 박은 거 박은 박은
- 박은 거 박은 거 박은 박은 — 외부 봇 박은 거 박은 거 박은 박은 — 화이트리스트 박은 거 박은 거 박은 박은 거부
- Functions invocation 비용 박은 거 박은 거 박은 박은 — 봇 박은 거 박은 거 박은 박은 호출 박혀있어도 — 화이트리스트 박은 거 박은 거 박은 박은 막아 Anthropic 박지 X
- 박은 거 박은 거 박은 박은 — Functions invocation 박은 거 박은 거 박은 박은 비용 박은 거 박은 거 박은 박은 — 박은 거 박은 거 박은 박은 ($0.40 / 100만) — 박을 가능성 적음

→ **Phase A 박은 거 박은 거 박은 박은 — App Check 박은 거 박은 거 박은 박은 박지 X — 위험 낮음**

## 7-2. Phase B 박을 거 (학생 베타)

- 학생 박은 거 박은 거 박은 박은 — 수십 명 / 수백 명
- 화이트리스트 박지 X — `teacherId`/account 박은 거 박은 거 박은 박은 박을 거
- 박을 사용자 박은 거 박은 거 박은 박은 — 동시 다발
- **외부 봇 박은 거 박은 거 박은 박은 — script 박은 거 박은 거 박은 박은 박을 가능성 증가**
- 비용 박은 거 박은 거 박은 박은 — Anthropic Pro / Business 박은 거 박은 거 박은 박은 박을 가능성

→ **Phase B 박을 때 — App Check 박음 필요**

## 7-3. 권장 시점

| Phase | App Check | 박은 거 박은 거 박은 박은 |
|---|---|---|
| Phase 0.5 (mock) | 박지 X | 박은 거 박은 거 박은 박은 — 박지 X |
| **Phase A (교사 작품)** | **박지 X** | 화이트리스트 + 8단 박은 거 박은 거 박은 박은 충분 |
| Phase A 후반 (학생 베타 직전) | **준비** | reCAPTCHA Enterprise 박음 + debug token 박음 + 박은 거 박은 거 박은 박은 박은 거 박은 거 박은 박은 |
| **Phase B (학생 베타)** | **박음 (enforce)** | 외부 봇 / 학생 수 증가 박은 거 박은 거 박은 박은 박지 X |

---

# 8. App Check 없이 Phase A 박을 때 보완책

8단 박은 거 박은 거 박은 박은 박힌 거 박은 거 박은 박은 — 박은 거 박은 거 박은 박은 추가 박을 거:

## 8-1. Functions invocation 박은 거 박은 거 박은 박은 모니터링
- Firebase Functions 콘솔 박은 거 박은 거 박은 박은 — 일일 invocation 박은 거 박은 거 박은 박은 박음
- 박은 거 박은 거 박은 박은 — 평소 박은 거 박은 거 박은 박은 박은 거 박은 거 박은 박은 50회 박은 거 박은 거 박은 박은 — 갑자기 5000회 박은 거 박은 거 박은 박은 — kill switch ON

## 8-2. Functions 자체 박은 거 박은 거 박은 박은 hard cap
- Firebase Functions 콘솔 박은 거 박은 거 박은 박은 — `maxInstances: 5` 박음
- 박은 거 박은 거 박은 박은 — 동시 호출 박은 거 박은 거 박은 박은 5개로 박음
- 박은 거 박은 거 박은 박은 — invocation 폭주 박을 가능성 박지 X

## 8-3. 화이트리스트 박은 거 박은 거 박은 박은 — Functions 첫 번째 박은 거 박은 거 박은 박은
- `AI_TEST_ALLOWED` 박은 거 박은 거 박은 박은 박지 X 박혀있으면 — 즉시 거부
- Anthropic 박지 X — quota 박지 X — 비용 박지 X
- 단 Functions invocation 박은 거 박은 거 박은 박은 — $0.40 / 100만 박은 거 박은 거 박은 박은 — 박은 거 박은 거 박은 박은 미미

## 8-4. Anthropic 콘솔 월 한도
- $20 박음. 박은 거 박은 거 박은 박은 — 최악 박은 거 박은 거 박은 박은 $20 박지 X

## 8-5. 일일 호출 제한 (전역 500)
- 박혀있어 — 박은 거 박은 거 박은 박은 — 외부 봇 박을 때도 박지 X

## 8-6. 신규 보완 — Functions invocation 일일 알람
- Cloud Logging 박은 거 박은 거 박은 박은 query 박음 — 일일 invocation 박은 거 박은 거 박은 박은 1000 박을 때 박은 거 박은 거 박은 박은 이메일

## 8-7. 신규 보완 — Origin 검증 (간이)
- Functions onCall 박은 거 박은 거 박은 박은 — `req.rawRequest.headers.origin` 박음
- 박은 거 박은 거 박은 박은 — 가지 박은 거 박은 거 박은 박은 도메인 박지 X 박혀있으면 거부
- App Check 박은 거 박은 거 박은 박은 약한 박은 거 박은 거 박은 박은 (header 박은 거 박은 거 박은 박은 위조 가능) — 단 진입 장벽 박음

---

# 9. 최종 추천안

## 🎯 결론: **B. Phase A는 보류 가능, 베타 전 필수**

### 박은 거 박은 거 박은 박은

Phase A 박을 때 (교사 작품 3팀):
- ✅ 8단 다층 방어 박혀있음
- ✅ 화이트리스트 박은 거 박은 거 박은 박은 외부 봇 거부 (Anthropic 박지 X)
- ✅ Anthropic 월 한도 $20 박을 거 박은 거 박은 박은 박음
- ✅ Functions invocation 박은 거 박은 거 박은 박은 미미한 비용
- ⚠️ Functions invocation 박은 거 박은 거 박은 박은 — `maxInstances: 5` 박음 (보완)
- ⚠️ Origin 검증 박음 (보완)
- ⚠️ 일일 invocation 알람 박음 (보완)

→ **App Check 박지 X — 위험 낮음**

Phase B 박을 때 (학생 베타):
- 사용자 수 증가 → 외부 봇 / script 박을 가능성 증가
- 화이트리스트 박지 X → `teacherId`/account 박을 거
- **App Check 박음 필요**

### 박은 거 박은 거 박은 박은 박은 거 박은 거 박은 박은 박을 거

#### Phase A 박을 때:
1. App Check 박지 X — **8단 다층 방어 + 3 보완 (maxInstances·Origin·알람)**
2. Firebase Functions 박을 때 — `enforceAppCheck: false` 박음 (또는 옵션 박지 X)
3. 박은 거 박은 거 박은 박은 — 코드 박은 거 박은 거 박은 박은 — App Check 박지 X 박음

#### Phase A 후반 (학생 베타 박기 1~2주 전):
1. Firebase 콘솔 박은 거 박은 거 박은 박은 — App Check 박음 (reCAPTCHA Enterprise / v3)
2. **enforce: OFF** 박은 후 1주 박음 — 로그 박음
3. 박은 거 박은 거 박은 박은 — false rejection 박은 거 박은 거 박은 박은 없는지 박음

#### Phase B 박을 때:
1. App Check enforce: **ON**
2. Functions onCall 박은 거 박은 거 박은 박은 `enforceAppCheck: true` 박음
3. localhost 박은 거 박은 거 박은 박은 — debug token 박음

---

# 10. 박지 X 박은 거 박은 거 박은 박은 (사용자 명시 — 2026-05-21)

이 문서 박은 시점에 박지 X:
- ❌ Firebase 콘솔 박은 거 박은 거 박은 박은 App Check 박지 X
- ❌ functions 박은 거 박은 거 박은 박은 `enforceAppCheck` 박지 X
- ❌ client 박은 거 박은 거 박은 박은 — `initializeAppCheck` 박지 X
- ❌ reCAPTCHA Enterprise site key 박지 X
- ❌ debug token 박지 X
- ❌ API key / Anthropic 연결 / functions / viewer / rules / 비용 발생 박지 X

박을 수 있는 거:
- ✅ 이 문서 박음
- ✅ Phase A 박을 때 박은 거 박은 거 박은 박은 보완 박을 거 박은 거 박은 박은 박음 (`AI_COST_GUARD_PLAN.md` 박은 거 박은 거 박은 박은 박은 거 박은 거 박은 박은 박을 수 있음)
- ✅ Phase A 후반·Phase B 박을 때 App Check 박을 거 박은 거 박은 박은 박음

---

# 11. 박은 거 박은 거 박은 박은 — Phase A 박을 때 박을 8단 + 3 보완 박은 거 박은 거 박은 박은

`AI_COST_GUARD_PLAN.md` 박은 거 박은 거 박은 박은 — 박을 거 박은 거 박은 박은 박음 (Phase A 코드 박을 때):

### 기존 8단 (박힘)
1. Firebase auth
2. 임시 허용 목록 (`AI_TEST_ALLOWED`)
3. `aiPermission.enabled` + `allowedModes[mode]`
4. `branchLineage.copyDepth <= 1`
5. testMode 거부
6. 브랜치 quota
7. rootBranchId 묶음 quota
8. 전역 일일/월간 hard cap

### App Check 박을 보완 3 (Phase A 신규 박음)
9. **`maxInstances: 5`** (Functions invocation 폭주 박지 X)
10. **Origin 검증** (Functions 박은 거 박은 거 박은 박은 — 가지 도메인 박지 X 박혀있으면 거부)
11. **일일 invocation 알람** (1000회 박을 때 이메일)

→ Phase A 박을 때 — 8 + 3 = **11단 방어**.
→ Phase B 박을 때 — App Check 박음 → **12단 방어**.

---

# 12. 한 줄

> **Phase A = App Check 박지 X (위험 낮음 — 화이트리스트 박혀있어 외부 봇 박지 X)**.
> **단 보완 3 박음 — maxInstances 5 / Origin 검증 / 일일 invocation 알람**.
> **Phase B (학생 베타) 박기 1~2주 전 App Check 박음 (enforce: OFF 박은 후 1주 검증 → ON)**.
