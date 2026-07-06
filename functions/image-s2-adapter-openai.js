/* ════════════════════════════════════════════════════════════════
   IMAGE-S2-9 — production OpenAI(gpt-image-2) 이미지 변환 adapter
   ──────────────────────────────────────────────────────────────
   · functions/ 내부(배포 대상). 평가용 scripts/ adapter와 분리.
   · image-s2-generation.runImageS2Generation 의 deps.adapter 계약에 맞춤:
       { configured, model, modelVersion, async generate(req) }
       generate(req:{originalSrc,sourceMode,promptVersion,targetFrame,sceneId})
         → { ok:true, bytes, mimeType, model, modelVersion, usage, estCost }
           | { ok:false, code }
   · secret(OPENAI_API_KEY)는 콜러블에서 defineSecret(...).value()로 주입.
     secret 없으면 configured:false → IMAGE_AI_NOT_CONFIGURED.
   · fetch/FormData/Blob 는 Node20 global. 테스트는 fetchImpl/downloadImpl 주입(네트워크 0).
   · secret/헤더/raw 응답 로깅·저장 금지. 원본 fetch는 우리 Storage 호스트만(SSRF 방지).
   ════════════════════════════════════════════════════════════════ */

const DEFAULT_MODEL = 'gpt-image-2';
const PROMPT_VERSION = 'imgS2-openai-gpt-image-2-P4-v1';
const ENDPOINT = 'https://api.openai.com/v1/images/edits';
const SIZE = '1536x1024';            /* 가로 3:2 */
const QUALITY = 'medium';
/* IMAGE-S2-DIET-1(2026-07-06): output_format 미지정 시 무압축급 PNG(실측 3.4MB/장 — 학생 원본
   478KB의 7배)가 와서 감상 데이터가 과중했다. webp+압축 80 → 수백 KB급, 재인코딩 의존성 0.
   설계: docs/image_s2_diet_design_20260706.md A안. output_compression은 webp/jpeg에서만 유효. */
const OUTPUT_FORMAT = 'webp';
const OUTPUT_COMPRESSION = '80';
const DEFAULT_TIMEOUT_MS = 180000;   /* 실 그림은 60s 자주 초과 → 3분 */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const ALLOWED_OUTPUT_MIME = ['image/png', 'image/jpeg', 'image/webp'];
/* 원본 다운로드 허용 호스트(SSRF) — Firebase Storage 만 */
const ALLOWED_SOURCE_HOSTS = ['firebasestorage.googleapis.com', 'storage.googleapis.com'];

/* P4(완성형 그림책 마감) 정본 프롬프트 — 보존 가드(수·위치·구도·말풍선·손글씨·재설계금지)는 유지하되
   배경·빛·색·질감·공간 밀도를 꽉 채워 "정돈"이 아니라 "완성된 그림책 한 장"으로 마감. (P3=보존 강해 약했음) */
const OPENAI_S2_PROMPT = [
  'Turn the provided child-drawn picture into a warm, fully finished picture-book illustration of the SAME scene — clearly the same drawing, but completed and richly painted like a published storybook page.',
  'Keep exactly the same characters, animals, and objects that are already in the picture: the same count, the same positions, the same poses, and the same relationships and overall composition. Do not add, remove, merge, split, or move any of them.',
  'Keep each character, animal, and object recognizable as the same one the child drew — same identity, expression, pose, and overall design. You may refine and clean the rendering, but do not redesign faces, hands, or bodies into different-looking characters.',
  'If any handwritten Korean text or speech bubble is present, preserve it exactly as a drawn mark in the same place; do not blur, rewrite, translate, clean up, or regenerate it.',
  'Finish the scene fully: fill every empty or blank-white area and the whole background with a complete, fitting environment (sky, ground, grass, trees, path, sunlight). Leave no unfinished white paper. Add rich but natural color, soft storybook lighting, gentle depth and distance, atmosphere, and hand-painted texture so it reads as a complete, polished picture-book page rather than a tidied sketch.',
  'Render it with a warm hand-made look that blends watercolor and colored pencil, with cozy, harmonious colors; keep the child-made imagination and hand-feel.',
  'Do not make it photorealistic, 3D, or a glossy commercial / anime style, and do not imitate any specific artist or studio. Keep the same events, subjects, meaning, time of day, and weather.',
  'Produce a horizontal landscape image with a 3:2 ratio (about 1536x1024), with the original drawing fitted and centered, never cropped or shifted.',
].join('\n');

