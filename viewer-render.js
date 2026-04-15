/* ================================================================
   viewer-render.js — 렌더링
   의존: viewer-state.js, viewer-controls.js
   ================================================================ */

/* ── 현재 장면 렌더 진입점 ── */
function renderCurrentScene() {
  const sceneId = ViewerState.currentSceneId;
  const scene   = ViewerState.scenes[sceneId];
  if (!scene) return;

  const stage = document.getElementById('viewer-frame');
  if (!stage) return;

  /* 테마 클래스 적용 */
  stage.className = `theme-${ViewerState.project.theme}`;
  /* 템플릿: 장면 단위 override → 없으면 project 기본 */
  const effectiveTemplate = scene.layoutTemplate || ViewerState.project.template;
  stage.dataset.template = effectiveTemplate;

  /* edit 모드: safe-area 힌트 표시 + frame 클래스 */
  const safeHint = document.getElementById('safe-area-hint');
  if (safeHint) safeHint.classList.toggle('hidden', !ViewerState.editMode);
  stage.classList.toggle('edit-mode-on', ViewerState.editMode);

  if (scene.isEnding) {
    renderTerminal(scene);
  } else if (scene.isStart && ViewerState.historyStack.length === 0) {
    renderCover(scene);
  } else {
    renderScene(scene);
  }

  /* HUD 업데이트 */
  renderHUD();

  /* edit panel — editMode 상태에 따라 명시적으로 처리 */
  if (ViewerState.editMode) {
    renderEditPanel();
  } else {
    /* editMode가 꺼졌을 때 패널을 확실히 비워서 잔상 방지 */
    const panel = document.getElementById('edit-panel');
    if (panel) panel.innerHTML = '';
  }

  /* 감상 테스트 중 배너 — _testingEdit 플래그 기준 */
  if (typeof renderTestingBanner === 'function') renderTestingBanner();
}

/* ================================================================
   Cover 화면
   ================================================================ */
function renderCover(scene) {
  const stage = document.getElementById('viewer-frame');

  const hasImage  = !!scene.imageData;
  const teamName  = ViewerState.project.teamName;
  const mode      = ViewerState.project.mode;

  stage.innerHTML = `
    <div class="cover-screen">
      ${hasImage ? `<div class="cover-bg" style="background-image:url('${scene.imageData}')"></div>
                    <div class="cover-bg-overlay"></div>` : '<div class="cover-bg-solid"></div>'}
      <div class="cover-content">
        <div class="cover-team">${escHtml(teamName)}</div>
        <h1 class="cover-title">${escHtml(scene.title || '이야기 시작')}</h1>
        <div class="cover-mode-badge">${modeBadgeLabel(mode)}</div>
        <button class="cover-start-btn js-cover-start">
          <span>▶ 시작하기</span>
        </button>
      </div>
    </div>`;

  stage.querySelector('.js-cover-start')
    ?.addEventListener('click', () => {
      ViewerState.audioState.autoplayAllowed = true;
      /* ★ cover는 작품 입구, 시작 장면은 별도 렌더
         cover가 start scene의 choice를 대신 소비하지 않음
         → 무조건 start scene 자체를 renderScene으로 표시
         → 관람자가 직접 선택지를 고르게 됨 */
      ViewerState.historyStack = [];  // cover 이전 기록 없음
      renderScene(scene);
    });
}

/* ================================================================
   일반 장면
   ================================================================ */
