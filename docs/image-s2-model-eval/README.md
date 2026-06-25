# imageS2 모델 평가 작업폴더

> ⚠️ **이번 단계(BRANCH-IMAGE-S2-PHASE-0)에는 실제 모델 호출·결과 이미지가 없다.** 구조·템플릿만.
> 평가 절차·평가표·탈락 조건은 `../image_s2_model_evaluation_plan.md` 참고.

## 구조
- `inputs/` — 테스트 입력 이미지(**개인정보 0**: 사용자 제공/가상/테스트 그림만). 현재 비어 있음.
- `gemini/` — Gemini 후보 출력(IMAGE-S2-8 평가 시 생성).
- `openai/` — OpenAI 후보 출력(IMAGE-S2-8 평가 시 생성).
- `scores.json` — 점수 기록 템플릿.
- `comparison.md` — 후보 비교/최종 결론 템플릿.

## 금지
- 운영 학생 실데이터 사용 금지.
- 이 단계에서 모델 호출/secret/결과 생성 금지.
