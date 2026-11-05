// 사용자가 기록·즐겨찾기한 음식 찾기 (검색·재료 입력 공통). 식약처 DB보다 정확하니 항상 DB 목록보다 위에
export const norm = (x: string) => x.replace(/\s+/g, "").toLowerCase();

export interface UserFoodCand {
  name: string; // 비교할 이름 (메뉴/재료 이름)
  place?: string;
  fav: boolean;
  at: number; // 마지막으로 먹은 때
}

/**
 * 검색어와 비슷한 것 전부. 순서: 즐겨찾기 → 이전 기록, 그 안에서는 이름이 똑같은 것 → 이름이 검색어와 길이가 가까운 것 → 최근 순.
 * 비슷함 = 검색어 단어가 모두 (상호+)이름에 들어 있음, 또는 이름이 검색어 안에 들어 있음 ("퀘이커 오트밀" ↔ "오트밀")
 */
export function rankUserFoods<T extends UserFoodCand>(list: T[], query: string): (T & { exact: boolean })[] {
  const q = norm(query);
  if (!q) return [];
  const words = query.split(/\s+/).map(norm).filter(Boolean);
  return list
    .filter((c) => {
      const name = norm(c.name);
      const full = norm(`${c.place ?? ""}${c.name}`);
      return words.every((w) => full.includes(w)) || (name.length >= 2 && q.includes(name));
    })
    .map((c) => ({ ...c, exact: norm(c.name) === q || norm(`${c.place ?? ""}${c.name}`) === q }))
    .sort((a, b) =>
      Number(b.fav) - Number(a.fav) ||
      Number(b.exact) - Number(a.exact) ||
      Math.abs(norm(a.name).length - q.length) - Math.abs(norm(b.name).length - q.length) ||
      b.at - a.at,
    );
}
