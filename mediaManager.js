/* ================================================================
   mediaManager.js — 이미지 업로드 / 모달 / 삭제
   의존: state.js (scenes), locks.js (ensureEditable), firebase.js (pushToFirebase)
   런타임 호출: renderCard() → ui.js, drawArrows() → ui.js

   개선 사항:
   - 업로드 상태를 scenes[num].imageUploading 단일 플래그 대신
     mediaState 객체로 중앙 관리
   - 실패 처리 강화 (파일 형식 검증, 압축 실패 처리)
   ================================================================ */

const mediaState = {
  uploading: new Set(),   // 현재 업로드 중인 scene num 집합
};

/* ================================================================
   이미지 업로드 정책 (구조 개편 1차 — 자동 압축)
   ─────────────────────────────────────────────────────────────
   · 5MB 이하: 원본 그대로 업로드 (품질 보존)
   · 5MB 초과: 브라우저 canvas로 자동 압축 시도
       - 긴 변 최대 1920px
       - JPEG 품질 0.82로 시작
       - 투명 PNG는 PNG 유지 시도 → 실패 시 JPEG fallback
   · 자동 압축 후에도 5MB 초과 시에만 에러
   ================================================================ */
const IMAGE_SOFT_LIMIT_BYTES = 5 * 1024 * 1024;   // 5MB — 원본 업로드 허용 한계
const IMAGE_MAX_DIMENSION    = 1920;              // 압축 시 긴 변 최대
const IMAGE_JPEG_QUALITY     = 0.82;              // 압축 품질

/* ── 파일을 dataURL로 변환 (압축 없음) ── */
function _readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.onload  = e => resolve(e.target.result);
    reader.readAsDataURL(file);
  });
}

/* ── 이미지 canvas 압축 ──
   긴 변 maxDimension 이하로 축소 + 선택한 포맷으로 인코딩.
   transparent=true면 PNG 유지 시도 (알파 보존), 아니면 JPEG. */
function _compressImageDataURL(dataUrl, { maxDimension = IMAGE_MAX_DIMENSION, transparent = false, quality = IMAGE_JPEG_QUALITY }) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('이미지 파싱 실패'));
    img.onload  = () => {
      let w = img.width, h = img.height;
      if (w > maxDimension || h > maxDimension) {
        if (w > h) { h = Math.round(h * maxDimension / w); w = maxDimension; }
        else       { w = Math.round(w * maxDimension / h); h = maxDimension; }
      }
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const mime = transparent ? 'image/png' : 'image/jpeg';
      try {
        resolve(cv.toDataURL(mime, quality));
      } catch (e) {
        reject(e);
      }
    };
    img.src = dataUrl;
  });
}

/* ── dataURL 바이트 크기 추정 (base64 → bytes) ── */
function _estimateDataUrlBytes(dataUrl) {
  /* 'data:image/xxx;base64,' 헤더 제외 후 base64 길이 × 3/4 */
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) return dataUrl.length;
  const base64Len = dataUrl.length - commaIdx - 1;
  return Math.round(base64Len * 0.75);
}

/* ================================================================
   공통 유틸: 파일 → (필요 시 압축된) dataURL
   프로젝트 설정 UI 등 uploadImage 외 다른 경로에서도 동일 정책 적용
   ─────────────────────────────────────────────────────────────
   · 비이미지 → throw
   · 5MB 이하 → 원본 dataURL
   · 5MB 초과 → 1920px + JPEG 0.82, 필요시 해상도 단계 축소
   · 최종 한계 초과 시 throw
   ================================================================ */
async function compressFileForUpload(file) {
  if (!file) throw new Error('파일이 없어요');
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 업로드할 수 있어요');

  const origDataUrl   = await _readFileAsDataURL(file);
  const isTransparent = file.type === 'image/png' || file.type === 'image/webp';

  if (file.size <= IMAGE_SOFT_LIMIT_BYTES) return origDataUrl;

  let finalDataUrl;
  try {
    finalDataUrl = await _compressImageDataURL(origDataUrl, {
      maxDimension: IMAGE_MAX_DIMENSION,
      transparent:  isTransparent,
      quality:      IMAGE_JPEG_QUALITY,
    });
  } catch {
    finalDataUrl = await _compressImageDataURL(origDataUrl, {
      maxDimension: IMAGE_MAX_DIMENSION, transparent: false, quality: IMAGE_JPEG_QUALITY,
    });
  }
  if (isTransparent && _estimateDataUrlBytes(finalDataUrl) > IMAGE_SOFT_LIMIT_BYTES) {
    finalDataUrl = await _compressImageDataURL(origDataUrl, {
      maxDimension: IMAGE_MAX_DIMENSION, transparent: false, quality: IMAGE_JPEG_QUALITY,
    });
  }
  let tryDim = 1440;
  while (_estimateDataUrlBytes(finalDataUrl) > IMAGE_SOFT_LIMIT_BYTES && tryDim >= 1024) {
    finalDataUrl = await _compressImageDataURL(origDataUrl, {
      maxDimension: tryDim, transparent: false, quality: IMAGE_JPEG_QUALITY,
    });
    tryDim -= 256;
  }
  if (_estimateDataUrlBytes(finalDataUrl) > IMAGE_SOFT_LIMIT_BYTES) {
    throw new Error('이미지가 너무 커요. 작은 파일을 써 주세요');
  }
  return finalDataUrl;
}

/* ── 이미지 업로드 (자동 압축 지원) ──
   v43: file 객체와 file input 두 진입점 공용 처리. drag&drop도 같은 파이프라인. */
