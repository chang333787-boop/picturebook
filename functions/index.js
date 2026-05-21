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
   1. Firebase auth (context.auth 박지 X 박혀있으면 거부)
   2. 임시 허용 목록 (AI_TEST_ALLOWED)
   3. aiPermission.enabled + allowedModes[mode]
   4. branchLineage.copyDepth <= 1
   5. testMode 거부 (실 API)
   6. 브랜치 quota
   7. rootBranchId 묶음 quota
   8. 전역 일일 / 월간 hard cap
   9. maxInstances: 5 (Functions invocation 폭주 박지 X)
   10. Origin 검증 (가지 도메인 박지 X 박혀있으면 거부)
   11. 일일 invocation 알람 (Cloud Logging — step3 박을 거)

   ⚠️ step1 박은 거 박은 거 박은 박은 — 골격만. 검증 / Anthropic 호출 박지 X
   step2 박을 거 박은 거 박은 박은 — 11단 검증 박음
   step3 박을 거 박은 거 박은 박은 — Anthropic SDK 호출 + 환불 정책
   ==================================================================== */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { setGlobalOptions } = require('firebase-functions/v2');
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
   callTextAiBatch — 텍스트 1단계 (안심 정돈)
   ──────────────────────────────────────────────────────────────
   step1 박은 거 박은 거 박은 박은 — 골격만.
   호출 박혀있으면 503 박음 — step3 박을 때까지 실제 호출 X.
   ════════════════════════════════════════════════════════════════ */
exports.callTextAiBatch = onCall(
  {
    secrets: [ANTHROPIC_API_KEY],
    enforceAppCheck: false,   /* AI_APP_CHECK_ANALYSIS.md 결론 B — Phase A 박지 X (Phase B 박음) */
  },
  async (req) => {
    /* step1 박은 거 박은 거 박은 박은 — 골격만. 검증 + Anthropic 호출 박지 X */
    throw new HttpsError(
      'unimplemented',
      'Phase A step1 박은 거 박은 거 박은 박은 — 검증 + Anthropic 호출 박지 X. step2~3 박을 때 박음.'
    );
  }
);

/* ════════════════════════════════════════════════════════════════
   callWorkCheck — 작품 검사 (진단)
   ──────────────────────────────────────────────────────────────
   step1 박은 거 박은 거 박은 박은 — 골격만.
   ════════════════════════════════════════════════════════════════ */
exports.callWorkCheck = onCall(
  {
    secrets: [ANTHROPIC_API_KEY],
    enforceAppCheck: false,
  },
  async (req) => {
    throw new HttpsError(
      'unimplemented',
      'Phase A step1 박은 거 박은 거 박은 박은 — 검증 + Anthropic 호출 박지 X. step2~3 박을 때 박음.'
    );
  }
);

/* ════════════════════════════════════════════════════════════════
   helper export (step2 박을 때 박을 거 박은 거 박은 박은)
   ════════════════════════════════════════════════════════════════ */
exports._internal = {
  isAiTestAllowed,    /* step2 검증 단에서 박을 거 */
  AI_TEST_ALLOWED,
};
