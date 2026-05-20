# 가지 AI — 결정 항목 + 진행 조건 (실행용)

> 입력: AI_MASTER_PLAN_CLAUDE_v3 (합의안)
> 시점: 2026-05-20
> 위치: `/Users/dobuk/Downloads/picturebook-repo/AI_DECISIONS_FINAL.md`
> 상태: **실행용 — 사용자 최종 결정 박는 문서**

---

# 0. 이 문서의 역할

- v3 합의안에서 박힌 결정 항목 28개를 **확정/보류/후순위**로 분류
- **구현 금지 조건** 명시
- **Phase 0 진행 조건** 5개
- **mock 가능 조건** vs **실제 API 호출 가능 조건** 분리
- 사용자가 박은 결정만 다음 단계로 진행

---

# 1. ⚠️ 구현 금지 조건 (최상단)

> **AI 기능은 모든 설계가 완벽할 때까지 구현하지 않는다** — 사용자 명시.

다음 중 **하나라도** 박혀있지 X 박힌 상태에서는 코드 한 줄도 박지 X:

## 1-1. 설계 문서
- ✓ AI_MASTER_PLAN_CLAUDE_v3.md (이미 박힘)
- ✓ AI_DECISIONS_FINAL.md (이 문서)
- ✓ AI_PHASE_0_5_MOCK_SPEC.md
- ✓ AI_PROMPT_POLICY.md
- ✓ AI_SAFETY_COST_RULES.md

## 1-2. 사용자 결정
- 아래 28개 항목 중 **확정 박힌 거 OK**
- **보류 박힌 거 사용자 결정 박힘**

## 1-3. Phase 0 진행 조건 5개 (아래 3장)
- 5개 모두 박혀있어야 Phase 0.5 박을 수 있음

## 1-4. mock 또는 실 API 단계 조건 (아래 4장)
- mock 단계 박힌 후 사용자 점검 OK 박혀야 실 API 박음

---

# 2. 사용자 결정 항목 28개 — 확정/보류/후순위 분류

## 분류 기준

- **확정** ✓ — v3에서 사용자·GPT·Claude 3자 합의로 박힌 거. 추가 박을 거 X
- **보류** ⚠️ — 사용자 최종 결정 박혀있어야 다음 단계 박을 수 있음
- **후순위** ⏳ — Phase B 이후 결정. 현재 단계엔 박지 X

---

## 2-1. 확정 항목 (✓ 17개)

다음 17개는 v3 합의안에 박혀있음. 추가 결정 X.

| # | 항목 | 확정값 |
|---|---|---|
| 4 | quota 단위 | 작품 단위 |
| 6 | 적용 범위 | 본문만 (1차) |
| 7 | 표지 AI | X (1차) |
| 8 | 엔딩 본문 AI | Phase B부터 |
| 9 | 그림 중심형 본문 AI | Phase A 포함 |
| 10 | AI 진입 위치 | viewer 상단 [AI 작품 다듬기] (보조 강조) |
| 11 | 비교 모달 | 장면 목록 + 좌우 split + skip 표시 |
| 12 | 호출 시간 안내 | 점 3개 + 시간 + 분석 장면 수 + 취소 |
| 16 | 첫 안내 모달 | 박음 |
| 17 | 피드백 (👍/👎) | Phase D 후순위 |
| 18 | 다국어 | 한국어 강제 |
| 19 | 3단계 후보 수 | 5개 시작 → 10개 확장 |
| 23 | 이미지 AI 시점 | Phase D 후순위 |
| 24 | quota 환불 정책 | 7가지 상황별 분리 |
| 25 | 실행 조건 | 기능별 박힌 거 (1단계: 본문 1+ / 2단계: 본문 3+ + 연결 / 검사: 본문 2+ / 3단계: 2단계 결과 / 이미지: 스케치 1+) |
| 26 | 이미지 reference 선택 | 사용자 선택 (자동 X) |
| 27 | partially_applied 24h 검증 | originalSnapshot 통과만 |

---

## 2-2. 보류 항목 (⚠️ 11개)

다음 11개는 **사용자 최종 결정 박혀있어야 함**. v3에 추천값은 박혀있지만 사용자가 최종 박지 X.

### 2-2-1. provider / 모델 / 인프라

#### ⚠️ 보류 1. provider (#1)
- v3 추천: **Anthropic** (학생 데이터 학습 안 박음)
- 대안: OpenAI / Anthropic + OpenAI 둘 다
- **결정 박을 거**: 구현 시점에 provider 약관 재확인 후 박음
- 박혀있어야 박을 단계: Phase 0.5 (mock)에서는 무관 / Phase A 실 API 박기 직전

