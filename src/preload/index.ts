import { contextBridge, ipcRenderer } from 'electron'
import type { DeleteLessonResult, LessonRecord } from '../shared/lessons'
import type {
  QuizAttempt,
  QuizCreationSettings,
  QuizQuestion,
  QuizRecord,
  QuizResult
} from '../shared/quizzes'

interface FullQuiz {
  quiz: QuizRecord
  questions: QuizQuestion[]
}

interface GenerateTemporaryQuizInput {
  lessonId: string
  title?: string
  settings?: Partial<QuizCreationSettings>
}

interface QuizAnswerSubmission {
  questionId: string
  selectedChoiceId: string
}

const api = {
  importLessonPdf: (): Promise<LessonRecord | null> => ipcRenderer.invoke('lessons:importPdf'),
  listLessons: (): Promise<LessonRecord[]> => ipcRenderer.invoke('lessons:list'),
  updateLessonTitle: (id: string, title: string): Promise<LessonRecord> =>
    ipcRenderer.invoke('lessons:updateTitle', id, title),
  deleteLesson: (id: string): Promise<DeleteLessonResult> =>
    ipcRenderer.invoke('lessons:delete', id),
  createQuiz: (input: GenerateTemporaryQuizInput): Promise<FullQuiz> =>
    ipcRenderer.invoke('quizzes:create', input),
  listQuizzesForLesson: (lessonId: string): Promise<QuizRecord[]> =>
    ipcRenderer.invoke('quizzes:listForLesson', lessonId),
  updateQuizTitle: (id: string, title: string): Promise<QuizRecord> =>
    ipcRenderer.invoke('quizzes:updateTitle', id, title),
  listQuizAttemptsForLesson: (lessonId: string): Promise<QuizAttempt[]> =>
    ipcRenderer.invoke('quizzes:listAttemptsForLesson', lessonId),
  getQuiz: (quizId: string): Promise<FullQuiz | null> => ipcRenderer.invoke('quizzes:get', quizId),
  getQuizAttemptResult: (attemptId: string): Promise<QuizResult | null> =>
    ipcRenderer.invoke('quizzes:getAttemptResult', attemptId),
  submitQuizAttempt: (quizId: string, answers: QuizAnswerSubmission[]): Promise<QuizResult> =>
    ipcRenderer.invoke('quizzes:submitAttempt', quizId, answers)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  const globalWindow = window as Window & typeof globalThis & { api: typeof api }

  globalWindow.api = api
}
