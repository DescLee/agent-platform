import { useEffect, useRef, useState } from "react";
import { cancelGreenboatExport, startGreenboatExport } from "./tauri";
import { greenboatReport, type GreenboatConversation, type GreenboatMessage } from "./greenboatReport";

type Payload = { jobId: string; date: string; type: string; text?: string; warnings?: string[];
  conversation?: { id: string; name: string }; messages?: GreenboatMessage[] };

export function useGreenboatExport(onReady: (date: string, report: string) => Promise<string>) {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [path, setPath] = useState("");
  const job = useRef<string | null>(null);
  const stop = useRef<() => void>(() => {});
  const mounted = useRef(true);
  const pendingSave = useRef<{ date: string; report: string } | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stop.current(); if (job.current) void cancelGreenboatExport(job.current).catch(() => {}); job.current = null; };
  }, []);

  const save = async () => {
    if (!pendingSave.current) return;
    setRunning(true);
    try {
      const result = await onReady(pendingSave.current.date, pendingSave.current.report);
      if (mounted.current) { setPath(result); setStatus("已生成新会话草稿，报告及提示词已填入输入框"); setSaveFailed(false); }
      pendingSave.current = null;
    } catch (error) {
      if (mounted.current) { setStatus(`保存失败：${String(error)}`); setSaveFailed(true); }
    } finally { if (mounted.current) setRunning(false); }
  };

  const start = async () => {
    if (job.current || running) return;
    const id = crypto.randomUUID();
    job.current = id; setRunning(true); setStatus("正在连接绿舟消息页…"); setPath(""); setSaveFailed(false);
    const conversations = new Map<string, GreenboatConversation>();
    let received = Date.now(), bytes = 0, exportDate = "", ending = false;
    let unlisten: (() => void) | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    stop.current = () => { unlisten?.(); if (timer) clearInterval(timer); };
    const finish = async (warnings: string[], failed: boolean) => {
      if (ending || job.current !== id) return;
      ending = true; stop.current(); job.current = null;
      if (failed && conversations.size === 0) { setRunning(false); setStatus(warnings.join("；")); return; }
      pendingSave.current = { date: exportDate, report: greenboatReport(exportDate, [...conversations.values()], warnings) };
      setStatus("正在生成新会话及总结草稿…"); await save();
    };
    try {
      const listen = (globalThis as any).__TAURI__?.event?.listen;
      if (!listen) throw new Error("请在桌面应用内执行");
      unlisten = await listen("greenboat-export", ({ payload: p }: { payload: Payload }) => {
        if (job.current !== id || p?.jobId !== id || ending) return;
        received = Date.now();
        if (/^\d{4}-\d{2}-\d{2}$/.test(p.date)) exportDate = p.date;
        if (p.type === "progress") setStatus(p.text || "正在采集…");
        if (p.type === "messages" && p.conversation && Array.isArray(p.messages)) {
          bytes += JSON.stringify(p).length;
          if (bytes > 8 * 1024 * 1024) {
            void cancelGreenboatExport(id).catch(() => {});
            void finish(["消息量达到导出上限，保存已采集部分"], true); return;
          }
          const c = conversations.get(p.conversation.id) || { ...p.conversation, messages: [], warnings: [] };
          const seen = new Set(c.messages.map(m => m.id));
          for (const m of p.messages) if (!seen.has(m.id)) { c.messages.push(m); seen.add(m.id); }
          c.warnings = [...new Set([...c.warnings, ...(p.warnings || [])])];
          conversations.set(c.id, c);
          setStatus(`已采集 ${conversations.size} 个会话，${[...conversations.values()].reduce((n, x) => n + x.messages.length, 0)} 条消息`);
        }
        if (p.type === "done" || p.type === "failed") void finish(p.warnings || [], p.type === "failed");
      });
      if (!mounted.current || job.current !== id) { unlisten?.(); return; }
      timer = setInterval(() => {
        if (Date.now() - received > 60000) {
          void cancelGreenboatExport(id).catch(() => {});
          void finish(["绿舟窗口已关闭、页面发生跳转或采集超时，仅保存已接收部分"], true);
        }
      }, 3000);
      await startGreenboatExport(id);
    } catch (error) { await finish([String(error)], true); }
  };
  const cancel = () => { if (job.current) { setStatus("正在停止，已采集内容将保存…"); void cancelGreenboatExport(job.current).catch(error => setStatus(String(error))); } };
  return { start, cancel, running, status, path, saveFailed, retrySave: save };
}
