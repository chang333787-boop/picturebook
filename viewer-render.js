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

  /* v122: 매 장면 박을 때마다 효과/속도 CSS 변수 다시 박음.
     옛엔 작품 로드 시 한 번 + 다듬기 슬라이더 박을 때만 박음 → 다듬기 후 "감상 테스트"
     박는 시점에 옛 값 박힐 가능성. 사용자 박은 "느림으로 박았는데 표지에서 빠르게 나옴".
     ViewerState.project가 최신 박혀있어 그대로 박으면 정합 보장. */
  if (typeof applyWorkEffectVars === 'function' && ViewerState.project) {
    stage.dataset.transition   = ViewerState.project.sceneTransition || 'fade';
    stage.dataset.textEntrance = ViewerState.project.textEntrance || 'none';
    applyWorkEffectVars(stage,
      ViewerState.project.sceneTransitionSpeed,
      ViewerState.project.textEntranceSpeed,
      ViewerState.project.textEntrance);
  }
  /* 템플릿: 장면 단위 override → 없으면 project 기본 */
  const effectiveTemplate = scene.layoutTemplate || ViewerState.project.template;
  stage.dataset.template = effectiveTemplate;

  /* WIN-TAB-1: 감상 모드 장면 전환 동안만 body에 class 부여.
     전환 애니메이션이 도는 동안에만 무거운 backdrop blur를 CSS에서 축소해
     Windows/태블릿 GPU 합성 부담을 줄인다(평상시 디자인은 그대로).
     전환 시간(dataset.sceneSpeedPct 기반)만큼 뒤 제거 — 누적 timer 방지로 clearTimeout. */
  try {
    if (!ViewerState.editMode) {
      const _sPct = parseInt(stage.dataset.sceneSpeedPct, 10);
      const _switchMs = (typeof _sceneTransMs === 'function')
        ? _sceneTransMs(isNaN(_sPct) ? 50 : _sPct) : 600;
      document.body.classList.add('pb-is-scene-switching');
      if (window.__pbSwitchTimer) clearTimeout(window.__pbSwitchTimer);
      window.__pbSwitchTimer = setTimeout(function () {
        document.body.classList.remove('pb-is-scene-switching');
        window.__pbSwitchTimer = null;
      }, _switchMs + 80);
    } else if (document.body.classList.contains('pb-is-scene-switching')) {
      document.body.classList.remove('pb-is-scene-switching');
    }
  } catch (e) { /* noop */ }

  /* edit 모드: safe-area 힌트 표시 + frame 클래스 + body 클래스 (전역 CSS용) */
  const safeHint = document.getElementById('safe-area-hint');
  if (safeHint) safeHint.classList.toggle('hidden', !ViewerState.editMode);
  stage.classList.toggle('edit-mode-on', ViewerState.editMode);
  document.body.classList.toggle('edit-mode-active', ViewerState.editMode);
  /* v128: 감상 테스트 상태 명시 — 다듬기 화면 안에서 "▶ 감상 테스트" 눌렀을 때
     ViewerState._testingEdit = true 박힘. CSS animation:none 룰이 감상 테스트에선
     적용되면 안 됨 (실제 감상과 동일 조건으로 보여줘야). class를 명시적으로 박아 두면
     edit-mode-on/active 잔재가 있어도 CSS에서 안전하게 분기 가능. */
  stage.classList.toggle('viewer-test-active', !!ViewerState._testingEdit);
  document.body.classList.toggle('viewer-test-active', !!ViewerState._testingEdit);

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

  /* v85: v83 안전 재박음 + v82 letterbox 룰 폐기 — 사용자 의도 정정. */
  document.getElementById('debug-theme-box')?.remove();

  /* v127: 행동버튼 등장 후에만 클릭 박음 (사용자 명: "보이기 전에는 절대 눌리면 안 됨").
     CSS는 :not(.is-ready) pointer-events:none 박혀있음. JS에서 animationend 박힐 때
     .is-ready 박음. 다듬기 모드는 처음부터 박음. fallback 6초 — 애니메이션 박지 X 박힌
     경우(reduced-motion 등) 영구 잠금 차단. */
  stage.querySelectorAll('.pb-text__actions').forEach(el => {
    if (document.body && document.body.classList.contains('edit-mode-active')) {
      el.classList.add('is-ready');
      return;
    }
    el.classList.remove('is-ready');
    const onEnd = () => {
      el.classList.add('is-ready');
      el.removeEventListener('animationend', onEnd);
    };
    el.addEventListener('animationend', onEnd);
    /* fallback — animation 박지 X 또는 prefers-reduced-motion 박힌 경우 */
    setTimeout(() => el.classList.add('is-ready'), 6000);
  });
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
  /* v112: cover scene이 존재하면 첫 진입에 무조건 표시.
     옛 조건(currentSceneId === entrySceneId)은 모바일에서 entrySceneId 명시 박지 않은
     작품(p.entrySceneId=null)에선 false가 되어 cover가 안 박혔음. 그게 v111 표지 감상 버그.
     cover scene 자체가 진실의 원천이므로 cover 있으면 첫 진입엔 박음. */
  const hasCoverScene = ViewerState.scenes && Object.values(ViewerState.scenes).some(
    s => s && (s.type === 'cover' || s.isCover)
  );
  if (hasCoverScene) return true;
  /* cover scene 없는 옛 작품 — p.coverTitle/coverImageData만 박힌 경우.
     이땐 currentSceneId === entrySceneId일 때만 cover 박음 (옛 동작 유지). */
  const cur = ViewerState.currentSceneId;
  const eid = ViewerState.project.entrySceneId;
  return !!cur && !!eid && String(cur) === String(eid);
}

function renderCover() {
  const stage = document.getElementById('viewer-frame');

  const p         = ViewerState.project;
  const mode      = p.mode;

  /* 2026-05-27 Cover-1: edit mode에서 표지 텍스트 직접 입력 박음.
     kicker / title / subtitle 모두 contenteditable + data-pb-editable.
     · field 이름이 scene 속성 키와 동일해야 _attachPbEditableInteractions가
       scene[field]에 바로 박을 수 있음 — 'kicker' / 'title' / 'subtitle'
     · 빈 값에도 element는 박혀야 클릭 가능 → 아래 subtitle 분기 박음
     · 감상 모드(isEdit=false)는 옛 마크업 그대로 — contenteditable/data 박지 X */
  const isEdit = !!(typeof ViewerState !== 'undefined' && ViewerState.editMode);
  const editKickerAttrs = isEdit
    ? ' contenteditable="true" data-pb-editable="kicker" data-placeholder="(상단 문구)"'
    : '';
  const editTitleAttrs = isEdit
    ? ' contenteditable="true" data-pb-editable="title" data-placeholder="(작품 제목)"'
    : '';
  const editSubtitleAttrs = isEdit
    ? ' contenteditable="true" data-pb-editable="subtitle" data-placeholder="(한 줄 소개)"'
    : '';

  /* v37: cover scene이 scenes에 있으면 그 데이터 우선. 없으면 project.coverTitle fallback */
  const coverScene = (ViewerState.scenes && typeof ViewerState.scenes === 'object')
    ? Object.values(ViewerState.scenes).find(s => s && s.type === 'cover')
    : null;
  const title     = (coverScene && coverScene.title)
    || p.coverTitle || '이야기 시작';
  const subtitle  = (coverScene && coverScene.subtitle) || '';
  /* v129: 표지 상단 문구 — 사용자가 직접 박는 값. 옛엔 teamName(예: "0000") 자동 표시였음.
     비우면 표지 상단에 아무것도 안 보임 (DOM은 박혀 있되 빈 텍스트). */
  const kicker    = (coverScene && typeof coverScene.kicker === 'string')
    ? coverScene.kicker : '';
  /* 2026-05-31 Text-2: 빈 kicker 처리 — 감상 모드와 edit 모드 분리.
     · 감상 모드(빈 값): cover-kicker--empty → visibility:hidden (표지에 안 보임, 옛 동작 유지).
     · edit 모드(빈 값): is-empty → placeholder("(상단 문구)") + 클릭 가능. hidden 안 먹음.
       is-empty를 최초 렌더 template부터 박음 — JS _updatePlaceholder 타이밍/재렌더 경로와
       무관하게 첫 paint부터 placeholder가 보이고 클릭 가능. (옛 버그: edit 모드에서도
       빈 kicker가 hidden이라 직접 클릭 불가 + 우측 재렌더 시 placeholder 사라짐) */
  let kickerEmptyCls = '';
  if (!kicker) kickerEmptyCls = isEdit ? ' is-empty' : ' cover-kicker--empty';
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
    _stageReplaceScene(stage, `
      <div class="scene-screen scene-screen--pb pb--split cover-as-pb"
           data-presentation-mode="picturebook"
           data-presentation-submode="split">
        <div class="pb-page">
          <div class="pb-frame">
            <div class="pb-illust" data-pb-illust="1">
              <div class="pb-illust__photo" data-pb-photo="1">
                <img class="pb-illust__inner" src="${imageData}" draggable="false" alt="" decoding="async" fetchpriority="high">
              </div>
            </div>
            <div class="pb-text pb-text--cover">
              <div class="cover-kicker${kickerEmptyCls}"${editKickerAttrs}>${escHtml(kicker)}</div>
              <h1 class="cover-title-pb"${editTitleAttrs}>${escHtml(title)}</h1>
              <button class="cover-start-btn js-cover-start">▶ 시작하기</button>
            </div>
          </div>
        </div>
      </div>`);
    if (typeof _setupPbPhotoWrappers === 'function') _setupPbPhotoWrappers(stage);
  } else {
    /* v37: 그림 없는 표지 — 책 표지 인쇄 분위기.
       제목 높낮이: titleVPos 20~80 → top/bottom grid 비율 동적. */
    const classId = p.classId || '';
    const topFr = titleVPos / 50;                  // 20→0.4fr, 50→1fr, 80→1.6fr
    const bottomFr = (100 - titleVPos) / 50;       // 20→1.6fr, 50→1fr, 80→0.4fr
    _stageReplaceScene(stage, `
      <div class="scene-screen scene-screen--pb pb--split cover-as-pb cover-as-pb--text"
           data-presentation-mode="picturebook"
           data-presentation-submode="split"
           data-cover-mode="text"
           data-cover-theme="${escHtml(coverTheme)}">
        <div class="pb-page">
          <div class="cover-book" style="grid-template-rows: ${topFr}fr 2fr ${bottomFr}fr;">
            <div class="cover-book__top">
              <!-- v129: 표지 상단 = 사용자가 박는 kicker. 옛 팀 이름 자동 표시 폐기.
                   비우면 빈 영역 (layout 유지). -->
              <div class="cover-kicker${kickerEmptyCls}"${editKickerAttrs}>${escHtml(kicker)}</div>
            </div>
            <div class="cover-book__center">
              <h1 class="cover-title-pb"${editTitleAttrs}>${escHtml(title)}</h1>
              <div class="cover-book__deco">✦</div>
              ${(subtitle || isEdit)
                ? `<p class="cover-subtitle-pb${subtitle ? '' : ' cover-subtitle-pb--empty'}"${editSubtitleAttrs}>${escHtml(subtitle)}</p>`
                : ''}
            </div>
            <div class="cover-book__bottom">
              <button class="cover-start-btn js-cover-start">▶ 시작하기</button>
            </div>
          </div>
        </div>
      </div>`);
  }

  stage.querySelector('.js-cover-start')
    ?.addEventListener('click', () => {
      ViewerState.audioState.autoplayAllowed = true;
      /* cover는 작품 입구 — 시작 버튼은 entrySceneId로 이동.
         이 시점부터 이후 재시작에서는 cover 건너뜀 (_coverShown=true) */
      ViewerState._coverShown = true;
      ViewerState.historyStack = [];
      /* v112: entry 결정 fallback 강화. 모바일에서 entrySceneId 명시 안 박은 작품 대응.
         · p.entrySceneId가 있고 cover scene 아니면 그것
         · 없거나 cover를 가리키면 getEntryScene() 호출 (cover 제외 첫 normal 반환, v111 박힘)
         · 그래도 없으면 currentSceneId 그대로 (renderCurrentScene 자체가 cover 무한 박힘 차단) */
      let nextId = ViewerState.project && ViewerState.project.entrySceneId;
      const isCoverId = (id) => {
        const s = ViewerState.scenes && ViewerState.scenes[id];
        return s && (s.type === 'cover' || s.isCover);
      };
      if (!nextId || isCoverId(nextId)) {
        const entry = (typeof getEntryScene === 'function') ? getEntryScene() : null;
        if (entry && !isCoverId(entry.id)) nextId = entry.id;
      }
      if (nextId && String(nextId) !== String(ViewerState.currentSceneId)) {
        ViewerState.currentSceneId = nextId;
      }
      renderCurrentScene();
    });

  /* 2026-05-27 Cover-1 fix: 표지에서도 contenteditable 핸들러 박음.
     일반 renderScene과 동일 패턴 — initEditInteractions가
     _attachPbEditableInteractions를 호출해 [data-pb-editable] element에
     input/blur 핸들러 박음. 옛엔 표지에서 호출 누락 → 미리보기 → 우측 패널
     양방향 동기 안 박혔던 버그 fix. */
  if (ViewerState.editMode && typeof initEditInteractions === 'function') {
    initEditInteractions();
  }
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

  /* v78: 엔딩 분기 — 상위 renderViewer는 isEnding 체크해서 renderTerminal 호출하지만,
     다듬기 모드에서 본문 입력 시 _scheduleViewerFrameReRender가 renderScene을 직접 호출
     해서 엔딩 layout 박히지 않고 일반 그림책 layout으로 박이던 버그 fix.
     사용자 보고: 엔딩 본문 다듬는 동안 "이야기 끝" 스탬프/행동버튼 사라짐. */
  if (scene && (scene.isEnding || scene.type === 'ending')) {
    renderTerminal(scene);
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
  let bgImage  = scene.imageData || null;
  /* P5-IMAGE-VARIANT-1: 이미지 보기 모드(aiS1/aiS2)면 variant url로 표시. 원본 보기면 그대로(동작 변화 0).
     원본 scene.imageData/imageUrl은 절대 변경하지 않음(read-only hook). */
  if (typeof window !== 'undefined' && window.viewerAi && typeof window.viewerAi._getDisplayImageSrc === 'function') {
    bgImage = window.viewerAi._getDisplayImageSrc(scene, bgImage);
  }

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
  let   style  = (typeof getTextStyle  === 'function') ? getTextStyle(scene)  : null;
  /* Phase 4-D-2A: aiS1/aiS2 보기면 variant textStyle(있으면) 적용, 없으면 원본 style 그대로.
     원본 보기에선 _getDisplayStyle이 원본 style을 그대로 반환 → 기존 렌더와 동일. 감상자/편집자 공통. */
  if (typeof window !== 'undefined' && window.viewerAi && typeof window.viewerAi._getDisplayStyle === 'function') {
    style = window.viewerAi._getDisplayStyle(scene.id, style);
  }
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
  _stageReplaceScene(stage, `
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
    </div>`);
}

