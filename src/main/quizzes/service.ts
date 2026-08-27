import { randomUUID } from 'crypto'
import type { DatabaseSync } from 'node:sqlite'

import { AppError } from '../../shared/errors'
import type {
  DeleteQuizResult,
  QuizAttempt,
  QuizChoice,
  QuizDifficulty,
  QuizQuestion,
  QuizRecord,
  QuizResult
} from '../../shared/quizzes'

const quizColumns = `
  quizzes.id AS id,
  quizzes.lesson_id AS lesson_id,
  quizzes.title AS title,
  quizzes.difficulty AS difficulty,
  (
    SELECT COUNT(*)
    FROM quiz_questions
    WHERE quiz_questions.quiz_id = quizzes.id
  ) AS question_count,
  quizzes.created_at AS created_at,
  quizzes.updated_at AS updated_at
`

export interface CreateQuizRecordInput {
  lessonId: string
  title: string
  difficulty?: QuizDifficulty | null
}

export interface SaveQuizQuestionsInput {
  quizId: string
  questions: SaveQuizQuestionInput[]
}

export interface SaveQuizQuestionInput {
  prompt: string
  explanation?: string | null
  choices: SaveQuizChoiceInput[]
}

export interface SaveQuizChoiceInput {
  choiceText: string
  isCorrect: boolean
}

export interface QuizAnswerSubmission {
  questionId: string
  selectedChoiceId: string
}

export interface FullQuiz {
  quiz: QuizRecord
  questions: QuizQuestion[]
}

interface QuizRow {
  id: string
  lesson_id: string
  title: string
  difficulty: string | null
  question_count: number
  created_at: string
  updated_at: string
}

