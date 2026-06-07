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
/* v134: 다른 스크립트(특히 storyAnalyzer.js의 _rtIsViewerEditable) 박은 거 박을 수 있게
   window에 명시적으로 노출. const 선언은 script-level scope라 자동으로 window에 박지 X 박은 거 —
   v130 루트보기 인라인 수정 ✎ 버튼이 안 보이던 진짜 원인. */
if (typeof window !== 'undefined') {
  window._editText = _editText;
}
const EDIT_SAVE_DEBOUNCE_MS = 800;

/* W9 (v3): 양옆 마감 테마 collapsible 상태.
   null = 자동 (pbTheme === 'classic-book' → 펼침, 다른 거 → 접힘)
   true = 사용자가 접음 / false = 사용자가 펼침 */
let _pbThemeCollapsed = null;
function _getPbThemeCollapsed() {
  if (_pbThemeCollapsed !== null) return _pbThemeCollapsed;
  return (ViewerState.project.pbTheme || 'classic-book') !== 'classic-book';
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

async function viewerUploadVideoToStorage(file, sceneNum, opts) {
  /* viewer는 named app 'viewer'를 사용 — default app 아님.
     getViewerDb()와 같은 방식으로 named app에서 storage 가져옴.
     'viewer' app이 아직 init 안 됐으면 getViewerDb 호출로 강제 init. */
  if (typeof firebase === 'undefined' || typeof firebase.app !== 'function') {
    throw new Error('Storage SDK가 로드되지 않았어요. 페이지를 새로고침해주세요.');
  }
  let storage;
  let viewerApp;
  try {
    viewerApp = firebase.app('viewer');
  } catch (e) {
    /* 'viewer' app 없음 → getViewerDb로 강제 init (viewer-data.js의 패턴) */
    if (typeof getViewerDb === 'function') {
      try {
        getViewerDb();
        viewerApp = firebase.app('viewer');
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
     viewer named app의 auth 사용. */
  try {
    if (typeof viewerApp.auth === 'function') {
      const auth = viewerApp.auth();
      if (!auth.currentUser) {
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
   배경: 다듬기 모드에서 박는 이미지 업로드 흐름 (그림책 그림 / 무비 포스터 /
   그림 그리기 캔버스 저장)이 옛엔 base64 → RTDB 박음. v114부터 Storage 박음.
   firebase.js의 uploadImageToStorage와 같은 패턴 — viewer named app 사용.
   값 일치 유지 책임: firebase.js _imageStoragePath / uploadImageToStorage와 동기.
   ──────────────────────────────────────────────────────────────── */
const _VIEWER_IMAGE_MAX_BYTES = 6 * 1024 * 1024;

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
  return `images/${cid}/${encodedName}/scene_${sceneNum}.${ext || 'jpg'}`;
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
  try {
    viewerApp = firebase.app('viewer');
  } catch (e) {
    if (typeof getViewerDb === 'function') {
      try { getViewerDb(); viewerApp = firebase.app('viewer'); }
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

  /* anonymous auth — viewer named app */
  try {
    if (typeof viewerApp.auth === 'function') {
      const auth = viewerApp.auth();
      if (!auth.currentUser) {
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

  /* 2026-05-22 fix: GCS direct URL은 신규 업로드 시 public ACL이 박지 X
     박혀서 HTTP 403 박힘 (옛 마이그 작품만 ACL 박혀있음).
     ref.getDownloadURL()로 토큰 박힌 Firebase Storage URL을 받아 어디서든 접근 가능. */
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

async function viewerDeleteVideoFromStorage(storagePath) {
  if (typeof firebase === 'undefined' || typeof firebase.app !== 'function') return false;
  if (!storagePath) return false;
  try {
    let viewerApp;
    try { viewerApp = firebase.app('viewer'); }
    catch (e) {
      if (typeof getViewerDb === 'function') {
        getViewerDb();
        viewerApp = firebase.app('viewer');
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
    if (scene && typeof renderScene === 'function') renderScene(scene);
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

/* W8: textStyle.fontFamily ID → CSS font-family 값 매핑.
     기존엔 TEXT_FONT_FAMILIES 미정의 변수 참조라 fontMap 비어 폰트 적용 실패.
     사용자 보고: "굵게는 되는데 폰트·크기 안 됨" → 이 매핑 fix.
     ID는 maker/viewer에서 일관 사용 — gothic/batang/jua/gaegu/pen/galmuri/cormorant. */
const TEXT_FONT_FAMILIES = {
  gothic:     "'Nanum Gothic', sans-serif",
  batang:     "'Gowun Batang', 'Nanum Myeongjo', serif",
  jua:        "'Jua', sans-serif",
  gaegu:      "'Gaegu', cursive",
  pen:        "'Nanum Pen Script', cursive",
  galmuri:    "'Galmuri', monospace",
  cormorant:  "'Cormorant Garamond', serif",
  hanna:      "'Black Han Sans', sans-serif",
  /* W9 확장 10종 */
  notosans:   "'Noto Sans KR', sans-serif",
  notoserif:  "'Noto Serif KR', serif",
  dohyeon:    "'Do Hyeon', sans-serif",
  dodum:      "'Gowun Dodum', sans-serif",
  himelody:   "'Hi Melody', cursive",
  yeonsung:   "'Yeon Sung', cursive",
  dokdo:      "'East Sea Dokdo', cursive",
  diphylleia: "'Diphylleia', serif",
  hahmlet:    "'Hahmlet', serif",
  stylish:    "'Stylish', serif",
};

/* 텍스트형 — CSS 변수/속성만 갱신 */
function _patchTextStyle() {
  const screen = _getSceneScreen();
  if (!screen || !screen.classList.contains('scene-screen--text')) return false;
  const scene = ViewerState.scenes[ViewerState.currentSceneId];
  if (!scene) return false;
  const style = (typeof getTextStyle === 'function') ? getTextStyle(scene) : (scene.textStyle || {});
  /* 2026-05-31 Text-3A: 라이브 패치 CSS 변수 이름을 렌더(_renderSceneText)/CSS와 일치시킴.
     옛 패치는 CSS가 안 읽는 이름(--text-font-family / --text-fw-body)에 박아서 폰트·굵기
     즉시 반영이 안 됐음(재렌더 때만 적용). 색(--text-color-override)·크기(--text-fs-body)는
     원래 이름이 맞아 즉시 반영됐음.
     · 폰트 : --text-ff      (CSS .text-card font-family + 테마별 폰트 룰이 읽음)
     · 굵기 : --text-weight  (CSS .text-card font-weight가 읽음) */
  if (style.fontFamily) {
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
  } catch (err) {
    _showSaveStatus('❌ 저장 실패', 2000);
    /* 실패한 변경은 재시도 가능하도록 다시 큐에 병합 */
    Object.assign(_editText.pendingFields, fields);
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
  const banner = panel.querySelector('.js-edit-lock-banner');
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
        /* v125: 같은 기기/같은 사용자의 이전 탭이 박은 잠금 — 부드러운 문구.
           "다른 창에서 편집 중" 박은 거가 사용자 박은 거 같은 사람이라 박지 X. */
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
        /* v116: 'other' 분류에도 "다시 확인" + "내가 수정하기" 박음.
           옛엔 인수 버튼 없어 사용자가 정말 막혔는데, stale lock(다른 사용자 폰
           꺼지면 TTL 20초 동안 박힘) 또는 옛 잠금 박은 경우 풀 길 없었음.
           정책: 다시 확인 = 잠금 다시 읽음. 박지 못한 stale 박은 경우 자동 박음.
           내가 수정하기 = confirm 박은 후 무조건 인수 (transaction 덮어쓰기). */
        banner.classList.remove('edit-lock-banner--mild');
        banner.innerHTML = `
          <div class="edit-lock-banner-msg">🔒 다른 친구가 이 장면을 수정 중일 수 있어요. 지금은 읽기만 할 수 있어요.</div>
          <div class="edit-lock-banner-actions">
            <button class="edit-lock-recheck-btn js-edit-lock-recheck" type="button">다시 확인</button>
            <button class="edit-lock-takeover-btn js-edit-lock-force-takeover" type="button">내가 수정하기</button>
          </div>`;
        /* 다시 확인 — viewerEnsureEditable 다시 박음. stale 박혀있던 잠금이 풀린 경우 자동 박힘. */
        banner.querySelector('.js-edit-lock-recheck')
          ?.addEventListener('click', async () => {
            if (_editText.num == null) return;
            const ok = (typeof viewerEnsureEditable === 'function')
              ? await viewerEnsureEditable(_editText.num) : false;
            if (ok) {
              _editText.editable = true;
              _applyEditLockUI();
            } else {
              /* 박지 못한 경우 분류 다시 박음 — 'other' 그대로 또는 박힌 거 변경 박힘 */
              _applyEditLockUI();
            }
          });
        /* 내가 수정하기 — 사용자가 confirm 박은 후 무조건 인수 */
        banner.querySelector('.js-edit-lock-force-takeover')
          ?.addEventListener('click', async () => {
            if (_editText.num == null) return;
            const ok = confirm('다른 친구가 이 장면을 수정 중일 수 있어요.\n그래도 내가 수정할까요?');
            if (!ok) return;
            const taken = (typeof viewerForceTakeoverLock === 'function')
              ? await viewerForceTakeoverLock(_editText.num) : false;
            if (taken) {
              _editText.editable = true;
              _applyEditLockUI();
            } else {
              /* v125: 실패 원인별 다른 안내.
                 1) auth 박지 X → "로그인/권한 확인이 늦어지고 있어요"
                 2) 네트워크 추정 → "인터넷 연결 확인"
                 3) 그 외 → 일반 안내 */
              let authReady = false;
              try {
                if (typeof firebase !== 'undefined' && firebase.app) {
                  const viewerApp = firebase.app('viewer');
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
                msg = '편집 권한을 가져오지 못했어요.\n• 잠시 후 [다시 확인]을 눌러주세요\n• 계속 박지 못하면 페이지를 새로고침해주세요';
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

/* ================================================================
   상단 장면 네비게이터 HTML
   [ ← 이전 ]  [ 장면 2 · 제목 · 유형 ]  [ 다음 → ]
   ================================================================ */
function _editNavHtml(scene) {
  const list  = _editSceneList();
  const idx   = _currentSceneIndex();
  const total = list.length;
  const num   = scene.id;
  const title = scene.title || '(제목 없음)';
  const type  = _sceneTypeLabel(scene);
  const roles = _sceneRoles(scene);

  const hasPrev = idx > 0;
  const hasNext = idx < total - 1;

  /* 유형별 배지 클래스 — 표지/일반/엔딩 3종 */
  const typeClass = (scene.type === 'cover' || scene.isCover) ? 'edit-nav-badge--cover'
                  : scene.isEnding ? 'edit-nav-badge--ending'
                                    : 'edit-nav-badge--normal';

  /* 역할 배지 HTML — 첫 감상 시작(녹색) / 다시 시작점(파랑) */
  const roleBadgesHtml = [
    roles.isEntry  ? '<span class="edit-nav-role edit-nav-role--entry" title="첫 감상자가 시작하는 장면">첫 감상 시작</span>' : '',
    roles.isReplay ? '<span class="edit-nav-role edit-nav-role--replay" title="다른 결말 찾기에서 시작하는 장면">다시 시작점</span>' : '',
  ].join('');

  /* 장면 목록 option — v39: 표지 최우선 / 엔딩 마지막 / 그 외 id순.
     ←/→ 이동은 _editSceneList() 원본(id순) 그대로 사용 — 드롭다운 정렬만 별도. */
  const optionsHtml = list.slice().sort((a, b) => {
    const rank = s => ((s.type === 'cover' || s.isCover) ? 0 : s.isEnding ? 2 : 1);
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return Number(a.id) - Number(b.id);
  }).map(s => {
    const t     = _sceneTypeLabel(s);
    const r     = _sceneRoles(s);
    const roleTxt = [
      r.isEntry  ? '[첫 감상]'   : '',
      r.isReplay ? '[다시 시작점]' : '',
    ].filter(Boolean).join(' ');
    const titleTxt = s.title ? s.title.slice(0, 20) : '(제목 없음)';
    const label = roleTxt
      ? `${s.id} · ${titleTxt} · ${t} ${roleTxt}`
      : `${s.id} · ${titleTxt} · ${t}`;
    const sel   = s.id === scene.id ? 'selected' : '';
    return `<option value="${escHtml(s.id)}" ${sel}>${escHtml(label)}</option>`;
  }).join('');

  return `
    <div class="edit-nav">
      <div class="edit-nav-row edit-nav-row--main">
        <button class="edit-nav-btn js-edit-nav-prev" ${hasPrev ? '' : 'disabled'} title="이전 장면">←</button>
        <div class="edit-nav-info">
          <div class="edit-nav-info-top">
            <span class="edit-nav-num">장면 ${num}</span>
            <span class="edit-nav-badge ${typeClass}">${type}</span>
            ${roleBadgesHtml}
            <span class="edit-nav-counter">${idx + 1} / ${total}</span>
          </div>
          <div class="edit-nav-info-title" title="${escHtml(title)}">${escHtml(title)}</div>
        </div>
        <button class="edit-nav-btn js-edit-nav-next" ${hasNext ? '' : 'disabled'} title="다음 장면">→</button>
      </div>
      <div class="edit-nav-row edit-nav-row--jump">
        <select class="edit-nav-jump js-edit-nav-jump" id="edit-nav-jump" title="장면 목록에서 선택">
          ${optionsHtml}
        </select>
      </div>
    </div>`;
}

function _bindNavEvents(panel) {
  const list = _editSceneList();
  const idx  = _currentSceneIndex();

  panel.querySelector('.js-edit-nav-prev')?.addEventListener('click', () => {
    if (idx > 0) editNavigateTo(list[idx - 1].id);
  });
  panel.querySelector('.js-edit-nav-next')?.addEventListener('click', () => {
    if (idx < list.length - 1) editNavigateTo(list[idx + 1].id);
  });

  /* 장면 목록 점프 — change 이벤트로 즉시 이동 */
  panel.querySelector('.js-edit-nav-jump')?.addEventListener('change', e => {
    const targetId = e.target.value;
    if (targetId && targetId !== ViewerState.currentSceneId) {
      editNavigateTo(targetId);
    }
  });
}

/* ================================================================
   edit panel 렌더 (메인)
   ================================================================ */
function renderEditPanel() {
  const panel = document.getElementById('edit-panel');
  if (!panel) return;

  const scene = ViewerState.scenes[ViewerState.currentSceneId];
  if (!scene) return;

  /* W8 fix #2: 재렌더 전 현재 활성 탭 기억 — 사용자가 [내용]에서 선택지 추가했는데
     첫 탭(예: 그림책 모드)으로 리셋되는 문제 방지. */
  const _prevActiveTab = panel.querySelector('.edit-tab.is-on')?.getAttribute('data-tab') || null;

  /* ── 선택지 없는 장면(엔딩 등) ── */
  if (scene.choices.length === 0) {
    const _ptype = _resolveViewerProjectType();
    const tabs = _editTabsForMode(_ptype, /*hasChoice*/ false);
    panel.innerHTML = `
      <div class="edit-panel-inner${_ptype === 'movie' ? ' edit-panel-inner--movie' : ''}">
        ${_editActionsHtml()}
        ${_editNavHtml(scene)}

        <!-- W8 Phase D-2: 모드별 탭 이름·아이콘·우선순위 -->
        <div class="edit-tabs" role="tablist">
          ${tabs.map((t, i) => `
            <button type="button" class="edit-tab${i===0?' is-on':''}" data-tab="${t.key}" role="tab">${t.label}</button>
          `).join('')}
        </div>

        ${tabs.map((t, i) => `
          <div class="edit-tab-panel${i===0?' is-on':''}" data-panel="${t.key}">
            ${t.html(scene, _ptype)}
          </div>
        `).join('')}

        <!-- 엔딩은 선택지 없음 — 별도 안내 -->
        <div class="edit-divider"></div>
        <p class="edit-empty">이 장면에는 선택지가 없어요. (엔딩 장면)</p>
      </div>`;
    _bindEditActions(panel);
    _bindNavEvents(panel);
    _bindTypeSectionsEvents(panel, scene);
    _bindTextEditEvents(panel, scene);
    _bindEditTabs(panel);
    _restoreActiveTab(panel, _prevActiveTab);
    _installLockChangeHandlerOnce();
    _ensureEditLockForCurrentScene();
    return;
  }

  /* ── 선택지 있는 장면 ── */
  const selectedId = ViewerState.selectedChoiceId;
  const choice     = selectedId
    ? (scene.choices.find(c => c.id === selectedId) ?? scene.choices[0])
    : scene.choices[0];

  if (!choice) return;
  ViewerState.selectedChoiceId = choice.id;

  const p         = choice.presentation;
  const sizeKey   = _getSizePreset(p);
  const isOverlay = p.placement === 'overlay';

  /* ─────────────────────────────────────────────────────────────
     ③ 선택지 표현 섹션 노출 정책 (3단계 갱신)
     ─────────────────────────────────────────────────────────────
     1단계 이후 작품 단위 projectType이 4종 중 하나로 결정되면 legacy
     placement/size/stylePreset/opacity 컨트롤은 새 _renderScene*에서
     무시되므로 통째 숨김. 이전 코드에서 사용하던 scene.presentationMode
     기준 isV03Mode 분기는 더 이상 필요 없음 — 다만 안전을 위해 둘 중 하나만
     맞아도 v0.3로 인정. */
  const _ptypeForLegacy = _resolveViewerProjectType();
  const isV03Project = ['text', 'picturebook', 'movie', 'experience'].includes(_ptypeForLegacy);
  const isV03Mode = isV03Project ||
                    scene.presentationMode === 'text' ||
                    scene.presentationMode === 'picturebook' ||
                    scene.presentationMode === 'movie';
  const showLegacyChoiceSection = !isV03Mode;

  /* legacy 섹션 HTML — 보여줄 때만 사용 */
  const legacyChoiceSectionHtml = showLegacyChoiceSection ? `
      <!-- 【3】 선택지 표현 — 탭 + 위치/크기/스타일/투명도 (기존 모드 전용)
           v0.3 명시 모드에서는 _renderScene*가 placement/size/style/opacity를
           무시하므로 이 섹션 자체를 숨긴다. document(보류) 또는 모드 미지정인
           기존 작품에서만 노출. -->
      <div class="edit-divider"></div>
      <h4 class="edit-section-title edit-section-title--major">
        ③ 선택지 표현
        <span class="edit-section-tag">기존 모드 전용</span>
      </h4>
      <div class="edit-section-hint">
        이 섹션은 기존 모드(기록물형 또는 모드 미지정 작품)에만 적용돼요.
        텍스트형 / 그림책형 / 무비형에서는 위치·크기·스타일이 모드 구조에 따라
        자동으로 결정됩니다.
      </div>
      <div class="edit-tabs">
        ${scene.choices.map(c => `
          <button class="edit-tab js-edit-tab ${c.id === choice.id ? 'edit-tab--active' : ''}"
            data-choice-id="${c.id}">
            ${escHtml(c.label || c.id)}
          </button>`).join('')}
      </div>

      <!-- 위치 방식 -->
      <div class="edit-row">
        <label class="edit-label">위치 방식</label>
        <div class="edit-toggle-group">
          <button class="edit-toggle js-placement ${!isOverlay ? 'active' : ''}" data-val="bottom">
            하단 고정
          </button>
          <button class="edit-toggle js-placement ${isOverlay ? 'active' : ''}" data-val="overlay">
            자유 배치
          </button>
        </div>
      </div>

      ${isOverlay ? `
      <!-- 자유 배치: 드래그 안내 -->
      <div class="edit-drag-hint">
        💡 선택지를 직접 드래그해서 위치를 바꿀 수 있어요
      </div>` : ''}

      <!-- 크기 단계 -->
      <div class="edit-row">
        <label class="edit-label">글자 크기</label>
        <div class="edit-toggle-group">
          <button class="edit-toggle js-size-preset ${sizeKey === 'small'  ? 'active' : ''}" data-val="small">작게</button>
          <button class="edit-toggle js-size-preset ${sizeKey === 'medium' ? 'active' : ''}" data-val="medium">보통</button>
          <button class="edit-toggle js-size-preset ${sizeKey === 'large'  ? 'active' : ''}" data-val="large">크게</button>
        </div>
      </div>

      <!-- 스타일 -->
      <div class="edit-row">
        <label class="edit-label">스타일</label>
        <div class="edit-toggle-group">
          ${['basic','ghost','pin'].map(preset => `
            <button class="edit-toggle js-preset ${(p.stylePreset ?? 'basic') === preset ? 'active' : ''}" data-val="${preset}">
              ${{ basic:'기본', ghost:'고스트', pin:'핀' }[preset]}
            </button>`).join('')}
        </div>
      </div>

      <!-- 투명도 -->
      <div class="edit-row">
        <label class="edit-label">투명도</label>
        <div class="edit-opacity-row">
          <button class="edit-opacity-btn js-opacity-down">－</button>
          <span class="edit-opacity-val js-opacity-val">${Math.round((p.opacity ?? 1) * 100)}%</span>
          <button class="edit-opacity-btn js-opacity-up">＋</button>
        </div>
      </div>` : '';

  const tabs = _editTabsForMode(_ptypeForLegacy, /*hasChoice*/ !!legacyChoiceSectionHtml);
  panel.innerHTML = `
    <div class="edit-panel-inner${_ptypeForLegacy === 'movie' ? ' edit-panel-inner--movie' : ''}">
      <!-- 상단 고정 바 (액션 + 네비) -->
      ${_editActionsHtml()}
      ${_editNavHtml(scene)}

      <!-- W8 Phase D-2: 모드별 탭 이름·아이콘·우선순위 -->
      <div class="edit-tabs" role="tablist">
        ${tabs.map((t, i) => `
          <button type="button" class="edit-tab${i===0?' is-on':''}" data-tab="${t.key}" role="tab">${t.label}</button>
        `).join('')}
      </div>

      ${tabs.map((t, i) => `
        <div class="edit-tab-panel${i===0?' is-on':''}" data-panel="${t.key}">
          ${t.key === 'choice' ? legacyChoiceSectionHtml : t.html(scene, _ptypeForLegacy)}
        </div>
      `).join('')}
    </div>`;

  _bindEditActions(panel);
  _bindNavEvents(panel);
  _bindTypeSectionsEvents(panel, scene);
  _bindEditPanelEvents(panel, scene, choice);
  _bindTextEditEvents(panel, scene);
  _bindEditTabs(panel);
  _restoreActiveTab(panel, _prevActiveTab);
  _installLockChangeHandlerOnce();
  _ensureEditLockForCurrentScene();
}

/* ================================================================
   이벤트 바인딩
   ================================================================ */
function _bindEditPanelEvents(panel, scene, choice) {
  const p = choice.presentation;

  /* 선택지 탭 전환 */
  panel.querySelectorAll('.js-edit-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      ViewerState.selectedChoiceId = tab.dataset.choiceId;
      renderEditPanel();
      renderCurrentScene();
    });
  });

  /* 위치 방식 전환 */
  panel.querySelectorAll('.js-placement').forEach(btn => {
    btn.addEventListener('click', () => {
      p.placement = btn.dataset.val;
      if (p.placement === 'overlay' && p.x == null) {
        p.x = 50; p.y = 50;
      }
      renderEditPanel();
      renderCurrentScene();
    });
  });

  /* 크기 단계 */
  panel.querySelectorAll('.js-size-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      _applySizePreset(p, btn.dataset.val);
      renderEditPanel();
      renderCurrentScene();
    });
  });

  /* 스타일 */
  panel.querySelectorAll('.js-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      p.stylePreset = btn.dataset.val;
      renderEditPanel();
      renderCurrentScene();
    });
  });

  /* 투명도 단계 버튼 */
  const OPACITY_STEP = 0.1;
  panel.querySelector('.js-opacity-down')?.addEventListener('click', () => {
    p.opacity = Math.max(0.1, Math.round(((p.opacity ?? 1) - OPACITY_STEP) * 10) / 10);
    panel.querySelector('.js-opacity-val').textContent = Math.round(p.opacity * 100) + '%';
    renderCurrentScene();
  });
  panel.querySelector('.js-opacity-up')?.addEventListener('click', () => {
    p.opacity = Math.min(1, Math.round(((p.opacity ?? 1) + OPACITY_STEP) * 10) / 10);
    panel.querySelector('.js-opacity-val').textContent = Math.round(p.opacity * 100) + '%';
    renderCurrentScene();
  });

  /* 저장 */
  panel.querySelector('.js-edit-save')?.addEventListener('click', () => _doSave(panel));
}

/* ── 저장 공통 ── */
async function _doSave(panel) {
  /* v129: 읽기전용(잠금) 상태에선 저장 박지 X — 안전망 (CSS pointer-events:none과 별개로
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
   다듬기에서 박은 본문 \n이 감상 후 사라지던 root 버그 fix. */
function _extractEditableText(el) {
  const html = (el.innerHTML || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p)>/gi, '')
    .replace(/<(div|p)[^>]*>/gi, '\n');
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  /* v127: 옛 .replace(/^\n/, '') 박지 X — 사용자가 본문 앞에 \n\n 박은 거가
     의도된 빈 줄. 첫 \n 박지 X 박은 게 사용자 박은 표현 박지 X 박힘.
     browser가 첫 <div> 박을 때 박은 \n 박는 거 = 사용자 박은 거와 구분 안 박힘.
     사용자 박은 거 우선 — 첫 \n도 유지. */
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
       scene.choices[idx].label 박은 거 박은 박은 — _queueSaveButtons로 저장.
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
         scene 메모리 박지 X + 저장 큐 박지 X. choice-label과 동일 패턴. */
      if (!_editText.editable) return;
      /* v45: 본문은 줄바꿈 보존(_extractEditableText), 제목은 단일 줄(textContent) */
      const text = (field === 'body') ? _extractEditableText(el) : el.textContent;
      scene[field] = text;
      _updatePlaceholder();
      /* v122: 다듬기 패널의 해당 input/textarea 즉시 갱신 (있으면).
         옛 오타 fix: '#edit-pane' → '#edit-panel' (실제 id). 옛엔 셀렉터가 박지 X
         → 왼쪽 화면 수정해도 오른쪽 패널 input 박지 X (사용자 박은 양방향 동기 버그).
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
         blur로 박은 마지막 입력도 저장 큐 박지 X. */
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
    });

    /* Enter 키 — title/kicker/subtitle 단일 줄 (Enter blur), body는 자연 줄바꿈 허용.
       2026-05-27 Cover-1: kicker/subtitle도 표지 단일 줄 입력이라 동일 처리. */
    if (field === 'title' || field === 'kicker' || field === 'subtitle') {
      el.addEventListener('keydown', e => {
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
   · 한 줄 입력 (Enter 박으면 blur)
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

  /* maxLen — ptype별 (_getChoiceLabelMaxViewer 박은 거 박은 박은 거 박은 박은) */
  const _ptype = (typeof ViewerState !== 'undefined' && ViewerState.project &&
                  ViewerState.project.projectType) || null;
  const maxLen = (typeof _getChoiceLabelMaxViewer === 'function')
    ? _getChoiceLabelMaxViewer(_ptype) : 60;

  let choiceSaveTimer = null;

  el.addEventListener('input', () => {
    if (!_editText.editable) return;
    let value = el.textContent;
    /* maxLen 안전망 — paste 등으로 초과 시 절단 */
    if (value.length > maxLen) {
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

    /* debounce 저장 — _queueSaveButtons 박음 */
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

  /* Enter — 한 줄 입력 (title과 동일) */
  el.addEventListener('keydown', e => {
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
    /* 메모리 박기 + DB 저장 큐 — _editText.num 매칭 안 되면 _queueSave 가드에 걸리므로
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
      /* height 명시값으로 박기 — null이면 현재 보이는 높이를 % 추정해서 시작값으로 */
      if (typeof startBox.height !== 'number') {
        const stageRect = stage.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();
        startBox.height = (overlayRect.height / stageRect.height) * 100;
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
        box.height = Math.max(12, Math.min(90, box.height));
        box.x      = Math.max(0,  Math.min(100 - box.width,  box.x));
        box.y      = Math.max(0,  Math.min(100 - box.height, box.y));
        box.x      = Math.round(box.x * 10) / 10;
        box.y      = Math.round(box.y * 10) / 10;
        box.width  = Math.round(box.width * 10) / 10;
        box.height = Math.round(box.height * 10) / 10;
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
function _textEditHtml(scene) {
  /* title/body 분리 — viewer-data에서 이미 하위호환 해석 완료 상태
     (기존 작품은 title='' / body=원래title로 매핑됨). */
  const titleVal = scene.title || '';
  const bodyVal  = scene.body  || '';

  /* UX 마감 (1-2): 제목 없는 장면·본문 없는 장면의 안내 힌트 */
  const titleHint = titleVal ? '' :
    `<div class="edit-field-hint">제목은 비워도 돼요 — 제목 없이 본문만 있는 장면도 가능해요.</div>`;
  const bodyHint  = bodyVal ? '' :
    `<div class="edit-field-hint">장면에서 읽을 내용이에요. 대사·설명·상황 묘사 모두 여기에.</div>`;

  /* ── 버튼 N개 (v0.3): scene.choices 배열을 그대로 ──
     W6 개념 통일: 체험전시형은 행동 버튼 개념을 사용하지 않고 연결오브젝트(connectObjects)로
     모든 이동을 처리하므로, 이 섹션은 체험전시형 작품에서 제외한다. */
  const isEnding = scene.type === 'ending';
  const choices  = Array.isArray(scene.choices) ? scene.choices : [];
  const _ptypeForButtons = (ViewerState && ViewerState.project &&
                            ViewerState.project.projectType) || null;
  const isExperience = _ptypeForButtons === 'experience';

  /* 엔딩 장면 + 체험전시형은 버튼 편집 UI 없음 */
  const buttonsBlock = (isEnding || isExperience) ? '' : _buttonsEditHtml(choices);

  /* W8: 그림책 모드일 때 [내용] 탭 안에 글자 스타일 UI 통합.
     사용자 보고: 폰트↔내용 탭 왕복 불편 → 본문 옆에 폰트·크기·색·굵기 항상 보이게.
     그림책 모드에만 추가 (텍스트형은 별도 처리 — 텍스트형 글자 스타일은 [스타일] 탭 안에 풍부히). */
  const isPicturebookMode = _ptypeForButtons === 'picturebook';
  const pbStyleInlineHtml = isPicturebookMode ? _pbInlineStyleHtml(scene) : '';

  /* 2026-05-27 Phase 4-D-1: 우측 2단 (📝 내용) 접이식 wrapper.
     · 표지 / 그림책 외 모드(텍스트/무비/체험) → 강제 펼침 — 이 분기는 2단 의존성 큼
     · 그림책 일반 / 그림책 엔딩 → default 접힘, 사용자 토글 가능
     · 잠금 배너는 wrapper 밖 — 잠금 충돌은 접혀있어도 항상 보여야 안전
     · 내부 마크업·이벤트·저장 흐름 0 수정 — wrapper와 collapsed 분기만 박음 */
  const _isCoverForCollapse = !!(scene && scene.type === 'cover');
  const _isEndingForCollapse = !!(scene && (scene.type === 'ending' || scene.isEnding));
  /* 2026-05-27 Cover-2: 표지 강제 펼침 조건 제거.
     Cover-1으로 kicker/title/subtitle 미리보기 직접 입력 박힌 후 2단 의존성 사라짐.
     표지도 그림책 일반/엔딩과 동일하게 default 접힘 + compact 360 흐름.

     2026-05-30 Text-1: 텍스트 모드도 접힘/펼침 허용 — 그림책과 동일 compact 360 UX.
     2026-05-31 Movie-C: 무비형도 접힘/펼침 허용(패널 단순화 — text/그림책과 통일).
     experience만 강제 펼침 유지. */
  const _forceTextEditExpanded =
    _ptypeForButtons !== 'picturebook' && _ptypeForButtons !== 'text' && _ptypeForButtons !== 'movie';
  let _textEditIsCollapsed;
  if (_forceTextEditExpanded) {
    _textEditIsCollapsed = false;
  } else if (_textEditCollapsed === null) {
    _textEditIsCollapsed = true;   /* 그림책 일반 + 엔딩 default 접힘 */
  } else {
    _textEditIsCollapsed = !!_textEditCollapsed;   /* 사용자 명시 토글값 */
  }
  /* 2026-05-27 Phase 4-D-2: 저장 상태(.js-edit-text-status)를 헤더 안으로 이동.
     접힌 상태에서도 저장 중/저장됨/저장 실패 메시지가 보이게 위함.
     · _showSaveStatus는 그대로 — querySelector('.js-edit-text-status') 단일 매칭
     · 표지/일반 두 분기 body 안 옛 status row 제거 (DOM 단일 위치 유지) */
  const _textEditHeaderHtml = `
    <button type="button"
      class="edit-collapsible-header js-text-edit-toggle ${_textEditIsCollapsed ? 'is-collapsed' : 'is-expanded'}"
      aria-expanded="${!_textEditIsCollapsed}">
      <span class="edit-collapsible-header-text">📝 내용 고급 편집</span>
      <span class="js-edit-text-status edit-text-status edit-text-status--in-header" aria-live="polite"></span>
      <span class="edit-collapsible-header-chev">${_textEditIsCollapsed ? '▼' : '▲'}</span>
    </button>`;

  /* v37: 표지 scene 콘텐츠 영역 — 제목 + 한 줄 소개만 (본문·행동 버튼 X)
     v129: 표지 상단 문구(kicker) input 추가. 옛엔 팀 이름 자동 표시였음 → 사용자가 직접 박는 값.
           비우면 표지 상단에 아무것도 표시 안 됨. */
  if (scene && scene.type === 'cover') {
    const subtitleVal = scene.subtitle || '';
    const kickerVal   = scene.kicker   || '';
    return `
      <div class="js-edit-lock-banner edit-lock-banner" style="display:none;"></div>
      <div class="edit-text-advanced-wrap">
        ${_textEditHeaderHtml}
        ${_textEditIsCollapsed ? '' : `
          <div class="edit-collapsible-body edit-text-advanced-body">
            <div class="edit-row">
              <label class="edit-label" for="edit-cover-kicker">🏷 표지 상단 문구 <span class="edit-label-note">(선택)</span></label>
              <input id="edit-cover-kicker" type="text"
                class="edit-text-input edit-text-input--choice js-edit-text-input js-edit-cover-kicker"
                value="${escHtml(kickerVal)}"
                placeholder="예: 4학년 1반 작품 (비우면 표시 안 됨)"
                maxlength="30">
              <div class="edit-field-hint">작품 제목 위에 작게 보이는 문구예요. 비워두면 표시되지 않아요.</div>
            </div>
            <div class="edit-row">
              <label class="edit-label" for="edit-scene-title">📖 작품 제목</label>
              <input id="edit-scene-title" type="text"
                class="edit-text-input edit-text-input--choice js-edit-text-input js-edit-title"
                value="${escHtml(titleVal)}"
                placeholder="작품 제목">
            </div>
            <div class="edit-row">
              <label class="edit-label" for="edit-scene-subtitle">✍ 한 줄 소개 <span class="edit-label-note">(선택)</span></label>
              <input id="edit-scene-subtitle" type="text"
                class="edit-text-input edit-text-input--choice js-edit-text-input js-edit-cover-subtitle"
                value="${escHtml(subtitleVal)}"
                placeholder="짧은 한 줄 소개">
            </div>
          </div>`}
      </div>`;
  }

  return `
    <div class="js-edit-lock-banner edit-lock-banner" style="display:none;"></div>
    <div class="edit-text-advanced-wrap">
      ${_textEditHeaderHtml}
      ${_textEditIsCollapsed ? '' : `
        <div class="edit-collapsible-body edit-text-advanced-body">
          <div class="edit-row">
            <label class="edit-label" for="edit-scene-title">📝 제목 <span class="edit-label-note">(짧은 헤드라인)</span></label>
            <input id="edit-scene-title" type="text"
              class="edit-text-input edit-text-input--choice js-edit-text-input js-edit-title"
              value="${escHtml(titleVal)}"
              placeholder="짧은 제목 (선택)">
            ${titleHint}
          </div>

          <div class="edit-row">
            <label class="edit-label" for="edit-scene-body">📜 본문 <span class="edit-label-note">(장면에서 읽을 글)</span></label>
            <textarea id="edit-scene-body"
              class="edit-text-input edit-text-input--body js-edit-text-input js-edit-body"
              rows="5"
              placeholder="장면에 보여줄 내용을 적어주세요.">${escHtml(bodyVal)}</textarea>
            ${bodyHint}
          </div>

          ${buttonsBlock}
        </div>`}
    </div>`;
}

/* ================================================================
   버튼 N개 편집 UI (v0.3)
   ─────────────────────────────────────────────────────────────
   · 입력란 N개 (data-idx로 식별)
   · 각 행에 [삭제] (단, 1개일 땐 버튼 보이지 않음 — 0개 방지)
   · 하단 [+ 버튼 추가]
   · 글자 수 카운터 (30자 권장 / 60자 한계)
   · 분기 연결(nextId)은 표시만, 이번 턴엔 변경 안 함 (구조 유지)
   ================================================================ */
function _buttonsEditHtml(choices) {
  const rows = choices.map((c, i) => _buttonRowHtml(c, i, choices.length)).join('');

  /* 0개 상태 안내 + 추가 버튼 */
  const emptyHint = choices.length === 0
    ? `<div class="edit-field-hint edit-field-hint--warn">
         행동 버튼이 없어요. 최소 1개의 버튼이 필요합니다.
       </div>`
    : '';

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
      <div class="edit-buttons-actions">
        <button type="button" class="edit-btn-add js-edit-btn-add">
          + 버튼 추가
        </button>
      </div>
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

  /* 2026-05-28 Codex review fix (High-Risk 3): 1단과 동일 안전 정책 박음.
     · 표지 제외 / 자기 자신 disabled + [현재 장면] 라벨 / 엔딩 [엔딩] 라벨
     · 옛 정책("자기 자신도 옵션에 포함") 폐기 — 무한 루프 / 표지 회귀 위험 차단
     · 정책 단일 출처 — `_buildLinkSelectOptionsHtml` 재사용 (Phase 4-C)
     · ViewerState.currentSceneId 박은 거 박음 — 다듬기 패널 박힌 시점에 항상 박혀있음
     · currentScene fallback 박지 X 박으면 빈 옵션 — 안전 우선 (옛 무필터 옵션 박지 X) */
  const currentNext = choice && choice.nextId ? String(choice.nextId) : '';
  const _curSceneId = (typeof ViewerState !== 'undefined' && ViewerState.currentSceneId)
    ? String(ViewerState.currentSceneId) : '';
  const _curScene = (typeof ViewerState !== 'undefined' && ViewerState.scenes && _curSceneId)
    ? ViewerState.scenes[_curSceneId] : null;
  const optionsHtml = (_curScene && typeof _buildLinkSelectOptionsHtml === 'function')
    ? _buildLinkSelectOptionsHtml(_curScene, currentNext)
    : '';

  const nextSelectHtml = `
    <select class="edit-btn-next-select js-edit-btn-next" data-idx="${idx}">
      <option value=""${currentNext ? '' : ' selected'}>(미연결)</option>
      ${optionsHtml}
    </select>`;

  /* 1개일 때는 삭제 버튼 숨김 (0개 방지) */
  const removeBtn = total > 1
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

function _bindTextEditEvents(panel, scene) {
  /* 2026-05-27 Phase 4-D-1 fix: 데스크탑 2컬럼 grid에서 1컬럼 전환 — :has() fallback.
     헤더의 .is-collapsed 클래스를 보고 panel-inner에 같은 의미 클래스 박음.
     CSS `.edit-panel-inner.is-text-collapsed { grid-template-columns: 1fr; }`가 받음.
     구형 학교 태블릿(:has() 미지원)에서도 동일 효과 박힘 — 학생 기기별 화면 차이 차단.

     2026-05-27 Phase 4-D-3: panel 자체에도 같은 클래스 박음 — 데스크탑(≥1025)
     overlay 폭을 540 → 400으로 축소해 작품 영역 가림 완화.
     클래스 박는 분기: 그림책 일반/엔딩 default 접힘 → 양쪽 같이 박힘.
     표지/외 모드 강제 펼침 → 양쪽 같이 제거 → 폭 540 복원. */
  const panelInner = panel.querySelector('.edit-panel-inner');
  const toggleBtn = panel.querySelector('.js-text-edit-toggle');
  if (panelInner && toggleBtn) {
    const isC = toggleBtn.classList.contains('is-collapsed');
    panelInner.classList.toggle('is-text-collapsed', isC);
    panel.classList.toggle('is-text-collapsed', isC);
  }

  /* 2026-05-27 Phase 4-D-1: 우측 2단 (📝 내용) 접이식 헤더 토글.
     · 표지 / 그림책 외 모드는 강제 펼침 — 토글 시도해도 무력 (안전망).
     · 그림책 일반 + 엔딩만 토글 적용. _textEditCollapsed에 명시값 박힘.
     · localStorage 저장 X — 새로고침 시 default 복귀. */
  const _textEditToggle = panel.querySelector('.js-text-edit-toggle');
  if (_textEditToggle) {
    _textEditToggle.addEventListener('click', () => {
      const _ptype = (typeof _resolveViewerProjectType === 'function')
        ? _resolveViewerProjectType() : null;
      /* 2026-05-27 Cover-2: 표지 강제 펼침 분기 제거 (cover 조건 빼짐).
         2026-05-30 Text-1: text 허용. 2026-05-31 Movie-C: movie 허용 — experience만 강제 펼침. */
      if (_ptype !== 'picturebook' && _ptype !== 'text' && _ptype !== 'movie') return;
      const _cur = (_textEditCollapsed === null) ? true : !!_textEditCollapsed;
      _textEditCollapsed = !_cur;
      renderEditPanel();
    });
  }

  const titleEl = panel.querySelector('.js-edit-title');
  const bodyEl  = panel.querySelector('.js-edit-body');

  /* ── 제목 ── */
  if (titleEl) {
    titleEl.addEventListener('input', e => {
      if (!_editText.editable) return;
      scene.title = e.target.value;
      /* W7 깜빡임 차단: 매 키 입력마다 통째 재렌더하면 video 노드 새로 마운트 → 깜빡임.
         부분 패치로 viewer의 제목 노드만 갱신. 실패 시 통째 재렌더 fallback. */
      if (!_patchSceneTitle(scene.title)) _scheduleViewerFrameReRender();
      _queueSave(scene.id, { title: scene.title });
    });
    titleEl.addEventListener('blur', () => _flushPendingSave());
  }

  /* ── 본문 ── */
  if (bodyEl) {
    bodyEl.addEventListener('input', e => {
      if (!_editText.editable) return;
      scene.body = e.target.value;
      /* W7 깜빡임 차단: 매 키 입력마다 통째 재렌더 → 영상 깜빡임.
         부분 패치로 viewer의 본문 노드만 갱신. */
      if (!_patchSceneBody(scene.body)) _scheduleViewerFrameReRender();
      _queueSave(scene.id, { body: scene.body });
    });
    bodyEl.addEventListener('blur', () => _flushPendingSave());
  }

  /* v37: 표지 한 줄 소개 input */
  const subtitleEl = panel.querySelector('.js-edit-cover-subtitle');
  if (subtitleEl && scene.type === 'cover') {
    subtitleEl.addEventListener('input', e => {
      if (!_editText.editable) return;
      scene.subtitle = e.target.value;
      _scheduleViewerFrameReRender();
      _queueSave(scene.id, { subtitle: scene.subtitle });
    });
    subtitleEl.addEventListener('blur', () => _flushPendingSave());
  }

  /* v129: 표지 상단 문구(kicker) input — 작품 제목 위 작은 문구.
     입력 시 viewer 즉시 갱신 + debounce 저장. 비우면 표지에 안 보임. */
  const kickerEl = panel.querySelector('.js-edit-cover-kicker');
  if (kickerEl && scene.type === 'cover') {
    kickerEl.addEventListener('input', e => {
      if (!_editText.editable) return;
      scene.kicker = e.target.value;
      _scheduleViewerFrameReRender();
      _queueSave(scene.id, { kicker: scene.kicker });
    });
    kickerEl.addEventListener('blur', () => _flushPendingSave());
  }

  /* ── 버튼 N개 (v0.3) ── 표지는 행동 버튼 X */
  if (scene.type !== 'cover') {
    _bindButtonsEditEvents(panel, scene);
  }
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
function _typeSectionsHtml(scene, ptype) {
  /* v37: 표지 scene이면 type별 분기 무시하고 표지 전용 인스펙터 */
  if (scene && scene.type === 'cover') return _typeSectionCoverHtml(scene);

  /* v64: 첫 장면(표지 없는 작품)에 작품 단위 설정 추가 */
  const workSettings = _isWorkSettingScene(scene) ? _workSettingsSectionHtml() : '';

  let html = '';
  switch (ptype) {
    case 'text':       html = _typeSectionTextHtml(scene); break;
    case 'picturebook':html = _typeSectionPicturebookHtml(scene); break;
    case 'movie':      html = _typeSectionMovieHtml(scene); break;
    case 'experience': html = _typeSectionExperienceHtml(scene); break;
    default:           html = _typeSectionPicturebookHtml(scene);
  }
  return workSettings + html;
}

/* v64: 작품 단위 설정 위치 판단 — 표지 없는 작품에선 entry/첫 normal scene에 박음 */
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

/* v75: "이 글자 스타일을 모든 장면에 적용" 버튼 HTML — 첫 일반 장면 인스펙터에만 박힘.
   누르면 현재 scene의 textStyle을 다른 모든 normal scene에 복사 (Firebase update).
   표지/엔딩 제외. 한 번 누르면 한 번 push — 그 후 장면별 따로 박는 건 독립. */
function _applyStyleAllButtonHtml(scene) {
  if (!_isFirstNormalScene(scene)) return '';
  return `
    <div class="edit-row edit-row--compact" style="margin-top:8px;">
      <button type="button" class="js-apply-style-all edit-apply-all-btn"
        data-scene-id="${scene.id}"
        style="width:100%;padding:9px 12px;border:1.5px solid #c66f4a;background:#fffaee;color:#c66f4a;border-radius:8px;font-weight:600;cursor:pointer;font-size:13px;">
        📋 이 글자 스타일·테마를 모든 장면에 적용
      </button>
      <div class="edit-section-hint" style="margin-top:6px;">
        글자 스타일과 테마를 한 번에 통일해요. 이후 다른 장면에서 따로 박으면 그 장면만 변경돼요.
      </div>
    </div>`;
}

/* v64: 작품 단위 설정 UI — 장면 전환 효과 5개 + 텍스트 등장 6개
   v73: 속도를 pill(3단계)에서 슬라이더(0~100%)로. 더 정밀한 조정 + 더 느린 범위 가능. */
function _workSettingsSectionHtml() {
  const curT  = (ViewerState.project && ViewerState.project.sceneTransition) || 'fade';
  const curTE = (ViewerState.project && ViewerState.project.textEntrance) || 'none';
  /* v73: 속도 number(0~100). 옛 데이터 로드 시점에서 마이그레이션 박힘. */
  const curS  = typeof ViewerState.project?.sceneTransitionSpeed === 'number'
    ? ViewerState.project.sceneTransitionSpeed : 50;
  const curTES = typeof ViewerState.project?.textEntranceSpeed === 'number'
    ? ViewerState.project.textEntranceSpeed : 50;

  const TRANS = [
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
      <div class="edit-section-hint">scene 진입할 때 들어가는 효과예요. 모든 장면에 적용돼요.</div>
      <div class="edit-toggle-group" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
        ${transPills}
      </div>
    </div>
    <div class="edit-row edit-row--compact">
      <label class="edit-label">⏱ 전환 속도 <span class="edit-label-note">(빠름 ◀ ${curS}% ▶ 느림)</span></label>
      <input type="range" class="edit-slider js-scene-transition-speed"
        min="0" max="100" step="1" value="${curS}">
    </div>
    <div class="edit-row">
      <label class="edit-label">📝 텍스트 등장 효과 <span class="edit-label-note">(작품 전체)</span></label>
      <div class="edit-section-hint">본문·표지 제목이 한 글자/한 덩어리씩 등장하는 효과예요.</div>
      <div class="edit-toggle-group" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
        ${textEntPills}
      </div>
    </div>
    <div class="edit-row edit-row--compact">
      <label class="edit-label">⏱ 텍스트 속도 <span class="edit-label-note">(빠름 ◀ ${curTES}% ▶ 느림)</span></label>
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
/* v121: previewWorkEffect throttle — 슬라이더 input 박을 때마다 박지 X.
   previewWorkEffect는 scene.offsetWidth 강제 reflow + typewriter span 재생성 박힘.
   슬라이더 박을 때 매 input마다 박으면 태블릿/저성능 PC 박지 X. 150ms throttle 박음.
   저장은 change에 박힌 거 옛 그대로. */
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
      label.textContent = `(빠름 ◀ ${pct}% ▶ 느림)`;
    }
    /* v121: 미리보기 throttle (옛엔 매 input마다 박음 → 태블릿 부담) */
    _schedulePreviewWorkEffect(field);
  });
  slider.addEventListener('change', async () => {
    const pct = Math.max(0, Math.min(100, parseInt(slider.value, 10) || 0));
    /* v122: change 시 마지막 값으로 CSS 변수 재적용 + preview 한 번 더.
       v121 throttle 박은 거 때문에 마지막 input 박은 값이 pending 상태로 박힐 수 있음.
       change 박힐 때 최종 값으로 다시 박아 정합 보장. */
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
   첫 일반 장면 인스펙터에만 박힌 버튼. 클릭 시 현재 scene의 textStyle을 다른
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
    /* v75 fix: ViewerState.scenes는 num 필드 없고 id만 박힘 (adaptScenes에서 id = String(raw.num)).
       Firebase 노드 키도 num 값과 동일하니 s.id 그대로 saveSceneText(id) 호출 OK.
       2026-05-31 Text-4: 텍스트 모드는 엔딩도 textTheme/textStyle을 쓰므로(Text-4로 일반 장면과
       동일 판형) 전체 적용 대상에 엔딩 포함. 표지(coverTheme 별개)는 계속 제외. 그림책/무비/체험은
       엔딩이 별도 시스템이라 옛대로 엔딩 제외(회귀 차단) — _includeEnding은 text일 때만 true. */
    const _ptype = (ViewerState && ViewerState.project) ? ViewerState.project.projectType : null;
    const _includeEnding = _ptype === 'text';
    const targets = list.filter(s => {
      if (!s) return false;
      if (s.type === 'cover' || s.isCover) return false;
      if (!_includeEnding && (s.type === 'ending' || s.isEnding)) return false;
      if (String(s.id) === String(scene.id)) return false;
      if (typeof s.id === 'undefined' || s.id === null) return false;
      return true;
    });
    console.log('[applyStyleAll]', { sourceSceneId: scene.id, targetCount: targets.length, targets: targets.map(s => s.id) });
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

    let okCount = 0;
    let failCount = 0;
    for (const s of targets) {
      try {
        await saveSceneText(s.id, { textStyle: { ...style }, textTheme: theme });
        /* in-memory scene 데이터도 즉시 갱신 — 다음 인스펙터 박힐 때 반영 */
        s.textStyle = { ...style };
        s.textTheme = theme;
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
  }
}

/* v37: 표지 전용 인스펙터 — 제목 + 한 줄 소개 + 표지 색 + 제목 높낮이.
   사용자 결정: 표지는 별도 레이아웃, 그림·선택지 X. 항상 가운데 정렬. */
function _typeSectionCoverHtml(scene) {
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
  const curTheme = scene.coverTheme || 'default';
  const titleY = typeof scene.titleVerticalPosition === 'number' ? scene.titleVerticalPosition : 50;
  const themePills = COVER_THEMES.map(t => `
    <button type="button"
      class="edit-cover-theme js-cover-theme ${curTheme === t.id ? 'active' : ''}"
      data-val="${t.id}"
      style="background:${t.color};"
      title="${t.label}"></button>`).join('');

  return `
    <div class="edit-row">
      <label class="edit-label">🎨 표지 색</label>
      <div class="edit-cover-theme-row">${themePills}</div>
    </div>
    <div class="edit-row edit-row--compact">
      <label class="edit-label">↕ 제목 높낮이 <span class="edit-label-note">(${titleY}%)</span></label>
      <input type="range" class="edit-slider js-cover-title-y"
        min="20" max="80" step="5" value="${titleY}">
      <div class="edit-section-hint">위쪽(20) ↔ 가운데(50) ↔ 아래쪽(80). 가운데 정렬은 유지.</div>
    </div>
    <div class="edit-section-hint edit-section-hint--lock">
      📖 표지는 작품 입구예요. 제목·한 줄 소개·표지 색·높낮이만 다듬을 수 있어요.
    </div>
    ${_pbThemeSectionHtml()}
    ${_workSettingsSectionHtml()}`;
}

/* ── 1) 텍스트형 전용 섹션 ─────────────────────────────────────
   기준 노출: 글자박스 편집(폰트/크기/색/굵기), 효과, 테마
   3단계 범위: 진입점 자리만 잡고 "추후 추가" 안내. 미구현 기능은 발명 안 함. */
function _typeSectionTextHtml(scene) {
  /* W5: 텍스트형 본격 보강 — placeholder 폐기, 정식 편집 UI.
     · 글자 스타일: 폰트(8종) / 크기(슬라이더) / 색(팔레트 + 자유) / 굵기
     · 테마: 8종 카드 (데이터로는 textTheme, viewer는 data-text-theme 분기 → CSS) 
     · 효과: 진입 / 본문 (1차는 진입 구조만) */
  const style  = (typeof getTextStyle  === 'function') ? getTextStyle(scene)  : { fontFamily: 'gothic', fontSize: 16, color: '', weight: 'normal' };
  const theme  = (typeof getTextTheme  === 'function') ? getTextTheme(scene)  : 'classic';
  const effect = (typeof getTextEffect === 'function') ? getTextEffect(scene) : { entrance: 'none', body: 'none' };

  /* W9 폰트 18종 + UI select dropdown — 그림책 인라인과 동일 구성 */
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
  /* v36: var(--font-X) 대신 실제 폰트명 inline 박음 — select option은 CSS 변수
     cascading이 OS 네이티브 렌더링 때문에 적용 안 되는 경우 있음. 직접 값으로 robust. */
  const fontOptions = FONTS.map(f => {
    const ff = (TEXT_FONT_FAMILIES && TEXT_FONT_FAMILIES[f.id]) || 'inherit';
    return `<option value="${f.id}"
      style="font-family:${ff}"
      ${style.fontFamily === f.id ? 'selected' : ''}>${f.label}</option>`;
  }).join('');

  /* 색 팔레트 (8개) — + 자유 입력 */
  /* v36: 범용 색 4개 추가 (14개) — 회색·하늘색·연두·살색 */
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

  /* 테마 8종 카드 */
  const THEMES = [
    { id: 'classic',     label: '클래식',   desc: '깔끔한 흰 배경' },
    { id: 'novel',       label: '소설',     desc: '베이지 배경 + 명조' },
    { id: 'paperbook',   label: '종이책',   desc: '오래된 종이 톤' },
    { id: 'note',        label: '노트',     desc: '격자 무늬 + 손글씨' },
    { id: 'magazine',    label: '잡지',     desc: '굵은 헤드라인' },
    { id: 'handwriting', label: '손글씨',   desc: '편지지 풍' },
    { id: 'retro',       label: '레트로',   desc: '검은 배경 + 픽셀' },
    { id: 'dark',        label: '다크',     desc: '어두운 톤' },
  ];
  const themeCards = THEMES.map(t => `
    <button type="button"
      class="edit-theme-card edit-theme-card--${t.id} js-edit-text-theme ${theme === t.id ? 'active' : ''}"
      data-val="${t.id}">
      <div class="edit-theme-card-name">${t.label}</div>
      <div class="edit-theme-card-desc">${t.desc}</div>
    </button>`).join('');

  /* 2026-05-31 Text-3B: 스타일/테마/효과를 접이식 섹션으로 정리 (UI 표시만, 기능·핸들러·저장 불변).
     · 글자 스타일 = 기본 펼침(주 동선), 테마/효과 = 기본 접힘.
     · 생성 collapsible 패턴(.edit-collapsible-header/.edit-collapsible-body) 재사용 — 그림책과 동일.
     · 내부 컨트롤 클래스(js-edit-text-*)·전체 적용 버튼은 그대로 → 기존 핸들러 그대로 바인딩. */
  const _sc = _textStyleSecCollapsed;
  const _tc = _textThemeSecCollapsed;
  const _ec = _textEffectSecCollapsed;
  return `
    <div class="edit-divider"></div>
    <h4 class="edit-section-title edit-section-title--major">② 텍스트형 설정</h4>
    <div class="edit-section-hint">
      텍스트형은 글이 주인공입니다. 본문 위계가 가장 크고, 제목은 보조, 선택지는 카드 하단입니다.
    </div>

    <!-- 2026-05-31 Text-2D: 1단 행동 버튼 개수/연결 — 그림책 helper 재사용(모드 무관).
         일반 장면만(helper가 표지/엔딩 빈 문자열). 라벨 input은 미리보기 직접입력(Text-2C)+
         내용 고급 편집(2단)에 맡기고, 1단은 개수+연결만. 저장은 _queueSaveButtons 그대로. -->
    ${_pbChoiceCountSectionHtml(scene)}
    ${_pbChoiceLinkSectionHtml(scene)}

    <div class="edit-divider"></div>

    <div class="edit-text-style-section">
      <button type="button"
        class="edit-collapsible-header js-text-style-toggle ${_sc ? 'is-collapsed' : 'is-expanded'}"
        aria-expanded="${!_sc}">
        <span class="edit-collapsible-header-text">🅰 글자 스타일</span>
        <span class="edit-collapsible-header-chev">${_sc ? '▼' : '▲'}</span>
      </button>
      ${_sc ? '' : `
        <div class="edit-collapsible-body">
          <div class="edit-row">
            <label class="edit-label">폰트</label>
            <select class="edit-font-select js-edit-text-font"
              style="font-family:var(--font-${style.fontFamily || 'gothic'})">${fontOptions}</select>
          </div>

          <div class="edit-row">
            <label class="edit-label">글자 크기 <span class="edit-label-note">(${style.fontSize}px)</span></label>
            <input type="range" class="edit-slider js-edit-text-size"
              min="12" max="50" step="1" value="${style.fontSize}">
          </div>

          <div class="edit-row">
            <label class="edit-label">글자 색</label>
            <div class="edit-color-row">${colorBtns}</div>
            <input type="color" class="edit-color-picker js-edit-text-color-pick"
              value="${style.color || '#1a1a1a'}" title="자유 색 선택">
          </div>

          <div class="edit-row">
            <label class="edit-label">굵기</label>
            <div class="edit-toggle-group">
              <button type="button" class="edit-toggle js-edit-text-weight ${style.weight === 'normal' ? 'active' : ''}" data-val="normal">보통</button>
              <button type="button" class="edit-toggle js-edit-text-weight ${style.weight === 'bold' ? 'active' : ''}" data-val="bold">굵게</button>
            </div>
          </div>
        </div>`}
    </div>

    <div class="edit-divider"></div>

    <div class="edit-text-theme-section">
      <button type="button"
        class="edit-collapsible-header js-text-theme-toggle ${_tc ? 'is-collapsed' : 'is-expanded'}"
        aria-expanded="${!_tc}">
        <span class="edit-collapsible-header-text">🎨 테마 <span class="edit-label-note">(8종)</span></span>
        <span class="edit-collapsible-header-chev">${_tc ? '▼' : '▲'}</span>
      </button>
      ${_tc ? '' : `
        <div class="edit-collapsible-body">
          <div class="edit-theme-grid">${themeCards}</div>
          <div class="edit-section-hint">테마는 카드 배경/테두리/기본 폰트 톤을 결정합니다. 폰트·크기·색은 위에서 별도 조절 가능.</div>
        </div>`}
    </div>

    ${_applyStyleAllButtonHtml(scene)}

    <div class="edit-divider"></div>

    <div class="edit-text-effect-section">
      <button type="button"
        class="edit-collapsible-header js-text-effect-toggle ${_ec ? 'is-collapsed' : 'is-expanded'}"
        aria-expanded="${!_ec}">
        <span class="edit-collapsible-header-text">✨ 효과</span>
        <span class="edit-collapsible-header-chev">${_ec ? '▼' : '▲'}</span>
      </button>
      ${_ec ? '' : `
        <div class="edit-collapsible-body">
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
          </div>
        </div>`}
    </div>`;
}

/* ────────────────────────────────────────────────────────────
   2026-05-25 Phase 2: 양옆 마감 테마 helper (재사용 가능).
   이전엔 _typeSectionPicturebookHtml 안 IIFE로 inline 박혀 있었음.
   · 표지 분기 _typeSectionCoverHtml + picturebook 첫 일반 장면 두 곳에서 호출.
   · 기존 상태 변수 _pbThemeCollapsed / _getPbThemeCollapsed() 그대로 사용.
   · 기존 이벤트 핸들러 .js-pb-theme-toggle / .js-pb-theme 그대로 (panel.querySelectorAll 매칭).
   · 작품 단위 데이터(ViewerState.project.pbTheme / viewer-meta.pbTheme) 그대로.
   ──────────────────────────────────────────────────────────── */
function _pbThemeSectionHtml() {
  const PB_THEMES = [
    { id: 'classic-book',  label: '클래식 책',  desc: '책 두께·제본' },
    { id: 'paper-desk',    label: '책상',       desc: '종이 텍스처' },
    { id: 'minimal-cream', label: '미니멀',     desc: '단순 종이톤' },
    { id: 'sketch-note',   label: '손그림 노트', desc: '노트 줄지' },
    { id: 'library-card',  label: '도서관',     desc: '황색 + 라벨' },
    { id: 'night-tale',    label: '밤 이야기',   desc: '어두운 별빛' },
  ];
  const current  = (ViewerState.project.pbTheme || 'classic-book');
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
  if (!Array.isArray(scene.choices)) scene.choices = [];
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
   호출 측에서 (미연결) 옵션은 별도로 박음. 2단(_buttonRowHtml)은 기존
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
  const allowRowDelete = !!rowDelete && choices.length > 1;

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
        <select class="edit-pb-choice-link-select js-pb-choice-link" data-idx="${i}">
          <option value=""${currentNext ? '' : ' selected'}>(미연결)</option>
          ${optionsHtml}
        </select>
        ${removeBtnHtml}
      </div>`;
  }).join('');

  return `
    <div class="edit-row edit-row--pb-choice-link">
      <label class="edit-label">🔗 선택지 연결</label>
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
function _typeSectionPicturebookHtml(scene) {
  /* 하위 모드 — scene.picturebookSubmode 명시 필드 (3단계 신규) */
  const sub = (scene.picturebookSubmode === 'imageCenter') ? 'imageCenter' : 'split';
  const isImageCenter = sub === 'imageCenter';
  const hasImage = !!(scene.imageData || scene.imageUrl);

  const pbStyleInlineHtml = (typeof _pbInlineStyleHtml === 'function')
    ? _pbInlineStyleHtml(scene) : '';

  /* v37: 페이지 방향·하위 모드는 첫 장면(entrySceneId)에서만 변경 가능.
     장면 2부터는 토글 비활성 + 안내. "작품 전체 설정"이 한 곳에서만 박힘. */
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

  /* W9 (v5): 사용자 재구성 — 작품 전체 헤더 폐기, sub-divider 폐기.
     순서: [페이지 방향 | 하위 모드] (한 줄) → 양옆 마감 테마 → 글상자(그림 중심형) → 장면 그림 → 글자 스타일.
     왼쪽 첫 줄(페이지 방향+하위 모드)이 오른쪽 첫 줄(제목)과 baseline 정렬. */
  return `
    <div class="edit-pb-row-pair">
      <div class="edit-row edit-row--compact edit-row--pair-cell">
        <label class="edit-label">📖 페이지 방향</label>
        <div class="edit-toggle-group">
          <button type="button" ${lockedAttr}
            class="edit-toggle js-pb-orientation${lockedClass} ${(ViewerState.project.pageOrientation === 'portrait') ? '' : 'active'}"
            data-val="landscape">가로</button>
          <button type="button" ${lockedAttr}
            class="edit-toggle js-pb-orientation${lockedClass} ${(ViewerState.project.pageOrientation === 'portrait') ? 'active' : ''}"
            data-val="portrait">세로</button>
        </div>
      </div>
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
    ${lockHint}

    ${_isFirstNormalScene(scene) ? _pbThemeSectionHtml() : ''}

    ${isImageCenter ? (() => {
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
    })() : ''}

    <div class="edit-row">
      <label class="edit-label">🖼 장면 그림 ${hasImage ? '<span class="edit-label-note">(있음)</span>' : '<span class="edit-label-note">(없음)</span>'}</label>
      <div class="edit-pb-image-actions">
        <label class="edit-toggle js-pb-image-upload-label" style="cursor:pointer;">
          ${hasImage ? '🔄 바꾸기' : '🖼 업로드'}
          <input type="file" accept="image/*" class="js-pb-image-upload-input" style="display:none;">
        </label>
        ${hasImage
          ? `<button type="button" class="edit-toggle js-pb-image-remove" style="color:#c66f4a;">🗑 삭제</button>`
          : `<button type="button" class="edit-toggle js-pb-image-remove" disabled style="opacity:0.4;">🗑 삭제</button>`}
        ${hasImage
          ? `<button type="button" class="edit-toggle js-pb-image-draw" disabled style="opacity:0.4;" title="사진이 있을 땐 그리기를 사용할 수 없어요. 삭제 후 다시 그릴 수 있어요.">✏️ 그리기</button>`
          : `<button type="button" class="edit-toggle js-pb-image-draw">✏️ 그리기</button>`}
        <button type="button" class="edit-toggle js-pb-image-transform" ${hasImage ? '' : 'disabled style="opacity:0.4;"'}>✂️ 크기·이동</button>
        <button type="button" class="edit-toggle js-pb-image-crop" ${hasImage ? '' : 'disabled style="opacity:0.4;"'}>✄ 자르기</button>
      </div>
    </div>

    ${_pbChoiceCountSectionHtml(scene)}

    ${_pbChoiceLinkSectionHtml(scene)}

    ${pbStyleInlineHtml}

    ${(() => {
      /* v138-fix14 (v135-4 그림 중심형 확장): 그림책형 모든 하위 모드에서 톤
         UI 박음. 분할형(split) + 그림 중심형(imageCenter) + 엔딩 모두 포함.
         _pbToneSectionHtml 자체에 cover early return 박혀있어 표지 안전. */
      return _pbToneSectionHtml(scene);
    })()}`;
}

/* ────────────────────────────────────────────
   W8: 그림책 글자 스타일 인라인 HTML — [내용] 탭에서 본문 바로 아래 표시
   사용자 보고: 폰트↔내용 탭 왕복 불편 → 본문 옆에 글자 스타일 통합.
   textStyle 데이터 모델 재사용 (한 작품 = 한 모드라 충돌 없음).
   ──────────────────────────────────────────── */
function _pbInlineStyleHtml(scene) {
  const style = (typeof getTextStyle === 'function')
    ? getTextStyle(scene)
    : { fontFamily: 'gothic', fontSize: 16, color: '', weight: 'normal' };
  /* W9: 폰트 18종으로 확장 + UI는 select dropdown (한글 프로그램 스타일).
     인스펙터 가로폭 절약 + 폰트 많을 때도 깔끔. 각 option의 font-family도 해당 폰트로
     박아 펼친 dropdown에서 실제 모양 미리 보임 (Chromium/Firefox 지원). */
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
  /* v36: var(--font-X) 대신 실제 폰트명 inline 박음 — select option은 CSS 변수
     cascading이 OS 네이티브 렌더링 때문에 적용 안 되는 경우 있음. 직접 값으로 robust. */
  const fontOptions = FONTS.map(f => {
    const ff = (TEXT_FONT_FAMILIES && TEXT_FONT_FAMILIES[f.id]) || 'inherit';
    return `<option value="${f.id}"
      style="font-family:${ff}"
      ${style.fontFamily === f.id ? 'selected' : ''}>${f.label}</option>`;
  }).join('');
  /* v36: 범용 색 4개 추가 (14개) — 회색·하늘색·연두·살색 */
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
  /* 2026-05-25 Phase 1 (fix): 섹션 collapsible 토글.
     · wrapper (.edit-pb-inline-style)가 이미 카드 자체 (background + border + padding) →
       그 안의 헤더는 평면적이어야 자연스러움. 양옆 마감 테마의 흰 박스 토글과 분리.
     · 새 class .edit-collapsible-header / .edit-collapsible-body 박힘. */
  const collapsed = _pbInlineStyleCollapsed;
  return `
    <div class="edit-pb-inline-style">
      <button type="button"
        class="edit-collapsible-header js-pb-inline-style-toggle ${collapsed ? 'is-collapsed' : 'is-expanded'}"
        aria-expanded="${!collapsed}">
        <span class="edit-collapsible-header-text">🅰 글자 스타일</span>
        <span class="edit-collapsible-header-chev">${collapsed ? '▼' : '▲'}</span>
      </button>
      ${collapsed ? '' : `
        <div class="edit-collapsible-body edit-pb-inline-style-body">
          <div class="edit-row edit-row--compact">
            <label class="edit-label">폰트</label>
            <select class="edit-font-select js-edit-pb-font"
              style="font-family:${(TEXT_FONT_FAMILIES && TEXT_FONT_FAMILIES[style.fontFamily || 'gothic']) || 'inherit'}">${fontOptions}</select>
          </div>
          <div class="edit-row edit-row--compact edit-row--inline">
            <label class="edit-label">글자 크기 <span class="edit-label-note">(${style.fontSize}px)</span></label>
            <input type="range" class="edit-slider js-edit-pb-size"
              min="12" max="28" step="1" value="${style.fontSize}">
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
          </div>
          ${_applyStyleAllButtonHtml(scene)}
        </div>`}
    </div>`;
}

/* ── 3) 무비형 전용 섹션 ───────────────────────────────────────
   포함:
   · 미디어 타입 배지 + 업로드 진입점
   · 본문 사용 ON/OFF (scene.bodyEnabled 명시 필드 — 3단계 신규) */
function _typeSectionMovieHtml(scene) {
  /* W7: 무비형 본격 보강 — 포스터/자막/선택지 노출 시점 사용자 조절.
     · scene.imageData = 포스터 이미지 (resolveMoviePoster의 fallback 진입점)
     · md.captionMode = overlay | caption-bar
     · md.choiceReveal = end | always
     · scene.bodyEnabled = 본문 ON/OFF (이미 있음) */
  const md = (typeof getMovieData === 'function')
    ? getMovieData(scene)
    : { captionMode: 'overlay', choiceReveal: 'end', videoUrl: null, posterImage: null };

  /* 미디어 상태 표시 */
  const hasVideo = !!md.videoUrl;
  const hasPoster = !!(md.posterImage || scene.imageData);
  let mediaLabel;
  if (hasVideo)        mediaLabel = '🎬 영상 있음';
  else if (hasPoster)  mediaLabel = '🖼 포스터 이미지';
  else                 mediaLabel = '⚪ 미디어 없음';

  /* 본문 사용 ON/OFF — scene.bodyEnabled 명시 필드 */
  const bodyEnabled = (scene.bodyEnabled === true) ? true
                    : (scene.bodyEnabled === false) ? false
                    : !!(scene.body && String(scene.body).trim());

  /* 자막 모드 — overlay (영상 위 떠있음) / caption-bar (영상 아래 별도 띠) */
  const captionMode = md.captionMode || 'overlay';

  /* 선택지 노출 시점 — end (영상 종료 후) / always (즉시 보임) */
  const choiceReveal = md.choiceReveal || 'end';

  /* 2026-05-31 Movie-B-2: 화면 방향(가로/세로)은 작품 단위 — 첫 장면(entrySceneId)에서만 변경.
     그림책과 동일 정책·핸들러(js-pb-orientation), 저장은 viewer-meta.pageOrientation.
     Movie-B-1의 .movie-stage가 portrait 비율(210:297)을 실제 적용. */
  const _entryId = ViewerState.project && ViewerState.project.entrySceneId;
  const _isFirstMovieScene = _entryId
    ? String(scene.id) === String(_entryId)
    : (scene.isStart === true);
  const _orientLockedAttr  = _isFirstMovieScene ? '' : 'disabled';
  const _orientLockedClass = _isFirstMovieScene ? '' : ' edit-toggle--locked';
  const _isPortrait = (ViewerState.project && ViewerState.project.pageOrientation === 'portrait');
  /* 2026-06-01 Movie-H: 선택지 표시 방식 — 작품 단위 viewer-meta.movieDecisionStyle.
     panel(기본 하단 패널) | card(중앙 카드). 첫 장면에서만 변경(화면 방향과 동일 정책). */
  const _isCardDeco = (ViewerState.project && ViewerState.project.movieDecisionStyle === 'card');

  return `
    <div class="edit-divider"></div>
    <h4 class="edit-section-title edit-section-title--major">② 무비형 설정</h4>
    <div class="edit-section-hint">영상이 끝난 뒤 본문과 선택지가 나타납니다.</div>

    <div class="edit-row">
      <label class="edit-label">💬 선택지 표시 방식 <span class="edit-label-note">(작품 전체)</span></label>
      <div class="edit-toggle-group">
        <button type="button" ${_orientLockedAttr}
          class="edit-toggle js-movie-deco${_orientLockedClass} ${_isCardDeco ? '' : 'active'}"
          data-val="panel">하단 패널</button>
        <button type="button" ${_orientLockedAttr}
          class="edit-toggle js-movie-deco${_orientLockedClass} ${_isCardDeco ? 'active' : ''}"
          data-val="card">중앙 카드</button>
      </div>
      <div class="edit-field-hint">영상 종료 후 선택지가 나타납니다.${_isFirstMovieScene ? '' : ' (첫 장면에서만)'}</div>
    </div>

    <div class="edit-row">
      <label class="edit-label">🎬 화면 방향 <span class="edit-label-note">(작품 전체)</span></label>
      <div class="edit-toggle-group">
        <button type="button" ${_orientLockedAttr}
          class="edit-toggle js-pb-orientation${_orientLockedClass} ${_isPortrait ? '' : 'active'}"
          data-val="landscape">가로형</button>
        <button type="button" ${_orientLockedAttr}
          class="edit-toggle js-pb-orientation${_orientLockedClass} ${_isPortrait ? 'active' : ''}"
          data-val="portrait">세로형</button>
      </div>
      <div class="edit-field-hint">작품 전체 화면 방향입니다. 영상은 잘리지 않습니다.${_isFirstMovieScene ? '' : ' (첫 장면에서만)'}</div>
    </div>

    <!-- 2026-06-01 Movie-H: 1단 행동 버튼 개수/연결 — 그림책/텍스트(Text-2D)와 동일 helper 재사용.
         일반 장면만(helper가 표지/엔딩이면 빈 문자열). 저장은 _queueSaveButtons 그대로.
         2026-06-02: movie만 행별 개별 삭제(×) 켬(rowDelete=true) — 고급편집 숨김 목표. -->
    ${_pbChoiceCountSectionHtml(scene)}
    ${_pbChoiceLinkSectionHtml(scene, true)}

    <div class="edit-row">
      <label class="edit-label">미디어</label>
      <div class="edit-movie-media-row">
        <span class="edit-movie-media-badge">${mediaLabel}</span>
      </div>

      <!-- W7-B: 영상 업로드 (Firebase Storage) -->
      <div class="edit-movie-video-section">
        <div class="edit-section-hint" style="margin:8px 0 6px;font-weight:600;color:#c8dcf2;">🎬 영상 (mp4, 1분 이내, 50MB)</div>
        <div class="edit-toggle-group">
          <button type="button" class="edit-toggle js-movie-video-upload">${hasVideo ? '🎬 영상 교체' : '🎬 영상 업로드'}</button>
          ${hasVideo ? `<button type="button" class="edit-toggle js-movie-video-delete">🗑 영상 삭제</button>` : ''}
        </div>
        <div class="js-movie-video-progress edit-movie-progress" style="display:none;">
          <div class="edit-movie-progress-bar"><div class="edit-movie-progress-fill js-movie-progress-fill"></div></div>
          <div class="edit-movie-progress-text js-movie-progress-text">업로드 중… 0%</div>
        </div>
        <div class="js-movie-video-error edit-movie-error" style="display:none;"></div>
      </div>

      <!-- 2026-05-31 Movie-F: 포스터 이미지 업로드/교체 UI 제거 — 무비형은 영상 중심.
           posterImage/scene.imageData 데이터·resolveMoviePoster 렌더 fallback은 유지(하위호환).
           js-movie-poster-upload/-delete 핸들러는 UI 없어 inert. -->
    </div>

    <div class="edit-row">
      <label class="edit-label">본문 사용</label>
      <div class="edit-toggle-group">
        <button type="button"
          class="edit-toggle js-movie-body-enabled ${bodyEnabled ? 'active' : ''}"
          data-val="on">📝 본문 사용</button>
        <button type="button"
          class="edit-toggle js-movie-body-enabled ${!bodyEnabled ? 'active' : ''}"
          data-val="off">— 본문 없음</button>
      </div>
      <div class="edit-section-hint">본문을 함께 보여줄지 정합니다.</div>
    </div>`;
  /* 2026-05-31 Movie-C: 무비형 단순화 — "자막 표시 방식(captionMode)" · "선택지 노출 시점
     (choiceReveal)" 토글 UI 제거. 마감 규칙은 항상 "영상 끝난 뒤 본문/선택지 노출"(렌더에서
     data-movie-reveal="end" 강제). captionMode/choiceReveal 저장 데이터는 보존(필드 삭제 X). */
}

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
            ? `🖼 <strong>배경 있음</strong>`
            : `<span class="edit-section-note">아직 배경이 없어요</span>`}
        </div>
        <div class="edit-toggle-group">
          <button type="button" class="edit-toggle js-exp-bg-upload">🖼 배경 업로드/교체</button>
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
          <button type="button" class="edit-toggle js-exp-co-add" data-val="arrow">➡ 화살표</button>
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
  arrow:     '➡',
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
   _pbThemeSectionHtml() 마크업이 박히는데, 옛엔 핸들러가 picturebook 분기
   안에만 박혀 있어서 표지에서 토글이 동작하지 않았음. 두 분기 모두에서 호출. */
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
      const PB_THEMES = ['classic-book', 'paper-desk', 'minimal-cream', 'sketch-note', 'library-card', 'night-tale'];
      const val = PB_THEMES.includes(btn.dataset.val) ? btn.dataset.val : 'classic-book';
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

function _bindTypeSectionsEvents(panel, scene) {
  if (!panel || !scene) return;
  const ptype = _resolveViewerProjectType();

  /* v64: 작품 단위 설정 핸들러 (표지/entry scene 어디든) — 장면 전환 효과 + 속도 */
  _bindWorkSettingsHandlers(panel);

  /* v75: 글자 스타일 "모든 장면에 적용" 버튼 핸들러 — 첫 일반 장면 인스펙터 */
  _bindApplyStyleAllHandlers(panel, scene);

  /* v37: 표지 scene 핸들러 — 표지 색·제목 높낮이 변경 */
  if (scene.type === 'cover') {
    panel.querySelectorAll('.js-cover-theme').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.val || 'default';
        scene.coverTheme = val;
        panel.querySelectorAll('.js-cover-theme').forEach(b => b.classList.toggle('active', b === btn));
        /* v82: v79 박은 body.dataset.coverTheme 갱신 폐기 — letterbox는 pb-theme 따라감 */
        if (typeof _queueSave === 'function') {
          _queueSave(scene.num || scene.id, { coverTheme: val });
          if (typeof _flushPendingSave === 'function') _flushPendingSave();
        }
        _scheduleViewerFrameReRender();
      });
    });
    const yRange = panel.querySelector('.js-cover-title-y');
    if (yRange) {
      yRange.addEventListener('input', e => {
        const val = parseInt(e.target.value, 10) || 50;
        scene.titleVerticalPosition = val;
        /* 라벨 텍스트 갱신 */
        const labelNote = panel.querySelector('.js-cover-title-y')?.previousElementSibling?.querySelector('.edit-label-note');
        if (labelNote) labelNote.textContent = `(${val}%)`;
        if (typeof _queueSave === 'function') {
          _queueSave(scene.num || scene.id, { titleVerticalPosition: val });
        }
        _scheduleViewerFrameReRender();
      });
      yRange.addEventListener('change', () => {
        if (typeof _flushPendingSave === 'function') _flushPendingSave();
      });
    }
    /* 2026-05-25 Phase 2: 표지에 양옆 마감 테마 박힘 — 토글/카드 핸들러 등록 */
    _bindPbThemeHandlers(panel);
    return;   // 표지면 picturebook/text/movie 분기 안 들어감
  }

  if (ptype === 'picturebook') {
    /* v138: 본문 카드 톤 시스템 — 스타일/색계열(작품 단위) + 톤/엔딩 마감톤(장면 단위) */
    _bindPbToneEvents(panel, scene);

    /* W9: 페이지 방향 토글 (작품 단위 — viewer-meta 저장). 2026-05-31 Movie-B-2: helper로 분리. */
    _bindPageOrientationToggle(panel);

    /* 2026-05-25 Phase 2 fix: 양옆 마감 테마 핸들러 — helper로 통합 (표지 분기와 공유) */
    _bindPbThemeHandlers(panel);

    /* 2026-05-25 Phase 1: 글자 스타일 / 본문 카드 톤 collapsible 토글.
       저장 데이터 영향 없음 — module-level 변수만 토글하고 패널 재렌더. */
    panel.querySelectorAll('.js-pb-inline-style-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        _pbInlineStyleCollapsed = !_pbInlineStyleCollapsed;
        renderEditPanel();
      });
    });
    panel.querySelectorAll('.js-pb-tone-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        _pbToneCollapsed = !_pbToneCollapsed;
        renderEditPanel();
      });
    });

    /* 양옆 마감 테마 카드 핸들러는 위 _bindPbThemeHandlers(panel)에서 함께 등록됨. */

    /* 2026-05-27 Phase 4-B: 1단 행동 버튼 개수 섹션 핸들러.
       엔딩이면 _pbChoiceCountSectionHtml이 빈 문자열이라 querySelector 결과
       null → 안전. 추가/삭제 helper는 _queueSaveButtons 재사용. */
    const _pbAddChoiceBtn = panel.querySelector('.js-pb-choice-add');
    if (_pbAddChoiceBtn) {
      _pbAddChoiceBtn.addEventListener('click', () => {
        if (!_editText.editable) return;
        _pbAddChoiceForScene(scene);
      });
    }
    const _pbRemoveLastChoiceBtn = panel.querySelector('.js-pb-choice-remove-last');
    if (_pbRemoveLastChoiceBtn) {
      _pbRemoveLastChoiceBtn.addEventListener('click', () => {
        if (!_editText.editable) return;
        if (_pbRemoveLastChoiceBtn.disabled) return;
        _pbRemoveLastChoiceForScene(scene);
      });
    }

    /* 2026-05-27 Phase 4-C: 1단 선택지 연결 select 핸들러.
       · scene.choices[idx].nextId / nextNum 갱신 (2단 핸들러와 동일 규칙)
       · 2단 같은 idx select value 동기화 (정합 보호)
       · _queueSaveButtons 재사용 — buildButtonsPatchForSave 거쳐
         buttons/choiceA/B/choiceCount/nextA/B 일괄 저장 + maker 호환
       · _scheduleViewerFrameReRender — 미리보기 버튼 disabled/활성 갱신 */
    panel.querySelectorAll('.js-pb-choice-link').forEach(linkSel => {
      linkSel.addEventListener('change', () => {
        if (!_editText.editable) return;
        const idx = parseInt(linkSel.dataset.idx, 10);
        if (isNaN(idx) || !scene.choices || !scene.choices[idx]) return;
        const val = linkSel.value || '';
        scene.choices[idx].nextId = val || null;
        scene.choices[idx].nextNum = val ? Number(val) : null;

        /* 2단 동일 select 동기화 (있을 때만 — 2단 마크업은 그대로 유지) */
        const sel2 = panel.querySelector(`.js-edit-btn-next[data-idx="${idx}"]`);
        if (sel2 && sel2.value !== val) sel2.value = val;

        _queueSaveButtons(scene);
        _flushPendingSave();
        _scheduleViewerFrameReRender();
      });
    });

    panel.querySelectorAll('.js-pb-submode').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_editText.editable) return;
        /* Phase 4-A: s1/s2 보기 중엔 원본 scenes 일괄 저장 금지. */
        if (_isVariantViewLocked()) { _showSaveStatus('AI 버전은 보기 전용입니다. 편집은 원본에서 해 주세요.', 2500); return; }
        const val = btn.dataset.val === 'imageCenter' ? 'imageCenter' : 'split';

        /* v122-fix3: UI 안내 "🔒 작품 전체 설정"과 일치하게 모든 장면에 일괄 적용.
           옛엔 현재 장면 하나만 저장 → 장면 2 이상에선 옛 모드 그대로 → 안내문과 동작 불일치.
           이 핸들러는 첫 장면에서만 실행됨(다른 장면은 disabled). 안전. */
        const curId = scene.num || scene.id;
        let failCount = 0;
        Object.values(ViewerState.scenes).forEach(s => {
          if (!s) return;
          const id = s.num || s.id;
          if (id == null) return;
          s.picturebookSubmode = val; /* 메모리 즉시 반영 */
          if (String(id) === String(curId)) {
            /* 현재 장면 = 옛 흐름 (debounce → flush) */
            _queueSave(id, { picturebookSubmode: val });
          } else {
            /* 다른 장면 = saveSceneText 직접 호출 (편집 잠금 없이 patch).
               picturebookSubmode는 작품 단위 설정이라 충돌 거의 없음. */
            if (typeof saveSceneText === 'function') {
              saveSceneText(id, { picturebookSubmode: val }).catch(e => {
                failCount++;
                console.warn('[pb-submode 일괄] 장면', id, '저장 실패:', e);
              });
            }
          }
        });
        _flushPendingSave();
        renderEditPanel();
        _scheduleViewerFrameReRender();
      });
    });
    /* W8: 그림책 이미지 업로드 정식 흐름 — viewer-edit 안 자체 처리
       maker의 uploadImage는 scenes/renderCard 사용 (다른 흐름).
       viewer-edit는 ViewerState.scenes / renderScene / _queueSave 사용. */
    panel.querySelectorAll('.js-pb-image-upload-input').forEach(input => {
      input.addEventListener('change', async e => {
        if (!_editText.editable) return;
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
          alert('이미지 파일만 업로드할 수 있어요.');
          e.target.value = '';
          return;
        }
        /* 업로드 중 시각 안내 */
        const lbl = e.target.closest('.js-pb-image-upload-label');
        const prevText = lbl ? lbl.firstChild.nodeValue : '';
        if (lbl && lbl.firstChild) lbl.firstChild.nodeValue = '⏳ 처리 중… ';

        try {
          /* 파일 → data URL */
          const dataUrl = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => reject(new Error('파일 읽기 실패'));
            r.readAsDataURL(file);
          });

          /* 5MB 초과면 자동 압축. maker의 _compressImageDataURL 전역 함수 활용. */
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
              /* 압축 실패 시 원본으로 시도 */
              finalUrl = dataUrl;
            }
          }

          /* v114: base64 → Storage 업로드 + URL 박음 (RTDB 폭탄 차단) */
          let storageUrl;
          try {
            const r = await viewerUploadImageToStorage(finalUrl, scene.num || scene.id);
            storageUrl = r.downloadURL;
          } catch (e) {
            if (lbl && lbl.firstChild) lbl.firstChild.nodeValue = prevText;
            alert(`❌ 이미지 업로드 실패: ${e.message || e}\n\n잠시 후 다시 시도해주세요.`);
            e.target.value = '';
            return;
          }
          /* 저장: scene 메모리 박기 + Firebase 큐 + viewer 부분 재렌더 */
          scene.imageData = storageUrl;
          if (typeof _queueSave === 'function') {
            _queueSave(scene.num || scene.id, { imageData: storageUrl });
            if (typeof _flushPendingSave === 'function') _flushPendingSave();
          }
          /* 인스펙터 다시 그려 상태 갱신 (그림 있음 → 바꾸기/삭제 버튼 노출) */
          renderEditPanel();
          /* viewer 미리보기 재렌더 — 그림 즉시 반영 */
          _scheduleViewerFrameReRender();
        } catch (err) {
          if (lbl && lbl.firstChild) lbl.firstChild.nodeValue = prevText;
          alert(`이미지 처리 실패: ${err.message || err}`);
        }
        e.target.value = '';  /* 같은 파일 다시 선택 가능하도록 reset */
      });
    });

    /* 그림 삭제 */
    panel.querySelectorAll('.js-pb-image-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_editText.editable) return;
        if (!confirm('이 장면의 그림을 삭제할까요?')) return;
        scene.imageData = null;
        if (typeof _queueSave === 'function') {
          _queueSave(scene.num || scene.id, { imageData: null });
          if (typeof _flushPendingSave === 'function') _flushPendingSave();
        }
        renderEditPanel();
        _scheduleViewerFrameReRender();
      });
    });

    /* 바로 그리기 — 추후 별도 구현 */
    panel.querySelectorAll('.js-pb-image-draw').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_editText.editable) return;
        /* W9 (v13): 그리기는 사진이 없을 때만 사용 가능 (사용자 결정).
           disabled 상태에선 click 안 들어옴. 방어적으로 hasImage 한 번 더 체크. */
        if (scene.imageData) return;
        _openPbDrawModal(scene);
      });
    });

    /* W9 (v8): ✂️ 크기/위치 — 사진 transform 편집 모드 진입 */
    panel.querySelectorAll('.js-pb-image-transform').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_editText.editable) return;
        if (typeof enterImageTransformEdit === 'function') {
          enterImageTransformEdit();
        }
      });
    });

    /* W9 (v9): ✄ 자르기 — 사진 crop 영역 편집 모드 진입 */
    panel.querySelectorAll('.js-pb-image-crop').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_editText.editable) return;
        if (typeof enterImageCropEdit === 'function') {
          enterImageCropEdit();
        }
      });
    });

    /* W4-A: 본문 글상자 슬라이더 (그림 중심형 전용 — placeholder가 노출 안 되면 element 없음) ─
       사용자가 슬라이더 만지는 동안 viewer 화면 즉시 반영 (input 이벤트).
       값 확정(change 이벤트)에서 _queueSave + _flushPendingSave.
       높이는 본문에 따라 auto → height 슬라이더 없음 (의도). */
    const pbBb = (typeof getPicturebookBodyBox === 'function')
      ? getPicturebookBodyBox(scene)
      : { x: 15, y: 25, width: 55, backdropOpacity: 0.85 };
    const _ensurePbBb = () => {
      if (!scene.picturebookBodyBox || typeof scene.picturebookBodyBox !== 'object') {
        scene.picturebookBodyBox = { ...pbBb };
      }
      return scene.picturebookBodyBox;
    };

    const _pbBbBindRange = (selector, valSelector, key, valFormat) => {
      const range = panel.querySelector(selector);
      const valEl = panel.querySelector(valSelector);
      if (!range) return;
      range.addEventListener('input', () => {
        if (!_editText.editable) return;
        const bb = _ensurePbBb();
        const numeric = Number(range.value);
        bb[key] = (key === 'backdropOpacity') ? (numeric / 100) : numeric;
        if (valEl) valEl.textContent = valFormat(numeric);
        _scheduleViewerFrameReRender();   /* 즉시 반영 */
      });
      range.addEventListener('change', () => {
        if (!_editText.editable) return;
        const bb = _ensurePbBb();
        _queueSave(scene.num || scene.id, { picturebookBodyBox: { ...bb } });
        _flushPendingSave();
      });
    };
    _pbBbBindRange('.js-pb-bb-x',  '.js-pb-bb-x-val',  'x',               (n) => `${n}%`);
    _pbBbBindRange('.js-pb-bb-y',  '.js-pb-bb-y-val',  'y',               (n) => `${n}%`);
    _pbBbBindRange('.js-pb-bb-w',  '.js-pb-bb-w-val',  'width',           (n) => `${n}%`);
    _pbBbBindRange('.js-pb-bb-op', '.js-pb-bb-op-val', 'backdropOpacity', (n) => `${n}%`);

    /* W4: 높이 슬라이더 — 명시값으로 박힐 때마다 height 갱신.
       사용자가 "높이 자동" 클릭하면 height를 null로 되돌림 (콘텐츠 자동). */
    const hRange = panel.querySelector('.js-pb-bb-h');
    const hValEl = panel.querySelector('.js-pb-bb-h-val');
    if (hRange) {
      hRange.addEventListener('input', () => {
        if (!_editText.editable) return;
        const bb = _ensurePbBb();
        const numeric = Number(hRange.value);
        bb.height = numeric;
        hRange.removeAttribute('data-auto');
        if (hValEl) hValEl.textContent = `${numeric}%`;
        _scheduleViewerFrameReRender();
      });
      hRange.addEventListener('change', () => {
        if (!_editText.editable) return;
        const bb = _ensurePbBb();
        _queueSave(scene.num || scene.id, { picturebookBodyBox: { ...bb } });
        _flushPendingSave();
      });
    }

    panel.querySelector('.js-pb-bb-auto-h')?.addEventListener('click', () => {
      if (!_editText.editable) return;
      const bb = _ensurePbBb();
      bb.height = null;
      _queueSave(scene.num || scene.id, { picturebookBodyBox: { ...bb } });
      _flushPendingSave();
      renderEditPanel();
      _scheduleViewerFrameReRender();
    });

    panel.querySelector('.js-pb-bb-reset')?.addEventListener('click', () => {
      if (!_editText.editable) return;
      scene.picturebookBodyBox = { x: 15, y: 25, width: 55, height: null, backdropOpacity: 0.85 };
      _queueSave(scene.num || scene.id, { picturebookBodyBox: { ...scene.picturebookBodyBox } });
      _flushPendingSave();
      renderEditPanel();          /* 슬라이더 값 갱신 */
      _scheduleViewerFrameReRender();
    });

    /* ──────────────────────────────────────────────────
       W8: 그림책 글자 스타일 (textStyle 데이터 모델 공유)
       텍스트형과 같은 scene.textStyle. viewer 적용 노드만 다름(.pb-text__body)
       ────────────────────────────────────────────────── */
    function _ensurePbTextStyle() {
      if (!scene.textStyle || typeof scene.textStyle !== 'object') {
        scene.textStyle = { fontFamily: 'gothic', fontSize: 16, color: '', weight: 'normal' };
      }
      return scene.textStyle;
    }
    /* 폰트 (W9: select dropdown) */
    panel.querySelectorAll('.js-edit-pb-font').forEach(sel => {
      sel.addEventListener('change', e => {
        if (!_editText.editable) return;
        const v = e.target.value || 'gothic';
        const ts = _ensurePbTextStyle();
        if (ts.fontFamily === v) return;
        ts.fontFamily = v;
        _queueSave(scene.num || scene.id, { textStyle: { ...ts } });
        _flushPendingSave();
        /* select 자체 표시 폰트도 즉시 반영 — 선택한 폰트로 라벨 보임 */
        e.target.style.fontFamily = `var(--font-${v})`;
        if (!_patchPbStyle()) _scheduleViewerFrameReRender();
      });
    });
    /* 크기 */
    panel.querySelector('.js-edit-pb-size')?.addEventListener('input', e => {
      if (!_editText.editable) return;
      const v = parseInt(e.target.value, 10);
      if (isNaN(v)) return;
      const ts = _ensurePbTextStyle();
      ts.fontSize = v;
      _queueSave(scene.num || scene.id, { textStyle: { ...ts } });
      /* 라벨 옆 (Npx) 텍스트 즉시 업데이트 */
      const labelNote = e.target.closest('.edit-row')?.querySelector('.edit-label-note');
      if (labelNote) labelNote.textContent = `(${v}px)`;
      if (!_patchPbStyle()) _scheduleViewerFrameReRender();
    });
    panel.querySelector('.js-edit-pb-size')?.addEventListener('change', () => _flushPendingSave());
    /* 색 팔레트 */
    panel.querySelectorAll('.js-edit-pb-color').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_editText.editable) return;
        const v = btn.dataset.val || '';
        const ts = _ensurePbTextStyle();
        ts.color = v;
        _queueSave(scene.num || scene.id, { textStyle: { ...ts } });
        _flushPendingSave();
        panel.querySelectorAll('.js-edit-pb-color').forEach(b => b.classList.toggle('active', b === btn));
        if (!_patchPbStyle()) _scheduleViewerFrameReRender();
      });
    });
    /* 자유 색 */
    panel.querySelector('.js-edit-pb-color-pick')?.addEventListener('input', e => {
      if (!_editText.editable) return;
      const v = e.target.value || '';
      const ts = _ensurePbTextStyle();
      ts.color = v;
      _queueSave(scene.num || scene.id, { textStyle: { ...ts } });
      panel.querySelectorAll('.js-edit-pb-color').forEach(b => b.classList.remove('active'));
      if (!_patchPbStyle()) _scheduleViewerFrameReRender();
    });
    panel.querySelector('.js-edit-pb-color-pick')?.addEventListener('change', () => _flushPendingSave());
    /* 굵기 */
    panel.querySelectorAll('.js-edit-pb-weight').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_editText.editable) return;
        const v = btn.dataset.val === 'bold' ? 'bold' : 'normal';
        const ts = _ensurePbTextStyle();
        ts.weight = v;
        _queueSave(scene.num || scene.id, { textStyle: { ...ts } });
        _flushPendingSave();
        panel.querySelectorAll('.js-edit-pb-weight').forEach(b => b.classList.toggle('active', b === btn));
        if (!_patchPbStyle()) _scheduleViewerFrameReRender();
      });
    });
  }

  if (ptype === 'movie') {
    /* 2026-05-31 Movie-B-2: 무비형도 작품 단위 화면 방향(가로/세로) 토글 — 그림책과 동일 helper.
       movie-stage(Movie-B-1)가 생겨서 이제 세로 비율이 실제 적용됨. */
    _bindPageOrientationToggle(panel);
    /* 2026-06-01 Movie-H: 선택지 표시 방식(하단 패널/중앙 카드) 토글. */
    _bindMovieDecoToggle(panel);

    /* 2026-06-01 Movie-H: 무비 1단 행동 버튼 개수/연결 핸들러 — Text-2D와 동일.
       모드 무관 helper(_pbAddChoiceForScene/_pbRemoveLastChoiceForScene/js-pb-choice-link)
       + _queueSaveButtons 재사용. 엔딩이면 섹션 빈 문자열 → querySelector null 안전. */
    const _mvAddChoiceBtn = panel.querySelector('.js-pb-choice-add');
    if (_mvAddChoiceBtn) {
      _mvAddChoiceBtn.addEventListener('click', () => {
        if (!_editText.editable) return;
        _pbAddChoiceForScene(scene);
      });
    }
    const _mvRemoveLastChoiceBtn = panel.querySelector('.js-pb-choice-remove-last');
    if (_mvRemoveLastChoiceBtn) {
      _mvRemoveLastChoiceBtn.addEventListener('click', () => {
        if (!_editText.editable) return;
        if (_mvRemoveLastChoiceBtn.disabled) return;
        _pbRemoveLastChoiceForScene(scene);
      });
    }
    panel.querySelectorAll('.js-pb-choice-link').forEach(linkSel => {
      linkSel.addEventListener('change', () => {
        if (!_editText.editable) return;
        const idx = parseInt(linkSel.dataset.idx, 10);
        if (isNaN(idx) || !scene.choices || !scene.choices[idx]) return;
        const val = linkSel.value || '';
        scene.choices[idx].nextId = val || null;
        scene.choices[idx].nextNum = val ? Number(val) : null;
        const sel2 = panel.querySelector(`.js-edit-btn-next[data-idx="${idx}"]`);
        if (sel2 && sel2.value !== val) sel2.value = val;
        _queueSaveButtons(scene);
        _flushPendingSave();
        _scheduleViewerFrameReRender();
      });
    });

    /* 2026-06-02: 무비 1단 행별 개별 삭제(×) — 2단 삭제와 동일 경로(_pbRemoveChoiceAtForScene).
       삭제 후 renderEditPanel + 재렌더로 1단/2단/미리보기 일괄 갱신, 번호 1,2,3 재정렬. */
    panel.querySelectorAll('.js-pb-choice-remove').forEach(rmBtn => {
      rmBtn.addEventListener('click', () => {
        if (!_editText.editable) return;
        const idx = parseInt(rmBtn.dataset.idx, 10);
        _pbRemoveChoiceAtForScene(scene, idx);
      });
    });

    /* movieData 객체 보장 — 없으면 기본값 */
    function _ensureMovieData() {
      if (!scene.movieData || typeof scene.movieData !== 'object') {
        scene.movieData = {
          videoUrl: null, posterImage: null,
          captionMode: 'overlay', choiceReveal: 'end',
        };
      }
      return scene.movieData;
    }

    /* 본문 사용 ON/OFF — 부분 패치 */
    panel.querySelectorAll('.js-movie-body-enabled').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_editText.editable) return;
        const enabled = btn.dataset.val === 'on';
        scene.bodyEnabled = enabled;
        _queueSave(scene.num || scene.id, { bodyEnabled: enabled });
        _flushPendingSave();
        /* 패널 active 클래스만 토글 (renderEditPanel 호출 X — 깜빡임/포커스 손실 방지) */
        panel.querySelectorAll('.js-movie-body-enabled').forEach(b => {
          b.classList.toggle('active', (b.dataset.val === 'on') === enabled);
        });
        /* 2026-06-02: 본문 사용 토글은 장면 재렌더 — bodyEnabled 변화로 .movie-decision__desc가
           생성/제거되고, edit 모드면 빈 본문 placeholder가 즉시 떠 바로 입력 가능해야 함.
           data-body-enabled 속성만 패치하면 본문 없던 장면엔 desc 자체가 없어 placeholder 미표시. */
        _scheduleViewerFrameReRender();
      });
    });

    /* W7-B: 영상 업로드 — Firebase Storage. 진행률 표시 + 검증 + URL 저장. */
    panel.querySelectorAll('.js-movie-video-upload').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_editText.editable) return;
        const errEl   = panel.querySelector('.js-movie-video-error');
        const progEl  = panel.querySelector('.js-movie-video-progress');
        const fillEl  = panel.querySelector('.js-movie-progress-fill');
        const textEl  = panel.querySelector('.js-movie-progress-text');
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

          /* 진행률 UI ON */
          if (progEl) {
            progEl.style.display = 'block';
            if (fillEl) fillEl.style.width = '0%';
            if (textEl) textEl.textContent = '업로드 준비 중…';
          }
          /* 버튼 잠금 */
          btn.disabled = true;
          btn.style.opacity = '0.5';

          try {
            const result = await viewerUploadVideoToStorage(file, (scene.num || scene.id), {
              onProgress: pct => {
                if (fillEl) fillEl.style.width = pct + '%';
                if (textEl) textEl.textContent = '업로드 중… ' + pct + '%';
              },
            });
            /* 성공 → 옛 영상 storagePath 백업 후 새 정보로 덮음 */
            const _oldStoragePath = (scene.movieData && scene.movieData.videoStoragePath) || null;

            /* movieData.videoUrl + storagePath 저장 */
            if (!scene.movieData || typeof scene.movieData !== 'object') {
              scene.movieData = { videoUrl: null, posterImage: null, captionMode: 'overlay', choiceReveal: 'end' };
            }
            scene.movieData.videoUrl = result.downloadURL;
            scene.movieData.videoStoragePath = result.storagePath;   /* 삭제 시 필요 */
            _queueSave(scene.num || scene.id, { movieData: { ...scene.movieData } });
            _flushPendingSave();
            if (textEl) textEl.textContent = '✓ 업로드 완료';

            /* W7-B 성능 보강: 옛 영상이 있었으면 background로 정리.
               업로드 경로가 timestamp로 새로 만들어졌으므로 옛 파일은 쓰레기로 남음.
               best-effort — 실패해도 UX 영향 X. */
            if (_oldStoragePath && _oldStoragePath !== result.storagePath &&
                typeof viewerDeleteVideoFromStorage === 'function') {
              viewerDeleteVideoFromStorage(_oldStoragePath);
            }

            setTimeout(() => {
              hideProgress();
              renderEditPanel();
              _scheduleViewerFrameReRender();
            }, 600);
          } catch (err) {
            hideProgress();
            const msg = (err && err.message) ? err.message : '업로드에 실패했어요.';
            showErr(msg);
          } finally {
            btn.disabled = false;
            btn.style.opacity = '';
          }
        });
        document.body.appendChild(fileInput);
        fileInput.click();
        setTimeout(() => fileInput.remove(), 1000);
      });
    });

    /* W7-B: 영상 삭제 — Storage 정리 + DB 필드 null */
    panel.querySelectorAll('.js-movie-video-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!_editText.editable) return;
        if (!confirm('영상을 삭제할까요? Storage에서도 함께 지워집니다.')) return;
        const md = scene.movieData || {};
        const storagePath = md.videoStoragePath || null;
        /* DB 필드 먼저 null로 (UI 즉시 반영) */
        if (scene.movieData) {
          scene.movieData.videoUrl = null;
          scene.movieData.videoStoragePath = null;
        }
        _queueSave(scene.num || scene.id, { movieData: { ...scene.movieData } });
        _flushPendingSave();
        renderEditPanel();
        _scheduleViewerFrameReRender();
        /* Storage 삭제는 best-effort (실패해도 UX 영향 X) */
        if (storagePath && typeof viewerDeleteVideoFromStorage === 'function') {
          viewerDeleteVideoFromStorage(storagePath);
        }
      });
    });

    /* W7-A: 포스터 이미지 업로드 — 임시 file input 띄움 + base64 변환 후 scene.imageData 저장
       (movieData.posterImage와 fallback 일관: resolveMoviePoster가 둘 다 처리) */
    panel.querySelectorAll('.js-movie-poster-upload').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_editText.editable) return;
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';
        fileInput.addEventListener('change', e => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = async ev => {
            const dataUrl = ev.target && ev.target.result;
            if (typeof dataUrl !== 'string') return;
            /* v114: 포스터도 Storage 업로드 후 URL 박음 (base64 RTDB 폭탄 차단) */
            let storageUrl;
            try {
              const r = await viewerUploadImageToStorage(dataUrl, scene.num || scene.id);
              storageUrl = r.downloadURL;
            } catch (err) {
              alert(`❌ 포스터 업로드 실패: ${err.message || err}\n\n잠시 후 다시 시도해주세요.`);
              return;
            }
            scene.imageData = storageUrl;
            _queueSave(scene.num || scene.id, { imageData: storageUrl });
            _flushPendingSave();
            renderEditPanel();
            _scheduleViewerFrameReRender();
          };
          reader.readAsDataURL(file);
        });
        document.body.appendChild(fileInput);
        fileInput.click();
        setTimeout(() => fileInput.remove(), 1000);
      });
    });

    /* W7-A: 포스터 삭제 */
    panel.querySelectorAll('.js-movie-poster-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_editText.editable) return;
        if (!confirm('포스터 이미지를 삭제할까요?')) return;
        scene.imageData = null;
        const md = _ensureMovieData();
        md.posterImage = null;
        _queueSave(scene.num || scene.id, { imageData: null, movieData: { ...md } });
        _flushPendingSave();
        renderEditPanel();
        _scheduleViewerFrameReRender();
      });
    });

    /* W7-A: 자막 표시 방식 (overlay / caption-bar) — 부분 패치 */
    panel.querySelectorAll('.js-movie-caption-mode').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_editText.editable) return;
        const v = btn.dataset.val === 'caption-bar' ? 'caption-bar' : 'overlay';
        const md = _ensureMovieData();
        md.captionMode = v;
        _queueSave(scene.num || scene.id, { movieData: { ...md } });
        _flushPendingSave();
        panel.querySelectorAll('.js-movie-caption-mode').forEach(b => b.classList.toggle('active', b === btn));
        if (!_patchMovieAttr('caption', v)) _scheduleViewerFrameReRender();
      });
    });

    /* W7-A: 선택지 노출 시점 (end / always) — 부분 패치 */
    panel.querySelectorAll('.js-movie-choice-reveal').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_editText.editable) return;
        const v = btn.dataset.val === 'always' ? 'always' : 'end';
        const md = _ensureMovieData();
        md.choiceReveal = v;
        _queueSave(scene.num || scene.id, { movieData: { ...md } });
        _flushPendingSave();
        panel.querySelectorAll('.js-movie-choice-reveal').forEach(b => b.classList.toggle('active', b === btn));
        if (!_patchMovieAttr('reveal', v)) _scheduleViewerFrameReRender();
      });
    });
  }

  /* W5: 텍스트형 — 글자 스타일/테마/효과 편집 */
  if (ptype === 'text') {
    /* textStyle 객체 보장 (없으면 기본값) */
    function _ensureTextStyle() {
      if (!scene.textStyle || typeof scene.textStyle !== 'object') {
        scene.textStyle = { fontFamily: 'gothic', fontSize: 16, color: '', weight: 'normal' };
      }
      return scene.textStyle;
    }
    function _ensureTextEffect() {
      if (!scene.textEffect || typeof scene.textEffect !== 'object') {
        scene.textEffect = { entrance: 'none', body: 'none' };
      }
      return scene.textEffect;
    }

    /* 폰트 선택 (W9: select dropdown) */
    panel.querySelectorAll('.js-edit-text-font').forEach(sel => {
      sel.addEventListener('change', e => {
        if (!_editText.editable) return;
        const v = e.target.value || 'gothic';
        const ts = _ensureTextStyle();
        if (ts.fontFamily === v) return;
        ts.fontFamily = v;
        _queueSave(scene.num || scene.id, { textStyle: { ...ts } });
        _flushPendingSave();
        /* select 자체 표시 폰트도 즉시 반영 */
        e.target.style.fontFamily = `var(--font-${v})`;
        /* W7 깜빡임 차단: CSS 변수만 갱신 — 통째 재렌더 안 함.
           실패하면(노드 못 찾음) 통째 재렌더 fallback. */
        if (!_patchTextStyle()) _scheduleViewerFrameReRender();
      });
    });

    /* 글자 크기 슬라이더 */
    panel.querySelectorAll('.js-edit-text-size').forEach(slider => {
      slider.addEventListener('input', e => {
        if (!_editText.editable) return;
        const v = parseInt(e.target.value, 10);
        if (isNaN(v)) return;
        const ts = _ensureTextStyle();
        ts.fontSize = v;
        /* 라벨 갱신 (인접 .edit-label-note) */
        const labelNote = slider.closest('.edit-row')?.querySelector('.edit-label-note');
        if (labelNote) labelNote.textContent = `(${v}px)`;
        _queueSave(scene.num || scene.id, { textStyle: { ...ts } });
        if (!_patchTextStyle()) _scheduleViewerFrameReRender();
      });
    });

    /* 색 팔레트 */
    panel.querySelectorAll('.js-edit-text-color').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_editText.editable) return;
        const v = btn.dataset.val || '';
        const ts = _ensureTextStyle();
        ts.color = v;
        _queueSave(scene.num || scene.id, { textStyle: { ...ts } });
        _flushPendingSave();
        panel.querySelectorAll('.js-edit-text-color').forEach(b => b.classList.toggle('active', b === btn));
        if (!_patchTextStyle()) _scheduleViewerFrameReRender();
      });
    });

    /* 자유 색 선택 (color picker) */
    panel.querySelectorAll('.js-edit-text-color-pick').forEach(input => {
      input.addEventListener('change', e => {
        if (!_editText.editable) return;
        const v = e.target.value;
        const ts = _ensureTextStyle();
        ts.color = v;
        _queueSave(scene.num || scene.id, { textStyle: { ...ts } });
        _flushPendingSave();
        /* 팔레트 활성 해제 (자유 색이 우선) */
        panel.querySelectorAll('.js-edit-text-color').forEach(b => b.classList.remove('active'));
        if (!_patchTextStyle()) _scheduleViewerFrameReRender();
      });
    });

    /* 굵기 */
    panel.querySelectorAll('.js-edit-text-weight').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_editText.editable) return;
        const v = btn.dataset.val === 'bold' ? 'bold' : 'normal';
        const ts = _ensureTextStyle();
        ts.weight = v;
        _queueSave(scene.num || scene.id, { textStyle: { ...ts } });
        _flushPendingSave();
        panel.querySelectorAll('.js-edit-text-weight').forEach(b => b.classList.toggle('active', b === btn));
        if (!_patchTextStyle()) _scheduleViewerFrameReRender();
      });
    });

    /* 2026-05-31 Text-3B: 스타일/테마/효과 섹션 접힘 토글. module 변수만 바꾸고 패널 재렌더.
       저장 데이터·스타일 핸들러 영향 0 (그림책 js-pb-inline-style-toggle과 동일 패턴). */
    panel.querySelectorAll('.js-text-style-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        _textStyleSecCollapsed = !_textStyleSecCollapsed;
        renderEditPanel();
      });
    });
    panel.querySelectorAll('.js-text-theme-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        _textThemeSecCollapsed = !_textThemeSecCollapsed;
        renderEditPanel();
      });
    });
    panel.querySelectorAll('.js-text-effect-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        _textEffectSecCollapsed = !_textEffectSecCollapsed;
        renderEditPanel();
      });
    });

    /* 2026-05-31 Text-2D: 텍스트 1단 행동 버튼 개수/연결 핸들러 — 그림책 분기와 동일.
       모드 무관 helper(_pbAddChoiceForScene/_pbRemoveLastChoiceForScene/js-pb-choice-link)
       + _queueSaveButtons 재사용. 새 저장 로직 없음. 엔딩이면 섹션 빈 문자열 → querySelector null 안전. */
    const _txtAddChoiceBtn = panel.querySelector('.js-pb-choice-add');
    if (_txtAddChoiceBtn) {
      _txtAddChoiceBtn.addEventListener('click', () => {
        if (!_editText.editable) return;
        _pbAddChoiceForScene(scene);
      });
    }
    const _txtRemoveLastChoiceBtn = panel.querySelector('.js-pb-choice-remove-last');
    if (_txtRemoveLastChoiceBtn) {
      _txtRemoveLastChoiceBtn.addEventListener('click', () => {
        if (!_editText.editable) return;
        if (_txtRemoveLastChoiceBtn.disabled) return;
        _pbRemoveLastChoiceForScene(scene);
      });
    }
    panel.querySelectorAll('.js-pb-choice-link').forEach(linkSel => {
      linkSel.addEventListener('change', () => {
        if (!_editText.editable) return;
        const idx = parseInt(linkSel.dataset.idx, 10);
        if (isNaN(idx) || !scene.choices || !scene.choices[idx]) return;
        const val = linkSel.value || '';
        scene.choices[idx].nextId = val || null;
        scene.choices[idx].nextNum = val ? Number(val) : null;
        /* 2단(내용 고급 편집) 같은 idx 연결 select 동기화 (있을 때만) */
        const sel2 = panel.querySelector(`.js-edit-btn-next[data-idx="${idx}"]`);
        if (sel2 && sel2.value !== val) sel2.value = val;
        _queueSaveButtons(scene);
        _flushPendingSave();
        _scheduleViewerFrameReRender();
      });
    });

    /* 테마 */
    panel.querySelectorAll('.js-edit-text-theme').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_editText.editable) return;
        const v = btn.dataset.val || 'classic';
        scene.textTheme = v;
        _queueSave(scene.num || scene.id, { textTheme: v });
        _flushPendingSave();
        panel.querySelectorAll('.js-edit-text-theme').forEach(b => b.classList.toggle('active', b === btn));
        /* W7 깜빡임 차단: data-text-theme 속성만 갱신 */
        if (!_patchTextTheme()) _scheduleViewerFrameReRender();
      });
    });

    /* 진입 효과 */
    panel.querySelectorAll('.js-edit-text-entrance').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_editText.editable) return;
        const v = btn.dataset.val || 'none';
        const te = _ensureTextEffect();
        te.entrance = v;
        _queueSave(scene.num || scene.id, { textEffect: { ...te } });
        _flushPendingSave();
        panel.querySelectorAll('.js-edit-text-entrance').forEach(b => b.classList.toggle('active', b === btn));
        /* 진입 효과는 한 번 더 보고 싶을 때만 통째 재렌더 (효과 미리보기) — 일단 부분 패치 */
        if (!_patchTextEffect()) _scheduleViewerFrameReRender();
      });
    });

    /* 본문 표시 효과 */
    panel.querySelectorAll('.js-edit-text-body-effect').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_editText.editable) return;
        const v = btn.dataset.val || 'none';
        const te = _ensureTextEffect();
        te.body = v;
        _queueSave(scene.num || scene.id, { textEffect: { ...te } });
        _flushPendingSave();
        panel.querySelectorAll('.js-edit-text-body-effect').forEach(b => b.classList.toggle('active', b === btn));
        if (!_patchTextEffect()) _scheduleViewerFrameReRender();
      });
    });
  }

  if (ptype === 'experience') {
    panel.querySelectorAll('.js-exp-bg-upload').forEach(btn => {
      btn.addEventListener('click', () => {
        alert('배경 업로드 정식 흐름은 다음 단계에서 연결됩니다.');
      });
    });

    /* W6: 연결 오브젝트 추가 — 타입별 버튼 클릭 시 createConnectObject 호출 + 저장 */
    panel.querySelectorAll('.js-exp-co-add').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_editText.editable) return;
        const t = btn.dataset.val || 'button';
        if (typeof createConnectObject !== 'function') return;
        const newCo = createConnectObject(t);
        if (!Array.isArray(scene.connectObjects)) scene.connectObjects = [];
        scene.connectObjects.push(newCo);
        _queueSave((scene.num || scene.id), { connectObjects: scene.connectObjects });
        _flushPendingSave();
        renderEditPanel();
        _scheduleViewerFrameReRender();
      });
    });

    /* W6: 라벨 input — 실시간 갱신 + 카운터 */
    panel.querySelectorAll('.js-edit-co-label').forEach(input => {
      input.addEventListener('input', e => {
        if (!_editText.editable) return;
        const coId = input.dataset.coId;
        const objects = Array.isArray(scene.connectObjects) ? scene.connectObjects : [];
        const co = objects.find(o => o.id === coId);
        if (!co) return;
        /* 안전망 절단 (maxlength 우회 대비) */
        let value = input.value;
        if (value.length > 20) {
          value = value.slice(0, 20);
          input.value = value;
        }
        co.label = value;
        /* 카운터 갱신 */
        const row = input.closest('.edit-co-row');
        if (row) {
          const lenEl = row.querySelector('.js-edit-co-len');
          if (lenEl) lenEl.textContent = String(value.length);
        }
        _queueSave((scene.num || scene.id), { connectObjects: scene.connectObjects });
        _scheduleViewerFrameReRender();
      });
    });

    /* W6: nextId 드롭다운 변경 */
    panel.querySelectorAll('.js-edit-co-next').forEach(sel => {
      sel.addEventListener('change', e => {
        if (!_editText.editable) return;
        const coId = sel.dataset.coId;
        const objects = Array.isArray(scene.connectObjects) ? scene.connectObjects : [];
        const co = objects.find(o => o.id === coId);
        if (!co) return;
        const v = sel.value;
        co.nextId = (v && v.trim()) ? v.trim() : null;
        _queueSave((scene.num || scene.id), { connectObjects: scene.connectObjects });
        _flushPendingSave();
        _scheduleViewerFrameReRender();
      });
    });

    /* W6: 오브젝트 삭제 */
    panel.querySelectorAll('.js-edit-co-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_editText.editable) return;
        const coId = btn.dataset.coId;
        if (!Array.isArray(scene.connectObjects)) return;
        scene.connectObjects = scene.connectObjects.filter(o => o.id !== coId);
        _queueSave((scene.num || scene.id), { connectObjects: scene.connectObjects });
        _flushPendingSave();
        renderEditPanel();
        _scheduleViewerFrameReRender();
      });
    });
  }
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
    /* v138: 톤 UI 호출은 _typeSectionPicturebookHtml(2770줄)에 박음 —
       사용자 작품(picturebook 명시)은 _typeSectionsHtml → _typeSectionPicturebookHtml
       경로로 흐름. 여기(_modePickerHtml)는 모드 미지정 작품용 dead path라
       톤 호출 박지 X. 박으면 중복 표시 위험. */
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
  { key: 'stage',  icon: '🖼',  label: '장면형',   desc: '큰 장면 + 글' },
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
    stage:  { title: '🖼 장면형',   desc: '큰 장면 위에 글·선택지 — 기본 인터랙티브.' },
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

