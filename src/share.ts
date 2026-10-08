// 그룹 공유: 그룹에 들어간 사람의 하루 식단·주간 평가를 그 그룹에 올리고, 멤버끼리 날짜별로 보고 댓글을 남김.
// 나머지 기록(체중·인바디·활동 등)은 지금처럼 폰에만 있음.
// 이 파일은 그룹 탭을 열거나 그룹에 들어가 있을 때만 불러옴 (Firebase 코드가 커서 앱 첫 로딩에 넣지 않음)
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInAnonymously, type User } from "firebase/auth";
import {
  addDoc, arrayRemove, arrayUnion, collection, deleteDoc, deleteField, doc, getDoc, getDocs, getFirestore, onSnapshot,
  orderBy, query, serverTimestamp, setDoc, updateDoc, where, writeBatch, type Unsubscribe,
} from "firebase/firestore";
import { addDays, db, getKV, MEALS, setKV, sumNutrients, todayStr, type Entry, type Nutrients } from "./db";
import { resolveTarget } from "./hooks";
import { DEFAULT_PROFILE, evaluateMeal, GOALS } from "./nutrition";
import { evaluateDay, evaluateWeek, weekDays, weekStartOf } from "./weekly";

// 공개용 설정값 (앱 코드에 들어가도 되는 값. 실제 접근 권한은 firestore.rules로 막음)
const app = initializeApp({
  apiKey: "AIzaSyDRBppRnGQnyUQP5-Adb5FAWMka6HEyd6k",
  authDomain: "meal-log-f1b13.firebaseapp.com",
  projectId: "meal-log-f1b13",
  storageBucket: "meal-log-f1b13.firebasestorage.app",
  messagingSenderId: "749252526635",
  appId: "1:749252526635:web:aa821dc0c90802b6e2606e",
});
const auth = getAuth(app);
const fs = getFirestore(app);

/** 공유하는 기간: 최근 14일, 이번 주와 지난주 */
const SHARE_DAYS = 14;

// ---------- 내 계정 ----------
export interface Me { uid: string; name: string }

/** 로그인 상태가 정해질 때까지 기다림 (앱을 다시 열면 저장된 익명 계정으로 자동 로그인) */
export function currentUser(): Promise<User | null> {
  return new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (u) => {
      off();
      resolve(u);
    });
  });
}

export async function loadMe(): Promise<Me | null> {
  const u = await currentUser();
  if (!u) return null;
  const snap = await getDoc(doc(fs, "users", u.uid));
  if (!snap.exists()) return null;
  return { uid: u.uid, name: snap.data().name };
}

/** 처음 시작: 익명 로그인 + 닉네임 */
export async function createMe(name: string): Promise<Me> {
  const u = auth.currentUser ?? (await signInAnonymously(auth)).user;
  await setDoc(doc(fs, "users", u.uid), { name, createdAt: serverTimestamp() });
  return { uid: u.uid, name };
}

/** 닉네임 변경 (들어가 있는 그룹의 멤버 이름도 같이) */
export async function renameMe(me: Me, name: string) {
  await setDoc(doc(fs, "users", me.uid), { name }, { merge: true });
  const groups = await getDocs(query(collection(fs, "groups"), where("members", "array-contains", me.uid)));
  await Promise.all(groups.docs.map((g) => updateDoc(g.ref, { [`names.${me.uid}`]: name })));
}

// ---------- 그룹 ----------
export interface Group {
  id: string;
  name: string;
  code: string;
  owner: string;
  members: string[];
  names: Record<string, string>;
  goals: Record<string, string>;
}

const toGroup = (id: string, d: Record<string, unknown>): Group => ({
  id,
  name: d.name as string,
  code: d.code as string,
  owner: d.owner as string,
  members: (d.members as string[]) ?? [],
  names: (d.names as Record<string, string>) ?? {},
  goals: (d.goals as Record<string, string>) ?? {},
});

const myGoalLabel = async () => GOALS[(await getKV("profile", DEFAULT_PROFILE)).goal]?.label ?? "";

// 헷갈리는 글자(0/O, 1/I/L) 빼고
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");

