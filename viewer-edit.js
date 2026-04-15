/* ================================================================
   viewer-edit.js — viewer edit 최소형
   표현 마감만: placement / x / y / w / h / opacity / stylePreset
   구조 편집(장면 추가/삭제/연결 변경/본문 수정) 절대 없음
   ================================================================ */

/* ── edit panel 렌더 ── */
function renderEditPanel() {
  const panel = document.getElementById('edit-panel');
  if (!panel) return;

  const scene = ViewerState.scenes[ViewerState.currentSceneId];
  if (!scene || scene.choices.length === 0) {
    /* 선택지 없는 장면(예: 엔딩) — 템플릿 편집 + 저장 가능 */
    panel.innerHTML = `
      <div class="edit-panel-inner">
        ${_editActionsHtml()}
        <div class="edit-divider"></div>
        <h3 class="edit-panel-title">장면 편집</h3>
        ${_sceneTemplateHtml(scene)}
        <p class="edit-empty" style="margin-top:12px;margin-bottom:12px;">이 장면에는 선택지가 없어요.</p>
        <button class="edit-save-btn js-edit-save">💾 저장</button>
      </div>`;
    _bindEditActions(panel);
    _bindSceneTemplateEvents(panel, scene);
    /* 선택지 없는 장면의 저장 버튼 바인딩 */
    panel.querySelector('.js-edit-save')?.addEventListener('click', async () => {
      const saveBtn = panel.querySelector('.js-edit-save');
      saveBtn.disabled    = true;
      saveBtn.textContent = '저장 중...';
      try {
        await saveViewerMeta();
        saveBtn.textContent = '✅ 저장됨';
        setTimeout(() => { saveBtn.disabled = false; saveBtn.textContent = '💾 저장'; }, 1500);
      } catch (err) {
        saveBtn.textContent = '❌ 저장 실패';
        saveBtn.disabled    = false;
      }
    });
    return;
  }

  const selectedId = ViewerState.selectedChoiceId;
  const choice     = selectedId
    ? scene.choices.find(c => c.id === selectedId)
    : scene.choices[0];

  if (!choice) return;
  if (!selectedId) ViewerState.selectedChoiceId = choice.id;

  const p = choice.presentation;

  panel.innerHTML = `
    <div class="edit-panel-inner">
      ${_editActionsHtml()}
      <div class="edit-divider"></div>
      <h3 class="edit-panel-title">장면 편집</h3>

      <!-- 장면 템플릿 override -->
      ${_sceneTemplateHtml(scene)}

      <div class="edit-divider"></div>
      <h4 class="edit-section-title">선택지 편집</h4>

      <!-- 선택지 탭 -->
      <div class="edit-tabs">
        ${scene.choices.map(c => `
          <button class="edit-tab js-edit-tab ${c.id === choice.id ? 'edit-tab--active' : ''}"
            data-choice-id="${c.id}">
            ${escHtml(c.label || c.id)}
          </button>`).join('')}
      </div>

      <!-- placement -->
      <div class="edit-row">
        <label class="edit-label">위치 방식</label>
        <div class="edit-toggle-group">
          <button class="edit-toggle js-placement ${p.placement === 'bottom'   ? 'active' : ''}" data-val="bottom">하단</button>
          <button class="edit-toggle js-placement ${p.placement === 'overlay'  ? 'active' : ''}" data-val="overlay">오버레이</button>
        </div>
      </div>

      <!-- overlay 전용: x / y -->
      <div class="edit-row edit-row--overlay ${p.placement === 'overlay' ? '' : 'edit-row--hidden'}">
        <label class="edit-label">위치 X (%)</label>
        <input class="edit-input js-pos-x" type="number" min="0" max="100" value="${p.x ?? 50}"/>
        <label class="edit-label">위치 Y (%)</label>
        <input class="edit-input js-pos-y" type="number" min="0" max="100" value="${p.y ?? 50}"/>
      </div>

      <!-- overlay 전용: w / h -->
      <div class="edit-row edit-row--overlay ${p.placement === 'overlay' ? '' : 'edit-row--hidden'}">
        <label class="edit-label">너비 (px)</label>
        <input class="edit-input js-size-w" type="number" min="60" max="600" value="${p.w ?? 180}"/>
        <label class="edit-label">높이 (px)</label>
        <input class="edit-input js-size-h" type="number" min="32" max="200" value="${p.h ?? 48}"/>
      </div>

      <!-- opacity -->
      <div class="edit-row">
        <label class="edit-label">투명도</label>
        <input class="edit-range js-opacity" type="range" min="0.1" max="1" step="0.05" value="${p.opacity ?? 1}"/>
        <span class="edit-range-val js-opacity-val">${Math.round((p.opacity ?? 1) * 100)}%</span>
      </div>

      <!-- stylePreset -->
      <div class="edit-row">
        <label class="edit-label">스타일</label>
        <div class="edit-toggle-group">
          ${['basic','ghost','pin'].map(preset => `
            <button class="edit-toggle js-preset ${p.stylePreset === preset ? 'active' : ''}" data-val="${preset}">
              ${{ basic:'기본', ghost:'고스트', pin:'핀' }[preset]}
            </button>`).join('')}
        </div>
      </div>

      <!-- 저장 -->
      <button class="edit-save-btn js-edit-save">💾 저장</button>
    </div>`;

  _bindEditActions(panel);
  _bindSceneTemplateEvents(panel, scene);
  _bindEditPanelEvents(panel, scene, choice);
}

