import { useEffect, useLayoutEffect, useState } from "react";
import {
  dingtalkAction,
  disconnectConnector,
  getCloudStatus,
  getConnectors,
  getMcpServers,
  getSlackStatus,
  type CloudStatus,
  type Connector,
  type McpServer,
  type SlackStatus,
} from "../../api";
import { McpServerDetail } from "./CustomMcp";
import { ConnectorBadge } from "../../connectors/ConnectorIcon";
import { AllowlistBlock, ConnectorTools, ListeningSessionsBlock, UnauthorizedBlock } from "../ManageTabs";
import { AccountsDetail } from "./AccountsDetail";
import { AvailableDetail } from "./AvailableDetail";
import { CalendarDetail } from "./CalendarDetail";
import { ConnectorsList } from "./ConnectorsList";
import { GithubDetail } from "./GithubDetail";
import { GmailDetail } from "./GmailDetail";
import { HubSpotDetail } from "./HubSpotDetail";
import { SlackDetail } from "./SlackDetail";
import { GRP } from "./ui";

// Connectors surface = LIST ⇄ per-connector DETAIL SUBPAGE (UX-DECISIONS §21). The
// Integrations sub-nav never grows per-connector items; detail pages live behind a
// `‹ Connectors` breadcrumb. Connectors without a bespoke page get GenericDetail so
// every connected row navigates from day one.

export interface DetailProps {
  c: Connector;
  cloud: CloudStatus | null;
  slack: SlackStatus | null; // live Slack health (relay/sign-in/tokens); null elsewhere
  onChanged: () => void;
}

// Bespoke pages register here; everything else gets GenericDetail below.
const DETAIL_PAGES: Record<string, (p: DetailProps) => JSX.Element> = {
  slack: (p) => <SlackDetail {...p} />,
  gmail: (p) => <GmailDetail {...p} />,
  google_calendar: (p) => <CalendarDetail {...p} />,
  hubspot: (p) => <HubSpotDetail {...p} />,
  github: (p) => <GithubDetail {...p} />,
  // Generic multi-account connectors (accounts.py layer) share one page.
  notion: (p) => <AccountsDetail {...p} />,
  attio: (p) => <AccountsDetail {...p} />,
  posthog: (p) => <AccountsDetail {...p} />,
  mixpanel: (p) => <AccountsDetail {...p} />,
  amplitude: (p) => <AccountsDetail {...p} />,
  apollo: (p) => <AccountsDetail {...p} />,
  hunter: (p) => <AccountsDetail {...p} />,
};

