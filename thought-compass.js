/* thought-compass.js — 생각 나침반 Phase 0 상태 foundation (순수 로직, Firebase·DOM 비의존).
   브라우저(window.ThoughtCompass) + Node(require) 양쪽 동작 → 하니스로 검증 가능.
   정본 스키마: docs/thought_compass_phase0_foundation_design.md (status = notStarted|inProgress|completed).
   저장 경로: classes/{classId}/teams/{enc}/writingGuide/preWriting · /onboarding · /editSession. */
;(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ThoughtCompass = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const VERSION = 1;
  const STATUS = { NOT_STARTED: 'notStarted', IN_PROGRESS: 'inProgress', COMPLETED: 'completed' };
  const MODES = { REQUIRED: 'required', OPTIONAL: 'optional', NONE: 'none' };
  /* 생각 나침반 적용 대상 = 그림책·텍스트만. movie/experience 제외(PRD D-01). */
  const COMPASS_TYPES = ['picturebook', 'text'];
  /* 저장 금지 개인식별/비밀 필드 — sanitize에서 제거 */
  const FORBIDDEN_FIELDS = ['pin', 'PIN', 'studentName', 'realName', 'uid', 'sessionToken', 'token', 'rawLog', 'fullLog', 'password'];

  function _isType(t) { return COMPASS_TYPES.indexOf(t) >= 0; }

  /* 구버전/오타 status 값 정규화(snake_case 호환) → 정본 camelCase */
  function _coerceStatus(s) {
    if (s === STATUS.NOT_STARTED || s === STATUS.IN_PROGRESS || s === STATUS.COMPLETED) return s;
    if (s === 'not_started') return STATUS.NOT_STARTED;
    if (s === 'in_progress') return STATUS.IN_PROGRESS;
    if (s === 'complete' || s === 'done') return STATUS.COMPLETED;
    return STATUS.NOT_STARTED;
  }

  function getDefaultThoughtCompassState(opts) {
    opts = opts || {};
    return {
      version: VERSION,
      status: STATUS.NOT_STARTED,
      mode: (opts.mode === MODES.OPTIONAL || opts.mode === MODES.REQUIRED) ? opts.mode : MODES.OPTIONAL,
      projectType: _isType(opts.projectType) ? opts.projectType : null,
      currentQuestionIndex: 0,
      answers: {},
      followUps: [],
      startedAt: null,
      updatedAt: null,
      completedAt: null,
    };
  }

  /* null·구버전·부분 저장 안전 처리. 알 수 없는 필드 제거. status 불일치 보정. */
  function normalizeThoughtCompassState(raw) {
    const base = getDefaultThoughtCompassState();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;

    let status = _coerceStatus(raw.status);
    /* completedAt이 있어도 status가 completed가 아니면 완료로 보지 않음(역도 보정).
       completed인데 completedAt 없으면 in_progress로 강등(불일치 방어). */
    const completedAt = (typeof raw.completedAt === 'number') ? raw.completedAt : null;
    if (status === STATUS.COMPLETED && completedAt === null) status = STATUS.IN_PROGRESS;

    let idx = Number.isFinite(raw.currentQuestionIndex) ? Math.floor(raw.currentQuestionIndex) : 0;
    if (idx < 0) idx = 0;

    const out = {
      version: VERSION,
      status: status,
      mode: (raw.mode === MODES.REQUIRED || raw.mode === MODES.OPTIONAL || raw.mode === MODES.NONE) ? raw.mode : MODES.OPTIONAL,
      projectType: _isType(raw.projectType) ? raw.projectType : null,
      currentQuestionIndex: (status === STATUS.NOT_STARTED) ? 0 : idx,
      answers: (raw.answers && typeof raw.answers === 'object' && !Array.isArray(raw.answers)) ? raw.answers : {},
      followUps: Array.isArray(raw.followUps) ? raw.followUps : [],
      startedAt: (typeof raw.startedAt === 'number') ? raw.startedAt : null,
      updatedAt: (typeof raw.updatedAt === 'number') ? raw.updatedAt : null,
      completedAt: completedAt,
    };
    return sanitizeThoughtCompassState(out);
  }

  /* 적용 모드 판정: 신규(onboarding.version>=1)=required, 기존=optional, movie/experience=none. */
  function resolveThoughtCompassMode(ctx) {
    ctx = ctx || {};
    if (!_isType(ctx.projectType)) return MODES.NONE;
    const hasOnboardingVersion = Number.isFinite(ctx.onboardingVersion) && ctx.onboardingVersion >= 1;
    return hasOnboardingVersion ? MODES.REQUIRED : MODES.OPTIONAL;
  }

  function isThoughtCompassStarted(state) {
    const s = normalizeThoughtCompassState(state);
    return s.status === STATUS.IN_PROGRESS || s.status === STATUS.COMPLETED;
  }
  function isThoughtCompassCompleted(state) {
    const s = normalizeThoughtCompassState(state);
    return s.status === STATUS.COMPLETED && typeof s.completedAt === 'number';
  }
  /* 강제 대상(required) 미완료, 또는 일단 시작(in_progress)했으면 완료 전까지 필수. */
  function isThoughtCompassRequired(state) {
    const s = normalizeThoughtCompassState(state);
    if (s.mode === MODES.NONE) return false;
    if (s.status === STATUS.COMPLETED) return false;
    return s.mode === MODES.REQUIRED || s.status === STATUS.IN_PROGRESS;
  }
  /* 일반 maker 진입 가능 여부 = 필수가 아닐 때만. movie/experience(none)은 항상 진입 가능. */
  function canEnterMaker(state) {
    return !isThoughtCompassRequired(state);
  }

  /* 개인식별/비밀 필드 제거 + 알 수 없는 top-level 필드 제거(allowlist). */
  function sanitizeThoughtCompassState(state) {
    state = state || {};
    const allow = ['version','status','mode','projectType','currentQuestionIndex','answers','followUps','startedAt','updatedAt','completedAt'];
    const out = {};
    for (const k of allow) if (k in state) out[k] = state[k];
    for (const f of FORBIDDEN_FIELDS) delete out[f];
    /* answers 안의 비밀 필드도 방어적으로 제거 */
    if (out.answers && typeof out.answers === 'object') {
      for (const qk of Object.keys(out.answers)) {
        const a = out.answers[qk];
        if (a && typeof a === 'object') for (const f of FORBIDDEN_FIELDS) delete a[f];
      }
    }
    return out;
  }

  function buildThoughtCompassPaths(ctx) {
    ctx = ctx || {};
    const classId = ctx.classId;
    const teamEncoded = (typeof ctx.teamEncoded === 'string') ? ctx.teamEncoded
      : (typeof ctx.teamName === 'string' ? encodeURIComponent(ctx.teamName) : null);
    if (!classId || !teamEncoded) return null;
    const base = `classes/${classId}/teams/${teamEncoded}`;
    return {
      base: base,
      preWriting: `${base}/writingGuide/preWriting`,
      onboarding: `${base}/onboarding`,
      onboardingVersion: `${base}/onboarding/version`,
      editSession: `${base}/editSession`,
      members: `${base}/members`,
    };
  }

  /* ── 진입 게이트 결정(순수) ──
     반환: 'thoughtCompassRequired' | 'editableMaker'. (tutorial/readOnly는 후속 Phase) */
  const ACCESS = { COMPASS_REQUIRED: 'thoughtCompassRequired', EDITABLE_MAKER: 'editableMaker' };
  function resolveProjectAccessState(ctx) {
    ctx = ctx || {};
    const mode = resolveThoughtCompassMode({ projectType: ctx.projectType, onboardingVersion: ctx.onboardingVersion });
    if (mode === MODES.NONE) return ACCESS.EDITABLE_MAKER;   /* movie/experience */
    const s = normalizeThoughtCompassState(ctx.compassState);
    s.mode = mode;
    if (s.status === STATUS.COMPLETED && typeof s.completedAt === 'number') return ACCESS.EDITABLE_MAKER;
    /* required(신규) 또는 일단 시작(in_progress) → 게이트. optional 미시작 → editable(버튼으로만 시작, Phase G). */
    if (mode === MODES.REQUIRED || s.status === STATUS.IN_PROGRESS) return ACCESS.COMPASS_REQUIRED;
    return ACCESS.EDITABLE_MAKER;
  }

  /* 중단·이어하기(순수) — RTDB가 정본(localStorage 정본 아님). 복원 지점 계산.
     반환 action: 'fresh'(미시작) | 'resume'(진행 중) | 'completed'(완료, 이어서 미표시). */
  function resolveResumePoint(state) {
    const s = normalizeThoughtCompassState(state);
    if (s.status === STATUS.COMPLETED && typeof s.completedAt === 'number') {
      return { action: 'completed', questionIndex: s.currentQuestionIndex, answers: s.answers, followUps: s.followUps };
    }
    if (s.status === STATUS.IN_PROGRESS) {
      /* currentQuestionIndex가 깨졌으면 normalize가 0 이상으로 보정한 값 사용(그룹 공유 answers 유지). */
      return { action: 'resume', questionIndex: s.currentQuestionIndex, answers: s.answers, followUps: s.followUps };
    }
    return { action: 'fresh', questionIndex: 0, answers: {}, followUps: [] };
  }

  /* 게이트 화면 뷰 기술자(순수) — UI가 이걸 렌더만. 강제 신규=닫기/건너뛰기 없음, optional=나중에 가능. */
  function describeGate(ctx) {
    ctx = ctx || {};
    const access = resolveProjectAccessState(ctx);
    if (access !== ACCESS.COMPASS_REQUIRED) return { show: false };
    const s = normalizeThoughtCompassState(ctx.compassState);
    const inProgress = s.status === STATUS.IN_PROGRESS;
    const mode = resolveThoughtCompassMode({ projectType: ctx.projectType, onboardingVersion: ctx.onboardingVersion });
    return {
      show: true,
      title: '이야기를 시작하기 전에',
      description: '먼저 이야기의 방향을 함께 정해 보아요.',
      primaryAction: inProgress ? 'resume' : 'start',
      primaryLabel: inProgress ? '이어서 하기' : '시작하기',
      progressLabel: inProgress ? ('현재 진행: ' + (s.currentQuestionIndex + 1) + '번째 질문') : null,
      dismissible: mode === MODES.OPTIONAL ? true : false,   /* 강제 신규는 닫기 불가 */
      allowSkip: false,
      blockMakerClick: true,
    };
  }

  /* ── 저장 plan(순수) ── 실제 write는 firebase adapter가 수행.
     plan = { path, update }  (해당 child 경로만 update — team root·scenes·viewer-meta·account·members·locks 미접근).
     SERVER 토큰은 adapter가 ServerValue.TIMESTAMP로 치환하도록 sentinel '@serverTimestamp' 사용. */
  const SERVER_TS = '@serverTimestamp';

  function planMarkStarted(ctx, state) {
    const paths = buildThoughtCompassPaths(ctx);
    if (!paths) return null;
    const s = normalizeThoughtCompassState(state);
    /* 이미 시작/완료면 startedAt 보존(멱등). status가 notStarted일 때만 시작 표시. */
    const update = { updatedAt: SERVER_TS };
    if (s.status === STATUS.NOT_STARTED) {
      update.status = STATUS.IN_PROGRESS;
      update.startedAt = SERVER_TS;
      update.currentQuestionIndex = 0;
      update.version = VERSION;
    }
    return { path: paths.preWriting, update: update };
  }

  function planSaveProgress(ctx, state, patch) {
    const paths = buildThoughtCompassPaths(ctx);
    if (!paths) return null;
    patch = patch || {};
    const update = { updatedAt: SERVER_TS };
    if (Number.isFinite(patch.currentQuestionIndex) && patch.currentQuestionIndex >= 0) {
      update.currentQuestionIndex = Math.floor(patch.currentQuestionIndex);
    }
    if (patch.answers && typeof patch.answers === 'object' && !Array.isArray(patch.answers)) {
      /* answers는 child 경로별로 병합(전체 덮어쓰기 아님) */
      update.answers = sanitizeThoughtCompassState({ answers: patch.answers }).answers;
    }
    /* 진행 저장은 status를 완료→진행으로 되돌리지 않음(완료 보호) */
    const s = normalizeThoughtCompassState(state);
    if (s.status === STATUS.NOT_STARTED) { update.status = STATUS.IN_PROGRESS; update.version = VERSION; }
    return { path: paths.preWriting, update: update };
  }

  function planMarkCompleted(ctx, state) {
    const paths = buildThoughtCompassPaths(ctx);
    if (!paths) return null;
    const s = normalizeThoughtCompassState(state);
    /* 이미 완료면 멱등(완료 시각 보존) */
    if (s.status === STATUS.COMPLETED) return { path: paths.preWriting, update: { updatedAt: SERVER_TS } };
    return { path: paths.preWriting, update: { status: STATUS.COMPLETED, completedAt: SERVER_TS, updatedAt: SERVER_TS, version: VERSION } };
  }

  /* 교사 초기화(생각 나침반만) — preWriting을 notStarted로. onboarding/tutorial·scenes 미접근. */
  function planResetCompassOnly(ctx) {
    const paths = buildThoughtCompassPaths(ctx);
    if (!paths) return null;
    return { path: paths.preWriting, update: {
      version: VERSION, status: STATUS.NOT_STARTED, currentQuestionIndex: 0,
      answers: null, followUps: null, startedAt: null, completedAt: null, updatedAt: SERVER_TS,
    } };
  }

  /* 복사본 정책(PRE-02): writingGuide 미승계 + onboarding/version 재부여(신규 그림책/텍스트). */
  function planCopyResetOnboarding(ctx, projectType) {
    const paths = buildThoughtCompassPaths(ctx);
    if (!paths) return null;
    const give = _isType(projectType) ? VERSION : null;   /* movie/experience엔 부여 안 함 */
    return {
      onboardingVersion: { path: paths.onboardingVersion, value: give },
      clearWritingGuide: { path: paths.preWriting, value: null },   /* 복사본 compass not_started */
    };
  }

  return {
    VERSION, STATUS, MODES, COMPASS_TYPES, SERVER_TS, ACCESS,
    resolveProjectAccessState, describeGate, resolveResumePoint,
    planMarkStarted, planSaveProgress, planMarkCompleted, planResetCompassOnly, planCopyResetOnboarding,
    getDefaultThoughtCompassState,
    normalizeThoughtCompassState,
    resolveThoughtCompassMode,
    isThoughtCompassStarted,
    isThoughtCompassCompleted,
    isThoughtCompassRequired,
    canEnterMaker,
    sanitizeThoughtCompassState,
    buildThoughtCompassPaths,
  };
});
