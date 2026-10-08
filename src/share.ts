// 친구 공유: 공유를 켠 사람의 하루 식단·주간 평가만 Firebase(Firestore)에 올리고, 친구끼리 보고 댓글을 남김.
// 나머지 기록(체중·인바디·활동 등)은 지금처럼 폰에만 있음.
// 이 파일은 친구 탭을 열거나 공유가 켜져 있을 때만 불러옴 (Firebase 코드가 커서 앱 첫 로딩에 넣지 않음)
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInAnonymously, type User } from "firebase/auth";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, getFirestore, limit, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, where, writeBatch, type Unsubscribe,
} from "firebase/firestore";
import { addDays, db, getKV, MEALS, setKV, sumNutrients, todayStr, type Entry, type Nutrients } from "./db";
import { resolveTarget } from "./hooks";
import { DEFAULT_PROFILE } from "./nutrition";
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
export interface Me { uid: string; name: string; code: string; share: boolean }

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
  const d = snap.data();
  return { uid: u.uid, name: d.name, code: d.code, share: !!d.share };
}

// 헷갈리는 글자(0/O, 1/I/L) 빼고
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");

/** 처음 시작: 익명 로그인 + 닉네임 + 초대 코드 */
export async function createMe(name: string): Promise<Me> {
  const u = auth.currentUser ?? (await signInAnonymously(auth)).user;
  let code = "";
  for (let i = 0; i < 5; i++) {
    const c = newCode();
    if (!(await getDoc(doc(fs, "codes", c))).exists()) {
      await setDoc(doc(fs, "codes", c), { uid: u.uid });
      code = c;
      break;
    }
  }
  if (!code) throw new Error("초대 코드를 만들지 못했어요. 다시 시도해 주세요.");
  await setDoc(doc(fs, "users", u.uid), { name, code, share: false, createdAt: serverTimestamp() });
  return { uid: u.uid, name, code, share: false };
}

export async function renameMe(me: Me, name: string) {
  await setDoc(doc(fs, "users", me.uid), { name }, { merge: true });
}

/** 공유 켜기/끄기. 끄면 올려 둔 식단·평가를 지움 */
export async function setShare(me: Me, on: boolean) {
  await setDoc(doc(fs, "users", me.uid), { share: on }, { merge: true });
  await setKV("shareOn", on);
  if (on) {
    await setKV("shareSigs", {});
    await syncShares();
  } else {
    for (const kind of ["days", "weeks"]) {
      const snaps = await getDocs(collection(fs, "users", me.uid, kind));
      const b = writeBatch(fs);
      snaps.forEach((s) => b.delete(s.ref));
      await b.commit();
    }
    await setKV("shareSigs", {});
  }
}

// ---------- 친구 ----------
export interface Friend { uid: string; name: string; share: boolean }

const pairId = (a: string, b: string) => (a < b ? `${a}_${b}` : `${b}_${a}`);

/** 친구의 초대 코드로 연결 (코드를 받은 사람은 서로 볼 수 있게 됨) */
export async function addFriend(me: Me, rawCode: string): Promise<string> {
  const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code === me.code) throw new Error("내 코드예요. 친구의 코드를 입력해 주세요.");
  const c = await getDoc(doc(fs, "codes", code));
  if (!c.exists()) throw new Error("없는 코드예요. 다시 확인해 주세요.");
  const other = c.data().uid as string;
  const members = [me.uid, other].sort();
  await setDoc(doc(fs, "friendships", pairId(me.uid, other)), { members, createdAt: serverTimestamp() });
  const u = await getDoc(doc(fs, "users", other));
  return (u.data()?.name as string) ?? "친구";
}

export async function removeFriend(me: Me, other: string) {
  await deleteDoc(doc(fs, "friendships", pairId(me.uid, other)));
}

/** 친구 목록 (실시간) */
export function watchFriends(me: Me, cb: (list: Friend[]) => void): Unsubscribe {
  return onSnapshot(query(collection(fs, "friendships"), where("members", "array-contains", me.uid)), async (snap) => {
    const ids = snap.docs.map((d) => (d.data().members as string[]).find((m) => m !== me.uid)!).filter(Boolean);
    const list = await Promise.all(
      ids.map(async (uid) => {
        const u = await getDoc(doc(fs, "users", uid)).catch(() => null);
        const d = u?.data();
        return { uid, name: (d?.name as string) ?? "알 수 없음", share: !!d?.share };
      }),
    );
    cb(list.sort((a, b) => a.name.localeCompare(b.name)));
  });
}

