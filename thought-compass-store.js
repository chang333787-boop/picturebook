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
      const [pw, ov, cf] = await Promise.all([
        db.ref(paths.preWriting).once('value'),
        db.ref(paths.onboardingVersion).once('value'),
        db.ref(paths.copiedFrom).once('value'),   /* 복사본 required 판정(PRE-02) */
      ]);
      return { ok: true, raw: pw.val(), onboardingVersion: ov.val(), copiedFrom: cf.val() };
    } catch (e) {
      /* LEGACY-MEMBERSHIP-UX-1: 에러 코드를 표면화 — 호출부가 "권한 거부(멤버십 오래됨)"와
         "그냥 데이터 없음"을 구분해 안내를 다르게 낼 수 있도록. (기존 필드는 그대로) */
      return { ok: false, raw: null, onboardingVersion: null, copiedFrom: null,
        errorCode: (e && e.code) ? String(e.code) : null };
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

  async function markThoughtCompassStarted(ctx, state, qVersion) { return _applyPlan(_TC().planMarkStarted(ctx, state, qVersion)); }
  async function saveThoughtCompassProgress(ctx, state, patch) { return _applyPlan(_TC().planSaveProgress(ctx, state, patch)); }
  async function markThoughtCompassCompleted(ctx, state) { return _applyPlan(_TC().planMarkCompleted(ctx, state)); }
  async function resetThoughtCompassOnly(ctx) { return _applyPlan(_TC().planResetCompassOnly(ctx)); }

  /* FREE-NOTE: 자유 메모(떠오른 생각) 저장 — 질문 답변과 완전 분리.
     · deep-path update(preWriting/userNotes)만 → answers/followUps/completedAt/status 보존(전체 set 금지).
     · 진행률·완료 판정·BASE10·AI payload와 무관(별도 필드). 빈 문자열도 허용(빈값 표시).
     · writingGuide write 권한(member active / 담당 교사 / super_admin) 안에서 동작 — Rules 변경 없음. */
  /* COMPASS-VALUE-1(2026-07-21): 마지막 가치 질문 결과 저장 — userNotes와 동일 패턴
     (preWriting/storyValue deep-path update만 → answers/followUps/status 무접촉·Rules 무변경).
     answers 스키마(질문 키 3곳 동기화 지뢰)를 건드리지 않는 별도 필드가 핵심. */
  async function saveThoughtCompassStoryValue(ctx, picked, candidates) {
    const TC = _TC();
    const paths = TC.buildThoughtCompassPaths(ctx);
    if (!paths) return { ok: false };
    const word = String(picked == null ? '' : picked).trim().slice(0, 12);
    if (!word) return { ok: false };
    const cands = (Array.isArray(candidates) ? candidates : [])
      .map(function (c) { return String((c && c.word) || '').trim().slice(0, 12); })
      .filter(Boolean).slice(0, 3);
    try {
      await db.ref(paths.preWriting + '/storyValue').update({
        picked: word, candidates: cands, updatedAt: _serverTs(),
      });
      return { ok: true };
    } catch (e) { return { ok: false, error: e }; }
  }

  async function saveThoughtCompassUserNotes(ctx, text) {
    const TC = _TC();
    const paths = TC.buildThoughtCompassPaths(ctx);
    if (!paths) return { ok: false };
    let uid = null;
    try {
      if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) uid = firebase.auth().currentUser.uid;
    } catch (_) {}
    const t = (typeof text === 'string') ? text : '';
    try {
      await db.ref(paths.preWriting + '/userNotes').update({ text: t, updatedAt: _serverTs(), updatedBy: uid || null });
      return { ok: true };
    } catch (e) { return { ok: false, error: e }; }
  }
  /* FREE-NOTE: 자유 메모만 읽기(읽기 전용 표시·완료 화면 초기값). 다른 데이터 미접근. */
  async function loadThoughtCompassUserNotes(ctx) {
    const TC = _TC();
    const paths = TC.buildThoughtCompassPaths(ctx);
    if (!paths) return '';
    try {
      const snap = await db.ref(paths.preWriting + '/userNotes/text').once('value');
      const v = snap.val();
      return (typeof v === 'string') ? v : '';
    } catch (_) { return ''; }
  }

  window.ThoughtCompassStore = {
    loadThoughtCompassState,
    loadThoughtCompassStateResult,
    markOnboardingRequired,
    markThoughtCompassStarted,
    saveThoughtCompassProgress,
    saveThoughtCompassFollowUps,
    markThoughtCompassCompleted,
    resetThoughtCompassOnly,
    saveThoughtCompassUserNotes,
    loadThoughtCompassUserNotes,
    saveThoughtCompassStoryValue,
  };
})();
