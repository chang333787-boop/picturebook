/* picturebook-print.js — 그림책 분기 인쇄 (PICTUREBOOK-PRINT-1)
   · 대상: 교사 PC Chrome A4(태블릿 보조·모바일 그림책 범위 외). 설계 정본: docs/print_flow_audit_20260702.md
   · 장면 번호 = 시작 장면 BFS(표지 무번호·시작=1번·버튼 순서 방문). 도달 불가 장면은 이어지는
     번호로 "추가 장면" 섹션에 수록. 번호 map은 저장하지 않고 인쇄 시 즉석 계산(DB write 0).
   · 본문/그림 = 감상 발행 헬퍼(getPublishedBodyDisplay/getPublishedImageDisplaySrc) 재사용
     → textSelections/imageSelections 반영 = 감상본과 인쇄본 자동 일치. 원본 무변경(read만).
   · gate: body.print-picturebook + #pb-print-root(화면 상시 숨김) — tc-print 계열·print-write-after와 독립.
   · 순수 buildPrintOrder는 UMD(Node 테스트 가능). 입력 shape = ViewerState.scenes(adaptScenes 후:
     { id, num, type(cover|ending|normal|start), title, body, imageData, choices[{label,nextId}] }). */
;(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PicturebookPrint = Object.assign(root.PicturebookPrint || {}, api);
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  function _num(s) { const n = parseInt((s && (s.num != null ? s.num : s.id)), 10); return Number.isFinite(n) ? n : Infinity; }
  function _choices(s) { return (s && Array.isArray(s.choices)) ? s.choices : []; }

  /* 시작 장면 결정: 표지 choices[0].nextId(유효 키) → 없으면 표지 아닌 장면 중 num 최소. */
  function resolveStartKey(scenes) {
    const keys = Object.keys(scenes || {});
    const coverKey = keys.find(k => scenes[k] && scenes[k].type === 'cover') || null;
    if (coverKey) {
      const first = _choices(scenes[coverKey])[0];
      if (first && first.nextId != null && scenes[String(first.nextId)]) return { coverKey, startKey: String(first.nextId) };
    }
    const nonCover = keys.filter(k => scenes[k] && scenes[k].type !== 'cover')
      .sort((a, b) => _num(scenes[a]) - _num(scenes[b]));
    return { coverKey, startKey: nonCover[0] || null };
  }

  /* BFS 번호 매김(순수) — 반환 { coverKey, startKey, order[], numberByKey{}, reachableCount }.
     order = 도달 가능(번호순) 뒤에 도달 불가(추가 장면·num순, 번호 이어서). 순환은 방문 1회로 자연 처리. */
  function buildPrintOrder(scenes) {
    scenes = (scenes && typeof scenes === 'object') ? scenes : {};
    const { coverKey, startKey } = resolveStartKey(scenes);
    const numberByKey = {};
    const order = [];
    let n = 0;
    if (startKey) {
      const queue = [startKey];
      while (queue.length) {
        const k = queue.shift();
        if (!scenes[k] || numberByKey[k] != null || k === coverKey) continue;
        numberByKey[k] = ++n;
        order.push(k);
        for (const c of _choices(scenes[k])) {
          if (c && c.nextId != null && scenes[String(c.nextId)]) queue.push(String(c.nextId));
        }
      }
    }
    const reachableCount = n;
    /* 도달 불가(표지 제외) — num 순으로 번호 이어 붙임 */
    Object.keys(scenes)
      .filter(k => k !== coverKey && scenes[k] && numberByKey[k] == null)
      .sort((a, b) => _num(scenes[a]) - _num(scenes[b]))
      .forEach(k => { numberByKey[k] = ++n; order.push(k); });
    return { coverKey, startKey, order, numberByKey, reachableCount };
  }

  /* 선택지 이동 안내(순수) — { label, note } */
  function describeChoice(choice, numberByKey) {
    const label = (choice && typeof choice.label === 'string' && choice.label.trim()) ? choice.label.trim() : '(선택)';
    const nid = choice && choice.nextId != null ? String(choice.nextId) : '';
    if (!nid || numberByKey[nid] == null) return { label, note: '(연결 안 됨)' };
    return { label, note: '- 장면 ' + numberByKey[nid] + '로' };
  }

  /* ── 브라우저부: 인쇄 오버레이 생성 + gate + print ── */
  function _el(tag, cls, text) {
    if (typeof document === 'undefined') return null;
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function _publishedBody(scene) {
    const orig = (scene && typeof scene.body === 'string') ? scene.body : '';
    try {
      if (typeof window !== 'undefined' && typeof window.getPublishedBodyDisplay === 'function') {
        const v = window.getPublishedBodyDisplay(scene, orig);
        return (typeof v === 'string') ? v : orig;
      }
    } catch (e) { /* 원본 fallback */ }
    return orig;
  }
  function _publishedImage(scene) {
    /* POLISH-2: imageUrl fallback — viewer-render(587·1015·1587)와 동일하게 imageData||imageUrl.
       v113 Storage 이전 작품은 그림이 imageUrl(Storage URL)에만 있어 인쇄에서 전부 누락되던 버그. */
    const orig = (scene && (scene.imageData || scene.imageUrl)) || null;
    try {
      if (typeof window !== 'undefined' && typeof window.getPublishedImageDisplaySrc === 'function') {
        return window.getPublishedImageDisplaySrc(scene, orig) || orig;
      }
    } catch (e) { /* 원본 fallback */ }
    return orig;
  }

  /* DESIGN-3: 인쇄 전 <img> 로드 대기 — 원격 그림(imageUrl=Storage URL)이 로드되기 전에
     window.print()가 뜨면 미리보기/PDF에서 그림이 비어 보임(실작품에서 base64 표지만 나오고
     Storage 장면 그림이 전부 빠지던 재현 경로). 전 이미지 load/error를 최대 PRELOAD_MAX_MS
     기다린 뒤 인쇄. 실패 이미지는 자리표시 박스로 교체(깨진 아이콘 방지). 데이터 write 0. */
  const PRELOAD_MAX_MS = 4000;
  function _waitForImages(rootEl) {
    const imgs = Array.prototype.slice.call(rootEl.querySelectorAll('img'));
    const swapToMissing = (im) => {
      const ph = _el('div', 'pbp-img-missing', '(그림을 불러오지 못했어요)');
      if (im && im.parentNode) im.parentNode.replaceChild(ph, im);
    };
    const waits = [];
    imgs.forEach((im) => {
      if (im.complete && im.naturalWidth > 0) return;               /* 이미 로드됨(data URI 등) */
      if (im.complete && im.naturalWidth === 0) { swapToMissing(im); return; }  /* 이미 실패 */
      waits.push(new Promise((res) => {
        im.addEventListener('load', () => res(), { once: true });
        im.addEventListener('error', () => { swapToMissing(im); res(); }, { once: true });
      }));
    });
    if (!waits.length) return Promise.resolve();
    return Promise.race([
      Promise.all(waits),
      new Promise((res) => setTimeout(res, PRELOAD_MAX_MS)),
    ]);
  }

  async function open(opts) {
    if (typeof document === 'undefined') return false;
    opts = opts || {};
    const scenes = opts.scenes
      || (typeof window !== 'undefined' && window.ViewerState && window.ViewerState.scenes) || {};
    const keys = Object.keys(scenes);
    if (!keys.length) { try { alert('인쇄할 장면이 없어요.'); } catch (e) {} return false; }
    const res = buildPrintOrder(scenes);
    if (!res.order.length) { try { alert('인쇄할 장면이 없어요.'); } catch (e) {} return false; }
    const title = opts.title
      || (typeof window !== 'undefined' && window.ViewerState && window.ViewerState.project && window.ViewerState.project.teamName) || '우리들의 그림책';

    /* PRINT-VIEW-MODE-OPTIONS-1: 인쇄 기준 옵션 — 글/그림 각각 'original'|'s2'(독립).
       · 일회성(DB 저장 0)·기본 원본/원본. s2 접근자는 호출부(viewer-ai)가 콜백으로 주입 —
         이 모듈은 aiVariants 구조를 모름(감상 토글과 동일 데이터 소스 보장).
       · s2 선택이어도 해당 장면에 후보가 없으면 장면 단위로 원본 fallback(빈 페이지 방지).
       · 'original' 그림 = 진짜 원본(imageData||imageUrl) — 감상 '그림 보기: 원본' 토글과 동일 의미.
       · opts 미지정(테스트/구 호출) = 기존 경로 그대로. */
    const _textMode = (opts.textMode === 's2') ? 's2' : 'original';
    const _imageMode = (opts.imageMode === 's2') ? 's2' : 'original';
    const _sidOf = (s) => (s && (s.id != null ? s.id : s.num));
    const bodyOf = (s) => {
      if (_textMode === 's2' && typeof opts.getS2Body === 'function') {
        try {
          const v = opts.getS2Body(_sidOf(s));
          if (typeof v === 'string' && v.trim()) return v;
        } catch (e) { /* 원본 fallback */ }
      }
      return _publishedBody(s);
    };
    const imageOf = (s) => {
      if (_imageMode === 's2' && typeof opts.getS2Image === 'function') {
        try {
          const u = opts.getS2Image(_sidOf(s));
          if (typeof u === 'string' && u) return u;
        } catch (e) { /* 원본 fallback */ }
      }
      if (opts.textMode || opts.imageMode) return (s && (s.imageData || s.imageUrl)) || null;   /* 옵션 경유 = 명시 원본 */
      return _publishedImage(s);
    };
    /* SCENE-PUBLISH-PRINT-1: 말풍선(글상자) layout — 원본 scene.picturebookBodyBox(%),
       글=AI(s2)면 variant layout(호출부 콜백) 우선. REFINE-STAB-B 원칙: 진하기(backdropOpacity)는
       항상 원본을 따름. 저장값 read만 — 변경 0. */
    const _PB_BOX_DEFAULT = { x: 15, y: 25, width: 55, height: null, backdropOpacity: 0.85 };
    const layoutOf = (s) => {
      const orig = (s && s.picturebookBodyBox && typeof s.picturebookBodyBox === 'object')
        ? Object.assign({}, _PB_BOX_DEFAULT, s.picturebookBodyBox) : Object.assign({}, _PB_BOX_DEFAULT);
      if (_textMode === 's2' && typeof opts.getS2Layout === 'function') {
        try {
          const v = opts.getS2Layout(_sidOf(s));
          if (v && typeof v === 'object') return Object.assign({}, _PB_BOX_DEFAULT, v, { backdropOpacity: orig.backdropOpacity });
        } catch (e) { /* 원본 layout fallback */ }
      }
      return orig;
    };
    /* PRINT-FONT(2026-07-09): 인쇄 본문 글씨체를 화면(다듬기/감상)과 동일하게 — viewer-render.js와 같은 로직으로
       scene.textStyle.fontFamily(키) → TEXT_FONT_FAMILIES(CSS 스택) → --pb-font-family. 둘 다 typeof 가드(편집번들
       미로드/구작 안전 폴백=CSS 기본 Gowun Batang). AI변환본은 폰트 변경 불가(크기만)라 원본 fontFamily가 정확. */
    const _fontOf = (s) => {
      try {
        const st = (typeof getTextStyle === 'function') ? getTextStyle(s) : null;
        const fm = (typeof TEXT_FONT_FAMILIES === 'object') ? TEXT_FONT_FAMILIES : {};
        return (st && st.fontFamily && fm[st.fontFamily]) ? fm[st.fontFamily] : '';
      } catch (e) { return ''; }
    };
    /* PRINT-STYLE(#63): 글씨체뿐 아니라 학생이 정한 크기·굵기·색도 인쇄에 반영(전엔 19px 검정 보통
       고정이라 화면과 딴판). 각 값을 page에 CSS 변수로 심고, 인쇄 CSS가 var(...,기본값)로 받는다.
       크기는 학생이 명시 설정한 px만 반영(미설정=인쇄 기본 유지). 무대 폭이 화면과 유사해 px 근사(정밀
       스케일 아님)지만 고정 19px보다 훨씬 화면에 가깝다. 굵기/색은 절대값이라 정확. */
    const _applyPrintStyle = (page, s) => {
      try {
        const ff = _fontOf(s);
        if (ff) page.style.setProperty('--pb-font-family', ff);
        const st = (typeof getTextStyle === 'function') ? getTextStyle(s) : null;
        if (!st) return;
        if (Number.isFinite(st.fontSize)) page.style.setProperty('--pb-fs-body', st.fontSize + 'px');
        if (st.weight === 'bold') page.style.setProperty('--pb-fw-body', '700');
        else if (st.weight) page.style.setProperty('--pb-fw-body', '400');
        if (st.color) page.style.setProperty('--pb-color-override', st.color);
      } catch (e) { /* noop — 실패 시 인쇄 CSS 기본값 */ }
    };

    /* ── PRINT-HELPER(2026-07-20): 인쇄 전용 조절값 — 장면키→{x(%),y(%),fontScale}.
       작품 데이터(scenes) 무접촉: 인쇄 DOM에만 적용. 저장/로드는 호출부(viewer-ai)가
       viewer-meta.printOverrides로 담당(getS2* 콜백과 동일하게 이 모듈은 DB를 모름).
       opts.helper=true면 인쇄 대신 화면 미리보기+조절 UI(도우미)로 연다. */
    const _helper = !!opts.helper;
    const _overrides = {};
    if (opts.printOverrides && typeof opts.printOverrides === 'object') {
      Object.keys(opts.printOverrides).forEach((k) => {
        const o = opts.printOverrides[k];
        if (!o || typeof o !== 'object') return;
        const out = {};
        if (Number.isFinite(Number(o.x))) out.x = Math.max(0, Math.min(94, Number(o.x)));
        if (Number.isFinite(Number(o.y))) out.y = Math.max(0, Math.min(94, Number(o.y)));
        if (Number.isFinite(Number(o.fontScale))) out.fontScale = Math.max(0.5, Math.min(1.4, Number(o.fontScale)));
        if (Object.keys(out).length) _overrides[String(k)] = out;
      });
    }

    const old = document.getElementById('pb-print-root');
    if (old) old.remove();
    const rootEl = _el('div', 'pb-print-root');
    rootEl.id = 'pb-print-root';

    /* ── 1p: 표지 ── */
    const coverScene = res.coverKey ? scenes[res.coverKey] : null;
    const coverPage = _el('div', 'pbp-page pbp-cover');
    /* DESIGN-3: 표지를 프레임 카드로 — 상단 브랜드 라인 + 제목 묶음 + 그림 + 하단 모둠/날짜 */
    const coverInner = _el('div', 'pbp-cover-frame');
    coverPage.appendChild(coverInner);
    coverInner.appendChild(_el('div', 'pbp-cover-brand', '🌿 가지 branch 그림책'));
    const coverTitleWrap = _el('div', 'pbp-cover-titlewrap');
    coverTitleWrap.appendChild(_el('h1', 'pbp-cover-title', (coverScene && (coverScene.title || '').trim()) || title));
    if (coverScene && (coverScene.subtitle || '').trim()) coverTitleWrap.appendChild(_el('div', 'pbp-cover-sub', coverScene.subtitle.trim()));
    coverInner.appendChild(coverTitleWrap);
    const coverImg = imageOf(coverScene);
    if (coverImg) { const im = document.createElement('img'); im.className = 'pbp-cover-img'; im.src = coverImg; coverInner.appendChild(im); }
    /* FOLLOWUP-3: 그림 없는 표지 장식 글리프(⸙) 제거 — 일부 폰트에서 투피(☒)로 찍혀 깨진 이미지처럼 보임. 여백이 자연스러움. */
    const coverFoot = _el('div', 'pbp-cover-foot');
    /* AUTHOR-PRINT(2026-07-18 사용자 결정): '만든 모둠' → '지은이' — 작품이 모둠 단위가 아닐 수
       있음. 이름 우선순위: 인쇄 모달 입력(opts.authorName) → 저장값(viewer-meta.authorName —
       ViewerState 인제스트) → 팀명(기존 표기). */
    const _authorName = (opts.authorName && String(opts.authorName).trim())
      || (typeof window !== 'undefined' && window.ViewerState && window.ViewerState.project
          && window.ViewerState.project.authorName) || title;
    coverFoot.appendChild(_el('div', 'pbp-cover-team', '지은이: ' + _authorName));
    const _d = new Date();
    coverFoot.appendChild(_el('div', 'pbp-cover-date', _d.getFullYear() + '년 ' + (_d.getMonth() + 1) + '월 ' + _d.getDate() + '일'));
    coverInner.appendChild(coverFoot);
    rootEl.appendChild(coverPage);

    /* POLISH-2: '이야기 길 지도' 페이지 제거 — 구조 점검 성격이라 학생 그림책 출판물과 안 맞음
       (사용자 결정 2026-07-03). 선택지의 '- 장면 N로'만으로 읽기 가능. BFS 번호 계산은
       buildPrintOrder가 담당하므로 무영향. 지도가 다시 필요하면 별도 버튼/기능으로 분리. */

    /* ── 본문: 장면당 1페이지 (SCENE-PUBLISH-PRINT-1 — '장면 그대로' 출판형) ──
       그림 있는 장면 = 화면의 그림중심 무대(그림+말풍선 % 좌표+진하기)를 인쇄 전용 고정
       무대(.pbp-stage2·3:2·px 폰트)에 DOM으로 재현(캡처/래스터화 0·화질 손실 0). 선택지는
       화면 버튼 대신 하단 인쇄용 안내로 정리. split형 장면(말풍선 없음)은 본문을 무대 아래 배치.
       무그림 장면 = 기존 text-only 출판 페이지(LAYOUT-4) 유지. 번호(BFS)·선택지 안내·gate 재사용. */
    /* ENDING-RETURN(2026-07-09): 각 장면의 '전 장면'(부모) 번호 맵 — 비-진엔딩 엔딩에 "장면 N로 돌아가세요"
       안내용(인쇄본은 클릭 불가라 다른 결말을 찾으려면 분기 장면으로 돌아가야 함). 부모 여럿이면 가장 작은 번호. */
    const _parentNumByKey = {};
    res.order.forEach((pk) => {
      _choices(scenes[pk]).forEach((c) => {
        if (c && c.nextId != null) {
          const nk = String(c.nextId);
          const pn = res.numberByKey[pk];
          if (scenes[nk] && pn != null && (_parentNumByKey[nk] == null || pn < _parentNumByKey[nk])) _parentNumByKey[nk] = pn;
        }
      });
    });
    const _choicesBoxOf = (sc, key) => {
      const chs = _choices(sc);
      if (!chs.length) {
        /* 엔딩: 진엔딩=결말 표시 / 그 외=전 장면으로 돌아가 다른 길 읽기 안내(부모 없으면 기존 '이야기 끝'). */
        if (sc && (sc.trueEnding || sc.isTrueEnd)) return _el('div', 'pbp-end-mark', '⭐ 진짜 결말 —');
        const pn = (key != null) ? _parentNumByKey[String(key)] : null;
        if (pn != null) return _el('div', 'pbp-end-mark', '장면 ' + pn + '로 돌아가 다른 길도 읽어보세요');
        return _el('div', 'pbp-end-mark', '— 이야기 끝 —');
      }
      const box = _el('div', 'pbp-choices');
      chs.forEach(c => {
        const d = describeChoice(c, res.numberByKey);
        const row = _el('div', 'pbp-choice');
        if (d.label !== '(선택)') row.appendChild(_el('span', 'pbp-choice-label', '▸ ' + d.label));
        row.appendChild(_el('span', 'pbp-choice-goto', d.note));
        box.appendChild(row);
      });
      return box;
    };
    res.order.forEach((k) => {
      const s = scenes[k];
      const img = imageOf(s);
      const body = (bodyOf(s) || '').trim();
      const flags = [];
      if (res.numberByKey[k] > res.reachableCount) flags.push('추가 장면');
      if (s.type === 'ending') flags.push((s.trueEnding || s.isTrueEnd) ? '진엔딩' : '엔딩');
      /* PRINT-SCENE-LABEL(2026-07-09): 'N번' → '장면 N'(사용자 선호). */
      const numText = '장면 ' + res.numberByKey[k] + (flags.length ? ' · ' + flags.join(' · ') : '');

      if (img) {
        /* 장면 그대로: 고정 3:2 무대 — 인쇄 페이지 폭은 A4에서 일정하므로 % 좌표+px 폰트 = 기기 무관 결정적 */
        const page = _el('div', 'pbp-page pbp-scenepub');
        _applyPrintStyle(page, s);   /* PRINT-STYLE(#63): 글씨체+크기+굵기+색 */
        const wrap = _el('div', 'pbp-stagewrap');
        const st = _el('div', 'pbp-stage2');
        const im = document.createElement('img'); im.className = 'pbp-stage2-img'; im.src = img;
        st.appendChild(im);
        /* PB-NUM-FOOT(2026-07-09): 장면 번호는 그림 좌상단 배지 대신 선택지 아래(하단)로 이동(직관성·사용자 요청). */
        if ((s.title || '').trim()) st.appendChild(_el('div', 'pbp-stage2-title', s.title.trim()));
        const isImageCenter = (s.picturebookSubmode === 'imageCenter');
        if (body && isImageCenter) {
          /* 말풍선 재현 — 화면과 동일한 % 좌표·진하기. 명시 height는 min-height로(인쇄는 스크롤
             불가 → 긴 글 자동 확장·잘림 0). 좌표는 저장 시 이미 무대 안으로 클램프됨. */
          const bb = layoutOf(s);
          const op = (typeof bb.backdropOpacity === 'number') ? bb.backdropOpacity : 0.85;
          const bub = _el('div', 'pbp-stage2-bubble');
          /* PRINT-HELPER: 저장된 조절값(x/y)이 있으면 인쇄 좌표만 교체(원본 layout 불변).
             원좌표는 dataset에 보존 — 도우미 ↺(되돌리기)의 복귀 기준. */
          const ovr = _overrides[String(k)] || null;
          const bx = (ovr && ovr.x != null) ? ovr.x : bb.x;
          const by = (ovr && ovr.y != null) ? ovr.y : bb.y;
          /* PAPER-BUBBLE(2026-07-09): 흰색 인라인 대신 진하기만 변수로 넘기고 배경색은 인쇄 CSS(paper 베이지)가 적용.
             화면 paper-storybook 말풍선(v03-modes.css)과 톤 일치. */
          bub.style.cssText = 'left:' + bx + '%;top:' + by + '%;width:' + bb.width + '%;'
            + (typeof bb.height === 'number' ? 'min-height:' + bb.height + '%;' : '')
            + '--pb-box-opacity:' + op + ';'
            + 'box-shadow:0 2px 6px rgba(0,0,0,' + (0.08 * op).toFixed(3) + ');';
          bub.dataset.pbpKey = String(k);
          bub.dataset.pbpOrigX = String(bb.x);
          bub.dataset.pbpOrigY = String(bb.y);
          const p = _el('p', 'pbp-stage2-bubble-p', body);
          p.dataset.pbpFsKey = String(k);   /* 글자 크기 조절 대상(도우미/자동맞춤 공용) */
          bub.appendChild(p);
          st.appendChild(bub);
        }
        wrap.appendChild(st);
        page.appendChild(wrap);
        if (body && !isImageCenter) {
          /* 분할형: 말풍선 좌표가 없으므로 본문을 무대 아래 인쇄용 박스로 */
          const bodyEl = _el('div', 'pbp-scenepub-body', body);
          bodyEl.dataset.pbpFsKey = String(k);   /* PRINT-HELPER: 글자 크기 조절 대상 */
          page.appendChild(bodyEl);
        }
        page.appendChild(_choicesBoxOf(s, k));
        page.appendChild(_el('div', 'pbp-num-foot', numText));
        rootEl.appendChild(page);
      } else {
        /* 무그림 — text-only 출판 페이지(LAYOUT-4 유지) */
        const page = _el('div', 'pbp-page pbp-publish');
        _applyPrintStyle(page, s);   /* PRINT-STYLE(#63): 글씨체+크기+굵기+색 */
        const card = _el('div', 'pbp-scene pbp-scene--full pbp-scene--noimg');
        if ((s.title || '').trim()) card.appendChild(_el('div', 'pbp-scene-caption', s.title.trim()));
        const noimgBody = _el('div', 'pbp-scene-body' + (body ? '' : ' pbp-scene-body--empty'), body || '(글 없음)');
        if (body) noimgBody.dataset.pbpFsKey = String(k);   /* PRINT-HELPER: 글자 크기 조절 대상 */
        card.appendChild(noimgBody);
        card.appendChild(_choicesBoxOf(s, k));
        /* PB-NUM-FOOT(2026-07-09): 번호를 카드 상단 배지 대신 선택지 아래로 이동. */
        card.appendChild(_el('div', 'pbp-num-foot', numText));
        page.appendChild(card);
        rootEl.appendChild(page);
      }
    });
    document.body.appendChild(rootEl);

    /* DESIGN-3: 인쇄 전 그림 로드 대기(원격 Storage 그림 누락 방지·최대 4초) */
    try { await _waitForImages(rootEl); } catch (e) { /* 대기 실패해도 인쇄는 진행 */ }
    /* PRINT-NOCLIP: 본문 웹폰트(Gowun Batang 등) 로드까지 대기 — 줄바꿈 확정 후 실측(PB-FIT 선례) */
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) { /* noop */ }

    /* gate — 버튼 경유 인쇄 동안만(취소 포함 afterprint+2s 정리).
       FIELD-REGRESSION-FIX-2: <html>에도 print-doc-unclip 부여 — viewer.css의 화면용
       html,body{height:100%;overflow:hidden}이 인쇄 fragmentation을 1페이지로 잘라
       표지/지도/장면이 한 장에 뭉치던(1/1) 실환경 문제 해제. CSS는 pb-ai.css @media print.
       PRINT-HELPER: pb-ai.css가 print,screen이 되어 클래스만으로 인쇄 레이아웃이 화면에도
       계산됨 → 클래스 부여 직후 동기 실측(자동 맞춤)이 가능. 일반 인쇄는 실측 직후 바로
       print()를 부르므로 사용자에게 보이는 변화 없음. */
    try {
      document.body.classList.add('print-picturebook');
      document.documentElement.classList.add('print-doc-unclip');
      /* PRINT-NOCLIP: 저장된 글자 조절 적용(계산 폰트 기준) → 말풍선 자동 맞춤 */
      _applyFontOverrides(rootEl, _overrides);
      _autoFitBubbles(rootEl, _overrides);
      const cleanup = function () {
        document.body.classList.remove('print-picturebook');
        document.documentElement.classList.remove('print-doc-unclip');
        const r = document.getElementById('pb-print-root');
        if (r) r.remove();
        window.removeEventListener('afterprint', cleanup);
      };
      if (_helper) {
        /* 도우미: 인쇄 대신 화면 미리보기+조절 UI — 정리는 [닫기]가 담당(인쇄 후에도 유지). */
        _buildHelperUi(rootEl, _overrides, opts, cleanup);
        return true;
      }
      window.addEventListener('afterprint', cleanup);
      window.print();
      setTimeout(cleanup, 2000);
    } catch (e) {
      document.body.classList.remove('print-picturebook');
      document.documentElement.classList.remove('print-doc-unclip');
      const r = document.getElementById('pb-print-root');
      if (r) r.remove();
    }
    return true;
  }

  /* ══════════════ PRINT-NOCLIP + PRINT-HELPER (2026-07-20) ══════════════ */

  /* 글자 크기 조절 공통 — 요소의 '계산 폰트'를 기준(px)으로 곱해 인라인 지정.
     CSS 출처(var/고정 pt) 무관하게 동작. 기준값은 dataset에 1회 보존(재적용 안정).
     print,screen 레이아웃 활성(body.print-picturebook) 후에만 호출해야 기준이 정확. */
  function _fsBaseOf(el) {
    if (!el.dataset.pbpFsBase) {
      const prev = el.style.fontSize;
      el.style.fontSize = '';
      const base = parseFloat(getComputedStyle(el).fontSize) || 19;
      el.dataset.pbpFsBase = String(base);
      el.style.fontSize = prev;
    }
    return parseFloat(el.dataset.pbpFsBase);
  }
  function _applyFsScale(el, scale) {
    const base = _fsBaseOf(el);
    if (!Number.isFinite(scale) || Math.abs(scale - 1) < 0.001) el.style.fontSize = '';
    else el.style.fontSize = (Math.round(base * scale * 10) / 10) + 'px';
  }
  function _applyFontOverrides(rootEl, overrides) {
    rootEl.querySelectorAll('[data-pbp-fs-key]').forEach((el) => {
      const o = overrides[el.dataset.pbpFsKey];
      if (o && Number.isFinite(o.fontScale)) _applyFsScale(el, o.fontScale);
    });
  }

  /* 말풍선 자동 맞춤(PRINT-NOCLIP): 무대(3:2·overflow hidden) 아래로 넘친 말풍선만
     글자 단계 축소(-5%p씩·하한 60%) → 그래도 넘치면 위로 끌어올림(y≥2%) = 잘림 0.
     교사가 도우미에서 손댄 장면(override 존재)은 자동 개입 없이 존중.
     인쇄 DOM에만 적용·저장 0. 말풍선은 무대 폭 기준이라 화면 실측=인쇄와 일치
     (미리보기 root 폭 198mm 고정). 분할형/글만 페이지는 96vh(매체별 상이) 게이트라
     자동 제외 — 도우미 수동 조절+뱃지로 커버. */
  function _autoFitBubbles(rootEl, overrides) {
    rootEl.querySelectorAll('.pbp-stage2-bubble').forEach((bub) => {
      const key = bub.dataset.pbpKey || '';
      if (overrides && overrides[key]) return;
      const st = bub.closest('.pbp-stage2');
      const p = bub.querySelector('.pbp-stage2-bubble-p');
      if (!st || !p) return;
      const fits = () => bub.getBoundingClientRect().bottom <= st.getBoundingClientRect().bottom - 2;
      if (fits()) return;
      let scale = 1;
      while (!fits() && scale > 0.6) {
        scale = Math.round((scale - 0.05) * 100) / 100;
        _applyFsScale(p, scale);
        void bub.offsetHeight;
      }
      if (!fits()) {
        const sr = st.getBoundingClientRect();
        const overPx = bub.getBoundingClientRect().bottom - (sr.bottom - 2);
        const curTop = parseFloat(bub.style.top) || 0;
        bub.style.top = Math.max(2, curTop - (overPx / sr.height) * 100).toFixed(1) + '%';
      }
      if (scale < 1) bub.dataset.pbpAutoScale = String(scale);
    });
  }

  /* 인쇄 도우미 본체 — 미리보기 위 조절 UI. 조절 결과는 overrides(참조 공유)에 기록,
     [인쇄]/[닫기] 시 opts.onSaveOverrides(overrides)로 호출부에 전달(viewer-meta 저장).
     작품 데이터 무접촉 — 좌표/글자 조절은 인쇄 DOM + printOverrides에만 존재. */
  function _buildHelperUi(rootEl, overrides, opts, cleanup) {
    rootEl.classList.add('pbp-helper-on');
    const save = function () {
      try { if (typeof opts.onSaveOverrides === 'function') opts.onSaveOverrides(overrides); } catch (e) { /* noop */ }
    };

    const bar = _el('div', 'pbp-helper-ui pbp-helper-bar');
    const txt = _el('div', 'pbp-helper-bar__txt');
    txt.innerHTML = '<b>🖨 인쇄 도우미</b> — 말풍선을 끌어 옮기고 A−/A+로 글자 크기를 바꿔 보세요. <b>인쇄에만</b> 반영되고 작품은 그대로예요.';
    const btns = _el('div', 'pbp-helper-bar__btns');
    const printBtn = _el('button', 'pbp-helper-btn', '🖨 인쇄하기'); printBtn.type = 'button';
    const closeBtn = _el('button', 'pbp-helper-btn pbp-helper-btn--ghost', '✕ 닫기'); closeBtn.type = 'button';
    btns.appendChild(printBtn); btns.appendChild(closeBtn);
    bar.appendChild(txt); bar.appendChild(btns);
    rootEl.appendChild(bar);
    printBtn.addEventListener('click', function () { save(); try { window.print(); } catch (e) { /* noop */ } });
    closeBtn.addEventListener('click', function () { save(); cleanup(); });

    const ent = function (key) { return overrides[key] || (overrides[key] = {}); };

    rootEl.querySelectorAll('.pbp-page').forEach((page) => {
      const bub = page.querySelector('.pbp-stage2-bubble');
      const fsEl = page.querySelector('[data-pbp-fs-key]');
      if (!bub && !fsEl) return;   /* 표지 등 조절 대상 없음 */
      const key = (bub && bub.dataset.pbpKey) || (fsEl && fsEl.dataset.pbpFsKey);
      const st = bub ? bub.closest('.pbp-stage2') : null;

      /* ⚠️ 잘림 뱃지 — 말풍선: 무대 실측(정확) / 본문: 페이지 96vh 근사 안내 */
      const badge = _el('div', 'pbp-helper-ui pbp-helper-badge', '');
      badge.style.display = 'none';
      (st || page).appendChild(badge);
      const refreshBadge = function () {
        let clipped = false;
        if (bub && st) {
          clipped = bub.getBoundingClientRect().bottom > st.getBoundingClientRect().bottom - 1;
          badge.textContent = '⚠️ 말풍선 글이 그림 밖으로 잘려요';
        } else if (fsEl) {
          clipped = page.scrollHeight > page.clientHeight + 2;
          badge.textContent = '⚠️ 글이 페이지를 넘칠 수 있어요';
        }
        badge.style.display = clipped ? '' : 'none';
      };

      /* 글자 크기 칩 (A− ·%· A+ · ↺) */
      const target = bub ? bub.querySelector('.pbp-stage2-bubble-p') : fsEl;
      if (target) {
        const chip = _el('div', 'pbp-helper-ui pbp-helper-chip');
        const minus = _el('button', '', 'A−'); minus.type = 'button';
        const val = _el('span', 'pbp-helper-chip__val', '');
        const plus = _el('button', '', 'A+'); plus.type = 'button';
        const reset = _el('button', '', '↺'); reset.type = 'button';
        chip.appendChild(minus); chip.appendChild(val); chip.appendChild(plus); chip.appendChild(reset);
        (st || page).appendChild(chip);
        const curScale = function () {
          const o = overrides[key];
          if (o && Number.isFinite(o.fontScale)) return o.fontScale;
          if (bub && bub.dataset.pbpAutoScale) return parseFloat(bub.dataset.pbpAutoScale);
          return 1;
        };
        const show = function () { val.textContent = Math.round(curScale() * 100) + '%'; };
        const stepTo = function (s) {
          s = Math.round(Math.max(0.6, Math.min(1.2, s)) * 100) / 100;
          ent(key).fontScale = s;
          _applyFsScale(target, s);
          show(); refreshBadge();
        };
        minus.addEventListener('click', function () { stepTo(curScale() - 0.05); });
        plus.addEventListener('click', function () { stepTo(curScale() + 0.05); });
        reset.addEventListener('click', function () {
          delete overrides[key];
          _applyFsScale(target, 1);
          if (bub) {
            delete bub.dataset.pbpAutoScale;
            bub.style.left = bub.dataset.pbpOrigX + '%';
            bub.style.top = bub.dataset.pbpOrigY + '%';
            _autoFitBubbles(rootEl, overrides);   /* override 삭제됐으니 이 장면만 다시 자동 맞춤 */
          }
          show(); refreshBadge();
        });
        show();
      }

      /* 말풍선 드래그 → 인쇄 좌표만 이동(원본 layout 무접촉) */
      if (bub && st) {
        let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
        bub.addEventListener('pointerdown', function (e) {
          dragging = true; sx = e.clientX; sy = e.clientY;
          ox = parseFloat(bub.style.left) || 0; oy = parseFloat(bub.style.top) || 0;
          bub.classList.add('pbp-dragging');
          try { bub.setPointerCapture(e.pointerId); } catch (er) { /* noop */ }
          e.preventDefault();
        });
        bub.addEventListener('pointermove', function (e) {
          if (!dragging) return;
          const sr = st.getBoundingClientRect();
          if (!sr.width || !sr.height) return;
          const w = parseFloat(bub.style.width) || 55;
          const nx = Math.max(0, Math.min(100 - w, ox + ((e.clientX - sx) / sr.width) * 100));
          const ny = Math.max(0, Math.min(94, oy + ((e.clientY - sy) / sr.height) * 100));
          bub.style.left = nx.toFixed(1) + '%';
          bub.style.top = ny.toFixed(1) + '%';
        });
        const endDrag = function () {
          if (!dragging) return;
          dragging = false;
          bub.classList.remove('pbp-dragging');
          const o = ent(key);
          o.x = Math.round((parseFloat(bub.style.left) || 0) * 10) / 10;
          o.y = Math.round((parseFloat(bub.style.top) || 0) * 10) / 10;
          refreshBadge();
        };
        bub.addEventListener('pointerup', endDrag);
        bub.addEventListener('pointercancel', endDrag);
      }

      refreshBadge();
    });

    try { window.scrollTo(0, 0); } catch (e) { /* noop */ }
  }

  return { buildPrintOrder, resolveStartKey, describeChoice, open, _autoFitBubbles };
});
