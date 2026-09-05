/* LV1-WAIT-1 — 클라 상태 도출 순수 함수 검증(DOM/firebase 0).
   lv1-book-wait.js를 fake window로 로드해 window.Lv1Book의 순수 API만 쓴다.
   실행: node --test tests/lv1-wait/state.test.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../../lv1-book-wait.js'), 'utf8');
const win = {};
new Function('window', 'document', 'location', 'firebase', SRC)(win, { getElementById: () => null }, { search: '' }, undefined);
const B = win.Lv1Book;
const S = B.STATES;

const NOW = 1_800_000_000_000;
function scenes14() {
  const o = { 1: { type: 'cover', body: '', num: 1 } };
  for (let i = 2; i <= 14; i++) o[i] = { type: i === 14 ? 'ending' : 'normal', body: '본문 ' + i, num: i };
  return o;
}
function imgs(n, opts) {                 /* 장면 2..(1+n)에 그림 */
  const o = {};
  for (let i = 2; i < 2 + n; i++) o[i] = { s2: { url: 'https://x/' + i + '.webp' } };
  if (opts && opts.junk) { o[0] = null; o[1] = { s2: { url: 'https://x/cover.webp' } }; o['99'] = { s2: {} }; }
  return o;
}
const ON = { enabled: true, modes: { imageS2: true } };
function inp(over) {
  return Object.assign({ level: 1, scenes: scenes14(), images: imgs(0), job: null, protag: { choice: 'ai', ref: null }, aiSettings: ON, now: NOW }, over || {});
}

test('대상 술어 — 표지 제외·본문 있는 비표지만·num 순 정렬', () => {
  const t = B.computeTargets({ 5: { type: 'normal', body: 'a' }, 1: { type: 'cover', body: 'x' }, 3: { type: 'ending', body: 'b' }, 4: { type: 'normal', body: '  ' }, 2: null });
  assert.deepEqual(t, ['3', '5']);
  assert.equal(B.isImageTargetScene({ type: 'normal', body: 'x' }), true);
  assert.equal(B.isImageTargetScene({ type: 'cover', body: 'x' }), false);
  assert.equal(B.isImageTargetScene({ type: 'normal', body: '' }), false);
  assert.equal(B.isImageTargetScene(undefined), false);
});

test('have — s2.url 있는 대상만(대상 외 키·null·url 없는 s2는 제외)', () => {
  const t = B.computeTargets(scenes14());
  assert.equal(B.computeHave(t, imgs(3, { junk: true })).length, 3);
  assert.equal(B.computeHave(t, null).length, 0);
});

test('완전 고아(그림 0·job 없음·선택 ai) → RESUME', () => {
  assert.equal(B.deriveState(inp()).state, S.RESUME);
});
test('전부 있음 → DONE (job이 뭐라 하든)', () => {
  assert.equal(B.deriveState(inp({ images: imgs(13), job: { status: 'running', updatedAt: NOW } })).state, S.DONE);
});
test('2·3단계/레거시 → NONE', () => {
  assert.equal(B.deriveState(inp({ level: 2 })).state, S.NONE);
  assert.equal(B.deriveState(inp({ level: null })).state, S.NONE);
});
test('초안 전(본문 장면 0) → NONE', () => {
  assert.equal(B.deriveState(inp({ scenes: { 1: { type: 'cover', body: '' } } })).state, S.NONE);
});
test('모드 OFF → OFF (aiSettings 못 읽으면 막지 않음)', () => {
  assert.equal(B.deriveState(inp({ aiSettings: { enabled: true, modes: { imageS2: false } } })).state, S.OFF);
  assert.equal(B.deriveState(inp({ aiSettings: { enabled: false, modes: { imageS2: true } } })).state, S.OFF);
  assert.equal(B.deriveState(inp({ aiSettings: null })).state, S.RESUME);
});
test('job=limit 하루 이내 → LIMIT / 하루 지나면 RESUME', () => {
  assert.equal(B.deriveState(inp({ job: { status: 'limit', finishedAt: NOW - 3600e3 } })).state, S.LIMIT);
  assert.equal(B.deriveState(inp({ job: { status: 'limit', finishedAt: NOW - 25 * 3600e3 } })).state, S.RESUME);
});
test('선택 없음·그림 0·안 돌고 있음 → CHOICE (옛 고아 흡수)', () => {
  assert.equal(B.deriveState(inp({ protag: { choice: null, ref: null } })).state, S.CHOICE);
});
test('선택 없음이라도 돌고 있으면 WAITING / 일부 있으면 RESUME', () => {
  assert.equal(B.deriveState(inp({ protag: { choice: null, ref: null }, job: { status: 'running', updatedAt: NOW - 1000 } })).state, S.WAITING);
  assert.equal(B.deriveState(inp({ protag: { choice: null, ref: null }, images: imgs(4) })).state, S.RESUME);
});
test('그리기 선택·ref 없음·그림 0 → DRAW / ref 있으면 RESUME', () => {
  assert.equal(B.deriveState(inp({ protag: { choice: 'draw', ref: null } })).state, S.DRAW);
  assert.equal(B.deriveState(inp({ protag: { choice: 'draw', ref: 'https://s/p.png' } })).state, S.RESUME);
  assert.equal(B.deriveState(inp({ protag: { choice: 'draw', ref: 'data:image/png;base64,xx' } })).state, S.DRAW);   /* http만 ref로 인정 */
});
test('running 신선(9분59초) → WAITING / stale(10분) → RESUME', () => {
  assert.equal(B.deriveState(inp({ job: { status: 'running', updatedAt: NOW - (10 * 60e3 - 1000) } })).state, S.WAITING);
  assert.equal(B.deriveState(inp({ job: { status: 'running', updatedAt: NOW - 10 * 60e3 } })).state, S.RESUME);
  assert.equal(B.deriveState(inp({ job: { status: 'running' } })).state, S.RESUME);   /* 시각 없음 = stale */
});
test('job done/partial/error인데 일부 빠짐 → RESUME(재호출·dedup)', () => {
  for (const st of ['done', 'partial', 'error']) {
    assert.equal(B.deriveState(inp({ images: imgs(12), job: { status: st, finishedAt: NOW } })).state, S.RESUME, st);
  }
});
test('우선순위: DONE > OFF > LIMIT > CHOICE', () => {
  assert.equal(B.deriveState(inp({ images: imgs(13), aiSettings: { enabled: false } })).state, S.DONE);
  assert.equal(B.deriveState(inp({ aiSettings: { enabled: false }, job: { status: 'limit', finishedAt: NOW } })).state, S.OFF);
  assert.equal(B.deriveState(inp({ protag: { choice: null, ref: null }, job: { status: 'limit', finishedAt: NOW } })).state, S.LIMIT);
});
test('반환 형태 — targets/have/total/running 동봉', () => {
  const d = B.deriveState(inp({ images: imgs(5) }));
  assert.equal(d.total, 13); assert.equal(d.have.length, 5); assert.equal(d.targets.length, 13); assert.equal(d.running, false);
});
test('상수 — stale 10분·탈출 6분·자동 재호출 2회', () => {
  assert.equal(B.STALE_MS, 10 * 60 * 1000); assert.equal(B.ESCAPE_MS, 6 * 60 * 1000); assert.equal(B.MAX_AUTO_RESUME, 2);
});
