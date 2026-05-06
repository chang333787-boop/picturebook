/* ================================================================
   firebase.js — Firebase 초기화 / 입장 / 저장 / 실시간 동기화
   의존: state.js, locks.js
   런타임 호출: renderAll() → sceneRenderer.js
   ─────────────────────────────────────────────────────────────────
   잠금 UI 흐름:
     firebase.js → updateCardLockUI(num) [locks.js 래퍼]
                 → syncCardState(num)    [sceneRenderer.js — 실제 DOM 처리]
   source of truth: sceneRenderer.js의 syncCardState
   ─────────────────────────────────────────────────────────────────
   인증 구조 (Step 1 — Auth 초기화):
     auth           Firebase Auth 인스턴스
     getCurrentUser()  현재 로그인 사용자 (없으면 null)
     isTeacher()       Custom Claim role === 'teacher' 여부
     isSuperAdmin()    Custom Claim role === 'super_admin' 여부
     onAuthStateChanged → authState.user / authState.role 갱신

   학생 흐름(joinTeam)과 교사 Auth 흐름은 완전히 독립.
   학생은 Firebase Auth 없이 팀명+PIN으로만 입장.
   ─────────────────────────────────────────────────────────────────
   경로 전략 (Step 3 — DATA_PATH_VERSION):
     'v1' : 기존 구조  — teams/$encodedName
     'v2' : 클래스 구조 — classes/$classId/teams/$encodedName
     기본값 'v1' — 플래그 변경 전까지 기존 동작 100% 유지
     롤백: 'v2'→'v1' 변경만으로 즉시 복구
   ================================================================ */

const firebaseConfig = {
  apiKey:            'AIzaSyBK12nBkj6Pdwu-zpL3w0krU1PzS78McmE',
  authDomain:        'picturebook-8731f.firebaseapp.com',
  databaseURL:       'https://picturebook-8731f-default-rtdb.firebaseio.com',
  projectId:         'picturebook-8731f',
  storageBucket:     'picturebook-8731f.firebasestorage.app',
  messagingSenderId: '590974087190',
  appId:             '1:590974087190:web:a9e9ba15adf020ff470537'
};
firebase.initializeApp(firebaseConfig);
const db   = firebase.database();
const auth = firebase.auth();

/* ================================================================
   Step 3: 경로 전략 feature flag
   ================================================================ */

/**
 * DATA_PATH_VERSION
 * 'v1' → teams/$encodedName          (현재 기본, 기존 동작 유지)
 * 'v2' → classes/$classId/teams/$encodedName  (클래스 구조)
 *
 * ⚠️ 'v2'로 전환 전 반드시:
 *   1. classes/ 경로에 테스트 데이터 검증 완료
 *   2. Firebase Rules v2 적용 완료
 *   3. 기존 teams/ 데이터 마이그레이션 또는 학기 초 초기화
 */
const DATA_PATH_VERSION = 'v2';

/**
 * 팀 Firebase 경로 헬퍼
 * @param {string} encodedName  encodeURIComponent 처리된 팀명
 * @param {string|null} classId v2에서 필요한 classId
 * @returns {string} Firebase 경로 문자열
 */
function getTeamPath(encodedName, classId = null) {
  if (DATA_PATH_VERSION === 'v2' && classId) {
    return `classes/${classId}/teams/${encodedName}`;
  }
  return `teams/${encodedName}`;
}

/**
 * 클래스 코드로 classId 조회 (v2 전용)
 * Firebase에서 classes/$id/meta/code === inputCode 인 항목을 찾음
 * @param {string} code 학생이 입력한 클래스 코드
 * @returns {Promise<string|null>} classId 또는 null
 */
/* ================================================================
   Step 3 + 5: 클래스 코드 → classId lookup
   ─────────────────────────────────────────────────────────────────
   【이전 구조】
     classes/ 루트 전체를 orderByChild('meta/code')로 스캔
     → Firebase .indexOn 없으면 경고, 클래스 수 증가 시 성능 저하
     → Rules에서 classes/.read: true 필요 (너무 넓음)

   【새 구조】
     classCodes/$code = $classId  (전용 인덱스 노드)
     → classCodes/$code 단일 경로만 읽음
     → Rules에서 classCodes/.read: true 만으로 충분
     → classes/ 루트 전체 접근 불필요

   인덱스 없음(null):
     classes/ fallback 없이 명확히 실패 처리.
     인덱스는 Firebase Console 또는 교사 클래스 생성 시
     동시에 classCodes/$code 노드를 써야 유효.
   ================================================================ */
async function _lookupClassId(code) {
  const snap = await db.ref(`classCodes/${code}`).once('value');
  if (!snap.exists()) return null;
  return snap.val();   // classCodes/$code = classId (문자열)
}

