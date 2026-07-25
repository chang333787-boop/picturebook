#!/usr/bin/env node
/* ============================================================
   가지 bump-busters — 캐시 버스터 자동화 (BUSTER-AUTO-1, 2026-07-12)
   ─────────────────────────────────────────────
   배경: ?v= 토큰을 손으로 이어붙이던 방식은 실사고 2회
   (EDIT_SRC 꼬리 누락·teacherjoin1 오배치 — sed 조용한 실패).
   이제 버스터 = 참조 파일 내용의 md5 앞 10자리.
   파일이 바뀌면 해시가 바뀌고, 안 바뀌면 그대로 — 사람이 관리 안 함.

   실행:
     node scripts/bump-busters.js --check   # 어긋난 참조 나열, 있으면 exit 1 (커밋 전 검사)
     node scripts/bump-busters.js --write   # 전부 해시로 갱신 (JS/CSS 수정 후 실행)

   규칙:
     · 대상 = 루트 HTML(아래 목록)의 로컬 js/css 참조 중 이미 ?v= 가 있는 것만.
       (http(s) 외부 URL·?v= 없는 참조는 손대지 않음 — 의도 보존)
     · 참조 파일이 없으면 오류(exit 1) — 깨진 참조 조기 발견.
     · 외부 패키지 0 (fs/path/crypto만).
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const HTML_FILES = ['index.html', 'maker.html', 'viewer.html', 'branch.html', 'teacher-auth.html', 'privacy.html'];
const REF_RE = /(src|href)="([^":]+?\.(?:js|css))\?v=([^"]*)"/g;
/* 지연 로드 번들(viewer.html EDIT_SRC/AI_SRC/IMG_SRC/STORY_SRC) — 과거 실사고(꼬리 누락)가
   정확히 이 지점. var XXX_SRC = 'file.js?v=...' 형태만 매칭(일반 JS 문자열 오변경 방지). */
const LAZY_RE = /(var\s+[A-Z_]+_SRC\s*=\s*')([^'?:]+?\.js)\?v=([^']*)(')/g;

const MODE = process.argv.includes('--write') ? 'write'
           : process.argv.includes('--check') ? 'check' : null;
if (!MODE) {
  console.log('사용법: node scripts/bump-busters.js --check | --write');
  process.exit(2);
}

function hashOf(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
}

let mismatches = 0;
let missing = 0;
let rewritten = 0;

/* viewer-edit.js(나침반 번들 로더)를 HTML보다 먼저 — 같은 실행에서 EDIT_SRC 해시가 갱신본 기준이 되게 */
processCompassLoader();

HTML_FILES.forEach((htmlName) => {
  const htmlPath = path.join(ROOT, htmlName);
  if (!fs.existsSync(htmlPath)) return;
  const src = fs.readFileSync(htmlPath, 'utf8');

  const handle = (whole, prefixOut, ref, oldV, suffixOut) => {
    if (/^(https?:)?\/\//.test(ref)) return whole;
    const target = path.join(ROOT, ref);
    if (!fs.existsSync(target)) {
      console.error(`❌ ${htmlName}: 참조 파일 없음 — ${ref}`);
      missing++;
      return whole;
    }
    const h = hashOf(target);
    if (oldV === h) return whole;
    mismatches++;
    if (MODE === 'check') {
      console.log(`  · ${htmlName}: ${ref}  ?v=${oldV.length > 24 ? oldV.slice(0, 24) + '…' : oldV}  →  ${h}`);
      return whole;
    }
    rewritten++;
    return `${prefixOut}${ref}?v=${h}${suffixOut}`;
  };

  let out = src.replace(REF_RE, (whole, attr, ref, oldV) =>
    handle(whole, `${attr}="`, ref, oldV, `"`));
  out = out.replace(LAZY_RE, (whole, varPrefix, ref, oldV, quote) =>
    handle(whole, varPrefix, ref, oldV, quote));

  if (MODE === 'write' && out !== src) fs.writeFileSync(htmlPath, out);
});

/* ── 감사 #16(2026-07-25): viewer-edit.js 나침반 지연 번들 — 고정 문자열 버스터(rosefirst1)가
   커버리지 밖이라 compass 파일 수정이 캐시 버전으로 새던 구멍.
   · 'xxx.css?v=…' 문자열 참조 = 해당 파일 내용 해시(HTML 규칙과 동일)
   · const V = '?v=…' = await load('file.js' + V)로 싣는 JS들의 "결합 해시"(하나만 바뀌어도 V 변경) */
function processCompassLoader() {
  const jsPath = path.join(ROOT, 'viewer-edit.js');
  if (!fs.existsSync(jsPath)) return;
  const src = fs.readFileSync(jsPath, 'utf8');

  const CSS_STR_RE = /(')([^':]+?\.css)\?v=([^']*)(')/g;
  let out = src.replace(CSS_STR_RE, (whole, q1, ref, oldV, q2) => {
    const target = path.join(ROOT, ref);
    if (!fs.existsSync(target)) { console.error(`❌ viewer-edit.js: 참조 파일 없음 — ${ref}`); missing++; return whole; }
    const h = hashOf(target);
    if (oldV === h) return whole;
    mismatches++;
    if (MODE === 'check') {
      console.log(`  · viewer-edit.js: ${ref}  ?v=${oldV.length > 24 ? oldV.slice(0, 24) + '…' : oldV}  →  ${h}`);
      return whole;
    }
    rewritten++;
    return `${q1}${ref}?v=${h}${q2}`;
  });

  const bundleRefs = [];
  const BUNDLE_RE = /await load\('([^':]+?\.js)' \+ V\)/g;
  let m;
  while ((m = BUNDLE_RE.exec(src)) !== null) bundleRefs.push(m[1]);
  if (bundleRefs.length) {
    let allExist = true;
    const hasher = crypto.createHash('md5');
    bundleRefs.forEach((ref) => {
      const t = path.join(ROOT, ref);
      if (!fs.existsSync(t)) { console.error(`❌ viewer-edit.js: 번들 참조 파일 없음 — ${ref}`); missing++; allExist = false; return; }
      hasher.update(fs.readFileSync(t));
    });
    if (allExist) {
      const combined = hasher.digest('hex').slice(0, 10);
      out = out.replace(/(const V = '\?v=)([^']*)(')/, (whole, pre, oldV, post) => {
        if (oldV === combined) return whole;
        mismatches++;
        if (MODE === 'check') {
          console.log(`  · viewer-edit.js: compass 번들(${bundleRefs.length}종)  ?v=${oldV.length > 24 ? oldV.slice(0, 24) + '…' : oldV}  →  ${combined}`);
          return whole;
        }
        rewritten++;
        return `${pre}${combined}${post}`;
      });
    }
  }
  if (MODE === 'write' && out !== src) fs.writeFileSync(jsPath, out);
}

if (missing > 0) {
  console.error(`\n❌ 깨진 참조 ${missing}건 — 먼저 고쳐 주세요.`);
  process.exit(1);
}
if (MODE === 'check') {
  if (mismatches === 0) {
    console.log('✅ 모든 버스터가 파일 내용과 일치해요.');
  } else {
    console.log(`\n⚠️ 어긋난 버스터 ${mismatches}건 — node scripts/bump-busters.js --write 로 갱신하세요.`);
    process.exit(1);
  }
} else {
  console.log(rewritten === 0
    ? '✅ 갱신할 것 없음 — 이미 전부 일치해요.'
    : `✅ 버스터 ${rewritten}건 갱신 완료 (내용 해시 10자리).`);
}
