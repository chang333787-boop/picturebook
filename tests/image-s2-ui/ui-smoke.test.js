/* IMAGE-S2-10 교사 UI DOM 스모크 — 최소 fake DOM(jsdom 없이)으로 패널/진입 빌더 동작 검증.
   실 maker 앱 시각검증은 별개(NOT_VERIFIED). 여기선 빌더가 throw 없이 구조를 만드는지 확인.
   실행: node --test tests/image-s2-ui/ui-smoke.test.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PURE = require('../../viewer-image-batch.js');

/* ── 최소 fake DOM ── */
function setupDom() {
  const REG = {};
  function makeEl(tag) {
    const el = {
      tagName: tag, children: [], attributes: {}, _html: '', _text: '', _onclick: null, _disabled: false, parent: null,
      setAttribute(k, v) { this.attributes[k] = v; if (k === 'id') REG[v] = this; },
      getAttribute(k) { return this.attributes[k]; },
      appendChild(c) { this.children.push(c); c.parent = this; return c; },
      insertBefore(c, ref) { let i = this.children.indexOf(ref); if (i < 0) i = this.children.length; this.children.splice(i, 0, c); c.parent = this; return c; },
      remove() { if (this.parent) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); } },
      addEventListener() {},
      querySelectorAll(sel) { const t = String(sel).replace(/[^a-z0-9]/gi, ''); const out = []; (function walk(n) { n.children.forEach(function (c) { if (c.tagName === t) out.push(c); walk(c); }); })(this); return out; },
      get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; this.children = []; },
      get textContent() { return this._text; }, set textContent(v) { this._text = v; },
      get onclick() { return this._onclick; }, set onclick(f) { this._onclick = f; },
      get disabled() { return this._disabled; }, set disabled(v) { this._disabled = v; },
    };
    return el;
  }
  const body = makeEl('body');
  const document = {
    readyState: 'complete', body,
    createElement: makeEl,
    getElementById(id) { return REG[id] || null; },
    addEventListener() {},
  };
  return { document, body, REG };
}

function fakeApp(DATA) {
  return { database() { return { ref(path) { return { async once() { return { val() { return DATA[path] || null; } }; } }; } }; } };
}

function loadUi(DATA, opts) {
  const dom = setupDom();
  global.window = global;
  global.document = dom.document;
  global.location = { search: (opts && opts.search) || '?classId=c&team=0000&ptype=picturebook&from=maker&edit=1' };
  global.window.ImageS2Batch = PURE;
  global.window.isMakerAuthSession = function () { return !(opts && opts.notTeacher); };
  global.window.isEditViewerSession = function () { return !(opts && opts.notTeacher); };   /* 다듬기 세션(진입 버튼 게이트) */
  let lastCall = null;
  global.window.viewerAi = {
    _getViewerFirebaseApp() { return fakeApp(DATA); },
    async _callPhaseAFunction(fn, payload) { lastCall = { fn, payload }; return { ok: true, jobId: 'j1', targets: ['1'] }; },
    _scheduleViewerFrameReRender() {},
  };
  delete require.cache[require.resolve('../../viewer-image-batch-ui.js')];
  require('../../viewer-image-batch-ui.js');
  return { dom, getLastCall: () => lastCall };
}

const DATA_READY = {
  'classes/c/aiSettings': { enabled: true, modes: { imageS2: true }, imageS2: { providerReady: true, privacyAcknowledged: true } },
  'classes/c/teams/0000/scenes': { 1: { imageData: 'data:o1' }, 2: { imageData: 'data:o2' }, 3: { title: 'no-img' } },
  'classes/c/teams/0000/viewer-meta/imagePolicy': { sourceMode: 'upload' },   /* 정책 잠금된 정상 작품 */
  'classes/c/teams/0000/aiVariants/image': { 1: { s2: { url: 'data:s2-1', stale: false } } },
  'classes/c/teams/0000/aiVariants/imageSelections': { 1: { selected: 's2' } },
};
const DATA_NOTREADY = Object.assign({}, DATA_READY, { 'classes/c/aiSettings': { enabled: true, modes: { imageS2: true } } });   /* provider/privacy 없음 — 이제는 시작 가능(차단 아님) */
const DATA_OFF = Object.assign({}, DATA_READY, { 'classes/c/aiSettings': { enabled: true, modes: { imageS2: false } } });        /* imageS2 OFF — 시작 disabled */
const DATA_NOPOLICY = Object.assign({}, DATA_READY); delete DATA_NOPOLICY['classes/c/teams/0000/viewer-meta/imagePolicy'];      /* 레거시: imagePolicy 없음 → 사전 차단 */

