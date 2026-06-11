/* ================================================================
   viewer-image-edit.js — 사진 크기/위치/자르기 편집
   ─────────────────────────────────────────────────────────────
   W9 (v9): 사용자 결정 — 모드 A (크기·위치) + 모드 B (자르기) 분리.
   ─────────────────────────────────────────────────────────────
   데이터 모델: scene.imageTransform = {
     posX, posY     // 0-100, 50=가운데
     scaleX, scaleY // 100=기본 (분리=stretch)
     crop: {x,y,w,h} | null  // 원본 기준 %, null=자르기 없음
   }
   ─────────────────────────────────────────────────────────────
   모드 A — 크기·위치:
     · 점선 박스 = 사진 영역(__inner) 자체에. 8 handle:
       - 모서리 4 = 균등 zoom (scaleX·Y 동시)
       - 변 4 = stretch (scaleX 또는 scaleY)
     · 본체 drag = 이동 (posX/Y)
   모드 B — 자르기:
     · 사진 위 crop 영역 직사각형 표시 (4 모서리 + 4 변 handle)
     · 잘리는 영역은 어두운 hint (dim mask)
     · handle drag = crop {x,y,w,h} 조정
   ================================================================ */

const _imgEdit = {
  active: false,
  mode: null,
  sceneNum: null,
  illustEl: null,
  photoEl: null,
  innerEl: null,
  cropHostEl: null,  // crop이 있을 때 점선/handle 박힌 inner 박스 (모드 A)
  controlsEl: null,
  cropOverlayEl: null,
  originalTransform: null,
  currentTransform: null,
};

function _defaultTransform() {
  return { posX: 50, posY: 50, scaleX: 100, scaleY: 100, crop: null };
}

function _getCurrentScene() {
  if (typeof ViewerState === 'undefined' || !ViewerState.scenes) return null;
  return ViewerState.scenes[ViewerState.currentSceneId];
}

function _enterEditCommon(mode) {
  if (_imgEdit.active) _exitImageEdit();
  const stage = document.getElementById('viewer-frame');
  if (!stage) return null;
  const illust = stage.querySelector('.pb-illust[data-pb-illust]');
  const photo  = illust ? illust.querySelector('.pb-illust__photo[data-pb-photo]') : null;
  const inner  = photo ? photo.querySelector('img.pb-illust__inner') : null;
  if (!illust || !photo || !inner) {
    alert('이 장면에 그림이 없어요.');
    return null;
  }
  const scene = _getCurrentScene();
  if (!scene) return null;

  _imgEdit.active = true;
  _imgEdit.mode = mode;
  _imgEdit.sceneNum = scene.id;
  _imgEdit.illustEl = illust;
  _imgEdit.photoEl = photo;
  _imgEdit.innerEl = inner;
  _imgEdit.originalTransform = Object.assign(_defaultTransform(), scene.imageTransform || {});
  _imgEdit.currentTransform = JSON.parse(JSON.stringify(_imgEdit.originalTransform));

  document.body.classList.add('pb-image-editing', `pb-image-editing--${mode}`);

  return { stage, illust, photo, inner, scene };
}

/* ───────── 모드 A: 크기·위치 ───────── */

function enterImageTransformEdit() {
  const ctx = _enterEditCommon('transform');
  if (!ctx) return;
  const { stage, photo } = ctx;

  /* W9 (v14): crop이 있으면 점선+handle을 잘린 영역 둘레에 박음.
     crop 없으면 wrapper 둘레. */
  const cr = _imgEdit.currentTransform.crop;
  let host = photo;  // handle이 박힐 element
  if (cr && !(cr.x === 0 && cr.y === 0 && cr.w === 100 && cr.h === 100)) {
    /* crop 영역 표시용 박스 — wrapper 안 absolute로 정확한 위치 */
    const box = document.createElement('div');
    box.className = 'pb-img-crop-host js-pb-img-crop-host';
    box.style.cssText = `
      position: absolute;
      left: ${cr.x}%;
      top: ${cr.y}%;
      width: ${cr.w}%;
      height: ${cr.h}%;
      pointer-events: auto;
    `;
    photo.appendChild(box);
    host = box;
    _imgEdit.cropHostEl = box;
  }

  /* handle을 host에 박음 — crop 있으면 잘린 영역 둘레, 없으면 wrapper 둘레 */
  ['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e'].forEach(c => {
    const h = document.createElement('div');
    h.className = `pb-img-handle pb-img-handle--${c} js-pb-img-handle`;
    h.dataset.corner = c;
    host.appendChild(h);
  });

  _appendControls(stage, 'transform');
  /* drag listener — host(crop 박스 또는 wrapper)에. 본체 클릭 시 이동 */
  host.addEventListener('pointerdown', _onTransformBodyDown);
  host.querySelectorAll('.js-pb-img-handle').forEach(h => {
    h.addEventListener('pointerdown', _onTransformHandleDown);
  });
  document.addEventListener('keydown', _onImgKeydown);
}

