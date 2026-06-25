#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════
   IMAGE-S2 OpenAI gpt-image-2 소액 파일럿 러너 (고정 범위)
   ──────────────────────────────────────────────────────────────
   범위: provider=openai · model=gpt-image-2 · 합성 PNG 2샘플(A,E) · P2 · 샘플당 1장
        · 최대 2콜 · retry 0(기술오류시 예산내 최대 1) · 최대 비용 $0.50.
   기본 dry-run. 실호출은 모두 참일 때만:
     --execute + OPENAI_API_KEY + --max-cost≤0.50 + 예상≤한도 + 비-production + 합성샘플만.
   결과 이미지/점수는 gitignored output/ 에만. secret/headers/raw 미저장.
   사용: node scripts/image-s2-model-eval/run-openai-pilot.js [--execute] [--max-cost 0.50]
   ════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const lib = require('./eval-lib');
const promptPack = require('./prompt-pack');
const { getCandidate } = require('./candidates');
const openai = require('./openai-eval-adapter');

const PILOT_MANIFEST = path.join(__dirname, 'pilot-samples.json');
const OUTPUT_DIR = path.join(__dirname, 'output');
const RESULTS_DIR = path.join(OUTPUT_DIR, 'results');
const MAX_CALLS = 2;
const HARD_COST_CAP = 0.50;

function loadPilotSamples() {
  try { return JSON.parse(fs.readFileSync(PILOT_MANIFEST, 'utf8')).samples || []; } catch (e) { return []; }
}

function main() {
  const a = lib.parseArgs(process.argv.slice(2));
  const execute = !!a.execute && !a['dry-run'];
  let maxCostUsd = a['max-cost'] !== undefined ? Number(a['max-cost']) : HARD_COST_CAP;
  if (!Number.isFinite(maxCostUsd) || maxCostUsd > HARD_COST_CAP) maxCostUsd = HARD_COST_CAP;  /* 하드 캡 */

  const cand = getCandidate('openai-gpt-image-2');
  const cv = lib.validateCandidate(cand);
  if (!cv.ok) { console.error('후보 검증 실패: ' + cv.errors.join(', ')); process.exit(2); }

  const allSamples = loadPilotSamples().slice(0, MAX_CALLS);
  const samples = allSamples.filter(lib.isSyntheticSampleAllowed);
  if (samples.length !== allSamples.length) { console.error('합성 아닌 샘플 감지 — 중단'); process.exit(2); }

  const prompt = promptPack.buildPrompt('P2');
  const secretPresent = !!process.env.OPENAI_API_KEY;
  const estPerImage = cand.pricing.estPerImageUsd;
  const estMaxCostUsd = Math.round(estPerImage * samples.length * 1e6) / 1e6;

  const gate = lib.decideExecuteGate({
    execute, secretPresent, maxCostUsd, estMaxCostUsd,
    production: !!(process.env.K_SERVICE || process.env.FUNCTION_TARGET),
  });

  const report = {
    tool: 'image-s2-openai-pilot', researchDate: cand.asOf,
    provider: 'openai', model: cand.modelId, modelStatus: cand.status,
    mode: gate.dryRun ? 'dry-run' : (gate.allowed ? 'execute' : 'blocked'),
    externalCall: false,
    sampleIds: samples.map((s) => s.id), sampleHashes: samples.map((s) => ({ id: s.id, sha256: s.sha256 })),
    promptVersion: prompt.promptVersion, promptLevel: 'P2',
    plannedCalls: samples.length, maxCalls: MAX_CALLS,
    pricingBasis: cand.pricing.estBasis, estPerImageUsd: estPerImage,
    estMaxCostUsd, maxCostUsd, hardCostCap: HARD_COST_CAP,
    outputDir: OUTPUT_DIR, secretPresent,
    secretSetCommand: 'export OPENAI_API_KEY=sk-...   # 터미널에서만. repo/.env/문서 저장 금지',
    gate,
  };

  /* dry-run 또는 차단 → 외부 호출 절대 없음 */
  if (gate.dryRun || !gate.allowed) {
    if (!gate.dryRun) { report.blockedReasons = gate.reasons; console.error('실행 차단: ' + gate.reasons.join(' / ')); }
    if (estMaxCostUsd > maxCostUsd) console.error(`예상 비용 $${estMaxCostUsd} > 한도 $${maxCostUsd} — 호출 금지`);
    console.log(JSON.stringify(report, null, 2));
    try { if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true }); fs.writeFileSync(path.join(OUTPUT_DIR, 'pilot-plan.json'), JSON.stringify(report, null, 2) + '\n'); } catch (e) {}
    process.exit(0);
    return;
  }

  /* ── 게이트 통과(승인 후): 실제 소액 호출. secret 없으면 위에서 차단됨. ── */
  (async () => {
    if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const guard = lib.makeCostGuard(maxCostUsd);
    const results = [];
    for (const s of samples) {
      if (!guard.canAfford(estPerImage)) { console.error('비용 한도 도달 — 중단'); break; }
      const pngPath = path.join(__dirname, s.file);
      const imagePng = fs.readFileSync(pngPath);
      console.error(`호출 예정: ${cand.modelId} / ${s.id} / P2 / 예상 $${estPerImage}`);
      const started = Date.now();
      let out = await openai.callOpenAiImageEdit({
        apiKey: process.env.OPENAI_API_KEY, model: cand.modelId, imagePng,
        prompt: prompt.text, size: '1536x1024', quality: 'medium',
        fallbackPerImageUsd: estPerImage,
      });
      /* 기술 오류면 예산 내 1회 재시도 */
      if (!out.ok && (out.code === 'IMAGE_AI_TIMEOUT' || out.code === 'IMAGE_AI_PROVIDER_ERROR') && guard.canAfford(estPerImage * 2)) {
        out = await openai.callOpenAiImageEdit({ apiKey: process.env.OPENAI_API_KEY, model: cand.modelId, imagePng, prompt: prompt.text, size: '1536x1024', quality: 'medium', fallbackPerImageUsd: estPerImage });
      }
      let outputRef = null;
      if (out.ok && out.imageBytes) {
        outputRef = `results/${s.id}__${cand.modelId}__P2.png`;
        fs.writeFileSync(path.join(OUTPUT_DIR, outputRef), out.imageBytes);
        guard.add(Number.isFinite(out.estCost) ? out.estCost : estPerImage);
      }
      results.push(lib.buildResultRecord({
        provider: 'openai', modelId: cand.modelId, modelStatus: cand.status,
        sampleId: s.id, sampleSha256: s.sha256, promptLevel: 'P2', promptVersion: prompt.promptVersion,
        startedAt: started, endedAt: Date.now(), latencyMs: out.latencyMs,
        ok: !!out.ok, errorCode: out.code || null,
        outputMime: out.mimeType || null, outputBytes: out.imageBytes ? out.imageBytes.length : null,
        estCostUsd: Number.isFinite(out.estCost) ? out.estCost : (out.ok ? estPerImage : 0), currency: 'USD',
        outputRef, notes: out.refusal ? 'safety refusal' : (out.reason || ''),
      }));
    }
    report.results = results; report.spentUsd = Math.round(guard.spent() * 1e6) / 1e6; report.externalCall = true;
    fs.writeFileSync(path.join(OUTPUT_DIR, 'results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  })();
}

if (require.main === module) main();
module.exports = { loadPilotSamples, MAX_CALLS, HARD_COST_CAP };