/* ================================================================
   Step 1: Firebase Auth 인증 유틸
   ================================================================ */
const authState = {
  user: null,
  role: null,
};

auth.onAuthStateChanged(async user => {
  if (!user) { authState.user = null; authState.role = null; return; }
  const tokenResult = await user.getIdTokenResult();
  authState.user = user;
  authState.role = tokenResult.claims.role ?? null;
});

function getCurrentUser()  { return authState.user; }
function isTeacher()       { return authState.role === 'teacher' || authState.role === 'super_admin'; }
function isSuperAdmin()    { return authState.role === 'super_admin'; }
async function refreshAuthClaims() {
  const user = auth.currentUser;
  if (!user) return;
  const tokenResult = await user.getIdTokenResult(true);
  authState.role = tokenResult.claims.role ?? null;
}

/* ================================================================
   팀 입장 — joinTeam()이 DATA_PATH_VERSION에 따라 분기
   ================================================================ */
function joinTeam() {
  if (DATA_PATH_VERSION === 'v2') {
    _joinTeamV2();
  } else {
    _joinTeamV1();
  }
}

/* ── v1: 기존 teams/ 경로 (동작 완전 동일) ── */
function _joinTeamV1() {
  const errEl = document.getElementById('join-error');
  errEl.textContent = '';

  const val = document.getElementById('join-input').value.trim();
  const pin = document.getElementById('join-pin').value.trim();

  if (!val) { errEl.textContent = '팀 이름을 입력해주세요'; return; }
  if (!pin)  { errEl.textContent = 'PIN을 입력해주세요'; return; }
  if (!/^\d{4,6}$/.test(pin)) { errEl.textContent = 'PIN은 숫자 4~6자리로 입력해주세요'; return; }

  const encodedName = encodeURIComponent(val);
  const teamRef     = db.ref(getTeamPath(encodedName));  // v1: teams/$encodedName

  teamRef.child('pin').once('value').then(snap => {
    const savedPin = snap.val();

    if (savedPin !== null && savedPin !== pin) {
      errEl.textContent = '❌ PIN이 달라요. 다시 확인해보세요';
      document.getElementById('join-pin').value = '';
      document.getElementById('join-pin').focus();
      return;
    }
    if (savedPin === null) teamRef.child('pin').set(pin);

    _enterTeam(val, teamRef);
  }).catch(() => {
    errEl.textContent = '⚠️ 네트워크 오류가 났어요. 다시 시도해보세요';
  });
}

/* ── v2: classes/ 경로 (클래스 코드 + 팀명 + PIN) ── */
async function _joinTeamV2() {
  const errEl = document.getElementById('join-error');
  errEl.textContent = '';

  const code = document.getElementById('join-code')?.value.trim();
  const val  = document.getElementById('join-input').value.trim();
  const pin  = document.getElementById('join-pin').value.trim();

  if (!code) { errEl.textContent = '클래스 코드를 입력해주세요'; return; }
  if (!val)  { errEl.textContent = '팀 이름을 입력해주세요'; return; }
  if (!pin)  { errEl.textContent = 'PIN을 입력해주세요'; return; }
  if (!/^\d{4,6}$/.test(pin)) { errEl.textContent = 'PIN은 숫자 4~6자리로 입력해주세요'; return; }

  try {
    /* ★ anonymous auth 보장 — Rules의 auth != null 조건을 충족하기 위해
       이미 로그인된 경우(teacher Auth 포함) 재로그인 없이 통과.
       비인증 상태(학생)일 때만 anonymous sign-in 실행. */
    if (!auth.currentUser) {
      await auth.signInAnonymously();
    }

    const foundClassId = await _lookupClassId(code.toUpperCase());
    if (!foundClassId) { errEl.textContent = '❌ 클래스 코드가 올바르지 않아요'; return; }

    const encodedName = encodeURIComponent(val);
    const teamRef     = db.ref(getTeamPath(encodedName, foundClassId));

    const snap     = await teamRef.child('pin').once('value');
    const savedPin = snap.val();

    if (savedPin !== null && savedPin !== pin) {
      errEl.textContent = '❌ PIN이 달라요. 다시 확인해보세요';
      document.getElementById('join-pin').value = '';
      document.getElementById('join-pin').focus();
      return;
    }
    if (savedPin === null) teamRef.child('pin').set(pin);

    /* ★ 전역 classId 저장 — 이후 viewer 링크/저장에 사용 */
    classId = foundClassId;
    _enterTeam(val, teamRef);
  } catch {
    errEl.textContent = '⚠️ 네트워크 오류가 났어요. 다시 시도해보세요';
  }
}

