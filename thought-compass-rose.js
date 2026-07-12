/* thought-compass-rose.js — 나침반형 이야기 설계도 보기/인쇄(COMPASS-ROSE-1, 브라우저 전용).
   · v2 결과보기(read-only) 전용 선택 보기 — 카드형(SHEET-1)은 기본 유지, 모바일은 카드형만.
   · 데이터 = ThoughtCompassSheet.buildStoryMapV2 파생값 그대로(DB 저장 구조 무변경·AI 0).
   · 인쇄 = 기존 print gate 패턴 재사용: body.tc-print-rose를 인쇄 동안만 부여(afterprint 제거)
     → 버튼 미경유 인쇄/일반 화면 영향 0. A4 1페이지 목표(종이 폭 690px = 기본 여백 내 무스케일).
   · 시안 정본: mockups/compass-rose-v1.html / docs/compass_rose_mockup_1_20260702.md */
;(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const VIEW_ID = 'tc-rose-view';

  function _el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function _remove() { const o = document.getElementById(VIEW_ID); if (o && o.parentNode) o.parentNode.removeChild(o); }

  function _fieldText(map, key) {
    for (const f of map.fields) if (f.key === key) return { text: f.text || '', deferred: !!f.deferred };
    return { text: '', deferred: false };
  }
  function _valueEl(cls, map, key) {
    const f = _fieldText(map, key);
    const el = _el('div', cls + (f.deferred || !f.text ? ' is-deferred' : ''), f.text || '만들면서 정하기');
    return el;
  }

  /* 나침반 카드(라벨+값) */
  function _roseCard(dirCls, icon, label, map, key) {
    const c = _el('div', 'tc-rose-card ' + dirCls);
    c.appendChild(_el('div', 'tc-rose-card-label', icon + ' ' + label));
    c.appendChild(_valueEl('tc-rose-card-value', map, key));
    return c;
  }
  /* 시간띠 정거장 */
  function _stop(icon, label, map, key, final) {
    const s = _el('div', 'tc-rose-stop' + (final ? ' is-final' : ''));
    s.appendChild(_el('div', 'tc-rose-dot', icon));
    s.appendChild(_el('div', 'tc-rose-stop-label', label));
    s.appendChild(_valueEl('tc-rose-stop-text', map, key));
    return s;
  }

  /* opts: { map(storyMapV2 필수), memo?(자유메모 텍스트), fromAdmin?(관리모드 진입 — 인쇄 직행),
     onClose?(✕ 닫기 시 호출 — 결과보기 rose-기본 흐름에서 화면 전체를 한 번에 닫기 위함),
     onSheetView?(있으면 [📄 줄글로 보기] 버튼 노출 — rose만 닫고 호출·onClose 미호출) } */
  function open(opts) {
    opts = opts || {};
    const map = opts.map;
    if (!map || !Array.isArray(map.fields)) return false;
    _remove();

    const overlay = _el('div', 'tc-rose-overlay');
    overlay.id = VIEW_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '나침반형 이야기 설계도');

    /* 화면 전용 툴바(인쇄 제외)
       TEACHER-PRINT-ROUTE-1: 학생 태블릿엔 프린터가 없어 기본은 "선생님께 부탁" 안내
       (review의 안내 모달 재사용 불가한 독립 모듈 — 동일 문구 헬퍼). 관리모드는 직행. */
    const _fromAdmin = !!opts.fromAdmin;
    const bar = _el('div', 'tc-rose-toolbar');
    const printBtn = _el('button', 'tc-rose-print',
      _fromAdmin ? '🖨 A4로 인쇄하기' : '🖨 선생님께 인쇄 부탁하기');
    printBtn.type = 'button';
    printBtn.addEventListener('click', function () {
      if (_fromAdmin) { _print(); return; }
      _showTeacherPrintNotice(_print);
    });
    const closeBtn = _el('button', 'tc-rose-close', '✕ 닫기');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', function () {
      close();
      /* ROSE-FIRST(2026-07-12): 결과보기에서 rose가 기본 화면 — 닫기 한 번에 화면 전체 복귀 */
      if (typeof opts.onClose === 'function') { try { opts.onClose(); } catch (e) {} }
    });
    bar.appendChild(printBtn);
    /* ROSE-FIRST: 줄글(카드) 설계도는 rose 안에서 선택해 들어가는 보조 보기 */
    if (typeof opts.onSheetView === 'function') {
      const sheetBtn = _el('button', 'tc-rose-print tc-rose-sheet', '📄 줄글로 보기');
      sheetBtn.type = 'button';
      sheetBtn.title = '카드(줄글) 설계도로 봐요';
      sheetBtn.addEventListener('click', function () {
        close();   /* rose만 닫음 — onClose 미호출(아래 줄글 화면이 드러남) */
        try { opts.onSheetView(); } catch (e) {}
      });
      bar.appendChild(sheetBtn);
    }
    bar.appendChild(closeBtn);
    overlay.appendChild(bar);

    const paper = _el('div', 'tc-rose-paper');

    /* 헤더 */
    const head = _el('div', 'tc-rose-head');
    const hl = _el('div', '');
    hl.appendChild(_el('h2', 'tc-rose-title', '🧭 내 이야기 나침반'));
    const sub = _el('div', 'tc-rose-sub', '글을 쓰기 전에 보는 나의 이야기 설계도 ');
    const lenF = _fieldText(map, 'targetLength');
    sub.appendChild(_el('span', 'tc-rose-badge', '기본 길이 · ' + (lenF.text && !lenF.deferred ? lenF.text : '만들면서 정하기')));
    hl.appendChild(sub);
    head.appendChild(hl);
    const who = _el('div', 'tc-rose-who');
    who.innerHTML = '모둠 <span class="tc-rose-line"></span><br>이름 <span class="tc-rose-line"></span>';   /* 고정 마크업(사용자 데이터 없음) */
    head.appendChild(who);
    paper.appendChild(head);

    /* 나침반 스테이지 — 선/원만 SVG(정적), 텍스트는 HTML 카드 */
    const stage = _el('div', 'tc-rose-stage');
    stage.innerHTML =
      '<svg viewBox="0 0 614 420" aria-hidden="true">'
      + '<line x1="307" y1="210" x2="307" y2="52"  stroke="#b6cda6" stroke-width="2.5"/>'
      + '<line x1="307" y1="210" x2="307" y2="368" stroke="#b6cda6" stroke-width="2.5"/>'
      + '<line x1="307" y1="210" x2="100" y2="210" stroke="#b6cda6" stroke-width="2.5"/>'
      + '<line x1="307" y1="210" x2="514" y2="210" stroke="#b6cda6" stroke-width="2.5"/>'
      + '<g stroke="#d9e4cf" stroke-width="2">'
      + '<line x1="222" y1="125" x2="243" y2="146"/><line x1="392" y1="125" x2="371" y2="146"/>'
      + '<line x1="222" y1="295" x2="243" y2="274"/><line x1="392" y1="295" x2="371" y2="274"/></g>'
      + '<circle cx="307" cy="210" r="146" fill="none" stroke="#d9e4cf" stroke-width="2" stroke-dasharray="5 7"/>'
      + '</svg>';
    /* 방위 글자 — 점선 원 안쪽 */
    [['N', 'top: calc(50% - 138px); left: calc(50% + 9px);'],
     ['E', 'top: calc(50% - 22px); left: calc(50% + 118px);'],
     ['S', 'top: calc(50% + 118px); left: calc(50% + 9px);'],
     ['W', 'top: calc(50% - 22px); left: calc(50% - 130px);']].forEach(function (d) {
      const l = _el('span', 'tc-rose-letter', d[0]); l.style.cssText = d[1]; stage.appendChild(l);
    });
    stage.appendChild(_roseCard('dir-n', '🧒', '주인공', map, 'protagonist'));
    stage.appendChild(_roseCard('dir-e', '⭐', '원하는 것', map, 'goal'));
    stage.appendChild(_roseCard('dir-s', '🌊', '어려움', map, 'risingTrouble'));
    stage.appendChild(_roseCard('dir-w', '🔀', '중요한 선택', map, 'keyChoice'));
    const center = _el('div', 'tc-rose-center');
    center.appendChild(_el('span', 'tc-rose-pin', '💎'));
    center.appendChild(_el('span', 'tc-rose-center-label', '끝까지 지킬 중심'));
    center.appendChild(_valueEl('tc-rose-center-value', map, 'coreMessage'));
    stage.appendChild(center);
    paper.appendChild(stage);

    /* 시간띠 */
    const band = _el('div', 'tc-rose-band');
    const bt = _el('div', 'tc-rose-band-title', '🛤 진엔딩까지 가는 기본 길');
    bt.appendChild(_el('span', 'tc-rose-band-hint', ' — 다른 선택지와 다른 엔딩은 나중에 이 길에 붙여요'));
    band.appendChild(bt);
    const flow = _el('div', 'tc-rose-flow');
    flow.appendChild(_stop('🌅', '시작', map, 'mainlineStart'));
    flow.appendChild(_stop('⚡', '생기는 일', map, 'incitingEvent'));
    flow.appendChild(_stop('🌊', '점점 어려워져요', map, 'risingTrouble'));
    flow.appendChild(_stop('🔀', '중요한 선택', map, 'keyChoice'));
    flow.appendChild(_stop('🏁', '진엔딩', map, 'trueEnding', true));
    band.appendChild(flow);
    const alt = _el('div', 'tc-rose-alt');
    const altCard = _el('div', 'tc-rose-alt-card');
    altCard.appendChild(_el('div', 'tc-rose-card-label', '🌿 다른 선택을 하면'));
    altCard.appendChild(_valueEl('tc-rose-card-value', map, 'alternatePath'));
    alt.appendChild(altCard);
    band.appendChild(alt);
    paper.appendChild(band);

    /* 메모 — 저장된 자유메모 있으면 표시, 없으면 손글씨 빈 줄 */
    const memo = _el('div', 'tc-rose-memo');
    memo.appendChild(_el('div', 'tc-rose-memo-title', '📝 떠오른 생각 메모 — 만들면서 자유롭게 적어요'));
    const memoText = (typeof opts.memo === 'string') ? opts.memo.trim() : '';
    if (memoText) {
      memo.appendChild(_el('div', 'tc-rose-memo-text', memoText));
    } else {
      for (let i = 0; i < 3; i++) memo.appendChild(_el('div', 'tc-rose-memo-line'));
    }
    paper.appendChild(memo);

    paper.appendChild(_el('div', 'tc-rose-foot', '가지 · 생각 나침반 — 이 설계도는 참고 자료예요. 만들면서 자유롭게 바꿔도 괜찮아요.'));
    overlay.appendChild(paper);
    document.body.appendChild(overlay);
    try { paper.setAttribute('tabindex', '-1'); paper.focus({ preventScroll: true }); overlay.scrollTop = 0; } catch (e) {}
    return true;
  }

  /* 인쇄 — 기존 SHEET-1 gate 패턴 재사용(별도 클래스 tc-print-rose·인쇄 동안만). */
  /* TEACHER-PRINT-ROUTE-1: "선생님께 인쇄 부탁하기" 안내(review와 동일 문구·독립 DOM·저장 0). */
  function _showTeacherPrintNotice(onDevicePrint) {
    const prev = document.getElementById('tc-rose-teacher-print-notice');
    if (prev) prev.remove();
    const root = _el('div', '');
    root.id = 'tc-rose-teacher-print-notice';
    root.style.cssText = 'position:fixed;inset:0;z-index:10070;display:flex;align-items:center;justify-content:center;background:rgba(20,14,8,0.45);';
    const card = _el('div', '');
    card.style.cssText = 'background:#fffdf7;border-radius:14px;max-width:340px;width:calc(100% - 48px);padding:22px 20px 16px;box-shadow:0 12px 36px rgba(0,0,0,0.25);text-align:center;';
    card.innerHTML = ''
      + '<div style="font-size:30px;line-height:1;">🖨</div>'
      + '<div style="font-weight:700;font-size:16px;margin-top:8px;">선생님께 인쇄를 부탁해요</div>'
      + '<div style="font-size:13.5px;color:#5b4a33;margin-top:8px;line-height:1.55;">'
      +   '설계도는 선생님 컴퓨터에서 종이로 뽑아요.<br>'
      +   '선생님께 <b>“인쇄해 주세요”</b>라고 말씀드려요!'
      + '</div>'
      + '<button type="button" class="tc-rose-print js-tpn-ok" style="margin-top:14px;width:100%;">알겠어요</button>'
      + '<button type="button" class="tc-rose-close js-tpn-device" style="margin-top:8px;width:100%;font-size:12px;opacity:0.75;">그래도 이 기기에서 인쇄해 보기</button>';
    root.appendChild(card);
    document.body.appendChild(root);
    const close = function () { root.remove(); };
    card.querySelector('.js-tpn-ok').addEventListener('click', close);
    card.querySelector('.js-tpn-device').addEventListener('click', function () {
      close();
      if (typeof onDevicePrint === 'function') { try { onDevicePrint(); } catch (e) { /* noop */ } }
    });
    root.addEventListener('click', function (e) { if (e.target === root) close(); });
  }

  function _print() {
    try {
      document.body.classList.add('tc-print-rose');
      const cleanup = function () { document.body.classList.remove('tc-print-rose'); window.removeEventListener('afterprint', cleanup); };
      window.addEventListener('afterprint', cleanup);
      window.print();
      setTimeout(cleanup, 2000);   /* afterprint 미발화 브라우저 방어 */
    } catch (e) { document.body.classList.remove('tc-print-rose'); }
  }

  function close() { _remove(); }

  window.ThoughtCompassRose = { open: open, close: close };
})();
