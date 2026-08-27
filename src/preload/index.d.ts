import type { DeleteLessonResult, LessonRecord } from '../shared/lessons'
import type {
  DeleteQuizResult,
  QuizAttempt,
  QuizCreationSettings,
  QuizQuestion,
  QuizRecord,
  QuizResult
} from '../shared/quizzes'

export interface FullQuiz {
  quiz: QuizRecord
  questions: QuizQuestion[]
}

export interface GenerateTemporaryQuizInput {
  lessonId: string
  title?: string
  settings?: Partial<QuizCreationSettings>
}

export interface QuizAnswerSubmission {
  questionId: string
  selectedChoiceId: string
}

export interface AppAPI {
  importLessonPdf: () => Promise<LessonRecord | null>
  listLessons: () => Promise<LessonRecord[]>
  updateLessonTitle: (id: string, title: string) => Promise<LessonRecord>
  deleteLesson: (id: string) => Promise<DeleteLessonResult>
  createQuiz: (input: GenerateTemporaryQuizInput) => Promise<FullQuiz>
  listQuizzesForLesson: (lessonId: string) => Promise<QuizRecord[]>
  updateQuizTitle: (id: string, title: string) => Promise<QuizRecord>
  deleteQuiz: (id: string) => Promise<DeleteQuizResult>
  listQuizAttemptsForLesson: (lessonId: string) => Promise<QuizAttempt[]>
  getQuiz: (quizId: string) => Promise<FullQuiz | null>
  getQuizAttemptResult: (attemptId: string) => Promise<QuizResult | null>
  submitQuizAttempt: (quizId: string, answers: QuizAnswerSubmission[]) => Promise<QuizResult>
}

declare global {
  interface Window {
    api: AppAPI
  }
}
