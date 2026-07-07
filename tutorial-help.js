/* tutorial-help.js — S1 재열람 도움말 (TUTORIAL-PRD, 품질 업그레이드 2026-07-07).
   window.TutorialHelp.open()/close(). TutorialContent.topics를 한 주제씩 넘겨 보는 페이지 뷰로 렌더:
   큰 삽화(TutorialArt) + 제목 + 예시 문구 + 점 진행 + 이전/다음. 저학년 친화.
   Warm Paper 오버레이(inline·CSS무수정·자체완결). 저장 0·DB 0. ESC/배경/닫기로 닫힘. */
;(function () {
  'use strict';
  const OVERLAY_ID = 'tutorial-help-overlay';

  function _content() { return (typeof window !== 'undefined' && window.TutorialContent) || null; }
  function _art(id) { return (typeof window !== 'undefined' && window.TutorialArt) ? window.TutorialArt.get(id) : ''; }
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  /* 저자 콘텐츠 문구에 한해 <b>만 허용(그 외 태그는 이스케이프). 사용자 입력 아님. */
  function _rich(s) { return _esc(s).replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>'); }

  function close() {
    const el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
    document.removeEventListener('keydown', _onKey);
  }
  function _onKey(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') _go(1);
    else if (e.key === 'ArrowLeft') _go(-1);
  }

  let _idx = 0, _topics = [];
  function _go(d) {
    const n = _idx + d;
    if (n < 0 || n >= _topics.length) return;
    _idx = n; _render();
  }

  function _render() {
    const card = document.getElementById('tutorial-help-card');
    if (!card) return;
    const t = _topics[_idx];
    const art = _art(t.art);
    const dots = _topics.map((_, i) =>
      `<span style="width:7px;height:7px;border-radius:50%;background:${i === _idx ? '#c66f4a' : '#e3d4bd'};display:inline-block;margin:0 3px;"></span>`).join('');
    card.querySelector('.th-body').innerHTML = `
      <div style="background:${'#fbf6ea'};border-radius:12px;padding:6px;margin-bottom:12px;">${art || ''}</div>
      <div style="display:flex;align-items:center;gap:8px;justify-content:center;margin-bottom:6px;">
        <span style="font-size:22px;">${_esc(t.icon)}</span>
        <span style="font-size:18px;font-weight:800;color:#3a2c14;">${_esc(t.title)}</span>
      </div>
      ${(Array.isArray(t.lines) ? t.lines : []).map(l =>
        `<div style="font-size:13.5px;color:#5b4a33;line-height:1.6;text-align:center;">${_rich(l)}</div>`).join('')}
      <div style="text-align:center;margin:14px 0 2px;">${dots}</div>`;
    const prev = card.querySelector('.th-prev'), next = card.querySelector('.th-next');
    if (prev) prev.style.visibility = _idx === 0 ? 'hidden' : 'visible';
    if (next) next.textContent = _idx === _topics.length - 1 ? '처음으로' : '다음';
  }

  function open() {
    const C = _content();
    _topics = (C && Array.isArray(C.topics)) ? C.topics : [];
    if (!_topics.length) {
      try { alert('📌 가지 사용법\n\n클래스 코드·모둠·PIN으로 들어가서 장면을 만들고, 행동 버튼으로 이야기를 이어요. 저장은 자동이에요.'); } catch (e) {}
      return;
    }
    close();
    _idx = 0;

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '가지 사용법 도움말');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100010;display:flex;align-items:center;justify-content:center;background:rgba(40,32,20,.55);padding:16px;';

    const card = document.createElement('div');
    card.id = 'tutorial-help-card';
    card.style.cssText = 'background:#fffdf7;border-radius:18px;max-width:400px;width:100%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 16px 48px rgba(0,0,0,.28);font-family:inherit;overflow:hidden;';
    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px 8px;">
        <div style="font-size:16px;font-weight:800;color:#3a2c14;">❓ 가지 사용법</div>
        <button class="th-close" type="button" aria-label="닫기" style="border:none;background:none;font-size:20px;color:#8a7350;cursor:pointer;padding:2px 6px;">✕</button>
      </div>
      <div class="th-body" style="padding:6px 20px 4px;overflow-y:auto;-webkit-overflow-scrolling:touch;"></div>
      <div style="display:flex;gap:8px;padding:12px 20px 16px;">
        <button class="th-prev" type="button" style="flex:0 0 auto;padding:11px 18px;border:1px solid #d9c39a;border-radius:10px;background:transparent;color:#8a6a30;font-size:14px;cursor:pointer;">이전</button>
        <button class="th-next" type="button" style="flex:1 1 auto;padding:12px;border:none;border-radius:10px;background:#c66f4a;color:#fffaee;font-size:15px;font-weight:700;cursor:pointer;">다음</button>
      </div>`;
    overlay.appendChild(card);
    card.querySelector('.th-close').addEventListener('click', close);
    card.querySelector('.th-prev').addEventListener('click', () => _go(-1));
    card.querySelector('.th-next').addEventListener('click', () => { if (_idx === _topics.length - 1) _idx = 0, _render(); else _go(1); });
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', _onKey);
    _render();
  }

  if (typeof window !== 'undefined') window.TutorialHelp = { open: open, close: close };
})();
