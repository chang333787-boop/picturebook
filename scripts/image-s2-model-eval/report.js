#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════
   IMAGE-S2 평가 — 정적 HTML 블라인드 비교 리포트 생성기
   ──────────────────────────────────────────────────────────────
   입력: output/results.json (없으면 output/pilot-plan.json). 외부 호출 0.
   각 샘플: 좌=합성 원본 / 우=모델 결과(있으면). 1~5점 입력 + JSON export.
   모델명은 블라인드 라벨(후보-1…)로 가림(reveal 토글). 결과/점수는 gitignored.
   사용: node scripts/image-s2-model-eval/report.js  → output/report.html
   ════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const OUTPUT_DIR = path.join(DIR, 'output');
const AXES = [
  ['originalPreserved', '원본 보존'], ['compositionPreserved', '구도 보존'], ['subjectCountPreserved', '인물·사물 수'],
  ['childlikeness', '학생다운 선·색'], ['promptAdherence', '지시 반영'], ['noHallucination', '불필요 추가·삭제 없음'],
  ['overall', '전체 적합성'],
];

function dataUri(absPath) {
  try {
    const ext = path.extname(absPath).toLowerCase();
    const mime = ext === '.svg' ? 'image/svg+xml' : (ext === '.png' ? 'image/png' : 'application/octet-stream');
    return `data:${mime};base64,` + fs.readFileSync(absPath).toString('base64');
  } catch (e) { return null; }
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function load() {
  for (const f of ['results.json', 'pilot-plan.json']) {
    const p = path.join(OUTPUT_DIR, f);
    if (fs.existsSync(p)) { try { return { data: JSON.parse(fs.readFileSync(p, 'utf8')), from: f }; } catch (e) {} }
  }
  return { data: null, from: null };
}

function main() {
  const { data, from } = load();
  if (!data) { console.error('output/results.json 또는 pilot-plan.json 없음 — 먼저 러너 실행'); process.exit(1); }
  const rows = (data.sampleIds || (data.results || []).map((r) => r.sampleId) || []);
  const resultsById = {};
  (data.results || []).forEach((r) => { resultsById[r.sampleId] = r; });

  const cards = rows.map((sid, idx) => {
    const origPng = path.join(DIR, 'samples', sid + '.png');
    const origSvg = path.join(DIR, 'samples', sid + '.svg');
    const orig = dataUri(fs.existsSync(origPng) ? origPng : origSvg);
    const r = resultsById[sid] || {};
    const resImg = r.outputRef ? dataUri(path.join(OUTPUT_DIR, r.outputRef)) : null;
    const scoreInputs = AXES.map(([k, label]) =>
      `<label class="ax">${esc(label)}<input type="number" min="1" max="5" data-sid="${esc(sid)}" data-ax="${esc(k)}" class="sc"></label>`).join('');
    return `<div class="card">
      <h3>샘플 ${idx + 1}: <span class="blind">후보-1</span> <button class="reveal" data-m="${esc(data.model || '')}">모델 보기</button></h3>
      <div class="pair">
        <figure><figcaption>합성 원본 (개인정보 0)</figcaption>${orig ? `<img src="${orig}">` : '<div class="ph">원본 없음</div>'}</figure>
        <figure><figcaption>결과 ${r.ok ? '✓' : (r.errorCode ? esc(r.errorCode) : '대기')}</figcaption>${resImg ? `<img src="${resImg}">` : '<div class="ph">결과 없음 (secret 등록 후 실행)</div>'}</figure>
      </div>
      <div class="meta">prompt ${esc(data.promptLevel || '')} · latency ${r.latencyMs != null ? r.latencyMs + 'ms' : '—'} · cost ${r.estCostUsd != null ? '$' + r.estCostUsd : '—'} · ${esc(r.outputMime || '')} ${r.outputBytes ? '(' + r.outputBytes + 'B)' : ''}</div>
      <div class="scores">${scoreInputs}</div>
    </div>`;
  }).join('\n');

  const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>imageS2 평가 리포트</title>
<style>
 body{font-family:-apple-system,system-ui,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#2b2b2b}
 .card{border:1px solid #ddd;border-radius:10px;padding:14px;margin:16px 0}
 .pair{display:flex;gap:12px}.pair figure{flex:1;margin:0}.pair img{width:100%;border:1px solid #eee;border-radius:6px;background:#fff}
 .ph{height:180px;display:flex;align-items:center;justify-content:center;color:#999;border:1px dashed #ccc;border-radius:6px}
 figcaption{font-size:12px;color:#666;margin-bottom:4px}.meta{font-size:12px;color:#777;margin:8px 0}
 .scores{display:flex;flex-wrap:wrap;gap:8px}.ax{font-size:12px;display:flex;flex-direction:column}.sc{width:56px}
 .blind{color:#999}.reveal{font-size:11px}button{cursor:pointer}
 header{border-bottom:2px solid #6a8a5b;padding-bottom:8px}.warn{background:#fff7e6;border:1px solid #ffd591;padding:8px 12px;border-radius:6px;font-size:13px}
</style>
<header><h1>가지 imageS2 — 모델 평가 리포트</h1>
<div class="meta">source: ${esc(from)} · mode: ${esc(data.mode || '')} · externalCall: ${String(!!data.externalCall)} · 조사일 ${esc(data.researchDate || '')}</div></header>
<p class="warn">⚠️ 합성 샘플(개인정보 0)·하니스 검증용. 최종 미적/적합성 판정은 사용자. 점수·결과 이미지는 commit 금지(gitignored).</p>
${cards || '<p>샘플 없음.</p>'}
<p><button id="export">점수 JSON 내보내기</button> <span id="msg"></span></p>
<script>
 document.querySelectorAll('.reveal').forEach(b=>b.onclick=()=>{const s=b.parentElement.querySelector('.blind');s.textContent=b.dataset.m||'(모델)';b.remove();});
 document.getElementById('export').onclick=()=>{
   const out={};document.querySelectorAll('.sc').forEach(i=>{if(i.value){out[i.dataset.sid]=out[i.dataset.sid]||{};out[i.dataset.sid][i.dataset.ax]=Number(i.value);}});
   const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'});const u=URL.createObjectURL(blob);
   const a=document.createElement('a');a.href=u;a.download='imageS2-scores.json';a.click();URL.revokeObjectURL(u);
   document.getElementById('msg').textContent='내보냄(다운로드). 이 파일은 commit 금지.';
 };
</script></html>`;

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const out = path.join(OUTPUT_DIR, 'report.html');
  fs.writeFileSync(out, html);
  console.log('리포트 생성 → ' + out + ' (gitignored)');
}

if (require.main === module) main();
module.exports = { AXES, main };
