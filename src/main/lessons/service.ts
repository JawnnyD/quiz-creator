import { createHash, randomUUID } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'fs'
import type { DatabaseSync } from 'node:sqlite'
import { basename, extname, isAbsolute, join, parse, relative, resolve } from 'path'

import type { DeleteLessonResult, LessonRecord, TextExtractionStatus } from '../../shared/lessons'
import { extractPdfText, type ExtractedPdfText } from './textExtraction'

const lessonPdfDirectoryName = 'lesson-pdfs'
const lessonColumns = `
  lessons.id,
  lessons.title,
  lessons.original_file_name,
  lessons.original_file_path,
  lessons.stored_relative_path,
  lessons.content_hash,
  lessons.size_bytes,
  lessons.created_at,
  lessons.updated_at,
  lesson_text_extractions.status AS text_extraction_status,
  lesson_text_extractions.page_count AS text_page_count,
  lesson_text_extractions.character_count AS text_character_count,
  lesson_text_extractions.error_message AS text_extraction_error
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
  text_extraction_status: TextExtractionStatus | null
  text_page_count: number | null
  text_character_count: number | null
  text_extraction_error: string | null
}

export interface LessonTextPage {
  pageNumber: number
  text: string
  characterCount: number
}

export interface LessonTextForQuizGeneration {
  lessonId: string
  fullText: string
  pageCount: number
  characterCount: number
  pages: LessonTextPage[]
}

interface LessonTextExtractionRow {
  lesson_id: string
  full_text: string
  page_count: number
  character_count: number
}

interface LessonTextPageRow {
  page_number: number
  text: string
  character_count: number
}

export async function importLessonPdfWithStorage(
  connection: DatabaseSync,
  storageRootPath: string,
  sourcePath: string
): Promise<LessonRecord> {
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
    await ensureLessonTextExtracted(connection, storageRootPath, existingLesson)
    return findLessonById(connection, existingLesson.id) ?? existingLesson
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

  await ensureLessonTextExtracted(connection, storageRootPath, id)

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
        LEFT JOIN lesson_text_extractions ON lesson_text_extractions.lesson_id = lessons.id
        ORDER BY lessons.created_at DESC, lessons.title ASC
      `
    )
    .all() as unknown as LessonRow[]

  return rows.map(mapLessonRow)
}

export function updateLessonTitleFromDatabase(
  connection: DatabaseSync,
  lessonId: string,
  title: string
): LessonRecord {
  const normalizedLessonId = lessonId.trim()
  const normalizedTitle = title.trim()

  if (normalizedLessonId.length === 0) {
    throw new Error('Lesson id is required to update a lesson title')
  }

  if (normalizedTitle.length === 0) {
    throw new Error('Lesson title is required')
  }

  if (findLessonById(connection, normalizedLessonId) === null) {
    throw new Error(`Lesson was not found for title update: ${normalizedLessonId}`)
  }

  connection
    .prepare(
      `
        UPDATE lessons
        SET title = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    )
    .run(normalizedTitle, normalizedLessonId)

  const updatedLesson = findLessonById(connection, normalizedLessonId)

  if (updatedLesson === null) {
    throw new Error(`Updated lesson was not found after title update: ${normalizedLessonId}`)
  }

  return updatedLesson
}

export async function extractAndStoreLessonTextWithStorage(
  connection: DatabaseSync,
  storageRootPath: string,
  lessonId: string
): Promise<void> {
  const lessonRow = findLessonRowById(connection, lessonId)

  if (lessonRow === null) {
    throw new Error(`Lesson was not found for text extraction: ${lessonId}`)
  }

  try {
    const storedAbsolutePath = getStoredLessonPdfPath(
      storageRootPath,
      lessonRow.stored_relative_path
    )
    const extractedText = await extractPdfText(storedAbsolutePath)

    saveCompletedTextExtraction(connection, lessonId, extractedText)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    saveFailedTextExtraction(connection, lessonId, message)
  }
}

export function getLessonTextForQuizGenerationFromDatabase(
  connection: DatabaseSync,
  lessonId: string
): LessonTextForQuizGeneration | null {
  const extractionRow = connection
    .prepare(
      `
        SELECT lesson_id, full_text, page_count, character_count
        FROM lesson_text_extractions
        WHERE lesson_id = ? AND status = 'completed'
      `
    )
    .get(lessonId) as unknown as LessonTextExtractionRow | undefined

  if (extractionRow === undefined) {
    return null
  }

  const pageRows = connection
    .prepare(
      `
        SELECT page_number, text, character_count
        FROM lesson_text_pages
        WHERE lesson_id = ?
        ORDER BY page_number ASC
      `
    )
    .all(lessonId) as unknown as LessonTextPageRow[]

  return {
    lessonId: extractionRow.lesson_id,
    fullText: extractionRow.full_text,
    pageCount: extractionRow.page_count,
    characterCount: extractionRow.character_count,
    pages: pageRows.map((pageRow) => ({
      pageNumber: pageRow.page_number,
      text: pageRow.text,
      characterCount: pageRow.character_count
    }))
  }
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
        LEFT JOIN lesson_text_extractions ON lesson_text_extractions.lesson_id = lessons.id
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
        LEFT JOIN lesson_text_extractions ON lesson_text_extractions.lesson_id = lessons.id
        WHERE id = ?
      `
    )
    .get(id) as unknown as LessonRow | undefined

  return row === undefined ? null : row
}

