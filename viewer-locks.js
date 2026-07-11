/* ================================================================
   viewer-locks.js — viewer 전용 경량 잠금 클라이언트
   ─────────────────────────────────────────────────────────────
   · maker(locks.js)와 같은 Firebase 경로 `$basePath/locks/$num`을 공유
     → maker와 viewer-edit가 상호 배제됨
   · 스키마 확장 (배너 오탐 수정):
       { editorId: deviceId,      // 브라우저/기기 단위 localStorage 공유
         instanceId: tabRandomId, // 같은 브라우저 안에서도 탭 구분
         lockedAt: timestamp }
     · editorId가 같으면 같은 기기 → 본인(같은 기기 다른 창) 또는 같은 탭
     · editorId가 다르면 진짜 다른 사용자
   · maker(state.js)의 SESSION_ID도 같은 localStorage 키를 읽도록 수정됨
     → 같은 브라우저의 maker 탭/viewer 탭이 서로 본인임을 인식
   · 잡음 필드(instanceId 없음)가 들어와도 editorId만으로 분류 가능

   의존: getViewerDb() (viewer-data.js)
   ================================================================ */

const V_LOCK_TTL          = 20000;  // 20초 TTL — maker와 동일
const V_HB_INTERVAL       = 5000;   // 5초 heartbeat
const V_IDLE_RELEASE      = 12000;  // 12초 idle 후 자동 해제
/* 같은 deviceId의 다른 instanceId가 이 시간보다 오래되면 이전 세션 잔재로 간주.
   탭이 pagehide/beforeunload에서 잠금 해제 실패했을 때(Firebase remove가
   network flush 전에 탭이 죽는 경우) 재진입 시 자기 자신을 '다른 창'으로
   오판하는 버그 해결의 핵심 상수. heartbeat 5초 + 여유 2초. */
const V_STALE_SAMEDEVICE  = 7000;

/* ── deviceId: 같은 브라우저/기기 단위 (localStorage 공유, maker와 동일 키) ── */
const V_DEVICE_ID = (() => {
  try {
    let id = localStorage.getItem('branch_device_id');
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      localStorage.setItem('branch_device_id', id);
    }
    return id;
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
})();
/* ── instanceId: 같은 deviceId 안에서도 탭 구분 (viewer 탭 전용) ── */
const V_INSTANCE_ID = Math.random().toString(36).slice(2, 10);

let viewerLockRef     = null;  // Firebase ref — `$basePath/locks`
let viewerRemoteLocks = {};    // { num: { editorId, instanceId?, lockedAt } }
let viewerActiveEdits = {};    // { num: { hbTimer, idleTimer } } — 내 세션
let onViewerLockChange = null; // UI 갱신 콜백 (viewer-edit이 등록)

/* ── 초기화: basePath = teams/$name 또는 classes/$cid/teams/$name ── */
function initViewerLocks(basePath) {
  if (viewerLockRef) return; // 중복 초기화 방지
  const db = getViewerDb();
  viewerLockRef = db.ref(`${basePath}/locks`);
  viewerLockRef.on('value', snap => {
    viewerRemoteLocks = snap.val() || {};
    if (typeof onViewerLockChange === 'function') onViewerLockChange();
  });
  /* 탭 종료 시 내 잠금 정리 */
  window.addEventListener('beforeunload', () => {
    Object.keys(viewerActiveEdits).forEach(n => {
      stopViewerEditSession(Number(n));
      if (viewerLockRef) viewerLockRef.child(n).remove();
    });
  });
  /* pagehide (모바일 Safari 포함) — beforeunload가 안 뜨는 환경 대비 */
  window.addEventListener('pagehide', () => {
    Object.keys(viewerActiveEdits).forEach(n => {
      stopViewerEditSession(Number(n));
      if (viewerLockRef) viewerLockRef.child(n).remove();
    });
  });
}

/* ── 콜백 등록 — 원격 잠금 변경 시 viewer-edit의 UI 상태 갱신용 ── */
function setViewerLockChangeHandler(fn) { onViewerLockChange = fn; }

