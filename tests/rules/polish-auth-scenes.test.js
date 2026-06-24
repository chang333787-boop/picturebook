/* POLISH-AUTH 검증 — 편집 뷰어 인증 전환이 의존하는 scenes/viewer-meta read 권한 매트릭스.
   Rules는 수정하지 않는다(기존 database.rules.json 그대로 로드). 이 파일은 플랜의
   "반드시 확인할 권한"을 명시 단언으로 잠그는 회귀 가드다.

   매트릭스(classA/teamPrivate = 비공개, studentA=active member, teacherA=classA teacher_uid):
     active member  → private scenes/viewer-meta read  허용
     teacher        → private scenes/viewer-meta read  허용   (teacher_uid 규칙)
     non-member     → private scenes/viewer-meta read  거부
     anonymous      → private scenes/viewer-meta read  거부
     공개(teamPublic) scenes/viewer-meta read           허용 */
import { test, before, after, beforeEach } from 'node:test';
import {
  getEnv, cleanup, clearData, seed,
  anon, student, teacher,
  readPath, assertSucceeds, assertFails,
} from './helpers.js';
import { fixtureTree, P, STUDENT_A, STUDENT_B, TEACHER_A } from './fixtures.js';

let env;
before(async () => { env = await getEnv(); });
after(async () => { await cleanup(); });
beforeEach(async () => { await clearData(); await seed(env, fixtureTree()); });

const PRIV_SCENES = P.scenes('classA', 'teamPrivate');
const PRIV_META   = P.meta('classA', 'teamPrivate');
const PUB_SCENES  = P.scenes('classA', 'teamPublic');
const PUB_META    = P.meta('classA', 'teamPublic');

/* ── 편집 뷰어가 복원하는 maker UID 종류별 private read ── */
test('POLISH-AUTH active member → private scenes read 허용 (학생 maker UID 복원 경로)', async () => {
  await assertSucceeds(readPath(student(env, STUDENT_A), PRIV_SCENES));
});
test('POLISH-AUTH active member → private viewer-meta read 허용', async () => {
  await assertSucceeds(readPath(student(env, STUDENT_A), PRIV_META));
});
test('POLISH-AUTH teacher → private scenes read 허용 (교사 maker UID 복원 경로)', async () => {
  await assertSucceeds(readPath(teacher(env, TEACHER_A), PRIV_SCENES));
});
test('POLISH-AUTH teacher → private viewer-meta read 허용', async () => {
  await assertSucceeds(readPath(teacher(env, TEACHER_A), PRIV_META));
});

/* ── 잘못된 UID(편집 뷰어가 옛날에 새로 만들던 익명·비멤버) → 거부(버그 재현) ── */
test('POLISH-AUTH non-member(익명 provider) → private scenes read 거부 (구 버그 UID와 동치)', async () => {
  await assertFails(readPath(student(env, STUDENT_B), PRIV_SCENES));
});
test('POLISH-AUTH non-member → private viewer-meta read 거부', async () => {
  await assertFails(readPath(student(env, STUDENT_B), PRIV_META));
});
test('POLISH-AUTH anonymous(비로그인) → private scenes read 거부', async () => {
  await assertFails(readPath(anon(env), PRIV_SCENES));
});
test('POLISH-AUTH anonymous → private viewer-meta read 거부', async () => {
  await assertFails(readPath(anon(env), PRIV_META));
});

/* ── 공개 감상 보존(회귀 가드) ── */
test('POLISH-AUTH anonymous → public scenes read 허용 (공개 감상 보존)', async () => {
  await assertSucceeds(readPath(anon(env), PUB_SCENES));
});
test('POLISH-AUTH anonymous → public viewer-meta read 허용', async () => {
  await assertSucceeds(readPath(anon(env), PUB_META));
});
