#!/usr/bin/env node
/* ============================================================
   가지 precommit-check — 개발 보조 (Phase 5-A-1)
   ─────────────────────────────────────────────
   commit 전 수동 실행해서 자주 발생하는 실수를 잡는 read-only 검사.
   Node 표준 모듈만 사용 (fs / path / child_process). 외부 패키지 0.

   실행:
     node scripts/precommit-check.js

   검사 항목:
     1. 변경된 JS 파일 문법 검사 (node --check)            → 실패 시 exit 1
     2. 새로 추가된 console.log / console.debug             → 경고
     3. cache version 누락 (JS/CSS 변경 + viewer.html 미변경) → 실패
     4. 위험 파일 변경 (functions/ / viewer-data.js 등)     → 경고
     5. viewer.html 참조 파일 존재 검사                      → 실패

   동작:
     · staged 변경 우선 (git diff --cached). 비어있으면 working tree diff
     · 5번(viewer.html 참조 검사)은 staged 무관 — 항상 박힘
     · 실패 1개 이상 → process.exit(1)
     · 경고만 있거나 통과 → process.exit(0)

   주의:
     · read-only — 파일 수정 X, Firebase 접근 X, 네트워크 접근 X
     · git hook 자동 연결 X — 사용자 수동 실행
     · 자기 자신(scripts/precommit-check.js)도 변경 파일로 박힐 수 있음 — 정상
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const warnings = [];

/* ============================================================
   유틸 — git 명령 실행 (실패해도 throw 안 함, 빈 문자열 fallback)
   ============================================================ */
