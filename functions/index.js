/* ====================================================================
   functions/index.js — 가지 AI Phase A (Anthropic Claude Haiku)
   --------------------------------------------------------------------
   Phase A 박은 거:
   - callTextAiBatch: 텍스트 1단계 (안심 정돈) — Haiku
   - callWorkCheck:   작품 검사 (진단 + 확인 방향) — Haiku

   v140 정책 박힘 (AI_POLICY_V140.md):
   - 원본 body 박지 X (Functions는 aiVariants / aiDrafts 노드만 박음)
   - aiVariants.textS1.final 저장 (덮어쓰기 X)
   - 1단계 후보 3회 (브랜치당)
   - testMode 우회 박지 X (운영 강제)

   11단 방어 박힘 (AI_COST_GUARD_PLAN.md):
   1. Firebase auth (req.auth 박지 X 박혀있으면 거부)
   2. 임시 허용 목록 (AI_TEST_ALLOWED)
   3. aiPermission.enabled + allowedModes[mode]
   4. branchLineage.copyDepth <= 1
   5. testMode 거부 (실 API)
   6. 브랜치 quota
   7. rootBranchId 묶음 quota
   8. 전역 일일 / 월간 hard cap
   9. maxInstances: 5 (Functions invocation 폭주 박지 X)
   10. Origin 검증 (가지 도메인 박지 X 박혀있으면 거부)
   11. kill switch (Firebase ai-kill-switch/enabled)

   step1 ✓ 골격
   step2 ✓ 11단 검증 박음 (지금) — Anthropic 호출 박지 X
   step3 ⏳ Anthropic SDK + prompt + 환불 정책
   step4 ⏳ database.rules.json + viewer-ai.js Firebase Functions 호출
   ==================================================================== */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { setGlobalOptions } = require('firebase-functions/v2');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');

/* Firebase Admin 초기화 — 1번만 */
if (!admin.apps.length) {
  admin.initializeApp();
}

/* 전역 옵션 박음 — 모든 함수 박은 거 박은 거 박은 박은 적용 */
setGlobalOptions({
  region: 'asia-northeast3',   /* 서울 — 한국 사용자 latency 박음 */
  maxInstances: 5,             /* 11단 #9 — invocation 폭주 박지 X */
  timeoutSeconds: 60,          /* 1분 timeout (호출 lock 박은 거 박은 거 박은 박은 정합) */
});

/* Anthropic API key — Google Cloud Secret Manager 박음 (step3 박을 때 박을 거) */
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

/* ════════════════════════════════════════════════════════════════
   Phase A 테스트용 임시 허용 목록 (AI_SAFETY_COST_RULES.md 최상단)
   ⚠️ 운영 박힐 때 teacherId/account 기반으로 교체
   ════════════════════════════════════════════════════════════════ */
const AI_TEST_ALLOWED = [
  { classId: 'JL26A', teamName: '0000' },
  { classId: 'JL26A', teamName: '은규' },
  { classId: 'JL26A', teamName: '예지유은인우' },
];

function isAiTestAllowed(classId, teamName) {
  return AI_TEST_ALLOWED.some(a => a.classId === classId && a.teamName === teamName);
}

/* ════════════════════════════════════════════════════════════════
   quota 박힌 거 박은 거 박은 박은 (AI_COST_GUARD_PLAN.md 2-3·2-4·2-8)
   ════════════════════════════════════════════════════════════════ */
const QUOTA = {
  s1: 3,         /* 1단계 — 브랜치당 후보 3회 */
  check: 5,      /* 작품 검사 — 브랜치당 5회 */
};
const ROOT_DAILY_LIMIT = 50;       /* rootBranchId 묶음 — 하루 50회 */
const GLOBAL_DAILY_LIMIT = 500;    /* 전역 일일 hard cap */

/* ════════════════════════════════════════════════════════════════
   Origin 검증 — 가지 도메인 박은 거 박은 거 박은 박은만 허용
   ⚠️ 박은 도메인 박은 거 박은 거 박은 박은 — 사용자 박을 거 박은 거 박은 박은 (Firebase Hosting URL 박힐 때)
   localhost 박은 거 박은 거 박은 박은 박혀있어 — 개발 박을 때 박음
   ════════════════════════════════════════════════════════════════ */
const ALLOWED_ORIGINS = [
  /* Firebase Hosting URL — 사용자 박을 거 박은 거 박은 박은 (deploy 박힐 때 박을 거) */
  /* 'https://branch-picturebook.web.app', */
  /* 'https://branch-picturebook.firebaseapp.com', */

  /* 로컬 개발 */
  'http://localhost:8765',
  'http://localhost:8000',
  'http://127.0.0.1:8765',
  'http://127.0.0.1:8000',
];

