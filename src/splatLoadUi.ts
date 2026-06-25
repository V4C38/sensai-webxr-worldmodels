import type { UIKit } from "@iwsdk/core";

const LOAD_LABEL = "Load Splat";
const LOADING_LABEL = "Loading Splat...";

let loadSplatButton: UIKit.Text | HTMLButtonElement | null = null;

export function registerLoadSplatButton(
  button: UIKit.Text | HTMLButtonElement,
): void {
  loadSplatButton = button;
}

export function setLoadSplatButtonLoading(loading: boolean): void {
  if (!loadSplatButton) return;

  if (loadSplatButton instanceof HTMLButtonElement) {
    loadSplatButton.textContent = loading ? LOADING_LABEL : LOAD_LABEL;
    loadSplatButton.disabled = loading;
    return;
  }

  loadSplatButton.setProperties({
    text: loading ? LOADING_LABEL : LOAD_LABEL,
  });
}

export { LOAD_LABEL, LOADING_LABEL };
