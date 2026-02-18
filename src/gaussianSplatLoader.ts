import { Types, createComponent, createSystem, Entity } from "@iwsdk/core";
import { SplatMesh } from "@sparkjsdev/spark";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GaussianSplatAnimator } from "./gaussianSplatAnimator.js";

const LOAD_TIMEOUT_MS = 30_000;

interface SplatInstance {
  splat: SplatMesh;
  collider: THREE.Group | null;
  animator: GaussianSplatAnimator | null;
}

/**
 * Marks an entity as a Gaussian Splat host. Attach to any entity with an
 * `object3D`; the system will load the splat (and optional collider) as
 * children so they inherit the entity's transform.
 */
export const GaussianSplatLoader = createComponent("GaussianSplatLoader", {
  splatUrl: { type: Types.String, default: "./splats/sensai.spz" },
  meshUrl: { type: Types.String, default: "" },
  autoLoad: { type: Types.Boolean, default: true },
  animate: { type: Types.Boolean, default: false },
});

/**
 * Manages loading, unloading, and animation of Gaussian Splats for entities
 * that carry {@link GaussianSplatLoader}. Auto-loads when `autoLoad` is true;
 * call `load()` / `unload()` / `replayAnimation()` for manual control.
 */
export class GaussianSplatLoaderSystem extends createSystem({
  splats: { required: [GaussianSplatLoader] },
}) {
  private instances = new Map<number, SplatInstance>();
  private animating = new Set<number>();
  private gltfLoader = new GLTFLoader();

  init() {
    this.queries.splats.subscribe("qualify", (entity) => {
      const autoLoad = entity.getValue(
        GaussianSplatLoader,
        "autoLoad",
      ) as boolean;
      if (!autoLoad) return;

      this.load(entity).catch((err) => {
        console.error(
          `[GaussianSplatLoader] Auto-load failed for entity ${entity.index}:`,
          err,
        );
      });
    });
  }

  update() {
    if (this.animating.size === 0) return;

    for (const entityIndex of this.animating) {
      const instance = this.instances.get(entityIndex);
      if (!instance?.animator?.isAnimating) {
        this.animating.delete(entityIndex);
        continue;
      }
      instance.animator.tick();
      if (!instance.animator.isAnimating) {
        this.animating.delete(entityIndex);
      }
    }
  }

  /** Load the splat (and optional collider mesh) for an entity. */
  async load(
    entity: Entity,
    options?: { animate?: boolean },
  ): Promise<void> {
    const splatUrl = entity.getValue(GaussianSplatLoader, "splatUrl") as string;
    const meshUrl = entity.getValue(GaussianSplatLoader, "meshUrl") as string;
    const animate =
      options?.animate ??
      (entity.getValue(GaussianSplatLoader, "animate") as boolean);

    if (!splatUrl) {
      throw new Error(
        `[GaussianSplatLoader] Entity ${entity.index} has an empty splatUrl.`,
      );
    }

    const parent = entity.object3D;
    if (!parent) {
      throw new Error(
        `[GaussianSplatLoader] Entity ${entity.index} has no object3D.`,
      );
    }

    if (this.instances.has(entity.index)) {
      await this.unload(entity, { animate: false });
    }

    const splat = new SplatMesh({ url: splatUrl });
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              `[GaussianSplatLoader] Timed out loading "${splatUrl}" after ${LOAD_TIMEOUT_MS / 1000}s`,
            ),
          ),
        LOAD_TIMEOUT_MS,
      );
    });
    await Promise.race([splat.initialized, timeout]);

    let collider: THREE.Group | null = null;
    if (meshUrl) {
      const gltf = await this.gltfLoader.loadAsync(meshUrl);
      collider = gltf.scene;
      collider.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) child.visible = false;
      });
    }

    const animator = new GaussianSplatAnimator(splat);
    animator.apply();
    if (!animate) animator.setProgress(1);

    // Render splats behind UI panels (which use AlwaysDepth + high renderOrder)
    splat.renderOrder = -10;
    parent.add(splat);
    if (collider) parent.add(collider);

    this.instances.set(entity.index, { splat, collider, animator });
    console.log(
      `[GaussianSplatLoader] Loaded splat for entity ${entity.index}` +
        `${collider ? " (with collider)" : ""}`,
    );

    if (animate) {
      this.animating.add(entity.index);
      await animator.animateIn();
    }
  }

  /** Replay fly-in animation for an already-loaded entity. */
  async replayAnimation(
    entity: Entity,
    options?: { duration?: number },
  ): Promise<void> {
    const instance = this.instances.get(entity.index);
    if (!instance?.animator) return;

    instance.animator.stop();
    instance.animator.setProgress(0);
    this.animating.add(entity.index);
    await instance.animator.animateIn(options?.duration);
  }

  /** Unload the splat (and collider) for an entity. */
  async unload(
    entity: Entity,
    options?: { animate?: boolean },
  ): Promise<void> {
    const instance = this.instances.get(entity.index);
    if (!instance) return;

    const animate =
      options?.animate ??
      (entity.getValue(GaussianSplatLoader, "animate") as boolean);

    if (animate && instance.animator) {
      this.animating.add(entity.index);
      await instance.animator.animateOut();
    }

    this.removeInstance(entity.index);
  }

  private removeInstance(entityIndex: number): void {
    const instance = this.instances.get(entityIndex);
    if (!instance) return;

    this.animating.delete(entityIndex);
    instance.animator?.dispose();
    instance.splat.parent?.remove(instance.splat);
    instance.splat.dispose();

    if (instance.collider) {
      instance.collider.parent?.remove(instance.collider);
      instance.collider.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.geometry.dispose();
          const materials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
          for (const mat of materials) mat.dispose();
        }
      });
    }

    this.instances.delete(entityIndex);
    console.log(
      `[GaussianSplatLoader] Unloaded splat for entity ${entityIndex}`,
    );
  }
}
