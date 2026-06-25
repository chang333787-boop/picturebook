/* ════════════════════════════════════════════════════════════════
   image-s2-policy.js — imageS2 sourceMode 잠금/초기화 "순수" 결정 로직
   ──────────────────────────────────────────────────────────────
   ⚠️ firebase / admin / functions 의존 0 — Node 단위 테스트에서 그대로 require.
   functions/index.js의 lockImageSourceMode / resetImageSourceMode callable이
   이 결정 함수를 RTDB transaction 콜백 + 권한 게이트로 감싼다.

   정책(확정 PRD §5):
   - 첫 lock: 현재 sourceMode 없음 → 요청 모드로 잠금.
   - 동일 모드: idempotent 성공(기존 lockedAt/lockedBy 보존, 미기록).
   - 반대 모드: SOURCE_MODE_CONFLICT(차단, 현재 모드 반환).
   - 교사 초기화: 작품에 원본 이미지가 하나도 없을 때만 허용.
   원자성은 RTDB transaction(CAS + 자동 재시도)이 보장 — 각 재시도마다 이 함수가
   "그 시점의 현재값"으로 다시 호출되어 늦은 반대모드 요청은 conflict로 귀결.
   ════════════════════════════════════════════════════════════════ */

const SOURCE_MODES = ['upload', 'draw'];

function isValidSourceMode(m) {
  return m === 'upload' || m === 'draw';
}

/* 저장된 imagePolicy raw → 정규화({sourceMode|null,...}). sourceMode 유효 아니면 null. */
function normalizePolicy(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!isValidSourceMode(raw.sourceMode)) return null;
  return {
    sourceMode: raw.sourceMode,
    lockedAtSceneId: (typeof raw.lockedAtSceneId === 'string' && raw.lockedAtSceneId) ? raw.lockedAtSceneId : null,
    lockedAt: (typeof raw.lockedAt === 'number') ? raw.lockedAt : null,
    lockedBy: (typeof raw.lockedBy === 'string' && raw.lockedBy) ? raw.lockedBy : null,
  };
}

/* ★ transaction 결정. currentRaw = RTDB가 넘긴 현재 imagePolicy(raw|null).
   req = { sourceMode, sceneId, uid, now }.  (sourceMode 유효성은 호출 전 검증.)
   반환:
     { action:'lock', policy }       — 현재 미설정 → 새 정책 기록(콜백이 policy 반환)
     { action:'idempotent', policy }  — 동일 모드 → 기록 안 함(현재값 유지)
     { action:'conflict', currentSourceMode } — 반대 모드 → abort + 차단 */
function decideSourceModeLock(currentRaw, req) {
  const cur = normalizePolicy(currentRaw);
  const mode = req && req.sourceMode;
  if (!cur) {
    return {
      action: 'lock',
      policy: {
        sourceMode: mode,
        lockedAtSceneId: (req && req.sceneId != null) ? String(req.sceneId) : null,
        lockedAt: (req && typeof req.now === 'number') ? req.now : null,
        lockedBy: (req && typeof req.uid === 'string') ? req.uid : null,
      },
    };
  }
  if (cur.sourceMode === mode) {
    return { action: 'idempotent', policy: cur };   /* 기존 lock 메타 보존 */
  }
  return { action: 'conflict', currentSourceMode: cur.sourceMode };
}

/* scenes 트리에 "원본 이미지"가 하나라도 있는가. (imageData/imageUrl 비어있지 않으면 있음) */
function scenesHaveOriginalImage(scenes) {
  if (!scenes || typeof scenes !== 'object') return false;
  return Object.keys(scenes).some(function (k) {
    const s = scenes[k];
    if (!s || typeof s !== 'object') return false;
    return (typeof s.imageData === 'string' && s.imageData) ||
           (typeof s.imageUrl === 'string' && s.imageUrl);
  });
}

/* 교사 초기화 가부. 원본 이미지가 남아 있으면 SOURCE_IMAGES_REMAIN. */
function decideSourceModeReset(scenes) {
  if (scenesHaveOriginalImage(scenes)) {
    return { ok: false, code: 'SOURCE_IMAGES_REMAIN' };
  }
  return { ok: true };
}

module.exports = {
  SOURCE_MODES,
  isValidSourceMode,
  normalizePolicy,
  decideSourceModeLock,
  scenesHaveOriginalImage,
  decideSourceModeReset,
};
