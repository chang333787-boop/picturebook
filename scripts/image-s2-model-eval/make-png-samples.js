/* ════════════════════════════════════════════════════════════════
   IMAGE-S2 OpenAI 파일럿 — 합성 PNG 샘플 생성(개인정보 0).
   ──────────────────────────────────────────────────────────────
   OpenAI images/edits 는 PNG 입력 필요 → raster.js 로 child-like PNG 2종 생성.
   ⚠️ 합성·하니스 검증용. 실품질 결정엔 비식별 학생 그림 필요.
   실행: node scripts/image-s2-model-eval/make-png-samples.js
   ════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createCanvas } = require('./raster');

const OUT_DIR = path.join(__dirname, 'samples');
const MANIFEST = path.join(__dirname, 'pilot-samples.json');

const SKIN = [255, 224, 178, 255], OUTLINE = [93, 64, 55, 255], EYE = [62, 39, 35, 255];

/* A. 단순 캐릭터 1명 */
function drawA() {
  const c = createCanvas(600, 400);
  c.strokeCircle(300, 150, 40, OUTLINE, 5); c.fillCircle(300, 150, 38, SKIN);
  c.fillCircle(286, 144, 4, EYE); c.fillCircle(314, 144, 4, EYE);
  c.line(288, 162, 312, 160, OUTLINE, 3);                          /* 입 */
  c.fillRect(270, 195, 60, 80, [100, 181, 246, 255]); c.strokeCircle(300, 235, 1, OUTLINE, 1);
  c.line(270, 210, 235, 250, OUTLINE, 6); c.line(330, 210, 365, 250, OUTLINE, 6);   /* 팔 */
  c.line(282, 275, 278, 330, OUTLINE, 6); c.line(318, 275, 322, 330, OUTLINE, 6);   /* 다리 */
  return c;
}
/* E. 거친 선·저학년풍(흔들리는 산 + 해) */
function drawE() {
  const c = createCanvas(600, 400);
  let px = 150, py = 250;
  const pts = [[150, 250], [210, 140], [250, 250], [300, 150], [350, 250], [400, 160], [430, 250]];
  for (let i = 1; i < pts.length; i++) { c.line(px, py, pts[i][0], pts[i][1], OUTLINE, 7); px = pts[i][0]; py = pts[i][1]; }
  c.strokeCircle(300, 150, 30, OUTLINE, 6); c.fillCircle(300, 150, 26, [255, 245, 157, 255]);
  return c;
}

function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const defs = [
    { id: 'A_single_character', type: '단순 캐릭터 1명', canvas: drawA() },
    { id: 'E_rough_lowgrade', type: '거친 선·저학년풍(연필/덜 채색 학생풍)', canvas: drawE() },
  ];
  const samples = [];
  for (const d of defs) {
    const png = d.canvas.toPNG();
    const file = `samples/${d.id}.png`;
    fs.writeFileSync(path.join(OUT_DIR, `${d.id}.png`), png);
    samples.push({
      id: d.id, type: d.type, file, format: 'png',
      width: d.canvas.w, height: d.canvas.h,
      sha256: crypto.createHash('sha256').update(png).digest('hex'), bytes: png.length,
      synthetic: true,
    });
  }
  const manifest = {
    version: 'imgS2-openai-pilot-samples-v1',
    privacy: '개인정보 0 — 합성 PNG. 운영 학생 데이터 미사용.',
    synthetic: true, harnessOnly: true, insufficientForFinalQualityDecision: true,
    samples,
  };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`PNG 샘플 ${samples.length}종 생성 → ${OUT_DIR}`);
  samples.forEach((s) => console.log(`  ${s.id} ${s.width}x${s.height} ${s.bytes}B ${s.sha256.slice(0, 12)}`));
}

if (require.main === module) main();
module.exports = { drawA, drawE, main };
