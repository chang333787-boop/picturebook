/* ════════════════════════════════════════════════════════════════
   IMAGE-S2-10 — 교사용 "AI 그림책 마감" 클라 순수 로직 (DOM 비의존)
   ──────────────────────────────────────────────────────────────
   게이트·계획 요약·진행 상태·요청 sanitizer·원본↔s2 비교 결정.
   브라우저(window) + node(module.exports) 양쪽. DOM/Firebase 없음 → node 단독 테스트.
   ★ 클라는 sceneId/ids 만 서버로 보낸다(url/prompt/provider/sourceMode/storagePath/cost 금지).
   ★ scene.imageData 절대 미수정(이 모듈은 결정/표시 계산만).
   ════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var PER_IMAGE_USD = 0.05;        /* gpt-image-2 medium landscape 추정 */
  var PER_IMAGE_SECONDS = 70;      /* 보수적(실측 50~70s) */

  /* 시작 게이트 — 교사 + 관리자 설정(modes.imageS2 ON) + 변환할 이미지 장면이 있어야 시작 가능.
     ★ providerReady/privacyAcknowledged는 미구현 플래그 → 시작을 "영구" 차단하지 않는다(과거 '준비 중' 버그의 원인).
       secret/배포 문제는 서버가 not-configured 오류로 방어, 개인정보는 차단이 아니라 안내 문구(privacyNotice)로 표시.
     ★ imageSceneCount/pendingCount는 선택적(미전달이면 검사 생략 — 순수 게이트 테스트 호환). */
  function computeBatchGate(opts) {
    var o = opts || {};
    if (o.isTeacher !== true) return { canStart: false, state: 'not-teacher', reason: '담당 선생님만 사용할 수 있어요.' };
    if (o.imageS2Enabled !== true) return { canStart: false, state: 'disabled', reason: '관리자 설정에서 ‘AI 그림책 마감’을 켜 주세요.' };
    if (o.imageSceneCount != null && o.imageSceneCount <= 0) return { canStart: false, state: 'no-images', reason: '변환할 이미지 장면이 없어요.' };
    if (o.pendingCount != null && o.pendingCount <= 0) return { canStart: false, state: 'all-done', reason: '모든 그림이 이미 마감됐어요. ‘결과 보기’에서 확인하세요.' };
    return { canStart: true, state: 'ready', reason: null, privacyNotice: o.privacyAcknowledged !== true };
  }

  function formatCostUsd(usd) {
    var n = (typeof usd === 'number' && isFinite(usd)) ? usd : 0;
    return '$' + (Math.round(n * 100) / 100).toFixed(2);
  }
  function formatDuration(seconds) {
    var s = Math.max(0, Math.round(Number(seconds) || 0));
    var m = Math.floor(s / 60); var r = s % 60;
    if (m <= 0) return '약 ' + r + '초';
    if (r === 0) return '약 ' + m + '분';
    return '약 ' + m + '분 ' + r + '초';
  }

  /* 시작 전 요약 — 서버 plan(totalScenes/cachedCount/skipped/estCostUsd/estSeconds) 또는 raw counts 로 계산. */
  function summarizeBatchPlan(plan) {
    var p = plan || {};
    var need = (typeof p.totalScenes === 'number') ? p.totalScenes : 0;
    var cached = (typeof p.cachedCount === 'number') ? p.cachedCount : ((p.cached && p.cached.length) || 0);
    var skipped = (typeof p.skippedCount === 'number') ? p.skippedCount : ((p.skipped && p.skipped.length) || 0);
    var estCost = (typeof p.estCostUsd === 'number') ? p.estCostUsd : Math.round(need * PER_IMAGE_USD * 1e6) / 1e6;
    var estSec = (typeof p.estSeconds === 'number') ? p.estSeconds : need * PER_IMAGE_SECONDS;
    return {
      needCount: need, cachedCount: cached, skippedCount: skipped,
      estCostUsd: estCost, estSeconds: estSec,
      needLabel: '변환할 장면 ' + need + '개',
      cachedLabel: cached > 0 ? ('이미 최신 결과 ' + cached + '개(건너뜀)') : '',
      costLabel: '예상 비용 ' + formatCostUsd(estCost) + ' (장당 약 ' + formatCostUsd(PER_IMAGE_USD) + ')',
      timeLabel: '예상 시간 ' + formatDuration(estSec) + ' (장당 약 50~70초)',
    };
  }

  /* 클라→서버 요청 sanitize — 허용 키만. url/prompt/provider/sourceMode/storagePath/cost 등은 제거. */
  function sanitizeBatchRequest(input) {
    var d = (input && typeof input === 'object') ? input : {};
    var out = {};
    if (typeof d.classId === 'string' && d.classId) out.classId = d.classId;
    if (typeof d.teamName === 'string' && d.teamName) out.teamName = d.teamName;
    out.forceRegenerate = d.forceRegenerate === true;
    if (Array.isArray(d.sceneIds)) {
      var ids = d.sceneIds.filter(function (x) { return (typeof x === 'string' || typeof x === 'number') && String(x) !== ''; }).map(String);
      if (ids.length) out.sceneIds = ids;
    }
    return out;
  }

  var SCENE_LABELS = {
    pending: '대기 중', processing: '변환 중…', succeeded: '완료', failed: '실패',
    skipped: '건너뜀', cached: '최신 결과 있음', stale: '원본 변경됨',
  };
  function sceneStatusLabel(status) { return SCENE_LABELS[status] || status || ''; }

  /* job state(sceneStates) → 진행 요약(UI용). */
  function progressSummary(jobState) {
    var ss = (jobState && jobState.sceneStates) || {};
    var c = { total: 0, succeeded: 0, cached: 0, failed: 0, skipped: 0, pending: 0, processing: 0, stale: 0 };
    var ids = Object.keys(ss);
    for (var i = 0; i < ids.length; i++) {
      c.total++; var st = ss[ids[i]].status;
      if (Object.prototype.hasOwnProperty.call(c, st)) c[st]++;
    }
    var done = c.succeeded + c.cached + c.skipped + c.failed;
    var remaining = c.pending + c.processing + c.failed + c.stale;
    c.doneCount = done;
    c.remainingCount = remaining;
    c.estSecondsRemaining = remaining * PER_IMAGE_SECONDS;
    c.percent = c.total > 0 ? Math.round((c.succeeded + c.cached + c.skipped) / c.total * 100) : 0;
    c.label = (c.succeeded + c.cached + c.skipped) + ' / ' + c.total;
    return c;
  }

  /* 다음 처리할 장면(클라 순차 오케스트레이션) — pending/failed 중 doneSet 에 없는 첫 장면. */
  function nextTarget(targets, doneSet) {
    var ds = doneSet || {};
    var arr = targets || [];
    for (var i = 0; i < arr.length; i++) { var id = String(arr[i]); if (!ds[id]) return id; }
    return null;
  }

  /* 원본↔s2 비교 결정(교사 결과 확인용·표시 계산만). selection.selected==='s2' && s2 usable → s2, 아니면 원본. */
  function resolveCompareImages(scene, selection, s2Variant) {
    var orig = (scene && (typeof scene.imageData === 'string' && scene.imageData ? scene.imageData : (typeof scene.imageUrl === 'string' ? scene.imageUrl : null))) || null;
    var s2 = (s2Variant && typeof s2Variant.url === 'string' && s2Variant.url) ? s2Variant.url : null;
    var stale = !!(s2Variant && s2Variant.stale === true);
    var s2Usable = !!(s2 && !stale);
    var selected = (selection && selection.selected === 's2') ? 's2' : 'original';
    var shown = (selected === 's2' && s2Usable) ? 's2' : 'original';
    return {
      original: orig, s2: s2, s2Usable: s2Usable, stale: stale,
      selected: selected, shown: shown,
      shownSrc: shown === 's2' ? s2 : orig,
      staleWarning: selected === 's2' && stale,   /* 선택은 s2인데 stale → 경고 + 원본 표시 */
    };
  }

  var api = {
    PER_IMAGE_USD: PER_IMAGE_USD, PER_IMAGE_SECONDS: PER_IMAGE_SECONDS,
    computeBatchGate: computeBatchGate, formatCostUsd: formatCostUsd, formatDuration: formatDuration,
    summarizeBatchPlan: summarizeBatchPlan, sanitizeBatchRequest: sanitizeBatchRequest,
    sceneStatusLabel: sceneStatusLabel, progressSummary: progressSummary, nextTarget: nextTarget,
    resolveCompareImages: resolveCompareImages,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ImageS2Batch = api;
})(typeof window !== 'undefined' ? window : null);
