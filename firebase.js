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
/* W7-B: Firebase Storage 인스턴스 — 영상(mp4) 업로드/삭제용.
   firebase-storage-compat.js가 maker.html/viewer.html에 로드되어 있으면 활성화. */
const storage = (typeof firebase.storage === 'function') ? firebase.storage() : null;

/* BASE10-1: scenes 첫 스냅샷 도착 여부 helper. _enterTeam에서 false 초기화 →
   dbRef.on('value') 첫 발화 시 true. 기본 틀(BASE10) 가드 전용. */
window.isBranchScenesLoaded = function () {
  return !!window.__branchScenesLoaded;
};

/* ================================================================
   W7-B: 영상 업로드/삭제 헬퍼 (Firebase Storage)
   ─────────────────────────────────────────────────────────────
   정책:
   · 장면당 영상 1개. 업로드 시 기존 영상은 자동 덮어씀(같은 경로) 또는 삭제 후 업로드.
   · 형식: video/mp4 권장. 클라이언트에서 mime 검증.
   · 크기: 50MB 이내 (학교 환경 고려).
   · 길이: 60초 이내 (HTMLVideoElement.duration로 사전 검증).
   · Storage 경로: videos/{classId|'_legacy'}/{encodedTeamName}/scene_{num}.mp4
   ─────────────────────────────────────────────────────────────
   uploadVideoToStorage(file, scene, opts)
     opts.onProgress(percent) — 진행률 0~100
     opts.classId, opts.teamName 명시 또는 전역값 사용
     resolve → { downloadURL, storagePath }
     reject  → Error
   deleteVideoFromStorage(storagePath) — 실패해도 throw 안 함 (best-effort)
   ================================================================ */
const VIDEO_MAX_BYTES   = 50 * 1024 * 1024;   /* 50MB */
const VIDEO_MAX_SECONDS = 60;                 /* 1분 */
const VIDEO_ALLOWED_MIME_PREFIX = 'video/';

function _videoStoragePath(sceneNum, ctx) {
  const cid = (ctx && ctx.classId) || (typeof classId !== 'undefined' && classId) || '_legacy';
  const tn  = (ctx && ctx.teamName) || (typeof teamName !== 'undefined' && teamName) || 'unknown';
  const encodedName = encodeURIComponent(tn);
  return `videos/${cid}/${encodedName}/scene_${sceneNum}.mp4`;
}

/* HTMLVideoElement로 영상 길이 사전 검증 — 업로드 전 메모리에서 mp4 메타데이터 로드 */
function _probeVideoDuration(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      const dur = v.duration;
      URL.revokeObjectURL(url);
      if (typeof dur !== 'number' || isNaN(dur) || dur === Infinity) {
        reject(new Error('영상 길이를 확인할 수 없어요. mp4 파일이 맞는지 확인해주세요.'));
        return;
      }
      resolve(dur);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('영상 파일을 읽지 못했어요. mp4 파일이 맞는지 확인해주세요.'));
    };
    v.src = url;
  });
}

async function uploadVideoToStorage(file, sceneNum, opts) {
  if (!storage) throw new Error('Storage가 초기화되지 않았어요. 페이지를 새로고침해주세요.');
  if (!file) throw new Error('파일이 선택되지 않았어요.');
  /* 형식 */
  if (!file.type || !file.type.startsWith(VIDEO_ALLOWED_MIME_PREFIX)) {
    throw new Error('영상 파일이 아니에요. mp4 파일을 선택해주세요.');
  }
  /* 크기 */
  if (file.size > VIDEO_MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    throw new Error(`파일이 너무 커요 (${mb}MB). 50MB 이내 영상만 가능해요.`);
  }
  /* 길이 — 사전 검증 (Storage 업로드 전) */
  const dur = await _probeVideoDuration(file);
  if (dur > VIDEO_MAX_SECONDS + 0.5) {
    throw new Error(`영상이 너무 길어요 (${dur.toFixed(1)}초). 60초 이내 영상만 가능해요.`);
  }

  /* anonymous auth 보장 — Storage 규칙의 auth != null 충족 */
  if (!auth.currentUser) {
    try { await auth.signInAnonymously(); }
    catch (e) { /* 인증 실패해도 일단 시도 — Storage 규칙이 막으면 reject */ }
  }

  const storagePath = _videoStoragePath(sceneNum, opts || {});
  const ref = storage.ref(storagePath);
  const onProgress = opts && typeof opts.onProgress === 'function' ? opts.onProgress : null;

  /* put + 진행률 listener */
  return new Promise((resolve, reject) => {
    const task = ref.put(file, {
      contentType: file.type || 'video/mp4',
      cacheControl: 'public, max-age=3600',
    });
    task.on('state_changed',
      snap => {
        if (onProgress && snap.totalBytes > 0) {
          onProgress(Math.min(100, Math.round((snap.bytesTransferred / snap.totalBytes) * 100)));
        }
      },
      err => reject(err),
      async () => {
        try {
          const url = await task.snapshot.ref.getDownloadURL();
          resolve({ downloadURL: url, storagePath });
        } catch (e) { reject(e); }
      }
    );
  });
}

async function deleteVideoFromStorage(storagePath) {
  if (!storage || !storagePath) return false;
  try {
    await storage.ref(storagePath).delete();
    return true;
  } catch (e) {
    /* 이미 없거나 권한 없으면 무시 — best-effort */
    return false;
  }
}

/* ================================================================
   v114: 이미지 업로드 헬퍼 (Firebase Storage)
   ─────────────────────────────────────────────────────────────
   배경:
   · v113까지 그림책 이미지는 base64 → RTDB scenes/{num}/imageData에 저장됨
   · 사용자 사진 4MB × 20장 = 80MB RTDB 적재 → 감상자 1명당 80MB egress
   · 만원 결제 사건 (2026-05-17) 발생 → v113에 옛 작품 마이그
   · v114부터 신규 이미지도 Storage에 저장 — 같은 폭탄 재발 차단

   정책:
   · 입력 = base64 data URL (mediaManager가 압축한 후 전달하는 값)
   · Storage 경로: images/{classId|'_legacy'}/{encodedTeamName}/scene_{num}.{ext}
   · 같은 경로에 덮어쓰기 — 한 장면 = 한 이미지
   · public, max-age=1년 — CDN 캐시 영구
   · 반환 = public URL (token 없이 접근할 수 있는 GCS public URL)
   · viewer-render는 imageData || imageUrl 둘 다 <img src>에 설정 — 변경 X
   ──────────────────────────────────────────────────────────────── */
const IMAGE_STORAGE_MAX_BYTES = 6 * 1024 * 1024;   /* 6MB — mediaManager 5MB + 여유 1MB */
const IMAGE_ALLOWED_MIME_PREFIX = 'image/';

function _imageStoragePath(sceneNum, ctx, ext) {
  const cid = (ctx && ctx.classId) || (typeof classId !== 'undefined' && classId) || '_legacy';
  const tn  = (ctx && ctx.teamName) || (typeof teamName !== 'undefined' && teamName) || 'unknown';
  const encodedName = encodeURIComponent(tn);
  return `images/${cid}/${encodedName}/scene_${sceneNum}.${ext || 'jpg'}`;
}

function _extFromMime(mime) {
  return ({ 'image/png':'png','image/jpeg':'jpg','image/jpg':'jpg','image/gif':'gif','image/webp':'webp' })[mime] || 'jpg';
}

/* base64 data URL → Blob 변환 */
function _dataUrlToBlob(dataUrl) {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('data URL 형식이 아니에요.');
  const mime = m[1];
  const bin = atob(m[2]);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

/* 이미지 업로드 — dataUrl 또는 Blob/File 둘 다 지원 */
async function uploadImageToStorage(input, sceneNum, opts) {
  if (!storage) throw new Error('Storage가 초기화되지 않았어요. 페이지를 새로고침해주세요.');
  if (!input) throw new Error('이미지가 없어요.');

  /* dataUrl 또는 Blob 판정 */
  let blob;
  if (typeof input === 'string' && input.startsWith('data:')) {
    blob = _dataUrlToBlob(input);
  } else if (input instanceof Blob) {
    blob = input;
  } else {
    throw new Error('지원하지 않는 이미지 형식이에요.');
  }

  if (!blob.type || !blob.type.startsWith(IMAGE_ALLOWED_MIME_PREFIX)) {
    throw new Error('이미지 파일이 아니에요.');
  }
  if (blob.size > IMAGE_STORAGE_MAX_BYTES) {
    const mb = (blob.size / 1024 / 1024).toFixed(1);
    throw new Error(`이미지가 너무 커요 (${mb}MB). 6MB 이내만 가능해요.`);
  }

  /* anonymous auth 보장 — Storage 규칙의 auth != null 충족 */
  if (!auth.currentUser) {
    try { await auth.signInAnonymously(); }
    catch (e) { /* 인증 실패해도 일단 시도 */ }
  }

  const ext = _extFromMime(blob.type);
  const storagePath = _imageStoragePath(sceneNum, opts || {}, ext);
  const ref = storage.ref(storagePath);

  /* put — 진행률 추적 안 함 (이미지는 작아서 불필요) */
  await ref.put(blob, {
    contentType: blob.type,
    cacheControl: 'public, max-age=31536000',  /* 1년 */
  });

  /* 2026-05-22 fix: GCS direct URL은 신규 업로드 시 public ACL이 적용되지 않아 HTTP 403.
     v113 옛 마이그 작품은 ACL이 설정돼 있어 작동하지만 신규 업로드는 아님.
     ref.getDownloadURL()로 토큰이 포함된 Firebase Storage URL을 받아 어디서든 접근 가능. */
  let downloadURL;
  try {
    downloadURL = await ref.getDownloadURL();
  } catch (e) {
    /* fallback — 옛 GCS direct URL 형식. 옛 마이그 작품 호환용. */
    const bucket = storage.app.options.storageBucket || `${storage.app.options.projectId}.firebasestorage.app`;
    downloadURL = `https://storage.googleapis.com/${bucket}/${storagePath}`;
  }
  return { downloadURL, storagePath };
}

async function deleteImageFromStorage(storagePath) {
  if (!storage || !storagePath) return false;
  try {
    await storage.ref(storagePath).delete();
    return true;
  } catch (e) {
    return false;
  }
}

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
  authState.role = await _resolveRole(user, tokenResult);
});

