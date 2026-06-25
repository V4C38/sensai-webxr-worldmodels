import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

export const USER_AVATAR_URL = "./splats/user.glb";
const TARGET_HEIGHT = 1.65;
/** Applied on top of height-fit scale (10% of full human height). */
const AVATAR_SIZE_SCALE = 0.1;

export interface PreparedUserAvatar {
  clone(): THREE.Object3D;
}

let prepared: PreparedUserAvatar | null = null;
let loadPromise: Promise<PreparedUserAvatar> | null = null;

function prepareScene(source: THREE.Object3D): PreparedUserAvatar {
  const template = source.clone(true);
  template.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(template);
  const size = box.getSize(new THREE.Vector3());
  const height = size.y > 0.001 ? size.y : 1;
  const scale = (TARGET_HEIGHT / height) * AVATAR_SIZE_SCALE;
  template.scale.setScalar(scale);
  template.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(template);
  // Place group origin at approximate head height (~92% up the bbox).
  const headY = scaledBox.min.y + (scaledBox.max.y - scaledBox.min.y) * 0.92;
  template.position.y = -headY;

  return {
    clone() {
      return cloneSkinned(template);
    },
  };
}

export function loadUserAvatarTemplate(): Promise<PreparedUserAvatar> {
  if (prepared) return Promise.resolve(prepared);
  if (!loadPromise) {
    loadPromise = new GLTFLoader()
      .loadAsync(USER_AVATAR_URL)
      .then((gltf) => {
        prepared = prepareScene(gltf.scene);
        return prepared;
      })
      .catch((err) => {
        loadPromise = null;
        throw err;
      });
  }
  return loadPromise;
}

export function tintAvatarModel(root: THREE.Object3D, color: number): void {
  const c = new THREE.Color(color);
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of materials) {
      if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial) {
        mat.color.lerp(c, 0.35);
      } else if (mat instanceof THREE.MeshBasicMaterial || mat instanceof THREE.MeshLambertMaterial) {
        mat.color.lerp(c, 0.35);
      }
    }
  });
}