let _dragState = null;

function _onTransformBodyDown(e) {
  if (!_imgEdit.active || _imgEdit.mode !== 'transform') return;
  if (e.target.classList.contains('pb-img-handle')) return;
  e.preventDefault();
  const rect = _imgEdit.photoEl.getBoundingClientRect();
  _dragState = {
    kind: 'move',
    startX: e.clientX, startY: e.clientY,
    startPosX: _imgEdit.currentTransform.posX,
    startPosY: _imgEdit.currentTransform.posY,
    rectW: rect.width, rectH: rect.height,
  };
  document.addEventListener('pointermove', _onTransformMove);
  document.addEventListener('pointerup', _onTransformUp);
}

function _onTransformHandleDown(e) {
  if (!_imgEdit.active || _imgEdit.mode !== 'transform') return;
  e.preventDefault();
  e.stopPropagation();
  const corner = e.currentTarget.dataset.corner;
  const rect = _imgEdit.photoEl.getBoundingClientRect();
  const axisMap = {
    nw: 'both', ne: 'both', sw: 'both', se: 'both',
    n: 'y', s: 'y', w: 'x', e: 'x',
  };
  const dirMap = {
    nw: { x: -1, y: -1 }, ne: { x: +1, y: -1 },
    sw: { x: -1, y: +1 }, se: { x: +1, y: +1 },
    n:  { x:  0, y: -1 }, s:  { x:  0, y: +1 },
    w:  { x: -1, y:  0 }, e:  { x: +1, y:  0 },
  };
  _dragState = {
    kind: 'resize',
    startX: e.clientX, startY: e.clientY,
    startSX: _imgEdit.currentTransform.scaleX,
    startSY: _imgEdit.currentTransform.scaleY,
    rectW: rect.width, rectH: rect.height,
    axis: axisMap[corner],
    dir: dirMap[corner],
  };
  document.addEventListener('pointermove', _onTransformMove);
  document.addEventListener('pointerup', _onTransformUp);
}

function _onTransformMove(e) {
  if (!_dragState) return;
  const dx = e.clientX - _dragState.startX;
  const dy = e.clientY - _dragState.startY;

  if (_dragState.kind === 'move') {
    /* W9 (v16): 사용자 결정 A안 — visible(점선 박스)이 영역 밖으로 일부 나갈 수 있음.
       끝 = visible 중심이 영역 가장자리에 = visible 절반이 영역 안, 절반은 밖.
       clamp = ±(영역W/2) px → wrapper % 변환. */
    const illustRect = _imgEdit.illustEl.getBoundingClientRect();
    const sX = _imgEdit.currentTransform.scaleX / 100;
    const sY = _imgEdit.currentTransform.scaleY / 100;
    const photoRect = _imgEdit.photoEl.getBoundingClientRect();
    const wrapperBaseW = photoRect.width / sX;
    const wrapperBaseH = photoRect.height / sY;
    /* 영역의 절반 = 이동 가능 px */
    const halfRangeX_pct = (illustRect.width  / 2) / wrapperBaseW * 100;
    const halfRangeY_pct = (illustRect.height / 2) / wrapperBaseH * 100;
    const minX = 50 - halfRangeX_pct;
    const maxX = 50 + halfRangeX_pct;
    const minY = 50 - halfRangeY_pct;
    const maxY = 50 + halfRangeY_pct;

    const dxPct = (dx / _dragState.rectW) * 100;
    const dyPct = (dy / _dragState.rectH) * 100;
    _imgEdit.currentTransform.posX = Math.max(minX, Math.min(maxX, _dragState.startPosX + dxPct));
    _imgEdit.currentTransform.posY = Math.max(minY, Math.min(maxY, _dragState.startPosY + dyPct));
  } else if (_dragState.kind === 'resize') {
    const sX = _dragState.dir.x;
    const sY = _dragState.dir.y;
    const dW = (dx * sX) / _dragState.rectW * 200;
    const dH = (dy * sY) / _dragState.rectH * 200;
    if (_dragState.axis === 'both') {
      const avg = (dW + dH) / 2;
      _imgEdit.currentTransform.scaleX = Math.max(20, Math.min(400, _dragState.startSX + avg));
      _imgEdit.currentTransform.scaleY = Math.max(20, Math.min(400, _dragState.startSY + avg));
    } else if (_dragState.axis === 'x') {
      _imgEdit.currentTransform.scaleX = Math.max(20, Math.min(400, _dragState.startSX + dW));
    } else if (_dragState.axis === 'y') {
      _imgEdit.currentTransform.scaleY = Math.max(20, Math.min(400, _dragState.startSY + dH));
    }
  }
  _applyPreview();
}

