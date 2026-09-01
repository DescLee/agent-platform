import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  getSettings,
  getTrustedWorkspaces,
  setAutoApprove,
  setAutoApproveShadow,
  setCompactionSettings,
  setContextBar,
  setOnboarded,
  setPdfSettings,
  setScratchBase,
  setSessionsPeek,
  setWorkspaceTrusted,
  type CompactionSettings,
  type ModelSettings,
  type PdfSettings,
  type WorkspaceCommandTrust,
} from "../api";
import {
  cancelDictationModelDownload,
  deleteDictationModel,
  downloadDictationModel,
  getAutostart,
  getDictationStatus,
  getKeepAwake,
  checkForUpdate,
  installUpdate,
  isTauri,
  listenDictationDownloadProgress,
  markDictationTestPassed,
  pickFolder,
  setAutostart,
  setKeepAwake,
  startDictation,
  stopDictation,
  verifyDictationModel,
  type DictationDownloadProgress,
  type DictationStatus,
} from "../tauri";
import { useThemePref } from "../theme";
import { Icon } from "./Icon";
import { PanelHead } from "./IntegrationsView";
import { ModelsTab } from "./ManageTabs";
import { MemorySection } from "./MemorySection";
import { PersonasTab } from "./PersonasTab";
import { SkillsTab } from "./SkillsTab";

// Settings, restructured (Option 2) into a full-page surface that mirrors IntegrationsView's shell:
// a left sub-nav (Appearance · Files · Models · Personas) + centered panel, replacing the old
// top-tab ManageModal. Local/app concerns live here; anything external (Connectors, Messaging, MCP,
// Activity) stays under Integrations. Appearance + Files are re-skinned to the mock's Tailwind idiom;
// Models + Personas host the existing tab components inside the page shell (field re-skin to follow).
// "appearance" is the General tab's stable key — callers deep-link with it, so the
// rename (UX-021) changed only the label. "files" folded into General as a card.
type SetTab = "appearance" | "models" | "context" | "skills" | "voice" | "memory";

const CARD = "rounded-xl2 border border-line bg-panel";
const FIELD_LABEL = "text-[13px] font-medium text-ink";
const FIELD_HELP = "text-[12px] text-muted mt-1.5 leading-relaxed";
const INPUT =
  "flex-1 min-w-0 px-3 py-2 rounded-lg border border-line bg-paper text-[13px] text-ink outline-none focus:border-accent";
const BTN_ACCENT = "text-[13px] px-3 py-2 rounded-lg bg-accent text-white shrink-0 disabled:opacity-40";
const BTN_BORDERED =
  "text-[13px] px-3 py-2 rounded-lg border border-line bg-paper hover:border-lineStrong shrink-0";

const SET_TABS: {
  key: SetTab;
  label: string;
  icon: "sliders" | "code" | "mic" | "archive" | "sparkle" | "book" | "refresh";
}[] = [
  { key: "appearance", label: "通用", icon: "sliders" },
  { key: "models", label: "模型", icon: "code" },
  { key: "context", label: "上下文优化", icon: "refresh" },
  { key: "skills", label: "技能", icon: "book" },
  { key: "voice", label: "语音输入", icon: "mic" },
  { key: "memory", label: "记忆", icon: "archive" },
];

export function SettingsView({
  initialTab,
  onCreateSkill,
}: {
  initialTab?: SetTab;
  // Skills doorway (SKILLS-SPEC §5.2): start a new conversation with the description
  // prefilled — the worker builds the skill and proposes it via save_skill.
  onCreateSkill?: (description: string) => void;
}) {
  const tabs = SET_TABS;
  const wanted = initialTab || "appearance";
  const [tab, setTab] = useState<SetTab>(wanted);
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [tab]);

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-hidden flex bg-paper">
      <nav className="page-subnav w-[208px] shrink-0 border-r border-line bg-panel/40 px-3 py-4">
        <div className="px-2 text-[13px] font-semibold mb-3 flex items-center gap-2">
          <Icon name="gear" size={16} /> 设置
        </div>
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              className={
                "w-full text-left px-2.5 py-2 rounded-lg text-[13px] flex items-center gap-2 " +
                (active ? "bg-paper text-accent font-medium" : "text-muted hover:bg-paper hover:text-ink")
              }
              onClick={() => setTab(t.key)}
            >
              <Icon name={t.icon} size={15} /> {t.label}
            </button>
          );
        })}
      </nav>

      <div ref={scrollRef} data-testid="settings-scroll" className="flex-1 min-w-0 min-h-0 overflow-y-auto overscroll-contain hairline-scroll">
        <div className="max-w-3xl mx-auto px-7 py-6">
          {tab === "appearance" ? (
            <AppearanceSection />
          ) : tab === "models" ? (
            <section>
              <PanelHead
                title="模型"
                sub="管理服务商及输入框中可选的模型；密钥仅保存在本机。"
              />
              <ModelsTab />
            </section>
          ) : tab === "context" ? (
            <section>
              <PanelHead
                title="上下文优化"
                sub="控制会话如何使用 Token，包括附件处理与长会话压缩。"
              />
              <TokenSavingsCard />
              <CompactionCard />
            </section>
          ) : tab === "skills" ? (
            <SkillsTab onCreateSkill={onCreateSkill} />
          ) : tab === "voice" ? (
            <VoiceInputSection />
          ) : (
            <MemorySection />
          )}
        </div>
      </div>
    </main>
  );
}

