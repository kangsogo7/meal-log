// 물·영양제: 홈의 타일 2개, 누르면 열리는 체크 창, 목표·목록·알림 관리 화면
import { useState } from "react";
import {
  addWater, saveHydration, saveReminders, saveSupplements, setWater, sortSupps, toggleSupp, useDayCheck, useHydration, useReminders,
  useSupplements, WHEN, whenLabel, type Supplement, type When,
} from "../checks";
import { askNotifyPermission, canNotify } from "../notify";
import { useLatestBody } from "../hooks";
import { BackIcon, flash, NumInput, Screen, Sheet } from "../components/ui";

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12l5 5L20 7" />
  </svg>
);

/** 홈 요약 카드의 물 줄 (탄단지 줄과 같은 모양) */
export function WaterRow({ date }: { date: string }) {
  const hyd = useHydration();
  const day = useDayCheck(date);
  const liter = (ml: number) => String(Math.round(ml / 10) / 100);
  return (
    <div className="macro-row water">
      <div className="row-between">
        <span className="macro-name"><i aria-hidden />물</span>
        <b>{liter(day.waterMl)}<span className="muted">/{liter(hyd.goalMl)}L</span></b>
      </div>
      <div className="progress"><div style={{ width: `${Math.min(100, (day.waterMl / hyd.goalMl) * 100)}%` }} /></div>
    </div>
  );
}

/** 끼니 칸 아래 타일 2개: 물(한 잔 더하기), 영양제(누르면 체크 창) */
export function CheckTiles({ date, open, onOpen, onClose }: { date: string; open: boolean; onOpen: () => void; onClose: () => void }) {
  const hyd = useHydration();
  const supps = useSupplements();
  const day = useDayCheck(date);
  const [managing, setManaging] = useState(false);
  const cups = Math.max(1, Math.ceil(hyd.goalMl / hyd.cupMl));
  const filled = Math.floor(day.waterMl / hyd.cupMl);
  const taken = supps.filter((s) => day.supps[s.id]);
  const left = sortSupps(supps.filter((s) => !day.supps[s.id]));

  return (
    <>
      <div className="check-tiles">
        <div className="check-tile water">
          <button className="check-tile-head" onClick={onOpen}>
            <span>물</span>
            <span>{Math.min(filled, cups)} / {cups}잔</span>
          </button>
          {cups <= 12 ? (
            <div className="cup-strip" aria-hidden style={{ gridTemplateColumns: `repeat(${cups}, minmax(0, 1fr))` }}>
              {Array.from({ length: cups }, (_, i) => <span key={i} className={i < filled ? "on" : ""} />)}
            </div>
          ) : (
            <div className="progress water-bar" aria-hidden><div style={{ width: `${Math.min(100, (day.waterMl / hyd.goalMl) * 100)}%` }} /></div>
          )}
          <button className="cup-add" onClick={() => addWater(date, hyd.cupMl)}>+ 한 잔</button>
        </div>
        <button className="check-tile supp" onClick={onOpen}>
          <span className="check-tile-head">
            <span>영양제</span>
            {supps.length > 0 && <span className="supp-count">{taken.length} / {supps.length}</span>}
          </span>
          {supps.length ? (
            <>
              <span className="supp-dots" aria-hidden>
                {sortSupps(supps).slice(0, 6).map((s) => <span key={s.id} className={day.supps[s.id] ? "on" : ""}>{day.supps[s.id] && <CheckIcon />}</span>)}
              </span>
              <span className="muted small supp-left">
                {left.length ? `남은 것: ${left[0].name}${left.length > 1 ? ` 외 ${left.length - 1}개` : ` (${whenLabel(left[0].when)})`}` : "오늘 다 먹었어요"}
              </span>
            </>
          ) : (
            <span className="muted small supp-left">먹는 영양제를 등록해 보세요</span>
          )}
        </button>
      </div>
      {open && <CheckSheet date={date} onClose={onClose} onManage={() => { onClose(); setManaging(true); }} />}
      {managing && <ManageScreen onClose={() => setManaging(false)} />}
    </>
  );
}

