/* ================================================================
   viewer-data.js — Firebase 데이터 읽기 + maker→viewer adapter
   의존: viewer-state.js, Firebase SDK

   Adapter 원칙:
   - maker DB 구조를 절대 수정하지 않음
   - viewer 내부에서 변환해서 사용
   - maker: { choiceA, choiceB, nextA, nextB }
   - viewer: { choices: [{ id, label, nextId, presentation }] }
   ================================================================ */

const firebaseConfig = {
  apiKey:            'AIzaSyBK12nBkj6Pdwu-zpL3w0krU1PzS78McmE',
  authDomain:        'picturebook-8731f.firebaseapp.com',
  databaseURL:       'https://picturebook-8731f-default-rtdb.firebaseio.com',
  projectId:         'picturebook-8731f',
  storageBucket:     'picturebook-8731f.firebasestorage.app',
  messagingSenderId: '590974087190',
  appId:             '1:590974087190:web:a9e9ba15adf020ff470537',
};

/* ================================================================
   POLISH-AUTH-FIX: 편집 뷰어(maker→다듬기)는 maker가 쓰는 default app을 사용한다.
   ────────────────────────────────────────────────────────────────
   배경: maker는 firebase.js의 default app([DEFAULT])에서 익명 로그인 → 그 UID에
   members/{uid}/status='active'가 박힌다. 반면 viewer는 named 'viewer' app에서
   별도 익명 로그인 → 다른 UID → 비공개(v2) scenes Rules(멤버/교사 필요)에서 거부.
   같은 origin·같은 [DEFAULT] app·같은 apiKey면 Firebase Auth가 persisted UID를
   복원하므로, 편집 세션에서는 default app을 쓰면 maker UID가 그대로 복원된다.
   공개/일반 감상(편집 아님)은 기존 named 'viewer' app + 익명 흐름을 그대로 유지한다.
   ================================================================ */
let _viewerDb = null;
let _viewerAuthPromise = null;

function _viewerSearch(search) {
  return (typeof search === 'string')
    ? search
    : (typeof location !== 'undefined' ? location.search : '');
}

/* maker 인증 세션 — URL ?from=maker. 편집(다듬기)·완성본 보기/미리보기·교사 보기 모두 포함.
   maker/교사가 자기(반) 작품을 보는 내부 진입(외부 공유 URL엔 from=maker 없음=클래스 코드 사용).
   → default app(maker UID 복원)을 써서 비공개 작품도 본인 권한으로 읽는다. 순수 함수(테스트용 인자). */
function isMakerAuthSession(search) {
  try { return new URLSearchParams(_viewerSearch(search)).get('from') === 'maker'; }
  catch (_) { return false; }
}

/* 편집 뷰어 세션 — URL ?edit=1&from=maker. maker 세션 중 '편집'만.
   편집은 인증이 필수라 복원 실패 시 하드 차단 + 편집 코드의 익명 로그인 금지 가드 대상. */
function isEditViewerSession(search) {
  try {
    const p = new URLSearchParams(_viewerSearch(search));
    return p.get('edit') === '1' && p.get('from') === 'maker';
  } catch (_) { return false; }
}

/* viewer가 쓸 Firebase app — maker 세션이면 default app(maker UID 복원), 그 외엔 named 'viewer'.
   getViewerApp()는 절대 throw하지 않는다(내부에서 initializeApp으로 보장). */
function getViewerApp() {
  if (isMakerAuthSession()) {
    try { return firebase.app(); }
    catch (_) { return firebase.initializeApp(firebaseConfig); }
  }
  try { return firebase.app('viewer'); }
  catch (_) { return firebase.initializeApp(firebaseConfig, 'viewer'); }
}

/* 편집 뷰어: persisted maker UID 복원을 기다린다. 새 익명 로그인은 절대 하지 않는다.
   복원된 user, 또는 null(=maker 세션 없음)로 resolve. */
function _awaitMakerAuth(app) {
  return new Promise(resolve => {
    let auth;
    try { auth = app.auth(); } catch (_) { return resolve(null); }
    if (auth.currentUser) return resolve(auth.currentUser);
    let done = false, unsub = null;
    const finish = (u) => {
      if (done) return; done = true;
      try { if (typeof unsub === 'function') unsub(); } catch (_) {}
      resolve(u || null);
    };
    try { unsub = auth.onAuthStateChanged(u => finish(u), () => finish(null)); }
    catch (_) { return finish(auth.currentUser); }
    /* 복원이 지연/실패해도 멈추지 않도록 안전망 — 익명 로그인은 하지 않는다. */
    setTimeout(() => finish(auth.currentUser), 8000);
  });
}

function getViewerDb() {
  if (_viewerDb) return _viewerDb;
  const app = getViewerApp();
  _viewerDb = app.database();
  if (isMakerAuthSession()) {
    /* maker 세션(편집/완성본/교사보기): default app maker UID 복원 대기 준비. 새 익명 로그인 금지(_awaitMakerAuth). */
    if (typeof window !== 'undefined' && !window.viewerAuthReady) {
      window.viewerAuthReady = _awaitMakerAuth(app);
    }
  } else if (!_viewerAuthPromise && app && typeof app.auth === 'function') {
    /* 공개/일반 감상 — 기존 named 'viewer' app 익명 로그인 사전 보장(원본 동작 유지).
       이미지 업로드 / lock transaction 호출 시점에 인증이 박혀 있도록 미리 시도. */
    try {
      const auth = app.auth();
      if (!auth.currentUser) {
        _viewerAuthPromise = auth.signInAnonymously()
          .then(c => { try { console.log('[viewer] anonymous auth OK', c && c.user && c.user.uid); } catch(_) {} return c; })
          .catch(e => { try { console.warn('[viewer] anonymous auth 실패 (재시도는 각 함수에서 진행)', e && e.code, e && e.message); } catch(_) {} _viewerAuthPromise = null; });
      }
    } catch (e) { /* auth SDK 없거나 init 실패 — 각 함수에서 다시 시도 */ }
  }
  return _viewerDb;
}

/* 다른 모듈(viewer-edit/ai/locks)이 같은 app·세션 판정을 공유하도록 전역 노출. */
if (typeof window !== 'undefined') {
  window.getViewerApp = getViewerApp;
  window.isEditViewerSession = isEditViewerSession;
  window.isMakerAuthSession = isMakerAuthSession;
}

/* ================================================================
   lookupClassIdForViewer — 클래스 코드 → classId
   viewer 전용 Firebase 인스턴스(getViewerDb) 사용
   firebase.js의 _lookupClassId는 maker DB 인스턴스를 사용하므로 별도 구현
   ================================================================ */
async function lookupClassIdForViewer(code) {
  const db   = getViewerDb();
  const snap = await db.ref(`classCodes/${code}`).once('value');
  if (!snap.exists()) return null;
  return snap.val();   // classCodes/$code = classId (문자열)
}

/* DESIGN-SYSTEM-V1 D5: legacy pbTheme(기존 6키) → 신규 5스킨 fallback(렌더 표시용).
   ⚠️ DB 저장값(ViewerState.project.pbTheme / viewer-meta.pbTheme)은 절대 바꾸지 않는다 —
   body[data-pb-theme]에 박는 "표시값"만 normalize. 신규 5키는 그대로 통과.
   사용자가 다듬기 UI에서 새 스킨을 다시 선택하면 그때 신규 키가 저장된다(아래 핸들러). */
function normalizePicturebookTheme(theme) {
  const map = {
    'classic-book':  'cozy-storybook',
    'paper-desk':    'paper-storybook',
    'minimal-cream': 'gallery-picturebook',
    'sketch-note':   'paper-storybook',
    'library-card':  'gallery-picturebook',
    'night-tale':    'night-story',
  };
  return map[theme] || theme || 'cozy-storybook';
}

/* ================================================================
   loadTeamData — 팀명으로 maker DB 읽기
   반환: Promise<void> (ViewerState에 직접 주입)
   classId: v2 경로에서 필요 (v1에서는 null)
   fromMaker: 교사/제작자 테스트 세션 여부 (isPublic 차단 제외용)
   ================================================================ */
/* IMAGE-S2-RENDER-1: 작품(team) 단위로 1회 로드하는 "발행된" 이미지 AI 결과/선택 캐시.
   · aiVariants/image(s2 변형) + aiVariants/imageSelections(교사 선택) — 둘 다 read:true(학생도 읽기 가능).
   · 렌더(viewer-render)가 동기 helper getPublishedImageDisplaySrc로 참조 → 매 렌더 fetch 없음.
   · viewer-ai(편집/AI 전용·지연로딩)와 무관하게 항상 로드되는 viewer-data에 둠 → 일반 감상(학생)에도 반영. */
let _pubImageS2BySid  = null;   /* { sid: aiVariants.image[sid].s2 (raw) } */
let _pubImageSelBySid = null;   /* { sid: aiVariants.imageSelections[sid] (raw) } */

