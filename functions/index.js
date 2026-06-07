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
   step2 ✓ 11단 검증 박음
   step3 ✓ Anthropic SDK + prompt + 응답 검증 박음 (지금)
   step4 ⏳ database.rules.json + viewer-ai.js Firebase Functions 호출
   ==================================================================== */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { setGlobalOptions } = require('firebase-functions/v2');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');
const { TEXT_S1_SYSTEM_PROMPT, TEXT_S2_SYSTEM_PROMPT, WORK_CHECK_SYSTEM_PROMPT, buildUserMessage } = require('./prompts');

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
  /* 실제 Firebase classId 박음 (사용자 친화 코드 JL26A → classCodes 박은 거 박은 거 박은 박은 매핑)
     viewer가 URL에 박은 classId 박은 거 박은 거 박은 박은 — Firebase 박은 거 박은 거 박은 박은 그대로 박음 (코드 변환 X) */
  { classId: 'class_2026_junglim_1', teamName: '0000' },
  { classId: 'class_2026_junglim_1', teamName: '은규' },
  { classId: 'class_2026_junglim_1', teamName: '예지유은인우' },
];

function isAiTestAllowed(classId, teamName) {
  return AI_TEST_ALLOWED.some(a => a.classId === classId && a.teamName === teamName);
}

/* ════════════════════════════════════════════════════════════════
   quota 박힌 거 박은 거 박은 박은 (AI_COST_GUARD_PLAN.md 2-3·2-4·2-8)
   ════════════════════════════════════════════════════════════════ */
