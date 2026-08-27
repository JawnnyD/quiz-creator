import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent
} from 'react'
import { isAppError, type AppErrorCode } from '../../shared/errors'
import type { LessonRecord } from '../../shared/lessons'
import type { QuizAttempt, QuizDifficulty, QuizRecord, QuizResult } from '../../shared/quizzes'

type FullQuiz = NonNullable<Awaited<ReturnType<Window['api']['getQuiz']>>>
type QuizAnswerSubmission = Parameters<Window['api']['submitQuizAttempt']>[1][number]
type TitleEditTargetKind = 'lesson' | 'quiz'
type LessonSortField = 'createdAt' | 'title'
type SortDirection = 'asc' | 'desc'

interface TitleEditTarget {
  kind: TitleEditTargetKind
  id: string
}

const defaultQuestionCountInput = '10'
const defaultLessonSortField: LessonSortField = 'createdAt'
const defaultLessonSortDirection: SortDirection = 'desc'
const minQuestionCount = 0
const maxQuestionCount = 50
const questionCountSliderStep = 5
const lessonTitleCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
})
const lessonSortOptions = [
  { id: 'createdAt', label: 'Import date' },
  { id: 'title', label: 'Title' }
] as const satisfies ReadonlyArray<{
  id: LessonSortField
  label: string
}>

const difficultyOptions = [
  { id: 'easy', label: 'Easy', description: 'Recall and basic understanding.' },
  { id: 'nbme', label: 'NBME', description: 'Clinical reasoning and application.' },
  { id: 'custom', label: 'Custom', description: 'Define your own rules.' }
] as const satisfies ReadonlyArray<{
  id: QuizDifficulty
  label: string
  description: string
}>

