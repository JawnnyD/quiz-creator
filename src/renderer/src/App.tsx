import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { LessonRecord } from '../../shared/lessons'
import type { QuizAttempt, QuizRecord, QuizResult } from '../../shared/quizzes'

type FullQuiz = NonNullable<Awaited<ReturnType<Window['api']['getQuiz']>>>
type QuizAnswerSubmission = Parameters<Window['api']['submitQuizAttempt']>[1][number]

const defaultQuestionCountInput = '10'
const minQuestionCount = 0
const maxQuestionCount = 50
const questionCountSliderStep = 5

const difficultyOptions = [
  { id: 'easy', label: 'Easy', description: '' },
  { id: 'nbme', label: 'NBME', description: '' },
  { id: 'custom', label: 'Custom', description: 'Define your own rules for the quiz.' }
] as const

type DifficultyOptionId = (typeof difficultyOptions)[number]['id']

function App(): JSX.Element {
  const [lessons, setLessons] = useState<LessonRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isImporting, setIsImporting] = useState(false)
  const [deletingLessonIds, setDeletingLessonIds] = useState<Set<string>>(() => new Set())
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null)
  const [quizzes, setQuizzes] = useState<QuizRecord[]>([])
  const [quizAttempts, setQuizAttempts] = useState<QuizAttempt[]>([])
  const [activeAttemptHistoryQuizId, setActiveAttemptHistoryQuizId] = useState<string | null>(null)
  const [isLoadingQuizzes, setIsLoadingQuizzes] = useState(false)
  const [isLoadingQuizAttempts, setIsLoadingQuizAttempts] = useState(false)
  const [isCreatingQuiz, setIsCreatingQuiz] = useState(false)
  const [quizErrorMessage, setQuizErrorMessage] = useState<string | null>(null)
  const [quizAttemptErrorMessage, setQuizAttemptErrorMessage] = useState<string | null>(null)
  const [questionCountInput, setQuestionCountInput] = useState(defaultQuestionCountInput)
  const [selectedDifficultyId, setSelectedDifficultyId] = useState<DifficultyOptionId>('easy')
  const [customDifficultyInstructions, setCustomDifficultyInstructions] = useState('')
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
  const activeAttemptHistoryQuiz = useMemo(() => {
    if (activeAttemptHistoryQuizId === null) {
      return null
    }

    return quizzes.find((quiz) => quiz.id === activeAttemptHistoryQuizId) ?? null
  }, [quizzes, activeAttemptHistoryQuizId])

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

      try {
        const loadedQuizzes = await window.api.listQuizzesForLesson(lessonId)

        if (!isCanceled) {
          setQuizzes(loadedQuizzes)
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

    async function loadQuizAttempts(): Promise<void> {
      setIsLoadingQuizAttempts(true)
      setQuizAttemptErrorMessage(null)
      setQuizAttempts([])

      try {
        const loadedAttempts = await window.api.listQuizAttemptsForLesson(lessonId)

        if (!isCanceled) {
          setQuizAttempts((currentAttempts) => mergeQuizAttempts(loadedAttempts, currentAttempts))
        }
      } catch (error) {
        if (!isCanceled) {
          setQuizAttemptErrorMessage(getErrorMessage(error))
        }
      } finally {
        if (!isCanceled) {
          setIsLoadingQuizAttempts(false)
        }
      }
    }

    void loadQuizzes()
    void loadQuizAttempts()

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
  const questionCountSliderValue = getQuestionCountSliderValue(questionCountInput)
  const canGenerateQuiz =
    activeLesson !== null &&
    generateQuizUnavailableReason === null &&
    questionCount !== null &&
    questionCount > 0 &&
    questionCountErrorMessage === null &&
    !isCreatingQuiz
  const isQuizTakingView =
    activeQuiz !== null || isLoadingActiveQuiz || quizTakingErrorMessage !== null
  const isViewingStoredAttemptResult = activeAttemptHistoryQuizId !== null && quizResult !== null
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
  const resultAnswersByQuestionId = useMemo(() => {
    const answersByQuestionId = new Map<string, QuizResult['answers'][number]>()

    for (const answer of quizResult?.answers ?? []) {
      answersByQuestionId.set(answer.question.id, answer)
    }

    return answersByQuestionId
  }, [quizResult])
  const attemptsByQuizId = useMemo(() => {
    const groupedAttempts = new Map<string, QuizAttempt[]>()

    for (const attempt of quizAttempts) {
      const attempts = groupedAttempts.get(attempt.quizId) ?? []
      attempts.push(attempt)
      groupedAttempts.set(attempt.quizId, attempts)
    }

    return groupedAttempts
  }, [quizAttempts])
  const activeAttemptHistoryAttempts =
    activeAttemptHistoryQuiz === null
      ? []
      : (attemptsByQuizId.get(activeAttemptHistoryQuiz.id) ?? [])

  const openPdfPicker = async (): Promise<void> => {
    setIsImporting(true)
    setStatusMessage(null)
    setErrorMessage(null)
    setQuizErrorMessage(null)
    setQuizAttemptErrorMessage(null)

    try {
      const importedLesson = await window.api.importLessonPdf()

      if (importedLesson === null) {
        return
      }

      const wasAlreadyImported = lessons.some((lesson) => lesson.id === importedLesson.id)

      setLessons((currentLessons) => upsertLesson(currentLessons, importedLesson))
      setActiveLessonId(importedLesson.id)
      setActiveAttemptHistoryQuizId(null)
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
      setActiveAttemptHistoryQuizId(null)
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
    setQuizAttemptErrorMessage(null)
    setActiveAttemptHistoryQuizId(null)
    resetQuizTakingState()
  }

  const closeLessonDetail = (): void => {
    setActiveLessonId(null)
    setQuizzes([])
    setQuizAttempts([])
    setActiveAttemptHistoryQuizId(null)
    setIsLoadingQuizzes(false)
    setIsLoadingQuizAttempts(false)
    setQuizErrorMessage(null)
    setQuizAttemptErrorMessage(null)
    resetQuizTakingState()
  }

  const openQuizTaking = async (quizId: string): Promise<void> => {
    const requestId = quizLoadRequestIdRef.current + 1
    quizLoadRequestIdRef.current = requestId

    setActiveAttemptHistoryQuizId(null)
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

  const openAttemptHistory = (quizId: string): void => {
    setActiveAttemptHistoryQuizId(quizId)
    setStatusMessage(null)
    setErrorMessage(null)
    resetQuizTakingState()
  }

  const closeAttemptHistory = (): void => {
    setActiveAttemptHistoryQuizId(null)
    resetQuizTakingState()
  }

  const openAttemptReview = async (attemptId: string): Promise<void> => {
    const requestId = quizLoadRequestIdRef.current + 1
    quizLoadRequestIdRef.current = requestId

    setActiveQuiz(null)
    setSelectedChoiceIdsByQuestionId({})
    setQuizResult(null)
    setIsLoadingActiveQuiz(true)
    setIsSubmittingQuizAttempt(false)
    setQuizTakingErrorMessage(null)
    setStatusMessage(null)
    setErrorMessage(null)

    try {
      const loadedResult = await window.api.getQuizAttemptResult(attemptId)

      if (quizLoadRequestIdRef.current !== requestId) {
        return
      }

      if (loadedResult === null) {
        setQuizTakingErrorMessage('Quiz attempt was not found.')
        return
      }

      setActiveAttemptHistoryQuizId(loadedResult.quiz.id)
      setSelectedChoiceIdsByQuestionId(getSelectedChoiceIdsByQuestionId(loadedResult))
      setQuizResult(loadedResult)
      setActiveQuiz({
        quiz: loadedResult.quiz,
        questions: loadedResult.answers.map((answer) => answer.question)
      })
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
      setQuizAttempts((currentAttempts) => upsertQuizAttempt(currentAttempts, result.attempt))
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
    setQuizAttemptErrorMessage(null)
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
            : activeAttemptHistoryQuiz !== null
              ? 'attempt-history-heading'
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
                <p className="detail-kicker">
                  {activeAttemptHistoryQuizId === null ? 'Quiz' : 'Attempt review'}
                </p>
                <h2 id="quiz-taking-heading">
                  {activeQuiz?.quiz.title ?? activeAttemptHistoryQuiz?.title ?? 'Quiz'}
                </h2>
                {activeQuiz !== null ? (
                  <p>
                    {quizResult !== null && activeAttemptHistoryQuizId !== null
                      ? `Completed ${formatAttemptCompletedDate(quizResult.attempt)}`
                      : `${activeQuiz.questions.length} question${activeQuiz.questions.length === 1 ? '' : 's'}`}
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
                {activeAttemptHistoryQuizId === null
                  ? 'Open a quiz from the lesson info screen.'
                  : 'Open an attempt from the attempt history screen.'}
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
                    const resultAnswer = resultAnswersByQuestionId.get(question.id)
                    const selectedChoiceId =
                      resultAnswer?.selectedChoiceId ?? selectedChoiceIdsByQuestionId[question.id]
                    const selectedChoice = question.choices.find(
                      (choice) => choice.id === selectedChoiceId
                    )
                    const correctChoice = question.choices.find((choice) => choice.isCorrect)
                    const reviewContent = getQuestionReviewContent(question.explanation)

                    return (
                      <li
                        className={`quiz-question-card${
                          resultAnswer === undefined
                            ? ''
                            : resultAnswer.isCorrect
                              ? ' quiz-question-card-correct'
                              : ' quiz-question-card-incorrect'
                        }`}
                        key={question.id}
                      >
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
                                className={[
                                  'quiz-choice',
                                  isSelectedChoice ? 'quiz-choice-selected' : '',
                                  quizResult !== null && choice.isCorrect
                                    ? 'quiz-choice-correct'
                                    : '',
                                  quizResult !== null && isSelectedChoice && !choice.isCorrect
                                    ? 'quiz-choice-incorrect'
                                    : ''
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
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
                        {resultAnswer !== undefined ? (
                          <div className="quiz-review">
                            <div className="quiz-review-header">
                              <span
                                className={`quiz-result-badge${
                                  resultAnswer.isCorrect
                                    ? ' quiz-result-badge-correct'
                                    : ' quiz-result-badge-incorrect'
                                }`}
                              >
                                {resultAnswer.isCorrect ? 'Correct' : 'Incorrect'}
                              </span>
                            </div>

                            <dl className="quiz-review-details">
                              <div>
                                <dt>Your answer</dt>
                                <dd>{selectedChoice?.choiceText ?? 'No answer recorded'}</dd>
                              </div>
                              <div>
                                <dt>Correct answer</dt>
                                <dd>{correctChoice?.choiceText ?? 'Correct answer unavailable'}</dd>
                              </div>
                            </dl>

                            <div className="quiz-result-block">
                              <h4>Explanation</h4>
                              <p>{reviewContent.explanationText ?? 'No explanation available.'}</p>
                            </div>

                            <div className="quiz-result-block">
                              <h4>Lesson reference</h4>
                              <p>
                                {reviewContent.lessonReference ?? 'Lesson reference unavailable.'}
                              </p>
                            </div>
                          </div>
                        ) : null}
                      </li>
                    )
                  })}
                </ol>

                <div className="quiz-submit-bar">
                  <p>
                    {quizResult !== null && activeAttemptHistoryQuizId !== null
                      ? `Completed ${formatAttemptCompletedDate(quizResult.attempt)}`
                      : quizResult === null
                        ? `${answeredQuestionCount} of ${activeQuiz.questions.length} answered`
                        : 'Attempt submitted'}
                  </p>
                  {!isViewingStoredAttemptResult ? (
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
                  ) : null}
                </div>
              </>
            )}
          </section>
        ) : activeAttemptHistoryQuiz !== null ? (
          <section className="attempt-history-view" aria-labelledby="attempt-history-heading">
            <div className="detail-topbar">
              <button className="back-button" type="button" onClick={closeAttemptHistory}>
                Back
              </button>
            </div>

            <header className="attempt-history-header">
              <div className="detail-title-group">
                <p className="detail-kicker">Attempt history</p>
                <h2 id="attempt-history-heading">{activeAttemptHistoryQuiz.title}</h2>
                <p>
                  {isLoadingQuizAttempts
                    ? 'Loading attempts'
                    : quizAttemptErrorMessage !== null
                      ? 'Attempt history unavailable'
                      : `${activeAttemptHistoryAttempts.length} completed attempt${activeAttemptHistoryAttempts.length === 1 ? '' : 's'}`}
                </p>
              </div>
            </header>

            {quizAttemptErrorMessage !== null ? (
              <p className="status-message status-message-error" role="alert">
                {quizAttemptErrorMessage}
              </p>
            ) : null}

            {isLoadingQuizAttempts ? (
              <p className="empty-state detail-empty-state">Loading attempts...</p>
            ) : quizAttemptErrorMessage !== null ? null : activeAttemptHistoryAttempts.length ===
              0 ? (
              <p className="empty-state detail-empty-state">No attempts yet.</p>
            ) : (
              <ol className="attempt-history-list" aria-label="Previous attempts">
                {activeAttemptHistoryAttempts.map((attempt) => (
                  <li key={attempt.id}>
                    <button
                      className="attempt-history-button"
                      type="button"
                      onClick={() => {
                        void openAttemptReview(attempt.id)
                      }}
                    >
                      <span className="attempt-score">Score {formatAttemptScore(attempt)}</span>
                      <span className="attempt-completed">
                        Completed {formatAttemptCompletedDate(attempt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
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
                  <span>
                    <span className="lesson-title-text">{lesson.title}</span>
                    <span className="lesson-file-name">{lesson.originalFileName}</span>
                  </span>
                  <span className="lesson-metadata" aria-label="Lesson metadata">
                    <span className="lesson-metadata-item">
                      <span className="lesson-metadata-label">Size</span>
                      <span className="lesson-metadata-value">
                        {formatFileSize(lesson.sizeBytes)}
                      </span>
                    </span>
                    <span className="lesson-metadata-item">
                      <span className="lesson-metadata-label">Imported</span>
                      <span className="lesson-metadata-value">{formatDate(lesson.createdAt)}</span>
                    </span>
                    <span className="lesson-metadata-item">
                      <span className="lesson-metadata-label">Text</span>
                      <span className="lesson-metadata-value">
                        {formatExtractionStatus(lesson)}
                      </span>
                    </span>
                  </span>
                </button>
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
                <div className="quiz-create-top-row">
                  <div className="quiz-question-setting">
                    <span className="quiz-setting-label">Questions</span>
                    <div className="quiz-question-count-controls">
                      <input
                        className="quiz-question-count-slider"
                        type="range"
                        min={minQuestionCount}
                        max={maxQuestionCount}
                        step={questionCountSliderStep}
                        value={questionCountSliderValue}
                        onChange={(event) => {
                          setQuestionCountInput(event.currentTarget.value)
                        }}
                        aria-label="Question count slider"
                        aria-describedby={
                          questionCountErrorMessage === null ? undefined : 'question-count-error'
                        }
                      />
                      <label className="quiz-question-count-number">
                        <span>Count</span>
                        <input
                          className="quiz-question-count-input"
                          type="number"
                          min={minQuestionCount}
                          max={maxQuestionCount}
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
                    </div>
                    {questionCountErrorMessage !== null ? (
                      <p className="quiz-setting-error" id="question-count-error">
                        {questionCountErrorMessage}
                      </p>
                    ) : null}
                  </div>
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
                </div>
                <div className="quiz-difficulty-setting">
                  <span className="quiz-setting-label" id="quiz-difficulty-label">
                    Difficulty
                  </span>
                  <div
                    className="quiz-difficulty-options"
                    role="group"
                    aria-labelledby="quiz-difficulty-label"
                  >
                    {difficultyOptions.map((difficulty) => {
                      const isSelectedDifficulty = selectedDifficultyId === difficulty.id

                      return (
                        <button
                          className={`quiz-difficulty-option${
                            isSelectedDifficulty ? ' quiz-difficulty-option-selected' : ''
                          }`}
                          type="button"
                          key={difficulty.id}
                          onClick={() => {
                            setSelectedDifficultyId(difficulty.id)
                          }}
                          aria-pressed={isSelectedDifficulty}
                        >
                          <span className="quiz-difficulty-title">{difficulty.label}</span>
                          {difficulty.description.length > 0 ? (
                            <span className="quiz-difficulty-description">
                              {difficulty.description}
                            </span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                  {selectedDifficultyId === 'custom' ? (
                    <label className="quiz-custom-instructions-field">
                      <span className="quiz-setting-label">Custom instructions</span>
                      <textarea
                        className="quiz-custom-instructions-input"
                        value={customDifficultyInstructions}
                        onChange={(event) => {
                          setCustomDifficultyInstructions(event.currentTarget.value)
                        }}
                      />
                    </label>
                  ) : null}
                </div>
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
                    const quizAttemptsForQuiz = attemptsByQuizId.get(quiz.id) ?? []

                    return (
                      <li className="quiz-list-item" key={quiz.id}>
                        <div className="quiz-item-row">
                          <button
                            className="quiz-item"
                            type="button"
                            onClick={() => {
                              void openQuizTaking(quiz.id)
                            }}
                          >
                            <span>
                              <span className="quiz-title">{quiz.title}</span>
                              <span className="quiz-created">
                                Created {formatDate(quiz.createdAt)}
                              </span>
                            </span>
                          </button>
                          <button
                            className="history-button"
                            type="button"
                            onClick={() => {
                              openAttemptHistory(quiz.id)
                            }}
                          >
                            {isLoadingQuizAttempts || quizAttemptErrorMessage !== null
                              ? 'View history'
                              : `View history (${quizAttemptsForQuiz.length})`}
                          </button>
                        </div>
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

function upsertQuizAttempt(attempts: QuizAttempt[], attempt: QuizAttempt): QuizAttempt[] {
  const nextAttempts = attempts.some((currentAttempt) => currentAttempt.id === attempt.id)
    ? attempts.map((currentAttempt) =>
        currentAttempt.id === attempt.id ? attempt : currentAttempt
      )
    : [attempt, ...attempts]

  return nextAttempts.sort((firstAttempt, secondAttempt) =>
    (secondAttempt.completedAt ?? secondAttempt.startedAt).localeCompare(
      firstAttempt.completedAt ?? firstAttempt.startedAt
    )
  )
}

function mergeQuizAttempts(
  firstAttempts: QuizAttempt[],
  secondAttempts: QuizAttempt[]
): QuizAttempt[] {
  return secondAttempts.reduce(
    (mergedAttempts, attempt) => upsertQuizAttempt(mergedAttempts, attempt),
    firstAttempts
  )
}

function getSelectedChoiceIdsByQuestionId(result: QuizResult): Record<string, string> {
  const selectedChoiceIdsByQuestionId: Record<string, string> = {}

  for (const answer of result.answers) {
    if (answer.selectedChoiceId !== null) {
      selectedChoiceIdsByQuestionId[answer.question.id] = answer.selectedChoiceId
    }
  }

  return selectedChoiceIdsByQuestionId
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

function formatAttemptScore(attempt: QuizAttempt): string {
  return `${attempt.correctAnswerCount} / ${attempt.totalQuestionCount}`
}

function formatAttemptCompletedDate(attempt: QuizAttempt): string {
  return attempt.completedAt === null ? 'Not completed' : formatDate(attempt.completedAt)
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

  if (
    !Number.isSafeInteger(questionCount) ||
    questionCount < minQuestionCount ||
    questionCount > maxQuestionCount
  ) {
    return null
  }

  return questionCount
}

function getQuestionCountErrorMessage(value: string): string | null {
  const questionCount = parseQuestionCountInput(value)

  if (questionCount === null) {
    return `Enter a whole number from 1 to ${maxQuestionCount}.`
  }

  if (questionCount === 0) {
    return 'Choose at least 1 question.'
  }

  return null
}

function getQuestionCountSliderValue(value: string): number {
  const parsedValue = Number(value)

  if (!Number.isFinite(parsedValue)) {
    return minQuestionCount
  }

  return Math.min(Math.max(parsedValue, minQuestionCount), maxQuestionCount)
}

function getQuestionReviewContent(explanation: string | null): {
  explanationText: string | null
  lessonReference: string | null
} {
  const trimmedExplanation = explanation?.trim() ?? ''
  const sourceExcerptPrefix = 'Source excerpt:'

  if (trimmedExplanation.length === 0) {
    return {
      explanationText: null,
      lessonReference: null
    }
  }

  if (trimmedExplanation.toLowerCase().startsWith(sourceExcerptPrefix.toLowerCase())) {
    const lessonReference = trimmedExplanation.slice(sourceExcerptPrefix.length).trim()

    return {
      explanationText: null,
      lessonReference: lessonReference.length > 0 ? lessonReference : null
    }
  }

  return {
    explanationText: trimmedExplanation,
    lessonReference: null
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default App
