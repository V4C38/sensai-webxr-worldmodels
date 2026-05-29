import * as THREE from "three";
import type { World } from "@iwsdk/core";
import type { RoomSession } from "./net/roomSession.js";
import { RemotePeerAvatar } from "./net/remotePeerAvatar.js";
import { loadUserAvatarTemplate } from "./net/userAvatarModel.js";
import {
  DISPLAY_NAME_TOPIC,
  type DisplayNamePayload,
  PRESENCE_TOPIC,
  type PresencePosePayload,
} from "./net/types.js";

const BROADCAST_HZ = 15;

const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();

/**
 * Broadcast local head pose and render remote peers as user.glb avatars with name labels.
 * @see https://xrblocks.github.io/docs/samples/Netblocks/
 */
export class PeerPresence {
  private readonly avatars = new Map<string, RemotePeerAvatar>();
  private readonly peerNames = new Map<string, string>();
  private broadcastAccum = 0;
  private unsubPresence?: () => void;
  private unsubDisplayName?: () => void;
  private unsubJoin?: () => void;
  private unsubLeave?: () => void;

  constructor(
    private readonly world: World,
    private session: RoomSession,
  ) {
    this.unsubPresence = session.on(PRESENCE_TOPIC, (payload, fromPeerId) => {
      this.onRemotePose(fromPeerId, payload as PresencePosePayload);
    });

    this.unsubDisplayName = session.on(DISPLAY_NAME_TOPIC, (payload, fromPeerId) => {
      const p = payload as DisplayNamePayload;
      if (!p?.name) return;
      this.peerNames.set(fromPeerId, p.name);
      this.avatars.get(fromPeerId)?.setDisplayName(p.name);
    });

    this.unsubJoin = session.transport.onPeerJoin((peerId) => {
      this.ensureAvatar(peerId);
    });

    this.unsubLeave = session.transport.onPeerLeave((peerId) => {
      this.removeAvatar(peerId);
      this.peerNames.delete(peerId);
    });

    for (const peerId of session.remotePeerIds) {
      this.ensureAvatar(peerId);
    }

    void loadUserAvatarTemplate().catch((err) => {
      console.error("[PeerPresence] Failed to preload user.glb:", err);
    });
  }

  update(dt: number): void {
    this.broadcastAccum += dt;
    const interval = 1 / BROADCAST_HZ;
    if (this.broadcastAccum >= interval) {
      this.broadcastAccum -= interval;
      this.broadcastLocalPose();
    }

    const camera = this.world.camera;
    for (const avatar of this.avatars.values()) {
      avatar.tick(dt, camera);
    }
  }

  dispose(): void {
    this.unsubPresence?.();
    this.unsubDisplayName?.();
    this.unsubJoin?.();
    this.unsubLeave?.();
    for (const avatar of this.avatars.values()) avatar.dispose();
    this.avatars.clear();
    this.peerNames.clear();
  }

  private broadcastLocalPose(): void {
    const cam = this.world.camera;
    cam.getWorldPosition(_position);
    cam.getWorldQuaternion(_quaternion);

    const payload: PresencePosePayload = {
      px: _position.x,
      py: _position.y,
      pz: _position.z,
      qx: _quaternion.x,
      qy: _quaternion.y,
      qz: _quaternion.z,
      qw: _quaternion.w,
      ts: Date.now(),
    };
    this.session.emit(PRESENCE_TOPIC, payload);
  }

  private onRemotePose(peerId: string, payload: PresencePosePayload): void {
    if (!payload || peerId === this.session.localPeerId) return;
    const avatar = this.ensureAvatar(peerId);
    avatar.setPoseFromPayload(
      payload.px,
      payload.py,
      payload.pz,
      payload.qx,
      payload.qy,
      payload.qz,
      payload.qw,
    );
  }

  private ensureAvatar(peerId: string): RemotePeerAvatar {
    let avatar = this.avatars.get(peerId);
    if (!avatar) {
      avatar = new RemotePeerAvatar(
        peerId,
        this.world.scene,
        this.peerNames.get(peerId),
      );
      this.avatars.set(peerId, avatar);
    }
    return avatar;
  }

  private removeAvatar(peerId: string): void {
    const avatar = this.avatars.get(peerId);
    if (!avatar) return;
    avatar.dispose();
    this.avatars.delete(peerId);
  }
}
