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
async function loadTeamData(teamName, classId = null, fromMaker = false) {
  const db          = getViewerDb();
  const encodedName = encodeURIComponent(teamName);

  /* 경로: v1 = teams/$name, v2 = classes/$classId/teams/$name */
  const basePath = (classId)
    ? `classes/${classId}/teams/${encodedName}`
    : `teams/${encodedName}`;

  const snapshot  = await db.ref(`${basePath}/scenes`).once('value');
  const rawScenes = snapshot.val();

  if (!rawScenes) throw new Error(`"${teamName}" 작품을 찾을 수 없어요.`);

  ViewerState.project.teamName = teamName;
  ViewerState.project.classId  = classId;  // ★ v2에서 저장 경로에 재사용
  ViewerState.scenes           = adaptScenes(rawScenes);

  /* 프로젝트 메타 읽기 (선택적 — viewer-meta 노드가 있으면 사용) */
  const metaSnap = await db.ref(`${basePath}/viewer-meta`).once('value');
  const meta     = metaSnap.val();
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

  await db.ref(`${basePath}/viewer-meta`).set({
    mode:         ViewerState.project.mode,
    theme:        ViewerState.project.theme,
    template:     ViewerState.project.template,
    presentation: presentationData,
    isPublic:     ViewerState.project.isPublic,  // 공개 정책 유지
    savedAt:      Date.now(),
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
       다음 viewer-edit 저장 시 buildButtonsPatchForSave가 양쪽을 다시 동기화함. */
    return raw.buttons
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
