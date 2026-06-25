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
   S2-2A-FIX1: gate-first orchestration (저장 *전* 게이트 → 업로드 → lock → 성공 시에만 scene 기록).
   B안의 "저장 후 rollback"을 폐기 → 패자는 scene.imageData를 애초에 쓰지 않으므로 승자 유실/CAS
   경쟁이 구조적으로 불가능. (C1/C2/H1 제거)
   ════════════════════════════════════════════════════════════════ */

/* 저장 *전* 게이트 결정(순수). 현재 정책 raw + 요청 모드 → 업로드 진행 가부.
   - absent → allow(첫 저장, 이후 서버 lock이 최종 결정)
   - valid & 같은 모드 → allow(서버 lock idempotent 확인)
   - valid & 반대 모드 → block SOURCE_MODE_CONFLICT (업로드 전 차단)
   - corrupt → block CORRUPT_IMAGE_POLICY
   ⚠️ 사전 게이트는 최종 결정자 아님(TOCTOU) — allow여도 업로드 후 서버 lock transaction 필수. */
function decidePreGate(policyRaw, mode) {
  const cls = classifyPolicy(policyRaw);
  if (cls === 'corrupt') return { allow: false, code: 'CORRUPT_IMAGE_POLICY' };
  if (cls === 'absent') return { allow: true };
  const cur = normalizePolicy(policyRaw);
  if (cur.sourceMode === mode) return { allow: true, currentSourceMode: cur.sourceMode };
  return { allow: false, code: 'SOURCE_MODE_CONFLICT', currentSourceMode: cur.sourceMode };
}

/* 업로드된 고유 객체에 대해 lock 확정(순수, adapter 주입). scene.imageData 기록은 호출부가
   ok일 때만 수행 → 패자는 scene을 안 씀. 실패/충돌/corrupt 시 *이번 고유 객체만* 삭제.
   input = { mode, sceneId, storagePath }.  adapters = { lock(mode,sceneId), deleteStorage(path)->bool, recordOrphan(info) }.
   반환: { ok, sourceMode?, idempotent? } | { ok:false, code, currentSourceMode?, retryable?, storageDeleted? } */
async function runImageSourceCommit(input, adapters) {
  const { mode, sceneId, storagePath } = input || {};
  let lockRes;
  try {
    lockRes = await adapters.lock(mode, sceneId);
  } catch (e) {
    /* lock 호출 실패: scene 미기록 상태 → 방금 만든 고유 객체 정리, 재시도 안내. 기존 원본 무손상. */
    const del = await _safeDelete(adapters, storagePath, sceneId, 'lock-call-failed');
    return { ok: false, code: 'LOCK_CALL_FAILED', retryable: true, storageDeleted: del };
  }
  if (lockRes && lockRes.ok) {
    return { ok: true, sourceMode: mode, idempotent: !!lockRes.idempotent };
  }
  /* 실패(conflict/corrupt/권한 등): scene 미기록(승자/기존 무손상) → 이번 고유 객체만 삭제. */
  const del = await _safeDelete(adapters, storagePath, sceneId, lockRes && lockRes.code);
  return {
    ok: false,
    code: (lockRes && lockRes.code) || 'LOCK_FAILED',
    currentSourceMode: lockRes && lockRes.currentSourceMode,
    storageDeleted: del,
  };
}
async function _safeDelete(adapters, path, sceneId, reason) {
  if (!path) return true;
  let deleted = false;
  try { deleted = !!(await adapters.deleteStorage(path)); }
  catch (e) { deleted = false; }
  if (!deleted && typeof adapters.recordOrphan === 'function') {
    try { await adapters.recordOrphan({ sceneId: sceneId || null, storagePath: path, reason: 'storage-delete-failed', cause: reason || null }); }
    catch (e) { /* 기록 실패해도 진행 */ }
  }
  return deleted;
}

/* 신규 원본 Storage 객체 경로(고유). uniqueId는 호출부가 주입(crypto.randomUUID 등) → 순수·테스트 가능.
   기존 deterministic `images/{cid}/{enc}/scene_{N}.{ext}`와 달리 매 저장마다 새 객체 → overwrite 0.
   세그먼트는 안전화(.#$[]/제어문자/.. 제거). ext는 호출부에서 MIME allowlist로 결정해 전달. */
function buildImageStoragePath(classId, enc, sceneId, ext, uniqueId) {
  const seg = (v, def) => {
    const s = String(v == null ? '' : v).replace(/[.#$\[\]\/\x00-\x1F\x7F]/g, '').replace(/\.\./g, '');
    return s || def;
  };
  const cid = seg(classId, '_legacy');
  const team = seg(enc, 'unknown');
  const sid = seg(sceneId, 'scene');
  const uid = seg(uniqueId, '0');
  const e = /^(jpg|jpeg|png|webp)$/.test(String(ext)) ? String(ext) : 'jpg';
  return `images/${cid}/${team}/${sid}/${uid}.${e}`;
}

/* 삭제 허용 경로인지(prefix 검증). 우리 이미지 버킷 prefix `images/`로 시작 + traversal 없음만 허용. */
function isAllowedImageStoragePath(path) {
  if (typeof path !== 'string' || !path) return false;
  if (path.indexOf('..') !== -1) return false;
  return /^images\//.test(path);
}

/* S2-2A-FIX2: lock 성공 후 scene flush 실패 시 "로컬 복원/pending 정리" 결정(순수).
   - restoreLocal: 현재 scene.imageData가 *이번 시도 url*일 때만 복원(다른 비동기 변경이면 보존).
   - restoreTo: 복원 대상(before, 없으면 null). 복원 안 하면 현재값 유지.
   - clearPendingImage: 재큐된 pending imageData가 이번 url이면 제거(잘못 재실행 방지).
   ⚠️ 로컬 상태 정리만. 서버 rollback transaction 재도입 아님. lock은 유지(동일 mode 재시도). */
function decideFlushFailureRecovery(opts) {
  const o = opts || {};
  const restoreLocal = (o.sceneImageData === o.attemptUrl);
  return {
    restoreLocal: restoreLocal,
    restoreTo: restoreLocal ? ((o.beforeImageData != null) ? o.beforeImageData : null) : o.sceneImageData,
    clearPendingImage: (o.pendingImageData === o.attemptUrl),
  };
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
  decidePreGate,
  runImageSourceCommit,
  buildImageStoragePath,
  isAllowedImageStoragePath,
  decideFlushFailureRecovery,
  scenesHaveOriginalImage,
  decideSourceModeReset,
};