#### ⚠️ 보류 2. 1단계 모델 (#2)
- v3 추천: **Claude Haiku 계열**
- 대안: GPT mini / Gemini Flash
- 결정 박을 거: 정확한 모델명 (Haiku 4.5 / 3.5 등)
- 박혀있어야 박을 단계: Phase A 실 API

#### ⚠️ 보류 3. 2단계 모델 (#3)
- v3 추천: **Claude Sonnet 계열**
- 대안: GPT-4o / Gemini Pro
- 결정 박을 거: 정확한 모델명
- 박혀있어야 박을 단계: Phase B

### 2-2-2. quota 초기값

#### ⚠️ 보류 4. quota 초기값 — 테스트 (#5)
- v3 추천: S1: 3회 / S2: 1회 / 검사: 5회 / S3: 1회 또는 비활성
- 결정 박을 거: 정확한 횟수
- 박혀있어야 박을 단계: Phase A 실 API

#### ⚠️ 보류 5. quota 초기값 — 베타 (#5b)
- v3 추천: S1: 3회 / S2: 1회 / 검사: 5~10회 / S3: 1회
- 결정 박을 거: 정확한 횟수
- 박혀있어야 박을 단계: 베타 클래스 박기 전

#### ⚠️ 보류 6. 검사 quota (#20)
- v3 추천: 5~10회
- 결정 박을 거: 정확한 횟수
- 박혀있어야 박을 단계: Phase A 실 API

### 2-2-3. 길이 제한

#### ⚠️ 보류 7. 분할형 본문 최대 (#21)
- v3 추천: **권장 250~400자 / hard cut 500자**
- 결정 박을 거: 사용자가 실제 v138 화면에서 점검 후 박음
- 박혀있어야 박을 단계: Phase A 실 API (prompt 박을 때 필요)

#### ⚠️ 보류 8. 그림 중심형 본문 최대 (#22)
- v3 추천: **권장 100~200자 / hard cut 300자**
- 결정 박을 거: 사용자가 실제 v138 그림 중심형 화면에서 점검 후 박음
- 박혀있어야 박을 단계: Phase A 실 API

### 2-2-4. 비용

#### ⚠️ 보류 9. 비용 임계치 — 테스트 (#13)
- v3 추천: **월 $20 hard cap**
- 결정 박을 거: 정확한 액수 + Functions 차단 정책
- 박혀있어야 박을 단계: Phase A 실 API

#### ⚠️ 보류 10. 비용 임계치 — 베타 (#13b)
- v3 추천: 월 $50
- 결정 박을 거: 정확한 액수
- 박혀있어야 박을 단계: 베타 박기 전

### 2-2-5. 법적·교육

#### ⚠️ 보류 11. 학부모 동의 (#14)
- v3 추천: 명시 동의서 + 테스트는 교사 작품만
- 결정 박을 거:
  - 동의서 양식 누가 박나
  - 학교 측 동의 절차
  - 동의 없는 학생 작품 차단 방법
- 박혀있어야 박을 단계: 베타 박기 전 (Phase A 테스트는 교사 작품만)

#### ⚠️ 보류 12. 베타 클래스 (#15)
- v3 추천: 교사 테스트 작품 → 학생 3~5명
- 결정 박을 거:
  - 어느 학교/반
  - 교사 누가
  - 학생 명단
  - 모니터링 기간
- 박혀있어야 박을 단계: 베타 시험 박기 전

---

## 2-3. 후순위 항목 (⏳ 0개 — 현재 모두 분류됨)

(v3 시점에는 별도 후순위 항목 X. 모든 28개가 확정 또는 보류로 분류됨.)

---

## 2-4. v3 신규 추가 항목 (사용자 결정 박혀있음)

| # | 항목 | 상태 |
|---|---|---|
| 28 | 검사 Phase 위치 | ✓ 확정 — Phase A에 포함 |

---

# 3. Phase 0 진행 조건 5개 (Phase 0.5 박기 전 필수)

다음 5개 박혀있어야 Phase 0.5 박을 수 있음.

## 3-1. 학부모/학교 동의 박힘
- **조건**: 동의서 양식 박힘 + 동의 받는 절차 박힘
- **누가**: 사용자 (학교 측과 협의)
- **상태**: 아직 박지 X

## 3-2. provider 약관 검토
- **조건**: Anthropic 약관 박힘 — 학생 데이터 학습 안 함 명시 확인
- **누가**: Claude (구현 시점) + 사용자 (최종 확인)
- **상태**: ✓ **Claude 재확인 완료 (2026-05-20)** — 사용자 최종 OK 박힘 대기

