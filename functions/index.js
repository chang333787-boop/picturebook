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
  _normalizeForCompare,
  _findBannedKey,
  _checkPreserved,
  _checkLengthRatio,
  BANNED_KEYS,
  PRESERVED_CHECK_KEYS,
  HAIKU_MODEL,
  MAX_TOKENS,
};
