// 기록 창 첫 화면 아래: 자주 먹는 것·즐겨찾기·세트·최근 카드(두 줄). 카드를 누르면 양을 정해 기록, 모서리 +는 1회 제공량으로 바로 기록
// 즐겨찾기 폴더 관리(만들기·이름·순서·음식 편집)는 설정에서
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, folderEmoji, sumNutrients, type MealSet, type SavedFood } from "../db";
import { flash, NutrientGrid, PartsList, FullScreen } from "../components/ui";
import { AmountEditor, portionItems, portionNutrients, storedPortion, type Portion } from "../portion";
import { shareFood, type SharedFood } from "../foodShare";
import { savedDraft, servingLine, SetEditScreen } from "./FavoritesTab";
import { SavedFoodEditSheet, SetComposeScreen } from "./FavEditors";
import { FavStar } from "../favorites";
import type { Draft } from "./AddSheet";

/** fav: 즐겨찾기 (folder가 있으면 그 폴더만) */
type Source = { kind: "often" } | { kind: "fav"; folder?: number } | { kind: "sets" } | { kind: "recent" };

/** 음식을 링크로 보내기 (받은 사람은 링크를 누르면 바로 기록) */
export async function shareOut(f: SharedFood) {
  const r = await shareFood(f);
  if (r === "copied") flash("공유 링크를 복사했어요");
}

