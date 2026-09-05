/* ════════════════════════════════════════════════════════════════
   LV1-WAIT-1(2026-09-05): 1단계 자동 그림 배치의 "진행 노드" 순수 헬퍼.
   ──────────────────────────────────────────────────────────────
   · 위치: classes/{cid}/teams/{team}/aiVariants/imageJob
     aiVariants는 rules가 read:true / write:false → 학생이 읽을 수 있고 아이가 지울 수 없다.
     rules 무변경. (aiUsage는 학생 read 불가·viewer-meta는 학생 쓰기 가능이라 서버 진실로 부적합)
   · 쓰는 쪽: generateStoryImages 배치(비단일) 호출만. 🔁 단일 재생성은 건드리지 않는다.
   · 읽는 쪽: 클라 lv1-book-wait.js 상태 도출(WAITING/RESUME/LIMIT 판정). 진행률의 진실은
     이 노드의 done이 아니라 aiVariants/image 실제 도착 수 — 이 노드는 "돌고 있나·어떻게 끝났나"만 준다.
   · 이 파일은 firebase/네트워크 0 — 하니스가 그대로 로드한다.
   정본: docs/lv1_wait_screen_design_20260905.md §3.1·§4
   ════════════════════════════════════════════════════════════════ */
'use strict';

const JOB_VERSION = 1;
const JOB_STATUS = Object.freeze({
  RUNNING: 'running',
  DONE: 'done',        /* 전부 완료 */
  PARTIAL: 'partial',  /* 일부 실패 또는 미완(총량/시간) */
  LIMIT: 'limit',      /* 팀 총량·전역 캡 도달 */
  ERROR: 'error',      /* 예외로 종료 */
});
/* running이 이 시간 동안 갱신 없으면 죽은 것으로 본다 — 서버 배치 lock stale(10분)과 동일값 */
const JOB_STALE_MS = 10 * 60 * 1000;

function _num(v) { return (typeof v === 'number' && isFinite(v)) ? v : 0; }

/* 배치 시작 레코드(lock 획득 직후·transaction 성공 시에만 set) */
function buildJobStart(o) {
  o = o || {};
  const now = _num(o.now) || Date.now();
  return {
    v: JOB_VERSION,
    status: JOB_STATUS.RUNNING,
    total: Math.max(0, Math.floor(_num(o.total))),
    done: 0,
    failed: null,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    by: (typeof o.by === 'string' && o.by) ? o.by.slice(0, 64) : null,
  };
}

/* 종료 상태 판정 — 우선순위: error > limit > partial > done */
function finalStatus(o) {
  o = o || {};
  if (o.errored === true) return JOB_STATUS.ERROR;
  if (o.limitReached === true || o.globalLimitReached === true) return JOB_STATUS.LIMIT;
  const total = _num(o.total), done = _num(o.done), failedCount = _num(o.failedCount);
  if (failedCount > 0) return JOB_STATUS.PARTIAL;
  if (done < total) return JOB_STATUS.PARTIAL;
  return JOB_STATUS.DONE;
}

/* 종료 update 페이로드(update로 병합 — done/failed는 워커가 이미 누적) */
function buildJobFinish(o) {
  o = o || {};
  const now = _num(o.now) || Date.now();
  return {
    status: finalStatus(o),
    total: Math.max(0, Math.floor(_num(o.total))),
    updatedAt: now,
    finishedAt: now,
  };
}

/* 클라와 동일한 "돌고 있나" 판정(서버 쪽 재사용·하니스 대칭 검증용) */
function isJobRunning(job, now) {
  if (!job || typeof job !== 'object') return false;
  if (job.status !== JOB_STATUS.RUNNING) return false;
  const t = _num(job.updatedAt) || _num(job.startedAt);
  if (!t) return false;
  return ((_num(now) || Date.now()) - t) < JOB_STALE_MS;
}

/* 배치 대상 술어 — generateStoryImages의 대상 산정과 문자 그대로 동일해야 한다(클라 lv1-book-wait.js도 동일) */
function isImageTargetScene(sc) {
  if (!sc || typeof sc !== 'object' || sc.type === 'cover') return false;
  return typeof sc.body === 'string' && sc.body.trim().length > 0;
}

module.exports = {
  JOB_VERSION, JOB_STATUS, JOB_STALE_MS,
  buildJobStart, finalStatus, buildJobFinish, isJobRunning, isImageTargetScene,
};
