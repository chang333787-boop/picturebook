/* ================================================================
   viewer-edit.js — 장면 고정형 편집기 (재설계)
   ─────────────────────────────────────────────────────────────────
   원칙:
   · 표현 마감만 — 구조 편집(장면 추가/삭제/연결/본문) 절대 없음
   · 현재 장면 고정 — 저장/스타일 변경 후에도 장면 유지
   · 장면 네비게이터 — 이전/다음/현재 정보 상단 고정
   · 학생용 UI — 드래그 + 선택형 (숫자 입력 기본 숨김)
   ================================================================ */

/* ================================================================
   글 수정 상태 (다듬기 화면 — 글 수정 기능 1차)
   ─────────────────────────────────────────────────────────────
   · 현재 편집 대상 장면 번호 + 잠금 확보 여부 + 저장 대기 큐를 보관
   · renderEditPanel이 호출될 때마다 장면 전환을 감지해 잠금 인수인계
   · input 이벤트는 renderEditPanel 금지 — 대신 viewer-frame만 재렌더
   ================================================================ */
const _editText = {
  num: null,                 // 현재 잠금 확인/확보한 장면 번호
  editable: false,           // 잠금 확보 여부 (true일 때만 저장)
  pendingFields: {},         // debounce 대기 중 변경사항 { title?, body?, buttons?, ... }
  pendingSaveTimer: null,
  rafPending: false,
  lockHandlerInstalled: false,
  saveStatusTimer: null,
};
/* v134: 다른 스크립트(특히 storyAnalyzer.js의 _rtIsViewerEditable)가 참조할 수 있게
   window에 명시적으로 노출. const 선언은 script-level scope라 자동으로 window에 잡히지 않음 —
   v130 루트보기 인라인 수정 ✎ 버튼이 안 보이던 진짜 원인. */
if (typeof window !== 'undefined') {
  window._editText = _editText;
}

/* COPY-FIX-2C-1: 브라우저 기본 confirm 대체 — 화면 안 커스텀 확인 카드.
   Promise<boolean> 반환 (확인 = true / 취소·ESC·배경클릭 = false).
   viewer.html 컨텍스트 공용이라 window에 명시 노출(const는 자동 노출 X).
   삭제·초기화 같은 위험 작업은 danger:true로 확인 버튼을 빨갛게 강조.
   기본 포커스는 취소 버튼 — Enter로 실수 삭제 방지. */
function showViewerConfirm(opts) {
  opts = opts || {};
  const title = opts.title || '확인할까요?';
  const message = opts.message || '';
  const confirmText = opts.confirmText || '확인';
  const cancelText = opts.cancelText || '취소';
  const danger = !!opts.danger;
  return new Promise(function (resolve) {
    const ID = 'viewer-confirm-root';
    const old = document.getElementById(ID);
    if (old) old.remove();
    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/\n/g, '<br/>');
    }
    const root = document.createElement('div');
    root.id = ID;
    root.className = 'viewer-confirm-backdrop';
    root.innerHTML =
      '<div class="viewer-confirm-card" role="dialog" aria-modal="true">'
      +   '<div class="viewer-confirm-title">' + esc(title) + '</div>'
      +   (message ? '<div class="viewer-confirm-message">' + esc(message) + '</div>' : '')
      +   '<div class="viewer-confirm-actions">'
      +     '<button type="button" class="viewer-confirm-cancel">' + esc(cancelText) + '</button>'
      +     '<button type="button" class="viewer-confirm-ok' + (danger ? ' is-danger' : '') + '">' + esc(confirmText) + '</button>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(root);
    let done = false;
    function finish(val) {
      if (done) return;
      done = true;
      if (root.parentNode) root.parentNode.removeChild(root);
      document.removeEventListener('keydown', onKey);
      resolve(val);
    }
    function onKey(e) { if (e.key === 'Escape') finish(false); }
    root.addEventListener('click', function (e) { if (e.target === root) finish(false); });
    document.addEventListener('keydown', onKey);
    const okBtn = root.querySelector('.viewer-confirm-ok');
    const cancelBtn = root.querySelector('.viewer-confirm-cancel');
    if (okBtn) okBtn.addEventListener('click', function () { finish(true); });
    if (cancelBtn) cancelBtn.addEventListener('click', function () { finish(false); });
    try { (cancelBtn || okBtn).focus(); } catch (_) {}
  });
}
if (typeof window !== 'undefined') {
  window.showViewerConfirm = showViewerConfirm;
}

/* REGEN-SCENE-1(2026-07-27): "왜 바꾸고 싶은지" 묻는 창.
   AI가 준 그림을 그냥 받지 않고 이유를 들어 판단하게 하는 활동 — 자주 나오는 이유는 버튼으로,
   그 밖은 직접 적게 한다. 반환: 선택한 이유 문자열 / 취소면 null. */
function _askRegenReason() {
  return new Promise((resolve) => {
    const PRESETS = [
      '이야기에 없는 것이 그림에 있어요',
      '주인공 모습이 이야기와 달라요',
      '장면 분위기가 이야기와 안 맞아요',
    ];
    const back = document.createElement('div');
    back.className = 'viewer-confirm-backdrop';
    let done = false;
    const finish = (v) => { if (done) return; done = true; try { back.remove(); } catch (e) { /* noop */ } resolve(v); };
    back.innerHTML =
      '<div class="viewer-confirm-card" role="dialog" aria-modal="true" style="max-width:440px;">'
      +   '<div class="viewer-confirm-title">🔁 왜 다시 만들고 싶어요?</div>'
      +   '<div class="viewer-confirm-message" style="margin-bottom:12px;">이유를 하나 고르거나 직접 적어 주세요.<br>'
      +     '<span style="font-size:12px;color:#8a7d63;">다시 만들면 조금 다른 그림이 나와요. 작품마다 2번까지 할 수 있어요.</span></div>'
      +   '<div class="js-reason-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;"></div>'
      +   '<input type="text" class="js-reason-input" maxlength="60" placeholder="직접 적을래요 (예: 고양이가 아직 안 나왔어요)" '
      +     'style="width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #d9cfb6;border-radius:9px;font-size:13.5px;">'
      +   '<div class="viewer-confirm-actions" style="margin-top:14px;">'
      +     '<button type="button" class="js-reason-cancel">그만두기</button>'
      +     '<button type="button" class="js-reason-ok">이 이유로 다시 만들기</button>'
      +   '</div>'
      + '</div>';
    const list = back.querySelector('.js-reason-list');
    const input = back.querySelector('.js-reason-input');
    let picked = '';
    PRESETS.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = p;
      b.style.cssText = 'text-align:left;padding:10px 12px;border:1.5px solid #ded4bb;border-radius:10px;'
        + 'background:#fffdf7;font-size:13.5px;color:#4a3f2c;cursor:pointer;';
      b.addEventListener('click', () => {
        picked = p;
        input.value = '';
        Array.prototype.forEach.call(list.children, (c) => {
          c.style.borderColor = '#ded4bb'; c.style.background = '#fffdf7';
        });
        b.style.borderColor = '#8a9a5b'; b.style.background = '#f0f3e4';
      });
      list.appendChild(b);
    });
    input.addEventListener('input', () => {
      if (!input.value.trim()) return;
      picked = '';
      Array.prototype.forEach.call(list.children, (c) => { c.style.borderColor = '#ded4bb'; c.style.background = '#fffdf7'; });
    });
    back.querySelector('.js-reason-cancel').addEventListener('click', () => finish(null));
    back.querySelector('.js-reason-ok').addEventListener('click', () => {
      const typed = String(input.value || '').trim();
      const reason = typed || picked;
      if (!reason) { input.focus(); input.style.borderColor = '#c66f4a'; return; }
      finish(reason);
    });
    back.addEventListener('click', (e) => { if (e.target === back) finish(null); });
    document.body.appendChild(back);
    try { list.firstChild && list.firstChild.focus(); } catch (e) { /* noop */ }
  });
}

const EDIT_SAVE_DEBOUNCE_MS = 800;

/* W9 (v3): 양옆 마감 테마 collapsible 상태.
   null = 자동 (D5: 기본 스킨 cozy-storybook → 펼침, 다른 거 → 접힘. legacy 키는 normalize 후 비교)
   true = 사용자가 접음 / false = 사용자가 펼침 */
let _pbThemeCollapsed = null;
function _getPbThemeCollapsed() {
  if (_pbThemeCollapsed !== null) return _pbThemeCollapsed;
  const t = (typeof normalizePicturebookTheme === 'function')
    ? normalizePicturebookTheme(ViewerState.project.pbTheme)
    : (ViewerState.project.pbTheme || 'cozy-storybook');
  return t !== 'cozy-storybook';
}

/* 2026-05-25 Phase 1: 그림책 편집 패널 우측 세로 길이 축소.
   글자 스타일 / 본문 카드 톤 섹션 collapsible 상태.
   · 기본 펼침 (false). 사용자 클릭 시 true로 토글.
   · module-level 변수 — localStorage 저장 안 함. 새로고침하면 다시 펼침.
   · UI 상태만 — 저장 데이터·작품 내용·감상 화면 영향 없음. */
let _pbInlineStyleCollapsed = false;
let _pbToneCollapsed = false;

/* 2026-05-31 Text-3B: 텍스트형 스타일 패널 섹션 접힘 상태 (UI 표시만, 저장 영향 0).
   · 글자 스타일 = 기본 펼침(주 동선), 테마/효과 = 기본 접힘(패널 길이 정리).
   · module-level — 새로고침하면 default 복귀. localStorage 저장 안 함. */
let _textStyleSecCollapsed  = false;
let _textThemeSecCollapsed  = true;
let _textEffectSecCollapsed = true;

/* 2026-05-27 Phase 4-D-1: 우측 2단 (📝 내용) 접이식 상태.
   · null  — 자동 default. 그림책 일반/엔딩 = 접힘, 표지/외 모드 = 펼침
   · true  — 사용자가 접음 (그림책 일반/엔딩에서만 유효 — 표지/외 모드는 강제 펼침)
   · false — 사용자가 펼침
   localStorage 저장 X — 새로고침 시 default 복귀. */
let _textEditCollapsed = null;

/* ADV-EDIT-ABSORB-TITLE-1: 텍스트형 '제목 추가' 임시 편집 상태 (local only — DB 저장 X).
   · '+ 제목 추가' 칩 클릭 → sceneId 추가 → 재렌더 시 빈 제목도 contenteditable h3로 노출 + focus.
   · 제목 비운 채 blur → 제거 → 다시 칩. 새로고침하면 비워짐(default 칩).
   viewer-render.js의 _textTitleHtml이 이 상태를 읽어 칩/제목칸을 분기. */
const _textTitleDraftScenes = new Set();
function _isTextTitleDraftActive(sceneId) {
  return _textTitleDraftScenes.has(String(sceneId));
}

/* ================================================================
   W7-B: 영상 업로드 (viewer 쪽 자체 정의)
   ─────────────────────────────────────────────────────────────
   viewer.html이 firebase.js를 로드하지 않으므로 (firebase.js는 maker 전용),
   여기서 동일 헬퍼를 자체 정의. firebase-storage-compat.js는 viewer.html이 로드함.
   firebase.storage()는 firebase.initializeApp 후에만 동작 — viewer-state.js에서 init 됨.
   ─────────────────────────────────────────────────────────────
   값 일치 유지 책임: firebase.js의 같은 헬퍼와 동기 (한쪽 변경 시 둘 다 수정). */
const _VIEWER_VIDEO_MAX_BYTES   = 50 * 1024 * 1024;
const _VIEWER_VIDEO_MAX_SECONDS = 60;

function _viewerVideoStoragePath(sceneNum, ctx) {
  /* viewer 컨텍스트에서는 ViewerState에서 classId/teamName을 읽음.
     W7-B 성능 보강: 매 업로드마다 timestamp 부여 → 이전 영상과 다른 경로 →
     · 캐시 충돌 회피 (같은 URL 재사용 시 옛 영상 표시되는 버그 방지)
     · 덮어쓰기 지연(메타데이터 갱신) 회피 → 두번째 업로드 빠름 */
  const cid = (ctx && ctx.classId)
    || (typeof ViewerState !== 'undefined' && ViewerState.classId)
    || (typeof classId !== 'undefined' && classId)
    || '_legacy';
  const tn  = (ctx && ctx.teamName)
    || (typeof ViewerState !== 'undefined' && ViewerState.teamName)
    || (typeof teamName !== 'undefined' && teamName)
    || 'unknown';
  const encodedName = encodeURIComponent(tn);
  /* 옵트인: ctx.timestamp가 명시되면 그 값 사용 (재현성 필요한 경우), 없으면 Date.now() */
  const ts = (ctx && ctx.timestamp) || Date.now();
  return `videos/${cid}/${encodedName}/scene_${sceneNum}_${ts}.mp4`;
}

function _viewerProbeVideoDuration(file) {
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

/* 크롬북 HEVC 감지 (2026-07-10):
   아이폰 "고효율" 녹화 영상은 HEVC(H.265)로 저장되는데 크롬북(ChromeOS)에서 디코딩이 안 돼
   화면이 검게 뜨고 소리만 난다. 업로더 기기(맥/아이패드)는 HEVC를 지원해 재생 테스트로는 못 걸러내므로,
   파일 바이트에서 코덱 식별자(fourcc)를 직접 스캔한다. hvc1/hev1 = HEVC. moov 박스가 파일 끝에 있는
   아이폰 영상까지 잡으려 앞·뒤 청크를 모두 스캔한다. 감지 실패(예외)는 업로드를 막지 않는다(false 반환). */
async function _viewerVideoIsHevc(file) {
  try {
    if (!file) return false;
    const HVC1 = [0x68, 0x76, 0x63, 0x31]; // 'hvc1'
    const HEV1 = [0x68, 0x65, 0x76, 0x31]; // 'hev1'
    const scan = (buf) => {
      const b = new Uint8Array(buf);
      const find = (sig) => {
        outer: for (let i = 0; i + sig.length <= b.length; i++) {
          for (let j = 0; j < sig.length; j++) { if (b[i + j] !== sig[j]) continue outer; }
          return true;
        }
        return false;
      };
      return find(HVC1) || find(HEV1);
    };
    const CHUNK = 4 * 1024 * 1024;
    const head = await file.slice(0, Math.min(CHUNK, file.size)).arrayBuffer();
    if (scan(head)) return true;
    if (file.size > CHUNK) {
      const tail = await file.slice(Math.max(0, file.size - CHUNK)).arrayBuffer();
      if (scan(tail)) return true;
    }
    return false;
  } catch (e) { return false; }
}

async function viewerUploadVideoToStorage(file, sceneNum, opts) {
  /* viewer는 named app 'viewer'를 사용 — default app 아님.
     getViewerDb()와 같은 방식으로 named app에서 storage 가져옴.
     'viewer' app이 아직 init 안 됐으면 getViewerDb 호출로 강제 init. */
  if (typeof firebase === 'undefined' || typeof firebase.app !== 'function') {
    throw new Error('Storage SDK가 로드되지 않았어요. 페이지를 새로고침해주세요.');
  }
  let storage;
  let viewerApp;
  /* POLISH-AUTH-FIX: 편집 세션은 default app(maker UID), 그 외엔 named 'viewer' — getViewerApp로 통일. */
  try {
    viewerApp = (typeof getViewerApp === 'function') ? getViewerApp() : firebase.app('viewer');
  } catch (e) {
    /* app 미초기화 → getViewerDb로 강제 init (viewer-data.js의 패턴) */
    if (typeof getViewerDb === 'function') {
      try {
        getViewerDb();
        viewerApp = (typeof getViewerApp === 'function') ? getViewerApp() : firebase.app('viewer');
      } catch (e2) {
        throw new Error('Firebase 앱이 초기화되지 않았어요. 페이지를 새로고침해주세요.');
      }
    } else {
      throw new Error('Firebase 앱이 초기화되지 않았어요. 페이지를 새로고침해주세요.');
    }
  }
  if (typeof viewerApp.storage !== 'function') {
    throw new Error('Storage SDK가 로드되지 않았어요. 페이지를 새로고침해주세요.');
  }
  storage = viewerApp.storage();
  if (!file) throw new Error('파일이 선택되지 않았어요.');
  if (!file.type || !file.type.startsWith('video/')) {
    throw new Error('영상 파일이 아니에요. mp4 파일을 선택해주세요.');
  }
  if (file.size > _VIEWER_VIDEO_MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    throw new Error(`파일이 너무 커요 (${mb}MB). 50MB 이내 영상만 가능해요.`);
  }
  const dur = await _viewerProbeVideoDuration(file);
  if (dur > _VIEWER_VIDEO_MAX_SECONDS + 0.5) {
    throw new Error(`영상이 너무 길어요 (${dur.toFixed(1)}초). 60초 이내 영상만 가능해요.`);
  }

  /* anonymous auth 보장 — Storage 규칙의 auth != null 충족.
     POLISH-AUTH-FIX: 편집 세션에선 maker UID(복원됨)를 쓰고 새 익명 로그인 금지
     (default app의 maker UID를 덮어쓰면 권한이 깨진다). */
  try {
    if (typeof viewerApp.auth === 'function') {
      const auth = viewerApp.auth();
      if (!auth.currentUser && !(typeof isEditViewerSession === 'function' && isEditViewerSession())) {
        try { await auth.signInAnonymously(); }
        catch (e) { /* 인증 실패해도 일단 시도 */ }
      }
    }
  } catch (e) { /* auth 없어도 진행 — Storage 규칙이 막으면 reject */ }

  const storagePath = _viewerVideoStoragePath(sceneNum, opts || {});
  const ref = storage.ref(storagePath);
  const onProgress = opts && typeof opts.onProgress === 'function' ? opts.onProgress : null;

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

/* ================================================================
   v114: 이미지 업로드 (viewer 쪽 자체 정의)
   ─────────────────────────────────────────────────────────────
   배경: 다듬기 모드에서 일어나는 이미지 업로드 흐름 (그림책 그림 / 무비 포스터 /
   그림 그리기 캔버스 저장)이 옛엔 base64 → RTDB 저장. v114부터 Storage 사용.
   firebase.js의 uploadImageToStorage와 같은 패턴 — viewer named app 사용.
   값 일치 유지 책임: firebase.js _imageStoragePath / uploadImageToStorage와 동기.
   ──────────────────────────────────────────────────────────────── */
const _VIEWER_IMAGE_MAX_BYTES = 6 * 1024 * 1024;

/* S2-2A-FIX1: 충돌 불가능한 고유 ID(crypto.randomUUID 우선, 미지원 fallback). */
function _viewerUniqueId() {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
  return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
function _viewerImageStoragePath(sceneNum, ctx, ext) {
  const cid = (ctx && ctx.classId)
    || (typeof ViewerState !== 'undefined' && ViewerState.classId)
    || (typeof classId !== 'undefined' && classId)
    || '_legacy';
  const tn  = (ctx && ctx.teamName)
    || (typeof ViewerState !== 'undefined' && ViewerState.teamName)
    || (typeof teamName !== 'undefined' && teamName)
    || 'unknown';
  const encodedName = encodeURIComponent(tn);
  /* S2-2A-FIX1: 신규 원본은 매 저장마다 *고유 객체* → 기존 Storage 객체 절대 overwrite 안 함(원본 보호).
     세그먼트 안전화. format은 functions/image-s2-policy.js buildImageStoragePath와 동일.
     기존 deterministic URL(scene_{N}.ext)은 scene.imageData에 저장돼 있어 그대로 읽힘(마이그레이션 없음). */
  const safe = (v, def) => { const s = String(v == null ? '' : v).replace(/[.#$\[\]\/\x00-\x1F\x7F]/g, '').replace(/\.\./g, ''); return s || def; };
  const e = /^(jpg|jpeg|png|webp)$/.test(String(ext)) ? String(ext) : 'jpg';
  return `images/${safe(cid, '_legacy')}/${safe(encodedName, 'unknown')}/${safe(sceneNum, 'scene')}/${_viewerUniqueId()}.${e}`;
}

function _viewerExtFromMime(mime) {
  return ({ 'image/png':'png','image/jpeg':'jpg','image/jpg':'jpg','image/gif':'gif','image/webp':'webp' })[mime] || 'jpg';
}

function _viewerDataUrlToBlob(dataUrl) {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('data URL 형식이 아니에요.');
  const mime = m[1];
  const bin = atob(m[2]);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

async function viewerUploadImageToStorage(input, sceneNum, opts) {
  if (typeof firebase === 'undefined' || typeof firebase.app !== 'function') {
    throw new Error('Storage SDK가 로드되지 않았어요. 페이지를 새로고침해주세요.');
  }
  let viewerApp;
  /* POLISH-AUTH-FIX: 편집 세션은 default app(maker UID) — getViewerApp로 통일. */
  try {
    viewerApp = (typeof getViewerApp === 'function') ? getViewerApp() : firebase.app('viewer');
  } catch (e) {
    if (typeof getViewerDb === 'function') {
      try { getViewerDb(); viewerApp = (typeof getViewerApp === 'function') ? getViewerApp() : firebase.app('viewer'); }
      catch (e2) { throw new Error('Firebase 앱이 초기화되지 않았어요.'); }
    } else { throw new Error('Firebase 앱이 초기화되지 않았어요.'); }
  }
  if (typeof viewerApp.storage !== 'function') {
    throw new Error('Storage SDK가 로드되지 않았어요.');
  }
  const storage = viewerApp.storage();

  /* dataUrl 또는 Blob 받음 */
  let blob;
  if (typeof input === 'string' && input.startsWith('data:')) {
    blob = _viewerDataUrlToBlob(input);
  } else if (input instanceof Blob) {
    blob = input;
  } else {
    throw new Error('지원하지 않는 이미지 형식이에요.');
  }
  if (!blob.type || !blob.type.startsWith('image/')) {
    throw new Error('이미지 파일이 아니에요.');
  }
  if (blob.size > _VIEWER_IMAGE_MAX_BYTES) {
    const mb = (blob.size / 1024 / 1024).toFixed(1);
    throw new Error(`이미지가 너무 커요 (${mb}MB). 6MB 이내만 가능해요.`);
  }

  /* anonymous auth — POLISH-AUTH-FIX: 편집 세션은 maker UID 사용, 새 익명 로그인 금지. */
  try {
    if (typeof viewerApp.auth === 'function') {
      const auth = viewerApp.auth();
      if (!auth.currentUser && !(typeof isEditViewerSession === 'function' && isEditViewerSession())) {
        try { await auth.signInAnonymously(); } catch (e) {}
      }
    }
  } catch (e) {}

  const ext = _viewerExtFromMime(blob.type);
  const storagePath = _viewerImageStoragePath(sceneNum, opts || {}, ext);
  const ref = storage.ref(storagePath);
  await ref.put(blob, {
    contentType: blob.type,
    cacheControl: 'public, max-age=31536000',
  });

  /* 2026-05-22 fix: GCS direct URL은 신규 업로드 시 public ACL이 없어서
     HTTP 403이 남 (옛 마이그 작품만 ACL이 걸려 있음).
     ref.getDownloadURL()로 토큰이 포함된 Firebase Storage URL을 받아 어디서든 접근 가능. */
  let downloadURL;
  try {
    downloadURL = await ref.getDownloadURL();
  } catch (e) {
    /* fallback — 옛 GCS direct URL. 옛 마이그 작품 호환용. */
    const bucket = storage.app.options.storageBucket || `${storage.app.options.projectId}.firebasestorage.app`;
    downloadURL = `https://storage.googleapis.com/${bucket}/${storagePath}`;
  }
  return { downloadURL, storagePath };
}

/* ════════════════════════════════════════════════════════════════
   S2-2A-FIX1 — 저장 전 sourceMode 게이트 / lock 실패 시 사용자 안내(읽기 전용 메시지).
   ──────────────────────────────────────────────────────────────
   gate-first 흐름: (사전게이트)→ 고유경로 업로드 → (서버 lock) → ok일 때만 scene.imageData 기록.
   따라서 패자는 scene을 애초에 쓰지 않아 승자/기존 이미지 유실이 구조적으로 불가(C1/C2 제거).
   이 함수는 차단/실패 코드를 사용자 안내로 변환만 한다(데이터 변경 없음). ═══════════════════════ */
function _notifySourceModeBlock(res) {
  if (!res || !res.code) return;
  let msg;
  if (res.code === 'SOURCE_MODE_CONFLICT') {
    const other = (res.currentSourceMode === 'upload') ? '‘파일 올리기’' : '‘직접 그리기’';
    /* SOURCE-MODE-RESIDUAL-FIX(2026-07-16): "다 지웠는데 안 바뀐다"의 실제 원인은 안 보이는 다른
       장면(특히 안 가본 갈래)에 그림이 남아 있는 것 → 어디를 지워야 하는지 안내 추가. */
    msg = '이 작품은 이미 ' + other + ' 방식으로 시작했어요. 다른 방식으로 바꾸려면 모든 장면(안 보이는 다른 갈래 장면까지) 그림을 먼저 다 지워야 해요. 그림이 하나도 안 남으면 방식을 바꿀 수 있어요. (방금 고른 그림은 저장하지 않았어요.)';
  } else if (res.code === 'CORRUPT_IMAGE_POLICY') {
    msg = '이 작품의 이미지 입력 방식 설정에 문제가 있어요. 선생님께 알려주세요.';
  } else {
    msg = '지금은 그림을 저장할 수 없어요. 잠시 후 다시 시도해 주세요.';
  }
  /* DRAW-BLOCK-ASYNC(2026-07-09): 동기 alert()는 메인 스레드를 정지시켜(대형 캔버스 위) '굳음'을 유발 →
     비동기 토스트(showAiToast, viewer-ai의 동일 차단 안내 패턴)로. 미로드 시 confirm 카드, 그것도 없으면 alert 폴백. */
  try {
    if (typeof showAiToast === 'function') showAiToast(msg);
    else if (typeof showViewerConfirm === 'function') showViewerConfirm({ title: '알림', message: msg, confirmText: '확인' });
    else alert(msg);
  } catch (e) { try { alert(msg); } catch (e2) {} }
}

/* SOURCE-MODE-SWITCH(2026-07-16): 그리기↔업로드 방식 잠금에 막혔을 때 학생이 직접 "그림 다 지우고 바꾸기".
   서버가 전 장면(표지·안 가본 갈래)·AI 이미지 변형·잠금을 원자적으로 비운다(자기 모둠 학생 권한).
   파괴적이라 강한 확인 1회. 성공 시 로컬 scenes도 정리+리렌더 → 학생이 다시 올리면 새 방식으로 잠김.
   반환 true=바꿈. 스위치 콜러블 미로드/실패면 false(호출부가 기존 안내로 폴백 가능). */
async function _offerSwitchSourceMode(res) {
  const other = (res && res.currentSourceMode === 'upload') ? '‘파일 올리기’' : '‘직접 그리기’';
  let ok = false;
  try {
    ok = await showViewerConfirm({
      title: '방식을 바꿀까요?',
      message: '이 작품은 지금 ' + other + ' 방식으로 되어 있어요.\n다른 방식으로 바꾸려면 지금까지 올리거나 그린 그림(AI로 마감한 그림 포함)이 모두 지워져요. 되돌릴 수 없어요.\n\n그래도 바꿀까요?',
      confirmText: '그림 다 지우고 바꾸기',
      cancelText: '아니요',
      danger: true,
    });
  } catch (e) { ok = false; }
  if (!ok) return false;
  let r = null;
  try {
    if (window.viewerAi && typeof window.viewerAi.clearImagesAndSwitchSourceMode === 'function') {
      r = await window.viewerAi.clearImagesAndSwitchSourceMode();
    }
  } catch (e) { r = null; }
  if (!r || r.ok !== true) {
    const failMsg = '지금은 바꾸지 못했어요. 잠시 후 다시 해주세요.';
    try { if (typeof showAiToast === 'function') showAiToast(failMsg); else alert(failMsg); } catch (e) {}
    return false;
  }
  /* 로컬 scenes도 즉시 정리(실시간 구독 여부와 무관하게 UI 일관) */
  try {
    const sc = (typeof ViewerState !== 'undefined' && ViewerState && ViewerState.scenes) ? ViewerState.scenes : null;
    if (sc) Object.keys(sc).forEach((k) => { const s = sc[k]; if (s) { if (s.imageData) s.imageData = null; if (s.imageUrl) s.imageUrl = null; } });
  } catch (e) {}
  try { if (typeof renderEditPanel === 'function') renderEditPanel(); } catch (e) {}
  try { if (typeof _scheduleViewerFrameReRender === 'function') _scheduleViewerFrameReRender(); } catch (e) {}
  const doneMsg = '그림을 모두 지웠어요. 이제 원하는 방식으로 그림을 올리거나 그릴 수 있어요.';
  try { if (typeof showAiToast === 'function') showAiToast(doneMsg); else alert(doneMsg); } catch (e) {}
  return true;
}

/* ════════════════════════════════════════════════════════════════
   S2-2A-FIX2 — lock 성공 후 scene flush 결과 처리(업로드·그림판 공통). flush 성공이면 true.
   ──────────────────────────────────────────────────────────────
   flush 실패(`_flushPendingSave`가 {ok:false} 반환)면:
   ① 재큐된 실패 imageData 제거(catch가 pendingFields에 재병합 → 잘못 재실행 방지. imageData만, 타 필드 보존)
   ② 로컬 scene.imageData 복원(현재값이 *이번 시도 url*일 때만 before로 — 다른 비동기 변경이면 보존)
   ③ 이번 시도 고유 객체만 cleanup(viewer-ai _deleteImageStorage: images/ prefix 검증·URL 역추정 0)
   sourceMode lock은 유지(동일 mode 재시도로 복구). 결정 로직은 functions/image-s2-policy.js
   decideFlushFailureRecovery와 동일. 성공으로 표시하지 않고 false 반환(호출부가 모달/팝오버 유지). */
async function _handleImageFlushResult(scene, beforeImageData, attemptUrl, storagePath, flushRes) {
  if (!(flushRes && flushRes.ok === false)) return true;   /* 성공 또는 skip(undefined) → 정상 진행 */
  try {
    if (_editText.pendingFields && _editText.pendingFields.imageData === attemptUrl) {
      delete _editText.pendingFields.imageData;            /* ① 재큐된 실패 imageData만 제거 */
    }
  } catch (e) { /* noop */ }
  if (scene && scene.imageData === attemptUrl) {           /* ② 로컬 CAS 복원 */
    scene.imageData = (beforeImageData != null) ? beforeImageData : null;
  }
  try {                                                    /* ③ 이번 고유 객체만 cleanup */
    if (storagePath && typeof window !== 'undefined' && window.viewerAi &&
        typeof window.viewerAi._deleteImageStorage === 'function') {
      await window.viewerAi._deleteImageStorage(storagePath);
    }
  } catch (e) { console.warn('[S2-2A-FIX2] flush 실패 후 cleanup 실패(orphan)', e && e.message); }
  if (typeof renderEditPanel === 'function') renderEditPanel();
  if (typeof _scheduleViewerFrameReRender === 'function') _scheduleViewerFrameReRender();
  try { alert('그림을 저장하지 못했어요. 잠시 후 같은 방식으로 다시 시도해 주세요.'); } catch (e) {}
  return false;
}

async function viewerDeleteVideoFromStorage(storagePath) {
  if (typeof firebase === 'undefined' || typeof firebase.app !== 'function') return false;
  if (!storagePath) return false;
  try {
    let viewerApp;
    /* POLISH-AUTH-FIX: 편집 세션은 default app(maker UID) — getViewerApp로 통일. */
    try { viewerApp = (typeof getViewerApp === 'function') ? getViewerApp() : firebase.app('viewer'); }
    catch (e) {
      if (typeof getViewerDb === 'function') {
        getViewerDb();
        viewerApp = (typeof getViewerApp === 'function') ? getViewerApp() : firebase.app('viewer');
      } else return false;
    }
    if (typeof viewerApp.storage !== 'function') return false;
    await viewerApp.storage().ref(storagePath).delete();
    return true;
  } catch (e) {
    return false;
  }
}

/* ── W4-D: 모드별 선택지 라벨 max 글자수 ──
   maker(state.js)와 동일한 정책. viewer.html은 state.js를 로드 안 하므로
   여기서 자체 정의 (값 일치 유지 책임은 양쪽 동기 — 변경 시 둘 다 수정).
   getChoiceLabelMax가 전역에 이미 있으면 그것을 우선 사용.
   ─────────────────────────────────────────────────────────────
   · picturebook 30 : A4 컨테이너의 짧은 한 줄 (mockup 기준)
   · text         60 : 영역 큼
   · movie        30 : 결정 패널 좁음
   · experience   20 : 학교 지도 mockup의 짧은 라벨 */
const _CHOICE_LABEL_MAX_BY_MODE_VIEWER = {
  text:        60,
  picturebook: 30,
  movie:       30,
  experience:  20,
};
const _CHOICE_LABEL_MAX_DEFAULT_VIEWER = 30;
function _getChoiceLabelMaxViewer(mode) {
  /* 전역 getChoiceLabelMax가 정의돼 있으면 그것을 사용 (state.js와 일치 보장) */
  if (typeof getChoiceLabelMax === 'function') {
    try { return getChoiceLabelMax(mode); } catch (e) { /* fall-through */ }
  }
  if (mode && Object.prototype.hasOwnProperty.call(_CHOICE_LABEL_MAX_BY_MODE_VIEWER, mode)) {
    return _CHOICE_LABEL_MAX_BY_MODE_VIEWER[mode];
  }
  return _CHOICE_LABEL_MAX_DEFAULT_VIEWER;
}

/* ── viewer-frame만 재렌더 — edit-panel은 보존 (포커스 보호 핵심) ── */
function _scheduleViewerFrameReRender() {
  if (_editText.rafPending) return;
  _editText.rafPending = true;
  requestAnimationFrame(() => {
    _editText.rafPending = false;
    const scene = ViewerState.scenes[ViewerState.currentSceneId];
    if (scene && typeof renderScene === 'function') {
      /* 다듬기 미리보기 재렌더(=뭐 누를 때마다 갱신)는 같은 장면 갱신이라
         장면 전환 애니메이션을 억제한다(어지럼 방지). 실제 장면 이동은
         renderCurrentScene 경로라 이 함수를 거치지 않아 전환이 그대로 유지된다. */
      window.__pbEditPreviewRerender = true;
      try { renderScene(scene); }
      finally { window.__pbEditPreviewRerender = false; }
    }
  });
}

/* ================================================================
   W7 깜빡임 차단: 부분 업데이트 헬퍼
   ─────────────────────────────────────────────────────────────
   _scheduleViewerFrameReRender는 stage.innerHTML 통째 교체라 매번 깜빡임 발생.
   대신 입력 종류별로 DOM 부분만 갱신 → 통째 재렌더 회피.
   ─────────────────────────────────────────────────────────────
   사용 패턴:
     · 텍스트 스타일 변경 → _patchTextStyle()
     · 텍스트 테마 변경 → _patchTextTheme()
     · 텍스트 효과 변경 → _patchTextEffect()
     · 무비형 captionMode → _patchMovieAttr('caption', value)
     · 무비형 choiceReveal → _patchMovieAttr('reveal', value)
     · 체험전시형 오브젝트 이동 → _patchConnectObject(id, fields)
     · 본문/제목 입력 → _patchSceneText(field, value)
     · 선택지 라벨 → _patchChoiceLabel(idx, value)
   해당 노드 못 찾으면 silently noop — 다음 통째 재렌더 때 정합성 회복.
   ================================================================ */

function _getSceneScreen() {
  return document.querySelector('#viewer-frame .scene-screen');
}

/* TEXT-FONT-MAP-VIEWER(2026-07-09): TEXT_FONT_FAMILIES 정의는 viewer-data.js(감상에 항상 로드)로 이동함.
   여기서는 bare 이름으로 참조만(감상/편집/인쇄 모두 동일 맵). 편집 번들 미로드 감상에서 폰트가 안 따라오던 문제 해소. */

/* 텍스트형 — CSS 변수/속성만 갱신 */
function _patchTextStyle() {
  const screen = _getSceneScreen();
  if (!screen || !screen.classList.contains('scene-screen--text')) return false;
  const scene = ViewerState.scenes[ViewerState.currentSceneId];
  if (!scene) return false;
  const style = (typeof getTextStyle === 'function') ? getTextStyle(scene) : (scene.textStyle || {});
  /* 2026-05-31 Text-3A: 라이브 패치 CSS 변수 이름을 렌더(_renderSceneText)/CSS와 일치시킴.
     옛 패치는 CSS가 안 읽는 이름(--text-font-family / --text-fw-body)에 값을 써서 폰트·굵기
     즉시 반영이 안 됐음(재렌더 때만 적용). 색(--text-color-override)·크기(--text-fs-body)는
     원래 이름이 맞아 즉시 반영됐음.
     · 폰트 : --text-ff      (CSS .text-card font-family + 테마별 폰트 룰이 읽음)
     · 굵기 : --text-weight  (CSS .text-card font-weight가 읽음) */
  /* T-THEME-1: 명시 폰트만 --text-ff. null/'auto'(테마 기본) → 제거 → CSS 테마 기본폰트 적용. */
  if (style.fontFamily && style.fontFamily !== 'auto') {
    screen.style.setProperty('--text-ff', `var(--font-${style.fontFamily})`);
  } else {
    screen.style.removeProperty('--text-ff');
  }
  if (typeof style.fontSize === 'number') {
    screen.style.setProperty('--text-fs-body', style.fontSize + 'px');
  }
  if (style.color) {
    screen.style.setProperty('--text-color-override', style.color);
  } else {
    screen.style.removeProperty('--text-color-override');
  }
  if (style.weight) {
    screen.style.setProperty('--text-weight', style.weight);
  } else {
    screen.style.removeProperty('--text-weight');
  }
  return true;
}

function _patchTextTheme() {
  const screen = _getSceneScreen();
  if (!screen || !screen.classList.contains('scene-screen--text')) return false;
  const scene = ViewerState.scenes[ViewerState.currentSceneId];
  if (!scene) return false;
  const theme = (typeof getTextTheme === 'function') ? getTextTheme(scene) : (scene.textTheme || 'classic');
  screen.setAttribute('data-text-theme', theme);
  return true;
}

function _patchTextEffect() {
  const screen = _getSceneScreen();
  if (!screen || !screen.classList.contains('scene-screen--text')) return false;
  const scene = ViewerState.scenes[ViewerState.currentSceneId];
  if (!scene) return false;
  const eff = (typeof getTextEffect === 'function') ? getTextEffect(scene) : (scene.textEffect || {});
  if (eff.entrance) screen.setAttribute('data-text-entrance', eff.entrance);
  if (eff.body)     screen.setAttribute('data-text-body',     eff.body);
  return true;
}

/* 무비형 — 속성만 토글 (CSS가 그 속성으로 시각 분기) */
function _patchMovieAttr(kind, value) {
  const screen = _getSceneScreen();
  if (!screen || !screen.classList.contains('scene-screen--movie')) return false;
  const attrMap = {
    caption: 'data-movie-caption',
    reveal:  'data-movie-reveal',
    body:    'data-body-enabled',
  };
  const attr = attrMap[kind];
  if (!attr) return false;
  screen.setAttribute(attr, value);
  return true;
}

/* 본문 텍스트 부분 갱신 — viewer 미리보기에 본문 노드만 갈아끼움.
   W8: 체험전시형 본문 노드 (.exp-body-panel p) 추가 — viewer-render.js 정합. */
/* Phase 4-A: AI 변형(s1/s2) 보기 중인지. true면 원본 scenes/{id} 편집/저장을 전면 차단.
   original 보기에서는 기존 편집/저장 흐름 그대로. */
function _isVariantViewLocked() {
  try {
    return !!(typeof window !== 'undefined' && window.viewerAi
      && typeof window.viewerAi._isAiVariantViewMode === 'function'
      && window.viewerAi._isAiVariantViewMode());
  } catch (e) { return false; }
}

/* ─── P4-D-2B-FIX2: variant style 안정 scene key ──────────────────────────────
   variant 저장(_queueVariantStyleSave)·조회(_getDisplayStyle)·렌더(viewer-render.js)는
   모두 scene.id를 키로 쓴다(adaptScenes: id = String(raw.num)). 저장↔렌더 키가
   반드시 일치해야 하므로 **scene.id 우선**, 없을 때만 num/currentSceneId로 fallback.
   (viewer scene 객체엔 num 필드가 없어 사실상 scene.id로 수렴) */
function _variantStyleSceneId(scene) {
  if (!scene) return null;
  const cand = (scene.id != null) ? scene.id
    : (scene.num != null) ? scene.num
    : ((typeof ViewerState !== 'undefined' && ViewerState.currentSceneId != null)
        ? ViewerState.currentSceneId : null);
  if (cand == null || cand === '') return null;
  return String(cand);
}

/* P4-D-2B-FIX4: 현재 보기 모드(원본/aiS1/aiS2)에서 '표시할 글자 크기' 한 값을 돌려준다.
   · 원본 보기 → _getDisplayStyle가 originalStyle을 그대로 반환 → 원본 fontSize.
   · aiS1/aiS2 보기 → variant style(FB→local) fontSize, 없으면 원본 fallback.
   슬라이더 value/라벨(편집 패널)과 본문 CSS 변수(_patchVariantFontSize)가 같은 출처를 쓰게 해
   모드 전환 후 슬라이더↔본문 값이 어긋나는 문제를 막는다. 원본 scene.textStyle은 읽기만 한다.
   viewerAi 미로딩/타입 이상 시 원본 fontSize로 안전 fallback. */
function _displayFontSize(scene, originalStyle) {
  const orig = originalStyle || {};
  const ai = (typeof window !== 'undefined') ? window.viewerAi : null;
  const sid = _variantStyleSceneId(scene);
  let disp = orig;
  if (ai && typeof ai._getDisplayStyle === 'function' && sid != null) {
    disp = ai._getDisplayStyle(sid, orig) || orig;
  }
  const fs = disp && disp.fontSize;
  if (typeof fs === 'number' && !isNaN(fs)) return fs;
  return (typeof orig.fontSize === 'number' && !isNaN(orig.fontSize)) ? orig.fontSize : null;
}

/* P4-D-2B-FIX2: variant 보기에서 '글자 크기'만 즉시 화면 반영.
   _patchTextStyle/_patchPbStyle은 원본 getTextStyle(scene)을 읽으므로 variant 값엔 쓸 수 없다.
   여기선 변형 fontSize를 현재 .scene-screen의 CSS 변수에 직접 설정해 슬라이더 조작이 즉시 보이게 한다.
   원본 scene.textStyle은 읽지도 쓰지도 않는다(원본 오염 0). 화면 타입은 클래스로 판별. */
function _patchVariantFontSize(fontSize) {
  if (typeof fontSize !== 'number' || isNaN(fontSize)) return false;
  const screen = _getSceneScreen();
  if (!screen) return false;
  if (screen.classList.contains('scene-screen--text')) {
    screen.style.setProperty('--text-fs-body', fontSize + 'px');
    return true;
  }
  if (screen.classList.contains('scene-screen--pb')) {
    screen.style.setProperty('--pb-fs-body', fontSize + 'px');
    return true;
  }
  return false;
}

/* P4-D-2B-FIX4: 보기 모드(원본/aiS1/aiS2) 전환 직후 동기화.
   _setAiViewMode는 본문(viewer-frame)만 재렌더하고 편집 패널은 재렌더하지 않으므로,
   글자 크기 슬라이더 DOM 값/라벨이 직전 모드 값에 머물러 본문↔슬라이더가 어긋난다(FIX4 핵심 증상).
   현재 모드의 표시 fontSize로 (1) 슬라이더 value + (NNpx) 라벨을 다시 맞추고,
   (2) 본문 CSS 변수도 재렌더 직후 한 번 더 설정해 본문도 같은 값으로 보장한다.
   원본 scene.textStyle은 읽기만 하고 절대 수정하지 않는다. 패널/슬라이더 없으면 조용히 패스. */
function _resyncFontSizeUiToViewMode() {
  if (typeof ViewerState === 'undefined' || !ViewerState.scenes) return;
  const scene = ViewerState.scenes[ViewerState.currentSceneId];
  if (!scene) return;
  const orig = (typeof getTextStyle === 'function') ? getTextStyle(scene) : (scene.textStyle || {});
  const fs = _displayFontSize(scene, orig);
  if (typeof fs !== 'number' || isNaN(fs)) return;
  /* (1) 글자 크기 슬라이더 + 라벨 동기화 (DOM 그대로 유지되므로 직접 갱신).
     GLYPH-STYLE-1A: #edit-panel 단일 의존 제거 → 문서 전체의 .js-edit-text-size /
     .js-edit-pb-size를 모두 동기화(향후 🎭 장면 스타일 팝오버 슬라이더가 생겨도 자동 포함).
     저장/이벤트 바인딩 없음 — 슬라이더 value + (Npx) 라벨만 갱신(PB-IMAGE-1A와 동일 안전 패턴). */
  const sliders = (typeof document !== 'undefined')
    ? Array.from(document.querySelectorAll('.js-edit-text-size, .js-edit-pb-size'))
    : [];
  sliders.forEach(function (slider) {
    slider.value = String(fs);
    const row = (typeof slider.closest === 'function') ? slider.closest('.edit-row') : null;
    const note = row ? row.querySelector('.edit-label-note') : null;
    if (note) note.textContent = '(' + fs + 'px)';
  });
  /* (2) 본문 CSS 변수 보강 — _scheduleViewerFrameReRender(rAF)가 새 .scene-screen을 만든 '뒤'에
     적용돼야 하므로 rAF로 한 틱 미룬다(FIFO: 재렌더 rAF가 먼저, 이 patch가 뒤). 원본 모드면
     fs=원본값이라 동일값 재설정(무해), variant 모드면 표시 variant값으로 본문 강제 동기화. */
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(function () { _patchVariantFontSize(fs); });
  } else {
    _patchVariantFontSize(fs);
  }
}

/* ─── Phase 4-D-2B(+FIX): variant 보기(aiS1/aiS2)에서는 '글자 크기'만 편집 ──────────
   핵심 안전망. 스타일 핸들러(폰트/크기/색/굵기)의 "원본 경로"(scene.textStyle 직접 수정 +
   _queueSave(...,{textStyle})) 진입 전에 이 함수를 호출한다.

   P4-D-2B-FIX 설계 변경:
   · variant 보기에서 허용 = fontSize(글자 크기) **단 하나**. fontFamily/color/weight는 잠금.
   · fontSize는 그 장면에 s1/s2 본문 후보가 없어도 조정 가능(style stub만 저장, body 생성 X).
   · fontFamily/color/weight 시도 시 저장도·원본 오염도 없이 차단하고 안내만 한다.

   반환값 의미:
   · false → 원본 보기 → 호출부가 기존(원본) 경로를 그대로 진행해도 됨.
   · true  → variant 보기 → 원본 경로를 절대 타면 안 됨(호출부는 즉시 return).
             - fontSize 패치 + 편집 가능 상황: variant 저장 경로(_queueVariantStyleSave)로 저장 + 재렌더.
             - fontFamily/color/weight 패치: no-op(저장 X) + 안내. 원본으로 fallback 금지.

   원본 scene.textStyle은 절대 건드리지 않는다. base는 현재 표시 중인 variant style
   (_getDisplayStyle: FB→local→원본 fallback)을 복제해 fontSize만 덮어쓴다 → 항상 새 객체. */
function _applyVariantStyleOrBlock(scene, patch, onApply) {
  if (!scene) return false;
  if (!_isVariantViewLocked()) return false;   /* 원본 보기 → 기존 경로 진행 */
  const ai = (typeof window !== 'undefined') ? window.viewerAi : null;

  /* 허용 필드는 fontSize 단 하나. (patch가 정확히 {fontSize} 형태일 때만) */
  const keys = patch ? Object.keys(patch) : [];
  const isFontSizeOnly = keys.length === 1 && keys[0] === 'fontSize';

  if (!isFontSizeOnly) {
    /* fontFamily/color/weight 등 — variant 저장 안 함 + 원본 경로 차단 + 안내만. */
    if (ai && typeof ai._showVariantSaveStatus === 'function') {
      ai._showVariantSaveStatus('AI 문장에서는 글자 크기만 조정할 수 있어요.', 2500);
    }
    return true;
  }

  /* fontSize 전용 게이트 — 후보 없는 장면에서도 stub 저장 허용(editMode + text/pb + aiS1/aiS2). */
  const sid = _variantStyleSceneId(scene);
  const vk = (ai && typeof ai._aiVariantFontSizeEditAllowed === 'function' && sid != null)
    ? ai._aiVariantFontSizeEditAllowed(sid) : null;
  if ((vk === 's1' || vk === 's2') && sid != null) {
    const orig = (typeof getTextStyle === 'function') ? getTextStyle(scene) : (scene.textStyle || {});
    let base = orig;
    if (ai && typeof ai._getDisplayStyle === 'function') {
      base = ai._getDisplayStyle(sid, orig) || orig;
    }
    /* base(원본/표시 variant style) 위에 fontSize만 덮어쓴 새 객체.
       fontFamily/color/weight는 base 그대로 유지(잠긴 컨트롤 값 주입 방지). base는 미변경. */
    const next = Object.assign(
      { fontFamily: 'gothic', fontSize: 16, color: '', weight: 'normal' },
      base || {}, patch
    );
    if (typeof ai._queueVariantStyleSave === 'function') {
      ai._queueVariantStyleSave(vk, sid, next);
    }
    if (typeof onApply === 'function') { try { onApply(); } catch (e) { /* noop */ } }
    /* P4-D-2B-FIX3: 즉시 화면 반영 — variant fontSize를 현재 .scene-screen CSS 변수에 직접 설정.
       원본 경로(_patchTextStyle)와 100% 동일하게 "CSS 변수 패치 성공 시 통째 재렌더 안 함".
       ── FIX2의 버그: 패치 후 _scheduleViewerFrameReRender를 '무조건' 호출했는데, 이 함수는
       renderScene→_stageReplaceScene으로 **1.2초(_sceneTransMs(50)=1200ms) 장면 전환 애니메이션**을
       일으킨다. 슬라이더를 움직일 때마다 화면이 통째로 전환돼(잠깐 바뀐 뒤 전환되며 원래대로 보이고
       PB는 무거운 레이아웃 전환에 변경이 묻혀 "적용 안 됨"처럼 보였다).
       ── 수정: _patchVariantFontSize가 성공(true)하면 재렌더하지 않는다. CSS 변수는 즉시 적용되고,
       버퍼(_fbTextVariantStyles/localStorage final.style)가 이후 실제 재렌더(장면 이동/F5)에서
       _getDisplayStyle로 동일 값을 복원하므로 통째 재렌더는 불필요. 패치 실패(노드 없음/타입 불일치/NaN)일
       때만 재렌더 fallback. (_patchTextStyle/_patchPbStyle은 원본 style을 읽어 variant 값엔 못 쓰므로 전용 패치 사용.) */
    const _vPatched = (typeof next.fontSize === 'number') ? _patchVariantFontSize(next.fontSize) : false;
    if (!_vPatched && typeof _scheduleViewerFrameReRender === 'function') _scheduleViewerFrameReRender();
  }
  /* vk null(편집 불가)·sid 없음 → no-op(저장·원본 fallback 없음). 어느 쪽이든 true → 원본 경로 차단. */
  return true;
}

function _patchSceneBody(value) {
  /* Phase 4-A: s1/s2 보기 중엔 원본 본문 in-memory 갱신 금지. false 반환 → 호출부가 재렌더(변형 본문 복원). */
  if (_isVariantViewLocked()) return false;
  const screen = _getSceneScreen();
  if (!screen) return false;
  /* 모드별 본문 노드 위치 — 4모드 모두 커버 (+ v78: 엔딩 .ending-user-body 추가) */
  const bodyNode =
       screen.querySelector('.text-card__body')
    || screen.querySelector('.pb-text__body')
    || screen.querySelector('.movie-decision__desc')
    || screen.querySelector('.movie-ending-body')   /* 2026-06-02: 무비 엔딩 본문 직접입력 동기 보강 */
    || screen.querySelector('.exp-body-panel p')
    || screen.querySelector('.ending-user-body');
  if (!bodyNode) {
    /* 체험전시형은 본문이 비어있다가 입력 시작 시 DOM에 없을 수 있음.
       이 경우 통째 재렌더 폴백이 필요 (false 반환). */
    return false;
  }
  /* contenteditable element 활성 입력 중이면 textContent 덮어쓰기 skip (커서 위치 보호) */
  if (bodyNode.isContentEditable && document.activeElement === bodyNode) {
    return true;   /* 자체 input 이벤트로 이미 동기화 */
  }
  bodyNode.textContent = value || '';
  /* placeholder 클래스 갱신 */
  if (bodyNode.hasAttribute('data-placeholder')) {
    bodyNode.classList.toggle('is-empty', !(value || '').trim());
  }
  return true;
}

function _patchSceneTitle(value) {
  const screen = _getSceneScreen();
  if (!screen) return false;
  const titleNode =
       screen.querySelector('.text-card__title')
    || screen.querySelector('.pb-text__title')
    || screen.querySelector('.pb-stage__title-overlay')
    || screen.querySelector('.exp-top__title');
  if (!titleNode) return false;
  /* contenteditable 활성 입력 중이면 skip */
  if (titleNode.isContentEditable && document.activeElement === titleNode) {
    return true;
  }
  titleNode.textContent = value || '';
  if (titleNode.hasAttribute('data-placeholder')) {
    titleNode.classList.toggle('is-empty', !(value || '').trim());
  }
  return true;
}

/* 선택지 라벨 부분 갱신 — W8: 체험전시형 .connect-object + 그림책 시안 자식 3개 모두 커버 */
function _patchChoiceLabel(idx, value) {
  const screen = _getSceneScreen();
  if (!screen) return false;
  /* 2026-06-02: 원본 인덱스 정합 — 미리보기 라벨 span은 data-choice-idx에 scene.choices
     원본 인덱스를 싣는다. 위치(buttons[idx])가 아니라 속성으로 타겟해야 choices에 구멍이
     있어도 엉뚱한 버튼을 건드리지 않는다(편집 모드 pb/text/movie 공통). */
  const editLabel = screen.querySelector(
    `[data-pb-editable="choice-label"][data-choice-idx="${idx}"]`
  );
  if (editLabel) {
    if (!(editLabel.isContentEditable && document.activeElement === editLabel)) {
      editLabel.textContent = value || '';
      editLabel.classList.toggle('is-empty', !(value || '').trim());
    }
    return true;
  }
  /* fallback — data-choice-idx 없는 경우(비편집/AI보기/legacy): 옛 위치 기반.
     4모드 선택지 클래스 모두 — 체험전시는 connect-object 안 .co-label */
  const buttons = screen.querySelectorAll('.choice-v03, .pb-choice, .text-choice, .js-connect-object');
  if (!buttons || idx >= buttons.length) return false;
  const btn = buttons[idx];
  /* 그림책 시안: 자식 3개 (.pb-choice-num + .pb-choice-label + .pb-choice-arrow)
     textContent로 덮으면 번호·화살표 지워짐. .pb-choice-label만 타겟. */
  const pbLabel = btn.querySelector('.pb-choice-label');
  if (pbLabel) {
    pbLabel.textContent = value || '';
    return true;
  }
  /* 체험전시형: .co-label 내부 텍스트 갱신 */
  const coLabel = btn.querySelector('.co-label');
  if (coLabel) {
    coLabel.textContent = value || '';
    return true;
  }
  /* 2026-05-31 Text-2C: 텍스트형 라벨 직접편집 span — .pb-choice-label과 동형 처리.
     span만 갱신(버튼 내 다른 노드 보존) + is-empty 토글로 빈 라벨 placeholder 유지.
     해당 span이 입력 포커스 중이면 덮어쓰지 않음(커서 보호 — 자체 input이 이미 동기). */
  const textLabel = btn.querySelector('.text-choice-label');
  if (textLabel) {
    if (!(textLabel.isContentEditable && document.activeElement === textLabel)) {
      textLabel.textContent = value || '';
      textLabel.classList.toggle('is-empty', !(value || '').trim());
    }
    return true;
  }
  /* 그 외(텍스트 비편집/무비/legacy): 화살표 ::after 분리 — 텍스트 노드만 갱신 */
  const textNode = Array.from(btn.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
  if (textNode) textNode.nodeValue = value || '';
  else btn.textContent = value || '';
  return true;
}

/* 2026-06-02: 1단 '🔗 선택지 연결'의 [N] 라벨 미리보기를 라이브 갱신.
   라벨을 미리보기/2단 어디서 고쳐도 1단 표시가 즉시 따라오게(정적이던 것 보완).
   idx = scene.choices 원본 인덱스(1단 row data-idx와 동일 규약). */
function _syncChoiceLinkLabelPreview(idx, value) {
  const panel = document.getElementById('edit-panel');
  if (!panel) return;
  const el = panel.querySelector(
    `.edit-pb-choice-link-row[data-idx="${idx}"] .edit-pb-choice-link-label`
  );
  if (!el) return;
  const t = String(value || '').trim();
  el.textContent = t ? (t.length > 12 ? t.slice(0, 12) + '…' : t) : '버튼 문구 없음';
  el.classList.toggle('is-empty', !t);
}

/* 체험전시형 connectObject 부분 갱신 — 오브젝트 위치/크기/라벨 */
function _patchConnectObject(coId, fields) {
  const screen = _getSceneScreen();
  if (!screen || !screen.classList.contains('scene-screen--exp')) return false;
  const node = screen.querySelector(`[data-co-id="${CSS.escape(String(coId))}"]`);
  if (!node) return false;
  if (typeof fields.x === 'number') node.style.left = fields.x + '%';
  if (typeof fields.y === 'number') node.style.top  = fields.y + '%';
  if (typeof fields.w === 'number') node.style.width  = fields.w + '%';
  if (typeof fields.h === 'number') node.style.height = fields.h + '%';
  if (typeof fields.label === 'string') {
    const lbl = node.querySelector('.exp-co__label, .exp-button__label');
    if (lbl) lbl.textContent = fields.label;
  }
  return true;
}

/* 글상자(picturebook 본문 글상자) 위치/크기 부분 갱신 */
function _patchTextboxPlacement(top, left, width, height) {
  const screen = _getSceneScreen();
  if (!screen) return false;
  const box = screen.querySelector('.pb-text-box');
  if (!box) return false;
  if (typeof top    === 'number') box.style.top    = top    + '%';
  if (typeof left   === 'number') box.style.left   = left   + '%';
  if (typeof width  === 'number') box.style.width  = width  + '%';
  if (typeof height === 'number') box.style.height = height + '%';
  return true;
}

/* ─── 작품 유형 안전 해석 (3단계 신규) ──────────────────────────
   ViewerState.project.projectType (1단계에서 도입)을 화이트리스트 검증해 반환.
   잘못된 값/없음이면 picturebook fallback. 다듬기 패널 분기와 미리보기 분기에서 사용. */
function _resolveViewerProjectType() {
  const valid = ['text', 'picturebook', 'movie', 'experience'];
  const t = ViewerState && ViewerState.project ? ViewerState.project.projectType : null;
  return (typeof t === 'string' && valid.includes(t)) ? t : 'picturebook';
}

/* ── 저장 큐 추가 + debounce 예약 ── */
function _queueSave(num, fields) {
  /* Phase 4-A: s1/s2 보기 중엔 원본 scenes/{id} 저장 큐잉 금지. */
  if (_isVariantViewLocked()) return;
  if (_editText.num !== num) return;
  Object.assign(_editText.pendingFields, fields);
  if (_editText.pendingSaveTimer) clearTimeout(_editText.pendingSaveTimer);
  _editText.pendingSaveTimer = setTimeout(() => _flushPendingSave(), EDIT_SAVE_DEBOUNCE_MS);
  /* 활동 — 잠금 heartbeat 연장 */
  if (typeof viewerTouchEdit === 'function' && _editText.editable) {
    viewerTouchEdit(num);
  }
}

/* ── 저장 즉시 flush ── */
async function _flushPendingSave() {
  if (_editText.pendingSaveTimer) {
    clearTimeout(_editText.pendingSaveTimer);
    _editText.pendingSaveTimer = null;
  }
  /* Phase 4-A: s1/s2 보기 중엔 원본 scenes/{id} flush 금지. (원본 보기→변형 전환 시엔 전환 전에 flush됨.) */
  if (_isVariantViewLocked()) return;
  const fields = _editText.pendingFields;
  const num    = _editText.num;
  if (!fields || !Object.keys(fields).length) return;
  if (num == null) return;
  /* 잠금 없는 상태에서 저장 금지 — 안전장치 */
  if (!_editText.editable) return;

  /* buttons validation (v0.3) — patch에 buttons가 있을 때만 검증.
     · 60자 초과: 차단 + 경고. (사실 maxlength=60으로 input에서 1차 차단됨.)
     · 0개: 차단 + 안내. (UI에서 삭제 1개미만 비활성으로 1차 보호되지만 방어적으로 한 번 더.)
     · 빈 라벨: 허용 — 편집 중 상태로 보호. 사용자가 추가 후 글자 치는 중일 수 있음.
       (모드별 감상 화면 처리는 다음 단계에서 — 빈 버튼은 렌더 시 회색 placeholder.) */
  if (Object.prototype.hasOwnProperty.call(fields, 'buttons')) {
    const buttons = fields.buttons;
    if (typeof validateButtonsForSave === 'function') {
      /* 검증은 choices 형태로 받으므로 임시 변환 */
      const asChoices = Array.isArray(buttons) ? buttons : [];
      /* 0개 차단 — empty buttons로 저장 시도하면 막음 */
      if (asChoices.length < 1) {
        _showSaveStatus('⚠ 행동 버튼이 최소 1개 필요해요', 2500);
        delete fields.buttons;  // buttons 필드만 빼고 나머지는 저장
        if (!Object.keys(fields).length) return;
      } else {
        /* 60자 초과 절대 한계 검사 */
        const overLimit = asChoices.find(b => (b.label || '').length > 60);
        if (overLimit) {
          _showSaveStatus(`⚠ 버튼 글자 수 60자 초과`, 2500);
          delete fields.buttons;
          if (!Object.keys(fields).length) return;
        }
      }
    }
  }

  _editText.pendingFields = {};
  _showSaveStatus('저장 중…');
  try {
    await saveSceneText(num, fields);
    _showSaveStatus('✅ 저장됨', 1200);
    return { ok: true };                                    /* S2-2A-FIX2: 결과 반환(기존 호출처는 무시 → 무영향) */
  } catch (err) {
    _showSaveStatus('❌ 저장 실패', 2000);
    /* 실패한 변경은 재시도 가능하도록 다시 큐에 병합.
       감사 L12(2026-07-20): 방향 교정 — 저장 대기(await) 중 새로 입력된 pendingFields가
       더 최신이므로, 실패분(fields)을 바닥에 깔고 최신 입력이 이기게 병합한다.
       (기존 Object.assign(pending, fields)는 옛 값이 최신 타이핑을 되덮었다.) */
    _editText.pendingFields = Object.assign({}, fields, _editText.pendingFields);
    return { ok: false, code: 'SAVE_FAILED' };              /* 민감 오류 원문은 노출하지 않음 */
  }
}

function _showSaveStatus(text, autoClearMs = 0) {
  const el = document.querySelector('.js-edit-text-status');
  if (!el) return;
  el.textContent = text;
  if (_editText.saveStatusTimer) clearTimeout(_editText.saveStatusTimer);
  if (autoClearMs > 0) {
    _editText.saveStatusTimer = setTimeout(() => {
      const cur = document.querySelector('.js-edit-text-status');
      if (cur) cur.textContent = '';
    }, autoClearMs);
  }
}

/* ── 잠금 상태 UI 반영 — DOM 일부만 갱신 (전체 재렌더 안 함) ── */
function _applyEditLockUI() {
  const panel = document.getElementById('edit-panel');
  if (!panel) return;
  /* v129: 읽기전용 상태 body class 토글 — CSS가 모든 수정 컨트롤 차단.
     editable=false면 인스펙터/표지/본문 contenteditable/이미지 핸들·HUD 저장 다 차단.
     허용: 잠금 배너 액션(다시확인/내가수정하기), HUD 액션(감상테스트/루트/구조/브랜치),
           장면 이동, 단순 스크롤·확대. */
  if (document.body) {
    document.body.classList.toggle('viewer-edit-readonly', !_editText.editable);
  }
  /* PANEL-BACKBONE-1B: lock 배너 타겟을 panel 밖 #edit-lock-alert로 이전(content탭 display:none 안에
     있던 기존 배너는 사실상 안 보였음). 새 컨테이너 우선, 없으면 기존 panel 배너 fallback. 갱신/버튼
     바인딩 로직·강제(body class)·viewer-locks.js 함수는 무수정. */
  const banner = document.getElementById('edit-lock-alert') || panel.querySelector('.js-edit-lock-banner');
  const inputs = panel.querySelectorAll('.js-edit-text-input');
  /* 분류 기반 배너 문구/동작 일치 (1-1 정책 마감) ──
     · 'other'       → 진짜 다른 사용자 — 강한 경고, 인수 불가
     · 'same-device' → 같은 브라우저 다른 탭 — 명시적 '여기서 편집' 버튼 제공
     · null/self-tab → 배너 없음 */
  if (banner) {
    if (_editText.editable) {
      banner.style.display = 'none';
      banner.innerHTML = '';
    } else {
      const num  = _editText.num;
      const kind = (typeof classifyLockOwner === 'function' && num != null)
        ? classifyLockOwner(num) : 'other';
      if (kind === 'same-device') {
        /* v125: 같은 기기/같은 사용자의 이전 탭이 남긴 잠금 — 부드러운 문구.
           "다른 창에서 편집 중" 경고는 같은 사람 상황이라 쓰지 않음. */
        banner.classList.add('edit-lock-banner--mild');
        banner.innerHTML = `
          <div class="edit-lock-banner-msg">🪟 이전에 열어둔 편집 창이 남아 있어요. 여기에서 이어서 수정할 수 있어요.</div>
          <button class="edit-lock-takeover-btn js-edit-lock-takeover" type="button">여기에서 이어서 수정</button>`;
        banner.querySelector('.js-edit-lock-takeover')
          ?.addEventListener('click', async () => {
            if (_editText.num == null) return;
            const ok = (typeof viewerTakeoverLock === 'function')
              ? await viewerTakeoverLock(_editText.num) : false;
            if (ok) {
              _editText.editable = true;
              _applyEditLockUI();
            }
            /* 실패 시(원격이 그 사이 진짜 다른 사람이 됐거나) — 그대로 두고
               다음 snapshot 콜백에서 상태 재평가 */
          });
      } else {
        /* v116: 'other' 분류에도 "다시 확인" + "내가 수정하기" 버튼 추가.
           옛엔 인수 버튼이 없어 사용자가 정말 막혔는데, stale lock(다른 사용자 폰이
           꺼지면 TTL 20초 동안 잠금 유지) 또는 옛 잠금이 남은 경우 풀 길이 없었음.
           정책: 다시 확인 = 잠금 다시 읽음. stale 잠금이 풀린 경우 자동으로 편집 가능.
           내가 수정하기 = confirm 후 무조건 인수 (transaction 덮어쓰기). */
        banner.classList.remove('edit-lock-banner--mild');
        banner.innerHTML = `
          <div class="edit-lock-banner-msg">🔒 다른 친구가 이 장면을 수정 중일 수 있어요. 지금은 읽기만 할 수 있어요.</div>
          <div class="edit-lock-banner-actions">
            <button class="edit-lock-recheck-btn js-edit-lock-recheck" type="button">다시 확인</button>
            <button class="edit-lock-takeover-btn js-edit-lock-force-takeover" type="button">내가 수정하기</button>
          </div>`;
        /* 다시 확인 — viewerEnsureEditable 재호출. stale로 남아 있던 잠금이 풀린 경우 자동으로 편집 가능. */
        banner.querySelector('.js-edit-lock-recheck')
          ?.addEventListener('click', async () => {
            if (_editText.num == null) return;
            const ok = (typeof viewerEnsureEditable === 'function')
              ? await viewerEnsureEditable(_editText.num) : false;
            if (ok) {
              _editText.editable = true;
              _applyEditLockUI();
            } else {
              /* 획득하지 못한 경우 분류 재평가 — 'other' 유지 또는 분류가 바뀔 수 있음 */
              _applyEditLockUI();
            }
          });
        /* 내가 수정하기 — 사용자가 confirm 한 후 무조건 인수 */
        banner.querySelector('.js-edit-lock-force-takeover')
          ?.addEventListener('click', async () => {
            if (_editText.num == null) return;
            const ok = await showViewerConfirm({
              title: '그래도 편집할까요?',
              message: '다른 친구가 이 장면을 수정 중일 수 있어요. 동시에 고치면 내용이 겹칠 수 있어요.',
              confirmText: '편집하기',
              cancelText: '돌아가기',
              danger: true,
            });
            if (!ok) return;
            const taken = (typeof viewerForceTakeoverLock === 'function')
              ? await viewerForceTakeoverLock(_editText.num) : false;
            if (taken) {
              _editText.editable = true;
              _applyEditLockUI();
            } else {
              /* v125: 실패 원인별 다른 안내.
                 1) auth 미준비 → "로그인/권한 확인이 늦어지고 있어요"
                 2) 네트워크 추정 → "인터넷 연결 확인"
                 3) 그 외 → 일반 안내 */
              let authReady = false;
              try {
                if (typeof firebase !== 'undefined' && firebase.app) {
                  /* POLISH-AUTH-FIX: 편집 세션은 default app(maker UID) 기준으로 인증 확인. */
                  const viewerApp = (typeof getViewerApp === 'function') ? getViewerApp() : firebase.app('viewer');
                  authReady = !!(viewerApp && viewerApp.auth && viewerApp.auth().currentUser);
                }
              } catch (e) { /* noop */ }
              const onlineOk = (typeof navigator !== 'undefined') ? navigator.onLine !== false : true;
              let msg;
              if (!onlineOk) {
                msg = '인터넷이 끊겨있어요.\n연결을 확인한 후 [다시 확인] 버튼을 눌러주세요.';
              } else if (!authReady) {
                msg = '로그인/권한 확인이 늦어지고 있어요.\n페이지를 새로고침하면 해결될 수 있어요.';
              } else {
                msg = '편집 권한을 가져오지 못했어요.\n• 잠시 후 [다시 확인]을 눌러주세요\n• 계속 안 되면 페이지를 새로고침해주세요';
              }
              alert(msg);
            }
          });
      }
      banner.style.display = '';
    }
  }
  inputs.forEach(el => {
    const wasFocused = (document.activeElement === el);
    el.readOnly = !_editText.editable;
    el.classList.toggle('edit-text-input--locked', !_editText.editable);
    if (wasFocused && document.activeElement !== el) el.focus();
  });
  /* 모드 카드도 잠금 상태 반영 (모드 시스템 뼈대 1차) */
  panel.querySelectorAll('.js-mode-card').forEach(btn => {
    btn.disabled = !_editText.editable;
    btn.classList.toggle('edit-mode-card--locked', !_editText.editable);
  });
  /* 서브모드 카드도 잠금 반영 (그림책형 1차) */
  panel.querySelectorAll('.js-submode-card').forEach(btn => {
    btn.disabled = !_editText.editable;
    btn.classList.toggle('edit-submode-card--locked', !_editText.editable);
  });
  /* 무비형 토글도 잠금 반영 (무비형 설계 1차) */
  panel.querySelectorAll('.js-movie-caption, .js-movie-reveal').forEach(btn => {
    btn.disabled = !_editText.editable;
  });
  /* 버튼 N개 편집 — 추가/삭제 버튼도 잠금 반영 (v0.3) */
  panel.querySelectorAll('.js-edit-btn-add, .js-edit-btn-remove').forEach(btn => {
    btn.disabled = !_editText.editable;
  });
}

/* ── 현재 장면에 대한 잠금 확보 시도 (장면 전환 시 인수인계 포함) ──
   낙관적 시작 (실사용 버그 수정): 배너/readOnly를 미리 띄우지 않고
   editable=true로 시작한다. transaction 결과가 실패할 때만 배너 표시.
   이유: Firebase snapshot이 아직 안 도착한 첫 진입 순간에도 배너가
   깜박이지 않도록. 낙관 후 saveSceneText는 _flushPendingSave에서 editable
   재확인하므로 데이터 안전성은 유지됨. */
async function _ensureEditLockForCurrentScene() {
  const num = ViewerState.currentSceneId;
  /* 장면이 바뀌었으면 이전 장면 처리: flush + release */
  if (_editText.num !== null && _editText.num !== num) {
    await _flushPendingSave();
    if (typeof viewerIsMyLock === 'function' && viewerIsMyLock(_editText.num)) {
      viewerReleaseLock(_editText.num);
    }
  }
  _editText.num      = num;
  /* 낙관적 시작 — 배너 없이 바로 편집 가능 상태로 렌더 */
  _editText.editable = true;
  _applyEditLockUI();

  if (typeof viewerEnsureEditable !== 'function') {
    /* 잠금 모듈 미로드 — 단독 실행으로 간주 (낙관 상태 유지) */
    return;
  }
  const ok = await viewerEnsureEditable(num);
  /* 대기 중 사용자가 다른 장면으로 이동했다면 결과 무시 */
  if (_editText.num !== num) return;
  if (!ok) {
    _editText.editable = false;
    _applyEditLockUI();
  }
  /* ok인 경우 이미 editable=true라 추가 작업 불필요 */
}

/* ── 원격 잠금 변경 시 상태 동기화 (한 번만 등록) ── */
function _installLockChangeHandlerOnce() {
  if (_editText.lockHandlerInstalled) return;
  if (typeof setViewerLockChangeHandler !== 'function') return;
  _editText.lockHandlerInstalled = true;
  setViewerLockChangeHandler(() => {
    const num = _editText.num;
    if (num == null) return;
    if (typeof isViewerLockedByOther !== 'function') return;
    const blocked = isViewerLockedByOther(num);
    const wasEditable = _editText.editable;
    if (wasEditable && blocked) {
      /* TTL 만료로 누가 낚아챘거나 자기 릴리스 — 편집 불가로 전환.
         저장 대기 중인 변경은 유지(다시 잠금 확보되면 자동 flush 가능). */
      _editText.editable = false;
      _applyEditLockUI();
    } else if (!wasEditable && !blocked &&
               typeof viewerIsMyLock === 'function' && viewerIsMyLock(num)) {
      _editText.editable = true;
      _applyEditLockUI();
    } else if (!wasEditable && !blocked) {
      /* 상대가 잠금 해제해서 내가 편집 가능해진 상태 — 배너 문구만 최신화 */
      _applyEditLockUI();
    }
  });
}

/* ================================================================
   pagehide / visibilitychange flush (글 수정 저장 안정화) ──
   ─────────────────────────────────────────────────────────────
   · pagehide: 모바일 Safari 포함 모든 브라우저에서 발생. beforeunload는
     모바일에서 불안정하므로 pagehide 우선 사용.
   · visibilitychange(hidden): 앱 전환/탭 백그라운드 전환 시. iOS에서
     pagehide가 안 뜰 수 있는 시나리오도 커버.
   · 모두 sync처럼 동작하진 않지만(async flush), 800ms debounce 중이던
     pending 입력을 '가능한 한' 저장 시도함. beacon 수준 보장은 아님.
   · 모듈 로드 시 한 번만 등록 — viewer-entry.js init와 무관하게 안전.
   ================================================================ */
(function _installFlushHooks() {
  if (typeof window === 'undefined') return;
  /* pagehide — beforeunload보다 더 넓게 트리거 (모바일 포함) */
  window.addEventListener('pagehide', () => {
    /* _flushPendingSave는 async지만 즉시 시도. 브라우저가 잠깐 기다려줌. */
    if (_editText.pendingFields && Object.keys(_editText.pendingFields).length) {
      _flushPendingSave();
    }
  });
  /* visibilitychange(hidden) — 탭 백그라운드/앱 전환 대응 */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' &&
        _editText.pendingFields && Object.keys(_editText.pendingFields).length) {
      _flushPendingSave();
    }
  });
})();

/* ── 크기 프리셋 정의 ── */
const SIZE_PRESETS = {
  small:  { fontSize: '13px', padding: '6px 14px',  minW: 100 },
  medium: { fontSize: '16px', padding: '10px 20px', minW: 140 },
  large:  { fontSize: '20px', padding: '14px 28px', minW: 190 },
};

/* ── 현재 크기 프리셋 추정 (fontSize 기준) ── */
function _getSizePreset(p) {
  const fs = p.fontSize;
  if (fs === '13px') return 'small';
  if (fs === '20px') return 'large';
  return 'medium';   // 기본값
}

/* ── 크기 프리셋 → presentation에 fontSize/padding/minW 저장 ── */
function _applySizePreset(presentation, presetKey) {
  const preset = SIZE_PRESETS[presetKey] ?? SIZE_PRESETS.medium;
  presentation.fontSize = preset.fontSize;
  presentation.padding  = preset.padding;
  presentation.minW     = preset.minW;
  presentation.h        = null;  // 높이 auto
}

/* ── 장면 순서 목록 (num 기준) ── */
function _editSceneList() {
  return Object.values(ViewerState.scenes)
    .sort((a, b) => Number(a.id) - Number(b.id));
}

/* ── 현재 장면 index ── */
function _currentSceneIndex() {
  const list = _editSceneList();
  return list.findIndex(s => s.id === ViewerState.currentSceneId);
}

/* ── 장면 유형 레이블 (UI 언어 정리 1차) ──
   '시작'은 더 이상 장면 '종류'가 아님. 기존 isStart 데이터는 '일반'으로 표시.
   역할(첫 감상 시작 / 다시 시작점)은 _sceneRoles가 별도 계산. */
function _sceneTypeLabel(scene) {
  if (scene.isCover || scene.type === 'cover') return '표지';
  if (scene.isEnding) return '엔딩';
  return '일반';
}

/* ── 장면 역할 계산 — entry/replay 비교 ──
   반환: { isEntry: boolean, isReplay: boolean } */
function _sceneRoles(scene) {
  const p = ViewerState.project || {};
  const id = String(scene.id);
  return {
    isEntry:  p.entrySceneId  !== null && p.entrySceneId  !== undefined
           && String(p.entrySceneId)  === id,
    isReplay: p.replaySceneId !== null && p.replaySceneId !== undefined
           && String(p.replaySceneId) === id,
  };
}

/* PANEL-DEADCODE-1: (구)1단 패널 nav HTML(_editNavHtml)·바인딩(_bindNavEvents) 제거 —
   PANEL-BACKBONE-1A에서 HUD 아래 #scene-navigator(_sceneNavigatorHtml/_bindSceneNavigatorEvents)로
   이전, 1A-ii에서 호출 제거됨. 0 active caller dead. 코어 editNavigateTo는 무관(유지). */

/* ================================================================
   PANEL-BACKBONE-1A-i: HUD 아래 독립 장면 이동 바(#edit-panel 밖).
   ─────────────────────────────────────────────────────────────
   · _editNavHtml/_bindNavEvents와 동일 코어(editNavigateTo)를 distinct selector
     (js-scene-nav-*·id=scene-nav-jump)로 복제 — 기존 panel nav와 ID 충돌 없이 공존.
   · 갱신은 renderCurrentScene이 호출(currentSceneId 갱신 후). viewer 모드/scene 없으면 비움
     → .scene-navigator:empty가 공간 제거. 기존 panel nav는 무수정(1A-ii에서 제거 예정).
   ================================================================ */
function _sceneNavigatorHtml(scene) {
  const list  = _editSceneList();
  const idx   = _currentSceneIndex();
  const total = list.length;
  const num   = scene.id;
  /* SCENE-TITLE-1B: 제목 없는 장면도 '(제목 없음)' 대신 '장면 N'(번호 중심). 이 변수는 현재
     헤더에서 미사용(NAV-TITLE-1A에서 큰 제목 제거)이지만 잔존 문자열도 정리. */
  const title = scene.title || `장면 ${scene.id}`;
  const type  = _sceneTypeLabel(scene);

  const hasPrev = idx > 0;
  const hasNext = idx < total - 1;

  const typeClass = (scene.type === 'cover' || scene.isCover) ? 'edit-nav-badge--cover'
                  : scene.isEnding ? 'edit-nav-badge--ending'
                                    : 'edit-nav-badge--normal';

  /* 장면 목록 option — 표지 최우선/엔딩 마지막/그 외 id순 (panel nav와 동일 정렬). */
  const optionsHtml = list.slice().sort((a, b) => {
    const rank = s => ((s.type === 'cover' || s.isCover) ? 0 : s.isEnding ? 2 : 1);
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return Number(a.id) - Number(b.id);
  }).map(s => {
    const t        = _sceneTypeLabel(s);
    /* SCENE-TITLE-1B: 빈 제목 '(제목 없음)' 나열 제거 → '장면 N · 유형'(번호 중심). 제목 있으면 보조로. */
    const titleTxt = s.title ? ` · ${s.title.slice(0, 20)}` : '';
    const label    = `장면 ${s.id}${titleTxt} · ${t}`;
    const sel      = s.id === scene.id ? 'selected' : '';
    return `<option value="${escHtml(s.id)}" ${sel}>${escHtml(label)}</option>`;
  }).join('');

  /* VIEWER-EDIT-TOPBAR-1: navigator 2줄→1줄 통합 — [←][select 장면 N · 유형 ▼][N/총][→].
     기존 윗줄 '장면 N + 유형 배지'는 select가 같은 정보(현재 옵션=장면 N · 유형)를 보여줘 중복이라 제거.
     N/총 카운터·이전/다음·select(option value=scene id)·핸들러(js-scene-nav-*)는 그대로 유지.
     (num/type/typeClass/title 변수는 더 이상 표시에 안 쓰이지만 무해하게 남김.) */
  return `
    <div class="edit-nav scene-navigator-inner">
      <div class="edit-nav-row edit-nav-row--single">
        <button class="edit-nav-btn js-scene-nav-prev" ${hasPrev ? '' : 'disabled'} title="이전 장면">←</button>
        <select class="edit-nav-jump js-scene-nav-jump" id="scene-nav-jump" title="장면 이동 — 목록에서 선택">
          ${optionsHtml}
        </select>
        <span class="edit-nav-counter">${idx + 1} / ${total}</span>
        <button class="edit-nav-btn js-scene-nav-next" ${hasNext ? '' : 'disabled'} title="다음 장면">→</button>
      </div>
    </div>`;
}

function _bindSceneNavigatorEvents(root) {
  if (!root) return;
  const list = _editSceneList();
  const idx  = _currentSceneIndex();
  root.querySelector('.js-scene-nav-prev')?.addEventListener('click', () => {
    if (idx > 0) editNavigateTo(list[idx - 1].id);
  });
  root.querySelector('.js-scene-nav-next')?.addEventListener('click', () => {
    if (idx < list.length - 1) editNavigateTo(list[idx + 1].id);
  });
  root.querySelector('.js-scene-nav-jump')?.addEventListener('change', e => {
    const targetId = e.target.value;
    if (targetId && targetId !== ViewerState.currentSceneId) {
      editNavigateTo(targetId);
    }
  });
}

function renderSceneNavigator() {
  const nav = document.getElementById('scene-navigator');
  if (!nav) return;
  const scene = ViewerState.scenes[ViewerState.currentSceneId];
  if (!ViewerState.editMode || !scene) { nav.innerHTML = ''; return; }
  nav.innerHTML = _sceneNavigatorHtml(scene);
  _bindSceneNavigatorEvents(nav);
}

/* PANEL-BACKBONE-1C: 편집 런타임 lock 오케스트레이션을 #edit-panel 밖으로 이전.
   기존엔 renderEditPanel 양 분기 끝에서 lock change 핸들러 설치 + 현재 장면 lock 확보를
   했지만, 둘 다 panel DOM 미사용이고 _applyEditLockUI는 #edit-lock-alert(1B)를 타겟함 →
   renderCurrentScene(editMode)에서 직접 호출해 패널 없이도 lock 동작. 함수 본체는 무수정.
   (frame 바인딩=initEditInteractions는 이미 renderScene 경로에서 독립 처리.) */
function _bindEditRuntimeForCurrentScene() {
  if (typeof _installLockChangeHandlerOnce === 'function') _installLockChangeHandlerOnce();
  if (typeof _ensureEditLockForCurrentScene === 'function') _ensureEditLockForCurrentScene();
}

/* ================================================================
   P5-IMAGE-LOCK-1: AI 이미지 보기(aiS1/aiS2) 중 원본 이미지 편집 잠금
   ────────────────────────────────────────────────────────────────
   · viewer-ai.js의 _getAiImageViewMode(이미지 전용 보기 모드)를 읽어 판정.
     텍스트 aiViewMode와는 완전 분리(혼동 금지).
   · 함수 없음/에러 시 false → 기존 original 동작을 깨지 않음.
   · 원본 scene.imageData / imageUrl 저장 로직은 일절 변경하지 않고, 진입부만 막는다.
   ================================================================ */
var _AI_IMAGE_LOCK_MSG = 'AI 이미지 보기 중에는 원본 그림을 바꿀 수 없습니다.\n원본 이미지로 전환한 뒤 수정해 주세요.';

function _isAiImageVariantViewActive() {
  try {
    return !!(typeof window !== 'undefined' && window.viewerAi
      && typeof window.viewerAi._getAiImageViewMode === 'function'
      && window.viewerAi._getAiImageViewMode() !== 'original');
  } catch (e) { return false; }
}

/* 핸들러 진입부 가드 — 잠금 상태면 안내 후 true(호출부가 즉시 return). */
function _aiImageVariantBlocksOriginalEdit(opts) {
  if (!_isAiImageVariantViewActive()) return false;
  if (!opts || !opts.silent) {
    try { alert(_AI_IMAGE_LOCK_MSG); } catch (e) { /* noop */ }
  }
  return true;
}

/* UI 표시 잠금 — .edit-pb-image-actions 컨테이너를 통째로 비활성(개별 버튼의
   hasImage 조건부 disabled와 충돌하지 않도록 컨테이너 레벨 inline 스타일만 토글).
   원본 보기로 돌아오면 inline 스타일을 제거해 기존 상태 복원.
   PB-IMAGE-1A: #edit-panel 단일 의존 제거 → 문서 전체의 모든 .edit-pb-image-actions에
   적용. 향후 상단 🖼️ 그림 팝오버로 진입 버튼을 복제해도 같은 grey-out 잠금이 적용되게 하는
   선행 작업. 기능 차단(_aiImageVariantBlocksOriginalEdit)은 상태 기반이라 그대로(무수정). */
function _applyAiImageVariantEditLock() {
  try {
    const actionGroups = Array.from(document.querySelectorAll('.edit-pb-image-actions'));
    if (!actionGroups.length) return;
    const isLocked = _isAiImageVariantViewActive();
    actionGroups.forEach((box) => {
      if (isLocked) {
        box.style.pointerEvents = 'none';
        box.style.opacity = '0.5';
        box.setAttribute('aria-disabled', 'true');
        box.setAttribute('title', _AI_IMAGE_LOCK_MSG);
        /* REGEN-UNLOCK-1(2026-07-27·감사 #7): 이 잠금은 '원본(업로드·그리기·삭제) 수정'을 막는 것이지
           AI 그림 다시 만들기를 막을 이유가 없다(오히려 AI 그림이 마음에 안 들 때 쓰는 버튼).
           컨테이너 pointerEvents:none에 같이 묻혀 죽던 🔁 버튼만 개별로 되살린다. */
        box.querySelectorAll('.js-pb-image-regen-scene, .js-pb-image-regen1').forEach((btn) => {
          btn.style.pointerEvents = 'auto';
          btn.style.opacity = '1';
        });
      } else {
        box.style.pointerEvents = '';
        box.style.opacity = '';
        box.removeAttribute('aria-disabled');
        box.removeAttribute('title');
      }
    });
  } catch (e) { /* noop */ }
}

/* ================================================================
   edit panel 렌더 (메인)
   ================================================================ */
function renderEditPanel() {
  /* PANEL-BACKBONE-2-ii: 우측 #edit-panel은 2-i에서 DOM 제거됨 → 렌더할 대상 없음(no-op).
     편집은 미리보기 frame contenteditable + 상단 #scene-navigator/#edit-lock-alert/팝오버가 담당.
     다수 핸들러(선택지/톤/잠금/팝오버 self-refresh, viewer-controls.js chooseOption 등 ~45곳)가
     여전히 renderEditPanel()을 호출하므로 함수는 스텁으로 유지(삭제 시 ReferenceError 위험).
     본체가 부르던 cluster(_editTabsForMode·_textEditHtml·_typeSection*Html·panel binds)는 이제
     0-caller dead → 별도 dead-code 패스(DEADCODE-2)에서 본체 제거 예정. */
  const panel = document.getElementById('edit-panel');
  if (!panel) return;
}

/* ================================================================
   이벤트 바인딩
   ================================================================ */

/* ── 저장 공통 ── */
async function _doSave(panel) {
  /* v129: 읽기전용(잠금) 상태에선 저장하지 않음 — 안전망 (CSS pointer-events:none과 별개로
     키보드/스크립트 우회 차단). */
  if (!_editText.editable) return;
  const btn = panel.querySelector('.js-edit-save');
  if (!btn) return;
  btn.disabled    = true;
  btn.textContent = '저장 중...';
  try {
    /* 글 수정 대기분도 함께 flush — 사용자가 입력 직후 저장 누를 때 데이터 유실 방지 */
    await _flushPendingSave();
    await saveViewerMeta();
    btn.textContent = '✅ 저장됨';
    setTimeout(() => { btn.disabled = false; btn.textContent = '💾 저장'; }, 1500);
  } catch {
    btn.textContent = '❌ 저장 실패';
    btn.disabled    = false;
  }
}

/* ================================================================
   initEditInteractions — 렌더 후 overlay choice에 드래그 붙이기
   ================================================================ */
function initEditInteractions() {
  if (!ViewerState.editMode) return;
  const frame = document.getElementById('viewer-frame');
  if (!frame) return;

  frame.querySelectorAll('.choice-overlay-wrap').forEach(wrap => {
    const choiceId = wrap.querySelector('.choice-btn')?.dataset.choiceId;
    if (!choiceId) return;

    wrap.classList.toggle('edit-selected', choiceId === ViewerState.selectedChoiceId);

    wrap.addEventListener('pointerdown', e => {
      if (e.target.closest('.choice-btn')) {
        ViewerState.selectedChoiceId = choiceId;
        renderEditPanel();
        frame.querySelectorAll('.choice-overlay-wrap').forEach(w => {
          w.classList.toggle('edit-selected', w.querySelector('.choice-btn')?.dataset.choiceId === choiceId);
        });
      }
    });

    _attachDrag(wrap, choiceId, frame);
  });

  /* W4: 그림책형 그림 중심형 — 본문 글상자 드래그/리사이즈 인터랙션.
     mockup 부합:
     · ✥ 가운데 핸들 (또는 본문 영역) → 위치 이동
     · 4 모서리 ⤡ 핸들 → 크기 조절 (width + height 둘 다)
     · 제목은 손대지 않음 (고정 — mockup 🔒)
     좌표는 pb-stage 영역 기준 % (글상자가 그 안에서 절대위치). */
  frame.querySelectorAll('.js-pb-body-overlay').forEach(overlay => {
    _attachPbBodyBoxInteractions(overlay, frame);
  });

  /* W6: 체험전시형 connectObject 인터랙션.
     각 오브젝트에 ✥ 이동 + 4 모서리 리사이즈. W4 패턴 차용. */
  frame.querySelectorAll('.js-connect-object').forEach(el => {
    _attachConnectObjectInteractions(el, frame);
  });

  /* ADV-EDIT-ABSORB-TITLE-1: 텍스트형 '+ 제목 추가' 칩 → 제목칸 펼침 + 포커스.
     draft 활성 후 재렌더 → _textTitleHtml이 빈 제목도 contenteditable h3로 렌더 →
     _attachPbEditableInteractions가 기존 title 저장 경로로 바인딩. (새 저장 함수 X) */
  frame.querySelectorAll('.js-text-title-add').forEach(chip => {
    chip.addEventListener('click', () => {
      if (!_editText.editable) return;
      const sid = chip.dataset.sceneId || String(ViewerState.currentSceneId);
      _textTitleDraftScenes.add(String(sid));
      const scene = ViewerState.scenes[ViewerState.currentSceneId];
      if (scene && typeof renderScene === 'function') {
        renderScene(scene);
        const titleEl = document.querySelector('#viewer-frame .text-card__title[contenteditable="true"]');
        if (titleEl) titleEl.focus();
      }
    });
  });

  /* W8: 그림책 본문/제목 contenteditable — viewer 화면에서 직접 수정.
     scene 데이터 → debounce 저장 → 다듬기 패널 textarea/input 양방향 동기화. */
  _attachPbEditableInteractions(frame);

  /* Phase 4-C: s1/s2 보기 중 variant body 편집 — 원본 scene.body와 완전히 분리된 경로. */
  _attachVariantBodyEditable(frame);
}

/* ─── Phase 4-C: variant body 편집 (s1/s2 보기 중) ──────────────
   data-ai-variant-edit="s1|s2" element만 대상. 원본 scene.body는 절대 미수정.
   입력/blur → window.viewerAi._queueVariantBodySave(별도 saveTextVariant patchBody 경로).
   _attachPbEditableInteractions(generic [data-pb-editable])와 분리 — scene[field] 오염 방지. */
function _attachVariantBodyEditable(frame) {
  if (!ViewerState.editMode) return;
  const scene = ViewerState.scenes[ViewerState.currentSceneId];
  if (!scene) return;
  const ai = (typeof window !== 'undefined') ? window.viewerAi : null;
  if (!ai || typeof ai._queueVariantBodySave !== 'function') return;

  frame.querySelectorAll('[data-ai-variant-edit]').forEach(el => {
    const variantKey = el.dataset.aiVariantEdit;   /* 's1' | 's2' */
    if (variantKey !== 's1' && variantKey !== 's2') return;
    const sceneId = scene.id;

    function _updatePlaceholder() {
      const isEmpty = el.textContent.trim().length === 0;
      el.classList.toggle('is-empty', isEmpty);
    }
    _updatePlaceholder();

    el.addEventListener('input', () => {
      /* 줄바꿈 보존 추출. scene.body는 절대 건드리지 않음 — variant 저장 경로로만. */
      const text = _extractEditableText(el);
      _updatePlaceholder();
      ai._queueVariantBodySave(variantKey, sceneId, text);
    });

    el.addEventListener('focus', () => { el.classList.add('is-focused'); });
    el.addEventListener('blur', () => {
      el.classList.remove('is-focused');
      _updatePlaceholder();
      const text = _extractEditableText(el);
      ai._queueVariantBodySave(variantKey, sceneId, text);
      if (typeof ai._flushVariantBodySave === 'function') ai._flushVariantBodySave();   /* blur 즉시 flush */
    });
  });
}

/* v45: contenteditable의 줄바꿈 보존 추출.
   브라우저는 Enter를 <br>/<div>로 정규화하는데 textContent로 추출하면 줄바꿈 손실.
   다듬기에서 입력한 본문 \n이 감상 후 사라지던 root 버그 fix. */
function _extractEditableText(el) {
  const html = (el.innerHTML || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p)>/gi, '')
    .replace(/<(div|p)[^>]*>/gi, '\n');
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  /* v127: 옛 .replace(/^\n/, '') 제거 — 사용자가 본문 앞에 넣은 \n\n은
     의도된 빈 줄. 첫 \n을 지우면 사용자 표현이 사라질 수 있음.
     browser가 첫 <div>를 만들 때 생기는 \n = 사용자가 넣은 것과 구분이 안 됨.
     사용자 입력 우선 — 첫 \n도 유지. */
  return tmp.textContent || '';
}

function _attachPbEditableInteractions(frame) {
  if (!ViewerState.editMode) return;
  const scene = ViewerState.scenes[ViewerState.currentSceneId];
  if (!scene) return;

  /* debounce 저장 — 입력 멈춤 300ms 후 저장 */
  let saveTimer = null;
  function _queueDebounceSave(field, value) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const patch = {};
      patch[field] = value;
      if (typeof _queueSave === 'function') {
        _queueSave(scene.num || scene.id, patch);
        if (typeof _flushPendingSave === 'function') _flushPendingSave();
      }
    }, 300);
  }

  frame.querySelectorAll('[data-pb-editable]').forEach(el => {
    const field = el.dataset.pbEditable;   /* 'title' | 'body' | 'choice-label' */
    if (!field) return;

    /* 2026-05-25 Phase 4-A: 행동 버튼 라벨 직접 편집 분기.
       scene.choices[idx].label을 수정하는 경로 — _queueSaveButtons로 저장.
       title/body와 저장 경로가 달라 별도 helper로 분리. */
    if (field === 'choice-label') {
      _attachChoiceLabelEditable(el, scene);
      return;
    }

    /* placeholder 표시 — 빈 상태일 때 회색 텍스트 */
    function _updatePlaceholder() {
      const isEmpty = el.textContent.trim().length === 0;
      el.classList.toggle('is-empty', isEmpty);
    }
    _updatePlaceholder();

    /* 입력 — scene 메모리 즉시 업데이트 + 다듬기 패널 input 동기화 */
    el.addEventListener('input', () => {
      /* 2026-05-28 Codex review fix (High-Risk 2): 잠금/readonly 상태에서
         scene 메모리 수정 안 함 + 저장 큐에 넣지 않음. choice-label과 동일 패턴. */
      if (!_editText.editable) return;
      /* v45: 본문은 줄바꿈 보존(_extractEditableText), 제목은 단일 줄(textContent) */
      const text = (field === 'body') ? _extractEditableText(el) : el.textContent;
      scene[field] = text;
      _updatePlaceholder();
      /* v122: 다듬기 패널의 해당 input/textarea 즉시 갱신 (있으면).
         옛 오타 fix: '#edit-pane' → '#edit-panel' (실제 id). 옛엔 셀렉터가 매칭되지 않아
         → 왼쪽 화면 수정해도 오른쪽 패널 input이 갱신되지 않음 (사용자가 보고한 양방향 동기 버그).
         focus 보호: 오른쪽 input이 현재 focus 중이면 덮어쓰지 않음 (커서 보호).
         2026-05-27 Cover-1: kicker/subtitle 매핑 확장 — 표지 직접 입력 양방향 동기. */
      const _PANEL_INPUT_MAP = {
        title:    '#edit-panel .js-edit-title',
        body:     '#edit-panel .js-edit-body',
        kicker:   '#edit-panel .js-edit-cover-kicker',
        subtitle: '#edit-panel .js-edit-cover-subtitle',
      };
      const _panelInputSel = _PANEL_INPUT_MAP[field];
      const panelInput = _panelInputSel ? document.querySelector(_panelInputSel) : null;
      if (panelInput && document.activeElement !== panelInput && panelInput.value !== text) {
        panelInput.value = text;
      }
      _queueDebounceSave(field, text);
    });

    /* 포커스 시 placeholder 숨김 효과 */
    el.addEventListener('focus', () => {
      el.classList.add('is-focused');
    });
    el.addEventListener('blur', () => {
      el.classList.remove('is-focused');
      _updatePlaceholder();
      /* 2026-05-28 Codex review fix (High-Risk 2): 잠금/readonly 상태에서
         blur로 들어온 마지막 입력도 저장 큐에 넣지 않음. */
      if (!_editText.editable) return;
      /* blur 시 즉시 저장 (debounce 무시) */
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      /* v45: 본문은 줄바꿈 보존 추출 */
      const text = (field === 'body') ? _extractEditableText(el) : el.textContent;
      const patch = {};
      patch[field] = text;
      if (typeof _queueSave === 'function') {
        _queueSave(scene.num || scene.id, patch);
        if (typeof _flushPendingSave === 'function') _flushPendingSave();
      }
      /* ADV-EDIT-ABSORB-TITLE-1: 텍스트형 제목칸을 빈 채로 blur → draft 해제 + 재렌더(→ 다시 '+ 제목 추가' 칩).
         text-card__title(텍스트형 전용 class)에만 적용 — picturebook/cover/movie 제목엔 영향 X. */
      if (field === 'title' && el.classList.contains('text-card__title') && !text.trim()) {
        _textTitleDraftScenes.delete(String(scene.id));
        if (typeof _scheduleViewerFrameReRender === 'function') _scheduleViewerFrameReRender();
      }
    });

    /* Enter 키 — title/kicker/subtitle 단일 줄 (Enter blur), body는 자연 줄바꿈 허용.
       2026-05-27 Cover-1: kicker/subtitle도 표지 단일 줄 입력이라 동일 처리. */
    if (field === 'title' || field === 'kicker' || field === 'subtitle') {
      el.addEventListener('keydown', e => {
        /* CROSS-A: 1845(HOTFIX-IME)와 동일 — 조합 중 Enter는 확정용, blur 금지("문을 연다다" 방지) */
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          el.blur();
        }
      });
    }
  });
}

/* ─── Phase 4-A: 행동 버튼 라벨 직접 편집 (2026-05-25) ──────
   _attachPbEditableInteractions 안에서 field === 'choice-label'이면 호출.
   · scene.choices[idx].label 갱신
   · 우측 2단 input.js-edit-button-label[data-idx] 양방향 동기화
   · _queueSaveButtons(scene) 재사용 — buttons/choiceA/B/nextA/B/choiceCount 일괄 저장
   · 한 줄 입력 (Enter 누르면 blur)
   · maxLen 안전망 (입력 초과 시 자동 절단) */
function _attachChoiceLabelEditable(el, scene) {
  const idx = Number(el.dataset.choiceIdx);
  if (!Number.isFinite(idx) || !scene.choices || !scene.choices[idx]) return;

  /* placeholder 표시 — 빈 상태일 때 회색 안내 */
  function _updateChoicePlaceholder() {
    const isEmpty = el.textContent.trim().length === 0;
    el.classList.toggle('is-empty', isEmpty);
  }
  _updateChoicePlaceholder();

  /* maxLen — ptype별 (_getChoiceLabelMaxViewer가 있으면 그 값, 없으면 기본 60) */
  const _ptype = (typeof ViewerState !== 'undefined' && ViewerState.project &&
                  ViewerState.project.projectType) || null;
  const maxLen = (typeof _getChoiceLabelMaxViewer === 'function')
    ? _getChoiceLabelMaxViewer(_ptype) : 60;

  let choiceSaveTimer = null;

  /* IME-TRUNC-FIX(2026-07-11): 한글 조합 중 maxLen 절단이 발동하면 textContent 재작성+캐럿
     강제 이동으로 조합이 끊겨 마지막 글자가 깨지거나 중복됨('이상한 글씨' 실사례 경로).
     조합 중엔 절단을 보류하고 compositionend에서 1회 정리한다. */
  el.addEventListener('compositionstart', () => { el._imeComposing = true; });
  el.addEventListener('compositionend', () => {
    el._imeComposing = false;
    const t = el.textContent;
    if (t.length > maxLen) {
      el.textContent = t.slice(0, maxLen);
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      el.dispatchEvent(new Event('input'));   /* 절단 반영 저장 경로 재사용 */
    }
  });

  el.addEventListener('input', () => {
    if (!_editText.editable) return;
    let value = el.textContent;
    /* maxLen 안전망 — paste 등으로 초과 시 절단 (조합 중엔 보류 → compositionend에서 정리) */
    if (value.length > maxLen && !el._imeComposing) {
      value = value.slice(0, maxLen);
      el.textContent = value;
      /* caret을 끝으로 옮김 — 절단 직후 자연스러운 위치 */
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }

    scene.choices[idx].label = value;
    _updateChoicePlaceholder();
    _syncChoiceLinkLabelPreview(idx, value);   /* 1단 [N] 라벨 미리보기 동기 */

    /* 우측 2단 input 동기화 — focus 보호 */
    const panelInput = document.querySelector(
      `#edit-panel .js-edit-button-label[data-idx="${idx}"]`
    );
    if (panelInput && document.activeElement !== panelInput && panelInput.value !== value) {
      panelInput.value = value;
      /* counter 갱신 (해당 row만) */
      const row = panelInput.closest('.edit-button-row');
      if (row) {
        const lenEl = row.querySelector('.js-edit-btn-len');
        if (lenEl) lenEl.textContent = String(value.length);
      }
    }

    /* debounce 저장 — _queueSaveButtons 사용 */
    if (choiceSaveTimer) clearTimeout(choiceSaveTimer);
    choiceSaveTimer = setTimeout(() => {
      if (typeof _queueSaveButtons === 'function') _queueSaveButtons(scene);
      if (typeof _flushPendingSave === 'function') _flushPendingSave();
    }, 300);
  });

  el.addEventListener('focus', () => el.classList.add('is-focused'));
  el.addEventListener('blur', () => {
    el.classList.remove('is-focused');
    _updateChoicePlaceholder();
    /* blur 시 즉시 저장 (debounce 무시) */
    if (choiceSaveTimer) { clearTimeout(choiceSaveTimer); choiceSaveTimer = null; }
    if (typeof _queueSaveButtons === 'function') _queueSaveButtons(scene);
    if (typeof _flushPendingSave === 'function') _flushPendingSave();
  });

  /* Enter — 한 줄 입력 (title과 동일).
     HOTFIX-IME: 한글 IME 조합 중 Enter는 '확정'용이므로 blur/저장을 실행하지 않는다.
     (isComposing/keyCode===229 미체크 시 마지막 글자가 중복 커밋되는 버그 — 예: "문을 연다"→"문을 연다다") */
  el.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      el.blur();
    }
  });
}

/* ─── 그림책형 본문 글상자 인터랙션 (W4) ─────────────────────
   감상 모드에서는 핸들이 없어서 동작 X. 다듬기 모드만 적용. */
function _attachPbBodyBoxInteractions(overlay, frame) {
  /* 위치 기준 컨테이너: pb-stage (그림이 든 상단 80% 영역).
     글상자는 pb-stage 안에서 left/top/width/height %로 위치. */
  const stage = overlay.closest('.pb-stage');
  if (!stage) return;

  /* Phase 4-D-1: variant 글상자 편집 모드. overlay에 data-ai-variant-layout="s1|s2"가 있으면
     원본 scenes/{id}/picturebookBodyBox 대신 aiVariants 경로에 저장(별도 큐). */
  const _variantLayoutKey = (overlay.dataset && (overlay.dataset.aiVariantLayout === 's1' ? 's1'
    : overlay.dataset.aiVariantLayout === 's2' ? 's2' : null)) || null;

  /* 현재 장면 + 변경 적용 헬퍼 */
  const getScene = () => ViewerState.scenes[ViewerState.currentSceneId];
  const getBox = () => {
    const s = getScene();
    if (!s) return null;
    const orig = (typeof getPicturebookBodyBox === 'function') ? getPicturebookBodyBox(s) : null;
    /* variant 모드면 현재 표시 중인 variant box를 시작점으로(없으면 원본 fallback은 _getDisplayLayout이 처리). */
    let cur = orig;
    if (_variantLayoutKey && typeof window !== 'undefined' && window.viewerAi
        && typeof window.viewerAi._getDisplayLayout === 'function') {
      const disp = window.viewerAi._getDisplayLayout(s.id, orig);
      if (disp && disp.picturebookBodyBox) cur = disp.picturebookBodyBox;
    }
    /* 깊은 복사 — 직접 ref 수정하면 다음 호출에서 같은 객체. 안전하게 새 객체. */
    return cur ? { ...cur } : { x: 15, y: 25, width: 55, height: null, backdropOpacity: 0.85 };
  };
  const applyBox = (box) => {
    const s = getScene();
    if (!s) return;
    if (_variantLayoutKey) {
      /* variant 경로 — 원본 scene.picturebookBodyBox 절대 미변경. 별도 큐로 aiVariants에 저장. */
      _applyVariantBoxInlineStyle(box);
      if (typeof window !== 'undefined' && window.viewerAi
          && typeof window.viewerAi._queueVariantLayoutSave === 'function') {
        window.viewerAi._queueVariantLayoutSave(_variantLayoutKey, s.id, { ...box });
      }
      return;
    }
    /* Phase 4-A: s1/s2 보기 중엔 원본 layout(picturebookBodyBox) in-memory/저장 모두 금지.
       (variant 경로는 위에서 이미 분기되었으므로, 여기 도달=원본 보기이거나 후보 없음.) */
    if (_isVariantViewLocked()) return;
    /* 메모리 반영 + DB 저장 큐 — _editText.num 매칭 안 되면 _queueSave 가드에 걸리므로
       saveSceneText 직접 호출 fallback. 둘 다 시도. */
    s.picturebookBodyBox = { ...box };
    if (typeof _queueSave === 'function') {
      _queueSave(s.num || s.id, { picturebookBodyBox: { ...box } });
    }
    _applyVariantBoxInlineStyle(box);
  };
  /* inline style 직접 갱신 (재렌더 사이 깜빡임 방지) — 원본/variant 공통. */
  const _applyVariantBoxInlineStyle = (box) => {
    overlay.style.left  = `${box.x}%`;
    overlay.style.top   = `${box.y}%`;
    overlay.style.width = `${box.width}%`;
    if (typeof box.height === 'number') {
      overlay.style.height = `${box.height}%`;
    } else {
      overlay.style.height = '';
    }
    /* D8-CLEAN-1B: 신규 5스킨 imageCenter는 v03-modes.css가 스킨 색조 + 이 alpha로 합성.
       background는 legacy/split fallback로 유지. live 슬라이더/드래그에서도 --pb-box-opacity 갱신. */
    overlay.style.setProperty('--pb-box-opacity', String(box.backdropOpacity));
    overlay.style.background = `rgba(255,255,255,${box.backdropOpacity})`;
  };

  /* ── 가운데 ✥ 또는 본문 영역 자체 → 위치 드래그 ── */
  const moveHandle = overlay.querySelector('.js-pb-body-move');
  if (moveHandle) {
    let dragging = false, pid = null;
    let startX, startY, startBox;
    let rafPending = false;
    let lastEvt = null;

    moveHandle.addEventListener('pointerdown', e => {
      if (!ViewerState.editMode) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      pid = e.pointerId;
      moveHandle.setPointerCapture(pid);
      overlay.classList.add('pb-body-overlay--moving');
      startX = e.clientX;
      startY = e.clientY;
      startBox = getBox();
    });

    moveHandle.addEventListener('pointermove', e => {
      if (!dragging || e.pointerId !== pid) return;
      e.preventDefault();
      lastEvt = e;
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        if (!lastEvt || !startBox) return;
        const stageRect = stage.getBoundingClientRect();
        const dx = ((lastEvt.clientX - startX) / stageRect.width)  * 100;
        const dy = ((lastEvt.clientY - startY) / stageRect.height) * 100;
        const box = { ...startBox };
        const heightPct = (typeof box.height === 'number') ? box.height : 25;  // 자동일 땐 추정값
        /* clamp — 글상자가 pb-stage를 벗어나지 않도록 */
        box.x = Math.max(0, Math.min(100 - box.width,  startBox.x + dx));
        box.y = Math.max(0, Math.min(100 - heightPct,  startBox.y + dy));
        box.x = Math.round(box.x * 10) / 10;
        box.y = Math.round(box.y * 10) / 10;
        applyBox(box);
      });
    });

    const endMove = () => {
      if (!dragging) return;
      dragging = false;
      overlay.classList.remove('pb-body-overlay--moving');
      if (_variantLayoutKey) {
        /* variant 경로 — 별도 큐 flush. 패널은 잠겨 있으므로 renderEditPanel 미호출. */
        if (typeof window !== 'undefined' && window.viewerAi
            && typeof window.viewerAi._flushVariantLayoutSave === 'function') {
          window.viewerAi._flushVariantLayoutSave();
        }
        return;
      }
      if (typeof _flushPendingSave === 'function') _flushPendingSave();
      /* 다듬기 패널 슬라이더 갱신 — 슬라이더 값이 새 위치 반영되도록 */
      if (typeof renderEditPanel === 'function') renderEditPanel();
    };
    moveHandle.addEventListener('pointerup',     e => { if (e.pointerId === pid) { try{moveHandle.releasePointerCapture(pid);}catch(_){}; endMove(); } });
    moveHandle.addEventListener('pointercancel', endMove);
  }

  /* ── 4 모서리 → 크기 리사이즈 ── */
  overlay.querySelectorAll('.js-pb-body-resize').forEach(handle => {
    let resizing = false, pid = null;
    let startX, startY, startBox, corner;
    let rafPending = false;
    let lastEvt = null;
    let naturalHPct = null;   /* BUBBLE-MIN-NATURAL: 드래그 시작 시점의 내용(auto) 높이 % */

    handle.addEventListener('pointerdown', e => {
      if (!ViewerState.editMode) return;
      e.preventDefault();
      e.stopPropagation();
      resizing = true;
      pid = e.pointerId;
      handle.setPointerCapture(pid);
      overlay.classList.add('pb-body-overlay--resizing');
      startX = e.clientX;
      startY = e.clientY;
      startBox = getBox();
      corner = handle.dataset.corner;  // 'nw' / 'ne' / 'sw' / 'se'
      const stageRect = stage.getBoundingClientRect();
      /* BUBBLE-MIN-NATURAL(2026-07-20): 내용(auto) 높이 실측 — 축소 하한으로 사용.
         명시 height를 잠시 걷고 재면 '처음 한 줄 상태'와 같은 높이가 나온다.
         transition off→측정→원복→reflow는 _fitOnePbBodyOverlay와 동일 패턴(흔들림 방지). */
      naturalHPct = null;
      if (stageRect.height) {
        const prevH = overlay.style.height, prevTr = overlay.style.transition, prevOv = overlay.style.overflow;
        overlay.style.transition = 'none';
        overlay.style.overflow = 'hidden';
        overlay.style.height = 'auto';
        const naturalPx = overlay.getBoundingClientRect().height;
        overlay.style.overflow = prevOv;
        overlay.style.height = prevH;
        void overlay.offsetHeight;
        overlay.style.transition = prevTr;
        const pct = (naturalPx / stageRect.height) * 100;
        if (Number.isFinite(pct) && pct > 1) naturalHPct = pct;
      }
      /* height를 명시값으로 채움 — null이면 현재 보이는 높이를 % 추정해서 시작값으로 */
      if (typeof startBox.height !== 'number') {
        const overlayRect = overlay.getBoundingClientRect();
        startBox.height = stageRect.height ? (overlayRect.height / stageRect.height) * 100 : 25;
      }
    });

    handle.addEventListener('pointermove', e => {
      if (!resizing || e.pointerId !== pid) return;
      e.preventDefault();
      lastEvt = e;
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        if (!lastEvt || !startBox) return;
        const stageRect = stage.getBoundingClientRect();
        const dxPct = ((lastEvt.clientX - startX) / stageRect.width)  * 100;
        const dyPct = ((lastEvt.clientY - startY) / stageRect.height) * 100;
        const box = { ...startBox };

        /* 코너별 리사이즈 — 반대편 모서리는 고정.
           se (남동): width/height 늘림, 위치 그대로
           sw (남서): height 늘림, x/width는 좌측 끌림
           ne (북동): width 늘림, y/height는 상단 끌림
           nw (북서): x/y/width/height 모두 변함 */
        if (corner === 'se') {
          box.width  = startBox.width  + dxPct;
          box.height = startBox.height + dyPct;
        } else if (corner === 'sw') {
          box.x      = startBox.x      + dxPct;
          box.width  = startBox.width  - dxPct;
          box.height = startBox.height + dyPct;
        } else if (corner === 'ne') {
          box.y      = startBox.y      + dyPct;
          box.width  = startBox.width  + dxPct;
          box.height = startBox.height - dyPct;
        } else if (corner === 'nw') {
          box.x      = startBox.x      + dxPct;
          box.y      = startBox.y      + dyPct;
          box.width  = startBox.width  - dxPct;
          box.height = startBox.height - dyPct;
        }

        /* clamp — 최소/최대 + stage 안 보장 */
        box.width  = Math.max(20, Math.min(95, box.width));
        /* BUBBLE-MINH-1LINE(2026-07-09): 최소 높이 12%→8%.
           BUBBLE-MIN-NATURAL(2026-07-20): 고정 8%는 큰 무대에선 한 줄보다 커서
           "늘렸다 줄이면 처음 한 줄로 못 돌아감" — 하한 = 내용(auto) 실측 높이.
           내용보다 작게는 못 줄임(글 가둠 방지) · 한 줄이 8%보다 작으면 거기까지 축소 허용. */
        const _minH = Number.isFinite(naturalHPct) ? Math.min(naturalHPct, 90) : 8;
        box.height = Math.max(_minH, Math.min(90, box.height));
        box.x      = Math.max(0,  Math.min(100 - box.width,  box.x));
        box.y      = Math.max(0,  Math.min(100 - box.height, box.y));
        box.x      = Math.round(box.x * 10) / 10;
        box.y      = Math.round(box.y * 10) / 10;
        box.width  = Math.round(box.width * 10) / 10;
        box.height = Math.round(box.height * 10) / 10;
        /* BUBBLE-MIN-NATURAL: 하한(내용 높이)까지 줄였으면 height:null(auto)로 스냅 —
           저장도 auto라 '내용에 꼭 맞는' 초기 상태로 완전 복귀(이후 글이 늘면 같이 늘어남). */
        if (Number.isFinite(naturalHPct) && box.height <= _minH + 0.3) box.height = null;
        applyBox(box);
      });
    });

    const endResize = () => {
      if (!resizing) return;
      resizing = false;
      overlay.classList.remove('pb-body-overlay--resizing');
      if (_variantLayoutKey) {
        if (typeof window !== 'undefined' && window.viewerAi
            && typeof window.viewerAi._flushVariantLayoutSave === 'function') {
          window.viewerAi._flushVariantLayoutSave();
        }
        return;
      }
      if (typeof _flushPendingSave === 'function') _flushPendingSave();
      if (typeof renderEditPanel === 'function') renderEditPanel();
    };
    handle.addEventListener('pointerup',     e => { if (e.pointerId === pid) { try{handle.releasePointerCapture(pid);}catch(_){}; endResize(); } });
    handle.addEventListener('pointercancel', endResize);
  });
}

/* ─── W6: 체험전시형 connectObject 드래그/리사이즈 ─────────────────
   감상 모드에서는 핸들이 없어서 동작 X. 다듬기 모드만 적용.
   W4의 _attachPbBodyBoxInteractions 패턴 차용 — 좌표 기준은 .exp-objects-layer
   (배경 이미지 영역과 동일 100% × 100%). */
function _attachConnectObjectInteractions(coEl, frame) {
  const layer = coEl.closest('.exp-objects-layer') || coEl.parentElement;
  if (!layer) return;
  const coId = coEl.getAttribute('data-co-id');
  if (!coId) return;

  /* 현재 scene + co 객체 가져오는 헬퍼 — 매번 최신 데이터 fetch */
  function getScene() {
    if (!ViewerState || !ViewerState.scenes) return null;
    return ViewerState.scenes[ViewerState.currentSceneId] || null;
  }
  function getCo() {
    const s = getScene();
    if (!s || !Array.isArray(s.connectObjects)) return null;
    return s.connectObjects.find(o => o.id === coId) || null;
  }

  /* 픽셀 → % 변환 (layer 기준) */
  function pxToPct(dx, dy) {
    const rect = layer.getBoundingClientRect();
    return {
      dxPct: rect.width  > 0 ? (dx / rect.width)  * 100 : 0,
      dyPct: rect.height > 0 ? (dy / rect.height) * 100 : 0,
    };
  }

  /* 메모리 + DOM 동시 갱신 — clamp 포함 */
  function applyBox(co, x, y, w, h) {
    /* clamp */
    w = Math.max(2, Math.min(100, w));
    h = Math.max(2, Math.min(100, h));
    x = Math.max(0, Math.min(100 - w, x));
    y = Math.max(0, Math.min(100 - h, y));
    co.x = x; co.y = y; co.w = w; co.h = h;
    coEl.style.left   = x + '%';
    coEl.style.top    = y + '%';
    coEl.style.width  = w + '%';
    coEl.style.height = h + '%';
  }

  /* === 이동 핸들 ✥ === */
  const moveHandle = coEl.querySelector('.js-co-move');
  if (moveHandle) {
    let dragging = false, pid = null;
    let startX = 0, startY = 0;
    let startCo = null;
    let rafPending = false, nextDx = 0, nextDy = 0;

    moveHandle.addEventListener('pointerdown', e => {
      const co = getCo();
      if (!co) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      pid = e.pointerId;
      try { moveHandle.setPointerCapture(pid); } catch (_) {}
      startX = e.clientX;
      startY = e.clientY;
      startCo = { x: co.x, y: co.y, w: co.w, h: co.h };
      coEl.classList.add('connect-object--moving');
    });
    moveHandle.addEventListener('pointermove', e => {
      if (!dragging || e.pointerId !== pid) return;
      nextDx = e.clientX - startX;
      nextDy = e.clientY - startY;
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        if (!dragging) return;
        const co = getCo();
        if (!co || !startCo) return;
        const { dxPct, dyPct } = pxToPct(nextDx, nextDy);
        applyBox(co, startCo.x + dxPct, startCo.y + dyPct, startCo.w, startCo.h);
        _queueSave((getScene().num || getScene().id), { connectObjects: getScene().connectObjects });
      });
    });
    function endMove() {
      if (!dragging) return;
      dragging = false;
      coEl.classList.remove('connect-object--moving');
      _flushPendingSave();
    }
    moveHandle.addEventListener('pointerup',     e => { if (e.pointerId === pid) { try{moveHandle.releasePointerCapture(pid);}catch(_){}; endMove(); } });
    moveHandle.addEventListener('pointercancel', endMove);
  }

  /* === 4 모서리 리사이즈 핸들 === */
  coEl.querySelectorAll('.js-co-resize').forEach(handle => {
    const corner = handle.getAttribute('data-corner');
    let dragging = false, pid = null;
    let startX = 0, startY = 0;
    let startCo = null;
    let rafPending = false, nextDx = 0, nextDy = 0;

    handle.addEventListener('pointerdown', e => {
      const co = getCo();
      if (!co) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      pid = e.pointerId;
      try { handle.setPointerCapture(pid); } catch (_) {}
      startX = e.clientX;
      startY = e.clientY;
      startCo = { x: co.x, y: co.y, w: co.w, h: co.h };
      coEl.classList.add('connect-object--resizing');
    });
    handle.addEventListener('pointermove', e => {
      if (!dragging || e.pointerId !== pid) return;
      nextDx = e.clientX - startX;
      nextDy = e.clientY - startY;
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        if (!dragging) return;
        const co = getCo();
        if (!co || !startCo) return;
        const { dxPct, dyPct } = pxToPct(nextDx, nextDy);
        let newX = startCo.x, newY = startCo.y;
        let newW = startCo.w, newH = startCo.h;
        /* 모서리별 분기 — 반대편 모서리 고정, 잡은 모서리 따라 움직임 */
        if (corner === 'nw') { newX = startCo.x + dxPct; newY = startCo.y + dyPct; newW = startCo.w - dxPct; newH = startCo.h - dyPct; }
        else if (corner === 'ne') { newY = startCo.y + dyPct; newW = startCo.w + dxPct; newH = startCo.h - dyPct; }
        else if (corner === 'sw') { newX = startCo.x + dxPct; newW = startCo.w - dxPct; newH = startCo.h + dyPct; }
        else if (corner === 'se') { newW = startCo.w + dxPct; newH = startCo.h + dyPct; }
        applyBox(co, newX, newY, newW, newH);
        _queueSave((getScene().num || getScene().id), { connectObjects: getScene().connectObjects });
      });
    });
    function endResize() {
      if (!dragging) return;
      dragging = false;
      coEl.classList.remove('connect-object--resizing');
      _flushPendingSave();
    }
    handle.addEventListener('pointerup',     e => { if (e.pointerId === pid) { try{handle.releasePointerCapture(pid);}catch(_){}; endResize(); } });
    handle.addEventListener('pointercancel', endResize);
  });
}

function _attachDrag(wrap, choiceId, frame) {
  let dragging = false, pointerId = null;
  let startX, startY, startPx, startPy;
  let rafPending = false;

  wrap.addEventListener('pointerdown', e => {
    if (e.target.closest('.choice-btn')) return;
    e.preventDefault();
    e.stopPropagation();

    dragging  = true;
    pointerId = e.pointerId;
    wrap.setPointerCapture(e.pointerId);
    wrap.classList.add('edit-dragging');
    /* ★ frame에도 dragging 상태 부여 — safe-area 강조 표시용 */
    frame.classList.add('is-choice-dragging');

    startX = e.clientX;
    startY = e.clientY;

    const scene  = ViewerState.scenes[ViewerState.currentSceneId];
    const choice = scene?.choices.find(c => c.id === choiceId);
    startPx = choice?.presentation.x ?? 50;
    startPy = choice?.presentation.y ?? 50;

    ViewerState.selectedChoiceId = choiceId;
    document.querySelectorAll('.js-edit-tab').forEach(tab => {
      tab.classList.toggle('edit-tab--active', tab.dataset.choiceId === choiceId);
    });
    frame.querySelectorAll('.choice-overlay-wrap').forEach(w => {
      w.classList.toggle('edit-selected', w.querySelector('.choice-btn')?.dataset.choiceId === choiceId);
    });
  });

  wrap.addEventListener('pointermove', e => {
    if (!dragging || e.pointerId !== pointerId) return;
    e.preventDefault();
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      const rect = frame.getBoundingClientRect();
      const dx   = ((e.clientX - startX) / rect.width)  * 100;
      const dy   = ((e.clientY - startY) / rect.height) * 100;
      const rawX = startPx + dx;
      const rawY = startPy + dy;
      const nx   = Math.max(5, Math.min(95, rawX));
      const ny   = Math.max(5, Math.min(92, rawY));

      /* ★ clamp 상태 감지 — safe area 경계 시각 피드백 */
      const atEdge = (rawX !== nx) || (rawY !== ny);
      wrap.classList.toggle('edit-dragging--at-edge', atEdge);

      const scene  = ViewerState.scenes[ViewerState.currentSceneId];
      const choice = scene?.choices.find(c => c.id === choiceId);
      if (!choice) return;

      choice.presentation.x = Math.round(nx * 10) / 10;
      choice.presentation.y = Math.round(ny * 10) / 10;

      wrap.style.left = `${choice.presentation.x}%`;
      wrap.style.top  = `${choice.presentation.y}%`;
    });
  });

  const endDrag = () => {
    dragging = false;
    wrap.classList.remove('edit-dragging');
    wrap.classList.remove('edit-dragging--at-edge');
    frame.classList.remove('is-choice-dragging');
  };

  wrap.addEventListener('pointerup', e => {
    if (!dragging || e.pointerId !== pointerId) return;
    endDrag();
    wrap.releasePointerCapture(e.pointerId);
    renderEditPanel();
  });

  wrap.addEventListener('pointercancel', endDrag);
}

/* ================================================================
   글 수정 섹션 (다듬기 화면 — 글 수정 기능 1차) ──
   ─────────────────────────────────────────────────────────────
   · 장면 제목 겸 글(textarea) — 현재 데이터 모델이 title 단일 필드
   · 선택지 문구 A/B (input) — scene.choices[i].label과 양방향 동기화
   · 잠금 안내 배너 — 다른 사람이 같은 장면 편집 중일 때 표시
   · 저장 상태 표시 — debounced 저장 중/완료/실패 피드백
   · readOnly 상태는 js에서 _applyEditLockUI()로 동기 토글
   ================================================================ */

/* ================================================================
   버튼 N개 편집 UI (v0.3)
   ─────────────────────────────────────────────────────────────
   · 입력란 N개 (data-idx로 식별)
   · 각 행에 [삭제] (단, 1개일 땐 버튼 보이지 않음 — 0개 방지)
   · 하단 [+ 버튼 추가]
   · 글자 수 카운터 (30자 권장 / 60자 한계)
   · 분기 연결(nextId)은 표시만, 이번 턴엔 변경 안 함 (구조 유지)
   ================================================================ */
/* ════ LEVELS-AUDIT F2(2026-07-18): 그림책 1·2단계 = 일직선 구조 잠금의 다듬기 판 ════
   maker(ui.js isLinearPicturebookLock)는 잠갔지만 다듬기(🔗 팝오버·우측 패널)에서
   버튼 추가/삭제·연결(nextId) 변경이 열려 있어 우회 가능하던 것 차단.
   라벨(글자) 편집은 허용 — "버튼 글자는 내 이야기에 맞게" 취지 유지. */
function _isLinearLockedViewer() {
  return !!(typeof ViewerState !== 'undefined' && ViewerState.project
    && ViewerState.project.projectType === 'picturebook'
    && (ViewerState.project.picturebookLevel === 1 || ViewerState.project.picturebookLevel === 2));
}
const _LINEAR_LOCK_MSG_VIEWER = '1·2단계 그림책은 버튼 개수와 길(연결)이 정해져 있어요.\n버튼의 글자만 바꿀 수 있어요.';

function _buttonsEditHtml(choices) {
  const _linLock = _isLinearLockedViewer();
  const rows = choices.map((c, i) => _buttonRowHtml(c, i, choices.length)).join('');

  /* 0개 상태 안내 + 추가 버튼 */
  const emptyHint = choices.length === 0
    ? `<div class="edit-field-hint edit-field-hint--warn">
         행동 버튼이 없어요. 최소 1개의 버튼이 필요합니다.
       </div>`
    : '';

  /* LEVELS-AUDIT F2: 일직선 잠금이면 [+ 버튼 추가] 대신 잠금 안내 */
  const actionsHtml = _linLock
    ? `<div class="edit-field-hint">🔒 1·2단계는 버튼 개수와 연결이 잠겨 있어요. 글자만 바꿀 수 있어요.</div>`
    : `<div class="edit-buttons-actions">
        <button type="button" class="edit-btn-add js-edit-btn-add">
          + 버튼 추가
        </button>
      </div>`;

  return `
    <div class="edit-row edit-buttons-row">
      <label class="edit-label">
        🎯 행동 버튼
        <span class="edit-label-note">(${choices.length}개)</span>
      </label>
      ${emptyHint}
      <div class="edit-buttons-list js-edit-buttons-list">
        ${rows}
      </div>
      ${actionsHtml}
    </div>`;
}

function _buttonRowHtml(choice, idx, total) {
  const label = (choice && typeof choice.label === 'string') ? choice.label : '';
  const len   = label.length;

  /* W4-D: 모드별 max 글자수 (viewer 자체 함수 — state.js 미로드 환경 대비). */
  const _ptype = (typeof ViewerState !== 'undefined' && ViewerState.project &&
                  ViewerState.project.projectType) || null;
  const maxLen = _getChoiceLabelMaxViewer(_ptype);
  /* 권장 임계: 90% 도달 시 warn (시각 안내). over는 maxLen 초과(원칙상 maxlength로 막혀 발생 X). */
  const warnAt = Math.floor(maxLen * 0.9);

  /* 글자 수 표시: 정상/권장초과/최대초과 */
  let counterClass = 'edit-btn-counter';
  if (len > maxLen) counterClass += ' edit-btn-counter--over';
  else if (len > warnAt) counterClass += ' edit-btn-counter--warn';

  /* 2026-05-28 Codex review fix (High-Risk 3): 1단과 동일 안전 정책 적용.
     · 표지 제외 / 자기 자신 disabled + [현재 장면] 라벨 / 엔딩 [엔딩] 라벨
     · 옛 정책("자기 자신도 옵션에 포함") 폐기 — 무한 루프 / 표지 회귀 위험 차단
     · 정책 단일 출처 — `_buildLinkSelectOptionsHtml` 재사용 (Phase 4-C)
     · ViewerState.currentSceneId 사용 — 다듬기 패널이 열린 시점엔 항상 존재
     · currentScene을 못 찾으면 fallback 없이 빈 옵션 — 안전 우선 (옛 무필터 옵션으로 회귀하지 않음) */
  const currentNext = choice && choice.nextId ? String(choice.nextId) : '';
  const _curSceneId = (typeof ViewerState !== 'undefined' && ViewerState.currentSceneId)
    ? String(ViewerState.currentSceneId) : '';
  const _curScene = (typeof ViewerState !== 'undefined' && ViewerState.scenes && _curSceneId)
    ? ViewerState.scenes[_curSceneId] : null;
  const optionsHtml = (_curScene && typeof _buildLinkSelectOptionsHtml === 'function')
    ? _buildLinkSelectOptionsHtml(_curScene, currentNext)
    : '';

  /* LEVELS-AUDIT F2: 일직선 잠금이면 연결 select 비활성(보기 전용) */
  const _linLockRow = _isLinearLockedViewer();
  const nextSelectHtml = `
    <select class="edit-btn-next-select js-edit-btn-next" data-idx="${idx}"${_linLockRow ? ' disabled title="1·2단계는 연결이 잠겨 있어요"' : ''}>
      <option value=""${currentNext ? '' : ' selected'}>(미연결)</option>
      ${optionsHtml}
    </select>`;

  /* 1개일 때는 삭제 버튼 숨김 (0개 방지) · 일직선 잠금이면 삭제 자체 숨김 */
  const removeBtn = (total > 1 && !_linLockRow)
    ? `<button type="button"
         class="edit-btn-remove js-edit-btn-remove"
         data-idx="${idx}"
         title="이 버튼 삭제">×</button>`
    : '';

  return `
    <div class="edit-button-row" data-idx="${idx}">
      <div class="edit-button-row-main">
        <input type="text"
          class="edit-text-input edit-text-input--choice js-edit-button-label"
          data-idx="${idx}"
          value="${escHtml(label)}"
          placeholder="버튼 문구를 입력하세요"
          maxlength="${maxLen}">
        ${removeBtn}
      </div>
      <div class="edit-button-row-meta">
        <span class="${counterClass}">
          <span class="js-edit-btn-len">${len}</span> / ${maxLen}
        </span>
        <span class="edit-btn-target">
          <span class="edit-btn-next-label">다음 →</span>
          ${nextSelectHtml}
        </span>
      </div>
    </div>`;
}


/* ================================================================
   버튼 N개 편집 이벤트 (v0.3)
   ─────────────────────────────────────────────────────────────
   · input: scene.choices[idx].label 갱신, 글자수 카운터 갱신, 저장 큐
   · 삭제 버튼: scene.choices에서 제거 → 패널 재렌더 (인덱스 재계산 필요)
   · 추가 버튼: 빈 choice 추가 → 패널 재렌더
   · 저장은 buttons 배열 전체를 직렬화해서 한 필드로 보냄
     (개별 라벨 patch 안 함 — 일관성 유지)
   ================================================================ */
function _bindButtonsEditEvents(panel, scene) {
  if (scene.type === 'ending') return;  // 엔딩은 버튼 편집 없음

  const list      = panel.querySelector('.js-edit-buttons-list');
  const addBtn    = panel.querySelector('.js-edit-btn-add');
  if (!list) return;

  /* 라벨 입력 — 모든 input.js-edit-button-label 위임 처리 */
  list.addEventListener('input', e => {
    if (!_editText.editable) return;
    const input = e.target.closest('.js-edit-button-label');
    if (!input) return;
    const idx = parseInt(input.dataset.idx, 10);
    if (isNaN(idx) || !scene.choices[idx]) return;

    /* W4-D 안전망: maxlength HTML attribute가 우회됐을 때도 데이터 단계에서 절단.
       (예: 페이스트 일부 환경, 자동완성 등) */
    const _ptype = (typeof ViewerState !== 'undefined' && ViewerState.project &&
                    ViewerState.project.projectType) || null;
    const maxLen = _getChoiceLabelMaxViewer(_ptype);
    let value = input.value;
    if (value.length > maxLen) {
      value = value.slice(0, maxLen);
      input.value = value;   /* 입력란도 즉시 잘라줌 */
    }

    scene.choices[idx].label = value;

    /* 글자수 카운터 갱신 (해당 행만) — W4-D: 모드별 max 동적 사용 */
    const row = input.closest('.edit-button-row');
    if (row) {
      const lenEl     = row.querySelector('.js-edit-btn-len');
      const counterEl = row.querySelector('.edit-btn-counter');
      const len = value.length;
      if (lenEl) lenEl.textContent = String(len);
      if (counterEl) {
        const warnAt = Math.floor(maxLen * 0.9);
        counterEl.classList.remove('edit-btn-counter--warn', 'edit-btn-counter--over');
        if (len > maxLen)      counterEl.classList.add('edit-btn-counter--over');
        else if (len > warnAt) counterEl.classList.add('edit-btn-counter--warn');
      }
    }

    /* W7 깜빡임 차단: 선택지 라벨 입력은 viewer의 해당 버튼 텍스트만 갱신.
       W8 fix: val 변수 정의 안 됨 — value(절단 적용된 실제 입력값) 사용. */
    if (!_patchChoiceLabel(idx, value)) _scheduleViewerFrameReRender();
    _syncChoiceLinkLabelPreview(idx, value);   /* 1단 [N] 라벨 미리보기 동기 */
    _queueSaveButtons(scene);
  });

  /* 행에서 포커스 빠질 때 즉시 저장 flush */
  list.addEventListener('blur', e => {
    if (e.target && e.target.classList.contains('js-edit-button-label')) {
      _flushPendingSave();
    }
  }, true);  // capture로 blur 잡음 (blur는 안 버블)

  /* 삭제 버튼 — 위임 */
  list.addEventListener('click', e => {
    const removeBtn = e.target.closest('.js-edit-btn-remove');
    if (!removeBtn) return;
    if (!_editText.editable) return;
    /* LEVELS-AUDIT F2: 일직선 잠금 — UI 숨김의 2중 방어 */
    if (_isLinearLockedViewer()) { alert(_LINEAR_LOCK_MSG_VIEWER); return; }

    const idx = parseInt(removeBtn.dataset.idx, 10);
    if (isNaN(idx) || !scene.choices[idx]) return;

    /* 1개 남은 상태에서 삭제 시도는 막힘 (UI에서 숨겼지만 방어) */
    if (scene.choices.length <= 1) return;

    scene.choices.splice(idx, 1);
    _queueSaveButtons(scene);
    _flushPendingSave();
    /* 패널 재렌더 — 인덱스가 다 바뀌므로 통째로 다시 그림 */
    renderEditPanel();    _scheduleViewerFrameReRender();
  });

  /* nextId 드롭다운 — 위임 (W2-B-α 신규).
     사용자가 버튼별 다음 장면 선택. 빈 값(미연결)도 OK.
     buttons[idx].nextId 갱신 후 _queueSaveButtons로 buttons 전체 저장. */
  list.addEventListener('change', e => {
    const sel = e.target.closest('.js-edit-btn-next');
    if (!sel) return;
    if (!_editText.editable) return;
    /* LEVELS-AUDIT F2: 일직선 잠금 — select disabled의 2중 방어 */
    if (_isLinearLockedViewer()) return;

    const idx = parseInt(sel.dataset.idx, 10);
    if (isNaN(idx) || !scene.choices[idx]) return;

    const val = sel.value || '';
    /* 빈 값 = 미연결 (null로 저장). buildButtonsPatchForSave가 nextId 없으면 키 자체 제외 */
    scene.choices[idx].nextId = val || null;
    /* nextNum도 함께 갱신 — preview 화살표 같은 곳에서 참고 */
    scene.choices[idx].nextNum = val ? Number(val) : null;

    /* 2026-05-27 Phase 4-C: 1단 선택지 연결 select 동기화 — 양방향 정합.
       1단에 같은 idx select가 있으면 value만 갱신 (옵션 정책 동일성은 다음
       렌더 시점에 보장 — 옵션 자체 변경은 거의 발생 안 함). */
    const linkSel1 = panel.querySelector(`.js-pb-choice-link[data-idx="${idx}"]`);
    if (linkSel1 && linkSel1.value !== val) linkSel1.value = val;

    _queueSaveButtons(scene);
    _flushPendingSave();
    _scheduleViewerFrameReRender();
  });

  /* 추가 버튼 */
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (!_editText.editable) return;
      /* LEVELS-AUDIT F2: 일직선 잠금 — UI 숨김의 2중 방어 */
      if (_isLinearLockedViewer()) { alert(_LINEAR_LOCK_MSG_VIEWER); return; }

      const newIdx = scene.choices.length;
      const newId  = (typeof _autoChoiceId === 'function')
        ? _autoChoiceId(newIdx)
        : String.fromCharCode(65 + newIdx);

      scene.choices.push({
        id: newId,
        label: '',
        nextId: null,
        presentation: (typeof defaultPresentation === 'function')
          ? defaultPresentation(newId)
          : { placement: 'bottom' },
      });

      _queueSaveButtons(scene);
      _flushPendingSave();
      renderEditPanel();
      _scheduleViewerFrameReRender();
    });
  }
}

/* buttons 배열 전체를 직렬화해서 저장 큐에 올림.
   _queueSave는 같은 sceneId의 같은 필드를 덮어쓰므로 연타 안전.
   maker 호환 (옵션 2): buildButtonsPatchForSave가 buttons + choiceA/B/count를
   함께 patch로 만들어 한번에 저장. 이러면 maker가 choiceA/B만 읽어도 정합. */
function _queueSaveButtons(scene) {
  if (typeof buildButtonsPatchForSave === 'function') {
    const patch = buildButtonsPatchForSave(scene.choices);
    _queueSave(scene.id, patch);
  } else {
    /* fallback (헬퍼 미정의) — buttons만 저장 */
    const buttons = (typeof serializeChoicesForSave === 'function')
      ? serializeChoicesForSave(scene.choices)
      : (scene.choices || []).map(c => ({
          id: c.id, label: c.label || '',
          ...(c.nextId ? { nextId: String(c.nextId) } : {}),
        }));
    _queueSave(scene.id, { buttons });
  }
}

/* ================================================================
   ★ 유형별 다듬기 섹션 (3단계 신규)
   ─────────────────────────────────────────────────────────────
   원칙:
   · 기존 edit shell(액션바/네비/제목·본문·선택지/저장 버튼)은 그대로
   · 가운데 ②번 영역(=장면 설정)을 작품 유형별로 분기
   · scene 단위 모드 카드(_modePickerHtml)와 legacy 레이아웃 토글
     (_sceneTemplateHtml의 layoutTemplate/textAnchor)은 1단계 이후 의미 없어짐
     → 호출 위치를 _typeSectionsHtml로 교체. 함수 자체는 dead code로 남김
   · 사용자 원칙: 새 디자인 발명 X — 기존 .edit-row / .edit-toggle-group 톤 그대로

   설계문서 §3-1 기준:
   · text: 제목/본문/선택지 + 글자박스 자유도 (3단계는 진입점만)
   · picturebook: 이미지 업로드 + 바로 그리기 + 하위 모드 (분할형/그림 중심형)
   · movie: 미디어 업로드 + 본문 사용 ON/OFF + 미디어 타입 표시
   · experience: 배경 이미지 + 연결 오브젝트 진입점 (정식 모델 향후)
   ================================================================ */

/* v64: 작품 단위 설정 위치 판단 — 표지 없는 작품에선 entry/첫 normal scene에 표시 */
function _isWorkSettingScene(scene) {
  const list = (typeof _editSceneList === 'function') ? _editSceneList() : [];
  const hasCover = list.some(s => s && (s.type === 'cover' || s.isCover));
  if (hasCover) return false; // 표지 있으면 표지에만
  const entryId = ViewerState.project && ViewerState.project.entrySceneId;
  if (entryId) return String(scene.id) === String(entryId);
  return list.length > 0 && list[0] && String(list[0].id) === String(scene.id);
}

/* v75: 첫 일반 장면 판단 (cover/ending 제외) — 글자 스타일 "모든 장면에 적용" 버튼 위치.
   entrySceneId 있으면 그것 기준, 없으면 정렬된 normal scene 중 첫 것. */
function _isFirstNormalScene(scene) {
  if (!scene || scene.type === 'cover' || scene.type === 'ending') return false;
  const entryId = ViewerState.project && ViewerState.project.entrySceneId;
  if (entryId) return String(scene.id) === String(entryId);
  const list = (typeof _editSceneList === 'function') ? _editSceneList() : [];
  const normals = list.filter(s => s && s.type !== 'cover' && s.type !== 'ending');
  return normals.length > 0 && String(normals[0].id) === String(scene.id);
}

/* v75: "이 글자 스타일을 모든 장면에 적용" 버튼 HTML — 첫 일반 장면 인스펙터에만 표시.
   누르면 현재 scene의 textStyle을 다른 모든 normal scene에 복사 (Firebase update).
   표지/엔딩 제외. 한 번 누르면 한 번 push — 그 후 장면별로 따로 바꾸는 건 독립. */
function _applyStyleAllButtonHtml(scene) {
  if (!_isFirstNormalScene(scene)) return '';
  return `
    <div class="edit-row edit-row--compact" style="margin-top:8px;">
      <button type="button" class="js-apply-style-all edit-apply-all-btn"
        data-scene-id="${scene.id}"
        style="width:100%;padding:9px 12px;border:1.5px solid #c66f4a;background:#fffaee;color:#c66f4a;border-radius:8px;font-weight:600;cursor:pointer;font-size:13px;">
        📋 지금 있는 모든 장면에 복사
      </button>
      <div class="edit-section-hint" style="margin-top:6px;">
        이 버튼은 <b>장면 1에만</b> 있어요. 장면 1에서 정한 테마·글꼴·크기·색이 기준이 되어 다른 장면에 똑같이
        복사돼요. (앞으로 새로 만드는 장면에는 자동 적용되지 않아요.)
      </div>
    </div>`;
}

/* v64: 작품 단위 설정 UI — 장면 전환 효과 5개 + 텍스트 등장 6개
   v73: 속도를 pill(3단계)에서 슬라이더(0~100%)로. 더 정밀한 조정 + 더 느린 범위 가능. */
function _workSettingsSectionHtml() {
  const curT  = (ViewerState.project && ViewerState.project.sceneTransition) || 'fade';
  const curTE = (ViewerState.project && ViewerState.project.textEntrance) || 'none';
  /* v73: 속도 number(0~100). 옛 데이터는 로드 시점에 마이그레이션됨. */
  const curS  = typeof ViewerState.project?.sceneTransitionSpeed === 'number'
    ? ViewerState.project.sceneTransitionSpeed : 50;
  const curTES = typeof ViewerState.project?.textEntranceSpeed === 'number'
    ? ViewerState.project.textEntranceSpeed : 50;

  const TRANS = [
    { id: 'none',     label: '⛔ 없음' },
    { id: 'fade',     label: '✨ 부드럽게' },
    { id: 'book',     label: '📖 책 넘기기' },
    { id: 'scale',    label: '🔍 확대' },
    { id: 'slide-up', label: '⬆ 슬라이드' },
    { id: 'flip3d',   label: '🎴 책 펴기' },
  ];
  const TEXT_ENT = [
    { id: 'none',       label: '✨ 없음' },
    { id: 'fade',       label: '🌫 페이드' },
    { id: 'slide-up',   label: '⬆ 슬라이드' },
    { id: 'blur-in',    label: '🔮 또렷' },
    { id: 'pop',        label: '🎈 팝' },
    { id: 'typewriter', label: '⌨ 타자기' },
  ];
  const transPills = TRANS.map(t => `
    <button type="button" class="edit-toggle js-scene-transition ${curT === t.id ? 'active' : ''}"
      data-val="${t.id}">${t.label}</button>`).join('');
  const textEntPills = TEXT_ENT.map(t => `
    <button type="button" class="edit-toggle js-text-entrance ${curTE === t.id ? 'active' : ''}"
      data-val="${t.id}">${t.label}</button>`).join('');
  return `
    <div class="edit-row">
      <label class="edit-label">🎞 장면 전환 효과 <span class="edit-label-note">(작품 전체)</span></label>
      <div class="edit-section-hint">장면이 바뀔 때 적용되는 효과예요. 모든 장면에 적용돼요. (눈이 피로하면 ‘없음’으로 끌 수 있어요.)</div>
      <div class="edit-toggle-group" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
        ${transPills}
      </div>
    </div>
    <div class="edit-row edit-row--compact">
      <label class="edit-label">⏱ 전환 속도 <span class="edit-label-note">(빠름 ◀ ${curS}% ▶️ 느림)</span></label>
      <input type="range" class="edit-slider js-scene-transition-speed"
        min="0" max="100" step="1" value="${curS}">
    </div>
    <div class="edit-row">
      <label class="edit-label">📝 텍스트 등장 효과 <span class="edit-label-note">(작품 전체)</span></label>
      <div class="edit-section-hint">본문이 나타날 때 적용되는 효과예요. 모든 장면에 똑같이 적용돼요.</div>
      <div class="edit-toggle-group" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
        ${textEntPills}
      </div>
    </div>
    <div class="edit-row edit-row--compact">
      <label class="edit-label">⏱ 텍스트 속도 <span class="edit-label-note">(빠름 ◀ ${curTES}% ▶️ 느림)</span></label>
      <input type="range" class="edit-slider js-text-entrance-speed"
        min="0" max="100" step="1" value="${curTES}">
      <div class="edit-section-hint">행동 버튼은 텍스트 등장 끝난 후 자동으로 부드럽게 나타나요.</div>
    </div>`;
}

/* v64: 작품 단위 설정 핸들러 — js-scene-transition / js-scene-transition-speed 클릭 시 저장
   v71: 텍스트 등장 효과/속도 핸들러 추가 */
function _bindWorkSettingsHandlers(panel) {
  if (!panel) return;
  panel.querySelectorAll('.js-scene-transition').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.val || 'fade';
      panel.querySelectorAll('.js-scene-transition').forEach(b =>
        b.classList.toggle('active', b === btn));
      _saveProjectMetaField('sceneTransition', val);
      if (typeof previewWorkEffect === 'function') previewWorkEffect('sceneTransition');
    });
  });
  panel.querySelectorAll('.js-text-entrance').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.val || 'none';
      panel.querySelectorAll('.js-text-entrance').forEach(b =>
        b.classList.toggle('active', b === btn));
      _saveProjectMetaField('textEntrance', val);
      if (typeof previewWorkEffect === 'function') previewWorkEffect('textEntrance');
    });
  });
  /* v73: 슬라이더 — input 시 즉시 ViewerState + CSS 변수 + 미리보기, change(드래그 끝)에 Firebase 저장. */
  _bindSpeedSlider(panel, '.js-scene-transition-speed', 'sceneTransitionSpeed');
  _bindSpeedSlider(panel, '.js-text-entrance-speed',    'textEntranceSpeed');
}

/* v73: 속도 슬라이더 헬퍼 — input 즉시 반영(미리보기), change(드래그 끝)에 Firebase 저장. */
/* v121: previewWorkEffect throttle — 슬라이더 input마다 매번 실행하지 않음.
   previewWorkEffect는 scene.offsetWidth 강제 reflow + typewriter span 재생성을 일으킴.
   슬라이더 조작 중 매 input마다 실행하면 태블릿/저성능 PC가 버거움. 150ms throttle 적용.
   저장은 change에서 하는 옛 방식 그대로. */
let _previewWorkTimer = null;
let _previewWorkLastField = null;
function _schedulePreviewWorkEffect(field) {
  _previewWorkLastField = field;
  if (_previewWorkTimer) return;
  _previewWorkTimer = setTimeout(() => {
    _previewWorkTimer = null;
    if (typeof previewWorkEffect === 'function' && _previewWorkLastField) {
      previewWorkEffect(_previewWorkLastField);
    }
  }, 150);
}

function _bindSpeedSlider(panel, selector, field) {
  const slider = panel.querySelector(selector);
  if (!slider) return;
  /* 라벨의 ${curS}% 갱신용 */
  const label = slider.closest('.edit-row')?.querySelector('.edit-label-note');

  slider.addEventListener('input', () => {
    const pct = Math.max(0, Math.min(100, parseInt(slider.value, 10) || 0));
    if (!ViewerState.project) return;
    ViewerState.project[field] = pct;
    /* CSS 변수 + dataset 갱신 (Firebase 없이) */
    const vf = document.getElementById('viewer-frame');
    if (vf && typeof applyWorkEffectVars === 'function') {
      applyWorkEffectVars(vf,
        ViewerState.project.sceneTransitionSpeed,
        ViewerState.project.textEntranceSpeed,
        ViewerState.project.textEntrance);
    }
    if (label) {
      label.textContent = `(빠름 ◀ ${pct}% ▶️ 느림)`;
    }
    /* v121: 미리보기 throttle (옛엔 매 input마다 실행 → 태블릿 부담) */
    _schedulePreviewWorkEffect(field);
  });
  slider.addEventListener('change', async () => {
    const pct = Math.max(0, Math.min(100, parseInt(slider.value, 10) || 0));
    /* v122: change 시 마지막 값으로 CSS 변수 재적용 + preview 한 번 더.
       v121 throttle 때문에 마지막 input 값이 pending 상태로 남을 수 있음.
       change 시점에 최종 값으로 다시 적용해 정합 보장. */
    if (ViewerState.project) {
      ViewerState.project[field] = pct;
      const vf = document.getElementById('viewer-frame');
      if (vf && typeof applyWorkEffectVars === 'function') {
        applyWorkEffectVars(vf,
          ViewerState.project.sceneTransitionSpeed,
          ViewerState.project.textEntranceSpeed,
          ViewerState.project.textEntrance);
      }
      if (typeof previewWorkEffect === 'function') previewWorkEffect(field);
    }
    await _saveProjectMetaField(field, pct);
  });
}

/* v75: "이 글자 스타일을 모든 장면에 적용" 버튼 핸들러.
   첫 일반 장면 인스펙터에만 있는 버튼. 클릭 시 현재 scene의 textStyle을 다른
   모든 normal scene에 push (Firebase update). 표지/엔딩 제외. */
function _bindApplyStyleAllHandlers(panel, scene) {
  if (!panel || !scene) return;
  const btn = panel.querySelector('.js-apply-style-all');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    const style = (typeof getTextStyle === 'function') ? getTextStyle(scene) : null;
    if (!style) return;
    /* 2026-05-31 Text-3A: 전체 적용에 테마(textTheme)도 포함 — textStyle만 복사하던 옛 동작은
       스타일을 전부 맞춰도 테마가 장면별로 남아 불일치였음. 새 필드 추가 아님(기존 textTheme).
       일반 장면만 대상(표지=coverTheme / 엔딩=별개 시스템이라 textTheme 미적용). */
    const theme = (typeof getTextTheme === 'function') ? getTextTheme(scene) : (scene.textTheme || 'classic');

    const list = (typeof _editSceneList === 'function') ? _editSceneList() : [];
    /* v75 fix: ViewerState.scenes는 num 필드 없고 id만 있음 (adaptScenes에서 id = String(raw.num)).
       Firebase 노드 키도 num 값과 동일하니 s.id 그대로 saveSceneText(id) 호출 OK.
       2026-05-31 Text-4: 텍스트 모드는 엔딩도 textTheme/textStyle을 쓰므로(Text-4로 일반 장면과
       동일 판형) 전체 적용 대상에 엔딩 포함. 표지(coverTheme 별개)는 계속 제외.
       2026-06-30 IMAGE-S2 정리: 그림책 엔딩도 렌더가 textStyle/textTheme을 읽으므로(viewer-render renderTerminal)
       '모든 페이지 적용'에 포함 — 일반 장면만 꾸며지고 엔딩만 안 먹던 불일치 해소. 무비/체험은 옛대로 제외. */
    const _ptype = (ViewerState && ViewerState.project) ? ViewerState.project.projectType : null;
    const _includeEnding = (_ptype === 'text' || _ptype === 'picturebook');
    const targets = list.filter(s => {
      if (!s) return false;
      if (s.type === 'cover' || s.isCover) return false;
      if (!_includeEnding && (s.type === 'ending' || s.isEnding)) return false;
      if (String(s.id) === String(scene.id)) return false;
      if (typeof s.id === 'undefined' || s.id === null) return false;
      return true;
    });
    if (!targets.length) {
      const orig = btn.textContent;
      btn.textContent = '다른 장면이 없어요';
      setTimeout(() => { btn.textContent = orig; }, 1500);
      return;
    }

    /* Phase 4-A: s1/s2 보기 중엔 원본 scenes 일괄 저장 금지. */
    if (_isVariantViewLocked()) { _showSaveStatus('AI 버전은 보기 전용입니다. 편집은 원본에서 해 주세요.', 2500); return; }

    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ 적용 중...';

    /* REFINE-IA-2.1: 복사한 스타일을 "의도적 예외"로 marker 부여 → 작품 기본값이 있어도 복사가 유지됨
       ("이 스타일을 모든 장면에 적용"의 직관과 일치). defer 값(빈 색/null 폰트)은 marker 무의미하므로 제외. */
    const styleMark = {};
    if (style.fontFamily) styleMark.fontFamily = true;
    if (typeof style.fontSize === 'number') styleMark.fontSize = true;
    if (style.color) styleMark.color = true;
    if (style.weight) styleMark.weight = true;

    let okCount = 0;
    let failCount = 0;
    for (const s of targets) {
      try {
        await saveSceneText(s.id, { textStyle: { ...style }, textStyleOverride: { ...styleMark }, textTheme: theme, textThemeOverride: true });
        /* in-memory scene 데이터도 즉시 갱신 — 다음 인스펙터가 열릴 때 반영 */
        s.textStyle = { ...style };
        s.textStyleOverride = { ...styleMark };
        s.textTheme = theme;
        s.textThemeOverride = true;
        okCount++;
      } catch (e) {
        console.warn('[applyStyleAll] failed scene', s.id, e);
        failCount++;
      }
    }

    btn.textContent = failCount > 0
      ? `✓ ${okCount}개 적용 / ${failCount}개 실패`
      : `✓ ${okCount}개 장면에 적용됐어요`;
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = orig;
    }, 2400);
  });
}

/* v64: 작품 단위 메타 저장 (viewer-meta/sceneTransition, sceneTransitionSpeed 등)
   v73: 속도 string → number(0~100). viewer-frame CSS 변수도 applyWorkEffectVars로 통일. */
async function _saveProjectMetaField(field, value) {
  if (!ViewerState.project) return;
  ViewerState.project[field] = value;
  /* viewer-frame data + CSS 변수 즉시 갱신 — 다음 scene 렌더 시 새 효과 */
  const vf = document.getElementById('viewer-frame');
  if (vf) {
    if (field === 'sceneTransition') vf.dataset.transition   = value;
    if (field === 'textEntrance')    vf.dataset.textEntrance = value;
    if (typeof applyWorkEffectVars === 'function') {
      applyWorkEffectVars(vf,
        ViewerState.project.sceneTransitionSpeed,
        ViewerState.project.textEntranceSpeed,
        ViewerState.project.textEntrance);
    }
  }
  /* Firebase 저장 */
  const teamName = ViewerState.project.teamName;
  const classId  = ViewerState.project.classId;
  if (!teamName) return;
  const encodedName = encodeURIComponent(teamName);
  const basePath = classId
    ? `classes/${classId}/teams/${encodedName}`
    : `teams/${encodedName}`;
  try {
    const db = (typeof getViewerDb === 'function') ? getViewerDb() : null;
    if (!db) return;
    const patch = {};
    patch[field] = value;
    await db.ref(`${basePath}/viewer-meta`).update(patch);
  } catch (e) {
    console.warn('[sceneTransition] save failed', field, e);
    /* FINAL-REVIEW-C3: 효과/전환 저장 실패가 조용히 묻히던 silent fail 해소 —
       본문 저장과 동일한 상태 문구 재사용(메모리 값은 이미 반영돼 화면은 동작,
       새로고침 시 되돌아갈 수 있음을 사용자가 인지하도록). */
    if (typeof _showSaveStatus === 'function') _showSaveStatus('❌ 저장 실패', 2000);
  }
}

/* v37: 표지 전용 인스펙터 — 제목 + 한 줄 소개 + 표지 색 + 제목 높낮이.
   사용자 결정: 표지는 별도 레이아웃, 그림·선택지 X. 항상 가운데 정렬. */
/* TOP-TOOLBAR-3A: 표지 색 row helper — 우측 표지 인스펙터(_typeSectionCoverHtml)와
   상단 "🎨 표지" 팝오버가 같은 HTML을 재사용한다. HTML 이동만 — 색 목록/active/
   class(js-cover-theme)/data-val 무변경. 저장·핸들러는 기존 그대로(_queueSave coverTheme). */
function _coverThemeRowHtml(scene) {
  /* v67: 5 → 10개로 확장. 색 풍부하게. */
  const COVER_THEMES = [
    { id: 'default', label: '기본',   color: '#fffaee' },
    { id: 'cream',   label: '크림',   color: '#f4ecd8' },
    { id: 'sage',    label: '연두',   color: '#e8efde' },
    { id: 'sky',     label: '하늘',   color: '#dde8f2' },
    { id: 'coral',   label: '코랄',   color: '#f4dccf' },
    { id: 'peach',   label: '복숭아', color: '#fce0d6' },
    { id: 'lilac',   label: '라일락', color: '#e6dcf0' },
    { id: 'mint',    label: '민트',   color: '#d8ecdf' },
    { id: 'lemon',   label: '레몬',   color: '#fbf2c4' },
    { id: 'rose',    label: '장미',   color: '#f5d0d0' },
  ];
  const curTheme = (scene && scene.coverTheme) || 'default';
  const themePills = COVER_THEMES.map(t => `
    <button type="button"
      class="edit-cover-theme js-cover-theme ${curTheme === t.id ? 'active' : ''}"
      data-val="${t.id}"
      style="background:${t.color};"
      title="${t.label}"></button>`).join('');
  /* TOP-TOOLBAR-3B: wrapper에 modifier class 추가 — 우측 표지 패널(#edit-panel)에서만
     이 row를 숨기기 위한 scope hook. 팝오버 사본도 같은 class를 갖지만 #edit-panel 밖이라
     숨김 대상 아님(2B의 edit-row--pb-choice-* 패턴과 동일). 시각/저장 영향 없음. */
  return `
    <div class="edit-row edit-row--cover-theme">
      <label class="edit-label">🎨 표지 색</label>
      <div class="edit-cover-theme-row">${themePills}</div>
    </div>`;
}

/* TOP-TOOLBAR-4A: 제목 높낮이 row helper — 우측 표지 인스펙터(_typeSectionCoverHtml)와
   상단 "🎨 표지" 팝오버가 같은 HTML을 재사용한다. HTML 이동만 — class(js-cover-title-y)·
   min/max/step/value·label 구조 무변경. 저장·핸들러는 기존 그대로(_queueSave titleVerticalPosition). */
function _coverTitleYRowHtml(scene) {
  const titleY = (scene && typeof scene.titleVerticalPosition === 'number') ? scene.titleVerticalPosition : 50;
  /* TOP-TOOLBAR-4B: wrapper에 modifier class 추가 — 우측 표지 패널(#edit-panel)에서만
     이 row를 숨기기 위한 scope hook. 팝오버 사본도 같은 class를 갖지만 #edit-panel 밖이라
     숨김 대상 아님(3B의 edit-row--cover-theme 패턴과 동일). edit-row--compact 유지. */
  return `
    <div class="edit-row edit-row--compact edit-row--cover-title-y">
      <label class="edit-label">↕ 제목 높낮이 <span class="edit-label-note">(${titleY}%)</span></label>
      <input type="range" class="edit-slider js-cover-title-y"
        min="20" max="80" step="5" value="${titleY}">
      <div class="edit-section-hint">위쪽(20) ↔ 가운데(50) ↔ 아래쪽(80). 가운데 정렬은 유지.</div>
    </div>`;
}


/* TEXT-MODE-1B: text 모드 글자 스타일/테마/효과 컨트롤을 순수 HTML helper로 분리.
   _typeSectionTextHtml 인라인(접이식 body 내용)을 그대로 추출 — class/selector/data
   (js-edit-text-*) 무변경, 렌더 결과 동일. 접이식 wrapper/header는 _typeSectionTextHtml에
   유지. "모든 장면 적용"은 helper 제외. 다음 단계(1C)에서 🎭 팝오버가 같은 helper 재사용.
   저장/핸들러/variant 로직 무관(HTML만). */
function _textGlyphStyleSectionHtml(scene, opts) {
  /* REFINE-IA-2: opts.style = 표시할 스타일 직접 주입(작품 기본값 탭). 없으면 scene resolved.
     opts.noWeight = 굵기 행 숨김(작품 기본값 범위 밖). opts.overrideChips = 장면 탭 per-field "기본값" 칩. */
  opts = opts || {};
  const style = opts.style
    ? opts.style
    : ((typeof getTextStyle === 'function') ? getTextStyle(scene) : { fontFamily: 'gothic', fontSize: 16, color: '', weight: 'normal' });
  const _fsDisp = opts.style
    ? ((typeof style.fontSize === 'number' && !isNaN(style.fontSize)) ? style.fontSize : 18)
    : (function () { const v = _displayFontSize(scene, style); return (typeof v === 'number' && !isNaN(v)) ? v : style.fontSize; })();
  const _ovr = opts.overrideChips || {};
  const _chip = (field) => _ovr[field]
    ? `<button type="button" class="js-scene-style-reset-field edit-style-reset-chip" data-field="${field}" title="이 항목을 이야기 전체 기본값으로 되돌리기">전체 기본값</button>`
    : '';
  /* T-THEME-1: 지원(로드+매핑+allowlist) 글씨체만 노출. 맨 위 "테마 기본 글씨체"(value '')은
     fontFamily null → 현재 테마의 기본 글씨체 사용. 미지원 레거시(notosans 등)는 숨김(데이터는 보존). */
  const FONTS = [
    { id: 'gothic',     label: '나눔고딕' },
    { id: 'batang',     label: '고운바탕' },
    { id: 'hahmlet',    label: 'Hahmlet (세련 명조)' },
    { id: 'diphylleia', label: 'Diphylleia (우아 명조)' },
    { id: 'cormorant',  label: 'Cormorant' },
    { id: 'jua',        label: '주아' },
    { id: 'hanna',      label: '한나 (굵은 헤드라인)' },
    { id: 'pen',        label: '나눔펜' },
    { id: 'gaegu',      label: '개구' },
    { id: 'galmuri',    label: '갈무리 (픽셀)' },
  ];
  const _isThemeDefaultFont = !style.fontFamily || style.fontFamily === 'auto';
  const fontOptions = `<option value="" ${_isThemeDefaultFont ? 'selected' : ''}>테마 기본 글씨체</option>`
    + FONTS.map(f => {
    const ff = (TEXT_FONT_FAMILIES && TEXT_FONT_FAMILIES[f.id]) || 'inherit';
    return `<option value="${f.id}"
      style="font-family:${ff}"
      ${style.fontFamily === f.id ? 'selected' : ''}>${f.label}</option>`;
  }).join('');
  const COLORS = ['', '#1a1a1a', '#d4453d', '#e87a2a', '#f2b417', '#4a7d3a', '#2c6cb4', '#6a3eb0', '#c94785', '#6a3814', '#7a7a7a', '#5cb0d4', '#a8d65c', '#f4cba8'];
  const colorBtns = COLORS.map(c => {
    const isActive = (style.color || '') === c;
    const label = c === '' ? '기본' : '';
    return `<button type="button"
      class="edit-color-btn js-edit-text-color ${isActive ? 'active' : ''}"
      data-val="${c}"
      style="${c ? `background:${c};` : 'background:repeating-conic-gradient(#eee 0 25%,#fff 0 50%) 50%/8px 8px;'}"
      title="${c || '기본 (테마 색)'}"
      >${label}</button>`;
  }).join('');
  const weightRow = opts.noWeight ? '' : `
          <div class="edit-row">
            <label class="edit-label">굵기 ${_chip('weight')}</label>
            <div class="edit-toggle-group">
              <button type="button" class="edit-toggle js-edit-text-weight ${style.weight === 'normal' ? 'active' : ''}" data-val="normal">보통</button>
              <button type="button" class="edit-toggle js-edit-text-weight ${style.weight === 'bold' ? 'active' : ''}" data-val="bold">굵게</button>
            </div>
          </div>`;
  return `
          <div class="edit-row">
            <label class="edit-label">폰트 ${_chip('fontFamily')}</label>
            <select class="edit-font-select js-edit-text-font"
              style="${style.fontFamily && style.fontFamily !== 'auto' ? `font-family:var(--font-${style.fontFamily})` : ''}">${fontOptions}</select>
          </div>

          <div class="edit-row">
            <label class="edit-label">글자 크기 <span class="edit-label-note">(${_fsDisp}px)</span> ${_chip('fontSize')}</label>
            <input type="range" class="edit-slider js-edit-text-size"
              min="12" max="50" step="1" value="${_fsDisp}">
          </div>

          <div class="edit-row">
            <label class="edit-label">글자 색 ${_chip('color')}</label>
            <div class="edit-color-row">${colorBtns}</div>
            <input type="color" class="edit-color-picker js-edit-text-color-pick"
              value="${style.color || '#1a1a1a'}" title="자유 색 선택">
          </div>
${weightRow}`;
}

function _textThemeSectionHtml(scene, opts) {
  /* REFINE-IA-2: opts.theme = 표시할 테마 직접 주입(작품 기본값 탭). opts.overrideChip = 장면 테마 "기본값" 칩. */
  opts = opts || {};
  const theme = opts.theme || ((typeof getTextTheme === 'function') ? getTextTheme(scene) : 'classic');
  const _themeChip = opts.overrideChip
    ? `<button type="button" class="js-scene-style-reset-field edit-style-reset-chip" data-field="theme" title="테마를 이야기 전체 기본값으로 되돌리기">전체 기본값</button>`
    : '';
  /* T-THEME-1: 정본 6종만. novel/magazine 제외(기존 작품은 로드 시 paperbook/classic으로 폴백). */
  const THEMES = [
    { id: 'classic',     label: '담백한 글',     desc: '깨끗한 기본 읽기' },
    { id: 'paperbook',   label: '고전 기록',     desc: '오래된 종이 톤' },
    { id: 'note',        label: '이야기 노트',   desc: '공책에 적은 기록' },
    { id: 'handwriting', label: '편지와 일기',   desc: '따뜻한 편지지' },
    { id: 'retro',       label: '레트로 게임',   desc: '어두운 픽셀 화면' },
    { id: 'dark',        label: '밤의 미스터리', desc: '짙은 남색·금색' },
  ];
  const themeCards = THEMES.map(t => `
    <button type="button"
      class="edit-theme-card edit-theme-card--${t.id} js-edit-text-theme ${theme === t.id ? 'active' : ''}"
      data-val="${t.id}">
      <div class="edit-theme-card-name">${t.label}</div>
      <div class="edit-theme-card-desc">${t.desc}</div>
    </button>`).join('');
  return `
          ${_themeChip ? `<div class="edit-style-reset-chip-row">${_themeChip}</div>` : ''}
          <div class="edit-theme-grid">${themeCards}</div>
          <div class="edit-section-hint">테마는 카드 배경/테두리/기본 폰트 톤을 결정합니다. 폰트·크기·색은 위에서 별도 조절 가능.</div>`;
}

function _textEffectSectionHtml(scene) {
  const effect = (typeof getTextEffect === 'function') ? getTextEffect(scene) : { entrance: 'none', body: 'none' };
  return `
          <div class="edit-section-hint" style="margin-bottom:6px;">장면 진입 효과</div>
          <div class="edit-toggle-group">
            <button type="button" class="edit-toggle js-edit-text-entrance ${effect.entrance === 'none' ? 'active' : ''}" data-val="none">없음</button>
            <button type="button" class="edit-toggle js-edit-text-entrance ${effect.entrance === 'fade' ? 'active' : ''}" data-val="fade">페이드인</button>
            <button type="button" class="edit-toggle js-edit-text-entrance ${effect.entrance === 'slide' ? 'active' : ''}" data-val="slide">슬라이드</button>
          </div>
          <div class="edit-section-hint" style="margin:10px 0 6px;">본문 표시 효과</div>
          <div class="edit-toggle-group">
            <button type="button" class="edit-toggle js-edit-text-body-effect ${effect.body === 'none' ? 'active' : ''}" data-val="none">없음</button>
            <button type="button" class="edit-toggle js-edit-text-body-effect ${effect.body === 'typewriter' ? 'active' : ''}" data-val="typewriter">타자기</button>
          </div>`;
}

/* ── 1) 텍스트형 전용 섹션 ─────────────────────────────────────
   기준 노출: 글자박스 편집(폰트/크기/색/굵기), 효과, 테마
   3단계 범위: 진입점 자리만 잡고 "추후 추가" 안내. 미구현 기능은 발명 안 함. */

/* ────────────────────────────────────────────────────────────
   2026-05-25 Phase 2: 양옆 마감 테마 helper (재사용 가능).
   이전엔 _typeSectionPicturebookHtml 안 IIFE로 inline으로 들어 있었음.
   · 표지 분기 _typeSectionCoverHtml + picturebook 첫 일반 장면 두 곳에서 호출.
   · 기존 상태 변수 _pbThemeCollapsed / _getPbThemeCollapsed() 그대로 사용.
   · 기존 이벤트 핸들러 .js-pb-theme-toggle / .js-pb-theme 그대로 (panel.querySelectorAll 매칭).
   · 작품 단위 데이터(ViewerState.project.pbTheme / viewer-meta.pbTheme) 그대로.
   ──────────────────────────────────────────────────────────── */
function _pbThemeSectionHtml() {
  /* D5: UI 목록은 신규 5스킨만 노출. 기존 legacy 6키는 데이터로 보존하되 목록에서 숨김. */
  const PB_THEMES = [
    { id: 'cozy-storybook',      label: '포근한 동화책', desc: '크림빛 종이' },
    { id: 'paper-storybook',     label: '종이 동화책',   desc: '낡은 종이결' },
    { id: 'gallery-picturebook', label: '전시 그림책',   desc: '흰 액자 여백' },
    { id: 'forest-storybook',    label: '숲속 그림책',   desc: '잎·덩굴 가장자리' },
    /* NIGHT-THEME-RETIRE(2026-07-09): '밤 이야기'는 피커에서 폐기(사용자 결정). CSS·검증배열(PB_THEMES)·
       기존 작품 저장값은 보존 — 이미 밤테마인 작품은 계속 정상 렌더, 신규 선택만 불가. */
  ];
  /* legacy 키 작품을 열면 normalize한 신규 키가 active로 표시(DB 값은 불변). */
  const current  = (typeof normalizePicturebookTheme === 'function')
    ? normalizePicturebookTheme(ViewerState.project.pbTheme)
    : (ViewerState.project.pbTheme || 'cozy-storybook');
  const currentT = PB_THEMES.find(t => t.id === current) || PB_THEMES[0];
  const collapsed = _getPbThemeCollapsed();

  const cardsHtml = PB_THEMES.map(t => `
    <button type="button"
      class="edit-pb-theme-card edit-pb-theme-card--${t.id} js-pb-theme ${current === t.id ? 'active' : ''}"
      data-val="${t.id}">
      <div class="edit-pb-theme-preview"><div class="edit-pb-theme-preview-page"></div></div>
      <div class="edit-pb-theme-name">${t.label}</div>
      <div class="edit-pb-theme-desc">${t.desc}</div>
    </button>`).join('');

  return `
    <div class="edit-row">
      <button type="button"
        class="edit-pb-theme-toggle js-pb-theme-toggle ${collapsed ? 'is-collapsed' : 'is-expanded'}"
        aria-expanded="${!collapsed}">
        <span class="edit-pb-theme-toggle-left">
          ${collapsed
            ? `<span class="edit-pb-theme-toggle-mini edit-pb-theme-card--${currentT.id}"></span>`
            : ''}
          <span class="edit-pb-theme-toggle-text">
            🎨 양옆 마감 테마${collapsed ? ` <span class="edit-pb-theme-toggle-current">— ${currentT.label}</span>` : ''}
          </span>
        </span>
        <span class="edit-pb-theme-toggle-chev">${collapsed ? '▼' : '▲'}</span>
      </button>
      ${collapsed ? '' : `
        <div class="edit-pb-theme-body">
          <div class="edit-pb-theme-grid">${cardsHtml}</div>
        </div>`}
    </div>`;
}

/* 2026-05-27 Phase 4-B: 그림책 1단 — 행동 버튼 개수 조작 섹션 HTML.
   일반 장면에만 표시. 표지는 _typeSectionsHtml에서 _typeSectionCoverHtml로
   분기되므로 여기 안 옴. 엔딩은 같은 함수에 들어오므로 여기서 명시 제외.
   추가/삭제는 _pbAddChoiceForScene / _pbRemoveLastChoiceForScene 통해 처리 —
   우측 2단의 _bindButtonsEditEvents와 동일하게 _queueSaveButtons 재사용. */
function _pbChoiceCountSectionHtml(scene) {
  if (!scene) return '';
  if (scene.type === 'ending' || scene.isEnding) return '';
  /* LEVELS-AUDIT F2: 일직선 잠금이면 개수 섹션(추가/마지막 삭제) 자체를 숨김 */
  if (_isLinearLockedViewer()) return '';
  const count = Array.isArray(scene.choices) ? scene.choices.length : 0;
  const removeDisabled = count <= 1;
  const removeAttrs = removeDisabled
    ? 'disabled style="opacity:0.4;cursor:not-allowed;" title="최소 1개의 버튼이 필요해요"'
    : 'title="마지막 버튼 삭제"';
  return `
    <div class="edit-row edit-row--pb-choice-count">
      <label class="edit-label">🎯 행동 버튼 개수
        <span class="edit-label-note">현재 ${count}개</span>
      </label>
      <div class="edit-pb-choice-count-actions">
        <button type="button" class="edit-toggle js-pb-choice-add">+ 버튼 추가</button>
        <button type="button" class="edit-toggle js-pb-choice-remove-last" ${removeAttrs}>마지막 버튼 삭제</button>
      </div>
    </div>`;
}

/* 2026-05-27 Phase 4-B: 행동 버튼 개수 인라인 추가/삭제 helper.
   우측 2단 _bindButtonsEditEvents 안 추가/삭제 로직과 같은 규칙. 새 저장
   로직 만들지 않고 _queueSaveButtons(scene) 재사용 — buttons/choiceA/B/
   choiceCount/nextA/B 일괄 저장. _bindButtonsEditEvents의 기존 핸들러는
   변경 없음 (회귀 방지). */
function _pbAddChoiceForScene(scene) {
  if (!scene) return;
  /* LEVELS-AUDIT F2: 일직선 잠금 — UI 숨김의 2중 방어 */
  if (_isLinearLockedViewer()) { alert(_LINEAR_LOCK_MSG_VIEWER); return; }
  if (!Array.isArray(scene.choices)) scene.choices = [];
  /* CHOICE-COUNT-CAP(#65): 행동 버튼은 6개까지 — 감상 레이아웃 매트릭스가 1~6개까지만 정의돼
     7개+부터는 split이 overflow로 잘리고 imageCenter도 깨졌다. 상한 도달 시 안내 후 무시. */
  if (scene.choices.length >= 6) {
    if (typeof showPlayToast === 'function') showPlayToast('행동 버튼은 6개까지 만들 수 있어요.');
    else if (typeof window !== 'undefined' && window.alert) window.alert('행동 버튼은 6개까지 만들 수 있어요.');
    return;
  }
  const newIdx = scene.choices.length;
  const newId  = (typeof _autoChoiceId === 'function')
    ? _autoChoiceId(newIdx)
    : String.fromCharCode(65 + newIdx);
  scene.choices.push({
    id: newId,
    label: '',
    nextId: null,
    presentation: (typeof defaultPresentation === 'function')
      ? defaultPresentation(newId)
      : { placement: 'bottom' },
  });
  _queueSaveButtons(scene);
  _flushPendingSave();
  renderEditPanel();
  _scheduleViewerFrameReRender();
}

function _pbRemoveLastChoiceForScene(scene) {
  if (!scene || !Array.isArray(scene.choices)) return;
  /* LEVELS-AUDIT F2: 일직선 잠금 — UI 숨김의 2중 방어 */
  if (_isLinearLockedViewer()) { alert(_LINEAR_LOCK_MSG_VIEWER); return; }
  if (scene.choices.length <= 1) return;  /* 최소 1개 유지 */
  scene.choices.pop();
  _queueSaveButtons(scene);
  _flushPendingSave();
  renderEditPanel();
  _scheduleViewerFrameReRender();
}

/* 2026-06-02: 1단 중간 버튼 개별 삭제 — 2단 js-edit-btn-remove와 동일 데이터 경로
   (splice(idx,1) → _queueSaveButtons → renderEditPanel + 재렌더). 최소 1개 유지 정책 동일.
   splice로 배열이 dense하게 유지돼 미리보기(원본 인덱스)/1단/2단 모두 정합. */
function _pbRemoveChoiceAtForScene(scene, idx) {
  if (!scene || !Array.isArray(scene.choices)) return;
  /* LEVELS-AUDIT F2: 일직선 잠금 — UI 숨김의 2중 방어 */
  if (_isLinearLockedViewer()) { alert(_LINEAR_LOCK_MSG_VIEWER); return; }
  if (!Number.isFinite(idx) || idx < 0 || idx >= scene.choices.length) return;
  if (scene.choices.length <= 1) return;  /* 최소 1개 유지 (2단 삭제와 동일) */
  scene.choices.splice(idx, 1);
  _queueSaveButtons(scene);
  _flushPendingSave();
  renderEditPanel();
  _scheduleViewerFrameReRender();
}

/* 2026-05-27 Phase 4-C: 1단 선택지 연결 select 옵션 빌더 — 안전 정책.
   · 표지(cover) 제외 (목록에서 빼버림 — 학생 연결 실수 차단)
   · 자기 자신: disabled + 라벨에 "[현재 장면]" 표시
   · 엔딩: 선택 가능 + 라벨에 "[엔딩]" 표시
   · 일반 장면: 평소대로
   호출 측에서 (미연결) 옵션은 별도로 추가. 2단(_buttonRowHtml)은 기존
   정책 그대로 — 사용자 명시 "1단에만 안전 옵션 적용". */
function _buildLinkSelectOptionsHtml(scene, currentNextId) {
  const allScenes = (typeof ViewerState !== 'undefined' && ViewerState.scenes)
    ? Object.values(ViewerState.scenes) : [];
  const sorted = allScenes.slice().sort((a, b) => {
    const na = Number(a.num || a.id || 0);
    const nb = Number(b.num || b.id || 0);
    return na - nb;
  });
  const currentSceneId = String(scene.num || scene.id || '');
  return sorted.map(s => {
    if (!s) return '';
    if (s.type === 'cover' || s.isCover) return '';   /* 표지 제외 */
    const sNum = String(s.num || s.id || '');
    if (!sNum) return '';
    const isSelf = sNum === currentSceneId;
    const isEnding = !!(s.type === 'ending' || s.isEnding);
    const sTitle = String(s.title || '').trim();
    let labelText = sTitle
      ? `장면 ${sNum} (${sTitle.length > 12 ? sTitle.slice(0, 12) + '…' : sTitle})`
      : `장면 ${sNum}`;
    if (isEnding) labelText += ' [엔딩]';
    if (isSelf) labelText += ' [현재 장면]';
    const sel = (!isSelf && sNum === currentNextId) ? ' selected' : '';
    const disabledAttr = isSelf ? ' disabled' : '';
    return `<option value="${escHtml(sNum)}"${sel}${disabledAttr}>${escHtml(labelText)}</option>`;
  }).join('');
}

/* 2026-05-27 Phase 4-C: 1단 — 선택지 연결 섹션 HTML.
   일반 장면만 (표지/엔딩 제외). 버튼 0개면 섹션 자체 X.
   각 row: [N] 라벨 미리(12자) → select. 저장 흐름은 _queueSaveButtons
   재사용 (data 구조 변경 X). */
function _pbChoiceLinkSectionHtml(scene, rowDelete) {
  if (!scene) return '';
  if (scene.type === 'cover' || scene.isCover) return '';
  if (scene.type === 'ending' || scene.isEnding) return '';
  const choices = Array.isArray(scene.choices) ? scene.choices : [];
  if (choices.length === 0) return '';

  /* 2026-06-02: rowDelete=true면 행마다 개별 삭제(×) — 단 최소 1개 유지(2단 정책 동일)라
     버튼이 1개뿐이면 ×를 숨김. 현재 movie 1단에서만 켬(text/pb 1단은 옛 그대로). */
  /* LEVELS-AUDIT F2: 일직선 잠금이면 행 삭제 금지(연결 select는 아래에서 비활성) */
  const allowRowDelete = !!rowDelete && choices.length > 1 && !_isLinearLockedViewer();

  const rows = choices.map((c, i) => {
    const rawLabel = (c && typeof c.label === 'string') ? c.label.trim() : '';
    const labelPreview = rawLabel
      ? (rawLabel.length > 12 ? rawLabel.slice(0, 12) + '…' : rawLabel)
      : '버튼 문구 없음';
    const labelEmptyClass = rawLabel ? '' : ' is-empty';
    const currentNext = (c && c.nextId) ? String(c.nextId) : '';
    const optionsHtml = _buildLinkSelectOptionsHtml(scene, currentNext);
    const removeBtnHtml = allowRowDelete
      ? `<button type="button" class="edit-pb-choice-link-remove js-pb-choice-remove" data-idx="${i}" title="이 버튼 삭제" aria-label="이 버튼 삭제">×</button>`
      : '';
    return `
      <div class="edit-pb-choice-link-row" data-idx="${i}">
        <span class="edit-pb-choice-link-num">[${i + 1}]</span>
        <span class="edit-pb-choice-link-label${labelEmptyClass}">${escHtml(labelPreview)}</span>
        <span class="edit-pb-choice-link-arrow">→</span>
        <select class="edit-pb-choice-link-select js-pb-choice-link" data-idx="${i}"${_isLinearLockedViewer() ? ' disabled title="1·2단계는 연결이 잠겨 있어요"' : ''}>
          <option value=""${currentNext ? '' : ' selected'}>(미연결)</option>
          ${optionsHtml}
        </select>
        ${removeBtnHtml}
      </div>`;
  }).join('');

  /* LEVELS-AUDIT F2: 잠금 상태 안내 — 팝오버가 '보기 전용'이 된 이유를 그 자리에서 설명 */
  const _linLockNote = _isLinearLockedViewer()
    ? `<div class="edit-field-hint">🔒 1·2단계는 버튼 개수와 연결이 정해져 있어요. 버튼 글자는 감상 화면에서 눌러 바꿀 수 있어요.</div>`
    : '';
  return `
    <div class="edit-row edit-row--pb-choice-link">
      <label class="edit-label">🔗 선택지 연결</label>
      ${_linLockNote}
      <div class="edit-pb-choice-link-list">
        ${rows}
      </div>
    </div>`;
}

/* ── 2) 그림책형 전용 섹션 ─────────────────────────────────────
   mockup: a_clean_ui_screenshot_mockup_of_a_digital_storyb.png 기준
   포함:
   · 하위 모드 토글 (분할형 / 그림 중심형)
   · 이미지 업로드 진입점 / 바로 그리기 진입점
   · 그림 중심형 전용: 본문 글상자 / 배경막 (3단계는 진입점만) */
/* PB-IMAGE-1C: 장면 그림 진입 버튼(.edit-pb-image-actions) HTML helper — 우측 인스펙터와
   상단 🖼️ 그림 팝오버가 같은 HTML 재사용. class/구조/input(class 기반, id 없음) 무변경.
   1D에서 우측 호출부만 wrapper로 감싸 숨기기 쉽게 분리. */
function _pbImageActionsHtml(scene) {
  /* PICTUREBOOK-LEVELS ④: 1단계 = AI 자동 그림 — 업로드/그리기/삭제 진입을 감추고
     안내+🔁(그림 다시 만들기)만 노출(sourceMode 충돌 원천 차단·§7.5). 2·3단계는 기존 그대로. */
  const _pbLvl = (typeof ViewerState !== 'undefined' && ViewerState.project)
    ? ViewerState.project.picturebookLevel : null;
  if (_pbLvl === 1) {
    return `
    <div class="edit-row">
      <label class="edit-label">🖼️ 장면 그림</label>
      <div class="edit-pb-image-actions">
        <span class="edit-label-note" style="display:block;margin-bottom:6px;word-break:keep-all;">1단계 동화책은 AI가 그림을 만들어 줘요. 마음에 안 들면 다시 만들 수 있어요.</span>
        <button type="button" class="edit-toggle js-pb-image-regen1">🔁 그림 다시 만들기</button>
      </div>
    </div>`;
  }
  const _hasImg2 = !!(scene && (scene.imageData || scene.imageUrl));
  if (_pbLvl === 2) {
    /* LEVEL2-DRAW(2026-07-21 사용자 결정): 2단계 그림 = 그리기 전용(업로드/삭제 숨김).
       힘 빼고 인물 구도만 간단히(졸라맨처럼) 그리면 [AI 그림책 마감]이 예쁘게 강변환.
       ⚠️ 실제 강변환은 서버 level2 프롬프트 분기 배포 후 작동(그 전엔 3단계식 원본 보존). */
    return `
    <div class="edit-row">
      <label class="edit-label">🖼️ 장면 그림 ${_hasImg2 ? '<span class="edit-label-note">(있음)</span>' : '<span class="edit-label-note">(없음)</span>'}</label>
      <div class="edit-pb-image-actions">
        <span class="edit-label-note" style="display:block;grid-column:1 / -1;margin-bottom:6px;word-break:keep-all;">잘 그리지 않아도 괜찮아요! 😊 <b>누가 어디 있는지만</b> 쓱쓱 그려요. <b>AI 그림책 마감</b>을 누르면 예쁜 그림으로 짠! 바뀌어요.</span>
        <button type="button" class="edit-toggle js-pb-image-draw"${_hasImg2 ? ' disabled style="opacity:0.4;" title="이미 그린 그림이 있어요. 지우고 다시 그릴 수 있어요."' : ''}>✏️ 구도 그리기</button>
        ${_hasImg2 ? '<button type="button" class="edit-toggle js-pb-image-remove" style="color:#c66f4a;">🗑 지우고 다시</button>' : ''}
        <button type="button" class="edit-toggle js-pb-lvl2-example" style="color:#4a7ab0;">🎨 어떻게 바뀌어요?</button>
        ${/* REGEN-SCENE-1(2026-07-27): 2·3단계 '다시 생성'이 전 장면 일괄이라 한 장면만 고칠 수
             없었다 → 이 장면만 다시 만드는 버튼. 서버 sceneIds 지원을 그대로 쓴다(무배포). */''}
        <button type="button" class="edit-toggle js-pb-image-regen-scene">🔁 이 장면만 다시 만들기</button>
        ${_hasImg2 ? `<span class="edit-label-note" style="display:block;grid-column:1 / -1;margin-top:6px;color:#a07a52;">
          ✏️ 구도 그리기는 <b>[🗑 지우고 다시]</b>를 먼저 눌러야 열려요. (그림이 이미 있어요)
        </span>` : ''}
      </div>
    </div>`;
  }
  const hasImage = !!(scene && (scene.imageData || scene.imageUrl));
  return `
    <div class="edit-row">
      <label class="edit-label">🖼️ 장면 그림 ${hasImage ? '<span class="edit-label-note">(있음)</span>' : '<span class="edit-label-note">(없음)</span>'}</label>
      <div class="edit-pb-image-actions">
        <label class="edit-toggle js-pb-image-upload-label" style="cursor:pointer;">
          ${hasImage ? '🔄 바꾸기' : '🖼️ 업로드'}
          <input type="file" accept="image/*" class="js-pb-image-upload-input" style="display:none;">
        </label>
        ${hasImage
          ? `<button type="button" class="edit-toggle js-pb-image-remove" style="color:#c66f4a;">🗑 삭제</button>`
          : `<button type="button" class="edit-toggle js-pb-image-remove" disabled style="opacity:0.4;">🗑 삭제</button>`}
        ${hasImage
          ? `<button type="button" class="edit-toggle js-pb-image-draw" disabled style="opacity:0.4;" title="사진이 있을 땐 그리기를 사용할 수 없어요. 삭제 후 다시 그릴 수 있어요.">✏️ 그리기</button>`
          : `<button type="button" class="edit-toggle js-pb-image-draw">✏️ 그리기</button>`}
        ${/* REGEN-SCENE-1(2026-07-27): 3단계도 이 장면만 다시 만들 수 있게. */''}
        <button type="button" class="edit-toggle js-pb-image-regen-scene">🔁 이 장면만 다시 만들기</button>
        ${hasImage ? `<span class="edit-label-note" style="display:block;grid-column:1 / -1;margin-top:6px;color:#a07a52;">
          ✏️ 그리기는 <b>[🗑 삭제]</b>를 먼저 눌러야 열려요. (그림이 이미 있어요)
        </span>` : ''}
        <!-- IMG-BTN-RETIRE(2026-07-10): ✂️크기·이동/✄자르기 버튼 제거 — 조사 결과 imageCenter(주력)
             감상 렌더가 background-image(contain)라 imageTransform이 화면에 반영되지 않는 사문화 버튼
             (조정해도 변화 없음=학생 혼란·"그림 안 자름" 원칙과도 충돌). 인쇄도 미반영.
             enterImageTransformEdit/enterImageCropEdit·기존 작품의 scene.imageTransform 저장값은
             보존(렌더 무해·기능 복구 시 재사용). -->
      </div>
    </div>`;
}

/* PB-LAYOUT-1A: picturebook 하위 모드(split/imageCenter) 순수 HTML helper.
   _typeSectionPicturebookHtml 인라인을 그대로 추출 — class/selector/data(js-pb-submode·data-val)·
   first-scene disabled(lockedAttr/lockedClass)·lockHint 무변경, 렌더 결과 동일. 저장/핸들러
   (.js-pb-submode 바인딩·전 장면 picturebookSubmode 저장·variant lock)는 무관(HTML만).
   향후 PB-LAYOUT-1B에서 ⚙️ 작품 설정 팝오버가 이 helper를 재사용 예정.
   ※ dead path인 _picturebookSubmodeHtml(spread/stage)과는 별개 — 혼동 금지. */
function _pbSubmodeSectionHtml(scene) {
  /* D8-CLEAN-1: 그림책 대표=imageCenter 확정 → 하위 모드(분할형/그림중심형) 토글 UI 숨김.
     picturebookSubmode 데이터·렌더 분기·저장·fallback 무변경. 신규 장면은 imageCenter 기본 유지,
     기존 split 장면은 split로 그대로 렌더(UI에서만 새로 선택 못 하게 함). 핸들러는 대상 없으면 no-op. */
  return '';
  const sub = (scene.picturebookSubmode === 'imageCenter') ? 'imageCenter' : 'split';
  /* v37: 페이지 방향·하위 모드는 첫 장면(entrySceneId)에서만 변경 가능.
     장면 2부터는 토글 비활성 + 안내. "작품 전체 설정"은 한 곳에서만 바꾸게 함. */
  const entryId = ViewerState.project && ViewerState.project.entrySceneId;
  const isFirstScene = entryId
    ? String(scene.id) === String(entryId)
    : (scene.isStart === true);
  const lockedAttr = isFirstScene ? '' : 'disabled';
  const lockedClass = isFirstScene ? '' : ' edit-toggle--locked';
  const lockHint = isFirstScene ? '' : `
    <div class="edit-section-hint edit-section-hint--lock">
      🔒 페이지 방향·하위 모드는 첫 장면에서만 바꿀 수 있어요 (작품 전체 설정).
    </div>`;
  return `
    <div class="edit-pb-row-pair">
      <div class="edit-row edit-row--compact edit-row--pair-cell">
        <label class="edit-label">📐 하위 모드</label>
        <div class="edit-toggle-group">
          <button type="button" ${lockedAttr}
            class="edit-toggle js-pb-submode${lockedClass} ${sub === 'split' ? 'active' : ''}"
            data-val="split">📖 분할형</button>
          <button type="button" ${lockedAttr}
            class="edit-toggle js-pb-submode${lockedClass} ${sub === 'imageCenter' ? 'active' : ''}"
            data-val="imageCenter">🎨 그림 중심형</button>
        </div>
      </div>
    </div>
    ${lockHint}`;
}

/* PB-BODYBOX-1A: picturebook 글상자 진하기(backdropOpacity) 순수 HTML helper.
   _typeSectionPicturebookHtml 인라인을 그대로 추출 — imageCenter(그림 중심형)일 때만 렌더(아니면 ''),
   class/selector/value(js-pb-bb-op·js-pb-bb-op-val)·안내 문구 무변경, 렌더 결과 동일.
   저장/preview 핸들러(_pbBbBindRange)·위치/크기 오버레이(js-pb-body-move/-resize)·variant
   layout save는 무관(HTML만). 향후 PB-BODYBOX-1B에서 🎭 장면 스타일 팝오버가 이 helper를 재사용 예정. */
function _pbBodyBoxOpacitySectionHtml(scene) {
  const isImageCenter = scene && scene.picturebookSubmode === 'imageCenter';
  if (!isImageCenter) return '';
  const bb = (typeof getPicturebookBodyBox === 'function')
    ? getPicturebookBodyBox(scene)
    : { x: 15, y: 25, width: 55, height: null, backdropOpacity: 0.85 };
  return `
    <div class="edit-row">
      <label class="edit-label">💬 글상자 진하기</label>
      <div class="edit-pb-bodybox-grid">
        <div class="edit-pb-bodybox-row">
          <span class="edit-pb-bodybox-name">강도</span>
          <input type="range" class="edit-range js-pb-bb-op"
            min="0" max="100" step="5" value="${Math.round(bb.backdropOpacity * 100)}">
          <span class="edit-pb-bodybox-val js-pb-bb-op-val">${Math.round(bb.backdropOpacity * 100)}%</span>
        </div>
      </div>
      <div class="edit-section-hint">
        본문 글상자의 위치와 크기는 미리보기에서 ✥로 이동, 모서리 ⤡로 크기 조절하세요.
      </div>
    </div>`;
}


/* ────────────────────────────────────────────
   W8: 그림책 글자 스타일 인라인 HTML — [내용] 탭에서 본문 바로 아래 표시
   사용자 보고: 폰트↔내용 탭 왕복 불편 → 본문 옆에 글자 스타일 통합.
   textStyle 데이터 모델 재사용 (한 작품 = 한 모드라 충돌 없음).
   ──────────────────────────────────────────── */
/* GLYPH-STYLE-1B: picturebook 글자 스타일 컨트롤(폰트/크기/색/굵기) 순수 HTML helper.
   _pbInlineStyleHtml(우측 접이식)에서 컨트롤만 분리 — 향후 🎭 장면 스타일 팝오버가 같은
   컨트롤을 재사용하기 위함. class/selector/data(js-edit-pb-font/-size/-color/-color-pick/-weight)
   무변경. "모든 장면 적용"은 제외(우측 _pbInlineStyleHtml에 그대로 유지). 저장/핸들러/variant
   로직 무관(HTML만). _fsDisp는 _displayFontSize(현재 보기모드)를 따름 — 기존과 동일. */
function _pbGlyphStyleSectionHtml(scene) {
  const style = (typeof getTextStyle === 'function')
    ? getTextStyle(scene)
    : { fontFamily: 'gothic', fontSize: 16, color: '', weight: 'normal' };
  /* P4-D-2B-FIX4: 글자 크기 슬라이더 값/라벨은 현재 보기 모드 표시 fontSize(원본/variant)를 따른다. */
  const _fsDisp = (function () { const v = _displayFontSize(scene, style); return (typeof v === 'number' && !isNaN(v)) ? v : style.fontSize; })();
  /* W9: 폰트 18종. 각 option의 font-family도 inline으로 지정해 dropdown 미리보기. */
  const FONTS = [
    { id: 'gothic',     label: '나눔고딕' },
    { id: 'notosans',   label: 'Noto Sans (본문)' },
    { id: 'dodum',      label: '고운돋움' },
    { id: 'batang',     label: '고운바탕' },
    { id: 'notoserif',  label: 'Noto Serif (명조)' },
    { id: 'hahmlet',    label: 'Hahmlet (세련 명조)' },
    { id: 'stylish',    label: 'Stylish (굵은 명조)' },
    { id: 'diphylleia', label: 'Diphylleia (우아)' },
    { id: 'jua',        label: '주아' },
    { id: 'hanna',      label: '한나 (굵은 헤드라인)' },
    { id: 'dohyeon',    label: '도현 (꺽임)' },
    { id: 'pen',        label: '나눔펜' },
    { id: 'gaegu',      label: '개구' },
    { id: 'himelody',   label: '하이멜로디 (귀여운)' },
    { id: 'yeonsung',   label: '연성 (둥글)' },
    { id: 'dokdo',      label: '동해 독도 (서예)' },
    { id: 'cormorant',  label: 'Cormorant' },
    { id: 'galmuri',    label: '갈무리 (픽셀)' },
  ];
  const fontOptions = FONTS.map(f => {
    const ff = (TEXT_FONT_FAMILIES && TEXT_FONT_FAMILIES[f.id]) || 'inherit';
    return `<option value="${f.id}"
      style="font-family:${ff}"
      ${style.fontFamily === f.id ? 'selected' : ''}>${f.label}</option>`;
  }).join('');
  /* v36: 범용 색 14개 */
  const COLORS = ['', '#1a1a1a', '#d4453d', '#e87a2a', '#f2b417', '#4a7d3a', '#2c6cb4', '#6a3eb0', '#c94785', '#6a3814', '#7a7a7a', '#5cb0d4', '#a8d65c', '#f4cba8'];
  const colorBtns = COLORS.map(c => {
    const isActive = (style.color || '') === c;
    const label = c === '' ? '기본' : '';
    return `<button type="button"
      class="edit-color-btn js-edit-pb-color ${isActive ? 'active' : ''}"
      data-val="${c}"
      style="${c ? `background:${c};` : 'background:repeating-conic-gradient(#eee 0 25%,#fff 0 50%) 50%/8px 8px;'}"
      title="${c || '기본 (테마 색)'}"
      >${label}</button>`;
  }).join('');
  return `
          <div class="edit-row edit-row--compact">
            <label class="edit-label">폰트</label>
            <select class="edit-font-select js-edit-pb-font"
              style="font-family:${(TEXT_FONT_FAMILIES && TEXT_FONT_FAMILIES[style.fontFamily || 'gothic']) || 'inherit'}">${fontOptions}</select>
          </div>
          <div class="edit-row edit-row--compact edit-row--inline">
            <label class="edit-label">글자 크기 <span class="edit-label-note">(${_fsDisp}px)</span></label>
            <input type="range" class="edit-slider js-edit-pb-size"
              min="12" max="28" step="1" value="${_fsDisp}">
          </div>
          <div class="edit-row edit-row--compact">
            <label class="edit-label">글자 색</label>
            <div class="edit-color-row">
              ${colorBtns}
              <input type="color" class="edit-color-picker js-edit-pb-color-pick"
                value="${style.color || '#1a1a1a'}" title="자유 색 선택">
            </div>
          </div>
          <div class="edit-row edit-row--compact edit-row--inline">
            <label class="edit-label">굵기</label>
            <div class="edit-toggle-group">
              <button type="button" class="edit-toggle js-edit-pb-weight ${style.weight === 'normal' ? 'active' : ''}" data-val="normal">보통</button>
              <button type="button" class="edit-toggle js-edit-pb-weight ${style.weight === 'bold' ? 'active' : ''}" data-val="bold">굵게</button>
            </div>
          </div>`;
}

/* GLYPH-STYLE-1C: 🎭 장면 스타일 팝오버용 picturebook 글자 스타일 바인딩(root scope).
   우측 인스펙터의 pb 글자 핸들러(_bindEditPanelEvents picturebook 분기)와 **완전히 동일한 경로**를
   호출 — _applyVariantStyleOrBlock(variant면 fontSize만 허용·나머지 차단) → 원본이면 textStyle
   ensure + _queueSave + _patchPbStyle/재렌더. 새 저장 로직 없음. 우측 핸들러는 무수정(panel scope).
   input은 라벨/CSS변수만(저장 폭주 X), change에서 _flush. _ensurePbTextStyle은 우측 로컬이라 동일 로직 inline. */
function _bindPbGlyphStyleActions(root, scene) {
  if (!root || !scene) return;
  const _ensureTs = () => {
    if (!scene.textStyle || typeof scene.textStyle !== 'object') {
      scene.textStyle = { fontFamily: 'gothic', fontSize: 16, color: '', weight: 'normal' };
    }
    return scene.textStyle;
  };
  /* 폰트 */
  root.querySelectorAll('.js-edit-pb-font').forEach(sel => {
    sel.addEventListener('change', e => {
      if (!_editText.editable) return;
      const v = e.target.value || 'gothic';
      if (_applyVariantStyleOrBlock(scene, { fontFamily: v }, () => {
        e.target.style.fontFamily = `var(--font-${v})`;
      })) return;
      const ts = _ensureTs();
      if (ts.fontFamily === v) return;
      ts.fontFamily = v;
      _queueSave(scene.num || scene.id, { textStyle: { ...ts } });
      _flushPendingSave();
      e.target.style.fontFamily = `var(--font-${v})`;
      if (!_patchPbStyle()) _scheduleViewerFrameReRender();
    });
  });
  /* 크기 */
  root.querySelector('.js-edit-pb-size')?.addEventListener('input', e => {
    if (!_editText.editable) return;
    const v = parseInt(e.target.value, 10);
    if (isNaN(v)) return;
    if (_applyVariantStyleOrBlock(scene, { fontSize: v }, () => {
      const ln = e.target.closest('.edit-row')?.querySelector('.edit-label-note');
      if (ln) ln.textContent = `(${v}px)`;
    })) return;
    const ts = _ensureTs();
    ts.fontSize = v;
    _queueSave(scene.num || scene.id, { textStyle: { ...ts } });
    const labelNote = e.target.closest('.edit-row')?.querySelector('.edit-label-note');
    if (labelNote) labelNote.textContent = `(${v}px)`;
    if (!_patchPbStyle()) _scheduleViewerFrameReRender();
  });
  root.querySelector('.js-edit-pb-size')?.addEventListener('change', () => _flushPendingSave());
  /* 색 팔레트 */
  root.querySelectorAll('.js-edit-pb-color').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_editText.editable) return;
      const v = btn.dataset.val || '';
      if (_applyVariantStyleOrBlock(scene, { color: v }, () => {
        root.querySelectorAll('.js-edit-pb-color').forEach(b => b.classList.toggle('active', b === btn));
      })) return;
      const ts = _ensureTs();
      ts.color = v;
      _queueSave(scene.num || scene.id, { textStyle: { ...ts } });
      _flushPendingSave();
      root.querySelectorAll('.js-edit-pb-color').forEach(b => b.classList.toggle('active', b === btn));
      if (!_patchPbStyle()) _scheduleViewerFrameReRender();
    });
  });
  /* 자유 색 */
  root.querySelector('.js-edit-pb-color-pick')?.addEventListener('input', e => {
    if (!_editText.editable) return;
    const v = e.target.value || '';
    if (_applyVariantStyleOrBlock(scene, { color: v }, () => {
      root.querySelectorAll('.js-edit-pb-color').forEach(b => b.classList.remove('active'));
    })) return;
    const ts = _ensureTs();
    ts.color = v;
    _queueSave(scene.num || scene.id, { textStyle: { ...ts } });
    root.querySelectorAll('.js-edit-pb-color').forEach(b => b.classList.remove('active'));
    if (!_patchPbStyle()) _scheduleViewerFrameReRender();
  });
  root.querySelector('.js-edit-pb-color-pick')?.addEventListener('change', () => _flushPendingSave());
  /* 굵기 */
  root.querySelectorAll('.js-edit-pb-weight').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_editText.editable) return;
      const v = btn.dataset.val === 'bold' ? 'bold' : 'normal';
      if (_applyVariantStyleOrBlock(scene, { weight: v }, () => {
        root.querySelectorAll('.js-edit-pb-weight').forEach(b => b.classList.toggle('active', b === btn));
      })) return;
      const ts = _ensureTs();
      ts.weight = v;
      _queueSave(scene.num || scene.id, { textStyle: { ...ts } });
      _flushPendingSave();
      root.querySelectorAll('.js-edit-pb-weight').forEach(b => b.classList.toggle('active', b === btn));
      if (!_patchPbStyle()) _scheduleViewerFrameReRender();
    });
  });
}

/* PANEL-DEADCODE-1: _pbInlineStyleHtml(우패널 전용 글자 스타일 collapsible) 제거 — 글자 스타일은
   🎭 장면 스타일 팝오버(_pbGlyphStyleSectionHtml)가 주 동선. PANEL-EMPTY-1에서 dead 계산까지 제거돼
   0 active caller. 공용 _pbGlyphStyleSectionHtml/_applyStyleAllButtonHtml은 무관(유지). */

/* ── 3) 무비형 전용 섹션 ───────────────────────────────────────
   포함:
   · 미디어 타입 배지 + 업로드 진입점
   · 본문 사용 ON/OFF (scene.bodyEnabled 명시 필드 — 3단계 신규) */

/* ── 4) 체험전시형 전용 섹션 ────────────────────────────────────
   3단계 현실 목표 (사용자 결정): 완성보다 전용 편집 진입 구조 분기까지만.
   포함:
   · 배경 이미지 슬롯 진입점
   · 연결 오브젝트 추가 진입점 (정식 connectObjects 모델 추후)
   주의: connectObjects 데이터 모델 미구현 — 임시 집계는 sceneRenderer 카드 표시만. */
function _typeSectionExperienceHtml(scene) {
  const hasBg = !!(scene.imageData || scene.imageUrl);

  /* W6: 정식 connectObjects 모델 사용 — buttons[] 임시 집계 폐기 */
  const objects = (typeof getConnectObjects === 'function')
    ? getConnectObjects(scene) : [];

  /* 모든 장면 목록 — nextId 드롭다운용 */
  const allScenes = (typeof ViewerState !== 'undefined' && ViewerState.scenes)
    ? Object.values(ViewerState.scenes) : [];
  const sortedScenes = allScenes.slice().sort((a, b) => {
    const na = Number(a.num || a.id || 0);
    const nb = Number(b.num || b.id || 0);
    return na - nb;
  });

  /* 오브젝트 행 N개 — 각 행: 타입 배지 + 라벨 input + next 드롭다운 + 삭제 */
  const objectRows = objects.map((co, idx) => {
    const typeLabel = _CO_TYPE_LABEL_MAP[co.type] || co.type;
    const typeIcon  = _CO_TYPE_ICON_MAP[co.type] || '🔘';
    const label     = String(co.label || '');
    const labelEsc  = escHtml(label);
    const len       = label.length;
    /* nextId 옵션 — 자기 자신도 허용 */
    const optionsHtml = sortedScenes.map(s => {
      const sNum = String(s.num || s.id || '');
      if (!sNum) return '';
      const sTitle = String(s.title || '').trim();
      const labelText = sTitle
        ? `장면 ${sNum} (${sTitle.length > 12 ? sTitle.slice(0, 12) + '…' : sTitle})`
        : `장면 ${sNum}`;
      const sel = sNum === String(co.nextId || '') ? ' selected' : '';
      return `<option value="${escHtml(sNum)}"${sel}>${escHtml(labelText)}</option>`;
    }).join('');

    /* back/home 타입은 nextId가 무관 (시스템 액션) → 드롭다운 비활성화 */
    const isSystemNav = (co.type === 'back' || co.type === 'home');
    const nextSelectHtml = isSystemNav
      ? `<span class="edit-co-system-hint">(시스템 액션)</span>`
      : `<select class="edit-co-next js-edit-co-next" data-co-id="${escHtml(co.id)}">
           <option value="" ${!co.nextId ? 'selected' : ''}>(미연결)</option>
           ${optionsHtml}
         </select>`;

    return `
      <div class="edit-co-row" data-co-id="${escHtml(co.id)}">
        <div class="edit-co-row-main">
          <span class="edit-co-badge edit-co-badge--${co.type}">
            ${typeIcon} ${typeLabel}
          </span>
          <input type="text"
            class="edit-text-input edit-co-label js-edit-co-label"
            data-co-id="${escHtml(co.id)}"
            value="${labelEsc}"
            placeholder="라벨 (선택)"
            maxlength="20">
          <button type="button"
            class="edit-co-remove js-edit-co-remove"
            data-co-id="${escHtml(co.id)}"
            title="이 오브젝트 삭제">×</button>
        </div>
        <div class="edit-co-row-meta">
          <span class="edit-co-counter">
            <span class="js-edit-co-len">${len}</span> / 20
          </span>
          <span class="edit-co-target">
            <span class="edit-co-next-label">다음 →</span>
            ${nextSelectHtml}
          </span>
        </div>
      </div>`;
  }).join('');

  const listHtml = objects.length > 0
    ? `<div class="edit-co-list js-edit-co-list">${objectRows}</div>`
    : `<div class="edit-section-note edit-section-note--empty">
         아직 추가된 오브젝트가 없어요. 아래 타입 중 하나를 골라 추가해 보세요.
       </div>`;

  return `
    <div class="edit-divider"></div>
    <h4 class="edit-section-title edit-section-title--major">② 체험전시형 설정</h4>
    <div class="edit-section-hint">
      이미지 위에 연결 오브젝트(버튼/화살표/깃발/다음/투명 클릭 영역)를
      배치해 참여자가 직접 눌러 탐색하게 만드는 모드입니다.
      뒤로가기/처음으로는 상단에 항상 표시되는 시스템 버튼이에요.
    </div>

    <div class="edit-row">
      <label class="edit-label">배경 이미지</label>
      <div class="edit-pb-image-row">
        <div class="edit-pb-image-status">
          ${hasBg
            ? `🖼️ <strong>배경 있음</strong>`
            : `<span class="edit-section-note">아직 배경이 없어요</span>`}
        </div>
        <div class="edit-toggle-group">
          <button type="button" class="edit-toggle js-exp-bg-upload">🖼️ 배경 업로드/교체</button>
        </div>
      </div>
    </div>

    <div class="edit-row">
      <label class="edit-label">
        연결 오브젝트
        <span class="edit-label-note">(${objects.length}개)</span>
      </label>
      ${listHtml}
      <div class="edit-co-add-area">
        <div class="edit-section-hint">+ 추가</div>
        <div class="edit-toggle-group" style="flex-wrap:wrap;">
          <button type="button" class="edit-toggle js-exp-co-add" data-val="button">🔘 버튼</button>
          <button type="button" class="edit-toggle js-exp-co-add" data-val="arrow">➡️ 화살표</button>
          <button type="button" class="edit-toggle js-exp-co-add" data-val="flag">🚩 깃발</button>
          <button type="button" class="edit-toggle js-exp-co-add" data-val="next">⏭ 다음</button>
          <button type="button" class="edit-toggle js-exp-co-add" data-val="invisible">👻 투명 영역</button>
        </div>
        <div class="edit-section-hint">
          오브젝트는 화면 가운데 기본 크기로 추가됩니다. 추가 후 viewer 화면에서 ✥로 이동, 모서리로 크기 조절.
        </div>
        <div class="edit-section-hint" style="margin-top:6px;opacity:0.75;">
          ※ <strong>뒤로가기 / 처음으로</strong>는 모든 장면에서 자동으로 상단에 보이는 시스템 버튼입니다 — 따로 추가할 필요가 없어요.
        </div>
      </div>
    </div>`;
}

/* W6: connectObject 타입별 라벨/아이콘 매핑 (UI 표시용) */
const _CO_TYPE_LABEL_MAP = {
  button:    '버튼',
  arrow:     '화살표',
  flag:      '깃발',
  next:      '다음',
  back:      '뒤로가기',
  home:      '처음으로',
  invisible: '투명',
};
const _CO_TYPE_ICON_MAP = {
  button:    '🔘',
  arrow:     '➡️',
  flag:      '🚩',
  next:      '⏭',
  back:      '⏮',
  home:      '🏠',
  invisible: '👻',
};

/* ── 유형별 섹션 이벤트 바인딩 (3단계 신규) ─────────────────────
   현재 토글되는 명시 필드는 무비형 bodyEnabled와 그림책형 picturebookSubmode 둘.
   나머지는 진입점만 — 클릭 시 안내 (3단계 범위에서 정식 연결 안 함). */
/* 2026-05-25 Phase 2 fix: 양옆 마감 테마 핸들러 helper.
   표지 분기(_typeSectionCoverHtml)와 picturebook 첫 일반 장면 양쪽에서
   _pbThemeSectionHtml() 마크업이 들어가는데, 옛엔 핸들러가 picturebook 분기
   안에만 있어서 표지에서 토글이 동작하지 않았음. 두 분기 모두에서 호출. */
function _bindPbThemeHandlers(panel) {
  /* 토글 collapsible */
  panel.querySelectorAll('.js-pb-theme-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      _pbThemeCollapsed = !_getPbThemeCollapsed();
      renderEditPanel();
    });
  });
  /* 양옆 마감 테마 카드 (작품 단위 — viewer-meta 저장) */
  panel.querySelectorAll('.js-pb-theme').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!_editText.editable) return;
      const PB_THEMES = ['cozy-storybook', 'paper-storybook', 'gallery-picturebook', 'forest-storybook', 'night-story'];
      const val = PB_THEMES.includes(btn.dataset.val) ? btn.dataset.val : 'cozy-storybook';
      if (ViewerState.project.pbTheme === val) return;   // no-op
      ViewerState.project.pbTheme = val;
      if (document.body) document.body.dataset.pbTheme = val;
      /* 카드 active 상태만 갱신 (전체 패널 재렌더 피하기 — 포커스 손실 방지) */
      panel.querySelectorAll('.js-pb-theme').forEach(b => b.classList.toggle('active', b === btn));
      /* Firebase 저장 — viewer-meta.pbTheme 직접 update */
      try {
        const teamName  = ViewerState.project.teamName;
        const classId   = ViewerState.project.classId;
        if (teamName && typeof getViewerDb === 'function') {
          const encodedName = encodeURIComponent(teamName);
          const basePath = classId
            ? `classes/${classId}/teams/${encodedName}`
            : `teams/${encodedName}`;
          await getViewerDb().ref(`${basePath}/viewer-meta`).update({ pbTheme: val });
        }
      } catch (e) {
        console.error('[pbTheme] 저장 실패:', e);
      }
    });
  });
}

/* 2026-05-31 Movie-B-2: 페이지 방향(가로/세로) 토글 핸들러 — 작품 단위 viewer-meta.pageOrientation.
   그림책·무비형 공유(js-pb-orientation). 모드 무관 로직이라 helper로 분리(중복 제거 + 양쪽 동일). */
function _bindPageOrientationToggle(panel) {
  panel.querySelectorAll('.js-pb-orientation').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!_editText.editable) return;
      const val = btn.dataset.val === 'portrait' ? 'portrait' : 'landscape';
      if (ViewerState.project.pageOrientation === val) return;   // no-op
      ViewerState.project.pageOrientation = val;
      if (document.body) document.body.dataset.pageOrientation = val;
      if (typeof window._applyLetterbox === 'function') window._applyLetterbox();
      /* 인스펙터 즉시 갱신 (active 반영) + viewer 프레임 재렌더 (페이지 비율 즉시 반영) */
      renderEditPanel();
      _scheduleViewerFrameReRender();
      /* Firebase 저장 — viewer-meta.pageOrientation 직접 update */
      try {
        const teamName = ViewerState.project.teamName;
        const classId  = ViewerState.project.classId;
        if (teamName && typeof getViewerDb === 'function') {
          const encodedName = encodeURIComponent(teamName);
          const basePath = classId
            ? `classes/${classId}/teams/${encodedName}`
            : `teams/${encodedName}`;
          await getViewerDb().ref(`${basePath}/viewer-meta`).update({ pageOrientation: val });
        }
      } catch (e) {
        console.error('[pageOrientation] 저장 실패:', e);
      }
    });
  });
}

/* 2026-06-01 Movie-H: 선택지 표시 방식(panel|card) 토글 — 작품 단위 viewer-meta.movieDecisionStyle.
   화면 방향 토글(_bindPageOrientationToggle)과 동일 패턴(viewer-meta update + in-memory + 재렌더). */
function _bindMovieDecoToggle(panel) {
  panel.querySelectorAll('.js-movie-deco').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!_editText.editable) return;
      const val = btn.dataset.val === 'card' ? 'card' : 'panel';
      if ((ViewerState.project.movieDecisionStyle || 'panel') === val) return;   // no-op
      ViewerState.project.movieDecisionStyle = val;
      renderEditPanel();
      _scheduleViewerFrameReRender();
      try {
        const teamName = ViewerState.project.teamName;
        const classId  = ViewerState.project.classId;
        if (teamName && typeof getViewerDb === 'function') {
          const encodedName = encodeURIComponent(teamName);
          const basePath = classId
            ? `classes/${classId}/teams/${encodedName}`
            : `teams/${encodedName}`;
          await getViewerDb().ref(`${basePath}/viewer-meta`).update({ movieDecisionStyle: val });
        }
      } catch (e) {
        console.error('[movieDecisionStyle] 저장 실패:', e);
      }
    });
  });
}


/* ================================================================
   장면 template override
   ─────────────────────────────────────────────────────────────
   v0.3 명시 모드(text/picturebook/movie)에서는 모드가 곧 레이아웃을 결정
   하므로 "이 장면 레이아웃"(layoutTemplate)과 "텍스트 위치"(textAnchor)는
   설계 충돌이라 숨긴다. legacy(document/미지정)에서만 노출 + "기존 모드 전용" 표시.
   모드 카드(_modePickerHtml)는 모든 모드에서 항상 노출.
   ⚠ 3단계 이후: 작품 단위 projectType 도입으로 _modePickerHtml + legacy
      layoutTemplate/textAnchor는 호출 위치에서 빠짐. _sceneTemplateHtml 자체는
      dead code로 남김 (사용자 원칙: shell 유지).
   ================================================================ */
function _sceneTemplateHtml(scene) {
  const isV03Mode = scene.presentationMode === 'text' ||
                    scene.presentationMode === 'picturebook' ||
                    scene.presentationMode === 'movie';

  /* 모드 카드는 항상 노출 */
  const modeCardHtml = _modePickerHtml(scene);

  /* v0.3 모드에선 layoutTemplate / textAnchor UI 숨김.
     데이터(scene.layoutTemplate, scene.textAnchor)는 메모리/DB에 남아있되
     UI에서 조작 진입점만 차단. 사용자가 모드를 다시 document로 바꾸면
     legacy UI에서 다시 보임. */
  if (isV03Mode) {
    return modeCardHtml;
  }

  /* legacy (document / 모드 미지정 기존 작품) — 기존 UI 노출 */
  const options = ['(기본)', 'full-image', 'text-page', 'map-layout'];
  return `
    ${modeCardHtml}
    <div class="edit-row edit-row--legacy">
      <label class="edit-label">
        이 장면 레이아웃
        <span class="edit-section-tag">기존 모드 전용</span>
      </label>
      <div class="edit-toggle-group" style="flex-wrap:wrap;">
        ${options.map(tpl => `
          <button class="edit-toggle js-scene-tpl ${(scene.layoutTemplate || '(기본)') === tpl ? 'active' : ''}"
            data-val="${tpl}" style="margin-bottom:4px;">
            ${{ '(기본)':'기본', 'full-image':'이미지', 'text-page':'텍스트', 'map-layout':'지도' }[tpl] || tpl}
          </button>`).join('')}
      </div>
    </div>
    ${_textAnchorHtml(scene)}`;
}

function _bindSceneTemplateEvents(panel, scene) {
  _bindModePickerEvents(panel, scene);
  panel.querySelectorAll('.js-scene-tpl').forEach(btn => {
    btn.addEventListener('click', () => {
      scene.layoutTemplate = btn.dataset.val === '(기본)' ? null : btn.dataset.val;
      renderEditPanel();
      renderCurrentScene();
    });
  });
  _bindTextAnchorEvents(panel, scene);
}

/* ================================================================
   모드 선택 UI (모드 시스템 뼈대 1차) ──
   ─────────────────────────────────────────────────────────────
   · 4개 카드형 버튼: 텍스트형 / 그림책형 / 무비형 / 기록물형
   · scene.presentationMode 저장 — null이면 picturebook로 해석됨
   · 각 모드별 상세 옵션은 이번 턴에 없음 (다음 턴들에서 모드 전용 편집층 추가)
   · 잠금은 기존 _editText.editable 공유 — 읽기 전용 상태면 버튼 비활성
   ================================================================ */
const PRESENTATION_MODE_OPTIONS = [
  { key: 'text',        icon: '📝', label: '텍스트형', desc: '읽는 장면' },
  { key: 'picturebook', icon: '🎨', label: '그림책형', desc: '그림+글' },
  { key: 'movie',       icon: '🎬', label: '무비형',   desc: '영상+선택' },
  { key: 'document',    icon: '📜', label: '기록물형', desc: '문서·단서' },
];

function _modePickerHtml(scene) {
  /* resolvePresentationMode 없으면 picturebook로 간주 (방어) */
  const current = (typeof resolvePresentationMode === 'function')
    ? resolvePresentationMode(scene) : 'picturebook';
  /* 명시 설정된 값 (null이면 '기본' 표기 대신 picturebook 버튼이 active) */
  const isExplicit = scene.presentationMode === 'text' ||
                     scene.presentationMode === 'picturebook' ||
                     scene.presentationMode === 'movie' ||
                     scene.presentationMode === 'document';

  const cards = PRESENTATION_MODE_OPTIONS.map(opt => {
    const active = (opt.key === current);
    return `<button type="button"
      class="edit-mode-card js-mode-card${active ? ' edit-mode-card--active' : ''}"
      data-val="${opt.key}"
      title="${opt.label} · ${opt.desc}">
      <span class="edit-mode-icon">${opt.icon}</span>
      <span class="edit-mode-label">${opt.label}</span>
      <span class="edit-mode-desc">${opt.desc}</span>
    </button>`;
  }).join('');

  /* 모드별 전용 힌트 (패널 밀도 축소) ──
     형식: 제목 한 줄 + 핵심 1줄 요약 (경고/note만 조건부 추가) */
  let modeHint = '';
  if (current === 'text') {
    const hasImage = !!scene.imageData;
    modeHint = `
      <div class="edit-mode-detail edit-mode-detail--text">
        <span class="edit-mode-detail-title">📝 텍스트형</span>
        <span class="edit-mode-detail-desc">종이톤 + 명조체로 읽기 중심 장면. 선택지는 하단 선택 구역.</span>
        ${hasImage ? '<div class="edit-mode-detail-warn">⚠ 배경 이미지는 흐리게 깔려요. 이미지 중심이면 그림책형이 더 어울려요.</div>' : ''}
      </div>`;
  } else if (current === 'picturebook') {
    modeHint = `
      <div class="edit-mode-detail edit-mode-detail--picturebook">
        <span class="edit-mode-detail-title">🎨 그림책형</span>
        <span class="edit-mode-detail-desc">이미지 위에 제목·본문·선택지가 놓이는 기본 장면.</span>
      </div>`;
  } else if (current === 'document') {
    modeHint = `
      <div class="edit-mode-detail edit-mode-detail--document">
        <span class="edit-mode-detail-title">📜 기록물형</span>
        <span class="edit-mode-detail-desc">편지·메모처럼 문서 컨테이너 위에서 읽는 장면.</span>
      </div>`;
  } else if (current === 'movie') {
    modeHint = `
      <div class="edit-mode-detail edit-mode-detail--movie">
        <span class="edit-mode-detail-title">🎬 무비형</span>
        <span class="edit-mode-detail-desc">검은 시네마틱 무대에 영상·포스터·자막.</span>
        <div class="edit-mode-detail-note">영상 업로드는 다음 단계 예정 — 지금은 배치만.</div>
      </div>`;
  }

  /* 모드별 서브모드 선택 (그림책형 1차 + 기록물형 1차) ──
     picturebook → spread/stage
     document    → letter/clue
     movie       → 무비형 전용 편집 구역 (설계 1차: placeholder) */
  let submodeUi = '';
  if (current === 'picturebook') {
    submodeUi = _picturebookSubmodeHtml(scene);
    /* v138: 톤 UI 호출은 _typeSectionPicturebookHtml(2770줄)에 둠 —
       사용자 작품(picturebook 명시)은 _typeSectionsHtml → _typeSectionPicturebookHtml
       경로로 흐름. 여기(_modePickerHtml)는 모드 미지정 작품용 dead path라
       톤 호출을 넣지 않음. 넣으면 중복 표시 위험. */
  } else if (current === 'document') {
    submodeUi = _documentSubmodeHtml(scene);
  } else if (current === 'movie') {
    submodeUi = _moviePanelHtml(scene);
  }

  const fallbackHint = isExplicit
    ? ''
    : '<div class="edit-mode-hint">아직 모드가 지정되지 않아 <b>그림책형(기본값)</b>으로 보이고 있어요.</div>';

  return `
    <div class="edit-row edit-row--mode-picker">
      <label class="edit-label">장면 모드</label>
      <div class="edit-mode-grid">
        ${cards}
      </div>
      ${fallbackHint}
      ${modeHint}
      ${submodeUi}
    </div>`;
}

/* ================================================================
   picturebook 서브모드 선택 UI (그림책형 1차) ──
   · 2개 카드: 펼침면형(spread) / 장면형(stage)
   · 기본값 stage — 명시 설정 안 된 경우 stage 카드가 active
   ================================================================ */
const PICTUREBOOK_SUBMODE_OPTIONS = [
  { key: 'stage',  icon: '🖼️',  label: '장면형',   desc: '큰 장면 + 글' },
  { key: 'spread', icon: '📖', label: '펼침면형', desc: '좌그림 우텍스트' },
];

function _picturebookSubmodeHtml(scene) {
  const current = (typeof resolvePresentationSubmode === 'function')
    ? resolvePresentationSubmode(scene) : 'stage';

  const cards = PICTUREBOOK_SUBMODE_OPTIONS.map(opt => {
    const active = (opt.key === current);
    return `<button type="button"
      class="edit-submode-card js-submode-card${active ? ' edit-submode-card--active' : ''}"
      data-val="${opt.key}"
      title="${opt.label} · ${opt.desc}">
      <span class="edit-submode-icon">${opt.icon}</span>
      <span class="edit-submode-label">${opt.label}</span>
      <span class="edit-submode-desc">${opt.desc}</span>
    </button>`;
  }).join('');

  const detailMap = {
    spread: { title: '📖 펼침면형', desc: '왼쪽 그림 · 오른쪽 글 — 책 펼침 리듬.' },
    stage:  { title: '🖼️ 장면형',   desc: '큰 장면 위에 글·선택지 — 기본 인터랙티브.' },
  };
  const d = detailMap[current] || detailMap.stage;
  const detail = `
    <div class="edit-submode-detail edit-submode-detail--picturebook">
      <span class="edit-submode-detail-title">${d.title}</span>
      <span class="edit-submode-detail-desc">${d.desc}</span>
    </div>`;

  return `
    <div class="edit-submode-block edit-submode-block--picturebook">
      <label class="edit-sublabel">그림책형 · 세부 방식</label>
      <div class="edit-submode-grid">${cards}</div>
      ${detail}
    </div>`;
}

function _bindSubmodePickerEvents(panel, scene) {
  /* submode 카드는 picturebook/document 공용 — 허용값은 resolvePresentationSubmode가 검사 */
  const validValues = ['spread', 'stage', 'letter', 'clue'];
  panel.querySelectorAll('.js-submode-card').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_editText.editable) return;
      const val = btn.dataset.val;
      if (validValues.indexOf(val) === -1) return;
      scene.presentationSubmode = val;
      _queueSave(scene.id, { presentationSubmode: val });
      renderEditPanel();
      renderCurrentScene();
    });
  });
}

/* ================================================================
   v138: 그림책형 분할형 본문 카드 톤 시스템 UI
   ─────────────────────────────────────────────────────────────
   세 가지 axis:
   · card-style    (작품 단위) — 기본/연한 종이/감성 테두리/파스텔 카드
                                  → 장면 1에서만 노출
   · card-color    (작품 단위) — 기본 흰색/숲빛 초록/따뜻한 노랑/차분한 파랑
                                  → 장면 1에서만 노출
   · card-tone     (장면 단위) — 기본/밝게/은은하게/차분하게/진하게
                                  → 일반 장면 (엔딩 제외)
   · card-end-tone (장면 단위) — 기본 마감/밝은 마감/여운 마감
                                  → 엔딩 장면 전용

   장면 1 식별: ViewerState.project.entrySceneId === scene.id
                또는 fallback으로 scene.isStart === true.
   엔딩 식별: scene.isEnding === true.
   표지(cover) → 호출 안 됨 (_typeSectionsHtml에서 cover면 early return).
   ================================================================ */
const _PB_TONE_CARD_STYLES = [
  { val: 'default', label: '기본' },
  { val: 'paper',   label: '연한 종이' },
  { val: 'border',  label: '감성 테두리' },
  { val: 'pastel',  label: '파스텔 카드' },
];
const _PB_TONE_CARD_COLORS = [
  { val: 'white',  label: '기본 흰색' },
  { val: 'green',  label: '숲빛 초록' },
  /* v138-fix11 (v135-3 추가 보정): UI 이름 '따뜻한 노랑' → '햇살 크림'.
     실제 색 방향이 cream/honey 쪽이라 사용자 인식과 일치하게. 내부값 'yellow'
     유지 (Firebase 저장값 호환 — 옛 작품도 그대로 작동). */
  { val: 'yellow', label: '햇살 크림' },
  { val: 'blue',   label: '차분한 파랑' },
];
/* v138-fix12 (v135-5): 본문 카드 톤 UI 이름을 감정/분위기 → 강도 단계로 변경.
   사용자 명세 — '은은하게'·'차분하게'는 직관성 낮음. 숫자 단계로 변경.
   내부값(default/bright/develop/tense/crisis)은 그대로 유지 → Firebase
   저장값 호환. 옛 작품 그대로 작동. CSS 톤 값도 변경 X. */
const _PB_TONE_SCENE_TONES = [
  { val: 'default', label: '기본' },
  { val: 'bright',  label: '1단계' },
  { val: 'develop', label: '2단계' },
  { val: 'tense',   label: '3단계' },
  { val: 'crisis',  label: '4단계' },
];
const _PB_TONE_ENDING_TONES = [
  { val: 'default',   label: '기본 마감' },
  { val: 'bright',    label: '밝은 마감' },
  { val: 'afterglow', label: '여운 마감' },
];

/* PANEL-DEADCODE-1: _pbToneSectionHtml(우패널 전용 본문 카드 톤 collapsible) 제거 — 카드톤/엔딩톤은
   🎭 장면 스타일(_pbSceneToneSectionHtml), 카드 스타일/색계열은 ⚙️ 작품 설정이 주 동선.
   PANEL-CLEANUP-1B에서 호출부 제거됨 → 0 active caller. 공용 _pbToneRowHtml·_PB_TONE_* consts·
   _pbSceneToneSectionHtml은 무관(유지). */

/* SCENE-STYLE-1: 🎭 장면 스타일 팝오버용 — 현재 장면의 장면단위 톤 row만.
   비엔딩=본문 카드 톤(pbCardTone) / 엔딩=엔딩 마감톤(pbEndingTone). 기존 순수 _pbToneRowHtml
   + 기존 const 재사용. axis(card-tone/card-end-tone)·저장 경로(_queueSave)는 우측과 동일.
   ★ 작품단위 card-style/card-color는 포함하지 않음(그건 ⚙️ 작품 설정). _pbToneSectionHtml 무수정. */
function _pbSceneToneSectionHtml(scene) {
  /* D8-CLEAN-1: 신규 5스킨에서 스킨이 본문/엔딩 톤을 담당(imageCenter pb-tone 무력화 완료) →
     본문 톤(pbCardTone)/엔딩 마감톤(pbEndingTone) UI 숨김. 필드·pb-tone.css·_pbToneClasses 무변경
     (legacy/split에 남은 영향은 건드리지 않음). */
  return '';
  if (!scene || scene.type === 'cover' || scene.isCover) return '';
  const isEnding = !!scene.isEnding;
  return isEnding
    ? _pbToneRowHtml('card-end-tone', '엔딩 마감톤',
        '결말의 느낌에 맞게 마감 분위기를 정해요.',
        _PB_TONE_ENDING_TONES, scene.pbEndingTone || '')
    : _pbToneRowHtml('card-tone', '본문 카드 톤',
        '본문 카드의 색감 정도를 조절해요. 숫자가 높을수록 색감이 더 진해져요. 학생 그림과 선택 버튼은 바뀌지 않아요.',
        _PB_TONE_SCENE_TONES, scene.pbCardTone || '');
}

function _pbToneRowHtml(axis, label, hint, options, current) {
  /* v138-fix6: HTML disabled 속성은 쓰지 않음. 잠금 시각은 body.viewer-edit-readonly로
     CSS 처리. 클릭 차단은 _bindPbToneEvents에서 _editText.editable 검사. */
  const gridModifier = options.length === 5 ? ' edit-tone-btn-grid--5'
                     : options.length === 3 ? ' edit-tone-btn-grid--3'
                     : '';
  const btns = options.map(opt => {
    const active = (opt.val === current);
    return `<button type="button"
      class="edit-tone-btn js-pb-tone-btn${active ? ' edit-tone-btn--active' : ''}"
      data-pb-tone-axis="${axis}"
      data-pb-tone-val="${opt.val}"
      title="${opt.label}">${opt.label}</button>`;
  }).join('');
  return `
    <div class="edit-tone-row">
      <div class="edit-tone-row__head">
        <span class="edit-tone-row__label">${label}</span>
      </div>
      ${hint ? `<div class="edit-tone-row__hint">${hint}</div>` : ''}
      <div class="edit-tone-btn-grid${gridModifier}">${btns}</div>
    </div>`;
}

function _bindPbToneEvents(panel, scene) {
  if (!panel || !scene) return;
  panel.querySelectorAll('.js-pb-tone-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_editText.editable) return;
      const axis = btn.getAttribute('data-pb-tone-axis');
      const val  = btn.getAttribute('data-pb-tone-val');
      if (!axis || !val) return;

      const proj = ViewerState.project || (ViewerState.project = {});

      if (axis === 'card-style') {
        if (proj.textCardStyle === val) return;
        proj.textCardStyle = val;
        if (typeof saveViewerMeta === 'function') {
          saveViewerMeta().catch(e => console.warn('[v138 tone] saveViewerMeta(textCardStyle):', e));
        }
      } else if (axis === 'card-color') {
        if (proj.textCardColor === val) return;
        proj.textCardColor = val;
        if (typeof saveViewerMeta === 'function') {
          saveViewerMeta().catch(e => console.warn('[v138 tone] saveViewerMeta(textCardColor):', e));
        }
      } else if (axis === 'card-tone') {
        if (scene.pbCardTone === val) return;
        scene.pbCardTone = val;
        _queueSave(scene.id, { pbCardTone: val });
      } else if (axis === 'card-end-tone') {
        if (scene.pbEndingTone === val) return;
        scene.pbEndingTone = val;
        _queueSave(scene.id, { pbEndingTone: val });
      } else {
        return;
      }

      /* 같은 axis 행 안에서 active 토글 — renderEditPanel 호출 X (탭 보존 + 무의미한 재렌더 회피) */
      const row = btn.closest('.edit-tone-btn-grid');
      if (row) {
        row.querySelectorAll('.js-pb-tone-btn').forEach(b => {
          b.classList.toggle('edit-tone-btn--active', b === btn);
        });
      }
      /* 미리보기 즉시 갱신 — viewer-render의 _renderScenePicturebook이 다시 호출되며
         .pb-frame에 새 톤 클래스가 적용됨.
         ⚠️ 이 핸들러는 ⚙️ 작품 설정·🎨 장면 스타일 팝오버 안에서만 호출된다.
         renderCurrentScene()은 HUD/네비까지 통째 재렌더해 팝오버 DOM이 닫혀버린다
         (다른 팝오버 옵션은 _scheduleViewerFrameReRender만 써서 안 닫힘 → 일관성 깨짐).
         frame만 갱신해 팝오버를 유지한다. 팝오버 닫기는 ✕ 버튼으로만. */
      if (typeof _scheduleViewerFrameReRender === 'function') _scheduleViewerFrameReRender();
    });
  });
}

/* ================================================================
   document 서브모드 선택 UI (기록물형 1차) ──
   · 2개 카드: 편지형(letter) / 단서형(clue)
   · 기본값 letter — 명시 설정 안 된 경우 letter 카드가 active
   · picturebook 서브모드와 시각적으로 같은 패턴(통일된 UI)
   ================================================================ */
const DOCUMENT_SUBMODE_OPTIONS = [
  { key: 'letter', icon: '✉️', label: '편지형', desc: '편지·메시지' },
  { key: 'clue',   icon: '🔍', label: '단서형', desc: '메모·자료' },
];

function _documentSubmodeHtml(scene) {
  const current = (typeof resolvePresentationSubmode === 'function')
    ? resolvePresentationSubmode(scene) : 'letter';

  const cards = DOCUMENT_SUBMODE_OPTIONS.map(opt => {
    const active = (opt.key === current);
    return `<button type="button"
      class="edit-submode-card js-submode-card${active ? ' edit-submode-card--active' : ''}"
      data-val="${opt.key}"
      title="${opt.label} · ${opt.desc}">
      <span class="edit-submode-icon">${opt.icon}</span>
      <span class="edit-submode-label">${opt.label}</span>
      <span class="edit-submode-desc">${opt.desc}</span>
    </button>`;
  }).join('');

  const detailMap = {
    letter: { title: '✉️ 편지형', desc: '편지지 위 서술체 — 메시지·고백·안내.' },
    clue:   { title: '🔍 단서형', desc: '자료 카드 — 조사·추적·정보 조각.' },
  };
  const d = detailMap[current] || detailMap.letter;
  const detail = `
    <div class="edit-submode-detail edit-submode-detail--document">
      <span class="edit-submode-detail-title">${d.title}</span>
      <span class="edit-submode-detail-desc">${d.desc}</span>
    </div>`;

  return `
    <div class="edit-submode-block edit-submode-block--document">
      <label class="edit-sublabel">기록물형 · 세부 방식</label>
      <div class="edit-submode-grid">${cards}</div>
      ${detail}
    </div>`;
}

/* ================================================================
   무비형 전용 편집 구역 (무비형 설계 1차) ──
   · 실제 업로드 UI 아님 — 설계 단계의 placeholder + 레이아웃 옵션
   · 항목:
     1) 영상 / 포스터 슬롯 (disabled placeholder — "다음 단계에서 연결")
     2) captionMode: overlay / caption-bar (본문 표시 방식)
     3) choiceReveal: end / always (선택지 노출 시점)
   · 저장: scene.movieData 서브 오브젝트로 whitelist 통과
   ================================================================ */
function _moviePanelHtml(scene) {
  const md = (typeof getMovieData === 'function')
    ? getMovieData(scene)
    : { videoUrl: null, posterImage: null, captionMode: 'overlay', choiceReveal: 'end' };

  const hasPoster = !!(md.posterImage || scene.imageData);
  const posterSrc = md.posterImage || scene.imageData || null;

  const captionOptions = [
    { key: 'overlay',     label: '자막 덮기', desc: '영상 위에 자막처럼 겹치기' },
    { key: 'caption-bar', label: '자막바',    desc: '영상 아래 자막 띠' },
  ];
  const revealOptions = [
    { key: 'end',    label: '영상 끝에서', desc: '영상이 끝나면 나타나요' },
    { key: 'always', label: '항상 표시',    desc: '영상과 함께 내내 보여요' },
  ];

  return `
    <div class="edit-submode-block edit-submode-block--movie">
      <label class="edit-sublabel">무비형 · 전용 설정</label>

      <!-- 영상 / 포스터 슬롯 (비활성 — 연결 예정) -->
      <div class="edit-movie-slots">
        <div class="edit-movie-slot edit-movie-slot--video is-disabled"
             aria-disabled="true" title="영상 업로드는 준비 중이에요">
          <div class="edit-movie-slot-locked-badge">🔒 준비 중</div>
          <div class="edit-movie-slot-icon">🎞</div>
          <div class="edit-movie-slot-title">영상 파일</div>
          <div class="edit-movie-slot-note">업로드 준비 중</div>
        </div>
        <div class="edit-movie-slot edit-movie-slot--poster${hasPoster ? ' has-source' : ' is-disabled'}"
             ${hasPoster ? '' : 'aria-disabled="true" title="포스터 업로드는 준비 중이에요. 지금은 장면 이미지가 자동으로 쓰여요."'}>
          ${hasPoster
            ? `<img src="${escHtml(posterSrc)}" alt="포스터 미리보기" class="edit-movie-poster-preview">
               <div class="edit-movie-slot-overlay-label">포스터 (장면 이미지 사용 중)</div>`
            : `<div class="edit-movie-slot-locked-badge">🔒 준비 중</div>
               <div class="edit-movie-slot-icon">🖼️</div>
               <div class="edit-movie-slot-title">포스터 이미지</div>
               <div class="edit-movie-slot-note">없으면 장면 이미지가 대신 쓰여요</div>`}
        </div>
      </div>

      <!-- 자막 / 본문 표시 방식 -->
      <div class="edit-movie-row">
        <label class="edit-movie-label">본문 표시</label>
        <div class="edit-toggle-group">
          ${captionOptions.map(opt => `
            <button type="button"
              class="edit-toggle js-movie-caption${md.captionMode === opt.key ? ' active' : ''}"
              data-val="${opt.key}"
              title="${opt.desc}">${opt.label}</button>
          `).join('')}
        </div>
      </div>

      <!-- 선택지 노출 시점 -->
      <div class="edit-movie-row">
        <label class="edit-movie-label">선택지 노출</label>
        <div class="edit-toggle-group">
          ${revealOptions.map(opt => `
            <button type="button"
              class="edit-toggle js-movie-reveal${md.choiceReveal === opt.key ? ' active' : ''}"
              data-val="${opt.key}"
              title="${opt.desc}">${opt.label}</button>
          `).join('')}
        </div>
      </div>

      <div class="edit-movie-note">
        💡 자막 모드(본문 표시)가 텍스트 위치를 결정 — 텍스트 위치 프리셋은 무비형에선 적용 안 됨.
      </div>
    </div>`;
}

function _bindMoviePanelEvents(panel, scene) {
  /* movieData 부분 업데이트 + 저장 helper */
  const writeMovieField = (key, val) => {
    const prev = (typeof getMovieData === 'function')
      ? getMovieData(scene)
      : { videoUrl: null, posterImage: null, captionMode: 'overlay', choiceReveal: 'end' };
    const next = Object.assign({}, prev, { [key]: val });
    scene.movieData = next;
    _queueSave(scene.id, { movieData: next });
    renderEditPanel();
    renderCurrentScene();
  };

  panel.querySelectorAll('.js-movie-caption').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_editText.editable) return;
      const val = btn.dataset.val;
      if (val !== 'overlay' && val !== 'caption-bar') return;
      writeMovieField('captionMode', val);
    });
  });
  panel.querySelectorAll('.js-movie-reveal').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_editText.editable) return;
      const val = btn.dataset.val;
      if (val !== 'end' && val !== 'always') return;
      writeMovieField('choiceReveal', val);
    });
  });
}

function _bindModePickerEvents(panel, scene) {
  panel.querySelectorAll('.js-mode-card').forEach(btn => {
    btn.addEventListener('click', () => {
      /* 잠금 없는 상태에서는 변경 차단 (안전장치) */
      if (!_editText.editable) return;
      const val = btn.dataset.val;
      if (!val) return;
      scene.presentationMode = val;
      /* saveSceneText 경유로 DB 저장 — scene 본체(presentationMode) */
      _queueSave(scene.id, { presentationMode: val });
      /* 패널은 다시 렌더해서 active 카드 반영, 무대도 data-presentation-mode 갱신 */
      renderEditPanel();
      renderCurrentScene();
    });
  });
  /* picturebook/document 서브모드 카드 바인딩 (그림책형 1차 + 기록물형 1차) */
  _bindSubmodePickerEvents(panel, scene);
  /* 무비형 전용 편집 구역 바인딩 (무비형 설계 1차) */
  _bindMoviePanelEvents(panel, scene);
}

/* ================================================================
   텍스트 배치 프리셋 (그림책용 앵커) ──
   ─────────────────────────────────────────────────────────────
   · 장면 단위 설정: scene.textAnchor
   · 저장은 saveViewerMeta()가 scene_anchor_${scene.id} 키로 처리
   · 9방향 3x3 그리드 (좌/중앙/우) × (상/중/하)
   · 기본 = null → 현재 장면 레이아웃의 기본 동작 유지 (하위 호환)
   · 편집 가능 조건: 기존 sceneTemplate과 동일 (editMode + 현재 장면)
   ================================================================ */
const TEXT_ANCHOR_GRID = [
  ['top-left',    'top-center',    'top-right'],
  ['middle-left', 'middle-center', 'middle-right'],
  ['bottom-left', 'bottom-center', 'bottom-right'],
];
const TEXT_ANCHOR_LABEL = {
  'top-left':      '좌상', 'top-center':    '상단', 'top-right':    '우상',
  'middle-left':   '좌중', 'middle-center': '중앙', 'middle-right': '우중',
  'bottom-left':   '좌하', 'bottom-center': '하단', 'bottom-right': '우하',
};

function _textAnchorHtml(scene) {
  const current = scene.textAnchor || null;  // null = 기본
  /* movie 모드에서는 textAnchor가 자막 모드에 덮임 — 그리드 자체 숨김 + 안내만 (패널 밀도 축소) */
  const movieMode = (typeof resolvePresentationMode === 'function')
    && resolvePresentationMode(scene) === 'movie';
  if (movieMode) {
    return `
    <div class="edit-row edit-row--muted-compact">
      <label class="edit-label">텍스트 위치</label>
      <div class="edit-anchor-movie-note edit-anchor-movie-note--solo">
        🎬 무비형에서는 자막 모드가 위치를 결정 — 이 프리셋은 작동하지 않아요.
      </div>
    </div>`;
  }

  const cells = TEXT_ANCHOR_GRID.map(row =>
    row.map(key => {
      const active = current === key ? 'edit-anchor-cell--active' : '';
      return `<button type="button"
        class="edit-anchor-cell ${active} js-text-anchor"
        data-val="${key}"
        title="${TEXT_ANCHOR_LABEL[key]}"
        aria-label="${TEXT_ANCHOR_LABEL[key]}">
        <span class="edit-anchor-dot"></span>
      </button>`;
    }).join('')
  ).join('');

  const resetActive = !current ? 'edit-toggle--active' : '';
  return `
    <div class="edit-row">
      <label class="edit-label">텍스트 위치</label>
      <div class="edit-anchor-grid-row">
        <div class="edit-anchor-grid" role="group" aria-label="텍스트 배치 프리셋">
          ${cells}
        </div>
        <button type="button" class="edit-toggle js-text-anchor-reset ${resetActive}" data-val="">
          기본
        </button>
      </div>
      <div class="edit-anchor-current">
        현재 위치: <b>${current ? TEXT_ANCHOR_LABEL[current] : '기본'}</b>
      </div>
    </div>`;
}

function _bindTextAnchorEvents(panel, scene) {
  const apply = (val) => {
    /* 편집 가능 여부는 이 패널이 렌더된 조건(editMode + 현재 장면)에
       의해 이미 보장됨 — 별도 체크 불필요. val === '' → null (기본). */
    scene.textAnchor = val || null;
    renderEditPanel();
    renderCurrentScene();
  };
  panel.querySelectorAll('.js-text-anchor').forEach(btn => {
    btn.addEventListener('click', () => apply(btn.dataset.val));
  });
  panel.querySelector('.js-text-anchor-reset')
    ?.addEventListener('click', () => apply(''));
}

/* ================================================================
   edit panel 상단 액션 — 감상 테스트 / 작업으로 돌아가기
   W9 (v4): 액션 버튼들이 HUD maker-return-bar로 이전 → 인스펙터는 빈 반환.
   ================================================================ */
function _editActionsHtml() {
  return '';  /* HUD로 이동. _bindHudEditActions에서 바인딩됨 */
}


/* ================================================================
   W9 (v12): imageTransform flatten — 변환된 사진을 새 imageData로.
   ※ (v13에서 폐기) — 사용자 결정: 그리기는 사진 없을 때만. flatten 불필요.
   다만 향후 다른 용도(예: 작품 export) 가능성 위해 함수는 유지.
   ================================================================ */
async function _flattenImageTransform(imageDataUrl, transform) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const nw = img.naturalWidth, nh = img.naturalHeight;
        const t = transform || {};
        const cr = t.crop || { x: 0, y: 0, w: 100, h: 100 };
        const posX = (t.posX != null ? t.posX : 50);
        const posY = (t.posY != null ? t.posY : 50);
        const sX = (t.scaleX != null ? t.scaleX : 100) / 100;
        const sY = (t.scaleY != null ? t.scaleY : 100) / 100;

        /* 캔버스 = 사진 자연 비율. crop 적용된 영역이 캔버스 가득 차지. */
        const canvas = document.createElement('canvas');
        canvas.width = nw;
        canvas.height = nh;
        const ctx = canvas.getContext('2d');

        /* 1) 캔버스 중심 기준 transform 적용
           2) crop 영역의 사진을 캔버스 가득 그림 */
        ctx.translate(canvas.width / 2, canvas.height / 2);
        const trX = (posX - 50) / 100 * canvas.width;
        const trY = (posY - 50) / 100 * canvas.height;
        ctx.translate(trX, trY);
        ctx.scale(sX, sY);
        ctx.translate(-canvas.width / 2, -canvas.height / 2);

        const sx = nw * cr.x / 100;
        const sy = nh * cr.y / 100;
        const sw = nw * cr.w / 100;
        const sh = nh * cr.h / 100;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('이미지 로드 실패'));
    img.src = imageDataUrl;
  });
}

async function _saveFlattenedImage(sceneNum, newImageDataUrl) {
  /* P5-IMAGE-LOCK-1: AI 이미지 보기 중엔 flatten 저장(원본 imageData write) 차단.
     ※ 현재 flatten 경로는 v13에서 폐기되어 호출처가 없으나, 원본 보호 안전망으로 진입부 가드 유지. */
  if (_aiImageVariantBlocksOriginalEdit({ silent: true })) return;
  try {
    const teamName = ViewerState.project.teamName;
    const classId  = ViewerState.project.classId;
    if (!teamName || typeof getViewerDb !== 'function') return;

    /* v122-fix: 이미지 평탄화 결과도 Storage 업로드 후 URL만 RTDB에 저장.
       옛엔 canvas.toDataURL() 결과(base64)를 imageData 필드에 직접 update —
       v113~v114 마이그/신규 흐름 우회 경로였음. base64 폭탄 재발 차단. */
    let storageUrl;
    try {
      if (typeof viewerUploadImageToStorage !== 'function') {
        throw new Error('Storage 업로드 함수를 찾을 수 없어요.');
      }
      const r = await viewerUploadImageToStorage(newImageDataUrl, sceneNum);
      storageUrl = r.downloadURL;
    } catch (e) {
      console.error('[flatten save] Storage 업로드 실패:', e);
      alert('이미지를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
      return;
    }

    const encodedName = encodeURIComponent(teamName);
    const basePath = classId
      ? `classes/${classId}/teams/${encodedName}`
      : `teams/${encodedName}`;
    await getViewerDb().ref(`${basePath}/scenes/${sceneNum}`).update({
      imageData: storageUrl,
      imageTransform: null,
    });
  } catch (err) {
    console.error('[flatten save] 실패:', err);
  }
}

/* ================================================================
   HOTFIX(생각 나침반 결과 보기) — 다듬기 화면 작품단위 참고 패널
   ─────────────────────────────────────────────────────────────
   · compass 스크립트는 viewer에 미로드 → 클릭 시 1회 지연로드(css + readOnly 최소 5스크립트 + window.db).
     window.db = 편집 세션 default app(maker UID)의 database → Store가 writingGuide read(읽기 전용).
   · 기존 ThoughtCompassReview.openReadOnly(ctx) 재사용 = 브랜치 화면과 동일 UI. API 호출·생성·배정 0.
   · 메뉴 노출은 기록 존재 시만(_ensureCompassRecordChecked: 1회 DB read 캐시 → _applyCompassMenuVisibility).
   ================================================================ */
let _compassHasRecord = null;        /* null=미확인, true/false=확인됨(작품별 1회) */
let _compassBundlePromise = null;
function _compassCtx() {
  const p = (typeof ViewerState !== 'undefined' && ViewerState.project) ? ViewerState.project : {};
  return { classId: p.classId || null, teamName: p.teamName || null, projectType: p.projectType || null };
}
function _applyCompassMenuVisibility() {
  const el = document.querySelector('.js-edit-compass-result');
  if (el) el.style.display = (_compassHasRecord === true) ? '' : 'none';
}
async function _ensureCompassRecordChecked() {
  if (_compassHasRecord !== null) { _applyCompassMenuVisibility(); return; }
  const ctx = _compassCtx();
  if (!ctx.classId || !ctx.teamName || (ctx.projectType !== 'text' && ctx.projectType !== 'picturebook')
      || typeof getViewerDb !== 'function') { _compassHasRecord = false; _applyCompassMenuVisibility(); return; }
  try {
    const enc = encodeURIComponent(ctx.teamName);
    const snap = await getViewerDb().ref('classes/' + ctx.classId + '/teams/' + enc + '/writingGuide/preWriting').once('value');
    const raw = snap.val();
    _compassHasRecord = !!(raw && (raw.status === 'completed' || raw.status === 'inProgress'
      || typeof raw.completedAt === 'number'
      || (raw.answers && typeof raw.answers === 'object' && Object.keys(raw.answers).length > 0)));
  } catch (_) { _compassHasRecord = false; }
  _applyCompassMenuVisibility();
}
function _ensureCompassReviewBundle() {
  if (window.ThoughtCompassReview && typeof window.ThoughtCompassReview.openReadOnly === 'function') return Promise.resolve(true);
  if (_compassBundlePromise) return _compassBundlePromise;
  _compassBundlePromise = (async () => {
    /* Store는 전역 db 사용 → 편집 default app(maker UID) database 노출(읽기 전용만 사용). */
    try { if (!window.db && typeof getViewerApp === 'function') window.db = getViewerApp().database(); } catch (_) {}
    const load = (src) => new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.async = false;
      s.onload = () => res(); s.onerror = () => rej(new Error('load fail ' + src)); document.head.appendChild(s);
    });
    if (!document.querySelector('link[data-tc-review-css]')) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'thought-compass.css?v=154b9c4183';
      l.setAttribute('data-tc-review-css', '1'); document.head.appendChild(l);
    }
    const V = '?v=e68d5807ff';
    await load('thought-compass.js' + V);
    await load('thought-compass-questions.js' + V);
    await load('thought-compass-flow.js' + V);
    await load('thought-compass-store.js' + V);
    await load('thought-compass-sheet.js' + V);   /* COMPASS-SHEET-1: v2 설계도 helper */
    await load('thought-compass-rose.js' + V);    /* COMPASS-ROSE-1: 나침반형 보기·인쇄 */
    await load('thought-compass-review.js' + V);
    return !!(window.ThoughtCompassReview && typeof window.ThoughtCompassReview.openReadOnly === 'function');
  })().catch((e) => { _compassBundlePromise = null; try { console.warn('[compass-view] 번들 로드 실패', e); } catch(_){} return false; });
  return _compassBundlePromise;
}
async function _openCompassResultViewer() {
  const ctx = _compassCtx();
  if (!ctx.classId || !ctx.teamName) return;
  try {
    const ok = await _ensureCompassReviewBundle();
    if (ok && window.ThoughtCompassReview && typeof window.ThoughtCompassReview.openReadOnly === 'function') {
      await window.ThoughtCompassReview.openReadOnly(ctx);
    } else if (typeof _showSaveStatus === 'function') {
      _showSaveStatus('생각 나침반 결과를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', 2500);
    }
  } catch (e) { try { console.warn('[compass-view] 열기 실패', e); } catch(_){} }
}

/* W9 (v4): HUD maker-return-bar 액션 버튼 핸들러.
   renderHud (viewer-render.js)에서 hud.innerHTML을 채운 직후 호출.
   document scope로 검색 — HUD 버튼은 #hud 안에 있음. */
function _bindHudEditActions() {
  /* REFINE-IA-3: ⋯ 더보기 메뉴 토글. 메뉴 항목(AI·설정·루트·구조·처음으로)의 기능 핸들러는
     아래 기존 document.querySelector 바인딩이 그대로 처리(메뉴 안에 있어도 동작). 여기선 열고닫기만.
     document outside/ESC 리스너는 열 때만 add, 닫을 때 remove → 재렌더 누적 0. */
  (function _bindHudMore() {
    /* REFINE-IA-3: 메뉴 열린 채 HUD가 재렌더되면 이전 document 리스너가 남을 수 있음 → 새 바인딩 전 정리(누적 0 보장). */
    if (typeof window.__hudMoreCleanup === 'function') { try { window.__hudMoreCleanup(); } catch (e) {} }
    window.__hudMoreCleanup = null;
    const moreBtn = document.querySelector('.js-hud-more');
    const menu    = document.getElementById('hud-more-menu');
    if (!moreBtn || !menu) return;
    const _onDocClick = (e) => {
      if (menu.contains(e.target) || moreBtn.contains(e.target)) return;
      _closeMore();
    };
    const _onEsc = (e) => { if (e.key === 'Escape') { _closeMore(); moreBtn.focus(); } };
    /* HUD-MENU-CLIP-FIX: 메뉴의 containing block(.maker-return-bar)·조상(#hud)이 모두 backdrop-filter라
       그 안의 position:fixed 자식은 Chrome에서 측정좌표(getBoundingClientRect)와 실제 페인트가 어긋나
       메뉴가 위(상단 고정바 영역)로 끌려 들어가 첫 항목이 잘리는 컴포지팅 버그가 있었다(GPU/버전 의존).
       → 메뉴를 document.body로 portal해 backdrop-filter 컨테이닝블록에서 분리하고 순수 viewport 좌표로
       배치한다. 닫을 때(또는 재렌더 cleanup) 원래 자리로 복귀해 orphan을 막는다. */
    function _portalOut() {
      if (menu.parentElement !== document.body) {
        menu.__restoreParent = menu.parentElement;
        menu.__restoreNext = menu.nextSibling;
        document.body.appendChild(menu);
      }
    }
    function _portalBack() {
      if (menu.__restoreParent) {
        try { menu.__restoreParent.insertBefore(menu, menu.__restoreNext); }
        catch (e) { menu.__restoreParent.appendChild(menu); }
        menu.__restoreParent = null;
        menu.__restoreNext = null;
      }
    }
    function _positionMore() {
      try {
        const br = moreBtn.getBoundingClientRect();
        if (!br.width) return;
        const gap = 8;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        /* 상단 고정바(maker-return-bar, 없으면 #hud) 하단 — 메뉴는 절대 이 위로 가지 않게 clamp */
        const barEl = moreBtn.closest('.maker-return-bar') || document.getElementById('hud');
        const headerBottom = barEl ? barEl.getBoundingClientRect().bottom : br.bottom;
        menu.style.position = 'fixed';
        menu.style.left = 'auto';
        menu.style.right = Math.round(Math.max(8, vw - br.right)) + 'px';
        menu.style.zIndex = '10010';            /* AI 보기바(10005)보다 위 — 어떤 레이어도 첫 항목을 덮지 않게 */
        menu.style.maxHeight = 'none';          /* 실제 높이 측정용 초기화 */
        menu.style.overflowY = 'visible';
        const mh = menu.offsetHeight;           /* 메뉴 전체 높이 */
        let top = br.bottom + gap;              /* 권장: 트리거 버튼 바로 아래 */
        if (top + mh > vh - 8) top = br.top - mh - gap;   /* 아래로 넘치면 위로 띄움 */
        top = Math.max(headerBottom + gap, top);          /* 어떤 경우에도 고정바 아래로 clamp */
        menu.style.top = Math.round(top) + 'px';
        /* clamp 후에도 아래가 넘치면 스크롤(첫 항목은 맨 위라 항상 보임) */
        const avail = Math.round(vh - top - 8);
        if (mh > avail) { menu.style.maxHeight = Math.max(120, avail) + 'px'; menu.style.overflowY = 'auto'; }
      } catch (e) { /* 위치계산 실패해도 메뉴는 열림(CSS fallback) */ }
    }
    function _openMore() {
      _portalOut();
      menu.hidden = false;
      _positionMore();
      requestAnimationFrame(_positionMore);
      setTimeout(_positionMore, 60);
      moreBtn.setAttribute('aria-expanded', 'true');
      document.addEventListener('click', _onDocClick, true);
      document.addEventListener('keydown', _onEsc, true);
      window.__hudMoreCleanup = function () {
        document.removeEventListener('click', _onDocClick, true);
        document.removeEventListener('keydown', _onEsc, true);
        _portalBack();   /* HUD 재렌더 중이면 메뉴를 옛 슬롯으로 빼 visible body에 orphan 남기지 않음 */
      };
      const first = menu.querySelector('.hud-more-item');
      if (first) setTimeout(() => first.focus({ preventScroll: true }), 0);
    }
    function _closeMore() {
      if (menu.hidden) return;
      menu.hidden = true;
      moreBtn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', _onDocClick, true);
      document.removeEventListener('keydown', _onEsc, true);
      window.__hudMoreCleanup = null;
      _portalBack();
    }
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu.hidden) _openMore(); else { _closeMore(); }
    });
    /* 메뉴 항목 클릭 시 메뉴 닫음(항목 자체 기능 핸들러는 별도로 실행). 설정 popover는
       _positionProjectPopover가 ⋯ 더보기 버튼 앵커 fallback이라 닫혀도 위치 정상. */
    menu.querySelectorAll('.hud-more-item').forEach(it => {
      it.addEventListener('click', () => _closeMore());
    });
  })();

  document.querySelector('.js-edit-preview-test')?.addEventListener('click', async () => {
    /* 감상 테스트 전환 전에 저장 마무리 + 내 잠금 릴리스 */
    await _flushPendingSave();
    if (_editText.num != null && typeof viewerIsMyLock === 'function' &&
        viewerIsMyLock(_editText.num)) {
      viewerReleaseLock(_editText.num);
    }
    _editText.num      = null;
    _editText.editable = false;
    ViewerState.editMode    = false;
    ViewerState._testingEdit = true;
    renderCurrentScene();
  });

  document.querySelector('.js-edit-open-map')?.addEventListener('click', openStructureMap);

  /* HOTFIX(생각 나침반 결과 보기): 클릭 → 읽기전용 결과 패널(지연로드 + 재사용). 메뉴 노출은 기록 있을 때만.
     HUD는 장면 전환마다 재렌더 → 매 바인딩 시 가시성 재적용(_compassHasRecord 캐시라 DB read는 1회). */
  document.querySelector('.js-edit-compass-result')?.addEventListener('click', () => { _openCompassResultViewer(); });
  _applyCompassMenuVisibility();
  _ensureCompassRecordChecked();

  /* 🤖 AI 작품 다듬기 — viewer-ai.js의 openModal 호출. (텍스트 1단계·작품 검사 = 실 API 작동.
     viewer-ai.js 미로드 환경 fallback: 안내 alert만.) */
  document.querySelector('.js-ai-trigger')?.addEventListener('click', () => {
    if (typeof window.viewerAi === 'object' && typeof window.viewerAi.openModal === 'function') {
      window.viewerAi.openModal();
    } else {
      alert('AI 기능을 불러오지 못했어요. 페이지를 새로고침해 주세요.');
    }
  });

  /* LEVELS-CONT(2단계 이어쓰기): [✅ 내 글 점검받기] — 작품 검사 단독 라이트(viewer-ai.startCheckLite).
     2단계 HUD 전용(viewer-render가 노출 게이트). 준비게이트/생각점검/마지막다듬기 없음. */
  document.querySelector('.js-ai-check-lite')?.addEventListener('click', () => {
    if (typeof window.viewerAi === 'object' && typeof window.viewerAi.startCheckLite === 'function') {
      window.viewerAi.startCheckLite();
    } else {
      alert('AI 기능을 불러오지 못했어요. 페이지를 새로고침해 주세요.');
    }
  });

  /* LEVELS-AUDIT F1: 2단계 [🖼️ AI 그림책 마감] — 작품 마무리 모달의 imageS2 카드와 동일 패널
     재사용(중복 구현 0). 변환 가능 여부(교사 토글·killswitch·대상 그림 유무)는 패널 gate가 판정. */
  document.querySelector('.js-ai-imgs2-open')?.addEventListener('click', () => {
    if (window.imageS2BatchUi && typeof window.imageS2BatchUi.open === 'function') {
      window.imageS2BatchUi.open();
    } else {
      alert('AI 그림책 마감을 불러오지 못했어요. 페이지를 새로고침해 주세요.');
    }
  });

  /* v123/v124b: 루트보기 — storyAnalyzer.js의 openRoutePanel 재사용.
     storyAnalyzer는 maker의 전역 scenes/projectMeta를 참조하고, scene 객체에서
     num/buttons/nextA/B를 읽음. viewer adaptScenes는 {id, choices}를 쓰는 다른 구조라
     변환 어댑터 필수. */
  /* PICTUREBOOK-PRINT-1: 그림책 분기 인쇄 — read만·번호 즉석 계산·발행 선택본 기준. */
  document.querySelector('.js-edit-print-pb')?.addEventListener('click', () => {
    if (window.PicturebookPrint && typeof window.PicturebookPrint.open === 'function') {
      window.PicturebookPrint.open();
    } else {
      alert('인쇄 기능을 불러오지 못했어요. 페이지를 새로고침해 주세요.');
    }
  });

  /* REFINE-STAB-D: 이야기 길 보기 — HUD 더보기에서 '작품 마무리' 모달로 이동.
     viewer-ai(작품 마무리 카드)가 호출하도록 window 노출. 기존 변환/닫기 로직 그대로. */
  window._openViewerRoutePanel = function () {
    if (typeof openRoutePanel !== 'function') {
      alert('루트 보기 기능을 불러오지 못했어요. 페이지를 새로고침해 주세요.');
      return;
    }
    /* ViewerState.scenes → maker 형식으로 변환:
       · id 필드를 num으로
       · choices → buttons 변환 ({label, nextId})
       · nextA/B/choiceA/B도 채움 (storyAnalyzer fallback 호환) */
    const sceneMap = {};
    if (typeof ViewerState !== 'undefined' && ViewerState.scenes) {
      Object.values(ViewerState.scenes).forEach(s => {
        if (!s) return;
        const num = s.num != null ? s.num : s.id;
        if (num == null) return;
        const choices = Array.isArray(s.choices) ? s.choices : [];
        const buttons = choices.map(c => ({
          label:  c && c.label  != null ? c.label  : '',
          nextId: c && c.nextId != null ? c.nextId : null,
        }));
        sceneMap[num] = Object.assign({}, s, {
          num: Number(num),                      /* "장면 N" 표시용 */
          buttons,                                /* findAllRoutes가 읽는 필드 */
          choiceA: buttons[0] ? buttons[0].label  : '',
          choiceB: buttons[1] ? buttons[1].label  : '',
          nextA:   buttons[0] ? buttons[0].nextId : null,
          nextB:   buttons[1] ? buttons[1].nextId : null,
          choiceCount: buttons.length,
          trueEnding: s.isTrueEnd || s.trueEnding || false,
        });
      });
    }
    window.scenes = sceneMap;
    window.projectMeta = (typeof ViewerState !== 'undefined' && ViewerState.project) ? ViewerState.project : {};
    openRoutePanel();

    /* v124b: ✕ 버튼 + 배경 클릭 핸들러도 바인딩 (원래 ui.js가 하는 일 — viewer.html엔 없음). */
    const closeBtn = document.getElementById('btn-route-close');
    const panel = document.getElementById('route-panel');
    if (closeBtn && !closeBtn.dataset.bound) {
      closeBtn.addEventListener('click', () => {
        if (typeof closeRoutePanel === 'function') closeRoutePanel();
      });
      closeBtn.dataset.bound = '1';
    }
    if (panel && !panel.dataset.bgBound) {
      panel.addEventListener('click', (e) => {
        if (e.target === panel && typeof closeRoutePanel === 'function') closeRoutePanel();
      });
      panel.dataset.bgBound = '1';
    }
  };
  /* 하위호환: 같은 클래스 버튼이 어딘가 남아 있으면 동일 함수로 동작 */
  document.querySelector('.js-edit-open-routes')?.addEventListener('click', window._openViewerRoutePanel);

  document.querySelector('.js-edit-return-maker')?.addEventListener('click', async () => {
    /* 작업 복귀 전에도 저장 마무리 + 잠금 릴리스 */
    await _flushPendingSave();
    if (_editText.num != null && typeof viewerIsMyLock === 'function' &&
        viewerIsMyLock(_editText.num)) {
      viewerReleaseLock(_editText.num);
    }
    if (typeof _returnToMaker === 'function') {
      _returnToMaker();
    } else {
      window.location.href = 'maker.html';
    }
  });

  /* 💾 저장 — 명시적 즉시 저장 (자동 저장 외 보조). HUD 안 btn → document scope. */
  document.querySelector('.js-edit-save')?.addEventListener('click', () => {
    if (typeof _doSave === 'function') _doSave(document);
  });

  /* TOP-TOOLBAR-2A: 🔗 버튼 — 일반 장면 행동버튼/연결 상단 팝오버 토글. */
  document.querySelector('.js-edit-choice-popover')?.addEventListener('click', () => {
    _toggleChoicePopover();
  });

  /* TOP-TOOLBAR-3A: 🎨 표지 — 표지 장면 표지색 상단 팝오버 토글. */
  document.querySelector('.js-edit-cover-popover')?.addEventListener('click', () => {
    _toggleCoverPopover();
  });

  /* PROJECT-SETTINGS-1A: ⚙️ 작품 설정 — 작품 전체 설정 상단 팝오버 토글(모든 장면 타입). */
  document.querySelector('.js-edit-project-popover')?.addEventListener('click', () => {
    _toggleProjectPopover();
  });

  /* PB-IMAGE-1B: 🖼️ 그림 — picturebook 장면 그림 도구 상단 팝오버 토글(1B는 빈 셸). */
  document.querySelector('.js-edit-image-popover')?.addEventListener('click', () => {
    _toggleImagePopover();
  });

  /* SCENE-STYLE-1: 🎭 장면 스타일 — picturebook 장면 카드톤/엔딩톤 상단 팝오버 토글. */
  document.querySelector('.js-edit-scene-style-popover')?.addEventListener('click', () => {
    _toggleSceneStylePopover();
  });

  /* MOVIE-TOOL-1A: 🎬 무비 — movie 장면 영상·본문 표시 모달 열기. */
  document.querySelector('.js-edit-movie-tool-modal')?.addEventListener('click', () => {
    if (typeof _openMovieToolModal === 'function') {
      _openMovieToolModal(ViewerState.scenes[ViewerState.currentSceneId]);
    }
  });
}

/* ================================================================
   TOP-TOOLBAR-2A: 일반 장면 "🔗 버튼" 상단 팝오버 (복제)
   ─────────────────────────────────────────────────────────────
   · 우측 1단 패널의 행동버튼 개수/선택지 연결을 상단에서도 조작.
   · 기존 _pbChoiceCountSectionHtml / _pbChoiceLinkSectionHtml HTML 그대로 재사용
     (둘 다 클래스+data-idx만 사용 → id 충돌 없음).
   · add/remove는 기존 _pbAddChoiceForScene / _pbRemoveLastChoiceForScene /
     _pbRemoveChoiceAtForScene 재사용(내부에서 _queueSaveButtons + renderEditPanel +
     미리보기 재렌더까지 수행) → 새 저장 로직 없음.
   · 팝오버 = 두 번째 사본 → 액션 후 self-refresh 필요(renderEditPanel은 #edit-panel만 갱신).
   · 우측 1단 패널은 이번 단계에서 그대로 유지(중복). 2B에서 가시성 축소 예정.
   ================================================================ */
function _choicePopoverEl() { return document.getElementById('edit-choice-popover'); }

function _isNormalEditScene(scene) {
  return !!(scene
    && scene.type !== 'cover'  && !scene.isCover
    && scene.type !== 'ending' && !scene.isEnding);
}

function _renderChoicePopoverBody(scene) {
  const ptype = (typeof _resolveViewerProjectType === 'function') ? _resolveViewerProjectType() : null;
  const rowDelete = (ptype === 'movie');   /* movie는 1단과 동일하게 행별 × 활성 */
  return `
    <div class="edit-choice-popover-head">
      <span class="edit-choice-popover-title">🔗 행동 버튼 · 연결</span>
      <button type="button" class="edit-choice-popover-close js-choice-popover-close"
        title="닫기" aria-label="닫기">✕</button>
    </div>
    <div class="edit-choice-popover-body">
      ${_pbChoiceCountSectionHtml(scene)}
      ${_pbChoiceLinkSectionHtml(scene, rowDelete)}
    </div>`;
}

function _refreshChoicePopover() {
  const pop = _choicePopoverEl();
  if (!pop || pop.hidden) return;
  const scene = ViewerState.scenes[ViewerState.currentSceneId];
  if (!scene || !_isNormalEditScene(scene)) { _closeChoicePopover(); return; }
  pop.innerHTML = _renderChoicePopoverBody(scene);
  _bindChoicePopover(pop);
}

function _bindChoicePopover(pop) {
  pop.querySelector('.js-choice-popover-close')
    ?.addEventListener('click', _closeChoicePopover);

  /* 매 액션마다 현재 장면을 새로 읽음(트리거 시점 캡처 X) — 정합 보호. */
  const _curScene = () => ViewerState.scenes[ViewerState.currentSceneId];

  /* 행동 버튼 추가 — 1단과 동일 helper(저장+패널 재렌더 포함) 후 팝오버 self-refresh */
  pop.querySelector('.js-pb-choice-add')?.addEventListener('click', () => {
    if (!_editText.editable) return;
    const s = _curScene(); if (!s) return;
    _pbAddChoiceForScene(s);
    _refreshChoicePopover();
  });

  /* 마지막 버튼 삭제 */
  const rmLast = pop.querySelector('.js-pb-choice-remove-last');
  if (rmLast) {
    rmLast.addEventListener('click', () => {
      if (!_editText.editable) return;
      if (rmLast.disabled) return;
      const s = _curScene(); if (!s) return;
      _pbRemoveLastChoiceForScene(s);
      _refreshChoicePopover();
    });
  }

  /* movie 행별 삭제(×) — 1단과 동일 helper */
  pop.querySelectorAll('.js-pb-choice-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_editText.editable) return;
      const idx = parseInt(btn.dataset.idx, 10);
      if (isNaN(idx)) return;
      const s = _curScene(); if (!s) return;
      _pbRemoveChoiceAtForScene(s, idx);
      _refreshChoicePopover();
    });
  });

  /* 선택지 연결 select — 1단 핸들러(viewer-edit.js:4385~)와 동일 데이터 경로.
     scene.choices[idx].nextId/nextNum 갱신 → _queueSaveButtons → 미리보기 재렌더.
     우측 패널 사본도 renderEditPanel로 동기화. */
  pop.querySelectorAll('.js-pb-choice-link').forEach(sel => {
    sel.addEventListener('change', () => {
      if (!_editText.editable) return;
      /* LEVELS-AUDIT F2: 일직선 잠금 — select disabled의 2중 방어 */
      if (_isLinearLockedViewer()) return;
      const idx = parseInt(sel.dataset.idx, 10);
      const s = _curScene();
      if (isNaN(idx) || !s || !s.choices || !s.choices[idx]) return;
      const val = sel.value || '';
      s.choices[idx].nextId  = val || null;
      s.choices[idx].nextNum = val ? Number(val) : null;
      _queueSaveButtons(s);
      _flushPendingSave();
      if (typeof _scheduleViewerFrameReRender === 'function') _scheduleViewerFrameReRender();
      if (typeof renderEditPanel === 'function') renderEditPanel();
      _refreshChoicePopover();
    });
  });
}

function _positionChoicePopover(pop) {
  const trigger = document.querySelector('.js-edit-choice-popover');
  if (!trigger) return;
  const r = trigger.getBoundingClientRect();
  pop.style.top = (r.bottom + 8) + 'px';
  const popW = pop.offsetWidth || 360;
  let left = r.left;
  const maxLeft = window.innerWidth - popW - 12;
  if (left > maxLeft) left = Math.max(12, maxLeft);
  pop.style.left = left + 'px';
}

function _openChoicePopover() {
  const pop = _choicePopoverEl();
  if (!pop) return;
  const scene = ViewerState.scenes[ViewerState.currentSceneId];
  if (!scene || !_isNormalEditScene(scene)) return;
  pop.innerHTML = _renderChoicePopoverBody(scene);
  pop.hidden = false;
  _bindChoicePopover(pop);
  _positionChoicePopover(pop);
  document.querySelector('.js-edit-choice-popover')?.classList.add('is-active');
  /* 바깥 클릭 / ESC 닫기 — setTimeout(0)로 현재 트리거 클릭이 즉시 닫지 않게 함. */
  setTimeout(() => {
    document.addEventListener('click', _choicePopoverOutside, true);
    document.addEventListener('keydown', _choicePopoverEsc, true);
  }, 0);
}

function _closeChoicePopover() {
  const pop = _choicePopoverEl();
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  pop.innerHTML = '';
  pop.style.left = '';
  pop.style.top  = '';
  document.querySelector('.js-edit-choice-popover')?.classList.remove('is-active');
  document.removeEventListener('click', _choicePopoverOutside, true);
  document.removeEventListener('keydown', _choicePopoverEsc, true);
}

function _toggleChoicePopover() {
  const pop = _choicePopoverEl();
  if (!pop) return;
  if (pop.hidden) _openChoicePopover();
  else _closeChoicePopover();
}

function _choicePopoverOutside(e) {
  const pop = _choicePopoverEl();
  if (!pop || pop.hidden) return;
  if (pop.contains(e.target)) return;
  /* 트리거 클릭은 토글 핸들러가 처리 — 여기서 닫지 않음(이중 토글 방지). */
  if (e.target.closest && e.target.closest('.js-edit-choice-popover')) return;
  _closeChoicePopover();
}

function _choicePopoverEsc(e) {
  if (e.key === 'Escape') _closeChoicePopover();
}

/* ================================================================
   TOP-TOOLBAR-3A: 표지 장면 "🎨 표지" 상단 팝오버 (복제)
   ─────────────────────────────────────────────────────────────
   · 우측 표지 인스펙터의 🎨 표지 색을 상단에서도 조작.
   · _coverThemeRowHtml(scene) HTML 그대로 재사용(class js-cover-theme + data-val만 사용).
   · 저장은 기존 표지 핸들러(viewer-edit.js _bindEditPanelEvents 표지 분기)와 동일 경로 —
     scene.coverTheme = val → _queueSave(scene.num||id,{coverTheme}) → _flushPendingSave.
     새 저장 로직 없음. titleVerticalPosition은 이번 단계에서 건드리지 않음(표지색만).
   · 팝오버 = 두 번째 사본 → 클릭 후 self-refresh + renderEditPanel(우측 패널 동기화).
   · 🔗 choice 팝오버와 상호배타(열 때 상대 팝오버 닫음). 우측 표지 패널은 3A에서 유지.
   ================================================================ */
function _coverPopoverEl() { return document.getElementById('edit-cover-popover'); }

function _isCoverEditScene(scene) {
  return !!(scene && (scene.type === 'cover' || scene.isCover));
}

function _renderCoverPopoverBody(scene) {
  return `
    <div class="edit-cover-popover__head">
      <span class="edit-cover-popover__title">🎨 표지</span>
      <button type="button" class="edit-cover-popover__close js-cover-popover-close"
        title="닫기" aria-label="닫기">✕</button>
    </div>
    <div class="edit-cover-popover__body">
      <!-- CONTEST-FIX-1: '표지 색' row 제거 — COVER-THEME(811e59a)/TEXT-COVER-THEME(81a5833)으로
           표지가 스킨/텍스트 테마를 따라가면서 coverTheme 색 버튼이 화면 무효(테마 CSS가 항상 덮음).
           저장된 coverTheme 값·핸들러는 보존(무해). -->
      ${_coverTitleYRowHtml(scene)}
    </div>`;
}

function _refreshCoverPopover() {
  const pop = _coverPopoverEl();
  if (!pop || pop.hidden) return;
  const scene = ViewerState.scenes[ViewerState.currentSceneId];
  if (!scene || !_isCoverEditScene(scene)) { _closeCoverPopover(); return; }
  pop.innerHTML = _renderCoverPopoverBody(scene);
  _bindCoverPopover(pop);
}

function _bindCoverPopover(pop) {
  pop.querySelector('.js-cover-popover-close')
    ?.addEventListener('click', _closeCoverPopover);

  /* 매 클릭마다 현재 장면을 새로 읽음(트리거 시점 캡처 X) — 정합 보호. */
  const _curScene = () => ViewerState.scenes[ViewerState.currentSceneId];

  /* 표지 색 pill — 우측 표지 분기 핸들러와 동일 저장 경로. 클릭 후 우측 패널 사본도
     renderEditPanel로 동기화하고, 팝오버 자신은 self-refresh로 active pill 갱신. */
  pop.querySelectorAll('.js-cover-theme').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_editText.editable) return;
      const s = _curScene();
      if (!s || !_isCoverEditScene(s)) return;
      const val = btn.dataset.val || 'default';
      s.coverTheme = val;
      if (typeof _queueSave === 'function') {
        _queueSave(s.num || s.id, { coverTheme: val });
        if (typeof _flushPendingSave === 'function') _flushPendingSave();
      }
      if (typeof renderEditPanel === 'function') renderEditPanel();
      if (typeof _scheduleViewerFrameReRender === 'function') _scheduleViewerFrameReRender();
      _refreshCoverPopover();
    });
  });

  /* TOP-TOOLBAR-4A: 제목 높낮이 슬라이더 — 우측 표지 패널 js-cover-title-y 핸들러와 동일 저장 경로.
     ★ 슬라이더는 드래그(연속 input)라 표지색 pill과 달리 self-refresh 금지 — input 중
        _refreshCoverPopover를 부르면 슬라이더 DOM이 재생성돼 드래그가 끊긴다.
        대신 팝오버 내부 라벨만 직접 갱신하고, change(드래그 끝)에서만 _flush. */
  const yRange = pop.querySelector('.js-cover-title-y');
  if (yRange) {
    yRange.addEventListener('input', () => {
      if (!_editText.editable) return;
      const s = _curScene();
      if (!s || !_isCoverEditScene(s)) return;
      const val = parseInt(yRange.value, 10) || 50;
      s.titleVerticalPosition = val;
      /* 팝오버 라벨만 직접 갱신(우측 패널 사본은 팝오버 닫힘/재렌더 시 일치) */
      const labelNote = yRange.closest('.edit-row')?.querySelector('.edit-label-note');
      if (labelNote) labelNote.textContent = `(${val}%)`;
      if (typeof _queueSave === 'function') {
        _queueSave(s.num || s.id, { titleVerticalPosition: val });
      }
      if (typeof _scheduleViewerFrameReRender === 'function') _scheduleViewerFrameReRender();
    });
    yRange.addEventListener('change', () => {
      if (!_editText.editable) return;
      if (typeof _flushPendingSave === 'function') _flushPendingSave();
    });
  }
}

function _positionCoverPopover(pop) {
  const trigger = document.querySelector('.js-edit-cover-popover');
  if (!trigger) return;
  const r = trigger.getBoundingClientRect();
  pop.style.top = (r.bottom + 8) + 'px';
  const popW = pop.offsetWidth || 320;
  let left = r.left;
  const maxLeft = window.innerWidth - popW - 12;
  if (left > maxLeft) left = Math.max(12, maxLeft);
  pop.style.left = left + 'px';
}

function _openCoverPopover() {
  const pop = _coverPopoverEl();
  if (!pop) return;
  const scene = ViewerState.scenes[ViewerState.currentSceneId];
  if (!scene || !_isCoverEditScene(scene)) return;
  /* 상호배타: 🔗 choice 팝오버가 열려 있으면 닫음(동시 노출 방지). */
  if (typeof _closeChoicePopover === 'function') _closeChoicePopover();
  pop.innerHTML = _renderCoverPopoverBody(scene);
  pop.hidden = false;
  _bindCoverPopover(pop);
  _positionCoverPopover(pop);
  document.querySelector('.js-edit-cover-popover')?.classList.add('is-active');
  /* 바깥 클릭 / ESC 닫기 — setTimeout(0)로 현재 트리거 클릭이 즉시 닫지 않게 함. */
  setTimeout(() => {
    document.addEventListener('click', _coverPopoverOutside, true);
    document.addEventListener('keydown', _coverPopoverEsc, true);
  }, 0);
}

function _closeCoverPopover() {
  const pop = _coverPopoverEl();
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  pop.innerHTML = '';
  pop.style.left = '';
  pop.style.top  = '';
  document.querySelector('.js-edit-cover-popover')?.classList.remove('is-active');
  document.removeEventListener('click', _coverPopoverOutside, true);
  document.removeEventListener('keydown', _coverPopoverEsc, true);
}

function _toggleCoverPopover() {
  const pop = _coverPopoverEl();
  if (!pop) return;
  if (pop.hidden) _openCoverPopover();
  else _closeCoverPopover();
}

function _coverPopoverOutside(e) {
  const pop = _coverPopoverEl();
  if (!pop || pop.hidden) return;
  if (pop.contains(e.target)) return;
  /* 트리거 클릭은 토글 핸들러가 처리 — 여기서 닫지 않음(이중 토글 방지). */
  if (e.target.closest && e.target.closest('.js-edit-cover-popover')) return;
  _closeCoverPopover();
}

function _coverPopoverEsc(e) {
  if (e.key === 'Escape') _closeCoverPopover();
}

/* ================================================================
   PROJECT-SETTINGS-1A: "⚙️ 작품 설정" 상단 팝오버 (빈 셸)
   ─────────────────────────────────────────────────────────────
   · 작품 전체 설정(양옆 마감 테마·작품 전환효과 등)이 향후 들어갈 자리.
   · 1A는 빈 셸 — 안내 문구만. 실제 기능 복제는 PROJECT-SETTINGS-1B.
   · 장면 도구(🔗/🎨)와 달리 "작품 전체"라 모든 장면 타입에서 노출(조건부 아님).
   · 상호배타: 열 때 🔗/🎨 팝오버를 닫음. 반대(🔗/🎨를 열면 ⚙️ 닫힘)는 ⚙️ 팝오버의
     바깥클릭 핸들러가 트리거 클릭을 잡아 자동 처리(기존 팝오버 로직 무수정).
   · edit-choice/cover-popover 패턴 그대로 재사용(열기/닫기/바깥클릭/ESC/HUD재렌더 close).
   ================================================================ */
function _projectPopoverEl() { return document.getElementById('edit-project-popover'); }

/* PROJECT-SETTINGS-2C: ⚙️ 작품 설정 팝오버용 본문 카드 스타일/색계열 섹션(작품단위).
   우측 _pbToneSectionHtml의 card-style/card-color row를 같은 순수 helper(_pbToneRowHtml)+
   같은 const(_PB_TONE_CARD_STYLES/COLORS)로 재구성. axis(card-style/card-color)·class
   (js-pb-tone-btn)·저장 경로(proj.textCardStyle/Color + saveViewerMeta)는 우측과 동일.
   ★ 장면단위 pbCardTone/pbEndingTone은 포함하지 않음(우측 유지).
   ★ 본문 카드는 picturebook 전용 → 그림책 작품에서만 노출(text/movie엔 '' 반환). */
function _pbProjectCardStyleSectionHtml() {
  /* D8-CLEAN-1: 신규 5스킨에서 스킨이 카드 표현을 담당(imageCenter pb-tone 무력화) →
     본문 카드 스타일/색계열 UI 숨김. textCardStyle/textCardColor 필드·pb-tone 무변경. */
  return '';
  const ptype = (typeof _resolveViewerProjectType === 'function') ? _resolveViewerProjectType() : null;
  if (ptype !== 'picturebook') return '';
  const proj = (ViewerState && ViewerState.project) || {};
  const styleRow = _pbToneRowHtml('card-style', '본문 카드 스타일',
    '질감·테두리 형태·둥글기. 색은 별도예요.',
    _PB_TONE_CARD_STYLES, proj.textCardStyle || '');
  const colorRow = _pbToneRowHtml('card-color', '색계열',
    '본문 카드의 기본 색 방향.',
    _PB_TONE_CARD_COLORS, proj.textCardColor || '');
  return `
    <div class="edit-row edit-row--compact">
      <label class="edit-label">🎨 본문 카드 <span class="edit-label-note">(작품 전체)</span></label>
      ${styleRow}
      ${colorRow}
    </div>
    <div class="edit-divider"></div>`;
}

/* PROJECT-SETTINGS-2A: ⚙️ 작품 설정 팝오버용 페이지 방향 row. 작품 전체 viewer-meta.
   pageOrientation을 가로/세로로 조절. class(js-pb-orientation)·data-val·저장 경로는
   우측 패널과 동일. 팝오버는 "작품 전체"라 항상 편집 가능(우측의 첫장면 잠금 없음). */
function _pageOrientationSectionHtml() {
  /* D8-CLEAN-1: 그림책=가로 확정 → 페이지 방향 UI 숨김.
     REFINE-IA-1: 텍스트도 세로 페이지 고정(.text-page aspect 210/297)이라 방향 UI 실효 없음 → 숨김.
     pageOrientation 필드/저장값/렌더/기존 portrait 작품 표시 무변경(UI만 미생성). movie 등은 유지. */
  const _ptypeOri = (typeof _resolveViewerProjectType === 'function') ? _resolveViewerProjectType() : null;
  if (_ptypeOri === 'picturebook' || _ptypeOri === 'text') return '';
  const isPortrait = !!(ViewerState.project && ViewerState.project.pageOrientation === 'portrait');
  return `
    <div class="edit-row edit-row--compact">
      <label class="edit-label">📐 페이지 방향 <span class="edit-label-note">(작품 전체)</span></label>
      <div class="edit-toggle-group">
        <button type="button" class="edit-toggle js-pb-orientation ${isPortrait ? '' : 'active'}" data-val="landscape">가로</button>
        <button type="button" class="edit-toggle js-pb-orientation ${isPortrait ? 'active' : ''}" data-val="portrait">세로</button>
      </div>
      <div class="edit-section-hint">작품 전체 화면 방향을 정해요.</div>
    </div>`;
}

/* MOVIE-SETTINGS-1: ⚙️ 작품 설정 팝오버용 무비 선택지 표시방식(작품단위 viewer-meta.movieDecisionStyle).
   우측 js-movie-deco와 동일 class/data-val/저장 경로. movie 작품에서만 노출(text/pb/cover '').
   팝오버는 작품 전체라 첫장면 잠금 없이 항상 편집 가능. */
function _movieDecisionSectionHtml() {
  const ptype = (typeof _resolveViewerProjectType === 'function') ? _resolveViewerProjectType() : null;
  if (ptype !== 'movie') return '';
  const isCard = !!(ViewerState.project && ViewerState.project.movieDecisionStyle === 'card');
  return `
    <div class="edit-row edit-row--compact">
      <label class="edit-label">💬 무비 선택지 표시 <span class="edit-label-note">(작품 전체)</span></label>
      <div class="edit-toggle-group">
        <button type="button" class="edit-toggle js-movie-deco ${isCard ? '' : 'active'}" data-val="panel">하단 패널</button>
        <button type="button" class="edit-toggle js-movie-deco ${isCard ? 'active' : ''}" data-val="card">중앙 카드</button>
      </div>
      <div class="edit-section-hint">영상 종료 후 선택지가 나타나는 위치예요.</div>
    </div>
    <div class="edit-divider"></div>`;
}

/* PUBLISH-VERSION(2026-07-24): ⚙️ 작품 설정 — '친구들에게 보일 것'(감상 표시 버전 잠금).
   글/그림 각각 원본 | AI | 둘 다. '둘 다'=감상 토글 유지, 하나만=그 버전 고정+감상 토글 숨김.
   원본·AI 데이터는 불변(무엇을 보여줄지만 정함). movie/experience는 미노출.
   PUBLISH-LV3-ONLY(2026-07-25 사용자 판단): 그림책 1·2단계는 이 설정 자체가 필요 없다 —
   · 1단계 = 글도 그림도 AI가 만들어 주고, 글 수정도 그 초안 위에서 한다(원본/AI 구분 없음).
   · 2단계 = 글은 아이가 직접 쓰므로 'AI 글' 개념이 없고, 그림 원본은 의도적으로 간단히 그린
     졸라맨이라 친구에게 보여줄 대상이 아니다(AI 마감본이 곧 완성본).
   → 선택지가 의미를 갖는 건 3단계(+텍스트형)뿐이므로 1·2단계는 섹션 전체 미노출. */
function _publishVersionSectionHtml() {
  const ptype = (typeof _resolveViewerProjectType === 'function') ? _resolveViewerProjectType() : null;
  if (ptype !== 'text' && ptype !== 'picturebook') return '';
  const lv = ViewerState.project && ViewerState.project.picturebookLevel;
  if (ptype === 'picturebook' && (lv === 1 || lv === 2)) return '';
  const t  = (ViewerState.project && ViewerState.project.viewerShowText)  || 'both';
  const im = (ViewerState.project && ViewerState.project.viewerShowImage) || 'both';
  const seg = (cls, cur, val, label) =>
    `<button type="button" class="edit-toggle ${cls} ${cur === val ? 'active' : ''}" data-val="${val}">${label}</button>`;
  const textRow = `
    <div class="edit-row edit-row--compact">
      <label class="edit-label">📝 글 보기</label>
      <div class="edit-toggle-group">
        ${seg('js-publish-text', t, 'original', '원본')}
        ${seg('js-publish-text', t, 'aiS2', 'AI 장면발전')}
        ${seg('js-publish-text', t, 'both', '둘 다')}
      </div>
    </div>`;
  const imageRow = (ptype === 'picturebook') ? `
    <div class="edit-row edit-row--compact">
      <label class="edit-label">🖼️ 그림 보기</label>
      <div class="edit-toggle-group">
        ${seg('js-publish-image', im, 'original', '원본')}
        ${seg('js-publish-image', im, 'aiS2', 'AI 그림책 마감')}
        ${seg('js-publish-image', im, 'both', '둘 다')}
      </div>
    </div>` : '';
  return `
    <div class="edit-row edit-row--compact">
      <label class="edit-label">👀 친구들에게 보일 것 <span class="edit-label-note">(감상 화면)</span></label>
    </div>
    ${textRow}${imageRow}
    <div class="edit-section-hint">‘둘 다’면 친구가 감상에서 토글로 바꿔 볼 수 있어요. 하나만 고르면 그 버전으로 고정돼요. (원본·AI는 그대로 저장돼요.)</div>`;
}

function _renderProjectPopoverBody() {
  /* REFINE-IA-1: 텍스트는 "감상 설정"(재생 방식만), 그림책은 시각 테마/레이아웃도 포함이라 "작품 설정" 유지. */
  const _pp_isText = (typeof _resolveViewerProjectType === 'function') && _resolveViewerProjectType() === 'text';
  /* PROJECT-SETTINGS-1B: 작품 전체 설정 복제 — 양옆 마감 테마 + 작품 전환효과.
     기존 helper(_pbThemeSectionHtml / _workSettingsSectionHtml)를 그대로 재사용
     (둘 다 인자 없이 ViewerState.project를 읽음 → 장면 무관, 모든 장면 타입에서 동일). */
  /* PB-LAYOUT-1B: picturebook일 때만 하위 모드(분할형/그림 중심형)를 페이지 방향 아래 복제.
     _pbSubmodeSectionHtml(scene)는 우측과 동일 helper(first-scene gating·lockHint 포함) → 현재 장면
     (ViewerState.currentSceneId) 기준. 게이팅은 _pbProjectCardStyleSectionHtml과 동일 패턴
     (_resolveViewerProjectType). 저장은 _bindProjectPopover의 팝오버 전용 핸들러가 처리. */
  const _pbSubmodeBlock = (function () {
    const _ptype = (typeof _resolveViewerProjectType === 'function') ? _resolveViewerProjectType() : null;
    if (_ptype !== 'picturebook') return '';
    const _scene = ViewerState.scenes[ViewerState.currentSceneId];
    return _scene ? `<div class="edit-divider"></div>${_pbSubmodeSectionHtml(_scene)}` : '';
  })();
  /* T-THEME-1: 그림책 전용 작품 설정(양옆 마감 테마 + 그림책 카드 스타일)은 picturebook에서만 노출.
     텍스트 등 비-그림책 작품에는 pbTheme 메뉴를 렌더하지 않음(침범 차단). */
  const _pbSettingsBlock = (function () {
    const _pt = (typeof _resolveViewerProjectType === 'function') ? _resolveViewerProjectType() : null;
    if (_pt !== 'picturebook') return '';
    return `${_pbProjectCardStyleSectionHtml()}${_pbThemeSectionHtml()}`;
  })();
  return `
    <div class="edit-project-popover__head">
      <span class="edit-project-popover__title">${_pp_isText ? '⚙️ 감상 설정' : '⚙️ 작품 설정'}</span>
      <button type="button" class="edit-project-popover__close js-project-popover-close"
        title="닫기" aria-label="닫기">✕</button>
    </div>
    <div class="edit-project-popover__body">
      <p class="edit-project-popover__note">${_pp_isText ? '<b>작품 전체</b>에 적용돼요. 장면이 바뀌고 글이 나타나는 방식을 정해요.' : '현재 장면 하나가 아니라 <b>작품 전체</b>에 적용돼요.'}</p>
      ${_pageOrientationSectionHtml()}
      ${_pbSubmodeBlock}
      ${(() => { /* LOW-15(2026-07-11): 빈 섹션이면 divider도 생략 — 구분선 2연속 방지 */
        const _mv = _movieDecisionSectionHtml();
        return _mv ? `<div class="edit-divider"></div>${_mv}` : '';
      })()}
      ${_pbSettingsBlock ? `<div class="edit-divider"></div>${_pbSettingsBlock}` : ''}
      ${(() => { const _pv = _publishVersionSectionHtml(); return _pv ? `<div class="edit-divider"></div>${_pv}` : ''; })()}
      <div class="edit-divider"></div>
      ${_workSettingsSectionHtml()}
    </div>`;
}

/* PUBLISH-VERSION: '친구들에게 보일 것' 토글 → viewer-meta 저장 + 감상 토글바 재평가 + 프레임 재렌더.
   pageOrientation 핸들러와 동일 저장 경로. 우측 패널·발행 로직 무수정. */
async function _onPublishVersionChange(kind, rawVal, pop) {
  if (!_editText.editable) return;
  const val = (rawVal === 'original' || rawVal === 'aiS2') ? rawVal : 'both';
  const field = (kind === 'image') ? 'viewerShowImage' : 'viewerShowText';
  if ((ViewerState.project[field] || 'both') === val) return;   /* no-op */
  ViewerState.project[field] = val;
  _refreshProjectPopover();
  /* 감상 토글바 재평가(잠금이면 숨김·해제면 재노출) + 표시 버전 반영 */
  try {
    if (window.viewerAi && typeof window.viewerAi._showAiToggleBar === 'function') window.viewerAi._showAiToggleBar();
    if (window.viewerAi && typeof window.viewerAi._showAiImageToggleBar === 'function') window.viewerAi._showAiImageToggleBar();
  } catch (e) { /* noop */ }
  if (typeof _scheduleViewerFrameReRender === 'function') _scheduleViewerFrameReRender();
  try {
    const teamName = ViewerState.project.teamName;
    const classId  = ViewerState.project.classId;
    if (teamName && typeof getViewerDb === 'function') {
      const encodedName = encodeURIComponent(teamName);
      const basePath = classId ? `classes/${classId}/teams/${encodedName}` : `teams/${encodedName}`;
      await getViewerDb().ref(`${basePath}/viewer-meta`).update({ [field]: val });
    }
  } catch (e) { console.error('[publishVersion] 저장 실패:', e); }
}

function _refreshProjectPopover() {
  const pop = _projectPopoverEl();
  if (!pop || pop.hidden) return;
  pop.innerHTML = _renderProjectPopoverBody();
  _bindProjectPopover(pop);
}

function _bindProjectPopover(pop) {
  pop.querySelector('.js-project-popover-close')
    ?.addEventListener('click', _closeProjectPopover);

  /* PROJECT-SETTINGS-2C: 본문 카드 스타일/색계열(작품단위) — 우측 _bindPbToneEvents 그대로 재사용.
     이 핸들러는 renderEditPanel 부작용이 없고 active 토글이 grid-scope, 저장은 axis별
     (card-style/card-color → proj + saveViewerMeta). 팝오버엔 card-style/color row만 있어
     card-tone/card-end-tone 분기는 미발동(버튼 없음). 우측 패널 바인딩은 무수정. 새 저장 함수 X. */
  if (typeof _bindPbToneEvents === 'function') {
    _bindPbToneEvents(pop, ViewerState.scenes[ViewerState.currentSceneId]);
  }

  /* PROJECT-SETTINGS-2A: 페이지 방향 — 우측 _bindPageOrientationToggle과 동일 저장 경로
     (viewer-meta.pageOrientation). 단 우측 핸들러는 renderEditPanel을 부르므로 팝오버엔
     부적합 → 팝오버 전용으로 저장+letterbox+프레임 재렌더 후 _refreshProjectPopover로 active 갱신.
     우측 패널 바인딩(_bindPageOrientationToggle)은 무수정. */
  pop.querySelectorAll('.js-pb-orientation').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!_editText.editable) return;
      const val = btn.dataset.val === 'portrait' ? 'portrait' : 'landscape';
      if (ViewerState.project.pageOrientation === val) return;   // no-op
      ViewerState.project.pageOrientation = val;
      if (document.body) document.body.dataset.pageOrientation = val;
      if (typeof window._applyLetterbox === 'function') window._applyLetterbox();
      if (typeof _scheduleViewerFrameReRender === 'function') _scheduleViewerFrameReRender();
      _refreshProjectPopover();
      try {
        const teamName = ViewerState.project.teamName;
        const classId  = ViewerState.project.classId;
        if (teamName && typeof getViewerDb === 'function') {
          const encodedName = encodeURIComponent(teamName);
          const basePath = classId
            ? `classes/${classId}/teams/${encodedName}`
            : `teams/${encodedName}`;
          await getViewerDb().ref(`${basePath}/viewer-meta`).update({ pageOrientation: val });
        }
      } catch (e) {
        console.error('[pageOrientation] 저장 실패:', e);
      }
    });
  });

  /* PUBLISH-VERSION: '친구들에게 보일 것'(글/그림 감상 표시 버전 잠금) 토글 바인딩. */
  pop.querySelectorAll('.js-publish-text').forEach(btn => {
    btn.addEventListener('click', () => _onPublishVersionChange('text', btn.dataset.val, pop));
  });
  pop.querySelectorAll('.js-publish-image').forEach(btn => {
    btn.addEventListener('click', () => _onPublishVersionChange('image', btn.dataset.val, pop));
  });

  /* PB-LAYOUT-1B: picturebook 하위 모드 — 우측 .js-pb-submode 핸들러(전 장면 picturebookSubmode
     일괄 저장)와 동일 저장 경로/모델. 우측은 renderEditPanel을 부르므로 팝오버엔 부적합 → flush +
     프레임 재렌더 후 _refreshProjectPopover로 active 갱신. 우측 바인딩·저장 모델은 무수정.
     first-scene gating은 _pbSubmodeSectionHtml의 disabled로 그대로 적용(비첫장면은 클릭 불가). */
  pop.querySelectorAll('.js-pb-submode').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_editText.editable) return;
      /* Phase 4-A: s1/s2 보기 중엔 원본 scenes 일괄 저장 금지(우측과 동일). */
      if (_isVariantViewLocked()) { _showSaveStatus('AI 버전은 보기 전용입니다. 편집은 원본에서 해 주세요.', 2500); return; }
      const val = btn.dataset.val === 'imageCenter' ? 'imageCenter' : 'split';
      const _scene = ViewerState.scenes[ViewerState.currentSceneId];
      const curId = _scene ? (_scene.num || _scene.id) : null;
      let failCount = 0;
      Object.values(ViewerState.scenes).forEach(s => {
        if (!s) return;
        const id = s.num || s.id;
        if (id == null) return;
        s.picturebookSubmode = val; /* 메모리 즉시 반영 */
        if (curId != null && String(id) === String(curId)) {
          /* 현재 장면 = 옛 흐름 (debounce → flush) */
          _queueSave(id, { picturebookSubmode: val });
        } else {
          /* 다른 장면 = saveSceneText 직접 호출 (편집 잠금 없이 patch). 작품 단위라 충돌 거의 없음. */
          if (typeof saveSceneText === 'function') {
            saveSceneText(id, { picturebookSubmode: val }).catch(e => {
              failCount++;
              console.warn('[pb-submode 일괄·팝오버] 장면', id, '저장 실패:', e);
            });
          }
        }
      });
      _flushPendingSave();
      if (typeof _scheduleViewerFrameReRender === 'function') _scheduleViewerFrameReRender();
      _refreshProjectPopover();
    });
  });

  /* MOVIE-SETTINGS-1: 무비 선택지 표시방식 — 우측 _bindMovieDecoToggle과 동일 저장 경로
     (viewer-meta.movieDecisionStyle). 우측 핸들러는 renderEditPanel을 부르므로 팝오버엔 부적합 →
     팝오버 전용으로 저장+프레임 재렌더 후 _refreshProjectPopover로 active 갱신. 우측 바인딩 무수정. */
  pop.querySelectorAll('.js-movie-deco').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!_editText.editable) return;
      const val = btn.dataset.val === 'card' ? 'card' : 'panel';
      if ((ViewerState.project.movieDecisionStyle || 'panel') === val) return;   // no-op
      ViewerState.project.movieDecisionStyle = val;
      if (typeof _scheduleViewerFrameReRender === 'function') _scheduleViewerFrameReRender();
      _refreshProjectPopover();
      try {
        const teamName = ViewerState.project.teamName;
        const classId  = ViewerState.project.classId;
        if (teamName && typeof getViewerDb === 'function') {
          const encodedName = encodeURIComponent(teamName);
          const basePath = classId
            ? `classes/${classId}/teams/${encodedName}`
            : `teams/${encodedName}`;
          await getViewerDb().ref(`${basePath}/viewer-meta`).update({ movieDecisionStyle: val });
        }
      } catch (e) {
        console.error('[movieDecisionStyle] 저장 실패:', e);
      }
    });
  });

  /* 양옆 마감 테마 collapsible 토글 — 우측 패널은 renderEditPanel로 갱신하지만, 팝오버는
     #edit-panel 밖이라 팝오버 self-refresh로 처리(기존 _bindPbThemeHandlers의 toggle은
     renderEditPanel을 부르므로 팝오버엔 부적합 → 토글만 팝오버 전용으로 분리). */
  pop.querySelectorAll('.js-pb-theme-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      _pbThemeCollapsed = !_getPbThemeCollapsed();
      _refreshProjectPopover();
    });
  });

  /* 양옆 마감 테마 카드 — 우측 패널 _bindPbThemeHandlers 카드와 동일 저장 경로
     (viewer-meta.pbTheme update). 클릭 후 active만 팝오버 내부에서 갱신(재렌더 X). */
  pop.querySelectorAll('.js-pb-theme').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!_editText.editable) return;
      const PB_THEMES = ['cozy-storybook', 'paper-storybook', 'gallery-picturebook', 'forest-storybook', 'night-story'];
      const val = PB_THEMES.includes(btn.dataset.val) ? btn.dataset.val : 'cozy-storybook';
      if (ViewerState.project.pbTheme === val) return;   // no-op
      ViewerState.project.pbTheme = val;
      if (document.body) document.body.dataset.pbTheme = val;
      pop.querySelectorAll('.js-pb-theme').forEach(b => b.classList.toggle('active', b === btn));
      try {
        const teamName = ViewerState.project.teamName;
        const classId  = ViewerState.project.classId;
        if (teamName && typeof getViewerDb === 'function') {
          const encodedName = encodeURIComponent(teamName);
          const basePath = classId
            ? `classes/${classId}/teams/${encodedName}`
            : `teams/${encodedName}`;
          await getViewerDb().ref(`${basePath}/viewer-meta`).update({ pbTheme: val });
        }
      } catch (e) {
        console.error('[pbTheme] 저장 실패:', e);
      }
    });
  });

  /* 작품 전환효과/속도/텍스트등장/속도 — 기존 panel-scoped 핸들러를 팝오버에 그대로 적용.
     _bindWorkSettingsHandlers는 panel 인자를 받아 panel.querySelector로 동작하고
     renderEditPanel을 호출하지 않으며, 슬라이더(_bindSpeedSlider)는 이미 4A 패턴
     (input=라벨만·미리보기 throttle / change=저장)이라 드래그가 끊기지 않음. 완전 재사용. */
  if (typeof _bindWorkSettingsHandlers === 'function') _bindWorkSettingsHandlers(pop);
}

function _positionProjectPopover(pop) {
  /* REFINE-IA-3: ⚙️ 설정이 ⋯ 더보기 메뉴 안으로 이동 → 트리거가 닫힌 메뉴 안이면 rect=0.
     이 경우 ⋯ 더보기 버튼을 앵커로 사용(위치 어긋남 방지). */
  let trigger = document.querySelector('.js-edit-project-popover');
  if (!trigger || trigger.getBoundingClientRect().width === 0) {
    trigger = document.querySelector('.js-hud-more') || trigger;
  }
  if (!trigger) return;
  const r = trigger.getBoundingClientRect();
  pop.style.top = (r.bottom + 8) + 'px';
  /* POPOVER-NOSCROLL(2026-07-11): 트리거 아래 남은 화면 높이 전부 허용(장면꾸미기와 동일) */
  pop.style.maxHeight = Math.max(240, window.innerHeight - r.bottom - 20) + 'px';
  const popW = pop.offsetWidth || 320;
  let left = r.left;
  const maxLeft = window.innerWidth - popW - 12;
  if (left > maxLeft) left = Math.max(12, maxLeft);
  pop.style.left = left + 'px';
}

function _openProjectPopover() {
  const pop = _projectPopoverEl();
  if (!pop) return;
  /* 상호배타: 장면 도구 팝오버(🔗/🎨)가 열려 있으면 닫음(동시 노출 방지). */
  if (typeof _closeChoicePopover === 'function') _closeChoicePopover();
  if (typeof _closeCoverPopover === 'function') _closeCoverPopover();
  pop.innerHTML = _renderProjectPopoverBody();
  pop.hidden = false;
  _bindProjectPopover(pop);
  _positionProjectPopover(pop);
  document.querySelector('.js-edit-project-popover')?.classList.add('is-active');
  /* 바깥 클릭 / ESC 닫기 — setTimeout(0)로 현재 트리거 클릭이 즉시 닫지 않게 함. */
  setTimeout(() => {
    document.addEventListener('click', _projectPopoverOutside, true);
    document.addEventListener('keydown', _projectPopoverEsc, true);
  }, 0);
}

function _closeProjectPopover() {
  const pop = _projectPopoverEl();
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  pop.innerHTML = '';
  pop.style.left = '';
  pop.style.top  = '';
  pop.style.maxHeight = '';   /* POPOVER-NOSCROLL: 인라인 높이 초기화 */
  document.querySelector('.js-edit-project-popover')?.classList.remove('is-active');
  document.removeEventListener('click', _projectPopoverOutside, true);
  document.removeEventListener('keydown', _projectPopoverEsc, true);
}

function _toggleProjectPopover() {
  const pop = _projectPopoverEl();
  if (!pop) return;
  if (pop.hidden) _openProjectPopover();
  else _closeProjectPopover();
}

function _projectPopoverOutside(e) {
  const pop = _projectPopoverEl();
  if (!pop || pop.hidden) return;
  if (pop.contains(e.target)) return;
  /* 트리거 클릭은 토글 핸들러가 처리 — 여기서 닫지 않음(이중 토글 방지). */
  if (e.target.closest && e.target.closest('.js-edit-project-popover')) return;
  _closeProjectPopover();
}

function _projectPopoverEsc(e) {
  if (e.key === 'Escape') _closeProjectPopover();
}

/* ================================================================
   PB-IMAGE-1B: picturebook "🖼️ 그림" 상단 팝오버 (빈 셸)
   ─────────────────────────────────────────────────────────────
   · 장면 그림 도구(업로드·삭제·그리기·크기이동·자르기)가 향후 들어갈 자리.
   · 1B는 빈 셸 — 안내 문구만. 실제 진입 버튼 복제는 PB-IMAGE-1C.
   · picturebook 비표지 장면에서만 트리거 노출(renderHUD의 _isPbImageHudScene).
   · 상호배타: 열 때 🔗/🎨/⚙️ 팝오버를 닫음. 반대는 🖼️ 팝오버 바깥클릭 핸들러가 자동 처리.
   · edit-choice/cover/project-popover 패턴 그대로 재사용(열기/닫기/바깥클릭/ESC/HUD재렌더 close).
   ================================================================ */
function _imagePopoverEl() { return document.getElementById('edit-image-popover'); }

function _renderImagePopoverBody() {
  /* PB-IMAGE-1C: 우측 인스펙터와 동일한 _pbImageActionsHtml 재사용(같은 class/구조).
     현재 장면 기준으로 imageData 유무에 따라 버튼 구성. 실제 동작은 기존 함수만 호출(1C). */
  const scene = ViewerState.scenes[ViewerState.currentSceneId];
  return `
    <div class="edit-image-popover__head">
      <span class="edit-image-popover__title">🖼️ 그림</span>
      <button type="button" class="edit-image-popover__close js-image-popover-close"
        title="닫기" aria-label="닫기">✕</button>
    </div>
    <div class="edit-image-popover__body">
      <p class="edit-image-popover__note">${(ViewerState.project && ViewerState.project.picturebookLevel === 1)
        ? 'AI가 만든 그림이 마음에 안 들면 다시 만들 수 있어요.'
        : '장면 그림을 올리거나 직접 그릴 수 있어요.'}</p>
      ${scene ? _pbImageActionsHtml(scene) : ''}
    </div>`;
}

function _bindImagePopover(pop) {
  pop.querySelector('.js-image-popover-close')
    ?.addEventListener('click', _closeImagePopover);
  /* PB-IMAGE-1C: 이미지 진입 버튼 바인딩 — 우측과 동일 함수/흐름 호출(새 저장 로직 X). */
  const scene = ViewerState.scenes[ViewerState.currentSceneId];
  if (scene) _bindPbImageActions(pop, scene);
  /* PB-IMAGE-1A 시각 잠금을 새로 렌더된 팝오버 그룹에도 즉시 반영(AI variant 보기 중이면 grey-out). */
  if (typeof _applyAiImageVariantEditLock === 'function') _applyAiImageVariantEditLock();
}

/* PB-IMAGE-1C: 🖼️ 팝오버 전용 이미지 진입 버튼 바인딩.
   우측 인스펙터 핸들러(viewer-edit.js _bindEditPanelEvents picturebook 분기)와 동일한
   기존 함수/흐름을 그대로 호출 — viewerUploadImageToStorage / _openPbDrawModal /
   enterImageTransformEdit / enterImageCropEdit / _queueSave. 새 저장 로직 없음.
   우측 핸들러는 무수정(별도 panel-scoped 바인딩 유지). 가드(_editText.editable +
   _aiImageVariantBlocksOriginalEdit)도 동일. 액션 후에는 팝오버를 닫아 stale 상태 방지. */
function _bindPbImageActions(root, scene) {
  if (!root || !scene) return;
  const _closeIfPopover = () => {
    if (root.id === 'edit-image-popover' && typeof _closeImagePopover === 'function') _closeImagePopover();
  };

  root.querySelectorAll('.js-pb-image-upload-input').forEach(input => {
    input.addEventListener('change', async e => {
      if (!_editText.editable) return;
      if (_aiImageVariantBlocksOriginalEdit()) { e.target.value = ''; return; }
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        alert('이미지 파일만 업로드할 수 있어요.');
        e.target.value = '';
        return;
      }
      const lbl = e.target.closest('.js-pb-image-upload-label');
      const prevText = lbl ? lbl.firstChild.nodeValue : '';
      if (lbl && lbl.firstChild) lbl.firstChild.nodeValue = '⏳ 처리 중… ';
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = () => reject(new Error('파일 읽기 실패'));
          r.readAsDataURL(file);
        });
        const SOFT_LIMIT = 5 * 1024 * 1024;
        let finalUrl = dataUrl;
        if (file.size > SOFT_LIMIT && typeof _compressImageDataURL === 'function') {
          try {
            finalUrl = await _compressImageDataURL(dataUrl, {
              maxDimension: 1600,
              transparent: file.type === 'image/png' || file.type === 'image/webp',
              quality: 0.85,
            });
          } catch (compressErr) {
            finalUrl = dataUrl;
          }
        }
        const _sid = scene.num || scene.id;
        /* S2-2A-FIX1 ① 사전 게이트(업로드 *전*): 반대 모드/corrupt면 Storage 업로드도 scene 변경도 안 함. */
        const _gate = (typeof window !== 'undefined' && window.viewerAi && typeof window.viewerAi._preCheckSourceMode === 'function')
          ? await window.viewerAi._preCheckSourceMode('upload', _sid)
          : { allow: true };
        if (!_gate.allow) {
          if (lbl && lbl.firstChild) lbl.firstChild.nodeValue = prevText;
          e.target.value = '';
          /* SOURCE-MODE-SWITCH: 방식 충돌이면 "그림 다 지우고 바꾸기" 1클릭 제안(학생 자가해결).
             성공 시 다시 올리면 됨. 그 외(정책 읽기 실패 등)는 기존 안내. */
          if (_gate.code === 'SOURCE_MODE_CONFLICT') await _offerSwitchSourceMode(_gate);
          else _notifySourceModeBlock(_gate);
          return;
        }
        /* ② 고유 경로 업로드(기존 객체 overwrite 안 함). scene.imageData는 아직 안 바꿈. */
        let storageUrl, _storagePath;
        try {
          const r = await viewerUploadImageToStorage(finalUrl, _sid);
          storageUrl = r.downloadURL;
          _storagePath = r.storagePath;
        } catch (e) {
          console.error('[viewer-edit] 이미지 업로드 실패:', e);
          if (lbl && lbl.firstChild) lbl.firstChild.nodeValue = prevText;
          alert('❌ 이미지를 올리지 못했어요. 잠시 후 다시 시도해 주세요.');
          e.target.value = '';
          return;
        }
        /* ③ 서버 lock 확정(TOCTOU 최종 결정자). 실패/충돌이면 방금 만든 고유 객체만 삭제, scene 무변경. */
        const _commit = (typeof window !== 'undefined' && window.viewerAi && typeof window.viewerAi._commitImageSourceMode === 'function')
          ? await window.viewerAi._commitImageSourceMode('upload', _sid, _storagePath)
          : { ok: true };
        if (!_commit.ok) {
          if (lbl && lbl.firstChild) lbl.firstChild.nodeValue = prevText;
          _notifySourceModeBlock(_commit);   /* scene.imageData 미변경 → 승자/기존 무손상 */
          e.target.value = '';
          return;
        }
        /* ④ lock 성공일 때만 scene.imageData 기록 + flush await(순서 보장). */
        const _beforeImageData = scene.imageData || null;   /* S2-2A-FIX2: flush 실패 시 로컬 복원 기준 */
        scene.imageData = storageUrl;
        let _flushRes;
        if (typeof _queueSave === 'function') {
          _queueSave(_sid, { imageData: storageUrl });
          if (typeof _flushPendingSave === 'function') _flushRes = await _flushPendingSave();
        }
        /* S2-2A-FIX2: flush 실패면 신규 객체 cleanup + 로컬 복원(성공 표시·팝오버 닫기 금지, lock 유지·재시도 가능). */
        const _flushOk = await _handleImageFlushResult(scene, _beforeImageData, storageUrl, _storagePath, _flushRes);
        if (!_flushOk) {
          if (lbl && lbl.firstChild) lbl.firstChild.nodeValue = prevText;
          e.target.value = '';
          return;   /* 팝오버 유지 — 같은 방식으로 다시 시도 */
        }
        renderEditPanel();
        _scheduleViewerFrameReRender();
        _closeIfPopover();   /* 업로드 완료 → 팝오버 닫아 버튼 상태 stale 방지 */
      } catch (err) {
        console.error('[viewer-edit] 이미지 처리 실패:', err);
        if (lbl && lbl.firstChild) lbl.firstChild.nodeValue = prevText;
        alert('이미지를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
      }
      e.target.value = '';
    });
  });

  root.querySelectorAll('.js-pb-image-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!_editText.editable) return;
      if (_aiImageVariantBlocksOriginalEdit()) return;
      const ok = await showViewerConfirm({
        title: '그림을 삭제할까요?',
        message: '이 장면의 그림을 삭제하면 되돌릴 수 없어요.',
        confirmText: '삭제하기',
        danger: true,
      });
      if (!ok) return;
      /* SOURCE-MODE-RESIDUAL-FIX(2026-07-16): imageData만 지우면 레거시 작품의 imageUrl 잔여가 남아
         "그림 다 지웠는데 방식 못 바꿈"(sourceMode 잠금 잔존)의 원인이 됨 → imageUrl도 함께 정리. */
      scene.imageData = null;
      if (scene.imageUrl) scene.imageUrl = null;
      if (typeof _queueSave === 'function') {
        _queueSave(scene.num || scene.id, { imageData: null, imageUrl: null });
        if (typeof _flushPendingSave === 'function') _flushPendingSave();
      }
      renderEditPanel();
      _scheduleViewerFrameReRender();
      _closeIfPopover();
    });
  });

  /* REGEN-SCENE-1(2026-07-27): 2·3단계 — 이 장면만 다시 만들기.
     종전엔 [AI 그림책 마감]의 '다시 생성'이 전 장면 일괄이라 한 장면만 고칠 수 없었다.
     서버가 이미 sceneIds를 지원하므로 그 장면 하나만 계획에 넣어 호출한다(서버 무배포).
     ⚠️ 누르기 전에 "왜 바꾸고 싶은지"를 먼저 묻는다 — 이 연구의 주제(AI 결과를 그대로
     받지 않고 이유를 들어 판단하기)와 같은 활동이고, 남긴 이유는 아이의 판단 기록으로 쌓인다. */
  root.querySelectorAll('.js-pb-image-regen-scene').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!_editText.editable) return;
      const _cid = (ViewerState.project && ViewerState.project.classId) || ViewerState.classId;
      const _team = (ViewerState.project && ViewerState.project.teamName) || ViewerState.teamName;
      const _sid = String(scene.num || scene.id);
      const reason = await _askRegenReason();
      if (reason == null) return;                    /* 취소 */
      const t0 = btn.textContent;
      btn.disabled = true; btn.textContent = '🎨 만드는 중… (1분쯤 걸려요)';
      try {
        /* 이유 기록 — 실패해도 재생성은 진행(비치명) */
        try {
          await firebase.database()
            .ref(`classes/${_cid}/teams/${encodeURIComponent(_team)}/viewer-meta/regenReasons`)
            .push({ sceneId: _sid, reason: String(reason).slice(0, 200), at: firebase.database.ServerValue.TIMESTAMP });
        } catch (e) { /* noop */ }
        const fns = firebase.app().functions('asia-northeast3');
        const start = await fns.httpsCallable('callStartImageS2Batch', { timeout: 120000 })({
          classId: _cid, teamName: _team, forceRegenerate: true, sceneIds: [_sid],
        });
        const s = start && start.data;
        if (s && s.regenLimitReached) { alert(s.message || '그림 다시 만들기는 작품마다 2번까지 할 수 있어요.'); btn.disabled = false; btn.textContent = t0; return; }
        if (!s || s.ok !== true || !s.jobId) { alert('그림을 다시 만들지 못했어요. 잠시 후 다시 시도해 주세요.'); btn.disabled = false; btn.textContent = t0; return; }
        if (!Array.isArray(s.targets) || s.targets.length === 0) { alert('이 장면은 지금 다시 만들 수 없어요. (그림이 없거나 이미 최신이에요)'); btn.disabled = false; btn.textContent = t0; return; }
        /* REGEN-SCENE-FORCE-1(2026-07-27): callImageAiS2도 forceRegenerate:true를 받아야 서버 dedup을
           건너뛰고 실제로 새 그림을 만든다. 없으면 dedup이 옛 variant를 그대로 reused로 돌려주는데
           batch는 이미 재생성 횟수를 차감해, 성공처럼 보이면서 같은 그림+횟수만 소모됐다(감사 확정). */
        const one = await fns.httpsCallable('callImageAiS2', { timeout: 300000 })({
          classId: _cid, teamName: _team, sceneId: s.targets[0], jobId: s.jobId,
          forceRegenerate: true,
          regenReason: String(reason).slice(0, 60),
        });
        const r = one && one.data;
        /* reused는 성공으로 치지 않는다 — 재생성인데 옛 그림 재사용이면 실패로 보고 환불되게. */
        const okOne = !!(r && (r.ok === true || r.status === 'succeeded'));
        if (okOne) {
          btn.textContent = '✅ 새 그림 완성!';
          try { if (window.viewerAi && typeof window.viewerAi._reinitForCurrentTeam === 'function') window.viewerAi._reinitForCurrentTeam(); } catch (e) { /* noop */ }
          setTimeout(() => {
            try { if (typeof _scheduleViewerFrameReRender === 'function') _scheduleViewerFrameReRender(); } catch (e) { /* noop */ }
            try { if (typeof renderEditPanel === 'function') renderEditPanel(); } catch (e) { /* noop */ }
          }, 600);
          setTimeout(() => { btn.disabled = false; btn.textContent = t0; }, 1800);
        } else {
          alert('그림을 다시 만들지 못했어요. 잠시 후 다시 시도해 주세요.');
          btn.disabled = false; btn.textContent = t0;
        }
      } catch (e) {
        alert('그림을 다시 만들지 못했어요. 잠시 후 다시 시도해 주세요.');
        btn.disabled = false; btn.textContent = t0;
      }
    });
  });

  /* PICTUREBOOK-LEVELS ④: 1단계 장면별 🔁 — 서버(generateStoryImages)가 단계/토글/팀당 총량 재검증.
     성공 시 viewer-ai 재초기화로 새 변형 즉시 반영(AI-DEFAULT가 감상 기본 표시). */
  root.querySelectorAll('.js-pb-image-regen1').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!_editText.editable) return;
      /* REGEN-SCENE-1(2026-07-27): 1단계도 2·3단계와 같은 '왜 바꾸고 싶은지' 창으로 통일. */
      const _cidR = (ViewerState.project && ViewerState.project.classId) || ViewerState.classId;
      const _teamR = (ViewerState.project && ViewerState.project.teamName) || ViewerState.teamName;
      const reason = await _askRegenReason();
      if (reason == null) return;
      try {
        await firebase.database()
          .ref(`classes/${_cidR}/teams/${encodeURIComponent(_teamR)}/viewer-meta/regenReasons`)
          .push({ sceneId: String(scene.num || scene.id), reason: String(reason).slice(0, 200), at: firebase.database.ServerValue.TIMESTAMP });
      } catch (e) { /* 기록 실패는 비치명 */ }
      const t0 = btn.textContent;
      btn.disabled = true; btn.textContent = '🎨 만드는 중… (30초쯤 걸려요)';
      try {
        const _cid = (ViewerState.project && ViewerState.project.classId) || ViewerState.classId;
        const _team = (ViewerState.project && ViewerState.project.teamName) || ViewerState.teamName;
        const res = await firebase.app().functions('asia-northeast3')
          .httpsCallable('generateStoryImages', { timeout: 180000 })({ classId: _cid, teamName: _team, sceneId: String(scene.num || scene.id), force: true, regenReason: String(reason).slice(0, 60) });
        const r = res && res.data;
        if (r && r.ok === true && r.generated > 0) {
          btn.textContent = '✅ 새 그림 완성!';
          /* REGEN-REFRESH-1(2026-07-27): 서버는 새 그림을 만드는데(로그 generated:1) 화면엔 옛 그림이
             그대로 남아 "다시 만들어도 이전 게 나온다"는 신고. _reinitForCurrentTeam만으로는 현재
             프레임/편집 패널이 다시 그려지지 않았다 → 무대 프레임과 패널을 함께 갱신한다. */
          try { if (window.viewerAi && typeof window.viewerAi._reinitForCurrentTeam === 'function') window.viewerAi._reinitForCurrentTeam(); } catch (e) { /* noop */ }
          setTimeout(() => {
            try { if (typeof _scheduleViewerFrameReRender === 'function') _scheduleViewerFrameReRender(); } catch (e) { /* noop */ }
            try { if (typeof renderEditPanel === 'function') renderEditPanel(); } catch (e) { /* noop */ }
          }, 600);
          setTimeout(() => { btn.disabled = false; btn.textContent = t0; }, 1800);
        } else {
          /* REGEN-LIMIT-1(2026-07-27): 작품당 다시 만들기 상한 안내 — 총량 소진과 구분한다. */
          const _msg = (r && r.regenLimitReached)
            ? (r.message || '그림 다시 만들기는 작품마다 2번까지 할 수 있어요.')
            : (r && r.limitReached)
              ? '이 모둠의 그림 만들기 횟수를 다 썼어요. 선생님께 말씀드려 주세요.'
              : '그림을 다시 만들지 못했어요. 잠시 후 다시 시도해 주세요.';
          alert(_msg);
          btn.disabled = false; btn.textContent = t0;
        }
      } catch (e) {
        alert('그림을 다시 만들지 못했어요. 잠시 후 다시 시도해 주세요.');
        btn.disabled = false; btn.textContent = t0;
      }
    });
  });

  root.querySelectorAll('.js-pb-image-draw').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_editText.editable) return;
      if (_aiImageVariantBlocksOriginalEdit()) return;
      if (scene.imageData) return;
      _closeIfPopover();   /* 모달 진입 전 팝오버 닫음 */
      _openPbDrawModal(scene);
    });
  });

  /* LEVEL2-DRAW: '어떻게 바뀌어요?' — 졸라맨 구도 → AI 변환 예시 팝업(안내 전용·저장 무접촉). */
  root.querySelectorAll('.js-pb-lvl2-example').forEach(btn => {
    btn.addEventListener('click', () => { _closeIfPopover(); _openLvl2ExampleModal(); });
  });

  root.querySelectorAll('.js-pb-image-transform').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_editText.editable) return;
      if (_aiImageVariantBlocksOriginalEdit()) return;
      _closeIfPopover();   /* 오버레이 진입 전 팝오버 닫음 */
      if (typeof enterImageTransformEdit === 'function') enterImageTransformEdit();
    });
  });

  root.querySelectorAll('.js-pb-image-crop').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_editText.editable) return;
      if (_aiImageVariantBlocksOriginalEdit()) return;
      _closeIfPopover();   /* 오버레이 진입 전 팝오버 닫음 */
      if (typeof enterImageCropEdit === 'function') enterImageCropEdit();
    });
  });
}

/* LEVEL2-DRAW(2026-07-21): 2단계 '어떻게 바뀌어요?' 예시 팝업.
   왼쪽=인라인 SVG 졸라맨 구도(용량 0), 오른쪽=실제 AI 변환 예시(assets/level2-draw-example.jpg).
   순수 안내 — 저장/데이터 무접촉. viewer-confirm-backdrop 스타일 재사용. */
function _openLvl2ExampleModal() {
  const OLD = document.getElementById('lvl2-example-modal');
  if (OLD) OLD.remove();
  const stickSvg = ''
    + '<svg viewBox="0 0 200 150" width="100%" style="background:#fdfdfb;border-radius:8px;display:block;">'
    +   '<g stroke="#666" stroke-width="4" stroke-linecap="round" fill="none">'
    +     '<circle cx="80" cy="55" r="15"/>'                             /* 머리 */
    +     '<line x1="80" y1="70" x2="80" y2="105"/>'                     /* 몸 */
    +     '<line x1="80" y1="80" x2="58" y2="70"/><line x1="80" y1="80" x2="102" y2="70"/>' /* 팔(우산 든) */
    +     '<line x1="80" y1="105" x2="66" y2="130"/><line x1="80" y1="105" x2="94" y2="130"/>' /* 다리 */
    +     '<line x1="80" y1="62" x2="80" y2="42"/><path d="M55 42 Q80 26 105 42"/>'  /* 우산 */
    +   '</g>'
    +   '<g stroke="#8ab4d8" stroke-width="3" stroke-linecap="round">'
    +     '<line x1="20" y1="15" x2="15" y2="28"/><line x1="55" y1="12" x2="50" y2="25"/><line x1="130" y1="14" x2="125" y2="27"/><line x1="170" y1="16" x2="165" y2="29"/>' /* 비 */
    +   '</g>'
    +   '<text x="80" y="148" font-size="11" fill="#999" text-anchor="middle" font-family="sans-serif">이렇게 대충 그려도 OK</text>'
    + '</svg>';
  const root = document.createElement('div');
  root.id = 'lvl2-example-modal';
  root.className = 'viewer-confirm-backdrop';
  root.innerHTML =
    '<div class="viewer-confirm-card" role="dialog" aria-modal="true" style="max-width:560px;">'
    +   '<div class="viewer-confirm-title">🎨 이렇게 그리면 돼요</div>'
    +   '<div class="viewer-confirm-message" style="margin-bottom:12px;">그림을 잘 그리지 않아도 괜찮아요. <b>누가 어디에 있는지만</b> 쓱쓱 간단히 그리면, <b>AI 그림책 마감</b>이 예쁜 그림책 그림으로 바꿔 줘요.</div>'
    +   '<div style="display:flex;align-items:center;gap:10px;justify-content:center;flex-wrap:wrap;">'
    +     '<div style="flex:1;min-width:150px;max-width:230px;">' + stickSvg + '</div>'
    +     '<div style="font-size:28px;color:#c66f4a;flex:0 0 auto;">→</div>'
    +     '<div style="flex:1;min-width:150px;max-width:230px;">'
    +       '<img src="assets/level2-draw-example.jpg" alt="AI가 바꾼 그림 예시" style="width:100%;border-radius:8px;display:block;">'
    +       '<div style="font-size:11px;color:#999;text-align:center;margin-top:2px;">AI가 이렇게 바꿔 줘요 (예시)</div>'
    +     '</div>'
    +   '</div>'
    +   '<div class="viewer-confirm-actions" style="margin-top:14px;">'
    +     '<button type="button" class="viewer-confirm-ok js-lvl2-ex-close">알겠어요</button>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(root);
  const close = () => { root.remove(); };
  root.querySelector('.js-lvl2-ex-close').addEventListener('click', close);
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
}

/* ════════════════════════════════════════════════════════════════
   LEVEL2-CHAR(2026-07-21): 2단계 '우리 주인공 그리기' 필수 게이트 + 저장.
   ─────────────────────────────────────────────────────────────
   · 2단계 다듬기 첫 진입(튜토리얼 끝난 뒤) → 주인공이 아직 없으면 못 닫는 모달 강제.
     주인공을 한 번 그려야 진행 가능 → 그 그림이 모든 장면 마감의 캐릭터 레퍼런스(일관성).
   · 저장 = viewer-meta/protagonistRef(클라 쓰기 가능·authorName/printOverrides 패턴).
     서버 callImageAiS2가 2단계면 이 URL을 마감 2번째 이미지로 주입.
   ════════════════════════════════════════════════════════════════ */
function _level2NeedsCharacter() {
  try {
    if (!ViewerState || !ViewerState.editMode || !ViewerState.fromMaker) return false;
    if (!ViewerState.project || ViewerState.project.picturebookLevel !== 2) return false;
    const ref = ViewerState.project.protagonistRef;
    return !(typeof ref === 'string' && /^https?:\/\//.test(ref));
  } catch (e) { return false; }
}

async function _saveProtagonistRef(url, desc) {
  const clean = (url && /^https?:\/\//.test(String(url).trim())) ? String(url).trim() : null;
  if (!clean) throw new Error('bad url');
  /* PROTAG-DESC-1: 주인공 특징 글 — 누가 주인공인지 확정용(캐릭터 시트). 120자 상한. */
  const cleanDesc = (typeof desc === 'string') ? desc.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  try {
    if (ViewerState && ViewerState.project) {
      ViewerState.project.protagonistRef = clean;
      ViewerState.project.protagonistDesc = cleanDesc || null;
    }
  } catch (e) { /* noop */ }
  /* classId/teamName 소스는 검증된 저장(authorName)과 동일 — 진실은 ViewerState.project.*
     (loadTeamData가 채움). ViewerState.*·URL 파라미터는 fallback. 직접 ViewerState.classId만
     쓰면 init 시점 공백에 "team not ready"로 저장 실패(사용자 보고). */
  let cid = '', tn = '';
  try {
    const proj = (ViewerState && ViewerState.project) || {};
    cid = String(proj.classId || (ViewerState && ViewerState.classId) || '');
    tn = String(proj.teamName || (ViewerState && ViewerState.teamName) || '');
    const p = new URLSearchParams(location.search);
    if (!cid && p.get('classId')) cid = p.get('classId');
    if (!tn && p.get('team')) tn = p.get('team');
  } catch (e) { /* noop */ }
  if (!cid || !tn) throw new Error('team not ready');
  const app = (typeof getViewerApp === 'function') ? getViewerApp() : firebase.app('viewer');
  if (!app || typeof app.database !== 'function') throw new Error('db not ready');
  await app.database().ref('classes/' + cid + '/teams/' + encodeURIComponent(tn) + '/viewer-meta')
    .update({ protagonistRef: clean, protagonistDesc: cleanDesc || null });
}

/* 못 닫는 필수 게이트 모달 — [주인공 그리기 시작]만. 배경/ESC 닫힘 없음. */
function _openLevel2CharGate() {
  if (document.getElementById('lvl2-char-gate')) return;
  if (!_level2NeedsCharacter()) return;
  const root = document.createElement('div');
  root.id = 'lvl2-char-gate';
  root.className = 'viewer-confirm-backdrop';
  root.innerHTML =
    '<div class="viewer-confirm-card" role="dialog" aria-modal="true" style="max-width:440px;text-align:center;">'
    +   '<div style="font-size:40px;line-height:1;margin-bottom:6px;">🎨</div>'
    +   '<div class="viewer-confirm-title">우리 이야기의 주인공을 먼저 그려요</div>'
    +   '<div class="viewer-confirm-message" style="margin-bottom:14px;">주인공을 한 번만 그려 두면, AI가 모든 장면에서 <b>똑같은 주인공</b>으로 예쁘게 그려 줘요. 잘 그리지 않아도 괜찮아요 — <b>누구인지 알아볼 수 있게</b>만 그려 주세요.</div>'
    +   '<div class="viewer-confirm-actions" style="justify-content:center;">'
    +     '<button type="button" class="viewer-confirm-ok js-lvl2-char-start" style="font-size:15px;padding:11px 22px;">✏️ 주인공 그리기 시작</button>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(root);
  /* 못 닫게: 배경 클릭 무시. ESC 차단(캡처). */
  root.addEventListener('click', (e) => { if (e.target === root) e.stopPropagation(); });
  const _escBlock = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); } };
  document.addEventListener('keydown', _escBlock, true);
  const _cleanup = () => { document.removeEventListener('keydown', _escBlock, true); root.remove(); };
  root.querySelector('.js-lvl2-char-start').addEventListener('click', () => {
    /* 그리기 모달(z 9999)이 게이트(z 100060) 뒤에 열리므로, 그리기 동안 게이트를 숨긴다.
       저장 없이 닫으면(onClose·주인공 여전히 없음) 게이트 재노출 → 필수 유지. */
    root.style.display = 'none';
    /* 그리기 스튜디오(작품 단위 저장 오버라이드). 껍데기 scene=캔버스 비율/배경용. */
    const shell = {
      id: '__protagonist__', num: '__protagonist__',
      picturebookSubmode: 'imageCenter',
      imageData: (ViewerState.project && ViewerState.project.protagonistRef) || null,
    };
    _openPbDrawModal(shell, {
      title: '🎨 우리 주인공 그리기',
      /* PROTAG-DESC-1: 2단계는 특징 글 필수 — 누가 주인공인지 확정(장면마다 안 흔들리게). */
      descField: true, descRequired: true,
      descValue: (ViewerState.project && ViewerState.project.protagonistDesc) || '',
      saveOverride: async (url, desc) => {
        await _saveProtagonistRef(url, desc);
        _cleanup();   /* 주인공 저장 성공 → 게이트 해제, 진행 가능 */
      },
      onClose: () => {
        /* 저장 성공이면 _cleanup으로 root 제거됨(재노출 안 함). 취소면 주인공 여전히 없음 → 다시 띄움. */
        if (_level2NeedsCharacter() && root.isConnected) root.style.display = '';
      },
    });
  });
}

/* ════════════════════════════════════════════════════════════════
   LV1-PROTAG-VISION(2026-07-22 부활): 1단계 주인공 그리기 — 선택 게이트.
   ─────────────────────────────────────────────────────────────
   · maker(초안 직후)에서 [내 주인공 그리기]를 고르면 pending 플래그+다듬기 이동→이 게이트.
     2단계 필수 게이트와 달리 [건너뛰기] 있음(선택).
   · 저장 = viewer-meta/protagonistRef → 서버가 "그림 그대로"가 아니라 비전으로 설명해
     순수 생성에 반영(화풍 안정·edits 아님). 건너뛰기 = 무레퍼런스 순수 생성.
   · 어느 쪽이든 플래그 소거·배치 1회 시작(그림 없는 고아 방지). ⚠️2단계 그림(edits+스케치)과 무관.
   ════════════════════════════════════════════════════════════════ */
function _lv1PendingDrawInfo() {
  try {
    const raw = sessionStorage.getItem('pbLv1ProtagDraw');
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || !v.classId || !v.teamName) return null;
    const p = (ViewerState && ViewerState.project) || {};
    if (String(p.classId || '') !== String(v.classId)) return null;
    if (String(p.teamName || '') !== String(v.teamName)) return null;
    if (p.projectType !== 'picturebook' || p.picturebookLevel !== 1) return null;
    if (typeof v.at === 'number' && (Date.now() - v.at) > 2 * 60 * 60 * 1000) return null;   /* 2h 신선도 */
    return v;
  } catch (e) { return null; }
}
function _clearLv1PendingDraw() { try { sessionStorage.removeItem('pbLv1ProtagDraw'); } catch (e) { /* noop */ } }
function _fireLv1ImagesFromViewer(cid, tn) {
  try {
    firebase.app().functions('asia-northeast3')
      .httpsCallable('generateStoryImages', { timeout: 570000 })({ classId: cid, teamName: tn })
      .then((r) => { const g = r && r.data; console.info('[storyImages] done:', g && g.generated, 'skipped:', g && g.skipped); })
      .catch((e) => console.warn('[storyImages] fail:', (e && (e.code || e.message)) || e));
  } catch (e) { /* 비치명 — 장면별 🔁로 수동 생성 가능 */ }
}

function _openLevel1ProtagGate() {
  const info = _lv1PendingDrawInfo();
  if (!info) return;
  if (document.getElementById('lvl1-protag-gate')) return;
  const root = document.createElement('div');
  root.id = 'lvl1-protag-gate';
  root.className = 'viewer-confirm-backdrop';
  root.innerHTML =
    '<div class="viewer-confirm-card" role="dialog" aria-modal="true" style="max-width:440px;text-align:center;">'
    +   '<div style="font-size:40px;line-height:1;margin-bottom:6px;">🎨</div>'
    +   '<div class="viewer-confirm-title">우리 이야기의 주인공을 그려요</div>'
    +   '<div class="viewer-confirm-message" style="margin-bottom:14px;">주인공을 한 번만 그려 두면, AI가 그 모습(모자·색·소품)을 살려서 모든 장면을 그려 줘요. 잘 그리지 않아도 괜찮아요 — <b>누구인지 알아볼 수 있게</b>만 그려 주세요.</div>'
    +   '<div class="viewer-confirm-actions" style="justify-content:center;flex-wrap:wrap;gap:8px;">'
    +     '<button type="button" class="viewer-confirm-ok js-lvl1-protag-start" style="font-size:15px;padding:11px 22px;">✏️ 주인공 그리기 시작</button>'
    +     '<button type="button" class="viewer-confirm-cancel js-lvl1-protag-skip" style="font-size:13px;">건너뛰기 — AI가 알아서 그려요</button>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(root);
  const _finish = (fire) => {
    _clearLv1PendingDraw();
    root.remove();
    if (fire) _fireLv1ImagesFromViewer(info.classId, info.teamName);
  };
  root.querySelector('.js-lvl1-protag-skip').addEventListener('click', () => _finish(true));
  root.querySelector('.js-lvl1-protag-start').addEventListener('click', () => {
    root.style.display = 'none';
    const shell = {
      id: '__protagonist__', num: '__protagonist__',
      picturebookSubmode: 'imageCenter',
      imageData: (ViewerState.project && ViewerState.project.protagonistRef) || null,
    };
    _openPbDrawModal(shell, {
      title: '🎨 우리 주인공 그리기',
      /* PROTAG-DESC-1: 1단계도 특징 글 필수 — 확정된 주인공으로 전 장면 일관. */
      descField: true, descRequired: true,
      descValue: (ViewerState.project && ViewerState.project.protagonistDesc) || '',
      saveOverride: async (url, desc) => {
        await _saveProtagonistRef(url, desc);
        _finish(true);   /* 저장 성공 → 비전 설명 반영된 배치 시작 */
      },
      onClose: () => {
        if (root.isConnected && document.getElementById('lvl1-protag-gate')) root.style.display = '';
      },
    });
  });
}

/* viewer-entry(튜토리얼 완료 훅)에서 호출 — 2단계 필수 게이트 + 1단계 선택 게이트(pending 시). */
if (typeof window !== 'undefined') {
  window.__maybeShowLevel2CharGate = function () {
    try { _openLevel2CharGate(); } catch (e) { /* noop */ }
    try { _openLevel1ProtagGate(); } catch (e) { /* noop */ }
  };
}

function _positionImagePopover(pop) {
  const trigger = document.querySelector('.js-edit-image-popover');
  if (!trigger) return;
  const r = trigger.getBoundingClientRect();
  pop.style.top = (r.bottom + 8) + 'px';
  const popW = pop.offsetWidth || 300;
  let left = r.left;
  const maxLeft = window.innerWidth - popW - 12;
  if (left > maxLeft) left = Math.max(12, maxLeft);
  pop.style.left = left + 'px';
}

function _openImagePopover() {
  const pop = _imagePopoverEl();
  if (!pop) return;
  /* 상호배타: 다른 팝오버가 열려 있으면 닫음(동시 노출 방지). */
  if (typeof _closeChoicePopover === 'function') _closeChoicePopover();
  if (typeof _closeCoverPopover === 'function') _closeCoverPopover();
  if (typeof _closeProjectPopover === 'function') _closeProjectPopover();
  pop.innerHTML = _renderImagePopoverBody();
  pop.hidden = false;
  _bindImagePopover(pop);
  _positionImagePopover(pop);
  document.querySelector('.js-edit-image-popover')?.classList.add('is-active');
  setTimeout(() => {
    document.addEventListener('click', _imagePopoverOutside, true);
    document.addEventListener('keydown', _imagePopoverEsc, true);
  }, 0);
}

function _closeImagePopover() {
  const pop = _imagePopoverEl();
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  pop.innerHTML = '';
  pop.style.left = '';
  pop.style.top  = '';
  document.querySelector('.js-edit-image-popover')?.classList.remove('is-active');
  document.removeEventListener('click', _imagePopoverOutside, true);
  document.removeEventListener('keydown', _imagePopoverEsc, true);
}

function _toggleImagePopover() {
  const pop = _imagePopoverEl();
  if (!pop) return;
  if (pop.hidden) _openImagePopover();
  else _closeImagePopover();
}

function _imagePopoverOutside(e) {
  const pop = _imagePopoverEl();
  if (!pop || pop.hidden) return;
  if (pop.contains(e.target)) return;
  /* 트리거 클릭은 토글 핸들러가 처리 — 여기서 닫지 않음(이중 토글 방지). */
  if (e.target.closest && e.target.closest('.js-edit-image-popover')) return;
  _closeImagePopover();
}

function _imagePopoverEsc(e) {
  if (e.key === 'Escape') _closeImagePopover();
}

/* ================================================================
   SCENE-STYLE-1: picturebook "🎭 장면 스타일" 상단 팝오버
   ─────────────────────────────────────────────────────────────
   · 현재 장면의 장면단위 톤(본문 카드 톤 / 엔딩 마감톤). 작품 설정 아님 → ⚙️ 아닌 별도 도구.
   · 내용은 _pbSceneToneSectionHtml(scene), 바인딩은 2C에서 검증된 _bindPbToneEvents(pop, scene)
     그대로 재사용(renderEditPanel 부작용 없음·active grid-scope·_queueSave 동일·variant-lock 없음).
   · 상호배타: 열 때 🔗/🎨/⚙️/🖼️ 팝오버 닫음. 반대는 바깥클릭 핸들러가 자동 처리.
   · 트리거는 picturebook 비표지 장면에서만(renderHUD의 _isPbImageHudScene 재사용).
   ================================================================ */
function _sceneStylePopoverEl() { return document.getElementById('edit-scene-style-popover'); }

/* REFINE-IA-2: 텍스트 꾸미기 활성 탭 — 'project'(이야기 전체) | 'scene'(이 장면만). 기본=장면. */
let _sceneStyleTab = 'scene';

/* 작품 기본값 탭에 표시할 값 — getProjectTextDefaults sparse + 시스템 fallback으로 채운 표시용 객체. */
function _textProjectDisplayDefaults() {
  const pj = (typeof getProjectTextDefaults === 'function') ? getProjectTextDefaults() : null;
  const s  = (pj && pj.textStyle) || {};
  return {
    theme: (pj && pj.textTheme) || 'classic',
    style: {
      fontFamily: (s.fontFamily !== undefined) ? s.fontFamily : null,
      fontSize:   (typeof s.fontSize === 'number') ? s.fontSize : 18,
      color:      (typeof s.color === 'string') ? s.color : '',
      weight:     'normal',
    },
  };
}

/* 장면이 항목별로 작품 기본값과 다른지(override) 판정 — "기본값" 칩/되돌리기 활성 여부. */
function _sceneStyleOverrideMap(scene) {
  /* REFINE-IA-2.1: "일부러 다르게 한"(marker 있는) 항목만 예외로 표시 → 칩/되돌리기 활성.
     marker 없는 레거시 값은 작품 기본값을 따르는 상태이므로 예외로 치지 않음. */
  const m = (scene && scene.textStyleOverride && typeof scene.textStyleOverride === 'object') ? scene.textStyleOverride : {};
  return {
    theme:      !!(scene && scene.textThemeOverride),
    fontFamily: !!m.fontFamily,
    fontSize:   !!m.fontSize,
    color:      !!m.color,
    weight:     !!m.weight,
  };
}

function _renderSceneStylePopoverBody() {
  const scene = ViewerState.scenes[ViewerState.currentSceneId];
  const ptype = (typeof _resolveViewerProjectType === 'function') ? _resolveViewerProjectType() : null;
  /* TEXT-MODE-1C / REFINE-IA-2: text는 [이야기 전체][이 장면만] 탭, picturebook은 기존(톤+글자+모든장면적용). */
  let bodyInner, noteHtml = '';
  if (ptype === 'text') {
    const tab = (_sceneStyleTab === 'project') ? 'project' : 'scene';
    const tabBar = `
      <div class="edit-scene-style-tabs" role="tablist">
        <button type="button" class="edit-scene-style-tab js-scene-style-tab ${tab === 'project' ? 'active' : ''}" data-tab="project" role="tab" aria-selected="${tab === 'project'}">이야기 전체</button>
        <button type="button" class="edit-scene-style-tab js-scene-style-tab ${tab === 'scene' ? 'active' : ''}" data-tab="scene" role="tab" aria-selected="${tab === 'scene'}">이 장면만</button>
      </div>`;
    if (tab === 'project') {
      const pd = _textProjectDisplayDefaults();
      bodyInner = `
        <div class="edit-scene-style-subtitle">🎨 테마</div>
        ${_textThemeSectionHtml(scene, { theme: pd.theme })}
        <div class="edit-scene-style-divider"></div>
        <div class="edit-scene-style-subtitle">🅰 글자</div>
        ${_textGlyphStyleSectionHtml(scene, { style: pd.style, noWeight: true })}
        <div class="edit-section-hint">엔딩 장면도 이 기본값을 따라요.</div>`;
      noteHtml = `<p class="edit-scene-style-popover__note">모든 장면에서 기본으로 사용할 글과 화면 스타일이에요. <b>새 장면에도 같이 적용</b>돼요.</p>`;
    } else {
      const ovr = scene ? _sceneStyleOverrideMap(scene) : {};
      const anyOvr = !!(ovr.theme || ovr.fontFamily || ovr.fontSize || ovr.color || ovr.weight);
      bodyInner = `
        <div class="edit-scene-style-subtitle">🎨 테마</div>
        ${scene ? _textThemeSectionHtml(scene, { overrideChip: !!ovr.theme }) : ''}
        <div class="edit-scene-style-divider"></div>
        <div class="edit-scene-style-subtitle">🅰 글자 스타일</div>
        ${scene ? _textGlyphStyleSectionHtml(scene, { overrideChips: ovr }) : ''}
        <!-- CLEANUP-GLOBAL-EFFECTS: 장면별 '이 장면의 텍스트 효과'(subtitle+hint+_textEffectSectionHtml) 제거.
             텍스트 등장 효과는 감상 설정의 '텍스트 등장 효과(작품 전체)'로 통일. 장면별 저장값(scene.textEffect)은
             getTextEffect가 전역 우선으로 무시(DB 삭제 X). 관련 함수/핸들러(_textEffectSectionHtml·
             js-edit-text-entrance·js-edit-text-body-effect)는 미렌더로 dead(바인딩 0·에러 없음). -->
        <div class="edit-scene-style-apply-all">
          <!-- STYLE-PROMOTE-1(2026-07-10): 상속 승격 — 지금 장면의 글자 모양을 이야기 전체 기본값으로.
               기존 resolver(작품 기본값+장면 예외) 그대로 사용: 기본값을 따르는 장면·새 장면·엔딩이 전부 따라오고
               직접 꾸민(marker) 장면은 보존. 굵기는 textDefaults 범위 밖(장면별 유지) — 레거시 뒤집힘 방지. -->
          <button type="button" class="js-scene-style-promote edit-style-promote-btn">⤴ 이 글자 모양을 이야기 전체 기본으로</button>
          <button type="button" class="js-scene-style-reset-all edit-style-reset-all-btn" ${anyOvr ? '' : 'disabled'}>↩ 이 장면을 작품 기본값으로 되돌리기</button>
          <details class="edit-style-advanced">
            <summary>고급</summary>
            ${scene ? _applyStyleAllButtonHtml(scene) : ''}
          </details>
        </div>`;
      noteHtml = `<p class="edit-scene-style-popover__note">지금 보고 있는 <b>이 장면만</b> 바뀌어요. 비워두면 이야기 전체 기본값을 따라요.</p>`;
    }
    bodyInner = tabBar + noteHtml + bodyInner;
    return `
    <div class="edit-scene-style-popover__head">
      <span class="edit-scene-style-popover__title">🎨 꾸미기</span>
      <button type="button" class="edit-scene-style-popover__close js-scene-style-popover-close"
        title="닫기" aria-label="닫기">✕</button>
    </div>
    <div class="edit-scene-style-popover__body">
      ${bodyInner}
    </div>`;
  }
  {
    /* PB-BODYBOX-1B: 글상자 진하기(_pbBodyBoxOpacitySectionHtml)를 톤 아래 복제.
       helper가 imageCenter(그림 중심형) 아닐 때 ''를 반환 → split/표지/엔딩엔 미표시. 저장은
       _bindSceneStylePopover의 팝오버 전용 js-pb-bb-op 핸들러가 처리(우측 슬라이더는 그대로 유지). */
    bodyInner = `
      ${scene ? _pbSceneToneSectionHtml(scene) : ''}
      ${scene ? _pbBodyBoxOpacitySectionHtml(scene) : ''}
      ${scene ? _pbEndingMoodSectionHtml(scene) : ''}
      ${scene ? _pbStoryStageSectionHtml(scene) : ''}
      <div class="edit-scene-style-divider"></div>
      <div class="edit-scene-style-subtitle">🅰 글자 스타일</div>
      ${scene ? _applyStyleAllButtonHtml(scene) : ''}
      ${scene ? _pbGlyphStyleSectionHtml(scene) : ''}`;
  }
  return `
    <div class="edit-scene-style-popover__head">
      <span class="edit-scene-style-popover__title">🎨 장면 꾸미기</span>
      <button type="button" class="edit-scene-style-popover__close js-scene-style-popover-close"
        title="닫기" aria-label="닫기">✕</button>
    </div>
    <div class="edit-scene-style-popover__body">
      <p class="edit-scene-style-popover__note">현재 장면의 글과 화면을 꾸며요. 원하면 같은 스타일을 지금 있는 <b>모든 장면</b>에 복사할 수 있어요.</p>
      ${bodyInner}
    </div>`;
}

/* ================================================================
   PB-MOOD-2: 장면 분위기 실제 저장 (🌙 결말 분위기 + 🎬 장면 분위기)
   ─────────────────────────────────────────────────────────────
   · imageCenter 그림책 장면만 노출. 엔딩=scene.pbEndingMood(happy|sad),
     일반=scene.pbStoryStage(rising|turning). '기본'=필드 제거(null → update 시 키 삭제).
   · 실제 저장: scene 필드 즉시 + saveSceneText(ALLOWED 포함) → Firebase. 감상에도 저장값 렌더.
   · 각 테마는 같은 의미를 고유 시각 언어로 번역(v03-modes.css·공통색 덮기 아님).
   · variant(s1/s2) 보기 중엔 저장 차단(원본에서만). 값 없는 기존 작품은 미부착(정본 그대로).
   ================================================================ */
function _pbEffectiveEndingMood(scene) {
  return (scene && (scene.pbEndingMood === 'happy' || scene.pbEndingMood === 'sad')) ? scene.pbEndingMood : '';
}
function _pbEffectiveStoryStage(scene) {
  return (scene && (scene.pbStoryStage === 'rising' || scene.pbStoryStage === 'turning')) ? scene.pbStoryStage : '';
}
function _isPbImageCenterEndingScene(scene) {
  return !!(scene
    && ViewerState.project && ViewerState.project.projectType === 'picturebook'
    && (scene.type === 'ending' || scene.isEnding)
    && scene.picturebookSubmode === 'imageCenter');
}
function _isPbImageCenterNormalScene(scene) {
  return !!(scene
    && ViewerState.project && ViewerState.project.projectType === 'picturebook'
    && scene.picturebookSubmode === 'imageCenter'
    && scene.type !== 'cover' && !scene.isCover
    && scene.type !== 'ending' && !scene.isEnding);
}
/* 분위기 필드 저장 — 메모리 즉시 + saveSceneText 직접 patch + 같은 장면 재렌더.
   허용값 외(기본)=null → Firebase update가 키 삭제. picturebookSubmode 저장과 동일 정책. */
function _saveSceneMoodField(scene, field, val, allow) {
  if (!scene) return;
  /* PICTUREBOOK_MOOD_AI_TEXT_VIEW_FIX: 장면 분위기(pbStoryStage/pbEndingMood)는 본문이 아니라
     그림책 페이지 프레임/배경 스타일이라, 글 보기 모드(원본/AI 장면발전)와 무관하게 적용돼야 한다.
     이전엔 variant-view 잠금(원본 body 보호용)에 묶여 'AI 장면발전' 보기에선 분위기 변경이 통째로
     차단됐다 → mood는 잠금 면제. data-story-stage는 viewer-render에서 view-mode 독립으로 부착되므로,
     저장+재렌더만 하면 현재 글 보기 모드(s2)를 유지한 채 주변 분위기만 갱신된다.
     (원본 body/imageData/aiVariants/text는 건드리지 않음 — pbStoryStage/pbEndingMood만 저장.) */
  const v = (allow.indexOf(val) >= 0) ? val : null;
  scene[field] = v;                                   /* 메모리 즉시 반영 */
  const id = scene.num != null ? scene.num : scene.id;
  if (id != null && typeof saveSceneText === 'function') {
    saveSceneText(id, { [field]: v }).catch(e => {
      console.warn('[pb-mood] 저장 실패', field, id, e && e.code);
      if (typeof _showSaveStatus === 'function') _showSaveStatus('분위기 저장에 실패했어요. 잠시 후 다시 시도해 주세요.', 2500);
    });
  }
  if (typeof _scheduleViewerFrameReRender === 'function') _scheduleViewerFrameReRender();
}
function _pbEndingMoodSectionHtml(scene) {
  if (!_isPbImageCenterEndingScene(scene)) return '';
  const cur = _pbEffectiveEndingMood(scene);
  const items = [
    { v: '',      label: '기본 모습',      help: '현재 테마 그대로 보여요' },
    { v: 'happy', label: '밝은 결말',      help: '따뜻하고 환한 느낌이에요' },
    { v: 'sad',   label: '여운 있는 결말', help: '조용하고 차분한 느낌이에요' },
  ];
  const segs = items.map(it => {
    const on = (cur === it.v);
    return `<button type="button" role="radio" aria-checked="${on}" tabindex="${on ? '0' : '-1'}"
      class="pb-mood-seg pb-mood-seg--${it.v || 'base'} js-pb-mood-seg${on ? ' is-on' : ''}"
      data-mood="${it.v}" title="${it.label} — ${it.help}" aria-label="${it.label}. ${it.help}">
      <span class="pb-mood-seg__label">${it.label}</span></button>`;
  }).join('');
  return `
    <div class="edit-scene-style-divider"></div>
    <div class="edit-scene-style-subtitle">🌙 결말 분위기</div>
    <div class="pb-mood-seg-group js-pb-mood-group" role="radiogroup" aria-label="결말 분위기">${segs}</div>
    <div class="edit-section-hint">눌러서 바로 바꿔요. 자동 저장돼요.</div>`;
}
function _pbStoryStageSectionHtml(scene) {
  if (!_isPbImageCenterNormalScene(scene)) return '';
  const cur = _pbEffectiveStoryStage(scene);
  const items = [
    { v: '',        label: '기본 장면',         help: '현재 테마 그대로 보여요' },
    { v: 'rising',  label: '이야기가 커져요',   help: '조금 밝고 활기있게' },
    { v: 'turning', label: '긴장감이 높아져요', help: '대비와 깊이가 늘어요' },
  ];
  const segs = items.map(it => {
    const on = (cur === it.v);
    return `<button type="button" role="radio" aria-checked="${on}" tabindex="${on ? '0' : '-1'}"
      class="pb-mood-seg pb-mood-seg--stage-${it.v || 'base'} js-pb-stage-seg${on ? ' is-on' : ''}"
      data-stage="${it.v}" title="${it.label} — ${it.help}" aria-label="${it.label}. ${it.help}">
      <span class="pb-mood-seg__label">${it.label}</span></button>`;
  }).join('');
  return `
    <div class="edit-scene-style-divider"></div>
    <div class="edit-scene-style-subtitle">🎬 장면 분위기</div>
    <div class="pb-mood-seg-group js-pb-stage-group" role="radiogroup" aria-label="장면 분위기">${segs}</div>
    <div class="edit-section-hint">눌러서 바로 바꿔요. 자동 저장돼요.</div>`;
}
/* radiogroup 공통 바인딩 — 클릭 + 화살표/Home/End/Space/Enter. saveFn(val): 실제 저장. */
function _bindMoodSegGroup(pop, segSelector, dataAttr, saveFn) {
  const segs = Array.prototype.slice.call(pop.querySelectorAll(segSelector));
  if (!segs.length) return;
  const apply = (btn) => {
    const raw = btn.dataset[dataAttr];
    const val = raw ? raw : null;            /* ''(기본) → null */
    segs.forEach(b => {
      const on = (b === btn);
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.setAttribute('tabindex', on ? '0' : '-1');
    });
    saveFn(val);
  };
  segs.forEach((btn, i) => {
    btn.addEventListener('click', () => apply(btn));
    btn.addEventListener('keydown', (e) => {
      let ni = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') ni = (i + 1) % segs.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ni = (i - 1 + segs.length) % segs.length;
      else if (e.key === 'Home') ni = 0;
      else if (e.key === 'End') ni = segs.length - 1;
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); apply(btn); return; }
      else return;
      e.preventDefault();
      const next = segs[ni];
      next.focus();
      apply(next);
    });
  });
}

function _bindSceneStylePopover(pop) {
  pop.querySelector('.js-scene-style-popover-close')
    ?.addEventListener('click', _closeSceneStylePopover);
  const scene = ViewerState.scenes[ViewerState.currentSceneId];
  if (!scene) return;
  /* PB-MOOD-2: 결말 분위기·장면 분위기 세그먼트 — 실제 저장(클릭 시 scene 필드 저장 + 재렌더). */
  _bindMoodSegGroup(pop, '.js-pb-mood-seg', 'mood',
    (val) => _saveSceneMoodField(scene, 'pbEndingMood', val, ['happy', 'sad']));
  _bindMoodSegGroup(pop, '.js-pb-stage-seg', 'stage',
    (val) => _saveSceneMoodField(scene, 'pbStoryStage', val, ['rising', 'turning']));
  const ptype = (typeof _resolveViewerProjectType === 'function') ? _resolveViewerProjectType() : null;
  if (ptype === 'text') {
    /* REFINE-IA-2: 탭 전환 — _sceneStyleTab 갱신 후 본문 재렌더+재바인딩. */
    pop.querySelectorAll('.js-scene-style-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = (btn.dataset.tab === 'project') ? 'project' : 'scene';
        if (t === _sceneStyleTab) return;
        _sceneStyleTab = t;
        _rerenderSceneStylePopover();
      });
    });
    if (_sceneStyleTab === 'project') {
      /* 이야기 전체 탭 — 작품 기본값 저장(saveProjectTextDefaults). */
      if (typeof _bindProjectTextDefaultsActions === 'function') _bindProjectTextDefaultsActions(pop);
    } else {
      /* 이 장면만 탭 — sparse override 저장 + 항목별/전체 되돌리기 + 고급(모든 장면 복사). */
      if (typeof _bindTextSceneStyleActions === 'function') _bindTextSceneStyleActions(pop, scene);
      if (typeof _bindSceneStyleResetActions === 'function') _bindSceneStyleResetActions(pop, scene);
      if (typeof _bindApplyStyleAllHandlers === 'function') _bindApplyStyleAllHandlers(pop, scene);
    }
    return;
  }
  /* picturebook (기존) */
  /* SCENE-STYLE-1: 톤 버튼 바인딩 — 우측과 동일 _bindPbToneEvents 재사용(새 저장 로직 X). */
  if (typeof _bindPbToneEvents === 'function') _bindPbToneEvents(pop, scene);
  /* GLYPH-STYLE-1C: 글자 스타일 바인딩 — 우측 pb 글자 핸들러와 동일 경로(_applyVariantStyleOrBlock
     + _ensure textStyle + _queueSave + _patchPbStyle). root(pop) scope 전용. 새 저장 로직 X. */
  if (typeof _bindPbGlyphStyleActions === 'function') _bindPbGlyphStyleActions(pop, scene);
  /* GLYPH-APPLYALL: "모든 장면 적용" 바인딩 — 우측 _bindApplyStyleAllHandlers를 root(pop)에
     그대로 재사용(panel 인자 받는 구조). textStyle+textTheme 전 장면 적용 경로 무수정. */
  if (typeof _bindApplyStyleAllHandlers === 'function') _bindApplyStyleAllHandlers(pop, scene);

  /* PB-BODYBOX-1B: 글상자 진하기(backdropOpacity) — 우측 _pbBbBindRange의 op 슬라이더와 동일 저장 경로
     (scene.picturebookBodyBox + _queueSave + _flushPendingSave). 우측 _pbBbBindRange는 panel 클로저라
     재사용 불가 → root(pop) scope로 최소 복제. renderEditPanel 미호출(값 라벨만 갱신).
     helper가 imageCenter 아닐 땐 슬라이더 자체를 안 그려 range null → no-op.
     FIELD-FIX-C(2026-07-02): 구 variant 가드 제거 — REFINE-STAB-B에서 진하기는 '항상 원본
     설정을 따름'(AI 보기의 _getDisplayPbBodyBox가 원본 backdropOpacity를 merge)으로 정리됐으므로,
     AI(s1/s2) 보기 중에도 이 슬라이더=원본 진하기 설정 변경이고 화면에 즉시 반영되는 게 맞다.
     variant layout(x/y/w/h)·본문 편집 잠금은 별개 경로로 계속 유지(여긴 진하기만). */
  (function _bindPbBodyBoxOpacity() {
    const range = pop.querySelector('.js-pb-bb-op');
    const valEl = pop.querySelector('.js-pb-bb-op-val');
    if (!range) return;
    const _ensureBb = () => {
      const pbBb = (typeof getPicturebookBodyBox === 'function')
        ? getPicturebookBodyBox(scene)
        : { x: 15, y: 25, width: 55, height: null, backdropOpacity: 0.85 };
      if (!scene.picturebookBodyBox || typeof scene.picturebookBodyBox !== 'object') {
        scene.picturebookBodyBox = { ...pbBb };
      }
      return scene.picturebookBodyBox;
    };
    range.addEventListener('input', () => {
      if (!_editText.editable) return;
      const bb = _ensureBb();
      const numeric = Number(range.value);
      bb.backdropOpacity = numeric / 100;
      if (valEl) valEl.textContent = `${numeric}%`;
      if (typeof _scheduleViewerFrameReRender === 'function') _scheduleViewerFrameReRender();
    });
    range.addEventListener('change', () => {
      if (!_editText.editable) return;
      const bb = _ensureBb();
      /* AI-VAR-FIX-1(2026-07-05): FIELD-FIX-C가 이 바인딩의 variant 가드만 풀어서
         AI(s1/s2) 보기 중 화면 반영은 되는데, _queueSave/_flushPendingSave 내부의
         variant 전면 차단(949·969행)에 걸려 저장이 조용히 버려지던 버그.
         진하기는 '항상 원본 설정'(REFINE-STAB-B)이므로 variant 보기 중엔 원본 저장을
         직접 호출한다. x/y/w/h는 variant 드래그가 원본 메모리를 안 건드려(1870행 분기)
         scene.picturebookBodyBox = 원본 좌표 + 바뀐 진하기 → 통째 저장 안전. */
      if (typeof _isVariantViewLocked === 'function' && _isVariantViewLocked()) {
        _showSaveStatus('저장 중…');
        Promise.resolve(saveSceneText(scene.num || scene.id, { picturebookBodyBox: { ...bb } }))
          .then(() => _showSaveStatus('✅ 저장됨', 1200))
          .catch(() => _showSaveStatus('❌ 저장 실패', 2000));
        return;
      }
      _queueSave(scene.num || scene.id, { picturebookBodyBox: { ...bb } });
      _flushPendingSave();
    });
  })();
}

/* TEXT-MODE-1C: 🎭 장면 스타일 팝오버용 text 글자/테마/효과 바인딩(root scope).
   우측 text 핸들러(_bindEditPanelEvents text 분기)와 **동일 경로** 호출 —
   글자: _applyVariantStyleOrBlock(variant면 fontSize만) → 원본이면 textStyle ensure + _queueSave + _patchTextStyle.
   테마: scene.textTheme + _queueSave + _patchTextTheme. 효과: scene.textEffect + _queueSave + _patchTextEffect.
   renderEditPanel/collapsible 토글 미복제. 우측 핸들러 무수정. _ensureTextStyle/_ensureTextEffect는 우측 로컬이라 인라인. */
function _bindTextSceneStyleActions(root, scene) {
  if (!root || !scene) return;
  const _ensureTe = () => {
    if (!scene.textEffect || typeof scene.textEffect !== 'object') {
      scene.textEffect = { entrance: 'none', body: 'none' };
    }
    return scene.textEffect;
  };
  /* REFINE-IA-2: 장면별 sparse override. scene.textStyleRaw = 지정된 예외 키만.
     scene.textStyle 은 같은 sparse 객체로 미러(텍스트 모드 reader는 getTextStyle resolved 사용).
     DB 도 sparse 저장(없는 키 = 작품 기본값 위임). value 가 defer(''·null·undefined)면 키 제거(기본값 복귀). */
  const _ovr = () => {
    if (!scene.textStyleRaw || typeof scene.textStyleRaw !== 'object') {
      scene.textStyleRaw = (typeof _sparseTextStyleOverride === 'function')
        ? (_sparseTextStyleOverride(scene.textStyle) || {}) : {};
    }
    return scene.textStyleRaw;
  };
  /* override 유무가 바뀔 때만 true 반환 → 그때만 팝오버 re-render(칩 출현/소멸).
     값만 바뀌는 평상시 편집은 re-render 안 함 → 포커스 유지(Codex Step2 #5 반영). */
  const _marks = () => {
    if (!scene.textStyleOverride || typeof scene.textStyleOverride !== 'object') scene.textStyleOverride = {};
    return scene.textStyleOverride;
  };
  const _writeStyle = (field, value) => {
    const o = _ovr();
    const m = _marks();
    const had = (field in o);
    if (value === undefined || value === null || value === '') { delete o[field]; delete m[field]; }
    else { o[field] = value; m[field] = true; }   /* REFINE-IA-2.1: 의도적 예외 marker */
    const has = (field in o);
    scene.textStyle = { ...o };
    _queueSave(scene.num || scene.id, { textStyle: { ...o }, textStyleOverride: { ...m } });
    _flushPendingSave();
    if (!_patchTextStyle()) _scheduleViewerFrameReRender();
    return had !== has;
  };
  /* 폰트 — '테마 기본 글씨체'('' / 'auto') = override 해제(작품 기본값 위임). */
  root.querySelectorAll('.js-edit-text-font').forEach(sel => {
    sel.addEventListener('change', e => {
      if (!_editText.editable) return;
      const raw = e.target.value;
      const v = (raw && raw !== 'auto') ? raw : null;
      if (_applyVariantStyleOrBlock(scene, { fontFamily: v }, () => {
        e.target.style.fontFamily = v ? `var(--font-${v})` : '';
      })) return;
      e.target.style.fontFamily = v ? `var(--font-${v})` : '';
      if (_writeStyle('fontFamily', v)) _rerenderSceneStylePopover();
    });
  });
  /* 글자 크기 — 슬라이더는 항상 override(해제는 "전체 기본값" 칩). input=라벨+저장, change=칩 갱신(유무 변화 시). */
  root.querySelectorAll('.js-edit-text-size').forEach(slider => {
    let _sizeChanged = false;
    slider.addEventListener('input', e => {
      if (!_editText.editable) return;
      const v = parseInt(e.target.value, 10);
      if (isNaN(v)) return;
      if (_applyVariantStyleOrBlock(scene, { fontSize: v }, () => {
        const ln = slider.closest('.edit-row')?.querySelector('.edit-label-note');
        if (ln) ln.textContent = `(${v}px)`;
      })) return;
      const labelNote = slider.closest('.edit-row')?.querySelector('.edit-label-note');
      if (labelNote) labelNote.textContent = `(${v}px)`;
      if (_writeStyle('fontSize', v)) _sizeChanged = true;
    });
    slider.addEventListener('change', () => {
      if (!_editText.editable) return;
      if (typeof _isVariantViewLocked === 'function' && _isVariantViewLocked()) return;
      if (_sizeChanged) { _sizeChanged = false; _rerenderSceneStylePopover(); }
    });
  });
  /* 색 팔레트 — '기본'(data-val '') = override 해제. */
  root.querySelectorAll('.js-edit-text-color').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_editText.editable) return;
      const v = btn.dataset.val || '';
      if (_applyVariantStyleOrBlock(scene, { color: v }, () => {
        root.querySelectorAll('.js-edit-text-color').forEach(b => b.classList.toggle('active', b === btn));
      })) return;
      root.querySelectorAll('.js-edit-text-color').forEach(b => b.classList.toggle('active', b === btn));
      if (_writeStyle('color', v)) _rerenderSceneStylePopover();
    });
  });
  /* 자유 색 */
  root.querySelectorAll('.js-edit-text-color-pick').forEach(input => {
    input.addEventListener('change', e => {
      if (!_editText.editable) return;
      const v = e.target.value;
      if (_applyVariantStyleOrBlock(scene, { color: v }, () => {})) return;
      root.querySelectorAll('.js-edit-text-color').forEach(b => b.classList.remove('active'));
      if (_writeStyle('color', v)) _rerenderSceneStylePopover();
    });
  });
  /* 굵기 — 장면별(작품 기본값 범위 밖). */
  root.querySelectorAll('.js-edit-text-weight').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_editText.editable) return;
      const v = btn.dataset.val === 'bold' ? 'bold' : 'normal';
      if (_applyVariantStyleOrBlock(scene, { weight: v }, () => {
        root.querySelectorAll('.js-edit-text-weight').forEach(b => b.classList.toggle('active', b === btn));
      })) return;
      root.querySelectorAll('.js-edit-text-weight').forEach(b => b.classList.toggle('active', b === btn));
      if (_writeStyle('weight', v)) _rerenderSceneStylePopover();
    });
  });
  /* 테마 — 장면 override(해제는 "전체 기본값" 칩). 첫 지정 때만 칩 출현 → 그때만 re-render. */
  root.querySelectorAll('.js-edit-text-theme').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_editText.editable) return;
      const v = btn.dataset.val || 'classic';
      const wasOverridden = !!scene.textThemeOverride;
      scene.textTheme = v;
      scene.textThemeOverride = true;   /* REFINE-IA-2.1: 의도적 테마 예외 marker */
      _queueSave(scene.num || scene.id, { textTheme: v, textThemeOverride: true });
      _flushPendingSave();
      root.querySelectorAll('.js-edit-text-theme').forEach(b => b.classList.toggle('active', b === btn));
      if (!_patchTextTheme()) _scheduleViewerFrameReRender();
      if (!wasOverridden) _rerenderSceneStylePopover();
    });
  });
  /* 진입 효과 */
  root.querySelectorAll('.js-edit-text-entrance').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_editText.editable) return;
      const v = btn.dataset.val || 'none';
      const te = _ensureTe();
      te.entrance = v;
      _queueSave(scene.num || scene.id, { textEffect: { ...te } });
      _flushPendingSave();
      root.querySelectorAll('.js-edit-text-entrance').forEach(b => b.classList.toggle('active', b === btn));
      if (!_patchTextEffect()) _scheduleViewerFrameReRender();
    });
  });
  /* 본문 표시 효과 */
  root.querySelectorAll('.js-edit-text-body-effect').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_editText.editable) return;
      const v = btn.dataset.val || 'none';
      const te = _ensureTe();
      te.body = v;
      _queueSave(scene.num || scene.id, { textEffect: { ...te } });
      _flushPendingSave();
      root.querySelectorAll('.js-edit-text-body-effect').forEach(b => b.classList.toggle('active', b === btn));
      if (!_patchTextEffect()) _scheduleViewerFrameReRender();
    });
  });
}

/* REFINE-IA-2: 팝오버 본문 재렌더+재바인딩(탭 전환·override 변경 후 칩/active 갱신). 열려있을 때만. */
function _rerenderSceneStylePopover() {
  const pop = _sceneStylePopoverEl();
  if (!pop || pop.hidden) return;
  pop.innerHTML = _renderSceneStylePopoverBody();
  _bindSceneStylePopover(pop);
  _positionSceneStylePopover(pop);
}

/* REFINE-IA-2: '이야기 전체' 탭 — 작품 기본값 저장(saveProjectTextDefaults). weight/효과는 범위 밖.
   '테마 기본 글씨체'('' / 'auto')·'기본' 색 = 작품 기본값에서 해당 항목 비움. */
function _bindProjectTextDefaultsActions(root) {
  if (!root) return;
  const _save = (patch) => {
    if (typeof saveProjectTextDefaults === 'function') {
      Promise.resolve(saveProjectTextDefaults(patch)).catch(() => {});
    }
    if (!_patchTextStyle()) _scheduleViewerFrameReRender();
    else _scheduleViewerFrameReRender();
  };
  root.querySelectorAll('.js-edit-text-font').forEach(sel => {
    sel.addEventListener('change', e => {
      if (!_editText.editable) return;
      const raw = e.target.value;
      const v = (raw && raw !== 'auto') ? raw : null;
      _save({ textStyle: { fontFamily: v } });
      _rerenderSceneStylePopover();
    });
  });
  root.querySelectorAll('.js-edit-text-size').forEach(slider => {
    slider.addEventListener('input', e => {
      if (!_editText.editable) return;
      const v = parseInt(e.target.value, 10);
      if (isNaN(v)) return;
      const ln = slider.closest('.edit-row')?.querySelector('.edit-label-note');
      if (ln) ln.textContent = `(${v}px)`;
      _save({ textStyle: { fontSize: v } });
    });
    slider.addEventListener('change', () => { if (_editText.editable) _rerenderSceneStylePopover(); });
  });
  root.querySelectorAll('.js-edit-text-color').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_editText.editable) return;
      _save({ textStyle: { color: btn.dataset.val || '' } });
      _rerenderSceneStylePopover();
    });
  });
  root.querySelectorAll('.js-edit-text-color-pick').forEach(input => {
    input.addEventListener('change', e => {
      if (!_editText.editable) return;
      _save({ textStyle: { color: e.target.value } });
      _rerenderSceneStylePopover();
    });
  });
  root.querySelectorAll('.js-edit-text-theme').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_editText.editable) return;
      _save({ textTheme: btn.dataset.val || 'classic' });
      _rerenderSceneStylePopover();
    });
  });
}

/* REFINE-IA-2: '이 장면만' 탭 — 항목별 "기본값" 칩(해당 override 제거) + 전체 되돌리기(테마+글자 override 제거).
   본문/선택지/연결/효과 데이터는 건드리지 않음. DB는 leaf remove(null). */
function _bindSceneStyleResetActions(root, scene) {
  if (!root || !scene) return;
  const _variantBlocked = () => {
    if (typeof _isVariantViewLocked === 'function' && _isVariantViewLocked()) {
      if (typeof _showSaveStatus === 'function') _showSaveStatus('AI 버전은 보기 전용입니다. 편집은 원본에서 해 주세요.', 2500);
      return true;
    }
    return false;
  };
  root.querySelectorAll('.js-scene-style-reset-field').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_editText.editable) return;
      if (_variantBlocked()) return;
      const field = btn.dataset.field;
      if (field === 'theme') {
        delete scene.textTheme;
        scene.textThemeOverride = false;   /* marker 해제 → 작품 기본값 따름 */
        _queueSave(scene.num || scene.id, { textTheme: null, textThemeOverride: false });
        _flushPendingSave();
        if (!_patchTextTheme()) _scheduleViewerFrameReRender();
      } else {
        const o = (scene.textStyleRaw && typeof scene.textStyleRaw === 'object')
          ? scene.textStyleRaw
          : ((typeof _sparseTextStyleOverride === 'function') ? (_sparseTextStyleOverride(scene.textStyle) || {}) : {});
        delete o[field];
        scene.textStyleRaw = o;
        scene.textStyle = { ...o };
        if (scene.textStyleOverride && typeof scene.textStyleOverride === 'object') delete scene.textStyleOverride[field];
        const m = scene.textStyleOverride || {};
        _queueSave(scene.num || scene.id, { textStyle: { ...o }, textStyleOverride: { ...m } });
        _flushPendingSave();
        if (!_patchTextStyle()) _scheduleViewerFrameReRender();
      }
      _rerenderSceneStylePopover();
    });
  });
  const resetAll = root.querySelector('.js-scene-style-reset-all');
  if (resetAll) {
    resetAll.addEventListener('click', () => {
      if (!_editText.editable) return;
      if (_variantBlocked()) return;
      const ok = window.confirm('이 장면의 꾸미기만 이야기 전체 기본값으로 되돌릴까요?\n글 내용과 선택지는 그대로예요.');
      if (!ok) return;
      delete scene.textTheme;
      scene.textThemeOverride = false;
      scene.textStyleRaw = {};
      scene.textStyle = {};
      scene.textStyleOverride = {};
      _queueSave(scene.num || scene.id, { textTheme: null, textStyle: null, textStyleOverride: null, textThemeOverride: false });
      _flushPendingSave();
      if (!_patchTextTheme()) _scheduleViewerFrameReRender();
      if (!_patchTextStyle()) _scheduleViewerFrameReRender();
      _rerenderSceneStylePopover();
    });
  }

  /* STYLE-PROMOTE-1(2026-07-10): 승격 — 현재 장면의 resolved 글자 모양을 작품 기본값으로.
     비평 반영: ①정직한 소급 문구(앞 장면 포함) ②직접 꾸민 장면 수 표시+보존 ③weight 제외(장면별 유지)
     ④승격한 현재 장면은 예외(marker) 해제 → 기본값 자체를 따르게(weight 예외만 유지). */
  const promote = root.querySelector('.js-scene-style-promote');
  if (promote) {
    promote.addEventListener('click', async () => {
      if (!_editText.editable) return;
      if (_variantBlocked()) return;
      if (typeof getTextStyle !== 'function' || typeof saveProjectTextDefaults !== 'function') return;
      const resolved = getTextStyle(scene);
      const theme = (typeof getTextTheme === 'function') ? getTextTheme(scene) : null;
      const all = (ViewerState && ViewerState.scenes) ? Object.values(ViewerState.scenes) : [];
      const marked = all.filter(s => {
        if (!s || s.type === 'cover' || String(s.id) === String(scene.id)) return false;
        const m = (s.textStyleOverride && typeof s.textStyleOverride === 'object') ? s.textStyleOverride : {};
        return !!(s.textThemeOverride || m.fontFamily || m.fontSize || m.color);
      }).length;
      const ok = await showViewerConfirm({
        title: '이야기 전체 기본으로 할까요?',
        message: '지금 장면의 글자 모양(테마·글씨체·크기·색)이 이야기 전체의 기본값이 돼요.\n앞 장면을 포함해 기본값을 따르는 모든 장면과 새 장면, 엔딩이 이 모양으로 바뀌어요.'
          + (marked ? ('\n직접 다르게 꾸민 장면 ' + marked + '개는 그대로 둬요.') : '')
          + '\n(글자 굵기는 장면마다 따로 유지돼요)',
        confirmText: '전체 기본으로',
      });
      if (!ok) return;
      try {
        await saveProjectTextDefaults({
          textTheme: theme,
          textStyle: {
            fontFamily: resolved.fontFamily || null,   /* null=테마 기본 글씨체 sentinel */
            fontSize: resolved.fontSize,
            color: resolved.color || '',
          },
        });
        /* 현재 장면의 예외 해제 — 이제 기본값을 따름. weight 예외만 보존. */
        const hadWeightMarker = !!(scene.textStyleOverride && scene.textStyleOverride.weight);
        const weightVal = (scene.textStyleRaw && scene.textStyleRaw.weight !== undefined)
          ? scene.textStyleRaw.weight
          : (scene.textStyle && scene.textStyle.weight !== undefined ? scene.textStyle.weight : undefined);
        const sw = (hadWeightMarker && weightVal !== undefined) ? { weight: weightVal } : {};
        const mw = hadWeightMarker ? { weight: true } : {};
        delete scene.textTheme;
        scene.textThemeOverride = false;
        scene.textStyleRaw = { ...sw };
        scene.textStyle = { ...sw };
        scene.textStyleOverride = { ...mw };
        _queueSave(scene.num || scene.id, {
          textTheme: null,
          textThemeOverride: false,
          textStyle: Object.keys(sw).length ? sw : null,
          textStyleOverride: Object.keys(mw).length ? mw : null,
        });
        _flushPendingSave();
        if (!_patchTextTheme()) _scheduleViewerFrameReRender();
        if (!_patchTextStyle()) _scheduleViewerFrameReRender();
        _rerenderSceneStylePopover();
      } catch (e) {
        console.error('[STYLE-PROMOTE-1] 실패:', e);
        alert('전체 기본으로 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.');
      }
    });
  }
}

function _positionSceneStylePopover(pop) {
  const trigger = document.querySelector('.js-edit-scene-style-popover');
  if (!trigger) return;
  const r = trigger.getBoundingClientRect();
  pop.style.top = (r.bottom + 8) + 'px';
  /* POPOVER-NOSCROLL(2026-07-11): 트리거 아래 남은 화면 높이를 전부 허용 —
     내용이 그보다 짧으면 그만큼만(스크롤 0), 길면 그 안에서만 스크롤(안전망). */
  pop.style.maxHeight = Math.max(240, window.innerHeight - r.bottom - 20) + 'px';
  const popW = pop.offsetWidth || 320;
  let left = r.left;
  const maxLeft = window.innerWidth - popW - 12;
  if (left > maxLeft) left = Math.max(12, maxLeft);
  pop.style.left = left + 'px';
}

function _openSceneStylePopover() {
  const pop = _sceneStylePopoverEl();
  if (!pop) return;
  const scene = ViewerState.scenes[ViewerState.currentSceneId];
  if (!scene || scene.type === 'cover' || scene.isCover) return;
  /* 상호배타: 다른 팝오버가 열려 있으면 닫음(동시 노출 방지). */
  if (typeof _closeChoicePopover === 'function') _closeChoicePopover();
  if (typeof _closeCoverPopover === 'function') _closeCoverPopover();
  if (typeof _closeProjectPopover === 'function') _closeProjectPopover();
  if (typeof _closeImagePopover === 'function') _closeImagePopover();
  pop.innerHTML = _renderSceneStylePopoverBody();
  pop.hidden = false;
  _bindSceneStylePopover(pop);
  _positionSceneStylePopover(pop);
  document.querySelector('.js-edit-scene-style-popover')?.classList.add('is-active');
  setTimeout(() => {
    document.addEventListener('click', _sceneStylePopoverOutside, true);
    document.addEventListener('keydown', _sceneStylePopoverEsc, true);
  }, 0);
}

function _closeSceneStylePopover() {
  const pop = _sceneStylePopoverEl();
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  pop.innerHTML = '';
  pop.style.left = '';
  pop.style.top  = '';
  pop.style.maxHeight = '';   /* POPOVER-NOSCROLL: 인라인 높이 초기화 */
  document.querySelector('.js-edit-scene-style-popover')?.classList.remove('is-active');
  document.removeEventListener('click', _sceneStylePopoverOutside, true);
  document.removeEventListener('keydown', _sceneStylePopoverEsc, true);
}

function _toggleSceneStylePopover() {
  const pop = _sceneStylePopoverEl();
  if (!pop) return;
  if (pop.hidden) _openSceneStylePopover();
  else _closeSceneStylePopover();
}

function _sceneStylePopoverOutside(e) {
  const pop = _sceneStylePopoverEl();
  if (!pop || pop.hidden) return;
  if (pop.contains(e.target)) return;
  /* 트리거 클릭은 토글 핸들러가 처리 — 여기서 닫지 않음(이중 토글 방지). */
  if (e.target.closest && e.target.closest('.js-edit-scene-style-popover')) return;
  _closeSceneStylePopover();
}

function _sceneStylePopoverEsc(e) {
  if (e.key === 'Escape') _closeSceneStylePopover();
}

/* ================================================================
   MOVIE-TOOL-1A/1B/1C: "🎬 무비" 도구 모달 (셸 + 본문 ON/OFF + 영상)
   ─────────────────────────────────────────────────────────────
   · movie 비표지 장면의 영상·본문 표시 설정. 1A/1B는 본문 ON/OFF, 1C는 영상 업로드/교체/삭제.
   · 영상(1C): 우측 js-movie-video-upload/-delete와 동일 경로(Storage 함수 무수정 호출).
     progress/error는 모달 섹션-scoped, 성공/삭제 후 renderEditPanel 대신 섹션 self-refresh.
   · 본문 ON/OFF: 우측 js-movie-body-enabled 핸들러와 동일 경로(scene.bodyEnabled + _queueSave +
     active 토글 + 프레임 재렌더). renderEditPanel 미호출. modal root scope 바인딩(우측과 분리).
   · 모달은 #movie-tool-modal(#edit-panel 밖). 우측 핸들러·우측 row 무수정.
   ================================================================ */
function _closeMovieToolModal() {
  const m = document.getElementById('movie-tool-modal');
  if (m && m.parentNode) m.parentNode.removeChild(m);
  document.removeEventListener('keydown', _movieToolModalEsc, true);
}

function _movieToolModalEsc(e) {
  if (e.key === 'Escape') _closeMovieToolModal();
}

function _openMovieToolModal(scene) {
  if (!scene || scene.type === 'cover' || scene.isCover) return;
  if (document.getElementById('movie-tool-modal')) return;
  /* 본문 사용 상태 — 우측 _typeSectionMovieHtml과 동일 산출. */
  const bodyEnabled = (scene.bodyEnabled === true) ? true
                    : (scene.bodyEnabled === false) ? false
                    : !!(scene.body && String(scene.body).trim());
  const modal = document.createElement('div');
  modal.id = 'movie-tool-modal';
  modal.className = 'movie-tool-modal';
  modal.innerHTML = `
    <div class="movie-tool-backdrop js-movie-tool-close"></div>
    <div class="movie-tool-dialog" role="dialog" aria-label="무비 도구">
      <div class="movie-tool-head">
        <span class="movie-tool-title">🎬 무비 도구</span>
        <button type="button" class="movie-tool-close js-movie-tool-close" title="닫기" aria-label="닫기">✕</button>
      </div>
      <div class="movie-tool-body">
        <p class="movie-tool-note">이 장면의 영상과 본문 표시를 설정해요.</p>
        <div class="movie-tool-section">
          <div class="movie-tool-section-title">📝 본문 표시</div>
          <div class="edit-toggle-group">
            <button type="button" class="edit-toggle js-movie-body-enabled ${bodyEnabled ? 'active' : ''}" data-val="on">📝 본문 사용</button>
            <button type="button" class="edit-toggle js-movie-body-enabled ${!bodyEnabled ? 'active' : ''}" data-val="off">— 본문 없음</button>
          </div>
          <div class="movie-tool-hint">본문을 함께 보여줄지 정해요.</div>
        </div>
        <div class="movie-tool-section">
          <div class="movie-tool-section-title">🎬 영상</div>
          <div class="movie-tool-video-section">${_movieToolVideoSectionInner(scene)}</div>
          <div class="movie-tool-hint">mp4 영상을 올려 무비 장면에 보여줄 수 있어요.</div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelectorAll('.js-movie-tool-close').forEach(el => {
    el.addEventListener('click', _closeMovieToolModal);
  });
  _bindMovieToolModalActions(modal, scene);
  setTimeout(() => { document.addEventListener('keydown', _movieToolModalEsc, true); }, 0);
}

/* MOVIE-TOOL-1B: 모달 전용 본문 ON/OFF 바인딩 — 우측 js-movie-body-enabled 핸들러와 동일 경로.
   active 토글은 modal root scope, renderEditPanel 미호출. 우측 핸들러 무수정. 새 저장 로직 X. */
function _bindMovieToolModalActions(modal, scene) {
  if (!modal || !scene) return;
  modal.querySelectorAll('.js-movie-body-enabled').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_editText.editable) return;
      const enabled = btn.dataset.val === 'on';
      scene.bodyEnabled = enabled;
      _queueSave(scene.num || scene.id, { bodyEnabled: enabled });
      _flushPendingSave();
      modal.querySelectorAll('.js-movie-body-enabled').forEach(b => {
        b.classList.toggle('active', (b.dataset.val === 'on') === enabled);
      });
      if (typeof _scheduleViewerFrameReRender === 'function') _scheduleViewerFrameReRender();
    });
  });
  /* MOVIE-TOOL-1C: 영상 업로드/교체/삭제 */
  _bindMovieToolVideoActions(modal, scene);
}

/* MOVIE-TOOL-1C: 모달 영상 섹션 내부 HTML — 우측 edit-movie-video-section과 동일 구조/클래스
   (CSS·progress·error 그대로 재사용). hasVideo로 업로드↔교체 라벨 + 삭제 버튼 노출 결정. */
function _movieToolVideoSectionInner(scene) {
  const md = (typeof getMovieData === 'function') ? getMovieData(scene) : (scene.movieData || {});
  const hasVideo = !!(md && md.videoUrl);
  return `
    <div class="edit-toggle-group">
      <button type="button" class="edit-toggle js-movie-video-upload">${hasVideo ? '🎬 영상 교체' : '🎬 영상 업로드'}</button>
      ${hasVideo ? `<button type="button" class="edit-toggle js-movie-video-delete">🗑 영상 삭제</button>` : ''}
    </div>
    <div class="js-movie-video-progress edit-movie-progress" style="display:none;">
      <div class="edit-movie-progress-bar"><div class="edit-movie-progress-fill js-movie-progress-fill"></div></div>
      <div class="edit-movie-progress-text js-movie-progress-text">업로드 중… 0%</div>
    </div>
    <div class="js-movie-video-error edit-movie-error" style="display:none;"></div>`;
}

/* MOVIE-TOOL-1C: 모달 전용 영상 업로드/교체/삭제 바인딩.
   · 로직은 우측 js-movie-video-upload/-delete 핸들러와 동일 경로(viewerUploadVideoToStorage·
     viewerDeleteVideoFromStorage·_queueSave·_flushPendingSave 무수정 호출).
   · 차이: progress/error를 모달 .movie-tool-video-section 내부로 scope, 성공/삭제 후
     renderEditPanel 대신 섹션 self-refresh(_movieToolVideoSectionInner 재렌더 + 재바인딩).
   · 우측 핸들러·우측 row 무수정. */
function _bindMovieToolVideoActions(modal, scene) {
  const section = modal && modal.querySelector('.movie-tool-video-section');
  if (!section) return;
  function refresh() {
    section.innerHTML = _movieToolVideoSectionInner(scene);
    _bindMovieToolVideoActions(modal, scene);
  }

  /* 업로드/교체 */
  section.querySelectorAll('.js-movie-video-upload').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_editText.editable) return;
      const errEl  = section.querySelector('.js-movie-video-error');
      const progEl = section.querySelector('.js-movie-video-progress');
      const fillEl = section.querySelector('.js-movie-progress-fill');
      const textEl = section.querySelector('.js-movie-progress-text');
      function showErr(msg) {
        if (!errEl) { alert(msg); return; }
        errEl.textContent = '⚠ ' + msg;
        errEl.style.display = 'block';
        setTimeout(() => { errEl.style.display = 'none'; }, 6000);
      }
      function hideProgress() {
        if (progEl) progEl.style.display = 'none';
      }

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'video/mp4,video/*';
      fileInput.style.display = 'none';
      fileInput.addEventListener('change', async e => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (typeof viewerUploadVideoToStorage !== 'function') {
          showErr('영상 업로드가 활성화되지 않았어요. 페이지를 새로고침해주세요.');
          return;
        }

        /* 크롬북 호환성 경고 — HEVC(아이폰 고효율) 영상은 크롬북에서 화면이 안 나온다.
           올리기 전에 감지해 안내하고, 그래도 올릴지 물어본다. */
        try {
          if (await _viewerVideoIsHevc(file)) {
            const goOn = await showViewerConfirm({
              title: '크롬북에서 안 보일 수 있는 영상이에요',
              message: '이 영상은 아이폰 "고효율(H.265)" 형식이라, 크롬북·태블릿에서는 화면이 안 나오고 소리만 날 수 있어요.\n\n아이폰에서 [설정 → 카메라 → 포맷 → "높은 호환성"]으로 바꿔 다시 찍거나, H.264(mp4)로 변환해서 올리면 어느 기기에서든 잘 보여요.\n\n그래도 이 영상을 올릴까요?',
              confirmText: '그래도 올리기',
              danger: false,
            });
            if (!goOn) return;
          }
        } catch (e) { /* 감지 실패해도 업로드는 계속 */ }

        if (progEl) {
          progEl.style.display = 'block';
          if (fillEl) fillEl.style.width = '0%';
          if (textEl) textEl.textContent = '업로드 준비 중…';
        }
        btn.disabled = true;
        btn.style.opacity = '0.5';

        try {
          const result = await viewerUploadVideoToStorage(file, (scene.num || scene.id), {
            onProgress: pct => {
              if (fillEl) fillEl.style.width = pct + '%';
              if (textEl) textEl.textContent = '업로드 중… ' + pct + '%';
            },
          });
          const _oldStoragePath = (scene.movieData && scene.movieData.videoStoragePath) || null;

          if (!scene.movieData || typeof scene.movieData !== 'object') {
            scene.movieData = { videoUrl: null, posterImage: null, captionMode: 'overlay', choiceReveal: 'end' };
          }
          scene.movieData.videoUrl = result.downloadURL;
          scene.movieData.videoStoragePath = result.storagePath;
          _queueSave(scene.num || scene.id, { movieData: { ...scene.movieData } });
          _flushPendingSave();
          if (textEl) textEl.textContent = '✓ 업로드 완료';

          if (_oldStoragePath && _oldStoragePath !== result.storagePath &&
              typeof viewerDeleteVideoFromStorage === 'function') {
            viewerDeleteVideoFromStorage(_oldStoragePath);
          }

          setTimeout(() => {
            refresh();
            if (typeof _scheduleViewerFrameReRender === 'function') _scheduleViewerFrameReRender();
          }, 600);
        } catch (err) {
          hideProgress();
          const msg = (err && err.message) ? err.message : '업로드에 실패했어요.';
          showErr(msg);
          btn.disabled = false;
          btn.style.opacity = '';
        }
      });
      document.body.appendChild(fileInput);
      fileInput.click();
      setTimeout(() => fileInput.remove(), 1000);
    });
  });

  /* 삭제 */
  section.querySelectorAll('.js-movie-video-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!_editText.editable) return;
      const ok = await showViewerConfirm({
        title: '영상을 삭제할까요?',
        message: '저장된 영상 파일도 함께 삭제될 수 있어요.',
        confirmText: '삭제하기',
        danger: true,
      });
      if (!ok) return;
      const md = scene.movieData || {};
      const storagePath = md.videoStoragePath || null;
      if (scene.movieData) {
        scene.movieData.videoUrl = null;
        scene.movieData.videoStoragePath = null;
      }
      _queueSave(scene.num || scene.id, { movieData: { ...scene.movieData } });
      _flushPendingSave();
      refresh();
      if (typeof _scheduleViewerFrameReRender === 'function') _scheduleViewerFrameReRender();
      if (storagePath && typeof viewerDeleteVideoFromStorage === 'function') {
        viewerDeleteVideoFromStorage(storagePath);
      }
    });
  });
}

/* ================================================================
   감상 테스트 복귀 배너
   ================================================================ */
function renderTestingBanner() {
  document.getElementById('edit-test-banner')?.remove();
  if (!ViewerState._testingEdit) return;

  const banner = document.createElement('div');
  banner.id    = 'edit-test-banner';
  banner.style.cssText = [
    'position:absolute', 'top:0', 'left:0', 'right:0', 'z-index:80',
    'background:rgba(30,40,64,0.92)', 'backdrop-filter:blur(6px)',
    'border-bottom:1.5px solid rgba(88,166,255,0.35)',
    'display:flex', 'align-items:center', 'justify-content:space-between',
    'padding:8px 16px', 'gap:12px',
  ].join(';');
  banner.innerHTML = `
    <span style="font-family:var(--font-ui,Jua,sans-serif);font-size:12px;color:rgba(88,166,255,0.9);">
      ▶️ 감상해 보는 중 — 실제 관람자 화면이에요
    </span>
    <button id="btn-edit-test-return"
      style="padding:5px 14px;border-radius:50px;border:1.5px solid rgba(88,166,255,0.5);
      background:rgba(88,166,255,0.15);color:#58a6ff;
      font-family:var(--font-ui,Jua,sans-serif);font-size:12px;cursor:pointer;white-space:nowrap;">
      ✏️ 다듬기로 돌아가기
    </button>`;

  const frame = document.getElementById('viewer-frame');
  if (frame) frame.appendChild(banner);

  banner.querySelector('#btn-edit-test-return').addEventListener('click', () => {
    ViewerState.editMode     = true;
    ViewerState._testingEdit = false;
    banner.remove();
    renderCurrentScene();
  });
}

/* ================================================================
   구조 미니맵 — 장면·선택·연결을 한눈에 보고 이동
   ─────────────────────────────────────────────────────────────
   · 구조 편집 아님 (navigation-only)
   · 노드: 원형 + 숫자
   · 현재 장면 accent 강조, 시작/엔딩 보조 색
   · 클릭 시 editNavigateTo() — 현재 장면 유지 로직 재사용
   ================================================================ */

/* ── depth 계산: BFS로 시작 장면부터 거리 산출 ──
   v39: cover scene이 있으면 그것이 graph root (depth 0). cover → entrySceneId는
   가상 엣지로 한 단계 밀어줌 (entry → depth 1). cover 없는 옛 작품은 기존 동작 유지. */
function _computeSceneDepths() {
  const scenes = ViewerState.scenes;
  const depths = {};
  const coverScene = Object.values(scenes).find(s => s && (s.type === 'cover' || s.isCover));
  const entryId   = ViewerState.project?.entrySceneId;
  const startScene = Object.values(scenes).find(s => s.isStart);

  /* root 결정: cover 우선 → isStart → 첫 장면 */
  const rootId = coverScene?.id || startScene?.id || _editSceneList()[0]?.id;
  if (!rootId) return depths;

  depths[rootId] = 0;
  const queue = [rootId];

  /* cover가 root면 cover → entry 가상 엣지로 entry를 depth 1에 배정 */
  if (coverScene && entryId && scenes[entryId] && entryId !== rootId && depths[entryId] == null) {
    depths[entryId] = 1;
    queue.push(entryId);
  }

  while (queue.length > 0) {
    const currentId = queue.shift();
    const current   = scenes[currentId];
    if (!current) continue;

    const nextIds = (current.choices || [])
      .map(c => c.nextId)
      .filter(nid => nid && scenes[nid]);

    nextIds.forEach(nid => {
      if (depths[nid] == null) {
        depths[nid] = depths[currentId] + 1;
        queue.push(nid);
      }
    });
  }

  /* 시작점에서 도달 불가능한 고립 장면 — 최대 depth + 1에 배치 */
  const maxDepth = Math.max(0, ...Object.values(depths));
  Object.values(scenes).forEach(s => {
    if (depths[s.id] == null) depths[s.id] = maxDepth + 1;
  });

  return depths;
}

/* ── 레이아웃 계산: depth별 열, 같은 depth 내 id순 정렬 ── */
function _computeMapLayout() {
  const scenes = ViewerState.scenes;
  const depths = _computeSceneDepths();

  /* depth별 그룹화 */
  const byDepth = {};
  Object.values(scenes).forEach(s => {
    const d = depths[s.id] ?? 0;
    if (!byDepth[d]) byDepth[d] = [];
    byDepth[d].push(s);
  });

  /* 각 depth 그룹 내 정렬: 시작 먼저, 엔딩 마지막, 그 외는 id 오름차순
     이 정렬 덕에 연결선이 덜 교차되고 시각적으로 자연스러움 */
  Object.values(byDepth).forEach(group => {
    group.sort((a, b) => {
      const rank = s => (s.isStart ? 0 : s.isEnding ? 2 : 1);
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      return Number(a.id) - Number(b.id);
    });
  });

  const depthKeys = Object.keys(byDepth).map(Number).sort((a, b) => a - b);
  const maxRows   = Math.max(...Object.values(byDepth).map(g => g.length), 1);

  /* 열 간격: depth 개수가 많으면 살짝 좁히고, 적으면 넓게 */
  const COL_W    = depthKeys.length > 6 ? 115 : 135;
  /* 행 간격: 노드 많을수록 촘촘하게 (최소 70, 최대 90) */
  const ROW_H    = maxRows > 6 ? 70 : (maxRows > 3 ? 82 : 90);
  const MARGIN_X = 70;
  const MARGIN_Y = 60;

  /* 전체 세로 공간 기준 — maxRows 기준의 총 세로 길이 */
  const totalColH = (maxRows - 1) * ROW_H;

  const positions = {};

  depthKeys.forEach((d, colIdx) => {
    const group     = byDepth[d];
    const rows      = group.length;
    const groupH    = (rows - 1) * ROW_H;
    /* 이 depth 그룹의 세로 시작 y — 전체 높이의 중앙에 정렬 */
    const startY    = MARGIN_Y + (totalColH - groupH) / 2;

    group.forEach((scene, rowIdx) => {
      positions[scene.id] = {
        x: MARGIN_X + colIdx * COL_W,
        y: startY + rowIdx * ROW_H,
        depth: d,
      };
    });
  });

  const width  = MARGIN_X * 2 + Math.max(0, depthKeys.length - 1) * COL_W;
  const height = MARGIN_Y * 2 + totalColH;

  return { positions, width, height };
}

/* ── 미니맵 열기 ── */
function openStructureMap() {
  /* 기존 오버레이 제거 (toggle 성격) */
  const existing = document.getElementById('structure-map-overlay');
  if (existing) { existing.remove(); return; }

  const overlay = document.createElement('div');
  overlay.id    = 'structure-map-overlay';
  overlay.className = 'structure-map-overlay';
  overlay.innerHTML = `
    <div class="structure-map-panel">
      <div class="structure-map-header">
        <h3 class="structure-map-title">🔍 장면 구조</h3>
        <div class="structure-map-hint">노드를 누르면 해당 장면으로 이동해요</div>
        <button class="structure-map-close js-structure-map-close" title="닫기">✕</button>
      </div>
      <div class="structure-map-legend">
        <span class="structure-map-legend-item">
          <span class="structure-map-dot structure-map-dot--cover"></span>표지
        </span>
        <span class="structure-map-legend-item">
          <span class="structure-map-dot structure-map-dot--start"></span>시작
        </span>
        <span class="structure-map-legend-item">
          <span class="structure-map-dot structure-map-dot--normal"></span>일반
        </span>
        <span class="structure-map-legend-item">
          <span class="structure-map-dot structure-map-dot--ending"></span>엔딩
        </span>
        <span class="structure-map-legend-item">
          <span class="structure-map-dot structure-map-dot--current"></span>현재
        </span>
      </div>
      <div class="structure-map-body js-structure-map-body"></div>
    </div>`;

  document.body.appendChild(overlay);

  /* 닫기 — ✕ 버튼 + 배경 클릭 */
  overlay.querySelector('.js-structure-map-close')?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove();
  });

  renderStructureMap();
}

/* ── 미니맵 SVG 렌더 (상태 변화 시 다시 호출 가능) ── */
function renderStructureMap() {
  const body = document.querySelector('.js-structure-map-body');
  if (!body) return;

  const scenes  = ViewerState.scenes;
  const layout  = _computeMapLayout();
  const { positions, width, height } = layout;
  const currentId = ViewerState.currentSceneId;

  const NODE_R = 22;

  /* 연결선 path 데이터 생성 */
  const edges = [];
  Object.values(scenes).forEach(scene => {
    const src = positions[scene.id];
    if (!src) return;
    (scene.choices || []).forEach(choice => {
      const dst = positions[choice.nextId];
      if (!dst) return;

      /* bezier curve — 수평 방향 중심 */
      const dx = dst.x - src.x;
      const c1x = src.x + dx * 0.5;
      const c1y = src.y;
      const c2x = dst.x - dx * 0.5;
      const c2y = dst.y;

      edges.push(`<path d="M${src.x},${src.y} C${c1x},${c1y} ${c2x},${c2y} ${dst.x},${dst.y}"
        class="structure-map-edge" />`);
    });
  });

  /* v39: cover → entrySceneId 가상 엣지 (보라 강조). 본문 흐름 엣지가
     아니라 "표지에서 작품이 시작된다"는 의미적 연결. */
  const coverScene = Object.values(scenes).find(s => s && (s.type === 'cover' || s.isCover));
  const entryId    = ViewerState.project?.entrySceneId;
  if (coverScene && entryId && scenes[entryId]) {
    const src = positions[coverScene.id];
    const dst = positions[entryId];
    if (src && dst) {
      const dx = dst.x - src.x;
      const c1x = src.x + dx * 0.5;
      const c1y = src.y;
      const c2x = dst.x - dx * 0.5;
      const c2y = dst.y;
      edges.push(`<path d="M${src.x},${src.y} C${c1x},${c1y} ${c2x},${c2y} ${dst.x},${dst.y}"
        class="structure-map-edge structure-map-edge--cover" />`);
    }
  }

  /* 노드 렌더 */
  const nodes = Object.values(scenes).map(scene => {
    const pos = positions[scene.id];
    if (!pos) return '';

    let typeClass = 'structure-map-node--normal';
    if (scene.isStart)  typeClass = 'structure-map-node--start';
    if (scene.isEnding) typeClass = 'structure-map-node--ending';
    /* v37: 표지 scene — 보라 톤 노드 */
    if (scene.isCover || scene.type === 'cover') typeClass = 'structure-map-node--cover';
    const isCurrent = scene.id === currentId;

    const title = scene.title ? escHtml(scene.title) : `장면 ${scene.id}`;

    return `
      <g class="structure-map-node-group ${isCurrent ? 'is-current' : ''}"
         data-scene-id="${escHtml(scene.id)}"
         transform="translate(${pos.x},${pos.y})">
        ${isCurrent ? `<circle r="${NODE_R + 6}" class="structure-map-node-halo"/>` : ''}
        <circle r="${NODE_R}" class="structure-map-node ${typeClass} ${isCurrent ? 'is-current' : ''}"/>
        <text class="structure-map-node-label" text-anchor="middle" dominant-baseline="central">${escHtml(scene.id)}</text>
        <title>${title}</title>
      </g>`;
  }).join('');

  body.innerHTML = `
    <svg class="structure-map-svg"
         viewBox="0 0 ${width} ${height}"
         preserveAspectRatio="xMidYMid meet"
         xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="structure-map-arrow" viewBox="0 0 10 10" refX="9" refY="5"
          markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="rgba(88,166,255,0.55)"/>
        </marker>
        <marker id="structure-map-arrow-cover" viewBox="0 0 10 10" refX="9" refY="5"
          markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="rgba(155,109,202,0.75)"/>
        </marker>
      </defs>
      <g class="structure-map-edges">${edges.join('')}</g>
      <g class="structure-map-nodes">${nodes}</g>
    </svg>`;

  /* 노드 클릭 — editNavigateTo로 이동 + 미니맵 자동 닫힘
     장면 이동 후 바로 편집에 집중할 수 있도록 오버레이를 닫음 */
  body.querySelectorAll('.structure-map-node-group').forEach(g => {
    g.addEventListener('click', () => {
      const sid = g.dataset.sceneId;
      if (!sid) return;
      /* 같은 장면 클릭 시에도 미니맵은 닫아줌 (사용자 의도가 탐색 종료일 가능성) */
      if (sid === ViewerState.currentSceneId) {
        document.getElementById('structure-map-overlay')?.remove();
        return;
      }
      editNavigateTo(sid);
      /* 미니맵 닫기 — 이동 후 편집 화면으로 즉시 전환 */
      document.getElementById('structure-map-overlay')?.remove();
    });
  });
}

/* ════════════════════════════════════════════════════
   W8 Phase D-1: 다듬기 패널 탭 (시각만 — 데이터 흐름 0% 영향)
   ─────────────────────────────────────────────────────
   탭 헤더 클릭 시 .edit-tab-panel의 .is-on 토글.
   모든 섹션은 DOM에 존재 (저장 흐름·input 이벤트 영향 0).
   ════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════
   W8 Phase D-2: 모드별 탭 구성 (이름·아이콘·우선순위)
   ─────────────────────────────────────────────────────
   반환: [{ key, label, html(scene, ptype) }, ...]
   첫 항목이 기본 활성 탭 — 모드별 가장 중요한 영역 먼저.

   · 텍스트형: 📝 내용 → 🎨 스타일·테마·효과 → (선택지)
   · 그림책형: 🎨 그림 → 📝 내용 → (선택지)
   · 무비형:   🎬 영상 → 📝 내용 → (선택지)
   · 체험전시: 🗺️ 배경·연결 → 📝 내용 → (선택지)

   원칙: '내용'은 _textEditHtml, '모드'는 _typeSectionsHtml.
   같은 함수 두 번 호출 = 같은 input element 두 벌이라 ID 충돌 위험.
   → '내용'은 항상 _textEditHtml, '모드'는 항상 _typeSectionsHtml.
     순서만 모드별로 다르게.
   ════════════════════════════════════════════════════ */

/* 재렌더 후 활성 탭 복원. 이전 탭이 새 구성에 없으면 그대로(첫 탭 활성). */

/* ════════════════════════════════════════════════════
   W8: 그림책 글자 스타일 부분 패치
   ─────────────────────────────────────────────────────
   .scene-screen--pb의 CSS 변수만 갱신. 통째 재렌더 회피 (포커스/이미지 보호).
   변수 이름: --pb-font-family / --pb-fs-body / --pb-color-override / --pb-fw-body
   ════════════════════════════════════════════════════ */
function _patchPbStyle() {
  const screen = _getSceneScreen();
  if (!screen || !screen.classList.contains('scene-screen--pb')) return false;
  const scene = ViewerState.scenes[ViewerState.currentSceneId];
  if (!scene) return false;
  const style = (typeof getTextStyle === 'function') ? getTextStyle(scene) : (scene.textStyle || {});
  const fontMap = (typeof TEXT_FONT_FAMILIES === 'object') ? TEXT_FONT_FAMILIES : {};
  if (style.fontFamily && fontMap[style.fontFamily]) {
    screen.style.setProperty('--pb-font-family', fontMap[style.fontFamily]);
  }
  if (typeof style.fontSize === 'number') {
    screen.style.setProperty('--pb-fs-body', style.fontSize + 'px');
  }
  if (style.color) {
    screen.style.setProperty('--pb-color-override', style.color);
  } else {
    screen.style.removeProperty('--pb-color-override');
  }
  if (style.weight === 'bold') {
    screen.style.setProperty('--pb-fw-body', '700');
  } else {
    screen.style.setProperty('--pb-fw-body', '400');
  }
  return true;
}

/* ════════════════════════════════════════════════════
   W8 Phase: 바로 그리기 모달
   ─────────────────────────────────────────────────────
   캔버스에 직접 그려서 scene.imageData 저장.
   기능: 펜(굵기·색) / 지우개 / 전체 지우기 / Undo / 저장 / 취소
   터치 + 마우스 + 펜 모두 지원 (Pointer Events).

   비율: A4 가로 (1600 × 1200) 기본. 충분한 해상도.
   여백·색 팔레트는 시안 따뜻한 톤.
   ════════════════════════════════════════════════════ */
function _openPbDrawModal(scene, opts) {
  /* 이미 열려있으면 무시 */
  if (document.getElementById('pb-draw-modal')) return;
  /* LEVEL2-CHAR(2026-07-21): opts.saveOverride(url) 있으면 장면 저장 흐름 대신 작품 단위 저장
     (우리 주인공 그리기). opts.title로 헤더 문구 교체. scene은 캔버스 비율/배경용 껍데기 허용. */
  opts = opts || {};

  /* v36: 캔버스 비율을 활성 scene의 실제 그림 영역(.pb-illust)에서 측정.
     4가지 모드(가로/세로 × 분할/그림중심) 모두 자동 일치.
     해상도 1800 → 1200 (v36 태블릿): 태블릿 CPU에서 putImageData/getImageData/flood fill
     빠르게. 디테일 충분 + 메모리·성능 균형. */
  const submode = scene.picturebookSubmode === 'imageCenter' ? 'imageCenter' : 'split';
  /* CROSS-B(2026-07-10): 고배율 데스크톱(윈도우 125~150%·맥 레티나)에서 선이 흐릿 —
     백킹스토어를 DPR에 비례해 상향(상한 1.5배=1800px, v36이 태블릿 성능 때문에 내리기 전 값).
     터치 기기(any-pointer:coarse)는 v36 성능 판단(putImageData/flood fill) 존중해 1200 유지.
     좌표는 _pos()가 rect 비율 기반이라 해상도 변경에 안전. */
  const _drawDpr = (window.matchMedia && matchMedia('(any-pointer: coarse)').matches)
    ? 1 : Math.max(1, Math.min(1.5, window.devicePixelRatio || 1));
  let canvasW = Math.round(1200 * _drawDpr);
  /* DRAW-CANVAS-3-2(2026-07-09): imageCenter 가로 감상 스테이지가 뷰어 개편(stagefill)으로 3:2로 꽉 채워짐
     → 그리기 캔버스도 3:2(1200×800)로 정합(AI 그림 3:2와 동일). 옛 ≈1.90(632)은 스테이지가 좁던 시절 값.
     split은 기존 landscape 근사 ≈2.376 → 505 유지(감상 cover). */
  let canvasH = Math.round(canvasW / (submode === 'imageCenter' ? 1.5 : 2.376)); /* CROSS-B: W 비례(1200일 때 800/505와 동일) */
  const illustEl = document.querySelector(
    submode === 'imageCenter'
      ? '.scene-screen--pb.pb--imagecenter .pb-illust'
      : '.scene-screen--pb.pb--split .pb-illust'
  );
  if (illustEl) {
    const rect = illustEl.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      let ratio = rect.width / rect.height;
      /* VIEWER-DRAW-FIT-1(2026-07-08): 캔버스를 '감상(play)에서 그림이 실제 놓일 박스' 종횡비에 맞춘다.
         (구 DRAWING-CANVAS-RATIO는 감상 '페이지' 3:2(1.5)를 겨냥했으나, 실제 표시 대상은 페이지가 아니라
          grid 8fr:2fr 상단 80% 행에서 pb-frame padding·gap을 뺀 '.pb-illust 박스'라 페이지보다 wide(≈1.90).
          그 미세 차이만큼 흰 배경 캔버스에 흰 letterbox 여백이 남아 그림이 '커져/넘쳐 보이는' 착시가 생겼다.
          표시는 contain(크롭 0)이라 이 박스 비율에 정확히 맞추면 흰 여백이 사라진다.)
         편집(A4)에서 그리기 진입하므로 감상 박스를 결정적으로 계산: 페이지 폭을 대표값으로 3:2 감상 페이지를
          가정하고 play padding(pb-frame 4·gap 6)·grid 상단 80%로 그림박스 종횡비를 낸다.
         · 좌표는 _pos()가 rect 스케일이라 내부 해상도 변경에 안전.
         · 세로 작품(portrait)은 감상도 세로 → 측정값 그대로 유지. split은 감상 cover라 유지(건드리면 crop).
         ⚠️ play padding(4/6)·grid(0.8)은 v03-modes.css와 동기화 값. CSS 변경 시 함께 조정. */
      /* DRAW-CANVAS-3-2(2026-07-09): imageCenter 가로는 감상 스테이지(.pb-illust inset:0)가 3:2로 꽉 채워지므로
         측정값·옛 box 계산(≈1.90·스테이지 좁던 시절 stale) 대신 3:2 확정 → 그리기와 표시가 정확히 일치.
         (portrait·split은 측정값 유지 — 감상 비율이 다름.) */
      if (submode === 'imageCenter'
          && document.body.getAttribute('data-page-orientation') !== 'portrait') {
        ratio = 1.5;
      }
      canvasH = Math.max(1, Math.round(canvasW / ratio));
    }
  }

  /* 색 팔레트 — 따뜻한 톤 8색 */
  const COLORS = [
    '#2b1f10',   /* 검정(잉크) */
    '#c66f4a',   /* 코랄 */
    '#c79550',   /* 골드 */
    '#5a8a4a',   /* sage */
    '#5a92c2',   /* sky */
    '#9b6dca',   /* 보라 */
    '#c0413e',   /* 빨강 */
    '#666666',   /* 회색 */
  ];
  const SIZES = [
    { id: 'thin',  label: '얇게', px: 2 },
    { id: 'med',   label: '보통', px: 5 },
    { id: 'thick', label: '굵게', px: 10 },
    { id: 'xl',    label: '크게', px: 18 },
  ];

  /* 기존 이미지 있으면 — 안내 후 배경으로 깔기 (사용자 요청: 덮어쓰기 자연) */
  const hasExistingImage = !!scene.imageData;

  /* 모달 마크업 */
  const modal = document.createElement('div');
  modal.id = 'pb-draw-modal';
  modal.className = 'pb-draw-modal';
  modal.innerHTML = `
    <div class="pb-draw-backdrop"></div>
    <div class="pb-draw-dialog" data-submode="${submode}">
      <div class="pb-draw-header">
        <h3 class="pb-draw-title">${opts.title ? escHtml(opts.title) : '✏️ 바로 그리기'} ${opts.title ? '' : `<span class="pb-draw-submode-hint">${submode === 'imageCenter' ? '(그림 중심형)' : '(분할형)'}</span>`}</h3>
        <button type="button" class="pb-draw-close js-pb-draw-cancel" title="취소">✕</button>
      </div>

      <!-- DRAWING-STUDIO-2-SIMPLE: 현재 도구 상태 1줄 — 학생이 지금 모드를 항상 알 수 있게 -->
      <div class="pb-draw-status js-pb-draw-status" role="status">지금은 ✏️ 펜으로 그리고 있어요.</div>

      <div class="pb-draw-toolbar">
        <!-- DRAWING-STUDIO-2-SIMPLE 간단 모드(기본): 펜·지우개·색·굵기·되돌리기·다시 + 도구 더보기.
             고급 도구는 아래 .pb-draw-adv로 이동(기능 삭제 아님 — 접기만). 핸들러는 클래스 기반이라 무변경. -->
        <div class="pb-draw-core">
          <div class="pb-draw-tools">
            <button type="button" class="pb-draw-tool js-pb-draw-tool is-on" data-tool="pen" title="자유롭게 그리기">✏️ 펜</button>
            <button type="button" class="pb-draw-tool js-pb-draw-tool" data-tool="eraser" title="지우기">🧽 지우개</button>
          </div>
          <div class="pb-draw-colors">
            ${COLORS.map((c, i) => `
              <button type="button" class="pb-draw-color js-pb-draw-color${i===0?' is-on':''}"
                data-color="${c}" style="background:${c};" title="${c}"></button>
            `).join('')}
            <input type="color" class="pb-draw-color-pick js-pb-draw-color-pick"
              value="${COLORS[0]}" title="자유 색 선택">
          </div>
          <div class="pb-draw-sizes">
            ${SIZES.map((s, i) => `
              <button type="button" class="pb-draw-size js-pb-draw-size${i===1?' is-on':''}"
                data-size="${s.px}" title="${s.label}">
                <span class="pb-draw-size-dot" style="width:${s.px}px;height:${s.px}px;"></span>
              </button>
            `).join('')}
          </div>
          <div class="pb-draw-actions">
            <button type="button" class="pb-draw-action js-pb-draw-undo" title="되돌리기 (Ctrl+Z)">↶ 되돌리기</button>
            <button type="button" class="pb-draw-action js-pb-draw-redo" title="다시 실행 (Ctrl+Shift+Z)">↷ 다시</button>
          </div>
          <button type="button" class="pb-draw-more-btn js-pb-draw-more" aria-expanded="false" title="도형·채우기·이동 같은 도구를 더 볼 수 있어요">🧰 도구 더보기</button>
        </div>

        <!-- 고급 도구(기본 접힘) — 기존 기능 전부 그대로, 노출만 접기 -->
        <div class="pb-draw-adv js-pb-draw-adv" hidden>
          <div class="pb-draw-tools">
            <button type="button" class="pb-draw-tool js-pb-draw-tool" data-tool="line" title="직선">📏 직선</button>
            <button type="button" class="pb-draw-tool js-pb-draw-tool" data-tool="rect" title="사각형">▭ 사각</button>
            <button type="button" class="pb-draw-tool js-pb-draw-tool" data-tool="circle" title="원">◯ 원</button>
            <button type="button" class="pb-draw-tool js-pb-draw-tool" data-tool="bucket" title="영역 채우기">🪣 채우기</button>
            <button type="button" class="pb-draw-tool js-pb-draw-tool" data-tool="eyedropper" title="캔버스에서 색 가져오기 — 클릭한 점의 색이 펜 색이 됩니다">💧 색 따기</button>
            <button type="button" class="pb-draw-tool js-pb-draw-tool" data-tool="pan" title="화면 이동 — 확대 후 다른 영역 보기">✋ 이동</button>
          </div>

          <!-- 확대·축소 (v37) -->
          <div class="pb-draw-section">
            <span class="pb-draw-section-label">확대</span>
            <div class="pb-draw-zoom">
              <button type="button" class="pb-draw-zoom-btn js-pb-draw-zoom-out" title="축소">−</button>
              <span class="pb-draw-zoom-val js-pb-draw-zoom-val">100%</span>
              <button type="button" class="pb-draw-zoom-btn js-pb-draw-zoom-in" title="확대">＋</button>
              <button type="button" class="pb-draw-zoom-btn js-pb-draw-zoom-reset" title="원래대로">↺</button>
            </div>
          </div>

          <!-- 펜 종류 (v36) -->
          <div class="pb-draw-section js-pb-draw-pentype-wrap">
            <span class="pb-draw-section-label">펜 종류</span>
            <div class="pb-draw-pentypes">
              <button type="button" class="pb-draw-pentype js-pb-draw-pentype is-on" data-pentype="normal" title="일반 펜">✒️ 일반</button>
              <button type="button" class="pb-draw-pentype js-pb-draw-pentype" data-pentype="marker" title="마커 (부드럽고 진함)">🖍 마커</button>
              <button type="button" class="pb-draw-pentype js-pb-draw-pentype" data-pentype="pencil" title="연필 (얇고 거침)">✏️ 연필</button>
              <button type="button" class="pb-draw-pentype js-pb-draw-pentype" data-pentype="crayon" title="크레용 (거친 질감)">🖌 크레용</button>
            </div>
          </div>

          <!-- 채움 토글 (v36) -->
          <div class="pb-draw-section">
            <label class="pb-draw-fill-label">
              <input type="checkbox" class="js-pb-draw-fill">
              <span>도형 채움</span>
            </label>
          </div>

          <!-- 자유 굵기 슬라이더(고급) — 4단계 프리셋은 기본 화면에 유지 -->
          <div class="pb-draw-section">
            <span class="pb-draw-section-label">자유 굵기</span>
            <input type="range" class="pb-draw-size-slider js-pb-draw-size-slider"
              min="1" max="30" value="5" title="자유 굵기">
            <span class="pb-draw-size-val js-pb-draw-size-val">5px</span>
          </div>

          <!-- 불투명도 -->
          <div class="pb-draw-section">
            <span class="pb-draw-section-label">투명도</span>
            <input type="range" class="pb-draw-opacity-slider js-pb-draw-opacity"
              min="20" max="100" value="100" title="투명도 (낮을수록 부드러움)">
            <span class="pb-draw-opacity-val js-pb-draw-opacity-val">100%</span>
          </div>

          <!-- 펜 압력 (태블릿 펜) -->
          <div class="pb-draw-section">
            <label class="pb-draw-pressure-label">
              <input type="checkbox" class="js-pb-draw-pressure" checked>
              <span>펜 압력</span>
            </label>
          </div>

          <!-- 전체 지우기 — 실수 방지 위해 고급으로 이동(confirm은 기존 유지) -->
          <div class="pb-draw-actions">
            <button type="button" class="pb-draw-action js-pb-draw-clear" title="전체 지우기">🗑 전체 지우기</button>
          </div>
        </div>
      </div>

      <!-- 캔버스 영역 -->
      <div class="pb-draw-canvas-wrap">
        <canvas id="pb-draw-canvas" width="${canvasW}" height="${canvasH}"
          style="aspect-ratio: ${canvasW} / ${canvasH}; touch-action: none; cursor: crosshair;"></canvas>
      </div>

      ${opts.descField ? `
      <!-- PROTAG-DESC-1: 주인공 특징 글 — 누가 주인공인지 확정(모든 장면 동일 인물) -->
      <div class="pb-draw-protagdesc" style="padding:8px 14px 2px;">
        <label for="pb-draw-protagdesc" style="display:block;font-size:14px;font-weight:700;color:#3a2f22;margin-bottom:5px;">
          ✍️ 우리 주인공은 어떻게 생겼나요? <span style="color:#c0413e;font-weight:700;">꼭 적어 주세요</span>
        </label>
        <input id="pb-draw-protagdesc" type="text" class="js-pb-draw-protagdesc" maxlength="120"
          value="${escHtml(opts.descValue || '')}"
          placeholder="예) 왕관 쓰고 파란 티셔츠 입은 남자아이"
          style="width:100%;box-sizing:border-box;font-size:15px;padding:9px 11px;border:2px solid #d8c9b3;border-radius:9px;background:#fffdf8;">
        <div class="js-pb-draw-protagdesc-msg" style="font-size:12.5px;color:#7a6a52;margin-top:5px;">
          이 설명으로 AI가 모든 장면에서 <b>똑같은 주인공</b>으로 그려요.
        </div>
      </div>` : ''}

      <!-- 푸터 -->
      <div class="pb-draw-footer">
        <div class="pb-draw-footer-hint">
          ${hasExistingImage ? '⚠ 기존 그림 위에 그리고 있어요. 저장하면 새 그림으로 바뀝니다.' : ''}
        </div>
        <div class="pb-draw-footer-btns">
          <button type="button" class="pb-draw-cancel js-pb-draw-cancel">취소</button>
          <button type="button" class="pb-draw-save js-pb-draw-save">💾 저장하기</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  /* ─── 캔버스 초기화 ─── */
  const canvas = modal.querySelector('#pb-draw-canvas');
  /* v36 → v37 롤백: desynchronized/willReadFrequently 옵션 일부 태블릿에서 그리기 자체 깨짐.
     기본 context로 복귀. 매끄러움 < 동작. */
  const ctx = canvas.getContext('2d');
  /* 흰 배경으로 시작 */
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  /* W8: 캔버스 display 크기 동적 계산 — wrap 영역 안에서 비율 유지하며 최대 크기.
     사용자 보고: "그림 중심형 그림판 꽉 안 차는데?" → wrap의 가로/세로에 맞춰 캔버스 채움. */
  const canvasWrap = modal.querySelector('.pb-draw-canvas-wrap');
  function _resizeCanvasDisplay() {
    if (!canvasWrap || !canvas) return;
    const wrapRect = canvasWrap.getBoundingClientRect();
    /* padding 16px 양쪽 = 32px */
    const availW = wrapRect.width - 32;
    const availH = wrapRect.height - 32;
    if (availW <= 0 || availH <= 0) return;
    const ratio = canvas.width / canvas.height;   /* 모드별 비율 (split 2.376, imageCenter 1.414) */
    let dispW, dispH;
    if (availW / availH > ratio) {
      /* wrap이 비율보다 가로로 길어 → 세로 기준 */
      dispH = availH;
      dispW = availH * ratio;
    } else {
      /* wrap이 비율보다 세로로 길어 → 가로 기준 */
      dispW = availW;
      dispH = availW / ratio;
    }
    canvas.style.width  = dispW + 'px';
    canvas.style.height = dispH + 'px';
  }
  /* 초기 + 창 크기 변경 시 */
  requestAnimationFrame(_resizeCanvasDisplay);
  window.addEventListener('resize', _resizeCanvasDisplay);

  /* 기존 이미지 있으면 배경으로 깔기 (자연 흐름 — 사용자 요청) */
  if (hasExistingImage) {
    const img = new Image();
    img.onload = () => {
      /* contain 방식으로 캔버스 가운데 fit */
      const cw = canvas.width, ch = canvas.height;
      const iw = img.width, ih = img.height;
      const scale = Math.min(cw / iw, ch / ih);
      const dw = iw * scale, dh = ih * scale;
      const dx = (cw - dw) / 2, dy = (ch - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
      /* 배경 깔기 후 다시 snapshot (history 초기 상태 갱신) */
      try {
        state.history = [];
        state.future = [];
        state.history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      } catch (_) {}
    };
    img.onerror = () => { /* fail silently */ };
    img.src = scene.imageData;
  }

  /* 그리기 상태 */
  const state = {
    tool: 'pen',         /* pen | eraser | line | rect | circle | bucket | eyedropper | pan */
    penType: 'normal',   /* v36: normal | marker | pencil | crayon */
    fillShape: false,    /* v36: 도형 채움 토글 */
    color: COLORS[0],
    size: 5,             /* 펜·도형용 굵기 (1~30px) */
    eraserSize: 25,      /* v36: 지우개 굵기 별도 (1~60px) — 펜 굵기와 분리 */
    opacity: 1.0,        /* v36: 불투명도 (20%~100%) */
    drawing: false,
    pressure: true,      /* 펜 압력 사용 (기본 ON) */
    history: [],         /* undo용 — stroke 전 스냅샷 */
    future: [],          /* redo용 — undo 시 옮김 */
    lastX: 0, lastY: 0,
    startX: 0, startY: 0,    /* v36: 도형 시작점 (line/rect/circle) */
    shapeBaseImage: null,    /* v36: 도형 preview용 시작 시점 캔버스 스냅 */
    prevMidX: 0, prevMidY: 0,  /* v37: quadraticCurveTo 보간용 이전 중간점 */
    zoom: 100,                 /* v37: 확대 배율 (50~400%) */
    panX: 0, panY: 0,          /* v37: 캔버스 이동 (px) */
    panning: false,            /* v37: 현재 pan 드래그 중 */
    panStartX: 0, panStartY: 0,
  };

  /* v37: 캔버스 transform 적용 — 확대 + 이동.
     transform-origin: center라 zoom은 가운데 기준. translate는 zoom 이후 좌표라 보정. */
  function _applyCanvasTransform() {
    const scale = state.zoom / 100;
    canvas.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${scale})`;
    canvas.style.transformOrigin = 'center center';
    const valEl = modal.querySelector('.js-pb-draw-zoom-val');
    if (valEl) valEl.textContent = state.zoom + '%';
  }
  function _setZoom(z) {
    state.zoom = Math.max(50, Math.min(400, Math.round(z)));
    _applyCanvasTransform();
  }
  function _resetZoom() {
    state.zoom = 100;
    state.panX = 0;
    state.panY = 0;
    _applyCanvasTransform();
  }

  /* v36: 펜 종류별 stroke 스타일 — 차이 명확하게.
     · normal: 단단한 선, opacity 그대로
     · marker: 형광펜 느낌 — multiply + 살짝 투명 + 굵게 (size×1.3). 색 겹치면 진해짐
     · pencil: 옅은 연필 — opacity 35% + size×0.6 (얇음). 사선 점 텍스처
     · crayon: 두꺼운 크레용 — opacity 60% + size×1.5 (굵음). 거친 점 텍스처 강 */
  function _applyPenStyle() {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = state.opacity;
    if (state.tool === 'eraser') return; /* 지우개는 흰색 single, 별도 처리 */
    if (state.penType === 'marker') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = Math.min(0.65, state.opacity * 0.75);
    } else if (state.penType === 'pencil') {
      ctx.globalAlpha = state.opacity * 0.35;
    } else if (state.penType === 'crayon') {
      ctx.globalAlpha = state.opacity * 0.60;
    }
  }
  /* v36: 펜 종류별 굵기 배율 — 마커는 굵고, 연필은 얇고, 크레용은 가장 굵음 */
  function _penSizeMultiplier() {
    if (state.tool === 'eraser') return 1;
    if (state.penType === 'marker') return 1.3;
    if (state.penType === 'pencil') return 0.6;
    if (state.penType === 'crayon') return 1.5;
    return 1;
  }

  /* 첫 스냅샷 */
  function _snapshot() {
    try {
      state.history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      if (state.history.length > 10) state.history.shift();   /* DRAW-MEM(2026-07-09): 30→10, 전체 ImageData 스냅샷 메모리 완화 */
      state.future = [];   /* 새 stroke 시 redo 스택 리셋 */
    } catch (e) { /* 일부 환경 실패 가능 */ }
  }
  _snapshot();

  /* 캔버스 좌표 변환 */
  function _pos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
    };
  }

  /* 압력 기반 굵기 — pointer.pressure는 0~1, 0이면 일반 마우스.
     v36: 도구가 지우개면 별도 eraserSize, 펜 종류 배율 곱함. */
  function _strokeSize(e) {
    const baseSize = state.tool === 'eraser' ? state.eraserSize : state.size;
    const mult = _penSizeMultiplier();
    const pressureMult = (!state.pressure || !e.pressure || e.pressure === 0 || e.pressure === 0.5)
      ? 1 : (0.3 + e.pressure);
    return baseSize * mult * pressureMult;
  }

  /* v36: 도형 그리기 — 시작점·끝점으로 직선/사각형/원 그림.
     fillShape 켜져 있으면 stroke 후 같은 색 채움. */
  function _drawShape(sx, sy, ex, ey) {
    ctx.save();
    ctx.globalAlpha = state.opacity;
    ctx.strokeStyle = state.color;
    ctx.fillStyle = state.color;
    ctx.lineWidth = state.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let isLine = false;
    if (state.tool === 'line') {
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      isLine = true;
    } else if (state.tool === 'rect') {
      const x = Math.min(sx, ex), y = Math.min(sy, ey);
      const w = Math.abs(ex - sx), h = Math.abs(ey - sy);
      ctx.rect(x, y, w, h);
    } else if (state.tool === 'circle') {
      const cx = (sx + ex) / 2, cy = (sy + ey) / 2;
      const rx = Math.abs(ex - sx) / 2, ry = Math.abs(ey - sy) / 2;
      if (rx > 0 && ry > 0) ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    }
    if (state.fillShape && !isLine) ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /* v36: 스포이드 — 클릭 픽셀 색 추출 → state.color에 반영 */
  function _eyedrop(x, y) {
    try {
      const px = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      const hex = '#' + [px[0], px[1], px[2]].map(n =>
        n.toString(16).padStart(2, '0')).join('');
      state.color = hex;
      /* UI 동기화 */
      modal.querySelectorAll('.js-pb-draw-color').forEach(b => b.classList.remove('is-on'));
      const picker = modal.querySelector('.js-pb-draw-color-pick');
      if (picker) picker.value = hex;
      /* 자동으로 펜으로 전환 (스포이드 = 일회성) */
      state.tool = 'pen';
      modal.querySelectorAll('.js-pb-draw-tool').forEach(b =>
        b.classList.toggle('is-on', b.dataset.tool === 'pen'));
      canvas.style.cursor = 'crosshair';
    } catch (e) { /* getImageData 실패 (CORS 등) — 무시 */ }
  }

  /* v36: 글자 도구 — 캔버스 클릭 위치에 prompt로 받은 텍스트를 그림 */
  function _drawText(x, y) {
    const text = window.prompt('넣을 글자를 입력하세요', '');
    if (!text) return;
    ctx.save();
    ctx.globalAlpha = state.opacity;
    ctx.fillStyle = state.color;
    /* 굵기에 비례한 폰트 사이즈 (대략 stroke size × 4) */
    const fontSize = Math.max(12, state.size * 4);
    ctx.font = `${fontSize}px var(--font-ui, "Jua", sans-serif)`;
    ctx.textBaseline = 'top';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  /* v36: 페인트 버킷 — flood fill (4-방향 인접, 스택 기반).
     클릭 픽셀 색과 같은 인접 픽셀 모두 새 색으로 교체. */
  function _floodFill(startX, startY) {
    const x0 = Math.round(startX), y0 = Math.round(startY);
    const w = canvas.width, h = canvas.height;
    if (x0 < 0 || x0 >= w || y0 < 0 || y0 >= h) return;
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const idx0 = (y0 * w + x0) * 4;
    const tR = data[idx0], tG = data[idx0 + 1], tB = data[idx0 + 2], tA = data[idx0 + 3];
    /* hex → rgb */
    const hex = state.color.replace('#', '');
    const fR = parseInt(hex.substring(0, 2), 16);
    const fG = parseInt(hex.substring(2, 4), 16);
    const fB = parseInt(hex.substring(4, 6), 16);
    const fA = Math.round(state.opacity * 255);
    /* 같은 색이면 종료 — 무한 루프 방지 */
    if (tR === fR && tG === fG && tB === fB && tA === fA) return;
    const stack = [[x0, y0]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue;
      const i = (cy * w + cx) * 4;
      if (data[i] !== tR || data[i+1] !== tG || data[i+2] !== tB || data[i+3] !== tA) continue;
      /* alpha blend — opacity 적용 */
      if (state.opacity >= 0.99) {
        data[i] = fR; data[i+1] = fG; data[i+2] = fB; data[i+3] = 255;
      } else {
        const a = state.opacity;
        data[i]   = Math.round(data[i]   * (1 - a) + fR * a);
        data[i+1] = Math.round(data[i+1] * (1 - a) + fG * a);
        data[i+2] = Math.round(data[i+2] * (1 - a) + fB * a);
        data[i+3] = 255;
      }
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    ctx.putImageData(imgData, 0, 0);
  }

  /* 그리기 이벤트 (Pointer Events) */
  function _onPointerDown(e) {
    if (!e.isPrimary) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    _snapshot();
    const p = _pos(e);
    state.drawing = true;
    state.lastX = p.x;
    state.lastY = p.y;
    state.startX = p.x;
    state.startY = p.y;
    /* v37: quadraticCurveTo 보간용 — 이전 중간점 초기값은 시작점 자신.
       각 stroke는 (prevMid → lastX/Y control → newMid) 곡선으로 그려져 부드러움. */
    state.prevMidX = p.x;
    state.prevMidY = p.y;

    /* v37: 이동 도구 — pointerdown 시작 위치 기록하고 drawing false (그리기 안 함) */
    if (state.tool === 'pan') {
      state.drawing = false;
      state.panning = true;
      state.panStartX = e.clientX - state.panX;
      state.panStartY = e.clientY - state.panY;
      canvas.style.cursor = 'grabbing';
      return;
    }

    /* v36: 페인트 버킷 — 즉시 채우고 끝 */
    if (state.tool === 'bucket') {
      _floodFill(p.x, p.y);
      state.drawing = false;
      return;
    }

    /* v36: 스포이드 — 클릭 픽셀 색 추출 후 펜으로 자동 전환 */
    if (state.tool === 'eyedropper') {
      _eyedrop(p.x, p.y);
      state.drawing = false;
      return;
    }

    /* v36: 글자 도구 — prompt로 입력 받아 그 위치에 그림 */
    if (state.tool === 'text') {
      _drawText(p.x, p.y);
      state.drawing = false;
      return;
    }

    /* v36: 도형 — preview 위해 시작 시점 캔버스 저장. drag 시 복원 후 도형 다시 그림. */
    if (state.tool === 'line' || state.tool === 'rect' || state.tool === 'circle') {
      try {
        state.shapeBaseImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
      } catch (_) { state.shapeBaseImage = null; }
      return;
    }

    /* 펜·지우개 — 점 하나 찍기 (탭) + 펜 종류 스타일 */
    ctx.save();
    _applyPenStyle();
    if (state.tool === 'eraser') ctx.globalAlpha = 1.0;
    ctx.beginPath();
    ctx.arc(p.x, p.y, _strokeSize(e) / 2, 0, Math.PI * 2);
    ctx.fillStyle = state.tool === 'eraser' ? '#ffffff' : state.color;
    ctx.fill();
    ctx.restore();
  }
  function _onPointerMove(e) {
    /* v37: 이동 도구 — pan 드래그 처리 (drawing 아니라도 처리) */
    if (state.panning && state.tool === 'pan' && e.isPrimary) {
      e.preventDefault();
      state.panX = e.clientX - state.panStartX;
      state.panY = e.clientY - state.panStartY;
      _applyCanvasTransform();
      return;
    }
    if (!state.drawing || !e.isPrimary) return;
    e.preventDefault();

    /* v36: 도형 — base 복원 후 새 도형 그림 (preview). 단일 이벤트만 처리. */
    if (state.tool === 'line' || state.tool === 'rect' || state.tool === 'circle') {
      const p = _pos(e);
      if (state.shapeBaseImage) ctx.putImageData(state.shapeBaseImage, 0, 0);
      _drawShape(state.startX, state.startY, p.x, p.y);
      return;
    }

    /* v37 매끄러움: quadraticCurveTo 보간 — 두 점 사이 부드러운 곡선.
       lastX/Y는 곡선 control point, newMid는 endpoint. 다음 stroke는 newMid에서 시작.
       이게 mid-point quadratic 기법 — Procreate/메모 앱 부드러움 비슷. */
    const p = _pos(e);
    const newMidX = (state.lastX + p.x) / 2;
    const newMidY = (state.lastY + p.y) / 2;

    ctx.save();
    _applyPenStyle();
    if (state.tool === 'eraser') ctx.globalAlpha = 1.0;
    ctx.beginPath();
    ctx.moveTo(state.prevMidX, state.prevMidY);
    ctx.quadraticCurveTo(state.lastX, state.lastY, newMidX, newMidY);
    ctx.lineWidth = _strokeSize(e);
    ctx.strokeStyle = state.tool === 'eraser' ? '#ffffff' : state.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    /* 연필·크레용 거친 질감 — endpoint(newMid)에서만 찍음 */
    if (state.tool !== 'eraser' && (state.penType === 'pencil' || state.penType === 'crayon')) {
      const isCrayon = state.penType === 'crayon';
      const dots = isCrayon ? 7 : 3;
      const spread = isCrayon ? state.size * 1.4 : state.size * 0.6;
      const dotSize = isCrayon ? _strokeSize(e) / 3 : _strokeSize(e) / 5;
      for (let i = 0; i < dots; i++) {
        const dx = (Math.random() - 0.5) * spread;
        const dy = (Math.random() - 0.5) * spread;
        ctx.beginPath();
        ctx.arc(newMidX + dx, newMidY + dy, dotSize * (0.5 + Math.random() * 0.5), 0, Math.PI * 2);
        ctx.fillStyle = state.color;
        ctx.fill();
      }
    }
    ctx.restore();
    state.prevMidX = newMidX;
    state.prevMidY = newMidY;
    state.lastX = p.x;
    state.lastY = p.y;
  }
  function _onPointerUp(e) {
    state.drawing = false;
    state.shapeBaseImage = null;
    /* v37: pan 드래그 끝 → cursor 복귀 */
    if (state.panning) {
      state.panning = false;
      canvas.style.cursor = state.tool === 'pan' ? 'grab' : 'crosshair';
    }
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  }

  canvas.addEventListener('pointerdown', _onPointerDown);
  canvas.addEventListener('pointermove', _onPointerMove);
  canvas.addEventListener('pointerup', _onPointerUp);
  canvas.addEventListener('pointercancel', _onPointerUp);

  /* ─── 툴바 핸들러 ─── */
  /* v36: 도구 전환 시 굵기 슬라이더 max·value 동기화 (지우개는 1~60, 그 외 1~30) */
  function _syncSizeSliderForTool() {
    const slider = modal.querySelector('.js-pb-draw-size-slider');
    const valEl = modal.querySelector('.js-pb-draw-size-val');
    if (!slider) return;
    if (state.tool === 'eraser') {
      slider.max = '60';
      slider.value = String(state.eraserSize);
      if (valEl) valEl.textContent = `${state.eraserSize}px`;
    } else {
      slider.max = '30';
      slider.value = String(state.size);
      if (valEl) valEl.textContent = `${state.size}px`;
    }
    /* 4단계 버튼 active 갱신 */
    const activeSize = state.tool === 'eraser' ? state.eraserSize : state.size;
    modal.querySelectorAll('.js-pb-draw-size').forEach(b =>
      b.classList.toggle('is-on', parseInt(b.dataset.size, 10) === activeSize));
  }

  /* DRAWING-STUDIO-2-SIMPLE: 현재 도구 상태 문구 — 고급 도구가 접혀 있어도 지금 모드를 알 수 있게. */
  const DRAW_STATUS_TEXT = {
    pen: '지금은 ✏️ 펜으로 그리고 있어요.',
    eraser: '지금은 🧽 지우개로 지우고 있어요.',
    line: '지금은 🔷 도형(직선)을 그리고 있어요.',
    rect: '지금은 🔷 도형(사각형)을 그리고 있어요.',
    circle: '지금은 🔷 도형(원)을 그리고 있어요.',
    bucket: '지금은 🪣 색을 채우고 있어요.',
    eyedropper: '지금은 🎨 캔버스에서 색을 고르고 있어요.',
    pan: '지금은 ✋ 그림을 움직이고 있어요. (그려지지 않아요)',
  };
  function _updateDrawStatus() {
    const el = modal.querySelector('.js-pb-draw-status');
    if (el) el.textContent = DRAW_STATUS_TEXT[state.tool] || DRAW_STATUS_TEXT.pen;
  }

  modal.querySelectorAll('.js-pb-draw-tool').forEach(btn => {
    btn.addEventListener('click', () => {
      state.tool = btn.dataset.tool || 'pen';
      modal.querySelectorAll('.js-pb-draw-tool').forEach(b =>
        b.classList.toggle('is-on', b === btn));
      /* v36/v37: 도구별 cursor */
      if (state.tool === 'eraser') canvas.style.cursor = 'grab';
      else if (state.tool === 'bucket') canvas.style.cursor = 'cell';
      else if (state.tool === 'eyedropper') canvas.style.cursor = 'copy';
      else if (state.tool === 'pan') canvas.style.cursor = 'grab';
      else canvas.style.cursor = 'crosshair';
      _syncSizeSliderForTool();
      _updateDrawStatus();
    });
  });

  /* DRAWING-STUDIO-2-SIMPLE: 도구 더보기 접기/펼치기 — 기능 삭제 없음(노출만).
     접힘/펼침 시 캔버스 표시 크기 재계산(도구바 높이 변동). */
  const _moreBtn = modal.querySelector('.js-pb-draw-more');
  const _advWrap = modal.querySelector('.js-pb-draw-adv');
  if (_moreBtn && _advWrap) {
    _moreBtn.addEventListener('click', () => {
      const open = _advWrap.hidden;
      _advWrap.hidden = !open;
      _moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      _moreBtn.textContent = open ? '🧰 도구 접기' : '🧰 도구 더보기';
      requestAnimationFrame(_resizeCanvasDisplay);
    });
  }

  /* v37: 줌 버튼 — 25%씩 ± . 50~400% 범위. */
  modal.querySelector('.js-pb-draw-zoom-in')?.addEventListener('click', () => _setZoom(state.zoom + 25));
  modal.querySelector('.js-pb-draw-zoom-out')?.addEventListener('click', () => _setZoom(state.zoom - 25));
  modal.querySelector('.js-pb-draw-zoom-reset')?.addEventListener('click', _resetZoom);

  /* v36: 펜 종류 핸들러 */
  modal.querySelectorAll('.js-pb-draw-pentype').forEach(btn => {
    btn.addEventListener('click', () => {
      state.penType = btn.dataset.pentype || 'normal';
      modal.querySelectorAll('.js-pb-draw-pentype').forEach(b =>
        b.classList.toggle('is-on', b === btn));
    });
  });

  /* v36: 도형 채움 토글 */
  modal.querySelector('.js-pb-draw-fill')?.addEventListener('change', e => {
    state.fillShape = !!e.target.checked;
  });
  modal.querySelectorAll('.js-pb-draw-color').forEach(btn => {
    btn.addEventListener('click', () => {
      state.color = btn.dataset.color || '#2b1f10';
      modal.querySelectorAll('.js-pb-draw-color').forEach(b =>
        b.classList.toggle('is-on', b === btn));
      /* v36: 도형(line/rect/circle)·페인트 버킷 그릴 때도 색만 변경하고 도구 유지.
         지우개는 사용자가 명시적으로 다시 누를 때만 전환. */
      if (state.tool === 'eraser') {
        state.tool = 'pen';
        modal.querySelectorAll('.js-pb-draw-tool').forEach(b =>
          b.classList.toggle('is-on', b.dataset.tool === 'pen'));
        canvas.style.cursor = 'crosshair';
      }
      /* 자유 컬러 피커도 시각 동기화 */
      const picker = modal.querySelector('.js-pb-draw-color-pick');
      if (picker) picker.value = state.color;
    });
  });
  modal.querySelectorAll('.js-pb-draw-size').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = parseInt(btn.dataset.size, 10) || 5;
      /* v36: 도구에 따라 다른 변수 저장 */
      if (state.tool === 'eraser') state.eraserSize = v;
      else state.size = v;
      modal.querySelectorAll('.js-pb-draw-size').forEach(b =>
        b.classList.toggle('is-on', b === btn));
      /* 슬라이더·값 표시 동기화 */
      const slider = modal.querySelector('.js-pb-draw-size-slider');
      const valEl = modal.querySelector('.js-pb-draw-size-val');
      if (slider) slider.value = String(v);
      if (valEl) valEl.textContent = `${v}px`;
    });
  });
  /* v36: 컬러 피커 (자유 색) — 도구 유지, 색만 변경 */
  modal.querySelector('.js-pb-draw-color-pick')?.addEventListener('input', e => {
    state.color = e.target.value;
    /* 8색 버튼 active 해제 (자유 색 선택 표시) */
    modal.querySelectorAll('.js-pb-draw-color').forEach(b => b.classList.remove('is-on'));
    /* 지우개일 땐 색 사용 안 하니 pen으로 전환 */
    if (state.tool === 'eraser') {
      state.tool = 'pen';
      modal.querySelectorAll('.js-pb-draw-tool').forEach(b =>
        b.classList.toggle('is-on', b.dataset.tool === 'pen'));
      canvas.style.cursor = 'crosshair';
    }
  });
  /* v36: 굵기 슬라이더 — 도구에 따라 펜 size 또는 지우개 eraserSize에 저장 */
  modal.querySelector('.js-pb-draw-size-slider')?.addEventListener('input', e => {
    const v = parseInt(e.target.value, 10) || 5;
    if (state.tool === 'eraser') state.eraserSize = v;
    else state.size = v;
    const valEl = modal.querySelector('.js-pb-draw-size-val');
    if (valEl) valEl.textContent = `${v}px`;
    /* 4단계 버튼 active — 일치하는 게 있으면 표시 */
    modal.querySelectorAll('.js-pb-draw-size').forEach(b => {
      b.classList.toggle('is-on', parseInt(b.dataset.size, 10) === v);
    });
  });
  /* v36: 불투명도 슬라이더 (20~100%) */
  modal.querySelector('.js-pb-draw-opacity')?.addEventListener('input', e => {
    const pct = parseInt(e.target.value, 10) || 100;
    state.opacity = pct / 100;
    const valEl = modal.querySelector('.js-pb-draw-opacity-val');
    if (valEl) valEl.textContent = `${pct}%`;
  });
  modal.querySelector('.js-pb-draw-pressure')?.addEventListener('change', e => {
    state.pressure = !!e.target.checked;
  });
  /* 되돌리기 */
  modal.querySelector('.js-pb-draw-undo')?.addEventListener('click', _undo);
  /* 다시 실행 */
  modal.querySelector('.js-pb-draw-redo')?.addEventListener('click', _redo);
  /* 전체 지우기 */
  modal.querySelector('.js-pb-draw-clear')?.addEventListener('click', async () => {
    const ok = await showViewerConfirm({
      title: '그린 그림을 모두 지울까요?',
      message: '지금 그린 내용이 모두 지워져요.',
      confirmText: '지우기',
      danger: true,
    });
    if (!ok) return;
    _snapshot();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  });

  /* DRAW-UNDO-FIX(2026-07-26): 되돌리기가 한 획씩이 아니라 두 획씩 지워지던 것.
     history에 쌓이는 건 "획을 긋기 직전 상태"인데(_snapshot은 pointerdown에서 호출),
     종전 _undo는 pop한 직전 상태를 버리고 그보다 한 칸 더 이전 것을 화면에 그렸다
     → 획 2개를 긋고 되돌리기 1번이면 둘 다 사라짐(실측: 15182→5018픽셀, 시작 상태로 복귀).
     이제 pop한 그 상태를 그대로 그리고, redo용으로는 '현재 화면'을 따로 담는다. */
  function _snapCurrent() {
    try { return ctx.getImageData(0, 0, canvas.width, canvas.height); } catch (e) { return null; }
  }
  function _undo() {
    if (state.history.length <= 1) return;
    const cur = _snapCurrent();                 /* 지금 화면 = redo로 돌아올 지점 */
    if (cur) state.future.push(cur);
    if (state.future.length > 10) state.future.shift();   /* DRAW-MEM: 30→10 */
    const prev = state.history.pop();           /* 직전 상태 = 지금 그려야 할 것 */
    if (prev) ctx.putImageData(prev, 0, 0);
  }
  function _redo() {
    if (!state.future.length) return;
    const cur = _snapCurrent();                 /* 지금 화면을 history로 되돌려 놓아야 undo가 짝이 맞음 */
    if (cur) state.history.push(cur);
    if (state.history.length > 10) state.history.shift();   /* DRAW-MEM(2026-07-09): 30→10, 전체 ImageData 스냅샷 메모리 완화 */
    const next = state.future.pop();
    ctx.putImageData(next, 0, 0);
  }

  /* 키보드 단축키 — Ctrl+Z / Ctrl+Shift+Z */
  function _onKey(e) {
    if (!document.getElementById('pb-draw-modal')) return;   /* 모달 닫힘 */
    if (e.key === 'Escape') { e.preventDefault(); _requestClose(); return; }   /* DRAW-ESC(2026-07-09): ESC로 닫기(확인 경유) */
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); _undo(); }
      else if (e.key === 'z' && e.shiftKey) { e.preventDefault(); _redo(); }
      else if (e.key === 'y') { e.preventDefault(); _redo(); }
    }
  }
  document.addEventListener('keydown', _onKey);

  /* ─── 모달 닫기 / 저장 ─── */
  function _close() {
    document.removeEventListener('keydown', _onKey);
    window.removeEventListener('resize', _resizeCanvasDisplay);
    /* DRAW-MEM(2026-07-09): 대형 ImageData 히스토리를 즉시 해제(참조 끊기) → 태블릿 GC 스톨/'안 돌아감' 완화.
       modal.remove()만으론 클로저가 잡은 배열이 늦게 해제될 수 있음. */
    try { if (state) { state.history = []; state.future = []; if (state.shapeBaseImage) state.shapeBaseImage = null; } } catch (e) {}
    modal.remove();
    /* LEVEL2-CHAR: 닫힘 훅(저장/취소 공통) — 주인공 게이트가 재노출 판단에 사용. */
    if (typeof opts.onClose === 'function') { try { opts.onClose(); } catch (e) { /* noop */ } }
  }
  /* DRAW-CLOSE(2026-07-09): 닫기 확인(변경분 있으면) 공통화 — 취소/배경/ESC가 재사용. */
  async function _requestClose() {
    if (state.history.length > 1) {
      const ok = await showViewerConfirm({
        title: '저장하지 않고 닫을까요?',
        message: '저장하지 않은 그림은 사라져요.',
        confirmText: '닫기',
        danger: true,
      });
      if (!ok) return;
    }
    _close();
  }
  modal.querySelectorAll('.js-pb-draw-cancel').forEach(btn => {
    btn.addEventListener('click', () => { _requestClose(); });
  });
  modal.querySelector('.pb-draw-backdrop')?.addEventListener('click', () => { _requestClose(); });

  /* DRAWING-STUDIO-2-SIMPLE 빈 캔버스 판정 — 축소 샘플(60×40)에서 흰색이 아닌 픽셀 비율.
     기존 그림 이어 그리기(배경으로 그려짐)·모든 스트로크가 픽셀 기준이라 오판 없음.
     전체 지우기 후=전부 흰색→confirm. 흰 펜 완벽 판정은 하지 않음(정책). */
  function _isCanvasBlank() {
    try {
      /* 150×100 샘플 — 60×40은 가는 선 하나(5px)가 안티앨리어스로 사라져 오판(하니스 실측 nonWhite 4).
         가는 선 하나 ≈ 40+픽셀로 잡히는 해상도. 임계는 절대 12픽셀(점 하나 수준만 '거의 없음'). */
      const w = 150, h = 100;
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const octx = off.getContext('2d');
      octx.drawImage(canvas, 0, 0, w, h);
      const d = octx.getImageData(0, 0, w, h).data;
      let nonWhite = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] < 246 || d[i + 1] < 246 || d[i + 2] < 246) nonWhite++;
      }
      return nonWhite < 12;
    } catch (e) { return false; }          /* 판정 실패 → 저장 진행(차단 금지) */
  }
  /* DRAWING-STUDIO-2-SIMPLE 저장 성공 토스트 — 모달 닫힌 뒤 짧게. */
  function _drawSavedToast() {
    try {
      const t = document.createElement('div');
      t.className = 'pb-draw-saved-toast';
      t.textContent = '✅ 그림을 저장했어요.';
      document.body.appendChild(t);
      setTimeout(() => { t.classList.add('is-out'); }, 1600);
      setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 2100);
    } catch (e) { /* noop */ }
  }

  /* 저장 — 캔버스 → data URL → Storage 업로드 → URL을 scene.imageData에 기록.
     v114: base64 RTDB 폭탄 차단. 그림 그리기도 Storage 사용.
     DRAWING-STUDIO-2-SIMPLE: busy 가드(중복 업로드 방지)+빈 캔버스 confirm+성공 토스트. */
  const _saveBtn = modal.querySelector('.js-pb-draw-save');
  _saveBtn?.addEventListener('click', async () => {
    /* P5-IMAGE-LOCK-1: AI 이미지 보기 중엔 그림판 저장(원본 imageData write) 차단. */
    if (_aiImageVariantBlocksOriginalEdit()) return;
    if (state.isSaving) return;                       /* 빠른 중복 클릭 → 1회만 */
    /* ★ busy는 confirm await 이전에 세워야 함 — confirm 대기 중 재클릭 재진입 차단. */
    state.isSaving = true;
    const _saveLabel = _saveBtn.textContent;
    _saveBtn.disabled = true;
    _saveBtn.textContent = '저장 중...';
    const _restoreSaveBtn = () => {
      state.isSaving = false;
      if (_saveBtn) { _saveBtn.disabled = false; _saveBtn.textContent = _saveLabel; }
    };
    /* 빈 캔버스 확인 — 차단 아님(confirm 후 저장 가능). 기존 그림은 배경으로 그려져 있어 오판 없음. */
    if (_isCanvasBlank()) {
      const ok = await showViewerConfirm({
        title: '아직 그린 내용이 거의 없어요',
        message: '이대로 저장할까요?',
        confirmText: '저장하기',
        cancelText: '계속 그리기',
      });
      if (!ok) { _restoreSaveBtn(); return; }
    }
    try {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      /* LEVEL2-CHAR: 작품 단위 주인공 저장 — 장면 소스모드 게이트/lock/scene write 모두 우회
         (주인공은 장면 이미지가 아님). 업로드는 공용 헬퍼('char' 키)로 고유 경로. */
      if (typeof opts.saveOverride === 'function') {
        /* PROTAG-DESC-1: 주인공 특징 글 — 필수면 비었을 때 저장 차단(누가 주인공인지 확정). */
        let _desc = '';
        if (opts.descField) {
          const _di = modal.querySelector('.js-pb-draw-protagdesc');
          _desc = _di ? String(_di.value || '').replace(/\s+/g, ' ').trim() : '';
          if (opts.descRequired && _desc.length < 2) {
            const _msg = modal.querySelector('.js-pb-draw-protagdesc-msg');
            if (_msg) { _msg.innerHTML = '⚠️ 주인공이 <b>어떻게 생겼는지</b> 한 줄 적어 주세요. (예: 왕관 쓴 남자아이)'; _msg.style.color = '#c0413e'; }
            if (_di) { try { _di.style.borderColor = '#c0413e'; _di.focus(); } catch (e2) {} }
            _restoreSaveBtn();
            return;
          }
        }
        let _u;
        try {
          const r = await viewerUploadImageToStorage(dataUrl, 'char');
          _u = r.downloadURL;
        } catch (e) {
          console.error('[viewer-edit] 주인공 그림 업로드 실패:', e);
          alert('❌ 그림을 올리지 못했어요. 잠시 후 다시 시도해 주세요.');
          _restoreSaveBtn();
          return;
        }
        try {
          await opts.saveOverride(_u, _desc);
        } catch (e) {
          console.error('[viewer-edit] 주인공 저장 실패:', e);
          alert('❌ 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
          _restoreSaveBtn();
          return;
        }
        _close();
        _drawSavedToast();
        return;
      }
      const _sid = scene.num || scene.id;
      /* S2-2A-FIX1 ① 사전 게이트(업로드 전): 반대 모드/corrupt면 차단(scene·Storage 무변경). */
      const _gate = (typeof window !== 'undefined' && window.viewerAi && typeof window.viewerAi._preCheckSourceMode === 'function')
        ? await window.viewerAi._preCheckSourceMode('draw', _sid)
        : { allow: true };
      if (!_gate.allow) { _notifySourceModeBlock(_gate); _restoreSaveBtn(); return; }
      /* ② 고유 경로 업로드(기존 객체 overwrite 안 함). */
      let storageUrl, _storagePath;
      try {
        const r = await viewerUploadImageToStorage(dataUrl, _sid);
        storageUrl = r.downloadURL;
        _storagePath = r.storagePath;
      } catch (e) {
        console.error('[viewer-edit] 그림 업로드 실패:', e);
        alert('❌ 그림을 올리지 못했어요. 잠시 후 다시 시도해 주세요.');
        _restoreSaveBtn();
        return;
      }
      /* ③ 서버 lock 확정. 실패/충돌이면 방금 만든 고유 객체만 삭제, scene 무변경. */
      const _commit = (typeof window !== 'undefined' && window.viewerAi && typeof window.viewerAi._commitImageSourceMode === 'function')
        ? await window.viewerAi._commitImageSourceMode('draw', _sid, _storagePath)
        : { ok: true };
      if (!_commit.ok) { _notifySourceModeBlock(_commit); _restoreSaveBtn(); return; }   /* scene 미변경 → 승자/기존 무손상 */
      /* ④ lock 성공일 때만 scene.imageData 기록 + flush await. */
      const _beforeImageData = scene.imageData || null;   /* S2-2A-FIX2: flush 실패 시 로컬 복원 기준 */
      scene.imageData = storageUrl;
      let _flushRes;
      if (typeof _queueSave === 'function') {
        _queueSave(_sid, { imageData: storageUrl });
        if (typeof _flushPendingSave === 'function') _flushRes = await _flushPendingSave();
      }
      /* S2-2A-FIX2: flush 실패면 신규 객체 cleanup + 로컬 복원(모달 유지·lock 유지·재시도 가능). */
      const _flushOk = await _handleImageFlushResult(scene, _beforeImageData, storageUrl, _storagePath, _flushRes);
      if (!_flushOk) { _restoreSaveBtn(); return; }   /* 모달 유지 — 같은 방식으로 다시 시도 */
      renderEditPanel();
      _scheduleViewerFrameReRender();
      _close();
      _drawSavedToast();   /* DRAWING-STUDIO-2-SIMPLE: 저장 성공 안내 */
    } catch (err) {
      console.error('[viewer-edit] 그림 저장 실패:', err);
      alert('저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
      _restoreSaveBtn();
    }
  });
}
