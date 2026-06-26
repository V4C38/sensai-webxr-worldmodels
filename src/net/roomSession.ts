import { SplatFileType } from "@sparkjsdev/spark";
import { bytesToBase64, chunkBase64 } from "./bytes.js";
import { getRelayUrl } from "./roomCode.js";
import {
  BroadcastChannelTransport,
  RoomTransport,
  RpcHandler,
  WebSocketTransport,
} from "./transport.js";
import {
  SKYBOX_TOPIC,
  VOICE_SIGNAL_TOPIC,
  type SkyboxFileChunkPayload,
  type SkyboxFileEndPayload,
  type SkyboxFileStartPayload,
  type SkyboxSyncPayload,
  type SkyboxSyncState,
  type SkyboxUrlPayload,
  type VoiceSignalPayload,
} from "./types.js";
import { VoiceChat } from "./voiceChat.js";

export interface SplatUrlPayload {
  kind: "url";
  splatUrl: string;
  label: string;
}

export interface SplatFileStartPayload {
  kind: "file-start";
  transferId: string;
  fileName: string;
  fileType: SplatFileType;
  totalChunks: number;
}

export interface SplatFileChunkPayload {
  kind: "file-chunk";
  transferId: string;
  chunkIndex: number;
  data: string;
}

export interface SplatFileEndPayload {
  kind: "file-end";
  transferId: string;
}

export type SplatSyncPayload =
  | SplatUrlPayload
  | SplatFileStartPayload
  | SplatFileChunkPayload
  | SplatFileEndPayload;

export type SplatSyncState =
  | {
      kind: "url";
      splatUrl: string;
      label: string;
    }
  | {
      kind: "file";
      fileName: string;
      fileType: SplatFileType;
      base64: string;
    };

interface WireMessage {
  type: "rpc";
  topic: string;
  payload: unknown;
  to?: string;
}

export class RoomSession {
  readonly transport: RoomTransport;
  readonly voice: VoiceChat;
  private _handlers = new Map<string, Set<RpcHandler>>();
  private _peerCount = 1;
  private _remotePeers = new Set<string>();
  private _currentState: SplatSyncState | null = null;
  private _currentSkyboxState: SkyboxSyncState | null = null;
  private _incomingFiles = new Map<
    string,
    { fileName: string; fileType: SplatFileType; chunks: string[]; total: number }
  >();
  private _incomingSkyboxFiles = new Map<
    string,
    { fileName: string; chunks: string[]; total: number }
  >();
  private _loadBeginHandlers = new Set<() => void | Promise<void>>();
  private _loadEndHandlers = new Set<() => void | Promise<void>>();

  private constructor(transport: RoomTransport) {
    this.transport = transport;
    this.voice = new VoiceChat((toPeerId, signal) => {
      this.emitTo(toPeerId, VOICE_SIGNAL_TOPIC, signal);
    });
    this.voice.setLocalPeerId(transport.localPeerId);

    this.on(VOICE_SIGNAL_TOPIC, (payload, fromPeerId) => {
      void this.voice.handleSignal(fromPeerId, payload as VoiceSignalPayload);
    });

    transport.onMessage((from, data) => {
      try {
        const text = new TextDecoder().decode(data);
        const msg = JSON.parse(text) as WireMessage;
        if (msg.type !== "rpc" || !msg.topic) return;
        this._dispatch(msg.topic, msg.payload, from);
      } catch (err) {
        console.error("[RoomSession] Failed to parse message:", err);
      }
    });

    transport.onPeerJoin((peerId) => {
      this._remotePeers.add(peerId);
      this._peerCount += 1;
      this._emitPeerCount();
      this.voice.notifyPeerJoined(peerId);
      if (this._currentState) {
        this.syncCurrentStateToPeer(peerId);
      }
      if (this._currentSkyboxState) {
        this.syncSkyboxToPeer(peerId);
      }
    });

    transport.onPeerLeave((peerId) => {
      this._remotePeers.delete(peerId);
      this._peerCount = Math.max(1, this._peerCount - 1);
      this._emitPeerCount();
      this.voice.notifyPeerLeft(peerId);
    });
  }