/* ================================================================
   잠금 소유자 분류 (배너 오탐 수정의 핵심) ──
   반환값:
     · null         : 잠금 없음/만료(TTL 초과) — stale 포함
     · 'self-tab'   : 내 탭 자체가 잠금 보유 — 편집 허용, 배너 없음
     · 'same-device': 같은 브라우저의 다른 탭/앱 — 약한 경고 ('다른 창에서…')
     · 'other'      : 진짜 다른 사용자/기기 — 강한 경고 ('다른 사람이…')
   ─────────────────────────────────────────────────────────────
   stale lock: TTL 초과된 남의 잠금은 'null' 반환 (무시). 진짜 점유가
   아니므로 배너를 띄우지 않고, 내가 tryLock 시도 시 transaction이 덮어씀.
   ================================================================ */
function classifyLockOwner(num) {
  const lock = viewerRemoteLocks[num];
  if (!lock) return null;
  const now = Date.now();
  /* TTL 초과 → stale — 진짜 점유 아님 */
  if (now - lock.lockedAt > V_LOCK_TTL) return null;
  /* CLOCK-SKEW-GUARD(2026-07-11 실사고): 시계 빠른 기기의 미래 lockedAt은 TTL 검사가
     영원히 안 풀림 → 미래 1분 이상 = 고장값, 점유 아님 */
  if (lock.lockedAt - now > 60000) return null;
  if (lock.editorId !== V_DEVICE_ID) return 'other';
  /* 같은 deviceId */
  if (lock.instanceId && lock.instanceId === V_INSTANCE_ID) return 'self-tab';
  /* 같은 deviceId + 다른 instanceId ──
     heartbeat 간격(5s)+여유 2s = 7s 넘으면 이전 탭이 이미 죽은 것으로 간주.
     pagehide에서 remove 실패한 '내 이전 세션'이 가장 흔한 케이스. */
  if (now - lock.lockedAt > V_STALE_SAMEDEVICE) return null;
  return 'same-device';
}

/* ── 남이 잠갔는지 (기존 이름 유지, 분류 결과에 기반) ──
   'other' + 'same-device' 모두 남의 잠금으로 간주 (편집 불가는 동일,
   배너 문구만 viewer-edit에서 분류 결과로 결정). */
function isViewerLockedByOther(num) {
  const kind = classifyLockOwner(num);
  return kind === 'other' || kind === 'same-device';
}

/* ── 편집 가능 보장 (진짜 async) — maker의 ensureEditable과 동일 규약 ──
   정책 마감 (1-1): same-device(같은 기기 다른 탭)일 때 자동 획득은 하지 않음.
   배너 문구 "다른 창에서 편집 중"과 실제 동작(읽기 전용)을 일치시키기 위해.
   명시적 인수가 필요할 때는 viewerTakeoverLock(num)을 사용자 동작으로 호출. */
async function viewerEnsureEditable(num) {
  if (!viewerLockRef) return true; // 잠금 초기화 전엔 단독 실행으로 간주 — 차단 안 함
  /* 같은 탭 자체가 이미 보유 → heartbeat 갱신하고 허용 */
  if (viewerActiveEdits[num]) { viewerTouchEdit(num); return true; }
  /* 남이 점유 중(same-device, other 모두) → 자동 획득 금지 */
  if (isViewerLockedByOther(num)) return false;
  /* 잠금 없음 또는 stale → 정상 획득 시도 */
  return await viewerTryLock(num);
}

