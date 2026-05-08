/* ================================================================
   preview.js — 미리보기 (플레이테스트) 모드
   의존: state.js (scenes, teamName)
   런타임 호출: openImageFull() → ui.js
   ─────────────────────────────────────────────────────────────
   v0.3 정합화 (P-A): renderPreviewScene을 모드별 분기로 재작성.
   text/picturebook/movie 장면은 viewer와 같은 .scene-screen--*
   클래스를 사용해 같은 CSS를 받음 → 감상자 시점이 viewer와 일치.
   엔딩/연결 누락 등 maker 특수 상태는 별도 처리.

   buttons[] 배열 우선 + choiceA/B fallback (1단계 동기화 패턴 동일).
   ================================================================ */

let previewHistory = [];
let previewCurrent = null;

function startPreview() {
  /* admin/분석 문구 정리 1차: entry 기준으로 미리보기 시작점 결정.
     없으면 기존 start scene fallback. 둘 다 없으면 안내. */
  const entryNum = (typeof _resolveEntryNum === 'function') ? _resolveEntryNum() : null;
  if (entryNum == null) {
    alert('첫 감상 시작점이 지정되지 않았어요.\n장면을 만들거나 [⚙ 표지·시작점]에서 지정해주세요.');
    return;
  }
  previewHistory = [];
  previewCurrent = entryNum;
  document.getElementById('preview-team-badge').textContent = '👥 ' + (teamName || '팀');
  document.getElementById('preview-overlay').style.display = 'flex';
  renderPreviewScene(previewCurrent);
}

function closePreview() {
  document.getElementById('preview-overlay').style.display = 'none';
  previewHistory = [];
  previewCurrent = null;
}

function restartPreview() {
  const entryNum = (typeof _resolveEntryNum === 'function') ? _resolveEntryNum() : null;
  if (entryNum == null) return;
  previewHistory = [];
  previewCurrent = entryNum;
  renderPreviewScene(previewCurrent);
}

function previewChoose(nextNum) {
  previewHistory.push(previewCurrent);
  previewCurrent = nextNum;
  renderPreviewScene(nextNum);
}

/* ================================================================
   buttons[] 우선 + choiceA/B fallback — viewer-data.adaptChoices와
   같은 우선순위 정책. preview는 maker scenes 객체(raw)를 직접 받으므로
   여기서 한 번 더 정규화한다.
   반환: [{ id, label, nextId(string|null), nextNum(number|null) }, ...]
   ================================================================ */
function _previewNormalizeChoices(s) {
  if (s.type === 'ending') return [];

  /* 새 구조: raw.buttons[] 우선 — 단, 라벨이 비어있고 maker가 choiceA/B를
     수정한 경우 maker 값을 신뢰 (viewer-data와 동일 정책) */
  if (Array.isArray(s.buttons) && s.buttons.length > 0) {
    return s.buttons
      .filter(b => b && typeof b === 'object')
      .map((b, i) => {
        let label = (typeof b.label === 'string') ? b.label : '';
        if (i === 0 && typeof s.choiceA === 'string' && s.choiceA !== label) label = s.choiceA;
        else if (i === 1 && typeof s.choiceB === 'string' && s.choiceB !== label) label = s.choiceB;
        const nextRaw = b.nextId
          ? Number(b.nextId)
          : (i === 0 ? s.nextA : i === 1 ? s.nextB : null);
        const nextNum = (nextRaw && scenes[nextRaw]) ? Number(nextRaw) : null;
        return {
          id: b.id || String.fromCharCode(65 + i),
          label,
          nextId: nextRaw ? String(nextRaw) : null,
          nextNum,
        };
      });
  }

  /* fallback: choiceA/B + nextA/B */
  const choices = [];
  const cnt = s.choiceCount || 2;
  if (cnt === 1) {
    if (s.nextA) {
      choices.push({
        id: 'A',
        label: s.choiceA || '다음으로 →',
        nextId: String(s.nextA),
        nextNum: scenes[s.nextA] ? Number(s.nextA) : null,
      });
    }
  } else {
    if (s.nextA || s.choiceA) {
      choices.push({
        id: 'A',
        label: s.choiceA || '선택지 A',
        nextId: s.nextA ? String(s.nextA) : null,
        nextNum: (s.nextA && scenes[s.nextA]) ? Number(s.nextA) : null,
      });
    }
    if (s.nextB || s.choiceB) {
      choices.push({
        id: 'B',
        label: s.choiceB || '선택지 B',
        nextId: s.nextB ? String(s.nextB) : null,
        nextNum: (s.nextB && scenes[s.nextB]) ? Number(s.nextB) : null,
      });
    }
  }
  return choices;
}