### 재확인 결과 (Anthropic Privacy Center · Commercial Terms · Usage Policy 2024-06)

| 핵심 | 박힌 내용 | 출처 |
|---|---|---|
| 학습 사용 X | *"Anthropic may not train models on Customer Content from Services."* | Commercial Terms |
| 학습 사용 X (재확인) | *"We will not use your chats or coding sessions to train our models, unless you choose to participate in our Development Partner Program."* — opt-in 또는 👍👎 피드백 명시 동의만 예외 | privacy.claude.com 7996885 |
| 데이터 보관 | API 입력·출력 **30일 자동 삭제** 기본 / Zero Data Retention agreement 별도 신청 가능 | privacy.claude.com 7996866 |
| 위반 콘텐츠 예외 | Usage Policy 위반 의심 시 최대 2년 / Trust&Safety classifier 점수 7년 | 동상 |
| 미성년자 서비스 | 2024-06 Usage Policy — *"organizations to incorporate our API into their products for minors if they agree to implement certain safety features"* — 조건부 OK | anthropic.com/news/updating-our-usage-policy |
| 미성년자 가이드 | 연령 확인 / 콘텐츠 필터링 / 모니터링·신고 / 교육 자료 / AI 공개 의무 박힘 | support.claude.com 9307344 |
| Customer 책임 | *"Customer warrants that it has all rights and permissions required to submit Inputs"* — 학생/학부모 동의 가지 책임 | Commercial Terms |

### 가지 운영 의무 후보 (5가지 — Anthropic 공식 가이드 기준)

> 공식 문서 최종 확인은 Phase A 실 API 박기 직전에 다시 박는 것 박힘. 자세히는 `AI_SAFETY_COST_RULES.md` 1-5 박힘.

| # | 박힐 거 | 가지 현재 상태 | gating |
|---|---|---|---|
| 1 | 학생/학부모 동의 박힘 | ⚠️ 보류 — 3-1 (베타 클래스 박힐 때 함께) | **학생 베타** (Phase A 후반 / Phase B). Phase A 초기 교사 테스트는 불필요 |
| 2 | AI 공개 라벨 (학생 화면 "Claude AI 박음") | ⚠️ Phase A 박을 때 mock "※mock" → 실 라벨로 변경 | Phase A 코드 |
| 3 | 연령 확인 / 베타 제한 | ✓ 화이트리스트 (JL26A 3팀) 박혀있음 | mock·Phase A 베타까지 박힘 |
| 4 | 콘텐츠 필터링 | ✓ Anthropic Trust&Safety 기본 박힘 / ⚠️ 가지 자체 욕설 필터 박을지 판단 | Phase A 박을 때 (선택) |
| 5 | 모니터링·신고 메커니즘 | ⚠️ Phase A 박을 때 👎 신고 박을 거 | Phase A 코드 |

### 결론

Anthropic 공식 가이드 박힌 거 = **Phase A 박을 수 있는 근거 박힘**. 학습 사용 X 안내 + 30일 자동 삭제 + 미성년자 조건부 OK.
- **Phase A 초기 (교사 작품)** — #2·#3·#4·#5 박혀있어야. #1 학부모 동의는 박지 X여도 박을 수 있음 (교사 본인 작품).
- **Phase A 후반 / Phase B (학생 베타)** — #1 박혀있어야 박을 수 있음.

**Phase A 박기 전 사용자 최종 OK 박힐 거** — 위 결과 박힌 거 충분한지 박음. 공식 문서 최종 확인은 그때 다시.

## 3-3. Firebase Blaze plan 업그레이드
- **조건**: Firebase 프로젝트가 Blaze plan 박힘
- **누가**: 사용자 (Firebase 콘솔)
- **이유**: Spark 무료엔 outbound HTTP 안 됨 (AI provider 호출 불가)
- **상태**: ✓ **박혔음** (2026-05-20 사용자 명시 "Blaze는 이미되있어")

## 3-4. 비용 비상 차단 박힘
- **조건**:
  - Functions에 월 비용 임계치 박힘
  - API 콘솔 (Anthropic) 월 한도 박힘
  - 일일 호출 제한 박힘
- **누가**: 사용자 + Claude (구현 시 Functions 박음)
- **상태**: 아직 박지 X

## 3-5. 베타 클래스 1개 선정
- **조건**: 베타 박을 클래스/교사/학생 박힘
- **누가**: 사용자
- **단계**: 처음은 **교사 테스트 작품만** → 그 후 학생 3~5명
- **상태**: 아직 박지 X

---

# 4. mock 가능 조건 vs 실제 API 가능 조건 분리

