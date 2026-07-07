/* tutorial-demo.js — 인터랙티브 미니 데모 (TUTORIAL-PRD 품질 업그레이드 2026-07-07).
   window.TutorialDemo.mount(container): "고르면 이야기가 갈라진다"를 2번 탭으로 체감.
   시작 장면 → 두 선택지 → 각각 다른 다음 장면(페이드 전환) → [다시 해보기]. 저장 0·의존 0·자체완결.
   저학년 대상: 큰 그림·짧은 문구·즉각 반응. Warm Paper 톤. */
;(function () {
  'use strict';
  const P = { coral: '#c66f4a', green: '#7bae6e', cream: '#fbf6ea', card: '#fffdf7',
    brown: '#6b5638', ink: '#3a2c14', line: '#e6d6ba' };

  /* 데모 이야기(3장): 시작 → 숲/집 분기 */
  const START = { emoji: '🐰', bg: '#dff0d6', text: '토끼가 갈림길에 섰어요. 어디로 갈까요?' };
  const NEXT = {
    forest: { emoji: '🦊', bg: '#e7d3c4', text: '숲으로 갔더니 친구 여우를 만났어요!' },
    home:   { emoji: '🌙', bg: '#cdd8ef', text: '집으로 갔더니 포근하게 쉴 수 있었어요.' },
  };

  function _scene(node, animate) {
    return `
      <div class="tdemo-scene"${animate ? ' style="animation:tdemoFade .35s ease;"' : ''}>
        <div class="tdemo-pic" style="background:${node.bg};">
          <span class="tdemo-emoji">${node.emoji}</span>
        </div>
        <div class="tdemo-text">${node.text}</div>
      </div>`;
  }

  function mount(container) {
    if (!container) return;
    /* 스타일 1회 주입 */
    if (!document.getElementById('tdemo-style')) {
      const st = document.createElement('style');
      st.id = 'tdemo-style';
      st.textContent = `
        .tdemo-wrap{border:1.5px solid ${P.line};border-radius:14px;overflow:hidden;background:${P.card};max-width:320px;margin:0 auto;}
        .tdemo-scene{}
        .tdemo-pic{height:120px;display:flex;align-items:center;justify-content:center;}
        .tdemo-emoji{font-size:64px;line-height:1;filter:drop-shadow(0 3px 3px rgba(0,0,0,.12));}
        .tdemo-text{padding:12px 14px;font-size:14px;color:${P.ink};text-align:center;line-height:1.5;min-height:20px;}
        .tdemo-choices{display:flex;gap:8px;padding:0 12px 12px;}
        .tdemo-btn{flex:1;padding:11px 6px;border:none;border-radius:10px;color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;}
        .tdemo-again{display:block;width:calc(100% - 24px);margin:0 12px 12px;padding:10px;border:1px solid ${P.line};border-radius:10px;background:transparent;color:${P.brown};font-size:12px;cursor:pointer;font-family:inherit;}
        .tdemo-hint{text-align:center;font-size:12px;color:${P.brown};margin:0 0 8px;}
        @keyframes tdemoFade{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}`;
      document.head.appendChild(st);
    }

    const wrap = document.createElement('div');
    wrap.className = 'tdemo-wrap';
    container.innerHTML = '<div class="tdemo-hint">👇 버튼을 눌러 보세요 — 고르는 대로 이야기가 달라져요</div>';
    container.appendChild(wrap);

    function renderStart() {
      wrap.innerHTML = _scene(START, false) + `
        <div class="tdemo-choices">
          <button class="tdemo-btn" style="background:${P.coral};" data-go="forest">🌲 숲으로</button>
          <button class="tdemo-btn" style="background:${P.green};" data-go="home">🏠 집으로</button>
        </div>`;
      wrap.querySelectorAll('.tdemo-btn').forEach(b =>
        b.addEventListener('click', () => renderNext(b.getAttribute('data-go'))));
    }
    function renderNext(key) {
      const node = NEXT[key] || NEXT.forest;
      wrap.innerHTML = _scene(node, true) +
        `<button class="tdemo-again" type="button">↺ 다시 해보기 (다른 선택도 눌러 봐요)</button>`;
      wrap.querySelector('.tdemo-again').addEventListener('click', renderStart);
    }
    renderStart();
  }

  if (typeof window !== 'undefined') window.TutorialDemo = { mount: mount };
})();
