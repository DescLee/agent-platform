import { useEffect, useRef, useState } from "react";
import {
  getPersonasIndex,
  getPersonaAvatarUrl,
  installPersona,
  updatePersona,
  type Persona,
  type PersonaConsent,
} from "../api";
import { chooseFolder } from "../tauri";
import { Icon } from "./Icon";
import { PersonaGlyph } from "./personaIcon";

// Expert management: one toggle per row; retired Security entries are excluded.
// (enable implies picker); in-picker nuance, set-default, export and delete live on the
// per-coworker detail page. Unshipped coworkers (ships:false) and the installer are quiet
// text disclosures at the bottom; Folder/Zip install through native pickers.
const CARD = "rounded-xl2 border border-line bg-panel";
const SELECT = "px-2.5 py-2 rounded-lg border border-line bg-paper text-[13px] text-ink shrink-0";
const INPUT =
  "flex-1 min-w-0 px-3 py-2 rounded-lg border border-line bg-paper text-[13px] text-ink outline-none focus:border-accent";
const BTN_ACCENT = "text-[13px] px-3 py-2 rounded-lg bg-accent text-white shrink-0 disabled:opacity-40";
const BTN_BORDERED =
  "text-[13px] px-2.5 py-1.5 rounded-lg border border-line bg-paper hover:border-lineStrong shrink-0 disabled:opacity-40 disabled:hover:border-line";

const QUIET_ROW =
  "w-full flex items-center gap-2 px-4 pt-2 mt-6 text-[13px] text-muted select-none";