function _bindEditPanelEvents(panel, scene, choice) {
  /* 탭 전환 */
  panel.querySelectorAll('.js-edit-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      ViewerState.selectedChoiceId = tab.dataset.choiceId;
      renderEditPanel();
      renderCurrentScene();  // 선택지 하이라이트 반영
    });
  });

  /* placement 전환 */
  panel.querySelectorAll('.js-placement').forEach(btn => {
    btn.addEventListener('click', () => {
      choice.presentation.placement = btn.dataset.val;
      /* overlay로 바꿀 때 기본 위치 초기화 */
      if (btn.dataset.val === 'overlay' && choice.presentation.x == null) {
        choice.presentation.x = 50;
        choice.presentation.y = 50;
        choice.presentation.w = 180;
        choice.presentation.h = 48;
      }
      renderEditPanel();
      renderCurrentScene();
    });
  });

  /* x/y */
  panel.querySelector('.js-pos-x')?.addEventListener('change', e => {
    choice.presentation.x = Number(e.target.value);
    renderCurrentScene();
  });
  panel.querySelector('.js-pos-y')?.addEventListener('change', e => {
    choice.presentation.y = Number(e.target.value);
    renderCurrentScene();
  });

  /* w/h */
  panel.querySelector('.js-size-w')?.addEventListener('change', e => {
    choice.presentation.w = Number(e.target.value);
    renderCurrentScene();
  });
  panel.querySelector('.js-size-h')?.addEventListener('change', e => {
    choice.presentation.h = Number(e.target.value);
    renderCurrentScene();
  });

  /* opacity */
  panel.querySelector('.js-opacity')?.addEventListener('input', e => {
    const val = Number(e.target.value);
    choice.presentation.opacity = val;
    const valEl = panel.querySelector('.js-opacity-val');
    if (valEl) valEl.textContent = Math.round(val * 100) + '%';
    renderCurrentScene();
  });

  /* stylePreset */
  panel.querySelectorAll('.js-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      choice.presentation.stylePreset = btn.dataset.val;
      renderEditPanel();
      renderCurrentScene();
    });
  });

  /* 저장 */
  panel.querySelector('.js-edit-save')?.addEventListener('click', async () => {
    const saveBtn = panel.querySelector('.js-edit-save');
    saveBtn.disabled    = true;
    saveBtn.textContent = '저장 중...';
    try {
      await saveViewerMeta();
      saveBtn.textContent = '✅ 저장됨';
      setTimeout(() => { saveBtn.disabled = false; saveBtn.textContent = '💾 저장'; }, 1500);
    } catch (err) {
      saveBtn.textContent = '❌ 저장 실패';
      saveBtn.disabled    = false;
    }
  });
}

/* ================================================================
   initEditInteractions — 렌더 후 overlay choice에 드래그 붙이기
   renderScene/renderCurrentScene 후 editMode일 때 호출
   ================================================================ */
