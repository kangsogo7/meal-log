// 앱 아이콘 PNG 생성 (초록 배경 + 흰 접시 + 숟가락/포크)
//   node scripts/make-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const GREEN = [22, 163, 74];
const WHITE = [255, 255, 255];
const LIGHT = [220, 245, 228];

function crc32(buf) {
  let c, crc = ~0;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function draw(size) {
  const px = Buffer.alloc(size * (size * 3 + 1));
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    px[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      // 2x2 슈퍼샘플링으로 가장자리 부드럽게
      let acc = [0, 0, 0];
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const col = colorAt((x + ox - c) / size, (y + oy - c) / size);
        acc = acc.map((v, i) => v + col[i] / 4);
      }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      px[o] = acc[0]; px[o + 1] = acc[1]; px[o + 2] = acc[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(px)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// 좌표는 중심 기준 -0.5 ~ 0.5
function colorAt(x, y) {
  const r = Math.hypot(x, y);
  if (r < 0.2) return LIGHT; // 접시 안쪽
  if (r < 0.27) return WHITE; // 접시 테두리
  // 왼쪽 포크
  if (Math.abs(x + 0.36) < 0.022 && y > -0.2 && y < 0.24) return WHITE;
  if (x > -0.4 && x < -0.32 && y > -0.2 && y < -0.08) {
    const t = (x + 0.4) / 0.08;
    if (t < 0.25 || (t > 0.42 && t < 0.58) || t > 0.75 || y > -0.11) return WHITE;
  }
  // 오른쪽 숟가락
  if (Math.abs(x - 0.36) < 0.022 && y > -0.05 && y < 0.24) return WHITE;
  if (((x - 0.36) / 0.05) ** 2 + ((y + 0.12) / 0.09) ** 2 < 1) return WHITE;
  return GREEN;
}

mkdirSync("public/icons", { recursive: true });
for (const [name, size] of [["icon-192", 192], ["icon-512", 512], ["apple-touch-icon", 180]]) {
  writeFileSync(`public/icons/${name}.png`, draw(size));
}
console.log("아이콘 생성 완료");
