# 생각 나침반 — 맥락 맞춤 보기 (Adaptive Choices) 설계

작성 2026-07-24. 상태: **설계(구현 전·승인 대기)**. 정본 PRD=docs/thought_compass_prd.md. 관련 메모리=project-branch-picturebook-levels, project-branch-thought-compass-phase1.

## 1. 배경 / 문제 (조사 결과)
사용자 관찰: 나침반 뒤 질문의 **답 후보(보기)가 앞 답과 무관한 고정값**이라, 논리적으로 **모순**되는 보기가 나온다.
- 예: 목표="친구를 사귀고 싶어요" → 시도 질문에 "친구에게 도움을 청해요"(아직 친구가 없다는 전제와 충돌).

**원인 (코드 확정):**
- `choices`는 질문별 정적 하드코딩. `thought-compass-questions.js` `_choice(id,label)`(순수 정적). 앞 답 인자 없음.
- UI는 그대로 렌더. `thought-compass-ui.js:155`(`q.title`), `:173`(`q.choices.forEach`) — 앞 답 치환 전무.
- 질문 순서 고정(`currentQuestionIndex` 순차). 답 기반 분기 없음.
- AI 후속(`callThoughtCompassFollowUp`)은 판정만(NEXT/ASK_FOLLOW_UP/ASK_EASIER), `BANNED_OUTPUT_KEYS`에 `choices` 포함 → 보기 생성 원천 차단.
- 앞 답으로 보기를 만들거나 바꾸는 **메커니즘 자체가 없음**.

## 2. 목표 / 비목표
- **목표:** 앞 답(주인공·목표 등)에 **맥락상 어울리는 보기 3개**를 제시해 모순·겉도는 느낌 제거.
- **비목표:** AI가 이야기를 대신 만들지 않음. 보기는 **제안**일 뿐, 아이는 여전히 고르거나·직접 적거나·모르겠어요 선택. (나침반의 "스스로 생각" 원칙 유지 — 지금도 보기는 제안이므로, 그 제안을 맥락화하는 것뿐)

## 3. 적용 범위
- **적용(앞 답 의존):** 목표(goal) 이후의 질문 — 사건(event), 시도, 장애물(obstacle/trouble), 선택(branchChoice/choice), 결말(ending), 다른 결말(alt). 즉 주인공·목표가 정해진 뒤의 보기.
- **비적용(정적 유지):** 대상(audience)·느낌(purpose)·주인공(protagonist)·시작(start)·이름(name)·who 등 앞 답에 의존하지 않는 질문. (불필요한 AI 호출 방지)
- 세트별(core v2 / easy 1단계 / linear 2단계) 적용 질문은 화이트리스트로 명시(정본=thought-compass-questions.js에 `adaptive:true` 플래그 추가).

## 4. 아키텍처 — `compassValueCandidates` 판박이
기존 `compassValueCandidates`(functions/index.js:4253)가 인증·쿼터·킬스위치·membership/teacher 게이트·aiSettings.enabled·글로벌 한도·2회 재시도·**fail-open** 폴백을 모두 갖춘 선례. 이를 그대로 본떠 신규 콜러블 추가.

- **신규 서버 콜러블 `compassAdaptiveChoices`** (asia-northeast3, onCall):
  - 게이트/쿼터/킬스위치/testMode거부/origin검사 = compassValueCandidates와 동일 코드 패턴.
  - 프롬프트만 신규(아래 6절). 검증 신규(7절).
- **클라 어댑터**: `thought-compass-ai.js`에 `requestAdaptiveChoices(payload)` 추가(single-flight·실패시 null). 또는 별도 함수.
- **UI 훅**: `thought-compass-ui.js` 질문 렌더 시, 해당 질문이 `adaptive`면 호출→성공 시 보기 교체, 실패/지연/미적용이면 **고정 보기 그대로**.

## 5. 입출력 계약
- **payload**: `{ classId, teamName, projectType, coreQuestionId, priorAnswers: [{key, text}], staticChoices: [label,label,label] }`
  - priorAnswers = 이미 확정된 앞 답들(요약 텍스트·길이 상한). staticChoices = 폴백/스타일 참고용(선택).