function initEditInteractions() {
  if (!ViewerState.editMode) return;
  const frame = document.getElementById('viewer-frame');
  if (!frame) return;

  frame.querySelectorAll('.choice-overlay-wrap').forEach(wrap => {
    const choiceId = wrap.querySelector('.choice-btn')?.dataset.choiceId;
    if (!choiceId) return;

    /* 선택된 choice 하이라이트 */
    wrap.classList.toggle('edit-selected', choiceId === ViewerState.selectedChoiceId);

    /* 선택 클릭 */
    wrap.addEventListener('pointerdown', e => {
      if (e.target.closest('.choice-btn')) {
        ViewerState.selectedChoiceId = choiceId;
        renderEditPanel();
        frame.querySelectorAll('.choice-overlay-wrap').forEach(w => {
          const cid = w.querySelector('.choice-btn')?.dataset.choiceId;
          w.classList.toggle('edit-selected', cid === choiceId);
        });
      }
    });

    /* 드래그 이동 */
    _attachDrag(wrap, choiceId, frame);
  });
}

function _attachDrag(wrap, choiceId, frame) {
  let dragging  = false;
  let pointerId = null;
  let startX, startY, startPx, startPy;
  let rafPending = false;

  wrap.addEventListener('pointerdown', e => {
    /* choice-btn 클릭은 선택만, wrap 배경 영역만 드래그 */
    if (e.target.closest('.choice-btn')) return;
    e.preventDefault();
    e.stopPropagation();

    dragging   = true;
    pointerId  = e.pointerId;
    wrap.setPointerCapture(e.pointerId);
    wrap.classList.add('edit-dragging');

    startX = e.clientX;
    startY = e.clientY;

    const scene  = ViewerState.scenes[ViewerState.currentSceneId];
    const choice = scene?.choices.find(c => c.id === choiceId);
    startPx = choice?.presentation.x ?? 50;
    startPy = choice?.presentation.y ?? 50;

    /* 선택 상태 업데이트 — renderEditPanel은 드래그 끝난 후에만 호출해서 DOM 교체 방지 */
    ViewerState.selectedChoiceId = choiceId;
    /* 패널의 active 탭만 DOM 직접 갱신 (재렌더 없이) */
    document.querySelectorAll('.js-edit-tab').forEach(tab => {
      tab.classList.toggle('edit-tab--active', tab.dataset.choiceId === choiceId);
    });
    /* edit-selected 클래스 직접 토글 */
    frame.querySelectorAll('.choice-overlay-wrap').forEach(w => {
      const cid = w.querySelector('.choice-btn')?.dataset.choiceId;
      w.classList.toggle('edit-selected', cid === choiceId);
    });
  });

  wrap.addEventListener('pointermove', e => {
    if (!dragging || e.pointerId !== pointerId) return;
    e.preventDefault();

    if (rafPending) return;   // RAF throttle: 불필요한 연산 제거
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;

      const rect = frame.getBoundingClientRect();
      const dx   = ((e.clientX - startX) / rect.width)  * 100;
      const dy   = ((e.clientY - startY) / rect.height) * 100;

      /* Fix 4: safe area 5~95% clamp (가장자리 이탈 방지) */
      const nx = Math.max(5, Math.min(95, startPx + dx));
      const ny = Math.max(5, Math.min(92, startPy + dy));

      const scene  = ViewerState.scenes[ViewerState.currentSceneId];
      const choice = scene?.choices.find(c => c.id === choiceId);
      if (!choice) return;

      choice.presentation.x = Math.round(nx * 10) / 10;
      choice.presentation.y = Math.round(ny * 10) / 10;

      /* DOM 직접 업데이트 — 재렌더 없이 부드럽게 */
      wrap.style.left = `${choice.presentation.x}%`;
      wrap.style.top  = `${choice.presentation.y}%`;

      /* 패널 숫자 실시간 업데이트 (DOM 교체 없음) */
      const pxEl = document.querySelector('.js-pos-x');
      const pyEl = document.querySelector('.js-pos-y');
      if (pxEl) pxEl.value = choice.presentation.x;
      if (pyEl) pyEl.value = choice.presentation.y;
    });
  });

  wrap.addEventListener('pointerup', e => {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    wrap.classList.remove('edit-dragging');
    wrap.releasePointerCapture(e.pointerId);

    /* 드래그 끝난 후에만 패널 재렌더 — DOM 교체 시점 통제 */
    renderEditPanel();
  });

  wrap.addEventListener('pointercancel', () => {
    dragging = false;
    wrap.classList.remove('edit-dragging');
  });
}

