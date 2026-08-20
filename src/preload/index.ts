import { contextBridge, ipcRenderer } from 'electron'

const api = {
  selectPdf: (): Promise<string | null> => ipcRenderer.invoke('pdf:select')
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  const globalWindow = window as Window & typeof globalThis & { api: typeof api }

  globalWindow.api = api
}
