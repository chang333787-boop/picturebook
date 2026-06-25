/* ════════════════════════════════════════════════════════════════
   IMAGE-S2-9 production OpenAI adapter — 초안(DRAFT, 미배포·미활성)
   ──────────────────────────────────────────────────────────────
   ⚠️ 이 파일은 설계 초안이다. functions/ 에 들어가지 않으며 콜러블 기본 provider를
      교체하지 않는다(image-s2-adapter._selectImageS2Adapter 는 계속 not-configured).
   S2-9 승인 후, 이 형태를 functions/image-s2-adapter.js 에 옮겨
   { configured, model, modelVersion, generate(req) } 계약(=image-s2-generation 의 deps.adapter)에 맞춘다.
   생성 로직은 평가에서 검증된 openai-eval-adapter.callOpenAiImageEdit 를 재사용.
   ════════════════════════════════════════════════════════════════ */
const openai = require('./openai-eval-adapter');

/* createOpenAiImageAdapter — provider-neutral production adapter 초안.
   opts: {
     apiKey,            // ★ Functions secret(defineSecret('IMAGE_OPENAI_API_KEY')).value() — 클라 미노출
     model,             // 'gpt-image-2'(config; deprecated 하드코딩 금지)
     promptVersion,     // 고정 프롬프트 버전
     fetchSourceImage,  // async (scene)=>{bytes,mimeType} — ★서버가 RTDB 정본 경로로만 다운로드(SSRF: 우리 bucket만, 외부 URL 금지). EXIF 제거.
     size, quality, timeoutMs, fallbackPerImageUsd,
   } */
function createOpenAiImageAdapter(opts) {
  const o = opts || {};
  const configured = !!o.apiKey;
  const model = o.model || 'gpt-image-2';
  return {
    configured,
    model,
    modelVersion: o.modelVersion || '',
    async generate(req) {
      if (!configured) return { ok: false, code: 'IMAGE_AI_NOT_CONFIGURED' };
      /* 1) 원본 다운로드는 서버가 정본 경로로만(SSRF 방지). req.originalSrc 는 RTDB scene 값. */
      let input;
      try {
        input = await o.fetchSourceImage(req);   // {bytes(Buffer png/jpeg), mimeType}
      } catch (e) {
        return { ok: false, code: 'IMAGE_AI_PROVIDER_ERROR', reason: 'source fetch 실패' };
      }
      if (!input || !input.bytes) return { ok: false, code: 'IMAGE_AI_INVALID_OUTPUT', reason: 'source 없음' };

      /* 2) 평가에서 검증된 호출 로직 재사용(요청 정규화·timeout·출력 MIME/크기 검증·refusal 구분 포함). */
      const r = await openai.callOpenAiImageEdit({
        apiKey: o.apiKey, model, imagePng: input.bytes,
        prompt: req.promptText || '', size: o.size || '1536x1024', quality: o.quality || 'medium',
        timeoutMs: o.timeoutMs, fallbackPerImageUsd: o.fallbackPerImageUsd,
      });
      if (!r.ok) return { ok: false, code: r.code, refusal: !!r.refusal };
      /* 3) image-s2-generation.runImageS2Generation 가 출력 검증→ai-images 업로드→aiVariants write→quota 처리. */
      return { ok: true, bytes: r.imageBytes, mimeType: r.mimeType, model, modelVersion: o.modelVersion || '', usage: r.usage, estCost: r.estCost };
    },
  };
}

/* ── S2-9 결선 체크리스트(요약) ──
   - functions: defineSecret('IMAGE_OPENAI_API_KEY'); callImageAiS2 옵션에 { secrets:[...] } 추가.
   - _selectImageS2Adapter: env/config 가 'openai' 일 때 createOpenAiImageAdapter(secret.value()) 반환(기본은 여전히 not-configured).
   - fetchSourceImage: admin.storage()로 scene.imageData 의 우리 bucket 객체만 다운로드(외부 URL 거부)·MIME/크기/decode·EXIF 제거.
   - SynthID/워터마크 정책(OpenAI는 워터마크 없음 — Google 선택 시 별도)·비용 kill switch·일일 상한 운영값.
   - Storage Rule ai-images read(클라 표시) 배포 승인.
*/

module.exports = { createOpenAiImageAdapter };
