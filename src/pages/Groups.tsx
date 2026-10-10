// 그룹: 멤버를 초대해 서로의 식단을 날짜별로 보고 댓글을 남김
import { useEffect, useState } from "react";
import { addDays, formatDate, todayStr } from "../db";
import { BackIcon, flash, Screen, Sheet } from "../components/ui";
import { GRADE_LABEL, type Grade } from "../nutrition";
import { CRITERIA, CRITERIA_ORDER, weekLabel, weekStartOf } from "../weekly";
import { androidAppLink, clearInvite, inviteLink, isAndroid, isIOS, isKakao, isNativeApp, isStandalone, kakaoExternalLink, onInvite, pendingInvite, type Invite } from "../invite";
import {
  addComment, createGroup, createMe, deleteComment, joinGroup, leaveAll, leaveGroup, loadMe, renameGroup, renameMe,
  watchComments, watchGroup, watchGroupDay, watchGroups, watchGroupWeek, watchMemberDay, watchMemberWeek, watchTodayCount,
  type Comment, type Group, type Me, type SharedDay, type SharedWeek,
} from "../share";

const errText = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  if (/permission|insufficient/i.test(m)) return "권한이 없어요. 그룹에서 나갔거나 코드가 바뀌었을 수 있어요.";
  if (/admin-restricted|operation-not-allowed/i.test(m)) return "Firebase에서 익명 로그인이 아직 꺼져 있어요.";
  if (/network|offline|unavailable/i.test(m)) return "인터넷 연결을 확인해 주세요.";
  return m;
};

/** 멤버 동그라미 (이름 첫 글자, 사람마다 다른 진하기) */
const SHADES = ["#2c4a40", "#4f6a61", "#7c958b", "#9aa8a3", "#c3ccc8"];
function Avatar({ uid, name, size = 32 }: { uid: string; name: string; size?: number }) {
  const i = [...uid].reduce((a, c) => a + c.charCodeAt(0), 0) % SHADES.length;
  return (
    <span className="avatar" style={{ width: size, height: size, background: SHADES[i], color: i < 3 ? "#f4f4f6" : "#2c4a40" }} aria-hidden>
      {[...name][0] ?? "?"}
    </span>
  );
}

export default function Groups() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [error, setError] = useState("");
  // 초대 링크로 들어온 초대 (참여하거나 닫을 때까지 기억)
  const [invite, setInvite] = useState<Invite | null>(pendingInvite);
  const [openFirst, setOpenFirst] = useState<string | null>(null);
  useEffect(() => onInvite(setInvite), []);
  useEffect(() => {
    loadMe().then(setMe).catch((e) => { setError(errText(e)); setMe(null); });
  }, []);
  const dismiss = () => {
    clearInvite();
    setInvite(null);
  };

  if (me === undefined) return <p className="muted small center-pad">불러오는 중...</p>;
  if (!me) return <Setup invite={invite} onDone={(m, gid) => { if (gid) { dismiss(); setOpenFirst(gid); } setMe(m); }} error={error} />;
  return <Home me={me} setMe={setMe} invite={invite} dismiss={dismiss} openFirst={openFirst} />;
}

/** 브라우저로 초대 링크를 열었을 때: 홈 화면 앱(아이폰)이나 설치한 앱(안드로이드)에서 참여하도록 안내 */
function InviteHelp({ invite }: { invite: Invite }) {
  if (isNativeApp()) return null;
  if (isAndroid()) {
    // 앱을 쓰는 사람이 브라우저에서 실수로 참여하지 않게 "앱에서 열기"를 가장 먼저
    return (
      <div className="invite-open">
        <a className="btn-link primary" href={androidAppLink(invite)}>식단 기록 앱에서 열기</a>
        {isKakao() && (
          <>
            <a className="btn-link outline" href={kakaoExternalLink(invite)}>크롬 등 다른 브라우저로 열기</a>
            <p className="muted small">카카오톡 안에서는 앱이 안 열릴 수 있어요. 그럴 땐 다른 브라우저로 연 다음 "앱에서 열기"를 눌러 주세요.</p>
          </>
        )}
      </div>
    );
  }
  if (isIOS() && !isStandalone()) {
    return (
      <p className="muted small invite-help">
        홈 화면에 추가한 앱을 쓰고 있다면, 그 앱의 그룹 탭에서 코드 <b>{invite.code}</b>를 입력해 주세요. 사파리와 홈 화면 앱은 기록이 따로 저장돼요.
      </p>
    );
  }
  return null;
}