/* ── 장면 단위 template override HTML ── */
function _sceneTemplateHtml(scene) {
  const current = scene.layoutTemplate || '(기본)';
  const options = ['(기본)', 'full-image', 'text-page', 'map-layout'];
  return `
    <div class="edit-row">
      <label class="edit-label">이 장면 레이아웃</label>
      <div class="edit-toggle-group" style="flex-wrap:wrap;">
        ${options.map(tpl => `
          <button class="edit-toggle js-scene-tpl ${(scene.layoutTemplate || '(기본)') === tpl ? 'active' : ''}"
            data-val="${tpl}"
            style="margin-bottom:4px;">
            ${{ '(기본)':'기본', 'full-image':'이미지', 'text-page':'텍스트', 'map-layout':'지도' }[tpl] || tpl}
          </button>`).join('')}
      </div>
    </div>`;
}

/* ── 장면 template override 이벤트 바인딩 ── */
function _bindSceneTemplateEvents(panel, scene) {
  panel.querySelectorAll('.js-scene-tpl').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.val;
      scene.layoutTemplate = val === '(기본)' ? null : val;
      renderEditPanel();
      renderCurrentScene();
    });
  });
}

/* ================================================================
   edit panel 상단 액션 영역 — 감상 테스트 + 작업으로 돌아가기
   ================================================================ */
function _editActionsHtml() {
  const fromMaker = ViewerState.fromMaker;
  return `
    <div class="edit-actions-header">
      <button class="edit-action-btn edit-action-btn--test js-edit-preview-test">
        ▶ 감상 테스트
        <small>지금 어떻게 보이는지 확인</small>
      </button>
      ${fromMaker ? `
      <button class="edit-action-btn edit-action-btn--back js-edit-return-maker">
        ← 작업으로 돌아가기
        <small>내용·구조 수정하러</small>
      </button>` : ''}
    </div>`;
}

function _bindEditActions(panel) {
  /* 감상 테스트 — editMode를 'test'로 전환 */
  panel.querySelector('.js-edit-preview-test')?.addEventListener('click', () => {
    ViewerState.editMode = false;
    ViewerState._testingEdit = true;  // 테스트 중 플래그 (복귀 배너 표시용)
    renderCurrentScene();
  });

  /* 작업으로 돌아가기 */
  panel.querySelector('.js-edit-return-maker')?.addEventListener('click', () => {
    if (document.referrer.includes('maker.html')) {
      history.back();
    } else {
      window.location.href = 'maker.html';
    }
  });
}

/* 감상 테스트 중 복귀 배너 — HUD 아래 고정 바
   토스트 대신 viewer-frame 안에 상단 고정으로 표시해 더 선명하게 */
function renderTestingBanner() {
  /* 기존 배너 제거 */
  document.getElementById('edit-test-banner')?.remove();

  if (!ViewerState._testingEdit) return;

  const banner = document.createElement('div');
  banner.id    = 'edit-test-banner';
  banner.style.cssText = [
    'position:absolute', 'top:0', 'left:0', 'right:0', 'z-index:80',
    'background:rgba(30,40,64,0.92)', 'backdrop-filter:blur(6px)',
    'border-bottom:1.5px solid rgba(88,166,255,0.35)',
    'display:flex', 'align-items:center', 'justify-content:space-between',
    'padding:8px 16px', 'gap:12px',
  ].join(';');
  banner.innerHTML = `
    <span style="font-family:var(--font-ui,Jua,sans-serif);font-size:12px;color:rgba(88,166,255,0.9);">
      ▶ 감상 테스트 중 — 실제 관람자 화면이에요
    </span>
    <button id="btn-edit-test-return"
      style="padding:5px 14px;border-radius:50px;border:1.5px solid rgba(88,166,255,0.5);
      background:rgba(88,166,255,0.15);color:#58a6ff;
      font-family:var(--font-ui,Jua,sans-serif);font-size:12px;cursor:pointer;white-space:nowrap;">
      ✏️ 마감 편집으로 돌아가기
    </button>`;

  /* viewer-frame 안에 붙여서 frame 기준으로 위치 */
  const frame = document.getElementById('viewer-frame');
  if (frame) frame.appendChild(banner);

  banner.querySelector('#btn-edit-test-return').addEventListener('click', () => {
    ViewerState.editMode    = true;
    ViewerState._testingEdit = false;
    banner.remove();
    renderCurrentScene();
  });
}
