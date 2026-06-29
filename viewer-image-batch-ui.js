/* ════════════════════════════════════════════════════════════════
   IMAGE-S2-10 — 교사용 "AI 그림책 마감" UI (독립 모듈)
   ──────────────────────────────────────────────────────────────
   ★ 격리 설계: 기존 viewer-ai/render/data 의 표시·렌더 경로를 건드리지 않는다.
     - 교사(from=maker) 세션에서만 자가 활성(학생 미노출).
     - 모든 firebase 접근 try/catch 방어 → 실패/미준비 시 "준비 중"으로 graceful.
     - 로직은 전부 window.ImageS2Batch(순수·tested). 콜러블은 window.viewerAi._callPhaseAFunction.
     - 시작/적용은 서버 콜러블만 호출(클라 직접 DB write 0). scene.imageData 절대 미접촉.
   ⚠️ 실제 동작(콜러블·생성)은 secret·deploy·privacy 게이트 완료 후. 현재 시작 버튼은 게이트로 막힘.
   ⚠️ DOM/Firebase 결선은 실 maker 앱에서 시각 검증 필요(NOT_VERIFIED here).
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var L = window.ImageS2Batch;
  if (!L) return;   /* 순수 헬퍼 없으면 비활성 */

  function _params() { try { return new URLSearchParams(location.search); } catch (e) { return new URLSearchParams(''); } }
  function _ctx() { var p = _params(); return { classId: p.get('classId') || '', teamName: p.get('team') || p.get('teamName') || '' }; }
  function _ptype() { return (_params().get('ptype') || '').toLowerCase(); }
  function _isTeacherSession() { try { return !!(window.isMakerAuthSession && window.isMakerAuthSession(location.search)); } catch (e) { return false; } }
  function _enc(t) { return encodeURIComponent(t || ''); }

  function _app() { try { return window.viewerAi && window.viewerAi._getViewerFirebaseApp && window.viewerAi._getViewerFirebaseApp(); } catch (e) { return null; } }
  function _db() { var a = _app(); try { return a ? a.database() : null; } catch (e) { return null; } }
  async function _read(path) { var db = _db(); if (!db) return null; try { var s = await db.ref(path).once('value'); return s.val(); } catch (e) { return null; } }
  async function _call(fn, payload) {
    try { if (!window.viewerAi || !window.viewerAi._callPhaseAFunction) return { ok: false, code: 'NO_HELPER' }; return await window.viewerAi._callPhaseAFunction(fn, payload); }
    catch (e) { return { ok: false, code: (e && e.code) || 'CALL_FAILED', error: e && e.message }; }
  }

  async function _gate() {
    var ctx = _ctx();
    var ai = (await _read('classes/' + ctx.classId + '/aiSettings')) || {};
    var enabled = !!(ai && ai.enabled === true && ai.modes && ai.modes.imageS2 === true);
    var img = ai.imageS2 || {};
    return L.computeBatchGate({ isTeacher: _isTeacherSession(), imageS2Enabled: enabled, providerReady: img.providerReady === true, privacyAcknowledged: img.privacyAcknowledged === true });
  }

  /* 시작 전 계획 추정(클라 read만) — 이미지 있는 장면 / 최신 s2 있는 장면. */
  async function _planEstimate() {
    var ctx = _ctx(); var base = 'classes/' + ctx.classId + '/teams/' + _enc(ctx.teamName);
    var scenes = (await _read(base + '/scenes')) || {};
    var variants = (await _read(base + '/aiVariants/image')) || {};
    var total = 0, cached = 0;
    Object.keys(scenes).forEach(function (id) {
      var sc = scenes[id] || {};
      if (!(sc.imageData || sc.imageUrl)) return;
      var v = variants[id] && variants[id].s2;
      if (v && v.url && v.stale !== true) cached++;
      else total++;
    });
    return L.summarizeBatchPlan({ totalScenes: total, cachedCount: cached });
  }

  /* ── DOM ── */
  var PANEL_ID = 'imageS2-batch-panel';
  function _el(tag, attrs, html) { var e = document.createElement(tag); if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); }); if (html != null) e.innerHTML = html; return e; }
  function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  function _closePanel() { var p = document.getElementById(PANEL_ID); if (p) p.remove(); }

  async function _openPanel() {
    _closePanel();
    var overlay = _el('div', { id: PANEL_ID, style: 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;' });
    var card = _el('div', { style: 'background:#fff;max-width:560px;width:100%;max-height:88vh;overflow:auto;border-radius:14px;padding:18px 18px 14px;font-family:-apple-system,system-ui,sans-serif;color:#2b2b2b;box-shadow:0 8px 40px rgba(0,0,0,.3);' });
    card.appendChild(_el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;' },
      '<h3 style="margin:0;font-size:17px;">🖼 AI 그림책 마감</h3>'));
    card.appendChild(_el('p', { style: 'margin:0 0 12px;font-size:13px;color:#666;' }, '학생 그림을 보존하면서 그림책 느낌으로 마감해요.'));
    var body = _el('div', { id: PANEL_ID + '-body' }, '<p style="color:#999;font-size:13px;">불러오는 중…</p>');
    card.appendChild(body);
    var foot = _el('div', { style: 'display:flex;gap:8px;justify-content:flex-end;margin-top:14px;' });
    var closeBtn = _el('button', { style: 'padding:7px 14px;border-radius:8px;border:1px solid #ccc;background:#f6f6f6;cursor:pointer;font-size:13px;' }, '닫기');
    closeBtn.onclick = _closePanel;
    foot.appendChild(closeBtn);
    card.appendChild(foot);
    overlay.appendChild(card);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) _closePanel(); });
    document.body.appendChild(overlay);
    _renderStart(body, foot, closeBtn);
  }

  function _notice() {
    return '<ul style="margin:8px 0 0;padding-left:18px;font-size:12px;color:#777;line-height:1.7;">'
      + '<li>원본은 그대로 보존됩니다.</li>'
      + '<li>AI 결과는 자동 적용되지 않아요(장면별로 비교 후 선택).</li>'
      + '<li>그림 이미지가 외부 AI 서비스로 전송될 수 있어요.</li>'
      + '<li>학교 안내와 설정이 완료된 뒤 사용할 수 있어요.</li></ul>';
  }

  async function _renderStart(body, foot, closeBtn) {
    var gate, plan;
    try { gate = await _gate(); } catch (e) { gate = { canStart: false, state: 'provider', reason: '준비 중이에요.' }; }
    try { plan = await _planEstimate(); } catch (e) { plan = null; }
    var html = '';
    if (plan) {
      html += '<div style="background:#f7f9f5;border:1px solid #e3ead9;border-radius:10px;padding:12px;font-size:13px;line-height:1.8;">'
        + '<div><b>' + _esc(plan.needLabel) + '</b></div>'
        + (plan.cachedLabel ? '<div style="color:#777;">' + _esc(plan.cachedLabel) + '</div>' : '')
        + '<div>' + _esc(plan.timeLabel) + '</div>'
        + '<div>' + _esc(plan.costLabel) + '</div></div>';
    }
    html += '<div style="margin-top:10px;font-size:12px;color:' + (gate.canStart ? '#2e7d32' : '#b26a00') + ';">'
      + (gate.canStart ? '✅ 사용 가능' : '⏳ ' + _esc(gate.reason || '준비 중')) + '</div>';
    html += _notice();
    body.innerHTML = html;

    /* 버튼: 결과 보기(항상) + 시작(게이트 통과 시만 활성) */
    var resultsBtn = _el('button', { style: 'padding:7px 14px;border-radius:8px;border:1px solid #6a8a5b;background:#fff;color:#3a5a2a;cursor:pointer;font-size:13px;' }, '결과 보기');
    resultsBtn.onclick = function () { _renderResults(body); };
    var startBtn = _el('button', { style: 'padding:7px 14px;border-radius:8px;border:none;background:' + (gate.canStart ? '#6a8a5b' : '#cfcfcf') + ';color:#fff;font-size:13px;cursor:' + (gate.canStart ? 'pointer' : 'not-allowed') + ';' }, 'AI 그림책 마감 시작');
    startBtn.disabled = !gate.canStart;
    if (gate.canStart) startBtn.onclick = function () { _runBatch(body, startBtn); };
    /* foot 재구성(close 유지 + 결과/시작) */
    Array.prototype.slice.call(foot.querySelectorAll('button')).forEach(function (b) { if (b !== closeBtn) b.remove(); });
    foot.insertBefore(startBtn, closeBtn);
    foot.insertBefore(resultsBtn, startBtn);
  }

  /* MVP 순차 오케스트레이션 — gate 통과 시에만(현재 비활성). */
  async function _runBatch(body, startBtn) {
    startBtn.disabled = true; startBtn.textContent = '시작 중…';
    var ctx = _ctx();
    var req = L.sanitizeBatchRequest({ classId: ctx.classId, teamName: ctx.teamName, forceRegenerate: false });
    var start = await _call('callStartImageS2Batch', req);
    if (!start || !start.ok || !start.jobId) { body.innerHTML = '<p style="color:#c0392b;font-size:13px;">시작할 수 없어요(' + _esc((start && start.code) || 'ERROR') + ').</p>'; return; }
    var jobId = start.jobId; var targets = start.targets || []; var done = {};
    function paint() {
      var doneN = Object.keys(done).length;
      body.innerHTML = '<div style="font-size:14px;">변환 중… <b>' + doneN + ' / ' + targets.length + '</b></div>'
        + '<div style="height:8px;background:#eee;border-radius:6px;margin-top:8px;overflow:hidden;"><div style="height:100%;width:' + (targets.length ? Math.round(doneN / targets.length * 100) : 100) + '%;background:#6a8a5b;"></div></div>'
        + '<p style="font-size:12px;color:#888;margin-top:8px;">창을 닫으면 변환이 멈춰요. 완료 전에는 이 화면을 유지해 주세요.<br>(지금까지 만든 결과는 저장돼요 — 다시 열어 이어서 변환할 수 있어요.)</p>';
    }
    paint();
    for (var i = 0; i < targets.length; i++) {
      var sid = L.nextTarget(targets, done); if (!sid) break;
      await _call('callImageAiS2', { classId: ctx.classId, teamName: ctx.teamName, sceneId: sid, jobId: jobId });
      done[sid] = true; paint();
    }
    _renderResults(body);
  }

  /* 결과 비교/선택 — 원본↔s2(resolveCompareImages) + 적용 콜러블. */
  async function _renderResults(body) {
    body.innerHTML = '<p style="color:#999;font-size:13px;">결과 불러오는 중…</p>';
    var ctx = _ctx(); var base = 'classes/' + ctx.classId + '/teams/' + _enc(ctx.teamName);
    var scenes = (await _read(base + '/scenes')) || {};
    var variants = (await _read(base + '/aiVariants/image')) || {};
    var selections = (await _read(base + '/aiVariants/imageSelections')) || {};
    var ids = Object.keys(scenes).filter(function (id) { var s = scenes[id] || {}; return s.imageData || s.imageUrl; }).sort(function (a, b) { return (Number(a) || 0) - (Number(b) || 0); });
    if (!ids.length) { body.innerHTML = '<p style="font-size:13px;color:#888;">이미지가 있는 장면이 없어요.</p>'; return; }
    var wrap = _el('div', {});
    ids.forEach(function (id) {
      var s2v = variants[id] && variants[id].s2;
      var cmp = L.resolveCompareImages(scenes[id], selections[id], s2v);
      var row = _el('div', { style: 'border:1px solid #eee;border-radius:10px;padding:10px;margin:10px 0;' });
      var head = '장면 ' + _esc(id) + (cmp.s2 ? '' : ' · <span style="color:#999;">AI 결과 없음</span>') + (cmp.stale ? ' · <span style="color:#b26a00;">오래된 결과(원본이 바뀜 — 다시 생성 권장)</span>' : '');
      row.appendChild(_el('div', { style: 'font-size:12px;color:#555;margin-bottom:6px;' }, head));
      var pair = _el('div', { style: 'display:flex;gap:8px;' });
      pair.appendChild(_el('figure', { style: 'flex:1;margin:0;' }, '<figcaption style="font-size:11px;color:#888;">원본</figcaption>' + (cmp.original ? '<img src="' + _esc(cmp.original) + '" style="width:100%;border:1px solid #eee;border-radius:6px;' + (cmp.shown === 'original' ? 'outline:2px solid #6a8a5b;' : '') + '">' : '<div style="height:90px;background:#f3f3f3;border-radius:6px;"></div>')));
      pair.appendChild(_el('figure', { style: 'flex:1;margin:0;' }, '<figcaption style="font-size:11px;color:#888;">AI 결과</figcaption>' + (cmp.s2 ? '<img src="' + _esc(cmp.s2) + '" style="width:100%;border:1px solid #eee;border-radius:6px;' + (cmp.shown === 's2' ? 'outline:2px solid #6a8a5b;' : '') + (cmp.stale ? 'opacity:.5;' : '') + '">' : '<div style="height:90px;background:#f3f3f3;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#bbb;font-size:12px;">없음</div>')));
      row.appendChild(pair);
      if (cmp.s2 && !cmp.stale) {
        var btns = _el('div', { style: 'display:flex;gap:6px;margin-top:8px;' });
        var useBtn = _el('button', { style: 'flex:1;padding:6px;border-radius:7px;border:1px solid #6a8a5b;background:' + (cmp.shown === 's2' ? '#6a8a5b' : '#fff') + ';color:' + (cmp.shown === 's2' ? '#fff' : '#3a5a2a') + ';font-size:12px;cursor:pointer;' }, 'AI 결과 사용');
        var keepBtn = _el('button', { style: 'flex:1;padding:6px;border-radius:7px;border:1px solid #ccc;background:' + (cmp.shown === 'original' ? '#eee' : '#fff') + ';font-size:12px;cursor:pointer;' }, '원본 유지');
        useBtn.onclick = function () { _apply(ctx, id, 's2', row, s2v); };
        keepBtn.onclick = function () { _apply(ctx, id, 'original', row, s2v); };
        btns.appendChild(useBtn); btns.appendChild(keepBtn);
        row.appendChild(btns);
      }
      wrap.appendChild(row);
    });
    body.innerHTML = ''; body.appendChild(wrap);
  }

  async function _apply(ctx, sceneId, selected, row, s2v) {
    var r = await _call('callApplyImageS2Selection', { classId: ctx.classId, teamName: ctx.teamName, sceneId: sceneId, selected: selected });
    var msg = _el('div', { style: 'font-size:11px;margin-top:6px;color:' + (r && r.ok ? '#2e7d32' : '#c0392b') + ';' }, r && r.ok ? (selected === 's2' ? 'AI 결과를 사용해요.' : '원본을 유지해요.') : ('적용 실패(' + _esc((r && r.code) || 'ERROR') + ')'));
    row.appendChild(msg);
    /* IMAGE-S2-RENDER-2: 서버 저장 성공 후에만 발행 캐시 동기 갱신 → 현재 장면 재렌더 시 즉시 반영(클라 DB write 0). */
    if (r && r.ok && typeof window.setPublishedImageSelectionForScene === 'function') {
      try { window.setPublishedImageSelectionForScene(sceneId, selected, selected === 's2' ? s2v : null); } catch (e) {}
    }
    if (r && r.ok && window.viewerAi && typeof window.viewerAi._scheduleViewerFrameReRender === 'function') { try { window.viewerAi._scheduleViewerFrameReRender(); } catch (e) {} }
  }

  /* ── 교사 전용 진입 버튼(자가 주입) ── */
  function _injectEntry() {
    if (!_isTeacherSession()) return;                /* 학생 미노출 */
    if (['picturebook', 'text'].indexOf(_ptype()) === -1 && _ptype()) return;
    if (document.getElementById('imageS2-batch-entry')) return;
    var bar = _el('div', { id: 'imageS2-batch-entry', style: 'position:fixed;right:12px;bottom:12px;z-index:99990;' });
    var btn = _el('button', { style: 'padding:9px 14px;border-radius:20px;border:none;background:#6a8a5b;color:#fff;font-size:13px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.25);font-family:-apple-system,system-ui,sans-serif;' }, '🖼 AI 그림책 마감');
    btn.onclick = _openPanel;
    bar.appendChild(btn);
    document.body.appendChild(bar);
  }

  function _init() { try { _injectEntry(); } catch (e) {} }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init);
  else _init();

  window.imageS2BatchUi = { open: _openPanel, _injectEntry: _injectEntry };
})();
