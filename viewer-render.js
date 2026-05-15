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

  /* edit 모드: safe-area 힌트 표시 + frame 클래스 + body 클래스 (전역 CSS용) */
  const safeHint = document.getElementById('safe-area-hint');
  if (safeHint) safeHint.classList.toggle('hidden', !ViewerState.editMode);
  stage.classList.toggle('edit-mode-on', ViewerState.editMode);
  document.body.classList.toggle('edit-mode-active', ViewerState.editMode);

  /* W9: 다듬기 모드 ↔ 감상 모드 전환 시 viewer-frame 비율 재계산 필요 (portrait 작품용).
     · 다듬기: 16:9 / 감상 portrait 작품: 210:297. 그 외: 16:9. */
  if (typeof window._applyLetterbox === 'function') window._applyLetterbox();

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

  /* v36: 감상 테스트 중 배너 호출 제거 — 사용자 결정.
     라벨이 이미 maker-return-bar의 "✏️ 제작자 테스트 중"에 있어 중복.
     기존 어두운 파란 배너가 콘텐츠 위에 겹쳐 가리던 문제 해결. */
  document.getElementById('edit-test-banner')?.remove();
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

  /* v37: cover scene이 scenes에 있으면 그 데이터 우선. 없으면 project.coverTitle fallback */
  const coverScene = (ViewerState.scenes && typeof ViewerState.scenes === 'object')
    ? Object.values(ViewerState.scenes).find(s => s && s.type === 'cover')
    : null;
  const title     = (coverScene && coverScene.title)
    || p.coverTitle || '이야기 시작';
  const subtitle  = (coverScene && coverScene.subtitle) || '';
  const coverTheme = (coverScene && coverScene.coverTheme) || 'default';
  const titleVPos = (coverScene && typeof coverScene.titleVerticalPosition === 'number')
    ? coverScene.titleVerticalPosition : 50;
  /* 표지는 그림 없음 정책 (사용자 결정). project.coverImageData fallback만 (옛 작품) */
  const imageData = (coverScene ? null : p.coverImageData) || null;
  const hasImage  = !!imageData;

  /* v37 (재): 표지 두 모드
     - 그림 있음: 메인 장면 구조 (위 그림 / 아래 텍스트)
     - 그림 없음: 책 표지 분위기 (페이지 전체에 텍스트만, 위·중간·아래 3분할) */
  if (hasImage) {
    stage.innerHTML = `
      <div class="scene-screen scene-screen--pb pb--split cover-as-pb"
           data-presentation-mode="picturebook"
           data-presentation-submode="split">
        <div class="pb-page">
          <div class="pb-frame">
            <div class="pb-illust" data-pb-illust="1">
              <div class="pb-illust__photo" data-pb-photo="1">
                <img class="pb-illust__inner" src="${imageData}" draggable="false" alt="">
              </div>
            </div>
            <div class="pb-text pb-text--cover">
              <div class="cover-team-label">${escHtml(teamName)}</div>
              <h1 class="cover-title-pb">${escHtml(title)}</h1>
              <button class="cover-start-btn js-cover-start">▶ 시작하기</button>
            </div>
          </div>
        </div>
      </div>`;
    if (typeof _setupPbPhotoWrappers === 'function') _setupPbPhotoWrappers(stage);
  } else {
    /* v37: 그림 없는 표지 — 책 표지 인쇄 분위기.
       제목 높낮이: titleVPos 20~80 → top/bottom grid 비율 동적. */
    const classId = p.classId || '';
    const topFr = titleVPos / 50;                  // 20→0.4fr, 50→1fr, 80→1.6fr
    const bottomFr = (100 - titleVPos) / 50;       // 20→1.6fr, 50→1fr, 80→0.4fr
    stage.innerHTML = `
      <div class="scene-screen scene-screen--pb pb--split cover-as-pb cover-as-pb--text"
           data-presentation-mode="picturebook"
           data-presentation-submode="split"
           data-cover-mode="text"
           data-cover-theme="${escHtml(coverTheme)}">
        <div class="pb-page">
          <div class="cover-book" style="grid-template-rows: ${topFr}fr 2fr ${bottomFr}fr;">
            <div class="cover-book__top">
              <div class="cover-team-label">
                ${classId ? `<span class="cover-class-code">${escHtml(classId)}</span><span class="cover-sep">·</span>` : ''}
                <span class="cover-team-name">${escHtml(teamName)}</span>
              </div>
            </div>
            <div class="cover-book__center">
              <h1 class="cover-title-pb">${escHtml(title)}</h1>
              <div class="cover-book__deco">✦</div>
              ${subtitle ? `<p class="cover-subtitle-pb">${escHtml(subtitle)}</p>` : ''}
            </div>
            <div class="cover-book__bottom">
              <button class="cover-start-btn js-cover-start">▶ 시작하기</button>
            </div>
          </div>
        </div>
      </div>`;
  }

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

  /* v37: 표지 scene이면 renderCover 호출 (다듬기 모드 포함). 일반 장면 분기 안 거침. */
  if (scene && scene.type === 'cover') {
    renderCover();
    return;
  }

  /* 모드 결정 (4단계 갱신) — 작품 단위 projectType이 1단계에서 도입됨.
     우선순위:
       1. ViewerState.project.projectType (작품 단위 type, 1단계 도입)
       2. scene.presentationMode (legacy scene 단위 모드 — fallback)
       3. 'picturebook' fallback
     experience는 4단계에서 정식 분기 — _renderSceneExperience 호출. */
  const VALID_PTYPES = ['text', 'picturebook', 'movie', 'experience'];
  const projectType = (ViewerState && ViewerState.project &&
                       typeof ViewerState.project.projectType === 'string' &&
                       VALID_PTYPES.includes(ViewerState.project.projectType))
    ? ViewerState.project.projectType
    : null;

  let presentationMode;
  if (projectType) {
    presentationMode = projectType;
  } else {
    presentationMode = (typeof resolvePresentationMode === 'function')
      ? resolvePresentationMode(scene) : 'picturebook';
  }

  /* 그림책형 하위 모드 결정 (4단계).
     · 새 명시 필드 scene.picturebookSubmode 우선: 'split' | 'imageCenter'
     · 없으면 legacy presentationSubmode 무시하고 'split' 기본 (LR 폐기 정책)
     · 'spread'(LR) 값은 데이터 보존하되 'split'으로 fallback (사용자 원칙: LR 없음) */
  let pbSubmode = 'split';
  if (presentationMode === 'picturebook') {
    if (scene && scene.picturebookSubmode === 'imageCenter') pbSubmode = 'imageCenter';
    else                                                     pbSubmode = 'split';
  }

  /* W4 진단 (사용자 보고 케이스 — 그림 안 보임, 분기 모호):
     console + DOM 둘 다 출력. 한 사이클 안정되면 제거. */
  /* W4 안정 확인 완료 (사용자 검증 통과) — 진단 코드 제거됨. 필요시 git 이력에서 복구 가능. */

  /* 모드별 렌더 분기 (v0.3 — 4단계 갱신) */
  if (presentationMode === 'text') {
    _renderSceneText(stage, scene);
  } else if (presentationMode === 'picturebook') {
    _renderScenePicturebook(stage, scene, pbSubmode);
  } else if (presentationMode === 'movie') {
    _renderSceneMovie(stage, scene);
  } else if (presentationMode === 'experience') {
    _renderSceneExperience(stage, scene);
  } else {
    /* document 등 기타 모드 — 기존 통합 렌더(legacy) 유지 */
    const legacySub = (typeof resolvePresentationSubmode === 'function')
      ? resolvePresentationSubmode(scene) : null;
    _renderSceneLegacy(stage, scene, presentationMode, legacySub);
  }

  /* W4 진단 — 어떤 분기로 갔는지 화면 우상단에 항상 표시.
     사용자 화면 보고 어디서 빠졌는지 즉시 진단 가능. */
  /* W4 안정 확인 완료 — 진단 배너 DOM 제거됨. */

  /* 이벤트 바인딩 — 모드 무관 공통 */
  _bindSceneEvents(stage, scene);

  /* W8: 렌더 후 글자 스타일 CSS 변수 적용 — 첫 진입/장면 전환 시에도 textStyle 반영.
     사용자가 다듬기에서 바꿀 때는 _patchTextStyle/_patchPbStyle 별도 호출. */
  try {
    if (typeof _patchTextStyle === 'function') _patchTextStyle();
    if (typeof _patchPbStyle   === 'function') _patchPbStyle();
  } catch (e) { /* noop */ }

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

  /* W5: 텍스트형 테마 + 글자 스타일 + 효과 적용
     · data-text-theme: 8종 테마 CSS 분기
     · inline style: 글자 스타일 (CSS 변수로 카드 안에 흘려넣음)
     · data-text-entrance/data-text-body: 효과 클래스 */
  const theme  = (typeof getTextTheme  === 'function') ? getTextTheme(scene)  : 'classic';
  const style  = (typeof getTextStyle  === 'function') ? getTextStyle(scene)  : null;
  const effect = (typeof getTextEffect === 'function') ? getTextEffect(scene) : null;

  /* CSS 변수 — text-card에 적용. 빈 값은 CSS 기본값 사용. */
  const cssVars = [];
  if (style) {
    if (style.fontFamily) cssVars.push(`--text-ff: var(--font-${style.fontFamily})`);
    if (style.fontSize)   cssVars.push(`--text-fs-body: ${style.fontSize}px`);
    if (style.color)      cssVars.push(`--text-color-override: ${style.color}`);
    if (style.weight)     cssVars.push(`--text-weight: ${style.weight}`);
  }
  const styleAttr = cssVars.length > 0 ? ` style="${cssVars.join(';')}"` : '';

  /* v37: 텍스트 모드도 페이지 카드 portrait 비율 고정 — 디바이스 무관 동일 보임.
     사용자: "지금 맥북·태블릿에서 다 다르게 나옴. 비율 아예 고정해야". */
  stage.innerHTML = `
    <div class="scene-screen scene-screen--text scene-screen--text-paged"
      data-display="${scene.displayType}"
      data-scene-num="${escHtml(String(scene.id))}"
      data-presentation-mode="text"
      data-text-theme="${escHtml(theme)}"
      ${effect ? `data-text-entrance="${escHtml(effect.entrance)}"` : ''}
      ${effect ? `data-text-body="${escHtml(effect.body)}"` : ''}
      ${styleAttr}>
      ${bgHtml}
      <div class="text-page">
        <div class="text-card js-text-card">
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
  const btns = _v03FilterChoices(choices).map(c => _v03ChoiceBtnHtml(scene, c, 'text')).join('');
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
  /* W4 디버그: 그림 데이터 소스 — viewer-edit은 imageData||imageUrl 둘 다 보고
     viewer-render는 이전엔 imageData만 봤음. 데이터 소스 일치를 위해 둘 다 본다. */
  const bgImage = scene.imageData || scene.imageUrl || null;
  const isEditMode = !!(ViewerState && ViewerState.editMode);

  /* 4단계 분기 — 새 명시 필드 picturebookSubmode 기반.
     · 'split'        : 분할형 (TB 60:40, mockup 'a_clean_ui_ux_mockup_screenshot...' 기준)
     · 'imageCenter'  : 그림 중심형 (TB 80:20, mockup 'a_clean_ui_mockup_app_screenshot_illustration_o' 기준)
     LR(spread)는 사용자 원칙으로 폐기 — 데이터는 보존하되 'split'으로 fallback. */
  const isImageCenter = submode === 'imageCenter';
  const layoutClass = isImageCenter ? 'pb--imagecenter' : 'pb--split';

  /* W8: textStyle 적용 — 그림책에도 글자 스타일 동일.
     변수는 --pb-* (CSS가 사용하는 변수, _patchPbStyle과 정합).
     사용자 보고: "굵게는 되는데 폰트·크기 안 됨" → 변수 이름 일치 + fontMap 정의 fix. */
  const style = (typeof getTextStyle === 'function') ? getTextStyle(scene) : null;
  const fontMap = (typeof TEXT_FONT_FAMILIES === 'object') ? TEXT_FONT_FAMILIES : {};
  const cssVars = [];
  if (style) {
    if (style.fontFamily && fontMap[style.fontFamily]) cssVars.push(`--pb-font-family: ${fontMap[style.fontFamily]}`);
    if (style.fontSize)   cssVars.push(`--pb-fs-body: ${style.fontSize}px`);
    if (style.color)      cssVars.push(`--pb-color-override: ${style.color}`);
    if (style.weight === 'bold') cssVars.push(`--pb-fw-body: 700`);
    else if (style.weight) cssVars.push(`--pb-fw-body: 400`);
  }
  const styleAttr = cssVars.length > 0 ? ` style="${cssVars.join(';')}"` : '';

  /* 그림 영역 — 이미지 있으면 표시, 없으면 placeholder.
     W9 (v10): 사용자 보고 "점선이 사진 둘레여야 + 자르기 후도 정확".
     구조: .pb-illust > .pb-illust__photo (사진 자연 비율 wrapper, JS aspect-ratio set)
       > <img class="pb-illust__inner">
     handle은 __photo에 박힘 = 사진 가장자리 정확. */
  const tr = scene.imageTransform || {};
  const trX  = (tr.posX   != null ? tr.posX   : 50) - 50;
  const trY  = (tr.posY   != null ? tr.posY   : 50) - 50;
  const trSX = (tr.scaleX != null ? tr.scaleX : 100) / 100;
  const trSY = (tr.scaleY != null ? tr.scaleY : 100) / 100;
  const cr = tr.crop;
  /* crop 적용:
     · 사진 비율은 (cropW/cropH) * naturalRatio로 변경 → JS에서 처리
     · img는 wrapper 100% 채우되 background-position(또는 transform translate)로 잘린 부분 offset */
  const cropX = cr ? cr.x : 0;
  const cropY = cr ? cr.y : 0;
  const cropW = cr ? cr.w : 100;
  const cropH = cr ? cr.h : 100;
  const photoVars =
    `--pb-img-x:${trX}%; --pb-img-y:${trY}%; ` +
    `--pb-img-sx:${trSX}; --pb-img-sy:${trSY}; ` +
    `--pb-crop-x:${cropX}; --pb-crop-y:${cropY}; ` +
    `--pb-crop-w:${cropW}; --pb-crop-h:${cropH};`;

  /* 텍스트 영역 — 제목 → 본문 → 버튼 */
  const title = String(scene.title || '').trim();
  const body  = String(scene.body  || '').trim();
  /* W8: 다듬기 모드에선 contenteditable — viewer에서 직접 수정 가능 + 다듬기 패널 양방향 동기화 */
  const isEdit = (typeof ViewerState !== 'undefined' && ViewerState.editMode);
  const editAttrs = isEdit ? 'contenteditable="true" data-pb-editable="title"' : '';
  const editAttrsBody = isEdit ? 'contenteditable="true" data-pb-editable="body"' : '';

  /* v36: 가로분할형은 8:2 비율로 그림 영역이 커서 하단 텍스트 영역에 제목까지 들어가면
     본문·버튼이 잘림. → 제목을 그림 좌상단 오버레이로 옮기고, 하단은 본문·버튼만.
     - 가로(landscape) + split 모드만 적용
     - 가로 imageCenter는 이미 .pb-stage__title-overlay로 잘 잡혀 있어 영향 없음
     - 세로 split은 6:4라 본문 공간 충분 → 기존 방식 유지 */
  const orient = (document.body && document.body.dataset.pageOrientation)
    || (ViewerState && ViewerState.project && ViewerState.project.pageOrientation)
    || 'landscape';
  const titleAsIllustOverlay = (orient !== 'portrait') && !isImageCenter;

  const titleOverlayInIllustHtml = (titleAsIllustOverlay && (title || isEdit))
    ? `<h3 class="pb-illust__title-overlay js-pb-editable-title" ${editAttrs} data-placeholder="(제목을 적어보세요)">${escHtml(title)}</h3>`
    : '';

  const illustHtml = bgImage
    ? `<div class="pb-illust" data-pb-illust="1">
         <div class="pb-illust__photo" style="${photoVars}" data-pb-photo="1">
           <img class="pb-illust__inner" src="${bgImage}" draggable="false" alt="">
         </div>
         ${titleOverlayInIllustHtml}
       </div>`
    : `<div class="pb-illust pb-illust--empty">
         <div class="pb-empty-mark">⌘</div>
         ${titleOverlayInIllustHtml}
       </div>`;

  /* 분할형: 가로면 제목은 그림 오버레이로 옮겼으니 텍스트 영역은 본문/버튼만.
     세로면 기존 방식 (텍스트 영역에 제목). */
  const titleHtml = (titleAsIllustOverlay || !(title || isEdit))
    ? ''
    : `<h3 class="pb-text__title js-pb-editable-title" ${editAttrs} data-placeholder="(제목을 적어보세요)">${escHtml(title)}</h3>`;
  const bodyHtml  = body || isEdit
    ? `<p class="pb-text__body js-pb-editable-body" ${editAttrsBody} data-placeholder="(본문을 적어보세요)">${escHtml(body)}</p>` : '';
  const filteredChoices = _v03FilterChoices(choices);
  const pbChoiceCount = filteredChoices.length;
  const btns = filteredChoices.map((c, i) => _v03ChoiceBtnHtml(scene, c, 'picturebook', i)).join('');

  /* 그림 중심형: 제목은 그림 위 상단 고정 / 본문은 그림 위 글상자.
     분할형: 제목/본문/선택지 모두 하단 텍스트 영역. */
  if (isImageCenter) {
    /* W4: 본문 글상자 위치/크기/배경막 동적 적용 — 다듬기에서 조정.
       다듬기 모드(editMode)에서는 ✥ 드래그 핸들 + 4 모서리 ⤡ 리사이즈 핸들 노출. */
    const bodyBox = (typeof getPicturebookBodyBox === 'function')
      ? getPicturebookBodyBox(scene)
      : { x: 15, y: 25, width: 55, height: null, backdropOpacity: 0.85 };
    /* 배경막 색상은 흰색 기준 — opacity로 강도 조절. 0이면 완전 투명, 1이면 완전 불투명.
       height: null이면 콘텐츠 자동, 숫자면 명시 높이 (W4: 사용자가 모서리 리사이즈로 박스 높이 명시 가능). */
    const heightStyle = (typeof bodyBox.height === 'number') ? ` height: ${bodyBox.height}%;` : '';
    const bodyOverlayStyle = body
      ? `left: ${bodyBox.x}%; top: ${bodyBox.y}%; width: ${bodyBox.width}%;${heightStyle}`
        + ` background: rgba(255, 255, 255, ${bodyBox.backdropOpacity});`
        + ` box-shadow: 0 2px 6px rgba(0,0,0,${0.08 * bodyBox.backdropOpacity});`
      : '';

    /* 다듬기 모드 — 드래그 핸들(가운데 ✥) + 리사이즈 핸들(4 모서리).
       감상 모드에서는 노출 X. mockup 기준: 제목은 고정(🔒), 본문 상자만 조절.
       isEdit는 위에서 이미 선언됨. */
    const editHandlesHtml = isEdit ? `
      <div class="pb-body-handle pb-body-handle--move js-pb-body-move" title="드래그하여 위치 이동">✥</div>
      <div class="pb-body-handle pb-body-handle--resize-nw js-pb-body-resize" data-corner="nw" title="크기 조절"></div>
      <div class="pb-body-handle pb-body-handle--resize-ne js-pb-body-resize" data-corner="ne" title="크기 조절"></div>
      <div class="pb-body-handle pb-body-handle--resize-sw js-pb-body-resize" data-corner="sw" title="크기 조절"></div>
      <div class="pb-body-handle pb-body-handle--resize-se js-pb-body-resize" data-corner="se" title="크기 조절"></div>
    ` : '';

    /* W4 디버그 정보 — 안정 확인 완료, 제거됨. */

    stage.innerHTML = `
      <div class="scene-screen scene-screen--pb ${layoutClass}"
        data-display="${scene.displayType}"
        data-scene-num="${escHtml(String(scene.id))}"
        data-presentation-mode="picturebook"
        data-presentation-submode="imageCenter"
        ${isEdit ? 'data-edit-mode="true"' : ''}
        ${styleAttr}>
        <div class="pb-page">
          <div class="pb-frame">
            <div class="pb-stage">
              ${illustHtml}
              ${title || isEdit ? `<div class="pb-stage__title-overlay js-pb-editable-title" ${isEdit ? 'contenteditable="true" data-pb-editable="title"' : ''} data-placeholder="(제목을 적어보세요)">${escHtml(title)}</div>` : ''}
              ${body || isEdit ? `<div class="pb-stage__body-overlay js-pb-body-overlay" style="${bodyOverlayStyle || 'left:15%; top:25%; width:55%; background:rgba(255,255,255,0.85);'}">
                <p class="pb-text__body js-pb-editable-body" ${isEdit ? 'contenteditable="true" data-pb-editable="body"' : ''} data-placeholder="(본문을 적어보세요)">${escHtml(body)}</p>
                ${editHandlesHtml}
              </div>` : ''}
            </div>
            <div class="pb-text pb-text--bottom-only">
              <div class="pb-text__actions-label" aria-hidden="true">행동 ${pbChoiceCount}개 <span class="pb-text__actions-label-arrow">↓</span></div>
              <div class="pb-text__actions" data-count="${pbChoiceCount}">${btns}</div>
            </div>
          </div>
        </div>
      </div>`;
    _setupPbPhotoWrappers(stage);
    return;
  }

  /* 분할형 (기본) — 위 그림 60 / 아래 텍스트+선택지 40 */
  stage.innerHTML = `
    <div class="scene-screen scene-screen--pb ${layoutClass}"
      data-display="${scene.displayType}"
      data-scene-num="${escHtml(String(scene.id))}"
      data-presentation-mode="picturebook"
      data-presentation-submode="split"
      ${styleAttr}>
      <div class="pb-page">
        <div class="pb-frame">
          ${illustHtml}
          <div class="pb-text">
            ${titleHtml}
            <div class="pb-text__body-wrap">
              ${bodyHtml}
              <div class="pb-text__actions-label" aria-hidden="true">행동 ${pbChoiceCount}개 <span class="pb-text__actions-label-arrow">↓</span></div>
            </div>
            <div class="pb-text__actions" data-count="${pbChoiceCount}">${btns}</div>
          </div>
        </div>
      </div>
    </div>`;

  /* W9 (v10): img 자연 비율 + crop 반영해 photo wrapper aspect-ratio 박음.
     handle/outline이 사진 둘레에 정확. */
  _setupPbPhotoWrappers(stage);
}

/* picturebook .pb-illust__photo wrapper들에 정확한 사이즈 박음.
   W9 (v13): wrapper = 사진 표시 영역과 정확히 동일. 점선이 사진 둘레 정확.
   1) img.onload로 자연 비율 받음
   2) 영역(.pb-illust) 사이즈와 비교
   3) wrapper width/height = % 단위로 계산 (영역에 contain된 사진 영역) */
function _setupPbPhotoWrappers(stage) {
  const photos = stage.querySelectorAll('.pb-illust__photo[data-pb-photo]');
  photos.forEach(photo => {
    const img = photo.querySelector('img.pb-illust__inner');
    const illust = photo.closest('.pb-illust');
    if (!img || !illust) return;

    const applySize = () => {
      const nw = img.naturalWidth, nh = img.naturalHeight;
      if (!nw || !nh) return;
      const areaW = illust.clientWidth, areaH = illust.clientHeight;
      if (!areaW || !areaH) return;
      const naturalRatio = nw / nh;
      const areaRatio = areaW / areaH;
      /* 사진이 영역보다 wide → 영역 width 가득, height 작음
         사진이 영역보다 narrow → 영역 height 가득, width 작음 */
      if (naturalRatio >= areaRatio) {
        photo.style.width = '100%';
        photo.style.height = (areaRatio / naturalRatio * 100).toFixed(3) + '%';
      } else {
        photo.style.height = '100%';
        photo.style.width = (naturalRatio / areaRatio * 100).toFixed(3) + '%';
      }
      /* aspect-ratio도 자연 비율로 (transform이 자연 비율 기준 동작하도록) */
      photo.style.aspectRatio = String(naturalRatio);
    };
    if (img.complete) applySize();
    else img.addEventListener('load', applySize, { once: true });

    /* 영역 사이즈 변화에 따라 wrapper 사이즈 재계산 */
    if (typeof ResizeObserver !== 'undefined' && !photo._roAttached) {
      const ro = new ResizeObserver(() => applySize());
      ro.observe(illust);
      photo._roAttached = true;
    }
  });
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

  /* 미디어 영역 — videoUrl 있으면 정식 <video> 태그 + 종료 이벤트 listener.
     영상 없으면 poster 또는 placeholder.
     ─────────────────────────────────────────────────────────────
     영상 재생 후 노출 흐름 (4단계 보강):
     · videoUrl 있음 → data-played="false"로 시작, 'ended' 이벤트로 "true" 전환
     · videoUrl 없음 → data-played="true" 즉시 (재생할 영상 없으니 노출 정상)
     · CSS에서 data-played="false"일 때 .movie-decision 숨김 → 영상 중 선택지/본문 안 보임 */
  const hasVideo = !!md.videoUrl;
  let mediaInner;
  if (hasVideo) {
    /* poster가 있으면 video의 poster 속성으로, 없으면 검은 배경 */
    const posterAttr = poster ? ` poster="${poster}"` : '';
    mediaInner = `<video class="movie-video js-movie-video" controls
      preload="metadata"${posterAttr}
      src="${md.videoUrl}"></video>`;
  } else if (poster) {
    mediaInner = `<div class="movie-poster" style="background-image:url('${poster}')"></div>`;
  } else {
    mediaInner = `<div class="movie-poster movie-poster--empty">
      <div class="movie-empty-mark">▶</div>
    </div>`;
  }

  /* 결정 패널 — body(설명문) optional + 버튼.
     bodyEnabled 명시 필드 (3단계 도입) 우선:
     · true  → 본문 표시 (body가 비어있어도 빈 상태로)
     · false → 본문 숨김 (사용자가 명시적으로 OFF)
     · null/undefined → fallback: body 존재 여부 (3단계까지의 임시 정책과 동일).
     영상 후 노출 흐름: 영상 재생 후 본문/선택지 노출 — 시각 분기는 CSS의
     data-movie-reveal 속성으로 처리, 여기선 데이터만 셋팅. */
  const body = String(scene.body || '').trim();
  const bodyEnabled = (scene.bodyEnabled === true) ? true
                    : (scene.bodyEnabled === false) ? false
                    : !!body;
  const bodyHtml = (bodyEnabled && body)
    ? `<p class="movie-decision__desc">${escHtml(body)}</p>`
    : '';

  /* 버튼 배열 — v0.3: 1개=세로, 2개=폭 충분하면 가로(CSS data 속성으로 분기), 3+개=세로 */
  const btnCount = choices.length;
  const btnLayout = btnCount === 2 ? 'pair' : 'stack';
  const btns = _v03FilterChoices(choices).map(c => _v03ChoiceBtnHtml(scene, c, 'movie')).join('');

  /* 무비형 메타 데이터 속성 — 기존 captionMode/choiceReveal + 본문 ON/OFF + 재생 상태 (4단계 신규)
     · data-played="false" : 영상 재생 전/중 — CSS에서 .movie-decision 숨김
     · data-played="true"  : 영상 종료 또는 영상 없음 — .movie-decision 노출
     초기값: videoUrl 있으면 "false", 없으면 "true". 'ended' 이벤트로 토글. */
  const initialPlayed = hasVideo ? 'false' : 'true';
  const movieAttrs =
    ` data-movie-caption="${md.captionMode || 'overlay'}"` +
    ` data-movie-reveal="${md.choiceReveal || 'end'}"` +
    ` data-body-enabled="${bodyEnabled ? 'on' : 'off'}"` +
    ` data-played="${initialPlayed}"` +
    (hasVideo ? ' data-movie-has-video="true"' : '');

  /* W7 깜빡임 차단 핵심: 매 재렌더마다 stage.innerHTML 통째 교체 → video 새로 마운트.
     같은 videoUrl이면 기존 <video> 노드를 보존해 재사용 → 영상 재로드 X = 깜빡임 X.
     1) 기존 .movie-video 찾기
     2) src 같으면 detach 후 새 stage 안에 reattach
     3) src 다르면 새 노드 (정상 마운트). */
  const existingVideo = stage.querySelector('.movie-video');
  const reuseVideo = (existingVideo && hasVideo && existingVideo.getAttribute('src') === md.videoUrl)
    ? existingVideo
    : null;

  stage.innerHTML = `
    <div class="scene-screen scene-screen--movie"
      data-display="${scene.displayType}"
      data-scene-num="${escHtml(String(scene.id))}"
      data-presentation-mode="movie"${movieAttrs}>
      <div class="movie-media">
        ${reuseVideo ? '' : mediaInner}
      </div>
      <div class="movie-decision">
        ${bodyHtml}
        <div class="movie-decision__actions" data-btn-layout="${btnLayout}">
          ${btns}
        </div>
      </div>
    </div>`;

  /* 보존한 video 노드를 새 .movie-media 안에 옮겨붙임 (재로드 X) */
  if (reuseVideo) {
    const newMedia = stage.querySelector('.movie-media');
    if (newMedia) newMedia.appendChild(reuseVideo);
  }
}

/* ── 모드 4: 체험전시형 (experience) ──
   설계문서 §8: 배경 이미지 위에 연결 오브젝트로 탐색하는 전시·안내형.
   구조:
   · 배경 이미지 전체 (없으면 placeholder)
   · 상단 제목 (있으면, 슬라이드형 헤더 톤)
   · 하단 안내문 (본문 있으면, 짧은 지시문/안내문 패널)
   · 일반 선택지 버튼 X — 연결 오브젝트가 그 자리를 대신
   · 연결 오브젝트는 정식 connectObjects 모델 미구현 → 임시로 buttons[]를
     하단 메뉴 형태로 표시 (사용자 원칙: 임시 집계)
   목표: 정식 connectObjects 데이터 모델 들어오기 전까지 viewer 탐색이 성립하기만. */
function _renderSceneExperience(stage, scene) {
  const bgImage = scene.imageData || scene.imageUrl || null;
  const isEdit = !!(ViewerState && ViewerState.editMode);

  const title = String(scene.title || '').trim();
  const body  = String(scene.body  || '').trim();

  /* W6: 정식 connectObjects 모델 — buttons[] 임시 집계 폐기.
     각 오브젝트는 배경 이미지 영역 위에 절대 위치(% 좌표)로 배치. */
  const connectObjects = (typeof getConnectObjects === 'function')
    ? getConnectObjects(scene) : [];

  const titleOverlayHtml = title
    ? `<div class="exp-title-overlay">${escHtml(title)}</div>` : '';
  const bodyPanelHtml = body
    ? `<div class="exp-body-panel"><p>${escHtml(body)}</p></div>` : '';

  const bgInner = bgImage
    ? `<div class="exp-bg" style="background-image:url('${bgImage}')"></div>`
    : `<div class="exp-bg exp-bg--empty">
         <div class="exp-empty-mark">🗺</div>
         <div class="exp-empty-hint">배경 이미지 없음</div>
       </div>`;

  /* 표준 시스템 네비 — 사용자가 connectObjects에 next/back/home 타입을 안 넣었을 때
     fallback으로 항상 보이는 모서리 네비. 이전 동작 유지.
     · 뒤로가기: historyStack 있을 때만 활성
     · 처음으로: 항상 활성 */
  const canGoBack = ViewerState && ViewerState.historyStack &&
                    ViewerState.historyStack.length > 0;
  const navBackBtn = `<button class="exp-nav-btn exp-nav-btn--back js-exp-nav-back"
    ${canGoBack ? '' : 'disabled'}
    title="뒤로가기">← 뒤로가기</button>`;
  const navHomeBtn = `<button class="exp-nav-btn exp-nav-btn--home js-exp-nav-home"
    title="처음으로">🏠 처음으로</button>`;

  /* 각 connectObject DOM 생성 */
  const objectsHtml = connectObjects.map(co => _renderConnectObjectHtml(co, isEdit)).join('');

  stage.innerHTML = `
    <div class="scene-screen scene-screen--experience"
      data-display="${scene.displayType}"
      data-scene-num="${escHtml(String(scene.id))}"
      data-presentation-mode="experience"
      ${isEdit ? 'data-edit-mode="true"' : ''}>
      ${bgInner}
      <div class="exp-objects-layer js-exp-objects-layer">
        ${objectsHtml}
      </div>
      <div class="exp-nav exp-nav--top-left">${navBackBtn}</div>
      <div class="exp-nav exp-nav--top-right">${navHomeBtn}</div>
      ${titleOverlayHtml}
      ${bodyPanelHtml}
    </div>`;
}

/* connectObject 단일 DOM — 타입별 시각 + 다듬기 모드 핸들 */
function _renderConnectObjectHtml(co, isEdit) {
  if (!co || !co.type) return '';
  const id    = escHtml(co.id || '');
  const label = escHtml(co.label || '');
  const styleStr = `left:${co.x}%;top:${co.y}%;width:${co.w}%;height:${co.h}%;`;

  /* 다듬기 모드 핸들 (W4 패턴 차용) */
  const editHandlesHtml = isEdit ? `
    <div class="co-handle co-handle--move js-co-move" title="드래그하여 위치 이동">✥</div>
    <div class="co-handle co-handle--resize-nw js-co-resize" data-corner="nw" title="크기 조절"></div>
    <div class="co-handle co-handle--resize-ne js-co-resize" data-corner="ne" title="크기 조절"></div>
    <div class="co-handle co-handle--resize-sw js-co-resize" data-corner="sw" title="크기 조절"></div>
    <div class="co-handle co-handle--resize-se js-co-resize" data-corner="se" title="크기 조절"></div>
  ` : '';

  /* 타입별 inner 콘텐츠 */
  let innerHtml = '';
  switch (co.type) {
    case 'button':
      innerHtml = `<span class="co-label">${label || '버튼'}</span>`;
      break;
    case 'arrow':
      innerHtml = `<span class="co-icon">→</span>${label ? `<span class="co-label">${label}</span>` : ''}`;
      break;
    case 'flag':
      innerHtml = `<span class="co-icon">🚩</span>${label ? `<span class="co-label">${label}</span>` : ''}`;
      break;
    case 'next':
      innerHtml = `<span class="co-icon">⏭</span><span class="co-label">${label || '다음'}</span>`;
      break;
    case 'back':
      innerHtml = `<span class="co-icon">⏮</span><span class="co-label">${label || '뒤로가기'}</span>`;
      break;
    case 'home':
      innerHtml = `<span class="co-icon">🏠</span><span class="co-label">${label || '처음으로'}</span>`;
      break;
    case 'invisible':
      /* 시각 없음 — 다듬기 모드만 점선 외곽 + 라벨 텍스트로 인지 가능하게 */
      innerHtml = isEdit ? `<span class="co-label co-label--invisible-hint">투명${label ? ': ' + label : ''}</span>` : '';
      break;
    default:
      innerHtml = `<span class="co-label">${label}</span>`;
  }

  return `
    <div class="connect-object connect-object--${co.type} js-connect-object"
      data-co-id="${id}"
      data-co-type="${co.type}"
      style="${styleStr}">
      ${innerHtml}
      ${editHandlesHtml}
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
/* 감상 화면용 choices 필터 — W2-A 잔여 정리.
   maker 카드의 input 항상 2개 정책으로 인해 빈 라벨 + 미연결 버튼이 buttons[]에
   남아있을 수 있음. 감상 화면에서 그런 빈 버튼을 표시하는 건 어색하므로 skip.
   기준: 라벨이 빈 채 AND nextId 없음 → 사용자가 의도한 버튼 아님 (빈 칸 잔재).
   라벨이 있거나 nextId 연결된 버튼은 표시 (미연결 + 라벨 있음 = 진짜 미연결 경고).  */
