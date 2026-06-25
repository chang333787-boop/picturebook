#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════
   IMAGE-S2-8 모델 평가 러너 (CLI)
   ──────────────────────────────────────────────────────────────
   기본 = dry-run(외부 호출 0). 실제 호출은 다중 안전장치 통과 시에만:
     --execute  + provider secret(env) + --max-cost + 예상비용≤한도 + 비-production
     게다가 eval-adapter.execute 는 SDK 미설치/미연결이면 실제 호출하지 않는다(S2-9).
   사용:
     node scripts/image-s2-model-eval/run-evaluation.js               # 전체 후보 dry-run
     node ... --provider openai                                       # 후보 필터
     node ... --sample A_single_character --prompt-level P2           # 샘플/강도 필터
     node ... --max-cost 1.5 --execute                                # (승인 후) 실제 — secret 없으면 차단
   옵션: --provider --model --sample --prompt-level --dry-run --execute --max-cost --output-dir --pilot
   ════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const lib = require('./eval-lib');
const { CANDIDATES, RESEARCH_DATE } = require('./candidates');
const promptPack = require('./prompt-pack');
const { createEvalAdapter } = require('./eval-adapters');

const DEFAULT_OUTPUT_DIR = path.join(__dirname, 'output');
const MANIFEST_PATH = path.join(__dirname, 'sample-manifest.json');
const PILOT_SAMPLES_PER_MODEL = 2;   /* §6 최초 파일럿 기본 */

function loadSamples() {
  try { return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')).samples || []; }
  catch (e) { return []; }
}

function selectCandidates(a) {
  let cs = CANDIDATES.slice();
  if (a.provider) cs = cs.filter((c) => c.provider === a.provider);
  if (a.model) cs = cs.filter((c) => c.modelId === a.model || c.id === a.model);
  return cs;
}
function selectSamples(a, all) {
  let ss = all.slice();
  if (a.sample) ss = ss.filter((s) => s.id === a.sample || s.id.indexOf(a.sample) === 0);
  if (a.pilot !== false) ss = ss.slice(0, PILOT_SAMPLES_PER_MODEL);   /* 기본 파일럿 제한 */
  return ss;
}
function selectLevels(a) {
  if (a['prompt-level']) return [String(a['prompt-level'])].filter((l) => promptPack.LEVELS[l]);
  return promptPack.listLevels();
}

function main() {
  const a = lib.parseArgs(process.argv.slice(2));
  if (a.pilot === 'false' || a['all-samples']) a.pilot = false;
  const outputDir = a['output-dir'] ? String(a['output-dir']) : DEFAULT_OUTPUT_DIR;
  const execute = !!a.execute && !a['dry-run'];
  const maxCostUsd = a['max-cost'] !== undefined ? Number(a['max-cost']) : NaN;

  const candidates = selectCandidates(a);
  const allSamples = loadSamples();
  const samples = selectSamples(a, allSamples);
  const levels = selectLevels(a);

  /* 후보 검증 — placeholder/deprecated/편집 미지원 거부 */
  const invalid = candidates.map((c) => ({ c, v: lib.validateCandidate(c) })).filter((x) => !x.v.ok);
  if (invalid.length) {
    console.error('후보 검증 실패:');
    invalid.forEach((x) => console.error(`  - ${x.c.id}: ${x.v.errors.join(', ')}`));
    process.exit(2);
  }

  const promptVersion = promptPack.PROMPT_PACK_VERSION;
  const plan = lib.buildDryRunPlan({ candidates, samples, levels, promptVersion, outputDir });
  const estMaxCostUsd = plan.estMaxCostUsd;

  /* 실행 게이트 판정 */
  const gate = lib.decideExecuteGate({
    execute,
    secretPresent: candidates.every((c) => !!process.env[c.secretEnv]),
    maxCostUsd, estMaxCostUsd,
    production: process.env.K_SERVICE || process.env.FUNCTION_TARGET ? true : false,
  });

  const report = {
    tool: 'image-s2-model-eval', researchDate: RESEARCH_DATE,
    mode: gate.dryRun ? 'dry-run' : (gate.allowed ? 'execute' : 'blocked'),
    externalCall: false,
    candidates: plan.models,
    samples: plan.sampleHashes,
    promptVersion, promptLevels: levels,
    plannedCalls: plan.plannedCalls,
    estMaxCostUsd, maxCostUsd: Number.isFinite(maxCostUsd) ? maxCostUsd : null,
    outputDir, gate,
    secretEnvsNeeded: Array.from(new Set(candidates.map((c) => c.secretEnv))),
  };

  /* dry-run 또는 게이트 차단 → 실제 호출 절대 없음 */
  if (gate.dryRun || !gate.allowed) {
    if (!gate.dryRun && !gate.allowed) {
      report.blockedReasons = gate.reasons;
      console.error('실행 차단(안전장치):');
      gate.reasons.forEach((r) => console.error('  - ' + r));
    }
    console.log(JSON.stringify(report, null, 2));
    /* dry-run 계획 파일 저장(gitignored output-dir) */
    if (lib.isSafeOutputPath(path.dirname(outputDir) + '/', outputDir + '/') || outputDir === DEFAULT_OUTPUT_DIR) {
      try {
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(path.join(outputDir, 'dry-run-plan.json'), JSON.stringify(report, null, 2) + '\n');
      } catch (e) { /* best-effort */ }
    }
    process.exit(gate.allowed || gate.dryRun ? 0 : 3);
    return;
  }

  /* ── 여기부터는 게이트를 모두 통과한 경우(승인 후 S2-9). 본 루프에서는 도달하지 않는다. ── */
  const guard = lib.makeCostGuard(maxCostUsd);
  const adapters = candidates.map((c) => ({ c, ad: createEvalAdapter(c) }));
  const results = [];
  (async () => {
    for (const { c, ad } of adapters) {
      for (const s of samples) {
        for (const lvl of levels) {
          const est = (c.pricing && c.pricing.estPerImageUsd) || 0;
          if (!guard.canAfford(est)) { console.error(`비용 한도 도달 — 중단(spent $${guard.spent()})`); break; }
          const out = await ad.execute({ sampleId: s.id, sampleSha256: s.sha256, promptLevel: lvl, promptVersion });
          if (out && out.ok) guard.add(est);
          results.push(lib.buildResultRecord({ provider: c.provider, modelId: c.modelId, modelStatus: c.status,
            sampleId: s.id, sampleSha256: s.sha256, promptLevel: lvl, promptVersion,
            ok: !!(out && out.ok), errorCode: out && out.code, estCostUsd: est, currency: 'USD' }));
        }
      }
    }
    report.results = results; report.spentUsd = guard.spent();
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  })();
}

if (require.main === module) main();
module.exports = { selectCandidates, selectSamples, selectLevels };
