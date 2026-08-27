import type {
  DeleteQuizResult,
  QuizAttempt,
  QuizQuestion,
  QuizRecord,
  QuizResult
} from '../../shared/quizzes'

import { initializeDatabase } from '../db'
import {
  generateTemporaryQuizFromLessonTextFromDatabase,
  type GenerateTemporaryQuizInput
} from './generator'
import {
  createQuizRecordFromDatabase,
  deleteQuizFromDatabase,
  gradeQuizAnswersFromDatabase,
  listQuizAttemptsForLessonFromDatabase,
  listQuizzesForLessonFromDatabase,
  loadFullQuizFromDatabase,
  loadQuizAttemptResultFromDatabase,
  saveQuizQuestionsFromDatabase,
  submitQuizAttemptFromDatabase,
  updateQuizTitleFromDatabase,
  type CreateQuizRecordInput,
  type FullQuiz,
  type QuizAnswerSubmission,
  type SaveQuizQuestionsInput
} from './service'

export type {
  QuizAttempt,
  QuizChoice,
  QuizCreationSettings,
  DeleteQuizResult,
  QuizDifficulty,
  QuizQuestion,
  QuizRecord,
  QuizResult
} from '../../shared/quizzes'
export type {
  CreateQuizRecordInput,
  FullQuiz,
  QuizAnswerSubmission,
  SaveQuizQuestionsInput
} from './service'
export type { GenerateTemporaryQuizInput } from './generator'
export { generateTemporaryQuizFromLessonTextFromDatabase } from './generator'
export {
  createQuizRecordFromDatabase,
  deleteQuizFromDatabase,
  gradeQuizAnswersFromDatabase,
  listQuizAttemptsForLessonFromDatabase,
  listQuizzesForLessonFromDatabase,
  loadFullQuizFromDatabase,
  loadQuizAttemptResultFromDatabase,
  saveQuizQuestionsFromDatabase,
  submitQuizAttemptFromDatabase,
  updateQuizTitleFromDatabase
} from './service'

export function createQuizRecord(input: CreateQuizRecordInput): QuizRecord {
  return createQuizRecordFromDatabase(initializeDatabase(), input)
}

export function saveQuizQuestions(input: SaveQuizQuestionsInput): QuizQuestion[] {
  return saveQuizQuestionsFromDatabase(initializeDatabase(), input)
}

export function listQuizzesForLesson(lessonId: string): QuizRecord[] {
  return listQuizzesForLessonFromDatabase(initializeDatabase(), lessonId)
}

export function updateQuizTitle(quizId: string, title: string): QuizRecord {
  return updateQuizTitleFromDatabase(initializeDatabase(), quizId, title)
}

export function deleteQuiz(quizId: string): DeleteQuizResult {
  return deleteQuizFromDatabase(initializeDatabase(), quizId)
}

export function listQuizAttemptsForLesson(lessonId: string): QuizAttempt[] {
  return listQuizAttemptsForLessonFromDatabase(initializeDatabase(), lessonId)
}

export function loadFullQuiz(quizId: string): FullQuiz | null {
  return loadFullQuizFromDatabase(initializeDatabase(), quizId)
}

export function loadQuizAttemptResult(attemptId: string): QuizResult | null {
  return loadQuizAttemptResultFromDatabase(initializeDatabase(), attemptId)
}

export function gradeQuizAnswers(quizId: string, answers: QuizAnswerSubmission[]): QuizResult {
  return gradeQuizAnswersFromDatabase(initializeDatabase(), quizId, answers)
}

export function submitQuizAttempt(quizId: string, answers: QuizAnswerSubmission[]): QuizResult {
  return submitQuizAttemptFromDatabase(initializeDatabase(), quizId, answers)
}

export async function generateTemporaryQuizFromLessonText(
  input: GenerateTemporaryQuizInput
): Promise<FullQuiz> {
  return generateTemporaryQuizFromLessonTextFromDatabase(initializeDatabase(), input)
}
