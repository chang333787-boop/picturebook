/* ================================================================
   viewer-state.js — viewer 전역 상태
   maker의 state.js와 완전히 분리된 viewer 전용 상태
   ================================================================ */

const ViewerState = {

  /* ── 프로젝트 메타 ── */
  project: {
    teamName: '',
    classId:  null,      // v2 경로용 — DATA_PATH_VERSION='v2'일 때만 설정
    isPublic: false,     // 공개 정책 — viewer-meta/isPublic 기준, 기본 비공개

    /* ── 작품 유형 (1단계: project-level type) ──
       4종 고정 — text/picturebook/movie/experience
       2~4단계에서 viewer-render가 이 값으로 분기.
       legacy 작품(viewer-meta에 projectType 없음)은 'picturebook' fallback. */
    projectType: 'picturebook',

    mode: 'story',       // 'story' | 'explore' | 'hybrid'
    theme: 'default',    // 'default' | 'fairybook' | 'explore'
    template: 'full-image', // 'full-image' | 'text-page' | 'map-layout'

    /* ── 표지 / 시작점 구조 (구조 개편 1차) ──
       · cover: 프로젝트 입구 (표지) — 제목/이미지가 첫 장면과 분리됨
       · entrySceneId: 첫 감상 시작 장면 (소개 장면 두고 싶으면 여기로)
       · replaySceneId: 엔딩 후 '다른 결말' 시작 장면 (보통 본편 첫 장면)
       null이면 기존 start scene에서 자동 마이그레이션됨 (viewer-data.js) */
    coverTitle:     null,
    coverImageData: null,
    entrySceneId:   null,
    replaySceneId:  null,
  },

  /* ── 장면 데이터 (adapter 변환 후) ── */
  scenes: {},   // { [id]: ViewerScene }

  /* ── 재생 상태 ── */
  currentSceneId: null,
  historyStack: [],         // 지나온 장면 id 배열
  visitedSceneIds: new Set(),
  visitedTerminalIds: new Set(),
  visitedHubItems: new Set(),

  /* ── edit 모드 ── */
  editMode: false,
  fromMaker: false,       // maker에서 넘어온 경우 — 왕복 UI 표시 여부
  _testingEdit: false,    // 감상 테스트 중 — 복귀 배너 표시용
  selectedChoiceId: null, // 현재 편집 중인 choice id

  /* ── 오디오 상태 ── */
  audioState: {
    current: null,          // HTMLAudioElement | null
    sceneId: null,
    playing: false,
    autoplayAllowed: false, // 첫 상호작용 후 true
  },

  /* ── 헬퍼: 상태 초기화 ── */
  resetPlayback() {
    this.currentSceneId = null;
    this.historyStack   = [];
    this.visitedSceneIds.clear();
    this.visitedTerminalIds.clear();
    this.visitedHubItems.clear();
    this._testingEdit   = false;
    this.stopAudio();
  },

  /* ── 오디오 정리 ── */
  stopAudio() {
    if (this.audioState.current) {
      this.audioState.current.pause();
      this.audioState.current.currentTime = 0;
      this.audioState.current = null;
    }
    this.audioState.playing = false;
    this.audioState.sceneId = null;
  },
};
