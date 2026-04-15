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

  document.getElementById('entry-team-input')
    ?.addEventListener('keydown', e => {
      if (e.key === 'Enter') handleEntrySubmit();
    });
}

/* ── query param 처리: ?team=2모둠&edit=1&from=maker&classId=abc ── */
function _processQueryParam() {
  const params    = new URLSearchParams(location.search);
  const teamName  = params.get('team');
  const editMode  = params.get('edit') === '1';
  const fromMaker = params.get('from') === 'maker';
  const classId   = params.get('classId') || null;  // v2 경로용

  if (!teamName) return;

  _enterViewer(teamName, editMode, fromMaker, classId);
}

/* ── entry 화면 submit ── */
async function handleEntrySubmit() {
  const input    = document.getElementById('entry-team-input');
  const errEl    = document.getElementById('entry-error');
  const teamName = input?.value.trim();

  if (!teamName) {
    _setEntryError('팀 이름을 입력해주세요');
    return;
  }

  _setEntryLoading(true);
  _setEntryError('');

  /* ⚠️ entry 화면 직접 제출은 classId 없이 진입
     v2에서 classId가 필요한 경우는 반드시 ?team=...&classId=... query param 경유 사용
     직접 입장 시 classId=null → teams/ 경로(v1)로 폴백 */
  const editMode = new URLSearchParams(location.search).get('edit') === '1';
  await _enterViewer(teamName, editMode);
  _setEntryLoading(false);
}

/* ── 실제 진입 처리 ── */
async function _enterViewer(teamName, editMode = false, fromMaker = false, classId = null) {
  try {
    _setEntryLoading(true);
    await loadTeamData(teamName, classId);  // classId: v2 경로용 (v1에서는 null)

    /* edit 모드 + fromMaker 상태 설정 */
    if (editMode) ViewerState.editMode = true;
    ViewerState.fromMaker = fromMaker;

    /* 첫 상호작용 → autoplay 허용 */
    ViewerState.audioState.autoplayAllowed = true;

    /* entry 화면 → player 화면 전환 */
    _showPlayerScreen();

    /* 시작 장면 또는 cover로 이동 */
    startViewer();

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