function renderScene(scene) {
  const stage = document.getElementById('viewer-frame');

  /* 이미지 배경 */
  const bgHtml = scene.imageData
    ? `<div class="scene-bg" style="background-image:url('${scene.imageData}')"></div>
       <div class="scene-bg-overlay"></div>`
    : `<div class="scene-bg-solid"></div>`;

  /* 텍스트 박스 */
  const textHtml = renderTextBox(scene);

  /* 선택지 분리 */
  const bottomChoices  = scene.choices.filter(c => c.presentation.placement === 'bottom');
  const overlayChoices = scene.choices.filter(c => c.presentation.placement === 'overlay');

  const bottomHtml  = bottomChoices.length  ? renderBottomChoices(scene, bottomChoices)  : '';
  const overlayHtml = overlayChoices.length ? renderOverlayChoices(scene, overlayChoices) : '';

  /* 오디오 버튼 */
  const audioHtml = scene.narrationAudio
    ? `<button class="audio-btn js-audio-toggle" title="음성 재생">🔊</button>` : '';

  stage.innerHTML = `
    <div class="scene-screen" data-display="${scene.displayType}" data-text-len="${scene.textLength}">
      ${bgHtml}
      <div class="scene-content">
        ${textHtml}
        ${overlayHtml}
      </div>
      ${bottomHtml}
      ${audioHtml}
    </div>`;

  /* 이벤트 바인딩 */
  _bindSceneEvents(stage, scene);

  /* edit 모드: overlay 드래그 + 선택 테두리 초기화 */
  if (ViewerState.editMode) initEditInteractions();
}

function renderTextBox(scene) {
  const isLong = scene.textLength === 'long';
  return `
    <div class="text-box text-box--${scene.textLength}">
      <p class="text-box__body${isLong ? ' text-box__body--scroll' : ''}">${escHtml(scene.title)}</p>
    </div>`;
}

/* ── bottom 선택지 ── */
function renderBottomChoices(scene, choices) {
  const btns = choices.map(c => _choiceButtonHtml(scene, c)).join('');
  return `<div class="choices-bottom">${btns}</div>`;
}

/* ── overlay 선택지 ── */
function renderOverlayChoices(scene, choices) {
  return choices.map(c => {
    const p   = c.presentation;
    const pos = (p.x != null && p.y != null)
      ? `left:${p.x}%;top:${p.y}%;`
      : '';
    const size = (p.w != null && p.h != null)
      ? `width:${p.w}px;height:${p.h}px;`
      : '';
    return `<div class="choice-overlay-wrap" style="${pos}${size}opacity:${p.opacity ?? 1}">
      ${_choiceButtonHtml(scene, c, 'overlay')}
    </div>`;
  }).join('');
}

function _choiceButtonHtml(scene, choice, type = 'bottom') {
  const preset   = choice.presentation.stylePreset || 'basic';
  const disabled = !choice.nextId ? 'disabled' : '';
  return `<button class="choice-btn choice-btn--${type} choice-preset--${preset} js-choice"
    data-choice-id="${escHtml(choice.id)}" ${disabled}>
    ${escHtml(choice.label)}
  </button>`;
}

function _bindSceneEvents(stage, scene) {
  stage.querySelectorAll('.js-choice').forEach(btn => {
    btn.addEventListener('click', () => {
      const choiceId = btn.dataset.choiceId;
      chooseOption(choiceId);
    });
  });

  stage.querySelector('.js-audio-toggle')
    ?.addEventListener('click', toggleNarrationAudio);
}

/* ================================================================
   Terminal / Completion 화면
   ================================================================ */
function renderTerminal(scene) {
  const stage = document.getElementById('viewer-frame');
  const mode  = ViewerState.project.mode;

  if (mode === 'explore') {
    _renderExploreCompletion(stage, scene);
  } else {
    _renderStoryEnding(stage, scene);
  }
}