export function ConnectorsSection({ onNavigate }: { onNavigate?: () => void } = {}) {
  const [detail, setDetail] = useState<string | null>(null);
  useLayoutEffect(() => { onNavigate?.(); }, [detail, onNavigate]);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [connectorsLoaded, setConnectorsLoaded] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const [slack, setSlack] = useState<SlackStatus | null>(null);

  const refresh = () => {
    getConnectors()
      .then((items) => {
        setConnectors(items);
        setConnectorsLoaded(true);
      })
      .catch(() => {
        setConnectors([]);
        setConnectorsLoaded(true);
      });
    getMcpServers().then(setMcpServers).catch(() => setMcpServers([]));
    getCloudStatus().then(setCloud).catch(() => setCloud(null));
    getSlackStatus().then(setSlack).catch(() => setSlack(null));
  };
  useEffect(() => {
    refresh();
    // Poll: recent senders/parked arrive over time; sign-in + managed connects finish
    // in the system browser and surface on the next tick.
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  // While an MCP test/sign-in is in flight, poll fast so the chip flips to its
  // result (Live / Error / Needs sign-in) without the user touching anything.
  const mcpBusy = mcpServers.some((s) => s.status === "authorizing");
  useEffect(() => {
    if (!mcpBusy) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [mcpBusy]);

  // Custom MCP entries route as "mcp:<name>" so they can never collide with a
  // connector detail page of the same name.
  if (detail?.startsWith("mcp:")) {
    const s = mcpServers.find((x) => "mcp:" + x.name === detail);
    return (
      <div>
        <button
          className="text-[13px] text-accent mb-3"
          data-testid="connectors-breadcrumb"
          onClick={() => setDetail(null)}
        >
          ‹ 返回连接器
        </button>
        {!s ? (
          <div className="text-[13px] text-muted">正在加载…</div>
        ) : (
          <McpServerDetail server={s} onChanged={refresh} onGone={() => setDetail(null)} />
        )}
      </div>
    );
  }

  if (detail) {
    const c = connectors.find((x) => x.name === detail);
    const Page = DETAIL_PAGES[detail];
    return (
      <div>
        <button
          className="text-[13px] text-accent mb-3"
          data-testid="connectors-breadcrumb"
          onClick={() => setDetail(null)}
        >
          ‹ 返回连接器
        </button>
        {!c ? (
          <div className="text-[13px] text-muted">正在加载…</div>
        ) : !c.connected ? (
          /* Pre-connect page (§38). When a connect completes, the poll flips
             c.connected and this same route re-renders as the connected page. */
          <AvailableDetail c={c} cloud={cloud} onChanged={refresh} />
        ) : Page ? (
          <Page c={c} cloud={cloud} slack={slack} onChanged={refresh} />
        ) : (
          <GenericDetail
            c={c}
            cloud={cloud}
            slack={slack}
            onChanged={refresh}
            onGone={() => setDetail(null)}
          />
        )}
      </div>
    );
  }

  return (
    <ConnectorsList
      connectors={connectors}
      mcpServers={mcpServers}
      loading={!connectorsLoaded}
      cloud={cloud}
      slack={slack}
      onOpen={setDetail}
      onChanged={refresh}
    />
  );
}

// Fallback detail page: status header + the connector's existing config blocks
// (tools; allow-list/parked/listening for two-way) + Disconnect. Bespoke pages
// (Slack/Gmail/HubSpot) replace this one connector at a time.
function GenericDetail({
  c,
  cloud: _cloud,
  slack: _slack,
  onChanged,
  onGone,
}: DetailProps & { onGone: () => void }) {
  const [resetting, setResetting] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const resetDingtalk = async () => {
    setResetConfirmOpen(false);
    setResetting(true);
    setResetError(null);
    try {
      const result = await dingtalkAction("reset");
      if (!result.ok) {
        setResetError(result.error || "重置连接失败");
        return;
      }
      onChanged();
      onGone();
    } catch {
      setResetError("重置连接失败，请稍后重试");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3.5 mb-5">
        <ConnectorBadge connector={c} size={44} title={c.title} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold tracking-tight leading-tight">{c.title}</h2>
          <div className="text-[13px] text-muted flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-ok" />
            {c.account || (c.auth === "none" ? "内置" : "已连接")}
          </div>
        </div>
        {(c.auth !== "none" || c.name === "dingtalk") && (
          <button
            className="text-[13px] text-danger/80 hover:text-danger shrink-0"
            disabled={resetting}
            onClick={async () => {
              if (c.name === "dingtalk") {
                setResetConfirmOpen(true);
                return;
              } else {
                await disconnectConnector(c.name);
              }
              onChanged();
              onGone();
            }}
          >
          {c.name === "dingtalk" ? (resetting ? "重置中…" : "重置连接") : "断开连接"}
          </button>
        )}
      </div>

      {resetError && (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger" role="alert">
          {resetError}
        </div>
      )}

      <div className={GRP}>
        <ConnectorTools c={c} onChanged={onChanged} />
      </div>

      {c.two_way && (
        <div className={GRP + " mt-4"}>
          <AllowlistBlock c={c} onChanged={onChanged} />
          <UnauthorizedBlock c={c} onChanged={onChanged} />
          {/* Channel subscriptions are a chat-platform concept — GitHub is two_way via the
              relay (inbound mentions) but has no channels. */}
          {c.channels && <ListeningSessionsBlock c={c} />}
        </div>
      )}

      {resetConfirmOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4" role="dialog" aria-modal="true" aria-labelledby="dingtalk-reset-title">
          <div className="w-full max-w-[420px] rounded-xl border border-line bg-panel p-5 shadow-xl">
            <h3 id="dingtalk-reset-title" className="text-[16px] font-semibold text-ink">重置钉钉连接？</h3>
            <p className="mt-2 text-[13px] leading-5 text-muted">这会清除本机钉钉登录状态，之后需要重新扫码或登录。</p>
            <div className="mt-5 flex justify-end gap-3">
              <button className="text-[13px] text-muted hover:text-ink" onClick={() => setResetConfirmOpen(false)}>取消</button>
              <button className="rounded-md bg-danger px-3 py-1.5 text-[13px] text-white hover:bg-danger/90" onClick={() => void resetDingtalk()}>确认重置</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
