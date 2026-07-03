/* ACCOUNT-MODE-DEFAULT-1 — settings/teamCreationMode write 권한 매트릭스.
   신규 학급 생성이 teacher_managed를 명시 기록하는 경로(교사 write)를 잠그는 회귀 가드.
   Rules는 수정하지 않음(기존 database.rules.json 그대로 로드) — 기존 규칙이 이 write를
   허용하는지/오·남용을 막는지 확인. read는 .read:true(누구나), write는 교사/super_admin만,
   값은 화이트리스트(legacy_open/teacher_managed/locked)만. */
import { test, before, after, beforeEach } from 'node:test';
import {
  getEnv, cleanup, clearData, seed,
  anon, student, teacher, superAdmin,
  readPath, writePath, assertSucceeds, assertFails,
} from './helpers.js';
import { fixtureTree, STUDENT_A, TEACHER_A, TEACHER_B } from './fixtures.js';

let env;
before(async () => { env = await getEnv(); });
after(async () => { await cleanup(); });
beforeEach(async () => { await clearData(); await seed(env, fixtureTree()); });

const MODE = 'classes/classA/settings/teamCreationMode';

/* ── write 허용: 담당 교사 / super_admin (신규 학급 생성 경로 = teacher_managed 기록) ── */
test('MODE 담당 교사 → teacher_managed write 허용', async () => {
  await assertSucceeds(writePath(teacher(env, TEACHER_A), MODE, 'teacher_managed'));
});
test('MODE 담당 교사 → legacy_open write 허용(전환)', async () => {
  await assertSucceeds(writePath(teacher(env, TEACHER_A), MODE, 'legacy_open'));
});
test('MODE super_admin → write 허용', async () => {
  await assertSucceeds(writePath(superAdmin(env, 'root-uid'), MODE, 'teacher_managed'));
});

/* ── write 거부: 학생 / 다른 학급 교사 / 미인증 ── */
test('MODE 학생(active member) → write 거부', async () => {
  await assertFails(writePath(student(env, STUDENT_A), MODE, 'legacy_open'));
});
test('MODE 다른 학급 교사 → write 거부', async () => {
  await assertFails(writePath(teacher(env, TEACHER_B), MODE, 'teacher_managed'));
});
test('MODE 미인증 → write 거부', async () => {
  await assertFails(writePath(anon(env), MODE, 'teacher_managed'));
});

/* ── .validate: 화이트리스트 외 값 거부(교사여도) ── */
test('MODE 교사라도 잘못된 값(hacked) → write 거부', async () => {
  await assertFails(writePath(teacher(env, TEACHER_A), MODE, 'hacked'));
});
test('MODE 교사라도 숫자 값 → write 거부', async () => {
  await assertFails(writePath(teacher(env, TEACHER_A), MODE, 123));
});

/* ── read: settings는 공개(.read:true) — 학생 입장 전 모드 판별용 ── */
test('MODE read 허용(미인증도) — 입장 폼 모드 판별', async () => {
  await assertSucceeds(readPath(anon(env), MODE));
});
