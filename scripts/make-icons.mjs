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

/**
 * @param iconScale < 1이면 가운데에 작은 아이콘 (스플래시, 안드로이드 적응형 아이콘 전경)
 * @param transparent true면 초록 배경을 투명으로 (적응형 아이콘 전경 레이어)
 */
function draw(size, iconScale = 1, transparent = false) {
  const ch = transparent ? 4 : 3;
  const px = Buffer.alloc(size * (size * ch + 1));
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    px[y * (size * ch + 1)] = 0;
    for (let x = 0; x < size; x++) {
      // 2x2 슈퍼샘플링으로 가장자리 부드럽게
      let acc = [0, 0, 0, 0];
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const u = (x + ox - c) / (size * iconScale), v = (y + oy - c) / (size * iconScale);
        const col = Math.abs(u) > 0.5 || Math.abs(v) > 0.5 ? GREEN : colorAt(u, v);
        const a = transparent && col === GREEN ? 0 : 255;
        acc = [acc[0] + (col[0] * a) / 255 / 4, acc[1] + (col[1] * a) / 255 / 4, acc[2] + (col[2] * a) / 255 / 4, acc[3] + a / 4];
      }
      const o = y * (size * ch + 1) + 1 + x * ch;
      if (transparent) {
        // 미리 곱한 색을 되돌려 가장자리 반투명 픽셀이 어둡게 보이지 않게
        const a = acc[3];
        px[o] = a ? (acc[0] * 255) / a : 0; px[o + 1] = a ? (acc[1] * 255) / a : 0; px[o + 2] = a ? (acc[2] * 255) / a : 0; px[o + 3] = a;
      } else {
        px[o] = acc[0]; px[o + 1] = acc[1]; px[o + 2] = acc[2];
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = transparent ? 6 : 2;
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
// 안드로이드·아이폰 앱 아이콘 원본 (npx @capacitor/assets generate 가 읽음)
mkdirSync("assets", { recursive: true });
writeFileSync("assets/icon-only.png", draw(1024));
// 안드로이드 적응형 아이콘: 전경(투명 배경, 가운데 안전 영역에 그림) + 배경(초록)
writeFileSync("assets/icon-foreground.png", draw(1024, 0.62, true));
writeFileSync("assets/icon-background.png", draw(1024, 0.0001));
writeFileSync("assets/splash.png", draw(2732, 0.22));
writeFileSync("assets/splash-dark.png", draw(2732, 0.22));
console.log("아이콘 생성 완료");
