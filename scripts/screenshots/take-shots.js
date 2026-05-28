#!/usr/bin/env node
/* ============================================================
   가지 자동 스크린샷 — Phase 5-B-1
   ─────────────────────────────────────────────
   1차 도입 범위:
     · viewport 2종 — PC 1440x900, 태블릿 가로 1280x800
     · 화면 2종 — cover-edit, scene-edit
     · 총 4장

   실행 전제:
     · localhost:8765 정적 서버 박혀있어야 함 (사용자가 별도 터미널에서 박음)
       예: python3 -m http.server 8765
     · 본 스크립트는 서버 자동 박지 X — 없으면 에러 메시지 박고 exit 1

   실행:
     cd scripts/screenshots
     node take-shots.js

   환경 변수 (옵션):
     BRANCH_BASE_URL   — viewer.html base (default http://localhost:8765/viewer.html)
     BRANCH_CLASS_ID   — 작품 classId (default class_2026_junglim_1)
     BRANCH_TEAM       — 작품 team (default 0000)
     BRANCH_SCENE      — scene-edit에서 진입할 장면 번호 (default 2)
     BRANCH_PTYPE      — 작품 ptype (default picturebook)

   주의:
     · 단순 페이지 로드 + 캡처만 박음 — 사용자 입력 발화 0
     · 따라서 _queueSave / saveSceneText 호출 위험 0
     · 단 화이트리스트 작품 박혀있어 localhost에서도 RTDB 원격 읽힘 — 안전 위해
       향후 격리 테스트 작품(BRANCH_CLASS_ID/BRANCH_TEAM 박음) 박는 게 권장
   ============================================================ */

'use strict';

const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/* ─── 환경변수 / 기본값 ─── */
const BASE          = process.env.BRANCH_BASE_URL     || 'http://localhost:8765/viewer.html';
const CLASS_ID      = process.env.BRANCH_CLASS_ID     || 'class_2026_junglim_1';
const TEAM          = process.env.BRANCH_TEAM         || '0000';
const SCENE         = process.env.BRANCH_SCENE        || '2';
const ENDING_SCENE  = process.env.BRANCH_ENDING_SCENE || '';   /* 미박힘 시 ending-edit 스킵 */
const PTYPE         = process.env.BRANCH_PTYPE        || 'picturebook';

/* ─── URL query 빌더 — team/classId/ptype은 모든 화면 공통, edit/scene/fromMaker는 옵션 ─── */
function buildQuery(opts) {
  opts = opts || {};
  const params = [
    `team=${encodeURIComponent(TEAM)}`,
    `classId=${encodeURIComponent(CLASS_ID)}`,
    `ptype=${encodeURIComponent(PTYPE)}`,
  ];
  if (opts.edit)       params.push('edit=1');
  if (opts.scene)      params.push(`scene=${encodeURIComponent(opts.scene)}`);
  if (opts.fromMaker)  params.push('from=maker');   /* maker-return-bar 표시 — 구조 보기 버튼 박힘 */
  return '?' + params.join('&');
}

/* ─── viewport 박을 거 ─── */
const VIEWPORTS = [
  { name: 'pc',           width: 1440, height: 900 },
  { name: 'tablet-wide',  width: 1280, height: 800 },
  { name: 'tablet-narrow', width: 1024, height: 768 },
];

/* ─── 화면 박을 거 — Phase 5-B-3 (클릭 자동화 박음) ─────────────
   actions 박힌 shot은 page.goto 후 순서대로 액션 박음:
     · click   — Playwright page.click(selector)
     · waitFor — Playwright page.waitForSelector(selector, {timeout})
     · wait    — page.waitForTimeout(ms)
   허용 클릭: .js-cover-start (감상 시작) / .js-edit-open-map (구조 보기)
   금지 클릭: 저장 / contenteditable / 행동 버튼 분기 / 추가·삭제
   Firebase 쓰기 발화 없는 영역만 박음. */
