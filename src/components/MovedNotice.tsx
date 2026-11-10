// 예전 주소(GitHub Pages)로 열었을 때: 새 주소로 옮기는 방법 안내
import { useState } from "react";
import { exportBackup } from "../backup";
import { Btn } from "./ui";
import { WEB_URL } from "../invite";

export const isOldAddress = () => location.hostname === "kangsogo7.github.io";

export default function MovedNotice() {
  const [busy, setBusy] = useState(false);
  const leave = async () => {
    if (!confirm("새 주소에서 그룹이 잘 보이는지 먼저 확인해 주세요.\n\n예전 주소의 나를 그룹에서 빼요. 예전 주소로 올렸던 기록과 거기 달린 댓글은 그룹에서 사라지고, 새 주소의 기록이 대신 보여요. 계속할까요?")) return;
    setBusy(true);
    try {
      const n = await (await import("../share")).leaveAllGroups();
      alert(n ? `그룹 ${n}개에서 예전 주소의 나를 뺐어요.` : "예전 주소로 들어가 있는 그룹이 없어요.");
    } catch {
      alert("인터넷 연결을 확인하고 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card moved">
      <h2>앱 주소가 바뀌었어요</h2>
      <ol className="small steps">
        <li>
          <Btn onClick={exportBackup}>백업 파일 저장</Btn> (아이폰은 "파일에 저장")
        </li>
        <li>
          <a href={WEB_URL} target="_blank" rel="noreferrer">새 주소 열기 ↗</a> → 공유(□↑) → 홈 화면에 추가
        </li>
        <li>새 앱의 설정 → 백업 불러오기 (그룹도 다시 들어가요) → Gemini 키 다시 입력</li>
        <li>
          새 앱에서 그룹이 보이면 <Btn onClick={leave} disabled={busy}>예전 그룹에서 나가기</Btn>
        </li>
        <li>이 예전 앱은 홈 화면에서 지워도 돼요.</li>
      </ol>
    </section>
  );
}
