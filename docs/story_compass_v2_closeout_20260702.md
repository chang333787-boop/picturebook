# 생각 나침반 v2 — 완료 상태 정리 (STORY-COMPASS-V2-CLOSEOUT)

2026-07-02 · 인수인계 문서(코드 무수정) · main HEAD `96cd5c3` (=origin/main·drift 0)
운영 Functions: `callThoughtCompassFollowUp` **deploy 완료 상태**(2026-07-02·승인 후 1개만·기록).

## 1. 최종 기능 흐름 (전부 live)
```
신규 그림책/텍스트 작품
 → 생각 나침반 게이트(강제) → v2 10문항(보기3+직접입력+모르겠어요+유예)
 → AI 후속 판정(필요시·서버 라이브) → 최종 검토(설계도+Q&A+자유메모)
 → 완료 → 기본 장면 생성(targetLength 8/12/15 → 10/14/17노드)
 → maker 제작 → 🧭 결과보기(카드형 설계도+인쇄 / 나침반형 A4 선택 보기)
```

## 2. 작업/커밋 이력 (전부 main 병합·push)
| 루프 | merge | 문서 |
|---|---|---|
| V2-QUESTION-DESIGN (설계) | `23e6b4d` | docs/story_compass_v2_question_design_20260702.md |
| V2-CLIENT-1 (10문항 클라) | `3c48c3a` | docs/story_compass_v2_client_1_20260702.md |
| SHEET-1 (설계도+인쇄) | `dee5ddf` | docs/compass_sheet_1_20260702.md |
| BUNDLE-1 (LENGTH+polish+audit×2) | `2e35520` | docs/compass_bundle_1_20260702.md (+rose/followup audit md) |
| ROSE-MOCKUP → ROSE-1 (나침반형) | `2426a3c` → `cbbdd91` | docs/compass_rose_mockup_1 / compass_rose_1_20260702.md |
| FOLLOWUP-IMPLEMENT (+deploy) | `96cd5c3` | docs/compass_v2_followup_implementation_20260702.md |

선행 감사: docs/story_compass_structure_audit_20260702.md (`dffc797`) · PRD: docs/thought_compass_prd.md

## 3. v2 10문항 (정본: thought-compass-questions.js CORE_QUESTIONS_V2)
`targetLength`(1·보기전용) → `protagonist` → `goal` → `mainlineStart` → `incitingEvent`
→ `risingTrouble` → `keyChoice` → `trueEnding` → `alternatePath` → `coreMessage`
- 구조: 그릇(1)+재료(2~3)+진엔딩 시간축(4~8)+분기(9)+앵커(10). audience/purpose는 질문에서 제외(결과지 표지 칸 개념으로 강등).
- targetLength만 allowCustom:false. "아직 모르겠어요"=공통 유예 흐름("이야기를 만들면서 정할래요").

## 4. storyMapV2 (렌더 시 파생·DB 저장 없음 — thought-compass-sheet.js)
`buildStoryMapV2(answers)` → `{ fields[10]{key,label,icon,text,deferred}, deferredKeys[], summaryText }`
- targetLength choiceId→"약 8/12/15장면" 표기. 유예="만들면서 정하기". summaryText=템플릿 한 문단(AI 0).
- 카드형 설계도·인쇄·나침반형 전부 이 파생값의 뷰. 저장 스키마는 `writingGuide/preWriting` 원본 그대로.

## 5. targetLength → 기본 장면 생성 (thought-compass-scenes.js + mobileTextBranch.js)
- 완료 경로만: review→afterComplete(answers)→`resolveStoryCount`→`_mtbBuildBase10Scenes({storyCount})`.
- N=이야기 장면 수(표지·엔딩 제외): **8→10노드(기존 BASE10과 JSON 동일)·12→14·15→17**. 선형만(분기 자동생성 없음).
- fallback: 유예/모르겠어요/v1/이상값 → **8**(기존 기본 틀=최소 놀람). 수동 버튼·ui.js 폴백 경로도 8.
- 기존 scenes 재생성 없음(멱등 가드 기존 그대로).

