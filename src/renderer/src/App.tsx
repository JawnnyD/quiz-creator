import { useEffect, useMemo, useState, type JSX } from 'react'
import type { LessonRecord } from '../../shared/lessons'

function App(): JSX.Element {
  const [lessons, setLessons] = useState<LessonRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isImporting, setIsImporting] = useState(false)
  const [deletingLessonIds, setDeletingLessonIds] = useState<Set<string>>(() => new Set())
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let isCanceled = false

    async function loadLessons(): Promise<void> {
      try {
        const loadedLessons = await window.api.listLessons()

        if (!isCanceled) {
          setLessons(loadedLessons)
        }
      } catch (error) {
        if (!isCanceled) {
          setErrorMessage(getErrorMessage(error))
        }
      } finally {
        if (!isCanceled) {
          setIsLoading(false)
        }
      }
    }

    void loadLessons()

    return () => {
      isCanceled = true
    }
  }, [])

  const lessonSummary = useMemo(() => {
    if (isLoading) {
      return 'Loading saved lessons'
    }

    if (lessons.length === 0) {
      return 'No lesson PDFs imported yet'
    }

    return `${lessons.length} lesson PDF${lessons.length === 1 ? '' : 's'} imported`
  }, [isLoading, lessons.length])

  const openPdfPicker = async (): Promise<void> => {
    setIsImporting(true)
    setStatusMessage(null)
    setErrorMessage(null)

    try {
      const importedLesson = await window.api.importLessonPdf()

      if (importedLesson === null) {
        return
      }

      const wasAlreadyImported = lessons.some((lesson) => lesson.id === importedLesson.id)

      setLessons((currentLessons) => upsertLesson(currentLessons, importedLesson))

      if (importedLesson.textExtractionStatus === 'failed') {
        setErrorMessage(
          `${wasAlreadyImported ? 'Loaded' : 'Imported'} "${importedLesson.title}", but text extraction failed: ${importedLesson.textExtractionError ?? 'Unknown error'}`
        )
      } else if (
        importedLesson.textExtractionStatus === 'completed' &&
        importedLesson.textCharacterCount === 0
      ) {
        setStatusMessage(
          `${wasAlreadyImported ? 'Loaded' : 'Imported'} "${importedLesson.title}", but no selectable text was found.`
        )
      } else {
        setStatusMessage(
          wasAlreadyImported
            ? `"${importedLesson.title}" was already imported.`
            : `Imported "${importedLesson.title}".`
        )
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setIsImporting(false)
    }
  }

  const deleteLesson = async (lesson: LessonRecord): Promise<void> => {
    const confirmed = window.confirm(
      `Delete "${lesson.title}"?\n\nThis removes the lesson and the imported PDF copy.`
    )

    if (!confirmed) {
      return
    }

    setStatusMessage(null)
    setErrorMessage(null)
    setLessonDeleting(lesson.id, true)

    try {
      const result = await window.api.deleteLesson(lesson.id)

      setLessons((currentLessons) =>
        currentLessons.filter((currentLesson) => currentLesson.id !== lesson.id)
      )

      if (!result.deleted) {
        setStatusMessage(`"${lesson.title}" was already deleted.`)
        return
      }

      if (result.cleanupError !== null) {
        setErrorMessage(
          `Deleted "${lesson.title}", but the copied PDF could not be removed: ${result.cleanupError}`
        )
        return
      }

      setStatusMessage(`Deleted "${lesson.title}".`)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setLessonDeleting(lesson.id, false)
    }
  }

  const setLessonDeleting = (lessonId: string, isDeleting: boolean): void => {
    setDeletingLessonIds((currentLessonIds) => {
      const nextLessonIds = new Set(currentLessonIds)

      if (isDeleting) {
        nextLessonIds.add(lessonId)
      } else {
        nextLessonIds.delete(lessonId)
      }

      return nextLessonIds
    })
  }

  return (
    <main className="app">
      <section className="lesson-workspace" aria-labelledby="lessons-heading">
        <header className="lesson-header">
          <div>
            <h1 id="lessons-heading">Lessons</h1>
            <p>{lessonSummary}</p>
          </div>
          <button
            className="upload-button"
            type="button"
            onClick={openPdfPicker}
            disabled={isImporting}
          >
            {isImporting ? 'Importing...' : 'Upload PDF'}
          </button>
        </header>

        {errorMessage !== null ? (
          <p className="status-message status-message-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        {statusMessage !== null ? <p className="status-message">{statusMessage}</p> : null}

        {isLoading ? (
          <p className="empty-state">Loading lessons...</p>
        ) : lessons.length === 0 ? (
          <p className="empty-state">Import a PDF to create your first lesson.</p>
        ) : (
          <ul className="lesson-list" aria-label="Imported lessons">
            {lessons.map((lesson) => (
              <li className="lesson-item" key={lesson.id}>
                <div className="lesson-title-group">
                  <h2>{lesson.title}</h2>
                  <p>{lesson.originalFileName}</p>
                </div>
                <div className="lesson-actions">
                  <dl className="lesson-metadata">
                    <div>
                      <dt>Size</dt>
                      <dd>{formatFileSize(lesson.sizeBytes)}</dd>
                    </div>
                    <div>
                      <dt>Imported</dt>
                      <dd>{formatDate(lesson.createdAt)}</dd>
                    </div>
                    <div>
                      <dt>Text</dt>
                      <dd>{formatExtractionStatus(lesson)}</dd>
                    </div>
                  </dl>
                  <button
                    className="delete-button"
                    type="button"
                    onClick={() => {
                      void deleteLesson(lesson)
                    }}
                    disabled={deletingLessonIds.has(lesson.id)}
                  >
                    {deletingLessonIds.has(lesson.id) ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

function upsertLesson(lessons: LessonRecord[], lesson: LessonRecord): LessonRecord[] {
  const nextLessons = lessons.some((currentLesson) => currentLesson.id === lesson.id)
    ? lessons.map((currentLesson) => (currentLesson.id === lesson.id ? lesson : currentLesson))
    : [lesson, ...lessons]

  return nextLessons.sort((firstLesson, secondLesson) =>
    secondLesson.createdAt.localeCompare(firstLesson.createdAt)
  )
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(value: string): string {
  const date = new Date(value.replace(' ', 'T'))

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

function formatExtractionStatus(lesson: LessonRecord): string {
  if (lesson.textExtractionStatus === 'failed') {
    return 'Failed'
  }

  if (lesson.textExtractionStatus === 'not_started') {
    return 'Not started'
  }

  if (lesson.textCharacterCount === 0) {
    return 'No text'
  }

  return `${lesson.textPageCount} page${lesson.textPageCount === 1 ? '' : 's'}, ${formatCompactNumber(lesson.textCharacterCount)} chars`
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(value)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default App
