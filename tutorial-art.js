/* tutorial-art.js — 튜토리얼 삽화(SVG) 모음 (TUTORIAL-PRD 품질 업그레이드 2026-07-07).
   window.TutorialArt.get(id) → 인라인 SVG 문자열. 이모지 대신 앱 개념을 직접 그림.
   팔레트: 코랄 #c66f4a · 크림 #fbf6ea/#fffdf7 · 갈색 #6b5638 · 초록 #7bae6e · 하늘 #cфe4f2 대체 #cfe4f2.
   viewBox 220x140 통일. 저학년 친화 — 둥근 모양·부드러운 색. DOM/의존 0(순수 데이터). */
;(function () {
  'use strict';
  const C = { coral: '#c66f4a', coralL: '#e69277', cream: '#fbf6ea', card: '#fffdf7',
    brown: '#6b5638', ink: '#3a2c14', green: '#7bae6e', greenL: '#cfe6c2',
    sky: '#bcdcef', sun: '#f2c94c', line: '#e6d6ba', mut: '#a8946e' };

  function _wrap(inner, label) {
    return `<svg viewBox="0 0 220 140" role="img" aria-label="${label || ''}" xmlns="http://www.w3.org/2000/svg"
      style="width:100%;height:auto;display:block;">${inner}</svg>`;
  }
  const bg = `<rect x="0" y="0" width="220" height="140" rx="14" fill="${C.cream}"/>`;

  /* 재사용: 작은 장면 카드(그림+글줄) */
  function sceneCard(x, y, w, h, opt) {
    opt = opt || {};
    const imgH = Math.round(h * 0.52);
    return `
      <g>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${C.card}" stroke="${C.line}" stroke-width="1.5"/>
        <rect x="${x + 5}" y="${y + 5}" width="${w - 10}" height="${imgH}" rx="5" fill="${opt.imgFill || C.greenL}"/>
        ${opt.sun ? `<circle cx="${x + w - 14}" cy="${y + 13}" r="5" fill="${C.sun}"/>` : ''}
        ${opt.tree ? `<path d="M${x + 12} ${y + imgH} l6 -14 l6 14 z" fill="${C.green}"/><rect x="${x + 14}" y="${y + imgH - 4}" width="4" height="4" fill="${C.brown}"/>` : ''}
        ${opt.face ? `<circle cx="${x + w / 2}" cy="${y + imgH / 2 + 2}" r="9" fill="#ffd9a0"/><circle cx="${x + w / 2 - 3}" cy="${y + imgH / 2}" r="1.3" fill="${C.ink}"/><circle cx="${x + w / 2 + 3}" cy="${y + imgH / 2}" r="1.3" fill="${C.ink}"/><path d="M${x + w / 2 - 3} ${y + imgH / 2 + 4} q3 3 6 0" stroke="${C.ink}" stroke-width="1" fill="none"/>` : ''}
        <rect x="${x + 6}" y="${y + imgH + 9}" width="${w - 20}" height="3.5" rx="1.8" fill="${C.line}"/>
        <rect x="${x + 6}" y="${y + imgH + 16}" width="${w - 30}" height="3.5" rx="1.8" fill="${C.line}"/>
      </g>`;
  }

  const ART = {
    /* 들어가기 — 입장 카드 + 3칸(코드/모둠/PIN) + 열쇠 */
    enter: _wrap(`${bg}
      <rect x="46" y="20" width="128" height="100" rx="12" fill="${C.card}" stroke="${C.line}" stroke-width="2"/>
      <text x="110" y="40" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="700" fill="${C.ink}">들어가기</text>
      <g font-family="sans-serif" font-size="9" fill="${C.mut}">
        <rect x="60" y="48" width="100" height="16" rx="8" fill="${C.cream}" stroke="${C.line}"/><text x="66" y="59">클래스 코드  ABC12</text>
        <rect x="60" y="70" width="100" height="16" rx="8" fill="${C.cream}" stroke="${C.line}"/><text x="66" y="81">모둠 이름  2모둠</text>
        <rect x="60" y="92" width="100" height="16" rx="8" fill="${C.cream}" stroke="${C.line}"/><text x="66" y="103">비밀번호  ● ● ● ●</text>
      </g>
      <g transform="translate(28,64) rotate(-20)"><circle cx="0" cy="0" r="7" fill="none" stroke="${C.coral}" stroke-width="3"/><rect x="5" y="-2" width="16" height="4" fill="${C.coral}"/><rect x="17" y="2" width="4" height="6" fill="${C.coral}"/></g>`, '입장 화면'),

    /* 작품 고르기 — 2x2 카드 */
    ptype: _wrap(`${bg}
      ${[[C.greenL, '📖'], [C.coralL, '🎬'], [C.sky, '🖼️'], [C.sun, '✋']].map((m, i) => {
        const x = 40 + (i % 2) * 78, y = 24 + Math.floor(i / 2) * 50;
        return `<rect x="${x}" y="${y}" width="66" height="40" rx="9" fill="${C.card}" stroke="${C.line}" stroke-width="1.5"/><rect x="${x}" y="${y}" width="66" height="12" rx="9" fill="${m[0]}"/><rect x="${x}" y="${y + 6}" width="66" height="6" fill="${m[0]}"/><text x="${x + 33}" y="${y + 30}" text-anchor="middle" font-size="15">${m[1]}</text>`;
      }).join('')}
      <text x="110" y="16" text-anchor="middle" font-family="sans-serif" font-size="10" fill="${C.brown}">골라요</text>`, '작품 유형 고르기'),

    /* 생각 나침반 — 나침반 + 생각 물방울 */
    compass: _wrap(`${bg}
      <circle cx="92" cy="78" r="34" fill="${C.card}" stroke="${C.coral}" stroke-width="3"/>
      <circle cx="92" cy="78" r="4" fill="${C.coral}"/>
      <path d="M92 50 L100 78 L92 106 L84 78 Z" fill="${C.coral}"/>
      <path d="M92 50 L100 78 L92 78 Z" fill="${C.coralL}"/>
      <text x="92" y="44" text-anchor="middle" font-size="9" fill="${C.brown}">N</text>
      <g><ellipse cx="158" cy="44" rx="30" ry="20" fill="${C.card}" stroke="${C.line}" stroke-width="1.5"/><circle cx="134" cy="62" r="4" fill="${C.card}" stroke="${C.line}"/><circle cx="128" cy="70" r="2.5" fill="${C.card}" stroke="${C.line}"/><text x="158" y="48" text-anchor="middle" font-size="15">💭</text></g>`, '생각 나침반'),

    /* 장면 만들기 — 큰 장면 카드(해·나무·글줄) + 연필 */
    scene: _wrap(`${bg}
      ${sceneCard(58, 22, 104, 96, { sun: true, tree: true })}
      <g transform="translate(150,96) rotate(35)"><rect x="0" y="0" width="6" height="26" fill="${C.sun}"/><path d="M0 26 l3 6 l3 -6 z" fill="${C.ink}"/><rect x="0" y="0" width="6" height="5" fill="${C.coral}"/></g>`, '장면 만들기'),

    /* ★ 갈래 잇기 — 위 1장 → 선택지 2개 → (아래 화살표) → 다음 장면 2개.
       화살표는 버튼 '아래'에서 다음 카드로만 내려가 글씨를 가리지 않음. */
    branch: _wrap(`${bg}
      ${sceneCard(82, 6, 56, 36, { tree: true })}
      <path d="M110 42 C96 46 78 46 61 50" stroke="${C.line}" stroke-width="1.5" fill="none"/>
      <path d="M110 42 C124 46 142 46 159 50" stroke="${C.line}" stroke-width="1.5" fill="none"/>
      <g font-family="sans-serif" font-size="8" font-weight="700">
        <rect x="30" y="50" width="62" height="16" rx="8" fill="${C.coral}"/><text x="61" y="61" text-anchor="middle" fill="#fff">🌲 숲으로</text>
        <rect x="128" y="50" width="62" height="16" rx="8" fill="${C.green}"/><text x="159" y="61" text-anchor="middle" fill="#fff">🏠 집으로</text>
      </g>
      <path d="M61 68 L61 80" stroke="${C.coral}" stroke-width="2.5" fill="none" marker-end="url(#ah1)"/>
      <path d="M159 68 L159 80" stroke="${C.green}" stroke-width="2.5" fill="none" marker-end="url(#ah2)"/>
      <defs>
        <marker id="ah1" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 z" fill="${C.coral}"/></marker>
        <marker id="ah2" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 z" fill="${C.green}"/></marker>
      </defs>
      ${sceneCard(33, 84, 56, 48, { imgFill: '#e7d3c4', face: true })}
      ${sceneCard(131, 84, 56, 48, { imgFill: C.sky })}`, '이야기 갈래 잇기'),

    /* 저장 — 구름 체크 */
    save: _wrap(`${bg}
      <g transform="translate(66,44)">
        <path d="M20 44 a20 20 0 0 1 4 -39 a24 24 0 0 1 46 6 a18 18 0 0 1 -4 33 z" fill="${C.card}" stroke="${C.line}" stroke-width="2"/>
        <path d="M30 26 l9 10 l18 -20" stroke="${C.green}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </g>
      <text x="110" y="126" text-anchor="middle" font-family="sans-serif" font-size="10" fill="${C.brown}">자동으로 저장돼요</text>`, '자동 저장'),

    /* 감상 — 태블릿 안 장면+선택지, 손가락 탭 */
    play: _wrap(`${bg}
      <rect x="52" y="20" width="116" height="100" rx="12" fill="${C.ink}"/>
      <rect x="58" y="26" width="104" height="88" rx="6" fill="${C.card}"/>
      <rect x="64" y="32" width="92" height="40" rx="4" fill="${C.greenL}"/><circle cx="146" cy="42" r="5" fill="${C.sun}"/>
      <rect x="64" y="80" width="44" height="13" rx="6.5" fill="${C.coral}"/><rect x="112" y="80" width="44" height="13" rx="6.5" fill="${C.green}"/>
      <g transform="translate(120,92)"><ellipse cx="6" cy="16" rx="8" ry="5" fill="#00000022"/><path d="M0 0 q0 -10 6 -10 q6 0 6 10 l0 6 q-6 4 -12 0 z" fill="#ffd9a0" stroke="${C.brown}" stroke-width="1"/></g>`, '감상하기'),

    /* AI 도움받기 — 낙서 → 반짝임 완성 (POLISH-ART: 좌우 25/25 여백 대칭으로 재배치 — 오른쪽 치우침 해소) */
    ai: _wrap(`${bg}
      ${sceneCard(25, 30, 60, 80, { imgFill: '#efe6da' })}
      <path d="M95 70 h30" stroke="${C.mut}" stroke-width="2" marker-end="url(#aiar)"/>
      <defs><marker id="aiar" markerWidth="7" markerHeight="7" refX="4" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 z" fill="${C.mut}"/></marker></defs>
      ${sceneCard(135, 30, 60, 80, { sun: true, tree: true, imgFill: C.greenL })}
      <g fill="${C.sun}"><path d="M110 46 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 z"/><path d="M171 22 l1.5 4 l4 1.5 l-4 1.5 l-1.5 4 l-1.5 -4 l-4 -1.5 l4 -1.5 z"/></g>`, 'AI 도움받기'),

    /* 글 바로 고치기 — 글줄 + 연필/커서 */
    editText: _wrap(`${bg}
      <rect x="46" y="26" width="128" height="88" rx="10" fill="${C.card}" stroke="${C.line}" stroke-width="2"/>
      <rect x="60" y="42" width="70" height="6" rx="3" fill="${C.ink}"/>
      <rect x="60" y="58" width="96" height="5" rx="2.5" fill="${C.line}"/>
      <rect x="60" y="72" width="72" height="5" rx="2.5" fill="${C.line}"/>
      <rect x="60" y="86" width="86" height="5" rx="2.5" fill="${C.line}"/>
      <rect x="134" y="55" width="2" height="12" fill="${C.coral}"/>
      <g transform="translate(150,74) rotate(35)"><rect x="0" y="0" width="7" height="30" fill="${C.sun}"/><path d="M0 30 l3.5 7 l3.5 -7 z" fill="${C.ink}"/><rect x="0" y="0" width="7" height="6" fill="${C.coral}"/></g>`, '글 바로 고치기'),

    /* 그림 도구 — 사진 프레임 + 연필 + 자르기 모서리 */
    imageTools: _wrap(`${bg}
      <rect x="56" y="24" width="108" height="80" rx="8" fill="${C.greenL}" stroke="${C.line}" stroke-width="2"/>
      <circle cx="146" cy="40" r="7" fill="${C.sun}"/>
      <path d="M64 96 l16 -30 l14 22 l10 -14 l16 22 z" fill="${C.green}"/>
      <g stroke="${C.coral}" stroke-width="3" fill="none">
        <path d="M52 30 v-8 h8"/><path d="M168 30 v-8 h-8"/><path d="M52 98 v8 h8"/><path d="M168 98 v8 h-8"/>
      </g>
      <g transform="translate(150,84) rotate(35)"><rect x="0" y="0" width="6" height="24" fill="${C.card}" stroke="${C.brown}"/><path d="M0 24 l3 6 l3 -6 z" fill="${C.ink}"/></g>`, '그림 도구'),

    /* 글상자 다루기 — 무대 위 반투명 글상자 + ✥ 이동/모서리 핸들 */
    bodybox: _wrap(`${bg}
      <rect x="40" y="20" width="140" height="100" rx="10" fill="${C.greenL}"/>
      <circle cx="158" cy="36" r="7" fill="${C.sun}"/><path d="M44 118 l18 -30 l14 20 z" fill="${C.green}"/>
      <rect x="66" y="60" width="90" height="42" rx="7" fill="#ffffffcc" stroke="${C.coral}" stroke-width="2" stroke-dasharray="5 4"/>
      <rect x="74" y="70" width="60" height="4" rx="2" fill="${C.line}"/><rect x="74" y="80" width="44" height="4" rx="2" fill="${C.line}"/>
      <circle cx="111" cy="81" r="9" fill="${C.coral}"/><text x="111" y="85" text-anchor="middle" font-size="10" fill="#fff">✥</text>
      <g fill="${C.coral}"><rect x="62" y="56" width="7" height="7" rx="1.5"/><rect x="153" y="56" width="7" height="7" rx="1.5"/><rect x="62" y="98" width="7" height="7" rx="1.5"/><rect x="153" y="98" width="7" height="7" rx="1.5"/></g>`, '글상자 다루기'),

    /* 꾸미기 — 큰 Aa + 색 스와치 + 슬라이더 (POLISH-ART: 두 덩어리를 캔버스 중심축에 정렬 — 여백 균형) */
    style: _wrap(`${bg}
      <text x="38" y="86" font-family="serif" font-size="54" font-weight="800" fill="${C.coral}">Aa</text>
      <g><circle cx="130" cy="46" r="9" fill="${C.coral}"/><circle cx="152" cy="46" r="9" fill="${C.green}"/><circle cx="174" cy="46" r="9" fill="${C.sky}"/><circle cx="130" cy="68" r="9" fill="${C.sun}"/><circle cx="152" cy="68" r="9" fill="${C.brown}"/><circle cx="174" cy="68" r="9" fill="${C.ink}"/></g>
      <rect x="124" y="92" width="56" height="6" rx="3" fill="${C.line}"/><circle cx="150" cy="95" r="7" fill="${C.coral}"/>`, '글자·색 꾸미기'),

    /* 무비 — 태블릿 속 재생 삼각형 + 타임라인 */
    movie: _wrap(`${bg}
      <rect x="48" y="26" width="124" height="76" rx="10" fill="${C.ink}"/>
      <rect x="54" y="32" width="112" height="52" rx="5" fill="${C.sky}"/>
      <circle cx="110" cy="58" r="16" fill="#ffffffdd"/><path d="M104 50 l14 8 l-14 8 z" fill="${C.coral}"/>
      <rect x="54" y="90" width="112" height="6" rx="3" fill="#ffffff55"/><rect x="54" y="90" width="44" height="6" rx="3" fill="${C.coral}"/>
      <g fill="${C.sun}"><rect x="42" y="30" width="6" height="68" rx="2"/><rect x="172" y="30" width="6" height="68" rx="2"/></g>`, '무비 편집'),

    /* 작품 설정 — 톱니 + 슬라이더 두 줄 */
    settings: _wrap(`${bg}
      <g transform="translate(74,70)"><circle r="24" fill="none" stroke="${C.coral}" stroke-width="7"/><circle r="9" fill="${C.coral}"/>${[0,45,90,135,180,225,270,315].map(a=>`<rect x="-4" y="-34" width="8" height="12" rx="2" fill="${C.coral}" transform="rotate(${a})"/>`).join('')}</g>
      <g><rect x="118" y="52" width="66" height="7" rx="3.5" fill="${C.line}"/><circle cx="150" cy="55.5" r="8" fill="${C.green}"/>
         <rect x="118" y="82" width="66" height="7" rx="3.5" fill="${C.line}"/><circle cx="170" cy="85.5" r="8" fill="${C.coral}"/></g>`, '작품 설정'),

    /* 환영 히어로 — 가지가 갈라지는 나무(브랜딩) */
    welcomeHero: _wrap(`${bg}
      <rect x="104" y="80" width="12" height="44" rx="4" fill="${C.brown}"/>
      <path d="M110 84 C110 60 78 58 66 40" stroke="${C.brown}" stroke-width="7" fill="none" stroke-linecap="round"/>
      <path d="M110 84 C110 60 142 58 154 40" stroke="${C.brown}" stroke-width="7" fill="none" stroke-linecap="round"/>
      <path d="M110 96 C110 78 92 74 84 62" stroke="${C.brown}" stroke-width="5" fill="none" stroke-linecap="round"/>
      <circle cx="62" cy="36" r="15" fill="${C.green}"/><circle cx="158" cy="36" r="15" fill="${C.coral}"/><circle cx="80" cy="58" r="11" fill="${C.greenL}"/>
      <circle cx="62" cy="36" r="5" fill="${C.card}"/><circle cx="158" cy="36" r="5" fill="${C.card}"/>`, '가지 — 갈라지는 이야기'),
  };

  function get(id) { return ART[id] || ''; }
  if (typeof window !== 'undefined') window.TutorialArt = { get: get, _ids: Object.keys(ART) };
  if (typeof module !== 'undefined' && module.exports) module.exports = { get: get };
})();
