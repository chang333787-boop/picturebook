/* 생각 나침반 게이트 controller(상태머신) 하니스. 실행: node --test tests/thought-compass/controller.test.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Ctl = require('../../thought-compass-controller.js');
const TC = require('../../thought-compass.js');

/* 브라우저 오케스트레이션이 하는 mode/status 도출을 그대로 재현해 controller 상태를 계산(통합 검증). */
function deriveState({ projectType, onboardingVersion, copiedFrom, compassState, loadError, loading, requiredHint }) {
  const mode = TC.resolveThoughtCompassMode({ projectType, onboardingVersion, copiedFrom });
  const st = TC.normalizeThoughtCompassState(compassState);
  return Ctl.resolveControllerState({
    loading: loading === true,
    loadError: loadError === true,
    mode,
    status: st.status,
    hasCompletedAt: typeof st.completedAt === 'number',
    requiredHint: requiredHint === true || !!copiedFrom,
  });
}

test('신규 picturebook → requiredNotStarted (차단)', () => {
  const cs = deriveState({ projectType: 'picturebook', onboardingVersion: 1, compassState: null });
  assert.equal(cs.state, Ctl.STATES.REQUIRED_NOT_STARTED);
  assert.equal(cs.blocked, true);
  assert.equal(cs.showGate, true);
  assert.equal(cs.gateAction, 'start');
});

test('신규 text → requiredNotStarted (차단)', () => {
  const cs = deriveState({ projectType: 'text', onboardingVersion: 1, compassState: null });
  assert.equal(cs.state, Ctl.STATES.REQUIRED_NOT_STARTED);
  assert.equal(cs.blocked, true);
});

test('movie bypass → notApplicable (비차단)', () => {
  const cs = deriveState({ projectType: 'movie', onboardingVersion: 1, compassState: null });
  assert.equal(cs.state, Ctl.STATES.NOT_APPLICABLE);
  assert.equal(cs.blocked, false);
});

test('experience bypass → notApplicable (비차단)', () => {
  const cs = deriveState({ projectType: 'experience', onboardingVersion: 1, compassState: null });
  assert.equal(cs.state, Ctl.STATES.NOT_APPLICABLE);
  assert.equal(cs.blocked, false);
});

test('기존 그림책 미시작 optional → optionalNotStarted (maker 진입 허용)', () => {
  const cs = deriveState({ projectType: 'picturebook', compassState: null });
  assert.equal(cs.state, Ctl.STATES.OPTIONAL_NOT_STARTED);
  assert.equal(cs.blocked, false);
  assert.equal(cs.showOptionalButton, true);
  assert.equal(cs.optionalAction, 'start');
});

test('optional 시작 후 → requiredInProgress (완료까지 차단)', () => {
  const cs = deriveState({ projectType: 'picturebook', compassState: { status: 'inProgress', startedAt: 1, completedAt: null } });
  assert.equal(cs.state, Ctl.STATES.REQUIRED_IN_PROGRESS);
  assert.equal(cs.blocked, true);
  assert.equal(cs.gateAction, 'resume');
});

test('신규 진행 중 → requiredInProgress (이어서, 차단)', () => {
  const cs = deriveState({ projectType: 'text', onboardingVersion: 1, compassState: { status: 'inProgress', startedAt: 1, completedAt: null } });
  assert.equal(cs.state, Ctl.STATES.REQUIRED_IN_PROGRESS);
  assert.equal(cs.blocked, true);
});

test('completed → completed (maker 진입 허용 + 다시보기 버튼)', () => {
  const cs = deriveState({ projectType: 'text', onboardingVersion: 1, compassState: { status: 'completed', completedAt: 123 } });
  assert.equal(cs.state, Ctl.STATES.COMPLETED);
  assert.equal(cs.blocked, false);
  assert.equal(cs.showOptionalButton, true);
  assert.equal(cs.optionalAction, 'review');
});

test('load 실패 + required → error (fail-closed 차단)', () => {
  const cs = deriveState({ projectType: 'picturebook', onboardingVersion: 1, loadError: true });
  assert.equal(cs.state, Ctl.STATES.ERROR);
  assert.equal(cs.blocked, true);
  assert.equal(cs.retry, true);
});

test('load 실패 + requiredHint(신규, onboardingVersion 못읽음) → error 차단', () => {
  const cs = deriveState({ projectType: 'picturebook', onboardingVersion: null, loadError: true, requiredHint: true });
  assert.equal(cs.state, Ctl.STATES.ERROR);
  assert.equal(cs.blocked, true);
});

test('load 실패 + optional(기존) → error 비차단 (완료 오인 금지, maker는 진입)', () => {
  const cs = deriveState({ projectType: 'picturebook', loadError: true });
  assert.equal(cs.state, Ctl.STATES.ERROR);
  assert.equal(cs.blocked, false);
});

test('load 실패를 completed로 간주하지 않음', () => {
  const cs = deriveState({ projectType: 'picturebook', onboardingVersion: 1, loadError: true });
  assert.notEqual(cs.state, Ctl.STATES.COMPLETED);
});

test('loading → loading (차단, 게이트/버튼 미표시)', () => {
  const cs = Ctl.resolveControllerState({ loading: true });
  assert.equal(cs.state, Ctl.STATES.LOADING);
  assert.equal(cs.blocked, true);
  assert.equal(cs.showGate, false);
});

test('복사본(copiedFrom) → required (onboardingVersion 없어도)', () => {
  const cs = deriveState({ projectType: 'picturebook', copiedFrom: 'abc', compassState: null });
  assert.equal(cs.state, Ctl.STATES.REQUIRED_NOT_STARTED);
  assert.equal(cs.blocked, true);
});

test('상태머신 결정성(idempotent) — 동일 입력 동일 결과', () => {
  const inp = { mode: 'required', status: 'notStarted' };
  assert.deepEqual(Ctl.resolveControllerState(inp), Ctl.resolveControllerState(inp));
});

test('completed인데 completedAt 없음(불일치) → 완료 아님, inProgress로 차단', () => {
  /* normalize가 completed+completedAt없음 → inProgress 강등 */
  const cs = deriveState({ projectType: 'text', onboardingVersion: 1, compassState: { status: 'completed' } });
  assert.equal(cs.state, Ctl.STATES.REQUIRED_IN_PROGRESS);
  assert.equal(cs.blocked, true);
});
