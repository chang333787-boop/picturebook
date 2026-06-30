# 가지 — 쓰기 후 활동 UI 1차 정리 결과 (WRITE-AFTER-UI-REBUILD-1, 2026-06-30)

> 정본 철학: **쓰기 후 활동은 AI가 대신 고쳐주는 기능이 아니라, AI가 질문하고 검사해서 학생이 직접 고친 뒤, 마지막에 AI 장면발전과 AI 그림책 마감을 후보로 비교하는 마무리 활동이다.**
> Phase 2(클라 UI만). 서버 callable·Rules·DB·기존 데이터 무변경. 브랜치 `feature/write-after-rebuild`.

## 수정 범위
- **viewer-ai.js**, **viewer.html**(캐시버스터 `writeafterui1`)만. 서버/Functions/Rules/DB write 0.

## 텍스트 1단계(문장 정돈) 처리
- 모달 카드 **제거**(신규 노출 0). 클릭 핸들러 s1 분기 제거 → `_startTextS1V140` UI 진입점 사라짐.
- 보존: 서버 `callTextAiBatch`, 기존 `aiVariants/text/{sid}/s1` 데이터, 내부 함수(`_startTextS1V140`/`_isS1Finalized` 등)·QUOTA `s1:3` 상수. **삭제 0**(dead-code 정리는 후속 Phase).

## 글 보기 토글 처리
- `_normalizeTextAiViewMode(mode)` 추가: 저장된 view mode가 `aiS1`이어도 **원본으로 정규화**. `_getAiViewMode`가 이를 거쳐 반환 → 어디서도 s1 보기 미노출.
- `_showAiToggleBar`: s1 버튼 제거. **글 보기 = [원본 | AI 장면발전(s2)]**. s2 후보 없으면 바 미표시(s1만 있는 구작품도 바 숨김 → 본문 원본 표시).
- 라벨 "보기 모드:" → "글 보기:".
- 도달불가가 된 `mode === 'aiS1'` fallback 분기(`_getDisplayBody`/`_getDisplayStyle`)는 안전하게 원본 반환(무해·유지).

## 작품 마무리 모달 구조
- 제목 "🤖 AI 작품 다듬기" → **"📔 작품 마무리"**. 보조 설명: "질문과 검사로 고칠 곳을 찾고, 내가 직접 고친 뒤, 마지막에 AI 도움을 받아 작품을 완성해요."
- 카드 순서: **① 작품 검사 → ② 직접 고치기(안내) → ③ AI 장면발전 → ④ AI 그림책 마감(그림책)**.
- 작품 검사 desc: "이야기 흐름, 선택지 연결, 인물과 엔딩을 확인해요. AI가 대신 고치지 않고 고칠 곳을 알려줘요."
- AI 장면발전(구 '텍스트 2단계') desc: "내가 고친 글을 바탕으로 장면을 더 풍부하게 해요. 사건·선택지·엔딩은 그대로 두고 표현만 발전시킨 후보를 만들어요."
- 직접 고치기 = **안내 카드**(div·`data-ai-mode` 없음 → 클릭 핸들러 제외·실행 기능 없음). 복귀 스택 등 실기능은 Phase 5.
- 핸들러 셀렉터 `.ai-mode-card[data-ai-mode]:not(.--disabled)`로 한정(안내 카드 안전 제외).
- imageS2 카드: 게이트/문구/패널 무변경(그림책+edit+aiSettings.imageS2).

## legacy s1 호환
- s1 결과(DB/localStorage)가 있어도: 모달 카드 미노출 · 토글 s1 버튼 없음 · view mode 정규화로 원본 표시 · 렌더 무파괴.

## 학생/교사 노출
- 권한 정책 **무변경**. 작품검사/장면발전 = 기존 정책(학생 호출 가능). imageS2 = 교사(picturebook+edit)만.

## 테스트
- node 테스트 28파일 PASS(0 fail, image-s2-ui 포함). node --check viewer-ai.js OK. precommit 통과(cache version OK). secret grep 0. tracked diff = viewer-ai.js+viewer.html만.

## 브라우저 smoke (로컬 정적서버·OpenAI 0)
- viewer.html HTTP 200 · 콘솔 에러 = favicon.ico 404 1건(기존·무해)뿐.
- 서버가 신 viewer-ai.js 서빙(`_normalizeTextAiViewMode` 포함) + viewer.html `writeafterui1` 반영.
- 편집 번들(`ensureEditBundle`) 로드 OK → viewer-ai.js IIFE 런타임 오류 0.
- ⚠️ **NOT_VERIFIED(시각)**: 모달 카드 순서·s1 미노출·토글 [원본|AI장면발전] 실렌더는 closure-private + 지연로드 + 실작품/교사세션 필요로 라이브 시각 미확인. 코드+테스트로 검증. 실세션 시각확인 권장(다음 루프 또는 사용자).

## 남은 Phase 3 작업
- 맞춤형 점검 질문(생각나침반 인프라 재사용 + 신규 prompt/schema/callable). 이후 P4 검사 재정의·P5 직접수정 복귀흐름·P6 장면발전 최종화·P7 textSelections.

**판정: `WRITE_AFTER_UI_REBUILD_1_COMPLETE`** (Critical/High 0·실 AI 0·deploy 0·DB write 0·main merge 0). 라이브 모달 시각확인만 후속.
