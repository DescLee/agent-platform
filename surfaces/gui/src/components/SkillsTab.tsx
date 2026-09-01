import { useRef, useState, type ReactNode } from "react";
import { useEffect } from "react";
import {
  createSkill,
  deleteSkill,
  listSkills,
  listSkillHubCategories,
  listSkillHubSkills,
  getSkillHubSkill,
  getSkillHubSkillOverview,
  getSkillHubSkillEvaluation,
  installSkillHubSkill,
  revealSkill,
  stageSkillUpload,
  confirmSkillUpload,
  updateSkill,
  type SkillRow,
  type SkillHubCategory,
  type SkillHubSkill,
  type SkillHubSkillDetail,
  type SkillUploadPreview,
} from "../api";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";

// Settings ▸ Skills (SKILLS-SPEC §5/§6) — the management home: the LIST is the page; every
// add-surface appears only when summoned from the single "Add skill" menu (the three doors:
// write form / import / start-a-conversation). Everything a user creates here is GLOBAL —
// "skills are things your worker knows everywhere". Creation-by-AI is a CONVERSATION (the
// menu's third door starts one; the worker proposes via save_skill) — there is no
// in-Settings drafting and no description box: the composer is where you describe it.
// Persona-bundled skills arrive with personas (§10), managed on the persona page, not here.

const CARD = "rounded-xl2 border border-line bg-panel";
const FIELD_LABEL = "text-[13px] font-medium text-ink";
const INPUT =
  "w-full min-w-0 px-3 py-2 rounded-lg border border-line bg-paper text-[13px] text-ink outline-none focus:border-accent";
const BTN_ACCENT =
  "text-[13px] px-3 py-2 rounded-lg bg-accent text-white shrink-0 disabled:opacity-40";
const BTN_BORDERED =
  "text-[13px] px-3 py-2 rounded-lg border border-line bg-paper hover:border-lineStrong shrink-0";
const BADGE =
  "text-[11px] px-2 py-0.5 rounded-full border border-line bg-paper text-muted shrink-0";

function skillCardName(row: Pick<SkillRow, "name" | "description">): string {
  const fromDescription = row.description.match(/^(.+?\.Skill)\b/i)?.[1]?.trim();
  return fromDescription || row.name;
}

function skillCardTags(row: Pick<SkillRow, "name" | "description" | "source">): string[] {
  const text = `${row.name} ${row.description}`;
  if (/编程|代码|开发|bug|api/i.test(text)) return ["开发编程"];
  if (/文档|写作|内容/i.test(text)) return ["内容创作"];
  if (/办公|周报|表格/i.test(text)) return ["办公效率"];
  return row.source === "uploaded" ? ["自定义技能"] : ["通用技能"];
}

type Editor = {
  mode: "new" | "edit";
  name: string;
  description: string;
  instructions: string;
};

const emptyEditor = (): Editor => ({
  mode: "new",
  name: "",
  description: "",
  instructions: "",
});

