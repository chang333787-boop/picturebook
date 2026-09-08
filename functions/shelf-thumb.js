/* ════════════════════════════════════════════════════════════════
   shelf-thumb.js — SHELF-THUMB-1(2026-09-08): 책장 표지용 썸네일(480×320 JPEG) 생성·업로드.
   ─────────────────────────────────────────────────────────────────
   왜: 책장 카드가 원본 크기(1536px·수백 KB) 그림 23장을 그대로 내려받아 크롬북 첫 로딩이 무거움.
   무엇: 표지로 고른 그림(shelf-cover.js 결과 URL)을 서버가 한 번 480px로 줄여 Storage `shelf-thumbs/`에 올리고
         토큰 URL을 shelf/{enc}/imgT 에 캐시. 카드는 imgT를 쓴다(없으면 원본 URL 폴백 — 기능 영향 0).
   원칙:
   · 원본은 읽기만(우리 버킷의 images/·ai-images/ 객체만 download). 외부 호스트 URL은 만들지 않음(null).
   · 파일명 = 원본 URL의 해시 → 같은 원본이면 재생성 없음, 원본이 바뀌면 새 파일(immutable 캐시 안전).
   · sharp가 없거나 실패하면 null → 호출부가 원본 URL로 폴백(책장은 항상 뜬다).
   ════════════════════════════════════════════════════════════════ */
'use strict';

const crypto = require('crypto');

const THUMB_W = 480;
const THUMB_H = 320;   /* 3:2 = 책장 카드 규격 */
const THUMB_PREFIX = 'shelf-thumbs/';
const ALLOWED_SRC_PREFIXES = ['images/', 'ai-images/'];

/* 원본 URL → 우리 버킷 객체 경로. 허용 호스트/경로가 아니면 null. */
function sourceObjectPath(url, bucketNames) {
  let u;
  try { u = new URL(String(url || '')); } catch (e) { return null; }
  let objectPath = null;
  if (u.host === 'firebasestorage.googleapis.com') {
    const m = u.pathname.match(/\/v0\/b\/([^/]+)\/o\/(.+)$/);
    if (!m) return null;
    if (bucketNames.indexOf(m[1]) === -1) return null;
    try { objectPath = decodeURIComponent(m[2]); } catch (e) { return null; }
  } else if (u.host === 'storage.googleapis.com') {
    const segs = u.pathname.replace(/^\/+/, '').split('/');
    const b = segs.shift() || '';
    if (bucketNames.indexOf(b) === -1) return null;
    try { objectPath = decodeURIComponent(segs.join('/')); } catch (e) { return null; }
  } else {
    return null;
  }
  if (!objectPath || objectPath.indexOf('..') !== -1) return null;
  if (!ALLOWED_SRC_PREFIXES.some((p) => objectPath.indexOf(p) === 0)) return null;
  return objectPath;
}

/* 썸네일 객체 경로 — classId + 원본 URL 해시(내용 동일 = 경로 동일) */
function thumbPath(classId, sourceUrl) {
  const h = crypto.createHash('sha1').update(String(sourceUrl)).digest('hex').slice(0, 24);
  return `${THUMB_PREFIX}${String(classId).replace(/[^A-Za-z0-9_-]/g, '_')}/${h}.jpg`;
}

function tokenUrl(bucketName, objectPath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

/* 메인. deps = { bucket(admin.storage().bucket()), sharp(optional; 없으면 require 시도) }
   반환: { url, path } | null */
async function makeShelfThumb({ classId, sourceUrl, bucket, sharpImpl, logger }) {
  const log = logger || { warn() {} };
  let sharp = sharpImpl;
  if (!sharp) { try { sharp = require('sharp'); } catch (e) { log.warn('[shelf-thumb] sharp 없음 — 원본 URL 폴백'); return null; } }
  const names = [bucket.name, 'picturebook-8731f.firebasestorage.app', 'picturebook-8731f.appspot.com'];
  const src = sourceObjectPath(sourceUrl, names);
  if (!src) return null;
  const dest = thumbPath(classId, sourceUrl);
  const file = bucket.file(dest);
  /* 이미 있으면 재사용(토큰은 메타데이터에서) */
  try {
    const [exists] = await file.exists();
    if (exists) {
      const [meta] = await file.getMetadata();
      const tok = meta && meta.metadata && meta.metadata.firebaseStorageDownloadTokens;
      if (tok) return { url: tokenUrl(bucket.name, dest, String(tok).split(',')[0]), path: dest };
    }
  } catch (e) { /* 계속 생성 */ }
  const [buf] = await bucket.file(src).download();
  const out = await sharp(buf).rotate().resize({ width: THUMB_W, height: THUMB_H, fit: 'cover', position: 'centre' })
    .jpeg({ quality: 78, mozjpeg: true }).toBuffer();
  const token = crypto.randomUUID();
  await file.save(out, {
    resumable: false,
    contentType: 'image/jpeg',
    metadata: { cacheControl: 'public,max-age=31536000,immutable', metadata: { firebaseStorageDownloadTokens: token } },
  });
  return { url: tokenUrl(bucket.name, dest, token), path: dest };
}

module.exports = { THUMB_W, THUMB_H, THUMB_PREFIX, sourceObjectPath, thumbPath, tokenUrl, makeShelfThumb };
