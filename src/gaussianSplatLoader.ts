
import { Types, createComponent, createSystem, Entity } from "@iwsdk/core";
import { SparkRenderer, SplatMesh, SplatFileType } from "@sparkjsdev/spark";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GaussianSplatAnimator } from "./gaussianSplatAnimator.js";
import { bytesToBase64 } from "./net/bytes.js";
import type { SplatSyncState } from "./net/roomSession.js";


// ------------------------------------------------------------
// Constants & Types
// ------------------------------------------------------------
const LOAD_TIMEOUT_MS = 120_000;

/** Correct World Labs / OpenGL SPZ exports (-Y down, -Z forward) for Three.js (+Y up). */
const SPZ_COORDINATE_FIX_X = Math.PI;

type SplatMeshLoadOptions = NonNullable<
  ConstructorParameters<typeof SplatMesh>[0]
>;

interface SplatInstance {
  splat: SplatMesh;
  collider: THREE.Group | null;
  animator: GaussianSplatAnimator | null;
}

export type SplatLoadedInfo =
  | { kind: "url"; splatUrl: string; label: string }
  | {
      kind: "file";
      fileName: string;
      fileType: SplatFileType;
      fileBytes: ArrayBuffer;
    };

export type SplatLoadedHandler = (
  info: SplatLoadedInfo,
  options: { sync: boolean },
) => void | Promise<void>;

type SplatHostObject3D = THREE.Object3D & {
  __gaussianSplatTransformPatched?: boolean;
};

function patchHostTransformSync(object3D: THREE.Object3D): void {
  const host = object3D as SplatHostObject3D;
  if (host.__gaussianSplatTransformPatched) return;

  host.rotation._onChange(() => {
    host.quaternion.setFromEuler(host.rotation, false);
  });
  host.quaternion._onChange(() => {
    host.rotation.setFromQuaternion(host.quaternion, undefined, false);
  });

  // Reapply the current Euler so future `.rotation` edits update the live ECS quaternion.
  host.quaternion.setFromEuler(host.rotation, false);
  host.__gaussianSplatTransformPatched = true;
}

function splatFileTypeFromName(fileName: string): SplatFileType {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "spz":
      return SplatFileType.SPZ;
    case "ply":
      return SplatFileType.PLY;
    case "ksplat":
      return SplatFileType.KSPLAT;
    case "rad":
      return SplatFileType.RAD;
    default:
      throw new Error(
        `[GaussianSplatLoader] Unsupported splat file "${fileName}". Use .spz, .ply, .ksplat, or .rad.`,
      );
  }
}


// ------------------------------------------------------------
// Component – marks an entity as a Gaussian Splat host
// ------------------------------------------------------------
/**
 * Marks an entity as a Gaussian Splat host. Attach to any entity with an
 * `object3D`; the system will load the splat (and optional collider) as
 * children so they inherit the entity's transform.
 */
export const GaussianSplatLoader = createComponent("GaussianSplatLoader", {
  splatUrl: { type: Types.String, default: "./splats/louvre.spz" },
  meshUrl: { type: Types.String, default: "" },
  autoLoad: { type: Types.Boolean, default: true },
  animate: { type: Types.Boolean, default: false },
  enableLod: { type: Types.Boolean, default: true },
  lodSplatScale: { type: Types.Float32, default: 1.0 },
});


// ------------------------------------------------------------
// System – loads, unloads, and animates Gaussian Splats
// ------------------------------------------------------------
/**
 * Manages loading, unloading, and animation of Gaussian Splats for entities
 * that carry {@link GaussianSplatLoader}. Auto-loads when `autoLoad` is true;
 * call `load()` / `unload()` / `replayAnimation()` for manual control.
 */
