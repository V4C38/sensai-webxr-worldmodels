import * as THREE from "three";
import { peerColor } from "./avatarPalette.js";
import { NameLabel } from "./nameLabel.js";
import { loadUserAvatarTemplate, tintAvatarModel } from "./userAvatarModel.js";

const LERP_SPEED = 14;

/**
 * Remote peer avatar: user.glb model + billboard name label.
 */
export class RemotePeerAvatar {
  readonly group = new THREE.Group();
  private readonly targetPosition = new THREE.Vector3();
  private readonly targetQuaternion = new THREE.Quaternion();
  private readonly color: number;
  private nameLabel: NameLabel | null = null;
  private modelRoot: THREE.Object3D | null = null;
  private displayName: string;
  private hasPose = false;
  private ready = false;

  constructor(
    readonly peerId: string,
    private readonly scene: THREE.Scene,
    displayName?: string,
  ) {
    this.group.name = `RemotePeer(${peerId})`;
    this.color = peerColor(peerId);
    this.displayName = displayName ?? peerId.slice(0, 6);
    this.group.visible = false;
    this.group.renderOrder = 5000;
    scene.add(this.group);
    void this.init();
  }

  setDisplayName(name: string): void {
    this.displayName = name.trim() || this.peerId.slice(0, 6);
    this.nameLabel?.setText(this.displayName, this.color);
  }

  setPoseFromPayload(px: number, py: number, pz: number, qx: number, qy: number, qz: number, qw: number): void {
    this.targetPosition.set(px, py, pz);
    this.targetQuaternion.set(qx, qy, qz, qw);
    if (!this.hasPose) {
      this.group.position.copy(this.targetPosition);
      this.group.quaternion.copy(this.targetQuaternion);
      this.hasPose = true;
      if (this.ready) this.group.visible = true;
    }
  }

  tick(dt: number, camera: THREE.Camera): void {
    if (!this.hasPose) return;
    const t = 1 - Math.exp(-LERP_SPEED * dt);
    this.group.position.lerp(this.targetPosition, t);
    this.group.quaternion.slerp(this.targetQuaternion, t);
    this.nameLabel?.faceCamera(camera);
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    this.nameLabel?.dispose();
    if (this.modelRoot) {
      this.modelRoot.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
    }
  }

  private async init(): Promise<void> {
    try {
      const template = await loadUserAvatarTemplate();
      this.modelRoot = template.clone();
      tintAvatarModel(this.modelRoot, this.color);
      this.modelRoot.traverse((obj) => {
        obj.renderOrder = 5000;
      });
      this.group.add(this.modelRoot);

      this.nameLabel = new NameLabel(this.displayName, this.color);
      this.group.add(this.nameLabel);

      this.ready = true;
      if (this.hasPose) this.group.visible = true;
    } catch (err) {
      console.error(`[RemotePeerAvatar] Failed to load user.glb for ${this.peerId}:`, err);
    }
  }
}
