/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket relay URL for shared rooms (required in production on Vercel). */
  readonly VITE_RELAY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
