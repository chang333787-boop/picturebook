/* ================================================================
   preview.js — PREVIEW-RETIRE(2026-07-12) 호환 스텁
   ─────────────────────────────────────────────────────────────
   미리보기 오버레이는 W7 통합으로 진입점이 사라져 제거됨.
   새 maker.html은 이 파일을 로드하지 않는다.
   이 스텁은 "구 maker.html(캐시) + 구 ui.js(캐시)" 조합이
   preview.js를 새로 받아갈 때 ReferenceError(restartPreview 등
   바인딩 실패 → 편집기 초기화 중단)를 막기 위한 것.
   구 캐시가 자연 소멸한 뒤(다음 대형 배포 즈음) 파일째 삭제 가능.
   ================================================================ */

function startPreview() {}
function restartPreview() {}
function closePreview() {
  /* 구 maker.html에는 #preview-overlay가 남아 있으므로 숨김만 유지 */
  const el = document.getElementById('preview-overlay');
  if (el) el.style.display = 'none';
}