function _pbToneSectionHtml(scene) {
  if (!scene || scene.type === 'cover') return '';

  const proj = (ViewerState && ViewerState.project) || {};
  const entryId = proj.entrySceneId;
  const isFirstScene = entryId
    ? String(scene.id) === String(entryId)
    : (scene.isStart === true);
  const isEnding = !!scene.isEnding;

  /* v138-fix6: editable 인자 박지 X. 기존 다른 UI(페이지 방향·하위 모드 등)
     패턴과 일치 — HTML disabled 안 박고 클릭 핸들러에서 _editText.editable 검사.
     시각 잠금은 body.viewer-edit-readonly 클래스로 CSS 처리. 잠금 확보 후
     클래스 풀리면 즉시 활성화. 옛엔 첫 렌더 시 disabled 박힌 채로 잠금 확보돼도
     안 풀려 비활성 그대로 보이는 버그. */

  /* 작품 단위 (장면 1에서만) */
  const styleRowHtml = isFirstScene
    ? _pbToneRowHtml('card-style', '본문 카드 스타일',
        '질감·테두리 형태·둥글기. 색은 별도예요.',
        _PB_TONE_CARD_STYLES, proj.textCardStyle || '')
    : '';
  const colorRowHtml = isFirstScene
    ? _pbToneRowHtml('card-color', '색계열',
        '본문 카드의 기본 색 방향.',
        _PB_TONE_CARD_COLORS, proj.textCardColor || '')
    : '';

  /* 장면 단위 — 일반/엔딩 분기 */
  const sceneRowHtml = !isEnding
    ? _pbToneRowHtml('card-tone', '본문 카드 톤',
        '본문 카드의 색감 정도를 조절해요. 숫자가 높을수록 색감이 더 진해져요. 학생 그림과 선택 버튼은 바뀌지 않아요.',
        _PB_TONE_SCENE_TONES, scene.pbCardTone || '')
    : '';
  const endRowHtml = isEnding
    ? _pbToneRowHtml('card-end-tone', '엔딩 마감톤',
        '결말의 느낌에 맞게 마감 분위기를 정해요.',
        _PB_TONE_ENDING_TONES, scene.pbEndingTone || '')
    : '';

  /* 박힐 내용이 하나도 없으면 섹션 자체 박지 X */
  if (!styleRowHtml && !colorRowHtml && !sceneRowHtml && !endRowHtml) return '';

  const startNote = isFirstScene
    ? '<div class="edit-section-hint">🎨 본문 카드 스타일·색계열은 작품 전체에 적용돼요. 장면마다 따로 정하지 않아요.</div>'
    : '';

  /* 2026-05-25 Phase 1 (fix): 섹션 collapsible 토글.
     · wrapper (.edit-submode-block)가 이미 카드 자체 → 헤더는 평면적으로 박힘.
     · 새 class .edit-collapsible-header / .edit-collapsible-body 박힘. */
  const collapsed = _pbToneCollapsed;
  return `
    <div class="edit-submode-block edit-submode-block--pb-tone">
      <button type="button"
        class="edit-collapsible-header js-pb-tone-toggle ${collapsed ? 'is-collapsed' : 'is-expanded'}"
        aria-expanded="${!collapsed}">
        <span class="edit-collapsible-header-text">🎨 본문 카드 톤</span>
        <span class="edit-collapsible-header-chev">${collapsed ? '▼' : '▲'}</span>
      </button>
      ${collapsed ? '' : `
        <div class="edit-collapsible-body edit-pb-tone-body">
          ${startNote}
          ${styleRowHtml}
          ${colorRowHtml}
          ${sceneRowHtml}
          ${endRowHtml}
        </div>`}
    </div>`;
}

