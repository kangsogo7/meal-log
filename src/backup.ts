// 백업 파일 저장·불러오기 (설정 화면, 예전 주소의 "주소가 바뀌었어요" 안내 공통)
import { db } from "./db";
import { isIOS } from "./invite";
import type { GroupBackup } from "./share";

// 그룹(Firebase) 코드는 필요할 때만 불러옴 (앱 첫 화면을 가볍게)
const share = () => import("./share");

// 이 폰·이 주소의 그룹 계정에 묶인 값은 백업에서 빼고 불러옴 (새 주소에서는 다른 계정이라 다시 올려야 함)
const LOCAL_ONLY = new Set(["settings", "shareOn", "shareSigs"]);

export async function exportBackup() {
  let groups: GroupBackup | null = null;
  try {
    groups = await (await share()).groupsForBackup();
  } catch {
    // 인터넷이 없으면 그룹 정보 없이
  }
  const data = {
    app: "meal-log",
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: await db.entries.toArray(),
    body: await db.body.toArray(),
    saved: await db.saved.toArray(),
    sets: await db.sets.toArray(),
    groups: await db.groups.toArray(),
    activity: await db.activity.toArray(),
    // API 키는 백업 파일에 넣지 않음
    kv: (await db.kv.toArray()).filter((r) => r.key !== "settings"),
    // 그룹 공유: 닉네임과 초대 코드 (불러올 때 같은 그룹에 다시 들어감)
    share: groups,
  };
  const name = `식단기록-백업-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  // 아이폰은 공유 창으로 (파일에 저장). 홈 화면 앱에서는 다운로드가 잘 안 될 수 있어서
  const file = new File([blob], name, { type: "application/json" });
  if (isIOS() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function importBackup(file: File) {
  let data;
  try {
    data = JSON.parse(await file.text());
    if (data.app !== "meal-log" || !Array.isArray(data.entries)) throw new Error();
  } catch {
    alert("올바른 백업 파일이 아니에요.");
    return;
  }
  if (!confirm(`식단 ${data.entries.length}개, 체중 ${data.body?.length ?? 0}개를 가져올게요.\n지금 기록은 모두 바뀌어요. 계속할까요?`)) return;
  try {
    await db.transaction("rw", [db.entries, db.body, db.saved, db.sets, db.groups, db.activity, db.kv], async () => {
      await Promise.all([db.entries.clear(), db.body.clear(), db.saved.clear(), db.sets.clear()]);
      if (data.activity) {
        await db.activity.clear();
        await db.activity.bulkPut(data.activity);
      }
      await db.entries.bulkAdd(data.entries);
      await db.body.bulkAdd(data.body ?? []);
      await db.saved.bulkPut(data.saved ?? []);
      await db.sets.bulkAdd(data.sets ?? []);
      // 그룹: 백업에 있으면 그대로, 예전 백업이면 "기본" 그룹 유지하고 ⭐를 거기로
      if (data.groups?.length) {
        await db.groups.clear();
        await db.groups.bulkAdd(data.groups);
      } else {
        const def = await db.groups.orderBy("order").first();
        if (def) await db.saved.toCollection().modify((s) => { if (s.fav) { s.groupId = def.id; delete s.fav; } });
      }
      await db.kv.bulkPut((data.kv ?? []).filter((r: { key: string }) => !LOCAL_ONLY.has(r.key)));
    });
  } catch {
    alert("가져오지 못했어요. 백업 파일을 다시 확인해 주세요.");
    return;
  }
  // 이 주소에서 이미 그룹에 들어가 있으면 공유를 다시 켜고 올림
  await share().then((m) => m.afterMembershipChange()).catch(() => {});
  const saved = data.share as GroupBackup | null | undefined;
  if (saved?.groups?.length && confirm(`그룹 ${saved.groups.map((g) => `"${g.name}"`).join(", ")}에 "${saved.name}" 이름으로 다시 들어갈까요?`)) {
    try {
      const n = await (await share()).rejoinGroups(saved);
      alert(n ? `가져왔어요. 그룹 ${n}개에 다시 들어갔어요.` : "가져왔어요. 그룹은 없어졌거나 들어가지 못했어요. 초대 링크로 들어가 주세요.");
    } catch {
      alert("가져왔어요. 그룹에는 들어가지 못했어요. 인터넷 연결을 확인하고 초대 링크로 들어가 주세요.");
    }
    return;
  }
  alert("가져왔어요.");
}