export async function createGroup(me: Me, name: string): Promise<string> {
  const ref = doc(collection(fs, "groups"));
  let code = "";
  for (let i = 0; i < 5 && !code; i++) {
    const c = newCode();
    if (!(await getDoc(doc(fs, "codes", c))).exists()) code = c;
  }
  if (!code) throw new Error("초대 코드를 만들지 못했어요. 다시 시도해 주세요.");
  const b = writeBatch(fs);
  b.set(ref, {
    name, code, owner: me.uid, members: [me.uid],
    names: { [me.uid]: me.name }, goals: { [me.uid]: await myGoalLabel() }, createdAt: serverTimestamp(),
  });
  b.set(doc(fs, "codes", code), { gid: ref.id });
  await b.commit();
  await afterMembershipChange();
  return ref.id;
}

/** 초대 코드로 그룹 참여 */
export async function joinGroup(me: Me, rawCode: string): Promise<string> {
  const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const c = await getDoc(doc(fs, "codes", code));
  if (!c.exists()) throw new Error("없는 코드예요. 다시 확인해 주세요.");
  const gid = c.data().gid as string;
  await updateDoc(doc(fs, "groups", gid), {
    members: arrayUnion(me.uid),
    [`names.${me.uid}`]: me.name,
    [`goals.${me.uid}`]: await myGoalLabel(),
  });
  await afterMembershipChange();
  const g = await getDoc(doc(fs, "groups", gid));
  return (g.data()?.name as string) ?? "그룹";
}

export async function renameGroup(g: Group, name: string) {
  await updateDoc(doc(fs, "groups", g.id), { name });
}

/** 그룹 나가기: 그 그룹에 올린 내 기록을 지우고 멤버에서 빠짐. 마지막 멤버면 그룹 삭제 */
export async function leaveGroup(me: Me, g: Group) {
  for (const kind of ["days", "weeks"] as const) {
    const mine = await getDocs(query(collection(fs, "groups", g.id, kind), where("uid", "==", me.uid)));
    const b = writeBatch(fs);
    mine.forEach((d) => b.delete(d.ref));
    await b.commit();
  }
  if (g.members.length <= 1) {
    await deleteDoc(doc(fs, "codes", g.code)).catch(() => {});
    await deleteDoc(doc(fs, "groups", g.id));
  } else {
    await updateDoc(doc(fs, "groups", g.id), {
      members: arrayRemove(me.uid),
      [`names.${me.uid}`]: deleteField(),
      [`goals.${me.uid}`]: deleteField(),
      ...(g.owner === me.uid ? { owner: g.members.find((m) => m !== me.uid)! } : {}),
    });
  }
  const sigs = await getKV<Record<string, string>>("shareSigs", {});
  for (const k of Object.keys(sigs)) if (k.startsWith(`${g.id}/`)) delete sigs[k];
  await setKV("shareSigs", sigs);
  await afterMembershipChange();
}

/** 내 그룹 목록 (실시간) */
export function watchGroups(me: Me, cb: (list: Group[]) => void): Unsubscribe {
  return onSnapshot(query(collection(fs, "groups"), where("members", "array-contains", me.uid)), (snap) => {
    cb(snap.docs.map((d) => toGroup(d.id, d.data())).sort((a, b) => a.name.localeCompare(b.name)));
  });
}

export function watchGroup(gid: string, cb: (g: Group | null) => void): Unsubscribe {
  return onSnapshot(doc(fs, "groups", gid), (d) => cb(d.exists() ? toGroup(d.id, d.data()) : null), () => cb(null));
}

/** 그룹에 들어가 있는지를 폰에 기억 (그룹이 없으면 자동 올리기를 하지 않음) */
async function afterMembershipChange() {
  const u = await currentUser();
  const n = u ? (await getDocs(query(collection(fs, "groups"), where("members", "array-contains", u.uid)))).size : 0;
  await setKV("shareOn", n > 0);
  if (n > 0) await syncShares();
}

