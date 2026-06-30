/* ════════════════════════════════════════════════════════════════
   IMAGE-S2-9 — 작품 전체 일괄 변환 batch 상태 머신 (순수)
   ──────────────────────────────────────────────────────────────
   정본 PRD §7. MVP(implementation_plan): 장당 50~70초 → 단일 callable로 20장 순차는
   Gen2 timeout 위험 → 교사 클라가 장면별 callImageAiS2 를 순차 호출하고,
   서버는 batch 상태(aiJobs/imageS2/{jobId}) 저장/갱신 helper 만 둔다(이 모듈=순수 결정).
   firebase 비의존 → node 단독 테스트.
   ════════════════════════════════════════════════════════════════ */

const PER_IMAGE_USD = 0.05;        /* gpt-image-2 medium landscape 추정 */
const PER_IMAGE_SECONDS = 60;      /* 실측 50~70초 → 60 기준 */

const SCENE_STATUS = { PENDING: 'pending', PROCESSING: 'processing', SUCCEEDED: 'succeeded', FAILED: 'failed', SKIPPED: 'skipped', CACHED: 'cached', STALE: 'stale' };
const JOB_STATUS = { QUEUED: 'queued', RUNNING: 'running', SUCCEEDED: 'succeeded', PARTIALLY_FAILED: 'partially_failed', FAILED: 'failed', CANCELLED: 'cancelled' };

const _TERMINAL = [SCENE_STATUS.SUCCEEDED, SCENE_STATUS.FAILED, SCENE_STATUS.SKIPPED, SCENE_STATUS.CACHED];
const _OK = [SCENE_STATUS.SUCCEEDED, SCENE_STATUS.CACHED, SCENE_STATUS.SKIPPED];

function _hasImage(scene) { return !!(scene && (scene.imageData || scene.imageUrl)); }
function _variantFresh(variant, fingerprint, currentPromptVersion) {
  if (!variant || !variant.url || variant.stale === true) return false;
  if (fingerprint && variant.basedOnImageHash !== fingerprint) return false;
  /* ★ 프롬프트 버전 다르면(P3→P4) cached 아님 → 일괄 변환 target에 포함(재생성). */
  if (currentPromptVersion && variant.promptVersion !== currentPromptVersion) return false;
  return true;
}

/* 일괄 계획 — 이미지 있는 장면만, 최신 결과 있는 장면은 cached(skip). */
function planImageS2Batch(opts) {
  const o = opts || {};
  const scenes = o.scenes || {};
  const variants = o.existingVariants || {};
  const fps = o.fingerprints || {};
  const force = o.forceRegenerate === true;
  const onlySet = Array.isArray(o.sceneIds) && o.sceneIds.length ? new Set(o.sceneIds.map(String)) : null;

  const targets = [], cached = [], skipped = [];
  const ids = Object.keys(scenes).sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
  for (const id of ids) {
    if (onlySet && !onlySet.has(String(id))) continue;
    if (!_hasImage(scenes[id])) { skipped.push({ sceneId: id, reason: 'NO_IMAGE' }); continue; }
    if (!force && _variantFresh(variants[id], fps[id], o.currentPromptVersion)) { cached.push(id); continue; }
    targets.push(id);
  }
  return {
    targets, cached, skipped,
    totalScenes: targets.length, cachedCount: cached.length, skippedCount: skipped.length,
    estCostUsd: Math.round(targets.length * PER_IMAGE_USD * 1e6) / 1e6,
    estSeconds: targets.length * PER_IMAGE_SECONDS,
  };
}

/* job 초기 상태 — targets=pending, cached=cached. */
function initBatchState(opts) {
  const o = opts || {};
  const targets = o.targets || [];
  const cached = o.cached || [];
  const sceneStates = {};
  targets.forEach((id) => { sceneStates[id] = { status: SCENE_STATUS.PENDING, attemptCount: 0, errorCode: null }; });
  cached.forEach((id) => { sceneStates[id] = { status: SCENE_STATUS.CACHED, attemptCount: 0, errorCode: null }; });
  return {
    jobId: o.jobId || null, requestedBy: o.requestedBy || null,
    createdAt: Number.isFinite(o.now) ? o.now : 0,
    model: o.model || null, promptVersion: o.promptVersion || null,
    totalScenes: targets.length + cached.length,
    status: targets.length ? JOB_STATUS.QUEUED : JOB_STATUS.SUCCEEDED,
    sceneStates,
  };
}

