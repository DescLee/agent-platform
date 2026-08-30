import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  addModel,
  codexAuthStatus,
  codexSignin,
  codexSignout,
  getProviders,
  removeProvider,
  setProvider,
  verifyProvider,
  type ProviderField as ProviderFieldT,
  type ProviderInfo,
} from "../api";
import { openExternal } from "../tauri";
import { PROVIDER_LOGOS, providerRank } from "./logos";

// Keep the first-party provider gallery focused on the providers supported by the
// product's current distribution. OpenAI's optional endpoint field is the custom
// provider path, so custom OpenAI-compatible gateways do not need a second backend
// descriptor or a duplicate credential store.
export const VISIBLE_PROVIDER_NAMES = new Set([
  "openai",
  "openai-codex",
  "anthropic",
  "deepseek",
  "ollama",
  "minimax",
  "kimi",
  "qwen",
  "ark-agent-plan-cn",
  "zai",
]);

// The provider gallery ⇄ key form, shared by Onboarding step 1 (§39) and
// Settings ▸ Models (UX-021) so the two can never drift apart visually. The hook
// owns the interaction state machine; ProviderCards/ProviderForm own the shared
// markup. Each surface keeps its own frame (fixed-height modal vs scrolling page)
// and passes a testid prefix so both stay independently addressable in e2e.

// Where a non-developer gets an API key — deep link + one line of instructions.
export const KEY_HELP: Record<string, { url: string; label: string }> = {
  anthropic: { url: "https://console.anthropic.com/settings/keys", label: "console.anthropic.com" },
  openai: { url: "https://platform.openai.com/api-keys", label: "platform.openai.com" },
  gemini: { url: "https://aistudio.google.com/apikey", label: "aistudio.google.com" },
  ark: { url: "https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey", label: "console.byteplus.com" },
  "ark-agent-plan-cn": { url: "https://console.volcengine.com/ark/region:cn-beijing/openManagement?LLM=%7B%7D&advancedActiveKey=agentPlan", label: "console.volcengine.com" },
  openrouter: { url: "https://openrouter.ai/keys", label: "openrouter.ai" },
  bedrock: { url: "https://console.aws.amazon.com/bedrock/home#/api-keys", label: "the AWS Bedrock console" },
  fireworks: { url: "https://fireworks.ai/account/api-keys", label: "fireworks.ai" },
  together: { url: "https://api.together.xyz/settings/api-keys", label: "together.xyz" },
  zai: { url: "https://z.ai/manage-apikey/apikey-list", label: "z.ai" },
  kimi: { url: "https://platform.moonshot.ai/console/api-keys", label: "platform.moonshot.ai" },
  deepseek: { url: "https://platform.deepseek.com/api_keys", label: "platform.deepseek.com" },
  mistral: { url: "https://console.mistral.ai/api-keys", label: "console.mistral.ai" },
  qwen: { url: "https://modelstudio.console.alibabacloud.com", label: "alibabacloud.com" },
  minimax: { url: "https://platform.minimax.io", label: "platform.minimax.io" },
  xai: { url: "https://console.x.ai", label: "console.x.ai" },
};

export type Verify = { state: "idle" | "testing" | "ok" | "error"; msg?: string };
const isCustomProvider = (name: string | null | undefined) =>
  name === "custom" || !!name?.startsWith("custom-");

const FIELD_LABELS: Record<string, string> = {
  api_key: "API 密钥",
  base_url: "接口地址",
  supplier_name: "供应商名称",
  note: "备注",
  auth_method: "认证方式",
  project_id: "项目 ID",
  region: "区域",
};

const localizeBlurb = (blurb: string | undefined, title: string | undefined) => {
  if (!blurb) return blurb;
  if (/OpenAI-compatible/i.test(blurb)) return `使用 ${title || "该供应商"} 的 OpenAI 兼容 API，接口地址已预填，请填写密钥。`;
  if (/Sign in with your ChatGPT plan/i.test(blurb)) return "使用 ChatGPT 订阅登录并运行 OpenAI 模型。";
  return blurb;
};

const localizeHelp = (help: string | undefined) => {
  if (!help) return help;
  if (/Prefilled with .*official endpoint; edit only for a regional or proxy variant\./i.test(help))
    return "已填入官方接口地址，仅在使用区域或代理地址时修改。";
  return help;
};

