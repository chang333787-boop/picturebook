/* ================================================================
   ui.js — 편집 mutation / 파일 I/O / 템플릿 / 모드 / 정적 이벤트 바인딩
   의존: state.js, locks.js, firebase.js, sceneRenderer.js, canvasInteraction.js
   ================================================================ */

/* ================================================================
   복귀 context 저장 헬퍼
   maker/admin에서 viewer·edit 탭을 열 때 현재 URL을 localStorage에 저장.
   viewer 쪽 _returnToMaker가 소비해서 정확한 복귀 대상을 결정함.
   key: 'branchReturnContext' — { source, url, savedAt }
   ================================================================ */
function _saveReturnContext(source) {
  try {
    localStorage.setItem('branchReturnContext', JSON.stringify({
      source:  source,            // 'maker' | 'admin'
      url:     location.href,
      savedAt: Date.now(),
    }));
  } catch (e) { /* storage 실패해도 진입은 계속 */ }
}

/* ================================================================
   Undo 시스템 제거 (협업 안정화 1차)
   ─────────────────────────────────────────────────────────────
   이전에 있던 전역 snapshot 기반 Undo는 동시 편집 구조와 단위가
   맞지 않아 다른 사용자의 변경까지 되돌릴 위험이 있어 제거.
   텍스트 입력칸의 브라우저 기본 undo(Ctrl+Z)는 그대로 동작함 — 우리 코드는
   그걸 가로채지 않음.
   대안: 초기화/삭제/불러오기/템플릿 적용 등 큰 작업은 confirm 유지.
   ================================================================ */

/* ================================================================
   mutation 단일 진입점
   ================================================================

   mutateScene(num, patch, options)      — 필드 단위 변경
   _afterMutation()                      — 구조·대량 변경 후 공통 후처리
   ─────────────────────────────────────────────────────────────
   필드 단위: updateType, updateTrueEnding, updateChoiceCount,
             updateChoiceLabel, updateTitle
   구조·대량: renameScene, deleteScene, clearAll,
             importJSON, applyTemplate
   ─────────────────────────────────────────────────────────────

   mutateScene options:
     needsArrows    {boolean} — drawArrows() 호출 여부 (기본 false)
     skipCardRender {boolean} — renderCard 생략 여부 (기본 false)
     silent         {boolean} — ensureEditable 실패 시 renderCard 생략 (기본 false)
   ─────────────────────────────────────────────────────────────*/
async function mutateScene(num, patch, {
  needsArrows    = false,
  skipCardRender = false,
  silent         = false,
} = {}) {
  if (!scenes[num]) return false;

  if (!await ensureEditable(num)) {
    /* 실패 시 UI를 현재 state로 복원 — 라디오/체크박스가 제자리로 돌아오게 */
    if (!silent) renderCard(scenes[num]);
    return false;
  }

  /* 1. 상태 변경 */
  Object.assign(scenes[num], patch);
  _applyMutateSideEffects(num, patch);

  /* 2. 렌더 */
  if (!skipCardRender) renderCard(scenes[num]);
  if (needsArrows)     drawArrows();

  /* 3. 저장 */
  pushToFirebase(num);
  return true;
}

/* 패치 부수 효과 — 상태 일관성 보장 */
function _applyMutateSideEffects(num, patch) {
  if (patch.choiceCount === 1) {
    scenes[num].nextB   = '';
    scenes[num].choiceB = '';
  }
}

/* ── 구조·대량 mutation 공통 후처리 ──
   renameScene / deleteScene / clearAll / importJSON / applyTemplate
   모두 이 헬퍼로 수렴: renderAll() + pushToFirebase()            */
function _afterMutation() {
  renderAll();
  pushToFirebase();
}

/* ── 필드 단위 래퍼 ── */

/* ================================================================
   updateTitle — 타이핑 끊김 원천 차단
   ─────────────────────────────────────────────────────────────
   설계 원칙:
   · 입력마다 await 금지 — 타이핑 중 네트워크 대기 0
   · 즉시 로컬 scenes[num].title 반영 (UI는 이미 textarea)
   · lock 확보는 focus 시점 1회 (sceneRenderer의 textarea focus 핸들러)
   · 내 세션(activeEdits[num]) 있으면 debounce 저장
   · 세션 없으면 로컬 반영만 — focus 핸들러가 lock 확보하면 이후 입력부터 저장
   · 남의 lock이어도 로컬 내용은 유지 (유실 없음)
   · debounce 400ms — 400~800 권장 범위 최소값
   flush: blur / 장면 전환 / preview·viewer 열기 직전 / 페이지 이탈
   ================================================================ */
