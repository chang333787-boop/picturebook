'use strict';
/* ============================================================
   write-after-questions.js — 쓰기 후 "생각 점검 질문" 순수 로직
   ─────────────────────────────────────────────
   WRITE-AFTER Phase 3. firebase 비의존(node 단독·외부패키지 0) → 단위 테스트 가능.
   철학: AI는 작품을 읽고 "질문"만 한다. 문장/사건/대사/결말을 대신 써 주지 않는다.
   학생이 직접 생각하고 고친다. 질문은 장면별 맞춤형.

   - sanitizeSnapshotForQuestions: 클라 snapshot을 AI 전송 전 안전 제한
     (장면 ≤25, body ≤500자, 선택지 ≤100자, imageData/imageUrl/prompt 등 제거).
   - validateQuestionsResponse: AI JSON 응답 검증·정규화(질문 3~6개, 장면 ID 화이트리스트,
     대필 응답 거부). 실패 시 throw.
   ============================================================ */

const MIN_QUESTIONS = 3;
const MAX_QUESTIONS = 6;
const MAX_SCENES = 30;   /* S2-CAP-30(2026-07-20): 25→30 — s2 상한과 정합(초과분은 기존대로 앞에서 절단) */
const MAX_BODY_CHARS = 500;
const MAX_CHOICE_CHARS = 100;
const MAX_TEXT = 200;       /* question/reason/studentAction 표시 상한 */
const MAX_SUMMARY = 300;

/* 사용자 표시용 질문 유형(서버는 관용적으로 받되 화이트리스트로 정규화). */
const ALLOWED_TYPES = [
  '이야기 흐름', '선택지 연결', '인물/물건 이어짐', '엔딩 이해', '독자 이해', '빈 장면/짧은 장면',
];
const DEFAULT_TYPE = '이야기 흐름';

/* AI가 "대신 고쳐 준" 결과를 흘리면 거부할 키(스키마 위반). */
const FORBIDDEN_KEYS = [
  'revisedText', 'revised', 'suggestedBody', 'rewrite', 'rewritten',
  'newBody', 'correctedText', 'fixedText', 'answer', 'suggestion',
];

function _clip(v, max) {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  return (max && t.length > max) ? t.slice(0, max) : t;
}

/* 깊은 객체 어디든 금지 키가 있으면 true(대필 응답 차단). */
function _hasForbiddenKey(obj, depth) {
  if (depth == null) depth = 0;
  if (!obj || typeof obj !== 'object' || depth > 4) return false;
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (FORBIDDEN_KEYS.indexOf(k) >= 0) return true;
    const val = obj[k];
    if (val && typeof val === 'object' && _hasForbiddenKey(val, depth + 1)) return true;
  }
  return false;
}

/* 클라 snapshot → AI 전송용 안전 스냅샷. sceneId만 신뢰, 이미지/내부 필드 제거. */
function sanitizeSnapshotForQuestions(snapshot) {
  const out = {};
  if (!snapshot || typeof snapshot !== 'object') return out;
  const ids = Object.keys(snapshot).slice(0, MAX_SCENES);
  for (const id of ids) {
    const s = snapshot[id] || {};
    const choices = Array.isArray(s.choices)
      ? s.choices.slice(0, 6).map((c) => {
          if (typeof c === 'string') return { label: _clip(c, MAX_CHOICE_CHARS) };
          return {
            label: _clip(c && (c.label || c.text), MAX_CHOICE_CHARS),
            nextId: (c && c.nextId != null) ? String(c.nextId) : null,
          };
        })
      : [];
    out[String(id)] = {
      id: String(s.id != null ? s.id : id),
      title: _clip(s.title, 100),
      body: _clip(s.body, MAX_BODY_CHARS),
      isEnding: !!s.isEnding,
      choices,
      /* 이미지/내부 필드는 의도적으로 제외(imageData/imageUrl/prompt/sourceMode 등 전송 금지). */
    };
  }
  return out;
}

function _normalizeQuestion(q, index, validSceneIdSet) {
  if (!q || typeof q !== 'object') return null;
  const question = _clip(q.question, MAX_TEXT);
  if (!question) return null;                       /* 질문 본문 없으면 폐기 */
  let sceneId = (q.sceneId != null && q.sceneId !== '') ? String(q.sceneId) : '';
  if (validSceneIdSet && sceneId && !validSceneIdSet.has(sceneId)) sceneId = '';  /* 실존 장면만 점프 대상 */
  const type = (ALLOWED_TYPES.indexOf(q.type) >= 0) ? q.type : DEFAULT_TYPE;
  const sceneLabel = _clip(q.sceneLabel, 40) || (sceneId ? ('장면 ' + sceneId) : '');
  return {
    id: _clip(q.id, 20) || ('q' + (index + 1)),
    sceneId: sceneId,
    sceneLabel: sceneLabel,
    type: type,
    question: question,
    reason: _clip(q.reason, MAX_TEXT),
    studentAction: _clip(q.studentAction, MAX_TEXT),
  };
}

/* AI 응답 검증·정규화. 실패 시 throw(Error.code 부여). 성공 시 {summary, questions, version}. */
function validateQuestionsResponse(parsed, opts) {
  opts = opts || {};
  if (!parsed || typeof parsed !== 'object') {
    const e = new Error('생각 점검 질문 응답 형식이 올바르지 않아요.'); e.code = 'WAQ_INVALID_RESPONSE'; throw e;
  }
  if (_hasForbiddenKey(parsed)) {
    const e = new Error('AI가 글을 대신 고치려 해서 거부했어요(질문만 허용).'); e.code = 'WAQ_REWRITE_REJECTED'; throw e;
  }
  if (!Array.isArray(parsed.questions)) {
    const e = new Error('질문 목록이 없어요.'); e.code = 'WAQ_NO_QUESTIONS'; throw e;
  }
  const validSet = opts.validSceneIds ? new Set(opts.validSceneIds.map(String)) : null;
  const seen = new Set();
  const questions = [];
  for (let i = 0; i < parsed.questions.length; i++) {
    const nq = _normalizeQuestion(parsed.questions[i], questions.length, validSet);
    if (!nq) continue;
    const key = nq.sceneId + '|' + nq.question;
    if (seen.has(key)) continue;                    /* 중복 질문 제거 */
    seen.add(key);
    questions.push(nq);
    if (questions.length >= MAX_QUESTIONS) break;    /* 상한 클램프 */
  }
  if (questions.length < MIN_QUESTIONS) {
    const e = new Error('질문이 충분히 만들어지지 않았어요. 다시 시도해 주세요.'); e.code = 'WAQ_TOO_FEW_QUESTIONS'; throw e;
  }
  return {
    summary: _clip(parsed.summary, MAX_SUMMARY),
    questions: questions,
    version: opts.promptVersion || 'waq-v1',
  };
}

const _exported = {
  MIN_QUESTIONS, MAX_QUESTIONS, MAX_SCENES, MAX_BODY_CHARS, MAX_CHOICE_CHARS,
  ALLOWED_TYPES, FORBIDDEN_KEYS,
  sanitizeSnapshotForQuestions, validateQuestionsResponse,
  _hasForbiddenKey, _normalizeQuestion,
};
if (typeof module !== 'undefined' && module.exports) module.exports = _exported;
if (typeof globalThis !== 'undefined') globalThis.writeAfterQuestions = _exported;
