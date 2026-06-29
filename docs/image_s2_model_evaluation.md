# 가지 imageS2 — AI 이미지 모델 평가 (IMAGE-S2-8)

> 조사일 **2026-06-25**. 공식 문서(developers.openai.com / openai.com / ai.google.dev / cloud.google.com)만 정본.
> 모델 ID·가격·상태는 변동된다 — **이 문서의 값에는 조사일이 붙어 있고**, 코드(`scripts/image-s2-model-eval/candidates.js`)는 `modelId` env override를 허용한다.
> 이 단계 산출물 = 후보 재확정 + 평가 하니스 + 비용표. **실제 유료 호출·secret·deploy 없음.**

---

## 1. 평가 목적
일반적 "예쁜 그림 생성"이 아니라 **학생이 직접 그린 그림의 보존형 발전**을 평가한다.
- 학생 그림의 의미·개성·구도·인물 수 보존, 완전 대체 금지, 지시한 부분만 발전.
- 가로 3:2 그림책 프레임, 초등 작품다움 유지, 과도한 사실화/상업화·환각 추가 억제.
- 이미지 안 한글/말풍선 임의 생성·왜곡 금지, 교육적으로 안전.

## 2. 최신 공식 후보 목록 (2026-06-25)
| # | provider | 모델 ID | 코드네임 | 상태 | 역할 |
|---|---|---|---|---|---|
| 1 | OpenAI | `gpt-image-2` | — | **GA** (snapshot 2026-04-21) | production |
| 2 | Google | `gemini-2.5-flash-image` | Nano Banana | **GA** (2025-10-02~) | production(워크호스) |
| 3 | Google | `gemini-3-pro-image` | Nano Banana Pro | **GA**(Developer API, 2026-05-28) · Vertex GA 미확인 | high-fidelity(참조 보존 최강) |

**대안 1순위:** `gemini-3.1-flash-image`(Nano Banana 2, GA, ref 10+4, ~$0.067/img) — ≤3 제한으로 보류.

## 2-1. Production shortlist 구분 (벤치마크 후보 ≠ production 적격)
- **OpenAI `gpt-image-2` = production 적격**(1차). 약관상 현 제품 구조에 적합.
- **Google 두 모델(`gemini-2.5-flash-image`·`gemini-3-pro-image`) = production shortlist 제외.** 이유: **Gemini Developer API 추가약관이 under-18 대상/접근 가능 서비스 사용을 금지** → 초등 대상인 가지의 현 제품 구조와 부적합. **Vertex AI**는 별도 계약·연령·국외이전·리전 검토 전까지 **보류**. ⚠️ **모델 품질이 이유가 아님**(품질 비교 벤치마크 후보로는 유효). — "현 약관상 현재 제품 구조와 부적합"으로만 기록(법적 최종 판단 아님).
- 이 단계 실제 파일럿 = **OpenAI gpt-image-2 단독**.

## 3. stable / preview 구분 · 제외 후보
- 위 3종은 전부 **비-preview GA**.
- ⚠️ **타이밍 경고:** Gemini `-preview` 별칭(`gemini-3-pro-image-preview`, `gemini-3.1-flash-image-preview`)은 **2026-06-25(오늘) 종료** → 반드시 비-preview GA id 사용.
- **제외(EXCLUDED):**
  - OpenAI `gpt-image-1` / `gpt-image-1.5` / `gpt-image-1-mini` — **전부 DEPRECATED**(공식 모델 페이지). gpt-image-2로 대체.
  - Google `imagen-4.0-*` — **DEPRECATED**(종료 2026-08-17) + text-to-image 전용(편집 아님).

## 4. 공식 model ID (편집 = 이미지 입력→이미지 출력)
- OpenAI: `gpt-image-2` — `v1/images/edits` (이미지+프롬프트 → 편집 이미지). org verification 필요할 수 있음.
- Google: `gemini-2.5-flash-image`, `gemini-3-pro-image` — `generateContent`(responseModalities=[IMAGE], imageConfig.aspectRatio). SDK `@google/genai`.

## 5. 기능 비교
| 항목 | gpt-image-2 | gemini-2.5-flash-image | gemini-3-pro-image |
|---|---|---|---|
| 이미지 편집 | ✅ v1/images/edits | ✅ generateContent | ✅ (ref 6 object+5 char) |
| 참조 보존 | 강(high-fidelity input) | 구도/조명/원근 보존(워크호스) | **최강**(다중 ref 일관성) |
| 3:2 가로 | ✅ 1536×1024 (장:단 ≤3:1) | ✅ aspect 3:2 | ✅ 3:2 |
| 출력 형식 | png/jpeg/webp | png/jpeg | png/jpeg |
| 워터마크 | 없음 | **SynthID(전 출력)** | **SynthID(전 출력)** |
| 안전 필터 | content-policy(moderation auto/low) | 표준 Gemini | 표준 Gemini |
| SDK | `openai` | `@google/genai` | `@google/genai` |