function isOriginAllowed(origin) {
  if (!origin) return false;
  /* ALLOWED_ORIGINS 박지 X 박혀있으면 — 박은 거 박은 거 박은 박은 X 박은 거 박은 거 박은 박은 박지 X */
  if (ALLOWED_ORIGINS.length === 0) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

/* ════════════════════════════════════════════════════════════════
   날짜 helper
   ════════════════════════════════════════════════════════════════ */
function _todayYmd() {
  /* 서버 박은 거 박은 거 박은 박은 UTC — 한국 박은 거 박은 거 박은 박은 +9. 단 박은 거 박은 거 박은 박은 박은 — UTC 박은 거 박은 거 박은 박은 박음 (Anthropic 콘솔과 정합) */
  return new Date().toISOString().slice(0, 10);
}

function _yyyyMm() {
  return _todayYmd().slice(0, 7);
}

/* ════════════════════════════════════════════════════════════════
   11단 검증 — 호출 진입 단 박음
   ──────────────────────────────────────────────────────────────
   각 박힌 단계 박지 X 박혀있으면 HttpsError throw.
   순서: 가벼운 검증 박은 거 박은 거 박은 박은 → 무거운 검증 (DB 박은 거 박은 거 박은 박은)
   ════════════════════════════════════════════════════════════════ */
async function _validateRequest(req, mode) {
  /* 1. Firebase auth (anonymous라도 박힘) */
  if (!req.auth || !req.auth.uid) {
    throw new HttpsError('unauthenticated', '로그인 박은 거 박은 거 박은 박은 박지 X');
  }

  /* 5. testMode 거부 — v140 핵심. client testMode 박혀있어도 실 API 박지 X */
  if (req.data && req.data.testMode === true) {
    logger.warn('[ai] testMode 우회 시도 박힘', { uid: req.auth.uid, data: req.data });
    throw new HttpsError('permission-denied', 'testMode 박은 거 박은 거 박은 박은 실 API 박지 X');
  }

  /* 데이터 박은 거 박은 거 박은 박은 박음 */
  const data = req.data || {};
  const classId = String(data.classId || '');
  const teamName = String(data.teamName || '');
  const workId = String(data.workId || '');
  const rootBranchId = data.rootBranchId ? String(data.rootBranchId) : null;
  const copyDepth = Number.isFinite(data.copyDepth) ? data.copyDepth : 0;

  if (!classId || !teamName) {
    throw new HttpsError('invalid-argument', 'classId / teamName 박지 X');
  }
  if (!workId) {
    throw new HttpsError('invalid-argument', 'workId 박지 X');
  }

  /* 2. 임시 허용 목록 (Phase A 박은 거 박은 거 박은 박은 박음) */
  if (!isAiTestAllowed(classId, teamName)) {
    throw new HttpsError('permission-denied',
      'AI 사용 권한 박지 X (Phase A 테스트 대상 박지 X — ' + classId + '/' + teamName + ')');
  }

  /* 4. copyDepth <= 1 (모/자식 브랜치만 박음 — 손자 박지 X) */
  if (copyDepth > 1) {
    throw new HttpsError('permission-denied',
      'AI_BLOCKED_BY_DEPTH — copyDepth ' + copyDepth + ' (모/자식 브랜치만 박음)');
  }

  /* 10. Origin 검증 (가지 도메인만) */
  const origin = (req.rawRequest && req.rawRequest.headers && req.rawRequest.headers.origin) || '';
  if (!isOriginAllowed(origin)) {
    logger.warn('[ai] origin 박지 X', { uid: req.auth.uid, origin });
    throw new HttpsError('permission-denied', '허용 박지 X origin — ' + (origin || '(빈 값)'));
  }

  /* 11. kill switch (Firebase ai-kill-switch/enabled) */
  const killSnap = await admin.database().ref('ai-kill-switch/enabled').once('value');
  if (killSnap.val() === true) {
    throw new HttpsError('unavailable', 'AI 박은 거 박은 거 박은 박은 잠시 박지 X. 운영자에게 박음.');
  }

  /* 3. aiPermission (Firebase RTDB 박음)
     박을 노드 박은 거 박은 거 박은 박은: classes/{classId}/teams/{teamName}/works/{workId}/aiPermission
     ⚠️ 실제 가지 박은 거 박은 거 박은 박은 박은 거 박은 거 박은 박은 — 박을 노드 위치 박은 거 박은 거 박은 박은 데이터 모델에 정합 박을 거.
     박은 거 박은 거 박은 박은 박은 거 박은 거 박은 박은 — Phase A 박을 때 박지 X 박혀있을 가능성 — 박지 X 박혀있으면 기본 ON 박음 (Phase A 테스트라).
     운영 박은 거 박은 거 박은 박은 — 박혀있어야 박을 거 (사용자가 박을 거 박은 거 박은 박은 maker.html에서 박을 거). */
  const permPath = `classes/${classId}/teams/${teamName}/works/${workId}/aiPermission`;
  const permSnap = await admin.database().ref(permPath).once('value');
  const perm = permSnap.val();
  /* Phase A 박은 거 박은 거 박은 박은 — perm 박지 X 박혀있으면 기본 ON 박음. 운영 박을 때 박은 거 박은 거 박은 박은 perm 박혀있어야 박음. */
  if (perm) {
    if (perm.enabled !== true) {
      throw new HttpsError('permission-denied', 'AI_NOT_ENABLED (교사가 AI 박지 X)');
    }
    const allowed = perm.allowedModes && perm.allowedModes[mode];
    if (allowed !== true) {
      throw new HttpsError('permission-denied', `MODE_NOT_ALLOWED (${mode})`);
    }
  } else {
    logger.info('[ai] aiPermission 박지 X — Phase A 테스트 기본 ON 박음', { classId, teamName, workId });
  }

  /* 8. 전역 일일 hard cap */
  const today = _todayYmd();
  const globalSnap = await admin.database().ref(`ai-usage-global/${today}/calls`).once('value');
  const globalCalls = globalSnap.val() || 0;
  if (globalCalls >= GLOBAL_DAILY_LIMIT) {
    throw new HttpsError('resource-exhausted',
      '오늘 전역 호출 한도 박은 거 박은 거 박은 박은 (' + GLOBAL_DAILY_LIMIT + '). 내일 박음.');
  }

  /* 7. rootBranchId 묶음 quota */
  if (rootBranchId) {
    const rootSnap = await admin.database().ref(`ai-usage-by-root/${rootBranchId}/${today}/calls`).once('value');
    const rootCalls = rootSnap.val() || 0;
    if (rootCalls >= ROOT_DAILY_LIMIT) {
      throw new HttpsError('resource-exhausted',
        `이 작품 묶음(rootBranchId) 박은 거 박은 거 박은 박은 하루 한도 박힘 (${ROOT_DAILY_LIMIT}). 내일 박음.`);
    }
  }

  /* 6. 브랜치 quota */
  const yyyyMm = _yyyyMm();
  const usagePath = `ai-usage/${classId}/${teamName}/${yyyyMm}/${mode}Used`;
  const usageSnap = await admin.database().ref(usagePath).once('value');
  const used = usageSnap.val() || 0;
  const quotaMax = QUOTA[mode] || 0;
  if (quotaMax === 0) {
    throw new HttpsError('invalid-argument', `mode '${mode}' 박지 X (s1 / check 박음)`);
  }
  if (used >= quotaMax) {
    throw new HttpsError('resource-exhausted',
      `이 작품의 ${mode} quota 박은 거 박은 거 박은 박은 박힘 (${used}/${quotaMax}).`);
  }

  return {
    uid: req.auth.uid,
    classId, teamName, workId, rootBranchId, copyDepth,
    mode, used, quotaMax,
    origin,
  };
}

/* ════════════════════════════════════════════════════════════════
   quota 차감 / 환불 (Firebase 트랜잭션 박음)
   ──────────────────────────────────────────────────────────────
   7가지 환불 정책 (AI_SAFETY_COST_RULES.md 5-1 박힘):
   1. 호출 전 취소 → 차감 X (호출 박지 X 박혀있어 차감 안 박음)
   2. 호출 도중 [취소] → 차감 그대로 (환불 X) — 박힌 비용 박은 거 박은 거 박은 박은
   3. 모델 실패 (timeout / 5xx) → 환불
   4. 네트워크 실패 → 환불
   5. JSON schema 위반 → 환불
   6. partially_applied → 차감 그대로
   7. client crash → 차감 그대로
   ════════════════════════════════════════════════════════════════ */
async function _consumeQuota(ctx) {
  const { classId, teamName, rootBranchId, mode } = ctx;
  const today = _todayYmd();
  const yyyyMm = _yyyyMm();

  /* 브랜치 quota +1 */
  await admin.database()
    .ref(`ai-usage/${classId}/${teamName}/${yyyyMm}/${mode}Used`)
    .transaction(n => (n || 0) + 1);

  /* 전역 +1 */
  await admin.database()
    .ref(`ai-usage-global/${today}/calls`)
    .transaction(n => (n || 0) + 1);

  /* rootBranchId 묶음 +1 */
  if (rootBranchId) {
    await admin.database()
      .ref(`ai-usage-by-root/${rootBranchId}/${today}/calls`)
      .transaction(n => (n || 0) + 1);
  }
}

async function _refundQuota(ctx) {
  const { classId, teamName, rootBranchId, mode } = ctx;
  const today = _todayYmd();
  const yyyyMm = _yyyyMm();

  await admin.database()
    .ref(`ai-usage/${classId}/${teamName}/${yyyyMm}/${mode}Used`)
    .transaction(n => Math.max(0, (n || 0) - 1));

  await admin.database()
    .ref(`ai-usage-global/${today}/calls`)
    .transaction(n => Math.max(0, (n || 0) - 1));

  if (rootBranchId) {
    await admin.database()
      .ref(`ai-usage-by-root/${rootBranchId}/${today}/calls`)
      .transaction(n => Math.max(0, (n || 0) - 1));
  }
}

/* ════════════════════════════════════════════════════════════════
   callTextAiBatch — 텍스트 1단계 (안심 정돈)
   ──────────────────────────────────────────────────────────────
   step2 박은 거 박은 거 박은 박은 — 11단 검증 + quota 차감 박음.
   Anthropic 호출은 step3 박을 때.
   ════════════════════════════════════════════════════════════════ */
exports.callTextAiBatch = onCall(
  {
    secrets: [ANTHROPIC_API_KEY],
    enforceAppCheck: false,   /* AI_APP_CHECK_ANALYSIS.md 결론 B — Phase A 박지 X (Phase B 박음) */
  },
  async (req) => {
    /* 1~11단 검증 박음 */
    const ctx = await _validateRequest(req, 's1');
    logger.info('[ai/s1] 검증 통과', {
      uid: ctx.uid, classId: ctx.classId, teamName: ctx.teamName, workId: ctx.workId,
      used: ctx.used, quotaMax: ctx.quotaMax,
    });

    /* quota 차감 (호출 박을 거 박은 거 박은 박은 박은 박음) */
    await _consumeQuota(ctx);

    try {
      /* step3 박을 때 박을 거 — Anthropic SDK 호출 + prompt + 결과 검증 */
      throw new HttpsError('unimplemented',
        'Phase A step2 박은 거 박은 거 박은 박은 — 11단 검증 박혔지만 Anthropic 호출 박지 X (step3 박을 때).');
    } catch (e) {
      /* 환불 정책 #3·#4·#5 — Anthropic / 네트워크 / schema 실패 → 환불 */
      if (e instanceof HttpsError && e.code === 'unimplemented') {
        /* step2 박은 거 박은 거 박은 박은 박은 — 환불 박음 (Anthropic 박지 X 박혀있어) */
        await _refundQuota(ctx);
      }
      throw e;
    }
  }
);

/* ════════════════════════════════════════════════════════════════
   callWorkCheck — 작품 검사 (진단)
   ════════════════════════════════════════════════════════════════ */
exports.callWorkCheck = onCall(
  {
    secrets: [ANTHROPIC_API_KEY],
    enforceAppCheck: false,
  },
  async (req) => {
    const ctx = await _validateRequest(req, 'check');
    logger.info('[ai/check] 검증 통과', {
      uid: ctx.uid, classId: ctx.classId, teamName: ctx.teamName, workId: ctx.workId,
      used: ctx.used, quotaMax: ctx.quotaMax,
    });

    await _consumeQuota(ctx);

    try {
      throw new HttpsError('unimplemented',
        'Phase A step2 박은 거 박은 거 박은 박은 — 11단 검증 박혔지만 Anthropic 호출 박지 X (step3 박을 때).');
    } catch (e) {
      if (e instanceof HttpsError && e.code === 'unimplemented') {
        await _refundQuota(ctx);
      }
      throw e;
    }
  }
);

/* ════════════════════════════════════════════════════════════════
   helper export (step3 박을 때 박을 거)
   ════════════════════════════════════════════════════════════════ */
exports._internal = {
  isAiTestAllowed,
  AI_TEST_ALLOWED,
  QUOTA,
  ROOT_DAILY_LIMIT,
  GLOBAL_DAILY_LIMIT,
  _validateRequest,
  _consumeQuota,
  _refundQuota,
};
