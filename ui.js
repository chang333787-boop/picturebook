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
  Object.values(scenes).forEach(sc => {
    if (sc.nextA === num) sc.nextA = newNum;
    if (sc.nextB === num) sc.nextB = newNum;
  });
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
  /* 반드시 확인창 먼저 — 확인 전 아무 삭제 없음.
     Undo 제거됨 → 되돌릴 수 없음을 명확히 경고. */
  if (!confirm('정말 모든 장면을 초기화할까요?\n이 작업은 되돌릴 수 없어요.')) return;
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
  selectProjectType(clickedType);
  _enterMakerAfterPtypeSelected(clickedType);
}

/* ptype 결정 후 firebase에 저장 + maker 캔버스 노출 */
async function _enterMakerAfterPtypeSelected(ptype) {
  /* W7 projectType lock: viewer-meta/projectType 반드시 박힌 후 maker 진입.
     ─────────────────────────────────────────────────────────────
     저장 케이스:
     1) 신규 작품 — _ptypeExistingType=null → 저장
     2) 옛 작품 (projectType 필드 누락) — _ptypeExistingType=null → 저장 (여기서 lock 첫 박힘)
     3) 기존 작품 (projectType 있음) — _ptypeExistingType=valid → 저장 스킵
     ─────────────────────────────────────────────────────────────
     이 흐름이 옛 작품 lock 정상화의 핵심:
     · 사용자 캡처에서 projectType이 undefined인 작품도 이 진입에서 박힘
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

  /* BASE10-3A: 신규 작품 projectType 저장이 "성공"했고(savedNewProjectType),
     명시 유형이 text/picturebook일 때만 기본 10장면 자동 생성(모달 없음).
     · 기존 작품 재진입(savedNewProjectType=false) → 실행 안 됨
     · movie/experience/기타 → 명시 ptype 필터로 제외
     · 전체삭제 후 빈 작품 / 로딩 전 빈 상태 → 함수 내부 가드(meta 플래그 + once-recheck)로 제외
     자동 생성 실패해도 maker 진입은 정상 진행. */
  if (savedNewProjectType && (ptype === 'text' || ptype === 'picturebook')
      && typeof window.createStarterTemplateForNewProject === 'function') {
    try { await window.createStarterTemplateForNewProject(ptype); }
    catch (_) { /* noop */ }
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
  input?.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 4);
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
         scenes/viewer-meta 둘 다 .on('value') listener 박혀있어 자동으로 새 데이터 들어옴.
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
      err.textContent = e.message || '받기 실패';
      err.style.display = 'block';
    }
  };
  submitBtn?.addEventListener('click', submit);
  input?.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}
function applyTemplate(tpl) {
  if (tpl === 'blank' || Object.keys(scenes).length > 0) return;

  /* 템플릿 헬퍼 (W2-A 이후): legacy 표기를 buttons[] 단일 구조로 자동 변환.
     호환을 위해 choiceA/B/choiceCount/nextA/B도 함께 박음 (양방향 동기화 정책). */
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
    _openInternalUrl(url);
  });

  /* 루트 */
  document.getElementById('btn-route-close')?.addEventListener('click', closeRoutePanel);

  /* 구조 검사 */
  document.getElementById('check-close')?.addEventListener('click', () => {
    document.getElementById('check-panel').style.display = 'none';
    /* W7: 검사 결과로 박힌 카드 강조 원복. 사용자: "장면 3,5,6이 다시 원래 화면으로 안돌아감". */
    document.querySelectorAll('.scene-card.error-card').forEach(c => c.classList.remove('error-card'));
    document.querySelectorAll('.scene-card.rt-highlight').forEach(c => c.classList.remove('rt-highlight'));
  });

  /* 이미지 모달 — 바깥 클릭 닫기는 mediaManager.js에서 등록 (source of truth) */
  document.getElementById('btn-img-close')?.addEventListener('click', closeImageModal);

  /* 관리자 패널 — Auth 기반 직접 진입 후 패널 닫기/새로고침 */
  document.getElementById('btn-admin-close')  ?.addEventListener('click', closeAdmin);
  document.getElementById('btn-admin-refresh')?.addEventListener('click', loadAdminData);
  /* 관리 콘솔 처음으로 — index 이동만. 교사 Auth 세션/관리 선택 상태는 건드리지 않음.
     replace로 이동(뒤로가기로 관리 화면 재튕김 방지). */
  document.getElementById('btn-admin-home')?.addEventListener('click', () => {
    _clearBranchViewportReturn();
    window.location.replace('index.html');
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

  /* ESC */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('img-modal')?.style.display === 'flex') closeImageModal();
    else closePreview();
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
     btn-preview(다음 단계 패널)는 제거됨 → ui.js의 startPreview 핸들러는 noop.
     preview 모달 코드(preview.js)는 다른 진입점 없으면 자연 사장. 코드는 보존(회귀 X).
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
        /* v93: Custom Claim 외에 teachers/{uid} 노드도 확인 — 신규 가입자
           (v90~v92로 박힘) 통과시키기. teacher-auth.html과 같은 로직. */
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
            /* 성공 시 _enterTeam → viewer-meta 콜백에서 _maker_hideLoading 박음 */
          });
        }
      }
    } catch (e) { /* 실패해도 일반 입장 화면 유지 */ }
  }
});