async function loadTeamData(teamName, classId = null, fromMaker = false, ptypeHint = null) {
  const db          = getViewerDb();
  const encodedName = encodeURIComponent(teamName);

  /* POLISH-AUTH-FIX: maker 세션(편집/완성본/교사보기)은 maker UID(default app) 복원을 기다린 뒤 읽는다
     (복원 전 read → permission_denied 레이스 차단). 새 익명 로그인은 하지 않는다.
     · 편집(edit=1)은 인증 필수 → 복원 실패 시 안전 안내 + 만들기 복귀(하드 차단).
     · 완성본/미리보기(비편집)는 공개 작품도 있으므로 차단하지 않고 진행 — 비공개는 Rules가 거부. */
  if (isMakerAuthSession()) {
    const makerUser = await ((typeof window !== 'undefined' && window.viewerAuthReady) || Promise.resolve(null));
    if (!makerUser && isEditViewerSession()) {
      const e = new Error('편집 권한을 확인할 수 없어요.\n만들기 화면으로 돌아가 다시 들어와 주세요.');
      e.code = 'viewer/edit-auth-missing';
      throw e;
    }
  }

  /* 경로: v1 = teams/$name, v2 = classes/$classId/teams/$name */
  const basePath = (classId)
    ? `classes/${classId}/teams/${encodedName}`
    : `teams/${encodedName}`;

  /* W7 성능 보강: scenes + viewer-meta를 병렬 로드.
     · 이전엔 scenes 다 받은 뒤(수MB 가능) viewer-meta 받음 → 순차 1~3초 + 그림책 깜빡임.
     · 이제 둘 다 동시 시작. viewer-meta가 보통 더 빨리 와 projectType 즉시 결정.
     · 더 이상 RTDB round-trip 두 번 + 직렬 대기 없음. */
  const [snapshot, metaSnap, imgVarSnap, imgSelSnap] = await Promise.all([
    db.ref(`${basePath}/scenes`).once('value'),
    db.ref(`${basePath}/viewer-meta`).once('value'),
    /* IMAGE-S2-RENDER-1: AI 이미지 변형/선택 — 비치명적(.catch→null). 없거나 실패해도 원본 표시는 무영향. */
    db.ref(`${basePath}/aiVariants/image`).once('value').then((s) => s.val()).catch(() => null),
    db.ref(`${basePath}/aiVariants/imageSelections`).once('value').then((s) => s.val()).catch(() => null),
  ]);
  const rawScenes = snapshot.val();
  const meta      = metaSnap.val();

  if (!rawScenes) throw new Error(`"${teamName}" 작품을 찾을 수 없어요.`);

  /* IMAGE-S2-RENDER-1: 발행된 이미지 선택/변형 캐시 적재(team 1회). 실패/부재 시 빈 캐시 → 원본 표시. */
  _setPublishedImageCaches(imgVarSnap, imgSelSnap);

  /* W7 projectType 강제 lock (사용자 결정):
     "무슨일이있어도 다른모드로 맘대로 못넘어가게 설정해"
     ─────────────────────────────────────────────────────────────
     결정 우선순위 (위에서 아래 순서):
     1. viewer-meta.projectType valid → 그 값 (DB가 절대 진실)
     2. ptypeHint valid (maker URL ?ptype=) → hint 사용 + DB 보정 저장
        ※ hint는 maker가 메모리에 가진 사용자 결정. lock 정책의 연장이지 위배 아님.
     3. 그 외 → 'picturebook' fallback (legacy 작품 보호용 최후 수단)
        · DB 보정 저장 안 함 — fallback이 실제 작품 모드와 다를 수 있음
        · 사용자가 maker에서 ptype 화면 거치면 그때 정상 박힘 */
  const VALID_PTYPES = ['text', 'picturebook', 'movie', 'experience'];
  if (meta && typeof meta.projectType === 'string' && VALID_PTYPES.includes(meta.projectType)) {
    ViewerState.project.projectType = meta.projectType;
  } else if (typeof ptypeHint === 'string' && VALID_PTYPES.includes(ptypeHint)) {
    /* maker가 보낸 hint — 사용자 결정의 연장. fallback 대신 hint 사용 + DB 보정 저장. */
    ViewerState.project.projectType = ptypeHint;
    try {
      db.ref(`${basePath}/viewer-meta/projectType`).set(ptypeHint);
      console.log('[projectType lock] hint로 보정 저장:', ptypeHint, '| basePath:', basePath);
    } catch (e) { /* noop */ }
  } else {
    /* viewer-meta 없거나 projectType 없는 legacy 작품 — 그림책 fallback.
       이 fallback은 read-only — DB에 보정 저장 X. */
    ViewerState.project.projectType = 'picturebook';
  }

  ViewerState.project.teamName = teamName;
  ViewerState.project.classId  = classId;  // ★ v2에서 저장 경로에 재사용
  ViewerState.scenes           = adaptScenes(rawScenes);

  /* 프로젝트 메타 — projectType 외 나머지 필드 처리 (위에서 이미 받음) */
  if (meta) {
    if (meta.mode)     ViewerState.project.mode     = meta.mode;
    if (meta.theme)    ViewerState.project.theme    = meta.theme;
    if (meta.template) ViewerState.project.template = meta.template;
    /* ★ 저장된 presentation 데이터를 scenes에 반영 — 이 줄이 없으면 edit 저장값이 유실됨 */
    if (meta.presentation) applyPresentationData(meta.presentation);

    /* ★ isPublic 상태 반영 */
    ViewerState.project.isPublic = meta.isPublic === true;

    /* ★ 표지 / 시작점 구조 필드 로드 (있으면 사용) */
    if (typeof meta.coverTitle     === 'string') ViewerState.project.coverTitle     = meta.coverTitle;
    if (typeof meta.coverImageData === 'string') ViewerState.project.coverImageData = meta.coverImageData;
    if (meta.entrySceneId  !== undefined && meta.entrySceneId  !== null) {
      ViewerState.project.entrySceneId  = String(meta.entrySceneId);
    }
    if (meta.replaySceneId !== undefined && meta.replaySceneId !== null) {
      ViewerState.project.replaySceneId = String(meta.replaySceneId);
    }

    /* v37 ★ 핵심 fix — 페이지 방향·테마가 meta에 저장되지만 여기서 안 읽어와서
       maker 진입·감상 테스트 시 ViewerState에 박히지 않고 초기화되던 문제.
       사용자 보고: "다듬기에서 박은 모드가 브랜치 화면 돌아오면 리셋됨". */
    if (typeof meta.pageOrientation === 'string') {
      ViewerState.project.pageOrientation = meta.pageOrientation;
    }
    /* 2026-06-01 Movie-H: 무비형 선택지 표시 방식(작품 단위). panel(기본) | card.
       pageOrientation과 동일 화이트리스트 읽기 — 새 필드 1개, 저장 구조 변경 없음. */
    if (typeof meta.movieDecisionStyle === 'string') {
      ViewerState.project.movieDecisionStyle = meta.movieDecisionStyle;
    }
    if (typeof meta.pbTheme === 'string') {
      ViewerState.project.pbTheme = meta.pbTheme;
    }

    /* v138: 그림책형 본문 카드 톤 시스템 (작품 단위)
       장면 1에서 박은 값이 작품 전체 일반 분할형·엔딩 분할형에 적용됨.
       valid 값만 인정 — 그 외엔 null로 두어 옛 viewer.css 규칙 그대로 사용. */
    const VALID_CARD_STYLES = ['default', 'paper', 'border', 'pastel'];
    const VALID_CARD_COLORS = ['white', 'green', 'yellow', 'blue'];
    ViewerState.project.textCardStyle =
      (typeof meta.textCardStyle === 'string' && VALID_CARD_STYLES.includes(meta.textCardStyle))
        ? meta.textCardStyle : null;
    ViewerState.project.textCardColor =
      (typeof meta.textCardColor === 'string' && VALID_CARD_COLORS.includes(meta.textCardColor))
        ? meta.textCardColor : null;

    /* REFINE-IA-2: 텍스트형 작품 전체 기본 스타일(작품 단위). 없으면(옛 작품) undefined →
       getProjectTextDefaults가 null 반환 → resolution이 현행과 동일(화면변화 0). raw 보관, 해석은 getter가 정규화. */
    ViewerState.project.textDefaults =
      (meta.textDefaults && typeof meta.textDefaults === 'object') ? meta.textDefaults : null;

    /* v64: 장면 전환 효과 (작품 단위 메타)
       v73: 속도는 string('fast'/'normal'/'slow')에서 number(0~100)로 마이그레이션.
       옛 string 그대로 박혀있으면 자동 변환 (fast=0, normal=50, slow=100). */
    const VALID_TRANS = ['fade', 'book', 'scale', 'slide-up', 'flip3d'];
    const LEGACY_SPEED_MAP = { fast: 0, normal: 50, slow: 100 };
    ViewerState.project.sceneTransition = VALID_TRANS.includes(meta.sceneTransition)
      ? meta.sceneTransition : 'fade';
    let _stSpeed = meta.sceneTransitionSpeed;
    if (typeof _stSpeed === 'string' && _stSpeed in LEGACY_SPEED_MAP) {
      _stSpeed = LEGACY_SPEED_MAP[_stSpeed];
    }
    _stSpeed = typeof _stSpeed === 'number' ? _stSpeed : 50;
    ViewerState.project.sceneTransitionSpeed = Math.max(0, Math.min(100, Math.round(_stSpeed)));

    /* v71: 텍스트 등장 애니메이션 (작품 단위 메타) — 그림책 모드 본문 + 표지 제목/소개
       v73: 속도 number(0~100)로. 옛 string 마이그레이션. */
    const VALID_TEXT_ENTRANCE = ['none', 'fade', 'slide-up', 'blur-in', 'pop', 'typewriter'];
    ViewerState.project.textEntrance = VALID_TEXT_ENTRANCE.includes(meta.textEntrance)
      ? meta.textEntrance : 'none';
    let _teSpeed = meta.textEntranceSpeed;
    if (typeof _teSpeed === 'string' && _teSpeed in LEGACY_SPEED_MAP) {
      _teSpeed = LEGACY_SPEED_MAP[_teSpeed];
    }
    _teSpeed = typeof _teSpeed === 'number' ? _teSpeed : 50;
    ViewerState.project.textEntranceSpeed = Math.max(0, Math.min(100, Math.round(_teSpeed)));
  }

  /* v37: 텍스트 모드는 무조건 세로 (스마트폰 비율, 스마트폰·태블릿·PC 모두 동일).
     사용자 결정: "텍스트는 스마트폰 화면 최적화 — PC에서도 같은 비율". */
  const ptype = ViewerState.project.projectType;
  if (ptype === 'text') {
    /* 텍스트는 강제 portrait — 이전 박은 데이터 무시 */
    ViewerState.project.pageOrientation = 'portrait';
  } else if (!ViewerState.project.pageOrientation) {
    ViewerState.project.pageOrientation = 'landscape';
  }

  /* v37 ★★ 진짜 root fix — body data attribute 박음.
     CSS 컨테이너 쿼리·페이지 비율·테마 룰 모두 body[data-page-orientation],
     body[data-pb-theme]에 의존. ViewerState에만 박고 body data 안 박으면
     모든 후속 렌더가 기본 landscape로 동작 = "감상 테스트가 그냥 가로".
     loadTeamData 끝나는 시점에 body data 동기화. */
  if (document.body) {
    const orient = ViewerState.project.pageOrientation;
    if (orient === 'portrait' || orient === 'landscape') {
      document.body.dataset.pageOrientation = orient;
    }
    /* T-THEME-1: pbTheme(양옆 마감 테마)는 그림책 작품에서만 body data에 박음.
       텍스트 등 비-그림책 작품은 DB에 pbTheme 값이 남아 있어도 표시에서 무시 +
       이전 화면(그림책 팀)에서 남은 dataset까지 명시 제거(팀 전환 잔존 차단).
       DB 원본값은 삭제하지 않음(렌더/메뉴에서만 무시). */
    if (ptype === 'picturebook') {
      /* HOTFIX(신규 그림책 기본 스킨): 그림책은 스킨 저장값이 없어도 '포근한 동화책'
         (cozy-storybook)으로 표시한다 — 무스킨 화면 방지. normalizePicturebookTheme가
         빈값/legacy를 cozy-storybook으로 정규화(map[..]||theme||'cozy-storybook').
         · DB 저장값(viewer-meta.pbTheme)은 절대 변경하지 않음 — 표시용 body data만.
         · 신규 그림책·스킨 없는 기존 작품 모두 cozy 렌더(migration·자동저장 0).
         · 명시적 스킨(paper/gallery/forest/night/cozy)은 그대로 통과(보존). */
      document.body.dataset.pbTheme = normalizePicturebookTheme(ViewerState.project.pbTheme);
    } else {
      delete document.body.dataset.pbTheme;
    }
    /* v82: v79 박은 body.dataset.coverTheme 폐기 — 사용자 의도는 표지 색이 아닌
       pb-theme(양옆 마감 테마)이 letterbox 전체 둘러쌈. body.dataset.pbTheme이 이미
       박혀있으니 CSS body[data-pb-theme] #stage-wrap 룰만 박으면 됨. */
  }

  /* v64: 장면 전환 효과 (작품 단위) — #viewer-frame data 속성으로.
     v73: 속도는 CSS 변수 --scene-trans-duration, --text-ent-duration, --text-tw-step (ms).
     applyWorkEffectVars 헬퍼가 슬라이더 0~100 → ms로 매핑 + viewer-frame style에 박음. */
  const vf = document.getElementById('viewer-frame');
  if (vf) {
    vf.dataset.transition   = ViewerState.project.sceneTransition || 'fade';
    vf.dataset.textEntrance = ViewerState.project.textEntrance || 'none';
    if (typeof applyWorkEffectVars === 'function') {
      applyWorkEffectVars(vf,
        ViewerState.project.sceneTransitionSpeed,
        ViewerState.project.textEntranceSpeed,
        ViewerState.project.textEntrance);
    }
  }

  /* ================================================================
     하위 호환 마이그레이션 (in-memory만 — Firebase 저장 X)
     ─────────────────────────────────────────────────────────────
     기존 작품엔 viewer-meta의 cover/entry/replay가 없음.
     이 경우 기존 start scene을 기준으로 자동 매핑해서 viewer 동작 보장.
     영구 저장은 하지 않음 (maker에서 편집 UI 나오면 그때 저장).
     ================================================================ */
  _migrateCoverAndEntryDefaults();

  /* ================================================================
     공개 정책 차단
     ─────────────────────────────────────────────────────────────
     isPublic === true          → 누구나 감상 가능
     fromMaker === true         → 제작자/교사 테스트 세션 → 통과
     그 외                      → 비공개 안내 후 차단

     ⚠️ 이 차단은 앱 코드 수준의 UX 차단이지 강한 서버 보안이 아님.
        Firebase Rules 수준에서는 scenes/.read: true 가 아직 열려 있음.
        Rules 강화(anonymous Auth 도입)와 함께 보완 예정.
     ─────────────────────────────────────────────────────────────*/
  const isPublic = ViewerState.project.isPublic;

  if (!isPublic && !fromMaker) {
    throw new Error('아직 공개되지 않은 작품이에요.\n교사가 공개하면 감상할 수 있어요.');
  }
}

