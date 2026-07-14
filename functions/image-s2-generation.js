/* ════════════════════════════════════════════════════════════════
   IMAGE-S2-3/4/5 — 이미지 AI(imageS2) 단일 장면 생성 순수 로직
   ──────────────────────────────────────────────────────────────
   정본: /Users/dobuk/Desktop/가지_AI이미지_PRD_확정.md (§4·§9·§10·§11·§13·§14)
   · firebase 비의존 순수 함수 → node 단독 테스트 가능(image-s2-policy.js와 동일 패턴).
   · 원본 scene.imageData / scene.imageUrl 절대 read-only. AI 결과는 ai-images/ + aiVariants/image 에만.
   · runImageS2Generation 은 모든 부작용(RTDB read/write·Storage 업로드·모델 호출·quota)을
     deps 주입으로 분리 → 콜러블은 thin wrapper, 테스트는 fake deps 로 전체 파이프라인 검증.
   · 모델 미확정(PRD §16) → 실제 provider 연결은 S2-9. 여기서는 adapter 계약까지만.
   ════════════════════════════════════════════════════════════════ */

/* ── 상수 (PRD §6·§11) ───────────────────────────────────────── */
const PROMPT_VERSION = 'imgS2-p7-setting1';   /* P7 SETTING(본문=해석 힌트+무대/장소 힌트·조명 노을기본 폐기·텍스트leak 가드). 실제 프롬프트는 adapter buildS2Prompt.
   dedup에 포함되므로 버전 상향 = 이미 변환된 장면도 "다시 변환 요청 시" 새 규칙으로 재생성(그때 횟수 소모).
   기존 완료작을 보기만 하는 건 무영향. (전례: P3→P4·P6→P7 상향과 동일 정책) */
const FIT_POLICY = 'fit-imagecenter-landscape';
/* 그림중심형 가로 프레임. 실측 px 는 PRD §16 미결 → 제안 기본값(3:2). 모델 확정 후 확정. */
const TARGET_FRAME = { w: 1536, h: 1024, aspect: '3:2' };
const AI_IMAGE_PREFIX = 'ai-images/';         /* AI 결과 전용 — 원본 images/ 와 완전 분리 */
const ORIGINAL_IMAGE_PREFIX = 'images/';      /* 원본 — AI 코드가 절대 write/delete 하지 않음 */
/* IMAGE-S2-DIET-1(2026-07-06): 어댑터가 output_format=webp를 요청하므로 webp 허용 추가.
   png도 잔존 허용 — 모델/파라미터 fallback으로 png가 와도 기존 흐름 그대로 저장. */
const ALLOWED_OUTPUT_MIME = ['image/png', 'image/webp'];
const MAX_OUTPUT_BYTES = 12 * 1024 * 1024;    /* 결과 크기 상한(안전) */
const CLEANUP_GRACE_MS = 7 * 24 * 60 * 60 * 1000;  /* 재변환 교체 시 이전 객체 7일 유예(PRD §11) */

/* 소프트 결과 코드(throw 아님 — quota 보존). 콜러블은 throw 게이트와 분리해 이 객체를 그대로 반환. */
const GEN_CODES = {
  TEACHER_ONLY: 'TEACHER_ONLY',
  SCENE_NOT_FOUND: 'SCENE_NOT_FOUND',
  IMAGE_SOURCE_MISSING: 'IMAGE_SOURCE_MISSING',
  IMAGE_POLICY_REQUIRED: 'IMAGE_POLICY_REQUIRED',
  CORRUPT_IMAGE_POLICY: 'CORRUPT_IMAGE_POLICY',
  INVALID_REQUEST_FIELDS: 'INVALID_REQUEST_FIELDS',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  NOT_CONFIGURED: 'IMAGE_AI_NOT_CONFIGURED',
  INVALID_OUTPUT: 'IMAGE_AI_INVALID_OUTPUT',
  UPLOAD_FAILED: 'IMAGE_AI_UPLOAD_FAILED',
  INTERNAL_PATH: 'IMAGE_AI_INTERNAL_PATH',
  WRITE_FAILED: 'IMAGE_AI_WRITE_FAILED',
};

