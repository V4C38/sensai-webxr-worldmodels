import { VisibilityState, createSystem } from "@iwsdk/core";
import * as THREE from "three";

const MOVE_SPEED = 4;
const SPRINT_MULT = 2;
const LOOK_SENSITIVITY = 0.002;
const PITCH_LIMIT = Math.PI / 2 - 0.05;

const uiPanelRoots = new Set<THREE.Object3D>();
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();

/** Register screen-space PanelUI meshes so left-clicks on buttons are not stolen. */
export function registerDesktopUiPanel(root: THREE.Object3D): void {
  uiPanelRoots.add(root);
}

function isTypingInForm(): boolean {
  const el = document.activeElement;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}

function isHudElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest("#room-hud, .desktop-controls-hint");
}

/**
 * Desktop fly controls: WASD move, right-drag (or Alt+left-drag) to look.
 * Left-click is left for UIKit panel / DOM HUD interaction.
 */
export class DesktopControlsSystem extends createSystem({}) {
  private readonly keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private pointerLocked = false;
  private lookDrag = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private enabled = false;
  private lastFrameTime = performance.now();
  private hintEl: HTMLDivElement | null = null;

  init() {
    const container = document.getElementById("scene-container");
    if (!container) return;

    this.syncAnglesFromCamera();

    this.world.visibilityState.subscribe((state) => {
      this.enabled = state === VisibilityState.NonImmersive;
      if (!this.enabled) {
        this.exitPointerLock();
        this.lookDrag = false;
      }
      if (this.hintEl) {
        this.hintEl.style.display = this.enabled ? "block" : "none";
      }
    });
    this.enabled =
      this.world.visibilityState.value === VisibilityState.NonImmersive;

    this.mountHint();

    const onKeyDown = (e: KeyboardEvent) => {
      if (!this.enabled || isTypingInForm()) return;
      this.keys.add(e.code);
      if (
        ["KeyW", "KeyA", "KeyS", "KeyD", "Space"].includes(e.code) ||
        e.code === "ArrowUp" ||
        e.code === "ArrowDown" ||
        e.code === "ArrowLeft" ||
        e.code === "ArrowRight"
      ) {
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const onPointerLockChange = () => {
      this.pointerLocked = document.pointerLockElement === container;
    };
    document.addEventListener("pointerlockchange", onPointerLockChange);

    container.addEventListener("contextmenu", (e) => {
      if (!this.enabled) return;
      // Right-drag is used for look; suppress the browser context menu on the canvas.
      e.preventDefault();
    });

    container.addEventListener("mousedown", (e) => {
      if (!this.enabled || isTypingInForm() || isHudElement(e.target)) return;

      const rightDragLook = e.button === 2;
      const altLeftDragLook = e.button === 0 && e.altKey;
      if (!rightDragLook && !altLeftDragLook) return;

      if (this.isPointerOverUiPanel(e.clientX, e.clientY)) return;

      if (rightDragLook && document.pointerLockElement !== container) {
        container.requestPointerLock?.();
      }

      this.lookDrag = true;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    });

    const endLookDrag = () => {
      this.lookDrag = false;
    };
    window.addEventListener("mouseup", endLookDrag);
    window.addEventListener("blur", endLookDrag);

    const onMouseMove = (e: MouseEvent) => {
      if (!this.enabled) return;

      if (this.pointerLocked) {
        this.yaw -= e.movementX * LOOK_SENSITIVITY;
        this.pitch -= e.movementY * LOOK_SENSITIVITY;
      } else if (this.lookDrag) {
        this.yaw -= (e.clientX - this.lastPointerX) * LOOK_SENSITIVITY;
        this.pitch -= (e.clientY - this.lastPointerY) * LOOK_SENSITIVITY;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
      } else {
        return;
      }

      this.pitch = THREE.MathUtils.clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT);
    };
    document.addEventListener("mousemove", onMouseMove);
  }

  update() {
    if (!this.enabled) return;

    const now = performance.now();
    const dt = Math.min((now - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = now;

    const cam = this.world.camera;
    cam.rotation.order = "YXZ";
    cam.rotation.y = this.yaw;
    cam.rotation.x = this.pitch;

    if (isTypingInForm()) return;

    let speed = MOVE_SPEED;
    if (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")) {
      speed *= SPRINT_MULT;
    }

    const forward = new THREE.Vector3(0, 0, -1).applyEuler(
      new THREE.Euler(0, this.yaw, 0, "YXZ"),
    );
    const right = new THREE.Vector3(1, 0, 0).applyEuler(
      new THREE.Euler(0, this.yaw, 0, "YXZ"),
    );

    const move = new THREE.Vector3();
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) move.add(forward);
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) move.sub(forward);
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) move.add(right);
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) move.sub(right);
    if (this.keys.has("Space")) move.y += 1;
    if (this.keys.has("KeyQ") || this.keys.has("ControlLeft")) move.y -= 1;

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed * dt);
      cam.position.add(move);
    }
  }

  private syncAnglesFromCamera() {
    this.yaw = this.world.camera.rotation.y;
    this.pitch = this.world.camera.rotation.x;
  }

  private exitPointerLock() {
    if (document.pointerLockElement) {
      document.exitPointerLock?.();
    }
  }

  private isPointerOverUiPanel(clientX: number, clientY: number): boolean {
    if (uiPanelRoots.size === 0) return false;

    const canvas = document
      .getElementById("scene-container")
      ?.querySelector("canvas");
    if (!canvas) return false;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointerNdc, this.world.camera);

    for (const root of uiPanelRoots) {
      if (raycaster.intersectObject(root, true).length > 0) return true;
    }
    return false;
  }

  private mountHint() {
    const hint = document.createElement("div");
    hint.className = "desktop-controls-hint";
    hint.id = "desktop-controls-hint";
    hint.textContent =
      "Right-drag (or Alt+left-drag) to look · left-click UI · WASD move · Space up / Q down · Shift sprint";
    Object.assign(hint.style, {
      position: "fixed",
      bottom: "12px",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "6px 12px",
      background: "rgba(20,20,30,0.75)",
      color: "#aaa",
      borderRadius: "8px",
      fontFamily: "sans-serif",
      fontSize: "12px",
      zIndex: "998",
      pointerEvents: "none",
      maxWidth: "min(96vw, 520px)",
      textAlign: "center",
    });
    if (!this.enabled) hint.style.display = "none";
    document.body.appendChild(hint);
    this.hintEl = hint;
  }
}