/* ADV-EDIT-ABSORB-TITLE-1: 텍스트형 제목(title) 렌더 — 직접편집 흡수.
   · 감상 모드(allowEdit=false): 기존 정책 그대로 — title 있으면 <h3>, 없으면 미렌더.
     (AI 변형 보기 중에도 allowEdit=false → 원본 title 잠금 유지)
   · 다듬기(원본 보기, allowEdit=true) + title 있음 또는 '제목 추가' draft 활성:
       contenteditable <h3 data-pb-editable="title"> — 기존 저장 경로(_attachPbEditableInteractions) 재사용.
   · 다듬기 + title 없음 + draft 비활성: 빈 제목칸 대신 작은 '+ 제목 추가' 칩만 표시.
       (칩 클릭 → viewer-edit.js가 draft 활성 + 재렌더 + focus)
   text 모드 전용 helper (text 일반 장면 + text 엔딩에서만 호출). DB에 placeholder 저장 안 함. */
function _textTitleHtml(scene, allowEdit) {
  const t = String(scene.title || '').trim();
  if (!allowEdit) {
    return t ? `<h3 class="text-card__title">${escHtml(t)}</h3>` : '';
  }
  const sid = String(scene.id);
  const draftActive = (typeof _isTextTitleDraftActive === 'function') && _isTextTitleDraftActive(sid);
  if (t || draftActive) {
    return `<h3 class="text-card__title js-pb-editable-title" contenteditable="true" data-pb-editable="title" data-placeholder="(제목을 적어보세요)">${escHtml(t)}</h3>`;
  }
  return `<button type="button" class="text-title-add-chip js-text-title-add" data-scene-id="${escHtml(sid)}">+ 제목 추가</button>`;
}

/* 텍스트 카드 안 내용 — 제목 → 본문 → 버튼 */
function _renderSceneCard(scene, choices) {
  const title = String(scene.title || '').trim();
  const _orig = String(scene.body  || '');  /* v127: trim 박지 X — \n\n 등 의도된 빈 줄 유지 */
  /* v140-step4: aiViewMode가 aiS1 박혀있고 final 박혀있을 때만 AI 본문 박음. 원본 scene.body는 절대 변경 X */
  const body = (window.viewerAi && window.viewerAi._getDisplayBody) ? window.viewerAi._getDisplayBody(scene.id, _orig) : _orig;
  const isLong = scene.textLength === 'long';

  /* ADV-EDIT-ABSORB-TITLE-1: titleHtml은 _allowTcEdit 계산 후 아래에서 _textTitleHtml로 생성. */
  /* 2026-05-31 Text-2B: edit 모드면 본문 직접 입력 — contenteditable + placeholder.
     · 감상 모드: 옛대로 빈 본문이면 <p> 미렌더 (시각 변화 0).
     · edit 모드: 빈 본문도 <p> 렌더 → 클릭 가능 + placeholder("(본문을 적어보세요)").
       data-pb-editable="body"로 그림책 본문 핸들러(_attachPbEditableInteractions) 재사용 →
       scene.body 저장 + 우측 .js-edit-body textarea 양방향 동기. is-empty는 최초 렌더부터 박음.
     · textEffect(entrance/typewriter)는 edit 모드 CSS에서 끔 — 입력 깨짐 차단.
     · 'pb' 접두사는 공통 핸들러 재사용 탓(이름만 그림책 유래) — 향후 공통화 여지 주석. */
  const _isEditMode = !!(typeof ViewerState !== 'undefined' && ViewerState.editMode);
  /* Phase 4-A: AI 변형(s1/s2) 보기 중엔 contenteditable 금지 — 원본 scene.body 덮어쓰기 방지.
     원본 보기일 때만 편집. (엔딩/그림책 렌더러와 동일 패턴) */
  const _aiViewModeTc = (typeof window !== 'undefined' && window.viewerAi
                         && typeof window.viewerAi._getAiViewMode === 'function')
    ? window.viewerAi._getAiViewMode() : 'original';
  const _allowTcEdit = _isEditMode && _aiViewModeTc === 'original';
  /* Phase 4-C: s1/s2 보기 중엔 본문만 variant 편집(별도 저장 경로). 원본 보기는 기존 그대로. */
  const _variantBodyKeyTc = (typeof window !== 'undefined' && window.viewerAi
                             && typeof window.viewerAi._aiVariantBodyEditAllowed === 'function')
    ? window.viewerAi._aiVariantBodyEditAllowed(scene.id) : null;
  const _bodyEditable = _allowTcEdit || !!_variantBodyKeyTc;
  const titleHtml = _textTitleHtml(scene, _allowTcEdit);
  let bodyHtml = '';
  if (body || _isEditMode) {
    const scrollCls = isLong ? ' text-card__body--scroll' : '';
    const editCls   = _bodyEditable ? ' js-pb-editable-body' : '';
    const emptyCls  = (_bodyEditable && !body) ? ' is-empty' : '';
    const editAttrs = _allowTcEdit
      ? ' contenteditable="true" data-pb-editable="body" data-placeholder="(본문을 적어보세요)"'
      : (_variantBodyKeyTc
        ? ` contenteditable="true" data-ai-variant-edit="${_variantBodyKeyTc}" data-placeholder="(본문을 적어보세요)"`
        : '');
    bodyHtml = `<p class="text-card__body${scrollCls}${editCls}${emptyCls}"${editAttrs}>${escHtml(body)}</p>`;
  }

  /* 버튼 영역 — 카드 안 맨 아래. v0.3 텍스트형은 좌측정렬 세로.
     2026-06-02: data-choice-idx = 원본 인덱스(x.origIdx), 표시 순번 = i. */
  const btns = _v03FilterChoicesIndexed(choices).map((x, i) => _v03ChoiceBtnHtml(scene, x.c, 'text', x.origIdx, i)).join('');
  const btnsHtml = `<div class="text-card__actions">${btns}</div>`;

  return `${titleHtml}${bodyHtml}${btnsHtml}`;
}

/* ── 모드 2: 그림책형 (picturebook) ──
   구조: 화면 분할 (TB 기본 50:50, LR 선택 50:50)
        그림 영역 + 텍스트 영역 (제목 → 본문 → 버튼)
   버튼은 텍스트 영역 안에만, 그림 침범 금지.
   submode: 'spread' = LR(좌우), 'stage' = TB(상하). 기본은 'stage'(TB). */
/* v138: 그림책형 분할형 본문 카드 톤 클래스 계산.
   ViewerState.project.textCardStyle / textCardColor가 둘 다 명시값일 때만
   톤 클래스 박음. 하나라도 없으면 빈 문자열 — 옛 작품 시각 변화 없음
   (viewer.css 기존 규칙 그대로 작동).

   적용 대상: 그림책형 분할형(.pb--split) 일반 장면 + 분할형 엔딩.
   적용 안 함: 그림 중심형(imageCenter), 표지, 텍스트형, 무비형, 체험전시형.

   kind:
   · 'scene'  → pb-tone--{scene.pbCardTone||'default'}    (일반 5종)
   · 'ending' → pb-end-tone--{scene.pbEndingTone||'default'} (엔딩 3종) */
function _pbToneClasses(scene, kind) {
  const proj = (typeof ViewerState !== 'undefined' && ViewerState.project) || {};
  const cs = proj.textCardStyle;
  const cc = proj.textCardColor;
  if (!cs || !cc) return '';

  let toneCls;
  if (kind === 'ending') {
    const t = (scene && scene.pbEndingTone) || 'default';
    toneCls = ` pb-end-tone--${t}`;
  } else {
    const t = (scene && scene.pbCardTone) || 'default';
    toneCls = ` pb-tone--${t}`;
  }
  return ` pb-tone-style--${cs} pb-tone-color--${cc}${toneCls}`;
}

