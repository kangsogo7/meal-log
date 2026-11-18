// Open Food Facts(누구나 고칠 수 있는 공개 식품 DB)에서 한국에서 파는 제품을 받아 public/off-db.json으로 저장.
// 이름 검색 API가 한글을 못 찾아서, 식약처 DB처럼 미리 받아 두고 기기 안에서 검색함. 바코드는 앱에서 그때그때 조회.
// 검색 API는 1분에 10번까지라 7초 간격으로 받음. 한 번에 1,000개(10쪽)까지만 넘겨 주므로 정렬을 바꿔 여러 번 받고 합침.
// 받지 못한 쪽은 건너뛰고 받은 만큼 저장 (바코드는 앱에서 바로 조회하니 빠진 제품도 바코드로는 찾음). 사용: node scripts/build-off-db.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 받은 쪽은 임시 폴더에 저장해 두고, 중간에 실패하면 다시 실행했을 때 이어서 받음
const CACHE = join(tmpdir(), "meal-log-off-pages");
await mkdir(CACHE, { recursive: true });

const FIELDS = "code,product_name,product_name_ko,brands,nutriments,serving_quantity,product_quantity";
const UA = "meal-log-build/1.0 (personal app)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (v) => Math.round(v * 10) / 10;
const num = (v) => (typeof v === "number" && isFinite(v) && v >= 0 ? v : typeof v === "string" && v.trim() && isFinite(+v) && +v >= 0 ? +v : -1);

// 많이 찾는 순(기본) · 등록 순 · 최근 수정 순 · 이름 순
const SORTS = ["", "created_t", "last_modified_t", "product_name"];

async function page(sort, n) {
  const file = join(CACHE, `${sort || "pop"}-${n}.json`);
  try {
    return { cached: true, ...JSON.parse(await readFile(file, "utf8")) };
  } catch {
    /* 아직 안 받음 */
  }
  const url = `https://world.openfoodfacts.org/api/v2/search?countries_tags_en=south-korea&page_size=100&page=${n}${sort ? `&sort_by=${sort}` : ""}&fields=${FIELDS}`;
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: { "User-Agent": UA } }).catch(() => null);
    if (r?.ok) {
      const d = await r.json();
      await writeFile(file, JSON.stringify(d));
      return d;
    }
    console.log(`  ${sort || "기본"} ${n}쪽 ${r?.status ?? "연결 실패"} → ${30 * (i + 1)}초 뒤 다시`);
    await sleep(30000 * (i + 1));
  }
  console.log(`  ${sort || "기본"} ${n}쪽은 건너뜀`);
  return null;
}

const rows = [];
const seen = new Set();
for (const sort of SORTS) for (let n = 1, total = Infinity; n <= 10 && (n - 1) * 100 < total; n++) {
  const d = await page(sort, n);
  if (!d) continue;
  total = d.count;
  for (const p of d.products) {
    const nu = p.nutriments ?? {};
    let kcal = num(nu["energy-kcal_100g"]);
    if (kcal < 0 && num(nu.energy_100g) >= 0) kcal = num(nu.energy_100g) / 4.184;
    const name = (p.product_name_ko || p.product_name || "").trim().replace(/\s+/g, " ");
    if (!name || kcal <= 0 || kcal > 900 || !p.code || seen.has(p.code)) continue;
    seen.add(p.code);
    const brand = (p.brands || "").split(",")[0].trim();
    const g = (k) => num(nu[`${k}_100g`]);
    const sod = g("sodium") >= 0 ? g("sodium") * 1000 : g("salt") >= 0 ? (g("salt") / 2.5) * 1000 : -1;
    rows.push([
      name, brand, Math.round(kcal), r1(Math.max(0, g("carbohydrates"))), r1(Math.max(0, g("proteins"))), r1(Math.max(0, g("fat"))),
      r1(Math.max(0, g("sugars"))), Math.round(Math.max(0, sod)),
      Math.round(Math.max(0, num(p.serving_quantity))), Math.round(Math.max(0, num(p.product_quantity))),
      r1(g("saturated-fat")), r1(g("fiber")), r1(g("trans-fat")), p.code,
    ]);
  }
  console.log(`${sort || "기본"} ${n}쪽 · ${rows.length}개 / 전체 ${total}`);
  if (!d.cached) await sleep(7000);
}

await writeFile(
  "public/off-db.json",
  JSON.stringify({
    source: "Open Food Facts (openfoodfacts.org, ODbL) · 한국 판매 제품",
    builtAt: new Date().toISOString().slice(0, 10),
    fields: ["name", "brand", "kcal", "carb", "protein", "fat", "sugar", "sodium", "serving", "package", "satFat(-1=없음)", "fiber(-1=없음)", "transFat(-1=없음)", "barcode"],
    products: rows,
  }),
);
console.log(`완료: ${rows.length}개 → public/off-db.json`);
