/* ════════════════════════════════════════════════════════════════
   IMAGE-S2-8 모델 평가 — 공통 프롬프트 팩 (provider 중립)
   ──────────────────────────────────────────────────────────────
   정본 PRD §2·§6 (원본 보존·새 요소 금지·배경만 가로 연장·한글 보존).
   목적: provider별 전용 문구를 쓰기 전에, 같은 의도를 같은 강도로 비교.
   ★ 제약은 모두 "긍정형"으로 작성한다 — 금지어를 부정문으로 쓰지 않음으로써
     findBannedPhrase 가드(편집/override 프롬프트 검사용)와 충돌하지 않게 한다.
   firebase 비의존 · 순수 · node 단독 테스트 가능.
   ════════════════════════════════════════════════════════════════ */

const PROMPT_PACK_VERSION = 'imgS2-eval-promptpack-v1';

/* 모든 강도 공통 불변 제약 — 학생 그림의 의미·구도·개성 보존(긍정형). */
const SHARED_CONSTRAINTS = [
  'Start from the provided child-drawn picture and improve only its finish, while keeping it clearly the same drawing.',
  'Keep exactly the same characters and objects that are already in the picture — the same count, the same positions, and the same relationships between them.',
  'Keep the hand-drawn, child-like look: the original lines, shapes, and color choices must stay recognizable.',
  'Leave every existing letter, number, and speech bubble exactly as drawn, including any Korean text.',
  'Only already-empty areas and the background may be filled in, and only in a simple, natural way; keep the same time of day and weather.',
  'Produce a horizontal landscape image with a 3:2 ratio (about 1536x1024), with the original drawing fitted and centered, never cropped or shifted.',
  'Keep the original meaning of the picture unchanged.',
];

/* 평가 강도 3단계(P1 약함 / P2 균형 / P3 강함). 학생용 기본 후보=P2 (미확정). */
const LEVELS = {
  P1: { id: 'P1', label: '매우 약한 정돈 (very light cleanup)', clauses: [
    'Tidy the existing lines.',
    'Even out color bleeding gently.',
    'Fill only the most obvious empty spots, minimally.',
  ] },
  P2: { id: 'P2', label: '균형 잡힌 발전 (balanced)', clauses: [
    'Add a gentle background, soft shading, and light texture.',
    'Keep the same characters and composition as drawn.',
  ] },
  P3: { id: 'P3', label: '표현 강화 (expressive)', clauses: [
    'Strengthen mood, lighting, and the sense of space.',
    'Keep the same events and subjects as drawn.',
  ] },
};
const DEFAULT_LEVEL_CANDIDATE = 'P2';   /* 학생 실제 기본값 후보 — 평가 후 확정 */

/* 절대 금지 지시(편집/override 프롬프트에 들어가면 안 되는 affirmative 문구).
   ★ 위 SHARED/LEVELS 는 이 토큰들을 (부정문으로도) 포함하지 않도록 긍정형으로 작성. */
const BANNED_PHRASES = [
  /* 영어 */
  'redraw', 'from scratch', 'photorealistic', 'realistic photo', 'professional illustration',
  'disney', 'ghibli', 'pixar', 'anime style', 'in the style of',
  'change the character', 'different ethnicity', 'change gender',
  'add a new character', 'new dialogue', 'add a caption', 'invent a',
  /* 한국어 */
  '완전히 다시', '다시 그려', '전문 일러스트', '사실화', '디즈니', '지브리', '픽사',
  '인종', '성별 변경', '새 인물', '새로운 대사', '글자 추가', '사건 추가',
];

/* 강도별 최종 프롬프트 빌드. */
function buildPrompt(levelId) {
  const lvl = LEVELS[levelId];
  if (!lvl) return null;
  const text = []
    .concat(SHARED_CONSTRAINTS)
    .concat(['', `Enhancement level (${lvl.id}) — ${lvl.label}:`])
    .concat(lvl.clauses)
    .join('\n');
  return { promptVersion: PROMPT_PACK_VERSION, level: lvl.id, label: lvl.label, text };
}

/* 텍스트에 금지 문구가 있으면 그 문구를, 없으면 null. override/편집 프롬프트 검사용. */
function findBannedPhrase(text) {
  const t = String(text == null ? '' : text).toLowerCase();
  for (const p of BANNED_PHRASES) {
    if (t.indexOf(p.toLowerCase()) !== -1) return p;
  }
  return null;
}

/* 팩 자체 검증 — 모든 강도가 빌드되고, 금지어 0, 핵심 보존/프레임 문구 포함. */
function validatePromptPack() {
  const errors = [];
  for (const id of Object.keys(LEVELS)) {
    const p = buildPrompt(id);
    if (!p) { errors.push(`level ${id}: build 실패`); continue; }
    const banned = findBannedPhrase(p.text);
    if (banned) errors.push(`level ${id}: 금지어 포함 "${banned}"`);
    const low = p.text.toLowerCase();
    if (low.indexOf('keep') === -1) errors.push(`level ${id}: 보존(keep) 문구 누락`);
    if (low.indexOf('3:2') === -1) errors.push(`level ${id}: 가로 3:2 프레임 문구 누락`);
    if (low.indexOf('korean text') === -1) errors.push(`level ${id}: 한글 보존 문구 누락`);
  }
  return { ok: errors.length === 0, errors };
}

function listLevels() { return Object.keys(LEVELS); }

module.exports = {
  PROMPT_PACK_VERSION, SHARED_CONSTRAINTS, LEVELS, DEFAULT_LEVEL_CANDIDATE, BANNED_PHRASES,
  buildPrompt, findBannedPhrase, validatePromptPack, listLevels,
};
