/* admin-manual.js — 교사·학생 상세 설명서(화면형) (ADMIN-REDESIGN Phase 3, 2026-07-09).
   window.AdminManual.open(which): 관리 화면에서 여는 전체화면 설명서 오버레이.
   · 교사: 계정 만들기 → 로그인 → AI 권한 부여 → 모둠 만들기 → 작품 관리 → 인쇄 → 마무리 활동.
   · 학생: 입장 → 이야기 만들기 → 가지(브랜치) → 그림 → AI → 마무리 → 감상.
   · 프로그램에 뜨는 짧은 튜토리얼과 별개로, '처음 하는 사람'이 순서대로 따라 할 수 있는 매뉴얼.
   · 저장 0·DB 0. 인쇄는 브라우저 인쇄(오버레이 자체를 @media print로 정리). */
;(function () {
  'use strict';
  var OVERLAY_ID = 'admin-manual-overlay';

  /* ── 콘텐츠 ── */
  var TEACHER = {
    icon: '👩‍🏫', title: '교사 설명서 — 처음부터 끝까지',
    intro: '처음 쓰신다면 아래 순서대로 한 번만 따라 하면 돼요. ⭐ 표시는 꼭 확인할 부분이에요.',
    sections: [
      { n: 1, h: '교사 계정 만들기', steps: [
        '첫 화면에서 “교사 로그인”으로 들어가요. (주소로는 maker.html?admin=1)',
        '구글 계정으로 로그인하거나, 이메일로 가입해요. 처음 로그인하면 교사 계정이 자동으로 만들어져요.',
        '학교/기관 안내에 따라 승인 도메인 등록이 필요할 수 있어요(안 되면 관리자에게 문의).',
      ] },
      { n: 2, h: '관리 화면 들어가기', steps: [
        '로그인하면 “교사 관리” 화면이 열려요.',
        '왼쪽 메뉴에서 “팀·작품”(학생 모둠·작품 관리)과 “학급 설정”(AI·팀 생성 방식)을 오갈 수 있어요.',
        '나갈 때는 오른쪽 위 X(→ 첫 화면)로 나가요.',
      ] },
      { n: 3, h: 'AI 기능 켜기 (권한 부여)', warn: true, steps: [
        '“학급 설정” → 🤖 학급 AI 설정으로 가요.',
        '⭐ 먼저 “AI 전체”를 켜고, 그 아래에서 쓰고 싶은 기능(예: “AI 그림책 마감”)도 각각 켜요.',
        '⭐ “전체”만 켜고 개별 기능을 안 켜면 학생·교사 모두 “권한 없음”이 떠요. 둘 다 켜야 해요.',
        '마지막에 꼭 “저장”을 눌러야 학생에게 적용돼요. (‘AI 그림책 마감’은 교사용이며 학생 그림이 외부 AI로 전송될 수 있어요.)',
      ] },
      { n: 4, h: '모둠(학생 계정) 미리 만들기', steps: [
        '“팀·작품” → 👥 학생/팀 계정 미리 만들기.',
        '팀 이름과 PIN(숫자 4~6자리)을 정해 “팀 만들기”. PIN은 🎲 자동으로도 만들 수 있어요.',
        '🖨 입장 카드 인쇄로 클래스 코드·모둠 이름·PIN을 뽑아 학생에게 나눠줘요.',
      ] },
      { n: 5, h: '학생 작품 관리하기', steps: [
        '팀 목록에서 모둠마다 🛠 수정(선생님은 PIN 없이 바로 편집)·▶ 감상·🖨 그림책 인쇄를 쓸 수 있어요.',
        '편집 화면에서 왼쪽 위 “← 관리로”를 누르면 다시 관리 화면으로 돌아와요.',
      ] },
      { n: 6, h: '인쇄물', steps: [
        '그림책 인쇄: 장면을 화면 그대로(그림·말풍선) 책처럼 뽑아요. 관리 ⋯ 메뉴 또는 팀별 🖨.',
        '고쳐쓰기 자료·입장 카드·이 설명서도 인쇄할 수 있어요.',
      ] },
      { n: 7, h: '작품 마무리 활동 (AI)', steps: [
        '학생이 “📁 작품 마무리”를 누르면 질문 만들기 → 작품 검사 → 직접 고치기 → 마지막 다듬기가 한 흐름으로 열려요.',
        '선생님이 3번에서 켠 기능만 학생에게 보여요.',
      ] },
    ],
  };

  var STUDENT = {
    icon: '🧒', title: '학생 설명서 — 이야기 만들기',
    intro: '선생님이 준 카드(클래스 코드·모둠·PIN)를 준비해요.',
    sections: [
      { n: 1, h: '입장하기', steps: [
        '클래스 코드, 모둠 이름, PIN을 차례로 입력해요.',
        'PIN은 선생님이 준 카드에 적혀 있어요.',
      ] },
      { n: 2, h: '이야기 만들기', steps: [
        '“+ 장면 추가”로 장면을 만들고, 글상자에 이야기를 써요.',
        '장면 그림·글자 크기·꾸미기도 바꿀 수 있어요.',
      ] },
      { n: 3, h: '가지(갈래) 만들기', steps: [
        '행동 버튼(선택지)을 만들어 다음 장면과 연결하면 이야기가 여러 갈래로 갈라져요.',
        '한 장면에서 두세 갈래로 이어지게 만들 수 있어요.',
      ] },
      { n: 4, h: '그림 넣기', steps: [
        '“직접 그리기”(그림판)로 그리거나, 사진·그림을 올려요.',
        '그림은 3:2 화면에 맞춰져요.',
      ] },
      { n: 5, h: 'AI 기능 (선생님이 켠 것만)', steps: [
        '글 다듬기·작품 검사·AI 그림책 마감 같은 도움을 받을 수 있어요.',
        '내가 쓴 원본·그린 그림은 항상 그대로 남아요.',
      ] },
      { n: 6, h: '작품 마무리', steps: [
        '“📁 작품 마무리”에서 질문에 답하고, 검사 결과로 고칠 곳을 찾아 직접 고쳐요.',
      ] },
      { n: 7, h: '감상하기', steps: [
        '완성한 이야기를 처음부터 선택지를 따라가며 읽어요.',
      ] },
    ],
  };

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function _sectionHtml(sec) {
    var steps = sec.steps.map(function (t) {
      return '<li class="am-step">' + _esc(t) + '</li>';
    }).join('');
    return '<section class="am-sec' + (sec.warn ? ' am-sec--warn' : '') + '">'
      + '<h3 class="am-sec-h"><span class="am-sec-n">' + sec.n + '</span>' + _esc(sec.h) + '</h3>'
      + '<ol class="am-steps">' + steps + '</ol>'
      + '</section>';
  }

  function _deckHtml(deck) {
    return '<div class="am-deck">'
      + '<div class="am-deck-head"><span class="am-deck-icon">' + deck.icon + '</span>'
      + '<div><div class="am-deck-title">' + _esc(deck.title) + '</div>'
      + '<div class="am-deck-intro">' + _esc(deck.intro) + '</div></div></div>'
      + deck.sections.map(_sectionHtml).join('')
      + '</div>';
  }

  function _styleTag() {
    return '<style>'
      + '#' + OVERLAY_ID + '{position:fixed;inset:0;z-index:100060;background:#f7efdd;overflow:auto;font-family:inherit;color:#4a3a22;}'
      + '#' + OVERLAY_ID + ' .am-wrap{max-width:760px;margin:0 auto;padding:20px 18px 60px;}'
      + '#' + OVERLAY_ID + ' .am-top{position:sticky;top:0;background:#f7efdd;display:flex;align-items:center;gap:10px;padding:8px 0 12px;border-bottom:1px solid #e3d4bd;z-index:2;}'
      + '#' + OVERLAY_ID + ' .am-title{font-size:18px;font-weight:800;color:#3a2c14;}'
      + '#' + OVERLAY_ID + ' .am-tabs{display:flex;gap:8px;margin-left:auto;}'
      + '#' + OVERLAY_ID + ' .am-tab{padding:8px 14px;border-radius:20px;border:1px solid #d9c39a;background:#fffdf7;color:#8a6a30;font-size:14px;font-weight:700;cursor:pointer;}'
      + '#' + OVERLAY_ID + ' .am-tab.is-active{background:#c66f4a;color:#fffaee;border-color:#c66f4a;}'
      + '#' + OVERLAY_ID + ' .am-btn{padding:8px 14px;border-radius:10px;border:none;background:#6a8a5b;color:#fff;font-size:14px;font-weight:700;cursor:pointer;}'
      + '#' + OVERLAY_ID + ' .am-btn--ghost{background:transparent;border:1px solid #d9c39a;color:#8a6a30;}'
      + '#' + OVERLAY_ID + ' .am-deck-head{display:flex;gap:12px;align-items:flex-start;margin:16px 0 6px;}'
      + '#' + OVERLAY_ID + ' .am-deck-icon{font-size:30px;line-height:1;}'
      + '#' + OVERLAY_ID + ' .am-deck-title{font-size:17px;font-weight:800;color:#3a2c14;}'
      + '#' + OVERLAY_ID + ' .am-deck-intro{font-size:13px;color:#6b5638;margin-top:3px;line-height:1.5;}'
      + '#' + OVERLAY_ID + ' .am-sec{background:#fffdf7;border:1px solid #e6d8bb;border-radius:14px;padding:14px 16px;margin:12px 0;box-shadow:0 1px 3px rgba(120,95,50,.08);}'
      + '#' + OVERLAY_ID + ' .am-sec--warn{background:#fff7e8;border-color:#f0c98a;}'
      + '#' + OVERLAY_ID + ' .am-sec-h{display:flex;align-items:center;gap:9px;font-size:15px;font-weight:800;color:#3a2c14;margin:0 0 8px;}'
      + '#' + OVERLAY_ID + ' .am-sec-n{flex:0 0 auto;width:24px;height:24px;border-radius:50%;background:#c66f4a;color:#fffaee;display:flex;align-items:center;justify-content:center;font-size:13px;}'
      + '#' + OVERLAY_ID + ' .am-sec--warn .am-sec-n{background:#e0940c;}'
      + '#' + OVERLAY_ID + ' .am-steps{margin:0;padding-left:22px;}'
      + '#' + OVERLAY_ID + ' .am-step{font-size:14px;line-height:1.7;color:#4a3a22;margin:3px 0;}'
      + '#' + OVERLAY_ID + ' .am-deck[data-which="teacher"]{display:none;}'
      + '#' + OVERLAY_ID + '.show-student .am-deck[data-which="teacher"]{display:none;}'
      + '#' + OVERLAY_ID + '.show-student .am-deck[data-which="student"]{display:block;}'
      + '#' + OVERLAY_ID + '.show-teacher .am-deck[data-which="teacher"]{display:block;}'
      + '#' + OVERLAY_ID + '.show-teacher .am-deck[data-which="student"]{display:none;}'
      + '@media print{'
      + '  body > *:not(#' + OVERLAY_ID + '){display:none !important;}'
      + '  #' + OVERLAY_ID + '{position:static;background:#fff;overflow:visible;}'
      + '  #' + OVERLAY_ID + ' .am-top{position:static;border:none;}'
      + '  #' + OVERLAY_ID + ' .am-tabs,#' + OVERLAY_ID + ' .am-btn{display:none !important;}'
      + '  #' + OVERLAY_ID + ' .am-deck{display:block !important;}'
      + '  #' + OVERLAY_ID + ' .am-sec{break-inside:avoid;box-shadow:none;}'
      + '  #' + OVERLAY_ID + ' .am-sec--warn,#' + OVERLAY_ID + ' .am-sec-n{-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
      + '}'
      + '</style>';
  }

  function open(which) {
    if (typeof document === 'undefined' || !document.body) return;
    var old = document.getElementById(OVERLAY_ID);
    if (old) old.remove();
    var el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.className = (which === 'student') ? 'show-student' : 'show-teacher';
    el.innerHTML = _styleTag()
      + '<div class="am-wrap">'
      + '  <div class="am-top">'
      + '    <div class="am-title">📖 설명서</div>'
      + '    <div class="am-tabs">'
      + '      <button type="button" class="am-tab" data-tab="teacher">👩‍🏫 교사</button>'
      + '      <button type="button" class="am-tab" data-tab="student">🧒 학생</button>'
      + '      <button type="button" class="am-btn am-btn--ghost" data-act="print">🖨 인쇄</button>'
      + '      <button type="button" class="am-btn" data-act="close">닫기</button>'
      + '    </div>'
      + '  </div>'
      + '  <div class="am-deck" data-which="teacher">' + _deckHtml(TEACHER) + '</div>'
      + '  <div class="am-deck" data-which="student">' + _deckHtml(STUDENT) + '</div>'
      + '</div>';
    document.body.appendChild(el);

    function setTab(w) {
      el.className = (w === 'student') ? 'show-student' : 'show-teacher';
      el.querySelectorAll('.am-tab').forEach(function (t) {
        t.classList.toggle('is-active', t.getAttribute('data-tab') === w);
      });
      el.scrollTop = 0;
    }
    setTab(which === 'student' ? 'student' : 'teacher');

    el.querySelectorAll('.am-tab').forEach(function (t) {
      t.addEventListener('click', function () { setTab(t.getAttribute('data-tab')); });
    });
    el.querySelector('[data-act="close"]').addEventListener('click', function () { el.remove(); });
    el.querySelector('[data-act="print"]').addEventListener('click', function () {
      try { window.print(); } catch (e) { /* noop */ }
    });
    document.addEventListener('keydown', function onEsc(ev) {
      if (ev.key === 'Escape') { var o = document.getElementById(OVERLAY_ID); if (o) o.remove(); document.removeEventListener('keydown', onEsc); }
    });
  }

  if (typeof window !== 'undefined') window.AdminManual = { open: open };
})();
