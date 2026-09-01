import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  getPersonasIndex,
  getPersonaCatalog,
  getPersonaAvatarUrl,
  installPersona,
  type Persona,
  type CatalogCategory,
  type CatalogPersona,
  type PersonaConsent,
} from "../api";
import { chooseFolder } from "../tauri";
import { Icon } from "./Icon";
import { PersonaGlyph } from "./personaIcon";

// Expert management: every displayed expert is available; retired Security entries are excluded.
// Set-default, export and delete live on the
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

function RemoteExpertAvatar({ expert }: { expert: CatalogPersona }) {
  const primary = expert.fallback_avatar_url || expert.avatar_url;
  const [src, setSrc] = useState(primary);
  useEffect(() => setSrc(primary), [primary]);

  if (!src) return <PersonaGlyph icon="sparkle" size={22} />;
  return (
    <img
      src={src}
      alt=""
      className="w-full h-full object-cover"
      loading="lazy"
      onError={() => {
        if (src !== expert.avatar_url && expert.avatar_url) {
          setSrc(expert.avatar_url);
        } else {
          setSrc("");
        }
      }}
    />
  );
}

export function PersonasTab({ onOpenPersona, onSummonPersona }: { onOpenPersona?: (id: string) => void; onSummonPersona?: (id: string, prompt?: string) => void }) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [catalog, setCatalog] = useState<CatalogPersona[]>([]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [category, setCategory] = useState("all");
  const categoryScrollRef = useRef<HTMLDivElement | null>(null);
  const [categoryEdges, setCategoryEdges] = useState({ left: false, right: false });
  const [catalogError, setCatalogError] = useState("");
  const [indexLoaded, setIndexLoaded] = useState(false);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [summoning, setSummoning] = useState<CatalogPersona | null>(null);
  const [selectedRemote, setSelectedRemote] = useState<CatalogPersona | null>(null);
  const [summonError, setSummonError] = useState("");
  const [internal, setInternal] = useState(false);
  const [mode, setMode] = useState<"git" | "dir" | "zip">("git");
  const [src, setSrc] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [consent, setConsent] = useState<PersonaConsent[] | null>(null);
  const [showUnshipped, setShowUnshipped] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
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

  useEffect(() => {
    getPersonasIndex()
      .then((r) => {
        setPersonas(r.personas);
        setInternal(r.internal);
      })
      .catch(() => {})
      .finally(() => setIndexLoaded(true));
    getPersonaCatalog()
      .then((r) => {
        if (!r.ok) return setCatalogError(r.error || "专家目录加载失败");
        setCatalog(r.experts);
        setCategories(r.categories);
      })
      .catch(() => setCatalogError("专家目录加载失败"))
      .finally(() => setCatalogLoaded(true));
  }, []);
  const updateCategoryEdges = () => {
    const el = categoryScrollRef.current;
    if (!el) return;
    setCategoryEdges({
      left: el.scrollLeft > 2,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    });
  };
  useEffect(() => {
    const frame = requestAnimationFrame(updateCategoryEdges);
    window.addEventListener("resize", updateCategoryEdges);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateCategoryEdges);
    };
  }, [categories]);
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

  const finishInstall = (r: Awaited<ReturnType<typeof installPersona>>) => {
    setBusy(false);
    if (!r.ok) {
      setMsg(r.error || "导入失败");
      return;
    }
    setConsent(r.consent || []);
    if (r.personas) setPersonas(r.personas);
    setMsg(`已导入 ${(r.consent || []).length} 个专家，请在下方检查能力。`);
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
  const installedIds = new Set(personas.map((p) => p.id));
  const remoteExperts = catalog.filter((p) => !installedIds.has(p.id));
  const visibleRemoteExperts = category === "all"
    ? remoteExperts
    : category === "mine"
      ? []
      : remoteExperts.filter((p) => p.category === category);
  const downloadedExperts = available.filter((p) => !p.builtin);

  const summonRemote = async (expert: CatalogPersona, prompt?: string) => {
    setSummoning(expert);
    setSummonError("");
    try {
      // WorkBuddy catalogue directories follow /experts/{agentName}; construct the
      // canonical URL here rather than trusting a stale or relative catalogue source.
      const gitUrl = `https://github.com/infometa/workbuddyskills/tree/main/experts/${expert.agent_name}`;
      const result = await installPersona({ git_url: gitUrl });
      if (!result.ok) throw new Error(result.error || "专家下载失败");
      if (result.personas) setPersonas(result.personas);
      const installedId = result.consent?.[0]?.id || expert.id;
      onSummonPersona?.(installedId, prompt);
    } catch (error) {
      setSummonError(error instanceof Error ? error.message : "专家下载失败");
    } finally {
      setSummoning(null);
    }
  };

  const remoteCards = visibleRemoteExperts.map((p) => (
    <article key={p.id} className={CARD + " expert-card cursor-pointer group"} data-testid={`remote-expert-${p.plugin}`} onClick={() => setSelectedRemote(p)}>
      <div className="flex items-start gap-3.5">
        <div className="w-10 h-10 rounded-full bg-accentSoft text-accent flex items-center justify-center shrink-0 overflow-hidden" aria-hidden="true">
          <RemoteExpertAvatar expert={p} />
        </div>
        <div className="min-w-0 flex-1 h-10 flex flex-col justify-center">
          <h3 className="text-[16px] font-semibold leading-[20px] truncate" title={p.name}>{p.name}</h3>
          {p.display_name && <p className="text-[13px] text-muted leading-[18px] truncate">{p.display_name}</p>}
        </div>
        <button
          className="hidden group-hover:inline-flex text-[12px] px-2 py-1 rounded-md bg-accent text-white"
          onClick={(event) => { event.stopPropagation(); void summonRemote(p); }}
        >
          召唤
        </button>
      </div>
      <p className="text-[13px] text-muted leading-[22px] line-clamp-2 break-words mt-1 mb-3" title={p.description}>
        {p.description || "暂无介绍"}
      </p>
      <div className="mt-auto flex items-center gap-2 text-[12px] overflow-hidden">
        {p.tags.slice(0, 4).map((tag) => <span key={tag} className="rounded-md bg-paper px-2.5 py-1 text-muted whitespace-nowrap">{tag}</span>)}
      </div>
    </article>
  ));

  const group = (title: string | null, list: Persona[], trailingCards?: ReactNode) => {
    if (list.length === 0 && !trailingCards) return null;
    return (
      <div className={title ? "mt-7" : "mt-1.5"}>
        {title && (
          <div className="text-[12px] font-semibold text-muted px-4 mb-1.5">{title}</div>
        )}
        <div className="expert-grid" data-testid="expert-grid">
          {list.map((p) => (
            <article key={p.id} className={CARD + " expert-card cursor-pointer group"} data-testid={`expert-card-${p.id}`} onClick={() => onOpenPersona?.(p.id)}>
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
                <button className="hidden group-hover:inline-flex text-[12px] px-2 py-1 rounded-md bg-accent text-white" onClick={(e) => { e.stopPropagation(); onSummonPersona?.(p.id); }}>召唤</button>
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
                  </>
                )}
                </div>
              </div>
              <p className="text-[13px] text-muted leading-[22px] line-clamp-2 break-words mt-1 mb-3" title={p.description || p.tagline}>
                {p.description || "暂无介绍，可在配置中查看此专家的能力。"}
              </p>
              <div className="mt-auto flex items-center gap-2 text-[12px]">
                {(p.tags || []).slice(0, 4).map((tag) => <span key={tag} className="rounded-md bg-paper px-2.5 py-1 text-muted whitespace-nowrap">{tag}</span>)}
              </div>
            </article>
          ))}
          {trailingCards}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {(!indexLoaded || !catalogLoaded) ? (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center" data-testid="experts-initial-loading">
          <div className="spinner mb-4" aria-hidden="true" />
          <div className="text-[15px] font-medium text-ink">正在翻找通讯库..</div>
        </div>
      ) : (
      <>
      {categories.length > 0 && (
        <div className="relative mb-2 shrink-0" data-testid="expert-categories">
          <div
            ref={categoryScrollRef}
            className="category-tabs-scroll flex items-center gap-1.5 overflow-x-auto"
            onScroll={updateCategoryEdges}
          >
            <button
              className={`shrink-0 rounded-lg px-3 py-1.5 text-[13px] ${category === "all" ? "bg-chromeHover text-ink font-medium" : "text-muted hover:bg-chromeHover hover:text-ink"}`}
              onClick={() => setCategory("all")}
            >
              全部
            </button>
            <button
              className={`shrink-0 rounded-lg px-3 py-1.5 text-[13px] ${category === "mine" ? "bg-chromeHover text-ink font-medium" : "text-muted hover:bg-chromeHover hover:text-ink"}`}
              onClick={() => setCategory("mine")}
            >
              我的
            </button>
            {categories.map((item) => (
              <button
                key={item.id}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-[13px] ${category === item.id ? "bg-chromeHover text-ink font-medium" : "text-muted hover:bg-chromeHover hover:text-ink"}`}
                title={item.description}
                onClick={() => setCategory(item.id)}
              >
                {item.name}
              </button>
            ))}
          </div>
          {categoryEdges.left && (
            <button
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-panel border border-line shadow-sm text-muted hover:text-ink grid place-items-center"
              aria-label="向左查看更多分类"
              onClick={() => categoryScrollRef.current?.scrollBy({ left: -320, behavior: "smooth" })}
            >
              <Icon name="chevronRight" size={15} className="rotate-180" />
            </button>
          )}
          {categoryEdges.right && (
            <button
              className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-panel border border-line shadow-sm text-muted hover:text-ink grid place-items-center"
              aria-label="向右查看更多分类"
              onClick={() => categoryScrollRef.current?.scrollBy({ left: 320, behavior: "smooth" })}
            >
              <Icon name="chevronRight" size={15} />
            </button>
          )}
        </div>
      )}
      <div className="expert-list-scroll flex-1 min-h-0 overflow-y-auto pr-1 pb-6" data-testid="expert-list-scroll">
      {/* Every expert shown here is immediately available; ★ marks the default. */}
      {category === "all" && group(null, available.filter((p) => p.ships !== false && p.id !== "cowork" && p.id !== "code"), remoteCards)}
      {category === "mine" && group(null, downloadedExperts)}
      {category !== "all" && visibleRemoteExperts.length > 0 && (
        <div className="mt-1.5">
          <div className="text-[12px] font-semibold text-muted px-4 mb-1.5">
            {categories.find((item) => item.id === category)?.name} · {visibleRemoteExperts.length}
          </div>
          <div className="expert-grid" data-testid="remote-expert-grid">
            {remoteCards}
          </div>
        </div>
      )}
      {category !== "all" && visibleRemoteExperts.length === 0 && (category !== "mine" || downloadedExperts.length === 0) && (
        <div className="py-16 text-center text-[13px] text-muted">{category === "mine" ? "暂无已下载的专家" : "该分类暂无专家"}</div>
      )}
      {catalogError && <div className="text-[13px] text-muted mt-4">{catalogError}</div>}
      {selectedRemote && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 p-6" onClick={() => setSelectedRemote(null)}>
          <div className="relative w-full max-w-[580px] max-h-[85vh] overflow-hidden rounded-2xl bg-paper shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <button className="absolute right-14 top-3 z-10 rounded-lg bg-accent px-3 py-1.5 text-[13px] text-white" onClick={() => void summonRemote(selectedRemote)}>召唤</button>
            <button className="absolute right-4 top-3 z-10 text-xl text-muted" aria-label="关闭" onClick={() => setSelectedRemote(null)}>×</button>
            <main className="flex min-h-0 flex-col bg-paper">
              <div className="hairline-scroll max-h-[85vh] overflow-y-auto">
                <div className="mx-auto max-w-3xl space-y-6 px-7 py-6">
                  <header className="flex items-start gap-3.5 pr-28">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-accentSoft text-accent grid place-items-center">
                      <RemoteExpertAvatar expert={selectedRemote} />
                    </div>
                    <div className="min-w-0">
                      <h1 className="text-[20px] font-semibold tracking-tight">{selectedRemote.name}</h1>
                      {selectedRemote.display_name && <p className="mt-0.5 text-[13px] text-muted">{selectedRemote.display_name}</p>}
                    </div>
                  </header>
                  {selectedRemote.description && <section>
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">能力介绍</div>
                    <p className="text-[14px] leading-relaxed text-ink/90">{selectedRemote.description}</p>
                  </section>}
                  {!!selectedRemote.tags.length && <section>
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">擅长领域</div>
                    <div className="flex flex-wrap gap-2">{selectedRemote.tags.map((tag) => <span key={tag} className="whitespace-nowrap rounded-lg border border-line bg-paper px-2.5 py-1 text-[12px] text-muted">{tag}</span>)}</div>
                  </section>}
                  {!!selectedRemote.quick_prompts.length && <section>
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">试试这些任务</div>
                    <div className="rounded-xl2 border border-line bg-panel divide-y divide-line overflow-hidden">{selectedRemote.quick_prompts.map((prompt) => <button key={prompt} className="block w-full px-4 py-3 text-left text-[13px] text-ink hover:bg-chromeHover" onClick={() => void summonRemote(selectedRemote, prompt)}>{prompt}</button>)}</div>
                  </section>}
                </div>
              </div>
            </main>
          </div>
        </div>
      )}
      {(summoning || summonError) && (
        <div className="fixed inset-0 z-[70] bg-paper flex items-center justify-center" data-testid="expert-install-loading">
          <div className="text-center max-w-sm px-6">
            {summoning ? (
              <>
                <div className="spinner mx-auto mb-4" aria-hidden="true" />
                <div className="text-[18px] font-semibold">正在联系{summoning.name}</div>
                <div className="text-[13px] text-muted mt-2">联系成功将自动进入新会话</div>
              </>
            ) : (
              <>
                <div className="text-[18px] font-semibold">专家联系失败</div>
                <div className="text-[13px] text-muted mt-2 break-words">{summonError}</div>
                <button className={BTN_BORDERED + " mt-4"} onClick={() => setSummonError("")}>返回专家列表</button>
              </>
            )}
          </div>
        </div>
      )}

      {category === "all" && unshipped.length > 0 && (
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
              请检查来源、能力和兼容性说明。导入不会执行代码；使用助手时，
              提示词和技能会影响其行为，但不会绕过应用的权限审批。
            </span>
          </div>
          {consent.map((c) => (
            <ConsentCard
              key={c.id}
              c={c}
            />
          ))}
        </div>
      )}
      </div>
      </>
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
}: {
  c: PersonaConsent;
}) {
  const [showTools, setShowTools] = useState(false);
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
            ? " This update asks for MORE capabilities than the copy it replaces — review below before using it."
            : " Same capabilities as before."}
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
        <span className="text-[13px] text-muted">✓ 已导入，可在会话的专家列表中选择。</span>
        <span className="text-[12px] text-faint">建议模式：{c.recommended_mode === "interactive" ? "操作前询问" : c.recommended_mode}</span>
      </div>
    </div>
  );
}
