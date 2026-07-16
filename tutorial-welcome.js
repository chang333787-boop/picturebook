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
  /* TUTORIAL-SHOW-POLICY-1(2026-07-08): 기기 1회(seen) → '매 진입 표시 + 다시 열지 않기' 정책.
     원인: 옛 seen 플래그가 기기 단위라 같은 태블릿에서 계정을 새로 만들어도 안 떴음(사용자 보고).
     이제 기본은 매 진입 표시하고, 모달의 '다시 열지 않기' 체크 시에만 dismissed 플래그를 남겨 영구 억제.
     키를 '_seen'→'_dismissed'로 바꿔 기존 seen 플래그(전 기기에 이미 있음)를 무시 → 모두 다시 보게 됨. */
  /* TUTORIAL-SCOPE-1(2026-07-09): dismiss 범위를 기기 → '모둠 계정' 단위로. scope(classId+teamName)를 키에 넣어
     같은 태블릿의 다른 모둠/계정에 '다시 열지 않기'가 새지 않게(사용자 보고: 계정 간 누수). scope 없으면 기존
     기기 단위 키(하위호환·값이 기기ID여도 truthy=dismissed). 값 '1'. localStorage 불가 시 dismissed로 간주(에디터 안 막음). */
  function _scopeSuffix(scope) { return scope ? ('_' + scope) : ''; }
  function _dismissKey(prefix, version, scope) { return (prefix || 'tutorial_welcome') + '_v' + version + _scopeSuffix(scope) + '_dismissed'; }
  function _isDismissed(prefix, version, scope) {
    try { return !!localStorage.getItem(_dismissKey(prefix, version, scope)); } catch (e) { return true; }
  }
  function _markDismissed(prefix, version, scope) {
    try { localStorage.setItem(_dismissKey(prefix, version, scope), '1'); } catch (e) { /* noop */ }
  }

  function _remove() {
    const el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
  }

  /* TUTORIAL-SKIP-SUPPRESS-1(2026-07-16): 환영 종료 직후 1회 실행할 후속(코치) 훅.
     maker(브랜치) 경로의 환영은 review.js(수정 불가)/ui.js에서 bare로 떠서 호출부가 반환값을
     읽기 어렵다 → 여기 '시퀄'로 {shown,dontShow,skipped}를 전달받아 코치 표시/억제를 결정한다.
     armCoach로 1회 등록 → 다음 maybeShow 종료(표시 후 finish/조기 통과 모두)에서 소비 후 즉시 해제(누수 방지).
     미등록이면 아무 동작도 안 함(기존 환영 흐름 무영향). */
  let _pendingSequel = null;
  function armCoach(fn) { _pendingSequel = (typeof fn === 'function') ? fn : null; }
  function _fireSequel(res) {
    const fn = _pendingSequel; _pendingSequel = null;
    if (fn) { try { fn(res); } catch (e) { /* noop */ } }
  }

  /* Promise<boolean> — true=표시함, false=조건 미충족으로 통과.
     opts = { deck: 'welcome'|'refineWelcome'(콘텐츠 배열 키), keyPrefix: seen 네임스페이스 }.
     기본 = 환영 모달(welcome). 다듬기 튜토리얼은 {deck:'refineWelcome', keyPrefix:'tutorial_refine'}. */
  function maybeShow(opts) {
    opts = opts || {};
    const deck = opts.deck || 'welcome';
    const prefix = opts.keyPrefix || 'tutorial_welcome';
    const filterType = opts.filterType || null;   /* 작품 유형(text/picturebook/movie/experience) */
    const scope = opts.scope || null;             /* TUTORIAL-SCOPE-1: 모둠 계정 스코프(없으면 기기) */
    const force = !!opts.force;                    /* ? 재열람 — dismiss 무시하고 강제 표시 */
    const deferDismiss = !!opts.deferDismiss;      /* 시퀀스(환영+코치): 여기선 dismiss 확정 안 함, 호출부가 코치 후 처리 */
    return new Promise((resolve) => {
      const C = _content();
      let slides = (C && Array.isArray(C[deck])) ? C[deck] : [];
      /* 유형 맞춤: slide.types가 있으면 현재 유형이 포함될 때만. types 없으면 전체 노출. */
      if (filterType) slides = slides.filter(s => !s.types || s.types.indexOf(filterType) !== -1);
      const version = (C && C.version) ? C.version : 1;
      if (!slides.length || (!force && _isDismissed(prefix, version, scope))) {
        const _res = { shown: false, dontShow: false, skipped: false };
        resolve(deferDismiss ? _res : false);
        _fireSequel(_res);   /* 환영이 안 떴어도 시퀄은 소비(코치 억제 유지 + arm 해제) */
        return;
      }
      if (typeof document === 'undefined' || !document.body) {
        resolve(false); _fireSequel({ shown: false, dontShow: false, skipped: false }); return;
      }
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

      /* TUTORIAL-SHOW-POLICY-1: 기본은 매 진입 표시. finish 시 '다시 열지 않기'가 체크됐을 때만 억제. */
      let dontShow = false;
      /* TUTORIAL-SKIP-SUPPRESS-1: '넘어가기(건너뛰기)'로 닫혔는지(skipped)를 신호로 추가.
         반환/시퀄에 {shown,dontShow,skipped} 전달 → 호출부(refine·maker)가 skip/dontShow면 코치 억제.
         bare(비-deferDismiss) 즉시 확정은 기존과 동일하게 dontShow만(회귀 0) — skip 확정은 호출부/시퀄이 담당. */
      const finish = (viaSkip) => {
        const skipped = !!viaSkip;
        if (dontShow && !deferDismiss) _markDismissed(prefix, version, scope);
        _remove();
        const _res = { shown: true, dontShow: dontShow, skipped: skipped };
        resolve(deferDismiss ? _res : true);
        _fireSequel(_res);
      };

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
          <div style="font-size:19px;font-weight:800;color:#3a2c14;margin-bottom:8px;word-break:keep-all;">${_esc(s.title)}</div>
          <div style="font-size:14px;color:#6b5638;line-height:1.6;min-height:40px;word-break:keep-all;overflow-wrap:break-word;">${_esc(s.line).replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>')}</div>
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

        /* TUTORIAL-SHOW-POLICY-1: '다시 열지 않기' 체크(선택). 체크 후 시작하기/건너뛰기 시 영구 억제. */
        const dontRow = document.createElement('label');
        dontRow.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:6px;margin-top:12px;font-size:12px;color:#8a7458;cursor:pointer;';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = dontShow;
        cb.style.cssText = 'width:15px;height:15px;accent-color:#c66f4a;cursor:pointer;';
        cb.addEventListener('change', () => { dontShow = cb.checked; });
        dontRow.appendChild(cb);
        dontRow.appendChild(document.createTextNode('다시 열지 않기'));
        card.appendChild(dontRow);

        const skip = document.createElement('button');
        skip.type = 'button'; skip.textContent = '건너뛰기';
        skip.style.cssText = 'margin-top:8px;border:none;background:none;color:#a8946e;font-size:12px;cursor:pointer;';
        skip.addEventListener('click', () => finish(true));   /* 넘어가기 → skipped:true */
        card.appendChild(skip);
      };

      render();
      document.body.appendChild(overlay);
    });
  }

  /* 교사 리셋/디버그용(선택) — '다시 열지 않기'로 억제한 걸 해제해 다시 표시. prefix 미지정=환영. */
  function reset(prefix, scope) {
    const C = _content();
    const version = (C && C.version) ? C.version : 1;
    try { localStorage.removeItem(_dismissKey(prefix || 'tutorial_welcome', version, scope)); } catch (e) { /* noop */ }
  }

  if (typeof window !== 'undefined') {
    window.TutorialWelcome = {
      maybeShow: maybeShow, reset: reset, _isDismissed: _isDismissed,
      /* TUTORIAL-SKIP-SUPPRESS-1: 다음 환영 종료 직후 1회 실행할 후속(코치) 훅 등록(maker 경로용). */
      armCoach: armCoach,
      /* TUTORIAL-SCOPE-1: 시퀀스(환영+코치) 완료 후 호출부가 dismiss를 확정할 때 사용. */
      markDismissed: function (prefix, scope) {
        const C = _content(); const version = (C && C.version) ? C.version : 1;
        _markDismissed(prefix, version, scope);
      },
    };
  }
})();
