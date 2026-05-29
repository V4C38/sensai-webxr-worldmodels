import { createSystem } from "@iwsdk/core";
import {
  GaussianSplatLoaderSystem,
  SplatLoadedInfo,
} from "./gaussianSplatLoader.js";
import { base64ToBytes, bytesToBase64 } from "./net/bytes.js";
import {
  getRoomCodeFromUrl,
  resolveRoomId,
} from "./net/roomCode.js";
import {
  createTransportForRoom,
  RoomSession,
  SplatSyncState,
} from "./net/roomSession.js";
import { mountChatHud } from "./net/chatHud.js";
import { setLoadSplatButtonLoading } from "./splatLoadUi.js";

/**
 * Shared-room networking inspired by google/xrblocks netblocks.
 * @see https://github.com/google/xrblocks/tree/main/samples/netblocks
 */
export class MultiplayerSystem extends createSystem({}) {
  private session: RoomSession | null = null;
  private voiceOn = false;

  get isConnected(): boolean {
    return this.session?.transport.isOpen ?? false;
  }

  get peerCount(): number {
    return this.session?.peerCount ?? 1;
  }

  async init() {
    const splatSystem = this.world.getSystem(GaussianSplatLoaderSystem);
    splatSystem?.setOnSplatLoaded((info, options) =>
      this.handleLocalSplatLoaded(info, options.sync),
    );

    const roomCode = getRoomCodeFromUrl();
    const roomId = resolveRoomId(roomCode);
    const transport = createTransportForRoom(!!roomCode);

    try {
      this.session = await RoomSession.connect(transport, roomId);
      console.log(
        `[Multiplayer] Joined room "${roomId}" via ${transport.name}` +
          (roomCode ? ` (code ${roomCode})` : " (local tabs)"),
      );

      this.session.onSplatLoadBegin(() => this.prepareRemoteSplat());
      this.session.onSplatLoadEnd(() => setLoadSplatButtonLoading(false));
      this.session.onSplatLoad((state) => this.applyRemoteSplat(state));

      this.session.onPeerCountChange((count) => {
        const hud = document.getElementById("room-hud-peer-count");
        if (hud) hud.textContent = `Peers: ${count}`;
      });

      const chat = mountChatHud(this.session);
      chat.voiceButton.addEventListener("click", () => {
        void this.toggleVoice(chat);
      });
    } catch (err) {
      console.error("[Multiplayer] Failed to join room:", err);
    }
  }

  private async handleLocalSplatLoaded(
    info: SplatLoadedInfo,
    sync: boolean,
  ): Promise<void> {
    if (!this.session) return;

    if (info.kind === "url") {
      const state: SplatSyncState = {
        kind: "url",
        splatUrl: info.splatUrl,
        label: info.label,
      };
      this.session.rememberState(state);
      if (sync) this.session.broadcastUrlSplat(info.splatUrl, info.label);
      return;
    }

    const state: SplatSyncState = {
      kind: "file",
      fileName: info.fileName,
      fileType: info.fileType,
      base64: bytesToBase64(new Uint8Array(info.fileBytes)),
    };
    this.session.rememberState(state);
    if (sync) {
      await this.session.broadcastFileSplat(
        info.fileName,
        info.fileType,
        info.fileBytes,
      );
    }
  }

  private async prepareRemoteSplat(): Promise<void> {
    setLoadSplatButtonLoading(true);
    const splatSystem = this.world.getSystem(GaussianSplatLoaderSystem);
    if (!splatSystem) return;
    await splatSystem.unloadHostSplat();
  }

  private async toggleVoice(chat: ReturnType<typeof mountChatHud>): Promise<void> {
    const session = this.session;
    if (!session) return;

    if (this.voiceOn) {
      session.voice.disable();
      this.voiceOn = false;
      chat.voiceButton.textContent = "Enable voice";
      chat.appendSystemLine("Voice chat off");
      return;
    }

    try {
      await session.voice.enable(session.remotePeerIds);
      this.voiceOn = true;
      chat.voiceButton.textContent = "Disable voice";
      chat.appendSystemLine("Voice chat on");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      chat.appendSystemLine(`Voice error: ${msg}`);
      console.error("[Multiplayer] Voice enable failed:", err);
    }
  }

  private async applyRemoteSplat(state: SplatSyncState): Promise<void> {
    const splatSystem = this.world.getSystem(GaussianSplatLoaderSystem);
    if (!splatSystem) return;

    try {
      if (state.kind === "url") {
        await splatSystem.loadFromNetwork({
          kind: "url",
          splatUrl: state.splatUrl,
          label: state.label,
        });
      } else {
        const bytes = base64ToBytes(state.base64);
        await splatSystem.loadFromNetwork({
          kind: "file",
          fileName: state.fileName,
          fileType: state.fileType,
          fileBytes: bytes.slice().buffer,
        });
      }
    } catch (err) {
      console.error("[Multiplayer] Failed to apply remote splat:", err);
    }
  }
}

/** Mount room HUD before world init (netblocks pattern). */
export function mountRoomHud(): void {
  import("./net/roomCode.js").then(({ buildRoomCodeHud, getRoomCodeFromUrl }) => {
    buildRoomCodeHud(getRoomCodeFromUrl());
  });
}