/** Brand chip: always a light plate so multicolor marks read on any theme. */
export function ProviderMark({ name, title, size = 32 }: { name: string; title: string; size?: number }) {
  const url = PROVIDER_LOGOS[name];
  return (
    <span
      className="rounded-lg border border-line grid place-items-center shrink-0"
      style={{ width: size, height: size, background: "#f6f7f8" }}
    >
      {url ? (
        <img src={url} alt="" style={{ width: size * 0.6, height: size * 0.6 }} />
      ) : (
        <span className="text-[13px] font-semibold text-muted">{title[0]}</span>
      )}
    </span>
  );
}

/** "2h ago"-style label for a provider's last completion (null when never used). */
export function relTime(epoch?: number | null): string | null {
  if (!epoch) return null;
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - epoch));
  if (secs < 90) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export interface ProviderSetupState {
  providers: ProviderInfo[];
  ordered: ProviderInfo[];
  refreshProviders: () => Promise<void>;
  sel: string | null;
  info: ProviderInfo | undefined;
  fields: Record<string, string>;
  setFieldValue: (key: string, value: string) => void;
  dirty: boolean;
  verify: Verify;
  showEndpoint: boolean;
  setShowEndpoint: (v: boolean) => void;
  keylessOk: Set<string>;
  credentialed: boolean;
  savedState: boolean;
  secretFilled: boolean;
  openProvider: (name: string) => void;
  openProviderBlank: (name: string) => void;
  backToGallery: () => void;
  runTestAndSave: () => Promise<boolean>;
  testOnly: () => Promise<boolean>;
  fetchModels: () => Promise<boolean>;
  saveAfterTest: () => Promise<boolean>;
  saveConfig?: () => Promise<boolean>;
  removeKey: () => Promise<void>;
  cancelBackTimer: () => void;
  statusFor: (p: ProviderInfo, opts?: { lastUsed?: boolean }) => ReactNode;
  // Blur-save for non-secret fields on an already-configured provider (the Test button is
  // the KEY's save path; extras like anthropic's thinking_budget must not need a re-test —
  // owner-hit 2026-07-23: the budget silently never saved).
  saveField: (key: string) => Promise<void>;
  fieldSaved: string | null; // field key flashing "✓ Saved"
  discoveredModels: string[];
  isBlank: boolean;
  notice: string | null;
}

