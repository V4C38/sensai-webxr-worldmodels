const BACKEND = "https://louvre-xr-backend-production.up.railway.app";

export async function playSophieWelcome(exhibit?: string): Promise<void> {
  try {
    const body: Record<string, unknown> = { voice: true };
    if (exhibit) body.exhibit = exhibit;

    const resp = await fetch(`${BACKEND}/session/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return;

    const { audio_url } = await resp.json() as { audio_url?: string };
    if (audio_url) new Audio(audio_url).play();
  } catch {
    // fail silently — audio is best-effort
  }
}
