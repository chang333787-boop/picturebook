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
    if (!nid || numberByKey[nid] == null) return { label, note: '(연결되지 않음)' };
    return { label, note: '→ ' + numberByKey[nid] + '번 장면으로 가세요' };
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
    else coverInner.appendChild(_el('div', 'pbp-cover-noimg-deco', '⸙'));   /* 그림 없는 표지 — 은은한 장식 */
    const coverFoot = _el('div', 'pbp-cover-foot');
    coverFoot.appendChild(_el('div', 'pbp-cover-team', '만든 모둠: ' + title));
    const _d = new Date();
    coverFoot.appendChild(_el('div', 'pbp-cover-date', _d.getFullYear() + '년 ' + (_d.getMonth() + 1) + '월 ' + _d.getDate() + '일'));
    coverInner.appendChild(coverFoot);
    rootEl.appendChild(coverPage);

    /* POLISH-2: '이야기 길 지도' 페이지 제거 — 구조 점검 성격이라 학생 그림책 출판물과 안 맞음
       (사용자 결정 2026-07-03). 선택지의 '→ N번 장면으로 가세요'만으로 읽기 가능. BFS 번호 계산은
       buildPrintOrder가 담당하므로 무영향. 지도가 다시 필요하면 별도 버튼/기능으로 분리. */

    /* ── 본문: 출판형 — 장면당 1페이지 (PICTUREBOOK-PUBLISH-PRINT-1) ──
       구 2장면/페이지(점검형 축소 카드)를 폐기하고 큰 그림+큰 글의 그림책 출판물로 전환.
       번호(BFS)·선택지 안내(describeChoice)·발행 헬퍼·gate는 그대로 재사용. */
    res.order.forEach((k) => {
      const s = scenes[k];
      const img = imageOf(s);
      const page = _el('div', 'pbp-page pbp-publish');
      const card = _el('div', 'pbp-scene pbp-scene--full' + (img ? '' : ' pbp-scene--noimg'));
      /* LAYOUT-4: 장면번호 = 그림 좌상단 오버레이 배지(별도 행 제거 → 세로 공간 절약).
         플래그(엔딩/추가 장면)는 배지에 병기. 제목은 있을 때만 본문 위 작은 캡션. */
      const flags = [];
      if (res.numberByKey[k] > res.reachableCount) flags.push('추가 장면');
      if (s.type === 'ending') flags.push('엔딩');
      card.appendChild(_el('span', 'pbp-num-overlay', res.numberByKey[k] + '번' + (flags.length ? ' · ' + flags.join(' · ') : '')));
      if (img) { const im = document.createElement('img'); im.className = 'pbp-scene-img'; im.src = img; card.appendChild(im); }
      if ((s.title || '').trim()) card.appendChild(_el('div', 'pbp-scene-caption', s.title.trim()));
      const body = (bodyOf(s) || '').trim();
      card.appendChild(_el('div', 'pbp-scene-body' + (body ? '' : ' pbp-scene-body--empty'), body || '(글 없음)'));
      const chs = _choices(s);
      if (chs.length) {
        const box = _el('div', 'pbp-choices');
        chs.forEach(c => {
          const d = describeChoice(c, res.numberByKey);
          const row = _el('div', 'pbp-choice');
          /* 선택지 글이 비어 있으면('(선택)' placeholder) 이동 안내만 크게 표시 */
          if (d.label !== '(선택)') row.appendChild(_el('span', 'pbp-choice-label', '▸ ' + d.label));
          row.appendChild(_el('span', 'pbp-choice-goto', d.note));
          box.appendChild(row);
        });
        card.appendChild(box);
      } else {
        card.appendChild(_el('div', 'pbp-end-mark', '— 이야기 끝 —'));
      }
      page.appendChild(card);
      rootEl.appendChild(page);
    });
    document.body.appendChild(rootEl);

    /* DESIGN-3: 인쇄 전 그림 로드 대기(원격 Storage 그림 누락 방지·최대 4초) */
    try { await _waitForImages(rootEl); } catch (e) { /* 대기 실패해도 인쇄는 진행 */ }

    /* gate — 버튼 경유 인쇄 동안만(취소 포함 afterprint+2s 정리).
       FIELD-REGRESSION-FIX-2: <html>에도 print-doc-unclip 부여 — viewer.css의 화면용
       html,body{height:100%;overflow:hidden}이 인쇄 fragmentation을 1페이지로 잘라
       표지/지도/장면이 한 장에 뭉치던(1/1) 실환경 문제 해제. CSS는 pb-ai.css @media print. */
    try {
      document.body.classList.add('print-picturebook');
      document.documentElement.classList.add('print-doc-unclip');
      const cleanup = function () {
        document.body.classList.remove('print-picturebook');
        document.documentElement.classList.remove('print-doc-unclip');
        const r = document.getElementById('pb-print-root');
        if (r) r.remove();
        window.removeEventListener('afterprint', cleanup);
      };
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

  return { buildPrintOrder, resolveStartKey, describeChoice, open };
});
