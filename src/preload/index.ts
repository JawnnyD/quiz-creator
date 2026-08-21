import { contextBridge, ipcRenderer } from 'electron'
import type { DeleteLessonResult, LessonRecord } from '../shared/lessons'

const api = {
  importLessonPdf: (): Promise<LessonRecord | null> => ipcRenderer.invoke('lessons:importPdf'),
  listLessons: (): Promise<LessonRecord[]> => ipcRenderer.invoke('lessons:list'),
  deleteLesson: (id: string): Promise<DeleteLessonResult> =>
    ipcRenderer.invoke('lessons:delete', id)
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
