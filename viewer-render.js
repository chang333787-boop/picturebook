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
  } else if (_shouldShowCover()) {
    /* cover는 감상 모드 진입 직후에만 — edit 모드/재시작 후에는 scene 렌더 */
    renderCover();
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
   Cover 화면 — project 단위 표지 데이터 기반 (구조 개편 1차)
   ────────────────────────────────────────────────────────────
   cover는 더 이상 '특정 scene'에 귀속되지 않음.
   project.coverTitle / coverImageData가 표지의 출처이며,
   시작 버튼은 entrySceneId로 이동.
   ================================================================ */

/* cover 표시 조건: 첫 감상 진입 시점(historyStack 비어있음) + 감상 모드
   (editMode는 이전과 동일하게 edit-entry dummy로 우회됨) */
function _shouldShowCover() {
  if (ViewerState.editMode) return false;
  if (ViewerState.historyStack.length !== 0) return false;
  /* _coverShown 플래그 — restartStory 시 cover 생략하고 replay 장면으로 바로 가기 위함 */
  if (ViewerState._coverShown === true) return false;
  /* entry = 현재 scene이 맞아야 cover 조건 성립 */
  const cur = ViewerState.currentSceneId;
  const eid = ViewerState.project.entrySceneId;
  return !!cur && !!eid && String(cur) === String(eid);
}

function renderCover() {
  const stage = document.getElementById('viewer-frame');

  const p         = ViewerState.project;
  const teamName  = p.teamName;
  const mode      = p.mode;
  const title     = p.coverTitle     || '이야기 시작';
  const imageData = p.coverImageData || null;
  const hasImage  = !!imageData;

  stage.innerHTML = `
    <div class="cover-screen">
      ${hasImage ? `<div class="cover-bg" style="background-image:url('${imageData}')"></div>
                    <div class="cover-bg-overlay"></div>` : '<div class="cover-bg-solid"></div>'}
      <div class="cover-content">
        <div class="cover-team">${escHtml(teamName)}</div>
        <h1 class="cover-title">${escHtml(title)}</h1>
        <div class="cover-mode-badge">${modeBadgeLabel(mode)}</div>
        <button class="cover-start-btn js-cover-start">
          <span>▶ 시작하기</span>
        </button>
      </div>
    </div>`;

  stage.querySelector('.js-cover-start')
    ?.addEventListener('click', () => {
      ViewerState.audioState.autoplayAllowed = true;
      /* cover는 작품 입구 — 시작 버튼은 entrySceneId로 이동.
         이 시점부터 이후 재시작에서는 cover 건너뜀 (_coverShown=true) */
      ViewerState._coverShown = true;
      ViewerState.historyStack = [];
      /* 현재 currentSceneId = entrySceneId 이미 세팅됨 → 그냥 렌더 */
      renderCurrentScene();
    });
}

/* ================================================================
   일반 장면
   ================================================================ */
function renderScene(scene) {
  const stage = document.getElementById('viewer-frame');

  /* 모드 결정 — v0.3 기본형: text / picturebook / movie 3개만 본격 적용.
     document는 보류이므로 기존 처리 유지하되 새 구조 안 들어감. */
  const presentationMode = (typeof resolvePresentationMode === 'function')
    ? resolvePresentationMode(scene) : 'picturebook';
  const presentationSubmode = (typeof resolvePresentationSubmode === 'function')
    ? resolvePresentationSubmode(scene) : null;

  /* 모드별 렌더 분기 (v0.3 — 2단계) */
  if (presentationMode === 'text') {
    _renderSceneText(stage, scene);
  } else if (presentationMode === 'picturebook') {
    _renderScenePicturebook(stage, scene, presentationSubmode);
  } else if (presentationMode === 'movie') {
    _renderSceneMovie(stage, scene);
  } else {
    /* document 등 기타 모드 — 기존 통합 렌더(legacy) 유지 */
    _renderSceneLegacy(stage, scene, presentationMode, presentationSubmode);
  }

  /* 이벤트 바인딩 — 모드 무관 공통 */
  _bindSceneEvents(stage, scene);

  /* edit 모드: overlay 드래그 + 선택 테두리 초기화 */
  if (ViewerState.editMode && typeof initEditInteractions === 'function') {
    initEditInteractions();
  }
}

/* ================================================================
   모드별 렌더 — v0.3 기본형 (2단계)
   ================================================================
   공통 원칙:
   · 장면 모드가 곧 레이아웃 — 한 장면당 하나의 모드별 stage 구조
   · 버튼은 항상 영역의 맨 아래 (모드별로 영역 정의 다름)
   · 일반글(body) 있으면 항상 버튼 위
   · 누르는 요소(choices) 1개 이상 필수 (validation은 viewer-edit에서)

   현재 구조에서 choice의 placement(bottom/overlay)는 v0.3에서 의미 약화됨.
   v0.3 기본형은 "각 모드의 정해진 영역 맨 아래"가 표준. 이번 턴에서는
   placement 무시하고 모드별 영역으로 직접 보냄. (메모리에는 placement
   유지되어 있어 데이터 손실 없음.)
   ================================================================ */

/* ── 모드 1: 텍스트형 (text) ──
   구조: [분위기 배경] + [중앙 카드: 제목 → 본문 → 버튼]
   분할 없음. textBox 시스템으로 카드 위치/크기 자유조정 가능. */
function _renderSceneText(stage, scene) {
  const choices  = Array.isArray(scene.choices) ? scene.choices : [];
  const bgImage  = scene.imageData || null;

  /* 배경 — 이미지 있으면 분위기 배경, 없으면 단색 (분위기 슬롯 자리) */
  const bgHtml = bgImage
    ? `<div class="scene-bg" style="background-image:url('${bgImage}')"></div>
       <div class="scene-bg-overlay"></div>`
    : `<div class="scene-bg-solid"></div>`;

  /* 중앙 카드 — textBox 시스템 (text 모드만 자유조정 허용)
     데이터: scene.textBox = { x, y, width, height, ... } (memory %, optional)
     없으면 기본 위치/크기. 가시성 clamp는 CSS clamp + JS 보정. */
  const tbStyle = _buildTextBoxStyleForText(scene);
  const cardHtml = _renderSceneCard(scene, choices);

  stage.innerHTML = `
    <div class="scene-screen scene-screen--text"
      data-display="${scene.displayType}"
      data-scene-num="${escHtml(String(scene.id))}"
      data-presentation-mode="text">
      ${bgHtml}
      <div class="scene-content scene-content--text">
        <div class="text-card js-text-card" ${tbStyle ? `style="${tbStyle}"` : ''}>
          ${cardHtml}
        </div>
      </div>
    </div>`;
}

/* 텍스트 카드 안 내용 — 제목 → 본문 → 버튼 */
function _renderSceneCard(scene, choices) {
  const title = String(scene.title || '').trim();
  const body  = String(scene.body  || '').trim();
  const isLong = scene.textLength === 'long';

  const titleHtml = title
    ? `<h3 class="text-card__title">${escHtml(title)}</h3>` : '';
  const bodyHtml  = body
    ? `<p class="text-card__body${isLong ? ' text-card__body--scroll' : ''}">${escHtml(body)}</p>` : '';

  /* 버튼 영역 — 카드 안 맨 아래. v0.3 텍스트형은 좌측정렬 세로 */
  const btns = choices.map(c => _v03ChoiceBtnHtml(scene, c, 'text')).join('');
  const btnsHtml = `<div class="text-card__actions">${btns}</div>`;

  return `${titleHtml}${bodyHtml}${btnsHtml}`;
}

/* ── 모드 2: 그림책형 (picturebook) ──
   구조: 화면 분할 (TB 기본 50:50, LR 선택 50:50)
        그림 영역 + 텍스트 영역 (제목 → 본문 → 버튼)
   버튼은 텍스트 영역 안에만, 그림 침범 금지.
   submode: 'spread' = LR(좌우), 'stage' = TB(상하). 기본은 'stage'(TB). */
function _renderScenePicturebook(stage, scene, submode) {
  const choices = Array.isArray(scene.choices) ? scene.choices : [];
  const bgImage = scene.imageData || null;
  /* TB 기본 — submode가 명확히 'spread'(LR)일 때만 LR */
  const isLR = submode === 'spread';
  const layoutClass = isLR ? 'pb--lr' : 'pb--tb';

  /* 그림 영역 — 이미지 있으면 표시, 없으면 placeholder (감상자에게도 표시) */
  const illustHtml = bgImage
    ? `<div class="pb-illust" style="background-image:url('${bgImage}')"></div>`
    : `<div class="pb-illust pb-illust--empty">
         <div class="pb-empty-mark">⌘</div>
       </div>`;

  /* 텍스트 영역 — 제목 → 본문 → 버튼 */
  const title = String(scene.title || '').trim();
  const body  = String(scene.body  || '').trim();
  const titleHtml = title
    ? `<h3 class="pb-text__title">${escHtml(title)}</h3>` : '';
  const bodyHtml  = body
    ? `<p class="pb-text__body">${escHtml(body)}</p>` : '';
  const btns = choices.map(c => _v03ChoiceBtnHtml(scene, c, 'picturebook')).join('');

  stage.innerHTML = `
    <div class="scene-screen scene-screen--pb ${layoutClass}"
      data-display="${scene.displayType}"
      data-scene-num="${escHtml(String(scene.id))}"
      data-presentation-mode="picturebook"
      data-presentation-submode="${isLR ? 'spread' : 'stage'}">
      <div class="pb-frame">
        ${illustHtml}
        <div class="pb-text">
          ${titleHtml}
          ${bodyHtml}
          <div class="pb-text__actions">${btns}</div>
        </div>
      </div>
    </div>`;
}

/* ── 모드 3: 무비형 (movie) ──
   구조: 위 미디어(어두운 프레임) + 아래 결정 패널(light)
   결정 패널: 자연 높이 + 최대 40%, 넘치면 내부 스크롤
   설명문(body) 선택, 버튼 필수. 미디어 위에 글/버튼 안 올림. */
function _renderSceneMovie(stage, scene) {
  const choices = Array.isArray(scene.choices) ? scene.choices : [];
  const md = (typeof getMovieData === 'function') ? getMovieData(scene) : {};
  const poster = (typeof resolveMoviePoster === 'function')
    ? resolveMoviePoster(scene) : null;

  /* 미디어 영역 — poster가 있으면 표시, 영상 url(다음 단계) 있으면 video.
     없으면 placeholder. 어두운 프레임 톤 유지. */
  let mediaInner;
  if (poster) {
    mediaInner = `<div class="movie-poster" style="background-image:url('${poster}')"></div>`;
    if (md.videoUrl) {
      /* 영상 컨트롤 — 의사 표시. 실제 video 태그는 다음 단계 */
      mediaInner += `<div class="movie-controls" aria-hidden="true">
        <span class="movie-controls__play">▶</span>
      </div>`;
    }
  } else {
    mediaInner = `<div class="movie-poster movie-poster--empty">
      <div class="movie-empty-mark">▶</div>
    </div>`;
  }

  /* 결정 패널 — body(설명문) optional + 버튼 */
  const body = String(scene.body || '').trim();
  const bodyHtml = body
    ? `<p class="movie-decision__desc">${escHtml(body)}</p>` : '';

  /* 버튼 배열 — v0.3: 1개=세로, 2개=폭 충분하면 가로(CSS data 속성으로 분기), 3+개=세로 */
  const btnCount = choices.length;
  const btnLayout = btnCount === 2 ? 'pair' : 'stack';
  const btns = choices.map(c => _v03ChoiceBtnHtml(scene, c, 'movie')).join('');

  /* 무비형 메타 데이터 속성 — 기존 captionMode/choiceReveal 유지 */
  const movieAttrs =
    ` data-movie-caption="${md.captionMode || 'overlay'}"` +
    ` data-movie-reveal="${md.choiceReveal || 'end'}"` +
    (md.videoUrl ? ' data-movie-has-video="true"' : '');

  stage.innerHTML = `
    <div class="scene-screen scene-screen--movie"
      data-display="${scene.displayType}"
      data-scene-num="${escHtml(String(scene.id))}"
      data-presentation-mode="movie"${movieAttrs}>
      <div class="movie-media">
        ${mediaInner}
      </div>
      <div class="movie-decision">
        ${bodyHtml}
        <div class="movie-decision__actions" data-btn-layout="${btnLayout}">
          ${btns}
        </div>
      </div>
    </div>`;
}

/* ── 모드 N: legacy (document 등) ──
   기존 통합 렌더 그대로 — v0.3 기본형이 적용 안 된 모드 보존용.
   document는 보류 상태이므로 깨지지 않게 그대로 유지. */
function _renderSceneLegacy(stage, scene, presentationMode, presentationSubmode) {
  /* 이미지 배경 */
  const _movieMode = presentationMode === 'movie';  // 안 올 케이스지만 안전
  const effectiveBgImage = _movieMode && typeof resolveMoviePoster === 'function'
    ? resolveMoviePoster(scene)
    : scene.imageData;
  const bgHtml = effectiveBgImage
    ? `<div class="scene-bg" style="background-image:url('${effectiveBgImage}')"></div>
       <div class="scene-bg-overlay"></div>`
    : `<div class="scene-bg-solid"></div>`;

  const textHtml = renderTextBox(scene);

  /* 선택지 — 기존 placement 분리 그대로 */
  const bottomChoices  = scene.choices.filter(c => c.presentation.placement === 'bottom');
  const overlayChoices = scene.choices.filter(c => c.presentation.placement === 'overlay');
  const bottomHtml  = bottomChoices.length  ? renderBottomChoices(scene, bottomChoices)  : '';
  const overlayHtml = overlayChoices.length ? renderOverlayChoices(scene, overlayChoices) : '';

  const audioHtml = scene.narrationAudio
    ? `<button class="audio-btn js-audio-toggle" title="음성 재생">🔊</button>` : '';

  let movieAttrs = '';
  if (_movieMode && typeof getMovieData === 'function') {
    const md = getMovieData(scene);
    movieAttrs =
      ` data-movie-caption="${md.captionMode}" data-movie-reveal="${md.choiceReveal}"` +
      (md.videoUrl ? ' data-movie-has-video="true"' : '');
  }

  stage.innerHTML = `
    <div class="scene-screen"
      data-display="${scene.displayType}"
      data-text-len="${scene.textLength}"
      data-scene-num="${escHtml(String(scene.id))}"
      data-presentation-mode="${presentationMode}"${presentationSubmode ? ` data-presentation-submode="${presentationSubmode}"` : ''}${movieAttrs}${scene.textAnchor ? ` data-text-anchor="${scene.textAnchor}"` : ''}>
      ${bgHtml}
      <div class="scene-content">
        ${textHtml}
        ${overlayHtml}
      </div>
      ${bottomHtml}
      ${audioHtml}
    </div>`;
}

/* ================================================================
   v0.3 버튼 HTML — 모드별 클래스 부여
   기존 _choiceButtonHtml과 별도. 기존 함수는 legacy 경로에서 계속 사용.
   ================================================================ */
function _v03ChoiceBtnHtml(scene, choice, mode) {
  const disabled = !choice.nextId ? 'disabled' : '';
  const label    = String(choice.label || '').trim() || '(빈 버튼)';
  const isEmpty  = !String(choice.label || '').trim();
  const emptyClass = isEmpty ? ' choice-v03--empty' : '';
  return `<button class="choice-v03 choice-v03--${mode} js-choice${emptyClass}"
    data-choice-id="${escHtml(choice.id)}" ${disabled}>
    ${escHtml(label)}
  </button>`;
}

/* ================================================================
   textBox 시스템 — text 모드 전용
   v0.3: 텍스트형의 textBox 자유조정은 허용하되, 최소 크기 ·
   화면 내 유지 · 버튼 영역 가시성은 항상 보장.

   메모리 표준: scene.textBox = {
     x: percent (center 기준 0-100),
     y: percent (center 기준 0-100),
     width: percent (10-95),
     height: percent (auto 가능 — null이면 콘텐츠 높이),
   }
   부재 시 기본값으로 fallback (중앙, 60% 폭).
   clamp 정책: 최소 폭 30%, 최소 높이 25%, 좌상단 5% 이상, 우하단 95% 이하.
   ================================================================ */
const TEXTBOX_DEFAULTS = {
  x: 50, y: 50,        // center%, percent
  width: 60,           // %
  height: null,        // auto
};
const TEXTBOX_CLAMP = {
  minWidth: 30,        // %
  minHeight: 25,       // % (height 명시된 경우)
  marginPct: 5,        // 화면 가장자리 안전 여백 %
};

function _resolveTextBox(scene) {
  const raw = (scene && typeof scene.textBox === 'object' && scene.textBox) ? scene.textBox : {};
  const t = {
    x:      typeof raw.x      === 'number' ? raw.x      : TEXTBOX_DEFAULTS.x,
    y:      typeof raw.y      === 'number' ? raw.y      : TEXTBOX_DEFAULTS.y,
    width:  typeof raw.width  === 'number' ? raw.width  : TEXTBOX_DEFAULTS.width,
    height: typeof raw.height === 'number' ? raw.height : TEXTBOX_DEFAULTS.height,
  };
  /* 가시성 clamp */
  t.width  = Math.max(TEXTBOX_CLAMP.minWidth,  Math.min(95, t.width));
  if (t.height !== null) t.height = Math.max(TEXTBOX_CLAMP.minHeight, Math.min(90, t.height));
  /* 중심 좌표가 화면 안에 있도록 */
  const halfW = t.width / 2;
  const minX = halfW + TEXTBOX_CLAMP.marginPct - 5;   // 너무 빡빡하게 자르지 않음
  const maxX = 100 - halfW - TEXTBOX_CLAMP.marginPct + 5;
  t.x = Math.max(minX, Math.min(maxX, t.x));
  t.y = Math.max(TEXTBOX_CLAMP.marginPct, Math.min(100 - TEXTBOX_CLAMP.marginPct, t.y));
  return t;
}

function _buildTextBoxStyleForText(scene) {
  const t = _resolveTextBox(scene);
  /* center 기준 → CSS는 left/top + transform: translate(-50%,-50%) */
  const parts = [
    `left:${t.x}%`,
    `top:${t.y}%`,
    `width:${t.width}%`,
  ];
  if (t.height !== null) parts.push(`height:${t.height}%`);
  /* transform은 CSS 기본값에 두기 — 여기서 inline으로 안 박아 CSS가 통제 */
  return parts.join(';');
}

function renderTextBox(scene) {
  const isLong   = scene.textLength === 'long';
  const title    = String(scene.title || '').trim();
  const body     = String(scene.body  || '').trim();
  /* UX 마감 (1-2): 둘 다 비어있으면 text-box 자체를 렌더하지 않음 —
     빈 유리 박스가 장면 위에 떠있는 어색한 상태 방지 */
  if (!title && !body) return '';

  const titleHtml = title
    ? `<h3 class="text-box__title">${escHtml(title)}</h3>`
    : '';
  const bodyHtml  = body
    ? `<p class="text-box__body${isLong ? ' text-box__body--scroll' : ''}">${escHtml(body)}</p>`
    : '';

  /* data-has-title / data-has-body 속성 — CSS에서 각 상태 조합별 조정
     data-scene-num — clue의 자료 번호 배지용 (CSS attr()는 같은 요소 속성만 읽음) */
  return `
    <div class="text-box text-box--${scene.textLength}"
      data-scene-num="${escHtml(String(scene.id))}"${title ? ' data-has-title="true"' : ''}${body ? ' data-has-body="true"' : ''}>
      ${titleHtml}${bodyHtml}
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
  const preset = choice.presentation.stylePreset || 'basic';
  const p      = choice.presentation;
  const disabled = !choice.nextId ? 'disabled' : '';

  /* fontSize / padding / minW가 presentation에 있으면 inline style로 적용
     없으면 CSS 기본값 사용 */
  const styleArr = [];
  if (p.fontSize) styleArr.push(`font-size:${p.fontSize}`);
  if (p.padding)  styleArr.push(`padding:${p.padding}`);
  if (p.minW)     styleArr.push(`min-width:${p.minW}px`);
  const inlineStyle = styleArr.length ? ` style="${styleArr.join(';')}"` : '';

  return `<button class="choice-btn choice-btn--${type} choice-preset--${preset} js-choice"
    data-choice-id="${escHtml(choice.id)}" ${disabled}${inlineStyle}>
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
        <p class="terminal-body">${escHtml(scene.title || scene.body || '')}</p>
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
          return s ? `<div class="explore-recent-item">• ${escHtml((s.title || s.body || '').slice(0,20) || `장면 ${id}`)}</div>` : '';
        }).join('')}
      </div>` : '';

  stage.innerHTML = `
    <div class="terminal-screen terminal-screen--explore">
      ${bgHtml}
      <div class="terminal-content terminal-content--explore">
        <div class="terminal-icon terminal-icon--explore">🗺</div>
        <h2 class="terminal-title terminal-title--explore">탐색 지점 도달</h2>
        <p class="terminal-body">${escHtml(scene.title || scene.body || '')}</p>

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

  /* ✕ 버튼 동작:
     - editMode / _testingEdit 중: entry 화면 대신 edit로 복귀
     - fromMaker: maker로 복귀
     - 그 외: entry 화면 */
  /* ✕ 버튼 동작 (역할별 분기):
     - _testingEdit 중: 감상 테스트 종료 → edit로 복귀 (장면 유지)
     - editMode(fromMaker): 편집 종료 → maker로 복귀 (window.close 또는 저장 URL)
     - 감상 중 fromMaker: maker로 복귀
     - 일반 감상 (direct entry): entry 화면 */
  hud.querySelector('.js-hud-exit')?.addEventListener('click', () => {
    if (ViewerState._testingEdit) {
      /* 감상 테스트 → edit 복귀 (entry 금지, 현재 장면 유지) */
      ViewerState.editMode     = true;
      ViewerState._testingEdit = false;
      document.getElementById('edit-test-banner')?.remove();
      renderCurrentScene();
      return;
    }
    if (ViewerState.editMode && ViewerState.fromMaker) {
      /* 편집 종료 → maker로 복귀 */
      _returnToMaker();
      return;
    }
    if (ViewerState.fromMaker) {
      /* 감상 중 fromMaker → maker로 복귀 */
      _returnToMaker();
      return;
    }
    /* 일반 direct 감상 → entry 화면 */
    showEntryScreen();
  });

  /* fromMaker 전용 */
  hud.querySelector('.js-return-to-maker')?.addEventListener('click', _returnToMaker);

  hud.querySelector('.js-go-edit')?.addEventListener('click', () => {
    ViewerState.editMode = true;
    ViewerState.selectedChoiceId = null;
    renderCurrentScene();
  });
}

