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
const { TEXT_S1_SYSTEM_PROMPT, TEXT_S2_SYSTEM_PROMPT, WORK_CHECK_SYSTEM_PROMPT, buildUserMessage, buildUserMessageS2Chunk } = require('./prompts');

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
  { classId: 'class_2026_junglim_1', teamName: '텍스트' },
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
/* AI mode 내부값(s1/s2/check)을 사용자용 이름으로 — 사용자 메시지에 raw mode 노출 방지 */
function _aiModeLabel(mode) {
  if (mode === 's1') return '문장 정돈';
  if (mode === 's2') return '장면 발전';
  if (mode === 'check') return '작품 검사';
  return 'AI 기능';
}
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

  /* 운영 — GitHub Pages (location.origin = 경로/슬래시 없는 scheme+host) */
  'https://chang333787-boop.github.io',

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
   AI-STAB-3 — 작품검사 결과 서버 캐시용 해시
   ──────────────────────────────────────────────────────────────
   원본 작품(원본 scene 본문/구조) 기준으로 안정적 해시를 계산한다.
   · 클라가 보낸 값은 신뢰하지 않고, 서버가 classes/{classId}/teams/{enc}/scenes를 직접 읽어 계산.
   · 본문 + 흐름(선택지/연결)만 포함. layout/색/이미지/좌표/타임스탬프 등 검사와 무관한
     필드는 제외 → 표지 색 변경 등 cosmetic 수정으로 불필요한 stale(재검사) 방지.
   · aiVariant(s1/s2)·variant body 편집은 원본 scenes 노드를 바꾸지 않으므로 이 해시에 영향 없음
     (= 작품검사 stale 판단은 원본 작품 기준이라는 원칙과 정합).
   ════════════════════════════════════════════════════════════════ */
function _normalizeSceneForCheckHash(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const buttons = Array.isArray(raw.buttons)
    ? raw.buttons.map((b) => ({
        label: String((b && b.label != null) ? b.label : ''),
        nextId: (b && b.nextId != null) ? String(b.nextId) : '',
      }))
    : [];
  return {
    type: String(raw.type == null ? '' : raw.type),
    title: String(raw.title == null ? '' : raw.title),
    body: String(raw.body == null ? '' : raw.body),
    choiceCount: (raw.choiceCount == null) ? '' : String(raw.choiceCount),
    choiceA: String(raw.choiceA == null ? '' : raw.choiceA),
    nextA: (raw.nextA == null) ? '' : String(raw.nextA),
    choiceB: String(raw.choiceB == null ? '' : raw.choiceB),
    nextB: (raw.nextB == null) ? '' : String(raw.nextB),
    buttons,
  };
}

/* scenes 노드(배열/객체 모두 가능 — Firebase는 숫자키를 배열로 반환)에서 정렬된 정규화 투영을 만들어
   _bodyHash로 8자리 해시 + 유효 장면 수를 반환. 유효 장면이 없으면 hash=null(캐시 비활성 → 기존 동작 유지). */
function _computeWorkCheckHash(scenesVal) {
  const out = [];
  if (scenesVal && typeof scenesVal === 'object') {
    const keys = Object.keys(scenesVal).filter((k) => scenesVal[k] != null);
    keys.sort((a, b) => {
      const na = Number(a); const nb = Number(b);
      if (isFinite(na) && isFinite(nb)) return na - nb;
      return a < b ? -1 : (a > b ? 1 : 0);
    });
    keys.forEach((k) => {
      const norm = _normalizeSceneForCheckHash(scenesVal[k]);
      if (norm) out.push([String(k), norm]);
    });
  }
  if (out.length === 0) return { hash: null, sceneCount: 0 };
  return { hash: _bodyHash(JSON.stringify(out)), sceneCount: out.length };
}

/* ════════════════════════════════════════════════════════════════
   P5-IMAGE-SERVER-1 — 이미지 AI S1 서버 skeleton 헬퍼 (순수 함수)
   ──────────────────────────────────────────────────────────────
   · 실제 이미지 모델 호출 / Storage 업로드 / aiVariants/image write 없음.
   · 원본 scene.imageData / scene.imageUrl 절대 write 안 함(읽기만).
   · 이미 읽어둔 scene/policy 값으로 "계획"만 계산 → notImplemented skeleton 반환.
     실제 onCall에서 Firebase read 후 이 순수 함수에 위임 → node에서 단독 테스트 가능.
   ════════════════════════════════════════════════════════════════ */
