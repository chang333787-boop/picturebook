/* ================================================================
   state.js — 전역 상태 변수
   다른 모든 파일이 이 변수들을 공유함
   ================================================================ */

/* ── 장면 데이터 ── */
let scenes   = {};   // { num: {num, title, type, x, y, choiceA, choiceB, ...} }
let teamName = '';
let classId  = null; // v2 경로용 — DATA_PATH_VERSION='v2'일 때만 설정, v1에서는 null 유지
let dbRef    = null;
let isRemote = false;
let nextNum  = 1;

/* ── 프로젝트 메타 (viewer-meta 경로와 매칭) ──
   구조 개편 1차에서 viewer 쪽이 쓰고 있는 cover/entry/replay 필드의
   maker 쪽 로컬 캐시. 프로젝트 설정 UI에서 읽고 쓰는 원본.
   ─────────────────────────────────────────────────────────────
   null인 항목은 아직 명시 저장되지 않음 → projectSettings.js가
   start scene에서 기본값을 계산해 UI 초기값으로 사용. */
let projectMeta = {
  coverTitle:     null,
  coverImageData: null,
  entrySceneId:   null,
  replaySceneId:  null,
};

/* ── 인터랙션 상태 ── */
let dragState = null;   // 카드 드래그 상태
let connState = null;   // 연결선 드래그 상태

/* ── Firebase 저장 ── */
let pushTimer = null;

/* ── 캔버스 뷰 ── */
let zoom       = 1;    // 줌 레벨 (0.3 ~ 2.0)
let canvasOffX = 0;
let canvasOffY = 0;
let panState   = null; // { lastX, lastY }
let pinchState = null; // { dist, zoom, offX, offY, midX, midY }

/* ── 잠금 시스템 ──
   SESSION_ID ──
   버그 수정(배너 오탐): Math.random만 쓰면 같은 사용자가 새로 고침하거나
   maker↔viewer-edit을 오가기만 해도 매번 다른 ID가 생겨 본인 자신을
   '다른 사람'으로 오탐했음. 이제 브라우저/기기 단위로 localStorage에
   deviceId를 저장해 maker와 viewer-locks가 동일 식별자를 공유.
   localStorage 불가 환경(시크릿 등)에서는 런타임 랜덤으로 fallback. */
const SESSION_ID = (() => {
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
const LOCK_TTL     = 20000;  // 20초 TTL
const HB_INTERVAL  = 5000;   // 5초 heartbeat
const IDLE_RELEASE = 12000;  // 12초 idle 후 잠금 해제
let   lockRef      = null;
let   remoteLocks  = {};     // { sceneNum: {editorId, lockedAt} }
let   activeEdits  = {};     // { sceneNum: {lastActivity, hbTimer, idleTimer} }

/* ================================================================
   getSceneText — 하위호환 title/body 해석 (maker 공용)
   ─────────────────────────────────────────────────────────────
   · body 필드 있음: { title: scene.title, body: scene.body }
   · body 없고 title만: { title: '', body: scene.title }
     → 기존 작품은 'title 하나에 다 쓴 장면 글'이었으므로 본문 취급
   · 둘 다 없음: { title: '', body: '' }
   · 새로 '제목만' 쓴 장면과 기존 'title 하나만' 장면을 구분 못 하므로,
     제목만 쓰려면 body = '' 빈 문자열을 명시 저장(새 장면 기본값).
   · 읽기 전용 헬퍼 — scene 객체를 변형하지 않음.
   ================================================================ */
function getSceneText(scene) {
  if (!scene) return { title: '', body: '' };
  /* body 필드 존재 여부 (빈 문자열도 '있음'으로 간주) */
  const hasBody = Object.prototype.hasOwnProperty.call(scene, 'body') &&
                  scene.body !== null && scene.body !== undefined;
  if (hasBody) {
    return { title: scene.title || '', body: scene.body || '' };
  }
  /* fallback — 기존 작품: title을 본문처럼 */
  return { title: '', body: scene.title || '' };
}
