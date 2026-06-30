# 가지 — 쓰기 후 활동 재설계 설계 문서 (WRITE-AFTER-REBUILD Phase 1, 2026-06-30)

> 정본 철학: **쓰기 후 활동은 AI가 대신 고쳐주는 기능이 아니라, AI가 질문하고 검사해서 학생이 직접 고친 뒤, 마지막에 AI 장면발전과 AI 그림책 마감을 후보로 비교하는 마무리 활동이다.**
> 짝 문서: 조사 = `write_after_rebuild_audit_20260630.md`. 기준 브랜치 `feature/write-after-rebuild` @ `ae7538a`. 설계 문서(코드 0).

## 1. 최종 사용자 흐름

```
[작품 완성]
   │
   ├─ 1. 생각 점검 질문   "내 이야기를 더 자세히 돌아볼 질문을 받아요."
   │       AI가 완성 작품을 읽고 작품별 맞춤 성찰 질문 → 학생이 직접 답(고치기 X)
   │
   ├─ 2. 작품 검사        "이야기 흐름과 선택지 연결을 확인해요."
   │       AI 진단(고쳐주기 X): 흐름·선택지↔다음장면·인물/물건 지속성·엔딩·빈/짧은 장면·친구 이해
   │       결과 카드 → [이 장면 고치기]
   │
   ├─ 3. 직접 고치기      "질문과 검사 결과를 보고 내가 직접 고쳐요."
   │       학생이 scene.body 직접 편집(= 최종 텍스트 원본). 다시 검사 가능.
   │
   ├─ 4. AI 장면발전      "내가 고친 글을 바탕으로 장면을 더 풍부하게 해요." (후보)
   │       입력 = 학생이 고친 원본. 결과 = aiVariants/text/{sid}/s2 (원본 불변)
   │
   └─ 5. AI 그림책 마감   "내 그림을 그림책처럼 마감해요." (그림책·후보)
           원본 그림 불변, 결과 = aiVariants/image/{sid}/s2

[최종 감상 확인]
   글: 텍스트 원본(학생 수정본)  |  텍스트 2단계(AI 장면발전 후보)
   그림: 원본 그림              |  AI 그림책 마감 후보
   → 선택(textSelections / imageSelections)으로 발행 결정. 기본 = 원본.
```

## 2. ptype별 카드 구성

| ptype | 카드 |
|---|---|
| 텍스트 작품 | ① 생각 점검 질문 · ② 작품 검사 · ③ 직접 고치기 · ④ AI 장면발전 |
| 그림책 작품 | ① 생각 점검 질문 · ② 작품 검사 · ③ 직접 고치기 · ④ AI 장면발전 · ⑤ AI 그림책 마감 |

- ptype = `ViewerState.project.projectType`. imageS2 카드는 기존 게이트(picturebook+edit+aiSettings.imageS2) 유지.
- 그림책에 본문 거의 없는 장면: 검사/장면발전은 본문 필터로 스킵 + "글이 적어 일부 단계는 생략돼요" 안내.
- 텍스트 1단계(문장 정돈) 카드는 **전 ptype에서 제거**.

## 3. 텍스트 1단계 처리 정책

- 신규 흐름 UI에서 **카드 제거 + 보기 토글 s1 버튼 제거**(판정 B).
- 서버 `callTextAiBatch` **보존**(구작품 read 호환), 기존 `aiVariants/text/{sid}/s1` 데이터 **보존**(삭제 0).
- 가드: `_isS1Finalized`/`_fbHasVariant('s1')`로 s1 결과가 있어도 신규 토글/카드에 노출하지 않음(보기 차단만, 데이터 무변경).
- 서버 dead-code 정리는 **후순위**(Phase 8 이후 별도 판단).

## 4. 맞춤형 점검 질문 — JSON 초안

신규 callable(예: `callPostWritingQuestions`). 생각나침반 인프라(권한/쿼터/저장/resume/카드 UI/디바운스/가드) 재사용.

요청(서버 입력 allowlist):
```json
{
  "projectType": "text | picturebook",
  "snapshot": { "<sceneId>": { "title": "", "body": "", "choices": [], "isEnding": false } },
  "maxQuestions": 5
}
```
응답:
```json
{
  "ok": true,
  "questions": [
    {
      "id": "q1",
      "sceneId": "3",
      "focus": "character | flow | choice | ending | detail | feeling",
      "prompt": "주인공이 왜 그렇게 결정했는지 한 줄로 더 적어볼까요?",
      "hint": "마음·이유를 떠올려 보세요."
    }
  ],
  "version": "postQ-v1"
}
```
- 질문은 **개방형**(보기 없음). 학생이 직접 답을 적고, 답은 고치기 트리거(선택). AI는 **대필 금지**(생각나침반 가드 계승).
- 저장: `writingGuide/postWriting/questions` + `.../answers/{qid}`(학생 답·debounce flush). 진행상태 status/updatedAt.

## 5. 작품검사 — JSON 초안 (재정의)