function _renderScenePicturebook(stage, scene, submode) {
  const choices = Array.isArray(scene.choices) ? scene.choices : [];
  /* W4 디버그: 그림 데이터 소스 — viewer-edit은 imageData||imageUrl 둘 다 보고
     viewer-render는 이전엔 imageData만 봤음. 데이터 소스 일치를 위해 둘 다 본다. */
  let bgImage = scene.imageData || scene.imageUrl || null;
  /* P5-IMAGE-VARIANT-1: 이미지 보기 모드면 variant url로 표시(원본 보기는 그대로·동작 변화 0). 원본 필드 불변. */
  if (typeof window !== 'undefined' && window.viewerAi && typeof window.viewerAi._getDisplayImageSrc === 'function') {
    bgImage = window.viewerAi._getDisplayImageSrc(scene, bgImage);
  }
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
  let style = (typeof getTextStyle === 'function') ? getTextStyle(scene) : null;
  /* Phase 4-D-2A: aiS1/aiS2 보기면 variant textStyle(있으면) 적용, 없으면 원본 style 그대로.
     원본 보기에선 원본 style 그대로 반환 → 기존 렌더와 동일. 감상자/편집자 공통. */
  if (typeof window !== 'undefined' && window.viewerAi && typeof window.viewerAi._getDisplayStyle === 'function') {
    style = window.viewerAi._getDisplayStyle(scene.id, style);
  }
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
  const _orig = String(scene.body  || '');  /* v127: trim 박지 X — \n\n 등 의도된 빈 줄 유지 */
  /* v140-step4: aiViewMode가 aiS1 박혀있고 final 박혀있을 때만 AI 본문 박음. 원본 scene.body는 절대 변경 X */
  const body = (window.viewerAi && window.viewerAi._getDisplayBody) ? window.viewerAi._getDisplayBody(scene.id, _orig) : _orig;
  /* W8: 다듬기 모드에선 contenteditable — viewer에서 직접 수정 가능 + 다듬기 패널 양방향 동기화 */
  const isEdit = (typeof ViewerState !== 'undefined' && ViewerState.editMode);
  /* Phase 4-A: AI 변형(s1/s2) 보기 중엔 편집 금지 — 원본 scene.body/layout 덮어쓰기 방지.
     원본 보기일 때만 contenteditable + 드래그/리사이즈 핸들. (텍스트/엔딩 렌더러와 동일 패턴) */
  const _aiViewModePb = (typeof window !== 'undefined' && window.viewerAi
                         && typeof window.viewerAi._getAiViewMode === 'function')
    ? window.viewerAi._getAiViewMode() : 'original';
  const _allowPbEdit = isEdit && _aiViewModePb === 'original';
  const editAttrs = _allowPbEdit ? 'contenteditable="true" data-pb-editable="title"' : '';
  /* Phase 4-C: s1/s2 보기 중엔 본문만 variant 편집(원본 layout/title은 잠금 유지).
     원본 보기 → data-pb-editable="body"(scene.body 경로). variant 보기 → data-ai-variant-edit(별도 경로). */
  const _variantBodyKeyPb = (typeof window !== 'undefined' && window.viewerAi
                             && typeof window.viewerAi._aiVariantBodyEditAllowed === 'function')
    ? window.viewerAi._aiVariantBodyEditAllowed(scene.id) : null;
  const editAttrsBody = _allowPbEdit
    ? 'contenteditable="true" data-pb-editable="body"'
    : (_variantBodyKeyPb ? `contenteditable="true" data-ai-variant-edit="${_variantBodyKeyPb}"` : '');
  /* Phase 4-D-1: s1/s2 보기 중엔 글상자(picturebookBodyBox)만 variant 위치/크기 편집 가능(원본 layout 잠금 유지). */
  const _variantLayoutKeyPb = (typeof window !== 'undefined' && window.viewerAi
                               && typeof window.viewerAi._aiVariantLayoutEditAllowed === 'function')
    ? window.viewerAi._aiVariantLayoutEditAllowed(scene.id) : null;

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
           <img class="pb-illust__inner" src="${bgImage}" draggable="false" alt="" decoding="async" fetchpriority="high">
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
  const filteredChoices = _v03FilterChoicesIndexed(choices);
  const pbChoiceCount = filteredChoices.length;
  const btns = filteredChoices.map((x, i) => _v03ChoiceBtnHtml(scene, x.c, 'picturebook', x.origIdx, i)).join('');

  /* 그림 중심형: 제목은 그림 위 상단 고정 / 본문은 그림 위 글상자.
     분할형: 제목/본문/선택지 모두 하단 텍스트 영역. */
  if (isImageCenter) {
    /* W4: 본문 글상자 위치/크기/배경막 동적 적용 — 다듬기에서 조정.
       다듬기 모드(editMode)에서는 ✥ 드래그 핸들 + 4 모서리 ⤡ 리사이즈 핸들 노출. */
    const _origBodyBox = (typeof getPicturebookBodyBox === 'function')
      ? getPicturebookBodyBox(scene)
      : { x: 15, y: 25, width: 55, height: null, backdropOpacity: 0.85 };
    /* Phase 4-D-1: aiS1/aiS2 보기면 variant layout(있으면) 적용, 없으면 원본 fallback. 원본 보기면 원본 그대로. */
    const bodyBox = (typeof window !== 'undefined' && window.viewerAi
                     && typeof window.viewerAi._getDisplayLayout === 'function')
      ? (window.viewerAi._getDisplayLayout(scene.id, _origBodyBox).picturebookBodyBox || _origBodyBox)
      : _origBodyBox;
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
    /* Phase 4-D-1: 원본 보기(_allowPbEdit) 또는 variant 보기(_variantLayoutKeyPb)에서 핸들 노출.
       감상자(editMode=false)는 두 게이트 모두 false라 핸들 없음. */
    const _showPbBoxHandles = _allowPbEdit || !!_variantLayoutKeyPb;
    const editHandlesHtml = _showPbBoxHandles ? `
      <div class="pb-body-handle pb-body-handle--move js-pb-body-move" title="드래그하여 위치 이동">✥</div>
      <div class="pb-body-handle pb-body-handle--resize-nw js-pb-body-resize" data-corner="nw" title="크기 조절"></div>
      <div class="pb-body-handle pb-body-handle--resize-ne js-pb-body-resize" data-corner="ne" title="크기 조절"></div>
      <div class="pb-body-handle pb-body-handle--resize-sw js-pb-body-resize" data-corner="sw" title="크기 조절"></div>
      <div class="pb-body-handle pb-body-handle--resize-se js-pb-body-resize" data-corner="se" title="크기 조절"></div>
    ` : '';

    /* W4 디버그 정보 — 안정 확인 완료, 제거됨. */

    /* v138-fix14 (v135-4 그림 중심형): 톤 클래스 박음. 외곽(.pb-frame) 강도는
       pb-tone.css의 imageCenter 오버라이드에서 분할형 대비 약화. */
    const _pbToneClsIC = _pbToneClasses(scene, 'scene');
    _stageReplaceScene(stage, `
      <div class="scene-screen scene-screen--pb ${layoutClass}"
        data-display="${scene.displayType}"
        data-scene-num="${escHtml(String(scene.id))}"
        data-presentation-mode="picturebook"
        data-presentation-submode="imageCenter"
        ${isEdit ? 'data-edit-mode="true"' : ''}
        ${styleAttr}>
        <div class="pb-page">
          <div class="pb-frame${_pbToneClsIC}">
            <div class="pb-stage">
              ${illustHtml}
              ${title || isEdit ? `<div class="pb-stage__title-overlay js-pb-editable-title" ${_allowPbEdit ? 'contenteditable="true" data-pb-editable="title"' : ''} data-placeholder="(제목을 적어보세요)">${escHtml(title)}</div>` : ''}
              ${body || isEdit ? `<div class="pb-stage__body-overlay js-pb-body-overlay"${_variantLayoutKeyPb ? ` data-ai-variant-layout="${_variantLayoutKeyPb}"` : ''} style="${bodyOverlayStyle || 'left:15%; top:25%; width:55%; background:rgba(255,255,255,0.85);'}">
                <p class="pb-text__body js-pb-editable-body" ${editAttrsBody} data-placeholder="(본문을 적어보세요)">${escHtml(body)}</p>
                ${editHandlesHtml}
              </div>` : ''}
            </div>
            <div class="pb-text pb-text--bottom-only">
              <div class="pb-text__actions-label" aria-hidden="true">행동 ${pbChoiceCount}개 <span class="pb-text__actions-label-arrow">↓</span></div>
              <div class="pb-text__actions" data-count="${pbChoiceCount}">${btns}</div>
            </div>
          </div>
        </div>
      </div>`);
    _setupPbPhotoWrappers(stage);
    return;
  }

  /* 분할형 (기본) — 위 그림 60 / 아래 텍스트+선택지 40 */
  /* v138: 본문 카드 톤 클래스 — 작품 단위 style/color 있을 때만 박힘 */
  const _pbToneCls = _pbToneClasses(scene, 'scene');
  _stageReplaceScene(stage, `
    <div class="scene-screen scene-screen--pb ${layoutClass}"
      data-display="${scene.displayType}"
      data-scene-num="${escHtml(String(scene.id))}"
      data-presentation-mode="picturebook"
      data-presentation-submode="split"
      ${styleAttr}>
      <div class="pb-page">
        <div class="pb-frame${_pbToneCls}">
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
    </div>`);

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
  const _orig = String(scene.body || '');  /* v127: trim 박지 X — 줄바꿈 유지 */
  /* v140-step4: aiViewMode가 aiS1 박혀있고 final 박혀있을 때만 AI 본문 박음. 원본 scene.body는 절대 변경 X */
  const body = (window.viewerAi && window.viewerAi._getDisplayBody) ? window.viewerAi._getDisplayBody(scene.id, _orig) : _orig;
  const bodyEnabled = (scene.bodyEnabled === true) ? true
                    : (scene.bodyEnabled === false) ? false
                    : !!body;
  /* 2026-05-31 Movie-G: 본문 직접입력 — edit 모드(AI original)면 decision 본문에 contenteditable.
     bodyEnabled=true일 때만(off면 기존대로 숨김). 빈 본문도 edit이면 렌더(placeholder).
     감상 모드는 옛대로 빈 본문 미렌더. data-pb-editable="body" → _attachPbEditableInteractions +
     _patchSceneBody(이미 .movie-decision__desc 처리) 양방향 동기. */
  const _isEditMovie = !!(ViewerState && ViewerState.editMode);
  const _aiViewMovie = (window.viewerAi && typeof window.viewerAi._getAiViewMode === 'function')
    ? window.viewerAi._getAiViewMode() : 'original';
  const _allowMovieInlineEdit = _isEditMovie && _aiViewMovie === 'original';
  let bodyHtml = '';
  if (bodyEnabled && (body || _allowMovieInlineEdit)) {
    const _editAttrs = _allowMovieInlineEdit
      ? ' contenteditable="true" data-pb-editable="body" data-placeholder="영상이 끝난 뒤 보여줄 문장을 입력하세요"'
      : '';
    const _editCls  = _allowMovieInlineEdit ? ' js-pb-editable-body' : '';
    const _emptyCls = (_allowMovieInlineEdit && !body) ? ' is-empty' : '';
    bodyHtml = `<p class="movie-decision__desc${_editCls}${_emptyCls}"${_editAttrs}>${escHtml(body)}</p>`;
  }

  /* 버튼 배열 — v0.3: 1개=세로, 2개=폭 충분하면 가로(CSS data 속성으로 분기), 3+개=세로.
     2026-06-02: data-choice-idx = 원본 인덱스(x.origIdx), 표시 순번 = i. */
  const btnCount = choices.length;
  const btnLayout = btnCount === 2 ? 'pair' : 'stack';
  const btns = _v03FilterChoicesIndexed(choices).map((x, i) => _v03ChoiceBtnHtml(scene, x.c, 'movie', x.origIdx, i)).join('');

  /* 무비형 메타 데이터 속성 — 기존 captionMode/choiceReveal + 본문 ON/OFF + 재생 상태 (4단계 신규)
     · data-played="false" : 영상 재생 전/중 — CSS에서 .movie-decision 숨김
     · data-played="true"  : 영상 종료 또는 영상 없음 — .movie-decision 노출
     초기값: videoUrl 있으면 "false", 없으면 "true". 'ended' 이벤트로 토글. */
  const initialPlayed = hasVideo ? 'false' : 'true';
  /* 2026-06-01 Movie-H: 작품단위 선택지 표시 방식 — panel(기본 하단 패널) | card(중앙 카드). */
  const _movieDeco = (ViewerState.project && ViewerState.project.movieDecisionStyle === 'card') ? 'card' : 'panel';
  const movieAttrs =
    ` data-movie-caption="${md.captionMode || 'overlay'}"` +
    /* 2026-05-31 Movie-C: 마감 규칙 — 무비형은 항상 "영상 끝난 뒤" 본문/선택지 노출.
       저장된 choiceReveal=always는 무시(end 강제). 데이터 필드는 보존, 렌더만 고정. */
    ` data-movie-reveal="end"` +
    ` data-movie-deco="${_movieDeco}"` +
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

  /* 2026-05-31 Movie-B-1: 안쪽 .movie-stage(자체 가로/세로 비율 컨테이너)로 감쌈.
     영상·decision은 stage 안에서만 배치 → 공유 프레임 안 건드리고 잘림/넘침 차단. */
  _stageReplaceScene(stage, `
    <div class="scene-screen scene-screen--movie"
      data-display="${scene.displayType}"
      data-scene-num="${escHtml(String(scene.id))}"
      data-presentation-mode="movie"${movieAttrs}>
      <div class="movie-stage">
        <div class="movie-media">
          ${reuseVideo ? '' : mediaInner}
        </div>
        <div class="movie-decision">
          ${bodyHtml}
          <div class="movie-decision__actions" data-btn-layout="${btnLayout}">
            ${btns}
          </div>
        </div>
      </div>
    </div>`);

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
  const _orig = String(scene.body  || '');  /* v127: trim 박지 X — \n\n 등 의도된 빈 줄 유지 */
  /* v140-step4: aiViewMode가 aiS1 박혀있고 final 박혀있을 때만 AI 본문 박음. 원본 scene.body는 절대 변경 X */
  const body = (window.viewerAi && window.viewerAi._getDisplayBody) ? window.viewerAi._getDisplayBody(scene.id, _orig) : _orig;

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

  _stageReplaceScene(stage, `
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
    </div>`);
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

  _stageReplaceScene(stage, `
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
    </div>`);
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
/* 2026-06-02: 원본 인덱스(origIdx) 보존 필터 — [{c, origIdx}] 반환.
   미리보기 버튼이 scene.choices 원본 인덱스를 data-choice-idx로 싣게 해,
   choices에 falsy 구멍이 있어도 1단/2단 편집과 인덱스가 어긋나지 않게 한다(단일 출처). */
function _v03FilterChoicesIndexed(choices) {
  if (!Array.isArray(choices)) return [];
  /* W8: 다듬기 모드 — 빈 선택지도 표시. 감상 모드 — 라벨/다음 둘 다 없으면 숨김. */
  const isEdit = (typeof ViewerState !== 'undefined' && ViewerState.editMode);
  const out = [];
  choices.forEach((c, origIdx) => {
    if (!c) return;
    if (!isEdit) {
      const hasLabel = String(c.label || '').trim().length > 0;
      const hasNext  = !!c.nextId;
      if (!(hasLabel || hasNext)) return;
    }
    out.push({ c, origIdx });
  });
  return out;
}

/* 표시용(원본 인덱스가 필요 없는 곳) — 위 indexed에서 choice만 추출. */
function _v03FilterChoices(choices) {
  return _v03FilterChoicesIndexed(choices).map(x => x.c);
}

function _v03ChoiceBtnHtml(scene, choice, mode, idx, dispIdx) {
  /* idx = scene.choices 원본 인덱스(data-choice-idx, 편집 바인딩용).
     dispIdx = 화면 표시 순번(0-based, 번호 원·색 순환용) — 구멍 있어도 1,2,3 순차. */
  const _num = (dispIdx != null ? dispIdx : (idx != null ? idx : 0));
  /* 2026-05-31 Text-2C: text edit 모드에선 미연결(nextId 없음) 버튼도 disabled 안 함.
     disabled <button>은 자식 contenteditable 포커스를 막아 빈/미연결 라벨 편집 불가가 됨.
     edit 모드는 클릭 내비가 이미 차단(_bindSceneEvents)되어 disabled 불필요. text만 한정 —
     pb/movie/legacy는 옛대로 유지(스코프 보호). */
  const _isEditBtn = !!(ViewerState && ViewerState.editMode);
  /* 2026-05-31 Movie-G: text와 동일하게 movie도 edit 모드면 미연결 버튼 disabled 안 함
     (disabled <button>은 자식 contenteditable 포커스 차단). pb/legacy는 옛대로. */
  const disabled = (!choice.nextId && !((mode === 'text' || mode === 'movie') && _isEditBtn)) ? 'disabled' : '';
  /* W8: 빈 라벨 placeholder — 사용자 보고 "(빈 버튼)" → 더 친절 안내 */
  const label    = String(choice.label || '').trim() || '(행동 버튼을 적어보세요)';
  const isEmpty  = !String(choice.label || '').trim();
  const emptyClass = isEmpty ? ' choice-v03--empty' : '';

  /* W8 그림책 따뜻한 디자인: 자식 3개 (번호 원 + 라벨 + 화살표).
     idx는 viewer-render의 map index로 호출 측에서 전달 (0-based → 표시는 +1).
     라벨 클래스 .pb-choice-label은 _patchChoiceLabel 실시간 반영용 타겟.
     색은 CSS의 .choice-v03--picturebook[data-pb-color="N"]로 결정 (1=sage, 2=sky, 3=coral, 4+ wrap). */
  if (mode === 'picturebook') {
    const colorIdx = (_num % 3) + 1;  /* 1·2·3 순환 (표시 순번 기준) */
    /* 2026-05-25 Phase 4-A: edit mode일 때 라벨 직접 편집.
       AI 토글 안전 분기 — 원본 보기 상태에서만 contenteditable. */
    const _isEditChoice = !!(ViewerState && ViewerState.editMode);
    const _aiViewModeChoice = (typeof window !== 'undefined' && window.viewerAi
                               && typeof window.viewerAi._getAiViewMode === 'function')
      ? window.viewerAi._getAiViewMode() : 'original';
    const _allowChoiceEdit = _isEditChoice && _aiViewModeChoice === 'original';
    const _labelEditAttrs = _allowChoiceEdit
      ? ` contenteditable="true" data-pb-editable="choice-label" data-choice-idx="${idx != null ? idx : 0}"`
      : '';
    return `<button class="choice-v03 choice-v03--picturebook js-choice${emptyClass}"
      data-choice-id="${escHtml(choice.id)}"
      data-pb-color="${colorIdx}"
      ${disabled}>
      <span class="pb-choice-num">${_num + 1}</span>
      <span class="pb-choice-label"${_labelEditAttrs} data-placeholder="(버튼 문구)">${escHtml(label)}</span>
      <span class="pb-choice-arrow" aria-hidden="true">›</span>
    </button>`;
  }

  /* 다른 모드(text/movie/legacy): 기존 구조 보존.
     2026-05-31 Text-2C: text 모드 + edit + AI original이면 라벨 직접 입력.
     그림책 choice-label 핸들러(_attachChoiceLabelEditable)를 label span에 그대로 재사용 —
     scene.choices[idx].label 저장 + 우측 .js-edit-button-label 양방향 동기 + _queueSaveButtons.
     빈 라벨은 placeholder fallback(label) 대신 진짜 빈 값 + is-empty로 CSS placeholder(::before)
     표시(Text-2B 텍스트 contenteditable 룰 재사용).
     2026-05-31 Movie-G: movie도 동일 직접입력(text 분기에 movie 포함). 라벨 span 클래스는
     .text-choice-label 그대로 재사용 — _patchChoiceLabel(viewer-edit.js)의 기존 .text-choice-label
     분기가 movie 버튼도 처리 → viewer-edit 수정 불필요. legacy만 plain text(텍스트 노드). */
  let _textLabelHtml = escHtml(label);
  if (mode === 'text' || mode === 'movie') {
    const _aiViewChoice = (typeof window !== 'undefined' && window.viewerAi
                           && typeof window.viewerAi._getAiViewMode === 'function')
      ? window.viewerAi._getAiViewMode() : 'original';
    if (_isEditBtn && _aiViewChoice === 'original') {
      const _rawLabel = String(choice.label || '');
      const _emptyLabelCls = _rawLabel.trim() ? '' : ' is-empty';
      _textLabelHtml = `<span class="text-choice-label${_emptyLabelCls}"`
        + ` contenteditable="true" data-pb-editable="choice-label"`
        + ` data-choice-idx="${idx != null ? idx : 0}"`
        + ` data-placeholder="(행동 버튼을 적어보세요)">${escHtml(_rawLabel)}</span>`;
    }
  }
  return `<button class="choice-v03 choice-v03--${mode} js-choice${emptyClass}"
    data-choice-id="${escHtml(choice.id)}" ${disabled}>
    ${_textLabelHtml}
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
  const _orig    = String(scene.body  || '');  /* v127: trim 박지 X — 줄바꿈 유지 */
  /* v140-step4: aiViewMode가 aiS1 박혀있고 final 박혀있을 때만 AI 본문 박음. 원본 scene.body는 절대 변경 X */
  const body = (window.viewerAi && window.viewerAi._getDisplayBody) ? window.viewerAi._getDisplayBody(scene.id, _orig) : _orig;
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
    btn.addEventListener('click', (e) => {
      /* 2026-05-25 Phase 4-A: edit mode에서는 버튼 클릭으로 장면 이동 박지 X.
         라벨 contenteditable 편집 중 실수 클릭으로 다음 장면 이동 막기 위함.
         감상 모드(editMode=false)는 기존 동작 그대로 — chooseOption 박힘. */
      if (ViewerState && ViewerState.editMode) {
        e.preventDefault();
        return;
      }
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
    return;
  }
  /* 2026-05-31 Text-4: 텍스트 작품 엔딩은 텍스트 전용 화면으로 분기.
     그림책/기타 ptype은 기존 _renderStoryEnding 그대로(0 수정) — 회귀 차단. */
  const _ptype = (ViewerState && ViewerState.project) ? ViewerState.project.projectType : null;
  if (_ptype === 'text') {
    _renderTextEnding(stage, scene);
    return;
  }
  /* 2026-05-31 Movie-E: 무비형 엔딩도 무비 장면 규칙(영상 → 종료 후 엔딩 UI)으로.
     그림책/기타 ptype은 기존 _renderStoryEnding 그대로(0 수정). */
  if (_ptype === 'movie') {
    _renderMovieEnding(stage, scene);
    return;
  }
  _renderStoryEnding(stage, scene);
}

function _renderStoryEnding(stage, scene) {
  const stats     = getEndingStats();
  const isTrueEnd = scene.isTrueEnd;
  const steps     = ViewerState.historyStack.length + 1;  // 지나온 장면 수

  const bgHtml = scene.imageData
    ? `<div class="scene-bg" style="background-image:url('${scene.imageData}')"></div>
       <div class="scene-bg-overlay scene-bg-overlay--dark"></div>`
    : `<div class="scene-bg-solid scene-bg-solid--ending"></div>`;

  /* v133: 엔딩에서 mood 메시지("다른 선택을 했다면…") 제거 — 사용자 명시.
     순차 등장으로 호흡을 만들고, 안내 문구 없이 본문/스탬프/경로/버튼만 차례로. */

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
  const _orig     = String(scene.body  || '');  /* v127: trim 박지 X — 엔딩 줄바꿈 유지 */
  /* v140-step4: aiViewMode가 aiS1 박혀있고 final 박혀있을 때만 AI 본문 박음. 원본 scene.body는 절대 변경 X */
  const userBody = (window.viewerAi && window.viewerAi._getDisplayBody) ? window.viewerAi._getDisplayBody(scene.id, _orig) : _orig;
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
  let endingImage = scene.imageData || null;
  /* P5-IMAGE-VARIANT-1: 이미지 보기 모드면 variant url로 표시(원본 보기는 그대로·동작 변화 0). 원본 필드 불변. */
  if (typeof window !== 'undefined' && window.viewerAi && typeof window.viewerAi._getDisplayImageSrc === 'function') {
    endingImage = window.viewerAi._getDisplayImageSrc(scene, endingImage);
  }
  const endingIllustHtml = endingImage
    ? `<div class="pb-illust" data-pb-illust="1">
         <div class="pb-illust__photo" data-pb-photo="1">
           <img class="pb-illust__inner" src="${endingImage}" draggable="false" alt="" decoding="async" fetchpriority="high">
         </div>
       </div>`
    : `<div class="pb-illust pb-illust--empty">
         <div class="pb-empty-mark">${systemIcon}</div>
       </div>`;

  /* v133: 엔딩 순차 등장 — terminal-step 박혀 CSS variable로 delay 제어.
     사용자 명령서 delay 계산식 그대로:
     · bodyDelay   = clamp(250 + textSpeed * 3.5,  250, 600)
     · badgeDelay  = clamp(750 + textSpeed * 12.5, 750, 2000)
     · statsDelay  = clamp(1100+ textSpeed * 18,  1100, 2900)
     · actionsDelay= clamp(1500+ textSpeed * 23,  1500, 3800)
     · itemDuration= clamp(300 + textSpeed * 4,    300, 700)
     장면 전환 느림 보정: bodyDelay ≥ sceneMs * 0.45 (max 1000ms — v127 정책 유지) */
  const _textSpeed = (ViewerState && ViewerState.project &&
    typeof ViewerState.project.textEntranceSpeed === 'number')
    ? Math.max(0, Math.min(100, ViewerState.project.textEntranceSpeed)) : 50;
  const _sceneSpeed = (ViewerState && ViewerState.project &&
    typeof ViewerState.project.sceneTransitionSpeed === 'number')
    ? Math.max(0, Math.min(100, ViewerState.project.sceneTransitionSpeed)) : 50;
  const _sceneMs = (typeof _sceneTransMs === 'function') ? _sceneTransMs(_sceneSpeed) : 1200;
  const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  let _bodyDelay    = _clamp(250  + _textSpeed * 3.5,  250,  600);
  const _badgeDelay = _clamp(750  + _textSpeed * 12.5, 750,  2000);
  const _statsDelay = _clamp(1100 + _textSpeed * 18,   1100, 2900);
  let _actionsDelay = _clamp(1500 + _textSpeed * 23,   1500, 3800);
  const _itemDur    = _clamp(300  + _textSpeed * 4,    300,  700);

  /* 장면 전환 느림 보정 — sceneMs * 0.45 까지 본문 시작 미룸 (max 1000ms 상한, v127 정책) */
  const _safeSceneDelay = _clamp(_sceneMs * 0.45, 0, 1000);
  _bodyDelay = Math.max(_bodyDelay, _safeSceneDelay);

  /* typewriter 보정 — bodyTypeMs 추정 후 actionsDelay 끌어올림. 단 4500ms 상한 */
  const _isTw = (typeof stage !== 'undefined') && stage.dataset &&
                stage.dataset.textEntrance === 'typewriter';
  if (_isTw) {
    const _bodyLen = (userBody || '').length;
    const _twStep = (typeof _textTwStepMs === 'function') ? _textTwStepMs(_textSpeed) : 80;
    const _bodyTypeMs = _clamp(_bodyLen * _twStep, 0, 2200);
    _actionsDelay = Math.min(Math.max(_actionsDelay, _bodyDelay + _bodyTypeMs + 700), 4500);
  }

  /* terminal-step CSS variables — pb-text--ending에 inline style로 박음 */
  const _seqStyle =
    `--terminal-body-delay:${Math.round(_bodyDelay)}ms;` +
    `--terminal-badge-delay:${Math.round(_badgeDelay)}ms;` +
    `--terminal-stats-delay:${Math.round(_statsDelay)}ms;` +
    `--terminal-actions-delay:${Math.round(_actionsDelay)}ms;` +
    `--terminal-item-duration:${Math.round(_itemDur)}ms;`;

  /* 다듬기 모드에서는 순차 등장 박지 X — 인스펙터로 박을 때 깜빡임 차단.
     edit-mode-active body class 박힘 + viewer-test-active 박지 X면 정적 표시. */
  const _isEdit = !!(ViewerState && ViewerState.editMode);

  /* 2026-05-25 Phase 3: 엔딩 본문 직접 입력 — AI 토글 안전 분기.
     원본 보기 모드일 때만 contenteditable 적용. AI 1단계 보기 상태에서는
     contenteditable 박지 X (AI 변환본 표시 중에 사용자 입력 충돌 방지). */
  const _aiViewMode = (typeof window !== 'undefined' && window.viewerAi
                       && typeof window.viewerAi._getAiViewMode === 'function')
    ? window.viewerAi._getAiViewMode() : 'original';
  const _allowInlineEdit = _isEdit && _aiViewMode === 'original';

  /* 텍스트 영역 — 작품 제목(작게) + 엔딩 본문(메인) + 이야기 끝 스탬프 + 경로 요약 + 버튼
     v133: 각 요소에 terminal-step + 종류별 modifier. CSS animation-delay 변수로 순차. */
  const endingTextHtml = `
    <div class="pb-text pb-text--ending ${_isEdit ? 'is-edit-static' : ''}"
         style="${_seqStyle}">
      ${userTitle ? `<div class="ending-user-title terminal-step terminal-step--title">${escHtml(userTitle)}</div>` : ''}
      ${(userBody || _allowInlineEdit) ? `<p class="ending-user-body terminal-step terminal-step--body${_allowInlineEdit ? ' js-pb-editable-body' : ''}" ${_allowInlineEdit ? 'contenteditable="true" data-pb-editable="body"' : ''} data-placeholder="(본문을 적어보세요)">${escHtml(userBody)}</p>` : ''}
      <div class="pb-ending-meta-inline terminal-step terminal-step--badge">
        ${trueEndBadge}
        <div class="ending-end-stamp">${systemIcon} ${systemLabel}</div>
        ${steps > 1 ? `<div class="pb-ending-meta-path">${steps}개의 장면을 거쳐 이 결말에 도달했어요</div>` : ''}
      </div>
      <div class="pb-text__actions ending-actions terminal-step terminal-step--actions is-locked"
           data-count="${ViewerState.historyStack.length > 0 ? 2 : 1}">
        <button class="terminal-btn terminal-btn--primary js-restart" disabled aria-disabled="true">↺ 다른 결말 찾기</button>
        ${ViewerState.historyStack.length > 0
          ? `<button class="terminal-btn terminal-btn--ghost js-back" disabled aria-disabled="true">← 직전 장면으로</button>` : ''}
      </div>
    </div>`;

  /* v49: 엔딩 그림 없으면 has-no-image 클래스 → illust 영역 줄이고 text 비중 ↑
     v77: textStyle 적용 — 엔딩 인스펙터에서 박은 글자 스타일을 --pb-* 변수로.
     사용자 박은 게 없으면 getTextStyle이 ENDING default(주아/20/#2b1f10/굵게) 반환.
     CSS .ending-user-body가 var() fallback으로 받음. */
  let endStyle = (typeof getTextStyle === 'function') ? getTextStyle(scene) : null;
  /* Phase 4-D-2A: aiS1/aiS2 보기면 variant textStyle(있으면) 적용, 없으면 원본 endStyle 그대로.
     원본 보기에선 원본 그대로 반환 → 기존 렌더와 동일. 감상자/편집자 공통. */
  if (typeof window !== 'undefined' && window.viewerAi && typeof window.viewerAi._getDisplayStyle === 'function') {
    endStyle = window.viewerAi._getDisplayStyle(scene.id, endStyle);
  }
  const endFontMap = (typeof TEXT_FONT_FAMILIES === 'object') ? TEXT_FONT_FAMILIES : {};
  const endCssVars = [];
  if (endStyle) {
    if (endStyle.fontFamily && endFontMap[endStyle.fontFamily]) endCssVars.push(`--pb-font-family: ${endFontMap[endStyle.fontFamily]}`);
    if (endStyle.fontSize) endCssVars.push(`--pb-fs-body: ${endStyle.fontSize}px`);
    if (endStyle.color)    endCssVars.push(`--pb-color-override: ${endStyle.color}`);
    if (endStyle.weight === 'bold') endCssVars.push(`--pb-fw-body: 700`);
    else if (endStyle.weight) endCssVars.push(`--pb-fw-body: 400`);
  }
  const endStyleAttr = endCssVars.length > 0 ? ` style="${endCssVars.join(';')}"` : '';
  const noImageClass = endingImage ? '' : ' ending-as-pb--no-image';
  /* v125: 엔딩 레이아웃 정책 — 항상 분할형 고정 (사용자 결정).
     v124c에 picturebookSubmode 반영 박았지만 그림 중심형 엔딩은 칸 밀림 +
     엔딩 표시 가려질 위험. 분할형이 안정적. 페이지 방향(projectMeta.pageOrientation)은
     body[data-page-orientation]에 박혀 모든 장면 자동 박힘 — 손 안 댐. */
  /* v138: 엔딩 마감톤 클래스 — 작품 단위 style/color 있을 때만 박힘 */
  const _pbEndToneCls = _pbToneClasses(scene, 'ending');
  _stageReplaceScene(stage, `
    <div class="scene-screen scene-screen--pb pb--split ending-as-pb${noImageClass}"
         ${endStyleAttr}
         data-presentation-mode="picturebook"
         data-presentation-submode="split"
         data-ending="true">
      <div class="pb-page">
        <div class="pb-frame${_pbEndToneCls}">
          ${endingIllustHtml}
          ${endingTextHtml}
        </div>
      </div>
    </div>`);

  if (typeof _setupPbPhotoWrappers === 'function') {
    _setupPbPhotoWrappers(stage);
  }

  /* 2026-05-25 Phase 3 fix: 엔딩 본문 직접 입력 핸들러 부착.
     일반 장면 renderScene과 동일 패턴 — initEditInteractions()가
     _attachPbEditableInteractions(frame)을 호출해 contenteditable element에
     input/blur 이벤트 + 우측 textarea 양방향 동기화 + _queueSave 박음.
     edit mode에서만 실행 (감상 모드 박지 X). */
  if (ViewerState.editMode && typeof initEditInteractions === 'function') {
    initEditInteractions();
  }

  /* v133: 엔딩 버튼은 등장 애니메이션 끝난 뒤에만 활성화.
     enableAt = actionsDelay + itemDuration. 다듬기 모드면 즉시 활성. */
  const _restartBtn = stage.querySelector('.js-restart');
  const _backBtn    = stage.querySelector('.js-back');
  const _enableButtons = () => {
    const actions = stage.querySelector('.ending-actions');
    if (actions) {
      actions.classList.remove('is-locked');
      actions.classList.add('is-ready');
    }
    if (_restartBtn) {
      _restartBtn.disabled = false;
      _restartBtn.setAttribute('aria-disabled', 'false');
    }
    if (_backBtn) {
      _backBtn.disabled = false;
      _backBtn.setAttribute('aria-disabled', 'false');
    }
  };
  if (_isEdit) {
    /* 다듬기 모드 — 즉시 활성 (인스펙터로 박을 때 클릭 박지 X 박는 게 어색) */
    _enableButtons();
  } else {
    const _enableAt = Math.round(_actionsDelay + _itemDur);
    setTimeout(_enableButtons, _enableAt);
  }

  /* 클릭 가드 — 등장 전엔 disabled, 등장 후도 transitioning 중이면 한 번만 */
  let _restartFired = false;
  let _backFired = false;
  _restartBtn?.addEventListener('click', (e) => {
    if (_restartBtn.disabled) { e.preventDefault(); return; }
    if (_restartFired) return;
    _restartFired = true;
    restartStory();
  });
  _backBtn?.addEventListener('click', (e) => {
    if (_backBtn.disabled) { e.preventDefault(); return; }
    if (_backFired) return;
    _backFired = true;
    navigateBack();
  });
}

/* ================================================================
   2026-05-31 Text-4: 텍스트 전용 엔딩 — "소설 마지막 장 / 글의 여운" 느낌.
   · 그림책 _renderStoryEnding과 분리 (pb 0 수정 → 회귀 차단).
   · scene-screen--text + data-text-theme + .text-card 재사용 →
     텍스트 테마 8종 / textStyle(폰트·크기·색·굵기)이 엔딩에도 자동 적용
     (Text-3A에서 확인된 'textTheme 엔딩 미적용' 한계 해소).
   · 그림책식 큰 일러스트 placeholder 칸 없음. 세로 판형. 본문 중심.
   · 이식: 진엔딩/일반 구분, 다시 시작/직전 장면, 본문 직접입력(Text-2B),
     순차 등장 / 다듬기 모드 즉시 enable. 저장 구조·필드 불변(body/title 기존).
   ================================================================ */
function _renderTextEnding(stage, scene) {
  const isTrueEnd = scene.isTrueEnd;
  const steps     = ViewerState.historyStack.length + 1;

  const userTitle = String(scene.title || '').trim();
  const _orig     = String(scene.body || '');   /* trim X — 엔딩 줄바꿈 유지 */
  const userBody  = (window.viewerAi && window.viewerAi._getDisplayBody)
    ? window.viewerAi._getDisplayBody(scene.id, _orig) : _orig;

  const systemLabel = isTrueEnd ? '진짜 결말' : '이야기 끝';
  const systemIcon  = isTrueEnd ? '🏆' : '🏁';

  /* 일반 텍스트 장면(_renderSceneText)과 100% 동일하게 — 테마/스타일/효과 같은 방식.
     컨테이너 class·data-* · CSS 변수를 일반 장면과 똑같이 써서 "같은 모드의 마지막 장면"으로 보이게 함. */
  const theme  = (typeof getTextTheme  === 'function') ? getTextTheme(scene)  : 'classic';
  let   style  = (typeof getTextStyle  === 'function') ? getTextStyle(scene)  : null;
  /* Phase 4-D-2A: aiS1/aiS2 보기면 variant textStyle(있으면) 적용, 없으면 원본 style 그대로.
     원본 보기에선 _getDisplayStyle이 원본 style을 그대로 반환 → 기존 렌더와 동일. 감상자/편집자 공통. */
  if (typeof window !== 'undefined' && window.viewerAi && typeof window.viewerAi._getDisplayStyle === 'function') {
    style = window.viewerAi._getDisplayStyle(scene.id, style);
  }
  const effect = (typeof getTextEffect === 'function') ? getTextEffect(scene) : null;
  const cssVars = [];
  if (style) {
    if (style.fontFamily) cssVars.push(`--text-ff: var(--font-${style.fontFamily})`);
    if (style.fontSize)   cssVars.push(`--text-fs-body: ${style.fontSize}px`);
    if (style.color)      cssVars.push(`--text-color-override: ${style.color}`);
    if (style.weight)     cssVars.push(`--text-weight: ${style.weight}`);
  }
  const styleAttr = cssVars.length > 0 ? ` style="${cssVars.join(';')}"` : '';

  /* 버튼 enable delay — 감상 시 본문 읽을 시간 (다듬기 모드는 즉시). 엔딩 전용 순차 연출 없음. */
  const _textSpeed = (ViewerState && ViewerState.project &&
    typeof ViewerState.project.textEntranceSpeed === 'number')
    ? Math.max(0, Math.min(100, ViewerState.project.textEntranceSpeed)) : 50;
  const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const _actionsDelay = _clamp(1200 + _textSpeed * 18, 1200, 3200);

  const _isEdit = !!(ViewerState && ViewerState.editMode);
  const _aiViewMode = (typeof window !== 'undefined' && window.viewerAi
                       && typeof window.viewerAi._getAiViewMode === 'function')
    ? window.viewerAi._getAiViewMode() : 'original';
  const _allowInlineEdit = _isEdit && _aiViewMode === 'original';
  const hasBack = ViewerState.historyStack.length > 0;

  /* 제목·본문은 일반 장면(_renderSceneCard)과 동일 class — 별도 엔딩 스타일 X.
     ADV-EDIT-ABSORB-TITLE-1: 제목도 일반 장면과 동일하게 직접편집 흡수(_textTitleHtml). */
  const titleHtml = _textTitleHtml(scene, _allowInlineEdit);
  const bodyHtml = (userBody || _allowInlineEdit)
    ? `<p class="text-card__body${_allowInlineEdit ? ' js-pb-editable-body' : ''}"`
      + `${_allowInlineEdit ? ' contenteditable="true" data-pb-editable="body"' : ''}`
      + ` data-placeholder="(본문을 적어보세요)">${escHtml(userBody)}</p>`
    : '';

  /* 일반 텍스트 장면과 동일한 scene-screen--text-paged(고정 세로 페이지) + 기본 .text-card.
     엔딩 차이는 카드 하단의 작은 마감 표시(.text-ending-foot)뿐 — 별도 대형 카드/스탬프 없음. */
  _stageReplaceScene(stage, `
    <div class="scene-screen scene-screen--text scene-screen--text-paged"
         data-presentation-mode="text"
         data-scene-num="${escHtml(String(scene.id))}"
         data-text-theme="${escHtml(theme)}"
         ${effect ? `data-text-entrance="${escHtml(effect.entrance)}"` : ''}
         ${effect ? `data-text-body="${escHtml(effect.body)}"` : ''}
         data-ending="true"${styleAttr}>
      <div class="scene-bg-solid"></div>
      <div class="text-page">
        <div class="text-card js-text-card">
          ${titleHtml}
          ${bodyHtml}
          <div class="text-ending-foot">
            <div class="text-ending-mark">
              <span class="text-ending-mark-label">${systemIcon} ${systemLabel}</span>
              ${steps > 1 ? `<span class="text-ending-path">${steps}개의 장면을 거쳐 이 결말에 도달했어요</span>` : ''}
            </div>
            <div class="text-ending-actions is-locked" data-count="${hasBack ? 2 : 1}">
              <button class="terminal-btn terminal-btn--primary js-restart" disabled aria-disabled="true">↺ 다른 결말 찾기</button>
              ${hasBack ? `<button class="terminal-btn terminal-btn--ghost js-back" disabled aria-disabled="true">← 직전 장면으로</button>` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>`);

  /* 글자 스타일 CSS 변수 즉시 적용 — 일반 장면 renderScene과 동일. */
  try { if (typeof _patchTextStyle === 'function') _patchTextStyle(); } catch (e) { /* noop */ }

  /* 본문 직접입력(Text-2B) — edit 모드에서만 contenteditable 핸들러 부착. */
  if (ViewerState.editMode && typeof initEditInteractions === 'function') {
    initEditInteractions();
  }

  /* 버튼 enable + 클릭 — _renderStoryEnding과 동일 흐름(작은 하단 버튼). */
  const _restartBtn = stage.querySelector('.js-restart');
  const _backBtn    = stage.querySelector('.js-back');
  const _enableButtons = () => {
    const actions = stage.querySelector('.text-ending-actions');
    if (actions) { actions.classList.remove('is-locked'); actions.classList.add('is-ready'); }
    if (_restartBtn) { _restartBtn.disabled = false; _restartBtn.setAttribute('aria-disabled', 'false'); }
    if (_backBtn)    { _backBtn.disabled = false;    _backBtn.setAttribute('aria-disabled', 'false'); }
  };
  if (_isEdit) {
    _enableButtons();
  } else {
    setTimeout(_enableButtons, Math.round(_actionsDelay));
  }
  let _restartFired = false, _backFired = false;
  _restartBtn?.addEventListener('click', (e) => {
    if (_restartBtn.disabled) { e.preventDefault(); return; }
    if (_restartFired) return;
    _restartFired = true;
    restartStory();
  });
  _backBtn?.addEventListener('click', (e) => {
    if (_backBtn.disabled) { e.preventDefault(); return; }
    if (_backFired) return;
    _backFired = true;
    navigateBack();
  });
}

/* ================================================================
   2026-05-31 Movie-E: 무비형 전용 엔딩 — 엔딩도 "무비 장면".
   · 엔딩 scene의 movieData.videoUrl 영상 재생 → 종료(data-played) 후 엔딩 UI 노출
     (일반 무비 장면 reveal=end와 동일 게이트 재사용).
   · 영상 없으면 placeholder + 엔딩 UI 즉시(data-played="true").
   · 그림책 _renderStoryEnding과 분리(0 수정). movie 장면 구조(.movie-stage/.movie-media/
     .movie-decision) 그대로 + decision을 엔딩 마감(마크/본문/경로/버튼)으로 교체.
   · 진엔딩/일반, 다시 시작(js-restart)/직전 장면(js-back) 이식. edit는 Movie-1 override로 미리 보임.
   ================================================================ */
function _renderMovieEnding(stage, scene) {
  const md     = (typeof getMovieData === 'function') ? getMovieData(scene) : {};
  const poster = (typeof resolveMoviePoster === 'function') ? resolveMoviePoster(scene) : null;
  const hasVideo = !!md.videoUrl;

  const isTrueEnd = scene.isTrueEnd;
  const steps     = ViewerState.historyStack.length + 1;
  const userTitle = String(scene.title || '').trim();
  const _orig     = String(scene.body || '');   /* trim X — 줄바꿈 유지 */
  const userBody  = (window.viewerAi && window.viewerAi._getDisplayBody)
    ? window.viewerAi._getDisplayBody(scene.id, _orig) : _orig;
  const systemLabel = isTrueEnd ? '진짜 결말' : '이야기 끝';
  const systemIcon  = isTrueEnd ? '🏆' : '🏁';
  const hasBack = ViewerState.historyStack.length > 0;

  /* 미디어 — _renderSceneMovie와 동일(영상/포스터/placeholder). 엔딩 placeholder는 마감 아이콘. */
  let mediaInner;
  if (hasVideo) {
    const posterAttr = poster ? ` poster="${poster}"` : '';
    mediaInner = `<video class="movie-video js-movie-video" controls
      preload="metadata"${posterAttr}
      src="${md.videoUrl}"></video>`;
  } else if (poster) {
    mediaInner = `<div class="movie-poster" style="background-image:url('${poster}')"></div>`;
  } else {
    mediaInner = `<div class="movie-poster movie-poster--empty">
      <div class="movie-empty-mark">${systemIcon}</div>
    </div>`;
  }
  const initialPlayed = hasVideo ? 'false' : 'true';

  /* 깜빡임 차단 — 같은 videoUrl이면 기존 <video> 노드 재사용 (_renderSceneMovie와 동일) */
  const existingVideo = stage.querySelector('.movie-video');
  const reuseVideo = (existingVideo && hasVideo && existingVideo.getAttribute('src') === md.videoUrl)
    ? existingVideo : null;

  const titleHtml = userTitle ? `<div class="movie-ending-title">${escHtml(userTitle)}</div>` : '';

  /* 2026-06-02: 엔딩 본문 — 일반 무비 장면(_renderSceneMovie)과 동일 정책으로 통일.
     · bodyEnabled 기준 동일(명시 필드 우선, 없으면 본문 유무).
     · edit + AI원본이면 빈 본문도 placeholder + 직접입력(contenteditable + data-pb-editable="body").
       → 기존 _attachPbEditableInteractions(제네릭 [data-pb-editable] 스캔)가 scene.body에 저장.
     · placeholder는 data-placeholder 속성일 뿐 — 저장 데이터(scene.body)엔 안 들어감.
     · 감상 모드는 옛대로 본문 있을 때만 표시. bodyEnabled=false면 미렌더(즉시 숨김). */
  const bodyEnabled = (scene.bodyEnabled === true) ? true
                    : (scene.bodyEnabled === false) ? false
                    : !!_orig;
  const _isEditMovieEnd = !!(ViewerState && ViewerState.editMode);
  const _aiViewMovieEnd = (window.viewerAi && typeof window.viewerAi._getAiViewMode === 'function')
    ? window.viewerAi._getAiViewMode() : 'original';
  const _allowMovieEndBodyEdit = _isEditMovieEnd && _aiViewMovieEnd === 'original';
  let bodyHtml = '';
  if (bodyEnabled && (userBody || _allowMovieEndBodyEdit)) {
    const _editAttrs = _allowMovieEndBodyEdit
      ? ' contenteditable="true" data-pb-editable="body" data-placeholder="엔딩 문장을 입력하세요"'
      : '';
    const _editCls  = _allowMovieEndBodyEdit ? ' js-pb-editable-body' : '';
    const _emptyCls = (_allowMovieEndBodyEdit && !_orig) ? ' is-empty' : '';
    const _shown    = _allowMovieEndBodyEdit ? _orig : userBody;   /* 편집=원문 / 감상=표시본 */
    bodyHtml = `<p class="movie-ending-body${_editCls}${_emptyCls}"${_editAttrs}>${escHtml(_shown)}</p>`;
  }
  const routeHtml = steps > 1 ? `<div class="movie-ending-route">${steps}개의 장면을 거쳐 이 결말에 도달했어요</div>` : '';

  _stageReplaceScene(stage, `
    <div class="scene-screen scene-screen--movie movie-ending-screen"
      data-display="${scene.displayType}"
      data-scene-num="${escHtml(String(scene.id))}"
      data-presentation-mode="movie"
      data-ending="true"
      data-movie-caption="overlay"
      data-movie-reveal="end"
      data-movie-deco="${(ViewerState.project && ViewerState.project.movieDecisionStyle === 'card') ? 'card' : 'panel'}"
      data-body-enabled="${bodyEnabled ? 'on' : 'off'}"
      data-played="${initialPlayed}"${hasVideo ? ' data-movie-has-video="true"' : ''}>
      <div class="movie-stage">
        <div class="movie-media">
          ${reuseVideo ? '' : mediaInner}
        </div>
        <div class="movie-decision movie-ending-decision">
          <div class="movie-ending-mark${isTrueEnd ? ' movie-ending-mark--true' : ''}">${systemIcon} ${systemLabel}</div>
          ${titleHtml}
          ${bodyHtml}
          ${routeHtml}
          <div class="movie-ending-actions">
            <button class="terminal-btn terminal-btn--primary js-restart">↺ 다른 결말 찾기</button>
            ${hasBack ? `<button class="terminal-btn terminal-btn--ghost js-back">← 직전 장면으로</button>` : ''}
          </div>
        </div>
      </div>
    </div>`);

  /* 보존한 video 노드 reattach (재로드 X) */
  if (reuseVideo) {
    const newMedia = stage.querySelector('.movie-media');
    if (newMedia) newMedia.appendChild(reuseVideo);
  }

  /* 2026-06-02 fix: 엔딩 본문 직접입력 핸들러 부착 — _renderTextEnding/_renderSceneMovie와 동일.
     이 호출이 빠져서 .movie-ending-body[data-pb-editable="body"]에 input/placeholder/저장 핸들러가
     안 붙었음 → ① placeholder(is-empty) 미해제로 글자가 placeholder 옆에 붙음 ② scene.body 미저장으로
     본문 사용 ON/OFF 재렌더 시 본문 소실. initEditInteractions가 frame 전체 [data-pb-editable] 재부착. */
  if (ViewerState.editMode && typeof initEditInteractions === 'function') {
    initEditInteractions();
  }

  /* 영상 종료 → data-played="true" → 엔딩 decision 노출 (일반 무비 장면과 동일 게이트).
     감상=영상 종료 후 / 영상 없음=즉시 / 편집=Movie-1 override로 미리 보임. */
  stage.querySelectorAll('.js-movie-video').forEach(video => {
    video.addEventListener('ended', () => {
      const sc = video.closest('.scene-screen--movie');
      if (sc) sc.setAttribute('data-played', 'true');
    });
  });

  /* 다시 시작 / 직전 장면 — _renderStoryEnding과 동일 동작. */
  const _restartBtn = stage.querySelector('.js-restart');
  const _backBtn    = stage.querySelector('.js-back');
  let _restartFired = false, _backFired = false;
  _restartBtn?.addEventListener('click', () => {
    if (_restartFired) return;
    _restartFired = true;
    restartStory();
  });
  _backBtn?.addEventListener('click', () => {
    if (_backFired) return;
    _backFired = true;
    navigateBack();
  });
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

  _stageReplaceScene(stage, `
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
    </div>`);

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
  /* 2026-06 AI 안정화: AI 작품 다듬기는 텍스트·그림책 모드에서만 노출.
     무비형/체험전시형은 이번 범위 외 — AI 버튼 숨김(ptype gate). */
  const _aiPtypeAllowed = !!(ViewerState.project &&
    (ViewerState.project.projectType === 'text' || ViewerState.project.projectType === 'picturebook'));
  /* Phase 1: 교사 AI 권한 게이트.
     · 학급 AI 설정 멱등 preload — 텍스트/그림책 + 제작자 편집일 때만(무비/체험엔 읽기 X).
       ViewerState.classId가 늦게 준비돼도 renderHUD가 다시 호출되면 자가 보정됨.
     · _aiHardOff = 학급 aiSettings 노드가 있고 enabled !== true일 때만 true.
       미로드/노드없음/켜짐 → false(버튼 노출, 서버가 최종 차단) — 안전 fallback. */
  if (_aiPtypeAllowed && fromMaker && isEdit &&
      window.viewerAi && typeof window.viewerAi.preloadClassAiSettings === 'function') {
    try { window.viewerAi.preloadClassAiSettings(); } catch (e) { /* noop */ }
  }
  const _aiHardOff = !!(window.viewerAi && typeof window.viewerAi.isClassAiHardOff === 'function'
    && window.viewerAi.isClassAiHardOff());
  const _aiAllowed = _aiPtypeAllowed && !_aiHardOff;
  const makerBarHtml = fromMaker ? `
    <div class="maker-return-bar ${isEdit ? 'maker-return-bar--editing' : ''}">
      <span class="maker-return-label">${isEdit ? '🎨 마감 편집 중' : '✏️ 제작자 테스트 중'}</span>
      <div class="maker-return-actions">
        ${isEdit ? `
          <button class="maker-return-btn maker-return-btn--test js-edit-preview-test" title="실제 관람자 화면으로 확인">▶ 감상 테스트</button>
          ${_aiAllowed ? '<button class="maker-return-btn maker-return-btn--ai js-ai-trigger" title="작품 전체 AI 다듬기 — 문장 정돈·작품 검사">🤖 AI 작품 다듬기</button>' : ''}
          <button class="maker-return-btn js-edit-open-routes" title="엔딩별 이야기 흐름 점검">🛤 루트 보기</button>
          <button class="maker-return-btn js-edit-open-map" title="장면 연결을 한눈에 확인">🔍 구조 보기</button>
          <button class="maker-return-btn js-edit-return-maker" title="브랜치 화면으로 돌아가기">← 브랜치 화면으로</button>
          <button class="maker-return-btn js-return-home" title="처음 메뉴로 돌아가기">🌿 홈</button>
          <button class="maker-return-btn maker-return-btn--save js-edit-save" title="즉시 저장">💾 저장</button>
        ` : `
          <button class="maker-return-btn js-return-to-maker">← 브랜치 화면으로</button>
          <button class="maker-return-btn js-return-home" title="처음 메뉴로 돌아가기">🌿 홈</button>
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

  /* 2026-05-25: 🌿 홈 — 처음 메뉴(index.html)로 복귀.
     태블릿 앱모드에서 history 꼬임 방지 위해 location.replace 사용.
     confirm으로 실수 클릭 방어. 작품 데이터/storage 절대 손대지 않음. */
  hud.querySelector('.js-return-home')?.addEventListener('click', () => {
    if (!confirm('처음 메뉴로 돌아갈까요?')) return;
    location.replace('index.html');
  });

  hud.querySelector('.js-go-edit')?.addEventListener('click', () => {
    /* v106: 모바일 + 텍스트형 작품이면 viewer 다듬기 모드 박지 말고 maker.html로.
       maker.html에서 mobileTextBranch.js가 자동 활성 → 모바일 텍스트 편집 UI.
       옛 흐름 (PC 다듬기 모드)는 다른 모드/데스크탑 그대로. */
    const isMobile = /Mobi|Android|iPhone|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
    const isText = ViewerState.project && ViewerState.project.projectType === 'text';
    if (isMobile && isText) {
      const p = new URLSearchParams();
      const teamName = ViewerState.project.teamName || '';
      const classId  = ViewerState.project.classId  || '';
      if (teamName) p.set('team', teamName);
      p.set('from', 'maker');
      p.set('resume', '1'); /* v108: sessionStorage.makerSession 있으면 입장 화면 건너뜀 */
      if (classId) p.set('classId', classId);
      p.set('ptype', 'text');
      window.location.href = `maker.html?${p.toString()}`;
      return;
    }
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
async function _returnToMaker() {
  /* v70: 튕김 버그 추적 — 감상 테스트 → 브랜치로 돌아가기 시 가끔 꺼짐.
     원인 추정: pending save + close 타이밍 race. 호출 진입에 안전 cleanup 박음. */
  try {
    if (typeof _flushPendingSave === 'function') {
      await _flushPendingSave();
    }
  } catch (e) { /* save 실패해도 navigate는 계속 */ }
  /* SPA 상태 정리 — testingEdit/editMode 잔재 */
  try {
    if (typeof ViewerState !== 'undefined' && ViewerState) {
      ViewerState._testingEdit = false;
      ViewerState.editMode = false;
    }
  } catch (e) { /* noop */ }

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
  /* v106: ctx 박지 못해도 URL params (team/classId/from) 박혀있으면 그것 우선.
     모바일 텍스트형 흐름에선 ctx 박지 않을 때가 있어 maker가 진입 화면 박음 → 로그인 튐. */
  if (!ctx || !ctx.url) {
    const params = new URLSearchParams(location.search);
    const team    = params.get('team');
    const classId = params.get('classId');
    const ptype   = params.get('ptype');
    if (team) {
      const p = new URLSearchParams();
      p.set('team', team);
      p.set('from', 'maker');
      p.set('resume', '1'); /* v108: sessionStorage.makerSession 있으면 자동 입장 */
      if (classId) p.set('classId', classId);
      if (ptype)   p.set('ptype', ptype);
      return `maker.html?${p.toString()}`;
    }
    return 'maker.html?resume=1'; /* v108: 최소한 resume 신호는 박음 */
  }

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
  _stageReplaceScene(stage, `
    <div class="error-screen">
      <div class="error-content">
        <div class="error-icon">⚠️</div>
        <p class="error-msg">${escHtml(msg)}</p>
        <button class="terminal-btn terminal-btn--ghost js-err-back">돌아가기</button>
      </div>
    </div>`);
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

/* v66: 장면 전환 — 옛 .scene-screen에 .is-leaving 클래스 박고 새 콘텐츠 동시 박기.
   stage.innerHTML 통째 교체 대신 helper 사용 → 두 layer overlap으로 진짜 페이지 넘김 효과.
   v133: inline animation-duration 명시 박음 (안전망) — CSS 변수 적용이 어떤 이유로 안 들어가도
         실제 duration이 정확히 적용되도록. 계측 결과 박을 때 inlineDuration으로 확인 가능. */
function _stageReplaceScene(stage, newHtml) {
  if (!stage) return;
  const oldScene = stage.querySelector('.scene-screen:not(.is-leaving)');

  const tmp = document.createElement('div');
  tmp.innerHTML = newHtml;
  const newScene = tmp.querySelector('.scene-screen');

  if (!newScene) {
    /* fallback: 옛 흐름 (통째 교체) */
    stage.innerHTML = newHtml;
    return;
  }

  /* v133: 실제 duration 계산 — sceneSpeedPct가 없으면 50 fallback */
  const sPct = parseInt(stage.dataset.sceneSpeedPct, 10);
  const duration = _sceneTransMs(isNaN(sPct) ? 50 : sPct);

  /* v133: 새 scene과 leaving scene 둘 다 inline animation-duration 박음.
     CSS 변수가 적용되더라도 inline이 우선 — 안전망. */
  newScene.style.animationDuration = duration + 'ms';

  /* 옛 scene leaving 시작 (CSS absolute + is-leaving keyframe) */
  if (oldScene) {
    oldScene.classList.add('is-leaving');
    oldScene.style.animationDuration = duration + 'ms';
  }

  /* 새 scene을 stage의 첫 자식 위치에 박기 (옛 scene이 뒤에 absolute로 떠 있음).
     이러면 stage.querySelector('.scene-screen:not(.is-leaving)')가 새 scene 매치. */
  stage.insertBefore(newScene, stage.firstChild);

  /* newHtml에 .scene-screen 외 다른 element 있으면 같이 박기 (보통 없음) */
  while (tmp.firstChild) {
    stage.appendChild(tmp.firstChild);
  }

  /* 옛 scene leaving 애니메이션 시간 후 제거. v73: 속도는 _sceneTransMs로 매핑. */
  if (oldScene && oldScene.parentNode === stage) {
    setTimeout(() => {
      if (oldScene.parentNode === stage) oldScene.remove();
    }, duration + 50);
  }

  /* v71: 텍스트 등장 효과 적용 — typewriter이면 글자 단위 span reveal */
  _applyTextEntranceTypewriter(stage, newScene);
}

/* v133: 장면 전환 계측 헬퍼 — console에서 window.__measureTransition() 호출.
   sceneTransitionSpeed가 실제 어떤 값으로 들어가고 computed animation-duration이
   몇 ms인지 즉시 확인. 표지 다듬기 미리보기·감상 테스트·실제 감상 세 환경 다 동일하게 측정. */
if (typeof window !== 'undefined') {
  window.__measureTransition = function () {
    const vf = document.getElementById('viewer-frame');
    if (!vf) return console.warn('[measure] viewer-frame 없음');
    const current = vf.querySelector('.scene-screen:not(.is-leaving)');
    const leaving = vf.querySelector('.scene-screen.is-leaving');
    const computed = current ? getComputedStyle(current) : null;
    const computedLeave = leaving ? getComputedStyle(leaving) : null;
    const result = {
      /* 1) 데이터 흐름 — 가능성 1 (저장값/로드값) 진단 */
      projectTransition:    ViewerState && ViewerState.project ? ViewerState.project.sceneTransition : null,
      projectSpeed:         ViewerState && ViewerState.project ? ViewerState.project.sceneTransitionSpeed : null,
      projectTextSpeed:     ViewerState && ViewerState.project ? ViewerState.project.textEntranceSpeed : null,
      frameTransition:      vf.dataset.transition,
      frameSpeed:           vf.dataset.sceneSpeedPct,
      frameTextSpeed:       vf.dataset.textSpeedPct,
      /* 2) CSS 변수 — 가능성 2 (CSS 적용/덮어쓰기) 진단 */
      cssVarSceneDur:       getComputedStyle(vf).getPropertyValue('--scene-trans-duration').trim(),
      cssVarTextDur:        getComputedStyle(vf).getPropertyValue('--text-ent-duration').trim(),
      cssVarTextStart:      getComputedStyle(vf).getPropertyValue('--text-ent-start-delay').trim(),
      /* 3) 실제 computed animation — 가능성 3 (easing/keyframe) 진단 */
      bodyClass:            document.body.className,
      frameClass:           vf.className,
      currentAnimName:      computed ? computed.animationName : null,
      currentAnimDuration:  computed ? computed.animationDuration : null,
      currentAnimTiming:    computed ? computed.animationTimingFunction : null,
      currentAnimFillMode:  computed ? computed.animationFillMode : null,
      currentInlineDur:     current ? current.style.animationDuration : null,
      leavingAnimName:      computedLeave ? computedLeave.animationName : null,
      leavingAnimDuration:  computedLeave ? computedLeave.animationDuration : null,
      leavingInlineDur:     leaving ? leaving.style.animationDuration : null,
      /* 4) 컨텍스트 */
      editMode:             !!(ViewerState && ViewerState.editMode),
      testingEdit:          !!(ViewerState && ViewerState._testingEdit),
    };
    /* eslint-disable no-console */
    console.group('[__measureTransition] 장면 전환 계측');
    console.table(result);
    console.log('계측 시점 안내: 실제 전환 직후(2~3초 안) 호출해야 leaving scene이 잡힘');
    console.groupEnd();
    return result;
  };
}

/* v73: 슬라이더 0~100 → ms 매핑.
   v129: 그림책 호흡 위해 느림 영역 확장 — piecewise. (v128 220~1300ms는 너무 짧아서
         느림 체감이 부족했음.)
         · 0~50%(빠름~보통): 300~1200ms (옛 v128 빠름 영역과 유사한 호흡)
         · 50~100%(보통~느림): 1200~3500ms (느림은 진짜 느리게 — 그림책 여운)
         본문 시작 delay는 applyWorkEffectVars에서 min(sceneMs, 2000) clamp 유지 — 본문은
         최대 2초 후 등장 → 빈 화면 5초 멍하니 X.
   텍스트 등장 CSS 효과:  200ms(0) ~ 3000ms(100), linear.
   텍스트 등장 타자기 step: 20ms(0) ~ 300ms(100), linear (글자당).
   viewer-frame style.setProperty로 CSS 변수 박음 — 모든 룰이 변수 참조. */
function _sceneTransMs(pct) {
  const p = Math.max(0, Math.min(100, typeof pct === 'number' ? pct : 50));
  if (p < 50) return Math.round(300 + (p / 50) * 900);            /* 0~50 → 300~1200 */
  return Math.round(1200 + ((p - 50) / 50) * 2300);                /* 50~100 → 1200~3500 */
}
function _textEntDurMs(pct)  { return Math.round(200 + (pct / 100) * 2800); }
function _textTwStepMs(pct)  { return Math.round(20  + (pct / 100) * 280); }

function applyWorkEffectVars(vf, sceneSpeed, textSpeed, textEntrance) {
  if (!vf) return;
  const sPct = typeof sceneSpeed === 'number' ? sceneSpeed : 50;
  const tPct = typeof textSpeed  === 'number' ? textSpeed  : 50;
  const sceneMs = _sceneTransMs(sPct);
  vf.style.setProperty('--scene-trans-duration', sceneMs + 'ms');
  vf.style.setProperty('--text-ent-duration',    _textEntDurMs(tPct) + 'ms');
  vf.style.setProperty('--text-tw-step',         _textTwStepMs(tPct) + 'ms');
  /* v127: 본문 시작 delay clamp — 사용자 박은 "전환 후 본문 2초 이내".
     느림(3500ms) 박은 거 = 본문 5초+ 박힘. 사용자 박은 명: 2000ms 상한. */
  vf.style.setProperty('--text-ent-start-delay', Math.min(sceneMs, 2000) + 'ms');
  /* --text-ent-total 기본값: 효과 'none'이면 0, CSS 효과면 duration, typewriter는 일단 duration
     (실제 typewriter는 _applyTextEntranceTypewriter에서 글자수 보고 다시 박음) */
  if (textEntrance === 'none' || !textEntrance) {
    vf.style.setProperty('--text-ent-total', '0ms');
  } else {
    vf.style.setProperty('--text-ent-total', _textEntDurMs(tPct) + 'ms');
  }
  /* viewer-frame data attr — slider value 그대로 (스타일 변수 외에 JS 참조용) */
  vf.dataset.sceneSpeedPct = sPct;
  vf.dataset.textSpeedPct  = tPct;
}

/* v72: 표지 인스펙터에서 효과 버튼/슬라이더 변경 시 옆 viewer-frame에 1회 미리보기 재생.
   v73: slider value(0~100) 기반. body.preview-active 박아 다듬기 차단 룰 일시 해제.
   미리보기 element는 .preview-text-once 박혀 animation-delay 0 강제(CSS 룰).
   field = 'sceneTransition' | 'sceneTransitionSpeed' → 표지 카드 1회
   field = 'textEntrance' | 'textEntranceSpeed'      → 표지 제목/소개 1회 (typewriter는 span) */
let _previewTimers = { scene: null, text: null };
function previewWorkEffect(field) {
  const stage = document.getElementById('viewer-frame');
  if (!stage) return;
  const scene = stage.querySelector('.scene-screen:not(.is-leaving)');
  if (!scene) return;

  /* body.preview-active 박아 .tw-char 차단 해제 (미리보기 끝나면 해제). */
  if (document.body) document.body.classList.add('preview-active');

  if (field === 'sceneTransition' || field === 'sceneTransitionSpeed') {
    if (_previewTimers.scene) {
      clearTimeout(_previewTimers.scene);
      scene.classList.remove('preview-once');
    }
    /* reflow 강제 — animation restart */
    void scene.offsetWidth;
    scene.classList.add('preview-once');

    const sPct = parseInt(stage.dataset.sceneSpeedPct, 10);
    const dur  = _sceneTransMs(isNaN(sPct) ? 50 : sPct);
    _previewTimers.scene = setTimeout(() => {
      scene.classList.remove('preview-once');
      _previewTimers.scene = null;
      _maybeDropPreviewActive();
    }, dur + 120);
    return;
  }

  if (field === 'textEntrance' || field === 'textEntranceSpeed') {
    if (_previewTimers.text) clearTimeout(_previewTimers.text);

    const targets = scene.querySelectorAll('.cover-title-pb, .cover-subtitle-pb, .pb-text__body');
    if (!targets.length) { _maybeDropPreviewActive(); return; }

    const mode = stage.dataset.textEntrance || 'none';
    const tPct = parseInt(stage.dataset.textSpeedPct, 10);
    const dur  = _textEntDurMs(isNaN(tPct) ? 50 : tPct);

    /* 옛 typewriter span 복원 — 새 미리보기 시작 전 */
    targets.forEach(el => {
      el.classList.remove('preview-text-once');
      if (el.dataset.twProcessed === '1' || el.dataset.twPreview === '1') {
        const plain = el.textContent || '';
        el.innerHTML = '';
        el.textContent = plain;
        delete el.dataset.twProcessed;
        delete el.dataset.twPreview;
      }
    });

    if (mode === 'none') {
      /* 효과 없음 — 미리보기도 안 함 */
      _maybeDropPreviewActive();
      return;
    }

    if (mode === 'typewriter') {
      /* v121: 긴 본문(400자+) typewriter 박지 X — fade로 fallback. _applyTextEntranceTypewriter와 동일 정책. */
      let _totalChars = 0;
      targets.forEach(el => {
        if (el.getAttribute('contenteditable') === 'true') return;
        _totalChars += (el.textContent || '').length;
      });
      if (_totalChars > 400) {
        /* CSS fade fallback 박음 */
        targets.forEach(el => {
          void el.offsetWidth;
          el.classList.add('preview-text-once');
        });
        _previewTimers.text = setTimeout(() => {
          targets.forEach(el => el.classList.remove('preview-text-once'));
          _previewTimers.text = null;
          _maybeDropPreviewActive();
        }, dur + 120);
        return;
      }
      const stepMs = _textTwStepMs(isNaN(tPct) ? 50 : tPct);
      let maxDelay = 0;
      targets.forEach(el => {
        if (el.getAttribute('contenteditable') === 'true') return;
        const text = el.textContent || '';
        if (!text.trim()) return;

        el.dataset.twPreview = '1';
        el.innerHTML = '';
        const frag = document.createDocumentFragment();
        Array.from(text).forEach((ch, i) => {
          const sp = document.createElement('span');
          sp.className = 'tw-char';
          sp.textContent = ch;
          /* !important 박아 CSS shorthand 충돌 회피 (다듬기 룰 풀린 후에도 안전) */
          sp.style.setProperty('animation-delay', (i * stepMs) + 'ms', 'important');
          frag.appendChild(sp);
        });
        el.appendChild(frag);
        el.classList.add('preview-text-once');
        maxDelay = Math.max(maxDelay, text.length * stepMs);
      });
      _previewTimers.text = setTimeout(() => {
        targets.forEach(el => {
          el.classList.remove('preview-text-once');
          if (el.dataset.twPreview === '1') {
            const plain = el.textContent || '';
            el.innerHTML = '';
            el.textContent = plain;
            delete el.dataset.twPreview;
          }
        });
        _previewTimers.text = null;
        _maybeDropPreviewActive();
      }, maxDelay + 300);
      return;
    }

    /* CSS 효과 (fade/slide-up/blur-in/pop) */
    targets.forEach(el => {
      void el.offsetWidth;
      el.classList.add('preview-text-once');
    });
    _previewTimers.text = setTimeout(() => {
      targets.forEach(el => el.classList.remove('preview-text-once'));
      _previewTimers.text = null;
      _maybeDropPreviewActive();
    }, dur + 120);
  }
}
function _maybeDropPreviewActive() {
  if (_previewTimers.scene || _previewTimers.text) return;
  if (document.body) document.body.classList.remove('preview-active');
}

/* v71: typewriter 효과 — 본문·표지 제목/소개의 textContent를 글자 단위 span으로 변환.
   각 span에 inline animation-delay 박아 stagger 등장.
   v73: animation-delay에 장면 전환 duration 더해서 박음 (장면 끝난 후 시작).
        animation-delay 정확도 위해 setProperty('important') 사용.
        --text-ent-total CSS 변수에 실제 typewriter 총 시간 박음 (행동버튼 delay 위해).
   다듬기 모드에선 skip (입력 충돌). CSS 효과(fade/slide-up/blur-in/pop)는 css만으로 동작. */
/* v121: typewriter 긴 본문 fallback 한도 — 이 이상은 글자별 span 박지 X.
   본문이 길수록 span DOM 박은 거가 박지 X 박는 부담 박힘. 사용자 설정(textEntrance=typewriter)은
   박지 X — 렌더링 시에만 fallback. CSS 효과(fade 등)는 typewriter 박지 X 박혀있음. */
const TYPEWRITER_MAX_CHARS = 400;

function _applyTextEntranceTypewriter(stage, newScene) {
  if (!stage || !newScene) return;
  const mode = stage.dataset.textEntrance || 'none';

  /* 다듬기 모드면 skip (contenteditable 충돌 + 깜빡임 차단) */
  const isEdit =
    stage.classList.contains('edit-mode-on') ||
    (document.body && document.body.classList.contains('edit-mode-active'));

  /* 기본: --text-ent-total = duration (CSS 효과 시간) — applyWorkEffectVars에서 박은 값 유지 */
  if (mode !== 'typewriter' || isEdit) return;

  /* v121: 긴 본문 fallback — 400자 초과면 typewriter 박지 X. dataset만 박은 거 박음
     → CSS 효과 박지 X (none 효과로 박힘). 사용자 설정은 박지 X. */
  const targetsCheck = newScene.querySelectorAll(
    '.pb-text__body, .cover-title-pb, .cover-subtitle-pb'
  );
  let totalChars = 0;
  targetsCheck.forEach(el => {
    if (el.getAttribute('contenteditable') === 'true') return;
    totalChars += (el.textContent || '').length;
  });
  if (totalChars > TYPEWRITER_MAX_CHARS) {
    /* dataset 박지 X — DOM에 typewriter 박지 X (span 박지 X) */
    return;
  }

  const tPct = parseInt(stage.dataset.textSpeedPct, 10);
  const stepMs = _textTwStepMs(isNaN(tPct) ? 50 : tPct);
  const sPct = parseInt(stage.dataset.sceneSpeedPct, 10);
  /* v127: 본문 시작 delay 2초 clamp (CSS와 동일 정책) */
  const sceneDur = Math.min(_sceneTransMs(isNaN(sPct) ? 50 : sPct), 2000);

  const targets = newScene.querySelectorAll(
    '.pb-text__body, .cover-title-pb, .cover-subtitle-pb'
  );

  let maxTotal = 0;
  targets.forEach(el => {
    if (el.getAttribute('contenteditable') === 'true') return;
    if (el.dataset.twProcessed === '1') return;

    const text = el.textContent || '';
    if (!text.trim()) return;

    el.dataset.twProcessed = '1';
    el.innerHTML = '';

    const frag = document.createDocumentFragment();
    Array.from(text).forEach((ch, i) => {
      const sp = document.createElement('span');
      sp.className = 'tw-char';
      sp.textContent = ch;
      /* 장면 전환 끝난 후 stagger 시작 (v127: 2초 상한 박힘) */
      sp.style.setProperty('animation-delay', (sceneDur + i * stepMs) + 'ms', 'important');
      frag.appendChild(sp);
    });
    el.appendChild(frag);
    maxTotal = Math.max(maxTotal, text.length * stepMs);
  });

  /* --text-ent-total 갱신 — typewriter 실제 시간 (행동버튼 페이드 delay 위해) */
  if (maxTotal > 0) {
    stage.style.setProperty('--text-ent-total', maxTotal + 'ms');
  }
}