/* ================================================================
   saveSceneText — 글 수정 저장 (scene 본체 데이터 직접 patch)
   ─────────────────────────────────────────────────────────────
   · presentation 노드가 아니라 `scenes/${num}` 본체에 쓴다
   · 허용 필드:
       - title, body                                   (글 데이터)
       - presentationMode, presentationSubmode         (모드)
       - movieData                                     (무비형 옵션)
       - textBox                                       (텍스트 박스 위치/크기)
       - buttons                                       (N개 버튼 배열, v0.3 표준)
       - choiceA, choiceB, choiceCount                 (maker 호환 동기화 — 옵션 2)
   · maker 호환 정책 (옵션 2):
       viewer-edit가 buttons를 저장할 때 buildButtonsPatchForSave가
       buttons + choiceA/B/choiceCount를 함께 patch에 넣는다.
       이렇게 하면 maker가 choiceA/B/choiceCount만 읽어도 첫 1~2개 버튼은
       정합 상태로 보임. 3번째 이상 버튼은 buttons[]에 보존되지만
       maker UI에는 안 보임 (의도된 동작).
   · nextA/nextB는 분기 연결값이라 viewer-edit이 손대지 않음 — maker만 관리.
   · 구조 필드(type, x, y)는 절대 손대지 않음
   · `.update(patch)`로 일부 필드만 교체 (전체 set 금지)
   · 잠금 확보된 상태에서 호출해야 함 (이번 턴: viewer-edit이 책임)
   ================================================================ */
async function saveSceneText(num, fields) {
  const db          = getViewerDb();
  const teamName    = ViewerState.project.teamName;
  const classId     = ViewerState.project.classId;
  const encodedName = encodeURIComponent(teamName);
  const basePath    = classId
    ? `classes/${classId}/teams/${encodedName}`
    : `teams/${encodedName}`;

  const ALLOWED = [
    'title', 'body',
    'presentationMode', 'presentationSubmode',
    'movieData', 'textBox',
    'buttons',
    /* maker 호환 동기화 (옵션 2) — buttons 저장 시 함께 patch */
    'choiceA', 'choiceB', 'choiceCount',
    'nextA', 'nextB',     /* W2-B-α: nextId 변경 시 maker canvas 화살표 정합성 */
    'bodyEnabled',        /* 3단계: 무비형 본문 사용 ON/OFF (scene 단위 명시 필드) */
    'picturebookSubmode', /* 3단계: 그림책형 하위 모드 (split | imageCenter) */
    'picturebookBodyBox', /* W4-A: 그림책형 본문 글상자 위치/폭/배경막 (그림 중심형 전용) */
    'connectObjects',     /* W6: 체험전시형 정식 연결 오브젝트 모델 [{id,type,x,y,w,h,label,nextId}] */
    'textStyle',          /* W5: 텍스트형 글자 스타일 {fontFamily, fontSize, color, weight} */
    'textStyleOverride',  /* REFINE-IA-2.1: 항목별 "일부러 다르게 한" 표시 {fontFamily?,fontSize?,color?,weight?} */
    'textThemeOverride',  /* REFINE-IA-2.1: 테마 "일부러 다르게 한" 표시 (bool) */
    'textTheme',          /* W5: 텍스트형 테마 (8종 중 1) */
    'textEffect',         /* W5: 텍스트형 효과 {entrance, body} */
    'imageData',          /* W7: 무비형 포스터 이미지 (그림책형/체험전시형도 사용 — 다듬기 패널 업로드 저장) */
    /* v67: 표지 scene 필드 — 다듬기에서 박은 정보 저장 (이전엔 ALLOWED 누락으로 손실) */
    'subtitle',           /* 표지 한 줄 소개 */
    'coverTheme',         /* 표지 색 테마 */
    'titleVerticalPosition', /* 표지 제목 높낮이 */
    'kicker',             /* v129: 표지 상단 문구 — 작품 제목 위 작은 문구. 비우면 표시 안 됨 */
    /* v138: 그림책형 본문 카드 톤 — 장면 단위. 일반 분할형 5종 / 엔딩 분할형 3종.
       작품 단위(textCardStyle/textCardColor)는 viewer-meta에서 관리. */
    'pbCardTone',         /* 일반 장면 톤: default | bright | develop | tense | crisis */
    'pbEndingTone',       /* 엔딩 장면 마감톤: default | bright | afterglow */
    'pbEndingMood',       /* PB-MOOD-1A: 엔딩 분위기(감정) happy | sad — imageCenter 엔딩 표시용 */
    'pbStoryStage',       /* PB-MOOD-2: 일반 장면 이야기 단계 rising(승) | turning(전) — imageCenter 장면 표시용 */
  ];
  const patch = {};
  ALLOWED.forEach(k => {
    if (fields && Object.prototype.hasOwnProperty.call(fields, k)) {
      patch[k] = fields[k];
    }
  });
  if (!Object.keys(patch).length) return;

  await db.ref(`${basePath}/scenes/${num}`).update(patch);
}

/* ================================================================
   REFINE-IA-2 — 작품 전체 텍스트 기본값 저장 (텍스트 모드 전용)
   · 경로: {base}/viewer-meta/textDefaults — viewer-meta 레벨 partial update(.update)로
     textDefaults 키만 교체(다른 viewer-meta 필드 보존). root set 아님.
   · patch: { textTheme?, textStyle?:{fontFamily?,fontSize?,color?} } — 지정 키만 in-memory merge 후 write.
   · 옛 작품: 사용자가 처음 저장하기 전까지 textDefaults 미존재 → 기존 장면 자동 변환·write 없음.
   · 장면 값 일괄 변경/삭제 안 함(기존 scene 존중). 새 장면·되돌린 장면만 이 기본값을 따름(resolution).
   ================================================================ */
async function saveProjectTextDefaults(patch) {
  if (!_isTextProject()) return;                 /* 텍스트 모드 전용 — 그림책/무비 무영향 */
  if (!patch || typeof patch !== 'object') return;
  const db          = getViewerDb();
  const teamName    = ViewerState.project.teamName;
  const classId     = ViewerState.project.classId;
  const encodedName = encodeURIComponent(teamName);
  const basePath    = classId
    ? `classes/${classId}/teams/${encodedName}`
    : `teams/${encodedName}`;

  const cur    = (ViewerState.project.textDefaults && typeof ViewerState.project.textDefaults === 'object')
    ? ViewerState.project.textDefaults : {};
  const merged = { ...cur };
  if (Object.prototype.hasOwnProperty.call(patch, 'textTheme')) {
    merged.textTheme = patch.textTheme;          /* 정본 검증은 getProjectTextDefaults가 read 시 처리 */
  }
  if (patch.textStyle && typeof patch.textStyle === 'object') {
    merged.textStyle = { ...(cur.textStyle || {}), ...patch.textStyle };
  }
  ViewerState.project.textDefaults = merged;     /* 낙관적 in-memory 갱신 → 재렌더 즉시 반영 */
  await db.ref(`${basePath}/viewer-meta`).update({ textDefaults: merged });
}

/* ================================================================
   saveViewerMeta — viewer edit 결과 저장 (presentation 데이터만)
   구조 변경 없이 표현 정보만 별도 노드에 저장
   ================================================================ */
async function saveViewerMeta() {
  const db          = getViewerDb();
  const teamName    = ViewerState.project.teamName;
  const classId     = ViewerState.project.classId;  // v2에서 설정됨, v1에서는 null
  const encodedName = encodeURIComponent(teamName);

  /* 경로: 읽기와 동일한 기준 사용
     v1: teams/$encodedName/viewer-meta
     v2: classes/$classId/teams/$encodedName/viewer-meta */
  const basePath = classId
    ? `classes/${classId}/teams/${encodedName}`
    : `teams/${encodedName}`;

  /* 각 장면의 choices presentation + layoutTemplate + textAnchor 추출 */
  const presentationData = {};
  Object.values(ViewerState.scenes).forEach(scene => {
    /* 장면 단위 templateOverride 저장 */
    if (scene.layoutTemplate) {
      presentationData[`scene_template_${scene.id}`] = scene.layoutTemplate;
    }
    /* 장면 단위 텍스트 배치 앵커 저장 (감성화 — 배치 프리셋 1차) */
    if (scene.textAnchor) {
      presentationData[`scene_anchor_${scene.id}`] = scene.textAnchor;
    }
    scene.choices.forEach(choice => {
      if (choice.presentation) {
        const key = `${scene.id}_${choice.id}`;
        presentationData[key] = choice.presentation;
      }
    });
  });

  /* W7 projectType 보존 핵심 fix:
     이전엔 viewer-meta 통째 set 시 projectType 안 박아 옛 값까지 사라짐.
     사용자 캡처 시나리오: ptype 화면에서 'movie' 저장 → 다듬기 저장 시 viewer-meta
     통째 덮어쓰기 → projectType 필드 사라짐 → viewer 진입 시 undefined → 그림책 fallback.
     이제: ViewerState.project.projectType이 valid 값이면 매 저장 시 함께 박음. */
  const VALID_PTYPES = ['text', 'picturebook', 'movie', 'experience'];
  const ptype = ViewerState.project.projectType;
  const ptypePatch = (typeof ptype === 'string' && VALID_PTYPES.includes(ptype))
    ? { projectType: ptype }
    : {};

  /* W7: set → update. set은 노드 통째 덮어쓰기라 명시 안 한 필드(projectType 등) 사라짐.
     update는 명시한 키만 갱신, 나머지 보존. */
  /* v138: 그림책형 본문 카드 스타일 / 색계열 — 작품 단위.
     장면 1에서 박은 값을 작품 전체 기준으로 고정. null이면 저장 안 함
     (옛 작품 보호 — 아직 사용자가 한 번도 박지 않은 상태). */
  const _toneStylePatch = ViewerState.project.textCardStyle
    ? { textCardStyle: ViewerState.project.textCardStyle }
    : {};
  const _toneColorPatch = ViewerState.project.textCardColor
    ? { textCardColor: ViewerState.project.textCardColor }
    : {};

  await db.ref(`${basePath}/viewer-meta`).update({
    mode:         ViewerState.project.mode,
    theme:        ViewerState.project.theme,
    template:     ViewerState.project.template,
    presentation: presentationData,
    isPublic:     ViewerState.project.isPublic,  // 공개 정책 유지
    savedAt:      Date.now(),
    ...ptypePatch,                               // ★ projectType 보존 (안전망 이중)
    ..._toneStylePatch,                          // v138: 본문 카드 스타일 (작품 단위)
    ..._toneColorPatch,                          // v138: 색계열 (작품 단위)
  });
}

/* ================================================================
   adaptScenes — maker scenes → viewer scenes
   ================================================================ */
