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
        '첫 화면(branchstory.co.kr)에서 “수업 관리”로 들어가요. (주소로는 maker.html?admin=1)',
        '구글 계정으로 로그인하거나, 이메일로 가입해요. 처음 로그인하면 교사 계정이 자동으로 만들어져요.',
        '학교/기관 안내에 따라 승인 도메인 등록이 필요할 수 있어요(안 되면 관리자에게 문의).',
      ] },
      { n: 2, h: '관리 화면 둘러보기', steps: [
        '로그인하면 “교사 관리” 화면이 열려요. 왼쪽에 메뉴 네 개가 있어요.',
        '👥 팀·작품 — 학생 모둠과 작품을 보고 관리해요.',
        '⚙️ 학급 설정 — AI 권한, 우리 반 책장·댓글, 모둠 계정 만들기를 해요.',
        '📖 설명서·인쇄물 — 준비 가이드·학생 배부용 설명서·입장 카드를 뽑아요.',
        '🎬 대본 도우미 — 무비형 촬영 대본 초안을 AI로 만들어요.',
        '나갈 때는 왼쪽 아래 🌿 나가기(→ 첫 화면)로 나가요.',
      ] },
      { n: 3, h: 'AI 기능 켜기 (권한 부여)', warn: true, steps: [
        '“학급 설정” → 🤖 학급 AI 설정으로 가요.',
        '⭐ 먼저 “AI 전체”를 켜고, 그 아래에서 쓰고 싶은 기능을 각각 켜요 — 생각 점검 질문 · 작품 검사 · AI 장면발전 · AI 그림책 마감 · AI 이야기 초안.',
        '⭐ “전체”만 켜고 개별 기능을 안 켜면 학생·교사 모두 “권한 없음”이 떠요. 둘 다 켜야 해요.',
        '마지막에 꼭 “저장”을 눌러야 학생에게 적용돼요.',
        '⚠️ “AI 그림책 마감”은 교사용이며, 학생 그림이 외부 AI로 전송될 수 있어요 — 학교 안내·설정 후에 켜세요.',
      ] },
      { n: 4, h: '모둠(학생 계정) 만들기', steps: [
        '“학급 설정” → 👥 학생/팀 계정 미리 만들기.',
        '팀 이름과 PIN(숫자 4~6자리)을 정해 “팀 만들기”. PIN은 🎲 자동으로도 만들 수 있어요.',
        '반 전체는 📄 CSV로 한꺼번에 등록할 수 있어요.',
        '⭐ 학생은 선생님이 만들어 둔 모둠으로만 들어와요 — 오타·장난 모둠이 생기지 않아요.',
        '🖨 입장 카드 인쇄로 클래스 코드·모둠 이름·PIN을 뽑아 나눠 줘요. 필요한 모둠만 골라서 뽑을 수도 있어요.',
      ] },
      { n: 5, h: '학생 작품 관리하기 (공개·수정·감상)', steps: [
        '팀 목록에서 모둠마다 🛠 수정·▶️ 감상을 쓸 수 있어요. 선생님은 PIN 없이 바로 편집돼요.',
        '작품을 “공개”하면 감상 화면(뷰어)에서 볼 수 있어요. ▶️ 감상 버튼은 작품이 감상 가능(🟢)일 때 켜지고, 공개 전에는 🛠 수정으로 들어가 내용을 볼 수 있어요.',
        '🛠 수정으로 글·그림을 직접 고치고, 편집 화면 왼쪽 위 “← 관리로”로 다시 관리 화면으로 돌아와요.',
        '카드의 ⋯ 메뉴에는 PIN 바꾸기·잠금·인쇄·표시이름·감상 링크·복사 코드·댓글 관리가 모여 있어요.',
      ] },
      { n: 6, h: '표시 이름(닉네임) 정하기', steps: [
        '로그인용 “모둠 이름”과, 책장·작품에 보이는 “표시 이름”을 따로 정할 수 있어요.',
        '팀 카드의 ✏️ 표시이름으로 바꿔요 — 작품 데이터는 그대로 두고 보이는 이름만 바뀌어요.',
      ] },
      { n: 7, h: '우리 반 책장·댓글', steps: [
        '“학급 설정” → 📚 우리 반 책장·💬 댓글에서 켤 수 있어요.',
        '책장을 켜고 작품 “공개”를 켜면, 학생들이 클래스 코드만 넣고 서로의 작품을 감상해요.',
        '댓글은 “댓글 코드”가 있어야 남길 수 있어요(보는 건 자유). 코드를 바꾸면 이전 코드는 바로 무효가 돼요. 삭제는 각 팀 카드 ⋯의 💬 댓글 관리에서 해요.',
      ] },
      { n: 8, h: '감상 링크 공유하기', steps: [
        '작품 카드 ⋯의 🔗 감상 링크 복사를 누르면, 그 작품이 “공개”로 바뀌고 링크가 복사돼요.',
        '학급 책장도 📋 복사로 링크를 나눌 수 있어요.',
        '⚠️ 이 링크는 로그인·코드 없이 누구나 볼 수 있어요 — 학부모 공유 등에 쓰되 공개 범위에 유의하세요.',
      ] },
      { n: 9, h: '무비형 대본 도우미 (AI)', steps: [
        '🎬 대본 도우미에서 주제·등장인물 구성(예: 남 2·여 4)·주연·분기 구조·톤을 정하고 “대본 초안 만들기”를 눌러요(하루 10회).',
        'AI가 촬영용 분기 대본(장면·대사·연기·촬영 팁)을 만들어 줘요. 초안이니 학급 토의로 함께 고쳐 써요.',
        '만든 대본은 📚 저장된 대본에 학급별로 쌓여요 — 불러오기·인쇄·삭제할 수 있어요(브라우저를 닫아도 남아요).',
        '빈 무비형 작품에 🛠 수정으로 들어가면 “대본 초안 가져오기” 배너가 떠서, 장면을 한 번에 만들어 줘요.',
      ] },
      { n: 10, h: '인쇄물 (그림책·나침반·고쳐쓰기)', steps: [
        '그림책 인쇄: 장면을 화면 그대로(그림·말풍선) 책처럼 뽑아요. 팀 카드의 ⋯ 메뉴에서 열어요.',
        '생각 나침반 결과·고쳐쓰기 자료도 인쇄할 수 있어요 — 작품마다 모두 뽑을 수 있어요.',
        '입장 카드·이 설명서도 인쇄할 수 있어요. 인쇄 화면의 🛠 도우미로 글씨체·색을 바꿀 수도 있어요.',
        '⚠️ 그림책 인쇄는 기기 해상도에 따라 말풍선 위치가 조금 달라 보일 수 있어요. 잘 안 보이면 다듬기에서 말풍선을 옮긴 뒤 다시 인쇄해요.',
      ] },
      { n: 11, h: '작품 마무리 활동 (AI)', steps: [
        '학생이 “📔 작품 마무리”를 누르면 질문 만들기 → 작품 검사 → 직접 고치기 → 마지막 다듬기가 한 흐름으로 열려요.',
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
        'PIN은 선생님이 준 카드에 적혀 있어요. 같은 모둠 친구는 같은 정보로 함께 이어서 만들어요.',
      ] },
      { n: 2, h: '작품 고르기', steps: [
        '📖 텍스트 · 🖼️ 그림책 · 🎬 무비 · ✋ 체험 중에서 우리 모둠에 맞는 걸 골라요.',
        '한 번 고르면 그 모둠은 계속 같은 방식으로 만들어요.',
      ] },
      { n: 3, h: '생각 나침반 (쓰기 전 준비)', steps: [
        '글을 쓰기 전에, 어떤 이야기를 만들지 생각을 짧게 정리해요.',
        '“누가 나오지? 무슨 일이 생기지? 어떻게 끝나지?”를 먼저 떠올려 봐요.',
      ] },
      { n: 4, h: '이야기 만들기', steps: [
        '“+ 장면 추가”로 장면을 만들고, 글상자에 이야기를 써요.',
        '장면 그림·글자 크기·꾸미기도 바꿀 수 있어요. 따로 저장을 안 눌러도 자동으로 저장돼요.',
      ] },
      { n: 5, h: '가지(갈래) 만들기', steps: [
        '먼저 이야기를 한 줄기로 끝까지 만들어 봐요.',
        '그다음 “다르게 했다면?” 싶은 장면 카드의 ⋯를 펼쳐 [+ 버튼 추가]로 행동 버튼(선택지)을 만들고, 버튼마다 다음 장면을 이어 줘요.',
      ] },
      { n: 6, h: '그림 넣기', steps: [
        '“직접 그리기”(그림판)로 그리거나, 사진·그림을 올려요.',
        '그림은 3:2 화면에 맞춰져요.',
      ] },
      { n: 7, h: 'AI 기능 (선생님이 켠 것만)', steps: [
        '글 다듬기·작품 검사·AI 그림책 마감 같은 도움을 받을 수 있어요.',
        '내가 쓴 원본·그린 그림은 항상 그대로 남아요.',
      ] },
      { n: 8, h: '작품 마무리', steps: [
        '“📔 작품 마무리”에서 질문에 답하고, 검사 결과로 고칠 곳을 찾아 직접 고쳐요.',
      ] },
      { n: 9, h: '감상하기', steps: [
        '완성한 이야기를 처음부터 선택지를 따라가며 읽어요.',
        '무엇을 고르느냐에 따라 이야기의 끝이 달라져요.',
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
      + '  @page{size:A4 portrait;margin:12mm;}'   /* 세로(portrait) 기준 고정 */
      + '  body > *:not(#' + OVERLAY_ID + '){display:none !important;}'
      + '  #' + OVERLAY_ID + '{position:static;background:#fff;overflow:visible;}'
      + '  #' + OVERLAY_ID + ' .am-top{position:static;border:none;}'
      + '  #' + OVERLAY_ID + ' .am-tabs,#' + OVERLAY_ID + ' .am-btn{display:none !important;}'
      + '  #' + OVERLAY_ID + ' .am-deck{display:block !important;}'
      /* 교사용·학생용을 페이지로 구분 — 학생 덱은 항상 새 페이지에서 시작. */
      + '  #' + OVERLAY_ID + ' .am-deck[data-which="student"]{break-before:page;page-break-before:always;}'
      /* 덱 제목이 페이지 끝에 홀로 남지 않게. */
      + '  #' + OVERLAY_ID + ' .am-deck-head{break-after:avoid;page-break-after:avoid;}'
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
