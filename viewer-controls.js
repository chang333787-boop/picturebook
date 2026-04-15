/* ================================================================
   viewer-controls.js — 장면 이동 / 네비게이션
   의존: viewer-state.js, viewer-data.js, viewer-render.js
   ================================================================ */

/* ── viewer 시작 ── */
function startViewer() {
  const startScene = getStartScene();
  if (!startScene) {
    renderError('시작 장면이 없어요. 제작자에게 문의해주세요.');
    return;
  }
  ViewerState.resetPlayback();
  navigateTo(startScene.id);
}

/* ── 장면 이동 ── */
function navigateTo(sceneId) {
  const scene = ViewerState.scenes[sceneId];
  if (!scene) {
    renderError(`장면 "${sceneId}"을(를) 찾을 수 없어요.`);
    return;
  }

  /* 오디오 정리 */
  ViewerState.stopAudio();

  /* 히스토리 기록 */
  if (ViewerState.currentSceneId) {
    ViewerState.historyStack.push(ViewerState.currentSceneId);
  }
  ViewerState.currentSceneId = sceneId;
  ViewerState.visitedSceneIds.add(sceneId);

  if (scene.isEnding) {
    ViewerState.visitedTerminalIds.add(sceneId);
  }

  /* 렌더 */
  renderCurrentScene();
}

/* ── 선택지 선택 ── */
function chooseOption(choiceId) {
  /* edit 모드: 이동 대신 선택지 선택 */
  if (ViewerState.editMode) {
    ViewerState.selectedChoiceId = choiceId;
    renderEditPanel();
    return;
  }

  const scene  = ViewerState.scenes[ViewerState.currentSceneId];
  if (!scene) return;

  const choice = scene.choices.find(c => c.id === choiceId);
  if (!choice) return;

  if (!choice.nextId) {
    renderError('이 선택지는 아직 연결되지 않았어요.');
    return;
  }

  navigateTo(choice.nextId);
}

/* ── 뒤로 가기 ── */
function navigateBack() {
  if (ViewerState.historyStack.length === 0) return;
  const prevId = ViewerState.historyStack.pop();
  ViewerState.stopAudio();
  ViewerState.currentSceneId = prevId;
  renderCurrentScene();
}

/* ── 처음으로 ── */
function restartStory() {
  startViewer();
}

/* ── 허브로 복귀 (explore 모드) ── */
function returnToHub() {
  const hub = Object.values(ViewerState.scenes).find(s => s.isStart);
  if (hub) navigateTo(hub.id);
}

/* ── 전체 엔딩 수 / 미발견 엔딩 수 ── */
function getEndingStats() {
  const allEndings     = Object.values(ViewerState.scenes).filter(s => s.isEnding);
  const visitedEndings = [...ViewerState.visitedTerminalIds];
  return {
    total:      allEndings.length,
    visited:    visitedEndings.length,
    remaining:  allEndings.length - visitedEndings.length,
    hasTrueEnd: allEndings.some(s => s.isTrueEnd),
    foundTrueEnd: allEndings.filter(s => s.isTrueEnd).some(s =>
      ViewerState.visitedTerminalIds.has(s.id)
    ),
  };
}

/* ── explore: 방문 통계 ── */
function getExploreStats() {
  const total   = Object.keys(ViewerState.scenes).length;
  const visited = ViewerState.visitedSceneIds.size;
  return { total, visited, pct: Math.round(visited / total * 100) };
}

/* ── 오디오 토글 ── */
function toggleNarrationAudio() {
  const scene = ViewerState.scenes[ViewerState.currentSceneId];
  if (!scene?.narrationAudio) return;

  const audio = ViewerState.audioState;

  if (audio.playing && audio.sceneId === ViewerState.currentSceneId) {
    audio.current?.pause();
    audio.playing = false;
    updateAudioButton(false);
    return;
  }

  /* 새 오디오 생성 */
  ViewerState.stopAudio();
  const el  = new Audio(scene.narrationAudio);
  audio.current = el;
  audio.sceneId = ViewerState.currentSceneId;
  audio.playing = true;

  el.addEventListener('ended', () => {
    audio.playing = false;
    updateAudioButton(false);
  });

  el.play().catch(() => {
    audio.playing = false;
    updateAudioButton(false);
  });
  updateAudioButton(true);
}
