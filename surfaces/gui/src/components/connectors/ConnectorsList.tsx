import { useEffect, useRef, useState } from "react";
import { connectorCliAction, getConnectors, type CloudStatus, type Connector, type McpServer, type SlackStatus } from "../../api";
import { ConnectorBadge } from "../../connectors/ConnectorIcon";
import { AVAILABLE_CONNECTOR_NAMES, CLI_CONNECTOR_NAMES } from "../../connectors/catalog";
import { AddConnectionModal } from "./AddConnectionModal";
import { AddMcpModal, CustomMcpGroup } from "./CustomMcp";
import { CHIP_OK, CHIP_OFF, CHIP_WARN, GRP, GRP_H, PILL_QUIET, ROW } from "./ui";

// The Connectors LIST (UX-DECISIONS §21): connected first in their own inset group —
// rows navigate to the connector's detail subpage; problems surface as a chip in the
// list, never one click deep. Available connectors below with a Connect pill.
// Custom MCP servers (UX-034) render as their own group after Connected; the "Add
// custom server" affordance sits at the top of the page (owner ruling: top).

const CONNECTOR_COPY: Record<string, { title: string; blurb: string }> = {
  browser: { title: "浏览器", blurb: "读取网页并执行浏览器操作。" },
  lvzhou: { title: "绿舟", blurb: "连接本机正在运行的绿舟客户端，启用后提供绿舟能力。" },
  github: { title: "GitHub", blurb: "处理议题、拉取请求、仓库文件和持续集成状态。" },
  figma: { title: "Figma", blurb: "读取和管理 Figma 设计文件与团队资源。" },
  dingtalk: { title: "钉钉", blurb: "使用消息、通讯录、文档与知识库、日历、待办、邮箱、审批和智能协作能力。" },
  feishu: { title: "飞书", blurb: "使用消息与群组、通讯录、云文档与表格、任务、会议、妙记、邮箱和审批。" },
  wecom: { title: "企业微信", blurb: "使用通讯录、消息、文档、会议、日程、待办、表格和智能文档。" },
  tencent_docs: { title: "腾讯文档", blurb: "通过远程服务读取和管理授权范围内的腾讯文档与表格。" },
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
  const [cliBusy, setCliBusy] = useState<string | null>(null);
  const [cliActionType, setCliActionType] = useState<"install" | "connect" | null>(null);
  const [cliHover, setCliHover] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const cliOperation = useRef(0);

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
  const available = connectors.filter((c) => !c.connected && c.available && AVAILABLE_CONNECTOR_NAMES.has(c.name) && match(c));
  const customMcp = mcpServers.filter((s) => s.name !== "granola" && (!q || s.name.toLowerCase().includes(q)));
  const shown = available;
  const connectingC = connecting ? connectors.find((c) => c.name === connecting) : null;

  const waitForCliAuth = async (name: string, operation: number) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 2500));
      if (cliOperation.current !== operation) return false;
      const latest = await getConnectors();
      if (latest.find((item) => item.name === name)?.authenticated) return true;
    }
    return false;
  };

  return (
    <div>
      {toast && <div className="pointer-events-none fixed left-1/2 top-7 z-[70] -translate-x-1/2 rounded-xl border border-line bg-panel px-4 py-3 text-[13px] text-ink shadow-xl" role="status">{toast}</div>}
      {cliBusy && cliActionType === "install" && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-paper/70 backdrop-blur-[2px]" role="status"><div className="flex items-center gap-3 rounded-xl border border-line bg-panel px-5 py-4 text-[14px] text-ink shadow-xl"><span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-accent" /><span>首次使用或更新需要安装连接器依赖，正在安装中，请稍后...</span></div></div>}
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
              onMouseEnter={() => setCliHover(c.name)}
              onMouseLeave={() => setCliHover(null)}
              onClick={(e) => {
                e.stopPropagation();
                if (c.name === "lvzhou") {
                  if (cliBusy === c.name) return;
                  setCliBusy(c.name);
                  setCliActionType("connect");
                  void connectorCliAction(c.name, "connect").then(result => {
                    setToast(result.ok ? "已打开绿舟3.0，请在客户端完成登录" : result.error || "打开绿舟3.0失败");
                    onChanged();
                  }).catch(() => setToast("打开绿舟3.0失败，请重试"))
                    .finally(() => { setCliBusy(null); setCliActionType(null); });
                  return;
                }
                if (CLI_CONNECTOR_NAMES.has(c.name)) {
                  if (cliBusy === c.name && cliActionType === "connect") {
                    cliOperation.current += 1;
                    void connectorCliAction(c.name, "cancel");
                    setCliBusy(null);
                    setCliActionType(null);
                    setToast("已取消连接");
                    return;
                  }
                  setCliBusy(c.name);
                  const operation = ++cliOperation.current;
                  const action = c.cli_ready ? "connect" : "install";
                  setCliActionType(action);
                  if (action === "install") setToast("第一次安装时间比较久，请耐心等待");
                  void connectorCliAction(c.name, action).then(async (result) => {
                    const connected = result.ok && result.started
                      ? await waitForCliAuth(c.name, operation)
                      : result.ok;
                    if (cliOperation.current !== operation) return;
                    setToast(connected ? (action === "install" ? "安装成功" : "连接成功") : (action === "install" ? "安装失败" : "连接失败或已超时"));
                    onChanged();
                  }).catch(() => {
                    if (cliOperation.current === operation) setToast(action === "install" ? "安装失败" : "连接失败");
                  }).finally(() => {
                    if (cliOperation.current === operation) {
                      setCliBusy(null);
                      setCliActionType(null);
                    }
                  });
                  return;
                }
                setConnecting(c.name);
              }}
            >
              {c.name === "lvzhou" ? (cliBusy === c.name ? "连接中…" : "连接") : cliBusy === c.name ? (cliActionType === "connect" ? (cliHover === c.name ? "取消" : "连接中…") : "安装中…") : CLI_CONNECTOR_NAMES.has(c.name) ? (c.cli_ready ? (c.authenticated ? "已连接" : "连接") : "安装") : "连接"}
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
  if (CLI_CONNECTOR_NAMES.has(c.name)) return CONNECTOR_COPY[c.name]?.blurb || c.blurb;
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
