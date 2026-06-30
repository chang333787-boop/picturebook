/* ════════════════════════════════════════════════════════════════
   IMAGE-S2 평가 전용 — OpenAI gpt-image-2 이미지 편집 adapter (실 결선)
   ──────────────────────────────────────────────────────────────
   ⚠️ 평가 전용. production callable adapter와 섞지 않는다.
   공식: POST /v1/images/edits (multipart) · model=gpt-image-2 · image(png)+prompt+size+quality
        · 응답 b64_json(base64 PNG). gpt-image-2 input_fidelity=자동 high.
   안전: secret/headers/raw response 저장·로깅 금지. 출력은 호출부가 gitignored output에만.
   순수 헬퍼(buildEditRequest/classifyOpenAiResult)는 fetch 없이 단위 테스트 가능.
   fetch/FormData/Blob 는 주입(기본 global) → 테스트는 fake fetch로 네트워크 0.
   ════════════════════════════════════════════════════════════════ */

const CODES = {
  SECRET_MISSING: 'EVAL_SECRET_MISSING',
  TIMEOUT: 'IMAGE_AI_TIMEOUT',
  PROVIDER_ERROR: 'IMAGE_AI_PROVIDER_ERROR',
  UNSAFE_OUTPUT: 'IMAGE_AI_UNSAFE_OUTPUT',   /* safety refusal */
  INVALID_OUTPUT: 'IMAGE_AI_INVALID_OUTPUT',
  BAD_INPUT: 'EVAL_BAD_INPUT',
};

const ENDPOINT = 'https://api.openai.com/v1/images/edits';
const DEFAULT_MODEL = 'gpt-image-2';
const DEFAULT_SIZE = '1536x1024';   /* 가로 3:2 */
const DEFAULT_QUALITY = 'medium';
const DEFAULT_TIMEOUT_MS = 180000;   /* gpt-image-2 medium은 실제(디테일 많은) 그림에서 60s 넘는 경우 잦음 → 3분 */
const DEFAULT_MAX_BYTES = 12 * 1024 * 1024;

