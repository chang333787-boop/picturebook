/* ================================================================
   viewer-edit.js — 장면 고정형 편집기 (재설계)
   ─────────────────────────────────────────────────────────────────
   원칙:
   · 표현 마감만 — 구조 편집(장면 추가/삭제/연결/본문) 절대 없음
   · 현재 장면 고정 — 저장/스타일 변경 후에도 장면 유지
   · 장면 네비게이터 — 이전/다음/현재 정보 상단 고정
   · 학생용 UI — 드래그 + 선택형 (숫자 입력 기본 숨김)
   ================================================================ */

/* ================================================================
   글 수정 상태 (다듬기 화면 — 글 수정 기능 1차)
   ─────────────────────────────────────────────────────────────
   · 현재 편집 대상 장면 번호 + 잠금 확보 여부 + 저장 대기 큐를 보관
   · renderEditPanel이 호출될 때마다 장면 전환을 감지해 잠금 인수인계
   · input 이벤트는 renderEditPanel 금지 — 대신 viewer-frame만 재렌더
   ================================================================ */
const _editText = {
  num: null,                 // 현재 잠금 확인/확보한 장면 번호
  editable: false,           // 잠금 확보 여부 (true일 때만 저장)
  pendingFields: {},         // debounce 대기 중 변경사항 { title?, body?, buttons?, ... }
  pendingSaveTimer: null,
  rafPending: false,
  lockHandlerInstalled: false,
  saveStatusTimer: null,
};
const EDIT_SAVE_DEBOUNCE_MS = 800;

/* ── viewer-frame만 재렌더 — edit-panel은 보존 (포커스 보호 핵심) ── */
function _scheduleViewerFrameReRender() {
  if (_editText.rafPending) return;
  _editText.rafPending = true;
  requestAnimationFrame(() => {
    _editText.rafPending = false;
    const scene = ViewerState.scenes[ViewerState.currentSceneId];
    if (scene && typeof renderScene === 'function') renderScene(scene);
  });
}

/* ── 저장 큐 추가 + debounce 예약 ── */
function _queueSave(num, fields) {
  if (_editText.num !== num) return;
  Object.assign(_editText.pendingFields, fields);
  if (_editText.pendingSaveTimer) clearTimeout(_editText.pendingSaveTimer);
  _editText.pendingSaveTimer = setTimeout(() => _flushPendingSave(), EDIT_SAVE_DEBOUNCE_MS);
  /* 활동 — 잠금 heartbeat 연장 */
  if (typeof viewerTouchEdit === 'function' && _editText.editable) {
    viewerTouchEdit(num);
  }
}

/* ── 저장 즉시 flush ── */
async function _flushPendingSave() {
  if (_editText.pendingSaveTimer) {
    clearTimeout(_editText.pendingSaveTimer);
    _editText.pendingSaveTimer = null;
  }
  const fields = _editText.pendingFields;
  const num    = _editText.num;
  if (!fields || !Object.keys(fields).length) return;
  if (num == null) return;
  /* 잠금 없는 상태에서 저장 금지 — 안전장치 */
  if (!_editText.editable) return;

  /* buttons validation (v0.3) — patch에 buttons가 있을 때만 검증.
     · 60자 초과: 차단 + 경고. (사실 maxlength=60으로 input에서 1차 차단됨.)
     · 0개: 차단 + 안내. (UI에서 삭제 1개미만 비활성으로 1차 보호되지만 방어적으로 한 번 더.)
     · 빈 라벨: 허용 — 편집 중 상태로 보호. 사용자가 추가 후 글자 치는 중일 수 있음.
       (모드별 감상 화면 처리는 다음 단계에서 — 빈 버튼은 렌더 시 회색 placeholder.) */
  if (Object.prototype.hasOwnProperty.call(fields, 'buttons')) {
    const buttons = fields.buttons;
    if (typeof validateButtonsForSave === 'function') {
      /* 검증은 choices 형태로 받으므로 임시 변환 */
      const asChoices = Array.isArray(buttons) ? buttons : [];
      /* 0개 차단 — empty buttons로 저장 시도하면 막음 */
      if (asChoices.length < 1) {
        _showSaveStatus('⚠ 행동 버튼이 최소 1개 필요해요', 2500);
        delete fields.buttons;  // buttons 필드만 빼고 나머지는 저장
        if (!Object.keys(fields).length) return;
      } else {
        /* 60자 초과 절대 한계 검사 */
        const overLimit = asChoices.find(b => (b.label || '').length > 60);
        if (overLimit) {
          _showSaveStatus(`⚠ 버튼 글자 수 60자 초과`, 2500);
          delete fields.buttons;
          if (!Object.keys(fields).length) return;
        }
      }
    }
  }

  _editText.pendingFields = {};
  _showSaveStatus('저장 중…');
  try {
    await saveSceneText(num, fields);
    _showSaveStatus('✅ 저장됨', 1200);
  } catch (err) {
    _showSaveStatus('❌ 저장 실패', 2000);
    /* 실패한 변경은 재시도 가능하도록 다시 큐에 병합 */
    Object.assign(_editText.pendingFields, fields);
  }
}

function _showSaveStatus(text, autoClearMs = 0) {
  const el = document.querySelector('.js-edit-text-status');
  if (!el) return;
  el.textContent = text;
  if (_editText.saveStatusTimer) clearTimeout(_editText.saveStatusTimer);
  if (autoClearMs > 0) {
    _editText.saveStatusTimer = setTimeout(() => {
      const cur = document.querySelector('.js-edit-text-status');
      if (cur) cur.textContent = '';
    }, autoClearMs);
  }
}

/* ── 잠금 상태 UI 반영 — DOM 일부만 갱신 (전체 재렌더 안 함) ── */
function _applyEditLockUI() {
  const panel = document.getElementById('edit-panel');
  if (!panel) return;
  const banner = panel.querySelector('.js-edit-lock-banner');
  const inputs = panel.querySelectorAll('.js-edit-text-input');
  /* 분류 기반 배너 문구/동작 일치 (1-1 정책 마감) ──
     · 'other'       → 진짜 다른 사용자 — 강한 경고, 인수 불가
     · 'same-device' → 같은 브라우저 다른 탭 — 명시적 '여기서 편집' 버튼 제공
     · null/self-tab → 배너 없음 */
  if (banner) {
    if (_editText.editable) {
      banner.style.display = 'none';
      banner.innerHTML = '';
    } else {
      const num  = _editText.num;
      const kind = (typeof classifyLockOwner === 'function' && num != null)
        ? classifyLockOwner(num) : 'other';
      if (kind === 'same-device') {
        banner.classList.add('edit-lock-banner--mild');
        banner.innerHTML = `
          <div class="edit-lock-banner-msg">🪟 이 장면이 다른 창에서 편집 중이에요. 지금은 읽기만 할 수 있어요.</div>
          <button class="edit-lock-takeover-btn js-edit-lock-takeover" type="button">이 창에서 편집하기</button>`;
        banner.querySelector('.js-edit-lock-takeover')
          ?.addEventListener('click', async () => {
            if (_editText.num == null) return;
            const ok = (typeof viewerTakeoverLock === 'function')
              ? await viewerTakeoverLock(_editText.num) : false;
            if (ok) {
              _editText.editable = true;
              _applyEditLockUI();
            }
            /* 실패 시(원격이 그 사이 진짜 다른 사람이 됐거나) — 그대로 두고
               다음 snapshot 콜백에서 상태 재평가 */
          });
      } else {
        /* 'other' — 진짜 다른 사용자: 인수 버튼 없음, 읽기 전용 */
        banner.classList.remove('edit-lock-banner--mild');
        banner.innerHTML = `<div class="edit-lock-banner-msg">🔒 다른 사람이 이 장면을 편집 중이에요. 지금은 읽기만 할 수 있어요.</div>`;
      }
      banner.style.display = '';
    }
  }
  inputs.forEach(el => {
    const wasFocused = (document.activeElement === el);
    el.readOnly = !_editText.editable;
    el.classList.toggle('edit-text-input--locked', !_editText.editable);
    if (wasFocused && document.activeElement !== el) el.focus();
  });
  /* 모드 카드도 잠금 상태 반영 (모드 시스템 뼈대 1차) */
  panel.querySelectorAll('.js-mode-card').forEach(btn => {
    btn.disabled = !_editText.editable;
    btn.classList.toggle('edit-mode-card--locked', !_editText.editable);
  });
  /* 서브모드 카드도 잠금 반영 (그림책형 1차) */
  panel.querySelectorAll('.js-submode-card').forEach(btn => {
    btn.disabled = !_editText.editable;
    btn.classList.toggle('edit-submode-card--locked', !_editText.editable);
  });
  /* 무비형 토글도 잠금 반영 (무비형 설계 1차) */
  panel.querySelectorAll('.js-movie-caption, .js-movie-reveal').forEach(btn => {
    btn.disabled = !_editText.editable;
  });
  /* 버튼 N개 편집 — 추가/삭제 버튼도 잠금 반영 (v0.3) */
  panel.querySelectorAll('.js-edit-btn-add, .js-edit-btn-remove').forEach(btn => {
    btn.disabled = !_editText.editable;
  });
}

/* ── 현재 장면에 대한 잠금 확보 시도 (장면 전환 시 인수인계 포함) ──
   낙관적 시작 (실사용 버그 수정): 배너/readOnly를 미리 띄우지 않고
   editable=true로 시작한다. transaction 결과가 실패할 때만 배너 표시.
   이유: Firebase snapshot이 아직 안 도착한 첫 진입 순간에도 배너가
   깜박이지 않도록. 낙관 후 saveSceneText는 _flushPendingSave에서 editable
   재확인하므로 데이터 안전성은 유지됨. */
