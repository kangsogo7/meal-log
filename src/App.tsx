import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { addDays, db, getKV, todayStr } from "./db";
import { onInvite, pendingInvite } from "./invite";
import { clearFood, onFood, pendingFood, type SharedFood } from "./foodShare";
import ReceiveFood from "./pages/ReceiveFood";
import Today from "./pages/Today";
import Activity from "./pages/Activity";
import Goals from "./pages/Goals";
import SettingsPage from "./pages/Settings";
import { rescheduleReminders, takeChecksRequest } from "./notify";
// 그룹 탭은 Firebase 코드가 커서 열 때만 불러옴
const Groups = lazy(() => import("./pages/Groups"));

type Tab = "today" | "activity" | "groups" | "goals" | "settings";

// 단색 선 아이콘 (currentColor)
const icon = (d: ReactNode) => (
  <svg className="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);
// 순서: 활동 · 그룹 · 식단(가운데) · 목표·체중 · 설정
const TABS: { key: Tab; label: string; icon: ReactNode }[] = [
  { key: "activity", label: "활동", icon: icon(<path d="M3 12h4l3-8 4 16 3-8h4" />) },
  { key: "groups", label: "그룹", icon: icon(<><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c0-3 2.5-5.2 5.5-5.2s5.5 2.2 5.5 5.2" /><circle cx="17" cy="9" r="2.4" /><path d="M16 13.9c2.6 0 4.5 1.9 4.5 4.6" /></>) },
  { key: "today", label: "식단", icon: icon(<><circle cx="12" cy="13" r="7" /><circle cx="12" cy="13" r="3.5" /><path d="M3 4v5M3 9v11M21 4v16" /></>) },
  { key: "goals", label: "목표·체중", icon: icon(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.8" fill="currentColor" /></>) },
  { key: "settings", label: "설정", icon: icon(<><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>) },
];

/** 물·영양제 목표·목록·알림 설정이나 오늘 체크가 바뀌면 알림 다시 예약 */
function useReminderSync() {
  const today = todayStr();
  const sig = useLiveQuery(async () => {
    const rows = await db.kv.where("key").anyOf(["hydration", "supplements", "reminders", `check:${today}`]).toArray();
    return JSON.stringify(rows);
  }, [today], "");
  useEffect(() => {
    if (!sig) return;
    const t = setTimeout(() => rescheduleReminders(), 800);
    return () => clearTimeout(t);
  }, [sig]);
}

/** 그룹에 들어가 있으면, 최근 식단·주간 한줄평·코멘트가 바뀔 때마다 잠시 뒤 그룹에 반영 */
function useShareSync() {
  const from = addDays(todayStr(), -20);
  const sig = useLiveQuery(async () => {
    if (!(await getKV("shareOn", false))) return "";
    const entries = await db.entries.where("date").aboveOrEqual(from).toArray();
    const notes = await db.kv.where("key").startsWithAnyOf(["weekAi:", "weekMemo:"]).toArray();
    return JSON.stringify([entries.map((e) => [e.id, e.date, e.meal, e.title, e.place, e.total.kcal, e.total.protein]), notes]);
  }, [from], "");
  useEffect(() => {
    if (!sig) return;
    const t = setTimeout(() => import("./share").then((m) => m.syncShares()).catch(() => {}), 3000);
    return () => clearTimeout(t);
  }, [sig]);
}

export default function App() {
  // 그룹 초대 링크로 열었으면 그룹 탭부터
  const [tab, setTab] = useState<Tab>(() => (pendingInvite() ? "groups" : "today"));
  useEffect(() => onInvite(() => setTab("groups")), []);
  // 물·영양제 알림을 누르면 식단 탭에서 물·영양제 창 열기
  const [checksReq, setChecksReq] = useState(0);
  useEffect(() => {
    const take = () => {
      if (!takeChecksRequest()) return;
      setTab("today");
      setChecksReq((n) => n + 1);
    };
    take();
    window.addEventListener("open-checks", take);
    return () => window.removeEventListener("open-checks", take);
  }, []);
  useReminderSync();
  // 공유받은 음식(링크·그룹의 나도 기록) → 바로 기록하는 창
  const [food, setFood] = useState<SharedFood | null>(pendingFood);
  useEffect(() => onFood(setFood), []);
  useShareSync();
  return (
    <div className="app">
      <main className="content">
        {tab === "today" && <Today onGoToGoals={() => setTab("goals")} openChecks={checksReq} />}
        {tab === "activity" && <Activity />}
        {tab === "groups" && <Suspense fallback={<p className="muted small center-pad">불러오는 중...</p>}><Groups /></Suspense>}
        {tab === "goals" && <Goals />}
        {tab === "settings" && <SettingsPage />}
      </main>
      {food && <ReceiveFood food={food} from={food.from} onClose={() => { clearFood(); setFood(null); }} />}
      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