const QUOTA = {
  s1: 3,         /* 1단계 — 브랜치당 후보 3회 */
  s2: 2,         /* 2단계 — 브랜치당 2회 (발전은 무겁고 신중) */
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

/* 본문 해시 — djb2 → 8자리 hex. Phase 3: aiVariant가 어떤 원본 body 기준으로 만들어졌는지 기록.
   클라가 보낸 값은 신뢰하지 않고, 서버가 원본 scenes/{sceneId}/body를 직접 읽어 재계산한다.
   stale 판정(현재 body 해시 ≠ 저장된 해시)은 Phase 4 — Phase 3은 저장만. */
function _bodyHash(str) {
  const s = String(str == null ? '' : str);
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;  /* h*33 + c, 32bit */
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/* ════════════════════════════════════════════════════════════════
   11단 검증 — 호출 진입 단 박음
   ──────────────────────────────────────────────────────────────
   각 박힌 단계 박지 X 박혀있으면 HttpsError throw.
   순서: 가벼운 검증 박은 거 박은 거 박은 박은 → 무거운 검증 (DB 박은 거 박은 거 박은 박은)
   ════════════════════════════════════════════════════════════════ */
async function _validateRequest(req, mode, opts) {
  /* opts.skipUsageLimits=true → 사용량 한도(전역/root/브랜치 quota) 검사를 건너뜀.
     saveTextVariant(저장 전용)는 AI를 호출하지 않으므로 quota 소진 후에도 저장 가능해야 함.
     권한 게이트(auth/testMode/허용목록/copyDepth/origin/killswitch/aiSettings)는 그대로 적용. */
  const skipUsageLimits = !!(opts && opts.skipUsageLimits);

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
  /* workId 박은 거 박은 거 박은 박은 — 가지 데이터 모델 박은 거 박은 거 박은 박은 — team 자체 박은 거 박은 거 박은 박은 한 작품. workId 박지 X 박혀있으면 teamName 박음. */
  const workIdEffective = workId || teamName;

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

  /* 3. 권한 게이트 (aiSettings 우선 / aiPermission fallback)
     박을 노드 박은 거 박은 거 박은 박은: classes/{classId}/teams/{teamName}/works/{workId}/aiPermission
     ⚠️ 실제 가지 박은 거 박은 거 박은 박은 박은 거 박은 거 박은 박은 — 박을 노드 위치 박은 거 박은 거 박은 박은 데이터 모델에 정합 박을 거.
     박은 거 박은 거 박은 박은 박은 거 박은 거 박은 박은 — Phase A 박을 때 박지 X 박혀있을 가능성 — 박지 X 박혀있으면 기본 ON 박음 (Phase A 테스트라).
     운영 박은 거 박은 거 박은 박은 — 박혀있어야 박을 거 (사용자가 박을 거 박은 거 박은 박은 maker.html에서 박을 거). */
  /* Phase 1 — 교사 AI 권한 게이트. 우선순위:
       (a) AI_TEST_ALLOWED 하드게이트 = 위(2번)에서 이미 통과해야 도달.
       (b) classes/{classId}/aiSettings 존재 → 진실. enabled + modes[modeKey].
       (c) aiSettings 없음 → 기존 teams/{teamName}/aiPermission fallback (동작 보존).
       (d) 둘 다 없음 → 기본 ON (Phase A 호환).
     모든 검사는 quota 차감(_consumeQuota, 핸들러) 전에 수행됨. */
  const MODE_KEY_MAP = { s1: 'textS1', s2: 'textS2', check: 'workCheck', imageS1: 'imageS1', imageS2: 'imageS2' };
  const aiSettingsSnap = await admin.database().ref(`classes/${classId}/aiSettings`).once('value');
  const aiSettings = aiSettingsSnap.val();
  if (aiSettings) {
    if (aiSettings.enabled !== true) {
      throw new HttpsError('permission-denied', 'AI_NOT_ENABLED_CLASS (선생님이 AI를 아직 열어주지 않았어요)');
    }
    const modeKey = MODE_KEY_MAP[mode] || mode;
    const modeAllowed = aiSettings.modes && aiSettings.modes[modeKey] === true;
    if (modeAllowed !== true) {
      throw new HttpsError('permission-denied', `MODE_NOT_ENABLED_CLASS (${mode}) — 선생님이 이 기능을 아직 열어주지 않았어요`);
    }
  } else {
    const permPath = `classes/${classId}/teams/${teamName}/aiPermission`;
    const permSnap = await admin.database().ref(permPath).once('value');
    const perm = permSnap.val();
    if (perm) {
      if (perm.enabled !== true) {
        throw new HttpsError('permission-denied', 'AI_NOT_ENABLED (교사가 AI 박지 X)');
      }
      const allowed = perm.allowedModes && perm.allowedModes[mode];
      if (allowed !== true) {
        throw new HttpsError('permission-denied', `MODE_NOT_ALLOWED (${mode})`);
      }
    } else {
      logger.info('[ai] aiSettings/aiPermission 박지 X — 기본 ON 박음', { classId, teamName });
    }
  }

  let used = 0;
  let quotaMax = 0;
  if (!skipUsageLimits) {
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
    used = usageSnap.val() || 0;
    quotaMax = QUOTA[mode] || 0;
    if (quotaMax === 0) {
      throw new HttpsError('invalid-argument', `mode '${mode}' 박지 X (s1 / check 박음)`);
    }
    if (used >= quotaMax) {
      throw new HttpsError('resource-exhausted',
        `이 작품의 ${mode} quota 박은 거 박은 거 박은 박은 박힘 (${used}/${quotaMax}).`);
    }
  }

  return {
    uid: req.auth.uid,
    classId, teamName, workId: workIdEffective, rootBranchId, copyDepth,
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
   Phase 2 — AI 호출 前 사전 검사
   (safety precheck + completion/structure quick check)
   ──────────────────────────────────────────────────────────────
   삽입 위치: 각 handler에서 snapshot empty check 직후, _consumeQuota(ctx) 직전.
   원칙:
   - block 이면 AI 호출 X + quota 차감 X (safety/quick 공통).
   - safety block만 safetyAttempt 기록 + 연속 3회 → 5분 cooldown.
   - quick-check block(INCOMPLETE/STRUCTURE)은 안내만 — cooldown 카운트 제외(작성 중 상태일 수 있음).
   - 문제 표현 원문은 응답에 넣지 않음 (sceneIds / categories 만 반환).
   - 정상 모험/싸움/죽음 서사는 과차단하지 않도록 패턴을 보수적으로 둠.
   - safety state(aiSafetyState/{classId}/{teamName}/{mode})는 admin SDK 전용.
     rules에 노출 X → 클라 직접 read/write 불가. database.rules.json 변경 없음.
   - block은 정상 응답 return 방식({ok:false,blocked:true,...}). HttpsError throw 아님.
   ════════════════════════════════════════════════════════════════ */
const SAFETY_MAX_CONSECUTIVE = 3;          /* 연속 block 3회 → 쿨다운 */
const SAFETY_COOLDOWN_MS = 5 * 60 * 1000;  /* 5분 */

/* 학생용 안내 문구 — 문제 표현 원문은 절대 포함하지 않음. */
const _PRECHECK_MSG = {
  SAFETY: 'AI가 다듬기 어려운 표현이 있어요. AI가 대신 고쳐주지는 않아요. 표현을 직접 바꾼 뒤 다시 시도해 주세요. (원본은 그대로 보호돼요)',
  INCOMPLETE_S1: '다듬을 본문이 있는 장면이 아직 없어요.',
  INCOMPLETE_S2: '장면이 2개 이상 있어야 AI가 장면을 발전시킬 수 있어요. 이야기를 조금 더 쓴 뒤 다시 시도해 주세요.',
  INCOMPLETE_CHECK: '검사할 본문이 아직 없어요.',
  STRUCTURE_S2: '선택지로 이어지는 다음 장면이나 엔딩이 아직 없어요. 이야기 흐름을 연결한 뒤 다시 시도해 주세요. (원본은 그대로 보호돼요)',
};

/* 보수적 패턴 — 1차. /g 플래그 금지(.test 상태 유지 버그 방지).
   "괴물과 싸웠다 / 도망쳤다 / 무서웠다 / 죽었다" 같은 일반 서사는 잡지 않음. */
const SAFETY_PATTERNS = {
  /* 욕설/비속어 — 명백한 것만. 단독 "새끼"는 제외(강아지 새끼 등 오탐 방지). */
  profanity: [
    /씨발|시발|씨bal|쌍놈|쌍년|개새끼|개자식|개놈|썅|좆|존나|병신|지랄|닥쳐|꺼져\s*죽|엿\s*먹어|니애미|니에미|fuck|f\*ck|bitch/i,
    /ㅅㅂ|ㅄ|ㅂㅅ|ㅈㄹ/,
  ],
  /* 성적/19금 */
  sexual: [
    /섹스|쎅스|성관계|야동|야애니|자위행위|성기|음경|자지|보지|발기|사정하|오르가즘|porn|성적\s*흥분/i,
  ],
  /* 실명+비난/괴롭힘 — 실명 추출 불가하므로 명백한 따돌림/괴롭힘 표현만 보수적으로. */
  harassment: [
    /왕따|따돌림|따돌려|괴롭혀|괴롭힐|괴롭히자|놀려서\s*울려|때려서\s*괴롭/,
  ],
  /* 개인정보 — 전화/주민번호/카드 형식 */
  personal_info: [
    /01[016789][-\s]?\d{3,4}[-\s]?\d{4}/,            /* 휴대폰 */
    /\b\d{6}[-\s]?[1-4]\d{6}\b/,                      /* 주민등록번호 형식 */
    /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/,     /* 카드번호 16자리 */
    /비밀번호\s*[:는은]?\s*\S+|password\s*[:=]/i,
  ],
  /* 자해/자살 조장 */
  self_harm: [
    /자살|자해|손목\s*긋|손목을?\s*그어|목\s*매달|목을\s*매|투신|죽는\s*방법|죽어\s*버리는\s*법/,
  ],
  /* 혐오/차별 — 명백한 비하/차별어만. */
  hate: [
    /짱깨|쪽바리|쪽발이|틀딱|급식충|맘충|한남충|김치녀|똥남아|병신새끼|장애인\s*주제/,
  ],
  /* 명백히 잔혹한 폭력(고어) — 일반 싸움/죽음은 제외, 신체훼손 묘사만. */
  gore: [
    /목을?\s*(잘라|베어|베고|썰어)|사지를?\s*찢|내장을?\s*꺼내|눈알을?\s*(파|뽑)|살점을?\s*도려|피가\s*솟구|피분수/,
  ],
  /* prompt injection */
  injection: [
    /이전\s*(지시|명령|프롬프트)\S*\s*(무시|잊)|지금부터\s*너는|너는\s*이제|시스템\s*프롬프트|역할을?\s*(무시|벗어)|ignore\s+(all\s+)?previous|system\s+prompt|disregard\s+(the\s+)?above|you\s+are\s+now/i,
  ],
};

/* snapshot 전체 스캔 → 카테고리/문제 sceneId 수집. 원문은 반환하지 않음. */
function _scanSafety(snapshot) {
  const cats = new Set();
  const sceneIds = new Set();
  Object.keys(snapshot || {}).forEach((sid) => {
    const sc = snapshot[sid] || {};
    const parts = [sc.body, sc.title];
    (sc.choices || []).forEach((c) => { if (c && c.label) parts.push(c.label); });
    const text = parts.filter(Boolean).join('\n');
    if (!text) return;
    Object.keys(SAFETY_PATTERNS).forEach((cat) => {
      const hit = SAFETY_PATTERNS[cat].some((re) => re.test(text));
      if (hit) { cats.add(cat); sceneIds.add(String(sid)); }
    });
  });
  return { blocked: cats.size > 0, categories: Array.from(cats), sceneIds: Array.from(sceneIds) };
}

/* completion / structure quick check — mode별 기준. snapshot은 이미 빈 본문 제외됨. */
function _quickCheck(snapshot, mode) {
  const ids = Object.keys(snapshot || {});
  const n = ids.length;

  if (mode === 's1') {
    /* 가장 관대 — 본문 1장면 이상이면 통과. 구조 검사 안 함. */
    if (n < 1) return { blocked: true, reasonCode: 'INCOMPLETE_WORK', sceneIds: [], message: _PRECHECK_MSG.INCOMPLETE_S1 };
    return { blocked: false };
  }

  if (mode === 's2') {
    if (n < 2) return { blocked: true, reasonCode: 'INCOMPLETE_WORK', sceneIds: [], message: _PRECHECK_MSG.INCOMPLETE_S2 };
    /* 흐름 검사: snapshot 안으로 이어지는 선택지(valid next)도, 엔딩도 하나도 없으면 차단.
       (둘 중 하나라도 있으면 통과 — 과차단 방지) */
    let hasValidNext = false;
    let hasEnding = false;
    const dangling = new Set();
    ids.forEach((sid) => {
      const sc = snapshot[sid] || {};
      if (sc.isEnding) hasEnding = true;
      (sc.choices || []).forEach((c) => {
        if (c && c.nextId) {
          if (snapshot[String(c.nextId)]) hasValidNext = true;
          else dangling.add(String(sid));
        }
      });
    });
    if (!hasValidNext && !hasEnding) {
      return { blocked: true, reasonCode: 'STRUCTURE_INCOMPLETE', sceneIds: Array.from(dangling), message: _PRECHECK_MSG.STRUCTURE_S2 };
    }
    return { blocked: false };
  }

  /* check — 진단이라 가장 관대. 본문 거의 없을 때만(=empty, 사실상 handler가 먼저 throw). */
  if (n < 1) return { blocked: true, reasonCode: 'INCOMPLETE_WORK', sceneIds: [], message: _PRECHECK_MSG.INCOMPLETE_CHECK };
  return { blocked: false };
}

/* safetyAttempt 기록 — 연속 block 카운트 + 3회시 쿨다운. admin SDK write(클라 접근 X). */
async function _recordSafetyBlock(stateRef, prevState, categories, sceneIds) {
  const now = Date.now();
  const consecutive = ((prevState && prevState.consecutiveBlocks) || 0) + 1;
  const update = {
    consecutiveBlocks: consecutive,
    lastBlockedAt: now,
    lastCategories: categories || [],
    lastSceneIds: sceneIds || [],
  };
  if (consecutive >= SAFETY_MAX_CONSECUTIVE) {
    update.blockedUntil = now + SAFETY_COOLDOWN_MS;
  }
  try {
    await stateRef.update(update);
  } catch (e) {
    logger.warn('[ai/precheck] safetyState 기록 실패(무시)', { error: e && e.message });
  }
  return consecutive;
}

/* 사전 검사 진입점 — block이면 {ok:false,blocked:true,...} 반환, 통과면 null.
   호출 위치: handler의 _consumeQuota(ctx) 직전. block 반환 시 handler가 즉시 return → quota 차감 X. */
async function _runAiPrecheck(ctx, snapshot, mode) {
  const { classId, teamName } = ctx;
  const stateRef = admin.database().ref(`aiSafetyState/${classId}/${teamName}/${mode}`);

  let state = {};
  try {
    const snap = await stateRef.once('value');
    state = snap.val() || {};
  } catch (e) {
    logger.warn('[ai/precheck] safetyState 읽기 실패(통과 처리)', { error: e && e.message });
    state = {};
  }

  const now = Date.now();

  /* 0. 쿨다운 — blockedUntil 동안 즉시 차단 (quota 차감 없음). */
  if (state.blockedUntil && state.blockedUntil > now) {
    const remainSec = Math.ceil((state.blockedUntil - now) / 1000);
    const remainMin = Math.max(1, Math.ceil(remainSec / 60));
    return {
      ok: false, blocked: true, reasonCode: 'SAFETY_COOLDOWN',
      categories: state.lastCategories || [], sceneIds: [],
      cooldownRemainSec: remainSec,
      message: `잠깐 쉬어가요. 약 ${remainMin}분 뒤에 다시 시도할 수 있어요.`,
    };
  }

  /* 1. safety precheck */
  const safety = _scanSafety(snapshot);
  if (safety.blocked) {
    const consecutive = await _recordSafetyBlock(stateRef, state, safety.categories, safety.sceneIds);
    const out = {
      ok: false, blocked: true, reasonCode: 'SAFETY_BLOCKED',
      categories: safety.categories, sceneIds: safety.sceneIds,
      message: _PRECHECK_MSG.SAFETY,
    };
    if (consecutive >= SAFETY_MAX_CONSECUTIVE) out.cooldownRemainSec = Math.ceil(SAFETY_COOLDOWN_MS / 1000);
    return out;
  }

  /* 2. completion / structure quick check
     ── quick-check block은 cooldown 카운트에서 제외한다(확정 정책).
        이유: 본문 부족/구조 미완성은 학생이 아직 작성 중인 자연스러운 상태일 수 있어
              5분 잠금은 과함. quota 차감 없이 안내만. consecutiveBlocks 증감/cooldown 일절 X.
        (남용 우려가 있는 safety block만 cooldown 대상.) safety 카운터는 건드리지 않음. */
  const quick = _quickCheck(snapshot, mode);
  if (quick.blocked) {
    return {
      ok: false, blocked: true, reasonCode: quick.reasonCode,
      categories: [], sceneIds: quick.sceneIds || [],
      message: quick.message,
    };
  }

  /* 3. 통과 — safety 연속 block 카운터/쿨다운 리셋. */
  if (state.consecutiveBlocks || state.blockedUntil) {
    try { await stateRef.update({ consecutiveBlocks: 0, blockedUntil: 0, lastResetAt: now }); }
    catch (e) { logger.warn('[ai/precheck] reset 실패(무시)', { error: e && e.message }); }
  }
  return null;
}

/* ════════════════════════════════════════════════════════════════
   Anthropic SDK 호출 (Haiku)
   ──────────────────────────────────────────────────────────────
   사용 모델: claude-haiku-4-5 (Phase A — 가격·속도 최적)
   max_tokens: 8000 (AI_COST_GUARD_PLAN.md 2-2-1 박힘)
   ════════════════════════════════════════════════════════════════ */
const HAIKU_MODEL = 'claude-haiku-4-5';
/* 텍스트 2단계 전용 모델 — 기본은 Haiku로 선테스트. 품질/원작보존이 부족하면 이 한 줄만
   Sonnet으로 승격(예: const S2_MODEL = 'claude-sonnet-4-5';). s1/작품검사는 Haiku 그대로. */
const S2_MODEL = HAIKU_MODEL;
const MAX_TOKENS = 8000;
const ANTHROPIC_TIMEOUT_MS = 50000;  /* Functions timeout 60s 박힘 — 여유 10s */

async function _callAnthropic(apiKey, systemPrompt, userMessage, model) {
  const client = new Anthropic({ apiKey, timeout: ANTHROPIC_TIMEOUT_MS });

  const response = await client.messages.create({
    model: model || HAIKU_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userMessage }
    ],
  });

  /* 응답 박은 거 박은 거 박은 박은 text 박음 */
  const textBlock = (response.content || []).find(b => b.type === 'text');
  if (!textBlock || !textBlock.text) {
    throw new Error('Anthropic 응답 박지 X — text block 박지 X');
  }

  const usage = response.usage || {};
  return {
    text: textBlock.text,
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    stopReason: response.stop_reason || 'unknown',
  };
}

/* ════════════════════════════════════════════════════════════════
   JSON 파싱 + 검증 (1단계)
   ──────────────────────────────────────────────────────────────
   prompts/text-strength-1.md v3 박힌 규칙:
   - safeAddition / creativeAddition 박혀있으면 자동 거부 (1단계 위반)
   - revisedText 또는 skip union 박혀야
   - 글자수 hard cut (분할형 500 / 그림 중심형 300)
   - 한글 비율 70% 미만 거부
   ════════════════════════════════════════════════════════════════ */
function _parseJsonStrict(text) {
  /* 응답이 ```json ... ``` 코드펜스로 감싸여 올 가능성 — 펜스 우선 제거 */
  let s = String(text).trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  /* 1) 정상 경로: 깨끗한 JSON은 그대로 파싱한다 (s1/check 기존 동작 보존). */
  try {
    return JSON.parse(s);
  } catch (e) {
    /* 2) 모델이 JSON object 뒤에 설명/거절 문장을 덧붙인 경우(부적절 표현 s2 경로 등):
          문자열 리터럴/escape를 고려해 첫 번째 균형 잡힌 JSON object만 추출해 재시도.
          object 자체가 깨졌으면 추출이 null이거나 재파싱이 다시 throw → 기존처럼 실패. */
    const extracted = _extractFirstJsonObject(s);
    if (extracted === null) throw e;
    return JSON.parse(extracted);
  }
}

/* 첫 '{' 부터 문자열/escape를 고려해 균형 잡힌 '}' 까지 추출. 균형이 안 맞으면 null. */
function _extractFirstJsonObject(s) {
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function _hangulRatio(s) {
  const str = String(s || '');
  if (str.length === 0) return 1;
  const hangul = (str.match(/[가-힣]/g) || []).length;
  /* 공백·문장부호 박지 X 박은 거 박은 거 박은 박은 박은 (영문·숫자만 검사) */
  const text = (str.match(/[가-힣a-zA-Z0-9]/g) || []).length;
  if (text === 0) return 1;
  return hangul / text;
}

/* sceneId 정규화 — Anthropic이 'scene_1' 박혀있을 때 '1'로 박음. 존재하지 않는 sceneId 제거. */
function _normalizeResults(results, snapshot) {
  if (!results || typeof results !== 'object') return {};
  const validIds = new Set(Object.keys(snapshot || {}));
  const normalized = {};
  const dropped = [];
  for (const rawKey of Object.keys(results)) {
    let key = String(rawKey);
    /* scene_, scene-, scene 박은 접두사 박지 X */
    if (/^scene[_\-]?(\d+)$/i.test(key)) {
      key = key.replace(/^scene[_\-]?/i, '');
    }
    if (validIds.has(key)) {
      normalized[key] = results[rawKey];
    } else {
      dropped.push(rawKey);
    }
  }
  if (dropped.length > 0) {
    logger.warn('[ai/normalize] sceneId 박지 X 박혀있는 결과 제거', { dropped, validIds: Array.from(validIds) });
  }
  return normalized;
}

/* ════════════════════════════════════════════════════════════════
   검증 보강 helper — 2026-05-22 추가
   ────────────────────────────────────────────────────────────────
   정책:
   - 변경 없음 자동 skip 변환
   - skip + revisedText 동시 → skip 우선
   - preservedCheck false → appliable=false / 누락 → weak warning + 통과
   - 금지 필드 recursive scan → 장면 단위 appliable=false
   - 글자수 비율 weak / strong 단계 분리
   - strong warning 모이면 r.appliable=false
   ════════════════════════════════════════════════════════════════ */

/* 변경 없음 비교용 정규화 — 정말로 실질 변경이 없을 때만 같다고 판정.
   - 양 끝 공백 제거
   - 비표준 공백(nbsp, zero-width) → 일반 공백
   - CRLF → LF
   유지: 마침표 뒤 공백 정리, 연속 공백 정리 같은 실제 변화는 변경으로 인정한다. */
function _normalizeForCompare(s) {
  return String(s == null ? '' : s)
    .replace(/[ ​]/g, ' ')
    .replace(/\r\n/g, '\n')
    .trim();
}

/* 금지 키 목록 — recursive scan용 (정책 #4) */
const BANNED_KEYS = new Set([
  'buttons', 'choices', 'choiceA', 'choiceB', 'choiceCount',
  'nextA', 'nextB', 'nextId',
  'storyTone', 'pbCardTone', 'pbEndingTone',
  'textCardStyle', 'textCardColor',
  'coverTheme', 'subtitle', 'kicker', 'title',
  'safeAddition', 'creativeAddition',
]);

/* result item 객체 안에서 금지 키를 재귀적으로 찾아 첫 발견 경로 반환.
   - 키 이름 기준으로만 검사 (문자열 값에 "choices" 같은 단어가 포함돼도 금지 아님)
   - 발견 시 'a.b.choices' 같은 점 경로 반환, 없으면 null */
function _findBannedKey(obj, pathPrefix) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const child = _findBannedKey(obj[i], `${pathPrefix}[${i}]`);
      if (child) return child;
    }
    return null;
  }
  for (const k of Object.keys(obj)) {
    if (BANNED_KEYS.has(k)) {
      return pathPrefix ? `${pathPrefix}.${k}` : k;
    }
    const v = obj[k];
    if (v && typeof v === 'object') {
      const child = _findBannedKey(v, pathPrefix ? `${pathPrefix}.${k}` : k);
      if (child) return child;
    }
  }
  return null;
}

