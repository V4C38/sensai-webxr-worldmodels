import type { RoomSession } from "./roomSession.js";
import {
  CHAT_TOPIC,
  type ChatMessagePayload,
  type DisplayNamePayload,
  DISPLAY_NAME_TOPIC,
} from "./types.js";

const AVATAR_PALETTE = [
  0x9177c7, 0x7ac0ff, 0xffb86b, 0x7be3a4, 0xff7eb6, 0x6ee7b7, 0xf472b6,
];

function hashStringToIndex(s: string, n: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % n;
}

function peerColorHex(peerId: string): string {
  const c = AVATAR_PALETTE[hashStringToIndex(peerId, AVATAR_PALETTE.length)]!;
  return `#${c.toString(16).padStart(6, "0")}`;
}

function makeDisplayName(): string {
  const stored = sessionStorage.getItem("sensai-display-name");
  if (stored?.trim()) return stored.trim();
  const name = `User-${Math.floor(Math.random() * 1000)}`;
  sessionStorage.setItem("sensai-display-name", name);
  return name;
}

export interface ChatHudHandle {
  displayName: string;
  voiceButton: HTMLButtonElement;
  appendSystemLine(text: string): void;
}

/**
 * DOM chat panel (netblocks integration sample pattern).
 * @see https://github.com/google/xrblocks/tree/main/src/addons/netblocks/samples/integration
 */
export function mountChatHud(session: RoomSession): ChatHudHandle {
  const displayName = makeDisplayName();
  const peerNames = new Map<string, string>([
    [session.localPeerId, displayName],
  ]);

  session.emit(DISPLAY_NAME_TOPIC, { name: displayName } satisfies DisplayNamePayload);

  session.on(DISPLAY_NAME_TOPIC, (payload, fromPeerId) => {
    const p = payload as DisplayNamePayload;
    if (p?.name) peerNames.set(fromPeerId, p.name);
  });

  const panel = document.createElement("div");
  panel.id = "chat-hud";
  Object.assign(panel.style, {
    position: "fixed",
    bottom: "12px",
    left: "12px",
    width: "300px",
    maxHeight: "40vh",
    display: "flex",
    flexDirection: "column",
    background: "rgba(20, 20, 30, 0.85)",
    color: "#fff",
    borderRadius: "12px",
    padding: "10px",
    font: "13px system-ui, sans-serif",
    backdropFilter: "blur(8px)",
    zIndex: "999",
    userSelect: "none",
    WebkitUserSelect: "none",
    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
  } as Partial<CSSStyleDeclaration>);

  const header = document.createElement("div");
  header.textContent = `Chat · ${displayName}`;
  Object.assign(header.style, {
    fontWeight: "600",
    marginBottom: "6px",
    color: "#bfa9ff",
  });
  panel.appendChild(header);

  const log = document.createElement("div");
  Object.assign(log.style, {
    flex: "1 1 auto",
    overflowY: "auto",
    minHeight: "100px",
    maxHeight: "28vh",
    padding: "4px 0",
  });
  panel.appendChild(log);

  const inputRow = document.createElement("form");
  Object.assign(inputRow.style, {
    display: "flex",
    gap: "6px",
    marginTop: "6px",
  });

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Say something…";
  input.maxLength = 280;
  Object.assign(input.style, {
    flex: "1 1 auto",
    padding: "6px 10px",
    borderRadius: "6px",
    border: "1px solid #444",
    background: "#13141c",
    color: "#fff",
    font: "inherit",
    userSelect: "text",
    WebkitUserSelect: "text",
  } as Partial<CSSStyleDeclaration>);

  const send = document.createElement("button");
  send.type = "submit";
  send.textContent = "Send";
  Object.assign(send.style, {
    padding: "6px 14px",
    borderRadius: "6px",
    border: "none",
    background: "#9177c7",
    color: "#fff",
    cursor: "pointer",
    font: "inherit",
  });

  inputRow.appendChild(input);
  inputRow.appendChild(send);
  panel.appendChild(inputRow);

  const voiceBtn = document.createElement("button");
  voiceBtn.type = "button";
  voiceBtn.textContent = "Enable voice";
  Object.assign(voiceBtn.style, {
    marginTop: "8px",
    padding: "8px 14px",
    background: "#9177c7",
    color: "#fff",
    border: "none",
    borderRadius: "20px",
    fontSize: "13px",
    cursor: "pointer",
    alignSelf: "flex-start",
  });
  panel.appendChild(voiceBtn);

  document.body.appendChild(panel);

  function appendLine(p: ChatMessagePayload, self: boolean): void {
    const line = document.createElement("div");
    line.style.padding = "2px 0";
    const who = document.createElement("span");
    who.textContent = self ? "you" : p.from;
    who.style.color = self ? "#9177c7" : peerColorHex(p.fromId);
    who.style.fontWeight = "600";
    line.appendChild(who);
    line.appendChild(document.createTextNode(`: ${p.text}`));
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  function appendSystemLine(text: string): void {
    const line = document.createElement("div");
    line.style.padding = "2px 0";
    line.style.color = "#888";
    line.style.fontSize = "12px";
    line.textContent = text;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  inputRow.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const payload: ChatMessagePayload = {
      from: displayName,
      fromId: session.localPeerId,
      text,
      ts: Date.now(),
    };
    session.emit(CHAT_TOPIC, payload);
    appendLine(payload, true);
    input.value = "";
  });

  session.on(CHAT_TOPIC, (payload, fromPeerId) => {
    const p = payload as ChatMessagePayload;
    if (!p?.text) return;
    if (fromPeerId === session.localPeerId) return;
    const name = peerNames.get(fromPeerId) ?? p.from;
    appendLine({ ...p, from: name }, false);
  });

  return {
    displayName,
    voiceButton: voiceBtn,
    appendSystemLine,
  };
}