function hashFile(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

async function ensureLessonTextExtracted(
  connection: DatabaseSync,
  storageRootPath: string,
  lesson: LessonRecord | string
): Promise<void> {
  const lessonId = typeof lesson === 'string' ? lesson : lesson.id
  const status =
    typeof lesson === 'string'
      ? getLessonTextExtractionStatus(connection, lesson)
      : lesson.textExtractionStatus

  if (status === 'completed') {
    return
  }

  await extractAndStoreLessonTextWithStorage(connection, storageRootPath, lessonId)
}

function getLessonTextExtractionStatus(
  connection: DatabaseSync,
  lessonId: string
): TextExtractionStatus {
  const row = connection
    .prepare('SELECT status FROM lesson_text_extractions WHERE lesson_id = ?')
    .get(lessonId) as unknown as { status: TextExtractionStatus } | undefined

  return row?.status ?? 'not_started'
}

function saveCompletedTextExtraction(
  connection: DatabaseSync,
  lessonId: string,
  extractedText: ExtractedPdfText
): void {
  try {
    connection.exec('BEGIN IMMEDIATE')
    connection.prepare('DELETE FROM lesson_text_pages WHERE lesson_id = ?').run(lessonId)
    connection
      .prepare(
        `
          INSERT INTO lesson_text_extractions (
            lesson_id,
            status,
            full_text,
            page_count,
            character_count,
            extractor_name,
            extractor_version,
            error_message
          )
          VALUES (?, 'completed', ?, ?, ?, ?, ?, NULL)
          ON CONFLICT(lesson_id) DO UPDATE SET
            status = excluded.status,
            full_text = excluded.full_text,
            page_count = excluded.page_count,
            character_count = excluded.character_count,
            extractor_name = excluded.extractor_name,
            extractor_version = excluded.extractor_version,
            error_message = NULL,
            updated_at = CURRENT_TIMESTAMP
        `
      )
      .run(
        lessonId,
        extractedText.fullText,
        extractedText.pageCount,
        extractedText.characterCount,
        extractedText.extractorName,
        extractedText.extractorVersion
      )

    const insertPage = connection.prepare(
      `
        INSERT INTO lesson_text_pages (lesson_id, page_number, text, character_count)
        VALUES (?, ?, ?, ?)
      `
    )

    for (const page of extractedText.pages) {
      insertPage.run(lessonId, page.pageNumber, page.text, page.characterCount)
    }

    connection.exec('COMMIT')
  } catch (error) {
    rollbackTransaction(connection)
    throw error
  }
}

function saveFailedTextExtraction(
  connection: DatabaseSync,
  lessonId: string,
  errorMessage: string
): void {
  try {
    connection.exec('BEGIN IMMEDIATE')
    connection.prepare('DELETE FROM lesson_text_pages WHERE lesson_id = ?').run(lessonId)
    connection
      .prepare(
        `
          INSERT INTO lesson_text_extractions (
            lesson_id,
            status,
            full_text,
            page_count,
            character_count,
            extractor_name,
            extractor_version,
            error_message
          )
          VALUES (?, 'failed', '', 0, 0, 'pdfjs-dist', 'unknown', ?)
          ON CONFLICT(lesson_id) DO UPDATE SET
            status = excluded.status,
            full_text = excluded.full_text,
            page_count = excluded.page_count,
            character_count = excluded.character_count,
            extractor_name = excluded.extractor_name,
            extractor_version = excluded.extractor_version,
            error_message = excluded.error_message,
            updated_at = CURRENT_TIMESTAMP
        `
      )
      .run(lessonId, errorMessage)
    connection.exec('COMMIT')
  } catch (error) {
    rollbackTransaction(connection)
    throw error
  }
}

function rollbackTransaction(connection: DatabaseSync): void {
  try {
    connection.exec('ROLLBACK')
  } catch {
    // Preserve the original transaction error.
  }
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
    textExtractionStatus: row.text_extraction_status ?? 'not_started',
    textPageCount: row.text_page_count ?? 0,
    textCharacterCount: row.text_character_count ?? 0,
    textExtractionError: row.text_extraction_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
