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

/* 저장된 imagePolicy 분류:
   - 'absent'  : null/undefined, 또는 객체지만 sourceMode 필드 자체가 없음(미설정) → lock 허용.
   - 'valid'   : sourceMode가 upload|draw.
   - 'corrupt' : 객체에 sourceMode가 있으나 비정상 값(예: 'paint'), 또는 객체 아님 → 자동 덮어쓰기 금지.
   (S2-2A §8: 비정상 객체는 자동 복구하지 않고 CORRUPT_IMAGE_POLICY로 교사 개입 요구.) */
function classifyPolicy(raw) {
  if (raw === null || raw === undefined) return 'absent';
  if (typeof raw !== 'object') return 'corrupt';
  if (raw.sourceMode === undefined || raw.sourceMode === null) return 'absent';
  if (isValidSourceMode(raw.sourceMode)) return 'valid';
  return 'corrupt';
}

/* ★ transaction 결정. currentRaw = RTDB가 넘긴 현재 imagePolicy(raw|null).
   req = { sourceMode, sceneId, uid, now }.  (sourceMode 유효성은 호출 전 검증.)
   반환:
     { action:'lock', policy }                  — 미설정 → 새 정책 기록(콜백이 policy 반환)
     { action:'idempotent', policy }            — 동일 모드 → 기록 안 함(현재값 유지)
     { action:'conflict', currentSourceMode }   — 반대 모드 → abort + 차단
     { action:'corrupt', code }                 — 비정상 저장값 → abort + CORRUPT_IMAGE_POLICY(자동복구 X) */
function decideSourceModeLock(currentRaw, req) {
  const cls = classifyPolicy(currentRaw);
  const mode = req && req.sourceMode;
  if (cls === 'corrupt') {
    return { action: 'corrupt', code: 'CORRUPT_IMAGE_POLICY' };
  }
  if (cls === 'absent') {
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
  const cur = normalizePolicy(currentRaw);
  if (cur.sourceMode === mode) {
    return { action: 'idempotent', policy: cur };   /* 기존 lock 메타 보존 */
  }
  return { action: 'conflict', currentSourceMode: cur.sourceMode };
}

/* ════════════════════════════════════════════════════════════════
   B안 orchestration (저장 성공 후 lock + 패배 rollback) — adapter 주입형(순수 시퀀스).
   ──────────────────────────────────────────────────────────────
   호출부(클라 viewer-edit / 테스트 하니스)는 실제 SDK/emulator 어댑터를 주입한다.
   input = { mode, sceneId, before:{imageData}, after:{imageData, storagePath} }
   adapters = {
     lock(mode, sceneId) -> {ok, idempotent?} | {ok:false, code, currentSourceMode?}
     restoreSceneImageCas(sceneId, expected, restoreTo) -> bool  (현재값===expected일 때만 복원, 복원여부 반환)
     deleteStorage(path) -> bool
     recordOrphan(info) -> void
   }
   반환: { ok, sourceMode?, idempotent?, code?, currentSourceMode?, rolledBack?, restored?, storageDeleted?, kept? }
   안전 원칙:
   - lock 호출 자체 실패/네트워크 오류 → 원본 유지(kept), rollback 안 함(사용자 작업 보호).
   - conflict일 때만 rollback. restore는 CAS(현재값===after)라 타인의 이후 저장은 덮지 않음.
   - 삭제는 이번에 만든 storagePath만. 실패 시 LOCK_ROLLBACK_FAILED + orphan 기록. */
async function runSourceModeLockedSave(input, adapters) {
  const { mode, sceneId, before, after } = input || {};
  let lockRes;
  try {
    lockRes = await adapters.lock(mode, sceneId);
  } catch (e) {
    return { ok: false, code: 'LOCK_CALL_FAILED', kept: true };   /* 원본 유지 */
  }
  if (lockRes && lockRes.ok) {
    return { ok: true, sourceMode: mode, idempotent: !!lockRes.idempotent };
  }
  if (lockRes && lockRes.code === 'CORRUPT_IMAGE_POLICY') {
    return { ok: false, code: 'CORRUPT_IMAGE_POLICY', kept: true };  /* 원본 유지 — 교사 개입 */
  }
  if (lockRes && lockRes.code === 'SOURCE_MODE_CONFLICT') {
    let restored = false, restoreThrew = false;
    try {
      restored = await adapters.restoreSceneImageCas(sceneId, after && after.imageData, before && before.imageData);
    } catch (e) { restoreThrew = true; }
    let storageDeleted = true;
    const path = after && after.storagePath;
    if (path) {
      try { storageDeleted = !!(await adapters.deleteStorage(path)); }
      catch (e) { storageDeleted = false; }
    }
    if (restoreThrew || (path && !storageDeleted)) {
      try {
        await adapters.recordOrphan({
          sceneId, storagePath: path || null, restored,
          reason: restoreThrew ? 'scene-restore-failed' : 'storage-delete-failed',
        });
      } catch (e) { /* 기록 실패해도 진행 */ }
      return { ok: false, code: 'LOCK_ROLLBACK_FAILED', currentSourceMode: lockRes.currentSourceMode, restored, storageDeleted };
    }
    return { ok: false, code: 'SOURCE_MODE_CONFLICT', currentSourceMode: lockRes.currentSourceMode, rolledBack: true, restored, storageDeleted };
  }
  /* 기타 코드(권한 등) → 원본 유지(rollback 안 함). */
  return { ok: false, code: (lockRes && lockRes.code) || 'LOCK_FAILED', kept: true };
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
  classifyPolicy,
  decideSourceModeLock,
  runSourceModeLockedSave,
  scenesHaveOriginalImage,
  decideSourceModeReset,
};