function _pbToneRowHtml(axis, label, hint, options, current) {
  /* v138-fix6: HTML disabled 박지 X. 잠금 시각은 body.viewer-edit-readonly로
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
         .pb-frame에 새 톤 클래스가 박힘. */
      if (typeof renderCurrentScene === 'function') renderCurrentScene();
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
             aria-disabled="true" title="영상 업로드는 다음 단계에서 연결됩니다">
          <div class="edit-movie-slot-locked-badge">🔒 연결 예정</div>
          <div class="edit-movie-slot-icon">🎞</div>
          <div class="edit-movie-slot-title">영상 파일</div>
          <div class="edit-movie-slot-note">다음 단계에서 업로드 연결</div>
        </div>
        <div class="edit-movie-slot edit-movie-slot--poster${hasPoster ? ' has-source' : ' is-disabled'}"
             ${hasPoster ? '' : 'aria-disabled="true" title="포스터 업로드는 다음 단계. 지금은 장면 이미지가 자동으로 쓰여요."'}>
          ${hasPoster
            ? `<img src="${escHtml(posterSrc)}" alt="포스터 미리보기" class="edit-movie-poster-preview">
               <div class="edit-movie-slot-overlay-label">포스터 (장면 이미지 사용 중)</div>`
            : `<div class="edit-movie-slot-locked-badge">🔒 연결 예정</div>
               <div class="edit-movie-slot-icon">🖼</div>
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
  return '';  /* HUD로 이동. _bindHudEditActions에서 박힘 */
}

function _bindEditActions(panel) {
  /* W9 (v4): 인스펙터에 더 이상 액션 버튼 없음 → no-op.
     실제 핸들러는 _bindHudEditActions에서 박힘. */
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
      alert(`이미지 저장 실패: ${e.message || e}\n잠시 후 다시 시도해주세요.`);
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

/* W9 (v4): HUD maker-return-bar 액션 버튼 핸들러.
   renderHud (viewer-render.js)에서 hud.innerHTML 박은 직후 호출.
   document scope로 검색 — HUD 버튼은 #hud 안에 있음. */
function _bindHudEditActions() {
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

  /* 🤖 AI 작품 다듬기 — viewer-ai.js의 openModal 호출. (텍스트 1단계·작품 검사 = 실 API 작동.
     viewer-ai.js 미로드 환경 fallback: 안내 alert만.) */
  document.querySelector('.js-ai-trigger')?.addEventListener('click', () => {
    if (typeof window.viewerAi === 'object' && typeof window.viewerAi.openModal === 'function') {
      window.viewerAi.openModal();
    } else {
      alert('AI 기능을 불러오지 못했어요. 페이지를 새로고침해 주세요.');
    }
  });

  /* v123/v124b: 루트보기 — storyAnalyzer.js의 openRoutePanel 재사용.
     storyAnalyzer는 maker의 전역 scenes/projectMeta를 참조하고, scene 객체에서
     num/buttons/nextA/B 박음. viewer adaptScenes는 {id, choices} 박는 다른 구조라
     변환 어댑터 필수. */
  document.querySelector('.js-edit-open-routes')?.addEventListener('click', () => {
    if (typeof openRoutePanel !== 'function') {
      alert('루트보기 기능을 불러오지 못했어요. 페이지를 새로고침해 주세요.');
      return;
    }
    /* ViewerState.scenes → maker 형식으로 변환:
       · id 필드를 num으로
       · choices → buttons 변환 ({label, nextId})
       · nextA/B/choiceA/B 박음 (storyAnalyzer fallback 호환) */
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
          buttons,                                /* findAllRoutes가 박는 거 */
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

    /* v124b: ✕ 버튼 + 배경 클릭 핸들러도 박음 (ui.js가 박는 거 — viewer.html엔 없음). */
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
  });

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
      ▶ 감상 테스트 중 — 실제 관람자 화면이에요
    </span>
    <button id="btn-edit-test-return"
      style="padding:5px 14px;border-radius:50px;border:1.5px solid rgba(88,166,255,0.5);
      background:rgba(88,166,255,0.15);color:#58a6ff;
      font-family:var(--font-ui,Jua,sans-serif);font-size:12px;cursor:pointer;white-space:nowrap;">
      ✏️ 마감 편집으로 돌아가기
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

  /* cover가 root면 cover → entry 가상 엣지로 entry를 depth 1에 박음 */
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
        <h3 class="structure-map-title">🗺 장면 구조</h3>
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
function _bindEditTabs(panel) {
  const tabs = panel.querySelectorAll('.edit-tab');
  if (!tabs.length) return;
  tabs.forEach(t => {
    t.addEventListener('click', () => {
      const name = t.getAttribute('data-tab');
      if (!name) return;
      panel.querySelectorAll('.edit-tab').forEach(o => o.classList.remove('is-on'));
      t.classList.add('is-on');
      panel.querySelectorAll('.edit-tab-panel').forEach(p => {
        if (p.getAttribute('data-panel') === name) p.classList.add('is-on');
        else p.classList.remove('is-on');
      });
    });
  });
}

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
function _editTabsForMode(ptype, hasChoice) {
  const contentTab = {
    key: 'content',
    label: '📝 내용',
    html: (s, p) => _textEditHtml(s),
  };
  let modeTab;
  switch (ptype) {
    case 'picturebook':
      modeTab = { key: 'mode', label: '🎨 그림책', html: (s, p) => _typeSectionsHtml(s, p) };
      break;
    case 'movie':
      modeTab = { key: 'mode', label: '🎬 무비',   html: (s, p) => _typeSectionsHtml(s, p) };
      break;
    case 'experience':
      modeTab = { key: 'mode', label: '🗺️ 체험', html: (s, p) => _typeSectionsHtml(s, p) };
      break;
    case 'text':
    default:
      modeTab = { key: 'mode', label: '🎨 스타일', html: (s, p) => _typeSectionsHtml(s, p) };
      break;
  }
  /* 우선순위: 그림책/무비/체험은 모드가 핵심 → 모드 먼저. 텍스트는 내용 먼저. */
  const tabs = (ptype === 'text')
    ? [contentTab, modeTab]
    : [modeTab, contentTab];

  if (hasChoice) {
    tabs.push({ key: 'choice', label: '🔘 선택지', html: null /* legacyChoiceSectionHtml로 채움 */ });
  }
  return tabs;
}

/* 재렌더 후 활성 탭 복원. 이전 탭이 새 구성에 없으면 그대로(첫 탭 활성). */
function _restoreActiveTab(panel, prevKey) {
  if (!prevKey) return;
  const targetTab = panel.querySelector(`.edit-tab[data-tab="${prevKey}"]`);
  if (!targetTab) return;  /* 모드 바뀜 등으로 탭이 없으면 그대로 */
  panel.querySelectorAll('.edit-tab').forEach(t => t.classList.remove('is-on'));
  targetTab.classList.add('is-on');
  panel.querySelectorAll('.edit-tab-panel').forEach(p => {
    if (p.getAttribute('data-panel') === prevKey) p.classList.add('is-on');
    else p.classList.remove('is-on');
  });
}

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
function _openPbDrawModal(scene) {
  /* 이미 열려있으면 무시 */
  if (document.getElementById('pb-draw-modal')) return;

  /* v36: 캔버스 비율을 활성 scene의 실제 그림 영역(.pb-illust)에서 측정.
     4가지 모드(가로/세로 × 분할/그림중심) 모두 자동 일치.
     해상도 1800 → 1200 (v36 태블릿): 태블릿 CPU에서 putImageData/getImageData/flood fill
     빠르게. 디테일 충분 + 메모리·성능 균형. */
  const submode = scene.picturebookSubmode === 'imageCenter' ? 'imageCenter' : 'split';
  let canvasW = 1200, canvasH = 505;   /* fallback — landscape split 근사 */
  const illustEl = document.querySelector(
    submode === 'imageCenter'
      ? '.scene-screen--pb.pb--imagecenter .pb-illust'
      : '.scene-screen--pb.pb--split .pb-illust'
  );
  if (illustEl) {
    const rect = illustEl.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const ratio = rect.width / rect.height;
      canvasW = 1200;
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
        <h3 class="pb-draw-title">✏️ 바로 그리기 <span class="pb-draw-submode-hint">${submode === 'imageCenter' ? '(그림 중심형)' : '(분할형)'}</span></h3>
        <button type="button" class="pb-draw-close js-pb-draw-cancel" title="취소">✕</button>
      </div>

      <div class="pb-draw-toolbar">
        <!-- 도구: 펜 / 지우개 / 직선 / 사각형 / 원 / 페인트 버킷 / 스포이드 / 글자 (v36) -->
        <div class="pb-draw-tools">
          <button type="button" class="pb-draw-tool js-pb-draw-tool is-on" data-tool="pen" title="자유롭게 그리기">✏️ 펜</button>
          <button type="button" class="pb-draw-tool js-pb-draw-tool" data-tool="eraser" title="지우기">🧽 지우개</button>
          <button type="button" class="pb-draw-tool js-pb-draw-tool" data-tool="line" title="직선">📏 직선</button>
          <button type="button" class="pb-draw-tool js-pb-draw-tool" data-tool="rect" title="사각형">▭ 사각</button>
          <button type="button" class="pb-draw-tool js-pb-draw-tool" data-tool="circle" title="원">◯ 원</button>
          <button type="button" class="pb-draw-tool js-pb-draw-tool" data-tool="bucket" title="영역 채우기">🪣 채우기</button>
          <button type="button" class="pb-draw-tool js-pb-draw-tool" data-tool="eyedropper" title="캔버스에서 색 가져오기 — 클릭한 점의 색이 펜 색이 됩니다">💧 색 따기</button>
          <button type="button" class="pb-draw-tool js-pb-draw-tool" data-tool="pan" title="화면 이동 — 확대 후 다른 영역 보기">✋ 이동</button>
        </div>

        <!-- 확대·축소 (v37): 캔버스 안에서 줌 인/아웃, 이동 도구로 다른 영역 보기 -->
        <div class="pb-draw-section">
          <span class="pb-draw-section-label">확대</span>
          <div class="pb-draw-zoom">
            <button type="button" class="pb-draw-zoom-btn js-pb-draw-zoom-out" title="축소">−</button>
            <span class="pb-draw-zoom-val js-pb-draw-zoom-val">100%</span>
            <button type="button" class="pb-draw-zoom-btn js-pb-draw-zoom-in" title="확대">＋</button>
            <button type="button" class="pb-draw-zoom-btn js-pb-draw-zoom-reset" title="원래대로">↺</button>
          </div>
        </div>

        <!-- 펜 종류 (펜 도구일 때만 활성) - v36 -->
        <div class="pb-draw-section js-pb-draw-pentype-wrap">
          <span class="pb-draw-section-label">펜 종류</span>
          <div class="pb-draw-pentypes">
            <button type="button" class="pb-draw-pentype js-pb-draw-pentype is-on" data-pentype="normal" title="일반 펜">✒️ 일반</button>
            <button type="button" class="pb-draw-pentype js-pb-draw-pentype" data-pentype="marker" title="마커 (부드럽고 진함)">🖍 마커</button>
            <button type="button" class="pb-draw-pentype js-pb-draw-pentype" data-pentype="pencil" title="연필 (얇고 거침)">✏️ 연필</button>
            <button type="button" class="pb-draw-pentype js-pb-draw-pentype" data-pentype="crayon" title="크레용 (거친 질감)">🖌 크레용</button>
          </div>
        </div>

        <!-- 채움 토글 (도형 도구일 때만 의미 — UI는 항상 표시) - v36 -->
        <div class="pb-draw-section">
          <label class="pb-draw-fill-label">
            <input type="checkbox" class="js-pb-draw-fill">
            <span>도형 채움</span>
          </label>
        </div>

        <!-- 색 — 8색 + 자유 선택 -->
        <div class="pb-draw-section">
          <span class="pb-draw-section-label">색</span>
          <div class="pb-draw-colors">
            ${COLORS.map((c, i) => `
              <button type="button" class="pb-draw-color js-pb-draw-color${i===0?' is-on':''}"
                data-color="${c}" style="background:${c};" title="${c}"></button>
            `).join('')}
            <input type="color" class="pb-draw-color-pick js-pb-draw-color-pick"
              value="${COLORS[0]}" title="자유 색 선택">
          </div>
        </div>

        <!-- 굵기 — 4단계 + 슬라이더 -->
        <div class="pb-draw-section">
          <span class="pb-draw-section-label">굵기</span>
          <div class="pb-draw-sizes">
            ${SIZES.map((s, i) => `
              <button type="button" class="pb-draw-size js-pb-draw-size${i===1?' is-on':''}"
                data-size="${s.px}" title="${s.label}">
                <span class="pb-draw-size-dot" style="width:${s.px}px;height:${s.px}px;"></span>
              </button>
            `).join('')}
            <input type="range" class="pb-draw-size-slider js-pb-draw-size-slider"
              min="1" max="30" value="5" title="자유 굵기">
            <span class="pb-draw-size-val js-pb-draw-size-val">5px</span>
          </div>
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

        <!-- 액션 -->
        <div class="pb-draw-actions">
          <button type="button" class="pb-draw-action js-pb-draw-undo" title="되돌리기 (Ctrl+Z)">↶ 되돌리기</button>
          <button type="button" class="pb-draw-action js-pb-draw-redo" title="다시 실행 (Ctrl+Shift+Z)">↷ 다시</button>
          <button type="button" class="pb-draw-action js-pb-draw-clear" title="전체 지우기">🗑 전체 지우기</button>
        </div>
      </div>

      <!-- 캔버스 영역 -->
      <div class="pb-draw-canvas-wrap">
        <canvas id="pb-draw-canvas" width="${canvasW}" height="${canvasH}"
          style="aspect-ratio: ${canvasW} / ${canvasH}; touch-action: none; cursor: crosshair;"></canvas>
      </div>

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
      if (state.history.length > 30) state.history.shift();
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

  /* v36: 스포이드 — 클릭 픽셀 색 추출 → state.color 박음 */
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

  /* v36: 글자 박기 — 캔버스 클릭 위치에 prompt로 받은 텍스트 박음 */
  function _drawText(x, y) {
    const text = window.prompt('박을 글자를 입력하세요', '');
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

    /* v37: 이동 도구 — pointerdown 시작 위치 박고 drawing false (그리기 안 함) */
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

    /* v36: 글자 도구 — prompt로 입력 받아 그 위치에 박음 */
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
    /* 연필·크레용 거친 질감 — endpoint(newMid)에서만 박음 */
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
    });
  });

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
  modal.querySelector('.js-pb-draw-clear')?.addEventListener('click', () => {
    if (!confirm('지금까지 그린 그림이 모두 지워집니다. 계속할까요?')) return;
    _snapshot();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  });

  function _undo() {
    if (state.history.length <= 1) return;
    const cur = state.history.pop();
    state.future.push(cur);
    if (state.future.length > 30) state.future.shift();
    const prev = state.history[state.history.length - 1];
    if (prev) ctx.putImageData(prev, 0, 0);
  }
  function _redo() {
    if (!state.future.length) return;
    const next = state.future.pop();
    state.history.push(next);
    if (state.history.length > 30) state.history.shift();
    ctx.putImageData(next, 0, 0);
  }

  /* 키보드 단축키 — Ctrl+Z / Ctrl+Shift+Z */
  function _onKey(e) {
    if (!document.getElementById('pb-draw-modal')) return;   /* 모달 닫힘 */
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
    modal.remove();
  }
  modal.querySelectorAll('.js-pb-draw-cancel').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.history.length > 1) {
        if (!confirm('그린 그림이 저장되지 않습니다. 취소할까요?')) return;
      }
      _close();
    });
  });
  modal.querySelector('.pb-draw-backdrop')?.addEventListener('click', () => {
    if (state.history.length > 1) {
      if (!confirm('그린 그림이 저장되지 않습니다. 취소할까요?')) return;
    }
    _close();
  });

  /* 저장 — 캔버스 → data URL → Storage 업로드 → URL을 scene.imageData에 박음.
     v114: base64 RTDB 폭탄 차단. 그림 그리기도 Storage 박음. */
  modal.querySelector('.js-pb-draw-save')?.addEventListener('click', async () => {
    try {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      let storageUrl;
      try {
        const r = await viewerUploadImageToStorage(dataUrl, scene.num || scene.id);
        storageUrl = r.downloadURL;
      } catch (e) {
        alert(`❌ 그림 업로드 실패: ${e.message || e}\n\n잠시 후 다시 시도해주세요.`);
        return;
      }
      scene.imageData = storageUrl;
      if (typeof _queueSave === 'function') {
        _queueSave(scene.num || scene.id, { imageData: storageUrl });
        if (typeof _flushPendingSave === 'function') _flushPendingSave();
      }
      renderEditPanel();
      _scheduleViewerFrameReRender();
      _close();
    } catch (err) {
      alert(`저장 실패: ${err.message || err}`);
    }
  });
}