function _renderStoryEnding(stage, scene) {
  const stats     = getEndingStats();
  const isTrueEnd = scene.isTrueEnd;
  const steps     = ViewerState.historyStack.length + 1;  // 지나온 장면 수

  const bgHtml = scene.imageData
    ? `<div class="scene-bg" style="background-image:url('${scene.imageData}')"></div>
       <div class="scene-bg-overlay scene-bg-overlay--dark"></div>`
    : `<div class="scene-bg-solid scene-bg-solid--ending"></div>`;

  /* 엔딩별 감정 메시지 */
  const moodMsg = isTrueEnd
    ? '이야기의 진짜 결말에 도달했어요.'
    : stats.remaining > 0
      ? `다른 선택을 했다면 어땠을까요? ${stats.remaining}개의 결말이 더 있어요.`
      : '모든 결말을 찾았어요!';

  const trueEndBadge = isTrueEnd
    ? `<div class="ending-true-badge">⭐ 진엔딩</div>` : '';

  /* 경로 요약 — 몇 장면을 거쳤는지 */
  const pathSummary = steps > 1
    ? `<div class="ending-path-summary">${steps}개의 장면을 거쳐 이 결말에 도달했어요</div>`
    : '';

  stage.innerHTML = `
    <div class="terminal-screen terminal-screen--story">
      ${bgHtml}
      <div class="terminal-content">
        ${trueEndBadge}
        <div class="terminal-icon terminal-icon--story">${isTrueEnd ? '🏆' : '🏁'}</div>
        <h2 class="terminal-title">${isTrueEnd ? '진짜 결말' : '이야기 끝'}</h2>
        <p class="terminal-body">${escHtml(scene.title)}</p>
        ${pathSummary}
        <p class="ending-mood">${moodMsg}</p>
        <div class="terminal-actions">
          <button class="terminal-btn terminal-btn--primary js-restart">↺ 다른 결말 찾기</button>
          ${ViewerState.historyStack.length > 0
            ? `<button class="terminal-btn terminal-btn--ghost js-back">← 직전 장면으로</button>` : ''}
        </div>
      </div>
    </div>`;

  stage.querySelector('.js-restart')?.addEventListener('click', restartStory);
  stage.querySelector('.js-back')   ?.addEventListener('click', navigateBack);
}

function _renderExploreCompletion(stage, scene) {
  const stats = getExploreStats();

  const bgHtml = scene.imageData
    ? `<div class="scene-bg" style="background-image:url('${scene.imageData}')"></div>
       <div class="scene-bg-overlay scene-bg-overlay--dark"></div>`
    : `<div class="scene-bg-solid scene-bg-solid--explore"></div>`;

  /* 완료율에 따른 메시지 분기 */
  const completeMsg = stats.pct >= 100
    ? '모든 장소를 탐색했어요! 완전 탐험 달성 🎉'
    : stats.pct >= 60
      ? `전체의 ${stats.pct}%를 탐색했어요. 아직 발견 못한 곳이 있어요.`
      : `${stats.total - stats.visited}곳이 아직 미발견이에요. 계속 탐험해보세요.`;

  /* 방문 기록 — 최근 3개 */
  const recentIds = [...ViewerState.visitedSceneIds].slice(-3).reverse();
  const recentHtml = recentIds.length > 0
    ? `<div class="explore-recent">
        <div class="explore-recent-label">최근 방문</div>
        ${recentIds.map(id => {
          const s = ViewerState.scenes[id];
          return s ? `<div class="explore-recent-item">• ${escHtml(s.title?.slice(0,20) || `장면 ${id}`)}</div>` : '';
        }).join('')}
      </div>` : '';

  stage.innerHTML = `
    <div class="terminal-screen terminal-screen--explore">
      ${bgHtml}
      <div class="terminal-content terminal-content--explore">
        <div class="terminal-icon terminal-icon--explore">🗺</div>
        <h2 class="terminal-title terminal-title--explore">탐색 지점 도달</h2>
        <p class="terminal-body">${escHtml(scene.title)}</p>

        <div class="explore-stats">
          <div class="explore-stats-row">
            <span class="explore-stats-num">${stats.visited}</span>
            <span class="explore-stats-sep">/</span>
            <span class="explore-stats-total">${stats.total}</span>
            <span class="explore-stats-unit">장소 방문</span>
          </div>
          <div class="explore-progress">
            <div class="explore-progress-bar" style="width:${stats.pct}%"></div>
          </div>
          <p class="explore-complete-msg">${completeMsg}</p>
        </div>

        ${recentHtml}

        <div class="terminal-actions terminal-actions--explore">
          <button class="terminal-btn terminal-btn--primary terminal-btn--explore-primary js-hub">
            허브로 돌아가기
          </button>
          <button class="terminal-btn terminal-btn--ghost js-restart">↺ 처음부터</button>
        </div>
      </div>
    </div>`;

  stage.querySelector('.js-hub')    ?.addEventListener('click', returnToHub);
  stage.querySelector('.js-restart')?.addEventListener('click', restartStory);
}