function Setup({ invite, onDone, error: initialError }: { invite: Invite | null; onDone: (m: Me, gid?: string) => void; error: string }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  // 안드로이드 브라우저에서 초대를 열면 앱으로 보내고, 웹에서 참여는 한 번 더 눌러야 보이게
  const appFirst = !!invite && isAndroid() && !isNativeApp() && !invite.noApp;
  const [webJoin, setWebJoin] = useState(!appFirst);
  const start = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const m = await createMe(name.trim());
      const joined = invite ? await joinGroup(m, invite.code) : null;
      if (joined) flash(`${joined.name} 그룹에 들어왔어요`);
      onDone(m, joined?.id);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <header className="page-head"><h1>그룹</h1></header>
      <section className="card form">
        {invite ? (
          <>
            <p><b>{invite.group || "식단"}</b> 그룹 초대를 받았어요.{webJoin && " 닉네임만 정하면 바로 들어가요."}</p>
            <InviteHelp invite={invite} />
          </>
        ) : (
          <p className="small">그룹을 만들어 멤버를 초대하면, 서로의 하루 식단을 날짜별로 보고 댓글을 남길 수 있어요.</p>
        )}
        {webJoin ? (
          <>
            <label>닉네임
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="그룹에 보일 이름" maxLength={20} />
            </label>
            {error && <p className="error small">{error}</p>}
            <button className="primary block" onClick={start} disabled={busy || !name.trim()}>{busy ? "만드는 중..." : invite ? "시작하고 참여하기" : "시작하기"}</button>
          </>
        ) : (
          <button className="link small" onClick={() => setWebJoin(true)}>앱이 없어요 · 이 브라우저에서 참여</button>
        )}
      </section>
    </>
  );
}

