/* tutorial-help.js — S1 재열람 도움말 모달 (TUTORIAL-PRD 2026-07-07, Phase A).
   window.TutorialHelp.open()/close(). TutorialContent.topics를 주제 목록으로 렌더.
   나침반 게이트(thought-compass-gate.js)의 오버레이 카드 패턴을 inline style로 복제 — CSS 파일 무수정·자체완결.
   저장 0·DB 0·기존 화면 영향 0(오버레이만). ESC/배경클릭/닫기로 닫힘. */
;(function () {
  'use strict';
  const OVERLAY_ID = 'tutorial-help-overlay';

  function _content() {
    return (typeof window !== 'undefined' && window.TutorialContent) ? window.TutorialContent : null;
  }
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function close() {
    const el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
    document.removeEventListener('keydown', _onKey);
  }
  function _onKey(e) { if (e.key === 'Escape') close(); }

  function open() {
    const C = _content();
    const topics = (C && Array.isArray(C.topics)) ? C.topics : [];
    /* 콘텐츠 미로드 시 최소 폴백(기존 showHelp 텍스트 수준) */
    if (!topics.length) {
      try { alert('📌 가지 사용법\n\n클래스 코드·모둠·PIN으로 들어가서 장면을 만들고, 행동 버튼으로 이야기를 이어요. 저장은 자동이에요.'); } catch (e) {}
      return;
    }
    close();  /* 중복 방지 */

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '가지 사용법 도움말');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100010;display:flex;align-items:center;justify-content:center;background:rgba(40,32,20,.55);padding:16px;';

    const card = document.createElement('div');
    card.style.cssText = 'background:#fffdf7;border-radius:16px;max-width:460px;width:100%;max-height:86vh;display:flex;flex-direction:column;box-shadow:0 16px 48px rgba(0,0,0,.28);font-family:inherit;overflow:hidden;';

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:18px 20px 12px;border-bottom:1px solid #f0e4d1;';
    head.innerHTML = '<div style="font-size:19px;font-weight:800;color:#3a2c14;">❓ 가지 사용법</div>';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', '닫기');
    closeBtn.style.cssText = 'border:none;background:none;font-size:20px;color:#8a7350;cursor:pointer;padding:2px 6px;border-radius:8px;';
    closeBtn.addEventListener('click', close);
    head.appendChild(closeBtn);

    const body = document.createElement('div');
    body.style.cssText = 'padding:10px 20px 8px;overflow-y:auto;-webkit-overflow-scrolling:touch;';
    body.innerHTML = topics.map(t => `
      <div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid #f6efe0;">
        <div style="font-size:26px;line-height:1.1;flex:0 0 auto;width:34px;text-align:center;">${_esc(t.icon)}</div>
        <div style="flex:1 1 auto;">
          <div style="font-size:15px;font-weight:700;color:#2b1f10;margin-bottom:3px;">${_esc(t.title)}</div>
          ${(Array.isArray(t.lines) ? t.lines : []).map(l =>
            `<div style="font-size:13px;color:#6b5638;line-height:1.5;">${_esc(l)}</div>`).join('')}
        </div>
      </div>`).join('');

    const foot = document.createElement('div');
    foot.style.cssText = 'padding:12px 20px 16px;';
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.textContent = '알겠어요';
    okBtn.style.cssText = 'width:100%;padding:12px;border:none;border-radius:10px;background:#c66f4a;color:#fffaee;font-size:15px;font-weight:700;cursor:pointer;';
    okBtn.addEventListener('click', close);
    foot.appendChild(okBtn);

    card.appendChild(head);
    card.appendChild(body);
    card.appendChild(foot);
    overlay.appendChild(card);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', _onKey);
  }

  if (typeof window !== 'undefined') {
    window.TutorialHelp = { open: open, close: close };
  }
})();
