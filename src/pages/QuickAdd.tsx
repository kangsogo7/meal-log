// 기록 창 첫 화면 아래: 자주 먹는 것·즐겨찾기·세트·최근 카드(음식 이름 / kcal / 양·재료). 카드를 누르면 양을 정해 기록, 모서리 +는 1회 제공량으로 바로 기록
// 즐겨찾기 폴더 관리(만들기·이름·순서·음식 편집)는 설정에서
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, folderEmoji, sumNutrients, type MealSet, type Nutrients, type SavedFood } from "../db";
import { flash, FoodList, FoodRow, FullScreen, itemParts, Tabs, Btn } from "../components/ui";
import FoodView, { FoodActions } from "../components/FoodView";
import { portionItems, portionNutrients, storedPortion, type Portion } from "../portion";
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
  const [src, setSrc] = useState<Source>({ kind: "fav" });
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
    { label: "즐겨찾기", on: src.kind === "fav", go: { kind: "fav" } },
    { label: "세트", on: src.kind === "sets", go: { kind: "sets" } },
    { label: "자주 먹는 것", on: src.kind === "often", go: { kind: "often" } },
    { label: "최근", on: src.kind === "recent", go: { kind: "recent" } },
  ];

  return (
    <div className="quick">
      <Tabs label="음식 모음" value={tabs.find((t) => t.on)?.label ?? ""} onChange={(l) => setSrc(tabs.find((t) => t.label === l)!.go)} options={tabs.map((t) => ({ key: t.label, label: t.label }))} />

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
          {sets.length > 0 && <div className="qa-manage"><Btn onClick={() => setManage("sets")}>세트 편집</Btn></div>}
          <FoodList>
            {sets.map((s) => (
              <Card
                key={s.id}
                title={s.name}
                sub={s.entries.map((e) => e.title).join(", ")}
                n={s.total}
                kcal={Math.round(s.total.kcal)}
                onOpen={() => setOpenSet(s)}
                onQuick={() => onRecord(s.entries, s.name)}
              />
            ))}
          </FoodList>
        </>
      ) : (
        <>
          {foods.length === 0 && (
            <p className="muted small quick-empty">
              {src.kind === "fav" ? "검색 결과나 기록 옆의 ☆를 누르면 여기에 모여요" : "아직 기록한 음식이 없어요"}
            </p>
          )}
          <FoodList>
            {foods.map((s) => {
              const portion = storedPortion(s);
              const { amount } = servingLine(s);
              return (
                <Card
                  key={s.key}
                  title={s.title}
                  sub={s.items.length > 1 ? s.items.map((i) => i.name).join(", ") : amount}
                  n={portionNutrients(portion)}
                  kcal={Math.round(portionNutrients(portion).kcal)}
                  onOpen={() => setAmountOf({ food: s, portion })}
                  onQuick={() => onRecord([savedDraft(s, portion)])}
                />
              );
            })}
          </FoodList>
        </>
      )}

      {amountOf && (
        <FullScreen
          title={amountOf.food.title}
          onClose={() => setAmountOf(null)}
          action={<FavStar getDraft={() => ({ kind: amountOf.food.kind, title: amountOf.food.title, place: amountOf.food.place, items: amountOf.food.items })} />}
          footer={<Btn kind="primary" className="block big" onClick={() => { onRecord([savedDraft(amountOf.food, amountOf.portion)]); setAmountOf(null); }}>{recordLabel}</Btn>}
        >
          <FoodView
            n={portionNutrients(amountOf.portion)}
            portion={amountOf.portion}
            onPortion={(p) => setAmountOf({ ...amountOf, portion: p })}
            parts={amountOf.food.items.length > 1 ? {
              label: "재료",
              parts: itemParts(portionItems(amountOf.food, amountOf.portion)),
            } : undefined}
            actions={
              <FoodActions
                onEdit={() => { setEditFood(amountOf.food); setAmountOf(null); }}
                onShare={() => shareOut({ kind: amountOf.food.kind, title: amountOf.food.title, place: amountOf.food.place, items: portionItems(amountOf.food, amountOf.portion), k: amountOf.portion.k })}
              />
            }
          />
        </FullScreen>
      )}
      {openSet && (
        <FullScreen
          title={openSet.name}
          onClose={() => setOpenSet(null)}
          footer={
            <>
              <Btn onClick={() => { setComposeSet(openSet.id!); setOpenSet(null); }}>구성 수정</Btn>
              <Btn kind="primary" className="block big" onClick={() => { onRecord(openSet.entries, openSet.name); setOpenSet(null); }}>{recordLabel}</Btn>
            </>
          }
        >
          <FoodView
            n={openSet.total}
            parts={{
              label: "구성",
              parts: openSet.entries.map((e) => ({
                name: e.title,
                place: e.place,
                amount: e.items.every((x) => x.grams) ? `${Math.round(e.items.reduce((a, x) => a + (x.grams ?? 0), 0))}g` : undefined,
                n: sumNutrients(e.items.map((x) => x.nutrients)),
              })),
            }}
          />
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

/** 음식 한 줄: 누르면 양 정하기, 오른쪽 +는 바로 기록 (공통 FoodRow) */
function Card({ title, sub, n, kcal, onOpen, onQuick }: { title: string; sub: string; n: Nutrients; kcal: number; onOpen: () => void; onQuick: () => void }) {
  return <FoodRow title={title} sub={sub} n={n} kcal={kcal} onClick={onOpen} trailing={<button className="fr-plus" onClick={onQuick} aria-label={`${title} 바로 기록`}>+</button>} />;
}
