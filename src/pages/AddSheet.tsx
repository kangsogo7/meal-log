import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, MEALS, savedKey, sumNutrients, type Entry, type Item, type Meal, type Nutrients, type SavedFood } from "../db";
import { NutrientLine, Sheet, SwipeRow, Toast } from "../components/ui";
import OutForm from "./OutForm";
import HomeForm from "./HomeForm";
import ManualForm from "./ManualForm";

type Mode = "recent" | "out" | "home" | "manual";
const MODES: { key: Mode; label: string }[] = [
  { key: "out", label: "외식" },
  { key: "home", label: "집밥" },
  { key: "recent", label: "최근" },
  { key: "manual", label: "직접 입력" },
];

export interface Draft {
  kind: Entry["kind"];
  title: string;
  place?: string;
  items: Item[];
}

/** 기록 저장 + 다음에 다시 쓰도록 메뉴 저장 */
export async function saveEntry(date: string, meal: Meal, d: Draft, memo?: string) {
  const total = sumNutrients(d.items.map((i) => i.nutrients));
  await db.entries.add({ date, meal, kind: d.kind, title: d.title, place: d.place, items: d.items, total, memo, createdAt: Date.now() });
  const key = savedKey(d.kind, d.place, d.title);
  const prev = await db.saved.get(key);
  await db.saved.put({ key, kind: d.kind, title: d.title, place: d.place, items: d.items, total, uses: (prev?.uses ?? 0) + 1, updatedAt: Date.now() });
}

export default function AddSheet({ date, meal: initialMeal, onClose }: { date: string; meal: Meal; onClose: () => void }) {
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const [mode, setMode] = useState<Mode>("out");
  const [toast, setToast] = useState<string | null>(null);

  const onSave = async (d: Draft) => {
    await saveEntry(date, meal, d);
    onClose();
  };

  return (
    <Sheet title="식단 기록" onClose={onClose}>
      <div className="seg meal-seg">
        {MEALS.map((m) => (
          <button key={m.key} className={meal === m.key ? "on" : ""} onClick={() => setMeal(m.key)}>{m.icon} {m.label}</button>
        ))}
      </div>
      <div className="seg">
        {MODES.map((m) => (
          <button key={m.key} className={mode === m.key ? "on" : ""} onClick={() => setMode(m.key)}>{m.label}</button>
        ))}
      </div>

      {mode === "recent" && (
        <Recent
          onPick={async (s) => {
            await saveEntry(date, meal, { kind: s.kind, title: s.title, place: s.place, items: s.items });
            setToast(`"${s.title}" 기록했어요`);
            setTimeout(onClose, 700);
          }}
        />
      )}
      {mode === "out" && <OutForm onSave={onSave} />}
      {mode === "home" && <HomeForm onSave={onSave} />}
      {mode === "manual" && <ManualForm onSave={onSave} />}
      <Toast message={toast} />
    </Sheet>
  );
}

function Recent({ onPick }: { onPick: (s: SavedFood) => void }) {
  const [q, setQ] = useState("");
  const saved = useLiveQuery(() => db.saved.orderBy("updatedAt").reverse().limit(200).toArray(), [], []);
  const list = saved.filter((s) => !q || `${s.place ?? ""} ${s.title}`.includes(q.trim())).slice(0, 50);
  return (
    <div>
      <input placeholder="이전에 먹은 메뉴 검색" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.length === 0 ? (
        <p className="muted small">한 번 기록한 메뉴가 여기에 모여요. 누르면 바로 기록돼요.</p>
      ) : (
        <p className="muted small">누르면 바로 기록돼요. 왼쪽으로 밀면 목록에서 지울 수 있어요.</p>
      )}
      <ul className="pick-list">
        {list.map((s) => (
          <li key={s.key}>
            <SwipeRow onTap={() => onPick(s)} onDelete={() => db.saved.delete(s.key)}>
              <div>{s.place ? `${s.place} · ` : ""}{s.title}</div>
              <NutrientLine n={s.total as Nutrients} />
            </SwipeRow>
          </li>
        ))}
      </ul>
    </div>
  );
}
