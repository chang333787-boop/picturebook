/* SHELF-THUMB-1 — 썸네일 경로·원본 URL 파서(순수) + sharp 파이프라인 + index.js 배선 가드.
   실행: node --test tests/shelf-cover/thumb.test.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const requireFn = createRequire(path.join(__dirname, '../../functions/package.json'));   /* functions/node_modules(sharp) */
const T = require('../../functions/shelf-thumb.js');
const INDEX = fs.readFileSync(path.join(__dirname, '../../functions/index.js'), 'utf8');
const B = ['picturebook-8731f.firebasestorage.app', 'picturebook-8731f.appspot.com'];

test('sourceObjectPath — 우리 버킷 images/·ai-images/만, 외부·기타 경로 null', () => {
  assert.equal(T.sourceObjectPath('https://storage.googleapis.com/picturebook-8731f.firebasestorage.app/images/classes/c/teams/t/scene_1.jpg', B), 'images/classes/c/teams/t/scene_1.jpg');
  assert.equal(T.sourceObjectPath('https://firebasestorage.googleapis.com/v0/b/picturebook-8731f.firebasestorage.app/o/ai-images%2Fcls%2Fx.png?alt=media&token=t', B), 'ai-images/cls/x.png');
  assert.equal(T.sourceObjectPath('https://storage.googleapis.com/other-bucket/images/a.jpg', B), null);
  assert.equal(T.sourceObjectPath('https://firebasestorage.googleapis.com/v0/b/picturebook-8731f.firebasestorage.app/o/videos%2Fa.mp4?alt=media', B), null);
  assert.equal(T.sourceObjectPath('https://example.com/a.jpg', B), null);
  assert.equal(T.sourceObjectPath('https://storage.googleapis.com/picturebook-8731f.firebasestorage.app/images/../secret', B), null);
  assert.equal(T.sourceObjectPath('data:image/png;base64,AAA', B), null);
});

test('thumbPath — classId 정제 + 원본 URL 해시(같은 원본=같은 경로)', () => {
  const p1 = T.thumbPath('cls_a/b', 'https://x/1.jpg'); const p2 = T.thumbPath('cls_a/b', 'https://x/1.jpg'); const p3 = T.thumbPath('cls_a/b', 'https://x/2.jpg');
  assert.equal(p1, p2); assert.notEqual(p1, p3);
  assert.match(p1, /^shelf-thumbs\/cls_a_b\/[0-9a-f]{24}\.jpg$/);
});

test('makeShelfThumb — 가짜 버킷으로 sharp 파이프라인 왕복(480×320 JPEG·토큰 URL)', async () => {
  const sharp = requireFn('sharp');
  const src = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: '#88aa55' } }).png().toBuffer();
  const saved = {};
  const bucket = {
    name: 'picturebook-8731f.firebasestorage.app',
    file(p) {
      return {
        async exists() { return [!!saved[p]]; },
        async getMetadata() { return [{ metadata: { firebaseStorageDownloadTokens: saved[p].token } }]; },
        async download() { return [src]; },
        async save(buf, opts) { saved[p] = { buf, token: opts.metadata.metadata.firebaseStorageDownloadTokens }; },
      };
    },
  };
  const r = await T.makeShelfThumb({ classId: 'cls_t', sourceUrl: 'https://storage.googleapis.com/picturebook-8731f.firebasestorage.app/images/x/scene_1.jpg', bucket, sharpImpl: sharp });
  assert.ok(r && /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/picturebook-8731f\.firebasestorage\.app\/o\/shelf-thumbs%2Fcls_t%2F[0-9a-f]{24}\.jpg\?alt=media&token=/.test(r.url), r && r.url);
  const meta = await sharp(saved[r.path].buf).metadata();
  assert.equal(meta.width, 480); assert.equal(meta.height, 320); assert.equal(meta.format, 'jpeg');
  assert.ok(saved[r.path].buf.length < 60 * 1024, 'thumb < 60KB');
  /* 두 번째 호출 = 재사용(save 안 함) */
  const before = saved[r.path].buf;
  const r2 = await T.makeShelfThumb({ classId: 'cls_t', sourceUrl: 'https://storage.googleapis.com/picturebook-8731f.firebasestorage.app/images/x/scene_1.jpg', bucket, sharpImpl: sharp });
  assert.equal(r2.url, r.url); assert.equal(saved[r.path].buf, before);
  /* 외부 URL → null */
  assert.equal(await T.makeShelfThumb({ classId: 'cls_t', sourceUrl: 'https://example.com/a.jpg', bucket, sharpImpl: sharp }), null);
});

test('index.js 배선 — getClassShelf가 imgT 캐시로 썸네일을 내려보내고, judgeTeamsStatus는 shallow+병렬', () => {
  assert.match(INDEX, /require\('\.\/shelf-thumb'\)/);
  const seg = INDEX.slice(INDEX.indexOf('exports.getClassShelf'), INDEX.indexOf('exports.postWorkComment'));
  assert.match(seg, /makeShelfThumb\(/); assert.match(seg, /imgTSrc/); assert.match(seg, /img: imgOut/);
  const jseg = INDEX.slice(INDEX.indexOf('exports.judgeTeamsStatus'), INDEX.indexOf('exports.judgeTeacherToken'));
  assert.match(jseg, /_shallowKeys\(/); assert.match(jseg, /Promise\.all\(keys\.map\(_one\)\)/);
});