// -- Voice input: deliberate model provisioning + compatibility + microphone test (§37) --------
const voiceError = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === "string" ? error : "语音输入无法完成该操作。";

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 MiB";
  return `${Math.round(bytes / 1024 / 1024)} MiB`;
};

function VoiceInputSection() {
  const [status, setStatus] = useState<DictationStatus | null>(null);
  const [progress, setProgress] = useState<DictationDownloadProgress | null>(null);
  const [phase, setPhase] = useState<"idle" | "downloading" | "verifying" | "testing" | "transcribing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [testTranscript, setTestTranscript] = useState("");
  const desktop = isTauri();

  const publish = (next: DictationStatus) => {
    setStatus(next);
    window.dispatchEvent(new CustomEvent("coworker:voice-input-changed", { detail: next }));
  };

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    let unlisten = () => {};
    void listenDictationDownloadProgress((next) => {
      if (active) setProgress(next);
    }).then((stop) => {
      unlisten = stop;
    });
    void getDictationStatus().then(async (initial) => {
      if (!active || !initial) return;
      publish(initial);
      // One-time migration for models installed by the first STT cut, before verification markers.
      if (initial.model_installed && !initial.model_verified) {
        setPhase("verifying");
        try {
          const verified = await verifyDictationModel();
          if (active) publish(verified);
        } catch (verifyError) {
          if (active) setError(voiceError(verifyError));
        } finally {
          if (active) setPhase("idle");
        }
      }
    });
    return () => {
      active = false;
      unlisten();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop]);

  const download = async () => {
    setError(null);
    setProgress({ downloaded_bytes: 0, total_bytes: status?.model_bytes || 0 });
    setPhase("downloading");
    try {
      publish(await downloadDictationModel());
    } catch (downloadError) {
      setError(voiceError(downloadError));
      const latest = await getDictationStatus();
      if (latest) publish(latest);
    } finally {
      setPhase("idle");
    }
  };

  const cancelDownload = async () => {
    await cancelDictationModelDownload().catch(() => undefined);
  };

  const repair = async () => {
    setError(null);
    try {
      publish(await deleteDictationModel());
      await download();
    } catch (repairError) {
      setError(voiceError(repairError));
    }
  };

  const remove = async () => {
    if (!window.confirm("Delete the local Whisper model and disable Voice Input?")) return;
    setError(null);
    try {
      publish(await deleteDictationModel());
      setTestTranscript("");
      setProgress(null);
    } catch (deleteError) {
      setError(voiceError(deleteError));
    }
  };

  const toggleTest = async () => {
    if (!status?.supported || !status.model_verified) return;
    setError(null);
    try {
      if (status.recording) {
        setPhase("transcribing");
        const transcript = (await stopDictation()).trim();
        setTestTranscript(transcript);
        if (!transcript) throw new Error("No speech was detected. Try again and speak for a little longer.");
        publish(await markDictationTestPassed());
      } else {
        setTestTranscript("");
        setPhase("testing");
        publish(await startDictation());
      }
    } catch (testError) {
      setError(voiceError(testError));
      const latest = await getDictationStatus();
      if (latest) publish(latest);
    } finally {
      setPhase("idle");
    }
  };

  const downloading = phase === "downloading" || !!status?.download_in_progress;
  const progressTotal = progress?.total_bytes || status?.model_bytes || 1;
  const progressPercent = Math.min(100, Math.round(((progress?.downloaded_bytes || 0) / progressTotal) * 100));
  const ready = !!status?.supported && !!status?.model_verified && !!status?.test_passed;

  return (
    <section>
      <PanelHead
        title="语音输入"
        sub="在输入框中自然说话；录音和转写内容始终保留在本机。"
      />

      {!desktop ? (
        <div className={CARD + " p-4 text-[13px] text-muted"}>语音输入设置仅在绿巨人桌面客户端中可用。</div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-green-200 bg-green-50/70 px-4 py-3 text-[13px] text-green-800">
            <span className="font-medium">隐私优先。</span>音频仅在录音期间暂存于内存，并在本地完成转写。
          </div>

          <div className={CARD}>
            <div className="p-4 flex items-start gap-3">
              <Icon name="code" size={18} className="text-accent mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">当前设备</div>
                <div className="text-[12px] text-muted mt-1">{status?.device_summary || "正在检查兼容性…"}</div>
                {status?.compatibility_reason && <div className="text-[12px] text-red-600 mt-1.5">{status.compatibility_reason}</div>}
              </div>
              {status && (
                <span className={"text-[12px] px-2 py-1 rounded-full " + (status.supported ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600")}>
                  {status.supported ? "● 兼容" : "不支持"}
                </span>
              )}
            </div>
            <div className="border-t border-line bg-paper/50 px-4 py-3 grid grid-cols-2 gap-3 text-[12px] text-muted">
              <div><span className="block text-ink font-medium">Mac</span>macOS 12+ · Apple Silicon M1+</div>
              <div><span className="block text-ink font-medium">Windows</span>Windows 10 22H2/11 · x64</div>
              <div><span className="block text-ink font-medium">内存</span>建议 8 GB</div>
              <div><span className="block text-ink font-medium">处理器</span>建议 4 核 CPU</div>
            </div>
          </div>

          <div className={CARD}>
            <div className="p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-accentSoft text-accent grid place-items-center font-semibold">W</div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">Whisper Base · 英语</div>
                <div className="text-[12px] text-muted mt-0.5">
                  {status?.model_verified ? `已安装并验证 · ${formatBytes(status.model_bytes)}` : `本地语音模型 · ${formatBytes(status?.model_bytes || 147_964_211)}`}
                </div>
              </div>
              {status?.model_verified ? (
                <>
                  <span className="text-[12px] px-2 py-1 rounded-full bg-green-50 text-green-700">已验证</span>
                  <button className={BTN_BORDERED} onClick={() => void repair()}>修复</button>
                  <button className="text-[12px] text-red-600 px-2 py-2" onClick={() => void remove()}>删除</button>
                </>
              ) : downloading ? (
                <button className={BTN_BORDERED} onClick={() => void cancelDownload()}>取消</button>
              ) : phase === "verifying" ? (
                <span className="text-[12px] text-muted">正在验证…</span>
              ) : (
                <button className={BTN_ACCENT} disabled={!status?.supported} onClick={() => void download()}>下载模型</button>
              )}
            </div>
            {downloading && (
              <div className="border-t border-line px-4 py-3">
                <div className="h-1.5 rounded-full bg-line overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: `${progressPercent}%` }} /></div>
                <div className="mt-1.5 text-[12px] text-muted flex"><span>{formatBytes(progress?.downloaded_bytes || 0)} of {formatBytes(progressTotal)}</span><span className="ml-auto">{progressPercent}%</span></div>
              </div>
            )}
          </div>

          <div className={CARD}>
            <div className="p-4 flex items-center gap-3">
              <Icon name="mic" size={18} className={ready ? "text-green-600" : "text-muted"} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">麦克风测试</div>
                <div className="text-[12px] text-muted mt-0.5">
                  {ready ? "麦克风和本地转写引擎工作正常。" : "录制一小段语音以启用输入框中的麦克风。"}
                </div>
              </div>
              {ready && <span className="text-[12px] px-2 py-1 rounded-full bg-green-50 text-green-700">● 已就绪</span>}
              <button className={BTN_BORDERED} disabled={!status?.supported || !status?.model_verified || phase === "transcribing"} onClick={() => void toggleTest()}>
                {status?.recording ? "停止并检查" : phase === "transcribing" ? "正在转写…" : ready ? "重新测试" : "测试麦克风"}
              </button>
            </div>
            {status?.recording && <div className="border-t border-line px-4 py-3 text-[12px] text-accent" role="status">● 正在聆听，请说一小段话后停止。</div>}
            {testTranscript && <div className="border-t border-line bg-paper/50 px-4 py-3 text-[13px]">“{testTranscript}”</div>}
          </div>

          {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-red-700">{error}</div>}
        </div>
      )}
    </section>
  );
}

// -- Personas: installed/enabled/delete management, the dir/Git importer, and the
// entry point to the Persona Gallery (a screen-sized modal — installs finish back
// here, disabled pending consent; a gallery install re-mounts the list in place).
// The Gallery entry point is GONE (owner 2026-08-21) — coworkers install from
// GitHub / folder / zip only. GalleryModal stays in the tree for the gallery's
// possible return as a first-class distribution surface, but nothing mounts it.
export function PersonasSection({ onOpenPersona, onSummonPersona }: { onOpenPersona?: (id: string) => void; onSummonPersona?: (id: string, prompt?: string) => void }) {
  return (
    <section className="h-full min-h-0 flex flex-col">
      <div className="flex items-center justify-between mb-6 shrink-0">
        <PanelHead title="专家" sub="" />
        <button className="text-[13px] px-3 py-2 rounded-lg border border-line bg-paper hover:border-lineStrong" onClick={() => window.dispatchEvent(new Event("ocw-focus-import"))}>导入专家</button>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        <PersonasTab onOpenPersona={onOpenPersona} onSummonPersona={onSummonPersona} />
      </div>
    </section>
  );
}

// -- Appearance + app behaviour ------------------------------------------------
function AppearanceSection() {
  const [theme, setTheme] = useThemePref();
  const [autostart, setAuto] = useState(false);
  const [keepAwake, setKeep] = useState(false);
  const desktop = isTauri();

  useEffect(() => {
    if (isTauri()) {
      getAutostart().then((v) => setAuto(!!v));
      getKeepAwake().then((v) => setKeep(!!v));
    }
  }, []);

  const toggleAuto = async (v: boolean) => setAuto(!!(await setAutostart(v)));
  const toggleKeep = async (v: boolean) => setKeep(!!(await setKeepAwake(v)));
  const runSetupAgain = async () => {
    await setOnboarded(false);
    window.dispatchEvent(new CustomEvent("coworker:open-onboarding"));
  };

  return (
    <section>
      <PanelHead title="通用" sub="设置绿巨人在本机的外观和运行方式。" />

      <div className={CARD + " p-4 mb-4"}>
        <div className={FIELD_LABEL}>主题</div>
        <div className="seg mt-2.5" role="radiogroup" aria-label="外观">
          {(["light", "dark", "auto"] as const).map((p) => (
            <button key={p} className={p === theme ? "active" : ""} onClick={() => setTheme(p)}>
              {p === "light" ? "浅色" : p === "dark" ? "深色" : "自动"}
            </button>
          ))}
        </div>
        <div className={FIELD_HELP}>自动模式会跟随系统外观。</div>
      </div>

      <SidebarCard />

      <ContextBarCard />

      <AutoApproveCard />

      <FilesCard />

      <TrustedWorkspacesCard />

      {desktop && (
        <div className={CARD + " p-4"}>
          <div className={FIELD_LABEL + " mb-2.5"}>常驻运行</div>
          <label className="flex items-start gap-3 py-2">
            <input type="checkbox" className="mt-0.5" checked={autostart} onChange={(e) => toggleAuto(e.target.checked)} />
            <span>
              <span className="block text-[13px] text-ink">登录时启动</span>
              <span className="block text-[12px] text-muted">登录系统后自动启动绿巨人。</span>
            </span>
          </label>
          <label className="flex items-start gap-3 py-2">
            <input type="checkbox" className="mt-0.5" checked={keepAwake} onChange={(e) => toggleKeep(e.target.checked)} />
            <span>
              <span className="block text-[13px] text-ink">保持系统唤醒</span>
              <span className="block text-[12px] text-muted">防止系统空闲休眠，确保定时任务按时执行。</span>
            </span>
          </label>
        </div>
      )}

      {/* One card for the app-lifecycle actions (UX-021): the onboarding replay (§24 —
          every build, the browser dev shell runs the same first-run flow) and, on
          desktop, the manual update check (launch also checks automatically). */}
      <div className={CARD + " p-4 mt-4"}>
        <div className={FIELD_LABEL + " mb-2"}>设置与更新</div>
        <div className="flex items-center gap-2">
          <button className={BTN_BORDERED} onClick={runSetupAgain}>
            重新运行设置向导
          </button>
          {desktop && <UpdateInline />}
        </div>
        <div className={FIELD_HELP}>重新完成首次运行流程：模型、首个自动任务和使用提示。</div>
      </div>
    </section>
  );
}

function TrustedWorkspacesCard() {
  const [workspaces, setWorkspaces] = useState<WorkspaceCommandTrust[] | null>(null);

  const refresh = () =>
    getTrustedWorkspaces()
      .then(setWorkspaces)
      .catch(() => setWorkspaces([]));

  useEffect(() => {
    refresh();
  }, []);

  const revoke = async (path: string) => {
    if (!window.confirm(`确定撤销对 ${path} 的命令信任吗？`)) return;
    await setWorkspaceTrusted(path, false);
    refresh();
  };

  return (
    <div className={CARD + " p-4 mb-4"} data-testid="trusted-workspaces-card">
      <div className={FIELD_LABEL}>受信任工作区</div>
      <div className={FIELD_HELP}>
        受信任项目可以在 .coworker/config.toml 中管理允许执行的命令。
      </div>
      {workspaces === null ? (
        <div className="text-[12px] text-muted mt-3">正在加载…</div>
      ) : workspaces.length === 0 ? (
        <div className="text-[12px] text-muted mt-3">暂无受信任工作区。</div>
      ) : (
        <div className="mt-3 divide-y divide-line">
          {workspaces.map((workspace) => (
            <div key={workspace.workspace} className="py-2.5 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-ink break-all">{workspace.workspace}</div>
                <div className="text-[12px] text-muted mt-0.5">
                  {workspace.requested_commands.length
                    ? `${workspace.requested_commands.length} 条项目命令权限`
                    : "当前未声明项目命令权限"}
                  {!workspace.exists ? " · 文件夹不可用" : ""}
                </div>
              </div>
              <button
                className="text-[12px] text-red-600 px-2 py-1"
                onClick={() => void revoke(workspace.workspace)}
              >
                撤销
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UpdateInline() {
  const [state, setState] = useState<"idle" | "checking" | "none" | "found" | "installing" | "error">("idle");
  const [version, setVersion] = useState("");

  const check = async () => {
    setState("checking");
    try {
      const u = await checkForUpdate();
      if (u) {
        setVersion(u.version);
        setState("found");
      } else {
        setState("none");
      }
    } catch {
      setState("error");
    }
  };

  const install = async () => {
    setState("installing");
    try {
      await installUpdate(); // success restarts the app
    } catch {
      setState("error");
    }
  };

  return (
    <span className="inline-flex items-center gap-2.5">
      {state === "found" ? (
        <button className={BTN_BORDERED} onClick={install} data-testid="settings-update-install">
          更新至 v{version} 并重启
        </button>
      ) : (
        <button
          className={BTN_BORDERED}
          onClick={check}
          disabled={state === "checking" || state === "installing"}
          data-testid="settings-update-check"
        >
          {state === "checking" ? "正在检查…" : "检查更新"}
        </button>
      )}
      {(state === "none" || state === "error" || state === "installing") && (
        <span className="text-[12px] text-muted">
          {state === "none"
            ? "当前已是最新版本。"
            : state === "error"
              ? "暂时无法检查更新，请稍后重试。"
              : "正在下载，完成后绿巨人将自动重启。"}
        </span>
      )}
    </span>
  );
}

// Telemetry/Privacy card removed for this release (owner ask 2026-07-22); the
// setCloudTelemetry API stays for a future opt-out surface.

// -- Sidebar density -------------------------------------------------------------
// -- Token savings (PDF attachments; owner ask, 2026-07-17) ---------------------
// Attachments replay with EVERY turn, so a big PDF quietly multiplies token spend.
// This card is the attachment dial: attach thresholds + the fallback for models
// without native PDF support. (Long-history spend is handled by auto-compaction —
// the CompactionCard below, OPE-27.)
function TokenSavingsCard() {
  const [pdf, setPdf] = useState<PdfSettings | null>(null);

  useEffect(() => {
    getSettings()
      .then((s) =>
        setPdf({
          pdf_fallback: s.pdf_fallback || "text",
          pdf_max_pages: s.pdf_max_pages || 20,
          pdf_max_mb: s.pdf_max_mb || 10,
        }),
      )
      .catch(() => setPdf({ pdf_fallback: "text", pdf_max_pages: 20, pdf_max_mb: 10 }));
  }, []);

  const save = async (patch: Partial<PdfSettings>) => {
    setPdf((p) => (p ? { ...p, ...patch } : p));
    await setPdfSettings(patch);
  };

  if (!pdf) return null;
  return (
    <div className={CARD + " p-4 mb-4"} data-testid="token-savings-card">
      <div className={FIELD_LABEL}>Token 节省</div>
      <div className={FIELD_HELP}>
        PDF 附件会随每轮对话传递，因此大文档会成倍增加 Token 消耗。
      </div>

      <div className="mt-3 text-[13px] text-ink">不原生支持 PDF 的模型</div>
      <div className="seg mt-2" role="radiogroup" aria-label="PDF 备用处理方式" data-testid="pdf-fallback">
        <button
          className={pdf.pdf_fallback === "text" ? "active" : ""}
          onClick={() => save({ pdf_fallback: "text" })}
        >
          提取文本
        </button>
        <button
          className={pdf.pdf_fallback === "images" ? "active" : ""}
          onClick={() => save({ pdf_fallback: "images" })}
        >
          发送页面图片
        </button>
      </div>
      <div className={FIELD_HELP}>
        Claude、GPT 和 Gemini 可原生读取 PDF；此设置仅适用于 GLM、Kimi、DeepSeek、
        本地模型等不支持的模型。提取文本成本最低；页面图片消耗更多 Token，且要求模型支持视觉能力。
      </div>

      <div className="mt-3 flex items-center gap-5">
        <label className="flex items-center gap-2.5">
          <span className="text-[13px] text-ink">最大页数</span>
          <input
            type="number"
            min={1}
            max={100}
            value={pdf.pdf_max_pages}
            data-testid="pdf-max-pages"
            className="w-16 px-2 py-1.5 rounded-lg border border-line bg-paper text-[13px] text-ink outline-none focus:border-accent"
            onChange={(e) => save({ pdf_max_pages: Math.max(1, Math.min(Number(e.target.value) || 20, 100)) })}
          />
        </label>
        <label className="flex items-center gap-2.5">
          <span className="text-[13px] text-ink">最大大小</span>
          <input
            type="number"
            min={1}
            max={10}
            value={pdf.pdf_max_mb}
            data-testid="pdf-max-mb"
            className="w-16 px-2 py-1.5 rounded-lg border border-line bg-paper text-[13px] text-ink outline-none focus:border-accent"
            onChange={(e) => save({ pdf_max_mb: Math.max(1, Math.min(Number(e.target.value) || 10, 10)) })}
          />
          <span className="text-[13px] text-muted">MB</span>
        </label>
      </div>
      <div className={FIELD_HELP}>
        超过限制的 PDF 不会被添加，输入框上方会显示相应提示。
      </div>
    </div>
  );
}

// -- Context compaction (OPE-27) ------------------------------------------------
// Long sessions are summarized automatically when they approach the model's context
// limit, so work continues instead of hitting a raw provider error. Two spec'd
// overrides (trigger % + token cap) and the summarizer-model pin — nothing more.
function CompactionCard() {
  const [cfg, setCfg] = useState<CompactionSettings | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    getSettings()
      .then((s) => {
        setCfg({
          compaction_threshold_pct: s.compaction_threshold_pct ?? 0.8,
          compaction_cap_tokens: s.compaction_cap_tokens ?? 250_000,
          compaction_model: s.compaction_model ?? "",
        });
        setModels(s.models || []);
        setLabels(s.model_labels || {});
      })
      .catch(() =>
        setCfg({
          compaction_threshold_pct: 0.8,
          compaction_cap_tokens: 250_000,
          compaction_model: "",
        }),
      );
  }, []);

  const save = async (patch: Partial<CompactionSettings>) => {
    setCfg((p) => (p ? { ...p, ...patch } : p));
    await setCompactionSettings(patch);
  };

  if (!cfg) return null;
  const modelLabel = (id: string) => labels[id]?.split(" · ")[0] || id;
  return (
    <div className={CARD + " p-4 mb-4"} data-testid="compaction-card">
      <div className={FIELD_LABEL}>上下文压缩</div>
      <div className={FIELD_HELP}>
        长会话会自动压缩：系统总结较早的对话，避免上下文耗尽并继续工作。
        可见的对话记录不会被修改，压缩位置会有标记。
      </div>

      <div className="mt-3 flex items-center gap-5 flex-wrap">
        <label className="flex items-center gap-2.5">
          <span className="text-[13px] text-ink">压缩阈值</span>
          <input
            type="number"
            min={10}
            max={95}
            value={Math.round(cfg.compaction_threshold_pct * 100)}
            data-testid="compaction-threshold"
            className="w-16 px-2 py-1.5 rounded-lg border border-line bg-paper text-[13px] text-ink outline-none focus:border-accent"
            onChange={(e) =>
              save({
                compaction_threshold_pct:
                  Math.max(10, Math.min(Number(e.target.value) || 80, 95)) / 100,
              })
            }
          />
          <span className="text-[13px] text-muted">% 上下文窗口</span>
        </label>
        <label className="flex items-center gap-2.5">
          <span className="text-[13px] text-ink">或达到</span>
          <input
            type="number"
            min={10_000}
            max={2_000_000}
            step={10_000}
            value={cfg.compaction_cap_tokens}
            data-testid="compaction-cap"
            className="w-28 px-2 py-1.5 rounded-lg border border-line bg-paper text-[13px] text-ink outline-none focus:border-accent"
            onChange={(e) =>
              save({
                compaction_cap_tokens: Math.max(
                  10_000,
                  Math.min(Number(e.target.value) || 250_000, 2_000_000),
                ),
              })
            }
          />
          <span className="text-[13px] text-muted">Token，以较小值为准</span>
        </label>
      </div>
      <div className={FIELD_HELP}>
        上限可让超大上下文模型提前压缩，避免在达到标称限制前出现质量和速度下降。
      </div>

      <div className="mt-3 flex items-center gap-2.5">
        <span className="text-[13px] text-ink">总结模型</span>
        <select
          value={cfg.compaction_model}
          data-testid="compaction-model"
          className="px-2 py-1.5 rounded-lg border border-line bg-paper text-[13px] text-ink outline-none focus:border-accent"
          onChange={(e) => save({ compaction_model: e.target.value })}
        >
          <option value="">使用会话模型（默认）</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {modelLabel(m)}
            </option>
          ))}
        </select>
      </div>
      <div className={FIELD_HELP}>
        该模型负责生成摘要；默认跟随当前会话使用的模型。
      </div>
    </div>
  );
}

// -- Composer: context-window bar (owner ask 2026-07-30) ------------------------
// The chip's bar is context-window occupancy; the session total (unbounded) lives in
// the popover. Some people would rather not watch a meter at all, hence the toggle.
function ContextBarCard() {
  const [shown, setShown] = useState<boolean | null>(null);

  useEffect(() => {
    getSettings()
      .then((s) => setShown(s.context_bar === true))
      .catch(() => setShown(false));
  }, []);

  const save = async (next: boolean) => {
    setShown(next);
    await setContextBar(next);
  };

  if (shown === null) return null;
  return (
    <div className={CARD + " p-4 mb-4"} data-testid="context-bar-card">
      <div className={FIELD_LABEL}>输入框</div>
      <label className="flex items-start gap-3 py-2">
        <input
          type="checkbox"
          className="mt-0.5"
          data-testid="context-bar-toggle"
          checked={shown}
          onChange={(e) => save(e.target.checked)}
        />
        <span>
          <span className="block text-[13px] text-ink">显示上下文窗口进度条</span>
          <span className="block text-[12px] text-muted">
            使用小型进度条显示模型上下文窗口占用情况；关闭后改为显示数字。
          </span>
        </span>
      </label>
    </div>
  );
}

// Auto-Approve (spec §1.5): the experimental feature flag that adds the "Auto-Approve" mode
// to the composer's mode picker, plus its shadow-evaluation sibling. Both default off and are
// user-global (a cloned repo can't turn either on). Shadow is nested under the main flag — it
// only makes sense to measure the reviewer once you know what it is.
function AutoApproveCard() {
  const [on, setOn] = useState<boolean | null>(null);
  const [shadow, setShadow] = useState(false);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setOn(s.auto_approve === true);
        setShadow(s.auto_approve_shadow === true);
      })
      .catch(() => setOn(false));
  }, []);

  const saveOn = async (next: boolean) => {
    setOn(next);
    await setAutoApprove(next);
  };
  const saveShadow = async (next: boolean) => {
    setShadow(next);
    await setAutoApproveShadow(next);
  };

  if (on === null) return null;
  return (
    <div className={CARD + " p-4 mb-4"} data-testid="auto-approve-card">
      <div className={FIELD_LABEL}>替我审批（实验性功能）</div>
      <label className="flex items-start gap-3 py-2">
        <input
          type="checkbox"
          className="mt-0.5"
          data-testid="auto-approve-toggle"
          checked={on}
          onChange={(e) => saveOn(e.target.checked)}
        />
        <span>
          <span className="block text-[13px] text-ink">启用替我审批</span>
          <span className="block text-[12px] text-muted">
            选择“替我审批”时会自动启用。当前模型可放行中低风险操作，高风险或不确定事项交给你确认，
            明确危险或规则禁止的操作会被拒绝。关闭后改由你审批；每次审核会额外调用模型。
          </span>
        </span>
      </label>
      <label className="flex items-start gap-3 py-2 pl-7">
        <input
          type="checkbox"
          className="mt-0.5"
          data-testid="auto-approve-shadow-toggle"
          checked={shadow}
          onChange={(e) => saveShadow(e.target.checked)}
        />
        <span>
          <span className="block text-[13px] text-ink">
            影子评估 <span className="text-faint">（用于评测）</span>
          </span>
          <span className="block text-[12px] text-muted">
            在任意模式下记录审核器原本会作出的决定，并与你的选择对照，但不会改变实际行为。
            可在正式启用前观察效果；每次审批同样会额外调用一次模型。
          </span>
        </span>
      </label>
    </div>
  );
}

