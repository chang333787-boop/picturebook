/* ════════════════════════════════════════════════════════════════
   lv1-book-wait.js — LV1-WAIT-1(2026-09-05): 1단계 그림책 "완성 대기화면" (maker·viewer 공용 1벌)
   ──────────────────────────────────────────────────────────────
   · 왜: 1단계 자동 그림의 트리거가 sessionStorage 플래그+소비처 3곳에 걸쳐 있어, 환영 튜토리얼 중
     탭을 닫으면 그림이 영영 안 생겼다(2026-08-14 심사6). 글은 기다리고 그림은 안 기다리던 비대칭.
   · 무엇: 서버 진행 노드(aiVariants/imageJob)와 실제 도착 수(aiVariants/image)만 읽어 상태를
     **순수 함수로 도출**하고, 그 출력만으로 화면·트리거를 결정한다. 클라 영속 플래그 0.
   · 읽는 경로는 전부 학생 rules로 허용된 것: viewer-meta(멤버)·scenes(멤버)·aiVariants(read:true)·
     classes/{cid}/aiSettings(read:true). ⚠️aiUsage는 학생 read 불가 — 절대 읽지 않는다.
   · 페이지 훅(있으면 사용): window.__lv1GoToStudio(classId, teamName)  — maker: 스튜디오로 이동
                          window.__lv1OpenProtagGate(ctx, onDone)     — viewer: 주인공 게이트 열기
   정본: docs/lv1_wait_screen_design_20260905.md §5·§6
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const STALE_MS = 10 * 60 * 1000;        /* 서버 lock stale·imageJob stale과 동일값 */
  const ESCAPE_MS = 6 * 60 * 1000;        /* 이만큼 기다려도 미완이면 탈출구 노출 */
  const LIMIT_FRESH_MS = 24 * 60 * 60 * 1000;   /* job=limit 는 하루 지나면 다시 시도(전역 일일캡 해제) */
  const MAX_AUTO_RESUME = 2;              /* 페이지 로드당 자동 재호출 상한 */
  const REGION = 'asia-northeast3';
  const Z = 100050;                        /* 나침반(100001)·환영(100005) 위, confirm(100066) 아래 */

  const S = Object.freeze({
    NONE: 'NONE', DONE: 'DONE', OFF: 'OFF', LIMIT: 'LIMIT',
    CHOICE: 'CHOICE', DRAW: 'DRAW', WAITING: 'WAITING', RESUME: 'RESUME',
  });

  /* ── 순수 함수 ─────────────────────────────────────────────── */
  /* 서버 generateStoryImages 대상 산정(functions/lv1-image-job.js isImageTargetScene)과 문자 그대로 동일 */
  function isImageTargetScene(sc) {
    if (!sc || typeof sc !== 'object' || sc.type === 'cover') return false;
    return typeof sc.body === 'string' && sc.body.trim().length > 0;
  }
  function computeTargets(scenes) {
    const o = (scenes && typeof scenes === 'object') ? scenes : {};
    return Object.keys(o)
      .filter((sid) => isImageTargetScene(o[sid]))
      .sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
  }
  function hasImage(images, sid) {
    const v = images && images[sid] && images[sid].s2;
    return !!(v && typeof v.url === 'string' && v.url);
  }
  function computeHave(targets, images) {
    return (targets || []).filter((sid) => hasImage(images, sid));
  }
  function isJobRunning(job, now) {
    if (!job || typeof job !== 'object' || job.status !== 'running') return false;
    const t = (typeof job.updatedAt === 'number' && job.updatedAt) || (typeof job.startedAt === 'number' && job.startedAt) || 0;
    if (!t) return false;
    return ((typeof now === 'number' ? now : Date.now()) - t) < STALE_MS;
  }
  function isImageModeOff(aiSettings) {
    if (!aiSettings || typeof aiSettings !== 'object') return false;   /* 못 읽었으면 막지 않는다(서버가 판정) */
    if (aiSettings.enabled === false) return true;
    const m = aiSettings.modes;
    return !!(m && typeof m === 'object' && m.imageS2 === false);
  }
  /* 입력 스냅샷 → 상태. DOM·타이머·네트워크 없음. */
  function deriveState(input) {
    const i = input || {};
    const now = (typeof i.now === 'number') ? i.now : Date.now();
    const targets = computeTargets(i.scenes);
    const have = computeHave(targets, i.images);
    const total = targets.length;
    const base = { targets, have, total, running: isJobRunning(i.job, now) };
    const choice = (i.protag && (i.protag.choice === 'ai' || i.protag.choice === 'draw')) ? i.protag.choice : null;
    const ref = !!(i.protag && typeof i.protag.ref === 'string' && /^https?:\/\//.test(i.protag.ref));
    if (Number(i.level) !== 1) return Object.assign(base, { state: S.NONE, why: 'level' });
    if (total === 0) return Object.assign(base, { state: S.NONE, why: 'no-targets' });
    if (have.length >= total) return Object.assign(base, { state: S.DONE });
    if (isImageModeOff(i.aiSettings)) return Object.assign(base, { state: S.OFF });
    if (i.job && i.job.status === 'limit') {
      const fin = (typeof i.job.finishedAt === 'number') ? i.job.finishedAt : 0;
      if (fin && (now - fin) < LIMIT_FRESH_MS) return Object.assign(base, { state: S.LIMIT });
    }
    if (choice === null && have.length === 0 && !base.running) return Object.assign(base, { state: S.CHOICE });
    if (choice === 'draw' && !ref && have.length === 0 && !base.running) return Object.assign(base, { state: S.DRAW });
    if (base.running) return Object.assign(base, { state: S.WAITING });
    return Object.assign(base, { state: S.RESUME });
  }

  /* ── 인스턴스(페이지당 1개) ──────────────────────────────────── */
  let M = null;   /* { ctx, opts, subs:[], snap:{}, resumeCount, escapeTimer, el, mountedAt, lastState } */

  function _db() { try { return firebase.database(); } catch (e) { return null; } }
  function _teamRef(ctx) { return _db().ref('classes/' + ctx.classId + '/teams/' + encodeURIComponent(ctx.teamName)); }
  function _once(ref) { return ref.once('value').then((s) => s.val()); }
  function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
  function _qs(name) { try { return new URLSearchParams(location.search).get(name); } catch (e) { return null; } }
  function _blockedByPage() {
    return _qs('admin') === '1' || _qs('test') === '1';
  }

  async function _readSnapshot(ctx) {
    const t = _teamRef(ctx);
    const [level, choice, ref, scenes, images, job, aiSettings] = await Promise.all([
      _once(t.child('viewer-meta/picturebookLevel')),
      _once(t.child('viewer-meta/lv1Protag')),
      _once(t.child('viewer-meta/protagonistRef')),
      _once(t.child('scenes')),
      _once(t.child('aiVariants/image')),
      _once(t.child('aiVariants/imageJob')),
      _once(_db().ref('classes/' + ctx.classId + '/aiSettings')).catch(() => null),
    ]);
    return { level, protag: { choice, ref }, scenes, images, job, aiSettings };
  }

  /* ── 배치 호출(멱등: 서버 lock+dedup) ────────────────────────── */
  function fireBatch(ctx) {
    return firebase.app().functions(REGION)
      .httpsCallable('generateStoryImages', { timeout: 570000 })({ classId: ctx.classId, teamName: ctx.teamName })
      .then((r) => (r && r.data) || {});
  }

  /* ── 주인공 선택 카드(나침반 마지막 카드·재진입 CHOICE 공용) ─────────── */
  function askProtagChoice(ctx, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const old = document.getElementById('lv1-protag-choice');
      if (old) old.remove();
      const root = document.createElement('div');
      root.id = 'lv1-protag-choice';
      root.style.cssText = 'position:fixed;inset:0;z-index:' + Z + ';display:flex;align-items:center;justify-content:center;background:rgba(40,32,20,.55);padding:16px;';
      root.innerHTML = ''
        + '<div role="dialog" aria-modal="true" style="background:#fffaee;border-radius:18px;max-width:460px;width:100%;padding:26px 24px 22px;box-shadow:0 18px 50px rgba(43,31,16,.28);font-family:\'Jua\',\'Nanum Gothic\',sans-serif;color:#3a2a1a;text-align:center;">'
        +   '<div style="font-size:34px;line-height:1;">🎨</div>'
        +   '<div style="font-size:17px;font-weight:700;margin:8px 0 2px;">' + (opts.title || '마지막으로 — 주인공을 직접 그릴래요?') + '</div>'
        +   '<div style="font-size:13.5px;color:#6b5638;line-height:1.6;margin-bottom:14px;word-break:keep-all;">주인공을 한 번 그려 두면 AI가 그 모습(모자·색·소품)을 살려서 모든 장면을 그려 줘요.<br>그리지 않아도 AI가 알아서 예쁘게 그려 줘요.</div>'
        +   '<button type="button" class="js-lv1-draw" style="display:block;width:100%;padding:14px;border:none;border-radius:14px;background:#c66f4a;color:#fffaee;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit;">✏️ 내 주인공 그리기</button>'
        +   '<button type="button" class="js-lv1-ai" style="display:block;width:100%;margin-top:10px;padding:14px;border:none;border-radius:14px;background:#efe6d4;color:#6b5638;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;">🎨 AI가 알아서 그려 주세요</button>'
        + '</div>';
      document.body.appendChild(root);
      let done = false;
      const pick = async (choice) => {
        if (done) return; done = true;
        try { await _teamRef(ctx).child('viewer-meta/lv1Protag').set(choice); } catch (e) { /* 실패해도 진행 — 재진입 때 다시 묻는다 */ }
        root.remove();
        resolve(choice);
      };
      root.querySelector('.js-lv1-draw').addEventListener('click', () => pick('draw'));
      root.querySelector('.js-lv1-ai').addEventListener('click', () => pick('ai'));
      /* 바깥 클릭·ESC 없음 — 둘 중 하나를 골라야 진행(FORCE-CHOICE-1 원칙) */
    });
  }

  /* maker 재진입 DRAW: 자동 이동 대신 한 번 묻는다(튜토리얼 중 갑자기 화면이 바뀌지 않게) */
  function askDrawResume(ctx) {
    return askProtagChoice(ctx, { title: '아직 주인공을 안 그렸어요 — 지금 그릴래요?' });
  }

  /* ── 대기화면 DOM ─────────────────────────────────────────── */
  function _ensureEl() {
    let el = document.getElementById('lv1-book-wait');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'lv1-book-wait';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;inset:0;z-index:' + Z + ';display:flex;align-items:center;justify-content:center;background:rgba(40,32,20,.6);padding:16px;';
    el.innerHTML = '<div class="lbw-card" style="background:#fffdf8;border-radius:18px;max-width:560px;width:100%;max-height:92vh;overflow:auto;padding:24px 22px 20px;box-shadow:0 18px 50px rgba(43,31,16,.28);font-family:\'Jua\',\'Nanum Gothic\',sans-serif;color:#3a2a1a;text-align:center;"></div>';
    document.body.appendChild(el);
    return el;
  }
  function _removeEl() { const el = document.getElementById('lv1-book-wait'); if (el) el.remove(); }

  function _gridHtml(d, snap) {
    const imgs = (snap && snap.images) || {};
    return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:8px;margin:14px 0 6px;">'
      + d.targets.map((sid, idx) => {
        const has = hasImage(imgs, sid);
        const url = has ? imgs[sid].s2.url : '';
        return '<div style="aspect-ratio:3/2;border-radius:10px;overflow:hidden;background:' + (has ? '#fff' : '#f3ecdd') + ';border:1.5px solid ' + (has ? '#d8c7a6' : '#e8dcc4') + ';display:flex;align-items:center;justify-content:center;position:relative;">'
          + (has ? '<img src="' + _esc(url) + '" alt="" style="width:100%;height:100%;object-fit:cover;display:block;" loading="lazy" decoding="async">'
                 : '<span style="font-size:12px;color:#b0a088;">' + (idx + 1) + '</span>')
          + '</div>';
      }).join('')
      + '</div>';
  }

  function _render(view) {
    /* view: { state, d, snap, phase, escape, error } */
    const el = _ensureEl();
    const card = el.firstElementChild;
    const d = view.d;
    const n = d.have.length, total = d.total;
    let head = '', sub = '', foot = '';
    if (view.state === S.WAITING) {
      head = '🎨 그림을 그리고 있어요 <span style="color:#c66f4a;">' + n + '/' + total + '</span>';
      sub = '한 장에 20초쯤 걸려요. 다 되면 이 화면이 바로 바뀌어요. (3~4분)';
      if (view.escape) {
        foot = '<div style="margin-top:12px;font-size:12.5px;color:#8a7350;">생각보다 오래 걸리고 있어요. 그림은 뒤에서 계속 만들어져요.</div>'
          + '<button type="button" class="js-lbw-escape" style="margin-top:8px;padding:10px 18px;border:none;border-radius:12px;background:#efe6d4;color:#6b5638;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;">그림은 나중에 이어서 — 글부터 다듬을래요</button>';
      }
    } else if (view.state === S.RESUME && view.escape && n > 0) {
      /* 일부 실패(§6): 자동 재호출을 다 썼는데 몇 장이 비어 있음 — 책은 열 수 있게 */
      head = '📖 동화책이 거의 완성됐어요!';
      sub = n + '장 완성 · ' + (total - n) + '장은 만들지 못했어요. 그 장면은 다듬기에서 [🔁 그림 다시 만들기]로 채울 수 있어요.';
      foot = '<button type="button" class="js-lbw-open" style="margin-top:12px;padding:13px 24px;border:none;border-radius:14px;background:#c66f4a;color:#fffaee;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit;">📖 내 동화책 보기</button>';
    } else if (view.state === S.RESUME) {
      head = '🎨 그림을 준비하고 있어요 <span style="color:#c66f4a;">' + n + '/' + total + '</span>';
      sub = view.error
        ? '잠깐 연결이 끊겼어요. 다시 시도하고 있어요…'
        : '이야기가 준비됐어요. 이제 그림을 그리기 시작해요.';
      if (view.escape) {
        foot = '<div style="margin-top:12px;font-size:12.5px;color:#8a7350;">지금은 그림을 시작하지 못했어요. 다음에 들어오면 이어서 만들어요.</div>'
          + '<button type="button" class="js-lbw-retry" style="margin-top:8px;padding:10px 18px;border:none;border-radius:12px;background:#c66f4a;color:#fffaee;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;">다시 시도</button>'
          + '<button type="button" class="js-lbw-escape" style="margin-top:8px;margin-left:8px;padding:10px 18px;border:none;border-radius:12px;background:#efe6d4;color:#6b5638;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;">글부터 다듬을래요</button>';
      }
    } else if (view.state === S.DONE) {
      head = '📖 동화책이 완성됐어요!';
      sub = '그림 ' + n + '장이 모두 준비됐어요. 이제 내 동화책을 펼쳐 볼까요?';
      foot = '<button type="button" class="js-lbw-open" style="margin-top:12px;padding:13px 24px;border:none;border-radius:14px;background:#c66f4a;color:#fffaee;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit;">📖 내 동화책 보기</button>';
    } else if (view.state === S.OFF || view.state === S.LIMIT) {
      head = '🎨 지금은 그림을 만들 수 없어요';
      sub = (view.state === S.OFF)
        ? '선생님이 아직 [AI 그림책 마감]을 켜지 않았어요. 켜 주시면 다음에 들어올 때 그림을 만들어요.'
        : '오늘 만들 수 있는 그림 횟수를 다 썼어요. 다음에 들어올 때 이어서 만들어요.';
      foot = '<button type="button" class="js-lbw-escape" style="margin-top:12px;padding:12px 22px;border:none;border-radius:14px;background:#c66f4a;color:#fffaee;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;">글부터 다듬을래요</button>';
    }
    card.innerHTML = ''
      + '<div style="font-size:19px;font-weight:800;line-height:1.35;word-break:keep-all;">' + head + '</div>'
      + '<div style="font-size:13.5px;color:#6b5638;line-height:1.6;margin-top:6px;word-break:keep-all;">' + sub + '</div>'
      + _gridHtml(d, view.snap)
      + '<div style="height:8px;border-radius:99px;background:#efe6d4;overflow:hidden;margin-top:6px;"><div style="height:100%;width:' + (total ? Math.round(100 * n / total) : 0) + '%;background:#7aa06a;transition:width .4s ease;"></div></div>'
      + foot;
    const openBtn = card.querySelector('.js-lbw-open');
    if (openBtn) openBtn.addEventListener('click', () => _openBook());
    const escBtn = card.querySelector('.js-lbw-escape');
    if (escBtn) escBtn.addEventListener('click', () => unmount());
    const retryBtn = card.querySelector('.js-lbw-retry');
    if (retryBtn) retryBtn.addEventListener('click', () => { if (M) { M.resumeCount = 0; M.escape = false; _tick('retry'); } });
  }

  function _openBook() {
    const ctx = M && M.ctx;
    const page = M_page();   /* ⚠️ unmount 전에 읽는다 — unmount가 M을 비우면 페이지 판정이 DOM 폴백으로 떨어져
                                다듬기 화면에서 감상으로 튕기던 것(심사8 PoC 실측) */
    unmount();
    if (!ctx) return;
    if (page === 'viewer') {
      /* 감상/다듬기 안 — 화면만 걷고 AI 그림 표시를 갱신 */
      try { if (typeof window.ensureAiViewBundle === 'function') { window.ensureAiViewBundle().then(() => { try { if (window.viewerAi && typeof window.viewerAi.reinitForCurrentTeam === 'function') window.viewerAi.reinitForCurrentTeam(); } catch (e) {} }); } } catch (e) { /* noop */ }
      try { if (typeof _scheduleViewerFrameReRender === 'function') _scheduleViewerFrameReRender(); } catch (e) { /* noop */ }
      return;
    }
    const url = 'viewer.html?team=' + encodeURIComponent(ctx.teamName) + '&from=maker&classId=' + encodeURIComponent(ctx.classId) + '&ptype=picturebook';
    try { if (typeof flushTitleSaves === 'function') flushTitleSaves(); } catch (e) {}
    try { if (typeof flushBodySaves === 'function') flushBodySaves(); } catch (e) {}
    try { if (typeof _saveReturnContext === 'function') _saveReturnContext('maker'); } catch (e) {}
    if (typeof _openInternalUrl === 'function') _openInternalUrl(url); else window.location.href = url;
  }
  function M_page() { if (M && M.opts && M.opts.page) return M.opts.page; return /viewer\.html/.test(location.pathname) ? 'viewer' : 'maker'; }

  /* ── 상태 머신 tick ────────────────────────────────────────── */
  async function _tick(reason) {
    if (!M) return;
    const ctx = M.ctx, opts = M.opts;
    let snap;
    try { snap = await _readSnapshot(ctx); } catch (e) { return; }   /* 읽기 실패 = 조용히(권한/네트워크) */
    if (!M) return;
    M.snap = snap;
    const d = deriveState(snap);
    const fresh = !!opts.fresh;
    const prev = M.lastState;
    M.lastState = d.state;

    switch (d.state) {
      case S.NONE:
        unmount(); return;
      case S.DONE:
        /* 재진입에 이미 완성이면 조용히. 지켜보던 중 완성됐거나 초안 직후면 완성 카드. */
        if (!fresh && prev == null) { unmount(); return; }
        _stopSubs(); _render({ state: S.DONE, d, snap });
        if (M_page() === 'viewer') {
          try { if (typeof window.ensureAiViewBundle === 'function') { window.ensureAiViewBundle().then(() => { try { if (window.viewerAi && typeof window.viewerAi.reinitForCurrentTeam === 'function') window.viewerAi.reinitForCurrentTeam(); } catch (e) {} }); } } catch (e) { /* noop */ }
        }
        return;
      case S.OFF:
      case S.LIMIT:
        if (!fresh) { unmount(); return; }           /* 재진입 무소음 */
        _stopSubs(); _render({ state: d.state, d, snap });
        return;
      case S.CHOICE: {
        if (!opts.allowPrompt) { unmount(); return; }   /* 튜토리얼 뒤 훅이 다시 부른다 */
        _removeEl(); _stopSubs();
        const choice = await askProtagChoice(ctx);
        if (!M) return;
        if (choice === 'draw') { _goDraw(); return; }
        M.opts.fresh = true;   /* 방금 골랐으면 완성 카드까지 보여준다 */
        return _tick('after-choice');
      }
      case S.DRAW: {
        if (!opts.allowPrompt) { unmount(); return; }
        _removeEl(); _stopSubs();
        /* 재진입(maker)일 때만 한 번 더 묻는다 — 방금 나침반에서 고른 직후(fresh)는 바로 스튜디오로 */
        if (M_page() === 'maker' && !fresh) {
          const again = await askDrawResume(ctx);
          if (!M) return;
          if (again === 'ai') { M.opts.fresh = true; return _tick('draw-to-ai'); }
        }
        _goDraw();
        return;
      }
      case S.WAITING:
        _startSubs(); _armEscape();
        _render({ state: S.WAITING, d, snap, escape: !!M.escape });
        return;
      case S.RESUME:
      default:
        _startSubs(); _armEscape();
        /* 호출이 이미 날아가 있으면(서버가 job 노드를 쓰기 전 구독 첫 콜백이 RESUME으로 재판정하는 찰나)
           다시 쏘지 않는다 — 종전엔 이 경합이 자동 재호출 2회 중 1회를 BUSY로 허비했다(PoC 실측). */
        if (M.inflight) { _render({ state: S.WAITING, d, snap, escape: !!M.escape }); return; }
        if (M.resumeCount >= MAX_AUTO_RESUME) {
          _render({ state: S.RESUME, d, snap, escape: true, error: true });
          return;
        }
        _render({ state: S.RESUME, d, snap, escape: false });
        M.resumeCount++;
        M.inflight = true;
        try {
          const r = await fireBatch(ctx);
          if (!M) return;
          M.inflight = false;
          if (r && r.ok === false && r.code === 'BUSY') { return _tick('busy'); }           /* 다른 곳에서 도는 중 → WAITING */
          if (r && (r.limitReached || r.globalLimitReached) && (r.generated || 0) === 0) { M.opts.fresh = true; return _tick('limit'); }
          return _tick('after-batch');                                                        /* 완료/부분 → DONE 또는 RESUME(재호출) */
        } catch (e) {
          if (!M) return;
          M.inflight = false;
          const msg = String((e && (e.message || e.code)) || '');
          if (/MODE_NOT_ENABLED|AI_NOT_ENABLED|failed-precondition/.test(msg)) { M.forceOff = true; M.opts.fresh = true; _stopSubs(); _render({ state: S.OFF, d, snap }); return; }
          /* deadline-exceeded(570s) 등: 서버는 계속 만든다 → 구독이 도착을 보여준다. 5초 뒤 재판정 */
          setTimeout(() => { if (M) _tick('after-error'); }, 5000);
          return;
        }
    }
  }

  function _goDraw() {
    const ctx = M && M.ctx;
    if (!ctx) return;
    if (M_page() === 'viewer' && typeof window.__lv1OpenProtagGate === 'function') {
      window.__lv1OpenProtagGate(ctx, () => { if (M) { M.opts.fresh = true; M.opts.allowPrompt = true; _tick('after-gate'); } });
      /* 게이트가 안 열리는 화면(감상 모드 등)이면 조용히 물러난다 — 다듬기 진입 때 다시 판정 */
      if (!document.getElementById('lvl1-protag-gate')) unmount();
      return;
    }
    if (typeof window.__lv1GoToStudio === 'function') { unmount(); window.__lv1GoToStudio(ctx.classId, ctx.teamName); return; }
    /* 훅이 없는 페이지(예: 링크 감상) — 아무것도 하지 않는다 */
    unmount();
  }

  /* ── 구독/타이머 ──────────────────────────────────────────── */
  function _startSubs() {
    if (!M || M.subs.length) return;
    const t = _teamRef(M.ctx);
    const onImg = t.child('aiVariants/image').on('value', () => { if (M) _debouncedTick('img'); });
    const onJob = t.child('aiVariants/imageJob').on('value', () => { if (M) _debouncedTick('job'); });
    M.subs.push(() => t.child('aiVariants/image').off('value', onImg));
    M.subs.push(() => t.child('aiVariants/imageJob').off('value', onJob));
  }
  function _stopSubs() { if (!M) return; M.subs.forEach((f) => { try { f(); } catch (e) {} }); M.subs = []; }
  let _deb = null;
  function _debouncedTick(reason) { clearTimeout(_deb); _deb = setTimeout(() => _tick(reason), 350); }
  function _armEscape() {
    if (!M || M.escapeTimer) return;
    M.escapeTimer = setTimeout(() => { if (M) { M.escape = true; _tick('escape'); } }, ESCAPE_MS);
  }

  /* ── 공개 API ─────────────────────────────────────────────── */
  /* opts: { fresh: 초안 직후/방금 선택(완성·OFF 카드 표시), allowPrompt: 선택/그리기 카드 허용, page: 'maker'|'viewer' } */
  function mountIfNeeded(ctx, opts) {
    opts = opts || {};
    if (!ctx || !ctx.classId || !ctx.teamName) return;
    if (_blockedByPage()) return;
    if (typeof firebase === 'undefined' || !firebase.app) return;
    if (M && (M.ctx.classId !== ctx.classId || M.ctx.teamName !== ctx.teamName)) unmount();
    if (!M) {
      M = { ctx: { classId: String(ctx.classId), teamName: String(ctx.teamName) }, opts: {}, subs: [], snap: null, resumeCount: 0, inflight: false, escapeTimer: null, escape: false, lastState: null, mountedAt: Date.now() };
    }
    M.opts.fresh = !!opts.fresh || !!M.opts.fresh;
    M.opts.allowPrompt = (opts.allowPrompt !== undefined) ? !!opts.allowPrompt : !!M.opts.allowPrompt;
    if (opts.page) M.opts.page = opts.page;
    _tick('mount');
  }
  function unmount() {
    if (M) { _stopSubs(); if (M.escapeTimer) clearTimeout(M.escapeTimer); }
    clearTimeout(_deb);
    M = null;
    _removeEl();
  }
  /* 초안 직후(maker) — 선택은 나침반에서 이미 기록됨 */
  function afterDraft(ctx, page) { mountIfNeeded(ctx, { fresh: true, allowPrompt: true, page: page || 'maker' }); }

  window.Lv1Book = {
    STATES: S, STALE_MS, ESCAPE_MS, MAX_AUTO_RESUME,
    isImageTargetScene, computeTargets, computeHave, isJobRunning, isImageModeOff, deriveState,
    mountIfNeeded, unmount, afterDraft, askProtagChoice, fireBatch,
    _debug: () => M,
    /* 하니스/육안 검증용 — 네트워크 없이 화면만 그린다 */
    _testRender: (view) => { if (!M) M = { ctx: { classId: 'T', teamName: 'T' }, opts: { page: 'maker' }, subs: [], snap: null, resumeCount: 0, escapeTimer: null, escape: false, lastState: null, mountedAt: Date.now() }; _render(view); },
  };
})();
