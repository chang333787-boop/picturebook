# imageS2 — promptVersion 캐시/재생성 정책 (2026-06-30)

> feature `feature/image-s2-first-generation`. P3→P4 프롬프트 개선 후, 기존 P3 결과가 캐시되어 P4가 안 나오던 문제 해결.

## 문제
- dedup/cache/stale 판단이 **원본 그림 hash(`basedOnImageHash`)만** 보고 `promptVersion`을 무시.
- 그래서 원본 그림이 같으면 **이전 프롬프트(P3)로 만든 결과가 계속 재사용**되어 P4 품질이 반영 안 됨.
- 클라 일괄 계획도 P3 결과를 "cached(변환 불필요)"로 세어, 게이트가 "모두 마감됨"으로 시작을 막을 수 있었음.

## 정책 (채택)
**원본 hash가 같아도 `promptVersion`이 현재와 다르면 cached로 보지 않고 재생성 대상으로 한다.**
- 기존 결과는 **삭제하지 않는다**(원본·이전 결과 보존). 다음 일괄 변환 또는 forceRegenerate 시 새 결과로 덮어쓰되 원본 `scene.imageData`는 불변.
- 클라가 promptVersion을 서버로 보내지 않는다 — 서버가 현재 promptVersion을 source of truth로 사용.
- modelVersion은 현재 비어 있어 미사용(향후 모델 버저닝 시 동일 패턴 확장 가능).

## 현재 버전
- generation `functions/image-s2-generation.js` `PROMPT_VERSION = 'imgS2-p4-v1'` ← **변형에 저장되는 태그·캐시 비교 기준**.
- adapter `functions/image-s2-adapter-openai.js` `PROMPT_VERSION = 'imgS2-openai-gpt-image-2-P4-v1'`(실제 프롬프트 문자열 버전·job 메타용).
- 클라 `viewer-image-batch.js` `CURRENT_PROMPT_VERSION = 'imgS2-p4-v1'` ← **generation 버전과 일치시킬 것**(P3→P4 등 변경 시 양쪽 갱신).

## 수정 위치
**서버**
- `decideDedup(existing, fp, force, currentPromptVersion)` — hash 같아도 promptVersion 다르면 `generate`(재사용 X).
- `decideStale(variant, fp, sourceMode, currentPromptVersion)` — promptVersion 불일치 시 `true`.
- `runImageS2Generation` — decideDedup에 `PROMPT_VERSION` 전달.
- `_variantFresh(variant, fp, currentPromptVersion)` + `planImageS2Batch({..., currentPromptVersion})` — 이전 버전 변형은 cached 아님 → target.
- `index.js callStartImageS2Batch` — `planImageS2Batch({..., currentPromptVersion: ImageS2Gen.PROMPT_VERSION})`.
- 하위호환: `currentPromptVersion` 미전달이면 검사 생략(기존 동작).

**클라**
- `isVariantCurrent(v)` = url+!stale+`promptVersion===CURRENT_PROMPT_VERSION`. `_planEstimate`가 이걸로 cached/pending 판정 → 이전 버전은 pending(재생성 대상) → 게이트가 시작 허용.
- `resolveCompareImages().oldVersion` — 결과 비교 패널에 "이전 버전 결과(다시 생성하면 최신 품질)" 표시.

## 동작 결과
- P3 결과가 있는 작품 → 일괄 변환 시 **자동으로 P4 재생성 대상**(target)에 포함. 시작 가능.
- P4 결과가 있는 작품 → cached(중복 변환·비용 0).
- forceRegenerate → 항상 재생성(기존대로).
- 원본 그림·이전 결과 삭제 0. 비용은 재생성한 장면만(장당 ~$0.05).

## 운영 주의
- **배포 필요**: 서버 변경(callImageAiS2 dedup·callStartImageS2Batch planning) → `firebase deploy --only functions:callImageAiS2,functions:callStartImageS2Batch` 후 적용.
- 프롬프트 버전 올릴 때 **3곳 동기화**: generation PROMPT_VERSION, adapter PROMPT_VERSION, 클라 CURRENT_PROMPT_VERSION.
- 이전 P3 결과 Storage 객체는 cleanup-queue(7일 유예) 또는 후속 정리 대상(즉시 삭제 안 함).
