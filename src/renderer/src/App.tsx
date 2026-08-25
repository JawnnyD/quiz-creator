import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { LessonRecord } from '../../shared/lessons'
import type { QuizRecord, QuizResult } from '../../shared/quizzes'

type FullQuiz = NonNullable<Awaited<ReturnType<Window['api']['getQuiz']>>>
type QuizAnswerSubmission = Parameters<Window['api']['submitQuizAttempt']>[1][number]

function App(): JSX.Element {
  const [lessons, setLessons] = useState<LessonRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isImporting, setIsImporting] = useState(false)
  const [deletingLessonIds, setDeletingLessonIds] = useState<Set<string>>(() => new Set())
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null)
  const [quizzes, setQuizzes] = useState<QuizRecord[]>([])
  const [selectedQuizId, setSelectedQuizId] = useState<string | null>(null)
  const [isLoadingQuizzes, setIsLoadingQuizzes] = useState(false)
  const [isCreatingQuiz, setIsCreatingQuiz] = useState(false)
  const [quizErrorMessage, setQuizErrorMessage] = useState<string | null>(null)
  const [questionCountInput, setQuestionCountInput] = useState('5')
  const [activeQuiz, setActiveQuiz] = useState<FullQuiz | null>(null)
  const [selectedChoiceIdsByQuestionId, setSelectedChoiceIdsByQuestionId] = useState<
    Record<string, string>
  >({})
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null)
  const [isLoadingActiveQuiz, setIsLoadingActiveQuiz] = useState(false)
  const [isSubmittingQuizAttempt, setIsSubmittingQuizAttempt] = useState(false)
  const [quizTakingErrorMessage, setQuizTakingErrorMessage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const quizLoadRequestIdRef = useRef(0)

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

  const activeLesson = useMemo(() => {
    if (activeLessonId === null) {
      return null
    }

    return lessons.find((lesson) => lesson.id === activeLessonId) ?? null
  }, [lessons, activeLessonId])

  const activeLessonIdForQuizLoading = activeLesson?.id ?? null

  useEffect(() => {
    if (activeLessonIdForQuizLoading === null) {
      return
    }

    const lessonId = activeLessonIdForQuizLoading
    let isCanceled = false

    async function loadQuizzes(): Promise<void> {
      setIsLoadingQuizzes(true)
      setQuizErrorMessage(null)
      setQuizzes([])
      setSelectedQuizId(null)

      try {
        const loadedQuizzes = await window.api.listQuizzesForLesson(lessonId)

        if (!isCanceled) {
          setQuizzes(loadedQuizzes)
          setSelectedQuizId(loadedQuizzes[0]?.id ?? null)
        }
      } catch (error) {
        if (!isCanceled) {
          setQuizErrorMessage(getErrorMessage(error))
        }
      } finally {
        if (!isCanceled) {
          setIsLoadingQuizzes(false)
        }
      }
    }

    void loadQuizzes()

    return () => {
      isCanceled = true
    }
  }, [activeLessonIdForQuizLoading])

  const lessonSummary = useMemo(() => {
    if (isLoading) {
      return 'Loading saved lessons'
    }

    if (lessons.length === 0) {
      return 'No lesson PDFs imported yet'
    }

    return `${lessons.length} lesson PDF${lessons.length === 1 ? '' : 's'} imported`
  }, [isLoading, lessons.length])

  const quizSummary = useMemo(() => {
    if (activeLesson === null) {
      return 'No lesson selected'
    }

    if (isLoadingQuizzes) {
      return 'Loading saved quizzes'
    }

    if (quizzes.length === 0) {
      return 'No quizzes created yet'
    }

    return `${quizzes.length} quiz${quizzes.length === 1 ? '' : 'zes'} created`
  }, [activeLesson, isLoadingQuizzes, quizzes.length])

  const generateQuizUnavailableReason =
    activeLesson === null ? null : getGenerateQuizUnavailableReason(activeLesson)
  const questionCount = parseQuestionCountInput(questionCountInput)
  const questionCountErrorMessage = getQuestionCountErrorMessage(questionCountInput)
  const canGenerateQuiz =
    activeLesson !== null &&
    generateQuizUnavailableReason === null &&
    questionCountErrorMessage === null &&
    !isCreatingQuiz
  const isQuizTakingView =
    activeQuiz !== null || isLoadingActiveQuiz || quizTakingErrorMessage !== null
  const answeredQuestionCount =
    activeQuiz?.questions.filter(
      (question) => selectedChoiceIdsByQuestionId[question.id] !== undefined
    ).length ?? 0
  const canSubmitQuizAttempt =
    activeQuiz !== null &&
    quizResult === null &&
    !isSubmittingQuizAttempt &&
    activeQuiz.questions.length > 0 &&
    answeredQuestionCount === activeQuiz.questions.length

  const openPdfPicker = async (): Promise<void> => {
    setIsImporting(true)
    setStatusMessage(null)
    setErrorMessage(null)
    setQuizErrorMessage(null)

    try {
      const importedLesson = await window.api.importLessonPdf()

      if (importedLesson === null) {
        return
      }

      const wasAlreadyImported = lessons.some((lesson) => lesson.id === importedLesson.id)

      setLessons((currentLessons) => upsertLesson(currentLessons, importedLesson))
      setActiveLessonId(importedLesson.id)
      setSelectedQuizId(null)
      resetQuizTakingState()

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

  const createQuizForSelectedLesson = async (): Promise<void> => {
    if (activeLesson === null || !canGenerateQuiz || questionCount === null) {
      return
    }

    setIsCreatingQuiz(true)
    setStatusMessage(null)
    setErrorMessage(null)
    setQuizErrorMessage(null)

    try {
      const createdQuiz = await window.api.createQuiz({
        lessonId: activeLesson.id,
        settings: {
          questionCount
        }
      })

      setQuizzes((currentQuizzes) => upsertQuiz(currentQuizzes, createdQuiz.quiz))
      setSelectedQuizId(createdQuiz.quiz.id)
      setStatusMessage(`Generated "${createdQuiz.quiz.title}" for "${activeLesson.title}".`)
    } catch (error) {
      setQuizErrorMessage(getErrorMessage(error))
    } finally {
      setIsCreatingQuiz(false)
    }
  }

  const openLessonDetail = (lessonId: string): void => {
    setActiveLessonId(lessonId)
    setQuizErrorMessage(null)
    resetQuizTakingState()
  }

  const closeLessonDetail = (): void => {
    setActiveLessonId(null)
    setQuizzes([])
    setSelectedQuizId(null)
    setIsLoadingQuizzes(false)
    setQuizErrorMessage(null)
    resetQuizTakingState()
  }

  const openQuizTaking = async (quizId: string): Promise<void> => {
    const requestId = quizLoadRequestIdRef.current + 1
    quizLoadRequestIdRef.current = requestId

    setSelectedQuizId(quizId)
    setActiveQuiz(null)
    setSelectedChoiceIdsByQuestionId({})
    setQuizResult(null)
    setIsLoadingActiveQuiz(true)
    setIsSubmittingQuizAttempt(false)
    setQuizTakingErrorMessage(null)
    setStatusMessage(null)
    setErrorMessage(null)

    try {
      const loadedQuiz = await window.api.getQuiz(quizId)

      if (quizLoadRequestIdRef.current !== requestId) {
        return
      }

      if (loadedQuiz === null) {
        setQuizTakingErrorMessage('Quiz was not found.')
        return
      }

      setActiveQuiz(loadedQuiz)
    } catch (error) {
      if (quizLoadRequestIdRef.current === requestId) {
        setQuizTakingErrorMessage(getErrorMessage(error))
      }
    } finally {
      if (quizLoadRequestIdRef.current === requestId) {
        setIsLoadingActiveQuiz(false)
      }
    }
  }

  const closeQuizTaking = (): void => {
    resetQuizTakingState()
  }

  const resetQuizTakingState = (): void => {
    quizLoadRequestIdRef.current += 1
    setActiveQuiz(null)
    setSelectedChoiceIdsByQuestionId({})
    setQuizResult(null)
    setIsLoadingActiveQuiz(false)
    setIsSubmittingQuizAttempt(false)
    setQuizTakingErrorMessage(null)
  }

  const selectQuizChoice = (questionId: string, choiceId: string): void => {
    if (quizResult !== null || isSubmittingQuizAttempt) {
      return
    }

    setSelectedChoiceIdsByQuestionId((currentAnswers) => ({
      ...currentAnswers,
      [questionId]: choiceId
    }))
  }

  const submitQuizAttempt = async (): Promise<void> => {
    if (activeQuiz === null || !canSubmitQuizAttempt) {
      return
    }

    const answers: QuizAnswerSubmission[] = activeQuiz.questions.map((question) => ({
      questionId: question.id,
      selectedChoiceId: selectedChoiceIdsByQuestionId[question.id]
    }))

    setIsSubmittingQuizAttempt(true)
    setQuizTakingErrorMessage(null)

    try {
      const result = await window.api.submitQuizAttempt(activeQuiz.quiz.id, answers)
      setQuizResult(result)
    } catch (error) {
      setQuizTakingErrorMessage(getErrorMessage(error))
    } finally {
      setIsSubmittingQuizAttempt(false)
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
    setQuizErrorMessage(null)
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
      <section
        className="lesson-workspace"
        aria-labelledby={
          isQuizTakingView
            ? 'quiz-taking-heading'
            : activeLesson === null
              ? 'lessons-heading'
              : 'lesson-detail-heading'
        }
      >
        {activeLesson === null && !isQuizTakingView ? (
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
        ) : null}

        {errorMessage !== null ? (
          <p className="status-message status-message-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        {statusMessage !== null ? <p className="status-message">{statusMessage}</p> : null}

        {isLoading ? (
          <p className="empty-state">Loading lessons...</p>
        ) : isQuizTakingView ? (
          <section className="quiz-taking" aria-labelledby="quiz-taking-heading">
            <div className="detail-topbar">
              <button className="back-button" type="button" onClick={closeQuizTaking}>
                Back
              </button>
            </div>

            <header className="quiz-taking-header">
              <div className="detail-title-group">
                <p className="detail-kicker">Quiz</p>
                <h2 id="quiz-taking-heading">{activeQuiz?.quiz.title ?? 'Quiz'}</h2>
                {activeQuiz !== null ? (
                  <p>
                    {activeQuiz.questions.length} question
                    {activeQuiz.questions.length === 1 ? '' : 's'}
                  </p>
                ) : null}
              </div>
            </header>

            {quizTakingErrorMessage !== null ? (
              <p className="status-message status-message-error" role="alert">
                {quizTakingErrorMessage}
              </p>
            ) : null}

            {isLoadingActiveQuiz ? (
              <p className="empty-state detail-empty-state">Loading quiz...</p>
            ) : activeQuiz === null ? (
              <p className="empty-state detail-empty-state">
                Open a quiz from the lesson info screen.
              </p>
            ) : activeQuiz.questions.length === 0 ? (
              <p className="empty-state detail-empty-state">This quiz has no questions.</p>
            ) : (
              <>
                {quizResult !== null ? (
                  <p className="quiz-result-summary">
                    Score: {quizResult.attempt.correctAnswerCount} /{' '}
                    {quizResult.attempt.totalQuestionCount}
                  </p>
                ) : null}

                <ol className="quiz-question-list">
                  {activeQuiz.questions.map((question, questionIndex) => {
                    const selectedChoiceId = selectedChoiceIdsByQuestionId[question.id]

                    return (
                      <li className="quiz-question-card" key={question.id}>
                        <h3>
                          <span>Question {questionIndex + 1}</span>
                          {question.prompt}
                        </h3>
                        <div
                          className="quiz-choice-list"
                          role="radiogroup"
                          aria-label={`Answers for question ${questionIndex + 1}`}
                        >
                          {question.choices.map((choice) => {
                            const isSelectedChoice = selectedChoiceId === choice.id

                            return (
                              <label
                                className={`quiz-choice${
                                  isSelectedChoice ? ' quiz-choice-selected' : ''
                                }`}
                                key={choice.id}
                              >
                                <input
                                  type="radio"
                                  name={`quiz-question-${question.id}`}
                                  value={choice.id}
                                  checked={isSelectedChoice}
                                  disabled={quizResult !== null || isSubmittingQuizAttempt}
                                  onChange={() => {
                                    selectQuizChoice(question.id, choice.id)
                                  }}
                                />
                                <span>{choice.choiceText}</span>
                              </label>
                            )
                          })}
                        </div>
                      </li>
                    )
                  })}
                </ol>

                <div className="quiz-submit-bar">
                  <p>
                    {quizResult === null
                      ? `${answeredQuestionCount} of ${activeQuiz.questions.length} answered`
                      : 'Attempt submitted'}
                  </p>
                  <button
                    className="upload-button submit-quiz-button"
                    type="button"
                    onClick={() => {
                      void submitQuizAttempt()
                    }}
                    disabled={!canSubmitQuizAttempt}
                  >
                    {isSubmittingQuizAttempt
                      ? 'Submitting...'
                      : quizResult === null
                        ? 'Submit answers'
                        : 'Submitted'}
                  </button>
                </div>
              </>
            )}
          </section>
        ) : activeLesson === null && lessons.length === 0 ? (
          <p className="empty-state">Import a PDF to create your first lesson.</p>
        ) : activeLesson === null ? (
          <ul className="lesson-list" aria-label="Imported lessons">
            {lessons.map((lesson) => (
              <li className="lesson-item" key={lesson.id}>
                <button
                  className="lesson-select-button"
                  type="button"
                  onClick={() => {
                    openLessonDetail(lesson.id)
                  }}
                >
                  <span className="lesson-title-text">{lesson.title}</span>
                  <span className="lesson-file-name">{lesson.originalFileName}</span>
                </button>
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
        ) : (
          <section className="lesson-detail" aria-labelledby="lesson-detail-heading">
            <div className="detail-topbar">
              <button className="back-button" type="button" onClick={closeLessonDetail}>
                Back
              </button>
            </div>

            <header className="detail-header">
              <div className="detail-title-group">
                <p className="detail-kicker">Lesson info</p>
                <h2 id="lesson-detail-heading">{activeLesson.title}</h2>
                <p>{activeLesson.originalFileName}</p>
              </div>
              <div className="quiz-create-controls">
                <label className="quiz-setting-field">
                  <span>Questions</span>
                  <input
                    className="quiz-question-count-input"
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={questionCountInput}
                    onChange={(event) => {
                      setQuestionCountInput(event.currentTarget.value)
                    }}
                    aria-invalid={questionCountErrorMessage !== null}
                    aria-describedby={
                      questionCountErrorMessage === null ? undefined : 'question-count-error'
                    }
                  />
                </label>
                <button
                  className="upload-button generate-button"
                  type="button"
                  onClick={() => {
                    void createQuizForSelectedLesson()
                  }}
                  disabled={!canGenerateQuiz}
                >
                  {isCreatingQuiz ? 'Generating...' : 'Generate quiz'}
                </button>
                {questionCountErrorMessage !== null ? (
                  <p className="quiz-setting-error" id="question-count-error">
                    {questionCountErrorMessage}
                  </p>
                ) : null}
              </div>
            </header>

            <dl className="detail-metadata">
              <div>
                <dt>File size</dt>
                <dd>{formatFileSize(activeLesson.sizeBytes)}</dd>
              </div>
              <div>
                <dt>Imported</dt>
                <dd>{formatDate(activeLesson.createdAt)}</dd>
              </div>
              <div>
                <dt>Text status</dt>
                <dd>{formatExtractionStatus(activeLesson)}</dd>
              </div>
              <div>
                <dt>Pages</dt>
                <dd>{activeLesson.textPageCount}</dd>
              </div>
              <div>
                <dt>Characters</dt>
                <dd>{formatCompactNumber(activeLesson.textCharacterCount)}</dd>
              </div>
            </dl>

            {activeLesson.textExtractionError !== null ? (
              <p className="detail-alert" role="alert">
                {activeLesson.textExtractionError}
              </p>
            ) : null}

            {generateQuizUnavailableReason !== null ? (
              <p className="detail-note">{generateQuizUnavailableReason}</p>
            ) : null}

            <section className="quiz-section" aria-labelledby="quizzes-heading">
              <header className="quiz-section-header">
                <div>
                  <h3 id="quizzes-heading">Quizzes</h3>
                  <p>{quizSummary}</p>
                </div>
              </header>

              {quizErrorMessage !== null ? (
                <p className="status-message status-message-error" role="alert">
                  {quizErrorMessage}
                </p>
              ) : null}

              {isLoadingQuizzes ? (
                <p className="empty-state detail-empty-state">Loading quizzes...</p>
              ) : quizzes.length === 0 ? (
                <p className="empty-state detail-empty-state">No quizzes for this lesson yet.</p>
              ) : (
                <ul className="quiz-list" aria-label="Saved quizzes">
                  {quizzes.map((quiz) => {
                    const isSelectedQuiz = quiz.id === selectedQuizId

                    return (
                      <li key={quiz.id}>
                        <button
                          className={`quiz-item${isSelectedQuiz ? ' quiz-item-selected' : ''}`}
                          type="button"
                          onClick={() => {
                            void openQuizTaking(quiz.id)
                          }}
                          aria-pressed={isSelectedQuiz}
                        >
                          <span>
                            <span className="quiz-title">{quiz.title}</span>
                            <span className="quiz-created">
                              Created {formatDate(quiz.createdAt)}
                            </span>
                          </span>
                          {isSelectedQuiz ? <span className="selected-badge">Selected</span> : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </section>
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

function upsertQuiz(quizzes: QuizRecord[], quiz: QuizRecord): QuizRecord[] {
  const nextQuizzes = quizzes.some((currentQuiz) => currentQuiz.id === quiz.id)
    ? quizzes.map((currentQuiz) => (currentQuiz.id === quiz.id ? quiz : currentQuiz))
    : [quiz, ...quizzes]

  return nextQuizzes.sort((firstQuiz, secondQuiz) =>
    secondQuiz.createdAt.localeCompare(firstQuiz.createdAt)
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

function getGenerateQuizUnavailableReason(lesson: LessonRecord): string | null {
  if (lesson.textExtractionStatus === 'failed') {
    return 'Quiz generation is unavailable because text extraction failed.'
  }

  if (lesson.textExtractionStatus === 'not_started') {
    return 'Quiz generation is available after lesson text extraction completes.'
  }

  if (lesson.textCharacterCount === 0) {
    return 'Quiz generation is unavailable because no selectable text was found.'
  }

  return null
}

function parseQuestionCountInput(value: string): number | null {
  const trimmedValue = value.trim()

  if (trimmedValue.length === 0 || !/^\d+$/.test(trimmedValue)) {
    return null
  }

  const questionCount = Number(trimmedValue)

  if (!Number.isSafeInteger(questionCount) || questionCount < 1) {
    return null
  }

  return questionCount
}

function getQuestionCountErrorMessage(value: string): string | null {
  return parseQuestionCountInput(value) === null
    ? 'Enter a positive whole number of questions.'
    : null
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default App
