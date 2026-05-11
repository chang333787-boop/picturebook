/* ================================================================
   sceneRenderer.js — 카드 렌더링 / 화살표 / 연결
   의존: state.js, locks.js (isLockedByOther),
         firebase.js (pushToFirebase), canvasInteraction.js (toCanvas, _startDrag 등)

   핵심 구조:
     renderCard(s)  = buildCardHTML → innerHTML → bindCardEvents → syncCardState
     ┌─────────────────────────────────────────────────────────┐
     │ buildCardHTML(s)   순수 HTML 반환, 인라인 핸들러 없음  │
     │ bindCardEvents(el,s) addEventListener만               │
     │ syncCardState(num)  잠금/비활성 상태 반영만 ← source of truth │
     └─────────────────────────────────────────────────────────┘

   잠금 UI 단일화:
     locks.js의 updateCardLockUI()는 syncCardState()의 위임 래퍼.
     DOM 잠금 표시 로직은 syncCardState만이 담당.
     firebase.js → updateCardLockUI → syncCardState 순으로 경유.
   ================================================================ */

/* ── 카드 추가 ── */
function addScene() {
  /* W7: 빈 slot 재사용 — 1번부터 차례로 비어있는 번호 찾기.
     이전엔 nextNum이 module-scoped로 한 방향 증가만 해 1,2,3,4 모두 삭제하면
     번호 5부터 시작하는 버그.
     이제: scenes에 없는 가장 작은 번호 자동 채택. 1번 비면 1번, 2번 비면 2번. */
  let num = 1;
  while (scenes[num]) num++;
  /* nextNum 변수도 동기화 (외부 다른 로직에서 참조하는 경우 정합성 유지) */
  nextNum = num + 1;

  const wrap = document.getElementById('canvas-wrap');
  const rect = wrap.getBoundingClientRect();
  const cx   = rect.width  / 2 + (Math.random() - 0.5) * 160;
  const cy   = rect.height / 2 + (Math.random() - 0.5) * 100;
  const cv   = toCanvas(rect.left + cx, rect.top + cy);

  /* 신규 장면 (W2-A 잔여 정리): buttons[] 단일 배열 구조로 시작.
     · buttons: 빈 배열 [] — 사용자가 input에 입력하면 첫 항목 채워짐
     · choiceA/B/choiceCount: legacy 호환 동기화 (옵션 2 정책 — 1단계)
     · body: 신규는 빈 채로 시작. _hasBody=true로 새 구조 명시
     · presentationMode: 'picturebook' 기본값 — 신규 장면 만들 때 viewer-edit에서
       legacy UI(이 장면 레이아웃 + 텍스트 위치 9칸)가 처음부터 안 보이게.
       사용자가 다른 모드(text/movie)로 바꾸면 변경됨. legacy 작품(presentationMode 없음)은
       그대로 — viewer-edit이 isV03Mode=false로 판정해 legacy UI 노출. */
  scenes[num] = {
    num, title: '', body: '', type: 'normal',
    x: Math.max(20, cv.x), y: Math.max(20, cv.y),
    buttons: [],
    /* legacy 호환 — viewer-data가 buttons 우선 읽지만 maker 다른 경로/import 호환 */
    choiceA: '', choiceB: '', choiceCount: 2,
    _hasBody: true,
    presentationMode: 'picturebook',
  };
  renderCard(scenes[num]);
  drawArrows();
  pushToFirebase();
}

/* ── 버튼 추가 (C-1: maker canvas에서 직접 추가) ──
   · 카드의 "+ 버튼 추가" 클릭 시 호출
   · buttons[] 길이가 6 미만일 때만 동작
   · legacy 작품 (buttons[] 없음)이면 choiceA/B를 buttons[0/1]로 옮긴 후 새 항목 추가
   · renderCard 후 pushToFirebase로 즉시 저장 */
function addButton(num) {
  const s = scenes[num];
  if (!s) return;

  /* buttons[] 초기화 — legacy choiceA/B 이관 (있으면) */
  if (!Array.isArray(s.buttons)) s.buttons = [];
  if (s.buttons.length === 0) {
    /* legacy fallback: choiceA/B + nextA/B를 buttons[0/1]로 이관 */
    if (s.choiceA || s.nextA) {
      s.buttons.push({
        id: 'A',
        label: s.choiceA || '',
        ...(s.nextA ? { nextId: String(s.nextA) } : {}),
      });
    }
    if (s.choiceB || s.nextB) {
      s.buttons.push({
        id: 'B',
        label: s.choiceB || '',
        ...(s.nextB ? { nextId: String(s.nextB) } : {}),
      });
    }
  }

  if (s.buttons.length >= 6) return;  /* 최대 6개 제한 */

  /* 빈 항목 추가 */
  const newIdx = s.buttons.length;
  s.buttons.push({
    id: String.fromCharCode(65 + newIdx),
    label: '',
  });

  /* choiceCount 호환 동기화 */
  s.choiceCount = s.buttons.length === 1 ? 1 : 2;

  renderCard(s);
  drawArrows();
  pushToFirebase();
}

/* ── 전체 렌더 ── */
function renderAll() {
  document.querySelectorAll('.scene-card').forEach(el => el.remove());
  Object.values(scenes).forEach(s => renderCard(s));
  drawArrows();
}

/* ================================================================
   buildCardHTML — 순수 HTML 문자열 반환
   ※ onclick/onchange/oninput/onfocus 인라인 핸들러 없음
      식별자는 data-* 속성으로 표현, 바인딩은 bindCardEvents에서
   ================================================================ */
