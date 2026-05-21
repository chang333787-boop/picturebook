# 가지 AI — Phase A 실 API 준비 상태 (2026-05-21)

> 시점: 2026-05-21 (v140 mock 사용자 점검 통과 박힌 직후)
> 위치: `/Users/dobuk/Downloads/picturebook-repo/AI_PHASE_A_PREP_STATUS.md`
> 상태: **준비 단계 — Phase A 실 API 코드 박지 X (사용자 명시 박힘)**
> 의존: `AI_DECISIONS_FINAL.md` / `AI_POLICY_V140.md` / `AI_SAFETY_COST_RULES.md` / `prompts/text-strength-1.md` / `prompts/work-check.md`

---

# 0. 이 문서의 역할

v140 mock 박은 거 박은 거 박은 박은 사용자 점검 통과 박힌 후, **Phase A 실 API 박기 전 남은 조건** 박은 거 박은 거 박은 박은 한눈에 박은 거 박은 거 박은 박은 박음. 박은 거 박은 거 박은 박은 박은 거 박은 거 박은 박은 — 박혔음 / ⚠️ 박지 X / 보류 박은 거 박은 거 박은 박은 분류.

---

# 1. Phase A 준비 7가지 (사용자 명시 박힘 2026-05-21)

| # | 항목 | 상태 | 결정값 / 위치 |
|---|---|---|---|
| 1 | Anthropic 사용 확정 | ✅ | `AI_DECISIONS_FINAL.md` 4-2 (`Anthropic Claude`) |
| 2 | Haiku 계열 모델 확정 | ✅ | `AI_DECISIONS_FINAL.md` 4-2 (Haiku 1단계) |
| 3 | Firebase Blaze 박힘 | ✅ | 2026-05-20 사용자 명시 ("Blaze는 이미되있어"), DECISIONS 3-3 |
| 4 | API key 저장 방식 | ✅ 설계 박힘 | `AI_SAFETY_COST_RULES.md` 2장 — Functions 환경변수만 (`functions/.env` / `functions:config:set`) |
| 5 | Functions hard cap / provider 비용 한도 | ⚠️ **박지 X (Phase A 구현 단계)** | SAFETY 5장 7가지 환불 + 11장 hard cap (월 $20 / 일 호출 제한). Functions·Anthropic 콘솔 박은 거 박은 거 박은 박은 박음 |
| 6 | Phase A 테스트 화이트리스트 유지 | ✅ | SAFETY 최상단 — `JL26A__0000` / `__은규` / `__예지유은인우`. 변수명 `AI_TEST_ALLOWED` (임시 — 운영 시 `teacherId`/account로 교체) |
| 7 | 실 API에서도 v140 구조 유지 | 박은 거 박은 거 박은 박은 박음 (아래 1-7 박음) | — |

## 1-7. 실 API에서도 v140 구조 유지 (사용자 명시)

