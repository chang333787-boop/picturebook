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

  async function _gate(plan) {
    var ctx = _ctx();
    var ai = (await _read('classes/' + ctx.classId + '/aiSettings')) || {};
    var enabled = !!(ai && ai.enabled === true && ai.modes && ai.modes.imageS2 === true);
    var img = ai.imageS2 || {};
    /* plan(_planEstimate)에서 이미지 장면 수/대기 수 — 게이트가 0개 장면도 구분. */
    var sceneCount = plan ? ((plan.needCount || 0) + (plan.cachedCount || 0)) : null;
    var pending = plan ? (plan.needCount || 0) : null;
    return L.computeBatchGate({
      isTeacher: _isTeacherSession(), imageS2Enabled: enabled,
      privacyAcknowledged: img.privacyAcknowledged === true,   /* 안내 표시용(차단 아님) */
      imageSceneCount: sceneCount, pendingCount: pending,
      hasPolicy: plan ? plan.hasPolicy : undefined,            /* 정책 없으면 사전 차단(서버 IMAGE_POLICY_REQUIRED 방지) */
    });
  }

  /* 시작 전 계획 추정(클라 read만) — 이미지 있는 장면 / 최신 s2 있는 장면 / imagePolicy 유무. */
  async function _planEstimate() {
    var ctx = _ctx(); var base = 'classes/' + ctx.classId + '/teams/' + _enc(ctx.teamName);
    var scenes = (await _read(base + '/scenes')) || {};
    var variants = (await _read(base + '/aiVariants/image')) || {};
    var policy = (await _read(base + '/viewer-meta/imagePolicy')) || null;
    var total = 0, cached = 0;
    Object.keys(scenes).forEach(function (id) {
      var sc = scenes[id] || {};
      if (!(sc.imageData || sc.imageUrl)) return;
      var v = variants[id] && variants[id].s2;
      /* 최신 프롬프트 버전 결과만 cached(변환 불필요). 이전 버전(P3)·없음·stale → total(재생성 대상). */
      if (L.isVariantCurrent(v)) cached++;
      else total++;
    });
    var summary = L.summarizeBatchPlan({ totalScenes: total, cachedCount: cached });
    /* imagePolicy(입력 방식)가 upload/draw로 잠겨 있어야 서버가 생성 허용. 없으면 IMAGE_POLICY_REQUIRED로 전부 거부. */
    summary.hasPolicy = !!(policy && (policy.sourceMode === 'upload' || policy.sourceMode === 'draw'));
    return summary;
  }

  /* ── DOM ── */
  var PANEL_ID = 'imageS2-batch-panel';
  /* BATCH-ABORT-ON-CLOSE(#18): 진행 화면 안내('창을 닫으면 변환이 멈춰요')와 달리 패널을 닫아도
     _runBatch 루프가 계속 서버를 호출(장당 ~60s·$0.05)해 중복 생성·이중 과금이 나던 것 →
     닫을 때 플래그를 세우고 루프가 각 회차 시작에서 검사해 중단(진행분은 이미 서버에 저장돼 안전). */
  var _batchAborted = false;
  function _el(tag, attrs, html) { var e = document.createElement(tag); if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); }); if (html != null) e.innerHTML = html; return e; }
  function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  function _closePanel() { _batchAborted = true; var p = document.getElementById(PANEL_ID); if (p) p.remove(); }

  async function _openPanel() {
    _closePanel();
    var overlay = _el('div', { id: PANEL_ID, style: 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;' });
    var card = _el('div', { style: 'background:#fff;max-width:560px;width:100%;max-height:88vh;overflow:auto;border-radius:14px;padding:18px 18px 14px;font-family:-apple-system,system-ui,sans-serif;color:#2b2b2b;box-shadow:0 8px 40px rgba(0,0,0,.3);' });
    card.appendChild(_el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;' },
      '<h3 style="margin:0;font-size:17px;">🖼️ AI 그림책 마감</h3>'));
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
      + '<li>그림 이미지가 외부 AI 서비스로 전송될 수 있어요 — 학교 안내 후 사용하세요.</li></ul>';
  }

  /* 교사용 짧은 순서 안내(접이식). 버튼 활성/비활성과 무관하게 표시. */
  function _orderGuide() {
    return '<details style="margin-top:10px;font-size:12px;color:#666;">'
      + '<summary style="cursor:pointer;color:#3a5a2a;">사용 순서 보기</summary>'
      + '<ol style="margin:6px 0 0;padding-left:18px;line-height:1.7;">'
      + '<li>관리자 설정에서 ‘AI 그림책 마감’을 켭니다.</li>'
      + '<li>변환할 장면 수를 확인합니다.</li>'
      + '<li>‘AI 그림책 마감 시작’을 누릅니다.</li>'
      + '<li>결과를 장면별로 비교해 ‘AI 결과 사용’ 또는 ‘원본 유지’를 선택합니다.</li></ol></details>';
  }

  async function _renderStart(body, foot, closeBtn) {
    var gate, plan;
    try { plan = await _planEstimate(); } catch (e) { plan = null; }
    try { gate = await _gate(plan); } catch (e) { gate = { canStart: false, state: 'error', reason: '설정을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' }; }
    var html = '';
    if (plan) {
      html += '<div style="background:#f7f9f5;border:1px solid #e3ead9;border-radius:10px;padding:12px;font-size:13px;line-height:1.8;">'
        + '<div><b>' + _esc(plan.needLabel) + '</b></div>'
        + (plan.cachedLabel ? '<div style="color:#777;">' + _esc(plan.cachedLabel) + '</div>' : '')
        + '<div>' + _esc(plan.timeLabel) + '</div></div>';   /* 예상 비용 표시 제거(사용자 요청) */
    }
    html += '<div style="margin-top:10px;font-size:12px;color:' + (gate.canStart ? '#2e7d32' : '#b26a00') + ';">'
      + (gate.canStart ? '✅ 시작할 수 있어요' : '⛔ ' + _esc(gate.reason || '시작할 수 없어요')) + '</div>';
    /* IMAGE-S2-LEGACY: 정책 없는 옛 작품 — 차단이 아니라 안내. */
    if (gate.legacyNotice) {
      html += '<div style="margin-top:6px;font-size:12px;color:#8a7350;">옛 작품이라 입력 방식 정보가 없지만, 저장된 그림을 기준으로 마감합니다.</div>';
    }
    html += _orderGuide();
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
    _batchAborted = false;   /* BATCH-ABORT-ON-CLOSE(#18): 새 배치 시작 = 중단 플래그 초기화 */
    startBtn.disabled = true; startBtn.textContent = '시작 중…';
    var ctx = _ctx();
    var req = L.sanitizeBatchRequest({ classId: ctx.classId, teamName: ctx.teamName, forceRegenerate: false });
    var start = await _call('callStartImageS2Batch', req);
    if (!start || !start.ok || !start.jobId) { body.innerHTML = '<p style="color:#c0392b;font-size:13px;">시작할 수 없어요(' + _esc((start && start.code) || 'ERROR') + ').</p>'; return; }
    var jobId = start.jobId; var targets = start.targets || []; var done = {};
    var succeeded = 0, failed = 0, failCodes = {};
    function paint() {
      var doneN = succeeded + failed;
      /* AI-FINISH-REASSURE(2026-07-16): 한 번에 안 되는 장면이 있어도 반복하면 되므로, 빨간 '(실패 N)'
         대신 "다시 하면 돼요" 안내로. 실패는 정상 과정이라 사용자 불안 방지(로직·집계 불변). */
      body.innerHTML = '<div style="font-size:14px;">변환 중… <b>' + doneN + ' / ' + targets.length + '</b></div>'
        + '<div style="height:8px;background:#eee;border-radius:6px;margin-top:8px;overflow:hidden;"><div style="height:100%;width:' + (targets.length ? Math.round(doneN / targets.length * 100) : 100) + '%;background:#6a8a5b;"></div></div>'
        + '<p style="font-size:12px;color:#6a8a5b;margin-top:8px;line-height:1.6;">한 번에 다 안 될 수 있어요 — 그럴 땐 <b>다시 눌러 될 때까지 반복</b>하면 다 만들어져요. 😊</p>'
        + '<p style="font-size:12px;color:#888;margin-top:6px;">창을 닫으면 변환이 멈춰요. 완료 전에는 이 화면을 유지해 주세요.<br>(지금까지 만든 결과는 저장돼요 — 다시 열어 이어서 변환할 수 있어요.)</p>';
    }
    paint();
    for (var i = 0; i < targets.length; i++) {
      if (_batchAborted) return;   /* BATCH-ABORT-ON-CLOSE(#18): 패널을 닫았으면 다음 장면 호출 중단 */
      var sid = L.nextTarget(targets, done); if (!sid) break;
      var res = await _call('callImageAiS2', { classId: ctx.classId, teamName: ctx.teamName, sceneId: sid, jobId: jobId });
      /* secret/배포 미설정(not-configured) → 명확 안내 후 중단. 원본 불변·추가 호출 없음. */
      if (res && res.ok === false && /NOT_CONFIGURED|CONFIG/i.test(String((res && res.code) || ''))) {
        body.innerHTML = '<p style="color:#c0392b;font-size:13px;line-height:1.6;">AI 이미지 서비스 설정을 확인해 주세요.<br>관리자에게 secret 등록·배포 설정을 요청하세요.</p>';
        return;
      }
      /* 성공/실패 정확 집계 — 실패를 '완료'로 세지 않는다(과거: done만 세어 0결과인데 '완료'처럼 보임). */
      var okOne = !!(res && (res.ok === true || res.status === 'succeeded' || res.status === 'cached' || res.reused === true));
      if (okOne) succeeded++;
      else { failed++; var c = (res && res.code) || 'ERROR'; failCodes[c] = (failCodes[c] || 0) + 1; }
      done[sid] = true; paint();
    }
    /* 0개 성공이면 결과 화면 대신 명확한 실패 요약(사유 포함). 성공이 있으면 결과 비교로. */
    var summary = L.summarizeBatchResult({ total: targets.length, succeeded: succeeded, failed: failed, failCodes: failCodes });
    if (summary.anySuccess) { _refreshImageToggleBar(); _renderResults(body); return; }   /* IMAGE-TOGGLE-REFRESH: 생성 성공분 s2로 토글 재노출 */
    var extra = summary.allFailedPolicy
      ? '<p style="font-size:12px;color:#777;margin-top:8px;line-height:1.6;">이 작품의 그림은 예전에 만들어져 입력 방식(업로드·그림판) 정보가 없어요. 관리자에게 문의해 주세요. 원본 그림은 그대로 보존됐어요.</p>'
      : '<p style="font-size:12px;color:#777;margin-top:8px;">원본 그림은 그대로 보존됐어요.</p>';
    /* AI-FINISH-REASSURE-2(2026-07-16): 실패 성격으로 분기 — 감사에서 잡힌 회귀(원인 은폐) 수정.
       · 전부 '일시적'(서버 지연/시간초과 등) → "다시 반복하면 돼요" 안심 안내(사유 숨김 유지).
       · '반복 불가'(얼굴사진 안전차단·권한/설정·원본 없음 등)가 하나라도 있으면 → 사유 목록 표시
         (숨기면 교사가 무한 헛반복). 일시적 실패가 섞여 있으면 그 몫은 재시도 안내 한 줄 추가. */
    body.innerHTML = summary.allFailedPolicy
      ? ('<div style="font-size:14px;color:#c0392b;font-weight:600;">그림을 마감하지 못했어요</div>' + extra)
      : summary.hasNonRetryable
        ? ('<div style="font-size:14px;color:#c0392b;font-weight:600;">' + _esc(summary.headline) + '</div>'
           + (summary.reasons.length ? '<ul style="margin:8px 0 0;padding-left:18px;font-size:12px;color:#a0522d;line-height:1.7;">' + summary.reasons.map(function (r) { return '<li>' + _esc(r) + '</li>'; }).join('') + '</ul>' : '')
           + (Object.keys(failCodes).some(function (c) { return L.isRetryableFailCode && L.isRetryableFailCode(c); })
               ? '<p style="font-size:12px;color:#4a7a3a;margin-top:8px;">‘잠시 후 다시 시도’ 항목은 다시 누르면 될 수 있어요.</p>' : '')
           + extra)
        : ('<div style="font-size:14px;color:#4a7a3a;font-weight:600;">이번엔 한 번에 안 만들어졌어요 😊</div>'
           + '<p style="font-size:13px;color:#555;margin-top:8px;line-height:1.7;">AI 그림책 마감은 한 번에 다 안 될 수 있어요. <b>다시 눌러 될 때까지 몇 번 반복</b>하면 만들어져요. 걱정 마세요!</p>'
           + '<p style="font-size:12px;color:#777;margin-top:8px;">원본 그림은 그대로 보존됐어요.</p>');
  }

  /* IMAGE-TOGGLE-REFRESH(2026-07-09): 배치 생성/적용으로 s2 variant가 생긴 직후 viewer-ai의 이미지 variant
     캐시를 강제 재로딩하고 그림 토글 바를 재노출 — 그림 토글은 부팅 시점 캐시(비어있음)에서만 판정돼 세션 중
     새로 만든 s2가 F5 전까지 반영 안 되던 문제(글 토글은 무조건 부트스트랩이나 그림 토글은 부팅 게이트에 막힘).
     읽기 재로딩 + 토글 재노출뿐(원본/DB write 0). 실패해도 조용히 무시. */
  async function _refreshImageToggleBar() {
    try {
      var va = window.viewerAi;
      if (va && typeof va._loadFirebaseImageVariants === 'function') { await va._loadFirebaseImageVariants(true); }
      if (va && typeof va._showAiImageToggleBar === 'function') { va._showAiImageToggleBar(); }
    } catch (e) { /* noop */ }
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
      var head = '장면 ' + _esc(id) + (cmp.s2 ? '' : ' · <span style="color:#999;">AI 결과 없음</span>') + (cmp.stale ? ' · <span style="color:#b26a00;">오래된 결과(원본이 바뀜 — 다시 생성 권장)</span>' : '') + ((cmp.oldVersion && !cmp.stale) ? ' · <span style="color:#8a7350;">이전 버전 결과(다시 생성하면 최신 품질)</span>' : '');
      row.appendChild(_el('div', { style: 'font-size:12px;color:#555;margin-bottom:6px;' }, head));
      var pair = _el('div', { style: 'display:flex;gap:8px;' });
      pair.appendChild(_el('figure', { style: 'flex:1;margin:0;' }, '<figcaption style="font-size:11px;color:#888;">원본</figcaption>' + (cmp.original ? '<img src="' + _esc(cmp.original) + '" style="width:100%;border:1px solid #eee;border-radius:6px;' + (cmp.shown === 'original' ? 'outline:2px solid #6a8a5b;' : '') + '">' : '<div style="height:90px;background:#f3f3f3;border-radius:6px;"></div>')));
      pair.appendChild(_el('figure', { style: 'flex:1;margin:0;' }, '<figcaption style="font-size:11px;color:#888;">AI 결과</figcaption>' + (cmp.s2 ? '<img src="' + _esc(cmp.s2) + '" style="width:100%;border:1px solid #eee;border-radius:6px;' + (cmp.shown === 's2' ? 'outline:2px solid #6a8a5b;' : '') + (cmp.stale ? 'opacity:.5;' : '') + '">' : '<div style="height:90px;background:#f3f3f3;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#bbb;font-size:12px;">없음</div>')));
      row.appendChild(pair);
      /* 버튼을 컬럼과 정렬: 왼쪽(원본 컬럼) 아래 = 원본 유지, 오른쪽(AI 결과 컬럼) 아래 = AI 결과 사용.
         AI 결과 없음/stale이면 AI 결과 사용 비활성. */
      var aiUsable = !!(cmp.s2 && !cmp.stale);
      var btns = _el('div', { style: 'display:flex;gap:6px;margin-top:8px;' });
      var keepBtn = _el('button', { style: 'flex:1;padding:6px;border-radius:7px;border:1px solid #ccc;background:' + (cmp.shown === 'original' ? '#eee' : '#fff') + ';font-size:12px;cursor:pointer;' }, '원본 유지');
      keepBtn.onclick = function () { _apply(ctx, id, 'original', row, s2v); };
      var useLabel = aiUsable ? 'AI 결과 사용' : (cmp.stale ? 'AI 결과 사용(오래됨)' : 'AI 결과 없음');
      var useBtn = _el('button', { style: 'flex:1;padding:6px;border-radius:7px;border:1px solid ' + (aiUsable ? '#6a8a5b' : '#ddd') + ';background:' + (aiUsable ? (cmp.shown === 's2' ? '#6a8a5b' : '#fff') : '#f3f3f3') + ';color:' + (aiUsable ? (cmp.shown === 's2' ? '#fff' : '#3a5a2a') : '#bbb') + ';font-size:12px;cursor:' + (aiUsable ? 'pointer' : 'not-allowed') + ';' }, useLabel);
      useBtn.disabled = !aiUsable;
      if (aiUsable) useBtn.onclick = function () { _apply(ctx, id, 's2', row, s2v); };
      btns.appendChild(keepBtn); btns.appendChild(useBtn);   /* 좌: 원본 유지 / 우: AI 결과 사용 */
      row.appendChild(btns);
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
    if (r && r.ok) { _refreshImageToggleBar(); }   /* IMAGE-TOGGLE-REFRESH: 적용 후에도 그림 토글 재노출 */
  }

  /* ── 교사 전용 진입 버튼(자가 주입) ── */
  function _injectEntry() {
    /* ★ floating 진입 버튼 기본 제거 — 정식 진입점은 '📁 작품 마무리' 모달의 'AI 그림책 마감' 카드.
       디버그/빠른접근용으로 ?debugImageS2=1 일 때만 표시. */
    if (_params().get('debugImageS2') !== '1') return;
    /* 학생 미노출 + 감상 모드 미노출 — 다듬기(edit=1&from=maker) 세션에서만. */
    if (!(window.isEditViewerSession && window.isEditViewerSession(location.search))) return;
    if (['picturebook', 'text'].indexOf(_ptype()) === -1 && _ptype()) return;
    if (document.getElementById('imageS2-batch-entry')) return;
    var bar = _el('div', { id: 'imageS2-batch-entry', style: 'position:fixed;right:12px;bottom:12px;z-index:99990;' });
    var btn = _el('button', { style: 'padding:9px 14px;border-radius:20px;border:none;background:#6a8a5b;color:#fff;font-size:13px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.25);font-family:-apple-system,system-ui,sans-serif;' }, '🖼️ AI 그림책 마감');
    btn.onclick = _openPanel;
    bar.appendChild(btn);
    document.body.appendChild(bar);
  }

  function _init() { try { _injectEntry(); } catch (e) {} }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init);
  else _init();

  window.imageS2BatchUi = { open: _openPanel, _injectEntry: _injectEntry };
})();
