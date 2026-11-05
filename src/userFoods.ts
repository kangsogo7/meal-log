// 사용자가 기록·즐겨찾기한 음식 찾기 (검색·재료 입력 공통). 식약처 DB보다 정확하니 항상 DB 목록보다 위에
export const norm = (x: string) => x.replace(/\s+/g, "").toLowerCase();

/** 두 글자씩 겹쳐 쪼갬 ("성풍양행" → 성풍·풍양·양행). 띄어쓰기·단어 순서와 상관없이 비교하려고 */
const bigrams = (s: string) => {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
};

export interface UserFoodCand {
  name: string; // 비교할 이름 (메뉴/재료 이름)
  place?: string;
  fav: boolean;
  at: number; // 마지막으로 먹은 때
}

/**
 * 검색어와 비슷한 것 전부. 순서: 즐겨찾기 → 이전 기록, 그 안에서는 이름이 똑같은 것 → 겹치는 조각이 많은 것 → 이름 길이가 검색어와 가까운 것 → 최근 순.
 * 비슷함 = 검색어와 (상호+)이름을 두 글자씩 쪼개서 2조각 이상(검색어가 짧으면 전부) + 검색어 조각의 30% 이상이 같음.
 * 한 글자 검색어는 이름에 들어 있으면
 */
export function rankUserFoods<T extends UserFoodCand>(list: T[], query: string): (T & { exact: boolean })[] {
  const q = norm(query);
  if (!q) return [];
  const qg = bigrams(q);
  const need = Math.min(2, qg.size);
  return list
    .map((c) => {
      const name = norm(c.name);
      const full = norm(`${c.place ?? ""}${c.name}`);
      let hits = 0;
      if (qg.size === 0) hits = full.includes(q) ? 1 : 0;
      else {
        const cg = bigrams(full);
        for (const g of qg) if (cg.has(g)) hits++;
        if (hits < need || hits / qg.size < 0.3) hits = 0;
      }
      return { ...c, hits, exact: name === q || full === q };
    })
    .filter((c) => c.hits > 0)
    .sort((a, b) =>
      Number(b.fav) - Number(a.fav) ||
      Number(b.exact) - Number(a.exact) ||
      b.hits - a.hits ||
      Math.abs(norm(a.name).length - q.length) - Math.abs(norm(b.name).length - q.length) ||
      b.at - a.at,
    )
    .map(({ hits: _, ...c }) => c as T & { exact: boolean });
}
