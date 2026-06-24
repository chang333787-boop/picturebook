/* 가상 fixture — 운영 데이터 복사 금지. SEC-0~SEC-2 공용.
   classA(teacherA) / classB(teacherB) 두 학급, 팀 유형별 최소 필드만. */
export const TEACHER_A = 'teacherA-uid';
export const TEACHER_B = 'teacherB-uid';
export const STUDENT_A = 'studentA-uid';
export const STUDENT_B = 'studentB-uid';

export function fixtureTree() {
  return {
    classes: {
      classA: {
        meta: { teacher_uid: TEACHER_A },
        settings: { teamCreationMode: 'legacy_open' },
        teams: {
          teamPublic: {
            scenes: { 1: { num: 1, body: 'public scene' } },
            'viewer-meta': { projectType: 'picturebook', isPublic: true },
          },
          teamPrivate: {
            scenes: { 1: { num: 1, body: 'private scene' } },
            'viewer-meta': { projectType: 'picturebook', isPublic: false },
          },
          teamLegacy: {
            scenes: { 1: { num: 1, body: 'legacy scene' } },
            'viewer-meta': { projectType: 'text', isPublic: false },
            pin: '1234',
          },
          teamManaged: {
            scenes: { 1: { num: 1, body: 'managed scene' } },
            'viewer-meta': { projectType: 'picturebook', isPublic: false },
            account: { pin: '5678', status: 'active', displayName: '모둠1' },
          },
        },
      },
      classB: {
        meta: { teacher_uid: TEACHER_B },
        settings: { teamCreationMode: 'legacy_open' },
        teams: {
          teamOther: {
            scenes: { 1: { num: 1, body: 'other class scene' } },
            'viewer-meta': { projectType: 'picturebook', isPublic: false },
            pin: '9999',
          },
        },
      },
    },
  };
}

/* 경로 헬퍼 */
export const P = {
  scenes: (cls, team) => `classes/${cls}/teams/${team}/scenes`,
  meta: (cls, team) => `classes/${cls}/teams/${team}/viewer-meta`,
  pin: (cls, team) => `classes/${cls}/teams/${team}/pin`,
  accountPin: (cls, team) => `classes/${cls}/teams/${team}/account/pin`,
  account: (cls, team) => `classes/${cls}/teams/${team}/account`,
  members: (cls, team, uid) => `classes/${cls}/teams/${team}/members/${uid}`,
};
