import { contextBridge, ipcRenderer } from 'electron'
import type { DeleteLessonResult, LessonRecord } from '../shared/lessons'
import type {
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
  deleteLesson: (id: string): Promise<DeleteLessonResult> =>
    ipcRenderer.invoke('lessons:delete', id),
  createQuiz: (input: GenerateTemporaryQuizInput): Promise<FullQuiz> =>
    ipcRenderer.invoke('quizzes:create', input),
  listQuizzesForLesson: (lessonId: string): Promise<QuizRecord[]> =>
    ipcRenderer.invoke('quizzes:listForLesson', lessonId),
  getQuiz: (quizId: string): Promise<FullQuiz | null> =>
    ipcRenderer.invoke('quizzes:get', quizId),
  submitQuizAttempt: (
    quizId: string,
    answers: QuizAnswerSubmission[]
  ): Promise<QuizResult> => ipcRenderer.invoke('quizzes:submitAttempt', quizId, answers)
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