async function _ensureEditLockForCurrentScene() {
  const num = ViewerState.currentSceneId;
  /* 장면이 바뀌었으면 이전 장면 처리: flush + release */
  if (_editText.num !== null && _editText.num !== num) {
    await _flushPendingSave();
    if (typeof viewerIsMyLock === 'function' && viewerIsMyLock(_editText.num)) {
      viewerReleaseLock(_editText.num);
    }
  }
  _editText.num      = num;
  /* 낙관적 시작 — 배너 없이 바로 편집 가능 상태로 렌더 */
  _editText.editable = true;
  _applyEditLockUI();

  if (typeof viewerEnsureEditable !== 'function') {
    /* 잠금 모듈 미로드 — 단독 실행으로 간주 (낙관 상태 유지) */
    return;
  }
  const ok = await viewerEnsureEditable(num);
  /* 대기 중 사용자가 다른 장면으로 이동했다면 결과 무시 */
  if (_editText.num !== num) return;
  if (!ok) {
    _editText.editable = false;
    _applyEditLockUI();
  }
  /* ok인 경우 이미 editable=true라 추가 작업 불필요 */
}

/* ── 원격 잠금 변경 시 상태 동기화 (한 번만 등록) ── */
function _installLockChangeHandlerOnce() {
  if (_editText.lockHandlerInstalled) return;
  if (typeof setViewerLockChangeHandler !== 'function') return;
  _editText.lockHandlerInstalled = true;
  setViewerLockChangeHandler(() => {
    const num = _editText.num;
    if (num == null) return;
    if (typeof isViewerLockedByOther !== 'function') return;
    const blocked = isViewerLockedByOther(num);
    const wasEditable = _editText.editable;
    if (wasEditable && blocked) {
      /* TTL 만료로 누가 낚아챘거나 자기 릴리스 — 편집 불가로 전환.
         저장 대기 중인 변경은 유지(다시 잠금 확보되면 자동 flush 가능). */
      _editText.editable = false;
      _applyEditLockUI();
    } else if (!wasEditable && !blocked &&
               typeof viewerIsMyLock === 'function' && viewerIsMyLock(num)) {
      _editText.editable = true;
      _applyEditLockUI();
    } else if (!wasEditable && !blocked) {
      /* 상대가 잠금 해제해서 내가 편집 가능해진 상태 — 배너 문구만 최신화 */
      _applyEditLockUI();
    }
  });
}

/* ================================================================
   pagehide / visibilitychange flush (글 수정 저장 안정화) ──
   ─────────────────────────────────────────────────────────────
   · pagehide: 모바일 Safari 포함 모든 브라우저에서 발생. beforeunload는
     모바일에서 불안정하므로 pagehide 우선 사용.
   · visibilitychange(hidden): 앱 전환/탭 백그라운드 전환 시. iOS에서
     pagehide가 안 뜰 수 있는 시나리오도 커버.
   · 모두 sync처럼 동작하진 않지만(async flush), 800ms debounce 중이던
     pending 입력을 '가능한 한' 저장 시도함. beacon 수준 보장은 아님.
   · 모듈 로드 시 한 번만 등록 — viewer-entry.js init와 무관하게 안전.
   ================================================================ */
(function _installFlushHooks() {
  if (typeof window === 'undefined') return;
  /* pagehide — beforeunload보다 더 넓게 트리거 (모바일 포함) */
  window.addEventListener('pagehide', () => {
    /* _flushPendingSave는 async지만 즉시 시도. 브라우저가 잠깐 기다려줌. */
    if (_editText.pendingFields && Object.keys(_editText.pendingFields).length) {
      _flushPendingSave();
    }
  });
  /* visibilitychange(hidden) — 탭 백그라운드/앱 전환 대응 */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' &&
        _editText.pendingFields && Object.keys(_editText.pendingFields).length) {
      _flushPendingSave();
    }
  });
})();

/* ── 크기 프리셋 정의 ── */
const SIZE_PRESETS = {
  small:  { fontSize: '13px', padding: '6px 14px',  minW: 100 },
  medium: { fontSize: '16px', padding: '10px 20px', minW: 140 },
  large:  { fontSize: '20px', padding: '14px 28px', minW: 190 },
};

/* ── 현재 크기 프리셋 추정 (fontSize 기준) ── */
function _getSizePreset(p) {
  const fs = p.fontSize;
  if (fs === '13px') return 'small';
  if (fs === '20px') return 'large';
  return 'medium';   // 기본값
}

/* ── 크기 프리셋 → presentation에 fontSize/padding/minW 저장 ── */
function _applySizePreset(presentation, presetKey) {
  const preset = SIZE_PRESETS[presetKey] ?? SIZE_PRESETS.medium;
  presentation.fontSize = preset.fontSize;
  presentation.padding  = preset.padding;
  presentation.minW     = preset.minW;
  presentation.h        = null;  // 높이 auto
}

/* ── 장면 순서 목록 (num 기준) ── */
function _editSceneList() {
  return Object.values(ViewerState.scenes)
    .sort((a, b) => Number(a.id) - Number(b.id));
}

/* ── 현재 장면 index ── */
function _currentSceneIndex() {
  const list = _editSceneList();
  return list.findIndex(s => s.id === ViewerState.currentSceneId);
}

/* ── 장면 유형 레이블 (UI 언어 정리 1차) ──
   '시작'은 더 이상 장면 '종류'가 아님. 기존 isStart 데이터는 '일반'으로 표시.
   역할(첫 감상 시작 / 다시 시작점)은 _sceneRoles가 별도 계산. */
function _sceneTypeLabel(scene) {
  if (scene.isEnding) return '엔딩';
  return '일반';
}

/* ── 장면 역할 계산 — entry/replay 비교 ──
   반환: { isEntry: boolean, isReplay: boolean } */
function _sceneRoles(scene) {
  const p = ViewerState.project || {};
  const id = String(scene.id);
  return {
    isEntry:  p.entrySceneId  !== null && p.entrySceneId  !== undefined
           && String(p.entrySceneId)  === id,
    isReplay: p.replaySceneId !== null && p.replaySceneId !== undefined
           && String(p.replaySceneId) === id,
  };
}

/* ================================================================
   상단 장면 네비게이터 HTML
   [ ← 이전 ]  [ 장면 2 · 제목 · 유형 ]  [ 다음 → ]
   ================================================================ */
function _editNavHtml(scene) {
  const list  = _editSceneList();
  const idx   = _currentSceneIndex();
  const total = list.length;
  const num   = scene.id;
  const title = scene.title || '(제목 없음)';
  const type  = _sceneTypeLabel(scene);
  const roles = _sceneRoles(scene);

  const hasPrev = idx > 0;
  const hasNext = idx < total - 1;

  /* 유형별 배지 클래스 — '시작' 종류는 없음 (일반 / 엔딩 2종) */
  const typeClass = scene.isEnding ? 'edit-nav-badge--ending'
                                    : 'edit-nav-badge--normal';

  /* 역할 배지 HTML — 첫 감상 시작(녹색) / 다시 시작점(파랑) */
  const roleBadgesHtml = [
    roles.isEntry  ? '<span class="edit-nav-role edit-nav-role--entry" title="첫 감상자가 시작하는 장면">첫 감상 시작</span>' : '',
    roles.isReplay ? '<span class="edit-nav-role edit-nav-role--replay" title="다른 결말 찾기에서 시작하는 장면">다시 시작점</span>' : '',
  ].join('');

  /* 장면 목록 option — 번호순 정렬, 현재 장면 selected, 역할 표시 포함 */
  const optionsHtml = list.map(s => {
    const t     = _sceneTypeLabel(s);
    const r     = _sceneRoles(s);
    const roleTxt = [
      r.isEntry  ? '[첫 감상]'   : '',
      r.isReplay ? '[다시 시작점]' : '',
    ].filter(Boolean).join(' ');
    const titleTxt = s.title ? s.title.slice(0, 20) : '(제목 없음)';
    const label = roleTxt
      ? `${s.id} · ${titleTxt} · ${t} ${roleTxt}`
      : `${s.id} · ${titleTxt} · ${t}`;
    const sel   = s.id === scene.id ? 'selected' : '';
    return `<option value="${escHtml(s.id)}" ${sel}>${escHtml(label)}</option>`;
  }).join('');

  return `
    <div class="edit-nav">
      <div class="edit-nav-row edit-nav-row--main">
        <button class="edit-nav-btn js-edit-nav-prev" ${hasPrev ? '' : 'disabled'} title="이전 장면">←</button>
        <div class="edit-nav-info">
          <div class="edit-nav-info-top">
            <span class="edit-nav-num">장면 ${num}</span>
            <span class="edit-nav-badge ${typeClass}">${type}</span>
            ${roleBadgesHtml}
            <span class="edit-nav-counter">${idx + 1} / ${total}</span>
          </div>
          <div class="edit-nav-info-title" title="${escHtml(title)}">${escHtml(title)}</div>
        </div>
        <button class="edit-nav-btn js-edit-nav-next" ${hasNext ? '' : 'disabled'} title="다음 장면">→</button>
      </div>
      <div class="edit-nav-row edit-nav-row--jump">
        <select class="edit-nav-jump js-edit-nav-jump" id="edit-nav-jump" title="장면 목록에서 선택">
          ${optionsHtml}
        </select>
      </div>
    </div>`;
}

function _bindNavEvents(panel) {
  const list = _editSceneList();
  const idx  = _currentSceneIndex();

  panel.querySelector('.js-edit-nav-prev')?.addEventListener('click', () => {
    if (idx > 0) editNavigateTo(list[idx - 1].id);
  });
  panel.querySelector('.js-edit-nav-next')?.addEventListener('click', () => {
    if (idx < list.length - 1) editNavigateTo(list[idx + 1].id);
  });

  /* 장면 목록 점프 — change 이벤트로 즉시 이동 */
  panel.querySelector('.js-edit-nav-jump')?.addEventListener('change', e => {
    const targetId = e.target.value;
    if (targetId && targetId !== ViewerState.currentSceneId) {
      editNavigateTo(targetId);
    }
  });
}

