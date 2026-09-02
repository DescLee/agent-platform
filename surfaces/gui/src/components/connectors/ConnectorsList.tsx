import { useEffect, useState } from "react";
import { dingtalkAction, type CloudStatus, type Connector, type McpServer, type SlackStatus } from "../../api";
import { ConnectorBadge } from "../../connectors/ConnectorIcon";
import { AddConnectionModal } from "./AddConnectionModal";
import { AddMcpModal, CustomMcpGroup } from "./CustomMcp";
import { CHIP_OK, CHIP_OFF, CHIP_WARN, GRP, GRP_H, PILL_QUIET, ROW } from "./ui";

// The Connectors LIST (UX-DECISIONS §21): connected first in their own inset group —
// rows navigate to the connector's detail subpage; problems surface as a chip in the
// list, never one click deep. Available connectors below with a Connect pill.
// Custom MCP servers (UX-034) render as their own group after Connected; the "Add
// custom server" affordance sits at the top of the page (owner ruling: top).

const AVAILABLE_CONNECTORS = new Set(["figma", "dingtalk"]);
const CONNECTOR_COPY: Record<string, { title: string; blurb: string }> = {
  browser: { title: "浏览器", blurb: "读取网页并执行浏览器操作。" },
  github: { title: "GitHub", blurb: "处理议题、拉取请求、仓库文件和持续集成状态。" },
  figma: { title: "Figma", blurb: "读取和管理 Figma 设计文件与团队资源。" },
  dingtalk: { title: "钉钉", blurb: "访问钉钉消息、文档、日历和组织协作能力。" },
  notion: { title: "Notion", blurb: "搜索、读取和管理 Notion 页面与数据库。" },
};

