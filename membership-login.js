/* membership-login.js — 학생 로그인 핵심 로직(Firebase·DOM 비의존).
   joinTeamMembership callable을 정본으로 PIN을 검증한다. client는 pin/account를 직접 read 하지 않는다.
   브라우저(window.MembershipLogin) + Node(require) 양쪽에서 동작 → DOM 없이 하니스 검증 가능. */
;(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MembershipLogin = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const GENERIC_ERROR = '학급 코드, 모둠 정보 또는 비밀번호를 다시 확인해 주세요.';
  const SDK_MISSING = '지금은 로그인 확인 기능을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
  const RETRY_LATER = '잠시 후 다시 시도해 주세요.';
  const PIN_FORMAT = 'PIN은 숫자 4~6자리로 입력해주세요';

  function _isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }
  function _isValidPin(v) { return typeof v === 'string' && /^[0-9]{4,6}$/.test(v); }

  /* 핵심: 입력 allowlist 검증 → callMembership 주입 호출 → 응답 구조 검증 → 정규화 결과.
     반환·메시지·로그 어디에도 PIN을 포함하지 않는다. callMembership 미주입(SDK 없음)이면 실패. */
  async function requestTeamMembership(opts) {
    opts = opts || {};
    const classId = opts.classId;
    const teamName = opts.teamName;
    const pin = opts.pin;
    const callMembership = opts.callMembership;

    if (!_isNonEmptyString(classId))  return { ok: false, code: 'invalid-input', message: GENERIC_ERROR, called: false };
    if (!_isNonEmptyString(teamName)) return { ok: false, code: 'invalid-input', message: GENERIC_ERROR, called: false };
    if (!_isValidPin(pin))            return { ok: false, code: 'invalid-input', message: PIN_FORMAT,    called: false };
    if (typeof callMembership !== 'function') return { ok: false, code: 'sdk-missing', message: SDK_MISSING, called: false };

    let data;
    try {
      /* 정확히 3개 필드만 전달 */
      data = await callMembership({ classId: classId, teamName: teamName, pin: pin });
    } catch (e) {
      const raw = (e && e.code) ? String(e.code) : 'error';
      const code = raw.replace(/^functions\//, '');   /* 'functions/permission-denied' → 'permission-denied' */
      let message = GENERIC_ERROR;
      if (code === 'unavailable' || code === 'internal' || code === 'deadline-exceeded' || code === 'resource-exhausted') {
        message = RETRY_LATER;
      } else if (code === 'unauthenticated') {
        message = SDK_MISSING;
      }
      /* permission-denied(팀/PIN 불일치·locked)·invalid-argument → 통합 메시지(존재 여부 비노출). */
      return { ok: false, code: code, message: message, called: true };
    }

    if (!data || data.ok !== true || typeof data.membershipVersion !== 'number') {
      return { ok: false, code: 'malformed-response', message: GENERIC_ERROR, called: true };
    }
    return { ok: true, membershipVersion: data.membershipVersion, called: true };
  }

  /* SEC-5: 재접속 복원 판정(순수). DOM·Firebase 없이 테스트 가능.
     isMembershipActive: async () => boolean  (members/{uid}/status === 'active' 확인 주입).
     PIN 미사용 — 저장 PIN으로 callable 자동 호출하지 않는다. members write도 하지 않는다. */
  async function resolveResume(opts) {
    opts = opts || {};
    const ctx = opts.ctx;
    const isMembershipActive = opts.isMembershipActive;
    if (!ctx || !ctx.teamName || !ctx.classId) return { action: 'login', reason: 'no-context' };
    if (typeof isMembershipActive !== 'function') return { action: 'login', reason: 'no-checker' };
    let active = false;
    try { active = await isMembershipActive(); } catch (e) { active = false; }
    return active ? { action: 'enter' } : { action: 'login', reason: 'no-membership' };
  }

  /* 세션 저장용 sanitize — pin 등 비밀 필드 제거(레거시 세션 pin 잔여 제거). */
  function sanitizeSession(obj) {
    obj = obj || {};
    return {
      teamName: obj.teamName || null,
      classId: obj.classId || null,
      classCode: obj.classCode || null,
      savedAt: obj.savedAt || null,
    };
  }

  /* single-flight 잠금 — 중복 클릭 시 진행 중이면 무시(재진입 방지). 종료 후 재시도 가능. */
  function createSingleFlight() {
    let inFlight = false;
    return {
      isBusy: function () { return inFlight; },
      run: async function (fn) {
        if (inFlight) return { skipped: true };
        inFlight = true;
        try { return { skipped: false, result: await fn() }; }
        finally { inFlight = false; }
      },
    };
  }

  return {
    requestTeamMembership: requestTeamMembership,
    resolveResume: resolveResume,
    sanitizeSession: sanitizeSession,
    createSingleFlight: createSingleFlight,
    GENERIC_ERROR: GENERIC_ERROR,
    SDK_MISSING: SDK_MISSING,
  };
});