기존 `callWorkCheck` prompt/schema 확장. 본문 수정 제안 금지(진단 전용) 유지.
```json
{
  "ok": true,
  "scope": "all",
  "globalSummary": "이야기 흐름은 자연스러워요. 선택지 1개가 다음 장면과 연결되지 않았어요.",
  "findings": [
    {
      "sceneId": "5",
      "category": "flow | choice_link | continuity | ending | empty_short | clarity",
      "severity": "info | warn",
      "message": "이 선택지가 어느 장면으로 이어지는지 정해지지 않았어요.",
      "action": "edit_scene"
    }
  ],
  "version": "check-v2"
}
```
- 카테고리: 흐름(flow)·선택지↔다음장면 연결(choice_link)·인물/물건 지속성(continuity)·엔딩 자연스러움(ending)·빈/짧은 장면(empty_short)·친구 이해가능성(clarity).
- "그림과 글 일치"는 이미지 입력이 필요 → 초기 범위 제외, 후속.
- `action: "edit_scene"` finding은 결과 카드에 **[이 장면 고치기]**(기존 "장면 이동" 버튼 재사용).
- 저장: `aiChecks/workCheck/latest`(기존). 재검사는 snapshotHash 캐시.

## 6. 직접 수정 UX

- 검사/질문 카드 [이 장면 고치기] → `editNavigateTo(sceneId)` → 해당 장면 contenteditable 편집 → `saveSceneText`(scene.body 직접) → 마무리로 복귀.
- 복귀: 마무리 패널을 다시 여는 방식(컨텍스트 상태 `_postReviewReturn` 신규, 모달 close로 복귀하면 최소).
- 저장 후 "다시 검사하기"로 재진단(캐시 무효=새 snapshotHash).
- 학생 수정본 = **최종 텍스트 원본**. 엔딩 title/body도 편집 가능(선택지 추가는 구조편집·차단 유지).

## 7. AI 장면발전 최종화 정책

- 입력 = **학생이 직접 고친 원본 body**(현재도 원본 snapshot 입력이라 그대로 적합).
- 결과 = `aiVariants/text/{sid}/s2`(원본 body 불변). 전체 일괄·장면별 후보 선택 유지.
- UI 문구: "내가 고친 글을 바탕으로 장면을 더 풍부하게 해요." 위치 = 직접 고치기 **이후**.
- 결과는 강제 적용 0 → 후보로만.

## 8. 텍스트 원본 / 텍스트 2단계 비교 정책

- 원본 body = 학생 수정본. AI 장면발전 = `aiVariants/text/{sid}/s2`.
- **발행 선택 = `aiVariants/textSelections/{sid}`**(신규, imageSelections 평행). 값 `selected: "original" | "s2"`. 기본 = original.
- viewer render: `getPublishedTextDisplayBody(scene, originalBody)` 신규 helper(이미지 `getPublishedImageDisplaySrc` 복제) → selection=s2면 AI 장면발전, 아니면 원본. team 1회 로드 캐시.
- 통합 지점: viewer-render.js text(502)·picturebook(651)·ending. 발행 hook을 토글(localStorage) **앞에** 적용(교사 비교 보존, imageS2 패턴과 동일).
- 토글(원본|AI 장면발전) = 개별 UI 임시. 발행 선택 = 교사 정책(영구).
- 엔딩 textSelections 적용 = **포함**(이미지와 일관).
- 구작품 textSelections 없음 → fallback 원본(무위험·마이그레이션 0).

## 9. imageS2 카드 유지 정책

- 그림책 마지막 단계로 유지. 게이트(picturebook+edit+aiSettings.imageS2) 무변경. 기본 OFF 운영.
- 텍스트 작품 미노출. 텍스트 발행 선택(textSelections)과 이미지 발행 선택(imageSelections)은 독립.

## 10. 구현 순서 (Phase)

1. **Phase 2** — UI 1차 정리(텍스트1단계 카드/토글 숨김, 카드 순서·문구, 죽은 문구). 클라만.
2. **Phase 3** — 맞춤형 점검 질문(신규 callable + 생각나침반 인프라 재사용 + 카드 UI).
3. **Phase 4** — 작품검사 재정의(prompt/schema v2 + [이 장면 고치기] 연결).
4. **Phase 5** — 직접 수정 완료 흐름(점프·저장·복귀·다시 검사).
5. **Phase 6** — AI 장면발전 최종화(입력=수정본·문구·위치).
6. **Phase 7** — 최종 비교/선택(textSelections + getPublishedTextDisplayBody + render 통합 + 교사 발행 UI).
7. **Phase 8** — 전체 smoke / release audit / 문서.

## 11. 각 Phase 중단 조건

- Critical/High 발견 시 다음 Phase 진행 금지.
- 기존 데이터/텍스트 1단계 결과 삭제 금지.
- 원본 scene.body는 **직접 수정(학생)만** 갱신, AI 결과가 원본 body를 덮어쓰면 즉시 중단.
- main 직접 작업 금지. feature/write-after-rebuild에서 단계별 commit/push.
- 서버 callable 삭제는 후순위(Phase 8 이후).
- tracked dirty·feature/main 충돌·테스트/precommit 실패 시 중단 보고.

## 12. 권한·쿼터·비용 정책 (초안, 결정 필요)

- 맞춤질문·재정의 검사·장면발전: 텍스트 AI 설정(`aiSettings.modes`) 하위. 새 mode 키 추가 시 `AI_MODE_DEFS` + `QUOTA` 동반.
- 초기 실행 권한: **교사/from=maker 우선 노출** 권장(학생 직접 실행 확대는 별도 결정). 현재 s1/s2/check는 학생도 호출 가능하므로 정책 통일 필요.
- imageS2는 별도 설정·유료·기본 OFF 유지.

---

**판정: `WRITE_AFTER_REBUILD_PLAN_READY`** — 설계 완료. 다음 루프 = Phase 2(UI 1차 정리, 클라만, 데이터·서버 무변경).