function Home({ me, setMe, invite, dismiss, openFirst }: { me: Me; setMe: (m: Me | null) => void; invite: Invite | null; dismiss: () => void; openFirst: string | null }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(openFirst);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(me.name);

  useEffect(() => watchGroups(me, setGroups), [me.uid]);

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

  return (
    <>
      <header className="page-head row-between">
        <h1>그룹</h1>
        <button className="chip primary" onClick={() => setCreating(true)}>+ 새 그룹</button>
      </header>

      {invite && (
        <section className="card invite-card">
          {groups?.some((g) => g.code === invite.code) ? (
            <>
              <p><b>{invite.group || "이"}</b> 그룹에 이미 들어가 있어요.</p>
              <button className="primary block" onClick={() => { const g = groups.find((x) => x.code === invite.code)!; dismiss(); setOpen(g.id); }}>그룹 열기</button>
            </>
          ) : (
            <>
              <p><b>{invite.group || "식단"}</b> 그룹 초대를 받았어요.</p>
              <InviteHelp invite={invite} />
              <div className="row-between invite-actions">
                <button onClick={dismiss}>나중에</button>
                <button className="primary" disabled={busy === "invite"} onClick={() => run("invite", async () => {
                  const g = await joinGroup(me, invite.code);
                  dismiss();
                  flash(`${g.name} 그룹에 들어왔어요`);
                  setOpen(g.id);
                })}>{busy === "invite" ? "참여하는 중..." : "참여하기"}</button>
              </div>
            </>
          )}
        </section>
      )}

      <section className="card row-between">
        {renaming ? (
          <div className="input-with-star" style={{ flex: 1 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} aria-label="닉네임" />
            <button className="text-btn" onClick={() => run("rename", async () => {
              if (!name.trim()) return;
              await renameMe(me, name.trim());
              setMe({ ...me, name: name.trim() });
              setRenaming(false);
            })}>저장</button>
          </div>
        ) : (
          <>
            <span><span className="muted small">닉네임 </span><b>{me.name}</b></span>
            <button className="text-btn" onClick={() => setRenaming(true)}>이름 변경</button>
          </>
        )}
      </section>

      <div className="list-head"><span className="muted">내 그룹 {groups?.length ?? 0}개</span></div>
      {groups === null && <p className="muted small">불러오는 중...</p>}
      {groups?.length === 0 && <p className="muted small empty">아직 그룹이 없어요. 새 그룹을 만들거나 초대 코드로 참여해 보세요.</p>}
      <ul className="food-cards">
        {groups?.map((g) => <GroupCard key={g.id} g={g} onOpen={() => setOpen(g.id)} />)}
      </ul>

      <section className="card form join-card">
        <label>초대 코드로 그룹 참여
          <div className="input-with-star">
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="6자리 코드" maxLength={8} autoCapitalize="characters" />
            <button className="primary" disabled={busy === "join" || code.trim().length < 6} onClick={() => run("join", async () => {
              const g = await joinGroup(me, code);
              setCode("");
              flash(`${g.name} 그룹에 들어왔어요`);
              setOpen(g.id);
            })}>참여</button>
          </div>
        </label>
        {error && <p className="error small">{error}</p>}
      </section>

      <button className="link small leave-btn" onClick={() => {
        if (!confirm("그룹 기능을 그만 쓸까요? 모든 그룹에서 나가고 올린 기록이 지워져요. 폰에 있는 기록은 그대로예요.")) return;
        run("leave", async () => {
          await leaveAll(me);
          setMe(null);
        });
      }}>그룹 기능 그만 쓰기</button>

      {creating && <NewGroupSheet me={me} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpen(id); }} />}
      {open && <GroupScreen me={me} gid={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function GroupCard({ g, onOpen }: { g: Group; onOpen: () => void }) {
  const [today, setToday] = useState<number | null>(null);
  useEffect(() => watchTodayCount(g.id, setToday), [g.id]);
  return (
    <li className="food-card" onClick={onOpen}>
      <div className="fc-main">
        <div className="row-between"><b className="fc-name">{g.name}</b><span className="muted small">멤버 {g.members.length}명</span></div>
        <div className="avatars">{g.members.slice(0, 6).map((m) => <Avatar key={m} uid={m} name={g.names[m] ?? "?"} size={28} />)}</div>
        <span className="muted small">{today == null ? "" : `오늘 ${today}명 기록`}</span>
      </div>
    </li>
  );
}

function NewGroupSheet({ me, onClose, onCreated }: { me: Me; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      onCreated(await createGroup(me, name.trim()));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="새 그룹" onClose={onClose}>
      <div className="form">
        <label>그룹 이름
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 컷팅 같이해요" maxLength={30} />
        </label>
        {error && <p className="error small">{error}</p>}
        <button className="primary block" onClick={create} disabled={busy || !name.trim()}>{busy ? "만드는 중..." : "만들기"}</button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// 그룹 화면: 날짜별 멤버 식단 + 이번 주 그룹 점수
// ---------------------------------------------------------------------------
function GroupScreen({ me, gid, onClose }: { me: Me; gid: string; onClose: () => void }) {
  const [group, setGroup] = useState<Group | null | undefined>(undefined);
  const [date, setDate] = useState(todayStr());
  const [days, setDays] = useState<SharedDay[]>([]);
  const [weeks, setWeeks] = useState<SharedWeek[]>([]);
  const [members, setMembers] = useState(false);
  const [view, setView] = useState<{ uid: string; tab: "day" | "week" } | null>(null);
  const start = weekStartOf(date);

  useEffect(() => watchGroup(gid, setGroup), [gid]);
  useEffect(() => watchGroupDay(gid, date, setDays), [gid, date]);
  useEffect(() => watchGroupWeek(gid, start, setWeeks), [gid, start]);
  useEffect(() => {
    if (group === null) onClose(); // 그룹에서 나감
  }, [group]);

  if (!group) return null;
  // 나를 맨 위에, 그다음 기록한 사람, 기록 없는 사람 순
  const order = [...group.members].sort((a, b) =>
    Number(b === me.uid) - Number(a === me.uid) || Number(!!days.find((d) => d.uid === b)?.meals.length) - Number(!!days.find((d) => d.uid === a)?.meals.length),
  );
  const ranked = weeks.filter((w) => group.members.includes(w.uid) && w.score != null).sort((a, b) => b.score! - a.score!);

  return (
    <Screen
      left={<button className="icon-btn" onClick={onClose} aria-label="뒤로"><BackIcon /></button>}
      title={group.name}
      right={<button className="text-btn" onClick={() => setMembers(true)}>멤버</button>}
    >
      <div className="group-date">
        <button className="ghost" onClick={() => setDate(addDays(date, -1))} aria-label="이전 날">◀</button>
        <b>{formatDate(date)}</b>
        <button className="ghost" onClick={() => setDate(addDays(date, 1))} aria-label="다음 날" disabled={date >= todayStr()}>▶</button>
      </div>

      <ul className="food-cards">
        {order.map((uid) => {
          const d = days.find((x) => x.uid === uid && x.meals.length);
          const name = group.names[uid] ?? "멤버";
          if (!d) {
            return (
              <li key={uid} className="food-card empty-member" onClick={() => setView({ uid, tab: "day" })}>
                <Avatar uid={uid} name={name} />
                <b className="fc-name">{name}{uid === me.uid && <span className="muted small"> 나</span>}</b>
                <span className="muted small">기록 없음</span>
              </li>
            );
          }
          const ratio = d.target?.kcal ? d.total.kcal / d.target.kcal : 0;
          return (
            <li key={uid} className="food-card stack member-card" onClick={() => setView({ uid, tab: "day" })}>
              <div className="member-head">
                <Avatar uid={uid} name={name} />
                <b className="fc-name">{name}{uid === me.uid && <span className="muted small"> 나</span>}</b>
                <span className="small"><b>{d.total.kcal.toLocaleString()}</b>{d.target && <span className="muted"> / {d.target.kcal.toLocaleString()}kcal</span>}</span>
              </div>
              {d.target && (
                <div className="progress"><div className={ratio > 1.05 ? "over" : ""} style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div>
              )}
              <div className="meal-chips">
                {d.meals.map((m) => <span key={m.meal}>{m.grade && <i className={`grade-dot ${m.grade}`} aria-hidden />} {m.label}</span>)}
              </div>
              <div className="row-between muted small">
                <span>단 {Math.round(d.total.protein)}g · 탄 {Math.round(d.total.carb)}g · 지 {Math.round(d.total.fat)}g</span>
                <CommentCount gid={gid} id={d.id} />
              </div>
            </li>
          );
        })}
      </ul>

      <section className="card group-week">
        <div className="row-between"><h2>이번 주 그룹 점수</h2><span className="muted small">{weekLabel(start)}</span></div>
        {ranked.length ? (
          <ol className="rank">
            {ranked.map((w, i) => (
              <li key={w.uid} onClick={() => setView({ uid: w.uid, tab: "week" })}>
                <span className="muted">{i + 1}</span>
                <span>{group.names[w.uid] ?? "멤버"}{w.uid === me.uid && <span className="muted small"> 나</span>}</span>
                <span>{w.grade && <span className={`grade-chip ${w.grade}`}>{GRADE_LABEL[w.grade as Grade]}</span>} <b>{w.score}점</b> <span className="muted">›</span></span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted small">아직 점수가 매겨진 날이 없어요. 하루가 끝난 날부터 점수가 나와요.</p>
        )}
      </section>

      {members && <MembersSheet me={me} group={group} onClose={() => setMembers(false)} />}
      {view && <MemberScreen me={me} gid={gid} group={group} uid={view.uid} initialDate={date} initialTab={view.tab} onClose={() => setView(null)} />}
    </Screen>
  );
}

function CommentCount({ gid, id }: { gid: string; id: string }) {
  const [list, setList] = useState<Comment[]>([]);
  useEffect(() => watchComments(gid, "days", id, setList), [gid, id]);
  const likes = list.filter((c) => c.text === "👍").length;
  const talk = list.length - likes;
  if (!list.length) return null;
  return <span>{[likes && `👍 ${likes}`, talk && `댓글 ${talk}`].filter(Boolean).join(" · ")}</span>;
}

function MembersSheet({ me, group, onClose }: { me: Me; group: Group; onClose: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(group.name);
  const [error, setError] = useState("");
  const link = inviteLink(group.code, group.name);
  const invite = `"${group.name}" 식단 그룹에 초대해요. 링크를 누르면 바로 들어올 수 있어요.
${link}
(앱 그룹 탭에서 코드 ${group.code} 입력해도 돼요)`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(group.code);
      flash("초대 코드를 복사했어요");
    } catch {
      flash(group.code);
    }
  };
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: "식단 그룹 초대", text: invite });
      else {
        await navigator.clipboard.writeText(invite);
        flash("초대 문구를 복사했어요");
      }
    } catch {
      /* 공유 창을 닫음 */
    }
  };
  return (
    <Sheet title="멤버" onClose={onClose}>
      <div className="form">
        <div className="card inset invite-box">
          <span className="muted small">초대 코드</span>
          <div className="row-between">
            <b className="invite-code">{group.code}</b>
            <button onClick={copy}>코드 복사</button>
          </div>
          <button className="primary block" onClick={share}>초대 보내기</button>
          <span className="muted small">받은 사람이 그룹 탭에서 코드를 입력하면 들어와요</span>
        </div>

        <ul className="member-list">
          {group.members.map((m) => (
            <li key={m}>
              <Avatar uid={m} name={group.names[m] ?? "?"} size={34} />
              <b>{group.names[m] ?? "멤버"}{m === me.uid && <span className="muted small"> 나</span>}</b>
              {group.owner === m && <span className="badge">방장</span>}
              <span className="muted small">{group.goals[m] ?? ""}</span>
            </li>
          ))}
        </ul>

        {renaming ? (
          <div className="input-with-star">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} aria-label="그룹 이름" />
            <button className="text-btn" onClick={async () => {
              if (!name.trim()) return;
              try {
                await renameGroup(group, name.trim());
                setRenaming(false);
              } catch (e) {
                setError(errText(e));
              }
            }}>저장</button>
          </div>
        ) : (
          <div className="row-between">
            <button className="link small" onClick={() => setRenaming(true)}>그룹 이름 변경</button>
            <button className="link small danger-text" onClick={async () => {
              if (!confirm(`"${group.name}" 그룹에서 나갈까요? 이 그룹에 올린 내 기록이 지워져요.`)) return;
              try {
                await leaveGroup(me, group);
                onClose();
              } catch (e) {
                setError(errText(e));
              }
            }}>그룹 나가기</button>
          </div>
        )}
        {error && <p className="error small">{error}</p>}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// 멤버 화면: 하루 식단(끼니별 카드 + 끼니마다 👍·댓글) | 주간 평가(AI 한줄평·코멘트 + 응원)
// ---------------------------------------------------------------------------
const MEAL_ORDER = ["breakfast", "lunch", "snack", "dinner"];
const MEAL_NAME: Record<string, string> = { breakfast: "아침", lunch: "점심", snack: "간식", dinner: "저녁" };

function MemberScreen({ me, gid, group, uid, initialDate, initialTab, onClose }: {
  me: Me; gid: string; group: Group; uid: string; initialDate: string; initialTab: "day" | "week"; onClose: () => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const [date, setDate] = useState(initialDate);
  const [start, setStart] = useState(weekStartOf(initialDate));
  const [day, setDay] = useState<SharedDay | null | undefined>(undefined);
  const [week, setWeek] = useState<SharedWeek | null | undefined>(undefined);
  const [comments, setComments] = useState<Comment[]>([]);
  useEffect(() => {
    setDay(undefined);
    return watchMemberDay(gid, uid, date, setDay);
  }, [gid, uid, date]);
  useEffect(() => {
    setWeek(undefined);
    return watchMemberWeek(gid, uid, start, setWeek);
  }, [gid, uid, start]);
  useEffect(() => {
    if (!day) {
      setComments([]);
      return;
    }
    return watchComments(gid, "days", day.id, setComments);
  }, [gid, day?.id]);
  const name = group.names[uid] ?? "멤버";
  const goal = group.goals[uid];
  const isMe = uid === me.uid;
  const meals = day?.meals ?? [];
  const missing = MEAL_ORDER.filter((k) => !meals.some((m) => m.meal === k)).map((k) => MEAL_NAME[k]);
  const ratio = day?.target?.kcal ? day.total.kcal / day.target.kcal : 0;

  return (
    <Screen
      left={<button className="icon-btn" onClick={onClose} aria-label="뒤로"><BackIcon /></button>}
      title={<span className="title-2line"><b>{isMe ? "나의 하루" : `${name}의 하루`}</b>{goal && <span className="muted small">{goal}</span>}</span>}
    >
      <div className="member-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "day"} className={tab === "day" ? "on" : ""} onClick={() => setTab("day")}>하루 식단</button>
        <button role="tab" aria-selected={tab === "week"} className={tab === "week" ? "on" : ""} onClick={() => setTab("week")}>주간 평가</button>
      </div>

      {tab === "day" ? (
        <>
          <section className="member-hero">
            <div className="hero-date">
              <button onClick={() => setDate(addDays(date, -1))} aria-label="이전 날">◀</button>
              <b>{formatDate(date)}</b>
              <button onClick={() => setDate(addDays(date, 1))} aria-label="다음 날" disabled={date >= todayStr()}>▶</button>
            </div>
            {day && meals.length ? (
              <>
                <div className="row-between hero-kcal">
                  <b>{day.total.kcal.toLocaleString()}{day.target && <span> / {day.target.kcal.toLocaleString()} kcal</span>}</b>
                  {day.target && (
                    <span className="hero-pill">
                      {day.target.kcal >= day.total.kcal ? `${(day.target.kcal - day.total.kcal).toLocaleString()} 남음` : `${(day.total.kcal - day.target.kcal).toLocaleString()} 초과`}
                    </span>
                  )}
                </div>
                {day.target && <div className="hero-bar"><div style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div>}
                <div className="hero-macros">
                  <span>탄 {Math.round(day.total.carb)}g</span><span>단 {Math.round(day.total.protein)}g</span>
                  <span>지 {Math.round(day.total.fat)}g</span><span>나 {(day.total.sodium ?? 0).toLocaleString()}mg</span>
                </div>
              </>
            ) : (
              <p className="hero-empty">{day === undefined ? "불러오는 중..." : "이 날은 기록이 없어요"}</p>
            )}
          </section>

          {day && meals.map((m) => (
            <article key={m.meal} className="card meal-post">
              <div className="post-head">
                <i className={`grade-dot ${m.grade ?? ""}`} aria-hidden />
                <b>{m.label}{m.grade ? ` · ${GRADE_LABEL[m.grade as Grade]}` : ""}</b>
                <span className="muted small">{m.kcal}kcal</span>
              </div>
              {m.items.map((it, i) => (
                <div key={i} className="post-item">
                  <span>{it.place && <b>{it.place} </b>}{it.title}</span>
                  <span className="muted small">
                    {it.ing && it.ing.join(", ") !== it.title ? `재료: ${it.ing.join(" · ")}` : `탄 ${Math.round(it.carb)}g · 단 ${Math.round(it.protein)}g · 지 ${Math.round(it.fat)}g`}
                  </span>
                </div>
              ))}
              <Comments me={me} gid={gid} kind="days" id={day.id} owner={uid} meal={m.meal} list={comments.filter((c) => c.meal === m.meal)} />
            </article>
          ))}
          {meals.length > 0 && missing.length > 0 && <p className="muted small missing-meals">{missing.join(" · ")}은 기록이 없어요</p>}
          {day && comments.some((c) => !c.meal) && (
            <section className="card">
              <p className="small muted">하루 전체 댓글</p>
              <Comments me={me} gid={gid} kind="days" id={day.id} owner={uid} list={comments.filter((c) => !c.meal)} />
            </section>
          )}
        </>
      ) : (
        <MemberWeek me={me} gid={gid} uid={uid} name={name} week={week} start={start} setStart={setStart} />
      )}
    </Screen>
  );
}

const DOW = ["월", "화", "수", "목", "금", "토", "일"];

function MemberWeek({ me, gid, uid, name, week, start, setStart }: {
  me: Me; gid: string; uid: string; name: string; week: SharedWeek | null | undefined; start: string; setStart: (s: string) => void;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  useEffect(() => {
    if (!week) {
      setComments([]);
      return;
    }
    return watchComments(gid, "weeks", week.id, setComments);
  }, [gid, week?.id]);
  return (
    <>
      <div className="group-date">
        <button className="ghost" onClick={() => setStart(addDays(start, -7))} aria-label="지난주">◀</button>
        <span className="muted">{weekLabel(start)}</span>
        <button className="ghost" onClick={() => setStart(addDays(start, 7))} aria-label="다음 주" disabled={addDays(start, 7) > todayStr()}>▶</button>
      </div>
      {week === undefined && <p className="muted small">불러오는 중...</p>}
      {week === null && <p className="muted small">이 주에는 공유된 평가가 없어요</p>}
      {week && (
        <>
          <section className="card member-week">
            <div className="week-score">
              {week.grade && <span className={`grade-chip ${week.grade}`}>{GRADE_LABEL[week.grade as Grade]}</span>}
              <b>{week.score != null ? `${week.score}점` : "점수 없음"}</b>
              <span className="muted small">기록한 {week.scoredDays}일 평균</span>
            </div>
            <div className="mw-days">
              {week.days.map((d, i) => (
                <span key={d.date}>
                  {DOW[i]}
                  <i className={`wd-dot ${d.status === "scored" && d.grade ? d.grade : d.status === "today" ? "today" : "none"}`} aria-hidden />
                  <small>{d.status === "scored" ? d.score : d.status === "today" ? "오늘" : ""}</small>
                </span>
              ))}
            </div>
            {week.scoredDays > 0 && (
              <div className="mw-sum">
                {CRITERIA_ORDER.map((c) => (
                  <span key={c} className={`mw-cell ${c}`}><i aria-hidden />{CRITERIA[c].label} <b>{week.summary[c].good}/{week.scoredDays}일</b></span>
                ))}
              </div>
            )}
          </section>
          <section className="card ai-card">
            <div className="ai-head"><span className="ai-badge">AI</span><b>이번 주 한줄평</b></div>
            {week.ai ? <p>{week.ai}</p> : <p className="muted small">아직 AI 한줄평을 받지 않았어요</p>}
            {week.memo && (
              <div className="memo-box">
                <span className="muted small">{uid === me.uid ? "내 코멘트" : `${name}의 코멘트`}</span>
                <p>{week.memo}</p>
              </div>
            )}
          </section>
          <section className="card">
            <Comments me={me} gid={gid} kind="weeks" id={week.id} owner={uid} list={comments} placeholder="이번 주 응원 남기기" />
          </section>
        </>
      )}
    </>
  );
}

/** 👍와 댓글. list는 보여 줄 댓글(끼니별로 나눈 것). 끼니 댓글은 💬를 눌러야 입력칸이 열림 */
function Comments({ me, gid, kind, id, owner, meal, list, placeholder = "댓글 남기기" }: {
  me: Me; gid: string; kind: "days" | "weeks"; id: string; owner: string; meal?: string; list: Comment[]; placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const likes = list.filter((c) => c.text === "👍");
  const talk = list.filter((c) => c.text !== "👍");
  const myLike = likes.find((c) => c.uid === me.uid);

  const send = async (t: string) => {
    if (!t.trim()) return;
    setError("");
    try {
      await addComment(me, gid, kind, id, t.trim(), meal);
      setText("");
    } catch (e) {
      setError(errText(e));
    }
  };
  const toggleLike = () => (myLike ? deleteComment(gid, kind, id, myLike.id).catch((e) => setError(errText(e))) : send("👍"));
  const showInput = open || !meal;

  return (
    <div className="comments">
      <div className="react-row">
        <button className={`react-btn ${myLike ? "on" : ""}`} onClick={toggleLike} aria-pressed={!!myLike} aria-label={myLike ? "좋아요 취소" : "좋아요"}>👍 {likes.length || ""}</button>
        {meal && <button className="react-btn" onClick={() => setOpen(!open)} aria-expanded={open}>💬 {talk.length || "댓글"}</button>}
        {likes.length > 0 && <span className="muted small">{likes.map((c) => c.name).join(", ")}</span>}
      </div>
      {talk.map((c) => (
        <div key={c.id} className="bubble-row">
          <Avatar uid={c.uid} name={c.name} size={26} />
          <div className="bubble"><b>{c.name}</b><span>{c.text}</span></div>
          {(c.uid === me.uid || owner === me.uid) && (
            <button className="text-btn muted" onClick={() => deleteComment(gid, kind, id, c.id).catch((e) => setError(errText(e)))}>삭제</button>
          )}
        </div>
      ))}
      {showInput && (
        <div className="comment-input">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} maxLength={500} enterKeyHint="send" onKeyDown={(e) => e.key === "Enter" && send(text)} aria-label="댓글" />
          <button className="primary" onClick={() => send(text)} disabled={!text.trim()}>등록</button>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