/* preservedCheck 7개 boolean 항목 — functions/prompts.js v3 schema 정합 (line 180~217) */
const PRESERVED_CHECK_KEYS = [
  'charactersUnchanged',
  'plotPointsUnchanged',
  'choiceMeaningsUnchanged',
  'endingDirectionUnchanged',
  'branchStructureUnchanged',
  'sceneRoleUnchanged',
  'studentToneUnchanged',
];

/* preservedCheck 검사 (정책 #3).
   - { present:false } — 객체 자체가 없거나 object가 아님 → 누락(weak warning + 통과)
   - { present:true, failed:[...] } — failed 비면 통과, 하나라도 false면 appliable=false */
function _checkPreserved(preservedCheck) {
  if (!preservedCheck || typeof preservedCheck !== 'object') {
    return { present: false, failed: [] };
  }
  const failed = [];
  for (const k of PRESERVED_CHECK_KEYS) {
    if (k in preservedCheck && preservedCheck[k] === false) {
      failed.push(k);
    }
  }
  return { present: true, failed };
}

/* 글자수 비율 검사 (정책 #5).
   반환: { strong?:true, weak?:true, reason?:string } — 둘 다 없으면 정상. */
function _checkLengthRatio(origLen, revisedLen) {
  if (origLen < 20) {
    /* 원문 20자 미만 — 절대 증가량 기준 */
    const diff = revisedLen - origLen;
    if (diff > 60) return { strong: true, reason: `원문 짧음(${origLen}자) — 증가량 ${diff}자 (60자 초과)` };
    if (diff > 30) return { weak: true, reason: `원문 짧음(${origLen}자) — 증가량 ${diff}자 (30자 초과)` };
    return {};
  }
  /* 원문 20자 이상 — 비율 기준 */
  const ratio = revisedLen / origLen;
  if (ratio > 1.5) return { strong: true, reason: `글자수 비율 ${ratio.toFixed(2)}배 (1.5배 초과)` };
  if (ratio > 1.4) return { weak: true, reason: `글자수 비율 ${ratio.toFixed(2)}배 (1.4배 초과)` };
  if (ratio < 0.7) return { weak: true, reason: `글자수 비율 ${ratio.toFixed(2)}배 (0.7배 미만)` };
  return {};
}