가지 작업은 두 단계로 나뉨:
- **mock 단계** (Phase 0.5): 실 API 호출 X — 가짜 응답으로 UI/저장 흐름 검증
- **실 API 단계** (Phase A): Anthropic 실제 호출 — 비용·법적 위험

각 단계별 진행 조건 다름.

## 4-1. mock 가능 조건 (Phase 0.5 박을 수 있는 조건)

### 박혀있어야 박는 거
| # | 항목 | 상태 |
|---|---|---|
| ✓ | AI_MASTER_PLAN_CLAUDE_v3.md | 박힘 |
| ✓ | AI_DECISIONS_FINAL.md | 박힘 (이 문서) |
| ✓ | AI_PHASE_0_5_MOCK_SPEC.md | 박힘 |
| ✓ | AI_PROMPT_POLICY.md | 박힘 |
| ✓ | AI_SAFETY_COST_RULES.md | 박힘 |
| ✓ | 확정 항목 17개 | 박힘 |

### 박을 필요 X (mock이라 무관)
- ❌ 실 API key (mock이라 X)
- ❌ provider 약관 (mock이라 X — 단 Phase A 박기 전 박힘)
- ❌ Firebase Blaze plan (mock은 로컬 Functions emulator로 가능)
- ❌ 비용 임계치 (mock 비용 0)
- ❌ 학부모 동의 (실 학생 데이터 X — 교사 테스트만)
- ❌ 보류 항목 11개 (mock 단계엔 무관)

### mock 단계에서 박는 거 (요약)
- viewer 상단 [AI 작품 다듬기] 버튼
- AI 모드 선택 모달
- mock Functions (`callTextAiBatch` — 가짜 응답)
- 비교 모달
- 장면별 체크박스 선택 적용
- `_rtSaveBody` 재사용
- ai-suggestions / ai-history mock 저장
- quota mock 표시

상세는 `AI_PHASE_0_5_MOCK_SPEC.md` 참조.

## 4-2. 실 API 가능 조건 (Phase A 박을 수 있는 조건)

