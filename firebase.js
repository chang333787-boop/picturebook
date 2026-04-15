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
 * DATA_PATH_
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

/* ── 공통 입장 처리 — v1/v2 공유 ── */
function _enterTeam(val, teamRef) {
  teamName = val;
  document.getElementById('team-label').textContent = teamName;
  document.getElementById('join-screen').classList.add('hidden');

  dbRef = teamRef.child('scenes');
  dbRef.on('value', snapshot => {
    isRemote = true;
    scenes   = snapshot.val() || {};
    const nums = Object.keys(scenes).map(Number);
    if (nums.length) nextNum = Math.max(...nums) + 1;
    renderAll();
    isRemote = false;
    setSaveStatus('saved');
  });

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
