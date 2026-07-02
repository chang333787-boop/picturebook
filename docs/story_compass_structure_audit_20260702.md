# 생각 나침반 — 이야기 설계도 역할 점검 (STORY-COMPASS-STRUCTURE-AUDIT)

2026-07-02 · read-only 조사 (코드 수정 없음) · 기준 origin/main `e058ecf`
정본: docs/thought_compass_prd.md · thought-compass-questions.js · thought-compass-review.js

## 1. 현재 구조 요약

**흐름**: 게이트(신규 강제·기존 선택) → 핵심 7질문(한 화면 하나·보기3+직접입력+모르겠어요+유예)
→ AI 후속(필요시·세션≤5·전체≤12·G3/G4는 AI실패시 고정후속) → 최종 검토(Q&A 세로 목록+자유메모)
→ 완료 → BASE10 빈 틀 생성 → maker 진입. 완료 후 🧭 결과보기(브랜치+다듬기)=같은 목록 read-only.

**7질문**(G1~G7): audience(독자) → purpose(전하고픈 느낌) → protagonist(주인공) →
goal(목표) → obstacle(어려움) → branchChoice(갈림길) → protectedCore(지킬 중심).

**저장**: `writingGuide/preWriting` — `answers{qid:{answerText,answerStatus,choiceId?,deferred?}}` +
`followUps[{parentQuestionId,prompt,answer}]` + `userNotes.text`(자유메모 2000자) + status/completedAt.

**BASE10 연결**: `thought-compass-scenes.js` → 기존 `createStarterTemplateForNewProject` 위임.
**답변과 무관한 빈 틀 10장면** — 나침반 내용이 장면에 전혀 반영되지 않음(의도된 분리, PRD 1.3 "참고용").

## 2. 장점
1. **서사 아크 커버**: G3→G4→G5→G6(주인공→목표→장애→갈림길)은 이야기 뼈대 그 자체. G7(지킬 중심)은 퇴고 때 앵커로 탁월.
2. **국어과 정합**: G1·G2(독자·목적)는 쓰기 성취기준(독자와 목적 고려)과 일치 — 교사 명분 강함.
3. **답 못하는 학생 배려**: 모르겠어요 2단계 안내 + 유예("만들면서 정할래요") + 후속 상한 → 막히지 않음.
4. **AI 가드레일**: 대필 차단(BANNED_OUTPUT_KEYS)·평가어 금지·40자 한 문장 후속 — "AI가 이야기를 대신 만들지 않는다" 원칙 지켜짐.
5. **데이터가 이미 구조적**: 7 고정 키 + 후속 + 메모 → AI 정리/마인드맵 입력으로 바로 쓸 수 있는 형태.
6. **원본 보존(D-16)**: 완료 후 read-only + 메모만 수정 — 인쇄물 정본으로 쓰기 좋은 특성.

## 3. 약점
1. **★ 종합이 없다(최대 약점)**: 답 7개가 끝까지 "Q&A 목록"으로만 존재. 학생이
   "내 이야기는 ~~한 이야기"라고 말하게 해주는 **한 문장/설계도가 안 나온다**.
   PRD에 이미 있던 D-14(고정 7항목+AI 최소 정돈)·D-18(완료 결과만 나침반형 요약)이 **미구현**.