/* job 상태 도출 — 장면 상태 집합 기준. */
function computeJobStatus(sceneStates) {
  const vals = Object.keys(sceneStates || {}).map((k) => sceneStates[k]);
  if (!vals.length) return JOB_STATUS.SUCCEEDED;
  const allTerminal = vals.every((v) => _TERMINAL.indexOf(v.status) !== -1);
  if (!allTerminal) return JOB_STATUS.RUNNING;
  const allOk = vals.every((v) => _OK.indexOf(v.status) !== -1);
  if (allOk) return JOB_STATUS.SUCCEEDED;
  const anyOk = vals.some((v) => _OK.indexOf(v.status) !== -1);
  return anyOk ? JOB_STATUS.PARTIALLY_FAILED : JOB_STATUS.FAILED;
}

/* 한 장면 처리 시작 표시(processing) — 새 상태 반환. */
function markProcessing(state, sceneId) {
  const s = _clone(state);
  const prev = (s.sceneStates && s.sceneStates[sceneId]) || { attemptCount: 0 };
  s.sceneStates[sceneId] = { status: SCENE_STATUS.PROCESSING, attemptCount: prev.attemptCount || 0, errorCode: null };
  s.status = computeJobStatus(s.sceneStates);
  return s;
}

/* 한 장면 결과 반영 — result:{ok, cached?, code?}. attemptCount +1. */
function applySceneResult(state, sceneId, result) {
  const s = _clone(state);
  const r = result || {};
  const prev = (s.sceneStates && s.sceneStates[sceneId]) || { attemptCount: 0 };
  let status;
  if (r.ok) status = r.cached ? SCENE_STATUS.CACHED : SCENE_STATUS.SUCCEEDED;
  else if (r.stale) status = SCENE_STATUS.STALE;
  else status = SCENE_STATUS.FAILED;
  s.sceneStates[sceneId] = { status, attemptCount: (prev.attemptCount || 0) + (r.attempted === false ? 0 : 1), errorCode: r.ok ? null : (r.code || 'ERROR') };
  s.status = computeJobStatus(s.sceneStates);
  return s;
}

/* 재개 대상 — pending/failed/stale 장면(processing은 중단된 것일 수 있어 포함). */
function resumableScenes(state) {
  const ss = (state && state.sceneStates) || {};
  return Object.keys(ss).filter((id) => [SCENE_STATUS.PENDING, SCENE_STATUS.FAILED, SCENE_STATUS.STALE, SCENE_STATUS.PROCESSING].indexOf(ss[id].status) !== -1);
}

/* 카운트 요약(UI용). */
function summarize(state) {
  const ss = (state && state.sceneStates) || {};
  const c = { total: 0, succeeded: 0, cached: 0, failed: 0, skipped: 0, pending: 0, processing: 0, stale: 0 };
  Object.keys(ss).forEach((id) => {
    c.total++;
    const st = ss[id].status;
    if (st === SCENE_STATUS.SUCCEEDED) c.succeeded++;
    else if (st === SCENE_STATUS.CACHED) c.cached++;
    else if (st === SCENE_STATUS.FAILED) c.failed++;
    else if (st === SCENE_STATUS.SKIPPED) c.skipped++;
    else if (st === SCENE_STATUS.PENDING) c.pending++;
    else if (st === SCENE_STATUS.PROCESSING) c.processing++;
    else if (st === SCENE_STATUS.STALE) c.stale++;
  });
  const remaining = c.pending + c.processing + c.failed + c.stale;
  c.estSecondsRemaining = remaining * PER_IMAGE_SECONDS;
  c.jobStatus = computeJobStatus(ss);
  return c;
}

function _clone(state) {
  const s = state || {};
  const out = {};
  Object.keys(s).forEach((k) => { if (k !== 'sceneStates') out[k] = s[k]; });
  out.sceneStates = {};
  const ss = s.sceneStates || {};
  Object.keys(ss).forEach((id) => { out.sceneStates[id] = { status: ss[id].status, attemptCount: ss[id].attemptCount, errorCode: ss[id].errorCode == null ? null : ss[id].errorCode }; });
  return out;
}

module.exports = {
  PER_IMAGE_USD, PER_IMAGE_SECONDS, SCENE_STATUS, JOB_STATUS,
  planImageS2Batch, initBatchState, computeJobStatus, markProcessing, applySceneResult, resumableScenes, summarize,
};
