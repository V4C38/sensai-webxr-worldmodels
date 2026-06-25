import * as THREE from "three";

const LABEL_HEIGHT = 0.22;

/**
 * Billboard name label (canvas sprite, netblocks-style placement above head).
 */
export class NameLabel extends THREE.Sprite {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(text: string, color: number) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    super(new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    }));

    this.canvas = canvas;
    this.ctx = ctx;
    this.renderOrder = 5001;
    this.position.y = LABEL_HEIGHT;
    this.setText(text, color);
  }

  setText(text: string, color: number): void {
    const { canvas, ctx } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const hex = `#${color.toString(16).padStart(6, "0")}`;
    ctx.font = "bold 48px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 8;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
    ctx.fillStyle = hex;
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const mat = this.material as THREE.SpriteMaterial;
    mat.map!.needsUpdate = true;
    const aspect = canvas.width / canvas.height;
    this.scale.set(0.55 * aspect, 0.55, 1);
  }

  faceCamera(camera: THREE.Camera): void {
    this.quaternion.copy(camera.quaternion);
  }

  override dispose(): void {
    const mat = this.material as THREE.SpriteMaterial;
    mat.map?.dispose();
    mat.dispose();
  }
}

export { LABEL_HEIGHT };