function buildCardHTML(s) {
  /* 장면 타입 언어 정리 1차:
     · UI 노출 타입은 '일반 / 엔딩' 2종만
     · 기존 data의 type === 'start' 값은 라디오에서 '일반' 선택으로 보임
       (데이터는 그대로 유지 — 사용자가 라디오를 만질 때만 'normal'로 변경)
     · 라디오 자체는 _buildTypeRowHtml에서 생성 — 카드 본체는 유형별 분기 (2단계). */

  /* W6 1순위 1C-1D: 체험전시형은 buttons[] 개념을 사용하지 않고 connectObjects[]로
     포트/연결선이 통일된다. 다른 모드(text/picturebook/movie)는 기존 buttons[] 그대로 유지.
     · 체험전시형 포트: connectObjects 중 nextId가 의미 있는 타입만 (back/home 제외).
     · 색/dot/연결선 시스템은 그대로 (사용자 원칙: shell 유지). */
  const _projType = (typeof projectMeta !== 'undefined' && projectMeta && projectMeta.projectType)
    || (typeof DEFAULT_PROJECT_TYPE !== 'undefined' ? DEFAULT_PROJECT_TYPE : null);
  const _isExperience = _projType === 'experience';

  /* 일반 모드(text/picturebook/movie)는 기존 buttons[] 그대로 — ports 영역 노출.
     체험전시형은 portsHTML='' 이므로 buttonsList도 사용 안 됨 (단순 변수 보존). */
  const buttonsList = Array.isArray(s.buttons) ? s.buttons : [];
  const buttonsLen = buttonsList.length;
  /* 실제 표시 개수 — buttons[]가 비어있으면 legacy fallback으로 2개 표시 */
  const visualCount = buttonsLen > 0 ? Math.min(buttonsLen, 6) : 2;

  let portsHTML = '';

  /* W6: 체험전시형 카드는 ports 영역(input + dot) 자체를 안 보임.
     · 모든 연결은 다듬기 패널에서 next 드롭다운으로 설정 (행동버튼 개념 완전 제거)
     · 카드 본체는 연결 오브젝트 갯수 요약 + 라벨 + 안내문만
     · 캔버스 화살표는 connectObjects[].nextId 기반으로 그대로 그려짐 (drawArrows에서 처리)
     · 일반 모드의 6개 제한과 분리 — 체험전시형은 N개 가능. */
  if (_isExperience) {
    portsHTML = '';
  } else if (s.type !== 'ending') {
    /* 모든 N개 버튼을 input + 활성 dot으로 (W2-B-β).
       buttons[] 우선, 없으면 legacy fallback으로 첫 2개 표시. */
    let editableRows = '';

    if (buttonsLen > 0) {
      /* 새 구조: buttons[] 길이만큼 input + dot 표시 (최대 6개) */
      const drawCount = Math.min(buttonsLen, 6);
      for (let i = 0; i < drawCount; i++) {
        const b = buttonsList[i] || {};
        const portChar = String.fromCharCode(65 + i);
        const lbl = (typeof b.label === 'string') ? b.label : '';
        editableRows += _portRowHtml(s.num, portChar, i, lbl);
      }
    } else {
      /* legacy fallback: choiceA/B 두 줄 (사용자가 입력하면 buttons[] 생성됨) */
      editableRows  = _portRowHtml(s.num, 'A', 0, s.choiceA || '');
      editableRows += _portRowHtml(s.num, 'B', 1, s.choiceB || '');
    }

    /* + 버튼 추가 진입점 (C-1) — visualCount < 6일 때만 표시.
       클릭 시 sceneRenderer.addButton(num) 호출 — buttons[]에 빈 항목 추가 + 재렌더 */
    const addButtonHTML = (visualCount < 6)
      ? `<button type="button" class="card-add-button js-add-button" data-num="${s.num}"
           title="버튼 추가 (최대 6개)">+ 버튼 추가</button>`
      : '';

    portsHTML = `
      <div class="card-ports">
        ${editableRows}
        ${addButtonHTML}
      </div>`;
  } else {
    const isTrueEnding = s.trueEnding || false;
    portsHTML = `
      <div style="padding:4px 8px 10px;">
        <div style="text-align:center;font-size:12px;color:var(--ending);margin-bottom:8px;">🏁 이야기 끝</div>
        <label style="display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;
          background:${isTrueEnding?'#fff8e8':'#f8f8f8'};
          border:1.5px solid ${isTrueEnding?'#f0c000':'#e0e0e0'};
          border-radius:50px;padding:5px 12px;">
          <input class="js-true-ending" type="checkbox" ${isTrueEnding?'checked':''}
            data-num="${s.num}" style="display:none;"/>
          <span style="font-size:14px;">${isTrueEnding?'⭐':'☆'}</span>
          <span style="font-family:var(--font-h);font-size:12px;
            color:${isTrueEnding?'#b08000':'#aaa'};">
            ${isTrueEnding?'진엔딩':'진엔딩으로 설정'}
          </span>
        </label>
      </div>`;
  }

  const starBadge = (s.type === 'ending' && s.trueEnding)
    ? `<span style="font-size:13px;margin-left:2px;" title="진엔딩">⭐</span>` : '';

  /* ── 역할 배지: projectMeta.entrySceneId/replaySceneId와 비교 ──
     '시작'을 장면 종류가 아니라 역할로 표시 (UI 언어 정리 1차) */
  const pm          = (typeof projectMeta === 'object' && projectMeta) ? projectMeta : {};
  const isEntry     = pm.entrySceneId  !== null && pm.entrySceneId  !== undefined
                    && String(pm.entrySceneId)  === String(s.num);
  const isReplay    = pm.replaySceneId !== null && pm.replaySceneId !== undefined
                    && String(pm.replaySceneId) === String(s.num);
  /* W7 시작점/다시시작점 배지: 포스터/본문사용과 같은 .card-meta-badge 클래스 그대로 사용.
     사용자: "저밑에 포스터 본문사용처럼 넣어주지않으렴". 톤 자동 통일. */
  const roleBadges = [
    isEntry  ? '<span class="card-meta-badge card-meta-badge--entry" title="첫 감상자가 시작하는 장면">🚪 시작점</span>' : '',
    isReplay ? '<span class="card-meta-badge card-meta-badge--replay" title="다른 결말 찾기에서 시작하는 장면">🔄 다시 시작</span>' : '',
  ].join('');

  /* ─── 작품 유형별 카드 얼굴 (2단계) ───────────────────────────
     원칙:
     · shell(header/ports/포트 dot 위치)은 공통 유지
     · 가운데 content(이미지 + body) 영역만 유형별 분기
     · 4개 content 함수로 위계와 요약 정보만 다름
     · 체험전시형도 ports 영역은 유지 (dot/연결 인터랙션 보존) — 카드 본체에
       "연결 X개" 요약을 위에 추가하는 방식으로 위계 표현. */
  const _ptype = _resolveProjectType();
  const contentHtml = _buildCardContentByType(s, _ptype);

  /* W7: roleBadges를 본체 위 별도 줄로 — 포스터/본문사용과 같은 .card-meta-row */
  const roleBadgeRow = roleBadges
    ? `<div class="card-meta-row card-meta-row--role">${roleBadges}</div>`
    : '';

  return `
    <div class="card-header">
      <span class="card-num-badge js-rename-btn" data-num="${s.num}"
        title="번호 바꾸기">장면 ${s.num}${starBadge}</span>
      <button class="card-edit-jump js-edit-jump" data-num="${s.num}"
        title="이 장면 다듬기">✎</button>
      <button class="card-delete js-delete-btn" data-num="${s.num}">✕</button>
    </div>
    ${roleBadgeRow}
    ${contentHtml}
    ${portsHTML}`;
}

