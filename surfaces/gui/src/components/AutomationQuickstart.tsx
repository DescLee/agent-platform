import { useEffect, useRef, useState } from "react";
import {
  cloudLogin,
  connectManaged,
  getCloudStatus,
  getConnectors,
  getRecentChannels,
  waitForCloudSignIn,
  type CloudStatus,
  type Connector,
  type RecentChannel,
} from "../api";
import { ConnectorBadge } from "../connectors/ConnectorIcon";
import { ChannelPicker } from "./SubscriptionsChip";
import { SelectMenu } from "./SelectMenu";

// The Automations quickstart (UX-DECISIONS §29): ONE template system. The former onboarding
// recipe step (§24's role recipes) merged into the page's "Start from a template" grid — every
// card carries §27's connector-dot vocabulary (brand = connected, grayscale = needs connecting);
// picking a card expands the configure card below the grid: connect rows (with the lazy cloud
// sign-in pane), channel-by-name, day × time, and the §25 consent line for write recipes.
// The `ob-*` testids moved here with the machinery.

// "When" = day choice × free time (owner call 2026-07-11); the cron assembles from the two.
const DAYS: Record<string, { label: string; dow: string }> = {
  mon: { label: "每周一", dow: "1" },
  tue: { label: "每周二", dow: "2" },
  wed: { label: "每周三", dow: "3" },
  thu: { label: "每周四", dow: "4" },
  fri: { label: "每周五", dow: "5" },
  sat: { label: "每周六", dow: "6" },
  sun: { label: "每周日", dow: "0" },
  weekdays: { label: "工作日", dow: "1-5" },
  daily: { label: "每天", dow: "*" },
};
// §30 connect-state spinner (the app has no other spinner — waits elsewhere are label swaps).
// Exported for Onboarding page 2's sign-in button (same states, same look).
export const Spinner = () => (
  <span className="inline-block w-3 h-3 rounded-full border-[1.5px] border-line2 border-t-accent animate-spin" />
);

const cronFor = (dayKey: string, hhmm: string) => {
  const [h, m] = hhmm.split(":");
  return `${Number(m) || 0} ${Number(h) || 9} * * ${DAYS[dayKey]?.dow ?? "*"}`;
};

interface QuickTemplate {
  key: string;
  title: string;
  blurb: string;
  cadence: string; // the card's footer label
  conns: { name: string; why: string }[]; // [] = no connections needed
  needsRepo?: boolean;
  needsChannel?: boolean;
  consent?: boolean; // write recipes carry the §25 consent line; reads carry disclosure
  deliver?: boolean; // 每日晨间简报's deliver-to choice
  day: string;
  time: string;
  instructions: (ctx: { repo: string; channel: string; deliver: "app" | "slack" }) => string;
}

