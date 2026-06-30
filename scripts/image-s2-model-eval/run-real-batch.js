#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════
   IMAGE-S2 — 한 작품의 실제 그림 여러 장 OpenAI 배치 테스트 (운영자 판단용)
   ──────────────────────────────────────────────────────────────
   ⚠️⚠️ 운영 Firebase의 "실제 학생 그림"들을 OpenAI(미국)로 전송한다(미결 개인정보 게이트).
        운영 DB/Storage 쓰기 0(읽기만). 결과는 gitignored output/real/ 에만. 원본 외부 재전송 0.
   안전: --confirm-real-transfer 필수 · OPENAI_API_KEY 필요 · 비용 가드(한도 초과 직전 중단) ·
        이미지 있는 장면만 · --skip 제외 · retry 0.
   사용:
     node scripts/image-s2-model-eval/run-real-batch.js \
       --class class_2026_junglim_1 --team 0000 --skip 1 \
       --prompt-level P2 --max-cost 1.5 --concurrency 2 --confirm-real-transfer
   결과 리포트: output/real-report.html
   ════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const lib = require('./eval-lib');
const promptPack = require('./prompt-pack');
const oa = require('./openai-eval-adapter');
const { getCandidate } = require('./candidates');
const { toBytes } = require('./run-real-one');

const PROJECT = process.env.IMGS2_FB_PROJECT || 'picturebook-8731f';
const OUT = path.join(__dirname, 'output');
const REAL = path.join(OUT, 'real');

function fetchScenes(cls, team) {
  const enc = encodeURIComponent(team);
  const out = execFileSync('firebase', ['database:get', `/classes/${cls}/teams/${enc}/scenes`, '--project', PROJECT], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  let j; try { j = JSON.parse(out); } catch (e) { j = null; }
  return (j && typeof j === 'object') ? j : {};
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

async function pool(items, n, fn) {
  const results = new Array(items.length); let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx], idx); } }
  await Promise.all(Array.from({ length: Math.max(1, n) }, worker));
  return results;
}

