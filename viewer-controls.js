/* ================================================================
   viewer-controls.js — 장면 이동 / 네비게이션
   의존: viewer-state.js, viewer-data.js, viewer-render.js
   ================================================================ */

/* ── viewer 시작 (감상용) ──
   표지(cover) 진입은 entrySceneId 기준. cover 조건은 viewer-render._shouldShowCover가 판단. */
function startViewer() {
  const entry = getEntryScene();
  if (!entry) {
    renderError('시작 장면이 없어요. 제작자에게 문의해주세요.');
    return;
  }
  ViewerState.resetPlayback();
  /* _coverShown 플래그 초기화 — 처음 진입이므로 cover 보여야 함 */
  ViewerState._coverShown = false;
  navigateTo(entry.id);
}

/* ── edit 전용 시작 — cover 강제 없이 특정 장면부터 편집 ──
   startViewer()와 달리 resetPlayback을 하지 않고
   historyStack에 더미를 넣어 cover 조건을 우회함.
   첫 장면을 편집하면서 cover가 뜨는 문제 해결. */
function startViewerEdit(targetSceneId) {
  const scenes    = ViewerState.scenes;
  const sceneIds  = _editSceneOrder();

  /* 대상 장면 결정: 인자가 있으면 그 장면, 없으면 첫 번째 장면 */
  const targetId  = (targetSceneId && scenes[targetSceneId])
    ? targetSceneId
    : (sceneIds[0] ?? null);

  if (!targetId) {
    renderError('편집할 장면이 없어요.');
    return;
  }

  /* currentSceneId만 설정 — historyStack에 더미 추가로 cover 조건 우회 */
  ViewerState.stopAudio();
  ViewerState.currentSceneId = targetId;
  ViewerState.historyStack   = ['__edit_entry__'];  // cover 조건: isStart && historyStack.length === 0 우회
  ViewerState.selectedChoiceId = null;
  ViewerState._testingEdit   = false;

  renderCurrentScene();
}

/* ── edit 모드에서 장면 이동 ── */
function editNavigateTo(sceneId) {
  if (!ViewerState.scenes[sceneId]) return;
  ViewerState.stopAudio();
  ViewerState.currentSceneId  = sceneId;
  ViewerState.selectedChoiceId = null;
  /* historyStack 더미 유지 — cover 우회 상태 유지 */
  if (ViewerState.historyStack.length === 0) {
    ViewerState.historyStack = ['__edit_entry__'];
  }
  renderCurrentScene();
}

/* ── edit 장면 순서 (num 기준 정렬) ── */
function _editSceneOrder() {
  return Object.values(ViewerState.scenes)
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map(s => s.id);
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
    /* VIEWER-PLAY-CHOICE-UNLINKED-1: 장면을 날리는 renderError(입장 화면 복귀) 대신 부드러운 토스트.
       미연결 선택지를 눌러도 작품/현재 장면은 그대로 두고 안내만. nextId/이동 로직은 불변. */
    if (typeof showPlayToast === 'function') {
      showPlayToast('아직 다음 장면과 연결되지 않은 선택지예요.');
    }
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

/* ── 처음으로 (재시작) ──
   구조 개편: 엔딩 이후 "다른 결말 찾기"는 replaySceneId로 이동.
   → 소개 장면이 있더라도 두 번째 감상부터는 건너뛰고 본편으로 바로.
   → cover도 다시 보여주지 않음 (_coverShown 유지) */
function restartStory() {
  const replay = getReplayScene();
  if (!replay) {
    renderError('다시 시작할 장면이 없어요.');
    return;
  }
  /* resetPlayback은 historyStack/visited 초기화하지만 _coverShown은 보존
     → cover 다시 안 뜸 */
  const coverShownBefore = ViewerState._coverShown === true;
  ViewerState.resetPlayback();
  ViewerState._coverShown = coverShownBefore;
  navigateTo(replay.id);
}

/* ── 표지부터 완전히 처음부터 다시 보기 ──
   사용자가 명시적으로 "처음부터" 원할 때 사용 (현재 UI에서 노출되지 않지만
   viewer-render에서 필요 시 호출 가능) */
function restartFromCover() {
  ViewerState.resetPlayback();
  ViewerState._coverShown = false;
  const entry = getEntryScene();
  if (entry) navigateTo(entry.id);
}

/* ── 허브로 복귀 (explore 모드) ──
   허브 = entrySceneId로 간주 (기존엔 isStart 기준이었음) */
function returnToHub() {
  const hub = getEntryScene();
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