function getCurrentUser()  { return authState.user; }
function isTeacher()       { return authState.role === 'teacher' || authState.role === 'super_admin'; }
function isSuperAdmin()    { return authState.role === 'super_admin'; }
async function refreshAuthClaims() {
  const user = auth.currentUser;
  if (!user) return;
  const tokenResult = await user.getIdTokenResult(true);
  authState.role = await _resolveRole(user, tokenResult);
}

/* v93: role 해석 helper — Custom Claim 우선, 없으면 teachers/{uid} 노드 확인.
   신규 가입자(v90~v92)는 claim 없고 teachers 노드만 존재해 이걸 통과시켜야
   isTeacher()가 true. teacher-auth.html / ui.js와 같은 로직. */
async function _resolveRole(user, tokenResult) {
  const claim = tokenResult.claims.role ?? null;
  if (claim) return claim;
  try {
    const snap = await firebase.database().ref('teachers/' + user.uid).once('value');
    return snap.exists() ? 'teacher' : null;
  } catch (e) {
    return null;
  }
}

/* ================================================================
   SEC-4 — joinTeamMembership callable adapter (얇은 어댑터).
   Functions SDK가 없으면 명시적 실패(no-op/성공 fallback 금지). PIN console 출력 금지.
   순수 로직은 membership-login.js(MembershipLogin)가 담당.
   ================================================================ */
const MEMBERSHIP_SDK_MISSING_MSG = '지금은 로그인 확인 기능을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
async function callJoinTeamMembership(args) {
  const app = (typeof firebase !== 'undefined' && typeof firebase.app === 'function') ? firebase.app() : null;
  if (!app || typeof app.functions !== 'function') {
    const err = new Error('functions-sdk-missing');
    err.code = 'unavailable';   /* requestTeamMembership이 SDK 없음으로 정규화 */
    throw err;
  }
  const callable = app.functions('asia-northeast3').httpsCallable('joinTeamMembership');
  const res = await callable({ classId: args.classId, teamName: args.teamName, pin: args.pin });
  return res && res.data;
}

/* 중복 클릭 잠금(single-flight) — MembershipLogin 로드 전이면 통과 래퍼 */
const _loginLock = (typeof MembershipLogin !== 'undefined' && MembershipLogin.createSingleFlight)
  ? MembershipLogin.createSingleFlight() : null;

/* ================================================================
   팀 입장 — joinTeam()이 DATA_PATH_VERSION에 따라 분기
   ================================================================ */
function joinTeam() {
  /* TEAM-SWITCH-RESET(2026-07-18): 수동 입장 시작 신호 — 진행 중인 자동복귀
     (_resumeTeamFromSession·auth 복원 대기 최대 3s)가 뒤늦게 다른 팀으로
     진입해 수동 입장과 교차하는 경합 차단(아래 resume 쪽에서 양보). */
  window.__manualJoinInFlight = true;
  if (DATA_PATH_VERSION === 'v2') {
    _joinTeamV2();
  } else {
    _joinTeamV1();
  }
}

/* ── v1: 기존 teams/ 경로 (동작 완전 동일) ── */
function _joinTeamV1() {
  /* SEC-4: v1(레거시 teams/ 경로)은 DATA_PATH_VERSION='v2'에서 호출되지 않음(dormant).
     보안: client PIN 직접 read(teams/{team}/pin)·자가등록 write를 제거한다.
     v1은 classId가 없어 joinTeamMembership(classes/ 기반 서버 검증)을 사용할 수 없으므로,
     만에 하나 호출되더라도 안전하게 차단한다(PIN 노출 경로 0). */
  const errEl = document.getElementById('join-error');
  if (errEl) errEl.textContent = '지금은 이 방식으로 입장할 수 없어요. 선생님께 문의해 주세요.';
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
  /* TEAM-NAME-DOT-GUARD(#2·#53): '.'는 encodeURIComponent가 인코딩하지 않아 RTDB 경로를 깨뜨림
     → 서버(joinTeamMembership)가 throw→'잠시 후 다시 시도' 오안내로 영원히 실패하던 것을,
     사전에 원인 안내로 막는다. (교사 팀 생성/CSV 가드와 동일 — 근본은 서버 검증도 후속으로.) */
  if (val.includes('.')) { errEl.textContent = "팀 이름에 '.'(마침표)는 쓸 수 없어요. 선생님께 확인해 주세요."; return; }
  if (!pin)  { errEl.textContent = 'PIN을 입력해주세요'; return; }
  if (!/^\d{4,6}$/.test(pin)) { errEl.textContent = 'PIN은 숫자 4~6자리로 입력해주세요'; return; }

  /* SEC-4: 서버(joinTeamMembership)가 teamCreationMode·PIN(legacy/account)·locked를 모두 검증한다.
     client는 pin/account를 직접 read 하지 않고, callable 성공해야만 진입한다(실패 시 진입 0회·fallback 없음). */
  if (typeof MembershipLogin === 'undefined') {
    errEl.textContent = MEMBERSHIP_SDK_MISSING_MSG;
    return;
  }
  if (_loginLock && _loginLock.isBusy()) return;   /* 중복 클릭 잠금 */
  const _btn = document.getElementById('btn-join');
  const _runner = _loginLock ? _loginLock.run.bind(_loginLock) : (fn => fn());

  await _runner(async () => {
    if (_btn) _btn.disabled = true;
    try {
      /* ★ anonymous auth 보장 — Rules의 auth != null / callable auth 충족.
         이미 로그인된 경우(teacher 포함) 재로그인 없이 통과. */
      if (!auth.currentUser) {
        await auth.signInAnonymously();
      }

      const foundClassId = await _lookupClassId(code.toUpperCase());
      if (!foundClassId) { errEl.textContent = '❌ 클래스 코드가 올바르지 않아요'; return; }

      const out = await MembershipLogin.requestTeamMembership({
        classId: foundClassId,
        teamName: val,
        pin: pin,
        callMembership: callJoinTeamMembership,
      });
      if (!out.ok) {
        /* TEAM-ACCOUNT-UX-1: teacher_managed 학급의 "다시 확인" 류 실패엔 교실 맥락 안내를 덧붙인다.
           팀 존재 여부는 여전히 비노출(모드는 학급 단위). PIN 형식·잠금 등 다른 문구는 그대로. */
        let _msg = out.message;
        /* ERR-KO-1(2026-07-10): 서버가 한글 안내를 못 준 경우(코드/영문) 쉬운 한글로 대체 */
        if (!_msg || !/[가-힣]/.test(_msg)) _msg = '들어가지 못했어요. 모둠 이름과 비밀번호(PIN)를 확인해 주세요.';
        /* 실제 입장 대상 학급(foundClassId)의 모드를 직접 읽는다 — 폼 문구용 캐시(코드 기준)는
           직전 코드값이라 stale일 수 있어 신뢰하지 않는다. 실패 시에만 도는 1회 read. */
        const _mode = await _readTeamCreationMode(foundClassId).catch(() => null);
        if (_mode === 'teacher_managed' && out.code !== 'invalid-input' && /확인/.test(_msg)) {
          _msg += ' 안 되면 선생님께 물어보세요.';
        }
        errEl.textContent = _msg; return;   /* 진입 0회·세션 저장 0회 */
      }

      /* ★ 전역 classId 저장 — 이후 viewer 링크/저장에 사용 */
      classId = foundClassId;
      const encodedName = encodeURIComponent(val);
      const teamRef     = db.ref(getTeamPath(encodedName, foundClassId));
      /* W6: _enterTeam이 viewer-meta 조회 + ptype-screen 흐름 처리. PIN은 저장하지 않음(SEC-5에서 강제). */
      _enterTeam(val, teamRef);
    } catch (e) {
      errEl.textContent = '⚠️ 네트워크 오류가 났어요. 다시 시도해보세요';
    } finally {
      if (_btn) _btn.disabled = false;
    }
  });
}

