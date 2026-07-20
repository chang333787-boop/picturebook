/* thought-compass-scenes.js — 생각 나침반 완료 후 기본 장면 생성(Phase J).
   ★ 새 schema를 만들지 않고 기존 BASE10 생성기(window.createStarterTemplateForNewProject →
     _writeBase10IfEmpty → _mtbBuildBase10Scenes)를 재사용한다(구조 일치 보장):
     표지(1) + 일반 8개(2~9, 직선 n→n+1, 행동버튼 1) + 엔딩(10, 버튼 0), 빈 본문 틀.
   생성 조건/멱등은 기존 생성기가 보장: text/picturebook만·scenes 비어있을 때만·starterTemplateInitialized 가드.
   순수 게이트 shouldGenerateStarter는 하니스로 검증(Node). 생성 자체(afterComplete)는 브라우저 전용. */
;(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ThoughtCompassComplete = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const TYPES = ['picturebook', 'text'];
  /* COMPASS-LENGTH-BASE: 허용 이야기 장면 수(표지·엔딩 제외) — v2 targetLength 보기와 1:1. */
  const STORY_COUNTS = [8, 12, 15];
  const TARGETLEN_CHOICE_MAP = { targetlen_8: 8, targetlen_12: 12, targetlen_15: 15 };

  /* 순수 게이트 — 생성 대상 여부(자동 생성 시 호출자가 참고). 멱등/empty 재확인은 생성기 내부가 최종 판정. */
  function shouldGenerateStarter(ctx) {
    ctx = ctx || {};
    if (TYPES.indexOf(ctx.projectType) < 0) return false;   /* movie/experience 제외 */
    if (ctx.hasExistingScenes === true) return false;        /* 기존 scenes 있으면 no-op */
    return true;
  }

  /* COMPASS-LENGTH-BASE: answers.targetLength → 이야기 장면 수(순수).
     · choiceId(targetlen_8/12/15) 우선, 없으면 답 텍스트의 "약 N장면" 파싱.
     · 유예("만들면서 정할래요")/v1(targetLength 없음)/이상값 → 8 = 기존 BASE10과 동일.
       (설계문서 "모르겠어요=12 가정" 대신 기존 기본 틀 유지가 최소 놀람 — 안전 fallback 결정.) */
  function resolveStoryCount(answers) {
    const a = (answers && typeof answers === 'object') ? answers.targetLength : null;
    if (!a || typeof a !== 'object') return 8;
    if (a.deferred === true) return 8;
    if (typeof a.choiceId === 'string' && TARGETLEN_CHOICE_MAP[a.choiceId]) return TARGETLEN_CHOICE_MAP[a.choiceId];
    if (typeof a.answerText === 'string') {
      const m = a.answerText.match(/약\s*(\d+)\s*장면/);
      if (m && STORY_COUNTS.indexOf(parseInt(m[1], 10)) >= 0) return parseInt(m[1], 10);
    }
    return 8;
  }

  /* 완료 후 기본 장면 생성(브라우저) — 기존 멱등 생성기 위임. 실패해도 완료/진입은 막지 않음(호출자).
     COMPASS-LENGTH-BASE: ctx.answers(v2 targetLength)로 장면 수 결정 — v1/미지정=8(기존 동일).
     PICTUREBOOK-LEVELS ③: 그림책 1·2단계는 먼저 AI 이야기 초안(requestStoryDraftStarter)을
     시도 — 성공 시 초안이 얹힌 BASE10이 기록됨. 어떤 실패(미배포·권한·총량·거절)든
     아래 기본 틀 폴백으로 이어져 기존 동작과 동일(fail-open·회귀 0). */
  async function afterComplete(ctx) {
    ctx = ctx || {};
    if (TYPES.indexOf(ctx.projectType) < 0) return false;
    if (typeof window === 'undefined' || typeof window.createStarterTemplateForNewProject !== 'function') return false;
    const lvl = (ctx.projectType === 'picturebook' && typeof window.getPicturebookLevel === 'function')
      ? window.getPicturebookLevel() : null;
    /* EASY-MUSTINC(2026-07-20 사용자 결정): 1단계=12장면 — AI가 전부 만들어 주니 기승전결이
       살게 길이 확대(표지+12+엔딩=14노드·그림 13장·총량 24 내). 서버/빌더는 12를 이미 지원
       (COMPASS-LENGTH-BASE 8/12/15). 2단계(8)·기타 경로는 기존 그대로. 초안 실패 폴백
       기본 틀도 12 — 총량 소진 후 재시도 흐름과 골격 일치. */
    const storyCount = (lvl === 1) ? 12 : resolveStoryCount(ctx.answers);
    try {
      if ((lvl === 1 || lvl === 2) && typeof window.requestStoryDraftStarter === 'function') {
        const applied = await window.requestStoryDraftStarter({
          classId: ctx.classId, teamName: ctx.teamName,
          storyCount: storyCount, answers: ctx.answers,
        });
        if (applied) return true;
      }
    } catch (e) { /* 초안 실패 → 기본 틀 폴백 */ }
    try {
      return await window.createStarterTemplateForNewProject(ctx.projectType, { storyCount: storyCount });
    } catch (e) {
      return false;
    }
  }

  return { shouldGenerateStarter, afterComplete, resolveStoryCount, STORY_COUNTS };
});
