// 음식 화면 공통 본문 (기록 수정 · 자주 먹는 것 음식·세트 · 나도 기록하기)
// [위 칸] → 영양 요약 → 먹은 양 → 재료·구성 → [버튼 줄] → [아래 칸], 덩어리 사이 16px
import type { ComponentProps, ReactNode } from "react";
import type { Nutrients } from "../db";
import { AmountEditor, type Portion } from "../portion";
import { EditIcon, NutrientGrid, PartsList } from "./ui";

export default function FoodView({ top, n, portion, onPortion, parts, actions, children }: {
  /** 맨 위 (이름 입력·끼니 고르기 등) */
  top?: ReactNode;
  n: Nutrients;
  /** 먹은 양 조절 (없으면 숨김) */
  portion?: Portion;
  onPortion?: (p: Portion) => void;
  /** 재료·구성 목록 (없으면 숨김) */
  parts?: ComponentProps<typeof PartsList>;
  /** 버튼 줄 (보통 FoodActions) */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="form food-view">
      {top}
      <NutrientGrid n={n} />
      {portion && onPortion && <AmountEditor portion={portion} onChange={onPortion} />}
      {parts && <PartsList {...parts} />}
      {actions}
      {children}
    </div>
  );
}

const ShareIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 15V3" /><path d="M7 8l5-5 5 5" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></svg>
);

/** [✎ 영양성분 고치기] [⇧ 공유] 버튼 줄 */
export function FoodActions({ onEdit, onShare }: { onEdit: () => void; onShare: () => void }) {
  return (
    <div className="entry-actions">
      <button onClick={onEdit}><EditIcon />영양성분 고치기</button>
      <button onClick={onShare}><ShareIcon />공유</button>
    </div>
  );
}