function _onTransformUp() {
  _dragState = null;
  document.removeEventListener('pointermove', _onTransformMove);
  document.removeEventListener('pointerup', _onTransformUp);
}

/* ───────── 모드 B: 자르기 ───────── */

function enterImageCropEdit() {
  const ctx = _enterEditCommon('crop');
  if (!ctx) return;
  const { stage, photo } = ctx;

  if (!_imgEdit.currentTransform.crop) {
    _imgEdit.currentTransform.crop = { x: 0, y: 0, w: 100, h: 100 };
  }

  const overlay = document.createElement('div');
  overlay.className = 'pb-crop-overlay';
  overlay.innerHTML = `
    <div class="pb-crop-mask pb-crop-mask--top"></div>
    <div class="pb-crop-mask pb-crop-mask--right"></div>
    <div class="pb-crop-mask pb-crop-mask--bottom"></div>
    <div class="pb-crop-mask pb-crop-mask--left"></div>
    <div class="pb-crop-box js-pb-crop-box">
      ${['nw','ne','sw','se','n','s','w','e'].map(c => `
        <div class="pb-crop-handle pb-crop-handle--${c} js-pb-crop-handle" data-corner="${c}"></div>
      `).join('')}
    </div>
  `;
  /* crop overlay = photo wrapper에 박힘 (사진 둘레 위) */
  photo.appendChild(overlay);
  _imgEdit.cropOverlayEl = overlay;

  _appendControls(stage, 'crop');

  overlay.querySelector('.js-pb-crop-box').addEventListener('pointerdown', _onCropBoxDown);
  overlay.querySelectorAll('.js-pb-crop-handle').forEach(h => {
    h.addEventListener('pointerdown', _onCropHandleDown);
  });

  document.addEventListener('keydown', _onImgKeydown);
  _applyPreview();
}

function _onCropBoxDown(e) {
  if (!_imgEdit.active || _imgEdit.mode !== 'crop') return;
  if (e.target.classList.contains('pb-crop-handle')) return;
  e.preventDefault();
  e.stopPropagation();
  const rect = _imgEdit.photoEl.getBoundingClientRect();
  _dragState = {
    kind: 'crop-move',
    startX: e.clientX, startY: e.clientY,
    startCrop: { ..._imgEdit.currentTransform.crop },
    rectW: rect.width, rectH: rect.height,
  };
  document.addEventListener('pointermove', _onCropMove);
  document.addEventListener('pointerup', _onCropUp);
}

function _onCropHandleDown(e) {
  if (!_imgEdit.active || _imgEdit.mode !== 'crop') return;
  e.preventDefault();
  e.stopPropagation();
  const corner = e.currentTarget.dataset.corner;
  const rect = _imgEdit.photoEl.getBoundingClientRect();
  _dragState = {
    kind: 'crop-resize',
    corner,
    startX: e.clientX, startY: e.clientY,
    startCrop: { ..._imgEdit.currentTransform.crop },
    rectW: rect.width, rectH: rect.height,
  };
  document.addEventListener('pointermove', _onCropMove);
  document.addEventListener('pointerup', _onCropUp);
}

