/// <reference types="vite/client" />

export {}

declare global {
  interface Window {
    api: {
      selectPdf: () => Promise<string | null>
    }
  }
}
