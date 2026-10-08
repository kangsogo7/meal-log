// 그룹: 멤버를 초대해 서로의 식단을 날짜별로 보고 댓글을 남김
import { useEffect, useState } from "react";
import { addDays, formatDate, todayStr } from "../db";
import { BackIcon, flash, Screen, Sheet } from "../components/ui";
import { GRADE_EMOJI, type Grade } from "../nutrition";
import { weekLabel, weekStartOf } from "../weekly";
import { androidAppLink, clearInvite, inviteLink, isAndroid, isIOS, isKakao, isNativeApp, isStandalone, kakaoExternalLink, onInvite, pendingInvite, type Invite } from "../invite";
import {
  addComment, createGroup, createMe, deleteComment, joinGroup, leaveAll, leaveGroup, loadMe, renameGroup, renameMe,
  watchComments, watchGroup, watchGroupDay, watchGroups, watchGroupWeek, watchTodayCount,
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
  const appFirst = !!invite && isAndroid() && !isNativeApp();
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
  const [detail, setDetail] = useState<SharedDay | null>(null);
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
              <li key={uid} className="food-card empty-member">
                <Avatar uid={uid} name={name} />
                <b className="fc-name">{name}{uid === me.uid && <span className="muted small"> 나</span>}</b>
                <span className="muted small">기록 없음</span>
              </li>
            );
          }
          const ratio = d.target?.kcal ? d.total.kcal / d.target.kcal : 0;
          return (
            <li key={uid} className="food-card stack member-card" onClick={() => setDetail(d)}>
              <div className="member-head">
                <Avatar uid={uid} name={name} />
                <b className="fc-name">{name}{uid === me.uid && <span className="muted small"> 나</span>}</b>
                <span className="small"><b>{d.total.kcal.toLocaleString()}</b>{d.target && <span className="muted"> / {d.target.kcal.toLocaleString()}kcal</span>}</span>
              </div>
              {d.target && (
                <div className="progress"><div className={ratio > 1.05 ? "over" : ""} style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div>
              )}
              <div className="meal-chips">
                {d.meals.map((m) => <span key={m.meal}>{m.label} {m.grade ? GRADE_EMOJI[m.grade as Grade] : ""}</span>)}
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
              <li key={w.uid}>
                <span className="muted">{i + 1}</span>
                <span>{group.names[w.uid] ?? "멤버"}{w.uid === me.uid && <span className="muted small"> 나</span>}</span>
                <span>{w.grade ? GRADE_EMOJI[w.grade as Grade] : ""} <b>{w.score}점</b></span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted small">아직 점수가 매겨진 날이 없어요. 하루가 끝난 날부터 점수가 나와요.</p>
        )}
      </section>

      {members && <MembersSheet me={me} group={group} onClose={() => setMembers(false)} />}
      {detail && <MemberDay me={me} gid={gid} day={detail} name={group.names[detail.uid] ?? "멤버"} goal={group.goals[detail.uid]} onClose={() => setDetail(null)} />}
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
// 멤버 하루 식단 + 👍·댓글
// ---------------------------------------------------------------------------
function MemberDay({ me, gid, day, name, goal, onClose }: { me: Me; gid: string; day: SharedDay; name: string; goal?: string; onClose: () => void }) {
  const ratio = day.target?.kcal ? day.total.kcal / day.target.kcal : 0;
  return (
    <Screen
      left={<button className="icon-btn" onClick={onClose} aria-label="뒤로"><BackIcon /></button>}
      title={<span className="title-2line"><b>{name}</b><span className="muted small">{formatDate(day.date)}{goal ? ` · ${goal}` : ""}</span></span>}
    >
      <section className="card">
        <div className="row-between">
          <span className="muted">칼로리</span>
          <span><b className="big-num">{day.total.kcal.toLocaleString()}</b>{day.target && <span className="muted small"> / {day.target.kcal.toLocaleString()}kcal</span>}</span>
        </div>
        {day.target && <div className="progress"><div className={ratio > 1.05 ? "over" : ""} style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div>}
        <p className="muted small">탄 {day.total.carb}g · 단 {day.total.protein}g · 지 {day.total.fat}g · 나 {(day.total.sodium ?? 0).toLocaleString()}mg</p>
      </section>

      <section className="card">
        {day.meals.map((m) => (
          <div key={m.meal} className="member-meal">
            <div className="row-between"><b>{m.label} {m.grade ? GRADE_EMOJI[m.grade as Grade] : ""}</b><span className="muted small">{m.kcal}kcal</span></div>
            <ul className="mini-list">
              {m.items.map((it, i) => (
                <li key={i}><span>{it.place && <b>{it.place} </b>}{it.title}</span><span className="muted">{it.kcal}</span></li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="card">
        <Comments me={me} gid={gid} kind="days" id={day.id} owner={day.uid} />
      </section>
    </Screen>
  );
}

function Comments({ me, gid, kind, id, owner }: { me: Me; gid: string; kind: "days" | "weeks"; id: string; owner: string }) {
  const [list, setList] = useState<Comment[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  useEffect(() => watchComments(gid, kind, id, setList), [gid, kind, id]);

  const likes = list.filter((c) => c.text === "👍");
  const talk = list.filter((c) => c.text !== "👍");
  const myLike = likes.find((c) => c.uid === me.uid);

  const send = async (t: string) => {
    if (!t.trim()) return;
    setError("");
    try {
      await addComment(me, gid, kind, id, t.trim());
      setText("");
    } catch (e) {
      setError(errText(e));
    }
  };
  const toggleLike = () => (myLike ? deleteComment(gid, kind, id, myLike.id).catch((e) => setError(errText(e))) : send("👍"));

  return (
    <div className="comments">
      {likes.length > 0 && <p className="small"><span className="like-count">👍 {likes.length}</span> <span className="muted">{likes.map((c) => c.name).join(", ")}</span></p>}
      {talk.map((c) => (
        <div key={c.id} className="comment">
          <span><b>{c.name}</b> {c.text}</span>
          {(c.uid === me.uid || owner === me.uid) && (
            <button className="text-btn muted" onClick={() => deleteComment(gid, kind, id, c.id).catch((e) => setError(errText(e)))}>삭제</button>
          )}
        </div>
      ))}
      <div className="comment-input">
        <button className={`like-btn ${myLike ? "on" : ""}`} onClick={toggleLike} aria-label={myLike ? "좋아요 취소" : "좋아요"} aria-pressed={!!myLike}>👍</button>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="댓글 남기기" maxLength={500} enterKeyHint="send" onKeyDown={(e) => e.key === "Enter" && send(text)} aria-label="댓글" />
        <button className="primary" onClick={() => send(text)} disabled={!text.trim()}>등록</button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