/* ─── 작품 유형 해석 (2단계) ─────────────────────────────────
   projectMeta.projectType을 안전하게 읽고, 잘못된 값/없으면 fallback. */
function _resolveProjectType() {
  const pm = (typeof projectMeta === 'object' && projectMeta) ? projectMeta : {};
  const valid = ['text', 'picturebook', 'movie', 'experience'];
  if (typeof pm.projectType === 'string' && valid.includes(pm.projectType)) {
    return pm.projectType;
  }
  return 'picturebook';   // DEFAULT_PROJECT_TYPE 일관
}

/* ─── 카드 content 분기 진입 함수 (2단계) ─────────────────────── */
function _buildCardContentByType(s, ptype) {
  switch (ptype) {
    case 'text':       return _buildTextCardContent(s);
    case 'movie':      return _buildMovieCardContent(s);
    case 'experience': return _buildExperienceCardContent(s);
    case 'picturebook':
    default:           return _buildPicturebookCardContent(s);
  }
}

/* ─── 카드 공통 부품: 이미지 영역 / 라디오+모드배지 ───────────── */
function _buildImageAreaHtml(s) {
  return s.imageData
    ? `<div class="card-image-area">
        <img src="${s.imageData}" class="card-thumb js-img-thumb"
          data-num="${s.num}" title="클릭하면 크게 보기"/>
        <div style="display:flex;gap:4px;margin-top:4px;">
          <label style="flex:1;padding:3px 0;border:1.5px solid #d0e0f5;border-radius:6px;
            background:#f4f8ff;color:var(--muted);font-size:10px;cursor:pointer;
            text-align:center;font-family:var(--font-b);">
            🔄 바꾸기
            <input class="js-img-upload" type="file" accept="image/*"
              data-num="${s.num}" style="display:none"/>
          </label>
          <button class="js-img-remove" data-num="${s.num}"
            style="flex:1;padding:3px 0;border:1.5px solid #ffc0c0;border-radius:6px;
            background:#fff0f0;color:#c00;font-size:10px;cursor:pointer;font-family:var(--font-b);">
            🗑 삭제
          </button>
        </div>
      </div>`
    : `<div class="card-image-area">
        <label class="card-img-btn">
          🖼 이미지 넣기
          <input class="js-img-upload" type="file" accept="image/*"
            data-num="${s.num}" style="display:none"/>
        </label>
      </div>`;
}

function _buildTypeRowHtml(s) {
  const types  = ['normal', 'ending'];
  const labels = ['일반', '엔딩'];
  const currentType = (s.type === 'ending') ? 'ending' : 'normal';
  const radios = types.map((t, i) =>
    `<input class="type-radio js-type-radio" type="radio"
       name="type-${s.num}" id="tr-${s.num}-${t}"
       value="${t}" ${currentType === t ? 'checked' : ''} data-num="${s.num}" data-value="${t}">
     <label class="type-label" for="tr-${s.num}-${t}">${labels[i]}</label>`
  ).join('');
  /* W7: 카드별 모드 배지(_modeBadgeHtml) 제거.
     작품 단위 projectType lock 도입 후 개별 scene presentationMode는 의미 없음.
     사용자: "옆에 그림책이라고 써있는게 불편함 불안함" → 제거. */
  return `<div class="card-type-row">${radios}</div>`;
}

/* ─── 1) 텍스트형 카드 ────────────────────────────────────────
   위계: 본문 > 제목 > 선택지
   특징: 이미지 슬롯 노출 안 함, 본문이 가장 큼, 제목은 보조 */
function _buildTextCardContent(s) {
  return `
    <div class="card-body card-body--text">
      <textarea class="card-body-textarea card-body-textarea--featured js-body-input"
        placeholder="장면 본문 — 이 장면의 글"
        rows="4"
        data-num="${s.num}">${_escapeHtml(s.body || '')}</textarea>
      <input class="card-title-input card-title-input--secondary js-title-input"
        placeholder="장면 라벨 (선택)"
        type="text"
        value="${_escapeHtml(s.title || '')}"
        data-num="${s.num}"/>
      ${_buildTypeRowHtml(s)}
    </div>`;
}

/* ─── 2) 그림책형 카드 ────────────────────────────────────────
   위계: 그림 썸네일 > 본문 미리보기 > 제목 > 선택지
   특징: 그림 썸네일 가장 위, 본문은 짧게(2줄), 제목은 보조 */
function _buildPicturebookCardContent(s) {
  return `
    ${_buildImageAreaHtml(s)}
    <div class="card-body card-body--picturebook">
      <textarea class="card-body-textarea js-body-input"
        placeholder="장면 본문 (짧게)"
        rows="2"
        data-num="${s.num}">${_escapeHtml(s.body || '')}</textarea>
      <input class="card-title-input js-title-input"
        placeholder="장면 라벨 (선택)"
        type="text"
        value="${_escapeHtml(s.title || '')}"
        data-num="${s.num}"/>
      ${_buildTypeRowHtml(s)}
    </div>`;
}

/* ─── 3) 무비형 카드 ──────────────────────────────────────────
   위계: 미디어 썸네일 > 본문 상태 > 제목 > 선택지
   특징: 그림책형 구조 차용 + 영상/이미지 배지 + 본문 ON/OFF 배지
   주의: 영상 데이터 모델은 아직 미구현 → 임시 판정 (imageData 있으면 미디어 있음) */
