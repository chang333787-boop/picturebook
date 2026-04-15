/* ================================================================
   locks.js — 잠금 시스템 (협업 편집 정확성의 핵심)
   의존: state.js
   ================================================================ */

/* ensureEditable: 모든 수정 액션의 공통 진입점 (진짜 async 보장)
   - 남의 잠금이면 false (동기 체크)
   - 이미 내 세션이면 touchEdit 후 true
   - 잠금 없으면 tryLock await 후 결과 반환
   ⚠ 잠금 성공 전 절대 true 반환 없음 */
async function ensureEditable(num) {
  if (!scenes[num]) return false;
  if (isLockedByOther(num)) return false;            // 남이 잠금 → 즉시 거부
  if (activeEdits[num]) { touchEdit(num); return true; } // 내 세션 유지
  return await tryLock(num);                         // 잠금 획득 성공까지 대기
}

/* isLockedByOther: remoteLocks 기준, TTL 포함 */
function isLockedByOther(num) {
  const lock = remoteLocks[num];
  if (!lock) return false;
  if (lock.editorId === SESSION_ID) return false;
  if (Date.now() - lock.lockedAt > LOCK_TTL) return false;
  return true;
}

/* tryLock: transaction 기반 원자적 획득
   - 성공 시 Promise<true>, 실패 시 Promise<false> */
async function tryLock(num) {
  if (!lockRef) return true;
  if (activeEdits[num]) { touchEdit(num); return true; }

  return new Promise(resolve => {
    lockRef.child(num).transaction(current => {
      const now = Date.now();
      if (!current || current.editorId === SESSION_ID ||
          now - current.lockedAt > LOCK_TTL) {
        return { editorId: SESSION_ID, lockedAt: now };
      }
      return undefined; // abort
    }, (err, committed) => {
      if (err || !committed) {
        resolve(false);
      } else {
        startEditSession(num);
        resolve(true);
      }
    });
  });
}

/* 편집 세션 시작: heartbeat + idle timeout */
function startEditSession(num) {
  stopEditSession(num); // 기존 타이머 정리
  const hbTimer = setInterval(() => {
    if (lockRef) lockRef.child(num).update({ lockedAt: Date.now() });
  }, HB_INTERVAL);
  const idleTimer = setTimeout(() => releaseLock(num), IDLE_RELEASE);
  activeEdits[num] = { lastActivity: Date.now(), hbTimer, idleTimer };
}

/* 활동 감지 시 idle 타이머 리셋 */
function touchEdit(num) {
  const ed = activeEdits[num];
  if (!ed) return;
  clearTimeout(ed.idleTimer);
  ed.idleTimer = setTimeout(() => releaseLock(num), IDLE_RELEASE);
  ed.lastActivity = Date.now();
  if (lockRef) lockRef.child(num).update({ lockedAt: Date.now() });
}

/* 잠금 해제 + 세션 정리 */
function releaseLock(num) {
  stopEditSession(num);
  if (!lockRef) return;
  const lock = remoteLocks[num];
  if (lock && lock.editorId === SESSION_ID) {
    lockRef.child(num).remove();
  }
}

function stopEditSession(num) {
  const ed = activeEdits[num];
  if (!ed) return;
  clearInterval(ed.hbTimer);
  clearTimeout(ed.idleTimer);
  delete activeEdits[num];
}

/* 잠금 UI 업데이트 — 래퍼 함수
   ─────────────────────────────────────────────────────────────
   source of truth: sceneRenderer.js의 syncCardState
   이 함수는 firebase.js 등 외부에서 호출하는 진입점 역할만 하며,
   실제 DOM 조작은 syncCardState에 위임한다.
   직접 DOM을 건드리는 로직을 여기에 추가하지 말 것.
   ─────────────────────────────────────────────────────────────
   호출 경로: firebase.js → updateCardLockUI → syncCardState(sceneRenderer)
   ─────────────────────────────────────────────────────────────*/
function updateCardLockUI(num) {
  if (typeof syncCardState === 'function') syncCardState(num);
}

/* 브라우저 닫힐 때 내 잠금 정리 */
window.addEventListener('beforeunload', () => {
  Object.keys(activeEdits).forEach(num => {
    stopEditSession(Number(num));
    if (lockRef) lockRef.child(num).remove();
  });
});
