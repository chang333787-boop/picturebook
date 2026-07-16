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

/* ── query param 처리: ?team=2모둠&edit=1&from=maker&classId=abc&scene=N&ptype=movie ── */
function _processQueryParam() {
  const params    = new URLSearchParams(location.search);
  const teamName  = params.get('team');
  const editMode  = params.get('edit') === '1';
  const fromMaker = params.get('from') === 'maker';
  const classId   = params.get('classId') || null;  // v2 경로용
  const sceneNum  = params.get('scene') || null;    // C-2: 특정 장면 자동 선택
  const ptypeHint = params.get('ptype') || null;    // W7: maker가 보낸 모드 hint (lock 보강)

  if (!teamName) {
    /* SHELF-1: 책장 공개 링크(?shelf=1&classId=...) — 서버가 shelfPublic 검증 */
    if (params.get('shelf') === '1' && classId && window.BranchShelf) {
      window.BranchShelf.openShelf({ classId }).catch(err => {
        _setEntryError((err && err.message && /[가-힣]/.test(err.message))
          ? err.message : '책장을 불러오지 못했어요.');
      });
    }
    return;
  }

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
    const classId = await lookupClassIdForViewer(code);
    if (!classId) {
      _setEntryError('클래스 코드가 올바르지 않아요. 선생님께 확인해주세요.');
      _setEntryLoading(false);
      return;
    }

    await _enterViewer(teamName, false, false, classId);
  } catch (err) {
    _setEntryError((err && err.message && /[가-힣]/.test(err.message))
      ? err.message   /* 우리가 의도한 한글 안내는 그대로 */
      : '작품을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');  /* ERR-KO-1: 영어 기술 문구 차단 */
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
        if (dontShow) {
          if (typeof window.TutorialWelcome.markDismissed === 'function') {
            try { window.TutorialWelcome.markDismissed('tutorial_refine', scope); } catch (e) { /* noop */ }
          }
          return;
        }
        if (skipped) return;   /* 이번 진입만 코치 생략 */
        /* 진행(시작하기) → 지금처럼 코치 표시. 진행 시엔 dismiss 미기록(정책: 매 진입 표시). */
        try {
          if (window.TutorialCoach && typeof window.TutorialCoach.run === 'function') {
            window.TutorialCoach.run({ stepsKey: 'refineCoach', keyPrefix: 'tutorial_refine_coach', dismissKeyPrefix: 'tutorial_refine', filterType: ptype || null, scope: scope, force: force });
          }
        } catch (e) { /* noop */ }
      })
      .catch(function () { /* noop */ });
  } catch (e) { /* noop */ }
};

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
      /* SINGLE-SESSION-1(2026-07-11): 다듬기도 편집 접속 — maker와 같은 세션 노드.
         브랜치→다듬기 같은 기기 이동은 경고 없이 이어받음. 감상 모드는 세션 안 잡음. */
      if (window.BranchSession) {
        window.BranchSession.claim(getViewerDb(), basePath, {
          kind: 'student',
          confirmTakeover: () => Promise.resolve(confirm(
            '지금 다른 기기에서 이 모둠을 편집하고 있어요.\n계속 들어가면 그 기기의 접속은 종료돼요. 들어갈까요?')),
          onKicked: async (v) => {
            try { if (typeof _flushPendingSave === 'function') await _flushPendingSave(); } catch (e) {}
            /* SESSION-MSG-1: 오탐 대비 — 교사 인수 외에는 새로고침 재접속 선택([확인]=reload). */
            const _msg = window.BranchSession.kickMessage(v);
            if (window.BranchSession.kickAllowsReload && window.BranchSession.kickAllowsReload(v)) {
              if (confirm(_msg)) { location.reload(); return; }
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

  } catch (err) {
    /* PERF-2: 편집 번들 로드 등 진입 실패 시 editMode 상태를 되돌려 재진입 오염 방지(Codex minor 반영). */
    ViewerState.editMode = false;
    _setEntryError((err && err.message && /[가-힣]/.test(err.message))
      ? err.message   /* 우리가 의도한 한글 안내는 그대로 */
      : '작품을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');  /* ERR-KO-1: 영어 기술 문구 차단 */
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