/* ── resume: sessionStorage 컨텍스트로 입장 화면 건너뛰기 ──
   code lookup 건너뛰고 classId로 바로 입장. PIN 재검증 포함. */
async function _resumeTeamFromSession(ctx) {
  if (!ctx || !ctx.teamName || !ctx.pin) return false;

  try {
    if (!auth.currentUser) {
      await auth.signInAnonymously();
    }

    /* v2 classId 우선, 없으면 v1 경로 */
    const encodedName = encodeURIComponent(ctx.teamName);
    let teamRef;
    if (ctx.classId && DATA_PATH_VERSION === 'v2') {
      teamRef = db.ref(getTeamPath(encodedName, ctx.classId));
      classId = ctx.classId;
    } else {
      teamRef = db.ref(getTeamPath(encodedName));
    }

    /* PIN 재검증 — sessionStorage가 어쨌든 조작될 수 있으므로 반드시 확인 */
    const snap     = await teamRef.child('pin').once('value');
    const savedPin = snap.val();

    if (savedPin === null || savedPin !== ctx.pin) {
      /* PIN 불일치 → 일반 입장 화면으로 폴백 */
      sessionStorage.removeItem('makerSession');
      return false;
    }

    _enterTeam(ctx.teamName, teamRef);
    return true;
  } catch (e) {
    return false;
  }
}

/* ── 공통 입장 처리 — v1/v2 공유 ── */
function _enterTeam(val, teamRef) {
  teamName = val;
  document.getElementById('team-label').textContent = teamName;
  document.getElementById('join-screen').classList.add('hidden');

  /* ★ maker 세션 컨텍스트 저장 — ?resume=1 복귀 시 재입장 방지용
     sessionStorage: 같은 탭 내에서만 유효 (탭 닫히면 사라짐)
     PIN은 localStorage에 저장하지 않음 — 탭 생존 기간만 허용 */
  try {
    const pinInput  = document.getElementById('join-pin')?.value?.trim();
    const codeInput = document.getElementById('join-code')?.value?.trim()?.toUpperCase();
    if (pinInput) {
      sessionStorage.setItem('makerSession', JSON.stringify({
        teamName:  val,
        classId:   classId   || null,
        classCode: codeInput || null,   // v2 재입장에 필요
        pin:       pinInput,
        savedAt:   Date.now(),
      }));
    }
  } catch (e) { /* sessionStorage 막혀도 정상 동작 유지 */ }

  dbRef = teamRef.child('scenes');
  dbRef.on('value', snapshot => {
    isRemote = true;
    scenes   = snapshot.val() || {};
    /* ★ buttons 호환 보존 (옵션 2 — viewer-edit가 v0.3 N개 버튼 저장 시):
       snapshot.val()은 DB 노드 본체를 통째로 받아오므로, viewer-edit가 저장한
       buttons[] 배열이 scenes[num].buttons로 자동 들어와 있다.
       이후 maker가 set/update를 호출해도 scenes[num] 안에 buttons가
       포함된 채로 다시 저장되어 손실되지 않음.
       단, sceneRenderer.js가 신규 장면을 만들 땐 buttons 키 없이 시작 —
       이건 신규 장면이라 정상 동작. */
    const nums = Object.keys(scenes).map(Number);
    if (nums.length) nextNum = Math.max(...nums) + 1;

    /* ★ 타이핑 보호: 현재 포커스가 제목 입력창(js-title-input)에 있으면
       renderAll() 건너뜀 — 전체 카드 DOM 재생성으로 인한 커서/포커스 유실 방지.
       scenes 값은 이미 업데이트됨 → blur나 장면 전환 시 자연스럽게 반영됨.
       팀 내 lock 시스템 덕에 내가 편집 중인 장면을 남이 동시 수정하는 상황은 거의 없음. */
    const focused = document.activeElement;
    const isTypingTitle = focused
      && focused.classList
      && focused.classList.contains('js-title-input');

    if (!isTypingTitle) {
      renderAll();
    }
    isRemote = false;
    setSaveStatus('saved');
  });

  /* ★ 프로젝트 메타(viewer-meta) 구독 — 다른 사람이 설정 패널에서 저장해도 자동 반영
     viewer-edit이 쓰는 presentation / isPublic 필드는 건드리지 않고
     cover/entry/replay 필드만 projectMeta 로컬 캐시에 반영. */
  teamRef.child('viewer-meta').on('value', snap => {
    const prev = projectMeta || {};
    const meta = snap.val() || {};
    projectMeta = {
      coverTitle:     (typeof meta.coverTitle     === 'string') ? meta.coverTitle     : null,
      coverImageData: (typeof meta.coverImageData === 'string') ? meta.coverImageData : null,
      entrySceneId:   (meta.entrySceneId  !== undefined && meta.entrySceneId  !== null) ? String(meta.entrySceneId)  : null,
      replaySceneId:  (meta.replaySceneId !== undefined && meta.replaySceneId !== null) ? String(meta.replaySceneId) : null,
    };
    /* ★ 역할 배지([첫 감상 시작]/[다시 시작점])가 영향받는 카드만 재렌더 —
       entry/replay가 바뀐 이전/현재 num 모두 커버. 편집 중 카드는 스킵하여
       textarea 포커스 유실 방지. */
    const affected = new Set();
    [prev.entrySceneId, prev.replaySceneId, projectMeta.entrySceneId, projectMeta.replaySceneId]
      .forEach(id => { if (id !== null && id !== undefined) affected.add(String(id)); });
    affected.forEach(num => {
      if (scenes[num] && !activeEdits[num] && typeof renderCard === 'function') {
        renderCard(scenes[num]);
      }
    });
    /* 설정 패널이 열려있으면 값 다시 채움 (다른 사람 저장 반영) */
    if (typeof refreshProjectSettingsIfOpen === 'function') {
      refreshProjectSettingsIfOpen();
    }
  });

  /* ★ 프로젝트 메타 저장 함수 노출 — projectSettings.js가 호출 */
  window._metaRef = teamRef.child('viewer-meta');

  lockRef = teamRef.child('locks');
  lockRef.on('value', snap => {
    const prev = remoteLocks;
    remoteLocks = snap.val() || {};
    const now = Date.now();

    const allNums = new Set([...Object.keys(prev), ...Object.keys(remoteLocks)]);
    allNums.forEach(num => {
      const pLock = prev[num];
      const nLock = remoteLocks[num];
      const changed = JSON.stringify(pLock) !== JSON.stringify(nLock);
      if (changed) updateCardLockUI(Number(num));

      if (nLock && now - nLock.lockedAt > LOCK_TTL && nLock.editorId !== SESSION_ID) {
        lockRef.child(num).remove();
      }
    });
  });

  db.ref('.info/connected').on('value', snap2 => {
    const on = snap2.val() === true;
    document.getElementById('online-dot').className  = on ? 'on' : '';
    document.getElementById('online-label').textContent =
      on ? teamName + ' 연결됨 🟢' : '연결 끊김 🔴';
  });

  setTimeout(() => applyTemplate(selectedTemplate), 800);
}

