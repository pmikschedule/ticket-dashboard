/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** 빌드 시점에 박아 넣는 값 (vite.config.ts 의 define). */
declare const __BUILD_ID__: string
declare const __BUILT_AT__: string
