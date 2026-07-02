# COMPASS-V2-FOLLOWUP-AUDIT — v2 AI 후속질문 functions 갱신 범위 조사 (수정·deploy 없음)

2026-07-02 · read-only · 현재 v2 세션은 클라에서 AI 후속 완전 스킵(`S.version !== 2` 가드)

## 1. 현재 서버 구조
- callable: `callThoughtCompassFollowUp` (functions/index.js ≈2885, asia-northeast3, ANTHROPIC_API_KEY secret,
  auth 필수 + **H-1 팀 membership 게이트(_validateRequest) 적용 대상**, 상한 후속≤5·전체≤12 서버 강제, 실패 1회 재시도→fallback).
- 순수 로직: `functions/thought-compass-followup.js` — **v1 7키 하드코딩 2곳**:
  `CORE_QUESTION_KEYS`(coreQuestionId·priorSummaries.key allowlist)와 `QUESTION_BRIEF`(질문 맥락·충분 기준).
- prompt: `functions/prompts.js` `THOUGHT_COMPASS_FOLLOWUP_SYSTEM_PROMPT` — 질문 id 비의존
  (판정 원칙·JSON 형식만) → **prompt 재설계 불요**, user message는 QUESTION_BRIEF label로 맥락 구성.
- fallback: `FIXED_FOLLOWUPS`가 G3(protagonist)/G4(goal) 고정 후속 — v2에서도 두 키 동일해 재사용 가능.

## 2. v2 활성화에 필요한 수정 범위 (전부 functions/ — 이번 루프 금지 대상)
| 파일 | 수정 | 규모 |
|---|---|---|
| functions/thought-compass-followup.js | ①`CORE_QUESTION_KEYS`에 v2 10키 추가(또는 v1+v2 합집합 17키 allowlist — 신구 세션 동시 지원) ②`QUESTION_BRIEF`에 v2 8개 신규 키 label/sufficientWhen 추가 ③`MAX_SUMMARIES` 7→10 ④`MIN_TOTAL` 7→? (v2=10이므로 7 유지 시 v1 호환·범위검증 `totalQuestionCount` 상한 12→15) ⑤fallback에 trueEnding/keyChoice/incitingEvent 고정 후속 추가(설계문서 권고) | 소~중 |
| functions/index.js | 입력 검증은 모듈 위임이라 **변경 최소**(모듈만 갱신하면 됨). targetLength는 후속 대상 제외(클라가 호출 안 함) | 극소 |
| functions/prompts.js | 변경 불요(질문 비의존) — 선택: v2 시간축 맥락 한 줄 추가 | 0~극소 |
| 클라 thought-compass-ui.js | `S.version !== 2` 가드 제거 + `Flow.CORE_TOTAL` 대신 vm.total 사용 + priorSummaries는 이미 vm 기반(v2 키 자동) | 소 |
| 클라 thought-compass-flow.js | `CORE_TOTAL=7`·`TOTAL_MAX=12` → 세션 버전 인지(7/12 vs 10/15) | 소 |
| tests | followup 모듈 테스트(8/8) v2 케이스 확장 + 클라 budget 테스트 | 소 |

## 3. 배포/비용/안전
- **deploy 대상: `callThoughtCompassFollowUp` 1개만**(모듈 파일은 함수에 번들됨) — asia-northeast3.
- 비용: v2는 문항 10개로 판정 호출 최대 +3회/세션(Haiku 소형 payload) — 미미. quota는 기존
  ai-usage 경로 그대로(변경 불요). H-1 membership log-only 게이트도 그대로 적용됨.
- 안전 가드(대필 차단·평가어 금지·40자·한글비율)는 키 무관 — 그대로 유효.

## 4. 실 AI 호출 없는 테스트 범위
- `node --test tests/`(followup 순수 모듈: 입력/출력 검증·fallback·상한) — 실 API 0.
- `TC_FOLLOWUP_STUB` + FUNCTIONS_EMULATOR 경로(stubDecision)로 에뮬레이터 수동 QA — 실 API 0.
- 실 Haiku 판정 품질(v2 신규 질문 8종에 대한 NEXT/FOLLOW_UP 판정 적절성)만 라이브 확인 필요.

## 판정
**COMPASS_V2_FOLLOWUP_READY_FOR_DEPLOY_APPROVAL** — prompt 재설계 불요, 수정 범위 명확·소규모
(allowlist/BRIEF/상한/fallback + 클라 가드 해제). 별도 루프에서 functions 수정→모듈 테스트→
에뮬레이터 stub QA→**deploy 승인 요청** 순으로 진행 권장.
