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
      toggleBtn.textContent = collapsed ? '▶️' : '◀';
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
  /* VIEWER-PLAY-STAGE-FILL-1: 감상 가로 그림책이면 무대 목표비율을 페이지와 같은 3:2로 쓴다.
     CSS #viewer-frame aspect도 같은 신호(body[data-stage-aspect="pb-landscape"])로 3:2가 되므로
     JS 판정(h/v)과 CSS 비율이 항상 일치 → 넘침 없이 무대가 페이지에 딱 맞아 일러스트가 가득 참.
     그 외(편집·세로작품·텍스트/무비)는 기존 16:9 유지. 신호는 viewer-render가 렌더 시 세팅. */
  const targetRatio = (document.body && document.body.dataset.stageAspect === 'pb-landscape') ? (3 / 2) : (16 / 9);
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
      if (e.isComposing || e.keyCode === 229) return; /* CROSS-A: 한글 IME 조합 중 Enter 가드 */
      if (e.key === 'Enter') document.getElementById('entry-team-input')?.focus();
    });

  document.getElementById('entry-team-input')
    ?.addEventListener('keydown', e => {
      if (e.isComposing || e.keyCode === 229) return; /* CROSS-A: 한글 IME 조합 중 Enter 가드 */
      if (e.key === 'Enter') handleEntrySubmit();
    });
}

/* ── query param 처리: ?team=2모둠&edit=1&from=maker&classId=abc&scene=N&ptype=movie ──
   VIEW-LINK-2(2026-07-23): 친화 코드 링크 지원 — ?code=JL26A&team=0000 / ?code=JL26A&shelf=1.
   code만 있으면 classCodes/$code → classId 해석 후 기존 경로 그대로(게이트 불변:
   작품별=isPublic, 책장=shelfPublic 링크모드). ?classId= 기존 링크도 계속 동작(하위호환). */