async function uploadImage(num, input) {
  const file = input?.files?.[0];
  await _uploadImageFile(num, file);
  if (input) input.value = '';
}

async function _uploadImageFile(num, file) {
  if (!file) return;

  /* 중복 업로드 방지 */
  if (mediaState.uploading.has(num)) return;

  /* 파일 형식 검증 */
  if (!file.type || !file.type.startsWith('image/')) {
    alert('이미지 파일만 올릴 수 있어요.');
    return;
  }

  /* 잠금 확보 */
  if (!await ensureEditable(num)) return;

  /* 업로드 중 UI */
  mediaState.uploading.add(num);
  _showUploadingIndicator(num);

  try {
    const origDataUrl = await _readFileAsDataURL(file);
    const isTransparent = file.type === 'image/png' || file.type === 'image/webp';

    let finalDataUrl;

    if (file.size <= IMAGE_SOFT_LIMIT_BYTES) {
      /* 5MB 이하: 원본 그대로 */
      finalDataUrl = origDataUrl;
    } else {
      /* 5MB 초과: 자동 압축 시도 */
      /* 1차: 포맷 유지 (PNG면 PNG, 아니면 JPEG) */
      try {
        finalDataUrl = await _compressImageDataURL(origDataUrl, {
          maxDimension: IMAGE_MAX_DIMENSION,
          transparent:  isTransparent,
          quality:      IMAGE_JPEG_QUALITY,
        });
      } catch (e) {
        /* 첫 압축 실패 시 JPEG fallback */
        finalDataUrl = await _compressImageDataURL(origDataUrl, {
          maxDimension: IMAGE_MAX_DIMENSION,
          transparent:  false,
          quality:      IMAGE_JPEG_QUALITY,
        });
      }

      /* PNG가 여전히 크면 JPEG로 재시도 */
      if (isTransparent && _estimateDataUrlBytes(finalDataUrl) > IMAGE_SOFT_LIMIT_BYTES) {
        finalDataUrl = await _compressImageDataURL(origDataUrl, {
          maxDimension: IMAGE_MAX_DIMENSION,
          transparent:  false,
          quality:      IMAGE_JPEG_QUALITY,
        });
      }

      /* 그래도 크면 해상도 더 축소하며 재시도 (최대 2회) */
      let tryDim = 1440;
      while (_estimateDataUrlBytes(finalDataUrl) > IMAGE_SOFT_LIMIT_BYTES && tryDim >= 1024) {
        finalDataUrl = await _compressImageDataURL(origDataUrl, {
          maxDimension: tryDim,
          transparent:  false,
          quality:      IMAGE_JPEG_QUALITY,
        });
        tryDim -= 256;
      }

      if (_estimateDataUrlBytes(finalDataUrl) > IMAGE_SOFT_LIMIT_BYTES) {
        throw new Error('이미지가 너무 커요. 작은 파일을 써 주세요.');
      }
    }

    /* v114: base64 → Firebase Storage 업로드 후 URL 저장.
       옛 흐름: scenes[num].imageData = base64 (RTDB에 통째 저장 → 폭탄)
       신규: Storage 업로드 후 URL만 RTDB에 저장. v113 마이그와 같은 흐름.
       Storage 실패 시 alert + 진행 중단 (옛 base64 저장 X — 폭탄 재발 차단). */
    let imageUrl;
    try {
      if (typeof uploadImageToStorage !== 'function') {
        throw new Error('이미지 업로드 함수를 찾을 수 없어요. 새로고침 후 다시 시도해주세요.');
      }
      const r = await uploadImageToStorage(finalDataUrl, num);
      imageUrl = r.downloadURL;
    } catch (e) {
      console.error('[mediaManager] 이미지 업로드 실패:', e);
      mediaState.uploading.delete(num);
      alert('❌ 이미지를 올리지 못했어요. 잠시 후 다시 시도해 주세요.');
      if (scenes[num]) renderCard(scenes[num]);
      return;
    }

    /* 저장 */
    mediaState.uploading.delete(num);
    if (!scenes[num]) return;   // 업로드 중 장면 삭제된 경우
    scenes[num].imageData = imageUrl;
    renderCard(scenes[num]);
    drawArrows();
    pushToFirebase(num);
  } catch (err) {
    console.error('[mediaManager] 이미지 처리 실패:', err);
    mediaState.uploading.delete(num);
    alert('❌ 이미지를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
    if (scenes[num]) renderCard(scenes[num]);
  }
}

function _showUploadingIndicator(num) {
  const card    = document.getElementById('card-' + num);
  const imgArea = card?.querySelector('.card-image-area');
  if (imgArea) {
    imgArea.innerHTML = '<div style="text-align:center;padding:8px 0;font-size:11px;color:var(--muted);">⏳ 이미지 처리 중...</div>';
  }
}

/* ── 이미지 삭제 ── */
async function removeImage(num) {
  if (!await ensureEditable(num)) return;
  delete scenes[num].imageData;
  renderCard(scenes[num]);    // ui.js
  drawArrows();               // ui.js
  pushToFirebase(num);        // firebase.js
}

/* ── 이미지 전체화면 모달 ── */
function openImageFull(num) {
  const s = scenes[num];
  if (!s?.imageData) return;
  document.getElementById('img-modal-src').src = s.imageData;
  document.getElementById('img-modal').style.display = 'flex';
}

function closeImageModal() {
  document.getElementById('img-modal').style.display = 'none';
  document.getElementById('img-modal-src').src = '';
}

/* 모달 외부 클릭 / ESC 닫기 — DOMContentLoaded 후 실행 */
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('img-modal').addEventListener('click', e => {
    if (e.target.id === 'img-modal') closeImageModal();
  });
});
