/* ════════════════════════════════════════════════════════════════
   app-dialog.js — APP-DIALOG-1(2026-09-06): 브라우저 기본 창(alert/confirm/prompt) → 가지 디자인 창.
   ──────────────────────────────────────────────────────────────
   · 왜: 심사위원·아이가 보는 화면에 크롬의 회색 기본 팝업(window.confirm 등)이 섞여 "다른 앱 같다".
     (사용자 지적 2026-09-06: 유형 선택 확인창부터 전반 점검)
   · 무엇: appAlert / appConfirm / appPrompt 3종(같은 카드 스타일·바깥 클릭 무시·ESC=취소).
     window.alert는 전역으로 appAlert로 바꾼다(호출부 무수정·비차단). confirm/prompt는 동기 반환이라
     전역 치환이 불가 → 호출부를 await appConfirm/appPrompt 로 바꾼다(학생·심사위원 화면 우선).
   · 이 파일은 maker.html·viewer.html 모두에서 다른 스크립트보다 먼저 로드된다. DOM 준비 전 호출은 큐에 담는다.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const Z = 100066;   /* maker showMakerConfirm과 동일 — 나침반·환영·대기화면 위 */
  let styleDone = false;
  function ensureStyle() {
    if (styleDone || !document.head) return;
    styleDone = true;
    const st = document.createElement('style');
    st.id = 'app-dialog-style';
    st.textContent =
      '.appdlg-backdrop{position:fixed;inset:0;background:rgba(43,31,16,0.42);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);z-index:' + Z + ';display:flex;align-items:center;justify-content:center;padding:20px;}'
      + '.appdlg-card{background:#fffaee;border-radius:18px;width:100%;max-width:420px;padding:24px 24px 20px;box-shadow:0 18px 50px rgba(43,31,16,0.28);font-family:\'Nanum Gothic\',sans-serif;color:#2b1f10;text-align:center;}'
      + '.appdlg-title{font-family:\'Jua\',\'Nanum Gothic\',sans-serif;font-size:18px;font-weight:800;color:#c66f4a;margin-bottom:10px;line-height:1.35;word-break:keep-all;}'
      + '.appdlg-msg{font-size:14.5px;line-height:1.65;color:#4a3a26;word-break:keep-all;white-space:pre-line;text-align:left;}'
      + '.appdlg-msg.is-center{text-align:center;}'
      + '.appdlg-input{display:block;width:100%;box-sizing:border-box;margin-top:14px;padding:11px 12px;border:1.5px solid #d8c7a6;border-radius:12px;font-size:15px;font-family:inherit;background:#fff;}'
      + '.appdlg-actions{margin-top:20px;display:flex;gap:10px;justify-content:center;}'
      + '.appdlg-btn{min-width:110px;padding:11px 20px;border:none;border-radius:12px;font-family:\'Jua\',\'Nanum Gothic\',sans-serif;font-size:15px;font-weight:700;cursor:pointer;transition:background .15s ease;}'
      + '.appdlg-cancel{background:#efe6d4;color:#6b5638;}.appdlg-cancel:hover{background:#e5d9c2;}'
      + '.appdlg-ok{background:#c66f4a;color:#fffaee;}.appdlg-ok:hover{background:#b25f3c;}'
      + '.appdlg-ok.is-danger{background:#d2503c;}.appdlg-ok.is-danger:hover{background:#bd4231;}'
      + '@media(max-width:480px){.appdlg-card{max-width:340px;padding:20px 18px 16px;}.appdlg-actions{flex-direction:column-reverse;gap:8px;}.appdlg-btn{width:100%;}}';
    document.head.appendChild(st);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  /* 한 번에 하나씩 — 겹치면 순서대로 */
  const queue = [];
  let active = false;
  function next() {
    if (active || !queue.length) return;
    if (!document.body) { setTimeout(next, 50); return; }
    active = true;
    const job = queue.shift();
    ensureStyle();
    const root = document.createElement('div');
    root.className = 'appdlg-backdrop';
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
    const o = job.opts;
    root.innerHTML =
      '<div class="appdlg-card">'
      + (o.title ? '<div class="appdlg-title">' + esc(o.title) + '</div>' : '')
      + (o.message ? '<div class="appdlg-msg' + (o.center ? ' is-center' : '') + '">' + esc(o.message) + '</div>' : '')
      + (job.kind === 'prompt' ? '<input class="appdlg-input" type="text" value="' + esc(o.value || '') + '" placeholder="' + esc(o.placeholder || '') + '">' : '')
      + '<div class="appdlg-actions">'
      + (job.kind !== 'alert' ? '<button type="button" class="appdlg-btn appdlg-cancel">' + esc(o.cancelText || '취소') + '</button>' : '')
      + '<button type="button" class="appdlg-btn appdlg-ok' + (o.danger ? ' is-danger' : '') + '">' + esc(o.confirmText || '확인') + '</button>'
      + '</div></div>';
    document.body.appendChild(root);
    let done = false;
    const finish = (val) => {
      if (done) return; done = true;
      document.removeEventListener('keydown', onKey);
      root.remove(); active = false;
      try { job.resolve(val); } catch (e) { /* noop */ }
      next();
    };
    const okBtn = root.querySelector('.appdlg-ok');
    const cancelBtn = root.querySelector('.appdlg-cancel');
    const input = root.querySelector('.appdlg-input');
    const okValue = () => (job.kind === 'prompt' ? (input ? input.value : '') : true);
    const cancelValue = () => (job.kind === 'prompt' ? null : (job.kind === 'alert' ? undefined : false));
    okBtn.addEventListener('click', () => finish(okValue()));
    if (cancelBtn) cancelBtn.addEventListener('click', () => finish(cancelValue()));
    function onKey(e) {
      if (e.key === 'Escape' && !o.forceChoice) finish(cancelValue());
      else if (e.key === 'Enter' && (job.kind === 'alert' || job.kind === 'prompt')) { e.preventDefault(); finish(okValue()); }
    }
    document.addEventListener('keydown', onKey);
    /* 바깥 클릭은 닫지 않는다(FORCE-CHOICE 원칙) */
    try { (input || (job.kind === 'alert' ? okBtn : (cancelBtn || okBtn))).focus(); if (input) input.select(); } catch (e) { /* noop */ }
  }
  function open(kind, opts) {
    return new Promise((resolve) => { queue.push({ kind, opts: opts || {}, resolve }); next(); });
  }
  /* 문자열 하나로도 부를 수 있게(alert 대체) */
  function norm(a, extra) {
    if (a && typeof a === 'object') return Object.assign({}, a, extra || {});
    return Object.assign({ message: String(a == null ? '' : a) }, extra || {});
  }
  const appAlert = (a) => open('alert', norm(a, { center: true }));
  const appConfirm = (a) => open('confirm', norm(a));
  const appPrompt = (a, value) => open('prompt', norm(a, value != null ? { value } : {}));

  window.appAlert = appAlert;
  window.appConfirm = appConfirm;
  window.appPrompt = appPrompt;
  /* 전역 alert 치환 — 비차단. 원래 alert는 window.__nativeAlert에 보관. */
  if (!window.__nativeAlert) {
    window.__nativeAlert = window.alert;
    window.alert = function (msg) { appAlert(msg); };
  }
})();