export function PersonasTab({ onOpenPersona }: { onOpenPersona?: (id: string) => void }) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [internal, setInternal] = useState(false);
  const [mode, setMode] = useState<"git" | "dir" | "zip">("git");
  const [src, setSrc] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [consent, setConsent] = useState<PersonaConsent[] | null>(null);
  const [showUnshipped, setShowUnshipped] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  // Disabling archives the persona's conversations (server-side), so when there are any we
  // arm an inline confirm (same two-step idiom as delete) instead of flipping immediately.
  const [confirmOff, setConfirmOff] = useState<string | null>(null);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  // The picker's "Import coworker…" door lands here and asks us to put the Add section
  // front and center (sharing v1).
  const addRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const focus = () => {
      setShowInstall(true); // the installer is a collapsed disclosure — open it first
      setTimeout(
        () => addRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
        0,
      );
    };
    window.addEventListener("ocw-focus-import", focus);
    return () => window.removeEventListener("ocw-focus-import", focus);
  }, []);

  const reload = () =>
    getPersonasIndex()
      .then((r) => {
        setPersonas(r.personas);
        setInternal(r.internal);
      })
      .catch(() => {});
  useEffect(() => {
    reload();
  }, []);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const entries = await Promise.all(
        personas.filter((p) => p.avatar).map(async (p) => {
          try { return [p.id, await getPersonaAvatarUrl(p.id, p.avatar!)] as const; }
          catch { return null; }
        }),
      );
      if (!cancelled) setAvatars(Object.fromEntries(entries.filter(Boolean) as [string, string][]));
    };
    if (personas.length) void load();
    return () => { cancelled = true; };
  }, [personas]);

  // Real conversations the disable would archive (unarchived; run sessions are server-hidden).
  const toggle = async (
    id: string,
    body: { enabled?: boolean; surfaced?: boolean; default?: boolean },
  ) => {
    const r = await updatePersona(id, body);
    if (r.personas) setPersonas(r.personas);
    else reload();
  };


  const finishInstall = (r: Awaited<ReturnType<typeof installPersona>>) => {
    setBusy(false);
    if (!r.ok) {
      setMsg(r.error || "导入失败");
      return;
    }
    setConsent(r.consent || []);
    if (r.personas) setPersonas(r.personas);
    setMsg(`已导入 ${(r.consent || []).length} 个专家，请在下方检查能力并启用。`);
    setSrc("");
  };

  // Folder installs go through the native picker — no path typing (owner, 2026-08-21).
  const installDir = async () => {
    const dir = await chooseFolder();
    if (!dir) return;
    setBusy(true);
    setMsg(null);
    setConsent(null);
    try {
      finishInstall(await installPersona({ dir }));
    } catch {
      setBusy(false);
      setMsg("导入失败，请检查文件夹后重试。");
    }
  };

  const installZip = async (file: File) => {
    setBusy(true);
    setMsg(null);
    setConsent(null);
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error("压缩包不能超过 50 MB。");
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000)
        bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      finishInstall(await installPersona({ zip_b64: btoa(bin), filename: file.name }));
    } catch (error) {
      setBusy(false);
      setMsg(error instanceof Error ? error.message : "导入失败，请检查压缩包后重试。");
    }
  };

  const install = async () => {
    if (!src.trim()) return;
    setBusy(true);
    setMsg(null);
    setConsent(null);
    try {
      finishInstall(await installPersona({ git_url: src.trim() }));
    } catch {
      setBusy(false);
      setMsg("导入失败，请检查网络后重试。");
    }
  };

  const available = personas.filter((p) => p.group !== "security");
  const unshipped = available.filter((p) => p.ships === false);

  const group = (title: string | null, list: Persona[]) => {
    if (list.length === 0) return null;
    return (
      <div className={title ? "mt-7" : "mt-1.5"}>
        {title && (
          <div className="text-[12px] font-semibold text-muted px-4 mb-1.5">{title}</div>
        )}
        <div className="expert-grid" data-testid="expert-grid">
          {list.map((p) => (
            <article key={p.id} className={CARD + " expert-card"} data-testid={`expert-card-${p.id}`}>
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-full bg-accentSoft text-accent flex items-center justify-center shrink-0 overflow-hidden" aria-hidden="true">
                  {avatars[p.id] ? (
                    <img src={avatars[p.id]} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <PersonaGlyph icon={p.icon} folderScoped={p.requires_folder} size={22} />
                  )}
                </div>
                <div className="min-w-0 flex-1 h-10 flex flex-col justify-center">
                  <h3 className="text-[16px] font-semibold leading-[20px] truncate" title={p.name}>{p.name}</h3>
                  {p.tagline && <p className="text-[13px] text-muted leading-[18px] truncate" title={p.tagline}>{p.tagline}</p>}
                </div>
                <div className="expert-card-actions">
                {p.default ? (
                  /* The default coworker cannot be disabled or hidden — no toggle, no
                     configure; a quiet tag says why (owner 2026-08-21). It regains its
                     controls the moment another coworker is made default. */
                  <span
                    className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-paper border border-lineStrong text-muted shrink-0"
                    title="新会话的默认专家"
                    data-testid="persona-default-tag"
                  >
                    默认
                  </span>
                ) : (
                  <>
                    {onOpenPersona && (
                      <button
                        className="text-faint hover:text-ink shrink-0 p-1"
                        title={`Configure ${p.name}`}
                        aria-label={`Configure ${p.name}`}
                        data-testid={`persona-configure-${p.id}`}
                        onClick={() => onOpenPersona(p.id)}
                      >
                        <Icon name="sliders" size={15} />
                      </button>
                    )}
                  </>
                )}
                </div>
              </div>
              <p className="text-[13px] text-muted leading-[22px] line-clamp-2 break-words mt-1 mb-3" title={p.description || p.tagline}>
                {p.description || "暂无介绍，可在配置中查看此专家的能力。"}
              </p>
              <div className="mt-auto flex items-center gap-2 text-[12px]">
                {(p.tags || []).slice(0, 4).map((tag) => <span key={tag} className="rounded-md bg-paper px-2.5 py-1 text-muted">{tag}</span>)}
              </div>
              {confirmOff === p.id && (
                <div
                  className="mt-4 pt-4 border-t border-line flex flex-wrap items-center gap-2.5 text-[12px] text-muted"
                  data-testid={`persona-disable-warning-${p.id}`}
                >
                  <span className="min-w-0">
                    停用后将归档该专家的 {liveCount(p.id)} 个会话，仍可在“已归档”中查看。
                  </span>
                  <button
                    className="text-[12px] px-2.5 py-1.5 rounded-lg bg-accent text-white shrink-0"
                    data-testid={`persona-disable-confirm-${p.id}`}
                    onClick={() => {
                      setConfirmOff(null);
                      toggle(p.id, { enabled: false });
                    }}
                  >
                    停用
                  </button>
                  <button className={BTN_BORDERED} onClick={() => setConfirmOff(null)}>
                    保持启用
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* One toggle per row (enable implies picker); ★ marks the default. Everything
          else — in-picker nuance, default, export, delete — lives on the detail page. */}
      {group(null, available.filter((p) => p.ships !== false))}

      {unshipped.length > 0 && (
        <>
          <button
            className={QUIET_ROW}
            data-testid="unshipped-disclosure"
            onClick={() => setShowUnshipped((v) => !v)}
          >
            <Icon
              name="chevronRight"
              size={12}
              className={"transition-transform" + (showUnshipped ? " rotate-90" : "")}
            />
            <span>暂未正式发布 · {unshipped.length} 位专家</span>
            <span className="ml-auto text-faint text-[12px]">
              {internal ? "internal build" : "not in this release"}
            </span>
          </button>
          {showUnshipped && group(null, unshipped)}
        </>
      )}

      {showInstall && (
        <div ref={addRef as any} className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={() => setShowInstall(false)}>
        <div className={CARD + " w-full max-w-[620px] p-5 shadow-xl"} onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4"><div><h2 className="text-[18px] font-semibold">导入专家</h2><p className="text-[12px] text-muted mt-1">从 GitHub、文件夹或 ZIP 添加专家能力</p></div><button className={BTN_BORDERED} onClick={() => setShowInstall(false)}>关闭</button></div>
          <div className="flex items-center gap-2">
            <select
              className={SELECT}
              value={mode}
              onChange={(e) => setMode(e.target.value as "git" | "dir" | "zip")}
            >
              <option value="git">GitHub 链接</option>
              <option value="dir">本地文件夹</option>
              <option value="zip">ZIP 压缩包</option>
            </select>
            {mode === "git" ? (
              <>
                <input
                  className={INPUT}
                  placeholder="https://github.com/infometa/workbuddyskills/tree/main/experts/ai-meeting-notes"
                  value={src}
                  onChange={(e) => setSrc(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && install()}
                />
                <button className={BTN_ACCENT} disabled={busy || !src.trim()} onClick={install}>
                  {busy ? "导入中…" : "导入"}
                </button>
              </>
            ) : mode === "dir" ? (
              <>
                <button
                  className={BTN_BORDERED}
                  disabled={busy}
                  data-testid="persona-dir-choose"
                  onClick={() => void installDir()}
                >
                  {busy ? "导入中…" : "选择专家文件夹…"}
                </button>
                <span className="text-[12px] text-faint">
                  选择包含 manifest.md 或 .codebuddy-plugin/plugin.json 的目录。
                </span>
              </>
            ) : (
              <label className={BTN_BORDERED + " cursor-pointer"}>
                {busy ? "导入中…" : "选择 ZIP 专家包…"}
                <input
                  type="file"
                  accept=".zip"
                  className="hidden"
                  data-testid="persona-zip-input"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void installZip(f);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
          <div className="flex items-start gap-2 mt-3 text-[12px] text-muted leading-relaxed">
            <span className="text-warnInk shrink-0">⚠</span>
            <span>
              支持原生专家及 WorkBuddy 单专家包。GitHub 链接请指向具体专家目录；
              暂不支持团队包和 Hooks。只导入可信且有权使用的内容，导入时不会执行脚本。
              第三方技能的依赖不会自动安装，执行操作仍受应用审批控制。
            </span>
          </div>
        </div></div>
      )}
      {msg && <div className="text-[13px] text-muted mt-2.5">{msg}</div>}

      {consent && consent.length > 0 && (
        <div className="mt-4 space-y-2" data-testid="consent-review">
          {/* Trust first (owner design, 2026-08-11): the source warning leads; capabilities
              are a one-line summary with the exact tools under a collapsed chevron. A
              coworker runs no third-party code, so this list is complete — but a prompt
              still steers an agent, so who it came from genuinely matters. */}
          <div className="flex items-start gap-2.5 rounded-xl border border-warnInk/30 bg-warnSoft px-3.5 py-2.5 text-[13px] text-warnInk">
            <Icon name="shield" size={15} className="shrink-0 mt-0.5" />
            <span>
              请检查来源、能力和兼容性说明后启用。导入不会执行代码；使用助手时，
              提示词和技能会影响其行为，但不会绕过应用的权限审批。
            </span>
          </div>
          {consent.map((c) => (
            <ConsentCard
              key={c.id}
              c={c}
              enabled={personas.find((p) => p.id === c.id)?.enabled ?? false}
              onEnable={async () => {
                await toggle(c.id, { enabled: true, surfaced: true });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// One phrase per risk class — the plain-language capability summary the consent card leads
// with; unknown classes fall back to their raw id so nothing is silently omitted.
const RISK_PHRASE: Record<string, string> = {
  read: "读取文件",
  write_local: "创建和修改文件",
  exec: "执行 Shell 命令",
  network: "访问网络",
  write_remote: "操作已连接的服务",
};

function ConsentCard({
  c,
  enabled,
  onEnable,
}: {
  c: PersonaConsent;
  enabled: boolean;
  onEnable: () => Promise<void>;
}) {
  const [showTools, setShowTools] = useState(false);
  const [busy, setBusy] = useState(false);
  const phrases = (c.risk.length ? c.risk : ["read"]).map((r) => RISK_PHRASE[r] || r);
  const summary = phrases.join("、");
  const recommends = c.recommends || [];
  return (
    <div className={CARD + " p-3.5"} data-testid={`consent-${c.id}`}>
      <div className="text-[13px] font-medium flex items-center gap-2">
        <span>{c.name}</span>
        {c.version && <span className="text-[11px] text-faint font-normal">v{c.version}</span>}
      </div>
      {c.description && <div className="text-[12px] text-muted mt-0.5">{c.description}</div>}
      {!!c.import_notes?.length && (
        <div className="text-[12px] text-warnInk mt-2 space-y-1" data-testid="import-notes">
          {c.import_notes.map((note, i) => <p key={i}>{note}</p>)}
        </div>
      )}
      {c.replaces && (
        <div className="text-[12px] text-muted mt-1.5" data-testid="replaces-note">
          Replaces {c.name}
          {c.replaces.version ? ` v${c.replaces.version}` : ""}
          {c.replaces.installed_at ? ` (installed ${c.replaces.installed_at})` : ""}.
          {c.replaces.capabilities_grew
            ? " This update asks for MORE capabilities than the copy it replaces — review below before re-enabling."
            : " Same capabilities as before — it stays enabled."}
        </div>
      )}
      <div className="text-[13px] text-ink mt-2">
        可{summary}
        {c.connectors === "all"
          ? " · use ALL your connected services"
          : c.connectors.length
            ? ` · use connectors: ${c.connectors.join(", ")}`
            : ""}
        {c.messaging ? " · send messages" : ""}
        {c.mcp.length ? ` · use MCP: ${c.mcp.join(", ")}` : ""}
        <button
          className="ml-2 text-accent text-[12px] hover:underline"
          data-testid="consent-tools-toggle"
          onClick={() => setShowTools((v) => !v)}
        >
          {showTools ? "收起工具" : `查看工具（${c.tools.length}）`}
        </button>
      </div>
      {showTools && (
        <div className="text-[12px] text-muted mt-1 font-mono">{c.tools.join(" · ") || "—"}</div>
      )}
      {recommends.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {recommends.map((r) => (
            <div key={r.kind + r.ref} className="text-[12px] text-muted">
              <span className="text-ink">{r.ref}</span>
              {r.tier === "core" ? " (recommended)" : " (optional)"} — {r.reason}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 mt-2.5">
        {/* Enable right here (owner ask 2026-08-11) — the old "enable it above" copy
            sent the user hunting back up the list. */}
        {enabled ? (
          <span className="text-[13px] text-muted" data-testid="consent-enabled">
            ✓ 已启用，可在会话的专家列表中选择。
          </span>
        ) : (
          <button
            className={BTN_ACCENT}
            data-testid={`consent-enable-${c.id}`}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onEnable().finally(() => setBusy(false));
            }}
          >
            {busy ? "启用中…" : "启用此专家"}
          </button>
        )}
        <span className="text-[12px] text-faint">建议模式：{c.recommended_mode === "interactive" ? "操作前询问" : c.recommended_mode}</span>
      </div>
    </div>
  );
}