function _onCropMove(e) {
  if (!_dragState) return;
  const dx = e.clientX - _dragState.startX;
  const dy = e.clientY - _dragState.startY;
  const dxPct = (dx / _dragState.rectW) * 100;
  const dyPct = (dy / _dragState.rectH) * 100;
  const c = _imgEdit.currentTransform.crop;
  const s = _dragState.startCrop;

  if (_dragState.kind === 'crop-move') {
    c.x = Math.max(0, Math.min(100 - s.w, s.x + dxPct));
    c.y = Math.max(0, Math.min(100 - s.h, s.y + dyPct));
  } else if (_dragState.kind === 'crop-resize') {
    const corner = _dragState.corner;
    const minSize = 10;
    if (corner.includes('w')) {
      const newX = Math.max(0, Math.min(s.x + s.w - minSize, s.x + dxPct));
      c.w = s.w + (s.x - newX);
      c.x = newX;
    }
    if (corner.includes('e')) {
      const newW = Math.max(minSize, Math.min(100 - s.x, s.w + dxPct));
      c.w = newW;
    }
    if (corner.includes('n')) {
      const newY = Math.max(0, Math.min(s.y + s.h - minSize, s.y + dyPct));
      c.h = s.h + (s.y - newY);
      c.y = newY;
    }
    if (corner.includes('s')) {
      const newH = Math.max(minSize, Math.min(100 - s.y, s.h + dyPct));
      c.h = newH;
    }
  }
  _applyPreview();
}

function _onCropUp() {
  _dragState = null;
  document.removeEventListener('pointermove', _onCropMove);
  document.removeEventListener('pointerup', _onCropUp);
}

/* ───────── 공통 ───────── */

function _appendControls(stage, mode) {
  const ctrl = document.createElement('div');
  ctrl.className = 'pb-img-controls';
  const modeLabel = mode === 'transform' ? '🔧 크기·위치 조정 중' : '✄ 자르기 조정 중';
  /* W9 (v17): 자르기 모드 — 영역 비율에 맞춰 자르기 빠른 버튼 */
  const fitBtn = mode === 'crop'
    ? `<button type="button" class="pb-img-ctrl-btn js-pb-img-fit-area" title="영역 비율에 맞게 자르기">⬚ 화면 가득</button>`
    : '';
  ctrl.innerHTML = `
    <span class="pb-img-ctrl-mode">${modeLabel}</span>
    ${fitBtn}
    <button type="button" class="pb-img-ctrl-btn js-pb-img-reset">↺ 되돌리기</button>
    <button type="button" class="pb-img-ctrl-btn pb-img-ctrl-btn--danger js-pb-img-cancel">✕ 취소</button>
    <button type="button" class="pb-img-ctrl-btn pb-img-ctrl-btn--primary js-pb-img-save">✓ 완료</button>
  `;
  stage.appendChild(ctrl);
  _imgEdit.controlsEl = ctrl;
  ctrl.querySelector('.js-pb-img-reset').addEventListener('click', _onImgReset);
  ctrl.querySelector('.js-pb-img-cancel').addEventListener('click', _onImgCancel);
  ctrl.querySelector('.js-pb-img-save').addEventListener('click', _onImgSave);
  ctrl.querySelector('.js-pb-img-fit-area')?.addEventListener('click', _onImgFitArea);
}

/* W9 (v17): 영역 비율에 맞춰 crop 자동 설정.
   자르기 결과 = wrapper 사이즈가 영역과 같은 비율 → viewer에서 영역 가득. */
