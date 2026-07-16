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
  /* 브랜치 캔버스 흐름(source 'maker')에서만 viewport 1회 복원 상태 캡처.
     _saveReturnContext('maker')는 ui.js·sceneRenderer의 브랜치→viewer/maker 이동에서만
     호출됨(admin·모바일텍스트는 직접 write라 제외) → 캔버스 상태에 정확 스코프. */
  if (source === 'maker') _captureBranchViewportState();
}

/* ── BRANCH-VIEWPORT-RESTORE: 브랜치 복귀 시 선택 장면·pan·zoom 1회 복원 ──
   저장소 = sessionStorage(탭 스코프, 같은 탭 내비에서만 유효·탭 닫히면 소멸).
   DB/localStorage 영구 저장 안 함. */
var BVR_KEY = 'branchViewportReturn';

function _captureBranchViewportState() {
  try {
    if (typeof teamName === 'undefined' || !teamName) return; /* 캔버스 없음 → 캡처 안 함 */
    var cur = document.querySelector('.scene-card.is-current');
    var sid = (cur && cur.id) ? cur.id.replace('card-', '') : null;
    sessionStorage.setItem(BVR_KEY, JSON.stringify({
      classId:        (typeof classId !== 'undefined') ? (classId || null) : null,
      teamName:       teamName,
      projectType:    (typeof selectedProjectType !== 'undefined') ? (selectedProjectType || null) : null,
      selectedSceneId: sid,
      panX: (typeof canvasOffX !== 'undefined') ? canvasOffX : 0,
      panY: (typeof canvasOffY !== 'undefined') ? canvasOffY : 0,
      zoom: (typeof zoom !== 'undefined') ? zoom : 1,
      createdAt: Date.now(),
    }));
  } catch (e) { /* 캡처 실패는 무시 — 복귀해도 기본 위치일 뿐 */ }
}

/* renderAll() 끝에서 호출. 1회성 — 성공/실패 무관하게 끝에 키 제거. */
function _restoreBranchViewportOnce() {
  var raw;
  try { raw = sessionStorage.getItem(BVR_KEY); } catch (e) { return; }
  if (!raw) return;

  /* 복귀일 때만(=URL ?resume=1). 일반 F5·홈진입·직접URL·새 프로젝트엔 resume 없음 → 미적용. */
  var isReturn = false;
  try { isReturn = (new URLSearchParams(location.search).get('resume') === '1'); } catch (e) {}
  if (!isReturn) return; /* 키는 같은 탭 다음 캡처에서 덮어쓰이거나 탭 종료 시 소멸 */

  /* 여기부터는 1회 소비 — 어떤 경로로 빠져도 키 제거 */
  try { sessionStorage.removeItem(BVR_KEY); } catch (e) {}

  var st;
  try { st = JSON.parse(raw); } catch (e) { return; }
  if (!st) return;

  /* 프로젝트·팀 일치(다른 작품에 잘못 적용 방지). createdAt 단순 만료(60분). */
  var curTeam = (typeof teamName !== 'undefined') ? (teamName || null) : null;
  var curCls  = (typeof classId  !== 'undefined') ? (classId  || null) : null;
  if (st.teamName !== curTeam) return;
  if ((st.classId || null) !== (curCls || null)) return;
  if (typeof st.createdAt === 'number' && (Date.now() - st.createdAt) > 60 * 60 * 1000) return;

  /* zoom 적용 (숫자 + clamp 0.3~2.0). */
  if (typeof zoom !== 'undefined' && typeof st.zoom === 'number' && isFinite(st.zoom)) {
    zoom = Math.min(2.0, Math.max(0.3, st.zoom));
  }
  /* pan 적용 (숫자만). 화면 크기가 달라져도 카드 DOM은 유지되므로 캔버스가 완전히 사라지진 않음. */
  if (typeof canvasOffX !== 'undefined' && typeof st.panX === 'number' && isFinite(st.panX)) canvasOffX = st.panX;
  if (typeof canvasOffY !== 'undefined' && typeof st.panY === 'number' && isFinite(st.panY)) canvasOffY = st.panY;
  if (typeof applyTransform === 'function') { try { applyTransform(); } catch (e) {} }

  /* 선택 장면 복원 — 부작용 없는 .is-current 클래스만 재적용(panToCard 재호출 X = pan 덮어쓰기 방지).
     현재 그래프에 카드가 없으면 생략. */
  if (st.selectedSceneId) {
    var card = document.getElementById('card-' + st.selectedSceneId);
    if (card) {
      try {
        document.querySelectorAll('.scene-card.is-current').forEach(function (c) { c.classList.remove('is-current'); });
        card.classList.add('is-current');
      } catch (e) {}
    }
  }
}

/* 🌿 처음으로/모둠 바꾸기 등 — 복귀 아닌 이동 시 예약 상태 제거(처음으로에 복원 안 남게). */
function _clearBranchViewportReturn() {
  try { sessionStorage.removeItem(BVR_KEY); } catch (e) {}
}

/* ================================================================
   PWA-NAV: 같은 가지 화면(maker↔viewer 등) 내부 이동 헬퍼
   ─────────────────────────────────────────────────────────────
   실행 환경(설치앱·Android Chrome·iPad Safari·데스크톱·기타 브라우저)과
   무관하게 내부 화면은 항상 같은 창에서 이동 — 새 탭/새 브라우저 창 0.
   같은 창 이동이라 opener 미생성 → viewer의 _returnToMaker가 location.href
   fallback 경로로 안전 복귀(branchReturnContext·resume=1·source 보존).
   내부(같은 scope·상대경로) URL에만 사용. 외부 링크엔 쓰지 않음(target=_blank 유지).
   ================================================================ */
