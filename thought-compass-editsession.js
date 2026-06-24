/* thought-compass-editsession.js — 모둠 공유 편집권한(1명) + heartbeat + 이어받기(Phase K).
   정책(PRD LOCK-01~03, D-21/22): 편집자 1명 · 30초 heartbeat · 3분 무활동 → 확인 후 이어받기 · 이전 편집자 read-only.
   저장: classes/{classId}/teams/{enc}/editSession { editorUid, startedAt, heartbeatAt, sessionVersion } (PII/PIN 미저장).
   순수 판정(resolveEditAccess/isStale)은 하니스 검증(Node). 획득/heartbeat/이어받기 transaction은 브라우저 전용.
   Rules: 기존이 active member의 editSession read/write 허용(무변경, emulator 재확인). */
;(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ThoughtCompassEditSession = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const HEARTBEAT_MS = 30000;       /* 30초 주기(LOCK-02) */
  const INACTIVITY_MS = 180000;     /* 3분 무활동 → 이어받기 가능(LOCK-01/D-21) */
  const SESSION_VERSION = 1;

  function _effectiveTs(session) {
    if (!session) return 0;
    if (typeof session.heartbeatAt === 'number') return session.heartbeatAt;
    if (typeof session.startedAt === 'number') return session.startedAt;
    return 0;
  }

  /* 세션 만료(무활동 3분 이상 또는 비어있음) 여부 — server heartbeat 기준. */
  function isStale(session, now) {
    if (!session || !session.editorUid) return true;
    return (now - _effectiveTs(session)) >= INACTIVITY_MS;
  }

  /* 편집권한 판정(순수). 반환 role: 'acquire'(획득 가능) | 'editor'(내가 편집자) | 'readonly'(타인 활성) | 'takeoverOffer'(타인 만료→확인 후 이어받기). */
  function resolveEditAccess(session, uid, now) {
    if (!session || !session.editorUid) return { role: 'acquire' };
    if (session.editorUid === uid) return { role: 'editor', own: true };
    const idle = now - _effectiveTs(session);
    if (idle >= INACTIVITY_MS) return { role: 'takeoverOffer', idleMs: idle };
    return { role: 'readonly', idleMs: idle };
  }

  /* ── 브라우저 orchestration ── */
  function _hasBrowser() { return typeof window !== 'undefined' && typeof document !== 'undefined'; }
  function _db() { return (_hasBrowser() && typeof db !== 'undefined') ? db : (typeof window !== 'undefined' ? window.db : null); }
  function _serverTs() {
    return (typeof firebase !== 'undefined' && firebase.database && firebase.database.ServerValue)
      ? firebase.database.ServerValue.TIMESTAMP : Date.now();
  }
  function _path(ctx) {
    const TC = (typeof window !== 'undefined') ? window.ThoughtCompass : null;
    if (!TC) return null;
    const p = TC.buildThoughtCompassPaths(ctx);
    return p ? p.editSession : null;
  }
  function _uid() {
    try { return (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) ? firebase.auth().currentUser.uid : null; }
    catch (e) { return null; }
  }

  let _hbTimer = null;
  let _subRef = null;

  /* 편집권한 획득 시도(transaction) — 비어있거나 만료면 claim. 반환 { role, uid }. */
  async function acquire(ctx) {
    const database = _db(); const path = _path(ctx); const uid = _uid();
    if (!database || !path || !uid) return { role: 'readonly', uid: uid };
    const res = await database.ref(path).transaction(function (cur) {
      if (isStale(cur, Date.now()) || (cur && cur.editorUid === uid)) {
        return {
          editorUid: uid,
          startedAt: (cur && cur.editorUid === uid && typeof cur.startedAt === 'number') ? cur.startedAt : _serverTs(),
          heartbeatAt: _serverTs(),
          sessionVersion: SESSION_VERSION,
        };
      }
      return undefined;   /* 타인 활성 → 중단(읽기 전용) */
    });
    const val = res && res.snapshot ? res.snapshot.val() : null;
    if (val && val.editorUid === uid) return { role: 'editor', uid: uid };
    return Object.assign(resolveEditAccess(val, uid, Date.now()), { uid: uid });
  }

  /* 만료된 세션 이어받기(사용자 확인 후 호출) — transaction으로 경쟁 1명만 성공. */
  async function takeover(ctx) {
    const database = _db(); const path = _path(ctx); const uid = _uid();
    if (!database || !path || !uid) return { role: 'readonly', uid: uid };
    const res = await database.ref(path).transaction(function (cur) {
      if (isStale(cur, Date.now())) {
        return { editorUid: uid, startedAt: _serverTs(), heartbeatAt: _serverTs(), sessionVersion: SESSION_VERSION };
      }
      return undefined;   /* 그새 다른 사람이 활성화 → 실패 */
    });
    const val = res && res.snapshot ? res.snapshot.val() : null;
    if (val && val.editorUid === uid) return { role: 'editor', uid: uid };
    return Object.assign(resolveEditAccess(val, uid, Date.now()), { uid: uid });
  }

  /* heartbeat 시작 — 30초 주기. 화면 hidden이면 갱신 생략(폭주 방지). 편집자일 때만 갱신. */
  function startHeartbeat(ctx) {
    stopHeartbeat();
    const database = _db(); const path = _path(ctx); const uid = _uid();
    if (!database || !path || !uid) return;
    _hbTimer = setInterval(function () {
      if (document.visibilityState === 'hidden') return;   /* 백그라운드 폭주 금지 */
      database.ref(path).transaction(function (cur) {
        if (cur && cur.editorUid === uid) { cur.heartbeatAt = _serverTs(); return cur; }
        return undefined;   /* 더 이상 편집자 아님 → 갱신 안 함 */
      }).catch(function () {});
    }, HEARTBEAT_MS);
  }
  function stopHeartbeat() { if (_hbTimer) { clearInterval(_hbTimer); _hbTimer = null; } }

  /* 세션 변화 구독 — 편집자 자리를 잃으면(타인 이어받음) onLost 콜백. */
  function subscribe(ctx, onChange) {
    unsubscribe();
    const database = _db(); const path = _path(ctx); const uid = _uid();
    if (!database || !path) return;
    _subRef = database.ref(path);
    _subRef.on('value', function (snap) {
      const val = snap.val();
      if (typeof onChange === 'function') onChange(resolveEditAccess(val, uid, Date.now()), val);
    });
  }
  function unsubscribe() { if (_subRef) { try { _subRef.off('value'); } catch (e) {} _subRef = null; } }

  /* 편집 종료 — 내 세션이면 정리(완료/이탈). unload 신뢰 금지이므로 명시 호출 + 만료 폴백.
     ★ 두 가지 함정 회피:
       (1) transaction 첫 실행 로컬캐시 cur=null이면 undefined 반환→abort(서버 재시도 안 함)라 미삭제 →
           once('value')로 서버값을 캐시에 prime한 뒤 transaction.
       (2) once+set(null)은 비원자(TOCTOU): 그 사이 타인이 이어받으면 타인 세션을 지움 →
           transaction으로 원자 재확인(내 세션일 때만 null, 그 외엔 cur 그대로 반환=abort 아님). */
  async function release(ctx) {
    stopHeartbeat(); unsubscribe();
    const database = _db(); const path = _path(ctx); const uid = _uid();
    if (!database || !path || !uid) return false;
    try {
      await database.ref(path).once('value');   /* 서버값으로 로컬 캐시 prime */
      await database.ref(path).transaction(function (cur) {
        if (cur && cur.editorUid === uid) return null;   /* 내 세션만 atomic 제거 */
        return cur;                                       /* 타인/빈값 → 그대로(undefined 아님: abort-without-retry 회피) */
      });
      return true;
    } catch (e) { return false; }
  }

  return {
    HEARTBEAT_MS, INACTIVITY_MS, SESSION_VERSION,
    resolveEditAccess, isStale,
    acquire, takeover, startHeartbeat, stopHeartbeat, subscribe, unsubscribe, release,
  };
});
