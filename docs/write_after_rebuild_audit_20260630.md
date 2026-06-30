# 가지 — 쓰기 후 활동 재설계 read-only 구조 조사 (WRITE-AFTER-REBUILD Phase 0, 2026-06-30)

> 정본 철학: **쓰기 후 활동은 AI가 대신 고쳐주는 기능이 아니라, AI가 질문하고 검사해서 학생이 직접 고친 뒤, 마지막에 AI 장면발전과 AI 그림책 마감을 후보로 비교하는 마무리 활동이다.**
> 이 문서는 read-only 조사 산출물. 코드 수정 0. 기준 브랜치 `feature/write-after-rebuild` @ `ae7538a`(imageS2 병합 직후 main). 병렬 4에이전트 조사 종합.

## 1. 요약

- **현재 아키텍처는 재설계를 막지 않는다.** 원하는 흐름(맞춤질문→작품검사→직접수정→AI장면발전→최종비교→AI그림책마감)은 기존 구조에 **평행 추가**로 구현 가능하다.
- 텍스트 AI 1단계(문장 정돈)는 작품검사와 역할이 겹쳐 신규 흐름에서 제거 대상이며, **UI 숨김 + 보기 토글 정리(판정 B)**로 안전하게 가능하다. 서버 callable·구작품 데이터는 보존한다(삭제 금지).
- 텍스트 AI 2단계(장면 발전)는 **원본 body 기준 독립 실행**이라 1단계 제거에 영향받지 않는다. 유지·최종화 대상.
- 작품검사(callWorkCheck)는 이미 흐름/선택지/인물/분기 진단을 하고 결과 모달에 "장면 이동" 버튼이 있어, **prompt 확장으로 재정의** 가능(새 callable 불필요).
- 맞춤형 점검 질문은 생각나침반의 **인프라(권한/쿼터/저장/이어서하기/카드 UI/디바운스/서버 가드)는 재사용**하되 prompt·schema·callable은 신규가 필요하다.
- 최종 비교/선택은 텍스트에 **발행 선택(textSelections)이 아직 없다.** 이미지의 imageSelections + getPublishedImageDisplaySrc 패턴을 평행 복제하면 충돌 없이 도입 가능하다(구작품은 fallback 원본=무위험).
- 직접 수정은 editNavigateTo + saveSceneText(원본 body 직접 저장=학생 수정본=정상)로 재사용 가능. 단 "검사→고치기→검사 복귀" 컨텍스트 복귀 스택만 신규.

## 2. 현재 코드 구조 (핵심 위치)

| 영역 | 코드 위치 |
|---|---|
| AI 다듬기 모달 | viewer-ai.js `_showModeModal` (3085–3232), 카드 렌더 `_renderModeCard`(3063), 가용성 `_getModeAvailability`(2871), 교사게이트 `_isModeAllowedByTeacher`(471), `AI_MODE_KEY_MAP`(456) |
| 텍스트 1단계 | 클라 `_startTextS1V140`/`_phaseACallTextS1` → 서버 `callTextAiBatch`(functions/index.js:1359), prompt `TEXT_S1_SYSTEM_PROMPT`(prompts.js:18) |
| 텍스트 2단계 | 클라 `_startTextS2` → 서버 `callTextAiBatchS2`(1566), prompt `TEXT_S2_SYSTEM_PROMPT`(prompts.js:329), 결과 모달 `_showS2ResultModal`(728) |
| 작품검사 | 서버 `callWorkCheck`(1655), prompt `WORK_CHECK_SYSTEM_PROMPT`(prompts.js:478), 결과 모달 `_showCheckResultModal`(3702), 저장 `aiChecks/workCheck/latest` |
| 생각나침반 | 서버 `callThoughtCompassFollowUp`(2686), prompt(prompts.js:637), 질문 `thought-compass-questions.js`, UI `thought-compass-ui.js`, 저장 `writingGuide/preWriting` |
| 직접 수정 | `editNavigateTo`(viewer-controls.js:49), `saveSceneText`(viewer-data.js:416), contenteditable `initEditInteractions`/`_attachPbEditableInteractions`(viewer-edit.js) |
| 이미지 선택(참고) | `getPublishedImageDisplaySrc`/`setPublishedImageSelectionForScene`(viewer-data.js:1681–1709), `aiVariants/imageSelections/{sid}` |
| 텍스트 보기 토글 | `_showAiToggleBar`(2509), `_getDisplayBody`(2491), localStorage `pb_ai_view_mode_v140__{ns}`=original/aiS1/aiS2 |
| 권한/쿼터 | `_validateRequest`(419), `QUOTA`(88: s1:3/s2:2/check:5/imageS2:60), `AI_MODE_DEFS`(adminConsole.js:324) |

