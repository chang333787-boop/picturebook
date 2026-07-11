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
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:100000;'
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
      const ups = {};
      list.forEach(function (n) {
        ups[n.base + '/' + n.id + '/readAt'] = firebase.database.ServerValue.TIMESTAMP;
      });
      db.ref().update(ups).catch(function () { /* 기록 실패해도 배너는 닫힘 — 다음 진입 시 재표시 */ });
    });
  }

  async function _check(user) {
    if (_shown) return true;
    let db;
    try { db = firebase.database(); } catch (e) { return true; /* SDK 없음 — 중단 */ }
    let list = [];
    const ctx = _ctx();
    if (ctx) {
      try { list = list.concat(await _unreadAt(db, 'notices/' + ctx.classId + '/' + ctx.teamKey)); }
      catch (e) { /* 권한 없음(레거시 등) — 무시 */ }
    }
    try {
      const cid = (await db.ref('teacherClasses/' + user.uid).once('value')).val();
      if (cid) {
        list = list.concat(await _unreadAt(db, 'notices/' + cid + '/_teacher'));
      }
    } catch (e) { /* 교사 아님/권한 없음 — 무시 */ }
    if (list.length) { _banner(list, db); return true; }
    return !!ctx;   /* 팀 컨텍스트까지 확인했으면 종료, 아직 입장 전이면 재시도 */
  }

  function _start(user) {
    _check(user).then(function (done) {
      if (done || _shown) return;
      _timer = setInterval(function () {
        _tries += 1;
        if (_tries > 17 || _shown) { clearInterval(_timer); return; }   /* ~2분 */
        _check(user).then(function (d) { if (d) clearInterval(_timer); });
      }, 7000);
    });
  }

  /* ════════════════════════════════════════════════════════════════
     FORCE-RELOAD-1(2026-07-11): 원격 강제 새로고침 채널.
     app-version(read:true·클라 write 불가) 값이 "이 탭이 처음 본 값"과 달라지면
     저장 flush 후 새로고침 — 긴급 패치를 전 접속자에게 즉시 배포할 때 관리자가
     콘솔/MCP로 값만 바꾸면 됨. 값 비교라 시계 무관, 리스너 실패는 조용히 무시(fail-open). */
  function _watchAppVersion() {
    try {
      var baseline;
      firebase.database().ref('app-version').on('value', function (snap) {
        var v = snap.val();
        if (baseline === undefined) { baseline = (v == null ? null : v); return; }   /* 첫 값 = 기준 */
        if (v == null || v === baseline) return;
        try { if (typeof flushBodySaves === 'function') flushBodySaves(); } catch (e) {}
        try { if (typeof flushTitleSaves === 'function') flushTitleSaves(); } catch (e) {}
        try { if (typeof _flushPendingSave === 'function') _flushPendingSave(); } catch (e) {}
        setTimeout(function () { try { location.reload(); } catch (e) {} }, 900);
      });
    } catch (e) { /* fail-open */ }
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