/* ================================================================
   HUD 렌더
   ================================================================ */
function renderHUD() {
  const hud = document.getElementById('hud');
  if (!hud) return;

  const mode      = ViewerState.project.mode;
  const canBack   = ViewerState.historyStack.length > 0;
  const fromMaker = ViewerState.fromMaker;

  /* fromMaker 왕복 액션바 — maker에서 넘어온 경우만 */
  const makerBarHtml = fromMaker ? `
    <div class="maker-return-bar">
      <span class="maker-return-label">✏️ 제작자 테스트 중</span>
      <div class="maker-return-actions">
        <button class="maker-return-btn js-return-to-maker">← 작업으로 돌아가기</button>
        ${!ViewerState.editMode
          ? `<button class="maker-return-btn maker-return-btn--edit js-go-edit">🎨 감상 화면 다듬기</button>`
          : ''}
      </div>
    </div>` : '';

  hud.innerHTML = `
    ${makerBarHtml}
    <div class="hud-inner">
      <button class="hud-btn js-hud-back ${canBack ? '' : 'hud-btn--hidden'}" title="뒤로">‹</button>
      <div class="hud-center">
        <span class="hud-team">${escHtml(ViewerState.project.teamName)}</span>
      </div>
      <div class="hud-right">
        ${mode === 'explore' ? `<span class="hud-explore-count">${ViewerState.visitedSceneIds.size}곳 방문</span>` : ''}
        ${ViewerState.editMode ? '<span class="hud-edit-badge">마감 편집 중</span>' : ''}
        <button class="hud-btn hud-btn--exit js-hud-exit" title="나가기">✕</button>
      </div>
    </div>`;

  hud.querySelector('.js-hud-back')?.addEventListener('click', navigateBack);
  hud.querySelector('.js-hud-exit')?.addEventListener('click', showEntryScreen);

  /* fromMaker 전용 */
  hud.querySelector('.js-return-to-maker')?.addEventListener('click', () => {
    if (document.referrer.includes('maker.html')) {
      history.back();
    } else {
      window.location.href = 'maker.html';
    }
  });

  hud.querySelector('.js-go-edit')?.addEventListener('click', () => {
    ViewerState.editMode = true;
    ViewerState.selectedChoiceId = null;
    renderCurrentScene();
  });
}

/* ================================================================
   오디오 버튼 상태 업데이트
   ================================================================ */
function updateAudioButton(playing) {
  const btn = document.querySelector('.js-audio-toggle');
  if (btn) btn.textContent = playing ? '⏸' : '🔊';
}

/* ================================================================
   에러 렌더
   ================================================================ */
function renderError(msg) {
  const stage = document.getElementById('viewer-frame');
  if (!stage) return;
  stage.innerHTML = `
    <div class="error-screen">
      <div class="error-content">
        <div class="error-icon">⚠️</div>
        <p class="error-msg">${escHtml(msg)}</p>
        <button class="terminal-btn terminal-btn--ghost js-err-back">돌아가기</button>
      </div>
    </div>`;
  stage.querySelector('.js-err-back')?.addEventListener('click', showEntryScreen);
}

/* ── 유틸 ── */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function modeBadgeLabel(mode) {
  return { story: '📖 이야기', explore: '🗺 탐색', hybrid: '🔀 혼합' }[mode] || '';
}
