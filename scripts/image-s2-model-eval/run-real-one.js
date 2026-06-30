#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════
   IMAGE-S2 — 실제 작품 그림 1장 OpenAI 테스트 (운영자 1회 검증용)
   ──────────────────────────────────────────────────────────────
   ⚠️⚠️ 이 스크립트는 운영 Firebase의 "실제 학생 그림 1장"을 OpenAI(미국)로 전송한다.
        under-13/국외이전/보호자 안내 = 미결 개인정보 게이트. 운영자 책임 하에만.
   안전장치: --confirm-real-transfer 명시 필수 · OPENAI_API_KEY 필요 · 하드캡 $0.20 ·
            운영 DB/Storage 쓰기 0(읽기만) · 결과는 gitignored output/real/ 에만 · 원본 미저장.
   사용:
     node scripts/image-s2-model-eval/run-real-one.js \
       --class class_2026_junglim_1 --team 0000 --scene 1 \
       --prompt-level P2 --confirm-real-transfer
   ════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const lib = require('./eval-lib');
const promptPack = require('./prompt-pack');
const oa = require('./openai-eval-adapter');
const { getCandidate } = require('./candidates');

const OUTPUT_DIR = path.join(__dirname, 'output', 'real');
const HARD_CAP = 0.20;
const PROJECT = process.env.IMGS2_FB_PROJECT || 'picturebook-8731f';

function readImageData(cls, team, scene) {
  const enc = encodeURIComponent(team);
  const dbPath = `/classes/${cls}/teams/${enc}/scenes/${scene}/imageData`;
  const out = execFileSync('firebase', ['database:get', dbPath, '--project', PROJECT], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let val; try { val = JSON.parse(out); } catch (e) { val = null; }
  if (!val || typeof val !== 'string') {
    const alt = execFileSync('firebase', ['database:get', `/classes/${cls}/teams/${enc}/scenes/${scene}/imageUrl`, '--project', PROJECT], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    try { val = JSON.parse(alt); } catch (e) { val = null; }
  }
  return (typeof val === 'string' && val) ? val : null;
}

async function toBytes(src) {
  if (src.indexOf('data:') === 0) {
    const m = src.match(/^data:([^;]+);base64,(.*)$/);
    if (m) return { bytes: Buffer.from(m[2], 'base64'), mime: m[1] };
  }
  if (src.indexOf('http') === 0) {
    const res = await fetch(src);
    if (!res.ok) throw new Error('원본 다운로드 실패 HTTP ' + res.status);
    return { bytes: Buffer.from(await res.arrayBuffer()), mime: null };
  }
  /* 레거시 raw base64 가능성 */
  try { return { bytes: Buffer.from(src, 'base64'), mime: null }; } catch (e) { throw new Error('원본 형식 인식 불가'); }
}

async function main() {
  const a = lib.parseArgs(process.argv.slice(2));
  if (!a['confirm-real-transfer']) {
    console.error('중단: 실제 학생 그림을 OpenAI로 전송합니다. 동의하면 --confirm-real-transfer 를 붙이세요.');
    process.exit(2);
  }
  const cls = a['class'], team = a.team, scene = String(a.scene == null ? '' : a.scene);
  const level = promptPack.LEVELS[a['prompt-level']] ? a['prompt-level'] : 'P2';
  if (!cls || !team || scene === '') { console.error('필요: --class --team --scene'); process.exit(2); }
  if (!process.env.OPENAI_API_KEY) { console.error('중단: OPENAI_API_KEY 없음 (export 후 같은 창에서 실행).'); process.exit(2); }

  const cand = getCandidate('openai-gpt-image-2');
  const est = cand.pricing.estPerImageUsd;
  if (est > HARD_CAP) { console.error('예상 비용 초과'); process.exit(2); }

  console.error(`⚠️ 실제 그림 전송: ${cls}/${team}/scene ${scene} → OpenAI ${cand.modelId} / ${level} (예상 $${est}, 1장)`);
  console.error('원본 읽는 중(운영 DB 읽기만)…');
  const src = readImageData(cls, team, scene);
  if (!src) { console.error('해당 장면에 이미지가 없어요.'); process.exit(1); }
  const { bytes } = await toBytes(src);
  const mime = oa.sniffMime(bytes);
  if (!mime) { console.error('원본 MIME 미인식(png/jpeg/webp 아님) — 전송 안 함.'); process.exit(1); }
  const srcSha = crypto.createHash('sha256').update(bytes).digest('hex');
  console.error(`원본 ${mime} ${bytes.length}B sha256 ${srcSha.slice(0, 12)} — OpenAI 호출…`);

  const prompt = promptPack.buildPrompt(level);
  const started = Date.now();
  const out = await oa.callOpenAiImageEdit({
    apiKey: process.env.OPENAI_API_KEY, model: cand.modelId, imagePng: bytes, inputMime: mime,
    prompt: prompt.text, size: '1536x1024', quality: 'medium', fallbackPerImageUsd: est,
  });

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  let outputRef = null;
  if (out.ok && out.imageBytes) {
    outputRef = `real/${cls}__${team}__scene${scene}__${cand.modelId}__${level}.png`;
    fs.writeFileSync(path.join(__dirname, 'output', outputRef), out.imageBytes);
  }
  const rec = {
    tool: 'image-s2-real-one', when: started, class: cls, team, scene, promptLevel: level, promptVersion: prompt.promptVersion,
    model: cand.modelId, ok: !!out.ok, code: out.code || null, refusal: !!out.refusal, notes: out.reason || '',
    sourceMime: mime, sourceSha256: srcSha, latencyMs: out.latencyMs,
    outputMime: out.mimeType || null, outputBytes: out.imageBytes ? out.imageBytes.length : null,
    estCostUsd: Number.isFinite(out.estCost) ? out.estCost : (out.ok ? est : 0), currency: 'USD', outputRef,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'last-result.json'), JSON.stringify(rec, null, 2) + '\n');
  console.log(JSON.stringify(rec, null, 2));
  console.error(out.ok ? `\n✅ 결과 저장: scripts/image-s2-model-eval/output/${outputRef}` : `\n❌ 실패: ${out.code} ${out.reason || ''}`);
}

if (require.main === module) main().catch((e) => { console.error('오류:', e.message); process.exit(1); });
module.exports = { readImageData, toBytes };
