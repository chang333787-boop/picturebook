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
/* v37: type 인자 받아 표지/장면/엔딩 분기 생성.
   · 표지(cover): 작품당 1개만. 제목 + 한 줄 소개 + 표지 테마. 그림·선택지 없음.
   · 장면(normal): 기존 흐름
   · 엔딩(ending): 기존 흐름 + type='ending' */
function addScene(type) {
  type = (type === 'cover' || type === 'ending' || type === 'normal') ? type : 'normal';

  /* 표지는 작품당 1개만 */
  if (type === 'cover') {
    const existing = Object.values(scenes).find(s => s.type === 'cover');
    if (existing) {
      alert('표지는 작품당 하나만 만들 수 있어요.');
      return;
    }
  }

  let num = 1;
  while (scenes[num]) num++;
  nextNum = num + 1;

  const wrap = document.getElementById('canvas-wrap');
  const rect = wrap.getBoundingClientRect();
  const cx   = rect.width  / 2 + (Math.random() - 0.5) * 160;
  const cy   = rect.height / 2 + (Math.random() - 0.5) * 100;
  const cv   = toCanvas(rect.left + cx, rect.top + cy);

  /* type별 기본 데이터 */
  const base = {
    num,
    title: '',
    body: '',
    type,
    x: Math.max(20, cv.x),
    y: Math.max(20, cv.y),
    buttons: [],
    choiceA: '', choiceB: '', choiceCount: 2,
    _hasBody: true,
    presentationMode: 'picturebook',
  };

  /* D7-4: 그림책 작품의 새 일반 장면 기본을 imageCenter(그림중심 무대)로 — 신규 생성만 명시 저장.
     fallback(viewer-render/sceneRenderer)은 무변경 → submode 없는 legacy 장면은 split 유지.
     cover/ending 제외(표지·엔딩 전용 렌더), 비-그림책(text/movie/document) 제외. */
  const _d7pt = (typeof projectMeta !== 'undefined' && projectMeta && projectMeta.projectType) || null;
  if (_d7pt === 'picturebook' && type === 'normal') {
    base.picturebookSubmode = 'imageCenter';
  }

  if (type === 'cover') {
    /* 표지 전용 필드 */
    base.subtitle = '';                  // 한 줄 소개
    base.coverTheme = 'default';         // 표지 테마 (default | cream | sage | sky | coral)
    base.titleVerticalPosition = 50;     // 제목 높낮이 (0~100, 50=가운데)
    /* v37: 표지에도 single button — 첫 장면으로 연결되는 시작 port */
    base.buttons = [{ label: '▶ 시작하기', nextId: null }];
  } else if (type === 'ending') {
    /* 엔딩 전용 — 기존 흐름. trueEnding은 사용자가 별도 토글 */
    base.trueEnding = false;
  }

  scenes[num] = base;
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
  /* W8 Phase B-2: 좌측 사이드 동기화 (장면 추가/삭제/변경 시) */
  if (typeof renderSideList === 'function') renderSideList();
  /* BRANCH-VIEWPORT-RESTORE: 카드 렌더 완료 후 복귀 viewport 1회 복원(ui.js).
     1회성·resume=1·team 일치 가드 내장 → 매 renderAll 호출돼도 1회만 소비. */
  if (typeof _restoreBranchViewportOnce === 'function') _restoreBranchViewportOnce();
  /* HOTFIX(생각 나침반 결과 보기): 작품 진입/렌더 후 🧭 버튼 노출 갱신.
     내부에서 classId+teamName 키 가드 → 같은 작품 재호출 시 DB read 생략(저비용). */
  if (typeof window._updateCompassResultButton === 'function') window._updateCompassResultButton();
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
  } else if (s.type === 'cover') {
    /* v69: 표지 시작 버튼 — 라벨 "▶ 시작하기" 고정 (사용자 수정 X).
        input 대신 readonly 텍스트 + 연결 dot만. 사용자 보고: "표지는 시작하기 고정이니까 칸 막아줘". */
    portsHTML = `
      <div class="card-ports card-ports--cover">
        <div class="port-row port-row--cover-fixed">
          <span class="port-label-fixed">▶ 시작하기</span>
          <div class="port-dot port-dot--A" data-num="${s.num}" data-port="A" title="드래그해서 첫 장면 연결"></div>
        </div>
      </div>`;
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
      <div class="card-ending-zone" style="padding:4px 8px 10px;">
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
  /* B(브랜치 마커): '시작점' 데이터(projectMeta.entrySceneId)가 가리키는 실제 장면에만 짧은 '시작' 배지(번호 옆).
     데이터 없으면 미표시(추측 금지). replaySceneId(다시 하기)는 표시 안 함(혼란 방지). roleBadgeRow는 미사용 유지. */
  void isReplay;
  const startBadge = isEntry
    ? ` <span class="card-start-badge" title="이야기가 시작되는 장면">시작</span>`
    : '';
  const roleBadges = '';

  /* ─── 작품 유형별 카드 얼굴 (2단계) ───────────────────────────
     원칙:
     · shell(header/ports/포트 dot 위치)은 공통 유지
     · 가운데 content(이미지 + body) 영역만 유형별 분기
     · 4개 content 함수로 위계와 요약 정보만 다름
     · 체험전시형도 ports 영역은 유지 (dot/연결 인터랙션 보존) — 카드 본체에
       "연결 X개" 요약을 위에 추가하는 방식으로 위계 표현. */
  const _ptype = _resolveProjectType();
  const contentHtml = _buildCardContentByType(s, _ptype);

  /* BRANCH-CARD-REDESIGN-1: 그림책 지도형 카드에만 ··· 편집메뉴 버튼.
     클릭 시 .scene-card.is-expanded 토글 → 기본 숨겨둔 편집 영역/포트/삭제 노출.
     다른 모드(text/movie/experience)·표지엔 미표시(기존 카드 그대로). */
  const moreBtn = (_ptype === 'picturebook' && s.type !== 'cover')
    ? `<button class="card-more js-card-more" data-num="${s.num}" title="편집 메뉴" aria-label="편집 메뉴">⋯</button>`
    : '';

  /* BRANCH-CARD-REDESIGN-2: 원형 번호 배지 + 상태 배지(그림책 한정).
     · pb: 번호만 원형 배지(장면 글자는 CSS로 숨김) + 시작/엔딩/진엔딩 상태 배지.
     · 비-pb: 기존 "장면 N" + startBadge 그대로(무변경). */
  const _isPbCard = (_ptype === 'picturebook' && s.type !== 'cover');
  /* BRANCH-COVER-CARD-REDESIGN: 표지는 장면 번호 없이 📖 마커 + '표지' 배지(동화 지도 통일·구분 유지). */
  const _isCoverPb = (_ptype === 'picturebook' && s.type === 'cover');
  const _numInner = _isCoverPb
    ? `<span class="card-cover-mark" aria-hidden="true">📖</span>`
    : _isPbCard
      ? `<span class="card-num-text">장면 </span><span class="card-num-only">${s.num}</span>`
      : `장면 ${s.num}${starBadge}`;
  const _statusBadge = _isCoverPb
    ? `<span class="card-state-badge card-state-badge--cover">표지</span>`
    : !_isPbCard
      ? startBadge
      : isEntry
        ? `<span class="card-state-badge card-state-badge--start">시작</span>`
        : (s.type === 'ending' && s.trueEnding)
          ? `<span class="card-state-badge card-state-badge--true">진엔딩 ★</span>`
          : (s.type === 'ending')
            ? `<span class="card-state-badge card-state-badge--ending">엔딩</span>`
            : '';

  /* W7: roleBadges를 본체 위 별도 줄로 — 포스터/본문사용과 같은 .card-meta-row */
  const roleBadgeRow = roleBadges
    ? `<div class="card-meta-row card-meta-row--role">${roleBadges}</div>`
    : '';

  return `
    <div class="card-header">
      <span class="card-num-badge js-rename-btn" data-num="${s.num}"
        title="번호 바꾸기">${_numInner}</span>${_statusBadge}
      <button class="card-edit-jump js-edit-jump" data-num="${s.num}"
        title="이 장면 다듬기">✎</button>
      ${_isCoverPb ? '' : `<button class="card-delete js-delete-btn" data-num="${s.num}">✕</button>`}
      ${moreBtn}
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
  /* v37: type='cover'면 ptype과 무관하게 표지 카드 */
  if (s.type === 'cover') return _buildCoverCardContent(s);
  switch (ptype) {
    case 'text':       return _buildTextCardContent(s);
    case 'movie':      return _buildMovieCardContent(s);
    case 'experience': return _buildExperienceCardContent(s);
    case 'picturebook':
    default:           return _buildPicturebookCardContent(s);
  }
}

/* v37: 표지 카드 — 제목 + 한 줄 소개 + 표지 테마. 그림·선택지 없음.
   다른 장면 카드와 시각 구분: 보라 톤 + 책 표지 아이콘 + 다른 라벨 */
function _buildCoverCardContent(s) {
  /* v69: 브랜치(maker) 표지 카드 — 제목 + 한 줄 소개만 박기.
     v67에서 박은 "색은 감상 화면 다듬기에서 박아요" hint 폐기 (사용자 요청). */
  return `
    <div class="card-body card-body--cover">
      <div class="cover-card-label">📖 책 표지</div>
      <input class="card-title-input card-title-input--cover js-cover-title"
        placeholder="작품 제목"
        type="text"
        value="${_escapeHtml(s.title || '')}"
        data-num="${s.num}"
        maxlength="40"/>
      <input class="card-subtitle-input js-cover-subtitle"
        placeholder="한 줄 소개 (선택)"
        type="text"
        value="${_escapeHtml(s.subtitle || '')}"
        data-num="${s.num}"
        maxlength="60"/>
    </div>`;
}

/* ─── 카드 공통 부품: 이미지 영역 / 라디오+모드배지 ───────────── */
function _buildImageAreaHtml(s) {
  return s.imageData
    ? `<div class="card-image-area">
        <img src="${s.imageData}" class="card-thumb js-img-thumb"
          loading="lazy" decoding="async"
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
      ${_buildTypeRowHtml(s)}
    </div>`;
}

/* ─── 2) 그림책형 카드 ────────────────────────────────────────
   위계: 그림 썸네일 > 본문 미리보기 > 제목 > 선택지
   특징: 그림 썸네일 가장 위, 본문은 짧게(2줄), 제목은 보조 */
function _buildPicturebookCardContent(s) {
  /* BRANCH-CARD-REDESIGN-1: 동화 지도형 그림책 카드.
     · 그림(가장 큰 영역) + 본문 읽기전용 미리보기(최대 2줄)만 기본 노출.
     · '그림 중심형' 배지 제거(그림책은 그림 중심형으로 통일됨).
     · 편집 UI(본문 textarea / 일반·엔딩 토글 / 이미지 바꾸기·삭제 버튼)는
       .pb-edit-zone으로 묶어 기본 숨김 → 카드 선택(···) 시에만 노출.
     · 데이터·핸들러·포트(연결 dot) 구조 무변경. js-body-input 등 기존 셀렉터 유지. */
  const _bodyTrim = (typeof s.body === 'string') ? s.body.trim() : '';
  const _previewText = _bodyTrim
    ? _escapeHtml(_bodyTrim)
    : '그림과 글을 채워 보세요.';
  const _emptyCls = _bodyTrim ? '' : ' pb-body-preview--empty';
  return `
    ${_buildImageAreaHtml(s)}
    <div class="pb-body-preview${_emptyCls}" title="⋯을 눌러 이 장면을 수정할 수 있어요">${_previewText}</div>
    <div class="pb-edit-zone">
      <div class="card-body card-body--picturebook">
        <textarea class="card-body-textarea js-body-input"
          placeholder="장면 본문 (짧게)"
          rows="2"
          data-num="${s.num}">${_escapeHtml(s.body || '')}</textarea>
        ${_buildTypeRowHtml(s)}
      </div>
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

  /* W8: 핫스팟 overlay — 이미지 있을 때만, connectObjects의 x/y(%) 위치로 dot 표시.
     viewer에서 실제 보이는 위치 미리보기. */
  let hotspotHtml = '';
  if (s.imageData && objects.length > 0) {
    hotspotHtml = `
      <div class="card-hotspot-overlay">
        ${objects.map(o => {
          const cx = (typeof o.x === 'number' ? o.x : 50) + (typeof o.w === 'number' ? o.w / 2 : 0);
          const cy = (typeof o.y === 'number' ? o.y : 50) + (typeof o.h === 'number' ? o.h / 2 : 0);
          return `<span class="card-hotspot" style="left:${cx}%;top:${cy}%;"></span>`;
        }).join('')}
      </div>`;
  }

  return `
    <div class="card-image-area-wrap">
      ${_buildImageAreaHtml(s)}
      ${hotspotHtml}
    </div>
    <div class="card-meta-row card-meta-row--experience">
      <span class="card-meta-badge card-meta-badge--connect-summary">${objSummary}</span>
    </div>
    <div class="card-body card-body--experience">
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

/* BRANCH-CARD-REDESIGN-3: 그림책 지도 카드의 펼침 textarea 현재값 → 접힌 미리보기 DOM 즉시 반영.
   전체 renderCard/renderAll 없이 미리보기 텍스트만 갱신(입력 focus·캔버스 부분렌더 영향 없음).
   scene.body는 updateBody가 이미 라이브 반영 — 여기선 표시 동기화만. 데이터/저장 경로 무변경. */
function _pbSyncPreviewFromTextarea(cardEl) {
  if (!cardEl) return;
  const ta = cardEl.querySelector('.js-body-input');
  const pv = cardEl.querySelector('.pb-body-preview');
  if (!ta || !pv) return;
  const v = (ta.value || '').trim();
  if (v) { pv.textContent = v; pv.classList.remove('pb-body-preview--empty'); }
  else   { pv.textContent = '그림과 글을 채워 보세요.'; pv.classList.add('pb-body-preview--empty'); }
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
    ?.addEventListener('click', () => {
      /* BRANCH-COVER-CARD-FINAL-QA: 그림책 표지는 삭제 차단(버튼 미렌더 + 핸들러 가드 이중 방어).
         ui.js deleteScene엔 cover 가드가 없어 호출 경로에서 막음. text/movie 표지는 무영향. */
      const _s = scenes[num];
      if (_s && _s.type === 'cover' && _resolveProjectType() === 'picturebook') return;
      deleteScene(num);
    });

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

  /* v37: 표지 전용 input들 */
  const coverTitle = el.querySelector('.js-cover-title');
  if (coverTitle) {
    coverTitle.addEventListener('focus', () => ensureEditable(num));
    coverTitle.addEventListener('input', e => {
      s.title = e.target.value;
      if (typeof scenes !== 'undefined' && scenes[num]) scenes[num].title = e.target.value;
      if (typeof pushToFirebaseDebounced === 'function') pushToFirebaseDebounced();
      else if (typeof pushToFirebase === 'function') pushToFirebase();
    });
  }
  const coverSubtitle = el.querySelector('.js-cover-subtitle');
  if (coverSubtitle) {
    coverSubtitle.addEventListener('focus', () => ensureEditable(num));
    coverSubtitle.addEventListener('input', e => {
      s.subtitle = e.target.value;
      if (typeof scenes !== 'undefined' && scenes[num]) scenes[num].subtitle = e.target.value;
      if (typeof pushToFirebaseDebounced === 'function') pushToFirebaseDebounced();
      else if (typeof pushToFirebase === 'function') pushToFirebase();
    });
  }
  el.querySelectorAll('.js-cover-theme').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const val = btn.dataset.val || 'default';
      s.coverTheme = val;
      if (typeof scenes !== 'undefined' && scenes[num]) scenes[num].coverTheme = val;
      el.querySelectorAll('.js-cover-theme').forEach(b => b.classList.toggle('active', b === btn));
      if (typeof pushToFirebase === 'function') pushToFirebase();
    });
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
      const _vurl = `viewer.html?${params.join('&')}`;
      /* 항상 같은 창 이동 (ui.js _openInternalUrl). */
      if (typeof _openInternalUrl === 'function') _openInternalUrl(_vurl);
      else window.location.href = _vurl;
    });

  /* BRANCH-CARD-REDESIGN-3: ··· 편집메뉴 토글 — 펼침/접기 + 본문 저장·미리보기 동기화.
     · 접을 때: textarea 현재값을 접힌 미리보기 DOM에 즉시 반영 + 기존 flushBodySaves로 pending save flush.
     · 펼칠 때: 다른 펼친 카드를 먼저 저장·접기(한 번에 하나만 펼침) 후 이 카드 펼침.
     · 입력 중에는 재렌더 안 함(updateBody가 scene.body 라이브 반영 + debounce). focus/cursor 유지. */
  el.querySelector('.js-card-more')
    ?.addEventListener('click', e => {
      e.stopPropagation();
      const willExpand = !el.classList.contains('is-expanded');
      if (willExpand) {
        document.querySelectorAll('.scene-card.pb-mapcard.is-expanded').forEach(other => {
          if (other === el) return;
          _pbSyncPreviewFromTextarea(other);
          const on = other.id ? other.id.replace('card-', '') : '';
          if (on && typeof flushBodySaves === 'function') flushBodySaves(on);
          other.classList.remove('is-expanded');
        });
        el.classList.add('is-expanded');
      } else {
        _pbSyncPreviewFromTextarea(el);
        if (typeof flushBodySaves === 'function') flushBodySaves(num);
        el.classList.remove('is-expanded');
      }
    });

  /* CARD-QUICK-EDIT-1: 본문 미리보기 클릭 → '장면 글 고치기' 미니모달(ui.js).
     드래그와 구분 — pointerdown 좌표를 기억해 8px 이하 이동일 때만 연다(카드 이동 임계값과 동일).
     pointerdown은 전파 유지(미리보기를 잡고 카드 드래그 가능), click만 카드로 전파 차단. */
  const bodyPreview = el.querySelector('.pb-body-preview');
  if (bodyPreview) {
    let _pvDown = null;
    bodyPreview.addEventListener('pointerdown', e => { _pvDown = { x: e.clientX, y: e.clientY }; });
    bodyPreview.addEventListener('click', e => {
      e.stopPropagation();
      if (typeof dragState !== 'undefined' && dragState) return;
      if (_pvDown) {
        const dx = e.clientX - _pvDown.x, dy = e.clientY - _pvDown.y;
        _pvDown = null;
        if (Math.sqrt(dx * dx + dy * dy) > 8) return;
      }
      if (typeof showBodyQuickEditModal === 'function') showBodyQuickEditModal(num);
    });
  }

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

  /* v43: 이미지 영역 drag&drop — 사용자가 파일 끌어놓으면 같은 이미지 업로드 파이프라인 호출 */
  const imgArea = el.querySelector('.card-image-area');
  if (imgArea) {
    /* dataTransfer.items 검사 — 이미지 파일만 hover 시각 강조 */
    const hasImageFile = dt => {
      if (!dt) return false;
      if (dt.types && Array.from(dt.types).includes('Files')) return true;
      return false;
    };
    imgArea.addEventListener('dragenter', e => {
      if (!hasImageFile(e.dataTransfer)) return;
      e.preventDefault();
      imgArea.classList.add('is-drag-over');
    });
    imgArea.addEventListener('dragover', e => {
      if (!hasImageFile(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    imgArea.addEventListener('dragleave', e => {
      /* 자식 요소 사이 이동은 무시 (relatedTarget이 imgArea 내부면) */
      if (imgArea.contains(e.relatedTarget)) return;
      imgArea.classList.remove('is-drag-over');
    });
    imgArea.addEventListener('drop', e => {
      e.preventDefault();
      imgArea.classList.remove('is-drag-over');
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (typeof _uploadImageFile === 'function') _uploadImageFile(num, file);
    });
  }

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
    /* v119: 매 RAF마다 drawArrows 박지 X — 100ms throttle 박음 (병목 1순위 fix) */
    _scheduleArrowDrawDuringDrag();
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
    /* v119: 드래그 종료 시 최종 arrow 박음 (throttle 박힌 pending 박지 X 박음) */
    _finalizeArrowDraw();
  });

  el.addEventListener('pointercancel', () => {
    if (el._deferredDrag) { el._deferredDrag.cancelled = true; el._deferredDrag = null; }
    el._pendingDrag = null;
    if (dragState && dragState.num === num) {
      if (dragState.group)
        dragState.nums.forEach(n => document.getElementById('card-'+n)?.classList.remove('group-selected'));
      el.classList.remove('dragging');
      dragState = null;
      /* v119: cancel 시도 박은 후 최종 박음 — 박힌 위치 박은 거에 맞춰 선 박힘 */
      _finalizeArrowDraw();
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
  /* BRANCH-CARD-REDESIGN-1: 그림책(비표지) 카드에 pb-mapcard 마커 — 동화 지도형 CSS 스코프. */
  const _pt4 = _resolveProjectType();
  const _mapCls = (_pt4 === 'picturebook' && s.type !== 'cover') ? ' pb-mapcard'
                : (_pt4 === 'picturebook' && s.type === 'cover') ? ' pb-cover'  /* BRANCH-COVER-CARD-REDESIGN: 그림책 표지만 스코프(text/movie 표지 불변) */
                : '';
  el.className   = `scene-card type-${s.type}${_mapCls}${roleClass ? ' ' + roleClass : ''}`;
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

/* v119: 카드 드래그 중 drawArrows 박은 거 throttle (사용자 박은 A안).
   옛엔 매 RAF(60fps)마다 전체 drawArrows 박힘 → 태블릿 프레임 박힘 (병목 1순위).
   leading + trailing throttle 100ms. 드래그 종료 시 _finalizeArrowDraw로 최종 박음.
   사용자 박은 의도: "카드가 손가락을 부드럽게 따라오는 게 우선, 선이 0.1초 늦어도 OK". */
let _arrowDrawTimer = null;
let _arrowDrawLastTime = 0;
const ARROW_DRAW_THROTTLE_MS = 100;

function _scheduleArrowDrawDuringDrag() {
  const now = performance.now();
  const elapsed = now - _arrowDrawLastTime;
  if (elapsed >= ARROW_DRAW_THROTTLE_MS) {
    /* leading edge — 즉시 박음 (drag 시작 직후 첫 박는 거 부드러움) */
    _arrowDrawLastTime = now;
    if (_arrowDrawTimer) { clearTimeout(_arrowDrawTimer); _arrowDrawTimer = null; }
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => { drawArrows(); rafId = null; });
    return;
  }
  /* trailing edge — 박힌 throttle 안 박은 추가 호출은 묶음 */
  if (_arrowDrawTimer) return;
  _arrowDrawTimer = setTimeout(() => {
    _arrowDrawTimer = null;
    _arrowDrawLastTime = performance.now();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => { drawArrows(); rafId = null; });
  }, ARROW_DRAW_THROTTLE_MS - elapsed);
}

/* 드래그 종료 시 강제 박음 — pending throttle 박지 X */
function _finalizeArrowDraw() {
  if (_arrowDrawTimer) { clearTimeout(_arrowDrawTimer); _arrowDrawTimer = null; }
  _arrowDrawLastTime = performance.now();
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => { drawArrows(); rafId = null; });
}

function drawArrows() {
  const svg = document.getElementById('arrows');
  svg.querySelectorAll('path.arrow, circle.arrow, text.arrow-label, rect.arrow-label').forEach(el => el.remove());

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
/* BRANCH-CARD-REDESIGN-4: 저채도 파스텔 동화풍 팔레트(선/노드/마커 색). 순서별 구분 유지.
   1 하늘색 · 2 코랄 · 3 세이지연두 · 4 라벤더 · 5 로즈 · 6 머스터드(이후 순환). */
const _PORT_COLORS = ['#79b0d6', '#e5977f', '#86a86a', '#a98fcf', '#cf99b0', '#d6b06a'];
/* 캡슐 글자 — 선보다 한 단계 진한 색(가독 대비) */
const _PORT_TEXT   = ['#3f6f96', '#b56550', '#5a7a44', '#6f53a0', '#9a5f76', '#8a6a2e'];
const _PORT_MARKERS = ['ahA', 'ahB', 'ahC', 'ahD', 'ahE', 'ahF'];

function drawArrowForIndex(svg, s, idx, nextNum, labelText) {
  if (!nextNum || !scenes[nextNum]) return;
  const t = scenes[nextNum];

  /* 시작 위치 — 인덱스별 y 오프셋. BRANCH-CARD-REDESIGN-4: 분기 간격 20→32(캡슐 높이 23 > 기존 20이라 겹침).
     rect/text/start dot/path 시작점 모두 이 y1 단일 기준 사용 → 동일 간격으로 분리. */
  const x1 = s.x + 200;
  const y1 = s.y + 116 + (idx * 32);
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
  path.setAttribute('stroke-width', '2.4');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('marker-end', `url(#${markerId})`);
  path.setAttribute('opacity', '0.8');
  svg.appendChild(path);

  /* BRANCH-CARD-REDESIGN-2: 출발 연결점 — 작고 둥근 컬러 원 */
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('class', 'arrow arrow-start-dot');
  dot.setAttribute('cx', x1); dot.setAttribute('cy', y1); dot.setAttribute('r', '3.4');
  dot.setAttribute('fill', color); dot.setAttribute('opacity', '0.9');
  svg.appendChild(dot);

  /* 라벨 표시 — 의미 있는 라벨만 */
  const label = String(labelText || '').trim();
  const portChar = String.fromCharCode(65 + idx);
  if (label && label !== portChar) {
    /* BRANCH-CARD-REDESIGN-2: 더 크고 읽기 쉬운 캡슐(글자↑·패딩↑·최대폭↑·12자 허용). */
    const _shown = label.length > 13 ? label.slice(0, 13) + '…' : label;
    const lx = x1 + 8, ly = y1 - 22;
    const lw = Math.min(_shown.length * 9 + 22, 138), lh = 23;

    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('class', 'arrow-label');
    bg.setAttribute('x', lx);  bg.setAttribute('y', ly);
    bg.setAttribute('width', lw); bg.setAttribute('height', lh);
    bg.setAttribute('rx', 11.5); bg.setAttribute('ry', 11.5);
    bg.setAttribute('fill', '#fffdf6');
    bg.setAttribute('stroke', color); bg.setAttribute('stroke-width', '1.4');
    svg.appendChild(bg);

    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('class', 'arrow-label');
    txt.setAttribute('x', lx + lw / 2); txt.setAttribute('y', ly + 15.5);
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('font-size', '12.5');
    txt.setAttribute('font-weight', '600');
    txt.setAttribute('fill', _PORT_TEXT[idx] || color);
    txt.textContent = _shown;
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

/* ════════════════════════════════════════════════════
   W8 Phase B-2: 좌측 사이드 — 장면 목록 동기화
   ────────────────────────────────────────────────────
   renderAll() hook으로 호출됨.
   · 목록 항목: 번호 + 제목(미정이면 본문 발췌) + 역할 배지(시작/엔딩)
   · 클릭 시: 캔버스 해당 카드로 스크롤 + .highlight 토글
   · 푸터: 시작점 / 다시 시작점 / 엔딩 수 표시

   원칙(사용자 확정): 구조 안전 — Firebase·이벤트 핸들러·4모드 분기 미접촉.
   DOM 읽기/쓰기만. scenes/projectMeta global 참조.
   ════════════════════════════════════════════════════ */
function renderSideList() {
  const list   = document.getElementById('ss-list');
  const count  = document.getElementById('ss-count');
  const fEntry  = document.getElementById('ss-foot-entry');
  const fReplay = document.getElementById('ss-foot-replay');
  const fEnding = document.getElementById('ss-foot-endings');
  if (!list) return;

  const pm = (typeof projectMeta !== 'undefined' && projectMeta) ? projectMeta : {};
  const all = (typeof scenes !== 'undefined' && scenes) ? Object.values(scenes) : [];
  /* 번호 순 정렬 */
  all.sort((a, b) => Number(a.num) - Number(b.num));

  if (count) count.textContent = `장면 ${all.length}개`;

  /* 푸터 */
  let endingCount = 0;
  let entryLabel  = '—';
  let replayLabel = '—';
  for (const s of all) {
    if (s.type === 'ending') endingCount++;
    if (pm.entrySceneId  != null && String(pm.entrySceneId)  === String(s.num)) {
      entryLabel = `${s.num}번`;
    }
    if (pm.replaySceneId != null && String(pm.replaySceneId) === String(s.num)) {
      replayLabel = `${s.num}번`;
    }
  }
  if (fEntry)  fEntry.textContent  = entryLabel;
  if (fReplay) fReplay.textContent = replayLabel;
  if (fEnding) fEnding.textContent = `${endingCount}개`;

  /* 빈 상태 */
  if (all.length === 0) {
    /* BASE10-2 / BASE10-3A: 텍스트·그림책형 빈 작품(PC)에서 "기본 틀로 시작하기" 버튼 노출.
       무비/체험형엔 표시 X. 전체 삭제 후 재생성 진입점. 클릭은 #ss-list 위임(ui.js)에서 처리. */
    const isStarter = (pm.projectType === 'text' || pm.projectType === 'picturebook');
    const tplHtml = isStarter
      ? `<button id="ss-start-template" type="button" class="ss-empty-template-btn">기본 틀로 시작하기</button>
         <div class="ss-empty-template-help">표지와 장면 1~9가 한 번에 준비돼요.<br/>내용은 나중에 자유롭게 바꿀 수 있어요.</div>`
      : '';
    list.innerHTML = `
      <div class="ss-empty">
        아직 장면이 없어요
        <div class="ss-empty-hint">＋ 새 장면으로 시작해요</div>
        ${tplHtml}
      </div>`;
    return;
  }

  /* 항목 렌더 */
  list.innerHTML = all.map(s => {
    const isEntry  = pm.entrySceneId  != null && String(pm.entrySceneId)  === String(s.num);
    const isReplay = pm.replaySceneId != null && String(pm.replaySceneId) === String(s.num);
    const isEnd    = s.type === 'ending';
    const isCover  = s.type === 'cover';   // v37: 표지 scene

    /* 표시 제목: 본문 첫 줄 또는 '(제목 없음)' */
    let titleText = '';
    /* v37: 표지는 title(작품명) 우선 — body 안 보고 */
    const titleSrc = isCover ? (s.title || '') : (s.title || s.body || '');
    if (titleSrc) {
      titleText = String(titleSrc).split('\n')[0].trim();
      if (titleText.length > 24) titleText = titleText.substring(0, 23) + '…';
    }
    /* SCENE-TITLE-1A: 일반 장면은 제목 없을 때 '(제목 없음)' 대신 '장면 N'으로(번호 중심).
       표지는 작품 제목이라 기존 문구 유지. title/body fallback(위 titleSrc)은 그대로. */
    if (!titleText) titleText = isCover ? '(작품 제목 없음)' : `장면 ${s.num}`;

    /* v37: 표지 dot 보라 톤 */
    const dotClass = isCover ? 'ss-dot--cover'
                   : isEntry ? 'ss-dot--entry'
                   : (isEnd ? 'ss-dot--ending' : '');
    /* COVER-START-1: 사이드 목록의 '시작'/'다시' 배지 표시 제거 (entry/replay 계산은 유지). */
    let badges = '';
    if (isCover) badges += '<span class="ss-badge ss-badge--cover">표지</span>';
    if (isEnd)   badges += '<span class="ss-badge ss-badge--ending">엔딩</span>';

    const num2 = String(s.num).padStart(2, '0');
    return `
      <div class="ss-item" data-scene-num="${s.num}">
        <span class="ss-dot ${dotClass}"></span>
        <span class="ss-num">${num2}</span>
        <span class="ss-name">${_escapeHtmlForSide(titleText)}</span>
        ${badges}
      </div>`;
  }).join('');

  /* 클릭 핸들러 — 사이드 항목 → 캔버스 카드 highlight + 스크롤 */
  list.querySelectorAll('.ss-item').forEach(el => {
    el.addEventListener('click', () => {
      const num = el.getAttribute('data-scene-num');
      _focusSceneInCanvas(num);
      /* 사이드 강조 토글 */
      list.querySelectorAll('.ss-item').forEach(o => o.classList.remove('is-current'));
      el.classList.add('is-current');
    });
  });
}

/* 단순 HTML escape (사이드 전용) */
function _escapeHtmlForSide(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* 캔버스에서 해당 장면 카드로 포커스 — highlight + 가능한 경우 스크롤 */
function _focusSceneInCanvas(num) {
  /* 카드 element는 sceneRenderer가 id="card-${num}" 패턴으로 생성 */
  const card = document.getElementById(`card-${num}`);
  if (!card) return;

  /* highlight 토글 — 기존 카드 highlight 제거 후 이 카드만 */
  document.querySelectorAll('.scene-card.highlight').forEach(c => {
    c.classList.remove('highlight');
  });
  card.classList.add('highlight');
  /* 일정 시간 후 자동 해제 (시안에서 강조는 일시적) */
  setTimeout(() => card.classList.remove('highlight'), 2400);

  /* 카드를 시야에 들어오게 — canvas-wrap이 overflow:hidden이라
     scrollIntoView는 무효. canvasInteraction에 centerOnCard 같은 게 있으면 호출.
     없으면 highlight만으로 알림. 사용자가 카드 못 찾으면 캔버스 드래그로 이동. */
  try {
    if (typeof centerOnCard === 'function') {
      centerOnCard(num);
    } else if (typeof panToCard === 'function') {
      panToCard(num);
    }
  } catch (e) { /* 안전망 — 시각 강조는 이미 적용됨 */ }
}

/* ════════════════════════════════════════════════════
   W8 양방향 동기화: 카드 → 사이드 (focusin 위임)
   ─────────────────────────────────────────────────────
   카드 안 input/textarea/button에 focus 들어가면 = 사용자가 그 카드 작업 시작
   → 사이드의 해당 항목에 .is-current 토글.
   document에 한 번만 등록 (capture phase로 자식 focus도 잡음).
   원칙(구조 안전): 기존 카드 이벤트 핸들러 미접촉. listener만 추가.
   ════════════════════════════════════════════════════ */
(function initBidirectionalSync() {
  if (typeof document === 'undefined') return;
  /* DOMContentLoaded 후 등록 — 본 파일이 head보다 늦게 로드되더라도 안전 */
  function attach() {
    document.addEventListener('focusin', function (e) {
      /* 가장 가까운 .scene-card 찾기 */
      const card = e.target && e.target.closest && e.target.closest('.scene-card');
      if (!card) return;
      /* 카드 id = "card-{num}". 카드 본체 id 사용 */
      const id = card.id || '';
      if (!id.startsWith('card-')) return;
      /* B(좌측 목록 제거 후): 지금 작업 중(포커스된) 카드에 지속 '현재' 강조 — "여기 있어요" 표시.
         이전엔 사이드 목록 항목(.ss-item)을 강조했으나 목록 제거로 캔버스 카드 자체를 강조. */
      const prev = document.querySelectorAll('.scene-card.is-current');
      prev.forEach(c => { if (c !== card) c.classList.remove('is-current'); });
      card.classList.add('is-current');
    }, true);  /* capture phase — input focus도 위임 */
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }
})();
