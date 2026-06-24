/* RTDB 보안 Rules 테스트 (SEC-2 자식별 read + isPublic 강제 적용 후).
   · SECURED      = 과거 CURRENT_VULNERABILITY가 거부로 뒤집힘.
   · MUST_PRESERVE = 보안 전환 후에도 유지되는 동작(공개 감상·교사 관리·maker write).
   · MEMBER       = 멤버십 보유자 양성 경로. */
import { test, before, after, beforeEach } from 'node:test';
import {
  getEnv, cleanup, clearData, seed,
  anon, student, teacher, superAdmin,
  readPath, writePath, assertSucceeds, assertFails,
} from './helpers.js';
import { fixtureTree, P, TEACHER_A, STUDENT_A, STUDENT_B } from './fixtures.js';

let env;
before(async () => { env = await getEnv(); });
after(async () => { await cleanup(); });
beforeEach(async () => { await clearData(); await seed(env, fixtureTree()); });

/* ───────── SECURED — 과거 취약점이 이제 거부 ───────── */
test('SECURED 비로그인 비공개 scenes read 거부', async () => {
  await assertFails(readPath(anon(env), P.scenes('classA', 'teamPrivate')));
});
test('SECURED 비로그인 pin read 거부', async () => {
  await assertFails(readPath(anon(env), P.pin('classA', 'teamLegacy')));
});
test('SECURED 비로그인 account.pin read 거부', async () => {
  await assertFails(readPath(anon(env), P.accountPin('classA', 'teamManaged')));
});
test('SECURED 비member 학생이 pin read 거부', async () => {
  await assertFails(readPath(student(env, STUDENT_B), P.pin('classA', 'teamLegacy')));
});
test('SECURED 비member 학생이 비공개 scenes read 거부', async () => {
  await assertFails(readPath(student(env, STUDENT_B), P.scenes('classA', 'teamPrivate')));
});
test('SECURED 비로그인 members read 거부', async () => {
  await assertFails(readPath(anon(env), P.members('classA', 'teamPrivate', STUDENT_A)));
});
test('SECURED 다른 학생의 membership read 거부', async () => {
  await assertFails(readPath(student(env, STUDENT_B), P.members('classA', 'teamPrivate', STUDENT_A)));
});
test('SECURED 비member 학생이 editSession read 거부', async () => {
  await assertFails(readPath(student(env, STUDENT_B), `classes/classA/teams/teamPrivate/editSession`));
});
test('SECURED 비member 학생이 writingGuide read 거부', async () => {
  await assertFails(readPath(student(env, STUDENT_B), `classes/classA/teams/teamPrivate/writingGuide`));
});
test('SECURED 교사가 다른 학급 팀 목록 read 거부', async () => {
  await assertFails(readPath(teacher(env, TEACHER_A), 'classes/classB/teams'));
});
test('SECURED 교사가 다른 학급 pin read 거부', async () => {
  await assertFails(readPath(teacher(env, TEACHER_A), P.pin('classB', 'teamOther')));
});
test('SECURED 학생이 members를 직접 write 거부', async () => {
  await assertFails(
    writePath(student(env, STUDENT_B), P.members('classA', 'teamPrivate', STUDENT_B),
      { status: 'active' }));
});

/* ───────── MEMBER — 멤버십 보유자 양성 경로 ───────── */
test('MEMBER active member가 자기 팀 비공개 scenes read 허용', async () => {
  await assertSucceeds(readPath(student(env, STUDENT_A), P.scenes('classA', 'teamPrivate')));
});
test('MEMBER 학생이 자기 membership read 허용', async () => {
  await assertSucceeds(readPath(student(env, STUDENT_A), P.members('classA', 'teamPrivate', STUDENT_A)));
});
test('MEMBER active member가 editSession read 허용', async () => {
  await assertSucceeds(readPath(student(env, STUDENT_A), `classes/classA/teams/teamPrivate/editSession`));
});

/* ───────── MUST_PRESERVE — 전환 후에도 유지 ───────── */
test('MUST_PRESERVE 비로그인이 공개 작품 scenes read 허용', async () => {
  await assertSucceeds(readPath(anon(env), P.scenes('classA', 'teamPublic')));
});
test('MUST_PRESERVE 비로그인이 공개 작품 viewer-meta read 허용', async () => {
  await assertSucceeds(readPath(anon(env), P.meta('classA', 'teamPublic')));
});
test('MUST_PRESERVE 교사가 자기 학급 팀 목록 read 허용', async () => {
  await assertSucceeds(readPath(teacher(env, TEACHER_A), 'classes/classA/teams'));
});
test('MUST_PRESERVE 교사가 자기 학급 pin read 허용(관리)', async () => {
  await assertSucceeds(readPath(teacher(env, TEACHER_A), P.pin('classA', 'teamLegacy')));
});
test('MUST_PRESERVE 교사가 자기 학급 account write 허용', async () => {
  await assertSucceeds(
    writePath(teacher(env, TEACHER_A), P.account('classA', 'teamManaged') + '/status', 'locked'));
});
test('MUST_PRESERVE super_admin이 임의 학급 팀 목록 read 허용', async () => {
  await assertSucceeds(readPath(superAdmin(env, 'sa-uid'), 'classes/classB/teams'));
});
test('MUST_PRESERVE 학생이 maker에서 scenes write 허용(현행 auth!=null)', async () => {
  await assertSucceeds(
    writePath(student(env, STUDENT_A), P.scenes('classA', 'teamLegacy') + '/2',
      { num: 2, body: 'edit' }));
});
