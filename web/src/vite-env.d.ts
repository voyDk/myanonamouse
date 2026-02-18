/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_NAME?: string;
  readonly VITE_BONUS_THRESHOLD?: string;
  readonly VITE_BONUS_TARGET?: string;
  readonly VITE_BONUS_CAP?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
