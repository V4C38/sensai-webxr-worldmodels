import { base64ToBytes, bytesToBase64 } from "./bytes.js";

export interface TransportConnectOptions {
  roomId: string;
  peerId?: string;
}

export type RpcHandler = (payload: unknown, fromPeerId: string) => void;

export interface RoomTransport {
  readonly name: string;
  readonly localPeerId: string;
  readonly isOpen: boolean;
  connect(opts: TransportConnectOptions): Promise<void>;
  close(): void;
  send(payload: Uint8Array, targetPeerId?: string): void;
  onPeerJoin(handler: (peerId: string) => void): () => void;
  onPeerLeave(handler: (peerId: string) => void): () => void;
  onMessage(handler: (fromPeerId: string, data: Uint8Array) => void): () => void;
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 12);
}

/** Same-origin tabs, zero setup (netblocks BroadcastChannelTransport). */
export class BroadcastChannelTransport implements RoomTransport {
  readonly name = "BroadcastChannel";
  private _channel?: BroadcastChannel;
  private _localPeerId = makeId();
  private _isOpen = false;
  private _peers = new Set<string>();
  private _peerJoinHandlers = new Set<(peerId: string) => void>();
  private _peerLeaveHandlers = new Set<(peerId: string) => void>();
  private _messageHandlers = new Set<
    (fromPeerId: string, data: Uint8Array) => void
  >();

  get localPeerId(): string {
    return this._localPeerId;
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  async connect(opts: TransportConnectOptions): Promise<void> {
    this._localPeerId = opts.peerId ?? makeId();
    this._channel = new BroadcastChannel(`sensai-splats:${opts.roomId}`);
    this._isOpen = true;

    this._channel.onmessage = (event) => {
      const msg = event.data as {
        type?: string;
        from?: string;
        to?: string;
        data?: string;
      };
      if (!msg?.type || !msg.from || msg.from === this._localPeerId) return;
      if (msg.to && msg.to !== this._localPeerId) return;

      if (msg.type === "hello") {
        if (!this._peers.has(msg.from)) {
          this._peers.add(msg.from);
          for (const handler of this._peerJoinHandlers) handler(msg.from);
        }
        this._channel?.postMessage({
          type: "hello",
          from: this._localPeerId,
        });
        return;
      }

      if (msg.type === "message" && msg.data) {
        for (const handler of this._messageHandlers) {
          handler(msg.from, base64ToBytes(msg.data));
        }
      }
    };

    this._channel.postMessage({ type: "hello", from: this._localPeerId });
  }

  close(): void {
    this._channel?.close();
    this._channel = undefined;
    this._isOpen = false;
    for (const peerId of this._peers) {
      for (const handler of this._peerLeaveHandlers) handler(peerId);
    }
    this._peers.clear();
  }

  send(payload: Uint8Array, targetPeerId?: string): void {
    if (!this._isOpen || !this._channel) return;
    this._channel.postMessage({
      type: "message",
      from: this._localPeerId,
      to: targetPeerId,
      data: bytesToBase64(payload),
    });
  }

  onPeerJoin(handler: (peerId: string) => void): () => void {
    this._peerJoinHandlers.add(handler);
    return () => this._peerJoinHandlers.delete(handler);
  }

  onPeerLeave(handler: (peerId: string) => void): () => void {
    this._peerLeaveHandlers.add(handler);
    return () => this._peerLeaveHandlers.delete(handler);
  }

  onMessage(handler: (fromPeerId: string, data: Uint8Array) => void): () => void {
    this._messageHandlers.add(handler);
    return () => this._messageHandlers.delete(handler);
  }
}

interface ServerMessage {
  type: "welcome" | "peer-join" | "peer-leave" | "message" | "error";
  peerId?: string;
  peers?: string[];
  from?: string;
  data?: string;
  message?: string;
}

/** WebSocket relay for cross-device rooms (netblocks WebSocketTransport). */
export class WebSocketTransport implements RoomTransport {
  readonly name = "WebSocket";
  private _ws?: WebSocket;
  private _localPeerId = makeId();
  private _isOpen = false;
  private _peers = new Set<string>();
  private _connectOpts?: TransportConnectOptions;
  private _peerJoinHandlers = new Set<(peerId: string) => void>();
  private _peerLeaveHandlers = new Set<(peerId: string) => void>();
  private _messageHandlers = new Set<
    (fromPeerId: string, data: Uint8Array) => void
  >();

  constructor(private readonly url: string) {}

  get localPeerId(): string {
    return this._localPeerId;
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  connect(opts: TransportConnectOptions): Promise<void> {
    this._connectOpts = opts;
    this._localPeerId = opts.peerId ?? makeId();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this._ws = ws;
      let resolved = false;

      ws.addEventListener("open", () => {
        ws.send(
          JSON.stringify({
            type: "join",
            roomId: opts.roomId,
            peerId: this._localPeerId,
          }),
        );
      });

      ws.addEventListener("message", (ev) => {
        let msg: ServerMessage;
        try {
          msg =
            typeof ev.data === "string"
              ? JSON.parse(ev.data)
              : JSON.parse(new TextDecoder().decode(ev.data as ArrayBuffer));
        } catch {
          return;
        }

        switch (msg.type) {
          case "welcome":
            this._isOpen = true;
            if (msg.peerId) this._localPeerId = msg.peerId;
            for (const pid of msg.peers ?? []) {
              if (pid !== this._localPeerId && !this._peers.has(pid)) {
                this._peers.add(pid);
                for (const handler of this._peerJoinHandlers) handler(pid);
              }
            }
            if (!resolved) {
              resolved = true;
              resolve();
            }
            break;
          case "peer-join":
            if (msg.peerId && !this._peers.has(msg.peerId)) {
              this._peers.add(msg.peerId);
              for (const handler of this._peerJoinHandlers) handler(msg.peerId);
            }
            break;
          case "peer-leave":
            if (msg.peerId && this._peers.delete(msg.peerId)) {
              for (const handler of this._peerLeaveHandlers) handler(msg.peerId);
            }
            break;
          case "message":
            if (msg.from && msg.data) {
              for (const handler of this._messageHandlers) {
                handler(msg.from, base64ToBytes(msg.data));
              }
            }
            break;
          case "error":
            console.error("[WebSocketTransport]", msg.message ?? msg);
            break;
        }
      });

      ws.addEventListener("error", () => {
        if (!resolved) {
          resolved = true;
          reject(new Error("WebSocket failed to connect."));
        }
      });

      ws.addEventListener("close", () => {
        this._isOpen = false;
        for (const id of this._peers) {
          for (const handler of this._peerLeaveHandlers) handler(id);
        }
        this._peers.clear();
      });
    });
  }

  close(): void {
    this._ws?.close();
    this._ws = undefined;
    this._isOpen = false;
  }

  send(payload: Uint8Array, targetPeerId?: string): void {
    if (!this._isOpen || !this._ws || this._ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this._ws.send(
      JSON.stringify({
        type: "send",
        to: targetPeerId,
        data: bytesToBase64(payload),
      }),
    );
  }

  onPeerJoin(handler: (peerId: string) => void): () => void {
    this._peerJoinHandlers.add(handler);
    return () => this._peerJoinHandlers.delete(handler);
  }

  onPeerLeave(handler: (peerId: string) => void): () => void {
    this._peerLeaveHandlers.add(handler);
    return () => this._peerLeaveHandlers.delete(handler);
  }

  onMessage(handler: (fromPeerId: string, data: Uint8Array) => void): () => void {
    this._messageHandlers.add(handler);
    return () => this._messageHandlers.delete(handler);
  }
}
