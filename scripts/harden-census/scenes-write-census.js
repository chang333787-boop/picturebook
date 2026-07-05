#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════
   SCENES-WRITE-RULES-HARDEN-1 — 데이터 census (읽기 전용)
   ──────────────────────────────────────────────────────────────
   목적: v2 write 조이기(members active 요구) 전, "member 노드 없는 팀"과
        "v1 legacy 경로 팀" 규모를 파악해 Stage 1 go/no-go를 결정한다.
   ⚠️ 운영 Firebase READ만. write/set/remove 0. firebase CLI(database:get) 사용.
      firebase login + 프로젝트 접근 권한 필요. shallow 우선으로 부하 최소화.

   단계:
     --size   (기본)  : 저렴한 sizing만 — classes 수, v1 teams 수, 클래스별 팀 수 합계.
     --full           : 팀별 상세 — members 유무 / isPublic / scenes 유무 집계(느림, 팀 수만큼 read).
     --limit N        : --full 시 처음 N개 클래스만(스모크). 미지정=전체.
     --project ID     : 기본 picturebook-8731f (env IMGS2_FB_PROJECT로도)

   사용:
     node scripts/harden-census/scenes-write-census.js --size
     node scripts/harden-census/scenes-write-census.js --full --limit 5
   ════════════════════════════════════════════════════════════════ */
'use strict';
const { execFileSync } = require('child_process');

const PROJECT = process.env.IMGS2_FB_PROJECT ||
  (argVal('--project')) || 'picturebook-8731f';
const MODE_FULL = process.argv.includes('--full');
const LIMIT = Number(argVal('--limit')) || Infinity;

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return (i >= 0 && i + 1 < process.argv.length) ? process.argv[i + 1] : null;
}

/* firebase database:get — 읽기 전용. shallow=true면 자식 키만 반환(대용량 회피). */
function dbGet(path, shallow) {
  const args = ['database:get', path, '--project', PROJECT];
  if (shallow) args.push('--shallow');
  let out;
  try {
    out = execFileSync('firebase', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`database:get 실패 (${path}): ${e.message.split('\n')[0]}`);
  }
  const t = out.trim();
  if (t === '' || t === 'null') return null;
  try { return JSON.parse(t); } catch (e) { throw new Error(`JSON 파싱 실패 (${path})`); }
}

function keysOf(obj) { return (obj && typeof obj === 'object') ? Object.keys(obj) : []; }

function main() {
  console.log(`[census] project=${PROJECT} mode=${MODE_FULL ? 'full' : 'size'}${isFinite(LIMIT) ? ' limit=' + LIMIT : ''}`);
  console.log('[census] READ-ONLY — 운영 DB write 0\n');

  /* 1) 저렴한 sizing (shallow) */
  const classIds = keysOf(dbGet('/classes', true));
  const v1Teams = keysOf(dbGet('/teams', true));   // v1 legacy 경로(classId 없음)
  console.log(`■ v2 classes: ${classIds.length}개`);
  console.log(`■ v1 legacy teams(/teams 직속): ${v1Teams.length}개`);

  let teamTotal = 0;
  const perClassTeams = {};
  for (const cid of classIds) {
    const teams = keysOf(dbGet(`/classes/${cid}/teams`, true));
    perClassTeams[cid] = teams.length;
    teamTotal += teams.length;
  }
  console.log(`■ v2 teams 합계: ${teamTotal}개 (클래스당 평균 ${classIds.length ? (teamTotal / classIds.length).toFixed(1) : 0})`);

  if (!MODE_FULL) {
    console.log('\n--size 모드 종료. 규모가 감당되면 --full로 상세 집계.');
    console.log(`예상 --full read 횟수 ≈ ${teamTotal * 2}회(팀당 members+viewer-meta shallow).`);
    return;
  }

  /* 2) 팀별 상세 — R1(member 없는 팀)·isPublic 분포 */
  const stat = {
    teamsChecked: 0,
    noMembers: 0, noMembersPublic: 0, noMembersPrivate: 0, noMembersWithScenes: 0,
    hasMembers: 0, hasScenes: 0,
    samplesNoMembers: [],
  };
  let classesDone = 0;
  for (const cid of classIds) {
    if (classesDone >= LIMIT) break;
    classesDone++;
    const teams = keysOf(dbGet(`/classes/${cid}/teams`, true));
    for (const enc of teams) {
      stat.teamsChecked++;
      const base = `/classes/${cid}/teams/${enc}`;
      const memberUids = keysOf(dbGet(`${base}/members`, true));
      const sceneKeys = keysOf(dbGet(`${base}/scenes`, true));
      const hasScenes = sceneKeys.length > 0;
      if (hasScenes) stat.hasScenes++;
      if (memberUids.length === 0) {
        stat.noMembers++;
        const isPublic = dbGet(`${base}/viewer-meta/isPublic`, false) === true;
        if (isPublic) stat.noMembersPublic++; else stat.noMembersPrivate++;
        if (hasScenes) stat.noMembersWithScenes++;
        if (stat.samplesNoMembers.length < 20) {
          stat.samplesNoMembers.push({ cid, team: decodeURIComponent(enc), isPublic, scenes: sceneKeys.length });
        }
      } else {
        stat.hasMembers++;
      }
    }
  }

  console.log('\n■ 팀별 상세 (R1 = member 노드 없는 팀):');
  console.log(`  검사 팀: ${stat.teamsChecked} / member 있음: ${stat.hasMembers} / member 없음: ${stat.noMembers}`);
  console.log(`  member 없음 중 → 공개: ${stat.noMembersPublic}, 비공개: ${stat.noMembersPrivate}, scenes 보유: ${stat.noMembersWithScenes}`);
  console.log('\n  [go/no-go 해석]');
  console.log('   · member 없음 & scenes 보유 & 공개 = 조이면 write 끊길 실위험군.');
  console.log('   · 이 수가 0~소수면 PIN 재입장 안내로 자연 백필 → Stage 1 진행 가능.');
  console.log('   · 다수면 Stage 1 보류(백필 캠페인 선행).');
  if (stat.samplesNoMembers.length) {
    console.log('\n  member 없는 팀 샘플(최대 20):');
    for (const s of stat.samplesNoMembers) {
      console.log(`   - ${s.cid} / ${s.team} / public=${s.isPublic} / scenes=${s.scenes}`);
    }
  }
}

try { main(); } catch (e) {
  console.error('[census] 오류:', e.message);
  console.error('firebase CLI 로그인/프로젝트 권한을 확인하세요: firebase login · firebase projects:list');
  process.exit(1);
}
