import type { DeleteLessonResult, LessonRecord } from '../shared/lessons'

export interface AppAPI {
  importLessonPdf: () => Promise<LessonRecord | null>
  listLessons: () => Promise<LessonRecord[]>
  deleteLesson: (id: string) => Promise<DeleteLessonResult>
}

declare global {
  interface Window {
    api: AppAPI
  }
}
