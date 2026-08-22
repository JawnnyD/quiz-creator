export type TextExtractionStatus = 'not_started' | 'completed' | 'failed'

export interface LessonRecord {
  id: string
  title: string
  originalFileName: string
  storedRelativePath: string
  contentHash: string
  sizeBytes: number
  textExtractionStatus: TextExtractionStatus
  textPageCount: number
  textCharacterCount: number
  textExtractionError: string | null
  createdAt: string
  updatedAt: string
}

export interface DeleteLessonResult {
  deleted: boolean
  fileDeleted: boolean
  cleanupError: string | null
}
