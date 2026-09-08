/* ════════════════════════════════════════════════════════════════
   shelf-cover.js — SHELF-COVER-1(2026-09-07): 학급 책장 카드의 '표지 그림' 결정(순수·서버 전용).
   ─────────────────────────────────────────────────────────────────
   사용자 결정(09-07): 책장 카드를 AI 그림 규격(3:2) 가로형(C-1)으로 바꾸고, 표지에 작품의 '첫 그림'을 넣는다.
   어떤 그림을 쓸지는 **감상 화면이 보여주는 것과 같아야** 한다(책장에서 본 그림 = 책을 열면 첫 장면).
   그래서 규칙은 viewer-data.js getPublishedImageDisplaySrc + viewer-ai.js _publishLockMode/_lv3DefaultViewMode를
   서버에서 그대로 옮긴 것이다(클라 규칙이 바뀌면 여기도 같이 — tests/shelf-cover가 대칭 가드).

   규칙(우선순위 순):
   ① 장면 순서: type 'cover' 제외. type 'start' 장면을 먼저, 그다음 num 오름차순. 그림 없는 장면은 건너뜀.
   ② 장면당 후보: 원화 = scene.imageData → imageUrl 중 http(s) URL만(base64 data:는 카드에 못 넣으므로 제외).
                  AI  = aiVariants/image[num].s2 — url 있고 stale 아닌 것만.
   ③ 선택:
      · 그림책 1·2단계: AI 있으면 AI, 없으면 원화(1단계는 원화 슬롯이 비어 있어 AI 없으면 = 그림 없음).
        → "AI를 아직 안 돌린 1단계"는 표지 그림 없음(띠만). 2단계는 아이 원화가 나온다.
      · 3단계·미지정·텍스트형·무비형:
          viewerShowImage 'original' → 원화 고정 / 'aiS2' → AI(없으면 원화) /
          그 외(both·null) → 교사 선택(imageSelections[num].selected==='s2' → AI usable이면 AI, 아니면 원화;
          'original' → 원화) / 선택 없음 → AI usable이면 AI(감상 기본), 아니면 원화.
   ④ 아무 장면에도 그림이 없으면 null → 클라는 지금처럼 색 표지(띠만).

   입력은 RTDB raw 노드 그대로(scenes: {num: scene} 또는 배열, aiImage: {num:{s2}} 또는 배열).
   출력: { url, kind:'original'|'s2', num } | null
   ════════════════════════════════════════════════════════════════ */
'use strict';

const COVER_VERSION = 'c1';   /* 규칙 버전 — 바뀌면 캐시(shelf/{enc}/imgV) 불일치 → 재계산 */

function _isHttpUrl(v) {
  return typeof v === 'string' && /^https?:\/\//i.test(v.trim());
}

/* {num: x} | [x] → [{num, scene}] (null/비객체 제거) */
function _entries(node) {
  if (!node || typeof node !== 'object') return [];
  const out = [];
  if (Array.isArray(node)) {
    node.forEach((v, i) => { if (v && typeof v === 'object') out.push({ num: String(i), v }); });
  } else {
    Object.keys(node).forEach((k) => { const v = node[k]; if (v && typeof v === 'object') out.push({ num: String(k), v }); });
  }
  return out;
}

function _byNum(a, b) {
  const na = Number(a.num), nb = Number(b.num);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a.num).localeCompare(String(b.num));
}

/* ① 장면 순서 */
function orderedScenes(scenesNode) {
  const list = _entries(scenesNode).filter((e) => e.v.type !== 'cover' && e.v.isCover !== true);
  list.sort(_byNum);
  const start = list.filter((e) => e.v.type === 'start');
  const rest = list.filter((e) => e.v.type !== 'start');
  return start.concat(rest);
}

/* ② 후보 */
function originalUrl(scene) {
  if (!scene || typeof scene !== 'object') return null;
  if (_isHttpUrl(scene.imageData)) return scene.imageData.trim();
  if (_isHttpUrl(scene.imageUrl)) return scene.imageUrl.trim();
  return null;
}
function usableS2Url(aiImageEntry) {
  const s2 = aiImageEntry && typeof aiImageEntry === 'object' ? aiImageEntry.s2 : null;
  if (!s2 || typeof s2 !== 'object') return null;
  if (s2.stale === true) return null;
  return _isHttpUrl(s2.url) ? s2.url.trim() : null;
}

function _lookup(node, num) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { const i = Number(num); return Number.isFinite(i) ? (node[i] || null) : null; }
  return Object.prototype.hasOwnProperty.call(node, num) ? node[num] : null;
}

/* ③ 한 장면에서 무엇을 보여줄지 */
function pickForScene({ orig, s2, level, showImage, selection }) {
  const lv12 = (level === 1 || level === 2);
  if (lv12) {
    if (s2) return { url: s2, kind: 's2' };
    if (orig) return { url: orig, kind: 'original' };
    return null;
  }
  if (showImage === 'original') return orig ? { url: orig, kind: 'original' } : null;
  if (showImage === 'aiS2') {
    if (s2) return { url: s2, kind: 's2' };
    return orig ? { url: orig, kind: 'original' } : null;
  }
  const sel = (selection && typeof selection === 'object') ? selection.selected : null;
  if (sel === 's2') {
    if (s2) return { url: s2, kind: 's2' };
    return orig ? { url: orig, kind: 'original' } : null;
  }
  if (sel === 'original') return orig ? { url: orig, kind: 'original' } : null;
  /* 선택 없음 = 감상 기본(AI usable이면 AI) */
  if (s2) return { url: s2, kind: 's2' };
  return orig ? { url: orig, kind: 'original' } : null;
}

function _level(viewerMeta) {
  const n = Number(viewerMeta && viewerMeta.picturebookLevel);
  return (n === 1 || n === 2 || n === 3) ? n : null;
}
function _showImage(viewerMeta, level) {
  /* PUBLISH-LV3-ONLY: 1·2단계는 표시버전 설정 무시 */
  if (level === 1 || level === 2) return null;
  const v = viewerMeta && viewerMeta.viewerShowImage;
  return (v === 'original' || v === 'aiS2') ? v : null;
}

/* 메인: 작품 노드들 → 표지 그림 */
function pickShelfCover({ scenes, aiImage, imageSelections, viewerMeta }) {
  const level = _level(viewerMeta);
  const showImage = _showImage(viewerMeta, level);
  const ordered = orderedScenes(scenes);
  for (const e of ordered) {
    const r = pickForScene({
      orig: originalUrl(e.v),
      s2: usableS2Url(_lookup(aiImage, e.num)),
      level,
      showImage,
      selection: _lookup(imageSelections, e.num),
    });
    if (r) return { url: r.url, kind: r.kind, num: e.num };
  }
  return null;
}

module.exports = { COVER_VERSION, pickShelfCover, pickForScene, orderedScenes, originalUrl, usableS2Url };