export function useProviderSetup(opts?: { onSaved?: () => void }): ProviderSetupState {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  // null = the gallery; a provider name = that provider's key form.
  const [sel, setSel] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [showEndpoint, setShowEndpoint] = useState(false);
  const [verify, setVerify] = useState<Verify>({ state: "idle" });
  // Keyless providers (Ollama) report configured without proving anything runs —
  // a passing Detect this session is what marks them live.
  const [keylessOk, setKeylessOk] = useState<Set<string>>(new Set());
  // Unsaved per-provider input survives switching cards (owner complaint 2026-07-16).
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const backTimer = useRef<number | null>(null);
  // Which non-secret field just blur-saved (flashes "✓ Saved" in the input).
  const [fieldSaved, setFieldSaved] = useState<string | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [isBlank, setIsBlank] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const fieldSavedTimer = useRef<number | null>(null);

  const refreshProviders = () =>
    getProviders()
      .then(setProviders)
      .catch(() => {});
  useEffect(() => {
    refreshProviders();
    return () => {
      if (backTimer.current) window.clearTimeout(backTimer.current);
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  const info = providers.find((p) => p.name === sel);
  const credentialed = !!info?.configured && !!info?.needs_key;

  const openProvider = (name: string, blank = false) => {
    const p = providers.find((x) => x.name === name);
    if (sel) setDrafts((d) => ({ ...d, [sel]: fields }));
    const draft = blank ? undefined : drafts[name];
    const next: Record<string, string> = {};
    for (const f of p?.fields || []) next[f.key] = blank ? f.default || "" : draft?.[f.key] || p?.values?.[f.key] || f.default || "";
    setSel(name);
    setIsBlank(blank);
    setFields(next);
    setDirty(!!draft && Object.values(draft).some(Boolean));
    setVerify({ state: "idle" });
    setDiscoveredModels([]);
    setShowEndpoint(false);
  };

  const openProviderBlank = (name: string) => openProvider(name, true);

  const backToGallery = () => {
    // Stash only UNSAVED input. The unconditional stash used to capture the just-saved
    // key on the post-Test auto-return, so revisiting a connected provider restored the
    // plaintext key into the field instead of the masked placeholder + saved pill
    // (state-restore bug, owner catch 2026-07-19). A clean form clears any stale draft.
    if (sel) setDrafts((d) => ({ ...d, [sel]: dirty ? fields : {} }));
    setSel(null);
    setVerify({ state: "idle" });
  };

  // Test = verify AND save AND return (§39: a passing Test auto-saves and takes
  // you back to the gallery, where the card now wears its ✓ — no extra clicks).
  const testOnly = async (): Promise<boolean> => {
    if (!sel) return false;
    setVerify({ state: "testing" });
    const res = await verifyProvider(sel!, fields).catch(
      () => ({ ok: false, error: "unreachable" } as { ok: boolean; error?: string; models?: string[] }),
    );
    if (!res.ok) {
      setVerify({ state: "error", msg: res.error || "couldn't verify" });
      return false;
    }
    setVerify({ state: "ok" });
    return true;
  };

  const fetchModels = async (): Promise<boolean> => {
    if (!sel) return false;
    setVerify({ state: "testing" });
    const res = await verifyProvider(sel!, fields).catch(
      () => ({ ok: false, error: "无法连接接口" } as { ok: boolean; error?: string; models?: string[] }),
    );
    if (!res.ok) {
      setVerify({ state: "error", msg: res.error || "获取模型失败" });
      setNotice(res.error || "获取模型失败");
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => setNotice(null), 3500);
      return false;
    }
    setDiscoveredModels(res.models || []);
    setVerify({ state: "ok" });
    return true;
  };

  const saveAfterTest = async (): Promise<boolean> => {
    if (!sel) return false;
    if (isCustomProvider(sel)) {
      const missing = [
        !fields.supplier_name?.trim() && "供应商名称",
        !fields.base_url?.trim() && "接口地址",
        isBlank && !fields.api_key?.trim() && "API key",
      ].filter(Boolean) as string[];
      if (missing.length) {
        setNotice(`请填写：${missing.join("、")}`);
        if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setNotice(null), 3500);
        return false;
      }
    }
    const tested = await testOnly();
    if (!tested) return false;
    const saveName = isBlank && sel === "custom" ? "custom-new" : sel;
    const saved = await setProvider(saveName!, fields).catch(() => ({ ok: false, error: "保存失败，请稍后重试。", provider: undefined }));
    if (!saved.ok) {
      setVerify({ state: "error", msg: saved.error || "保存失败，请稍后重试。" });
      return false;
    }
    if (isCustomProvider(sel) && saved.provider && discoveredModels.length) {
      await Promise.all(discoveredModels.map((model) => addModel(`${saved.provider}:${model}`)));
    }
    if (!info?.needs_key) setKeylessOk((s) => new Set(s).add(sel));
    setDirty(false);
    setDrafts((d) => ({ ...d, [sel]: {} }));
    await refreshProviders();
    opts?.onSaved?.();
    // A successful custom save completes the add flow and returns to the model list.
    setSel(null);
    setVerify({ state: "idle" });
    return true;
  };

  // Explicit save action for first-party providers. A provider must have a
  // credential (unless one is already stored) and a successful test before it
  // can be persisted from the top-right Save button.
  const saveConfig = async (): Promise<boolean> => {
    if (!sel) return false;
    const hasRequiredSecret =
      (info?.fields || []).every((f) => !f.secret || !f.required || (fields[f.key] || "").trim()) ||
      credentialed ||
      !info?.needs_key;
    if (!hasRequiredSecret) {
      setNotice("请先填写 API key");
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => setNotice(null), 3500);
      return false;
    }
    if (verify.state !== "ok") {
      setNotice("请先通过测试后再保存");
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => setNotice(null), 3500);
      return false;
    }
    const saved = await setProvider(sel, fields).catch(() => ({ ok: false, error: "保存失败，请稍后重试。" }));
    if (!saved.ok) {
      setVerify({ state: "error", msg: saved.error || "保存失败，请稍后重试。" });
      return false;
    }
    setDirty(false);
    setDrafts((d) => ({ ...d, [sel]: {} }));
    await refreshProviders();
    opts?.onSaved?.();
    setNotice("创建成功");
    if (backTimer.current) window.clearTimeout(backTimer.current);
    backTimer.current = window.setTimeout(() => {
      setSel(null);
      setVerify({ state: "idle" });
      setNotice(null);
    }, 900);
    return true;
  };

  const runTestAndSave = async (): Promise<boolean> => {
    if (isCustomProvider(sel)) return saveAfterTest();
    const tested = await testOnly();
    if (!tested) return false;
    setDirty(false);
    setDrafts((d) => ({ ...d, [sel!]: {} }));
    await refreshProviders();
    opts?.onSaved?.();
    backTimer.current = window.setTimeout(() => {
      setSel(null);
      setVerify({ state: "idle" });
    }, 900);
    return true;
  };

  // Blur-save for non-secret fields when the provider is already configured: extras like
  // anthropic's thinking_budget must persist without a key re-test (owner-hit 2026-07-23 —
  // typed, left Settings, silently never saved). Secrets keep the explicit Test-to-save
  // contract; unconfigured providers save everything on their first Test.
  const saveField = async (key: string) => {
    if (!sel || !info?.configured) return;
    const spec = info.fields.find((f) => f.key === key);
    if (!spec || spec.secret) return;
    const current = (fields[key] || "").trim();
    const stored = (info.values?.[key] || "").trim();
    if (current === stored) return;
    const res = await setProvider(sel, { [key]: current }).catch(() => ({ ok: false }));
    if (!res.ok) return;
    await refreshProviders();
    opts?.onSaved?.();
    setFieldSaved(key);
    if (fieldSavedTimer.current) window.clearTimeout(fieldSavedTimer.current);
    fieldSavedTimer.current = window.setTimeout(() => setFieldSaved(null), 1400);
  };

  // Settings-only: forget the stored key; the card reverts to "Not set up".
  const removeKey = async () => {
    if (!sel) return;
    await removeProvider(sel).catch(() => {});
    setDrafts((d) => ({ ...d, [sel]: {} }));
    setKeylessOk((s) => {
      const next = new Set(s);
      next.delete(sel);
      return next;
    });
    await refreshProviders();
    opts?.onSaved?.();
    setSel(null);
    setVerify({ state: "idle" });
  };

  const statusFor = (p: ProviderInfo, o?: { lastUsed?: boolean }) => {
    if (p.auth === "oauth") {
      // The card keeps just the state — the account email truncated badly at card
      // width (owner-hit 2026-08-21); the detail pane shows who is signed in.
      if (p.signed_in)
        return <span className="block text-[12px] text-ok font-medium truncate">✓ 已登录</span>;
      return <span className="block text-[12px] text-faint truncate">使用订阅计划登录</span>;
    }
    if (p.configured && p.needs_key) {
      const used = o?.lastUsed ? relTime(p.last_used_at) : null;
      return (
        <span className="block text-[12px] text-ok font-medium truncate">
          ✓ 已连接{used ? <span className="text-muted font-normal"> · 最近使用于 {used}</span> : ""}
        </span>
      );
    }
    if (!p.needs_key)
      return (
        <span className="block text-[12px] text-faint truncate">
          {keylessOk.has(p.name) ? <span className="text-ok font-medium">✓ 运行中</span> : "无需密钥"}
        </span>
      );
    return <span className="block text-[12px] text-faint truncate">未配置</span>;
  };

  return {
    providers,
    // Alphabetical by display title (owner ruling 2026-08-21: a curated order reads
    // as vendor bias). The old providerRank curation stays only as the tiebreaker
    // for identical titles.
    ordered: [...providers].sort(
      (a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) ||
        providerRank(a.name) - providerRank(b.name),
    ),
    refreshProviders,
    sel,
    info,
    fields,
    setFieldValue: (key, value) => {
      setFields((cur) => ({ ...cur, [key]: value }));
      setDirty(true);
      setVerify({ state: "idle" });
    },
    dirty,
    verify,
    showEndpoint,
    setShowEndpoint,
    keylessOk,
    credentialed,
    // The in-field saved state (§39): green border + pill INSIDE the key box — shown
    // for stored credentials and fresh test-passes alike; typing clears it.
    savedState: (!isBlank && credentialed && !dirty) || verify.state === "ok",
    // Only REQUIRED secrets gate the Test button — cloud providers (Bedrock, Vertex)
    // have optional key fields whose credentials may live in ~/.aws or ADC instead.
    secretFilled: (info?.fields || []).every(
      (f) => !f.secret || !f.required || (fields[f.key] || "").trim(),
    ),
    openProvider,
    openProviderBlank,
    backToGallery,
    runTestAndSave,
    testOnly,
    fetchModels,
    saveAfterTest,
    saveConfig,
    removeKey,
    saveField,
    fieldSaved,
    discoveredModels,
    isBlank,
    notice,
    cancelBackTimer: () => {
      if (backTimer.current) window.clearTimeout(backTimer.current);
    },
    statusFor,
  };
}