const TEMPLATES: QuickTemplate[] = [
  {
    key: "github",
    title: "GitHub 动态摘要",
    blurb: "汇总已合并的拉取请求和代码提交，发送到团队的 Slack。",
    cadence: "每周",
    conns: [
      { name: "slack", why: "摘要的发送位置" },
      { name: "github", why: "摘要的数据来源" },
    ],
    needsRepo: true,
    needsChannel: true,
    consent: true,
    day: "mon",
    time: "09:00",
    instructions: ({ repo, channel }) =>
      `汇总 GitHub 仓库 ${repo || "（已连接的仓库）"} 自上次摘要以来的动态：` +
      `已合并的拉取请求、重要提交和需要关注的事项。` +
      `使用 send_message 将摘要发送到 Slack 频道 ${channel}。`,
  },
  {
    key: "pipeline",
    title: "销售进展摘要",
    blurb: "汇总有进展或停滞的商机，发送到 Slack。",
    cadence: "每周",
    conns: [
      { name: "slack", why: "摘要的发送位置" },
      { name: "hubspot", why: "销售进展与商机动态" },
    ],
    needsChannel: true,
    consent: true,
    day: "mon",
    time: "09:00",
    instructions: ({ channel }) =>
      `回顾 HubSpot 自上次摘要以来的动态：阶段发生变化、长时间无进展以及超过预计成交日期的商机。` +
      `使用 send_message 将简短的销售进展摘要发送到 Slack 频道 ${channel}。`,
  },
  {
    key: "brief",
    title: "每日晨间简报",
    blurb: "在一天开始前，汇总日程和未读邮件。",
    cadence: "每天",
    conns: [
      { name: "google_calendar", why: "今天的会议与空闲时间" },
      { name: "gmail", why: "昨晚以来收到的邮件" },
    ],
    deliver: true,
    day: "daily",
    time: "08:00",
    instructions: ({ deliver }) =>
      `准备一份简短的晨间简报：今天的日程与空闲时段，以及昨晚以来收到的邮件。` +
      (deliver === "app" ? "将其保存为本次会话的交付物。" : "通过 Slack 私信发送给我。"),
  },
  {
    key: "news",
    title: "每日新闻简报",
    blurb: "汇总科技与全球新闻的 5 条要点，保存为 Markdown 文件。",
    cadence: "每天",
    conns: [],
    day: "daily",
    time: "08:00",
    instructions: () =>
      "搜索过去 24 小时内最重要的科技与全球新闻，整理为包含 5 条要点的简报，并保存为 Markdown 文件。",
  },
  {
    key: "inboxdigest",
    title: "未读邮件摘要",
    blurb: "将未读邮件整理成一份简短摘要。",
    cadence: "工作日",
    conns: [{ name: "gmail", why: "你的未读邮件" }],
    day: "weekdays",
    time: "09:00",
    instructions: () => "将我的未读邮件汇总成一份简短摘要。",
  },
  {
    key: "cleanup",
    title: "文件夹整理",
    blurb: "按文件类型整理最近下载的文件。",
    cadence: "每周",
    conns: [],
    day: "fri",
    time: "17:30",
    instructions: () => "按文件类型，将我最近下载的文件整理到相应文件夹中。",
  },
];