// ---------- 공유 데이터 ----------
export interface SharedItem { title: string; place?: string; kcal: number; carb: number; protein: number; fat: number }
export interface SharedDay {
  date: string;
  meals: { meal: string; label: string; items: SharedItem[]; kcal: number }[];
  total: Nutrients;
  target: Nutrients | null;
}
export interface SharedWeek {
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

function dayDoc(date: string, entries: Entry[], target: Nutrients | null): SharedDay {
  const meals = MEALS.map((m) => {
    const list = entries.filter((e) => e.meal === m.key).sort((a, b) => a.createdAt - b.createdAt);
    return {
      meal: m.key,
      label: m.label,
      items: list.map((e) => ({
        title: e.title, ...(e.place ? { place: e.place } : {}),
        kcal: Math.round(e.total.kcal), carb: r1(e.total.carb), protein: r1(e.total.protein), fat: r1(e.total.fat),
      })),
      kcal: Math.round(sumNutrients(list.map((e) => e.total)).kcal),
    };
  }).filter((m) => m.items.length);
  return { date, meals, total: slimN(sumNutrients(entries.map((e) => e.total))), target: target ? slimN(target) : null };
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
/** 공유가 켜져 있으면 바뀐 날·주만 올림 (내용이 같으면 다시 쓰지 않음) */
export function syncShares(): Promise<void> {
  syncing ??= doSync().finally(() => (syncing = null));
  return syncing;
}

async function doSync() {
  if (!(await getKV("shareOn", false))) return;
  const u = await currentUser();
  if (!u) return;
  const today = todayStr();
  const from = addDays(today, -(SHARE_DAYS - 1));
  const weekStarts = [weekStartOf(addDays(today, -7)), weekStartOf(today)];
  const allDates = [...new Set([...weekDays(weekStarts[0]), ...weekDays(weekStarts[1]), ...Array.from({ length: SHARE_DAYS }, (_, i) => addDays(from, i))])].sort();
  const entries = await db.entries.where("date").between(allDates[0], allDates[allDates.length - 1], true, true).toArray();
  const targets = await targetsFor(allDates);
  const sigs = await getKV<Record<string, string>>("shareSigs", {});
  const batch = writeBatch(fs);
  let writes = 0;
  const put = (kind: "days" | "weeks", id: string, data: object) => {
    const sig = JSON.stringify(data);
    const k = `${kind}/${id}`;
    if (sigs[k] === sig) return;
    sigs[k] = sig;
    batch.set(doc(fs, "users", u.uid, kind, id), { ...data, updatedAt: serverTimestamp() });
    writes++;
  };

  for (let i = 0; i < SHARE_DAYS; i++) {
    const d = addDays(from, i);
    const list = entries.filter((e) => e.date === d);
    if (list.length || sigs[`days/${d}`]) put("days", d, dayDoc(d, list, targets[d]));
  }
  for (const start of weekStarts) {
    const days = weekDays(start);
    const week = evaluateWeek(days.map((d) => evaluateDay(d, entries.filter((e) => e.date === d), targets[d])));
    if (!week.days.some((d) => d.status !== "future" && d.status !== "none")) continue;
    const ai = await getKV<{ text: string } | null>(`weekAi:${start}`, null);
    const memo = await getKV(`weekMemo:${start}`, "");
    put("weeks", start, {
      start,
      score: week.score,
      grade: week.grade,
      days: week.days.map((d) => ({ date: d.date, status: d.status, score: d.score ?? null, grade: d.grade ?? null })),
      summary: week.summary,
      scoredDays: week.scored.length,
      ai: ai?.text ?? "",
      memo,
    } satisfies SharedWeek);
  }
  if (!writes) return;
  await batch.commit();
  await setKV("shareSigs", sigs);
}

/** 그 사람이 올린 최근 하루 식단·주간 평가 */
export async function loadShared(uid: string): Promise<{ days: SharedDay[]; weeks: SharedWeek[] }> {
  const [d, w] = await Promise.all([
    getDocs(query(collection(fs, "users", uid, "days"), orderBy("date", "desc"), limit(SHARE_DAYS))),
    getDocs(query(collection(fs, "users", uid, "weeks"), orderBy("start", "desc"), limit(4))),
  ]);
  return { days: d.docs.map((x) => x.data() as SharedDay), weeks: w.docs.map((x) => x.data() as SharedWeek) };
}

// ---------- 댓글 ----------
export interface Comment { id: string; uid: string; name: string; text: string; at: Date | null }

export function watchComments(owner: string, kind: "days" | "weeks", id: string, cb: (list: Comment[]) => void): Unsubscribe {
  return onSnapshot(query(collection(fs, "users", owner, kind, id, "comments"), orderBy("at", "asc")), (snap) =>
    cb(snap.docs.map((d) => {
      const x = d.data();
      return { id: d.id, uid: x.uid, name: x.name, text: x.text, at: x.at?.toDate?.() ?? null };
    })),
  );
}

export async function addComment(me: Me, owner: string, kind: "days" | "weeks", id: string, text: string) {
  await addDoc(collection(fs, "users", owner, kind, id, "comments"), { uid: me.uid, name: me.name, text: text.slice(0, 500), at: serverTimestamp() });
}

export async function deleteComment(owner: string, kind: "days" | "weeks", id: string, cid: string) {
  await deleteDoc(doc(fs, "users", owner, kind, id, "comments", cid));
}

/** 친구 기능 그만 쓰기: 올린 기록·친구 연결·초대 코드·내 정보를 지우고 로그아웃 */
export async function leave(me: Me) {
  await setShare(me, false);
  const fr = await getDocs(query(collection(fs, "friendships"), where("members", "array-contains", me.uid)));
  await Promise.all(fr.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(fs, "codes", me.code)).catch(() => {});
  await deleteDoc(doc(fs, "users", me.uid));
  await auth.signOut();
}
