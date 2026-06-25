import type { World } from "@iwsdk/core";
import { VisibilityState } from "@iwsdk/core";
import { GaussianSplatLoaderSystem } from "./gaussianSplatLoader.js";
import {
  registerLoadSplatButton,
  setLoadSplatButtonLoading,
} from "./splatLoadUi.js";
import { enterXR } from "./xrSession.js";

const SPLAT_FILE_ACCEPT = ".spz,.ply,.ksplat,.rad";

function makeHudButton(text: string, background = "#9177c7"): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.textContent = text;
  Object.assign(btn.style, {
    padding: "6px 10px",
    background,
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "13px",
    width: "100%",
  });
  return btn;
}

/** Top-left Load Splat + Enter XR controls. */
export function mountLoadSplatHud(world: World): void {
  if (typeof document === "undefined") return;

  const root = document.createElement("div");
  root.id = "load-splat-hud";
  Object.assign(root.style, {
    position: "fixed",
    top: "12px",
    left: "12px",
    zIndex: "999",
    minWidth: "220px",
    padding: "12px 14px",
    background: "rgba(20,20,30,0.85)",
    borderRadius: "10px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "8px",
  });

  const logo = document.createElement("img");
  logo.src = "./logo.png";
  logo.alt = "Logo";
  Object.assign(logo.style, {
    width: "100%",
    maxWidth: "192px",
    height: "auto",
    objectFit: "contain",
    display: "block",
  });
  root.appendChild(logo);

  const divider = document.createElement("div");
  Object.assign(divider.style, {
    width: "80%",
    height: "1px",
    background: "#7b2ff2",
    margin: "2px 0",
  });
  root.appendChild(divider);

  const loadBtn = makeHudButton("Load Splat", "#7b2ff2");
  loadBtn.id = "load-splat-button";
  registerLoadSplatButton(loadBtn);

  loadBtn.addEventListener("click", () => {
    const input = window.document.createElement("input");
    input.type = "file";
    input.accept = SPLAT_FILE_ACCEPT;
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;

      const splatSystem = world.getSystem(GaussianSplatLoaderSystem);
      if (!splatSystem) {
        console.error("[LoadSplatHud] GaussianSplatLoaderSystem is not registered.");
        return;
      }

      setLoadSplatButtonLoading(true);
      try {
        await splatSystem.unloadHostSplat();
        await splatSystem.loadFromFile(file);
      } catch (err) {
        console.error("[LoadSplatHud] Failed to load splat file:", err);
      } finally {
        setLoadSplatButtonLoading(false);
      }
    });
    input.click();
  });

  const xrBtn = makeHudButton("Enter VR", "#fbbf24");
  xrBtn.style.color = "#0d0221";
  xrBtn.addEventListener("click", () => {
    if (world.visibilityState.value === VisibilityState.NonImmersive) {
      enterXR(world).catch((err) => {
        console.error("[LoadSplatHud] Failed to enter XR:", err);
      });
    } else {
      world.exitXR();
    }
  });

  world.visibilityState.subscribe((visibilityState) => {
    xrBtn.textContent =
      visibilityState === VisibilityState.NonImmersive
        ? "Enter VR"
        : "Exit to Browser";
  });

  root.appendChild(loadBtn);
  root.appendChild(xrBtn);
  loadBtn.style.width = "100%";
  xrBtn.style.width = "100%";
  document.body.appendChild(root);
}
