import { useState } from "react";
import { connectorCliAction, type CloudStatus, type Connector } from "../../api";
import { ConnectorBadge } from "../../connectors/ConnectorIcon";
import { GRP, GRP_H, ROW } from "./ui";

export function LvzhouDetail({ c, onChanged }: { c: Connector; cloud?: CloudStatus | null; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const detect = async () => {
    setBusy(true); setError("");
    const result = await connectorCliAction("lvzhou", "connect");
    if (!result.ok) setError(result.error || "未检测到绿舟");
    onChanged(); setBusy(false);
  };
  return <div data-testid="lvzhou-detail">
    <div className="flex items-center gap-3.5 mb-5"><ConnectorBadge connector={c} size={44} title={c.title} /><div className="min-w-0 flex-1"><h2 className="text-[20px] font-semibold">绿舟</h2><div className="text-[13px] text-muted">{c.blurb}</div></div><span className={c.connected ? "text-[13px] text-success" : "text-[13px] text-muted"}>{c.connected ? "已就绪" : "未运行"}</span></div>
    {!c.connected && <button className="rounded-lg bg-accent px-3 py-2 text-[13px] text-white" onClick={() => void detect()} disabled={busy}>{busy ? "检测中…" : "连接"}</button>}
    {c.connected && <><div className={GRP_H}>能力</div><div className={GRP}><div className={ROW}><span className="text-[13px]">绿舟消息</span><span className="text-[12px] text-muted">发送本人自聊消息</span></div></div></>}
    {error && <div className="mt-3 text-[13px] text-danger" role="alert">{error}</div>}
  </div>;
}
