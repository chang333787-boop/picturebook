/* ════════════════════════════════════════════════════════════════
   MASTER-M3(2026-07-11): 총괄 주의(notice) 수신 배너 — maker/viewer 공용.
   ─────────────────────────────────────────────────────────────
   · 데이터: notices/{classId}/{teamEncoded | _teacher}/{pushId} = {text, from, createdAt, readAt?}
     write=super_admin만(rules). read=해당 팀 active member(+담당 교사·총괄).
   · 표시: 미확인(readAt 없음) notice가 있으면 화면 상단 알림 띠 + [확인했어요](readAt 기록).
   · 컨텍스트: URL(?team&classId) → 없으면 sessionStorage.makerSession(팀 입장 후 생김).
     maker는 입장 시점이 늦어 ~2분간 주기 재확인. 권한/네트워크 실패는 조용히 무시
     (레거시 membership 미기록 팀은 read가 거부돼 미표시 — H-1 백필 후 자동 해소).
   · 교사: teacherClasses/{uid}가 있으면 notices/{그 학급}/_teacher도 확인.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  let _shown = false;
  let _tries = 0;
  let _timer = null;

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function _ctx() {
    let team = null, classId = null;
    try {
      const p = new URLSearchParams(location.search);
      team = p.get('team');
      classId = p.get('classId');
    } catch (e) { /* noop */ }
    if (!team || !classId) {
      try {
        const s = JSON.parse(sessionStorage.getItem('makerSession') || 'null');
        if (s) { team = team || s.teamName || null; classId = classId || s.classId || null; }
      } catch (e) { /* noop */ }
    }
    if (!team || !classId) return null;
    /* DB 팀 키 = encodeURIComponent(팀 이름). 이미 인코딩된 값이면 그대로. */
    const enc = /%[0-9A-Fa-f]{2}/.test(team) ? team : encodeURIComponent(team);
    return { classId: classId, teamKey: enc };
  }

  async function _unreadAt(db, base) {
    const raw = (await db.ref(base).once('value')).val();
    if (!raw || typeof raw !== 'object') return [];
    return Object.entries(raw)
      .map(([id, n]) => ({
        id: id, base: base,
        text: (n && typeof n.text === 'string') ? n.text : '',
        createdAt: (n && n.createdAt) || 0,
        readAt: (n && n.readAt) || null,
      }))
      .filter(n => n.text && !n.readAt)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  function _banner(list, db) {
    if (_shown || document.getElementById('branch-notice-banner')) return;
    _shown = true;
    const el = document.createElement('div');
    el.id = 'branch-notice-banner';
    /* 감사 M15(2026-07-20): z 100000 → 100070 — 나침반 게이트(100000~100001)·튜토리얼
       (100005~100020)·CSV/로딩(100050)·그리기 confirm(100060)에 가려지던 것 상향.
       교사 긴급 주의는 상단 띠라 무엇이 떠 있어도 보여야 함(전면 차단 아님·조작 방해 없음). */
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:100070;'
      + 'background:#fff7df;border-bottom:3px solid #c96f4a;padding:12px 16px;'
      + 'display:flex;gap:12px;align-items:flex-start;box-shadow:0 4px 14px rgba(0,0,0,.14);';
    el.innerHTML = ''
      + '<div style="font-size:22px;line-height:1;">📢</div>'
      + '<div style="flex:1;min-width:0;">'
      +   '<div style="font-weight:700;color:#a4592f;font-size:14px;margin-bottom:4px;">가지 지킴이 선생님의 알림이에요</div>'
      +   list.map(n => '<div style="font-size:14.5px;color:#3a2c14;line-height:1.55;margin-bottom:3px;">' + _esc(n.text) + '</div>').join('')
      + '</div>'
      + '<button type="button" id="branch-notice-ok" style="flex:0 0 auto;min-height:40px;'
      +   'padding:6px 16px;border:1.5px solid #c96f4a;border-radius:10px;background:#fffaf0;'
      +   'color:#a4592f;font-weight:700;font-size:13.5px;cursor:pointer;">확인했어요</button>';
    document.body.appendChild(el);
    document.getElementById('branch-notice-ok').addEventListener('click', function () {
      el.remove();
      _shown = false;   /* NOTICES-LIVE-LISTEN(#67·#70): 닫으면 다시 표시 가능 → 이후 도착한 주의도 뜬다.
                           (읽음 처리한 것은 readAt이 기록돼 on('value') 재평가 시 미확인 목록에서 빠짐) */
      const ups = {};
      list.forEach(function (n) {
        ups[n.base + '/' + n.id + '/readAt'] = firebase.database.ServerValue.TIMESTAMP;
      });
      db.ref().update(ups).catch(function () { /* 기록 실패해도 배너는 닫힘 — 다음 진입 시 재표시 */ });
    });
  }

  /* 기본(default) Firebase 인스턴스. maker·다듬기·교사보기(from=maker)는 default app이 인증돼 있어
     notices/app-version read가 통과한다. (공개 감상 전용 named 'viewer' app 경로의 수신=#69는
     다중앱 auth 처리가 필요해 별도 과제로 보류 — 여기선 건드리지 않는다.) */
  function _db() {
    try { return firebase.database(); } catch (e) { return null; }
  }

  let _teacherCid = null;
  let _teamPathOn = false;
  let _teacherPathOn = false;

  /* 팀+교사 경로의 미확인 notice를 합산해 배너. on('value')가 부를 때마다 실행(멱등: _banner가
     _shown/기존 배너 있으면 skip). 배너 닫으면 _shown=false로 돌아가 다음 주의가 다시 뜬다. */
  async function _evaluate() {
    if (_shown) return;
    const db = _db(); if (!db) return;
    const ctx = _ctx();
    let list = [];
    if (ctx) {
      try { list = list.concat(await _unreadAt(db, 'notices/' + ctx.classId + '/' + ctx.teamKey)); }
      catch (e) { /* 권한 없음(레거시 등) — 무시 */ }
    }
    if (_teacherCid) {
      try { list = list.concat(await _unreadAt(db, 'notices/' + _teacherCid + '/_teacher')); }
      catch (e) { /* 무시 */ }
    }
    if (list.length) _banner(list, db);
  }

  /* NOTICES-LIVE-LISTEN(#67·#70): 폴링으로 '한 번 확인 후 종료'하던 것 → 팀/교사 경로에 상시
     on('value') 리스너를 붙여, 수업 중(탭이 이미 열려 있음)이나 나중에 도착한 주의도 즉시 배너로.
     팀 컨텍스트는 입장 후에 생기므로 그때까지만 짧게 폴링해 경로를 부착한다(값 비교라 시계 무관). */
  function _start(user) {
    const db = _db(); if (!db) return;
    /* 교사 경로(1회 확인 후 상시 리스너) */
    db.ref('teacherClasses/' + user.uid).once('value').then(function (snap) {
      _teacherCid = snap.val() || null;
      if (_teacherCid && !_teacherPathOn) {
        _teacherPathOn = true;
        try { _db().ref('notices/' + _teacherCid + '/_teacher').on('value', function () { _evaluate(); }); } catch (e) { /* noop */ }
      }
    }).catch(function () { /* 교사 아님 — 무시 */ });
    /* 팀 경로 — ctx 생길 때까지 폴링해 상시 리스너 부착 */
    function tick() {
      const ctx = _ctx();
      if (ctx && !_teamPathOn) {
        _teamPathOn = true;
        try { _db().ref('notices/' + ctx.classId + '/' + ctx.teamKey).on('value', function () { _evaluate(); }); } catch (e) { /* noop */ }
        return;
      }
      if (ctx) return;
      _tries += 1;
      if (_tries > 40) return;   /* ~5분간 입장 대기 후 포기(새로고침 시 재부팅) */
      _timer = setTimeout(tick, 7000);
    }
    tick();
  }

  /* ════════════════════════════════════════════════════════════════
     FORCE-RELOAD-1(2026-07-11): 원격 강제 새로고침 채널.
     app-version(read:true·클라 write 불가) 값이 "이 탭이 처음 본 값"과 달라지면
     저장 flush 후 새로고침 — 긴급 패치를 전 접속자에게 즉시 배포할 때 관리자가
     콘솔/MCP로 값만 바꾸면 됨. 값 비교라 시계 무관, 리스너 실패는 조용히 무시(fail-open). */
  function _watchAppVersion() {
    try {
      var baseline;
      var db = _db(); if (!db) return;
      db.ref('app-version').on('value', function (snap) {
        var v = snap.val();
        if (baseline === undefined) { baseline = (v == null ? null : v); return; }   /* 첫 값 = 기준 */
        if (v == null || v === baseline) return;
        _doForceReload();
      });
    } catch (e) { /* fail-open */ }
  }

  /* CANVAS-GUARD(#68): 그리기/사진 편집(✓완료 전 캔버스)이 열려 있으면 리로드가 그림을 통째로
     날린다 → 편집이 닫힐 때까지 리로드를 미룬다(긴급 패치는 편집 종료 후 반영). text/pending은 먼저 flush. */
  function _doForceReload() {
    try { if (typeof flushBodySaves === 'function') flushBodySaves(); } catch (e) {}
    try { if (typeof flushTitleSaves === 'function') flushTitleSaves(); } catch (e) {}
    try { if (typeof _flushPendingSave === 'function') _flushPendingSave(); } catch (e) {}
    function _editingCanvas() {
      try { return !!document.querySelector('.js-pb-img-save'); } catch (e) { return false; }
    }
    function _go() {
      if (_editingCanvas()) { setTimeout(_go, 2000); return; }   /* 편집 닫힐 때까지 대기(그림 보존 우선) */
      try { location.reload(); } catch (e) {}
    }
    setTimeout(_go, 900);
  }

  let _bootTries = 0;
  function _boot() {
    try {
      /* viewer는 기본 앱 초기화가 데이터 로드 시점이라 늦을 수 있음 — 앱 생길 때까지 재시도 */
      firebase.app();
      _watchAppVersion();
      firebase.auth().onAuthStateChanged(function (user) {
        if (user && !_shown && !_timer) _start(user);
      });
    } catch (e) {
      if (++_bootTries < 15) setTimeout(_boot, 2000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }
})();
