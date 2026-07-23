/* DISTINCTIVE+GENTLE 검증(2026-07-23) — 프로덕션 빌더 그대로 육안 검증.
   목적: 두 프롬프트 개선을 실 gpt-image-2로 증명(원본 없는 생성 경로 = 문구 격리).
     (1) GENTLE: 두드러기(발진)를 거부 없이 부드럽게 — 징그럽지 않게.
     (2) DISTINCTIVE: 이 장면 본문은 '산을 올랐다'만(물 언급 없음)인데
         whole-story에 '물로 된 산'이 있으면 배경이 물산으로 렌더되는가.
   안전: OPENAI_API_KEY 필요(터미널 export, repo/.env 저장 금지) · 2장 하드캡 · 비-production only.
   실행: cd scripts/image-s2-model-eval && OPENAI_API_KEY=sk-... node verify-gentle-distinct.js --run
   산출: output/verify-rash.png, output/verify-watermountain.png + used-prompts.txt */
'use strict';
const fs = require('fs');
const path = require('path');
const { buildStoryImagePrompt } = require('../../functions/image-s2-adapter-openai');

const RUN = process.argv.includes('--run');
const KEY = process.env.OPENAI_API_KEY || '';
const MODEL = process.env.IMGS2_OPENAI_MODEL || 'gpt-image-2';
const OUT = path.join(__dirname, 'output');
const ENDPOINT = 'https://api.openai.com/v1/images/generations';

/* 물로 된 산 이야기(뇨뇨 축약) — whole-story엔 '물로 된 산'이 있고, 올라가는 장면 본문엔 없음 */
const WHOLE = [
  '뇨뇨는 동그란 구름무 아이예요.',
  '낯선 마을에 들어서자 사람들이 온몸을 긁고 있었어요. 두드러기가 올라 빨갛게 부어 있었죠.',
  '뇨뇨도 곧 열이 나고 몸에 붉은 두드러기가 돋았어요.',
  '지혜로운 할아버지가 말했어요. "저 멀리, 물로 되어있는 산 꼭대기에 병을 낫게 하는 약초가 자란단다."',
  '뇨뇨는 물로 된 산을 오르기로 했어요.',
  '드디어 산을 올랐어요. 가파른 비탈을 한 걸음씩 올라갔죠.',
  '꼭대기에서 약초를 두 손 가득 캐어 마을로 내려왔어요.',
  '약초를 나눠 주자 마을 사람들의 두드러기가 씻은 듯 나았어요.',
].join(' / ');

const CASES = [
  {
    name: 'verify-rash',
    /* GENTLE 검증 — 발진이 두드러진 장면. 순화되어 렌더되는지. */
    scene: '마을 사람들이 온몸을 긁고 있었어요. 팔과 얼굴에 붉은 두드러기가 잔뜩 돋아 가려워했어요.',
  },
  {
    name: 'verify-watermountain',
    /* DISTINCTIVE 검증 — 본문엔 '물' 한 글자 없음. whole-story의 물산이 반영되는지. */
    scene: '드디어 산을 올랐어요. 가파른 비탈을 한 걸음씩 올라갔죠.',
  },
];

async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const promptLog = [];
  for (const c of CASES) {
    const prompt = buildStoryImagePrompt(c.scene, WHOLE, '');
    promptLog.push('=== ' + c.name + ' ===\nSCENE: ' + c.scene + '\n\nPROMPT:\n' + prompt + '\n');
  }
  fs.writeFileSync(path.join(OUT, 'used-prompts.txt'), promptLog.join('\n----------------------------------------\n\n'));
  console.log('프롬프트 기록 → output/used-prompts.txt');

  if (!RUN) { console.log('DRY-RUN(문구만 기록). 실제 생성하려면 --run + OPENAI_API_KEY.'); return; }
  if (!KEY) { console.error('중단: OPENAI_API_KEY 없음 (같은 창에서 export 후 실행).'); process.exit(2); }

  for (const c of CASES) {
    const prompt = buildStoryImagePrompt(c.scene, WHOLE, '');
    console.log('생성 중: ' + c.name + ' (' + MODEL + ') ...');
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt, size: '1536x1024', quality: 'medium', n: 1 }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || !json.data || !json.data[0] || !json.data[0].b64_json) {
      console.error('실패 ' + c.name + ': status=' + res.status + ' err=' + JSON.stringify(json && json.error));
      continue;
    }
    const buf = Buffer.from(json.data[0].b64_json, 'base64');
    fs.writeFileSync(path.join(OUT, c.name + '.png'), buf);
    console.log('저장: output/' + c.name + '.png (' + buf.length + ' bytes)');
  }
  console.log('완료. output/verify-rash.png, output/verify-watermountain.png 확인.');
}
main().catch((e) => { console.error(e); process.exit(1); });
