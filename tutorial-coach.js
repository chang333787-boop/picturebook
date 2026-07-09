/* tutorial-coach.js — 화면의 실제 버튼을 콕 집어주는 코치마크 (TUTORIAL 친절 안내 2026-07-07).
   window.TutorialCoach.run(opts): 스텝마다 target(CSS 선택자)에 스포트라이트(주변 어둡게 + 코랄 링) +
   말풍선 안내 + [다음]/[알겠어요]/[그만 보기]. 대상 없으면 그 스텝 건너뜀. 기기당 1회.
   저장 0·DB 0. 대상 클릭은 catcher가 흡수(실수 실행 방지) — 오직 [다음]으로 진행.
   opts = { stepsKey: 'refineCoach', keyPrefix, filterType }. */
;(function () {
  'use strict';
  const ROOT_ID = 'tutorial-coach-root';

  function _content() { return (typeof window !== 'undefined' && window.TutorialContent) || null; }
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  /* 저자 콘텐츠 한정 <b>만 허용(사용자 입력 아님). */
  function _rich(s) { return _esc(s).replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>'); }
  function _deviceId() { try { return localStorage.getItem('branch_device_id') || 'nodevice'; } catch (e) { return null; } }
  /* TUTORIAL-SHOW-POLICY-1(2026-07-08): 코치도 기기1회(seen) → '매 진입 표시'로. 억제 여부는
     환영 모달의 '다시 열지 않기'(dismiss)에 종속 — 코치 자체 dismiss는 안 만들고 환영 dismiss 키를 읽는다.
     그래서 옛 '_seen' 대신 '_dismissed' 키를 확인(옛 seen 무시 → 모두 다시 보게 됨). */
  /* TUTORIAL-SCOPE-1(2026-07-09): 코치 dismiss도 환영과 동일 '모둠 계정' 스코프 키(scope=classId+teamName).
     scope 없으면 기기 단위(하위호환·기존 값도 truthy=dismissed). */
  function _dismissKey(prefix, version, scope) { return (prefix || 'tutorial_welcome') + '_v' + version + (scope ? '_' + scope : '') + '_dismissed'; }
  function _isDismissed(prefix, version, scope) {
    try { return !!localStorage.getItem(_dismissKey(prefix, version, scope)); } catch (e) { return true; }
  }

  let _steps = [], _i = 0, _root = null, _reposition = null, _onResolve = null, _prefix = '', _version = 1;

  function _cleanup(shown) {
    if (_reposition) { window.removeEventListener('resize', _reposition); window.removeEventListener('scroll', _reposition, true); _reposition = null; }
    const el = document.getElementById(ROOT_ID); if (el) el.remove();
    _root = null; _steps = [];
    /* TUTORIAL-SHOW-POLICY-1: 코치는 자체 dismiss를 남기지 않음(매 진입 표시·환영 dismiss에만 종속). */
    if (typeof _onResolve === 'function') { const r = _onResolve; _onResolve = null; r(!!shown); }
  }

  function _end() { _cleanup(true); }

  function _findEl(sel) { try { return document.querySelector(sel); } catch (e) { return null; } }

  function _render() {
    /* 현재 스텝의 대상이 없으면 다음으로 스킵(모두 없으면 종료) */
    while (_i < _steps.length && !_findEl(_steps[_i].sel)) _i++;
    if (_i >= _steps.length) { _end(); return; }
    const step = _steps[_i];
    const target = _findEl(step.sel);
    const rect = target.getBoundingClientRect();
    const last = (() => { for (let k = _i + 1; k < _steps.length; k++) if (_findEl(_steps[k].sel)) return false; return true; })();

    const spot = _root.querySelector('.tc-spot');
    const call = _root.querySelector('.tc-call');
    const pad = 6;
    spot.style.left = (rect.left - pad) + 'px';
    spot.style.top = (rect.top - pad) + 'px';
    spot.style.width = (rect.width + pad * 2) + 'px';
    spot.style.height = (rect.height + pad * 2) + 'px';

    call.querySelector('.tc-text').innerHTML = _rich(step.text);
    call.querySelector('.tc-next').textContent = last ? '알겠어요' : '다음';
    call.querySelector('.tc-step').textContent = (_i + 1) + ' / ' + _steps.length;

    /* 말풍선 위치 — 대상 아래 우선, 공간 없으면 위. 가로 중앙 정렬 후 화면 안으로 clamp. */
    call.style.visibility = 'hidden';
    call.style.left = '0px'; call.style.top = '0px';
    const cw = Math.min(280, window.innerWidth - 24);
    call.style.width = cw + 'px';
    const ch = call.offsetHeight || 120;
    let top = rect.bottom + 14;
    let arrow = 'up';
    if (top + ch > window.innerHeight - 12) { top = rect.top - ch - 14; arrow = 'down'; }
    if (top < 12) { top = 12; arrow = 'none'; }
    let left = rect.left + rect.width / 2 - cw / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - cw - 12));
    call.style.left = left + 'px';
    call.style.top = top + 'px';
    const ptr = call.querySelector('.tc-ptr');
    if (arrow === 'none') { ptr.style.display = 'none'; }
    else {
      ptr.style.display = 'block';
      const px = Math.max(14, Math.min(rect.left + rect.width / 2 - left, cw - 14));
      ptr.style.left = px + 'px';
      ptr.style.top = (arrow === 'up') ? '-8px' : (ch - 1) + 'px';
      ptr.style.transform = (arrow === 'up') ? 'rotate(180deg)' : 'none';
    }
    call.style.visibility = 'visible';
  }

  function _next() { _i++; _render(); }

  /* opts.stepsKey(콘텐츠 배열)·keyPrefix·filterType. Promise<boolean>. */
  function run(opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const C = _content();
      const key = opts.stepsKey || 'refineCoach';
      let steps = (C && Array.isArray(C[key])) ? C[key] : [];
      if (opts.filterType) steps = steps.filter(s => !s.types || s.types.indexOf(opts.filterType) !== -1);
      _prefix = opts.keyPrefix || 'tutorial_coach';
      _version = (C && C.version) ? C.version : 1;
      /* 매 진입 표시. 단 환영 모달을 '다시 열지 않기'로 끈 경우 코치도 억제(단일 제어).
         dismissKeyPrefix = 짝 환영 덱의 prefix(예 refine 코치 → 'tutorial_refine'). */
      const _dismissPrefix = opts.dismissKeyPrefix || _prefix;
      const _scope = opts.scope || null;   /* TUTORIAL-SCOPE-1: 모둠 계정 스코프 */
      const _force = !!opts.force;          /* ? 재열람 — dismiss 무시 */
      if (!steps.length || (!_force && _isDismissed(_dismissPrefix, _version, _scope)) || typeof document === 'undefined' || !document.body) { resolve(false); return; }
      /* 대상이 하나라도 실재해야 시작(편집 UI 준비 안 됐으면 스킵) */
      if (!steps.some(s => _findEl(s.sel))) { resolve(false); return; }

      _steps = steps; _i = 0; _onResolve = resolve;
      const root = document.createElement('div');
      root.id = ROOT_ID;
      root.setAttribute('role', 'dialog');
      root.style.cssText = 'position:fixed;inset:0;z-index:100020;';
      root.innerHTML = `
        <div class="tc-catch" style="position:fixed;inset:0;background:transparent;"></div>
        <div class="tc-spot" style="position:fixed;border:3px solid #f0a07e;border-radius:12px;box-shadow:0 0 0 9999px rgba(20,14,8,.5);pointer-events:none;transition:all .2s ease;"></div>
        <div class="tc-call" style="position:fixed;background:#fffdf7;border-radius:14px;box-shadow:0 12px 36px rgba(0,0,0,.3);padding:14px 16px 12px;font-family:inherit;">
          <div class="tc-ptr" style="position:absolute;width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:9px solid #fffdf7;"></div>
          <div class="tc-text" style="font-size:14px;color:#3a2c14;line-height:1.55;"></div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;">
            <button class="tc-skip" type="button" style="border:none;background:none;color:#a8946e;font-size:12px;cursor:pointer;">그만 보기</button>
            <div style="display:flex;align-items:center;gap:10px;">
              <span class="tc-step" style="font-size:11px;color:#a8946e;"></span>
              <button class="tc-next" type="button" style="border:none;border-radius:9px;background:#c66f4a;color:#fffaee;font-size:14px;font-weight:700;padding:9px 18px;cursor:pointer;">다음</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(root);
      _root = root;
      root.querySelector('.tc-catch').addEventListener('click', _next);   /* 배경 탭도 진행(대상 실행 흡수) */
      root.querySelector('.tc-next').addEventListener('click', _next);
      root.querySelector('.tc-skip').addEventListener('click', _end);
      _reposition = () => { if (document.getElementById(ROOT_ID)) _render(); };
      window.addEventListener('resize', _reposition);
      window.addEventListener('scroll', _reposition, true);
      _render();
    });
  }

  function reset(prefix, scope) {
    const C = _content(); const version = (C && C.version) ? C.version : 1;
    try { localStorage.removeItem(_dismissKey(prefix || 'tutorial_welcome', version, scope)); } catch (e) { /* noop */ }
  }

  if (typeof window !== 'undefined') window.TutorialCoach = { run: run, reset: reset };
})();
