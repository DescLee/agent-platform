import { useEffect, useState } from "react";
import {
  getKnowledgeFiles,
  readArtifact,
  readKnowledgeAttachment,
  revealArtifact,
  type ArtifactContent,
  type KnowledgeFile,
} from "../api";
import { Icon, type IconName } from "./Icon";
import { PanelHead } from "./IntegrationsView";
import { Markdown } from "./Markdown";

interface Props {
  onOpenSession: (id: string, workspace: string, agent: string) => void;
}

const kindIcon = (kind: string): IconName => {
  if (kind === "image") return "image";
  if (kind === "sheet" || kind === "csv") return "table";
  if (kind === "html" || kind === "code") return "fileCode";
  return "file";
};

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const formatTime = (seconds: number) =>
  seconds ? new Date(seconds * 1000).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "历史文件";

const kindLabel = (kind: string) => ({
  image: "图片",
  pdf: "PDF",
  markdown: "Markdown",
  html: "HTML",
  sheet: "电子表格",
  csv: "CSV",
  code: "代码",
  text: "文本",
  office: "Office 文档",
} as Record<string, string>)[kind] || kind.toUpperCase();

export function KnowledgeView({ onOpenSession }: Props) {
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<"all" | "uploaded" | "generated">("all");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<KnowledgeFile | null>(null);
  const [content, setContent] = useState<ArtifactContent | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      getKnowledgeFiles({ query, source, page, pageSize: 20 })
        .then((result) => {
          if (!active) return;
          setFiles(result.files);
          setPages(result.pages);
          if (result.page !== page) setPage(result.page);
        })
        .catch(() => {
          if (active) { setFiles([]); setPages(1); }
        })
        .finally(() => { if (active) setLoading(false); });
    }, query ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, source, page, refreshKey]);

  const preview = async (file: KnowledgeFile) => {
    setSelected(file);
    setContent(null);
    setPreviewing(true);
    const result = file.source === "uploaded"
      ? await readKnowledgeAttachment(file)
      : await readArtifact(file.session_id, file.path || "");
    setContent(result);
    setPreviewing(false);
  };

  return (
    <main className="flex-1 min-w-0 min-h-0 flex bg-paper">
      <div className="flex-1 min-w-0 overflow-y-auto hairline-scroll">
        <div className="max-w-5xl mx-auto px-7 py-6">
          <PanelHead title="知识库" sub="集中查看对话中上传和生成的文件，并随时返回原会话。" />
          <div className="flex items-center gap-2 mb-4">
            <div className="relative flex-1 max-w-md">
              <Icon name="search" size={14} className="absolute left-3 top-2.5 text-faint" />
              <input
                className="w-full rounded-lg border border-line bg-panel py-2 pl-9 pr-3 text-[13px] outline-none focus:border-accent"
                placeholder="搜索文件或会话"
                value={query}
                onChange={(event) => { setQuery(event.target.value); setPage(1); }}
              />
            </div>
            {(["all", "uploaded", "generated"] as const).map((value) => (
              <button
                key={value}
                className={"rounded-lg px-3 py-2 text-[12px] " + (source === value ? "bg-ink text-panel" : "border border-line bg-panel text-muted hover:text-ink")}
                onClick={() => { setSource(value); setPage(1); }}
              >
                {value === "all" ? "全部" : value === "uploaded" ? "我上传的" : "助手生成的"}
              </button>
            ))}
            <button className="w-8 h-8 grid place-items-center rounded-lg text-muted hover:bg-panel" title="刷新" onClick={() => setRefreshKey((key) => key + 1)}>
              <Icon name="refresh" size={15} />
            </button>
          </div>

          <div className="rounded-xl2 border border-line bg-panel overflow-hidden" data-testid="knowledge-list">
            <div className="grid grid-cols-[minmax(200px,1fr)_100px_100px_minmax(150px,240px)_120px] gap-4 border-b border-line px-4 py-2 text-[11px] text-faint">
              <span>文件</span><span>文件类型</span><span>来源</span><span>原会话</span><span>时间</span>
            </div>
            {loading ? (
              <div className="px-4 py-10 text-center text-[13px] text-faint">正在整理文件…</div>
            ) : files.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <Icon name="book" size={24} className="mx-auto mb-2 text-faint" />
                <div className="text-[13px] text-muted">{query || source !== "all" ? "没有匹配的文件" : "对话中的文件会自动出现在这里"}</div>
              </div>
            ) : files.map((file) => (
              <div key={file.id} className="grid grid-cols-[minmax(200px,1fr)_100px_100px_minmax(150px,240px)_120px] gap-4 items-center border-b border-line last:border-0 px-4 py-3 hover:bg-paper">
                <button className="min-w-0 flex items-center gap-3 text-left" onClick={() => void preview(file)}>
                  <span className="w-8 h-8 rounded-lg bg-paper grid place-items-center text-muted shrink-0"><Icon name={kindIcon(file.kind)} size={16} /></span>
                  <span className="min-w-0"><span className="block truncate text-[13px] font-medium text-ink">{file.name}</span><span className="text-[11px] text-faint">{formatSize(file.size)}</span></span>
                </button>
                <span className="text-[12px] text-muted">{kindLabel(file.kind)}</span>
                <span className="text-[12px] text-muted">{file.source === "uploaded" ? "我上传的" : "助手生成的"}</span>
                <button className="truncate text-left text-[12px] text-accent hover:underline" title={file.session_title} onClick={() => onOpenSession(file.session_id, file.workspace, file.agent)}>{file.session_title}</button>
                <span className="text-[12px] text-faint">{formatTime(file.modified_at)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-end">
            {pages > 1 && (
              <div className="flex items-center gap-2" data-testid="knowledge-pagination">
                <button className="rounded-lg border border-line bg-panel px-3 py-1.5 text-[12px] disabled:opacity-40" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>上一页</button>
                <span className="min-w-[60px] text-center text-[12px] text-muted">{page} / {pages}</span>
                <button className="rounded-lg border border-line bg-panel px-3 py-1.5 text-[12px] disabled:opacity-40" disabled={page >= pages || loading} onClick={() => setPage((value) => value + 1)}>下一页</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {selected && (
        <aside className="w-[min(46vw,720px)] min-w-[360px] border-l border-line bg-panel flex flex-col">
          <div className="h-14 px-4 flex items-center gap-3 border-b border-line">
            <Icon name={kindIcon(selected.kind)} size={16} className="text-muted" />
            <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium">{selected.name}</div><div className="truncate text-[11px] text-faint">来自：{selected.session_title}</div></div>
            {selected.source === "generated" && <button className="text-[12px] text-muted hover:text-ink" onClick={() => revealArtifact(selected.session_id, selected.path || "", "open")}>打开</button>}
            <button className="w-7 h-7 grid place-items-center rounded hover:bg-paper" aria-label="关闭预览" onClick={() => setSelected(null)}>×</button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {previewing || !content ? <div className="p-8 text-center text-[13px] text-faint">正在加载预览…</div> : <KnowledgePreview content={content} />}
          </div>
          <button className="m-4 rounded-lg border border-line px-3 py-2 text-[13px] text-accent hover:bg-paper" onClick={() => onOpenSession(selected.session_id, selected.workspace, selected.agent)}>跳转原会话</button>
        </aside>
      )}
    </main>
  );
}

function KnowledgePreview({ content }: { content: ArtifactContent }) {
  if (!content.ok || content.error) return <div className="p-8 text-center text-[13px] text-muted">{content.error || "无法预览该文件"}</div>;
  if (content.kind === "image" && content.data_url) return <img className="max-w-full mx-auto p-5" src={content.data_url} alt="文件预览" />;
  if (content.kind === "pdf" && content.data_url) return <iframe className="w-full h-full min-h-[700px] border-0" src={content.data_url} title="PDF 预览" />;
  if (content.kind === "html" && content.content) return <iframe className="w-full h-full min-h-[700px] border-0" sandbox="" srcDoc={content.content} title="HTML 预览" />;
  if (content.kind === "markdown" && content.content) return <div className="artifact-md"><Markdown text={content.content} /></div>;
  if (typeof content.content === "string") return <pre className="artifact-code">{content.content}</pre>;
  return <div className="p-8 text-center text-[13px] text-muted">请使用默认应用打开此文件</div>;
}
