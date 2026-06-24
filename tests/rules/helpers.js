/* RTDB Rules 테스트 공용 헬퍼 — Database Emulator + @firebase/rules-unit-testing.
   운영 Firebase에 연결하지 않음(테스트 프로젝트 demo-branch-rules + emulator만). */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { ref, get, set } from 'firebase/database';

const __dirname = dirname(fileURLToPath(import.meta.url));
/* 정본 운영 Rules 파일을 그대로 로드 → 항상 현재 database.rules.json을 검증 */
export const RULES_PATH = resolve(__dirname, '../../database.rules.json');
export const PROJECT_ID = 'demo-branch-rules';

let _env = null;
export async function getEnv() {
  if (_env) return _env;
  _env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    database: { rules: readFileSync(RULES_PATH, 'utf8') },
  });
  return _env;
}

export async function cleanup() {
  if (_env) { await _env.cleanup(); _env = null; }
}
export async function clearData() {
  const env = await getEnv();
  await env.clearDatabase();
}

/* ── auth context ── */
export function anon(env) { return env.unauthenticatedContext().database(); }
export function student(env, uid) { return env.authenticatedContext(uid, { provider_id: 'anonymous' }).database(); }
export function teacher(env, uid) { return env.authenticatedContext(uid, { role: 'teacher' }).database(); }
export function superAdmin(env, uid) { return env.authenticatedContext(uid, { role: 'super_admin' }).database(); }

/* ── ref op 래퍼 ── */
export const readPath  = (db, path) => get(ref(db, path));
export const writePath = (db, path, val) => set(ref(db, path), val);

export { assertSucceeds, assertFails };

/* fixture seed — Rules 우회로 가상 데이터 주입(운영 데이터 복사 금지) */
export async function seed(env, tree) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database();
    await set(ref(db, '/'), tree);
  });
}
