// 즐겨찾기: 폴더(그룹)별 저장. ☆ 버튼 → 폴더 고르기
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, FOLDER_EMOJIS, folderEmoji, savedKey, sumNutrients, type Entry, type EntryKind, type FavGroup, type Item } from "./db";
import { flash, Sheet } from "./components/ui";

export interface FavDraft {
  kind: EntryKind;
  title: string;
  place?: string;
  items: Item[];
  k?: number;
}

/** 이미 기록한 식단 → 즐겨찾기 내용. 합계를 직접 고쳤으면 그 값이 그대로 저장되게 */
export function entryDraft(e: Entry): FavDraft | null {
  const title = e.title.trim();
  if (!title) return null;
  const items = e.items.length === 1 ? [{ ...e.items[0], nutrients: e.total }] : e.items;
  return { kind: e.kind, title, place: e.place || undefined, items, k: e.k };
}

export async function addToGroup(d: FavDraft, groupId: number) {
  const key = savedKey(d.kind, d.place, d.title);
  const prev = await db.saved.get(key);
  await db.saved.put({
    key, kind: d.kind, title: d.title, place: d.place, items: d.items,
    total: sumNutrients(d.items.map((i) => i.nutrients)), k: d.k,
    uses: prev?.uses ?? 0, updatedAt: prev?.updatedAt ?? Date.now(), groupId,
  });
}

export async function addGroup(name: string, emoji: string): Promise<number> {
  const last = await db.groups.orderBy("order").last();
  return (await db.groups.add({ name, emoji, order: (last?.order ?? 0) + 1 })) as number;
}

/** 폴더 편집 결과 반영: 순서·이름 저장, 지운 폴더의 음식은 즐겨찾기에서 빠짐 */
export async function applyFolderEdits(next: FavGroup[], removedIds: number[]) {
  await db.transaction("rw", db.groups, db.saved, async () => {
    if (removedIds.length) {
      await db.saved.toCollection().modify((s) => {
        if (s.groupId != null && removedIds.includes(s.groupId)) delete s.groupId;
      });
      await db.groups.bulkDelete(removedIds);
    }
    await db.groups.bulkPut(next.map((g, i) => ({ ...g, order: i })));
  });
}

/** 이모지 + 이름으로 새 폴더 만들기 (폴더 고르기·내 폴더 화면 공용) */
export function NewFolderForm({ submitLabel, onDone }: { submitLabel: string; onDone: (id: number, name: string) => void }) {
  const [emoji, setEmoji] = useState(FOLDER_EMOJIS[0]);
  const [name, setName] = useState("");
  const submit = async () => {
    const n = name.trim();
    if (!n) return;
    onDone(await addGroup(n, emoji), n);
  };
  return (
    <div className="new-folder">
      <div className="emoji-grid" role="radiogroup" aria-label="폴더 아이콘">
        {FOLDER_EMOJIS.map((e) => (
          <button key={e} role="radio" aria-checked={e === emoji} className={e === emoji ? "on" : ""} onClick={() => setEmoji(e)}>{e}</button>
        ))}
      </div>
      <div className="inline-new">
        <span className="emoji-preview">{emoji}</span>
        <input value={name} onChange={(ev) => setName(ev.target.value)} placeholder="폴더 이름" autoFocus onKeyDown={(ev) => ev.key === "Enter" && submit()} />
        <button className="primary" onClick={submit} disabled={!name.trim()}>{submitLabel}</button>
      </div>
    </div>
  );
}

/** 폴더 목록에서 하나 고르기: 누르면 바로 결정 */
export function FolderPicker({ title, subtitle, excludeId, onPick, onClose }: {
  title: string; subtitle?: string; excludeId?: number; onPick: (id: number, name: string) => void; onClose: () => void;
}) {
  const groups = useLiveQuery(() => db.groups.orderBy("order").toArray(), [], []);
  const favs = useLiveQuery(() => db.saved.filter((s) => s.groupId != null).toArray(), [], []);
  const [adding, setAdding] = useState(false);

  return (
    <Sheet title={title} onClose={onClose}>
      {subtitle && <p className="muted small picker-sub">{subtitle}</p>}
      <div className="group-list">
        {groups.filter((g) => g.id !== excludeId).map((g) => (
          <button key={g.id} className="group-row" onClick={() => onPick(g.id!, g.name)}>
            <span className="folder-emoji">{folderEmoji(g)}</span>
            <span>{g.name}</span>
            <span className="count">{favs.filter((s) => s.groupId === g.id).length}</span>
          </button>
        ))}
        {adding ? (
          <NewFolderForm submitLabel="만들고 저장" onDone={onPick} />
        ) : (
          <button className="group-row add" onClick={() => setAdding(true)}>
            <span className="folder-emoji">＋</span>
            <span>새 폴더 만들기</span>
          </button>
        )}
      </div>
    </Sheet>
  );
}

/**
 * ☆/★ 버튼. 즐겨찾기에 없으면 폴더를 골라 저장, 있으면 즐겨찾기에서 빼기.
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
          <FolderPicker
            title="어느 폴더에 저장할까요?"
            subtitle={`${draft.place ? draft.place + " · " : ""}${draft.title}`}
            onClose={() => setPicking(false)}
            onPick={async (id, name) => {
              await addToGroup(getDraft()!, id);
              setPicking(false);
              flash(`${name}에 저장했어요`);
            }}
          />
        </div>
      )}
    </>
  );
}