function _buildMovieCardContent(s) {
  /* W7-B: 영상 우선, 포스터(imageData) fallback. movieData.videoUrl 정식 모델 기준. */
  const md = (s.movieData && typeof s.movieData === 'object') ? s.movieData : {};
  const hasVideo = !!md.videoUrl;
  const hasPoster = !!(md.posterImage || s.imageData);
  let mediaBadge = '';
  if (hasVideo) {
    mediaBadge = `<span class="card-meta-badge card-meta-badge--video">🎬 영상</span>`;
  } else if (hasPoster) {
    mediaBadge = `<span class="card-meta-badge card-meta-badge--image">🖼 포스터</span>`;
  } else {
    mediaBadge = `<span class="card-meta-badge card-meta-badge--empty">⚪ 미디어 없음</span>`;
  }

  /* 본문 ON/OFF 판정 — bodyEnabled 명시 필드 우선. undefined/null이면 body 존재 여부로 fallback.
     viewer-edit.js의 _typeSectionMovieHtml과 동일 정책. */
  const bodyEnabled = (s.bodyEnabled === true) ? true
                    : (s.bodyEnabled === false) ? false
                    : !!(s.body && String(s.body).trim());
  const bodyBadge = bodyEnabled
    ? `<span class="card-meta-badge card-meta-badge--body-on">📝 본문 사용</span>`
    : `<span class="card-meta-badge card-meta-badge--body-off">📝 본문 없음</span>`;

  /* W7-B 카드 정리: 무비형은 영상이 메인 + 포스터는 다듬기 패널에서 관리.
     카드 본체에 일반 이미지 넣기 영역(_buildImageAreaHtml)을 두면 사용자 혼란 —
     "이미지 넣기"가 영상도 포스터도 아닌 별도 일반 이미지로 보임.
     무비형 카드는 상태 배지만 표시하고, 모든 미디어 입력은 다듬기 패널에서. */
  return `
    <div class="card-meta-row card-meta-row--movie">
      ${mediaBadge}
      ${bodyBadge}
    </div>
    <div class="card-body card-body--movie">
      <textarea class="card-body-textarea js-body-input"
        placeholder="본문 (선택)"
        rows="2"
        data-num="${s.num}">${_escapeHtml(s.body || '')}</textarea>
      <input class="card-title-input js-title-input"
        placeholder="장면 라벨 (선택)"
        type="text"
        value="${_escapeHtml(s.title || '')}"
        data-num="${s.num}"/>
      ${_buildTypeRowHtml(s)}
    </div>`;
}

/* ─── 4) 체험전시형 카드 ───────────────────────────────────────
   위계: 배경 이미지 썸네일 > 연결 오브젝트 요약 > 제목 > 본문(1줄)
   특징: "연결 X개"가 카드 본체 위에 가장 먼저 보임. 일반 ports 영역은 유지
        (사용자 원칙: dot 위치 체계 유지). 단 카드 위계로는 보조 정도.
   주의: connectObjects 데이터 모델 미구현 → 임시 집계 (buttons.length 사용) */
function _buildExperienceCardContent(s) {
  /* W6: 정식 connectObjects 모델 — buttons[] 임시 집계 폐기.
     체험전시형은 탐색형/허브형 구조라 "엔딩" 개념이 자연스럽지 않음.
     · type 라디오(일반/엔딩) 제거 — 카드 본문에서 안 보임
     · _modeBadgeHtml 제거 — 작품 단위 모드라 카드별 배지 무의미
     카드 본체는 연결 오브젝트 요약 + 장면 라벨 + 안내문 중심. */
  const objects = Array.isArray(s.connectObjects) ? s.connectObjects : [];
  const objCount = objects.length;
  const objSummary = objCount > 0
    ? `🔗 연결 오브젝트 ${objCount}개`
    : `🔗 연결 오브젝트 0개`;

  return `
    ${_buildImageAreaHtml(s)}
    <div class="card-meta-row card-meta-row--experience">
      <span class="card-meta-badge card-meta-badge--connect-summary">${objSummary}</span>
    </div>
    <div class="card-body card-body--experience">
      <input class="card-title-input js-title-input"
        placeholder="장면 라벨 (선택)"
        type="text"
        value="${_escapeHtml(s.title || '')}"
        data-num="${s.num}"/>
      <textarea class="card-body-textarea card-body-textarea--single js-body-input"
        placeholder="안내문 (선택)"
        rows="1"
        data-num="${s.num}">${_escapeHtml(s.body || '')}</textarea>
    </div>`;
}

/* HTML escape — & / < / > / 따옴표 모두 (textarea/input value용) */
function _escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* 버튼 행 HTML — N개 통일 (W2-B-β).
   모든 인덱스가 input + 활성 dot. 색상은 인덱스 기반 (port-dot--N 클래스).
   W6: coType 인자가 들어오면 체험전시형 — type별 placeholder ("버튼 N" 대신 "버튼 라벨"). */
const _CO_PLACEHOLDER_BY_TYPE = {
  button:    '버튼 라벨',
  arrow:     '화살표 라벨',
  flag:      '깃발 라벨',
  next:      '다음 라벨',
  invisible: '영역 라벨',
};
function _portRowHtml(num, portChar, idx, labelVal, coType) {
  /* placeholder — 일반 모드는 "버튼 N", 체험전시형은 type별 라벨 */
  let placeholder;
  if (coType && Object.prototype.hasOwnProperty.call(_CO_PLACEHOLDER_BY_TYPE, coType)) {
    placeholder = _CO_PLACEHOLDER_BY_TYPE[coType];
  } else {
    placeholder = idx === 0 ? '버튼 1' : `버튼 ${idx + 1}`;
  }
  /* W4-D: 카드 input에도 모드별 maxlength 적용 (입력 자체 잠금 — viewer 다듬기와 동기). */
  const _ptype = (typeof projectMeta !== 'undefined' && projectMeta && projectMeta.projectType)
    || (typeof DEFAULT_PROJECT_TYPE !== 'undefined' ? DEFAULT_PROJECT_TYPE : null);
  const maxLen = (typeof getChoiceLabelMax === 'function')
    ? getChoiceLabelMax(_ptype) : 30;
  return `
      <div class="port-row">
        <input class="port-label-input js-choice-label" placeholder="${placeholder}"
          value="${_escapeHtml(labelVal)}" data-num="${num}" data-port="${portChar}"
          maxlength="${maxLen}"
          style="flex:1;min-width:0;border:1.5px solid #d0e0f5;border-radius:6px;
          padding:2px 5px;font-size:11px;font-family:var(--font-b);"/>
        <div class="port-dot port-dot--${portChar}" data-num="${num}" data-port="${portChar}" title="드래그해서 연결"></div>
      </div>`;
}

/* ── 본문 미리보기 (legacy, 단계 1에서 추가) ──
   단계 2부터는 본문이 직접 편집 textarea로 옮겨감 — _bodyPreviewHtml은
   더 이상 카드 본체에서 호출하지 않음. 함수는 호환을 위해 남겨두지만 사용처 없음.
   향후 정리 단계에서 제거 가능. */
function _bodyPreviewHtml(s) {
  const body = (s && typeof s.body === 'string') ? s.body.trim() : '';
  if (!body) return '';
  return `<div class="card-body-preview" title="본문은 다듬기 화면에서 수정해요">${_escapeHtml(body)}</div>`;
}