/* MIME from magic bytes. */
function sniffMime(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/* 요청 필드 계획(순수). */
function buildEditRequest(opts) {
  const o = opts || {};
  return {
    endpoint: ENDPOINT,
    method: 'POST',
    fields: {
      model: o.model || DEFAULT_MODEL,
      prompt: String(o.prompt || ''),
      size: o.size || DEFAULT_SIZE,
      quality: o.quality || DEFAULT_QUALITY,
      n: 1,
    },
    imageField: 'image',
  };
}

/* refusal/content-policy 판별(순수). */
function isSafetyRefusal(json) {
  const e = json && json.error;
  if (!e) return false;
  const s = [e.code, e.type, e.message].filter(Boolean).join(' ').toLowerCase();
  return s.indexOf('content_policy') !== -1 || s.indexOf('moderation') !== -1
    || s.indexOf('safety') !== -1 || s.indexOf('content policy') !== -1 || s.indexOf('rejected') !== -1;
}

/* 응답 분류(순수) — 모든 분기 테스트 가능. */
function classifyOpenAiResult(r) {
  const o = r || {};
  const status = o.status;
  const contentType = String(o.contentType || '').toLowerCase();
  const maxBytes = Number.isFinite(o.maxBytes) ? o.maxBytes : DEFAULT_MAX_BYTES;

  if (contentType.indexOf('text/html') !== -1) return { ok: false, code: CODES.INVALID_OUTPUT, reason: 'HTML 응답(이미지 아님)' };
  if (status >= 400 || !o.json) {
    if (isSafetyRefusal(o.json)) return { ok: false, code: CODES.UNSAFE_OUTPUT, refusal: true, reason: 'safety/content-policy refusal' };
    const ecode = o.json && o.json.error && (o.json.error.code || o.json.error.type) || ('HTTP_' + status);
    if (status === 408 || status === 504) return { ok: false, code: CODES.TIMEOUT, reason: ecode };
    return { ok: false, code: CODES.PROVIDER_ERROR, reason: ecode };
  }
  const b64 = o.json && o.json.data && o.json.data[0] && o.json.data[0].b64_json;
  if (!b64 || typeof b64 !== 'string') return { ok: false, code: CODES.INVALID_OUTPUT, reason: 'b64_json 없음' };
  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch (e) { return { ok: false, code: CODES.INVALID_OUTPUT, reason: 'base64 디코드 실패' }; }
  if (!buf || buf.length === 0) return { ok: false, code: CODES.INVALID_OUTPUT, reason: '빈 출력' };
  if (buf.length > maxBytes) return { ok: false, code: CODES.INVALID_OUTPUT, reason: '크기 초과' };
  const mime = sniffMime(buf);
  if (!mime) return { ok: false, code: CODES.INVALID_OUTPUT, reason: 'MIME 미인식(이미지 아님)' };
  return { ok: true, imageBytes: buf, mimeType: mime, usage: (o.json && o.json.usage) || null };
}

/* usage → 추정 비용(USD). gpt-image-2 출력 $30/1M·입력 img $8/1M·txt $5/1M. usage 없으면 후보 추정값 사용. */
function estimateCostFromUsage(usage, fallbackPerImage) {
  if (usage && Number.isFinite(usage.output_tokens)) {
    const inImg = Number.isFinite(usage.input_tokens_details && usage.input_tokens_details.image_tokens) ? usage.input_tokens_details.image_tokens : 0;
    const inTxt = Number.isFinite(usage.input_tokens_details && usage.input_tokens_details.text_tokens) ? usage.input_tokens_details.text_tokens : (usage.input_tokens || 0);
    const cost = (usage.output_tokens * 30 + inImg * 8 + inTxt * 5) / 1e6;
    return Math.round(cost * 1e6) / 1e6;
  }
  return Number.isFinite(fallbackPerImage) ? fallbackPerImage : null;
}

/* 실 호출 — fetch/FormData/Blob 주입. secret 없으면 호출 0. */
async function callOpenAiImageEdit(opts) {
  const o = opts || {};
  if (!o.apiKey) return { ok: false, provider: 'openai', code: CODES.SECRET_MISSING };
  if (!Buffer.isBuffer(o.imagePng) || o.imagePng.length === 0) return { ok: false, provider: 'openai', code: CODES.BAD_INPUT, reason: 'imagePng 버퍼 없음' };
  if (!o.prompt) return { ok: false, provider: 'openai', code: CODES.BAD_INPUT, reason: 'prompt 없음' };

  const fetchImpl = o.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  const FormDataImpl = o.FormDataImpl || (typeof FormData !== 'undefined' ? FormData : null);
  const BlobImpl = o.BlobImpl || (typeof Blob !== 'undefined' ? Blob : null);
  if (!fetchImpl || !FormDataImpl || !BlobImpl) return { ok: false, provider: 'openai', code: CODES.PROVIDER_ERROR, reason: 'fetch/FormData/Blob 미가용(Node 20+ 필요)' };

  const req = buildEditRequest(o);
  const inputMime = o.inputMime || 'image/png';   /* 원본이 jpeg/webp면 정확히 전달 */
  const ext = inputMime === 'image/jpeg' ? 'jpg' : (inputMime === 'image/webp' ? 'webp' : 'png');
  const form = new FormDataImpl();
  for (const k of Object.keys(req.fields)) form.append(k, String(req.fields[k]));
  form.append(req.imageField, new BlobImpl([o.imagePng], { type: inputMime }), 'input.' + ext);

  const timeoutMs = Number.isFinite(o.timeoutMs) ? o.timeoutMs : DEFAULT_TIMEOUT_MS;
  const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const started = (o.nowFn || Date.now)();
  let res, status, contentType, json = null;
  try {
    res = await fetchImpl(req.endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + o.apiKey },   /* 헤더는 저장/로깅하지 않음 */
      body: form,
      signal: controller ? controller.signal : undefined,
    });
    status = res.status;
    contentType = (res.headers && (res.headers.get ? res.headers.get('content-type') : res.headers['content-type'])) || '';
    if (contentType.toLowerCase().indexOf('text/html') === -1) {
      try { json = await res.json(); } catch (e) { json = null; }
    }
  } catch (e) {
    if (timer) clearTimeout(timer);
    const msg = String(e && (e.name || e.message) || '').toLowerCase();
    const code = (msg.indexOf('abort') !== -1 || msg.indexOf('timeout') !== -1) ? CODES.TIMEOUT : CODES.PROVIDER_ERROR;
    return { ok: false, provider: 'openai', model: req.fields.model, code, latencyMs: (o.nowFn || Date.now)() - started };
  }
  if (timer) clearTimeout(timer);

  const cls = classifyOpenAiResult({ status, contentType, json, maxBytes: o.maxBytes });
  const latencyMs = (o.nowFn || Date.now)() - started;
  if (!cls.ok) return { ok: false, provider: 'openai', model: req.fields.model, code: cls.code, refusal: !!cls.refusal, reason: cls.reason, latencyMs };
  return {
    ok: true, provider: 'openai', model: req.fields.model,
    imageBytes: cls.imageBytes, mimeType: cls.mimeType,
    dimensions: req.fields.size, latencyMs,
    usage: cls.usage, estCost: estimateCostFromUsage(cls.usage, o.fallbackPerImageUsd),
  };
}

module.exports = {
  CODES, ENDPOINT, DEFAULT_MODEL, DEFAULT_SIZE, DEFAULT_QUALITY,
  sniffMime, buildEditRequest, isSafetyRefusal, classifyOpenAiResult, estimateCostFromUsage, callOpenAiImageEdit,
};