/* ── Firebase 저장 (scene 단위 dirty write) ── */
const dirtyScenes = new Set();

function pushToFirebase(num) {
  if (isRemote || !dbRef) return;
  if (num !== undefined) dirtyScenes.add(num);
  setSaveStatus('changed');
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    if (!dbRef) return;
    if (dirtyScenes.size === 0) {
      dbRef.set(scenes)
        .then(() => setSaveStatus('saved'))
        .catch(() => setSaveStatus('error'));
      return;
    }
    const updates = {};
    dirtyScenes.forEach(n => {
      updates[n] = scenes[n] ? scenes[n] : null;
    });
    dirtyScenes.clear();
    dbRef.update(updates)
      .then(() => setSaveStatus('saved'))
      .catch(() => setSaveStatus('error'));
  }, 600);
}

/* 장면 삭제 시 개별 remove */
function removeSceneFromFirebase(num) {
  if (!dbRef) return;
  dbRef.child(String(num)).remove();
}

function setSaveStatus(s) {
  const dot = document.getElementById('save-dot');
  const lbl = document.getElementById('save-label');
  if (s === 'saved') {
    dot.className = 'saved';
    const t = new Date();
    lbl.textContent = `저장됨 ${t.getHours()}:${String(t.getMinutes()).padStart(2,'0')}`;
  } else if (s === 'changed') {
    dot.className = 'changed'; lbl.textContent = '저장 중...';
  } else {
    dot.className = ''; lbl.textContent = '-';
  }
}

/* ================================================================
   프로젝트 메타(viewer-meta) 저장 — 얇은 wrapper
   ─────────────────────────────────────────────────────────────
   · 전달 받은 필드만 update() → presentation / isPublic 등
     viewer-edit이 저장한 다른 필드는 건드리지 않음
   · 인자 partial 예: { coverTitle: '...', coverImageData: '...', ... }
   · null을 명시적으로 넣으면 Firebase에서 해당 필드 제거됨
   · 반환: Promise
   ================================================================ */
function pushProjectMetaToFirebase(partial) {
  if (!window._metaRef) return Promise.reject(new Error('not joined'));
  if (!partial || typeof partial !== 'object') return Promise.reject(new Error('invalid partial'));
  setSaveStatus('changed');
  return window._metaRef.update(partial)
    .then(() => { setSaveStatus('saved'); })
    .catch(err => { setSaveStatus('error'); throw err; });
}