function _onImgFitArea() {
  if (!_imgEdit.active || _imgEdit.mode !== 'crop') return;
  const img = _imgEdit.innerEl;
  const illust = _imgEdit.illustEl;
  if (!img || !illust || !img.naturalWidth) return;
  const naturalRatio = img.naturalWidth / img.naturalHeight;
  const areaRatio = illust.clientWidth / illust.clientHeight;
  let w, h;
  if (naturalRatio > areaRatio) {
    /* 사진이 영역보다 wide → crop height 100%, width 좁게 */
    h = 100;
    w = (areaRatio / naturalRatio) * 100;
  } else {
    /* 사진이 영역보다 narrow → crop width 100%, height 좁게 */
    w = 100;
    h = (naturalRatio / areaRatio) * 100;
  }
  /* 가운데 정렬 */
  _imgEdit.currentTransform.crop = {
    x: (100 - w) / 2,
    y: (100 - h) / 2,
    w,
    h,
  };
  _applyPreview();
}

function _applyPreview() {
  if (!_imgEdit.photoEl || !_imgEdit.currentTransform) return;
  const t = _imgEdit.currentTransform;
  const trX = (t.posX - 50);
  const trY = (t.posY - 50);
  _imgEdit.photoEl.style.setProperty('--pb-img-x', trX + '%');
  _imgEdit.photoEl.style.setProperty('--pb-img-y', trY + '%');
  _imgEdit.photoEl.style.setProperty('--pb-img-sx', t.scaleX / 100);
  _imgEdit.photoEl.style.setProperty('--pb-img-sy', t.scaleY / 100);

  /* W9 (v12): wrapper aspect-ratio = 자연 비율 (crop 무관, 항상 동일).
     자르기 = img의 clip-path로 일부분만 가시 → 영역 사이즈 변경 X. */
  const img = _imgEdit.innerEl;
  if (img && img.naturalWidth && img.naturalHeight) {
    _imgEdit.photoEl.style.aspectRatio = String(img.naturalWidth / img.naturalHeight);
  }

  if (_imgEdit.mode === 'crop') {
    /* crop 편집 중 — img clip-path는 OFF (전체 사진 보임), 자르기 박스가 hint */
    _imgEdit.photoEl.style.setProperty('--pb-crop-x', 0);
    _imgEdit.photoEl.style.setProperty('--pb-crop-y', 0);
    _imgEdit.photoEl.style.setProperty('--pb-crop-w', 100);
    _imgEdit.photoEl.style.setProperty('--pb-crop-h', 100);

    if (_imgEdit.cropOverlayEl && t.crop) {
      const overlay = _imgEdit.cropOverlayEl;
      const box = overlay.querySelector('.js-pb-crop-box');
      const c = t.crop;
      box.style.left   = c.x + '%';
      box.style.top    = c.y + '%';
      box.style.width  = c.w + '%';
      box.style.height = c.h + '%';
      overlay.querySelector('.pb-crop-mask--top').style.cssText =
        `top:0; left:0; right:0; height:${c.y}%;`;
      overlay.querySelector('.pb-crop-mask--bottom').style.cssText =
        `top:${c.y + c.h}%; left:0; right:0; bottom:0;`;
      overlay.querySelector('.pb-crop-mask--left').style.cssText =
        `top:${c.y}%; left:0; width:${c.x}%; height:${c.h}%;`;
      overlay.querySelector('.pb-crop-mask--right').style.cssText =
        `top:${c.y}%; left:${c.x + c.w}%; right:0; height:${c.h}%;`;
    }
  } else {
    /* transform 모드 또는 기본 — crop 변수 박음 (있으면 적용) */
    if (t.crop) {
      _imgEdit.photoEl.style.setProperty('--pb-crop-x', t.crop.x);
      _imgEdit.photoEl.style.setProperty('--pb-crop-y', t.crop.y);
      _imgEdit.photoEl.style.setProperty('--pb-crop-w', t.crop.w);
      _imgEdit.photoEl.style.setProperty('--pb-crop-h', t.crop.h);
    } else {
      _imgEdit.photoEl.style.setProperty('--pb-crop-x', 0);
      _imgEdit.photoEl.style.setProperty('--pb-crop-y', 0);
      _imgEdit.photoEl.style.setProperty('--pb-crop-w', 100);
      _imgEdit.photoEl.style.setProperty('--pb-crop-h', 100);
    }
  }
}

