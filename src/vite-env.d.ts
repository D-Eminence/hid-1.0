/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly HID?: string
  readonly HID_TURNSTILE_SITE_KEY?: string
  readonly TURNSTILE_SITE_KEY?: string
  readonly VITE_TURNSTILE_SITE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