async function _processQueryParam() {
  const params    = new URLSearchParams(location.search);
  const teamName  = params.get('team');
  const editMode  = params.get('edit') === '1';
  const fromMaker = params.get('from') === 'maker';
  let   classId   = params.get('classId') || null;  // v2 경로용
  const code      = (params.get('code') || '').trim().toUpperCase();  // 친화 코드(?code=)
  const sceneNum  = params.get('scene') || null;    // C-2: 특정 장면 자동 선택
  const ptypeHint = params.get('ptype') || null;    // W7: maker가 보낸 모드 hint (lock 보강)

  /* code만 온 링크 → classId 해석(작품별·책장 공통). 실패 시 안내. */
  if (!classId && code) {
    try { classId = await _withEntryTimeout(lookupClassIdForViewer(code), 15000); }
    catch (e) { classId = null; }
    if (!classId) { _revealEntryWithError('클래스 코드가 올바르지 않아요. 선생님께 확인해주세요.'); return; }
  }

  if (!teamName) {
    /* SHELF-1: 책장 공개 링크(?shelf=1&classId=... 또는 ?shelf=1&code=...) — 서버가 shelfPublic 검증.
       LINK-LOADING-1: 책장 렌더 완료 시 자동진입 로딩('책장으로 들어가는 중…') 제거, 실패 시 진입 폼 복구. */
    if (params.get('shelf') === '1' && classId && window.BranchShelf) {
      window.BranchShelf.openShelf({ classId })
        .then(() => { if (typeof window.__hideAutoEnterLoading === 'function') window.__hideAutoEnterLoading(); })
        .catch(err => {
          _revealEntryWithError((err && err.message && /[가-힣]/.test(err.message))
            ? err.message : '책장을 불러오지 못했어요.');
        });
    } else if (params.get('shelf') === '1') {
      /* code/classId 없거나 BranchShelf 미로드 — 로딩만 걸려 있으면 진입 폼 복구 */
      _revealEntryWithError('책장 링크가 올바르지 않아요.');
    } else if (!code && window.BranchShelf && typeof window.BranchShelf.hasCtx === 'function'
               && window.BranchShelf.hasCtx()
               && (function () {
                 /* 감사 #10/#24: 홈에서 '작품 감상하기'(무파라미터 링크)로 새로 들어온 탭까지
                    이전 학급 책장으로 납치해 진입 폼을 영영 못 쓰던 것을 막는 게이트.
                    ⚠️SHELF-RESUME-ADDRBAR(2026-07-26): 처음엔 navigation type이 'reload'일 때만
                    허용했는데, **주소창에 대고 Enter를 치는 것은 'reload'가 아니라 'navigate'**라
                    (F5만 reload) 사용자가 늘 쓰던 그 동작에서 책장이 풀렸다.
                    타입만으로는 '주소창 Enter'와 '홈에서 링크 클릭'을 구분할 수 없으므로
                    referrer로 가른다 — 링크 클릭은 우리 index.html이 referrer로 찍히고,
                    주소창 진입은 referrer가 비어 있다. */
                 try {
                   const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
                   const isReload = nav
                     ? (nav.type === 'reload' || nav.type === 'back_forward')
                     : !!(performance.navigation && performance.navigation.type === 1);
                   if (isReload) return true;                    /* F5·뒤로가기 */
                   const ref = document.referrer || '';
                   if (!ref) return true;                        /* 주소창 입력·즐겨찾기·새 탭 */
                   const u = new URL(ref);
                   if (u.origin !== location.origin) return true; /* 외부(메신저 링크 등) */
                   return /viewer\.html/.test(u.pathname);        /* viewer 안에서 온 이동만 허용 */
                 } catch (e) { return true; }                    /* 판별 실패=종전처럼 복귀(기능 우선) */
               })()) {
      /* SHELF-REFRESH-RESUME(2026-07-25): 코드 입장 책장은 URL에 흔적이 없어 새로고침하면
         입장 폼으로 떨어졌음('풀리는' 증상의 두 번째 원인 — auth는 SHELF-AUTH-RESTORE로 해결).
         sessionStorage branchShelfCtx(책장 진입 시 저장)가 있으면 같은 게이트로 책장 자동 복귀.
         실패(비활성화됨/네트워크)면 조용히 입장 폼(오류문구 없음 — 새 세션과 동일 경험). */
      try {
        const _sctx = JSON.parse(sessionStorage.getItem('branchShelfCtx') || 'null');
        if (_sctx && (_sctx.code || _sctx.classId)) {
          window.BranchShelf.openShelf(_sctx.code
            ? { classCode: _sctx.code, ifIdle: true } : { classId: _sctx.classId, ifIdle: true })
            .then(() => { if (typeof window.__hideAutoEnterLoading === 'function') window.__hideAutoEnterLoading(); })
            .catch(() => {
              try { sessionStorage.removeItem('branchShelfCtx'); } catch (e) {}
              const entryEl = document.getElementById('entry-screen');
              if (entryEl) entryEl.style.cssText = 'display:flex !important;';
              if (typeof window.__hideAutoEnterLoading === 'function') window.__hideAutoEnterLoading();
              _setEntryLoading(false);
            });
        }
      } catch (e) { /* 복원 실패 = 기존 흐름(입장 폼) */ }
    }
    return;
  }

  _enterViewer(teamName, editMode, fromMaker, classId, sceneNum, ptypeHint);
}

/* VIEW-LINK-2: ?team=/?code= 자동진입 중 코드 해석 실패 시 — head 인라인이 숨긴 entry 화면을
   되살리고(로딩 제거) 안내를 띄운다(_enterViewer catch와 동일 복구). */
function _revealEntryWithError(msg) {
  _setEntryError(msg);
  if (typeof window.__hideAutoEnterLoading === 'function') window.__hideAutoEnterLoading();
  const entryEl = document.getElementById('entry-screen');
  if (entryEl) entryEl.style.cssText = 'display:flex !important;';
  _setEntryLoading(false);
}

