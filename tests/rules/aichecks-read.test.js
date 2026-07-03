/* AICHECKS-RULES-READ-1 — aiChecks(서버 저장 AI 결과) read 권한 매트릭스.
   결과 보기/고쳐쓰기 자료 인쇄가 실환경 permission_denied로 실패하던 원인(규칙 부재) 수정 검증.
   read = 해당 팀 active member · 담당 교사 · super_admin 만. write = 전원 거부(서버 Admin 전용).
   기존 scenes/viewer-meta 규칙 회귀 가드 포함. */
import { test, before, after, beforeEach } from 'node:test';
import {
  getEnv, cleanup, clearData, seed,
  anon, student, teacher, superAdmin,
  readPath, writePath, assertSucceeds, assertFails,
} from './helpers.js';
import { fixtureTree, P, STUDENT_A, STUDENT_B, TEACHER_A, TEACHER_B } from './fixtures.js';

let env;
before(async () => { env = await getEnv(); });
after(async () => { await cleanup(); });
beforeEach(async () => { await clearData(); await seed(env, fixtureTree()); });

const AICHECKS = P.aiChecks('classA', 'teamPrivate');
const WAQ = P.waqLatest('classA', 'teamPrivate');
const WC  = P.wcLatest('classA', 'teamPrivate');

/* ── read 허용 매트릭스 ── */
test('AICHECKS 해당 팀 active member → read 허용 (waq latest)', async () => {
  await assertSucceeds(readPath(student(env, STUDENT_A), WAQ));
});
test('AICHECKS 해당 팀 active member → read 허용 (workCheck latest)', async () => {
  await assertSucceeds(readPath(student(env, STUDENT_A), WC));
});
test('AICHECKS 담당 교사 → read 허용', async () => {
  await assertSucceeds(readPath(teacher(env, TEACHER_A), AICHECKS));
});
test('AICHECKS super_admin → read 허용', async () => {
  await assertSucceeds(readPath(superAdmin(env, 'root-uid'), AICHECKS));
});

/* ── read 거부 매트릭스 ── */
test('AICHECKS 미인증(anonymous unauth) → read 거부', async () => {
  await assertFails(readPath(anon(env), AICHECKS));
});
test('AICHECKS 다른 학급 교사 → read 거부', async () => {
  await assertFails(readPath(teacher(env, TEACHER_B), WAQ));
});
test('AICHECKS 같은 학급 비멤버 학생 → read 거부', async () => {
  await assertFails(readPath(student(env, STUDENT_B), WAQ));
});

/* ── write 전원 거부 (서버 Admin SDK 전용) ── */
test('AICHECKS active member write → 거부', async () => {
  await assertFails(writePath(student(env, STUDENT_A), WAQ, { result: { hacked: true } }));
});
test('AICHECKS 담당 교사 write → 거부', async () => {
  await assertFails(writePath(teacher(env, TEACHER_A), WC, { result: { hacked: true } }));
});
test('AICHECKS super_admin write → 거부 (client write 전면 금지)', async () => {
  await assertFails(writePath(superAdmin(env, 'root-uid'), WAQ, { result: { hacked: true } }));
});

/* ── 인접 규칙 회귀 가드 ── */
test('AICHECKS 추가 후에도 private scenes read 매트릭스 유지 (member 허용/anon 거부)', async () => {
  await assertSucceeds(readPath(student(env, STUDENT_A), P.scenes('classA', 'teamPrivate')));
  await assertFails(readPath(anon(env), P.scenes('classA', 'teamPrivate')));
});
test('AICHECKS 추가 후에도 aiVariants read:true 유지', async () => {
  await assertSucceeds(readPath(anon(env), 'classes/classA/teams/teamPrivate/aiVariants'));
});