  static async connect(transport: RoomTransport, roomId: string): Promise<RoomSession> {
    await transport.connect({ roomId });
    return new RoomSession(transport);
  }

  get peerCount(): number {
    return this._peerCount;
  }

  get localPeerId(): string {
    return this.transport.localPeerId;
  }

  get remotePeerIds(): ReadonlySet<string> {
    return this._remotePeers;
  }

  get currentState(): SplatSyncState | null {
    return this._currentState;
  }

  rememberState(state: SplatSyncState): void {
    this._currentState = state;
  }

  rememberSkyboxState(state: SkyboxSyncState): void {
    this._currentSkyboxState = state;
  }

  get currentSkyboxState(): SkyboxSyncState | null {
    return this._currentSkyboxState;
  }

  on(topic: string, handler: RpcHandler): () => void {
    let set = this._handlers.get(topic);
    if (!set) {
      set = new Set();
      this._handlers.set(topic, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  emit(topic: string, payload: unknown): void {
    this._send({ type: "rpc", topic, payload });
  }

  emitTo(peerId: string, topic: string, payload: unknown): void {
    this._send({ type: "rpc", topic, payload, to: peerId });
  }

  /** Broadcast a URL-based splat to all peers. */
  broadcastUrlSplat(splatUrl: string, label: string): void {
    const state: SplatSyncState = { kind: "url", splatUrl, label };
    this._currentState = state;
    this.emit("splat-load", { kind: "url", splatUrl, label } satisfies SplatUrlPayload);
  }

  /** Broadcast a local file to all peers (chunked for relay size limits). */
  async broadcastFileSplat(
    fileName: string,
    fileType: SplatFileType,
    fileBytes: ArrayBuffer,
  ): Promise<void> {
    const base64 = bytesToBase64(new Uint8Array(fileBytes));
    this._currentState = { kind: "file", fileName, fileType, base64 };
    this.emitFileChunks("splat-load", undefined, fileName, fileType, base64);
  }

  /** Send the current splat to one peer (e.g. late joiner) without a giant frame. */
  syncCurrentStateToPeer(peerId: string): void {
    const state = this._currentState;
    if (!state) return;

    if (state.kind === "url") {
      this.emitTo(peerId, "splat-load", {
        kind: "url",
        splatUrl: state.splatUrl,
        label: state.label,
      } satisfies SplatUrlPayload);
      return;
    }

    this.emitFileChunks(
      "splat-load",
      peerId,
      state.fileName,
      state.fileType,
      state.base64,
    );
  }

  private emitFileChunks(
    topic: string,
    targetPeerId: string | undefined,
    fileName: string,
    fileType: SplatFileType,
    base64: string,
  ): void {
    const chunks = chunkBase64(base64);
    const transferId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const send = targetPeerId
      ? (payload: SplatSyncPayload) => this.emitTo(targetPeerId, topic, payload)
      : (payload: SplatSyncPayload) => this.emit(topic, payload);

    send({
      kind: "file-start",
      transferId,
      fileName,
      fileType,
      totalChunks: chunks.length,
    } satisfies SplatFileStartPayload);

    for (let i = 0; i < chunks.length; i++) {
      send({
        kind: "file-chunk",
        transferId,
        chunkIndex: i,
        data: chunks[i]!,
      } satisfies SplatFileChunkPayload);
    }

    send({
      kind: "file-end",
      transferId,
    } satisfies SplatFileEndPayload);
  }

  /** Fired when a remote splat transfer starts (URL or first file chunk). */
  onSplatLoadBegin(handler: () => void | Promise<void>): () => void {
    this._loadBeginHandlers.add(handler);
    return () => this._loadBeginHandlers.delete(handler);
  }

  /** Fired after a remote splat has been applied or the transfer failed. */
  onSplatLoadEnd(handler: () => void | Promise<void>): () => void {
    this._loadEndHandlers.add(handler);
    return () => this._loadEndHandlers.delete(handler);
  }

  /** Register handlers that reassemble chunked skybox JPEG payloads. */
  onSkyboxLoad(handler: (state: SkyboxSyncState) => void | Promise<void>): () => void {
    return this.on(SKYBOX_TOPIC, (payload) => {
      void this._handleSkyboxLoad(payload as SkyboxSyncPayload, handler);
    });
  }

  broadcastSkyboxUrl(skyboxUrl: string): void {
    const state: SkyboxSyncState = { kind: "url", skyboxUrl };
    this._currentSkyboxState = state;
    this.emit(SKYBOX_TOPIC, { kind: "url", skyboxUrl } satisfies SkyboxUrlPayload);
  }

  async broadcastSkyboxFile(fileName: string, fileBytes: ArrayBuffer): Promise<void> {
    const base64 = bytesToBase64(new Uint8Array(fileBytes));
    const state: SkyboxSyncState = { kind: "file", fileName, base64 };
    this._currentSkyboxState = state;
    this.emitSkyboxFileChunks(undefined, fileName, base64);
  }

  syncSkyboxToPeer(peerId: string): void {
    const state = this._currentSkyboxState;
    if (!state) return;

    if (state.kind === "url") {
      this.emitTo(peerId, SKYBOX_TOPIC, {
        kind: "url",
        skyboxUrl: state.skyboxUrl,
      } satisfies SkyboxUrlPayload);
      return;
    }

    this.emitSkyboxFileChunks(peerId, state.fileName, state.base64);
  }

  private emitSkyboxFileChunks(
    targetPeerId: string | undefined,
    fileName: string,
    base64: string,
  ): void {
    const chunks = chunkBase64(base64);
    const transferId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const send = targetPeerId
      ? (payload: SkyboxSyncPayload) => this.emitTo(targetPeerId, SKYBOX_TOPIC, payload)
      : (payload: SkyboxSyncPayload) => this.emit(SKYBOX_TOPIC, payload);

    send({
      kind: "file-start",
      transferId,
      fileName,
      totalChunks: chunks.length,
    } satisfies SkyboxFileStartPayload);

    for (let i = 0; i < chunks.length; i++) {
      send({
        kind: "file-chunk",
        transferId,
        chunkIndex: i,
        data: chunks[i]!,
      } satisfies SkyboxFileChunkPayload);
    }

    send({
      kind: "file-end",
      transferId,
    } satisfies SkyboxFileEndPayload);
  }

  private async _handleSkyboxLoad(
    payload: SkyboxSyncPayload,
    handler: (state: SkyboxSyncState) => void | Promise<void>,
  ): Promise<void> {
    if (payload.kind === "url") {
      const state: SkyboxSyncState = {
        kind: "url",
        skyboxUrl: payload.skyboxUrl,
      };
      this._currentSkyboxState = state;
      await handler(state);
      return;
    }

    if (payload.kind === "file-start") {
      this._incomingSkyboxFiles.set(payload.transferId, {
        fileName: payload.fileName,
        chunks: [],
        total: payload.totalChunks,
      });
      return;
    }

    if (payload.kind === "file-chunk") {
      const incoming = this._incomingSkyboxFiles.get(payload.transferId);
      if (!incoming) return;
      incoming.chunks[payload.chunkIndex] = payload.data;
      return;
    }

    if (payload.kind === "file-end") {
      const incoming = this._incomingSkyboxFiles.get(payload.transferId);
      if (!incoming) return;
      this._incomingSkyboxFiles.delete(payload.transferId);
      const received = incoming.chunks.filter((chunk) => chunk !== undefined);
      if (received.length !== incoming.total) return;

      const base64 = incoming.chunks.join("");
      const state: SkyboxSyncState = {
        kind: "file",
        fileName: incoming.fileName,
        base64,
      };
      this._currentSkyboxState = state;
      await handler(state);
    }
  }

  /** Register handlers that reassemble chunked file payloads. */
  onSplatLoad(handler: (payload: SplatSyncState) => void | Promise<void>): () => void {
    return this.on("splat-load", (payload) => {
      void this._handleSplatLoad(payload as SplatSyncPayload, handler);
    });
  }

  close(): void {
    this.transport.close();
  }

  private _send(msg: WireMessage): void {
    const bytes = new TextEncoder().encode(JSON.stringify(msg));
    this.transport.send(bytes, msg.to);
  }

  private _dispatch(topic: string, payload: unknown, fromPeerId: string): void {
    const set = this._handlers.get(topic);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(payload, fromPeerId);
      } catch (err) {
        console.error(`[RoomSession] Handler for "${topic}" threw:`, err);
      }
    }
  }

  private async _handleSplatLoad(
    payload: SplatSyncPayload,
    handler: (state: SplatSyncState) => void | Promise<void>,
  ): Promise<void> {
    if (payload.kind === "url") {
      await this._notifyLoadBegin();
      try {
        const state: SplatSyncState = {
          kind: "url",
          splatUrl: payload.splatUrl,
          label: payload.label,
        };
        this._currentState = state;
        await handler(state);
      } finally {
        await this._notifyLoadEnd();
      }
      return;
    }

    if (payload.kind === "file-start") {
      await this._notifyLoadBegin();
      this._incomingFiles.set(payload.transferId, {
        fileName: payload.fileName,
        fileType: payload.fileType,
        chunks: [],
        total: payload.totalChunks,
      });
      return;
    }

    if (payload.kind === "file-chunk") {
      const incoming = this._incomingFiles.get(payload.transferId);
      if (!incoming) return;
      incoming.chunks[payload.chunkIndex] = payload.data;
      return;
    }

    if (payload.kind === "file-end") {
      const incoming = this._incomingFiles.get(payload.transferId);
      if (!incoming) {
        await this._notifyLoadEnd();
        return;
      }
      this._incomingFiles.delete(payload.transferId);
      const received = incoming.chunks.filter((chunk) => chunk !== undefined);
      if (received.length !== incoming.total) {
        await this._notifyLoadEnd();
        return;
      }
      try {
        const base64 = incoming.chunks.join("");
        const state: SplatSyncState = {
          kind: "file",
          fileName: incoming.fileName,
          fileType: incoming.fileType,
          base64,
        };
        this._currentState = state;
        await handler(state);
      } finally {
        await this._notifyLoadEnd();
      }
    }
  }

  private async _notifyLoadBegin(): Promise<void> {
    for (const handler of this._loadBeginHandlers) {
      try {
        await handler();
      } catch (err) {
        console.error("[RoomSession] splat load begin handler threw:", err);
      }
    }
  }

  private async _notifyLoadEnd(): Promise<void> {
    for (const handler of this._loadEndHandlers) {
      try {
        await handler();
      } catch (err) {
        console.error("[RoomSession] splat load end handler threw:", err);
      }
    }
  }

  private _peerCountListeners = new Set<(count: number) => void>();

  onPeerCountChange(handler: (count: number) => void): () => void {
    this._peerCountListeners.add(handler);
    handler(this._peerCount);
    return () => this._peerCountListeners.delete(handler);
  }

  private _emitPeerCount(): void {
    for (const handler of this._peerCountListeners) {
      handler(this._peerCount);
    }
  }
}

export function createTransportForRoom(hasRoomCode: boolean): RoomTransport {
  if (hasRoomCode) {
    return new WebSocketTransport(getRelayUrl());
  }
  return new BroadcastChannelTransport();
}
