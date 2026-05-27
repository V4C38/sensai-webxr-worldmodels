/**
 * Room-code helpers (adapted from google/xrblocks netblocks samples).
 * @see https://github.com/google/xrblocks/tree/main/src/addons/netblocks/samples/roomCode.ts
 */

const ALPHABET = "BCDFGHJKLMNPQRSTVWXYZ";
const CODE_LEN = 4;

export const BASE_ROOM_ID = "sensai-splats";

export function getRoomCodeFromUrl(): string | null {
  const raw = new URLSearchParams(location.search).get("room");
  if (!raw) return null;
  const cleaned = raw.toUpperCase().replace(/[^A-Z]/g, "");
  return cleaned.length === CODE_LEN ? cleaned : null;
}

export function generateRoomCode(): string {
  let s = "";
  for (let i = 0; i < CODE_LEN; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return s;
}

export function resolveRoomId(code: string | null): string {
  return code ? `${BASE_ROOM_ID}-${code}` : BASE_ROOM_ID;
}

/**
 * Relay WebSocket URL.
 * - Production: set `VITE_RELAY_URL` in Vercel (e.g. `wss://your-relay.onrender.com`).
 * - Local dev: defaults to port 8765 on the current host (`npm run relay`).
 */
export function getRelayUrl(): string {
  const configured = import.meta.env.VITE_RELAY_URL?.trim();
  if (configured) return configured;

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.hostname}:8765`;
}

function gotoRoom(code: string) {
  const url = new URL(location.href);
  url.searchParams.set("room", code);
  location.href = url.toString();
}

function leaveRoom() {
  const url = new URL(location.href);
  url.searchParams.delete("room");
  location.href = url.toString();
}

export function buildRoomCodeHud(currentCode: string | null): void {
  if (typeof document === "undefined") return;

  const root = document.createElement("div");
  root.id = "room-hud";
  Object.assign(root.style, {
    position: "fixed",
    top: "12px",
    left: "12px",
    padding: "12px 14px",
    background: "rgba(20,20,30,0.85)",
    color: "#eee",
    borderRadius: "10px",
    fontFamily: "sans-serif",
    fontSize: "13px",
    lineHeight: "1.4",
    zIndex: "999",
    minWidth: "220px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
  });

  const peerLine = document.createElement("div");
  peerLine.id = "room-hud-peer-count";
  Object.assign(peerLine.style, {
    marginTop: "6px",
    color: "#bbb",
    fontSize: "12px",
  });
  peerLine.textContent = "Peers: 1";

  if (currentCode) {
    renderConnected(root, currentCode, peerLine);
  } else {
    renderDisconnected(root);
  }

  root.appendChild(peerLine);
  document.body.appendChild(root);
}

function renderDisconnected(root: HTMLDivElement) {
  const title = document.createElement("div");
  title.textContent = "Local mode (this browser only)";
  Object.assign(title.style, { marginBottom: "8px", color: "#bbb" });
  root.appendChild(title);

  const hint = document.createElement("div");
  hint.textContent = "Open two tabs here to sync splats locally.";
  Object.assign(hint.style, {
    marginBottom: "10px",
    color: "#888",
    fontSize: "12px",
  });
  root.appendChild(hint);

  const startBtn = makeButton("Start new room");
  startBtn.style.width = "100%";
  startBtn.style.marginBottom = "8px";
  startBtn.addEventListener("click", () => gotoRoom(generateRoomCode()));
  root.appendChild(startBtn);

  const joinRow = document.createElement("div");
  Object.assign(joinRow.style, {
    display: "flex",
    gap: "6px",
    alignItems: "center",
  });

  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = CODE_LEN;
  input.placeholder = "CODE";
  Object.assign(input.style, {
    flex: "1",
    padding: "6px 8px",
    background: "rgba(0,0,0,0.4)",
    color: "#eee",
    border: "1px solid #555",
    borderRadius: "4px",
    fontFamily: "monospace",
    fontSize: "14px",
    textTransform: "uppercase",
    letterSpacing: "2px",
    minWidth: "0",
  });

  const joinBtn = makeButton("Join");
  joinBtn.disabled = true;

  const sanitize = () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z]/g, "");
    joinBtn.disabled = input.value.length !== CODE_LEN;
  };
  input.addEventListener("input", sanitize);

  const submit = () => {
    sanitize();
    if (input.value.length === CODE_LEN) gotoRoom(input.value);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
  joinBtn.addEventListener("click", submit);

  joinRow.appendChild(input);
  joinRow.appendChild(joinBtn);
  root.appendChild(joinRow);
}

function renderConnected(root: HTMLDivElement, code: string, _peerLine: HTMLDivElement) {
  const codeRow = document.createElement("div");
  Object.assign(codeRow.style, {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    marginBottom: "8px",
  });

  const label = document.createElement("span");
  label.textContent = "Room";
  label.style.color = "#bbb";
  codeRow.appendChild(label);

  const codeEl = document.createElement("span");
  codeEl.textContent = code;
  Object.assign(codeEl.style, {
    fontFamily: "monospace",
    fontSize: "18px",
    letterSpacing: "3px",
    color: "#7be3a4",
  });
  codeRow.appendChild(codeEl);
  root.appendChild(codeRow);

  const codeBtn = makeButton("Copy code");
  codeBtn.style.width = "100%";
  codeBtn.style.marginBottom = "6px";
  codeBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);
      codeBtn.textContent = "Copied";
      setTimeout(() => (codeBtn.textContent = "Copy code"), 1500);
    } catch {
      codeBtn.textContent = code;
    }
  });
  root.appendChild(codeBtn);

  const leaveBtn = makeButton("Leave room");
  leaveBtn.style.width = "100%";
  leaveBtn.style.background = "transparent";
  leaveBtn.style.color = "#bbb";
  leaveBtn.addEventListener("click", leaveRoom);
  root.appendChild(leaveBtn);
}

function makeButton(text: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.textContent = text;
  Object.assign(btn.style, {
    padding: "6px 10px",
    background: "#9177c7",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "13px",
  });
  return btn;
}