## 3. 현 UI 카드/토글 구조 (모달 인벤토리)

| 카드 | key | 노출 | enabled 게이트 | callable | 새 설계 처리 |
|---|---|---|---|---|---|
| 📝 텍스트 1단계(문장 정돈) | s1 | 항상 | 교사s1 & 본문≥1 | callTextAiBatch | **폐기 예정**(UI 숨김+토글 정리. callable·데이터 보존) |
| 🔍 작품 검사 | check | 항상 | 교사check & 본문≥2 | callWorkCheck | **재정의**(진단 항목 확장) |
| ✨ 텍스트 2단계(장면 발전) | s2 | 항상 | 교사s2 & 본문≥1 | callTextAiBatchS2 | **유지·최종화**(직접수정 後 단계로 위치) |
| 🖼 AI 그림책 마감 | imageS2 | edit+picturebook | aiSettings.imageS2 | callImageAiS2 | **유지**(그림책 마지막) |

- 보기 토글(텍스트) `_showAiToggleBar`: [원본 | AI 문장 정돈(s1) | AI 장면 발전(s2)] → 신규: **s1 버튼 제거, [원본 | AI 장면발전]만**.
- 보기 토글(이미지)는 이미 imageS1 폐기 처리됨(원본 | AI 그림책 마감).
- 죽은 문구: `s3:{enabled:false,'준비 중'}`(카드 미생성), s2 카드에 "준비 중" badge 없음(활성).

## 4. 텍스트 1단계 폐기 영향 — 판정 **B (보기 토글도 함께 정리)**

- textS2는 `_buildWorkSnapshot`(원본 body)만 입력 → **textS1 결과 미참조**. 선행 수정 불필요.
- 저장: `aiVariants/text/{sid}/s1`(FB) + localStorage. 구작품에 남아 있으면 `_isS1Finalized`/`_fbHasVariant('s1')`(viewer-ai.js:2197/2189)가 true → 토글 바에 "AI 문장 정돈" 버튼 노출(2531).
- 따라서 **UI 카드 숨김만으로는 부족**: 보기 토글의 s1 버튼 렌더 가드도 함께 정리해야 stale 노출이 없다.
- **서버 `callTextAiBatch` 삭제 금지**(구작품 read 호환), 기존 `aiVariants/text/{sid}/s1` 데이터 삭제 금지.
- 판정 근거: 의존성 0(C 아님), UI+토글 2지점 정리 필요(A 초과), 서버 dead-code 즉시 제거 불요(D 후순위), 즉시 제거 위험 없음(E 아님) → **B**.

## 5. 작품검사 현황 — **재정의 가능(prompt 확장)**

- 현재: 8개 진단 항목 → 4카테고리(맞춤법/유기성/캐릭터/분기흐름). 본문 수정 제안 금지(진단 전용). 전체 장면 일괄. snapshotHash 캐시.
- 결과 모달에 이미 "장면 X로 이동" 버튼 존재 → **직접수정 동선의 기반이 이미 있음**.
- 원하는 새 진단(이야기 흐름·선택지↔다음장면 연결·인물/물건 지속성·엔딩 자연스러움·빈/짧은 장면·친구 이해가능성)은 현재 4카테고리와 상당 부분 겹침 → **prompt/schema 확장으로 재정의**, 새 callable 불필요.
- 단 "그림과 글 일치"는 이미지 입력이 필요 → 별도 처리(후속 Phase에서 범위 결정).

## 6. 생각나침반 재사용 가능성 — **인프라 재사용 + 로직 신규**

| 재사용 가능(인프라) | 신규 필요(로직) |
|---|---|
| 서버 게이트(auth/origin/membership/aiSettings/killswitch/quota) | 동적 점검 질문 생성 prompt(완성 작품 읽고 성찰 질문) |
| 진행상태 저장(status/answers/updatedAt) | 질문 schema(고정 7개 아님·개방형) |
| 이어서하기(resume) 패턴 | 질문 카드 렌더(선택지 아닌 개방형 입력) |
| 답변 저장(debounce 700ms + flush) | 신규 callable(예: 동적 점검 질문) |
| 카드 UI 골격 | 저장 경로 분리(`writingGuide/postWriting...`) |