/* 클라가 절대 직접 보내면 안 되는 필드(SSRF·임의 경로·프롬프트 주입 방지, PRD §13).
   존재 시 즉시 거부 — 정상 클라는 sceneId 등 allowlist 만 보낸다. */
const INJECTION_FIELDS = [
  'url', 'downloadURL', 'storagePath', 'outputPath', 'storage', 'path',
  'imageData', 'imageUrl', 'imageBase64', 'base64', 'bytes',
  'prompt', 'promptOverride', 'systemPrompt', 'model', 'modelVersion', 'sourceMode',
];

/* Firebase 키/경로 세그먼트 안전화 — functions/index.js _sanitizeFbKeySegment 와 동일 규칙.
   비거나 . # $ [ ] / 또는 제어문자 포함 → null(거부). */
function sanitizeSeg(v) {
  const s = String(v == null ? '' : v);
  if (!s) return null;
  if (/[.#$\[\]\/]/.test(s)) return null;
  if (/[\x00-\x1F\x7F]/.test(s)) return null;
  return s;
}

/* 안정 해시(djb2) — functions/index.js _bodyHash 와 바이트 동일.
   원본(base64/URL)은 노출하지 않고 해시만 사용. */
function _bodyHash(str) {
  const s = String(str == null ? '' : str);
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/* basedOnImageHash — sourceMode|sceneId|원본 기반(stale 비교·dedup 키).
   functions/index.js _computeImageBasedHash 와 동일 산식(인자 순서 포함). */
function computeImageBasedHash(sourceStr, sceneId, sourceMode) {
  return _bodyHash(String(sourceMode) + '|' + String(sceneId) + '|' + String(sourceStr == null ? '' : sourceStr));
}

/* ── 요청 정규화 (PRD §13 — client는 sceneId만, 임의 URL/경로/프롬프트 금지) ── */
function normalizeGenerationRequest(raw) {
  const data = (raw && typeof raw === 'object') ? raw : {};
  for (const k of INJECTION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, k) && data[k] != null && data[k] !== '') {
      return { ok: false, code: GEN_CODES.INVALID_REQUEST_FIELDS, message: '요청 형식이 올바르지 않아요.' };
    }
  }
  const classId = sanitizeSeg(data.classId);
  const sceneId = sanitizeSeg(data.sceneId);
  const teamName = (typeof data.teamName === 'string' && data.teamName) ? data.teamName : null;
  if (!classId || !teamName || !sceneId) {
    return { ok: false, code: GEN_CODES.INVALID_ARGUMENT, message: 'classId / teamName / sceneId가 올바르지 않아요.' };
  }
  return { ok: true, value: { classId, teamName, sceneId, forceRegenerate: data.forceRegenerate === true } };
}

/* policy 분류 — image-s2-policy.classifyPolicy 와 동일 의미.
   null/sourceMode 없음 → required, 비정상 → corrupt, upload|draw → valid. */
function _classifyPolicy(policy) {
  if (policy == null) return { kind: 'required' };
  if (typeof policy !== 'object') return { kind: 'corrupt' };
  const sm = policy.sourceMode;
  if (sm === 'upload' || sm === 'draw') return { kind: 'valid', sourceMode: sm };
  if (sm == null) return { kind: 'required' };
  return { kind: 'corrupt' };
}

/* ── 생성 사전 게이트 (순수) — scene/policy/권한으로 진행 가능 여부 결정 ── */
function decideGenerationGate(opts) {
  const o = opts || {};
  const sceneId = sanitizeSeg(o.sceneId);
  if (!sceneId) return { action: 'reject', code: GEN_CODES.INVALID_ARGUMENT };
  /* 생성(quota 소모) = 교사만 (PRD §8). 학생은 토글 미리보기만(비-quota). */
  if (o.isTeacher !== true) return { action: 'reject', code: GEN_CODES.TEACHER_ONLY };

  const scene = o.scene;
  if (!scene || typeof scene !== 'object') return { action: 'reject', code: GEN_CODES.SCENE_NOT_FOUND, sceneId };

  const originalSrc = scene.imageData || scene.imageUrl || null;
  if (!originalSrc) return { action: 'reject', code: GEN_CODES.IMAGE_SOURCE_MISSING, sceneId };

  const pc = _classifyPolicy(o.policy);
  if (pc.kind === 'corrupt') return { action: 'reject', code: GEN_CODES.CORRUPT_IMAGE_POLICY, sceneId };
  if (pc.kind !== 'valid') {
    /* IMAGE-S2-LEGACY: imagePolicy(sourceMode 잠금) 도입 이전 옛 그림책 — policy 없음(required).
       그림(originalSrc)이 실제 저장돼 있고 교사가 명시 실행하면 허용한다.
       sourceMode는 클라가 보내지 않고 서버가 'upload'로 보정(inferred): 기존 hash/stale/variant/클라
       normalize allowlist(upload|draw) 와 충돌 없음. 최신 작품(valid policy)은 아래 분기로 그대로 유지. */
    return { action: 'proceed', sceneId, sourceMode: 'upload', originalSrc, sourceModeInferred: true, legacyImagePolicy: true };
  }

  return { action: 'proceed', sceneId, sourceMode: pc.sourceMode, originalSrc };
}

/* ── dedup (PRD §10 — 동일 원본 hash → 재사용, 차감 0) ──
   ★ promptVersion 포함: 원본 그림이 같아도 프롬프트 버전(P3→P4 등)이 다르면 재사용하지 않고 재생성한다.
     (기존 P3 결과가 P4 품질을 막던 문제 수정.) currentPromptVersion 미전달(테스트) 시 검사 생략(하위호환). */
function decideDedup(existingVariant, fingerprint, forceRegenerate, currentPromptVersion) {
  if (forceRegenerate === true) return { action: 'generate' };
  const v = existingVariant;
  if (v && typeof v === 'object' && v.url && v.stale !== true && v.basedOnImageHash === fingerprint
      && (!currentPromptVersion || v.promptVersion === currentPromptVersion)) {
    return { action: 'reuse' };
  }
  return { action: 'generate' };
}

/* ── Storage 경로(PRD §11) — ai-images/{cid}/{enc}/scene_{sid}_s2_{uniqueId}.{ext} ──
   uniqueId(crypto.randomUUID 등) 주입 → 재변환이 이전 결과를 덮어쓰지 않음(overwrite 0).
   IMAGE-S2-DIET-1: 확장자는 결과 mimeType 따라(webp/jpg/png). mimeType 생략 시 기존 .png 유지
   (기존 호출·테스트 하위호환 — DB는 완성 URL을 저장하므로 클라 영향 0). */
function buildS2StoragePath(classId, enc, sceneId, uniqueId, mimeType) {
  const cid = sanitizeSeg(classId);
  const e = sanitizeSeg(enc);
  const sid = sanitizeSeg(sceneId);
  const uid = sanitizeSeg(uniqueId);
  if (!cid || !e || !sid || !uid) return null;
  const ext = (mimeType === 'image/webp') ? 'webp' : (mimeType === 'image/jpeg') ? 'jpg' : 'png';
  return `${AI_IMAGE_PREFIX}${cid}/${e}/scene_${sid}_s2_${uid}.${ext}`;
}

/* AI 결과 경로 가드 — ai-images/ 하위 + '..' 없음. 원본 삭제 가드(images/ 한정)와 상호 배타. */
function isAllowedS2StoragePath(path) {
  const p = String(path == null ? '' : path);
  if (p.indexOf('..') !== -1) return false;
  return p.indexOf(AI_IMAGE_PREFIX) === 0;
}
/* 원본 경로 식별 — AI 코드가 이 경로를 write/delete 인자로 받으면 안 됨(방어). */
function isOriginalImageStoragePath(path) {
  return String(path == null ? '' : path).indexOf(ORIGINAL_IMAGE_PREFIX) === 0;
}

/* ── aiVariants/image/{sceneId}/s2 객체 빌더 (PRD §11 스키마) ── */
function buildS2Variant(opts) {
  const o = opts || {};
  if (!o.url || !o.storagePath || !o.basedOnImageHash || !o.sourceMode) return null;
  const v = {
    url: String(o.url),
    storagePath: String(o.storagePath),
    sourceMode: o.sourceMode,
    basedOnImageHash: String(o.basedOnImageHash),
    model: String(o.model || ''),
    modelVersion: String(o.modelVersion || ''),
    promptVersion: String(o.promptVersion || PROMPT_VERSION),
    targetFrame: o.targetFrame || TARGET_FRAME,
    fitPolicy: FIT_POLICY,
    finalizedAt: Number.isFinite(o.finalizedAt) ? o.finalizedAt : 0,
    stale: false,
  };
  /* IMAGE-S2-LEGACY: imagePolicy 없는 옛 작품을 보정 처리했음을 기록(감사·표시용·schema 비충돌). */
  if (o.sourceModeInferred === true) v.sourceModeInferred = true;
  if (o.legacyImagePolicy === true) v.legacyImagePolicy = true;
  return v;
}

/* ── stale 판정 (PRD §9) — 원본 hash 또는 sourceMode 불일치면 stale ──
   실제 자동 stale 표시는 원본 저장 성공 지점에서 수행(향후 S2-7 결선). 여기선 순수 비교. */
function decideStale(variant, currentFingerprint, currentSourceMode, currentPromptVersion) {
  if (!variant || typeof variant !== 'object') return true;
  if (variant.basedOnImageHash !== currentFingerprint) return true;
  if (currentSourceMode && variant.sourceMode !== currentSourceMode) return true;
  /* ★ 프롬프트 버전 불일치(P3→P4 등) → stale(다시 생성 권장). currentPromptVersion 미전달 시 생략. */
  if (currentPromptVersion && variant.promptVersion !== currentPromptVersion) return true;
  return false;
}

/* ── 모델 출력 검증 (PRD §13 — MIME/크기) ── */
function validateModelOutput(output, limits) {
  const lim = limits || {};
  const allowedMime = lim.allowedMime || ALLOWED_OUTPUT_MIME;
  const maxBytes = Number.isFinite(lim.maxBytes) ? lim.maxBytes : MAX_OUTPUT_BYTES;
  if (!output || typeof output !== 'object') return { ok: false, code: GEN_CODES.INVALID_OUTPUT };
  const size = _byteLength(output.bytes);
  if (size <= 0) return { ok: false, code: GEN_CODES.INVALID_OUTPUT };
  if (size > maxBytes) return { ok: false, code: GEN_CODES.INVALID_OUTPUT };
  if (allowedMime.indexOf(output.mimeType) === -1) return { ok: false, code: GEN_CODES.INVALID_OUTPUT };
  return { ok: true };
}
function _byteLength(bytes) {
  if (bytes == null) return 0;
  if (typeof bytes === 'number') return bytes;                 /* 테스트용 크기 표현 */
  if (typeof bytes === 'string') return bytes.length;
  if (typeof bytes.length === 'number') return bytes.length;   /* Buffer/Uint8Array */
  if (typeof bytes.byteLength === 'number') return bytes.byteLength;
  return 0;
}

/* ── 재변환 안전 교체용 cleanup-queue 레코드 (PRD §11 검토 G 5단계) ── */
function buildCleanupQueueRecord(storagePath, now, graceMs) {
  const g = Number.isFinite(graceMs) ? graceMs : CLEANUP_GRACE_MS;
  const t = Number.isFinite(now) ? now : 0;
  return { storagePath: String(storagePath || ''), recordedAt: t, deleteAfter: t + g };
}

/* ════════════════════════════════════════════════════════════════
   runImageS2Generation — 단일 장면 생성 오케스트레이션(부작용 주입).
   input: { classId, enc, sceneId, forceRegenerate, isTeacher }
   deps: {
     readScene(sceneId)->scene|null, readPolicy()->policy|null,
     readExistingVariant(sceneId)->variant|null,
     adapter:{ configured:bool, model, modelVersion, generate(req)->{ok,bytes,mimeType,model?,modelVersion?}|{ok:false,code} },
     uploadResult({storagePath,bytes,mimeType})->{url}, verifyDownloadable?(url)->bool,
     writeVariant(sceneId,variant)->void, recordCleanup?(record)->void,
     consumeQuota()->void, refundQuota()->void, now()->number, uniqueId()->string, logSafe?(obj)->void,
   }
   반환(소프트): { ok, status, code?, sceneId, variant?, reused?, quotaConsumed? }
   ──────────────────────────────────────────────────────────────
   순서(PRD §11 검토 G): 게이트→dedup→(미설정 차단)→quota 예약→모델→출력검증→고유 업로드→
   다운로드 확인→aiVariants 원자 교체→이전 객체 cleanup-queue 기록→성공. 실패는 전부 환불.
   ════════════════════════════════════════════════════════════════ */
async function runImageS2Generation(input, deps) {
  const i = input || {};
  const d = deps || {};
  const sceneId = sanitizeSeg(i.sceneId);
  const log = (typeof d.logSafe === 'function') ? d.logSafe : function () {};

  if (!sceneId) return { ok: false, status: 'rejected', code: GEN_CODES.INVALID_ARGUMENT };

  /* 1) 원본 scene / policy read (읽기만) */
  let scene = null;
  let policy = null;
  try { scene = await d.readScene(sceneId); } catch (e) { scene = null; }
  try { policy = await d.readPolicy(); } catch (e) { policy = null; }

  /* 2) 사전 게이트 */
  const gate = decideGenerationGate({ sceneId, isTeacher: i.isTeacher, scene, policy });
  if (gate.action !== 'proceed') {
    return { ok: false, status: 'rejected', code: gate.code, sceneId };
  }

  /* 3) 지문(stale/dedup 키) */
  const fingerprint = computeImageBasedHash(gate.originalSrc, sceneId, gate.sourceMode);

  /* 4) dedup — 동일 원본 결과 존재 시 재사용(차감 0) */
  let existing = null;
  try { existing = await d.readExistingVariant(sceneId); } catch (e) { existing = null; }
  if (decideDedup(existing, fingerprint, i.forceRegenerate, PROMPT_VERSION).action === 'reuse') {
    log({ stage: 'cached', sceneId });
    return { ok: true, status: 'cached', reused: true, sceneId, variant: existing, quotaConsumed: 0 };
  }

  /* 5) 모델 미설정(provider 미확정) → 생성 불가, 차감 0(예약 전 차단). prod 안전. */
  const adapter = d.adapter || {};
  if (adapter.configured !== true) {
    return { ok: false, status: 'failed', code: GEN_CODES.NOT_CONFIGURED, sceneId };
  }

  /* 6) quota 예약(성공=1). 실패 시 전부 환불(정책 #3/#4/#5).
     예약 자체가 throw(RTDB 부분 실패)하면 soft 반환 — 절대 throw로 새지 않게(계약 보장).
     이때 부분 증가분은 best-effort 보상 환불. refundAnd 는 consumed 일 때만 환불(이중 차감 방지). */
  let consumed = false;
  try {
    await d.consumeQuota();
    consumed = true;
  } catch (e) {
    try { await d.refundQuota(); } catch (e2) { /* best-effort 보상 */ }
    return { ok: false, status: 'failed', code: 'IMAGE_AI_QUOTA_WRITE_FAILED', sceneId };
  }
  const refundAnd = async (res) => {
    if (consumed) { try { await d.refundQuota(); } catch (e) { /* best-effort */ } }
    return res;
  };

  /* 7) 모델 호출(stub/fake 또는 실 provider) */
  let gen;
  try {
    gen = await adapter.generate({
      originalSrc: gate.originalSrc, sourceMode: gate.sourceMode,
      promptVersion: PROMPT_VERSION, targetFrame: TARGET_FRAME, sceneId,
      /* IMG-HINT-2(2026-07-11): 장면 본문 = 해석 힌트(어댑터가 맥락 프레임에 가둬 동봉).
         본문 없으면 어댑터가 기존 프롬프트를 byte 동일 사용 — dedup/캐시 키는 불변(그림 기준). */
      storyText: (scene && typeof scene.body === 'string') ? scene.body : '',
    });
  } catch (e) {
    return refundAnd({ ok: false, status: 'failed', code: 'IMAGE_AI_PROVIDER_ERROR', sceneId });
  }
  if (!gen || gen.ok !== true) {
    return refundAnd({ ok: false, status: 'failed', code: (gen && gen.code) || 'IMAGE_AI_PROVIDER_ERROR', sceneId });
  }

  /* 8) 출력 검증(MIME/크기) */
  const outv = validateModelOutput({ bytes: gen.bytes, mimeType: gen.mimeType });
  if (!outv.ok) return refundAnd({ ok: false, status: 'failed', code: outv.code, sceneId });

  /* 9) 고유 결과 경로(덮어쓰기 0) + 가드 */
  const storagePath = buildS2StoragePath(i.classId, i.enc, sceneId, d.uniqueId(), gen.mimeType);
  if (!storagePath || !isAllowedS2StoragePath(storagePath) || isOriginalImageStoragePath(storagePath)) {
    return refundAnd({ ok: false, status: 'failed', code: GEN_CODES.INTERNAL_PATH, sceneId });
  }

  /* 10) Storage 업로드(Admin SDK) */
  let up;
  try {
    up = await d.uploadResult({ storagePath, bytes: gen.bytes, mimeType: gen.mimeType });
  } catch (e) {
    return refundAnd({ ok: false, status: 'failed', code: GEN_CODES.UPLOAD_FAILED, sceneId });
  }
  if (!up || !up.url) return refundAnd({ ok: false, status: 'failed', code: GEN_CODES.UPLOAD_FAILED, sceneId });

  /* 11) 다운로드 가능 확인(교체 전) */
  if (typeof d.verifyDownloadable === 'function') {
    let okDl = false;
    try { okDl = await d.verifyDownloadable(up.url); } catch (e) { okDl = false; }
    if (!okDl) return refundAnd({ ok: false, status: 'failed', code: GEN_CODES.UPLOAD_FAILED, sceneId });
  }

  /* 12) aiVariants/image/{sceneId}/s2 원자 교체(Admin SDK) */
  const variant = buildS2Variant({
    url: up.url, storagePath, sourceMode: gate.sourceMode, basedOnImageHash: fingerprint,
    model: gen.model || adapter.model, modelVersion: gen.modelVersion || adapter.modelVersion,
    promptVersion: PROMPT_VERSION, targetFrame: TARGET_FRAME, finalizedAt: d.now(),
    sourceModeInferred: gate.sourceModeInferred === true, legacyImagePolicy: gate.legacyImagePolicy === true,
  });
  if (!variant) return refundAnd({ ok: false, status: 'failed', code: GEN_CODES.WRITE_FAILED, sceneId });
  try {
    await d.writeVariant(sceneId, variant);
  } catch (e) {
    return refundAnd({ ok: false, status: 'failed', code: GEN_CODES.WRITE_FAILED, sceneId });
  }

  /* 13) 이전 결과 객체 cleanup-queue 기록(best-effort, 7일 유예) — 실패해도 본 결과엔 영향 없음 */
  if (existing && existing.storagePath && existing.storagePath !== storagePath && typeof d.recordCleanup === 'function') {
    try { await d.recordCleanup(buildCleanupQueueRecord(existing.storagePath, d.now(), CLEANUP_GRACE_MS)); } catch (e) { /* ignore */ }
  }

  log({ stage: 'succeeded', sceneId, sourceMode: gate.sourceMode, legacyImagePolicy: gate.legacyImagePolicy === true });
  return { ok: true, status: 'succeeded', sceneId, variant, quotaConsumed: 1, legacyImagePolicy: gate.legacyImagePolicy === true };
}

module.exports = {
  /* 상수 */
  PROMPT_VERSION, FIT_POLICY, TARGET_FRAME, AI_IMAGE_PREFIX, ORIGINAL_IMAGE_PREFIX,
  ALLOWED_OUTPUT_MIME, MAX_OUTPUT_BYTES, CLEANUP_GRACE_MS, GEN_CODES, INJECTION_FIELDS,
  /* 순수 헬퍼 */
  sanitizeSeg, computeImageBasedHash, normalizeGenerationRequest, decideGenerationGate,
  decideDedup, buildS2StoragePath, isAllowedS2StoragePath, isOriginalImageStoragePath,
  buildS2Variant, decideStale, validateModelOutput, buildCleanupQueueRecord,
  /* 오케스트레이션 */
  runImageS2Generation,
};
