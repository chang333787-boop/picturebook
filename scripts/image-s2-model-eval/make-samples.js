/* ════════════════════════════════════════════════════════════════
   IMAGE-S2-8 평가 — 합성 테스트 샘플 생성기 (개인정보 0)
   ──────────────────────────────────────────────────────────────
   ⚠️ 운영 학생 실데이터 사용 금지. 여기서는 child-like SVG 합성 그림만 생성한다.
   ⚠️ 이 합성 샘플은 "평가 하니스 검증용"이며 실제 모델 품질 결정에는 부족하다
      (실제 결정은 사용자가 제공한 비식별 학생 그림 또는 라이선스 free 에셋 필요).
   실행: node scripts/image-s2-model-eval/make-samples.js   → samples/*.svg + sample-manifest.json
   (SVG 입력. 실제 API 제출 전에는 PNG 래스터화 필요 — 승인 게이트 항목.)
   ════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OUT_DIR = path.join(__dirname, 'samples');
const MANIFEST = path.join(__dirname, 'sample-manifest.json');

/* child-like 헬퍼: 굵고 흔들리는 선, 제한된 팔레트, 단순 형태. */
function kid(cx, cy, s, color) {
  return `
    <circle cx="${cx}" cy="${cy}" r="${18 * s}" fill="#ffe0b2" stroke="#5d4037" stroke-width="${4 * s}"/>
    <circle cx="${cx - 6 * s}" cy="${cy - 3 * s}" r="${2.5 * s}" fill="#3e2723"/>
    <circle cx="${cx + 6 * s}" cy="${cy - 3 * s}" r="${2.5 * s}" fill="#3e2723"/>
    <path d="M ${cx - 7 * s} ${cy + 7 * s} Q ${cx} ${cy + 12 * s} ${cx + 7 * s} ${cy + 6 * s}" stroke="#3e2723" stroke-width="${2.5 * s}" fill="none"/>
    <rect x="${cx - 14 * s}" y="${cy + 18 * s}" width="${28 * s}" height="${34 * s}" rx="${6 * s}" fill="${color}" stroke="#5d4037" stroke-width="${4 * s}"/>
    <line x1="${cx - 14 * s}" y1="${cy + 26 * s}" x2="${cx - 30 * s}" y2="${cy + 40 * s}" stroke="#5d4037" stroke-width="${4 * s}"/>
    <line x1="${cx + 14 * s}" y1="${cy + 26 * s}" x2="${cx + 30 * s}" y2="${cy + 40 * s}" stroke="#5d4037" stroke-width="${4 * s}"/>`;
}
function frame(inner, bg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400" width="600" height="400">
  <rect width="600" height="400" fill="${bg || '#ffffff'}"/>
  ${inner}
</svg>`;
}

/* 유형별 합성 그림(A~J). 의도: 보존 평가가 의미 있도록 인물 수·구도·여백·텍스트가 서로 다름. */
const DEFS = [
  { id: 'A_single_character', type: '단순 캐릭터 1명', svg: () => frame(kid(300, 170, 1.4, '#64b5f6')) },
  { id: 'B_two_three_characters', type: '캐릭터 2~3명 관계', svg: () => frame(`${kid(200, 180, 1.1, '#e57373')}${kid(330, 180, 1.1, '#81c784')}${kid(450, 185, 1.0, '#ffb74d')}<line x1="232" y1="215" x2="298" y2="215" stroke="#5d4037" stroke-width="4"/>`) },
  { id: 'C_scene_with_background', type: '배경 있는 장면', svg: () => frame(`<circle cx="500" cy="80" r="40" fill="#fff176"/><rect x="0" y="320" width="600" height="80" fill="#a5d6a7"/><rect x="120" y="250" width="22" height="70" fill="#8d6e63"/><circle cx="131" cy="240" r="45" fill="#66bb6a"/>${kid(330, 250, 1.2, '#9575cd')}`) },
  { id: 'D_pencil_uncolored', type: '색칠 덜 된 연필 그림', svg: () => frame(`<g stroke="#9e9e9e" stroke-width="3" fill="none">${kid(300, 180, 1.3, 'none')}</g>`) },
  { id: 'E_rough_lowgrade', type: '거친 선·저학년풍', svg: () => frame(`<path d="M180 250 Q 210 130 250 250 Q 300 140 350 250 Q 400 150 430 250" stroke="#5d4037" stroke-width="7" fill="none"/><circle cx="300" cy="150" r="30" fill="#fff59d" stroke="#5d4037" stroke-width="6"/>`) },
  { id: 'F_props_complex', type: '소품·복잡 구도', svg: () => frame(`${kid(150, 180, 0.9, '#4dd0e1')}<rect x="260" y="240" width="40" height="40" fill="#ff8a65" stroke="#5d4037" stroke-width="3"/><circle cx="360" cy="150" r="16" fill="#f06292"/><polygon points="430,260 460,200 490,260" fill="#aed581" stroke="#5d4037" stroke-width="3"/><rect x="300" y="300" width="60" height="20" fill="#ba68c8"/>`) },
  { id: 'G_with_speech_bubble', type: '말풍선(한글) 포함', svg: () => frame(`${kid(220, 200, 1.2, '#4fc3f7')}<path d="M330 90 h180 a14 14 0 0 1 14 14 v60 a14 14 0 0 1 -14 14 h-150 l-26 26 v-26 h-4 a14 14 0 0 1 -14 -14 v-60 a14 14 0 0 1 14 -14 z" fill="#ffffff" stroke="#5d4037" stroke-width="3"/><text x="420" y="150" font-size="40" text-anchor="middle" fill="#3e2723" font-family="sans-serif">안녕</text>`) },
  { id: 'H_dark_scene', type: '어두운 장면', svg: () => frame(`<circle cx="500" cy="80" r="34" fill="#fff9c4"/><g fill="#ffffff"><circle cx="120" cy="70" r="3"/><circle cx="200" cy="120" r="2"/><circle cx="320" cy="60" r="3"/></g>${kid(290, 250, 1.2, '#7986cb')}`, '#1a237e') },
  { id: 'I_background_centric', type: '배경 중심(숲/실내)', svg: () => frame(`<rect x="0" y="300" width="600" height="100" fill="#8d6e63"/><g stroke="#5d4037" stroke-width="6" fill="#66bb6a"><circle cx="100" cy="220" r="55"/><circle cx="250" cy="200" r="65"/><circle cx="430" cy="225" r="60"/><circle cx="540" cy="210" r="50"/></g>${kid(300, 300, 0.8, '#ffb74d')}`, '#e8f5e9') },
  { id: 'J_lots_of_margin', type: '여백 많은 그림', svg: () => frame(`${kid(110, 110, 0.7, '#f06292')}`) },
];

function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const samples = [];
  for (const d of DEFS) {
    const svg = d.svg().trim() + '\n';
    const file = `samples/${d.id}.svg`;
    fs.writeFileSync(path.join(OUT_DIR, `${d.id}.svg`), svg, 'utf8');
    const sha256 = crypto.createHash('sha256').update(svg).digest('hex');
    samples.push({ id: d.id, type: d.type, file, format: 'svg', sha256, bytes: Buffer.byteLength(svg, 'utf8'),
      note: '합성(개인정보 0)·하니스 검증용. 실제 품질 결정엔 비식별 학생 그림 필요. API 제출 전 PNG 래스터화 필요.' });
  }
  const manifest = {
    version: 'imgS2-eval-samples-v1',
    privacy: '개인정보 0 — 운영 학생 데이터 미사용. 합성 SVG만.',
    harnessOnly: true,
    insufficientForFinalQualityDecision: true,
    rasterizeBeforeApiSubmit: 'svg → png (1600px 장변)',
    samples,
  };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`생성: ${samples.length} samples → ${OUT_DIR}`);
  console.log(`manifest → ${MANIFEST}`);
}

if (require.main === module) main();
module.exports = { DEFS, main };