## 6. v1 하위호환 (불변 원칙)
- `resolveQuestionSetVersion`: fresh/notStarted→v2 · version 2 or v2 answer 키→v2(자가복구) · **v1 진행/완료→v1 완주**.
- v1 answers 7키 불변·migration 0·교사 초기화 후 재시작만 v2. v1 결과보기=기존 목록(설계도/나침반 미노출).
- 완료판정 v1=7키/v2=10키. plan version 스탬프(시작 2·저장 재스탬프·완료 세션값).

## 7. 결과지/나침반형 출력 정책
- **카드형(SHEET-1)=기본·모바일 정본**: v2 검토+결과보기에 설계도(줄거리+카드10)+🖨 인쇄(gate `tc-print-sheet`).
- **나침반형(ROSE-1)=v2 결과보기 전용 선택 보기**: [🧭 나침반형] 버튼(모바일≤600px 숨김·v1/검토 미노출)
  → 오버레이(중앙 coreMessage·4방위·진엔딩 시간띠+옆가지·손글씨 칸) → 🖨 A4 1페이지(gate `tc-print-rose`).
- 두 인쇄 gate 모두 버튼 경유에만 활성 — 일반 화면/일반 인쇄 영향 0. 새 라이브러리 0.

## 8. AI 후속 질문 (라이브 활성)
- 서버: `callThoughtCompassFollowUp` (asia-northeast3) — allowlist **v1+v2 합집합 15키**·MAX_TOTAL 15·
  SUMMARIES 10·fallback 5키(v1 protagonist/goal + v2 trueEnding/keyChoice/incitingEvent)·그 외 NEXT.
  auth+SEC-01 멤버십+killswitch+aiSettings+글로벌 캡 게이트 기존 그대로. index.js/prompts 무수정.
- 클라: 세트별 상한(v1 7+5=12 · v2 10+5=15)·targetLength 판정 요청 생략·학생 '다음' 시에만 호출(자동 0).
- deploy 검증: unauth `UNAUTHENTICATED` 거부·로그 오류 0.

## 9. Functions deploy 대상 (기록)
이번 v2 로드맵 전체에서 deploy된 함수 = **`callThoughtCompassFollowUp` 1개뿐**. Rules/DB migration 0.

## 10. 금지/주의 (후속 작업자용)
- `preWriting.answers` 원본 불변 원칙(D-16) — 파생은 항상 별도 계산/노드.
- 질문 세트 변경 시 3곳 동기화: questions.js(정본)+thought-compass.js KEYS+functions followup allowlist/BRIEF — 테스트가 교차검증(tests/thought-compass/).
- 인쇄 CSS는 반드시 body 클래스 gate 안에만(@page 전역 금지 — 타 인쇄 오염).
- BASE10 빌더 storyCount는 8/12/15만 인정 — 다른 값 추가 시 scenes.js STORY_COUNTS와 동기화.
- maker.html의 compass 스크립트 수정 시 ?v= 캐시버스터 필수(+viewer 지연번들 V+EDIT_SRC).

## 11. 남은 실사용 관측 항목 (작업 아님 — 수업 1바퀴로 확인)
1. **v2 AI 후속 품질**: 신규 8키에 대한 NEXT/ASK_FOLLOW_UP 판정 적절성 — functions 로그 관측.
2. **12/15장면 실사용 부담**: 초등학생이 긴 기본 길을 실제로 채우는지·중도 포기율.
3. **iPad/Safari 인쇄**: 카드형·나침반형 1페이지 실기기 확인(afterprint 방어는 코드 처리됨).
4. **나침반형 실효성**: 인쇄 활동지가 실제 수업에서 쓰기에 도움이 되는지(교사 피드백).
5. 실 RTDB에서 v2 완주→14/17노드 생성 왕복(스텁 검증만 완료).

## 12. 다음 큰 작업 후보
- COMPASS-SUMMARY-AI (D-14): summaryText AI 최소 정돈 + compassSummary 파생 노드(callable 1개·별도 승인).
- 관측 결과 기반 v2 질문 문구/보기 미세 조정(PRD 개정 인터뷰).
- 나침반 외 트랙: WRITE-AFTER enforce ON(membership log-only 관측 중)·imageS2 전체공개.

## 최종 판정
**STORY_COMPASS_V2_CLOSEOUT_DONE** — v2 로드맵(설계→클라→설계도→길이→나침반형→AI후속 deploy) 전 단계 live·문서화 완료.
