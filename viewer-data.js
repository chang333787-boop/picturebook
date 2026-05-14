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

/* Firebase 초기화 — viewer 전용 앱 인스턴스 (maker와 충돌 방지) */
let _viewerDb = null;
function getViewerDb() {
  if (_viewerDb) return _viewerDb;
  try {
    const app = firebase.app('viewer');
    _viewerDb = app.database();
  } catch {
    const app = firebase.initializeApp(firebaseConfig, 'viewer');
    _viewerDb = app.database();
  }
  return _viewerDb;
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

/* ================================================================
   loadTeamData — 팀명으로 maker DB 읽기
   반환: Promise<void> (ViewerState에 직접 주입)
   classId: v2 경로에서 필요 (v1에서는 null)
   fromMaker: 교사/제작자 테스트 세션 여부 (isPublic 차단 제외용)
   ================================================================ */
async function loadTeamData(teamName, classId = null, fromMaker = false, ptypeHint = null) {
  const db          = getViewerDb();
  const encodedName = encodeURIComponent(teamName);

  /* 경로: v1 = teams/$name, v2 = classes/$classId/teams/$name */
  const basePath = (classId)
    ? `classes/${classId}/teams/${encodedName}`
    : `teams/${encodedName}`;

  /* W7 성능 보강: scenes + viewer-meta를 병렬 로드.
     · 이전엔 scenes 다 받은 뒤(수MB 가능) viewer-meta 받음 → 순차 1~3초 + 그림책 깜빡임.
     · 이제 둘 다 동시 시작. viewer-meta가 보통 더 빨리 와 projectType 즉시 결정.
     · 더 이상 RTDB round-trip 두 번 + 직렬 대기 없음. */
  const [snapshot, metaSnap] = await Promise.all([
    db.ref(`${basePath}/scenes`).once('value'),
    db.ref(`${basePath}/viewer-meta`).once('value'),
  ]);
  const rawScenes = snapshot.val();
  const meta      = metaSnap.val();

  if (!rawScenes) throw new Error(`"${teamName}" 작품을 찾을 수 없어요.`);

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
    if (typeof meta.pbTheme === 'string') {
      ViewerState.project.pbTheme = meta.pbTheme;
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
    'textTheme',          /* W5: 텍스트형 테마 (8종 중 1) */
    'textEffect',         /* W5: 텍스트형 효과 {entrance, body} */
    'imageData',          /* W7: 무비형 포스터 이미지 (그림책형/체험전시형도 사용 — 다듬기 패널 업로드 저장) */
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
  await db.ref(`${basePath}/viewer-meta`).update({
    mode:         ViewerState.project.mode,
    theme:        ViewerState.project.theme,
    template:     ViewerState.project.template,
    presentation: presentationData,
    isPublic:     ViewerState.project.isPublic,  // 공개 정책 유지
    savedAt:      Date.now(),
    ...ptypePatch,                               // ★ projectType 보존 (안전망 이중)
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
      type:       raw.type  || 'normal',    // 'start' | 'normal' | 'ending'
      isStart,
      isEnding,
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
      connectObjects:     _normalizeConnectObjects(raw.connectObjects) || [],
      textStyle:          _normalizeTextStyle(raw.textStyle),
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
  if (eid && scenes[eid]) return scenes[eid];
  const start = getStartScene();
  if (start) return start;
  /* 마지막 fallback: 첫 번째 scene (id 오름차순) */
  const first = Object.values(scenes).sort((a, b) => Number(a.id) - Number(b.id))[0];
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
    /* Firebase Storage 연동 전 — 항상 null. 다음 단계에서 URL 삽입. */
    videoUrl:     (typeof src.videoUrl === 'string')    ? src.videoUrl     : null,
    posterImage:  (typeof src.posterImage === 'string') ? src.posterImage  : null,
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
const VALID_TEXT_THEMES = [
  'classic', 'novel', 'paperbook', 'note',
  'magazine', 'handwriting', 'retro', 'dark',
];
const VALID_TEXT_FONTS = [
  'gothic',     /* Nanum Gothic — 기본 산세리프 */
  'batang',     /* Gowun Batang — 명조 */
  'pen',        /* Nanum Pen Script — 손글씨 */
  'gaegu',      /* Gaegu — 동글동글 손글씨 */
  'hanna',      /* Black Han Sans — 굵은 헤드라인 */
  'jua',        /* Jua — 친근한 산세리프 */
  'galmuri',    /* Galmuri — 픽셀/레트로 */
  'cormorant',  /* Cormorant Garamond — 영문 명조 */
];
const TEXT_STYLE_DEFAULTS = {
  fontFamily: 'gothic',
  fontSize:   18,        /* px — viewer 기본. W5: 본문 위계 강화 (본문이 메인) */
  color:      '',        /* 빈 문자열이면 테마 기본 색 사용 */
  weight:     'normal',  /* normal | bold */
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
  const fontFamily = VALID_TEXT_FONTS.includes(raw.fontFamily) ? raw.fontFamily : TEXT_STYLE_DEFAULTS.fontFamily;
  const fontSize   = _clampNum(raw.fontSize, 10, 36, TEXT_STYLE_DEFAULTS.fontSize);
  const color      = (typeof raw.color === 'string') ? raw.color : TEXT_STYLE_DEFAULTS.color;
  const weight     = (raw.weight === 'bold') ? 'bold' : 'normal';
  return { fontFamily, fontSize, color, weight };
}

function _normalizeTextTheme(raw) {
  if (typeof raw !== 'string') return null;
  return VALID_TEXT_THEMES.includes(raw) ? raw : null;
}

function _normalizeTextEffect(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const entrance = VALID_TEXT_EFFECTS.entrance.includes(raw.entrance) ? raw.entrance : TEXT_EFFECT_DEFAULTS.entrance;
  const body     = VALID_TEXT_EFFECTS.body.includes(raw.body)         ? raw.body     : TEXT_EFFECT_DEFAULTS.body;
  return { entrance, body };
}

function getTextStyle(scene) {
  const v = scene && scene.textStyle;
  if (v && typeof v === 'object') return v;
  return { ...TEXT_STYLE_DEFAULTS };
}
function getTextTheme(scene) {
  const v = scene && scene.textTheme;
  return (typeof v === 'string' && VALID_TEXT_THEMES.includes(v)) ? v : 'classic';
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
