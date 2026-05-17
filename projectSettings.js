/* ================================================================
   projectSettings.js — 프로젝트 설정 UI (표지 / 시작점)
   ─────────────────────────────────────────────────────────────
   담당:
   · 표지 제목
   · 표지 이미지 (업로드/제거)
   · 첫 감상 시작 장면 (entrySceneId)
   · 다시 하기 시작 장면 (replaySceneId)

   저장 위치: viewer-meta 노드 (firebase.js의 pushProjectMetaToFirebase)
   기본값 계산: viewer-data.js의 _migrateCoverAndEntryDefaults와 같은 논리
     — 기존 start scene의 title/imageData/번호 기준
   의존: state.js (scenes, projectMeta), firebase.js (pushProjectMetaToFirebase),
         mediaManager.js (compressFileForUpload)
   ================================================================ */

/* ── 기본값 계산 — viewer 마이그레이션과 동일 논리 ────────────────
   projectMeta의 null 필드를 start scene 기준으로 임시 채움 (UI 표시용).
   DB 쓰기 X — 사용자가 '저장'을 누르면 그때 projectMeta → Firebase. */
function _resolveProjectDefaults() {
  const pm     = projectMeta || {};
  const all    = Object.values(scenes);
  /* start scene = type === 'start' 우선, 없으면 첫 번째 scene (id 오름차순) */
  const start  = all.find(s => s.type === 'start')
              || all.slice().sort((a, b) => Number(a.num) - Number(b.num))[0]
              || null;

  const entry  = pm.entrySceneId
              || (start ? String(start.num) : null);
  const replay = pm.replaySceneId
              || entry;
  const title  = (pm.coverTitle !== null && pm.coverTitle !== undefined)
              ? pm.coverTitle
              : (start ? (start.title || '') : '');
  const img    = (pm.coverImageData !== null && pm.coverImageData !== undefined)
              ? pm.coverImageData
              : (start ? (start.imageData || null) : null);

  return { entry, replay, title, img };
}

/* ── 장면 select 옵션 HTML 생성 ─────────────────────────────── */
function _sceneSelectOptions(selectedId) {
  const all = Object.values(scenes).sort((a, b) => Number(a.num) - Number(b.num));
  if (all.length === 0) return '<option value="">(장면이 없어요)</option>';
  return all.map(s => {
    const sel   = String(s.num) === String(selectedId) ? 'selected' : '';
    const label = s.title ? `${s.num} · ${s.title}` : `장면 ${s.num}`;
    return `<option value="${s.num}" ${sel}>${_escHtml(label)}</option>`;
  }).join('');
}

function _escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ── 패널 열기 ────────────────────────────────────────────── */
function openProjectSettings() {
  const panel = document.getElementById('project-settings-panel');
  if (!panel) return;
  _fillProjectSettingsFields();
  panel.style.display = 'flex';
}

/* ── 패널 닫기 ────────────────────────────────────────────── */
function closeProjectSettings() {
  const panel = document.getElementById('project-settings-panel');
  if (panel) panel.style.display = 'none';
}

/* ── 패널 값 다시 채우기 (외부에서 projectMeta 바뀐 경우 등) ── */
function refreshProjectSettingsIfOpen() {
  const panel = document.getElementById('project-settings-panel');
  if (!panel || panel.style.display === 'none') return;
  _fillProjectSettingsFields();
}

function _fillProjectSettingsFields() {
  const d = _resolveProjectDefaults();
  const titleEl  = document.getElementById('ps-cover-title');
  const entryEl  = document.getElementById('ps-entry-select');
  const replayEl = document.getElementById('ps-replay-select');
  const imgEl    = document.getElementById('ps-cover-preview');
  const imgEmpty = document.getElementById('ps-cover-empty');
  const removeBtn= document.getElementById('ps-cover-remove');

  if (titleEl)  titleEl.value = d.title || '';
  if (entryEl)  entryEl.innerHTML  = _sceneSelectOptions(d.entry);
  if (replayEl) replayEl.innerHTML = _sceneSelectOptions(d.replay);

  if (imgEl && imgEmpty) {
    if (d.img) {
      imgEl.src = d.img;
      imgEl.style.display = 'block';
      imgEmpty.style.display = 'none';
      if (removeBtn) removeBtn.style.display = 'inline-block';
    } else {
      imgEl.style.display = 'none';
      imgEl.src = '';
      imgEmpty.style.display = 'flex';
      if (removeBtn) removeBtn.style.display = 'none';
    }
  }
}

