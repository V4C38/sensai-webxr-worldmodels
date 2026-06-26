import * as THREE from "three";

export const SKYBOX_URL = "./splats/skybox.jpg";

let objectUrl: string | null = null;

function disposeBackgroundTexture(scene: THREE.Scene): void {
  const bg = scene.background;
  if (bg instanceof THREE.Texture) {
    bg.dispose();
  }
}

function revokeObjectUrl(): void {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

function applyTexture(scene: THREE.Scene, texture: THREE.Texture): void {
  disposeBackgroundTexture(scene);
  revokeObjectUrl();
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = texture;
}

function loadTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(url, resolve, undefined, reject);
  });
}

/**
 * Set an equirectangular 360° image as the scene background from a URL path.
 */
export async function applyEquirectSkybox(
  scene: THREE.Scene,
  url: string = SKYBOX_URL,
): Promise<void> {
  try {
    const texture = await loadTexture(url);
    applyTexture(scene, texture);
  } catch (err) {
    console.error("[Skybox] Failed to load skybox:", err);
    disposeBackgroundTexture(scene);
    revokeObjectUrl();
    scene.background = new THREE.Color(0xbaabab);
    throw err;
  }
}

/** Apply a local JPEG file as the 360° skybox. */
export async function applyEquirectSkyboxFromFile(
  scene: THREE.Scene,
  file: File,
): Promise<void> {
  const url = URL.createObjectURL(file);
  try {
    const texture = await loadTexture(url);
    applyTexture(scene, texture);
    objectUrl = url;
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/** Apply skybox from raw JPEG bytes (network peers). */
export async function applyEquirectSkyboxFromBytes(
  scene: THREE.Scene,
  bytes: Uint8Array,
): Promise<void> {
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
  try {
    const texture = await loadTexture(url);
    applyTexture(scene, texture);
    objectUrl = url;
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

let skyboxSyncHandler: ((file: File) => void | Promise<void>) | null = null;

export function setSkyboxSyncHandler(
  handler: ((file: File) => void | Promise<void>) | null,
): void {
  skyboxSyncHandler = handler;
}

export async function pickAndApplySkybox(scene: THREE.Scene): Promise<void> {
  const file = await pickJpegFile();
  if (!file) return;

  await applyEquirectSkyboxFromFile(scene, file);
  await skyboxSyncHandler?.(file);
}

function pickJpegFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".jpg,.jpeg,image/jpeg";
    input.addEventListener("change", () => {
      resolve(input.files?.[0] ?? null);
    });
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

let loadSkyboxButton: HTMLButtonElement | null = null;
const LOAD_LABEL = "Load Skybox";
const LOADING_LABEL = "Loading Skybox...";

export function registerLoadSkyboxButton(button: HTMLButtonElement): void {
  loadSkyboxButton = button;
}

export function setLoadSkyboxButtonLoading(loading: boolean): void {
  if (!loadSkyboxButton) return;
  loadSkyboxButton.textContent = loading ? LOADING_LABEL : LOAD_LABEL;
  loadSkyboxButton.disabled = loading;
}
