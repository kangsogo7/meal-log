// 즐겨찾기: 그룹별 저장 (☆ 버튼 → 그룹 고르기)
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, savedKey, sumNutrients, type Entry, type EntryKind, type Item } from "./db";
import { Sheet } from "./components/ui";

export interface FavDraft {
  kind: EntryKind;
  title: string;
  place?: string;
  items: Item[];
}

/** 이미 기록한 식단 → 즐겨찾기 내용. 합계를 직접 고쳤으면 그 값이 그대로 저장되게 */
export function entryDraft(e: Entry): FavDraft | null {
  const title = e.title.trim();
  if (!title) return null;
  const items = e.items.length === 1 ? [{ ...e.items[0], nutrients: e.total }] : e.items;
  return { kind: e.kind, title, place: e.place || undefined, items };
}

export async function addToGroup(d: FavDraft, groupId: number) {
  const key = savedKey(d.kind, d.place, d.title);
  const prev = await db.saved.get(key);
  await db.saved.put({
    key, kind: d.kind, title: d.title, place: d.place, items: d.items,
    total: sumNutrients(d.items.map((i) => i.nutrients)),
    uses: prev?.uses ?? 0, updatedAt: prev?.updatedAt ?? Date.now(), groupId,
  });
}

export async function createGroup(): Promise<number | undefined> {
  const name = prompt("새 그룹 이름")?.trim();
  if (!name) return;
  const last = await db.groups.orderBy("order").last();
  return (await db.groups.add({ name, order: (last?.order ?? 0) + 1 })) as number;
}

export async function renameGroup(id: number, current: string) {
  const name = prompt("그룹 이름", current)?.trim();
  if (name && name !== current) await db.groups.update(id, { name });
}

/** 그룹 삭제: 안에 있던 메뉴는 "최근"으로 */
export async function deleteGroup(id: number, name: string) {
  if (!confirm(`"${name}" 그룹을 삭제할까요? 안의 메뉴는 최근 목록으로 옮겨져요.`)) return;
  await db.transaction("rw", db.groups, db.saved, async () => {
    await db.saved.where("key").above("").modify((s) => {
      if (s.groupId === id) delete s.groupId;
    });
    await db.groups.delete(id);
  });
}

/** 저장할 그룹 고르기 */
function GroupPicker({ onPick, onClose }: { onPick: (id: number) => void; onClose: () => void }) {
  const groups = useLiveQuery(() => db.groups.orderBy("order").toArray(), [], []);
  return (
    <Sheet title="즐겨찾기 그룹" onClose={onClose}>
      <ul className="group-pick">
        {groups.map((g) => (
          <li key={g.id}>
            <button className="block" onClick={() => onPick(g.id!)}>{g.name}</button>
          </li>
        ))}
      </ul>
      <button className="link" onClick={async () => { const id = await createGroup(); if (id) onPick(id); }}>+ 새 그룹</button>
    </Sheet>
  );
}

/**
 * ☆/★ 버튼. 즐겨찾기에 없으면 그룹을 골라 저장, 있으면 즐겨찾기에서 빼기.
 * getDraft가 null이면 아직 저장할 내용이 없는 것(버튼 숨김).
 */
export function FavStar({ getDraft, className }: { getDraft: () => FavDraft | null; className?: string }) {
  const [picking, setPicking] = useState(false);
  const draft = getDraft();
  const key = draft ? savedKey(draft.kind, draft.place, draft.title) : "";
  const saved = useLiveQuery(() => (key ? db.saved.get(key) : undefined), [key]);
  if (!draft || !draft.title) return null;
  const on = saved?.groupId != null;

  return (
    <>
      <button
        className={`star ${className ?? ""}`}
        aria-label={on ? "즐겨찾기에서 빼기" : "즐겨찾기에 추가"}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (on) db.saved.update(key, { groupId: undefined });
          else setPicking(true);
        }}
      >
        {on ? "★" : "☆"}
      </button>
      {picking && (
        // 고르기 창 안의 클릭이 아래 목록 줄(누르면 기록)로 전달되지 않게
        <div onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          <GroupPicker
            onClose={() => setPicking(false)}
            onPick={async (id) => {
              await addToGroup(getDraft()!, id);
              setPicking(false);
            }}
          />
        </div>
      )}
    </>
  );
}
