// 식약처 식품영양성분 DB 검색 (public/food-db.json, 값은 100g 기준)
import type { Nutrients } from "./db";

export interface Food {
  name: string;
  kind: 0 | 1 | 2; // 0=식재료(원재료성), 1=음식, 2=시판 제품
  brand: string; // 외식 업체명 또는 제조사
  per100: Nutrients;
  serving: number; // 1회 제공량(g), 모르면 0
  pkg?: number; // 제품 포장 중량(g)
  group: string;
  /** 프랜차이즈 영양 표시에 탄수화물·지방이 없어서(의무 표시 항목이 아님) 추정값으로 채운 메뉴 */
  partial: boolean;
  norm: string;
}

let foods: Food[] | null = null;

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

/**
 * 원본 DB에 탄수화물·지방이 비어 있는 음식(대부분 프랜차이즈: 의무 표시 항목이 아님)을 그 음식 값에 맞게 추정해 채움.
 * - 칼로리·단백질·당류·포화지방은 원본 값 그대로 씀
 * - 지방: ① 포화지방 ÷ (같은 종류 음식의 "포화지방/지방" 비율)과 ② 같은 종류 음식의 지방 칼로리 비율을 평균.
 *   원본 값이 틀린 경우(포화지방이 비정상적으로 큰 등)에 휘둘리지 않게, 같은 종류 음식들의 흔한 범위(20~80%) 안으로 맞춤
 * - 탄수화물: 칼로리에서 단백질·지방 몫을 뺀 나머지 (당류보다 적지 않게)
 * 추정한 음식은 이름 끝에 "(추정)"을 붙임
 */
function fillMissingMacros(list: Food[], sat: Map<Food, number>) {
  const satRatio = new Map<string, number[]>();
  const fatShare = new Map<string, number[]>();
  const allSat: number[] = [];
  const allShare: number[] = [];
  const add = (m: Map<string, number[]>, k: string, v: number) => {
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(v);
  };
  for (const f of list) {
    const { kcal, carb, fat } = f.per100;
    if (f.partial || kcal <= 50) continue;
    if (carb * 4 + fat * 9 > 0) {
      const share = (fat * 9) / (carb * 4 + fat * 9);
      add(fatShare, f.group, share);
      allShare.push(share);
    }
    const sf = sat.get(f) ?? -1;
    if (sf > 0 && fat > 0 && sf <= fat) {
      add(satRatio, f.group, sf / fat);
      allSat.push(sf / fat);
    }
  }
  const pick = (m: Map<string, number[]>, k: string, fallback: number) => {
    const g = m.get(k);
    return g && g.length >= 3 ? median(g) : fallback;
  };
  /** 같은 종류 음식의 지방 칼로리 비율 범위 (하위 20% ~ 상위 20%) */
  const shareRange = (k: string): [number, number] => {
    const g = fatShare.get(k);
    if (!g || g.length < 5) return [0.25, 0.65];
    const s = [...g].sort((a, b) => a - b);
    return [s[Math.floor(s.length * 0.2)], s[Math.floor(s.length * 0.8)]];
  };
  const globalSat = allSat.length ? median(allSat) : 0.35;
  const globalShare = allShare.length ? median(allShare) : 0.45;
  const r1 = (v: number) => Math.round(Math.max(0, v) * 10) / 10;

  for (const f of list) {
    if (!f.partial) continue;
    const n = f.per100;
    const sugar = n.sugar ?? 0;
    const sf = Math.max(0, sat.get(f) ?? -1);
    const rest = Math.max(0, n.kcal - n.protein * 4); // 탄수화물+지방 몫의 칼로리
    let carb = n.carb;
    let fat = n.fat;
    if (carb >= 0 && fat < 0) fat = Math.max(sf, (rest - carb * 4) / 9);
    else if (fat >= 0 && carb < 0) carb = Math.max(sugar, (rest - fat * 9) / 4);
    else {
      const byShare = (rest * pick(fatShare, f.group, globalShare)) / 9;
      fat = sf > 0 ? (sf / pick(satRatio, f.group, globalSat) + byShare) / 2 : byShare;
      const [lo, hi] = shareRange(f.group);
      fat = Math.min(Math.max(fat, (rest * lo) / 9), (rest * hi) / 9);
      fat = Math.min(Math.max(fat, sf), (rest * 0.95) / 9);
      carb = (rest - fat * 9) / 4;
      if (carb < sugar) {
        carb = sugar;
        fat = Math.max(sf, (rest - carb * 4) / 9);
      }
    }
    n.carb = r1(carb);
    n.fat = r1(fat);
    f.name += " (추정)";
  }
}
let loading: Promise<Food[]> | null = null;

const norm = (s: string) => s.toLowerCase().replace(/[\s_()\[\],·]/g, "");