2. **보기만 고르면 얕다**: 보기 label이 그대로 answerText로 저장("사람", "안전한 길과 위험한 길 중
   어디로 갈지"). 7개 전부 보기만 고르면 설계도가 아니라 일반 문구 나열. AI 후속이 보완 장치지만
   유예·상한으로 얕게 통과 가능.
3. **분기형 적합성 절반**: branchChoice는 "갈림길이 무엇인가"까지만. 분기 스토리의 핵심인
   **"두 길이 각각 어디로 가는가"**(A안/B안 결말 방향)가 없음 → BASE10 직선 8장면과도 못 잇는다.
4. **순서의 진입 장벽**: 1·2번(독자·목적)이 가장 추상적인데 맨 앞. 학생은 주인공(3번)부터가 구체적.
5. **출력 형태 없음**: 인쇄/활동지 경로 자체가 없음(화면 모달뿐).

## 4. "형식적 질문지"가 될 위험
- 위험 시나리오: 보기 3연타 + 유예 2개 → 3분 완료 → Q&A 목록 → 닫기 → 다시 안 봄.
- 현재 구조에서 이 경로를 막는 장치는 AI 후속뿐인데, AI 후속은 "답이 모호할 때"만 발동하고
  보기 선택은 형식상 충분(sufficientWhen 충족)이라 통과된다.
- **결론: 위험은 실재하나, 원인은 질문이 아니라 "결과물이 없어서 답할 이유가 약한 것".**
  답이 설계도/인쇄물이 되어 돌아오면 답할 동기가 생긴다(출력이 입력의 질을 끌어올림).

## 5. "이야기 설계도"로 발전시키는 방향
원칙: **질문 재설계 불필요**(PRD 3차 인터뷰까지 검증된 세트). 부족한 것은 **출력층**.

### 5-1. 설계도 문장 (AI 없이 템플릿 — D-15 정신)
7답을 끼워 넣는 고정 프레임. 유예 답은 "(만들면서 정하기)"로 표기:
> **『{protagonist}』**의 이야기. 가장 이루고 싶은 것은 **{goal}**.
> 하지만 **{obstacle}** 때문에 쉽지 않다.
> 가장 중요한 갈림길: **{branchChoice}**.
> 끝까지 지키고 싶은 것: **{protectedCore}**.
> — **{audience}**에게, **{purpose}**.

### 5-2. 나침반형 1장 설계도 (D-18 실현·인쇄 대상)
- **중앙**: protectedCore(지킬 중심) — 나침반 바늘
- **N**: 주인공 / **E**: 목표 / **S**: 어려움 / **W**: 갈림길
- **테두리**: 독자·목적 / **하단**: 자유메모 + 설계도 문장
- `window.print()` + `@media print` CSS만으로 교사 인쇄/PDF 가능(서버·AI 불요).

### 5-3. 갈림길 두 갈래 보강 (분기형 적합성 — 유일한 질문 보강 후보)
질문 추가가 아니라 **branchChoice 고정 후속 1개**: "그 갈림길에서 두 길은 각각 어떻게 될까요?"
→ pathA/pathB 저장. PRD 개정(질문 상한 내) 필요 — 별도 결정 사안.

## 6. 추천 질문 구조 (순서만 소폭)
질문 문구는 유지하고 **순서 재배열만 검토**: protagonist → goal → obstacle → branchChoice →
protectedCore → audience → purpose (구체→추상, "누구 이야기?"로 시작).
단, 국어과 논리(독자·목적 먼저)와 상충하므로 **교사 선택 사항으로 남기고 기본은 현행 유지 권장**.

## 7. 최종 결과물 예시
> **『겁 많은 강아지 콩이』의 이야기.**
> 가장 이루고 싶은 것: 잃어버린 주인을 찾는 것.
> 하지만 콩이는 어두운 곳을 무서워해서 쉽지 않다.
> 갈림길: 무서운 지하도로 갈지, 멀지만 밝은 길로 갈지.
> 끝까지 지킬 것: 콩이가 용기를 내는 마지막 장면.
> — 우리 반 친구들에게, 용기를 내면 된다는 마음이 남았으면.

## 8. AI 정리용 데이터 구조 제안 (미래 마인드맵/활동지)
현 저장 구조 옆에 **파생 노드**(원본 불변·D-16 유지):
```
writingGuide/compassSummary: {
  version: 1, generatedAt, source: 'template' | 'ai',   // D-15: 실패시 template
  oneLiner: string(≤120),                               // "겁 많은 강아지가 주인을 찾아가는 이야기"
  storyMap: {
    protagonist: { text, trait? },   goal: { text },
    obstacle: { text },              branch: { question, pathA?, pathB? },
    core: { text },                  audience: { text }, purpose: { text },
  },
  deferredKeys: ['goal', ...],       // 유예 항목 — 활동지에 "만들면서 정하기" 칸으로
}
```
- 입력은 이미 존재(answers+followUps+userNotes) → 서버 callable 1개면 충분.
- 마인드맵/활동지/예쁜 출력은 전부 이 storyMap의 **뷰**로 구현(데이터 재설계 불요).

## 9. 구현 우선순위
| 순위 | 항목 | 성격 | 비용 |
|---|---|---|---|
| P-A | 템플릿 설계도 문장 — 검토·결과보기 상단 "내 이야기 한눈에" 카드 | 클라 전용·AI 0 | 소 |
| P-B | 인쇄용 결과지(@media print + 인쇄 버튼) | 클라 전용 | 소 |
| P-C | compassSummary AI 최소 정돈(D-14) + template fallback(D-15) | callable 1개 | 중 |
| P-D | 나침반형 시각 요약(D-18) — 화면+인쇄 공용 | 클라(P-C 활용) | 중 |
| P-E | 갈림길 두 갈래 후속(pathA/pathB) | PRD 개정 필요 | 중·별도 결정 |

## 10. 다음 구현 루프 후보
1. **COMPASS-SHEET-1**: P-A+P-B (템플릿 문장 + 인쇄) — 클라 전용·AI 0·최소 위험, 즉시 체감.
2. COMPASS-SUMMARY-AI-1: P-C (D-14 callable) — 기존 followup 가드레일 패턴 재사용.
3. COMPASS-ROSE-1: P-D (나침반형) — D-18 완성.
4. (보류) 순서 재배열·pathA/pathB — PRD 개정 인터뷰 후.

## 최종 판정
**STORY_COMPASS_STRUCTURE_GOOD_NEEDS_OUTPUT_SUMMARY**
— 질문 7개는 서사 뼈대·아동 배려·가드레일 모두 검증된 구조(재설계 불요).
결핍은 답을 모아주는 **출력층**: PRD에 이미 확정된 D-14(요약)·D-18(나침반형)이 미구현이며,
여기에 인쇄(결과지)를 더하면 "형식적 설문지" 위험이 "이야기 설계도"로 반전된다.
