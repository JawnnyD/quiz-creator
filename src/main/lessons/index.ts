import { app } from 'electron'
import type { DeleteLessonResult, LessonRecord } from '../../shared/lessons'

import { initializeDatabase } from '../db'
import {
  deleteLessonWithStorage,
  importLessonPdfWithStorage,
  listLessonsFromDatabase
} from './service'

export type { DeleteLessonResult, LessonRecord } from '../../shared/lessons'
export {
  deleteLessonWithStorage,
  importLessonPdfWithStorage,
  listLessonsFromDatabase
} from './service'

export function importLessonPdf(sourcePath: string): LessonRecord {
  return importLessonPdfWithStorage(initializeDatabase(), app.getPath('userData'), sourcePath)
}

export function listLessons(): LessonRecord[] {
  return listLessonsFromDatabase(initializeDatabase())
}

export function deleteLesson(lessonId: string): DeleteLessonResult {
  return deleteLessonWithStorage(initializeDatabase(), app.getPath('userData'), lessonId)
}
