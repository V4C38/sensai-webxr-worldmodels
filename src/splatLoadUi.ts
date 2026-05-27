import type { UIKit } from "@iwsdk/core";

const LOAD_LABEL = "Load Splat";
const LOADING_LABEL = "Loading Splat...";

let loadSplatButton: UIKit.Text | null = null;

export function registerLoadSplatButton(button: UIKit.Text): void {
  loadSplatButton = button;
}

export function setLoadSplatButtonLoading(loading: boolean): void {
  loadSplatButton?.setProperties({
    text: loading ? LOADING_LABEL : LOAD_LABEL,
  });
}

export { LOAD_LABEL, LOADING_LABEL };
