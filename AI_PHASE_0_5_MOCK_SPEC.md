# 가지 AI — Phase 0.5 mock 명세 (실 API 호출 금지)

> 입력: AI_MASTER_PLAN_CLAUDE_v3 + AI_DECISIONS_FINAL + **AI_POLICY_V140.md (새 정책)**
> 시점: 2026-05-20
> 위치: `/Users/dobuk/Downloads/picturebook-repo/AI_PHASE_0_5_MOCK_SPEC.md`
> 상태: **문서 작성만 — 코드 박지 X**

## ⚠️ v140 정책 박힘 (2026-05-20) — v139 mock 박힌 거 옛 흐름

`AI_POLICY_V140.md` 박힌 새 정책 박혔음. v139 mock 박힌 거 (commit `1360644`)는 **초기 흐름 검증용 옛 mock**. 새 정책 박힌 거와 충돌하는 핵심:

| 영역 | v139 mock (옛) | v140 (새) |
|---|---|---|
| AI 적용 | `_rtSaveBody`로 원본 본문 덮어쓰기 | `aiVariants.final` 별도 저장 + 토글 (X 덮어쓰기) |
| 원본 마감 | 검사 X | 운영 필수 / mock은 테스트 모드로 우회 |
| 교사 허용 | 검사 X | `aiPermission.enabled` 박혀야 |
| copyDepth | 검사 X | 0/1까지만 |
| 1단계 흐름 | 1회 호출 → 1 결과 → 즉시 적용 | 최대 3회 후보 → 선택 → 미세 수정 → 마감 |
| mock quota | 7가지 환불 (차감 그대로) | reset 가능 (`window.__resetAiMockUsage`) |

→ **Phase A 박기 전 또는 v140 mock 박을 때** aiVariants 토글 방식 + 후보 3회 + 테스트 모드 박은 거 박혀야 함. 자세히는 아래 0-1 박힘.

## 0-1. v139 mock → v140 mock 박힐 거 (개요)

v140 정책 박힌 mock은 별도 단계 박힘 — v140 mock (사용자 명시 박힐 때 박음). 박은 핵심:

1. **`_rtSaveBody` 박은 거 박지 X** — `aiVariants.textS1.final` 별도 저장 흐름 박을 거
2. **테스트 모드 UI 박음** — 화면 상단 `TEST MODE` 라벨, `[원본 마감 우회]` 토글
3. **mock quota reset 박음** — `window.__resetAiMockUsage()` 콘솔 함수 / `[테스트 quota 초기화]` 버튼
4. **1단계 후보 3회** — 1회 호출 = 1 후보 세트, 누적 3회까지 표시, 선택·미세 수정·마감 흐름
5. **aiPermission mock** — 기본 ON 박힘 (테스트라). 실 API 단계는 검사 강제
6. **copyDepth mock** — 기본 0 또는 1 박힘 (테스트라)

v140 mock 코드는 **아직 박지 X** — 사용자 명시 박힐 때 박음.

---

# 0. 이 문서의 역할

- Phase 0.5 단계의 **mock 구현 명세**
- **실 AI API 호출 X** — 가짜 응답으로 모든 흐름 검증
- 사용자가 v3 + 결정 + 4개 문서 최종 OK 박은 후 박을 거
- **이 문서 자체는 코드 X — 문서만**

---

# 1. ⚠️ 절대 금지 사항 (Phase 0.5에서)

다음은 Phase 0.5 단계에서 **절대 박지 X**:

1. ❌ **실 Anthropic / OpenAI API 호출** — mock 응답만
2. ❌ **실 API key 박기** — 환경변수 빈 값
3. ❌ **실 학생 작품 박기** — 교사 테스트 작품만
4. ❌ **실 비용 발생** — mock 비용 0
5. ❌ **prompts/*.md 전문 작성** — 원칙만 (AI_PROMPT_POLICY.md 박힘)
6. ❌ **Phase A 박을 거**:
   - 실 quota 트랜잭션
   - 실 비용 임계치
   - 실 학부모 동의 검사
7. ❌ **이미지 AI 박기** — Phase D 후순위
8. ❌ **3단계 후보 박기** — Phase C 후순위
9. ❌ **2단계 발전 박기** — Phase B 후순위 (mock 단계엔 1단계 + 검사만)

---

# 2. Phase 0.5 박을 거 (요약)

| 영역 | 박을 거 |
|---|---|
| Firebase | functions/ 폴더 생성 (mock 함수만) |
| 클라이언트 | viewer-ai.js 신규 + viewer.html 진입 버튼 |
| CSS | pb-ai.css 신규 |
| 저장 | ai-suggestions / ai-history / ai-usage mock 노드 |
| UI | 모드 선택 모달 + 결과 비교 모달 |
| 흐름 | 작품 snapshot → mock 호출 → 결과 → 선택 적용 |
| 검증 | 잠금·race·_rtSaveBody·history 모두 검증 |

---

# 3. Functions mock 명세

## 3-1. functions/ 폴더 구조 (신규)

```
functions/
├── package.json                    # firebase-functions, firebase-admin
├── index.js                        # 함수 export
├── mock/
│   ├── callTextAiBatch.js          # 텍스트 1단계 mock
│   └── callWorkCheck.js            # 작품 검사 mock
└── README.md                       # mock 명세 + 사용 방법
```

## 3-2. callTextAiBatch (mock) — 텍스트 1단계

### Signature
```js
exports.callTextAiBatch = functions.https.onCall(async (data, context) => {
  // data: { sceneSnapshots, strength, scope: 'work' }
  // return: { ok, suggestionId, results: { sceneId: { revisedText, ... } } }
});
```

### mock 동작
- **API 호출 X**
- 입력 받은 sceneSnapshots 그대로 활용
- 각 장면별로 **mock 변경 박음**:
  - 약 30% 장면은 `skip: true, reason: "이미 자연스러워요"`
  - 나머지 70% 장면은 mock 변경 (예: 마지막에 " (AI 다듬은 mock)" 박음)
- 응답 지연 시뮬레이션: 2~5초 setTimeout

### mock 출력 예
```json
{
  "ok": true,
  "suggestionId": "mock_sug_20260520_abc",
  "strength": 1,
  "scope": "work",
  "globalSummary": "MOCK: 22개 장면 중 14개 다듬을 제안 박혔어요.",
  "results": {
    "1": {
      "revisedText": "마루와 하루가 길을 가다가 멧돼지에게 쫓겼다. (mock)",
      "summary": "MOCK: 띄어쓰기 정리",
      "changes": ["띄어쓰기"],
      "preservedCheck": { "charactersUnchanged": true },
      "warnings": []
    },
    "2": { "skip": true, "reason": "이미 자연스러워요 (mock)" },
    "3": { "revisedText": "... (mock)", "summary": "...", "changes": ["..."], "preservedCheck": { ... }, "warnings": [] }
  },
  "isMock": true
}
```

> 1단계는 `safeAddition` / `creativeAddition` 박지 X (`prompts/text-strength-1.md v3`). 위 예시는 v3 정합. 2단계는 두 필드 박힘 (`AI_PROMPT_POLICY.md` 4-9 박힘).

`isMock: true` 박힘 — 사용자가 보는 비교 모달에 "MOCK 데이터" 배지.

## 3-3. callWorkCheck (mock) — 작품 검사

### Signature
```js
exports.callWorkCheck = functions.https.onCall(async (data, context) => {
  // data: { sceneSnapshots, routes }
  // return: { ok, checkId, categories: { spelling, coherence, ... } }
});
```

### mock 동작
- API 호출 X
- 각 카테고리별 mock 항목 박음:
  - 맞춤법: 첫 2개 장면에서 가짜 오류
  - 유기성: 작품에서 1~2개 가짜 약점
  - 캐릭터 일관성: 0~1개
  - 분기 흐름: storyAnalyzer 실 결과 활용 가능

### mock 출력 예
```json
{
  "ok": true,
  "checkId": "mock_chk_20260520_xyz",
  "type": "check",
  "isMock": true,
  "categories": {
    "spelling": [
      { "sceneId": "1", "position": 5, "wrong": "쫓긴다", "correct": "MOCK: 쫓긴다" }
    ],
    "coherence": [
      { "sceneIdFrom": "2", "sceneIdTo": "5", "issue": "MOCK: 마루 위치 모순 (가짜 경고)" }
    ],
    "characterConsistency": [],
    "branchFlow": []
  }
}
```

## 3-4. Functions 배포 (mock)

### emulator 사용 (가장 안전)
- `firebase emulators:start --only functions`
- 로컬 9000번대 포트
- Firebase Blaze plan 없어도 박을 수 있음
- 학생 환경에 배포 X — 개발자 로컬만

### 또는 Firebase 배포 (선택)
- Blaze plan 박혀있어야 박을 수 있음
- mock도 cold start 박힘 (1~3초)
- production 환경에 배포 시 안전망: 환경변수 `MOCK_ONLY=true` — 실 API 호출 코드 박혀있어도 차단

---

# 4. viewer.html 진입점 (신규)

## 4-1. 위치
viewer.html 상단 — 기존 버튼 옆.

```
[감상 테스트] [🤖 AI 작품 다듬기] [루트보기] [구조 보기] [브랜치 화면으로] [저장]
```

## 4-2. 버튼 디자인 (GPT v3)
- 보조 강조 (메인 CTA X)
- 아이콘 🤖 사용
- 지나치게 화려한 색 X

## 4-3. 실행 조건 박힘
- 본문 있는 장면 1개 이상 — 1단계 + 검사 가능
- 조건 미충족 = 버튼 disabled + tooltip "먼저 본문을 더 작성해주세요"

---

# 5. viewer-ai.js (신규) — 작품 단위 흐름

## 5-1. 파일 위치
`/Users/dobuk/Downloads/picturebook-repo/viewer-ai.js`

## 5-2. 주요 함수 (mock 단계)

### `openAiModal()` — 모드 선택 모달
- viewer.html [AI 작품 다듬기] 클릭 시
- 실행 조건 검사 (장면 수 등)
- 첫 사용자: 안내 모달 박음
- 모드 선택 (1단계 / 검사 — mock 단계엔 2단계·3단계·이미지 X)

### `callMockTextS1()` — 1단계 mock 호출
1. 잠금 검사 (`isViewerLockedByOther`)
2. `_flushPendingSave` 호출
3. UI lock 박음 (반투명 overlay + 점 3개)
4. AbortController 박음
5. 작품 snapshot 박음 (모든 scene.body)
6. Functions mock 호출
7. 응답 받으면 비교 모달 박음

### `callMockWorkCheck()` — 검사 mock 호출
- 위와 비슷
- 결과는 진단 모달 (수정 X)

### `renderComparisonModal(suggestion)` — 비교 모달
- 장면 목록 + 체크박스
- 좌우 split (원문 | AI 제안)
- skip 장면은 회색
- [모두 적용] [선택 적용] [전체 취소]
- MOCK 배지 박힘

### `applySelectedScenes(suggestion, selectedIds)` — 선택 적용
1. 잠금 재검사
2. 각 선택 장면:
   - originalSnapshot vs 현재 body 비교
   - 다르면 경고 (mock에서도 박음)
   - ai-history mock 저장
   - **`_rtSaveBody` 호출** (v138 함수 재사용)
3. suggestion status:
   - 모두 적용 → `applied`
   - 일부 적용 → `partially_applied`
4. UI 갱신

### `cancelMockCall()` — 호출 취소
- AbortController abort
- mock이라 quota 무관
- UI lock 해제

## 5-3. v138 코드 재사용 (mock 단계에서도)

- `_rtSaveBody(num, value)` — 적용 시 호출 (변경 X)
- `_rtSyncSceneField(num, field, value)` — 메모리 동기
- `_flushPendingSave()` — 호출 전 큐 비우기
- `isViewerLockedByOther(num)` — 잠금 검사
- `_scheduleViewerFrameReRender()` — 적용 후 미리보기
- `findAllRoutes()` — 검사 mock 입력

---

# 6. pb-ai.css (신규) — AI UI 스타일

## 6-1. 박을 클래스

### 진입 버튼
- `.viewer-ai-trigger` — viewer 상단 버튼

### 모드 선택 모달
- `.ai-modal-overlay`
- `.ai-modal`
- `.ai-mode-card` (1단계 / 검사 / 2단계 disabled 등)
- `.ai-mode-card--disabled`

### 호출 중 UI lock
- `.ai-loading-overlay` (반투명)
- `.ai-loading-content`
- `.ai-loading-dots` (점 3개 animation)
- `.ai-loading-cancel-btn`

### 비교 모달
- `.ai-comparison-modal`
- `.ai-scene-row` (장면별)
- `.ai-scene-row--skip` (회색)
- `.ai-scene-checkbox`
- `.ai-scene-original` (좌)
- `.ai-scene-suggested` (우)
- `.ai-diff-highlight` (변경 부분 강조)
- `.ai-apply-btn` / `.ai-cancel-btn`

### 검사 모달
- `.ai-check-modal`
- `.ai-check-category` (맞춤법/유기성/캐릭터/분기)
- `.ai-check-item`
- `.ai-jump-scene-btn`

### MOCK 배지
- `.ai-mock-badge` (눈에 띄게 — "MOCK" 또는 "테스트")

## 6-2. 디자인 원칙

- v138 톤 시스템과 충돌 X
- viewer 기존 디자인 (warm paper #fffaee, 코랄 #c66f4a) 따름
- 모달 z-index는 viewer의 다른 모달보다 위 (또는 동등)
- 모바일/태블릿 반응형

---

# 7. mock 저장 노드 — ai-suggestions / ai-history / ai-usage

## 7-1. 위치 (v3 그대로)

```
classes/{classId}/teams/{teamName}/
├─ ai-suggestions/{suggestionId}  # mock 박힘
├─ ai-history/{sceneId}/{historyId}  # mock 박힘
└─ ai-usage/work  # mock 박힘
```

## 7-2. mock suggestion 박는 거

v3 8-1·8-2 그대로. 단 `isMock: true` 박힘.

```json
{
  "suggestionId": "mock_sug_...",
  "aiType": "text",
  "strength": 1,
  "scope": "work",
  "isMock": true,
  ...
}
```

## 7-3. mock history 박는 거

v3 그대로. 단 `isMock: true` 박힘.

## 7-4. mock usage

```json
{
  "textS1Used": 0,  // mock 단계 — 박지 X 박힘 (사용자가 정확한 흐름 확인)
  "textS2Used": 0,
  "textS3Used": 0,
  "textCheckUsed": 0,
  "totalCostUsd": 0,
  "isMock": true,
  "lastUsedAt": ...
}
```

### mock quota 정책 (2026-05-20 v139 step4 박힘 — 갱신)

**옛 정책**: "mock 단계엔 quota 차감 X (단 UI에는 표시)"
**새 정책 (v139 step4)**: **mock 단계도 quota 차감 박음** — 단 localStorage 기반 (`LS_MOCK_USAGE_KEY`).

이유:
- 7가지 환불 정책 (AI_SAFETY_COST_RULES 5-1)을 mock 단계에서 검증해야 Phase A 박을 때 안전
- 사용자 점검 시나리오 8 (quota 차감/환불 흐름) 박을 수 있어야 함
- 실 Firebase ai-usage 노드는 박지 X — localStorage만 (rules 변경 X)

**MOCK_QUOTA 값** (viewer-ai.js:42):
```
const MOCK_QUOTA = { s1: 3, s2: 1, s3: 1, check: 5 };
```

**7가지 환불 정책 mock 구현** (viewer-ai.js:463 `_consumeQuota` / :472 `_refundQuota`):
| 시나리오 | mock 박은 거 |
|---|---|
| 호출 전 취소 (모드 모달에서 닫기) | 차감 X |
| 호출 도중 [취소] | 차감 그대로 (환불 X) — AI_SAFETY_COST_RULES 5-1 #2 |
| mock 호출 실패 / network 시뮬 | 환불 |
| 비교 모달 [전체 취소] | 차감 그대로 (suggestion = dismissed) |
| partially_applied | 차감 그대로 (24h 내 재호출 가능 UI 박힐 거) |

**Phase A 박을 때 변경**: localStorage → Firebase `ai-usage/{classId}/{teamName}/{YYYY-MM}` 노드 + Functions 트랜잭션.

### v140 추가 — mock quota reset 박을 거

테스트 편의를 위해 mock quota는 reset 가능해야 박힘 (v140 0-3 박힘):

**콘솔 함수**:
```js
window.__resetAiMockUsage();  // 모든 mock 사용량 0으로 reset
window.__resetAiMockUsage('s1');  // 특정 모드만 reset
```

**UI 버튼** (테스트 모드에서만 박힘):
- `[테스트 quota 초기화]` — viewer 편집 상단 또는 모드 모달 안

**핵심**:
- mock quota = `mockUsage` (localStorage `LS_MOCK_USAGE_KEY`)
- 실 quota = `realUsage` (Firebase `ai-usage/...`)
- **두 저장소 분리** — reset이 실 데이터 안 박음
- 실 API 호출에 `window.__resetAiMockUsage()` 박혀도 무시 (Functions 단에서 막음)

---

# 7-extra. 테스트 모드 (v140 박음)

`AI_POLICY_V140.md` 0-2·0-3·0-4 박힌 거. mock 단계 검증 박혀 막히지 않게.

## 7-extra-1. 진입 조건 (보류 — 결정 항목 #42)

후보:
- 교사 계정 박힘만
- URL `?test=1` 박힘
- 환경 박힌 거 (`localhost` / `firebase emulator`)

## 7-extra-2. UI 표시 필수

- 화면 상단 고정 라벨: **`TEST MODE — 개발 테스트 모드`** (빨간/주황 배지)
- AI 모드 모달에 안내: "지금 테스트 모드 박혔어요. 실 AI 호출 안 됩니다."

## 7-extra-3. 우회 가능한 거 (mock 전용)

| 영역 | 운영 | 테스트 모드 mock |
|---|---|---|
| 원본 최종 마감 | 필수 | 우회 가능 (`[TEST] 마감 가정`) |
| 교사 AI 허용 ON | 필수 | 기본 ON (테스트라) |
| copyDepth ≤ 1 | 필수 | 기본 0 또는 1 |
| quota | 차감 박음 | reset 가능 / 완화·비활성화 가능 |
| `contentLockedByAi` | 적용 | (선택) 우회 가능 |

## 7-extra-4. 절대 박지 X (testMode 우회 한계)

- ❌ 실 Anthropic / OpenAI / Gemini API 호출
- ❌ 실 API key 박힌 거 testMode로 노출
- ❌ 실 학생 데이터에 mock 박는 거
- ❌ Functions에서 `req.testMode === true` 박혀있어도 실 API 호출 단에서 거부

---

# 8. mock 단계 검증 시나리오 (사용자 점검 박을 거)

mock 박은 후 사용자가 박을 거 (이거 통과 박혀야 Phase A 박을 수 있음):

## ✅ 8-0. 사용자 점검 통과 박힘 (2026-05-21)

**v140 mock 박은 거 박은 거 박은 박은 — 사용자 점검 통과 박음** (사용자 명시 박힘).

체크리스트 박힌 거 (15 항목 모두 합격):

| # | 항목 | 결과 |
|---|---|---|
| 1 | TEST MODE 배지 박힘 (좌상단 빨강) | ✅ |
| 2 | 테스트 quota reset 박힘 (모드 모달 4 버튼 / 콘솔 함수 6) | ✅ |
| 3 | 팀별 quota 분리 박힘 (0000 / 은규 / 예지유은인우 namespace) | ✅ |
| 4 | 1단계 후보 1회·2회·3회 누적 박힘 | ✅ |
| 5 | quota 0이어도 기존 후보 재진입 박힘 | ✅ |
| 6 | 후보 모달 레이아웃 박힘 (95vw / 세로 / 90vh) | ✅ |
| 7 | 바깥 클릭으로 후보/편집 모달 박지 X (lock 박음) | ✅ |
| 8 | 후보 선택 박힘 ([이 후보 선택하기]) | ✅ |
| 9 | AI 1단계 편집 중 textarea 수정 박힘 | ✅ |
| 10 | AI 1단계 저장/마감 박힘 | ✅ |
| 11 | aiVariants.textS1.final 저장 박힘 (localStorage) | ✅ |
| 12 | 원본/AI 1단계 토글 박힘 (fixed top center) | ✅ |
| 13 | 원본 body 덮어쓰지 X 박힘 (scenes/{id}/body 그대로) | ✅ |
| 14 | 새로고침 후 토글/결과 박힘 | ✅ |
| 15 | 감상 모드 — AI 버튼/토글 박지 X (isEdit gate) | ✅ |

### 통과 박힌 의미
- v139 mock = AI 버튼/모달 흐름 박은 거 박은 거 박은 박은 검증
- **v140 mock = 원본 덮어쓰기 X aiVariants 토글 구조 박은 거 박은 거 박은 박은 검증**
- **AI 1단계 실 API 박기 전 껍데기 구조 박은 거 박은 거 박은 박은 통과 박힘**
- 다음 = Phase A 준비 조건 박은 거 박은 거 박은 박은 (`AI_PHASE_A_PREP_STATUS.md` 박음)

## 8-1. 정상 흐름
1. viewer 상단 [AI 작품 다듬기] 클릭 → 모드 모달 박힘
2. [1단계 정돈] 클릭 → UI lock + 점 3개 + 분석 장면 수
3. 2~5초 후 비교 모달 박힘 (MOCK 배지)
4. 장면 목록 박힘 (스크롤)
5. 일부 장면 체크 → [선택 적용]
6. **적용 후 viewer 미리보기 갱신** (해당 장면 본문 바뀜 — mock 데이터)
7. 모달 닫힘 + 안내 박힘
8. 다시 viewer에서 본문 확인 — mock 적용 박힘 (실 Firebase RTDB 또는 emulator)
9. 새로고침 후 mock 적용 박힌 거 유지

## 8-2. 잠금 흐름
1. 다른 사용자가 잠금 잡고 있을 때 [AI 작품 다듬기] 클릭
2. mock도 잠금 거부 박힘 — 안내 모달
3. 또는 잠금 자동 인수 박힘 — 사용자 결정 따라

## 8-3. race condition
1. 사용자 본문 박음 (입력 중)
2. [AI 작품 다듬기] 클릭 → `_flushPendingSave` 박힘
3. mock 호출 → 결과 → 적용
4. 적용 직전 — originalSnapshot 비교 박힘
5. (mock에서도 검증 흐름 동작 확인)

## 8-4. 취소
1. mock 호출 중 [취소] 클릭
2. UI lock 해제
3. mock 단계도 quota 차감 그대로 (환불 X) — 7가지 환불 정책 #2 박힘 (AI_SAFETY_COST_RULES 5-1)

## 8-5. 결과 모달 — 전체 취소
1. 결과 받음
2. [전체 취소] 클릭
3. suggestion status = `dismissed`
4. mock·실 단계 모두 quota 차감 그대로 (호출 박힌 후 결과 받음 박혔으니 — 7가지 환불 정책 박힘)

## 8-6. partially_applied
1. 결과 받음
2. 5개 장면 중 3개만 체크 → [선택 적용]
3. suggestion status = `partially_applied`
4. 24h 후 같은 suggestion 다시 박을 수 있는 UI 박혀있는지 확인

## 8-7. 작품 검사 (수정 X)
1. [작품 검사] 클릭
2. mock 진단 결과 박힘 (4 카테고리)
3. [장면 X로 이동] 클릭 → viewer에서 해당 장면 다듬기 박힘
4. 진단 모달에 적용 버튼 박지 X (수정 X 확인)

## 8-8. 실행 조건
1. 본문 0개 장면에서 [AI 작품 다듬기] 클릭
2. 1단계 disabled + 안내 "본문을 더 작성해주세요"
3. 검사도 disabled (본문 2+ 조건)

## 8-9. 첫 안내 모달
1. 처음 [AI 작품 다듬기] 클릭
2. 첫 안내 모달 박힘
3. [이해했어요] 클릭
4. 두 번째부터 안 박힘 (localStorage 박음)

## 8-10. 그림 중심형
1. 그림 중심형 장면 박힌 작품
2. AI 호출 시 그림 중심형 본문도 결과에 박힘
3. 적용 후 그림 중심형 본문 글상자 갱신 확인

---

# 9. 박지 X 박을 거 (다시 확인)

mock 단계에서 박지 X 박는 거:

## 9-1. 실 API 박지 X
- ❌ Anthropic SDK 박지 X
- ❌ axios / fetch로 외부 API 박지 X
- ❌ API key 환경변수 박지 X (빈 값으로 박음 — mock 함수가 무시)

## 9-2. 실 비용 박지 X
- mock 비용 0
- 비용 임계치 코드 박지 X (Phase A에 박음)

## 9-3. 학부모 동의 검사 박지 X
- mock 단계엔 검사 함수 자체 박지 X
- Phase A에 박음

## 9-4. 후순위 기능 박지 X
- ❌ 텍스트 2단계
- ❌ 텍스트 3단계 (후보 5개/10개)
- ❌ 이미지 AI
- ❌ AI 사용 통계 (교사 대시보드)
- ❌ 피드백 👍/👎

mock 단계엔 **1단계 + 검사 둘만** (GPT v3 — Phase A에 둘 함께 박음).

## 9-5. prompts/*.md 전문 박지 X
- 원칙만 (AI_PROMPT_POLICY.md)
- 전문은 Phase A 박기 전 합의

## 9-6. 인프라 변경 X
- ❌ Firebase Blaze plan 업그레이드 (emulator로 박음)
- ❌ database.rules.json 변경 X (mock도 기존 권한 박힘 — anonymous auth)
- ❌ storage.rules 변경 X
- ❌ ALLOWED 필드 추가 X (mock은 ai-suggestions/history 노드만 박음 — scenes 본문은 _rtSaveBody로)

---

# 10. mock 단계 commit 흐름 (사용자 작업 패턴)

가지 메모리 "큰 명 끝날 때마다 commit/push + zip" 정신:

```
v139-step1 AI mock 인프라 — functions/ + callTextAiBatch mock
v139-step2 AI mock UI — viewer-ai.js + pb-ai.css + 진입 버튼
v139-step3 AI mock 결과 모달 + 선택 적용 (_rtSaveBody 재사용)
v139-step4 AI mock 작품 검사 (수정 X 진단)
v139-step5 AI mock 검증 통과 — 사용자 점검 OK
v139 통합 — push + zip + 메모리 박음
```

각 step 사용자 점검 박힌 후 다음.

---

# 11. mock → 실 API 전환 시점

다음 박혀있을 때 박을 거:

1. ✓ mock 박힘 + 사용자 점검 10개 시나리오 통과
2. ✓ AI_DECISIONS_FINAL의 mock 무관 6개 외 11개 결정 박힘
3. ✓ Phase 0 진행 조건 5개 박힘
4. ✓ prompts/text-strength-1.md + prompts/work-check.md 합의
5. ✓ 사용자 명시 "Phase A 실 API 박을게요" 박힘

→ Phase A 박을 거.

---

# 12. 한 줄

> Phase 0.5 mock은 **실 API 박지 X, 실 비용 박지 X, 실 학생 데이터 박지 X**. 모든 흐름(UI / 저장 / 적용 / 잠금 / race / partially_applied)을 가짜 응답으로 검증해 Phase A 박기 전 안전망 확보.