function _openInternalUrl(url) {
  window.location.href = url;
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
  /* W2-A: choiceCount는 더 이상 maker UI 토글로 변경되지 않음 (1/2 토글 제거).
     updateChoiceLabel이 buttons.length 기준 호환 동기화로 patch에 넣지만,
     이때 nextB/choiceB를 자동으로 비우면 안 됨 — 사용자가 첫 버튼만 입력하는
     중간 상태에서도 두 번째 버튼 데이터가 손상되기 때문.
     legacy 호환 import 등에서 명시적 부작용 필요하면 별도 함수로. */
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

  /* legacy 매핑 보존 (단계 2 잔여 결함 수정):
     legacy 작품은 처음 로드 시 _hasBody=false + body=title 매핑된 상태.
     이 상태에서 사용자가 제목만 수정하고 push되면 body 키가 DB에 안 저장되어,
     다음 로드 시 매핑이 다시 발동하여 본문이 새 제목으로 덮임.
     → 사용자가 제목을 수정하는 순간 _hasBody=true로 확정 = 매핑된 body가
     DB에 정식 저장되어 보존됨. legacy → 새 구조 전환점. */
  const s = scenes[num];
  if (s._hasBody === false) {
    s._hasBody = true;
  }

  /* 1. 즉시 로컬 반영 — await 없음, 동기 */
  s.title = val;
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

/* ================================================================
   updateBody — title/body 분리 (단계 2)
   ─────────────────────────────────────────────────────────────
   maker canvas 카드에서 본문(scene.body) 직접 편집을 위한 debounced 저장.
   updateTitle과 같은 패턴: 즉시 로컬 반영 + 400ms debounce + blur flush.
   본문은 v0.3 모드 감상에서 시각 중심 — viewer-edit과 양방향 동기화 보장.
   ================================================================ */
const _bodySaveTimers = {};   // num → timeoutId
const _bodyDirty      = new Set();

function updateBody(num, val) {
  if (!scenes[num]) return;

  /* 본문 명시 편집 — _hasBody=true 확정 (단계 2 잔여 결함 수정).
     이 시점부터 DB에 body 필드가 정식 저장되며, snapshot 매핑이 더 이상 발동 안 함. */
  scenes[num]._hasBody = true;

  /* 1. 즉시 로컬 반영 */
  scenes[num].body = val;
  _bodyDirty.add(num);

  /* 2. 내 편집 세션 있을 때만 저장 예약 — title과 같은 정책 */
  if (!activeEdits[num]) return;
  touchEdit(num);

  /* 3. 저장 debounce */
  clearTimeout(_bodySaveTimers[num]);
  _bodySaveTimers[num] = setTimeout(() => {
    delete _bodySaveTimers[num];
    if (_bodyDirty.has(num)) {
      _bodyDirty.delete(num);
      pushToFirebase(num);
    }
  }, 400);
}

/* 강제 flush — blur / 장면 전환 / preview·viewer 열기 / 페이지 이탈 */
function flushBodySaves(num) {
  if (num !== undefined) {
    clearTimeout(_bodySaveTimers[num]);
    delete _bodySaveTimers[num];
    if (_bodyDirty.has(num)) {
      _bodyDirty.delete(num);
      pushToFirebase(num);
    }
    return;
  }
  /* 전체 flush */
  const keys = Object.keys(_bodySaveTimers);
  keys.forEach(k => {
    clearTimeout(_bodySaveTimers[k]);
    delete _bodySaveTimers[k];
  });
  if (_bodyDirty.size > 0) {
    const nums = Array.from(_bodyDirty);
    _bodyDirty.clear();
    nums.forEach(n => pushToFirebase(n));
  }
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

/* 페이지 이탈 시 강제 flush — title + body 둘 다 */
window.addEventListener('beforeunload', () => { flushTitleSaves(); flushBodySaves(); });
window.addEventListener('pagehide',    () => { flushTitleSaves(); flushBodySaves(); });

/* ================================================================
   CARD-QUICK-EDIT-1 — 카드 본문 미리보기 클릭 → 미니모달 '장면 글 고치기'
   ─────────────────────────────────────────────────────────────
   · 카드 크기 고정 원칙: 인라인 확장 대신 작은 모달로 원본 scene.body만 수정.
   · AI 장면발전(s2)/글 보기 토글과 무관 — aiVariants·textSelections 경로 접근 0.
   · 저장 = 기존 updateBody + flushBodySaves 재사용(잠금·debounce·_hasBody 정책 동일).
   · 취소/ESC/배경 클릭 = 변경 없음. 저장 시 카드 미리보기·숨은 textarea 동기.
   ================================================================ */
function showBodyQuickEditModal(num) {
  const s = scenes[num];
  if (!s || s.type === 'cover') return;
  if (typeof isLockedByOther === 'function' && isLockedByOther(num)) {
    alert('다른 사람이 이 장면을 편집하고 있어요.');
    return;
  }
  document.querySelector('.body-quickedit-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'body-quickedit-overlay';
  overlay.innerHTML = `
    <div class="body-quickedit-card" role="dialog" aria-modal="true" aria-label="장면 글 고치기">
      <div class="body-quickedit-head">
        <h3>✏️ 장면 ${num} 글 고치기</h3>
        <button type="button" class="body-quickedit-close" aria-label="닫기">✕</button>
      </div>
      <textarea class="body-quickedit-ta" placeholder="장면에서 일어나는 일을 적어 보세요."></textarea>
      <div class="body-quickedit-hint">AI 장면발전 글이 아니라, 학생이 직접 쓰는 원본 글을 고칩니다.</div>
      <div class="body-quickedit-actions">
        <button type="button" class="body-quickedit-cancel">취소</button>
        <button type="button" class="body-quickedit-save">저장</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const ta = overlay.querySelector('.body-quickedit-ta');
  ta.value = String(s.body || '');   /* .value 대입 — 이스케이프 이슈 0 */

  /* 잠금은 모달을 먼저 열고 백그라운드 확보(스냅한 UX) — 실패 시 닫고 안내 */
  let lockOk = null;
  const lockP = (typeof ensureEditable === 'function') ? ensureEditable(num) : Promise.resolve(true);
  lockP.then(ok => {
    lockOk = !!ok;
    if (!ok && document.body.contains(overlay)) {
      close(false);
      alert('다른 사람이 이 장면을 편집하고 있어요.');
    }
  });

  function close(save) {
    if (save) {
      const val = ta.value;
      updateBody(num, val);
      flushBodySaves(num);
      /* 카드 숨은 textarea + 접힌 미리보기 동기(전체 재렌더 없이) */
      const cardEl = document.getElementById('card-' + num);
      if (cardEl) {
        const hiddenTa = cardEl.querySelector('.js-body-input');
        if (hiddenTa) hiddenTa.value = val;
        if (typeof _pbSyncPreviewFromTextarea === 'function') _pbSyncPreviewFromTextarea(cardEl);
      }
    }
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }
  function onKey(e) { if (e.key === 'Escape') close(false); }

  overlay.querySelector('.body-quickedit-save').addEventListener('click', () => {
    if (lockOk === false) { close(false); return; }
    close(true);
  });
  overlay.querySelector('.body-quickedit-cancel').addEventListener('click', () => close(false));
  overlay.querySelector('.body-quickedit-close').addEventListener('click', () => close(false));
  overlay.addEventListener('pointerdown', e => e.stopPropagation());   /* 캔버스 팬/줌으로 전파 차단 */
  /* CARD-QUICKEDIT-NOBACKDROP(2026-07-09): 바깥(백드롭) 클릭으로 닫지 않음 — 글 입력 중 여백 오탭으로
     입력이 유실되던 문제. 닫기는 취소/✕/저장/ESC로만. (pointerdown stopPropagation은 유지) */
  document.addEventListener('keydown', onKey);
  ta.focus();
  try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) { /* noop */ }
}

/* ENDING-GUARD-1: drawArrows()와 동일한 우선순위로 "뒤로 이어지는 연결" 유무 판정.
   buttons[]가 있으면 buttons[i].nextId(앞 6개), 없으면 legacy nextA/(choiceCount>1 시)nextB.
   화면 화살표가 그려지는 조건과 정확히 일치 → 안내가 사용자 눈에 보이는 연결과 어긋나지 않음. */
function _sceneHasOutgoingLink(s) {
  if (!s) return false;
  const buttons = Array.isArray(s.buttons) ? s.buttons : [];
  if (buttons.length > 0) {
    return buttons.slice(0, 6).some(b => b && b.nextId);
  }
  if (s.nextA) return true;
  if (s.nextB && (s.choiceCount || 2) > 1) return true;
  return false;
}

async function updateType(num, type) {
  /* ENDING-GUARD-1: 일반→엔딩 전환 시, 뒤로 이어지는 연결이 남아 있으면 차단.
     · normal → ending 전환만 막음. 이미 ending인 장면을 일반으로 되돌리는 건 허용.
     · 연결(buttons[].nextId)·뒤 장면을 자동으로 지우지 않음 — 먼저 연결을 지우라고 안내만.
     · 라디오가 시각적으로 '엔딩'에 튀어 있으므로 실제 type으로 renderCard 복원. */
  const s = scenes[num];
  if (s && type === 'ending' && s.type !== 'ending' && _sceneHasOutgoingLink(s)) {
    if (typeof renderCard === 'function') renderCard(s);
    const title = '아직 뒤로 이어져 있어요';
    const message = '이 장면은 다음 장면으로 이어지는 길이 남아 있어요.\n\n'
      + '엔딩으로 바꾸려면 먼저 이 장면의 ‘다음으로 가기’ 연결을 지워 주세요.';
    if (window.showMakerConfirm) {
      try { await window.showMakerConfirm({ title, message, confirmText: '알겠어요', cancelText: '닫기' }); }
      catch (_) {}
    } else {
      alert(title + '\n\n' + message);
    }
    return;
  }
  await mutateScene(num, { type }, { needsArrows: true });
}

async function updateTrueEnding(num, val) {
  await mutateScene(num, { trueEnding: val });
}

async function updateChoiceCount(num, cnt) {
  await mutateScene(num, { choiceCount: cnt }, { needsArrows: true });
}

async function updateChoiceLabel(num, port, val) {
  /* 선택지 라벨은 카드 재렌더 없이 화살표만 갱신.
     buttons[] 우선 동기화 (W2-B-β: N개 port 인식):
     · port → 인덱스 ('A'→0, 'B'→1, 'C'→2, ...)
     · 라벨이 buttons[idx]에 없으면 새 항목 만들어 추가
     · 첫 2개는 choiceA/B 호환 키도 patch (1단계 양방향 동기화 정책 유지)
     W6: 체험전시형은 connectObjects[].label 사용 — buttons[] 흐름 X. */
  const s = scenes[num];
  if (!s) return;

  /* port → 인덱스 변환 (대문자 알파벳 → 0-5). 잘못된 port면 무시 */
  const idx = (typeof port === 'string') ? port.charCodeAt(0) - 65 : -1;
  if (idx < 0 || idx > 5) return;

  /* W6 체험전시형 분기 — connectObjects[realIdx].label 갱신 */
  const _ptype = (typeof projectMeta !== 'undefined' && projectMeta && projectMeta.projectType) || null;
  if (_ptype === 'experience') {
    const allCo = Array.isArray(s.connectObjects) ? [...s.connectObjects] : [];
    /* back/home 제외 인덱스만 카드 포트로 노출됨 — 그 순서의 idx에 매핑 */
    const eligibleIdxs = [];
    allCo.forEach((co, i) => {
      if (co && co.type !== 'back' && co.type !== 'home') eligibleIdxs.push(i);
    });
    if (idx >= eligibleIdxs.length) return;
    const realIdx = eligibleIdxs[idx];
    /* 라벨 max 20자 (체험전시형 정책) */
    const safeLabel = String(val || '').slice(0, 20);
    allCo[realIdx] = { ...allCo[realIdx], label: safeLabel };
    await mutateScene(num, { connectObjects: allCo }, { skipCardRender: true, needsArrows: false, silent: true });
    return;
  }

  /* legacy choiceA/B 호환 patch — 첫 2개만 */
  const patch = {};
  if (idx === 0) patch.choiceA = val;
  else if (idx === 1) patch.choiceB = val;

  /* buttons[] 갱신 — 없으면 만들고, 있으면 해당 인덱스 업데이트.
     idx 미만 인덱스가 비어있으면 빈 객체로 채움 (legacy fallback 적용) */
  const currentButtons = Array.isArray(s.buttons) ? [...s.buttons] : [];
  while (currentButtons.length <= idx) {
    const i = currentButtons.length;
    const legacyNext  = i === 0 ? s.nextA : i === 1 ? s.nextB : null;
    const legacyLabel = i === 0 ? (s.choiceA || '') : i === 1 ? (s.choiceB || '') : '';
    currentButtons.push({
      id: String.fromCharCode(65 + i),
      label: legacyLabel,
      ...(legacyNext ? { nextId: String(legacyNext) } : {}),
    });
  }
  currentButtons[idx] = {
    ...currentButtons[idx],
    id: currentButtons[idx].id || String.fromCharCode(65 + idx),
    label: val,
  };
  patch.buttons = currentButtons;

  /* choiceCount 호환 동기화 — buttons.length 기준 */
  patch.choiceCount = currentButtons.length === 1 ? 1 : 2;

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
  /* CONTEST-FIX-1(2026-07-10): 번호 바꾸기가 legacy nextA/B만 재매핑해 buttons[].nextId·
     connectObjects[].nextId·시작점(entry/replay)이 옛 번호에 남아 연결(화살표)이 끊기던 버그 —
     deleteScene과 동일한 참조 정리 로직으로 전 참조 재매핑. */
  const numStr = String(num), newNumStr = String(newNum);
  Object.values(scenes).forEach(sc => {
    if (sc.nextA === num || sc.nextA === numStr) sc.nextA = newNum;
    if (sc.nextB === num || sc.nextB === numStr) sc.nextB = newNum;
    if (Array.isArray(sc.buttons)) {
      sc.buttons.forEach(b => {
        if (b && (b.nextId === num || b.nextId === numStr)) b.nextId = newNumStr;
      });
    }
    if (Array.isArray(sc.connectObjects)) {
      sc.connectObjects.forEach(co => {
        if (co && (co.nextId === num || co.nextId === numStr)) co.nextId = newNumStr;
      });
    }
  });
  if (typeof projectMeta === 'object' && projectMeta) {
    if (String(projectMeta.entrySceneId)  === numStr) projectMeta.entrySceneId  = newNumStr;
    if (String(projectMeta.replaySceneId) === numStr) projectMeta.replaySceneId = newNumStr;
  }
  releaseLock(num);
  _afterMutation();
}

async function deleteScene(num) {
  const ok = window.showMakerConfirm
    ? await window.showMakerConfirm({
        title: '장면을 삭제할까요?',
        message: '이 장면을 삭제하면 되돌릴 수 없어요.',
        confirmText: '삭제하기',
        danger: true,
      })
    : confirm(`장면 ${num}을(를) 삭제할까요?\n삭제한 뒤에는 되돌릴 수 없어요.`);
  if (!ok) return;
  if (!await ensureEditable(num)) {
    alert(`다른 사람이 장면 ${num}을(를) 편집 중이에요.`); return;
  }
  releaseLock(num);
  removeSceneFromFirebase(num);
  delete scenes[num];
  /* W7 번호 재사용 안전성: 삭제된 번호를 가리키는 모든 참조 끊기.
     이전엔 nextA/nextB만 정리 → buttons[i].nextId 남아있어 번호 재사용 시
     새 장면이 옛 흐름에 연결되는 버그. 사용자 결정: "버그없게 수정". */
  const numStr = String(num);
  Object.values(scenes).forEach(s => {
    if (s.nextA === num || s.nextA === numStr) s.nextA = '';
    if (s.nextB === num || s.nextB === numStr) s.nextB = '';
    if (Array.isArray(s.buttons)) {
      s.buttons.forEach(b => {
        if (b && (b.nextId === num || b.nextId === numStr)) b.nextId = null;
      });
    }
    /* 체험전시형 connectObjects.nextId도 정리 */
    if (Array.isArray(s.connectObjects)) {
      s.connectObjects.forEach(co => {
        if (co && (co.nextId === num || co.nextId === numStr)) co.nextId = null;
      });
    }
  });
  /* entrySceneId / replaySceneId가 삭제된 장면을 가리키면 null로 (시작점 잃음) */
  if (projectMeta) {
    if (projectMeta.entrySceneId  === numStr) projectMeta.entrySceneId  = null;
    if (projectMeta.replaySceneId === numStr) projectMeta.replaySceneId = null;
  }
  _afterMutation();
}

function clearAll() {
  /* 반드시 확인창 먼저 — 확인 전 아무 삭제 없음. Undo 제거됨 → 되돌릴 수 없음.
     BTN-CLEANUP-1(2026-07-10): confirm 1회 → 타이핑 확인으로 강화 — 팀 작품 전체가
     사라지는 파괴적 동작이라 "전체 초기화"를 직접 입력해야만 실행. */
  const typed = prompt('⚠️ 모든 장면이 삭제되고 되돌릴 수 없어요!\n정말 처음부터 다시 시작하려면 아래 칸에 "전체 초기화"라고 똑같이 써 주세요.');
  if (typed === null) return;                       /* 취소 */
  if (typed.trim() !== '전체 초기화') {
    alert('입력한 글자가 달라서 초기화하지 않았어요. (작품은 그대로예요)');
    return;
  }
  scenes = {}; nextNum = 1;
  _afterMutation();
}

/* ── 파일 I/O ── */
function exportJSON() {
  /* sentinel 키(_hasBody 등) 제외 — DB 저장 형태와 일관 (firebase.js _sceneToDbShape와 동일 정책).
     legacy 상태(_hasBody=false)면 body 키도 제외해 import 시 자동 재인식. */
  const cleanScenes = {};
  Object.keys(scenes).forEach(k => {
    const s = scenes[k];
    if (!s || typeof s !== 'object') return;
    const out = { ...s };
    delete out._hasBody;
    if (s._hasBody === false) delete out.body;
    cleanScenes[k] = out;
  });
  const data = { teamName, savedAt: new Date().toISOString(), scenes: cleanScenes };
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

      /* 들어온 데이터에 _hasBody 자동 갱신 (firebase snapshot 매핑과 동일 정책).
         legacy import 시 body 필드 없는 장면은 _hasBody=false로 표시되어
         viewer adaptScenes의 fallback 매핑이 정상 동작. */
      Object.keys(scenes).forEach(numKey => {
        const s = scenes[numKey];
        if (!s || typeof s !== 'object') return;
        const hasBodyField = Object.prototype.hasOwnProperty.call(s, 'body') &&
                             s.body !== null && s.body !== undefined;
        s._hasBody = hasBodyField;
      });

      const nums = Object.keys(scenes).map(Number);
      if (nums.length) nextNum = Math.max(...nums) + 1;
      _afterMutation();
      alert(`✅ "${file.name}" 불러오기 완료!`);
    } catch (err) {
      console.error('[ui] 가지 파일 불러오기 실패:', err);
      alert('❌ 올바른 가지 파일이 아니에요.');
    }
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

/* ── 작품 유형 선택 (1단계 신규) ──
   기본값은 DEFAULT_PROJECT_TYPE (state.js, 'picturebook').
   _enterTeam에서 새 작품일 경우 이 값을 viewer-meta/projectType에 저장.
   기존 작품은 viewer-meta 구독에서 읽어오는 값이 우선. */
let selectedProjectType = (typeof DEFAULT_PROJECT_TYPE === 'string') ? DEFAULT_PROJECT_TYPE : 'picturebook';
function selectProjectType(ptype) {
  if (!Array.isArray(PROJECT_TYPES) || !PROJECT_TYPES.includes(ptype)) return;
  selectedProjectType = ptype;
  document.querySelectorAll('[data-ptype]').forEach(btn => {
    const active = btn.dataset.ptype === ptype;
    btn.style.border     = active ? '2px solid var(--primary)' : '2px solid #d0e0f5';
    btn.style.background = active ? '#e8f0ff' : '#fff';
    btn.style.color      = active ? 'var(--primary)' : 'var(--text)';
  });
}

/* ================================================================
   W6 신규 흐름: 작품 유형 선택 화면 (입장 후)
   ─────────────────────────────────────────────────────────────
   · firebase._enterTeam에서 호출 — viewer-meta/projectType 조회 후
   · 기존 유형 있으면 그 카드만 강조 ("이전 선택" 배지)
   · 사용자가 다른 카드 누르면 confirm: "이전에 X형으로 만들어졌어요. X형으로 들어갈까요?"
     → "X형으로 들어가기" = 기존 유형 사용 + maker 진입
     → "취소" = 화면 머무름 (사용자가 다시 결정)
   · 사용자가 같은 카드 누르면 즉시 진입
   · 신규 작품(existingType 없음)이면 어떤 카드 눌러도 confirm 없음 — 즉시 진입
   ================================================================ */
let _ptypeExistingType = null;   /* firebase에서 로드된 기존 유형 */

function showPtypeScreen(existingType) {
  _ptypeExistingType = existingType || null;
  const screen = document.getElementById('ptype-screen');
  if (!screen) return;
  /* 기존 유형 카드만 "이전 선택" 강조 */
  document.querySelectorAll('#ptype-grid .ptype-card').forEach(c => {
    c.classList.toggle('previously-selected',
      _ptypeExistingType && c.dataset.ptype === _ptypeExistingType);
  });
  /* v40: 받기 카드는 빈 슬롯일 때만 활성 — 기존 작품이면 흐리게 */
  const receiveCard = document.getElementById('ptype-receive-copy');
  if (receiveCard) receiveCard.classList.toggle('is-disabled', !!_ptypeExistingType);
  screen.classList.add('show');
}
function hidePtypeScreen() {
  const screen = document.getElementById('ptype-screen');
  if (screen) screen.classList.remove('show');
}

function _onPtypeCardClick(clickedType) {
  if (!Array.isArray(PROJECT_TYPES) || !PROJECT_TYPES.includes(clickedType)) return;
  const _LABEL = { text: '텍스트형', picturebook: '그림책형', movie: '무비형', experience: '체험전시형' };

  /* W7 projectType 강제 lock — 4개 모드 모두 동일 적용.
     · 텍스트형 → 다른 모드 카드 클릭 차단
     · 그림책형 → 다른 모드 카드 클릭 차단
     · 무비형 → 다른 모드 카드 클릭 차단
     · 체험전시형 → 다른 모드 카드 클릭 차단
     사용자 결정: "무비뿐만아니라 텍스트에서도 가면안되고, 전시형에서도 가면안되는거야".
     기존 모드 무엇이든 다른 모드 카드 클릭 시 무조건 기존 모드 강제 진입. */
  if (_ptypeExistingType && _ptypeExistingType !== clickedType) {
    alert(
      '이 작품은 「' + (_LABEL[_ptypeExistingType] || _ptypeExistingType) + '」 모드로 만들어졌어요.\n' +
      '작품 유형은 만들 때 한 번 정해지면 바뀌지 않아요.\n\n' +
      '다른 모드로 만들고 싶으면 새 작품을 만들어주세요.\n\n' +
      '「' + (_LABEL[_ptypeExistingType] || _ptypeExistingType) + '」 모드로 들어갑니다.'
    );
    selectProjectType(_ptypeExistingType);
    _enterMakerAfterPtypeSelected(_ptypeExistingType);
    return;
  }

  /* 기존 유형 없음 (신규 작품) 또는 같은 유형 클릭 — 즉시 진입 */
  /* MODE-CONFIRM-1(2026-07-16): 신규 선택(기존 유형 없음)일 때만 1회 확인 — 유형은 한 번 정하면 못 바꿈.
     같은 유형 재클릭(_ptypeExistingType === clickedType)은 기존 작품 재진입이라 확인 없이 즉시 진입(기존 동작 유지). */
  if (!_ptypeExistingType) {
    var _ok = true;
    try {
      _ok = window.confirm(
        '「' + (_LABEL[clickedType] || clickedType) + '」 모드로 시작할까요?\n' +
        '작품 유형은 한 번 정하면 바꿀 수 없어요. 이 모드로 계속 만들게 돼요.'
      );
    } catch (e) { _ok = true; }   /* confirm 불가 환경 → 기존대로 진입(회귀 0) */
    if (!_ok) return;             /* 취소 → 진입하지 않음 */
  }
  selectProjectType(clickedType);
  _enterMakerAfterPtypeSelected(clickedType);
}

/* HOTFIX(생각 나침반 결과 보기): 🧭 toolbar 버튼 노출 갱신.
   · 표시 조건: 그림책/텍스트 작품 + 생각 나침반 기록 실제 존재(완료 or 진행 중 or 답변/완료시각).
     기록 없는(미시작) 작품은 숨김. 공개 감상엔 이 버튼/화면 자체가 없음.
   · classId+teamName 키 가드 → 같은 작품 재호출 시 DB read 생략(renderAll서 매번 호출돼도 저비용).
   · 읽기 전용 ThoughtCompassReview 재사용 — 시작/재생성/배정 없음. */
let _compassBtnLastKey = null;
async function _updateCompassResultButton() {
  const btn = document.getElementById('btn-compass-result');
  if (!btn) return;
  const hasCls = typeof classId === 'string' && classId && typeof teamName === 'string' && teamName;
  const pt = (typeof projectMeta !== 'undefined' && projectMeta && projectMeta.projectType)
    || (typeof selectedProjectType === 'string' ? selectedProjectType : null);
  const key = hasCls ? (classId + '::' + teamName) : null;
  if (!hasCls || (pt !== 'text' && pt !== 'picturebook')
      || !window.ThoughtCompassStore || !window.ThoughtCompassReview
      || typeof window.ThoughtCompassStore.loadThoughtCompassStateResult !== 'function') {
    btn.style.display = 'none'; _compassBtnLastKey = key; return;
  }
  if (key === _compassBtnLastKey) return;   /* 같은 작품 재확인 안 함 */
  _compassBtnLastKey = key;
  try {
    const r = await window.ThoughtCompassStore.loadThoughtCompassStateResult({ classId: classId, teamName: teamName, projectType: pt });
    const raw = r && r.raw;
    const hasRecord = !!(raw && (
      raw.status === 'completed' || raw.status === 'inProgress' || typeof raw.completedAt === 'number'
      || (raw.answers && typeof raw.answers === 'object' && Object.keys(raw.answers).length > 0)));
    /* 키가 바뀌지 않았을 때만 반영(비동기 사이 팀 전환 방지) */
    if (key === _compassBtnLastKey) btn.style.display = hasRecord ? '' : 'none';
  } catch (_) { if (key === _compassBtnLastKey) btn.style.display = 'none'; }
}
if (typeof window !== 'undefined') window._updateCompassResultButton = _updateCompassResultButton;

/* ─────────────────────────────────────────────────────────────
   TUTORIAL(maker 코치마크): 신규 작품 진입 시 환영 모달 뒤 6요소를 코치로 안내.
   ②(refine, viewer-entry.js __maybeRunRefineTutorial)와 '동일 패턴' — 환영에서 skip/dontShow면
   코치 억제, 진행이면 코치 표시. 환영 dismiss 키('tutorial_welcome')를 코치와 공유해 한 번의
   skip/dontShow로 환영·코치 둘 다 억제(refine이 'tutorial_refine'를 공유하는 것과 대칭).
   · maker 환영은 두 곳에서 뜸: (a) ui.js 아래 _enterMakerAfterPtypeSelected(무비/체험/v1/기존재진입),
     (b) 나침반 완료 후 review.js(수정 불가). 둘 다 bare maybeShow → TutorialWelcome.armCoach 시퀄로 통일.
   · 코치 엔진(tutorial-coach.js)은 maker.html에만 로드. 대상이 실재/가시일 때만 뜸(가시성 가드 + rAF/지연·소폭 재시도). */
function _runMakerCoach(ptype) {
  if (typeof window === 'undefined' || !window.TutorialCoach || typeof window.TutorialCoach.run !== 'function') return;
  var _tries = 0;
  var _go = function () {
    _tries++;
    var ready = false;
    try {
      var C = window.TutorialContent;
      var steps = (C && Array.isArray(C.makerCoach)) ? C.makerCoach : [];
      if (ptype) steps = steps.filter(function (s) { return !s.types || s.types.indexOf(ptype) !== -1; });
      ready = steps.some(function (s) { try { return !!document.querySelector(s.sel); } catch (e) { return false; } });
    } catch (e) { ready = false; }
    if (!ready) { if (_tries < 8) setTimeout(_go, 200); return; }   /* 렌더 지연 대비 소폭 재시도 후 포기(과잉 대기 방지) */
    try {
      window.TutorialCoach.run({
        stepsKey: 'makerCoach', keyPrefix: 'tutorial_maker_coach',
        dismissKeyPrefix: 'tutorial_welcome', filterType: ptype || null,
      });
    } catch (e) { /* noop */ }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { setTimeout(_go, 0); });
  else setTimeout(_go, 30);
}
/* 환영(maker) 종료 결과로 코치 표시/억제 결정 — refine과 동일 로직. */
function _makerCoachAfterWelcome(res, ptype) {
  try {
    if (!res || !res.shown) return;                     /* 환영이 안 떴으면(이미 억제) 코치도 그대로 억제 */
    /* AUDIT-B2 SKIP-SCOPE(2026-07-16): '넘어가기'는 이번 진입만 코치 생략(기록 없음 — 다음에 다시 안내),
       '다시 보지 않기'만 영구 dismiss. 종전엔 skip도 기기 전체 영구 억제라 공유 크롬북에서 한 학생의
       넘어가기 1회가 이후 모든 모둠의 환영+코치를 죽였음(사용자 원요청 의미로 복원). */
    if (res.dontShow) {
      if (window.TutorialWelcome && typeof window.TutorialWelcome.markDismissed === 'function') {
        try { window.TutorialWelcome.markDismissed('tutorial_welcome', null); } catch (e) { /* noop */ }
      }
      return;
    }
    if (res.skipped) return;                            /* 이번 진입만 코치 생략 */
    _runMakerCoach(ptype);                              /* 진행(시작하기) → 코치 표시(진행 시 dismiss 미기록 = 매 진입) */
  } catch (e) { /* noop */ }
}
/* 신규 작품 진입 환영 앞에서 1회 arm. 환영(현 진입 또는 나침반 뒤 review.js) 종료 시 시퀄이 위 로직 실행. */
function _armMakerCoach(ptype) {
  try {
    if (window.TutorialWelcome && typeof window.TutorialWelcome.armCoach === 'function') {
      window.TutorialWelcome.armCoach(function (res) { _makerCoachAfterWelcome(res, ptype); });
    }
  } catch (e) { /* noop */ }
}

/* ptype 결정 후 firebase에 저장 + maker 캔버스 노출 */
async function _enterMakerAfterPtypeSelected(ptype) {
  /* W7 projectType lock: viewer-meta/projectType 반드시 기록된 후 maker 진입.
     ─────────────────────────────────────────────────────────────
     저장 케이스:
     1) 신규 작품 — _ptypeExistingType=null → 저장
     2) 옛 작품 (projectType 필드 누락) — _ptypeExistingType=null → 저장 (여기서 lock 첫 기록)
     3) 기존 작품 (projectType 있음) — _ptypeExistingType=valid → 저장 스킵
     ─────────────────────────────────────────────────────────────
     이 흐름이 옛 작품 lock 정상화의 핵심:
     · 사용자 캡처에서 projectType이 undefined인 작품도 이 진입에서 기록됨
     · 다음부턴 viewer-data가 valid한 'movie'를 읽음 → 그림책 fallback 안 함. */
  let savedNewProjectType = false;
  if (!_ptypeExistingType) {
    if (typeof db !== 'undefined' && typeof teamName === 'string' && teamName) {
      try {
        const encodedName = encodeURIComponent(teamName);
        const basePath = (typeof classId === 'string' && classId)
          ? 'classes/' + classId + '/teams/' + encodedName
          : 'teams/' + encodedName;
        try {
          await db.ref(basePath + '/viewer-meta/projectType').set(ptype);
          /* 저장 성공 → 메모리 _ptypeExistingType 갱신 (이번 세션 안 한번 더 클릭해도 저장 스킵) */
          _ptypeExistingType = ptype;
          savedNewProjectType = true;
        } catch (saveErr) {
          alert('작품 유형 저장에 실패했어요. 네트워크를 확인하고 다시 시도해주세요.');
          return;   // ptype 화면 유지 (잘못된 모드로 진입 차단)
        }
      } catch (e) { /* path 구성 실패 — noop, fallback 진입 */ }
    }
  }
  hidePtypeScreen();

  /* COACH-GATE-FIX(2026-07-16): 기존 작품 재진입에서 나침반 게이트가 열렸는지(함수 스코프 플래그) —
     열렸으면 아래 환영/코치를 건너뛴다(게이트 위 표시 방지). */
  let _compassGatedExisting = false;

  /* BASE10-3A: 신규 작품 projectType 저장이 "성공"했고(savedNewProjectType),
     명시 유형이 text/picturebook일 때만 기본 10장면 자동 생성(모달 없음).
     · 기존 작품 재진입(savedNewProjectType=false) → 실행 안 됨
     · movie/experience/기타 → 명시 ptype 필터로 제외
     · 전체삭제 후 빈 작품 / 로딩 전 빈 상태 → 함수 내부 가드(meta 플래그 + once-recheck)로 제외
     자동 생성 실패해도 maker 진입은 정상 진행. */
  if (savedNewProjectType && (ptype === 'text' || ptype === 'picturebook')) {
    /* THOUGHT-COMPASS Phase D: 신규 그림책/텍스트 → 생각 나침반 강제 게이트.
       · 진짜 신규(scenes 비어있음): activateForNewProject가 onboardingVersion:1 부여(required) + 게이트 차단.
         starter 10장면 생성은 나침반 완료(Phase J)로 미룸 — PRD 1.1(생성→나침반→완료→튜토리얼[준비된 장면]).
       · 옛 작품(projectType 필드만 누락 + scenes 존재, STATE-02): 강제하지 않고 기존 진입(optional)으로 처리.
       · controller/foundation 미로드 또는 classId 없음(v1) → 폴백: 기존 즉시 starter 생성(회귀 0). */
    const _hasCompassCtl = !!(window.ThoughtCompassController) && typeof classId === 'string' && classId && typeof teamName === 'string' && teamName;
    const _sceneCount = (typeof scenes === 'object' && scenes) ? Object.keys(scenes).length : 0;
    const _trulyNew = _sceneCount === 0;
    let _compassGated = false;
    if (_hasCompassCtl && _trulyNew && typeof window.ThoughtCompassController.activateForNewProject === 'function') {
      try {
        const _r = await window.ThoughtCompassController.activateForNewProject({ classId: classId, teamName: teamName, projectType: ptype });
        _compassGated = !!(_r && _r.activated);
      } catch (_) { _compassGated = false; }
    } else if (_hasCompassCtl && !_trulyNew && typeof window.ThoughtCompassController.activateForExistingEntry === 'function') {
      /* COACH-GATE-FIX(2026-07-16): 재진입도 게이트 여부를 존중 — 종전엔 반환값을 버려서 나침반
         진행 중(게이트 열림)인데도 아래 환영+코치가 게이트 위에 뜨고 시퀄이 조기 소비됨
         (정작 완료 후엔 코치 미표시). 신규 경로와 동일하게 activated를 받아 처리. */
      try {
        const _r2 = await window.ThoughtCompassController.activateForExistingEntry({ classId: classId, teamName: teamName, projectType: ptype });
        _compassGated = !!(_r2 && _r2.activated);
      } catch (_) { /* noop */ }
    }
    if (_compassGated) { _armMakerCoach(ptype); return; }   /* 게이트가 maker UI 가로챔. 나침반 완료 후 review.js 환영 종료 시 코치. starter는 완료 후 생성. */
    if (typeof window.createStarterTemplateForNewProject === 'function') {
      try { await window.createStarterTemplateForNewProject(ptype); }
      catch (_) { /* noop */ }
    }
  } else if (!savedNewProjectType && (ptype === 'text' || ptype === 'picturebook')
      && window.ThoughtCompassController && typeof window.ThoughtCompassController.activateForExistingEntry === 'function'
      && typeof classId === 'string' && classId && typeof teamName === 'string' && teamName) {
    /* 기존 작품(ptype 화면 경유, projectType 이미 있음) — 진행 중이면 이어서 게이트, 미시작이면 진입 버튼 */
    /* COACH-GATE-FIX(2026-07-16): 여기도 게이트 열림이면 환영/코치를 띄우지 않음(아래 가드). */
    try {
      const _r3 = await window.ThoughtCompassController.activateForExistingEntry({ classId: classId, teamName: teamName, projectType: ptype });
      _compassGatedExisting = !!(_r3 && _r3.activated);
    } catch (_) { /* noop */ }
  }

  /* TUTORIAL-PRD(S2): 환영 모달 — 나침반을 타는 신규 text/pb는 위에서 _compassGated로 return되어
     여기 도달 안 함(그 경로는 나침반 완료 후 review.js가 띄움 = 사용자 결정 "나침반 뒤").
     여기 도달 = 무비/체험/v1(classId 없음)/기존 재진입 → 에디터 진입 시 1회. 기기당 1회·에디터 안 막음. */
  if (_compassGatedExisting) { _armMakerCoach(ptype); return; }   /* COACH-GATE-FIX: 게이트 위 환영 방지 — 완료 후 review.js 환영→시퀄이 코치 처리 */
  if (typeof window !== 'undefined' && window.TutorialWelcome && typeof window.TutorialWelcome.maybeShow === 'function') {
    _armMakerCoach(ptype);   /* 환영 종료 시 시퀄이 코치 표시/억제 결정(무비/체험/v1/기존재진입 경로) */
    try { await window.TutorialWelcome.maybeShow(); } catch (e) { /* noop */ }
  }
}

/* ================================================================
   v40: "다른 모둠 작품 받기" 모달
   ─────────────────────────────────────────────────────────────
   · 빈 슬롯 학생이 4자리 복사 코드 입력 → redeemCopyCode 호출
   · 성공 시 location.reload — viewer-data가 새 작품 로드 + 자연스럽게 maker 진입
   · classId 없는 v1 환경에선 비활성 (안내 후 종료)
   ================================================================ */
function _openReceiveCopyModal() {
  /* v1 환경 차단 — classId 없으면 redeemCopyCode 동작 안 함 */
  if (typeof classId !== 'string' || !classId) {
    alert('이 모둠은 학급 코드로 입장하지 않아 작품을 받을 수 없어요.');
    return;
  }
  if (typeof teamName !== 'string' || !teamName) {
    alert('모둠 정보가 없어요. 다시 입장해주세요.');
    return;
  }

  document.querySelector('.copy-receive-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'copy-code-modal copy-receive-modal';
  overlay.innerHTML = `
    <div class="copy-code-panel">
      <h3 class="copy-code-title">📥 다른 모둠 작품 받기</h3>
      <p class="copy-code-hint">교사 선생님에게 받은 <strong>4자리 코드</strong>를 입력해주세요.</p>
      <input type="text" inputmode="numeric" maxlength="4" class="copy-receive-input js-copy-receive-input"
             placeholder="1234" autocomplete="off"/>
      <p class="copy-receive-err js-copy-receive-err" style="display:none;"></p>
      <div class="copy-code-actions">
        <button class="copy-code-close js-copy-receive-cancel">취소</button>
        <button class="copy-receive-submit js-copy-receive-submit">받기</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('.js-copy-receive-input');
  const err   = overlay.querySelector('.js-copy-receive-err');
  const submitBtn = overlay.querySelector('.js-copy-receive-submit');

  input?.focus();
  /* IME-TRUNC-FIX(2026-07-11): 한글 조합 중 value 재작성은 조합을 끊어 유령 글자를 남김 —
     조합 중엔 보류, 조합이 끝나면 숫자만 남기고 정리 */
  input?.addEventListener('compositionstart', () => { input._imeComposing = true; });
  input?.addEventListener('compositionend', () => {
    input._imeComposing = false;
    input.value = input.value.replace(/\D/g, '').slice(0, 4);
  });
  input?.addEventListener('input', () => {
    if (!input._imeComposing) input.value = input.value.replace(/\D/g, '').slice(0, 4);
    err.style.display = 'none';
  });

  const close = () => overlay.remove();
  overlay.querySelector('.js-copy-receive-cancel')?.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const submit = async () => {
    const code = (input?.value || '').trim();
    if (!/^\d{4}$/.test(code)) {
      err.textContent = '4자리 숫자를 입력해주세요.';
      err.style.display = 'block';
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = '받는 중...';
    try {
      const encodedName = encodeURIComponent(teamName);
      const result = await redeemCopyCode(code, classId, encodedName);
      submitBtn.textContent = '✓ 받았어요! 진입 중...';

      /* v41: reload 없이 직접 maker 진입.
         scenes/viewer-meta 둘 다 .on('value') listener 등록돼 있어 자동으로 새 데이터 들어옴.
         ptype-screen 닫고 maker 화면 노출 + projectType 메모리 동기. */
      const VALID = ['text', 'picturebook', 'movie', 'experience'];
      const newPtype = (result && VALID.includes(result.projectType))
        ? result.projectType : 'picturebook';
      _ptypeExistingType = newPtype;   /* 받은 작품 = 기존 작품 취급 → 저장 skip */
      if (typeof selectProjectType === 'function') selectProjectType(newPtype);

      setTimeout(() => {
        overlay.remove();
        _enterMakerAfterPtypeSelected(newPtype);   /* hidePtypeScreen + maker 진입 */
      }, 400);
    } catch (e) {
      submitBtn.disabled = false;
      submitBtn.textContent = '받기';
      /* ERR-KO-1: 서버 한글 안내는 유지, 영어 기술 문구는 쉬운 한글로 */
      err.textContent = (e && e.message && /[가-힣]/.test(e.message))
        ? e.message : '작품을 받지 못했어요. 코드를 확인하고 잠시 후 다시 시도해 주세요.';
      err.style.display = 'block';
    }
  };
  submitBtn?.addEventListener('click', submit);
  input?.addEventListener('keydown', e => { if (e.isComposing || e.keyCode === 229) return; if (e.key === 'Enter') submit(); }); /* CROSS-A: IME 가드 */
}
function applyTemplate(tpl) {
  if (tpl === 'blank' || Object.keys(scenes).length > 0) return;

  /* 템플릿 헬퍼 (W2-A 이후): legacy 표기를 buttons[] 단일 구조로 자동 변환.
     호환을 위해 choiceA/B/choiceCount/nextA/B도 함께 기록 (양방향 동기화 정책). */
  const tplScene = (cfg) => {
    const buttons = [];
    if (cfg.choiceA || cfg.nextA) {
      buttons.push({
        id: 'A',
        label: cfg.choiceA || '',
        ...(cfg.nextA ? { nextId: String(cfg.nextA) } : {}),
      });
    }
    if (cfg.choiceB || cfg.nextB) {
      buttons.push({
        id: 'B',
        label: cfg.choiceB || '',
        ...(cfg.nextB ? { nextId: String(cfg.nextB) } : {}),
      });
    }
    return {
      ...cfg,
      buttons,
      body: cfg.body || '',
      _hasBody: true,
      presentationMode: cfg.presentationMode || 'picturebook',
      /* D7-4: 그림책 작품 스타터의 일반/시작 장면 기본을 imageCenter로(신규 생성만).
         ending/cover·비-그림책(text/movie/document)은 제외. fallback은 무변경. */
      ...((typeof projectMeta !== 'undefined' && projectMeta && projectMeta.projectType === 'picturebook'
           && (cfg.type === 'normal' || cfg.type === 'start'))
          ? { picturebookSubmode: 'imageCenter' } : {}),
    };
  };

  /* SCENE-TITLE-1A: 스타터 기본 title을 ''로 — '시작 장면/A 경로/결말 A' 같은 자동 라벨이
     "제목은 채워야 하는 것"처럼 보이던 부담 제거. 구조(type/buttons/next/좌표)는 불변,
     학생은 빈 장면(번호만)에서 본문부터 채움. body/_hasBody는 tplScene이 그대로 처리. */
  const templates = {
    'two-ending': [
      tplScene({ num:1,type:'start', title:'',x:320,y:80, choiceCount:2,choiceA:'선택지 A',choiceB:'선택지 B',nextA:2,nextB:3 }),
      tplScene({ num:2,type:'normal',title:'',   x:120,y:280,choiceCount:1,choiceA:'다음으로',nextA:4 }),
      tplScene({ num:3,type:'normal',title:'',   x:520,y:280,choiceCount:1,choiceA:'다음으로',nextA:5 }),
      tplScene({ num:4,type:'ending',title:'',   x:120,y:480 }),
      tplScene({ num:5,type:'ending',title:'',   x:520,y:480 }),
    ],
    'rejoin': [
      tplScene({ num:1,type:'start', title:'',      x:320,y:60, choiceCount:2,choiceA:'선택지 A',choiceB:'선택지 B',nextA:2,nextB:3 }),
      tplScene({ num:2,type:'normal',title:'',          x:120,y:240,choiceCount:1,choiceA:'합류',nextA:4 }),
      tplScene({ num:3,type:'normal',title:'',          x:520,y:240,choiceCount:1,choiceA:'합류',nextA:4 }),
      tplScene({ num:4,type:'normal',title:'',x:320,y:420,choiceCount:2,choiceA:'선택지 A',choiceB:'선택지 B',nextA:5,nextB:6 }),
      tplScene({ num:5,type:'ending',title:'',          x:120,y:620 }),
      tplScene({ num:6,type:'ending',title:'',          x:520,y:620 }),
    ],
    'true-end': [
      tplScene({ num:1,type:'start', title:'',   x:320,y:60, choiceCount:2,choiceA:'선택지 A',choiceB:'선택지 B',nextA:2,nextB:3 }),
      tplScene({ num:2,type:'normal',title:'',      x:120,y:240,choiceCount:1,choiceA:'다음으로',nextA:4 }),
      tplScene({ num:3,type:'normal',title:'',      x:520,y:240,choiceCount:2,choiceA:'계속',choiceB:'비밀 선택',nextA:5,nextB:6 }),
      tplScene({ num:4,type:'ending',title:'', x:120,y:440 }),
      tplScene({ num:5,type:'ending',title:'', x:420,y:440 }),
      tplScene({ num:6,type:'ending',title:'',x:700,y:440,trueEnding:true }),
    ],
  };
  const tplData = templates[tpl]; if (!tplData) return;
  tplData.forEach(s => { scenes[s.num] = s; });
  nextNum = Math.max(...tplData.map(s => s.num)) + 1;
  _afterMutation();
}

/* ── 모드 / 도움말 ── */
let advancedMode = true;   /* W7: 항상 advanced (간단히/더보기 토글 제거) */
function toggleMode() {
  /* W7: 사용자 결정 — "간단히/더보기는 의미 없음, 제거". 함수는 호환을 위해 남겨둠.
     항상 모든 정보 노출. body.beginner-mode 클래스도 추가 안 함. */
}
function showHelp() {
  /* TUTORIAL-PRD Phase A: 주제별 도움말 모달(S1)로 업그레이드. 모듈 미로드 시 기존 alert 폴백. */
  if (typeof window !== 'undefined' && window.TutorialHelp && typeof window.TutorialHelp.open === 'function') {
    window.TutorialHelp.open();
    return;
  }
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
    if (e.isComposing || e.keyCode === 229) return; /* CROSS-A: 한글 IME 조합 중 Enter 가드 */
    if (e.key === 'Enter') document.getElementById('join-pin')?.focus();
  });
  document.getElementById('join-pin')?.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return; /* CROSS-A: 한글 IME 조합 중 Enter 가드 */
    if (e.key === 'Enter') joinTeam();
  });

  /* 툴바 — ADD-SCENE-1: 3-way 드롭다운 제거. 표지/장면 버튼 2개로 직접 추가.
     · ＋ 표지 추가 → addScene('cover') (표지 중복 차단은 addScene 내부에 위임)
     · ＋ 장면 추가 → 일반 장면 바로 추가
     · 엔딩은 상단에서 제거 — 장면 카드의 일반/엔딩 토글로 처리(ENDING-GUARD-1 유지) */
  document.getElementById('btn-add-cover')?.addEventListener('click', e => {
    e.stopPropagation();
    addScene('cover');
  });
  document.getElementById('btn-add-scene')?.addEventListener('click', e => {
    e.stopPropagation();
    addScene('normal');
  });
  /* W8 Phase B: 좌측 사이드 "＋ 새 장면" 버튼 — 기본 일반 장면 */
  document.getElementById('ss-add-btn')?.addEventListener('click', () => addScene('normal'));
  /* BASE10-2: 빈 캔버스 "기본 틀로 시작하기" — ss-empty는 renderSideList가 매번
     다시 그리므로 안정 부모(#ss-list)에 위임 바인딩(중복 리스너 방지). */
  document.getElementById('ss-list')?.addEventListener('click', (e) => {
    if (e.target && e.target.closest('#ss-start-template')) {
      if (typeof window.createBase10StarterScenes === 'function') {
        window.createBase10StarterScenes();
      }
    }
  });
  /* BASE10-2-FIX: projectType 확정 시 좌측 목록 재렌더.
     빈 작품 로드 시 scenes 리스너가 projectType 도착 전에 빈 목록을 그려서
     "기본 틀로 시작하기"(텍스트형 전용)가 안 보이는 로드순서 문제 보정.
     firebase.js가 메타 도착마다 쏘는 mtb-project-ready 이벤트를 PC도 청취. */
  window.addEventListener('mtb-project-ready', () => {
    if (typeof renderSideList === 'function') renderSideList();
  });
  /* PATH-CHECK-REMOVE(2026-07-09): btn-check(이야기 길 점검) 제거 — 기능 삭제(사용자 요청). checkStructure는 미참조 dormant. */
  document.getElementById('btn-export')     ?.addEventListener('click', exportJSON);
  document.getElementById('btn-import')     ?.addEventListener('click', () =>
    document.getElementById('file-input')?.click());
  document.getElementById('btn-clear')      ?.addEventListener('click', clearAll);
  document.getElementById('btn-group-move') ?.addEventListener('click', toggleGroupMove);
  /* PREVIEW-RETIRE(2026-07-12): btn-preview·preview.js 제거 — W7 통합 이후 진입점 없는 사장 기능 정리 */
  document.getElementById('btn-route')      ?.addEventListener('click', openRoutePanel);
  /* HOTFIX(생각 나침반 결과 보기): 저장된 결과를 읽기 전용으로 다시 봄(기존 ThoughtCompassReview 재사용).
     질문 생성·API 호출·BASE10 재생성 없음. 버튼 표시는 _updateCompassResultButton이 제어. */
  document.getElementById('btn-compass-result')?.addEventListener('click', () => {
    const pt = (typeof projectMeta !== 'undefined' && projectMeta && projectMeta.projectType)
      || (typeof selectedProjectType === 'string' ? selectedProjectType : null);
    if (window.ThoughtCompassReview && typeof window.ThoughtCompassReview.openReadOnly === 'function'
        && typeof classId === 'string' && classId && typeof teamName === 'string' && teamName) {
      window.ThoughtCompassReview.openReadOnly({ classId: classId, teamName: teamName, projectType: pt });
    }
  });
  document.getElementById('btn-help')       ?.addEventListener('click', showHelp);
  document.getElementById('btn-zoom-out')   ?.addEventListener('click', () => setZoom(zoom - 0.1));
  document.getElementById('btn-zoom-in')    ?.addEventListener('click', () => setZoom(zoom + 0.1));
  document.getElementById('btn-zoom-reset') ?.addEventListener('click', () => setZoom(1));

  /* ── BRANCH-TOPBAR-1C: 파일/관리 더보기 메뉴 열고 닫기만 추가 ──
     btn-import/btn-clear/btn-group-move 핸들러는 위에서 id로 이미 바인딩됨(여기선 표시 토글만).
     import/clear/groupMove 로직은 건드리지 않음. */
  (() => {
    const moreBtn = document.getElementById('btn-file-more');
    const menu    = document.getElementById('file-more-menu');
    if (!moreBtn || !menu) return;
    const closeMenu = () => {
      if (menu.hidden) return;
      menu.hidden = true;
      moreBtn.setAttribute('aria-expanded', 'false');
    };
    const openMenu = () => {
      menu.hidden = false;
      moreBtn.setAttribute('aria-expanded', 'true');
    };
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden ? openMenu() : closeMenu();
    });
    /* 메뉴 안 항목 클릭 → 기존 핸들러 동작 후 메뉴 닫기 */
    menu.addEventListener('click', () => closeMenu());
    /* 바깥 클릭 닫기 */
    document.addEventListener('click', (e) => {
      if (menu.hidden) return;
      if (e.target.closest && e.target.closest('.tb-more-wrap')) return;
      closeMenu();
    });
    /* Escape 닫기 */
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });
  })();

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
  /* LOW-6: mode-toggle-btn 제거됨 — 바인딩 삭제(toggleMode는 호환 스텁 유지) */
  document.getElementById('file-input')     ?.addEventListener('change', importJSON);

  /* 루트 */
  document.getElementById('btn-route-close')?.addEventListener('click', closeRoutePanel);

  /* PATH-CHECK-REMOVE(2026-07-09): check-close 핸들러 제거 — 이야기 길 점검 패널 삭제로 불필요. */

  /* 이미지 모달 — 바깥 클릭 닫기는 mediaManager.js에서 등록 (source of truth) */
  document.getElementById('btn-img-close')?.addEventListener('click', closeImageModal);

  /* 관리자 패널 — Auth 기반 직접 진입 후 패널 닫기/새로고침 */
  document.getElementById('btn-admin-close')  ?.addEventListener('click', closeAdmin);
  document.getElementById('btn-admin-refresh')?.addEventListener('click', () => {
    /* CONTEST-FIX-1: 60초 캐시 안에서 무동작이던 버그 — 요약바 새로고침과 동일하게 캐시 무효화 후 로드 */
    if (typeof _invalidateAdminCache === 'function') _invalidateAdminCache('side-refresh');
    loadAdminData();
  });
  /* 관리 콘솔 처음으로 — index 이동만. 교사 Auth 세션/관리 선택 상태는 건드리지 않음.
     replace로 이동(뒤로가기로 관리 화면 재튕김 방지). */
  document.getElementById('btn-admin-home')?.addEventListener('click', () => {
    _clearBranchViewportReturn();
    window.location.replace('index.html');
  });
  /* ADMIN-REDESIGN-1(2026-07-09): 좌측 메뉴 탭 전환(팀·작품 ↔ 학급 설정). display 토글만 —
     섹션 렌더러·팀카드 이벤트위임(#admin-team-list)·저장경로 전부 무영향. 정적 DOM이라 1회 바인딩. */
  document.querySelectorAll('.admin-menu .admin-mi').forEach((mi) => {
    mi.addEventListener('click', () => {
      const tab = mi.getAttribute('data-admin-tab');
      document.querySelectorAll('.admin-menu .admin-mi').forEach((b) => b.classList.toggle('is-active', b === mi));
      document.querySelectorAll('.admin-content .admin-tab').forEach((s) => s.classList.toggle('is-active', s.getAttribute('data-admin-tab') === tab));
      const c = document.querySelector('.admin-content'); if (c) c.scrollTop = 0;
    });
  });

  /* 처음으로(브랜치 화면 상단) — 이동 직전 저장 큐 명시 flush 후 index로 replace 이동.
     <a href> 기본 이동은 막고(preventDefault) replace 사용 → 뒤로가기로 maker 재튕김 방지.
     JS 미바인딩 시에도 <a href="index.html"> fallback으로 최소 이동은 보장. */
  document.getElementById('btn-home-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    try { if (typeof flushTitleSaves === 'function') flushTitleSaves(); } catch (_) {}
    try { if (typeof flushBodySaves  === 'function') flushBodySaves();  } catch (_) {}
    _clearBranchViewportReturn();
    window.location.replace('index.html');
  });

  /* ADMIN-REDESIGN Phase 2: 교사 관리로 돌아가기(브랜치 화면 상단·기본 숨김, tauth 자동입장 성공 시 노출).
     처음으로와 동일하게 이동 직전 저장 flush 후 maker.html?admin=1로 replace 이동 →
     ui.js ?admin=1 핸들러 → onAuthStateChanged → _enterAdminDirect(교사 이미 인증, 즉시 복원). */
  document.getElementById('btn-back-to-admin')?.addEventListener('click', (e) => {
    e.preventDefault();
    try { if (typeof flushTitleSaves === 'function') flushTitleSaves(); } catch (_) {}
    try { if (typeof flushBodySaves  === 'function') flushBodySaves();  } catch (_) {}
    _clearBranchViewportReturn();
    window.location.replace('maker.html?admin=1');
  });

  /* 템플릿 — HTML에서 제거됨 (사용자 결정: 시작 템플릿 폐기). querySelectorAll은 빈 NodeList → noop. */
  document.querySelectorAll('[data-tpl]').forEach(btn =>
    btn.addEventListener('click', () => selectTemplate(btn.dataset.tpl))
  );

  /* W6 신규 흐름: 작품 유형 카드 클릭 — ptype-screen 안에서 클릭됨.
     · existingType (firebase에서 로드된 기존 유형) 있고 사용자 선택과 다르면 confirm
     · 같거나 신규(existingType 없음)면 즉시 진입 */
  document.querySelectorAll('#ptype-grid [data-ptype]').forEach(btn =>
    btn.addEventListener('click', () => _onPtypeCardClick(btn.dataset.ptype))
  );

  /* v40: "다른 모둠 작품 받기" 카드 — 빈 슬롯일 때만 활성 */
  document.getElementById('ptype-receive-copy')?.addEventListener('click', () => {
    if (_ptypeExistingType) {
      alert('이미 작품이 있는 모둠이에요. 빈 모둠으로만 작품을 받을 수 있어요.');
      return;
    }
    _openReceiveCopyModal();
  });

  /* ESC — PREVIEW-RETIRE: closePreview 분기 제거(오버레이 삭제됨) */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('img-modal')?.style.display === 'flex') closeImageModal();
  });

  /* v43: 카드 외부 영역에 이미지 드롭 시 브라우저 기본 동작(이미지 새 탭 열기) 차단.
     카드 이미지 영역(.card-image-area)은 자체 drop 핸들러로 e.preventDefault() 호출 + 처리. */
  window.addEventListener('dragover', e => {
    if (e.target.closest && e.target.closest('.card-image-area')) return;
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'none';
    }
  });
  window.addEventListener('drop', e => {
    if (e.target.closest && e.target.closest('.card-image-area')) return;
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
      e.preventDefault();
    }
  });

  /* ── 다음 단계 패널 ── */

  /* 접기/펼치기 */
  document.getElementById('btn-nsp-toggle')?.addEventListener('click', () => {
    const body   = document.getElementById('nsp-body');
    const btn    = document.getElementById('btn-nsp-toggle');
    const collapsed = body.classList.toggle('collapsed');
    btn.textContent = collapsed ? '+' : '−';
  });

  /* 감상 화면 다듬기 → viewer.html?team=...&edit=1&from=maker(&classId=...)(&ptype=...)
     ─────────────────────────────────────────────────────────────
     W7 projectType lock 보강: maker 메모리의 selectedProjectType을 ptype 쿼리로 전달.
     viewer-meta DB에 projectType 누락된 옛 작품도 maker가 정한 모드로 정확 진입.
     viewer-data가 hint를 받으면 fallback 대신 hint 사용 + viewer-meta에 보정 저장. */
  document.getElementById('btn-viewer-edit')?.addEventListener('click', () => {
    const name = encodeURIComponent(teamName || '');
    if (!name) { alert('먼저 팀 이름으로 입장해 주세요.'); return; }
    const cid = classId ? `&classId=${encodeURIComponent(classId)}` : '';
    const pt  = (typeof selectedProjectType === 'string' && selectedProjectType)
      ? `&ptype=${encodeURIComponent(selectedProjectType)}` : '';
    flushTitleSaves();
    _saveReturnContext('maker');
    _openInternalUrl(`viewer.html?team=${name}&edit=1&from=maker${cid}${pt}`);
  });

  /* W7 통합: "빠르게 확인하기" + "완성본 보기" → "감상 테스트" 하나로 통합.
     PREVIEW-RETIRE(2026-07-12): 사장됐던 preview.js·#preview-overlay·관련 CSS 최종 제거.
     감상 테스트 → btn-open-viewer (아래 _updateViewerLink) — viewer.html 새 탭. */

  /* 완성본 보기 → viewer.html?team=...&from=maker(&classId=...)
     ─────────────────────────────────────────────────────────────
     열기 방식: preventDefault 후 _openInternalUrl() — 감상 화면 다듬기와 통일.
     설치앱은 같은 창 이동, 일반 브라우저는 새 탭(opener 유지로 close() 복귀 보존). */
  function _updateViewerLink() {
    const link = document.getElementById('btn-open-viewer');
    if (!link) return;
    const name = teamName ? encodeURIComponent(teamName) : '';
    const cid  = classId  ? `&classId=${encodeURIComponent(classId)}` : '';
    const pt   = (typeof selectedProjectType === 'string' && selectedProjectType)
      ? `&ptype=${encodeURIComponent(selectedProjectType)}` : '';
    const url  = name ? `viewer.html?team=${name}&from=maker${cid}${pt}` : 'viewer.html';
    /* href는 사용자에게 url 미리보기/우클릭용으로만 유지 */
    link.href = url;
    /* 기본 클릭 차단 + 명시적 window.open — opener 관계 유지 보장 */
    link.onclick = (e) => {
      e.preventDefault();
      if (!teamName) { alert('먼저 팀 이름으로 입장해 주세요.'); return; }
      flushTitleSaves();           // 열기 직전 저장 flush
      _saveReturnContext('maker'); // 복귀 context 저장
      _openInternalUrl(url);
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

  /* W7: 간단히/더보기 토글 제거. 항상 모든 정보 노출 — 직관성 우선 (사용자 결정).
     이전 초기값: document.body.classList.add('beginner-mode')
     이제: beginner-mode 절대 추가 안 함. .adv-only 영역도 항상 보임. */

  /* DATA_PATH_VERSION에 따라 클래스 코드 입력 필드 표시/숨김
     v1: 숨김 (기존 동작 유지)
     v2: 표시 (클래스 코드 필수) */
  if (typeof DATA_PATH_VERSION !== 'undefined' && DATA_PATH_VERSION === 'v2') {
    document.getElementById('join-code-wrap')?.style && (
      document.getElementById('join-code-wrap').style.display = ''
    );
    /* v2에서는 join-code → join-input → join-pin 순으로 포커스 이동 */
    document.getElementById('join-code')?.addEventListener('keydown', e => {
      if (e.isComposing || e.keyCode === 229) return; /* CROSS-A: 한글 IME 조합 중 Enter 가드 */
      if (e.key === 'Enter') document.getElementById('join-input')?.focus();
    });
    /* TEAM-ACCOUNT-UX-1: 클래스 코드 확정(blur) 시 팀 생성 모드에 맞춰 입장 폼 문구 조정. */
    document.getElementById('join-code')?.addEventListener('blur', () => {
      if (typeof _onJoinCodeResolveMode === 'function') _onJoinCodeResolveMode();
    });
  }

  /* ADMIN-OPEN-LOADING(2026-07-09): 관리 진입 시 auth 복원(비동기) 동안 학생 입장('작품 만들기') 폼이 잠깐
     보이던 깜빡임 제거 — 폼 즉시 숨김 + '교사 관리 여는 중…' 로딩 오버레이. 진입 성공/실패 시 제거. */
  function _showAdminOpeningOverlay() {
    if (document.getElementById('admin-opening-overlay')) return;
    const el = document.createElement('div');
    el.id = 'admin-opening-overlay';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;inset:0;z-index:100050;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#fbf6ea;font-family:inherit;color:#6b5638;';
    el.innerHTML = '<div style="width:34px;height:34px;border:3px solid #e3d4bd;border-top-color:#c66f4a;border-radius:50%;animation:adminSpin .8s linear infinite;"></div>'
      + '<div style="font-size:15px;font-weight:700;letter-spacing:.02em;">교사 관리 여는 중…</div>'
      + '<style>@keyframes adminSpin{to{transform:rotate(360deg)}}</style>';
    document.body.appendChild(el);
  }
  function _hideAdminOpeningOverlay() {
    document.getElementById('admin-opening-overlay')?.remove();
  }

  /* ?admin=1 query param — 교사 관리 진입
     ─────────────────────────────────────────────────────────────
     Firebase Auth 단일 진입 경로:
       teacher/super_admin → _enterAdminDirect()
       비로그인 or role 없음 → teacher-auth.html 이동

     구형 admin/pw fallback 제거됨.
     ─────────────────────────────────────────────────────────────*/
  if (new URLSearchParams(location.search).get('admin') === '1') {
    /* 입장 폼 즉시 숨김 + 로딩 오버레이 — auth 복원 전 깜빡임 제거 */
    try { document.getElementById('join-screen')?.classList.add('hidden'); _showAdminOpeningOverlay(); } catch (e) { /* noop */ }
    const unsubscribe = auth.onAuthStateChanged(async user => {
      unsubscribe();  // 1회만 실행

      if (user) {
        /* v93: Custom Claim 외에 teachers/{uid} 노드도 확인 — 신규 가입자
           (v90~v92로 기록됨) 통과시키기. teacher-auth.html과 같은 로직. */
        const tokenResult = await user.getIdTokenResult(/* forceRefresh */ true);
        const claim = tokenResult.claims.role ?? null;

        let teacherViaNode = false;
        if (!claim) {
          try {
            const snap = await firebase.database().ref('teachers/' + user.uid).once('value');
            teacherViaNode = snap.exists();
          } catch (e) { /* 룰 거부면 false 유지 */ }
        }

        const role = claim || (teacherViaNode ? 'teacher' : null);
        if (role === 'teacher' || role === 'super_admin') {
          _enterAdminDirect();
          _hideAdminOpeningOverlay();   /* 관리 화면 렌더 후 로딩 제거 */
          return;
        }
      }

      /* 비로그인 또는 role 없음 → teacher-auth.html로 이동(페이지 이동이라 오버레이는 자연 소멸) */
      window.location.href = 'teacher-auth.html';
    });
  }

  /* ?team=팀이름 query param — 교사 관리 화면의 🛠 수정 버튼 경유 진입 */
  const _spTeam = new URLSearchParams(location.search);
  const _teamParam = _spTeam.get('team');
  const _tauthParam = _spTeam.get('tauth') === '1';
  const _classIdParam = _spTeam.get('classId');
  if (_tauthParam && _teamParam && _classIdParam) {
    /* ADMIN-TEACHER-JOIN(2026-07-09): 로그인 교사는 PIN 없이 자동 입장(편집). auth 복원 후 서버(joinTeamMembership)가
       최종 판별(super_admin ∥ meta/teacher_uid==uid). 시도 중 입장 폼 감춤 → 실패 시 폼으로 폴백(팀명 채우고 PIN 요구). */
    const _joinScreen = document.getElementById('join-screen');
    if (_joinScreen) _joinScreen.classList.add('hidden');
    const _unsubT = auth.onAuthStateChanged(async (user) => {
      _unsubT();   /* 1회만 */
      let isTeacher = false;
      if (user) {
        try {
          const tr = await user.getIdTokenResult(true);
          const claim = tr.claims.role ?? null;
          if (claim === 'teacher' || claim === 'super_admin') isTeacher = true;
          else {
            const snap = await firebase.database().ref('teachers/' + user.uid).once('value');
            isTeacher = snap.exists();
          }
        } catch (e) { isTeacher = false; }
      }
      let ok = false;
      if (isTeacher && typeof _teacherJoinTeam === 'function') {
        try { ok = await _teacherJoinTeam(_classIdParam, _teamParam); } catch (e) { ok = false; }
      }
      if (ok) {
        /* ADMIN-REDESIGN Phase 2: 관리 화면 🛠수정으로 편집 진입 성공 → 상단바 '관리로 돌아가기' 노출.
           클릭 핸들러는 위에서 이미 바인딩됨(숨김 상태에도 안전). */
        const _backBtn = document.getElementById('btn-back-to-admin');
        if (_backBtn) _backBtn.style.display = '';
        /* SCRIPT-DRAFT-2: 교사 세션 표시 + 대본 구조 가져오기 제안 스케줄(빈 무비형 작품 한정) */
        window._teacherSessionActive = true;
        if (typeof _scheduleScriptDraftImportOffer === 'function') _scheduleScriptDraftImportOffer();
      }
      if (!ok) {
        /* 폴백: 일반 입장 폼(팀명 채우고 PIN 직접) */
        if (_joinScreen) _joinScreen.classList.remove('hidden');
        const ji = document.getElementById('join-input');
        if (ji) ji.value = _teamParam;
        document.getElementById('join-pin')?.focus();
      }
    });
  } else if (_teamParam) {
    /* tauth 없는 ?team= — 팀 이름만 채우고 PIN은 직접 입력(기존 동작·joinTeam 자동 호출 금지) */
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
  /* SESSION-REFRESH-1A: 일반 새로고침(파라미터 없음)에서도 같은 탭의 fresh makerSession이
     있으면 자동 복귀 — join 화면 재입력(팀/PIN) 방지. 원래는 ?resume=1(viewer→maker 복귀)에만
     발동해, join으로 직접 입장한 학생이 F5하면 sessionStorage 세션이 살아있어도 join 화면으로 갔음.
     · sessionStorage는 탭 단위라 join한 그 탭만 보유 → 새 탭 의도치 않은 자동입장 위험 없음.
     · admin(?admin=1)·교사 🛠수정(?team=) 진입은 의도된 별도 흐름이라 제외.
     · 실제 입장/PIN 재검증/Auth는 기존 _resumeTeamFromSession이 그대로 수행(여기선 발동 조건만 완화). */
  let _hasFreshMakerSession = false;
  if (_resumeParam !== '1'
      && new URLSearchParams(location.search).get('admin') !== '1'
      && !_teamParam) {
    try {
      const _ms = JSON.parse(sessionStorage.getItem('makerSession') || 'null');
      const _MS_MAX_AGE = 2 * 60 * 60 * 1000; // 2시간 (아래 resume 블록 TTL과 동일)
      /* SEC-5: PIN은 더 이상 세션에 저장하지 않음 → pin 의존 제거.
         실제 복원 판정(membership active)은 _resumeTeamFromSession이 수행. 여기선 발동 조건만. */
      _hasFreshMakerSession = !!(_ms && _ms.teamName
        && (_ms.classId || _ms.classCode)
        && (Date.now() - (_ms.savedAt || 0) < _MS_MAX_AGE));
    } catch (e) { /* 파싱 실패 → false(기존 join 화면 유지) */ }
  }
  if (_resumeParam === '1' || _hasFreshMakerSession) {
    try {
      const raw = sessionStorage.getItem('makerSession');
      if (raw) {
        const ctx = JSON.parse(raw);
        const MAX_AGE = 2 * 60 * 60 * 1000; // 2시간
        const fresh = ctx && ctx.teamName
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
              /* v109: 로딩 화면 즉시 숨김 — 입장 화면 노출 */
              if (typeof _maker_hideLoading === 'function') _maker_hideLoading();
            }
            /* 성공 시 _enterTeam → viewer-meta 콜백에서 _maker_hideLoading 호출 */
          });
        }
      }
    } catch (e) { /* 실패해도 일반 입장 화면 유지 */ }
  }
});

