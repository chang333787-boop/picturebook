# IMAGE-S2-8 모델 평가 하니스

가지(branch) imageS2 — 학생 그림 **발전(보존형 편집)** 목적의 provider 비교 평가 도구.
**production callable과 완전히 분리**된 로컬 평가 script. 외부 API 호출은 다중 안전장치 뒤에서만.

> ⚠️ 이번 단계까지: **실제 API 호출·secret 등록·SDK 의존 추가·운영 Storage 저장 0.** 기본은 dry-run.
> 모델 ID·가격은 2026-06-25 공식 문서 기준이며 변동된다 → `candidates.js` 의 `modelId` 는 env override 가능.

## 구성
- `candidates.js` — 후보(≤3) + 제외 목록(EXCLUDED). 출처 URL·조사일 기록.
- `prompt-pack.js` — 공통 의도 프롬프트 P1/P2/P3(긍정형) + 금지어 가드.
- `make-samples.js` — 합성 SVG 샘플(A~J) 생성기. **개인정보 0 · 하니스 검증용**(실제 품질 결정엔 부족).
- `sample-manifest.json` — 샘플 매니페스트(sha256). `make-samples.js` 산출.
- `eval-lib.js` — 순수 라이브러리: 후보 검증·비용 추정·실행 게이트·비용 가드·dry-run 계획·경로 가드.
- `eval-adapters.js` — provider별 평가 adapter **골격**(dry-run + secret/SDK 게이트 뒤 stub; 실 호출 본문은 S2-9).
- `run-evaluation.js` — CLI. 기본 dry-run.
- `score-template.json` — 사람 1~5점 + 자동 측정 + 가중치(합 100).
- `output/` — **gitignored**. dry-run 계획/결과 산출물(commit 금지).

## 사용
```bash
# 전체 후보 dry-run (외부 호출 0)
node scripts/image-s2-model-eval/run-evaluation.js

# 후보/샘플/강도 필터
node scripts/image-s2-model-eval/run-evaluation.js --provider openai --sample A_single_character --prompt-level P2

# 샘플 (재)생성
node scripts/image-s2-model-eval/make-samples.js
```

옵션: `--provider --model --sample --prompt-level --dry-run --execute --max-cost --output-dir --pilot false`

## 실제 유료 벤치마크(승인 후 = S2-9)에만 필요한 조건 — 전부 충족해야 호출
1. `--execute` 명시
2. provider secret 환경변수 존재 (`OPENAI_API_KEY` / `GEMINI_API_KEY`) — **Google은 paid tier 필수**(free tier는 학습 사용)
3. `--max-cost <USD>` 명시 + 예상 최대 비용 ≤ 한도
4. 평가 전용 SDK 설치 (`npm i -D openai @google/genai`) — **production functions 번들에는 추가 금지**
5. 비-production 로컬 환경(`K_SERVICE`/`FUNCTION_TARGET` 없음)
6. 실제 학생 그림 샘플은 **비식별 + 명시 제공분만**(운영 Storage에서 가져오지 않음). API 제출 전 SVG→PNG(1600px) 래스터화.

> 위를 모두 통과해도 `eval-adapters.execute` 는 현재 `EVAL_NOT_WIRED`(실 호출 본문 미결선) — S2-9에서 채운다.

## 안전 기본값
- 기본 dry-run · 파일럿 = 모델당 2샘플 · 재시도 0 · 자동 반복 0 · 비용 한도 초과 직전 중단.
- 결과는 `output/`(gitignored)만. 통화=USD, 환율은 실행 시 별도 확인(코드에 고정 환율 금지).