/* ── entry 화면 직접 제출 — v2 classCodes lookup ── */
async function handleEntrySubmit() {
  const codeInput = document.getElementById('entry-code-input');
  const teamInput = document.getElementById('entry-team-input');
  const code      = codeInput?.value.trim().toUpperCase();
  const teamName  = teamInput?.value.trim();

  if (!code) {
    _setEntryError('클래스 코드를 입력해주세요 (예: ABC12)');
    codeInput?.focus();
    return;
  }

  _setEntryLoading(true);
  _setEntryError('');

  try {
    /* SHELF-1(2026-07-11): 팀 이름을 비우면 → 우리 반 책장(공개 작품 나열).
       코드 검증·목록은 getClassShelf callable이 서버에서 수행. */
    if (!teamName) {
      if (!window.BranchShelf || typeof window.BranchShelf.openShelf !== 'function') {
        _setEntryError('팀 이름을 입력해주세요');
        _setEntryLoading(false);
        return;
      }
      await window.BranchShelf.openShelf({ classCode: code });
      _setEntryLoading(false);
      return;
    }

    /* classCodes/$code → classId 조회 (viewer 전용 Firebase 인스턴스 사용) */
    const classId = await _withEntryTimeout(lookupClassIdForViewer(code), 15000);   /* #44: 무한 대기 방지 */
    if (!classId) {
      _setEntryError('클래스 코드가 올바르지 않아요. 선생님께 확인해주세요.');
      _setEntryLoading(false);
      return;
    }

    await _enterViewer(teamName, false, false, classId);
  } catch (err) {
    _setEntryError(_friendlyEntryError(err));   /* ENTRY-ERR-KO-2: permission_denied→비공개/이름 안내 */
    _setEntryLoading(false);
  }
}

/* ── 실제 진입 처리 ── */
/* COACH-FIX(2026-07-09): 다듬기 진입 튜토리얼(환영 모달 → 코치마크) 공유 헬퍼.
   전체화면 진입(_enterViewer)과 인앱 '감상 화면 다듬기'(viewer-render _goEdit) 양쪽에서 호출 →
   코치마크가 두 경로 모두에서 뜬다(기존엔 전체화면 진입만 호출해 인앱 진입 시 안 떴음).
   maker 세션 게이트는 호출부에서, 기기 dismiss 플래그 존중은 TutorialWelcome/Coach 내부. */
/* TUTORIAL-SCOPE-1(2026-07-09): dismiss 스코프를 '모둠 계정'(classId+teamName)으로 — 같은 태블릿의 다른 모둠에
   '다시 열지 않기'가 새지 않게. 없으면 null → 기기 단위(폴백). */
function _refineTutorialScope() {
  try {
    var p = (typeof ViewerState !== 'undefined' && ViewerState) ? (ViewerState.project || null) : null;
    var cid = (p && p.classId) || (typeof ViewerState !== 'undefined' && ViewerState && ViewerState.classId) || null;
    var tn  = (p && p.teamName) || (typeof ViewerState !== 'undefined' && ViewerState && ViewerState.teamName) || null;
    if (cid && tn) return encodeURIComponent(String(cid) + '__' + String(tn));
  } catch (e) { /* noop */ }
  return null;
}
window.__maybeRunRefineTutorial = function (ptype, opts) {
  try {
    opts = opts || {};
    var force = !!opts.force;               /* ? 재열람: dismiss 무시하고 강제 */
    var scope = _refineTutorialScope();
    if (typeof window === 'undefined' || !window.TutorialWelcome || typeof window.TutorialWelcome.maybeShow !== 'function') return;
    /* deferDismiss: bare 즉시확정 대신 여기서 결과(skip/dontShow/진행)를 보고 코치 표시/억제를 결정. */
    window.TutorialWelcome.maybeShow({ deck: 'refineWelcome', keyPrefix: 'tutorial_refine', filterType: ptype || null, scope: scope, force: force, deferDismiss: true })
      .then(function (res) {
        var dontShow = !!(res && res.dontShow);
        var skipped  = !!(res && res.skipped);
        /* TUTORIAL-SKIP-SUPPRESS-1 + AUDIT-B2 SKIP-SCOPE(2026-07-16): 코치 생략은 둘 다,
           영구 dismiss는 '다시 보지 않기'만. '넘어가기'는 이번 진입만 생략(기록 없음 — 다음에 다시 안내).
           maker 쪽(_makerCoachAfterWelcome)과 동일 정책. */
        /* LEVEL2-CHAR(2026-07-21): 튜토리얼(환영/코치)이 어떻게 끝나든 마지막에 2단계 주인공
           필수 게이트 시도(게이트 내부에서 2단계·미보유·편집·maker만 통과). 코치 있으면 코치 뒤. */
        var _charGate = function () { try { if (typeof window.__maybeShowLevel2CharGate === 'function') window.__maybeShowLevel2CharGate(); } catch (e) { /* noop */ } };
        if (dontShow) {
          if (typeof window.TutorialWelcome.markDismissed === 'function') {
            try { window.TutorialWelcome.markDismissed('tutorial_refine', scope); } catch (e) { /* noop */ }
          }
          _charGate();
          return;
        }
        if (skipped) { _charGate(); return; }   /* 이번 진입만 코치 생략 */
        /* 진행(시작하기) → 지금처럼 코치 표시. 진행 시엔 dismiss 미기록(정책: 매 진입 표시). */
        try {
          if (window.TutorialCoach && typeof window.TutorialCoach.run === 'function') {
            var _cp = window.TutorialCoach.run({ stepsKey: 'refineCoach', keyPrefix: 'tutorial_refine_coach', dismissKeyPrefix: 'tutorial_refine', filterType: ptype || null, scope: scope, force: force });
            if (_cp && typeof _cp.then === 'function') _cp.then(_charGate).catch(_charGate);
            else _charGate();
          } else { _charGate(); }
        } catch (e) { _charGate(); }
      })
      .catch(function () { /* noop */ });
  } catch (e) { /* noop */ }
};