/* ================================================================
   edit panel 렌더 (메인)
   ================================================================ */
function renderEditPanel() {
  const panel = document.getElementById('edit-panel');
  if (!panel) return;

  const scene = ViewerState.scenes[ViewerState.currentSceneId];
  if (!scene) return;

  /* ── 선택지 없는 장면(엔딩 등) ── */
  if (scene.choices.length === 0) {
    panel.innerHTML = `
      <div class="edit-panel-inner">
        ${_editActionsHtml()}
        ${_editNavHtml(scene)}

        <!-- 【1】 기본 정보 -->
        <div class="edit-divider"></div>
        ${_textEditHtml(scene)}

        <!-- 【2】 장면 설정 -->
        <div class="edit-divider"></div>
        <h4 class="edit-section-title edit-section-title--major">② 장면 설정</h4>
        ${_sceneTemplateHtml(scene)}

        <!-- 엔딩은 선택지 없음 — 【3】 선택지 표현 섹션 자체 생략 -->
        <div class="edit-divider"></div>
        <p class="edit-empty">이 장면에는 선택지가 없어요. (엔딩 장면)</p>

        <button class="edit-save-btn js-edit-save">💾 저장</button>
      </div>`;
    _bindEditActions(panel);
    _bindNavEvents(panel);
    _bindSceneTemplateEvents(panel, scene);
    _bindTextEditEvents(panel, scene);
    panel.querySelector('.js-edit-save')?.addEventListener('click', () => _doSave(panel));
    _installLockChangeHandlerOnce();
    _ensureEditLockForCurrentScene();
    return;
  }

  /* ── 선택지 있는 장면 ── */
  const selectedId = ViewerState.selectedChoiceId;
  const choice     = selectedId
    ? (scene.choices.find(c => c.id === selectedId) ?? scene.choices[0])
    : scene.choices[0];

  if (!choice) return;
  ViewerState.selectedChoiceId = choice.id;

  const p         = choice.presentation;
  const sizeKey   = _getSizePreset(p);
  const isOverlay = p.placement === 'overlay';

  /* ─────────────────────────────────────────────────────────────
     ③ 선택지 표현 섹션 노출 정책 (v0.3 — 옵션 C)
     ─────────────────────────────────────────────────────────────
     v0.3 명시 모드(text/picturebook/movie)에서는 placement / size /
     stylePreset / opacity 같은 legacy 컨트롤이 새 _renderScene*
     렌더 분기에서 무시된다. 사용자가 조작해도 화면에 반영되지 않으므로
     "가짜 컨트롤"이 됨 → 통째로 숨김.
     document(보류 모드) 또는 모드 미지정(기존 작품 = legacy) 에서만 노출.
     섹션 제목/안내에 "기존 모드 전용" 명시. */
  const isV03Mode = scene.presentationMode === 'text' ||
                    scene.presentationMode === 'picturebook' ||
                    scene.presentationMode === 'movie';
  const showLegacyChoiceSection = !isV03Mode;

  /* legacy 섹션 HTML — 보여줄 때만 사용 */
  const legacyChoiceSectionHtml = showLegacyChoiceSection ? `
      <!-- 【3】 선택지 표현 — 탭 + 위치/크기/스타일/투명도 (기존 모드 전용)
           v0.3 명시 모드에서는 _renderScene*가 placement/size/style/opacity를
           무시하므로 이 섹션 자체를 숨긴다. document(보류) 또는 모드 미지정인
           기존 작품에서만 노출. -->
      <div class="edit-divider"></div>
      <h4 class="edit-section-title edit-section-title--major">
        ③ 선택지 표현
        <span class="edit-section-tag">기존 모드 전용</span>
      </h4>
      <div class="edit-section-hint">
        이 섹션은 기존 모드(기록물형 또는 모드 미지정 작품)에만 적용돼요.
        텍스트형 / 그림책형 / 무비형에서는 위치·크기·스타일이 모드 구조에 따라
        자동으로 결정됩니다.
      </div>
      <div class="edit-tabs">
        ${scene.choices.map(c => `
          <button class="edit-tab js-edit-tab ${c.id === choice.id ? 'edit-tab--active' : ''}"
            data-choice-id="${c.id}">
            ${escHtml(c.label || c.id)}
          </button>`).join('')}
      </div>

      <!-- 위치 방식 -->
      <div class="edit-row">
        <label class="edit-label">위치 방식</label>
        <div class="edit-toggle-group">
          <button class="edit-toggle js-placement ${!isOverlay ? 'active' : ''}" data-val="bottom">
            하단 고정
          </button>
          <button class="edit-toggle js-placement ${isOverlay ? 'active' : ''}" data-val="overlay">
            자유 배치
          </button>
        </div>
      </div>

      ${isOverlay ? `
      <!-- 자유 배치: 드래그 안내 -->
      <div class="edit-drag-hint">
        💡 선택지를 직접 드래그해서 위치를 바꿀 수 있어요
      </div>` : ''}

      <!-- 크기 단계 -->
      <div class="edit-row">
        <label class="edit-label">글자 크기</label>
        <div class="edit-toggle-group">
          <button class="edit-toggle js-size-preset ${sizeKey === 'small'  ? 'active' : ''}" data-val="small">작게</button>
          <button class="edit-toggle js-size-preset ${sizeKey === 'medium' ? 'active' : ''}" data-val="medium">보통</button>
          <button class="edit-toggle js-size-preset ${sizeKey === 'large'  ? 'active' : ''}" data-val="large">크게</button>
        </div>
      </div>

      <!-- 스타일 -->
      <div class="edit-row">
        <label class="edit-label">스타일</label>
        <div class="edit-toggle-group">
          ${['basic','ghost','pin'].map(preset => `
            <button class="edit-toggle js-preset ${(p.stylePreset ?? 'basic') === preset ? 'active' : ''}" data-val="${preset}">
              ${{ basic:'기본', ghost:'고스트', pin:'핀' }[preset]}
            </button>`).join('')}
        </div>
      </div>

      <!-- 투명도 -->
      <div class="edit-row">
        <label class="edit-label">투명도</label>
        <div class="edit-opacity-row">
          <button class="edit-opacity-btn js-opacity-down">－</button>
          <span class="edit-opacity-val js-opacity-val">${Math.round((p.opacity ?? 1) * 100)}%</span>
          <button class="edit-opacity-btn js-opacity-up">＋</button>
        </div>
      </div>` : '';

  panel.innerHTML = `
    <div class="edit-panel-inner">
      <!-- 상단 고정 바 (액션 + 네비) -->
      ${_editActionsHtml()}
      ${_editNavHtml(scene)}

      <!-- 【1】 기본 정보 — 제목 / 본문 / 선택지 문구 -->
      <div class="edit-divider"></div>
      ${_textEditHtml(scene)}

      <!-- 【2】 장면 설정 — 레이아웃 + 텍스트 위치
           (로드맵: 나중에 '모드 전용 편집층'으로 이동할 예정) -->
      <div class="edit-divider"></div>
      <h4 class="edit-section-title edit-section-title--major">② 장면 설정</h4>
      ${_sceneTemplateHtml(scene)}

      ${legacyChoiceSectionHtml}

      <!-- 저장 -->
      <button class="edit-save-btn js-edit-save">💾 저장</button>
    </div>`;

  _bindEditActions(panel);
  _bindNavEvents(panel);
  _bindSceneTemplateEvents(panel, scene);
  _bindEditPanelEvents(panel, scene, choice);
  _bindTextEditEvents(panel, scene);
  _installLockChangeHandlerOnce();
  _ensureEditLockForCurrentScene();
}

/* ================================================================
   이벤트 바인딩
   ================================================================ */
function _bindEditPanelEvents(panel, scene, choice) {
  const p = choice.presentation;

  /* 선택지 탭 전환 */
  panel.querySelectorAll('.js-edit-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      ViewerState.selectedChoiceId = tab.dataset.choiceId;
      renderEditPanel();
      renderCurrentScene();
    });
  });

  /* 위치 방식 전환 */
  panel.querySelectorAll('.js-placement').forEach(btn => {
    btn.addEventListener('click', () => {
      p.placement = btn.dataset.val;
      if (p.placement === 'overlay' && p.x == null) {
        p.x = 50; p.y = 50;
      }
      renderEditPanel();
      renderCurrentScene();
    });
  });

  /* 크기 단계 */
  panel.querySelectorAll('.js-size-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      _applySizePreset(p, btn.dataset.val);
      renderEditPanel();
      renderCurrentScene();
    });
  });

  /* 스타일 */
  panel.querySelectorAll('.js-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      p.stylePreset = btn.dataset.val;
      renderEditPanel();
      renderCurrentScene();
    });
  });

  /* 투명도 단계 버튼 */
  const OPACITY_STEP = 0.1;
  panel.querySelector('.js-opacity-down')?.addEventListener('click', () => {
    p.opacity = Math.max(0.1, Math.round(((p.opacity ?? 1) - OPACITY_STEP) * 10) / 10);
    panel.querySelector('.js-opacity-val').textContent = Math.round(p.opacity * 100) + '%';
    renderCurrentScene();
  });
  panel.querySelector('.js-opacity-up')?.addEventListener('click', () => {
    p.opacity = Math.min(1, Math.round(((p.opacity ?? 1) + OPACITY_STEP) * 10) / 10);
    panel.querySelector('.js-opacity-val').textContent = Math.round(p.opacity * 100) + '%';
    renderCurrentScene();
  });

  /* 저장 */
  panel.querySelector('.js-edit-save')?.addEventListener('click', () => _doSave(panel));
}

