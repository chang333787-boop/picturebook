/* JUDGE-ACCESS-1 — 서버/클라 배선 정적 가드(firebase 0).
   실행: node --test tests/judge-access/static.test.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = (f) => fs.readFileSync(path.join(__dirname, '../../', f), 'utf8');
const INDEX = R('functions/index.js');
const FB = R('firebase.js');
const UI = R('ui.js');
const HOME = R('index.html');
const JUDGE = R('judge.html');

test('joinTeamMembership — judge 경로는 심사반·플래그·계정 존재·rate limit 전부 통과해야 PIN 생략', () => {
  const fn = INDEX.slice(INDEX.indexOf('exports.joinTeamMembership'), INDEX.indexOf('exports.judgeTeamsStatus'));
  assert.ok(fn.includes("const ALLOWED = ['classId', 'teamName', 'pin', 'judge'];"), 'allowlist에 judge');
  assert.ok(fn.includes("if (classId !== JUDGE_CLASS_ID) throw new HttpsError('permission-denied'"), '심사반 한정');
  assert.ok(fn.includes('judgeBypass = await _judgeAccessEnabled();'), '서버 플래그');
  assert.equal((fn.match(/if \(!isTeacher && !judgeBypass\) \{/g) || []).length, 2, 'PIN·모드 검증 2블록 모두 judge 제외');
  assert.ok(fn.includes("if (!acc || acc.status === 'locked') throw"), '계정 존재 검증');
  assert.ok(fn.includes("judgeBypass ? { via: 'judge' } : {}"), 'membership via 표시');
  /* judge라도 rate limit 카운터는 같은 노드 */
  assert.ok(fn.includes('if (judgeBypass) {') && fn.includes('MEMBERSHIP_RL_MAX'), 'judge rate limit');
});

test('judgeTeamsStatus / judgeTeacherToken — origin·플래그·rate limit·심사반 고정', () => {
  const st = INDEX.slice(INDEX.indexOf('exports.judgeTeamsStatus'), INDEX.indexOf('exports.judgeTeacherToken'));
  assert.ok(st.includes('isOriginAllowed(origin)') && st.includes('_judgeAccessEnabled()') && st.includes("_judgeRateLimit('judgeStatus'"), 'status 게이트');
  assert.ok(st.includes('classes/${JUDGE_CLASS_ID}/teams') && st.includes("/^심사\\d+$/"), '심사반 심사N만');
  assert.ok(st.includes('Lv1Job.isImageTargetScene'), '완성 판정=서버 술어');
  const tk = INDEX.slice(INDEX.indexOf('exports.judgeTeacherToken'), INDEX.indexOf('helper export (step3'));
  assert.ok(tk.includes('isOriginAllowed(origin)') && tk.includes('_judgeAccessEnabled()') && tk.includes("_judgeRateLimit('judgeTeacher'"), 'token 게이트');
  assert.ok(tk.includes('classes/${JUDGE_CLASS_ID}/meta/teacher_uid') && tk.includes("admin.auth().updateUser(String(tuid), { password: pw })"), '심사반 교사 uid만·서버 관리 비밀번호');
  assert.ok(tk.includes("admin/judgeAccess/teacherPassword"), '비밀번호 보관 노드(서버 전용)');
  assert.ok(INDEX.includes("const JUDGE_ACCESS_FLAG_PATH = 'admin/judgeAccess/enabled';"), '플래그 경로');
});

test('클라 — judge 플래그는 true일 때만 전송, ?judge= 진입은 자동복귀보다 우선, 첫 화면 복귀는 묻는다', () => {
  assert.ok(FB.includes('if (args.judge === true) payload.judge = true;'), 'payload judge 조건부');
  assert.ok(FB.includes('async function _judgeJoinTeam('), '_judgeJoinTeam');
  assert.ok(UI.includes("const _judgeParam = _spTeam.get('judge');"), 'judge 파라미터');
  assert.ok(UI.includes('&& !_judgeParam) {'), '자동복귀 제외');
  assert.ok(UI.includes("_spTeam.get('from') === 'home'") && UI.includes("cancelText: '다른 모둠으로'") && UI.includes('forceChoice: true'), 'from=home 프롬프트');
  assert.ok(UI.includes("const JUDGE_CLASS_ID_CLIENT = 'cls_mrykb7m8_gIlpnw';"), '클라 심사반 id = 서버 JUDGE_CLASS_ID');
  assert.ok(INDEX.includes("const JUDGE_CLASS_ID = 'cls_mrykb7m8_gIlpnw';"), '서버 심사반 id');
});

test('첫 화면·judge.html — 링크 3종·from=home·심사1~15 그리드', () => {
  assert.ok(HOME.includes('href="maker.html?from=home"'), '작품 만들기 from=home');
  assert.ok(HOME.includes('href="viewer.html?code=0000&amp;shelf=1"'), '수업 결과물=학급 코드 0000 책장');
  assert.ok(HOME.includes('href="judge.html?go=teacher"') && HOME.includes('href="judge.html"'), '교사 화면·체험');
  assert.ok(JUDGE.includes("httpsCallable('judgeTeamsStatus')") && JUDGE.includes("httpsCallable('judgeTeacherToken')"), 'judge.html 콜러블');
  assert.ok(JUDGE.includes('signInWithEmailAndPassword') && JUDGE.includes("maker.html?admin=1"), '교사 화면 진입(password 방식)');
  assert.ok(JUDGE.includes("'maker.html?judge='"), '체험 진입 링크');
});
