/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string
  readonly VITE_FIREBASE_AUTH_DOMAIN: string
  readonly VITE_FIREBASE_PROJECT_ID: string
  readonly VITE_FIREBASE_STORAGE_BUCKET: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string
  readonly VITE_FIREBASE_APP_ID: string
  readonly VITE_GEMINI_API_KEY?: string
  /** OpenAI-compatible API for AI Arrange / AI Compose (default: Groq). */
  readonly VITE_MUSIC_AI_API_KEY?: string
  readonly VITE_MUSIC_AI_BASE_URL?: string
  readonly VITE_MUSIC_AI_MODEL?: string
  readonly VITE_SCANNING_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