export function AutomationQuickstart({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (payload: {
    title: string;
    instructions: string;
    cron?: string;
    permissions?: { tool: string; target: string; access: "read" | "write" }[];
  }) => void;
}) {
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const picked = TEMPLATES.find((t) => t.key === pickedKey) || null;

  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const [pendingConn, setPendingConn] = useState<string | null>(null);
  // §30 connect states: "opening" while the broker POST is in flight (the browser hasn't
  // appeared yet), "waiting" once it has — the handoff strip explains the out-of-band finish.
  const [connFlow, setConnFlow] = useState<{ name: string; phase: "opening" | "waiting" } | null>(
    null,
  );
  const [signinPhase, setSigninPhase] = useState<"opening" | "waiting" | null>(null);
  const [recent, setRecent] = useState<RecentChannel[]>([]);
  const [repo, setRepo] = useState("");
  const [channel, setChannel] = useState("");
  const [day, setDay] = useState("mon");
  const [time, setTime] = useState("09:00");
  const [deliver, setDeliver] = useState<"app" | "slack">("app");
  const [consent, setConsent] = useState(true);

  const refresh = () => {
    getConnectors().then(setConnectors).catch(() => {});
    getCloudStatus().then(setCloud).catch(() => {});
  };
  // Connector state drives the card dots, so load once up front; poll only while a template
  // is being configured (connects and the cloud sign-in land out-of-band).
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    if (!picked) return;
    refresh();
    getRecentChannels().then(setRecent).catch(() => {});
    pollRef.current = setInterval(refresh, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedKey]);

  const connState = (name: string) => connectors.find((c) => c.name === name);
  const allConnected = !picked || picked.conns.every((c) => connState(c.name)?.connected);
  // §25 consent line shows the HUMAN name (owner catch 2026-07-14: it echoed the raw
  // slack:T…/C… target). Names come from a picker pick (remembered per address) or the
  // recent list; a hand-typed raw address stays raw — we never guess.
  const [picked_names, setPickedNames] = useState<Record<string, { name: string; workspace?: string }>>({});
  const pickedInfo = picked_names[channel];
  const channelName = pickedInfo?.name || recent.find((c) => c.channel === channel)?.name;
  const channelLabel = channelName ? `#${channelName}` : channel;
  const channelWorkspace = pickedInfo?.workspace;

  // The poll flipping a row to ✓ is what ends its waiting state.
  useEffect(() => {
    if (connFlow && connState(connFlow.name)?.connected) setConnFlow(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectors]);

  // §30: the configure card scrolls into view on pick — it expands below the fold on
  // three-row grids and otherwise appears "nowhere".
  const cfgRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (pickedKey) cfgRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [pickedKey]);

  const pick = (t: QuickTemplate) => {
    setPickedKey(t.key);
    setDay(t.day);
    setTime(t.time);
    setConsent(true);
    setConnFlow(null);
  };

  const startConnect = async (name: string) => {
    if (!cloud?.signed_in) {
      setPendingConn(name); // the pane appears; sign-in completes it
      return;
    }
    // §30: the broker round-trip takes seconds — narrate it on the row itself.
    setConnFlow({ name, phase: "opening" });
    // GitHub is authorize-first at the BROKER: one connect links an existing
    // installation or lands on the install page — no flow choice here anymore.
    await connectManaged(name).catch(() => {});
    // The POST resolves once the system browser is off; the poll ends the waiting state.
    setConnFlow((f) => (f?.name === name ? { name, phase: "waiting" } : f));
    refresh();
  };

  const signinPollRef = useRef<(() => void) | null>(null);
  const cancelSignin = () => {
    signinPollRef.current?.();
    signinPollRef.current = null;
    setSigninPhase(null);
  };
  useEffect(() => cancelSignin, []); // never leave the poll running after unmount

  const signInThenConnect = async () => {
    setSigninPhase("opening");
    await cloudLogin().catch(() => {});
    setSigninPhase("waiting");
    // Poll until the browser flow lands, then finish the pending connect (bounded).
    signinPollRef.current = waitForCloudSignIn(async (s) => {
      signinPollRef.current = null;
      setSigninPhase(null);
      if (!s?.signed_in) return;
      setCloud(s);
      if (pendingConn) {
        const name = pendingConn;
        setConnFlow({ name, phase: "opening" });
        await connectManaged(name).catch(() => {});
        setConnFlow((f) => (f?.name === name ? { name, phase: "waiting" } : f));
        setPendingConn(null);
        refresh();
      }
    });
  };

  const create = () => {
    if (!picked) return;
    onCreate({
      title: picked.title,
      instructions: picked.instructions({ repo, channel, deliver }),
      cron: cronFor(day, time),
      permissions:
        picked.consent && consent && channel
          ? [{ tool: "send_message", target: channel, access: "write" }]
          : [],
    });
  };

  const gateHint = !allConnected
    ? `请先连接 ${picked?.conns
        .filter((c) => !connState(c.name)?.connected)
        .map((c) => connState(c.name)?.title || c.name)
        .join(" 和 ")} 以继续`
    : picked?.needsChannel && !channel
      ? "请先选择接收摘要的频道"
      : "";

  const label = "block text-[12px] text-muted mt-3 mb-1";
  const input =
    "w-full px-3 py-2 rounded-lg border border-line bg-panel text-[13px] outline-none focus:border-accent";

  return (
    <div className="mb-4">
      <div className="text-[11px] uppercase tracking-[0.05em] text-faint mb-2.5">
        从模板开始
      </div>
      {/* Equal-height cards (owner ask 2026-07-12): 1fr rows + h-full — <button> grid items
          don't stretch like divs. */}
      <div className="grid grid-cols-3 auto-rows-fr gap-3">
        {TEMPLATES.map((t) => (
          <button
            key={t.key}
            data-testid={`qs-template-${t.key}`}
            className={
              "h-full text-left rounded-xl2 border bg-panel p-4 flex flex-col gap-1.5 " +
              (pickedKey === t.key
                ? "border-accent ring-2 ring-accentSoft"
                : "border-line hover:border-lineStrong")
            }
            onClick={() => pick(t)}
          >
            <span className="text-[13px] font-semibold">{t.title}</span>
            <span className="text-[12px] text-muted leading-relaxed flex-1">{t.blurb}</span>
            <span className="flex items-center gap-1.5 mt-1">
              {t.conns.map((c) => {
                const cs = connState(c.name);
                const on = !!cs?.connected;
                return (
                  <span
                    key={c.name}
                    title={`${cs?.title || c.name} — ${on ? "已连接" : "尚未连接"}`}
                    style={on ? undefined : { filter: "grayscale(1)", opacity: 0.55 }}
                  >
                    {cs ? (
                      <ConnectorBadge connector={cs} size={16} title={cs.title} />
                    ) : (
                      <span className="inline-block w-4 h-4 rounded-full border border-line2" />
                    )}
                  </span>
                );
              })}
              <span className="text-[11px] text-faint ml-0.5">
                {t.conns.length === 0 ? `无需连接应用 · ${t.cadence}` : t.cadence}
              </span>
            </span>
          </button>
        ))}
      </div>

      {picked && (
        <div
          ref={cfgRef}
          className="mt-3 rounded-xl2 border border-line bg-panel p-4"
          data-testid="qs-configure"
        >
          {/* §30: the card names its template — without this it starts abruptly after the grid. */}
          <div className="flex items-baseline gap-2 pb-2.5 mb-1 border-b border-line">
            <span className="text-[11px] uppercase tracking-[0.05em] text-accent font-semibold">
              配置模板
            </span>
            <span className="text-[14px] font-semibold">{picked.title}</span>
            <span className="ml-auto text-[12px] text-faint max-sm:hidden">
              {picked.conns.length ? "应用连接、发送方式与执行计划" : "发送方式与执行计划"} ·{" "}
              {picked.cadence}
            </span>
          </div>
          {picked.conns.map(({ name, why }) => {
            const c = connState(name);
            const flow = connFlow?.name === name ? connFlow : null;
            return (
              <div key={name} className="border-b border-line last:border-b-0">
                <div className="flex items-center gap-3 py-2.5">
                  {c && <ConnectorBadge connector={c} size={26} title={c.title} />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">{c?.title || name}</span>
                    <span className="block text-[12px] text-faint">{why}</span>
                  </span>
                  {c?.connected ? (
                    <span className="text-[13px] text-ok">✓ 已连接</span>
                  ) : flow ? (
                    <span className="inline-flex items-center gap-2 text-[12px] text-muted">
                      <Spinner />
                      {flow.phase === "opening"
                        ? "正在打开浏览器…"
                        : `正在等待 ${c?.title || name} 完成连接…`}
                    </span>
                  ) : (
                    <button
                      className="px-3.5 py-1 rounded-full border border-line text-[13px] hover:bg-paper"
                      onClick={() => startConnect(name)}
                      data-testid={`ob-connect-${name}`}
                    >
                      连接
                    </button>
                  )}
                </div>
                {/* §30 handoff strip: the flow finishes out-of-band in the browser — say so,
                    and let 取消 clear the LOCAL state (the browser tab is the user's). */}
                {flow?.phase === "waiting" && (
                  <div
                    className="flex items-start gap-2 bg-accentSoft/50 rounded-lg px-3 py-2 mb-2.5 text-[12px] text-muted"
                    data-testid="ob-connect-wait"
                  >
                    <span>↗</span>
                    <span className="flex-1 min-w-0">
                      <b className="text-ink font-medium">
                        请在浏览器中完成 {c?.title || name} 的连接。
                      </b>{" "}
                      在浏览器中授权后返回，此页面会自动更新。
                    </span>
                    <button
                      className="text-faint underline hover:text-muted shrink-0"
                      onClick={() => setConnFlow(null)}
                      data-testid="ob-connect-cancel"
                    >
                      取消
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {pendingConn && !cloud?.signed_in && (
            <div
              className="bg-accentSoft/50 rounded-xl px-4 py-3 mt-3 text-[13px] text-muted"
              data-testid="ob-cloudpane"
            >
              <span className="block text-[13px] text-ink font-medium">
                登录一次，即可一键连接各个应用
              </span>
              连接由 OpenWorker Cloud 协助完成，访问令牌保存在本机。
              <div className="flex items-center gap-3 mt-2">
                {signinPhase ? (
                  <>
                    <span className="inline-flex items-center gap-2 text-[12px]">
                      <Spinner />
                      {signinPhase === "opening" ? "正在打开浏览器…" : "正在等待登录…"}
                    </span>
                    {signinPhase === "waiting" && (
                      <span className="text-[12px] text-faint">
                        请在浏览器中完成登录，此页面会自动更新。{" "}
                        <button
                          className="underline hover:text-muted"
                          onClick={cancelSignin}
                          data-testid="ob-signin-cancel"
                        >
                          取消
                        </button>
                      </span>
                    )}
                  </>
                ) : (
                  <button
                    className="px-3.5 py-1 rounded-full border border-line text-[13px] text-accent hover:bg-panel"
                    onClick={signInThenConnect}
                    data-testid="ob-cloud-signin"
                  >
                    登录 OpenWorker Cloud
                  </button>
                )}
              </div>
            </div>
          )}

          {allConnected && (
            <div className={picked.conns.length ? "bg-paper rounded-xl px-4 py-3.5 mt-3" : ""} data-testid="ob-recipe">
              {picked.needsRepo && (
                <>
                  <label className={label}>代码仓库</label>
                  <input
                    className={input}
                    placeholder="仓库所有者/仓库名称"
                    value={repo}
                    onChange={(e) => setRepo(e.target.value)}
                    data-testid="ob-repo"
                  />
                </>
              )}
              {picked.needsChannel && (
                <>
                  <label className={label}>发送到频道</label>
                  <div data-testid="ob-channel">
                    <ChannelPicker
                      value={channel}
                      onChange={setChannel}
                      recent={recent}
                      onPickName={(address, name, workspace) =>
                        setPickedNames((m) => ({ ...m, [address]: { name, workspace } }))
                      }
                    />
                  </div>
                  <p className="text-[11px] text-warnInk mt-1">
                    机器人必须已加入该频道；如未加入，请在 Slack 中邀请 @OpenWorker。
                  </p>
                </>
              )}
              <label className={label}>执行时间</label>
              <div className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <SelectMenu
                    ariaLabel="执行日期"
                    value={day}
                    options={Object.entries(DAYS).map(([k, v]) => ({ value: k, label: v.label }))}
                    onChange={setDay}
                  />
                </div>
                <input
                  className="w-28 px-3 py-2 rounded-lg border border-line bg-panel text-[13px] outline-none focus:border-accent"
                  type="time"
                  aria-label="执行时间"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </div>
              {picked.deliver && (
                <>
                  <label className={label}>发送到</label>
                  <SelectMenu
                    ariaLabel="发送到"
                    value={deliver}
                    options={[
                      { value: "app", label: "在应用内查看" },
                      { value: "slack", label: "Slack 私信（稍后连接 Slack）" },
                    ]}
                    onChange={(v) => setDeliver(v as "app" | "slack")}
                  />
                </>
              )}
              {picked.consent ? (
                <label className="flex items-start gap-2.5 mt-3.5 text-[13px] text-muted select-none">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    data-testid="ob-consent"
                  />
                  <span>
                    允许此自动任务将摘要发送到{" "}
                    <b className="text-ink" title={channel || undefined}>
                      {channelLabel || "所选频道"}
                      {channelWorkspace ? ` (${channelWorkspace})` : ""}
                    </b>{" "}
                    ，无需每次确认。其他操作仍需先征求确认。
                  </span>
                </label>
              ) : picked.conns.length > 0 ? (
                <p className="text-[13px] text-muted mt-3">
                  此自动任务仅按计划<b className="text-ink">读取</b>信息，读取操作无需审批。
                </p>
              ) : null}
            </div>
          )}

          <div className="flex items-center gap-3 mt-4">
            <button
              className="text-[13px] text-faint hover:text-muted"
              onClick={() => setPickedKey(null)}
            >
              取消
            </button>
            {/* A silently-disabled primary reads as a bug — always name the missing piece. */}
            {gateHint && (
              <span className="ml-auto text-[12px] text-faint" data-testid="ob-create-hint">
                {gateHint}
              </span>
            )}
            <button
              className={
                (gateHint ? "" : "ml-auto ") +
                "px-5 py-2 rounded-full bg-ink text-panel text-[13px] disabled:opacity-40"
              }
              disabled={busy || !allConnected || (picked.needsChannel && !channel)}
              onClick={create}
              data-testid="ob-create"
            >
              {busy ? "正在创建…" : "创建自动任务"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
