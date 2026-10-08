// 오래 걸리는 AI 요청을 화면과 상관없이 뒤에서 돌림.
// 다른 탭으로 가거나 창을 닫아도 계속 진행되고, 끝나면 결과를 저장한 뒤 알림(토스트)을 띄움.
import { useSyncExternalStore } from "react";
import { flash } from "./components/ui";

type State = { running: boolean; error: string };
const jobs = new Map<string, State>();
const listeners = new Set<() => void>();
const idle: State = { running: false, error: "" };

const emit = () => listeners.forEach((l) => l());
const set = (key: string, s: State) => {
  jobs.set(key, s);
  emit();
};

/** 같은 key가 이미 돌고 있으면 무시. done: 끝났을 때 띄울 문구 */
export function runInBackground(key: string, task: () => Promise<void>, opts: { done: string; fail: (e: unknown) => string }) {
  if (jobs.get(key)?.running) return;
  set(key, { running: true, error: "" });
  task()
    .then(() => {
      set(key, idle);
      flash(opts.done);
    })
    .catch((e) => set(key, { running: false, error: opts.fail(e) }));
}

/** 화면에서 그 작업의 진행 상태 보기 */
export function useJob(key: string): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => jobs.get(key) ?? idle,
  );
}