export function loadFoodDb(): Promise<Food[]> {
  if (foods) return Promise.resolve(foods);
  loading ??= fetch(`${import.meta.env.BASE_URL}food-db.json`)
    .then((r) => {
      if (!r.ok) throw new Error("식약처 DB를 불러오지 못했어요");
      return r.json();
    })
    .then((data: { foods: (string | number)[][] }) => {
      const seen = new Set<string>();
      const list: Food[] = [];
      const sat = new Map<Food, number>();
      for (const r of data.foods) {
        const [name, kind, brand, kcal, carb, protein, fat, sugar, sodium, serving, group, satFat = -1] = r as [
          string, 0 | 1, string, number, number, number, number, number, number, number, string, number?,
        ];
        if (!kcal) continue;
        const dup = `${name}|${brand}`;
        if (seen.has(dup)) continue; // 같은 이름은 첫 번째 값만 사용
        seen.add(dup);
        const food: Food = {
          name, kind, brand, serving, group,
          per100: { kcal, carb, protein, fat, sugar, sodium },
          // 원본에 탄수화물·지방이 없음(-1). 예전 형식 DB는 둘 다 0인 외식 메뉴
          partial: carb < 0 || fat < 0 || (!!brand && carb === 0 && fat === 0 && kcal > 50),
          norm: norm(name),
        };
        sat.set(food, satFat);
        list.push(food);
      }
      fillMissingMacros(list, sat);
      foods = list;
      return list;
    })
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}

// ---------- 시판 제품 (식품 탭, 처음 쓸 때만 받음) ----------
let products: Food[] | null = null;
let productsLoading: Promise<Food[]> | null = null;

export function loadProductDb(): Promise<Food[]> {
  if (products) return Promise.resolve(products);
  productsLoading ??= fetch(`${import.meta.env.BASE_URL}products.json`)
    .then((r) => {
      if (!r.ok) throw new Error("식약처 제품 DB를 불러오지 못했어요");
      return r.json();
    })
    .then((data: { products: (string | number)[][] }) => {
      const seen = new Set<string>();
      const list: Food[] = [];
      for (const r of data.products) {
        const [name, maker, kcal, carb, protein, fat, sugar, sodium, serving, pkg] = r as [
          string, string, number, number, number, number, number, number, number, number,
        ];
        const dup = `${name}|${maker}`;
        if (!kcal || seen.has(dup)) continue;
        seen.add(dup);
        list.push({
          name, kind: 2, brand: maker, serving, pkg, group: "",
          per100: { kcal, carb, protein, fat, sugar, sodium },
          partial: false,
          norm: norm(name),
        });
      }
      products = list;
      return list;
    })
    .catch((e) => {
      productsLoading = null;
      throw e;
    });
  return productsLoading;
}

/** 제품 1개를 먹었을 때 기본 g: 한 번에 먹는 포장이면 포장 전체, 아니면 1회 제공량 */
export const defaultGrams = (f: Food) => (f.pkg && f.pkg <= 500 ? f.pkg : f.serving || 100);

// ---------- 상호/브랜드 분리 ----------
const brandIndex = new WeakMap<Food[], Map<string, string>>();

/** "교촌치킨 허니콤보" → { brand: "교촌치킨", rest: "허니콤보" }. DB에 있는 업체명일 때만 분리 */
export function splitBrand(list: Food[], query: string): { brand?: string; rest: string } {
  let index = brandIndex.get(list);
  if (!index) {
    index = new Map();
    for (const f of list) if (f.brand) index.set(norm(f.brand), f.brand);
    brandIndex.set(list, index);
  }
  const tokens = query.trim().split(/\s+/);
  for (let i = Math.min(3, tokens.length - 1); i >= 1; i--) {
    const cand = norm(tokens.slice(0, i).join(""));
    if (cand.length < 2) continue;
    const exact = index.get(cand);
    if (exact) return { brand: exact, rest: tokens.slice(i).join(" ") };
  }
  // "삼광 두유"처럼 업체명 앞부분만 쓴 경우 (가장 짧은 업체명으로)
  if (tokens.length > 1 && norm(tokens[0]).length >= 2) {
    const head = norm(tokens[0]);
    let best: string | undefined;
    for (const [k, v] of index) if (k.startsWith(head) && (!best || k.length < norm(best).length)) best = v;
    if (best) return { brand: best, rest: tokens.slice(1).join(" ") };
  }
  return { rest: query.trim() };
}

// 사람들이 흔히 쓰는 이름 → DB 표기
const SYNONYMS: [RegExp, string][] = [
  [/계란/g, "달걀"],
  [/닭가슴살/g, "닭고기 가슴"],
  [/닭다리살?/g, "닭고기 넓적다리"],
  [/닭안심/g, "닭고기 안심"],
  [/쇠고기/g, "소고기"],
  [/^삼겹살$/g, "돼지고기 삼겹살"],
  [/^목살$/g, "돼지고기 목심"],
  [/^앞다리살$/g, "돼지고기 앞다리"],
  [/흰쌀밥|공기밥|^밥$/g, "쌀밥"],
  [/참치캔/g, "참치 통조림"],
  [/방울토마토/g, "토마토 방울"],
  [/^파$/g, "대파"],
  [/고추가루/g, "고춧가루"],
  [/식용유/g, "콩기름"],
];