test('교사 세션 — 진입 버튼 자가 주입', () => {
  const { dom } = loadUi(DATA_READY);
  const entry = dom.document.getElementById('imageS2-batch-entry');
  assert.ok(entry, '진입 버튼 바 주입됨');
  assert.ok(entry.children.length >= 1);
});

test('학생 세션 — 진입 버튼 미주입', () => {
  const { dom } = loadUi(DATA_READY, { notTeacher: true });
  assert.equal(dom.document.getElementById('imageS2-batch-entry'), null);
});

test('open() — 시작 패널 빌드(요약+안내+버튼) throw 없음', async () => {
  const ui = loadUi(DATA_READY);
  await global.window.imageS2BatchUi.open();
  const panel = ui.dom.document.getElementById('imageS2-batch-panel');
  assert.ok(panel, '패널 생성');
  const bodyEl = ui.dom.document.getElementById('imageS2-batch-panel-body');
  assert.ok(bodyEl);
  /* 비동기 렌더 완료까지 한 틱 */
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(bodyEl.innerHTML.indexOf('변환할 장면') !== -1, '계획 요약 표시');
  assert.ok(bodyEl.innerHTML.indexOf('원본은 그대로 보존') !== -1, '안내 문구');
});

function _startBtn(ui) {
  const panel = ui.dom.document.getElementById('imageS2-batch-panel');
  const buttons = panel.querySelectorAll('button');
  return buttons.filter((b) => String(b.innerHTML).indexOf('마감 시작') !== -1)[0];
}

test('게이트 — imageS2 OFF면 시작 disabled', async () => {
  const ui = loadUi(DATA_OFF);
  await global.window.imageS2BatchUi.open();
  await new Promise((r) => setTimeout(r, 0));
  const startBtn = _startBtn(ui);
  assert.ok(startBtn, '시작 버튼 존재');
  assert.equal(startBtn.disabled, true, 'imageS2 OFF → disabled');
});

test('게이트 — imageS2 ON이면 provider/privacy 없이도 시작 enabled(회귀 방지)', async () => {
  const ui = loadUi(DATA_NOTREADY);
  await global.window.imageS2BatchUi.open();
  await new Promise((r) => setTimeout(r, 0));
  const startBtn = _startBtn(ui);
  assert.ok(startBtn, '시작 버튼 존재');
  assert.equal(startBtn.disabled, false, 'imageS2 ON(+이미지 장면) → enabled');
  const panel = ui.dom.document.getElementById('imageS2-batch-panel');
  assert.equal(String(panel.textContent).indexOf('준비 중'), -1, '“준비 중” 문구 없음');
});

test('게이트 — imagePolicy 없는 옛 작품은 시작 가능 + legacy 안내(차단 아님)', async () => {
  const ui = loadUi(DATA_NOPOLICY);
  await global.window.imageS2BatchUi.open();
  await new Promise((r) => setTimeout(r, 0));
  const startBtn = _startBtn(ui);
  assert.ok(startBtn, '시작 버튼 존재');
  assert.equal(startBtn.disabled, false, 'imagePolicy 없어도 그림 있으면 enabled');
  const bodyEl = ui.dom.document.getElementById('imageS2-batch-panel-body');
  assert.ok(bodyEl.innerHTML.indexOf('옛 작품') !== -1, 'legacy 안내 표시');
});
