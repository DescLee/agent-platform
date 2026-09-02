import { useEffect, useState } from "react";
import {
  allowUser,
  connectConnector,
  connectorCliAction,
  connectManaged,
  connectMcpBacked,
  disallowUser,
  getSettings,
  getSubscriptions,
  resolveUnauthorized,
  unsubscribeChannel,
  updateConnectorTools,
  type CloudStatus,
  type Connector,
  type Subscription,
  type ModelSettings,
} from "../api";
import { Icon } from "./Icon";
import { CLI_CONNECTOR_NAMES } from "../connectors/catalog";
import { CloudSignInInline, CloudStatusPending } from "./connectors/CloudSignIn";
import { ModelChecklist } from "./ModelChecklist";
import { ProviderCards, ProviderForm, ProviderMark, useProviderSetup } from "../providers/ProviderSetup";

// "2h ago"-style label for the providers' Last-used line (null when never used).
const relTime = (epoch?: number | null): string | null => {
  if (!epoch) return null;
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - epoch));
  if (secs < 90) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

// Shared tab bodies for the Settings and Integrations pages (the old top-tab ManageModal was retired
// when Settings/Activity became full-page surfaces): ModelsTab → Settings ▸ Models; ConnectorsTab →
// Integrations ▸ Connectors (the MCP tab retired into the Connectors page, UX-034).
const SEC_H = "text-[11px] uppercase tracking-[0.05em] text-faint font-semibold";
const BTN_BORDERED =
  "text-[13px] px-3 py-1.5 rounded-lg border border-line bg-paper hover:border-lineStrong shrink-0";
const BTN_ACCENT = "text-[13px] px-3 py-1.5 rounded-lg bg-accent text-white shrink-0 disabled:opacity-50";

