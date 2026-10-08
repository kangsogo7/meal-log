// 친구: 서로 하루 식단·주간 평가를 공유하고 댓글을 남김
import { useEffect, useState } from "react";
import { BackIcon, flash, Screen } from "../components/ui";
import { GRADE_EMOJI, type Grade } from "../nutrition";
import { formatDate } from "../db";
import { weekLabel, CRITERIA, CRITERIA_ORDER } from "../weekly";
import {
  addComment, addFriend, createMe, deleteComment, leave, loadMe, loadShared, removeFriend, renameMe, setShare, syncShares,
  watchComments, watchFriends, type Comment, type Friend, type Me, type SharedDay, type SharedWeek,
} from "../share";

const errText = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  if (/permission|insufficient/i.test(m)) return "권한이 없어요. 친구 연결이 끊겼을 수 있어요.";
  if (/admin-restricted|operation-not-allowed/i.test(m)) return "Firebase에서 익명 로그인이 아직 꺼져 있어요.";
  if (/network|offline|unavailable/i.test(m)) return "인터넷 연결을 확인해 주세요.";
  return m;
};

export default function Friends() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [error, setError] = useState("");
  useEffect(() => {
    loadMe().then(setMe).catch((e) => { setError(errText(e)); setMe(null); });
  }, []);

  if (me === undefined) return <p className="muted small center-pad">불러오는 중...</p>;
  if (!me) return <Setup onDone={setMe} error={error} />;
  return <Home me={me} setMe={setMe} />;
}

function Setup({ onDone, error: initialError }: { onDone: (m: Me) => void; error: string }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const start = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      onDone(await createMe(name.trim()));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <header className="page-head"><h1>친구</h1></header>
      <section className="card form">
        <p className="small">친구와 하루 식단·주간 평가를 서로 보고 댓글을 남길 수 있어요. 공유는 켤 때만 올라가요.</p>
        <label>닉네임
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="친구에게 보일 이름" maxLength={20} />
        </label>
        {error && <p className="error small">{error}</p>}
        <button className="primary block" onClick={start} disabled={busy || !name.trim()}>{busy ? "만드는 중..." : "시작하기"}</button>
      </section>
    </>
  );
}