### 박혀있어야 박는 거 (mock 조건 + 추가)
| # | 항목 | 상태 |
|---|---|---|
| ✓ | Phase 0.5 mock 박힘 + 사용자 점검 OK | 박혔음 |
| ✓ | provider 결정 (#1) | **Anthropic** (2026-05-20 사용자 명시) |
| ✓ | 1단계 모델 결정 (#2) | **Claude Haiku 계열** (2026-05-20 사용자 명시) |
| ✓ | quota 초기값 — 테스트 (#5) | **텍스트 1단계 3회 / 작품 검사 5회** (2026-05-20) |
| ✓ | 검사 quota (#20) | **5회** (2026-05-20) |
| ✓ | 분할형 본문 최대 (#21) | **hard cut 500자** (1단계는 원문 유지 원칙 — 2단계만 권장 250~400자) |
| ✓ | 그림 중심형 본문 최대 (#22) | **hard cut 300자** (1단계는 원문 유지 원칙 — 2단계만 권장 100~200자) |
| ✓ | 비용 임계치 — 테스트 (#13) | **월 $20 hard cap** (2026-05-20) |
| ✓ | provider 약관 검토 박힘 | **Claude 재확인 완료 (2026-05-20)** — 학습 X / 30일 삭제 / 미성년자 조건부 OK / 가지 책임 5가지 (3-2 박힘). 사용자 최종 OK 박힘 대기 |
| ✓ | Firebase Blaze plan | **박혔음** (2026-05-20 사용자 명시 "Blaze는 이미되있어") |
| ⚠️ | 비용 비상 차단 박힘 | **Phase A 구현 단계 Functions hard cap / 일일 호출 제한 / Anthropic 콘솔 한도** |
| ✓ | prompts/text-strength-1.md 합의 | **v3 확정** (2026-05-20 사용자 명시) |
| ✓ | prompts/work-check.md 합의 | **v3 확정** (2026-05-20 사용자 명시) |
| ✓ | 테스트 환경 — 교사 작품만 박을 거 (학부모 동의 박힌 작품 외 X) | **교사 테스트 작품만** (2026-05-20 사용자 명시) |

### Phase A에서 박는 거
- Phase 0.5 mock의 모든 흐름 +
- Anthropic API key 환경변수
- Haiku 모델 연결
- 1단계 + 작품 검사 system prompt
- JSON schema 검증
- 장면별 검증 (글자수·금지 키워드·buttons)
- 실 ai-suggestions / ai-history / ai-usage 노드
- quota 트랜잭션 (7가지 환불)
- 비용 임계치 ($20)
- 첫 안내 모달
- 실행 조건 박음
- 베타 클래스 (교사 테스트 작품만)

## 4-3. 실 학생 데이터 박기 가능 조건 (Phase A 후반/Phase B)

Phase A 초기엔 교사 작품만. 실 학생 데이터 박을 때 추가 조건:

| # | 항목 | 박을 거 |
|---|---|---|
| ⚠️ | 학부모 동의 박힘 (#14) | 박을 거 |
| ⚠️ | 베타 클래스 학생 명단 (#15) | 박을 거 |
| ⚠️ | quota 초기값 — 베타 (#5b) | 박을 거 |
| ⚠️ | 비용 임계치 — 베타 (#13b) | 박을 거 |
| ⚠️ | 2단계 모델 결정 (#3) | Phase B 박을 거 |

---

# 5. 단계별 박힐 거 요약 (체크리스트)

## 5-1. 지금 (Phase 0 - 설계 합의) — 박을 거
- [x] AI_MASTER_PLAN_CLAUDE_v3.md
- [x] AI_DECISIONS_FINAL.md (이 문서)
- [x] AI_PHASE_0_5_MOCK_SPEC.md
- [x] AI_PROMPT_POLICY.md
- [x] AI_SAFETY_COST_RULES.md
- [x] 사용자 v3 최종 검토 OK
- [x] 확정 17개 사용자 OK

## 5-2. Phase 0.5 mock 박기 전 — 박을 거
- [ ] 위 모든 거 박힘
- [ ] Phase 0.5 mock 설계 + 사용자 OK
- [ ] **코드 박기 시작 OK 박힘** (사용자 명시)

## 5-3. Phase A 실 API 박기 전 — 박을 거
- [x] Phase 0.5 mock 박힘 (4 step 완료, 2026-05-20) — 사용자 점검 OK 박힘 대기
- [x] 보류 11개 중 mock 무관 6개 외 — 5개 박힘 (2026-05-20 commit `20e9e76`):
  - [x] provider 결정 (Anthropic Claude)
  - [x] 1단계 모델 결정 (Haiku)
  - [x] quota 테스트값
  - [x] 검사 quota (5회)
  - [x] 분할형/그림 중심형 글자수 (hard cut 500/300)
  - [x] 비용 테스트 임계치 ($20 hard cap)
- [x] provider 약관 검토 박힘 (Claude 재확인 완료 2026-05-20, 3-2 박힘) — 사용자 최종 OK 박힘 대기
- [x] Firebase Blaze plan 박힘 (2026-05-20 사용자 명시)
- [ ] 비용 비상 차단 박힘 (Phase A 구현 단계 박을 거)
- [x] prompts/text-strength-1.md 합의 (v3 확정 2026-05-20)
- [x] prompts/work-check.md 합의 (v3 확정 2026-05-20)

## 5-4. Phase A 후반/Phase B 박기 전 — 박을 거
- [ ] 학부모 동의 박힘
- [ ] 베타 클래스 학생 명단
- [ ] quota 베타값
- [ ] 비용 베타 임계치
- [ ] 2단계 모델 결정
- [ ] prompts/text-strength-2.md 합의

---

# 6. 의사결정 책임자

| 항목 | 결정자 |
|---|---|
| 28개 결정 항목 | **사용자** |
| 5개 Phase 0 진행 조건 | **사용자** |
| 설계 문서 작성 | Claude (사용자 검토) |
| prompts/*.md | 사용자·GPT·Claude 합의 |
| Firebase / Functions 인프라 | 사용자 + Claude (구현 단계) |
| 학부모 동의 양식 | 사용자 + 학교 |
| provider 약관 확인 | Claude (구현 시점) + 사용자 |

---

# 7. 진행 흐름 요약

```
[지금]
  ↓
v3 합의안 ✓
  ↓
실행용 문서 4개 박음 (이 문서 포함)
  ↓
사용자 v3 + 4개 문서 최종 검토
  ↓
확정 17개 + 보류 11개 중 mock 무관 6개 사용자 OK
  ↓
Phase 0.5 mock 박기 (코드)
  ↓
사용자 mock 점검 OK
  ↓
Phase A 박을 거 박힘 (위 5-3 체크리스트)
  ↓
prompts/*.md 합의
  ↓
Phase A 실 API 박기
  ↓
교사 작품 테스트
  ↓
사용자 베타 박을 거 박힘
  ↓
학부모 동의 박힌 학생 작품 베타
  ↓
Phase B (텍스트 2단계)
  ↓
...
```

---

# 8. 한 줄

> 가지 AI는 **사용자가 박은 결정만큼만 박힘**. 박지 X 박힌 결정에 박지 X — 위험 차단.
