/* ====================================================================
   functions/index.js — 가지 AI Phase A (Anthropic Claude Haiku)
   --------------------------------------------------------------------
   Phase A 포함 기능:
   - callTextAiBatch: 텍스트 1단계 (안심 정돈) — Haiku
   - callWorkCheck:   작품 검사 (진단 + 확인 방향) — Haiku

   v140 정책 반영 (AI_POLICY_V140.md):
   - 원본 body 수정 금지 (Functions는 aiVariants / aiDrafts 노드에만 기록)
   - aiVariants.textS1.final 저장 (덮어쓰기 X)
   - 1단계 후보 3회 (브랜치당)
   - testMode 우회 금지 (운영 강제)

   11단 방어 적용 (AI_COST_GUARD_PLAN.md):
   1. Firebase auth (req.auth 없으면 거부)
   2. 임시 허용 목록 (AI_TEST_ALLOWED)
   3. aiPermission.enabled + allowedModes[mode]
   4. branchLineage.copyDepth <= 1
   5. testMode 거부 (실 API)
   6. 브랜치 quota
   7. rootBranchId 묶음 quota
   8. 전역 일일 / 월간 hard cap
   9. maxInstances: 5 (Functions invocation 폭주 방지)
   10. Origin 검증 (가지 도메인이 아니면 거부)
   11. kill switch (Firebase ai-kill-switch/enabled)

   step1 ✓ 골격
   step2 ✓ 11단 검증 구현
   step3 ✓ Anthropic SDK + prompt + 응답 검증 구현 (지금)
   step4 ⏳ database.rules.json + viewer-ai.js Firebase Functions 호출
   ==================================================================== */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { setGlobalOptions } = require('firebase-functions/v2');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');
const { TEXT_S1_SYSTEM_PROMPT, TEXT_S2_SYSTEM_PROMPT, WORK_CHECK_SYSTEM_PROMPT, WRITE_AFTER_QUESTIONS_SYSTEM_PROMPT, THOUGHT_COMPASS_FOLLOWUP_SYSTEM_PROMPT, SCRIPT_DRAFT_SYSTEM_PROMPT, STUDENT_STORY_DRAFT_SYSTEM_PROMPT, buildUserMessage, buildUserMessageS2Chunk, buildScriptDraftUserMessage, buildStudentStoryDraftUserMessage, COMPASS_VALUE_SYSTEM_PROMPT, buildCompassValueUserMessage, validateCompassValueResponse, COMPASS_CHOICES_SYSTEM_PROMPT, buildCompassChoicesUserMessage, validateCompassChoicesResponse } = require('./prompts');
/* WRITE-AFTER Phase 3 — 생각 점검 질문 순수 로직(검증/정규화/snapshot 제한). firebase 비의존. */
const WAQ = require('./write-after-questions');
/* WRITE-AFTER H1/H2 — 팀 AI 접근 권한 순수 결정(super_admin/teacher/active member). RTDB read는 _checkTeamAiMembership. */
const TeamAiAuth = require('./team-ai-auth');
/* THOUGHT-COMPASS Phase 1 — AI 후속질문 순수 로직(입력/출력 검증·fallback·메시지). firebase 비의존 → 하니스 단독 검증. */
const TCFollowUp = require('./thought-compass-followup');
/* IMAGE-S2-2 — sourceMode 잠금/초기화 순수 결정 로직(firebase 비의존). callable이 RTDB transaction으로 감쌈. */
const ImageS2Policy = require('./image-s2-policy');
/* IMAGE-S2-3/4/5 — 이미지 AI(imageS2) 단일 장면 생성 순수 로직 + provider-neutral adapter(firebase 비의존). */
const ImageS2Gen = require('./image-s2-generation');
const ImageS2Adapter = require('./image-s2-adapter');
/* IMAGE-S2-9 — production OpenAI(gpt-image-2) adapter + 일괄 batch 상태 머신(firebase 비의존). */
const ImageS2OpenAi = require('./image-s2-adapter-openai');
const ImageS2Batch = require('./image-s2-batch');

/* Firebase Admin 초기화 — 1번만 */
if (!admin.apps.length) {
  admin.initializeApp();
}

/* 전역 옵션 설정 — 모든 함수에 공통 적용 */
setGlobalOptions({
  region: 'asia-northeast3',   /* 서울 — 한국 사용자 latency 최소화 */
  maxInstances: 5,             /* 11단 #9 — invocation 폭주 방지 */
  timeoutSeconds: 60,          /* 1분 timeout (클라이언트 호출 lock과 정합) */
});

/* Anthropic API key — Google Cloud Secret Manager에 보관 (step3에서 사용) */
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
/* IMAGE-S2-9 — 이미지 변환용 OpenAI key(텍스트 Anthropic과 분리). secret 미존재 시 adapter=not-configured(생성 차단·차감 0). */
const IMAGE_OPENAI_API_KEY = defineSecret('IMAGE_OPENAI_API_KEY');

/* ════════════════════════════════════════════════════════════════
   Phase A 테스트용 임시 허용 목록 (AI_SAFETY_COST_RULES.md 최상단)
   ⚠️ 운영 전환 시 teacherId/account 기반으로 교체
   ════════════════════════════════════════════════════════════════ */
const AI_TEST_ALLOWED = [
  /* 실제 Firebase classId 사용 (사용자 친화 코드 JL26A → classCodes에서 매핑)
     viewer가 URL에 넘기는 classId는 Firebase 값을 그대로 사용 (코드 변환 X) */
  { classId: 'class_2026_junglim_1', teamName: '0000' },
  { classId: 'class_2026_junglim_1', teamName: '은규' },
  { classId: 'class_2026_junglim_1', teamName: '예지유은인우' },
  { classId: 'class_2026_junglim_1', teamName: '텍스트' },
];

function isAiTestAllowed(classId, teamName) {
  return AI_TEST_ALLOWED.some(a => a.classId === classId && a.teamName === teamName);
}

/* ════════════════════════════════════════════════════════════════
   quota 상한 정의 (AI_COST_GUARD_PLAN.md 2-3·2-4·2-8)
   ════════════════════════════════════════════════════════════════ */
const QUOTA = {
  s1: 3,         /* 1단계 — 브랜치당 후보 3회 */
  s2: 2,         /* 2단계 — 브랜치당 2회 (발전은 무겁고 신중) */
  check: 5,      /* 작품 검사 — 브랜치당 5회 */
  writeAfterQuestions: 5,  /* 생각 점검 질문 — 작품검사와 동일(브랜치당 5회) */
  imageS2: 60,   /* 이미지 변환 — 작품당 월 상한(PRD §10 상한 60). 20장 작품 + 재시도/재생성 여유.
                    기존 flat 30은 20장 작품을 한 번에 못 끝내고(재시도 누적 시 30 초과 → resource-exhausted)
                    교사가 "갑자기 안 됨"을 겪던 원인. 동적 max(30,장면수×2)는 후속(여기선 안전 상한 60 고정). */
};
/* AI mode 내부값(s1/s2/check)을 사용자용 이름으로 — 사용자 메시지에 raw mode 노출 방지 */
function _aiModeLabel(mode) {
  if (mode === 's1') return '문장 정돈';
  if (mode === 's2') return '장면 발전';
  if (mode === 'check') return '작품 검사';
  if (mode === 'writeAfterQuestions') return '생각 점검 질문';
  if (mode === 'imageS1') return 'AI 그림 정돈';
  if (mode === 'imageS2') return 'AI 그림책 변환';
  return 'AI 기능';
}
const ROOT_DAILY_LIMIT = 50;       /* rootBranchId 묶음 — 하루 50회 */
const GLOBAL_DAILY_LIMIT = 2000;   /* 전역 일일 hard cap (2026-07-24: 심사 기간 안정 마진 위해 500→2000 상향) */

/* ════════════════════════════════════════════════════════════════
   Origin 검증 — 가지 도메인에서 온 요청만 허용
   ⚠️ 허용 도메인 목록 — 사용자 확정 대기 (Firebase Hosting URL 확정될 때)
   localhost 포함 — 개발할 때 사용
   ════════════════════════════════════════════════════════════════ */
const ALLOWED_ORIGINS = [
  /* Firebase Hosting URL — 사용자 확정 대기 (deploy 시 주석 해제 예정) */
  /* 'https://branch-picturebook.web.app', */
  /* 'https://branch-picturebook.firebaseapp.com', */

  /* 운영 — GitHub Pages (location.origin = 경로/슬래시 없는 scheme+host) */
  'https://chang333787-boop.github.io',

  /* 이전 — branchstory.co.kr 커스텀 도메인(2026-07-23 활성화). github.io는 유지(리다이렉트/롤백 안전).
     상세=docs/domain_migration_branchstory_plan.md */
  'https://branchstory.co.kr',
  'https://www.branchstory.co.kr',

  /* 로컬 개발 */
  'http://localhost:8765',
  'http://localhost:8000',
  'http://127.0.0.1:8765',
  'http://127.0.0.1:8000',
];

function isOriginAllowed(origin) {
  if (!origin) return false;
  /* FINAL-REVIEW-C2(2026-07-06): "목록이 비면 전체 허용" fail-open 제거 — 방어 기본값은 거부.
     실수로 ALLOWED_ORIGINS를 비워도 외부 origin이 통과하지 않는다(fail-safe). */
  return ALLOWED_ORIGINS.includes(origin);
}

/* ════════════════════════════════════════════════════════════════
   날짜 helper
   ════════════════════════════════════════════════════════════════ */
