import type { World } from "@iwsdk/core";
import {
  SessionMode,
  buildSessionInit,
  normalizeReferenceSpec,
  resolveReferenceSpaceType,
} from "@iwsdk/core";

type XrFeatureOverrides = {
  handTracking?: boolean;
  layers?: boolean;
};

type LaunchAttempt = {
  sessionMode?: SessionMode;
  features?: XrFeatureOverrides;
};

/**
 * Request an immersive session with fallbacks for runtimes that reject
 * hand-tracking, layers, or immersive-vr (common on desktop + Virtual Desktop).
 */
export async function enterXR(world: World): Promise<void> {
  if (world.session) return;

  const xr = navigator.xr;
  if (!xr?.requestSession) {
    throw new Error("WebXR is not available in this browser.");
  }

  const defaults = world.xrDefaults ?? {
    sessionMode: SessionMode.ImmersiveVR,
  };

  const attempts: LaunchAttempt[] = [
    {},
    { features: { handTracking: false, layers: false } },
    { sessionMode: SessionMode.ImmersiveAR, features: { handTracking: false, layers: false } },
  ];

  let lastError: unknown;

  for (const attempt of attempts) {
    const sessionMode = attempt.sessionMode ?? defaults.sessionMode ?? SessionMode.ImmersiveVR;
    const features = {
      ...(defaults.features as XrFeatureOverrides | undefined),
      ...attempt.features,
    };

    try {
      const supported = await xr.isSessionSupported(sessionMode);
      if (!supported) continue;

      const sessionInit = buildSessionInit({
        sessionMode,
        referenceSpace: defaults.referenceSpace,
        features,
      });

      const session = await xr.requestSession(sessionMode, sessionInit);
      const refSpec = normalizeReferenceSpec(defaults.referenceSpace);

      try {
        const resolvedType = await resolveReferenceSpaceType(
          session,
          refSpec.type,
          refSpec.required ? [] : refSpec.fallbackOrder,
        );
        world.renderer.xr.setReferenceSpaceType(resolvedType);
        await world.renderer.xr.setSession(session);
        world.session = session;

        session.addEventListener("end", () => {
          if (world.session === session) {
            world.session = undefined;
          }
        });

        return;
      } catch (err) {
        lastError = err;
        try {
          await session.end();
        } catch {
          // ignore
        }
      }
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("No compatible WebXR session configuration was found.");
}