/* ================================================================
   maker/admin 복귀 공통 함수 (fallback 안정화)
   ─────────────────────────────────────────────────────────────
   저장 구조: localStorage['branchReturnContext'] = JSON
     { source: 'maker' | 'admin', url: string, savedAt: number }

   흐름:
   1. context 읽기 (아직 삭제 X)
   2. 오래된 context(1시간 이상) 무시
   3. window.opener가 살아있으면 close() 시도 + 실패 감지용 setTimeout
   4. close 실패 또는 opener 없음 → context.url로 이동 (source별로 정리)
   5. context 전혀 없음 → source fallback 없이 maker.html 기본 입장
   ─────────────────────────────────────────────────────────────*/
function _returnToMaker() {
  const CTX_KEY  = 'branchReturnContext';
  const MAX_AGE  = 60 * 60 * 1000; // 1시간

  /* 1. context 파싱 + 즉시 삭제 — 진짜 1회성 return token
     close 성공/실패 무관하게 localStorage에 stale 값이 남지 않게 */
  let ctx = null;
  try {
    const raw = localStorage.getItem(CTX_KEY);
    localStorage.removeItem(CTX_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.url && (Date.now() - (parsed.savedAt || 0) < MAX_AGE)) {
        ctx = parsed;
      }
    }
  } catch (e) { /* JSON 파싱 실패 → ctx = null */ }

  /* 2. fallback URL 결정 (메모리의 ctx만 사용) */
  const fallbackUrl = _resolveFallbackUrl(ctx);

  /* 3. opener 살아있으면 close 시도 */
  if (window.opener && !window.opener.closed) {
    /* close 성공 시 탭이 즉시 사라지므로 setTimeout은 실행되지 않음.
       close가 브라우저 정책에 막혀 실패하면 setTimeout 콜백이 실행되어 URL 이동 */
    setTimeout(() => {
      /* 여기까지 왔다 = close 실패. 메모리의 fallbackUrl로 이동 */
      window.location.href = fallbackUrl;
    }, 150);
    try {
      window.close();
    } catch (e) {
      /* close 자체가 throw — 즉시 fallback */
      window.location.href = fallbackUrl;
    }
    return;
  }

  /* 4. opener 없음 → fallback URL 이동 */
  window.location.href = fallbackUrl;
}

