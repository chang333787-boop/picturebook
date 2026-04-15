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

/* ── 잠금 시스템 ── */
const SESSION_ID   = Math.random().toString(36).slice(2, 10);
const LOCK_TTL     = 20000;  // 20초 TTL
const HB_INTERVAL  = 5000;   // 5초 heartbeat
const IDLE_RELEASE = 12000;  // 12초 idle 후 잠금 해제
let   lockRef      = null;
let   remoteLocks  = {};     // { sceneNum: {editorId, lockedAt} }
let   activeEdits  = {};     // { sceneNum: {lastActivity, hbTimer, idleTimer} }
