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

  /* 학생 주제(마스터) — 도움말(S1) 전체 + 환영/인쇄가 부분 재사용. 범위=학생 전체(AI·나침반 포함). */
  const topics = [
    { id: 'enter',   icon: '🚪', title: '들어가기',
      lines: ['선생님이 알려준 클래스 코드, 모둠 이름, 비밀번호(PIN)를 넣어요.',
              '같은 모둠 친구는 같은 정보로 함께 이어서 만들 수 있어요.'] },
    { id: 'ptype',   icon: '🎨', title: '작품 고르기',
      lines: ['텍스트형·그림책형·무비형·체험형 중에서 골라요.',
              '한 번 고르면 그 모둠은 계속 같은 방식으로 만들어요.'] },
    { id: 'compass', icon: '🧭', title: '생각 나침반',
      lines: ['새 이야기를 시작할 때, 글쓰기 전에 생각을 짧게 정리해요.',
              '무엇을·누가·어떻게 되는 이야기인지 먼저 떠올려 봐요.'] },
    { id: 'scene',   icon: '➕', title: '장면 만들기',
      lines: ['[+ 장면]으로 새 장면을 더해요.',
              '글을 쓰고, 그림을 그리거나 사진을 올릴 수 있어요.'] },
    { id: 'branch',  icon: '🔗', title: '갈래 잇기',
      lines: ['장면에 행동 버튼(선택지)을 만들어요.',
              '버튼마다 다음 장면을 이어 주면 이야기가 갈라져요.'] },
    { id: 'save',    icon: '💾', title: '저장',
      lines: ['따로 저장을 누르지 않아도 자동으로 저장돼요.',
              '나중에 다시 들어오면 이어서 만들 수 있어요.'] },
    { id: 'play',    icon: '👀', title: '감상하기',
      lines: ['완성한 이야기를 읽으며 선택지를 눌러 진행해요.',
              '고르는 대로 이야기가 달라져요.'] },
    { id: 'ai',      icon: '✨', title: 'AI 도움받기',
      lines: ['AI가 글을 다듬거나 그림을 완성하도록 도와줄 수 있어요.',
              '선생님이 켜 준 반에서만 쓸 수 있고, 원래 작품은 그대로 남아요.'] },
  ];

  /* S2 환영 모달 — 짧은 3~5장. 큰 흐름만(상세는 도움말로 위임). 마지막 장은 도움말 안내. */
  const welcome = [
    { icon: '🌿', title: '가지에 온 걸 환영해요', line: '고르는 대로 이야기가 갈라지는 나만의 작품을 만들어요.' },
    { icon: '🚪', title: '먼저 들어가요',       line: '클래스 코드·모둠 이름·비밀번호(PIN)를 넣으면 시작해요.' },
    { icon: '➕', title: '장면을 만들어요',     line: '글을 쓰고 그림을 더한 다음, 행동 버튼으로 다음 장면을 이어요.' },
    { icon: '👀', title: '읽고 골라요',         line: '완성하면 친구의 이야기를 감상하며 선택지를 눌러 봐요.' },
    { icon: '❓', title: '언제든 다시 볼 수 있어요', line: '위쪽 ❓ 버튼을 누르면 사용법을 다시 볼 수 있어요.' },
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