const SHOTS = [
  { name: 'cover-edit',  query: buildQuery({ edit: true }) },
  { name: 'cover-view',  query: buildQuery({}) },
  { name: 'scene-edit',  query: buildQuery({ edit: true, scene: SCENE }) },

  /* scene-view — 감상 모드는 ?scene=N 무시(viewer-entry.js 설계).
     표지에서 시작 클릭 → entrySceneId 박은 후 첫 일반 장면 박힘. Firebase 쓰기 X. */
  { name: 'scene-view',
    query: buildQuery({}),
    actions: [
      { click: '.js-cover-start' },
      { waitFor: '.scene-screen', timeout: 5000 },
      { wait: 800 },
    ] },

  /* branch-view — 편집 모드 + fromMaker(maker-return-bar 표시)에서 구조 보기 클릭.
     Firebase 쓰기 X (DOM 오버레이만). from=maker 박혀야 .js-edit-open-map 박힘. */
  { name: 'branch-view',
    query: buildQuery({ edit: true, fromMaker: true }),
    actions: [
      { click: '.js-edit-open-map' },
      { waitFor: '#structure-map-overlay', timeout: 5000 },
      { wait: 800 },
    ] },
];
/* ending-edit — BRANCH_ENDING_SCENE 박힌 경우만 박음 (작품별 엔딩 번호 다름) */
if (ENDING_SCENE) {
  SHOTS.push({ name: 'ending-edit', query: buildQuery({ edit: true, scene: ENDING_SCENE }) });
}

/* ─── 메인 ─── */
(async () => {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const outDir = path.join(__dirname, 'screenshots', stamp);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`📸 가지 자동 스크린샷 — Phase 5-B-2`);
  console.log(`   산출물: ${outDir}`);
  console.log(`   base URL: ${BASE}`);
  console.log(`   classId: ${CLASS_ID} / team: ${TEAM}`);
  console.log(`   일반 장면: ${SCENE} / 엔딩 장면: ${ENDING_SCENE || '(미박힘 — ending-edit 스킵)'}`);
  console.log(`   화면 ${SHOTS.length}종 × viewport ${VIEWPORTS.length}종 = ${SHOTS.length * VIEWPORTS.length}장`);
  if (!ENDING_SCENE) {
    console.log(`   ℹ ending-edit 박으려면: BRANCH_ENDING_SCENE=N node take-shots.js`);
  }
  console.log('');

  /* 서버 박혀있는지 확인 — fetch 한 번. ok 아니면 안내 후 exit. */
  let serverOk = false;
  try {
    const probe = await fetch(BASE, { method: 'GET' });
    serverOk = !!(probe && (probe.ok || probe.status < 500));
  } catch (_) { /* 네트워크 실패 → serverOk false */ }
  if (!serverOk) {
    console.error(`❌ localhost 서버 박혀있지 않은 듯해요 (${BASE})`);
    console.error(`   별도 터미널에서 다음을 실행해주세요:`);
    console.error(`     python3 -m http.server 8765`);
    console.error(`   서버 박힌 후 다시 본 스크립트 실행 부탁드려요.`);
    process.exit(1);
  }

  /* Chromium 실행 — 박지 않은 경우 안내 */
  let browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    console.error(`❌ Chromium 박지 않은 듯해요. 다음을 실행해주세요:`);
    console.error(`     npx playwright install chromium`);
    console.error(`   상세: ${e.message.split('\n')[0]}`);
    process.exit(1);
  }

  let okCount = 0;
  let failCount = 0;

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,   /* retina 화질 */
    });
    const page = await context.newPage();

    for (const shot of SHOTS) {
      const url = BASE + shot.query;
      const fileName = `${vp.name}-${vp.width}x${vp.height}-${shot.name}.png`;
      const file = path.join(outDir, fileName);
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
        /* entry 자동 진입 + Firebase 데이터 로드 + 첫 렌더 대기 */
        await page.waitForTimeout(2000);

        /* 2026-05-28 Phase 5-B-3: actions 박힌 채면 순서대로 박음 (click/waitFor/wait).
           실패하면 해당 shot만 fail 박힘 — 같은 viewport 다음 shot은 새 page.goto라 무관. */
        if (Array.isArray(shot.actions)) {
          for (const a of shot.actions) {
            if (a.click)   await page.click(a.click, { timeout: 3000 });
            if (a.waitFor) await page.waitForSelector(a.waitFor, { timeout: a.timeout || 5000 });
            if (a.wait)    await page.waitForTimeout(a.wait);
          }
        }

        await page.screenshot({ path: file, fullPage: false });
        okCount++;
        console.log(`✓ ${fileName}`);
      } catch (e) {
        failCount++;
        console.log(`✗ ${fileName}: ${(e.message || '').split('\n')[0]}`);
      }
    }
    await context.close();
  }

  await browser.close();

  console.log('');
  console.log(`완료 — 성공 ${okCount} / 실패 ${failCount}`);
  if (failCount > 0) process.exit(1);
  process.exit(0);
})().catch(e => {
  console.error('❌ 예상치 못한 에러:', e);
  process.exit(1);
});
