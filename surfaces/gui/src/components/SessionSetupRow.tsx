import { useState } from "react";
import { getRecentWorkspaces, openWorkspace, type RecentWorkspace } from "../api";
import { chooseFolder } from "../tauri";
import { baseName } from "../paths";
import { Icon } from "./Icon";

// Draft folder selection stays above the composer.

interface Props {
  // The folder chip renders only for personas that work in a folder (Chat hides it).
  showFolder: boolean;
  // The user's explicit folder pick for this draft, if any (never a temporary dir's path).
  folderName: string | null;
  onPickFolder: (path: string, branch?: string | null) => void;

}

export function SessionSetupRow(props: Props) {
  const [openMenu, setOpenMenu] = useState<"folder" | null>(null);
  const [recents, setRecents] = useState<RecentWorkspace[] | null>(null);
  const [error, setError] = useState("");
  const toggle = (menu: "folder") => {
    setError("");
    if (menu === "folder" && openMenu !== "folder") {
      getRecentWorkspaces().then(setRecents).catch(() => setRecents([]));
    }
    setOpenMenu((cur) => (cur === menu ? null : menu));
  };

  const pickFolder = async (path: string) => {
    const res = await openWorkspace(path);
    if (!res.ok) {
      setError(res.error || "could not open that folder");
      return;
    }
    setOpenMenu(null);
    props.onPickFolder(res.path, res.git_branch);
  };

  const browse = async () => {
    const picked = await chooseFolder();
    if (picked) await pickFolder(picked);
  };

  const chip =
    "relative inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[13px] text-muted hover:text-ink hover:bg-paper cursor-pointer select-none whitespace-nowrap";

  return (
    <div className="max-w-3xl mx-auto mb-1.5 px-1 flex items-center gap-1.5" data-testid="setup-row">
      {openMenu && <div className="fixed inset-0 z-20" onClick={() => setOpenMenu(null)} />}

      {/* Folder chip — only for personas that work in a folder. */}
      {props.showFolder && (
        <div className="relative">
          <button className={chip} data-testid="folder-chip" onClick={() => toggle("folder")}>
            <Icon name="folder" size={13} />
            <span className="max-w-[220px] truncate">{props.folderName || "选择文件夹"}</span>
            <Icon name="chevronDown" size={12} className="text-faint" />
          </button>
          {openMenu === "folder" && (
            <div className="setup-menu absolute bottom-full mb-1.5 left-0 z-30 w-[280px] bg-panel border border-line rounded-xl2 shadow-xl p-1">
              {(recents || [])
                .filter((w) => w.exists)
                .slice(0, 5)
                .map((w) => (
                  <button
                    key={w.path}
                    className="w-full text-left flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-paper"
                    onClick={() => void pickFolder(w.path)}
                    title={w.path}
                  >
                    <Icon name="folder" size={13} className="mt-0.5 shrink-0 text-muted" />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-ink truncate">{baseName(w.path)}</span>
                      <span className="block text-[12px] text-faint truncate">{w.path}</span>
                    </span>
                  </button>
                ))}
              <div className={(recents || []).some((w) => w.exists) ? "border-t border-line mt-1 pt-1" : ""}>
                <button
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-paper text-[12px] text-accent"
                  onClick={() => void browse()}
                >
                  {props.folderName ? "Choose another folder…" : "Choose a folder…"}
                </button>
              </div>
              {error && <div className="px-2.5 py-1 text-[12px] text-warnInk">{error}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
