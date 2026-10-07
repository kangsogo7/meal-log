// 기록하기 > 즐겨찾기 / 식사 세트 탭, 음식 편집, 내 폴더(편집) 화면
import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, folderEmoji, KIND_LABEL, r1, sumNutrients, type FavGroup, type MealSet, type SavedFood } from "../db";
import { BackIcon, flash, NutrientLine, Screen } from "../components/ui";
import { applyFolderEdits, FolderPicker, NewFolderForm } from "../favorites";
import { AmountEditor, portionGrams, portionItems, portionNutrients, storedPortion, type Portion } from "../portion";
import type { Draft } from "./AddSheet";
import { SavedFoodEditSheet, SetComposeScreen } from "./FavEditors";

/** 담은 것: 즐겨찾기 음식 하나 또는 식사 세트 하나(여러 음식) */
export interface CartItem {
  id: string;
  drafts: Draft[];
  portion?: Portion; // 즐겨찾기 음식: 고른 양
}

const basePortion = (s: SavedFood) => storedPortion(s);

/** 즐겨찾기 음식을 고른 양만큼의 기록 내용으로 */
function savedDraft(s: SavedFood, p: Portion): Draft {
  return { kind: s.kind, title: s.title, place: s.place, items: portionItems(s, p), k: p.k };
}

/** "교촌치킨 · 150g" 같은 한 줄 설명 */
function servingLine(s: { place?: string; items: SavedFood["items"] }) {
  const amount =
    s.items.length > 1 ? `재료 ${s.items.length}개` : s.items[0]?.grams ? `${Math.round(s.items[0].grams)}g` : s.items[0]?.amountText ?? "";
  return { place: s.place ?? "", amount };
}

const usesBadge = (uses: number) => (uses >= 100 ? "100회 이상 기록" : uses >= 10 ? `${Math.floor(uses / 10) * 10}회 이상 기록` : uses > 0 ? `${uses}회 기록` : "");

function AddToggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button className={`add-toggle ${on ? "on" : ""}`} onClick={(e) => { e.stopPropagation(); onClick(); }} aria-pressed={on} aria-label={label}>
      {on ? "✓" : "+"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 즐겨찾기 탭
// ---------------------------------------------------------------------------
export function FavoritesTab({ cart, toggle, put }: { cart: CartItem[]; toggle: (c: CartItem) => void; put: (c: CartItem) => void }) {
  const groups = useLiveQuery(() => db.groups.orderBy("order").toArray(), [], []);
  const favs = useLiveQuery(() => db.saved.filter((s) => s.groupId != null).toArray(), [], []);
  const [current, setCurrent] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [folders, setFolders] = useState(false);
  // 카드를 눌러 연 음식과 그 양 (담기 전에 조절)
  const [open, setOpen] = useState<{ key: string; portion: Portion } | null>(null);
  const [editFood, setEditFood] = useState<SavedFood | null>(null);

  // 선택한 폴더가 없거나 지워졌으면 첫 폴더
  const groupId = groups.some((g) => g.id === current) ? current! : groups[0]?.id;
  const group = groups.find((g) => g.id === groupId);
  const items = favs.filter((s) => s.groupId === groupId).sort((a, b) => b.uses - a.uses || b.updatedAt - a.updatedAt);
  const chipRow = useRef<HTMLDivElement>(null);

  // 고른 칩이 보이게 가로 스크롤
  useEffect(() => {
    chipRow.current?.querySelector(".fchip.on")?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [groupId]);

  return (
    <div className="fav-tab">
      <div className="chip-bar">
        <div className="chip-scroll" ref={chipRow}>
          {groups.map((g) => (
            <button key={g.id} className={`fchip ${g.id === groupId ? "on" : ""}`} onClick={() => setCurrent(g.id!)}>
              <span>{folderEmoji(g)}</span>{g.name}
            </button>
          ))}
        </div>
        <button className="round-add" onClick={() => setFolders(true)} aria-label="내 폴더">＋</button>
      </div>

      <div className="list-head">
        <span className="muted">총 {items.length}개</span>
        {items.length > 0 && <button className="text-btn" onClick={() => setEditing(true)}>음식 편집</button>}
      </div>

      {items.length === 0 ? (
        <p className="muted small empty">검색 결과나 기록 옆의 ☆를 눌러 이 폴더에 담아 보세요</p>
      ) : (
        <ul className="food-cards">
          {items.map((s) => {
            const id = `fav:${s.key}`;
            const inCart = cart.find((c) => c.id === id);
            const isOpen = open?.key === s.key;
            // 카드에 보이는 양: 열어서 조절 중이면 그 값, 담았으면 담은 양, 아니면 기본 양
            const portion = isOpen ? open!.portion : inCart?.portion ?? basePortion(s);
            const grams = portionGrams(portion);
            const { place, amount } = servingLine(s);
            const add = (p: Portion) => put({ id, drafts: [savedDraft(s, p)], portion: p });
            return (
              <li key={s.key} className={`food-card ${inCart ? "picked" : ""} ${isOpen ? "open" : ""}`}>
                <div className="fc-row" onClick={() => setOpen(isOpen ? null : { key: s.key, portion })}>
                  <div className="fc-main">
                    <div className="fc-tags">
                      {usesBadge(s.uses) && <span className={`badge ${s.uses >= 10 ? "strong" : ""}`}>{usesBadge(s.uses)}</span>}
                      <span className="badge">{KIND_LABEL[s.kind]}</span>
                      {portion.k !== 1 && <span className="badge strong">×{(Math.round(portion.k * 10) / 10).toFixed(1)}</span>}
                    </div>
                    <div className="fc-name">{s.title}</div>
                    <div className="fc-sub">
                      <span className="fc-serving">{place && <b>{place} </b>}<span className="muted">{s.items.length > 1 || !grams ? amount : `${grams}g`}</span></span>
                      <span className="muted fc-kcal">{Math.round(portionNutrients(portion).kcal)}kcal</span>
                    </div>
                  </div>
                  <AddToggle on={!!inCart} onClick={() => (inCart ? toggle(inCart) : add(portion))} label={inCart ? "담기 취소" : "담기"} />
                </div>
                {isOpen && (
                  <div className="fc-amount" onClick={(e) => e.stopPropagation()}>
                    <AmountEditor portion={open!.portion} onChange={(p) => setOpen({ key: s.key, portion: p })} />
                    <div className="row-between">
                      <NutrientLine n={portionNutrients(open!.portion)} />
                      <button className="text-btn" onClick={() => setEditFood(s)}>수정</button>
                    </div>
                    <button className="primary block" onClick={() => { add(open!.portion); setOpen(null); }}>
                      {inCart ? "이 양으로 변경" : "이 양으로 담기"}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editFood && <SavedFoodEditSheet food={editFood} onClose={() => { setEditFood(null); setOpen(null); }} />}
      {editing && group && <FoodEditScreen group={group} onClose={() => setEditing(false)} />}
      {folders && <FolderScreen onClose={() => setFolders(false)} onOpen={(id) => { setCurrent(id); setFolders(false); }} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 식사 세트 탭
// ---------------------------------------------------------------------------
export function SetsTab({ cart, toggle }: { cart: CartItem[]; toggle: (c: CartItem) => void }) {
  const sets = useLiveQuery(() => db.sets.orderBy("updatedAt").reverse().toArray(), [], []);
  const [editing, setEditing] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [composing, setComposing] = useState<MealSet | null>(null);

  return (
    <div className="fav-tab">
      <div className="list-head">
        <span className="muted">총 {sets.length}개</span>
        {sets.length > 0 && <button className="text-btn" onClick={() => setEditing(true)}>세트 편집</button>}
      </div>
      {sets.length === 0 ? (
        <p className="muted small empty">식단 화면에서 끼니 아래 "식사 세트로 저장"을 누르면 여기에 생겨요</p>
      ) : (
        <ul className="food-cards">
          {sets.map((s) => {
            const id = `set:${s.id}`;
            const on = cart.some((c) => c.id === id);
            const toggleThis = () => toggle({ id, drafts: s.entries });
            const isOpen = openId === s.id;
            return (
              <li key={s.id} className={`food-card ${on ? "picked" : ""} ${isOpen ? "open" : ""}`}>
                <div className="fc-row" onClick={() => setOpenId(isOpen ? null : s.id!)}>
                  <div className="fc-main">
                    <div className="fc-tags"><span className="badge">음식 {s.entries.length}개</span></div>
                    <div className="fc-name">{s.name}</div>
                    <div className="fc-sub">
                      <span className="fc-serving muted">{s.entries.map((e) => e.title).join(", ")}</span>
                      <span className="muted fc-kcal">{Math.round(s.total.kcal)}kcal</span>
                    </div>
                  </div>
                  <AddToggle on={on} onClick={toggleThis} label={on ? "담기 취소" : "담기"} />
                </div>
                {isOpen && (
                  <div className="fc-amount">
                    <ul className="mini-list">
                      {s.entries.map((e, i) => (
                        <li key={i}>
                          <span>{e.place && <b>{e.place} </b>}{e.title}{e.k && e.k !== 1 ? ` ×${r1(e.k)}` : ""}</span>
                          <span className="muted">{Math.round(sumNutrients(e.items.map((x) => x.nutrients)).kcal)}kcal</span>
                        </li>
                      ))}
                    </ul>
                    <button className="block" onClick={() => setComposing(s)}>구성 수정</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editing && <SetEditScreen sets={sets} onClose={() => setEditing(false)} />}
      {composing && <SetComposeScreen set={composing} onClose={() => { setComposing(null); setOpenId(null); }} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 음식 편집: 골라서 삭제 / 다른 폴더로 이동
// ---------------------------------------------------------------------------
function FoodEditScreen({ group, onClose }: { group: FavGroup; onClose: () => void }) {
  const items = useLiveQuery(() => db.saved.filter((s) => s.groupId === group.id).toArray(), [group.id], []);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const all = items.length > 0 && items.every((s) => sel.has(s.key));
  const toggle = (k: string) => setSel((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const remove = async () => {
    if (!sel.size || !confirm(`${sel.size}개를 즐겨찾기에서 뺄까요?`)) return;
    await db.saved.bulkUpdate([...sel].map((key) => ({ key, changes: { groupId: undefined } })));
    flash(`${sel.size}개를 뺐어요`);
    setSel(new Set());
  };

  return (
    <Screen
      left={<button className="icon-btn" onClick={onClose} aria-label="뒤로"><BackIcon /></button>}
      title={<><span>{folderEmoji(group)}</span> {group.name}</>}
      footer={
        <>
          <button className="foot-btn" onClick={remove} disabled={!sel.size}>선택 삭제</button>
          <button className="foot-btn" onClick={() => setMoving(true)} disabled={!sel.size}>다른 폴더로 이동</button>
        </>
      }
    >
      <div className="list-head">
        <span className="muted">총 {items.length}개</span>
        <button className={`pill-btn ${all ? "on" : ""}`} onClick={() => setSel(all ? new Set() : new Set(items.map((s) => s.key)))}>✓ 모두선택</button>
      </div>
      <ul className="food-cards">
        {items.map((s) => {
          const { place, amount } = servingLine(s);
          const on = sel.has(s.key);
          return (
            <li key={s.key} className={`food-card ${on ? "picked" : ""}`} onClick={() => toggle(s.key)}>
              <div className="fc-main">
                <div className="fc-tags">
                  {usesBadge(s.uses) && <span className="badge">{usesBadge(s.uses)}</span>}
                  <span className="badge">{KIND_LABEL[s.kind]}</span>
                </div>
                <div className="fc-name">{s.title}</div>
                <div className="fc-sub">
                  <span className="fc-serving">{place && <b>{place} </b>}<span className="muted">{amount}</span></span>
                  <span className="muted fc-kcal">{s.total.kcal}kcal</span>
                </div>
              </div>
              <span className={`check ${on ? "on" : ""}`} aria-hidden>✓</span>
            </li>
          );
        })}
      </ul>
      {moving && (
        <FolderPicker
          title="어느 폴더로 옮길까요?"
          subtitle={`${sel.size}개 선택`}
          excludeId={group.id}
          onClose={() => setMoving(false)}
          onPick={async (id, name) => {
            await db.saved.bulkUpdate([...sel].map((key) => ({ key, changes: { groupId: id } })));
            setMoving(false);
            flash(`${sel.size}개를 ${name}(으)로 옮겼어요`);
            setSel(new Set());
          }}
        />
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// 식사 세트 편집: 골라서 삭제
// ---------------------------------------------------------------------------
function SetEditScreen({ sets, onClose }: { sets: MealSet[]; onClose: () => void }) {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const all = sets.length > 0 && sets.every((s) => sel.has(s.id!));
  const toggle = (id: number) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const remove = async () => {
    if (!sel.size || !confirm(`식사 세트 ${sel.size}개를 삭제할까요?`)) return;
    await db.sets.bulkDelete([...sel]);
    flash(`${sel.size}개를 삭제했어요`);
    setSel(new Set());
  };
  return (
    <Screen
      left={<button className="icon-btn" onClick={onClose} aria-label="뒤로"><BackIcon /></button>}
      title="식사 세트"
      footer={<button className="foot-btn" onClick={remove} disabled={!sel.size}>선택 삭제</button>}
    >
      <div className="list-head">
        <span className="muted">총 {sets.length}개</span>
        <button className={`pill-btn ${all ? "on" : ""}`} onClick={() => setSel(all ? new Set() : new Set(sets.map((s) => s.id!)))}>✓ 모두선택</button>
      </div>
      <ul className="food-cards">
        {sets.map((s) => (
          <li key={s.id} className={`food-card ${sel.has(s.id!) ? "picked" : ""}`} onClick={() => toggle(s.id!)}>
            <div className="fc-main">
              <div className="fc-name">{s.name}</div>
              <div className="fc-sub">
                <span className="fc-serving muted">{s.entries.map((e) => e.title).join(", ")}</span>
                <span className="muted fc-kcal">{s.total.kcal}kcal</span>
              </div>
            </div>
            <span className={`check ${sel.has(s.id!) ? "on" : ""}`} aria-hidden>✓</span>
          </li>
        ))}
      </ul>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// 내 폴더: 목록 → 편집(삭제·이름 수정·순서 바꾸기)
// ---------------------------------------------------------------------------
function FolderScreen({ onClose, onOpen }: { onClose: () => void; onOpen: (id: number) => void }) {
  const groups = useLiveQuery(() => db.groups.orderBy("order").toArray(), [], []);
  const favs = useLiveQuery(() => db.saved.filter((s) => s.groupId != null).toArray(), [], []);
  const [mode, setMode] = useState<"list" | "new" | "edit">("list");

  if (mode === "edit") return <FolderEdit groups={groups} favs={favs} onDone={() => setMode("list")} />;

  return (
    <Screen
      left={<button className="icon-btn" onClick={mode === "new" ? () => setMode("list") : onClose} aria-label="뒤로"><BackIcon /></button>}
      title={mode === "new" ? "새 폴더" : "내 폴더"}
      right={mode === "list" && <button className="icon-btn plus" onClick={() => setMode("new")} aria-label="새 폴더">＋</button>}
    >
      {mode === "new" ? (
        <NewFolderForm submitLabel="만들기" onDone={(_, name) => { setMode("list"); flash(`${name} 폴더를 만들었어요`); }} />
      ) : (
        <>
          <div className="list-head">
            <span className="muted">총 {groups.length}개</span>
            <button className="pill-btn dark" onClick={() => setMode("edit")}>편집</button>
          </div>
          <ul className="folder-cards">
            {groups.map((g) => (
              <li key={g.id}>
                <button className="folder-card" onClick={() => onOpen(g.id!)}>
                  <span className="folder-emoji">{folderEmoji(g)}</span>
                  <span className="folder-name">{g.name}</span>
                  <span className="muted small">{favs.filter((s) => s.groupId === g.id).length}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Screen>
  );
}

function FolderEdit({ groups, favs, onDone }: { groups: FavGroup[]; favs: SavedFood[]; onDone: () => void }) {
  // 편집 완료를 누르기 전까지는 화면 안에서만 바뀜
  const [rows, setRows] = useState<FavGroup[]>(() => groups.map((g) => ({ ...g })));
  const [removed, setRemoved] = useState<number[]>([]);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ id: number; offset: number } | null>(null);
  const dragRef = useRef<{ id: number; startY: number; rowH: number; index: number } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const remove = (id: number) => {
    if (rows.length <= 1) {
      flash("폴더는 하나 이상 있어야 해요");
      return;
    }
    setRows(rows.filter((r) => r.id !== id));
    setRemoved([...removed, id]);
  };

  const finish = async () => {
    if (rows.some((r) => !r.name.trim())) {
      flash("폴더 이름을 입력해 주세요");
      return;
    }
    const lost = favs.filter((s) => removed.includes(s.groupId!)).length;
    if (lost && !confirm(`지운 폴더에 있던 음식 ${lost}개도 즐겨찾기에서 빠져요. 계속할까요?`)) return;
    await applyFolderEdits(rows.map((r) => ({ ...r, name: r.name.trim() })), removed);
    onDone();
  };

  // 손잡이(≡)를 끌어서 순서 바꾸기
  const onDragStart = (e: React.PointerEvent, id: number) => {
    const li = (e.currentTarget as HTMLElement).closest("li")!;
    const gap = parseFloat(getComputedStyle(listRef.current!).rowGap) || 0;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // 캡처가 안 돼도 끌기는 동작
    }
    dragRef.current = { id, startY: e.clientY, rowH: li.offsetHeight + gap, index: rows.findIndex((r) => r.id === id) };
    setDrag({ id, offset: 0 });
  };
  const onDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    const target = Math.max(0, Math.min(rows.length - 1, d.index + Math.round(dy / d.rowH)));
    const cur = rows.findIndex((r) => r.id === d.id);
    if (target !== cur) {
      const next = [...rows];
      const [moved] = next.splice(cur, 1);
      next.splice(target, 0, moved);
      setRows(next);
    }
    setDrag({ id: d.id, offset: dy - (target - d.index) * d.rowH });
  };
  const onDragEnd = () => {
    dragRef.current = null;
    setDrag(null);
  };

  return (
    <Screen
      left={<button className="icon-btn" onClick={onDone} aria-label="닫기">✕</button>}
      title=""
      right={<button className="text-btn" onClick={onDone}>편집 취소</button>}
      footer={<button className="primary block big" onClick={finish}>편집 완료</button>}
    >
      <ul className="folder-cards editing" ref={listRef}>
        {rows.map((g) => (
          <li key={g.id} style={drag && drag.id === g.id ? { transform: `translateY(${drag.offset}px)`, zIndex: 2, position: "relative" } : undefined}>
            <div className={`folder-card ${drag?.id === g.id ? "dragging" : ""}`}>
              <button className="del-dot" onClick={() => remove(g.id!)} aria-label={`${g.name} 삭제`}>✕</button>
              <span className="folder-emoji">{folderEmoji(g)}</span>
              {renaming === g.id ? (
                <input
                  className="rename-input"
                  value={g.name}
                  autoFocus
                  onChange={(e) => setRows(rows.map((r) => (r.id === g.id ? { ...r, name: e.target.value } : r)))}
                  onBlur={() => setRenaming(null)}
                  onKeyDown={(e) => e.key === "Enter" && setRenaming(null)}
                />
              ) : (
                <button className="folder-name rename" onClick={() => setRenaming(g.id!)}>
                  {g.name}
                  <svg className="pencil" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-label="이름 수정">
                    <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />
                  </svg>
                </button>
              )}
              <span
                className="drag-handle"
                aria-label="끌어서 순서 바꾸기"
                onPointerDown={(e) => onDragStart(e, g.id!)}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
                onPointerCancel={onDragEnd}
              >
                ≡
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