function _exitImageEdit() {
  if (!_imgEdit.active) return;
  document.body.classList.remove('pb-image-editing', 'pb-image-editing--transform', 'pb-image-editing--crop');
  if (_imgEdit.photoEl) {
    _imgEdit.photoEl.querySelectorAll('.js-pb-img-handle').forEach(h => h.remove());
    _imgEdit.photoEl.removeEventListener('pointerdown', _onTransformBodyDown);
  }
  if (_imgEdit.cropHostEl) {
    _imgEdit.cropHostEl.removeEventListener('pointerdown', _onTransformBodyDown);
    _imgEdit.cropHostEl.remove();
  }
  if (_imgEdit.cropOverlayEl) _imgEdit.cropOverlayEl.remove();
  if (_imgEdit.controlsEl) _imgEdit.controlsEl.remove();
  document.removeEventListener('keydown', _onImgKeydown);

  _imgEdit.active = false;
  _imgEdit.mode = null;
  _imgEdit.sceneNum = null;
  _imgEdit.illustEl = null;
  _imgEdit.photoEl = null;
  _imgEdit.innerEl = null;
  _imgEdit.cropHostEl = null;
  _imgEdit.controlsEl = null;
  _imgEdit.cropOverlayEl = null;
  _imgEdit.originalTransform = null;
  _imgEdit.currentTransform = null;
}

function _onImgReset() {
  if (!_imgEdit.active) return;
  if (_imgEdit.mode === 'transform') {
    _imgEdit.currentTransform.posX = 50;
    _imgEdit.currentTransform.posY = 50;
    _imgEdit.currentTransform.scaleX = 100;
    _imgEdit.currentTransform.scaleY = 100;
  } else if (_imgEdit.mode === 'crop') {
    _imgEdit.currentTransform.crop = { x: 0, y: 0, w: 100, h: 100 };
  }
  _applyPreview();
}

function _onImgCancel() {
  if (!_imgEdit.active) return;
  _imgEdit.currentTransform = JSON.parse(JSON.stringify(_imgEdit.originalTransform));
  _applyPreview();
  _exitImageEdit();
  if (typeof renderCurrentScene === 'function') renderCurrentScene();
}

async function _onImgSave() {
  if (!_imgEdit.active) return;
  const sceneNum = _imgEdit.sceneNum;
  const t = _imgEdit.currentTransform;

  const transform = {
    posX:   Math.round(t.posX),
    posY:   Math.round(t.posY),
    scaleX: Math.round(t.scaleX),
    scaleY: Math.round(t.scaleY),
  };
  if (t.crop) {
    transform.crop = {
      x: Math.round(t.crop.x),
      y: Math.round(t.crop.y),
      w: Math.round(t.crop.w),
      h: Math.round(t.crop.h),
    };
    if (transform.crop.x === 0 && transform.crop.y === 0 &&
        transform.crop.w === 100 && transform.crop.h === 100) {
      delete transform.crop;
    }
  }

  const isAllDefault = transform.posX === 50 && transform.posY === 50 &&
                       transform.scaleX === 100 && transform.scaleY === 100 &&
                       !transform.crop;

  if (typeof ViewerState !== 'undefined' && ViewerState.scenes) {
    const scene = ViewerState.scenes[sceneNum];
    if (scene) {
      if (isAllDefault) delete scene.imageTransform;
      else scene.imageTransform = transform;
    }
  }

  try {
    const teamName = ViewerState.project.teamName;
    const classId  = ViewerState.project.classId;
    if (teamName && typeof getViewerDb === 'function') {
      const encodedName = encodeURIComponent(teamName);
      const basePath = classId
        ? `classes/${classId}/teams/${encodedName}`
        : `teams/${encodedName}`;
      await getViewerDb().ref(`${basePath}/scenes/${sceneNum}/imageTransform`)
        .set(isAllDefault ? null : transform);
    }
  } catch (err) {
    console.error('[imageTransform] 저장 실패:', err);
    alert('저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }

  _exitImageEdit();
  if (typeof renderCurrentScene === 'function') renderCurrentScene();
}

function _onImgKeydown(e) {
  if (!_imgEdit.active) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    _onImgCancel();
  } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    _onImgSave();
  }
}

if (typeof window !== 'undefined') {
  window.enterImageTransformEdit = enterImageTransformEdit;
  window.enterImageCropEdit = enterImageCropEdit;
}
