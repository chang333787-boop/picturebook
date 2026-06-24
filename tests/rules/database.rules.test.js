/* RTDB 보안 Rules 테스트.
   · CURRENT_VULNERABILITY = 현재 운영 Rules의 취약점 재현(SEC-2에서 뒤집을 대상).
   · MUST_PRESERVE       = 보안 전환 후에도 유지돼야 하는 동작.
   · TARGET(todo)        = SEC-2 목표(현재는 Rules가 없어 todo). */
import { test, before, after, beforeEach } from 'node:test';
import {
  getEnv, cleanup, clearData, seed,
  anon, student, teacher, superAdmin,
  readPath, assertSucceeds, assertFails,
} from './helpers.js';
import { fixtureTree, P, TEACHER_A, STUDENT_A } from './fixtures.js';

let env;
before(async () => { env = await getEnv(); });
after(async () => { await cleanup(); });
beforeEach(async () => { await clearData(); await seed(env, fixtureTree()); });

/* ───────────── CURRENT_VULNERABILITY (현재 Rules에서 성공 = 취약) ───────────── */
test('CURRENT_VULNERABILITY 비로그인이 비공개 작품 scenes를 읽을 수 있다', async () => {
  await assertSucceeds(readPath(anon(env), P.scenes('classA', 'teamPrivate')));
});
test('CURRENT_VULNERABILITY 비로그인이 team pin을 읽을 수 있다', async () => {
  await assertSucceeds(readPath(anon(env), P.pin('classA', 'teamLegacy')));
});
test('CURRENT_VULNERABILITY 비로그인이 account.pin을 읽을 수 있다', async () => {
  await assertSucceeds(readPath(anon(env), P.accountPin('classA', 'teamManaged')));
});
test('CURRENT_VULNERABILITY 상위 teams/.read:true가 민감 자식까지 공개(익명 학생도 pin read)', async () => {
  await assertSucceeds(readPath(student(env, STUDENT_A), P.pin('classA', 'teamLegacy')));
});

/* ───────────── MUST_PRESERVE (전환 후에도 유지) ───────────── */
test('MUST_PRESERVE 비로그인이 공개 작품 scenes를 읽을 수 있다', async () => {
  await assertSucceeds(readPath(anon(env), P.scenes('classA', 'teamPublic')));
});
test('MUST_PRESERVE 비로그인이 공개 작품 viewer-meta를 읽을 수 있다', async () => {
  await assertSucceeds(readPath(anon(env), P.meta('classA', 'teamPublic')));
});
test('MUST_PRESERVE 교사가 자기 학급 팀 목록을 읽을 수 있다', async () => {
  await assertSucceeds(readPath(teacher(env, TEACHER_A), 'classes/classA/teams'));
});

/* ───────────── TARGET (SEC-2 목표 — 현재 Rules엔 없어 todo) ───────────── */
test('TARGET 비로그인 비공개 scenes read 거부', { todo: true });
test('TARGET 비로그인 pin read 거부', { todo: true });
test('TARGET 비로그인 account.pin read 거부', { todo: true });
test('TARGET 비로그인 members read 거부', { todo: true });
test('TARGET 비member editSession read 거부', { todo: true });
test('TARGET 교사 다른 학급 접근 거부', { todo: true });
test('TARGET 학생 members 직접 write 거부', { todo: true });