> ⚠️ **SynthID 워터마크**: Google 두 모델은 모든 출력에 워터마크가 박힌다. 학생 그림책 결과물에 워터마크가 보이는지/허용 가능한지 **시각 검수 항목**.

## 6. 가격 비교 (USD, 2026-06-25 공식)
| 모델 | 과금 | 1장 추정(가로 medium) | 출처 |
|---|---|---|---|
| `gpt-image-2` | 토큰(출력 $30/1M, 입력 img $8/1M, txt $5/1M) | **~$0.05**(파생: 직전세대 1536×1024 medium $0.05 → $30/1M 보정 ~$0.047. 공식은 calculator 권장) | developers.openai.com/api/docs/pricing |
| `gemini-2.5-flash-image` | 입력 $0.30/1M · 출력 **$0.039/이미지**(1024px std) | **~$0.04**(3:2는 약간 상회·공식 미itemize) | ai.google.dev/gemini-api/docs/pricing |
| `gemini-3-pro-image` | 입력 $2/1M · 출력 $120/1M | **$0.134**(1K/2K) · 4K $0.24 | ai.google.dev/gemini-api/docs/pricing |
| (참고)`gemini-3.1-flash-image` | 출력 $60/1M | ~$0.067(1K) | 동일 |

- 환율(USD→KRW)은 **실행 시점에 별도 확인**(코드/문서에 고정 환율 하드코딩 금지).
- 편집 단가는 두 provider 모두 별도 line item 없음(생성과 동일 토큰/이미지 단가) — 실제는 벤치마크에서 측정.

## 7. 개인정보 · 운영 비교 (공식 정책, 법적 결론 아님)
| 항목 | OpenAI API | Google Gemini Developer API | Google Vertex AI |
|---|---|---|---|
| 기본 학습 사용 | ❌ off(opt-in시만 공유) | **paid=off / ⚠️free(Unpaid)=학습+사람검토** | ❌ off |
| 로그 보관 | abuse 모니터링 ~30일(ZDR 제거) | 55일(ZDR 제거) | 제한적·ZDR 가능 |
| ZDR | 가능(승인) | 가능(승인) | 가능 |
| 한국 데이터 레지던시 | **opt-in 가능(eligible project)** | ⚠️국외 캐시 가능(미보장) | ✅ 리전/DPA(Seoul 리전은 별도 확인 필요) |
| 미성년 | ⚠️**under-13 처리 전 ZDR 필요(COPPA)** | 🔴**개발자 18+ & under-18 대상/접근 서비스 금지** | 고객/DPA 책임 |

🔴 **핵심 충돌(사용자/법무 결정 필요):** 가지는 **초등학생(대개 under-13)** 작품 플랫폼이다.
- **Google Gemini Developer API 추가약관**은 "서비스가 under-18을 대상으로 하거나 접근 가능하면 안 됨"을 명시 → 정책 충돌 소지. **Vertex AI(엔터프라이즈+DPA) 경로가 대안**(child-data는 고객 책임으로 이전).
- **OpenAI**는 under-13 개인정보 처리 전 **ZDR 필수**(+COPPA safeguards). 한국 레지던시 opt-in 가능.
- 단, 우리 구조는 **교사가 서버에서 생성(PRD §8)**·학생이 직접 API를 부르지 않음. 그래도 학생 그림(개인정보 소지 가능)이 외부 전송됨 → **보호자/학교 안내·약관·국외이전 검토 필요**. (여기선 사실만, 법적 결론 없음.)

## 8. 평가 샘플 팩
- `scripts/image-s2-model-eval/samples/` — **합성 SVG 10종(A~J)**: 단순 캐릭터1 / 2~3명 관계 / 배경장면 / 연필 / 저학년풍 / 소품복잡 / 한글말풍선 / 어두운 / 배경중심 / 여백많음.
- **개인정보 0**(운영 학생 데이터 미사용). `harnessOnly=true`, `insufficientForFinalQualityDecision=true`.
- ⚠️ 실제 품질 결정에는 **사용자 제공 비식별 학생 그림 또는 라이선스 free 에셋**이 필요. API 제출 전 **SVG→PNG(1600px) 래스터화** 필요(승인 항목).

