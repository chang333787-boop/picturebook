/* SCENES-WRITE-RULES-HARDEN-1 [승인2] — scenes/viewer-meta write를 read와 동일 멤버 범위로
   조이는 후보 규칙의 에뮬레이터 검증. **배포 아님** — 운영 database.rules.json은 건드리지 않고,
   database.rules.harden1-candidate.json(두 write만 조인 사본)을 별도 projectId로 로드해 검증한다.
   계획: docs/scenes_write_harden_1_plan_20260705.md §4.

   현행 운영 규칙(auth != null)에서 비member write가 통과하는 것은 polish-auth-scenes.test.js가
   아닌 database.rules.test.js(MUST_PRESERVE)가 문서화 중. 이 파일은 "조인 뒤" 매트릭스만 잠근다.

   매트릭스(classA/teamPrivate=비공개, studentA=active member, teacherA=classA teacher_uid,
            teamPublic=공개, classB/teamOther=타 학급):
     active member  → 자기 팀 scenes/viewer-meta write  허용
     비member       → 그 팀 write                         거부  (★변조 차단 — 현행 버그를 닫음)
     teacher        → 자기 학급 팀 write                  허용
     super_admin    → write                                허용
     anonymous      → write                                거부
     공개 팀도 비member write                              거부  (공개 read≠공개 write)
     타 학급 member가 아닌 학생 → 타 학급 팀 write         거부 */
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { ref, set } from 'firebase/database';
import { fixtureTree, P, STUDENT_A, STUDENT_B, TEACHER_A, TEACHER_B } from './fixtures.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAND_PATH = resolve(__dirname, '../../database.rules.harden1-candidate.json');
const PROJECT_ID = 'demo-branch-harden1';   /* 운영 테스트(demo-branch-rules)와 분리 — rules 충돌 방지 */

let env;
const writePath = (db, path, val) => set(ref(db, path), val);
const anon = () => env.unauthenticatedContext().database();
const student = (uid) => env.authenticatedContext(uid, { provider_id: 'anonymous' }).database();
const teacher = (uid) => env.authenticatedContext(uid, { role: 'teacher' }).database();
const superAdmin = (uid) => env.authenticatedContext(uid, { role: 'super_admin' }).database();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    database: { rules: readFileSync(CAND_PATH, 'utf8') },
  });
});
after(async () => { if (env) await env.cleanup(); });
beforeEach(async () => {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async (ctx) => { await set(ref(ctx.database(), '/'), fixtureTree()); });
});

const PRIV_SCENES = P.scenes('classA', 'teamPrivate') + '/1';
const PRIV_META   = P.meta('classA', 'teamPrivate');
const PUB_SCENES  = P.scenes('classA', 'teamPublic') + '/1';
const OTHER_SCENES = P.scenes('classB', 'teamOther') + '/1';
const SCENE_VAL = { num: 1, body: 'edited' };
const META_VAL  = { projectType: 'picturebook', isPublic: false };

/* ── 허용: 정당한 편집자 ── */
test('active member → 자기 팀 private scenes write 허용', async () => {
  await assertSucceeds(writePath(student(STUDENT_A), PRIV_SCENES, SCENE_VAL));
});
test('active member → 자기 팀 viewer-meta write 허용', async () => {
  await assertSucceeds(writePath(student(STUDENT_A), PRIV_META, META_VAL));
});
test('teacher(자기 학급) → 팀 scenes write 허용 (교사 maker 편집 경로)', async () => {
  await assertSucceeds(writePath(teacher(TEACHER_A), PRIV_SCENES, SCENE_VAL));
});
test('super_admin → 팀 scenes write 허용', async () => {
  await assertSucceeds(writePath(superAdmin('root-uid'), PRIV_SCENES, SCENE_VAL));
});

/* ── 거부: ★변조 차단(현행 auth!=null 버그를 닫는 핵심) ── */
test('비member 학생 → 남의 팀 private scenes write 거부', async () => {
  await assertFails(writePath(student(STUDENT_B), PRIV_SCENES, SCENE_VAL));
});
test('비member 학생 → 남의 팀 viewer-meta write 거부 (isPublic 조작 차단)', async () => {
  await assertFails(writePath(student(STUDENT_B), PRIV_META, { projectType: 'picturebook', isPublic: true }));
});
test('anonymous(비로그인) → scenes write 거부', async () => {
  await assertFails(writePath(anon(), PRIV_SCENES, SCENE_VAL));
});
test('공개 팀이어도 비member write 거부 (공개 read ≠ 공개 write)', async () => {
  await assertFails(writePath(student(STUDENT_B), PUB_SCENES, SCENE_VAL));
});
test('타 학급 교사 → 남 학급 팀 scenes write 거부', async () => {
  await assertFails(writePath(teacher(TEACHER_B), PRIV_SCENES, SCENE_VAL));
});
test('member(classA) → 타 학급(classB) 팀 write 거부', async () => {
  await assertFails(writePath(student(STUDENT_A), OTHER_SCENES, SCENE_VAL));
});

/* ── 회귀 가드: locks는 조이지 않았음(편집 조율용·auth!=null 유지) ── */
test('locks write는 여전히 auth!=null (조이지 않음 — 회귀 가드)', async () => {
  await assertSucceeds(writePath(student(STUDENT_B), `classes/classA/teams/teamPrivate/locks/1`, { editorId: 'x', lockedAt: 1 }));
});