/** The gallery: one card per provider, each wearing its own state. */
/** OAuth provider pane (auth === "oauth"): browser sign-in instead of a key form.
 * Signin runs server-side in the background; this polls the status route until the
 * flow flips to signed-in or reports an error. Tokens never reach the GUI. */
function OAuthSignIn({ info, tp, onChanged }: { info: ProviderInfo; tp: string; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(!!info.authorizing);
  const [error, setError] = useState<string | null>(info.last_error || null);
  const [reopenUrl, setReopenUrl] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true; // StrictMode double-mount: the cleanup below must not stick
    return () => { alive.current = false; };
  }, []);

  const poll = async () => {
    for (let i = 0; i < 150 && alive.current; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = await codexAuthStatus().catch(() => null);
      if (!s) continue;
      if (s.authorize_url) setReopenUrl(s.authorize_url);
      if (s.signed_in || (!s.authorizing && s.last_error)) {
        if (alive.current) {
          setBusy(false);
          setError(s.last_error || null);
        }
        await onChanged();
        return;
      }
    }
    if (alive.current) setBusy(false);
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    await codexSignin().catch(() => setError("无法启动登录，请稍后重试。"));
    void poll();
  };

  if (info.signed_in)
    return (
      <div className="mt-4">
        <div className="flex items-center gap-2.5 rounded-xl border border-okLine bg-okSoft px-3 py-2.5">
          <span className="text-[13px] text-ink min-w-0 flex-1 truncate" data-testid={`${tp}-oauth-account`}>
            ✓ 已登录{info.account ? `（${info.account}）` : ""}
          </span>
          <button
            className="shrink-0 rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px] text-ink hover:border-lineStrong"
            data-testid={`${tp}-oauth-signout`}
            onClick={async () => {
              await codexSignout().catch(() => {});
              await onChanged();
            }}
          >
            退出登录
          </button>
        </div>
        <p className="text-[12px] text-faint mt-2">
          用量取决于订阅计划的滚动窗口，而非按 token 计费。登录信息仅保存在此电脑。
        </p>
      </div>
    );

  return (
    <div className="mt-4">
      <button
        className="rounded-lg border border-accent bg-accent px-4 py-2 text-[13px] font-medium text-white hover:brightness-105 disabled:opacity-40"
        onClick={() => void start()}
        disabled={busy}
        data-testid={`${tp}-oauth-signin`}
      >
        {busy ? "等待浏览器操作…" : "使用 ChatGPT 登录"}
      </button>
      {busy && (
        <p className="text-[12px] text-faint mt-2">
          请在浏览器窗口完成登录。
          {reopenUrl && (
            <>
              {" "}
              <button
                className="text-muted underline decoration-line underline-offset-2 hover:text-ink"
                onClick={() => openExternal(reopenUrl)}
              >
                重新打开登录页面
              </button>
            </>
          )}
        </p>
      )}
      <div className="mt-2 min-h-[19px] text-[13px]">
        {error && <span className="text-warnInk">{error}</span>}
      </div>
    </div>
  );
}

