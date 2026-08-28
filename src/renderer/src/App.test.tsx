// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LessonRecord } from '../../shared/lessons'
import type { QuizAttempt, QuizRecord, QuizResult } from '../../shared/quizzes'
import App from './App'

type AppAPI = Window['api']
type FullQuiz = NonNullable<Awaited<ReturnType<AppAPI['getQuiz']>>>
type QuizAnswerSubmission = Parameters<AppAPI['submitQuizAttempt']>[1][number]

const timestamp = '2026-01-01 12:00:00'

describe('App quiz taking flows', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows tutor feedback and saves the attempt from tutor mode', async () => {
    const lesson = createLesson()
    const quiz = createQuiz()
    const fullQuiz = createFullQuiz(quiz)
    const savedResult = createQuizResult(fullQuiz)
    const api = createApi({
      listLessons: vi.fn(async () => [lesson]),
      listQuizzesForLesson: vi.fn(async () => [quiz]),
      getQuiz: vi.fn(async () => fullQuiz),
      submitQuizAttempt: vi.fn(async () => savedResult)
    })
    setWindowApi(api)

    render(<App />)

    fireEvent.click(await screen.findByText('Cardiology'))
    fireEvent.click(await screen.findByText('Cardiology Quiz'))
    await screen.findByText('Which chamber pumps blood to the aorta?')
    fireEvent.click(screen.getByLabelText('Tutor mode'))
    fireEvent.click(screen.getByLabelText('Right ventricle'))

    expect(await screen.findByText('Incorrect')).toBeTruthy()
    expect(screen.getByText('Correct answer')).toBeTruthy()
    expect(screen.getAllByText('Left ventricle').length).toBeGreaterThan(0)
    expect(screen.getByText('The left ventricle pumps blood to the aorta.')).toBeTruthy()
    expect(screen.getByText('1 of 1 graded')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Save attempt' }))

    await waitFor(() => {
      expect(api.submitQuizAttempt).toHaveBeenCalledWith(quiz.id, [
        {
          questionId: 'question-1',
          selectedChoiceId: 'choice-wrong'
        }
      ] satisfies QuizAnswerSubmission[])
    })
    expect(await screen.findByText('Score: 0 / 1')).toBeTruthy()
  })
})

describe('App lesson sorting', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('sorts lessons by import date and title in both directions', async () => {
    setWindowApi(
      createApi({
        listLessons: vi.fn(async () => [
          createLesson({
            id: 'lesson-old',
            title: 'alpha 10',
            originalFileName: 'alpha-10.pdf',
            createdAt: '2026-01-01 12:00:00'
          }),
          createLesson({
            id: 'lesson-new',
            title: 'Alpha 2',
            originalFileName: 'alpha-2.pdf',
            createdAt: '2026-01-03 12:00:00'
          }),
          createLesson({
            id: 'lesson-middle',
            title: 'Zebra 2',
            originalFileName: 'zebra-2.pdf',
            createdAt: '2026-01-02 12:00:00'
          })
        ])
      })
    )

    render(<App />)

    await screen.findByRole('list', { name: 'Imported lessons' })
    expect(getRenderedLessonTitles()).toEqual(['Alpha 2', 'Zebra 2', 'alpha 10'])

    selectSortOption('Import date', 'Title')
    expect(getRenderedLessonTitles()).toEqual(['Alpha 2', 'alpha 10', 'Zebra 2'])

    fireEvent.click(getSortDirectionButton('Sort Z to A'))
    expect(getRenderedLessonTitles()).toEqual(['Zebra 2', 'alpha 10', 'Alpha 2'])

    selectSortOption('Title', 'Import date')
    expect(getRenderedLessonTitles()).toEqual(['Alpha 2', 'Zebra 2', 'alpha 10'])

    fireEvent.click(getSortDirectionButton('Sort oldest first'))
    expect(getRenderedLessonTitles()).toEqual(['alpha 10', 'Zebra 2', 'Alpha 2'])
  })
})

describe('App quiz sorting', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('sorts quizzes by creation date, title, and recent attempts', async () => {
    const lesson = createLesson()
    const quizzes = [
      createQuiz({
        id: 'quiz-old',
        title: 'alpha 10',
        createdAt: '2026-01-01 12:00:00'
      }),
      createQuiz({
        id: 'quiz-new',
        title: 'Alpha 2',
        createdAt: '2026-01-03 12:00:00'
      }),
      createQuiz({
        id: 'quiz-middle',
        title: 'Zebra 2',
        createdAt: '2026-01-02 12:00:00'
      }),
      createQuiz({
        id: 'quiz-never',
        title: 'Beta 1',
        createdAt: '2026-01-04 12:00:00'
      })
    ]

    setWindowApi(
      createApi({
        listLessons: vi.fn(async () => [lesson]),
        listQuizzesForLesson: vi.fn(async () => quizzes),
        listQuizAttemptsForLesson: vi.fn(async () => [
          createAttempt({
            id: 'attempt-old',
            quizId: 'quiz-old',
            completedAt: '2026-01-04 12:00:00'
          }),
          createAttempt({
            id: 'attempt-new-earlier',
            quizId: 'quiz-new',
            completedAt: '2026-01-05 12:00:00'
          }),
          createAttempt({
            id: 'attempt-middle',
            quizId: 'quiz-middle',
            completedAt: '2026-01-07 12:00:00'
          }),
          createAttempt({
            id: 'attempt-new-latest',
            quizId: 'quiz-new',
            completedAt: '2026-01-08 12:00:00'
          })
        ])
      })
    )

    render(<App />)

    fireEvent.click(await screen.findByText('Cardiology'))
    await screen.findByRole('list', { name: 'Saved quizzes' })
    expect(getRenderedQuizTitles()).toEqual(['Beta 1', 'Alpha 2', 'Zebra 2', 'alpha 10'])

    selectSortOption('Created at', 'Title')
    expect(getRenderedQuizTitles()).toEqual(['Alpha 2', 'alpha 10', 'Beta 1', 'Zebra 2'])

    fireEvent.click(getSortDirectionButton('Sort Z to A'))
    expect(getRenderedQuizTitles()).toEqual(['Zebra 2', 'Beta 1', 'alpha 10', 'Alpha 2'])

    selectSortOption('Title', 'Created at')
    expect(getRenderedQuizTitles()).toEqual(['Beta 1', 'Alpha 2', 'Zebra 2', 'alpha 10'])

    fireEvent.click(getSortDirectionButton('Sort oldest first'))
    expect(getRenderedQuizTitles()).toEqual(['alpha 10', 'Zebra 2', 'Alpha 2', 'Beta 1'])

    selectSortOption('Created at', 'Recently attempted')
    expect(getRenderedQuizTitles()).toEqual(['Alpha 2', 'Zebra 2', 'alpha 10', 'Beta 1'])

    fireEvent.click(getSortDirectionButton('Sort least recently attempted first'))
    expect(getRenderedQuizTitles()).toEqual(['alpha 10', 'Zebra 2', 'Alpha 2', 'Beta 1'])
  })
})

