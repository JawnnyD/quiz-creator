export interface AppAPI {
  selectPdf: () => Promise<string | null>
}

declare global {
  interface Window {
    api: AppAPI
  }
}