function SidebarCard() {
  const [peek, setPeek] = useState<number | null>(null);

  useEffect(() => {
    getSettings()
      .then((s) => setPeek(s.sessions_peek || 5))
      .catch(() => setPeek(5));
  }, []);

  const save = async (n: number) => {
    const clamped = Math.max(1, Math.min(n || 5, 50));
    setPeek(clamped);
    await setSessionsPeek(clamped);
  };

  if (peek === null) return null;
  return (
    <div className={CARD + " p-4 mb-4"}>
      <div className={FIELD_LABEL}>侧边栏</div>
      <label className="flex items-center gap-3 mt-2.5">
        <span className="text-[13px] text-ink">每个专家显示的会话数</span>
        <input
          type="number"
          min={1}
          max={50}
          value={peek}
          className="w-16 px-2 py-1.5 rounded-lg border border-line bg-paper text-[13px] text-ink outline-none focus:border-accent"
          onChange={(e) => save(Number(e.target.value))}
        />
      </label>
      <div className={FIELD_HELP}>
        超出部分会收起到“显示更多”中，此设置分别应用于每个专家和项目。
      </div>
    </div>
  );
}

// -- Files (scratch location) — one card inside General (UX-021: a single option
// doesn't earn its own tab) -----------------------------------------------------
function FilesCard() {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [scratchDraft, setScratchDraft] = useState("");
  const [scratchMsg, setScratchMsg] = useState<string | null>(null);
  const desktop = isTauri();

  const refresh = () =>
    getSettings()
      .then((s) => {
        setSettings(s);
        setScratchDraft((d) => d || s.scratch_base || "");
      })
      .catch(() => setSettings(null));
  useEffect(() => {
    refresh();
  }, []);

  const saveScratch = async () => {
    setScratchMsg(null);
    const res = await setScratchBase(scratchDraft.trim());
    if (res.ok) {
      setScratchMsg("已保存，新会话将使用此位置。");
      refresh();
    } else {
      setScratchMsg(res.error || "无法使用该位置。");
    }
  };
  const browseScratch = async () => {
    const picked = await pickFolder();
    if (picked) setScratchDraft(picked);
  };

  if (!settings) return null;

  return (
    <div className={CARD + " p-4 mb-4"}>
      <div className={FIELD_LABEL}>文件</div>
        <div className="flex items-center gap-2 mt-2.5">
          <input
            className={INPUT}
            type="text"
            placeholder="~/OpenWorker"
            value={scratchDraft}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setScratchDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveScratch()}
          />
          {desktop && (
            <button className={BTN_BORDERED} onClick={browseScratch} title="选择文件夹">
              浏览
            </button>
          )}
          <button className={BTN_ACCENT} onClick={saveScratch} disabled={!scratchDraft.trim()}>
            保存
          </button>
        </div>
      <div className={FIELD_HELP}>
        每个会话会在此位置下创建独立文件夹。现有会话继续使用原位置；也可在会话中授权访问更多文件夹。
      </div>
      {scratchMsg && <div className="text-[13px] text-muted mt-2.5">{scratchMsg}</div>}
    </div>
  );
}