/* ── 저장 공통 ── */
async function _doSave(panel) {
  const btn = panel.querySelector('.js-edit-save');
  if (!btn) return;
  btn.disabled    = true;
  btn.textContent = '저장 중...';
  try {
    /* 글 수정 대기분도 함께 flush — 사용자가 입력 직후 저장 누를 때 데이터 유실 방지 */
    await _flushPendingSave();
    await saveViewerMeta();
    btn.textContent = '✅ 저장됨';
    setTimeout(() => { btn.disabled = false; btn.textContent = '💾 저장'; }, 1500);
  } catch {
    btn.textContent = '❌ 저장 실패';
    btn.disabled    = false;
  }
}

/* ================================================================
   initEditInteractions — 렌더 후 overlay choice에 드래그 붙이기
   ================================================================ */
function initEditInteractions() {
  if (!ViewerState.editMode) return;
  const frame = document.getElementById('viewer-frame');
  if (!frame) return;

  frame.querySelectorAll('.choice-overlay-wrap').forEach(wrap => {
    const choiceId = wrap.querySelector('.choice-btn')?.dataset.choiceId;
    if (!choiceId) return;

    wrap.classList.toggle('edit-selected', choiceId === ViewerState.selectedChoiceId);

    wrap.addEventListener('pointerdown', e => {
      if (e.target.closest('.choice-btn')) {
        ViewerState.selectedChoiceId = choiceId;
        renderEditPanel();
        frame.querySelectorAll('.choice-overlay-wrap').forEach(w => {
          w.classList.toggle('edit-selected', w.querySelector('.choice-btn')?.dataset.choiceId === choiceId);
        });
      }
    });

    _attachDrag(wrap, choiceId, frame);
  });
}

function _attachDrag(wrap, choiceId, frame) {
  let dragging = false, pointerId = null;
  let startX, startY, startPx, startPy;
  let rafPending = false;

  wrap.addEventListener('pointerdown', e => {
    if (e.target.closest('.choice-btn')) return;
    e.preventDefault();
    e.stopPropagation();

    dragging  = true;
    pointerId = e.pointerId;
    wrap.setPointerCapture(e.pointerId);
    wrap.classList.add('edit-dragging');
    /* ★ frame에도 dragging 상태 부여 — safe-area 강조 표시용 */
    frame.classList.add('is-choice-dragging');

    startX = e.clientX;
    startY = e.clientY;

    const scene  = ViewerState.scenes[ViewerState.currentSceneId];
    const choice = scene?.choices.find(c => c.id === choiceId);
    startPx = choice?.presentation.x ?? 50;
    startPy = choice?.presentation.y ?? 50;

    ViewerState.selectedChoiceId = choiceId;
    document.querySelectorAll('.js-edit-tab').forEach(tab => {
      tab.classList.toggle('edit-tab--active', tab.dataset.choiceId === choiceId);
    });
    frame.querySelectorAll('.choice-overlay-wrap').forEach(w => {
      w.classList.toggle('edit-selected', w.querySelector('.choice-btn')?.dataset.choiceId === choiceId);
    });
  });

  wrap.addEventListener('pointermove', e => {
    if (!dragging || e.pointerId !== pointerId) return;
    e.preventDefault();
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      const rect = frame.getBoundingClientRect();
      const dx   = ((e.clientX - startX) / rect.width)  * 100;
      const dy   = ((e.clientY - startY) / rect.height) * 100;
      const rawX = startPx + dx;
      const rawY = startPy + dy;
      const nx   = Math.max(5, Math.min(95, rawX));
      const ny   = Math.max(5, Math.min(92, rawY));

      /* ★ clamp 상태 감지 — safe area 경계 시각 피드백 */
      const atEdge = (rawX !== nx) || (rawY !== ny);
      wrap.classList.toggle('edit-dragging--at-edge', atEdge);

      const scene  = ViewerState.scenes[ViewerState.currentSceneId];
      const choice = scene?.choices.find(c => c.id === choiceId);
      if (!choice) return;

      choice.presentation.x = Math.round(nx * 10) / 10;
      choice.presentation.y = Math.round(ny * 10) / 10;

      wrap.style.left = `${choice.presentation.x}%`;
      wrap.style.top  = `${choice.presentation.y}%`;
    });
  });

  const endDrag = () => {
    dragging = false;
    wrap.classList.remove('edit-dragging');
    wrap.classList.remove('edit-dragging--at-edge');
    frame.classList.remove('is-choice-dragging');
  };

  wrap.addEventListener('pointerup', e => {
    if (!dragging || e.pointerId !== pointerId) return;
    endDrag();
    wrap.releasePointerCapture(e.pointerId);
    renderEditPanel();
  });

  wrap.addEventListener('pointercancel', endDrag);
}

/* ================================================================
   글 수정 섹션 (다듬기 화면 — 글 수정 기능 1차) ──
   ─────────────────────────────────────────────────────────────
   · 장면 제목 겸 글(textarea) — 현재 데이터 모델이 title 단일 필드
   · 선택지 문구 A/B (input) — scene.choices[i].label과 양방향 동기화
   · 잠금 안내 배너 — 다른 사람이 같은 장면 편집 중일 때 표시
   · 저장 상태 표시 — debounced 저장 중/완료/실패 피드백
   · readOnly 상태는 js에서 _applyEditLockUI()로 동기 토글
   ================================================================ */
function _textEditHtml(scene) {
  /* title/body 분리 — viewer-data에서 이미 하위호환 해석 완료 상태
     (기존 작품은 title='' / body=원래title로 매핑됨). */
  const titleVal = scene.title || '';
  const bodyVal  = scene.body  || '';

  /* UX 마감 (1-2): 제목 없는 장면·본문 없는 장면의 안내 힌트 */
  const titleHint = titleVal ? '' :
    `<div class="edit-field-hint">제목은 비워도 돼요 — 제목 없이 본문만 있는 장면도 가능해요.</div>`;
  const bodyHint  = bodyVal ? '' :
    `<div class="edit-field-hint">장면에서 읽을 내용이에요. 대사·설명·상황 묘사 모두 여기에.</div>`;

  /* ── 버튼 N개 (v0.3): scene.choices 배열을 그대로 ── */
  const isEnding = scene.type === 'ending';
  const choices  = Array.isArray(scene.choices) ? scene.choices : [];

  /* 엔딩 장면은 버튼 편집 UI 없음 (구조상 선택지 0개) */
  const buttonsBlock = isEnding ? '' : _buttonsEditHtml(choices);

  return `
    <h4 class="edit-section-title edit-section-title--major">① 기본 정보</h4>
    <div class="js-edit-lock-banner edit-lock-banner" style="display:none;"></div>

    <div class="edit-row">
      <label class="edit-label" for="edit-scene-title">제목 <span class="edit-label-note">(짧은 헤드라인)</span></label>
      <input id="edit-scene-title" type="text"
        class="edit-text-input edit-text-input--choice js-edit-text-input js-edit-title"
        value="${escHtml(titleVal)}"
        placeholder="짧은 제목 (선택)">
      ${titleHint}
    </div>

    <div class="edit-row">
      <label class="edit-label" for="edit-scene-body">본문 <span class="edit-label-note">(장면에서 읽을 글)</span></label>
      <textarea id="edit-scene-body"
        class="edit-text-input edit-text-input--body js-edit-text-input js-edit-body"
        rows="5"
        placeholder="장면에 보여줄 내용을 적어주세요.">${escHtml(bodyVal)}</textarea>
      ${bodyHint}
    </div>

    ${buttonsBlock}

    <div class="edit-text-status-row">
      <span class="js-edit-text-status edit-text-status" aria-live="polite"></span>
    </div>`;
}

/* ================================================================
   버튼 N개 편집 UI (v0.3)
   ─────────────────────────────────────────────────────────────
   · 입력란 N개 (data-idx로 식별)
   · 각 행에 [삭제] (단, 1개일 땐 버튼 보이지 않음 — 0개 방지)
   · 하단 [+ 버튼 추가]
   · 글자 수 카운터 (30자 권장 / 60자 한계)
   · 분기 연결(nextId)은 표시만, 이번 턴엔 변경 안 함 (구조 유지)
   ================================================================ */
function _buttonsEditHtml(choices) {
  const rows = choices.map((c, i) => _buttonRowHtml(c, i, choices.length)).join('');

  /* 0개 상태 안내 + 추가 버튼 */
  const emptyHint = choices.length === 0
    ? `<div class="edit-field-hint edit-field-hint--warn">
         행동 버튼이 없어요. 최소 1개의 버튼이 필요합니다.
       </div>`
    : '';

  return `
    <div class="edit-row edit-buttons-row">
      <label class="edit-label">
        행동 버튼
        <span class="edit-label-note">(${choices.length}개)</span>
      </label>
      ${emptyHint}
      <div class="edit-buttons-list js-edit-buttons-list">
        ${rows}
      </div>
      <div class="edit-buttons-actions">
        <button type="button" class="edit-btn-add js-edit-btn-add">
          + 버튼 추가
        </button>
      </div>
    </div>`;
}