const _titleSaveTimers = {};   // num → timeoutId
const _titleDirty      = new Set();

function updateTitle(num, val) {
  if (!scenes[num]) return;

  /* 1. 즉시 로컬 반영 — await 없음, 동기 */
  scenes[num].title = val;
  _titleDirty.add(num);

  /* 2. 내 편집 세션 있을 때만 저장 예약
        세션 없음 = focus 시점 lock 확보 진행 중 or 남의 lock.
        이 경우 로컬 반영만 — 세션 확보되면 다음 입력부터 자동으로 저장 재개. */
  if (!activeEdits[num]) return;

  /* 세션 있음 — idle timer 리셋 (releaseLock 방지) */
  touchEdit(num);

  /* 3. 저장 debounce — 타이핑 멈추면 push */
  clearTimeout(_titleSaveTimers[num]);
  _titleSaveTimers[num] = setTimeout(() => {
    delete _titleSaveTimers[num];
    if (_titleDirty.has(num)) {
      _titleDirty.delete(num);
      pushToFirebase(num);
    }
  }, 400);
}

/* 강제 flush — blur / 장면 전환 / preview·viewer 열기 / 페이지 이탈 */
function flushTitleSaves(num) {
  if (num !== undefined) {
    clearTimeout(_titleSaveTimers[num]);
    delete _titleSaveTimers[num];
    if (_titleDirty.has(num)) {
      _titleDirty.delete(num);
      pushToFirebase(num);
    }
    return;
  }
  /* 전체 flush */
  const keys = Object.keys(_titleSaveTimers);
  keys.forEach(k => {
    clearTimeout(_titleSaveTimers[k]);
    delete _titleSaveTimers[k];
  });
  if (_titleDirty.size > 0) {
    const nums = Array.from(_titleDirty);
    _titleDirty.clear();
    nums.forEach(n => pushToFirebase(n));
  }
}

/* 페이지 이탈 시 강제 flush */
window.addEventListener('beforeunload', () => flushTitleSaves());
window.addEventListener('pagehide',    () => flushTitleSaves());

async function updateType(num, type) {
  await mutateScene(num, { type }, { needsArrows: true });
}

async function updateTrueEnding(num, val) {
  await mutateScene(num, { trueEnding: val });
}

async function updateChoiceCount(num, cnt) {
  await mutateScene(num, { choiceCount: cnt }, { needsArrows: true });
}

async function updateChoiceLabel(num, port, val) {
  /* 선택지 라벨은 카드 재렌더 없이 화살표만 갱신 */
  const patch = port === 'A' ? { choiceA: val } : { choiceB: val };
  await mutateScene(num, patch, { skipCardRender: true, needsArrows: true, silent: true });
}

/* ── 구조 mutation — ensureEditable + 복잡한 참조 처리 후 _afterMutation ── */

async function renameScene(num) {
  const newNum = parseInt(prompt(`장면 번호를 바꿀까요?\n현재: ${num}\n새 번호:`, num));
  if (!newNum || newNum === num) return;
  if (scenes[newNum]) { alert(`장면 ${newNum}은 이미 있어요!`); return; }
  if (!await ensureEditable(num)) {
    alert(`다른 사람이 장면 ${num}을(를) 편집 중이에요.`); return;
  }
  const s = { ...scenes[num], num: newNum };
  delete scenes[num]; scenes[newNum] = s;
  Object.values(scenes).forEach(sc => {
    if (sc.nextA === num) sc.nextA = newNum;
    if (sc.nextB === num) sc.nextB = newNum;
  });
  releaseLock(num);
  _afterMutation();
}

async function deleteScene(num) {
  if (!confirm(`장면 ${num}을(를) 삭제할까요?\n삭제한 뒤에는 되돌릴 수 없어요.`)) return;
  if (!await ensureEditable(num)) {
    alert(`다른 사람이 장면 ${num}을(를) 편집 중이에요.`); return;
  }
  releaseLock(num);
  removeSceneFromFirebase(num);
  delete scenes[num];
  Object.values(scenes).forEach(s => {
    if (s.nextA === num) s.nextA = '';
    if (s.nextB === num) s.nextB = '';
  });
  _afterMutation();
}