export function ConnectorsList({
  connectors,
  mcpServers,
  loading,
  cloud,
  slack,
  onOpen,
  onChanged,
}: {
  connectors: Connector[];
  mcpServers: McpServer[];
  loading: boolean;
  cloud: CloudStatus | null;
  slack: SlackStatus | null;
  onOpen: (name: string) => void;
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [connecting, setConnecting] = useState<string | null>(null);
  const [addingMcp, setAddingMcp] = useState(false);
  const [dingtalkBusy, setDingtalkBusy] = useState(false);
  const [dingtalkActionType, setDingtalkActionType] = useState<"install" | "connect" | null>(null);
  const [dingtalkHover, setDingtalkHover] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const open = () => setAddingMcp(true);
    window.addEventListener("ocw-add-mcp", open);
    return () => window.removeEventListener("ocw-add-mcp", open);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const search = (event: Event) => setFilter((event as CustomEvent<string>).detail || "");
    window.addEventListener("ocw-connector-search", search);
    return () => window.removeEventListener("ocw-connector-search", search);
  }, []);

  const q = filter.trim().toLowerCase();
  const match = (c: Connector) => !q || c.title.toLowerCase().includes(q) || c.name.includes(q) || CONNECTOR_COPY[c.name]?.title.toLowerCase().includes(q);
  const connected = connectors.filter((c) => c.connected && match(c));
  const available = connectors.filter((c) => !c.connected && c.available && AVAILABLE_CONNECTORS.has(c.name) && match(c));
  const customMcp = mcpServers.filter((s) => s.name !== "granola" && (!q || s.name.toLowerCase().includes(q)));
  const shown = available;
  const connectingC = connecting ? connectors.find((c) => c.name === connecting) : null;

  return (
    <div>
      {toast && <div className="pointer-events-none fixed left-1/2 top-7 z-[70] -translate-x-1/2 rounded-xl border border-line bg-panel px-4 py-3 text-[13px] text-ink shadow-xl" role="status">{toast}</div>}
      {dingtalkBusy && dingtalkActionType === "install" && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-paper/70 backdrop-blur-[2px]" role="status"><div className="flex items-center gap-3 rounded-xl border border-line bg-panel px-5 py-4 text-[14px] text-ink shadow-xl"><span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-accent" /><span>第一次安装时间比较久，请耐心等待</span></div></div>}
      {/* No cloud strip here anymore (§26): the sidebar's account row is the permanent
          sign-in home, and the connect modals keep their inline sign-in panes. */}
      {connected.length > 0 && (
        <>
          <div className={GRP_H + " !mt-0"}>已连接 · {connected.length}</div>
          <div className={GRP}>
            {connected.map((c) => (
              <button
                key={c.name}
                data-testid={`connector-${c.name}`}
                className={ROW + " w-full text-left hover:bg-paper/60"}
                onClick={() => onOpen(c.name)}
              >
                <ConnectorBadge connector={c} size={34} title={CONNECTOR_COPY[c.name]?.title || c.title} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-[13px]">{CONNECTOR_COPY[c.name]?.title || c.title}</span>
                  <span className="block text-[12px] text-muted">{statusLine(c)}</span>
                </span>
                {healthChip(c, slack)}
                <span className="text-faint text-[14px] shrink-0">›</span>
              </button>
            ))}
          </div>
        </>
      )}

      <CustomMcpGroup servers={customMcp} onOpen={(name) => onOpen(`mcp:${name}`)} onChanged={onChanged} />

      <div className={GRP_H}>可用连接器</div>
      <div className={GRP}>
        {loading ? (
          <div className={ROW + " text-[13px] text-muted"} role="status">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />
            <span>正在加载连接器…</span>
          </div>
        ) : shown.map((c) => (
          /* The row navigates to the pre-connect detail page (§38); the pill
             stays the fast path straight into the modal. */
          <button
            key={c.name}
            data-testid={`connector-${c.name}`}
            className={ROW + " w-full text-left hover:bg-paper/60"}
            onClick={() => onOpen(c.name)}
          >
            <ConnectorBadge connector={c} size={34} title={c.title} />
            <span className="min-w-0 flex-1">
              <span className="font-medium text-[13px]">{CONNECTOR_COPY[c.name]?.title || c.title}</span>
              <span className="block text-[12px] text-muted truncate">{CONNECTOR_COPY[c.name]?.blurb || c.blurb}</span>
            </span>
            <span
              className={PILL_QUIET + " cursor-pointer"}
              role="button"
              onMouseEnter={() => setDingtalkHover(true)}
              onMouseLeave={() => setDingtalkHover(false)}
              onClick={(e) => {
                e.stopPropagation();
                if (c.name === "dingtalk") {
                  if (dingtalkBusy && dingtalkActionType === "connect") {
                    setDingtalkBusy(false);
                    setDingtalkActionType(null);
                    setToast("已取消连接");
                    return;
                  }
                  setDingtalkBusy(true);
                  const action = c.cli_ready ? "connect" : "install";
                  setDingtalkActionType(action);
                  if (action === "install") setToast("第一次安装时间比较久，请耐心等待");
                  void dingtalkAction(action).then((result) => {
                    setToast(result.ok ? (action === "install" ? "安装成功" : "连接成功") : (action === "install" ? "安装失败" : "连接失败"));
                    onChanged();
                  }).catch(() => setToast(action === "install" ? "安装失败" : "连接失败")).finally(() => { setDingtalkBusy(false); setDingtalkActionType(null); });
                  return;
                }
                setConnecting(c.name);
              }}
            >
              {dingtalkBusy && c.name === "dingtalk" ? (dingtalkActionType === "connect" ? (dingtalkHover ? "取消" : "连接中…") : "安装中…") : c.name === "dingtalk" ? (c.cli_ready ? (c.authenticated ? "已连接" : "连接") : "安装") : "连接"}
            </span>
          </button>
        ))}
        {!loading && shown.length === 0 && (
          <div className={ROW + " text-[13px] text-muted"}>没有匹配的连接器。</div>
        )}
      </div>

      {connectingC && (
        <AddConnectionModal
          c={connectingC}
          cloud={cloud}
          onClose={() => setConnecting(null)}
          onChanged={onChanged}
        />
      )}
      {addingMcp && <AddMcpModal onClose={() => setAddingMcp(false)} onChanged={onChanged} />}
    </div>
  );
}

function statusLine(c: Connector): string {
  if (c.name === "slack" && c.mode === "relay") {
    const n = c.workspaces?.length ?? 0;
    return `${n} 个工作区 · 中继模式`;
  }
  if ((c.accounts?.length ?? 0) > 1) return `${c.accounts!.length} 个账号`;
  if ((c.portals?.length ?? 0) > 1) return `${c.portals!.length} 个门户`;
  if (c.auth === "none") return "内置";
  return c.account || "已连接";
}

function healthChip(c: Connector, slack: SlackStatus | null) {
  // Slack relay gets a LIVE chip from /v1/connectors/slack/status — problems
  // surface in the list, never one click deep. Named honestly per layer; we
  // never claim "Slack↔cloud down" (the desktop can't see that leg).
  if (c.name === "slack" && c.mode === "relay" && slack) {
    if (!slack.signed_in) return <span className={CHIP_WARN}>● 需要登录</span>;
    if (slack.relay.state === "offline") return <span className={CHIP_OFF}>● 离线</span>;
    if (slack.relay.state === "reconnecting")
      return <span className={CHIP_WARN}>● 正在重连</span>;
    if (Object.values(slack.teams).some((t) => !t.token_ok))
      return <span className={CHIP_WARN}>⚠ 凭证异常</span>;
    return <span className={CHIP_OK}>● 在线</span>;
  }
  if (c.two_way && c.connected) return <span className={CHIP_OK}>● 在线</span>;
  return <span className={CHIP_OK}>● 已就绪</span>;
}