export function ProviderCards({
  ps,
  tp,
  gridClass = "grid grid-cols-2 gap-2.5",
  lastUsed = false,
}: {
  ps: ProviderSetupState;
  tp: string; // testid prefix ("ob" onboarding, "set" settings)
  gridClass?: string;
  lastUsed?: boolean;
}) {
  const card =
    "flex items-center gap-2.5 rounded-xl border border-line bg-panel px-3 py-2.5 text-left hover:border-lineStrong transition-colors";
  return (
    <div className={gridClass}>
      {ps.ordered.filter((p) => VISIBLE_PROVIDER_NAMES.has(p.name)).map((p) => (
        <button
          key={p.name}
          className={card}
          data-testid={`${tp}-provider-${p.name}`}
          onClick={() => ps.openProvider(p.name)}
        >
          <ProviderMark name={p.name} title={p.title} />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold leading-tight truncate">{p.title}</span>
            {ps.statusFor(p, { lastUsed })}
          </span>
          <span className="text-faint text-[14px]">›</span>
        </button>
      ))}
    </div>
  );
}

/** One provider's key form: crumb, brand head, fields (endpoint behind a quiet
 * disclosure), in-field saved pill, Test/Detect, key help, fixed error line.
 * `footer` renders after the error line (Settings adds "Remove key…" there). */
