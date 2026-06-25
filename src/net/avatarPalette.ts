/**
 * Peer colors (netblocks RemoteUserAvatar palette).
 * @see https://github.com/google/xrblocks/blob/main/src/addons/netblocks/src/core/presence/RemoteUserAvatar.ts
 */
export const AVATAR_PALETTE = [
  0xff5959, 0xffa64d, 0xffd84d, 0x5ad17a, 0x4dc3ff, 0x6a8cff, 0xb066ff, 0xff66c4,
];

export function hashStringToIndex(s: string, n: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % n;
}

export function peerColor(peerId: string): number {
  return AVATAR_PALETTE[hashStringToIndex(peerId, AVATAR_PALETTE.length)]!;
}

export function peerColorHex(peerId: string): string {
  return `#${peerColor(peerId).toString(16).padStart(6, "0")}`;
}
