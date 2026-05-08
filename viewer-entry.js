/* ================================================================
   viewer-entry.js — 진입 처리 (팀명 입력 / query param)
   의존: viewer-state.js, viewer-data.js, viewer-controls.js
   ================================================================ */

window.addEventListener('DOMContentLoaded', () => {
  _bindEntryEvents();
  _processQueryParam();
  _initLetterbox();
  window.addEventListener('resize', _applyLetterbox);
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

/* ── query param 처리: ?team=2모둠&edit=1&from=maker&classId=abc&scene=N ── */
function _processQueryParam() {
  const params    = new URLSearchParams(location.search);
  const teamName  = params.get('team');
  const editMode  = params.get('edit') === '1';
  const fromMaker = params.get('from') === 'maker';
  const classId   = params.get('classId') || null;  // v2 경로용
  const sceneNum  = params.get('scene') || null;    // C-2: 특정 장면 자동 선택

  if (!teamName) return;

  _enterViewer(teamName, editMode, fromMaker, classId, sceneNum);
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
async function _enterViewer(teamName, editMode = false, fromMaker = false, classId = null, sceneNum = null) {
  try {
    _setEntryLoading(true);
    await loadTeamData(teamName, classId, fromMaker);  // fromMaker: isPublic 차단 예외용

    /* edit 모드 + fromMaker 상태 설정 */
    if (editMode) ViewerState.editMode = true;
    ViewerState.fromMaker = fromMaker;

    /* 첫 상호작용 → autoplay 허용 */
    ViewerState.audioState.autoplayAllowed = true;

    /* entry 화면 → player 화면 전환 */
    _showPlayerScreen();

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
      /* C-2: sceneNum이 있으면 그 장면부터 시작 (maker 카드의 다듬기 진입점에서 옴).
         없으면 첫 장면부터. ViewerState.scenes의 키가 string num이라 그대로 전달. */
      startViewerEdit(sceneNum);
    } else {
      startViewer();
    }

  } catch (err) {
    _setEntryError(err.message || '작품을 불러오는 중 오류가 발생했어요.');
    _setEntryLoading(false);
  }
}

/* ── UI 헬퍼 ── */
function _setEntryError(msg) {
  const errEl = document.getElementById('entry-error');
  if (errEl) errEl.textContent = msg;
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
