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
    const orig = (scene && scene.imageData) || null;
    try {
      if (typeof window !== 'undefined' && typeof window.getPublishedImageDisplaySrc === 'function') {
        return window.getPublishedImageDisplaySrc(scene, orig) || orig;
      }
    } catch (e) { /* 원본 fallback */ }
    return orig;
  }

  function open(opts) {
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

    const old = document.getElementById('pb-print-root');
    if (old) old.remove();
    const rootEl = _el('div', 'pb-print-root');
    rootEl.id = 'pb-print-root';

    /* ── 1p: 표지 ── */
    const coverScene = res.coverKey ? scenes[res.coverKey] : null;
    const coverPage = _el('div', 'pbp-page pbp-cover');
    coverPage.appendChild(_el('div', 'pbp-cover-tag', '표지'));
    coverPage.appendChild(_el('h1', 'pbp-cover-title', (coverScene && (coverScene.title || '').trim()) || title));
    if (coverScene && (coverScene.subtitle || '').trim()) coverPage.appendChild(_el('div', 'pbp-cover-sub', coverScene.subtitle.trim()));
    const coverImg = _publishedImage(coverScene);
    if (coverImg) { const im = document.createElement('img'); im.className = 'pbp-cover-img'; im.src = coverImg; coverPage.appendChild(im); }
    coverPage.appendChild(_el('div', 'pbp-cover-team', '만든 모둠: ' + title));
    /* PICTUREBOOK-PUBLISH-PRINT-1: 출판물 표지 날짜(인쇄 시점·저장 0) */
    const _d = new Date();
    coverPage.appendChild(_el('div', 'pbp-cover-date', _d.getFullYear() + '년 ' + (_d.getMonth() + 1) + '월 ' + _d.getDate() + '일'));
    rootEl.appendChild(coverPage);

    /* ── 2p: 이야기 길 지도(텍스트 목록형) ── */
    const mapPage = _el('div', 'pbp-page pbp-map');
    mapPage.appendChild(_el('h2', 'pbp-map-title', '🛤 이야기 길 지도'));
    mapPage.appendChild(_el('div', 'pbp-map-guide', '선택에 따라 다음 장면 번호로 이동하며 읽어요. 1번 장면부터 시작해요.'));
    res.order.forEach((k, idx) => {
      const s = scenes[k];
      const line = _el('div', 'pbp-map-line' + (idx >= res.reachableCount ? ' pbp-map-line--extra' : ''));
      const nEl = _el('span', 'pbp-map-num', res.numberByKey[k] + '번');
      line.appendChild(nEl);
      const t = (s.title || '').trim();
      const desc = t || ((_publishedBody(s) || '').trim().slice(0, 20) || '(빈 장면)');
      line.appendChild(_el('span', 'pbp-map-name', desc + (s.type === 'ending' ? ' 🏁' : '')));
      const chs = _choices(s);
      const gotos = chs.map(c => describeChoice(c, res.numberByKey).note.replace('→ ', '').replace('번 장면으로 가세요', '')).map(v => v === '(연결되지 않음)' ? '미연결' : v);
      line.appendChild(_el('span', 'pbp-map-goto', chs.length ? ('→ ' + gotos.join(', ')) : '끝'));
      mapPage.appendChild(line);
    });
    if (res.order.length > res.reachableCount) {
      mapPage.appendChild(_el('div', 'pbp-map-extra-note', '※ ' + (res.reachableCount + 1) + '번부터는 아직 큰길과 연결되지 않은 추가 장면이에요.'));
    }
    rootEl.appendChild(mapPage);

    /* ── 본문: 출판형 — 장면당 1페이지 (PICTUREBOOK-PUBLISH-PRINT-1) ──
       구 2장면/페이지(점검형 축소 카드)를 폐기하고 큰 그림+큰 글의 그림책 출판물로 전환.
       번호(BFS)·선택지 안내(describeChoice)·발행 헬퍼·gate는 그대로 재사용. */
    res.order.forEach((k) => {
      const s = scenes[k];
      const img = _publishedImage(s);
      const page = _el('div', 'pbp-page pbp-publish');
      const card = _el('div', 'pbp-scene pbp-scene--full' + (img ? '' : ' pbp-scene--noimg'));
      const head = _el('div', 'pbp-scene-head');
      head.appendChild(_el('span', 'pbp-scene-num', res.numberByKey[k] + '번 장면'));
      const flags = [];
      if (res.numberByKey[k] > res.reachableCount) flags.push('추가 장면');
      if (s.type === 'ending') flags.push('엔딩');
      if (flags.length) head.appendChild(_el('span', 'pbp-scene-flag', flags.join(' · ')));
      if ((s.title || '').trim()) head.appendChild(_el('span', 'pbp-scene-title', s.title.trim()));
      card.appendChild(head);
      if (img) { const im = document.createElement('img'); im.className = 'pbp-scene-img'; im.src = img; card.appendChild(im); }
      const body = (_publishedBody(s) || '').trim();
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