function _buttonRowHtml(choice, idx, total) {
  const label = (choice && typeof choice.label === 'string') ? choice.label : '';
  const len   = label.length;

  /* 글자 수 표시: 정상/권장초과/최대초과 */
  let counterClass = 'edit-btn-counter';
  if (len > 60) counterClass += ' edit-btn-counter--over';
  else if (len > 30) counterClass += ' edit-btn-counter--warn';

  /* nextId 표시 — 이번 턴 read-only */
  const nextLabel = choice && choice.nextId
    ? `→ 장면 ${escHtml(String(choice.nextId))}`
    : `<span class="edit-btn-nolink">미연결</span>`;

  /* 1개일 때는 삭제 버튼 숨김 (0개 방지) */
  const removeBtn = total > 1
    ? `<button type="button"
         class="edit-btn-remove js-edit-btn-remove"
         data-idx="${idx}"
         title="이 버튼 삭제">×</button>`
    : '';

  return `
    <div class="edit-button-row" data-idx="${idx}">
      <div class="edit-button-row-main">
        <input type="text"
          class="edit-text-input edit-text-input--choice js-edit-button-label"
          data-idx="${idx}"
          value="${escHtml(label)}"
          placeholder="버튼 문구를 입력하세요"
          maxlength="60">
        ${removeBtn}
      </div>
      <div class="edit-button-row-meta">
        <span class="${counterClass}">
          <span class="js-edit-btn-len">${len}</span> / 30
        </span>
        <span class="edit-btn-target">${nextLabel}</span>
      </div>
    </div>`;
}

function _bindTextEditEvents(panel, scene) {
  const titleEl = panel.querySelector('.js-edit-title');
  const bodyEl  = panel.querySelector('.js-edit-body');

  /* ── 제목 ── */
  if (titleEl) {
    titleEl.addEventListener('input', e => {
      if (!_editText.editable) return;
      scene.title = e.target.value;
      _scheduleViewerFrameReRender();
      _queueSave(scene.id, { title: scene.title });
    });
    titleEl.addEventListener('blur', () => _flushPendingSave());
  }

  /* ── 본문 ── */
  if (bodyEl) {
    bodyEl.addEventListener('input', e => {
      if (!_editText.editable) return;
      scene.body = e.target.value;
      _scheduleViewerFrameReRender();
      _queueSave(scene.id, { body: scene.body });
    });
    bodyEl.addEventListener('blur', () => _flushPendingSave());
  }

  /* ── 버튼 N개 (v0.3) ── */
  _bindButtonsEditEvents(panel, scene);
}

/* ================================================================
   버튼 N개 편집 이벤트 (v0.3)
   ─────────────────────────────────────────────────────────────
   · input: scene.choices[idx].label 갱신, 글자수 카운터 갱신, 저장 큐
   · 삭제 버튼: scene.choices에서 제거 → 패널 재렌더 (인덱스 재계산 필요)
   · 추가 버튼: 빈 choice 추가 → 패널 재렌더
   · 저장은 buttons 배열 전체를 직렬화해서 한 필드로 보냄
     (개별 라벨 patch 안 함 — 일관성 유지)
   ================================================================ */
function _bindButtonsEditEvents(panel, scene) {
  if (scene.type === 'ending') return;  // 엔딩은 버튼 편집 없음

  const list      = panel.querySelector('.js-edit-buttons-list');
  const addBtn    = panel.querySelector('.js-edit-btn-add');
  if (!list) return;

  /* 라벨 입력 — 모든 input.js-edit-button-label 위임 처리 */
  list.addEventListener('input', e => {
    if (!_editText.editable) return;
    const input = e.target.closest('.js-edit-button-label');
    if (!input) return;
    const idx = parseInt(input.dataset.idx, 10);
    if (isNaN(idx) || !scene.choices[idx]) return;

    scene.choices[idx].label = input.value;

    /* 글자수 카운터 갱신 (해당 행만) */
    const row = input.closest('.edit-button-row');
    if (row) {
      const lenEl     = row.querySelector('.js-edit-btn-len');
      const counterEl = row.querySelector('.edit-btn-counter');
      const len = input.value.length;
      if (lenEl) lenEl.textContent = String(len);
      if (counterEl) {
        counterEl.classList.remove('edit-btn-counter--warn', 'edit-btn-counter--over');
        if (len > 60)      counterEl.classList.add('edit-btn-counter--over');
        else if (len > 30) counterEl.classList.add('edit-btn-counter--warn');
      }
    }

    _scheduleViewerFrameReRender();
    _queueSaveButtons(scene);
  });

  /* 행에서 포커스 빠질 때 즉시 저장 flush */
  list.addEventListener('blur', e => {
    if (e.target && e.target.classList.contains('js-edit-button-label')) {
      _flushPendingSave();
    }
  }, true);  // capture로 blur 잡음 (blur는 안 버블)

  /* 삭제 버튼 — 위임 */
  list.addEventListener('click', e => {
    const removeBtn = e.target.closest('.js-edit-btn-remove');
    if (!removeBtn) return;
    if (!_editText.editable) return;

    const idx = parseInt(removeBtn.dataset.idx, 10);
    if (isNaN(idx) || !scene.choices[idx]) return;

    /* 1개 남은 상태에서 삭제 시도는 막힘 (UI에서 숨겼지만 방어) */
    if (scene.choices.length <= 1) return;

    scene.choices.splice(idx, 1);
    _queueSaveButtons(scene);
    _flushPendingSave();
    /* 패널 재렌더 — 인덱스가 다 바뀌므로 통째로 다시 그림 */
    renderEditPanel();
    _scheduleViewerFrameReRender();
  });

  /* 추가 버튼 */
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (!_editText.editable) return;

      const newIdx = scene.choices.length;
      const newId  = (typeof _autoChoiceId === 'function')
        ? _autoChoiceId(newIdx)
        : String.fromCharCode(65 + newIdx);

      scene.choices.push({
        id: newId,
        label: '',
        nextId: null,
        presentation: (typeof defaultPresentation === 'function')
          ? defaultPresentation(newId)
          : { placement: 'bottom' },
      });

      _queueSaveButtons(scene);
      _flushPendingSave();
      renderEditPanel();
      _scheduleViewerFrameReRender();
    });
  }
}

/* buttons 배열 전체를 직렬화해서 저장 큐에 올림.
   _queueSave는 같은 sceneId의 같은 필드를 덮어쓰므로 연타 안전.
   maker 호환 (옵션 2): buildButtonsPatchForSave가 buttons + choiceA/B/count를
   함께 patch로 만들어 한번에 저장. 이러면 maker가 choiceA/B만 읽어도 정합. */
function _queueSaveButtons(scene) {
  if (typeof buildButtonsPatchForSave === 'function') {
    const patch = buildButtonsPatchForSave(scene.choices);
    _queueSave(scene.id, patch);
  } else {
    /* fallback (헬퍼 미정의) — buttons만 저장 */
    const buttons = (typeof serializeChoicesForSave === 'function')
      ? serializeChoicesForSave(scene.choices)
      : (scene.choices || []).map(c => ({
          id: c.id, label: c.label || '',
          ...(c.nextId ? { nextId: String(c.nextId) } : {}),
        }));
    _queueSave(scene.id, { buttons });
  }
}

/* ================================================================
   장면 template override
   ================================================================ */
function _sceneTemplateHtml(scene) {
  const options = ['(기본)', 'full-image', 'text-page', 'map-layout'];
  return `
    ${_modePickerHtml(scene)}
    <div class="edit-row">
      <label class="edit-label">이 장면 레이아웃</label>
      <div class="edit-toggle-group" style="flex-wrap:wrap;">
        ${options.map(tpl => `
          <button class="edit-toggle js-scene-tpl ${(scene.layoutTemplate || '(기본)') === tpl ? 'active' : ''}"
            data-val="${tpl}" style="margin-bottom:4px;">
            ${{ '(기본)':'기본', 'full-image':'이미지', 'text-page':'텍스트', 'map-layout':'지도' }[tpl] || tpl}
          </button>`).join('')}
      </div>
    </div>
    ${_textAnchorHtml(scene)}`;
}

function _bindSceneTemplateEvents(panel, scene) {
  _bindModePickerEvents(panel, scene);
  panel.querySelectorAll('.js-scene-tpl').forEach(btn => {
    btn.addEventListener('click', () => {
      scene.layoutTemplate = btn.dataset.val === '(기본)' ? null : btn.dataset.val;
      renderEditPanel();
      renderCurrentScene();
    });
  });
  _bindTextAnchorEvents(panel, scene);
}

/* ================================================================
   모드 선택 UI (모드 시스템 뼈대 1차) ──
   ─────────────────────────────────────────────────────────────
   · 4개 카드형 버튼: 텍스트형 / 그림책형 / 무비형 / 기록물형
   · scene.presentationMode 저장 — null이면 picturebook로 해석됨
   · 각 모드별 상세 옵션은 이번 턴에 없음 (다음 턴들에서 모드 전용 편집층 추가)
   · 잠금은 기존 _editText.editable 공유 — 읽기 전용 상태면 버튼 비활성
   ================================================================ */
const PRESENTATION_MODE_OPTIONS = [
  { key: 'text',        icon: '📝', label: '텍스트형', desc: '읽는 장면' },
  { key: 'picturebook', icon: '🎨', label: '그림책형', desc: '그림+글' },
  { key: 'movie',       icon: '🎬', label: '무비형',   desc: '영상+선택' },
  { key: 'document',    icon: '📜', label: '기록물형', desc: '문서·단서' },
];

