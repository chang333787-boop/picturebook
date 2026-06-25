/* ════════════════════════════════════════════════════════════════
   순수 Node 래스터라이저 — 의존성 0 (zlib 내장만). 합성 PNG 샘플 생성용.
   ──────────────────────────────────────────────────────────────
   OpenAI images/edits 는 PNG 입력을 요구한다(SVG 불가) → 단순 도형을 RGBA 버퍼에
   그려 PNG로 인코딩한다. 외부 SDK/rasterizer 추가 없이 self-contained.
   ════════════════════════════════════════════════════════════════ */
const zlib = require('zlib');

function createCanvas(w, h, bg) {
  const data = Buffer.alloc(w * h * 4);
  const b = bg || [255, 255, 255, 255];
  for (let i = 0; i < w * h; i++) { data[i * 4] = b[0]; data[i * 4 + 1] = b[1]; data[i * 4 + 2] = b[2]; data[i * 4 + 3] = b[3]; }
  function setPx(x, y, c) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = c[3] == null ? 255 : c[3];
  }
  function fillRect(x0, y0, rw, rh, c) {
    for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) setPx(x, y, c);
  }
  function fillCircle(cx, cy, r, c) {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) setPx(x, y, c);
    }
  }
  function strokeCircle(cx, cy, r, c, t) {
    const th = t || 3;
    for (let y = cy - r - th; y <= cy + r + th; y++) for (let x = cx - r - th; x <= cx + r + th; x++) {
      const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      if (d >= r - th / 2 && d <= r + th / 2) setPx(x, y, c);
    }
  }
  function line(x0, y0, x1, y1, c, t) {
    const th = t || 3; const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let s = 0; s <= steps; s++) {
      const x = x0 + (x1 - x0) * s / steps, y = y0 + (y1 - y0) * s / steps;
      fillCircle(Math.round(x), Math.round(y), Math.floor(th / 2), c);
    }
  }
  function toPNG() { return encodePNG(w, h, data); }
  return { w, h, data, setPx, fillRect, fillCircle, strokeCircle, line, toPNG };
}

/* ── PNG 인코딩(RGBA, filter 0, zlib deflate) ── */
const CRC_TABLE = (() => {
  const t = new Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, dataBuf) {
  const len = Buffer.alloc(4); len.writeUInt32BE(dataBuf.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, dataBuf])), 0);
  return Buffer.concat([len, typeBuf, dataBuf, crcBuf]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   /* 8-bit, RGBA */
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;   /* filter type 0 */
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { createCanvas, encodePNG, crc32 };