/* ════════════════════════════════════════════════════════════════
   _validateS1Response — 1단계 응답 검증 + 후처리
   ──────────────────────────────────────────────────────────────
   원본 body는 절대 변경하지 않는다. 응답 객체만 수정한다.
   전체 throw 조건은 최상위 구조가 깨진 경우와 hard cut/한글 비율 위반만 유지.
   나머지 안전 검사는 모두 장면 단위 appliable=false 로 변경.
   ════════════════════════════════════════════════════════════════ */
function _validateS1Response(parsed, snapshot) {
  /* ─── 응답 최상위 구조 검증 (깨지면 전체 거부) ─── */
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 박지 X — object 박지 X');
  }
  if (parsed.strength !== 1) {
    throw new Error(`strength 박지 X (${parsed.strength})`);
  }
  if (!parsed.results || typeof parsed.results !== 'object') {
    throw new Error('results 박지 X');
  }
  /* sceneId 정규화 — 'scene_1' → '1', 존재하지 않는 sceneId 제거 */
  parsed.results = _normalizeResults(parsed.results, snapshot);
  if (Object.keys(parsed.results).length === 0) {
    throw new Error('정규화 후 results 박지 X (모든 sceneId 박은 거 박은 거 박은 박은 유효하지 X)');
  }

  const sceneMap = snapshot || {};

  for (const sceneId of Object.keys(parsed.results)) {
    const r = parsed.results[sceneId];
    if (!r || typeof r !== 'object') continue;

    /* 누적 buffer — 정책 #6: strong 4가지 흐름 모이면 r.appliable=false */
    const strongWarnings = Array.isArray(r.strongWarnings) ? r.strongWarnings.slice() : [];
    const weakWarnings = Array.isArray(r.weakWarnings) ? r.weakWarnings.slice() : [];

    /* Claude가 r.warnings 배열에 직접 넣은 경고가 있으면 분류 누적 */
    if (Array.isArray(r.warnings)) {
      for (const w of r.warnings) {
        if (!w) continue;
        const isStrong = (w.severity === 'strong') || (w.level === 'strong') ||
                         (typeof w === 'string' && /강한|strong/i.test(w));
        if (isStrong) {
          strongWarnings.push(w);
        } else {
          weakWarnings.push(w);
        }
      }
    }

    /* ─── 정책 #2: skip + revisedText 동시 → skip 우선 ─── */
    if (r.skip === true) {
      delete r.revisedText;
      delete r.summary;
      delete r.changes;
      if (strongWarnings.length > 0) r.strongWarnings = strongWarnings;
      if (weakWarnings.length > 0) r.weakWarnings = weakWarnings;
      continue;
    }

    /* skip 아니고 revisedText도 비어있으면 응답 자체가 부족 — 기존 throw 유지 */
    if (typeof r.revisedText !== 'string' || r.revisedText.trim().length === 0) {
      throw new Error(`장면 ${sceneId} — revisedText 박지 X`);
    }

    /* origBody — sceneMap의 body 또는 text 필드 사용 (snapshot 구조 양쪽 호환) */
    const origScene = sceneMap[sceneId] || {};
    const origBody = typeof origScene.body === 'string'
      ? origScene.body
      : (typeof origScene.text === 'string' ? origScene.text : '');
    const revised = r.revisedText;

    /* ─── 정책 #1: 변경 없음 자동 skip 변환 ─── */
    if (_normalizeForCompare(origBody) === _normalizeForCompare(revised)) {
      r.skip = true;
      r.reason = '실제 변경이 없어 원본을 유지합니다.';
      delete r.revisedText;
      delete r.summary;
      delete r.changes;
      if (strongWarnings.length > 0) r.strongWarnings = strongWarnings;
      if (weakWarnings.length > 0) r.weakWarnings = weakWarnings;
      continue;
    }

    /* ─── 글자수 hard cut (사용자 명시 — 기존 유지, 전체 throw) ─── */
    const submode = origScene.submode === 'imageCenter' ? 'imageCenter' : 'split';
    const maxLen = submode === 'imageCenter' ? 300 : 500;
    if (revised.length > maxLen) {
      throw new Error(`장면 ${sceneId} — 글자수 hard cut 초과 (${revised.length}/${maxLen}, ${submode})`);
    }

    /* ─── 한글 비율 70% 미만 (기존 유지, 전체 throw) ─── */
    if (_hangulRatio(revised) < 0.7) {
      throw new Error(`장면 ${sceneId} — 한글 비율 70% 미만`);
    }

    /* ─── 정책 #4: 금지 필드 recursive scan (장면 단위) ─── */
    const bannedPath = _findBannedKey(r, '');
    if (bannedPath) {
      r.bannedFieldPath = bannedPath;
      strongWarnings.push({
        severity: 'strong',
        code: 'BANNED_FIELD',
        message: `금지 필드 발견: ${bannedPath}`,
      });
      logger.warn('[ai/s1] 금지 필드 — 적용 제외', { sceneId, bannedPath });
    }

    /* ─── 정책 #5: 글자수 비율 (weak / strong) ─── */
    const lenRes = _checkLengthRatio(origBody.length, revised.length);
    if (lenRes.strong) {
      strongWarnings.push({ severity: 'strong', code: 'LEN_RATIO', message: lenRes.reason });
    } else if (lenRes.weak) {
      weakWarnings.push({ severity: 'weak', code: 'LEN_RATIO', message: lenRes.reason });
    }

    /* ─── 정책 #3: preservedCheck (있고 false면 strong / 누락이면 weak + 통과) ─── */
    const pc = _checkPreserved(r.preservedCheck);
    if (!pc.present) {
      weakWarnings.push({
        severity: 'weak',
        code: 'PRESERVED_CHECK_MISSING',
        message: 'preservedCheck 누락 — 통과 처리',
      });
    } else if (pc.failed.length > 0) {
      r.preservedCheckFailed = pc.failed;
      for (const k of pc.failed) {
        strongWarnings.push({
          severity: 'strong',
          code: 'PRESERVED_CHECK_FALSE',
          message: `preservedCheck.${k} = false`,
        });
      }
    }

    /* ─── 정책 #6: 누적 결과 반영 ─── */
    if (strongWarnings.length > 0) {
      r.appliable = false;
      r.strongWarnings = strongWarnings;
    }
    if (weakWarnings.length > 0) {
      r.weakWarnings = weakWarnings;
    }
  }

  return parsed;
}