function _v03FilterChoices(choices) {
  if (!Array.isArray(choices)) return [];
  /* W8: 다듬기 모드 — 빈 선택지도 표시 (사용자 보고: "행동 버튼 추가 누르면 바로 안 나타나").
     감상 모드 — 라벨/다음 장면 둘 다 없으면 숨김 (실제 작품 흐름). */
  const isEdit = (typeof ViewerState !== 'undefined' && ViewerState.editMode);
  if (isEdit) {
    return choices.filter(c => !!c);
  }
  return choices.filter(c => {
    if (!c) return false;
    const hasLabel = String(c.label || '').trim().length > 0;
    const hasNext  = !!c.nextId;
    return hasLabel || hasNext;
  });
}

function _v03ChoiceBtnHtml(scene, choice, mode, idx) {
  const disabled = !choice.nextId ? 'disabled' : '';
  /* W8: 빈 라벨 placeholder — 사용자 보고 "(빈 버튼)" → 더 친절 안내 */
  const label    = String(choice.label || '').trim() || '(행동 버튼을 적어보세요)';
  const isEmpty  = !String(choice.label || '').trim();
  const emptyClass = isEmpty ? ' choice-v03--empty' : '';

  /* W8 그림책 따뜻한 디자인: 자식 3개 (번호 원 + 라벨 + 화살표).
     idx는 viewer-render의 map index로 호출 측에서 전달 (0-based → 표시는 +1).
     라벨 클래스 .pb-choice-label은 _patchChoiceLabel 실시간 반영용 타겟.
     색은 CSS의 .choice-v03--picturebook[data-pb-color="N"]로 결정 (1=sage, 2=sky, 3=coral, 4+ wrap). */
  if (mode === 'picturebook') {
    const colorIdx = ((idx != null ? idx : 0) % 3) + 1;  /* 1·2·3 순환 */
    return `<button class="choice-v03 choice-v03--picturebook js-choice${emptyClass}"
      data-choice-id="${escHtml(choice.id)}"
      data-pb-color="${colorIdx}"
      ${disabled}>
      <span class="pb-choice-num">${(idx != null ? idx : 0) + 1}</span>
      <span class="pb-choice-label">${escHtml(label)}</span>
      <span class="pb-choice-arrow" aria-hidden="true">›</span>
    </button>`;
  }

  /* 다른 모드(text/movie/legacy): 기존 구조 보존 */
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
  /* v37: 사용자 요청 — 텍스트 모드 기본 박스가 핸드폰/태블릿 세로에 꽉 차게.
     이전 width 60 → 88 (가로 거의 가득). height 명시 88 (세로도 거의 가득).
     글자 양에 따라 박스 크기 변하던 문제 해결 — 기본 박스 고정.
     사용자가 textBox 박은 데이터 있으면 그게 우선. */
  x: 50, y: 50,        // center%, percent
  width: 88,           // %
  height: 88,          // %
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

  /* 무비형 영상 종료 이벤트 (4단계 보강) — 재생 끝나면 data-played="true"로 토글.
     CSS에서 .movie-decision 노출 룰이 이 속성에 묶여있음.
     영상 없는 케이스는 _renderSceneMovie가 이미 "true"로 시작 → 여기서 안 잡힘. */
  stage.querySelectorAll('.js-movie-video').forEach(video => {
    video.addEventListener('ended', () => {
      const movieScreen = video.closest('.scene-screen--movie');
      if (movieScreen) movieScreen.setAttribute('data-played', 'true');
    });
  });

  /* 체험전시형 표준 네비 (4단계 신규) — 뒤로가기 / 처음으로.
     "다음"은 사용자가 만든 연결 오브젝트(buttons[])가 담당하므로 표준 버튼 X. */
  stage.querySelector('.js-exp-nav-back')?.addEventListener('click', () => {
    if (typeof navigateBack === 'function') navigateBack();
  });
  stage.querySelector('.js-exp-nav-home')?.addEventListener('click', () => {
    if (typeof restartStory === 'function') restartStory();
    else if (typeof restartFromCover === 'function') restartFromCover();
  });

  /* W6: 체험전시형 connectObjects 클릭 동작.
     타입별 분기:
     · button/arrow/flag/invisible/next : nextId가 있으면 그 장면으로 이동
     · back   : 뒤로가기 (시스템 nav와 동일)
     · home   : 처음으로 (시스템 nav와 동일)
     다듬기 모드(editMode true)에선 클릭 동작 비활성 — 핸들 인터랙션이 우선. */
  if (!ViewerState || !ViewerState.editMode) {
    stage.querySelectorAll('.js-connect-object').forEach(el => {
      el.addEventListener('click', (e) => {
        /* 핸들 클릭은 이벤트 버블링으로 들어와도 처리 X (다듬기 모드 아니면 핸들 자체가 없음) */
        if (e.target && e.target.closest && e.target.closest('.co-handle')) return;
        const type = el.getAttribute('data-co-type') || 'button';
        const coId = el.getAttribute('data-co-id') || '';
        if (type === 'back') {
          if (typeof navigateBack === 'function') navigateBack();
          return;
        }
        if (type === 'home') {
          if (typeof restartStory === 'function') restartStory();
          else if (typeof restartFromCover === 'function') restartFromCover();
          return;
        }
        /* button/arrow/flag/next/invisible — connectObjects 데이터에서 nextId 찾아 이동 */
        const objects = (typeof getConnectObjects === 'function')
          ? getConnectObjects(scene) : [];
        const co = objects.find(o => o.id === coId);
        if (co && co.nextId) {
          if (typeof navigateTo === 'function') navigateTo(co.nextId);
        }
      });
    });
  }
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

  /* W7 엔딩 재구조: 사용자가 쓴 엔딩 본문이 주인공.
     사용자 결정: "이야기 끝은 유지하되 과하게 본문을 덮지 말 것".
     · 사용자 본문 있음 → 본문이 메인 (큰 글씨), 시스템 표시("이야기 끝") 작은 보조
     · 사용자 본문 비어있음 → 시스템 메시지가 메인 (이전 동작 유지)
     · 사용자 제목 → 위쪽 작은 라벨로 (장면 제목)
     · 진엔딩 배지 + path 요약 + 다른 결말 찾기 버튼은 그대로 */
  const userTitle = String(scene.title || '').trim();
  const userBody  = String(scene.body  || '').trim();
  const hasUserBody = userBody.length > 0;

  const systemLabel = isTrueEnd ? '진짜 결말' : '이야기 끝';
  const systemIcon  = isTrueEnd ? '🏆' : '🏁';

  /* 본문 있을 때 */
  const userContentHtml = hasUserBody ? `
    ${userTitle ? `<div class="ending-user-title">${escHtml(userTitle)}</div>` : ''}
    <div class="ending-user-body">${escHtml(userBody)}</div>
    <div class="ending-system-label-small">
      <span class="ending-system-icon-small">${systemIcon}</span>
      <span>${systemLabel}</span>
    </div>
  ` : `
    <div class="terminal-icon terminal-icon--story">${systemIcon}</div>
    <h2 class="terminal-title">${systemLabel}</h2>
    ${userTitle ? `<p class="terminal-body">${escHtml(userTitle)}</p>` : ''}
  `;

  /* v37: 메인 장면(picturebook split)과 동일 구조 — 위 그림 / 아래 텍스트.
     사용자 결정: "엔딩도 그림 있고 본문 아래 + 행동 버튼 자리에 결말 문구".
     scene.imageData 있으면 위 그림, 없으면 placeholder. 텍스트 영역에 엔딩 콘텐츠. */
  const endingImage = scene.imageData || null;
  const endingIllustHtml = endingImage
    ? `<div class="pb-illust" data-pb-illust="1">
         <div class="pb-illust__photo" data-pb-photo="1">
           <img class="pb-illust__inner" src="${endingImage}" draggable="false" alt="">
         </div>
       </div>`
    : `<div class="pb-illust pb-illust--empty">
         <div class="pb-empty-mark">${systemIcon}</div>
       </div>`;

  /* 텍스트 영역 — 작품 제목(작게) + 엔딩 본문(메인) + 이야기 끝 스탬프 + 경로 요약 + 버튼 */
  const endingTextHtml = `
    <div class="pb-text pb-text--ending">
      ${userTitle ? `<div class="ending-user-title">${escHtml(userTitle)}</div>` : ''}
      ${userBody ? `<p class="ending-user-body">${escHtml(userBody)}</p>` : ''}
      <div class="ending-stamps-row">
        ${trueEndBadge}
        <div class="ending-end-stamp">${systemIcon} ${systemLabel}</div>
      </div>
      ${pathSummary}
      <p class="ending-mood">${moodMsg}</p>
      <div class="pb-text__actions ending-actions" data-count="${ViewerState.historyStack.length > 0 ? 2 : 1}">
        <button class="terminal-btn terminal-btn--primary js-restart">↺ 다른 결말 찾기</button>
        ${ViewerState.historyStack.length > 0
          ? `<button class="terminal-btn terminal-btn--ghost js-back">← 직전 장면으로</button>` : ''}
      </div>
    </div>`;

  /* v49: 엔딩 그림 없으면 has-no-image 클래스 → illust 영역 줄이고 text 비중 ↑ */
  const noImageClass = endingImage ? '' : ' ending-as-pb--no-image';
  stage.innerHTML = `
    <div class="scene-screen scene-screen--pb pb--split ending-as-pb${noImageClass}"
         data-presentation-mode="picturebook"
         data-presentation-submode="split"
         data-ending="true">
      <div class="pb-page">
        <div class="pb-frame">
          ${endingIllustHtml}
          ${endingTextHtml}
        </div>
      </div>
    </div>`;

  if (typeof _setupPbPhotoWrappers === 'function') {
    _setupPbPhotoWrappers(stage);
  }

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

  /* fromMaker 왕복 액션바 — maker에서 넘어온 경우 + editMode 액션 통합.
     W9 (v4): 사용자 보고 "인스펙터 상단 공간 낭비" → 모든 다듬기 액션을
     이 라인으로 옮김. 인스펙터 _editActionsHtml은 빈 반환으로. */
  const isEdit = ViewerState.editMode;
  const makerBarHtml = fromMaker ? `
    <div class="maker-return-bar ${isEdit ? 'maker-return-bar--editing' : ''}">
      <span class="maker-return-label">${isEdit ? '🎨 마감 편집 중' : '✏️ 제작자 테스트 중'}</span>
      <div class="maker-return-actions">
        ${isEdit ? `
          <button class="maker-return-btn maker-return-btn--test js-edit-preview-test" title="실제 관람자 화면으로 확인">▶ 감상 테스트</button>
          <button class="maker-return-btn js-edit-open-map" title="장면 연결을 한눈에 확인">🗺 구조 보기</button>
          <button class="maker-return-btn js-edit-return-maker" title="브랜치 화면으로 돌아가기">← 브랜치 화면으로</button>
          <button class="maker-return-btn maker-return-btn--save js-edit-save" title="즉시 저장">💾 저장</button>
        ` : `
          <button class="maker-return-btn js-return-to-maker">← 브랜치 화면으로</button>
          <button class="maker-return-btn maker-return-btn--edit js-go-edit">🎨 감상 화면 다듬기</button>
        `}
      </div>
    </div>` : '';

  /* W9 (v4): hud-edit-badge 제거 — 라벨이 maker-return-bar에 있음 */
  hud.innerHTML = `
    ${makerBarHtml}
    <div class="hud-inner">
      <button class="hud-btn js-hud-back ${canBack ? '' : 'hud-btn--hidden'}" title="뒤로">‹</button>
      <div class="hud-center">
        <span class="hud-team">${escHtml(ViewerState.project.teamName)}</span>
      </div>
      <div class="hud-right">
        ${mode === 'explore' ? `<span class="hud-explore-count">${ViewerState.visitedSceneIds.size}곳 방문</span>` : ''}
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

  /* W9 (v4): HUD maker-return-bar에 박힌 다듬기 액션 버튼들 핸들러 (감상 테스트/구조 보기/작업으로/저장) */
  if (isEdit && typeof _bindHudEditActions === 'function') {
    _bindHudEditActions();
  }
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
