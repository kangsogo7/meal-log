// 공공데이터포털의 식약처 "전국통합식품영양성분정보" 표준데이터를 받아
// 앱에서 쓰는 압축 JSON(public/food-db.json)으로 변환합니다.
//
//   npm run build:food-db
//
// 데이터 출처: https://www.data.go.kr/data/15100065/standard.do (원재료성식품)
//             https://www.data.go.kr/data/15100070/standard.do (음식)
//             https://www.data.go.kr/data/15100066/standard.do (가공식품)
import { writeFile, mkdir } from "node:fs/promises";

const BASE = "https://www.data.go.kr";
const DATASETS = [
  { pk: "15100065", kind: "raw" }, // 원재료성식품 (식재료, 100g 기준)
  { pk: "15100070", kind: "dish" }, // 음식 (외식/프랜차이즈 메뉴 포함)
];
const PER_PAGE = 10000;

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function fetchDataset(pk) {
  const header = await getJson(`${BASE}/download/columList.json?pk=${pk}&ext=JSON`);
  const { colNmList, svcTableNm } = header.tableVO;
  const pages = Math.ceil(header.totalCount / PER_PAGE);
  const rows = [];
  for (let page = 1; page <= pages; page++) {
    const params = new URLSearchParams({ svcTableNm, perPage: PER_PAGE, page, totalCount: header.totalCount });
    for (const c of colNmList) params.append("colNmList", c);
    const data = await getJson(`${BASE}/download/standard.json?publicDataPk=${pk}&${params}`);
    rows.push(...data);
    console.log(`  ${pk}: ${rows.length}/${header.totalCount}`);
  }
  return rows;
}

// "100g", "100ml", "250g" 같은 문자열에서 숫자만 뽑기
const qty = (s) => {
  const m = String(s ?? "").match(/[\d.]+/);
  return m ? Number(m[0]) : null;
};
/** 원본에 값이 아예 없으면 -1 (0과 구분: 앱이 추정해서 채움) */
const nb = (v, k) => (v === null || v === undefined || String(v).trim() === "" ? -1 : n(Number(v) * k));
const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.round(x * 10) / 10 : 0;
};

const foods = [];
for (const { pk, kind } of DATASETS) {
  console.log(`데이터 받는 중: ${pk} (${kind})`);
  for (const r of await fetchDataset(pk)) {
    const base = qty(r.NUT_CON_SRTR_QUA) || 100;
    // 모든 값을 100g(ml) 기준으로 맞춤
    const k = 100 / base;
    const rest = (r.REST_NM ?? "").trim();
    foods.push([
      r.FOOD_NM.trim(), // 0 이름
      kind === "raw" ? 0 : 1, // 1 종류: 0=식재료, 1=음식
      rest && rest !== "해당없음" ? rest : "", // 2 업체명
      n(r.ENERC * k), // 3 kcal / 100g
      nb(r.CHOCDF, k), // 4 탄수화물 (없으면 -1)
      n(r.PROT * k), // 5 단백질
      nb(r.FATCE, k), // 6 지방 (없으면 -1)
      n(r.SUGAR * k), // 7 당류
      n(r.NAT * k), // 8 나트륨(mg)
      qty(r.SERV_SIZE) || qty(r.FOOD_SIZE) || 0, // 9 1회 제공량(g), 없으면 0
      (r.FOOD_LV4_NM ?? "").trim(), // 10 대표식품명
      nb(r.FASAT, k), // 11 포화지방 (없으면 -1, 지방 추정에 씀)
    ]);
  }
}

// 가공식품(5만 개, 대부분 특정 제품)은 너무 커서 대표식품명별 중앙값만 넣음
// 예: 두부, 치즈, 우유, 햄, 어묵 같은 일반 식재료를 찾을 수 있게
console.log("데이터 받는 중: 15100066 (가공식품 → 대표식품별 평균 + 제품 목록)");
const groups = new Map();
const products = [];
// "(주)농심 안성공장" → "농심"
const maker = (s) =>
  String(s ?? "")
    .replace(/\(주\)|㈜|\(유\)|주식회사|농업회사법인|영농조합법인|유한회사|\s*[가-힣A-Za-z0-9]*공장$/g, "")
    .replace(/\s+/g, " ")
    .trim();
for (const r of await fetchDataset("15100066")) {
  const name = (r.FOOD_LV4_NM ?? "").trim();
  if (!Number(r.ENERC)) continue;
  const k = 100 / (qty(r.NUT_CON_SRTR_QUA) || 100);
  // 식품 탭용 개별 제품: 1회 섭취량(깔끔한 숫자일 때만)과 포장 중량
  const serv = /^\s*[\d.]+\s*(g|ml|mL)?\s*(\(g\))?\s*$/.test(r.SERV_SIZE ?? "") ? qty(r.SERV_SIZE) : 0;
  products.push([
    r.FOOD_NM.trim(), maker(r.MFR_NM || r.DIST_NM || r.IMPT_NM),
    n(r.ENERC * k), n(r.CHOCDF * k), n(r.PROT * k), n(r.FATCE * k), n(r.SUGAR * k), n(r.NAT * k),
    serv || 0, qty(r.FOOD_SIZE) || 0,
  ]);
  if (!name) continue;
  const g = groups.get(name) ?? [];
  g.push([r.ENERC, r.CHOCDF, r.PROT, r.FATCE, r.SUGAR, r.NAT].map((v) => (Number(v) || 0) * k));
  groups.set(name, g);
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
for (const [name, rows] of groups) {
  if (rows.length < 3) continue;
  const col = (i) => n(median(rows.map((r) => r[i])));
  foods.push([name, 0, "", col(0), col(1), col(2), col(3), col(4), col(5), 0, `가공식품 ${rows.length}개 평균`, -1]);
}

await mkdir("public", { recursive: true });
const out = {
  source: "식품의약품안전처 전국통합식품영양성분정보 표준데이터 (공공데이터포털)",
  builtAt: new Date().toISOString().slice(0, 10),
  fields: ["name", "kind", "brand", "kcal", "carb(-1=없음)", "protein", "fat(-1=없음)", "sugar", "sodium", "serving", "group", "satFat(-1=없음)"],
  foods,
};
await writeFile("public/food-db.json", JSON.stringify(out));
console.log(`완료: ${foods.length}개 → public/food-db.json`);

await writeFile(
  "public/products.json",
  JSON.stringify({
    source: out.source,
    builtAt: out.builtAt,
    fields: ["name", "maker", "kcal", "carb", "protein", "fat", "sugar", "sodium", "serving", "package"],
    products,
  }),
);
console.log(`완료: 제품 ${products.length}개 → public/products.json`);