function _modePickerHtml(scene) {
  /* resolvePresentationMode 없으면 picturebook로 간주 (방어) */
  const current = (typeof resolvePresentationMode === 'function')
    ? resolvePresentationMode(scene) : 'picturebook';
  /* 명시 설정된 값 (null이면 '기본' 표기 대신 picturebook 버튼이 active) */
  const isExplicit = scene.presentationMode === 'text' ||
                     scene.presentationMode === 'picturebook' ||
                     scene.presentationMode === 'movie' ||
                     scene.presentationMode === 'document';

  const cards = PRESENTATION_MODE_OPTIONS.map(opt => {
    const active = (opt.key === current);
    return `<button type="button"
      class="edit-mode-card js-mode-card${active ? ' edit-mode-card--active' : ''}"
      data-val="${opt.key}"
      title="${opt.label} · ${opt.desc}">
      <span class="edit-mode-icon">${opt.icon}</span>
      <span class="edit-mode-label">${opt.label}</span>
      <span class="edit-mode-desc">${opt.desc}</span>
    </button>`;
  }).join('');

  /* 모드별 전용 힌트 (패널 밀도 축소) ──
     형식: 제목 한 줄 + 핵심 1줄 요약 (경고/note만 조건부 추가) */
  let modeHint = '';
  if (current === 'text') {
    const hasImage = !!scene.imageData;
    modeHint = `
      <div class="edit-mode-detail edit-mode-detail--text">
        <span class="edit-mode-detail-title">📝 텍스트형</span>
        <span class="edit-mode-detail-desc">종이톤 + 명조체로 읽기 중심 장면. 선택지는 하단 선택 구역.</span>
        ${hasImage ? '<div class="edit-mode-detail-warn">⚠ 배경 이미지는 흐리게 깔려요. 이미지 중심이면 그림책형이 더 어울려요.</div>' : ''}
      </div>`;
  } else if (current === 'picturebook') {
    modeHint = `
      <div class="edit-mode-detail edit-mode-detail--picturebook">
        <span class="edit-mode-detail-title">🎨 그림책형</span>
        <span class="edit-mode-detail-desc">이미지 위에 제목·본문·선택지가 놓이는 기본 장면.</span>
      </div>`;
  } else if (current === 'document') {
    modeHint = `
      <div class="edit-mode-detail edit-mode-detail--document">
        <span class="edit-mode-detail-title">📜 기록물형</span>
        <span class="edit-mode-detail-desc">편지·메모처럼 문서 컨테이너 위에서 읽는 장면.</span>
      </div>`;
  } else if (current === 'movie') {
    modeHint = `
      <div class="edit-mode-detail edit-mode-detail--movie">
        <span class="edit-mode-detail-title">🎬 무비형</span>
        <span class="edit-mode-detail-desc">검은 시네마틱 무대에 영상·포스터·자막.</span>
        <div class="edit-mode-detail-note">영상 업로드는 다음 단계 예정 — 지금은 배치만.</div>
      </div>`;
  }

  /* 모드별 서브모드 선택 (그림책형 1차 + 기록물형 1차) ──
     picturebook → spread/stage
     document    → letter/clue
     movie       → 무비형 전용 편집 구역 (설계 1차: placeholder) */
  let submodeUi = '';
  if (current === 'picturebook') {
    submodeUi = _picturebookSubmodeHtml(scene);
  } else if (current === 'document') {
    submodeUi = _documentSubmodeHtml(scene);
  } else if (current === 'movie') {
    submodeUi = _moviePanelHtml(scene);
  }

  const fallbackHint = isExplicit
    ? ''
    : '<div class="edit-mode-hint">아직 모드가 지정되지 않아 <b>그림책형(기본값)</b>으로 보이고 있어요.</div>';

  return `
    <div class="edit-row edit-row--mode-picker">
      <label class="edit-label">장면 모드</label>
      <div class="edit-mode-grid">
        ${cards}
      </div>
      ${fallbackHint}
      ${modeHint}
      ${submodeUi}
    </div>`;
}

/* ================================================================
   picturebook 서브모드 선택 UI (그림책형 1차) ──
   · 2개 카드: 펼침면형(spread) / 장면형(stage)
   · 기본값 stage — 명시 설정 안 된 경우 stage 카드가 active
   ================================================================ */
const PICTUREBOOK_SUBMODE_OPTIONS = [
  { key: 'stage',  icon: '🖼',  label: '장면형',   desc: '큰 장면 + 글' },
  { key: 'spread', icon: '📖', label: '펼침면형', desc: '좌그림 우텍스트' },
];

function _picturebookSubmodeHtml(scene) {
  const current = (typeof resolvePresentationSubmode === 'function')
    ? resolvePresentationSubmode(scene) : 'stage';

  const cards = PICTUREBOOK_SUBMODE_OPTIONS.map(opt => {
    const active = (opt.key === current);
    return `<button type="button"
      class="edit-submode-card js-submode-card${active ? ' edit-submode-card--active' : ''}"
      data-val="${opt.key}"
      title="${opt.label} · ${opt.desc}">
      <span class="edit-submode-icon">${opt.icon}</span>
      <span class="edit-submode-label">${opt.label}</span>
      <span class="edit-submode-desc">${opt.desc}</span>
    </button>`;
  }).join('');

  const detailMap = {
    spread: { title: '📖 펼침면형', desc: '왼쪽 그림 · 오른쪽 글 — 책 펼침 리듬.' },
    stage:  { title: '🖼 장면형',   desc: '큰 장면 위에 글·선택지 — 기본 인터랙티브.' },
  };
  const d = detailMap[current] || detailMap.stage;
  const detail = `
    <div class="edit-submode-detail edit-submode-detail--picturebook">
      <span class="edit-submode-detail-title">${d.title}</span>
      <span class="edit-submode-detail-desc">${d.desc}</span>
    </div>`;

  return `
    <div class="edit-submode-block edit-submode-block--picturebook">
      <label class="edit-sublabel">그림책형 · 세부 방식</label>
      <div class="edit-submode-grid">${cards}</div>
      ${detail}
    </div>`;
}

function _bindSubmodePickerEvents(panel, scene) {
  /* submode 카드는 picturebook/document 공용 — 허용값은 resolvePresentationSubmode가 검사 */
  const validValues = ['spread', 'stage', 'letter', 'clue'];
  panel.querySelectorAll('.js-submode-card').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_editText.editable) return;
      const val = btn.dataset.val;
      if (validValues.indexOf(val) === -1) return;
      scene.presentationSubmode = val;
      _queueSave(scene.id, { presentationSubmode: val });
      renderEditPanel();
      renderCurrentScene();
    });
  });
}

/* ================================================================
   document 서브모드 선택 UI (기록물형 1차) ──
   · 2개 카드: 편지형(letter) / 단서형(clue)
   · 기본값 letter — 명시 설정 안 된 경우 letter 카드가 active
   · picturebook 서브모드와 시각적으로 같은 패턴(통일된 UI)
   ================================================================ */
const DOCUMENT_SUBMODE_OPTIONS = [
  { key: 'letter', icon: '✉️', label: '편지형', desc: '편지·메시지' },
  { key: 'clue',   icon: '🔍', label: '단서형', desc: '메모·자료' },
];

function _documentSubmodeHtml(scene) {
  const current = (typeof resolvePresentationSubmode === 'function')
    ? resolvePresentationSubmode(scene) : 'letter';

  const cards = DOCUMENT_SUBMODE_OPTIONS.map(opt => {
    const active = (opt.key === current);
    return `<button type="button"
      class="edit-submode-card js-submode-card${active ? ' edit-submode-card--active' : ''}"
      data-val="${opt.key}"
      title="${opt.label} · ${opt.desc}">
      <span class="edit-submode-icon">${opt.icon}</span>
      <span class="edit-submode-label">${opt.label}</span>
      <span class="edit-submode-desc">${opt.desc}</span>
    </button>`;
  }).join('');

  const detailMap = {
    letter: { title: '✉️ 편지형', desc: '편지지 위 서술체 — 메시지·고백·안내.' },
    clue:   { title: '🔍 단서형', desc: '자료 카드 — 조사·추적·정보 조각.' },
  };
  const d = detailMap[current] || detailMap.letter;
  const detail = `
    <div class="edit-submode-detail edit-submode-detail--document">
      <span class="edit-submode-detail-title">${d.title}</span>
      <span class="edit-submode-detail-desc">${d.desc}</span>
    </div>`;

  return `
    <div class="edit-submode-block edit-submode-block--document">
      <label class="edit-sublabel">기록물형 · 세부 방식</label>
      <div class="edit-submode-grid">${cards}</div>
      ${detail}
    </div>`;
}

/* ================================================================
   무비형 전용 편집 구역 (무비형 설계 1차) ──
   · 실제 업로드 UI 아님 — 설계 단계의 placeholder + 레이아웃 옵션
   · 항목:
     1) 영상 / 포스터 슬롯 (disabled placeholder — "다음 단계에서 연결")
     2) captionMode: overlay / caption-bar (본문 표시 방식)
     3) choiceReveal: end / always (선택지 노출 시점)
   · 저장: scene.movieData 서브 오브젝트로 whitelist 통과
   ================================================================ */
