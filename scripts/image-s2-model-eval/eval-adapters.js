/* ════════════════════════════════════════════════════════════════
   IMAGE-S2-8 평가용 provider adapter 골격 (production callable과 분리)
   ──────────────────────────────────────────────────────────────
   ⚠️ 이번 단계: 실제 외부 호출·secret 등록·SDK 의존 추가 금지.
   · dryRun(input): 외부 호출 0. 호출 계획만 반환.
   · execute(input): 승인 게이트(secret + SDK 설치) 통과 시에만 실제 호출.
     - secret 없음 → { ok:false, code:'EVAL_SECRET_MISSING' }
     - 공식 SDK 미설치 → { ok:false, code:'EVAL_SDK_NOT_INSTALLED', hint }
     - 실제 호출 본문은 S2-9(승인 후)에 채운다 → 현재는 EVAL_NOT_WIRED.
   공통 반환(provider 중립): { ok, provider, model, imageBytes, mimeType, latencyMs, usage, estimatedCost, safety, code? }
   ════════════════════════════════════════════════════════════════ */

const EVAL_CODES = {
  SECRET_MISSING: 'EVAL_SECRET_MISSING',
  SDK_NOT_INSTALLED: 'EVAL_SDK_NOT_INSTALLED',
  NOT_WIRED: 'EVAL_NOT_WIRED',
  BAD_CANDIDATE: 'EVAL_BAD_CANDIDATE',
};

/* SDK 존재 확인 — require 실패해도 throw 하지 않음(의존성 추가 0 유지). */
function sdkInstalled(pkg) {
  try { require.resolve(pkg); return true; } catch (e) { return false; }
}

function createEvalAdapter(candidate, opts) {
  const o = opts || {};
  const env = o.env || process.env;
  if (!candidate || !candidate.provider || !candidate.modelId) {
    return { ok: false, code: EVAL_CODES.BAD_CANDIDATE };
  }
  const secretEnv = candidate.secretEnv;
  const sdkPkg = candidate.sdkPackage;

  return {
    provider: candidate.provider,
    model: candidate.modelId,
    secretEnv,
    sdkPackage: sdkPkg,
    secretPresent() { return !!(secretEnv && env[secretEnv]); },
    sdkPresent() { return sdkInstalled(sdkPkg); },

    /* 외부 호출 0 — 계획만. */
    dryRun(input) {
      const i = input || {};
      return {
        dryRun: true, externalCall: false,
        provider: candidate.provider, model: candidate.modelId,
        endpoint: candidate.endpoint,
        sampleId: i.sampleId || null, sampleSha256: i.sampleSha256 || null,
        promptLevel: i.promptLevel || null, promptVersion: i.promptVersion || null,
        targetSize: candidate.targetSize, outputFormats: candidate.outputFormats,
        estCostUsd: candidate.pricing && candidate.pricing.estPerImageUsd,
        secretPresent: this.secretPresent(), sdkPresent: this.sdkPresent(),
        watermark: !!candidate.watermark,
      };
    },

    /* 실제 호출 — 승인 게이트. 본 루프에서는 호출되지 않는다(runner가 dry-run만 허용). */
    async execute(input) {
      if (!this.secretPresent()) {
        return { ok: false, provider: candidate.provider, model: candidate.modelId, code: EVAL_CODES.SECRET_MISSING };
      }
      if (!this.sdkPresent()) {
        return {
          ok: false, provider: candidate.provider, model: candidate.modelId, code: EVAL_CODES.SDK_NOT_INSTALLED,
          hint: `평가 전용 SDK 설치 필요: npm i -D ${sdkPkg} (production functions 번들에는 추가하지 말 것)`,
        };
      }
      /* ── S2-9(승인 후)에 채울 실제 호출 본문 ──
         OpenAI: const OpenAI = require('openai'); const c = new OpenAI({ apiKey: env[secretEnv] });
                 const r = await c.images.edit({ model: candidate.modelId, image: <png buffer>, prompt: <prompt-pack text>, size: '1536x1024', quality: 'medium' });
                 imageBytes = Buffer.from(r.data[0].b64_json, 'base64'); mimeType='image/png';
         Google: const { GoogleGenAI } = require('@google/genai'); const ai = new GoogleGenAI({ apiKey: env[secretEnv] });
                 const r = await ai.models.generateContent({ model: candidate.modelId,
                   contents: [{ parts: [{ inlineData: { mimeType:'image/png', data:<b64> } }, { text:<prompt> }] }],
                   config: { responseModalities:['IMAGE'], imageConfig:{ aspectRatio:'3:2' } } });
                 // inlineData(image/png) 추출 → imageBytes. ⚠️ SynthID 워터마크 포함.
         공통: latency 측정, usage/estimatedCost 채움, MIME/크기 검증(image-s2-generation.validateModelOutput 재사용 가능),
               결과는 gitignored output-dir 로만 저장(운영 Storage 금지). */
      return { ok: false, provider: candidate.provider, model: candidate.modelId, code: EVAL_CODES.NOT_WIRED,
        hint: '실제 호출 본문은 S2-9(유료 벤치마크 승인) 후 결선. 현재는 미연결.' };
    },
  };
}

module.exports = { EVAL_CODES, sdkInstalled, createEvalAdapter };
