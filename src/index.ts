
import * as THREE from "three";
import {
  EnvironmentType,
  Interactable,
  LocomotionEnvironment,
  Mesh,
  MeshBasicMaterial,
  PanelUI,
  PlaneGeometry,
  ScreenSpace,
  SessionMode,
  VisibilityState,
  World,
} from "@iwsdk/core";
import { DesktopControlsSystem } from "./desktopControls.js";
import { PanelSystem } from "./uiPanel.js";
import { GaussianSplatLoader, GaussianSplatLoaderSystem,} from "./gaussianSplatLoader.js";
import { mountRoomHud, MultiplayerSystem } from "./multiplayerSystem.js";
mountRoomHud();


// ------------------------------------------------------------
// World (IWSDK settings)
// ------------------------------------------------------------
World.create(document.getElementById("scene-container") as HTMLDivElement, {
  assets: {},
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    // Avoid auto-offer; Enter XR uses enterXR() with runtime fallbacks.
    offer: "none",
    // layers / hand-tracking break some desktop + Virtual Desktop runtimes.
    features: { handTracking: false, layers: false },
  },
  render: {
    defaultLighting: false,
  },
  features: {
    locomotion: true,
    grabbing: true,
    physics: false,
    sceneUnderstanding: false,
  },
})
  .then((world) => {
    world.camera.position.set(0, 1.5, 0);
    world.scene.background = new THREE.Color(0xffffff);
    world.scene.add(new THREE.AmbientLight(0xffffff, 1.0));

    world
      .registerSystem(PanelSystem)
      .registerSystem(GaussianSplatLoaderSystem)
      .registerSystem(DesktopControlsSystem)
      .registerSystem(MultiplayerSystem);

    // ------------------------------------------------------------
    // Gaussian Splat
    // ------------------------------------------------------------
    const splatEntity = world.createTransformEntity();
    splatEntity.addComponent(GaussianSplatLoader);

    const splatSystem = world.getSystem(GaussianSplatLoaderSystem)!;
    splatSystem.setHostEntity(splatEntity);

    // Play splat animation when entering XR
    world.visibilityState.subscribe((state) => {
      if (state !== VisibilityState.NonImmersive) {
        splatSystem.replayAnimation(splatEntity).catch((err) => {
          console.error("[World] Failed to replay splat animation:", err);
        });
      }
    });


    // ------------------------------------------------------------
    // Invisible floor for locomotion (must be a Mesh for IWSDK raycasting)
    // ------------------------------------------------------------
    const floorGeometry = new PlaneGeometry(100, 100);
    floorGeometry.rotateX(-Math.PI / 2);
    const floor = new Mesh(floorGeometry, new MeshBasicMaterial());
    floor.visible = false;
    const floorEntity = world.createTransformEntity(floor);
    // Locomotion system can initialize a tick later on startup.
    requestAnimationFrame(() => {
      floorEntity.addComponent(LocomotionEnvironment, {
        type: EnvironmentType.STATIC,
      });
    });

    // ------------------------------------------------------------
    // Hologram Sphere (distance-grabbable, translate in place)
    // ------------------------------------------------------------
    // spawnHologramSphere(world);


    // ------------------------------------------------------------
    // Panel UI (top-right on desktop, world-space in XR)
    // ------------------------------------------------------------
    const panelEntity = world
      .createTransformEntity()
      .addComponent(PanelUI, {
        config: "./ui/sensai.json",
        maxHeight: 0.45,
        maxWidth: 0.35,
      })
      .addComponent(Interactable)
      .addComponent(ScreenSpace, {
        top: "12px",
        right: "12px",
        width: "220px",
        height: "auto",
        zOffset: 0.25,
      });
    panelEntity.object3D!.position.set(0, 1.29, -1.9);

  })
  .catch((err) => {
    console.error("[World] Failed to create the IWSDK world:", err);
    const container = document.getElementById("scene-container");
  });

  