function clearAll() {
  /* 반드시 확인창 먼저 — 확인 전 아무 삭제 없음.
     Undo 제거됨 → 되돌릴 수 없음을 명확히 경고. */
  if (!confirm('정말 모든 장면을 초기화할까요?\n이 작업은 되돌릴 수 없어요.')) return;
  scenes = {}; nextNum = 1;
  _afterMutation();
}

/* ── 파일 I/O ── */
function exportJSON() {
  const data = { teamName, savedAt: new Date().toISOString(), scenes };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `가지구조_${teamName}_${new Date().toLocaleDateString('ko-KR').replace(/\. /g,'-').replace('.','')}.json`;
  a.click(); URL.revokeObjectURL(url);
}
function importJSON(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      scenes = data.scenes || data;
      const fixed = {};
      Object.values(scenes).forEach(s => { fixed[s.num] = s; });
      scenes = fixed;
      const nums = Object.keys(scenes).map(Number);
      if (nums.length) nextNum = Math.max(...nums) + 1;
      _afterMutation();
      alert(`✅ "${file.name}" 불러오기 완료!`);
    } catch { alert('❌ 올바른 가지 파일이 아니에요.'); }
  };
  reader.readAsText(file); e.target.value = '';
}

/* ── 템플릿 ── */
let selectedTemplate = 'blank';
function selectTemplate(tpl) {
  selectedTemplate = tpl;
  document.querySelectorAll('[data-tpl]').forEach(btn => {
    const active = btn.dataset.tpl === tpl;
    btn.style.border     = active ? '2px solid var(--primary)' : '2px solid #d0e0f5';
    btn.style.background = active ? '#e8f0ff' : '#fff';
    btn.style.color      = active ? 'var(--primary)' : 'var(--text)';
  });
}
function applyTemplate(tpl) {
  if (tpl === 'blank' || Object.keys(scenes).length > 0) return;
  const templates = {
    'two-ending': [
      { num:1,type:'start', title:'시작 장면',x:320,y:80, choiceCount:2,choiceA:'선택지 A',choiceB:'선택지 B',nextA:2,nextB:3 },
      { num:2,type:'normal',title:'A 경로',   x:120,y:280,choiceCount:1,choiceA:'다음으로',nextA:4 },
      { num:3,type:'normal',title:'B 경로',   x:520,y:280,choiceCount:1,choiceA:'다음으로',nextA:5 },
      { num:4,type:'ending',title:'결말 A',   x:120,y:480 },
      { num:5,type:'ending',title:'결말 B',   x:520,y:480 },
    ],
    'rejoin': [
      { num:1,type:'start', title:'시작 장면',      x:320,y:60, choiceCount:2,choiceA:'선택지 A',choiceB:'선택지 B',nextA:2,nextB:3 },
      { num:2,type:'normal',title:'A 경로',          x:120,y:240,choiceCount:1,choiceA:'합류',nextA:4 },
      { num:3,type:'normal',title:'B 경로',          x:520,y:240,choiceCount:1,choiceA:'합류',nextA:4 },
      { num:4,type:'normal',title:'다시 만나는 장면',x:320,y:420,choiceCount:2,choiceA:'선택지 A',choiceB:'선택지 B',nextA:5,nextB:6 },
      { num:5,type:'ending',title:'결말 A',          x:120,y:620 },
      { num:6,type:'ending',title:'결말 B',          x:520,y:620 },
    ],
    'true-end': [
      { num:1,type:'start', title:'시작 장면',   x:320,y:60, choiceCount:2,choiceA:'선택지 A',choiceB:'선택지 B',nextA:2,nextB:3 },
      { num:2,type:'normal',title:'A 경로',      x:120,y:240,choiceCount:1,choiceA:'다음으로',nextA:4 },
      { num:3,type:'normal',title:'B 경로',      x:520,y:240,choiceCount:2,choiceA:'계속',choiceB:'비밀 선택',nextA:5,nextB:6 },
      { num:4,type:'ending',title:'일반 결말 A', x:120,y:440 },
      { num:5,type:'ending',title:'일반 결말 B', x:420,y:440 },
      { num:6,type:'ending',title:'진짜 결말 ⭐',x:700,y:440,trueEnding:true },
    ],
  };
  const tplData = templates[tpl]; if (!tplData) return;
  tplData.forEach(s => { scenes[s.num] = s; });
  nextNum = Math.max(...tplData.map(s => s.num)) + 1;
  _afterMutation();
}