/* ── 모드 배지 (모드 시스템 뼈대 1차) ──
   · scene.presentationMode 값을 작은 배지로 표시 (text/picturebook/movie/document)
   · 명시 설정된 경우만 표시 — null이면 배지 없음 (branch는 구조 설계기, 깔끔함 유지)
   · 편집 UI 아님 — 모드 변경은 다듬기 화면(viewer-edit)에서만 */
function _modeBadgeHtml(s) {
  const m = s && s.presentationMode;
  if (m !== 'text' && m !== 'picturebook' && m !== 'movie' && m !== 'document') return '';
  const meta = {
    text:        { icon: '📝', label: '텍스트' },
    picturebook: { icon: '🎨', label: '그림책' },
    movie:       { icon: '🎬', label: '무비' },
    document:    { icon: '📜', label: '기록물' },
  }[m];
  return `<span class="card-mode-badge card-mode-badge--${m}" title="장면 모드: ${meta.label} (다듬기 화면에서 변경)">${meta.icon} ${meta.label}</span>`;
}

/* ================================================================
   bindCardEvents — addEventListener만 담당, 인라인 핸들러 없음
   ================================================================ */
function bindCardEvents(el, s) {
  const num = s.num;

  /* 번호 바꾸기 */
  el.querySelector('.js-rename-btn')
    ?.addEventListener('click', () => renameScene(num));

  /* 삭제 */
  el.querySelector('.js-delete-btn')
    ?.addEventListener('click', () => deleteScene(num));

  /* 제목 input — 한 줄 input 태그 (단계 2부터 textarea 아님). 이벤트는 동일 정책 */
  const titleInput = el.querySelector('.js-title-input');
  if (titleInput) {
    titleInput.addEventListener('focus', () => ensureEditable(num));
    titleInput.addEventListener('input', e => updateTitle(num, e.target.value));
    /* blur 시 debounced save 즉시 flush — 포커스 떠날 때 유실 방지 */
    titleInput.addEventListener('blur',  () => flushTitleSaves(num));
  }

  /* 본문 textarea — 단계 2 신규: 카드에서 본문 직접 편집.
     깊은 편집(textBox/모드/이미지 등)은 viewer-edit에서. */
  const bodyTextarea = el.querySelector('.js-body-input');
  if (bodyTextarea) {
    bodyTextarea.addEventListener('focus', () => ensureEditable(num));
    bodyTextarea.addEventListener('input', e => updateBody(num, e.target.value));
    bodyTextarea.addEventListener('blur',  () => flushBodySaves(num));
  }

  /* 종류 라디오 */
  el.querySelectorAll('.js-type-radio').forEach(radio => {
    radio.addEventListener('change', () => updateType(num, radio.dataset.value));
  });

  /* 선택지 개수 토글은 W2-A에서 제거됨 — buttons[] 단일 배열 구조로 통일.
     js-cnt-radio 셀렉터는 카드에 더 이상 없으므로 forEach 0회 (안전).
     legacy 데이터 호환을 위해 updateChoiceCount 함수는 ui.js에 남겨둠 (호출 안 됨). */

  /* 선택지 라벨 */
  el.querySelectorAll('.js-choice-label').forEach(input => {
    input.addEventListener('change', () => updateChoiceLabel(num, input.dataset.port, input.value));
  });

  /* + 버튼 추가 (C-1) — buttons.length < 6일 때만 카드에 표시되는 진입점 */
  el.querySelector('.js-add-button')
    ?.addEventListener('click', async e => {
      e.stopPropagation();
      const ok = await ensureEditable(num);
      if (!ok) return;
      addButton(num);
    });

  /* 🎨 다듬기 점프 (C-2) — 카드별 viewer-edit 진입.
     기존 #btn-viewer-edit과 같은 흐름이되 scene 파라미터 추가하여
     viewer-entry가 startViewerEdit(num)으로 자동 선택. */
  el.querySelector('.js-edit-jump')
    ?.addEventListener('click', e => {
      e.stopPropagation();
      const tn  = (typeof teamName !== 'undefined' && teamName) ? teamName : '';
      const cid = (typeof classId !== 'undefined' && classId) ? classId : '';
      if (!tn) { alert('먼저 팀 이름으로 입장해 주세요.'); return; }
      if (typeof flushTitleSaves === 'function') flushTitleSaves();
      if (typeof flushBodySaves  === 'function') flushBodySaves();
      if (typeof _saveReturnContext === 'function') _saveReturnContext('maker');
      const params = [
        `team=${encodeURIComponent(tn)}`,
        `edit=1`, `from=maker`,
        `scene=${encodeURIComponent(num)}`,
      ];
      if (cid) params.push(`classId=${encodeURIComponent(cid)}`);
      window.open(`viewer.html?${params.join('&')}`, '_blank');
    });

  /* 진엔딩 체크박스 */
  el.querySelector('.js-true-ending')
    ?.addEventListener('change', e => updateTrueEnding(num, e.target.checked));

  /* 이미지 썸네일 — 크게 보기 */
  el.querySelector('.js-img-thumb')
    ?.addEventListener('click', e => {
      e.stopPropagation();
      openImageFull(num);
    });

  /* 이미지 업로드 */
  el.querySelectorAll('.js-img-upload').forEach(input => {
    input.addEventListener('change', () => uploadImage(num, input));
  });

  /* 이미지 삭제 */
  el.querySelector('.js-img-remove')
    ?.addEventListener('click', () => removeImage(num));

  /* ── 카드 드래그 (개별 / 묶음) ──
     핵심 정책: 이동도 편집. 잠금 확보 전 드래그 시작 금지.
     · 개별: 해당 장면 ensureEditable, 실패 시 드래그 안 함
     · 묶음(groupMoveOn): connected 장면 전체 잠금 확보, 하나라도 실패하면 취소 */
  el.addEventListener('pointerdown', e => {
    if (['INPUT','BUTTON','LABEL','TEXTAREA','IMG'].includes(e.target.tagName)) return;
    if (e.target.classList.contains('port-dot')) return;

    const cv = toCanvas(e.clientX, e.clientY);

    if (groupMoveOn) {
      const nums = getConnectedNums(num);

      /* 1차 사전 체크: 다른 사람이 편집 중인 장면이 하나라도 있으면 즉시 거부.
         드래그 시작조차 하지 않음 — 사용자가 움직였는데 갑자기 취소되는 일 없음 */
      const blockedByOther = nums.filter(n => isLockedByOther(n));
      if (blockedByOther.length > 0) {
        alert(`묶음 이동을 할 수 없어요.\n다른 사람이 편집 중: 장면 ${blockedByOther.join(', ')}`);
        return;
      }

      /* 2차 All-or-nothing 잠금 — 내 세션으로 전부 확보 시도 */
      const lockAllP = ensureEditableForGroup(nums);
      el._pendingDrag = {
        pointerId: e.pointerId,
        startX: e.clientX, startY: e.clientY,
        cv, num, group: true, nums,
        lockAllP, lockAllOk: null
      };
      lockAllP.then(ok => { if (el._pendingDrag) el._pendingDrag.lockAllOk = ok; });
    } else {
      /* 개별 이동 — 내가 대상 장면 잠글 수 있어야 함 */
      if (isLockedByOther(num)) return;
      const lockP = ensureEditable(num);
      el._pendingDrag = {
        pointerId: e.pointerId,
        startX: e.clientX, startY: e.clientY,
        cv, num, lockP, lockOk: null
      };
      lockP.then(ok => { if (el._pendingDrag) el._pendingDrag.lockOk = ok; });
    }
  });

  el.addEventListener('pointermove', e => {
    if (el._pendingDrag && el._pendingDrag.pointerId === e.pointerId && !dragState) {
      const dx = e.clientX - el._pendingDrag.startX;
      const dy = e.clientY - el._pendingDrag.startY;
      if (Math.sqrt(dx * dx + dy * dy) > 8) {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        const pDrag = el._pendingDrag;
        el._pendingDrag = null;

        if (pDrag.group) {
          /* 묶음 이동 — all-or-nothing 검증 */
          if (pDrag.lockAllOk === true) {
            _startDrag(el, s, pDrag.cv);
          } else if (pDrag.lockAllOk === false) {
            el.releasePointerCapture(e.pointerId);
            alert('일부 장면을 잠글 수 없어서 묶음 이동을 취소했어요.');
          } else {
            /* 잠금 아직 대기 중 — 완료될 때까지 기다림 */
            el._deferredDrag = pDrag;
            pDrag.lockAllP.then(ok => {
              el._deferredDrag = null;
              if (!ok) {
                alert('일부 장면을 잠글 수 없어서 묶음 이동을 취소했어요.');
                return;
              }
              if (dragState || pDrag.cancelled) return;
              _startDrag(el, s, pDrag.cv);
            });
          }
        } else {
          /* 개별 이동 */
          if (pDrag.lockOk === true) {
            _startDrag(el, s, pDrag.cv);
          } else if (pDrag.lockOk === false) {
            el.releasePointerCapture(e.pointerId);
            syncCardState(num);
            alert('다른 사람이 편집 중인 장면은 이동할 수 없어요.');
          } else {
            el._deferredDrag = pDrag;
            pDrag.lockP.then(ok => {
              el._deferredDrag = null;
              if (!ok) {
                syncCardState(num);
                alert('다른 사람이 편집 중인 장면은 이동할 수 없어요.');
                return;
              }
              if (dragState || pDrag.cancelled) return;
              _startDrag(el, s, pDrag.cv);
            });
          }
        }
      }
      return;
    }
    if (!dragState || dragState.num !== num) return;
    e.preventDefault();
    const cv = toCanvas(e.clientX, e.clientY);
    if (dragState.group) {
      /* ★ 그룹 단위 clamp — 각 장면을 따로 Math.max(0,...)하면
         왼쪽/위 경계에 닿은 장면만 멈추고 다른 장면은 계속 이동해서 상대 위치가 깨짐.
         그룹 전체의 proposed 좌표 중 가장 작은 값을 찾아 전체에 offset을 더함. */
      /* 1차: 각 장면의 예상 좌표 계산 */
      const proposed = {};
      let minX = Infinity, minY = Infinity;
      dragState.nums.forEach(n => {
        const off = dragState.offsets[n];
        const px  = cv.x + off.ox;
        const py  = cv.y + off.oy;
        proposed[n] = { x: px, y: py };
        if (px < minX) minX = px;
        if (py < minY) minY = py;
      });
      /* 2차: 그룹 전체가 경계 안으로 들어오도록 offset 보정 */
      const shiftX = minX < 0 ? -minX : 0;
      const shiftY = minY < 0 ? -minY : 0;
      /* 3차: 실제 반영 — 상대 위치 완벽 유지 */
      dragState.nums.forEach(n => {
        const sc  = scenes[n];
        sc.x = proposed[n].x + shiftX;
        sc.y = proposed[n].y + shiftY;
        const cel = document.getElementById('card-' + n);
        if (cel) { cel.style.left = sc.x + 'px'; cel.style.top = sc.y + 'px'; }
      });
    } else {
      const sc = scenes[num];
      sc.x = Math.max(0, cv.x + dragState.ox);
      sc.y = Math.max(0, cv.y + dragState.oy);
      el.style.left = sc.x + 'px';
      el.style.top  = sc.y + 'px';
    }
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => { drawArrows(); rafId = null; });
  });

  el.addEventListener('pointerup', e => {
    if (el._deferredDrag) { el._deferredDrag.cancelled = true; el._deferredDrag = null; }
    el._pendingDrag = null;
    if (!dragState || dragState.num !== num) return;
    const wasGroup = !!dragState.group;
    const groupNums = wasGroup ? dragState.nums.slice() : [num];
    if (wasGroup)
      dragState.nums.forEach(n => document.getElementById('card-'+n)?.classList.remove('group-selected'));
    el.classList.remove('dragging');
    touchEdit(num);
    dragState = null;
    /* ★ 그룹 이동 시 모든 장면 저장 (기존엔 시작 장면만 저장해서 좌표 반영 안 됨) */
    groupNums.forEach(n => pushToFirebase(n));
  });

  el.addEventListener('pointercancel', () => {
    if (el._deferredDrag) { el._deferredDrag.cancelled = true; el._deferredDrag = null; }
    el._pendingDrag = null;
    if (dragState && dragState.num === num) {
      if (dragState.group)
        dragState.nums.forEach(n => document.getElementById('card-'+n)?.classList.remove('group-selected'));
      el.classList.remove('dragging');
      dragState = null;
    }
  });

  /* 포트 드래그 (연결선) */
  el.querySelectorAll('.port-dot').forEach(dot => {
    dot.style.touchAction = 'none';

    dot.addEventListener('pointerdown', async e => {
      e.stopPropagation();
      if (isLockedByOther(num)) return;
      e.preventDefault();
      dot.setPointerCapture(e.pointerId);
      const ok = await ensureEditable(num);
      if (!ok) { dot.releasePointerCapture(e.pointerId); syncCardState(num); return; }

      const port   = dot.dataset.port;
      const sc     = scenes[num];
      /* port → 인덱스 + startY/색상 (W2-B-β: N개 dot 지원) */
      const portIdx = (typeof port === 'string') ? port.charCodeAt(0) - 65 : 0;
      const idx     = (portIdx >= 0 && portIdx < 6) ? portIdx : 0;
      const _COLORS = ['#4a90d9', '#ef476f', '#06a77d', '#f4a261', '#9b4dca', '#ff6b35'];
      const startX = sc.x + 200;
      const startY = sc.y + 120 + (idx * 20);
      connState    = { fromNum: num, port };
      const tl     = document.getElementById('temp-line');
      tl.setAttribute('display', '');
      tl.setAttribute('stroke', _COLORS[idx]);
      tl.setAttribute('x1', startX); tl.setAttribute('y1', startY);
      tl.setAttribute('x2', startX); tl.setAttribute('y2', startY);
    });

    dot.addEventListener('pointermove', e => {
      if (!connState) return;
      e.preventDefault();
      const cv = toCanvas(e.clientX, e.clientY);
      const tl = document.getElementById('temp-line');
      tl.setAttribute('x2', cv.x); tl.setAttribute('y2', cv.y);
      document.querySelectorAll('.scene-card').forEach(c => c.classList.remove('highlight'));
      const target = getCardAt(e.clientX, e.clientY);
      if (target && target !== connState.fromNum)
        document.getElementById('card-' + target)?.classList.add('highlight');
    });

    dot.addEventListener('pointerup', e => {
      if (!connState) return;
      document.querySelectorAll('.scene-card').forEach(c => c.classList.remove('highlight'));
      document.getElementById('temp-line').setAttribute('display', 'none');
      const target = getCardAt(e.clientX, e.clientY);
      if (target && target !== connState.fromNum)
        connect(connState.fromNum, connState.port, target);
      connState = null;
    });
  });
}

