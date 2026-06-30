/* ════════════════════════════════════════════════════════════════
   IMAGE-S2-8 모델 평가 러너 — 순수 라이브러리(비용 안전장치·dry-run·검증)
   ──────────────────────────────────────────────────────────────
   · firebase/네트워크/외부 SDK 비의존 → node 단독 테스트 가능.
   · 실제 호출/비용 발생 로직은 여기 없음. 게이트·계획·검증만.
   ════════════════════════════════════════════════════════════════ */

const STATUS_VALUES = ['ga', 'stable', 'preview', 'experimental', 'deprecated'];
const PLACEHOLDER_RE = /TODO|미정|평가 ?시|확인 후|placeholder|xxxx/i;

/* 후보 config 검증 — modelId 빈 값/placeholder 거부, status 분류, 이미지 편집 지원, 비용 필수. */
function validateCandidate(c) {
  const errors = [];
  if (!c || typeof c !== 'object') return { ok: false, errors: ['candidate가 객체가 아님'] };
  if (!c.provider) errors.push('provider 누락');
  const mid = String(c.modelId == null ? '' : c.modelId).trim();
  if (!mid) errors.push('modelId가 비어 있음');
  else if (PLACEHOLDER_RE.test(mid)) errors.push(`modelId가 placeholder: "${mid}"`);
  const status = String(c.status || '').toLowerCase();
  if (STATUS_VALUES.indexOf(status) === -1) errors.push(`status 분류 불가: "${c.status}"`);
  if (status === 'deprecated') errors.push('deprecated 모델은 후보 불가');
  if (c.supportsImageEdit !== true) errors.push('supportsImageEdit !== true (이미지 편집 미지원)');
  if (!c.pricing || !Number.isFinite(c.pricing.estPerImageUsd)) errors.push('pricing.estPerImageUsd(USD/장) 누락');
  if (!c.officialUrl) errors.push('officialUrl(공식 문서 출처) 누락');
  if (!c.asOf) errors.push('asOf(조사 날짜) 누락');
  return { ok: errors.length === 0, errors };
}
function isPreview(c) { const s = String(c && c.status || '').toLowerCase(); return s === 'preview' || s === 'experimental'; }
function isProduction(c) { const s = String(c && c.status || '').toLowerCase(); return s === 'ga' || s === 'stable'; }

/* 출력 경로 traversal 차단 — 절대경로이고 baseDir 하위여야 허용. */
function isSafeOutputPath(baseDir, target) {
  const b = String(baseDir == null ? '' : baseDir);
  const t = String(target == null ? '' : target);
  if (!b || !t) return false;
  if (t.indexOf('..') !== -1) return false;
  if (/[\x00]/.test(t)) return false;
  const base = b.charAt(b.length - 1) === '/' ? b : b + '/';
  return t.indexOf(base) === 0;
}

/* 예상 호출 수 = models × samples × promptLevels. */
function computePlannedCalls(opts) {
  const o = opts || {};
  const m = Math.max(0, o.modelCount || 0);
  const s = Math.max(0, o.sampleCount || 0);
  const l = Math.max(0, o.levelCount || 0);
  return m * s * l;
}

/* 예상 최대 비용(USD) = Σ_candidate (estPerImageUsd × samples × levels). */
function estimateMaxCostUsd(candidates, opts) {
  const o = opts || {};
  const s = Math.max(0, o.sampleCount || 0);
  const l = Math.max(0, o.levelCount || 0);
  let total = 0;
  for (const c of (candidates || [])) {
    const est = (c && c.pricing && Number.isFinite(c.pricing.estPerImageUsd)) ? c.pricing.estPerImageUsd : 0;
    total += est * s * l;
  }
  return Math.round(total * 1e6) / 1e6;
}

/* 실제 실행 게이트 — --execute 시 secret·max-cost·예산·비-production 모두 충족해야 허용. */
function decideExecuteGate(opts) {
  const o = opts || {};
  if (!o.execute) return { allowed: false, dryRun: true, reasons: ['--execute 미지정 → dry-run'] };
  const reasons = [];
  if (!o.secretPresent) reasons.push('provider secret(API 키) 없음');
  if (!Number.isFinite(o.maxCostUsd)) reasons.push('--max-cost 미지정');
  if (Number.isFinite(o.maxCostUsd) && Number.isFinite(o.estMaxCostUsd) && o.estMaxCostUsd > o.maxCostUsd) {
    reasons.push(`예상 최대 비용 $${o.estMaxCostUsd} > 한도 $${o.maxCostUsd}`);
  }
  if (o.production) reasons.push('production Functions 환경에서는 평가 실행 금지(로컬 script만)');
  return { allowed: reasons.length === 0, dryRun: false, reasons };
}

