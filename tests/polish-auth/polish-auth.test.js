/* POLISH-AUTH-FIX — 편집 뷰어 인증(앱/세션 선택) 단위 하니스.
   DOM·Firebase SDK 없이 viewer-data.js의 순수 선택 로직만 검증.
   실행: node --test tests/polish-auth/polish-auth.test.js

   ── 버그 재현 맥락 ───────────────────────────────────────────────
   maker는 firebase.js의 default app([DEFAULT])에서 익명 로그인 → 그 UID에
   members/{uid}/status='active'가 박힌다. 반면 편집 뷰어는 named 'viewer' app에서
   별도 익명 로그인 → 다른 UID → 비공개(v2) scenes Rules(멤버/교사 필요)에서 거부.
   (Rules 레벨 재현·회귀는 tests/rules/database.rules.test.js:
      '비member 학생이 비공개 scenes read 거부' / 'active member가 자기 팀 비공개 scenes read 허용'
      / '비로그인이 공개 작품 scenes read 허용' 가 이미 커버.)
   여기서는 그 거부를 부르는 "잘못된 앱/UID 선택"이 고쳐졌는지 — 즉 편집 세션에서
   default app(=maker UID 복원)을, 공개 감상에서 named 'viewer' app을 고르는지 — 를 잠근다.
   ───────────────────────────────────────────────────────────────── */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
function loadVD() {
  delete require.cache[require.resolve('../../viewer-data.js')];
  return require('../../viewer-data.js');
}
function withGlobals(search, firebase, fn) {
  const prevLoc = global.location, prevFb = global.firebase;
  global.location = { search };
  global.firebase = firebase;
  try { return fn(); }
  finally {
    if (prevLoc === undefined) delete global.location; else global.location = prevLoc;
    if (prevFb === undefined) delete global.firebase; else global.firebase = prevFb;
  }
}

/* ── isEditViewerSession: 편집 뷰어 세션 판정(라우팅 분기점) ── */
test('편집: ?edit=1&from=maker → 편집 세션', () => {
  assert.equal(loadVD().isEditViewerSession('?team=2모둠&edit=1&from=maker'), true);
});
test('편집: scene 등 추가 파라미터 있어도 → 편집 세션', () => {
  assert.equal(loadVD().isEditViewerSession('?team=2모둠&edit=1&from=maker&scene=3&classId=abc'), true);
});
test('공개: from/edit 없음 → 편집 세션 아님(공개 감상 보존)', () => {
  assert.equal(loadVD().isEditViewerSession('?team=2모둠'), false);
});
test('비편집: edit=1만 있고 from≠maker → 편집 세션 아님', () => {
  assert.equal(loadVD().isEditViewerSession('?team=2모둠&edit=1'), false);
});
test('비편집: from=maker만 있고 edit 없음(완성본 보기) → 편집 세션 아님', () => {
  assert.equal(loadVD().isEditViewerSession('?team=2모둠&from=maker'), false);
});
test('빈 쿼리 → 편집 세션 아님', () => {
  assert.equal(loadVD().isEditViewerSession(''), false);
});

/* ── isMakerAuthSession: from=maker 전체(편집+완성본보기+교사보기) ── */
test('maker세션: 다듬기(edit=1&from=maker) → maker 인증 세션', () => {
  assert.equal(loadVD().isMakerAuthSession('?team=t&edit=1&from=maker'), true);
});
test('maker세션: 완성본 보기(from=maker, edit 없음) → maker 인증 세션 (Phase J 확장)', () => {
  assert.equal(loadVD().isMakerAuthSession('?team=t&from=maker'), true);
});
test('maker세션: 교사 보기(from=maker&classId) → maker 인증 세션', () => {
  assert.equal(loadVD().isMakerAuthSession('?team=t&classId=c&from=maker'), true);
});
test('maker세션 아님: 공개 감상(from 없음) → false (named viewer 익명 유지)', () => {
  assert.equal(loadVD().isMakerAuthSession('?team=t&classId=c'), false);
});

/* ── getViewerApp: 세션별 올바른 Firebase app 선택 ── */
function fakeFirebase(created) {
  return {
    app: (name) => { throw new Error('no app: ' + (name || '[DEFAULT]')); },  // 항상 미초기화 → initializeApp 경로
    initializeApp: (cfg, name) => { const a = { __name: name || '[DEFAULT]' }; if (created) created.push(a.__name); return a; },
  };
}

test('편집 세션 → default app([DEFAULT]) 선택 (= maker UID 복원 경로, 버그 수정의 핵심)', () => {
  const VD = loadVD();
  const created = [];
  const app = withGlobals('?team=t&edit=1&from=maker', fakeFirebase(created), () => VD.getViewerApp());
  assert.equal(app.__name, '[DEFAULT]');
  assert.deepEqual(created, ['[DEFAULT]']);   // named 'viewer' app은 만들지 않음
});

test('공개 감상 → named "viewer" app 선택 (기존 동작 보존 — 회귀 가드)', () => {
  const VD = loadVD();
  const created = [];
  const app = withGlobals('?team=t', fakeFirebase(created), () => VD.getViewerApp());
  assert.equal(app.__name, 'viewer');
  assert.deepEqual(created, ['viewer']);      // default app은 만들지 않음(공개 감상 byte-unchanged)
});

test('완성본 보기(from=maker, edit 없음) → default app (Phase J: maker 미리보기도 maker UID)', () => {
  const VD = loadVD();
  const created = [];
  const app = withGlobals('?team=t&from=maker', fakeFirebase(created), () => VD.getViewerApp());
  assert.equal(app.__name, '[DEFAULT]');
  assert.deepEqual(created, ['[DEFAULT]']);   // 비공개 미리보기도 maker 권한으로 읽도록
});

test('교사 보기(from=maker&classId, edit 없음) → default app', () => {
  const VD = loadVD();
  const app = withGlobals('?team=t&classId=c&from=maker', fakeFirebase(), () => VD.getViewerApp());
  assert.equal(app.__name, '[DEFAULT]');
});

test('이미 init된 app이 있으면 재사용(initializeApp 호출 안 함)', () => {
  const VD = loadVD();
  const fb = {
    app: (name) => ({ __name: name || '[DEFAULT]', __reused: true }),
    initializeApp: () => { throw new Error('초기화 재호출되면 안 됨'); },
  };
  const editApp = withGlobals('?team=t&edit=1&from=maker', fb, () => VD.getViewerApp());
  assert.equal(editApp.__name, '[DEFAULT]');
  assert.equal(editApp.__reused, true);
  const pubApp = withGlobals('?team=t', fb, () => VD.getViewerApp());
  assert.equal(pubApp.__name, 'viewer');
});
