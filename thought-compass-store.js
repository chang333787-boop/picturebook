/* thought-compass-store.js — 생각 나침반 RTDB adapter(얇음).
   순수 로직/plan은 thought-compass.js(ThoughtCompass)가 담당. 이 파일은 plan을 실제 db에 적용한다.
   · team root·scenes·viewer-meta·account·members·locks를 절대 쓰지 않는다(plan이 child 경로만 생성).
   · SERVER 토큰('@serverTimestamp')은 여기서 firebase ServerValue.TIMESTAMP로 치환.
   · 브라우저 전용(전역 db/firebase 사용). 로직 검증은 thought-compass.js plan 테스트 + Rules emulator. */
;(function () {
  'use strict';
  if (typeof window === 'undefined') return;   /* Node에서는 no-op(plan/Rules 테스트로 검증) */

  function _TC() { return window.ThoughtCompass; }
  function _serverTs() {
    return (typeof firebase !== 'undefined' && firebase.database && firebase.database.ServerValue)
      ? firebase.database.ServerValue.TIMESTAMP : Date.now();
  }
  /* plan.update 안의 SERVER 토큰을 ServerValue.TIMESTAMP로 치환(중첩 1단계까지) */
  function _resolve(update) {
    const TC = _TC();
    const out = {};
    for (const k in update) {
      const v = update[k];
      out[k] = (v === TC.SERVER_TS) ? _serverTs() : v;
    }
    return out;
  }
  async function _applyPlan(plan) {
    if (!plan) return false;
    await db.ref(plan.path).update(_resolve(plan.update));
    return true;
  }

  /* preWriting 상태 + onboarding/version을 읽어 normalize된 state 반환(mode 포함). */
  async function loadThoughtCompassState(ctx) {
    const TC = _TC();
    const paths = TC.buildThoughtCompassPaths(ctx);
    if (!paths) return TC.getDefaultThoughtCompassState();
    let preWriting = null, onboardingVersion = null;
    try {
      const [pw, ov] = await Promise.all([
        db.ref(paths.preWriting).once('value'),
        db.ref(paths.onboardingVersion).once('value'),
      ]);
      preWriting = pw.val();
      onboardingVersion = ov.val();
    } catch (e) { /* 권한/네트워크 실패 → 기본값(비차단) */ }
    const state = TC.normalizeThoughtCompassState(preWriting || {});
    state.projectType = (ctx && ctx.projectType) || state.projectType;
    state.mode = TC.resolveThoughtCompassMode({ projectType: state.projectType, onboardingVersion: onboardingVersion });
    return state;
  }

  /* 에러를 표면화하는 로드 — { ok, raw(preWriting 원본 null 가능), onboardingVersion }.
     controller fail-closed 판정용(loadThoughtCompassState는 catch→기본값이라 에러 구분 불가). */
  async function loadThoughtCompassStateResult(ctx) {
    const TC = _TC();
    const paths = TC.buildThoughtCompassPaths(ctx);
    if (!paths) return { ok: false, raw: null, onboardingVersion: null };
    try {
      const [pw, ov] = await Promise.all([
        db.ref(paths.preWriting).once('value'),
        db.ref(paths.onboardingVersion).once('value'),
      ]);
      return { ok: true, raw: pw.val(), onboardingVersion: ov.val() };
    } catch (e) {
      return { ok: false, raw: null, onboardingVersion: null };
    }
  }

  /* 신규 작품 required 트리거 — onboarding/version = VERSION write(scenes/viewer-meta 미접근). */
  async function markOnboardingRequired(ctx) {
    const TC = _TC();
    const paths = TC.buildThoughtCompassPaths(ctx);
    if (!paths) return false;
    await db.ref(paths.onboardingVersion).set(TC.VERSION);
    return true;
  }

  /* AI 후속질문 답변 저장(Phase H) — preWriting/followUps 배열만 갱신(answers/status 미접근). */
  async function saveThoughtCompassFollowUps(ctx, followUps) {
    const TC = _TC();
    const paths = TC.buildThoughtCompassPaths(ctx);
    if (!paths) return false;
    await db.ref(paths.preWriting).update({ followUps: Array.isArray(followUps) ? followUps : [], updatedAt: _serverTs() });
    return true;
  }

  async function markThoughtCompassStarted(ctx, state) { return _applyPlan(_TC().planMarkStarted(ctx, state)); }
  async function saveThoughtCompassProgress(ctx, state, patch) { return _applyPlan(_TC().planSaveProgress(ctx, state, patch)); }
  async function markThoughtCompassCompleted(ctx, state) { return _applyPlan(_TC().planMarkCompleted(ctx, state)); }
  async function resetThoughtCompassOnly(ctx) { return _applyPlan(_TC().planResetCompassOnly(ctx)); }

  window.ThoughtCompassStore = {
    loadThoughtCompassState,
    loadThoughtCompassStateResult,
    markOnboardingRequired,
    markThoughtCompassStarted,
    saveThoughtCompassProgress,
    saveThoughtCompassFollowUps,
    markThoughtCompassCompleted,
    resetThoughtCompassOnly,
  };
})();