export function ProviderForm({
  ps,
  tp,
  footer,
}: {
  ps: ProviderSetupState;
  tp: string;
  footer?: ReactNode;
}) {
  const { info, sel } = ps;
  const label = "block text-[12px] text-muted mt-3 mb-1";
  const input =
    "w-full px-3 py-2 rounded-lg border bg-panel text-[13px] outline-none focus:border-accent";
  const fieldsAll = info?.fields || [];
  const keyed = fieldsAll.some((x) => x.secret);
  // Cloud providers declare a segmented auth-method choice; the selected method's
  // credential fields render inside a panel with its own Test & save footer.
  const choice = fieldsAll.find((f) => f.choices && f.choices.length);
  const method = choice ? ps.fields[choice.key] || choice.default || "" : "";
  const selected = choice?.choices?.find((c) => c.value === method);
  const methodFields = choice
    ? fieldsAll.filter(
        (f) =>
          f.show_when &&
          Object.entries(f.show_when).every(([k, v]) => (ps.fields[k] || "") === v),
      )
    : [];
  // Without a choice control, Test lives next to the required secret (the API key), or
  // the first field for keyless providers (Ollama's Detect).
  const requiredSecret = fieldsAll.find((x) => x.secret && x.required);
  const testKey = requiredSecret ? requiredSecret.key : fieldsAll[0]?.key;
  if (!sel) return null;

  const fieldRow = (f: ProviderFieldT, testable: boolean) => (
    <div key={f.key}>
        <label className={label}>{FIELD_LABELS[f.key] || f.label}</label>
      <div className="flex gap-2">
        <div className="relative flex-1 min-w-0">
          <input
            className={input + (ps.savedState && testable ? " border-ok pr-32" : " border-line")}
            type={f.secret ? "password" : "text"}
            placeholder={f.secret && ps.credentialed && !ps.dirty ? "••••••••" : f.placeholder}
            value={ps.fields[f.key] || ""}
            data-testid={`${tp}-field-${f.key}`}
            onChange={(e) => ps.setFieldValue(f.key, e.target.value)}
            onBlur={f.secret ? undefined : () => void ps.saveField(f.key)}
          />
          {ps.fieldSaved === f.key && (
            <span
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-medium text-ok bg-okSoft rounded-full px-2 py-0.5 pointer-events-none"
              data-testid={`${tp}-field-saved-${f.key}`}
            >
              ✓ 已保存
            </span>
          )}
          {/* §39: state lives IN the field — no status lines below. */}
          {ps.savedState && testable && (
            <span
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-medium text-ok bg-okSoft rounded-full px-2 py-0.5 pointer-events-none"
              data-testid={`${tp}-saved-pill`}
            >
              {isCustomProvider(sel) ? <>✓ 连接成功</> : info?.needs_key ? <>✓ 测试通过并已保存</> : <>✓ 已检测</>}
            </span>
          )}
        </div>
        {testable && (
          <div className="flex gap-2 shrink-0">
            <button
              className="px-4 rounded-lg border border-line text-[13px] font-medium text-ink hover:border-lineStrong disabled:opacity-40"
              onClick={() => (isCustomProvider(sel) ? ps.testOnly() : ps.runTestAndSave())}
              disabled={ps.verify.state === "testing" || (!ps.secretFilled && !ps.credentialed)}
              data-testid={`${tp}-test`}
            >
              连通测试
            </button>
            <button
              className="px-4 rounded-lg border border-line text-[13px] font-medium text-ink hover:border-lineStrong disabled:opacity-40"
              onClick={() => void ps.fetchModels()}
              disabled={ps.verify.state === "testing"}
              data-testid={`${tp}-fetch-models`}
            >
              获取模型
            </button>
          </div>
        )}
      </div>
      {f.help && <p className="text-[12px] text-faint mt-1">{localizeHelp(f.help)}</p>}
    </div>
  );

  return (
    <div>
      {ps.notice && (
        <div className="fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-lg border border-line bg-panel px-4 py-3 text-[13px] text-ink shadow-lg" role="status">
          <span className="mr-2 inline-block h-2 w-2 rounded-full bg-accent" />
          {ps.notice}
        </div>
      )}
      <button className="text-[13px] text-muted hover:text-ink" onClick={ps.backToGallery} data-testid={`${tp}-back`}>
        ‹ 所有供应商
      </button>
      <div className="flex items-center gap-3 mt-3 mb-1">
        <ProviderMark name={info?.name || ""} title={info?.title || ""} size={36} />
        <span className="min-w-0">
          <span className="block text-[14px] font-semibold leading-tight">{info?.title}</span>
          {!ps.isBlank && info ? ps.statusFor(info) : null}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {isCustomProvider(sel) && (
            <button
              className="rounded-lg bg-accent px-4 py-1.5 text-[13px] font-medium text-white hover:brightness-105"
              data-testid={`${tp}-custom-save`}
              onClick={() => void ps.saveAfterTest()}
            >
              保存
            </button>
          )}
          {!isCustomProvider(sel) && info?.auth !== "oauth" && (
            <button
              className="rounded-lg bg-accent px-4 py-1.5 text-[13px] font-medium text-white hover:brightness-105 disabled:opacity-40"
              data-testid={`${tp}-save`}
              onClick={() => void ps.saveConfig?.()}
              disabled={ps.verify.state === "testing"}
            >
              保存
            </button>
          )}
          {!ps.isBlank && footer}
        </div>
      </div>
      {info?.blurb && <p className="text-[12px] text-faint mt-1">{localizeBlurb(info.blurb, info.title)}</p>}

      {info?.auth === "oauth" && <OAuthSignIn info={info} tp={tp} onChanged={ps.refreshProviders} />}

      {fieldsAll
        .filter(
          (f) =>
            !f.show_when &&
            !(f.choices && f.choices.length) &&
            !(f.key === "base_url" && keyed && !isCustomProvider(sel)),
        )
        .map((f) => fieldRow(f, !choice && f.key === testKey))}

      {/* Auth-method segmented control + the selected method's panel (owner call
          2026-07-26): one joined track, then a soft inset card holding only that
          method's description, fields, and its own Test & save footer. */}
      {choice && (
        <div>
          <label className={label}>{choice.label}</label>
          <div
            className="inline-flex gap-0.5 rounded-[10px] border border-line bg-line/40 p-[3px]"
            role="radiogroup"
            aria-label={choice.label}
          >
            {(choice.choices || []).map((c) => {
              const active = method === c.value;
              return (
                <button
                  key={c.value}
                  role="radio"
                  aria-checked={active}
                  className={
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] whitespace-nowrap transition-colors " +
                    (active
                      ? "bg-panel text-ink font-medium shadow-sm ring-1 ring-line"
                      : "text-muted hover:text-ink")
                  }
                  data-testid={`${tp}-choice-${choice.key}-${c.value}`}
                  onClick={() => ps.setFieldValue(choice.key, c.value)}
                >
                  {c.label}
                  {c.tag && (
                    <span className="text-[9.5px] font-semibold uppercase tracking-wide text-accent bg-accentSoft rounded-full px-1.5 py-px">
                      {c.tag}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-2.5 rounded-xl border border-line bg-paper/60 px-4 pb-3.5 pt-3">
            {selected?.desc && <p className="text-[12px] text-muted">{selected.desc}</p>}
            {selected?.command && (
              <button
                className="mt-2.5 inline-flex items-center gap-2 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[12px] font-mono text-ink hover:border-lineStrong"
                onClick={() => void navigator.clipboard?.writeText(selected.command || "")}
                title="复制命令"
                data-testid={`${tp}-cmd-copy`}
              >
                {selected.command}
                <span className="font-sans text-[11px] text-faint">⧉</span>
              </button>
            )}
            {methodFields.map((f) => fieldRow(f, false))}
            <div className="mt-3.5 flex items-center justify-between gap-3 border-t border-line pt-3">
              {ps.savedState ? (
                <span className="text-[12px] font-medium text-ok" data-testid={`${tp}-saved-pill`}>
                  {isCustomProvider(sel) ? <>✓ 连接成功</> : <>✓ 测试通过并已保存</>}
                </span>
              ) : (
                <span className="text-[12px] text-faint">
                  {isCustomProvider(sel) ? "仅测试接口，不会保存配置。" : "执行一次只读检查，随后保存配置。"}
                </span>
              )}
              <div className="flex shrink-0 items-center gap-2">
                <button
                  className="rounded-lg border border-accent bg-accent px-4 py-1.5 text-[13px] font-medium text-white hover:brightness-105 disabled:opacity-40"
                  onClick={() => (isCustomProvider(sel) ? ps.testOnly() : ps.runTestAndSave())}
                  disabled={ps.verify.state === "testing"}
                  data-testid={`${tp}-test`}
                >
                  {ps.verify.state === "testing" ? "…" : "连通测试"}
                </button>
                <button
                  className="rounded-lg border border-line bg-panel px-4 py-1.5 text-[13px] font-medium text-ink hover:border-lineStrong disabled:opacity-40"
                  onClick={() => void ps.fetchModels()}
                  disabled={ps.verify.state === "testing"}
                  data-testid={`${tp}-fetch-models`}
                >
                  获取模型
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {info?.needs_key && KEY_HELP[sel] && (
        <p className="text-[12px] text-faint mt-2">
          还没有密钥？{" "}
          <button
            className="text-muted underline decoration-line underline-offset-2 hover:text-ink"
            onClick={() => openExternal(KEY_HELP[sel].url)}
          >
            前往 {KEY_HELP[sel].label} 创建 ↗
          </button>{" "}
          ，大约需要一分钟。
        </p>
      )}
      {info && !info.needs_key && info.auth !== "oauth" && (
        <p className="text-[12px] text-faint mt-2">
          无需 API 密钥，Ollama 会在此电脑上运行模型。{" "}
          <button
            className="text-muted underline decoration-line underline-offset-2 hover:text-ink"
            onClick={() => openExternal("https://ollama.com/download")}
          >
            安装 Ollama ↗
          </button>
        </p>
      )}

      {/* Custom endpoint (keyed providers only): a quiet disclosure BELOW the key help,
          with enough separation to read as its own advanced row — no explainer copy
          (owner calls 2026-07-18 + 2026-07-19). */}
      {(() => {
        if (isCustomProvider(sel)) return null;
        const keyed = (info?.fields || []).some((x) => x.secret);
        const ep = keyed ? (info?.fields || []).find((f) => f.key === "base_url") : undefined;
        if (!ep) return null;
        if (!ps.showEndpoint)
          return (
            <button
              className="block self-start text-[13px] text-muted hover:text-ink mt-4"
              onClick={() => ps.setShowEndpoint(true)}
              data-testid={`${tp}-endpoint-link`}
            >
              自定义接口 ⌄
            </button>
          );
        return (
          <div className="mt-4">
            <label className={label}>{FIELD_LABELS[ep.key] || ep.label}</label>
            <div className="relative">
              <input
                className={input + " border-line"}
                type="text"
                placeholder={ep.placeholder}
                value={ps.fields[ep.key] || ""}
                data-testid={`${tp}-field-${ep.key}`}
                onChange={(e) => ps.setFieldValue(ep.key, e.target.value)}
                onBlur={() => void ps.saveField(ep.key)}
              />
              {ps.fieldSaved === ep.key && (
                <span
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-medium text-ok bg-okSoft rounded-full px-2 py-0.5 pointer-events-none"
                  data-testid={`${tp}-field-saved-${ep.key}`}
                >
                ✓ 已保存
                </span>
              )}
            </div>
            {ep.help && <p className="text-[12px] text-faint mt-1">{ep.help}</p>}
          </div>
        );
      })()}

      {/* Error line: fixed height so failures never reflow the form. */}
      <div className="mt-3 min-h-[19px] text-[13px]">
        {ps.verify.state === "error" && <span className="text-warnInk">{ps.verify.msg}</span>}
      </div>
      {ps.discoveredModels.length > 0 && (
        <div className="mt-3 rounded-lg border border-line bg-paper px-3 py-2.5" data-testid={`${tp}-discovered-models`}>
          <div className="text-[12px] font-medium text-muted mb-2">已发现模型</div>
          <div className="flex flex-wrap gap-1.5">
            {ps.discoveredModels.map((model) => (
              <span
                key={model}
                className="rounded-md border border-line bg-panel px-2 py-1 text-[12px] text-ink"
              >
                {model}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
