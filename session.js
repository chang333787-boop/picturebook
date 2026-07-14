/* ════════════════════════════════════════════════════════════════
   SINGLE-SESSION-1 (2026-07-11): 모둠당 편집 접속 1개 — maker/viewer(다듬기) 공용.
   ─────────────────────────────────────────────────────────────
   · 데이터: {base}/session = { deviceId, instanceId, kind:'student'|'teacher', at }
     — 신규 노드 1개만. 기존 데이터(scenes·계정·locks 등) 0바이트 무접촉.
   · 같은 기기(branch_device_id 공유 — viewer-locks와 동일 키)는 경고 없이 조용히
     이어받음 → 브랜치↔다듬기 왕복·F5·새 탭이 끊기지 않는다.
   · 다른 기기가 살아있으면(서버시각 기준 45초 내 심장박동) confirm 후 인수 —
     이전 기기는 listener로 감지해 저장 flush 후 안내하고 종료.
   · 시계 안전: at은 서버시각(오프셋 보정) — 기기 시계가 틀려도 오판 없음.
   · fail-open: 이 장치의 어떤 실패도 입장을 막지 않는다(세션 없이 진행).
   · 감상/책장/관리 화면은 세션을 잡지 않음(보기는 몇 명이든 동시 허용).
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const TTL = 45000;          /* 심장박동(15s)×3 — 이내면 살아있는 접속 */
  const HB  = 15000;

  const DEVICE_ID = (() => {
    try {
      let id = localStorage.getItem('branch_device_id');   /* viewer-locks/maker와 공유 */
      if (!id) {
        id = Math.random().toString(36).slice(2, 10);
        localStorage.setItem('branch_device_id', id);
      }
      return id;
    } catch (e) {
      return Math.random().toString(36).slice(2, 10);
    }
  })();
  const INSTANCE_ID = Math.random().toString(36).slice(2, 12);

  let _ref = null;
  let _hb = null;
  let _kicked = false;
  let _claimed = false;
  let _offset = 0;
  let _onKicked = null;

  function _now() { return Date.now() + _offset; }

  function _stop() {
    if (_hb) { clearInterval(_hb); _hb = null; }
    if (_ref) { try { _ref.off(); } catch (e) {} }
  }

  /* 심장박동 — transaction으로 "내 세션일 때만 at 갱신, 사라졌으면 재생성,
     남의 세션이면 절대 덮지 않음"(인수 직후 경합에도 새 주인 훼손 0) */
  function _beat() {
    if (!_ref || _kicked) return;
    try {
      _ref.transaction(cur => {
        if (_kicked) return undefined;
        if (!cur) return { deviceId: DEVICE_ID, instanceId: INSTANCE_ID, kind: _kind, at: _now() };
        if (cur.instanceId === INSTANCE_ID) return { ...cur, at: _now() };
        return undefined;   /* 남의 세션 — 건드리지 않음(listener가 kick 처리) */
      });
    } catch (e) { /* fail-open */ }
  }

  let _kind = 'student';

  /* claim — 팀 편집 접속 선언.
     opts: { kind, confirmTakeover(existing)→bool, onKicked(newSession) }
     반환: { ok:true } | { ok:false, denied:true }(사용자가 취소) — 실패는 전부 ok:true(fail-open) */
  async function claim(db, baseRefOrPath, opts) {
    opts = opts || {};
    _kind = (opts.kind === 'teacher') ? 'teacher' : 'student';
    _onKicked = (typeof opts.onKicked === 'function') ? opts.onKicked : null;
    try {
      release();   /* 이전 팀 세션 정리(팀 전환) */
      _kicked = false;
      _ref = (typeof baseRefOrPath === 'string')
        ? db.ref(baseRefOrPath + '/session')
        : baseRefOrPath.child('session');
      try {
        const off = await db.ref('.info/serverTimeOffset').once('value');
        _offset = off.val() || 0;
      } catch (e) { _offset = 0; }

      const cur = (await _ref.once('value')).val();
      const fresh = !!(cur && typeof cur.at === 'number' && (_now() - cur.at) < TTL);
      if (fresh && cur.deviceId !== DEVICE_ID) {
        /* 다른 기기가 살아있음 — 사용자 확인 후에만 인수 */
        let ok = true;
        if (typeof opts.confirmTakeover === 'function') ok = await opts.confirmTakeover(cur);
        if (!ok) { _ref = null; return { ok: false, denied: true }; }
      }
      /* (같은 기기이거나, 죽은 세션이거나, 인수 확인됨) → 내 세션 기록 */
      await _ref.set({ deviceId: DEVICE_ID, instanceId: INSTANCE_ID, kind: _kind, at: _now() });
      _claimed = true;
      try { _ref.onDisconnect().remove(); } catch (e) { /* fail-open */ }
      _hb = setInterval(_beat, HB);
      _ref.on('value', snap => {
        const v = snap.val();
        if (!_claimed || _kicked) return;
        if (v && v.instanceId && v.instanceId !== INSTANCE_ID) {
          /* 다른 세션이 인수함 — 즉시 중단 */
          _kicked = true;
          _stop();
          if (_onKicked) { try { _onKicked(v); } catch (e) {} }
        }
      });
      window.addEventListener('pagehide', release);
      return { ok: true };
    } catch (e) {
      /* 어떤 실패도 입장을 막지 않는다 */
      _ref = null;
      return { ok: true, sessionless: true };
    }
  }

  /* 정상 이탈 — 내 세션이면 제거(다음 사람이 경고 없이 입장) */
  function release() {
    const wasRef = _ref;
    _stop();
    if (wasRef && _claimed && !_kicked) {
      try { wasRef.remove(); } catch (e) {}
      try { wasRef.onDisconnect().cancel(); } catch (e) {}
    }
    _ref = null;
    _claimed = false;
  }

  /* kick 안내 문구 — 새 세션 주인에 따라.
     SESSION-MSG-1(2026-07-14): 오탐(같은 사람인데 다른 브라우저/시크릿/localStorage 삭제로
     '다른 기기'로 오인) 대비 — 새로고침으로 되돌아올 수 있음을 안내. 교사 인수만 예외(되받기 금지). */
  function kickMessage(newSession) {
    if (newSession && newSession.deviceId === DEVICE_ID) {
      return '이 모둠을 다른 탭(화면)에서 열었어요.\n이 화면에서 계속하려면 [확인]을 눌러 새로고침하세요.\n([취소]를 누르면 첫 화면으로 나가요.)';
    }
    if (newSession && newSession.kind === 'teacher') {
      return '선생님이 이 모둠 편집 화면에 들어와서, 이 기기의 접속이 잠시 종료됐어요.\n선생님이 끝나면 다시 들어갈 수 있어요.';
    }
    return '다른 사람이 이 모둠에 접속했어요.\n혹시 방금까지 나 혼자 작업 중이었다면, [확인]을 눌러 새로고침해서 다시 들어오세요.\n([취소]를 누르면 첫 화면으로 나가요.)';
  }

  /* onKicked 핸들러가 "새로고침 재접속"을 제안할지 판정.
     교사가 의도적으로 인수한 경우(kind==='teacher')는 학생이 되받지 못하게 false → 안내 후 나가기만.
     그 외(다른 기기/다른 탭·오탐 포함)는 true → confirm으로 새로고침 선택 가능. */
  function kickAllowsReload(newSession) {
    return !(newSession && newSession.kind === 'teacher');
  }

  window.BranchSession = { claim, release, kickMessage, kickAllowsReload, DEVICE_ID };
})();
