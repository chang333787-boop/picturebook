/* IMAGE-S2-2 — viewer-meta/imagePolicy Rules 실증(문서화).
   ──────────────────────────────────────────────────────────────
   결론(emulator 실증): RTDB 규칙은 상위 .write grant가 하위로 상속(cascade)되어
   viewer-meta{.write:auth!=null} 아래 imagePolicy{.write:false} child rule을 넣어도
   클라 write가 그대로 성공한다(자식이 부모의 grant를 취소 불가). 따라서 이번 단계는
   Rules를 바꾸지 않고, imagePolicy 보호를 "클라 코드에서 직접 write 제거 + 서버
   lockImageSourceMode(Admin SDK) 단독 작성"으로 달성한다. Rules 레벨 차단은
   viewer-meta write grant 재구조화가 필요(회귀 위험) → 후속 Security Phase.

   이 테스트는 그 사실을 잠가 둔다:
   - 다른 viewer-meta 필드는 기존대로 클라 write 정상(회귀 가드).
   - imagePolicy도 현재 규칙상 클라 write가 "가능"하다(=cascade). 이 동작이 바뀌면
     (Rules 재구조화 시) 이 테스트가 깨져 의도된 변경임을 알린다. */
import { test, before, after, beforeEach } from 'node:test';
import {
  getEnv, cleanup, clearData, seed, student, teacher,
  writePath, assertSucceeds,
} from './helpers.js';
import { fixtureTree, STUDENT_A, TEACHER_A } from './fixtures.js';

let env;
before(async () => { env = await getEnv(); });
after(async () => { await cleanup(); });
beforeEach(async () => { await clearData(); await seed(env, fixtureTree()); });

const IMG_POLICY = 'classes/classA/teams/teamPrivate/viewer-meta/imagePolicy';
const OTHER_META = 'classes/classA/teams/teamPrivate/viewer-meta/coverTheme';

test('active member: viewer-meta 다른 필드 write 정상(회귀 가드)', async () => {
  await assertSucceeds(writePath(student(env, STUDENT_A), OTHER_META, 'forest'));
});

test('[현 상태 문서] active member: imagePolicy 클라 write는 cascade로 현재 가능 — Rules 차단은 후속', async () => {
  await assertSucceeds(writePath(student(env, STUDENT_A), IMG_POLICY, { sourceMode: 'upload' }));
});

test('[현 상태 문서] teacher: imagePolicy 클라 write도 현재 가능(cascade)', async () => {
  await assertSucceeds(writePath(teacher(env, TEACHER_A), IMG_POLICY, { sourceMode: 'draw' }));
});