/* ── 모드 / 도움말 ── */
let advancedMode = false;
function toggleMode() {
  advancedMode = !advancedMode;
  document.body.classList.toggle('beginner-mode', !advancedMode);
  const btn = document.getElementById('mode-toggle-btn');
  btn.textContent      = advancedMode ? '⚙️ 간단히' : '⚙️ 더보기';
  btn.style.background  = advancedMode ? '#e8f5e9' : '#fff7e6';
  btn.style.color       = advancedMode ? '#2e7d32' : '#c07000';
  btn.style.borderColor = advancedMode ? '#81c784' : '#f0c040';
}
function showHelp() {
  alert(`📌 가지 branch 사용법\n\n➕ [+ 장면 추가] 버튼으로 카드 생성\n🔗 포트(●) 드래그로 카드 연결\n🔢 번호 배지 클릭으로 번호 변경\n🟢 같은 클래스 코드 + 팀 이름 + PIN이면 실시간 공유\n🔍 Ctrl+휠 또는 ±버튼으로 줌`);
}

/* ================================================================
   정적 인라인 핸들러 제거 (2-4)
   maker.html의 onclick/onkeydown을 DOMContentLoaded에서 바인딩
   ================================================================ */
window.addEventListener('DOMContentLoaded', () => {
  /* 입장 */
  document.getElementById('btn-join')?.addEventListener('click', joinTeam);
  document.getElementById('join-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('join-pin')?.focus();
  });
  document.getElementById('join-pin')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') joinTeam();
  });

  /* 툴바 */
  document.getElementById('btn-add-scene')  ?.addEventListener('click', addScene);
  document.getElementById('btn-check')      ?.addEventListener('click', checkStructure);
  document.getElementById('btn-export')     ?.addEventListener('click', exportJSON);
  document.getElementById('btn-import')     ?.addEventListener('click', () =>
    document.getElementById('file-input')?.click());
  document.getElementById('btn-clear')      ?.addEventListener('click', clearAll);
  document.getElementById('btn-group-move') ?.addEventListener('click', toggleGroupMove);
  document.getElementById('btn-preview')    ?.addEventListener('click', startPreview);
  document.getElementById('btn-route')      ?.addEventListener('click', openRoutePanel);
  document.getElementById('btn-help')       ?.addEventListener('click', showHelp);
  document.getElementById('btn-zoom-out')   ?.addEventListener('click', () => setZoom(zoom - 0.1));
  document.getElementById('btn-zoom-in')    ?.addEventListener('click', () => setZoom(zoom + 0.1));
  document.getElementById('btn-zoom-reset') ?.addEventListener('click', () => setZoom(1));

  /* ── 프로젝트 설정 패널 (표지 · 시작점) ── */
  document.getElementById('btn-project-settings')?.addEventListener('click', () => {
    if (typeof openProjectSettings === 'function') openProjectSettings();
  });
  document.getElementById('ps-close-btn') ?.addEventListener('click', () => closeProjectSettings?.());
  document.getElementById('ps-cancel-btn')?.addEventListener('click', () => closeProjectSettings?.());
  document.getElementById('ps-save-btn')  ?.addEventListener('click', () => saveProjectSettings?.());
  document.getElementById('ps-cover-input')?.addEventListener('change', (e) => {
    if (typeof handleCoverImageUpload === 'function') handleCoverImageUpload(e.target);
  });
  document.getElementById('ps-cover-remove')?.addEventListener('click', () => {
    if (typeof removeCoverImage === 'function') removeCoverImage();
  });

  /* ── 구조 편집 Ctrl+Z 제거 (협업 안정화 1차) ──
     브라우저 기본 텍스트 undo는 INPUT/TEXTAREA에서 그대로 동작 — 가로채지 않음 */
  document.getElementById('mode-toggle-btn')?.addEventListener('click', toggleMode);
  document.getElementById('file-input')     ?.addEventListener('change', importJSON);

  /* 미리보기 */
  document.getElementById('btn-preview-restart')?.addEventListener('click', restartPreview);
  document.getElementById('btn-preview-close')  ?.addEventListener('click', closePreview);
  /* preview → 완성본 보기: 현재 팀 viewer로 새 탭 */
  document.getElementById('btn-preview-open-viewer')?.addEventListener('click', () => {
    const name = teamName ? encodeURIComponent(teamName) : '';
    const cid  = classId  ? `&classId=${encodeURIComponent(classId)}` : '';
    const url  = name ? `viewer.html?team=${name}${cid}&from=maker` : 'viewer.html';
    closePreview();
    flushTitleSaves();
    _saveReturnContext('maker');
    window.open(url, '_blank');
  });

  /* 루트 */
  document.getElementById('btn-route-close')?.addEventListener('click', closeRoutePanel);

  /* 구조 검사 */
  document.getElementById('check-close')?.addEventListener('click', () => {
    document.getElementById('check-panel').style.display = 'none';
  });

  /* 이미지 모달 — 바깥 클릭 닫기는 mediaManager.js에서 등록 (source of truth) */
  document.getElementById('btn-img-close')?.addEventListener('click', closeImageModal);

  /* 관리자 패널 — Auth 기반 직접 진입 후 패널 닫기/새로고침 */
  document.getElementById('btn-admin-close')  ?.addEventListener('click', closeAdmin);
  document.getElementById('btn-admin-refresh')?.addEventListener('click', loadAdminData);

  /* 템플릿 (data-tpl 속성으로 통합) */
  document.querySelectorAll('[data-tpl]').forEach(btn =>
    btn.addEventListener('click', () => selectTemplate(btn.dataset.tpl))
  );

  /* ESC */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('img-modal')?.style.display === 'flex') closeImageModal();
    else closePreview();
  });

  /* ── 다음 단계 패널 ── */

  /* 접기/펼치기 */
  document.getElementById('btn-nsp-toggle')?.addEventListener('click', () => {
    const body   = document.getElementById('nsp-body');
    const btn    = document.getElementById('btn-nsp-toggle');
    const collapsed = body.classList.toggle('collapsed');
    btn.textContent = collapsed ? '+' : '−';
  });

  /* 감상 화면 다듬기 → viewer.html?team=...&edit=1&from=maker(&classId=...) */
  document.getElementById('btn-viewer-edit')?.addEventListener('click', () => {
    const name = encodeURIComponent(teamName || '');
    if (!name) { alert('먼저 팀 이름으로 입장해 주세요.'); return; }
    const cid = classId ? `&classId=${encodeURIComponent(classId)}` : '';
    flushTitleSaves();
    _saveReturnContext('maker');
    window.open(`viewer.html?team=${name}&edit=1&from=maker${cid}`, '_blank');
  });

  /* 빠르게 확인하기 → 기존 preview (다음 단계 패널에서 바인딩, 툴바 btn-preview와 동일 함수) */

  /* 완성본 보기 → viewer.html?team=...&from=maker(&classId=...)
     ─────────────────────────────────────────────────────────────
     열기 방식: 명시적 window.open() — 감상 화면 다듬기와 통일.
     <a target="_blank"> 기본 클릭은 브라우저에 따라 window.opener=null로
     세팅되어 close()가 실패할 수 있음 → preventDefault + window.open() 강제. */
  function _updateViewerLink() {
    const link = document.getElementById('btn-open-viewer');
    if (!link) return;
    const name = teamName ? encodeURIComponent(teamName) : '';
    const cid  = classId  ? `&classId=${encodeURIComponent(classId)}` : '';
    const url  = name ? `viewer.html?team=${name}&from=maker${cid}` : 'viewer.html';
    /* href는 사용자에게 url 미리보기/우클릭용으로만 유지 */
    link.href = url;
    /* 기본 클릭 차단 + 명시적 window.open — opener 관계 유지 보장 */
    link.onclick = (e) => {
      e.preventDefault();
      if (!teamName) { alert('먼저 팀 이름으로 입장해 주세요.'); return; }
      flushTitleSaves();           // 열기 직전 저장 flush
      _saveReturnContext('maker'); // 복귀 context 저장
      window.open(url, '_blank');
    };
  }
  /* teamName이 설정될 때 업데이트 — firebase.js의 joinTeam 후 호출되도록
     MutationObserver로 team-label 변화를 감지 */
  const _teamLabelEl = document.getElementById('team-label');
  if (_teamLabelEl) {
    new MutationObserver(_updateViewerLink)
      .observe(_teamLabelEl, { childList: true, characterData: true, subtree: true });
  }
  _updateViewerLink();

  /* 초기 모드 */
  document.body.classList.add('beginner-mode');

  /* DATA_PATH_VERSION에 따라 클래스 코드 입력 필드 표시/숨김
     v1: 숨김 (기존 동작 유지)
     v2: 표시 (클래스 코드 필수) */
  if (typeof DATA_PATH_VERSION !== 'undefined' && DATA_PATH_VERSION === 'v2') {
    document.getElementById('join-code-wrap')?.style && (
      document.getElementById('join-code-wrap').style.display = ''
    );
    /* v2에서는 join-code → join-input → join-pin 순으로 포커스 이동 */
    document.getElementById('join-code')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('join-input')?.focus();
    });
  }

  /* ?admin=1 query param — 교사 관리 진입
     ─────────────────────────────────────────────────────────────
     Firebase Auth 단일 진입 경로:
       teacher/super_admin → _enterAdminDirect()
       비로그인 or role 없음 → teacher-auth.html 이동

     구형 admin/pw fallback 제거됨.
     ─────────────────────────────────────────────────────────────*/
  if (new URLSearchParams(location.search).get('admin') === '1') {
    const unsubscribe = auth.onAuthStateChanged(async user => {
      unsubscribe();  // 1회만 실행

      if (user) {
        const tokenResult = await user.getIdTokenResult();
        const role = tokenResult.claims.role ?? null;
        if (role === 'teacher' || role === 'super_admin') {
          _enterAdminDirect();
          return;
        }
      }

      /* 비로그인 또는 role 없음 → teacher-auth.html로 이동 */
      window.location.href = 'teacher-auth.html';
    });
  }

  /* ?team=팀이름 query param — 교사 관리 화면의 🛠 수정 버튼 경유 진입
     팀 이름만 자동 채우고, PIN은 사용자가 직접 입력하게 함
     joinTeam() 자동 호출 금지 */
  const _teamParam = new URLSearchParams(location.search).get('team');
  if (_teamParam) {
    const joinInput = document.getElementById('join-input');
    const joinPin   = document.getElementById('join-pin');
    if (joinInput) {
      joinInput.value = _teamParam;
      joinPin?.focus();
    }
  }

  /* ================================================================
     maker auto-resume — viewer/edit에서 close 실패 fallback으로 돌아왔을 때
     sessionStorage의 makerSession으로 재입장 화면 건너뛰기
     ─────────────────────────────────────────────────────────────
     조건: ?resume=1 query + sessionStorage.makerSession 존재
     세션 저장은 같은 탭 내에서만 유효 — 탭 닫히면 즉시 소멸
     TTL 2시간 — 너무 오래된 세션은 무시
     PIN 재검증은 _resumeTeamFromSession에서 수행 (보안)
     ================================================================ */
  const _resumeParam = new URLSearchParams(location.search).get('resume');
  if (_resumeParam === '1') {
    try {
      const raw = sessionStorage.getItem('makerSession');
      if (raw) {
        const ctx = JSON.parse(raw);
        const MAX_AGE = 2 * 60 * 60 * 1000; // 2시간
        const fresh = ctx && ctx.pin && ctx.teamName
                   && (Date.now() - (ctx.savedAt || 0) < MAX_AGE);

        if (fresh && typeof _resumeTeamFromSession === 'function') {
          /* 입장 화면을 즉시 숨겨두고 복원 시도 — 플래시 방지 */
          const joinScreen = document.getElementById('join-screen');
          if (joinScreen) joinScreen.classList.add('hidden');

          _resumeTeamFromSession(ctx).then(ok => {
            if (!ok && joinScreen) {
              /* 실패 시 원복 — 사용자가 수동 재입장 */
              joinScreen.classList.remove('hidden');
              sessionStorage.removeItem('makerSession');
            }
          });
        }
      }
    } catch (e) { /* 실패해도 일반 입장 화면 유지 */ }
  }
});
