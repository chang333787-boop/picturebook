/* ════════════════════════════════════════════════════════════════
   IMAGE-S2-8 모델 후보 — 공식 문서 기준 (조사일 2026-06-25)
   ──────────────────────────────────────────────────────────────
   ⚠️ 모델 ID·가격·상태는 변동된다. 코드에 deprecated ID 하드코딩 금지 →
      modelId 는 env override 가능. 가격은 "추정 USD/장"으로 비용 상한 계산에만 사용,
      실제 비용은 평가 실행 시 측정. 출처 URL·조사일을 각 항목에 기록.
   ★ 현행 GA 이미지-편집(이미지 입력→이미지 출력) 후보만 포함. deprecated 는 EXCLUDED.
   ════════════════════════════════════════════════════════════════ */

const RESEARCH_DATE = '2026-06-25';

/* 후보(≤3): OpenAI 운영 1 + Google 운영 1 + Google 고-fidelity 1.
   estPerImageUsd 는 1536x1024(3:2) 가로 1장 기준 추정(파생값은 estBasis 에 명시). */
const CANDIDATES = [
  {
    id: 'openai-gpt-image-2',
    provider: 'openai',
    modelId: process.env.IMGS2_OPENAI_MODEL || 'gpt-image-2',
    displayName: 'OpenAI GPT Image 2',
    status: 'ga',
    role: 'production',
    supportsImageInput: true,
    supportsImageEdit: true,
    endpoint: 'v1/images/edits (이미지 입력 → 편집 이미지 출력)',
    outputFormats: ['png', 'jpeg', 'webp'],
    landscape3to2: true,
    targetSize: '1536x1024',
    aspectConstraint: '장변:단변 ≤ 3:1 (3:2 가능)',
    sdkPackage: 'openai',
    secretEnv: 'OPENAI_API_KEY',
    authNote: 'API key(Bearer). GPT Image 모델은 developer console에서 Organization Verification 필요할 수 있음.',
    region: 'global API. OpenAI API 데이터 레지던시(한국 포함) opt-in 가능(eligible project).',
    safety: 'content-policy 필터(moderation auto/low). 워터마크 없음.',
    watermark: false,
    childrenPolicy: 'under-13 개인정보 처리 전 ZERO DATA RETENTION 필요(COPPA·under-18 safeguards). ★운영 검토 필요.',
    trainingDefault: 'API 기본 학습 미사용(opt-in 시에만 공유).',
    pricing: {
      model: 'token', textInputPerM: 5.0, imageInputPerM: 8.0, imageOutputPerM: 30.0,
      estPerImageUsd: 0.05,
      estBasis: '공식은 토큰 기반(이미지 출력 $30/1M)·calculator 권장. 직전세대 gpt-image-1.5 medium 1536x1024 = $0.05($32/1M)에서 $30/1M 보정 ≈ $0.047 → 보수적 $0.05.',
      currency: 'USD', asOf: RESEARCH_DATE,
    },
    officialUrl: 'https://developers.openai.com/api/docs/models/gpt-image-2',
    productionEligible: true,
    productionNote: 'API 학습 미사용(기본)·under-13 처리 전 ZDR 필요(COPPA)·한국 데이터 레지던시 opt-in 가능. 약관상 현 제품 구조에 적합한 1차 후보.',
    docUrls: [
      'https://developers.openai.com/api/docs/models/gpt-image-2',
      'https://developers.openai.com/api/docs/guides/image-generation',
      'https://developers.openai.com/api/docs/pricing',
    ],
    asOf: RESEARCH_DATE,
  },
  {
    id: 'google-gemini-2.5-flash-image',
    provider: 'google',
    modelId: process.env.IMGS2_GOOGLE_FLASH_MODEL || 'gemini-2.5-flash-image',
    displayName: 'Google Gemini 2.5 Flash Image (코드네임 Nano Banana)',
    status: 'ga',
    role: 'production',
    supportsImageInput: true,
    supportsImageEdit: true,
    endpoint: 'generateContent (responseModalities=[IMAGE], imageConfig.aspectRatio)',
    outputFormats: ['png', 'jpeg'],
    landscape3to2: true,
    targetSize: '1K(기본)/2K, aspect 3:2',
    aspectConstraint: '1:1·3:2·4:3·16:9 등 다수(3:2 가능)',
    sdkPackage: '@google/genai',
    secretEnv: 'GEMINI_API_KEY',
    authNote: 'Gemini Developer API key. ★paid tier 필수(free/Unpaid tier는 제출 콘텐츠를 제품·모델 개선에 사용+사람 검토). Vertex는 GCP IAM/ADC.',
    region: 'Developer API는 국외 캐시 가능(in-region 미보장). Korea 데이터 레지던시는 Vertex AI 경유 필요(Vertex GA·Seoul 리전 미확인).',
    safety: '표준 Gemini 안전필터 + 모든 출력에 SynthID 워터마크(기본 on).',
    watermark: true,
    childrenPolicy: 'Gemini Developer API 추가약관: 개발자 18세+ & under-18 대상/접근 가능 서비스 금지 → ★초등 플랫폼과 정책 충돌 소지(Vertex AI + DPA 경로가 대안).',
    trainingDefault: 'paid tier 학습 미사용. ⚠️free/Unpaid tier는 학습 사용(반드시 paid).',
    pricing: {
      model: 'token', imageInputPerM: 0.30, imageOutputPerImage: 0.039,
      estPerImageUsd: 0.04,
      estBasis: '공식 $0.039/이미지(1024px std). 3:2 landscape는 출력 토큰 증가로 약간 상회(공식 미itemize) → 보수적 $0.04.',
      currency: 'USD', asOf: RESEARCH_DATE,
    },
    officialUrl: 'https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-image',
    productionEligible: false,
    productionNote: '🔴 Gemini Developer API 추가약관: API Client를 under-18 대상/접근 가능 서비스에 사용 금지 → 초등 대상인 가지의 현 제품 구조와 부적합(production shortlist 제외). Vertex AI는 별도 계약·연령·국외이전·리전 검토 전까지 보류. **모델 품질이 이유 아님**(벤치마크 후보로는 유효).',
    docUrls: [
      'https://ai.google.dev/gemini-api/docs/image-generation',
      'https://ai.google.dev/gemini-api/docs/pricing',
      'https://ai.google.dev/gemini-api/terms',
    ],
    asOf: RESEARCH_DATE,
  },
  {
    id: 'google-gemini-3-pro-image',
    provider: 'google',
    modelId: process.env.IMGS2_GOOGLE_PRO_MODEL || 'gemini-3-pro-image',
    displayName: 'Google Gemini 3 Pro Image (코드네임 Nano Banana Pro)',
    status: 'ga',
    role: 'high-fidelity (참조 보존 최강 — 우리 "학생 그림 보존" 목적에 가장 부합. 단 비용↑·Vertex GA 미확인 → 자동 기본값 아님)',
    supportsImageInput: true,
    supportsImageEdit: true,
    endpoint: 'generateContent (responseModalities=[IMAGE]) — object ref 최대 6 + character ref 최대 5',
    outputFormats: ['png', 'jpeg'],
    landscape3to2: true,
    targetSize: '1K/2K/4K, aspect 3:2',
    aspectConstraint: '3:2 포함 다수',
    sdkPackage: '@google/genai',
    secretEnv: 'GEMINI_API_KEY',
    authNote: 'Gemini Developer API key(paid) 또는 Vertex AI.',
    region: '위 2.5 Flash 와 동일 주의(Vertex Korea 리전 미확인).',
    safety: '표준 안전필터 + SynthID 워터마크.',
    watermark: true,
    childrenPolicy: '위 Gemini Developer API 추가약관과 동일(under-18 제한).',
    trainingDefault: 'paid tier 학습 미사용. free tier 주의.',
    pricing: {
      model: 'token', imageInputPerM: 2.0, imageOutputPerM: 120.0, imageOutputPerImage: 0.134,
      estPerImageUsd: 0.134,
      estBasis: '공식 $0.134/이미지(1K/2K, 출력 $120/1M). 4K=$0.24.',
      currency: 'USD', asOf: RESEARCH_DATE,
    },
    officialUrl: 'https://ai.google.dev/gemini-api/docs/models/gemini-3-pro-image',
    productionEligible: false,
    productionNote: '🔴 위 gemini-2.5-flash-image 와 동일(Gemini Developer API under-18 약관 → production shortlist 제외, Vertex AI 보류). 모델 품질이 이유 아님.',
    docUrls: [
      'https://ai.google.dev/gemini-api/docs/models/gemini-3-pro-image',
      'https://ai.google.dev/gemini-api/docs/pricing',
    ],
    asOf: RESEARCH_DATE,
  },
];

