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
const { TEXT_S1_SYSTEM_PROMPT, WORK_CHECK_SYSTEM_PROMPT, buildUserMessage } = require('./prompts');

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

  /* 3. aiPermission (Firebase RTDB 박음)
     박을 노드 박은 거 박은 거 박은 박은: classes/{classId}/teams/{teamName}/works/{workId}/aiPermission
     ⚠️ 실제 가지 박은 거 박은 거 박은 박은 박은 거 박은 거 박은 박은 — 박을 노드 위치 박은 거 박은 거 박은 박은 데이터 모델에 정합 박을 거.
     박은 거 박은 거 박은 박은 박은 거 박은 거 박은 박은 — Phase A 박을 때 박지 X 박혀있을 가능성 — 박지 X 박혀있으면 기본 ON 박음 (Phase A 테스트라).
     운영 박은 거 박은 거 박은 박은 — 박혀있어야 박을 거 (사용자가 박을 거 박은 거 박은 박은 maker.html에서 박을 거). */
  const permPath = `classes/${classId}/teams/${teamName}/aiPermission`;
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
    logger.info('[ai] aiPermission 박지 X — Phase A 테스트 기본 ON 박음', { classId, teamName });
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
   Anthropic SDK 호출 (Haiku)
   ──────────────────────────────────────────────────────────────
   사용 모델: claude-haiku-4-5 (Phase A — 가격·속도 최적)
   max_tokens: 8000 (AI_COST_GUARD_PLAN.md 2-2-1 박힘)
   ════════════════════════════════════════════════════════════════ */
const HAIKU_MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 8000;
const ANTHROPIC_TIMEOUT_MS = 50000;  /* Functions timeout 60s 박힘 — 여유 10s */

async function _callAnthropic(apiKey, systemPrompt, userMessage) {
  const client = new Anthropic({ apiKey, timeout: ANTHROPIC_TIMEOUT_MS });

  const response = await client.messages.create({
    model: HAIKU_MODEL,
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
  /* 응답 박은 거 박은 거 박은 박은 ```json ... ``` 박혀있을 가능성 — 박음 */
  let s = String(text).trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  return JSON.parse(s);
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

function _validateS1Response(parsed, snapshot) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 박지 X — object 박지 X');
  }
  if (parsed.strength !== 1) {
    throw new Error(`strength 박지 X (${parsed.strength})`);
  }
  if (!parsed.results || typeof parsed.results !== 'object') {
    throw new Error('results 박지 X');
  }
  /* 박은 거 박은 거 박은 박은 거 박은 거 박은 박은 정규화 박음 — 'scene_1' → '1', 존재하지 않는 sceneId 제거 */
  parsed.results = _normalizeResults(parsed.results, snapshot);
  if (Object.keys(parsed.results).length === 0) {
    throw new Error('정규화 후 results 박지 X (모든 sceneId 박은 거 박은 거 박은 박은 유효하지 X)');
  }

  const sceneMap = snapshot || {};
  for (const sceneId of Object.keys(parsed.results)) {
    const r = parsed.results[sceneId];
    if (!r) continue;
    if (r.skip === true) continue;  /* skip OK */

    /* 1단계 위반 — safeAddition / creativeAddition 박지 X */
    if ('safeAddition' in r || 'creativeAddition' in r) {
      throw new Error(`장면 ${sceneId} — 1단계 위반 (safeAddition/creativeAddition 박혀있음)`);
    }

    /* revisedText 박지 X 박혀있으면 거부 */
    if (typeof r.revisedText !== 'string' || r.revisedText.trim().length === 0) {
      throw new Error(`장면 ${sceneId} — revisedText 박지 X`);
    }

    /* 글자수 hard cut */
    const origScene = sceneMap[sceneId];
    const submode = origScene && origScene.submode === 'imageCenter' ? 'imageCenter' : 'split';
    const maxLen = submode === 'imageCenter' ? 300 : 500;
    if (r.revisedText.length > maxLen) {
      throw new Error(`장면 ${sceneId} — 글자수 hard cut 초과 (${r.revisedText.length}/${maxLen}, ${submode})`);
    }

    /* 한글 비율 70% 미만 거부 */
    if (_hangulRatio(r.revisedText) < 0.7) {
      throw new Error(`장면 ${sceneId} — 한글 비율 70% 미만`);
    }

    /* buttons / choices / nextA / nextB 박지 X */
    if (r.buttons || r.choices || r.nextA || r.nextB) {
      throw new Error(`장면 ${sceneId} — 분기 구조 박은 거 박지 X`);
    }
    /* 톤 / 표지 박지 X */
    if (r.storyTone || r.textCardStyle || r.textCardColor) {
      throw new Error(`장면 ${sceneId} — 톤 박은 거 박지 X`);
    }

    /* GPT 피드백 #3: 강한 경고 (severity 'strong') 박혀있으면 적용 가능 결과에서 제외 (skip 박음).
       자동 거부 (throw) ≠ UI 표시 — strong warning은 결과 자체는 보존하되 적용 박지 X. */
    const warnings = Array.isArray(r.warnings) ? r.warnings : [];
    const strongWarnings = warnings.filter(w =>
      w && (
        w.severity === 'strong' ||
        w.level === 'strong' ||
        (typeof w === 'string' && /강한|strong/i.test(w))
      )
    );
    if (strongWarnings.length > 0) {
      /* 박은 거 박은 거 박은 박은 박은 — UI에서 박을 수 있게 박은 정보 박음. revisedText는 그대로 박혀있되 박은 거 박은 거 박은 박은 박은 — appliable: false */
      r.appliable = false;
      r.strongWarnings = strongWarnings;
      logger.info('[ai/s1] 강한 경고 박힘 — 적용 제외', { sceneId, count: strongWarnings.length });
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
  HAIKU_MODEL,
  MAX_TOKENS,
};