function _moviePanelHtml(scene) {
  const md = (typeof getMovieData === 'function')
    ? getMovieData(scene)
    : { videoUrl: null, posterImage: null, captionMode: 'overlay', choiceReveal: 'end' };

  const hasPoster = !!(md.posterImage || scene.imageData);
  const posterSrc = md.posterImage || scene.imageData || null;

  const captionOptions = [
    { key: 'overlay',     label: '자막 덮기', desc: '영상 위에 자막처럼 겹치기' },
    { key: 'caption-bar', label: '자막바',    desc: '영상 아래 자막 띠' },
  ];
  const revealOptions = [
    { key: 'end',    label: '영상 끝에서', desc: '영상이 끝나면 나타나요' },
    { key: 'always', label: '항상 표시',    desc: '영상과 함께 내내 보여요' },
  ];

  return `
    <div class="edit-submode-block edit-submode-block--movie">
      <label class="edit-sublabel">무비형 · 전용 설정</label>

      <!-- 영상 / 포스터 슬롯 (비활성 — 연결 예정) -->
      <div class="edit-movie-slots">
        <div class="edit-movie-slot edit-movie-slot--video is-disabled"
             aria-disabled="true" title="영상 업로드는 다음 단계에서 연결됩니다">
          <div class="edit-movie-slot-locked-badge">🔒 연결 예정</div>
          <div class="edit-movie-slot-icon">🎞</div>
          <div class="edit-movie-slot-title">영상 파일</div>
          <div class="edit-movie-slot-note">다음 단계에서 업로드 연결</div>
        </div>
        <div class="edit-movie-slot edit-movie-slot--poster${hasPoster ? ' has-source' : ' is-disabled'}"
             ${hasPoster ? '' : 'aria-disabled="true" title="포스터 업로드는 다음 단계. 지금은 장면 이미지가 자동으로 쓰여요."'}>
          ${hasPoster
            ? `<img src="${escHtml(posterSrc)}" alt="포스터 미리보기" class="edit-movie-poster-preview">
               <div class="edit-movie-slot-overlay-label">포스터 (장면 이미지 사용 중)</div>`
            : `<div class="edit-movie-slot-locked-badge">🔒 연결 예정</div>
               <div class="edit-movie-slot-icon">🖼</div>
               <div class="edit-movie-slot-title">포스터 이미지</div>
               <div class="edit-movie-slot-note">없으면 장면 이미지가 대신 쓰여요</div>`}
        </div>
      </div>

      <!-- 자막 / 본문 표시 방식 -->
      <div class="edit-movie-row">
        <label class="edit-movie-label">본문 표시</label>
        <div class="edit-toggle-group">
          ${captionOptions.map(opt => `
            <button type="button"
              class="edit-toggle js-movie-caption${md.captionMode === opt.key ? ' active' : ''}"
              data-val="${opt.key}"
              title="${opt.desc}">${opt.label}</button>
          `).join('')}
        </div>
      </div>

      <!-- 선택지 노출 시점 -->
      <div class="edit-movie-row">
        <label class="edit-movie-label">선택지 노출</label>
        <div class="edit-toggle-group">
          ${revealOptions.map(opt => `
            <button type="button"
              class="edit-toggle js-movie-reveal${md.choiceReveal === opt.key ? ' active' : ''}"
              data-val="${opt.key}"
              title="${opt.desc}">${opt.label}</button>
          `).join('')}
        </div>
      </div>

      <div class="edit-movie-note">
        💡 자막 모드(본문 표시)가 텍스트 위치를 결정 — 텍스트 위치 프리셋은 무비형에선 적용 안 됨.
      </div>
    </div>`;
}

function _bindMoviePanelEvents(panel, scene) {
  /* movieData 부분 업데이트 + 저장 helper */
  const writeMovieField = (key, val) => {
    const prev = (typeof getMovieData === 'function')
      ? getMovieData(scene)
      : { videoUrl: null, posterImage: null, captionMode: 'overlay', choiceReveal: 'end' };
    const next = Object.assign({}, prev, { [key]: val });
    scene.movieData = next;
    _queueSave(scene.id, { movieData: next });
    renderEditPanel();
    renderCurrentScene();
  };

  panel.querySelectorAll('.js-movie-caption').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_editText.editable) return;
      const val = btn.dataset.val;
      if (val !== 'overlay' && val !== 'caption-bar') return;
      writeMovieField('captionMode', val);
    });
  });
  panel.querySelectorAll('.js-movie-reveal').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_editText.editable) return;
      const val = btn.dataset.val;
      if (val !== 'end' && val !== 'always') return;
      writeMovieField('choiceReveal', val);
    });
  });
}

function _bindModePickerEvents(panel, scene) {
  panel.querySelectorAll('.js-mode-card').forEach(btn => {
    btn.addEventListener('click', () => {
      /* 잠금 없는 상태에서는 변경 차단 (안전장치) */
      if (!_editText.editable) return;
      const val = btn.dataset.val;
      if (!val) return;
      scene.presentationMode = val;
      /* saveSceneText 경유로 DB 저장 — scene 본체(presentationMode) */
      _queueSave(scene.id, { presentationMode: val });
      /* 패널은 다시 렌더해서 active 카드 반영, 무대도 data-presentation-mode 갱신 */
      renderEditPanel();
      renderCurrentScene();
    });
  });
  /* picturebook/document 서브모드 카드 바인딩 (그림책형 1차 + 기록물형 1차) */
  _bindSubmodePickerEvents(panel, scene);
  /* 무비형 전용 편집 구역 바인딩 (무비형 설계 1차) */
  _bindMoviePanelEvents(panel, scene);
}

/* ================================================================
   텍스트 배치 프리셋 (그림책용 앵커) ──
   ─────────────────────────────────────────────────────────────
   · 장면 단위 설정: scene.textAnchor
   · 저장은 saveViewerMeta()가 scene_anchor_${scene.id} 키로 처리
   · 9방향 3x3 그리드 (좌/중앙/우) × (상/중/하)
   · 기본 = null → 현재 장면 레이아웃의 기본 동작 유지 (하위 호환)
   · 편집 가능 조건: 기존 sceneTemplate과 동일 (editMode + 현재 장면)
   ================================================================ */
const TEXT_ANCHOR_GRID = [
  ['top-left',    'top-center',    'top-right'],
  ['middle-left', 'middle-center', 'middle-right'],
  ['bottom-left', 'bottom-center', 'bottom-right'],
];
const TEXT_ANCHOR_LABEL = {
  'top-left':      '좌상', 'top-center':    '상단', 'top-right':    '우상',
  'middle-left':   '좌중', 'middle-center': '중앙', 'middle-right': '우중',
  'bottom-left':   '좌하', 'bottom-center': '하단', 'bottom-right': '우하',
};

function _textAnchorHtml(scene) {
  const current = scene.textAnchor || null;  // null = 기본
  /* movie 모드에서는 textAnchor가 자막 모드에 덮임 — 그리드 자체 숨김 + 안내만 (패널 밀도 축소) */
  const movieMode = (typeof resolvePresentationMode === 'function')
    && resolvePresentationMode(scene) === 'movie';
  if (movieMode) {
    return `
    <div class="edit-row edit-row--muted-compact">
      <label class="edit-label">텍스트 위치</label>
      <div class="edit-anchor-movie-note edit-anchor-movie-note--solo">
        🎬 무비형에서는 자막 모드가 위치를 결정 — 이 프리셋은 작동하지 않아요.
      </div>
    </div>`;
  }

  const cells = TEXT_ANCHOR_GRID.map(row =>
    row.map(key => {
      const active = current === key ? 'edit-anchor-cell--active' : '';
      return `<button type="button"
        class="edit-anchor-cell ${active} js-text-anchor"
        data-val="${key}"
        title="${TEXT_ANCHOR_LABEL[key]}"
        aria-label="${TEXT_ANCHOR_LABEL[key]}">
        <span class="edit-anchor-dot"></span>
      </button>`;
    }).join('')
  ).join('');

  const resetActive = !current ? 'edit-toggle--active' : '';
  return `
    <div class="edit-row">
      <label class="edit-label">텍스트 위치</label>
      <div class="edit-anchor-grid-row">
        <div class="edit-anchor-grid" role="group" aria-label="텍스트 배치 프리셋">
          ${cells}
        </div>
        <button type="button" class="edit-toggle js-text-anchor-reset ${resetActive}" data-val="">
          기본
        </button>
      </div>
      <div class="edit-anchor-current">
        현재 위치: <b>${current ? TEXT_ANCHOR_LABEL[current] : '기본'}</b>
      </div>
    </div>`;
}

function _bindTextAnchorEvents(panel, scene) {
  const apply = (val) => {
    /* 편집 가능 여부는 이 패널이 렌더된 조건(editMode + 현재 장면)에
       의해 이미 보장됨 — 별도 체크 불필요. val === '' → null (기본). */
    scene.textAnchor = val || null;
    renderEditPanel();
    renderCurrentScene();
  };
  panel.querySelectorAll('.js-text-anchor').forEach(btn => {
    btn.addEventListener('click', () => apply(btn.dataset.val));
  });
  panel.querySelector('.js-text-anchor-reset')
    ?.addEventListener('click', () => apply(''));
}

/* ================================================================
   edit panel 상단 액션 — 감상 테스트 / 작업으로 돌아가기
   ================================================================ */
function _editActionsHtml() {
  return `
    <div class="edit-actions-header">
      <button class="edit-action-btn edit-action-btn--test js-edit-preview-test">
        ▶ 감상 테스트
        <small>실제 관람자 화면 확인</small>
      </button>
      <div class="edit-actions-secondary">
        <button class="edit-action-btn-sub js-edit-open-map" title="장면 연결을 한눈에 확인">
          🗺 구조 보기
        </button>
        ${ViewerState.fromMaker ? `
        <button class="edit-action-btn-sub edit-action-btn-sub--back js-edit-return-maker" title="내용·구조 수정으로 돌아가기">
          ← 작업으로
        </button>` : ''}
      </div>
    </div>`;
}

function _bindEditActions(panel) {
  panel.querySelector('.js-edit-preview-test')?.addEventListener('click', async () => {
    /* 감상 테스트 전환 전에 저장 마무리 + 내 잠금 릴리스 ──
       테스트 중엔 edit 모드가 꺼져 패널이 사라지므로 pending이 남으면 유실됨. */
    await _flushPendingSave();
    if (_editText.num != null && typeof viewerIsMyLock === 'function' &&
        viewerIsMyLock(_editText.num)) {
      viewerReleaseLock(_editText.num);
    }
    _editText.num      = null;
    _editText.editable = false;
    ViewerState.editMode    = false;
    ViewerState._testingEdit = true;
    renderCurrentScene();
  });

  panel.querySelector('.js-edit-open-map')?.addEventListener('click', openStructureMap);

  panel.querySelector('.js-edit-return-maker')?.addEventListener('click', async () => {
    /* 작업 복귀 전에도 저장 마무리 + 잠금 릴리스 */
    await _flushPendingSave();
    if (_editText.num != null && typeof viewerIsMyLock === 'function' &&
        viewerIsMyLock(_editText.num)) {
      viewerReleaseLock(_editText.num);
    }
    if (typeof _returnToMaker === 'function') {
      _returnToMaker();
    } else {
      window.location.href = 'maker.html';
    }
  });
}

