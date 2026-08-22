import { app } from 'electron'
import type { DeleteLessonResult, LessonRecord } from '../../shared/lessons'

import { initializeDatabase } from '../db'
import {
  deleteLessonWithStorage,
  extractAndStoreLessonTextWithStorage,
  getLessonTextForQuizGenerationFromDatabase,
  importLessonPdfWithStorage,
  listLessonsFromDatabase,
  type LessonTextForQuizGeneration
} from './service'

export type { DeleteLessonResult, LessonRecord } from '../../shared/lessons'
export {
  deleteLessonWithStorage,
  extractAndStoreLessonTextWithStorage,
  getLessonTextForQuizGenerationFromDatabase,
  importLessonPdfWithStorage,
  listLessonsFromDatabase
} from './service'

export async function importLessonPdf(sourcePath: string): Promise<LessonRecord> {
  return importLessonPdfWithStorage(initializeDatabase(), app.getPath('userData'), sourcePath)
}

export function listLessons(): LessonRecord[] {
  return listLessonsFromDatabase(initializeDatabase())
}

export function deleteLesson(lessonId: string): DeleteLessonResult {
  return deleteLessonWithStorage(initializeDatabase(), app.getPath('userData'), lessonId)
}

export async function extractAndStoreLessonText(lessonId: string): Promise<void> {
  await extractAndStoreLessonTextWithStorage(
    initializeDatabase(),
    app.getPath('userData'),
    lessonId
  )
}

export function getLessonTextForQuizGeneration(
  lessonId: string
): LessonTextForQuizGeneration | null {
  return getLessonTextForQuizGenerationFromDatabase(initializeDatabase(), lessonId)
}
