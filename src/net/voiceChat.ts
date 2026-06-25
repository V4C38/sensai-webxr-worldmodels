/**
 * WebRTC voice (adapted from google/xrblocks netblocks VoiceChat).
 * @see https://github.com/google/xrblocks/tree/main/src/addons/netblocks/src/core/voice/VoiceChat.ts
 */
import type { VoiceSignalPayload } from "./types.js";

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

interface VoicePeer {
  pc: RTCPeerConnection;
  audio?: HTMLAudioElement;
  isOfferer: boolean;
}

export type VoiceSendFn = (toPeerId: string, signal: VoiceSignalPayload) => void;

export class VoiceChat {
  private readonly iceServers: RTCIceServer[];
  private readonly send: VoiceSendFn;
  private localStream?: MediaStream;
  private readonly peers = new Map<string, VoicePeer>();
  private enabled = false;
  private localId = "";

  constructor(send: VoiceSendFn, iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS) {
    this.send = send;
    this.iceServers = iceServers;
  }

  setLocalPeerId(id: string): void {
    this.localId = id;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async enable(currentPeers: ReadonlySet<string>): Promise<void> {
    if (this.enabled) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone access is not available in this browser.");
    }

    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    this.enabled = true;

    for (const [pid, entry] of this.peers) {
      if (entry.pc.getSenders().some((s) => s.track?.kind === "audio")) continue;
      for (const t of this.localStream.getTracks()) {
        entry.pc.addTrack(t, this.localStream);
      }
      void this.makeOffer(pid, entry);
    }

    for (const pid of currentPeers) {
      if (this.peers.has(pid)) continue;
      this.connectTo(pid, this.localId < pid);
    }
  }

  disable(): void {
    this.enabled = false;
    for (const pid of [...this.peers.keys()]) this.teardown(pid);
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = undefined;
  }

  setMuted(muted: boolean): void {
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }

  notifyPeerJoined(peerId: string): void {
    if (!this.enabled) return;
    this.connectTo(peerId, this.localId < peerId);
  }

  notifyPeerLeft(peerId: string): void {
    this.teardown(peerId);
  }

  async handleSignal(from: string, signal: VoiceSignalPayload): Promise<void> {
    let peer = this.peers.get(from);
    if (!peer) {
      peer = this.connectTo(from, false);
    }

    try {
      if (signal.kind === "offer") {
        await peer.pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.send(from, { kind: "answer", sdp: answer.sdp ?? "" });
      } else if (signal.kind === "answer") {
        await peer.pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
      } else if (signal.kind === "ice") {
        await peer.pc.addIceCandidate(signal.candidate).catch(() => undefined);
      }
    } catch (err) {
      console.error("[VoiceChat] signal error:", err);
    }
  }

  private connectTo(peerId: string, asOfferer: boolean): VoicePeer {
    let entry = this.peers.get(peerId);
    if (entry) return entry;

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    entry = { pc, isOfferer: asOfferer };
    this.peers.set(peerId, entry);

    if (this.localStream) {
      for (const t of this.localStream.getTracks()) {
        pc.addTrack(t, this.localStream);
      }
    }

    pc.addEventListener("icecandidate", (ev) => {
      if (ev.candidate) {
        this.send(peerId, { kind: "ice", candidate: ev.candidate.toJSON() });
      }
    });

    pc.addEventListener("track", (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      const audio = entry!.audio ?? new Audio();
      audio.autoplay = true;
      audio.srcObject = stream;
      entry!.audio = audio;
      void audio.play().catch(() => undefined);
    });

    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.teardown(peerId);
      }
    });

    if (asOfferer) {
      void this.makeOffer(peerId, entry);
    }
    return entry;
  }

  private async makeOffer(peerId: string, entry: VoicePeer): Promise<void> {
    try {
      const offer = await entry.pc.createOffer();
      await entry.pc.setLocalDescription(offer);
      this.send(peerId, { kind: "offer", sdp: offer.sdp ?? "" });
    } catch (err) {
      console.error("[VoiceChat] offer failed:", err);
    }
  }

  private teardown(peerId: string): void {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    try {
      entry.pc.close();
    } catch {
      // ignore
    }
    entry.audio?.pause();
    if (entry.audio) entry.audio.srcObject = null;
    this.peers.delete(peerId);
  }
}
