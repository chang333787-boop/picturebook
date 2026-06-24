/* thought-compass-gate.js — 신규 프로젝트 강제 진입 게이트 foundation shell(브라우저).
   ⚠ Phase 0: 라이브 maker 진입에 자동 연결하지 않는다(회귀 0). 활성화는 후속 Phase에서
   _enterMakerAfterPtypeSelected/_enterTeam 직후 단일 훅으로 `ThoughtCompassGate.maybeBlock(ctx)`를
   호출해 수행한다(브라우저 QA 후). 완성형 7문항 UI가 아니라 shell(제목/설명/시작·이어서)만.
   결정·문구는 thought-compass.js(ThoughtCompass.describeGate)가 정본. */
;(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  function _el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* ctx: { classId, teamName, projectType, onboardingVersion, compassState }
     callbacks: { onStart(ctx), onResume(ctx), onDismiss() } — 실제 저장은 호출자(ThoughtCompassStore)가.
     반환: { blocked: boolean }  blocked=true면 호출자는 maker UI를 활성화하지 않아야 함. */
  function maybeBlock(ctx, callbacks) {
    callbacks = callbacks || {};
    const TC = window.ThoughtCompass;
    if (!TC) return { blocked: false };           /* 모듈 미로드 → 차단 안 함(안전) */
    const view = TC.describeGate(ctx);
    if (!view.show) return { blocked: false };    /* movie/기존미시작/완료 → 통과 */

    /* 기존 게이트 오버레이 제거(중복 방지) */
    const prev = document.getElementById('thought-compass-gate');
    if (prev) prev.remove();

    const overlay = _el('div', 'tc-gate-overlay');
    overlay.id = 'thought-compass-gate';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    /* 강제 신규: 배경 클릭/ESC로 닫히지 않음. blockMakerClick=true면 전체 덮음. */
    overlay.style.cssText = 'position:fixed;inset:0;z-index:1300;display:flex;align-items:center;justify-content:center;background:rgba(40,32,20,.55);';

    const card = _el('div', 'tc-gate-card');
    card.style.cssText = 'max-width:420px;width:calc(100% - 32px);background:#fffdf8;border-radius:16px;padding:28px 24px;text-align:center;box-shadow:0 12px 40px rgba(60,40,10,.25);';
    card.appendChild(_el('div', 'tc-gate-title', view.title)).style.cssText = 'font-size:20px;font-weight:800;color:#3a2c14;margin-bottom:8px;';
    card.appendChild(_el('p', 'tc-gate-desc', view.description)).style.cssText = 'font-size:14px;color:#6b5638;margin:0 0 18px;';
    if (view.progressLabel) {
      card.appendChild(_el('p', 'tc-gate-progress', view.progressLabel)).style.cssText = 'font-size:13px;color:#8a7350;margin:0 0 14px;';
    }

    const primary = _el('button', 'tc-gate-primary', view.primaryLabel);
    primary.style.cssText = 'display:inline-block;padding:12px 28px;border:none;border-radius:50px;background:#7aa06a;color:#fff;font-size:16px;font-weight:700;cursor:pointer;';
    primary.addEventListener('click', function () {
      if (view.primaryAction === 'resume') { if (callbacks.onResume) callbacks.onResume(ctx); }
      else { if (callbacks.onStart) callbacks.onStart(ctx); }
    });
    card.appendChild(primary);

    /* optional(기존 시작자)만 "나중에" 허용 */
    if (view.dismissible) {
      const later = _el('button', 'tc-gate-later', '나중에 하기');
      later.style.cssText = 'display:block;margin:14px auto 0;background:none;border:none;color:#8a7350;font-size:13px;cursor:pointer;text-decoration:underline;';
      later.addEventListener('click', function () { overlay.remove(); if (callbacks.onDismiss) callbacks.onDismiss(); });
      card.appendChild(later);
    }

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    return { blocked: true, overlay: overlay };
  }

  function closeGate() {
    const g = document.getElementById('thought-compass-gate');
    if (g) g.remove();
  }

  window.ThoughtCompassGate = { maybeBlock: maybeBlock, closeGate: closeGate };
})();
