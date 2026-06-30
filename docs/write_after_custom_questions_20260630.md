# 쓰기 후 활동 Phase 3 — 생각 점검 질문(writeAfterQuestions) (2026-06-30)

> 정본 철학: **쓰기 후 활동은 AI가 대신 고쳐주는 기능이 아니라, AI가 질문하고 검사해서 학생이 직접 고친 뒤, 마지막에 AI 장면발전과 AI 그림책 마감을 후보로 비교하는 마무리 활동이다.**
> Phase 3 착수. feature `feature/write-after-rebuild`. **실 AI 호출 0 · deploy 0 · 운영 DB write 0 · main merge 0.**

## 목적
작품 마무리 흐름의 **첫 단계**. AI가 완성 작품을 읽고 **학생이 스스로 돌아볼 맞춤형 점검 질문**을 만든다. AI는 글/사건/대사/결말을 대신 써 주지 않고 **질문만** 한다. 학생이 직접 고친다.

## 권한 정책
- mode key `writeAfterQuestions` (서버 MODE_KEY_MAP·클라 AI_MODE_KEY_MAP·`aiSettings.modes.writeAfterQuestions`).
- **기본 OFF**(교사가 관리자 설정에서 켜야 노출). 기존 text AI 게이트(`_validateRequest`·`_isModeAllowedByTeacher`) 그대로 사용. imageS2와 무관.
- 초기엔 학생도 호출 가능(s1/s2/check와 동일 게이트). "교사 전용"으로 더 좁히려면 후속(현 구조 유지).

## prompt 정책 (functions/prompts.js `WRITE_AFTER_QUESTIONS_SYSTEM_PROMPT`)
- 완성 문장·새 사건·새 대사·새 결말·수정문·점수 **금지**(위반 시 서버가 거부).
- 질문 방향 6종: 이야기 흐름 / 선택지 연결 / 인물·물건 이어짐 / 엔딩 이해 / 독자 이해 / 빈·짧은 장면.
- studentAction은 "직접 할 행동" 안내만(문장 대필 금지). `<student_text>` injection 방어 계승.

## JSON schema
```
{ summary, questions: [ { id, sceneId, sceneLabel, type, question, reason, studentAction } ] }
```
- 질문 3~6개. type은 6개 한국어 라벨만. sceneId는 입력 장면 ID 그대로.

## 서버 callable (functions/index.js `callWriteAfterQuestions`)
- callWorkCheck 패턴 동일: `_validateRequest('writeAfterQuestions')` → snapshot 안전제한 → `_runAiPrecheck`(safety+quick) → `_consumeQuota` → `_callAnthropic`(Haiku, 위 prompt) → `_parseJsonStrict` + 검증 → 실패 시 `_refundQuota`.
- 순수 모듈 `functions/write-after-questions.js`(firebase 비의존·테스트됨): `sanitizeSnapshotForQuestions`(장면≤25·body 500자·선택지 100자·**imageData/imageUrl/내부필드 제거**)·`validateQuestionsResponse`(질문 3~6·실존 sceneId만·중복 제거·**대필키 거부**).

## 입력 범위(AI 전송)
- projectType·장면(sceneId·title·body·isEnding·choices[label/nextId])만. **이미지·imageData·imageUrl·prompt·sourceMode 전송 금지.** 전체 DB dump 금지. 장면 ≤25·body ≤500자·선택지 ≤100자.

## 저장 경로
- `classes/{classId}/teams/{enc}/aiChecks/writeAfterQuestions/latest`(best-effort·"최근 질문 보기"용). 해시 기반 캐시 hit/forceRegenerate는 후속(이번엔 latest 단순 저장). **원본 body/imageData/aiVariants 무접촉.**
- 경로 결정: 진단형(읽기 전용·body 변형 아님)이라 `aiChecks` 네임스페이스 채택(작품검사와 일관). 스펙 "권장 aiVariants/..."에서 변경 — aiVariants는 body/image 변형용이라 부적합.

## quota / 비용
- `QUOTA.writeAfterQuestions = 5`(작품검사와 동일·브랜치당). Haiku(텍스트 저비용). 전역 500/일·root 50/일 안전상한 공유.

## 관리자 설정 (adminConsole.js)
- `AI_MODE_DEFS`에 `생각 점검 질문`(badge '새 기능') 추가, **기본 OFF**. state/payload에 writeAfterQuestions 포함(기존값 보존). textS1 계속 미노출. 마스터 토글은 enabled만(우발 ON 없음).

## 작품 마무리 UI (viewer-ai.js)
- 모달 카드 순서: **① 생각 점검 질문 → ② 작품 검사 → ③ 직접 고치기(안내) → ④ AI 장면발전 → ⑤ AI 그림책 마감**.
- 카드: 제목 `생각 점검 질문` / 설명 "내 이야기를 더 자세히 돌아볼 질문을 받아요. AI가 대신 고치지 않고 질문만 해요." / OFF면 비활성+"선생님이 아직 열어주지 않았어요".

## 결과 UI
- `_showWriteAfterQuestionsResultModal`: summary + 질문 카드 목록(장면 라벨·type·question·reason·studentAction). 각 카드 **[장면 X 이동]** 버튼 = 작품검사와 동일 `editNavigateTo` 재사용. 수정/대필 0.
- 장면 이동까지만(직접수정 복귀 스택은 Phase 5).

## 테스트 / 검증
- 순수 모듈 단위 **8/8**(snapshot 제한·정상·대필거부·3개미만거부·6개클램프·없는sceneId·중복·빈질문). 전체 node 테스트 **29파일 PASS**. node --check(index/prompts/write-after-questions/viewer-ai/adminConsole) OK. precommit·secret 0.
- 브라우저: 관리자 패널 실렌더 — [생각 점검 질문(새 기능)·작품 검사·AI 장면발전·AI 그림책 마감], **WAQ 기본 OFF**, textS1 없음. 서빙 viewer-ai.js에 카드·함수 존재. 캐시버스터 viewer-ai `writeafterui2waq1`·adminConsole `writeafterui1waq1`.
- ⚠️ **NOT_VERIFIED**: 모달 카드 인터랙티브 비주얼 + mock 질문 표시 + 장면 이동 실동작은 실 그림책 작품 + 교사 편집세션 필요(closure·지연로드). 코드+admin+테스트로 검증, 라이브 흐름은 deploy+enable 후.

## ⚠️ deploy 필요 (이 루프에선 미수행·보고만)
- 신규 `callWriteAfterQuestions`는 **functions deploy 필요**(기존 `ANTHROPIC_API_KEY` secret 재사용·새 secret 불필요). 미배포 시 클라 호출은 `functions/not-found`로 안전 실패(카드 기본 OFF라 학생 미노출).
- 활성화 절차(승인 후): ① functions deploy(`callWriteAfterQuestions`) ② 관리자 설정에서 학급별 `생각 점검 질문` ON ③ 라이브 흐름 smoke.

## 남은 Phase
- P4 작품검사 재정의(진단 항목 확장·[이 장면 고치기] 연결) / P5 직접수정 완료흐름(복귀 스택·다시 검사) / P6 AI 장면발전 최종화(입력=학생 수정본) / P7 최종 비교/선택(textSelections).

**판정: 구현 완료(서버 callable + 순수모듈 + 클라 UI + 관리자 설정 + 테스트). deploy·라이브 흐름 검증은 승인 후.**