async function main() {
  const a = lib.parseArgs(process.argv.slice(2));
  if (!a['confirm-real-transfer']) { console.error('중단: 실제 그림을 OpenAI로 전송합니다. --confirm-real-transfer 필요.'); process.exit(2); }
  const cls = a['class'], team = a.team;
  if (!cls || !team) { console.error('필요: --class --team'); process.exit(2); }
  if (!process.env.OPENAI_API_KEY) { console.error('중단: OPENAI_API_KEY 없음.'); process.exit(2); }
  const level = promptPack.LEVELS[a['prompt-level']] ? a['prompt-level'] : 'P2';
  const skip = new Set(String(a.skip == null ? '' : a.skip).split(',').map((s) => s.trim()).filter(Boolean));
  const concurrency = Number.isFinite(Number(a.concurrency)) ? Math.max(1, Math.min(3, Number(a.concurrency))) : 2;

  const cand = getCandidate('openai-gpt-image-2');
  const est = cand.pricing.estPerImageUsd;
  const prompt = promptPack.buildPrompt(level);

  console.error('장면 목록 읽는 중(운영 DB 읽기만)…');
  const scenes = fetchScenes(cls, team);
  const targets = Object.keys(scenes)
    .filter((id) => { const sc = scenes[id] || {}; return (sc.imageData || sc.imageUrl) && !skip.has(String(id)); })
    .sort((x, y) => (Number(x) || 0) - (Number(y) || 0));
  const estTotal = Math.round(est * targets.length * 1e6) / 1e6;
  let maxCost = a['max-cost'] !== undefined ? Number(a['max-cost']) : Math.ceil((estTotal * 1.3 + 0.1) * 100) / 100;

  console.error(`대상 장면 ${targets.length}개: [${targets.join(', ')}] (skip: [${[...skip].join(', ')}])`);
  console.error(`모델 ${cand.modelId} / ${level} · 장당 ~$${est} · 예상 합계 ~$${estTotal} · 한도 $${maxCost} · 동시 ${concurrency}`);
  if (estTotal > maxCost) { console.error(`예상 합계 $${estTotal} > 한도 $${maxCost} — 중단(--max-cost 올리거나 --skip 추가).`); process.exit(2); }
  if (!targets.length) { console.error('대상 장면 없음.'); process.exit(1); }

  if (!fs.existsSync(REAL)) fs.mkdirSync(REAL, { recursive: true });
  const guard = lib.makeCostGuard(maxCost);
  let done = 0;

  const force = !!a.force;
  const records = await pool(targets, concurrency, async (scene) => {
    const ref = `real/${cls}__${team}__scene${scene}__${cand.modelId}__${level}.png`;
    const refAbs = path.join(OUT, ref);
    let originalDataUri = null, srcMime = null, srcSha = null;
    try {
      /* 원본은 항상 읽어 리포트용 썸네일로(운영 DB 읽기만) */
      const src = scenes[scene].imageData || scenes[scene].imageUrl;
      const { bytes } = await toBytes(src);
      srcMime = oa.sniffMime(bytes);
      if (!srcMime) return { scene, ok: false, code: 'BAD_SOURCE_MIME' };
      srcSha = crypto.createHash('sha256').update(bytes).digest('hex');
      originalDataUri = `data:${srcMime};base64,` + bytes.toString('base64');

      /* 이미 성공 결과가 있으면 재호출/재과금 안 함(재개) */
      if (!force && fs.existsSync(refAbs)) {
        done += 1;
        console.error(`[${scene}] ↩︎ 기존 결과 사용(건너뜀) — ${done}/${targets.length}`);
        return { scene, ok: true, cached: true, code: null, latencyMs: null, estCostUsd: 0, ref, srcMime, srcSha, originalDataUri };
      }
      if (!guard.canAfford(est)) { console.error(`[${scene}] 비용 한도 도달 — 건너뜀`); return { scene, ok: false, code: 'COST_CAP', originalDataUri, srcMime, srcSha }; }

      console.error(`[${scene}] 전송 → OpenAI (${srcMime} ${bytes.length}B, timeout 3분)…`);
      const out = await oa.callOpenAiImageEdit({ apiKey: process.env.OPENAI_API_KEY, model: cand.modelId, imagePng: bytes, inputMime: srcMime, prompt: prompt.text, size: '1536x1024', quality: 'medium', timeoutMs: 180000, fallbackPerImageUsd: est });
      if (out.ok && out.imageBytes) { fs.writeFileSync(refAbs, out.imageBytes); guard.add(Number.isFinite(out.estCost) ? out.estCost : est); }
      done += out.ok ? 1 : 0;
      console.error(`[${scene}] ${out.ok ? '✅' : '❌ ' + (out.code || '')} (${out.latencyMs}ms) — ${done}/${targets.length} 완료`);
      return { scene, ok: !!out.ok, code: out.code || null, refusal: !!out.refusal, latencyMs: out.latencyMs, outputMime: out.mimeType || null, outputBytes: out.imageBytes ? out.imageBytes.length : null, estCostUsd: Number.isFinite(out.estCost) ? out.estCost : (out.ok ? est : 0), ref: out.ok ? ref : null, srcMime, srcSha, originalDataUri };
    } catch (e) {
      console.error(`[${scene}] 오류: ${e.message}`);
      return { scene, ok: false, code: 'EXCEPTION', error: e.message, originalDataUri, srcMime, srcSha };
    }
  });

  /* 결과 JSON(원본 dataUri 제외 — 용량) */
  const summary = { tool: 'image-s2-real-batch', class: cls, team, model: cand.modelId, promptLevel: level, promptVersion: prompt.promptVersion, count: targets.length, succeeded: records.filter((r) => r && r.ok).length, spentUsd: Math.round(guard.spent() * 1e6) / 1e6, results: records.map((r) => { const c = Object.assign({}, r); delete c.originalDataUri; return c; }) };
  fs.writeFileSync(path.join(REAL, 'batch-results.json'), JSON.stringify(summary, null, 2) + '\n');

  /* HTML 비교 리포트(원본↔결과). output/는 gitignored. */
  const cards = records.map((r) => {
    const resUri = r && r.ref ? ('data:image/png;base64,' + fs.readFileSync(path.join(OUT, r.ref)).toString('base64')) : null;
    return `<div class="card"><h3>장면 ${esc(r && r.scene)} ${r && r.ok ? '✅' : '❌ ' + esc(r && r.code || '')}</h3>
      <div class="pair">
        <figure><figcaption>원본(학생)</figcaption>${r && r.originalDataUri ? `<img src="${r.originalDataUri}">` : '<div class=ph>없음</div>'}</figure>
        <figure><figcaption>gpt-image-2 / ${esc(level)}</figcaption>${resUri ? `<img src="${resUri}">` : `<div class=ph>${esc(r && r.code || '결과 없음')}</div>`}</figure>
      </div>
      <div class="meta">latency ${r && r.latencyMs != null ? r.latencyMs + 'ms' : '—'} · cost ${r && r.estCostUsd != null ? '$' + r.estCostUsd : '—'} · src ${esc(r && r.srcMime || '')}</div></div>`;
  }).join('\n');
  const html = `<!doctype html><meta charset=utf-8><title>imageS2 실제 그림 배치</title>
<style>body{font-family:system-ui,sans-serif;max-width:1000px;margin:24px auto;padding:0 16px;color:#2b2b2b}
.card{border:1px solid #ddd;border-radius:10px;padding:12px;margin:14px 0}.pair{display:flex;gap:12px}.pair figure{flex:1;margin:0}
.pair img{width:100%;border:1px solid #eee;border-radius:6px;background:#fff}figcaption{font-size:12px;color:#666}
.ph{height:160px;display:flex;align-items:center;justify-content:center;color:#999;border:1px dashed #ccc;border-radius:6px}
.meta{font-size:12px;color:#777;margin-top:6px}.warn{background:#fff7e6;border:1px solid #ffd591;padding:8px 12px;border-radius:6px;font-size:13px}
h1{border-bottom:2px solid #6a8a5b;padding-bottom:8px}</style>
<h1>가지 imageS2 — 실제 그림 배치 (${esc(cls)}/${esc(team)})</h1>
<p class="warn">⚠️ 실제 학생 그림을 gpt-image-2/${esc(level)}로 변환. 결과·원본 이미지는 commit 금지(gitignored). 모델: ${esc(cand.modelId)} · 성공 ${summary.succeeded}/${summary.count} · 합계 $${summary.spentUsd}</p>
${cards}`;
  fs.writeFileSync(path.join(OUT, 'real-report.html'), html);

  console.log(JSON.stringify({ count: summary.count, succeeded: summary.succeeded, spentUsd: summary.spentUsd, report: 'output/real-report.html' }, null, 2));
  console.error(`\n✅ 완료 — 리포트: scripts/image-s2-model-eval/output/real-report.html (open 명령으로 열기)`);
}

if (require.main === module) main().catch((e) => { console.error('오류:', e.message); process.exit(1); });
