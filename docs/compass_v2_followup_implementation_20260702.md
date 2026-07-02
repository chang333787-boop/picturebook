# COMPASS-V2-FOLLOWUP-IMPLEMENT — v2 AI 후속질문 연결 준비 (⚠ deploy 전 승인 대기)

2026-07-02 · 기준 origin/main `cbbdd91` 이후 · 감사 정본: docs/compass_v2_followup_audit_20260702.md

## ⚠ 상태 요약
**코드는 준비 완료·테스트 통과. Functions는 아직 deploy하지 않음** — main에 push되어도
운영 callable은 구버전(v1 7키) 그대로다. deploy는 사용자 승인 후 별도 실행.
- deploy 전 기간의 v2 동작: 클라 가드가 해제되어 v2 세션이 후속 판정을 요청하지만, 운영 서버가
  v2 키를 거부 → 클라 ai.js가 null 처리 → **NEXT 안전 진행**(현행과 동일 체감·흐름 차단 없음).

## 1. 수정 범위
| 파일 | 변경 |
|---|---|
| **functions/thought-compass-followup.js** (유일한 functions 변경) | ①allowlist = v1 7키+v2 10키 **합집합 15키**(감사 문서의 "17"은 공통 protagonist/goal 미차감 오기 — 정정) ②QUESTION_BRIEF v2 8키 추가(공통 2키는 기존 유지·targetLength는 방어적 포함) ③`MAX_TOTAL` 12→**15**·`MAX_SUMMARIES` 7→**10**(MIN_TOTAL 7 유지) ④fallback `FIXED_FOLLOWUPS`에 **trueEnding/keyChoice/incitingEvent** 추가(v1 2키 불변·전부 40자 이내·평가어 0·validator 통과 확인) |
| functions/index.js | **무수정** — 검증/fallback 전부 모듈 위임 구조 확인 |
| functions/prompts.js | **무수정** — system prompt 질문 비의존(감사 판정대로 재설계 불요) |
| thought-compass-ui.js | v2 스킵 가드(`S.version !== 2`) 해제 · totalQuestionCount `CORE_TOTAL`→`S.vm.total`(v1=7·v2=10) · **targetLength는 후속 요청 자체 생략**(보기 전용·판정 무가치) |
| thought-compass-flow.js | `followUpBudgetLeft(meta.coreTotal)` 세트별 상한: v1=12·v2=**15**(`TOTAL_MAX_V2`). coreTotal 미지정=기존 v1 동작(하위호환) |
| maker.html / viewer-edit.js / viewer.html | 캐시버스터 `compassfollowup1`(flow·ui·지연번들 V·EDIT_SRC) |
| tests | 신규 v2-followup.test.js **10 테스트** + 기존 2건 상한 12→15 정책 갱신 |

## 2. 정책 확정
- **allowlist 15키**: audience·purpose·obstacle·branchChoice·protectedCore(v1 전용 5) + protagonist·goal(공통 2) + targetLength·mainlineStart·incitingEvent·risingTrouble·keyChoice·trueEnding·alternatePath·coreMessage(v2 전용 8).
- **상한**: 세션 후속 ≤5(불변) · 전체 v1 12(클라 flow 자체 제한)·v2 15(서버 MAX_TOTAL=15 절대 상한).
- **fallback**: v1 protagonist/goal 불변 + v2 trueEnding("마지막 장면에서 주인공은 어떤 모습인가요?")·keyChoice("그 선택이 왜 고민되는지 말해 줄래요?")·incitingEvent("그 일은 어디에서 일어나나요?") — 전부 한 단계 더 생각하게 하는 질문만·대필/평가어 0. 나머지 키 NEXT.
- 자동 호출 없음(기존 흐름 그대로: 학생이 '다음' 누를 때만 판정 요청) · quota/cost/safety/멤버십 게이트 경로 무변경.

## 3. 테스트 (실 AI 호출 0)
- **229/229 전체 통과**(신규 10 + 정책 갱신 2 포함) · node --check OK · secret grep 0.
- 서버 모듈: v1 7키/v2 10키 통과·invalid 거부·priorSummaries 10키 허용/11 거부·15 상한·shouldForceNext·
  v2 fallback 3키(스키마 validator 자체 통과·평가어 0)·user message v2 라벨.
- 클라 flow: budget v1(7+5=12)/v2(10+5=15)/미지정(v1 하위호환).
- 브라우저 스모크(mock callable·네트워크 0): v2에서 targetLength 호출 생략→protagonist 판정 요청
  payload `{coreQuestionId:'protagonist', total:10, priorKeys:[v2키]}`→ASK_FOLLOW_UP mock→후속 화면
  표시→답변→3/10 복귀. v1 세션은 audience·total 7 그대로. pageerror 0.

## 4. deploy 계획 (승인 후 실행)
- **대상: `callThoughtCompassFollowUp` 1개만** (asia-northeast3)
- 예상 명령: `firebase deploy --only functions:callThoughtCompassFollowUp`
- deploy 후 검증(승인 후 루프): ①unauth 호출 401/permission 거부 ②invalid coreQuestionId 400
  ③(실 AI 호출은 별도 승인 없이는 계속 금지 — 로그·거부 경로만) ④functions 로그 오류 0 확인.
- 롤백: 직전 리비전 재deploy(모듈 파일만 변경이라 단순).

## 5. 위험도
- **낮음**: index.js/prompt/Rules/quota 무변경, v1 키·fallback·상한(클라) 전부 보존, 실패 시 클라 NEXT 안전 진행.
- 주의: deploy 전 기간 v2 요청이 서버 거부 로그를 남김(기능 영향 0·deploy로 해소).
- iPad 등 실기기 후속 화면은 v1과 동일 컴포넌트라 회귀 없음으로 판단.

## 판정
**COMPASS_V2_FOLLOWUP_READY_FOR_DEPLOY_APPROVAL** — 코드·테스트 완료. **Functions deploy 승인 대기.**
