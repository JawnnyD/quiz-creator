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

function createLesson(): LessonRecord {
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
    updatedAt: timestamp
  }
}

function createQuiz(): QuizRecord {
  return {
    id: 'quiz-1',
    lessonId: 'lesson-1',
    title: 'Cardiology Quiz',
    difficulty: 'easy',
    questionCount: 1,
    createdAt: timestamp,
    updatedAt: timestamp
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
