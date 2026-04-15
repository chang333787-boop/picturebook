/* ================================================================
   viewer-state.js — viewer 전역 상태
   maker의 state.js와 완전히 분리된 viewer 전용 상태
   ================================================================ */

const ViewerState = {

  /* ── 프로젝트 메타 ── */
  project: {
    teamName: '',
    classId:  null,      // v2 경로용 — DATA_PATH_VERSION='v2'일 때만 설정
    mode: 'story',       // 'story' | 'explore' | 'hybrid'
    theme: 'default',    // 'default' | 'fairybook' | 'explore'
    template: 'full-image', // 'full-image' | 'text-page' | 'map-layout'
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
