/* Installation-only service worker.
   No application assets or user data are cached.
   ── 가지(branch) 운영 원칙: push=라이브. 이 SW는 PWA 설치 가능 조건(등록된 SW + scope)만 충족하고,
   HTML·JS·CSS·manifest·이미지·Firebase 응답을 절대 캐시하지 않는다(Cache Storage API 미사용).
   same-origin GET만 그대로 fetch(network-only). cross-origin/Firebase/POST는 개입하지 않는다. */

self.addEventListener('install', function () {
  /* 새 SW가 즉시 활성화되도록 — 옛 SW 대기 단계 건너뜀(오래된 동작 고정 방지). */
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  /* 활성화 즉시 모든 클라이언트 제어. 캐시 정리 단계 없음(애초에 캐시를 만들지 않음). */
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function (event) {
  var request = event.request;

  /* GET 외(POST 등)는 개입하지 않음 — Firebase 쓰기/로그인 등 그대로 통과. */
  if (request.method !== 'GET') return;

  var url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return; /* 파싱 불가 요청은 개입하지 않음 */
  }

  /* 같은 출처(GitHub Pages 서브패스 포함)가 아니면 개입하지 않음 —
     Firebase / Google API / CDN 등 cross-origin은 브라우저 기본 흐름 유지. */
  if (url.origin !== self.location.origin) return;

  /* navigation 포함 모든 same-origin GET = 항상 네트워크에서 최신 응답.
     실패해도 오래된 화면 fallback 없음(네트워크 오류를 그대로 전달). */
  event.respondWith(fetch(request));
});
