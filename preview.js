/* ================================================================
   preview.js — 미리보기 (플레이테스트) 모드
   의존: state.js (scenes, teamName)
   런타임 호출: openImageFull() → ui.js
   ================================================================ */

let previewHistory = [];
let previewCurrent = null;

function startPreview() {
  const starts = Object.values(scenes).filter(s => s.type === 'start');
  if (!starts.length) {
    alert('시작 장면이 없어요! 시작 장면을 하나 만들어주세요.');
    return;
  }
  previewHistory = [];
  previewCurrent = starts[0].num;
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
  const starts = Object.values(scenes).filter(s => s.type === 'start');
  if (!starts.length) return;
  previewHistory = [];
  previewCurrent = starts[0].num;
  renderPreviewScene(previewCurrent);
}

function previewChoose(nextNum) {
  previewHistory.push(previewCurrent);
  previewCurrent = nextNum;
  renderPreviewScene(nextNum);
}

function renderPreviewScene(num) {
  const s = scenes[num];
  if (!s) {
    document.getElementById('preview-card').innerHTML =
      '<div style="color:#ff8080;font-family:var(--font-h);font-size:18px;text-align:center;">⚠️ 연결된 장면을 찾을 수 없어요</div>';
    return;
  }

  const isStart   = s.type === 'start';
  const isEnding  = s.type === 'ending';
  const isTrueEnd = isEnding && s.trueEnding;

  const badgeColor = isStart ? '#06d6a0' : isTrueEnd ? '#f0c000' : isEnding ? '#ef476f' : '#4a90d9';
  const badgeText  = isStart ? '🟢 시작' : isTrueEnd ? '⭐ 진엔딩' : isEnding ? '🏁 엔딩' : `장면 ${s.num}`;

  const cardBg = isTrueEnd
    ? 'linear-gradient(135deg,#3a2800,#5a4000)'
    : isEnding
    ? 'linear-gradient(135deg,#2a0a1a,#400a2a)'
    : 'linear-gradient(135deg,#0d1f3c,#1a2e50)';

  const cardBorder = isTrueEnd ? '#f0c000' : isEnding ? '#ef476f' : isStart ? '#06d6a0' : '#4a90d9';

  /* 선택지 버튼 */
  let choicesHtml = '';
  if (!isEnding) {
    const cnt = s.choiceCount || 2;
    if (cnt === 1) {
      const hasNext = s.nextA && scenes[s.nextA];
      choicesHtml = hasNext
        ? `<button class="preview-choice-btn js-preview-choice" data-next="${s.nextA}"
            style="background:rgba(74,144,217,0.3);border-color:#4a90d9;color:#90c0ff;">
            ${s.choiceA || '다음으로 →'}
          </button>`
        : `<div style="color:#ff8080;font-size:13px;text-align:center;">⚠️ 다음 장면이 연결되지 않았어요</div>`;
    } else {
      const hasA = s.nextA && scenes[s.nextA];
      const hasB = s.nextB && scenes[s.nextB];
      choicesHtml = `
        ${hasA
          ? `<button class="preview-choice-btn js-preview-choice" data-next="${s.nextA}"
              style="background:rgba(74,144,217,0.25);border-color:#4a90d9;color:#90c0ff;">
              ${s.choiceA || '선택지 A'}
            </button>`
          : `<div style="color:#ff8080;font-size:12px;text-align:center;">⚠️ A 연결 없음</div>`}
        ${hasB
          ? `<button class="preview-choice-btn js-preview-choice" data-next="${s.nextB}"
              style="background:rgba(239,71,111,0.25);border-color:#ef476f;color:#ff9090;">
              ${s.choiceB || '선택지 B'}
            </button>`
          : `<div style="color:#ff8080;font-size:12px;text-align:center;">⚠️ B 연결 없음</div>`}`;
    }
  }

  /* 엔딩 버튼 */
  let endingHtml = '';
  if (isEnding) {
    const allEndings = Object.values(scenes).filter(sc => sc.type === 'ending').length;
    endingHtml = `
      <div style="text-align:center;margin-top:16px;">
        ${isTrueEnd
          ? `<div style="font-size:32px;margin-bottom:8px;">🏆</div>
             <div style="font-family:var(--font-h);font-size:18px;color:#f0c000;margin-bottom:4px;">진엔딩 달성!</div>
             <div style="font-size:13px;color:#c0a040;margin-bottom:20px;">이야기의 진짜 결말을 찾았어요!</div>`
          : `<div style="font-size:32px;margin-bottom:8px;">🏁</div>
             <div style="font-family:var(--font-h);font-size:16px;color:#ef8080;margin-bottom:4px;">이야기 끝!</div>
             ${allEndings > 1
               ? `<div style="font-size:12px;color:#c09090;margin-bottom:20px;">다른 선택을 하면 다른 결말을 볼 수 있어요 (총 ${allEndings}개 결말)</div>`
               : '<div style="margin-bottom:20px;"></div>'}`
        }
        <div style="display:flex;gap:10px;justify-content:center;">
          <button class="js-preview-restart"
            style="padding:10px 20px;border-radius:50px;border:2px solid #80c0ff;
            background:rgba(255,255,255,0.1);color:#80c0ff;
            font-family:var(--font-h);font-size:15px;cursor:pointer;">
            ↺ 다시 해보기
          </button>
          <button class="js-preview-close"
            style="padding:10px 20px;border-radius:50px;border:2px solid #80ff80;
            background:rgba(255,255,255,0.1);color:#80ff80;
            font-family:var(--font-h);font-size:15px;cursor:pointer;">
            ✏️ 수정하러 가기
          </button>
        </div>
      </div>`;
  }

  document.getElementById('preview-card').innerHTML = `
    <div style="background:${cardBg};border:2px solid ${cardBorder};border-radius:20px;
      padding:28px 28px 24px;box-shadow:0 8px 40px rgba(0,0,0,0.5);">
      <div style="margin-bottom:16px;">
        <span style="font-family:var(--font-h);font-size:13px;color:#fff;
          background:${badgeColor};padding:4px 12px;border-radius:50px;">
          ${badgeText}
        </span>
      </div>
      ${s.imageData ? `<div style="margin-bottom:16px;background:rgba(0,0,0,0.25);border-radius:12px;
        display:flex;align-items:center;justify-content:center;max-height:300px;overflow:hidden;">
        <img src="${s.imageData}" class="js-preview-img" data-num="${s.num}"
          style="max-width:100%;max-height:300px;object-fit:contain;border-radius:12px;display:block;cursor:zoom-in;"
          title="클릭하면 크게 보기"/>
      </div>` : ''}
      <div style="font-family:var(--font-b);font-size:18px;color:#e8f0ff;
        line-height:1.8;${s.imageData ? 'min-height:40px' : 'min-height:80px'};white-space:pre-wrap;margin-bottom:24px;">
        ${s.title || '<span style="color:#5a7090;font-style:italic;">내용이 없어요</span>'}
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${choicesHtml}
      </div>
      ${endingHtml}
    </div>`;

  /* innerHTML 설정 직후 이벤트 바인딩 — 동적 onclick 없이 처리 */
  _bindPreviewCardEvents();

  /* 히스토리 점 표시 */
  const historyEl = document.getElementById('preview-history');
  const totalHistory = [...previewHistory, num];
  historyEl.innerHTML = totalHistory.map((n, i) => {
    const sc = scenes[n];
    const isLast = i === totalHistory.length - 1;
    const col = sc?.type === 'ending' ? (sc?.trueEnding ? '#f0c000' : '#ef476f')
              : sc?.type === 'start'  ? '#06d6a0' : '#4a90d9';
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

  /* 이미지 크게 보기 */
  card.querySelectorAll('.js-preview-img').forEach(img => {
    img.addEventListener('click', e => {
      e.stopPropagation();
      openImageFull(Number(img.dataset.num));
    });
  });
}