function _validateWorkCheckResponse(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 박지 X — object 박지 X');
  }
  if (!parsed.categories || typeof parsed.categories !== 'object') {
    throw new Error('categories 박지 X');
  }
  /* 본문 수정 결과 박혀있으면 거부 (검사 위반) */
  const cats = parsed.categories;
  for (const catKey of Object.keys(cats)) {
    const items = cats[catKey];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (item && (item.revisedText || (item.suggested && item.suggested.body))) {
        throw new Error('작품 검사 위반 — revisedText / suggested.body 박혀있음 (수정 X)');
      }
    }
  }
  return parsed;
}

/* ════════════════════════════════════════════════════════════════
   텍스트 2단계 검증 helper (s1 공유 helper 재사용 + s2 전용 추가)
   ════════════════════════════════════════════════════════════════ */
/* s2 글자수 hard cut (발전이므로 s1보다 큼). 초과 시 전체 throw(환불). */
const S2_MAXLEN = { split: 700, imageCenter: 350 };

/* s2 글자수 비율 — 발전이므로 확장 허용, 폭주만 차단. 원문 20자 미만은 절대 증가량 기준. */
function _checkLengthRatioS2(origLen, revisedLen) {
  if (origLen < 20) {
    const diff = revisedLen - origLen;
    if (diff > 220) return { strong: true, reason: `원문 짧음(${origLen}자) — 증가량 ${diff}자 (220자 초과)` };
    if (diff > 160) return { weak: true, reason: `원문 짧음(${origLen}자) — 증가량 ${diff}자 (160자 초과)` };
    return {};
  }
  const ratio = revisedLen / origLen;
  if (ratio > 3.0) return { strong: true, reason: `글자수 비율 ${ratio.toFixed(2)}배 (3.0배 초과 — 재창작 위험)` };
  if (ratio > 2.5) return { weak: true, reason: `글자수 비율 ${ratio.toFixed(2)}배 (2.5배 초과)` };
  if (ratio < 0.8) return { weak: true, reason: `글자수 비율 ${ratio.toFixed(2)}배 (0.8배 미만 — 발전인데 줄었음)` };
  return {};
}

/* 원작에 없는 큰 설정 키워드 — revised에 새로 등장(원문에 없던 것)하면 strong(발전 범위 초과). */
const S2_BIG_SETTING_WORDS = [
  '마법', '마법사', '마법학교', '마법왕국', '전학생', '악당', '비밀조직', '비밀결사',
  '우주', '외계', '드래곤', '전설의 용사', '용사', '왕자', '공주', '로봇',
  '괴물', '몬스터', '좀비', '뱀파이어', '유령', '귀신', '초능력', '변신', '시간여행',
];
function _findAddedBigSetting(origBody, revised) {
  const orig = String(origBody || '');
  const rev = String(revised || '');
  for (const w of S2_BIG_SETTING_WORDS) {
    if (rev.includes(w) && !orig.includes(w)) return w;
  }
  return null;
}

/* ════════════════════════════════════════════════════════════════
   _validateS2Response — 텍스트 2단계 응답 검증 + 후처리
   원본 body는 절대 변경하지 않는다(응답 객체만 수정).
   전체 throw: 최상위 구조 깨짐 / hard cut / 한글 비율.
   장면 단위 appliable=false: 보존 false·금지필드·큰설정·길이폭주.
   ════════════════════════════════════════════════════════════════ */