async function fileToB64(file: File): Promise<string> {
  // FileReader fallback: File.arrayBuffer is missing in some webviews (and jsdom).
  const buf =
    typeof file.arrayBuffer === "function"
      ? await file.arrayBuffer()
      : await new Promise<ArrayBuffer>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as ArrayBuffer);
          r.onerror = () => reject(r.error);
          r.readAsArrayBuffer(file);
        });
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function SkillsTab({
  onCreateSkill,
  onUseSkill,
  onDetailChange,
  embedded = false,
}: {
  // The doorway (SKILLS-SPEC §5.2): starts a new conversation with the description
  // prefilled in the composer — the worker builds the skill and proposes it via save_skill.
  onCreateSkill?: (description: string) => void;
  onUseSkill?: (name: string, label: string) => void;
  onDetailChange?: (open: boolean) => void;
  embedded?: boolean;
}) {
  const [rows, setRows] = useState<SkillRow[]>([]);
  const [showMine, setShowMine] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [upload, setUpload] = useState<SkillUploadPreview | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const [error, setError] = useState("");
  // The state-change callout (SKILLS-SPEC §4.1 #2): name-first so the user knows WHICH
  // skill, and visually distinct so it can't be skimmed past (tester ask 2026-07-27).
  const [notice, setNotice] = useState<{ name: string; text: string; tone: "ok" | "warn" } | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement>(null);

  // Confirmation copy (SKILLS-SPEC §4.1 #2): name-first, outcome + remedy only, in words a
  // person already owns — now / everywhere / off / start a new one. Never mechanism ("the
  // model will be told…") or engineering timing ("from the next message") — owner-driver
  // review rounds, 2026-07-27. The engine countermands disabled-but-loaded skills silently;
  // the copy promises only the guaranteed part.
  const CONFIRMATION = "— 协作助手现在可在所有会话中使用此技能。";
  const OFF_NOTE =
    "已在所有位置关闭。如果已有会话使用过此技能，请新建会话以获得完全干净的上下文。";
  const DELETE_NOTE =
    "已移除。如果已有会话使用过此技能，请新建会话以获得完全干净的上下文。";

  const refresh = () => listSkills().then(setRows);
  const useSkill = async (name: string, label: string) => {
    const installed = rows.find((row) => row.name === name);
    if (installed && !installed.enabled) {
      const result = await updateSkill(name, { enabled: true });
      if (!result.ok) return;
      await refresh();
    }
    onUseSkill?.(name, label);
  };
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    const openAddMenu = () => {
      setShowMine(true);
      setAddOpen(true);
    };
    window.addEventListener("ocw-add-skill", openAddMenu);
    return () => window.removeEventListener("ocw-add-skill", openAddMenu);
  }, []);

  const fail = (res: { ok?: boolean; error?: string }) => {
    setNotice(null);
    if (res.ok === false) {
      setError(res.error || "发生错误。请稍后重试。");
      return true;
    }
    setError("");
    return false;
  };

  const save = async () => {
    if (!editor) return;
    const res =
      editor.mode === "new"
        ? await createSkill({
            name: editor.name.trim(),
            description: editor.description.trim(),
            instructions: editor.instructions,
          })
        : await updateSkill(editor.name, {
            description: editor.description.trim(),
            instructions: editor.instructions,
          });
    if (fail(res)) return;
    setEditor(null);
    if (editor.mode === "new")
      setNotice({ name: editor.name.trim(), text: CONFIRMATION, tone: "ok" });
    refresh();
  };

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    const res = await stageSkillUpload(await fileToB64(file), file.name);
    if (fail(res)) return;
    setUpload(res);
  };

  const confirmUpload = async () => {
    if (!upload?.token) return;
    const res = await confirmSkillUpload(upload.token);
    if (fail(res)) return;
    setUpload(null);
    setNotice({ name: upload.name || "Skill", text: CONFIRMATION, tone: "ok" });
    refresh();
  };

  const remove = async (row: SkillRow) => {
    if (armedDelete !== row.name) {
      setArmedDelete(row.name);
      return;
    }
    setArmedDelete(null);
    const res = await deleteSkill(row.name);
    if (fail(res)) return;
    setNotice({ name: row.name, text: DELETE_NOTE, tone: "warn" });
    refresh();
  };

  return (
    <section className="h-full min-h-0 flex flex-col">
      {!embedded && <h2 className="text-[16px] font-semibold mb-4">技能</h2>}
      {showMine && <div className={embedded ? "relative h-0" : "flex justify-end mb-3"}>
        {/* One add-action, three doors behind it (SKILLS-SPEC §5): the list is the page. */}
        <div className="relative shrink-0">
          {!embedded && (
            <button
              className={BTN_ACCENT}
              aria-haspopup="menu"
              aria-expanded={addOpen}
              onClick={() => setAddOpen((v) => !v)}
            >
              <span className="inline-flex items-center gap-1.5">
                <Icon name="plus" size={13} /> 添加技能
              </span>
            </button>
          )}
          {addOpen ? (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setAddOpen(false)} />
              <div
                role="menu"
                className={`absolute right-0 w-80 rounded-xl2 border border-line bg-panel shadow-xl z-20 p-1.5 ${embedded ? "top-0" : "top-full mt-1.5"}`}
                onKeyDown={(e) => e.key === "Escape" && setAddOpen(false)}
              >
                <button
                  role="menuitem"
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-paper"
                  onClick={() => {
                    setAddOpen(false);
                    setEditor(emptyEditor());
                  }}
                >
                  <div className="text-[13px] font-medium">自行编写</div>
                  <div className="text-[12px] text-muted">
                    填写名称、描述和具体指令
                  </div>
                </button>
                <button
                  role="menuitem"
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-paper"
                  onClick={() => {
                    setAddOpen(false);
                    fileInput.current?.click();
                  }}
                >
                  <div className="text-[13px] font-medium">导入文件</div>
                  <div className="text-[12px] text-muted">
                    导入他人分享的 .zip 或 SKILL.md，安装前可先审核
                  </div>
                </button>
                <button
                  role="menuitem"
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-paper disabled:opacity-40"
                  disabled={!onCreateSkill}
                  onClick={() => {
                    setAddOpen(false);
                    onCreateSkill?.("");
                  }}
                >
                  <div className="text-[13px] font-medium">使用绿巨人创建</div>
                  <div className="text-[12px] text-muted">
                    发起会话，由绿巨人创建技能，并在加入技能库前征求你的同意
                  </div>
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>}
      <input
        ref={fileInput}
        type="file"
        accept=".zip,.md"
        className="hidden"
        aria-label="上传技能包"
        onChange={(e) => {
          onPickFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <SkillHubCatalog
        showMine={showMine}
        onShowMine={setShowMine}
        onDetailChange={onDetailChange}
        installedSkills={new Set(rows.map((row) => row.name))}
        onInstalled={refresh}
        onUseSkill={(name, label) => void useSkill(name, label)}
      >

      {error ? (
        <div className="text-[13px] text-red-500 mb-3" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div
          role="status"
          className={
            "mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px] " +
            (notice.tone === "ok"
              ? "bg-tealSoft/70 text-tealInk border-tealInk/20"
              : "bg-warnSoft/70 text-warnInk border-warnInk/20")
          }
        >
          <span className="min-w-0">
            <b>{notice.name}</b> {notice.text}
          </span>
          <button
            className="ml-auto shrink-0 opacity-60 hover:opacity-100"
            aria-label="关闭"
            onClick={() => setNotice(null)}
          >
            ✕
          </button>
        </div>
      ) : null}

      {upload ? (
        <div className={`${CARD} p-4 mb-4`}>
          <div className="text-[13px] font-medium mb-1">安装前审核</div>
          <p className="text-[13px] text-muted mb-3">
            请阅读技能指令；安装后协作助手会按这些指令工作。
          </p>
          <div className="text-[13px] mb-1">
            <span className="font-medium">{upload.name}</span>
            <span className="text-muted"> — {upload.description || "暂无描述"}</span>
          </div>
          <pre className="text-[12px] bg-paper border border-line rounded-lg p-3 whitespace-pre-wrap max-h-64 overflow-y-auto mb-2">
            {upload.instructions}
          </pre>
          {upload.files?.length ? (
            <div className="text-[12px] text-muted mb-2">
              附带文件：{upload.files.join(", ")}
            </div>
          ) : null}
          <div className="flex gap-2 mt-3">
            <button className={BTN_ACCENT} onClick={confirmUpload}>
              安装技能
            </button>
            <button className={BTN_BORDERED} onClick={() => setUpload(null)}>
              取消
            </button>
          </div>
        </div>
      ) : null}

      {editor ? (
        <div className={`${CARD} p-4 mb-4`}>
          <div className="text-[13px] font-medium mb-3">
            {editor.mode === "new" ? "新建技能" : `编辑 ${editor.name}`}
          </div>
          <label className={FIELD_LABEL} htmlFor="skill-name">
            名称
          </label>
          <input
            id="skill-name"
            className={`${INPUT} mt-1 mb-3`}
            value={editor.name}
            disabled={editor.mode === "edit"}
            placeholder="weekly-report"
            onChange={(e) => setEditor({ ...editor, name: e.target.value })}
          />
          <label className={FIELD_LABEL} htmlFor="skill-desc">
            描述
          </label>
          <input
            id="skill-desc"
            className={`${INPUT} mt-1 mb-3`}
            value={editor.description}
            placeholder="用一句话说明该技能适用于什么场景"
            onChange={(e) => setEditor({ ...editor, description: e.target.value })}
          />
          <label className={FIELD_LABEL} htmlFor="skill-instructions">
            指令
          </label>
          <textarea
            id="skill-instructions"
            className={`${INPUT} mt-1 mb-3 min-h-[140px] font-mono`}
            value={editor.instructions}
            placeholder={"1. 汇总上周更新\n2. 编写不超过 300 字的报告"}
            onChange={(e) => setEditor({ ...editor, instructions: e.target.value })}
          />
          <div className="flex gap-2 mt-3">
            <button
              className={BTN_ACCENT}
              disabled={!editor.name.trim() || !editor.instructions.trim()}
              onClick={save}
            >
              保存技能
            </button>
            <button className={BTN_BORDERED} onClick={() => setEditor(null)}>
              取消
            </button>
          </div>
        </div>
      ) : null}

      <div>
        {rows.length === 0 && !editor ? (
          <div className={`${CARD} p-5 text-[13px] text-muted`}>
            暂无技能。点击<b>添加技能</b>，教会协作助手第一项能力，例如“准备周一工作周报”。
          </div>
        ) : null}
        {rows.length > 0 && <div className="expert-grid">
          {rows.map((row) => (
            <article key={row.name} className={`${CARD} expert-card group ${row.enabled ? "" : "opacity-60"}`}>
              <div className="flex items-start gap-3.5">
                <div className="w-20 h-20 rounded-2xl bg-accentSoft text-accent flex items-center justify-center shrink-0 text-2xl font-semibold overflow-hidden">
                  {skillCardName(row).slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[20px] font-semibold truncate" title={skillCardName(row)}>{skillCardName(row)}</h3>
                  <p className="text-[16px] text-muted truncate">{row.source === "uploaded" ? "uploaded" : "user_" + row.name.slice(0, 8)}</p>
                </div>
                <div className="expert-card-actions shrink-0">
                  <button
                    className="w-7 h-7 grid place-items-center rounded-md border border-line bg-paper hover:border-lineStrong"
                    title="编辑"
                    onClick={() => setEditor({ mode: "edit", name: row.name, description: row.description, instructions: row.instructions })}
                  >
                    <Icon name="pencil" size={13} />
                  </button>
                  <button
                    className={`${armedDelete === row.name ? "h-7 px-2" : "w-7 h-7"} grid place-items-center rounded-md border border-line bg-paper hover:border-lineStrong`}
                    aria-label={`删除 ${row.name}`}
                    onClick={() => remove(row)}
                    onBlur={() => setArmedDelete(null)}
                  >
                    {armedDelete === row.name ? <span className="text-[10px] whitespace-nowrap">确认删除</span> : <Icon name="trash" size={13} />}
                  </button>
                </div>
              </div>
              <p className="text-[16px] text-muted leading-[27px] line-clamp-3 break-words mt-5 mb-4" title={row.description}>
                {row.description || "暂无介绍"}
              </p>
              <div className="mt-auto flex items-center gap-2 text-[13px] text-muted">
                {skillCardTags(row).map((tag) => <span key={tag} className="rounded-lg bg-paper px-3 py-1.5">{tag}</span>)}
                {row.files ? (
                  <button className="hidden inline-flex items-center gap-1 rounded-md bg-paper px-2 py-1 hover:text-ink" title="显示文件夹" onClick={() => revealSkill(row.name)}>
                    <Icon name="folder" size={11} /> {row.files} 个文件
                  </button>
                ) : null}
                <label className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-muted">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={`${row.name} enabled`}
                    checked={row.enabled}
                    onChange={(e) => {
                      const on = e.target.checked;
                      updateSkill(row.name, { enabled: on }).then((res) => {
                        if (!fail(res)) setNotice({
                          name: row.name,
                          text: on ? CONFIRMATION : OFF_NOTE,
                          tone: on ? "ok" : "warn",
                        });
                        refresh();
                      });
                    }}
                  />
                  启用
                </label>
              </div>
            </article>
          ))}
        </div>}
      </div>

      </SkillHubCatalog>
    </section>
  );
}

type TraceRow = { key: string; letter: string; name: string; score: number; reason: string };

const TRACE_META = [
  { key: "trust", letter: "T", name: "可信任度", icon: "shield" as const, color: "#20b981", soft: "#eafaf5" },
  { key: "reliability", letter: "R", name: "可靠性", icon: "refresh" as const, color: "#3b82f6", soft: "#eef5ff" },
  { key: "adaptability", letter: "A", name: "适用性", icon: "sparkle" as const, color: "#f59e0b", soft: "#fff7e9" },
  { key: "convention", letter: "C", name: "规范性", icon: "book" as const, color: "#8b5cf6", soft: "#f4efff" },
  { key: "effectiveness", letter: "E", name: "有效性", icon: "code" as const, color: "#ef4444", soft: "#fff0f0" },
];

function radarPoint(index: number, radius: number): [number, number] {
  const angle = -Math.PI / 2 + index * Math.PI * 2 / 5;
  return [120 + Math.cos(angle) * radius, 105 + Math.sin(angle) * radius];
}

function RadarChart({ rows }: { rows: TraceRow[] }) {
  const scoreByKey = new Map(rows.map((row) => [row.key, row.score]));
  const polygon = (radius: number) => TRACE_META.map((_, index) => radarPoint(index, radius).join(",")).join(" ");
  const scorePolygon = TRACE_META.map((item, index) => radarPoint(index, 72 * Math.max(0, Math.min(5, scoreByKey.get(item.key) || 0)) / 5).join(",")).join(" ");
  return (
    <svg viewBox="0 0 240 220" className="w-full max-w-[280px]" role="img" aria-label="TRACE 五维评分雷达图">
      {[18, 36, 54, 72].map((radius) => <polygon key={radius} points={polygon(radius)} fill="none" stroke="var(--line)" strokeWidth="1" />)}
      {TRACE_META.map((_, index) => { const [x, y] = radarPoint(index, 72); return <line key={index} x1="120" y1="105" x2={x} y2={y} stroke="var(--line)" strokeWidth="1" />; })}
      <polygon points={scorePolygon} fill="rgba(76, 91, 255, 0.16)" stroke="#5965ff" strokeWidth="2" />
      {TRACE_META.map((item, index) => {
        const [x, y] = radarPoint(index, 94);
        return <text key={item.key} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill="var(--muted)" fontSize="11">{item.letter} {item.name}</text>;
      })}
    </svg>
  );
}

function SkillHubCatalog({
  showMine,
  onShowMine,
  onDetailChange,
  installedSkills,
  onInstalled,
  onUseSkill,
  children,
}: {
  showMine: boolean;
  onShowMine: (show: boolean) => void;
  onDetailChange?: (open: boolean) => void;
  installedSkills: Set<string>;
  onInstalled: () => void;
  onUseSkill: (name: string, label: string) => void;
  children: ReactNode;
}) {
  const [categories, setCategories] = useState<SkillHubCategory[]>([]);
  const [category, setCategory] = useState("all");
  const [skills, setSkills] = useState<SkillHubSkill[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<SkillHubSkillDetail | null>(null);
  const [detailTab, setDetailTab] = useState<"overview" | "evaluation">("overview");
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewLoaded, setOverviewLoaded] = useState(false);
  const [overviewError, setOverviewError] = useState("");
  const [evaluationLoading, setEvaluationLoading] = useState(false);
  const [evaluationLoaded, setEvaluationLoaded] = useState(false);
  const [evaluationError, setEvaluationError] = useState("");
  const [installedNames, setInstalledNames] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState("");
  const detailRequestRef = useRef(0);

  useEffect(() => () => onDetailChange?.(false), [onDetailChange]);

  useEffect(() => {
    listSkillHubCategories()
      .then((result) => {
        if (result.ok) setCategories(result.categories || []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (showMine) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    listSkillHubSkills({ page, pageSize: 24, category: category === "all" ? "" : category })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setSkills([]);
          setTotal(0);
          setError(result.error || "SkillHub 技能暂时无法加载");
          return;
        }
        const incoming = result.skills || [];
        setSkills((current) => {
          if (page === 1) return incoming;
          const seen = new Set(current.map((skill) => `${skill.publisher}/${skill.slug}`));
          return [...current, ...incoming.filter((skill) => !seen.has(`${skill.publisher}/${skill.slug}`))];
        });
        setTotal(result.total || 0);
      })
      .catch(() => {
        if (!cancelled) setError("SkillHub 技能暂时无法加载");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [category, page, showMine]);

  const selectCategory = (next: string) => {
    detailRequestRef.current += 1;
    setSelectedSkill(null);
    onDetailChange?.(false);
    onShowMine(false);
    setSkills([]);
    setTotal(0);
    setCategory(next);
    setPage(1);
  };
  const categoryNames = new Map(categories.map((item) => [item.key, item.name]));
  const totalPages = Math.max(1, Math.ceil(total / 24));
  const loadNextPage = (element: HTMLDivElement) => {
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distanceToBottom < 160 && !loading && page < totalPages) {
      setPage((current) => current + 1);
    }
  };

  const loadOverview = (skill: SkillHubSkillDetail, force = false) => {
    if (!force && (overviewLoading || overviewLoaded)) return;
    setOverviewLoading(true);
    setOverviewError("");
    const requestId = detailRequestRef.current;
    getSkillHubSkillOverview(skill.slug, skill.namespace)
      .then((result) => {
        if (requestId !== detailRequestRef.current) return;
        if (result.ok) setSelectedSkill((current) => current && current.slug === skill.slug && current.namespace === skill.namespace ? { ...current, overview: result.overview || "" } : current);
        else setOverviewError(result.error || "技能概述暂时无法加载");
      })
      .catch(() => { if (requestId === detailRequestRef.current) setOverviewError("技能概述暂时无法加载"); })
      .finally(() => { if (requestId === detailRequestRef.current) { setOverviewLoading(false); setOverviewLoaded(true); } });
  };

  const loadEvaluation = (skill: SkillHubSkillDetail) => {
    if (evaluationLoading || evaluationLoaded) return;
    setEvaluationLoading(true);
    setEvaluationError("");
    const requestId = detailRequestRef.current;
    getSkillHubSkillEvaluation(skill.slug, skill.namespace)
      .then((result) => {
        if (requestId !== detailRequestRef.current) return;
        if (result.ok) setSelectedSkill((current) => current && current.slug === skill.slug && current.namespace === skill.namespace ? { ...current, evaluation: result.evaluation || null } : current);
        else setEvaluationError(result.error || "技能评测暂时无法加载");
      })
      .catch(() => { if (requestId === detailRequestRef.current) setEvaluationError("技能评测暂时无法加载"); })
      .finally(() => { if (requestId === detailRequestRef.current) { setEvaluationLoading(false); setEvaluationLoaded(true); } });
  };

  const openSkill = (skill: SkillHubSkill) => {
    detailRequestRef.current += 1;
    const requestId = detailRequestRef.current;
    setSelectedSkill(skill);
    setDetailTab("overview");
    setOverviewLoaded(false);
    setEvaluationLoaded(false);
    setEvaluationError("");
    setInstalling(false);
    setInstallError("");
    onDetailChange?.(true);
    loadOverview(skill, true);
    getSkillHubSkill(skill.slug, skill.namespace)
      .then((result) => {
        if (requestId !== detailRequestRef.current) return;
        if (result.ok && result.skill) setSelectedSkill((current) => current && current.slug === skill.slug && current.namespace === skill.namespace ? { ...current, ...result.skill, name: current.name } : current);
        else setOverviewError(result.error || "技能详情暂时无法加载");
      })
      .catch(() => { if (requestId === detailRequestRef.current) setOverviewError("技能详情暂时无法加载"); });
  };

  if (selectedSkill) {
    const coordinate = `${selectedSkill.namespace}/${selectedSkill.slug}`;
    const installedName = installedNames[coordinate] || (installedSkills.has(selectedSkill.slug) ? selectedSkill.slug : "");
    const tags = selectedSkill.tags?.filter(Boolean) || [];
    const rating = Number(selectedSkill.rating || 0);
    const evaluation = selectedSkill.evaluation;
    const dimensions = evaluation?.dimensions || {};
    const dimensionRows: TraceRow[] = TRACE_META.flatMap((meta) => {
      const value = dimensions[meta.key];
      if (!value) return [];
      const scores = Object.values(value.items || {}).map((item) => Number(item.score)).filter(Number.isFinite);
      return [{ key: meta.key, letter: meta.letter, name: meta.name, score: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0, reason: value.userReason || value.reason || "" }];
    });
    const traceRating = dimensionRows.length ? dimensionRows.reduce((sum, item) => sum + item.score, 0) / dimensionRows.length : rating;
    return (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden" data-testid="skill-detail-page">
        <button
          type="button"
          className="mb-4 self-start inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink shrink-0"
          onClick={() => { detailRequestRef.current += 1; setSelectedSkill(null); onDetailChange?.(false); }}
        >
          <span aria-hidden>←</span> 返回技能列表
        </button>
        <div className="flex-1 min-h-0 overflow-y-auto pr-1" data-testid="skill-detail-scroll-region">
        <article className={`${CARD} w-full p-6`}>
          <div className="flex items-start gap-4 border-b border-line pb-5">
            <div className="w-14 h-14 rounded-xl bg-accentSoft text-accent flex items-center justify-center shrink-0 overflow-hidden text-xl font-semibold">
              {selectedSkill.icon_url ? <img src={selectedSkill.icon_url} alt="" className="w-full h-full object-cover" /> : selectedSkill.name.slice(0, 1)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold text-ink">{selectedSkill.name}</h2>
                {selectedSkill.verified && <span role="img" aria-label="已认证" title="已认证">🛡️</span>}
              </div>
              <p className="mt-1 text-[13px] leading-5 text-muted">{selectedSkill.description || "暂无描述"}</p>
              {tags.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5" aria-label="标签">{tags.map((tag) => <span key={tag} className={BADGE}>{tag}</span>)}</div>}
            </div>
            <div className="shrink-0 text-right">
              {installedName ? (
                <button className={BTN_ACCENT} onClick={() => onUseSkill(installedName, selectedSkill.name)}>使用</button>
              ) : (
                <button
                  className={BTN_ACCENT}
                  disabled={installing}
                  onClick={() => {
                    setInstalling(true);
                    setInstallError("");
                    installSkillHubSkill(selectedSkill.slug, selectedSkill.namespace, selectedSkill.version)
                      .then((result) => {
                        if (!result.ok || !result.name) return setInstallError(result.error || "技能安装失败");
                        setInstalledNames((current) => ({ ...current, [coordinate]: result.name! }));
                        onInstalled();
                      })
                      .catch(() => setInstallError("技能安装失败"))
                      .finally(() => setInstalling(false));
                  }}
                >
                  {installing ? "安装中…" : "安装"}
                </button>
              )}
              {installError && <p className="mt-2 max-w-48 text-[12px] text-danger">{installError}</p>}
            </div>
          </div>
          <div className="flex items-center gap-6 border-b border-line mt-5" role="tablist" aria-label="技能详情">
            <button role="tab" aria-selected={detailTab === "overview"} className={`px-1 pb-3 text-[14px] font-medium border-b-2 ${detailTab === "overview" ? "text-ink border-accent" : "text-muted border-transparent hover:text-ink"}`} onClick={() => { setDetailTab("overview"); loadOverview(selectedSkill); }}>概述</button>
            <button role="tab" aria-selected={detailTab === "evaluation"} className={`px-1 pb-3 text-[14px] font-medium border-b-2 ${detailTab === "evaluation" ? "text-ink border-accent" : "text-muted border-transparent hover:text-ink"}`} onClick={() => { setDetailTab("evaluation"); loadEvaluation(selectedSkill); }}>评分</button>
          </div>
          {detailTab === "overview" ? (
            <section className="py-5 min-h-[420px]" data-testid="skill-overview-panel">
              {overviewLoading ? <p className="text-[13px] text-muted">正在加载概述…</p> : overviewError ? <p className="text-[13px] text-muted">{overviewError}</p> : <div className="text-[13px] text-muted leading-6"><Markdown text={selectedSkill.overview || selectedSkill.description || "暂无概述"} /></div>}
            </section>
          ) : (
            <section className="py-5 min-h-[420px]" data-testid="skill-evaluation-panel">
              {evaluationLoading ? <p className="text-[13px] text-muted">正在加载评分…</p> : evaluationError ? <p className="text-[13px] text-muted">{evaluationError}</p> : evaluation && dimensionRows.length ? <>
              <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] items-center gap-6 rounded-xl border border-line bg-paper p-4" data-testid="trace-score-summary">
                <RadarChart rows={dimensionRows} />
                <div>
                  <div className="flex items-baseline gap-2"><span className="text-4xl font-semibold text-ink">{traceRating.toFixed(1)}</span><span className="text-[15px] text-muted">/ 5</span></div>
                  <div className="mt-3 inline-flex rounded-full bg-accentSoft px-2.5 py-1 text-[12px] text-accent">综合评级：{traceRating >= 4.5 ? "优秀" : traceRating >= 4 ? "良好" : "合格"}</div>
                  <p className="mt-3 text-[13px] text-muted leading-6">{evaluation.userSummary || evaluation.summary}</p>
                </div>
              </div>
              <h3 className="text-[14px] font-semibold mt-6 mb-3">评价详情</h3>
              <div className="rounded-xl border border-line bg-paper px-4 divide-y divide-line" data-testid="trace-dimension-details">{dimensionRows.map((item) => { const meta = TRACE_META.find((entry) => entry.key === item.key)!; return <div key={item.key} className="py-4"><div className="flex items-center gap-2.5"><span className="w-8 h-8 rounded-full grid place-items-center" style={{ color: meta.color, backgroundColor: meta.soft }}><Icon name={meta.icon} size={16} /></span><span className="text-[13px] font-semibold">{item.letter} · {item.name}</span></div><div className="mt-3 flex items-center gap-3"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-chromeHover"><div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(0, Math.min(100, item.score / 5 * 100))}%`, backgroundColor: meta.color }} /></div><span className="w-12 text-right text-[12px] font-medium text-muted">{item.score.toFixed(1)} /5</span></div><p className="mt-2 text-[12px] text-muted leading-5">{item.reason}</p></div>; })}</div>
            </> : <div className="text-2xl font-semibold text-ink">暂无</div>}
            </section>
          )}
        </article>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="skillhub-catalog">
      <div className="category-tabs-scroll flex items-center gap-1.5 overflow-x-auto mb-3 shrink-0" data-testid="skillhub-categories">
        <button
          className={`shrink-0 rounded-lg px-3 py-1.5 text-[13px] ${!showMine && category === "all" ? "bg-chromeHover text-ink font-medium" : "text-muted hover:bg-chromeHover hover:text-ink"}`}
          onClick={() => selectCategory("all")}
        >
          全部
        </button>
        <button
          className={`shrink-0 rounded-lg px-3 py-1.5 text-[13px] ${showMine ? "bg-chromeHover text-ink font-medium" : "text-muted hover:bg-chromeHover hover:text-ink"}`}
          onClick={() => onShowMine(true)}
        >
          我的
        </button>
        {categories.map((item) => (
          <button
            key={item.key}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-[13px] ${!showMine && category === item.key ? "bg-chromeHover text-ink font-medium" : "text-muted hover:bg-chromeHover hover:text-ink"}`}
            onClick={() => selectCategory(item.key)}
          >
            {item.name}
          </button>
        ))}
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
        data-testid="skills-scroll-region"
        onScroll={(event) => loadNextPage(event.currentTarget)}
      >
        {showMine ? children : loading && skills.length === 0 ? (
          <div className="py-16 text-center text-[13px] text-muted">正在加载技能</div>
        ) : error ? (
          <div className="py-16 text-center text-[13px] text-muted">{error}</div>
        ) : skills.length === 0 ? (
          <div className="py-16 text-center text-[13px] text-muted">该分类暂无技能</div>
        ) : (
          <>
          <div className="expert-grid">
            {skills.map((skill) => (
              <article
                key={`${skill.publisher}/${skill.slug}`}
                className={`${CARD} expert-card cursor-pointer group`}
                role="button"
                tabIndex={0}
                onClick={() => openSkill(skill)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openSkill(skill);
                  }
                }}
                title="查看技能详情"
              >
                <div className="flex items-start gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-accentSoft text-accent flex items-center justify-center shrink-0 overflow-hidden font-semibold">
                    {skill.icon_url ? <img src={skill.icon_url} alt="" className="w-full h-full object-cover" /> : skill.name.slice(0, 1)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-[15px] font-semibold truncate">{skill.name}</h3>
                      {skill.verified && <span className="text-[13px] shrink-0" role="img" aria-label="已认证" title="已认证">🛡️</span>}
                    </div>
                    <p className="text-[12px] text-muted truncate">{skill.publisher || "SkillHub"}</p>
                  </div>
                </div>
                <p className="text-[13px] text-muted leading-[21px] line-clamp-3 break-words mt-2 mb-3" title={skill.description}>
                  {skill.description || "暂无介绍"}
                </p>
                <div className="mt-auto flex items-center gap-2 text-[11px] text-muted">
                  {skill.category && <span className="rounded-md bg-paper px-2 py-1">{categoryNames.get(skill.category) || skill.category}</span>}
                </div>
              </article>
            ))}
          </div>
            {loading && <div className="py-5 text-center text-[13px] text-muted">正在加载更多技能…</div>}
          </>
        )}
      </div>
    </div>
  );
}
