import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { hidePetWindow, showMainWindow, showPetWindow, startWindowDrag } from "../tauri";
import type { PetState, PetStateEvent } from "./petState";
import {
  BANNER_ART,
  BANNER_PALETTE,
  BANNER_TIRED_ART,
  HULK_ART,
  HULK_PALETTE,
  SURGE_ART,
  SURGE_PALETTE,
} from "./pixelArt";
import "./pet.css";

export const PET_ENABLED_KEY = "openworker:pet-enabled";
export const PET_VISIBILITY_CHANGED = "coworker:pet-visibility-changed";

type Form = "banner" | "transforming" | "hulk" | "returning" | "failed";

function PixelCharacter({ form, tired = false }: { form: "banner" | "surge" | "hulk"; tired?: boolean }) {
  const art = form === "banner" ? (tired ? BANNER_TIRED_ART : BANNER_ART) : form === "surge" ? SURGE_ART : HULK_ART;
  const palette = form === "banner" ? BANNER_PALETTE : form === "surge" ? SURGE_PALETTE : HULK_PALETTE;
  return (
    <div
      className={`pixel-character pixel-character-${form}`}
      role="img"
      aria-label={form === "banner" ? "班纳博士" : form === "surge" ? "变身中" : "绿巨人浩克"}
    >
      {art.flatMap((row, y) =>
        [...row].map((token, x) => (
          <i
            aria-hidden="true"
            className="pixel"
            key={`${x}-${y}`}
            style={{
              gridColumn: x + 1,
              gridRow: y + 1,
              backgroundColor: palette[token] || "transparent",
            }}
          />
        )),
      )}
    </div>
  );
}

function nextForm(state: PetState): Form {
  switch (state) {
    case "running_hulk":
      return "hulk";
    case "failed_hulk":
      return "failed";
    case "transforming":
      return "transforming";
    case "returning":
      return "returning";
    default:
      return "banner";
  }
}

function aggregateFromPayload(event: PetStateEvent): PetState {
  if (event.state === "running") return "running_hulk";
  if (event.state === "failed") return "failed_hulk";
  if (event.state === "waiting") return "waiting_banner";
  return "idle_banner";
}

export function PetWindow() {
  const [form, setForm] = useState<Form>(() => {
    const hashQuery = window.location.hash.includes("?") ? window.location.hash.split("?")[1] : "";
    const requested = new URLSearchParams(hashQuery || window.location.search.slice(1)).get("state");
    return requested === "running" ? "hulk" : "banner";
  });
  const timerRef = useRef<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const formRef = useRef<Form>(form);
  formRef.current = form;

  useEffect(() => {
    const listen = (globalThis as any).__TAURI__?.event?.listen;
    let unlisten: (() => void) | undefined;
    const applyPayload = (payload: PetStateEvent) => {
      const target = aggregateFromPayload(payload);
      const current = formRef.current;
      if (target === "running_hulk" && (current === "hulk" || current === "failed" || current === "transforming")) return;
      if (target === "idle_banner" && (current === "banner" || current === "returning")) return;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (target === "running_hulk" && current !== "hulk" && current !== "failed") {
        setForm("transforming");
        timerRef.current = window.setTimeout(() => setForm("hulk"), 1250);
      } else if (target === "idle_banner" && (current === "hulk" || current === "failed" || current === "transforming")) {
        setForm("returning");
        timerRef.current = window.setTimeout(() => setForm("banner"), 1500);
      } else if (target === "failed_hulk") {
        setForm("failed");
      } else if (target === "waiting_banner") {
        setForm("banner");
      }
    };
    const onDomEvent = (event: Event) => {
      const payload = (event as CustomEvent<PetStateEvent>).detail;
      if (payload) applyPayload(payload);
    };
    window.addEventListener("pet://state-changed", onDomEvent);
    if (listen) {
      void listen("pet://state-changed", (event: { payload: PetStateEvent }) => applyPayload(event.payload))
        .then((remove: () => void) => { unlisten = remove; });
    }
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      window.removeEventListener("pet://state-changed", onDomEvent);
      unlisten?.();
    };
  }, []);

  const visibleForm = nextForm(form === "failed" ? "failed_hulk" : form === "hulk" ? "running_hulk" : form === "transforming" ? "transforming" : form === "returning" ? "returning" : "idle_banner");
  const statusClass = useMemo(() => `pet-shell pet-${visibleForm}`, [visibleForm]);
  const beginDrag = (event: PointerEvent<HTMLElement>) => {
    if (event.button === 0) void startWindowDrag();
  };

  return (
    <main
      className={statusClass}
      onPointerDown={(event) => { if (!(event.target as HTMLElement).closest("button")) beginDrag(event); }}
      onDoubleClick={() => { setMenuOpen(false); void showMainWindow(); }}
      onContextMenu={(event) => { event.preventDefault(); setMenuOpen(true); }}
    >
      <div className="pet-stage" aria-live="polite">
        <PixelCharacter form="banner" tired={visibleForm === "returning"} />
        <PixelCharacter form="surge" />
        <PixelCharacter form="hulk" />
        <span className="pet-glasses" aria-hidden="true" />
        <span className="pet-shirt-rip pet-shirt-rip-left" aria-hidden="true" />
        <span className="pet-shirt-rip pet-shirt-rip-right" aria-hidden="true" />
        <span className="pet-shirt-flap pet-shirt-flap-left" aria-hidden="true" />
        <span className="pet-shirt-flap pet-shirt-flap-right" aria-hidden="true" />
      </div>
      {menuOpen && (
        <div className="pet-menu" role="menu" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => void hidePetWindow()}>隐藏宠物</button>
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void showMainWindow(); }}>打开主应用</button>
        </div>
      )}
    </main>
  );
}

export function PetStatusBridge({ running }: { running: boolean }) {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(PET_ENABLED_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const onVisibilityChanged = (event: Event) => {
      const next = (event as CustomEvent<boolean>).detail;
      if (typeof next === "boolean") setEnabled(next);
    };
    window.addEventListener(PET_VISIBILITY_CHANGED, onVisibilityChanged);
    return () => window.removeEventListener(PET_VISIBILITY_CHANGED, onVisibilityChanged);
  }, []);

  useEffect(() => {
    // In the browser these helpers are inert; in Tauri they control the separate pet window.
    void (enabled ? showPetWindow() : hidePetWindow());
  }, [enabled]);

  useEffect(() => {
    const emit = (globalThis as any).__TAURI__?.event?.emit;
    const payload: PetStateEvent = {
      state: running ? "running" : "idle",
      taskCount: running ? 1 : 0,
      occurredAt: Date.now(),
    };
    const send = () => {
      if (emit) void emit("pet://state-changed", payload);
      else window.dispatchEvent(new CustomEvent("pet://state-changed", { detail: payload }));
    };
    send();
    // The two WebViews load independently. A short retry window covers a pet layer that has
    // not registered its listener yet, without polling or sending per-frame updates.
    const retry = window.setTimeout(send, 120);
    const retryAgain = window.setTimeout(send, 600);
    return () => {
      window.clearTimeout(retry);
      window.clearTimeout(retryAgain);
    };
  }, [running]);
  return null;
}
