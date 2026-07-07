/* tutorial-content.js — 튜토리얼/사용설명서 콘텐츠 단일 출처 (TUTORIAL-PRD 2026-07-07).
   S1 도움말·S2 환영 모달·P1 학생 인쇄·P2 교사 인쇄가 모두 이 한 파일을 재사용한다(문구 3벌 관리 방지).
   브라우저(window.TutorialContent) + Node(require) 양쪽 — DOM/Firebase 비의존 순수 데이터라 하니스 검증 가능.
   문해 수준: 저학년 태블릿 — 아이콘 + 짧은 한두 문장. 톤: 기존 Warm Paper 존댓말("~해요"). */
;(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TutorialContent = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  /* 학생 주제(마스터) — 도움말(S1) 전체 + 환영/인쇄가 부분 재사용. 범위=학생 전체(AI·나침반 포함).
     art = tutorial-art.js 삽화 id. lines에 구체 예시 포함(저학년 이해). */
  const topics = [
    { id: 'enter',   icon: '🚪', title: '들어가기', art: 'enter',
      lines: ['선생님이 알려준 <b>클래스 코드·모둠 이름·비밀번호(PIN)</b>를 넣어요.',
              '예) 코드 “JL26A”, 모둠 “2모둠”. 같은 모둠 친구는 같은 정보로 함께 이어서 만들어요.'] },
    { id: 'ptype',   icon: '🎨', title: '작품 고르기', art: 'ptype',
      lines: ['📖 텍스트 · 🖼 그림책 · 🎬 무비 · ✋ 체험 중에서 우리 모둠에 맞는 걸 골라요.',
              '한 번 고르면 그 모둠은 계속 같은 방식으로 만들어요.'] },
    { id: 'compass', icon: '🧭', title: '생각 나침반', art: 'compass',
      lines: ['글을 쓰기 전에, 어떤 이야기를 만들지 생각을 짧게 정리해요.',
              '“누가 나오지? 무슨 일이 생기지? 어떻게 끝나지?”를 먼저 떠올려 봐요.'] },
    { id: 'scene',   icon: '➕', title: '장면 만들기', art: 'scene',
      lines: ['[+ 장면]을 눌러 새 장면을 더하고, 글을 쓰고 그림을 그리거나 사진을 올려요.',
              '한 장면은 그림책의 한 페이지 같은 거예요.'] },
    { id: 'branch',  icon: '🔗', title: '갈래 잇기', art: 'branch',
      lines: ['장면 아래에 <b>행동 버튼(선택지)</b>을 만들고, 버튼마다 다음 장면을 이어 줘요.',
              '예) “🌲 숲으로”를 누르면 숲 장면으로, “🏠 집으로”를 누르면 집 장면으로 갈라져요.'] },
    { id: 'save',    icon: '💾', title: '저장', art: 'save',
      lines: ['따로 저장을 누르지 않아도 <b>자동으로 저장</b>돼요.',
              '나중에 다시 들어오면 하던 곳부터 이어서 만들 수 있어요.'] },
    { id: 'play',    icon: '👀', title: '감상하기', art: 'play',
      lines: ['완성한 이야기를 읽으며 선택지 버튼을 눌러 진행해요.',
              '무엇을 고르느냐에 따라 이야기의 끝이 달라져요.'] },
    { id: 'ai',      icon: '✨', title: 'AI 도움받기', art: 'ai',
      lines: ['AI가 내 글을 더 매끄럽게 다듬거나, 내 그림을 완성해 줄 수 있어요.',
              '선생님이 켜 준 반에서만 쓰이고, <b>원래 내 작품은 그대로</b> 남아요.'] },
  ];

  /* S2 환영 모달 — 짧은 5장. art=삽화, demo=true면 인터랙티브 미니 데모 삽입. */
  const welcome = [
    { title: '가지에 온 걸 환영해요', line: '고르는 대로 이야기가 갈라지는 나만의 작품을 만드는 곳이에요.', art: 'welcomeHero' },
    { title: '한 번 해볼까요?',       line: '버튼을 누르면 이야기가 어떻게 달라지는지 직접 보여줄게요.', demo: true },
    { title: '먼저 들어가요',         line: '클래스 코드·모둠 이름·비밀번호(PIN)를 넣으면 시작해요.', art: 'enter' },
    { title: '장면을 만들고 이어요',   line: '글과 그림으로 장면을 만들고, 행동 버튼으로 다음 장면을 이어 줘요.', art: 'branch' },
    { title: '언제든 다시 볼 수 있어요', line: '헷갈리면 위쪽 ❓ 버튼을 눌러 사용법을 다시 봐요.', art: 'play' },
  ];

  /* P1 학생 인쇄(A4 1장) — 번호 스텝. 저학년 책상용 빠른 시작. topics 압축. */
  const studentPrintSteps = [
    { icon: '🚪', title: '들어가기',   text: '클래스 코드·모둠 이름·비밀번호(PIN)를 넣어요.' },
    { icon: '🎨', title: '작품 고르기', text: '텍스트·그림책·무비·체험 중에서 골라요.' },
    { icon: '➕', title: '장면 만들기', text: '글을 쓰고 그림을 그리거나 올려요.' },
    { icon: '🔗', title: '갈래 잇기',   text: '행동 버튼을 만들고 다음 장면을 이어 줘요.' },
    { icon: '💾', title: '저장',        text: '자동으로 저장돼요. 따로 안 눌러도 돼요.' },
    { icon: '👀', title: '감상하기',    text: '완성하면 읽으며 선택지를 눌러 진행해요.' },
  ];

  /* P2 교사 인쇄(A4 1장) — 수업 준비 체크리스트. */
  const teacherSteps = [
    { icon: '🔑', title: '교사 로그인',     text: '홈에서 "수업 관리" → 이메일/구글로 로그인해요.' },
    { icon: '🏫', title: '학급 만들기',     text: '학급을 만들면 클래스 코드가 생겨요. 학생에게 알려 줘요.' },
    { icon: '👥', title: '모둠 계정 만들기', text: '관리모드에서 모둠 이름과 PIN을 등록해요(🎲 자동 PIN 가능).' },
    { icon: '🖨', title: '입장 카드 인쇄',   text: '[입장 카드 인쇄]로 코드·모둠·PIN 카드를 뽑아 나눠 줘요.' },
    { icon: '✏️', title: '점검·다듬기',      text: '관리모드 팀 카드에서 작품을 보고 함께 고쳐 써요.' },
    { icon: '📄', title: '인쇄물',           text: '그림책·고쳐쓰기 자료·생각 나침반을 교사 화면에서 인쇄해요.' },
  ];

  return {
    version: 1,
    topics: topics,
    welcome: welcome,
    studentPrintSteps: studentPrintSteps,
    teacherSteps: teacherSteps,
  };
});