export default function QuickAdd({ onRecord, recordLabel }: { onRecord: (drafts: Draft[], label?: string) => void; recordLabel: string }) {
  const groups = useLiveQuery(() => db.groups.orderBy("order").toArray(), [], []);
  const saved = useLiveQuery(() => db.saved.toArray(), [], []);
  const sets = useLiveQuery(() => db.sets.orderBy("updatedAt").reverse().toArray(), [], []);
  const [src, setSrc] = useState<Source>({ kind: "often" });
  const [amountOf, setAmountOf] = useState<{ food: SavedFood; portion: Portion } | null>(null);
  const [manage, setManage] = useState<"" | "sets">("");
  const [editFood, setEditFood] = useState<SavedFood | null>(null);
  const [composeSet, setComposeSet] = useState<number | null>(null);
  const [openSet, setOpenSet] = useState<MealSet | null>(null);

  const byUse = (a: SavedFood, b: SavedFood) => b.uses - a.uses || b.updatedAt - a.updatedAt;
  const foods: SavedFood[] =
    src.kind === "often"
      ? saved.filter((s) => s.uses > 0).sort(byUse).slice(0, 30)
      : src.kind === "recent"
        ? [...saved].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30)
        : src.kind === "fav"
          ? saved.filter((s) => s.groupId != null && (src.folder == null || s.groupId === src.folder)).sort(byUse)
          : [];
  const tabs: { label: string; on: boolean; go: Source }[] = [
    { label: "자주 먹는 것", on: src.kind === "often", go: { kind: "often" } },
    { label: "즐겨찾기", on: src.kind === "fav", go: { kind: "fav" } },
    { label: "세트", on: src.kind === "sets", go: { kind: "sets" } },
    { label: "최근", on: src.kind === "recent", go: { kind: "recent" } },
  ];

  return (
    <div className="quick">
      <div className="qa-tabs" role="tablist" aria-label="음식 모음">
        {tabs.map((t) => (
          <button key={t.label} role="tab" aria-selected={t.on} className={t.on ? "on" : ""} onClick={() => setSrc(t.go)}>{t.label}</button>
        ))}
      </div>

      {src.kind === "fav" && groups.length > 1 && (
        <div className="quick-chips" aria-label="즐겨찾기 폴더">
          <button className={src.folder == null ? "on" : ""} onClick={() => setSrc({ kind: "fav" })}>전체</button>
          {groups.map((g) => (
            <button key={g.id} className={src.folder === g.id ? "on" : ""} onClick={() => setSrc({ kind: "fav", folder: g.id })}>{folderEmoji(g)} {g.name}</button>
          ))}
        </div>
      )}

      {src.kind === "sets" ? (
        <>
          {sets.length === 0 && <p className="muted small quick-empty">식단 화면에서 끼니를 눌러 "식사 세트로 저장"하면 생겨요</p>}
          <div className="qa-grid">
            {sets.map((s) => (
              <Card
                key={s.id}
                title={s.name}
                sub={`${s.entries.length}개 · ${s.entries.map((e) => e.title).join(", ")}`}
                kcal={Math.round(s.total.kcal)}
                onOpen={() => setOpenSet(s)}
                onQuick={() => onRecord(s.entries, s.name)}
              />
            ))}
          </div>
          {sets.length > 0 && <button className="link small quick-manage" onClick={() => setManage("sets")}>세트 편집</button>}
        </>
      ) : (
        <>
          {foods.length === 0 && (
            <p className="muted small quick-empty">
              {src.kind === "fav" ? "검색 결과나 기록 옆의 ☆를 누르면 여기에 모여요" : "아직 기록한 음식이 없어요"}
            </p>
          )}
          <div className="qa-grid">
            {foods.map((s) => {
              const portion = storedPortion(s);
              const { place, amount } = servingLine(s);
              return (
                <Card
                  key={s.key}
                  title={s.title}
                  sub={[amount, place].filter(Boolean).join(" · ")}
                  kcal={Math.round(portionNutrients(portion).kcal)}
                  onOpen={() => setAmountOf({ food: s, portion })}
                  onQuick={() => onRecord([savedDraft(s, portion)])}
                />
              );
            })}
          </div>
        </>
      )}

      {amountOf && (
        <FullScreen
          title={amountOf.food.title}
          onClose={() => setAmountOf(null)}
          action={<FavStar getDraft={() => ({ kind: amountOf.food.kind, title: amountOf.food.title, place: amountOf.food.place, items: amountOf.food.items })} />}
        >
          <div className="form food-detail">
            <NutrientGrid n={portionNutrients(amountOf.portion)} />
            <AmountEditor portion={amountOf.portion} onChange={(p) => setAmountOf({ ...amountOf, portion: p })} />
            <button className="primary block big" onClick={() => { onRecord([savedDraft(amountOf.food, amountOf.portion)]); setAmountOf(null); }}>{recordLabel}</button>
            <div className="row-between detail-links">
              <button className="text-btn muted" onClick={() => { setEditFood(amountOf.food); setAmountOf(null); }}>영양정보 고치기</button>
              <button className="text-btn muted" onClick={() => shareOut({ kind: amountOf.food.kind, title: amountOf.food.title, place: amountOf.food.place, items: portionItems(amountOf.food, amountOf.portion), k: amountOf.portion.k })}>공유</button>
            </div>
            {amountOf.food.items.length > 1 && (
              <PartsList
                label="식재료"
                parts={portionItems(amountOf.food, amountOf.portion).map((i) => ({ name: i.name, amount: i.grams ? `${Math.round(i.grams)}g` : i.amountText, n: i.nutrients }))}
              />
            )}
          </div>
        </FullScreen>
      )}
      {openSet && (
        <FullScreen title={openSet.name} onClose={() => setOpenSet(null)}>
          <div className="form food-detail">
            <NutrientGrid n={openSet.total} />
            <PartsList
              label="구성"
              parts={openSet.entries.map((e) => ({
                name: e.title,
                place: e.place,
                amount: e.items.every((x) => x.grams) ? `${Math.round(e.items.reduce((a, x) => a + (x.grams ?? 0), 0))}g` : undefined,
                n: sumNutrients(e.items.map((x) => x.nutrients)),
              }))}
            />
            <div className="set-actions">
              <button onClick={() => { setComposeSet(openSet.id!); setOpenSet(null); }}>구성 수정</button>
              <button className="primary" onClick={() => { onRecord(openSet.entries, openSet.name); setOpenSet(null); }}>{recordLabel}</button>
            </div>
          </div>
        </FullScreen>
      )}
      {editFood && <SavedFoodEditSheet food={editFood} onClose={() => setEditFood(null)} />}
      {manage === "sets" && <SetEditScreen sets={sets} onClose={() => setManage("")} />}
      {composeSet != null && sets.find((s) => s.id === composeSet) && (
        <SetComposeScreen set={sets.find((s) => s.id === composeSet)!} onClose={() => setComposeSet(null)} />
      )}
    </div>
  );
}

/** 카드: 누르면 양 정하기, 모서리 +는 바로 기록 */
function Card({ title, sub, kcal, onOpen, onQuick }: { title: string; sub: string; kcal: number; onOpen: () => void; onQuick: () => void }) {
  return (
    <div className="qa-card">
      <button className="qa-open" onClick={onOpen}>
        <span className="qa-title">{title}</span>
        <span className="muted small qa-sub"><b className="qa-kcal">{kcal.toLocaleString()}</b> kcal{sub && ` · ${sub}`}</span>
      </button>
      <button className="qa-add" onClick={onQuick} aria-label={`${title} 바로 기록`}>+</button>
    </div>
  );
}
