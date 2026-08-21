import { createHash, randomUUID } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'fs'
import type { DatabaseSync } from 'node:sqlite'
import { basename, extname, isAbsolute, join, parse, relative, resolve } from 'path'

import type { DeleteLessonResult, LessonRecord } from '../../shared/lessons'

const lessonPdfDirectoryName = 'lesson-pdfs'
const lessonColumns = `
  id,
  title,
  original_file_name,
  original_file_path,
  stored_relative_path,
  content_hash,
  size_bytes,
  created_at,
  updated_at
`

interface LessonRow {
  id: string
  title: string
  original_file_name: string
  original_file_path: string
  stored_relative_path: string
  content_hash: string
  size_bytes: number
  created_at: string
  updated_at: string
}

export function importLessonPdfWithStorage(
  connection: DatabaseSync,
  storageRootPath: string,
  sourcePath: string
): LessonRecord {
  const resolvedSourcePath = resolve(sourcePath)

  if (!existsSync(resolvedSourcePath)) {
    throw new Error(`Lesson PDF source does not exist: ${resolvedSourcePath}`)
  }

  const sourceStats = statSync(resolvedSourcePath)

  if (!sourceStats.isFile()) {
    throw new Error(`Lesson PDF source is not a file: ${resolvedSourcePath}`)
  }

  if (extname(resolvedSourcePath).toLowerCase() !== '.pdf') {
    throw new Error(`Lesson file must be a PDF: ${resolvedSourcePath}`)
  }

  const contentHash = hashFile(resolvedSourcePath)
  const existingLesson = findLessonByHash(connection, contentHash)

  if (existingLesson !== null) {
    return existingLesson
  }

  const storedRelativePath = `${lessonPdfDirectoryName}/${contentHash}.pdf`
  const lessonPdfDirectoryPath = join(storageRootPath, lessonPdfDirectoryName)
  const storedAbsolutePath = join(lessonPdfDirectoryPath, `${contentHash}.pdf`)

  mkdirSync(lessonPdfDirectoryPath, { recursive: true })
  copyFileSync(resolvedSourcePath, storedAbsolutePath)

  const id = randomUUID()
  connection
    .prepare(
      `
        INSERT INTO lessons (
          id,
          title,
          original_file_name,
          original_file_path,
          stored_relative_path,
          content_hash,
          size_bytes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      id,
      parse(resolvedSourcePath).name,
      basename(resolvedSourcePath),
      resolvedSourcePath,
      storedRelativePath,
      contentHash,
      sourceStats.size
    )

  const createdLesson = findLessonById(connection, id)

  if (createdLesson === null) {
    throw new Error(`Imported lesson was not found after insert: ${id}`)
  }

  return createdLesson
}

export function listLessonsFromDatabase(connection: DatabaseSync): LessonRecord[] {
  const rows = connection
    .prepare(
      `
        SELECT ${lessonColumns}
        FROM lessons
        ORDER BY created_at DESC, title ASC
      `
    )
    .all() as unknown as LessonRow[]

  return rows.map(mapLessonRow)
}

export function deleteLessonWithStorage(
  connection: DatabaseSync,
  storageRootPath: string,
  lessonId: string
): DeleteLessonResult {
  const lessonRow = findLessonRowById(connection, lessonId)

  if (lessonRow === null) {
    return {
      deleted: false,
      fileDeleted: false,
      cleanupError: null
    }
  }

  const storedAbsolutePath = getStoredLessonPdfPath(storageRootPath, lessonRow.stored_relative_path)

  connection.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId)

  if (!existsSync(storedAbsolutePath)) {
    return {
      deleted: true,
      fileDeleted: false,
      cleanupError: null
    }
  }

  try {
    unlinkSync(storedAbsolutePath)

    return {
      deleted: true,
      fileDeleted: true,
      cleanupError: null
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        deleted: true,
        fileDeleted: false,
        cleanupError: null
      }
    }

    const message = error instanceof Error ? error.message : String(error)

    return {
      deleted: true,
      fileDeleted: false,
      cleanupError: message
    }
  }
}

function findLessonByHash(connection: DatabaseSync, contentHash: string): LessonRecord | null {
  const row = connection
    .prepare(
      `
        SELECT ${lessonColumns}
        FROM lessons
        WHERE content_hash = ?
      `
    )
    .get(contentHash) as unknown as LessonRow | undefined

  return row === undefined ? null : mapLessonRow(row)
}

function findLessonById(connection: DatabaseSync, id: string): LessonRecord | null {
  const row = findLessonRowById(connection, id)

  return row === null ? null : mapLessonRow(row)
}

function findLessonRowById(connection: DatabaseSync, id: string): LessonRow | null {
  const row = connection
    .prepare(
      `
        SELECT ${lessonColumns}
        FROM lessons
        WHERE id = ?
      `
    )
    .get(id) as unknown as LessonRow | undefined

  return row === undefined ? null : row
}

function hashFile(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function getStoredLessonPdfPath(storageRootPath: string, storedRelativePath: string): string {
  const lessonPdfDirectoryPath = resolve(storageRootPath, lessonPdfDirectoryName)
  const storedAbsolutePath = resolve(storageRootPath, storedRelativePath)

  if (!isPathInside(storedAbsolutePath, lessonPdfDirectoryPath)) {
    throw new Error('Stored lesson PDF path is outside the lesson PDF directory')
  }

  return storedAbsolutePath
}

function isPathInside(childPath: string, parentPath: string): boolean {
  const relativePath = relative(parentPath, childPath)

  return relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath)
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

function mapLessonRow(row: LessonRow): LessonRecord {
  return {
    id: row.id,
    title: row.title,
    originalFileName: row.original_file_name,
    storedRelativePath: row.stored_relative_path,
    contentHash: row.content_hash,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