/* ── ADMIN-1C: 팀 생성 방식 조회 헬퍼 ──
   classes/{classId}/settings/teamCreationMode 를 읽어 반환.
   설정 없음/읽기 실패/알 수 없는 값 → 안전하게 'legacy_open' 폴백. */
async function _readTeamCreationMode(classId) {
  if (!classId) return 'legacy_open';
  try {
    const snap = await db.ref(`classes/${classId}/settings/teamCreationMode`).once('value');
    const m = snap.val();
    if (m === 'teacher_managed' || m === 'locked' || m === 'legacy_open') return m;
    return 'legacy_open';
  } catch (e) {
    return 'legacy_open';
  }
}

/* ════════════════════════════════════════════════════════════════
   ADMIN-TEACHER-JOIN(2026-07-09) — 교사 관리 🛠수정(?tauth=1) 경유 진입
   로그인된 교사는 PIN 없이 자기 반 팀에 입장(편집). 서버 joinTeamMembership이
   교사(super_admin ∥ meta/teacher_uid==uid)면 PIN 검증을 스킵하고 membership 발급.
   여기선 pin 없이 callable 호출만 — 실제 교사 판별/보안은 서버가 담당(위조 불가).
   성공 시 _enterTeam으로 기존 편집 진입(학생 join 성공과 동일 경로). 실패 시 false(호출부가 PIN 폼 폴백).
   ════════════════════════════════════════════════════════════════ */
async function _teacherJoinTeam(classIdArg, teamName) {
  if (!classIdArg || !teamName) return false;
  try {
    const out = await callJoinTeamMembership({ classId: classIdArg, teamName: teamName });  /* pin 없이 */
    if (out && out.ok) {
      classId = classIdArg;   /* 전역 classId — 이후 저장/viewer 링크에 사용 */
      const teamRef = db.ref(getTeamPath(encodeURIComponent(teamName), classIdArg));
      _enterTeam(teamName, teamRef, { sessionKind: 'teacher' });   /* SINGLE-SESSION-1: 교사 인수 문구 */
      return true;
    }
  } catch (e) { /* permission-denied(교사 아님)/네트워크 → 폼 폴백 */ }
  return false;
}

/* ════════════════════════════════════════════════════════════════
   TEAM-ACCOUNT-UX-1 — 입장 폼 문구를 클래스 코드의 팀 생성 모드에 맞춤 (client-only·저장 0)
   · teacher_managed = "선생님이 만들어 둔 모둠으로 들어가는" 느낌(새로 만든다는 인상 제거)
   · legacy_open     = 자동 생성이 실제로 가능하므로 "새로 시작/이어서" 안내를 숨기지 않음
   · 모드는 클래스 코드가 유효할 때만 읽어 조정. 못 읽으면 기본 문구 유지(회귀 0).
   · 팀 존재 여부는 노출하지 않음(모드는 학급 단위 설정일 뿐).
   ════════════════════════════════════════════════════════════════ */
let _joinModeCache = { code: null, mode: null };
async function _resolveJoinMode(code) {
  if (!code || code.length < 4) return null;
  if (_joinModeCache.code === code && _joinModeCache.mode) return _joinModeCache.mode;
  try {
    const cid = await _lookupClassId(code);
    if (!cid) return null;
    const mode = await _readTeamCreationMode(cid);
    _joinModeCache = { code, mode };
    return mode;
  } catch (e) { return null; }
}
function _applyJoinModeCopy(mode) {
  const sub  = document.querySelector('#join-screen .join-sub');
  const hint = document.querySelector('#join-screen .join-hint');
  if (mode === 'teacher_managed') {
    if (sub)  sub.textContent = '선생님이 알려준 클래스 코드와 모둠 이름, 비밀번호(PIN)를 입력해요';
    if (hint) hint.innerHTML  = '선생님이 만들어 둔 모둠으로 들어가요<br>같은 모둠은 같은 정보로 다시 이어서 작업해요';
  } else if (mode === 'legacy_open') {
    if (sub)  sub.textContent = '클래스 코드, 팀 이름, PIN을 입력해요';
    if (hint) hint.innerHTML  = '팀 이름과 PIN을 정해 들어가요<br>새 이름이면 새로 시작, 같은 이름이면 이어서 작업해요';
  }
}
/* #join-code blur/변경 시 호출 — ui.js에서 배선 */
async function _onJoinCodeResolveMode() {
  const code = (document.getElementById('join-code')?.value || '').trim().toUpperCase();
  const mode = await _resolveJoinMode(code);
  if (mode) _applyJoinModeCopy(mode);
}

/* ── resume: sessionStorage 컨텍스트로 입장 화면 건너뛰기 ──
   code lookup 건너뛰고 classId로 바로 입장. PIN 재검증 포함. */
/* SEC-5: 자기 membership(active) 여부만 확인. 학생은 Rules상 자기 members 노드만 read 가능.
   null·permission-denied·오류 → false(재로그인). 절대 client가 members를 생성하지 않는다. */
async function hasActiveTeamMembership(args) {
  try {
    if (!args || !args.classId || !args.teamName || !args.uid) return false;
    const enc = encodeURIComponent(args.teamName);
    const snap = await db.ref(`classes/${args.classId}/teams/${enc}/members/${args.uid}/status`).once('value');
    return snap.val() === 'active';
  } catch (e) {
    return false;
  }
}

async function _resumeTeamFromSession(ctx) {
  /* SEC-5: v2(classId) 경로에서만 membership 복원. v1(dormant)·classId 없음 → 재로그인.
     결정 로직은 MembershipLogin.resolveResume(순수)에 위임 → Node 하니스로 동일 로직 검증. */
  if (!ctx || !ctx.teamName || !ctx.classId || DATA_PATH_VERSION !== 'v2'
      || typeof MembershipLogin === 'undefined') {
    sessionStorage.removeItem('makerSession');
    return false;
  }
  try {
    /* REFINE-STAB-C: auth 복원(IndexedDB 비동기)이 끝나기 전에 currentUser=null을 보고
       signInAnonymously()를 부르면 "새 익명 uid"가 만들어져 members/{기존uid} 확인에 실패
       → 멀쩡한 세션이 재로그인 화면으로 떨어짐(간헐 '로그아웃처럼 보임'의 원인).
       onAuthStateChanged 첫 발화(=복원 완료)까지 대기 후에만 필요 시 익명 로그인. */
    await new Promise(resolve => {
      let done = false;
      const finish = () => { if (!done) { done = true; try { unsub(); } catch (e) {} resolve(); } };
      const unsub = auth.onAuthStateChanged(finish, finish);
      setTimeout(finish, 3000);   /* 방어: 복원 이벤트 미발화 시에도 진행 */
    });
    if (!auth.currentUser) {
      await auth.signInAnonymously();
    }
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    /* PIN 재검증 폐기 → 자기 membership(active) 확인. 저장 PIN으로 callable 자동 호출 안 함·members write 안 함. */
    const decision = await MembershipLogin.resolveResume({
      ctx: ctx,
      isMembershipActive: () => hasActiveTeamMembership({ classId: ctx.classId, teamName: ctx.teamName, uid }),
    });
    if (decision.action !== 'enter') {
      sessionStorage.removeItem('makerSession');   /* 없음/비활성/권한거부/uid 변경 → 재로그인 */
      return false;
    }
    /* TEAM-SWITCH-RESET: 대기(auth 복원 최대 3s) 중 사용자가 수동 입장을 시작했으면
       자동복귀는 양보 — 늦은 복귀가 수동 입장 팀 위에 이전 팀을 얹던 경합 차단. */
    if (window.__manualJoinInFlight) {
      sessionStorage.removeItem('makerSession');
      return false;
    }
    classId = ctx.classId;
    const encodedName = encodeURIComponent(ctx.teamName);
    const teamRef = db.ref(getTeamPath(encodedName, ctx.classId));
    _enterTeam(ctx.teamName, teamRef, { skipPtypeScreenIfExisting: true });
    return true;
  } catch (e) {
    return false;
  }
}

/* ── 공통 입장 처리 — v1/v2 공유 ──
   v109: opts.skipPtypeScreenIfExisting (default false)
   = true면 viewer-meta/projectType이 저장돼 있는 기존 작품일 때 ptype-screen 안 띄움.
   resume 흐름에서만 true로 설정. 일반 새 로그인은 false (기존 흐름 유지). */