/* 비용 누적 가드 — 다음 호출이 한도를 넘기면 중단(canAfford=false). */
function makeCostGuard(maxCostUsd) {
  let spent = 0;
  const cap = Number.isFinite(maxCostUsd) ? maxCostUsd : null;
  return {
    spent: () => spent,
    canAfford: (next) => cap == null ? true : (spent + (next || 0) <= cap + 1e-9),
    add: (amt) => { spent += (amt || 0); return spent; },
    remaining: () => cap == null ? Infinity : Math.max(0, cap - spent),
  };
}

/* dry-run 계획 — 외부 호출 0. 입력은 hash만, 결과 저장 위치만 표기. */
function buildDryRunPlan(opts) {
  const o = opts || {};
  const candidates = o.candidates || [];
  const samples = o.samples || [];
  const levels = o.levels || [];
  return {
    dryRun: true,
    externalCall: false,
    models: candidates.map(c => ({ provider: c.provider, modelId: c.modelId, status: c.status, estPerImageUsd: c.pricing && c.pricing.estPerImageUsd })),
    sampleHashes: samples.map(s => ({ id: s.id, sha256: s.sha256 || null })),
    promptVersion: o.promptVersion || null,
    levels: levels,
    plannedCalls: computePlannedCalls({ modelCount: candidates.length, sampleCount: samples.length, levelCount: levels.length }),
    estMaxCostUsd: estimateMaxCostUsd(candidates, { sampleCount: samples.length, levelCount: levels.length }),
    outputDir: o.outputDir || null,
  };
}

/* 결과 manifest 한 행 — 원본 이미지는 복사하지 않고 sha256/상대참조만 기록. */
function buildResultRecord(o) {
  const r = o || {};
  return {
    provider: r.provider, modelId: r.modelId, modelStatus: r.modelStatus || null,
    sampleId: r.sampleId, sampleSha256: r.sampleSha256 || null,
    promptLevel: r.promptLevel, promptVersion: r.promptVersion || null,
    startedAt: r.startedAt || null, endedAt: r.endedAt || null,
    latencyMs: Number.isFinite(r.latencyMs) ? r.latencyMs : null,
    ok: !!r.ok, errorCode: r.errorCode || null,
    outputMime: r.outputMime || null, outputBytes: Number.isFinite(r.outputBytes) ? r.outputBytes : null,
    estCostUsd: Number.isFinite(r.estCostUsd) ? r.estCostUsd : null,
    currency: r.currency || 'USD', fxAsOf: r.fxAsOf || null,
    outputRef: r.outputRef || null,
    notes: r.notes || '',
  };
}

/* 합성 샘플만 외부 전송 허용 — student/unknown/비합성 차단(§6). */
function isSyntheticSampleAllowed(sample) {
  if (!sample || typeof sample !== 'object') return false;
  if (sample.synthetic !== true) return false;
  if (sample.source === 'student' || sample.source === 'production' || sample.source === 'unknown') return false;
  if (!/^[A-J]_/.test(String(sample.id || ''))) return false;   /* 합성 팩 명명 규칙 */
  return true;
}

/* 간단 CLI 인자 파서 — "--key value" / "--flag". */
function parseArgs(argv) {
  const out = { _: [] };
  const a = argv || [];
  for (let i = 0; i < a.length; i++) {
    const tok = a[i];
    if (typeof tok === 'string' && tok.indexOf('--') === 0) {
      const key = tok.slice(2);
      const next = a[i + 1];
      if (next === undefined || (typeof next === 'string' && next.indexOf('--') === 0)) { out[key] = true; }
      else { out[key] = next; i++; }
    } else { out._.push(tok); }
  }
  return out;
}

module.exports = {
  STATUS_VALUES, validateCandidate, isPreview, isProduction, isSafeOutputPath,
  computePlannedCalls, estimateMaxCostUsd, decideExecuteGate, makeCostGuard,
  buildDryRunPlan, buildResultRecord, parseArgs, isSyntheticSampleAllowed,
};