## 9. 프롬프트 팩
- `prompt-pack.js` — 공통 의도 + 3강도. **모두 긍정형**(금지어 부정문 회피).
  - P1 매우 약한 정돈 · P2 균형 · **P3 표현 강화 = 기본값 확정(2026-06-29)**. 실 학생그림(JL26A/0000 1~20) P2↔P3 비교 후 P3 선택 — 보존(인물·구도·한글·낙서) 유지하면서 크레용 채움·분위기가 더 풍부, 사실화로 안 튐.
- 금지(가드): 완전 재드로잉 / 사실화 / 디즈니·지브리·픽사·"~스타일로" / 인물 외모·인종·성별 변경 / 새 대사·글자·사건. `findBannedPhrase` 가 override 프롬프트를 검사.

## 10. 점수표
- `score-template.json` — 사람 1~5점(원본·구도·대상수·학생다움·지시반영·환각억제·3:2·한글·전체) + 자동 측정(MIME/크기/비율/latency/실패/비용) + provider축(개인정보운영·API수명·구현복잡도).
- **가중치(합 100):** 원본 20 / 구도·대상 15 / 학생다움 15 / 지시 10 / 환각 10 / 안전 10 / 비용 8 / 속도 5 / 운영 5 / 구현 2.
- 블라인드 A/B/C(모델명 가림) 지원. 탈락 조건 = 캐릭터 수 변경·핵심 사물 추가삭제·위치 대폭변경·의미 변경·한글 왜곡·부적절 생성.

## 11. 실제 API 평가 절차 (승인 후 = S2-9)
1. 샘플 확정(비식별) → SVG/원본을 PNG(1600px)로 래스터화.
2. `npm i -D openai @google/genai`(**평가 전용**, functions 번들 제외) + secret env 설정(Google=paid tier).
3. `eval-adapters.execute` 실 호출 본문 결선(현재 `EVAL_NOT_WIRED`).
4. 파일럿: 모델당 2샘플 × P2 1강도 → 비용·품질 확인 후 확대.
5. 결과는 `output/`(gitignored)에만. 점수표 채움 → 블라인드 해제 → 결론.

## 12. 비용 상한
- 기본 dry-run. `--execute` 는 secret + `--max-cost` + 예상≤한도 + 비-production 모두 충족해야 함.
- 비용 가드: 다음 호출이 한도를 넘기면 **즉시 중단**. 재시도 기본 0(최대 1). 자동 반복 금지.
- 예시 예상 최대 비용(3후보 × 2파일럿샘플 × 3강도 = 18콜): **~$1.34**(gpt-image-2 $0.30 + flash $0.24 + pro $0.80).

## 13. 중단 기준
- 후보가 편집 미지원 / 학생 이미지 정책 충돌(🔴 Google under-18) / 공식 가격 미확인 / 조직 인증 필요 / secret 충돌 / 대규모 의존성 / 실제 학생 그림 부재 / 교육 방향·법무 판단 필요 → **즉시 보고·중단**.

## 14. 최종 선택 기준
- 1순위: **참조 보존(학생 그림 유지)** + 환각 억제 + 한글 보존 + 안전.
- 2순위: 워터마크 허용 여부, 한국 데이터 레지던시/약관, under-18 정책 적합, 비용.
- 후보 직관: 보존 품질=`gemini-3-pro-image` 우세 추정(비용↑·워터마크), 비용/속도=`gemini-2.5-flash-image`/`gpt-image-2`, 정책(한국 레지던시·워터마크 없음)=OpenAI 유리. **실측 전 확정 금지.**

## 15. production 연결 체크리스트 (S2-9)
- [ ] 모델·provider 최종 선택(이 평가 결과 기반)
- [ ] 약관/개인정보(under-13·국외이전·보호자 안내)·데이터 레지던시 결론
- [ ] 이미지 전용 secret 생성·등록(Functions secret, 클라 미노출)
- [ ] `image-s2-adapter.js` 실 provider adapter 추가(provider-neutral 계약 유지)
- [ ] `callImageAiS2` 에 `{ secrets:[<IMAGE_KEY>] }` + 실 adapter 선택 결선
- [ ] 출력 검증(MIME/크기/decode/EXIF) + SynthID 워터마크 처리 방침
- [ ] Storage Rule `ai-images` read(클라 표시) + 배포 승인
- [ ] 비용 kill switch/일일 상한 운영값 확정

---
> 출처: developers.openai.com/api/docs/{models/gpt-image-2, guides/image-generation, pricing} · ai.google.dev/gemini-api/docs/{models/gemini-2.5-flash-image, models/gemini-3-pro-image, image-generation, pricing, terms} · openai.com/enterprise-privacy · cloud.google.com vertex-ai data-governance. (전부 2026-06-25 확인. openai.com/api/pricing·ai.google.dev/pricing 는 fetch 403 → 동등 공식 페이지 사용.)