/* CROSS-B(2026-07-10): 가상 키보드 대응 최소판 — 키보드가 올라와 visualViewport가 25%+
   줄면 포커스된 입력을 화면 중앙으로 스크롤(안드로이드=layout 리사이즈·iOS=visual만).
   데스크톱은 vv가 줄지 않아 완전 무동작. 팝오버 재배치 등 큰 개편은 실기기 확인 후. */
if (typeof window !== 'undefined' && window.visualViewport) {
  (function () {
    let base = window.visualViewport.height;
    window.visualViewport.addEventListener('resize', () => {
      const vv = window.visualViewport;
      if (vv.height > base) base = vv.height;   /* 회전/키보드 내림 시 기준 갱신 */
      if (vv.height < base * 0.75) {
        const ae = document.activeElement;
        if (ae && (ae.isContentEditable || /^(INPUT|TEXTAREA)$/.test(ae.tagName))) {
          try { ae.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
        }
      }
    });
  })();
}

/* ════════════════════════════════════════════════════════════════
   SCRIPT-DRAFT-2 — 대본 도우미 초안 → 장면 구조 가져오기
   ─────────────────────────────────────────────────────────────────
   조건(전부 만족 시에만 배너): 교사 tauth 세션(window._teacherSessionActive)
   · localStorage 초안(48h 이내·같은 classId) · scenes 로드 완료 + 0개
   · projectType==='movie'. 쓰기는 BASE10과 동일 경로
   (mobileTextBranch.js writeCustomScenesIfEmpty — 로드/빈작품/원격재확인/락 가드 공유).
   장면 키 = 대본 번호 그대로(1..N) → 인쇄 대본과 캔버스 번호 일치.
   표지 = N+1 (실작품 관례: 표지 num은 마지막이어도 무방 — type 기반 렌더).
   ⚠️ 라벨 계약: viewer adaptChoices가 choiceA/B로 buttons 라벨을 덮어쓰므로
   buttons[].label과 choiceA/B를 반드시 같은 문자열로 동기해 쓴다.
   ════════════════════════════════════════════════════════════════ */
let _asdImportOfferDismissed = false;
let _asdImportTimer = null;

function _readScriptDraftForImport() {
  try {
    const raw = localStorage.getItem('branchScriptDraftLast');
    if (!raw) return null;
    const box = JSON.parse(raw);
    if (!box || box.v !== 1 || !box.draft || !Array.isArray(box.draft.scenes)) return null;
    if (Date.now() - (box.at || 0) > 48 * 3600 * 1000) return null;   /* 48h 지난 초안은 제안 안 함 */
    if (typeof classId === 'string' && classId && box.classId && box.classId !== classId) return null;
    return box.draft;
  } catch (e) { return null; }
}

function _scheduleScriptDraftImportOffer() {
  /* scenes/meta 도착 시점이 유동적 — 이벤트 + 완만한 재시도(2s×15회) 둘 다 */
  window.addEventListener('mtb-project-ready', _maybeOfferScriptDraftImport);
  let tries = 0;
  clearInterval(_asdImportTimer);
  _asdImportTimer = setInterval(() => {
    tries++;
    if (_maybeOfferScriptDraftImport() || tries >= 15) clearInterval(_asdImportTimer);
  }, 2000);
}

function _maybeOfferScriptDraftImport() {
  if (_asdImportOfferDismissed) return true;                       /* 이 세션에선 다시 안 물음 */
  if (document.getElementById('asd-import-banner')) return true;
  if (!window._teacherSessionActive) return false;
  const loaded = (typeof window.isBranchScenesLoaded === 'function')
    ? window.isBranchScenesLoaded() : !!window.__branchScenesLoaded;
  if (!loaded) return false;
  if (typeof scenes !== 'object' || !scenes || Object.keys(scenes).length > 0) return false;
  const pt = (typeof projectMeta !== 'undefined' && projectMeta && projectMeta.projectType)
    || (typeof selectedProjectType === 'string' ? selectedProjectType : null);
  if (pt !== 'movie') return false;
  const draft = _readScriptDraftForImport();
  if (!draft) return false;

  const n = draft.scenes.filter(s => s && typeof s === 'object').length;
  const bar = document.createElement('div');
  bar.id = 'asd-import-banner';
  bar.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:900;'
    + 'background:#fffaee;border:1.5px solid #c9a96a;border-radius:12px;'
    + 'box-shadow:0 6px 24px rgba(80,50,20,.18);padding:10px 16px;display:flex;'
    + 'align-items:center;gap:10px;font-size:13px;color:#2b1f10;max-width:92vw;flex-wrap:wrap;';
  const label = document.createElement('span');
  label.textContent = `🎬 대본 초안 「${String(draft.title || '제목 없음')}」 — 장면 ${n}개 + 표지를 이 작품에 만들까요?`;
  const goBtn = document.createElement('button');
  goBtn.textContent = '만들기';
  goBtn.style.cssText = 'min-height:32px;padding:4px 14px;border:none;border-radius:8px;cursor:pointer;'
    + 'background:#c79550;color:#fffaee;font-family:var(--font-h);font-size:13px;';
  const laterBtn = document.createElement('button');
  laterBtn.textContent = '나중에';
  laterBtn.style.cssText = 'min-height:32px;padding:4px 12px;border:1.5px solid #d9c49a;border-radius:8px;'
    + 'cursor:pointer;background:#fffaee;color:#8a6a3a;font-size:12.5px;';
  bar.appendChild(label); bar.appendChild(goBtn); bar.appendChild(laterBtn);
  document.body.appendChild(bar);

  laterBtn.addEventListener('click', () => { _asdImportOfferDismissed = true; bar.remove(); });
  goBtn.addEventListener('click', () => _runScriptDraftImport(draft, bar, goBtn, label));
  return true;
}

async function _runScriptDraftImport(draft, bar, goBtn, label) {
  const ok = window.showMakerConfirm
    ? await window.showMakerConfirm({
        title: '대본 구조를 만들까요?',
        message: '대본의 장면·선택지 연결 그대로 카드가 만들어져요. 대사는 인쇄한 대본을 보고 촬영하고, 각 장면에는 영상만 올리면 돼요.',
        confirmText: '만들기', cancelText: '취소', danger: false,
      })
    : confirm('대본 구조(장면+표지+연결)를 이 작품에 만들까요?');
  if (!ok) return;
  goBtn.disabled = true; goBtn.textContent = '만드는 중…';
  try {
    const map = _buildScenesFromScriptDraft(draft);
    const res = (typeof window.writeCustomScenesIfEmpty === 'function')
      ? await window.writeCustomScenesIfEmpty(map)
      : { ok: false, reason: 'no-writer' };
    if (res && res.ok) {
      label.textContent = '✅ 장면 구조를 만들었어요! 카드를 옮기고 영상을 채워 주세요.';
      goBtn.remove();
      setTimeout(() => bar.remove(), 4000);
      _asdImportOfferDismissed = true;
    } else {
      const why = res && res.reason;
      label.textContent = why === 'not-empty' || why === 'remote-exists'
        ? '⚠️ 이미 장면이 있는 작품에는 만들 수 없어요.'
        : '⚠️ 만들지 못했어요. 잠시 후 다시 시도해 주세요.';
      goBtn.disabled = false; goBtn.textContent = '만들기';
    }
  } catch (e) {
    label.textContent = '⚠️ 만들지 못했어요. 잠시 후 다시 시도해 주세요.';
    goBtn.disabled = false; goBtn.textContent = '만들기';
  }
}

/* 대본 JSON → maker 장면맵 (BASE10 스키마 준수: buttons[]+choiceA/B 동기·nextA/B 미기록) */
function _buildScenesFromScriptDraft(draft) {
  const arr = (draft.scenes || []).filter(s => s && typeof s === 'object');
  const out = {};
  arr.forEach((s, i) => {
    const key = String(s.num);
    if (out[key]) return;   /* 중복 번호는 첫 장면만 */
    const isBranch = s.kind === 'branch';
    const isEnd = s.kind === 'ending' || s.kind === 'trueEnding';
    /* 비갈림·비엔딩 장면은 배열 순서상 다음 장면으로 연결(대본 생성 순서 = 경로 순서) */
    const seqNext = (!isBranch && !isEnd && arr[i + 1]) ? String(arr[i + 1].num) : null;
    let buttons = [], choiceA = '', choiceB = '';
    if (isBranch) {
      const cs = (Array.isArray(s.choices) ? s.choices : []).filter(c => c && typeof c === 'object').slice(0, 2);
      buttons = cs.map((c, bi) => ({
        id: (c.id === 'A' || c.id === 'B') ? c.id : (bi === 0 ? 'A' : 'B'),
        /* 구버전 초안(localStorage) 방어 — "[선택 A]" 접두어 제거는 서버 sanitize에도 있음 */
        label: String(c.text || '').replace(/^\s*\[?\s*선택\s*[AB]\s*\]?\s*/, ''),
        nextId: String(c.next),
      }));
      choiceA = buttons[0] ? buttons[0].label : '';
      choiceB = buttons[1] ? buttons[1].label : '';
    } else if (!isEnd && seqNext) {
      buttons = [{ id: 'A', label: '다음으로 가기', nextId: seqNext }];
      choiceA = '다음으로 가기';
    }
    const sc = {
      num: Number(s.num),
      title: String(s.title || ''),
      body: String(s.stage || ''),
      type: isEnd ? 'ending' : 'normal',
      buttons, choiceA, choiceB,
      choiceCount: isBranch ? 2 : 1,
      _hasBody: true,
      presentationMode: 'movie',
      x: 40 + (i % 5) * 300,
      y: 60 + Math.floor(i / 5) * 240,
    };
    if (s.kind === 'trueEnding') sc.trueEnding = true;
    out[key] = sc;
  });
  /* 표지 = 최대 번호 + 1 (type 기반 렌더라 번호 위치 무관 — 실작품 관례 확인됨) */
  const maxNum = arr.reduce((m, s) => Math.max(m, Number(s.num) || 0), 0);
  const coverNum = maxNum + 1;
  out[String(coverNum)] = {
    num: coverNum,
    title: String(draft.title || ''),
    body: '',
    type: 'cover',
    subtitle: String((draft.cover && draft.cover.intro) || ''),
    coverTheme: 'default',
    titleVerticalPosition: 50,
    buttons: [{ id: 'A', label: '▶️ 시작하기', nextId: '1' }],
    choiceA: '▶️ 시작하기', choiceB: '',
    choiceCount: 1,
    _hasBody: true,
    presentationMode: 'movie',
    x: 40 + (arr.length % 5) * 300,
    y: 60 + Math.floor(arr.length / 5) * 240,
  };
  return out;
}
