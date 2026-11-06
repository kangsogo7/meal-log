// AI에게 묻기 창 (음식 검색·재료로 요리 공통): 질문 입력 → 보내기 → 결과. 결과 아래 [다시 묻기][기록/추가] 한 줄
import type { ReactNode } from "react";
import { Sheet } from "./ui";

export type AiView = "ask" | "result";

export default function AiSheet({ view, prompt, onPrompt, onSend, onClose, onReAsk, waiting, error, actionLabel, onAction, star, children }: {
  view: AiView;
  prompt: string;
  onPrompt: (s: string) => void;
  onSend: () => void;
  onClose: () => void;
  onReAsk: () => void;
  waiting: boolean;
  error?: string;
  actionLabel: string;
  onAction: () => void;
  /** 결과 제목 오른쪽 (즐겨찾기 별 등) */
  star?: ReactNode;
  /** 결과 내용 */
  children?: ReactNode;
}) {
  const done = view === "result" && !waiting && !error && children;
  return (
    <Sheet
      title={view === "ask" ? "AI에게 묻기" : "AI 답"}
      onClose={onClose}
      action={done ? star : undefined}
      footer={
        view === "ask" ? (
          <button className="primary block big" disabled={!prompt.trim()} onClick={onSend}>보내기</button>
        ) : waiting ? undefined : (
          <div className="ai-actions">
            <button onClick={onReAsk}>다시 묻기</button>
            {done && <button className="primary" onClick={onAction}>{actionLabel}</button>}
          </div>
        )
      }
    >
      {view === "ask" ? (
        <div className="form">
          <textarea rows={4} value={prompt} onChange={(e) => onPrompt(e.target.value)} placeholder="예: 교촌치킨 허니콤보 한 마리" autoFocus />
        </div>
      ) : waiting ? (
        <div className="ai-wait">
          <p>AI가 찾는 중이에요</p>
          <p className="muted small">다른 앱을 써도 돼요</p>
        </div>
      ) : error || !children ? (
        <p className="error">{error || "답을 받지 못했어요."}</p>
      ) : (
        <div className="form">{children}</div>
      )}
    </Sheet>
  );
}