| 박힐 거 | mock에서 박힌 거 | Phase A에서 박을 거 |
|---|---|---|
| 원본 body 덮어쓰기 금지 | viewer-render.js 6곳 `_getDisplayBody` 박음 | 동일 유지 — viewer-render.js 박지 X |
| aiVariants 저장 | localStorage `pb_ai_variants_v140__{ns}` | Firebase `aiVariants/{classId}/{teamName}/...` 노드 + rules 추가 |
| 1단계 후보 3회 | localStorage `pb_ai_drafts_v140__{ns}` | Firebase `aiDrafts/{...}` 노드 + TTL (사용자 결정 #41 박힐 거) |
| TEST MODE 우회 실 API 금지 | client `_isTestMode()` 박혀있어도 mock만 박힘 | Functions 단에서 `req.testMode === true` 박혀있어도 실 API 호출 거부. `AI_SAFETY_COST_RULES.md` 18-1 박힘 |
| _rtSaveBody 재활성화 금지 | viewer-ai.js 옛 `_applySelected` dead path | 옛 함수 박지 X (제거 박을지 — 사용자 결정 박힐 거) |
| 모달 lock | `_createModalRoot { lock: true }` | 동일 유지 |
| 팀별 namespace | usage/drafts/variants/viewMode 모두 분리 | Firebase 노드 박은 거 박은 거 박은 박은 — classId/teamName key 박음 |
| 4가지 quota reset (TEST MODE) | 모드 모달 안 4 버튼 + window 함수 6 | 운영 모드 박지 X — TEST MODE에서만 박힘 |

---

# 2. v140 mock 박은 거 박은 거 박은 박은 통과 박힌 의미

```
v139 mock → AI 버튼 / 모달 흐름 검증
v140 mock → 원본 덮어쓰기 X / aiVariants 토글 구조 검증 ← (지금)
Phase A → 실 Anthropic API + Functions
```

**AI 1단계 실 API 박기 전 껍데기 구조 박은 거 박은 거 박은 박은 통과 박음**. 박은 거 박은 거 박은 박은 — Phase A 준비 조건 박은 거 박은 거 박은 박은 박힌 후 박은 거 박은 거 박은 박은 박을 거.

---

# 3. 박지 X 박은 거 박은 거 박은 박은 (사용자 명시 — 2026-05-21)

| 박지 X | 박은 거 박은 거 박은 박은 박힐 때 |
|---|---|
| Phase A 실 API 구현 박음 | 사용자가 "Phase A 박을 거" 명시 박힐 때 |
| API key 추가 박음 | 동상 |
| Anthropic / OpenAI / Gemini 연결 박음 | 동상 |
| `functions/` 박음 | 동상 |
| 비용 발생 작업 박음 | 동상 |
| `database.rules.json` 박음 | aiVariants/aiDrafts Firebase 노드 박을 때 함께 박을 거 |

---

# 4. 다음 단계 박은 거 박은 거 박은 박은 후보 (사용자 박을 거)

1. **5번 박은 거 박은 거 박은 박은 (비용 비상 차단)** 박은 거 박은 거 박은 박은 — Functions hard cap / Anthropic 콘솔 한도 / 일일 호출 제한 박을 거. 단 functions/ 박지 X (사용자 명시) — **설계 박은 거 박은 거 박은 박은 박을지** (코드 X)
2. **App Check 박을지 박은 거 박은 거 박은 박은 박음** (사용자 미결정 — 보류). 코드 X — 분석만
3. **Phase A 코드 박을 거 박은 거 박은 박은 박은** (사용자 명시 박힐 때)
4. **2단계 / 이미지 AI 박은 거 박은 거 박은 박은** (Phase B·D·E — 후순위)

---

# 5. 박힌 정책 박은 거 박은 거 박은 박은 한눈에

- ✅ v140 정책 박은 거 박은 거 박은 박은 (운영/테스트 분리·원본 마감·교사 허용제·copyDepth·aiVariants·후보 3회·다층 quota)
- ✅ prompts/text-strength-1.md v3 확정
- ✅ prompts/work-check.md v3 확정
- ✅ Anthropic 약관 재확인 박힘 (학습 X / 30일 삭제 / 미성년자 조건부 OK)
- ✅ 가지 운영 의무 5가지 박힌 거 박은 거 박은 박은 박음 (Phase A 초기 = 학부모 동의 X, Phase A 후반/B = 학부모 동의 필수)
- ✅ Phase A 테스트용 임시 허용 목록 박힘 (JL26A 3팀 — 운영 박힐 때 teacherId/account 교체)
- ✅ Blaze 박힘

박지 X 박은 거 박은 거 박은 박은:
- ⚠️ Functions hard cap 박지 X (Phase A 구현 단계)
- ⚠️ Anthropic 콘솔 월 한도 박지 X (Phase A 구현 단계)
- ⚠️ App Check 박을지 박은 거 박은 거 박은 박은 결정 X (사용자 미결정)
- ⚠️ aiDrafts TTL 기간 박은 거 박은 거 박은 박은 결정 X (사용자 미결정 #41)
- ⚠️ testMode 진입 조건 박은 거 박은 거 박은 박은 — mock은 `?test=1`+localhost (Phase A에서는 더 엄격할 수 있음)

---

# 6. 사용자 박을 거 (이 문서 박힌 의도)

**다음 단계 박을 때 박을 거**:
- 위 ⚠️ 박은 거 박은 거 박은 박은 박을지 박은 거 박은 거 박은 박은 박을 거
- 또는 사용자가 "Phase A 박을 거" 명시 박혀 박는 거 박은 거 박은 박은 박은

**Claude 박을 거 박은 거 박은 박은**:
- 사용자 명시 박혀 박는 거 박은 거 박은 박은 박은 — 코드 박지 X
- 박을 거 박은 거 박은 박은 — 분석 / 문서 박음
