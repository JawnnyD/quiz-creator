import type { QuizAttempt, QuizQuestion, QuizRecord, QuizResult } from '../../shared/quizzes'

import { initializeDatabase } from '../db'
import {
  generateTemporaryQuizFromLessonTextFromDatabase,
  type GenerateTemporaryQuizInput
} from './generator'
import {
  createQuizRecordFromDatabase,
  gradeQuizAnswersFromDatabase,
  listQuizAttemptsForLessonFromDatabase,
  listQuizzesForLessonFromDatabase,
  loadFullQuizFromDatabase,
  loadQuizAttemptResultFromDatabase,
  saveQuizQuestionsFromDatabase,
  submitQuizAttemptFromDatabase,
  type CreateQuizRecordInput,
  type FullQuiz,
  type QuizAnswerSubmission,
  type SaveQuizQuestionsInput
} from './service'

export type {
  QuizAttempt,
  QuizChoice,
  QuizCreationSettings,
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
  gradeQuizAnswersFromDatabase,
  listQuizAttemptsForLessonFromDatabase,
  listQuizzesForLessonFromDatabase,
  loadFullQuizFromDatabase,
  loadQuizAttemptResultFromDatabase,
  saveQuizQuestionsFromDatabase,
  submitQuizAttemptFromDatabase
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

export function generateTemporaryQuizFromLessonText(input: GenerateTemporaryQuizInput): FullQuiz {
  return generateTemporaryQuizFromLessonTextFromDatabase(initializeDatabase(), input)
}
