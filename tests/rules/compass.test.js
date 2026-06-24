/* 생각 나침반 경로(writingGuide/onboarding/editSession) RTDB Rules 검증.
   member·teacher·super_admin 허용 / 비member·비로그인 거부 / scenes·viewer-meta 무영향. */
import { test, before, after, beforeEach } from 'node:test';
import {
  getEnv, cleanup, clearData, seed,
  anon, student, teacher, superAdmin,
  readPath, writePath, assertSucceeds, assertFails,
} from './helpers.js';
import { fixtureTree, STUDENT_A, STUDENT_B, TEACHER_A } from './fixtures.js';

let env;
before(async () => { env = await getEnv(); });
after(async () => { await cleanup(); });
beforeEach(async () => { await clearData(); await seed(env, fixtureTree()); });

const WG = 'classes/classA/teams/teamPrivate/writingGuide/preWriting';
const OB = 'classes/classA/teams/teamPrivate/onboarding';
const ES = 'classes/classA/teams/teamPrivate/editSession';

test('member가 writingGuide read 허용', async () => {
  await assertSucceeds(readPath(student(env, STUDENT_A), WG));
});
test('member가 writingGuide write 허용', async () => {
  await assertSucceeds(writePath(student(env, STUDENT_A), WG, { status: 'inProgress', updatedAt: 1 }));
});
test('비member 학생 writingGuide read 거부', async () => {
  await assertFails(readPath(student(env, STUDENT_B), WG));
});
test('비member 학생 writingGuide write 거부', async () => {
  await assertFails(writePath(student(env, STUDENT_B), WG, { status: 'inProgress' }));
});
test('비로그인 writingGuide read 거부', async () => {
  await assertFails(readPath(anon(env), WG));
});
test('member가 onboarding write 허용', async () => {
  await assertSucceeds(writePath(student(env, STUDENT_A), OB + '/version', 1));
});
test('비member onboarding read 거부', async () => {
  await assertFails(readPath(student(env, STUDENT_B), OB));
});
test('member가 editSession read 허용', async () => {
  await assertSucceeds(readPath(student(env, STUDENT_A), ES));
});
test('member가 editSession write 허용 (Phase K 트랜잭션)', async () => {
  await assertSucceeds(writePath(student(env, STUDENT_A), ES, { editorUid: STUDENT_A, startedAt: 1, heartbeatAt: 1, sessionVersion: 1 }));
});
test('member가 onboarding read 허용', async () => {
  await assertSucceeds(readPath(student(env, STUDENT_A), OB));
});
test('비member editSession write 거부', async () => {
  await assertFails(writePath(student(env, STUDENT_B), ES, { ownerId: 'x' }));
});
test('비로그인 editSession read 거부', async () => {
  await assertFails(readPath(anon(env), ES));
});
test('비로그인 onboarding read 거부', async () => {
  await assertFails(readPath(anon(env), OB));
});
test('교사가 writingGuide read/write 허용', async () => {
  await assertSucceeds(readPath(teacher(env, TEACHER_A), WG));
  await assertSucceeds(writePath(teacher(env, TEACHER_A), WG, { status: 'completed', completedAt: 1 }));
});
test('super_admin이 writingGuide read 허용', async () => {
  await assertSucceeds(readPath(superAdmin(env, 'sa'), WG));
});
test('writingGuide write가 scenes/viewer-meta read 권한에 영향 없음(공개 작품)', async () => {
  /* 공개 작품 scenes는 여전히 anon read 가능(회귀 없음) */
  await assertSucceeds(readPath(anon(env), 'classes/classA/teams/teamPublic/scenes'));
});
