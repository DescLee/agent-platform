import { useState } from "react";
import type { Persona } from "../api";
import { fullPersonaName } from "../personaScope";
import { Icon } from "./Icon";

interface Props {
  personas: Persona[] | null;
  agent: string;
  onPickCoworker: (id: string) => void;
  onManage: () => void;
  onImport: () => void;
}

// Draft-only expert selection. The wire id for the default coworker is "cowork".
export function ExpertPicker(props: Props) {
  const [openMenu, setOpenMenu] = useState<"coworker" | null>(null);
  const personas = (props.personas || []).filter((p) => p.enabled);
  const current = personas.find((p) => p.id === props.agent);
  const toggle = (_menu: "coworker") => setOpenMenu((current) => current ? null : "coworker");
  const chip = "inline-flex min-w-0 items-center gap-1 px-1.5 py-1 rounded-lg text-[12px] text-muted hover:text-ink hover:bg-paper";
  return (
    <>
      {openMenu && <div className="fixed inset-0 z-20" onClick={() => setOpenMenu(null)} />}
      <div className="relative group inline-flex items-center min-w-0" data-testid="expert-picker">
        {props.agent !== "cowork" && (
          <button
            type="button"
            aria-label="取消选择专家"
            title="取消选择专家，使用默认 coworker"
            data-testid="clear-expert"
            className="shrink-0 rounded p-0.5 text-faint opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-ink focus-visible:opacity-100"
            onClick={() => { setOpenMenu(null); props.onPickCoworker("cowork"); }}
          >
            <Icon name="x" size={12} />
          </button>
        )}
        <button className={chip} data-testid="coworker-chip" onClick={() => toggle("coworker")}>
          <span className="max-w-[180px] truncate">{props.agent === "cowork" ? "选择专家" : fullPersonaName(current?.name, props.agent)}</span>
          <Icon name="chevronDown" size={12} className="text-faint" />
        </button>
        {openMenu === "coworker" && (
          <div className="setup-menu absolute bottom-full mb-1.5 left-0 z-30 w-[320px] bg-panel border border-line rounded-xl2 shadow-xl p-1">
            {personas.map((p) => (
              <button
                key={p.id}
                className={
                  "w-full text-left px-2.5 py-2 rounded-lg hover:bg-paper " +
                  (p.id === props.agent ? "bg-accentSoft/50" : "")
                }
                onClick={() => {
                  setOpenMenu(null);
                  props.onPickCoworker(p.id);
                }}
              >
                <span className="block text-[13px] font-medium text-ink">
                  {fullPersonaName(p.name, p.id)}
                </span>
                {p.tagline && (
                  <span className="block text-[12px] text-muted truncate">{p.tagline}</span>
                )}
              </button>
            ))}
            <div className="border-t border-line mt-1 pt-1">
              <button
                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-paper text-[12px] text-accent"
                data-testid="import-coworker"
                onClick={() => {
                  setOpenMenu(null);
                  props.onImport();
                }}
              >
                导入专家…
              </button>
              <button
                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-paper text-[12px] text-accent"
                onClick={() => {
                  setOpenMenu(null);
                  props.onManage();
                }}
              >
                管理专家…
              </button>
            </div>
          </div>
        )}
      </div>

    </>
  );
}
