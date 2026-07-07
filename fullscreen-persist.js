/* fullscreen-persist.js — 멀티페이지에서 전체 화면 "유지" 흉내 (2026-07-07).
   브라우저는 페이지 이동 시 Fullscreen을 강제 해제한다(보안 정책·우회 불가). 그래서
   사용자가 ⛶로 켜두면 sessionStorage 플래그(branch_fs)를 기억했다가, 다음 페이지의
   '첫 사용자 제스처(클릭/터치/키)'에서 1회 자동 재진입한다. 완전 무깜빡임은 SPA/PWA만 가능.

   사용법: 전체화면 토글 버튼에 [data-fs-toggle] 속성만 달면 자동 배선(이벤트 위임)+상태 동기화.
   버튼 라벨을 바꾸려면 안쪽에 [data-fs-label] 요소. 미지원 브라우저는 버튼 숨김+무동작.
   전역 window.BranchFullscreen = { toggle, enter, exit, sync, supported }. */
;(function () {
  'use strict';
  var KEY = 'branch_fs';
  var root = document.documentElement;

  function supported() { return !!(root.requestFullscreen || root.webkitRequestFullscreen); }
  function fsEl() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function want() { try { return sessionStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
  function setWant(v) { try { v ? sessionStorage.setItem(KEY, '1') : sessionStorage.removeItem(KEY); } catch (e) { /* noop */ } }
  function req() { var p = (root.requestFullscreen || root.webkitRequestFullscreen).call(root); if (p && p.catch) p.catch(function () {}); }
  function ex() { var p = (document.exitFullscreen || document.webkitExitFullscreen).call(document); if (p && p.catch) p.catch(function () {}); }

  function sync() {
    var on = !!fsEl();
    var btns = document.querySelectorAll('[data-fs-toggle]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      b.classList.toggle('is-on', on);
      b.title = on ? '전체 화면 끄기' : '전체 화면';
      b.setAttribute('aria-label', b.title);
      var lbl = b.querySelector('[data-fs-label]');
      if (lbl) lbl.textContent = on ? '전체 화면 끄기' : '전체 화면';
    }
  }

  if (!supported()) {
    var hide = function () {
      var btns = document.querySelectorAll('[data-fs-toggle]');
      for (var i = 0; i < btns.length; i++) btns[i].style.display = 'none';
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hide);
    else hide();
    window.BranchFullscreen = { toggle: function () {}, enter: function () {}, exit: function () {}, sync: function () {}, supported: false };
    return;
  }

  function enter() { setWant(true); if (!fsEl()) req(); sync(); }
  function exit() { setWant(false); if (fsEl()) ex(); sync(); }
  function toggle() { if (fsEl()) exit(); else enter(); }

  /* 페이지 이탈 감지 — 이동으로 인한 전체화면 해제는 플래그를 지우지 않게(다음 페이지에서 재진입).
     반대로 ESC 등 페이지 살아있는 상태의 해제는 사용자가 끈 것 → 플래그 해제. */
  var _leaving = false;
  window.addEventListener('beforeunload', function () { _leaving = true; });
  window.addEventListener('pagehide', function () { _leaving = true; });

  function onChange() { if (!fsEl() && !_leaving) setWant(false); sync(); }
  document.addEventListener('fullscreenchange', onChange);
  document.addEventListener('webkitfullscreenchange', onChange);

  /* 버튼 클릭 — 이벤트 위임으로 동적 생성 버튼(감상 HUD 등)도 처리. */
  document.addEventListener('click', function (e) {
    var t = (e.target && e.target.closest) ? e.target.closest('[data-fs-toggle]') : null;
    if (t) { e.preventDefault(); toggle(); }
  });

  /* 이동 후 재진입 — 플래그가 켜져 있고 아직 전체화면이 아니면, 사용자 제스처마다 재요청
     (requestFullscreen은 사용자 제스처 필요·자동 실행 불가). 전체화면 진입 성공 시 또는
     플래그 해제 시 리스너 정리. 실패한 시도는 다음 제스처에서 다시 시도. */
  function armReenter() {
    if (!want() || fsEl()) return;
    function cleanup() {
      document.removeEventListener('pointerdown', go, true);
      document.removeEventListener('touchstart', go, true);
      document.removeEventListener('keydown', go, true);
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('webkitfullscreenchange', onFs);
    }
    function go() {
      if (!want()) { cleanup(); return; }
      if (!fsEl()) req();
    }
    function onFs() { if (fsEl()) cleanup(); }
    document.addEventListener('pointerdown', go, true);
    document.addEventListener('touchstart', go, true);
    document.addEventListener('keydown', go, true);
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
  }

  function init() { sync(); armReenter(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.BranchFullscreen = { toggle: toggle, enter: enter, exit: exit, sync: sync, supported: true };
})();