function safeGit(cmd) {
  try {
    return execSync(`git ${cmd}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString();
  } catch (_) {
    return '';
  }
}

/* ============================================================
   변경 파일 수집 — staged 우선, 비어있으면 working tree fallback
   ============================================================ */
function collectChangedFiles() {
  let list = safeGit('diff --name-only --cached')
    .trim().split('\n').filter(Boolean);
  let source = 'staged';
  if (list.length === 0) {
    list = safeGit('diff --name-only')
      .trim().split('\n').filter(Boolean);
    source = 'working-tree';
  }
  return { list, source };
}

function collectAddedDiffLines() {
  /* -U0 = context 라인 없음. +로 시작하는 추가 라인만 추출 (헤더 +++ 제외). */
  let raw = safeGit('diff -U0 --cached');
  if (!raw.trim()) raw = safeGit('diff -U0');
  return raw.split('\n')
    .filter(l => l.startsWith('+') && !l.startsWith('+++'));
}

/* ============================================================
   1) JS 문법 검사 — 변경된 *.js 파일만
   ============================================================ */
function checkJsSyntax(changedFiles) {
  const jsFiles = changedFiles
    .filter(f => f.endsWith('.js'))
    .filter(f => fs.existsSync(path.join(ROOT, f)));
  jsFiles.forEach(f => {
    try {
      execSync(`node --check "${f}"`, { cwd: ROOT, stdio: 'pipe' });
    } catch (e) {
      const msg = (e.stderr || e.stdout || '').toString().trim().split('\n').slice(0, 3).join(' | ');
      errors.push(`[JS 문법] ${f}\n      ${msg}`);
    }
  });
  return jsFiles.length;
}

/* ============================================================
   2) console.log / console.debug 새 라인 검사
       console.warn / console.error는 허용
   ============================================================ */
function checkConsoleLogs(addedLines) {
  /* 단순 정규식 — 라인 안 어디든 console.log/debug 박혀있으면 매칭.
     단 추가 라인의 + 자체 무시하기 위해 slice(1). */
  const offenders = addedLines
    .map(l => l.slice(1))
    .filter(l => /\bconsole\.(log|debug)\s*\(/.test(l));
  if (offenders.length > 0) {
    warnings.push(`[console.log 잔여] 새 추가 라인 ${offenders.length}개 (warn/error는 허용)`);
    offenders.slice(0, 5).forEach(l => {
      warnings.push(`      ${l.trim().slice(0, 100)}`);
    });
    if (offenders.length > 5) {
      warnings.push(`      … 외 ${offenders.length - 5}개`);
    }
  }
}

/* ============================================================
   3) Cache version 검사
       viewer.html 안 ?v= 박힌 모든 로컬 JS/CSS 추출.
       해당 파일이 변경됐는데 viewer.html이 변경 목록에 없으면 실패.
   ============================================================ */
function checkCacheVersion(changedFiles) {
  const viewerHtmlPath = path.join(ROOT, 'viewer.html');
  if (!fs.existsSync(viewerHtmlPath)) return;
  const html = fs.readFileSync(viewerHtmlPath, 'utf8');

  /* viewer.html 안 박힌 cache 참조: <script src="X.js?v=..."> / <link href="X.css?v=..."> */
  const cacheRe = /(?:src|href)="([^"?]+\.(?:js|css))\?v=[^"']+"/g;
  const versioned = new Set();
  let m;
  while ((m = cacheRe.exec(html)) !== null) {
    versioned.add(path.basename(m[1]));
  }

  const viewerHtmlChanged = changedFiles.includes('viewer.html');
  const offenders = changedFiles
    .filter(f => /\.(js|css)$/.test(f))
    .filter(f => versioned.has(path.basename(f)))
    .filter(f => path.basename(f) !== 'viewer.html');

  if (offenders.length > 0 && !viewerHtmlChanged) {
    errors.push(`[Cache version] viewer.html ?v= 갱신 안 됨 — 다음 파일이 변경됨:`);
    offenders.forEach(f => errors.push(`      - ${f}`));
    errors.push(`      → viewer.html 안 해당 파일 ?v= 값을 같이 바꾸세요.`);
  }
}

/* ============================================================
   4) 위험 파일 변경 경고 (실패 X, 경고만)
   ============================================================ */
const RISKY_PATTERNS = [
  { re: /^functions\//,         label: 'functions/ — AI/저장 백엔드' },
  { re: /^viewer-data\.js$/,    label: 'viewer-data.js — buildButtonsPatchForSave / saveSceneText' },
  { re: /^maker\.html$/,        label: 'maker.html — 작품 만들기 + 브랜치 캔버스' },
  { re: /^firebase\.js$/,       label: 'firebase.js — 실시간 리스너 / Auth' },
  { re: /^database\.rules\.json$/, label: 'database.rules.json — RTDB 규칙' },
];

function checkRiskyFiles(changedFiles) {
  const hits = [];
  changedFiles.forEach(f => {
    RISKY_PATTERNS.forEach(({ re, label }) => {
      if (re.test(f)) hits.push({ file: f, label });
    });
  });
  if (hits.length > 0) {
    warnings.push(`[위험 파일 변경] 작업 범위 확인 필요 (의도된 변경이면 무시):`);
    hits.forEach(h => warnings.push(`      - ${h.file}  (${h.label})`));
  }
}

/* ============================================================
   5) viewer.html 참조 파일 존재 검사
       src="X" / href="X" 의 로컬 경로만. http(s):, data:, // 등 외부 제외.
   ============================================================ */
function checkViewerHtmlRefs() {
  const viewerHtmlPath = path.join(ROOT, 'viewer.html');
  if (!fs.existsSync(viewerHtmlPath)) return;
  const html = fs.readFileSync(viewerHtmlPath, 'utf8');

  const refRe = /(?:src|href)="([^"]+)"/g;
  const refs = new Set();
  let m;
  while ((m = refRe.exec(html)) !== null) {
    const raw = m[1];
    if (/^(?:https?:)?\/\//.test(raw)) continue;     /* 외부 URL */
    if (raw.startsWith('data:')) continue;            /* data URI */
    if (raw.startsWith('#')) continue;                /* fragment */
    if (raw.startsWith('mailto:')) continue;
    /* ?v=... 제거 */
    const localPath = raw.split('?')[0].split('#')[0];
    if (!localPath) continue;
    refs.add(localPath);
  }

  refs.forEach(p => {
    const abs = path.join(ROOT, p);
    if (!fs.existsSync(abs)) {
      errors.push(`[viewer.html 참조] 파일 없음: ${p}`);
    }
  });
}

/* ============================================================
   메인
   ============================================================ */
function main() {
  console.log('🔍 가지 precommit-check 시작…');
  console.log('');

  const { list: changedFiles, source } = collectChangedFiles();
  const addedLines = collectAddedDiffLines();

  if (changedFiles.length === 0) {
    console.log('ℹ 변경된 파일 없음 (staged + working tree 모두). viewer.html 참조 검사만 박음.');
  } else {
    console.log(`ℹ 변경 파일 ${changedFiles.length}개 검사 (출처: ${source})`);
    changedFiles.forEach(f => console.log(`   · ${f}`));
  }
  console.log('');

  /* 5개 검사 */
  const jsCount = checkJsSyntax(changedFiles);
  checkConsoleLogs(addedLines);
  checkCacheVersion(changedFiles);
  checkRiskyFiles(changedFiles);
  checkViewerHtmlRefs();

  console.log(`▸ JS 문법 검사:        ${jsCount}개 파일`);
  console.log(`▸ console.log 잔여:    ${warnings.filter(w => w.startsWith('[console.log')).length ? '경고' : '깨끗'}`);
  console.log(`▸ Cache version:       ${errors.filter(e => e.startsWith('[Cache version]')).length ? '실패' : 'OK'}`);
  console.log(`▸ 위험 파일 변경:      ${warnings.filter(w => w.startsWith('[위험 파일')).length ? '경고' : '없음'}`);
  console.log(`▸ viewer.html 참조:    ${errors.filter(e => e.startsWith('[viewer.html 참조]')).length ? '실패' : 'OK'}`);
  console.log('');

  if (warnings.length > 0) {
    console.log('⚠ 경고');
    warnings.forEach(w => console.log('   ' + w));
    console.log('');
  }

  if (errors.length > 0) {
    console.log('❌ 실패');
    errors.forEach(e => console.log('   ' + e));
    console.log('');
    console.log(`총 실패 ${errors.length}건. commit 전 수정 부탁드려요.`);
    process.exit(1);
  }

  console.log('✅ precommit-check 통과');
  process.exit(0);
}

main();
