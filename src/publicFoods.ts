// 모두가 쓰는 음식: 숫자를 직접 넣어 만든 음식은 기록할 때 자동으로 올라가고, 앱을 쓰는 사람 모두가 검색에서 씀.
// 올린 사람만 고치거나(같은 이름으로 다시 기록) 뺄 수 있음. 닉네임(그룹에서 정한 이름)이 있어야 올라감.
// 이 파일은 검색할 때만 불러옴 (Firebase 코드가 커서 앱 첫 로딩에 넣지 않음)
import { collection, deleteDoc, doc, getDocs, getFirestore, query, setDoc, updateDoc, where } from "firebase/firestore";
import { baseServing, savedKey, sumNutrients, type EntryKind, type Item, type Nutrients } from "./db";
import { slimFood } from "./foodShare";
import { app } from "./firebaseApp";
import { loadMe } from "./share";

const fs = getFirestore(app);

export interface PublicFood {
  id: string;
  uid: string;
  /** 올린 사람 닉네임 */
  by: string;
  key: string;
  kind: EntryKind;
  title: string;
  place?: string;
  /** 1회 제공량 기준 */
  items: Item[];
  total: Nutrients;
  at: number;
  mine: boolean;
}

/** 문서 이름에 쓸 짧은 해시 (같은 사람이 같은 이름으로 다시 올리면 덮어씀) */
const hash = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
};

/** 직접 입력한 음식인지 (모든 재료가 직접 입력) */
export const isManual = (items: Item[]) => items.length > 0 && items.every((i) => i.source === "manual");

const CACHE = "meal-log-public-foods";
const TTL = 10 * 60 * 1000;
let mem: { at: number; uid: string | null; list: PublicFood[] } | null = null;

function readCache(): typeof mem {
  try {
    return JSON.parse(localStorage.getItem(CACHE) ?? "null");
  } catch {
    return null;
  }
}

/** 공유된 음식 전부 (10분마다 새로 받음. 받는 중이거나 실패하면 지난번 목록) */
export async function loadPublicFoods(force = false): Promise<PublicFood[]> {
  mem ??= readCache();
  if (!force && mem && Date.now() - mem.at < TTL) return mem.list;
  try {
    const me = await loadMe();
    if (!me) return mem?.list ?? [];
    const snap = await getDocs(collection(fs, "foods"));
    const list = snap.docs.map((d) => {
      const x = d.data();
      return { id: d.id, uid: x.uid, by: x.by, key: x.key, kind: x.kind, title: x.title, place: x.place || undefined, items: x.items, total: x.total, at: x.at ?? 0, mine: x.uid === me.uid } as PublicFood;
    });
    mem = { at: Date.now(), uid: me.uid, list };
    try {
      localStorage.setItem(CACHE, JSON.stringify(mem));
    } catch {
      /* 다음에 다시 받음 */
    }
    return list;
  } catch {
    return mem?.list ?? [];
  }
}

/** 기록한 음식이 직접 입력이면 모두에게 올림 (닉네임이 없으면 조용히 건너뜀) */
export async function publishFood(d: { kind: EntryKind; title: string; place?: string; items: Item[]; k?: number }) {
  if (!isManual(d.items) || !d.title.trim()) return;
  const me = await loadMe();
  if (!me) return;
  const key = savedKey(d.kind, d.place, d.title);
  const items = slimFood({ kind: d.kind, title: d.title, items: baseServing(d.items, d.k) }).items;
  const data = {
    uid: me.uid, by: me.name, key, kind: d.kind, title: d.title.trim().slice(0, 80),
    ...(d.place ? { place: d.place.slice(0, 40) } : {}),
    items, total: sumNutrients(items.map((i) => i.nutrients)), at: Date.now(),
  };
  await setDoc(doc(fs, "foods", `${me.uid}_${hash(key)}`), data);
  if (mem) mem = { ...mem, list: [...mem.list.filter((f) => !(f.mine && f.key === key)), { id: `${me.uid}_${hash(key)}`, ...data, place: data.place, mine: true } as PublicFood] };
}

/** 내가 올린 음식 빼기 */
export async function unpublishFood(id: string) {
  await deleteDoc(doc(fs, "foods", id));
  if (mem) mem = { ...mem, list: mem.list.filter((f) => f.id !== id) };
  try {
    localStorage.removeItem(CACHE);
  } catch {
    /* 무시 */
  }
}

/** 닉네임을 바꾸면 내가 올린 음식의 이름도 */
export async function renamePublisher(uid: string, name: string) {
  const mine = await getDocs(query(collection(fs, "foods"), where("uid", "==", uid)));
  await Promise.all(mine.docs.map((d) => updateDoc(d.ref, { by: name })));
}