function _validateS2Response(parsed, snapshot) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 박지 X — object 박지 X');
  }
  if (parsed.strength !== 2) {
    throw new Error(`strength 박지 X (${parsed.strength})`);
  }
  if (!parsed.results || typeof parsed.results !== 'object') {
    throw new Error('results 박지 X');
  }
  parsed.results = _normalizeResults(parsed.results, snapshot);
  if (Object.keys(parsed.results).length === 0) {
    throw new Error('정규화 후 results 박지 X');
  }

  const sceneMap = snapshot || {};

  /* 정책 #2 보강: 큰 설정 키워드는 "현재 장면 본문"이 아니라 "작품 전체 원문" 기준으로 판단한다.
     (장면1에 이미 마법사가 있으면 장면2 발전문의 "마법사"는 자연스러운 이어짐이라 허용해야 함) */
  const workText = Object.values(sceneMap)
    .map((s) => (s && (typeof s.body === 'string' ? s.body : (typeof s.text === 'string' ? s.text : ''))) || '')
    .join('\n');

  for (const sceneId of Object.keys(parsed.results)) {
    const r = parsed.results[sceneId];
    if (!r || typeof r !== 'object') continue;

    const strongWarnings = Array.isArray(r.strongWarnings) ? r.strongWarnings.slice() : [];
    const weakWarnings = Array.isArray(r.weakWarnings) ? r.weakWarnings.slice() : [];

    if (Array.isArray(r.warnings)) {
      for (const w of r.warnings) {
        if (!w) continue;
        const isStrong = (w.severity === 'strong') || (w.level === 'strong') ||
                         (typeof w === 'string' && /강한|strong/i.test(w));
        if (isStrong) strongWarnings.push(w); else weakWarnings.push(w);
      }
    }

    if (r.skip === true) {
      delete r.revisedText; delete r.summary; delete r.changes;
      if (strongWarnings.length > 0) r.strongWarnings = strongWarnings;
      if (weakWarnings.length > 0) r.weakWarnings = weakWarnings;
      continue;
    }

    /* 부적절 표현(INAPPROPRIATE/SAFETY): prompts.js 부적절 처리 원칙에 따라 모델은
       해당 장면을 발전시키지 않고 revisedText 없이 strong 경고만 반환한다.
       전체 batch throw 대신 이 장면만 appliable=false로 차단하고 정상 장면은 계속 처리한다.
       (revisedText가 함께 온 경우는 아래 일반 경로에서 strong → appliable=false로 처리됨) */
    const hasInappropriate = strongWarnings.some((w) =>
      (w && (w.code === 'INAPPROPRIATE' || w.code === 'SAFETY')) ||
      (typeof w === 'string' && /INAPPROPRIATE|SAFETY/i.test(w)));
    if (hasInappropriate && (typeof r.revisedText !== 'string' || r.revisedText.trim().length === 0)) {
      r.appliable = false;
      r.strongWarnings = strongWarnings;
      if (weakWarnings.length > 0) r.weakWarnings = weakWarnings;
      delete r.revisedText; delete r.summary; delete r.changes;
      continue;
    }

    if (typeof r.revisedText !== 'string' || r.revisedText.trim().length === 0) {
      throw new Error(`장면 ${sceneId} — revisedText 박지 X`);
    }

    const origScene = sceneMap[sceneId] || {};
    const origBody = typeof origScene.body === 'string'
      ? origScene.body
      : (typeof origScene.text === 'string' ? origScene.text : '');
    const revised = r.revisedText;

    /* 변경 없음 → skip 변환 */
    if (_normalizeForCompare(origBody) === _normalizeForCompare(revised)) {
      r.skip = true;
      r.reason = '실제 변경이 없어 원본을 유지합니다.';
      delete r.revisedText; delete r.summary; delete r.changes;
      if (strongWarnings.length > 0) r.strongWarnings = strongWarnings;
      if (weakWarnings.length > 0) r.weakWarnings = weakWarnings;
      continue;
    }

    /* hard cut (전체 throw) */
    const submode = origScene.submode === 'imageCenter' ? 'imageCenter' : 'split';
    const maxLen = S2_MAXLEN[submode];
    if (revised.length > maxLen) {
      throw new Error(`장면 ${sceneId} — 글자수 hard cut 초과 (${revised.length}/${maxLen}, ${submode})`);
    }

    /* 한글 비율 (전체 throw) */
    if (_hangulRatio(revised) < 0.7) {
      throw new Error(`장면 ${sceneId} — 한글 비율 70% 미만`);
    }

    /* 금지 필드 scan → 장면 단위 차단 */
    const bannedPath = _findBannedKey(r, '');
    if (bannedPath) {
      r.bannedFieldPath = bannedPath;
      strongWarnings.push({ severity: 'strong', code: 'BANNED_FIELD', message: `금지 필드 발견: ${bannedPath}` });
    }

    /* 큰 설정 키워드(작품 전체 원문에 없던 것) → strong (정책 #2: 현재 장면이 아닌 작품 전체 기준) */
    const bigSetting = _findAddedBigSetting(workText, revised);
    if (bigSetting) {
      strongWarnings.push({ severity: 'strong', code: 'BIG_SETTING_ADDED', message: `원작에 없는 큰 설정 추가 의심: "${bigSetting}"` });
    }

    /* 글자수 비율 (s2) */
    const lenRes = _checkLengthRatioS2(origBody.length, revised.length);
    if (lenRes.strong) strongWarnings.push({ severity: 'strong', code: 'LEN_RATIO', message: lenRes.reason });
    else if (lenRes.weak) weakWarnings.push({ severity: 'weak', code: 'LEN_RATIO', message: lenRes.reason });

    /* preservedCheck (s2 강화 — 정책 #1: false → strong / 누락도 → strong + 적용 차단)
       2단계는 내용 추가가 허용되는 기능이라 preservedCheck가 핵심 안전장치다.
       누락을 통과시키면 위험하므로, 누락이면 원본 보호를 위해 적용을 차단한다.
       ※ 공유 헬퍼 _checkPreserved와 s1 경로(weak 통과)는 그대로 두고, s2 함수 안에서만 강화. */
    const pc = _checkPreserved(r.preservedCheck);
    if (!pc.present) {
      r.preservedCheckMissing = true;
      strongWarnings.push({ severity: 'strong', code: 'PRESERVED_CHECK_MISSING', message: '2단계 보존 검사 결과가 없어 원본 보호를 위해 적용하지 않음' });
    } else if (pc.failed.length > 0) {
      r.preservedCheckFailed = pc.failed;
      for (const k of pc.failed) {
        strongWarnings.push({ severity: 'strong', code: 'PRESERVED_CHECK_FALSE', message: `preservedCheck.${k} = false` });
      }
    }

    /* 누적 반영 — strong 있으면 적용 차단 */
    if (strongWarnings.length > 0) {
      r.appliable = false;
      r.strongWarnings = strongWarnings;
    }
    if (weakWarnings.length > 0) r.weakWarnings = weakWarnings;
  }

  return parsed;
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

    /* snapshot 박지 X 박혀있으면 거부 */
    const snapshot = (req.data && req.data.snapshot) || {};
    if (!snapshot || Object.keys(snapshot).length === 0) {
      throw new HttpsError('invalid-argument', 'snapshot 박지 X (본문 박은 장면 X)');
    }

    logger.info('[ai/s1] 검증 통과', {
      uid: ctx.uid, classId: ctx.classId, teamName: ctx.teamName, workId: ctx.workId,
      used: ctx.used, quotaMax: ctx.quotaMax, sceneCount: Object.keys(snapshot).length,
    });

    /* Phase 2 — safety precheck + completion/structure quick check (quota 차감 前, AI 호출 前) */
    const precheck = await _runAiPrecheck(ctx, snapshot, 's1');
    if (precheck && precheck.blocked) {
      logger.info('[ai/s1] precheck 차단', { reasonCode: precheck.reasonCode, categories: precheck.categories, sceneIds: precheck.sceneIds });
      return precheck;
    }

    /* quota 차감 (호출 박은 거 박은 거 박은 박은) */
    await _consumeQuota(ctx);

    try {
      /* Anthropic 호출 */
      const userMsg = buildUserMessage(snapshot, 's1');
      const ai = await _callAnthropic(ANTHROPIC_API_KEY.value(), TEXT_S1_SYSTEM_PROMPT, userMsg);

      logger.info('[ai/s1] Anthropic 응답 박힘', {
        inputTokens: ai.inputTokens, outputTokens: ai.outputTokens, stopReason: ai.stopReason,
      });

      /* JSON 파싱 + 검증 */
      let parsed;
      try {
        parsed = _parseJsonStrict(ai.text);
        _validateS1Response(parsed, snapshot);
      } catch (parseErr) {
        /* 환불 정책 #5 — schema 위반 → 환불 */
        await _refundQuota(ctx);
        logger.error('[ai/s1] schema 위반 — 환불 박음', { error: parseErr.message, text: ai.text.slice(0, 500) });
        throw new HttpsError('internal', 'AI 응답 검증 실패: ' + parseErr.message);
      }

      /* 비용 추정 + stats 박음 */
      const cost = _estimateCostUsd(ai.inputTokens, ai.outputTokens);
      _logUsageStats(ctx, ai, cost).catch(e => logger.warn('stats 박지 X', e));

      return {
        ...parsed,
        meta: {
          model: HAIKU_MODEL,
          inputTokens: ai.inputTokens,
          outputTokens: ai.outputTokens,
          estimatedCostUsd: cost,
          phase: 'phase-a',
        },
      };

    } catch (e) {
      /* HttpsError 박은 거 박은 거 박은 박은 그대로 throw */
      if (e instanceof HttpsError) throw e;

      /* 환불 정책 #3·#4 — Anthropic / 네트워크 실패 → 환불 */
      await _refundQuota(ctx);
      logger.error('[ai/s1] 호출 실패 — 환불 박음', { error: e.message, stack: e.stack });
      throw new HttpsError('internal', 'AI 호출 실패: ' + (e.message || String(e)));
    }
  }
);

/* ════════════════════════════════════════════════════════════════
   callTextAiBatchS2 — 텍스트 2단계 (장면 발전)
   s1과 공유 헬퍼(_validateRequest/_consumeQuota/_refundQuota/_callAnthropic/_parseJsonStrict/
   _estimateCostUsd/_logUsageStats) 재사용. prompt=TEXT_S2_SYSTEM_PROMPT, 모델=S2_MODEL(기본 Haiku),
   검증=_validateS2Response. 기존 callTextAiBatch/callWorkCheck는 불변.
   ════════════════════════════════════════════════════════════════ */
