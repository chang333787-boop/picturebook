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
   loadTeamData — 팀명으로 maker DB 읽기
   반환: Promise<void> (ViewerState에 직접 주입)
   classId: v2 경로에서 필요 (v1에서는 null)
   ================================================================ */
async function loadTeamData(teamName, classId = null) {
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
  }
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

  /* 각 장면의 choices presentation + layoutTemplate 추출 */
  const presentationData = {};
  Object.values(ViewerState.scenes).forEach(scene => {
    /* 장면 단위 templateOverride 저장 */
    if (scene.layoutTemplate) {
      presentationData[`scene_template_${scene.id}`] = scene.layoutTemplate;
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

    /* 텍스트 길이 분류 */
    const textLength = classifyTextLength(raw.title || '');

    adapted[id] = {
      id,
      title:      raw.title || '',
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

function adaptChoices(raw) {
  const choices = [];
  const cnt     = raw.choiceCount || 2;

  if (raw.type === 'ending') return choices;   // 엔딩은 선택지 없음

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
  if (raw.imageData && raw.title) return 'mixed';
  if (raw.imageData)              return 'image-centered';
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

    scene.choices.forEach(choice => {
      const key = `${scene.id}_${choice.id}`;
      if (presentationData[key]) {
        choice.presentation = { ...choice.presentation, ...presentationData[key] };
      }
    });
  });
}

/* ================================================================
   getStartScene — 시작 장면 반환
   ================================================================ */
function getStartScene() {
  return Object.values(ViewerState.scenes).find(s => s.isStart) || null;
}