function App(): JSX.Element {
  const [lessons, setLessons] = useState<LessonRecord[]>([])
  const [lessonSortField, setLessonSortField] = useState<LessonSortField>(defaultLessonSortField)
  const [lessonSortDirection, setLessonSortDirection] = useState<SortDirection>(
    defaultLessonSortDirection
  )
  const [isLessonSortMenuOpen, setIsLessonSortMenuOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isImporting, setIsImporting] = useState(false)
  const [deletingLessonIds, setDeletingLessonIds] = useState<Set<string>>(() => new Set())
  const [deletingQuizIds, setDeletingQuizIds] = useState<Set<string>>(() => new Set())
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
  const [selectedDifficultyId, setSelectedDifficultyId] = useState<QuizDifficulty>('easy')
  const [customDifficultyInstructions, setCustomDifficultyInstructions] = useState('')
  const [isTutorModeEnabled, setIsTutorModeEnabled] = useState(false)
  const [titleEditTarget, setTitleEditTarget] = useState<TitleEditTarget | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
  const [titleEditErrorMessage, setTitleEditErrorMessage] = useState<string | null>(null)
  const [isSavingTitle, setIsSavingTitle] = useState(false)
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
  const lessonSortDropdownRef = useRef<HTMLDivElement | null>(null)

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

  useEffect(() => {
    if (!isLessonSortMenuOpen) {
      return
    }

    const closeLessonSortMenuOnOutsideClick = (event: PointerEvent): void => {
      const target = event.target

      if (
        target instanceof Node &&
        lessonSortDropdownRef.current !== null &&
        !lessonSortDropdownRef.current.contains(target)
      ) {
        setIsLessonSortMenuOpen(false)
      }
    }

    const closeLessonSortMenuOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsLessonSortMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', closeLessonSortMenuOnOutsideClick)
    document.addEventListener('keydown', closeLessonSortMenuOnEscape)

    return () => {
      document.removeEventListener('pointerdown', closeLessonSortMenuOnOutsideClick)
      document.removeEventListener('keydown', closeLessonSortMenuOnEscape)
    }
  }, [isLessonSortMenuOpen])

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
  const sortedLessons = useMemo(
    () => sortLessons(lessons, lessonSortField, lessonSortDirection),
    [lessons, lessonSortField, lessonSortDirection]
  )

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
          if (isAppErrorWithCode(error, 'lesson_not_found')) {
            setLessons((currentLessons) =>
              currentLessons.filter((lesson) => lesson.id !== lessonId)
            )
            setActiveLessonId(null)
            setQuizzes([])
            setQuizAttempts([])
            setActiveAttemptHistoryQuizId(null)
            setActiveQuiz(null)
            setSelectedChoiceIdsByQuestionId({})
            setQuizResult(null)
            setIsLoadingActiveQuiz(false)
            setIsSubmittingQuizAttempt(false)
            setQuizTakingErrorMessage(null)
            setStatusMessage('This lesson is no longer available.')
            return
          }

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
          if (isAppErrorWithCode(error, 'lesson_not_found')) {
            setLessons((currentLessons) =>
              currentLessons.filter((lesson) => lesson.id !== lessonId)
            )
            setActiveLessonId(null)
            setQuizzes([])
            setQuizAttempts([])
            setActiveAttemptHistoryQuizId(null)
            setActiveQuiz(null)
            setSelectedChoiceIdsByQuestionId({})
            setQuizResult(null)
            setIsLoadingActiveQuiz(false)
            setIsSubmittingQuizAttempt(false)
            setQuizTakingErrorMessage(null)
            setStatusMessage('This lesson is no longer available.')
            return
          }

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
  const activeQuizTitle = activeQuiz?.quiz.title ?? activeAttemptHistoryQuiz?.title ?? 'Quiz'
  const answeredQuestionCount =
    activeQuiz?.questions.filter(
      (question) => selectedChoiceIdsByQuestionId[question.id] !== undefined
    ).length ?? 0
  const unansweredQuestionCount =
    activeQuiz === null ? 0 : activeQuiz.questions.length - answeredQuestionCount
  const canSubmitQuizAttempt =
    activeQuiz !== null &&
    quizResult === null &&
    !isSubmittingQuizAttempt &&
    activeQuiz.questions.length > 0
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

  const isEditingTitle = (kind: TitleEditTargetKind, id: string): boolean =>
    titleEditTarget?.kind === kind && titleEditTarget.id === id

  const clearTitleEditState = (): void => {
    setTitleEditTarget(null)
    setTitleDraft('')
    setTitleEditErrorMessage(null)
  }

  const handleLessonUnavailable = (lessonId: string): void => {
    setLessons((currentLessons) => currentLessons.filter((lesson) => lesson.id !== lessonId))

    if (activeLessonId === lessonId) {
      setActiveLessonId(null)
      setQuizzes([])
      setQuizAttempts([])
      setActiveAttemptHistoryQuizId(null)
      resetQuizTakingState()
    }

    clearTitleEditState()
    setStatusMessage('This lesson is no longer available.')
  }

  const removeQuizFromState = (quizId: string): void => {
    setQuizzes((currentQuizzes) => currentQuizzes.filter((quiz) => quiz.id !== quizId))
    setQuizAttempts((currentAttempts) =>
      currentAttempts.filter((attempt) => attempt.quizId !== quizId)
    )
  }

  const clearQuizUiState = (quizId: string): void => {
    removeQuizFromState(quizId)

    if (activeQuiz?.quiz.id === quizId || activeAttemptHistoryQuizId === quizId) {
      setActiveAttemptHistoryQuizId(null)
      resetQuizTakingState()
    }

    if (titleEditTarget?.kind === 'quiz' && titleEditTarget.id === quizId) {
      clearTitleEditState()
    }
  }

  const handleQuizUnavailable = (quizId: string): void => {
    clearQuizUiState(quizId)
    setQuizErrorMessage(null)
    setQuizAttemptErrorMessage(null)
    setStatusMessage('This quiz is no longer available.')
  }

  const startTitleEdit = (kind: TitleEditTargetKind, id: string, currentTitle: string): void => {
    if (isSavingTitle) {
      return
    }

    setTitleEditTarget({ kind, id })
    setTitleDraft(currentTitle)
    setTitleEditErrorMessage(null)
  }

  const cancelTitleEdit = (): void => {
    if (isSavingTitle) {
      return
    }

    clearTitleEditState()
  }

  const saveTitleEdit = async (): Promise<void> => {
    if (titleEditTarget === null || isSavingTitle) {
      return
    }

    const trimmedTitle = titleDraft.trim()

    if (trimmedTitle.length === 0) {
      setTitleEditErrorMessage(
        titleEditTarget.kind === 'lesson' ? 'Enter a lesson title.' : 'Enter a quiz title.'
      )
      return
    }

    setIsSavingTitle(true)
    setTitleEditErrorMessage(null)

    try {
      if (titleEditTarget.kind === 'lesson') {
        const updatedLesson = await window.api.updateLessonTitle(titleEditTarget.id, trimmedTitle)

        setLessons((currentLessons) => upsertLesson(currentLessons, updatedLesson))
      } else {
        const updatedQuiz = await window.api.updateQuizTitle(titleEditTarget.id, trimmedTitle)

        setQuizzes((currentQuizzes) => upsertQuiz(currentQuizzes, updatedQuiz))
        setActiveQuiz((currentQuiz) =>
          currentQuiz?.quiz.id === updatedQuiz.id
            ? { ...currentQuiz, quiz: updatedQuiz }
            : currentQuiz
        )
        setQuizResult((currentResult) =>
          currentResult?.quiz.id === updatedQuiz.id
            ? { ...currentResult, quiz: updatedQuiz }
            : currentResult
        )
      }

      clearTitleEditState()
    } catch (error) {
      if (titleEditTarget.kind === 'lesson' && isAppErrorWithCode(error, 'lesson_not_found')) {
        handleLessonUnavailable(titleEditTarget.id)
        return
      }

      if (titleEditTarget.kind === 'quiz' && isAppErrorWithCode(error, 'quiz_not_found')) {
        handleQuizUnavailable(titleEditTarget.id)
        return
      }

      setTitleEditErrorMessage(getErrorMessage(error))
    } finally {
      setIsSavingTitle(false)
    }
  }

  const handleTitleEditKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void saveTitleEdit()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      cancelTitleEdit()
    }
  }

  const toggleLessonSortMenu = (): void => {
    setIsLessonSortMenuOpen((isOpen) => !isOpen)
  }

  const selectLessonSortField = (nextSortField: LessonSortField): void => {
    if (nextSortField !== lessonSortField) {
      setLessonSortField(nextSortField)
      setLessonSortDirection(getDefaultLessonSortDirection(nextSortField))
    }

    setIsLessonSortMenuOpen(false)
  }

  const toggleLessonSortDirection = (): void => {
    setLessonSortDirection((currentSortDirection) =>
      currentSortDirection === 'asc' ? 'desc' : 'asc'
    )
  }

  const renderTitleEditForm = (kind: TitleEditTargetKind, inputId?: string): JSX.Element => (
    <div className="title-edit-form">
      <input
        id={inputId}
        className="title-edit-input"
        type="text"
        value={titleDraft}
        onChange={(event) => {
          setTitleDraft(event.currentTarget.value)
        }}
        onKeyDown={handleTitleEditKeyDown}
        disabled={isSavingTitle}
        aria-label={kind === 'lesson' ? 'Lesson title' : 'Quiz title'}
        aria-invalid={titleEditErrorMessage !== null}
        aria-describedby={titleEditErrorMessage === null ? undefined : 'title-edit-error'}
        autoFocus
      />
      <div className="title-edit-actions">
        <button
          className="title-edit-action-button"
          type="button"
          onClick={() => {
            void saveTitleEdit()
          }}
          disabled={isSavingTitle}
        >
          {isSavingTitle ? 'Saving...' : 'Save'}
        </button>
        <button
          className="title-edit-action-button"
          type="button"
          onClick={cancelTitleEdit}
          disabled={isSavingTitle}
        >
          Cancel
        </button>
      </div>
      {titleEditErrorMessage !== null ? (
        <p className="title-edit-error" id="title-edit-error" role="alert">
          {titleEditErrorMessage}
        </p>
      ) : null}
    </div>
  )

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
      clearTitleEditState()
      resetQuizTakingState()

      if (importedLesson.textExtractionStatus === 'failed') {
        setErrorMessage(
          `${wasAlreadyImported ? 'Loaded' : 'Imported'} "${importedLesson.title}", but text extraction failed.`
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
          questionCount,
          difficulty: selectedDifficultyId,
          ...(selectedDifficultyId === 'custom'
            ? { customDifficultyInstructions: customDifficultyInstructions.trim() }
            : {})
        }
      })

      setQuizzes((currentQuizzes) => upsertQuiz(currentQuizzes, createdQuiz.quiz))
      setActiveAttemptHistoryQuizId(null)
      setStatusMessage(`Generated "${createdQuiz.quiz.title}" for "${activeLesson.title}".`)
    } catch (error) {
      if (isAppErrorWithCode(error, 'lesson_not_found')) {
        handleLessonUnavailable(activeLesson.id)
        return
      }

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
    clearTitleEditState()
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
    clearTitleEditState()
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
    clearTitleEditState()

    try {
      const loadedQuiz = await window.api.getQuiz(quizId)

      if (quizLoadRequestIdRef.current !== requestId) {
        return
      }

      if (loadedQuiz === null) {
        handleQuizUnavailable(quizId)
        return
      }

      setActiveQuiz(randomizeQuizForAttempt(loadedQuiz))
    } catch (error) {
      if (quizLoadRequestIdRef.current === requestId) {
        if (isAppErrorWithCode(error, 'quiz_not_found')) {
          handleQuizUnavailable(quizId)
          return
        }

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
    clearTitleEditState()
    resetQuizTakingState()
  }

  const closeAttemptHistory = (): void => {
    setActiveAttemptHistoryQuizId(null)
    clearTitleEditState()
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
    clearTitleEditState()

    try {
      const loadedResult = await window.api.getQuizAttemptResult(attemptId)

      if (quizLoadRequestIdRef.current !== requestId) {
        return
      }

      if (loadedResult === null) {
        if (activeAttemptHistoryQuizId !== null) {
          handleQuizUnavailable(activeAttemptHistoryQuizId)
        } else {
          setQuizTakingErrorMessage('This quiz attempt is no longer available.')
        }

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
        if (isAppErrorWithCode(error, 'quiz_not_found') && activeAttemptHistoryQuizId !== null) {
          handleQuizUnavailable(activeAttemptHistoryQuizId)
          return
        }

        setQuizTakingErrorMessage(getErrorMessage(error))
      }
    } finally {
      if (quizLoadRequestIdRef.current === requestId) {
        setIsLoadingActiveQuiz(false)
      }
    }
  }

  const closeQuizTaking = (): void => {
    clearTitleEditState()
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

    setQuizTakingErrorMessage(null)
    setSelectedChoiceIdsByQuestionId((currentAnswers) => ({
      ...currentAnswers,
      [questionId]: choiceId
    }))
  }

  const submitQuizAttempt = async (): Promise<void> => {
    if (activeQuiz === null || !canSubmitQuizAttempt) {
      return
    }

    if (unansweredQuestionCount > 0) {
      setQuizTakingErrorMessage(
        `Answer every question before submitting. ${unansweredQuestionCount} remaining.`
      )
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
      if (isAppErrorWithCode(error, 'quiz_not_found')) {
        handleQuizUnavailable(activeQuiz.quiz.id)
        return
      }

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

      if (activeLessonId === lesson.id) {
        setActiveLessonId(null)
        setQuizzes([])
        setQuizAttempts([])
        setActiveAttemptHistoryQuizId(null)
        resetQuizTakingState()
      }

      if (titleEditTarget?.kind === 'lesson' && titleEditTarget.id === lesson.id) {
        clearTitleEditState()
      }

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

  const deleteQuiz = async (quiz: QuizRecord): Promise<void> => {
    const confirmed = window.confirm(
      `Delete "${quiz.title}"?\n\nThis removes the quiz and all saved attempts.`
    )

    if (!confirmed) {
      return
    }

    setStatusMessage(null)
    setErrorMessage(null)
    setQuizErrorMessage(null)
    setQuizAttemptErrorMessage(null)
    setQuizDeleting(quiz.id, true)

    try {
      const result = await window.api.deleteQuiz(quiz.id)

      if (!result.deleted) {
        handleQuizUnavailable(quiz.id)
        return
      }

      clearQuizUiState(quiz.id)
      setStatusMessage(`Deleted "${quiz.title}".`)
    } catch (error) {
      if (isAppErrorWithCode(error, 'quiz_not_found')) {
        handleQuizUnavailable(quiz.id)
        return
      }

      setQuizErrorMessage(getErrorMessage(error))
    } finally {
      setQuizDeleting(quiz.id, false)
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

  const setQuizDeleting = (quizId: string, isDeleting: boolean): void => {
    setDeletingQuizIds((currentQuizIds) => {
      const nextQuizIds = new Set(currentQuizIds)

      if (isDeleting) {
        nextQuizIds.add(quizId)
      } else {
        nextQuizIds.delete(quizId)
      }

      return nextQuizIds
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
            <div className="lesson-header-actions">
              {lessons.length > 1 ? (
                <div className="lesson-sort-controls" aria-label="Lesson sorting">
                  <div className="lesson-sort-control" ref={lessonSortDropdownRef}>
                    <span id="lesson-sort-label">Sort by</span>
                    <button
                      className="lesson-sort-menu-button"
                      type="button"
                      onClick={toggleLessonSortMenu}
                      aria-haspopup="listbox"
                      aria-expanded={isLessonSortMenuOpen}
                      aria-labelledby="lesson-sort-label lesson-sort-selected-value"
                    >
                      <span id="lesson-sort-selected-value">
                        {getLessonSortFieldLabel(lessonSortField)}
                      </span>
                      <span className="lesson-sort-menu-chevron" aria-hidden="true">
                        {isLessonSortMenuOpen ? '\u25B4' : '\u25BE'}
                      </span>
                    </button>
                    {isLessonSortMenuOpen ? (
                      <div
                        className="lesson-sort-menu"
                        role="listbox"
                        aria-labelledby="lesson-sort-label"
                      >
                        {lessonSortOptions.map((option) => {
                          const isSelectedOption = lessonSortField === option.id

                          return (
                            <button
                              className={`lesson-sort-option${
                                isSelectedOption ? ' lesson-sort-option-selected' : ''
                              }`}
                              type="button"
                              role="option"
                              aria-selected={isSelectedOption}
                              key={option.id}
                              onClick={() => {
                                selectLessonSortField(option.id)
                              }}
                            >
                              {option.label}
                            </button>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                  <button
                    className="lesson-sort-direction-button"
                    type="button"
                    onClick={toggleLessonSortDirection}
                    aria-label={getLessonSortDirectionToggleLabel(
                      lessonSortField,
                      lessonSortDirection
                    )}
                    title={getLessonSortDirectionCurrentLabel(lessonSortField, lessonSortDirection)}
                  >
                    {lessonSortDirection === 'asc' ? '\u2191' : '\u2193'}
                  </button>
                </div>
              ) : null}
              <button
                className="upload-button"
                type="button"
                onClick={openPdfPicker}
                disabled={isImporting}
              >
                {isImporting ? 'Importing...' : 'Upload PDF'}
              </button>
            </div>
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
                <h2 id="quiz-taking-heading">{activeQuizTitle}</h2>
                {activeQuiz !== null ? (
                  <p>
                    {quizResult !== null && activeAttemptHistoryQuizId !== null
                      ? `Completed ${formatAttemptCompletedDate(quizResult.attempt)}`
                      : `${activeQuiz.questions.length} question${activeQuiz.questions.length === 1 ? '' : 's'}`}
                  </p>
                ) : null}
              </div>
              {activeAttemptHistoryQuizId === null ? (
                <label className="tutor-mode-toggle">
                  <span>Tutor mode</span>
                  <input
                    type="checkbox"
                    checked={isTutorModeEnabled}
                    onChange={(event) => {
                      setIsTutorModeEnabled(event.currentTarget.checked)
                    }}
                  />
                </label>
              ) : null}
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
                    const explanationText = getQuestionExplanationText(question.explanation)
                    const isTutorModeQuestionFeedbackVisible =
                      quizResult === null && isTutorModeEnabled && selectedChoice !== undefined
                    const isQuestionFeedbackVisible =
                      resultAnswer !== undefined || isTutorModeQuestionFeedbackVisible
                    const isQuestionCorrect =
                      resultAnswer?.isCorrect ??
                      (isTutorModeQuestionFeedbackVisible ? selectedChoice.isCorrect : false)

                    return (
                      <li
                        className={`quiz-question-card${
                          !isQuestionFeedbackVisible
                            ? ''
                            : isQuestionCorrect
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
                                  isQuestionFeedbackVisible && choice.isCorrect
                                    ? 'quiz-choice-correct'
                                    : '',
                                  isQuestionFeedbackVisible && isSelectedChoice && !choice.isCorrect
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
                        {isQuestionFeedbackVisible ? (
                          <div className="quiz-review">
                            <div className="quiz-review-header">
                              <span
                                className={`quiz-result-badge${
                                  isQuestionCorrect
                                    ? ' quiz-result-badge-correct'
                                    : ' quiz-result-badge-incorrect'
                                }`}
                              >
                                {isQuestionCorrect ? 'Correct' : 'Incorrect'}
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
                              <p>{explanationText ?? 'No explanation available.'}</p>
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
                      : quizResult === null && isTutorModeEnabled
                        ? `${answeredQuestionCount} of ${activeQuiz.questions.length} graded`
                        : quizResult === null
                          ? `${answeredQuestionCount} of ${activeQuiz.questions.length} answered`
                          : 'Attempt submitted'}
                  </p>
                  {quizResult !== null ? (
                    <button
                      className="back-button quiz-bottom-back-button"
                      type="button"
                      onClick={closeQuizTaking}
                    >
                      Back
                    </button>
                  ) : !isViewingStoredAttemptResult ? (
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
                        : quizResult === null && isTutorModeEnabled
                          ? 'Save attempt'
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
            {sortedLessons.map((lesson) => {
              const isEditingLessonTitle = isEditingTitle('lesson', lesson.id)

              return (
                <li className="lesson-item" key={lesson.id}>
                  {isEditingLessonTitle ? (
                    <div className="lesson-title-edit-container">
                      {renderTitleEditForm('lesson')}
                      <span className="lesson-file-name">{lesson.originalFileName}</span>
                      <span className="lesson-imported-date">
                        Imported {formatDate(lesson.createdAt)}
                      </span>
                    </div>
                  ) : (
                    <>
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
                          <span className="lesson-imported-date">
                            Imported {formatDate(lesson.createdAt)}
                          </span>
                        </span>
                      </button>
                      <button
                        className="title-edit-button"
                        type="button"
                        onClick={() => {
                          startTitleEdit('lesson', lesson.id, lesson.title)
                        }}
                        disabled={isSavingTitle}
                      >
                        Edit
                      </button>
                    </>
                  )}
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
              )
            })}
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
                {isEditingTitle('lesson', activeLesson.id) ? (
                  renderTitleEditForm('lesson', 'lesson-detail-heading')
                ) : (
                  <div className="title-display-row">
                    <h2 id="lesson-detail-heading">{activeLesson.title}</h2>
                    <button
                      className="title-edit-button"
                      type="button"
                      onClick={() => {
                        startTitleEdit('lesson', activeLesson.id, activeLesson.title)
                      }}
                      disabled={isSavingTitle}
                    >
                      Edit
                    </button>
                  </div>
                )}
                <p>{activeLesson.originalFileName}</p>
              </div>
              <div className="quiz-create-controls">
                <div className="quiz-create-top-row">
                  <div className="quiz-question-setting">
                    <span className="quiz-setting-label"># of Questions</span>
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
                        <input
                          className="quiz-question-count-input"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={questionCountInput}
                          onChange={(event) => {
                            setQuestionCountInput(event.currentTarget.value)
                          }}
                          aria-label="Question count"
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

            {activeLesson.textExtractionStatus === 'failed' ? (
              <p className="detail-alert" role="alert">
                Text extraction failed. Quiz generation is unavailable for this lesson.
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
                    const isEditingQuizTitle = isEditingTitle('quiz', quiz.id)

                    return (
                      <li className="quiz-list-item" key={quiz.id}>
                        <div className="quiz-item-row">
                          {isEditingQuizTitle ? (
                            <div className="quiz-item">
                              <div className="quiz-title-edit-container">
                                {renderTitleEditForm('quiz')}
                                <span className="quiz-created">
                                  Created {formatDate(quiz.createdAt)}
                                </span>
                                <span className="quiz-metadata">
                                  <span>{formatQuizQuestionCount(quiz.questionCount)}</span>
                                  <span>{formatQuizDifficulty(quiz.difficulty)}</span>
                                </span>
                              </div>
                              <button
                                className="delete-button"
                                type="button"
                                onClick={() => {
                                  void deleteQuiz(quiz)
                                }}
                                disabled={deletingQuizIds.has(quiz.id)}
                              >
                                {deletingQuizIds.has(quiz.id) ? 'Deleting...' : 'Delete'}
                              </button>
                            </div>
                          ) : (
                            <div className="quiz-item">
                              <button
                                className="quiz-open-button"
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
                                  <span className="quiz-metadata">
                                    <span>{formatQuizQuestionCount(quiz.questionCount)}</span>
                                    <span>{formatQuizDifficulty(quiz.difficulty)}</span>
                                  </span>
                                </span>
                              </button>
                              <button
                                className="title-edit-button quiz-title-edit-button"
                                type="button"
                                onClick={() => {
                                  startTitleEdit('quiz', quiz.id, quiz.title)
                                }}
                                disabled={isSavingTitle}
                              >
                                Edit
                              </button>
                              <button
                                className="delete-button"
                                type="button"
                                onClick={() => {
                                  void deleteQuiz(quiz)
                                }}
                                disabled={deletingQuizIds.has(quiz.id)}
                              >
                                {deletingQuizIds.has(quiz.id) ? 'Deleting...' : 'Delete'}
                              </button>
                            </div>
                          )}
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

function sortLessons(
  lessons: LessonRecord[],
  sortField: LessonSortField,
  sortDirection: SortDirection
): LessonRecord[] {
  return [...lessons].sort((firstLesson, secondLesson) => {
    if (sortField === 'createdAt') {
      const dateComparison = compareLessonImportDateAscending(firstLesson, secondLesson)
      const directedDateComparison = sortDirection === 'asc' ? dateComparison : -dateComparison

      if (directedDateComparison !== 0) {
        return directedDateComparison
      }

      return (
        compareLessonTitleAscending(firstLesson, secondLesson) ||
        compareLessonId(firstLesson, secondLesson)
      )
    }

    const titleComparison = compareLessonTitleAscending(firstLesson, secondLesson)
    const directedTitleComparison = sortDirection === 'asc' ? titleComparison : -titleComparison

    if (directedTitleComparison !== 0) {
      return directedTitleComparison
    }

    return (
      -compareLessonImportDateAscending(firstLesson, secondLesson) ||
      compareLessonId(firstLesson, secondLesson)
    )
  })
}

function compareLessonImportDateAscending(
  firstLesson: LessonRecord,
  secondLesson: LessonRecord
): number {
  const firstTime = parseStoredTimestamp(firstLesson.createdAt).getTime()
  const secondTime = parseStoredTimestamp(secondLesson.createdAt).getTime()

  if (Number.isFinite(firstTime) && Number.isFinite(secondTime) && firstTime !== secondTime) {
    return firstTime - secondTime
  }

  return firstLesson.createdAt.localeCompare(secondLesson.createdAt)
}

function compareLessonTitleAscending(
  firstLesson: LessonRecord,
  secondLesson: LessonRecord
): number {
  return lessonTitleCollator.compare(firstLesson.title, secondLesson.title)
}

function compareLessonId(firstLesson: LessonRecord, secondLesson: LessonRecord): number {
  return firstLesson.id.localeCompare(secondLesson.id)
}

function getDefaultLessonSortDirection(sortField: LessonSortField): SortDirection {
  return sortField === 'createdAt' ? 'desc' : 'asc'
}

function getLessonSortFieldLabel(sortField: LessonSortField): string {
  return lessonSortOptions.find((option) => option.id === sortField)?.label ?? 'Import date'
}

function getLessonSortDirectionCurrentLabel(
  sortField: LessonSortField,
  sortDirection: SortDirection
): string {
  if (sortField === 'createdAt') {
    return sortDirection === 'asc' ? 'Oldest first' : 'Newest first'
  }

  return sortDirection === 'asc' ? 'A to Z' : 'Z to A'
}

function getLessonSortDirectionToggleLabel(
  sortField: LessonSortField,
  sortDirection: SortDirection
): string {
  if (sortField === 'createdAt') {
    return sortDirection === 'asc' ? 'Sort newest first' : 'Sort oldest first'
  }

  return sortDirection === 'asc' ? 'Sort Z to A' : 'Sort A to Z'
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

function randomizeQuizForAttempt(quiz: FullQuiz): FullQuiz {
  return {
    ...quiz,
    questions: shuffleItems(quiz.questions).map((question) => ({
      ...question,
      choices: shuffleItems(question.choices)
    }))
  }
}

function shuffleItems<T>(items: readonly T[]): T[] {
  const shuffledItems = [...items]

  for (let index = shuffledItems.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    const currentItem = shuffledItems[index]

    shuffledItems[index] = shuffledItems[randomIndex]
    shuffledItems[randomIndex] = currentItem
  }

  return shuffledItems
}

const timestampTimeZoneSuffixPattern = /(?:Z|[+-]\d{2}:?\d{2})$/i

function parseStoredTimestamp(value: string): Date {
  const normalizedValue = value.trim().replace(' ', 'T')
  const timestampValue = timestampTimeZoneSuffixPattern.test(normalizedValue)
    ? normalizedValue
    : `${normalizedValue}Z`

  return new Date(timestampValue)
}

function formatDate(value: string): string {
  const date = parseStoredTimestamp(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

function formatQuizQuestionCount(questionCount: number): string {
  return `${questionCount} question${questionCount === 1 ? '' : 's'}`
}

function formatQuizDifficulty(difficulty: QuizRecord['difficulty']): string {
  switch (difficulty) {
    case 'easy':
      return 'Easy'
    case 'nbme':
      return 'NBME'
    case 'custom':
      return 'Custom'
    case null:
      return 'Unknown'
  }
}

function formatAttemptScore(attempt: QuizAttempt): string {
  return `${attempt.correctAnswerCount} / ${attempt.totalQuestionCount}`
}

function formatAttemptCompletedDate(attempt: QuizAttempt): string {
  return attempt.completedAt === null ? 'Not completed' : formatDate(attempt.completedAt)
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

function getQuestionExplanationText(explanation: string | null): string | null {
  const trimmedExplanation = explanation?.trim() ?? ''

  if (trimmedExplanation.length === 0) {
    return null
  }

  return trimmedExplanation
}

function getErrorMessage(error: unknown): string {
  if (isAppError(error)) {
    return error.message
  }

  return error instanceof Error ? error.message : String(error)
}

function isAppErrorWithCode(error: unknown, code: AppErrorCode): boolean {
  return isAppError(error) && error.code === code
}

export default App
