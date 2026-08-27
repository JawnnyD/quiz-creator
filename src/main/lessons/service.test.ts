import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import type { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabaseConnection } from '../db/connection'
import {
  deleteLessonWithStorage,
  importLessonPdfWithStorage,
  listLessonsFromDatabase,
  updateLessonTitleFromDatabase
} from './service'

const extractPdfTextMock = vi.hoisted(() => vi.fn())

vi.mock('./textExtraction', () => ({
  extractPdfText: extractPdfTextMock
}))

let connection: DatabaseSync
let tempRootPath: string
let storageRootPath: string

describe('lesson PDF import and editing', () => {
  beforeEach(() => {
    extractPdfTextMock.mockReset()
    connection = createDatabaseConnection(':memory:')
    tempRootPath = mkdtempSync(join(tmpdir(), 'quiz-creator-lessons-'))
    storageRootPath = join(tempRootPath, 'storage')
  })

  afterEach(() => {
    connection.close()
    rmSync(tempRootPath, { recursive: true, force: true })
  })

  it('imports a PDF, stores a copy, and records extracted text', async () => {
    const extractedText = createExtractedPdfText([
      'Cardiac output equals stroke volume times heart rate.',
      'The left ventricle pumps oxygenated blood into the aorta.'
    ])
    const sourcePath = writePdfFixture('cardiac physiology.pdf', 'first pdf bytes')
    extractPdfTextMock.mockResolvedValue(extractedText)

    const lesson = await importLessonPdfWithStorage(connection, storageRootPath, sourcePath)

    expect(lesson).toMatchObject({
      title: 'cardiac physiology',
      originalFileName: 'cardiac physiology.pdf',
      sizeBytes: 15,
      textExtractionStatus: 'completed',
      textPageCount: 2,
      textCharacterCount: extractedText.characterCount,
      textExtractionError: null
    })
    expect(existsSync(join(storageRootPath, lesson.storedRelativePath))).toBe(true)
    expect(extractPdfTextMock).toHaveBeenCalledWith(
      join(storageRootPath, lesson.storedRelativePath)
    )
    expect(listLessonsFromDatabase(connection)).toEqual([lesson])
    expect(countRows('lessons')).toBe(1)
    expect(countRows('lesson_text_extractions')).toBe(1)
    expect(countRows('lesson_text_pages')).toBe(2)
  })

  it('returns the existing lesson when importing a duplicate PDF', async () => {
    const sourcePath = writePdfFixture('cardiology.pdf', 'same pdf bytes')
    const duplicateSourcePath = writePdfFixture('renamed duplicate.pdf', 'same pdf bytes')
    extractPdfTextMock.mockResolvedValue(createExtractedPdfText(['Shared PDF text.']))

    const firstImport = await importLessonPdfWithStorage(connection, storageRootPath, sourcePath)
    const duplicateImport = await importLessonPdfWithStorage(
      connection,
      storageRootPath,
      duplicateSourcePath
    )

    expect(duplicateImport).toEqual(firstImport)
    expect(listLessonsFromDatabase(connection)).toEqual([firstImport])
    expect(countRows('lessons')).toBe(1)
    expect(countRows('lesson_text_extractions')).toBe(1)
    expect(countRows('lesson_text_pages')).toBe(1)
    expect(extractPdfTextMock).toHaveBeenCalledTimes(1)
  })

  it('deletes a lesson and removes the stored PDF copy', async () => {
    const sourcePath = writePdfFixture('renal physiology.pdf', 'renal pdf bytes')
    extractPdfTextMock.mockResolvedValue(createExtractedPdfText(['Renal physiology text.']))
    const lesson = await importLessonPdfWithStorage(connection, storageRootPath, sourcePath)
    const storedPdfPath = join(storageRootPath, lesson.storedRelativePath)

    expect(existsSync(storedPdfPath)).toBe(true)
    expect(deleteLessonWithStorage(connection, storageRootPath, lesson.id)).toEqual({
      deleted: true,
      fileDeleted: true,
      cleanupError: null
    })
    expect(existsSync(storedPdfPath)).toBe(false)
    expect(listLessonsFromDatabase(connection)).toEqual([])
    expect(countRows('lessons')).toBe(0)
    expect(countRows('lesson_text_extractions')).toBe(0)
    expect(countRows('lesson_text_pages')).toBe(0)
    expect(deleteLessonWithStorage(connection, storageRootPath, lesson.id)).toEqual({
      deleted: false,
      fileDeleted: false,
      cleanupError: null
    })
  })

  it('edits a lesson title and trims user input', async () => {
    const sourcePath = writePdfFixture('microbiology.pdf', 'micro pdf bytes')
    extractPdfTextMock.mockResolvedValue(createExtractedPdfText(['Microbiology text.']))
    const lesson = await importLessonPdfWithStorage(connection, storageRootPath, sourcePath)

    const updatedLesson = updateLessonTitleFromDatabase(
      connection,
      lesson.id,
      '  Gram Positive Review  '
    )

    expect(updatedLesson).toMatchObject({
      id: lesson.id,
      title: 'Gram Positive Review',
      originalFileName: lesson.originalFileName
    })
    expect(listLessonsFromDatabase(connection)[0]?.title).toBe('Gram Positive Review')
  })
})

function writePdfFixture(fileName: string, contents: string): string {
  const filePath = join(tempRootPath, fileName)

  writeFileSync(filePath, contents)

  return filePath
}

function createExtractedPdfText(pageTexts: string[]): {
  fullText: string
  pageCount: number
  characterCount: number
  extractorName: string
  extractorVersion: string
  pages: Array<{ pageNumber: number; text: string; characterCount: number }>
} {
  const fullText = pageTexts.join('\n')

  return {
    fullText,
    pageCount: pageTexts.length,
    characterCount: fullText.length,
    extractorName: 'test-extractor',
    extractorVersion: '1',
    pages: pageTexts.map((text, index) => ({
      pageNumber: index + 1,
      text,
      characterCount: text.length
    }))
  }
}

function countRows(tableName: string): number {
  const row = connection.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as
    { count: number } | undefined

  return row?.count ?? 0
}