- **응답**: `{ ok:true, choices:[{label, value}] (정확히 3) }` | `{ ok:false }`(폴백).
  - label = 짧은 문구(≤ 40자 권장). value = label(기존 _choice와 동일 형태 → flow/normalize 그대로 호환).

## 6. 프롬프트 설계 (원칙)
- 역할: "초등학생이 이야기를 스스로 생각하도록 돕는 **보기 제안자**. 이야기를 대신 쓰지 않는다."
- 입력: 질문 문구 + 확정된 앞 답 + (참고용) 기존 정적 보기.
- 출력: 그 질문에 대한 **서로 다른 방향의 짧은 보기 3개**. 앞 답과 **모순되지 않게**(예: 목표가 '친구 사귀기'면 '친구에게 도움 청하기'류 금지). 초등 어휘·한 호흡.
- 금지: 이야기 본문/장면/결말 확정·특정 실존 인물/상표·폭력/선정/차별·평가어. (followup 프롬프트 가드 재사용)

## 7. 안전 가드
- **출력 검증**(validate): 배열 길이 정확히 3 · 각 label 문자열·길이 상한 · 중복 금지 · `BANNED_OUTPUT_KEYS`(body/scene/ending/choices의 중첩 등) 금지 · 평가어/창작 금지어 스캔. 불통과 → 재시도(2회) → **fail-open**.
- **콘텐츠 안전**: 기존 키워드 스캐너/거부 프롬프트 원칙 적용(project-branch-content-safety).
- **폴백(절대 안 깨짐)**: 실패·지연(타임아웃 예: 12s)·미배포·AI OFF·한도초과 → 지금의 **정적 보기 그대로**. 아이는 항상 진행 가능.
- **쿼터/비용**: 적용 질문에서만 호출. 글로벌 일일 한도 공유. (선택) 주인공·목표 확정 뒤 뒤 보기들을 **1회 배치 생성**해 호출 수 절감 검토.

## 8. UX / 클라 흐름
1. 적용 질문 진입 → 즉시 **정적 보기 먼저 렌더**(빈 화면 방지) + 작은 로딩 표시("이야기에 맞는 보기를 고르는 중…").
2. 응답 도착(성공) → 보기 3개를 맥락 보기로 **교체**(직접 적기·모르겠어요 카드는 유지).
3. 실패/지연 → 정적 보기 유지(사용자 인지 불필요).
4. 이미 답한 질문 복원 시엔 재호출 안 함(저장된 답 우선).

## 9. 데이터 / 그룹 일관성 (미결 A)
- 한 모둠 여러 학생이 같은 answers 공유. 보기를 매 진입 재생성하면 재진입/다른 기기에서 보기가 달라질 수 있음.
- **옵션 A1**: 생성된 보기를 compass state에 캐시(질문별)—일관·재호출0, 저장 스키마 추가.
- **옵션 A2**: 캐시 없이 매번 생성(단순, 비용↑·비일관). 
- **권장**: A1(캐시). 단 저장 구조 변경=안전모드 → 승인 필요.

## 10. 구현 순서 (제안)
- **Phase 1 (PoC)**: 콜러블 + 프롬프트/검증 + 클라 어댑터 + **한 질문(예: 시도/장애물)만** adaptive. 폴백 완비. 하니스(검증 순수함수) + 실 1회. → 사용자 육안 평가.
- **Phase 2**: 적용 질문 화이트리스트 확장 + (선택)배치 생성 + 캐시(A1).
- **Phase 3**: 세트별(easy/linear) 튜닝.

## 11. 승인 필요 항목
1. 접근 방식(A-lite) 확정 — ✅ 사용자 선택.
2. 캐시(9절 A1) 채택 여부(저장 스키마 추가=안전모드).
3. Phase 1 적용 질문 1개 선정.
4. AI 비용/호출량 상한 정책(질문당 vs 배치).