/* ================================================================
   syncCardState — 잠금/타입/비활성 상태만 기존 카드 DOM에 반영
   전체 재렌더 없이 상태 변화만 적용할 때 호출
   ================================================================ */
function syncCardState(num) {
  const el = document.getElementById('card-' + num);
  if (!el) return;
  const s      = scenes[num];
  const locked = isLockedByOther(num);

  /* 잠금 opacity */
  el.style.opacity = locked ? '0.65' : '1';

  /* 타입 클래스 */
  el.className = el.className.replace(/\btype-\S+/g, '').trim();
  if (s) el.classList.add(`type-${s.type}`);

  /* 잠금 배지 */
  let badge = el.querySelector('.lock-badge');
  if (locked) {
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'lock-badge';
      badge.style.cssText =
        'position:absolute;top:6px;right:32px;background:#6060c0;' +
        'color:#fff;font-family:var(--font-h);font-size:10px;padding:2px 8px;' +
        'border-radius:50px;z-index:11;pointer-events:none;';
      el.appendChild(badge);
    }
    badge.textContent = '🔒 편집 중';
  } else {
    badge?.remove();
  }

  /* 입력 요소 disabled */
  el.querySelectorAll('textarea, input, button:not(.card-delete)')
    .forEach(inp => locked ? inp.setAttribute('disabled','') : inp.removeAttribute('disabled'));
}