/** 오늘 물·영양제 체크 창 */
function CheckSheet({ date, onClose, onManage }: { date: string; onClose: () => void; onManage: () => void }) {
  const hyd = useHydration();
  const supps = useSupplements();
  const day = useDayCheck(date);
  const cups = Math.max(1, Math.ceil(hyd.goalMl / hyd.cupMl));
  const filled = Math.floor(day.waterMl / hyd.cupMl);
  // 칸을 누르면 그 잔까지, 마지막으로 채운 칸을 다시 누르면 한 잔 빼기
  const tapCup = (i: number) => setWater(date, (i + 1 === filled ? i : i + 1) * hyd.cupMl);
  const time = (t: number) => new Date(t).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <Sheet title="물 · 영양제" onClose={onClose}>
      <section className="check-section">
        <div className="row-between">
          <b>물</b>
          <span className="muted small">{day.waterMl.toLocaleString()} / {hyd.goalMl.toLocaleString()}ml · 한 잔 {hyd.cupMl}ml</span>
        </div>
        <div className="cup-grid">
          {Array.from({ length: Math.max(cups, filled) }, (_, i) => (
            <button key={i} className={i < filled ? "on" : ""} aria-label={`${i + 1}잔`} aria-pressed={i < filled} onClick={() => tapCup(i)} />
          ))}
        </div>
        <div className="btn-row">
          <button onClick={() => addWater(date, -hyd.cupMl)} disabled={!day.waterMl} aria-label="한 잔 빼기">−</button>
          <button className="water-btn" onClick={() => addWater(date, hyd.cupMl)}>+ {hyd.cupMl}ml</button>
          <button className="water-btn" onClick={() => addWater(date, 500)}>+ 500ml</button>
        </div>
      </section>

      <section className="check-section">
        <div className="row-between">
          <b>영양제</b>
          {supps.length > 0 && <span className="muted small">{supps.filter((s) => day.supps[s.id]).length} / {supps.length}</span>}
        </div>
        {supps.length === 0 && <p className="muted small">아래 버튼으로 먹는 영양제를 등록하면 여기서 체크할 수 있어요.</p>}
        {WHEN.map((w) => {
          const list = supps.filter((s) => s.when === w.key);
          if (!list.length) return null;
          return (
            <div key={w.key}>
              <p className="muted small supp-when">{w.label}</p>
              <ul className="supp-list">
                {list.map((s) => (
                  <li key={s.id}>
                    <label>
                      <input type="checkbox" checked={!!day.supps[s.id]} onChange={() => toggleSupp(date, s.id)} />
                      <span><b>{s.name}</b> <span className="muted small">{s.count}정</span></span>
                      {day.supps[s.id] && <span className="supp-time">{time(day.supps[s.id])}</span>}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      <button className="block" onClick={onManage}>영양제 목록 · 물 목표 · 알림</button>
    </Sheet>
  );
}

const newId = () => Math.random().toString(36).slice(2, 10);

/** 물 목표, 영양제 목록, 알림 설정 */
function ManageScreen({ onClose }: { onClose: () => void }) {
  const hyd = useHydration();
  const supps = useSupplements();
  const rem = useReminders();
  const body = useLatestBody();
  const [form, setForm] = useState<Supplement | null>(null);
  const recommend = body?.weight ? Math.round((body.weight * 30) / 100) * 100 : null;

  const saveForm = async () => {
    if (!form || !form.name.trim()) return;
    const item = { ...form, name: form.name.trim(), count: Math.max(1, form.count || 1) };
    await saveSupplements(supps.some((s) => s.id === item.id) ? supps.map((s) => (s.id === item.id ? item : s)) : [...supps, item]);
    setForm(null);
  };
  const removeForm = async () => {
    if (form && confirm(`${form.name}을(를) 목록에서 지울까요?`)) {
      await saveSupplements(supps.filter((s) => s.id !== form.id));
      setForm(null);
    }
  };
  // 알림을 켤 때 권한 요청 (거절하면 다시 끔)
  const turnOn = async (key: "supp" | "water", on: boolean) => {
    if (on && !(await askNotifyPermission())) {
      flash("알림 권한이 없어요. 폰 설정 → 앱 → 식단 기록 → 알림에서 켜 주세요.", 4000);
      return;
    }
    await saveReminders({ ...rem, [key]: on });
  };
  const usedWhen = WHEN.filter((w) => supps.some((s) => s.when === w.key));

  return (
    <Screen left={<button className="icon-btn" onClick={onClose} aria-label="뒤로"><BackIcon /></button>} title="물 · 영양제">
      <section className="card form">
        <h2>물</h2>
        <div className="two">
          <label>하루 목표 (ml)<NumInput value={hyd.goalMl} onChange={(v) => v && saveHydration({ ...hyd, goalMl: v })} step="1" /></label>
          <label>한 잔 (ml)<NumInput value={hyd.cupMl} onChange={(v) => v && saveHydration({ ...hyd, cupMl: v })} step="1" /></label>
        </div>
        {recommend && recommend !== hyd.goalMl && (
          <p className="muted small">
            체중 {body!.weight}kg × 30ml = 약 {recommend.toLocaleString()}ml 권장 ·{" "}
            <button className="link small" onClick={() => saveHydration({ ...hyd, goalMl: recommend })}>이 값으로</button>
          </p>
        )}
      </section>

      <section className="card">
        <div className="row-between">
          <h2>영양제</h2>
          <button className="chip-add" onClick={() => setForm({ id: newId(), name: "", when: "morning", count: 1 })}>+ 추가</button>
        </div>
        {supps.length ? (
          <ul className="mini-list supp-manage">
            {sortSupps(supps).map((s) => (
              <li key={s.id}>
                <span><b>{s.name}</b><br /><span className="muted small">{whenLabel(s.when)} · {s.count}정</span></span>
                <button className="row-edit" onClick={() => setForm(s)}>수정</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">아직 없어요.</p>
        )}
      </section>

      <section className="card form">
        <h2>알림</h2>
        {!canNotify() ? (
          <p className="muted small">
            알림은 안드로이드 앱에서 쓸 수 있어요. 아이폰 홈 화면 앱은 정해진 시간에 알림을 띄울 수 없어서, 아이폰 앱이 나오면 같이 넣을게요.
          </p>
        ) : (
          <>
            <label className="switch">
              <input type="checkbox" checked={rem.supp} onChange={(e) => turnOn("supp", e.target.checked)} />
              영양제 알림
            </label>
            {rem.supp && (
              usedWhen.length ? (
                <div className="time-rows">
                  {usedWhen.map((w) => (
                    <label key={w.key} className="row-between">
                      {w.label}
                      <input type="time" value={rem.times[w.key]} onChange={(e) => e.target.value && saveReminders({ ...rem, times: { ...rem.times, [w.key]: e.target.value } })} />
                    </label>
                  ))}
                  <p className="muted small">그때 먹을 영양제를 아직 체크하지 않았으면 알려 드려요.</p>
                </div>
              ) : (
                <p className="muted small">영양제를 등록하면 먹는 때마다 시간을 정할 수 있어요.</p>
              )
            )}
            <label className="switch">
              <input type="checkbox" checked={rem.water} onChange={(e) => turnOn("water", e.target.checked)} />
              물 알림
            </label>
            {rem.water && (
              <div className="time-rows">
                <label className="row-between">
                  간격
                  <select value={rem.waterEvery} onChange={(e) => saveReminders({ ...rem, waterEvery: Number(e.target.value) })}>
                    {[1, 2, 3, 4].map((h) => <option key={h} value={h}>{h}시간마다</option>)}
                  </select>
                </label>
                <label className="row-between">시작<input type="time" value={rem.waterFrom} onChange={(e) => e.target.value && saveReminders({ ...rem, waterFrom: e.target.value })} /></label>
                <label className="row-between">끝<input type="time" value={rem.waterTo} onChange={(e) => e.target.value && saveReminders({ ...rem, waterTo: e.target.value })} /></label>
                <p className="muted small">그날 목표만큼 마시면 남은 알림은 오지 않아요.</p>
              </div>
            )}
          </>
        )}
      </section>

      {form && (
        <Sheet
          title={supps.some((s) => s.id === form.id) ? "영양제 수정" : "영양제 추가"}
          onClose={() => setForm(null)}
          footer={
            <>
              {supps.some((s) => s.id === form.id) && <button className="danger" onClick={removeForm}>삭제</button>}
              <span className="spacer" />
              <button onClick={() => setForm(null)}>취소</button>
              <button className="primary" onClick={saveForm} disabled={!form.name.trim()}>저장</button>
            </>
          }
        >
          <div className="form">
            <label>이름<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: 비타민C" /></label>
            <p className="label">언제</p>
            <div className="seg">
              {WHEN.map((w) => (
                <button key={w.key} className={form.when === w.key ? "on" : ""} onClick={() => setForm({ ...form, when: w.key as When })}>{w.label}</button>
              ))}
            </div>
            <label>한 번에 (정)<NumInput value={form.count} onChange={(v) => setForm({ ...form, count: v ?? 1 })} step="1" /></label>
          </div>
        </Sheet>
      )}
    </Screen>
  );
}
