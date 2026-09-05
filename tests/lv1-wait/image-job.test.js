/* LV1-WAIT-1 — 서버 진행 노드 순수 헬퍼 + index.js 배선 정적 가드 + 클라/서버 술어 대칭.
   실행: node --test tests/lv1-wait/image-job.test.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const J = require('../../functions/lv1-image-job.js');
const INDEX = fs.readFileSync(path.join(__dirname, '../../functions/index.js'), 'utf8');

/* 클라 모듈도 로드해 술어 대칭 확인 */
const CLI = fs.readFileSync(path.join(__dirname, '../../lv1-book-wait.js'), 'utf8');
const win = {};
new Function('window', 'document', 'location', 'firebase', CLI)(win, { getElementById: () => null }, { search: '' }, undefined);

test('buildJobStart — running·done 0·failed null·시각·by', () => {
  const j = J.buildJobStart({ total: 13, now: 5, by: 'u'.repeat(100) });
  assert.equal(j.status, 'running'); assert.equal(j.total, 13); assert.equal(j.done, 0);
  assert.equal(j.failed, null); assert.equal(j.startedAt, 5); assert.equal(j.updatedAt, 5); assert.equal(j.finishedAt, null);
  assert.equal(j.by.length, 64); assert.equal(j.v, J.JOB_VERSION);
  assert.equal(J.buildJobStart({ total: -3 }).total, 0);
});

test('finalStatus — error > limit > partial > done', () => {
  assert.equal(J.finalStatus({ total: 13, done: 13, failedCount: 0 }), 'done');
  assert.equal(J.finalStatus({ total: 13, done: 12, failedCount: 1 }), 'partial');
  assert.equal(J.finalStatus({ total: 13, done: 9, failedCount: 0 }), 'partial');     /* 미완(시간) */
  assert.equal(J.finalStatus({ total: 13, done: 5, limitReached: true }), 'limit');
  assert.equal(J.finalStatus({ total: 13, done: 5, globalLimitReached: true }), 'limit');
  assert.equal(J.finalStatus({ total: 13, done: 13, limitReached: true, errored: true }), 'error');
});

test('buildJobFinish — status/total/updatedAt/finishedAt만(done/failed는 워커 누적 보존)', () => {
  const f = J.buildJobFinish({ total: 13, done: 13, failedCount: 0, now: 9 });
  assert.deepEqual(Object.keys(f).sort(), ['finishedAt', 'status', 'total', 'updatedAt']);
  assert.equal(f.status, 'done'); assert.equal(f.finishedAt, 9);
});

test('isJobRunning — 10분 stale 경계', () => {
  const now = 1_800_000_000_000;
  assert.equal(J.isJobRunning({ status: 'running', updatedAt: now - (J.JOB_STALE_MS - 1) }, now), true);
  assert.equal(J.isJobRunning({ status: 'running', updatedAt: now - J.JOB_STALE_MS }, now), false);
  assert.equal(J.isJobRunning({ status: 'done', updatedAt: now }, now), false);
  assert.equal(J.isJobRunning(null, now), false);
});

test('대상 술어 — 클라(lv1-book-wait)와 서버(lv1-image-job) 결과 동일', () => {
  const cases = [
    { type: 'normal', body: 'x' }, { type: 'cover', body: 'x' }, { type: 'ending', body: ' ' }, { type: 'ending', body: '끝' },
    { body: 'no type' }, {}, null, 'str', { type: 'normal', body: 3 },
  ];
  for (const c of cases) assert.equal(win.Lv1Book.isImageTargetScene(c), J.isImageTargetScene(c), JSON.stringify(c));
  assert.equal(win.Lv1Book.STALE_MS, J.JOB_STALE_MS);
});

test('index.js 배선 가드 — 시작 1·bump 2·fail 7·finish 2·단일은 무기록·reset/clone 반영', () => {
  const fn = INDEX.slice(INDEX.indexOf('exports.generateStoryImages = onCall('), INDEX.indexOf('exports.teacherCloneTeamFull'));
  assert.ok(fn.includes("const jobRef = singleSceneId ? null : baseRef.child('aiVariants/imageJob');"), 'jobRef 단일 무기록');
  assert.equal((fn.match(/Lv1Job\.buildJobStart\(/g) || []).length, 1);
  assert.equal((fn.match(/await _jobBump\(\)/g) || []).length, 2, 'skip+generated');
  assert.equal((fn.match(/await _fail\(sid, /g) || []).length, 7, '실패 지점 7곳');
  assert.equal((fn.match(/await _jobFinish\(/g) || []).length, 2, '정상+예외 종료');
  assert.ok(fn.includes('Lv1Job.isImageTargetScene(scenes[sid])'), '대상 술어 공유');
  assert.equal((fn.match(/failed\.push\(/g) || []).length, 1, 'failed.push는 _fail 헬퍼 안 1곳뿐');
  assert.ok(INDEX.includes("`${base}/viewer-meta/lv1Protag`"), 'reset 목록');
  assert.ok(INDEX.includes("delete val.imageJob;"), 'clone 제외');
});