function _enterTeam(val, teamRef, opts) {
  opts = opts || {};
  /* ════ TEAM-SWITCH-RESET(2026-07-18): 같은 탭 이중 진입 교차 오염 차단 ════
     자동복귀와 수동 입장이 경합하거나 한 탭에서 팀을 바꿔 재진입하면, 이전 팀
     scenes 리스너가 살아남아 ①로컬 scenes에 이전 팀 작품이 남고 ②저장 경로
     (dbRef=새 팀)가 이전 팀 작품을 새 팀에 통째로 기록할 수 있었다(시연2단계
     실사고 — 뷰어 SHELF-META-RESET '이전 책 상속'과 동일 뿌리의 maker 판).
     · 이전 scenes 리스너 해제 + 로컬 장면/저장대기 초기화
     · 세대 토큰: off가 닿지 못한 비동기 잔류 스냅샷(이전 진입의 늦은 도착)도
       콜백 첫 줄에서 무력화 — reinit 세대 토큰(AUDIT-BATCH-1 ③)과 동일 기법. */
  try { if (dbRef && typeof dbRef.off === 'function') dbRef.off('value'); } catch (e) { /* noop */ }
  scenes = {};
  try { if (typeof dirtyScenes !== 'undefined' && dirtyScenes && typeof dirtyScenes.clear === 'function') dirtyScenes.clear(); } catch (e) { /* noop */ }
  try { if (typeof _titleDirty !== 'undefined' && _titleDirty && typeof _titleDirty.clear === 'function') _titleDirty.clear(); } catch (e) { /* noop */ }
  try { if (typeof _bodyDirty !== 'undefined' && _bodyDirty && typeof _bodyDirty.clear === 'function') _bodyDirty.clear(); } catch (e) { /* noop */ }
  window.__enterTeamSeq = (window.__enterTeamSeq || 0) + 1;
  const _mySeq = window.__enterTeamSeq;

  teamName = val;
  document.getElementById('team-label').textContent = teamName;
  document.getElementById('join-screen').classList.add('hidden');

  /* ★ maker 세션 컨텍스트 저장 — ?resume=1/F5 복귀 시 재입장 방지용.
     SEC-5: PIN은 sessionStorage/localStorage 어디에도 저장하지 않는다.
     재접속 복원은 저장 PIN이 아니라 members/{uid}/status(active)로 판정(_resumeTeamFromSession). */
  try {
    const codeInput = document.getElementById('join-code')?.value?.trim()?.toUpperCase();
    if (val) {
      /* 레거시 세션의 pin 필드가 있었더라도 여기서 pin 없는 새 객체로 덮어써 제거된다. */
      sessionStorage.setItem('makerSession', JSON.stringify({
        teamName:  val,
        classId:   classId   || (opts && opts.classId) || null,
        classCode: codeInput || (opts && opts.classCode) || null,   // v2 재입장 보조(주: classId로 복원)
        savedAt:   Date.now(),
      }));
    }
  } catch (e) { /* sessionStorage 막혀도 정상 동작 유지 */ }

  dbRef = teamRef.child('scenes');

  /* SINGLE-SESSION-1(2026-07-11): 모둠당 편집 접속 1개 — 진입 시 세션 선언.
     같은 기기(브랜치↔다듬기 왕복·F5·새 탭)는 경고 없이 조용히 이어받고,
     다른 기기가 살아있으면 confirm 후 인수(이전 기기는 저장 flush 후 안내·종료).
     취소하면 첫 화면으로. 장치 실패 시엔 세션 없이 정상 진행(fail-open) —
     기존 데이터(scenes·계정)는 0바이트 무접촉(신규 session 노드만). */
  if (window.BranchSession) {
    const _sessKind = (opts && opts.sessionKind === 'teacher') ? 'teacher' : 'student';
    window.BranchSession.claim(db, teamRef, {
      kind: _sessKind,
      confirmTakeover: (cur) => Promise.resolve(confirm(
        _sessKind === 'teacher'
          ? '학생이 이 모둠을 편집 중일 수 있어요.\n들어가면 학생 기기의 접속은 종료돼요. 들어갈까요?'
          : '지금 다른 기기에서 이 모둠을 편집하고 있어요.\n계속 들어가면 그 기기의 접속은 종료돼요. 들어갈까요?')),
      onKicked: (v) => {
        try { if (typeof flushBodySaves === 'function') flushBodySaves(); } catch (e) {}
        try { if (typeof flushTitleSaves === 'function') flushTitleSaves(); } catch (e) {}
        /* SESSION-MSG-1: 오탐 대비 — 교사 인수 외에는 새로고침 재접속 선택 제공([확인]=reload). */
        const _msg = window.BranchSession.kickMessage(v);
        if (window.BranchSession.kickAllowsReload && window.BranchSession.kickAllowsReload(v)) {
          if (confirm(_msg)) { location.reload(); return; }
        } else {
          alert(_msg);
        }
        location.replace('index.html');
      },
    }).then(res => {
      if (res && res.denied) {
        /* TAKEOVER-CANCEL-CLEAN(#7·#39): 인수 confirm에서 취소한 학생의 makerSession을 지워
           다음에 다시 maker를 열 때 자동복귀(재확인 반복) 대신 입장 폼부터 보이게(취소 의사 유지). */
        try { sessionStorage.removeItem('makerSession'); } catch (e) {}
        location.replace('index.html');
      }
    }).catch(() => { /* fail-open */ });
  }

  /* BASE10-1: scenes 첫 스냅샷 도착 플래그.
     "로드 전 scenes={}를 빈 작품으로 오판"하는 위험을 막기 위해, 아래 dbRef.on('value')
     콜백이 최소 1회 실행된 뒤에만 true가 된다. 팀(재)입장마다 여기서 먼저 false로 초기화.
     기본 틀(BASE10) 버튼 표시/생성 가드 전용. 다른 로직은 이 플래그를 쓰지 않는다. */
  window.__branchScenesLoaded = false;
  /* RENDER-DIFF-1: 팀(재)입장마다 부분 렌더 기준선 초기화 — 새 팀 첫 스냅샷이
     이전 팀 기준선과 diff되어 렌더가 생략되는 일이 없게(항상 전체 렌더 경로). */
  _renderedSceneJson = null;

  /* W7 신규 흐름 강화: 입장 직후 ptype-screen 노출 — 사용자가 작품 유형 선택.
     · viewer-meta/projectType once 조회 → 기존 유형 있으면 그 카드에 "이전 선택" 강조
       (다른 카드 누르면 ui.js의 _onPtypeCardClick에서 alert 후 강제 진입)
     · 없으면 신규 작품 — 어느 카드든 즉시 진입 (선택 후 viewer-meta/projectType 저장)
     · ★ W7 핵심 fix: viewer-meta 노드는 있는데 projectType 필드만 누락된 옛 작품 →
       이번에도 ptype 화면 표시 + 사용자 선택 강제 + 저장. 다음부턴 lock 정상 작동.
     · 네트워크 실패 시에도 ptype-screen은 노출 (기존 유형 모름 상태로) */
  /* PICTUREBOOK-LEVELS ①: projectType과 함께 picturebookLevel도 읽음(자식 2개만 —
     viewer-meta 통째 read는 coverImageData 등 무거운 필드까지 끌어와서 금지). */
  Promise.all([
    teamRef.child('viewer-meta/projectType').once('value'),
    teamRef.child('viewer-meta/picturebookLevel').once('value'),
  ]).then(([snap, lvlSnap]) => {
    const VALID = ['text', 'picturebook', 'movie', 'experience'];
    const raw = snap.exists() ? snap.val() : null;
    const existing = (typeof raw === 'string' && VALID.includes(raw)) ? raw : null;
    const _lvlRaw = (lvlSnap && lvlSnap.exists()) ? Number(lvlSnap.val()) : null;
    const existingPbLevel = (existing === 'picturebook'
      && (_lvlRaw === 1 || _lvlRaw === 2 || _lvlRaw === 3)) ? _lvlRaw : null;
    if (existing && typeof selectProjectType === 'function') {
      selectProjectType(existing, existingPbLevel);   /* 메모리 변수 동기(단계 포함) */
    }
    /* v109: resume 흐름 + 기존 작품 = ptype-screen 건너뜀. 사용자는 곧장 maker 진입.
       projectType 누락된 옛 작품 또는 신규 작품은 기존대로 ptype-screen 노출. */
    if (opts.skipPtypeScreenIfExisting && existing) {
      if (typeof _maker_hideLoading === 'function') _maker_hideLoading();
      /* THOUGHT-COMPASS Phase D: resume 경유 기존 작품 — 진행 중이면 이어서 게이트(차단),
         미시작 optional이면 진입 버튼, 완료/none이면 통과. fire-and-forget(게이트 오버레이가 차단 담당). */
      if ((existing === 'text' || existing === 'picturebook')
          && window.ThoughtCompassController && typeof window.ThoughtCompassController.activateForExistingEntry === 'function'
          && typeof classId === 'string' && classId && typeof teamName === 'string' && teamName) {
        try { window.ThoughtCompassController.activateForExistingEntry({ classId: classId, teamName: teamName, projectType: existing }); } catch (_) { /* noop */ }
      }
      return;
    }
    if (typeof showPtypeScreen === 'function') showPtypeScreen(existing, existingPbLevel);
    if (typeof _maker_hideLoading === 'function') _maker_hideLoading();
  }).catch(() => {
    if (typeof showPtypeScreen === 'function') showPtypeScreen(null);
    if (typeof _maker_hideLoading === 'function') _maker_hideLoading();
  });

  dbRef.on('value', snapshot => {
    /* TEAM-SWITCH-RESET: 이전 진입 세대의 잔류 스냅샷(늦은 도착)은 무시 —
       현재 세대의 리스너만 로컬 상태를 만진다. */
    if (_mySeq !== window.__enterTeamSeq) return;
    isRemote = true;
    scenes   = snapshot.val() || {};
    /* BASE10-1: 첫 스냅샷(이후 모든 스냅샷)에서 true. 이 시점부터 scenes는 DB 실측값. */
    window.__branchScenesLoaded = true;
    /* ★ buttons 호환 보존 (옵션 2 — viewer-edit가 v0.3 N개 버튼 저장 시):
       snapshot.val()은 DB 노드 본체를 통째로 받아오므로, viewer-edit가 저장한
       buttons[] 배열이 scenes[num].buttons로 자동 들어와 있다.
       이후 maker가 set/update를 호출해도 scenes[num] 안에 buttons가
       포함된 채로 다시 저장되어 손실되지 않음.
       단, sceneRenderer.js가 신규 장면을 만들 땐 buttons 키 없이 시작 —
       이건 신규 장면이라 정상 동작. */

    /* ★ legacy body 매핑 정책 (W2-A에서 변경):
       이전(8단계): body 없으면 메모리에서 body=title로 자동 복제 → maker 카드에서
       제목/본문 칸이 같은 값으로 보이는 결함 발견.
       지금(W2-A): 자동 복제 제거. maker는 raw.body를 그대로 사용 (없으면 빈 채).
       _hasBody는 더 이상 필요 없으나 호환을 위해 단순 플래그로만 둠.

       legacy 작품의 옛 title은 viewer-edit/viewer 감상에선 adaptScenes의
       fallback 매핑이 처리 (raw.body 없으면 raw.title을 body로 해석) →
       legacy 작품 감상은 그대로 보임. maker 카드에서만 분리됨 = 사용자가
       maker에서 보면 본문 칸 빈 채, viewer-edit/감상 가면 옛 글 보임.

       다음 턴(W2-B 이후)에 별도 마이그레이션 도구로 legacy 데이터 정식 변환 예정. */
    Object.keys(scenes).forEach(numKey => {
      const s = scenes[numKey];
      if (!s || typeof s !== 'object') return;
      const hasBodyField = Object.prototype.hasOwnProperty.call(s, 'body') &&
                           s.body !== null && s.body !== undefined;
      s._hasBody = hasBodyField;
      /* body 자동 복제 제거 — s.body는 raw 그대로 (없으면 undefined) */
    });

    /* ★ legacy 마이그레이션 감지 (W7 보강): snapshot 첫 로드 시 한 번만 실행.
       ─────────────────────────────────────────────────────────────
       검사 대상 5개 패턴:
       1. title에 본문이 들어간 옛 작품 (body 필드 없음 + title 30자+ 또는 줄바꿈 포함)
       2. legacy choiceA/B/nextA/nextB만 있고 buttons[] 없음
       3. buttons[] 6개 초과 (옛 제한 없을 때 만든 작품)
       4. connectObjects에 back/home 타입 (W6 5종 정리 전)
       5. viewer-meta 자체 없음 (이건 별도 — _ptypeExistingType이 null인 흐름에서 처리)
       ─────────────────────────────────────────────────────────────
       _migrationToastShown 플래그로 한 작품에서 한 번만 보이게.
       표시 후 사용자 행동: 다듬기에서 직접 정리하거나 그대로 둠.
       자동 DB 저장 X — 사용자 lock 정책 위배. 인지 + 안내만. */
    if (!_migrationToastShown) {
      const legacyDiagnosis = _diagnoseLegacyPatterns(scenes);
      if (legacyDiagnosis.hasAny) {
        _migrationToastShown = true;
        showLegacyMigrationToast(legacyDiagnosis);
      }
    }

    /* W7: 빈 slot 1번부터 찾기. 이전엔 Math.max+1이라 삭제 후 추가 시 빈 슬롯 무시.
       이제: 가장 작은 빈 번호 찾음. 1,2,4 있으면 3번 채택. 모두 삭제면 1번. */
    const nums = Object.keys(scenes).map(Number);
    let candidate = 1;
    while (nums.includes(candidate)) candidate++;
    nextNum = candidate;

    /* ★ 타이핑 보호: 현재 포커스가 카드 텍스트 입력 영역에 있으면
       renderAll() 건너뜀 — 전체 카드 DOM 재생성으로 인한 커서/포커스 유실 방지.
       대상 셀렉터:
       · js-title-input  — 제목 input (단계 2부터 input 태그)
       · js-body-input   — 본문 textarea (단계 2 신규)
       · js-choice-label — 선택지 A/B input (port-label-input)
       scenes 값은 이미 업데이트됨 → blur나 장면 전환 시 자연스럽게 반영됨.
       팀 내 lock 시스템 덕에 내가 편집 중인 장면을 남이 동시 수정하는 상황은 거의 없음. */
    const focused = document.activeElement;
    /* DRAG-PERF-1(2026-07-10): js-cover-title/js-cover-subtitle 추가 — 표지 입력이 가드에서
       누락돼 타이핑 중 에코 renderAll이 포커스·한글 조합을 날리던 버그. */
    const isTypingCard = focused
      && focused.classList
      && (focused.classList.contains('js-title-input')  ||
          focused.classList.contains('js-body-input')   ||
          focused.classList.contains('js-choice-label') ||
          focused.classList.contains('js-cover-title')  ||
          focused.classList.contains('js-cover-subtitle'));

    /* v118: pan/drag/pinch 중엔 renderAll 호출 X — Firebase echo가 진행 중인 사용자 조작을
       방해함. 조작이 끝난 후 사용자가 카드 입력 중이 아니면 다음 업데이트에서
       자동 동기화됨. 안전 — scenes 메모리는 최신으로 유지됨.
       DRAG-PERF-1: __cardGrabbing(카드 pointerdown~pointerup 창, sceneRenderer가 관리) 추가 —
       dragState가 서기 전 그랩 순간의 에코가 카드를 파괴해 드래그가 조용히 죽던 문제. */
    const isInteracting = (typeof panState !== 'undefined' && panState)
                       || (typeof dragState !== 'undefined' && dragState)
                       || (typeof pinchState !== 'undefined' && pinchState)
                       || window.__cardGrabbing === true;

    if (!isTypingCard && !isInteracting) {
      /* RENDER-DIFF-1: 바뀐 장면 카드만 재생성(첫 로드·대량 변경은 내부에서 전체 렌더). */
      _renderScenesDiff();
    } else {
      /* DRAG-PERF-1: 건너뛴 에코가 다음 에코까지 stale로 남지 않게 — 조작이 끝나면 한 번 재렌더. */
      _scheduleSkippedEchoRender();
    }
    /* v116: 모바일 텍스트형이 활성 상태면 노드 구조 화면도 같이 갱신.
       옛엔 renderAll(PC sceneRenderer)만 호출 → 모바일 _mtbRender 호출 X →
       사용자가 편집한 본문/라벨이 구조 화면 노드 상태(branchCount, ⚠)에 반영되지 못함.
       갱신 조건: MTB 존재하고 active. 편집 화면 안의 textarea/input은 손 안 댐
       (_mtbRender는 #mtb-nodes 영역만 갱신, #mtb-edit-view는 별도). */
    if (typeof MTB !== 'undefined' && MTB && MTB.active && typeof window.mtbRender === 'function') {
      window.mtbRender();
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

    /* 작품 유형 (1단계 신규) — DB 우선, 없거나 잘못된 값이면 fallback (점검 2 결정).
       PROJECT_TYPES 화이트리스트로 잘못된 값 차단. */
    const validType = (typeof meta.projectType === 'string'
                       && Array.isArray(PROJECT_TYPES)
                       && PROJECT_TYPES.includes(meta.projectType))
      ? meta.projectType
      : DEFAULT_PROJECT_TYPE;

    projectMeta = {
      projectType:    validType,
      coverTitle:     (typeof meta.coverTitle     === 'string') ? meta.coverTitle     : null,
      coverImageData: (typeof meta.coverImageData === 'string') ? meta.coverImageData : null,
      entrySceneId:   (meta.entrySceneId  !== undefined && meta.entrySceneId  !== null) ? String(meta.entrySceneId)  : null,
      replaySceneId:  (meta.replaySceneId !== undefined && meta.replaySceneId !== null) ? String(meta.replaySceneId) : null,
    };
    /* v95: 모바일 텍스트형 브랜치 활성화 트리거 — projectType 확정된 후 알림 */
    window.dispatchEvent(new CustomEvent('mtb-project-ready'));
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

    /* 작품 유형 변경 시 모든 카드 재렌더 (2단계 신규).
       projectType은 카드 얼굴 자체를 결정하므로 prev !== curr이면 전체 영향.
       편집 중 카드는 renderCard에서 알아서 스킵 (activeEdits) 또는 안전하게
       activeEdits 보호. */
    const prevPType = prev.projectType;
    const currPType = projectMeta.projectType;
    if (prevPType && currPType && prevPType !== currPType && typeof renderCard === 'function') {
      Object.keys(scenes).forEach(num => {
        if (!activeEdits[num]) renderCard(scenes[num]);
      });
    }

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

      if (nLock && nLock.editorId !== SESSION_ID
          && (now - nLock.lockedAt > LOCK_TTL
              || nLock.lockedAt - now > 60000 /* CLOCK-SKEW-GUARD(2026-07-11): 미래 잠금=고장 시계, 정리 */)) {
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

  /* W6: 시작 템플릿 폐기 — 사용자 결정. applyTemplate 호출 제거.
     applyTemplate 함수 자체는 ui.js에 남김 (외부 호출 없음, dead code).
     selectedTemplate 변수도 더 이상 사용되지 않음. */
}

/* ── Firebase 저장 (scene 단위 dirty write) ── */
const dirtyScenes = new Set();
/* STRUCT-FULLSET-FIX(#9·#42): pushToFirebase()를 num 없이 부르면 '전체 set' 의도(장면 추가·연결·
   삭제·전체초기화). 이 의도가 어디에도 기록되지 않아, 직전 본문/제목 편집이 남긴 numbered dirty가
   있으면 flush가 부분 update로 빠져 구조 변경이 통째로 유실되던 것 방지 — 이 플래그로 의도 보존. */
let _fullSetPending = false;

/* legacy 마이그레이션 토스트 1회성 플래그 (A-1) — 한 작품 진입 후 한 번만 알림 */
let _migrationToastShown = false;

/* ================================================================
   W7 legacy 진단 (A+B): 5개 패턴 검사 + 종합 결과 반환
   ─────────────────────────────────────────────────────────────
   반환 형태:
     { hasAny: bool,
       titleAsBody: int,   // title에 본문 들어간 장면 수
       legacyChoice: int,  // choiceA/B만 있고 buttons[] 없는 장면 수
       overflowBtns: int,  // buttons[] 6개 초과 장면 수
       legacyCO: int,      // back/home connectObjects 보유 장면 수
       totalScenes: int }
   ================================================================ */
function _diagnoseLegacyPatterns(scenes) {
  const result = {
    hasAny: false, titleAsBody: 0, legacyChoice: 0,
    overflowBtns: 0, legacyCO: 0, totalScenes: 0,
  };
  if (!scenes || typeof scenes !== 'object') return result;
  Object.values(scenes).forEach(s => {
    if (!s || typeof s !== 'object') return;
    result.totalScenes++;

    /* 1. title에 본문 들어간 옛 작품 */
    if (!s._hasBody) {
      const t = String(s.title || '');
      if (t.includes('\n') || t.length >= 30) result.titleAsBody++;
    }

    /* 2. legacy choiceA/B만 있고 buttons[] 없음 */
    const hasButtons = Array.isArray(s.buttons) && s.buttons.length > 0;
    const hasLegacyChoice = (typeof s.choiceA === 'string' && s.choiceA.trim()) ||
                            (typeof s.choiceB === 'string' && s.choiceB.trim()) ||
                            (s.nextA != null) || (s.nextB != null);
    if (!hasButtons && hasLegacyChoice) result.legacyChoice++;

    /* 3. buttons[] 6개 초과 */
    if (Array.isArray(s.buttons) && s.buttons.length > 6) result.overflowBtns++;

    /* 4. connectObjects에 back/home 타입 (W6 5종 정리 전) */
    if (Array.isArray(s.connectObjects)) {
      const hasLegacyType = s.connectObjects.some(co =>
        co && (co.type === 'back' || co.type === 'home')
      );
      if (hasLegacyType) result.legacyCO++;
    }
  });
  result.hasAny = result.titleAsBody > 0 || result.legacyChoice > 0 ||
                  result.overflowBtns > 0 || result.legacyCO > 0;
  return result;
}

/* ================================================================
   W7 legacy 토스트 표시 — maker.html의 legacy-migration-toast 활용
   진단 결과를 사람 친화적 메시지로 변환.
   기존 토스트 HTML 구조: legacy-toast-count + legacy-toast-msg + legacy-toast-hint
   ================================================================ */
function showLegacyMigrationToast(diagnosis) {
  const toast = document.getElementById('legacy-migration-toast');
  if (!toast) return;

  /* 발견된 패턴 종합 카운트 (가장 큰 값을 메인 카운트로, 다른 패턴은 hint에 명시) */
  const counts = [
    diagnosis.titleAsBody,
    diagnosis.legacyChoice,
    diagnosis.overflowBtns,
    diagnosis.legacyCO,
  ].filter(n => n > 0);
  const maxCount = counts.length > 0 ? Math.max(...counts) : 0;

  const countEl = toast.querySelector('#legacy-toast-count');
  if (countEl) countEl.textContent = String(maxCount);

  /* 패턴별 안내 메시지 — 가장 빈번한 케이스 먼저 */
  const lines = [];
  if (diagnosis.titleAsBody > 0) {
    lines.push(`· 제목 칸에 본문 같은 긴 글이 들어있는 장면 ${diagnosis.titleAsBody}개`);
  }
  if (diagnosis.legacyChoice > 0) {
    lines.push(`· 옛 선택지 구조(A/B 형태)로 만든 장면 ${diagnosis.legacyChoice}개`);
  }
  if (diagnosis.overflowBtns > 0) {
    lines.push(`· 선택지 7개 이상인 장면 ${diagnosis.overflowBtns}개 (지금은 6개까지)`);
  }
  if (diagnosis.legacyCO > 0) {
    lines.push(`· 옛 연결 오브젝트 종류(뒤로/홈) 보유 장면 ${diagnosis.legacyCO}개`);
  }

  const msgEl = toast.querySelector('.legacy-toast-msg');
  if (msgEl) {
    msgEl.innerHTML =
      `옛 구조로 저장된 부분이 있어요.<br>` +
      `<small style="display:block;margin-top:6px;line-height:1.6;color:#666;">${lines.join('<br>')}</small>`;
  }

  const hintEl = toast.querySelector('.legacy-toast-hint');
  if (hintEl) {
    hintEl.innerHTML =
      `※ 그대로 두어도 감상은 정상 동작해요.<br>` +
      `※ 다듬기 화면에서 본문/선택지를 다시 저장하면 자동 정리됩니다.`;
  }

  toast.style.display = 'flex';
}

/* push 직전 sentinel 필터 — 메모리 전용 키(_hasBody)와
   legacy 매핑된 body(아직 사용자가 명시 편집 안 한 상태)는 DB에 저장하지 않는다.
   이러면 legacy 작품의 DB 형태가 보존되고, 사용자가 본문/제목을 명시 편집할 때만
   body 필드가 DB에 등장한다 (단계 2 잔여 결함 수정). */
function _sceneToDbShape(s) {
  if (!s || typeof s !== 'object') return s;
  const out = { ...s };
  /* _hasBody는 메모리 sentinel — DB에 저장 X */
  delete out._hasBody;
  /* legacy 매핑 상태(_hasBody=false)면 body 키도 빼서 DB 원형 유지 */
  if (s._hasBody === false) {
    delete out.body;
  }
  return out;
}

/* ════════════════════════════════════════════════════════════════
   RENDER-DIFF-1(2026-07-10): 에코 부분 렌더 — 바뀐 장면 카드만 재생성.
   ──────────────────────────────────────────────────────────────
   기존: 매 에코마다 renderAll()이 모든 카드를 파괴·재생성(카드당 리스너 ~30개
   재바인딩) → 팀 동시 편집·자기 쓰기 에코 때마다 화면 전반 잔버벅.
   이제: 마지막 렌더 시점의 장면별 JSON 기준선과 비교해 변경/신규 카드만
   renderCard(이미 "기존 카드 제거→재생성" 계약·펼침상태/잠금 복원 내장),
   삭제된 카드만 remove. 화살표는 SVG 전체 재그리기 유지(저비용·양끝 의존 안전).
   · 기준선 없음(첫 로드)·renderCard 부재·대량 변경(>12)이면 전체 렌더.
   · 로컬 편집(좌표/본문)으로 기준선이 낡으면 다음 에코에서 해당 카드만
     한 번 더 그려질 뿐(정확성 무해). ui.js 등 로컬 renderAll 경로는 불변.
   · 저장 대기(dirty) 장면은 항상 다시 그림 — 에코가 미저장 변경을 되돌렸을 때
     종전 renderAll처럼 되돌림이 화면에 드러나야(무증상 은폐 방지) 함.
   ════════════════════════════════════════════════════════════════ */
let _renderedSceneJson = null;   /* num → JSON.stringify(scene) — 마지막 렌더 반영 상태 */

function _snapshotScenesJson() {
  const out = {};
  Object.keys(scenes).forEach(k => {
    try { out[k] = JSON.stringify(scenes[k]); }
    catch (e) { out[k] = '__unserializable__' + Date.now(); }
  });
  return out;
}

/* 로컬 미저장 변경이 걸려 있는 장면 번호들 — push 대기(dirtyScenes)·입력 debounce
   대기(ui.js _titleDirty/_bodyDirty). 이 장면들은 diff 결과와 무관하게 다시 그린다. */
function _locallyDirtySceneNums() {
  const out = new Set();
  try { if (typeof dirtyScenes !== 'undefined' && dirtyScenes) dirtyScenes.forEach(n => out.add(String(n))); } catch (e) {}
  try { if (typeof _titleDirty !== 'undefined' && _titleDirty) _titleDirty.forEach(n => out.add(String(n))); } catch (e) {}
  try { if (typeof _bodyDirty !== 'undefined' && _bodyDirty) _bodyDirty.forEach(n => out.add(String(n))); } catch (e) {}
  return out;
}

function _renderScenesDiff() {
  if (!_renderedSceneJson || typeof renderCard !== 'function' || typeof drawArrows !== 'function') {
    if (typeof renderAll === 'function') renderAll();
    _renderedSceneJson = _snapshotScenesJson();
    return;
  }
  const next = _snapshotScenesJson();
  const changed = [];   /* 신규 + 내용 변경 */
  const removed = [];
  Object.keys(next).forEach(k => { if (next[k] !== _renderedSceneJson[k]) changed.push(k); });
  Object.keys(_renderedSceneJson).forEach(k => { if (!(k in next)) removed.push(k); });
  /* 에코-되돌림 은폐 방지: dirty 장면은 강제 재렌더(화면=scenes 최신값으로 정렬) */
  _locallyDirtySceneNums().forEach(k => { if (scenes[k] && changed.indexOf(k) === -1) changed.push(k); });

  if (changed.length === 0 && removed.length === 0) { _renderedSceneJson = next; return; }
  if (changed.length + removed.length > 12) {
    renderAll();
    _renderedSceneJson = next;
    return;
  }
  removed.forEach(k => { const el = document.getElementById('card-' + k); if (el) el.remove(); });
  changed.forEach(k => { if (scenes[k]) renderCard(scenes[k]); });
  drawArrows();
  if (typeof renderSideList === 'function') renderSideList();
  _renderedSceneJson = next;
}

/* DRAG-PERF-1(2026-07-10): 타이핑/조작 중이라 건너뛴 에코 재렌더 예약.
   기존엔 스킵된 에코가 다음 에코까지 화면에 반영 안 됨(stale) — 300ms 간격으로
   조작 종료를 확인해 한 번만 재렌더(RENDER-DIFF-1 부분 렌더 경유).
   scenes 메모리는 항상 최신이므로 데이터 안전. */
let _echoRetryTimer = null;
function _scheduleSkippedEchoRender() {
  clearTimeout(_echoRetryTimer);
  _echoRetryTimer = setTimeout(function _retry() {
    const f = document.activeElement;
    const typing = f && f.classList &&
      (f.classList.contains('js-title-input') || f.classList.contains('js-body-input') ||
       f.classList.contains('js-choice-label') || f.classList.contains('js-cover-title') ||
       f.classList.contains('js-cover-subtitle'));
    const interacting = (typeof panState !== 'undefined' && panState)
                     || (typeof dragState !== 'undefined' && dragState)
                     || (typeof pinchState !== 'undefined' && pinchState)
                     || window.__cardGrabbing === true;
    if (typing || interacting) { _echoRetryTimer = setTimeout(_retry, 300); return; }
    _echoRetryTimer = null;
    _renderScenesDiff();
  }, 300);
}

function pushToFirebase(num) {
  if (isRemote || !dbRef) return;
  if (num !== undefined) dirtyScenes.add(num);
  else _fullSetPending = true;   /* STRUCT-FULLSET-FIX(#9·#42): no-arg = 전체 set 의도 보존 */
  setSaveStatus('changed');
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    _flushPushToFirebaseNow();
  }, 600);
}

/* SESSION-TTL-ACTIVITY(#40): 저장 성공 시 makerSession.savedAt을 갱신 → 재입장 TTL(2h)이
   '진입 시각'이 아니라 '마지막 활동'을 기준으로. 2시간 넘게 계속 작업하다 F5하면 만료로 취급돼
   입장 폼으로 튕기던 것 방지. sessionStorage.savedAt만 덮어씀(다른 필드·PIN 무접촉). */
function _touchMakerSession() {
  try {
    const raw = sessionStorage.getItem('makerSession');
    if (!raw) return;
    const ms = JSON.parse(raw);
    if (!ms) return;
    ms.savedAt = Date.now();
    sessionStorage.setItem('makerSession', JSON.stringify(ms));
  } catch (e) { /* sessionStorage 막혀도 무해 */ }
}

/* 강제 즉시 push — 페이지 떠날 때 / 명시적 저장 시 호출.
   pushToFirebase의 setTimeout 내용을 추출해 즉시 실행 가능하게 분리 (안전망). */
function _flushPushToFirebaseNow() {
  if (!dbRef) return;
  clearTimeout(pushTimer);
  pushTimer = null;
  /* STRUCT-FULLSET-FIX(#9·#42): 전체 set 의도가 서 있으면 dirtyScenes 유무와 무관하게 전체 set.
     (부분 update로 빠지면 장면 추가/연결/삭제/전체초기화가 유실됨.) 전체 set이 모두 덮으므로
     대기 중 numbered dirty도 함께 소거. */
  if (_fullSetPending || dirtyScenes.size === 0) {
    _fullSetPending = false;
    dirtyScenes.clear();
    /* 전체 set — 모든 장면을 DB shape으로 변환 */
    const cleanScenes = {};
    Object.keys(scenes).forEach(k => {
      cleanScenes[k] = _sceneToDbShape(scenes[k]);
    });
    dbRef.set(cleanScenes)
      .then(() => { setSaveStatus('saved'); _touchMakerSession(); })
      /* SAVE-REQUEUE(#43): 실패한 저장분을 버리지 말고 재시도 예약(다음 저장/이탈 flush에서 다시 씀).
         전체 set 실패 → 전체 재시도 예약. 그대로 두면 조용히 유실되던 것 방지. */
      .catch(() => { _fullSetPending = true; setSaveStatus('error'); });
    return;
  }
  const updates = {};
  const _writingKeys = [];
  dirtyScenes.forEach(n => {
    updates[n] = scenes[n] ? _sceneToDbShape(scenes[n]) : null;
    _writingKeys.push(n);
  });
  dirtyScenes.clear();
  dbRef.update(updates)
    .then(() => { setSaveStatus('saved'); _touchMakerSession(); })   /* #40: 활동 기준 TTL 갱신 */
    /* SAVE-REQUEUE(#43): 실패한 장면 키를 dirtyScenes에 되돌려 다음 flush에서 재시도(유실 방지). */
    .catch(() => { _writingKeys.forEach(n => dirtyScenes.add(n)); setSaveStatus('error'); });
}

/* 페이지 이탈 시 강제 push — 600ms debounce 중인 변경 손실 방지.
   ui.js의 flushTitleSaves/flushBodySaves가 먼저 실행되어 dirtyScenes에
   변경을 적재하면, 여기서 즉시 DB로 push. */
window.addEventListener('beforeunload', (e) => {
  if (pushTimer || dirtyScenes.size > 0) _flushPushToFirebaseNow();
  /* v122b: 저장 실패 banner 표시 중에 페이지 떠나려 하면 한 번 더 확인 */
  const errBanner = document.getElementById('global-save-error-banner');
  if (errBanner && errBanner.style.display !== 'none') {
    e.preventDefault();
    e.returnValue = '아직 저장되지 않은 변경이 있어요. 정말 떠나시겠어요?';
    return e.returnValue;
  }
});
window.addEventListener('pagehide', () => {
  if (pushTimer || dirtyScenes.size > 0) _flushPushToFirebaseNow();
});

/* 장면 삭제 시 개별 remove */
function removeSceneFromFirebase(num) {
  if (!dbRef) return;
  dbRef.child(String(num)).remove();
}

/* v122b: 저장 실패 시 화면 가운데 고정 banner — 학생/교사가 못 보고 지나치는 사건 차단.
   기존 작은 save-dot/save-label만으로 부족 (사건: 30분 작업 전체 실패해도 silent).
   banner는 한 번만 동적 생성 + 표시/숨김 토글. */
function _ensureSaveErrorBanner() {
  let el = document.getElementById('global-save-error-banner');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'global-save-error-banner';
  el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;'
    + 'background:#ef476f;color:#fff;padding:12px 16px;text-align:center;'
    + 'font-family:"Jua","Nanum Gothic",sans-serif;font-size:14px;font-weight:600;'
    + 'box-shadow:0 4px 14px rgba(0,0,0,.18);cursor:pointer;display:none;'
    + 'line-height:1.45;';
  el.innerHTML = '⚠️ <strong>저장 실패</strong> — 네트워크를 확인해주세요. '
    + '<u>여기를 눌러 다시 시도</u>';
  el.addEventListener('click', () => {
    el.style.display = 'none';
    if (typeof _flushPushToFirebaseNow === 'function') _flushPushToFirebaseNow();
  });
  document.body.appendChild(el);
  return el;
}

function setSaveStatus(s) {
  /* v99: 모바일 텍스트형 status element도 동기화 — 진짜 저장 완료 시에만 갱신 */
  const mtbStatus = document.getElementById('mtb-edit-status');
  if (mtbStatus) {
    if (s === 'saved')       mtbStatus.textContent = '✓ 저장됨';
    else if (s === 'changed') mtbStatus.textContent = '저장 중...';
    else if (s === 'error')   mtbStatus.textContent = '✗ 오류';
  }
  /* v122b: 화면 고정 banner — error면 표시, saved/changed면 숨김. console.error도. */
  if (s === 'error') {
    try { _ensureSaveErrorBanner().style.display = 'block'; } catch (e) {}
    console.error('[setSaveStatus] 저장 실패 — Firebase write 거부 또는 네트워크 오류');
  } else if (s === 'saved') {
    const b = document.getElementById('global-save-error-banner');
    if (b) b.style.display = 'none';
  }
  const dot = document.getElementById('save-dot');
  const lbl = document.getElementById('save-label');
  if (!dot || !lbl) return;
  if (s === 'saved') {
    dot.className = 'saved';
    const t = new Date();
    lbl.textContent = `저장됨 ${t.getHours()}:${String(t.getMinutes()).padStart(2,'0')}`;
    lbl.style.color = '';
    lbl.style.cursor = '';
    lbl.title = '';
    lbl.onclick = null;
  } else if (s === 'changed') {
    dot.className = 'changed';
    lbl.textContent = '저장 중...';
    lbl.style.color = '';
    lbl.style.cursor = '';
    lbl.title = '';
    lbl.onclick = null;
  } else if (s === 'error') {
    /* 저장 실패 — 사용자에게 명확히 알림 + 클릭으로 재시도.
       마감 직전 사용자가 데이터 손실 인지 못하는 경우 방지 */
    dot.className = 'changed';
    dot.style.background = '#ef476f';   /* 빨강 */
    lbl.textContent = '⚠️ 저장 실패 — 클릭해서 다시 시도';
    lbl.style.color = '#ef476f';
    lbl.style.cursor = 'pointer';
    lbl.title = '저장이 실패했어요. 네트워크 확인 후 클릭해서 다시 시도하세요.';
    lbl.onclick = () => {
      lbl.onclick = null;
      _flushPushToFirebaseNow();
    };
  } else {
    dot.className = '';
    dot.style.background = '';
    lbl.textContent = '-';
    lbl.style.color = '';
    lbl.style.cursor = '';
    lbl.title = '';
    lbl.onclick = null;
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

/* ================================================================
   v40: 작품 복사 — 4자리 코드 기반 양방향 공유
   ─────────────────────────────────────────────────────────────
   · 발급(교사 admin): issueCopyCode(classId, teamEncoded)
     → 4자리 숫자 코드(1000~9999) + copyCodes/{code} 노드 생성
     → 24시간 후 만료 (다회용)
   · 소환(빈 슬롯 학생): redeemCopyCode(code, dstClassId, dstTeamEncoded)
     → 검증(코드 유효·만료·src 존재·dst 빈슬롯) → multi-path update
     → isPublic:false 강제 + copiedFrom 메타 기록
   · 영상 storagePath는 그대로 공유 (Storage 객체 복사 안 함)
   · 이미지 imageData는 base64 인라인이라 자동 복사
   ================================================================ */

const COPY_CODE_TTL_MS = 24 * 60 * 60 * 1000;

/* 4자리 숫자 코드 발급. 충돌 시 재시도 5회. */
async function issueCopyCode(classId, teamEncoded) {
  if (!classId || !teamEncoded) throw new Error('classId/teamEncoded 누락');

  /* 원본 존재 확인 — 빈 작품에 코드 발급하지 않게 */
  const srcSnap = await db.ref(`classes/${classId}/teams/${teamEncoded}/scenes`).once('value');
  if (!srcSnap.exists()) throw new Error('원본 작품에 장면이 없어요. 코드를 발급할 수 없어요.');

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));   // 1000~9999
    const ref  = db.ref(`copyCodes/${code}`);
    const snap = await ref.once('value');
    /* 만료된 코드 자리는 덮어써도 안전 */
    if (snap.exists()) {
      const data = snap.val();
      if (data && data.expiresAt && data.expiresAt > Date.now()) continue;
    }
    const now = Date.now();
    await ref.set({
      srcClassId:     classId,
      srcTeamEncoded: teamEncoded,
      createdAt:      now,
      expiresAt:      now + COPY_CODE_TTL_MS,
    });
    return { code, expiresAt: now + COPY_CODE_TTL_MS };
  }
  throw new Error('코드 발급 실패 — 잠시 후 다시 시도해주세요.');
}

/* 코드로 작품 받기. dst 빈 슬롯 강제. */
async function redeemCopyCode(code, dstClassId, dstTeamEncoded) {
  if (!/^\d{4}$/.test(String(code || ''))) throw new Error('4자리 숫자 코드를 입력해주세요.');
  if (!dstClassId || !dstTeamEncoded) throw new Error('받는 모둠 정보가 없어요.');

  const codeRef  = db.ref(`copyCodes/${code}`);
  const codeSnap = await codeRef.once('value');
  if (!codeSnap.exists()) throw new Error('없는 코드예요. 다시 확인해주세요.');
  const codeData = codeSnap.val();
  if (!codeData.expiresAt || codeData.expiresAt < Date.now()) {
    throw new Error('만료된 코드예요. 다시 발급 받아주세요.');
  }
  const { srcClassId, srcTeamEncoded } = codeData;
  if (!srcClassId || !srcTeamEncoded) throw new Error('잘못된 코드 정보예요.');

  if (srcClassId === dstClassId && srcTeamEncoded === dstTeamEncoded) {
    throw new Error('같은 모둠으로는 복사할 수 없어요.');
  }

  /* dst 빈 슬롯 — scenes 노드 없거나 비어있어야 */
  const dstBase = `classes/${dstClassId}/teams/${dstTeamEncoded}`;
  const dstScenes = await db.ref(`${dstBase}/scenes`).once('value');
  if (dstScenes.exists()) {
    throw new Error('이미 작품이 있는 모둠이에요. 빈 모둠으로만 받을 수 있어요.');
  }

  /* 원본 통째 로드 */
  const srcBase = `classes/${srcClassId}/teams/${srcTeamEncoded}`;
  const [srcScenesSnap, srcMetaSnap] = await Promise.all([
    db.ref(`${srcBase}/scenes`).once('value'),
    db.ref(`${srcBase}/viewer-meta`).once('value'),
  ]);
  if (!srcScenesSnap.exists()) throw new Error('원본 작품이 없어졌어요.');

  const srcScenes = srcScenesSnap.val();
  const srcMeta   = srcMetaSnap.val() || {};

  /* viewer-meta 가공 — isPublic:false 강제 + copiedFrom 메타 */
  const dstMeta = Object.assign({}, srcMeta, {
    isPublic: false,
    copiedFrom: {
      srcClassId,
      srcTeamEncoded,
      copyCode: String(code),
      copiedAt: Date.now(),
    },
  });

  /* multi-path atomic update — scenes/viewer-meta 통째 저장 */
  const updates = {};
  updates[`${dstBase}/scenes`]        = srcScenes;
  updates[`${dstBase}/viewer-meta`]   = dstMeta;
  await db.ref().update(updates);

  /* v41: 자동 진입에 쓸 projectType도 반환 (+PICTUREBOOK-LEVELS ①: 단계 동기용) */
  return {
    ok: true, srcClassId, srcTeamEncoded,
    projectType: dstMeta.projectType || null,
    picturebookLevel: dstMeta.picturebookLevel || null,
  };
}