interface QuizQuestionRow {
  id: string
  quiz_id: string
  prompt: string
  explanation: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

interface QuizChoiceRow {
  id: string
  question_id: string
  choice_text: string
  is_correct: number
  sort_order: number
  created_at: string
  updated_at: string
}

interface QuizAttemptRow {
  id: string
  quiz_id: string
  started_at: string
  completed_at: string | null
  correct_answer_count: number
  total_question_count: number
}

interface QuizAttemptAnswerRow {
  question_id: string
  selected_choice_id: string | null
  is_correct: number
  answered_at: string
}

interface ValidatedQuestionInput {
  prompt: string
  explanation: string | null
  choices: ValidatedChoiceInput[]
}

interface ValidatedChoiceInput {
  choiceText: string
  isCorrect: boolean
}

export function createQuizRecordFromDatabase(
  connection: DatabaseSync,
  input: CreateQuizRecordInput
): QuizRecord {
  const lessonId = input.lessonId.trim()
  const title = input.title.trim()
  const difficulty = normalizeQuizDifficulty(input.difficulty)

  if (lessonId.length === 0) {
    throw new AppError('validation_failed', 'Lesson id is required to create a quiz.')
  }

  if (title.length === 0) {
    throw new AppError('validation_failed', 'Quiz title is required.')
  }

  if (!lessonExists(connection, lessonId)) {
    throw new AppError('lesson_not_found', 'This lesson is no longer available.')
  }

  const id = randomUUID()

  connection
    .prepare(
      `
        INSERT INTO quizzes (id, lesson_id, title, difficulty)
        VALUES (?, ?, ?, ?)
      `
    )
    .run(id, lessonId, title, difficulty)

  const quiz = findQuizById(connection, id)

  if (quiz === null) {
    throw new AppError('unexpected', 'The created quiz could not be loaded.')
  }

  return quiz
}

export function saveQuizQuestionsFromDatabase(
  connection: DatabaseSync,
  input: SaveQuizQuestionsInput
): QuizQuestion[] {
  const quizId = input.quizId.trim()
  const questions = validateQuestionInputs(input.questions)

  if (quizId.length === 0) {
    throw new AppError('validation_failed', 'Quiz id is required to save quiz questions.')
  }

  try {
    connection.exec('BEGIN IMMEDIATE')

    if (findQuizById(connection, quizId) === null) {
      throw new AppError('quiz_not_found', 'This quiz is no longer available.')
    }

    if (quizHasAttempts(connection, quizId)) {
      throw new AppError('validation_failed', 'Cannot replace questions after attempts exist.')
    }

    connection.prepare('DELETE FROM quiz_questions WHERE quiz_id = ?').run(quizId)

    const insertQuestion = connection.prepare(
      `
        INSERT INTO quiz_questions (id, quiz_id, prompt, explanation, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `
    )
    const insertChoice = connection.prepare(
      `
        INSERT INTO quiz_question_choices (
          id,
          question_id,
          choice_text,
          is_correct,
          sort_order
        )
        VALUES (?, ?, ?, ?, ?)
      `
    )

    questions.forEach((question, questionIndex) => {
      const questionId = randomUUID()

      insertQuestion.run(questionId, quizId, question.prompt, question.explanation, questionIndex)

      question.choices.forEach((choice, choiceIndex) => {
        insertChoice.run(
          randomUUID(),
          questionId,
          choice.choiceText,
          choice.isCorrect ? 1 : 0,
          choiceIndex
        )
      })
    })

    connection.exec('COMMIT')
  } catch (error) {
    rollbackTransaction(connection)
    throw error
  }

  const fullQuiz = loadFullQuizFromDatabase(connection, quizId)

  if (fullQuiz === null) {
    throw new AppError('quiz_not_found', 'This quiz is no longer available.')
  }

  return fullQuiz.questions
}

export function listQuizzesForLessonFromDatabase(
  connection: DatabaseSync,
  lessonId: string
): QuizRecord[] {
  const normalizedLessonId = lessonId.trim()

  if (normalizedLessonId.length === 0) {
    throw new AppError('validation_failed', 'Lesson id is required to load quizzes.')
  }

  if (!lessonExists(connection, normalizedLessonId)) {
    throw new AppError('lesson_not_found', 'This lesson is no longer available.')
  }

  const rows = connection
    .prepare(
      `
        SELECT ${quizColumns}
        FROM quizzes
        WHERE lesson_id = ?
        ORDER BY created_at DESC, title ASC
      `
    )
    .all(normalizedLessonId) as unknown as QuizRow[]

  return rows.map(mapQuizRow)
}

export function updateQuizTitleFromDatabase(
  connection: DatabaseSync,
  quizId: string,
  title: string
): QuizRecord {
  const normalizedQuizId = quizId.trim()
  const normalizedTitle = title.trim()

  if (normalizedQuizId.length === 0) {
    throw new AppError('validation_failed', 'Quiz id is required to update a quiz title.')
  }

  if (normalizedTitle.length === 0) {
    throw new AppError('validation_failed', 'Quiz title is required.')
  }

  if (findQuizById(connection, normalizedQuizId) === null) {
    throw new AppError('quiz_not_found', 'This quiz is no longer available.')
  }

  connection
    .prepare(
      `
        UPDATE quizzes
        SET title = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    )
    .run(normalizedTitle, normalizedQuizId)

  const updatedQuiz = findQuizById(connection, normalizedQuizId)

  if (updatedQuiz === null) {
    throw new AppError('quiz_not_found', 'This quiz is no longer available.')
  }

  return updatedQuiz
}

export function deleteQuizFromDatabase(connection: DatabaseSync, quizId: string): DeleteQuizResult {
  const normalizedQuizId = quizId.trim()

  if (normalizedQuizId.length === 0) {
    throw new AppError('validation_failed', 'Quiz id is required to delete a quiz.')
  }

  if (findQuizById(connection, normalizedQuizId) === null) {
    return {
      deleted: false
    }
  }

  connection.prepare('DELETE FROM quizzes WHERE id = ?').run(normalizedQuizId)

  return {
    deleted: true
  }
}

export function listQuizAttemptsForLessonFromDatabase(
  connection: DatabaseSync,
  lessonId: string
): QuizAttempt[] {
  const normalizedLessonId = lessonId.trim()

  if (normalizedLessonId.length === 0) {
    throw new AppError('validation_failed', 'Lesson id is required to load quiz attempts.')
  }

  if (!lessonExists(connection, normalizedLessonId)) {
    throw new AppError('lesson_not_found', 'This lesson is no longer available.')
  }

  const rows = connection
    .prepare(
      `
        SELECT
          quiz_attempts.id,
          quiz_attempts.quiz_id,
          quiz_attempts.started_at,
          quiz_attempts.completed_at,
          quiz_attempts.correct_answer_count,
          quiz_attempts.total_question_count
        FROM quiz_attempts
        INNER JOIN quizzes ON quizzes.id = quiz_attempts.quiz_id
        WHERE quizzes.lesson_id = ?
          AND quiz_attempts.completed_at IS NOT NULL
        ORDER BY quiz_attempts.completed_at DESC, quiz_attempts.started_at DESC
      `
    )
    .all(normalizedLessonId) as unknown as QuizAttemptRow[]

  return rows.map(mapQuizAttemptRow)
}

export function loadFullQuizFromDatabase(
  connection: DatabaseSync,
  quizId: string
): FullQuiz | null {
  const quiz = findQuizById(connection, quizId)

  if (quiz === null) {
    return null
  }

  return {
    quiz,
    questions: loadQuestionsForQuiz(connection, quizId)
  }
}

export function loadQuizAttemptResultFromDatabase(
  connection: DatabaseSync,
  attemptId: string
): QuizResult | null {
  const normalizedAttemptId = attemptId.trim()

  if (
    normalizedAttemptId.length === 0 ||
    !completedQuizAttemptExists(connection, normalizedAttemptId)
  ) {
    return null
  }

  return loadQuizResultFromDatabase(connection, normalizedAttemptId)
}

export function gradeQuizAnswersFromDatabase(
  connection: DatabaseSync,
  quizId: string,
  answers: QuizAnswerSubmission[]
): QuizResult {
  return submitQuizAttemptFromDatabase(connection, quizId, answers)
}

export function submitQuizAttemptFromDatabase(
  connection: DatabaseSync,
  quizId: string,
  answers: QuizAnswerSubmission[]
): QuizResult {
  const normalizedQuizId = quizId.trim()
  const attemptId = randomUUID()

  if (normalizedQuizId.length === 0) {
    throw new AppError('validation_failed', 'Quiz id is required to submit an attempt.')
  }

  try {
    connection.exec('BEGIN IMMEDIATE')

    const fullQuiz = loadFullQuizFromDatabase(connection, normalizedQuizId)

    if (fullQuiz === null) {
      throw new AppError('quiz_not_found', 'This quiz is no longer available.')
    }

    const gradedAnswers = validateAndGradeAnswers(fullQuiz, answers)
    const correctAnswerCount = gradedAnswers.filter((answer) => answer.isCorrect).length

    connection
      .prepare(
        `
          INSERT INTO quiz_attempts (
            id,
            quiz_id,
            completed_at,
            correct_answer_count,
            total_question_count
          )
          VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?)
        `
      )
      .run(attemptId, normalizedQuizId, correctAnswerCount, fullQuiz.questions.length)

    const insertAnswer = connection.prepare(
      `
        INSERT INTO quiz_attempt_answers (
          attempt_id,
          question_id,
          selected_choice_id,
          is_correct
        )
        VALUES (?, ?, ?, ?)
      `
    )

    for (const answer of gradedAnswers) {
      insertAnswer.run(
        attemptId,
        answer.questionId,
        answer.selectedChoiceId,
        answer.isCorrect ? 1 : 0
      )
    }

    connection.exec('COMMIT')
  } catch (error) {
    rollbackTransaction(connection)
    throw error
  }

  return loadQuizResultFromDatabase(connection, attemptId)
}

function lessonExists(connection: DatabaseSync, lessonId: string): boolean {
  const row = connection.prepare('SELECT 1 FROM lessons WHERE id = ?').get(lessonId) as unknown as
    { 1: number } | undefined

  return row !== undefined
}

function findQuizById(connection: DatabaseSync, quizId: string): QuizRecord | null {
  const row = connection
    .prepare(
      `
        SELECT ${quizColumns}
        FROM quizzes
        WHERE id = ?
      `
    )
    .get(quizId) as unknown as QuizRow | undefined

  return row === undefined ? null : mapQuizRow(row)
}

function quizHasAttempts(connection: DatabaseSync, quizId: string): boolean {
  const row = connection
    .prepare(
      `
        SELECT 1
        FROM quiz_attempts
        WHERE quiz_id = ?
        LIMIT 1
      `
    )
    .get(quizId) as unknown as { 1: number } | undefined

  return row !== undefined
}

function completedQuizAttemptExists(connection: DatabaseSync, attemptId: string): boolean {
  const row = connection
    .prepare(
      `
        SELECT 1
        FROM quiz_attempts
        WHERE id = ?
          AND completed_at IS NOT NULL
        LIMIT 1
      `
    )
    .get(attemptId) as unknown as { 1: number } | undefined

  return row !== undefined
}

function loadQuestionsForQuiz(connection: DatabaseSync, quizId: string): QuizQuestion[] {
  const questionRows = connection
    .prepare(
      `
        SELECT id, quiz_id, prompt, explanation, sort_order, created_at, updated_at
        FROM quiz_questions
        WHERE quiz_id = ?
        ORDER BY sort_order ASC
      `
    )
    .all(quizId) as unknown as QuizQuestionRow[]
  const choiceRows = connection
    .prepare(
      `
        SELECT
          quiz_question_choices.id,
          quiz_question_choices.question_id,
          quiz_question_choices.choice_text,
          quiz_question_choices.is_correct,
          quiz_question_choices.sort_order,
          quiz_question_choices.created_at,
          quiz_question_choices.updated_at
        FROM quiz_question_choices
        INNER JOIN quiz_questions ON quiz_questions.id = quiz_question_choices.question_id
        WHERE quiz_questions.quiz_id = ?
        ORDER BY quiz_questions.sort_order ASC, quiz_question_choices.sort_order ASC
      `
    )
    .all(quizId) as unknown as QuizChoiceRow[]
  const choicesByQuestionId = new Map<string, QuizChoice[]>()

  for (const choiceRow of choiceRows) {
    const choices = choicesByQuestionId.get(choiceRow.question_id) ?? []
    choices.push(mapQuizChoiceRow(choiceRow))
    choicesByQuestionId.set(choiceRow.question_id, choices)
  }

  return questionRows.map((questionRow) => ({
    ...mapQuizQuestionRow(questionRow),
    choices: choicesByQuestionId.get(questionRow.id) ?? []
  }))
}

function loadQuizResultFromDatabase(connection: DatabaseSync, attemptId: string): QuizResult {
  const attemptRow = connection
    .prepare(
      `
        SELECT id, quiz_id, started_at, completed_at, correct_answer_count, total_question_count
        FROM quiz_attempts
        WHERE id = ?
      `
    )
    .get(attemptId) as unknown as QuizAttemptRow | undefined

  if (attemptRow === undefined) {
    throw new AppError('quiz_attempt_not_found', 'This quiz attempt is no longer available.')
  }

  const attempt = mapQuizAttemptRow(attemptRow)
  const fullQuiz = loadFullQuizFromDatabase(connection, attempt.quizId)

  if (fullQuiz === null) {
    throw new AppError('quiz_not_found', 'This quiz is no longer available.')
  }

  const questionsById = new Map(
    fullQuiz.questions.map((question) => [question.id, question] as const)
  )
  const answerRows = connection
    .prepare(
      `
        SELECT
          quiz_attempt_answers.question_id,
          quiz_attempt_answers.selected_choice_id,
          quiz_attempt_answers.is_correct,
          quiz_attempt_answers.answered_at
        FROM quiz_attempt_answers
        INNER JOIN quiz_questions ON quiz_questions.id = quiz_attempt_answers.question_id
        WHERE quiz_attempt_answers.attempt_id = ?
        ORDER BY quiz_questions.sort_order ASC
      `
    )
    .all(attemptId) as unknown as QuizAttemptAnswerRow[]

  return {
    quiz: fullQuiz.quiz,
    attempt,
    answers: answerRows.map((answerRow) => {
      const question = questionsById.get(answerRow.question_id)

      if (question === undefined) {
        throw new AppError('quiz_not_found', 'This quiz is no longer available.')
      }

      return {
        question,
        selectedChoiceId: answerRow.selected_choice_id,
        isCorrect: answerRow.is_correct === 1,
        answeredAt: answerRow.answered_at
      }
    })
  }
}

function validateQuestionInputs(questions: SaveQuizQuestionInput[]): ValidatedQuestionInput[] {
  if (questions.length === 0) {
    throw new AppError('validation_failed', 'At least one quiz question is required.')
  }

  return questions.map((question, questionIndex) => {
    const prompt = question.prompt.trim()
    const explanation = question.explanation?.trim() || null

    if (prompt.length === 0) {
      throw new AppError(
        'validation_failed',
        `Quiz question ${questionIndex + 1} prompt is required.`
      )
    }

    if (question.choices.length < 2) {
      throw new AppError(
        'validation_failed',
        `Quiz question ${questionIndex + 1} must have at least two choices.`
      )
    }

    let correctChoiceCount = 0
    const choices = question.choices.map((choice, choiceIndex) => {
      const choiceText = choice.choiceText.trim()

      if (choiceText.length === 0) {
        throw new AppError(
          'validation_failed',
          `Quiz question ${questionIndex + 1} choice ${choiceIndex + 1} text is required.`
        )
      }

      if (choice.isCorrect) {
        correctChoiceCount += 1
      }

      return {
        choiceText,
        isCorrect: choice.isCorrect
      }
    })

    if (correctChoiceCount !== 1) {
      throw new AppError(
        'validation_failed',
        `Quiz question ${questionIndex + 1} must have exactly one correct choice.`
      )
    }

    return {
      prompt,
      explanation,
      choices
    }
  })
}

function validateAndGradeAnswers(
  fullQuiz: FullQuiz,
  answers: QuizAnswerSubmission[]
): Array<{ questionId: string; selectedChoiceId: string; isCorrect: boolean }> {
  if (fullQuiz.questions.length === 0) {
    throw new AppError('validation_failed', 'This quiz has no questions to grade.')
  }

  const questionById = new Map(fullQuiz.questions.map((question) => [question.id, question]))
  const submittedAnswersByQuestionId = new Map<string, QuizAnswerSubmission>()

  for (const answer of answers) {
    const questionId = answer.questionId.trim()
    const selectedChoiceId = answer.selectedChoiceId.trim()

    if (questionId.length === 0) {
      throw new AppError('validation_failed', 'Submitted answer question id is required.')
    }

    if (selectedChoiceId.length === 0) {
      throw new AppError('quiz_incomplete_submission', 'Answer every question before submitting.')
    }

    if (submittedAnswersByQuestionId.has(questionId)) {
      throw new AppError('validation_failed', 'Submitted answers include a duplicate question.')
    }

    if (!questionById.has(questionId)) {
      throw new AppError('validation_failed', 'Submitted answers include an unknown question.')
    }

    submittedAnswersByQuestionId.set(questionId, {
      questionId,
      selectedChoiceId
    })
  }

  if (submittedAnswersByQuestionId.size !== fullQuiz.questions.length) {
    const missingAnswerCount = fullQuiz.questions.length - submittedAnswersByQuestionId.size

    throw new AppError(
      'quiz_incomplete_submission',
      `Answer every question before submitting. ${missingAnswerCount} remaining.`
    )
  }

  return fullQuiz.questions.map((question) => {
    const answer = submittedAnswersByQuestionId.get(question.id)

    if (answer === undefined) {
      throw new AppError('quiz_incomplete_submission', 'Answer every question before submitting.')
    }

    const selectedChoice = question.choices.find((choice) => choice.id === answer.selectedChoiceId)

    if (selectedChoice === undefined) {
      throw new AppError('validation_failed', 'Selected answers do not match this quiz.')
    }

    return {
      questionId: question.id,
      selectedChoiceId: selectedChoice.id,
      isCorrect: selectedChoice.isCorrect
    }
  })
}

function rollbackTransaction(connection: DatabaseSync): void {
  try {
    connection.exec('ROLLBACK')
  } catch {
    // Preserve the original transaction error.
  }
}

function mapQuizRow(row: QuizRow): QuizRecord {
  return {
    id: row.id,
    lessonId: row.lesson_id,
    title: row.title,
    difficulty: normalizeQuizDifficulty(row.difficulty),
    questionCount: row.question_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function normalizeQuizDifficulty(
  value: QuizDifficulty | string | null | undefined
): QuizDifficulty | null {
  if (value === undefined || value === null) {
    return null
  }

  if (value === 'easy' || value === 'nbme' || value === 'custom') {
    return value
  }

  throw new AppError('validation_failed', 'Choose a supported quiz difficulty.')
}

function mapQuizQuestionRow(row: QuizQuestionRow): Omit<QuizQuestion, 'choices'> {
  return {
    id: row.id,
    quizId: row.quiz_id,
    prompt: row.prompt,
    explanation: row.explanation,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapQuizChoiceRow(row: QuizChoiceRow): QuizChoice {
  return {
    id: row.id,
    questionId: row.question_id,
    choiceText: row.choice_text,
    isCorrect: row.is_correct === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapQuizAttemptRow(row: QuizAttemptRow): QuizAttempt {
  return {
    id: row.id,
    quizId: row.quiz_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    correctAnswerCount: row.correct_answer_count,
    totalQuestionCount: row.total_question_count
  }
}
