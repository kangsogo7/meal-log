// 오래 걸리는 AI 요청을 화면과 상관없이 뒤에서 돌림.
// 다른 탭으로 가거나 창을 닫아도 계속 진행되고, 끝나면 결과를 저장한 뒤 알림(토스트)을 띄움.
// 홈 화면으로 나가거나 폰을 잠가서 요청이 끊기면, 앱으로 돌아왔을 때 자동으로 다시 요청함.
import { useSyncExternalStore } from "react";
import { flash } from "./components/ui";

type State = { running: boolean; error: string };
type Job = { task: () => Promise<void>; done: string; fail: (e: unknown) => string; tries: number };

const jobs = new Map<string, State>();
const listeners = new Set<() => void>();
const idle: State = { running: false, error: "" };
/** 앱이 뒤로 가 있는 동안 실패해서, 돌아오면 다시 할 작업 */
const retryOnResume = new Map<string, Job>();
const MAX_TRIES = 3;

const emit = () => listeners.forEach((l) => l());
const set = (key: string, s: State) => {
  jobs.set(key, s);
  emit();
};

function start(key: string, job: Job) {
  set(key, { running: true, error: "" });
  let wentHidden = document.hidden;
  const onHide = () => {
    if (document.hidden) wentHidden = true;
  };
  document.addEventListener("visibilitychange", onHide);
  job.tries++;
  job
    .task()
    .then(() => {
      set(key, idle);
      flash(job.done);
    })
    .catch((e) => {
      // 앱이 뒤로 간 사이 끊긴 요청은 오류로 보지 않고, 돌아오면 다시
      if ((wentHidden || document.hidden) && job.tries < MAX_TRIES) {
        retryOnResume.set(key, job);
        if (!document.hidden) resume();
        return;
      }
      set(key, { running: false, error: job.fail(e) });
    })
    .finally(() => document.removeEventListener("visibilitychange", onHide));
}

function resume() {
  if (document.hidden) return;
  for (const [key, job] of retryOnResume) {
    retryOnResume.delete(key);
    start(key, job);
  }
}
document.addEventListener("visibilitychange", resume);

/** 같은 key가 이미 돌고 있으면 무시. done: 끝났을 때 띄울 문구 */
export function runInBackground(key: string, task: () => Promise<void>, opts: { done: string; fail: (e: unknown) => string }) {
  if (jobs.get(key)?.running) return;
  start(key, { task, done: opts.done, fail: opts.fail, tries: 0 });
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
