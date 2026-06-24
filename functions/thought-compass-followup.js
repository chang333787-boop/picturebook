/* thought-compass-followup.js — 생각 나침반 AI 후속질문 순수 로직(firebase/anthropic 비의존).
   index.js의 callThoughtCompassFollowUp이 입력/출력 검증·fallback·user message를 이 모듈에 위임.
   하니스로 단독 검증(node --test, 실 API 미호출). 정본: docs/thought_compass_prd.md (AI-01~05, RECOVERY-03/04). */
'use strict';

/* AI 결정/이유 코드 — PRD AI-01/AI-02 정본(allowlist). */
const DECISIONS = ['NEXT', 'ASK_FOLLOW_UP', 'ASK_EASIER'];
const REASON_CODES = ['SUFFICIENT', 'TOO_VAGUE', 'MISSING_DETAIL', 'CONTRADICTION', 'STUDENT_STUCK', 'OFF_TOPIC'];
const CORE_QUESTION_KEYS = ['audience', 'purpose', 'protagonist', 'goal', 'obstacle', 'branchChoice', 'protectedCore'];
const PROJECT_TYPES = ['picturebook', 'text'];   /* movie/experience 거부(D-01) */

const MAX_FOLLOWUPS = 5;        /* 세션 후속질문 상한(D-05 연동) */
const MAX_TOTAL = 12;           /* 전체 질문 상한(D-05) */
const MIN_TOTAL = 7;            /* 핵심 7개 */
const MAX_ANSWER_LEN = 200;     /* 핵심 답변 직접입력(D-24) */
const MAX_SUMMARY_LEN = 200;
const MAX_FOLLOWUP_Q_LEN = 40;  /* 후속질문 한 문장(AI-04) */
const MAX_ACK_LEN = 80;
const MAX_SUPPORT = 3;
const MAX_SUMMARIES = 7;

/* D-11 평가어 금지(완벽·최고·정답 류). AI ack에 포함 시 거부. */
const BANNED_ACK_WORDS = ['완벽', '최고', '정답', '훌륭', '대단', '짱', '천재'];
/* 창작/대필 차단 — 출력에 장면 본문·연결·엔딩 등이 있으면 거부(1.2 금지). */
const BANNED_OUTPUT_KEYS = ['body', 'revisedText', 'scene', 'scenes', 'nextId', 'choices', 'buttons', 'ending', 'title', 'sceneText'];
/* 개인식별/비밀 입력 거부 */
const FORBIDDEN_INPUT_KEYS = ['pin', 'PIN', 'uid', 'studentName', 'realName', 'password', 'token', 'sessionToken', 'fullLog', 'rawLog'];

/* 질문 brief — AI 맥락용(생각 나침반 질문 모듈 미의존). 정본 문구는 thought-compass-questions.js. */
const QUESTION_BRIEF = {
  audience:     { label: '예상 독자', sufficientWhen: '특정 사람 또는 비교적 분명한 집단' },
  purpose:      { label: '전하고 싶은 느낌·생각', sufficientWhen: '전하려는 느낌/생각 방향 있음' },
  protagonist:  { label: '주인공', sufficientWhen: '대상 분명 + 특징 1가지' },
  goal:         { label: '주인공의 목표', sufficientWhen: '원하는 행동·결과 대상이 분명' },
  obstacle:     { label: '문제와 어려움', sufficientWhen: '방해 요소 1개 분명' },
  branchChoice: { label: '중요한 갈림길', sufficientWhen: '고민하는 선택 순간 1개 분명' },
  protectedCore:{ label: '꼭 지키고 싶은 중심', sufficientWhen: '지키고 싶은 중심 1개 분명' },
};