/* ================================================================
   감상 테스트 복귀 배너
   ================================================================ */
function renderTestingBanner() {
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

  const frame = document.getElementById('viewer-frame');
  if (frame) frame.appendChild(banner);

  banner.querySelector('#btn-edit-test-return').addEventListener('click', () => {
    ViewerState.editMode     = true;
    ViewerState._testingEdit = false;
    banner.remove();
    renderCurrentScene();
  });
}

/* ================================================================
   구조 미니맵 — 장면·선택·연결을 한눈에 보고 이동
   ─────────────────────────────────────────────────────────────
   · 구조 편집 아님 (navigation-only)
   · 노드: 원형 + 숫자
   · 현재 장면 accent 강조, 시작/엔딩 보조 색
   · 클릭 시 editNavigateTo() — 현재 장면 유지 로직 재사용
   ================================================================ */

/* ── depth 계산: BFS로 시작 장면부터 거리 산출 ── */
function _computeSceneDepths() {
  const scenes = ViewerState.scenes;
  const depths = {};
  const startScene = Object.values(scenes).find(s => s.isStart);

  /* 시작 장면이 없으면 첫 장면을 depth 0로 */
  const rootId = startScene?.id || _editSceneList()[0]?.id;
  if (!rootId) return depths;

  depths[rootId] = 0;
  const queue = [rootId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    const current   = scenes[currentId];
    if (!current) continue;

    const nextIds = (current.choices || [])
      .map(c => c.nextId)
      .filter(nid => nid && scenes[nid]);

    nextIds.forEach(nid => {
      if (depths[nid] == null) {
        depths[nid] = depths[currentId] + 1;
        queue.push(nid);
      }
    });
  }

  /* 시작점에서 도달 불가능한 고립 장면 — 최대 depth + 1에 배치 */
  const maxDepth = Math.max(0, ...Object.values(depths));
  Object.values(scenes).forEach(s => {
    if (depths[s.id] == null) depths[s.id] = maxDepth + 1;
  });

  return depths;
}

/* ── 레이아웃 계산: depth별 열, 같은 depth 내 id순 정렬 ── */
function _computeMapLayout() {
  const scenes = ViewerState.scenes;
  const depths = _computeSceneDepths();

  /* depth별 그룹화 */
  const byDepth = {};
  Object.values(scenes).forEach(s => {
    const d = depths[s.id] ?? 0;
    if (!byDepth[d]) byDepth[d] = [];
    byDepth[d].push(s);
  });

  /* 각 depth 그룹 내 정렬: 시작 먼저, 엔딩 마지막, 그 외는 id 오름차순
     이 정렬 덕에 연결선이 덜 교차되고 시각적으로 자연스러움 */
  Object.values(byDepth).forEach(group => {
    group.sort((a, b) => {
      const rank = s => (s.isStart ? 0 : s.isEnding ? 2 : 1);
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      return Number(a.id) - Number(b.id);
    });
  });

  const depthKeys = Object.keys(byDepth).map(Number).sort((a, b) => a - b);
  const maxRows   = Math.max(...Object.values(byDepth).map(g => g.length), 1);

  /* 열 간격: depth 개수가 많으면 살짝 좁히고, 적으면 넓게 */
  const COL_W    = depthKeys.length > 6 ? 115 : 135;
  /* 행 간격: 노드 많을수록 촘촘하게 (최소 70, 최대 90) */
  const ROW_H    = maxRows > 6 ? 70 : (maxRows > 3 ? 82 : 90);
  const MARGIN_X = 70;
  const MARGIN_Y = 60;

  /* 전체 세로 공간 기준 — maxRows 기준의 총 세로 길이 */
  const totalColH = (maxRows - 1) * ROW_H;

  const positions = {};

  depthKeys.forEach((d, colIdx) => {
    const group     = byDepth[d];
    const rows      = group.length;
    const groupH    = (rows - 1) * ROW_H;
    /* 이 depth 그룹의 세로 시작 y — 전체 높이의 중앙에 정렬 */
    const startY    = MARGIN_Y + (totalColH - groupH) / 2;

    group.forEach((scene, rowIdx) => {
      positions[scene.id] = {
        x: MARGIN_X + colIdx * COL_W,
        y: startY + rowIdx * ROW_H,
        depth: d,
      };
    });
  });

  const width  = MARGIN_X * 2 + Math.max(0, depthKeys.length - 1) * COL_W;
  const height = MARGIN_Y * 2 + totalColH;

  return { positions, width, height };
}

/* ── 미니맵 열기 ── */
function openStructureMap() {
  /* 기존 오버레이 제거 (toggle 성격) */
  const existing = document.getElementById('structure-map-overlay');
  if (existing) { existing.remove(); return; }

  const overlay = document.createElement('div');
  overlay.id    = 'structure-map-overlay';
  overlay.className = 'structure-map-overlay';
  overlay.innerHTML = `
    <div class="structure-map-panel">
      <div class="structure-map-header">
        <h3 class="structure-map-title">🗺 장면 구조</h3>
        <div class="structure-map-hint">노드를 누르면 해당 장면으로 이동해요</div>
        <button class="structure-map-close js-structure-map-close" title="닫기">✕</button>
      </div>
      <div class="structure-map-legend">
        <span class="structure-map-legend-item">
          <span class="structure-map-dot structure-map-dot--start"></span>시작
        </span>
        <span class="structure-map-legend-item">
          <span class="structure-map-dot structure-map-dot--normal"></span>일반
        </span>
        <span class="structure-map-legend-item">
          <span class="structure-map-dot structure-map-dot--ending"></span>엔딩
        </span>
        <span class="structure-map-legend-item">
          <span class="structure-map-dot structure-map-dot--current"></span>현재
        </span>
      </div>
      <div class="structure-map-body js-structure-map-body"></div>
    </div>`;

  document.body.appendChild(overlay);

  /* 닫기 — ✕ 버튼 + 배경 클릭 */
  overlay.querySelector('.js-structure-map-close')?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove();
  });

  renderStructureMap();
}

/* ── 미니맵 SVG 렌더 (상태 변화 시 다시 호출 가능) ── */
function renderStructureMap() {
  const body = document.querySelector('.js-structure-map-body');
  if (!body) return;

  const scenes  = ViewerState.scenes;
  const layout  = _computeMapLayout();
  const { positions, width, height } = layout;
  const currentId = ViewerState.currentSceneId;

  const NODE_R = 22;

  /* 연결선 path 데이터 생성 */
  const edges = [];
  Object.values(scenes).forEach(scene => {
    const src = positions[scene.id];
    if (!src) return;
    (scene.choices || []).forEach(choice => {
      const dst = positions[choice.nextId];
      if (!dst) return;

      /* bezier curve — 수평 방향 중심 */
      const dx = dst.x - src.x;
      const c1x = src.x + dx * 0.5;
      const c1y = src.y;
      const c2x = dst.x - dx * 0.5;
      const c2y = dst.y;

      edges.push(`<path d="M${src.x},${src.y} C${c1x},${c1y} ${c2x},${c2y} ${dst.x},${dst.y}"
        class="structure-map-edge" />`);
    });
  });

  /* 노드 렌더 */
  const nodes = Object.values(scenes).map(scene => {
    const pos = positions[scene.id];
    if (!pos) return '';

    let typeClass = 'structure-map-node--normal';
    if (scene.isStart)  typeClass = 'structure-map-node--start';
    if (scene.isEnding) typeClass = 'structure-map-node--ending';
    const isCurrent = scene.id === currentId;

    const title = scene.title ? escHtml(scene.title) : `장면 ${scene.id}`;

    return `
      <g class="structure-map-node-group ${isCurrent ? 'is-current' : ''}"
         data-scene-id="${escHtml(scene.id)}"
         transform="translate(${pos.x},${pos.y})">
        ${isCurrent ? `<circle r="${NODE_R + 6}" class="structure-map-node-halo"/>` : ''}
        <circle r="${NODE_R}" class="structure-map-node ${typeClass} ${isCurrent ? 'is-current' : ''}"/>
        <text class="structure-map-node-label" text-anchor="middle" dominant-baseline="central">${escHtml(scene.id)}</text>
        <title>${title}</title>
      </g>`;
  }).join('');

  body.innerHTML = `
    <svg class="structure-map-svg"
         viewBox="0 0 ${width} ${height}"
         preserveAspectRatio="xMidYMid meet"
         xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="structure-map-arrow" viewBox="0 0 10 10" refX="9" refY="5"
          markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="rgba(88,166,255,0.55)"/>
        </marker>
      </defs>
      <g class="structure-map-edges">${edges.join('')}</g>
      <g class="structure-map-nodes">${nodes}</g>
    </svg>`;

  /* 노드 클릭 — editNavigateTo로 이동 + 미니맵 자동 닫힘
     장면 이동 후 바로 편집에 집중할 수 있도록 오버레이를 닫음 */
  body.querySelectorAll('.structure-map-node-group').forEach(g => {
    g.addEventListener('click', () => {
      const sid = g.dataset.sceneId;
      if (!sid) return;
      /* 같은 장면 클릭 시에도 미니맵은 닫아줌 (사용자 의도가 탐색 종료일 가능성) */
      if (sid === ViewerState.currentSceneId) {
        document.getElementById('structure-map-overlay')?.remove();
        return;
      }
      editNavigateTo(sid);
      /* 미니맵 닫기 — 이동 후 편집 화면으로 즉시 전환 */
      document.getElementById('structure-map-overlay')?.remove();
    });
  });
}