- 쓰기 전(고정 7질문, 방향 정하기) ≠ 쓰기 후(완성 작품 기반 동적 점검). schema/prompt/렌더는 신규, 저장·복구·게이트는 재사용.

## 7. AI 장면발전(텍스트 2단계) 현황 — **유지, 위치 재정의**

- callTextAiBatchS2, 입력=원본 snapshot(s1 미의존), 저장 `aiVariants/text/{sid}/s2`, 원본 body 불변.
- 전체 일괄(chunk 4·max 24장면), 결과 모달 장면별 선택(강제 적용 X), 학생/교사 공통, text/picturebook 공통.
- 새 역할: **학생이 직접 고친 원본을 바탕으로 장면을 풍부하게 만드는 마지막 후보**. 현재 prompt가 "원본 기준 발전"이라 입력 기준은 그대로 적합. UI 문구·흐름상 위치(직접수정 後)만 재정의. 결과는 후보로 남김.

## 8. 직접 수정 흐름 가능성 — **기존 체계로 충분**

- `editNavigateTo(sceneId)`로 특정 장면 점프(lock 자동 재확보), `saveSceneText(num,{title,body})`가 **scene.body 원본 필드에 직접 저장**.
- ⚠️ 정책 확인: 텍스트 직접수정은 **원본 body 덮어쓰기가 의도된 흐름**(이미지는 원본 imageData 불변과 다름). "최종 원본 = 학생이 직접 고친 글"이라는 철학과 일치.
- AI 보기 중에는 본문 contenteditable 비활성(원본 보호) — 정상.
- 엔딩 장면 title/body 편집 가능(선택지 추가는 구조편집이라 차단).
- 신규: 검사/질문 결과 카드 → [이 장면 고치기] → editNavigateTo → 저장 → 복귀. **복귀 스택이 없으므로**(editNavigateTo는 선형) "검사로 자동 복귀"가 필요하면 작은 컨텍스트 상태 신규(모달 close 방식이면 불필요).

## 9. 최종 비교/선택 구조 가능성 — **textSelections 신규(충돌 0)**

- 현재 텍스트: localStorage 토글(`_getAiViewMode`: original/aiS1/aiS2)만. **발행 선택(textSelections) 없음**.
- 이미지: `aiVariants/imageSelections/{sid}.selected`(s2/original) + `getPublishedImageDisplaySrc`(viewer-data.js, team 1회 로드·동기 조회) — **참고 모델 존재**.
- 정책(검증됨, 이미지와 충돌 0):
  - 원본 body = 학생 수정본(scene.body)
  - AI 장면발전 = `aiVariants/text/{sid}/s2`
  - 선택 = `aiVariants/textSelections/{sid}` (신규)
  - viewer: selection=s2면 AI 장면발전, 아니면 원본
  - 토글(원본|AI 장면발전) = localStorage 임시 UI(≠ 발행 선택, 교사 정책)
- 신규 필요: textSelections path + `getPublishedTextDisplayBody()` helper(이미지 복제) + viewer-render 통합 3곳(text·picturebook·ending) + 교사 발행 UI.
- 구작품(textSelections 없음) → fallback 원본 = **무위험·마이그레이션 0**.
- ⚠️ 엔딩에 textSelections 적용 여부는 plan에서 명시(이미지는 엔딩도 적용).

## 10. imageS2와의 관계 / ptype별 카드

- imageS2 카드 = `_isEditSess && _isPicturebook && aiSettings.imageS2`. 텍스트 작품 미노출.
- ptype = `ViewerState.project.projectType`(text/picturebook). 게이트 재사용 가능.
- 구성:
  - **텍스트 작품**: 맞춤질문 · 작품검사 · 직접수정 · AI 장면발전
  - **그림책 작품**: + AI 그림책 마감
  - 그림책에 텍스트 거의 없는 장면 → 맞춤질문/검사/장면발전은 본문 필터로 자동 스킵, 안내 필요.

## 11. 데이터/권한/비용 위험

- 텍스트 AI는 작품 snapshot(본문 장면 전체)을 서버 경유 Anthropic Haiku로 전송 — **기존 운영 중·승인된 경로**(신규 위험 아님). 장면 수 상한 textS2=24·chunk 4.
- 권한 `_validateRequest`: aiSettings.modes > aiPermission > default ON. **학생도 s1/s2/check 직접 호출 가능**, imageS2만 교사. → 새 맞춤질문/재정의 검사의 학생/교사 권한은 **정책 결정 필요**(초기엔 교사/from=maker 권장).
- 쿼터: 새 기능은 `QUOTA`에 mode 추가 + `AI_MODE_DEFS` 체크박스 추가로 텍스트 AI 설정 하위 편입 가능. imageS2는 별도 설정 유지.
- 비용: 텍스트=Haiku(저비용), 맞춤질문/재정의 검사도 Haiku 가정. imageS2만 유료 이미지(별도 게이트·기본 OFF).

