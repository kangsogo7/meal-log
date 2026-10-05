// 식약처 식품영양성분 DB 검색 (public/food-db.json, 값은 100g 기준)
import type { Nutrients } from "./db";

export interface Food {
  name: string;
  kind: 0 | 1; // 0=식재료(원재료성), 1=음식
  brand: string;
  per100: Nutrients;
  serving: number; // 1회 제공량(g), 모르면 0
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
    const hay = f.norm + "|" + norm(f.group);
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