/* ================================================================
   renderCard — 오케스트레이터
   buildCardHTML → innerHTML → bindCardEvents → syncCardState
   ================================================================ */
function renderCard(s) {
  document.getElementById('card-' + s.num)?.remove();

  /* W7: 시작점/다시시작점 카드 시각 강조 — class로 표시 */
  const pm = (typeof projectMeta === 'object' && projectMeta) ? projectMeta : {};
  const isEntry  = pm.entrySceneId  != null && String(pm.entrySceneId)  === String(s.num);
  const isReplay = pm.replaySceneId != null && String(pm.replaySceneId) === String(s.num);
  const roleClass = [
    isEntry  ? 'is-entry-scene'  : '',
    isReplay ? 'is-replay-scene' : '',
  ].filter(Boolean).join(' ');

  const el       = document.createElement('div');
  el.className   = `scene-card type-${s.type}${roleClass ? ' ' + roleClass : ''}`;
  el.id          = `card-${s.num}`;
  el.style.cssText = `position:absolute;left:${s.x}px;top:${s.y}px;`;

  el.innerHTML = buildCardHTML(s);
  bindCardEvents(el, s);

  document.getElementById('canvas').appendChild(el);
  syncCardState(s.num);   // 잠금 상태 반영
}

/* ================================================================
   연결 / 카드 위치 판별 / 화살표
   ================================================================ */
function connect(fromNum, port, toNum) {
  const s = scenes[fromNum];
  if (!s) return;

  /* port → 인덱스 ('A'→0, 'B'→1, 'C'→2, ...) — W2-B-β */
  const idx = (typeof port === 'string') ? port.charCodeAt(0) - 65 : -1;
  if (idx < 0 || idx > 5) return;  /* 최대 6개 (사용자 결정) */

  /* W6: 체험전시형은 connectObjects[] 기반 — buttons[] 사용 X.
     포트 idx는 buildCardHTML에서 필터링된 (back/home 제외) connectObjects 순서.
     같은 필터링 + 인덱스로 nextId 갱신. */
  const _ptype = (typeof projectMeta !== 'undefined' && projectMeta && projectMeta.projectType) || null;
  if (_ptype === 'experience') {
    if (!Array.isArray(s.connectObjects)) s.connectObjects = [];
    /* back/home 제외 필터링된 배열 */
    const eligibleIdxs = [];
    s.connectObjects.forEach((co, i) => {
      if (co && co.type !== 'back' && co.type !== 'home') eligibleIdxs.push(i);
    });
    if (idx >= eligibleIdxs.length) return;   /* 빈 포트는 무시 (체험전시형은 다듬기에서 추가) */
    const realIdx = eligibleIdxs[idx];
    s.connectObjects[realIdx].nextId = String(toNum);
    renderCard(s);
    drawArrows();
    pushToFirebase();
    return;
  }

  /* 그 외 모드 — 기존 buttons[] 흐름 */
  if (!Array.isArray(s.buttons)) s.buttons = [];
  while (s.buttons.length <= idx) {
    const i = s.buttons.length;
    /* 빈 슬롯은 legacy choiceA/B fallback으로 채움 */
    const legacyLabel = i === 0 ? (s.choiceA || '') : i === 1 ? (s.choiceB || '') : '';
    s.buttons.push({
      id: String.fromCharCode(65 + i),
      label: legacyLabel,
    });
  }
  s.buttons[idx] = {
    ...s.buttons[idx],
    id: s.buttons[idx].id || String.fromCharCode(65 + idx),
    nextId: String(toNum),
  };

  /* nextA/nextB 호환 동기화 — 첫 2개만 (legacy 코드 호환) */
  if (idx === 0) s.nextA = toNum;
  else if (idx === 1) s.nextB = toNum;

  /* choiceCount 호환 동기화 */
  s.choiceCount = s.buttons.length === 1 ? 1 : 2;

  renderCard(s);
  drawArrows();
  pushToFirebase();
}