## 12. 추천 최종 UX

1. **생각 점검 질문** — "내 이야기를 더 자세히 돌아볼 질문을 받아요."
2. **작품 검사** — "이야기 흐름과 선택지 연결을 확인해요."
3. **직접 고치기** — "질문과 검사 결과를 보고 내가 직접 고쳐요."
4. **AI 장면발전** — "내가 고친 글을 바탕으로 장면을 더 풍부하게 해요."(후보)
5. **AI 그림책 마감** — "내 그림을 그림책처럼 마감해요."(그림책·후보)
6. 최종 감상 확인 — 텍스트 원본(학생 수정본) / 텍스트 2단계(AI 후보), 원본 그림 / AI 그림책 마감 후보.

## 13. 추천 구현 Phase

- Phase 2: UI 1차 정리 — 텍스트 1단계 카드 숨김 + 보기 토글 s1 정리(판정 B), 모달 카드 순서를 마무리 흐름대로, 죽은 문구 제거. (서버·데이터 무변경)
- Phase 3: 맞춤형 점검 질문 — 생각나침반 인프라 재사용 + 신규 prompt/schema/callable.
- Phase 4: 작품검사 재정의 — prompt 확장(흐름/연결/지속성/엔딩/빈장면/이해가능성) + 결과→[이 장면 고치기] 연결.
- Phase 5: 직접 수정 완료 흐름 — editNavigateTo+저장+복귀(필요 시 컨텍스트 상태), "다시 검사".
- Phase 6: AI 장면발전 최종화 — 입력=학생 수정본, 후보 저장, UI 문구.
- Phase 7: 최종 비교/선택 — textSelections + getPublishedTextDisplayBody + render 통합 + 교사 발행 UI.
- Phase 8: 전체 smoke / release audit.

## 14. Phase 2 명령 초안 (다음 루프)

> 범위: 클라 UI만. 서버/Rules/DB/데이터 무변경. feature/write-after-rebuild에서 작업.
> 1) viewer-ai.js `_showModeModal`에서 텍스트 1단계(s1) 카드 미렌더(교사·학생 공통). 2) `_showAiToggleBar`에서 s1 버튼 렌더 가드(stale 노출 방지·기존 s1 데이터는 보기만 차단, 삭제 0). 3) 모달 카드 순서/문구를 마무리 흐름(질문→검사→직접고치기→장면발전→그림책마감)에 맞춰 정리. 4) 죽은 문구(s3 준비중 등) 정리. 5) callable·prompt·저장경로 무변경. 6) 캐시버스터 갱신·precommit·node --check·image-s2/회귀 테스트·브라우저 smoke(공개 fixture). 7) Critical/High면 중단.

## 15. Critical / High / Medium / Low

- **Critical: 0** (현재 아키텍처가 재설계를 막지 않음).
- **High: 0** (에이전트가 올린 "전체 작품 외부 전송"·"imageS2 모델 미결정"은 기존 승인·확정 사항이라 신규 차단요인 아님. "textSelections 미존재"는 결함이 아니라 Phase 7 구현 항목).
- **Medium**:
  - 텍스트 1단계 폐기 시 보기 토글 s1 가드 누락하면 stale 노출 → Phase 2에서 함께 처리.
  - 맞춤질문/재정의 검사의 학생/교사 실행 권한 정책 미결 → plan에서 결정(초기 교사 권장).
  - 엔딩 장면에 textSelections 적용 범위 미명시 → plan에서 명시.
  - 직접수정 "검사 복귀" 컨텍스트 스택 부재 → Phase 5 설계.
- **Low**:
  - 죽은 문구(s3 준비중, TEST MODE badge) 정리.
  - 토글(UI) ≠ 발행 선택(정책) 개념 혼동 → 문서·문구로 구분.

**판정: `WRITE_AFTER_REBUILD_AUDIT_READY`** — 조사 완료. 현재 아키텍처는 재설계를 막지 않으며, 평행 추가 방식으로 구현 가능. 설계 문서(plan)로 이어간다.