/* context.source에 따라 적절한 복귀 URL 결정 */
function _resolveFallbackUrl(ctx) {
  if (!ctx || !ctx.url) return 'maker.html';

  if (ctx.source === 'admin') {
    /* admin URL을 그대로 사용 — ?admin=1 포함된 상태로 teacher-auth 체크 거침.
       admin이 로그인 세션 유지 중이면 바로 통과, 세션 만료면 teacher-auth로 유도. 둘 다 의도된 흐름. */
    return ctx.url;
  }

  if (ctx.source === 'maker') {
    /* maker URL — ?admin=1 제거 후, ?resume=1 추가
       resume=1 신호로 maker 로드 시 sessionStorage.makerSession 읽어 자동 입장 시도.
       세션이 살아있으면 재입장 화면 없이 바로 작업 화면으로 진입. */
    let clean = ctx.url
      .replace(/[?&]admin=1/g, '')
      .replace(/\?$/, '')
      .replace(/&$/, '');
    if (!clean.includes('maker.html')) return 'maker.html?resume=1';

    /* 이미 resume=1이 있으면 중복 추가 금지 */
    if (/[?&]resume=1/.test(clean)) return clean;

    const sep = clean.includes('?') ? '&' : '?';
    return clean + sep + 'resume=1';
  }

  return 'maker.html';
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