// ---------- 공유 데이터 ----------
export interface SharedItem { title: string; place?: string; kcal: number; carb: number; protein: number; fat: number }
export interface SharedDay {
  id: string;
  uid: string;
  date: string;
  meals: { meal: string; label: string; items: SharedItem[]; kcal: number; grade: string | null }[];
  total: Nutrients;
  target: Nutrients | null;
}
export interface SharedWeek {
  id: string;
  uid: string;
  start: string;
  score: number | null;
  grade: string | null;
  days: { date: string; status: string; score: number | null; grade: string | null }[];
  summary: Record<string, { avg: number; target: number; good: number }>;
  scoredDays: number;
  ai: string;
  memo: string;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const slimN = (n: Nutrients): Nutrients => ({ kcal: Math.round(n.kcal), carb: r1(n.carb), protein: r1(n.protein), fat: r1(n.fat), sodium: Math.round(n.sodium ?? 0) });

function dayDoc(uid: string, date: string, entries: Entry[], target: Nutrients | null, goal: Parameters<typeof evaluateMeal>[3]) {
  const meals = MEALS.map((m) => {
    const list = entries.filter((e) => e.meal === m.key).sort((a, b) => a.createdAt - b.createdAt);
    const sub = sumNutrients(list.map((e) => e.total));
    return {
      meal: m.key,
      label: m.label,
      items: list.map((e) => ({
        title: e.title, ...(e.place ? { place: e.place } : {}),
        kcal: Math.round(e.total.kcal), carb: r1(e.total.carb), protein: r1(e.total.protein), fat: r1(e.total.fat),
      })),
      kcal: Math.round(sub.kcal),
      grade: target && list.length ? evaluateMeal(m.key, sub, target, goal).grade : null,
    };
  }).filter((m) => m.items.length);
  return { uid, date, meals, total: slimN(sumNutrients(entries.map((e) => e.total))), target: target ? slimN(target) : null };
}

/** 날짜별 목표 (식단 화면과 같은 계산) */
async function targetsFor(dates: string[]) {
  const profile = await getKV("profile", DEFAULT_PROFILE);
  const saved = !!(await db.kv.get("profile"));
  const body = await db.body.orderBy("date").last();
  const acts = await db.activity.where("date").between(dates[0], dates[dates.length - 1], true, true).toArray();
  return Object.fromEntries(dates.map((d) => [d, resolveTarget(profile, saved, body, acts.find((a) => a.date === d), d).target]));
}

let syncing: Promise<void> | null = null;
/** 그룹에 들어가 있으면 바뀐 날·주만 각 그룹에 올림 (내용이 같으면 다시 쓰지 않음) */
export function syncShares(): Promise<void> {
  syncing ??= doSync().finally(() => (syncing = null));
  return syncing;
}

async function doSync() {
  if (!(await getKV("shareOn", false))) return;
  const u = await currentUser();
  if (!u) return;
  const groups = await getDocs(query(collection(fs, "groups"), where("members", "array-contains", u.uid)));
  if (groups.empty) return;

  const today = todayStr();
  const from = addDays(today, -(SHARE_DAYS - 1));
  const weekStarts = [weekStartOf(addDays(today, -7)), weekStartOf(today)];
  const allDates = [...new Set([...weekDays(weekStarts[0]), ...weekDays(weekStarts[1]), ...Array.from({ length: SHARE_DAYS }, (_, i) => addDays(from, i))])].sort();
  const entries = await db.entries.where("date").between(allDates[0], allDates[allDates.length - 1], true, true).toArray();
  const targets = await targetsFor(allDates);
  const goalKey = (await getKV("profile", DEFAULT_PROFILE)).goal;

  // 올릴 내용 (그룹마다 같음)
  const docs: { kind: "days" | "weeks"; key: string; data: object }[] = [];
  for (let i = 0; i < SHARE_DAYS; i++) {
    const d = addDays(from, i);
    docs.push({ kind: "days", key: d, data: dayDoc(u.uid, d, entries.filter((e) => e.date === d), targets[d], goalKey) });
  }
  for (const start of weekStarts) {
    const week = evaluateWeek(weekDays(start).map((d) => evaluateDay(d, entries.filter((e) => e.date === d), targets[d])));
    const ai = await getKV<{ text: string } | null>(`weekAi:${start}`, null);
    const memoRaw = await getKV<unknown>(`weekMemo:${start}`, "");
    docs.push({
      kind: "weeks", key: start, data: {
        uid: u.uid, start, score: week.score, grade: week.grade,
        days: week.days.map((d) => ({ date: d.date, status: d.status, score: d.score ?? null, grade: d.grade ?? null })),
        summary: week.summary, scoredDays: week.scored.length,
        ai: ai?.text ?? "", memo: typeof memoRaw === "string" ? memoRaw : "",
      },
    });
  }

  const sigs = await getKV<Record<string, string>>("shareSigs", {});
  const goal = await myGoalLabel();
  const batch = writeBatch(fs);
  let writes = 0;
  for (const g of groups.docs) {
    if (g.data().goals?.[u.uid] !== goal) {
      batch.update(g.ref, { [`goals.${u.uid}`]: goal });
      writes++;
    }
    for (const { kind, key, data } of docs) {
      const sig = JSON.stringify(data);
      const k = `${g.id}/${kind}/${key}`;
      if (sigs[k] === sig) continue;
      // 기록이 한 번도 없던 날은 올리지 않음
      if (kind === "days" && !(data as { meals: unknown[] }).meals.length && !sigs[k]) continue;
      sigs[k] = sig;
      batch.set(doc(fs, "groups", g.id, kind, `${u.uid}_${key}`), { ...data, updatedAt: serverTimestamp() });
      writes++;
    }
  }
  if (!writes) return;
  await batch.commit();
  await setKV("shareSigs", sigs);
}

/** 그룹의 그날 멤버 식단 */
export function watchGroupDay(gid: string, date: string, cb: (list: SharedDay[]) => void): Unsubscribe {
  return onSnapshot(query(collection(fs, "groups", gid, "days"), where("date", "==", date)), (snap) =>
    cb(snap.docs.map((d) => ({ ...(d.data() as Omit<SharedDay, "id">), id: d.id }))),
  );
}

/** 그룹의 그 주 멤버 주간 평가 */
export function watchGroupWeek(gid: string, start: string, cb: (list: SharedWeek[]) => void): Unsubscribe {
  return onSnapshot(query(collection(fs, "groups", gid, "weeks"), where("start", "==", start)), (snap) =>
    cb(snap.docs.map((d) => ({ ...(d.data() as Omit<SharedWeek, "id">), id: d.id }))),
  );
}

/** 오늘 기록한 멤버 수 (그룹 목록용) */
export function watchTodayCount(gid: string, cb: (n: number) => void): Unsubscribe {
  return onSnapshot(query(collection(fs, "groups", gid, "days"), where("date", "==", todayStr())), (snap) =>
    cb(snap.docs.filter((d) => (d.data().meals as unknown[])?.length).length),
  );
}

// ---------- 댓글 ----------
export interface Comment { id: string; uid: string; name: string; text: string; at: Date | null }

export function watchComments(gid: string, kind: "days" | "weeks", id: string, cb: (list: Comment[]) => void): Unsubscribe {
  return onSnapshot(query(collection(fs, "groups", gid, kind, id, "comments"), orderBy("at", "asc")), (snap) =>
    cb(snap.docs.map((d) => {
      const x = d.data();
      return { id: d.id, uid: x.uid, name: x.name, text: x.text, at: x.at?.toDate?.() ?? null };
    })),
  );
}

export async function addComment(me: Me, gid: string, kind: "days" | "weeks", id: string, text: string) {
  await addDoc(collection(fs, "groups", gid, kind, id, "comments"), { uid: me.uid, name: me.name, text: text.slice(0, 500), at: serverTimestamp() });
}

export async function deleteComment(gid: string, kind: "days" | "weeks", id: string, cid: string) {
  await deleteDoc(doc(fs, "groups", gid, kind, id, "comments", cid));
}

/** 그룹 기능 그만 쓰기: 모든 그룹에서 나가고 내 정보를 지우고 로그아웃 */
export async function leaveAll(me: Me) {
  const groups = await getDocs(query(collection(fs, "groups"), where("members", "array-contains", me.uid)));
  for (const g of groups.docs) await leaveGroup(me, toGroup(g.id, g.data()));
  await deleteDoc(doc(fs, "users", me.uid));
  await setKV("shareOn", false);
  await setKV("shareSigs", {});
  await auth.signOut();
}