function adaptScenes(rawScenes) {
  const adapted = {};

  Object.values(rawScenes).forEach(raw => {
    const id = String(raw.num);

    /* 시작 장면 감지 */
    const isStart    = raw.type === 'start';
    const isEnding   = raw.type === 'ending';
    const isCover    = raw.type === 'cover';   // v37: 표지 scene
    const isTrueEnd  = isEnding && !!raw.trueEnding;

    /* 선택지 변환: choiceA/B + nextA/B → choices[] */
    const choices = adaptChoices(raw);

    /* ── body 필드 하위호환 처리 (title/body 분리 1차) ──
       · raw.body 존재: 새 구조. title/body 그대로
       · raw.body 없음: 기존 구조. title을 body로 해석하되 title은 빈 문자열.
         이러면 감상 화면은 이전과 동일하게 "본문만 있는 장면"으로 렌더됨.
       · hasBody는 읽기 전용 힌트. viewer-edit이 분리 편집 시 body를 명시 씀. */
    const rawHasBody = Object.prototype.hasOwnProperty.call(raw, 'body') &&
                       raw.body !== null && raw.body !== undefined;
    const resolvedTitle = rawHasBody ? (raw.title || '') : '';
    const resolvedBody  = rawHasBody ? (raw.body || '')  : (raw.title || '');

    /* 텍스트 길이 분류 — 본문(body) 기준으로 */
    const textLength = classifyTextLength(resolvedBody);

    adapted[id] = {
      id,
      title:      resolvedTitle,                // 제목 (없으면 빈 문자열)
      body:       resolvedBody,                 // 본문 (fallback: 기존 title)
      _hasBody:   rawHasBody,                   // 원본에 body 필드가 있었는지
      type:       raw.type  || 'normal',    // 'cover' | 'start' | 'normal' | 'ending'
      isStart,
      isEnding,
      isCover,                                  // v37: 표지 scene 여부
      subtitle:   raw.subtitle || '',           // v37: 표지 한 줄 소개
      kicker:     raw.kicker   || '',           // v129: 표지 상단 문구 (작품 제목 위)
      coverTheme: raw.coverTheme || 'default',  // v37: 표지 테마
      titleVerticalPosition: typeof raw.titleVerticalPosition === 'number'
        ? raw.titleVerticalPosition : 50,       // v37: 제목 높낮이 (0~100)
      isTrueEnd,
      imageData:  raw.imageData || null,
      choices,
      textLength,                           // 'short' | 'medium' | 'long'

      /* 장면 단위 템플릿 override
         값이 있으면 project 기본 템플릿보다 우선 적용
         maker에는 없는 필드 → viewer-meta presentation에서 로드 */
      layoutTemplate: raw.layoutTemplate || null,

      /* 장면 표현 모드 (모드 시스템 뼈대 1차) ──
         'text' | 'picturebook' | 'movie' | 'document' | null
         null/undefined는 하위호환 — viewer/maker에서 기본값(picturebook)으로 해석 */
      presentationMode: (
        raw.presentationMode === 'text' ||
        raw.presentationMode === 'picturebook' ||
        raw.presentationMode === 'movie' ||
        raw.presentationMode === 'document'
      ) ? raw.presentationMode : null,

      /* 모드별 서브모드 (그림책형 1차 + 기록물형 1차) ──
         모드별 허용값:
           · picturebook: 'spread' | 'stage'
           · document:    'letter' | 'clue'
           · 그 외 모드:  서브모드 없음
         여기서는 adapter 단계라 유효값만 받아두고, mode별 매칭은
         resolvePresentationSubmode에서 수행. */
      presentationSubmode: (
        raw.presentationSubmode === 'spread' ||
        raw.presentationSubmode === 'stage'  ||
        raw.presentationSubmode === 'letter' ||
        raw.presentationSubmode === 'clue'
      ) ? raw.presentationSubmode : null,

      /* 무비형 scene 데이터 (무비형 설계 1차) ──
         · videoUrl: 이번 단계는 항상 null (Firebase Storage 연동 미구현)
         · posterImage: 포스터 이미지 data URL (없으면 imageData로 fallback)
         · captionMode: 'overlay'(영상 위 자막) | 'caption-bar'(영상 아래 자막바)
         · choiceReveal: 'end'(영상 종료 후 노출) | 'always'(항상 표시)
         movie 모드 아닐 땐 의미 없음 — 렌더 영향 없음. */
      movieData: _normalizeMovieData(raw.movieData),

      /* ── 무비형 본문 사용 ON/OFF (3단계 신규) ──
         scene 단위 명시 필드. true/false만 인정. undefined/null이면 viewer-edit
         쪽에서 body 존재 여부로 fallback (sceneRenderer 카드 표시와 동일 정책). */
      bodyEnabled: (raw.bodyEnabled === true) ? true
                 : (raw.bodyEnabled === false) ? false
                 : null,

      /* ── 그림책형 하위 모드 (3단계 신규) ──
         '분할형'(split) | '그림 중심형'(imageCenter). 기본은 분할형. */
      picturebookSubmode: (raw.picturebookSubmode === 'imageCenter') ? 'imageCenter'
                        : (raw.picturebookSubmode === 'split') ? 'split'
                        : null,

      /* ── PB-MOOD-2: 일반 장면 이야기 단계 (imageCenter 장면 표시용) ──
         'rising'(승) | 'turning'(전). 없으면 null(기본 — 무대 정본 그대로). */
      pbStoryStage: (raw.pbStoryStage === 'rising' || raw.pbStoryStage === 'turning')
                        ? raw.pbStoryStage : null,

      /* ── 그림책형 본문 글상자 (W4-A 신규) ──
         그림 중심형(imageCenter)에서 본문이 그림 위에 떠있는 글상자.
         사용자가 위치 / 폭 / 배경막 강도를 조절. 높이는 본문에 따라 auto.
         값 범위 — 모두 안전하게 clamp:
         · x  : 0~80 (% — 글상자 좌측 위치)
         · y  : 0~80 (% — 글상자 상단 위치)
         · width : 20~95 (% — 글상자 폭)
         · backdropOpacity : 0~1 (배경막 강도. 0=투명, 1=완전 불투명)
         null이면 viewer-render에서 mockup 기본값 사용 (x:15 y:25 w:55 op:0.85). */
      picturebookBodyBox: _normalizePbBodyBox(raw.picturebookBodyBox),

      /* ── 그림책형 본문 카드 톤 (v138 신규) ──
         일반 분할형 장면의 본문 카드 톤. 5종:
         · default  — 기본 (안정)
         · bright   — 밝게
         · develop  — 은은하게
         · tense    — 차분하게
         · crisis   — 진하게 (가장 무게감 큼)
         값이 명시되지 않은 옛 장면은 null — viewer-render에서 톤 클래스 박지 X
         (옛 작품 시각 변화 없음). 사용자가 다듬기에서 한 번이라도 박으면 값 저장. */
      pbCardTone: (
        raw.pbCardTone === 'default' ||
        raw.pbCardTone === 'bright'  ||
        raw.pbCardTone === 'develop' ||
        raw.pbCardTone === 'tense'   ||
        raw.pbCardTone === 'crisis'
      ) ? raw.pbCardTone : null,

      /* ── 그림책형 엔딩 마감톤 (v138 신규) ──
         엔딩 장면 전용. 3종:
         · default   — 기본 마감 (담백한 종결)
         · bright    — 밝은 마감 (진엔딩·골드 glow)
         · afterglow — 여운 마감 (조용·아쉬움)
         null이면 톤 클래스 박지 X — 옛 엔딩 그대로. */
      pbEndingTone: (
        raw.pbEndingTone === 'default' ||
        raw.pbEndingTone === 'bright'  ||
        raw.pbEndingTone === 'afterglow'
      ) ? raw.pbEndingTone : null,

      /* PB-MOOD-1A: 그림책 imageCenter 엔딩 분위기(감정). pbEndingTone(색마감톤)과 의미 축이
         다른 독립 필드 — happy|sad만 인정, 그 외/없음=null → data-ending-mood 미부착 = 현행 정본 엔딩 그대로(회귀 0). */
      pbEndingMood: (
        raw.pbEndingMood === 'happy' ||
        raw.pbEndingMood === 'sad'
      ) ? raw.pbEndingMood : null,

      connectObjects:     _normalizeConnectObjects(raw.connectObjects) || [],
      textStyle:          _normalizeTextStyle(raw.textStyle),
      /* REFINE-IA-2: 텍스트 모드 "작품 기본값 + 장면별 예외" resolution 전용.
         DB의 sparse override 키만 보존(normalize가 textStyle을 full로 채우기 전 원본 기준).
         scene.textStyle(full)은 picturebook 글자편집 등 레거시 reader 위해 그대로 둠 → 그림책/옛작품 무영향. */
      textStyleRaw:       _sparseTextStyleOverride(raw.textStyle),
      /* REFINE-IA-2.1: "일부러 다르게 한" 표시 — 신규 코드만 기록. 기존 작품엔 없음(=레거시 → 작품 기본값 따름). */
      textStyleOverride:  (raw.textStyleOverride && typeof raw.textStyleOverride === 'object') ? raw.textStyleOverride : null,
      textThemeOverride:  raw.textThemeOverride === true,
      textTheme:          _normalizeTextTheme(raw.textTheme),
      textEffect:         _normalizeTextEffect(raw.textEffect),

      /* 위치 (maker 캔버스 좌표 — viewer에서는 표시용으로만) */
      x: raw.x || 0,
      y: raw.y || 0,

      /* narration audio — v1에서는 null (향후 확장) */
      narrationAudio: raw.narrationAudio || null,

      /* displayType 추론 */
      displayType: inferDisplayType(raw),
    };
  });

  return adapted;
}

/* ================================================================
   adaptChoices — N개 버튼 지원 (v0.3 명세)
   ─────────────────────────────────────────────────────────────
   내부 표준 데이터: scene.choices[] (배열)
   각 choice = { id, label, nextId, presentation }

   해석 우선순위:
   1. raw.buttons[]가 있으면 그걸 우선 (새 구조)
        · 배열의 각 원소 = { id?, label, nextId? }
        · id가 없으면 자동 생성 (A, B, C, D ...)
   2. raw.buttons[]가 없으면 raw.choiceA/choiceB + nextA/nextB로 fallback (기존 구조)
        · 기존 작품 호환

   엔딩 장면(raw.type === 'ending')은 항상 빈 배열.
   ================================================================ */

