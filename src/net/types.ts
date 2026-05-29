/** Text chat RPC payload (netblocks `chat-message` topic). */
export interface ChatMessagePayload {
  from: string;
  fromId: string;
  text: string;
  ts: number;
}

/** Display name announced on join. */
export interface DisplayNamePayload {
  name: string;
}

/** WebRTC signaling over the room RPC bus (netblocks `voice` messages). */
export type VoiceSignalPayload =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "ice"; candidate: RTCIceCandidateInit };

export const CHAT_TOPIC = "chat-message";
export const DISPLAY_NAME_TOPIC = "display-name";
export const VOICE_SIGNAL_TOPIC = "voice-signal";
