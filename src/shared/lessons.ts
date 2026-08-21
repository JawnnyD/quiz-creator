export interface LessonRecord {
  id: string
  title: string
  originalFileName: string
  storedRelativePath: string
  contentHash: string
  sizeBytes: number
  createdAt: string
  updatedAt: string
}

export interface DeleteLessonResult {
  deleted: boolean
  fileDeleted: boolean
  cleanupError: string | null
}