function Home({ me, setMe }: { me: Me; setMe: (m: Me | null) => void }) {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [view, setView] = useState<{ uid: string; name: string } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(me.name);

  useEffect(() => watchFriends(me, setFriends), [me.uid]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy("");
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(me.code);
      flash("초대 코드를 복사했어요");
    } catch {
      flash(me.code);
    }
  };

  return (
    <>
      <header className="page-head"><h1>친구</h1></header>

      <section className="card friend-me">
        <div className="row-between">
          {renaming ? (
            <div className="input-with-star">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} />
              <button className="text-btn" onClick={() => run("rename", async () => {
                if (!name.trim()) return;
                await renameMe(me, name.trim());
                setMe({ ...me, name: name.trim() });
                setRenaming(false);
              })}>저장</button>
            </div>
          ) : (
            <>
              <b className="friend-name">{me.name}</b>
              <button className="text-btn" onClick={() => setRenaming(true)}>이름 변경</button>
            </>
          )}
        </div>
        <div className="row-between">
          <span className="muted small">내 초대 코드</span>
          <button className="code-chip" onClick={copy}>{me.code} <span className="muted small">복사</span></button>
        </div>
        <label className="switch">
          <input type="checkbox" checked={me.share} disabled={busy === "share"} onChange={(e) => {
            const on = e.target.checked;
            run("share", async () => {
              await setShare(me, on);
              setMe({ ...me, share: on });
              flash(on ? "공유를 켰어요" : "공유를 끄고 올린 기록을 지웠어요");
            });
          }} />
          내 하루 식단·주간 평가 공유 {busy === "share" && <span className="muted small">처리 중...</span>}
        </label>
        <p className="muted small">켜면 최근 2주 식단과 주간 평가가 친구에게 보여요. 체중·인바디·활동 기록은 올라가지 않아요.</p>
      </section>

      <section className="card form">
        <label>친구 추가
          <div className="input-with-star">
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="친구의 초대 코드 6자리" maxLength={8} autoCapitalize="characters" />
            <button className="primary" disabled={busy === "add" || code.trim().length < 6} onClick={() => run("add", async () => {
              const n = await addFriend(me, code);
              setCode("");
              flash(`${n}님과 친구가 됐어요`);
            })}>추가</button>
          </div>
        </label>
        {error && <p className="error small">{error}</p>}
      </section>

      <section className="card">
        <h2>공유 보기</h2>
        <ul className="friend-list">
          <li onClick={() => setView({ uid: me.uid, name: me.name })}>
            <span><b>내 공유</b> <span className="muted small">{me.share ? "친구가 남긴 댓글 보기" : "공유 꺼짐"}</span></span>
            <span className="muted">›</span>
          </li>
          {friends === null && <li className="muted small">불러오는 중...</li>}
          {friends?.length === 0 && <li className="muted small">아직 친구가 없어요. 초대 코드를 카톡으로 보내 보세요.</li>}
          {friends?.map((f) => (
            <li key={f.uid} onClick={() => setView({ uid: f.uid, name: f.name })}>
              <span><b>{f.name}</b> {!f.share && <span className="muted small">공유 꺼짐</span>}</span>
              <span className="muted">›</span>
            </li>
          ))}
        </ul>
      </section>

      <button className="link small leave-btn" onClick={() => {
        if (!confirm("친구 기능을 그만 쓸까요? 올린 기록, 친구 연결, 초대 코드가 모두 지워져요. 폰에 있는 기록은 그대로예요.")) return;
        run("leave", async () => {
          await leave(me);
          setMe(null);
        });
      }}>친구 기능 그만 쓰기</button>

      {view && (
        <ProfileView
          me={me}
          owner={view.uid}
          name={view.name}
          onClose={() => setView(null)}
          onUnfriend={view.uid === me.uid ? undefined : async () => {
            if (!confirm(`${view.name}님과 친구를 끊을까요? 서로의 공유가 안 보이게 돼요.`)) return;
            await removeFriend(me, view.uid);
            setView(null);
          }}
        />
      )}
    </>
  );
}

