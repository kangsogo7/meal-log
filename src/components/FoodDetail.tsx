// 음식 상세 (공통): 이름·출처 → 기준 설명·참고한 곳 → 먹은 양 → 영양성분(고치면 직접 입력).
// 음식 검색 상세, AI 답(검색·재료로 요리)에서 같이 씀
import type { ReactNode } from "react";
import type { WebSource } from "../gemini";
import { AmountEditor, portionNutrients, withNutrients, type Portion } from "../portion";
import { NutrientEditor, SourceLinks, SrcTag } from "./ui";

export default function FoodDetail({ title, tag, note, sources, action, portion, onPortion }: {
  title: string;
  tag?: string;
  note?: string;
  /** AI 답이면 참고한 곳 (undefined면 표시 안 함) */
  sources?: WebSource[];
  /** 이름 오른쪽 (즐겨찾기 별 등) */
  action?: ReactNode;
  portion: Portion;
  /** manual: 영양성분 숫자를 직접 고쳤을 때 true */
  onPortion: (p: Portion, manual?: boolean) => void;
}) {
  return (
    <div className="food-detail-body">
      <div className="food-detail-head">
        <div className="ai-name"><b>{title}</b>{tag && <SrcTag label={tag} />}{action && <span className="food-detail-action">{action}</span>}</div>
        {note && <p className="muted small">{note}</p>}
        {sources && <SourceLinks sources={sources} />}
      </div>
      <AmountEditor portion={portion} onChange={(p) => onPortion(p)} />
      <NutrientEditor n={portionNutrients(portion)} onChange={(n) => onPortion(withNutrients(portion, n), true)} />
    </div>
  );
}