function _isSafeSeg(v, maxLen) {
  return typeof v === 'string' && v.length >= 1 && v.length <= maxLen && !/[.#$/[\]]/.test(v);
}
function _hangulRatio(s) {
  const str = String(s || '');
  const hangul = (str.match(/[가-힣]/g) || []).length;
  const text = (str.match(/[가-힣a-zA-Z0-9]/g) || []).length;
  if (text === 0) return 1;
  return hangul / text;
}

/* 입력 검증 — 필드 allowlist·타입·길이·범위·금지필드. 반환 { ok, value? , error? }. */
function validateFollowUpInput(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'INPUT_SHAPE' };
  for (const k of FORBIDDEN_INPUT_KEYS) if (Object.prototype.hasOwnProperty.call(data, k)) return { ok: false, error: 'FORBIDDEN_FIELD:' + k };

  const classId = String(data.classId || '');
  if (!_isSafeSeg(classId, 64)) return { ok: false, error: 'classId' };
  const teamName = String(data.teamName || '');
  if (!_isSafeSeg(teamName, 60)) return { ok: false, error: 'teamName' };

  const projectType = data.projectType;
  if (PROJECT_TYPES.indexOf(projectType) < 0) return { ok: false, error: 'projectType' };   /* movie/experience 거부 */

  const coreQuestionId = data.coreQuestionId;
  if (CORE_QUESTION_KEYS.indexOf(coreQuestionId) < 0) return { ok: false, error: 'coreQuestionId' };

  let currentAnswer = (typeof data.currentAnswer === 'string') ? data.currentAnswer : '';
  currentAnswer = currentAnswer.trim();
  if (currentAnswer.length > MAX_ANSWER_LEN) return { ok: false, error: 'currentAnswer_len' };

  const followUpCount = data.followUpCount;
  if (!Number.isInteger(followUpCount) || followUpCount < 0 || followUpCount > MAX_FOLLOWUPS) return { ok: false, error: 'followUpCount' };
  const totalQuestionCount = data.totalQuestionCount;
  if (!Number.isInteger(totalQuestionCount) || totalQuestionCount < MIN_TOTAL || totalQuestionCount > MAX_TOTAL) return { ok: false, error: 'totalQuestionCount' };

  const priorSummaries = [];
  if (data.priorSummaries != null) {
    if (!Array.isArray(data.priorSummaries) || data.priorSummaries.length > MAX_SUMMARIES) return { ok: false, error: 'priorSummaries' };
    for (const s of data.priorSummaries) {
      if (!s || typeof s !== 'object' || Array.isArray(s)) return { ok: false, error: 'summary_shape' };
      if (CORE_QUESTION_KEYS.indexOf(s.key) < 0) return { ok: false, error: 'summary_key' };
      if (typeof s.text !== 'string' || s.text.length > MAX_SUMMARY_LEN) return { ok: false, error: 'summary_text' };
      priorSummaries.push({ key: s.key, text: s.text.trim() });
    }
  }

  return { ok: true, value: { classId, teamName, projectType, coreQuestionId, currentAnswer, followUpCount, totalQuestionCount, priorSummaries } };
}

/* 상한 도달 시 AI 호출 없이 NEXT 강제(후속 ≤5, 전체 ≤12). */
function shouldForceNext(input) {
  return input.followUpCount >= MAX_FOLLOWUPS || input.totalQuestionCount >= MAX_TOTAL;
}

/* 출력 검증 — decision/reasonCode allowlist, 길이, 평가어/창작키 금지. 반환 { ok, value?, error? }. */
function validateFollowUpResponse(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'shape' };
  for (const k of BANNED_OUTPUT_KEYS) if (Object.prototype.hasOwnProperty.call(parsed, k)) return { ok: false, error: 'banned_key:' + k };

  const decision = parsed.decision;
  if (DECISIONS.indexOf(decision) < 0) return { ok: false, error: 'decision' };
  const reasonCode = parsed.reasonCode;
  if (REASON_CODES.indexOf(reasonCode) < 0) return { ok: false, error: 'reasonCode' };

  let acknowledgement = (typeof parsed.acknowledgement === 'string') ? parsed.acknowledgement.trim() : '';
  if (acknowledgement.length > MAX_ACK_LEN) acknowledgement = acknowledgement.slice(0, MAX_ACK_LEN);
  for (const w of BANNED_ACK_WORDS) if (acknowledgement.indexOf(w) >= 0) return { ok: false, error: 'banned_ack:' + w };

  let followUpQuestion = (typeof parsed.followUpQuestion === 'string') ? parsed.followUpQuestion.trim() : '';
  let supportOptions = Array.isArray(parsed.supportOptions)
    ? parsed.supportOptions.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean).slice(0, MAX_SUPPORT)
    : [];

  if (decision === 'NEXT') {
    followUpQuestion = '';      /* NEXT면 후속질문/보기 비움(AI-03) */
    supportOptions = [];
  } else {
    if (!followUpQuestion) return { ok: false, error: 'followUpQuestion_empty' };
    if (followUpQuestion.length > MAX_FOLLOWUP_Q_LEN) return { ok: false, error: 'followUpQuestion_len' };
    if (_hangulRatio(followUpQuestion) < 0.5) return { ok: false, error: 'followUpQuestion_lang' };
  }
  return { ok: true, value: { decision, reasonCode, acknowledgement, followUpQuestion, supportOptions } };
}

/* AI 실패 fallback(RECOVERY-03/04) — G3(주인공)·G4(목표)는 고정 후속, 그 외는 NEXT 안전 통과.
   무조건 NEXT가 아니라, 구체화가 중요한 두 질문은 정해진 후속으로 학생을 돕는다. */