/* ── transaction 기반 원자적 획득 ── */
function viewerTryLock(num) {
  return new Promise(resolve => {
    viewerLockRef.child(num).transaction(current => {
      const now = Date.now();
      /* 내 탭이 이미 보유 */
      const isMine = current && current.editorId === V_DEVICE_ID &&
                     current.instanceId === V_INSTANCE_ID;
      /* TTL 초과 stale — 누구 것이든 덮어씀 (+ 미래 잠금 = 고장 시계, CLOCK-SKEW-GUARD) */
      const stale  = current && (now - current.lockedAt > V_LOCK_TTL
                                 || current.lockedAt - now > 60000);
      /* same-device stale — 같은 기기 이전 탭 잔재. heartbeat 여유 지난 후 자동 회수. */
      const sameDeviceStale = current &&
        current.editorId === V_DEVICE_ID &&
        current.instanceId !== V_INSTANCE_ID &&
        (now - current.lockedAt > V_STALE_SAMEDEVICE);
      if (!current || isMine || stale || sameDeviceStale) {
        return {
          editorId:   V_DEVICE_ID,
          instanceId: V_INSTANCE_ID,
          lockedAt:   now,
        };
      }
      /* same-device(최근 heartbeat) or other(다른 사람) — abort.
         same-device는 viewerTakeoverLock을 명시적으로 호출해야 인수됨. */
      return undefined;
    }, (err, committed) => {
      if (err || !committed) resolve(false);
      else { startViewerEditSession(num); resolve(true); }
    });
  });
}

/* ── 명시적 인수: 같은 기기 다른 탭/창이 잡은 잠금을 이 탭으로 가져오기 ──
   policy: other(진짜 다른 사용자)는 인수 불가 — false 반환.
   같은 deviceId인 경우에만 transaction으로 인수 성공. */
function viewerTakeoverLock(num) {
  return new Promise(resolve => {
    if (!viewerLockRef) { resolve(false); return; }
    viewerLockRef.child(num).transaction(current => {
      const now = Date.now();
      /* 진짜 남의 것은 인수 거부 */
      if (current && current.editorId !== V_DEVICE_ID &&
          now - current.lockedAt <= V_LOCK_TTL) {
        return undefined;
      }
      return {
        editorId:   V_DEVICE_ID,
        instanceId: V_INSTANCE_ID,
        lockedAt:   now,
      };
    }, (err, committed) => {
      if (err || !committed) resolve(false);
      else { startViewerEditSession(num); resolve(true); }
    });
  });
}

/* ── v116~v117: 강제 인수 — "내가 수정하기" 누를 때만 호출 ──
   policy: viewerTakeoverLock은 same-device만 허용 (정상). v116엔 'other'
   분류(진짜 다른 사용자)도 사용자가 명시 confirm 한 후 인수할 수 있게 허용.
   호출자(viewer-edit)가 호출 전 사용자에게 "다른 친구가 수정하는 중일 수 있어요"
   안내 표시 후 호출.

   v117 강화 (학생들 "잠금 가져오기 실패" 발생 사건 fix):
   1. transaction 실행 전 anonymous auth 보장 — auth 없으면 Storage/RTDB write 거부
   2. transaction 실패한 경우 .set으로 직접 덮어쓰기 (한 번만) — 사용자가
      confirm 한 후라 race condition 위험 감수. transaction이 실패하는 흔한
      원인 = concurrent write/retry 한도/네트워크 timeout
   3. 모든 단계 console.warn 상세 로그 — 다음 진단에 활용할 수 있게 */
