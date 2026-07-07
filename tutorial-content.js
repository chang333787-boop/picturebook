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

  /* S2 환영 모달 — art=삽화, demo=true면 인터랙티브 미니 데모 삽입.
     이미 로그인/입장한 뒤(나침반 완료 후) 뜨므로 '들어가기' 슬라이드는 뺌. */
  const welcome = [
    { title: '가지에 온 걸 환영해요', line: '고르는 대로 이야기가 갈라지는 나만의 작품을 만드는 곳이에요.', art: 'welcomeHero' },
    { title: '한 번 해볼까요?',       line: '버튼을 누르면 이야기가 어떻게 달라지는지 직접 보여줄게요.', demo: true },
    { title: '장면을 만들고 이어요',   line: '글과 그림으로 장면을 만들고, 행동 버튼으로 다음 장면을 이어 줘요.', art: 'branch' },
    { title: '다 만들면 꾸며 봐요',    line: '오른쪽 위 “🎨 감상 화면 다듬기”를 누르면 글상자와 그림을 예쁘게 마감할 수 있어요. 헷갈리면 ❓를 눌러요.', art: 'play' },
  ];

  /* 다듬기(감상 화면 다듬기) 첫 진입 1회 튜토리얼 — viewer 편집모드에서 표시.
     types = 이 슬라이드를 보여줄 작품 유형(없으면 전체). 유형에 맞는 슬라이드만 노출. */
  const refineWelcome = [
    { title: '감상 화면 다듬기',
      line: '만든 이야기를 감상 화면 그대로 보면서 예쁘게 마감하는 곳이에요.', art: 'play' },
    { title: '글은 눌러서 바로 고쳐요',
      line: '화면의 글·제목·선택지 글자를 손가락으로 눌러 그 자리에서 고칠 수 있어요.', art: 'editText' },
    { title: '🖼 그림 넣고 손보기',
      line: '사진을 올리거나 직접 그릴 수 있고, 그림의 크기·위치를 맞추거나 잘라낼 수 있어요.',
      art: 'imageTools', types: ['picturebook'] },
    { title: '💬 글상자 옮기고 진하기',
      line: '글상자를 끌어 옮기고, 모서리로 크기를, 슬라이더로 진하기(투명도)를 조절해요.',
      art: 'bodybox', types: ['picturebook'] },
    { title: '🎨 꾸미기',
      line: '글자 모양·크기·색을 바꾸고, 테마와 분위기를 골라 장면을 꾸며요.',
      art: 'style', types: ['text', 'picturebook'] },
    { title: '🔗 선택지 정리',
      line: '행동 버튼의 글자와 개수를 바꾸고, 버튼마다 이어질 다음 장면을 연결해요.', art: 'branch' },
    { title: '🎬 무비 편집',
      line: '영상을 올리고, 자막 위치와 선택지가 언제 나올지 정할 수 있어요.',
      art: 'movie', types: ['movie'] },
    { title: '⚙ 작품 설정',
      line: '장면이 바뀔 때 효과(전환)와 스킨 같은 작품 전체 설정을 정해요.', art: 'settings' },
    { title: '📁 작품 마무리',
      line: '다 만들면 [작품 마무리]로 점검 질문에 답하고, 검사 결과를 보며 고쳐 완성해요.',
      art: 'ai', types: ['text', 'picturebook'] },
    { title: '저장은 자동, 나갈 땐 뒤로',
      line: '바꾼 건 자동 저장돼요. ▶ 감상해 보기로 확인하고, ← 로 브랜치 화면으로 나가요.', art: 'save' },
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

  /* 다듬기 코치마크 — 실제 버튼을 콕 집어주는 스텝(sel=CSS 선택자). 막히기 쉬운 순서로 짧게.
     types 있으면 해당 유형에서만. 대상 없으면 자동 스킵(코치 엔진). */
  const refineCoach = [
    { sel: '.js-scene-nav-next',
      text: '다음 장면으로 갈 때는 이 <b>→</b> 화살표를 눌러요.' },
    { sel: '.js-scene-nav-jump',
      text: '여기서 장면 목록을 열어 원하는 장면으로 바로 갈 수도 있어요.' },
    { sel: '.js-edit-image-popover',
      text: '그림을 넣거나 직접 그리려면 여기를 눌러요.', types: ['picturebook'] },
    { sel: '.js-edit-scene-style-popover',
      text: '글자·색·분위기로 장면을 꾸미려면 여기예요.', types: ['text', 'picturebook'] },
    { sel: '.js-edit-preview-test',
      text: '다 되면 여기서 실제로 어떻게 보이는지 미리 감상해 봐요.' },
    { sel: '.js-edit-return-maker',
      text: '끝나면 여기로 나가요. 바꾼 건 자동으로 저장돼요!' },
  ];

  return {
    /* version 올리면 환영 모달 seen-플래그 키가 바뀌어 모두에게 1회 다시 표시.
       v2: 삽화·인터랙티브 데모 추가 + 트리거를 "나침반 질문 뒤"로 이동(2026-07-07). */
    version: 2,
    topics: topics,
    welcome: welcome,
    refineWelcome: refineWelcome,
    refineCoach: refineCoach,
    studentPrintSteps: studentPrintSteps,
    teacherSteps: teacherSteps,
  };
});
