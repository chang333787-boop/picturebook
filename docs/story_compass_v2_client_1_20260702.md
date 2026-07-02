# 생각 나침반 v2 클라이언트 1차 구현 (STORY-COMPASS-V2-CLIENT-1)

2026-07-02 · 클라이언트 전용 · 기준 origin/main `23e6b4d`(v2 설계) 이후
설계 정본: docs/story_compass_v2_question_design_20260702.md (A안 10문항)

## 1. 구현 요약
| 파일 | 변경 |
|---|---|
| thought-compass-questions.js | `CORE_QUESTIONS_V2` 10문항 정의 + `getCoreQuestions(version)` 라우팅 + 검증기 version 인지(targetLength만 allowCustom:false 허용) |
| thought-compass.js | `QUESTION_VERSION_LATEST=2` · normalize **version 2 보존**(기존엔 1로 강제 덮어씀) · `resolveQuestionSetVersion(raw)` · 완료판정 v2=10키 · plan들 version 스탬프(시작=2·저장 재스탬프·완료=세션값 보존) |
| thought-compass-flow.js | `createFlow({version})` — vm 질문 세트 주입 |
| thought-compass-ui.js | 세트 버전 판별→vm 생성 · **v2는 AI 후속 스킵** · targetLength 직접입력 카드 미노출 · 저장 state에 version 전달 |
| thought-compass-review.js | 검토=vm.questions 정본 · openReadOnly version 분기 · 완료 시 version 파생 전달 |
| maker.html / viewer-edit.js / viewer.html | 캐시버스터 `tcv2q1` (compass 5파일 · 지연 번들 V · EDIT_SRC) |
| tests/thought-compass/v2-questions.test.js | 신규 19 테스트 |

## 2. v1/v2 하위호환 정책 (구현대로)
- **판별**(`resolveQuestionSetVersion`): fresh/notStarted→**2**(신규는 v2) · `version===2`→2 ·
  v2 전용 answer 키 존재→2(**자가복구**: markStarted write 실패 등으로 version 필드 유실 시) ·
  그 외(v1 진행·완료 데이터)→**1**(기존 세션은 v1으로 완주).
- v1 answers 7키 **불변·삭제 없음**. migration 없음. 교사 초기화→notStarted→다음 시작은 v2.
- 완료판정: v2=10키 전부(유예 포함 유효), v1=기존 7키.
- Rules: writingGuide는 auth 게이트만(필드 스키마 제약 없음) → version=2 write에 Rules 변경 불요(확인함).

## 3. AI 후속 — v2는 이번 루프에서 OFF
서버 `callThoughtCompassFollowUp`의 allowlist가 v1 7키 정본(`coreQuestionId`·`priorSummaries` 키 검증)
→ v2 키는 서버에서 거부됨. functions 무수정 원칙에 따라 **v2 세션은 클라에서 AI 판정 자체를 스킵**
(항상 NEXT·`S.version !== 2` 가드). v1 세션은 기존대로 AI 후속 동작. 갱신은 COMPASS-V2-FOLLOWUP(별도 승인).

## 4. targetLength 특례
- 보기 3개(8/12/15) **보기 전용**(직접입력 없음). "아직 모르겠어요"=공통 모르겠어요 흐름(2클릭→유예
  "이야기를 만들면서 정할래요") — 결과지(SHEET-1)에서 "만들면서 정하기"로 표기 예정.
- **BASE10 생성기 미연결**(금지 준수): 완료 후 기본 장면은 기존 10장 고정 그대로. 연결은 COMPASS-LENGTH-BASE.

## 5. 검증
- `node --check` 6파일 OK · **테스트 208/208**(기존 189 무수정 통과 + v2 신규 19).
- 브라우저 스모크(실 스크립트+스텁 Store·Playwright):
  1. **v2 fresh**: 1/10 targetLength(직접입력 카드 없음·모르겠어요 있음)→2/10 protagonist(직접입력 있음)→10문항 완주→검토 10항목+자유메모→완료 plan `version:2`·진행저장 `version:2`.
  2. **v1 완료본 결과보기**: 7항목·v1 질문 문구·메모 표시·read-only(고치기 없음).
  3. **v2 완료본 결과보기**: 10항목·targetLength 첫 항목.
  4. **v1 진행 중 이어하기**: "3 / 7"·v1 질문 유지·저장 update에 version 필드 없음(v1 불변).
- JS 콘솔 오류 0(하니스 favicon 404 제외). functions/rules/mobileTextBranch diff 0 · secret 0.

## 6. 남은 위험 / NOT_VERIFIED
- 실 Firebase(운영 RTDB) write 왕복은 스텁 검증 — 실 학급 스모크는 운영에서 확인 필요.
- editsession(편집권한 잠금)과의 조합은 기존 경로 무변경(open() 앞단 로직 그대로)이라 회귀 없음으로
  판단하나 실기기 확인은 남음.
- v2 소요시간(10문항) 실측 미확인 — PRD D-23 개정은 COMPASS-V2-PRD 사안.

## 7. 다음 루프
① COMPASS-V2-FOLLOWUP(functions allowlist/QUESTION_BRIEF/고정후속 — deploy 승인 필요)
② COMPASS-SHEET-1(설계도 문장+인쇄 결과지 — v2 필드 기반)
③ COMPASS-LENGTH-BASE(targetLength→생성기 opts.count)

## 판정
**STORY_COMPASS_V2_CLIENT_LIVE_PASS** — v2 10문항 클라 구동·v1 완전 하위호환·AI 0·Functions/Rules/DB 무변경.
