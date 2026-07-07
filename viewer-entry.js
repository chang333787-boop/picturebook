/* ================================================================
   viewer-entry.js — 진입 처리 (팀명 입력 / query param)
   의존: viewer-state.js, viewer-data.js, viewer-controls.js
   ================================================================ */

window.addEventListener('DOMContentLoaded', () => {
  _bindEntryEvents();
  _processQueryParam();
  _initLetterbox();
  window.addEventListener('resize', _applyLetterbox);

  /* v47: 인스펙터 토글 — 다듬기 모드에서 페이지 가려지는 영역 확인용.
     #edit-panel.is-collapsed 토글 + 버튼 화살표 방향 갱신. */
  const toggleBtn = document.getElementById('edit-panel-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const panel = document.getElementById('edit-panel');
      if (!panel) return;
      const collapsed = panel.classList.toggle('is-collapsed');
      toggleBtn.classList.toggle('is-panel-collapsed', collapsed);
      toggleBtn.textContent = collapsed ? '▶' : '◀';
      toggleBtn.title = collapsed ? '인스펙터 펼치기' : '인스펙터 접기';
    });
  }
});

/* ── 16:9 letterbox 계산 ── */
function _initLetterbox() { _applyLetterbox(); }

function _applyLetterbox() {
  const wrap = document.getElementById('stage-wrap');
  if (!wrap) return;
  const ww = wrap.clientWidth, wh = wrap.clientHeight;
  const targetRatio = 16 / 9;
  const currentRatio = ww / wh;
  wrap.classList.toggle('letterbox-h', currentRatio > targetRatio);
  wrap.classList.toggle('letterbox-v', currentRatio <= targetRatio);
}

/* ── 입력 이벤트 바인딩 ── */
function _bindEntryEvents() {
  document.getElementById('entry-submit')
    ?.addEventListener('click', handleEntrySubmit);

  /* 클래스 코드 → 팀 이름 필드로 Enter 이동 */
  document.getElementById('entry-code-input')
    ?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('entry-team-input')?.focus();
    });

  document.getElementById('entry-team-input')
    ?.addEventListener('keydown', e => {
      if (e.key === 'Enter') handleEntrySubmit();
    });
}

/* ── query param 처리: ?team=2모둠&edit=1&from=maker&classId=abc&scene=N&ptype=movie ── */
function _processQueryParam() {
  const params    = new URLSearchParams(location.search);
  const teamName  = params.get('team');
  const editMode  = params.get('edit') === '1';
  const fromMaker = params.get('from') === 'maker';
  const classId   = params.get('classId') || null;  // v2 경로용
  const sceneNum  = params.get('scene') || null;    // C-2: 특정 장면 자동 선택
  const ptypeHint = params.get('ptype') || null;    // W7: maker가 보낸 모드 hint (lock 보강)

  if (!teamName) return;

  _enterViewer(teamName, editMode, fromMaker, classId, sceneNum, ptypeHint);
}

/* ── entry 화면 직접 제출 — v2 classCodes lookup ── */
async function handleEntrySubmit() {
  const codeInput = document.getElementById('entry-code-input');
  const teamInput = document.getElementById('entry-team-input');
  const code      = codeInput?.value.trim().toUpperCase();
  const teamName  = teamInput?.value.trim();

  if (!code) {
    _setEntryError('클래스 코드를 입력해주세요 (예: JL26A)');
    codeInput?.focus();
    return;
  }
  if (!teamName) {
    _setEntryError('팀 이름을 입력해주세요');
    teamInput?.focus();
    return;
  }

  _setEntryLoading(true);
  _setEntryError('');

  try {
    /* classCodes/$code → classId 조회 (viewer 전용 Firebase 인스턴스 사용) */
    const classId = await lookupClassIdForViewer(code);
    if (!classId) {
      _setEntryError('클래스 코드가 올바르지 않아요. 선생님께 확인해주세요.');
      _setEntryLoading(false);
      return;
    }

    await _enterViewer(teamName, false, false, classId);
  } catch (err) {
    _setEntryError(err.message || '작품을 불러오는 중 오류가 발생했어요.');
    _setEntryLoading(false);
  }
}

