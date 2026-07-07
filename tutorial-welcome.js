/* tutorial-welcome.js — S2 최초 환영 모달 (TUTORIAL-PRD 2026-07-07, Phase B).
   window.TutorialWelcome.maybeShow(): Promise<boolean>. 기기 최초 1회만 슬라이드 환영을 띄우고,
   닫힘까지 기다린 뒤 resolve(호출부가 이어서 나침반 게이트를 열 수 있게 — D-02 순서).
   · "1회" 범위 = 기기 단위(localStorage). 콘텐츠 version 바뀌면 다시 표시.
   · localStorage 불가/콘텐츠 없음/이미 봄 → 즉시 통과(에디터 절대 막지 않음).
   · UI = 도움말/게이트와 동일 Warm Paper 오버레이(inline·자체완결). 저장 0·DB 0. */
;(function () {
  'use strict';
  const OVERLAY_ID = 'tutorial-welcome-overlay';

  function _content() {
    return (typeof window !== 'undefined' && window.TutorialContent) ? window.TutorialContent : null;
  }
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function _deviceId() {
    try { return localStorage.getItem('branch_device_id') || 'nodevice'; } catch (e) { return null; }
  }
  function _seenKey(prefix, version) { return (prefix || 'tutorial_welcome') + '_v' + version + '_seen'; }

  function _isSeen(prefix, version) {
    const dev = _deviceId();
    if (dev === null) return true;   /* localStorage 불가 → 안 띄움(에디터 안 막음) */
    try { const v = localStorage.getItem(_seenKey(prefix, version)); return v === dev || v === '1'; }
    catch (e) { return true; }
  }
  function _markSeen(prefix, version) {
    try { localStorage.setItem(_seenKey(prefix, version), _deviceId() || '1'); } catch (e) { /* noop */ }
  }

  function _remove() {
    const el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
  }

  /* Promise<boolean> — true=표시함, false=조건 미충족으로 통과.
     opts = { deck: 'welcome'|'refineWelcome'(콘텐츠 배열 키), keyPrefix: seen 네임스페이스 }.
     기본 = 환영 모달(welcome). 다듬기 튜토리얼은 {deck:'refineWelcome', keyPrefix:'tutorial_refine'}. */
  function maybeShow(opts) {
    opts = opts || {};
    const deck = opts.deck || 'welcome';
    const prefix = opts.keyPrefix || 'tutorial_welcome';
    const filterType = opts.filterType || null;   /* 작품 유형(text/picturebook/movie/experience) */
    return new Promise((resolve) => {
      const C = _content();
      let slides = (C && Array.isArray(C[deck])) ? C[deck] : [];
      /* 유형 맞춤: slide.types가 있으면 현재 유형이 포함될 때만. types 없으면 전체 노출. */
      if (filterType) slides = slides.filter(s => !s.types || s.types.indexOf(filterType) !== -1);
      const version = (C && C.version) ? C.version : 1;
      if (!slides.length || _isSeen(prefix, version)) { resolve(false); return; }
      if (typeof document === 'undefined' || !document.body) { resolve(false); return; }
      _remove();

      let idx = 0;
      const overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', '가지 환영 안내');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:100005;display:flex;align-items:center;justify-content:center;background:rgba(40,32,20,.55);padding:16px;';

      const card = document.createElement('div');
      card.style.cssText = 'background:#fffdf7;border-radius:18px;max-width:380px;width:100%;padding:26px 22px 18px;box-shadow:0 16px 48px rgba(0,0,0,.28);text-align:center;font-family:inherit;';
      overlay.appendChild(card);

      const finish = () => { _markSeen(prefix, version); _remove(); resolve(true); };

      const _art = (id) => (typeof window !== 'undefined' && window.TutorialArt) ? window.TutorialArt.get(id) : '';
      const render = () => {
        const s = slides[idx];
        const last = idx === slides.length - 1;
        const dots = slides.map((_, i) =>
          `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;margin:0 3px;background:${i === idx ? '#c66f4a' : '#e3d4bd'};"></span>`).join('');
        /* 시각: art 삽화 > demo(인터랙티브) > 이모지 폴백 */
        let visual;
        if (s.demo) visual = '<div id="tw-demo-slot" style="margin-bottom:12px;"></div>';
        else if (s.art && _art(s.art)) visual = `<div style="background:#fbf6ea;border-radius:12px;padding:6px;margin-bottom:12px;">${_art(s.art)}</div>`;
        else visual = `<div style="font-size:44px;line-height:1;margin-bottom:10px;">${_esc(s.icon || '🌿')}</div>`;
        card.innerHTML = `
          ${visual}
          <div style="font-size:19px;font-weight:800;color:#3a2c14;margin-bottom:8px;">${_esc(s.title)}</div>
          <div style="font-size:14px;color:#6b5638;line-height:1.6;min-height:40px;">${_esc(s.line)}</div>
          <div style="margin:14px 0 12px;">${dots}</div>`;
        /* demo 슬라이드면 인터랙티브 미니 데모 마운트 */
        if (s.demo && typeof window !== 'undefined' && window.TutorialDemo && typeof window.TutorialDemo.mount === 'function') {
          try { window.TutorialDemo.mount(card.querySelector('#tw-demo-slot')); } catch (e) { /* noop */ }
        }
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:8px;';
        if (idx > 0) {
          const prev = document.createElement('button');
          prev.type = 'button'; prev.textContent = '이전';
          prev.style.cssText = 'flex:0 0 auto;padding:11px 16px;border:1px solid #d9c39a;border-radius:10px;background:transparent;color:#8a6a30;font-size:14px;cursor:pointer;';
          prev.addEventListener('click', () => { idx--; render(); });
          btnRow.appendChild(prev);
        }
        const primary = document.createElement('button');
        primary.type = 'button'; primary.textContent = last ? '시작하기' : '다음';
        primary.style.cssText = 'flex:1 1 auto;padding:12px;border:none;border-radius:10px;background:#c66f4a;color:#fffaee;font-size:15px;font-weight:700;cursor:pointer;';
        primary.addEventListener('click', () => { if (last) finish(); else { idx++; render(); } });
        btnRow.appendChild(primary);
        card.appendChild(btnRow);

        const skip = document.createElement('button');
        skip.type = 'button'; skip.textContent = '건너뛰기';
        skip.style.cssText = 'margin-top:10px;border:none;background:none;color:#a8946e;font-size:12px;cursor:pointer;';
        skip.addEventListener('click', finish);
        card.appendChild(skip);
      };

      render();
      document.body.appendChild(overlay);
    });
  }

  /* 교사 리셋/디버그용(선택) — 콘솔에서 호출 시 다음 진입에 다시 표시. prefix 미지정=환영. */
  function reset(prefix) {
    const C = _content();
    const version = (C && C.version) ? C.version : 1;
    try { localStorage.removeItem(_seenKey(prefix || 'tutorial_welcome', version)); } catch (e) { /* noop */ }
  }

  if (typeof window !== 'undefined') {
    window.TutorialWelcome = { maybeShow: maybeShow, reset: reset, _isSeen: _isSeen };
  }
})();