function _previewEscHtml(str) {
  return String(str || '').replace(/[<>&"']/g, m =>
    ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&#39;' }[m]));
}

/* preview용 choices 필터 (W2-A 잔여 정리) — viewer-render._v03FilterChoices와 동일 정책.
   라벨도 nextNum도 둘 다 비어있는 빈 버튼은 표시 안 함. */
function _previewFilterChoices(choices) {
  if (!Array.isArray(choices)) return [];
  return choices.filter(c => {
    if (!c) return false;
    const hasLabel = String(c.label || '').trim().length > 0;
    const hasNext  = !!c.nextNum;
    return hasLabel || hasNext;
  });
}

/* preview용 버튼 HTML — viewer의 .choice-v03와 같은 클래스 사용.
   미연결(nextNum=null)이면 disabled + 빨간 표시 */
function _previewBtnHtml(c, mode) {
  const label = c.label || `(${c.id} 선택지)`;
  if (c.nextNum == null) {
    return `<div class="preview-choice-warn">⚠️ "${_previewEscHtml(label)}" — 다음 장면이 연결되지 않았어요</div>`;
  }
  return `<button class="choice-v03 choice-v03--${mode} js-preview-choice"
    data-next="${c.nextNum}">
    ${_previewEscHtml(label)}
  </button>`;
}

/* ================================================================
   renderPreviewScene — 모드별 분기 (v0.3)
   ================================================================ */
function renderPreviewScene(num) {
  const s = scenes[num];
  if (!s) {
    document.getElementById('preview-card').innerHTML =
      '<div class="preview-error">⚠️ 연결된 장면을 찾을 수 없어요</div>';
    return;
  }

  const isEnding = s.type === 'ending';

  /* 엔딩은 별도 처리 — viewer 감상이 끝났을 때의 maker 결말 화면 */
  if (isEnding) {
    _renderPreviewEnding(s);
  } else {
    /* 모드 결정 — viewer와 같은 fallback (없으면 picturebook) */
    const mode = (s.presentationMode === 'text' ||
                  s.presentationMode === 'picturebook' ||
                  s.presentationMode === 'movie' ||
                  s.presentationMode === 'document')
                 ? s.presentationMode
                 : 'picturebook';
    const submode = s.presentationSubmode || null;

    if (mode === 'text') {
      _renderPreviewText(s);
    } else if (mode === 'picturebook') {
      _renderPreviewPicturebook(s, submode);
    } else if (mode === 'movie') {
      _renderPreviewMovie(s);
    } else {
      /* document / 기타 — legacy fallback (간단 카드) */
      _renderPreviewLegacy(s);
    }
  }

  /* innerHTML 설정 직후 이벤트 바인딩 */
  _bindPreviewCardEvents();

  /* 히스토리 점 표시 */
  _renderPreviewHistory(num);

  /* maker 메타 배지 (어느 장면인지 / entry/replay 등) — 모드와 무관 표시 */
  _renderPreviewMetaBadge(s);
}

/* ── TEXT 모드 미리보기 ── */
function _renderPreviewText(s) {
  const choices = _previewNormalizeChoices(s);
  const title = String(s.title || '').trim();
  const body  = String(s.body  || '').trim();
  const bgImage = s.imageData || null;

  const bgHtml = bgImage
    ? `<div class="scene-bg" style="background-image:url('${bgImage}')"></div>
       <div class="scene-bg-overlay"></div>`
    : `<div class="scene-bg-solid"></div>`;

  const titleHtml = title ? `<h3 class="text-card__title">${_previewEscHtml(title)}</h3>` : '';
  const bodyHtml  = body  ? `<p class="text-card__body">${_previewEscHtml(body)}</p>`   : '';
  const btnsHtml  = _previewFilterChoices(choices).map(c => _previewBtnHtml(c, 'text')).join('');

  document.getElementById('preview-card').innerHTML = `
    <div class="scene-screen scene-screen--text preview-stage"
      data-presentation-mode="text">
      ${bgHtml}
      <div class="scene-content scene-content--text">
        <div class="text-card" style="left:50%;top:50%;width:72%;">
          ${titleHtml}
          ${bodyHtml}
          <div class="text-card__actions">${btnsHtml}</div>
        </div>
      </div>
    </div>`;
}

/* ── PICTUREBOOK 모드 미리보기 ── */
function _renderPreviewPicturebook(s, submode) {
  const choices = _previewNormalizeChoices(s);
  const title = String(s.title || '').trim();
  const body  = String(s.body  || '').trim();
  const bgImage = s.imageData || null;
  const isLR = submode === 'spread';
  const layoutClass = isLR ? 'pb--lr' : 'pb--tb';

  const illustHtml = bgImage
    ? `<div class="pb-illust" style="background-image:url('${bgImage}')"></div>`
    : `<div class="pb-illust pb-illust--empty">
         <div class="pb-empty-mark">⌘</div>
       </div>`;

  const titleHtml = title ? `<h3 class="pb-text__title">${_previewEscHtml(title)}</h3>` : '';
  const bodyHtml  = body  ? `<p class="pb-text__body">${_previewEscHtml(body)}</p>`   : '';
  const btnsHtml  = _previewFilterChoices(choices).map(c => _previewBtnHtml(c, 'picturebook')).join('');

  document.getElementById('preview-card').innerHTML = `
    <div class="scene-screen scene-screen--pb ${layoutClass} preview-stage"
      data-presentation-mode="picturebook"
      data-presentation-submode="${isLR ? 'spread' : 'stage'}">
      <div class="pb-frame">
        ${illustHtml}
        <div class="pb-text">
          ${titleHtml}
          ${bodyHtml}
          <div class="pb-text__actions">${btnsHtml}</div>
        </div>
      </div>
    </div>`;
}

/* ── MOVIE 모드 미리보기 ── */
function _renderPreviewMovie(s) {
  const choices = _previewNormalizeChoices(s);
  const body  = String(s.body  || '').trim();
  const md = s.movieData || {};
  const poster = md.posterImage || s.imageData || null;

  const mediaInner = poster
    ? `<div class="movie-poster" style="background-image:url('${poster}')"></div>`
    : `<div class="movie-poster movie-poster--empty">
         <div class="movie-empty-mark">▶</div>
       </div>`;

  const bodyHtml = body
    ? `<p class="movie-decision__desc">${_previewEscHtml(body)}</p>` : '';

  const btnLayout = choices.length === 2 ? 'pair' : 'stack';
  const btnsHtml  = _previewFilterChoices(choices).map(c => _previewBtnHtml(c, 'movie')).join('');

  document.getElementById('preview-card').innerHTML = `
    <div class="scene-screen scene-screen--movie preview-stage"
      data-presentation-mode="movie">
      <div class="movie-media">${mediaInner}</div>
      <div class="movie-decision">
        ${bodyHtml}
        <div class="movie-decision__actions" data-btn-layout="${btnLayout}">
          ${btnsHtml}
        </div>
      </div>
    </div>`;
}

/* ── legacy 미리보기 (document 또는 모드 미지정) ── */
function _renderPreviewLegacy(s) {
  const choices = _previewNormalizeChoices(s);
  const title = String(s.title || '').trim();
  const body  = String(s.body  || '').trim();
  const bgImage = s.imageData || null;

  const titleHtml = title ? `<div class="preview-legacy-title">${_previewEscHtml(title)}</div>` : '';
  const bodyHtml  = body  ? `<div class="preview-legacy-body">${_previewEscHtml(body)}</div>`   : '';
  const imgHtml = bgImage
    ? `<div class="preview-legacy-img-wrap">
         <img src="${bgImage}" class="js-preview-img" data-num="${s.num}" title="클릭하면 크게 보기"/>
       </div>` : '';

  /* legacy 버튼은 viewer choice-v03 그대로 (기록물형도 같은 시스템 공유) */
  const btnsHtml  = _previewFilterChoices(choices).map(c => _previewBtnHtml(c, 'picturebook')).join('');

  document.getElementById('preview-card').innerHTML = `
    <div class="preview-legacy-card">
      ${imgHtml}
      ${titleHtml}
      ${bodyHtml}
      <div class="preview-legacy-actions">${btnsHtml}</div>
    </div>`;
}

/* ── 엔딩 미리보기 (모드 무관 — maker 결말 표시) ── */
function _renderPreviewEnding(s) {
  const isTrueEnd = s.trueEnding;
  const allEndings = Object.values(scenes).filter(sc => sc.type === 'ending').length;
  const title = String(s.title || '').trim();
  const body  = String(s.body  || '').trim();

  const titleHtml = title ? `<h3 class="preview-ending-title">${_previewEscHtml(title)}</h3>` : '';
  const bodyHtml  = body  ? `<p class="preview-ending-body">${_previewEscHtml(body)}</p>`   : '';

  document.getElementById('preview-card').innerHTML = `
    <div class="preview-ending-card ${isTrueEnd ? 'preview-ending-card--true' : ''}">
      <div class="preview-ending-icon">${isTrueEnd ? '🏆' : '🏁'}</div>
      <div class="preview-ending-headline">
        ${isTrueEnd ? '진엔딩 달성!' : '이야기 끝!'}
      </div>
      ${isTrueEnd
        ? `<div class="preview-ending-sub">이야기의 진짜 결말을 찾았어요!</div>`
        : (allEndings > 1
            ? `<div class="preview-ending-sub">다른 선택을 하면 다른 결말을 볼 수 있어요 (총 ${allEndings}개 결말)</div>`
            : '')}
      ${titleHtml}
      ${bodyHtml}
      <div class="preview-ending-actions">
        <button class="preview-ending-btn js-preview-restart">↺ 다시 해보기</button>
        <button class="preview-ending-btn preview-ending-btn--close js-preview-close">✏️ 수정하러 가기</button>
      </div>
    </div>`;
}

/* ── 메타 배지 (어느 장면 / entry / replay 등) ── */
function _renderPreviewMetaBadge(s) {
  const el = document.getElementById('preview-meta-badge');
  if (!el) return;  /* HTML에 없으면 무시 */
  const roles = (typeof _sceneRolesMaker === 'function')
    ? _sceneRolesMaker(s) : { isEntry: false, isReplay: false };
  let badgeColor, badgeText;
  if (roles.isEntry) {
    badgeColor = '#06d6a0'; badgeText = '🟢 첫 감상 시작';
  } else if (roles.isReplay) {
    badgeColor = '#4a90d9'; badgeText = '🔁 다시 시작점';
  } else if (s.type === 'ending' && s.trueEnding) {
    badgeColor = '#f0c000'; badgeText = '⭐ 진엔딩';
  } else if (s.type === 'ending') {
    badgeColor = '#ef476f'; badgeText = '🏁 엔딩';
  } else {
    badgeColor = '#4a90d9'; badgeText = `장면 ${s.num}`;
  }
  el.style.background = badgeColor;
  el.textContent = badgeText;
}

/* ── 히스토리 표시 ── */
function _renderPreviewHistory(num) {
  const historyEl = document.getElementById('preview-history');
  if (!historyEl) return;
  const totalHistory = [...previewHistory, num];
  historyEl.innerHTML = totalHistory.map((n, i) => {
    const sc = scenes[n];
    const isLast = i === totalHistory.length - 1;
    const scRoles = (sc && typeof _sceneRolesMaker === 'function') ? _sceneRolesMaker(sc) : { isEntry: false, isReplay: false };
    const col = sc?.type === 'ending' ? (sc?.trueEnding ? '#f0c000' : '#ef476f')
              : scRoles.isEntry  ? '#06d6a0'
              : scRoles.isReplay ? '#4a90d9'
              : '#4a90d9';
    return `<div style="width:${isLast?12:8}px;height:${isLast?12:8}px;border-radius:50%;
      background:${col};opacity:${isLast?1:0.5};transition:all .2s;"
      title="장면 ${n}"></div>`;
  }).join('<div style="width:12px;height:2px;background:rgba(255,255,255,0.2);align-self:center;"></div>');
}

/* preview-card innerHTML 설정 직후 호출 — 선택지/이미지/엔딩버튼 이벤트 바인딩 */
function _bindPreviewCardEvents() {
  const card = document.getElementById('preview-card');
  if (!card) return;

  /* 선택지 버튼 — data-next 속성으로 대상 장면 번호 전달 */
  card.querySelectorAll('.js-preview-choice').forEach(btn => {
    btn.addEventListener('click', () => previewChoose(Number(btn.dataset.next)));
  });

  /* 엔딩 화면 — 다시 해보기 / 수정하러 가기 */
  card.querySelector('.js-preview-restart')?.addEventListener('click', restartPreview);
  card.querySelector('.js-preview-close')  ?.addEventListener('click', closePreview);

  /* 이미지 크게 보기 (legacy 모드만) */
  card.querySelectorAll('.js-preview-img').forEach(img => {
    img.addEventListener('click', e => {
      e.stopPropagation();
      openImageFull(Number(img.dataset.num));
    });
  });
}
