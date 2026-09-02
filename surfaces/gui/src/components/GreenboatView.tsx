import { useEffect, useRef, useState } from "react";
import { getLvzhouConversations, getLvzhouConversationMessages } from "../api";

const textOf = (message: any) => message.text || `[${String(message.type || "新消息").replace("kim-", "")}]`;
const fmt = (value?: number) => value ? new Date(value).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "";

export function GreenboatView() {
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [startTime, setStartTime] = useState("00:00");
  const [endDate, setEndDate] = useState(today);
  const [endTime, setEndTime] = useState("23:59");
  const [filter, setFilter] = useState("all");
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const lastQuery = useRef("");
  const start = `${startDate}T${startTime}`;
  const end = `${endDate}T${endTime}`;

  useEffect(() => {
    let live = true;
    const key = `${start}|${end}|${filter}`;
    if (lastQuery.current === key) return () => { live = false; };
    if (start >= end) {
      setListLoading(false);
      setError("结束时间必须晚于开始时间");
      return () => { live = false; };
    }
    setListLoading(true);
    const timer = window.setTimeout(() => {
      lastQuery.current = key;
      setError("");
      getLvzhouConversations(start, end, filter)
        .then((result) => {
          if (!live) return;
          setItems(result.items || []);
          setSelected(null);
          setMessages([]);
          if ((result as any).error) setError((result as any).error);
        })
        .catch((reason) => live && setError(String(reason)))
        .finally(() => live && setListLoading(false));
    }, 1000);
    return () => { live = false; window.clearTimeout(timer); };
  }, [start, end, filter]);

  const open = (item: any) => {
    setSelected(item);
    setMessages([]);
    setDetailLoading(true);
    getLvzhouConversationMessages(item.conversation_id, start, end, filter)
      .then((result) => setMessages(result.messages || []))
      .catch((reason) => setError(String(reason)))
      .finally(() => setDetailLoading(false));
  };

  return (
    <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-paper">
      <header className="px-6 py-4 border-b border-line flex items-center gap-2 flex-wrap">
        <h1 className="text-[18px] font-semibold text-ink mr-auto">绿舟消息</h1>
        <span className="text-[12px] text-muted">开始</span>
        <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
        <span className="text-[12px] text-muted">结束</span>
        <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        <input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
        <select value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">全部消息</option><option value="only">仅未读</option><option value="exclude">仅已读</option>
        </select>
      </header>
      {error && <div className="px-6 py-2 text-[12px] text-danger">{error}</div>}
      <div className="flex flex-1 min-h-0">
        <aside className="w-[300px] shrink-0 border-r border-line overflow-y-auto">
          {listLoading ? <div className="h-full grid place-items-center text-[13px] text-muted">正在加载会话...</div> : items.length === 0 ? <div className="p-6 text-[13px] text-muted">没有符合条件的会话</div> : items.map((item) => <button key={item.conversation_id} onClick={() => open(item)} className={`w-full text-left px-4 py-3 border-b border-line hover:bg-chromeHover ${selected?.conversation_id === item.conversation_id ? "bg-chromeHover" : ""}`}><div className="flex justify-between"><span className="font-medium text-[13px] text-ink truncate">{item.name}</span><span className="text-[11px] text-muted">未读 {item.unread_count}</span></div><div className="text-[12px] text-muted mt-1">{item.type === 2 ? "群聊" : "单聊"} · {item.message_count} 条</div></button>)}
        </aside>
        <section className="flex-1 min-w-0 overflow-y-auto">
          {!selected ? <div className="h-full grid place-items-center text-[13px] text-muted">选择左侧会话查看详情</div> : detailLoading ? <div className="h-full grid place-items-center text-[13px] text-muted">正在加载消息...</div> : <><div className="px-6 py-4 border-b border-line font-semibold text-ink">{selected.name}</div><div className="p-6 space-y-3">{messages.map((message) => <article key={message.id} className="flex gap-3 text-[13px]"><time className="w-12 text-faint">{fmt(message.sent_time)}</time><div className={`rounded-md px-3 py-2 ${message.is_read ? "bg-panel" : "bg-accentSoft font-medium"}`}>{textOf(message)}</div></article>)}</div></>}
        </section>
      </div>
    </main>
  );
}