/* Firebase 키/경로 세그먼트 안전화. 비어있거나 . # $ [ ] / 제어문자 포함 → null(거부, path injection 차단). */
function _sanitizeFbKeySegment(v) {
  const s = String(v == null ? '' : v);
  if (!s) return null;
  if (/[.#$\[\]\/]/.test(s)) return null;
  if (/[\x00-\x1F\x7F]/.test(s)) return null;
  return s;
}

/* 안정적 해시 — sourceMode | sceneId | source원문 기반. 원문(base64/URL)은 응답/로그에 노출하지 않고 해시만 사용. */
function _computeImageBasedHash(sourceStr, sceneId, sourceMode) {
  return _bodyHash(String(sourceMode) + '|' + String(sceneId) + '|' + String(sourceStr == null ? '' : sourceStr));
}

/* 순수 — 이미 읽은 scene/policy로 imageS1 계획을 만든다(모델/Storage/DB write 없음).
   실패는 {ok:false, reasonCode}. 성공 자리도 아직 notImplemented skeleton.
   기존 images/.../scene_{N}.ext 경로는 절대 사용하지 않음(ai-images/... 별도 경로). */
function _planImageS1Skeleton(opts) {
  const o = opts || {};
  const classId = String(o.classId || '');
  const enc = String(o.enc || '');
  const scene = o.scene;
  const policy = o.policy;
  const timestamp = Number.isFinite(o.timestamp) ? o.timestamp : Date.now();

  const sid = _sanitizeFbKeySegment(o.sceneId);
  if (!sid) return { ok: false, reasonCode: 'INVALID_ARGUMENT', message: 'sceneId가 올바르지 않아요.' };
  if (!scene || typeof scene !== 'object') {
    return { ok: false, reasonCode: 'SCENE_NOT_FOUND', sceneId: sid };
  }
  const imageSrc = scene.imageData || scene.imageUrl || null;
  if (!imageSrc) {
    return { ok: false, reasonCode: 'IMAGE_SOURCE_MISSING', sceneId: sid };
  }
  const sourceMode = policy && policy.sourceMode;
  if (sourceMode !== 'upload' && sourceMode !== 'draw') {
    return { ok: false, reasonCode: 'IMAGE_POLICY_REQUIRED', sceneId: sid };
  }

  const basedOnImageHash = _computeImageBasedHash(imageSrc, sid, sourceMode);
  /* 실제 업로드/ write 없이 문자열만 생성. 원본 이미지 경로(images/.../scene_{N})와 절대 겹치지 않음. */
  const plannedStoragePath = `ai-images/${classId}/${enc}/scene_${sid}_s1_${timestamp}.png`;
  const plannedVariantPath = `classes/${classId}/teams/${enc}/aiVariants/image/${sid}/s1`;

  return {
    ok: false,
    notImplemented: true,
    reasonCode: 'IMAGE_AI_NOT_IMPLEMENTED',
    stage: 'imageS1Skeleton',
    sourceMode,
    sceneId: sid,
    basedOnImageHash,
    plannedStoragePath,
    plannedVariantPath,
    message: '이미지 AI 서버 준비 중입니다. 원본 그림은 그대로 유지됩니다.',
  };
}

/* Phase 4-D-1: variant layout(picturebookBodyBox) 서버 sanitizer.
   클라가 보낸 값은 신뢰하지 않고 클램프. viewer-data.js _normalizePbBodyBox와 동일 범위.
   x 0~80, y 0~80, width 20~95, height null(auto) | 12~90, backdropOpacity 0~1. */
function _sanitizePbBodyBox(raw) {
  const r = (raw && typeof raw === 'object') ? raw : {};
  const clamp = (v, lo, hi, def) => {
    const n = Number(v);
    if (!isFinite(n)) return def;
    return Math.min(hi, Math.max(lo, n));
  };
  const out = {
    x: clamp(r.x, 0, 80, 15),
    y: clamp(r.y, 0, 80, 25),
    width: clamp(r.width, 20, 95, 55),
    backdropOpacity: clamp(r.backdropOpacity, 0, 1, 0.85),
  };
  /* height: null이면 auto-content. 숫자면 12~90 클램프. */
  if (r.height == null || r.height === '') {
    out.height = null;
  } else {
    const h = Number(r.height);
    out.height = isFinite(h) ? Math.min(90, Math.max(12, h)) : null;
  }
  return out;
}

/* Phase 4-D-2A: variant textStyle 서버 sanitizer.
   클라가 보낸 값은 신뢰하지 않고 allowlist + 클램프.
   허용 필드 = fontFamily / fontSize / color / weight (그 외 키 전부 제거).
   · fontFamily: VARIANT_TEXT_FONTS allowlist만(아니면 'gothic')
   · fontSize: 숫자 10~50 클램프(텍스트 슬라이더 50·그림책 28 모두 수용, 기본 18)
   · color: '' 또는 안전한 hex(#rgb/#rrggbb/#rrggbbaa)만 허용 — 그 외(임의 CSS) 전부 '' 로(injection 차단)
   · weight: 'bold' 아니면 'normal'
   원본 scenes/{sceneId}/textStyle은 절대 미변경 — 이 값은 aiVariants 경로에만 저장된다.
   P4-D-2C: allowlist를 viewer-edit.js FONTS(인스펙터 폰트 드롭다운 18종) / TEXT_FONT_FAMILIES
   렌더 키와 정합시킴 — variant view에서 사용자가 고른 폰트가 gothic으로 sanitize되지 않도록.
   값은 전부 고정 문자열 키(includes 매칭)라 CSS injection 위험 없음. */
const VARIANT_TEXT_FONTS = [
  /* 기존 8종 (P4-D-2A) */
  'gothic', 'batang', 'pen', 'gaegu', 'hanna', 'jua', 'galmuri', 'cormorant',
  /* W9 확장 10종 — UI FONTS / TEXT_FONT_FAMILIES와 동일 */
  'notosans', 'notoserif', 'dodum', 'dohyeon', 'himelody',
  'yeonsung', 'dokdo', 'diphylleia', 'hahmlet', 'stylish',
];
function _sanitizeVariantTextStyle(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const clampNum = (v, lo, hi, def) => {
    const n = Number(v);
    if (!isFinite(n)) return def;
    return Math.min(hi, Math.max(lo, n));
  };
  const fontFamily = VARIANT_TEXT_FONTS.includes(raw.fontFamily) ? raw.fontFamily : 'gothic';
  const fontSize = clampNum(raw.fontSize, 10, 50, 18);
  let color = '';
  if (typeof raw.color === 'string') {
    const c = raw.color.trim();
    if (c === '') color = '';
    else if (/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{8}$/.test(c)) color = c;
    else color = '';   /* 임의 CSS/named/함수형 색은 거부 → 기본(테마 색) */
  }
  const weight = (raw.weight === 'bold') ? 'bold' : 'normal';
  return { fontFamily, fontSize, color, weight };
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
    throw new HttpsError('unauthenticated', '로그인이 필요해요.');
  }

  /* 5. testMode 거부 — v140 핵심. client testMode 박혀있어도 실 API 박지 X */
  if (req.data && req.data.testMode === true) {
    logger.warn('[ai] testMode 우회 시도 박힘', { uid: req.auth.uid, data: req.data });
    throw new HttpsError('permission-denied', 'testMode로는 실제 AI를 사용할 수 없어요.');
  }

  /* 데이터 박은 거 박은 거 박은 박은 박음 */
  const data = req.data || {};
  const classId = String(data.classId || '');
  const teamName = String(data.teamName || '');
  const workId = String(data.workId || '');
  const rootBranchId = data.rootBranchId ? String(data.rootBranchId) : null;
  const copyDepth = Number.isFinite(data.copyDepth) ? data.copyDepth : 0;

  if (!classId || !teamName) {
    throw new HttpsError('invalid-argument', 'classId / teamName이 없어요.');
  }
  /* workId 박은 거 박은 거 박은 박은 — 가지 데이터 모델 박은 거 박은 거 박은 박은 — team 자체 박은 거 박은 거 박은 박은 한 작품. workId 박지 X 박혀있으면 teamName 박음. */
  const workIdEffective = workId || teamName;

  /* 2. 권한 1차 — aiSettings 우선 모델 (AI-STAB-1).
     · aiSettings가 있는 학급 → 교사 설정(enabled + modes[modeKey])이 최종 권한 → 임시 허용목록(AI_TEST_ALLOWED) 무시.
     · aiSettings가 없는 학급(레거시/타 학급) → 기존 임시 허용목록 하드게이트 + aiPermission fallback 그대로.
     aiSettings를 여기서 먼저 읽어 allowlist 분기만 결정한다. 실제 enabled/modes 판정은 killswitch 뒤(아래 3번)
     기존 위치에서 수행 → aiSettings 없는 학급의 검사 순서/에러 우선순위는 오늘과 동일. */
  const aiSettingsSnap = await admin.database().ref(`classes/${classId}/aiSettings`).once('value');
  const aiSettings = aiSettingsSnap.val();
  if (!aiSettings && !isAiTestAllowed(classId, teamName)) {
    throw new HttpsError('permission-denied',
      'AI 사용 권한이 없어요 (Phase A 테스트 대상이 아니에요 — ' + classId + '/' + teamName + ')');
  }

  /* 4. copyDepth <= 1 (모/자식 브랜치만 박음 — 손자 박지 X) */
  if (copyDepth > 1) {
    throw new HttpsError('permission-denied',
      'AI_BLOCKED_BY_DEPTH — copyDepth ' + copyDepth + ' (모/자식 브랜치만 가능해요)');
  }

  /* 10. Origin 검증 (가지 도메인만) */
  const origin = (req.rawRequest && req.rawRequest.headers && req.rawRequest.headers.origin) || '';
  if (!isOriginAllowed(origin)) {
    logger.warn('[ai] origin 박지 X', { uid: req.auth.uid, origin });
    throw new HttpsError('permission-denied', '허용되지 않은 origin이에요 — ' + (origin || '(빈 값)'));
  }

  /* 11. kill switch (Firebase ai-kill-switch/enabled) */
  const killSnap = await admin.database().ref('ai-kill-switch/enabled').once('value');
  if (killSnap.val() === true) {
    throw new HttpsError('unavailable', 'AI 기능을 잠시 사용할 수 없어요. 운영자에게 문의해 주세요.');
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
  /* aiSettings는 위(2번)에서 이미 읽음(AI-STAB-1) — 재읽기 없이 재사용. 게이트 판정은 여기서 기존 그대로. */
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
        throw new HttpsError('permission-denied', 'AI_NOT_ENABLED (교사가 아직 AI를 열지 않았어요)');
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
        '오늘 전체 사용 한도에 도달했어요 (' + GLOBAL_DAILY_LIMIT + '). 내일 다시 시도해 주세요.');
    }

    /* 7. rootBranchId 묶음 quota */
    if (rootBranchId) {
      const rootSnap = await admin.database().ref(`ai-usage-by-root/${rootBranchId}/${today}/calls`).once('value');
      const rootCalls = rootSnap.val() || 0;
      if (rootCalls >= ROOT_DAILY_LIMIT) {
        throw new HttpsError('resource-exhausted',
          `이 작품 묶음의 하루 사용 한도에 도달했어요 (${ROOT_DAILY_LIMIT}). 내일 다시 시도해 주세요.`);
      }
    }

    /* 6. 브랜치 quota */
    const yyyyMm = _yyyyMm();
    const usagePath = `ai-usage/${classId}/${teamName}/${yyyyMm}/${mode}Used`;
    const usageSnap = await admin.database().ref(usagePath).once('value');
    used = usageSnap.val() || 0;
    quotaMax = QUOTA[mode] || 0;
    if (quotaMax === 0) {
      throw new HttpsError('invalid-argument', `mode '${mode}'가 올바르지 않아요 (s1 / s2 / check).`);
    }
    if (used >= quotaMax) {
      throw new HttpsError('resource-exhausted',
        `이 작품에서 사용할 수 있는 ‘${_aiModeLabel(mode)}’ 횟수를 모두 사용했어요. (${used}/${quotaMax})`);
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
  /* 성적/19금. ⚠️ 단어 경계 없는 토큰은 정상 한국어와 충돌 → 제거/가드:
     보지(보다+지: "보지 못했다")·자지(자다+지: "자지 않았다")·사정하(사정하다=간청/事情)는
     오탐만 내므로 제거. 발기(發起人)·성기(이름 "성기훈" 등)는 lookahead/lookbehind로 가드. */
  sexual: [
    /섹스|쎅스|성관계|야동|야애니|자위행위|음경|오르가즘|porn|성적\s*흥분/i,
    /발기(?!인)/,
    /(?<![가-힣])성기(?=[은는이가을를에도만와의야]|[^가-힣]|$)/,
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

/* ════════════════════════════════════════════════════════════════
   텍스트 2단계 chunk 설정 (T2-INFRA-1) — 대형 작품 timeout 해결
   ──────────────────────────────────────────────────────────────
   문제: s2가 작품 전체 장면을 단일 Anthropic 호출의 출력으로 생성 →
         장면 많으면 출력 생성이 ANTHROPIC_TIMEOUT_MS(50s)를 넘겨 timeout.
   해법: 출력을 chunk(장면 N개)로 쪼개 각 호출은 일부 장면만 생성.
         입력(작품 전체 맥락)은 매 chunk에 전부 제공 → 분기 흐름·일관성 유지.
   정책: chunk size 4, 동시성 4(wave 단위), all-or-nothing(하나라도 실패→전체 환불).
   상한: 본문 있는 장면 S2_MAX_SCENES 초과 시 quota 차감·AI 호출 前 차단.
         (safety/cooldown 아님 — aiSafetyState 기록 없음, 단순 구조 제한 안내.)
   ════════════════════════════════════════════════════════════════ */
const S2_CHUNK_SIZE = 4;     /* chunk당 발전 대상 장면 수 — 출력 토큰 폭주/timeout 회피 */
const S2_CONCURRENCY = 4;    /* 동시 Anthropic 호출 상한(wave). 초대형 작품 안정성 위해 제한 */
const S2_MAX_SCENES = 24;    /* 본문 있는 장면 수 상한. 초과 시 호출 前 차단(quota 차감 X) */

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
    throw new Error('Anthropic 응답이 없어요 — text block이 없어요');
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
    throw new Error('JSON이 아니에요 — object가 아니에요');
  }
  if (parsed.strength !== 1) {
    throw new Error(`strength가 올바르지 않아요 (${parsed.strength})`);
  }
  if (!parsed.results || typeof parsed.results !== 'object') {
    throw new Error('results가 없어요');
  }
  /* sceneId 정규화 — 'scene_1' → '1', 존재하지 않는 sceneId 제거 */
  parsed.results = _normalizeResults(parsed.results, snapshot);
  if (Object.keys(parsed.results).length === 0) {
    throw new Error('정규화 후 results가 없어요 (모든 sceneId가 유효하지 않아요)');
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
      throw new Error(`장면 ${sceneId} — revisedText가 없어요`);
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
    throw new Error('JSON이 아니에요 — object가 아니에요');
  }
  if (!parsed.categories || typeof parsed.categories !== 'object') {
    throw new Error('categories가 없어요');
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

/* s2 글자수 비율 — 발전이므로 확장 허용, 폭주만 차단. 원문 50자 미만은 절대 증가량 기준(T2-QA-1.5: 메모형 원문 과차단 방지로 20→50 확장). */
function _checkLengthRatioS2(origLen, revisedLen) {
  if (origLen < 50) {
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
    throw new Error('JSON이 아니에요 — object가 아니에요');
  }
  if (parsed.strength !== 2) {
    throw new Error(`strength가 올바르지 않아요 (${parsed.strength})`);
  }
  if (!parsed.results || typeof parsed.results !== 'object') {
    throw new Error('results가 없어요');
  }
  parsed.results = _normalizeResults(parsed.results, snapshot);
  if (Object.keys(parsed.results).length === 0) {
    throw new Error('정규화 후 results가 없어요');
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
      throw new Error(`장면 ${sceneId} — revisedText가 없어요`);
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
      throw new HttpsError('invalid-argument', 'snapshot이 없어요 (본문이 있는 장면이 없어요)');
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
   텍스트 2단계 chunk 인프라 (T2-INFRA-1) — 핸들러와 분리(테스트 가능)
   ════════════════════════════════════════════════════════════════ */

/* sceneId 배열을 size 단위 chunk로 나눔. (snapshot은 이미 본문 있는 장면만) */
function _chunkSceneIds(ids, size) {
  const out = [];
  const n = Math.max(1, size | 0);
  for (let i = 0; i < ids.length; i += n) out.push(ids.slice(i, i + n));
  return out;
}

/* 동시성 상한 concurrency로 items를 fn(item, idx)로 실행.
   all-or-nothing: 하나라도 reject되면 즉시 중단 신호(aborted) → 진행 중 외 새 작업 안 받고
   첫 에러를 그대로 throw. (진행 중 호출은 취소 불가 — 결과만 버림.) */
async function _runWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let aborted = false;
  async function worker() {
    while (!aborted) {
      const i = nextIndex++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        aborted = true;
        throw e;
      }
    }
  }
  const workerCount = Math.max(1, Math.min(concurrency | 0 || 1, items.length));
  const workers = [];
  for (let w = 0; w < workerCount; w++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

/* s2 장면 수 상한 검사 — 초과면 block 객체(precheck와 같은 모양), 통과면 null.
   호출 위치: callTextAiBatchS2 핸들러의 _runAiPrecheck/_consumeQuota 直前.
   ⚠ safety/cooldown 아님: aiSafetyState 기록·consecutiveBlocks·cooldown 일절 없음.
   ⚠ s2 전용: s1/check는 이 검사를 호출하지 않으므로 영향 없음. */
function _checkS2SceneCap(snapshot) {
  const n = Object.keys(snapshot || {}).length;
  if (n > S2_MAX_SCENES) {
    return {
      ok: false, blocked: true, reasonCode: 'S2_TOO_LARGE',
      categories: [], sceneIds: [],
      sceneCount: n, maxScenes: S2_MAX_SCENES,
      message: `이 작품은 본문이 있는 장면이 ${n}개라, 한 번에 텍스트 2단계로 발전시키기엔 너무 커요. 한 번에 최대 ${S2_MAX_SCENES}개 장면까지 발전시킬 수 있어요. 장면 수를 줄이거나 작품을 나눠서 다시 시도해 주세요.`,
    };
  }
  return null;
}

/* s2 chunk 실행 + merge 코어 — onCall 핸들러와 분리(mock callFn으로 테스트 가능).
   callFn: async (targetIds, userMessage, idx) => { text, inputTokens, outputTokens }
   반환: { mergedResults, totalInputTokens, totalOutputTokens, chunkCount }
   실패 시 throw(plain Error) — 호출자(핸들러)가 _refundQuota 처리. (all-or-nothing) */
async function _runS2Chunks(snapshot, callFn) {
  const allIds = Object.keys(snapshot || {});
  const chunks = _chunkSceneIds(allIds, S2_CHUNK_SIZE);
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const pickedParts = await _runWithConcurrency(chunks, S2_CONCURRENCY, async (targetIds, idx) => {
    const userMsg = buildUserMessageS2Chunk(snapshot, targetIds);
    const ai = await callFn(targetIds, userMsg, idx);
    totalInputTokens += (ai && ai.inputTokens) || 0;
    totalOutputTokens += (ai && ai.outputTokens) || 0;

    let parsed;
    try {
      parsed = _parseJsonStrict(ai && ai.text);
    } catch (e) {
      throw new Error(`chunk ${idx + 1}/${chunks.length} JSON 파싱 실패: ${e.message}`);
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.results || typeof parsed.results !== 'object') {
      throw new Error(`chunk ${idx + 1}/${chunks.length} results 구조 없음`);
    }

    /* 이 chunk의 target ID만 채택. scene_ 접두사 정규화 후, target 외(다른 chunk 장면·미존재
       ID)는 drop → 최종 merge 오염 방지. */
    const targetSet = new Set(targetIds.map(String));
    const out = {};
    let leaked = 0;
    for (const rawKey of Object.keys(parsed.results)) {
      let key = String(rawKey);
      if (/^scene[_\-]?(\d+)$/i.test(key)) key = key.replace(/^scene[_\-]?/i, '');
      if (targetSet.has(key)) out[key] = parsed.results[rawKey];
      else leaked++;
    }
    if (leaked > 0) {
      logger.warn('[ai/s2] chunk target 외 결과 drop', { chunk: idx + 1, leaked });
    }

    /* target 누락 검사 — 이 chunk의 모든 target이 결과에 있어야 함.
       하나라도 빠지면 chunk 실패 → 전체 실패(환불). (skip:true도 키는 존재해야 함) */
    const missing = targetIds.filter((id) => !(String(id) in out));
    if (missing.length > 0) {
      throw new Error(`chunk ${idx + 1}/${chunks.length} target 장면 누락: ${missing.join(', ')}`);
    }
    return out;
  });

  /* merge — target 분리로 중복은 없어야 하나, 방어적으로 first-wins + 경고. */
  const mergedResults = {};
  for (const part of pickedParts) {
    if (!part) continue;
    for (const sid of Object.keys(part)) {
      if (sid in mergedResults) {
        logger.warn('[ai/s2] merge 중복 sceneId — 첫 결과 유지', { sceneId: sid });
        continue;
      }
      mergedResults[sid] = part[sid];
    }
  }

  return { mergedResults, totalInputTokens, totalOutputTokens, chunkCount: chunks.length };
}

/* ════════════════════════════════════════════════════════════════
   callTextAiBatchS2 — 텍스트 2단계 (장면 발전)
   s1과 공유 헬퍼(_validateRequest/_consumeQuota/_refundQuota/_callAnthropic/_parseJsonStrict/
   _estimateCostUsd/_logUsageStats) 재사용. prompt=TEXT_S2_SYSTEM_PROMPT, 모델=S2_MODEL(기본 Haiku),
   검증=_validateS2Response. 기존 callTextAiBatch/callWorkCheck는 불변.
   T2-INFRA-1: 대형 작품 timeout 회피를 위해 출력을 chunk로 쪼개 부분 장면만 생성하고
   서버에서 merge. 사용자는 1회 호출/quota 1회로 느낌. 상한 초과는 호출 前 차단.
   ════════════════════════════════════════════════════════════════ */
exports.callTextAiBatchS2 = onCall(
  {
    secrets: [ANTHROPIC_API_KEY],
    enforceAppCheck: false,
    /* T2-INFRA-1: chunk 병렬(동시성 4)이라 단일 호출보다 길어질 수 있어 전역 60s보다 여유.
       이 함수에만 적용 — 전역/ s1·check는 불변. */
    timeoutSeconds: 120,
  },
  async (req) => {
    const ctx = await _validateRequest(req, 's2');

    const snapshot = (req.data && req.data.snapshot) || {};
    if (!snapshot || Object.keys(snapshot).length === 0) {
      throw new HttpsError('invalid-argument', 'snapshot이 없어요 (본문이 있는 장면이 없어요)');
    }

    /* T2-INFRA-1 — 장면 수 상한 검사 (precheck/quota/AI 호출 前).
       초과 시 precheck와 같은 모양의 block 반환 → 클라 _showAiPrecheckBlockedModal이 처리.
       ⚠ safety/cooldown 아님: aiSafetyState 기록·quota 차감 없음. s2 전용(s1/check 영향 X). */
    const capBlock = _checkS2SceneCap(snapshot);
    if (capBlock) {
      logger.info('[ai/s2] 장면 수 상한 초과 — 호출 前 차단', { sceneCount: capBlock.sceneCount, maxScenes: S2_MAX_SCENES });
      return capBlock;
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
      /* T2-INFRA-1 — chunk 분할 + 병렬 호출 + merge. 각 chunk는 작품 전체 맥락 + 일부 장면만 출력.
         all-or-nothing: 한 chunk라도 실패하면 _runS2Chunks가 throw → 아래 catch에서 환불. */
      const { mergedResults, totalInputTokens, totalOutputTokens, chunkCount } =
        await _runS2Chunks(snapshot, (targetIds, userMsg) =>
          _callAnthropic(ANTHROPIC_API_KEY.value(), TEXT_S2_SYSTEM_PROMPT, userMsg, S2_MODEL));

      logger.info('[ai/s2] 전체 chunk 응답 박힘', {
        model: S2_MODEL, chunkCount, chunkSize: S2_CHUNK_SIZE,
        totalInputTokens, totalOutputTokens, sceneCount: Object.keys(mergedResults).length,
      });

      /* merge 후 한 번만 검증 — 반드시 FULL snapshot 기준(normalize/BIG_SETTING/길이 등). */
      const merged = { ok: true, strength: 2, scope: 'work', globalSummary: '', results: mergedResults };
      try {
        _validateS2Response(merged, snapshot);
      } catch (parseErr) {
        await _refundQuota(ctx);
        logger.error('[ai/s2] merge 검증 실패 — 환불 박음', { error: parseErr.message });
        throw new HttpsError('internal', 'AI 응답 검증 실패: ' + parseErr.message);
      }

      const cost = _estimateCostUsd(totalInputTokens, totalOutputTokens);
      _logUsageStats(ctx, { inputTokens: totalInputTokens, outputTokens: totalOutputTokens }, cost)
        .catch(e => logger.warn('stats 박지 X', e));

      return {
        ...merged,
        meta: {
          model: S2_MODEL,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          estimatedCostUsd: cost,
          phase: 'phase-a',
          chunkCount,
          chunkSize: S2_CHUNK_SIZE,
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
      throw new HttpsError('invalid-argument', 'snapshot이 없어요 (본문이 있는 장면이 없어요)');
    }

    /* AI-STAB-3 — 서버 권위 해시로 작품검사 결과 캐시.
       _validateRequest(권한/copyDepth/origin/killswitch/aiSettings) 통과 후에만 캐시를 본다
       → AI가 꺼진 학급이 과거 결과만 보는 상황 방지. 원본 scenes를 서버가 직접 읽어 해시 계산
       (클라 snapshot 해시 신뢰 X). latest.snapshotHash와 같으면 AI 호출/quota 차감 없이 캐시 반환.
       해시 계산 불가(scenes 읽기 실패/빈 작품)면 _curHash=null → 캐시 비활성(기존 동작 그대로). */
    const _enc = encodeURIComponent(ctx.teamName);
    const _cacheRef = admin.database().ref(`classes/${ctx.classId}/teams/${_enc}/aiChecks/workCheck/latest`);
    let _curHash = null;
    let _curSceneCount = 0;
    try {
      const _scenesSnap = await admin.database().ref(`classes/${ctx.classId}/teams/${_enc}/scenes`).once('value');
      const _h = _computeWorkCheckHash(_scenesSnap.val());
      _curHash = _h.hash;
      _curSceneCount = _h.sceneCount;
    } catch (e) {
      logger.warn('[ai/check] scenes 해시 계산 실패 — 캐시 비활성(기존대로 진행)', { error: e && e.message });
      _curHash = null;
    }
    if (_curHash) {
      try {
        const _cacheSnap = await _cacheRef.once('value');
        const _cache = _cacheSnap.val();
        if (_cache && _cache.snapshotHash === _curHash && _cache.result) {
          logger.info('[ai/check] cache hit — AI/quota 생략', {
            uid: ctx.uid, classId: ctx.classId, teamName: ctx.teamName,
            snapshotHash: _curHash, checkedAt: _cache.checkedAt,
          });
          return {
            ..._cache.result,
            cached: true,
            meta: Object.assign({}, _cache.result.meta || {}, { cached: true, cachedAt: _cache.checkedAt || null }),
          };
        }
      } catch (e) {
        logger.warn('[ai/check] cache read 실패 — 새 검사로 진행', { error: e && e.message });
      }
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

      const result = {
        ...parsed,
        meta: {
          model: HAIKU_MODEL,
          inputTokens: ai.inputTokens,
          outputTokens: ai.outputTokens,
          estimatedCostUsd: cost,
          phase: 'phase-a',
        },
      };

      /* AI-STAB-3 — 성공 결과만 latest에 저장(best-effort). 저장 실패는 결과 반환을 막지 않음(로그만).
         AI 실패/schema 위반 시에는 위에서 throw(+환불) 되므로 여기 도달 X → 캐시 덮어쓰기 없음. */
      if (_curHash) {
        try {
          await _cacheRef.set({
            result,
            snapshotHash: _curHash,
            sceneCount: _curSceneCount,
            checkedAt: Date.now(),
            checkedBy: ctx.uid,
            model: HAIKU_MODEL,
            version: 'workCheckCacheV1',
          });
        } catch (e) {
          logger.error('[ai/check] cache write 실패(결과는 정상 반환)', { error: e && e.message });
        }
      }

      return { ...result, cached: false };

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
      throw new HttpsError('invalid-argument', `variant '${variant}'가 올바르지 않아요 (s1 / s2).`);
    }

    /* mode: 'finalize'(Phase3 기본 — 전체 노드 새로 씀) | 'patchBody'(Phase4-C — 기존 메타 보존, body만 갱신)
       | 'patchLayout'(Phase4-D-1 — 기존 노드 read-merge로 layout.picturebookBodyBox만 갱신, body/메타 보존)
       | 'patchStyle'(Phase4-D-2A — 기존 노드 read-merge로 style.textStyle만 갱신, body/layout/메타 보존).
       patchLayout/patchStyle은 텍스트를 건드리지 않으므로 safety 재검사 없음. scene.body/scenes layout/textStyle 절대 미변경. */
    const mode = String((req.data && req.data.mode) || 'finalize');
    if (mode !== 'finalize' && mode !== 'patchBody' && mode !== 'patchLayout' && mode !== 'patchStyle') {
      throw new HttpsError('invalid-argument', `mode '${mode}'가 올바르지 않아요 (finalize / patchBody / patchLayout / patchStyle).`);
    }
    const isLayoutPatch = (mode === 'patchLayout');
    const isStylePatch = (mode === 'patchStyle');

    /* 권한 게이트 통과(quota 검사 제외). mode=variant → aiSettings textS1/textS2 게이트 동일 적용. */
    const ctx = await _validateRequest(req, variant, { skipUsageLimits: true });

    /* scenes:
       - finalize/patchBody: { sceneId: { body, source?, editedByUser?, addedElements?, riskLevel? } }
       - patchLayout:        { sceneId: { layout: { picturebookBodyBox } } }  (body 없음)
       - patchStyle:         { sceneId: { style: { textStyle } } }            (body 없음)
       (구버전 클라 호환: req.data.bodies = { sceneId: bodyString } 도 허용 — body 모드 전용.) */
    let rawScenes = (req.data && req.data.scenes) || null;
    if (!rawScenes && req.data && req.data.bodies) {
      rawScenes = {};
      Object.keys(req.data.bodies).forEach((sid) => { rawScenes[sid] = { body: req.data.bodies[sid] }; });
    }
    rawScenes = rawScenes || {};
    const entries = {};
    Object.keys(rawScenes).forEach((sid) => {
      const e = rawScenes[sid] || {};
      if (isLayoutPatch) {
        /* layout 모드: layout.picturebookBodyBox 가 객체일 때만 채택. body 불요. */
        if (e && e.layout && typeof e.layout === 'object' && e.layout.picturebookBodyBox && typeof e.layout.picturebookBodyBox === 'object') {
          entries[String(sid)] = e;
        }
      } else if (isStylePatch) {
        /* style 모드: style.textStyle 가 객체일 때만 채택. body 불요. */
        if (e && e.style && typeof e.style === 'object' && e.style.textStyle && typeof e.style.textStyle === 'object') {
          entries[String(sid)] = e;
        }
      } else if (e && typeof e.body === 'string' && e.body.trim() !== '') {
        entries[String(sid)] = e;
      }
    });
    const sceneIds = Object.keys(entries);
    if (sceneIds.length === 0) {
      const emptyMsg = isLayoutPatch ? 'scenes가 없어요 (저장할 layout이 없어요)'
        : isStylePatch ? 'scenes가 없어요 (저장할 style이 없어요)'
        : 'scenes가 없어요 (저장할 본문이 없어요)';
      throw new HttpsError('invalid-argument', emptyMsg);
    }

    logger.info('[ai/saveVariant] 검증 통과', {
      uid: ctx.uid, classId: ctx.classId, teamName: ctx.teamName, variant, mode, sceneCount: sceneIds.length,
    });

    /* safety 재검사 — body 모드만. patchLayout/patchStyle은 텍스트 미변경이므로 검사 생략. */
    if (!isLayoutPatch && !isStylePatch) {
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
      let node;
      if (isLayoutPatch) {
        /* patchLayout — 기존 variant 노드 read-merge. body/메타/basedOnBodyHash 보존, layout.picturebookBodyBox만 갱신.
           원본 scenes/{sid}/body 안 읽음(텍스트 미변경). 노드 없으면 layout만 가진 stub 생성(원본 body는 절대 복사 X). */
        let existing = null;
        try {
          const exSnap = await baseRef.child(`aiVariants/text/${sid}/${variant}`).once('value');
          existing = exSnap.val();
        } catch (err) {
          logger.warn('[ai/saveVariant] 기존 variant 읽기 실패(layout stub 생성)', { sceneId: sid, variant, error: err && err.message });
          existing = null;
        }
        const sanitizedBox = _sanitizePbBodyBox(e.layout.picturebookBodyBox);
        if (existing && typeof existing === 'object') {
          node = Object.assign({}, existing);
          node.layout = Object.assign({}, existing.layout || {}, { picturebookBodyBox: sanitizedBox });
        } else {
          /* variant 본문이 아직 없는 경우: layout만 저장(body 미포함 — 원본 fallback은 클라가 처리). */
          node = { layout: { picturebookBodyBox: sanitizedBox } };
        }
        node.layoutModifiedByUser = true;
        node.layoutModifiedAt = now;
        node.layoutModifiedBy = ctx.uid;
        node.updatedAt = now;
        update[`aiVariants/text/${sid}/${variant}`] = node;
        savedSceneIds.push(sid);
        continue;
      }
      if (isStylePatch) {
        /* patchStyle — 기존 variant 노드 read-merge. body/layout/메타 보존, style.textStyle만 갱신.
           원본 scenes/{sid}/body·textStyle 안 읽음(텍스트/원본 미변경). 노드 없으면 style만 가진 stub 생성. */
        let existing = null;
        try {
          const exSnap = await baseRef.child(`aiVariants/text/${sid}/${variant}`).once('value');
          existing = exSnap.val();
        } catch (err) {
          logger.warn('[ai/saveVariant] 기존 variant 읽기 실패(style stub 생성)', { sceneId: sid, variant, error: err && err.message });
          existing = null;
        }
        const sanitizedStyle = _sanitizeVariantTextStyle(e.style.textStyle);
        if (!sanitizedStyle) {
          /* sanitize 불가(객체 아님) — 위 entries 필터에서 걸러지지만 방어. 이 sid는 skip. */
          continue;
        }
        if (existing && typeof existing === 'object') {
          node = Object.assign({}, existing);
          node.style = Object.assign({}, existing.style || {}, { textStyle: sanitizedStyle });
        } else {
          /* variant 본문/레이아웃이 아직 없는 경우: style만 저장(body/layout 미포함 — 원본 fallback은 클라가 처리). */
          node = { style: { textStyle: sanitizedStyle } };
        }
        node.styleModifiedByUser = true;
        node.styleModifiedAt = now;
        node.styleModifiedBy = ctx.uid;
        node.updatedAt = now;
        update[`aiVariants/text/${sid}/${variant}`] = node;
        savedSceneIds.push(sid);
        continue;
      }
      let originalBody = '';
      try {
        const snap = await baseRef.child(`scenes/${sid}/body`).once('value');
        originalBody = snap.val();
        originalBody = (originalBody == null) ? '' : String(originalBody);
      } catch (err) {
        logger.warn('[ai/saveVariant] 원본 body 읽기 실패(빈 값 처리)', { sceneId: sid, error: err && err.message });
        originalBody = '';
      }
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
   callImageAiS1 — P5-IMAGE-SERVER-1: 이미지 AI S1 서버 skeleton
   ──────────────────────────────────────────────────────────────
   ⚠️ 이번 단계는 skeleton만. 실제 이미지 모델 호출 / Storage 업로드 /
      aiVariants/image write / quota 차감 / 원본 scene write 전부 없음.
   흐름:
     1) _validateRequest(req, 'imageS1', {skipUsageLimits:true}) — 권한 게이트만(quota 차감 없음).
        · aiSettings.modes.imageS1(또는 aiPermission.allowedModes.imageS1) === true 여야 통과.
        · imageS2는 건드리지 않음.
     2) sceneId sanitize(path injection 차단).
     3) 서버가 원본 scene / viewer-meta.imagePolicy 를 read(읽기만).
     4) 순수 _planImageS1Skeleton 에 위임 → notImplemented skeleton 반환.
   실패 reasonCode: INVALID_ARGUMENT(throw) / PERMISSION_DENIED(throw, _validateRequest) /
     SCENE_NOT_FOUND / IMAGE_SOURCE_MISSING / IMAGE_POLICY_REQUIRED / IMAGE_AI_NOT_IMPLEMENTED(정상 skeleton).
   ════════════════════════════════════════════════════════════════ */
exports.callImageAiS1 = onCall(
  {
    enforceAppCheck: false,
  },
  async (req) => {
    /* 권한 게이트 먼저(auth/aiSettings/origin/killswitch). quota 차감 없음 — skeleton이므로 skipUsageLimits. */
    const ctx = await _validateRequest(req, 'imageS1', { skipUsageLimits: true });

    /* sceneId 필수 + sanitize. classId/teamName은 _validateRequest가 검증. */
    const sid = _sanitizeFbKeySegment(req.data && req.data.sceneId);
    if (!sid) {
      throw new HttpsError('invalid-argument', 'sceneId가 없거나 올바르지 않아요.');
    }

    const enc = encodeURIComponent(ctx.teamName);
    const baseRef = admin.database().ref(`classes/${ctx.classId}/teams/${enc}`);

    /* 원본 scene read — 읽기만. scene.imageData/imageUrl 절대 write 안 함. */
    let scene = null;
    try {
      const snap = await baseRef.child(`scenes/${sid}`).once('value');
      scene = snap.val();
    } catch (e) {
      logger.warn('[ai/imageS1] scene 읽기 실패', { sceneId: sid, error: e && e.message });
      scene = null;
    }

    /* imagePolicy read — viewer-meta/imagePolicy. 서버는 이 단계에서 imagePolicy를 저장하지 않음. */
    let policy = null;
    try {
      const pSnap = await baseRef.child('viewer-meta/imagePolicy').once('value');
      policy = pSnap.val();
    } catch (e) {
      logger.warn('[ai/imageS1] imagePolicy 읽기 실패', { error: e && e.message });
      policy = null;
    }

    const plan = _planImageS1Skeleton({
      classId: ctx.classId, enc, sceneId: sid, scene, policy, timestamp: Date.now(),
    });

    /* 로그에는 원문(base64/URL) 노출 X — reasonCode/sourceMode/sceneId만. */
    logger.info('[ai/imageS1] skeleton', {
      uid: ctx.uid, classId: ctx.classId, teamName: ctx.teamName,
      sceneId: sid, reasonCode: plan.reasonCode, sourceMode: plan.sourceMode || null,
    });

    return plan;
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
  _validateS2Response,
  _validateWorkCheckResponse,
  _estimateCostUsd,
  /* T2-INFRA-1 — s2 chunk 인프라 (하네스 테스트용) */
  _chunkSceneIds,
  _runWithConcurrency,
  _checkS2SceneCap,
  _runS2Chunks,
  S2_CHUNK_SIZE,
  S2_CONCURRENCY,
  S2_MAX_SCENES,
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
  /* AI-STAB-3 — 작품검사 결과 캐시 해시 */
  _computeWorkCheckHash,
  _normalizeSceneForCheckHash,
  /* P5-IMAGE-SERVER-1 — 이미지 AI S1 skeleton (순수 함수, node 단독 테스트용) */
  _sanitizeFbKeySegment,
  _computeImageBasedHash,
  _planImageS1Skeleton,
};
