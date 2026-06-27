import * as THREE from "three";

export const SKYBOX_URL = "./splats/skybox.jpg";

/**
 * Set an equirectangular 360° image as the scene background.
 */
export function applyEquirectSkybox(
  scene: THREE.Scene,
  url: string = SKYBOX_URL,
): void {
  new THREE.TextureLoader().load(
    url,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.mapping = THREE.EquirectangularReflectionMapping;
      scene.background = texture;
    },
    undefined,
    (err) => {
      console.error("[Skybox] Failed to load skybox:", err);
      scene.background = new THREE.Color(0xbaabab);
    },
  );
}