/* ── 실제 진입 처리 ── */
async function _enterViewer(teamName, editMode = false, fromMaker = false, classId = null, sceneNum = null, ptypeHint = null) {
  try {
    _setEntryLoading(true);
    await loadTeamData(teamName, classId, fromMaker, ptypeHint);  // fromMaker: isPublic 차단 예외용 / ptypeHint: maker 모드 hint

    /* edit 모드 + fromMaker 상태 설정 */
    if (editMode) ViewerState.editMode = true;
    ViewerState.fromMaker = fromMaker;

    /* 첫 상호작용 → autoplay 허용 */
    ViewerState.audioState.autoplayAllowed = true;

    /* entry 화면 → player 화면 전환 */
    _showPlayerScreen();

    /* v36: 작품 orientation에 맞춰 디바이스 화면 자동 회전 (PWA standalone 모드 한정).
       세로 작품 → portrait, 가로 작품 → landscape. 일반 브라우저 탭에선 silent fail. */
    if (screen.orientation && typeof screen.orientation.lock === 'function') {
      const targetOrient = (ViewerState.project.pageOrientation === 'portrait')
        ? 'portrait' : 'landscape';
      screen.orientation.lock(targetOrient).catch(() => { /* tab 모드 등 실패 OK */ });
    }

    /* edit 모드: startViewerEdit (cover 우회) / 감상 모드: startViewer */
    if (editMode) {
      /* 장면 글 수정 / 배치 편집을 위한 잠금 리스너 초기화 ──
         maker와 같은 Firebase 경로(`$basePath/locks`)를 공유해
         같은 장면을 두 화면에서 동시 편집하지 못하도록 한다.
         감상 모드에선 편집 행위가 없으므로 초기화하지 않음. */
      const encodedName = encodeURIComponent(teamName);
      const basePath = classId
        ? `classes/${classId}/teams/${encodedName}`
        : `teams/${encodedName}`;
      if (typeof initViewerLocks === 'function') initViewerLocks(basePath);
      /* PERF-2: 편집 코드(viewer-edit.js+viewer-ai.js) 지연 로드 — startViewerEdit가 편집 함수를 호출하므로 먼저 보장. */
      if (typeof window.ensureEditBundle === 'function') await window.ensureEditBundle();
      /* C-2: sceneNum이 있으면 그 장면부터 시작 (maker 카드의 다듬기 진입점에서 옴).
         없으면 첫 장면부터. ViewerState.scenes의 키가 string num이라 그대로 전달. */
      startViewerEdit(sceneNum);
      /* TUTORIAL: 감상 화면 다듬기 첫 진입 1회 튜토리얼(기기당 1회). maker에서 온 편집 진입에만.
         편집을 막지 않도록 await 없이 fire-and-forget. */
      if (fromMaker && typeof window !== 'undefined' && window.TutorialWelcome
          && typeof window.TutorialWelcome.maybeShow === 'function') {
        try { window.TutorialWelcome.maybeShow({ deck: 'refineWelcome', keyPrefix: 'tutorial_refine' }); } catch (e) { /* noop */ }
      }
    } else {
      startViewer();
    }

    /* W8: 자동 진입(?team=) 깜빡임 차단 — player 렌더 끝나면 로딩 제거.
       viewer.html head의 inline script가 window.__hideAutoEnterLoading 정의. */
    if (typeof window.__hideAutoEnterLoading === 'function') {
      /* 다음 프레임에서 — player DOM이 그려진 다음이 자연스러움 */
      requestAnimationFrame(function () { window.__hideAutoEnterLoading(); });
    }

  } catch (err) {
    /* PERF-2: 편집 번들 로드 등 진입 실패 시 editMode 상태를 되돌려 재진입 오염 방지(Codex minor 반영). */
    ViewerState.editMode = false;
    _setEntryError(err.message || '작품을 불러오는 중 오류가 발생했어요.');
    /* POLISH-AUTH-FIX(Phase F): 편집 권한(maker UID) 복원 실패 → 만들기 화면 복귀 버튼 제공. */
    if (err && err.code === 'viewer/edit-auth-missing') _showMakerReturnButton();
    _setEntryLoading(false);
    /* W8: 오류 시 자동 진입 로딩 제거 + entry 화면 강제 표시.
       inline script가 #entry-screen{display:none !important}로 숨겨놨기 때문에
       inline style로 덮어 사용자가 입력칸 다시 볼 수 있게 함. */
    if (typeof window.__hideAutoEnterLoading === 'function') {
      window.__hideAutoEnterLoading();
    }
    const entryEl = document.getElementById('entry-screen');
    if (entryEl) entryEl.style.cssText = 'display:flex !important;';
  }
}

/* ── UI 헬퍼 ── */
function _setEntryError(msg) {
  const errEl = document.getElementById('entry-error');
  if (errEl) errEl.textContent = msg;
}

/* POLISH-AUTH-FIX(Phase F): 편집 권한 복원 실패 시 만들기 화면 복귀 버튼.
   내부 이동으로 들어왔으면 뒤로가기(maker 세션 유지), 아니면 maker.html로. */
function _showMakerReturnButton() {
  if (document.getElementById('edit-auth-return-btn')) return;
  const errEl = document.getElementById('entry-error');
  const btn = document.createElement('button');
  btn.id = 'edit-auth-return-btn';
  btn.type = 'button';
  btn.textContent = '← 만들기 화면으로 돌아가기';
  btn.style.cssText = 'display:block;margin:14px auto 0;padding:10px 20px;border-radius:10px;border:1px solid #c9b9a6;background:#f3ece1;color:#5a4a36;font-size:15px;cursor:pointer;';
  btn.addEventListener('click', () => {
    if (window.history && window.history.length > 1) window.history.back();
    else window.location.href = 'maker.html';
  });
  if (errEl && errEl.insertAdjacentElement) errEl.insertAdjacentElement('afterend', btn);
  else (document.getElementById('entry-screen') || document.body).appendChild(btn);
}

function _setEntryLoading(on) {
  const btn = document.getElementById('entry-submit');
  if (!btn) return;
  btn.disabled     = on;
  btn.textContent  = on ? '불러오는 중...' : '작품 보기 →';
}

function _showPlayerScreen() {
  document.getElementById('entry-screen') ?.classList.add('hidden');
  document.getElementById('player-screen')?.classList.remove('hidden');
}

function showEntryScreen() {
  document.getElementById('entry-screen') ?.classList.remove('hidden');
  document.getElementById('player-screen')?.classList.add('hidden');
  ViewerState.resetPlayback();
}
