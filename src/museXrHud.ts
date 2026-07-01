import { playSophieWelcome } from "./sophieAudio";

const MUSEXR_DEMO_URL =
  import.meta.env.VITE_MUSEXR_DEMO_URL?.trim() ||
  "https://louvre-xr-backend-production.up.railway.app/demo";

/** Shared HUD chrome (room / chat panels). */
const PANEL_WIDTH = "300px";
const PANEL_MAX_HEIGHT = "60vh";

/**
 * Bottom-left MuseXR museum guide (Louvre demo), 1.5× the default chat-style height.
 */
export function mountMuseXrHud(): void {
  if (typeof document === "undefined") return;

  const root = document.createElement("div");
  root.id = "musexr-hud";
  Object.assign(root.style, {
    position: "fixed",
    bottom: "12px",
    left: "12px",
    width: PANEL_WIDTH,
    maxHeight: PANEL_MAX_HEIGHT,
    display: "flex",
    flexDirection: "column",
    background: "rgba(20, 20, 30, 0.85)",
    color: "#fff",
    borderRadius: "12px",
    padding: "10px",
    font: "13px system-ui, sans-serif",
    backdropFilter: "blur(8px)",
    zIndex: "999",
    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
    overflow: "hidden",
  } as Partial<CSSStyleDeclaration>);

  const header = document.createElement("div");
  header.textContent = "MuseXR · Museum Guide";
  Object.assign(header.style, {
    fontWeight: "600",
    marginBottom: "8px",
    color: "#bfa9ff",
    flexShrink: "0",
  });
  root.appendChild(header);

  const frameWrap = document.createElement("div");
  Object.assign(frameWrap.style, {
    flex: "1 1 auto",
    minHeight: "0",
    height: "min(480px, 54vh)",
    borderRadius: "8px",
    overflow: "hidden",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "#13141c",
  });

  const iframe = document.createElement("iframe");
  iframe.title = "MuseXR Louvre Museum Guide";
  iframe.src = MUSEXR_DEMO_URL;
  iframe.setAttribute(
    "allow",
    "camera; microphone; fullscreen; clipboard-read; clipboard-write",
  );
  Object.assign(iframe.style, {
    width: "100%",
    height: "100%",
    border: "none",
    display: "block",
    background: "#13141c",
  });

  frameWrap.appendChild(iframe);
  root.appendChild(frameWrap);

  const link = document.createElement("a");
  link.href = MUSEXR_DEMO_URL;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Open in new tab";
  Object.assign(link.style, {
    marginTop: "8px",
    fontSize: "12px",
    color: "#9177c7",
    textDecoration: "none",
    flexShrink: "0",
  });
  link.addEventListener("mouseenter", () => {
    link.style.textDecoration = "underline";
  });
  link.addEventListener("mouseleave", () => {
    link.style.textDecoration = "none";
  });
  root.appendChild(link);

  document.body.appendChild(root);

  // Sophie welcome greeting on room join
  playSophieWelcome();
}
