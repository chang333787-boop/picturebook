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

  /* 순수 게이트 — 생성 대상 여부(자동 생성 시 호출자가 참고). 멱등/empty 재확인은 생성기 내부가 최종 판정. */
  function shouldGenerateStarter(ctx) {
    ctx = ctx || {};
    if (TYPES.indexOf(ctx.projectType) < 0) return false;   /* movie/experience 제외 */
    if (ctx.hasExistingScenes === true) return false;        /* 기존 scenes 있으면 no-op */
    return true;
  }

  /* 완료 후 기본 장면 생성(브라우저) — 기존 멱등 생성기 위임. 실패해도 완료/진입은 막지 않음(호출자). */
  async function afterComplete(ctx) {
    ctx = ctx || {};
    if (TYPES.indexOf(ctx.projectType) < 0) return false;
    if (typeof window === 'undefined' || typeof window.createStarterTemplateForNewProject !== 'function') return false;
    try {
      return await window.createStarterTemplateForNewProject(ctx.projectType);
    } catch (e) {
      return false;
    }
  }

  return { shouldGenerateStarter, afterComplete };
});
