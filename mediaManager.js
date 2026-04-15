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

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;  // 5MB
const IMAGE_MAX_PX    = 800;
const IMAGE_QUALITY   = 0.75;

/* ── 이미지 압축 ── */
function compressImage(file, callback, onError) {
  const reader = new FileReader();
  reader.onerror = () => onError?.('파일 읽기 실패');
  reader.onload  = e => {
    const img    = new Image();
    img.onerror  = () => onError?.('이미지 파싱 실패');
    img.onload   = () => {
      let w = img.width, h = img.height;
      if (w > IMAGE_MAX_PX || h > IMAGE_MAX_PX) {
        if (w > h) { h = Math.round(h * IMAGE_MAX_PX / w); w = IMAGE_MAX_PX; }
        else        { w = Math.round(w * IMAGE_MAX_PX / h); h = IMAGE_MAX_PX; }
      }
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      callback(cv.toDataURL('image/jpeg', IMAGE_QUALITY));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

/* ── 이미지 업로드 ── */
async function uploadImage(num, input) {
  const file = input.files[0];
  if (!file) return;

  /* 중복 업로드 방지 */
  if (mediaState.uploading.has(num)) { input.value = ''; return; }

  /* 잠금 확보 */
  if (!await ensureEditable(num)) { input.value = ''; return; }

  /* 파일 크기 검증 */
  if (file.size > IMAGE_MAX_BYTES) {
    alert('이미지가 너무 커요. 5MB 이하 파일을 선택해주세요.');
    input.value = ''; return;
  }

  /* 파일 형식 검증 */
  if (!file.type.startsWith('image/')) {
    alert('이미지 파일만 업로드할 수 있어요.');
    input.value = ''; return;
  }

  /* 업로드 중 UI */
  mediaState.uploading.add(num);
  _showUploadingIndicator(num);

  compressImage(
    file,
    dataUrl => {
      mediaState.uploading.delete(num);
      if (!scenes[num]) return;   // 업로드 중 장면 삭제된 경우
      scenes[num].imageData = dataUrl;
      renderCard(scenes[num]);    // ui.js
      drawArrows();               // ui.js
      pushToFirebase(num);        // firebase.js
    },
    errMsg => {
      mediaState.uploading.delete(num);
      alert(`❌ 이미지 처리 실패: ${errMsg}`);
      renderCard(scenes[num]);
    }
  );
  input.value = '';
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
