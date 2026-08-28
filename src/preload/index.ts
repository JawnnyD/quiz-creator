import { contextBridge, ipcRenderer } from 'electron'
import { AppError, decodeAppErrorFromIpc } from '../shared/errors'
import type { DeleteLessonResult, LessonRecord } from '../shared/lessons'
import type {
  DeleteQuizResult,
  QuizAttempt,
  QuizCreationSettings,
  QuizQuestion,
  QuizRecord,
  QuizResult
} from '../shared/quizzes'
import type {
  ClearOpenAiApiKeyResult,
  OpenAiApiKeyStatus,
  SaveOpenAiApiKeyResult
} from '../shared/settings'

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

async function invokeAppApi<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T
  } catch (error) {
    const appError = decodeAppErrorFromIpc(error)

    if (appError !== null) {
      throw appError
    }

    throw new AppError('unexpected', 'Something went wrong.')
  }
}

const api = {
  importLessonPdf: (): Promise<LessonRecord | null> =>
    invokeAppApi<LessonRecord | null>('lessons:importPdf'),
  listLessons: (): Promise<LessonRecord[]> => invokeAppApi<LessonRecord[]>('lessons:list'),
  updateLessonTitle: (id: string, title: string): Promise<LessonRecord> =>
    invokeAppApi<LessonRecord>('lessons:updateTitle', id, title),
  deleteLesson: (id: string): Promise<DeleteLessonResult> =>
    invokeAppApi<DeleteLessonResult>('lessons:delete', id),
  getOpenAiApiKeyStatus: (): Promise<OpenAiApiKeyStatus> =>
    invokeAppApi<OpenAiApiKeyStatus>('settings:getOpenAiApiKeyStatus'),
  saveOpenAiApiKey: (apiKey: string): Promise<SaveOpenAiApiKeyResult> =>
    invokeAppApi<SaveOpenAiApiKeyResult>('settings:saveOpenAiApiKey', apiKey),
  clearOpenAiApiKey: (): Promise<ClearOpenAiApiKeyResult> =>
    invokeAppApi<ClearOpenAiApiKeyResult>('settings:clearOpenAiApiKey'),
  createQuiz: (input: GenerateTemporaryQuizInput): Promise<FullQuiz> =>
    invokeAppApi<FullQuiz>('quizzes:create', input),
  listQuizzesForLesson: (lessonId: string): Promise<QuizRecord[]> =>
    invokeAppApi<QuizRecord[]>('quizzes:listForLesson', lessonId),
  updateQuizTitle: (id: string, title: string): Promise<QuizRecord> =>
    invokeAppApi<QuizRecord>('quizzes:updateTitle', id, title),
  deleteQuiz: (id: string): Promise<DeleteQuizResult> =>
    invokeAppApi<DeleteQuizResult>('quizzes:delete', id),
  listQuizAttemptsForLesson: (lessonId: string): Promise<QuizAttempt[]> =>
    invokeAppApi<QuizAttempt[]>('quizzes:listAttemptsForLesson', lessonId),
  getQuiz: (quizId: string): Promise<FullQuiz | null> =>
    invokeAppApi<FullQuiz | null>('quizzes:get', quizId),
  getQuizAttemptResult: (attemptId: string): Promise<QuizResult | null> =>
    invokeAppApi<QuizResult | null>('quizzes:getAttemptResult', attemptId),
  submitQuizAttempt: (quizId: string, answers: QuizAnswerSubmission[]): Promise<QuizResult> =>
    invokeAppApi<QuizResult>('quizzes:submitAttempt', quizId, answers)
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
