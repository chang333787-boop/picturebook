/* ════════════════════════════════════════════════════════════════
   IMAGE-S2-5 — 이미지 AI provider-neutral adapter
   ──────────────────────────────────────────────────────────────
   정본: PRD §14·§16 — 모델 제공사 미확정(Gemini Nano Banana vs OpenAI gpt-image).
   ⚠️ 실제 provider 연결(secret·SDK·고정 프롬프트 본문)은 S2-9. 여기서는 계약만:
     · 통일 인터페이스 generate(req) -> {ok, bytes, mimeType, model, modelVersion} | {ok:false, code}
     · fake adapter(파이프라인 stub 검증용) / not-configured adapter(prod 기본=생성 차단)
     · timeout / retry(최대 1회 또는 정본) / error normalize / cancellation-safe 정책 래퍼
   firebase 비의존 → node 단독 테스트 가능.
   ════════════════════════════════════════════════════════════════ */

const IMAGE_AI_ERROR_CODES = {
  NOT_CONFIGURED: 'IMAGE_AI_NOT_CONFIGURED',
  TIMEOUT: 'IMAGE_AI_TIMEOUT',
  PROVIDER_ERROR: 'IMAGE_AI_PROVIDER_ERROR',
  UNSAFE_OUTPUT: 'IMAGE_AI_UNSAFE_OUTPUT',
  INVALID_OUTPUT: 'IMAGE_AI_INVALID_OUTPUT',
  SOURCE_STALE: 'IMAGE_AI_SOURCE_STALE',
  QUOTA_EXCEEDED: 'IMAGE_AI_QUOTA_EXCEEDED',
  CANCELLED: 'IMAGE_AI_CANCELLED',
};

/* 재시도 가능 코드 — 일시적 실패만. 안전차단/잘못된 출력은 재시도 금지. */
const RETRYABLE_CODES = [IMAGE_AI_ERROR_CODES.TIMEOUT, IMAGE_AI_ERROR_CODES.PROVIDER_ERROR];

/* 최소 유효 1x1 PNG(파이프라인 stub 검증용 — 실제 모델 결과 아님). */
const FAKE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
function _fakePngBuffer() { return Buffer.from(FAKE_PNG_BASE64, 'base64'); }

/* ── not-configured adapter (prod 기본) ──
   provider 미확정 → 항상 NOT_CONFIGURED. 호출돼도 생성/네트워크/비용 0. */
function createNotConfiguredAdapter() {
  return {
    configured: false,
    model: '',
    modelVersion: '',
    async generate() {
      return { ok: false, code: IMAGE_AI_ERROR_CODES.NOT_CONFIGURED };
    },
  };
}

/* ── fake adapter (stub 검증 전용) ──
   결정적 fake PNG 반환. opts.fail(코드) / opts.delayMs(타임아웃 테스트) / opts.failTimes(N회 실패 후 성공) 주입.
   ⚠️ 운영 배포에서 절대 기본 선택되면 안 됨(콜러블은 명시적 env 일 때만 선택). */
function createFakeAdapter(opts) {
  const o = opts || {};
  let calls = 0;
  return {
    configured: true,
    model: o.model || 'fake-imageS2',
    modelVersion: o.modelVersion || 'fake-v1',
    _calls() { return calls; },
    async generate() {
      calls += 1;
      if (o.delayMs && o.delayMs > 0) {
        await new Promise((r) => setTimeout(r, o.delayMs));
      }
      if (o.failTimes && calls <= o.failTimes) {
        return { ok: false, code: o.failCode || IMAGE_AI_ERROR_CODES.PROVIDER_ERROR };
      }
      if (o.fail) {
        return { ok: false, code: o.fail };
      }
      const buf = _fakePngBuffer();
      return {
        ok: true,
        bytes: buf,
        mimeType: o.mimeType || 'image/png',
        model: o.model || 'fake-imageS2',
        modelVersion: o.modelVersion || 'fake-v1',
      };
    },
  };
}

/* provider 오류 → 내부 코드 정규화. timeout/abort → TIMEOUT, 그 외 → PROVIDER_ERROR.
   code·name·message 를 모두 합쳐 검사(name='Error' 가 message 의 'timeout' 을 가리지 않도록). */
function mapProviderError(err) {
  const msg = [err && err.code, err && err.name, err && err.message]
    .filter(Boolean).join(' ').toLowerCase();
  if (msg.indexOf('timeout') !== -1 || msg.indexOf('etimedout') !== -1 || msg.indexOf('abort') !== -1) {
    return IMAGE_AI_ERROR_CODES.TIMEOUT;
  }
  return IMAGE_AI_ERROR_CODES.PROVIDER_ERROR;
}

/* promise 를 timeoutMs 안에 settle 시키지 못하면 TIMEOUT 반환(타이머 누수 없이 정리).
   factory: () => Promise. timers 주입 가능(기본 global). */
function callWithTimeout(factory, timeoutMs, timers) {
  const t = timers || { setTimeout: setTimeout, clearTimeout: clearTimeout };
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.resolve().then(factory);
  }
  return new Promise((resolve) => {
    let done = false;
    const timer = t.setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ ok: false, code: IMAGE_AI_ERROR_CODES.TIMEOUT });
    }, timeoutMs);
    Promise.resolve()
      .then(factory)
      .then((res) => {
        if (done) return;
        done = true;
        t.clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        if (done) return;
        done = true;
        t.clearTimeout(timer);
        resolve({ ok: false, code: mapProviderError(err) });
      });
  });
}

/* adapter.generate 를 timeout+retry+cancellation 정책으로 감싸 실행.
   opts: { timeoutMs, maxAttempts(기본 2 = 1회 재시도), isCancelled(), timers }
   - 성공 즉시 반환. 재시도 가능 코드면 maxAttempts 까지 재시도.
   - 각 시도 전 isCancelled() true → CANCELLED. */
async function runAdapterWithPolicy(adapter, req, opts) {
  const o = opts || {};
  const maxAttempts = Number.isFinite(o.maxAttempts) && o.maxAttempts >= 1 ? o.maxAttempts : 2;
  const isCancelled = typeof o.isCancelled === 'function' ? o.isCancelled : function () { return false; };
  let last = { ok: false, code: IMAGE_AI_ERROR_CODES.PROVIDER_ERROR, attempts: 0 };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (isCancelled()) return { ok: false, code: IMAGE_AI_ERROR_CODES.CANCELLED, attempts: attempt - 1 };
    const res = await callWithTimeout(() => adapter.generate(req), o.timeoutMs, o.timers);
    if (res && res.ok === true) return Object.assign({}, res, { attempts: attempt });
    last = Object.assign({}, res, { attempts: attempt });
    if (!res || RETRYABLE_CODES.indexOf(res.code) === -1) break;   /* 비-재시도 코드 → 즉시 종료 */
  }
  return last;
}

module.exports = {
  IMAGE_AI_ERROR_CODES,
  RETRYABLE_CODES,
  createNotConfiguredAdapter,
  createFakeAdapter,
  mapProviderError,
  callWithTimeout,
  runAdapterWithPolicy,
  _fakePngBuffer,
};
