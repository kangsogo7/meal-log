// 사용자가 기록·즐겨찾기한 음식 찾기 (검색·재료 입력 공통). 식약처 DB보다 정확하니 항상 DB 목록보다 위에
export const norm = (x: string) => x.replace(/\s+/g, "").toLowerCase();

export interface UserFoodCand {
  name: string; // 비교할 이름 (메뉴/재료 이름)
  place?: string;
  fav: boolean;
  at: number; // 마지막으로 먹은 때
}

/**
 * 검색어와 비슷한 것 전부. 순서: 즐겨찾기 → 이전 기록, 그 안에서는 이름이 똑같은 것 → 겹치는 단어가 많은 것 → 이름 길이가 검색어와 가까운 것 → 최근 순.
 * 비슷함 = 검색어 단어 중 하나라도 (상호+)이름에 들어 있음 ("성풍양행 ISP 흑임자" ↔ "성풍양행 흑임자 프로틴"), 또는 이름이 검색어 안에 들어 있음.
 * 검색어가 여러 단어면 한 글자 단어는 비교에서 뺌 (너무 많이 걸려서)
 */
export function rankUserFoods<T extends UserFoodCand>(list: T[], query: string): (T & { exact: boolean })[] {
  const q = norm(query);
  if (!q) return [];
  const all = query.split(/\s+/).map(norm).filter(Boolean);
  const words = all.length > 1 ? all.filter((w) => w.length >= 2) : all;
  return list
    .map((c) => {
      const name = norm(c.name);
      const full = norm(`${c.place ?? ""}${c.name}`);
      const hits = words.filter((w) => full.includes(w)).length + (name.length >= 2 && q.includes(name) ? words.length : 0);
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