/* id 자동 생성: 0='A', 1='B', ..., 25='Z', 26='AA', 27='AB', ... */
function _autoChoiceId(index) {
  let n = index;
  let id = '';
  do {
    id = String.fromCharCode(65 + (n % 26)) + id;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return id;
}

function adaptChoices(raw) {
  if (raw.type === 'ending') return [];   // 엔딩은 선택지 없음

  /* 새 구조: raw.buttons[] 우선 해석 */
  if (Array.isArray(raw.buttons) && raw.buttons.length > 0) {
    /* maker 호환 일관성 체크 (옵션 2):
       maker의 updateChoiceLabel이 buttons는 안 건드리고 choiceA/B만 갱신했을 수 있음.
       이 경우 buttons[0/1].label과 choiceA/B가 어긋남 → maker 값이 더 최신일 수 있으니
       runtime에서 choiceA/B로 덮어씀 (메모리만, DB는 그대로).
       다음 viewer-edit 저장 시 buildButtonsPatchForSave가 양쪽을 다시 동기화함.

       W7 legacy 보정: buttons[]가 6개 초과인 옛 작품은 표시 시 6개로 자름.
       데이터는 보존, viewer에는 6개만. */
    const sliced = raw.buttons.slice(0, 6);
    return sliced
      .filter(b => b && typeof b === 'object')
      .map((b, i) => {
        const id = (typeof b.id === 'string' && b.id) ? b.id : _autoChoiceId(i);
        let label = typeof b.label === 'string' ? b.label : '';
        /* 0번째 = choiceA 호환, 1번째 = choiceB 호환.
           choiceA/B가 있고 buttons 라벨과 다르면 maker 쪽 값을 신뢰. */
        if (i === 0 && typeof raw.choiceA === 'string' && raw.choiceA !== label) {
          label = raw.choiceA;
        } else if (i === 1 && typeof raw.choiceB === 'string' && raw.choiceB !== label) {
          label = raw.choiceB;
        }
        return {
          id,
          label,
          nextId: b.nextId ? String(b.nextId) : null,
          presentation: defaultPresentation(id),
        };
      });
  }

  /* 기존 구조 fallback: choiceA/choiceB + nextA/nextB */
  const choices = [];
  const cnt = raw.choiceCount || 2;

  if (cnt === 1) {
    if (raw.nextA) {
      choices.push({
        id:    'A',
        label: raw.choiceA || '다음으로',
        nextId: String(raw.nextA),
        presentation: defaultPresentation('A'),
      });
    }
  } else {
    if (raw.nextA || raw.choiceA) {
      choices.push({
        id:    'A',
        label: raw.choiceA || '선택지 A',
        nextId: raw.nextA ? String(raw.nextA) : null,
        presentation: defaultPresentation('A'),
      });
    }
    if (raw.nextB || raw.choiceB) {
      choices.push({
        id:    'B',
        label: raw.choiceB || '선택지 B',
        nextId: raw.nextB ? String(raw.nextB) : null,
        presentation: defaultPresentation('B'),
      });
    }
  }

  return choices;
}

function defaultPresentation(choiceId) {
  return {
    placement:   'bottom',   // 'bottom' | 'overlay'
    x:           null,
    y:           null,
    w:           null,
    h:           null,
    opacity:     1,
    stylePreset: 'basic',    // 'basic' | 'ghost' | 'pin'
  };
}

function classifyTextLength(text) {
  const len = text.length;
  if (len <= 80)  return 'short';
  if (len <= 300) return 'medium';
  return 'long';
}

function inferDisplayType(raw) {
  /* title 또는 body 중 하나라도 글이 있으면 'mixed'로 판단
     (body 하위호환: 기존 작품은 title에 본문이 들어있었음) */
  const hasText = !!(raw.title || raw.body);
  if (raw.imageData && hasText) return 'mixed';
  if (raw.imageData)            return 'image-centered';
  return 'text-centered';
}

/* ================================================================
   applyPresentationData — 저장된 presentation 데이터를 scenes에 반영
   ================================================================ */
function applyPresentationData(presentationData) {
  if (!presentationData) return;
  Object.values(ViewerState.scenes).forEach(scene => {
    /* 장면 단위 layoutTemplate 복원 */
    const sceneKey = `scene_template_${scene.id}`;
    if (presentationData[sceneKey]) {
      scene.layoutTemplate = presentationData[sceneKey];
    }
    /* 장면 단위 textAnchor 복원 (감성화 — 배치 프리셋 1차) */
    const anchorKey = `scene_anchor_${scene.id}`;
    if (presentationData[anchorKey]) {
      scene.textAnchor = presentationData[anchorKey];
    }

    scene.choices.forEach(choice => {
      const key = `${scene.id}_${choice.id}`;
      if (presentationData[key]) {
        choice.presentation = { ...choice.presentation, ...presentationData[key] };
      }
    });
  });
}

/* ================================================================
   getStartScene — 시작 장면 반환 (하위 호환용, isStart 기준)
   ================================================================ */
function getStartScene() {
  return Object.values(ViewerState.scenes).find(s => s.isStart) || null;
}

/* ================================================================
   getEntryScene — 첫 감상 시작 장면
   우선순위: project.entrySceneId → isStart scene → 첫 번째 scene
   ================================================================ */
function getEntryScene() {
  const scenes = ViewerState.scenes;
  const eid    = ViewerState.project.entrySceneId;
  /* v111: entrySceneId가 cover scene을 가리키면 무시 — "시작하기 → 표지 → 시작하기" 무한 루프 차단.
     사용자가 명시 박은 잘못된 entry라도 cover는 entry가 될 수 없음. */
  if (eid && scenes[eid] && scenes[eid].type !== 'cover' && !scenes[eid].isCover) return scenes[eid];
  const start = getStartScene();
  if (start) return start;
  /* 마지막 fallback: cover 제외하고 첫 번째 scene (id 오름차순).
     모바일 텍스트형에서 표지 만들고 entrySceneId 명시 박지 않은 경우, cover scene이
     첫 번호일 가능성. 그것을 entry로 잡으면 무한 루프 → cover 제외 박음. */
  const first = Object.values(scenes)
    .filter(s => s && s.type !== 'cover' && !s.isCover)
    .sort((a, b) => Number(a.id) - Number(b.id))[0];
  return first || null;
}

/* ================================================================
   getReplayScene — '다른 결말 찾기' 시작 장면
   우선순위: project.replaySceneId → entryScene (소개 장면도 통과)
   ================================================================ */
function getReplayScene() {
  const scenes = ViewerState.scenes;
  const rid    = ViewerState.project.replaySceneId;
  if (rid && scenes[rid]) return scenes[rid];
  /* 설정 안 되어 있으면 entry와 동일 동작 */
  return getEntryScene();
}

/* ================================================================
   _migrateCoverAndEntryDefaults — 하위 호환 기본값 주입
   viewer-meta에 cover/entry/replay 필드가 없는 기존 작품용.
   기존 start scene을 기준으로 자동 매핑. in-memory만 세팅 (DB 쓰기 X).
   ================================================================ */
function _migrateCoverAndEntryDefaults() {
  const p      = ViewerState.project;
  const start  = getStartScene();

  if (!p.entrySceneId && start) {
    p.entrySceneId = start.id;
  }
  if (!p.replaySceneId) {
    /* entrySceneId가 이미 세팅됐으니 그것을 재사용 (null 방어) */
    p.replaySceneId = p.entrySceneId || (start ? start.id : null);
  }
  if (p.coverTitle === null && start) {
    /* title이 비어있으면 body(기존 title fallback) 첫 줄로 대체해 커버가 비지 않게 */
    if (start.title) {
      p.coverTitle = start.title;
    } else if (start.body) {
      /* 기존 작품: title이 비어있고 body에 '시작 장면' 같은 글이 매핑됨. 첫 줄만 사용. */
      const firstLine = String(start.body).split(/\n/)[0].trim();
      p.coverTitle = firstLine.slice(0, 40);
    } else {
      p.coverTitle = '';
    }
  }
  if (p.coverImageData === null && start) {
    p.coverImageData = start.imageData || null;
  }
}

/* ================================================================
   resolvePresentationMode — scene의 표현 모드 해석 (하위호환)
   ─────────────────────────────────────────────────────────────
   · 'text' | 'picturebook' | 'movie' | 'document' 유효값은 그대로
   · null/undefined/기타 값은 'picturebook' fallback
     (기존 작품 기본값 = 현재 viewer 동작과 가장 가까운 모드)
   · 읽기 전용 — DB에 쓰지 않음 (lazy fallback)
   ================================================================ */
function resolvePresentationMode(scene) {
  const m = scene && scene.presentationMode;
  if (m === 'text' || m === 'picturebook' || m === 'movie' || m === 'document') return m;
  return 'picturebook';
}

/* ================================================================
   resolvePresentationSubmode — 모드별 서브모드 해석
   ─────────────────────────────────────────────────────────────
   · picturebook: 'spread' | 'stage' (fallback: 'stage')
   · document:    'letter' | 'clue'  (fallback: 'letter')
   · 그 외 모드:  null — 렌더 무시
   · 모드와 서브모드가 매칭되지 않는 조합(예: document + 'spread')은
     fallback으로 해석. DB는 건드리지 않음 (lazy fallback).
   ================================================================ */
const SUBMODE_VALID_BY_MODE = {
  picturebook: { values: ['spread', 'stage'],  fallback: 'stage'  },
  document:    { values: ['letter', 'clue'],   fallback: 'letter' },
};

function resolvePresentationSubmode(scene) {
  const mode   = resolvePresentationMode(scene);
  const config = SUBMODE_VALID_BY_MODE[mode];
  if (!config) return null;   // text / movie — 서브모드 없음
  const sub = scene && scene.presentationSubmode;
  if (config.values.indexOf(sub) !== -1) return sub;
  return config.fallback;
}

const PRESENTATION_MODE_LABELS = {
  text:        '텍스트형',
  picturebook: '그림책형',
  movie:       '무비형',
  document:    '기록물형',
};
const PRESENTATION_MODE_ICONS = {
  text:        '📝',
  picturebook: '🎨',
  movie:       '🎬',
  document:    '📜',
};

/* ================================================================
   무비형 설계 1차 — movieData 정규화 + 접근 헬퍼
   ─────────────────────────────────────────────────────────────
   · raw.movieData는 객체 or undefined. 누락/이상값은 기본값으로 복구
   · 실제 Storage 연동은 다음 단계 — 이번 턴은 구조만 유효
   · 하위호환: movieData 없는 기존 scene도 렌더 영향 0 (movie 모드 아닐 때)
   ================================================================ */
const MOVIE_CAPTION_MODES   = ['overlay', 'caption-bar'];
const MOVIE_CHOICE_REVEALS  = ['end', 'always'];
const MOVIE_DEFAULT_CAPTION = 'overlay';
const MOVIE_DEFAULT_REVEAL  = 'end';

function _normalizeMovieData(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const captionMode  = MOVIE_CAPTION_MODES.indexOf(src.captionMode) !== -1
    ? src.captionMode : MOVIE_DEFAULT_CAPTION;
  const choiceReveal = MOVIE_CHOICE_REVEALS.indexOf(src.choiceReveal) !== -1
    ? src.choiceReveal : MOVIE_DEFAULT_REVEAL;
  return {
    /* 2026-05-31 Movie-2: 업로드된 영상 정보 보존.
       videoUrl/posterImage는 Firebase Storage URL (업로드 핸들러가 저장).
       videoStoragePath는 영상 삭제/교체 시 Storage 파일 정리에 필요 — load normalize에서
       드롭하면 reload 후 정리 불가(고아 파일)였음. 새 필드 추가 아님(이미 저장하는 기존 필드 보존). */
    videoUrl:         (typeof src.videoUrl === 'string')         ? src.videoUrl         : null,
    videoStoragePath: (typeof src.videoStoragePath === 'string') ? src.videoStoragePath : null,
    posterImage:      (typeof src.posterImage === 'string')      ? src.posterImage      : null,
    captionMode,
    choiceReveal,
  };
}

/* 읽기 전용 접근자 — viewer-render / viewer-edit에서 안전하게 사용 */
function getMovieData(scene) {
  if (!scene) return _normalizeMovieData(null);
  /* scene.movieData는 adaptScenes에서 이미 normalize된 상태 */
  return scene.movieData || _normalizeMovieData(null);
}

/* ── 그림책형 본문 글상자 (W4-A 신규) ────────────────────────────
   사용자가 그림 중심형에서 본문 글상자의 위치/폭/배경막 강도를 조절한 값.
   값 범위 안전 clamp + 기본값 (mockup 기준).
   null/undefined/잘못된 형식이면 PB_BODY_BOX_DEFAULTS 적용. */
const PB_BODY_BOX_DEFAULTS = {
  x: 15,                  /* % — 좌측 시작 */
  y: 25,                  /* % — 상단 시작 */
  width: 55,              /* % — 글상자 폭 */
  height: null,           /* % — null이면 콘텐츠 자동, 숫자면 명시 높이 (W4 추가) */
  backdropOpacity: 0.85,  /* 0~1 */
};

function _clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function _normalizePbBodyBox(raw) {
  if (!raw || typeof raw !== 'object') return null;   /* null이면 viewer-render가 기본값 사용 */
  const out = {
    x:               _clampNum(raw.x,               0,  80, PB_BODY_BOX_DEFAULTS.x),
    y:               _clampNum(raw.y,               0,  80, PB_BODY_BOX_DEFAULTS.y),
    width:           _clampNum(raw.width,           20, 95, PB_BODY_BOX_DEFAULTS.width),
    backdropOpacity: _clampNum(raw.backdropOpacity, 0,   1, PB_BODY_BOX_DEFAULTS.backdropOpacity),
  };
  /* height — 명시값(숫자)일 때만 보존. null/undefined면 콘텐츠 자동 (mockup 기본). */
  if (raw.height === null || raw.height === undefined) {
    out.height = null;
  } else {
    out.height = _clampNum(raw.height, 12, 90, PB_BODY_BOX_DEFAULTS.height || 30);
  }
  return out;
}

/* viewer-render / viewer-edit에서 사용 — 항상 숫자 4개 반환 (null fallback 처리). */
function getPicturebookBodyBox(scene) {
  const v = scene && scene.picturebookBodyBox;
  if (v && typeof v === 'object') return v;
  return { ...PB_BODY_BOX_DEFAULTS };
}

/* ================================================================
   W6: 체험전시형 정식 connectObjects 모델
   ─────────────────────────────────────────────────────────────
   scene.connectObjects = [{ id, type, x, y, w, h, label, nextId }, ...]
   · 좌표/크기 단위: % (배경 이미지 영역 기준)
   · 1차 타입 5종: button / arrow / flag / next / invisible
     (back/home은 상단 시스템 네비로 제공 — 1차 추가 타입에서 제외)
   · invisible: 시각 없이 클릭 영역만 (이미지 일부 클릭으로 분기)
   · 1차 범위: 표시 + 위치/크기 + label/nextId
   · 후순위: 회전/복제/레이어/스타일
   · legacy 호환: 이전 버전에서 만든 back/home 데이터는 그대로 표시
     (정규화 시 통과 허용. 다듬기 추가 버튼에서만 제외 — 신규 추가 못함)
   ================================================================ */
const VALID_CONNECT_OBJECT_TYPES = [
  'button', 'arrow', 'flag', 'next', 'invisible'
];
/* legacy 호환 — 데이터 정규화에선 통과 허용 (기존 작품 손상 방지). */
const _LEGACY_CONNECT_OBJECT_TYPES = ['back', 'home'];
const _ALL_CONNECT_OBJECT_TYPES_FOR_NORMALIZE = [
  ...VALID_CONNECT_OBJECT_TYPES, ..._LEGACY_CONNECT_OBJECT_TYPES,
];
/* 타입별 기본 크기 (%) — 추가 시 화면 가운데에 적당한 크기로 생성 */
const CONNECT_OBJECT_DEFAULT_SIZE = {
  button:    { w: 22, h: 9  },
  arrow:     { w: 10, h: 10 },
  flag:      { w: 8,  h: 14 },
  next:      { w: 16, h: 8  },
  /* legacy */
  back:      { w: 16, h: 8  },
  home:      { w: 16, h: 8  },
  invisible: { w: 25, h: 25 },
};
const CONNECT_OBJECT_LABEL_MAX = 20;   /* 체험전시형 라벨 max (W4-D 결정) */

function _normalizeConnectObject(raw) {
  if (!raw || typeof raw !== 'object') return null;
  /* legacy 호환 — back/home 데이터도 통과 (기존 작품 손상 방지). */
  const type = _ALL_CONNECT_OBJECT_TYPES_FOR_NORMALIZE.includes(raw.type) ? raw.type : 'button';
  const def = CONNECT_OBJECT_DEFAULT_SIZE[type] || { w: 20, h: 10 };
  /* id 없으면 자동 생성 (구버전 데이터 호환) */
  const id = (typeof raw.id === 'string' && raw.id)
    ? raw.id
    : ('co_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6));
  /* label은 max 20자(체험전시형 정책)로 절단 */
  let label = (typeof raw.label === 'string') ? raw.label : '';
  if (label.length > CONNECT_OBJECT_LABEL_MAX) label = label.slice(0, CONNECT_OBJECT_LABEL_MAX);
  /* nextId — string 또는 null. 자기 자신도 허용 (사용자 의도 존중). */
  const nextId = (raw.nextId !== null && raw.nextId !== undefined && raw.nextId !== '')
    ? String(raw.nextId)
    : null;
  return {
    id,
    type,
    x:      _clampNum(raw.x, 0, 100, 40),
    y:      _clampNum(raw.y, 0, 100, 40),
    w:      _clampNum(raw.w, 2, 100, def.w),
    h:      _clampNum(raw.h, 2, 100, def.h),
    label,
    nextId,
  };
}

function _normalizeConnectObjects(arr) {
  if (!Array.isArray(arr)) return null;   /* null이면 빈 배열 취급 (DB 미저장 신호) */
  const out = [];
  for (const raw of arr) {
    const co = _normalizeConnectObject(raw);
    if (co) out.push(co);
  }
  return out;
}

/* ================================================================
   W5: 텍스트형 보강 — 텍스트 스타일/테마/효과 데이터 모델
   ─────────────────────────────────────────────────────────────
   scene.textStyle = { fontFamily, fontSize, color, weight }
   scene.textTheme = 'classic' | 'novel' | 'paperbook' | 'note' |
                     'magazine' | 'handwriting' | 'retro' | 'dark'
   scene.textEffect = { entrance: 'none'|'fade'|'slide', body: 'none'|'typewriter' }
   · 모든 필드 optional — 없으면 기본값 (CSS 변수)
   · viewer-render에서 적용, viewer-edit에서 편집
   · 1차 범위: 데이터 모델 + 다듬기 UI + 8종 테마 톤 차이
   · 후순위: 효과 본격 (애니메이션 정교화)
   ================================================================ */
/* T-THEME-1: 정본 텍스트 테마 6종. novel/magazine은 신규 선택 UI에서 제외.
   표시명: classic=담백한 글 / paperbook=고전 기록 / note=이야기 노트 /
          handwriting=편지와 일기 / retro=레트로 게임 / dark=밤의 미스터리 */
const VALID_TEXT_THEMES = [
  'classic', 'paperbook', 'note', 'handwriting', 'retro', 'dark',
];
/* 레거시 입력 별칭 — 로드·해석 단계에서만 매핑(DB write 없음). 기존 작품 호환. */
const LEGACY_TEXT_THEME_ALIASES = {
  novel:    'paperbook',  /* 문학 소설 → 고전 기록 */
  magazine: 'classic',    /* 대담한 잡지 → 담백한 글 */
};
/* 단일 정규화 — _normalizeTextTheme/getTextTheme가 공유(결과 불일치 방지).
   정본 6종이면 그대로, 레거시 별칭이면 매핑, 그 외(없음/garbage)는 null. */
function _canonicalTextTheme(raw) {
  if (typeof raw !== 'string') return null;
  if (VALID_TEXT_THEMES.includes(raw)) return raw;
  if (Object.prototype.hasOwnProperty.call(LEGACY_TEXT_THEME_ALIASES, raw)) {
    return LEGACY_TEXT_THEME_ALIASES[raw];
  }
  return null;
}
/* T-THEME-1 지원(피커 선택 가능) 글씨체 — 3조건 충족: TEXT_FONT_FAMILIES 매핑 + viewer/maker 로드 + 여기 등록.
   레거시 값(notosans 등)은 여기 없어도 _normalizeTextStyle이 보존(렌더는 CSS 폴백). */
const VALID_TEXT_FONTS = [
  'gothic',     /* Nanum Gothic — 기본 산세리프 (담백한 글 기본) */
  'batang',     /* Gowun Batang — 명조 */
  'pen',        /* Nanum Pen Script — 손글씨 (편지와 일기 기본) */
  'gaegu',      /* Gaegu — 동글동글 손글씨 (이야기 노트 기본) */
  'hanna',      /* Black Han Sans — 굵은 헤드라인 */
  'jua',        /* Jua — 친근한 산세리프 */
  'galmuri',    /* Galmuri — 픽셀/레트로 (레트로 게임 기본) */
  'cormorant',  /* Cormorant Garamond — 영문 명조 */
  'hahmlet',    /* Hahmlet — 세련 명조 (고전 기록 기본) */
  'diphylleia', /* Diphylleia — 우아 명조 (밤의 미스터리 기본) */
];
const TEXT_STYLE_DEFAULTS = {
  /* T-THEME-1 sentinel: null = "테마 기본 글씨체"(gothic 강제 안 함).
     렌더/에디터가 fontFamily null이면 --text-ff를 세팅하지 않아 CSS 테마별 기본폰트가 적용됨. */
  fontFamily: null,
  fontSize:   18,        /* px — viewer 기본. W5: 본문 위계 강화 (본문이 메인) */
  color:      '',        /* 빈 문자열이면 테마 기본 색 사용 */
  weight:     'normal',  /* normal | bold */
};
/* v77: 엔딩 scene 전용 default — 지금 CSS에 박힌 룰을 그대로 모델로 옮김.
   엔딩 인스펙터에서 사용자가 박으면 scene.textStyle 박히고 override.
   장면 1 "모든 장면 적용" 버튼은 엔딩 제외 정책 유지(v75) — 엔딩 독립. */
const ENDING_TEXT_STYLE_DEFAULTS = {
  fontFamily: 'jua',
  fontSize:   20,        /* CSS clamp 16~24의 중간 — 일반 화면에서 비슷 */
  /* D9-7C 근본수정: 색 미선택 엔딩은 빈 값 → 스킨 fallback이 결정(night=밝은 크림 등).
     기존 '#2b1f10'은 night 남색 글상자 위에서 검정으로 보였음. 이 값은 DB 저장 안 됨(렌더 전용 default)
     → 마이그레이션 불필요. 사용자가 엔딩 색을 명시 선택하면 scene.textStyle.color로 저장되어 그대로 우선.
     split/legacy/movie/explore 엔딩은 .ending-user-body fallback(#2b1f10 고정)으로 무변경. */
  color:      '',
  weight:     'bold',
};
const VALID_TEXT_EFFECTS = {
  entrance: ['none', 'fade', 'slide'],
  body:     ['none', 'typewriter'],
};
const TEXT_EFFECT_DEFAULTS = {
  entrance: 'none',
  body:     'none',
};

function _normalizeTextStyle(raw) {
  if (!raw || typeof raw !== 'object') return null;
  /* T-THEME-1 sentinel: fontFamily 없음/빈값/'auto' → null(테마 기본).
     명시적 문자열 값은 그대로 보존(과거 사용자 선택 존중 — 임의 삭제·gothic 강제 금지).
     allowlist 밖 레거시 값도 보존하되, 렌더는 CSS --font-* 변수 폴백 체인으로 안전 처리. */
  let fontFamily = null;
  if (typeof raw.fontFamily === 'string' && raw.fontFamily && raw.fontFamily !== 'auto') {
    fontFamily = raw.fontFamily;
  }
  const fontSize   = _clampNum(raw.fontSize, 10, 36, TEXT_STYLE_DEFAULTS.fontSize);
  const color      = (typeof raw.color === 'string') ? raw.color : TEXT_STYLE_DEFAULTS.color;
  const weight     = (raw.weight === 'bold') ? 'bold' : 'normal';
  return { fontFamily, fontSize, color, weight };
}

/* REFINE-IA-2: sparse 장면 예외(override) 추출 — "의미있게 지정된 키"만 남김.
   defer sentinel(다음 레이어로 위임): fontFamily null/''/'auto'/부재, color ''/부재, 숫자 아닌 fontSize.
   → 이 키들은 결과에서 생략 → resolver가 작품 기본값/시스템 기본으로 위임.
   구체 폰트ID·유효 숫자 크기·비빈 색·명시 weight만 override로 채택. 없으면 null.
   ⚠️ scene.textStyle(full) 과 별개. 이 함수 결과는 텍스트 모드 resolution 전용. */
function _sparseTextStyleOverride(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  if (typeof raw.fontFamily === 'string' && raw.fontFamily && raw.fontFamily !== 'auto') {
    out.fontFamily = raw.fontFamily;
  }
  if (typeof raw.fontSize === 'number' && isFinite(raw.fontSize)) {
    out.fontSize = _clampNum(raw.fontSize, 10, 36, TEXT_STYLE_DEFAULTS.fontSize);
  }
  if (typeof raw.color === 'string' && raw.color) {
    out.color = raw.color;
  }
  if (raw.weight === 'bold' || raw.weight === 'normal') {
    out.weight = raw.weight;
  }
  return Object.keys(out).length ? out : null;
}

/* REFINE-IA-2: 작품 전체 텍스트 기본값 — viewer-meta.textDefaults 정규화 sparse 반환.
   미설정(옛 작품 포함)이면 null → resolver가 project 레이어 생략 → 현행 동작과 100% 동일.
   weight 는 작품 기본값 범위 밖(장면별 유지) → textStyle 에서 theme/font/size/color 만 다룸. */
function getProjectTextDefaults() {
  const d = (typeof ViewerState !== 'undefined' && ViewerState.project && ViewerState.project.textDefaults) || null;
  if (!d || typeof d !== 'object') return null;
  const theme = _canonicalTextTheme(d.textTheme);   /* 무효/부재 → null */
  const rawS  = (d.textStyle && typeof d.textStyle === 'object') ? d.textStyle : {};
  const style = {};
  if (typeof rawS.fontFamily === 'string' && rawS.fontFamily && rawS.fontFamily !== 'auto') {
    style.fontFamily = rawS.fontFamily;
  }
  if (typeof rawS.fontSize === 'number' && isFinite(rawS.fontSize)) {
    style.fontSize = _clampNum(rawS.fontSize, 10, 36, TEXT_STYLE_DEFAULTS.fontSize);
  }
  if (typeof rawS.color === 'string' && rawS.color) {
    style.color = rawS.color;
  }
  if (!theme && !Object.keys(style).length) return null;
  return { textTheme: theme, textStyle: style };
}

/* 텍스트 모드 여부 — project 레이어 게이트(그림책/무비 등은 현행 유지). */
function _isTextProject() {
  return !!(typeof ViewerState !== 'undefined' && ViewerState.project && ViewerState.project.projectType === 'text');
}

/* 장면의 sparse override(live) — 편집 중 갱신되는 scene.textStyleRaw 우선,
   없으면 현재 scene.textStyle 에서 파생(in-session 생성 장면 등). */
function _sceneTextStyleOverride(scene) {
  if (scene && scene.textStyleRaw && typeof scene.textStyleRaw === 'object') return scene.textStyleRaw;
  return _sparseTextStyleOverride(scene && scene.textStyle);
}
/* REFINE-IA-2.1: 장면별 "일부러 다르게 한" 표시(marker). 신규 코드만 기록.
   marker 있는 필드 = 의도적 예외(작품 기본값보다 우선). marker 없는 값 = 레거시(작품 기본값 정해지면 따름).
   기존 작품엔 marker가 없으므로 작품 기본값 도입 후 자동으로 작품 기본값을 따른다(DB 변경 없이 resolution만). */
function _sceneTextStyleMarks(scene) {
  const m = scene && scene.textStyleOverride;
  return (m && typeof m === 'object') ? m : {};
}
function _sceneThemeMarked(scene) {
  return !!(scene && scene.textThemeOverride);
}

function _normalizeTextTheme(raw) {
  /* 정본 6종 또는 레거시 별칭 → 정본값. 그 외 null(렌더 단계 getTextTheme가 classic fallback). */
  return _canonicalTextTheme(raw);
}

function _normalizeTextEffect(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const entrance = VALID_TEXT_EFFECTS.entrance.includes(raw.entrance) ? raw.entrance : TEXT_EFFECT_DEFAULTS.entrance;
  const body     = VALID_TEXT_EFFECTS.body.includes(raw.body)         ? raw.body     : TEXT_EFFECT_DEFAULTS.body;
  return { entrance, body };
}

function getTextStyle(scene) {
  const isEnding = !!(scene && (scene.type === 'ending' || scene.isEnding));
  /* 비-텍스트(그림책/무비 등): 현행 그대로 — scene.textStyle full 객체 또는 시스템 default. */
  if (!_isTextProject()) {
    const v = scene && scene.textStyle;
    if (v && typeof v === 'object') return v;
    /* v77: 엔딩 default 분기 — textStyle 박혀있지 않은 엔딩은 별도 default (jua/20/...) */
    if (isEnding) return { ...ENDING_TEXT_STYLE_DEFAULTS };
    return { ...TEXT_STYLE_DEFAULTS };
  }
  /* REFINE-IA-2 텍스트 resolution: 항목별 독립 — scene override → 작품 기본값 → floor(엔딩=ENDING default).
     defer(폰트 null/크기 비숫자/색 빈값)는 다음 레이어로. 작품 기본값 없으면(getProjectTextDefaults=null)
     체인이 scene → floor 로 줄어 현행과 동일. weight 는 작품 기본 범위 밖 → scene override 또는 floor. */
  const floor = isEnding ? ENDING_TEXT_STYLE_DEFAULTS : TEXT_STYLE_DEFAULTS;
  const sc    = _sceneTextStyleOverride(scene) || {};
  const marks = _sceneTextStyleMarks(scene);
  const pj    = getProjectTextDefaults();
  const pjS   = (pj && pj.textStyle) ? pj.textStyle : {};
  const _isNull  = (x) => (x === null || x === undefined);
  const _isEmpty = (x) => (x === '' || x === null || x === undefined);
  /* 우선순위(REFINE-IA-2.1): ① 의도적 예외(marker 있는 scene 값) → ② 작품 기본값 →
     ③ 레거시 scene 값(marker 없음 — 작품 기본값이 그 필드를 안 정했을 때만 유지) → ④ floor.
     ⇒ 작품 기본값을 정하면 기존(레거시) 장면도 그 필드를 따름. "이 장면만"에서 새로 정한 항목은 marker로 보존. */
  const pick = (k, deferFn) => {
    const has = (sc[k] !== undefined && !deferFn(sc[k]));
    if (has && marks[k])        return sc[k];   // ① 의도적 예외
    if (pjS[k] !== undefined && !deferFn(pjS[k])) return pjS[k];  // ② 작품 기본값
    if (has)                    return sc[k];   // ③ 레거시 값 유지
    return floor[k];                            // ④
  };
  return {
    fontFamily: pick('fontFamily', _isNull),
    fontSize:   pick('fontSize',   _isNull),
    color:      pick('color',      _isEmpty),
    weight:     (marks.weight && sc.weight !== undefined) ? sc.weight
              : (sc.weight !== undefined ? sc.weight : floor.weight),
  };
}
function getTextTheme(scene) {
  const canon = _canonicalTextTheme(scene && scene.textTheme);
  /* ① 의도적 테마 예외(marker) → ② 작품 기본 테마 → ③ 레거시 scene 테마 → ④ classic. */
  if (canon && _sceneThemeMarked(scene)) return canon;
  if (_isTextProject()) {
    const pj = getProjectTextDefaults();
    if (pj && pj.textTheme) return pj.textTheme;
  }
  if (canon) return canon;
  return 'classic';
}
function getTextEffect(scene) {
  const v = scene && scene.textEffect;
  if (v && typeof v === 'object') return v;
  return { ...TEXT_EFFECT_DEFAULTS };
}

/* viewer-render / viewer-edit에서 사용 — 항상 배열 반환 (null/undef → []). */
function getConnectObjects(scene) {
  const v = scene && scene.connectObjects;
  if (Array.isArray(v)) return v;
  return [];
}

/* 새 connectObject 생성 — 다듬기 패널 "오브젝트 추가" 진입점에서 호출.
   기본 위치는 화면 가운데, 크기는 타입별 default. */
function createConnectObject(type) {
  const t = VALID_CONNECT_OBJECT_TYPES.includes(type) ? type : 'button';
  const def = CONNECT_OBJECT_DEFAULT_SIZE[t];
  return {
    id: 'co_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
    type: t,
    x: 50 - def.w / 2,   /* 가운데 정렬 */
    y: 50 - def.h / 2,
    w: def.w,
    h: def.h,
    label: '',
    nextId: null,
  };
}

/* 포스터 이미지 fallback 체인:
   movieData.posterImage → scene.imageData → null (placeholder UI) */
function resolveMoviePoster(scene) {
  const md = getMovieData(scene);
  if (md.posterImage) return md.posterImage;
  if (scene && scene.imageData) return scene.imageData;
  return null;
}

/* ================================================================
   choices ↔ buttons 변환 헬퍼 (v0.3 표준)
   ─────────────────────────────────────────────────────────────
   내부: scene.choices[] = [{ id, label, nextId, presentation }, ...]
   DB:   raw.buttons[]   = [{ id, label, nextId }, ...]   (presentation 제외)

   serializeChoicesForSave: 저장 직전 호출. presentation은 빼고 핵심만.
   buildButtonsPatchForSave: maker 호환을 위해 buttons + choiceA/B/count
     동시 patch 객체 생성. (옵션 2 — viewer-edit 양방향 동기화)
   validateButtonsForSave: 저장 가능 여부 + 경고 사유 반환.
   ================================================================ */

const BUTTON_LABEL_MAX        = 60;   // 절대 한계
const BUTTON_LABEL_RECOMMEND  = 30;   // 권장 한계 (경고만)

function serializeChoicesForSave(choices) {
  if (!Array.isArray(choices)) return [];
  return choices
    .filter(c => c && typeof c === 'object')
    .map((c, i) => {
      const id = (typeof c.id === 'string' && c.id) ? c.id : _autoChoiceId(i);
      const out = {
        id,
        label: typeof c.label === 'string' ? c.label : '',
      };
      /* nextId는 분기 연결값. null이면 키 자체 생략 (Firebase는 null을 키 삭제로 해석) */
      if (c.nextId) out.nextId = String(c.nextId);
      return out;
    });
}

/* ================================================================
   buildButtonsPatchForSave — maker 호환 patch 빌더 (옵션 2)
   ─────────────────────────────────────────────────────────────
   viewer-edit가 buttons를 저장할 때 maker가 읽는 필드도 함께 동기화.
   이렇게 하면:
   · maker는 평소처럼 choiceA/B/choiceCount만 읽어도 viewer-edit의
     첫 1~2개 버튼은 보임 (= 라벨 일치)
   · DB의 buttons[] 배열은 그대로 보존되어 viewer는 N개 다 보임
   · maker가 set/update로 통째로 다시 써도 buttons는 scenes[num]에
     이미 들어있으니 손실 없음 (firebase.js의 snapshot.val() 흐름 자동 보호)
   
   동기화 규칙 (v0.3):
   · choiceA      = buttons[0].label  (없으면 '')
   · choiceB      = buttons[1].label  (없으면 '')
   · choiceCount  = buttons.length === 1 ? 1 : 2
   · 3번째 이상 버튼은 buttons[]에 보존되지만 maker UI에는 안 보임
     (사용자가 viewer-edit에서 추가했고 maker에선 인식 안 하므로 문제 없음)
   
   nextA/nextB는 분기 연결값이라 viewer-edit이 손대지 않음 — maker가 관리.
   기존 nextA/nextB는 그대로 유지됨 (patch에 안 넣으면 update가 안 건드림).
   ================================================================ */
function buildButtonsPatchForSave(choices) {
  const buttons = serializeChoicesForSave(choices);
  const patch = {
    buttons,
    choiceA:     (buttons[0] && buttons[0].label) || '',
    choiceB:     (buttons[1] && buttons[1].label) || '',
    choiceCount: buttons.length === 1 ? 1 : 2,
    /* nextA/nextB도 buttons[0/1].nextId 기준으로 동기화 (W2-B-α).
       이게 없으면 viewer-edit에서 nextId 변경해도 maker canvas의 drawArrows가
       옛 nextA/nextB를 보고 잘못된 화살표 그림. 빈 문자열로 명시 동기화하여
       Firebase가 키를 삭제하도록 함 (null도 가능하나 빈 문자열이 일관). */
    nextA:       (buttons[0] && buttons[0].nextId) ? String(buttons[0].nextId) : '',
    nextB:       (buttons[1] && buttons[1].nextId) ? String(buttons[1].nextId) : '',
  };
  return patch;
}

/* 저장 가능성 검증 — 반환값:
   { ok: true }                          → 저장 가능
   { ok: false, reason: '...' }          → 저장 차단 (사용자에게 안내)
   { ok: true, warnings: ['...'] }       → 저장 가능하나 경고 있음 (UI에 표시)
*/
function validateButtonsForSave(choices) {
  const warnings = [];

  if (!Array.isArray(choices) || choices.length === 0) {
    return { ok: false, reason: '행동 버튼이 최소 1개 필요해요.' };
  }

  /* 라벨이 모두 빈 문자열이면 사실상 0개 */
  const nonEmpty = choices.filter(c =>
    c && typeof c.label === 'string' && c.label.trim().length > 0
  );
  if (nonEmpty.length === 0) {
    return { ok: false, reason: '버튼에 글자를 입력해 주세요.' };
  }

  /* 60자 초과 — 차단 */
  for (const c of choices) {
    const len = (c.label || '').length;
    if (len > BUTTON_LABEL_MAX) {
      return {
        ok: false,
        reason: `버튼 글자 수는 최대 ${BUTTON_LABEL_MAX}자입니다 (현재 ${len}자).`,
      };
    }
  }

  /* 30자 초과 — 경고만 */
  for (const c of choices) {
    const len = (c.label || '').length;
    if (len > BUTTON_LABEL_RECOMMEND) {
      warnings.push(`버튼 "${(c.label || '').slice(0, 12)}..."이 권장 길이(${BUTTON_LABEL_RECOMMEND}자)를 넘어요.`);
    }
  }

  return warnings.length > 0
    ? { ok: true, warnings }
    : { ok: true };
}

/* ════════════════════════════════════════════════════════════════
   IMAGE-S2-1 — imageS2 상태 정규화 + 표시 이미지 결정 (순수 함수)
   ──────────────────────────────────────────────────────────────
   확정 PRD 정합. 이 단계는 "데이터·판정만": 모델 호출·Storage·Functions·Rules·
   RTDB write 전부 없음. imageSelections는 교사·시스템(서버)만 write이며, 학생
   토글은 로컬 미리보기(previewMode 인자)일 뿐 RTDB·타 사용자에 영향 없음.
   ⚠️ 원본 절대 보호: scene.imageData / scene.imageUrl 은 읽기만 한다.
   ⚠️ stale s2 · url 없음 · 잘못된 데이터 · s2 없음 → 무조건 원본 fallback.
   ════════════════════════════════════════════════════════════════ */

/* imagePolicy 정규화 — sourceMode는 upload|draw만, 그 외 null. */
function normalizeImagePolicy(raw) {
  const r = (raw && typeof raw === 'object') ? raw : {};
  return {
    sourceMode: (r.sourceMode === 'upload' || r.sourceMode === 'draw') ? r.sourceMode : null,
    lockedAtSceneId: (typeof r.lockedAtSceneId === 'string' && r.lockedAtSceneId) ? r.lockedAtSceneId : null,
    lockedAt: Number.isFinite(r.lockedAt) ? r.lockedAt : null,
    lockedBy: (typeof r.lockedBy === 'string' && r.lockedBy) ? r.lockedBy : null,
  };
}

/* imageSelections[sceneId] 정규화 — 허용 안 된 selected 값(=s2 아님)은 전부 'original'.
   selectionSource는 teacher-batch|system-stale만(학생 'student-manual'·임의값 → null). */
function normalizeImageSelection(raw) {
  const r = (raw && typeof raw === 'object') ? raw : {};
  return {
    selected: (r.selected === 's2') ? 's2' : 'original',
    selectedBy: (typeof r.selectedBy === 'string' && r.selectedBy) ? r.selectedBy : null,
    selectedAt: Number.isFinite(r.selectedAt) ? r.selectedAt : null,
    selectionSource: (r.selectionSource === 'teacher-batch' || r.selectionSource === 'system-stale')
      ? r.selectionSource : null,
  };
}

/* aiVariants.image[sceneId].s2 정규화 — url 없거나 비정상이면 null(=사용 불가). */
function normalizeS2Variant(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const url = (typeof raw.url === 'string') ? raw.url.trim() : '';
  if (!url) return null;   /* url 없음 / storagePath만 있음 → 사용 불가 */
  const str = (v) => (typeof v === 'string' && v) ? v : null;
  return {
    url,
    storagePath: str(raw.storagePath),
    sourceMode: (raw.sourceMode === 'upload' || raw.sourceMode === 'draw') ? raw.sourceMode : null,
    basedOnImageHash: str(raw.basedOnImageHash),
    model: str(raw.model),
    modelVersion: str(raw.modelVersion),
    promptVersion: str(raw.promptVersion),
    targetFrame: (raw.targetFrame && typeof raw.targetFrame === 'object') ? raw.targetFrame : null,
    fitPolicy: str(raw.fitPolicy),
    finalizedAt: Number.isFinite(raw.finalizedAt) ? raw.finalizedAt : null,
    stale: raw.stale === true,
  };
}

/* sceneId로 안전하게 s2 후보 raw 노드 추출(키 불일치 → null → 원본 fallback 보장).
   imageVariants = { s1:{sid:..}, s2:{sid:..} } (viewer-ai _loadFirebaseImageVariants 형태). */
function pickS2VariantForScene(imageVariants, sceneId) {
  if (!imageVariants || typeof imageVariants !== 'object') return null;
  const s2map = imageVariants.s2;
  if (!s2map || typeof s2map !== 'object') return null;
  const sid = (sceneId == null) ? '' : String(sceneId);
  if (!sid || !Object.prototype.hasOwnProperty.call(s2map, sid)) return null;
  return s2map[sid] || null;
}

/* 원본 이미지 src — 기존 렌더 관례(imageData 우선 → imageUrl)와 동일하게 유지(회귀 0). */
function _originalSceneImageSrc(scene) {
  if (!scene || typeof scene !== 'object') return null;
  if (typeof scene.imageData === 'string' && scene.imageData) return scene.imageData;
  if (typeof scene.imageUrl === 'string' && scene.imageUrl) return scene.imageUrl;
  return null;
}

/* s2 사용 가능 = url 있고 stale 아님. */
function _isS2Usable(s2) {
  return !!(s2 && typeof s2.url === 'string' && s2.url && s2.stale !== true);
}

/* ★ 표시 이미지 결정(순수). scene · 작품선택 · s2변형 · (학생)previewMode 로 무엇을 보일지.
   반환: { kind:'original'|'s2', src, isAiTransformed, fallbackReason }.
   - 작품 감상(previewMode 없음): selected==='s2' + s2 url유효 + !stale 일 때만 s2.
   - 학생 개인 미리보기(previewMode==='s2'): s2 url유효 + !stale 이면 s2(작품 선택 상태와 무관·로컬만).
   - 그 외 전부 original. stale/누락/url없음/키불일치 → 반드시 original.
   - 원본도 없으면 src:null(placeholder는 호출부 기존 정책 유지) + fallbackReason:'no-original'. */
function resolveSceneImageSource(scene, imageSelection, s2Variant, previewMode) {
  const origSrc = _originalSceneImageSrc(scene);
  const sel = normalizeImageSelection(imageSelection);
  const s2 = normalizeS2Variant(s2Variant);
  const wantS2 = (previewMode === 's2') || (sel.selected === 's2');

  if (wantS2 && _isS2Usable(s2)) {
    return { kind: 's2', src: s2.url, isAiTransformed: true, fallbackReason: null };
  }

  /* 여기부터는 무조건 original fallback. 왜 fallback인지 사유 기록. */
  let reason = null;
  if (wantS2) {
    if (s2 && s2.stale === true) reason = 'stale';
    else if (s2Variant && typeof s2Variant === 'object' &&
             Object.keys(s2Variant).length > 0 && !s2) reason = 'invalid-url';
    else reason = 'missing-s2';
  }
  if (!origSrc) {
    return { kind: 'original', src: null, isAiTransformed: false, fallbackReason: 'no-original' };
  }
  return { kind: 'original', src: origSrc, isAiTransformed: false, fallbackReason: reason };
}

/* IMAGE-S2-RENDER-1: loadTeamData가 적재하는 발행 캐시 setter(team 1회). raw 노드 그대로 보관 —
   정규화/판정은 resolveSceneImageSource가 담당(이중 정규화 방지). */
function _setPublishedImageCaches(imageNode, selNode) {
  const s2 = {};
  const sel = {};
  if (imageNode && typeof imageNode === 'object') {
    Object.keys(imageNode).forEach(function (sid) {
      const node = imageNode[sid];
      if (node && node.s2 && typeof node.s2 === 'object') s2[String(sid)] = node.s2;
    });
  }
  if (selNode && typeof selNode === 'object') {
    Object.keys(selNode).forEach(function (sid) {
      if (selNode[sid] && typeof selNode[sid] === 'object') sel[String(sid)] = selNode[sid];
    });
  }
  _pubImageS2BySid  = s2;
  _pubImageSelBySid = sel;
}

/* ★ IMAGE-S2-RENDER-1: 렌더용 동기 helper — 호출부가 해석한 originalSrc(scene.imageData||imageUrl)를 받아,
   교사가 발행 선택(imageSelections.selected==='s2')한 장면이면 usable(url·!stale)한 s2 url로 표시.
   - selection 없음/original/누락/stale/url없음/키불일치 → originalSrc 그대로(기존 동작 100% 유지).
   - 원본 scene.imageData/imageUrl은 절대 변경하지 않음(표시용 src만 결정).
   - 캐시 미적재(loadTeamData 전·구작품) → originalSrc. viewer-ai 보기 토글과 독립(토글은 호출부에서 이 결과 위에 덧씌움). */
function getPublishedImageDisplaySrc(scene, originalSrc) {
  try {
    if (!scene || typeof resolveSceneImageSource !== 'function') return originalSrc;
    const sid = (scene.id != null) ? scene.id : scene.sceneId;
    if (sid == null) return originalSrc;
    const key = String(sid);
    const sel = _pubImageSelBySid ? _pubImageSelBySid[key] : null;
    if (!sel || sel.selected !== 's2') return originalSrc;   /* 선택 없음/original → 원본(기존 동작) */
    const s2 = _pubImageS2BySid ? _pubImageS2BySid[key] : null;
    const r = resolveSceneImageSource(scene, sel, s2, null);  /* previewMode 없음 = 작품 발행 기준 */
    return (r && r.kind === 's2' && typeof r.src === 'string' && r.src) ? r.src : originalSrc;
  } catch (e) { return originalSrc; }
}

/* IMAGE-S2-1 helper 전역 노출(브라우저) — edit viewer / 완성본 보기 / 일반 감상 공용 결정. */
if (typeof window !== 'undefined') {
  window.normalizeImagePolicy = normalizeImagePolicy;
  window.normalizeImageSelection = normalizeImageSelection;
  window.normalizeS2Variant = normalizeS2Variant;
  window.pickS2VariantForScene = pickS2VariantForScene;
  window.resolveSceneImageSource = resolveSceneImageSource;
  window.getPublishedImageDisplaySrc = getPublishedImageDisplaySrc;   /* IMAGE-S2-RENDER-1 */
}

/* 테스트 전용 export — 브라우저에선 module 미정의라 무시된다(membership-login.js와 동일 패턴).
   POLISH-AUTH-FIX 편집 세션 판정/앱 선택 로직 + IMAGE-S2-1 이미지 결정 로직을 Node 하니스에서 검증. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isEditViewerSession, isMakerAuthSession, getViewerApp,
    normalizeImagePolicy, normalizeImageSelection, normalizeS2Variant,
    pickS2VariantForScene, resolveSceneImageSource,
    _setPublishedImageCaches, getPublishedImageDisplaySrc,   /* IMAGE-S2-RENDER-1 */
  };
}
