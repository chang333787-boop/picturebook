/* tutorial-demo.js — 인터랙티브 미니 데모 (학교 하루, 재설계 2026-07-07).
   window.TutorialDemo.mount(container): "먼저 한 줄기로 끝까지 → 그다음 갈림길"을 몸으로 체감시킨다.
   ① 이야기 한 줄기(학교 하루 5장면)를 [다음 →]으로 끝까지 감상 → "🤔 여기서 다르게 했다면?"
   ② 결정 장면으로 돌아가 두 선택 → 다른 엔딩으로 갈라짐. 저장 0·의존 0·자체완결.
   저학년 대상: 큰 그림·짧은 문구·즉각 반응. Warm Paper 톤. */
;(function () {
  'use strict';
  const P = { coral: '#c66f4a', green: '#7bae6e', cream: '#fbf6ea', card: '#fffdf7',
    brown: '#6b5638', ink: '#3a2c14', line: '#e6d6ba', gold: '#c98a2e' };

  /* 한 줄기 이야기(학교 하루) — 5장면. 마지막은 엔딩. */
  const MAIN = [
    { emoji: '🏫', bg: '#dff0d6', text: '학교에 왔어요. 오늘은 어떤 하루가 될까요?' },
    { emoji: '👀', bg: '#fce8cf', text: '교실에 친구가 혼자 앉아 있어요.' },        /* 결정 장면 = index 1 */
    { emoji: '💬', bg: '#e7d3c4', text: '“같이 놀래?” 하고 먼저 말을 걸었어요.' },
    { emoji: '⚽', bg: '#d6e6f0', text: '쉬는 시간에 친구랑 신나게 뛰어놀았어요!' },
    { emoji: '🌈', bg: '#e6dff0', text: '참 즐거운 하루였어요. 끝!', ending: true },
  ];
  const BRANCH_AT = 1;   /* 이 장면에서 "다르게 했다면?" 갈림길이 갈라진다. */
  /* 갈림길: 결정 장면에서 '그냥 지나간다'를 골랐을 때의 다른 길(3장면·다른 엔딩). */
  const ALT = [
    { emoji: '😶', bg: '#e6e2da', text: '그냥 못 본 척 지나갔어요.' },
    { emoji: '🍂', bg: '#efe4d0', text: '쉬는 시간에 혼자 앉아 심심했어요.' },
    { emoji: '🌧️', bg: '#dbe0e8', text: '조금 외로운 하루였어요. 끝!', ending: true },
  ];

  function _sceneHtml(node, animate) {
    return `
      <div class="tdemo-scene"${animate ? ' style="animation:tdemoFade .35s ease;"' : ''}>
        <div class="tdemo-pic" style="background:${node.bg};">
          <span class="tdemo-emoji">${node.emoji}</span>
        </div>
        <div class="tdemo-text">${node.text}</div>
      </div>`;
  }

  function _injectStyle() {
    if (document.getElementById('tdemo-style')) return;
    const st = document.createElement('style');
    st.id = 'tdemo-style';
    st.textContent = `
      .tdemo-wrap{border:1.5px solid ${P.line};border-radius:14px;overflow:hidden;background:${P.card};max-width:320px;margin:0 auto;}
      .tdemo-banner{padding:7px 10px;font-size:12px;font-weight:700;color:${P.brown};background:${P.cream};border-bottom:1px solid ${P.line};text-align:center;}
      .tdemo-pic{height:118px;display:flex;align-items:center;justify-content:center;}
      .tdemo-emoji{font-size:60px;line-height:1;filter:drop-shadow(0 3px 3px rgba(0,0,0,.12));}
      .tdemo-text{padding:12px 14px 4px;font-size:14px;color:${P.ink};text-align:center;line-height:1.5;min-height:20px;}
      .tdemo-ctrl{padding:8px 12px 12px;}
      .tdemo-count{text-align:center;font-size:11px;color:${P.brown};margin:0 0 7px;}
      .tdemo-next{display:block;width:100%;padding:11px;border:none;border-radius:10px;background:${P.coral};color:#fffaee;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;}
      .tdemo-cta{display:block;width:100%;padding:11px;border:1.5px solid ${P.gold};border-radius:10px;background:#fff8ec;color:${P.gold};font-size:13.5px;font-weight:800;cursor:pointer;font-family:inherit;}
      .tdemo-prompt{text-align:center;font-size:12.5px;color:${P.brown};margin:0 0 8px;font-weight:600;}
      .tdemo-done{text-align:center;font-size:12.5px;color:#3b6d11;line-height:1.5;background:#eef6e2;border:1px solid #cfe3b0;border-radius:9px;padding:9px 10px;margin:0 0 9px;font-weight:600;}
      .tdemo-choices{display:flex;flex-direction:column;gap:8px;}
      .tdemo-btn{width:100%;padding:10px 10px;border:none;border-radius:10px;color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;text-align:center;line-height:1.35;}
      .tdemo-btn small{display:block;font-size:10px;font-weight:600;opacity:.85;margin-top:2px;}
      .tdemo-again{display:block;width:100%;padding:10px;border:1px solid ${P.line};border-radius:10px;background:transparent;color:${P.brown};font-size:12px;cursor:pointer;font-family:inherit;}
      .tdemo-hint{text-align:center;font-size:12px;color:${P.brown};margin:0 0 8px;}
      @keyframes tdemoFade{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}`;
    document.head.appendChild(st);
  }

  function mount(container) {
    if (!container) return;
    _injectStyle();

    container.innerHTML = '<div class="tdemo-hint">👇 눌러 보세요 — 먼저 한 줄기, 그다음 갈림길</div>';
    const wrap = document.createElement('div');
    wrap.className = 'tdemo-wrap';
    container.appendChild(wrap);

    /* wrap을 [배너 + 장면 + 컨트롤]로 다시 그린다. */
    function paint(banner, node, animate, controlsHtml, bind) {
      wrap.innerHTML =
        `<div class="tdemo-banner">${banner}</div>` +
        _sceneHtml(node, animate) +
        `<div class="tdemo-ctrl">${controlsHtml}</div>`;
      if (typeof bind === 'function') bind();
    }

    /* ① 한 줄기 — MAIN을 순서대로 감상. 마지막(엔딩)에서 갈림길 CTA. */
    function linear(i) {
      const node = MAIN[i];
      if (node.ending) {
        paint('① 이야기 한 줄기 — 완성! 🎉', node, i > 0,
          `<button class="tdemo-cta" type="button">🤔 그런데 여기서 다르게 했다면?</button>`,
          () => wrap.querySelector('.tdemo-cta').addEventListener('click', pick));
      } else {
        paint('① 이야기 한 줄기 만들기', node, i > 0,
          `<div class="tdemo-count">장면 ${i + 1} / ${MAIN.length}</div>
           <button class="tdemo-next" type="button">다음 →</button>`,
          () => wrap.querySelector('.tdemo-next').addEventListener('click', () => linear(i + 1)));
      }
    }

    /* ② 갈림길 — 결정 장면으로 돌아가 두 선택 제시. */
    function pick() {
      paint('② 갈림길 더하기', MAIN[BRANCH_AT], true,
        `<div class="tdemo-prompt">이 장면에서 어떻게 할까요?</div>
         <div class="tdemo-choices">
           <button class="tdemo-btn" style="background:${P.green};" data-go="main">💬 “같이 놀래?” 하고 말을 건다<small>우리가 만든 길</small></button>
           <button class="tdemo-btn" style="background:${P.coral};" data-go="alt">😶 그냥 지나간다<small>새 갈림길</small></button>
         </div>`,
        () => wrap.querySelectorAll('.tdemo-btn').forEach(b =>
          b.addEventListener('click', () => {
            if (b.getAttribute('data-go') === 'alt') walk(ALT, 0, '😶 지나친 길');
            else walk(MAIN, BRANCH_AT + 1, '💬 같이 논 길');
          })));
    }

    /* 고른 길을 끝까지 감상 → 다른 엔딩. 엔딩에서 처음부터 다시. */
    function walk(path, i, tag) {
      const node = path[i];
      if (node.ending) {
        paint(`② ${tag} — 다른 끝! ✨`, node, true,
          `<div class="tdemo-done">🌱 갈래를 더했더니 이야기가 달라졌어요! 여러분도 이렇게 만들어 봐요.</div>
           <button class="tdemo-again" type="button">↺ 처음부터 다시 해보기</button>`,
          () => wrap.querySelector('.tdemo-again').addEventListener('click', () => linear(0)));
      } else {
        paint(`② ${tag}`, node, true,
          `<button class="tdemo-next" type="button">다음 →</button>`,
          () => wrap.querySelector('.tdemo-next').addEventListener('click', () => walk(path, i + 1, tag)));
      }
    }

    linear(0);
  }

  if (typeof window !== 'undefined') window.TutorialDemo = { mount: mount };
})();