/** Two-letter initials for a chip/avatar (first+last word, else first two chars). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// -- Configure Models tab (UX-021: the shared provider gallery + key form) ----
// Settings ▸ Models reuses onboarding §39's ProviderCards/ProviderForm so the two
// surfaces can't drift. Settings-only extras: per-card "used Nh ago", a "Remove
// key…" affordance, the global composer-picker card (gallery view), and the
// per-provider ModelChecklist / read-only model preview (form view).
export function ModelsTab() {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const refreshSettings = () => getSettings().then(setSettings).catch(() => setSettings(null));
  const ps = useProviderSetup({ onSaved: refreshSettings });
  useEffect(() => {
    refreshSettings();
  }, []);

  if (!settings) return <div className="text-[13px] text-muted">Loading…</div>;

  const info = ps.info;
  const knownNames = ps.providers.map((p) => p.name);

  if (ps.sel === null) {
    return (
      <div>
        <div className="flex items-center justify-end mb-3">
          <button
            className={BTN_ACCENT + " inline-flex items-center gap-1.5"}
            onClick={() => ps.openProviderBlank("custom")}
            data-testid="set-custom-provider"
          >
            <Icon name="plus" size={14} /> 自定义
          </button>
        </div>
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-2.5">
          <ProviderCards ps={ps} tp="set" gridClass="contents" lastUsed />
          {ps.providers.filter((p) => (p.name === "custom" || p.name.startsWith("custom-")) && p.configured).map((custom) => (
            <button key={custom.name}
            className="flex items-center gap-2.5 rounded-xl border border-line bg-panel px-3 py-2.5 text-left hover:border-lineStrong"
            onClick={() => ps.openProvider(custom.name)}
            data-testid={`set-${custom.name}-provider-card`}
            >
              <ProviderMark name="custom" title="自定义" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">
                  {custom.values?.supplier_name || "自定义"}
                </span>
                <span className="block truncate text-[12px] text-ok">✓ 已连接</span>
              </span>
              <span className="text-faint text-[14px]">›</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <ProviderForm
        ps={ps}
        tp="set"
        footer={
          ps.credentialed && !ps.isBlank ? (
            <button
              className="rounded-lg border border-danger/30 px-3 py-1.5 text-[13px] text-danger hover:border-danger hover:bg-danger/5 hover:underline underline-offset-2"
              data-testid="set-remove-key"
              aria-label={`删除${info?.title || "该供应商"}配置`}
              title="删除此供应商配置"
              onClick={() => setConfirmDelete(true)}
            >
              删除
            </button>
          ) : null
        }
      />

      {confirmDelete && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-xl border border-line bg-panel p-5 shadow-xl">
            <h2 className="text-[15px] font-semibold text-ink">确认删除</h2>
            <p className="mt-2 text-[13px] text-muted">确定要删除 {info?.title || "该供应商"} 的配置吗？</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded-lg border border-line px-3 py-1.5 text-[13px] text-muted hover:border-lineStrong"
                onClick={() => setConfirmDelete(false)}
                data-testid="set-remove-cancel"
              >
                取消
              </button>
              <button
                className="rounded-lg bg-danger px-3 py-1.5 text-[13px] text-white hover:brightness-105"
                onClick={() => {
                  setConfirmDelete(false);
                  void ps.removeKey();
                }}
                data-testid="set-remove-confirm"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {ps.sel === "openai" && settings.source === "env" && (
        <p className="text-[12px] text-muted mt-3 leading-relaxed">
          A key is set via <code>OPENAI_API_KEY</code> in this server's environment. You can override
          it above; the stored key is used only when the environment variable is absent.
        </p>
      )}

      {info?.configured && !ps.isBlank && !ps.sel.startsWith("custom-") && ps.sel !== "custom" ? (
        <div className="mt-6">
          <div className={SEC_H + " mb-1.5"}>模型</div>
          <p className="text-[12px] text-muted mb-2.5 leading-relaxed">
            勾选的模型会显示在对话模型选择器中；黑色标记表示新会话的默认模型。
          </p>
          <ModelChecklist
            provider={ps.sel}
            knownProviders={knownNames}
            suggested={info?.suggested_models || []}
            curated={settings.models}
            defaultModel={settings.model}
            labels={settings.model_labels}
            onChanged={(next) => setSettings((s) => (s ? { ...s, models: next.models, model: next.model } : s))}
          />
        </div>
      ) : (
        // Unconfigured providers still show their curated models as a read-only preview — what a
        // key unlocks is part of deciding to get one at all (owner ask, 2026-07-04).
        (info?.suggested_models?.length || 0) > 0 && (
          <div className="mt-6" data-testid="model-preview">
            <div className={SEC_H + " mb-1.5"}>包含的模型</div>
            <p className="text-[12px] text-muted mb-2.5 leading-relaxed">
              该供应商提供的精选智能体模型，填写上方密钥后即可启用。
            </p>
            <div className="space-y-1">
              {(info?.suggested_models || []).map((m) => {
                const full = ps.sel === "openai" ? m : `${ps.sel}:${m}`;
                return (
                  <div
                    key={m}
                    className="px-2.5 py-1.5 rounded-lg border border-line bg-paper text-[13px] text-muted"
                    title={full}
                  >
                    {settings.model_labels?.[full] || m}
                  </div>
                );
              })}
            </div>
          </div>
        )
      )}
    </div>
  );
}

// -- Connectors ---------------------------------------------------------------
// The Connectors tab body moved to connectors/ConnectorsSection.tsx (UX-DECISIONS
// §21: connected-first list + per-connector detail subpages). This file keeps the
// shared building blocks the detail pages reuse: ConnectSetup, ConnectorTools, and
// the two-way blocks (Allowlist/Unauthorized/ListeningSessions).

// Parked messages from senders not on the allow-list (§19). The gateway keeps what they said
// instead of dropping it, so first contact is one step: Allow & deliver replays the original
// message through the normal inbound path — no "message the bot again".
// With `teamId` (the Slack-workspaces page) only that workspace's parked messages show;
// resolving routes the allow to the right workspace server-side (the item carries its team).
export function UnauthorizedBlock({
  c,
  onChanged,
  teamId,
}: {
  c: Connector;
  onChanged: () => void;
  teamId?: string;
}) {
  const items = (c.unauthorized ?? []).filter(
    (m) => teamId === undefined || m.team_id === teamId,
  );
  if (items.length === 0) return null;
  const act = async (id: string, action: "dismiss" | "allow" | "allow_deliver") => {
    await resolveUnauthorized(c.name, id, action);
    onChanged();
  };
  return (
    <div
      className="border-t border-line px-3.5 py-3"
      data-testid={teamId ? `unauthorized-${c.name}-${teamId}` : `unauthorized-${c.name}`}
    >
      <div className={SEC_H + " mb-2"}>
        Messages from senders you haven't allowed · {items.length}
      </div>
      <div className="space-y-2">
        {items.map((m) => (
          <div key={m.id} className="rounded-xl border border-line bg-paper p-2.5">
            <div className="flex items-center gap-2 text-[12px] text-muted">
              <span className="font-medium text-ink">{m.user_name || m.user_id}</span>
              <span>in {m.chat_name || m.chat_id}</span>
              <span className="ml-auto shrink-0">{relTime(m.ts) || ""}</span>
            </div>
            <div className="text-[13px] mt-1 break-words">{m.text}</div>
            <div className="flex items-center gap-1.5 mt-2">
              <button
                className="text-[12px] px-2 py-1 rounded-md bg-accent text-white"
                data-testid={`parked-allow-deliver-${m.id}`}
                title="Add the sender to the allow-list and deliver this message now"
                onClick={() => act(m.id, "allow_deliver")}
              >
                Allow & deliver
              </button>
              <button
                className={BTN_BORDERED}
                data-testid={`parked-allow-${m.id}`}
                title="Add the sender to the allow-list; this message is discarded"
                onClick={() => act(m.id, "allow")}
              >
                Allow only
              </button>
              <button
                className="text-[12px] px-2 py-1 rounded-md text-faint hover:text-danger"
                data-testid={`parked-dismiss-${m.id}`}
                title="Throw this message away"
                onClick={() => act(m.id, "dismiss")}
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Which sessions listen to this connector's channels — the per-connector cut of the global
// Channel-subscriptions table (Integrations ▸ Messaging routing). Subscribing happens from a
// session's Sources ▸ Channels panel; here the owner can see and revoke.
export function ListeningSessionsBlock({ c }: { c: Connector }) {
  const [subs, setSubs] = useState<Subscription[] | null>(null);
  const load = () => getSubscriptions().then(setSubs).catch(() => setSubs([]));
  useEffect(() => {
    load();
  }, [c.name]);
  const platformOf = (channel: string) =>
    channel.includes(":") ? channel.split(":")[0] : "slack";
  const mine = (subs ?? []).filter((s) => platformOf(s.channel) === c.name);
  return (
    <div className="border-t border-line px-3.5 py-3" data-testid={`listening-${c.name}`}>
      <div className={SEC_H + " mb-2"}>Sessions listening to {c.title} channels · {mine.length}</div>
      {mine.length === 0 ? (
        <div className="text-[12px] text-faint">
          None yet — open a session's Sources ▸ Channels to subscribe it to a channel.
        </div>
      ) : (
        <div className="space-y-1.5">
          {mine.map((s) => (
            <div className="flex items-center gap-2 text-[13px]" key={s.session_id + s.channel}>
              <span className="min-w-0 truncate" title={s.session_id}>
                {s.session_title || s.session_id}
                {s.agent ? <span className="text-faint"> · {s.agent}</span> : null}
              </span>
              <span className="text-muted shrink-0" title={s.channel}>
                ← {s.channel_name ? `#${s.channel_name}` : s.channel}
              </span>
              <button
                className="ml-auto text-faint hover:text-danger shrink-0"
                title="Unsubscribe this session"
                onClick={async () => {
                  await unsubscribeChannel(s.session_id, s.channel);
                  load();
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Who may message this two-way bot. Recent senders surface here once they DM/mention the bot, so you
// can Allow them; allowed users are chips you can remove. (Was orphaned in the super-agent view.)
// With `teamId` (the Slack-workspaces page) the list is that WORKSPACE's — ids are
// workspace-scoped, so allow/remove target `slack:team:<id>` and recents filter to the team.
export function AllowlistBlock({
  c,
  onChanged,
  teamId,
  allowed,
  allowedNames,
}: {
  c: Connector;
  onChanged: () => void;
  teamId?: string;
  allowed?: string[];
  allowedNames?: Record<string, string | null>;
}) {
  const allowedUsers = allowed ?? c.allowed_users;
  const names = allowedNames ?? c.allowed_user_names;
  const recent = (c.recent ?? []).filter(
    (r) => teamId === undefined || r.team_id === teamId,
  );
  const unknownRecent = recent.filter((r) => !r.authorized);

  return (
    <div className="border-t border-line px-3.5 py-3 grid grid-cols-2 gap-5">
      <div>
        <div className={SEC_H + " mb-2"}>Allowed to message</div>
        <div className="flex flex-wrap gap-1.5">
          {allowedUsers.length === 0 && (
            <span className="text-[12px] text-faint">nobody yet — Allow a recent sender →</span>
          )}
          {allowedUsers.map((u) => (
            <span
              key={u}
              className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full bg-paper border border-line text-[12px]"
              title={`id ${u}`}
            >
              <span className="w-4 h-4 rounded-full bg-accentSoft text-accent grid place-items-center text-[9px] font-bold">
                {initials(names?.[u] || u)}
              </span>
              {names?.[u] || u}
              <button
                className="w-4 h-4 grid place-items-center text-faint hover:text-danger"
                title="remove"
                onClick={async () => {
                  await disallowUser(c.name, u, teamId);
                  onChanged();
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </div>
      <div>
        <div className={SEC_H + " mb-2"}>Recent senders</div>
        {unknownRecent.length === 0 ? (
          <div className="text-[12px] text-faint">None yet. Message the bot once and it'll show here.</div>
        ) : (
          <div className="space-y-1.5">
            {unknownRecent.map((r) => (
              <div className="flex items-center gap-2 text-[13px]" key={r.user_id}>
                <span className="w-5 h-5 rounded-full bg-paper border border-line grid place-items-center text-[9px] font-bold text-muted shrink-0">
                  {initials(r.user_name || "?")}
                </span>
                <span className="min-w-0 truncate" title={`id ${r.user_id}`}>
                  {r.user_name || "unknown"} <span className="text-faint">· {r.chat_type}</span>
                </span>
                <button
                  className="ml-auto text-[12px] px-2 py-0.5 rounded-md bg-accent text-white shrink-0"
                  onClick={async () => {
                    await allowUser(c.name, r.user_id, teamId);
                    onChanged();
                  }}
                >
                  Allow
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ConnectorTools({ c, onChanged }: { c: Connector; onChanged: () => void }) {
  const toggle = async (toolName: string, enabled: boolean) => {
    await updateConnectorTools(c.name, { [toolName]: enabled });
    onChanged();
  };
  if (!c.tools?.length)
    return (
      <div className="border-t border-line px-3.5 py-3 text-[13px] text-muted">
        No tools for this connector yet.
      </div>
    );
  return (
    <div className="border-t border-line px-3.5 py-3">
      <div className={SEC_H + " mb-2"}>向绿巨人开放的工具</div>
      <div className="space-y-1.5">
        {c.tools.map((tool) => (
          <label
            className="flex items-start gap-2.5 p-2 rounded-lg border border-line bg-paper"
            key={tool.name}
          >
            <input
              type="checkbox"
              className="mt-0.5 shrink-0"
              checked={tool.enabled}
              onChange={(e) => toggle(tool.name, e.target.checked)}
            />
            <span className="min-w-0">
              <span className="block text-[13px]">{tool.label}</span>
              <span className="block text-[12px] text-faint">
                {tool.name} · {tool.kind} · asks approval
              </span>
              <span className="block text-[12px] text-faint">{tool.description}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

// Exported: also hosted inside the SourcesDrawer's connect-in-context child panel, so a
// recommended connector can be connected without leaving the session (owner ask, 2026-07-03).
export function ConnectSetup({
  c,
  cloud,
  onConnected,
  manualOnly = false,
}: {
  c: Connector;
  cloud: CloudStatus | null;
  onConnected: () => void;
  // The add-modal's Manual pane: the one-click button lives on the sibling
  // pill, so don't render the managed block again here.
  manualOnly?: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false); // managed flow: browser is open
  const [error, setError] = useState<string | null>(null);
  const [cliReady, setCliReady] = useState(!!c.cli_ready);
  const cliConnector = CLI_CONNECTOR_NAMES.has(c.name);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await connectConnector(c.name, values);
    setBusy(false);
    if (res.ok) onConnected();
    else setError(res.error || "无法连接");
  };

  const oneClick = async () => {
    setError(null);
    const res = await connectManaged(c.name);
    // Completion arrives via the tab's poll: the broker form-POSTs the profile
    // to the sidecar, the connector flips to connected, this card closes itself.
    if (res.ok) setWaiting(true);
    else setError(res.error || "无法开始托管连接");
  };

  const mcpOneClick = async () => {
    setError(null);
    const res = await connectMcpBacked(c.name);
    // Completion likewise arrives via the poll — the sidecar flips the connector
    // to connected once the local OAuth flow lands.
    if (res.ok) setWaiting(true);
    else setError(res.error || "无法开始连接");
  };

  const cliAction = async () => {
    const action = cliReady ? "connect" : "install";
    setBusy(true);
    setError(null);
    try {
      const res = await connectorCliAction(c.name, action);
      if (!res.ok) {
        setError(action === "install" ? "安装失败" : "连接失败");
      } else if (action === "install") {
        setCliReady(true);
      } else if (res.started) {
        setWaiting(true);
      } else {
        onConnected();
      }
    } catch {
      setError(action === "install" ? "安装失败" : "连接失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-line px-3.5 py-3 space-y-3">
      {cliConnector && (
        <div className="space-y-2" data-testid="cli-connect">
          <button className={BTN_ACCENT} onClick={cliAction} disabled={busy || waiting}>
            {waiting
              ? "请在浏览器中完成操作…"
              : busy
              ? cliReady
                ? "连接中…"
                : "安装中…"
              : cliReady
                ? `连接 ${c.title}`
                : `安装 ${c.title}`}
          </button>
          {!cliReady && (
            <div className="text-[12px] text-faint">第一次安装时间比较久，请耐心等待。</div>
          )}
        </div>
      )}
      {c.mcp && !manualOnly && (
        /* MCP-backed one-click needs no cloud sign-in — the OAuth flow is local. */
        <div className="space-y-2" data-testid="mcp-connect">
          <button className={BTN_ACCENT} onClick={mcpOneClick} disabled={waiting}>
            {waiting ? "请在浏览器中完成操作…" : `一键连接 ${c.title}`}
          </button>
          {c.fields.length > 0 && (
            <div className="text-[12px] text-faint">或手动连接：</div>
          )}
        </div>
      )}
      {c.managed && !c.mcp && !manualOnly && (
        <div className="space-y-2" data-testid="managed-connect">
          {c.managed_paused ? (
            // One-click temporarily off (e.g. Google pending CASA verification):
            // a visibly-parked button, and the manual path below stays fully live.
            <>
              <button className={BTN_ACCENT + " opacity-50"} disabled data-testid="managed-coming-soon">
                {`一键连接 ${c.title}`}
                <span className="ml-2 text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-white/25">
                  即将推出
                </span>
              </button>
              <div className="text-[12px] text-faint">
                一键登录即将推出，当前请在下方手动连接：
              </div>
            </>
          ) : cloud?.signed_in ? (
            <button className={BTN_ACCENT} onClick={oneClick} disabled={waiting}>
              {waiting ? "请在浏览器中完成操作…" : `一键连接 ${c.title}`}
            </button>
          ) : cloud ? (
            <CloudSignInInline
                blurb={`登录后可一键连接 ${c.title}，也可在下方手动连接。`}
            />
          ) : (
            // Status unknown (fetch pending/failed): never show the sign-in ask to a
            // possibly-signed-in user (FB-013); the host keeps polling.
            <CloudStatusPending />
          )}
          {!c.managed_paused && cloud?.signed_in && (
            <div className="text-[12px] text-faint">或手动连接：</div>
          )}
        </div>
      )}
      {!cliConnector && c.instructions.length > 0 && (
        <ol className="list-decimal pl-4 text-[13px] text-muted leading-relaxed space-y-1">
          {c.instructions.map((step, i) => (
            <li key={i}>{localizedConnectorInstruction(c.name, step, i)}</li>
          ))}
        </ol>
      )}
      {!cliConnector && c.fields.map((f) => (
        <label className="conn-field" key={f.key}>
          <span className="conn-field-label">
            {localizedConnectorField(c.name, f.label)}
            {!f.required && <em>（可选）</em>}
          </span>
          <input
            type={f.secret ? "password" : "text"}
            placeholder={f.placeholder}
            value={values[f.key] || ""}
            spellCheck={false}
            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
          />
          {f.help && <span className="conn-field-help">{f.help}</span>}
        </label>
      ))}
      {!cliConnector && (!c.mcp || c.fields.length > 0) && (
        <div>
          <button className={BTN_ACCENT} onClick={submit} disabled={busy}>
            {busy ? "验证中…" : "连接"}
          </button>
        </div>
      )}
      {error && <div className="text-[13px] text-danger">{error}</div>}
    </div>
  );
}

function localizedConnectorField(name: string, label: string): string {
  if (label === "Personal access token") return "个人访问令牌";
  return name === "github" && label === "Repository" ? "仓库" : label;
}

function localizedConnectorInstruction(name: string, step: string, index: number): string {
  if (name === "github") {
    if (index === 0) return "创建一个可访问目标仓库的 GitHub 个人访问令牌。";
    if (index === 1) return "如需写入操作，请按需开启 Issues 或 Pull Requests 的写入权限。";
  }
  if (name === "figma") {
    if (index === 0) return "在 Figma 中打开设置 → 安全，生成个人访问令牌。";
    if (index === 1) return "将令牌粘贴到下方。";
  }
  return step;
}