const FIXED_FOLLOWUPS = {
  protagonist: { decision: 'ASK_FOLLOW_UP', reasonCode: 'MISSING_DETAIL', acknowledgement: '', followUpQuestion: '그 주인공만의 특별한 점은 무엇인가요?', supportOptions: ['특별한 능력이 있어요', '성격이 남달라요', '어려워하는 것이 있어요'] },
  goal:        { decision: 'ASK_FOLLOW_UP', reasonCode: 'MISSING_DETAIL', acknowledgement: '', followUpQuestion: '무엇을 가장 이루고 싶은지 조금 더 말해 줄래요?', supportOptions: ['무언가를 찾고 싶어요', '누군가를 돕고 싶어요', '어딘가에 가고 싶어요'] },
};
function followUpFallback(coreQuestionId) {
  if (FIXED_FOLLOWUPS[coreQuestionId]) return Object.assign({}, FIXED_FOLLOWUPS[coreQuestionId], { fallback: true });
  return { decision: 'NEXT', reasonCode: 'SUFFICIENT', acknowledgement: '', followUpQuestion: '', supportOptions: [], fallback: true };
}

/* AI user message(한국어, PII 없음) — 핵심질문 맥락 + 현재 답 + 직전 요약 + 카운트. */
function buildFollowUpUserMessage(input) {
  const brief = QUESTION_BRIEF[input.coreQuestionId] || { label: input.coreQuestionId, sufficientWhen: '' };
  const lines = [];
  lines.push('작품 유형: ' + (input.projectType === 'text' ? '텍스트' : '그림책'));
  lines.push('핵심 질문: ' + brief.label + ' (' + input.coreQuestionId + ')');
  if (brief.sufficientWhen) lines.push('충분 기준: ' + brief.sufficientWhen);
  lines.push('학생의 현재 답: ' + (input.currentAnswer || '(비어 있음)'));
  if (input.priorSummaries && input.priorSummaries.length) {
    lines.push('지금까지 정한 것:');
    for (const s of input.priorSummaries) {
      const b = QUESTION_BRIEF[s.key] || { label: s.key };
      lines.push('- ' + b.label + ': ' + (s.text || '(비어 있음)'));
    }
  }
  lines.push('이번에 사용한 후속질문 수: ' + input.followUpCount + ' / ' + MAX_FOLLOWUPS);
  lines.push('전체 질문 수: ' + input.totalQuestionCount + ' / ' + MAX_TOTAL);
  lines.push('');
  lines.push('위 답이 충분하면 NEXT, 답할 수 있는데 모호하면 ASK_FOLLOW_UP, 질문 자체를 어려워하면 ASK_EASIER로 판정하세요. JSON만 출력하세요.');
  return lines.join('\n');
}

/* 에뮬레이터 전용 결정 stub(실 API 미호출, 결정적) — Phase N 수동 QA용.
   index.js가 FUNCTIONS_EMULATOR + TC_FOLLOWUP_STUB 환경에서만 사용(운영 코드 경로 아님). */
function stubDecision(input) {
  const a = (input && typeof input.currentAnswer === 'string') ? input.currentAnswer.trim() : '';
  if (a.length === 0) {
    return { decision: 'ASK_EASIER', reasonCode: 'STUDENT_STUCK', acknowledgement: '괜찮아요. 천천히 골라봐요.', followUpQuestion: '둘 중 무엇이 더 가까운가요?', supportOptions: ['이게 더 가까워요', '저게 더 가까워요'] };
  }
  if (a.length < 4) {
    return { decision: 'ASK_FOLLOW_UP', reasonCode: 'TOO_VAGUE', acknowledgement: '좋아요. 조금 더 들려줄래요?', followUpQuestion: '조금 더 자세히 말해 줄래요?', supportOptions: [] };
  }
  return { decision: 'NEXT', reasonCode: 'SUFFICIENT', acknowledgement: '좋아요. 잘 정했어요.', followUpQuestion: '', supportOptions: [] };
}

module.exports = {
  DECISIONS, REASON_CODES, CORE_QUESTION_KEYS, PROJECT_TYPES,
  stubDecision,
  MAX_FOLLOWUPS, MAX_TOTAL, MIN_TOTAL, MAX_ANSWER_LEN, MAX_FOLLOWUP_Q_LEN,
  BANNED_ACK_WORDS, BANNED_OUTPUT_KEYS, FORBIDDEN_INPUT_KEYS, QUESTION_BRIEF,
  validateFollowUpInput, shouldForceNext, validateFollowUpResponse, followUpFallback, buildFollowUpUserMessage,
  _hangulRatio, _isSafeSeg,
};