function getCardAt(clientX, clientY) {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    if (el.classList.contains('scene-card'))
      return parseInt(el.id.replace('card-', ''));
  }
  return null;
}

function drawArrows() {
  const svg = document.getElementById('arrows');
  svg.querySelectorAll('path.arrow, text.arrow-label, rect.arrow-label').forEach(el => el.remove());

  /* W6: 체험전시형은 connectObjects[] 기반 화살표.
     다른 모드는 기존 buttons[] 흐름 그대로. */
  const _ptype = (typeof projectMeta !== 'undefined' && projectMeta && projectMeta.projectType) || null;
  const _isExperience = _ptype === 'experience';

  /* W2-B-β: buttons[] 기반 N개 화살표.
     · buttons[].nextId 기준 (진실)
     · buttons[]가 없으면 legacy nextA/nextB fallback
     · 인덱스별로 색상/위치 다양화 (6색)
     W6: 체험전시형은 connectObjects[]만 사용. back/home은 시스템 액션이라 제외. */
  Object.values(scenes).forEach(s => {
    if (_isExperience) {
      const allCo = Array.isArray(s.connectObjects) ? s.connectObjects : [];
      /* back/home (legacy 호환 시스템 타입) 제외 — 시스템 액션은 nextId 무관 */
      const eligibleCo = allCo.filter(co => co && co.type !== 'back' && co.type !== 'home');
      /* W6 4번: 6개 제한과 분리 — 체험전시형은 N개 모두 화살표.
         색상 팔레트는 6색 순환(i % 6)으로 같은 카드 화살표 구분. */
      eligibleCo.forEach((co, i) => {
        if (!co || !co.nextId) return;
        drawArrowForIndex(svg, s, i % 6, String(co.nextId), co.label || '');
      });
      return;
    }

    /* 그 외 모드 — 기존 buttons[] 흐름 */
    const buttons = Array.isArray(s.buttons) ? s.buttons : [];

    if (buttons.length > 0) {
      /* 새 구조: buttons[i].nextId 따라 화살표 */
      buttons.slice(0, 6).forEach((b, i) => {
        if (!b || !b.nextId) return;
        drawArrowForIndex(svg, s, i, String(b.nextId), b.label || '');
      });
    } else {
      /* legacy fallback: nextA/nextB */
      if (s.nextA) drawArrowForIndex(svg, s, 0, String(s.nextA), s.choiceA || '');
      if (s.nextB && (s.choiceCount || 2) > 1) {
        drawArrowForIndex(svg, s, 1, String(s.nextB), s.choiceB || '');
      }
    }
  });
}

/* 인덱스 기반 화살표 그리기 (W2-B-β) — A/B 외 N개 지원.
   6색 팔레트: A=파랑, B=빨강, C=초록, D=노랑, E=보라, F=주황 */
const _PORT_COLORS = ['#4a90d9', '#ef476f', '#06a77d', '#f4a261', '#9b4dca', '#ff6b35'];
const _PORT_MARKERS = ['ahA', 'ahB', 'ahC', 'ahD', 'ahE', 'ahF'];

function drawArrowForIndex(svg, s, idx, nextNum, labelText) {
  if (!nextNum || !scenes[nextNum]) return;
  const t = scenes[nextNum];

  /* 시작 위치 — 인덱스별로 y 오프셋. A=120, B=140, C=160, ... */
  const x1 = s.x + 200;
  const y1 = s.y + 120 + (idx * 20);
  const x2 = t.x;
  const y2 = t.y + 50;
  const cx = (x1 + x2) / 2;

  const color    = _PORT_COLORS[idx] || _PORT_COLORS[0];
  const markerId = _PORT_MARKERS[idx] || _PORT_MARKERS[0];

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('class', 'arrow');
  path.setAttribute('d', `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', '2');
  path.setAttribute('marker-end', `url(#${markerId})`);
  path.setAttribute('opacity', '0.85');
  svg.appendChild(path);

  /* 라벨 표시 — 의미 있는 라벨만 */
  const label = String(labelText || '').trim();
  const portChar = String.fromCharCode(65 + idx);
  if (label && label !== portChar) {
    const lx = x1 + 6, ly = y1 - 16;
    const lw = Math.min(label.length * 8 + 8, 80), lh = 16;

    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('class', 'arrow-label');
    bg.setAttribute('x', lx);  bg.setAttribute('y', ly);
    bg.setAttribute('width', lw); bg.setAttribute('height', lh);
    bg.setAttribute('rx', 3); bg.setAttribute('fill', '#fff');
    bg.setAttribute('stroke', color); bg.setAttribute('stroke-width', '1');
    svg.appendChild(bg);

    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('class', 'arrow-label');
    txt.setAttribute('x', lx + 4); txt.setAttribute('y', ly + 12);
    txt.setAttribute('font-size', '11');
    txt.setAttribute('fill', color);
    txt.textContent = label.length > 8 ? label.slice(0, 8) + '…' : label;
    svg.appendChild(txt);
  }
}

/* 기존 drawArrow는 호환을 위해 유지 (호출처 없어도 외부 코드 안전) */
function drawArrow(svg, s, port) {
  const idx = port === 'A' ? 0 : port === 'B' ? 1 : -1;
  if (idx < 0) return;
  /* 새 buttons[] 우선 */
  const buttons = Array.isArray(s.buttons) ? s.buttons : [];
  if (buttons[idx] && buttons[idx].nextId) {
    drawArrowForIndex(svg, s, idx, String(buttons[idx].nextId), buttons[idx].label || '');
    return;
  }
  /* legacy fallback */
  if (port === 'B' && (s.choiceCount || 2) === 1) return;
  const next = port === 'A' ? s.nextA : s.nextB;
  if (!next) return;
  const label = port === 'A' ? (s.choiceA || '') : (s.choiceB || '');
  drawArrowForIndex(svg, s, idx, String(next), label);
}
