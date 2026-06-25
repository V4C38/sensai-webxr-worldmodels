export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Max base64 characters per splat file chunk in RPC payloads.
 * WebSocket relay wraps each RPC in another base64 layer (~4/3 size), so keep
 * chunks well under the relay frame limit.
 */
export const CHUNK_CHARS = 32 * 1024;

export function chunkBase64(base64: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < base64.length; i += CHUNK_CHARS) {
    chunks.push(base64.slice(i, i + CHUNK_CHARS));
  }
  return chunks;
}