async function _enterViewer(teamName, editMode = false, fromMaker = false, classId = null, sceneNum = null, ptypeHint = null) {
  try {
    _setEntryLoading(true);
    /* ENTRY-TIMEOUT(#44): 작품 로드도 타임아웃 race — ?team= 자동입장 오버레이가 무한 대기하던 것도 함께 해소
       (수동·자동 입장 공통 경로). 지연 시 아래 catch가 한글 안내 + entry 화면 복구. */
    await _withEntryTimeout(loadTeamData(teamName, classId, fromMaker, ptypeHint), 20000);  // fromMaker: isPublic 차단 예외용 / ptypeHint: maker 모드 hint

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
      /* SINGLE-SESSION-1(2026-07-11): 다듬기도 편집 접속 — maker와 같은 세션 노드.
         브랜치→다듬기 같은 기기 이동은 경고 없이 이어받음. 감상 모드는 세션 안 잡음. */
      if (window.BranchSession) {
        window.BranchSession.claim(getViewerDb(), basePath, {
          kind: 'student',
          confirmTakeover: () => (typeof window.appConfirm === 'function' ? window.appConfirm : (m) => Promise.resolve(confirm(m.message)))({
            title: '지금 다른 기기에서 이 모둠을 편집하고 있어요', message: '계속 들어가면 그 기기의 접속은 종료돼요. 들어갈까요?',
            confirmText: '들어가기', cancelText: '그만두기', center: true,
          }),
          onKicked: async (v) => {
            try { if (typeof _flushPendingSave === 'function') await _flushPendingSave(); } catch (e) {}
            /* SESSION-MSG-1: 오탐 대비 — 교사 인수 외에는 새로고침 재접속 선택([확인]=reload). */
            const _msg = window.BranchSession.kickMessage(v);
            if (window.BranchSession.kickAllowsReload && window.BranchSession.kickAllowsReload(v)) {
              (typeof window.appConfirm === 'function'
              ? window.appConfirm({ message: _msg, confirmText: '다시 접속', cancelText: '닫기', center: true })
              : Promise.resolve(confirm(_msg))).then((ok) => { if (ok) location.reload(); });
            return;
            } else {
              alert(_msg);
            }
            location.replace('index.html');
          },
        }).then(res => {
          if (res && res.denied) location.replace('index.html');
        }).catch(() => { /* fail-open */ });
      }
      /* PERF-2: 편집 코드(viewer-edit.js+viewer-ai.js) 지연 로드 — startViewerEdit가 편집 함수를 호출하므로 먼저 보장. */
      if (typeof window.ensureEditBundle === 'function') await window.ensureEditBundle();
      /* C-2: sceneNum이 있으면 그 장면부터 시작 (maker 카드의 다듬기 진입점에서 옴).
         없으면 첫 장면부터. ViewerState.scenes의 키가 string num이라 그대로 전달. */
      startViewerEdit(sceneNum);
      /* TUTORIAL: 감상 화면 다듬기 첫 진입 1회 튜토리얼(기기당 1회). maker에서 온 편집 진입에만.
         편집을 막지 않도록 await 없이 fire-and-forget. */
      /* COACH-FIX(2026-07-09): 튜토리얼(환영+코치) 호출을 공유 헬퍼 window.__maybeRunRefineTutorial로 통일 —
         인앱 '감상 화면 다듬기'(_goEdit)도 같은 헬퍼를 써서 두 진입 경로 모두 코치마크가 뜬다. maker 세션만. */
      if (fromMaker && typeof window.__maybeRunRefineTutorial === 'function') {
        var _ptype = (ViewerState && ViewerState.project && ViewerState.project.projectType)
          || ptypeHint || null;
        window.__maybeRunRefineTutorial(_ptype);
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

    return true;   /* SHELF-OPEN-FAIL-FIX(#51): 성공 신호 — 책장 진입이 실패 시 책장 복귀 판단에 사용 */
  } catch (err) {
    /* PERF-2: 편집 번들 로드 등 진입 실패 시 editMode 상태를 되돌려 재진입 오염 방지(Codex minor 반영). */
    ViewerState.editMode = false;
    _setEntryError(_friendlyEntryError(err));   /* ENTRY-ERR-KO-2: permission_denied→비공개/이름 안내 */
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
    return false;   /* SHELF-OPEN-FAIL-FIX(#51): 실패 신호(내부 catch가 삼켜도 호출부가 알 수 있게) */
  }
}

/* ── UI 헬퍼 ── */
/* ENTRY-ERR-KO-2(2026-07-17): 진입 실패 오류를 학생용 한글 안내로 매핑.
   ① 우리가 의도한 한글 안내(예: '아직 공개되지 않은 작품이에요')는 그대로.
   ② permission_denied(비공개 v2 작품 read 차단·팀 이름 오타로 없는 팀 read) → 원인 안내.
      (기존엔 영어 기술 문구라 ③으로 떨어져 '인터넷 연결' 오안내 → 아이들이 새로고침만 반복)
   ③ 그 외(진짜 네트워크/알 수 없음) → 기존 네트워크 안내. */
function _friendlyEntryError(err) {
  const msg = (err && err.message) ? String(err.message) : '';
  const code = (err && err.code) ? String(err.code) : '';
  if (/[가-힣]/.test(msg)) return msg;                    /* 우리가 만든 한글 안내 */
  if (/permission[_ ]?denied/i.test(msg) || /permission[_ ]?denied/i.test(code)) {
    return '이 작품을 열 수 없어요.\n아직 공개되지 않았거나 모둠 이름이 정확하지 않을 수 있어요. 선생님께 확인해 주세요.';
  }
  return '작품을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.';  /* ERR-KO-1: 영어 기술 문구 차단 */
}

function _setEntryError(msg) {
  const errEl = document.getElementById('entry-error');
  if (errEl) errEl.textContent = msg;
}

/* ENTRY-TIMEOUT(#44): RTDB once() 읽기는 기본 타임아웃이 없어 크롬북 Wi-Fi가 끊기면(또는 순간 단절)
   입장이 무한 '불러오는 중'에 갇혀 오류·재시도 수단이 없다 → 읽기를 타임아웃과 race해서,
   지연 시 한글 안내(재시도 유도)로 폴백. 에러 메시지가 한글이라 _friendlyEntryError가 그대로 표시. */
function _withEntryTimeout(promise, ms) {
  let _t;
  const timeout = new Promise(function (_, reject) {
    _t = setTimeout(function () {
      reject(new Error('연결이 지연되고 있어요. 인터넷 연결을 확인하고 다시 시도해 주세요.'));
    }, ms || 15000);
  });
  return Promise.race([promise, timeout]).finally(function () { clearTimeout(_t); });
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
  const e = document.getElementById('entry-screen');
  /* ENTRY-STUCK-FIX(2026-07-17): 진입 실패 catch가 박은 인라인 display:flex !important를 걷어야
     .hidden{display:none}이 먹힌다(안 걷으면 재시도 성공해도 entry가 작품을 덮음·#24). */
  if (e) { e.style.removeProperty('display'); e.classList.add('hidden'); }
  document.getElementById('player-screen')?.classList.remove('hidden');
}

function showEntryScreen() {
  const e = document.getElementById('entry-screen');
  if (e) {
    e.classList.remove('hidden');
    /* ENTRY-STUCK-FIX: ?team= 자동입장 시 head 인라인 규칙(#entry-screen{display:none!important})이
       남아 ✕로 나오면 빈 화면(#29)이 되던 것 방지 — 명시적으로 flex 강제. */
    e.style.setProperty('display', 'flex', 'important');
  }
  document.getElementById('player-screen')?.classList.add('hidden');
  _setEntryLoading(false);   /* #25: 이전 진입의 '불러오는 중...' 잔류 해제 → '작품 보기' 버튼 재활성 */
  ViewerState.resetPlayback();
}

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
