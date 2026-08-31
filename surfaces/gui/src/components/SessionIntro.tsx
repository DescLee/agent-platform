import { useState } from "react";
import type { Attachment } from "../types";
import { useRoots } from "../useRoots";
import { AddFolderForm } from "./AddFolderForm";

// Starter tasks prefill the composer for review before sending. Only folder analysis
// needs setup; research and meeting notes work without third-party connections.

const FOLDER_PROMPT = "分析这个文件夹中的文件，并总结其中的重要内容。";
const RESEARCH_PROMPT =
  "请围绕以下主题搜索公开资料，生成一份中文调研简报，包含核心结论、关键事实、不同观点和参考来源链接，并保存为 Markdown 文件。请区分已核实事实与推测；如果我还未填写主题，请先询问。\n\n调研主题：";
const MEETING_PROMPT =
  "请将以下会议记录整理成会议纪要和行动清单，包含关键结论、已确认的决策、待办事项、负责人、截止时间和待确认问题，并保存为 Markdown 文件。未提及的负责人或时间请标注“待确认”，不要编造；如果我还未提供记录，请先让我粘贴或上传。\n\n会议记录：";

export function SessionIntro({
  sessionId,
  onPrefill,
}: {
  sessionId: string;
  onPrefill: (text: string, attachments?: Attachment[]) => void;
}) {
  const { roots, busy, error, addRoot } = useRoots(sessionId);
  const [addingFolder, setAddingFolder] = useState(false);

  const shared = roots.filter((r) => !r.primary);

  const pickFolder = () => {
    // A shared folder already exists → straight to the prompt; otherwise share one first.
    if (shared.length > 0) onPrefill(FOLDER_PROMPT);
    else setAddingFolder((v) => !v);
  };

  return (
    <div className="intro">
      <h1 className="greeting">
        <span className="mark">✦</span> 今天想完成什么？
      </h1>
      <p className="intro-lede">
        选择一个任务开始，我会完成工作并保存结果；也可以直接在下方输入你的需求。
      </p>

      <div className="intro-tasks">
        <button className="task-card" data-testid="intro-task-folder" onClick={pickFolder}>
          <span className="task-card-body">
            <span className="task-card-title">分析文件夹中的文件</span>
            <span className="task-card-sub">读取文件并总结重要内容</span>
          </span>
          <span className="task-card-act">选择文件夹 →</span>
        </button>
        {addingFolder && (
          <div className="intro-addfolder">
            <AddFolderForm
              startOpen
              busy={busy}
              onAdd={async (path, writable) => {
                const ok = await addRoot(path, writable);
                if (ok !== false) onPrefill(FOLDER_PROMPT);
                return ok;
              }}
              onDismiss={() => setAddingFolder(false)}
            />
            {error && <div className="roots-err">{error}</div>}
          </div>
        )}

        <button
          className="task-card"
          data-testid="intro-task-research"
          onClick={() => onPrefill(RESEARCH_PROMPT)}
        >
          <span className="task-card-body">
            <span className="task-card-title">调研一个主题，生成简报</span>
            <span className="task-card-sub">
              搜索公开资料，整理关键结论与来源
            </span>
          </span>
          <span className="task-card-act">填写主题 →</span>
        </button>

        <button
          className="task-card"
          data-testid="intro-task-meeting"
          onClick={() => onPrefill(MEETING_PROMPT)}
        >
          <span className="task-card-body">
            <span className="task-card-title">把会议记录整理成行动清单</span>
            <span className="task-card-sub">
              提炼决策、待办事项、负责人和截止时间
            </span>
          </span>
          <span className="task-card-act">添加记录 →</span>
        </button>
      </div>
    </div>
  );
}