function expand(query: string): string[] {
  let q = query.trim();
  for (const [re, to] of SYNONYMS) q = q.replace(re, to);
  // "아이스말차"처럼 붙여 쓴 온도 표시는 떼어서 따로 검색
  q = q.replace(/(^|\s)(아이스|핫|따뜻한|차가운)(?=\S)/g, "$1$2 ");
  return q.split(/\s+/).filter(Boolean);
}

// ---------- 사이즈 (음료) ----------
const SIZE_WORDS: [RegExp, string][] = [
  [/^(max|맥스)$/i, "MAX"],
  [/^(l|라지|large|그란데|grande)$/i, "L"],
  [/^(r|레귤러|regular|m|미디엄|medium|톨|tall)$/i, "R"],
  [/^(s|스몰|small|숏|short)$/i, "S"],
  [/^(벤티|venti|xl)$/i, "XL"],
];

/** "아이스말차 L사이즈" → { size: "L", label: "L", text: "아이스말차" } */
export function parseSize(query: string): { size?: string; label?: string; text: string } {
  const words = query.trim().split(/\s+/).filter(Boolean);
  let size: string | undefined;
  let label: string | undefined;
  const rest = words.filter((w) => {
    if (w === "사이즈") return false;
    if (size || words.length < 2) return true;
    const core = w.replace(/사이즈$/, "").replace(/^\((.*)\)$/, "$1");
    for (const [re, v] of SIZE_WORDS) {
      if (re.test(core)) {
        size = v;
        label = core;
        return false;
      }
    }
    return true;
  });
  return { size, label, text: rest.join(" ") };
}

/** 이름 끝에 붙은 사이즈 표기 "(L)", "(Max)" */
const nameSize = (name: string) => {
  const m = name.match(/\(([a-z]+)\)\s*$/i)?.[1];
  return (m && SIZE_WORDS.find(([re]) => re.test(m))?.[1]) || (m ? m.toUpperCase() : "");
};

/** 온도처럼 메뉴를 고르는 데 덜 중요한 단어 (이것만 맞은 결과는 빼기) */
const MODIFIERS = new Set(["아이스", "iced", "ice", "핫", "hot", "따뜻한", "차가운"]);

export interface SearchOptions {
  /** 식재료 우선(집밥) / 음식 우선(외식) */
  prefer?: "ingredient" | "dish";
  brand?: string;
  limit?: number;
}

export function searchFoods(list: Food[], query: string, opts: SearchOptions = {}): Food[] {
  const { size, text } = parseSize(query);
  query = text;
  const tokens = expand(query).map(norm).filter(Boolean);
  if (!tokens.length) return [];
  const hasCore = tokens.some((t) => !MODIFIERS.has(t));
  const brand = opts.brand ? norm(opts.brand) : "";
  const whole = norm(query);
  const scored: { f: Food; s: number }[] = [];

  for (const f of list) {
    const fb = norm(f.brand);
    if (brand && !(fb && (fb.includes(brand) || brand.includes(fb)))) continue;
    const hay = f.norm + "|" + norm(f.group) + "|" + fb;
    let hit = 0;
    let coreHit = false;
    for (const t of tokens) {
      if (!hay.includes(t)) continue;
      hit++;
      if (!MODIFIERS.has(t)) coreHit = true;
    }
    if (hit === 0 || (hasCore && !coreHit)) continue;

    let s = hit * 15 - (tokens.length - hit) * 20;
    const parts = f.name.replace(/ (추정)$/, "").split("_").map(norm);
    if (f.norm === whole || parts.includes(whole)) s += 60;
    if (parts[0] === tokens[0]) s += 35;
    if (norm(f.group) === tokens[0]) s += 20;
    if (opts.prefer === "ingredient") {
      if (f.kind === 0) s += 12;
      if (f.name.includes("생것")) s += 6;
    } else if (opts.prefer === "dish" && f.kind === 1) s += 10;
    if (brand) s += 20;
    if (size) {
      const ns = nameSize(f.name);
      if (ns === size) s += 25;
      else if (ns) s -= 10;
    }
    if (f.partial) s -= 5;
    s -= f.name.length * 0.3;
    scored.push({ f, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, opts.limit ?? 10).map((x) => x.f);
}

/** 해당 업체(브랜드)의 메뉴가 DB에 있는지 */
export function hasBrand(list: Food[], brand: string) {
  const b = norm(brand);
  return !!b && list.some((f) => f.brand && norm(f.brand).includes(b));
}

export const foodLabel = (f: Food) =>
  (f.brand ? `[${f.brand}] ` : "") + f.name.replace(/_/g, " ") + (f.group.startsWith("가공식품") ? " (시판 제품 평균)" : "");

/** 결과 목록 기본 g: 제품은 포장/1회량, 음식은 1인분, 모르면 100g */
export const listGrams = (f: Food) => (f.kind === 2 ? defaultGrams(f) : f.serving || 100);