function _todayYmd() {
  /* 서버 시간은 UTC — 한국은 +9. 단순화를 위해 UTC 기준 날짜 사용 (Anthropic 콘솔과 정합) */
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
function _computeWorkCheckHash(scenesVal, anchor) {
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
  /* COMPASS-ANCHOR-1: 나침반 다짐이 있으면 해시에 포함 — 다짐이 바뀌면 재검사되고,
     다짐 없는 팀은 기존 해시와 바이트 동일(기존 캐시 보존). */
  const basis = anchor ? JSON.stringify({ s: out, a: String(anchor) }) : JSON.stringify(out);
  return { hash: _bodyHash(basis), sceneCount: out.length };
}

/* ════════════════════════════════════════════════════════════════
   COMPASS-ANCHOR-1 — 생각 나침반 '끝까지 지키고 싶은 것'(anchor) 서버 read.
   ──────────────────────────────────────────────────────────────
   · 경로: classes/{cid}/teams/{enc}/writingGuide/preWriting/answers
   · v2=coreMessage, v1=protectedCore. confirmed + !deferred + 비어있지 않을 때만.
   · 실패/부재 = null(fail-open — anchor 없이도 AI 기존 그대로 동작).
   · 클라가 보내지 않고 서버가 직접 읽음(위조 불가·클라 변경 0).
   ════════════════════════════════════════════════════════════════ */
function _pickAnchorFromAnswers(answers) {
  if (!answers || typeof answers !== 'object') return null;
  for (const key of ['coreMessage', 'protectedCore']) {
    const a = answers[key];
    if (!a || typeof a !== 'object') continue;
    if (a.deferred === true) continue;                              /* '만들면서 정할래요' 제외 */
    if (a.answerStatus && a.answerStatus !== 'confirmed') continue;
    const text = String(a.answerText || '').trim();
    if (text) return text.slice(0, 120);
  }
  return null;
}

async function _fetchCompassAnchor(classId, teamName) {
  try {
    const enc = encodeURIComponent(teamName);
    const snap = await admin.database()
      .ref(`classes/${classId}/teams/${enc}/writingGuide/preWriting/answers`).once('value');
    return _pickAnchorFromAnswers(snap.val());
  } catch (e) {
    return null;   /* anchor는 보조 신호 — 읽기 실패가 AI 기능을 막으면 안 됨 */
  }
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
   11단 검증 — 호출 진입 시 수행
   ──────────────────────────────────────────────────────────────
   각 단계에서 조건을 통과하지 못하면 HttpsError throw.
   순서: 가벼운 검증 먼저 → 무거운 검증 (DB read) 나중
   ════════════════════════════════════════════════════════════════ */

/* WRITE-AFTER H1/H2 — soft-launch 플래그. aiAuthEnforce/enabled === true 일 때만 팀 권한 차단.
   기본(부재/false) = log-only(기존 동작 유지). read 실패도 log-only로 안전 fallback. */
async function _isAiAuthEnforced() {
  try {
    const s = await admin.database().ref('aiAuthEnforce/enabled').once('value');
    return s.val() === true;
  } catch (e) { return false; }
}

/* WRITE-AFTER H1/H2 — 팀 AI 접근 권한 검사(RTDB read + 순수 결정 TeamAiAuth.decideTeamAiAccess).
   super_admin → teacher_uid → members/{uid}/status 순으로 최소 read(먼저 통과하면 이후 read 생략).
   반환: { allowed, role, reason? }. 결정 로직은 functions/team-ai-auth.js(테스트됨). */
async function _checkTeamAiMembership(args) {
  const classId = args.classId; const teamName = args.teamName; const uid = args.uid; const role = args.role || null;
  if (role === 'super_admin') return TeamAiAuth.decideTeamAiAccess({ role: 'super_admin' });
  let isTeacher = false;
  try {
    const t = await admin.database().ref(`classes/${classId}/meta/teacher_uid`).once('value');
    if (t.val() === uid) isTeacher = true;
  } catch (e) { isTeacher = false; }
  if (isTeacher) return TeamAiAuth.decideTeamAiAccess({ isTeacher: true });
  let memberStatus = null;
  try {
    const enc = encodeURIComponent(teamName);
    const m = await admin.database().ref(`classes/${classId}/teams/${enc}/members/${uid}/status`).once('value');
    memberStatus = m.val();
  } catch (e) { memberStatus = null; }
  return TeamAiAuth.decideTeamAiAccess({ isTeacher: false, memberStatus });
}

/* ════════════════════════════════════════════════════════════════
   IMAGE-S2-STUDENT-1(2026-07-14): AI 그림책 마감(imageS2) 실행 자격.
   ──────────────────────────────────────────────────────────────
   교사(super_admin ∥ 학급 teacher_uid) 또는 "그 팀 active 멤버(=자기 모둠 작품)".
   _validateRequest가 이미 학급 AI enabled + modes.imageS2 를 보장하므로,
   여기서는 "누가"만 판정 — 남의 팀 그림을 임의로 변환하는 것만 차단(멤버십).
   반환: { ok:boolean, isTeacher:boolean }. ok=false면 호출부가 permission-denied.
   ════════════════════════════════════════════════════════════════ */
async function _resolveImageS2Actor(ctx, req) {
  let isTeacher = ((req.auth.token && req.auth.token.role) === 'super_admin');
  if (!isTeacher) {
    try {
      const tSnap = await admin.database().ref(`classes/${ctx.classId}/meta/teacher_uid`).once('value');
      if (tSnap.val() === ctx.uid) isTeacher = true;
    } catch (e) { isTeacher = false; }
  }
  if (isTeacher) return { ok: true, isTeacher: true };
  /* 학생: 자기 모둠(active member)일 때만 허용 */
  let activeMember = false;
  try {
    const enc = encodeURIComponent(ctx.teamName);
    const ms = await admin.database().ref(`classes/${ctx.classId}/teams/${enc}/members/${ctx.uid}/status`).once('value');
    activeMember = (ms.val() === 'active');
  } catch (e) { activeMember = false; }
  return { ok: activeMember, isTeacher: false };
}

async function _validateRequest(req, mode, opts) {
  /* opts.skipUsageLimits=true → 사용량 한도(전역/root/브랜치 quota) 검사를 건너뜀.
     saveTextVariant(저장 전용)는 AI를 호출하지 않으므로 quota 소진 후에도 저장 가능해야 함.
     권한 게이트(auth/testMode/허용목록/copyDepth/origin/killswitch/aiSettings)는 그대로 적용. */
  const skipUsageLimits = !!(opts && opts.skipUsageLimits);

  /* 1. Firebase auth (anonymous라도 필요) */
  if (!req.auth || !req.auth.uid) {
    throw new HttpsError('unauthenticated', '로그인이 필요해요.');
  }

  /* 5. testMode 거부 — v140 핵심. client가 testMode를 보내도 실 API 호출 금지 */
  if (req.data && req.data.testMode === true) {
    /* 감사 L5(2026-07-21): req.data 전체(작품 본문 포함)를 로그에 남기지 않음 — 식별 최소만 */
    logger.warn('[ai] testMode 우회 시도 차단', {
      uid: req.auth.uid,
      classId: req.data ? String(req.data.classId || '') : '',
      teamName: req.data ? String(req.data.teamName || '') : '',
    });
    throw new HttpsError('permission-denied', 'testMode로는 실제 AI를 사용할 수 없어요.');
  }

  /* 요청 데이터 추출 */
  const data = req.data || {};
  const classId = String(data.classId || '');
  const teamName = String(data.teamName || '');
  const workId = String(data.workId || '');
  const rootBranchId = data.rootBranchId ? String(data.rootBranchId) : null;
  const copyDepth = Number.isFinite(data.copyDepth) ? data.copyDepth : 0;

  if (!classId || !teamName) {
    throw new HttpsError('invalid-argument', 'classId / teamName이 없어요.');
  }
  /* workId 참고 — 가지 데이터 모델에서는 team 자체가 곧 한 작품. workId가 없으면 teamName을 사용. */
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

  /* 4. copyDepth <= 1 (모/자식 브랜치만 허용 — 손자 금지) */
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
     참조 노드: classes/{classId}/teams/{teamName}/works/{workId}/aiPermission
     ⚠️ 실제 가지 운영 적용 시 — 노드 위치를 실제 데이터 모델에 맞춰야 함.
     주의 — Phase A 시점에는 이 노드가 없을 가능성 — 없으면 기본 ON 처리 (Phase A 테스트라).
     운영 시점 — 노드가 있어야 함 (사용자가 maker.html에서 설정할 예정). */
  /* Phase 1 — 교사 AI 권한 게이트. 우선순위:
       (a) AI_TEST_ALLOWED 하드게이트 = 위(2번)에서 이미 통과해야 도달.
       (b) classes/{classId}/aiSettings 존재 → 진실. enabled + modes[modeKey].
       (c) aiSettings 없음 → 기존 teams/{teamName}/aiPermission fallback (동작 보존).
       (d) 둘 다 없음 → 기본 ON (Phase A 호환).
     모든 검사는 quota 차감(_consumeQuota, 핸들러) 전에 수행됨. */
  const MODE_KEY_MAP = { s1: 'textS1', s2: 'textS2', check: 'workCheck', writeAfterQuestions: 'writeAfterQuestions', imageS1: 'imageS1', imageS2: 'imageS2', storyDraft: 'storyDraft' /* PICTUREBOOK-LEVELS ③ */ };
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

  /* H1/H2 FIX — 팀 소유권 게이트 (quota 차감 前). super_admin/이 학급 teacher_uid/이 팀 active member만.
     soft-launch: aiAuthEnforce/enabled=true 일 때만 차단, 아니면 log-only(기존 동작 유지). PIN/body/작품내용 로그 금지. */
  {
    const tokenRole = (req.auth.token && req.auth.token.role) || null;
    const access = await _checkTeamAiMembership({ classId, teamName, uid: req.auth.uid, role: tokenRole });
    if (!access.allowed) {
      const enforced = await _isAiAuthEnforced();
      if (enforced) {
        throw new HttpsError('permission-denied', '이 팀에서 AI 기능을 사용할 권한이 없어요. 다시 입장해 주세요.');
      }
      logger.warn('[ai/auth] AI_AUTH_MEMBERSHIP_MISSING (soft-launch log-only)', {
        classId, teamName, uid: req.auth.uid, mode, reason: access.reason,
      });
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
   quota 차감 / 환불 (Firebase 트랜잭션 사용)
   ──────────────────────────────────────────────────────────────
   7가지 환불 정책 (AI_SAFETY_COST_RULES.md 5-1 반영):
   1. 호출 전 취소 → 차감 X (호출 자체가 없어 차감이 일어나지 않음)
   2. 호출 도중 [취소] → 차감 그대로 (환불 X) — 이미 발생한 비용이므로
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
  /* STORYDRAFT-SAFETY-1(2026-07-21): 극단 폭력 — 초등 저학년 동화에 절대 부적합한 대량살상어만
     좁게. ⚠️'죽다·싸우다·총싸움 놀이·칼싸움' 같은 정상 서사는 절대 잡지 않도록 고정밀 유지
     (사용자 연습5 '학살' 대응·과차단 실측 0). */
  violence_extreme: [
    /학살|몰살|대량\s*살상|무차별\s*(총격|살해|난사)|기관총\s*난사|집단\s*(학살|살해)/,
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
   max_tokens: 8000 (AI_COST_GUARD_PLAN.md 2-2-1 반영)
   ════════════════════════════════════════════════════════════════ */
const HAIKU_MODEL = 'claude-haiku-4-5';
/* 텍스트 2단계 전용 모델 — 기본은 Haiku로 선테스트. 품질/원작보존이 부족하면 이 한 줄만
   Sonnet으로 승격(예: const S2_MODEL = 'claude-sonnet-4-5';). s1/작품검사는 Haiku 그대로. */
const S2_MODEL = HAIKU_MODEL;
const MAX_TOKENS = 8000;
const ANTHROPIC_TIMEOUT_MS = 50000;  /* Functions timeout 60s 기준 — 여유 10s */

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
const S2_MAX_SCENES = 30;    /* 본문 있는 장면 수 상한. 초과 시 호출 前 차단(quota 차감 X).
                                S2-CAP-30(2026-07-20 사용자 결정): 24→30 — 실작품(25장면+)이 걸림.
                                s2는 청크 처리(T2-INFRA-1)라 30장면도 토큰 예산 안전. */
/* T2-JSON-RETRY(2026-07-16): 청크 JSON 파싱 실패 시 재호출에 덧붙이는 엄격 JSON 리마인더.
   원인=모델이 문자열 값 안 따옴표/줄바꿈을 이스케이프 안 함(대사 많은 아이 글). */
const JSON_STRICT_RETRY_REMINDER = '\n\n[매우 중요] 앞선 응답의 JSON이 깨졌습니다. 반드시 유효한 JSON 하나만 출력하세요. 문자열 값 안의 큰따옴표(")는 반드시 \\" 로, 줄바꿈은 \\n 으로 이스케이프하세요. JSON 앞뒤에 설명·마크다운·코드펜스를 붙이지 마세요.';

/* opts(선택): { maxTokens, timeoutMs } — SCRIPT-DRAFT-1처럼 출력이 큰 호출만 개별 상향.
   미전달 시 기존 상수 그대로라 기존 핸들러 동작 불변. */
async function _callAnthropic(apiKey, systemPrompt, userMessage, model, opts) {
  const o = opts || {};
  const client = new Anthropic({ apiKey, timeout: o.timeoutMs || ANTHROPIC_TIMEOUT_MS });

  const response = await client.messages.create({
    model: model || HAIKU_MODEL,
    max_tokens: o.maxTokens || MAX_TOKENS,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userMessage }
    ],
  });

  /* 응답에서 text block 추출 */
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
   prompts/text-strength-1.md v3에 정의된 규칙:
   - safeAddition / creativeAddition이 있으면 자동 거부 (1단계 위반)
   - revisedText 또는 skip union이어야 함
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
  /* HANGUL-RATIO-DIGIT-FIX(2026-07-16): 분모 = 한글 + 영문 글자만. 숫자·공백·문장부호는 제외.
     이 검사의 목적은 "AI가 한국어 대신 영어 gibberish를 뱉는 것" 차단인데, 숫자는 외국어가 아니라
     정당한 내용(예: "29억 7926만 2376일 16시간 32분 17초...")이라 분모에 넣으면 숫자 많은 장면이
     한글비율 미달로 오거부됨. 숫자를 빼면 영어 gibberish는 여전히 걸리고 숫자 많은 한글 글은 통과. */
  const text = (str.match(/[가-힣a-zA-Z]/g) || []).length;
  if (text === 0) return 1;   /* 한글·영문 글자 0 (숫자/기호뿐) → 통과(외국어 아님) */
  return hangul / text;
}

/* sceneId 정규화 — Anthropic이 'scene_1'처럼 반환할 때 '1'로 변환. 존재하지 않는 sceneId 제거. */
function _normalizeResults(results, snapshot) {
  if (!results || typeof results !== 'object') return {};
  const validIds = new Set(Object.keys(snapshot || {}));
  const normalized = {};
  const dropped = [];
  for (const rawKey of Object.keys(results)) {
    let key = String(rawKey);
    /* scene_, scene-, scene 형태 접두사 제거 */
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
      /* HARDCUT-SKIP(#59): 전체 throw(배치 전체 실패·quota 소모·'되는 애 안되는 애' 오안내) 대신
         이 장면만 skip(원본 유지) — 한 장면이 상한을 넘겨도 나머지 장면은 정상 발전. 기존 skip 패턴 재사용. */
      r.skip = true;
      r.reason = '문장이 너무 길어져 이 장면은 그대로 두었어요.';
      delete r.revisedText; delete r.summary; delete r.changes;
      if (strongWarnings.length > 0) r.strongWarnings = strongWarnings;
      if (weakWarnings.length > 0) r.weakWarnings = weakWarnings;
      continue;
    }

    /* ─── 한글 비율 70% 미만 (기존 유지, 전체 throw) ─── */
    if (_hangulRatio(revised) < 0.7) {
      /* HANGUL-SKIP(#59): 전체 throw 대신 이 장면만 skip(원본 유지). 숫자·영문 많은 한 장면 때문에
         배치 전체가 실패하던 것 방지. 기존 skip 패턴 재사용. */
      r.skip = true;
      r.reason = '한글이 아닌 내용이 많아 이 장면은 그대로 두었어요.';
      delete r.revisedText; delete r.summary; delete r.changes;
      if (strongWarnings.length > 0) r.strongWarnings = strongWarnings;
      if (weakWarnings.length > 0) r.weakWarnings = weakWarnings;
      continue;
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
  /* 본문 수정 결과가 들어 있으면 거부 (검사 위반) */
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
      /* HARDCUT-SKIP(#59): 전체 throw(배치 전체 실패·quota 소모·'되는 애 안되는 애' 오안내) 대신
         이 장면만 skip(원본 유지) — 한 장면이 상한을 넘겨도 나머지 장면은 정상 발전. 기존 skip 패턴 재사용. */
      r.skip = true;
      r.reason = '문장이 너무 길어져 이 장면은 그대로 두었어요.';
      delete r.revisedText; delete r.summary; delete r.changes;
      if (strongWarnings.length > 0) r.strongWarnings = strongWarnings;
      if (weakWarnings.length > 0) r.weakWarnings = weakWarnings;
      continue;
    }

    /* 한글 비율 (전체 throw) */
    if (_hangulRatio(revised) < 0.7) {
      /* HANGUL-SKIP(#59): 전체 throw 대신 이 장면만 skip(원본 유지). 숫자·영문 많은 한 장면 때문에
         배치 전체가 실패하던 것 방지. 기존 skip 패턴 재사용. */
      r.skip = true;
      r.reason = '한글이 아닌 내용이 많아 이 장면은 그대로 두었어요.';
      delete r.revisedText; delete r.summary; delete r.changes;
      if (strongWarnings.length > 0) r.strongWarnings = strongWarnings;
      if (weakWarnings.length > 0) r.weakWarnings = weakWarnings;
      continue;
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
   step2 범위 — 11단 검증 + quota 차감 구현.
   Anthropic 호출은 step3에서.
   ════════════════════════════════════════════════════════════════ */
exports.callTextAiBatch = onCall(
  {
    secrets: [ANTHROPIC_API_KEY],
    enforceAppCheck: false,   /* AI_APP_CHECK_ANALYSIS.md 결론 B — Phase A 미적용 (Phase B에서 적용) */
  },
  async (req) => {
    /* 1~11단 검증 수행 */
    const ctx = await _validateRequest(req, 's1');

    /* snapshot이 없으면 거부 */
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

    /* quota 차감 (호출 직전) */
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

      /* 비용 추정 + stats 기록 */
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
      /* HttpsError는 그대로 throw */
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
async function _runS2Chunks(snapshot, callFn, anchor) {
  const allIds = Object.keys(snapshot || {});
  const chunks = _chunkSceneIds(allIds, S2_CHUNK_SIZE);
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const pickedParts = await _runWithConcurrency(chunks, S2_CONCURRENCY, async (targetIds, idx) => {
    /* COMPASS-ANCHOR-1: anchor는 모든 chunk에 동일 전달(미전달=기존 바이트 동일) */
    const userMsg = buildUserMessageS2Chunk(snapshot, targetIds, anchor);
    const ai = await callFn(targetIds, userMsg, idx);
    totalInputTokens += (ai && ai.inputTokens) || 0;
    totalOutputTokens += (ai && ai.outputTokens) || 0;

    /* T2-JSON-RETRY(2026-07-16): 모델이 문자열 값 안 따옴표/줄바꿈 이스케이프를 빠뜨려 JSON이 깨지면
       (대사 따옴표 많은 아이 글에서 발생·확률적) 그 청크만 1회 재호출 — 엄격 JSON 리마인더 첨부.
       재시도도 실패하면 기존처럼 throw → 전체 환불. s1/작품검사는 이 경로를 안 타므로 무영향. */
    let parsed;
    try {
      parsed = _parseJsonStrict(ai && ai.text);
    } catch (e) {
      logger.warn('[ai/s2] chunk JSON 파싱 실패 — 1회 재시도', { chunk: idx + 1, error: e.message });
      const retryMsg = userMsg + JSON_STRICT_RETRY_REMINDER;
      let ai2;
      try {
        ai2 = await callFn(targetIds, retryMsg, idx);
      } catch (callErr) {
        throw new Error(`chunk ${idx + 1}/${chunks.length} 재호출 실패: ${(callErr && callErr.message) || callErr}`);
      }
      totalInputTokens += (ai2 && ai2.inputTokens) || 0;
      totalOutputTokens += (ai2 && ai2.outputTokens) || 0;
      try {
        parsed = _parseJsonStrict(ai2 && ai2.text);
      } catch (e2) {
        throw new Error(`chunk ${idx + 1}/${chunks.length} JSON 파싱 실패(재시도 후): ${e2.message}`);
      }
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
          _callAnthropic(ANTHROPIC_API_KEY.value(), TEXT_S2_SYSTEM_PROMPT, userMsg, S2_MODEL),
          await _fetchCompassAnchor(ctx.classId, ctx.teamName));   /* COMPASS-ANCHOR-1 */

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
    /* COMPASS-ANCHOR-1: 다짐은 해시 계산 전에 읽는다(다짐 변경=캐시 무효) */
    const _anchor = await _fetchCompassAnchor(ctx.classId, ctx.teamName);
    let _curHash = null;
    let _curSceneCount = 0;
    try {
      const _scenesSnap = await admin.database().ref(`classes/${ctx.classId}/teams/${_enc}/scenes`).once('value');
      const _h = _computeWorkCheckHash(_scenesSnap.val(), _anchor);
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
      /* LEVELS-CONT: 그림책 1·2단계=일직선 잠금 — 서버가 직접 read(클라 위조 불가).
         읽기 실패 시 false=기존 프롬프트 그대로(페일세이프). */
      let _linearLocked = false;
      try {
        const _lvl = Number((await admin.database()
          .ref(`classes/${ctx.classId}/teams/${_enc}/viewer-meta/picturebookLevel`).once('value')).val());
        _linearLocked = (_lvl === 1 || _lvl === 2);
      } catch (e) { _linearLocked = false; }
      const userMsg = buildUserMessage(snapshot, 'check', _anchor, { linearLocked: _linearLocked });
      const ai = await _callAnthropic(ANTHROPIC_API_KEY.value(), WORK_CHECK_SYSTEM_PROMPT, userMsg);

      logger.info('[ai/check] Anthropic 응답 박힘', {
        inputTokens: ai.inputTokens, outputTokens: ai.outputTokens, stopReason: ai.stopReason,
      });

      /* CHECK-JSON-RETRY(2026-07-20): 대사 따옴표 많은 아이 글에서 모델 JSON이 확률적으로 깨짐
         (2단계 4팀 실주행 팀4 실측 — T2-JSON-RETRY와 동일 원인) → 엄격 JSON 리마인더를 붙여
         1회 재호출. 재시도도 실패하면 기존처럼 환불+throw. 성공 시 토큰은 두 호출 합산 계상. */
      let parsed;
      let aiFinal = ai;
      try {
        parsed = _parseJsonStrict(ai.text);
        _validateWorkCheckResponse(parsed);
      } catch (parseErr) {
        logger.warn('[ai/check] JSON/schema 실패 — 1회 재시도', { error: parseErr.message });
        try {
          const ai2 = await _callAnthropic(ANTHROPIC_API_KEY.value(), WORK_CHECK_SYSTEM_PROMPT,
            userMsg + JSON_STRICT_RETRY_REMINDER);
          parsed = _parseJsonStrict(ai2.text);
          _validateWorkCheckResponse(parsed);
          aiFinal = {
            inputTokens: (ai.inputTokens || 0) + (ai2.inputTokens || 0),
            outputTokens: (ai.outputTokens || 0) + (ai2.outputTokens || 0),
            stopReason: ai2.stopReason,
          };
        } catch (retryErr) {
          await _refundQuota(ctx);
          logger.error('[ai/check] schema 위반(재시도 후) — 환불 박음', { error: retryErr.message, text: ai.text.slice(0, 500) });
          throw new HttpsError('internal', 'AI 응답 검증 실패: ' + retryErr.message);
        }
      }

      const cost = _estimateCostUsd(aiFinal.inputTokens, aiFinal.outputTokens);
      _logUsageStats(ctx, aiFinal, cost).catch(e => logger.warn('stats 박지 X', e));

      const result = {
        ...parsed,
        meta: {
          model: HAIKU_MODEL,
          inputTokens: aiFinal.inputTokens,
          outputTokens: aiFinal.outputTokens,
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
   WRITE-AFTER Phase 3 — callWriteAfterQuestions (생각 점검 질문)
   ─────────────────────────────────────────────
   AI는 작품을 읽고 학생이 스스로 돌아볼 "질문"만 만든다. 글/사건/대사/결말 대필 금지.
   callWorkCheck 패턴 동일(권한·precheck·quota·Anthropic·환불). 차이:
   · 전송 전 WAQ.sanitizeSnapshotForQuestions로 장면/글자수 제한 + 이미지/내부필드 제거.
   · WAQ.validateQuestionsResponse로 질문 3~6개·실존 sceneId·대필키 거부 검증.
   · 결과는 aiChecks/writeAfterQuestions/latest에 best-effort 저장(최근 결과 보기). 해시캐시는 후속.
   ⚠️ 운영 활성화는 secret(기존 ANTHROPIC_API_KEY)·functions deploy·aiSettings.modes.writeAfterQuestions
      ON 필요(기본 OFF). 미배포 시 클라는 functions/not-found로 안전 실패. */
exports.callWriteAfterQuestions = onCall(
  {
    secrets: [ANTHROPIC_API_KEY],
    enforceAppCheck: false,
  },
  async (req) => {
    const ctx = await _validateRequest(req, 'writeAfterQuestions');

    const rawSnapshot = (req.data && req.data.snapshot) || {};
    if (!rawSnapshot || Object.keys(rawSnapshot).length === 0) {
      throw new HttpsError('invalid-argument', 'snapshot이 없어요 (본문이 있는 장면이 없어요)');
    }
    /* 전송 전 안전 제한(장면 ≤25·body 500자·선택지 100자·이미지/내부필드 제거). */
    const snapshot = WAQ.sanitizeSnapshotForQuestions(rawSnapshot);
    const validSceneIds = Object.keys(snapshot);
    if (validSceneIds.length === 0) {
      throw new HttpsError('invalid-argument', '질문을 만들 장면이 없어요.');
    }

    logger.info('[ai/writeAfterQuestions] 검증 통과', {
      uid: ctx.uid, classId: ctx.classId, teamName: ctx.teamName, workId: ctx.workId,
      used: ctx.used, quotaMax: ctx.quotaMax, sceneCount: validSceneIds.length,
    });

    /* Phase 2 — safety precheck + quick check (quota 차감 前, AI 호출 前) */
    const precheck = await _runAiPrecheck(ctx, snapshot, 'writeAfterQuestions');
    if (precheck && precheck.blocked) {
      logger.info('[ai/writeAfterQuestions] precheck 차단', { reasonCode: precheck.reasonCode });
      return precheck;
    }

    await _consumeQuota(ctx);

    try {
      const userMsg = buildUserMessage(snapshot, 'writeAfterQuestions',
        await _fetchCompassAnchor(ctx.classId, ctx.teamName));   /* COMPASS-ANCHOR-1 */
      const ai = await _callAnthropic(ANTHROPIC_API_KEY.value(), WRITE_AFTER_QUESTIONS_SYSTEM_PROMPT, userMsg);

      logger.info('[ai/writeAfterQuestions] Anthropic 응답', {
        inputTokens: ai.inputTokens, outputTokens: ai.outputTokens, stopReason: ai.stopReason,
      });

      let parsed;
      try {
        parsed = _parseJsonStrict(ai.text);
        parsed = WAQ.validateQuestionsResponse(parsed, { validSceneIds, promptVersion: 'waq-v1' });
      } catch (parseErr) {
        await _refundQuota(ctx);
        logger.error('[ai/writeAfterQuestions] schema 위반 — 환불', { error: parseErr.message, code: parseErr.code, text: ai.text.slice(0, 500) });
        throw new HttpsError('internal', 'AI 응답 검증 실패: ' + parseErr.message);
      }

      const cost = _estimateCostUsd(ai.inputTokens, ai.outputTokens);
      _logUsageStats(ctx, ai, cost).catch(e => logger.warn('stats 실패', e));

      const result = {
        ok: true,
        type: 'writeAfterQuestions',
        summary: parsed.summary,
        questions: parsed.questions,
        meta: {
          model: HAIKU_MODEL,
          inputTokens: ai.inputTokens,
          outputTokens: ai.outputTokens,
          estimatedCostUsd: cost,
          promptVersion: parsed.version,
          phase: 'phase-a',
        },
      };

      /* 최근 결과 저장(best-effort) — 학생이 'AI 재호출 없이 마지막 질문 보기'에 사용. 저장 실패는 무시. */
      try {
        const _enc = encodeURIComponent(ctx.teamName);
        await admin.database()
          .ref(`classes/${ctx.classId}/teams/${_enc}/aiChecks/writeAfterQuestions/latest`)
          .set({
            result,
            sceneCount: validSceneIds.length,
            checkedAt: Date.now(),
            checkedBy: ctx.uid,
            model: HAIKU_MODEL,
            version: 'waq-v1',
          });
      } catch (e) {
        logger.error('[ai/writeAfterQuestions] latest write 실패(결과는 정상 반환)', { error: e && e.message });
      }

      return result;

    } catch (e) {
      if (e instanceof HttpsError) throw e;
      await _refundQuota(ctx);
      logger.error('[ai/writeAfterQuestions] 호출 실패 — 환불', { error: e.message, stack: e.stack });
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
   IMAGE-S2-3/4/5 — callImageAiS2 (단일 장면 이미지 변환 생성)
   ──────────────────────────────────────────────────────────────
   정본 PRD §4·§9·§10·§11·§13·§14. 순수 로직은 image-s2-generation.js,
   provider 계약은 image-s2-adapter.js. 이 콜러블은 thin wrapper:
     1) _validateRequest(imageS2) — auth/aiSettings.modes.imageS2/origin/killswitch + quota 게이트.
     2) 생성=교사만(PRD §8) → teacher_uid/super_admin 확인, 아니면 permission-denied.
     3) client는 sceneId만(임의 URL/경로/프롬프트 금지) → normalizeGenerationRequest.
     4) runImageS2Generation 에 Firebase read/write·Storage·모델 adapter·quota 를 deps 주입.
   ⚠️ 모델 미확정(PRD §16) → 기본 adapter=not-configured(생성 차단, 차감 0). env IMAGE_S2_ADAPTER=fake 일 때만 stub.
   원본 scene.imageData/imageUrl 는 절대 write 안 함. 결과는 ai-images/ + aiVariants/image 만.
   ════════════════════════════════════════════════════════════════ */
/* 원본 bytes 다운로드 — SSRF 안전: data: 디코드 또는 우리 bucket 객체만 admin.storage 로 read.
   외부 URL/임의 호스트는 절대 fetch 하지 않는다(firebasestorage URL의 객체 path만 추출). */
async function _downloadImageS2Source(src) {
  const s = String(src == null ? '' : src);
  if (s.indexOf('data:') === 0) {
    const m = s.match(/^data:([^;]+);base64,(.*)$/);
    if (!m) throw new Error('BAD_DATA_URI');
    return { bytes: Buffer.from(m[2], 'base64'), mime: m[1] };
  }
  let u;
  try { u = new URL(s); } catch (e) { throw new Error('BAD_SOURCE_URL'); }
  const bkt = admin.storage().bucket();
  /* 우리 버킷 별칭(별도 GCS 버킷 read 금지) — Storage 마이그레이션 작품은 storage.googleapis.com URL로 저장됨. */
  const OUR_BUCKETS = [bkt.name, 'picturebook-8731f.firebasestorage.app', 'picturebook-8731f.appspot.com'];
  let objectPath = null;
  if (u.host === 'firebasestorage.googleapis.com') {
    /* https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encodedObjectPath}?alt=media&token=... */
    const m = u.pathname.match(/\/o\/(.+)$/);
    if (!m) throw new Error('BAD_OBJECT_PATH');
    objectPath = decodeURIComponent(m[1]);
  } else if (u.host === 'storage.googleapis.com') {
    /* https://storage.googleapis.com/{bucket}/{objectPath} — 우리 버킷만. */
    const segs = u.pathname.replace(/^\/+/, '').split('/');
    const urlBucket = segs.shift() || '';
    if (OUR_BUCKETS.indexOf(urlBucket) === -1) throw new Error('SOURCE_HOST_NOT_ALLOWED');
    objectPath = decodeURIComponent(segs.join('/'));
  } else {
    throw new Error('SOURCE_HOST_NOT_ALLOWED');
  }
  if (!objectPath || objectPath.indexOf('..') !== -1) throw new Error('BAD_OBJECT_PATH');
  /* 원본 이미지 경로(images/)만 — ai-images/·videos/·기타 버킷 객체 read 차단(defense-in-depth). */
  if (objectPath.indexOf('images/') !== 0) throw new Error('SOURCE_PATH_NOT_ALLOWED');
  const [buf] = await bkt.file(objectPath).download();
  return { bytes: buf, mime: ImageS2OpenAi.sniffMime(buf) };
}

/* adapter 선택 — IMAGE_OPENAI_API_KEY secret 있으면 production OpenAI(gpt-image-2),
   없으면 not-configured(생성 차단·차감 0). env IMAGE_S2_ADAPTER=fake 는 테스트 stub. */
function _selectImageS2Adapter(opts) {
  if (process.env.IMAGE_S2_ADAPTER === 'fake') return ImageS2Adapter.createFakeAdapter();
  let key = '';
  try { key = IMAGE_OPENAI_API_KEY.value() || ''; } catch (e) { key = ''; }
  if (key) {
    return ImageS2OpenAi.createOpenAiImageS2Adapter({
      apiKey: key, model: 'gpt-image-2', timeoutMs: 150000,
      downloadImpl: (opts && opts.downloadImpl) || _downloadImageS2Source,
    });
  }
  return ImageS2Adapter.createNotConfiguredAdapter();
}

/* 이미지 결과 Storage 업로드(Admin SDK) — ai-images/ 경로에 고유 객체 저장 + 다운로드 토큰 URL 반환. */
async function _uploadImageS2Result(opts) {
  const { storagePath, bytes, mimeType } = opts;
  if (!ImageS2Gen.isAllowedS2StoragePath(storagePath) || ImageS2Gen.isOriginalImageStoragePath(storagePath)) {
    throw new Error('IMAGE_AI_INTERNAL_PATH');   /* ai-images/ 외 경로 업로드 금지(원본 보호) */
  }
  const token = require('crypto').randomUUID();
  const bucket = admin.storage().bucket();
  const file = bucket.file(storagePath);
  await file.save(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), {
    resumable: false,
    contentType: mimeType || 'image/png',
    metadata: {
      cacheControl: 'public,max-age=31536000,immutable',
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
  return { url, storagePath };
}

/* MOOD-P8(2026-07-14): 팀 scenes 전체 본문을 장면 순서대로 모아 "책 전체 이야기" 문자열 생성.
   어댑터 W-A 프레임이 책 단위 무대/분위기 일관성에 사용(장소 미기재 중간 페이지가 지구로 새는 것 방지).
   원본 scenes read-only. 실패/빈 작품이면 '' 반환 → 어댑터는 P7 동작(페일세이프). */
async function _buildWholeStoryText(baseRef) {
  try {
    const snap = await baseRef.child('scenes').once('value');
    const scenes = snap.val();
    if (!scenes || typeof scenes !== 'object') return '';
    const ids = Object.keys(scenes).filter((k) => scenes[k] != null);
    ids.sort((a, b) => {
      const na = Number(a); const nb = Number(b);
      if (isFinite(na) && isFinite(nb)) return na - nb;
      return a < b ? -1 : (a > b ? 1 : 0);
    });
    const parts = [];
    ids.forEach((k) => {
      const b = (scenes[k] && typeof scenes[k].body === 'string') ? scenes[k].body.trim() : '';
      if (b) parts.push(b);
    });
    return parts.join(' / ');
  } catch (e) {
    return '';
  }
}

exports.callImageAiS2 = onCall(
  /* IMAGE-S2-9: OpenAI secret 결선. gpt-image-2 medium 50~70s+ → per-function timeout 상향(전역 60s override).
     secret 미존재 시 adapter=not-configured → 생성 차단·차감 0(안전 기본 유지). */
  { enforceAppCheck: false, secrets: [IMAGE_OPENAI_API_KEY], timeoutSeconds: 300 },
  async (req) => {
    /* 권한 + quota 게이트(imageS2). MODE_KEY_MAP.imageS2 → aiSettings.modes.imageS2 필요. */
    const ctx = await _validateRequest(req, 'imageS2', { skipUsageLimits: false });

    /* IMAGE-S2-STUDENT-1: 교사 또는 그 팀 active 멤버(자기 모둠 작품). 학급 AI enabled+imageS2는 _validateRequest가 이미 보장. */
    const actor = await _resolveImageS2Actor(ctx, req);
    if (!actor.ok) {
      throw new HttpsError('permission-denied', '내 모둠 그림만 AI 마감할 수 있어요.');
    }
    /* 생성 코어(decideGenerationGate)의 isTeacher는 '생성 인가' 게이트일 뿐 —
       바깥에서 교사/멤버 인가를 이미 마쳤으므로 인가된 호출(학생 자기 모둠 포함)은 통과시킨다.
       실제 교사 여부가 필요하면 actor.isTeacher. (IMAGE-S2-STUDENT-1) */
    const genAuthorized = true;

    /* client는 sceneId만 — 임의 URL/Storage path/base64/프롬프트 거부(PRD §13). */
    const norm = ImageS2Gen.normalizeGenerationRequest(req.data);
    if (!norm.ok) {
      throw new HttpsError('invalid-argument', norm.message || '요청 형식이 올바르지 않아요.');
    }
    const sid = norm.value.sceneId;
    const enc = encodeURIComponent(ctx.teamName);
    const baseRef = admin.database().ref(`classes/${ctx.classId}/teams/${enc}`);
    const adapter = _selectImageS2Adapter();
    /* MOOD-P8: 책 전체 이야기(무대/분위기 일관성). read-only·실패 시 '' → P7 페일세이프. */
    const wholeStoryText = await _buildWholeStoryText(baseRef);
    /* LEVEL2-DRAW STRONG(2026-07-21): 2단계=졸라맨 구도만 지키고 강변환. 서버 직접 read(위조 불가).
       3단계·레거시는 transformMode 미주입 → 어댑터 P8 원본 보존(byte 동일·회귀 0).
       characterSheet: 있으면(초안/추후 추출) 캐릭터 고정 주입 — 없어도 whole-story로 일관성. */
    let _s2TransformMode; let _s2CharSheet = ''; let _s2ProtRef = '';
    try {
      const _lvl = Number((await baseRef.child('viewer-meta/picturebookLevel').once('value')).val());
      if (_lvl === 2) {
        _s2TransformMode = 'strong';
        const _cs = (await baseRef.child('aiVariants/characterSheet').once('value')).val();
        if (typeof _cs === 'string' && _cs.trim()) _s2CharSheet = _cs.trim().slice(0, 500);
        /* LEVEL2-CHAR: 우리 주인공 레퍼런스 URL(viewer-meta/protagonistRef). https만·2번째 이미지로. */
        const _pr = (await baseRef.child('viewer-meta/protagonistRef').once('value')).val();
        if (typeof _pr === 'string' && /^https:\/\//.test(_pr.trim())) _s2ProtRef = _pr.trim();
      }
    } catch (e) { _s2TransformMode = undefined; }   /* read 실패 = 기존 P8 페일세이프 */

    const result = await ImageS2Gen.runImageS2Generation(
      { classId: ctx.classId, enc, sceneId: sid, forceRegenerate: norm.value.forceRegenerate, isTeacher: genAuthorized, wholeStoryText, transformMode: _s2TransformMode, characterSheet: _s2CharSheet, protagonistRefSrc: _s2ProtRef },
      {
        readScene: async (s) => { const snap = await baseRef.child(`scenes/${s}`).once('value'); return snap.val(); },
        readPolicy: async () => { const snap = await baseRef.child('viewer-meta/imagePolicy').once('value'); return snap.val(); },
        readExistingVariant: async (s) => { const snap = await baseRef.child(`aiVariants/image/${s}/s2`).once('value'); return snap.val(); },
        adapter,
        uploadResult: _uploadImageS2Result,
        verifyDownloadable: async (/* url */) => true,   /* 업로드 직후 save 성공 = 객체 존재. 실 다운로드 확인은 S2-4 강화. */
        writeVariant: async (s, variant) => { await baseRef.child(`aiVariants/image/${s}/s2`).set(variant); },
        recordCleanup: async (rec) => { await admin.database().ref('cleanup-queue/imageS2').push(rec); },
        consumeQuota: () => _consumeQuota(ctx),
        refundQuota: () => _refundQuota(ctx),
        now: () => Date.now(),
        uniqueId: () => require('crypto').randomUUID(),
        logSafe: (o) => logger.info('[ai/imageS2] stage', { uid: ctx.uid, classId: ctx.classId, teamName: ctx.teamName, sceneId: sid, stage: (o && o.stage) || null }),
      }
    );

    /* 일괄(batch) 진행 중이면 jobId 로 해당 장면 상태 갱신(best-effort, 본 결과엔 영향 없음). */
    const jobId = _sanitizeFbKeySegment(req.data && req.data.jobId);
    if (jobId) {
      try {
        const jobRef = baseRef.child(`aiVariants/imageJobs/${jobId}`);
        const js = (await jobRef.once('value')).val();
        if (js) {
          const updated = ImageS2Batch.applySceneResult(js, sid, { ok: !!result.ok, cached: result.status === 'cached', code: result.code });
          await jobRef.update({ sceneStates: updated.sceneStates, status: updated.status });
        }
      } catch (e) { logger.warn('[ai/imageS2] job update 실패', { jobId, sceneId: sid }); }
    }

    /* 로그에는 원문(base64/URL) 노출 X — status/code/sceneId만. */
    logger.info('[ai/imageS2] result', {
      uid: ctx.uid, classId: ctx.classId, teamName: ctx.teamName,
      sceneId: sid, status: result.status || null, code: result.code || null, reused: !!result.reused,
    });
    return result;
  }
);

/* ════════════════════════════════════════════════════════════════
   IMAGE-S2-9 — callStartImageS2Batch (작품 전체 일괄 변환 job 생성)
   ──────────────────────────────────────────────────────────────
   ⚠️ 장당 50~70s → 한 콜러블에서 20장 순차는 timeout 위험. MVP: 이 콜러블은
   "계획 + job 상태 생성"만 하고, 교사 클라가 targets 를 callImageAiS2(jobId)로 순차 호출한다.
   job 상태는 aiVariants/imageJobs/{jobId}(이미 read:true·write:false=Admin만) 에 저장.
   ════════════════════════════════════════════════════════════════ */
exports.callStartImageS2Batch = onCall(
  { enforceAppCheck: false },
  async (req) => {
    const ctx = await _validateRequest(req, 'imageS2', { skipUsageLimits: true });   /* 계획만 — quota는 장면별 callImageAiS2가 차감 */
    /* IMAGE-S2-STUDENT-1: 교사 또는 그 팀 active 멤버(자기 모둠 작품)만. */
    const actor = await _resolveImageS2Actor(ctx, req);
    if (!actor.ok) throw new HttpsError('permission-denied', '내 모둠 그림만 AI 마감할 수 있어요.');

    const enc = encodeURIComponent(ctx.teamName);
    const baseRef = admin.database().ref(`classes/${ctx.classId}/teams/${enc}`);
    let scenes = null, variants = null;
    try { scenes = (await baseRef.child('scenes').once('value')).val(); } catch (e) { scenes = null; }
    try { variants = (await baseRef.child('aiVariants/image').once('value')).val(); } catch (e) { variants = null; }
    const existingVariants = {};
    if (variants && typeof variants === 'object') { Object.keys(variants).forEach((sid) => { if (variants[sid] && variants[sid].s2) existingVariants[sid] = variants[sid].s2; }); }

    const force = req.data && req.data.forceRegenerate === true;
    const onlyIds = Array.isArray(req.data && req.data.sceneIds) ? req.data.sceneIds.map(_sanitizeFbKeySegment).filter(Boolean) : null;
    const plan = ImageS2Batch.planImageS2Batch({ scenes: scenes || {}, existingVariants, forceRegenerate: force, sceneIds: onlyIds, currentPromptVersion: ImageS2Gen.PROMPT_VERSION });
    const jobId = require('crypto').randomUUID();
    const state = ImageS2Batch.initBatchState({ jobId, requestedBy: ctx.uid, now: Date.now(), targets: plan.targets, cached: plan.cached, model: 'gpt-image-2', promptVersion: ImageS2OpenAi.PROMPT_VERSION });
    try { await baseRef.child(`aiVariants/imageJobs/${jobId}`).set(state); } catch (e) { throw new HttpsError('internal', 'JOB_CREATE_FAILED'); }

    logger.info('[ai/imageS2] batch start', { uid: ctx.uid, classId: ctx.classId, teamName: ctx.teamName, jobId, targets: plan.targets.length, cached: plan.cachedCount });
    return { ok: true, jobId, targets: plan.targets, cachedCount: plan.cachedCount, skipped: plan.skipped, totalScenes: plan.totalScenes, estCostUsd: plan.estCostUsd, estSeconds: plan.estSeconds };
  }
);

/* ════════════════════════════════════════════════════════════════
   IMAGE-S2-9 — callApplyImageS2Selection (교사 적용/원본유지 — 서버 전용 write)
   ──────────────────────────────────────────────────────────────
   client는 {classId,teamName,sceneId,selected:'s2'|'original'} 만. 원본 scene.imageData 절대 미접촉.
   ★보안: 선택은 aiVariants/imageSelections/{sceneId} 에 기록한다(viewer-meta 아님).
     viewer-meta 는 `.write:auth!=null`(cascade)이라 child `.write:false`가 무효 → 멤버(학생)가
     직접 selection 을 덮어 교사 게이트를 우회할 수 있다. aiVariants 는 `.write:false`(부모 grant 없음)
     라 Admin SDK 단독 write → 우회 불가. read:true 라 감상 표시에는 지장 없음. (copy 시 복사 안 됨=부수효과)
   's2'는 usable(있고·url·!stale) 일 때만.
   ════════════════════════════════════════════════════════════════ */
exports.callApplyImageS2Selection = onCall(
  { enforceAppCheck: false },
  async (req) => {
    const ctx = await _validateRequest(req, 'imageS2', { skipUsageLimits: true });
    /* REFINE-STAB-A(사용자 승인 2026-07-02): 선택(발행) 적용은 담당 교사 '또는 해당 팀 active member'.
       maker 제작 세션(익명 uid)이 자기 팀 감상본을 정하는 흐름 허용 — 생성(callImageAiS2)은 여전히
       teacher-only(비용). 원본은 계속 불변(선택 노드만 Admin write). */
    let _selAllowed = ((req.auth.token && req.auth.token.role) === 'super_admin');
    if (!_selAllowed) {
      try { const t = await admin.database().ref(`classes/${ctx.classId}/meta/teacher_uid`).once('value'); if (t.val() === ctx.uid) _selAllowed = true; } catch (e) { /* 아래 member 확인 */ }
    }
    if (!_selAllowed) {
      try {
        const _encM = encodeURIComponent(ctx.teamName);
        const m = await admin.database().ref(`classes/${ctx.classId}/teams/${_encM}/members/${ctx.uid}/status`).once('value');
        if (m.val() === 'active') _selAllowed = true;
      } catch (e) { /* noop */ }
    }
    if (!_selAllowed) throw new HttpsError('permission-denied', '이 모둠에서만 정할 수 있어요.');

    const sid = _sanitizeFbKeySegment(req.data && req.data.sceneId);
    if (!sid) throw new HttpsError('invalid-argument', 'sceneId가 올바르지 않아요.');
    const selected = (req.data && req.data.selected === 's2') ? 's2' : 'original';
    const enc = encodeURIComponent(ctx.teamName);
    const baseRef = admin.database().ref(`classes/${ctx.classId}/teams/${enc}`);
    const selRef = baseRef.child(`aiVariants/imageSelections/${sid}`);   /* 서버 전용(.write:false) */

    if (selected === 's2') {
      /* s2 usable(있고·url 있고·stale 아님) 일 때만 적용 */
      const s2 = (await baseRef.child(`aiVariants/image/${sid}/s2`).once('value')).val();
      const usable = s2 && typeof s2.url === 'string' && s2.url && s2.stale !== true;
      if (!usable) return { ok: false, code: 'S2_NOT_USABLE' };
      await selRef.set({ selected: 's2', selectedBy: ctx.uid, selectedAt: Date.now(), selectionSource: 'teacher-batch' });
    } else {
      await selRef.set({ selected: 'original', selectedBy: ctx.uid, selectedAt: Date.now(), selectionSource: 'teacher-batch' });
    }
    logger.info('[ai/imageS2] apply selection', { uid: ctx.uid, classId: ctx.classId, teamName: ctx.teamName, sceneId: sid, selected });
    return { ok: true, sceneId: sid, selected };
  }
);

/* ════════════════════════════════════════════════════════════════
   TEXT-S2-SELECT (P7) — callApplyTextS2Selection (교사 적용/원본유지 — 서버 전용 write)
   ──────────────────────────────────────────────────────────────
   callApplyImageS2Selection의 텍스트 평행. client는 {classId,teamName,sceneId,selected:'s2'|'original'} 만.
   원본 scene.body 절대 미접촉. 선택은 aiVariants/textSelections/{sceneId} 에 기록(부모 aiVariants가
   `.write:false`라 Admin SDK 단독 write → 학생 우회 불가·rules 무변경). 's2'는 usable(body 있음) 일 때만.
   ⚠️ 아직 클라 UI 미연결·미배포(dormant). 배포는 사용자 승인 후.
   ════════════════════════════════════════════════════════════════ */
exports.callApplyTextS2Selection = onCall(
  { enforceAppCheck: false },
  async (req) => {
    const ctx = await _validateRequest(req, 's2', { skipUsageLimits: true });
    /* REFINE-STAB-A(사용자 승인 2026-07-02): 선택(발행) 적용은 담당 교사 '또는 해당 팀 active member'.
       maker 제작 세션(익명 uid)이 자기 팀 감상본을 정하는 흐름 허용 — 생성(callImageAiS2)은 여전히
       teacher-only(비용). 원본은 계속 불변(선택 노드만 Admin write). */
    let _selAllowed = ((req.auth.token && req.auth.token.role) === 'super_admin');
    if (!_selAllowed) {
      try { const t = await admin.database().ref(`classes/${ctx.classId}/meta/teacher_uid`).once('value'); if (t.val() === ctx.uid) _selAllowed = true; } catch (e) { /* 아래 member 확인 */ }
    }
    if (!_selAllowed) {
      try {
        const _encM = encodeURIComponent(ctx.teamName);
        const m = await admin.database().ref(`classes/${ctx.classId}/teams/${_encM}/members/${ctx.uid}/status`).once('value');
        if (m.val() === 'active') _selAllowed = true;
      } catch (e) { /* noop */ }
    }
    if (!_selAllowed) throw new HttpsError('permission-denied', '이 모둠에서만 정할 수 있어요.');

    const sid = _sanitizeFbKeySegment(req.data && req.data.sceneId);
    if (!sid) throw new HttpsError('invalid-argument', 'sceneId가 올바르지 않아요.');
    const selected = (req.data && req.data.selected === 's2') ? 's2' : 'original';
    const enc = encodeURIComponent(ctx.teamName);
    const baseRef = admin.database().ref(`classes/${ctx.classId}/teams/${enc}`);
    const selRef = baseRef.child(`aiVariants/textSelections/${sid}`);   /* 서버 전용(.write:false) */

    if (selected === 's2') {
      /* s2 usable(있고·body 비어있지 않음) 일 때만 적용 */
      const s2 = (await baseRef.child(`aiVariants/text/${sid}/s2`).once('value')).val();
      const usable = s2 && typeof s2.body === 'string' && s2.body.trim() && s2.stale !== true;
      if (!usable) return { ok: false, code: 'S2_NOT_USABLE' };
      await selRef.set({ selected: 's2', selectedBy: ctx.uid, selectedAt: Date.now(), selectionSource: 'teacher-batch' });
    } else {
      await selRef.set({ selected: 'original', selectedBy: ctx.uid, selectedAt: Date.now(), selectionSource: 'teacher-batch' });
    }
    logger.info('[ai/textS2] apply selection', { uid: ctx.uid, classId: ctx.classId, teamName: ctx.teamName, sceneId: sid, selected });
    return { ok: true, sceneId: sid, selected };
  }
);

/* ════════════════════════════════════════════════════════════════
   IMAGE-S2-2 — sourceMode 잠금/초기화 최소 권한 게이트
   ──────────────────────────────────────────────────────────────
   ⚠️ _validateRequest(AI 게이트/quota/kill switch)를 쓰지 않는다.
   sourceMode는 원본 upload/draw 정책이라 imageS2 기능 ON/OFF와 무관해야 한다
   (AI가 꺼져 있어도 원본 입력 방식 선택은 작동해야 함). 따라서 auth/origin/
   class·team 소속만 검증한다. 외부 URL·Storage path·base64·전체 policy 객체·
   lockedBy/lockedAt는 받지 않는다(서버가 auth/정본 기준으로 기록).
   ════════════════════════════════════════════════════════════════ */
async function _validateSourceModeRequest(req, opts) {
  const teacherOnly = !!(opts && opts.teacherOnly);
  if (!req.auth || !req.auth.uid) {
    throw new HttpsError('unauthenticated', '로그인이 필요해요.');           /* UNAUTHENTICATED */
  }
  if (req.data && req.data.testMode === true) {
    throw new HttpsError('permission-denied', 'testMode로는 사용할 수 없어요.');
  }
  const uid = req.auth.uid;
  const role = (req.auth.token && req.auth.token.role) || null;
  const data = req.data || {};
  const classId = _sanitizeFbKeySegment(data.classId);
  const teamName = (typeof data.teamName === 'string' && data.teamName) ? data.teamName : '';
  if (!classId || !teamName) {
    throw new HttpsError('invalid-argument', 'classId / teamName이 없어요.');
  }
  const origin = (req.rawRequest && req.rawRequest.headers && req.rawRequest.headers.origin) || '';
  if (!isOriginAllowed(origin)) {
    logger.warn('[sourceMode] origin 거부', { uid, origin });
    throw new HttpsError('permission-denied', '허용되지 않은 origin이에요.');   /* PERMISSION_DENIED */
  }
  const enc = encodeURIComponent(teamName);
  const teamBase = `classes/${classId}/teams/${enc}`;

  /* 교사(이 클래스 teacher_uid 일치) 또는 super_admin */
  let isTeacher = (role === 'super_admin');
  if (!isTeacher) {
    const tSnap = await admin.database().ref(`classes/${classId}/meta/teacher_uid`).once('value');
    if (tSnap.val() === uid) isTeacher = true;
  }
  if (teacherOnly) {
    if (!isTeacher) throw new HttpsError('permission-denied', '담당 교사만 할 수 있어요.');
    return { uid, classId, teamName, enc, teamBase, isTeacher: true };
  }
  /* lock: active member 또는 교사/super_admin */
  let allowed = isTeacher;
  if (!allowed) {
    const mSnap = await admin.database().ref(`${teamBase}/members/${uid}/status`).once('value');
    if (mSnap.val() === 'active') allowed = true;
  }
  if (!allowed) {
    throw new HttpsError('permission-denied', '이 모둠의 구성원만 할 수 있어요.');
  }
  return { uid, classId, teamName, enc, teamBase, isTeacher };
}

/* ════════════════════════════════════════════════════════════════
   lockImageSourceMode — 첫 이미지 입력 방식(upload|draw) 원자 잠금.
   요청: { classId, teamName, sceneId?, sourceMode }.  서버가 transaction으로 기록.
   결과: { ok:true, sourceMode, locked|idempotent } 또는
        { ok:false, code:'SOURCE_MODE_CONFLICT', currentSourceMode } (정상 반환).
   원자성: viewer-meta/imagePolicy transaction(CAS+자동 재시도) → 먼저 commit한
   모드만 인정, 늦은 반대 요청은 재실행 시 conflict.
   ════════════════════════════════════════════════════════════════ */
exports.lockImageSourceMode = onCall(
  { enforceAppCheck: false },
  async (req) => {
    const ctx = await _validateSourceModeRequest(req, { teacherOnly: false });
    const data = req.data || {};
    if (!ImageS2Policy.isValidSourceMode(data.sourceMode)) {
      throw new HttpsError('invalid-argument', 'INVALID_SOURCE_MODE');
    }
    const sceneId = _sanitizeFbKeySegment(data.sceneId);   /* 선택 — 없으면 null */
    const reqObj = { sourceMode: data.sourceMode, sceneId: sceneId || null, uid: ctx.uid, now: Date.now() };
    const ref = admin.database().ref(`${ctx.teamBase}/viewer-meta/imagePolicy`);

    /* SOURCE-MODE-RELOCK(2026-07-14): 작품에 원본 이미지가 0장이면 낡은 잠금을 자동 해제하고
       새 모드로 재잠금(모두 삭제 후 방식 바꾸기). 추가되는 새 이미지는 아직 scene에 미기록
       (gate-first)이라 여기 카운트엔 안 잡힘 → 남은 다른 이미지만 셈. 실 이미지가 남아 있으면
       hasImages=true → 기존 conflict 유지(진짜 섞기 차단). */
    let hasImages = undefined;
    try {
      const scenesSnap = await admin.database().ref(`${ctx.teamBase}/scenes`).once('value');
      hasImages = ImageS2Policy.scenesHaveOriginalImage(scenesSnap.val());
    } catch (e) { hasImages = undefined; /* 읽기 실패 → 기존 엄격 동작 유지(안전) */ }

    let decision = null;
    let txn;
    try {
      txn = await ref.transaction((currentRaw) => {
        decision = ImageS2Policy.decideSourceModeLock(currentRaw, reqObj, hasImages);
        if (decision.action === 'lock') return decision.policy;   /* 기록 */
        return;                                                   /* abort(idempotent/conflict) */
      });
    } catch (e) {
      logger.error('[sourceMode] transaction 실패', { classId: ctx.classId, error: e && e.message });
      throw new HttpsError('internal', 'INTERNAL');
    }
    if (!decision) throw new HttpsError('internal', 'INTERNAL');

    if (decision.action === 'corrupt') {
      /* 비정상 저장값 — 자동 덮어쓰기 금지(교사 개입). 원본은 호출부가 유지. */
      logger.warn('[sourceMode] corrupt imagePolicy', { classId: ctx.classId, teamName: ctx.teamName });
      return { ok: false, code: 'CORRUPT_IMAGE_POLICY' };
    }
    if (decision.action === 'conflict') {
      return { ok: false, code: 'SOURCE_MODE_CONFLICT', currentSourceMode: decision.currentSourceMode };
    }
    if (decision.action === 'idempotent') {
      return { ok: true, sourceMode: reqObj.sourceMode, idempotent: true };
    }
    /* lock — 정상 commit이어야 함. 혹시 미커밋(극단적 경쟁)이면 현재값 재확인. */
    if (!txn.committed) {
      const snap = await ref.once('value');
      const cur = ImageS2Policy.normalizePolicy(snap.val());
      if (cur && cur.sourceMode === reqObj.sourceMode) return { ok: true, sourceMode: cur.sourceMode, idempotent: true };
      if (cur) return { ok: false, code: 'SOURCE_MODE_CONFLICT', currentSourceMode: cur.sourceMode };
      throw new HttpsError('aborted', 'LOCK_CONTENTION');
    }
    logger.info('[sourceMode] lock', { uid: ctx.uid, classId: ctx.classId, teamName: ctx.teamName, sourceMode: reqObj.sourceMode });
    return { ok: true, sourceMode: reqObj.sourceMode, locked: true };
  }
);

/* ════════════════════════════════════════════════════════════════
   resetImageSourceMode — 교사/super_admin만. 작품에 원본 이미지가 하나도 없을 때만
   imagePolicy를 비운다(방식 변경 준비). 이미지가 남아 있으면 SOURCE_IMAGES_REMAIN.
   ──────────────────────────────────────────────────────────────
   S2-2A §10 경쟁 안전: "scenes 비었나 확인 → clear" 사이에 학생이 새 원본을 저장하면
   이미지 존재 + policy 없음 상태가 생길 수 있다. 방지:
   1) scenes empty 확인.
   2) 현재 imagePolicy 캡처(prev) → CAS transaction(현재값이 prev와 같을 때만 null).
      그 사이 racing lock이 새 policy를 기록했으면 CAS abort → RESET_RACE_RETRY.
   3) clear 후 scenes 재확인 → 그 사이 저장이 들어왔으면 RESET_RACE_RETRY
      (그 저장의 lock이 policy를 다시 기록하므로 최종은 이미지+policy로 수렴. 교사 재시도).
   ════════════════════════════════════════════════════════════════ */
function _imagePolicyEq(a, b) {
  const na = ImageS2Policy.normalizePolicy(a);
  const nb = ImageS2Policy.normalizePolicy(b);
  if (na === null && nb === null) return true;
  if (!na || !nb) return false;
  return na.sourceMode === nb.sourceMode && na.lockedAt === nb.lockedAt && na.lockedBy === nb.lockedBy;
}
exports.resetImageSourceMode = onCall(
  { enforceAppCheck: false },
  async (req) => {
    const ctx = await _validateSourceModeRequest(req, { teacherOnly: true });   /* 학생 거부 */
    const scenesRef = admin.database().ref(`${ctx.teamBase}/scenes`);
    const policyRef = admin.database().ref(`${ctx.teamBase}/viewer-meta/imagePolicy`);

    const decision = ImageS2Policy.decideSourceModeReset((await scenesRef.once('value')).val());
    if (!decision.ok) {
      return { ok: false, code: decision.code };   /* SOURCE_IMAGES_REMAIN */
    }
    const prevRaw = (await policyRef.once('value')).val();

    /* S2-2A-FIX1(M1): optimistic-null 안전 CAS. non-match면 abort(undefined) 대신 cur 반환 →
       commit이 server값과 mismatch면 RTDB가 server값으로 재실행(영속연결 없는 환경에서도 정확).
       match(=prevRaw)면 null로 clear. clear 여부는 아래 재확인으로 최종 판정. */
    try {
      await policyRef.transaction((cur) => (_imagePolicyEq(cur, prevRaw) ? null : cur));
    } catch (e) {
      logger.error('[sourceMode] reset transaction 실패', { classId: ctx.classId, error: e && e.message });
      throw new HttpsError('internal', 'INTERNAL');
    }
    /* 실제로 비워졌는지 재확인: 정책이 남아 있으면(=racing lock이 다시 기록함) RESET_RACE_RETRY. */
    const afterPolicy = (await policyRef.once('value')).val();
    if (afterPolicy != null && ImageS2Policy.classifyPolicy(afterPolicy) !== 'absent') {
      return { ok: false, code: 'RESET_RACE_RETRY' };
    }
    /* clear 후 scenes 재확인: 그 사이 새 원본 저장이 들어왔으면 무정책-이미지 방지 차원에서 재시도 안내. */
    const after = ImageS2Policy.decideSourceModeReset((await scenesRef.once('value')).val());
    if (!after.ok) {
      return { ok: false, code: 'RESET_RACE_RETRY' };
    }
    logger.info('[sourceMode] reset', { uid: ctx.uid, classId: ctx.classId, teamName: ctx.teamName });
    return { ok: true, reset: true };
  }
);

/* ════════════════════════════════════════════════════════════════
   SOURCE-MODE-SWITCH(2026-07-16): 학생 자가해결 — "그림 다 지우고 방식 바꾸기".
   ──────────────────────────────────────────────────────────────
   그리기로 잠긴 작품에서 파일 올리기로(또는 반대로) 바꾸려면 원본 이미지 0장이어야 잠금이 풀리는데,
   안 보이는 다른 갈래 장면·표지(삭제 불가) 때문에 학생이 스스로 0장을 못 만들던 문제.
   이 콜러블이 모든 장면(표지·전 갈래)의 원본 이미지 + AI 이미지 변형 + imagePolicy를 원자적으로 비운다.
   · 권한: 자기 모둠 active 멤버 또는 담당 교사/super_admin(teacherOnly:false — lock과 동일 게이트).
   · 파괴적(되돌리기 없음) — 클라에서 강한 확인 후 호출. 멱등(다시 눌러도 안전).
   · 원자 multi-path update라 "이미지 있는데 policy 없음" 창 없음(둘 다 동시 null). racing lock이
     그 뒤 새 이미지+policy를 기록해도 수렴(멱등 재호출 가능). reset의 CAS는 policy만 지울 때 필요했던 것.
   ════════════════════════════════════════════════════════════════ */
exports.clearImagesAndSwitchSourceMode = onCall(
  { enforceAppCheck: false },
  async (req) => {
    const ctx = await _validateSourceModeRequest(req, { teacherOnly: false });   /* 자기팀 학생 or 교사 */
    const scenes = (await admin.database().ref(`${ctx.teamBase}/scenes`).once('value')).val() || {};
    const updates = {};
    let cleared = 0;
    Object.keys(scenes).forEach((k) => {
      const s = scenes[k];
      if (!s || typeof s !== 'object') return;
      if (typeof s.imageData === 'string' && s.imageData) { updates[`scenes/${k}/imageData`] = null; cleared++; }
      if (typeof s.imageUrl === 'string' && s.imageUrl) { updates[`scenes/${k}/imageUrl`] = null; }
    });
    /* 원본 이미지(표지·전 갈래) + AI 이미지 변형 + 방식 잠금 정책을 한 번에 비움(원자). */
    updates['aiVariants/image'] = null;
    /* AUDIT-B2(2026-07-16): 발행 선택(imageSelections)도 함께 정리 — 남겨두면 나중에 같은 sceneId로
       재생성했을 때 옛 {selected:'s2'}가 교사 발행 조치 없이 새 변형을 자동 발행 표시함. */
    updates['aiVariants/imageSelections'] = null;
    updates['viewer-meta/imagePolicy'] = null;
    try {
      await admin.database().ref(ctx.teamBase).update(updates);
    } catch (e) {
      logger.error('[sourceMode] switch-clear 실패', { classId: ctx.classId, error: e && e.message });
      throw new HttpsError('internal', 'INTERNAL');
    }
    logger.info('[sourceMode] switch-clear', { uid: ctx.uid, classId: ctx.classId, teamName: ctx.teamName, cleared });
    return { ok: true, cleared };
  }
);

/* ════════════════════════════════════════════════════════════════
   MASTER-M2(2026-07-11): 총괄 AI 횟수 리셋 — super_admin 전용 callable.
   ──────────────────────────────────────────────────────────────
   · ai-usage/{classId}(/{teamName}) 노드 삭제 방식 — 읽기가 전부 (val()||0)이라
     수업 진행 중 어느 시점에 지워도 무오류(2026-07-11 수동 리셋과 동일 기법).
   · rules 무변경(ai-usage 클라 접근 전면 차단 유지) — admin SDK로만 삭제.
   · 일일 한도(ai-usage-by-root/ai-usage-global)는 비용 가드라 대상 아님.
   · 감사 로그: ai-stats/resets/{pushId} — 누가/어느 학급/어느 팀/언제.
   ════════════════════════════════════════════════════════════════ */
exports.adminResetAiUsage = onCall(
  { enforceAppCheck: false },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', '로그인이 필요해요.');
    const role = req.auth.token && req.auth.token.role;
    if (role !== 'super_admin') {
      throw new HttpsError('permission-denied', '총괄 관리자만 사용할 수 있어요.');
    }
    const classId  = String((req.data && req.data.classId) || '').trim();
    const teamName = String((req.data && req.data.teamName) || '').trim();
    if (!classId || /[.#$\[\]\/]/.test(classId)) {
      throw new HttpsError('invalid-argument', 'classId가 올바르지 않아요.');
    }
    if (teamName && /[.#$\[\]\/]/.test(teamName)) {
      throw new HttpsError('invalid-argument', 'teamName이 올바르지 않아요.');
    }
    const path = teamName ? `ai-usage/${classId}/${teamName}` : `ai-usage/${classId}`;
    await admin.database().ref(path).remove();
    await admin.database().ref('ai-stats/resets').push({
      by: req.auth.uid,
      classId,
      teamName: teamName || null,
      at: admin.database.ServerValue.TIMESTAMP,
    });
    logger.info('[adminResetAiUsage]', { by: req.auth.uid, classId, teamName: teamName || '(학급 전체)' });
    return { ok: true };
  }
);

/* ════════════════════════════════════════════════════════════════
   LEVELS-ADMIN A1+A2(2026-07-18): 1·2단계 작품 "처음부터 다시" — 담당 교사/총괄 전용.
   ──────────────────────────────────────────────────────────────
   배경: 1·2단계는 학생 전체 초기화가 숨겨져 있고(LEVELS-AUDIT F3), AI 초안은
   나침반 완료 훅에서만 생성되며, 팀당 총량(teams/{팀}/aiUsage)은 adminResetAiUsage의
   대상(ai-usage 노드)이 아니라 — 제품 안에 재시작 경로가 없었다.
   · 권한: super_admin 또는 해당 학급 담당 교사(meta/teacher_uid).
   · 대상: picturebookLevel ∈ {1,2}만 (3단계는 브랜치 화면의 전체 초기화 사용).
   · 원자 multi-path null: scenes·팀 aiUsage(초안/그림 총량)·aiVariants·imageSelections·
     aiChecks·나침반(writingGuide/preWriting)·presentation·starterTemplateInitialized·
     표지/시작점 메타·isPublic(+학급 책장 노드) — 계정(PIN)/멤버/단계/유형은 유지.
     ai-usage/{cid}/{팀}(작품검사 등 per-작품 quota)도 함께 리셋.
   · 학생 재진입 → 나침반 게이트부터 재주행 → 완료 시 AI 초안 재생성(총량 리셋됨).
   ════════════════════════════════════════════════════════════════ */
exports.adminResetPicturebookWork = onCall(
  { enforceAppCheck: false },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', '로그인이 필요해요.');
    const classId  = String((req.data && req.data.classId) || '').trim();
    const teamName = String((req.data && req.data.teamName) || '').trim();
    if (!classId || /[.#$\[\]\/]/.test(classId)) {
      throw new HttpsError('invalid-argument', 'classId가 올바르지 않아요.');
    }
    if (!teamName || /[.#$\[\]\/]/.test(teamName)) {
      throw new HttpsError('invalid-argument', 'teamName이 올바르지 않아요.');
    }
    /* 권한 — super_admin 또는 담당 교사 */
    const role = req.auth.token && req.auth.token.role;
    if (role !== 'super_admin') {
      const tSnap = await admin.database().ref(`classes/${classId}/meta/teacher_uid`).once('value');
      if (tSnap.val() !== req.auth.uid) {
        throw new HttpsError('permission-denied', '이 학급의 담당 선생님만 사용할 수 있어요.');
      }
    }
    const enc = encodeURIComponent(teamName);
    const base = `classes/${classId}/teams/${enc}`;
    /* 단계 게이트 — 서버 직접 read(1·2단계 전용) */
    const lvl = Number((await admin.database().ref(`${base}/viewer-meta/picturebookLevel`).once('value')).val());
    if (lvl !== 1 && lvl !== 2) {
      throw new HttpsError('failed-precondition',
        '이 기능은 그림책 1·2단계 작품 전용이에요. (3단계는 브랜치 화면의 전체 초기화를 사용해요)');
    }
    const updates = {};
    [
      `${base}/scenes`,
      `${base}/aiUsage`,                                  /* 초안 3회·그림 24회 총량 */
      `${base}/aiVariants`,                               /* AI 그림/글 변형(이전 이야기 그림 자동표시 방지) */
      `${base}/imageSelections`,
      `${base}/aiChecks`,                                 /* 점검/질문 latest(이전 이야기 기준) */
      `${base}/writingGuide/preWriting`,                  /* 나침반 → 미시작(재진입 시 게이트 재주행) */
      `${base}/viewer-meta/presentation`,                 /* 장면별 글상자 좌표(이전 이야기 기준) */
      `${base}/viewer-meta/starterTemplateInitialized`,   /* 없애야 폴백 기본 틀도 다시 가능 */
      `${base}/viewer-meta/coverTitle`,
      `${base}/viewer-meta/coverImageData`,
      `${base}/viewer-meta/entrySceneId`,
      `${base}/viewer-meta/replaySceneId`,
      `${base}/viewer-meta/isPublic`,                     /* 빈 책이 책장에 남지 않게 */
      `classes/${classId}/shelf/${enc}`,                  /* 학급 책장 카드 정리 */
      `ai-usage/${classId}/${teamName}`,                  /* 작품검사 등 per-작품 quota */
    ].forEach((p) => { updates[p] = null; });
    await admin.database().ref().update(updates);
    await admin.database().ref('ai-stats/resets').push({
      type: 'picturebookWork', by: req.auth.uid, classId, teamName, level: lvl,
      at: admin.database.ServerValue.TIMESTAMP,
    });
    logger.info('[adminResetPicturebookWork]', { by: req.auth.uid, classId, teamName, level: lvl });
    return { ok: true, level: lvl };
  }
);

/* ════════════════════════════════════════════════════════════════
   SCRIPT-DRAFT-1(2026-07-12): 교사 무비형 대본 도우미 — 초안 생성.
   ──────────────────────────────────────────────────────────────
   · 교사 전용(담당교사 or super_admin) — 학생 ai-usage/quota 체계와 완전 분리.
   · 한도: ai-usage-teacher/{uid}/{KST일자}/scriptDraft — 하루 10회(transaction).
     클라 rules 접근 없음(admin SDK 전용 노드) — rules 무변경.
   · 학생 snapshot이 없으므로 _runAiPrecheck(팀 스냅샷용)는 안 씀.
     입력 길이 상한 + 프롬프트 거절 규칙으로 방어(교사 전용이라 위험 낮음).
   · 감사 로그: ai-stats/scriptDraft push(uid/classId/토큰).
   ════════════════════════════════════════════════════════════════ */
const SCRIPT_DRAFT_DAILY_LIMIT = 10;

exports.teacherScriptDraft = onCall(
  {
    secrets: [ANTHROPIC_API_KEY],
    enforceAppCheck: false,
    /* 대본 JSON은 출력이 큼(11~13장면) — 함수/모델 시간·토큰 예산을 이 함수만 상향 */
    timeoutSeconds: 120,
  },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', '로그인이 필요해요.');
    const uid  = req.auth.uid;
    const role = (req.auth.token && req.auth.token.role) || null;

    const classId = String((req.data && req.data.classId) || '').trim();
    if (!classId || /[.#$\[\]\/]/.test(classId)) {
      throw new HttpsError('invalid-argument', 'classId가 올바르지 않아요.');
    }

    /* 교사 게이트 — joinTeamMembership isTeacher 판별과 동일 기준(서버 read=위조 불가) */
    if (role !== 'super_admin') {
      const teacherUid = (await admin.database()
        .ref(`classes/${classId}/meta/teacher_uid`).once('value')).val();
      if (!teacherUid || teacherUid !== uid) {
        throw new HttpsError('permission-denied', '담당 교사만 사용할 수 있어요.');
      }
    }

    /* 입력 검증 — 길이 상한(프롬프트 폭주 방지) */
    const d = req.data || {};
    const field = (k, max) => {
      const v = String(d[k] == null ? '' : d[k]).trim();
      if (v.length > max) {
        throw new HttpsError('invalid-argument', `${k} 입력이 너무 길어요(최대 ${max}자).`);
      }
      return v;
    };
    const input = {
      topic:       field('topic', 400),
      characters:  field('characters', 300),
      lead:        field('lead', 200),
      place:       field('place', 120),
      structure:   field('structure', 120),
      endingStyle: field('endingStyle', 100),
      tone:        field('tone', 100),
      grade:       field('grade', 30),
      message:     field('message', 200),
    };
    if (!input.topic)      throw new HttpsError('invalid-argument', '주제/상황을 입력해 주세요.');
    if (!input.characters) throw new HttpsError('invalid-argument', '주인공 구성을 입력해 주세요.');
    if (!input.structure)  throw new HttpsError('invalid-argument', '분기 구조를 골라 주세요.');

    /* 교사 일일 한도 — KST 날짜 기준 transaction 증가(초과 시 롤백) */
    const kstDate = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
    const limitRef = admin.database().ref(`ai-usage-teacher/${uid}/${kstDate}/scriptDraft`);
    const tx = await limitRef.transaction((cur) => {
      const n = (typeof cur === 'number' && cur >= 0) ? cur : 0;
      if (n >= SCRIPT_DRAFT_DAILY_LIMIT) return;   /* undefined = abort */
      return n + 1;
    });
    if (!tx.committed) {
      throw new HttpsError('resource-exhausted',
        `오늘 대본 만들기 횟수(${SCRIPT_DRAFT_DAILY_LIMIT}회)를 다 썼어요. 내일 다시 만들 수 있어요.`);
    }

    const refund = () =>
      limitRef.transaction((cur) => Math.max(0, (cur || 0) - 1)).catch(() => {});

    try {
      const userMsg = buildScriptDraftUserMessage(input);
      /* 13장면 한국어 JSON은 8000토큰에 걸칠 수 있어 이 호출만 예산 상향(리뷰 #4) */
      const ai = await _callAnthropic(ANTHROPIC_API_KEY.value(), SCRIPT_DRAFT_SYSTEM_PROMPT, userMsg,
        null, { maxTokens: 16000, timeoutMs: 110000 });

      /* 잘림 감지(리뷰 #2) — 잘린 JSON은 어차피 파싱 실패라 먼저 구체 안내로 전환 */
      if (ai.stopReason === 'max_tokens') {
        logger.warn('[teacherScriptDraft] truncated', { by: uid, out: ai.outputTokens });
        throw new HttpsError('internal', '대본이 너무 길어서 잘렸어요. 장면 수가 적은 구조로 다시 만들어 주세요.');
      }

      /* JSON 출력 파싱(기존 s1/s2 인프라 재사용) + 정리 + 최소 형태 검증.
         카드형 렌더·인쇄, 그리고 P2(장면 자동 생성)의 입력이 이 구조. */
      const draft = _sanitizeScriptDraft(_parseJsonStrict(ai.text));
      if (draft && draft.refused === true) {
        await refund();   /* 소재 거절은 횟수 미차감(학생 block=0차감 정책과 동일 취지) */
        return { ok: false, refused: true, reason: String(draft.reason || '').slice(0, 200) };
      }
      const shapeErr = _validateScriptDraft(draft);
      if (shapeErr) throw new Error('shape: ' + shapeErr);

      /* 감사로그는 비치명 — push 실패가 성공한 대본을 삼키지 않게(리뷰 #5) */
      await admin.database().ref('ai-stats/scriptDraft').push({
        by: uid,
        classId,
        inputTokens: ai.inputTokens,
        outputTokens: ai.outputTokens,
        stopReason: ai.stopReason,
        at: admin.database.ServerValue.TIMESTAMP,
      }).catch((e) => logger.warn('[teacherScriptDraft] stats push fail', { message: e && e.message }));
      logger.info('[teacherScriptDraft]', { by: uid, classId, out: ai.outputTokens });

      return { ok: true, draft };
    } catch (e) {
      /* AI/파싱 실패 시 오늘 한도 1회 환불 후, 구체 메시지(HttpsError)는 그대로 전달 */
      await refund();
      logger.error('[teacherScriptDraft] fail', { by: uid, message: e && e.message });
      if (e instanceof HttpsError) throw e;
      throw new HttpsError('internal', '대본을 만들지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  }
);

/* SCRIPT-DRAFT-1: AI 출력 정리(리뷰 #1) — null 항목 제거·문자열 강제.
   가벼운 슬립(항목 null·필드 누락)은 살리고, 본질 결함만 _validateScriptDraft가 거른다. */
function _sanitizeScriptDraft(d) {
  if (!d || typeof d !== 'object' || d.refused === true) return d;
  const str = (v) => (v == null ? '' : String(v));
  const out = {
    title: str(d.title).trim(),
    cover: {
      intro:   str(d.cover && d.cover.intro),
      artIdea: str(d.cover && d.cover.artIdea),
      cast:    str(d.cover && d.cover.cast),
    },
    characters: (Array.isArray(d.characters) ? d.characters : [])
      .filter((c) => c && typeof c === 'object' && c.name)
      .map((c) => ({ name: str(c.name), desc: str(c.desc) })),
    flow: str(d.flow),
    scenes: (Array.isArray(d.scenes) ? d.scenes : [])
      .filter((s) => s && typeof s === 'object')
      .map((s) => ({
        num: Number(s.num),
        title: str(s.title),
        place: str(s.place),
        kind: str(s.kind),
        stage: str(s.stage),
        lines: (Array.isArray(s.lines) ? s.lines : [])
          .filter((l) => l && typeof l === 'object' && (l.text || l.who))
          .map((l) => ({ who: str(l.who), voice: str(l.voice), action: str(l.action), text: str(l.text) })),
        choices: (Array.isArray(s.choices) ? s.choices : [])
          .filter((c) => c && typeof c === 'object')
          .map((c) => ({
            id: str(c.id),
            /* AI가 "[선택 A]" 접두어를 문구에 중복 포함하는 슬립 제거(실생성 관측) */
            text: str(c.text).replace(/^\s*\[?\s*선택\s*[AB]\s*\]?\s*/, ''),
            next: Number(c.next),
            value: str(c.value),
          })),
        camera: str(s.camera),
        caption: str(s.caption),
      })),
  };
  return out;
}

/* SCRIPT-DRAFT-1: 대본 JSON 최소 형태 검증 — 통과 못 하면 사유 문자열 반환(정상=null) */
function _validateScriptDraft(d) {
  if (!d || typeof d !== 'object') return '객체 아님';
  if (typeof d.title !== 'string' || !d.title.trim()) return 'title 없음';
  if (!Array.isArray(d.scenes) || d.scenes.length < 1) return 'scenes 없음';
  if (d.scenes.length > 24) return '장면 수 초과(' + d.scenes.length + ')';
  const KINDS = ['normal', 'branch', 'ending', 'trueEnding'];
  for (const s of d.scenes) {
    if (!s || typeof s !== 'object') return '장면 형식 오류';
    if (typeof s.num !== 'number' || !Number.isFinite(s.num)) return '장면 번호 없음';
    if (typeof s.title !== 'string') return '장면 제목 없음';
    if (!KINDS.includes(s.kind)) return '장면 kind 오류(' + s.kind + ')';
    if (!Array.isArray(s.lines)) return '장면 lines 없음';
    if (s.kind === 'branch') {
      if (!Array.isArray(s.choices) || s.choices.length !== 2) return '갈림 장면 choices 오류';
      for (const c of s.choices) {
        if (!Number.isFinite(c.next)) return '갈림 연결(next) 오류';
      }
    }
  }
  return null;
}

/* ════════════════════════════════════════════════════════════════
   PICTUREBOOK-LEVELS ③(2026-07-18): studentStoryDraft — 생각 나침반 답
   → 일직선 그림책 이야기 초안(그림책 1·2단계 공용).
   ──────────────────────────────────────────────────────────────
   · 게이트: 기존 _validateRequest 재사용(auth/testMode/학급 aiSettings enabled+
     modes.storyDraft/멤버십 H-1/origin/killswitch). 사용량 검사는 자체 팀당 총량으로 대체.
   · 단계·빈작품 게이트는 서버가 RTDB 직접 read(클라 위조 불가):
     viewer-meta/picturebookLevel ∈ {1,2} + scenes 비어있음(초안=새 작품 전용).
   · 팀당 총량 = STUDENT_STORY_DRAFT_TEAM_LIMIT (자동 1회+재시도 여유·§9 팀당 총량 결정).
   · 출력 = {title, scenes, ending} — 클라가 BASE10 스타터 골격에 얹음.
     level 1 = scenes[storyCount]+ending 완성문 전체.
     LEVELS-CONT-B: level 2 = 시작 3장면(scenes 정확히 3)·엔딩 빈 값 — 나머지는 아이가
     이어 씀. 씨앗 힌트(scene.writingHint)는 클라가 나침반 답으로 위치 기반 결정적 생성
     (서버 미관여·메이커 placeholder 전용·감상/인쇄 미노출).
     정본: docs/picturebook_levels_design_20260718.md §7.4·§14
   ════════════════════════════════════════════════════════════════ */
const STUDENT_STORY_DRAFT_TEAM_LIMIT = 3;

exports.studentStoryDraft = onCall(
  {
    secrets: [ANTHROPIC_API_KEY],
    enforceAppCheck: false,
    /* 15장면 한국어 JSON — 대본도우미와 동일하게 시간 예산만 상향 */
    timeoutSeconds: 120,
  },
  async (req) => {
    /* 권한/설정/멤버십/killswitch — 기존 1~11단 재사용(quota만 자체 처리) */
    const ctx = await _validateRequest(req, 'storyDraft', { skipUsageLimits: true });
    const classId = ctx.classId;
    const teamName = ctx.teamName;
    const teamBase = `classes/${classId}/teams/${encodeURIComponent(teamName)}`;

    /* 단계 게이트 — 서버 직접 read. 1·2단계만(3단계·레거시·비그림책 차단) */
    const lvlSnap = await admin.database().ref(`${teamBase}/viewer-meta/picturebookLevel`).once('value');
    const level = Number(lvlSnap.val());
    if (level !== 1 && level !== 2) {
      throw new HttpsError('failed-precondition', 'STORY_DRAFT_LEVEL (이 기능은 그림책 1·2단계 작품에서만 쓸 수 있어요)');
    }

    /* 빈 작품 게이트 — 초안은 새 작품 전용(기존 글 덮어쓰기 원천 차단). 키 1개만 shallow 확인 */
    const scenesSnap = await admin.database().ref(`${teamBase}/scenes`).limitToFirst(1).once('value');
    if (scenesSnap.exists()) {
      throw new HttpsError('failed-precondition', 'STORY_DRAFT_NOT_EMPTY (이미 장면이 있는 작품에는 초안을 만들 수 없어요)');
    }

    /* 입력 검증 — 나침반 답 디지스트(클라 구성·400자 문답 합산 상한) */
    const d = req.data || {};
    const storyCount = (d.storyCount === 12 || d.storyCount === 15) ? d.storyCount : 8;
    const answersText = String(d.answersText == null ? '' : d.answersText)
      .replace(/[«»]/g, '"').replace(/\s+/g, ' ').trim().slice(0, 1500);
    if (!answersText) {
      throw new HttpsError('invalid-argument', '생각 나침반 답이 없어요.');
    }

    /* STORYDRAFT-SAFETY-1(2026-07-21): 초안 입력(나침반 답)에 키워드 스캐너를 먼저 건다 —
       s1/s2/check를 지키는 _scanSafety가 정작 첫 관문(초안)엔 없어, 명시적 소재조차 LLM 판단에만
       기대던 것 보강. 여기서 결정적으로 잡고(섹스·자해·개인정보 등 사전 등록어), LLM 거부·순화는
       그 뒤 2차 방어로 유지. 쿼터 차감(아래 transaction) 전이라 환불 불요. 원문은 로그 미기록(카테고리만). */
    const _inSafety = _scanSafety({ a: { body: answersText } });
    if (_inSafety.blocked) {
      logger.warn('[studentStoryDraft] 입력 안전 차단', {
        by: ctx.uid, classId, level, categories: _inSafety.categories,
      });
      await admin.database().ref('ai-stats/storyDraftBlocked').push({
        by: ctx.uid, classId, level, phase: 'input', categories: _inSafety.categories,
        at: admin.database.ServerValue.TIMESTAMP,
      }).catch(() => {});
      return { ok: false, refused: true, reason: '이 소재는 초등학교 그림책으로 쓰기 어려워요. 다른 이야기로 바꿔 볼까요?' };
    }

    /* 팀당 총량 — transaction 증가(초과 시 롤백). 정본 §9 */
    const limitRef = admin.database().ref(`${teamBase}/aiUsage/storyDraft`);
    const tx = await limitRef.transaction((cur) => {
      const n = (typeof cur === 'number' && cur >= 0) ? cur : 0;
      if (n >= STUDENT_STORY_DRAFT_TEAM_LIMIT) return;   /* undefined = abort */
      return n + 1;
    });
    if (!tx.committed) {
      throw new HttpsError('resource-exhausted',
        `이 모둠의 이야기 초안 만들기 횟수(${STUDENT_STORY_DRAFT_TEAM_LIMIT}회)를 다 썼어요. 선생님께 말씀드려 주세요.`);
    }
    const refund = () =>
      limitRef.transaction((cur) => Math.max(0, (cur || 0) - 1)).catch(() => {});

    try {
      const userMsg = buildStudentStoryDraftUserMessage({ answersText, storyCount, level });
      const ai = await _callAnthropic(ANTHROPIC_API_KEY.value(), STUDENT_STORY_DRAFT_SYSTEM_PROMPT, userMsg,
        null, { maxTokens: 12000, timeoutMs: 110000 });

      if (ai.stopReason === 'max_tokens') {
        logger.warn('[studentStoryDraft] truncated', { by: ctx.uid, out: ai.outputTokens });
        throw new HttpsError('internal', '이야기가 너무 길어져서 잘렸어요. 잠시 후 다시 시도해 주세요.');
      }

      const draft = _sanitizeStudentStoryDraft(_parseJsonStrict(ai.text), storyCount, level);
      if (draft && draft.refused === true) {
        await refund();   /* 소재 거절 = 횟수 미차감(대본도우미와 동일 정책) */
        /* STORYDRAFT-SAFETY-1(2026-07-21): LLM 거부도 교사 오버사이트용으로 기록(원문 미기록). */
        logger.warn('[studentStoryDraft] LLM 소재 거부', { by: ctx.uid, classId, level });
        await admin.database().ref('ai-stats/storyDraftBlocked').push({
          by: ctx.uid, classId, level, phase: 'llm_refused',
          at: admin.database.ServerValue.TIMESTAMP,
        }).catch(() => {});
        return { ok: false, refused: true, reason: String(draft.reason || '').slice(0, 200) };
      }
      const shapeErr = _validateStudentStoryDraft(draft, storyCount, level);
      if (shapeErr) throw new Error('shape: ' + shapeErr);

      /* CHAR-CONSIST-1: 인물 외형 시트 저장(level 1) — generateStoryImages가 전 장면에 주입.
         비치명(실패해도 초안 유효 — 그림은 whole-story 일관성 프레임으로 폴백). */
      if (level === 1 && Array.isArray(draft.characters) && draft.characters.length) {
        const sheet = draft.characters.map((c) => c.name + ': ' + c.look).join('\n').slice(0, 500);
        await admin.database().ref(`${teamBase}/aiVariants/characterSheet`).set(sheet)
          .catch((e) => logger.warn('[studentStoryDraft] characterSheet 저장 실패', { message: e && e.message }));
      }

      /* 감사로그 — 비치명(push 실패가 성공한 초안을 삼키지 않음) */
      await admin.database().ref('ai-stats/storyDraft').push({
        by: ctx.uid, classId, level, storyCount,
        inputTokens: ai.inputTokens, outputTokens: ai.outputTokens, stopReason: ai.stopReason,
        at: admin.database.ServerValue.TIMESTAMP,
      }).catch((e) => logger.warn('[studentStoryDraft] stats push fail', { message: e && e.message }));
      logger.info('[studentStoryDraft]', { by: ctx.uid, classId, level, storyCount, out: ai.outputTokens });

      return { ok: true, draft, level, storyCount };
    } catch (e) {
      /* AI/파싱 실패 = 팀 총량 1회 환불 후 구체 메시지 전달 */
      await refund();
      logger.error('[studentStoryDraft] fail', { by: ctx.uid, message: e && e.message });
      if (e instanceof HttpsError) throw e;
      throw new HttpsError('internal', '이야기 초안을 만들지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  }
);

/* PICTUREBOOK-LEVELS ③: AI 출력 정리 — null 제거·문자열 강제·개수/번호 정규화.
   가벼운 슬립(초과 장면·번호 흐트러짐)은 살리고, 본질 결함만 _validateStudentStoryDraft가 거른다.
   LEVELS-CONT-B(2단계 이어쓰기): level 2 = 시작 3장면 완성문만(scenes 정확히 3개)·엔딩 빈 값.
   결정적 강제 — AI가 4장면 이상이나 엔딩을 써도 잘라낸다("AI는 시작만, 아이가 완성").
   씨앗 힌트는 서버 출력에 없음(클라가 나침반 답으로 위치 기반 생성). level 1은 기존 동일. */
const STORY_DRAFT_CONT_FULL_SCENES = 3;   /* 2단계에서 AI가 완성문으로 쓰는 시작 장면 수 */

function _sanitizeStudentStoryDraft(d, storyCount, level) {
  if (!d || typeof d !== 'object' || d.refused === true) return d;
  const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const cont = (level === 2);
  const keep = cont ? STORY_DRAFT_CONT_FULL_SCENES : storyCount;
  const scenes = (Array.isArray(d.scenes) ? d.scenes : [])
    .filter((s) => s && typeof s === 'object' && (s.body || s.title))
    .slice(0, keep)
    .map((s, i) => ({ num: i + 1, title: str(s.title, 40), body: str(s.body, 600) }));
  const ending = cont
    ? { title: '', body: '' }   /* 엔딩은 아이 몫 — AI가 써도 버림 */
    : { title: str(d.ending && d.ending.title, 40), body: str(d.ending && d.ending.body, 600) };
  /* CHAR-CONSIST-1: level 1 = 인물 외형 고정 시트(characters) — 그림 9장 프롬프트에 동일 주입용.
     선택 필드(없어도 초안 유효 — 시트 없으면 그림은 whole-story 일관성만). 최대 3명·look 160자. */
  const out = { title: str(d.title, 40), scenes, ending };
  if (level === 1 && Array.isArray(d.characters)) {
    const chars = d.characters
      .filter((c) => c && typeof c === 'object' && (c.name || c.look))
      .slice(0, 3)
      .map((c) => ({ name: str(c.name, 20), look: str(c.look, 160) }))
      .filter((c) => c.name && c.look);
    if (chars.length) out.characters = chars;
  }
  return out;
}

function _validateStudentStoryDraft(d, storyCount, level) {
  if (!d || typeof d !== 'object') return '객체 아님';
  if (!d.title) return 'title 없음';
  const cont = (level === 2);
  const want = cont ? STORY_DRAFT_CONT_FULL_SCENES : storyCount;
  if (!Array.isArray(d.scenes) || d.scenes.length !== want) {
    return `scenes ${want}개 아님 (${Array.isArray(d.scenes) ? d.scenes.length : 0})`;
  }
  for (let i = 0; i < d.scenes.length; i++) {
    if (!d.scenes[i].body) return `scenes[${i}] body 없음`;
  }
  if (!cont && (!d.ending || !d.ending.body)) return 'ending body 없음';
  return null;
}

/* ════════════════════════════════════════════════════════════════
   PICTUREBOOK-LEVELS ④(2026-07-18): generateStoryImages — 1단계 자동 그림.
   ──────────────────────────────────────────────────────────────
   · 대상: picturebookLevel===1(서버 read) 작품의 본문 있는 비표지 장면.
   · 그림 = /v1/images/generations(어댑터 createOpenAiStoryImageAdapter·말풍선 PoC 구도).
   · 결과는 기존 s2 변형 슬롯(aiVariants/image/{sid}/s2)에 저장 → AI-DEFAULT-VIEW-1이
     감상 기본으로 자동 표시(뷰어/인쇄 무변경 원칙). 원본 scene.imageData/imageUrl 무접촉.
   · 말풍선 자동 배치: 장면에 picturebookBodyBox가 없을 때만 상단 밴드 프리셋 기록
     (아이가 조정한 좌표는 절대 덮지 않음).
   · 게이트: _validateRequest(imageS2 — 교사 'AI 그림책 마감' 토글 재사용)+단계+팀당 총량
     (§9 팀당 총량 결정: 자동 1회분+장면별 🔁 여유). 배치는 팀 lock으로 이중 실행 방지.
   · 호출: 배치(data 없음=초안 직후 maker가 fire-and-forget) / 단일({sceneId, force}=🔁 재생성).
   정본: docs/picturebook_levels_design_20260718.md §7.5·§7.6·§9
   ════════════════════════════════════════════════════════════════ */
const STORY_IMAGE_TEAM_LIMIT = 24;
/* 감사 H6(2026-07-21): 이미지 생성 전역 일일 hard cap — 텍스트 전역(GLOBAL_DAILY_LIMIT)과
   별도 카운터(ai-usage-global/{ymd}/imageGenCalls). meta 쓰기 개방으로 가짜 학급·팀을
   자가생성해 팀당 24를 무한 반복하는 비용 체인의 전체 상한. 정상 사용(학급당 1단계
   9~12장×팀수)에는 여유. */
const STORY_IMAGE_GLOBAL_DAILY_LIMIT = 500;
const STORY_IMAGE_LOCK_STALE_MS = 10 * 60 * 1000;
const STORY_IMAGE_BODYBOX_PRESET = { x: 6, y: 5, width: 88, backdropOpacity: 0.85 };

function _selectStoryImageAdapter() {
  let key = '';
  try { key = IMAGE_OPENAI_API_KEY.value() || ''; } catch (e) { key = ''; }
  if (key) return ImageS2OpenAi.createOpenAiStoryImageAdapter({ apiKey: key, model: 'gpt-image-2', timeoutMs: 150000 });
  return ImageS2Adapter.createNotConfiguredAdapter();
}

/* ════════════════════════════════════════════════════════════════
   LV1-PROTAG-VISION(2026-07-22): 아이가 그린 주인공을 "그림 그대로(edits)"가 아니라
   AI 비전이 글로 설명 → 그 글을 순수 생성 프롬프트에 병합. 손그림의 거친 선/뒤틀린 얼굴이
   결과에 새어들지 않으면서(화풍 안정) 아이가 그린 캐릭터 특징(모자·색·소품)만 반영.
   PoC 검증: 배드민턴 소년 손그림→"빨간 리본 모자+라켓 든 아이"→전 장면 정교·일관.
   ══ 옛 edits 레퍼런스(+prot1·괴물/불일치)를 대체 ══
   · 이야기당 1회만 설명(aiVariants/protagonistDesc 캐시)·재실행 재사용.
   · 실패(다운로드/비전/비허용호스트) = 설명 없이 순수 생성(=두드림 품질·페일세이프).
   ════════════════════════════════════════════════════════════════ */
const PROTAG_VISION_SYSTEM = '아이가 그린 그림책 주인공 스케치를 보고, 그림 AI가 참고할 "인물 외형 설명"을 한국어 한 문장(40자 이내)으로 만드세요. 아이가 의도적으로 그린 특징(모자·머리색·소품·복장·색)만 담고, 그림이 거칠거나 서툰 점·선의 모양·낙서는 절대 언급하지 마세요. 예: "빨간 챙 모자를 쓰고 배드민턴 라켓을 든 남자아이".';

async function _describeProtagonist(imageUrl, anthropicKey) {
  try {
    if (!imageUrl || !ImageS2OpenAi.isAllowedSourceUrl(imageUrl)) return null;
    const res = await fetch(imageUrl);
    if (!res || !res.ok) return null;
    const ct = (res.headers && res.headers.get ? (res.headers.get('content-type') || '') : '').toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf || !buf.length || buf.length > 8 * 1024 * 1024) return null;
    let media = ct.indexOf('png') !== -1 ? 'image/png'
      : ct.indexOf('webp') !== -1 ? 'image/webp'
      : ct.indexOf('gif') !== -1 ? 'image/gif' : 'image/jpeg';
    const content = [
      { type: 'image', source: { type: 'base64', media_type: media, data: buf.toString('base64') } },
      { type: 'text', text: '이 그림 속 주인공의 외형을 한 문장으로 설명해줘.' },
    ];
    const ai = await _callAnthropic(anthropicKey, PROTAG_VISION_SYSTEM, content, null, { maxTokens: 200, timeoutMs: 30000 });
    const desc = String(ai && ai.text ? ai.text : '').replace(/[«»"]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
    return desc || null;
  } catch (e) {
    logger.warn('[generateStoryImages] 주인공 비전 설명 실패(무레퍼런스 진행)', { message: e && e.message });
    return null;
  }
}

exports.generateStoryImages = onCall(
  /* 9장 × 15~40s, 동시성 3 → 여유 있게 540s. 시간 초과로 일부만 되면 재호출이 dedup으로 이어서 채움.
     ANTHROPIC_API_KEY: LV1-PROTAG-VISION — 주인공 손그림 1회 설명용(Claude 비전). */
  { enforceAppCheck: false, secrets: [IMAGE_OPENAI_API_KEY, ANTHROPIC_API_KEY], timeoutSeconds: 540 },
  async (req) => {
    /* 권한/설정/멤버십/killswitch — 교사 토글은 기존 'AI 그림책 마감'(modes.imageS2) 재사용 */
    const ctx = await _validateRequest(req, 'imageS2', { skipUsageLimits: true });
    /* 감사 H6(2026-07-21): 실행 자격 — callImageAiS2와 동일한 actor 판정(교사 또는 그 팀
       active 멤버). 익명 uid가 남의/가짜 팀 경로로 유료 생성을 트리거하는 진입로 차단. */
    const actor = await _resolveImageS2Actor(ctx, req);
    if (!actor.ok) {
      throw new HttpsError('permission-denied', '자기 모둠 작품에서만 그림을 만들 수 있어요.');
    }
    const enc = encodeURIComponent(ctx.teamName);
    const baseRef = admin.database().ref(`classes/${ctx.classId}/teams/${enc}`);

    /* 단계 게이트 — 1단계 전용(서버 read·클라 위조 불가) */
    const lvl = Number((await baseRef.child('viewer-meta/picturebookLevel').once('value')).val());
    if (lvl !== 1) {
      throw new HttpsError('failed-precondition', 'STORY_IMAGE_LEVEL (이 기능은 그림책 1단계 작품에서만 쓸 수 있어요)');
    }

    const d = req.data || {};
    const singleSceneId = d.sceneId != null ? ImageS2Gen.sanitizeSeg(d.sceneId) : null;
    if (d.sceneId != null && !singleSceneId) {
      throw new HttpsError('invalid-argument', 'sceneId가 올바르지 않아요.');
    }
    const force = d.force === true;

    /* 대상 장면 — 본문 있는 비표지(엔딩 포함). 표지는 제목 중심이라 제외(§7.5·비용 고정) */
    const scenes = (await baseRef.child('scenes').once('value')).val() || {};
    let targetIds = Object.keys(scenes).filter((sid) => {
      const sc = scenes[sid];
      if (!sc || typeof sc !== 'object' || sc.type === 'cover') return false;
      return typeof sc.body === 'string' && sc.body.trim().length > 0;
    });
    if (singleSceneId) {
      targetIds = targetIds.filter((s) => s === singleSceneId);
      if (targetIds.length === 0) {
        throw new HttpsError('failed-precondition', '그림을 만들 수 있는 장면이 아니에요(본문이 있어야 해요).');
      }
    }
    if (targetIds.length === 0) {
      return { ok: true, generated: 0, skipped: 0, failed: [], total: 0 };
    }

    /* 배치 lock — 초안 직후 fire와 재진입 fire가 겹쳐도 이중 생성 방지(10분 stale 인수) */
    const lockRef = baseRef.child('aiUsage/imageGenLock');
    if (!singleSceneId) {
      const now = Date.now();
      const tx = await lockRef.transaction((cur) => {
        if (typeof cur === 'number' && now - cur < STORY_IMAGE_LOCK_STALE_MS) return;   /* abort=사용 중 */
        return now;
      });
      if (!tx.committed) {
        return { ok: false, code: 'BUSY', message: '이미 그림을 만드는 중이에요. 잠시 뒤에 감상에서 확인해 주세요.' };
      }
    }
    const releaseLock = async () => {
      if (!singleSceneId) { try { await lockRef.remove(); } catch (e) { /* stale 인수로 자연 해소 */ } }
    };

    try {
      const adapter = _selectStoryImageAdapter();
      if (adapter.configured !== true) {
        throw new HttpsError('failed-precondition', '이미지 AI가 아직 준비되지 않았어요. 선생님께 말씀드려 주세요.');
      }
      const wholeStoryText = await _buildWholeStoryText(baseRef);
      /* CHAR-CONSIST-1: 초안이 저장한 인물 외형 고정 시트 — 전 장면 프롬프트에 동일 주입
         (없으면 null = 기존 whole-story 일관성 프레임만·페일세이프). */
      let characterSheet = null;
      try {
        const _cs = (await baseRef.child('aiVariants/characterSheet').once('value')).val();
        if (typeof _cs === 'string' && _cs.trim()) characterSheet = _cs.trim().slice(0, 500);
      } catch (e) { characterSheet = null; }
      /* LV1-PROTAG-VISION(2026-07-22): 아이가 그린 주인공(viewer-meta/protagonistRef·선택) —
         있으면 비전으로 1회 설명(캐시)→characterSheet에 병합. 순수 생성 그대로라 화풍 안정.
         설명 실패/없음 = characterSheet만(=레퍼런스 없는 순수 생성·페일세이프). */
      let usedProtagDesc = false;
      try {
        const _prRef = (await baseRef.child('viewer-meta/protagonistRef').once('value')).val();
        if (typeof _prRef === 'string' && ImageS2OpenAi.isAllowedSourceUrl(_prRef.trim())) {
          const _prUrl = _prRef.trim();
          /* 캐시: 같은 그림이면 재설명 안 함(url+desc 저장). 다른 그림이면 갱신. */
          let desc = null;
          try {
            const cache = (await baseRef.child('aiVariants/protagonistDesc').once('value')).val();
            if (cache && cache.url === _prUrl && typeof cache.desc === 'string' && cache.desc.trim()) desc = cache.desc.trim();
          } catch (e) { /* 캐시 무시 */ }
          if (!desc) {
            desc = await _describeProtagonist(_prUrl, ANTHROPIC_API_KEY.value());
            if (desc) {
              await baseRef.child('aiVariants/protagonistDesc').set({ url: _prUrl, desc, at: admin.database.ServerValue.TIMESTAMP }).catch(() => {});
            }
          }
          if (desc) {
            /* 캐릭터 시트 맨 앞에 주인공 실제 모습을 "최우선"으로 명시 — 아이가 직접 그린 것이므로
               초안 시트의 주인공 묘사와 충돌하면 이 그림 설명을 따르게(모자·색·소품이 옆 인물로
               새지 않게). ★강조로 중심 인물 고정. */
            const _protLine = '★가장 중요: 이 이야기의 중심 주인공(메인 캐릭터)의 실제 모습은 아이가 직접 그린 다음과 같습니다 — 반드시 "주인공 본인"을 이 모습 그대로(모자·머리색·소품 포함) 그리고, 이 특징을 다른 조연에게 주지 마세요: ' + desc;
            characterSheet = characterSheet ? (_protLine + '\n(참고 — 나머지 인물 외형)\n' + characterSheet).slice(0, 600) : _protLine.slice(0, 600);
            usedProtagDesc = true;
          }
        }
      } catch (e) { logger.warn('[generateStoryImages] protagonistDesc 병합 실패(무레퍼런스)', { message: e && e.message }); }
      const limitRef = baseRef.child('aiUsage/imageGen');
      /* 감사 H6: 전역 일일 카운터 — 팀 총량과 같은 transaction 강제(검사-차감 원자) */
      const globalImgRef = admin.database().ref(`ai-usage-global/${_todayYmd()}/imageGenCalls`);
      /* LV1-PROTAG-VISION: 주인공 설명 반영본은 dedup 버전 분리(+vis1) — 옛 +prot1(edits)·
         무레퍼런스 버전과 안 섞이고, 아이가 나중에 그리면 그때 재생성되게. */
      const PV = ImageS2OpenAi.STORY_IMAGE_PROMPT_VERSION + (usedProtagDesc ? '+vis1' : '');

      let generated = 0, skipped = 0, limitReached = false, globalLimitReached = false;
      const failed = [];
      const queue = [...targetIds].sort((a, b) => (Number(a) || 0) - (Number(b) || 0));

      const workOne = async (sid) => {
        const body = String(scenes[sid].body || '').trim();
        /* STORYDRAFT-SAFETY-1(2026-07-21): 그림화 전 본문 키워드 스캔 — 아이가 장면을 수동으로
           폭력/성적 텍스트로 고쳐 재생성해도 그림 생성을 건너뛴다(OpenAI 모더레이션 앞단 결정적 차단).
           안전한 초안 본문은 무영향(빈도 0). 차단 장면은 실패로 집계·차감 없음. */
        if (body) {
          const _bs = _scanSafety({ [sid]: { body } });
          if (_bs.blocked) {
            logger.warn('[generateStoryImages] 본문 안전 차단 — 그림 생략', { classId: ctx.classId, sid, categories: _bs.categories });
            failed.push({ sceneId: sid, code: 'SAFETY_BLOCKED' });
            return;
          }
        }
        /* dedup — 이미 이 버전 결과가 있으면 스킵(차감 0). force(🔁)는 재생성 */
        let existing = null;
        try { existing = (await baseRef.child(`aiVariants/image/${sid}/s2`).once('value')).val(); } catch (e) { existing = null; }
        if (!force && existing && existing.url && existing.stale !== true && existing.promptVersion === PV) {
          skipped++; return;
        }
        /* 팀당 총량 — 장면당 1 소모(실패 시 환불) */
        const tx = await limitRef.transaction((cur) => {
          const n = (typeof cur === 'number' && cur >= 0) ? cur : 0;
          if (n >= STORY_IMAGE_TEAM_LIMIT) return;
          return n + 1;
        });
        if (!tx.committed) { limitReached = true; return; }
        /* 감사 H6: 전역 일일 캡 — 도달 시 팀 카운터 즉시 반납 후 중단 */
        const gTx = await globalImgRef.transaction((cur) => {
          const n = (typeof cur === 'number' && cur >= 0) ? cur : 0;
          if (n >= STORY_IMAGE_GLOBAL_DAILY_LIMIT) return;
          return n + 1;
        });
        if (!gTx.committed) {
          globalLimitReached = true;
          await limitRef.transaction((cur) => Math.max(0, (cur || 0) - 1)).catch(() => {});
          return;
        }
        /* 실패 환불 = 팀·전역 동시(성공분만 카운트 유지) */
        const refund = () => Promise.allSettled([
          limitRef.transaction((cur) => Math.max(0, (cur || 0) - 1)),
          globalImgRef.transaction((cur) => Math.max(0, (cur || 0) - 1)),
        ]);

        try {
          const gen = await adapter.generate({ storyText: body, wholeStoryText, characterSheet });
          if (!gen || gen.ok !== true) { await refund(); failed.push({ sceneId: sid, code: (gen && gen.code) || 'IMAGE_AI_PROVIDER_ERROR' }); return; }
          const outv = ImageS2Gen.validateModelOutput({ bytes: gen.bytes, mimeType: gen.mimeType });
          if (!outv.ok) { await refund(); failed.push({ sceneId: sid, code: outv.code }); return; }

          const storagePath = ImageS2Gen.buildS2StoragePath(ctx.classId, enc, sid, require('crypto').randomUUID(), gen.mimeType);
          if (!storagePath || !ImageS2Gen.isAllowedS2StoragePath(storagePath)) { await refund(); failed.push({ sceneId: sid, code: 'IMAGE_AI_INTERNAL_PATH' }); return; }
          const up = await _uploadImageS2Result({ storagePath, bytes: gen.bytes, mimeType: gen.mimeType });

          const variant = ImageS2Gen.buildS2Variant({
            url: up.url, storagePath, sourceMode: 'gen',
            basedOnImageHash: ImageS2Gen.computeImageBasedHash(body, sid, 'gen'),
            model: gen.model || adapter.model, modelVersion: gen.modelVersion || adapter.modelVersion,
            promptVersion: PV, finalizedAt: Date.now(),
          });
          if (!variant) { await refund(); failed.push({ sceneId: sid, code: 'IMAGE_AI_WRITE_FAILED' }); return; }
          /* buildS2Variant 기본 promptVersion은 s2 정본 — 생성판 버전으로 명시 고정 */
          variant.promptVersion = PV;
          await baseRef.child(`aiVariants/image/${sid}/s2`).set(variant);

          /* 이전 결과 객체는 7일 유예 cleanup-queue(기존 s2 패턴·best-effort) */
          if (existing && existing.storagePath && existing.storagePath !== storagePath) {
            try { await admin.database().ref('cleanup-queue/imageS2').push(ImageS2Gen.buildCleanupQueueRecord(existing.storagePath, Date.now())); } catch (e) { /* ignore */ }
          }
          /* 말풍선 자동 배치 — 좌표가 아직 없을 때만 상단 밴드 프리셋(아이 조정 보존) */
          try {
            const bb = (await baseRef.child(`scenes/${sid}/picturebookBodyBox`).once('value')).val();
            if (!bb) await baseRef.child(`scenes/${sid}/picturebookBodyBox`).set(STORY_IMAGE_BODYBOX_PRESET);
          } catch (e) { /* 프리셋 실패는 비치명(렌더 기본값 폴백) */ }
          generated++;
        } catch (e) {
          await refund();
          failed.push({ sceneId: sid, code: 'IMAGE_AI_UPLOAD_FAILED' });
        }
      };

      /* 동시성 3 워커 풀 */
      const workers = Array.from({ length: 3 }, async () => {
        while (queue.length > 0 && !limitReached && !globalLimitReached) {
          const sid = queue.shift();
          if (sid == null) break;
          await workOne(sid);
        }
      });
      await Promise.all(workers);

      await admin.database().ref('ai-stats/imageGen').push({
        by: ctx.uid, classId: ctx.classId, generated, skipped, failedCount: failed.length,
        limitReached, globalLimitReached, at: admin.database.ServerValue.TIMESTAMP,
      }).catch(() => {});
      logger.info('[generateStoryImages]', {
        by: ctx.uid, classId: ctx.classId, teamName: ctx.teamName,
        generated, skipped, failedCount: failed.length, limitReached, globalLimitReached, single: !!singleSceneId,
      });
      return { ok: true, generated, skipped, failed, limitReached, globalLimitReached, total: targetIds.length };
    } finally {
      await releaseLock();
    }
  }
);

/* ════════════════════════════════════════════════════════════════
   SHELF-1(2026-07-11): 학급 책장 조회 — 코드/공개 검증은 서버에서.
   ──────────────────────────────────────────────────────────────
   · 입력: { classCode } (반 학생 — 코드 지식 = 입장권) 또는 { classId } (링크 모드 —
     settings/shelfPublic === true 일 때만). 인증 불요(외부 감상자 포함).
   · 반환: 학급 이름 + classes/{cid}/shelf 노드(공개 작품만 — 관리화면 공개 토글이 유지)
     + 팀별 댓글 수. shelf 노드는 클라 read 금지(rules) — 이 함수가 유일한 읽기 경로라
     "classId만 아는 외부인"이 공개 토글 없이 팀명 목록을 긁어갈 수 없다.
   ════════════════════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════════
   TEACHER-CLONE-FULL(2026-07-12): 교사 전용 작품 완전 복제.
   ──────────────────────────────────────────────────────────────
   배경: 학생용 복사(redeemCopyCode)는 의도적으로 작품 본체(scenes+viewer-meta)만
   복사한다. 그러나 시연·클린룸(블라인드 대응)용 복제는 AI 변형 토글이 살아있어야
   해서 aiVariants 등 산출물까지 필요 — 해당 노드들은 클라 write:false(rules)라
   서버(admin SDK) 콜러블로만 가능. 학생 복사 흐름은 무변경.
   · 게이트: super_admin ∥ (src·dst 두 학급 모두의 담당 교사)
   · 복사: scenes·viewer-meta(isPublic:false 강제+copiedFrom full 스탬프)
           ·aiVariants·aiVariantSummary·aiChecks·writingGuide(있는 것만)
   · 제외: account/pin/members/session/comments (계정·개인정보·소통 기록)
   · dst는 빈 작품(scenes 없음)이어야 함. 단일 원자 update. rules 무변경.
   ════════════════════════════════════════════════════════════════ */
const CLONE_NODES = ['scenes', 'viewer-meta', 'aiVariants', 'aiVariantSummary', 'aiChecks', 'writingGuide'];

exports.teacherCloneTeamFull = onCall(
  { enforceAppCheck: false },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', '로그인이 필요해요.');
    const uid  = req.auth.uid;
    const role = (req.auth.token && req.auth.token.role) || null;

    const field = (k) => {
      const v = String((req.data && req.data[k]) || '').trim();
      if (!v || /[.#$\[\]\/]/.test(v)) throw new HttpsError('invalid-argument', k + '가 올바르지 않아요.');
      return v;
    };
    const srcClassId = field('srcClassId');
    const dstClassId = field('dstClassId');
    const srcEnc = encodeURIComponent(field('srcTeamName'));
    const dstEnc = encodeURIComponent(field('dstTeamName'));
    if (srcClassId === dstClassId && srcEnc === dstEnc) {
      throw new HttpsError('invalid-argument', '같은 작품으로는 복제할 수 없어요.');
    }

    /* 교사 게이트 — super_admin 아니면 두 학급 모두 담당 교사여야 */
    if (role !== 'super_admin') {
      const [srcT, dstT] = await Promise.all([
        admin.database().ref(`classes/${srcClassId}/meta/teacher_uid`).once('value'),
        admin.database().ref(`classes/${dstClassId}/meta/teacher_uid`).once('value'),
      ]);
      if (srcT.val() !== uid || dstT.val() !== uid) {
        throw new HttpsError('permission-denied', '두 학급 모두의 담당 교사만 완전 복제를 할 수 있어요.');
      }
    }

    const srcBase = `classes/${srcClassId}/teams/${srcEnc}`;
    const dstBase = `classes/${dstClassId}/teams/${dstEnc}`;

    /* 원본 존재 + 대상 빈 작품 확인 */
    const [srcScenes, dstScenes] = await Promise.all([
      admin.database().ref(`${srcBase}/scenes`).once('value'),
      admin.database().ref(`${dstBase}/scenes`).once('value'),
    ]);
    if (!srcScenes.exists()) throw new HttpsError('not-found', '원본 작품에 장면이 없어요.');
    if (dstScenes.exists()) throw new HttpsError('failed-precondition', '이미 작품이 있는 모둠이에요. 빈 모둠으로만 복제할 수 있어요.');

    /* 노드 일괄 read → 단일 원자 update */
    const snaps = await Promise.all(
      CLONE_NODES.map((n) => admin.database().ref(`${srcBase}/${n}`).once('value')));
    const updates = {};
    const copied = [];
    CLONE_NODES.forEach((n, i) => {
      if (!snaps[i].exists()) return;
      let val = snaps[i].val();
      if (n === 'viewer-meta') {
        val = Object.assign({}, val, {
          isPublic: false,
          copiedFrom: {
            srcClassId, srcTeamEncoded: srcEnc,
            full: true, by: uid, copiedAt: admin.database.ServerValue.TIMESTAMP,
          },
        });
      }
      updates[`${dstBase}/${n}`] = val;
      copied.push(n);
    });
    await admin.database().ref().update(updates);

    logger.info('[teacherCloneTeamFull]', { by: uid, srcClassId, dstClassId, copied });
    return { ok: true, copied };
  }
);

exports.getClassShelf = onCall(
  { enforceAppCheck: false },
  async (req) => {
    const codeRaw = String((req.data && req.data.classCode) || '').trim().toUpperCase();
    let classId = String((req.data && req.data.classId) || '').trim();
    if (classId && /[.#$\[\]\/]/.test(classId)) throw new HttpsError('invalid-argument', 'classId가 올바르지 않아요.');
    if (codeRaw) {
      if (!/^[A-Z0-9]{4,10}$/.test(codeRaw)) throw new HttpsError('invalid-argument', '클래스 코드 형식이 올바르지 않아요.');
      const cid = (await admin.database().ref(`classCodes/${codeRaw}`).once('value')).val();
      if (!cid) throw new HttpsError('not-found', '클래스 코드가 올바르지 않아요. 선생님께 확인해주세요.');
      classId = String(cid);
    } else if (classId) {
      const pub = (await admin.database().ref(`classes/${classId}/settings/shelfPublic`).once('value')).val();
      if (pub !== true) throw new HttpsError('permission-denied', '이 학급의 책장은 클래스 코드로만 볼 수 있어요.');
    } else {
      throw new HttpsError('invalid-argument', '클래스 코드가 필요해요.');
    }
    const metaSnap = await admin.database().ref(`classes/${classId}/meta`).once('value');
    const meta = metaSnap.val() || {};
    const shelfRaw = (await admin.database().ref(`classes/${classId}/shelf`).once('value')).val() || {};
    const works = [];
    for (const [enc, w] of Object.entries(shelfRaw)) {
      if (!w || typeof w !== 'object') continue;
      let cc = 0;
      try {
        const cSnap = await admin.database().ref(`classes/${classId}/teams/${enc}/comments`).once('value');
        cc = cSnap.numChildren();
      } catch (e) { cc = 0; }
      /* NICKNAME-1(2026-07-23): 표시 이름(닉네임)은 로그인 키(팀명)와 분리 — viewer-meta/nickname에서 읽어
         카드 라벨용으로만 반환(team=키는 그대로·열기 식별자 유지). 없으면 undefined→클라가 team으로 폴백. */
      let nick = '';
      try {
        const nSnap = await admin.database().ref(`classes/${classId}/teams/${enc}/viewer-meta/nickname`).once('value');
        const nv = nSnap.val();
        if (typeof nv === 'string' && nv.trim()) nick = nv.trim().slice(0, 30);
      } catch (e) { nick = ''; }
      works.push({
        team: decodeURIComponent(enc), enc,
        nick,
        t: (typeof w.t === 'string') ? w.t.slice(0, 60) : '',
        s: (typeof w.s === 'string') ? w.s.slice(0, 80) : '',
        ty: (typeof w.ty === 'string') ? w.ty : '',
        th: (typeof w.th === 'string') ? w.th : '',
        at: w.at || 0,
        cc,
      });
    }
    works.sort((a, b) => (b.at || 0) - (a.at || 0));
    const commentEnabled = (await admin.database().ref(`classes/${classId}/settings/commentEnabled`).once('value')).val() === true;
    return { ok: true, classId, className: meta.name || '', commentEnabled, works };
  }
);

/* ════════════════════════════════════════════════════════════════
   COMMENT-1(2026-07-11): 댓글 쓰기 — 댓글 코드는 쓰기에만 필요(읽기는 rules 직접 read).
   서버 검증: 기능 ON + 코드 일치(commentAuth/code — 클라 read 금지 노드) + 길이 제한 +
   팀당 일일 상한 30. 인증 불요(학부모/외부 코드 소지자). 삭제는 교사/총괄(rules 직접).
   ════════════════════════════════════════════════════════════════ */
exports.postWorkComment = onCall(
  { enforceAppCheck: false },
  async (req) => {
    const d = req.data || {};
    /* 감사 L6(2026-07-21): 서버측 정제 — 제어문자·제로폭/양방향 제어문자 제거(렌더 이스케이프에만
       의존하던 것 보강). 줄바꿈은 text에서만 유지. 한글·이모지 등 정상 내용은 무손상. */
    const _cleanComment = (s, keepNewline) => String(s || '')
      .replace(keepNewline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, '')
      .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '');
    const classId = String(d.classId || '').trim();
    const enc = String(d.team || '').trim();
    const code = String(d.code || '').trim();
    const name = _cleanComment(d.name, false).trim().slice(0, 12);
    const text = _cleanComment(d.text, true).trim().slice(0, 200);
    if (!classId || /[.#$\[\]\/]/.test(classId) || !enc || /[.#$\[\]\/]/.test(enc)) {
      throw new HttpsError('invalid-argument', '요청이 올바르지 않아요.');
    }
    if (!name) throw new HttpsError('invalid-argument', '이름을 적어주세요.');
    if (!text) throw new HttpsError('invalid-argument', '댓글 내용을 적어주세요.');
    if (!code) throw new HttpsError('invalid-argument', '댓글 코드를 입력해주세요. (선생님에게 받을 수 있어요)');
    const enabled = (await admin.database().ref(`classes/${classId}/settings/commentEnabled`).once('value')).val();
    if (enabled !== true) throw new HttpsError('failed-precondition', '이 학급은 아직 댓글 기능을 켜지 않았어요.');
    const realCode = (await admin.database().ref(`classes/${classId}/commentAuth/code`).once('value')).val();
    if (!realCode || String(realCode) !== code) {
      throw new HttpsError('permission-denied', '댓글 코드가 맞지 않아요. 선생님께 확인해주세요.');
    }
    /* 작품이 실제 공개 상태인지(비공개 작품에 댓글 유입 차단) */
    const isPub = (await admin.database().ref(`classes/${classId}/teams/${enc}/viewer-meta/isPublic`).once('value')).val();
    if (isPub !== true) throw new HttpsError('failed-precondition', '이 작품은 지금 댓글을 받을 수 없어요.');
    /* 팀당 일일 상한 */
    const ymd = _todayYmd();
    const cntRef = admin.database().ref(`classes/${classId}/commentDaily/${enc}/${ymd}`);
    const tx = await cntRef.transaction(n => ((n || 0) >= 30 ? undefined : (n || 0) + 1));
    if (!tx.committed) throw new HttpsError('resource-exhausted', '오늘은 이 작품에 댓글이 많이 달렸어요. 내일 다시 남겨주세요.');
    await admin.database().ref(`classes/${classId}/teams/${enc}/comments`).push({
      name, text, at: admin.database.ServerValue.TIMESTAMP,
    });
    logger.info('[postWorkComment]', { classId, team: enc });
    return { ok: true };
  }
);

/* ════════════════════════════════════════════════════════════════
   비용 추정 + stats (Cloud Logging에 기록)
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
  return Math.round((inCost + outCost) * 1_000_000) / 1_000_000;  /* 소수점 6자리 반올림 */
}

async function _logUsageStats(ctx, ai, costUsd) {
  const today = _todayYmd();
  const { classId, teamName, mode } = ctx;
  const statsRef = admin.database().ref(`ai-stats/${today}`);

  /* 토큰 누적 */
  await statsRef.child(`tokens/${mode}/input`).transaction(n => (n || 0) + ai.inputTokens);
  await statsRef.child(`tokens/${mode}/output`).transaction(n => (n || 0) + ai.outputTokens);

  /* 비용 누적 (마이크로달러 단위 — 정수로 다루는 게 안전) */
  const costMicro = Math.round(costUsd * 1_000_000);
  await statsRef.child(`cost/${mode}/microUsd`).transaction(n => (n || 0) + costMicro);
  await statsRef.child(`cost/total/microUsd`).transaction(n => (n || 0) + costMicro);

  /* 팀별 호출 수 */
  const teamKey = `${classId}__${teamName}`.replace(/[.#$/\[\]]/g, '_');
  await statsRef.child(`by-team/${teamKey}/${mode}`).transaction(n => (n || 0) + 1);

  logger.info('[ai/stats] 박힘', { mode, inputTokens: ai.inputTokens, outputTokens: ai.outputTokens, costUsd });
}

/* ════════════════════════════════════════════════════════════════
   SEC-01 — joinTeamMembership
   생각 나침반 editSession 단일 편집권한의 기반: 학생 익명 uid ↔ 팀 소속을
   "서버에서 PIN을 검증"해 증명하고 classes/{classId}/teams/{enc}/members/{uid}에
   최소 membership을 기록한다. members write는 이 Admin SDK 경로(Rules 우회)로만 가능 →
   client는 직접 members를 만들 수 없다(Rules .write:false). PIN 원문은 응답·로그·오류에
   절대 포함하지 않는다. (PIN 경로 .read 잠금은 별도 Security Phase — 현재 client 호환 유지)
   ════════════════════════════════════════════════════════════════ */
const MEMBERSHIP_VERSION = 1;
const MEMBERSHIP_RL_WINDOW_MS = 60 * 1000;   /* 1분 창 */
const MEMBERSHIP_RL_MAX = 5;                 /* 1분 5회 (E2 — 영구 차단 없음) */

function _isPlainPin(v) {
  return typeof v === 'string' && /^[0-9]{4,12}$/.test(v);
}
/* RTDB key 금지문자(. # $ / [ ]) 및 길이 차단 — classId 등 경로 세그먼트 안전성 */
function _isSafeIdSegment(v, maxLen) {
  return typeof v === 'string' && v.length >= 1 && v.length <= maxLen && !/[.#$/[\]]/.test(v);
}

exports.joinTeamMembership = onCall(
  { enforceAppCheck: false },
  async (req) => {
    /* 1. auth (익명이라도 필수) */
    if (!req.auth || !req.auth.uid) {
      throw new HttpsError('unauthenticated', '로그인이 필요해요.');
    }
    const uid = req.auth.uid;
    const provider = (req.auth.token && req.auth.token.firebase &&
      req.auth.token.firebase.sign_in_provider) || 'anonymous';

    /* 3. origin (가지 도메인만) */
    const origin = (req.rawRequest && req.rawRequest.headers && req.rawRequest.headers.origin) || '';
    if (!isOriginAllowed(origin)) {
      logger.warn('[membership] origin 거부', { uid, origin });
      throw new HttpsError('permission-denied', '허용되지 않은 요청이에요.');
    }

    /* 4. payload 엄격 검증 — 객체 외/배열/null/추가필드/prototype pollution 차단 */
    const data = req.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new HttpsError('invalid-argument', '요청 형식이 올바르지 않아요.');
    }
    const ALLOWED = ['classId', 'teamName', 'pin'];
    for (const k of Object.keys(data)) {
      if (!ALLOWED.includes(k)) {
        throw new HttpsError('invalid-argument', '요청에 허용되지 않은 항목이 있어요.');
      }
    }
    const classId = data.classId;
    const teamName = data.teamName;
    const pin = data.pin;
    if (!_isSafeIdSegment(classId, 64)) {
      throw new HttpsError('invalid-argument', '학급 정보가 올바르지 않아요.');
    }
    if (typeof teamName !== 'string' || teamName.length < 1 || teamName.length > 60) {
      throw new HttpsError('invalid-argument', '모둠 정보가 올바르지 않아요.');
    }
    /* ADMIN-TEACHER-JOIN(2026-07-09): 로그인된 교사(super_admin ∥ 이 학급 meta/teacher_uid == uid)는
       PIN 없이 자기 반 팀에 입장(편집)할 수 있다. 아래 PIN·rate limit·모드검증은 '교사가 아닐 때만' 수행.
       교사 판별은 서버 read(Admin SDK·위조 불가) → 학생/익명은 절대 우회 불가. 학생 흐름은 100% 그대로. */
    const tokenRole = (req.auth.token && req.auth.token.role) || null;
    let isTeacher = (tokenRole === 'super_admin');
    if (!isTeacher) {
      try {
        const tuid = (await admin.database().ref(`classes/${classId}/meta/teacher_uid`).once('value')).val();
        isTeacher = !!tuid && tuid === uid;
      } catch (e) { isTeacher = false; }
    }

    if (!isTeacher) {
      if (!_isPlainPin(pin)) {
        throw new HttpsError('invalid-argument', '비밀번호 형식이 올바르지 않아요.');
      }

      /* 5. rate limit — auth.uid 기준 1분 5회. 단순 창 카운터(영구 차단 없음). */
      const rlRef = admin.database().ref(`membership-attempts/${uid}`);
      const nowMs = Date.now();   /* CF 서버 프로세스 시각 */
      let overLimit = false;
      /* transaction으로 원자 증가 — 경쟁 호출에서 카운터 유실 방지.
         성공/실패 모두 카운트(성공이라고 즉시 리셋하지 않음). 창(1분) 만료 시에만 0으로. */
      await rlRef.transaction((cur) => {
        cur = cur || {};
        let count = (typeof cur.count === 'number') ? cur.count : 0;
        let windowStart = (typeof cur.windowStart === 'number') ? cur.windowStart : 0;
        if (nowMs - windowStart > MEMBERSHIP_RL_WINDOW_MS) { count = 0; windowStart = nowMs; }
        if (count >= MEMBERSHIP_RL_MAX) { overLimit = true; return; /* abort — write 없음 */ }
        return { count: count + 1, windowStart, lastAt: nowMs };
      });
      if (overLimit) {
        throw new HttpsError('resource-exhausted', '잠시 후 다시 시도해 주세요.');
      }
    }

    /* 6~7. 서버가 정본 규칙으로 encode 후 팀 생성 모드별 PIN을 Admin SDK로 검증(Rules 우회).
       client _joinTeamV2/_resumeTeamFromSession의 3모드 로직과 동일 — PIN 검증의 정본이 서버로 이동.
       통합 외부 메시지(팀/학급 존재 여부 비노출). PIN 값은 절대 로그/오류에 포함 금지. */
    const enc = encodeURIComponent(teamName);
    const teamBase = `classes/${classId}/teams/${enc}`;
    const adb = admin.database();
    const GENERIC_DENY = '학급 코드, 모둠 정보 또는 비밀번호를 다시 확인해 주세요.';

    /* ADMIN-TEACHER-JOIN: 아래 모드별 PIN 검증은 학생만 — 교사(isTeacher)는 전부 스킵하고 바로 membership 발급. */
    if (!isTeacher) {
    /* teamCreationMode — 없음/오류/알 수 없는 값 → legacy_open 폴백(client와 동일). */
    let mode = 'legacy_open';
    try {
      const mv = (await adb.ref(`classes/${classId}/settings/teamCreationMode`).once('value')).val();
      if (mv === 'teacher_managed' || mv === 'locked' || mv === 'legacy_open') mode = mv;
    } catch (e) { mode = 'legacy_open'; }

    if (mode === 'locked') {
      throw new HttpsError('permission-denied', '지금은 선생님이 입장을 잠시 닫아 두었어요.');
    }

    if (mode === 'teacher_managed') {
      /* 교사 등록 account만 입장 — account.pin 검증, 자동 팀 생성/자가등록 금지. */
      let account = null;
      try { account = (await adb.ref(`${teamBase}/account`).once('value')).val(); }
      catch (e) {
        logger.error('[membership] account read 실패', { uid, error: e && e.message });
        throw new HttpsError('internal', '잠시 후 다시 시도해 주세요.');
      }
      if (!account || account.status === 'locked' || String(account.pin) !== String(pin)) {
        logger.warn('[membership] teacher_managed 검증 실패', { uid, classId, hadAccount: !!account });
        throw new HttpsError('permission-denied', GENERIC_DENY);
      }
    } else {
      /* legacy_open — pin 비교. 없으면 첫 학생이 설정(자가 등록, 기존 client 동작 보존). */
      let savedPin = null;
      try { savedPin = (await adb.ref(`${teamBase}/pin`).once('value')).val(); }
      catch (e) {
        logger.error('[membership] pin read 실패', { uid, error: e && e.message });
        throw new HttpsError('internal', '잠시 후 다시 시도해 주세요.');
      }
      if (savedPin === null) {
        try { await adb.ref(`${teamBase}/pin`).set(pin); }
        catch (e) {
          logger.error('[membership] pin 자가등록 실패', { uid, error: e && e.message });
          throw new HttpsError('internal', '잠시 후 다시 시도해 주세요.');
        }
      } else if (String(savedPin) !== String(pin)) {
        logger.warn('[membership] legacy 검증 실패', { uid, classId });
        throw new HttpsError('permission-denied', GENERIC_DENY);
      }
    }
    }  /* end if (!isTeacher) — 교사는 모드/PIN 검증 전부 스킵 */

    /* 8. members write — joinedAt 보존, lastVerifiedAt 갱신. 개인정보(이름/PIN/기기) 미저장. */
    const memRef = admin.database().ref(`${teamBase}/members/${uid}`);
    const existed = (await memRef.once('value')).val();
    await memRef.set({
      joinedAt: (existed && typeof existed.joinedAt === 'number')
        ? existed.joinedAt : admin.database.ServerValue.TIMESTAMP,
      lastVerifiedAt: admin.database.ServerValue.TIMESTAMP,
      authType: (provider === 'anonymous') ? 'anonymous' : 'auth',
      status: 'active',
      membershipVersion: MEMBERSHIP_VERSION,
    });

    /* 성공해도 시도 카운터를 즉시 리셋하지 않음(창 만료 방식 유지 — 공격자가 1회 성공으로
       rate-limit을 무력화하지 못하게). 1분 창이 지나면 자연 리셋. */
    logger.info('[membership] 발급', { uid, classId });

    /* 9. 최소 응답 — 팀 존재/PIN 세부 비노출 */
    return { ok: true, membershipVersion: MEMBERSHIP_VERSION };
  }
);

/* ════════════════════════════════════════════════════════════════
   helper export (step3에서 사용)
   ════════════════════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════════
   callThoughtCompassFollowUp — 생각 나침반 AI 후속질문 판정 (Phase 1)
   ──────────────────────────────────────────────────────────────
   · 핵심 답변이 충분한지 판정만(이야기 대필/생성 금지, PRD 1.2).
   · 입력 최소화 + 필드 allowlist + active membership/teacher 검증.
   · 결정 NEXT/ASK_FOLLOW_UP/ASK_EASIER, 상한(후속≤5·전체≤12) 서버 강제.
   · 실패 시 1회 재시도 → fallback(G3/G4 고정 후속, 그 외 NEXT). 무조건 NEXT 아님.
   ⚠ feature branch 전용 — 실제 배포 금지(firebase deploy 하지 말 것).
   ════════════════════════════════════════════════════════════════ */
exports.callThoughtCompassFollowUp = onCall(
  {
    secrets: [ANTHROPIC_API_KEY],
    enforceAppCheck: false,
  },
  async (req) => {
    /* 1. auth(익명이라도 필수) */
    if (!req.auth || !req.auth.uid) {
      throw new HttpsError('unauthenticated', '로그인이 필요해요.');
    }
    const uid = req.auth.uid;

    /* 2. testMode 거부(v140) */
    if (req.data && req.data.testMode === true) {
      throw new HttpsError('permission-denied', 'testMode로는 실제 AI를 사용할 수 없어요.');
    }

    /* 3. origin */
    const origin = (req.rawRequest && req.rawRequest.headers && req.rawRequest.headers.origin) || '';
    if (!isOriginAllowed(origin)) {
      logger.warn('[tc/followup] origin 거부', { uid, origin });
      throw new HttpsError('permission-denied', '허용되지 않은 요청이에요.');
    }

    /* 4. 입력 검증(allowlist·타입·길이·범위·금지필드) — 순수 모듈 위임 */
    const v = TCFollowUp.validateFollowUpInput(req.data);
    if (!v.ok) {
      throw new HttpsError('invalid-argument', '요청 형식이 올바르지 않아요. (' + v.error + ')');
    }
    const input = v.value;

    /* 5. killswitch */
    const killSnap = await admin.database().ref('ai-kill-switch/enabled').once('value');
    if (killSnap.val() === true) {
      throw new HttpsError('unavailable', 'AI 기능을 잠시 사용할 수 없어요. 운영자에게 문의해 주세요.');
    }

    /* 6. active membership 또는 교사 — editSession처럼 소속 보유자만(SEC-01). */
    const enc = encodeURIComponent(input.teamName);
    let allowed = false;
    try {
      const memSnap = await admin.database().ref(`classes/${input.classId}/teams/${enc}/members/${uid}/status`).once('value');
      if (memSnap.val() === 'active') allowed = true;
    } catch (e) { /* 아래 교사 확인 */ }
    if (!allowed) {
      try {
        const teacherSnap = await admin.database().ref(`classes/${input.classId}/meta/teacher_uid`).once('value');
        const role = req.auth.token && req.auth.token.role;
        if (teacherSnap.val() === uid || role === 'teacher' || role === 'super_admin') allowed = true;
      } catch (e) { /* noop */ }
    }
    if (!allowed) {
      throw new HttpsError('permission-denied', '이 모둠의 생각 나침반을 사용할 수 없어요.');
    }

    /* 7. aiSettings 게이트(있으면 존중) — enabled 아니면 차단. 없으면 기본 ON(Phase A 호환). */
    try {
      const aiSnap = await admin.database().ref(`classes/${input.classId}/aiSettings`).once('value');
      const aiSettings = aiSnap.val();
      if (aiSettings && aiSettings.enabled !== true) {
        throw new HttpsError('permission-denied', 'AI_NOT_ENABLED_CLASS (선생님이 AI를 아직 열어주지 않았어요)');
      }
    } catch (e) { if (e instanceof HttpsError) throw e; /* 읽기 실패는 기본 ON */ }

    /* 8. 전역 일일 hard cap(읽기 기반 방어 — 후속질문은 세션 ≤5로 자체 제한) */
    try {
      const today = _todayYmd();
      const globalSnap = await admin.database().ref(`ai-usage-global/${today}/calls`).once('value');
      if ((globalSnap.val() || 0) >= GLOBAL_DAILY_LIMIT) {
        throw new HttpsError('resource-exhausted', '오늘 전체 사용 한도에 도달했어요. 내일 다시 시도해 주세요.');
      }
    } catch (e) { if (e instanceof HttpsError) throw e; }

    /* 9. 상한 도달 → AI 호출 없이 NEXT 강제(후속≤5·전체≤12, PRD 후속 전역규칙) */
    if (TCFollowUp.shouldForceNext(input)) {
      return { decision: 'NEXT', reasonCode: 'SUFFICIENT', acknowledgement: '', followUpQuestion: '', supportOptions: [], capped: true };
    }

    /* Phase N — 에뮬레이터 전용 AI stub. 운영 미적용: FUNCTIONS_EMULATOR(에뮬레이터에서만 set) +
       TC_FOLLOWUP_STUB=1 동시 충족 시에만. 실 Anthropic 미호출(키 불필요·비용 0). 결과도 동일 validator 통과. */
    if (process.env.FUNCTIONS_EMULATOR === 'true' && process.env.TC_FOLLOWUP_STUB === '1') {
      const stub = TCFollowUp.stubDecision(input);
      const sv = TCFollowUp.validateFollowUpResponse(stub);
      return Object.assign({}, sv.ok ? sv.value : TCFollowUp.followUpFallback(input.coreQuestionId), { stub: true });
    }

    /* 10. AI 호출 + 검증 (1회 재시도) → 실패 시 fallback(무조건 NEXT 아님) */
    const userMsg = TCFollowUp.buildFollowUpUserMessage(input);
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const ai = await _callAnthropic(ANTHROPIC_API_KEY.value(), THOUGHT_COMPASS_FOLLOWUP_SYSTEM_PROMPT, userMsg);
        const parsed = _parseJsonStrict(ai.text);
        const rv = TCFollowUp.validateFollowUpResponse(parsed);
        if (!rv.ok) { lastErr = new Error('schema: ' + rv.error); continue; }
        /* LEVELS-FEEDBACK(2026-07-19): '누군가' 등 대상 미상 답이 NEXT로 새는 변동성 제거 —
           첫 후속 한정 고정 후속 강제(방해/사건 계열 질문만·순수 함수). */
        const enforced = TCFollowUp.enforceVagueActorFollowUp(input, rv.value);
        logger.info('[tc/followup] ok', { uid, classId: input.classId, decision: enforced.decision, reasonCode: enforced.reasonCode, forced: enforced.forcedVagueActor === true, attempt });
        return Object.assign({}, enforced, { cached: false });
      } catch (e) {
        lastErr = e;
        logger.warn('[tc/followup] 시도 실패', { attempt, error: e && e.message });
      }
    }
    /* fallback — G3(주인공)/G4(목표)는 고정 후속, 그 외 NEXT 안전 통과 */
    logger.error('[tc/followup] AI 실패 → fallback', { uid, coreQuestionId: input.coreQuestionId, error: lastErr && lastErr.message });
    return TCFollowUp.followUpFallback(input.coreQuestionId);
  }
);

/* ════════════════════════════════════════════════════════════════
   COMPASS-VALUE-1(2026-07-21): 1단계 나침반 마지막 질문 — 가치 후보 3개.
   ──────────────────────────────────────────────────────────────
   · 아이의 나침반 답(answersText)을 분석해 "이 이야기가 말하고 싶은 가치" 후보
     3개를 매번 새로 제안(고정 보기 아님·사용자 결정). 아이가 1개 고르는 건 클라.
   · 게이트 = callThoughtCompassFollowUp와 동일(auth·testMode·origin·killswitch·
     membership/교사·aiSettings·전역캡 read). 브랜치 quota 미차감(나침반 부속·저비용).
   · 실패/비정형 = { ok:false } — 클라는 단계 없이 진행(fail-open·완료 차단 금지).
   ════════════════════════════════════════════════════════════════ */
exports.compassValueCandidates = onCall(
  { secrets: [ANTHROPIC_API_KEY], enforceAppCheck: false },
  async (req) => {
    if (!req.auth || !req.auth.uid) throw new HttpsError('unauthenticated', '로그인이 필요해요.');
    const uid = req.auth.uid;
    if (req.data && req.data.testMode === true) {
      throw new HttpsError('permission-denied', 'testMode로는 실제 AI를 사용할 수 없어요.');
    }
    const origin = (req.rawRequest && req.rawRequest.headers && req.rawRequest.headers.origin) || '';
    if (!isOriginAllowed(origin)) {
      logger.warn('[tc/value] origin 거부', { uid, origin });
      throw new HttpsError('permission-denied', '허용되지 않은 요청이에요.');
    }
    /* 입력 — 필드 3개만·타입/길이 강제 */
    const d = req.data || {};
    const classId = String(d.classId || '').trim();
    const teamName = String(d.teamName || '').trim();
    const answersText = String(d.answersText || '').trim().slice(0, 1500);
    if (!classId || /[.#$\[\]\/]/.test(classId) || !teamName || teamName.length > 40 || !answersText) {
      throw new HttpsError('invalid-argument', '요청 형식이 올바르지 않아요.');
    }
    const killSnap = await admin.database().ref('ai-kill-switch/enabled').once('value');
    if (killSnap.val() === true) {
      throw new HttpsError('unavailable', 'AI 기능을 잠시 사용할 수 없어요. 운영자에게 문의해 주세요.');
    }
    const enc = encodeURIComponent(teamName);
    let allowed = false;
    try {
      const memSnap = await admin.database().ref(`classes/${classId}/teams/${enc}/members/${uid}/status`).once('value');
      if (memSnap.val() === 'active') allowed = true;
    } catch (e) { /* 아래 교사 확인 */ }
    if (!allowed) {
      try {
        const teacherSnap = await admin.database().ref(`classes/${classId}/meta/teacher_uid`).once('value');
        const role = req.auth.token && req.auth.token.role;
        if (teacherSnap.val() === uid || role === 'teacher' || role === 'super_admin') allowed = true;
      } catch (e) { /* noop */ }
    }
    if (!allowed) throw new HttpsError('permission-denied', '이 모둠의 생각 나침반을 사용할 수 없어요.');
    try {
      const aiSnap = await admin.database().ref(`classes/${classId}/aiSettings`).once('value');
      const aiSettings = aiSnap.val();
      if (aiSettings && aiSettings.enabled !== true) {
        throw new HttpsError('permission-denied', 'AI_NOT_ENABLED_CLASS (선생님이 AI를 아직 열어주지 않았어요)');
      }
    } catch (e) { if (e instanceof HttpsError) throw e; }
    try {
      const today = _todayYmd();
      const globalSnap = await admin.database().ref(`ai-usage-global/${today}/calls`).once('value');
      if ((globalSnap.val() || 0) >= GLOBAL_DAILY_LIMIT) {
        throw new HttpsError('resource-exhausted', '오늘 전체 사용 한도에 도달했어요. 내일 다시 시도해 주세요.');
      }
    } catch (e) { if (e instanceof HttpsError) throw e; }

    const userMsg = buildCompassValueUserMessage({ answersText });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const ai = await _callAnthropic(ANTHROPIC_API_KEY.value(), COMPASS_VALUE_SYSTEM_PROMPT, userMsg);
        const parsed = _parseJsonStrict(ai.text);
        const rv = validateCompassValueResponse(parsed);
        if (!rv.ok) { continue; }
        logger.info('[tc/value] ok', { uid, classId, words: rv.value.values.map((x) => x.word).join('/'), attempt });
        return { ok: true, values: rv.value.values };
      } catch (e) {
        logger.warn('[tc/value] 시도 실패', { attempt, error: e && e.message });
      }
    }
    /* fail-open — 클라는 이 단계를 건너뛰고 완료 진행 */
    logger.warn('[tc/value] 후보 생성 실패 → 단계 생략', { uid, classId });
    return { ok: false };
  }
);

/* ADAPTIVE-CHOICES(2026-07-24): 생각 나침반 맥락 맞춤 보기 — compassValueCandidates 판박이.
   앞 답과 모순되지 않는 짧은 보기 3개 반환. 실패=fail-open({ok:false})→클라가 고정 보기 폴백. */
exports.compassAdaptiveChoices = onCall(
  { secrets: [ANTHROPIC_API_KEY], enforceAppCheck: false },
  async (req) => {
    if (!req.auth || !req.auth.uid) throw new HttpsError('unauthenticated', '로그인이 필요해요.');
    const uid = req.auth.uid;
    if (req.data && req.data.testMode === true) {
      throw new HttpsError('permission-denied', 'testMode로는 실제 AI를 사용할 수 없어요.');
    }
    const origin = (req.rawRequest && req.rawRequest.headers && req.rawRequest.headers.origin) || '';
    if (!isOriginAllowed(origin)) {
      logger.warn('[tc/choices] origin 거부', { uid, origin });
      throw new HttpsError('permission-denied', '허용되지 않은 요청이에요.');
    }
    /* 입력 — 필드 강제 */
    const d = req.data || {};
    const classId = String(d.classId || '').trim();
    const teamName = String(d.teamName || '').trim();
    const questionTitle = String(d.questionTitle || '').trim().slice(0, 200);
    const priorAnswersText = String(d.priorAnswersText || '').trim().slice(0, 1500);
    const staticChoices = Array.isArray(d.staticChoices)
      ? d.staticChoices.filter((s) => typeof s === 'string').slice(0, 6) : [];
    if (!classId || /[.#$\[\]\/]/.test(classId) || !teamName || teamName.length > 40 || !questionTitle || !priorAnswersText) {
      throw new HttpsError('invalid-argument', '요청 형식이 올바르지 않아요.');
    }
    const killSnap = await admin.database().ref('ai-kill-switch/enabled').once('value');
    if (killSnap.val() === true) {
      throw new HttpsError('unavailable', 'AI 기능을 잠시 사용할 수 없어요. 운영자에게 문의해 주세요.');
    }
    const enc = encodeURIComponent(teamName);
    let allowed = false;
    try {
      const memSnap = await admin.database().ref(`classes/${classId}/teams/${enc}/members/${uid}/status`).once('value');
      if (memSnap.val() === 'active') allowed = true;
    } catch (e) { /* 아래 교사 확인 */ }
    if (!allowed) {
      try {
        const teacherSnap = await admin.database().ref(`classes/${classId}/meta/teacher_uid`).once('value');
        const role = req.auth.token && req.auth.token.role;
        if (teacherSnap.val() === uid || role === 'teacher' || role === 'super_admin') allowed = true;
      } catch (e) { /* noop */ }
    }
    if (!allowed) throw new HttpsError('permission-denied', '이 모둠의 생각 나침반을 사용할 수 없어요.');
    try {
      const aiSnap = await admin.database().ref(`classes/${classId}/aiSettings`).once('value');
      const aiSettings = aiSnap.val();
      if (aiSettings && aiSettings.enabled !== true) {
        throw new HttpsError('permission-denied', 'AI_NOT_ENABLED_CLASS (선생님이 AI를 아직 열어주지 않았어요)');
      }
    } catch (e) { if (e instanceof HttpsError) throw e; }
    try {
      const today = _todayYmd();
      const globalSnap = await admin.database().ref(`ai-usage-global/${today}/calls`).once('value');
      if ((globalSnap.val() || 0) >= GLOBAL_DAILY_LIMIT) {
        throw new HttpsError('resource-exhausted', '오늘 전체 사용 한도에 도달했어요. 내일 다시 시도해 주세요.');
      }
    } catch (e) { if (e instanceof HttpsError) throw e; }

    const userMsg = buildCompassChoicesUserMessage({ questionTitle, priorAnswersText, staticChoices });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const ai = await _callAnthropic(ANTHROPIC_API_KEY.value(), COMPASS_CHOICES_SYSTEM_PROMPT, userMsg);
        const parsed = _parseJsonStrict(ai.text);
        const rv = validateCompassChoicesResponse(parsed);
        if (!rv.ok) { continue; }
        logger.info('[tc/choices] ok', { uid, classId, labels: rv.value.choices.map((x) => x.label).join('/'), attempt });
        return { ok: true, choices: rv.value.choices };
      } catch (e) {
        logger.warn('[tc/choices] 시도 실패', { attempt, error: e && e.message });
      }
    }
    /* fail-open — 클라는 고정 보기로 폴백 */
    logger.warn('[tc/choices] 보기 생성 실패 → 고정 보기 폴백', { uid, classId });
    return { ok: false };
  }
);

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
  /* SEC-01 — membership 입력 검증 (순수 함수, node 단독 테스트용) */
  _isPlainPin,
  _isSafeIdSegment,
  MEMBERSHIP_VERSION,
  /* THOUGHT-COMPASS Phase 1 — AI 후속질문 순수 검증(node 단독 테스트용) */
  TCFollowUp,
};
