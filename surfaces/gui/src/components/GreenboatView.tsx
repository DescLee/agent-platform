import { useEffect, useState } from "react";
import { isTauri, openExternal, openGreenboatWindow } from "../tauri";
import { useGreenboatExport } from "../useGreenboatExport";

const GREENBOAT_URL = "https://imwork.syncotechai.com:8663/woa/im/messages";

export function GreenboatView({ onReady }: { onReady: (date: string, report: string) => Promise<string> }) {
  const exportJob = useGreenboatExport(onReady);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const listen = (globalThis as any).__TAURI__?.event?.listen;
    if (!listen) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen("greenboat-login-status", (event: { payload?: { logged_in?: boolean | null } }) => {
      if (!disposed) setLoggedIn(typeof event.payload?.logged_in === "boolean" ? event.payload.logged_in : null);
    }).then((stop: () => void) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(() => { if (!disposed) setError("登录状态监听失败，请重新打开操作页"); });
    return () => { disposed = true; unlisten?.(); };
  }, []);

  if (loggedIn === true || exportJob.running || exportJob.status) {
    return (
      <main className="flex-1 min-w-0 min-h-0 overflow-y-auto bg-paper">
        <section className="mx-auto max-w-3xl px-7 py-8">
          <header className="mb-8 flex items-center gap-3">
            <h1 className="text-[20px] font-semibold text-ink">绿舟助理</h1>
            <span className="rounded-full bg-panel px-2.5 py-1 text-[12px] text-success">{loggedIn ? "已登录" : "等待登录检测"}</span>
          </header>
          <h2 className="mb-3 text-[13px] font-medium text-muted">操作项</h2>
          <ul aria-label="绿舟助理操作项" className="overflow-hidden rounded-xl border border-line">
            <li className="flex items-center gap-4 bg-panel px-5 py-4">
              <div className="min-w-0 flex-1">
                <h3 className="text-[14px] font-medium text-ink">总结下今天的消息</h3>
                <p className="mt-1 text-[12px] text-muted">统计今日已读、未读及@我的消息，生成带附件和提示词的新会话草稿。</p>
              </div>
              <button type="button" disabled={exportJob.running || loggedIn !== true} onClick={() => void exportJob.start()}
                className="shrink-0 rounded-lg bg-accent px-4 py-2 text-[13px] text-white disabled:opacity-50">
                {exportJob.running ? "采集中…" : "开始汇总"}
              </button>
            </li>
          </ul>
          <p className="mt-3 text-[12px] text-muted">采集会打开会话，可能标记消息为已读。运行期间请勿手动切换绿舟会话。</p>
          {exportJob.status && <p role="status" className="mt-4 text-[13px] text-ink">{exportJob.status}</p>}
          {exportJob.path && <p className="mt-2 break-all text-[12px] text-muted">{exportJob.path}</p>}
          {exportJob.running && <button type="button" onClick={exportJob.cancel} className="mt-3 text-[13px] text-muted">停止采集</button>}
          {exportJob.saveFailed && <button type="button" disabled={exportJob.running} onClick={() => void exportJob.retrySave()} className="mt-3 text-[13px] text-accent">重试保存</button>}
        </section>
      </main>
    );
  }

  return (
    <main className="flex-1 min-w-0 min-h-0 flex items-center justify-center bg-paper">
      <section className="flex flex-col items-center gap-4">
        <h1 className="text-[18px] font-semibold text-ink">绿舟助理</h1>
        <p className="text-[13px] text-muted">
          {error || (loggedIn === null ? "等待登录检测..." : loggedIn ? "已登录" : "未登录")}
        </p>
        <button
          type="button"
          className="rounded-lg bg-accent px-5 py-2.5 text-[13px] text-white hover:opacity-90"
          onClick={() => {
            if (isTauri()) void openGreenboatWindow().then((opened) => {
              if (!opened) setError("绿舟窗口打开失败，请重启桌面应用后重试");
              else setError("");
            });
            else openExternal(GREENBOAT_URL);
          }}
        >
          登录绿舟
        </button>
      </section>
    </main>
  );
}