function ProfileView({ me, owner, name, onClose, onUnfriend }: { me: Me; owner: string; name: string; onClose: () => void; onUnfriend?: () => void }) {
  const [tab, setTab] = useState<"days" | "weeks">("days");
  const [data, setData] = useState<{ days: SharedDay[]; weeks: SharedWeek[] } | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (owner === me.uid) await syncShares();
        setData(await loadShared(owner));
      } catch (e) {
        setError(errText(e));
      }
    })();
  }, [owner, me.uid]);

  return (
    <Screen
      left={<button className="icon-btn" onClick={onClose} aria-label="뒤로"><BackIcon /></button>}
      title={owner === me.uid ? "내 공유" : name}
      right={onUnfriend && <button className="text-btn" onClick={onUnfriend}>친구 끊기</button>}
    >
      <div className="seg">
        <button className={tab === "days" ? "on" : ""} onClick={() => { setTab("days"); setOpen(null); }}>하루 식단</button>
        <button className={tab === "weeks" ? "on" : ""} onClick={() => { setTab("weeks"); setOpen(null); }}>주간 평가</button>
      </div>
      {error && <p className="error small">{error}</p>}
      {!data && !error && <p className="muted small">불러오는 중...</p>}
      {data && (tab === "days" ? data.days : data.weeks).length === 0 && (
        <p className="muted small empty">아직 공유된 {tab === "days" ? "식단" : "주간 평가"}이 없어요</p>
      )}
      <ul className="food-cards">
        {tab === "days" && data?.days.map((d) => (
          <li key={d.date} className={`food-card stack ${open === d.date ? "open" : ""}`}>
            <div className="fc-row" onClick={() => setOpen(open === d.date ? null : d.date)}>
              <div className="fc-main">
                <div className="fc-name">{formatDate(d.date)}</div>
                <div className="fc-sub">
                  <span className="fc-serving muted">{d.meals.map((m) => m.label).join(" · ")}</span>
                  <span className="muted fc-kcal">{d.total.kcal}{d.target ? ` / ${d.target.kcal}` : ""}kcal</span>
                </div>
              </div>
            </div>
            {open === d.date && (
              <div className="fc-amount">
                <p className="small muted">탄 {d.total.carb}g · 단 {d.total.protein}g · 지 {d.total.fat}g · 나 {d.total.sodium ?? 0}mg</p>
                {d.meals.map((m) => (
                  <div key={m.meal}>
                    <p className="small"><b>{m.label}</b> <span className="muted">{m.kcal}kcal</span></p>
                    <ul className="mini-list">
                      {m.items.map((it, i) => (
                        <li key={i}><span>{it.place && <b>{it.place} </b>}{it.title}</span><span className="muted">{it.kcal}kcal</span></li>
                      ))}
                    </ul>
                  </div>
                ))}
                <Comments me={me} owner={owner} kind="days" id={d.date} />
              </div>
            )}
          </li>
        ))}
        {tab === "weeks" && data?.weeks.map((w) => (
          <li key={w.start} className={`food-card stack ${open === w.start ? "open" : ""}`}>
            <div className="fc-row" onClick={() => setOpen(open === w.start ? null : w.start)}>
              <div className="fc-main">
                <div className="fc-name">{weekLabel(w.start)}</div>
                <div className="fc-sub">
                  <span className="fc-serving muted">
                    {w.days.map((d) => (d.status === "scored" && d.grade ? GRADE_EMOJI[d.grade as Grade] : "·")).join(" ")}
                  </span>
                  <span className="fc-kcal">{w.score != null ? <b>{w.score}점</b> : <span className="muted">점수 없음</span>}</span>
                </div>
              </div>
            </div>
            {open === w.start && (
              <div className="fc-amount">
                {w.scoredDays > 0 && (
                  <ul className="week-sum">
                    {CRITERIA_ORDER.map((c) => {
                      const s = w.summary[c];
                      const unit = c === "kcal" ? "kcal" : c === "sodium" ? "mg" : "g";
                      return (
                        <li key={c}>
                          <span>{CRITERIA[c].label}</span>
                          <span className="muted">평균 <b>{s.avg.toLocaleString()}</b> / {s.target.toLocaleString()}{unit}</span>
                          <span className="wk-good">{s.good}/{w.scoredDays}일</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {w.ai && <div className="ai-comment"><p>{w.ai}</p>{w.memo && <p className="muted">메모: {w.memo}</p>}</div>}
                <Comments me={me} owner={owner} kind="weeks" id={w.start} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </Screen>
  );
}

function Comments({ me, owner, kind, id }: { me: Me; owner: string; kind: "days" | "weeks"; id: string }) {
  const [list, setList] = useState<Comment[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  useEffect(() => watchComments(owner, kind, id, setList), [owner, kind, id]);

  const send = async (t: string) => {
    if (!t.trim()) return;
    setError("");
    try {
      await addComment(me, owner, kind, id, t.trim());
      setText("");
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <div className="comments">
      {list.map((c) => (
        <div key={c.id} className="comment">
          <span><b>{c.name}</b> {c.text}</span>
          {(c.uid === me.uid || owner === me.uid) && (
            <button className="text-btn muted" onClick={() => deleteComment(owner, kind, id, c.id).catch((e) => setError(errText(e)))}>삭제</button>
          )}
        </div>
      ))}
      <div className="comment-input">
        <button className="like-btn" onClick={() => send("👍")} aria-label="좋아요">👍</button>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="댓글 남기기" maxLength={500} enterKeyHint="send" onKeyDown={(e) => e.key === "Enter" && send(text)} />
        <button className="primary" onClick={() => send(text)} disabled={!text.trim()}>등록</button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