exports.callTextAiBatchS2 = onCall(
  {
    secrets: [ANTHROPIC_API_KEY],
    enforceAppCheck: false,
  },
  async (req) => {
    const ctx = await _validateRequest(req, 's2');

    const snapshot = (req.data && req.data.snapshot) || {};
    if (!snapshot || Object.keys(snapshot).length === 0) {
      throw new HttpsError('invalid-argument', 'snapshot 박지 X (본문 박은 장면 X)');
    }

    logger.info('[ai/s2] 검증 통과', {
      uid: ctx.uid, classId: ctx.classId, teamName: ctx.teamName, workId: ctx.workId,
      used: ctx.used, quotaMax: ctx.quotaMax, sceneCount: Object.keys(snapshot).length,
    });

    /* Phase 2 — safety precheck + completion/structure quick check (quota 차감 前, AI 호출 前) */
    const precheck = await _runAiPrecheck(ctx, snapshot, 's2');
    if (precheck && precheck.blocked) {
      logger.info('[ai/s2] precheck 차단', { reasonCode: precheck.reasonCode, categories: precheck.categories, sceneIds: precheck.sceneIds });
      return precheck;
    }

    await _consumeQuota(ctx);

    try {
      const userMsg = buildUserMessage(snapshot, 's2');
      const ai = await _callAnthropic(ANTHROPIC_API_KEY.value(), TEXT_S2_SYSTEM_PROMPT, userMsg, S2_MODEL);

      logger.info('[ai/s2] Anthropic 응답 박힘', {
        model: S2_MODEL, inputTokens: ai.inputTokens, outputTokens: ai.outputTokens, stopReason: ai.stopReason,
      });

      let parsed;
      try {
        parsed = _parseJsonStrict(ai.text);
        _validateS2Response(parsed, snapshot);
      } catch (parseErr) {
        await _refundQuota(ctx);
        logger.error('[ai/s2] schema 위반 — 환불 박음', { error: parseErr.message, text: ai.text.slice(0, 500) });
        throw new HttpsError('internal', 'AI 응답 검증 실패: ' + parseErr.message);
      }

      const cost = _estimateCostUsd(ai.inputTokens, ai.outputTokens);
      _logUsageStats(ctx, ai, cost).catch(e => logger.warn('stats 박지 X', e));

      return {
        ...parsed,
        meta: {
          model: S2_MODEL,
          inputTokens: ai.inputTokens,
          outputTokens: ai.outputTokens,
          estimatedCostUsd: cost,
          phase: 'phase-a',
        },
      };
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      await _refundQuota(ctx);
      logger.error('[ai/s2] 호출 실패 — 환불 박음', { error: e.message, stack: e.stack });
      throw new HttpsError('internal', 'AI 호출 실패: ' + (e.message || String(e)));
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

    const snapshot = (req.data && req.data.snapshot) || {};
    if (!snapshot || Object.keys(snapshot).length === 0) {
      throw new HttpsError('invalid-argument', 'snapshot 박지 X (본문 박은 장면 X)');
    }

    logger.info('[ai/check] 검증 통과', {
      uid: ctx.uid, classId: ctx.classId, teamName: ctx.teamName, workId: ctx.workId,
      used: ctx.used, quotaMax: ctx.quotaMax, sceneCount: Object.keys(snapshot).length,
    });

    /* Phase 2 — safety precheck + completion quick check (quota 차감 前, AI 호출 前) */
    const precheck = await _runAiPrecheck(ctx, snapshot, 'check');
    if (precheck && precheck.blocked) {
      logger.info('[ai/check] precheck 차단', { reasonCode: precheck.reasonCode, categories: precheck.categories, sceneIds: precheck.sceneIds });
      return precheck;
    }

    await _consumeQuota(ctx);

    try {
      const userMsg = buildUserMessage(snapshot, 'check');
      const ai = await _callAnthropic(ANTHROPIC_API_KEY.value(), WORK_CHECK_SYSTEM_PROMPT, userMsg);

      logger.info('[ai/check] Anthropic 응답 박힘', {
        inputTokens: ai.inputTokens, outputTokens: ai.outputTokens, stopReason: ai.stopReason,
      });

      let parsed;
      try {
        parsed = _parseJsonStrict(ai.text);
        _validateWorkCheckResponse(parsed);
      } catch (parseErr) {
        await _refundQuota(ctx);
        logger.error('[ai/check] schema 위반 — 환불 박음', { error: parseErr.message, text: ai.text.slice(0, 500) });
        throw new HttpsError('internal', 'AI 응답 검증 실패: ' + parseErr.message);
      }

      const cost = _estimateCostUsd(ai.inputTokens, ai.outputTokens);
      _logUsageStats(ctx, ai, cost).catch(e => logger.warn('stats 박지 X', e));

      return {
        ...parsed,
        meta: {
          model: HAIKU_MODEL,
          inputTokens: ai.inputTokens,
          outputTokens: ai.outputTokens,
          estimatedCostUsd: cost,
          phase: 'phase-a',
        },
      };

    } catch (e) {
      if (e instanceof HttpsError) throw e;

      await _refundQuota(ctx);
      logger.error('[ai/check] 호출 실패 — 환불 박음', { error: e.message, stack: e.stack });
      throw new HttpsError('internal', 'AI 호출 실패: ' + (e.message || String(e)));
    }
  }
);

/* ════════════════════════════════════════════════════════════════
   saveTextVariant — Phase 3: 텍스트 aiVariant Firebase 정식 저장 (서버 경유)
   ──────────────────────────────────────────────────────────────
   · 원본 scene.body 절대 불변. 별도 노드에만 저장.
     저장 경로: classes/{classId}/teams/{enc}/aiVariants/text/{sceneId}/{s1|s2}
     summary  : classes/{classId}/teams/{enc}/aiVariantSummary/text {s1,s2,updatedAt} (viewer-meta 밖 형제 노드)
   · write는 서버 admin SDK 전용. rules는 aiVariants.write:false 유지(클라 직접 write 불가).
   · AI 호출 없음 → quota/전역/root 한도 검사 건너뜀(skipUsageLimits). 권한 게이트는 적용.
   · safety 재검사: 저장할 body에 문제 표현 있으면 저장하지 않고 block 반환(원문 미반환, quota 무관).
   · basedOnBodyHash: 서버가 원본 scenes/{sceneId}/body를 직접 읽어 _bodyHash 재계산(클라 값 무시).
   ════════════════════════════════════════════════════════════════ */
exports.saveTextVariant = onCall(
  {
    enforceAppCheck: false,
  },
  async (req) => {
    const variant = String((req.data && req.data.variant) || '');
    if (variant !== 's1' && variant !== 's2') {
      throw new HttpsError('invalid-argument', `variant '${variant}' 박지 X (s1 / s2 박음)`);
    }

    /* mode: 'finalize'(Phase3 기본 — 전체 노드 새로 씀) | 'patchBody'(Phase4-C — 기존 메타 보존, body만 갱신).
       patchBody는 기존 variant 노드를 읽어 body/basedOnBodyHash만 바꾸고 modifiedByUser/At/By 추가. */
    const mode = String((req.data && req.data.mode) || 'finalize');
    if (mode !== 'finalize' && mode !== 'patchBody') {
      throw new HttpsError('invalid-argument', `mode '${mode}' 박지 X (finalize / patchBody 박음)`);
    }

    /* 권한 게이트 통과(quota 검사 제외). mode=variant → aiSettings textS1/textS2 게이트 동일 적용. */
    const ctx = await _validateRequest(req, variant, { skipUsageLimits: true });

    /* scenes: { sceneId: { body, source?, editedByUser?, addedElements?, riskLevel? } } — 저장할 최종 본문 + 메타.
       (구버전 클라 호환: req.data.bodies = { sceneId: bodyString } 도 허용.) */
    let rawScenes = (req.data && req.data.scenes) || null;
    if (!rawScenes && req.data && req.data.bodies) {
      rawScenes = {};
      Object.keys(req.data.bodies).forEach((sid) => { rawScenes[sid] = { body: req.data.bodies[sid] }; });
    }
    rawScenes = rawScenes || {};
    const entries = {};
    Object.keys(rawScenes).forEach((sid) => {
      const e = rawScenes[sid] || {};
      if (e && typeof e.body === 'string' && e.body.trim() !== '') entries[String(sid)] = e;
    });
    const sceneIds = Object.keys(entries);
    if (sceneIds.length === 0) {
      throw new HttpsError('invalid-argument', 'scenes 박지 X (저장할 본문 X)');
    }

    logger.info('[ai/saveVariant] 검증 통과', {
      uid: ctx.uid, classId: ctx.classId, teamName: ctx.teamName, variant, sceneCount: sceneIds.length,
    });

    /* safety 재검사 — 저장할 body로 pseudo-snapshot 구성. block이면 저장 안 함(원문 미반환). */
    const pseudo = {};
    sceneIds.forEach((sid) => { pseudo[sid] = { body: entries[sid].body }; });
    const safety = _scanSafety(pseudo);
    if (safety.blocked) {
      logger.info('[ai/saveVariant] safety 차단 — 저장 안 함', { variant, categories: safety.categories, sceneIds: safety.sceneIds });
      return {
        ok: false, blocked: true, reasonCode: 'SAFETY_BLOCKED',
        categories: safety.categories, sceneIds: safety.sceneIds,
        message: _PRECHECK_MSG.SAFETY,
      };
    }

    const enc = encodeURIComponent(ctx.teamName);
    const base = `classes/${ctx.classId}/teams/${enc}`;
    const baseRef = admin.database().ref(base);
    const now = Date.now();

    /* 서버가 원본 scenes/{sceneId}/body를 직접 읽어 basedOnBodyHash 재계산. scene.body는 절대 수정 X. */
    const update = {};
    const savedSceneIds = [];
    for (const sid of sceneIds) {
      const e = entries[sid];
      let originalBody = '';
      try {
        const snap = await baseRef.child(`scenes/${sid}/body`).once('value');
        originalBody = snap.val();
        originalBody = (originalBody == null) ? '' : String(originalBody);
      } catch (err) {
        logger.warn('[ai/saveVariant] 원본 body 읽기 실패(빈 값 처리)', { sceneId: sid, error: err && err.message });
        originalBody = '';
      }
      let node;
      if (mode === 'patchBody') {
        /* 기존 노드 읽어 메타 보존 + body/basedOnBodyHash만 갱신. 노드 없으면 finalize처럼 새로 생성. */
        let existing = null;
        try {
          const exSnap = await baseRef.child(`aiVariants/text/${sid}/${variant}`).once('value');
          existing = exSnap.val();
        } catch (err) {
          logger.warn('[ai/saveVariant] 기존 variant 읽기 실패(새로 생성)', { sceneId: sid, variant, error: err && err.message });
          existing = null;
        }
        if (existing && typeof existing === 'object') {
          /* 메타 보존: source/generatedAt/finalizedAt/finalizedBy/model/addedElements/riskLevel/status/editedByUser 등 그대로 둠. */
          node = Object.assign({}, existing);
          node.body = e.body;
          node.basedOnBodyHash = _bodyHash(originalBody);
          node.modifiedByUser = true;
          node.modifiedAt = now;
          node.modifiedBy = ctx.uid;
          node.updatedAt = now;
        } else {
          node = {
            body: e.body,
            basedOnBodyHash: _bodyHash(originalBody),
            status: 'finalized',
            finalizedBy: ctx.uid,
            finalizedAt: now,
            modifiedByUser: true,
            modifiedAt: now,
            modifiedBy: ctx.uid,
            updatedAt: now,
          };
        }
      } else {
        node = {
          body: e.body,
          basedOnBodyHash: _bodyHash(originalBody),
          status: 'finalized',
          finalizedBy: ctx.uid,
          finalizedAt: now,
          updatedAt: now,
        };
        /* 선택 메타(있을 때만 — RTDB는 null write 시 키 삭제이므로 null은 넣지 않음) */
        if (typeof e.source === 'string') node.source = e.source;
        if (typeof e.editedByUser === 'boolean') node.editedByUser = e.editedByUser;
        if (e.addedElements && typeof e.addedElements === 'object') node.addedElements = e.addedElements;
        if (typeof e.riskLevel === 'string') node.riskLevel = e.riskLevel;
      }
      update[`aiVariants/text/${sid}/${variant}`] = node;
      savedSceneIds.push(sid);
    }

    /* summary — 형제 노드(viewer-meta 밖). 복사 시 stale 전파 방지. */
    update[`aiVariantSummary/text/${variant}`] = true;
    update[`aiVariantSummary/text/updatedAt`] = now;

    try {
      await baseRef.update(update);
    } catch (e) {
      logger.error('[ai/saveVariant] 저장 실패', { error: e && e.message, stack: e && e.stack });
      throw new HttpsError('internal', '저장 실패: ' + (e && e.message ? e.message : String(e)));
    }

    logger.info('[ai/saveVariant] 저장 완료', { variant, savedCount: savedSceneIds.length });
    return { ok: true, variant, savedSceneIds, savedAt: now };
  }
);

/* ════════════════════════════════════════════════════════════════
   비용 추정 + stats (Cloud Logging 박음)
   ──────────────────────────────────────────────────────────────
   Haiku 4.5 단가 (2026-05 기준):
   - input:  $1 / 1M tokens
   - output: $5 / 1M tokens
   ════════════════════════════════════════════════════════════════ */
const HAIKU_INPUT_USD_PER_M = 1.0;
const HAIKU_OUTPUT_USD_PER_M = 5.0;

function _estimateCostUsd(inputTokens, outputTokens) {
  const inCost = (inputTokens / 1_000_000) * HAIKU_INPUT_USD_PER_M;
  const outCost = (outputTokens / 1_000_000) * HAIKU_OUTPUT_USD_PER_M;
  return Math.round((inCost + outCost) * 1_000_000) / 1_000_000;  /* 6자리 박음 */
}

async function _logUsageStats(ctx, ai, costUsd) {
  const today = _todayYmd();
  const { classId, teamName, mode } = ctx;
  const statsRef = admin.database().ref(`ai-stats/${today}`);

  /* 토큰 누적 */
  await statsRef.child(`tokens/${mode}/input`).transaction(n => (n || 0) + ai.inputTokens);
  await statsRef.child(`tokens/${mode}/output`).transaction(n => (n || 0) + ai.outputTokens);

  /* 비용 누적 (마이크로달러 박음 — 정수 박는 게 안전) */
  const costMicro = Math.round(costUsd * 1_000_000);
  await statsRef.child(`cost/${mode}/microUsd`).transaction(n => (n || 0) + costMicro);
  await statsRef.child(`cost/total/microUsd`).transaction(n => (n || 0) + costMicro);

  /* 팀별 호출 수 */
  const teamKey = `${classId}__${teamName}`.replace(/[.#$/\[\]]/g, '_');
  await statsRef.child(`by-team/${teamKey}/${mode}`).transaction(n => (n || 0) + 1);

  logger.info('[ai/stats] 박힘', { mode, inputTokens: ai.inputTokens, outputTokens: ai.outputTokens, costUsd });
}

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
  _callAnthropic,
  _parseJsonStrict,
  _validateS1Response,
  _validateWorkCheckResponse,
  _estimateCostUsd,
  _normalizeForCompare,
  _findBannedKey,
  _checkPreserved,
  _checkLengthRatio,
  BANNED_KEYS,
  PRESERVED_CHECK_KEYS,
  HAIKU_MODEL,
  MAX_TOKENS,
  /* Phase 2 — precheck. _runAiPrecheck/_recordSafetyBlock는 admin.database 필요(테스트시 mock 주입). */
  _scanSafety,
  _quickCheck,
  _runAiPrecheck,
  _recordSafetyBlock,
  SAFETY_PATTERNS,
  SAFETY_MAX_CONSECUTIVE,
  SAFETY_COOLDOWN_MS,
  _PRECHECK_MSG,
  /* Phase 3 — 텍스트 aiVariant 저장 */
  _bodyHash,
};