const CODES = {
  NOT_CONFIGURED: 'IMAGE_AI_NOT_CONFIGURED',
  TIMEOUT: 'IMAGE_AI_TIMEOUT',
  PROVIDER_ERROR: 'IMAGE_AI_PROVIDER_ERROR',
  UNSAFE_OUTPUT: 'IMAGE_AI_UNSAFE_OUTPUT',
  INVALID_OUTPUT: 'IMAGE_AI_INVALID_OUTPUT',
  SOURCE_FETCH_FAILED: 'IMAGE_AI_SOURCE_FETCH_FAILED',
  SOURCE_NOT_ALLOWED: 'IMAGE_AI_SOURCE_NOT_ALLOWED',
};

function sniffMime(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/* 원본 src 가 우리 Storage 호스트의 URL 인지(SSRF). data: 는 별도 처리. */
function isAllowedSourceUrl(src) {
  const s = String(src == null ? '' : src);
  if (s.indexOf('data:') === 0) return true;
  let host = '';
  try { host = new URL(s).host.toLowerCase(); } catch (e) { return false; }
  return ALLOWED_SOURCE_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

function isSafetyRefusal(json) {
  const e = json && json.error;
  if (!e) return false;
  const s = [e.code, e.type, e.message].filter(Boolean).join(' ').toLowerCase();
  return s.indexOf('content_policy') !== -1 || s.indexOf('moderation') !== -1 || s.indexOf('safety') !== -1 || s.indexOf('content policy') !== -1 || s.indexOf('rejected') !== -1;
}

/* 응답 분류(순수) */
function classifyResult(r) {
  const o = r || {};
  const ct = String(o.contentType || '').toLowerCase();
  const maxBytes = Number.isFinite(o.maxBytes) ? o.maxBytes : MAX_OUTPUT_BYTES;
  if (ct.indexOf('text/html') !== -1) return { ok: false, code: CODES.INVALID_OUTPUT };
  if (o.status >= 400 || !o.json) {
    if (isSafetyRefusal(o.json)) return { ok: false, code: CODES.UNSAFE_OUTPUT, refusal: true };
    if (o.status === 408 || o.status === 504) return { ok: false, code: CODES.TIMEOUT };
    return { ok: false, code: CODES.PROVIDER_ERROR };
  }
  const b64 = o.json && o.json.data && o.json.data[0] && o.json.data[0].b64_json;
  if (!b64 || typeof b64 !== 'string') return { ok: false, code: CODES.INVALID_OUTPUT };
  let buf; try { buf = Buffer.from(b64, 'base64'); } catch (e) { return { ok: false, code: CODES.INVALID_OUTPUT }; }
  if (!buf || buf.length === 0 || buf.length > maxBytes) return { ok: false, code: CODES.INVALID_OUTPUT };
  const mime = sniffMime(buf);
  if (ALLOWED_OUTPUT_MIME.indexOf(mime) === -1) return { ok: false, code: CODES.INVALID_OUTPUT };
  return { ok: true, bytes: buf, mimeType: mime, usage: (o.json && o.json.usage) || null };
}

function estimateCost(usage) {
  if (usage && Number.isFinite(usage.output_tokens)) {
    const inImg = (usage.input_tokens_details && usage.input_tokens_details.image_tokens) || 0;
    const inTxt = (usage.input_tokens_details && usage.input_tokens_details.text_tokens) || usage.input_tokens || 0;
    return Math.round((usage.output_tokens * 30 + inImg * 8 + inTxt * 5) / 1e6 * 1e6) / 1e6;
  }
  return null;
}

/* 원본 bytes 확보 — data: 디코드 또는 허용 호스트 fetch. */
async function defaultDownload(src, fetchImpl) {
  const s = String(src || '');
  if (s.indexOf('data:') === 0) {
    const m = s.match(/^data:([^;]+);base64,(.*)$/);
    if (!m) throw new Error('bad data uri');
    return { bytes: Buffer.from(m[2], 'base64'), mime: m[1] };
  }
  const res = await fetchImpl(s);
  if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
  const buf = Buffer.from(await res.arrayBuffer());
  return { bytes: buf, mime: sniffMime(buf) };
}

/* ── production adapter 팩토리 ── */
function createOpenAiImageS2Adapter(opts) {
  const o = opts || {};
  const apiKey = o.apiKey;
  const model = o.model || DEFAULT_MODEL;
  const timeoutMs = Number.isFinite(o.timeoutMs) ? o.timeoutMs : DEFAULT_TIMEOUT_MS;
  const fetchImpl = o.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  const FormDataImpl = o.FormDataImpl || (typeof FormData !== 'undefined' ? FormData : null);
  const BlobImpl = o.BlobImpl || (typeof Blob !== 'undefined' ? Blob : null);
  const downloadImpl = o.downloadImpl || ((src) => defaultDownload(src, fetchImpl));

  return {
    configured: !!apiKey,
    model,
    modelVersion: o.modelVersion || '',
    promptVersion: PROMPT_VERSION,
    async generate(req) {
      if (!apiKey) return { ok: false, code: CODES.NOT_CONFIGURED };
      if (!fetchImpl || !FormDataImpl || !BlobImpl) return { ok: false, code: CODES.PROVIDER_ERROR };
      const src = req && req.originalSrc;
      if (!src || !isAllowedSourceUrl(src)) return { ok: false, code: CODES.SOURCE_NOT_ALLOWED };

      /* 1) 원본 다운로드(우리 Storage만) + MIME/크기 검증 */
      let input;
      try { input = await downloadImpl(src); } catch (e) { return { ok: false, code: CODES.SOURCE_FETCH_FAILED }; }
      const inMime = input && (input.mime || sniffMime(input.bytes));
      if (!input || !input.bytes || !inMime || ALLOWED_OUTPUT_MIME.indexOf(inMime) === -1) return { ok: false, code: CODES.SOURCE_FETCH_FAILED };
      if (input.bytes.length > MAX_SOURCE_BYTES) return { ok: false, code: CODES.SOURCE_FETCH_FAILED };

      /* 2) /v1/images/edits 호출(고정 P3 프롬프트) */
      const ext = inMime === 'image/jpeg' ? 'jpg' : (inMime === 'image/webp' ? 'webp' : 'png');
      const form = new FormDataImpl();
      form.append('model', model);
      form.append('prompt', OPENAI_S2_PROMPT);
      form.append('size', SIZE);
      form.append('quality', QUALITY);
      /* IMAGE-S2-DIET-1 — 생성 시점 압축(무압축 PNG 3.4MB → webp ~수백 KB) */
      form.append('output_format', OUTPUT_FORMAT);
      form.append('output_compression', OUTPUT_COMPRESSION);
      form.append('n', '1');
      form.append('image', new BlobImpl([input.bytes], { type: inMime }), 'input.' + ext);

      const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      let status, contentType, json = null;
      try {
        const res = await fetchImpl(ENDPOINT, { method: 'POST', headers: { Authorization: 'Bearer ' + apiKey }, body: form, signal: controller ? controller.signal : undefined });
        status = res.status;
        contentType = (res.headers && (res.headers.get ? res.headers.get('content-type') : res.headers['content-type'])) || '';
        if (contentType.toLowerCase().indexOf('text/html') === -1) { try { json = await res.json(); } catch (e) { json = null; } }
      } catch (e) {
        if (timer) clearTimeout(timer);
        const msg = String(e && (e.name || e.message) || '').toLowerCase();
        return { ok: false, code: (msg.indexOf('abort') !== -1 || msg.indexOf('timeout') !== -1) ? CODES.TIMEOUT : CODES.PROVIDER_ERROR };
      }
      if (timer) clearTimeout(timer);

      const cls = classifyResult({ status, contentType, json, maxBytes: MAX_OUTPUT_BYTES });
      if (!cls.ok) return { ok: false, code: cls.code, refusal: !!cls.refusal };
      return { ok: true, bytes: cls.bytes, mimeType: cls.mimeType, model, modelVersion: o.modelVersion || '', usage: cls.usage, estCost: estimateCost(cls.usage) };
    },
  };
}

module.exports = {
  DEFAULT_MODEL, PROMPT_VERSION, OPENAI_S2_PROMPT, CODES, ALLOWED_SOURCE_HOSTS,
  sniffMime, isAllowedSourceUrl, isSafetyRefusal, classifyResult, estimateCost, createOpenAiImageS2Adapter,
};
