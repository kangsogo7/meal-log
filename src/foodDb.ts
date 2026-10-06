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
  /** 지방/탄수화물 값이 비어 있는 프랜차이즈 데이터 */
  partial: boolean;
  norm: string;
}

let foods: Food[] | null = null;
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
      for (const r of data.foods) {
        const [name, kind, brand, kcal, carb, protein, fat, sugar, sodium, serving, group] = r as [
          string, 0 | 1, string, number, number, number, number, number, number, number, string,
        ];
        if (!kcal) continue;
        const dup = `${name}|${brand}`;
        if (seen.has(dup)) continue; // 같은 이름은 첫 번째 값만 사용
        seen.add(dup);
        list.push({
          name, kind, brand, serving, group,
          per100: { kcal, carb, protein, fat, sugar, sodium },
          partial: !!brand && carb === 0 && fat === 0 && kcal > 50,
          norm: norm(name),
        });
      }
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
  return q.split(/\s+/).filter(Boolean);
}

export interface SearchOptions {
  /** 식재료 우선(집밥) / 음식 우선(외식) */
  prefer?: "ingredient" | "dish";
  brand?: string;
  limit?: number;
}

export function searchFoods(list: Food[], query: string, opts: SearchOptions = {}): Food[] {
  const tokens = expand(query).map(norm).filter(Boolean);
  if (!tokens.length) return [];
  const brand = opts.brand ? norm(opts.brand) : "";
  const whole = norm(query);
  const scored: { f: Food; s: number }[] = [];

  for (const f of list) {
    const fb = norm(f.brand);
    if (brand && !(fb && (fb.includes(brand) || brand.includes(fb)))) continue;
    const hay = f.norm + "|" + norm(f.group) + "|" + fb;
    let hit = 0;
    for (const t of tokens) if (hay.includes(t)) hit++;
    if (hit === 0) continue;

    let s = hit * 15 - (tokens.length - hit) * 20;
    const parts = f.name.split("_").map(norm);
    if (f.norm === whole || parts.includes(whole)) s += 60;
    if (parts[0] === tokens[0]) s += 35;
    if (norm(f.group) === tokens[0]) s += 20;
    if (opts.prefer === "ingredient") {
      if (f.kind === 0) s += 12;
      if (f.name.includes("생것")) s += 6;
    } else if (opts.prefer === "dish" && f.kind === 1) s += 10;
    if (brand) s += 20;
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