function createApi(overrides: Partial<AppAPI> = {}): AppAPI {
  return {
    importLessonPdf: vi.fn(async () => null),
    listLessons: vi.fn(async () => []),
    updateLessonTitle: vi.fn(),
    deleteLesson: vi.fn(),
    createQuiz: vi.fn(),
    listQuizzesForLesson: vi.fn(async () => []),
    updateQuizTitle: vi.fn(),
    deleteQuiz: vi.fn(),
    listQuizAttemptsForLesson: vi.fn(async () => []),
    getQuiz: vi.fn(async () => null),
    getQuizAttemptResult: vi.fn(async () => null),
    submitQuizAttempt: vi.fn(),
    ...overrides
  } as AppAPI
}

function setWindowApi(api: AppAPI): void {
  Object.defineProperty(window, 'api', {
    value: api,
    configurable: true
  })
}

function selectSortOption(currentSortLabel: string, optionLabel: string): void {
  fireEvent.click(screen.getByRole('button', { name: `Sort by ${currentSortLabel}` }))
  fireEvent.click(screen.getByRole('option', { name: optionLabel }))
}

function getSortDirectionButton(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name })
}

function getRenderedLessonTitles(): string[] {
  return Array.from(document.querySelectorAll('.lesson-title-text')).map(
    (element) => element.textContent ?? ''
  )
}

function getRenderedQuizTitles(): string[] {
  return Array.from(document.querySelectorAll('.quiz-title')).map(
    (element) => element.textContent ?? ''
  )
}

function createLesson(overrides: Partial<LessonRecord> = {}): LessonRecord {
  return {
    id: 'lesson-1',
    title: 'Cardiology',
    originalFileName: 'cardiology.pdf',
    storedRelativePath: 'lesson-pdfs/cardiology.pdf',
    contentHash: 'cardiology-hash',
    sizeBytes: 123,
    textExtractionStatus: 'completed',
    textPageCount: 1,
    textCharacterCount: 100,
    textExtractionError: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

function createQuiz(overrides: Partial<QuizRecord> = {}): QuizRecord {
  return {
    id: 'quiz-1',
    lessonId: 'lesson-1',
    title: 'Cardiology Quiz',
    difficulty: 'easy',
    questionCount: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

function createAttempt(overrides: Partial<QuizAttempt> = {}): QuizAttempt {
  return {
    id: 'attempt-1',
    quizId: 'quiz-1',
    startedAt: timestamp,
    completedAt: timestamp,
    correctAnswerCount: 1,
    totalQuestionCount: 1,
    ...overrides
  }
}

function createFullQuiz(quiz: QuizRecord): FullQuiz {
  return {
    quiz,
    questions: [
      {
        id: 'question-1',
        quizId: quiz.id,
        prompt: 'Which chamber pumps blood to the aorta?',
        explanation: 'The left ventricle pumps blood to the aorta.',
        sortOrder: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
        choices: [
          {
            id: 'choice-correct',
            questionId: 'question-1',
            choiceText: 'Left ventricle',
            isCorrect: true,
            sortOrder: 0,
            createdAt: timestamp,
            updatedAt: timestamp
          },
          {
            id: 'choice-wrong',
            questionId: 'question-1',
            choiceText: 'Right ventricle',
            isCorrect: false,
            sortOrder: 1,
            createdAt: timestamp,
            updatedAt: timestamp
          }
        ]
      }
    ]
  }
}

function createQuizResult(fullQuiz: FullQuiz): QuizResult {
  const attempt: QuizAttempt = {
    id: 'attempt-1',
    quizId: fullQuiz.quiz.id,
    startedAt: timestamp,
    completedAt: timestamp,
    correctAnswerCount: 0,
    totalQuestionCount: 1
  }

  return {
    quiz: fullQuiz.quiz,
    attempt,
    answers: [
      {
        question: fullQuiz.questions[0],
        selectedChoiceId: 'choice-wrong',
        isCorrect: false,
        answeredAt: timestamp
      }
    ]
  }
}