/* ── 표지 이미지 업로드 ──────────────────────────────────── */
async function handleCoverImageUpload(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const preview = document.getElementById('ps-cover-preview');
  const empty   = document.getElementById('ps-cover-empty');
  const removeBtn = document.getElementById('ps-cover-remove');

  /* 처리 중 표시 */
  if (empty) empty.textContent = '⏳ 이미지 처리 중...';

  try {
    if (typeof compressFileForUpload !== 'function') {
      throw new Error('업로드 유틸을 사용할 수 없어요');
    }
    const dataUrl = await compressFileForUpload(file);
    /* v114: 표지도 Storage 업로드 후 URL 박음. base64로 viewer-meta에 박으면 폭탄.
       sceneNum 대신 '_cover'로 박음 — _imageStoragePath가 그대로 박힘. */
    let coverUrl;
    try {
      const r = await uploadImageToStorage(dataUrl, '_cover');
      coverUrl = r.downloadURL;
    } catch (e) {
      throw new Error(`표지 업로드 실패: ${e.message || e}`);
    }
    /* 미리보기 즉시 갱신 (로컬 projectMeta는 저장 버튼 누를 때 확정) */
    projectMeta.coverImageData = coverUrl;
    if (preview) {
      preview.src = coverUrl;
      preview.style.display = 'block';
    }
    if (empty) { empty.style.display = 'none'; }
    if (removeBtn) removeBtn.style.display = 'inline-block';
    /* 즉시 저장 — 이미지는 양이 크고, 업로드 후 잃으면 곤란 */
    await pushProjectMetaToFirebase({ coverImageData: coverUrl });
  } catch (err) {
    alert(`❌ 이미지 업로드 실패: ${err.message || err}`);
    if (empty) { empty.style.display = 'flex'; empty.textContent = '표지 이미지 없음'; }
  }
  input.value = '';
}

/* ── 표지 이미지 제거 ──────────────────────────────────── */
async function removeCoverImage() {
  if (!confirm('표지 이미지를 제거할까요?')) return;
  projectMeta.coverImageData = null;
  const preview = document.getElementById('ps-cover-preview');
  const empty   = document.getElementById('ps-cover-empty');
  const removeBtn = document.getElementById('ps-cover-remove');
  if (preview) { preview.style.display = 'none'; preview.src = ''; }
  if (empty)   { empty.style.display = 'flex'; empty.textContent = '표지 이미지 없음'; }
  if (removeBtn) removeBtn.style.display = 'none';
  try {
    await pushProjectMetaToFirebase({ coverImageData: null });
  } catch (err) {
    alert(`❌ 저장 실패: ${err.message || err}`);
  }
}

/* ── 설정 저장 — 제목/entry/replay만 ──────────────────────── */
async function saveProjectSettings() {
  const titleEl  = document.getElementById('ps-cover-title');
  const entryEl  = document.getElementById('ps-entry-select');
  const replayEl = document.getElementById('ps-replay-select');

  const coverTitle    = titleEl  ? titleEl.value.trim() : '';
  const entrySceneId  = entryEl  ? entryEl.value  : '';
  const replaySceneId = replayEl ? replayEl.value : '';

  /* 유효성 — 선택된 장면이 실제 존재해야 함 */
  if (entrySceneId && !scenes[entrySceneId]) {
    alert('첫 감상 시작 장면이 유효하지 않아요.');
    return;
  }
  if (replaySceneId && !scenes[replaySceneId]) {
    alert('다시 하기 시작 장면이 유효하지 않아요.');
    return;
  }

  /* 로컬 캐시 업데이트 (coverImageData는 이미 업로드 시점에 저장됨) */
  projectMeta.coverTitle    = coverTitle;
  projectMeta.entrySceneId  = entrySceneId  || null;
  projectMeta.replaySceneId = replaySceneId || null;

  try {
    await pushProjectMetaToFirebase({
      coverTitle:    coverTitle,
      entrySceneId:  entrySceneId  || null,
      replaySceneId: replaySceneId || null,
    });
    closeProjectSettings();
  } catch (err) {
    alert(`❌ 저장 실패: ${err.message || err}`);
  }
}

/* 외부 노출 (ui.js / firebase.js에서 호출) */
window.openProjectSettings         = openProjectSettings;
window.closeProjectSettings        = closeProjectSettings;
window.refreshProjectSettingsIfOpen = refreshProjectSettingsIfOpen;
window.handleCoverImageUpload      = handleCoverImageUpload;
window.removeCoverImage            = removeCoverImage;
window.saveProjectSettings         = saveProjectSettings;