export class GaussianSplatLoaderSystem extends createSystem({
  splats: { required: [GaussianSplatLoader] },
}) {

  // ----------------------------------------------------------
  // State
  // ----------------------------------------------------------
  private instances = new Map<number, SplatInstance>();
  private animating = new Set<number>();
  private gltfLoader = new GLTFLoader();
  private sparkRenderer: SparkRenderer | null = null;
  private hostEntity: Entity | null = null;
  private onSplatLoaded: SplatLoadedHandler | null = null;
  private syncedState: SplatSyncState | null = null;

  /** Entity used by UI actions such as "Load Splat". */
  setHostEntity(entity: Entity): void {
    this.hostEntity = entity;
  }

  getHostEntity(): Entity | null {
    return this.hostEntity;
  }

  hasHostSplat(): boolean {
    return this.hostEntity !== null && this.instances.has(this.hostEntity.index);
  }

  /** Unload the splat on the host entity (no-op if none loaded). */
  async unloadHostSplat(): Promise<void> {
    if (!this.hostEntity || !this.instances.has(this.hostEntity.index)) return;
    await this.unload(this.hostEntity, { animate: false });
  }

  setOnSplatLoaded(handler: SplatLoadedHandler | null): void {
    this.onSplatLoaded = handler;
  }

  getSyncedState(): SplatSyncState | null {
    return this.syncedState;
  }


  // ----------------------------------------------------------
  // Initialization
  // ----------------------------------------------------------
  init() {
    const spark = new SparkRenderer({
      renderer: this.world.renderer,
      enableLod: true,
      lodSplatScale: 1.0,
      behindFoveate: 0.1,
    });
    spark.outsideFoveate = 0.3;
    spark.renderOrder = -10;
    this.world.scene.add(spark);
    this.sparkRenderer = spark;

    // SparkJS driveLod() deep-clones the camera every frame. IWSDK's
    // camera has UIKitDocument children that crash during any copy/clone
    // chain (even non-recursive), so we bypass it entirely and construct
    // a plain PerspectiveCamera with only the transform/projection data
    // SparkJS needs for LoD distance calculations.
    const cam = this.world.camera as THREE.PerspectiveCamera;
    cam.clone = function () {
      const c = new THREE.PerspectiveCamera();
      c.projectionMatrix.copy(this.projectionMatrix);
      c.projectionMatrixInverse.copy(this.projectionMatrixInverse);
      c.matrixWorld.copy(this.matrixWorld);
      c.matrixWorldInverse.copy(this.matrixWorldInverse);
      return c;
    };

    this.queries.splats.subscribe("qualify", (entity) => {
      if (entity.object3D) {
        patchHostTransformSync(entity.object3D);
      }

      const autoLoad = entity.getValue(
        GaussianSplatLoader,
        "autoLoad",
      ) as boolean;
      if (!autoLoad) return;

      // Auto-loaded splats should also synchronize into the room so guests
      // see the current world model as soon as they join.
      this.load(entity, { sync: true }).catch((err) => {
        console.error(
          `[GaussianSplatLoader] Auto-load failed for entity ${entity.index}:`,
          err,
        );
      });
    });
  }


  // ----------------------------------------------------------
  // Frame Loop
  // ----------------------------------------------------------
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


  // ----------------------------------------------------------
  // Load – fetch the .spz splat (and optional collider mesh)
  // ----------------------------------------------------------
  async load(
    entity: Entity,
    options?: { animate?: boolean; sync?: boolean },
  ): Promise<void> {
    const splatUrl = entity.getValue(GaussianSplatLoader, "splatUrl") as string;
    if (!splatUrl) {
      throw new Error(
        `[GaussianSplatLoader] Entity ${entity.index} has an empty splatUrl.`,
      );
    }

    await this.loadSplatMesh(entity, {
      sourceLabel: splatUrl,
      splatMeshOptions: { url: splatUrl },
      meshUrl: entity.getValue(GaussianSplatLoader, "meshUrl") as string,
      animate: options?.animate,
      sync: options?.sync ?? false,
    });
  }

  /** Load a splat from a user-selected local file (replaces any current splat). */
  async loadFromFile(
    file: File,
    options?: { animate?: boolean; entity?: Entity; sync?: boolean },
  ): Promise<void> {
    const entity = options?.entity ?? this.hostEntity;
    if (!entity) {
      throw new Error(
        "[GaussianSplatLoader] No host entity registered for file loading.",
      );
    }

    const fileBytes = await file.arrayBuffer();
    await this.loadSplatMesh(entity, {
      sourceLabel: file.name,
      splatMeshOptions: {
        fileBytes,
        fileName: file.name,
        fileType: splatFileTypeFromName(file.name),
      },
      meshUrl: "",
      animate: options?.animate ?? true,
      sync: options?.sync ?? true,
      loadedInfo: {
        kind: "file",
        fileName: file.name,
        fileType: splatFileTypeFromName(file.name),
        fileBytes,
      },
    });
  }

  /** Load a splat received from another peer in the shared room. */
  async loadFromNetwork(
    payload:
      | { kind: "url"; splatUrl: string; label: string }
      | {
          kind: "file";
          fileName: string;
          fileType: SplatFileType;
          fileBytes: ArrayBuffer;
        },
    options?: { animate?: boolean },
  ): Promise<void> {
    const entity = this.hostEntity;
    if (!entity) {
      throw new Error(
        "[GaussianSplatLoader] No host entity registered for network loading.",
      );
    }

    if (payload.kind === "url") {
      await this.loadSplatMesh(entity, {
        sourceLabel: payload.label,
        splatMeshOptions: { url: payload.splatUrl },
        meshUrl: "",
        animate: options?.animate ?? true,
        sync: false,
        fromNetwork: true,
        loadedInfo: {
          kind: "url",
          splatUrl: payload.splatUrl,
          label: payload.label,
        },
      });
      return;
    }

    await this.loadSplatMesh(entity, {
      sourceLabel: payload.fileName,
      splatMeshOptions: {
        fileBytes: payload.fileBytes,
        fileName: payload.fileName,
        fileType: payload.fileType,
      },
      meshUrl: "",
      animate: options?.animate ?? true,
      sync: false,
      fromNetwork: true,
      loadedInfo: {
        kind: "file",
        fileName: payload.fileName,
        fileType: payload.fileType,
        fileBytes: payload.fileBytes,
      },
    });
  }

  private async loadSplatMesh(
    entity: Entity,
    {
      sourceLabel,
      splatMeshOptions,
      meshUrl,
      animate: animateOverride,
      sync = false,
      fromNetwork = false,
      loadedInfo,
    }: {
      sourceLabel: string;
      splatMeshOptions: SplatMeshLoadOptions;
      meshUrl: string;
      animate?: boolean;
      sync?: boolean;
      fromNetwork?: boolean;
      loadedInfo?: SplatLoadedInfo;
    },
  ): Promise<void> {
    const animate =
      animateOverride ??
      (entity.getValue(GaussianSplatLoader, "animate") as boolean);

    const parent = entity.object3D;
    if (!parent) {
      throw new Error(
        `[GaussianSplatLoader] Entity ${entity.index} has no object3D.`,
      );
    }

    if (this.instances.has(entity.index)) {
      await this.unload(entity, { animate: false });
    }

    const enableLod = entity.getValue(
      GaussianSplatLoader,
      "enableLod",
    ) as boolean;
    const lodSplatScale = entity.getValue(
      GaussianSplatLoader,
      "lodSplatScale",
    ) as number;

    if (this.sparkRenderer && lodSplatScale !== 1.0) {
      this.sparkRenderer.lodSplatScale = lodSplatScale;
    }

    const splat = new SplatMesh({
      ...splatMeshOptions,
      lod: enableLod || undefined,
    });
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              `[GaussianSplatLoader] Timed out loading "${sourceLabel}" after ${LOAD_TIMEOUT_MS / 1000}s`,
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
    splat.rotation.x = SPZ_COORDINATE_FIX_X;
    if (collider) collider.rotation.x = SPZ_COORDINATE_FIX_X;

    parent.add(splat);
    if (collider) parent.add(collider);

    this.instances.set(entity.index, { splat, collider, animator });
    console.log(
      `[GaussianSplatLoader] Loaded "${sourceLabel}" for entity ${entity.index}` +
        `${collider ? " (with collider)" : ""}`,
    );

    if (animate) {
      this.animating.add(entity.index);
      await animator.animateIn();
    }

    const info: SplatLoadedInfo =
      loadedInfo ??
      (splatMeshOptions.url
        ? {
            kind: "url",
            splatUrl: String(splatMeshOptions.url),
            label: sourceLabel,
          }
        : {
            kind: "file",
            fileName: String(splatMeshOptions.fileName ?? sourceLabel),
            fileType:
              splatMeshOptions.fileType ??
              splatFileTypeFromName(String(splatMeshOptions.fileName ?? "")),
            fileBytes: (splatMeshOptions.fileBytes as ArrayBuffer) ?? new ArrayBuffer(0),
          });

    this.syncedState =
      info.kind === "url"
        ? { kind: "url", splatUrl: info.splatUrl, label: info.label }
        : {
            kind: "file",
            fileName: info.fileName,
            fileType: info.fileType,
            base64: bytesToBase64(new Uint8Array(info.fileBytes)),
          };

    if (!fromNetwork && this.onSplatLoaded) {
      await this.onSplatLoaded(info, { sync });
    }
  }


  // ----------------------------------------------------------
  // Replay – restart the fly-in animation on an existing splat
  // ----------------------------------------------------------
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


  // ----------------------------------------------------------
  // Unload – remove the splat (and collider) from the scene
  // ----------------------------------------------------------
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


  // ----------------------------------------------------------
  // Cleanup – dispose GPU resources and detach from the scene
  // ----------------------------------------------------------
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