/* 제외(후보 아님) — 이유 명시. deprecated/편집 미지원/종료 예정. */
const EXCLUDED = [
  { modelId: 'gpt-image-1', provider: 'openai', reason: 'DEPRECATED(공식 모델 페이지). 정식 가격 페이지에서 제외됨.', asOf: RESEARCH_DATE },
  { modelId: 'gpt-image-1.5', provider: 'openai', reason: 'DEPRECATED(snapshot gpt-image-1.5-2025-12-16). gpt-image-2로 대체.', asOf: RESEARCH_DATE },
  { modelId: 'gpt-image-1-mini', provider: 'openai', reason: 'DEPRECATED. 비용 비교 참고용으로만(out $8/1M).', asOf: RESEARCH_DATE },
  { modelId: 'gemini-3.1-flash-image', provider: 'google', reason: 'GA(Developer API)·후보 가치 있으나 ≤3 제한으로 보류. 대안 1순위(out $60/1M ≈ $0.067/img, ref 10+4). preview 별칭 오늘 종료.', asOf: RESEARCH_DATE },
  { modelId: 'imagen-4.0-*', provider: 'google', reason: 'DEPRECATED(종료 2026-08-17) + text-to-image 전용(이미지 편집 아님).', asOf: RESEARCH_DATE },
  { modelId: 'gemini-3-pro-image-preview / gemini-3.1-flash-image-preview', provider: 'google', reason: 'preview 별칭 — 2026-06-25(오늘) 종료. 비-preview GA id 사용.', asOf: RESEARCH_DATE },
];

function listCandidates() { return CANDIDATES.slice(); }
function getCandidate(id) { return CANDIDATES.find((c) => c.id === id) || null; }
function listByRole(role) { return CANDIDATES.filter((c) => String(c.role || '').indexOf(role) === 0); }

module.exports = { RESEARCH_DATE, CANDIDATES, EXCLUDED, listCandidates, getCandidate, listByRole };