async function viewerForceTakeoverLock(num) {
  const ctx = {
    num,
    lockPath: viewerLockRef ? viewerLockRef.toString() + '/' + num : null,
    currentLock: viewerRemoteLocks ? viewerRemoteLocks[num] : null,
    deviceId: V_DEVICE_ID,
    instanceId: V_INSTANCE_ID,
  };

  if (!viewerLockRef) {
    console.warn('[viewerForceTakeoverLock] viewerLockRef 박혀있지 X', ctx);
    return false;
  }

  /* 1단계: auth 보장 — POLISH-AUTH-FIX: 편집 세션은 default app(maker UID), 그 외엔 named 'viewer'.
     편집 세션에선 새 익명 로그인 금지(복원된 maker UID 사용). */
  try {
    if (typeof firebase !== 'undefined' && typeof firebase.app === 'function') {
      const viewerApp = (typeof getViewerApp === 'function') ? getViewerApp() : firebase.app('viewer');
      if (viewerApp && typeof viewerApp.auth === 'function') {
        const auth = viewerApp.auth();
        if (!auth.currentUser && !(typeof isEditViewerSession === 'function' && isEditViewerSession())) {
          await auth.signInAnonymously();
        }
        ctx.authUid = auth.currentUser ? auth.currentUser.uid : null;
      }
    }
  } catch (e) {
    console.warn('[viewerForceTakeoverLock] auth 박지 못함', ctx, e);
    /* auth 확보하지 못해도 일단 진행 — Firebase rules가 막으면 transaction에서 reject */
  }

  const lockValue = {
    editorId:   V_DEVICE_ID,
    instanceId: V_INSTANCE_ID,
    lockedAt:   Date.now(),
  };

  /* 2단계: transaction 실행 */
  const txOk = await new Promise(resolve => {
    let committed = false;
    let txError = null;
    viewerLockRef.child(num).transaction(
      () => lockValue,
      (err, c) => {
        committed = !!c;
        txError = err;
        if (err) console.warn('[viewerForceTakeoverLock] transaction err', ctx, err);
        if (!committed && !err) console.warn('[viewerForceTakeoverLock] transaction not committed', ctx);
        resolve(!err && committed);
      }
    );
  });

  if (txOk) {
    startViewerEditSession(num);
    return true;
  }

  /* 3단계: transaction 실패 → .set으로 직접 덮어쓰기 (한 번만, fallback) */
  console.warn('[viewerForceTakeoverLock] transaction 박지 X → .set fallback 시도', ctx);
  try {
    await viewerLockRef.child(num).set(lockValue);
    startViewerEditSession(num);
    console.warn('[viewerForceTakeoverLock] .set fallback 성공', ctx);
    return true;
  } catch (e) {
    console.warn('[viewerForceTakeoverLock] .set fallback도 박지 X', ctx, e);
    return false;
  }
}

/* ── 편집 세션 시작: heartbeat + idle 타이머 ── */
function startViewerEditSession(num) {
  stopViewerEditSession(num);
  const hbTimer = setInterval(() => {
    if (viewerLockRef) viewerLockRef.child(num).update({
      editorId:   V_DEVICE_ID,
      instanceId: V_INSTANCE_ID,
      lockedAt:   Date.now(),
    });
  }, V_HB_INTERVAL);
  const idleTimer = setTimeout(() => viewerReleaseLock(num), V_IDLE_RELEASE);
  viewerActiveEdits[num] = { hbTimer, idleTimer };
}

/* ── 활동 시 idle 타이머 리셋 + heartbeat 갱신 ── */
function viewerTouchEdit(num) {
  const ed = viewerActiveEdits[num];
  if (!ed) return;
  clearTimeout(ed.idleTimer);
  ed.idleTimer = setTimeout(() => viewerReleaseLock(num), V_IDLE_RELEASE);
  if (viewerLockRef) viewerLockRef.child(num).update({
    editorId:   V_DEVICE_ID,
    instanceId: V_INSTANCE_ID,
    lockedAt:   Date.now(),
  });
}

/* ── 잠금 해제 + 세션 정리 ── */
function viewerReleaseLock(num) {
  stopViewerEditSession(num);
  if (!viewerLockRef) return;
  const lock = viewerRemoteLocks[num];
  /* 내 탭 자체가 보유한 경우만 해제 (같은 deviceId의 다른 탭 건 건드리지 X) */
  if (lock && lock.editorId === V_DEVICE_ID &&
      (!lock.instanceId || lock.instanceId === V_INSTANCE_ID)) {
    viewerLockRef.child(num).remove();
  }
}

function stopViewerEditSession(num) {
  const ed = viewerActiveEdits[num];
  if (!ed) return;
  clearInterval(ed.hbTimer);
  clearTimeout(ed.idleTimer);
  delete viewerActiveEdits[num];
}

/* ── 내가 이 장면을 이미 잠근 상태인가 ── */
function viewerIsMyLock(num) {
  return !!viewerActiveEdits[num];
}

